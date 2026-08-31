import { describe, expect, it } from "vitest";
import {
  c60114CoverageProjectionsSchema,
  c60114ProbeExecutionSchema,
  c60114ProbeRequestSchema,
  c60114ReviewAudioManifestV3Schema,
  type C60114ProbeRuntime,
  type C60114ProbeTarget,
  type C60114SourceIdentity,
} from "@mvl/shared";
import { machineQualitySemanticHash } from "../packages/video-subtitler/src/machine-quality/evidence-correlation.js";
import { buildC60112ReviewPolicy } from "../packages/video-subtitler/src/review/c60112-policy.js";
import {
  buildC60114Policy,
  c60114ArtifactHeader,
  c60114Coverage,
} from "../packages/video-subtitler/src/review/c60114-policy.js";
import { buildC60112ReviewItems } from "../packages/video-subtitler/src/review/review-item-builder.js";
import { buildC60113MachineReview } from "../packages/video-subtitler/src/review/structured-review-priority.js";
import { c60113Observation } from "../packages/video-subtitler/src/review/review-evidence-family-graph.js";
import {
  buildC60114SourceGlobalSpeechIslands,
  createC60114SourceEvidence,
} from "../packages/video-subtitler/src/review/source-global-speech-islands.js";
import { buildC60114ReviewTargetIntervalsV2 } from "../packages/video-subtitler/src/review/review-target-intervals-v2.js";
import { buildC60114OrphanSpeechSweep } from "../packages/video-subtitler/src/review/orphan-speech-sweep.js";
import { selectC60114MissingDialogueProbes } from "../packages/video-subtitler/src/review/missing-dialogue-probe-selection.js";
import {
  buildC60114ReviewItems,
  buildC60114R3EvidenceProjection,
} from "../packages/video-subtitler/src/review/review-items-v4.js";
import { clusterC60114ReviewRegions } from "../packages/video-subtitler/src/review/review-region-clustering-v3.js";
import { buildC60114PlaybackTimeline } from "../packages/video-subtitler/src/review/review-playback-timeline-v2.js";
import { buildLocalizedMissingLexicalEvidence } from "../packages/video-subtitler/src/review/localized-missing-lexical-evidence.js";
import { buildMissingSpeechEvidenceV3 } from "../packages/video-subtitler/src/review/missing-speech-evidence-v3.js";
import { c60114ProbeSemanticHash } from "../packages/video-subtitler/src/review/missing-dialogue-local-probe.js";
import { evaluateC60114PlaybackCoverage } from "../packages/video-subtitler/src/review/playback-grounded-coverage-evaluator.js";
import {
  buildC60114CoverageProjections,
  type C60114CoverageProjectionInput,
} from "../scripts/lib/c60114-coverage-projection.js";

const hash = "a".repeat(64);
const policy = buildC60114Policy();
const sourceIdentity: C60114SourceIdentity = {
  sourceMediaSha256: hash,
  durationSeconds: 100,
  sampleRate: 48000,
  audioStreamIndex: 1,
  audioTimebase: "1/48000",
  sourceTimebase: "SOURCE_GLOBAL_SECONDS",
};
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("SYNTHETIC_FIXTURE_ROW_MISSING");
  return value;
}
function sign<T extends object>(value: T): T & { semanticHash: string } {
  return {
    ...value,
    semanticHash: machineQualitySemanticHash(
      Object.fromEntries(
        Object.entries(value).filter(([k]) => k !== "semanticHash"),
      ),
    ),
  };
}
function runtime(provider: C60114ProbeRuntime["provider"]): C60114ProbeRuntime {
  return {
    provider,
    modelId: provider,
    modelRevision: hash,
    modelIdentityHash: hash,
    runtimeIdentityHash: hash,
    modelFileHashes: { synthetic: hash },
    manifestSha256: hash,
    binarySha256: hash,
    workerSha256: null,
    precision: "synthetic",
    device: "synthetic",
    verified: true,
  };
}
function request(
  target: C60114ProbeTarget,
  provider: C60114ProbeRuntime["provider"],
  selectionHash: string,
) {
  const row = {
    requestId: `synthetic-${provider}-${target.targetId}`,
    targetId: target.targetId,
    provider,
    windowType: "CORE_EXACT",
    coreInterval: target.sourceInterval,
    extractionInterval: target.sourceInterval,
    sourceMediaSha256: hash,
    sourceIdentityHash: machineQualitySemanticHash(sourceIdentity),
    policyHash: policy.semanticHash,
    selectionHash,
    audioSha256: hash,
    sampleCount: Math.round(
      (target.sourceInterval.end - target.sourceInterval.start) * 16000,
    ),
    extractionIdentityHash: hash,
    cacheKey: hash,
    runtimeIdentityHash: hash,
    modelIdentityHash: hash,
    prompt: "",
    vadEnabled: false,
    status: "SUCCESS",
    execution: "VERIFIED_EXACT_REPLAY",
    rawText: "合成発話",
    rawOutput: null,
    rawOutputHash: null,
    tokens: [],
    decoder: {
      averageLogProbability: null,
      noSpeechProbability: null,
      temperature: null,
    },
    localization: {
      status: "CORE_EXACT_ISLAND_LOCALIZED",
      localizedText: "合成発話",
      guardSeconds: 0,
      guardNeighborOverlapSeconds: 0,
      coreNeighborOverlapSeconds: 0,
      completeness: "WHOLE_EXACT_ISLAND",
      projectionTokenCount: 0,
      reasons: ["SYNTHETIC_ONLY"],
    },
    hallucinationRisk: 0,
    errorCode: null,
    warnings: [],
    wallClockSeconds: 0,
  };
  return c60114ProbeRequestSchema.parse({
    ...row,
    semanticHash: c60114ProbeSemanticHash(row),
  });
}

/** All evidence/audio metadata are synthetic. This fixture performs no IO or inference. */
function fixture(): C60114CoverageProjectionInput {
  const legacyItems = buildC60112ReviewItems({
    policy: buildC60112ReviewPolicy({
      policyFrozenAt: "1970-01-01T00:00:00.000Z",
    }),
    signals: [
      {
        reviewGroupId: "current",
        eventIds: ["current"],
        finalCueIds: ["cue"],
        itemTypes: ["TEXT_HALLUCINATION_RISK"],
        sourceInterval: { start: 5, end: 12 },
        coreInterval: { start: 5, end: 7 },
        currentText: "変更しないCURRENT",
        candidateIds: [],
        evidenceIds: [],
        reviewReasons: ["WHISPER_HALLUCINATION_SIGNAL"],
      },
      {
        reviewGroupId: "parent",
        eventIds: ["parent"],
        finalCueIds: [],
        itemTypes: ["MISSING_SPEECH_RISK"],
        sourceInterval: { start: 40, end: 60 },
        coreInterval: { start: 40, end: 42 },
        currentText: null,
        candidateIds: [],
        evidenceIds: ["wide-envelope"],
        reviewReasons: ["MISSING_DIALOGUE_SUSPECTED"],
      },
    ],
  }).items;
  const parent = required(
    legacyItems.find((i) => i.itemTypes.includes("MISSING_SPEECH_RISK")),
  );
  const finalCues = [{ id: "cue", start: 5, end: 12 }];
  const previous = buildC60113MachineReview({
    items: legacyItems,
    candidateBundles: [],
    sourceDurationSeconds: 100,
    expectedSourceMediaSha256: hash,
    finalCues,
    observations: [
      c60113Observation({
        evidenceId: "wide-envelope",
        rootLineageIds: ["wide-envelope"],
        family: "SPEECH_ACTIVITY",
        provider: "vad",
        correlationGroup: "wide-envelope",
        itemIds: [parent.reviewItemId],
        gapIds: [],
        sourceInterval: { start: 40, end: 60 },
        positiveRisk: true,
        evidenceAbsence: false,
        contradiction: false,
        strength: 0.9,
        validatedSourceGlobal: true,
        detailCode: "LEGACY_ENVELOPE_NOT_ATOMIC_SPEECH",
      }),
    ],
  });
  const speechIslands = buildC60114SourceGlobalSpeechIslands({
    sourceIdentity,
    policy,
    parentGaps: [
      {
        gapId: "gap",
        sourceInterval: { start: 40, end: 60 },
        itemIds: [parent.reviewItemId],
        searchEnvelopeOnly: true,
      },
      {
        gapId: "detached",
        sourceInterval: { start: 70, end: 80 },
        itemIds: [],
        searchEnvelopeOnly: true,
      },
    ],
    evidence: [
      { evidenceId: "child", start: 55, end: 57 },
      { evidenceId: "detached", start: 75, end: 77 },
      { evidenceId: "orphan-in-legacy-context", start: 3.5, end: 4.5 },
    ].map(({ evidenceId, start, end }) =>
      createC60114SourceEvidence({
        evidenceId,
        family: "MAPPED_VAD",
        sourceInterval: { start, end },
        mappingStatus: "VERIFIED",
        speechPositive: true,
        lexicalPositive: false,
        reliableLocalizedLexical: false,
        contradiction: false,
        strength: 0.9,
        rootLineageIds: [evidenceId],
        correlationGroup: evidenceId,
        providerFamily: "vad",
        artifactId: "synthetic",
        artifactSemanticHash: hash,
        sourceIdentityHash: machineQualitySemanticHash(sourceIdentity),
        sceneIds: [],
        speakerIds: [],
        reasons: ["SYNTHETIC_ATOMIC_SPEECH"],
      }),
    ),
  });
  const beforeOrphans = buildC60114ReviewTargetIntervalsV2({
    sourceIdentity,
    policy,
    items: legacyItems,
    finalCues,
    speechIslands,
  });
  const orphanSweep = buildC60114OrphanSpeechSweep({
    sourceIdentity,
    policy,
    speechIslands,
    finalCues,
    reviewTargets: beforeOrphans,
  });
  let reviewTargets = buildC60114ReviewTargetIntervalsV2({
    sourceIdentity,
    policy,
    items: legacyItems,
    finalCues,
    speechIslands,
    orphanSweep,
  });
  const selection = selectC60114MissingDialogueProbes({
    sourceIdentity,
    policy,
    speechIslands,
    orphanSweep,
    finalCues,
  });
  const requests = selection.targets.flatMap((target) => [
    request(target, "whisper-large-v3", selection.semanticHash),
    request(target, "reazonspeech-k2-v2", selection.semanticHash),
  ]);
  const zero = {
    inferenceAttemptCount: 0,
    actualFreshInferences: 0,
    cacheHits: selection.targets.length,
    failedRequests: 0,
    emptyOutputs: 0,
    modelLoadCount: 0,
    processStartCount: 0,
  };
  const rawProbes = {
    ...c60114ArtifactHeader(policy, sourceIdentity),
    artifactType: "missing-dialogue-local-probe",
    generatedAt: "1970-01-01T00:00:00.000Z",
    selectionHash: selection.semanticHash,
    sourceIdentityHash: machineQualitySemanticHash(sourceIdentity),
    cacheNamespace: "c6.0.1.14-missing-local-probes-v1",
    mode: "exact-cache-only",
    runtime: [runtime("whisper-large-v3"), runtime("reazonspeech-k2-v2")],
    requests,
    contextSelection: [],
    accounting: {
      selectedTargets: selection.targets.length,
      contextTargets: 0,
      plannedRequests: requests.length,
      actualFreshInferences: 0,
      inferenceAttemptCount: 0,
      cacheHits: requests.length,
      cacheMisses: 0,
      extractionCount: 0,
      extractionFailures: 0,
      modelLoadCount: 0,
      processStartCount: 0,
      failedRequests: 0,
      emptyOutputs: 0,
      fullMediaRequests: 0,
      sourceMutationCount: 0,
      promptLeakageCount: 0,
      canonicalMutationCount: 0,
      perProvider: { "whisper-large-v3": zero, "reazonspeech-k2-v2": zero },
    },
  };
  const probes = c60114ProbeExecutionSchema.parse({
    ...rawProbes,
    semanticHash: c60114ProbeSemanticHash(rawProbes),
  });
  const lexical = buildLocalizedMissingLexicalEvidence({
    targets: selection.targets,
    probes,
    readingUnavailableReason: "SYNTHETIC_NO_RUNTIME",
  });
  const missingEvidenceV3 = buildMissingSpeechEvidenceV3({
    sourceIdentity,
    policyHash: policy.semanticHash,
    targets: selection.targets,
    lexicalEvidence: lexical,
    speechIslands,
    orphanSweep,
  });
  const itemInput = {
    sourceIdentity,
    policy,
    previousItems: previous.itemsV3,
    targets: reviewTargets,
    speechIslands,
    orphanSweep,
    missingEvidenceV3,
  };
  let items = buildC60114ReviewItems(itemInput);
  reviewTargets = sign({
    ...reviewTargets,
    targets: reviewTargets.targets.map((target) =>
      sign({
        ...target,
        mandatoryForAudio:
          required(
            items.items.find(
              (i) => i.reviewItemId === target.parentReviewItemId,
            ),
          ).requiredLevel === "REQUIRED",
      }),
    ),
  });
  items = buildC60114ReviewItems({ ...itemInput, targets: reviewTargets });
  const families = buildC60114R3EvidenceProjection({
    previousEvidenceFamilies: previous.evidenceFamilies,
    targets: reviewTargets,
    speechIslands,
  });
  const regions = clusterC60114ReviewRegions({
    sourceIdentity,
    policy,
    targets: reviewTargets,
    items,
    evidenceFamilies: families,
  });
  const audioRows = regions.regions.flatMap((region) =>
    region.contextIntervals.map((sourceInterval, index) =>
      sign({
        audioId: `synthetic-audio-${region.regionId}-${index}`,
        relativePath: `audio/${region.regionId}-${index}.wav`,
        sourceMediaSha256: hash,
        sourceIdentity,
        sourceInterval,
        requestedInterval: sourceInterval,
        sampleRate: 16000,
        channels: 1,
        bitDepth: 16,
        codec: "pcm_s16le",
        frameCount: Math.round(
          (sourceInterval.end - sourceInterval.start) * 16000,
        ),
        actualDuration: sourceInterval.end - sourceInterval.start,
        sha256: hash,
        playable: true,
        hashVerified: true,
        physicalMetadataVerified: true,
        coveredReviewTargetIds: reviewTargets.targets
          .filter(
            (t) =>
              c60114Coverage(t.sourceInterval, [sourceInterval]) >= 1 - 1e-7,
          )
          .map((t) => t.reviewTargetId),
        regionIds: [region.regionId],
      }),
    ),
  );
  const targetCoverageChecks = reviewTargets.targets.map((t) => ({
    reviewTargetId: t.reviewTargetId,
    mandatoryForAudio: t.mandatoryForAudio,
    audioRequired: t.audioRequired ?? t.mandatoryForAudio,
    coverageRatio: 1,
    fullyCovered: true,
  }));
  const mandatoryCount = reviewTargets.targets.filter(
    (t) => t.audioRequired ?? t.mandatoryForAudio,
  ).length;
  const audio = c60114ReviewAudioManifestV3Schema.parse(
    sign({
      ...c60114ArtifactHeader(policy, sourceIdentity),
      artifactType: "machine-review-audio-manifest-v3",
      regionsHash: regions.semanticHash,
      deliverySubsystemVersion: "C6.0.1.12_REVIEW_AUDIO",
      extractionPolicy: "existing-deterministic-pcm16k-source-extraction",
      audio: audioRows,
      targetCoverageChecks,
      summary: {
        plannedAudioCount: audioRows.length,
        actualAudioCount: audioRows.length,
        extractionFailureCount: 0,
        playableCount: audioRows.length,
        hashVerifiedCount: audioRows.length,
        mandatoryTargetCount: mandatoryCount,
        coveredMandatoryTargetCount: mandatoryCount,
        allTargetCount: reviewTargets.targets.length,
        coveredTargetCount: reviewTargets.targets.length,
        targetCoveragePassed: true,
        clipSumSeconds: audioRows.reduce(
          (sum, row) => sum + row.actualDuration,
          0,
        ),
        networkUsed: false,
      },
    }),
  );
  const playback = buildC60114PlaybackTimeline({
    sourceIdentity,
    policy,
    targets: reviewTargets,
    regions,
    audio,
  });
  const clips: C60114CoverageProjectionInput["baseline"]["delivery"]["audio"]["clips"] =
    previous.regionsV2.regions.map((region) => ({
      regionId: region.regionId,
      itemIds: region.reviewItemIds,
      relativePath: `legacy/${region.regionId}.wav`,
      requestedInterval: region.contextInterval,
      extractedInterval: region.contextInterval,
      coreInterval: region.sourceInterval,
      coreOffsetSeconds:
        region.sourceInterval.start - region.contextInterval.start,
      coreDurationSeconds:
        region.sourceInterval.end - region.sourceInterval.start,
      actualDurationSeconds:
        region.contextInterval.end - region.contextInterval.start,
      sampleRate: 16000,
      channelCount: 1,
      bitsPerSample: 16,
      frameCount: Math.round(
        (region.contextInterval.end - region.contextInterval.start) * 16000,
      ),
      sha256: hash,
      playable: true,
      sourceMediaSha256: hash,
    }));
  return {
    baseline: {
      sourceIdentity,
      previous: {
        items: previous.itemsV3,
        regions: previous.regionsV2,
        families: previous.evidenceFamilies,
        missing: previous.missingEvidence,
        playback: previous.playbackTimeline,
        burden: previous.burdenPlans,
      },
      delivery: {
        audio: { sourceMediaSha256: hash, semanticHash: hash, clips },
        freeze: { sourceMediaSha256: hash, semanticHash: hash },
      },
    },
    prepared: {
      sourceIdentity,
      policy,
      speechIslands,
      orphanSweep,
      reviewTargets,
      selection,
    },
    probes,
    lexical,
    missingEvidenceV3,
    items,
    regions,
    audio,
    playback,
  };
}

describe("C60114 frozen machine-only coverage projections", () => {
  it("builds nine strict deterministic variants without mutating or inferring", () => {
    const input = fixture(),
      before = JSON.stringify(input);
    const result = buildC60114CoverageProjections(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(c60114CoverageProjectionsSchema.safeParse(result).success).toBe(
      true,
    );
    expect(result.variants.map((v) => v.stage)).toEqual([
      "A0",
      "A1",
      "A2",
      "A3",
      "A4",
      "A5",
      "A6",
      "A7",
      "A8",
    ]);
    expect(buildC60114CoverageProjections(input).semanticHash).toBe(
      result.semanticHash,
    );
    for (const row of result.variants) {
      expect(Object.keys(row.projection)).not.toContain("errorComponents");
      expect(Object.keys(row.projection)).not.toContain("generatedAt");
      expect(Object.keys(row.projection)).not.toContain("engineeringGates");
      expect(row.diagnostics.runtimeGoldInputCount).toBe(0);
      expect(row.diagnostics.projectionInferenceCount).toBe(0);
      expect(row.diagnostics.canonicalTextMutationCount).toBe(0);
    }
  });

  it("retains baseline physical audio through A7 and changes full cue targets before speech targets", () => {
    const rows = buildC60114CoverageProjections(fixture()).variants;
    const base = required(rows[1]);
    const physical = (i: number) =>
      required(rows[i]).projection.physicalAudio.map(
        ({ audioId, sourceInterval, sha256 }) => ({
          audioId,
          sourceInterval,
          sha256,
        }),
      );
    for (let i = 0; i < 8; i++) expect(physical(i)).toEqual(physical(1));
    expect(physical(8)).not.toEqual(physical(1));
    expect(
      base.projection.targets.some(
        (t) => t.sourceInterval.start === 5 && t.sourceInterval.end === 7,
      ),
    ).toBe(true);
    expect(
      required(rows[2]).projection.targets.some(
        (t) => t.sourceInterval.start === 5 && t.sourceInterval.end === 12,
      ),
    ).toBe(true);
    expect(required(rows[2]).diagnostics.speechIslandCount).toBe(0);
    expect(required(rows[3]).diagnostics.speechIslandCount).toBe(2);
    expect(required(rows[3]).diagnostics.orphanCount).toBe(0);
    expect(required(rows[4]).diagnostics.orphanCount).toBe(1);
    expect(base.projection.speechIslands).toEqual([]);
    expect(
      required(rows[8]).diagnostics.targetAudioCoverage.coverageRatio,
    ).toBe(1);
  });

  it("requires direct child playback while crediting physical orphan audio independently of membership", () => {
    const rows = buildC60114CoverageProjections(fixture()).variants;
    const a4 = required(rows[4]);
    const child = required(
      a4.projection.targets.find((t) => t.sourceInterval.start === 55),
    );
    const orphan = required(
      a4.projection.targets.find((t) => t.sourceInterval.start === 3.5),
    );
    expect(
      a4.projection.regions.some((r) =>
        r.reviewTargetIds.includes(child.reviewTargetId),
      ),
    ).toBe(true);
    expect(a4.diagnostics.targetAudioCoverage.uncoveredTargetIds).toContain(
      child.reviewTargetId,
    );
    expect(a4.diagnostics.unboundTargetIds).toContain(orphan.reviewTargetId);
    expect(a4.diagnostics.targetAudioCoverage.uncoveredTargetIds).not.toContain(
      orphan.reviewTargetId,
    );
    expect(
      a4.projection.regions.some((r) =>
        r.reviewTargetIds.includes(orphan.reviewTargetId),
      ),
    ).toBe(false);
    expect(
      a4.diagnostics.audioBurden.selectedFullQueueUniqueAudioSeconds,
    ).toBeLessThan(
      a4.projection.playbackSegments.reduce(
        (sum, p) => sum + p.sourceInterval.end - p.sourceInterval.start,
        0,
      ),
    );
  });

  it("uses per-budget real segments and accepts cross-budget overlapping spans", () => {
    const a1 = required(buildC60114CoverageProjections(fixture()).variants[1]);
    const evaluation = evaluateC60114PlaybackCoverage({
      ...a1.projection,
      errorComponents: [],
      generatedAt: "1970-01-01T00:00:00.000Z",
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
    });
    expect(evaluation.integrityFailures).toEqual([]);
    expect(evaluation.budgets).toHaveLength(7);
    for (const plan of a1.projection.plans) {
      for (const id of plan.playbackSegmentIds) {
        const segment = required(
          a1.projection.playbackSegments.find(
            (s) => s.playbackSegmentId === id,
          ),
        );
        expect(
          segment.regionIds.every((id) => plan.regionIds.includes(id)),
        ).toBe(true);
      }
    }
  });

  it("adds only the frozen Whisper subset at A5, Reazon at A6, and classifications at A7", () => {
    const input = fixture(),
      rows = buildC60114CoverageProjections(input).variants;
    const a4 = required(rows[4]),
      a5 = required(rows[5]),
      a6 = required(rows[6]),
      a7 = required(rows[7]);
    expect(a4.projection.lexicalEvidence).toEqual([]);
    expect(
      a5.projection.lexicalEvidence.every(
        (e) => e.providerFamily === "whisper-large-v3",
      ),
    ).toBe(true);
    expect(
      new Set(a6.projection.lexicalEvidence.map((e) => e.providerFamily)),
    ).toEqual(new Set(["whisper-large-v3", "reazonspeech-k2-v2"]));
    expect(a5.diagnostics.probeRequestCount * 2).toBe(
      a6.diagnostics.probeRequestCount,
    );
    expect(a6.diagnostics.missingClassificationCounts).toEqual({});
    expect(
      Object.keys(a7.diagnostics.missingClassificationCounts).length,
    ).toBeGreaterThan(0);
    expect(a6.projection).toEqual(a7.projection);
  });

  it("rejects stale final target bindings and source identity mismatch", () => {
    const input = fixture();
    input.items.targetsHash = "b".repeat(64);
    expect(() => buildC60114CoverageProjections(input)).toThrow(
      "FINAL_DELIVERY_LINEAGE_MISMATCH",
    );
    const other = fixture();
    other.audio.sourceIdentity = {
      ...sourceIdentity,
      audioTimebase: "1/16000",
    };
    expect(() => buildC60114CoverageProjections(other)).toThrow(
      "SOURCE_IDENTITY_MISMATCH",
    );
  });

  it("does not invent playable regions when baseline clips are absent", () => {
    const input = fixture();
    input.baseline.delivery.audio.clips = [];
    const a1 = required(buildC60114CoverageProjections(input).variants[1]);
    expect(a1.projection.physicalAudio).toEqual([]);
    expect(a1.projection.playbackSegments).toEqual([]);
    expect(a1.diagnostics.targetAudioCoverage.coverageRatio).toBe(0);
    expect(
      a1.diagnostics.baselinePlaybackIntervalsWithoutPhysicalAudio.length,
    ).toBeGreaterThan(0);
  });

  it("preserves disjoint token localization instead of a min/max envelope", () => {
    const input = fixture();
    const row = required(
      input.probes.requests.find(
        (r) => r.coreInterval.start === 55 && r.provider === "whisper-large-v3",
      ),
    );
    row.windowType = "CORE_CONTEXT";
    row.localization.status = "TRUSTED_GLOBAL_TOKEN_PROJECTION";
    row.localization.completeness = "TOKEN_CHAIN_COMPLETE";
    row.tokens = [
      {
        text: "合",
        sourceInterval: { start: 55, end: 55.2 },
        trusted: true,
        probability: null,
        reason: "SYNTHETIC",
      },
      {
        text: "成",
        sourceInterval: { start: 56.8, end: 57 },
        trusted: true,
        probability: null,
        reason: "SYNTHETIC",
      },
    ];
    row.semanticHash = c60114ProbeSemanticHash(row);
    input.probes.semanticHash = c60114ProbeSemanticHash(input.probes);
    input.lexical.probeSemanticHash = input.probes.semanticHash;
    input.lexical = sign(input.lexical);
    input.missingEvidenceV3.lexicalEvidenceHash = input.lexical.semanticHash;
    const a5 = required(buildC60114CoverageProjections(input).variants[5]);
    const localized = a5.projection.lexicalEvidence.filter((e) =>
      e.evidenceId.startsWith(`probe-localized:${row.requestId}:`),
    );
    expect(localized.map((e) => e.sourceInterval)).toEqual([
      { start: 55, end: 55.2 },
      { start: 56.8, end: 57 },
    ]);
    expect(new Set(localized.map((e) => e.correlationGroup)).size).toBe(1);
  });
});
