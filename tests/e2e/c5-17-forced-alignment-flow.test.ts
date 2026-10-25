import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  forcedAlignmentAttemptSchema,
  forcedAlignmentCacheManifestSchema,
  forcedAlignmentRuntimeCapabilitySchema,
  NodeProcessRunner,
  subtitleOverlapAcousticResolutionSchema,
  subtitlePackageSchema,
  subtitlePresentationResolutionSchema,
  subtitleReviewPackageSchema,
  type ForcedAlignmentAttempt,
  type ForcedAlignmentRuntimeCapability,
  type SubtitleCue,
} from "@mvl/shared";
import {
  alignCanonicalReadingWithEvidence,
  applyCanonicalForcedAlignment,
  buildForcedAlignmentCueDecision,
  buildSubtitlePresentationResolution,
  buildSubtitleCanonicalAlignmentInput,
  buildSubtitleCanonicalForcedAlignment,
  forcedAlignmentSha256,
  jointlyAssignForcedAlignmentComponent,
} from "@mvl/transcription-core";
import {
  finalizeSubtitleTask,
  defaultMfaAlignmentExecutor,
  loadHumanReviewedSubtitle,
  sha256LocalFile,
  verifyMfaRuntimeCapability,
  type MfaAlignmentExecutorInput,
} from "@mvl/video-subtitler";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);
const temporaryDirectories: string[] = [];

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(
      `Missing required integration environment variable ${name}.`,
    );
  }
  return value;
}

function integrationCanonicalInput(input: {
  transcript: string;
  dictionary: string;
}): Pick<
  MfaAlignmentExecutorInput,
  "canonicalUnits" | "expectedPhones" | "expectedUnitIds"
> {
  // align_one uses --no_tokenization: the explicit transcript supplies units,
  // and only the actual selected dictionary may supply their phones.
  const tokens = input.transcript.trim().split(/\s+/u).filter(Boolean);
  if (tokens.length === 0) {
    throw new Error("MFA integration transcript must contain lexical units.");
  }
  const pronunciations = new Map<string, string[][]>();
  for (const line of input.dictionary.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    // Match the production dictionary contract: word, optional tab-separated
    // probabilities, then the final tab-separated pronunciation field.
    const fields = line.split("\t");
    const word = fields[0]?.normalize("NFKC").trim() ?? "";
    const phones = (fields.at(-1) ?? "")
      .trim()
      .split(/\s+/u)
      .filter((phone) => phone !== "" && !/^\d+(?:\.\d+)?$/u.test(phone));
    if (fields.length < 2 || word === "" || phones.length === 0) {
      throw new Error(
        "MFA integration requires a tab-separated dictionary with nonempty phones.",
      );
    }
    const variants = pronunciations.get(word) ?? [];
    if (!variants.some((variant) => variant.join(" ") === phones.join(" "))) {
      variants.push(phones);
      pronunciations.set(word, variants);
    }
  }
  const canonicalUnits = tokens.map((surface, index) => {
    const normalizedSurface = surface.normalize("NFKC");
    const variants = pronunciations.get(normalizedSurface) ?? [];
    if (variants.length === 0) {
      throw new Error(`MFA integration dictionary OOV: ${surface}.`);
    }
    const phones = variants[0];
    if (variants.length !== 1 || phones === undefined) {
      throw new Error(
        `MFA integration dictionary pronunciation is ambiguous: ${surface}.`,
      );
    }
    if (phones.some((phone) => ["sil", "sp", "spn", "<eps>"].includes(phone))) {
      throw new Error(
        `MFA integration unit has non-lexical phones: ${surface}.`,
      );
    }
    return {
      unitId: `integration-unit-${String(index + 1)}`,
      surface,
      normalizedSurface,
      reading: null,
      phones,
      punctuation: false,
      criticalOov: false,
    };
  });
  return {
    canonicalUnits,
    expectedUnitIds: canonicalUnits.map((unit) => unit.unitId),
    expectedPhones: canonicalUnits.flatMap((unit) => unit.phones),
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

function runtimeCapability(): ForcedAlignmentRuntimeCapability {
  const model = (
    modelType: "acoustic" | "dictionary" | "g2p",
    name: string,
    sha256: string,
  ) => ({
    modelType,
    name,
    version: "3.0.0",
    fileBasename: `${name}.zip`,
    size: 123,
    sha256,
    license: "CC BY 4.0",
    citation: `Official ${name} citation`,
    metadataSha256: HASH_D,
    officialSource: "MontrealCorpusTools" as const,
  });
  return forcedAlignmentRuntimeCapabilitySchema.parse({
    schemaVersion: "1.0.0",
    artifactType: "forced-alignment-runtime-capability",
    runtimeVersion: "C5.17",
    generatedAt: "2026-08-26T00:00:00.000Z",
    backend: "mfa-japanese",
    mfaVersion: "3.4.2",
    pythonVersion: "3.11.9",
    kalpyVersion: "0.8.2",
    kaldiVersion: "5.5",
    pyniniVersion: "2.1.6",
    sudachiVersion: "0.6.11",
    praatioVersion: "6.2.0",
    commandCapabilities: {
      alignOneCommand: "align_one",
      outputFormats: ["long_textgrid"],
      selectedOutputFormat: "long_textgrid",
      jsonHasWordTier: false,
      jsonHasPhoneTier: false,
      g2pSupported: true,
      originalTextSupported: true,
      tokenizationMode: "sudachi",
      speakerAdaptationSkipped: true,
    },
    acousticModel: model("acoustic", "japanese_mfa", HASH_A),
    dictionaryModel: model("dictionary", "japanese_mfa", HASH_B),
    g2pModel: model("g2p", "japanese_katakana_mfa", HASH_C),
    environmentExplicitSpecSha256: HASH_D,
    runtimeIdentityHash: HASH_A,
    platform: "darwin",
    architecture: "arm64",
    networkUsedDuringPreparation: false,
    networkUsedDuringAlignment: false,
    shareable: true,
  });
}

function attempt(input: {
  cue: SubtitleCue;
  windowType: "narrow" | "expanded";
  start: number;
  end: number;
  unitId: string;
  unstable?: boolean;
}): ForcedAlignmentAttempt {
  const suffix = `${input.cue.id}-${input.windowType}`;
  const start = input.start + (input.unstable === true ? 0.35 : 0);
  const end = input.end + (input.unstable === true ? 0.35 : 0);
  const windowStart = Math.max(
    0,
    input.cue.start - (input.windowType === "narrow" ? 0.5 : 1),
  );
  const windowEnd = input.cue.end + (input.windowType === "narrow" ? 0.5 : 1);
  const wordId = `word-${suffix}`;
  return forcedAlignmentAttemptSchema.parse({
    attemptId: `attempt-${suffix}`,
    requestType: "canonical-forced-alignment",
    componentId: "component-mock",
    cueId: input.cue.id,
    windowType: input.windowType,
    windowLocalInterval: {
      start: 0,
      end: windowEnd - windowStart,
      coordinateSystem: "component-audio-local",
    },
    windowMediaInterval: {
      start: windowStart,
      end: windowEnd,
      coordinateSystem: "original-media-global",
    },
    audioSha256: HASH_D,
    audioDurationSeconds: windowEnd - windowStart,
    canonicalTextSha256: forcedAlignmentSha256(input.cue.text),
    alignmentTextSha256: forcedAlignmentSha256(input.cue.text),
    readingManifestSha256: HASH_A,
    runtimeIdentityHash: HASH_A,
    acousticModelHash: HASH_A,
    dictionaryModelHash: HASH_B,
    g2pModelHash: HASH_C,
    commandMode: "mock",
    outputFormat: "mock-json",
    parserVersion: "c5-17-mock-e2e",
    cacheHit: false,
    exitCode: 0,
    wallClockSeconds: 0.01,
    wordAlignments: [
      {
        alignmentId: wordId,
        label: input.cue.text,
        expectedUnitIds: [input.unitId],
        rawInterval: {
          start: start - windowStart,
          end: end - windowStart,
          coordinateSystem: "attempt-audio-local",
        },
        mappedInterval: {
          start,
          end,
          coordinateSystem: "original-media-global",
        },
        oov: false,
      },
    ],
    phoneAlignments: Array.from({ length: 5 }, (_, index) => {
      const phoneStart = start + ((end - start) * index) / 5;
      const phoneEnd = start + ((end - start) * (index + 1)) / 5;
      return {
        alignmentId: `phone-${suffix}-${String(index)}`,
        label: `p${String(index)}`,
        wordAlignmentId: wordId,
        rawInterval: {
          start: phoneStart - windowStart,
          end: phoneEnd - windowStart,
          coordinateSystem: "attempt-audio-local" as const,
        },
        mappedInterval: {
          start: phoneStart,
          end: phoneEnd,
          coordinateSystem: "original-media-global" as const,
        },
      };
    }),
    silenceIntervals: [],
    utteranceInterval: {
      start,
      end,
      coordinateSystem: "original-media-global",
    },
    alignedWordCount: 1,
    expectedWordCount: 1,
    alignedPhoneCount: 5,
    oovCount: 0,
    wordCoverageRatio: 1,
    readingCoverageRatio: 1,
    phoneCoverageRatio: 1,
    canonicalUnitCoverageRatio: 1,
    alignedWordCoverageRatio: 1,
    pronunciationUnitCoverageRatio: 1,
    expectedPhoneCoverageRatio: 1,
    wordWithAnyPhoneRatio: 1,
    alignedPhonePlausibilityRatio: 1,
    expectedPhoneCount: 5,
    alignedExpectedPhoneCount: 5,
    unresolvedMappingCount: 0,
    ambiguousMappingCount: 0,
    boundaryStart: start,
    boundaryEnd: end,
    startPinnedToWindowEdge: false,
    endPinnedToWindowEdge: false,
    alignmentSucceeded: true,
    failure: null,
    warnings: [],
  });
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "mvl-c5-17-e2e-"));
  temporaryDirectories.push(root);
  const subtitleDirectory = path.join(root, "subtitle-sample");
  await mkdir(subtitleDirectory, { recursive: true });
  const sourceVideo = path.join(root, "sample.mkv");
  const humanAss = path.join(root, "human-reviewed.ass");
  await writeFile(sourceVideo, "mock-video-read-only", "utf8");
  await writeFile(
    humanAss,
    `[Script Info]
ScriptType: v4.00+

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:02.20,Default,,0,0,0,,おはよう
Dialogue: 0,0:00:02.00,0:00:03.00,Default,,0,0,0,,ありがとう
`,
    "utf8",
  );
  const human = await loadHumanReviewedSubtitle(humanAss);
  const packageValue = subtitlePackageSchema.parse({
    schemaVersion: "1.0.0",
    packageType: "multilingual-subtitle-package",
    status: "ready",
    sourceLanguage: "ja",
    detectedLanguages: ["ja"],
    source: {
      fileName: "sample.mkv",
      container: "matroska",
      durationSeconds: 5,
    },
    identity: { title: "Mock C5.17", season: null, episode: 1, year: 2026 },
    primarySubtitle: {
      language: "ja",
      sourceType: "transcription",
      validationStatus: "needs-review",
      streamIndex: 1,
    },
    subtitleFiles: {
      srt: "./subtitle-sample.srt",
      vtt: "./subtitle-sample.vtt",
      ass: "./subtitle-sample.ass",
    },
    referenceSubtitles: [],
    video: { sourcePath: null, subtitledPath: null },
    cues: human.cues,
    warnings: [],
  });
  await writeFile(
    path.join(subtitleDirectory, "subtitle-package.json"),
    `${JSON.stringify(packageValue, null, 2)}\n`,
  );
  const overlap = subtitleOverlapAcousticResolutionSchema.parse({
    schemaVersion: "1.0.0",
    artifactType: "subtitle-overlap-acoustic-resolution",
    resolutionVersion: "C5.16.1",
    generatedAt: "2026-08-26T00:00:00.000Z",
    sourceFingerprint: {
      fileName: "sample.mkv",
      size: 20,
      durationSeconds: 5,
      sha256: await sha256LocalFile(sourceVideo),
    },
    baseCueHash: forcedAlignmentSha256(human.cues),
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
      requestOrder: "standard",
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
    components: [
      {
        componentId: "component-mock",
        sourceOverlapDecisionId: "overlap-mock",
        cueIds: human.cues.map((cue) => cue.id),
        unionInterval: { start: 1, end: 3 },
        extractionInterval: { start: 0.5, end: 3.5 },
        audioPath: null,
        audioSha256: null,
        audioDurationSeconds: null,
        audioFullyCoversComponent: false,
        profileAttemptIds: [],
        cueAlignments: [],
        pairAssessments: [],
        counterfactuals: [],
        finalRelationship: "unresolved",
        classificationConfidence: 0,
        recommendedAction: "review",
        safeAutomaticAction: "none",
        timingMutations: [],
        assEventOverrides: [],
        vttCueSettings: [],
        blocking: true,
        reasons: ["mock unresolved component"],
      },
    ],
    summary: {
      componentCount: 1,
      cueCount: 2,
      audioExtractedCount: 0,
      audioFullyCoveredCount: 0,
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
      untrustedTokenUsedForTimingCount: 0,
    },
  });
  await writeFile(
    path.join(subtitleDirectory, "subtitle-overlap-acoustic-resolution.json"),
    `${JSON.stringify(overlap, null, 2)}\n`,
  );
  return { root, subtitleDirectory, sourceVideo, humanAss, human };
}

function mockForcedAlignmentExecutor(input: {
  unstable?: boolean;
  duplicateOccurrence?: boolean;
}) {
  return async (
    options: Parameters<
      NonNullable<
        Parameters<
          typeof finalizeSubtitleTask
        >[0]["canonicalForcedAlignmentExecutor"]
      >
    >[0],
  ) => {
    const component = options.overlapArtifact.components[0];
    if (component === undefined) throw new Error("mock component missing");
    const canonicalInput = buildSubtitleCanonicalAlignmentInput({
      components: [
        {
          componentId: component.componentId,
          cues: options.cues.filter((cue) => component.cueIds.includes(cue.id)),
        },
      ],
      baseCueHash: options.overlapArtifact.baseCueHash,
      baseTimingHash: HASH_B,
      generatedAt: "2026-08-26T00:00:00.000Z",
    });
    const boundaries = [
      input.duplicateOccurrence === true
        ? { start: 1.5, end: 1.95 }
        : { start: 1.05, end: 1.95 },
      input.duplicateOccurrence === true
        ? { start: 1.5, end: 1.95 }
        : { start: 2.05, end: 2.95 },
    ];
    const attempts: ForcedAlignmentAttempt[] = [];
    const decisions = canonicalInput.cues.map((canonicalCue, index) => {
      const sourceCue = options.cues.find(
        (cue) => cue.id === canonicalCue.cueId,
      );
      const boundary = boundaries[index];
      const unit = canonicalCue.wordUnits.find((value) => !value.punctuation);
      if (
        sourceCue === undefined ||
        boundary === undefined ||
        unit === undefined
      ) {
        throw new Error("mock C5.17 cue fixture is incomplete");
      }
      const narrow = attempt({
        cue: sourceCue,
        windowType: "narrow",
        start: boundary.start,
        end: boundary.end,
        unitId: unit.unitId,
      });
      const expanded = attempt({
        cue: sourceCue,
        windowType: "expanded",
        start: boundary.start,
        end: boundary.end,
        unitId: unit.unitId,
        unstable: input.unstable,
      });
      attempts.push(narrow, expanded);
      const evidenceDp = alignCanonicalReadingWithEvidence({
        cue: canonicalCue,
        evidenceUnits: [
          {
            evidenceId: `mapped-token-${sourceCue.id}`,
            text: canonicalCue.alignmentText,
            reading: canonicalCue.normalizedReading,
            interval: {
              start: boundary.start,
              end: boundary.end,
              coordinateSystem: "original-media-global",
            },
            source: "trusted-mapped-token",
            timingUsable: true,
          },
        ],
      });
      return buildForcedAlignmentCueDecision({
        cue: canonicalCue,
        narrow,
        expanded,
        evidenceDp,
        mappedTokenIntervals: [
          {
            evidenceId: `mapped-token-${sourceCue.id}`,
            start: boundary.start,
            end: boundary.end,
          },
        ],
        rawVadIntervals: [
          {
            evidenceId: `raw-vad-${sourceCue.id}`,
            start: boundary.start,
            end: boundary.end,
          },
        ],
        decodedSegmentIntervals: [
          {
            evidenceId: `decoded-${sourceCue.id}`,
            start: boundary.start,
            end: boundary.end,
          },
        ],
      });
    });
    if (
      input.duplicateOccurrence === true &&
      decisions[0] !== undefined &&
      decisions[1] !== undefined
    ) {
      decisions[1] = {
        ...decisions[1],
        acousticOccurrenceId: decisions[0].acousticOccurrenceId,
      };
    }
    const forcedComponent = jointlyAssignForcedAlignmentComponent({
      componentId: component.componentId,
      componentInterval: component.unionInterval,
      canonicalCues: canonicalInput.cues,
      cueAlignments: decisions,
      attempts,
      mode: options.mode,
    });
    const applied = applyCanonicalForcedAlignment({
      cues: options.cues,
      components: [forcedComponent],
      mode: options.mode,
    });
    const runtime = runtimeCapability();
    const artifact = buildSubtitleCanonicalForcedAlignment({
      generatedAt: "2026-08-26T00:00:00.000Z",
      sourceFingerprint: options.sourceFingerprint,
      baseCueHash: options.overlapArtifact.baseCueHash,
      baseTimingHash: HASH_B,
      baseOverlapArtifactHash: HASH_C,
      runtimeCapabilityRef: "forced-alignment-runtime-capability.json",
      canonicalInputRef: "subtitle-canonical-alignment-input.json",
      configuration: { mode: options.mode, backend: options.backend },
      attempts,
      cueAlignments: decisions,
      components: [forcedComponent],
      appliedMutations: applied.appliedMutations,
      eligibleCueCount: canonicalInput.summary.eligibleCueCount,
      ineligibleCueCount: canonicalInput.summary.ineligibleCueCount,
      mfaProcessCount: attempts.length,
    });
    const cacheManifest = forcedAlignmentCacheManifestSchema.parse({
      schemaVersion: "1.0.0",
      artifactType: "forced-alignment-cache-manifest",
      cacheVersion: "C5.17",
      generatedAt: "2026-08-26T00:00:00.000Z",
      requestType: "canonical-forced-alignment",
      cacheRootShareableName: "mock-cache",
      entries: [],
      summary: {
        entryCount: 0,
        hitCount: 0,
        missCount: 0,
        mfaProcessCount: attempts.length,
        legacyAsrCacheHitCount: 0,
      },
    });
    const outputPaths = {
      canonicalInput: path.join(
        options.subtitleDirectory,
        "subtitle-canonical-alignment-input.json",
      ),
      alignment: path.join(
        options.subtitleDirectory,
        "subtitle-canonical-forced-alignment.json",
      ),
      runtimeCapability: path.join(
        options.subtitleDirectory,
        "forced-alignment-runtime-capability.json",
      ),
      cacheManifest: path.join(
        options.subtitleDirectory,
        "forced-alignment-cache-manifest.json",
      ),
    };
    await Promise.all([
      writeFile(
        outputPaths.canonicalInput,
        `${JSON.stringify(canonicalInput, null, 2)}\n`,
      ),
      writeFile(
        outputPaths.alignment,
        `${JSON.stringify(artifact, null, 2)}\n`,
      ),
      writeFile(
        outputPaths.runtimeCapability,
        `${JSON.stringify(runtime, null, 2)}\n`,
      ),
      writeFile(
        outputPaths.cacheManifest,
        `${JSON.stringify(cacheManifest, null, 2)}\n`,
      ),
    ]);
    return {
      artifact,
      canonicalInput,
      cacheManifest,
      cues: applied.cues,
      runtimeCapability: runtime,
      dependencyFailure: null,
      wallClockSeconds: 0.1,
      outputPaths,
    };
  };
}

describe("C5.17 mock end-to-end finalization", () => {
  it("runs canonical input through mock MFA, DP, gates, atomic timing repair, and finalization", async () => {
    const input = await fixture();
    const videoHashBefore = await sha256LocalFile(input.sourceVideo);
    const humanHashBefore = await sha256LocalFile(input.humanAss);
    const result = await finalizeSubtitleTask({
      taskDirectory: input.root,
      mode: "review-fallback",
      humanReviewedSubtitlePath: input.humanAss,
      sourceVideoPath: input.sourceVideo,
      forcedAlignment: "enforce",
      forcedAlignmentBackend: "hybrid",
      overlapAcousticResolution: "off",
      prepareReview: true,
      generateReviewAudio: false,
      canonicalForcedAlignmentExecutor: mockForcedAlignmentExecutor({}),
    });
    expect(result.report).toMatchObject({
      status: "human-validated",
      finalizationMethod: "human",
      finalizationVersion: "1.4.0-C5.17",
    });
    expect(result.report.metrics).toMatchObject({
      forcedAlignmentAnalyzedCueCount: 2,
      forcedAlignmentAttemptCount: 4,
      forcedAlignmentResolvedComponentCount: 1,
      forcedAlignmentUnresolvedComponentCount: 0,
      untrustedForcedAlignmentTimingUseCount: 0,
      wholeMediaAsrRequestCount: 0,
      overlapAsrRequestCount: 0,
    });
    expect(result.subtitlePackage.cues.map((cue) => cue.text)).toEqual(
      input.human.cues.map((cue) => cue.text),
    );
    expect(
      result.subtitlePackage.cues.map((cue) => [cue.start, cue.end]),
    ).toEqual([
      [1.05, 1.95],
      [2.05, 2.95],
    ]);
    expect(result.report.qualityGate).toMatchObject({
      serializationRoundTripPassed: true,
      canonicalParityPassed: true,
      presentationParityPassed: true,
    });
    expect(await sha256LocalFile(input.sourceVideo)).toBe(videoHashBefore);
    expect(await sha256LocalFile(input.humanAss)).toBe(humanHashBefore);
  });

  it.each([
    { label: "window instability", executor: { unstable: true } },
    {
      label: "duplicate acoustic occurrence",
      executor: { duplicateOccurrence: true },
    },
  ])(
    "keeps $label unresolved and exposes forced evidence in review",
    async ({ executor }) => {
      const input = await fixture();
      const result = await finalizeSubtitleTask({
        taskDirectory: input.root,
        mode: "review-fallback",
        humanReviewedSubtitlePath: input.humanAss,
        sourceVideoPath: input.sourceVideo,
        forcedAlignment: "enforce",
        forcedAlignmentBackend: "hybrid",
        overlapAcousticResolution: "off",
        prepareReview: true,
        generateReviewAudio: false,
        canonicalForcedAlignmentExecutor: mockForcedAlignmentExecutor(executor),
      });
      expect(result.report).toMatchObject({
        status: "needs-review",
        finalizationMethod: "none",
      });
      expect(result.report.metrics.forcedAlignmentResolvedComponentCount).toBe(
        0,
      );
      expect(
        result.report.metrics.forcedAlignmentUnresolvedComponentCount,
      ).toBe(1);
      expect(
        result.subtitlePackage.cues.map((cue) => [cue.start, cue.end]),
      ).toEqual(input.human.cues.map((cue) => [cue.start, cue.end]));
      const reviewPath = result.outputPaths.reviewPackage;
      if (reviewPath === null) throw new Error("review package missing");
      const review = subtitleReviewPackageSchema.parse(
        JSON.parse(await readFile(reviewPath, "utf8")) as unknown,
      );
      expect(review.items).toHaveLength(1);
      expect(review.items[0]?.forcedAlignmentEvidence?.disclaimer).toMatch(
        /not confirmed ground truth/iu,
      );
    },
  );

  it("observe mode emits artifacts but never changes timing or closes the blocker", async () => {
    const input = await fixture();
    const baselinePresentation = buildSubtitlePresentationResolution({
      cues: input.human.cues,
      baseCueHash: forcedAlignmentSha256(input.human.cues),
      humanReviewedAuthority: true,
      assEventEvidenceByCueId: new Map(
        input.human.assEventEvidence.map((event) => [event.cueId, event]),
      ),
      presentationResolution: "enforce",
      overlapResolution: "conservative",
      generatedAt: "2026-08-26T00:00:00.000Z",
    });
    const result = await finalizeSubtitleTask({
      taskDirectory: input.root,
      mode: "review-fallback",
      humanReviewedSubtitlePath: input.humanAss,
      sourceVideoPath: input.sourceVideo,
      forcedAlignment: "observe",
      forcedAlignmentBackend: "hybrid",
      overlapAcousticResolution: "off",
      prepareReview: true,
      generateReviewAudio: false,
      canonicalForcedAlignmentExecutor: mockForcedAlignmentExecutor({}),
    });
    expect(result.report.status).toBe("needs-review");
    expect(result.report.finalizationMethod).toBe("none");
    expect(result.report.metrics.forcedAlignmentResolvedComponentCount).toBe(0);
    expect(
      result.subtitlePackage.cues.map((cue) => [cue.start, cue.end]),
    ).toEqual(input.human.cues.map((cue) => [cue.start, cue.end]));
    expect(result.outputPaths.canonicalForcedAlignment).not.toBeNull();
    const presentation = subtitlePresentationResolutionSchema.parse(
      JSON.parse(
        await readFile(result.outputPaths.presentationResolution, "utf8"),
      ) as unknown,
    );
    expect(presentation.presentationCueHash).toBe(
      baselinePresentation.artifact.presentationCueHash,
    );
  });
});

describe("C5.17 real MFA integration input contract (offline)", () => {
  const transcript = "あ い";
  const dictionary = "# synthetic offline dictionary\nあ\ta\nい\t0.8\ti\n";

  it("supplies canonical units and dictionary-derived expected phones to the executor parser", async () => {
    const canonicalInput = integrationCanonicalInput({
      transcript,
      dictionary,
    });
    expect(canonicalInput.expectedUnitIds).toEqual([
      "integration-unit-1",
      "integration-unit-2",
    ]);
    expect(canonicalInput.canonicalUnits).toEqual([
      {
        unitId: "integration-unit-1",
        surface: "あ",
        normalizedSurface: "あ",
        reading: null,
        phones: ["a"],
        punctuation: false,
        criticalOov: false,
      },
      {
        unitId: "integration-unit-2",
        surface: "い",
        normalizedSurface: "い",
        reading: null,
        phones: ["i"],
        punctuation: false,
        criticalOov: false,
      },
    ]);
    expect(canonicalInput.expectedPhones).toEqual(["a", "i"]);
    const calls: string[] = [];
    const result = await defaultMfaAlignmentExecutor({
      attemptId: "offline-integration-attempt",
      componentId: "offline-integration-component",
      cueId: "offline-integration-cue",
      windowType: "narrow",
      windowAudioPath: "synthetic.wav",
      transcriptPath: "synthetic.txt",
      outputPath: "synthetic.TextGrid",
      temporaryDirectory: "synthetic-temp",
      mediaOffsetSeconds: 0,
      ...canonicalInput,
      capability: runtimeCapability(),
      mfaExecutable: "synthetic-mfa",
      pythonExecutable: "synthetic-python",
      acousticModel: "synthetic-acoustic.zip",
      dictionaryModel: "synthetic.dict",
      g2pModel: "synthetic-g2p.zip",
      parserHelperPath: "synthetic-parser.py",
      runner: {
        run: (executable) => {
          calls.push(executable);
          return Promise.resolve({
            exitCode: 0,
            stderr: "",
            stdout: JSON.stringify({
              fileInterval: { start: 0, end: 3 },
              words: [
                { label: "あ", start: 0.5, end: 1 },
                { label: "い", start: 1.2, end: 2 },
              ],
              phones: [
                { label: "a", start: 0.5, end: 1 },
                { label: "i", start: 1.2, end: 2 },
              ],
            }),
          });
        },
      },
    });
    expect(calls).toEqual(["synthetic-mfa", "synthetic-python"]);
    expect(result.parsed).toMatchObject({
      canonicalUnitCoverageRatio: 1,
      alignedWordCoverageRatio: 1,
      pronunciationUnitCoverageRatio: 1,
      expectedPhoneCoverageRatio: 1,
      expectedPhoneCount: 2,
      alignedExpectedPhoneCount: 2,
      unresolvedMappingCount: 0,
      ambiguousMappingCount: 0,
    });
    expect(
      result.parsed?.wordAlignments.map((word) => word.expectedUnitIds),
    ).toEqual([["integration-unit-1"], ["integration-unit-2"]]);
  });

  it.each([
    {
      label: "empty transcript",
      transcript: " ",
      dictionary,
      error: /lexical units/u,
    },
    {
      label: "OOV token",
      transcript: "う",
      dictionary,
      error: /dictionary OOV/u,
    },
    {
      label: "empty phones",
      transcript,
      dictionary: "あ\t\n",
      error: /nonempty phones/u,
    },
    {
      label: "ambiguous pronunciation",
      transcript: "あ",
      dictionary: "あ\ta\nあ\ti\n",
      error: /ambiguous/u,
    },
    {
      label: "unstructured dictionary",
      transcript,
      dictionary: "あ a\n",
      error: /tab-separated/u,
    },
    {
      label: "unknown phone fallback",
      transcript: "あ",
      dictionary: "あ\tspn\n",
      error: /non-lexical phones/u,
    },
  ])(
    "rejects $label before any model execution",
    ({ transcript, dictionary, error }) => {
      expect(() =>
        integrationCanonicalInput({ transcript, dictionary }),
      ).toThrow(error);
    },
  );
});

describe.runIf(process.env.MVL_MFA_INTEGRATION_TEST === "1")(
  "C5.17 optional real MFA integration",
  () => {
    it("runs one bounded real align_one attempt and parses word/phone tiers", async () => {
      const required = [
        "MVL_MFA_RUNTIME_MANIFEST",
        "MVL_MFA_EXECUTABLE",
        "MVL_MFA_PYTHON_EXECUTABLE",
        "MVL_MFA_ACOUSTIC_MODEL",
        "MVL_MFA_DICTIONARY_MODEL",
        "MVL_MFA_G2P_MODEL",
        "MVL_MFA_INTEGRATION_AUDIO",
        "MVL_MFA_INTEGRATION_TRANSCRIPT",
      ] as const;
      for (const name of required) expect(process.env[name], name).toBeTruthy();
      const runtimeManifest = requiredEnvironmentVariable(
        "MVL_MFA_RUNTIME_MANIFEST",
      );
      const mfaExecutable = requiredEnvironmentVariable("MVL_MFA_EXECUTABLE");
      const pythonExecutable = requiredEnvironmentVariable(
        "MVL_MFA_PYTHON_EXECUTABLE",
      );
      const acousticModel = requiredEnvironmentVariable(
        "MVL_MFA_ACOUSTIC_MODEL",
      );
      const dictionaryModel = requiredEnvironmentVariable(
        "MVL_MFA_DICTIONARY_MODEL",
      );
      const g2pModel = requiredEnvironmentVariable("MVL_MFA_G2P_MODEL");
      const audioPath = requiredEnvironmentVariable(
        "MVL_MFA_INTEGRATION_AUDIO",
      );
      const transcriptPath = requiredEnvironmentVariable(
        "MVL_MFA_INTEGRATION_TRANSCRIPT",
      );
      const canonicalInput = integrationCanonicalInput({
        transcript: await readFile(transcriptPath, "utf8"),
        dictionary: await readFile(dictionaryModel, "utf8"),
      });
      const directory = await mkdtemp(
        path.join(tmpdir(), "mvl-c5-17-real-mfa-"),
      );
      temporaryDirectories.push(directory);
      const capability = verifyMfaRuntimeCapability(
        JSON.parse(await readFile(runtimeManifest, "utf8")) as unknown,
      );
      const outputPath = path.join(
        directory,
        capability.commandCapabilities.selectedOutputFormat === "json"
          ? "alignment.json"
          : "alignment.TextGrid",
      );
      const result = await defaultMfaAlignmentExecutor({
        attemptId: "real-integration-attempt",
        componentId: "real-integration-component",
        cueId: "real-integration-cue",
        windowType: "narrow",
        windowAudioPath: audioPath,
        transcriptPath,
        outputPath,
        temporaryDirectory: path.join(directory, "mfa-temp"),
        mediaOffsetSeconds: 0,
        ...canonicalInput,
        capability,
        mfaExecutable,
        pythonExecutable,
        acousticModel,
        dictionaryModel,
        g2pModel,
        runner: new NodeProcessRunner(),
        parserHelperPath: path.resolve("scripts/parse-mfa-output.py"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.failure).toBeNull();
      expect(result.parsed?.wordAlignments.length).toBeGreaterThan(0);
      expect(result.parsed?.phoneAlignments.length).toBeGreaterThan(0);
      expect(result.parsed).toMatchObject({
        canonicalUnitCoverageRatio: 1,
        alignedWordCoverageRatio: 1,
        pronunciationUnitCoverageRatio: 1,
        expectedPhoneCoverageRatio: 1,
        expectedPhoneCount: canonicalInput.expectedPhones.length,
        alignedExpectedPhoneCount: canonicalInput.expectedPhones.length,
        unresolvedMappingCount: 0,
        ambiguousMappingCount: 0,
      });
      expect(
        result.parsed?.phoneAlignments.map((phone) => phone.label),
      ).toEqual(canonicalInput.expectedPhones);
      expect(
        [
          ...new Set(
            result.parsed?.wordAlignments.flatMap(
              (word) => word.expectedUnitIds,
            ),
          ),
        ].sort(),
      ).toEqual([...canonicalInput.expectedUnitIds].sort());
      expect(result.parsed?.wordAlignments.every((word) => !word.oov)).toBe(
        true,
      );
      console.info("REAL_MFA_TEST_RESULT", {
        wordCount: result.parsed?.wordAlignments.length,
        phoneCount: result.parsed?.phoneAlignments.length,
        canonicalUnitCoverageRatio: result.parsed?.canonicalUnitCoverageRatio,
        expectedPhoneCoverageRatio: result.parsed?.expectedPhoneCoverageRatio,
        unresolvedMappingCount: result.parsed?.unresolvedMappingCount,
        ambiguousMappingCount: result.parsed?.ambiguousMappingCount,
      });
    });
  },
);
