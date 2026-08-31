import { z } from "zod";

export const C612_VERSION =
  "c6.1.2-top-k-reranking-acoustic-completeness-v1" as const;
export const c612Id = z.string().min(1);
export const c612Hash = z.string().regex(/^[a-f0-9]{64}$/u);
export const c612Count = z.number().int().nonnegative();
export const c612Number = z.number();
export const c612Ratio = z.number().min(0).max(1);
export const c612Interval = z
  .object({ start: z.number().nonnegative(), end: z.number().positive() })
  .strict()
  .refine((v) => v.end > v.start);
export const c612File = z
  .object({ relativePath: c612Id, sha256: c612Hash, size: c612Count })
  .strict();
export const c612Check = z
  .object({
    name: c612Id,
    passed: z.boolean(),
    observed: z.string(),
    expected: z.string(),
  })
  .strict();
export function c612Artifact<const N extends string, S extends z.ZodRawShape>(
  name: N,
  shape: S,
) {
  return z
    .object({
      schemaVersion: z.literal("1.0.0"),
      artifactType: z.literal(name),
      policyVersion: z.literal(C612_VERSION),
      semanticHash: c612Hash,
      ...shape,
    })
    .strict();
}
export const C612_RETRIEVAL = [
  "T0_H2_TOP4",
  "T1_RAW_MBR_TOP4",
  "T2_H2_RAW_UNION_TOP4",
  "T3_PROVIDER_DIVERSE_CORRELATION_DEDUP_TOP4",
] as const;
export const c612Retrieval = z.enum(C612_RETRIEVAL);
export const C612_PROFILES = [
  "L0",
  "L1",
  "L2",
  "L3",
  "L4",
  "L5",
  "L6",
  "L7",
  "L8",
] as const;
export const c612Profile = z.enum(C612_PROFILES);
export const c612Provider = z.enum(["CURRENT", "WHISPER", "REAZON"]);
export const c612PolicySchema = c612Artifact("c6-1-2-policy", {
  policyHash: c612Hash,
  policy: z
    .object({
      version: z.literal(C612_VERSION),
      mode: z.literal("OFFLINE_SHADOW_ONLY_KNOWN_DEVELOPMENT_BENCHMARK"),
      retrieval: z
        .object({
          profiles: z.array(c612Retrieval).length(4),
          k: z.literal(4),
          currentConsumesSlot: z.literal(false),
          primary: c612Retrieval,
          tieBreak: c612Id,
          unionSeedPerRanker: c612Count,
        })
        .strict(),
      correlation: z
        .object({
          verified: c612Id,
          provisional: c612Id,
          unknownIsIndependent: z.literal(false),
          currentVote: z.literal(0),
          observationVote: z.literal(1),
        })
        .strict(),
      completeness: z
        .object({
          minimumTokenPosterior: c612Ratio,
          minimumSupportedTokenFraction: c612Ratio,
          minimumSpeechCoverage: c612Ratio,
          maximumUncoveredEdgeSeconds: c612Number,
          maximumInternalUncoveredSeconds: c612Number,
          minimumRequestEdgeDistance: c612Number,
          tokenToleranceSeconds: c612Number,
          ctcAloneSelectsWinner: z.literal(false),
        })
        .strict(),
      verifier: z
        .object({
          mode: c612Id,
          maximumAudioRequests: c612Count,
          maximumWindowSeconds: c612Number,
          sampleRate: c612Count,
          channels: z.literal(1),
          precision: z.literal("fp32"),
          device: z.literal("cpu"),
          network: z.literal(false),
          targetGeneration: z.literal(false),
        })
        .strict(),
      contraction: z
        .object({
          strongLengthRatio: c612Ratio,
          strongDeletionRatio: c612Ratio,
          gate: c612Id,
          unknown: z.literal("ABSTAIN"),
          lengthOnlyBan: z.literal(false),
        })
        .strict(),
      mapping: z
        .object({
          method: c612Id,
          maximumGroupSeconds: c612Number,
          minimumGoldTemporalCoverage: c612Ratio,
          goldTextForBinding: z.literal(false),
          allProfilesShareBinding: z.literal(true),
        })
        .strict(),
      features: z.array(c612Id),
      folds: z
        .object({
          count: z.literal(5),
          method: c612Id,
          gapSeconds: c612Number,
          randomSplit: z.literal(false),
        })
        .strict(),
      rankers: z
        .object({
          profiles: z.array(c612Profile).length(9),
          pairwise: c612Id,
          listwise: c612Id,
          regularization: c612Number,
          iterations: c612Count,
          learningRate: c612Number,
          equalErrorPairs: c612Id,
          imputation: c612Id,
          scaling: c612Id,
          trainOnlyThresholdCandidates: z.array(c612Number),
          innerMinimumImproved: c612Count,
          innerMinimumPrecision: c612Ratio,
          innerMaximumHarm: c612Ratio,
        })
        .strict(),
      groupConfigurations: z
        .object({
          maximumConfigurations: z.literal(16),
          maximumChangedEvents: z.literal(2),
          alwaysRetainCurrent: z.literal(true),
          noSplitMerge: z.literal(true),
          noTimingMutation: z.literal(true),
        })
        .strict(),
      gates: z
        .object({
          minimumConservation: z.literal(1),
          minimumProvenance: z.literal(1),
          minimumCorrelationCoverage: c612Ratio,
          minimumCompletenessCoverage: c612Ratio,
          maximumDoubleCount: z.literal(0),
          maximumLeakage: z.literal(0),
          minimumChangedEvaluationCoverage: c612Ratio,
          minimumRecall4: c612Ratio,
          minimumPrecision: c612Ratio,
          maximumHarm: c612Ratio,
          minimumChangedGroups: c612Count,
          minimumActiveFolds: c612Count,
          maximumNegativeFolds: z.literal(0),
          maximumCatastrophicRegressions: z.literal(0),
          maximumMaterialDelta: z.literal(0),
          minimumOracleCapture: c612Ratio,
        })
        .strict(),
      chronology: z
        .object({
          machineFreezeBeforeLabels: z.literal(true),
          profilesFreezeBeforeLabels: z.literal(true),
          supervisedOofShadowsAfterTrainLabels: z.literal(true),
          outerTestLabelsForInference: z.literal(false),
        })
        .strict(),
      productionMutation: z.literal(false),
    })
    .strict(),
});
export const c612BaselineSchema = c612Artifact("c6-1-2-baseline-replay", {
  acceptanceCommit: c612Id,
  baselineBranch: c612Id,
  checks: z.array(c612Check),
  passed: z.boolean(),
  policyHash: c612Hash,
  proposalHash: c612Hash,
  fixedMappingHash: c612Hash,
  featureHash: c612Hash,
  foldHash: c612Hash,
  oofHash: c612Hash,
  universeHash: c612Hash,
  canonicalTextHash: c612Hash,
  canonicalTimingHash: c612Hash,
  productionFiles: z.array(c612File),
  inputFiles: z.array(c612File),
  cueCount: c612Count,
  eventCount: c612Count,
  eligibleEventCount: c612Count,
  inputCandidateCount: c612Count,
  includedAsrCount: c612Count,
  whisperCount: c612Count,
  reazonCount: c612Count,
  strongContractionCount: c612Count,
  runtimeGoldInputCount: z.literal(0),
  newAsrInferenceCount: z.literal(0),
  networkUsed: z.literal(false),
});
export const c612RankRowSchema = z
  .object({
    eventId: c612Id,
    candidateId: c612Id,
    candidateProvider: c612Provider,
    candidateRole: c612Id,
    rawMbrRank: c612Count.nullable(),
    hierarchicalMbrRank: c612Count.nullable(),
    rawMbrRisk: c612Number.nullable(),
    hierarchicalMbrRisk: c612Number.nullable(),
    rawMbrMargin: c612Number.nullable(),
    hierarchicalMbrMargin: c612Number.nullable(),
    currentCandidate: z.boolean(),
    inclusionStatus: c612Id,
    provenanceHash: c612Hash,
    structuralEligible: z.boolean(),
    reasons: z.array(c612Id),
  })
  .strict();
export const c612RankAuditSchema = c612Artifact(
  "machine-c6-1-2-full-candidate-rank-audit",
  {
    universeHash: c612Hash,
    baselineRiskHash: c612Hash,
    eligibleEventIds: z.array(c612Id),
    rows: z.array(c612RankRowSchema),
    runtimeGoldInputCount: z.literal(0),
    tieBreak: z.literal("RISK_PROVENANCE_HASH_CANDIDATE_ID"),
  },
);
export const c612SetSchema = z
  .object({
    profile: c612Retrieval,
    eventId: c612Id,
    currentCandidateId: c612Id,
    alternativeIds: z.array(c612Id).max(4),
  })
  .strict();
export const c612TopKSchema = c612Artifact(
  "machine-c6-1-2-top-k-candidate-set",
  {
    rankHash: c612Hash,
    correlationHash: c612Hash,
    k: z.literal(4),
    currentOccupiesAlternativeSlot: z.literal(false),
    sets: z.array(c612SetSchema),
    uniqueCandidateIds: z.array(c612Id),
    runtimeGoldInputCount: z.literal(0),
  },
);
export const c612ConservationReason = z.enum([
  "CURRENT",
  "INCLUDED",
  "BELOW_K",
  "NORMALIZED_DUPLICATE",
  "SAME_ACOUSTIC_OBSERVATION",
  "PROVIDER_DIVERSITY_REPLACED",
  "HARD_REJECTED",
  "CORRELATION_DEDUPLICATED",
  "UNKNOWN_IDENTITY_NOT_PROMOTED",
]);
export const c612ConservationSchema = c612Artifact(
  "machine-c6-1-2-top-k-conservation-ledger",
  {
    rankHash: c612Hash,
    topKHash: c612Hash,
    rows: z.array(
      z
        .object({
          profile: c612Retrieval,
          eventId: c612Id,
          candidateId: c612Id,
          reason: c612ConservationReason,
        })
        .strict(),
    ),
    accountedCount: c612Count,
    expectedCount: c612Count,
    silentDropCount: c612Count,
    passed: z.boolean(),
  },
);
export const c612TopKComparisonSchema = c612Artifact(
  "machine-c6-1-2-top-k-profile-comparison",
  {
    topKHash: c612Hash,
    profiles: z.array(
      z
        .object({
          profile: c612Retrieval,
          events: c612Count,
          current: c612Count,
          alternatives: c612Count,
          bothProviders: c612Count,
          availableBothProviders: c612Count,
          duplicateObservationSlots: c612Count,
        })
        .strict(),
    ),
    runtimeGoldInputCount: z.literal(0),
  },
);
export const c612IdentityStatus = z.enum([
  "VERIFIED_CORE_PCM_IDENTITY",
  "PROVISIONAL_INTERVAL_IDENTITY",
  "UNKNOWN_IDENTITY",
]);
export const c612IdentityRowSchema = z
  .object({
    eventId: c612Id,
    candidateId: c612Id,
    sourceMediaHash: c612Hash,
    sourceAudioStreamIdentity: c612Id.nullable(),
    requestedInterval: c612Interval.nullable(),
    extractedInterval: c612Interval.nullable(),
    coreInterval: c612Interval.nullable(),
    sourceSampleStart: c612Count.nullable(),
    sourceSampleEnd: c612Count.nullable(),
    sampleRate: c612Count.nullable(),
    channelMixPolicy: c612Id.nullable(),
    coreAudioHash: c612Hash.nullable(),
    providerFamily: c612Provider,
    modelId: c612Id.nullable(),
    modelRevision: c612Id.nullable(),
    decodeConfigHash: c612Hash.nullable(),
    promptHash: c612Hash.nullable(),
    requestId: c612Id.nullable(),
    parentRequestId: c612Id.nullable(),
    windowLineage: z.array(c612Id),
    cacheIdentity: c612Id.nullable(),
    identityStatus: c612IdentityStatus,
    observationIdentity: c612Hash.nullable(),
    coreIdentity: c612Hash.nullable(),
    evidenceHashes: z.array(c612Hash),
    missing: z.array(c612Id),
  })
  .strict();
export const c612IdentitySchema = c612Artifact(
  "machine-c6-1-2-candidate-correlation-identity",
  {
    rows: z.array(c612IdentityRowSchema),
    topKScopeCandidateIds: z.array(c612Id),
    runtimeGoldInputCount: z.literal(0),
  },
);
export const c612FullIdentitySchema = c612Artifact(
  "machine-c6-1-2-full-correlation-identity",
  {
    rows: z.array(c612IdentityRowSchema),
    universeHash: c612Hash,
    runtimeGoldInputCount: z.literal(0),
  },
);
export const c612Relationship = z.enum([
  "SAME_ACOUSTIC_OBSERVATION",
  "SAME_CORE_DIFFERENT_PROVIDER",
  "SAME_PROVIDER_DIFFERENT_WINDOW",
  "SAME_PROVIDER_DIFFERENT_DECODE",
  "OVERLAPPING_AUDIO_OBSERVATION",
  "DISTINCT_ACOUSTIC_OBSERVATION",
  "PROVISIONAL_IDENTITY",
  "UNKNOWN_CORRELATION",
]);
export const c612ReconciliationSchema = c612Artifact(
  "machine-c6-1-2-same-audio-reconciliation",
  {
    identityHash: c612Hash,
    pairs: z.array(
      z
        .object({
          leftCandidateId: c612Id,
          rightCandidateId: c612Id,
          relationship: c612Relationship,
        })
        .strict(),
    ),
    observationGroups: z.array(
      z
        .object({
          observationIdentity: c612Hash,
          candidateIds: z.array(c612Id),
          voteWeight: z.literal(1),
        })
        .strict(),
    ),
    sameAudioGroupsReconciled: c612Count,
    duplicateVotesPrevented: c612Count,
    sameCoreCrossProviderCount: c612Count,
    doubleCount: z.literal(0),
  },
);
export const c612CorrelationAuditSchema = c612Artifact(
  "machine-c6-1-2-correlation-audit",
  {
    identityHash: c612Hash,
    reconciliationHash: c612Hash,
    total: c612Count,
    verified: c612Count,
    provisional: c612Count,
    unknown: c612Count,
    coverage: c612Ratio.nullable(),
    verifiedCoverage: c612Ratio.nullable(),
  },
);
export const c612CtcScoreSchema = z
  .object({
    candidateId: c612Id,
    eventId: c612Id,
    audioHash: c612Hash.nullable(),
    modelSnapshotHash: c612Hash.nullable(),
    runtimeIdentityHash: c612Hash.nullable(),
    scoredInterval: c612Interval.nullable(),
    targetHash: c612Hash.nullable(),
    representation: z.enum(["NORMALIZED_DISPLAY", "PRONUNCIATION"]).nullable(),
    rawLoss: c612Number.nonnegative().nullable(),
    perTokenLoss: c612Number.nonnegative().nullable(),
    tokenCount: c612Count,
    vocabularyCoverage: c612Ratio.nullable(),
    unknownTokenCount: c612Count,
    acousticFrameCount: c612Count,
    status: z.enum(["SCORABLE", "UNSCORABLE", "UNAVAILABLE"]),
    reasons: z.array(c612Id),
    supportedTokens: z.array(
      z
        .object({
          index: c612Count,
          start: c612Number.nonnegative(),
          end: c612Number.positive(),
          posterior: c612Ratio,
        })
        .strict(),
    ),
    cacheIdentity: c612Hash.nullable(),
  })
  .strict();
export const c612CtcSchema = c612Artifact(
  "machine-c6-1-2-candidate-ctc-scores",
  {
    lowerIsBetter: z.literal(true),
    rows: z.array(c612CtcScoreSchema),
    runtimeGoldInputCount: z.literal(0),
  },
);
export const c612CompletenessStatus = z.enum([
  "VERIFIED_COMPLETE",
  "LIKELY_COMPLETE",
  "PARTIAL_LEADING",
  "PARTIAL_TRAILING",
  "PARTIAL_INTERNAL",
  "EDGE_TRUNCATED",
  "ADJACENT_CONTAMINATED",
  "BOTH_TRUNCATED_AND_CONTAMINATED",
  "INSUFFICIENT_EVIDENCE",
  "UNSCORABLE",
]);
export const c612CompletenessRowSchema = z
  .object({
    eventId: c612Id,
    candidateId: c612Id,
    speechActivityCoverage: c612Ratio.nullable(),
    speechBeforeFirstSupportedToken: c612Number.nonnegative().nullable(),
    speechAfterLastSupportedToken: c612Number.nonnegative().nullable(),
    unsupportedInternalSpeechDuration: c612Number.nonnegative().nullable(),
    candidateTokenSupportCoverage: c612Ratio.nullable(),
    candidatePronunciationCoverage: c612Ratio.nullable(),
    candidateCtcLossPerToken: c612Number.nullable(),
    candidateCtcScorability: z.enum(["SCORABLE", "UNSCORABLE", "UNAVAILABLE"]),
    firstTokenToSpeechOnsetGap: c612Number.nullable(),
    lastTokenToSpeechOffsetGap: c612Number.nullable(),
    requestLeftEdgeDistance: c612Number.nullable(),
    requestRightEdgeDistance: c612Number.nullable(),
    coreLeftEdgeDistance: c612Number.nullable(),
    coreRightEdgeDistance: c612Number.nullable(),
    leadingDeletionRisk: c612Ratio.nullable(),
    trailingDeletionRisk: c612Ratio.nullable(),
    internalDeletionRisk: c612Ratio.nullable(),
    adjacentUtteranceContaminationRisk: c612Ratio.nullable(),
    acousticCompletenessStatus: c612CompletenessStatus,
    evidenceHashes: z.array(c612Hash),
    missing: z.array(c612Id),
  })
  .strict();
export const c612CompletenessSchema = c612Artifact(
  "machine-c6-1-2-candidate-acoustic-completeness",
  {
    rows: z.array(c612CompletenessRowSchema),
    runtimeGoldInputCount: z.literal(0),
  },
);
export const c612EdgeSchema = c612Artifact(
  "machine-c6-1-2-candidate-edge-risk",
  {
    completenessHash: c612Hash,
    rows: z.array(
      z
        .object({
          candidateId: c612Id,
          eventId: c612Id,
          leftDistance: c612Number.nullable(),
          rightDistance: c612Number.nullable(),
          risk: c612Ratio.nullable(),
          status: c612Id,
        })
        .strict(),
    ),
  },
);
export const c612RuntimeSchema = c612Artifact(
  "machine-c6-1-2-acoustic-completeness-runtime",
  {
    mode: z.enum([
      "EXACT_CACHE_ONLY",
      "BOUNDED_NON_GENERATIVE_FRESH",
      "CACHE_REPLAY",
    ]),
    modelId: c612Id.nullable(),
    modelRevision: c612Id.nullable(),
    modelSnapshotHash: c612Hash.nullable(),
    runtimeIdentityHash: c612Hash.nullable(),
    device: c612Id.nullable(),
    requestBudget: c612Count,
    plannedRequests: c612Count,
    actualRequests: c612Count,
    freshVerifierInference: c612Count,
    verifierCacheHits: c612Count,
    verifierModelLoads: c612Count,
    candidateScores: c612Count,
    asrInference: z.literal(0),
    asrModelLoads: z.literal(0),
    newTranscriptCandidates: z.literal(0),
    networkUsed: z.literal(false),
    runtimeGoldInputCount: z.literal(0),
  },
);
export const c612VerifierVersionsSchema = z
  .object({
    python: c612Id,
    torch: c612Id,
    transformers: c612Id,
    numpy: c612Id,
    scipy: c612Id,
    device: z.literal("cpu"),
    precision: z.literal("fp32"),
    threads: z.literal(1),
  })
  .strict();
export const c612VerifierIdentitySchema = c612Artifact(
  "machine-c6-1-2-verifier-runtime-identity",
  {
    modelId: c612Id,
    modelRevision: c612Id,
    modelSnapshotHash: c612Hash,
    modelFiles: z.array(
      z.object({ name: c612Id, sha256: c612Hash, bytes: c612Count }).strict(),
    ),
    runtime: c612VerifierVersionsSchema,
    workerHash: c612Hash,
    importedWorkerHash: c612Hash,
    runtimeIdentityHash: c612Hash,
    networkUsed: z.literal(false),
    runtimeGoldInputCount: z.literal(0),
  },
);
export const c612ContractionClass = z.enum([
  "NOT_STRONG_CONTRACTION",
  "VERIFIED_HALLUCINATION_REMOVAL",
  "SAFE_REDUNDANCY_REMOVAL",
  "POSSIBLE_VALID_CONTRACTION",
  "CATASTROPHIC_LEADING_DELETION",
  "CATASTROPHIC_TRAILING_DELETION",
  "CATASTROPHIC_INTERNAL_DELETION",
  "UNKNOWN_CONTRACTION",
]);
export const c612ContractionRowSchema = z
  .object({
    eventId: c612Id,
    candidateId: c612Id,
    priorStrongContraction: z.boolean(),
    strong: z.boolean(),
    lengthRatio: c612Number.nonnegative(),
    prefixRetention: c612Ratio,
    suffixRetention: c612Ratio,
    lcsRatio: c612Ratio,
    leadingDeletionLength: c612Count,
    trailingDeletionLength: c612Count,
    internalDeletionSpans: z.array(
      z.object({ start: c612Count, end: c612Count }).strict(),
    ),
    deletedPronunciationUnits: c612Count.nullable(),
    deletedAcousticallySupportedUnits: c612Count.nullable(),
    completenessStatus: c612CompletenessStatus,
    classification: c612ContractionClass,
    selectable: z.boolean(),
    reasons: z.array(c612Id),
  })
  .strict();
export const c612ContractionSchema = c612Artifact(
  "machine-c6-1-2-contraction-audit",
  {
    rows: z.array(c612ContractionRowSchema),
    runtimeGoldInputCount: z.literal(0),
    lengthAloneBansCandidate: z.literal(false),
  },
);
export const c612MappingStatus = z.enum([
  "FIXED_ONE_TO_ONE",
  "FIXED_ONE_TO_MANY",
  "FIXED_MANY_TO_ONE",
  "FIXED_MANY_TO_MANY",
  "AMBIGUOUS",
  "NO_MAPPING",
  "STRUCTURE_INCOMPATIBLE",
]);
export const c612GroupSchema = z
  .object({
    groupId: c612Id,
    cueIds: z.array(c612Id),
    eventIds: z.array(c612Id),
    sourceInterval: c612Interval,
    status: c612MappingStatus,
    baselineTextHash: c612Hash,
    baselineTimingHash: c612Hash,
    evidenceHashes: z.array(c612Hash),
    reasons: z.array(c612Id),
  })
  .strict();
export const c612MappingSchema = c612Artifact(
  "c6-1-2-fixed-cue-group-mapping-v2",
  {
    groups: z.array(c612GroupSchema),
    baselineCueOrder: z.array(c612Id),
    universeHash: c612Hash,
    runtimeGoldInputCount: z.literal(0),
    goldBinding: z.literal("EVALUATOR_ONLY_AFTER_MACHINE_FREEZE"),
    profileRematchingAllowed: z.literal(false),
  },
);
export const c612MappingAuditSchema = c612Artifact(
  "c6-1-2-mapping-recovery-audit",
  {
    mappingHash: c612Hash,
    assignedCueCount: c612Count,
    assignedEventCount: c612Count,
    noMappingEventCount: c612Count,
    ambiguousEventCount: c612Count,
    goldTextUsed: z.literal(false),
    scope: z.literal("MACHINE_EVENT_TO_PRODUCTION_CUE_LINEAGE_ONLY"),
  },
);
export const C612_FEATURE_NAMES = [
  "rawMbrRank",
  "hierarchicalMbrRank",
  "rawMbrRisk",
  "hierarchicalMbrRisk",
  "rawMbrMargin",
  "hierarchicalMbrMargin",
  "normalizedDistanceToCurrent",
  "pronunciationDistanceToCurrent",
  "lengthRatio",
  "lcsRatio",
  "prefixRetention",
  "suffixRetention",
  "insertionRatio",
  "deletionRatio",
  "providerWhisper",
  "providerReazon",
  "currentControl",
  "correlationGroupSize",
  "independentProviderSupport",
  "sameAudioDuplicateCount",
  "uniqueAcousticObservationCount",
  "providerWindowStability",
  "lexicalStability",
  "contextExtensionRisk",
  "hallucinationRisk",
  "candidateCtcLossPerToken",
  "relativeCtcMargin",
  "tokenSupportCoverage",
  "speechActivityCoverage",
  "leadingSpeechGap",
  "trailingSpeechGap",
  "completenessStatus",
  "edgeRisk",
  "contaminationRisk",
  "finalSpanLineageStatus",
  "cueGroupMappingStatus",
  "candidateProvenanceComplete",
  "candidateEncodingValid",
] as const;
export const c612FeatureName = z.enum(C612_FEATURE_NAMES);
export const c612FeatureRowSchema = z
  .object({
    candidateId: c612Id,
    eventId: c612Id,
    values: z.array(c612Number.nullable()).length(C612_FEATURE_NAMES.length),
    missing: z.array(z.boolean()).length(C612_FEATURE_NAMES.length),
    evidenceHashes: z.array(c612Hash),
  })
  .strict()
  .refine((r) => r.values.every((v, i) => r.missing[i] === (v === null)));
export const c612FeaturesSchema = c612Artifact(
  "machine-c6-1-2-top-k-features",
  {
    featureNames: z.array(c612FeatureName).length(C612_FEATURE_NAMES.length),
    rows: z.array(c612FeatureRowSchema),
    rawTextFeatureCount: z.literal(0),
    goldFeatureCount: z.literal(0),
    datasetSpecificFeatureCount: z.literal(0),
    runtimeGoldInputCount: z.literal(0),
  },
).refine((a) => a.featureNames.every((n, i) => n === C612_FEATURE_NAMES[i]));
export const c612FoldsSchema = c612Artifact("c6-1-2-folds", {
  mappingHash: c612Hash,
  blocks: z.array(
    z
      .object({
        blockId: c612Id,
        groupIds: z.array(c612Id),
        eventIds: z.array(c612Id),
        candidateIds: z.array(c612Id),
        sourceInterval: c612Interval,
        foldId: c612Id,
      })
      .strict(),
  ),
  folds: z.array(
    z
      .object({
        foldId: c612Id,
        blockIds: z.array(c612Id),
        groupIds: z.array(c612Id),
        eventIds: z.array(c612Id),
        candidateIds: z.array(c612Id),
      })
      .strict(),
  ),
  audioLeakageCount: c612Count,
  correlationLeakageCount: c612Count,
  cueGroupLeakageCount: c612Count,
  frozenBeforeGold: z.literal(true),
  reasons: z.array(c612Id),
});
export const c612FreezeSchema = c612Artifact("c6-1-2-machine-freeze-manifest", {
  frozenAt: z.iso.datetime(),
  files: z.array(c612File),
  codeFiles: z.array(c612File),
  machineAggregateHash: c612Hash,
  codeAggregateHash: c612Hash,
  policyHash: c612Hash,
  sourceIdentity: c612Hash,
  productionTextHash: c612Hash,
  productionTimingHash: c612Hash,
  goldRead: z.literal(false),
  oofShadowsFrozenBeforeGold: z.literal(false),
  modelProfilesFrozenBeforeGold: z.literal(true),
  inputOrderParity: z.boolean(),
});
export const c612FeatureFreezeSchema = c612Artifact("c6-1-2-feature-freeze", {
  featureHash: c612Hash,
  mappingHash: c612Hash,
  foldHash: c612Hash,
  topKHash: c612Hash,
  policyHash: c612Hash,
  goldRead: z.literal(false),
});

export type C612RankRow = z.infer<typeof c612RankRowSchema>;
export type C612Set = z.infer<typeof c612SetSchema>;
export type C612Identity = z.infer<typeof c612IdentityRowSchema>;
export type C612CtcScore = z.infer<typeof c612CtcScoreSchema>;
export type C612Completeness = z.infer<typeof c612CompletenessRowSchema>;
export type C612Contraction = z.infer<typeof c612ContractionRowSchema>;
export type C612Group = z.infer<typeof c612GroupSchema>;
export type C612FeatureRow = z.infer<typeof c612FeatureRowSchema>;
export type C612Folds = z.infer<typeof c612FoldsSchema>;
export type C612Profile = z.infer<typeof c612Profile>;
export type C612Retrieval = z.infer<typeof c612Retrieval>;
