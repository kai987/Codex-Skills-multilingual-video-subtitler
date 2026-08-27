import { z } from "zod";

export const c6013PolicyVersion =
  "c6.0.1.3-candidate-association-canonical-assembly-v1" as const;

export const candidateAssociationModeSchema = z.enum([
  "off",
  "observe",
  "enforce",
]);
export const canonicalAssemblyModeSchema = candidateAssociationModeSchema;
export const timelineTransformChainModeSchema = candidateAssociationModeSchema;

const schemaVersion = z.literal("1.0.0");
const policyVersion = z.literal(c6013PolicyVersion);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const count = z.number().int().nonnegative();
const finite = z.number();
const interval = z
  .object({ start: z.number().nonnegative(), end: z.number().positive() })
  .strict()
  .refine((value) => value.end > value.start, {
    message: "Interval end must be greater than start.",
  });
const nullableInterval = interval.nullable();
const artifactHeader = {
  schemaVersion,
  policyVersion,
  generatedAt: z.iso.datetime(),
} as const;

export const candidateDispositionSchema = z.enum([
  "ASSIGNED",
  "QUARANTINED",
  "SUPERSEDED",
  "DUPLICATE",
  "AMBIGUOUS",
  "REJECTED",
]);

export const candidateAssociationReasonSchema = z.enum([
  "NO_COMPATIBLE_CLUSTER",
  "ASSOCIATION_SCORE_TOO_LOW",
  "TEMPORAL_CONFLICT",
  "TEXT_CONFLICT",
  "ACOUSTIC_EVENT_CONFLICT",
  "SPEAKER_CONFLICT",
  "WINDOW_EDGE_ONLY",
  "BROAD_WINDOW_ONLY",
  "PREFIX_SHADOWED",
  "SUFFIX_SHADOWED",
  "DUPLICATE_EVENT",
  "CORRELATED_RETRY",
  "NONCOMPETITIVE_VARIANT",
  "MISSING_GLOBAL_TIMELINE",
  "AMBIGUOUS_TIME_BASE",
  "MULTIPLE_VALID_CLUSTERS",
  "WEAK_ACOUSTIC_SUPPORT",
  "HALLUCINATION_RISK",
  "UNKNOWN",
]);

const associationScoreSchema = z
  .object({
    temporalCompatibility: z.number().min(0).max(1),
    textCompatibility: z.number().min(0).max(1),
    acousticCompatibility: z.number().min(0).max(1),
    speakerCompatibility: z.number().min(0).max(1),
    timelineTrust: z.number().min(0).max(1),
    evidenceStrength: z.number().min(0).max(1),
    tieBreakScore: z.number().min(0).max(1),
  })
  .strict();

export const machineCandidateAssociationLedgerSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-candidate-association-ledger"),
    mode: candidateAssociationModeSchema,
    sourceCandidateSemanticHash: sha256,
    atomicClusterSemanticHash: sha256,
    familySemanticHash: sha256,
    records: z.array(
      z
        .object({
          candidateId: z.string().min(1),
          sourceCueId: z.string().min(1),
          interval,
          normalizedTextHash: sha256,
          familyIds: z.array(z.string().min(1)),
          compatibleClusterIds: z.array(z.string().min(1)),
          assignedClusterId: z.string().min(1).nullable(),
          assignedEventId: z.string().min(1).nullable(),
          selectedAsTextVariant: z.boolean(),
          disposition: candidateDispositionSchema,
          primaryReason: candidateAssociationReasonSchema.nullable(),
          reasons: z.array(candidateAssociationReasonSchema),
          hardIncompatibilities: z.array(candidateAssociationReasonSchema),
          score: associationScoreSchema,
          competingAssignments: z.array(
            z
              .object({
                clusterId: z.string().min(1),
                score: z.number().min(0).max(1),
                hardCompatible: z.boolean(),
                reasons: z.array(candidateAssociationReasonSchema),
              })
              .strict(),
          ),
          lineageIds: z.array(z.string().min(1)).min(1),
        })
        .strict(),
    ),
    summary: z
      .object({
        sourceCandidateCount: count,
        atomicClusterCount: count,
        ledgerRecordCount: count,
        assignedCount: count,
        quarantinedCount: count,
        supersededCount: count,
        duplicateCount: count,
        ambiguousCount: count,
        rejectedCount: count,
        groupedCandidateCount: count,
        unaccountedCandidateCount: z.literal(0),
        unknownReasonCount: z.literal(0),
        multiAssignedCandidateCount: z.literal(0),
        candidateConservationPassed: z.literal(true),
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

export const goldCandidateAssociationLossAttributionSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("gold-candidate-association-loss-attribution"),
    evaluationPhase: z.literal("post-hoc-gold-isolated"),
    runtimeGoldInputCount: z.literal(0),
    goldIdentityHash: sha256,
    associationLedgerSemanticHash: sha256,
    records: z.array(
      z
        .object({
          candidateId: z.string().min(1),
          disposition: candidateDispositionSchema,
          primaryReason: candidateAssociationReasonSchema.nullable(),
          matchedGoldCueIds: z.array(z.string().min(1)),
          temporalIou: z.number().min(0).max(1),
          normalizedTextSimilarity: z.number().min(0).max(1),
          attribution: z.enum([
            "NO_GOLD_LOSS",
            "ASSOCIATION_LOSS",
            "TEXT_VARIANT_LOSS",
            "TIMELINE_LOSS",
            "DOWNSTREAM_ASSEMBLY_LOSS",
            "UNATTRIBUTED",
          ]),
          evidence: z.array(z.string().min(1)),
        })
        .strict(),
    ),
    summary: z
      .object({
        evaluatedCandidateCount: count,
        associationLossCount: count,
        textVariantLossCount: count,
        timelineLossCount: count,
        downstreamAssemblyLossCount: count,
        unattributedCount: count,
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

export const machineCanonicalEventSchema = z
  .object({
    eventId: z.string().min(1),
    acousticInterval: interval,
    speechRegions: z.array(interval),
    familyIds: z.array(z.string().min(1)),
    candidateIds: z.array(z.string().min(1)).min(1),
    speakerHypotheses: z.array(z.string().min(1)),
    trustedTokenSpan: nullableInterval,
    segmentSpan: interval,
    vadSpan: nullableInterval,
    eventType: z.enum([
      "SINGLE_UTTERANCE",
      "RAPID_TURN",
      "MULTI_SPEAKER_OVERLAP",
      "BACKGROUND_FOREGROUND",
      "CHANT_OR_CROWD",
      "CONTINUATION_CANDIDATE",
      "AMBIGUOUS_EVENT",
    ]),
    ambiguity: z
      .object({
        status: z.enum(["resolved", "review", "quarantined"]),
        reasons: z.array(candidateAssociationReasonSchema),
        validCandidateCount: count,
      })
      .strict(),
    representativeCandidateId: z.string().min(1),
    semanticHash: sha256,
  })
  .strict();

export const machineCanonicalEventsSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-canonical-events"),
    mode: candidateAssociationModeSchema,
    associationLedgerSemanticHash: sha256,
    events: z.array(machineCanonicalEventSchema),
    summary: z
      .object({
        eventCount: count,
        singleUtteranceCount: count,
        rapidTurnCount: count,
        multiSpeakerOverlapCount: count,
        backgroundForegroundCount: count,
        chantOrCrowdCount: count,
        continuationCandidateCount: count,
        ambiguousEventCount: count,
        eventWithoutCandidateCount: z.literal(0),
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

export const machineCanonicalAssemblySchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-canonical-assembly"),
    mode: canonicalAssemblyModeSchema,
    eventSemanticHash: sha256,
    operations: z.array(
      z
        .object({
          operationId: z.string().min(1),
          eventId: z.string().min(1),
          inputCandidateIds: z.array(z.string().min(1)).min(1),
          selectedCandidateId: z.string().min(1).nullable(),
          previousWinnerCandidateId: z.string().min(1).nullable(),
          outputCueId: z.string().min(1).nullable(),
          operation: z.enum([
            "PRESERVE_WINNER",
            "SELECT_LONG_SUPPORTED_VARIANT",
            "QUARANTINE_EVENT",
            "REJECT_SYNTHETIC_JOIN",
          ]),
          textSource: z.enum(["single-real-candidate", "none"]),
          tokenProvenanceComplete: z.boolean(),
          syntheticTextJoin: z.literal(false),
          beforeInterval: nullableInterval,
          afterInterval: nullableInterval,
          reasons: z.array(z.string().min(1)),
        })
        .strict(),
    ),
    outputCues: z.array(
      z
        .object({
          cueId: z.string().min(1),
          eventId: z.string().min(1),
          sourceCandidateId: z.string().min(1),
          interval,
          textHash: sha256,
        })
        .strict(),
    ),
    summary: z
      .object({
        eventCount: count,
        outputCueCount: count,
        preservedWinnerCount: count,
        longVariantSelectionCount: count,
        quarantinedEventCount: count,
        syntheticJoinCount: z.literal(0),
        textMutationCount: count,
        timingMutationCount: count,
      })
      .strict(),
    inputCueSemanticHash: sha256,
    outputCueSemanticHash: sha256,
    semanticHash: sha256,
  })
  .strict();

export const machineSupportedTextRetentionSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-supported-text-retention"),
    mode: canonicalAssemblyModeSchema,
    records: z.array(
      z
        .object({
          eventId: z.string().min(1),
          sourceCandidateId: z.string().min(1),
          outputCueId: z.string().min(1).nullable(),
          sourceNormalizedLength: count,
          retainedNormalizedLength: count,
          retentionRatio: z.number().min(0).max(1),
          strongSupport: z.boolean(),
          prefixShadowPrevented: z.boolean(),
          unsupportedDeletion: z.boolean(),
          reasons: z.array(z.string().min(1)),
        })
        .strict(),
    ),
    summary: z
      .object({
        evaluatedEventCount: count,
        strongSupportedCandidateCount: count,
        fullyRetainedCount: count,
        prefixShadowPreventedCount: count,
        unsupportedStrongTextDeletionCount: z.literal(0),
        minimumStrongTextRetentionRatio: z.number().min(0).max(1),
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

const timelineTransformSchema = z
  .object({
    transformId: z.string().min(1),
    from: z.enum([
      "source-media",
      "vad-local",
      "parent-request-local",
      "clip-local",
      "decoder-local",
      "global-media",
    ]),
    to: z.enum([
      "source-media",
      "vad-local",
      "parent-request-local",
      "clip-local",
      "decoder-local",
      "global-media",
    ]),
    scale: z.number().positive(),
    offsetSeconds: finite,
    verified: z.boolean(),
    evidence: z.array(z.string().min(1)),
  })
  .strict();

export const machineTimelineTransformChainSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-timeline-transform-chain"),
    mode: timelineTransformChainModeSchema,
    requestContractSemanticHash: sha256,
    chains: z.array(
      z
        .object({
          requestId: z.string().min(1),
          parentRequestId: z.string().min(1).nullable(),
          requestedInterval: interval,
          extractedInterval: interval,
          vadEnabled: z.boolean(),
          transforms: z.array(timelineTransformSchema).min(1),
          composedScale: z.number().positive(),
          composedOffsetSeconds: finite.nullable(),
          status: z.enum(["VERIFIED", "QUARANTINED", "UNAVAILABLE"]),
          failureReason: candidateAssociationReasonSchema.nullable(),
          tokenCount: count,
          requestMappedTokenCount: count,
          associationPendingTokenCount: count,
          rejectedTokenCount: count,
          semanticHash: sha256,
        })
        .strict(),
    ),
    summary: z
      .object({
        requestCount: count,
        verifiedRequestCount: count,
        quarantinedRequestCount: count,
        unavailableRequestCount: count,
        tokenCount: count,
        requestMappedTokenCount: count,
        associationPendingTokenCount: count,
        rejectedTokenCount: count,
        unverifiedOffsetAppliedCount: z.literal(0),
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

export const machineCanonicalNonDegradationLedgerSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-canonical-non-degradation-ledger"),
    mode: canonicalAssemblyModeSchema,
    records: z.array(
      z
        .object({
          eventId: z.string().min(1),
          operationId: z.string().min(1),
          operation: z.enum([
            "PRESERVE",
            "TEXT_REPLACE",
            "TIMING_REPLACE",
            "DROP",
            "MERGE",
            "TRUNCATE",
            "TIME_EXPAND",
          ]),
          proposed: z.boolean(),
          accepted: z.boolean(),
          strongTextRetentionPassed: z.boolean(),
          intervalRetentionPassed: z.boolean(),
          trustedTokenBoundaryRetentionPassed: z.boolean(),
          eventCoveragePassed: z.boolean(),
          unsupportedDeletion: z.boolean(),
          unsupportedMerge: z.boolean(),
          unsupportedTimeExpansion: z.boolean(),
          reasons: z.array(z.string().min(1)),
        })
        .strict(),
    ),
    summary: z
      .object({
        evaluatedOperationCount: count,
        acceptedMutationCount: count,
        rejectedMutationCount: count,
        unsupportedStrongTextDeletionCount: z.literal(0),
        unsupportedMergeCount: z.literal(0),
        unsupportedTimeExpansionCount: z.literal(0),
        eventCoverageRegressionCount: z.literal(0),
        runtimeNonDegradationPassed: z.literal(true),
      })
      .strict(),
    beforeTextHash: sha256,
    afterTextHash: sha256,
    beforeTimingHash: sha256,
    afterTimingHash: sha256,
    semanticHash: sha256,
  })
  .strict();

export const machineStageQualityTraceSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-stage-quality-trace"),
    runtimeGoldInputCount: z.literal(0),
    stages: z.array(
      z
        .object({
          stage: z.enum([
            "Raw ASR",
            "Normalized",
            "Candidate",
            "Acoustic Family",
            "Event Assignment",
            "Cluster",
            "Winner",
            "Dedup",
            "Fragment Repair",
            "Canonical Assembly",
            "Segmentation",
            "Final Integrity",
            "Final Machine",
          ]),
          unitCount: count,
          textCharacterCount: count,
          temporalCoverageSeconds: z.number().nonnegative(),
          semanticHash: sha256,
          qualityMetrics: z
            .object({
              goldCoverage: z.number().min(0).max(1),
              normalizedCer: z.number().nonnegative(),
              materialErrorCount: count,
              severeTimingErrorCount: count,
              overlapPairCount: count,
            })
            .strict()
            .nullable(),
          evidence: z.array(z.string().min(1)),
        })
        .strict(),
    ),
    semanticHash: sha256,
  })
  .strict();

export const machineOverlapRootCauseSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-overlap-root-cause"),
    pairs: z.array(
      z
        .object({
          pairId: z.string().min(1),
          leftCueId: z.string().min(1),
          rightCueId: z.string().min(1),
          interval,
          overlapSeconds: z.number().positive(),
          rootCause: z.enum([
            "EVENT_ASSIGNMENT_CONFLICT",
            "CLUSTER_INTERVAL_EXPANSION",
            "MERGE_EXPANSION",
            "AMBIGUOUS_TIME_BASE",
            "TRUE_MULTI_SPEAKER",
            "RAPID_TURN_PADDING",
            "UNKNOWN",
          ]),
          automaticallyResolved: z.boolean(),
          evidence: z.array(z.string().min(1)),
        })
        .strict(),
    ),
    summary: z
      .object({
        overlapPairCount: count,
        eventAssignmentConflictCount: count,
        clusterIntervalExpansionCount: count,
        mergeExpansionCount: count,
        ambiguousTimeBaseCount: count,
        trueMultiSpeakerCount: count,
        rapidTurnPaddingCount: count,
        unknownCount: count,
        automaticallyResolvedCount: count,
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

const qualityMetrics = z
  .object({
    cueCount: count,
    exactCer: z.number().nonnegative(),
    normalizedCer: z.number().nonnegative(),
    goldCoverage: z.number().min(0).max(1),
    missingCount: count,
    hallucinationCount: count,
    materialErrorCount: count,
    severeTimingErrorCount: count,
    startMaeSeconds: z.number().nonnegative(),
    endMaeSeconds: z.number().nonnegative(),
    p95BoundaryErrorSeconds: z.number().nonnegative(),
    meanTemporalIou: z.number().min(0).max(1),
    overlapPairCount: count,
    trustedMappedTokenCount: count,
    ambiguousTokenCount: count,
  })
  .strict();

export const c6013QualityPolicySchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-3-quality-policy"),
    candidateAssociation: candidateAssociationModeSchema,
    canonicalAssembly: canonicalAssemblyModeSchema,
    timelineTransformChain: timelineTransformChainModeSchema,
    runtimeGoldInputCount: z.literal(0),
    productionStatus: z.literal("needs-review"),
    finalizationMethod: z.literal("none"),
    machineOnlyReleaseAuthorized: z.literal(false),
    gates: z
      .object({
        minimumCoverage: z.literal(0.9),
        maximumMissing: z.literal(15),
        maximumHallucinations: z.literal(2),
        maximumMaterialErrors: z.literal(45),
        maximumSevereTimingErrors: z.literal(30),
        maximumNormalizedCer: z.literal(0.55),
        maximumStartMaeSeconds: z.literal(1.2),
        maximumEndMaeSeconds: z.literal(1.2),
        maximumP95BoundaryErrorSeconds: z.literal(3.5),
        maximumOverlapPairs: z.literal(20),
        minimumTrustedMappedTokens: z.literal(500),
        maximumAmbiguousTokens: z.literal(100),
        maximumUnsupportedStrongTextDeletion: z.literal(0),
        maximumUnknownCandidateDrop: z.literal(0),
      })
      .strict(),
    artifactSemanticHashes: z.array(sha256).min(7),
    semanticHash: sha256,
  })
  .strict();

export const c6013AblationSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-3-ablation"),
    stages: z.array(
      z
        .object({
          id: z.enum(["V0", "V1", "V2", "V3", "V4", "V5", "V6", "final"]),
          label: z.string().min(1),
          outputPath: z.string().min(1),
          outputFreezeHash: sha256.nullable(),
          metrics: qualityMetrics.nullable(),
          status: z.enum(["completed", "not-run", "failed"]),
        })
        .strict(),
    ),
    semanticHash: sha256,
  })
  .strict();

export const c6013QualityComparisonSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-3-quality-comparison"),
    baseline: qualityMetrics,
    candidate: qualityMetrics,
    gateResults: z.record(z.string(), z.boolean()),
    outcome: z.enum(["GO", "HOLD_FOR_MORE_ASSOCIATION_ASSEMBLY_RECOVERY"]),
    semanticHash: sha256,
  })
  .strict();

export const c6013ValidationSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-3-validation"),
    branch: z.literal(
      "codex/c6-0-1-3-candidate-association-canonical-assembly",
    ),
    repositoryCommit: z.string().regex(/^[a-f0-9]{40}$/u),
    sourceMediaSha256: sha256,
    runtimeGoldInputCount: z.literal(0),
    checks: z.array(
      z
        .object({
          id: z.string().min(1),
          passed: z.boolean(),
          evidence: z.array(z.string().min(1)),
        })
        .strict(),
    ),
    finalABSemanticParity: z.boolean(),
    datasetHardcodingFindingCount: z.literal(0),
    outcome: z.enum(["GO", "HOLD_FOR_MORE_ASSOCIATION_ASSEMBLY_RECOVERY"]),
    semanticHash: sha256,
  })
  .strict();

export type CandidateAssociationMode = z.infer<
  typeof candidateAssociationModeSchema
>;
export type CanonicalAssemblyMode = z.infer<typeof canonicalAssemblyModeSchema>;
export type TimelineTransformChainMode = z.infer<
  typeof timelineTransformChainModeSchema
>;
export type MachineCandidateAssociationLedger = z.infer<
  typeof machineCandidateAssociationLedgerSchema
>;
export type MachineCanonicalEvents = z.infer<
  typeof machineCanonicalEventsSchema
>;
export type MachineCanonicalAssembly = z.infer<
  typeof machineCanonicalAssemblySchema
>;
export type MachineSupportedTextRetention = z.infer<
  typeof machineSupportedTextRetentionSchema
>;
export type MachineTimelineTransformChain = z.infer<
  typeof machineTimelineTransformChainSchema
>;
export type MachineCanonicalNonDegradationLedger = z.infer<
  typeof machineCanonicalNonDegradationLedgerSchema
>;
export type MachineStageQualityTrace = z.infer<
  typeof machineStageQualityTraceSchema
>;
export type MachineOverlapRootCause = z.infer<
  typeof machineOverlapRootCauseSchema
>;
