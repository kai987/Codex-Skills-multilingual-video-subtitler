import { z } from "zod";

import { c6015QualityMetricsSchema } from "./c6-0-1-5-evidence-application-schemas.js";

export const c6016PolicyVersion =
  "c6.0.1.6-acoustic-risk-span-text-joint-boundary-v1" as const;

export const c6016ModeSchema = z.enum(["off", "observe", "enforce"]);
export const riskSeveritySchema = z.enum(["NONE", "WEAK", "STRONG", "UNKNOWN"]);
export const riskCorrelationGroupSchema = z.enum([
  "REQUEST_EDGE",
  "CTC",
  "TOKEN",
  "SPEECH_VAD",
  "DECODER",
  "CROSS_WINDOW",
  "TEXT_SHAPE",
  "ASSOCIATION",
  "OVERLAP",
]);

const schemaVersion = z.literal("1.0.0");
const policyVersion = z.literal(c6016PolicyVersion);
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

const riskFactNames = [
  "requestEdgeRisk",
  "ctcWeak",
  "ctcUnscorable",
  "tokenWeak",
  "tokenConflict",
  "speechIncomplete",
  "decoderWeak",
  "decoderUnknown",
  "independentWindowDisagreement",
  "repetitionRisk",
  "noSpeechConflict",
  "durationTextAnomaly",
  "pronunciationCoverageWeak",
  "associationAmbiguity",
  "overlapRisk",
] as const;

export const riskFactNameSchema = z.enum(riskFactNames);

export const requestEdgeRiskEntrySchema = z
  .object({
    eventId: z.string().min(1),
    candidateId: z.string().min(1),
    requestId: z.string().min(1),
    requestInterval: interval,
    candidateInterval: interval,
    leftDistance: z.number().nonnegative(),
    rightDistance: z.number().nonnegative(),
    nearLeftRequestEdge: z.boolean(),
    nearRightRequestEdge: z.boolean(),
    speechContinuationLeft: z.boolean(),
    speechContinuationRight: z.boolean(),
    tokenEdgeContact: z.boolean(),
    ctcIncomplete: z.boolean(),
    decoderSuggestsTruncation: z.boolean(),
    independentContinuation: z.boolean(),
    incompleteAcousticSpan: z.boolean(),
    edgeRisk: riskSeveritySchema,
    strongEdgeRisk: z.boolean(),
    evidenceIds: z.array(z.string().min(1)),
    reasons: z.array(z.string().min(1)),
    semanticHash: sha256,
  })
  .strict();

export const machineRequestEdgeRiskSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-request-edge-risk"),
    mode: c6016ModeSchema,
    indexingPolicy: z.literal("source-global-seconds-request-relative"),
    thresholdPolicy: z.literal("frozen-machine-only-v1"),
    edgeDistanceThresholdSeconds: z.number().positive(),
    candidates: z.array(requestEdgeRiskEntrySchema),
    summary: z
      .object({
        candidateCount: count,
        strongRiskCount: count,
        weakRiskCount: count,
        noRiskCount: count,
        unknownRiskCount: count,
        requestIntervalMissingCount: count,
        legacyEventEdgeClassificationCount: z.literal(0),
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

export const acousticRiskFactSchema = z
  .object({
    name: riskFactNameSchema,
    severity: riskSeveritySchema,
    correlationGroup: riskCorrelationGroupSchema,
    evidenceIds: z.array(z.string().min(1)),
    reasons: z.array(z.string().min(1)),
  })
  .strict();

export const acousticRiskVectorEntrySchema = z
  .object({
    eventId: z.string().min(1),
    candidateId: z.string().min(1),
    facts: z.array(acousticRiskFactSchema).length(riskFactNames.length),
    strongRiskCount: count,
    weakRiskCount: count,
    independentWeakRiskCount: count,
    activeCorrelationGroups: z.array(riskCorrelationGroupSchema),
    recommendedAction: z.enum(["KEEP", "VERIFY", "RE_ASR", "REVIEW"]),
    reasons: z.array(z.string().min(1)),
    semanticHash: sha256,
  })
  .strict()
  .superRefine((value, context) => {
    const names = new Set(value.facts.map((fact) => fact.name));
    if (names.size !== riskFactNames.length) {
      context.addIssue({
        code: "custom",
        path: ["facts"],
        message: "Every risk fact must be present exactly once.",
      });
    }
  });

export const machineAcousticRiskVectorSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-acoustic-risk-vector"),
    mode: c6016ModeSchema,
    decisionPolicy: z.literal("multi-label-no-magic-total-score"),
    events: z.array(acousticRiskVectorEntrySchema),
    summary: z
      .object({
        eventCount: count,
        multiRiskEventCount: count,
        keepCount: count,
        verifyCount: count,
        reAsrCount: count,
        reviewCount: count,
        strongRiskEventCount: count,
        independentWeakRiskEventCount: count,
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

export const reAsrPriorityEntrySchema = z
  .object({
    eventId: z.string().min(1),
    candidateId: z.string().min(1),
    riskFacts: z.array(acousticRiskFactSchema),
    correlationGroups: z.array(riskCorrelationGroupSchema),
    strongRiskCount: count,
    independentWeakRiskCount: count,
    evidenceDiversityCount: count,
    recoverabilitySignals: z.array(z.string().min(1)),
    recommendedAction: z.enum(["KEEP", "VERIFY", "RE_ASR", "REVIEW"]),
    priorityClass: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "NONE"]),
    selectionReason: z.string().min(1),
    stableTieBreakHash: sha256,
    budgetSelected: z.boolean(),
    semanticHash: sha256,
  })
  .strict();

export const machineReAsrPrioritySchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-reasr-priority"),
    mode: c6016ModeSchema,
    eligibilityPolicy: z.literal("one-strong-or-two-independent-weak"),
    orderingPolicy: z.literal(
      "priority-diversity-recoverability-stable-hash-no-event-id",
    ),
    episodeRequestBudget: z.number().int().positive(),
    maximumRequestsPerEvent: z.number().int().positive(),
    events: z.array(reAsrPriorityEntrySchema),
    summary: z
      .object({
        eventCount: count,
        eligibleCount: count,
        budgetSelectedCount: count,
        budgetExhaustedCount: count,
        requestBudgetUsed: count,
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

const decoderFieldAvailabilitySchema = z.enum([
  "available",
  "unavailable",
  "unsupported",
  "unknown",
]);

const optionalDecoderNumberSchema = z
  .object({
    availability: decoderFieldAvailabilitySchema,
    value: z.number().nullable(),
    reason: z.string().min(1).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.availability === "available" && value.value === null) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "Available field needs a value.",
      });
    }
    if (value.availability !== "available" && value.value !== null) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "Unavailable fields must remain null.",
      });
    }
  });

const optionalDecoderBooleanSchema = z
  .object({
    availability: decoderFieldAvailabilitySchema,
    value: z.boolean().nullable(),
    reason: z.string().min(1).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.availability === "available" && value.value === null) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "Available field needs a value.",
      });
    }
    if (value.availability !== "available" && value.value !== null) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "Unavailable fields must remain null.",
      });
    }
  });

export const decoderEvidenceEntrySchema = z
  .object({
    eventId: z.string().min(1),
    candidateId: z.string().min(1),
    requestId: z.string().min(1),
    candidateFamily: z.enum([
      "PRIMARY",
      "RECOVERY",
      "TARGETED_RE_ASR",
      "RAW_RE_ASR",
    ]),
    decoderProvider: z.string().min(1),
    availability: decoderFieldAvailabilitySchema,
    fields: z
      .object({
        averageLogProbability: optionalDecoderNumberSchema,
        noSpeechProbability: optionalDecoderNumberSchema,
        compressionRatio: optionalDecoderNumberSchema,
        temperature: optionalDecoderNumberSchema,
        fallbackCount: optionalDecoderNumberSchema,
        decoderSegmentStart: optionalDecoderNumberSchema,
        decoderSegmentEnd: optionalDecoderNumberSchema,
        tokenTimestampAvailable: optionalDecoderBooleanSchema,
        tokenCount: optionalDecoderNumberSchema,
        requestEdgeDistance: optionalDecoderNumberSchema,
        languageProbability: optionalDecoderNumberSchema,
      })
      .strict(),
    confidenceDiagnostics: z.array(z.string().min(1)),
    provenance: z
      .object({
        sourceArtifact: z.string().min(1),
        sourceRequestId: z.string().min(1),
        providerResponseRetained: z.boolean(),
        sourceGlobalVerified: z.boolean(),
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

export const machineDecoderEvidenceSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-decoder-evidence"),
    mode: c6016ModeSchema,
    missingFieldPolicy: z.literal(
      "explicit-unavailable-unsupported-or-unknown-never-zero",
    ),
    candidates: z.array(decoderEvidenceEntrySchema),
    summary: z
      .object({
        candidateCount: count,
        availableCount: count,
        unavailableCount: count,
        unsupportedCount: count,
        unknownCount: count,
        primaryCoverage: ratio,
        recoveryCoverage: ratio,
        reAsrCoverage: ratio,
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

export const textSpanLineageStatusSchema = z.enum([
  "EXACT",
  "NORMALIZED_EXACT",
  "DERIVED_FROM_SPLIT",
  "DERIVED_FROM_MERGE",
  "AMBIGUOUS",
  "UNRESOLVED",
]);

export const eventFinalTextSpanSchema = z
  .object({
    eventId: z.string().min(1),
    finalCueId: z.string().min(1).nullable(),
    finalText: z.string(),
    spanStart: count.nullable(),
    spanEnd: count.nullable(),
    spanText: z.string().nullable(),
    sourceCandidateIds: z.array(z.string().min(1)).min(1),
    alignmentMethod: z.enum([
      "PROVENANCE_EXACT_SUBSTRING",
      "PROVENANCE_NORMALIZATION_MAP",
      "SEGMENTATION_SPLIT_HISTORY",
      "SEGMENTATION_MERGE_HISTORY",
      "UNRESOLVED",
    ]),
    alignmentEvidence: z.array(z.string().min(1)),
    lineageStatus: textSpanLineageStatusSchema,
    confidenceClass: z.enum(["STRONG", "MODERATE", "AMBIGUOUS", "UNRESOLVED"]),
    indexingPolicy: z.literal("unicode-code-point-half-open"),
    modifiable: z.boolean(),
    blockers: z.array(z.string().min(1)),
    semanticHash: sha256,
  })
  .strict()
  .superRefine((value, context) => {
    const mapped =
      value.spanStart !== null ||
      value.spanEnd !== null ||
      value.spanText !== null;
    if (
      mapped &&
      (value.spanStart === null ||
        value.spanEnd === null ||
        value.spanText === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["spanStart"],
        message: "Mapped spans require start, end, and text.",
      });
    }
    if (
      value.spanStart !== null &&
      value.spanEnd !== null &&
      value.spanEnd <= value.spanStart
    ) {
      context.addIssue({
        code: "custom",
        path: ["spanEnd"],
        message: "Span end must be greater than start.",
      });
    }
  });

export const machineEventFinalTextSpanLineageSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-event-final-text-span-lineage"),
    mode: c6016ModeSchema,
    indexingPolicy: z.literal("unicode-code-point-half-open"),
    identityPolicy: z.literal(
      "pipeline-provenance-required-no-fuzzy-production-match",
    ),
    events: z.array(eventFinalTextSpanSchema),
    summary: z
      .object({
        eventCount: count,
        spanMappedEventCount: count,
        exactSpanCount: count,
        normalizedExactSpanCount: count,
        splitDerivedSpanCount: count,
        mergeDerivedSpanCount: count,
        ambiguousSpanCount: count,
        unresolvedSpanCount: count,
        modifiableEventCount: count,
        finalCueTextCoverage: ratio,
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

export const spanTextRepairProposalSchema = z
  .object({
    proposalId: z.string().min(1),
    eventId: z.string().min(1),
    finalCueId: z.string().min(1),
    spanStart: count,
    spanEnd: count,
    beforeSpanText: z.string().min(1),
    afterSpanText: z.string().min(1),
    replacementCandidateId: z.string().min(1),
    evidenceIds: z.array(z.string().min(1)).min(1),
    lineageVerified: z.boolean(),
    sameEventVerified: z.boolean(),
    neighboringSpanSafe: z.boolean(),
    punctuationBoundarySafe: z.boolean(),
    crossSpeakerJoinSafe: z.boolean(),
    hallucinationNonIncreasePassed: z.boolean(),
    evidenceStronger: z.boolean(),
    textNonDegradationPassed: z.boolean(),
    timingCompatible: z.boolean(),
    accepted: z.boolean(),
    applied: z.boolean(),
    changedSpanCount: count,
    replacementChars: count,
    rejectReasons: z.array(z.string().min(1)),
    semanticHash: sha256,
  })
  .strict();

export const machineSpanTextRepairSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-span-text-repair"),
    mode: c6016ModeSchema,
    mutationPolicy: z.literal("event-span-only-independent-text-and-timing"),
    proposals: z.array(spanTextRepairProposalSchema),
    summary: z
      .object({
        proposalCount: count,
        acceptedCount: count,
        rejectedCount: count,
        appliedCount: count,
        changedFinalCueCount: count,
        changedSpanCount: count,
        replacementChars: count,
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

const boundaryEvidenceSchema = z
  .object({
    coverage: ratio,
    trustedTokenIds: z.array(z.string().min(1)),
    evidenceIds: z.array(z.string().min(1)),
    proposedTime: z.number().nonnegative().nullable(),
    strong: z.boolean(),
  })
  .strict();

export const partialBoundaryProposalSchema = z
  .object({
    proposalId: z.string().min(1),
    cueId: z.string().min(1),
    originalStart: z.number().nonnegative(),
    originalEnd: z.number().positive(),
    startEvidence: boundaryEvidenceSchema,
    endEvidence: boundaryEvidenceSchema,
    startEligible: z.boolean(),
    endEligible: z.boolean(),
    proposalType: z.enum([
      "START_TIME_REFINE",
      "END_TIME_REFINE",
      "BOTH_BOUNDARIES_REFINE",
      "NONE",
    ]),
    proposedStart: z.number().nonnegative().nullable(),
    proposedEnd: z.number().positive().nullable(),
    paddingSeconds: z.number().nonnegative(),
    nonDegradationPassed: z.boolean(),
    accepted: z.boolean(),
    applied: z.boolean(),
    blockers: z.array(z.string().min(1)),
    semanticHash: sha256,
  })
  .strict();

export const machinePartialBoundaryProposalsSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-partial-boundary-proposals"),
    mode: c6016ModeSchema,
    coveragePolicy: z.literal("independent-start-and-end-evidence"),
    proposals: z.array(partialBoundaryProposalSchema),
    summary: z
      .object({
        cueCount: count,
        startOnlyEligibleCount: count,
        startOnlyAppliedCount: count,
        endOnlyEligibleCount: count,
        endOnlyAppliedCount: count,
        bothEligibleCount: count,
        bothAppliedCount: count,
        proposalCount: count,
        appliedCount: count,
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

export const jointBoundaryPairSchema = z
  .object({
    pairId: z.string().min(1),
    leftCueId: z.string().min(1),
    rightCueId: z.string().min(1),
    originalLeftEnd: z.number().positive(),
    originalRightStart: z.number().nonnegative(),
    leftEvidence: boundaryEvidenceSchema,
    rightEvidence: boundaryEvidenceSchema,
    speechEvidence: z.array(z.string().min(1)),
    speakerEvidence: z.array(z.string().min(1)),
    overlapClass: z.enum([
      "NO_OVERLAP",
      "ACCIDENTAL_OVERLAP",
      "REAL_OVERLAP",
      "RAPID_TURN",
      "AMBIGUOUS",
    ]),
    proposedBoundary: z.number().nonnegative().nullable(),
    proposedLeftEnd: z.number().positive().nullable(),
    proposedRightStart: z.number().nonnegative().nullable(),
    outcome: z.enum([
      "KEEP_BOTH",
      "MOVE_A_END",
      "MOVE_B_START",
      "MOVE_BOTH",
      "PRESERVE_OVERLAP",
      "AMBIGUOUS",
      "REVIEW",
    ]),
    accepted: z.boolean(),
    applied: z.boolean(),
    blockers: z.array(z.string().min(1)),
    semanticHash: sha256,
  })
  .strict();

export const machineJointBoundaryRefinementSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-joint-boundary-refinement"),
    mode: c6016ModeSchema,
    overlapPolicy: z.literal("preserve-evidence-supported-real-overlap"),
    pairs: z.array(jointBoundaryPairSchema),
    summary: z
      .object({
        pairCount: count,
        proposalCount: count,
        appliedCount: count,
        realOverlapPreservedCount: count,
        accidentalOverlapResolvedCount: count,
        ambiguousCount: count,
        reviewCount: count,
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

export const asrCeilingClassSchema = z.enum([
  "PIPELINE_DECISION_RECOVERABLE",
  "EXISTING_VARIANT_RECOVERABLE",
  "REASR_RECOVERABLE",
  "CURRENT_WHISPER_CONSISTENTLY_WRONG",
  "ASSOCIATION_REMAINING",
  "SPAN_LINEAGE_BLOCKED",
  "UNKNOWN",
]);

export const machineAsrCeilingEvaluationSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-asr-ceiling-evaluation"),
    zone: z.literal("evaluation-only-gold-isolated"),
    runtimeGoldInputCount: z.literal(0),
    errors: z.array(
      z
        .object({
          errorId: z.string().min(1),
          cueId: z.string().min(1).nullable(),
          classification: asrCeilingClassSchema,
          machineCandidateIds: z.array(z.string().min(1)),
          evidenceIds: z.array(z.string().min(1)),
          reasons: z.array(z.string().min(1)),
          semanticHash: sha256,
        })
        .strict(),
    ),
    summary: z
      .object({
        materialErrorCount: count,
        recoverableByPipeline: count,
        recoverableByExistingVariant: count,
        recoverableByReAsr: count,
        currentWhisperConsistentlyWrong: count,
        associationRemaining: count,
        spanLineageBlocked: count,
        unknown: count,
        aggregatePotential: ratio,
        recommendation: z.enum([
          "CONTINUE_PIPELINE_RECOVERY",
          "RECOMMEND_ASR_ENSEMBLE_NEXT",
          "INSUFFICIENT_EVIDENCE",
        ]),
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

export const c6016QualityPolicySchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-6-quality-policy"),
    policyFrozenAt: z.iso.datetime(),
    goldAccessBeforeFreezeCount: z.literal(0),
    thresholds: z
      .object({
        requestEdgeDistanceSeconds: z.literal(0.35),
        ctcStrongMaximum: z.literal(0.35),
        ctcWeakMaximum: z.literal(0.55),
        tokenWeakMaximum: z.literal(0.4),
        speechIncompleteStrongMaximum: z.literal(0.7),
        decoderWeakAverageLogProbability: z.literal(-1.2),
        decoderStrongAverageLogProbability: z.literal(-1.5),
        decoderWeakNoSpeechProbability: z.literal(0.6),
        decoderStrongNoSpeechProbability: z.literal(0.8),
        boundaryCoverageMinimum: z.literal(0.8),
        boundaryPaddingSeconds: z.literal(0.08),
      })
      .strict(),
    riskTriggerPolicy: z.literal("one-strong-or-two-independent-weak"),
    goldRuntimeInputAllowed: z.literal(false),
    candidateTextPromptAllowed: z.literal(false),
    episodeReAsrRequestBudget: z.literal(36),
    maximumRequestsPerEvent: z.literal(3),
    productionStatus: z.literal("needs-review"),
    finalizationMethod: z.literal("none"),
    machineReleaseAuthorized: z.literal(false),
    policyHash: sha256,
    semanticHash: sha256,
  })
  .strict();

export const c6016QualityMetricsSchema = c6015QualityMetricsSchema
  .extend({
    strongRequestEdgeRiskCount: count,
    weakRequestEdgeRiskCount: count,
    decoderKnownCount: count,
    decoderUnknownCount: count,
    reAsrEligibleCount: count,
    spanMappedEventCount: count,
    spanRepairAppliedCount: count,
    partialTimingAppliedCount: count,
    jointBoundaryAppliedCount: count,
  })
  .strict();

export const c6016AblationSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-6-ablation"),
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
          metrics: c6016QualityMetricsSchema.nullable(),
          status: z.enum(["completed", "not-run", "failed"]),
          modelExecutionHash: sha256,
        })
        .strict(),
    ),
    semanticHash: sha256,
  })
  .strict();

export const c6016ValidationSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-6-validation"),
    branch: z.literal("codex/c6-0-1-6-acoustic-risk-span-text-joint-boundary"),
    repositoryCommit: z.string().regex(/^[a-f0-9]{40}$/u),
    sourceMediaSha256: sha256,
    goldSha256: sha256,
    sourceReadOnlyVerified: z.boolean(),
    goldReadOnlyVerified: z.boolean(),
    runtimeGoldInputCount: z.literal(0),
    datasetHardcodingFindingCount: z.literal(0),
    unsafeFinalizationEscapeCount: z.literal(0),
    networkUsed: z.literal(false),
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
        riskVector: z.boolean(),
        reAsrPriority: z.boolean(),
        decoderEvidence: z.boolean(),
        spanLineage: z.boolean(),
        repairProposals: z.boolean(),
        timingProposals: z.boolean(),
        jointBoundary: z.boolean(),
        mutation: z.boolean(),
        shadowOutcome: z.boolean(),
      })
      .strict(),
    productionStatus: z.literal("needs-review"),
    finalizationMethod: z.literal("none"),
    machineReleaseAuthorized: z.literal(false),
    engineeringGatePassed: z.boolean(),
    pipelineQualityMilestonePassed: z.boolean(),
    strictC602QualityGatePassed: z.boolean(),
    outcome: z.enum([
      "GO_C6_0_2",
      "HOLD_FOR_MORE_PIPELINE_RECOVERY",
      "RECOMMEND_ASR_ENSEMBLE_NEXT",
    ]),
    semanticHash: sha256,
  })
  .strict();

export const c6016ShareableSummarySchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-6-shareable-summary"),
    stage: z.string().min(1),
    runtimeGoldInputCount: z.literal(0),
    networkUsed: z.literal(false),
    productionStatus: z.literal("needs-review"),
    finalizationMethod: z.literal("none"),
    artifactRelativePaths: z.array(
      z
        .string()
        .min(1)
        .regex(/^(?!\/)(?![A-Za-z]:[\\/])(?!\\\\).+/u),
    ),
    artifactSemanticHashes: z
      .object({
        requestEdge: sha256,
        decoderEvidence: sha256,
        riskVector: sha256,
        reAsrPriority: sha256,
        spanLineage: sha256,
        spanRepair: sha256,
        partialBoundary: sha256,
        jointBoundary: sha256,
      })
      .strict(),
    finalHashes: z
      .object({
        canonicalTextHash: sha256,
        canonicalTimingHash: sha256,
        presentationHash: sha256,
        assHash: sha256,
        srtHash: sha256,
        vttHash: sha256,
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

export type C6016Mode = z.infer<typeof c6016ModeSchema>;
export type RiskSeverity = z.infer<typeof riskSeveritySchema>;
export type RiskCorrelationGroup = z.infer<typeof riskCorrelationGroupSchema>;
export type RiskFactName = z.infer<typeof riskFactNameSchema>;
export type RequestEdgeRiskEntry = z.infer<typeof requestEdgeRiskEntrySchema>;
export type MachineRequestEdgeRisk = z.infer<
  typeof machineRequestEdgeRiskSchema
>;
export type AcousticRiskFact = z.infer<typeof acousticRiskFactSchema>;
export type AcousticRiskVectorEntry = z.infer<
  typeof acousticRiskVectorEntrySchema
>;
export type MachineAcousticRiskVector = z.infer<
  typeof machineAcousticRiskVectorSchema
>;
export type MachineReAsrPriority = z.infer<typeof machineReAsrPrioritySchema>;
export type DecoderEvidenceEntry = z.infer<typeof decoderEvidenceEntrySchema>;
export type MachineDecoderEvidence = z.infer<
  typeof machineDecoderEvidenceSchema
>;
export type EventFinalTextSpan = z.infer<typeof eventFinalTextSpanSchema>;
export type MachineEventFinalTextSpanLineage = z.infer<
  typeof machineEventFinalTextSpanLineageSchema
>;
export type SpanTextRepairProposal = z.infer<
  typeof spanTextRepairProposalSchema
>;
export type MachineSpanTextRepair = z.infer<typeof machineSpanTextRepairSchema>;
export type PartialBoundaryProposal = z.infer<
  typeof partialBoundaryProposalSchema
>;
export type MachinePartialBoundaryProposals = z.infer<
  typeof machinePartialBoundaryProposalsSchema
>;
export type JointBoundaryPair = z.infer<typeof jointBoundaryPairSchema>;
export type MachineJointBoundaryRefinement = z.infer<
  typeof machineJointBoundaryRefinementSchema
>;
export type AsrCeilingClass = z.infer<typeof asrCeilingClassSchema>;
export type MachineAsrCeilingEvaluation = z.infer<
  typeof machineAsrCeilingEvaluationSchema
>;
export type C6016QualityPolicy = z.infer<typeof c6016QualityPolicySchema>;
export type C6016QualityMetrics = z.infer<typeof c6016QualityMetricsSchema>;
export type C6016Ablation = z.infer<typeof c6016AblationSchema>;
export type C6016Validation = z.infer<typeof c6016ValidationSchema>;
export type C6016ShareableSummary = z.infer<typeof c6016ShareableSummarySchema>;
