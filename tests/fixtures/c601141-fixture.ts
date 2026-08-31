import {
  c60114ReviewItemsV4Schema,
  c60114ReviewTargetsSchema,
  c601141AsrProbesSchema,
  c601141InventorySchema,
  c60114LocalizedLexicalEvidenceSchema,
  c60114MissingSpeechEvidenceV3Schema,
  type C60114SourceIdentity,
  type C601141Observation,
  type C60114ProbeRuntime,
} from "@mvl/shared";
import {
  policy141,
  header141,
  hashed141,
  hash141,
  required141,
} from "../../packages/video-subtitler/src/review/c601141-policy.js";
import {
  buildC60114Policy,
  c60114ArtifactHeader,
} from "../../packages/video-subtitler/src/review/c60114-policy.js";
import { buildC60113ReviewPolicy } from "../../packages/video-subtitler/src/review/c60113-policy.js";
import { buildC60112ReviewPolicy } from "../../packages/video-subtitler/src/review/c60112-policy.js";
import { buildC60112ReviewItems } from "../../packages/video-subtitler/src/review/review-item-builder.js";
import { buildC60113ReviewItems } from "../../packages/video-subtitler/src/review/structured-review-priority.js";
import {
  buildC60113EvidenceFamilyGraph,
  c60113Observation,
} from "../../packages/video-subtitler/src/review/review-evidence-family-graph.js";
import { buildC60113MissingSpeechEvidence } from "../../packages/video-subtitler/src/review/missing-speech-evidence-v2.js";
import { clusterC60114ReviewRegions } from "../../packages/video-subtitler/src/review/review-region-clustering-v3.js";
import {
  partitionSpeech141,
  uncoveredSpeech141,
  selectSafety141,
  selectAsr141,
} from "../../packages/video-subtitler/src/review/c601141-inventory.js";
import {
  buildLexical141,
  buildMissing141,
} from "../../packages/video-subtitler/src/review/c601141-lexical.js";
import { buildReviewGraph141 } from "../../packages/video-subtitler/src/review/c601141-review-graph.js";

export const syntheticHash141 = "a".repeat(64);
export function syntheticRuntime141(
  provider: C60114ProbeRuntime["provider"],
): C60114ProbeRuntime {
  return {
    provider,
    modelId: provider,
    modelRevision: syntheticHash141,
    modelIdentityHash: syntheticHash141,
    runtimeIdentityHash: hash141(provider),
    modelFileHashes: { model: syntheticHash141 },
    manifestSha256: syntheticHash141,
    binarySha256: syntheticHash141,
    workerSha256: null,
    precision: "synthetic",
    device: "synthetic",
    verified: true,
  };
}
export function fixture141(sourceOverride?: C60114SourceIdentity) {
  const h = syntheticHash141,
    policy = policy141(),
    compatibilityPolicy = buildC60114Policy(),
    r3 = buildC60113ReviewPolicy();
  const source: C60114SourceIdentity = sourceOverride ?? {
    sourceMediaSha256: h,
    durationSeconds: 40,
    sampleRate: 48000,
    audioStreamIndex: 0,
    audioTimebase: "1/48000",
    sourceTimebase: "SOURCE_GLOBAL_SECONDS",
  };
  const base = required141(
    buildC60112ReviewItems({
      policy: buildC60112ReviewPolicy({
        policyFrozenAt: "1970-01-01T00:00:00.000Z",
      }),
      signals: [
        {
          reviewGroupId: "existing-item",
          eventIds: ["existing-event"],
          finalCueIds: ["cue-existing"],
          itemTypes: ["TEXT_HALLUCINATION_RISK"],
          sourceInterval: { start: 3, end: 5 },
          coreInterval: { start: 3, end: 5 },
          currentText: "合成の字幕",
          candidateIds: [],
          evidenceIds: ["hall"],
          reviewReasons: ["WHISPER_HALLUCINATION_SIGNAL"],
          suggestedActions: ["KEEP_CURRENT", "MANUAL_EDIT", "UNRESOLVED"],
        },
      ],
    }).items[0],
  );
  const families = buildC60113EvidenceFamilyGraph({
    policy: r3,
    observations: [
      c60113Observation({
        evidenceId: "hall",
        rootLineageIds: ["root"],
        family: "HALLUCINATION",
        provider: "synthetic",
        correlationGroup: "root",
        itemIds: [base.reviewItemId],
        gapIds: [],
        sourceInterval: { start: 3, end: 5 },
        positiveRisk: true,
        evidenceAbsence: false,
        contradiction: false,
        strength: 0.95,
        validatedSourceGlobal: true,
        detailCode: "SYNTHETIC_NOT_REAL_MODEL_RESULT",
      }),
    ],
  });
  const missing0 = buildC60113MissingSpeechEvidence({
    gaps: [],
    evidenceFamilies: families,
    legacyMissingItemCount: 0,
    policy: r3,
  });
  const scored = required141(
    buildC60113ReviewItems({
      items: [base],
      evidenceFamilies: families,
      missingEvidence: missing0,
      candidateBundles: [],
      policy: r3,
    }).items[0],
  );
  const oldHeader = c60114ArtifactHeader(compatibilityPolicy, source);
  const baselineTargets = c60114ReviewTargetsSchema.parse(
    hashed141({
      ...oldHeader,
      artifactType: "review-target-intervals-v2",
      targets: [
        hashed141({
          reviewTargetId: "existing-hallucination-target",
          parentReviewItemId: base.reviewItemId,
          targetType: "CURRENT_CUE_HALLUCINATION_TARGET",
          sourceInterval: { start: 3, end: 5 },
          targetAnchorIds: ["cue-existing"],
          finalCueIds: ["cue-existing"],
          eventIds: base.eventIds,
          evidenceIds: ["hall"],
          mandatoryForAudio: true,
          audioRequired: true,
          localizationStatus: "VERIFIED",
          sourceIdentity: source,
          reasons: ["SYNTHETIC_BASELINE"],
        }),
      ],
      unresolvedItems: [],
      summary: {
        targetCount: 1,
        itemCount: 1,
        unresolvedItemCount: 0,
        disjointItemCount: 0,
        coreFallbackCount: 0,
      },
    }),
  );
  const baselineItems = c60114ReviewItemsV4Schema.parse(
    hashed141({
      ...oldHeader,
      artifactType: "machine-review-items-v4",
      previousItemsHash: h,
      targetsHash: baselineTargets.semanticHash,
      missingEvidenceHash: h,
      items: [
        hashed141({
          ...scored,
          requiredLevel: "REQUIRED",
          reviewTargetIds: ["existing-hallucination-target"],
          sourceIntervals: [{ start: 3, end: 5 }],
          origin: "MIGRATED_C60113",
          speechIslandIds: [],
          orphanIds: [],
          missingClassificationV3: null,
          legacyItemIds: [base.reviewItemId],
          canonicalMutationAllowed: false,
        }),
      ],
      summary: {
        previousItemCount: 1,
        itemCount: 1,
        migratedItemCount: 1,
        createdItemCount: 0,
        orphanItemCount: 0,
        requiredItemCount: 1,
        previousItemsDeleted: 0,
        canonicalTextMutationCount: 0,
        canonicalTimingMutationCount: 0,
      },
    }),
  );
  const baselineRegions = clusterC60114ReviewRegions({
    targets: baselineTargets,
    items: baselineItems,
    sourceIdentity: source,
    policy: compatibilityPolicy,
    evidenceFamilies: families,
    frozenR3Policy: r3,
  });
  const observations: C601141Observation[] = [
    {
      observationId: "synthetic-silero",
      nativeInterval: {
        startSample: 12 * source.sampleRate,
        endSample: 14 * source.sampleRate,
      },
      family: "SILERO",
      correlationGroup: "SILERO",
      viewId: "native",
      profileId: "sensitive-v2",
      evidenceIds: ["synthetic-silero"],
      requestIds: ["synthetic-silero-run"],
      verifiedTimebase: true,
      speechPositive: true,
      strongContradiction: false,
      reliableLexical: false,
    },
    {
      observationId: "synthetic-pyannote",
      nativeInterval: {
        startSample: 12 * source.sampleRate,
        endSample: 14 * source.sampleRate,
      },
      family: "PYANNOTE",
      correlationGroup: "PYANNOTE",
      viewId: "native",
      profileId: "anonymous",
      evidenceIds: ["synthetic-pyannote"],
      requestIds: ["synthetic-pyannote-run"],
      verifiedTimebase: true,
      speechPositive: true,
      strongContradiction: false,
      reliableLexical: false,
    },
    {
      observationId: "synthetic-reserve",
      nativeInterval: {
        startSample: 23 * source.sampleRate,
        endSample: 25 * source.sampleRate,
      },
      family: "PYANNOTE",
      correlationGroup: "PYANNOTE",
      viewId: "voice",
      profileId: "anonymous",
      evidenceIds: ["synthetic-reserve"],
      requestIds: ["synthetic-pyannote-run"],
      verifiedTimebase: true,
      speechPositive: true,
      strongContradiction: false,
      reliableLexical: false,
    },
  ];
  const islands = partitionSpeech141({ observations, source, policy });
  const inventory = c601141InventorySchema.parse(
    hashed141({
      ...header141(policy, source),
      artifactType: "machine-source-global-speech-inventory-v4",
      viewsHash: h,
      fingerprintHash: h,
      sweepsEvidenceHash: h,
      previousIslandsHash: h,
      observations,
      islands,
      summary: {
        observationCount: 3,
        islandCount: islands.length,
        multiDetectorCount: 1,
        nativeUnionSeconds: 4,
        unresolvedCount: 0,
        parentEnvelopeAsSpeechCount: 0,
        correlationInflationCount: 0,
      },
    }),
  );
  const uncovered = uncoveredSpeech141({
    inventory,
    policy,
    cues: [{ start: 3, end: 5 }],
    previousTargets: baselineTargets.targets,
    finalCueHash: h,
    previousTargetsHash: baselineTargets.semanticHash,
  });
  const safety = selectSafety141(uncovered, policy),
    selection = selectAsr141(safety, policy, "2026-01-01T00:00:00.000Z");
  const probes = c601141AsrProbesSchema.parse(
    hashed141({
      ...header141(policy, source),
      artifactType: "machine-c6-0-1-14-1-local-asr-probes",
      mode: "EXACT_CACHE_ONLY",
      selectionHash: selection.semanticHash,
      requests: [],
      contextDecisions: [],
      accounting: {
        inferenceCount: 0,
        exactCount: 0,
        contextCount: 0,
        cacheHits: 0,
        cacheMisses: 0,
        modelLoadCount: 0,
        providerProcessStartCount: 0,
        resultPersistedCount: 0,
        failedCount: 0,
        hiddenRetryCount: 0,
        fullMediaAsrCount: 0,
      },
      evidenceSemanticHash: hash141([]),
    }),
  );
  const lexical = buildLexical141(probes, safety, policy),
    missing = buildMissing141(inventory, safety, lexical, policy);
  const graphInput = {
    policy,
    compatibilityPolicy,
    inventory,
    safety,
    lexical,
    missing,
    baselineTargets,
    baselineItems,
    baselineRegions,
    frozenR3Families: families,
  };
  const graph = buildReviewGraph141(graphInput);
  const oldLexical = c60114LocalizedLexicalEvidenceSchema.parse(
    hashed141({
      ...oldHeader,
      artifactType: "localized-missing-lexical-evidence",
      sourceIdentityHash: hash141(source),
      probeSemanticHash: h,
      readingMechanism: {
        status: "UNAVAILABLE",
        runtimeIdentityHash: null,
        reason: "SYNTHETIC_ONLY",
      },
      targets: [],
    }),
  );
  const oldMissing = c60114MissingSpeechEvidenceV3Schema.parse(
    hashed141({
      ...oldHeader,
      artifactType: "missing-speech-evidence-v3",
      sourceIdentityHash: hash141(source),
      lexicalEvidenceHash: oldLexical.semanticHash,
      targets: [],
      parentGaps: [],
      migratedV2GapIds: [],
      deprecatedEnvelopeOnlyEvidenceCount: 0,
      parentGapNotUsedAsSpeechEvidenceCount: 0,
      canonicalMutationCount: 0,
    }),
  );
  return {
    ...graphInput,
    source,
    graph,
    selection,
    probes,
    oldLexical,
    oldMissing,
  };
}
