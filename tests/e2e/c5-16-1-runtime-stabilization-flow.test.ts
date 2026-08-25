import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  c5161ShareableExecutionSummarySchema,
  c516StockPatchedRuntimeAbArtifactSchema,
  subtitleFinalizationReportSchema,
  subtitleOverlapAcousticResolutionSchema,
  subtitlePresentationResolutionSchema,
  whisperRuntimeCapabilityArtifactSchema,
  type OverlapDecision,
  type SubtitleCue,
} from "@mvl/shared";
import {
  auditTimestampEvidenceAttempt,
  buildTimestampEvidenceIntegrityArtifact,
  classifyOverlapAcousticComponent,
  WhisperCppWorkerPool,
  type WhisperWorker,
  type WhisperWorkerCapability,
  type WhisperWorkerFactory,
} from "@mvl/transcription-core";
import {
  auditC5161ShareableArtifacts,
  generateC5161ShareableArtifacts,
} from "@mvl/video-subtitler";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const COMMIT = "371b5a7561823ab2bb32142d2751e35e7534727b";
const PATCH_SHA =
  "bba39640e7005a1fdeb62c549d04ba76b6fc0d8aedae43daf9c9de1ab10a735d";
const GENERATED_AT = "2026-08-26T00:00:00.000Z";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function cue(
  id: string,
  text: string,
  start: number,
  end: number,
): SubtitleCue {
  return {
    id,
    text,
    start,
    end,
    language: "ja",
    languages: ["ja"],
    speaker: null,
    confidence: 1,
  };
}

function unresolvedDecision(cues: readonly SubtitleCue[]): OverlapDecision {
  const [left, right] = cues;
  if (left === undefined || right === undefined)
    throw new Error("two cues required");
  return {
    decisionId: "overlap-decision",
    cueIds: cues.map((value) => value.id),
    relationship: "unresolved",
    interval: { start: left.start, end: right.end },
    overlapPairs: [
      {
        leftCueId: left.id,
        rightCueId: right.id,
        overlapSeconds: 0.4,
        overlapRatio: 0.4,
        textSimilarity: 0,
        textContainment: 0,
      },
    ],
    overlapSeconds: 0.4,
    overlapRatio: 0.4,
    textSimilarity: 0,
    textContainment: 0,
    speakerEvidence: [],
    styleEvidence: [],
    layerEvidence: [],
    sourceEvidence: [],
    tokenBoundaryEvidence: [],
    speechBoundaryEvidence: [],
    sceneEvidence: [],
    humanReviewedAuthority: true,
    recommendedAction: "review",
    safeAutomaticAction: "none",
    timingMutations: [],
    assEventOverrides: [],
    vttCueSettings: [],
    reasons: ["mock-c5-16-unresolved"],
    blocking: true,
    resolutionSource: "presentation-only",
    acousticEvidenceIds: [],
    classificationConfidence: null,
    counterfactualScores: {},
  };
}

function capability(useVad: boolean): WhisperWorkerCapability {
  return {
    executablePath: "/Users/mock/runtime/whisper-server-mvl",
    serverPath: "/Users/mock/runtime/whisper-server-mvl",
    modelPath: "/Users/mock/.cache/models/ggml-large-v3.bin",
    modelHash: HASH_A,
    whisperCppVersion: "1.9.3",
    coreML: false,
    threads: 8,
    language: "ja",
    vadModelPath: "/Users/mock/.cache/models/ggml-silero.bin",
    useVad,
    vadProfile: "sensitive-v2",
    tokenTimestamps: true,
    promptConstraint: "none",
  };
}

function request(id: string) {
  return {
    audioPath: "/Users/mock/audio/component.wav",
    chunk: {
      id,
      relativePath: "audio/component.wav",
      start: 0,
      end: 10,
      duration: 10,
      sha256: HASH_A,
    },
    language: "ja" as const,
    timestampStrategy: "segment" as const,
    tokenTimestamps: true,
  };
}

function workerFactory(state: {
  unsafeExecutions: number;
}): WhisperWorkerFactory {
  return {
    serverPathFor() {
      return Promise.resolve("/Users/mock/runtime/whisper-server-mvl");
    },
    create({ batchKey, mode }) {
      let requestCount = 0;
      let seenVad = false;
      const worker: WhisperWorker = {
        batchKey,
        mode,
        backend: "cpu",
        initialize() {
          return Promise.resolve();
        },
        transcribe(input) {
          const useVad = input.capability.useVad;
          if (seenVad && !useVad) state.unsafeExecutions += 1;
          seenVad ||= useVad;
          requestCount += 1;
          return Promise.resolve({
            text: input.request.chunk.id,
            segments: [],
            raw: null,
          });
        },
        healthCheck() {
          return Promise.resolve(true);
        },
        close() {
          return Promise.resolve();
        },
        metrics() {
          return {
            requestCount,
            warmupCount: 0,
            initializationSeconds: 0,
            modelLoadSeconds: 0,
            coreMLWarmupSeconds: 0,
            transcriptionSeconds: 0,
            exitReason: null,
          };
        },
      };
      return worker;
    },
  };
}

function legacyAbArtifact() {
  return {
    schemaVersion: "1.0.0",
    artifactType: "c5-16-stock-patched-runtime-ab",
    generatedAt: GENERATED_AT,
    upstream: {
      repository: "ggml-org/whisper.cpp",
      tag: "v1.9.3",
      commit: COMMIT,
      sourceTree: "c".repeat(40),
    },
    build: {
      buildIdentityHash: HASH_A,
      buildFlagsHash: HASH_A,
      stockBinarySha256: HASH_A,
      patchedBinarySha256: HASH_B,
      patchSha256: PATCH_SHA,
      sameSource: true,
      sameBuildConfiguration: true,
    },
    modelSha256: HASH_A,
    vadModelSha256: HASH_B,
    requestPairs: [
      {
        componentId: "component-1",
        profile: "current-sensitive-vad",
        audioSha256: HASH_A,
        requestConfigHash: HASH_A,
        stockTextHash: HASH_A,
        patchedTextHash: HASH_A,
        textEqual: true,
        stockSegmentHash: HASH_A,
        patchedSegmentHash: HASH_A,
        segmentsEqual: true,
        stockRawTokenHash: HASH_A,
        patchedRawTokenHash: HASH_A,
        rawTokensComparable: true,
        patchedMappedTokenCount: 1,
        patchedRawVadIntervalCount: 1,
        languageEqual: true,
        requestConfigurationEqual: true,
        promptEqual: true,
        stockResponseBytes: 1,
        patchedResponseBytes: 1,
        stockDurationSeconds: 1,
        patchedDurationSeconds: 1,
        failures: [],
      },
    ],
    perProfile: [
      {
        profile: "current-sensitive-vad",
        pairCount: 1,
        textParityCount: 1,
        segmentParityCount: 1,
        rawTokenParityCount: 1,
        languageParityCount: 1,
        patchedMappedTokenCount: 1,
        patchedRawVadIntervalCount: 1,
      },
    ],
    summary: {
      pairCount: 1,
      freshRequestCount: 2,
      textParityPassed: true,
      segmentParityPassed: true,
      rawTokenParityPassed: true,
      languageParityPassed: true,
      requestConfigurationParityPassed: true,
      promptParityPassed: true,
      stockMappedTokenCount: 0,
      patchedMappedTokenCount: 1,
      stockRawVadIntervalCount: 0,
      patchedRawVadIntervalCount: 1,
      stockWallClockSeconds: 1,
      patchedWallClockSeconds: 1,
      stockWorkerStartCount: 1,
      patchedWorkerStartCount: 1,
      stockModelLoadCount: 1,
      patchedModelLoadCount: 1,
      stockPeakResidentBytes: null,
      patchedPeakResidentBytes: null,
      stockResponseBytes: 1,
      patchedResponseBytes: 1,
      accepted: true,
      failures: [],
    },
  } as const;
}

function zeroFinalizationMetrics() {
  return {
    machineCueCount: 2,
    automaticDecisionCount: 0,
    safeAutomaticMutationCount: 0,
    suggestionOnlyCount: 1,
    blockingFindingCount: 1,
    unresolvedCount: 1,
    reviewItemCount: 1,
    humanDecisionCount: 0,
    finalCueCount: 2,
    unsafeMutationCount: 0,
    multiDecisionConflictCount: 0,
    substringReplacementViolationCount: 0,
    broadWindowVisibleMutationCount: 0,
    ambiguousVisibleMutationCount: 0,
    localIntervalMissingVisibleMutationCount: 0,
    fullCueFragmentReplacementCount: 0,
    formatParityErrorCount: 0,
    automaticCueRate: 0,
    manualReviewCueRate: 1,
    blockingCueRate: 1,
    characterCorrectionRate: 0,
    timingCorrectionRate: 0,
    terminologyCorrectionRate: 0,
    dialectCorrectionRate: 0,
    hallucinationRejectionCount: 0,
  };
}

describe("C5.16.1 runtime stabilization mock E2E", () => {
  it("normalizes evidence, guards worker state, preserves review status, and emits auditable shareables", async () => {
    const taskRoot = await mkdtemp(path.join(tmpdir(), "mvl-c5-16-1-e2e-"));
    temporaryRoots.push(taskRoot);
    const subtitleDirectory = path.join(taskRoot, "subtitle-package");
    await mkdir(subtitleDirectory, { recursive: true });

    const audited = auditTimestampEvidenceAttempt({
      attemptId: "near-end-vad",
      profile: "current-sensitive-vad",
      useVad: true,
      extractionInterval: { start: 100, end: 110 },
      actualAudioDurationSeconds: 10,
      durationMeasurementMethod: "wav-frame-count/sample-rate",
      segments: [],
      rawVadIntervals: [0.01, 0.01, 0.02, 0.02, 0.03, 0.03, 0.05].map(
        (delta, index) => ({
          intervalId: `near-end-${String(index + 1)}`,
          start: index * 0.1,
          end: 10 + delta,
          coordinateSystem: "original-audio-local" as const,
        }),
      ),
      tokenTimestampsRequested: true,
      tokenTimestampPolicy: "mapped-only",
      mappedTokenGetterActuallyUsed: true,
      configuration: { rawVadBoundaryNormalizationToleranceSeconds: 0.05 },
    });
    expect(audited.integrity.attemptMetrics).toMatchObject({
      rawVadTrustedIntervalCount: 7,
      rawVadBoundaryNormalizedIntervalCount: 7,
      rawVadInvalidIntervalCount: 0,
      rawVadMaximumNormalizationDeltaSeconds: 0.05,
    });
    expect(
      audited.integrity.rawVadEvaluations?.every((item) => item.rawEnd > 10),
    ).toBe(true);

    const workerState = { unsafeExecutions: 0 };
    const pool = new WhisperCppWorkerPool({
      mode: "persistent",
      stateIsolation: "require-safe",
      factory: workerFactory(workerState),
    });
    for (const [id, useVad] of [
      ["vad", true],
      ["no-vad", false],
    ] as const) {
      await pool.transcribe({
        request: request(id),
        capability: capability(useVad),
        initialPrompt: null,
        processFallback: () =>
          Promise.resolve({
            text: "fallback",
            segments: [],
            raw: null,
          }),
      });
    }
    const workerMetrics = pool.metrics();
    await pool.close();
    expect(workerState.unsafeExecutions).toBe(0);
    expect(workerMetrics).toMatchObject({
      preventedUnsafeWorkerTransitionCount: 1,
      unsafeWorkerTransitionCount: 0,
      workerRestartCount: 1,
      workerStartCount: 2,
    });

    const cues = [
      cue("cue-a", "前", 101, 102),
      cue("cue-b", "後", 101.6, 102.6),
    ];
    const sourceDecision = unresolvedDecision(cues);
    const component = classifyOverlapAcousticComponent({
      plan: {
        componentId: "component-1",
        sourceOverlapDecisionId: sourceDecision.decisionId,
        cueIds: cues.map((value) => value.id),
        unionInterval: { start: 101, end: 102.6 },
        extractionInterval: { start: 100, end: 110 },
        profiles: ["current-sensitive-vad", "no-vad", "extra-sensitive-vad"],
      },
      allCues: cues,
      sourceDecision,
      attempts: [],
      mode: "enforce",
      audioPath: "audio/component.wav",
      audioSha256: HASH_A,
      audioDurationSeconds: 10,
      nominalExtractionInterval: { start: 100, end: 110 },
      nominalDurationSeconds: 10,
      actualAudioDurationSeconds: 10,
      actualAudioLocalEndSeconds: 10,
      actualMediaGlobalEndSeconds: 110,
      durationDifferenceSeconds: 0,
      durationMeasurementMethod: "wav-frame-count/sample-rate",
      ffprobeDurationSeconds: 10,
      durationCrossCheckDeltaSeconds: 0,
      audioFullyCoversComponent: true,
    });
    expect(component).toMatchObject({
      finalRelationship: "unresolved",
      safeAutomaticAction: "none",
      blocking: true,
    });

    const finalization = subtitleFinalizationReportSchema.parse({
      schemaVersion: "1.0.0",
      reportType: "subtitle-finalization-report",
      finalizationVersion: "C5.16.1",
      generatedAt: GENERATED_AT,
      mode: "review-fallback",
      status: "needs-review",
      finalizationMethod: "none",
      baseSubtitlePackageHash: HASH_A,
      baseCueHash: HASH_A,
      inputEvidenceHash: HASH_A,
      outputCueHash: HASH_A,
      outputHash: HASH_A,
      humanReviewedBaseline: null,
      thresholds: {
        minimumAssociationScore: 0.82,
        minimumAssociationMargin: 0.12,
        minimumIndependentSupport: 2,
        minimumExistingCuePreservation: 0.85,
        minimumCandidateCoverage: 0.9,
        maximumContentOmission: 0.15,
        maximumContentAddition: 0.15,
        maximumNeighborCueIntrusion: 0.05,
        minimumLocalSpeechCoverage: 0.8,
      },
      decisions: [],
      findings: [
        {
          findingId: "overlap-review",
          severity: "blocking",
          code: "OVERLAP_REQUIRES_REVIEW",
          cueIds: cues.map((value) => value.id),
          message: "Mock overlap remains unresolved.",
        },
      ],
      metrics: zeroFinalizationMetrics(),
      qualityGate: {
        passed: false,
        finalIntegrityPassed: true,
        serializationRoundTripPassed: true,
        formatSemanticParityPassed: true,
        canonicalParityPassed: true,
        presentationParityPassed: true,
        rollbackApplied: false,
        sourceReadOnlyVerified: true,
        serializedSrtContainsOverlap: true,
        legalSrtOverlapRenderingMayVary: false,
        unresolvedSrtOverlapPresent: true,
        srtOverlapRenderingMayVary: true,
        blockingCodes: ["OVERLAP_REQUIRES_REVIEW"],
        warningCodes: [],
      },
      outputPaths: {
        srt: "final.srt",
        vtt: "final.vtt",
        ass: "final.ass",
        subtitlePackage: "package.json",
        reviewPackage: null,
        reviewPage: null,
        correctionFeedback: null,
        presentationResolution: "subtitle-presentation-resolution.json",
        overlapAcousticResolution: "subtitle-overlap-acoustic-resolution.json",
        overlapWhisperExecutionMetrics:
          "overlap-whisper-execution-metrics.json",
        subtitledVideo: null,
      },
    });
    const presentation = subtitlePresentationResolutionSchema.parse({
      schemaVersion: "1.0.0",
      artifactType: "subtitle-presentation-resolution",
      resolutionVersion: "C5.16.1",
      generatedAt: GENERATED_AT,
      baseCueHash: HASH_A,
      canonicalCueHash: HASH_A,
      presentationCueHash: HASH_A,
      configuration: {
        presentationResolution: "enforce",
        overlapResolution: "conservative",
        maximumLines: 2,
        maximumCharactersPerLine: 16,
        maximumRapidTurnOverlapSeconds: 0.18,
        maximumRapidTurnOverlapRatio: 0.15,
        maximumTimingAdjustmentSeconds: 0.5,
        minimumPostRepairCueDurationSeconds: 0.25,
      },
      layoutDecisions: [],
      repetitionDecisions: [],
      overlapDecisions: [sourceDecision],
      summary: {
        canonicalCueCount: 2,
        presentationCueCount: 2,
        layoutDecisionCount: 0,
        layoutChangedCount: 0,
        layoutResolvedCount: 0,
        layoutBlockingCount: 0,
        repetitionDecisionCount: 0,
        repetitionResolvedCount: 0,
        repetitionBlockingCount: 0,
        overlapPairCount: 1,
        overlapComponentCount: 1,
        overlapResolvedCount: 0,
        overlapBlockingCount: 1,
        timingMutationCount: 0,
        canonicalTextMutationCount: 0,
        canonicalTimingMutationCount: 0,
        displayLexicalMismatchCount: 0,
        presentationCreatedTemporalCueCount: 0,
        reviewGroupCount: 1,
        serializedSrtContainsOverlap: true,
        legalSrtOverlapRenderingMayVary: false,
        unresolvedSrtOverlapPresent: true,
        srtOverlapRenderingMayVary: true,
      },
    });
    const overlap = subtitleOverlapAcousticResolutionSchema.parse({
      schemaVersion: "1.0.0",
      artifactType: "subtitle-overlap-acoustic-resolution",
      resolutionVersion: "C5.16.1",
      generatedAt: GENERATED_AT,
      sourceFingerprint: {
        fileName: "episode.mkv",
        size: 1,
        durationSeconds: 120,
        sha256: HASH_A,
      },
      baseCueHash: HASH_A,
      basePresentationResolutionHash: HASH_A,
      configuration: {
        mode: "enforce",
        audioStreamIndex: 1,
        contextSeconds: 1.5,
        maximumWindowSeconds: 20,
        hardMaximumWindowSeconds: 30,
        maximumAsrRequests: 21,
        profiles: ["current-sensitive-vad", "no-vad", "extra-sensitive-vad"],
        maximumTimingAdjustmentSeconds: 0.5,
        minimumPostRepairCueDurationSeconds: 0.4,
        maximumNeighborIntrusionRatio: 0.15,
        minimumBoundaryConfidence: 0.72,
        minimumAlignmentConfidence: 0.72,
        minimumIndependentProfileSupport: 2,
        minimumDecisionMargin: 0.1,
        rawVadBoundaryNormalizationToleranceSeconds: 0.05,
        workerStateIsolationPolicyVersion: "c5.16.1-worker-state-isolation-v1",
        requestOrder: "adversarial",
        scoringWeights: {
          surfaceOrReading: 0.3,
          tokenCoverage: 0.2,
          temporalCoverage: 0.15,
          profileConsensus: 0.15,
          boundarySupport: 0.2,
          neighborIntrusionPenalty: 0.2,
        },
      },
      attempts: [],
      components: [component],
      summary: {
        componentCount: 1,
        cueCount: 2,
        audioExtractedCount: 1,
        audioFullyCoveredCount: 1,
        profileAttemptCount: 0,
        asrRequestCount: 0,
        cacheHitCount: 0,
        resolvedCount: 0,
        timingOnlyResolvedCount: 0,
        legalOverlapResolvedCount: 0,
        unresolvedCount: 1,
        timingMutationCount: 0,
        canonicalTextMutationCount: 0,
        wholeMediaAsrRequestCount: 0,
        midpointRepairCount: 0,
        characterRatioRepairCount: 0,
      },
    });
    const timestampIntegrity = buildTimestampEvidenceIntegrityArtifact({
      generatedAt: GENERATED_AT,
      sourceOverlapArtifactHash: HASH_A,
      runtimeCapability: {
        whisperCppVersion: "1.9.3",
        runtimeBinaryPathRecordedAsBasenameOnly: "whisper-server-mvl",
        runtimeBinarySha256: HASH_A,
        runtimeSourceCommit: COMMIT,
        serverResponseFormat: "mvl_verbose_json_v1",
        mappedTokenGetterAvailable: true,
        mappedTokenGetterActuallyUsed: true,
        rawVadGetterAvailable: true,
        rawVadGetterActuallyUsed: true,
        tokenTimestampControlAvailable: true,
        timestampCapabilityProbeMethod: "mock-e2e",
        timestampCapabilityStatus: "mapped-original-timeline",
        runtimeTimestampCapabilityHash: HASH_A,
        evidence: ["mock patched runtime"],
      },
      mode: "enforce",
      tokenTimestampPolicy: "mapped-only",
      legacyOverlapCachePolicy: "reject",
      attempts: [audited.integrity],
      rawVadIntervalCount: 7,
      configuration: { rawVadBoundaryNormalizationToleranceSeconds: 0.05 },
    });
    const runtimeCapability = whisperRuntimeCapabilityArtifactSchema.parse({
      schemaVersion: "1.0.0",
      artifactType: "whisper-runtime-capability",
      runtimeType: "mvl-patched",
      upstreamRepository: "ggml-org/whisper.cpp",
      upstreamTag: "v1.9.3",
      upstreamCommit: COMMIT,
      patchId: "mvl-mapped-token-raw-vad-json-v1",
      patchSha256: PATCH_SHA,
      binaryBasename: "whisper-server-mvl",
      binarySha256: HASH_A,
      buildFlagsHash: HASH_A,
      capabilityEndpointResponse: null,
      capabilityHash: HASH_A,
      behaviorProbeResults: {
        inferenceResponseCount: 1,
        mappedTokenResponseCount: 1,
        rawVadResponseCount: 1,
      },
      mappedGetterDeclared: true,
      mappedGetterActuallyUsed: true,
      rawVadGetterDeclared: true,
      rawVadGetterActuallyUsed: true,
      responseSchema: "mvl-whisper-server-response/1.0.0",
      verified: true,
      failures: [],
    });
    const ab =
      c516StockPatchedRuntimeAbArtifactSchema.parse(legacyAbArtifact());
    const localSummaryPath = path.join(
      taskRoot,
      "c5-16-1-execution-summary.local-only.json",
    );
    const abPath = path.join(taskRoot, "c5-16-stock-patched-runtime-ab.json");
    const videoPath = path.join(taskRoot, "episode.mkv");
    const humanPath = path.join(taskRoot, "human-reviewed.ass");
    await Promise.all([
      writeJson(
        path.join(subtitleDirectory, "subtitle-finalization-report.json"),
        finalization,
      ),
      writeJson(
        path.join(subtitleDirectory, "subtitle-presentation-resolution.json"),
        presentation,
      ),
      writeJson(
        path.join(
          subtitleDirectory,
          "subtitle-overlap-acoustic-resolution.json",
        ),
        overlap,
      ),
      writeJson(
        path.join(
          subtitleDirectory,
          "subtitle-timestamp-evidence-integrity.json",
        ),
        timestampIntegrity,
      ),
      writeJson(
        path.join(subtitleDirectory, "whisper-runtime-capability.json"),
        runtimeCapability,
      ),
      writeJson(abPath, ab),
      writeJson(localSummaryPath, {
        execution: {
          ...workerMetrics,
          cacheDirectory: "/Users/mock/.cache/mvl/asr",
          buildDirectory: "/Users/mock/build/whisper.cpp",
        },
        outcome: {
          status: "needs-review",
          canonicalTextMutationCount: 0,
          canonicalTimingMutationCount: 0,
        },
      }),
      writeFile(videoPath, "mock-video", "utf8"),
      writeFile(humanPath, "mock-human-ass", "utf8"),
    ]);
    const localHashBefore = sha256(await readFile(localSummaryPath));
    const generated = await generateC5161ShareableArtifacts({
      taskRoot,
      subtitleDirectory,
      localExecutionSummaryPath: localSummaryPath,
      stockPatchedRuntimeAbPath: abPath,
      externalFiles: [
        { role: "source-video", filePath: videoPath },
        { role: "human-reviewed-subtitle", filePath: humanPath },
      ],
    });
    const audit = await auditC5161ShareableArtifacts(generated.outputDirectory);
    expect(audit).toMatchObject({
      validationPassed: true,
      absolutePathLeakCount: 0,
      prohibitedSecretCount: 0,
    });
    expect(generated.manifest.summary).toMatchObject({
      artifactCount: 7,
      validationPassedCount: 7,
      absolutePathLeakCount: 0,
      prohibitedSecretCount: 0,
    });
    expect(sha256(await readFile(localSummaryPath))).toBe(localHashBefore);

    const shareableAb = c516StockPatchedRuntimeAbArtifactSchema.parse(
      JSON.parse(
        await readFile(
          path.join(
            generated.outputDirectory,
            "c5-16-stock-patched-runtime-ab.json",
          ),
          "utf8",
        ),
      ) as unknown,
    );
    expect(shareableAb.requestPairs[0]).toMatchObject({
      rawGroupedWordsComparable: true,
      rawGroupedWordsEqual: true,
      individualRawTokenParityStatus: "not-observable-on-stock-server",
    });
    const shareableSummary = await readFile(
      path.join(generated.outputDirectory, "execution-summary.json"),
      "utf8",
    );
    expect(shareableSummary).not.toMatch(/\/Users\//u);
    expect(shareableSummary).not.toContain(".cache/mvl");
    expect(shareableSummary).not.toContain("mock-video");
    const parsedSummary = c5161ShareableExecutionSummarySchema.parse(
      JSON.parse(shareableSummary) as unknown,
    );
    expect(parsedSummary.outcome.status).toBe("needs-review");
  });
});
