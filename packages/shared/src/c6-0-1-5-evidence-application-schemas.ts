import { z } from "zod";

import { c6014QualityMetricsSchema } from "./c6-0-1-4-vad-variant-reasr-schemas.js";

export const c6015PolicyVersion =
  "c6.0.1.5-evidence-to-canonical-raw-asr-recovery-v1" as const;

export const c6015ModeSchema = z.enum(["off", "observe", "enforce"]);

const schemaVersion = z.literal("1.0.0");
const policyVersion = z.literal(c6015PolicyVersion);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const count = z.number().int().nonnegative();
const ratio = z.number().min(0).max(1);
const interval = z
  .object({ start: z.number().nonnegative(), end: z.number().positive() })
  .strict()
  .refine((value) => value.end > value.start, {
    message: "Interval end must be greater than start.",
  });
const artifactHeader = {
  schemaVersion,
  policyVersion,
  generatedAt: z.iso.datetime(),
} as const;

export const lineageStatusSchema = z.enum([
  "EXACT_ONE_TO_ONE",
  "ONE_TO_MANY",
  "MANY_TO_ONE",
  "SUPERSEDED",
  "DROPPED",
  "AMBIGUOUS",
  "UNRESOLVED",
]);

export const lineageRelationSchema = z
  .object({
    relationId: z.string().min(1),
    relationType: z.enum([
      "CANONICAL_ASSEMBLY",
      "SPLIT",
      "MERGE",
      "DEDUPE",
      "DROP",
      "TIMING_PROJECTION",
      "TEXT_PROJECTION",
      "FINAL_SURVIVAL",
      "IDENTITY",
    ]),
    sourceIds: z.array(z.string().min(1)).min(1),
    targetIds: z.array(z.string().min(1)),
    operationArtifact: z.string().min(1),
    reason: z.string().min(1),
    semanticHash: sha256,
  })
  .strict();

export const machineEventToFinalCueLineageSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-event-to-final-cue-lineage"),
    mode: c6015ModeSchema,
    identityPolicy: z.literal("operation-history-only-no-time-nearest"),
    events: z.array(
      z
        .object({
          eventId: z.string().min(1),
          sourceCandidateIds: z.array(z.string().min(1)).min(1),
          canonicalCueIds: z.array(z.string().min(1)).min(1),
          finalCueIds: z.array(z.string().min(1)),
          lineageOperations: z.array(lineageRelationSchema),
          splitRelations: z.array(lineageRelationSchema),
          mergeRelations: z.array(lineageRelationSchema),
          dedupeRelations: z.array(lineageRelationSchema),
          droppedRelations: z.array(lineageRelationSchema),
          timingProjectionRelations: z.array(lineageRelationSchema),
          textProjectionRelations: z.array(lineageRelationSchema),
          lineageStatus: lineageStatusSchema,
          blockers: z.array(z.string().min(1)),
          modifiable: z.boolean(),
          semanticHash: sha256,
        })
        .strict(),
    ),
    finalCueCoverage: z.array(
      z
        .object({
          finalCueId: z.string().min(1),
          eventIds: z.array(z.string().min(1)).min(1),
          semanticHash: sha256,
        })
        .strict(),
    ),
    summary: z
      .object({
        eventCount: count,
        finalCueCount: count,
        exactOneToOneCount: count,
        oneToManyCount: count,
        manyToOneCount: count,
        supersededCount: count,
        droppedCount: count,
        ambiguousCount: count,
        unresolvedCount: count,
        explicitEventLineageCount: count,
        coveredFinalCueCount: count,
        lineageCoverageRatio: ratio,
        timeNearestIdentityCount: z.literal(0),
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

export const decoderEvidenceSchema = z
  .object({
    status: z.enum(["available", "unavailable", "unknown", "not-applicable"]),
    averageLogProbability: z.number().nullable(),
    noSpeechProbability: z.number().min(0).max(1).nullable(),
    compressionRatio: z.number().nonnegative().nullable(),
    repetitionRatio: ratio.nullable(),
    tokenTimingQuality: ratio.nullable(),
    textDensity: z.number().nonnegative().nullable(),
    edgePosition: z
      .enum(["inside", "left-edge", "right-edge", "both-edges"])
      .nullable(),
    fallbackLevel: count.nullable(),
    temperature: z.number().nonnegative().nullable(),
    requestDurationSeconds: z.number().positive().nullable(),
    decoderEvidenceHash: sha256.nullable(),
    unavailableReasons: z.array(z.string().min(1)),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.status !== "available" &&
      [
        value.averageLogProbability,
        value.noSpeechProbability,
        value.compressionRatio,
        value.repetitionRatio,
        value.tokenTimingQuality,
        value.textDensity,
        value.edgePosition,
        value.fallbackLevel,
        value.temperature,
        value.requestDurationSeconds,
        value.decoderEvidenceHash,
      ].some((entry) => entry !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message:
          "Unavailable decoder evidence must not contain fabricated values.",
      });
    }
  });

export const variantEvidenceSchema = z
  .object({
    variantId: z.string().min(1),
    eventId: z.string().min(1),
    candidateId: z.string().min(1),
    requestIds: z.array(z.string().min(1)),
    sourceWindowIds: z.array(z.string().min(1)),
    tokenIds: z.array(z.string().min(1)),
    trustedGlobalTokenIds: z.array(z.string().min(1)),
    tokenCoverage: z
      .object({
        lexicalTokenCount: count,
        supportedLexicalTokenCount: count,
        coverageRatio: ratio,
        variantSpecific: z.literal(true),
        representativeTokenLeakCount: z.literal(0),
      })
      .strict(),
    ctcEvidenceIds: z.array(z.string().min(1)),
    ctcScore: z.number().min(0).max(1).nullable(),
    decoderEvidence: decoderEvidenceSchema,
    edgeEvidence: z
      .object({
        leftEdgeRisk: z.boolean(),
        rightEdgeRisk: z.boolean(),
        evidenceIds: z.array(z.string().min(1)),
      })
      .strict(),
    speechCoverage: ratio,
    independentSupportGroups: z.array(z.string().min(1)),
    correlatedSupportGroups: z.array(z.string().min(1)),
    reAsrOrigin: z
      .object({
        isReAsr: z.boolean(),
        requestFamilyIds: z.array(z.string().min(1)),
        sourceGlobalVerified: z.boolean(),
        promptIsolated: z.boolean(),
      })
      .strict(),
    evidenceCompleteness: z.enum(["COMPLETE", "PARTIAL", "UNAVAILABLE"]),
    blockers: z.array(z.string().min(1)),
    semanticHash: sha256,
  })
  .strict();

export const machineVariantEvidenceBundleSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-variant-evidence-bundle"),
    mode: c6015ModeSchema,
    tokenAssociationPolicy: z.literal("variant-id-only"),
    variants: z.array(variantEvidenceSchema),
    summary: z
      .object({
        eventCount: count,
        variantEvidenceCount: count,
        completeCount: count,
        partialCount: count,
        unavailableCount: count,
        reAsrVariantCount: count,
        trustedTokenConsumedCount: count,
        representativeTokenLeakCount: z.literal(0),
        fabricatedDecoderZeroCount: z.literal(0),
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

export const machineCandidatePoolC6015Schema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-candidate-pool-c6-0-1-5"),
    mode: c6015ModeSchema,
    candidates: z.array(
      z
        .object({
          variantId: z.string().min(1),
          eventId: z.string().min(1),
          candidateId: z.string().min(1),
          text: z.string().min(1),
          textHash: sha256,
          interval,
          eventInterval: interval,
          requestIds: z.array(z.string().min(1)),
          sourceWindowIds: z.array(z.string().min(1)),
          independentSupportGroups: z.array(z.string().min(1)),
          correlatedSupportGroups: z.array(z.string().min(1)),
          origin: z.enum([
            "baseline-machine-candidate",
            "c6.0.1.4-targeted-reasr",
            "c6.0.1.5-raw-reasr",
          ]),
          sourceGlobalVerified: z.boolean(),
          promptIsolated: z.boolean(),
          variantEvidenceSemanticHash: sha256,
          evidenceCompleteness: z.enum(["COMPLETE", "PARTIAL", "UNAVAILABLE"]),
          selected: z.boolean(),
          semanticHash: sha256,
        })
        .strict(),
    ),
    events: z.array(
      z
        .object({
          eventId: z.string().min(1),
          currentVariantId: z.string().min(1),
          selectedVariantId: z.string().min(1),
          candidateIds: z.array(z.string().min(1)).min(1),
          rawRecoveryCandidateIds: z.array(z.string().min(1)),
          poolSizeBeforeRawRecovery: count,
          poolSizeAfterRawRecovery: count,
          selectionChanged: z.boolean(),
          replacementProposalId: z.string().min(1).nullable(),
          semanticHash: sha256,
        })
        .strict(),
    ),
    summary: z
      .object({
        eventCount: count,
        candidateCount: count,
        baselineCandidateCount: count,
        c6014TargetedReAsrCandidateCount: count,
        c6015RawReAsrCandidateCount: count,
        completeEvidenceCandidateCount: count,
        incompleteEvidenceCandidateCount: count,
        selectedRawReAsrCandidateCount: count,
        selectionChangedEventCount: count,
        freeRewriteCount: z.literal(0),
        candidateTextPromptLeakCount: z.literal(0),
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

export const mutationProposalTypeSchema = z.enum([
  "TEXT_VARIANT_REPLACE",
  "REASR_TEXT_REPLACE",
  "START_TIME_REFINE",
  "END_TIME_REFINE",
  "BOTH_BOUNDARIES_REFINE",
  "SPLIT_CUE",
  "MERGE_CUE",
  "DROP_HALLUCINATION",
  "NO_OP",
]);

export const mutationApplyStatusSchema = z.enum([
  "PROPOSED",
  "ACCEPTED",
  "REJECTED",
  "APPLIED",
  "ROLLED_BACK",
  "NO_OP",
]);

export const canonicalMutationProposalSchema = z
  .object({
    proposalId: z.string().min(1),
    eventId: z.string().min(1),
    finalCueIds: z.array(z.string().min(1)).min(1),
    proposalType: mutationProposalTypeSchema,
    fromVariantId: z.string().min(1).nullable(),
    toVariantId: z.string().min(1).nullable(),
    beforeText: z.string(),
    afterText: z.string(),
    beforeTiming: z.array(interval).min(1),
    afterTiming: z.array(interval).min(1),
    evidenceIds: z.array(z.string().min(1)).min(1),
    evidenceTier: z.enum(["NONE", "WEAK", "MEDIUM", "STRONG"]),
    evidenceDominance: z.enum([
      "STRICTLY_STRONGER",
      "NON_DEGRADING",
      "INCOMPARABLE",
      "WEAKER",
    ]),
    lineageVerified: z.boolean(),
    nonDegradationPassed: z.boolean(),
    safetyPassed: z.boolean(),
    applyStatus: mutationApplyStatusSchema,
    rejectionReasons: z.array(z.string().min(1)),
    oracleInfo: z.literal("evaluation-only-not-runtime-input"),
    semanticHash: sha256,
  })
  .strict();

export const machineCanonicalMutationProposalsSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-canonical-mutation-proposals"),
    mode: c6015ModeSchema,
    proposals: z.array(canonicalMutationProposalSchema),
    summary: z
      .object({
        proposedCount: count,
        acceptedCount: count,
        rejectedCount: count,
        noOpCount: count,
        textProposalCount: count,
        timingProposalCount: count,
        structuralObserveOnlyCount: count,
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

export const machineCanonicalMutationLedgerSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-canonical-mutation-ledger"),
    mode: c6015ModeSchema,
    records: z.array(
      z
        .object({
          proposalId: z.string().min(1),
          eventId: z.string().min(1),
          finalCueIds: z.array(z.string().min(1)).min(1),
          applyStatus: mutationApplyStatusSchema,
          reasons: z.array(z.string().min(1)).min(1),
          canonicalHashBefore: sha256,
          canonicalHashAfter: sha256,
          packageHashBefore: sha256,
          packageHashAfter: sha256,
          renderedSrtHashBefore: sha256,
          renderedSrtHashAfter: sha256,
          renderedVttHashBefore: sha256,
          renderedVttHashAfter: sha256,
          renderedAssHashBefore: sha256,
          renderedAssHashAfter: sha256,
          lineageStillValid: z.boolean(),
          strictPackageValidationPassed: z.boolean(),
          renderedOutputChanged: z.boolean(),
          semanticHash: sha256,
        })
        .strict(),
    ),
    summary: z
      .object({
        proposedCount: count,
        acceptedCount: count,
        rejectedCount: count,
        appliedCount: count,
        rolledBackCount: count,
        textMutationAppliedCount: count,
        timingMutationAppliedCount: count,
        textChangedFinalCueCount: count,
        timingChangedFinalCueCount: count,
        unsupportedMutationCount: z.literal(0),
        finalArtifactMutationCount: count,
      })
      .strict(),
    finalHashes: z
      .object({
        canonicalTextHash: sha256,
        canonicalTimingHash: sha256,
        packageHash: sha256,
        srtHash: sha256,
        vttHash: sha256,
        assHash: sha256,
        presentationHash: sha256,
      })
      .strict(),
    noOpReason: z.array(z.string().min(1)),
    semanticHash: sha256,
  })
  .strict();

export const machineTrustedTokenTimingProposalsSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-trusted-token-timing-proposals"),
    mode: c6015ModeSchema,
    paddingPolicy: z
      .object({
        policyVersion: z.literal("c6.0.1.5-fixed-token-padding-v1"),
        startSeconds: z.literal(0.04),
        endSeconds: z.literal(0.08),
        goldTuned: z.literal(false),
      })
      .strict(),
    proposals: z.array(
      z
        .object({
          proposalId: z.string().min(1),
          cueId: z.string().min(1),
          eventId: z.string().min(1),
          trustedTokenIds: z.array(z.string().min(1)),
          lexicalCoverage: ratio,
          beforeInterval: interval,
          tokenSpan: interval.nullable(),
          proposedInterval: interval.nullable(),
          padding: z
            .object({
              startSeconds: z.number().nonnegative(),
              endSeconds: z.number().nonnegative(),
            })
            .strict(),
          confidenceClass: z.enum(["HIGH", "MEDIUM", "LOW", "UNAVAILABLE"]),
          proposalStatus: z.enum([
            "ELIGIBLE",
            "GENERATED",
            "ACCEPTED",
            "REJECTED",
            "APPLIED",
            "UNCHANGED",
          ]),
          blockers: z.array(z.string().min(1)),
          semanticHash: sha256,
        })
        .strict(),
    ),
    summary: z
      .object({
        timingEligibleCueCount: count,
        proposalEligibleCount: count,
        proposalGeneratedCount: count,
        proposalAcceptedCount: count,
        proposalRejectedCount: count,
        mutationAppliedCount: count,
        unchangedCount: count,
        lineageFailedCount: count,
        tokenCoverageFailedCount: count,
        overlapBlockedCount: count,
        evidenceApplicationPassed: z.boolean(),
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

export const singleVariantAuditStatusSchema = z.enum([
  "VERIFIED_STRONG",
  "ACCEPTABLE",
  "ACOUSTICALLY_WEAK",
  "INCOMPLETE_SPEECH_SPAN",
  "EDGE_TRUNCATED",
  "TOKEN_CONFLICT",
  "LOW_CTC_SUPPORT",
  "DECODER_LOW_CONFIDENCE",
  "UNKNOWN",
]);

export const machineSingleVariantAcousticAuditSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-single-variant-acoustic-audit"),
    mode: c6015ModeSchema,
    events: z.array(
      z
        .object({
          eventId: z.string().min(1),
          candidateId: z.string().min(1),
          auditStatus: singleVariantAuditStatusSchema,
          acousticEvidence: z
            .object({
              ctcEvidenceIds: z.array(z.string().min(1)),
              ctcScore: z.number().min(0).max(1).nullable(),
              pronunciationCoverage: ratio,
              acousticCompleteness: ratio,
            })
            .strict(),
          tokenCoverage: ratio,
          decoderEvidence: decoderEvidenceSchema,
          speechCoverage: ratio,
          edgeRisk: z.boolean(),
          repetitionRisk: ratio,
          independentWindowSupportCount: count,
          reAsrEligibility: z.boolean(),
          reasons: z.array(z.string().min(1)).min(1),
          semanticHash: sha256,
        })
        .strict(),
    ),
    summary: z
      .object({
        singleVariantEventCount: count,
        auditedCount: count,
        verifiedStrongCount: count,
        acceptableCount: count,
        suspiciousCount: count,
        reAsrEligibleCount: count,
        unknownCount: count,
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

export const machineRawAsrEventRecoverySchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-raw-asr-event-recovery"),
    mode: c6015ModeSchema,
    maximumRequestsPerEvent: z.literal(3),
    episodeRequestBudget: z.number().int().positive(),
    events: z.array(
      z
        .object({
          eventId: z.string().min(1),
          triggerReasons: z.array(z.string().min(1)).min(1),
          requestIds: z.array(z.string().min(1)).max(3),
          requestFamilyIds: z.array(z.string().min(1)).max(3),
          sourceGlobalVerified: z.boolean(),
          candidateTextPromptUsed: z.literal(false),
          requestsExecuted: count,
          cacheHitCount: count,
          inferenceCount: count,
          modelLoadCount: count,
          newCandidateIds: z.array(z.string().min(1)),
          evaluatedCandidateIds: z.array(z.string().min(1)),
          selectedCandidateId: z.string().min(1).nullable(),
          semanticHash: sha256,
        })
        .strict(),
    ),
    summary: z
      .object({
        suspiciousSingleVariantCount: count,
        triggeredSingleVariantCount: count,
        multiVariantTriggeredCount: count,
        requestCount: count,
        cacheHitCount: count,
        inferenceCount: count,
        modelLoadCount: count,
        workerStartCount: count,
        newCandidateCount: count,
        improvedPoolRuntimeProxyCount: count,
        replacedByReAsrCount: count,
        unresolvedCount: count,
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

export const machineLocalAssociationRepairProposalsSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-local-association-repair-proposals"),
    mode: z.enum(["off", "observe"]),
    proposals: z.array(
      z
        .object({
          proposalId: z.string().min(1),
          sourceEventId: z.string().min(1),
          targetEventId: z.string().min(1),
          candidateId: z.string().min(1),
          evidenceIds: z.array(z.string().min(1)).min(1),
          reason: z.string().min(1),
          risk: z.enum(["LOW", "MEDIUM", "HIGH"]),
          applyEligibility: z.literal("observe-only"),
          semanticHash: sha256,
        })
        .strict(),
    ),
    summary: z
      .object({
        inspectedEventCount: count,
        proposalCount: count,
        appliedCount: z.literal(0),
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

export const machineEvidenceApplicationCoverageSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-evidence-application-coverage"),
    trustedTokenCount: count,
    trustedTokenConsumedCount: count,
    timingEligibleCueCount: count,
    timingProposalCount: count,
    timingAppliedCount: count,
    ctcEvidenceCount: count,
    ctcEvidenceConsumedCount: count,
    reAsrCandidateCount: count,
    reAsrCandidateEvaluatedCount: count,
    reAsrCandidateSelectedCount: count,
    variantEvidenceCount: count,
    variantDecisionCount: count,
    replacementProposalCount: count,
    replacementAppliedCount: count,
    eventFinalLineageCoverage: ratio,
    finalArtifactMutationCount: count,
    stages: z
      .object({
        produced: count,
        eligible: count,
        consumed: count,
        proposalGenerated: count,
        applied: count,
        affectedFinalOutput: count,
      })
      .strict(),
    blockerReasons: z.array(z.string().min(1)),
    engineeringGatePassed: z.boolean(),
    semanticHash: sha256,
  })
  .strict();

export const c6015QualityPolicySchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-5-quality-policy"),
    evidenceToCanonical: c6015ModeSchema,
    singleVariantAudit: c6015ModeSchema,
    rawAsrEventRecovery: c6015ModeSchema,
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
        maximumRawAsrOriginErrors: z.literal(30),
        maximumAssociationErrors: z.literal(10),
        maximumNormalizedCer: z.literal(0.55),
        maximumSevereTimingErrors: z.literal(30),
        maximumStartMaeSeconds: z.literal(1.2),
        maximumEndMaeSeconds: z.literal(1.2),
        maximumP95BoundaryErrorSeconds: z.literal(3.5),
        maximumOverlapPairs: z.literal(20),
        minimumEventFinalLineageCoverage: z.literal(0.95),
        maximumUnsupportedMutationCount: z.literal(0),
        maximumRuntimeGoldInputCount: z.literal(0),
        maximumDatasetHardcodingCount: z.literal(0),
        maximumUnsafeFinalizationEscapeCount: z.literal(0),
      })
      .strict(),
    mutationPolicy: z
      .object({
        textReplacementMinimumEvidenceTier: z.literal("STRONG"),
        minimumTokenCoverage: z.literal(0.8),
        structuralMutationMode: z.literal("observe-only"),
        candidateTextPromptAllowed: z.literal(false),
        goldRuntimeInputAllowed: z.literal(false),
        maximumRequestsPerEvent: z.literal(3),
        episodeRequestBudget: z.number().int().positive(),
      })
      .strict(),
    artifactSemanticHashes: z.array(sha256).min(8),
    semanticHash: sha256,
  })
  .strict();

export const c6015QualityMetricsSchema = c6014QualityMetricsSchema
  .extend({
    rawAsrOriginErrorCount: count,
    associationErrorCount: count,
    eventFinalLineageCoverage: ratio,
    unsupportedMutationCount: count,
  })
  .strict();

export const c6015AblationSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-5-ablation"),
    stages: z.array(
      z
        .object({
          id: z.enum([
            "V0",
            "V1",
            "V2",
            "V3",
            "V4",
            "V5",
            "V6",
            "V7",
            "full",
            "final-a",
            "final-b",
          ]),
          label: z.string().min(1),
          outputPath: z.string().min(1),
          outputFreezeHash: sha256.nullable(),
          metrics: c6015QualityMetricsSchema.nullable(),
          status: z.enum(["completed", "not-run", "failed"]),
          modelExecutionHash: sha256,
        })
        .strict(),
    ),
    semanticHash: sha256,
  })
  .strict();

export const c6015QualityComparisonSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-5-quality-comparison"),
    rawAsr: c6015QualityMetricsSchema,
    baseline: c6015QualityMetricsSchema,
    candidate: c6015QualityMetricsSchema,
    gateResults: z.record(z.string(), z.boolean()),
    rawErrorDetection: z
      .object({
        rawOriginErrorCount: count,
        rawOriginFlaggedByMachine: count,
        rawOriginMissedByMachine: count,
        machineFalsePositiveWeakEvents: count,
        precision: ratio,
        recall: ratio,
      })
      .strict(),
    engineeringGatePassed: z.boolean(),
    qualityGatePassed: z.boolean(),
    outcome: z.enum(["GO_C6_0_2", "HOLD_FOR_MORE_RAW_ASR_RECOVERY"]),
    semanticHash: sha256,
  })
  .strict();

export const c6015ValidationSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-5-validation"),
    branch: z.literal("codex/c6-0-1-5-evidence-to-canonical-raw-asr-recovery"),
    repositoryCommit: z.string().regex(/^[a-f0-9]{40}$/u),
    sourceMediaSha256: sha256,
    goldSha256: sha256,
    sourceReadOnlyVerified: z.boolean(),
    goldReadOnlyVerified: z.boolean(),
    runtimeGoldInputCount: z.literal(0),
    datasetHardcodingFindingCount: z.literal(0),
    unsafeFinalizationEscapeCount: z.literal(0),
    checks: z.array(
      z
        .object({
          id: z.string().min(1),
          passed: z.boolean(),
          evidence: z.array(z.string().min(1)),
        })
        .strict(),
    ),
    finalABParity: z
      .object({
        text: z.boolean(),
        timing: z.boolean(),
        presentation: z.boolean(),
        lineage: z.boolean(),
        variantBundles: z.boolean(),
        singleVariantAudit: z.boolean(),
        reAsrTriggers: z.boolean(),
        mutationProposals: z.boolean(),
        mutationApplication: z.boolean(),
        shadowOutcome: z.boolean(),
      })
      .strict(),
    productionStatus: z.literal("needs-review"),
    finalizationMethod: z.literal("none"),
    machineOnlyReleaseAuthorized: z.literal(false),
    engineeringGatePassed: z.boolean(),
    qualityGatePassed: z.boolean(),
    outcome: z.enum(["GO_C6_0_2", "HOLD_FOR_MORE_RAW_ASR_RECOVERY"]),
    semanticHash: sha256,
  })
  .strict();

export type C6015Mode = z.infer<typeof c6015ModeSchema>;
export type LineageStatus = z.infer<typeof lineageStatusSchema>;
export type LineageRelation = z.infer<typeof lineageRelationSchema>;
export type MachineEventToFinalCueLineage = z.infer<
  typeof machineEventToFinalCueLineageSchema
>;
export type DecoderEvidence = z.infer<typeof decoderEvidenceSchema>;
export type VariantEvidence = z.infer<typeof variantEvidenceSchema>;
export type MachineVariantEvidenceBundle = z.infer<
  typeof machineVariantEvidenceBundleSchema
>;
export type MachineCandidatePoolC6015 = z.infer<
  typeof machineCandidatePoolC6015Schema
>;
export type CanonicalMutationProposal = z.infer<
  typeof canonicalMutationProposalSchema
>;
export type MachineCanonicalMutationProposals = z.infer<
  typeof machineCanonicalMutationProposalsSchema
>;
export type MachineCanonicalMutationLedger = z.infer<
  typeof machineCanonicalMutationLedgerSchema
>;
export type MachineTrustedTokenTimingProposals = z.infer<
  typeof machineTrustedTokenTimingProposalsSchema
>;
export type SingleVariantAuditStatus = z.infer<
  typeof singleVariantAuditStatusSchema
>;
export type MachineSingleVariantAcousticAudit = z.infer<
  typeof machineSingleVariantAcousticAuditSchema
>;
export type MachineRawAsrEventRecovery = z.infer<
  typeof machineRawAsrEventRecoverySchema
>;
export type MachineLocalAssociationRepairProposals = z.infer<
  typeof machineLocalAssociationRepairProposalsSchema
>;
export type MachineEvidenceApplicationCoverage = z.infer<
  typeof machineEvidenceApplicationCoverageSchema
>;
export type C6015QualityPolicy = z.infer<typeof c6015QualityPolicySchema>;
export type C6015QualityMetrics = z.infer<typeof c6015QualityMetricsSchema>;
export type C6015Ablation = z.infer<typeof c6015AblationSchema>;
export type C6015QualityComparison = z.infer<
  typeof c6015QualityComparisonSchema
>;
export type C6015Validation = z.infer<typeof c6015ValidationSchema>;
