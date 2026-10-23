import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import * as shared from "@mvl/shared";
import {
  c60114AcceptanceSummarySchema,
  c60114AcceptanceShareableSchema,
} from "../packages/shared/src/c6-0-1-14-acceptance-schemas.js";
import {
  buildC60114Acceptance,
  auditC60114AcceptanceProbes,
  validateC60114Runs,
  c60114CanonicalExportPaths,
  type C60114AcceptanceSnapshot,
  type C60114AcceptanceProbeBundle,
} from "../scripts/validate-c6-0-1-14-runs.js";
import {
  buildC60114Policy,
  c60114ArtifactHeader,
} from "../packages/video-subtitler/src/review/c60114-policy.js";
import {
  executeC60114ProbePlan,
  c60114ProbeSemanticHash,
  type C60114ProbeRuntimeAdapter,
} from "../packages/video-subtitler/src/review/missing-dialogue-local-probe.js";
import { evaluateC60114PlaybackCoverage } from "../packages/video-subtitler/src/review/playback-grounded-coverage-evaluator.js";
import { c60113HashPayload } from "../packages/video-subtitler/src/review/c60113-region-features.js";
import { machineQualitySemanticHash as hash } from "../packages/video-subtitler/src/machine-quality/evidence-correlation.js";

const digest = "a".repeat(64),
  otherDigest = "b".repeat(64),
  generatedAt = "2026-01-01T00:00:00.000Z";
const policy = buildC60114Policy();
const source: shared.C60114SourceIdentity = {
  sourceMediaSha256: digest,
  durationSeconds: 100,
  sampleRate: 48000,
  audioStreamIndex: 1,
  audioTimebase: "1/48000",
  sourceTimebase: "SOURCE_GLOBAL_SECONDS",
};
const interval = { start: 10, end: 12 };
describe("C60114 package-declared canonical exports", () => {
  const packagePath = "subtitle-fixture/subtitle-package.needs-review.json";
  const exports = {
    ass: "./subtitle-fixture.ass",
    srt: "./subtitle-fixture.srt",
    vtt: "./subtitle-fixture.vtt",
  };
  const files = ["ass", "srt", "vtt"].flatMap((extension) => [
    `subtitle-fixture/subtitle-fixture.${extension}`,
    `subtitle-fixture/subtitle-fixture.best-effort.${extension}`,
  ]);
  it("does not treat best-effort siblings as additional canonical exports", () => {
    expect(c60114CanonicalExportPaths(files, packagePath, exports)).toEqual({
      ASS: files[0],
      SRT: files[2],
      VTT: files[4],
    });
  });
  it("requires every declared export to be frozen", () => {
    expect(() =>
      c60114CanonicalExportPaths(files.slice(1), packagePath, exports),
    ).toThrow("CANONICAL_REFERENCE_NOT_FROZEN");
  });
  it("rejects package export traversal", () => {
    expect(() =>
      c60114CanonicalExportPaths(files, packagePath, {
        ...exports,
        ass: "../subtitle-fixture.ass",
      }),
    ).toThrow("CANONICAL_REFERENCE_UNSAFE");
  });
});
const signed = <T extends object>(core: T) => ({
  ...core,
  semanticHash: hash(core),
});
const required = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error("SYNTHETIC_ROW_MISSING");
  return value;
};
let temporaryDirectory: string,
  freshArtifact: shared.C60114ProbeExecution,
  replayArtifact: shared.C60114ProbeExecution;

beforeAll(async () => {
  temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "c60114-acceptance-"),
  );
  const runtimes = (["whisper-large-v3", "reazonspeech-k2-v2"] as const).map(
    (provider) => ({
      provider,
      modelId: provider,
      modelRevision: digest,
      modelIdentityHash: digest,
      runtimeIdentityHash: hash(provider),
      modelFileHashes: { syntheticModel: digest },
      manifestSha256: digest,
      binarySha256: digest,
      workerSha256: null,
      precision: "SYNTHETIC",
      device: "SYNTHETIC",
      verified: true as const,
    }),
  );
  const adapter = (replay = false): C60114ProbeRuntimeAdapter => ({
    identities: runtimes,
    extract: () =>
      Promise.resolve({
        audioPath: "synthetic.wav",
        audioSha256: otherDigest,
        sampleCount: 33600,
      }),
    transcribe: () => {
      if (replay) throw new Error("REPLAY_MUST_NOT_EXECUTE_MODEL");
      return Promise.resolve({
        status: "SUCCESS",
        text: "短い声",
        rawOutput: { syntheticText: "短い声" },
        tokens: [],
        decoder: {
          averageLogProbability: null,
          noSpeechProbability: null,
          temperature: null,
        },
        warnings: [],
        wallClockSeconds: 0,
      });
    },
    counts: () => ({
      modelLoadCount: replay ? 0 : 2,
      processStartCount: replay ? 0 : 2,
      perProvider: {
        "whisper-large-v3": {
          modelLoadCount: replay ? 0 : 1,
          processStartCount: replay ? 0 : 1,
        },
        "reazonspeech-k2-v2": {
          modelLoadCount: replay ? 0 : 1,
          processStartCount: replay ? 0 : 1,
        },
      },
    }),
    close: () => Promise.resolve(),
  });
  const target: shared.C60114ProbeTarget = {
    targetId: "target",
    sourceIslandId: "island",
    sourceInterval: interval,
    itemIds: ["item"],
    evidenceIds: ["evidence"],
    rootLineageIds: ["root"],
    correlationGroups: ["root"],
    priorityClass: "UNCOVERED_VERIFIED_SPEECH",
    speechPositive: true,
    validTimebase: true,
    cueCoveredRatio: 0,
    targetCoveredRatio: 0,
    strongContradiction: false,
    reliableLocalizedLexical: false,
    neighborCueIntervals: [],
    reasons: ["SYNTHETIC"],
  };
  const input = {
    targets: [target],
    sourceIdentity: source,
    policy,
    policyHash: policy.semanticHash,
    selectionHash: digest,
    generatedAt,
    cacheDirectory: temporaryDirectory,
  };
  freshArtifact = await executeC60114ProbePlan({
    ...input,
    mode: "fresh",
    adapter: adapter(),
  });
  replayArtifact = await executeC60114ProbePlan({
    ...input,
    mode: "exact-cache-only",
    adapter: adapter(true),
  });
});
afterAll(async () => {
  if (temporaryDirectory)
    await rm(temporaryDirectory, { recursive: true, force: true });
});

function probeBundle(
  artifact: shared.C60114ProbeExecution,
): C60114AcceptanceProbeBundle {
  const copy = structuredClone(artifact);
  return {
    artifact: copy,
    manifestVerified: true,
    verifiedCacheRecords: new Map(
      copy.requests.map((row) => [row.requestId, structuredClone(row)]),
    ),
  };
}
function snapshot(): C60114AcceptanceSnapshot {
  const header = c60114ArtifactHeader(policy, source);
  const audio = shared.c60114ReviewAudioManifestV3Schema.parse(
    signed({
      ...header,
      artifactType: "machine-review-audio-manifest-v3",
      regionsHash: digest,
      deliverySubsystemVersion: "C6.0.1.12_REVIEW_AUDIO",
      extractionPolicy: "existing-deterministic-pcm16k-source-extraction",
      audio: [
        signed({
          audioId: "audio",
          relativePath: "audio/synthetic.wav",
          sourceMediaSha256: digest,
          sourceIdentity: source,
          sourceInterval: interval,
          requestedInterval: interval,
          sampleRate: 16000,
          channels: 1,
          bitDepth: 16,
          codec: "pcm_s16le",
          frameCount: 32000,
          actualDuration: 2,
          sha256: otherDigest,
          playable: true,
          hashVerified: true,
          physicalMetadataVerified: true,
          coveredReviewTargetIds: ["target"],
          regionIds: ["region"],
        }),
      ],
      targetCoverageChecks: [
        {
          reviewTargetId: "target",
          mandatoryForAudio: true,
          coverageRatio: 1,
          fullyCovered: true,
        },
      ],
      summary: {
        plannedAudioCount: 1,
        actualAudioCount: 1,
        extractionFailureCount: 0,
        playableCount: 1,
        hashVerifiedCount: 1,
        mandatoryTargetCount: 1,
        coveredMandatoryTargetCount: 1,
        allTargetCount: 1,
        coveredTargetCount: 1,
        targetCoveragePassed: true,
        clipSumSeconds: 2,
        networkUsed: false,
      },
    }),
  );
  const segment = signed({
    playbackSegmentId: "segment",
    audioId: "audio",
    sourceInterval: interval,
    audioLocalInterval: { start: 0, end: 2 },
    reviewTargetIds: ["target"],
    reviewItemIds: ["item"],
    regionIds: ["region"],
    sourceIdentity: source,
  });
  const plans = [
    ...[10, 20, 30, 40, 50].map((n) => ({
      planId: `UNIQUE_AUDIO_${n}_PERCENT`,
      budgetSeconds: n,
    })),
    { planId: "ALL_MANDATORY", budgetSeconds: null },
    { planId: "FULL_QUEUE", budgetSeconds: null },
  ].map((row) =>
    signed({
      ...row,
      regionIds: ["region"],
      reviewTargetIds: ["target"],
      reviewItemIds: ["item"],
      playbackSegmentIds: ["segment"],
      audioIds: ["audio"],
      physicalAudioSha256s: [otherDigest],
      sourceIntervalUnion: [interval],
      uniqueAudioSeconds: 2,
      rankerStatus: "RANKER_NOT_RECALIBRATED_IN_C6_0_1_14",
    }),
  );
  const playback = shared.c60114PlaybackTimelineV2Schema.parse(
    signed({
      ...header,
      artifactType: "machine-review-playback-timeline-v2",
      audioManifestHash: audio.semanticHash,
      regionsHash: digest,
      targetsHash: digest,
      segments: [segment],
      plans,
      targetCoverageChecks: audio.targetCoverageChecks,
      summary: {
        segmentCount: 1,
        audioMappingCount: 1,
        targetMappingCount: 1,
        mandatoryTargetCount: 1,
        coveredMandatoryTargetCount: 1,
        targetCoveragePassed: true,
        fullQueueUniqueAudioSeconds: 2,
      },
    }),
  );
  return {
    sourceIdentity: source,
    policyHash: policy.semanticHash,
    selectionHash: digest,
    probeSemanticHash: freshArtifact.semanticHash,
    freezeByteSha256: digest,
    freezeVerified: true,
    strictDeliveryGraphVerified: true,
    canonicalByteHashes: {
      ASS: digest,
      SRT: digest,
      VTT: digest,
      PACKAGE: digest,
    },
    machineSemanticHashes: { synthetic: digest },
    playback,
    audio,
  };
}
function evaluationInput(
  final: C60114AcceptanceSnapshot,
): shared.C60114PlaybackCoverageInput {
  return {
    sourceIdentity: source,
    generatedAt,
    errorComponents: [
      {
        errorComponentId: "synthetic-error",
        sourceIdentity: source,
        labels: ["MISSING_DIALOGUE", "HALLUCINATION"],
        defectIds: ["synthetic-defect"],
        alignmentIds: ["alignment"],
        coveredItemIds: ["item"],
        coveredRegionIds: ["region"],
        errorIntervals: [interval],
        mappingStatus: "RESOLVED",
        mappingReasons: [],
      },
    ],
    items: [{ reviewItemId: "item", sourceIdentity: source }],
    targets: [
      {
        reviewTargetId: "target",
        parentReviewItemId: "item",
        sourceInterval: interval,
        mandatoryForAudio: true,
        sourceIdentity: source,
      },
    ],
    regions: [
      {
        regionId: "region",
        reviewTargetIds: ["target"],
        reviewItemIds: ["item"],
        sourceIntervals: [interval],
        contextIntervals: [interval],
        sourceIdentity: source,
      },
    ],
    physicalAudio: final.audio.audio,
    playbackSegments: final.playback.segments,
    plans: final.playback.plans.map((row) => ({
      planId: row.planId,
      budgetSeconds: row.budgetSeconds,
      regionIds: row.regionIds,
      reviewTargetIds: row.reviewTargetIds,
      playbackSegmentIds: row.playbackSegmentIds,
    })),
    speechIslands: [
      {
        islandId: "island",
        sourceInterval: interval,
        speechPositive: true,
        localizationStatus: "VERIFIED",
        sourceIdentity: source,
      },
    ],
    lexicalEvidence: ["one", "two"].map((id) => ({
      evidenceId: id,
      sourceInterval: interval,
      reliableLocalizedLexical: true,
      mappingStatus: "VERIFIED",
      providerFamily: id,
      rootLineageIds: [id],
      correlationGroup: id,
      sourceIdentity: source,
    })),
    orphans: [],
    engineeringGates: {
      engineeringPassed: true,
      baselineParityPassed: true,
      runtimeGoldInputCount: 0,
      canonicalMutationCount: 0,
      machineDraftMutationCount: 0,
      sourceMutationCount: 0,
      goldMutationCount: 0,
      machineFreezeVerified: true,
    },
  };
}
function fixture(): Parameters<typeof buildC60114Acceptance>[0] {
  const finalA = snapshot();
  return {
    finalA,
    finalB: structuredClone(finalA),
    fresh: probeBundle(freshArtifact),
    replay: probeBundle(replayArtifact),
    generatedAt,
    codeValidationByteSha256: digest,
    codeLogsVerified: true,
    codeValidation: {
      schemaVersion: "1.0.0",
      artifactType: "c6-0-1-14-code-validation",
      generatedAt,
      nodeVersion: "v24.0.0",
      packageManager: "npm@11",
      results: [
        "typecheck",
        "lint",
        "format-check",
        "build",
        "unit",
        "e2e",
        "c60114-targeted",
      ].map((id) => ({
        id,
        command: ["synthetic", id],
        exitCode: 0,
        passed: true,
        elapsedSeconds: 0,
        logRelativePath: `${id}.log`,
        logSha256: digest,
        testSummary: [],
      })),
      passed: true,
      realAsrExecutedByValidation: false,
      goldEvaluationExecutedByValidation: false,
      rankerTrainingExecutedByValidation: false,
    },
    playbackEvaluation: evaluateC60114PlaybackCoverage(evaluationInput(finalA)),
    manualChecks: {
      schemaVersion: "1.0.0",
      artifactType: "c6-0-1-14-acceptance-manual-checks",
      codeValidationByteSha256: digest,
      datasetSpecificHardcoding: {
        status: "PASS",
        method: "EXPLICIT_MANUAL_CODE_REVIEW",
        evidenceSha256: digest,
      },
    },
  };
}

describe("C60114 final acceptance (synthetic only, no real models or evaluation files)", () => {
  it("separates successful engineering and playback evidence from production authorization", () => {
    const input = fixture(),
      before = hash(input.playbackEvaluation);
    const result = buildC60114Acceptance(input);
    expect(result.summary.engineering.status).toBe("PASS");
    expect(result.summary.evaluation.status).toBe("PASS");
    expect(result.summary.route).toMatchObject({
      decision: "GO_C6_0_1_15_REGION_RANKER_RECALIBRATION",
      productionStatus: "needs-review",
      finalizationMethod: "none",
      machineOnlyReleaseAuthorized: false,
      c602Status: "HOLD",
      humanTrialStarted: false,
    });
    expect(hash(input.playbackEvaluation)).toBe(before);
    expect(
      c60114AcceptanceSummarySchema.safeParse(result.summary).success,
    ).toBe(true);
  });
  it("never treats 62 persisted results and two lost outputs as 64 successful results", () => {
    const bundle = probeBundle(freshArtifact),
      first = required(bundle.artifact.requests[0]);
    bundle.artifact.requests = Array.from({ length: 64 }, (_, i) => {
      const row = {
        ...structuredClone(first),
        requestId: `request-${i}`,
        cacheKey: hash(i),
        status: i < 62 ? ("SUCCESS" as const) : ("EXTRACTION_ERROR" as const),
        execution:
          i < 62 ? ("FRESH_INFERENCE" as const) : ("NOT_EXECUTED" as const),
        rawOutput: i < 62 ? first.rawOutput : null,
        rawOutputHash: i < 62 ? first.rawOutputHash : null,
      };
      return { ...row, semanticHash: c60114ProbeSemanticHash(row) };
    });
    bundle.artifact.accounting.plannedRequests = 64;
    bundle.artifact.accounting.actualFreshInferences = 64;
    bundle.artifact.semanticHash = c60114ProbeSemanticHash(bundle.artifact);
    bundle.verifiedCacheRecords = new Map(
      bundle.artifact.requests.map((row) => [row.requestId, row]),
    );
    bundle.historicalLostSuccessfulResults = 2;
    const audit = auditC60114AcceptanceProbes(bundle);
    expect(audit).toMatchObject({
      consumedFreshInferences: 64,
      persistedSuccessfulResults: 62,
      historicalLostSuccessfulResults: 2,
      unpersistedPlannedRequests: 2,
      passed: false,
    });
  });
  it("requires raw output hash and actual exact cache proof for each SUCCESS", () => {
    const input = fixture();
    input.fresh.verifiedCacheRecords = new Map();
    expect(buildC60114Acceptance(input).summary.engineering.status).toBe(
      "BLOCKED",
    );
    const bundle = probeBundle(freshArtifact),
      row = required(bundle.artifact.requests[0]);
    row.rawOutputHash = null;
    expect(auditC60114AcceptanceProbes(bundle).persistencePassed).toBe(false);
  });
  it("rejects cache replay with any model load or incomplete cache hits", () => {
    const bundle = probeBundle(replayArtifact);
    bundle.artifact.accounting.modelLoadCount = 1;
    expect(auditC60114AcceptanceProbes(bundle).passed).toBe(false);
    bundle.artifact.accounting.modelLoadCount = 0;
    bundle.artifact.accounting.cacheHits--;
    expect(auditC60114AcceptanceProbes(bundle).passed).toBe(false);
  });
  it("requires explicit budget-exception verification and preserves historical loss", () => {
    const bundle = probeBundle(freshArtifact);
    const templates = bundle.artifact.requests;
    bundle.artifact.requests = Array.from({ length: 64 }, (_, index) => {
      const row = {
        ...structuredClone(required(templates[index % 2])),
        requestId: `request-${index}`,
        cacheKey: hash(index),
        targetId: `target-${Math.floor((index < 48 ? index : index - 48) / 2)}`,
        windowType:
          index < 48 ? ("CORE_EXACT" as const) : ("CORE_CONTEXT" as const),
      };
      return { ...row, semanticHash: c60114ProbeSemanticHash(row) };
    });
    bundle.artifact.accounting.plannedRequests = 64;
    bundle.artifact.accounting.selectedTargets = 24;
    bundle.artifact.accounting.contextTargets = 8;
    bundle.artifact.accounting.actualFreshInferences = 66;
    bundle.artifact.accounting.inferenceAttemptCount = 66;
    bundle.artifact.accounting.perProvider[
      "whisper-large-v3"
    ].actualFreshInferences = 33;
    bundle.artifact.accounting.perProvider[
      "reazonspeech-k2-v2"
    ].actualFreshInferences = 33;
    bundle.artifact.accounting.perProvider[
      "whisper-large-v3"
    ].inferenceAttemptCount = 33;
    bundle.artifact.accounting.perProvider[
      "reazonspeech-k2-v2"
    ].inferenceAttemptCount = 33;
    bundle.artifact.budgetException = signed({
      schemaVersion: "1.0.0" as const,
      artifactType: "c6-0-1-14-probe-budget-exception" as const,
      authorizationId: "synthetic-authorization",
      authorizationHash: digest,
      authorizedBy: "USER_EXPLICIT" as const,
      authorizedAt: generatedAt,
      sourceIdentityHash: hash(source),
      policyHash: policy.semanticHash,
      selectionHash: digest,
      originalProbeByteHash: digest,
      lossAuditByteHash: digest,
      previousConsumedInferences: 64,
      previousPersistedSuccessCount: 62,
      previousLostRawResultCount: 2,
      maxAdditionalInferences: 2,
      maxCumulativeInferences: 66,
      affectedRequestIds: bundle.artifact.requests
        .slice(-2)
        .map((row) => row.requestId),
    });
    bundle.historicalLostSuccessfulResults = 2;
    bundle.artifact.semanticHash = c60114ProbeSemanticHash(bundle.artifact);
    bundle.verifiedCacheRecords = new Map(
      bundle.artifact.requests.map((row) => [row.requestId, row]),
    );
    expect(auditC60114AcceptanceProbes(bundle).budgetPassed).toBe(false);
    bundle.authorizationVerified = true;
    expect(auditC60114AcceptanceProbes(bundle)).toMatchObject({
      passed: true,
      plannedRequests: 64,
      consumedFreshInferences: 66,
      persistedResultCount: 64,
      historicalLostSuccessfulResults: 2,
      authorizedAdditionalInferences: 2,
    });
    expect(policy.probes.maxRequests).toBe(64);
  });
  it("counts a persisted empty provider output as execution evidence, never lexical success", () => {
    const bundle = probeBundle(freshArtifact),
      row = required(bundle.artifact.requests[0]);
    row.status = "EMPTY_OUTPUT";
    row.rawText = "";
    row.rawOutput = { text: "" };
    row.rawOutputHash = hash(row.rawOutput);
    row.semanticHash = c60114ProbeSemanticHash(row);
    bundle.artifact.accounting.emptyOutputs = 1;
    bundle.artifact.accounting.perProvider[row.provider].emptyOutputs = 1;
    bundle.artifact.semanticHash = c60114ProbeSemanticHash(bundle.artifact);
    bundle.verifiedCacheRecords = new Map(
      bundle.artifact.requests.map((request) => [request.requestId, request]),
    );
    expect(auditC60114AcceptanceProbes(bundle)).toMatchObject({
      passed: true,
      persistedResultCount: 2,
      persistedSuccessfulResults: 1,
      persistedEmptyOutputResults: 1,
    });
  });
  it("blocks engineering when an export, package, or machine semantic hash differs", () => {
    for (const field of ["ASS", "SRT", "VTT", "PACKAGE"] as const) {
      const input = fixture();
      input.finalB.canonicalByteHashes[field] = otherDigest;
      expect(buildC60114Acceptance(input).summary.route.decision).toBe(
        "HOLD_FOR_ENGINEERING_REPAIR",
      );
    }
    const input = fixture();
    input.finalB.machineSemanticHashes.synthetic = otherDigest;
    expect(buildC60114Acceptance(input).summary.engineering.status).toBe(
      "BLOCKED",
    );
  });
  it("reports missing manual dataset-hardcoding audit rather than assuming pass", () => {
    const input = fixture();
    delete input.manualChecks;
    const result = buildC60114Acceptance(input);
    expect(
      result.summary.engineering.checks.find(
        (row) => row.id === "DATASET_HARDCODING_AUDIT",
      )?.status,
    ).toBe("NOT_CHECKED");
    expect(result.summary.engineering.status).toBe("BLOCKED");
  });
  it("keeps perfect ID lineage distinct from absent direct playback coverage", () => {
    const input = fixture(),
      evaluation = evaluationInput(input.finalA);
    required(evaluation.errorComponents[0]).errorIntervals = [
      { start: 50, end: 52 },
    ];
    input.playbackEvaluation = evaluateC60114PlaybackCoverage(evaluation);
    const result = buildC60114Acceptance(input);
    expect(result.summary.missing.fullQueue).toMatchObject({
      audibleRecall: 0,
      lineageOnlyCount: 1,
    });
    expect(result.summary.route.decision).toBe(
      "HOLD_FOR_MACHINE_SPEECH_DETECTION_REPAIR",
    );
  });
  it("fails a rehashed evaluation whose claimed audible recall disagrees with physical playback", () => {
    const input = fixture(),
      evaluation = evaluateC60114PlaybackCoverage(
        evaluationInput(input.finalA),
      );
    const row = required(required(evaluation.budgets[0]).componentCoverage[0]);
    row.layers.audibleReviewCoverage.overlapSeconds = 1;
    row.layers.audibleReviewCoverage.coverageRatio = 0.5;
    evaluation.semanticHash = c60113HashPayload(evaluation);
    input.playbackEvaluation = evaluation;
    expect(buildC60114Acceptance(input).summary.evaluation.status).toBe(
      "BLOCKED",
    );
  });
  it("does not promote speech activity to localized missing lexical evidence", () => {
    const input = fixture(),
      evaluation = evaluationInput(input.finalA);
    evaluation.lexicalEvidence = [];
    input.playbackEvaluation = evaluateC60114PlaybackCoverage(evaluation);
    expect(buildC60114Acceptance(input).summary.route.decision).toBe(
      "GO_C6_0_1_15_REGION_RANKER_RECALIBRATION",
    );
  });
  it("rejects mismatched source identity and stale evaluation hashes", () => {
    const input = fixture();
    input.finalB.sourceIdentity = { ...source, audioStreamIndex: 2 };
    expect(() => buildC60114Acceptance(input)).toThrow(
      "SOURCE_IDENTITY_MISMATCH",
    );
    const other = fixture(),
      evaluation = shared.c60114PlaybackCoverageEvaluationSchema.parse(
        other.playbackEvaluation,
      );
    evaluation.semanticHash = otherDigest;
    other.playbackEvaluation = evaluation;
    expect(() => buildC60114Acceptance(other)).toThrow(
      "SEMANTIC_HASH_MISMATCH",
    );
  });
  it("exports only strict aggregate fields and no component identities, text or paths", () => {
    const result = buildC60114Acceptance(fixture()),
      serialized = JSON.stringify(result.shareable);
    for (const forbidden of [
      "短い声",
      "synthetic-error",
      "synthetic-defect",
      "synthetic.wav",
      "requestId",
      "sourceIdentity",
      "inputHashes",
      "/Users/",
      "sessionId",
      "errorIntervals",
    ])
      expect(serialized).not.toContain(forbidden);
    expect(
      c60114AcceptanceShareableSchema.safeParse({
        ...result.shareable,
        rawText: "forbidden",
      }).success,
    ).toBe(false);
  });
  it("requires a genuinely new output directory before reading any input", async () => {
    await expect(
      validateC60114Runs({
        finalA: "unread",
        finalB: "unread",
        freshProbes: "unread",
        cacheReplayProbes: "unread",
        codeValidation: "unread",
        playbackEvaluation: "unread",
        source: "unread",
        outputDirectory: temporaryDirectory,
      }),
    ).rejects.toMatchObject({ code: "EEXIST" });
  });
});
