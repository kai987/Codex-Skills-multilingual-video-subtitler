import { z } from "zod";

export const c60110PolicyVersion =
  "c6.0.1.10-cross-model-arbitration-v1" as const;

const schemaVersion = z.literal("1.0.0");
const policyVersion = z.literal(c60110PolicyVersion);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const count = z.number().int().nonnegative();
const ratio = z.number().min(0).max(1);
const finite = z.number();
const artifactHeader = {
  schemaVersion,
  policyVersion,
  generatedAt: z.iso.datetime(),
} as const;

export const c60110PolicyProfileNameSchema = z.enum([
  "CONSERVATIVE",
  "BALANCED",
  "AGGRESSIVE_SHADOW",
]);
export const c60110ProductionProfileSchema = z.enum([
  "CONSERVATIVE",
  "BALANCED",
  "DISABLED",
]);
export const c60110ScopeSchema = z.enum([
  "DEV24",
  "EPISODE_HOLDOUT",
  "FULL_EPISODE",
]);
export const c60110DecisionSchema = z.enum([
  "AGREEMENT_NO_CHANGE",
  "KEEP_CURRENT_WHISPER",
  "SELECT_REAZON",
  "ABSTAIN_REVIEW",
  "BLOCKED_NOT_LOCALIZABLE",
  "BLOCKED_NO_SAFE_SPAN",
  "BLOCKED_REAZON_UNSTABLE",
  "BLOCKED_CONFLICTING_EVIDENCE",
]);
export const c60110ConfidenceClassSchema = z.enum(["HIGH", "MEDIUM", "LOW"]);
export const c60110EvidenceTierSchema = z.enum([
  "HARD_BLOCK",
  "STRONG_SUPPORT",
  "SUPPORT",
  "CONTRADICTION",
  "UNKNOWN",
]);
export const c60110EvidenceFamilySchema = z.enum([
  "WHISPER_STABILITY",
  "WHISPER_DECODER",
  "WHISPER_TOKEN",
  "REAZON_STABILITY",
  "CROSS_MODEL_RELATION",
  "SPEECH_LOCALIZATION",
  "CTC_REAZON_DATA_FAMILY",
  "SPAN_LINEAGE",
]);
export const c60110ReasonCodeSchema = z.enum([
  "CROSS_MODEL_EXACT_AGREEMENT",
  "CROSS_MODEL_NORMALIZED_AGREEMENT",
  "CROSS_MODEL_PRONUNCIATION_SUPPORT",
  "ORTHOGRAPHY_ONLY_REVIEW",
  "REAZON_STABLE",
  "REAZON_CONTEXT_EXTENSION_ONLY",
  "REAZON_LEXICALLY_UNSTABLE",
  "REAZON_HALLUCINATION_RISK",
  "REAZON_EMPTY",
  "REAZON_UNCOMPARABLE",
  "REAZON_RUNTIME_PROVENANCE_INCOMPLETE",
  "REAZON_DURATION_TEXT_ANOMALY",
  "WHISPER_LEXICALLY_UNSTABLE",
  "WHISPER_HALLUCINATION_RISK",
  "WHISPER_DECODER_INSTABILITY",
  "WHISPER_INCOMPLETE_SPEECH_SUPPORT",
  "WHISPER_ALTERNATE_CORROBORATES_REAZON",
  "WHISPER_STRONG_SUPPORT",
  "EVIDENCE_ABSENCE_ONLY",
  "CTC_SUPPORTS_REAZON",
  "CTC_SUPPORTS_WHISPER",
  "CTC_AMBIGUOUS",
  "CTC_UNSCORABLE",
  "CORE_LOCALIZATION_AMBIGUOUS",
  "SPAN_LINEAGE_UNSAFE",
  "CROSS_EVENT_AMBIGUITY",
  "MUTATION_NONDEGRADATION_BLOCKED",
  "CONFLICTING_EVIDENCE",
  "PRODUCTION_ENFORCEMENT_DISABLED",
  "AGGRESSIVE_PROFILE_SHADOW_ONLY",
]);

const candidateViewSchema = z
  .object({
    candidateId: z.string().min(1),
    providerFamily: z.enum(["WHISPER", "REAZON"]),
    displayText: z.string(),
    normalizedDisplayText: z.string(),
    pronunciationText: z.string(),
    hallucinationRisk: ratio,
    evidenceAvailability: z.enum(["COMPLETE", "PARTIAL", "UNAVAILABLE"]),
    semanticHash: sha256,
  })
  .strict();

const machineEvidenceStatusSchema = z
  .object({
    status: z.enum([
      "POSITIVE_CORRECTNESS_EVIDENCE",
      "POSITIVE_ERROR_EVIDENCE",
      "SUPPORTING_ERROR_EVIDENCE",
      "CONFLICTING_EVIDENCE",
      "EVIDENCE_ABSENCE",
      "UNKNOWN",
    ]),
    strong: z.boolean(),
    evidenceMissing: z.boolean(),
    sourceEvidenceIds: z.array(z.string().min(1)),
    reasonCodes: z.array(c60110ReasonCodeSchema),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.evidenceMissing && value.status !== "EVIDENCE_ABSENCE") {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "Missing evidence must remain EVIDENCE_ABSENCE.",
      });
    }
  });

const evidenceCorrelationGroupSchema = z
  .object({
    groupId: z.string().min(1),
    families: z.array(c60110EvidenceFamilySchema).min(1),
    independentFromGroupIds: z.array(z.string().min(1)),
    independentVoteCount: z.number().int().min(0).max(1),
    note: z.string().min(1),
  })
  .strict();

const evidenceAtomSchema = z
  .object({
    family: c60110EvidenceFamilySchema,
    tier: c60110EvidenceTierSchema,
    reasonCode: c60110ReasonCodeSchema,
    correlationGroupId: z.string().min(1),
    sourceEvidenceIds: z.array(z.string().min(1)),
    semanticHash: sha256,
  })
  .strict();

export const crossModelArbitrationEvidenceBundleSchema = z
  .object({
    evidenceBundleId: z.string().min(1),
    eventId: z.string().min(1),
    diagnosticRole: z.enum(["TARGET", "CONTROL", "HOLDOUT"]),
    currentFinalCueIds: z.array(z.string().min(1)),
    currentFinalSpanLineage: z
      .object({
        finalCueId: z.string().min(1).nullable(),
        spanStart: count.nullable(),
        spanEnd: count.nullable(),
        lineageStatus: z.enum([
          "EXACT",
          "NORMALIZED_EXACT",
          "DERIVED_FROM_SPLIT",
          "DERIVED_FROM_MERGE",
          "AMBIGUOUS",
          "UNRESOLVED",
        ]),
        modifiable: z.boolean(),
        blockers: z.array(z.string()),
        semanticHash: sha256,
      })
      .strict(),
    currentWhisperCandidate: candidateViewSchema,
    alternateWhisperCandidates: z.array(candidateViewSchema),
    reazonCoreExactCandidate: candidateViewSchema.nullable(),
    reazonCoreContextCandidate: candidateViewSchema.nullable(),
    whisperStability: z
      .object({
        class: z.enum([
          "CORE_TEXT_CONSISTENT",
          "CONTEXT_ONLY_DIFFERENCE",
          "LEXICAL_CORE_DISAGREEMENT",
          "HALLUCINATION_DISAGREEMENT",
          "ADJACENT_UTTERANCE_CONTAMINATION",
          "SPEAKER_CONTENT_MIX",
          "PARTIAL_CORE_AGREEMENT",
          "UNLOCALIZABLE",
          "UNEVALUABLE",
          "NOT_RUN",
        ]),
        negativeEvidence: z.boolean(),
        strongNegativeEvidence: z.boolean(),
        sourceEvidenceIds: z.array(z.string().min(1)),
      })
      .strict(),
    reazonStability: z
      .object({
        class: z.enum([
          "REAZON_CORE_STABLE",
          "REAZON_CONTEXT_EXTENSION_ONLY",
          "REAZON_LEXICALLY_UNSTABLE",
          "REAZON_HALLUCINATION_UNSTABLE",
          "REAZON_EMPTY_UNSTABLE",
          "UNCOMPARABLE",
          "CONTEXT_NOT_RUN",
        ]),
        positiveStabilityEvidence: z.boolean(),
        hardBlocked: z.boolean(),
        sourceEvidenceIds: z.array(z.string().min(1)),
      })
      .strict(),
    crossModelRelation: z.enum([
      "EXACT_AGREEMENT",
      "NORMALIZED_AGREEMENT",
      "PRONUNCIATION_AGREEMENT",
      "ORTHOGRAPHY_ONLY_DIFFERENCE",
      "LEXICAL_DISAGREEMENT",
      "WHISPER_HALLUCINATION_RISK",
      "REAZON_HALLUCINATION_RISK",
      "BOTH_LOW_SUPPORT",
      "REAZON_EMPTY",
      "WHISPER_EMPTY",
      "UNCOMPARABLE",
    ]),
    pronunciationRelation: z.enum([
      "EXACT",
      "NEAR",
      "DISAGREEMENT",
      "UNAVAILABLE",
    ]),
    whisperHallucinationRisk: ratio,
    reazonHallucinationRisk: ratio.nullable(),
    whisperDecoderEvidence: machineEvidenceStatusSchema,
    whisperTokenEvidence: machineEvidenceStatusSchema,
    requestEdgeEvidence: machineEvidenceStatusSchema,
    speechCompletenessEvidence: machineEvidenceStatusSchema,
    ctcWhisperSupport: finite.nullable(),
    ctcReazonSupport: finite.nullable(),
    ctcOutcome: z.enum([
      "CTC_FAVORS_WHISPER",
      "CTC_FAVORS_REAZON",
      "CTC_AMBIGUOUS",
      "CTC_UNSCORABLE",
      "CTC_NOT_RUN",
    ]),
    ctcScorability: z.enum(["SCORABLE", "UNSCORABLE", "NOT_RUN"]),
    coreLocalizationStatus: z.enum([
      "VERIFIED",
      "VERIFIED_WITH_CAUTION",
      "MACHINE_LOCALIZABLE",
      "AMBIGUOUS",
      "UNLOCALIZABLE",
    ]),
    textSpanLineageStatus: z.enum([
      "EXACT",
      "NORMALIZED_EXACT",
      "DERIVED_FROM_SPLIT",
      "DERIVED_FROM_MERGE",
      "AMBIGUOUS",
      "UNRESOLVED",
    ]),
    mutationSafetyStatus: z.enum([
      "SAFE_EXACT_SPAN",
      "SAFE_NORMALIZED_EXACT_SPAN",
      "OBSERVE_ONLY_DERIVED_SPAN",
      "BLOCKED",
    ]),
    evidenceCorrelationGroups: z.array(evidenceCorrelationGroupSchema).min(1),
    evidenceAtoms: z.array(evidenceAtomSchema),
    runtimeGoldInputCount: z.literal(0),
    semanticHash: sha256,
  })
  .strict();

export const machineCrossModelArbitrationEvidenceSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-cross-model-arbitration-evidence"),
    scope: c60110ScopeSchema,
    sourceMediaSha256: sha256,
    upstreamSemanticHashes: z.record(z.string().min(1), sha256),
    goldTextIncluded: z.literal(false),
    rawCrossModelConfidenceCompared: z.literal(false),
    correlationPolicy: z.literal(
      "REAZON_AND_CTC_CORRELATED_NOT_INDEPENDENT_VOTES",
    ),
    events: z.array(crossModelArbitrationEvidenceBundleSchema),
    summary: z
      .object({
        eventCount: count,
        exactAgreementCount: count,
        normalizedAgreementCount: count,
        orthographyOnlyCount: count,
        lexicalDisagreementCount: count,
        safeSpanCount: count,
        blockedSpanCount: count,
        whisperNegativeEvidenceCount: count,
        reazonStableCount: count,
        crossFamilyCorroborationCount: count,
        ctcScorableCount: count,
        runtimeGoldInputCount: z.literal(0),
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

const policyProfileSchema = z
  .object({
    profile: c60110PolicyProfileNameSchema,
    productionEligible: z.boolean(),
    minimumIndependentSupportingFamilies: z.number().int().min(1).max(3),
    requireStrongWhisperNegativeEvidence: z.boolean(),
    requireReazonStable: z.literal(true),
    requireSafeExactSpan: z.literal(true),
    allowOrthographyOnlySwitch: z.literal(false),
    allowCtcToSelectWinner: z.literal(false),
    allowCtcAsVeto: z.literal(true),
    allowRawConfidenceComparison: z.literal(false),
    allowCorrelatedVotesAsIndependent: z.literal(false),
    allowUnresolvedCrossEventAmbiguity: z.literal(false),
    semanticHash: sha256,
  })
  .strict();

export const c60110PolicyProfilesSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-10-policy-profiles"),
    defaultDecision: z.literal("KEEP_CURRENT_WHISPER"),
    profilesFrozenBeforeDevGold: z.literal(true),
    profiles: z.array(policyProfileSchema).length(3),
    runtimeGoldInputCount: z.literal(0),
    semanticHash: sha256,
  })
  .strict()
  .superRefine((value, context) => {
    const names = value.profiles.map((profile) => profile.profile);
    if (
      new Set(names).size !== 3 ||
      c60110PolicyProfileNameSchema.options.some(
        (name) => !names.includes(name),
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["profiles"],
        message: "Exactly one of each frozen profile is required.",
      });
    }
    const aggressive = value.profiles.find(
      (profile) => profile.profile === "AGGRESSIVE_SHADOW",
    );
    if (aggressive?.productionEligible !== false) {
      context.addIssue({
        code: "custom",
        path: ["profiles"],
        message: "AGGRESSIVE_SHADOW can never be production eligible.",
      });
    }
  });

export const crossModelArbitrationDecisionRecordSchema = z
  .object({
    arbitrationDecisionId: z.string().min(1),
    eventId: z.string().min(1),
    whisperCandidateId: z.string().min(1),
    reazonCandidateId: z.string().min(1).nullable(),
    evidenceBundleId: z.string().min(1),
    policyProfile: c60110PolicyProfileNameSchema,
    hardBlockers: z.array(c60110ReasonCodeSchema),
    strongSupports: z.array(c60110ReasonCodeSchema),
    supports: z.array(c60110ReasonCodeSchema),
    contradictions: z.array(c60110ReasonCodeSchema),
    ctcStatus: z.enum([
      "SUPPORT_REAZON",
      "SUPPORT_WHISPER",
      "AMBIGUOUS",
      "UNSCORABLE",
      "NOT_RUN",
    ]),
    decision: c60110DecisionSchema,
    confidenceClass: c60110ConfidenceClassSchema,
    decisionReasons: z.array(c60110ReasonCodeSchema).min(1),
    mutationEligible: z.boolean(),
    semanticHash: sha256,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.decision === "SELECT_REAZON" &&
      (value.reazonCandidateId === null || value.hardBlockers.length > 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["decision"],
        message: "SELECT_REAZON requires a candidate and zero hard blockers.",
      });
    }
    if (
      value.mutationEligible &&
      (value.decision !== "SELECT_REAZON" || value.confidenceClass !== "HIGH")
    ) {
      context.addIssue({
        code: "custom",
        path: ["mutationEligible"],
        message: "Only HIGH-confidence SELECT_REAZON may be mutation eligible.",
      });
    }
  });

export const machineCrossModelArbitrationLedgerSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-cross-model-arbitration-ledger"),
    scope: c60110ScopeSchema,
    evidenceSemanticHash: sha256,
    policyProfile: c60110PolicyProfileNameSchema,
    arbitrationPolicyHash: sha256,
    productionEnforcementEnabled: z.boolean(),
    decisionsFrozenBeforeGold: z.literal(true),
    events: z.array(crossModelArbitrationDecisionRecordSchema),
    summary: z
      .object({
        eventCount: count,
        agreementNoChangeCount: count,
        selectReazonCount: count,
        keepWhisperCount: count,
        abstainCount: count,
        blockedCount: count,
        mutationEligibleCount: count,
        runtimeGoldInputCount: z.literal(0),
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

const profileEvaluationSchema = z
  .object({
    profile: c60110PolicyProfileNameSchema,
    decisionLedgerSemanticHash: sha256,
    selectReazonCount: count,
    keepWhisperCount: count,
    abstainCount: count,
    blockedCount: count,
    evaluableSwitchCount: count,
    correctSwitchCount: count,
    wrongSwitchCount: count,
    neutralSwitchCount: count,
    baselineLocalError: count,
    arbitrationLocalError: count,
    realizedLocalGain: z.number().int(),
    availableOracleGain: count,
    oracleCaptureRate: finite.nullable(),
    controlRegressionCount: count,
    avoidedBlindRegressionCount: count,
    productionEligible: z.boolean(),
    semanticHash: sha256,
  })
  .strict();

export const c60110Dev24EvaluationSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-10-dev24-evaluation"),
    evaluationPhase: z.literal("post-decision-freeze-gold-isolated"),
    dev24EventCount: z.literal(24),
    targetCount: z.literal(12),
    controlCount: z.literal(12),
    policyProfilesSemanticHash: sha256,
    machineDecisionFreezeHashes: z.record(
      c60110PolicyProfileNameSchema,
      sha256,
    ),
    goldIdentityHash: sha256,
    goldTextIncluded: z.literal(false),
    profiles: z.array(profileEvaluationSchema).length(3),
    selectedProductionProfile: c60110ProductionProfileSchema,
    selectionResult: z.enum([
      "ARBITRATION_PROFILE_SELECTED",
      "HOLD_ARBITRATION_NOT_SAFE",
    ]),
    selectionReasons: z.array(z.string().min(1)).min(1),
    runtimeGoldInputCount: z.literal(0),
    semanticHash: sha256,
  })
  .strict();

export const c60110PolicyFreezeSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-10-policy-freeze"),
    selectedProductionProfile: c60110ProductionProfileSchema,
    enforcementEnabled: z.boolean(),
    arbitrationPolicyHash: sha256,
    policyProfilesSemanticHash: sha256,
    dev24EvaluationSemanticHash: sha256,
    frozenBeforeHoldoutSelection: z.literal(true),
    frozenBeforeHoldoutInference: z.literal(true),
    frozenBeforeHoldoutGold: z.literal(true),
    immutableRuleSet: z.literal(true),
    runtimeGoldInputCount: z.literal(0),
    semanticHash: sha256,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.selectedProductionProfile === "DISABLED" &&
      value.enforcementEnabled
    ) {
      context.addIssue({
        code: "custom",
        path: ["enforcementEnabled"],
        message: "Disabled production arbitration cannot enforce mutations.",
      });
    }
  });

const holdoutSelectionEventSchema = z
  .object({
    eventId: z.string().min(1),
    coreInterval: z
      .object({ start: finite.nonnegative(), end: finite.positive() })
      .strict()
      .refine((value) => value.end > value.start),
    finalCueIds: z.array(z.string().min(1)),
    currentCandidateId: z.string().min(1),
    machineLocalizable: z.boolean(),
    coreExactPlanned: z.boolean(),
    exclusionReasons: z.array(z.string()),
    sourceEvidenceIds: z.array(z.string().min(1)).min(1),
    semanticHash: sha256,
  })
  .strict();

export const c60110HoldoutSelectionSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-10-holdout-selection"),
    sourceMediaSha256: sha256,
    policyFreezeSemanticHash: sha256,
    selectionPolicy: z.literal(
      "episode-machine-localizable-canonical-events-excluding-frozen-dev24-v1",
    ),
    totalCanonicalEventCount: count,
    dev24ExcludedEventIds: z.array(z.string().min(1)).length(24),
    events: z.array(holdoutSelectionEventSchema),
    summary: z
      .object({
        candidateHoldoutEventCount: count,
        machineLocalizableCount: count,
        excludedCount: count,
        coreExactPlannedCount: count,
      })
      .strict(),
    machineOnlySelection: z.literal(true),
    selectedBeforeHoldoutGold: z.literal(true),
    runtimeGoldInputCount: z.literal(0),
    semanticHash: sha256,
  })
  .strict();

const holdoutRuntimeCandidateSchema = candidateViewSchema.extend({
  eventId: z.string().min(1),
  windowType: z.enum(["CORE_EXACT", "CORE_CONTEXT"]),
  requestId: z.string().min(1),
  cacheKey: sha256,
  cacheHit: z.boolean(),
  inferenceExecuted: z.boolean(),
  sourceInterval: z
    .object({ start: finite.nonnegative(), end: finite.positive() })
    .strict()
    .refine((value) => value.end > value.start),
});

export const c60110HoldoutReazonRuntimeSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-10-holdout-reazon-runtime"),
    executionKind: z.enum([
      "OFFICIAL_FRESH_INFERENCE",
      "FROZEN_EXACT_CACHE_REPLAY",
    ]),
    selectionSemanticHash: sha256,
    modelIdentity: z
      .object({
        modelId: z.literal("reazon-research/reazonspeech-k2-v2"),
        modelRevision: z.literal("291488c8151be24d7da4bf7af26e533fad96e407"),
        modelSnapshotHash: sha256,
        encoderSha256: z.literal(
          "ecdb0b771e16104aaf8e579cb3c1e32fbd589eb641c5946d82b615bd366c5f96",
        ),
        decoderSha256: z.literal(
          "58b18211ae06265466bfa17172dab574df94f76c8bcb61a3640c28ba860e4124",
        ),
        joinerSha256: z.literal(
          "d38a81d1191c9ed6de6a1719503692e07e3e973e2364adde0abae5eaaded1174",
        ),
        tokensSha256: z.literal(
          "2c3ac659818a48a0c04010e0593bbc4d7c8a24a054340b01131499c05fd52def",
        ),
        precision: z.literal("fp32"),
      })
      .strict(),
    runtimeIdentity: z
      .object({
        runtimeId: sha256,
        adapterType: z.literal("DIRECT_SHERPA_ONNX_OFFICIAL_REAZON_FP32"),
        sherpaOnnxVersion: z.literal("1.13.6"),
        device: z.literal("cpu"),
        architecture: z.string().min(1),
      })
      .strict(),
    requests: z
      .object({
        coreExactPlannedCount: count,
        coreExactActualCount: count,
        coreExactCacheHitCount: count,
        coreExactFreshInferenceCount: count,
        contextEscalationPlannedCount: count,
        contextActualCount: count,
        contextCacheHitCount: count,
        contextFreshInferenceCount: count,
        successfulCount: count,
        failedCount: count,
        emptyOutputCount: count,
        modelLoadCount: count,
        processStartCount: count,
      })
      .strict(),
    candidates: z.array(holdoutRuntimeCandidateSchema),
    networkUsed: z.literal(false),
    remoteApiUsed: z.literal(false),
    runtimeGoldInputCount: z.literal(0),
    semanticHash: sha256,
  })
  .strict();

export const c60110HoldoutArbitrationSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-10-holdout-arbitration"),
    policyFreezeSemanticHash: sha256,
    holdoutSelectionSemanticHash: sha256,
    holdoutRuntimeSemanticHash: sha256,
    evidenceSemanticHash: sha256,
    ledgerSemanticHash: sha256,
    decisionsFrozenBeforeGold: z.literal(true),
    finalSubtitleFrozenBeforeGold: z.literal(true),
    summary: z
      .object({
        eventCount: count,
        lexicalDisagreementCount: count,
        selectReazonCount: count,
        keepWhisperCount: count,
        abstainCount: count,
        blockedLocalizationCount: count,
        blockedSpanCount: count,
        mutationProposalCount: count,
        appliedMutationCount: count,
      })
      .strict(),
    runtimeGoldInputCount: z.literal(0),
    semanticHash: sha256,
  })
  .strict();

const mutationSafetyChecksSchema = z
  .object({
    highConfidenceSelection: z.boolean(),
    exactOrNormalizedExactSpan: z.boolean(),
    contiguousSpan: z.boolean(),
    neighborPreserved: z.boolean(),
    punctuationSafe: z.boolean(),
    duplicationSafe: z.boolean(),
    crossSpeakerSafe: z.boolean(),
    timingMutationRequired: z.literal(false),
    outputSchemaValid: z.boolean(),
    nonDegradationPassed: z.boolean(),
  })
  .strict();

export const crossModelTextMutationProposalSchema = z
  .object({
    proposalId: z.string().min(1),
    eventId: z.string().min(1),
    finalCueId: z.string().min(1),
    spanStart: count,
    spanEnd: count,
    beforeText: z.string().min(1),
    afterText: z.string().min(1),
    selectedProvider: z.literal("REAZON"),
    selectedCandidateId: z.string().min(1),
    arbitrationDecisionId: z.string().min(1),
    evidenceBundleId: z.string().min(1),
    safetyChecks: mutationSafetyChecksSchema,
    accepted: z.boolean(),
    applied: z.boolean(),
    rejectionReasons: z.array(c60110ReasonCodeSchema),
    semanticHash: sha256,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.spanEnd <= value.spanStart) {
      context.addIssue({
        code: "custom",
        path: ["spanEnd"],
        message: "Mutation span must be non-empty.",
      });
    }
    if (value.applied && !value.accepted) {
      context.addIssue({
        code: "custom",
        path: ["applied"],
        message: "A rejected proposal cannot be applied.",
      });
    }
  });

export const machineCrossModelTextMutationProposalsSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-cross-model-text-mutation-proposals"),
    arbitrationLedgerSemanticHashes: z.array(sha256).min(1),
    textOnlyMutation: z.literal(true),
    reazonTimingUsed: z.literal(false),
    hybridProviderTextAllowed: z.literal(false),
    proposals: z.array(crossModelTextMutationProposalSchema),
    summary: z
      .object({
        proposalCount: count,
        acceptedCount: count,
        rejectedCount: count,
        appliedCount: count,
        textChangedFinalCueCount: count,
        timingChangedFinalCueCount: z.literal(0),
      })
      .strict(),
    runtimeGoldInputCount: z.literal(0),
    semanticHash: sha256,
  })
  .strict();

const arbitrationEvaluationSummarySchema = z
  .object({
    evaluableSwitchCount: count,
    correctSwitchCount: count,
    wrongSwitchCount: count,
    neutralSwitchCount: count,
    avoidedRegressionCount: count,
    availableOracleGain: count,
    realizedArbitrationGain: z.number().int(),
    oracleCaptureRate: finite.nullable(),
    arbitrationPrecision: ratio.nullable(),
    arbitrationHarmRate: ratio.nullable(),
  })
  .strict();

export const c60110OracleCaptureEvaluationSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-10-oracle-capture-evaluation"),
    evaluationPhase: z.literal("post-final-freeze-gold-isolated"),
    machineFreezeHash: sha256,
    goldIdentityHash: sha256,
    metricDirection: z.literal("LOWER_IS_BETTER"),
    dev24: arbitrationEvaluationSummarySchema,
    holdout: arbitrationEvaluationSummarySchema,
    fullEpisode: arbitrationEvaluationSummarySchema,
    wrongProviderSwitchEventIds: z.array(z.string().min(1)),
    goldTextIncluded: z.literal(false),
    runtimeGoldInputCount: z.literal(0),
    semanticHash: sha256,
  })
  .strict();

export const c60110ControlRegressionEvaluationSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-10-control-regression-evaluation"),
    evaluationPhase: z.literal("post-decision-freeze-gold-isolated"),
    controlEventCount: z.literal(12),
    reazonBetterCount: count,
    whisperBetterCount: count,
    equivalentCount: count,
    selectReazonCount: count,
    correctSelectReazonCount: count,
    wrongSelectReazonCount: count,
    avoidedBlindRegressionCount: count,
    events: z.array(
      z
        .object({
          eventId: z.string().min(1),
          blindReazonWouldRegress: z.boolean().nullable(),
          arbitrationDecision: c60110DecisionSchema,
          outcome: z.enum([
            "CORRECT_SWITCH",
            "WRONG_SWITCH",
            "NEUTRAL_SWITCH",
            "AVOIDED_CONTROL_REGRESSION",
            "NO_SWITCH",
            "UNEVALUABLE",
          ]),
          semanticHash: sha256,
        })
        .strict(),
    ),
    runtimeGoldInputCount: z.literal(0),
    semanticHash: sha256,
  })
  .strict();

export const c60110QualityPolicySchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-10-quality-policy"),
    arbitrationMode: z.enum(["enforce", "observe-disabled"]),
    selectedProductionProfile: c60110ProductionProfileSchema,
    defaultDecision: z.literal("KEEP_CURRENT_WHISPER"),
    textMutationMode: z.enum(["safe-text-only", "disabled"]),
    timingMutationAllowed: z.literal(false),
    aggressiveProfileProductionAllowed: z.literal(false),
    rawCrossModelConfidenceComparisonAllowed: z.literal(false),
    ctcWinnerSelectionAllowed: z.literal(false),
    ctcIndependentVoteAllowed: z.literal(false),
    goldRuntimeSelectionAllowed: z.literal(false),
    thirdAsrAllowed: z.literal(false),
    llmWinnerAllowed: z.literal(false),
    productionStatus: z.literal("needs-review"),
    finalizationMethod: z.literal("none"),
    machineOnlyReleaseAuthorized: z.literal(false),
    semanticHash: sha256,
  })
  .strict();

const globalQualityMetricsSchema = z
  .object({
    finalCueCount: count,
    exactCer: finite.nonnegative(),
    normalizedCer: finite.nonnegative(),
    coverage: ratio,
    missingCount: count,
    hallucinationCount: count,
    materialErrorCount: count,
    severeTimingCount: count,
    startMaeSeconds: finite.nonnegative(),
    endMaeSeconds: finite.nonnegative(),
    p95TimingErrorSeconds: finite.nonnegative(),
    medianIou: ratio,
    overlapCount: count,
  })
  .strict();

export const c60110ValidationSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-10-validation"),
    branch: z.literal("codex/c6-0-1-10-cross-model-arbitration"),
    repositoryCommit: z.string().regex(/^[a-f0-9]{40}$/u),
    sourceMediaSha256Before: sha256,
    sourceMediaSha256After: sha256,
    goldSha256Before: sha256,
    goldSha256After: sha256,
    arbitrationPolicyHash: sha256,
    checks: z.array(
      z
        .object({
          id: z.string().min(1),
          passed: z.boolean(),
          evidence: z.array(z.string()),
        })
        .strict(),
    ),
    finalABParity: z
      .object({
        evidenceBundles: z.boolean(),
        decisions: z.boolean(),
        mutationProposals: z.boolean(),
        appliedMutations: z.boolean(),
        finalText: z.boolean(),
        finalTiming: z.boolean(),
        ass: z.boolean(),
        srt: z.boolean(),
        vtt: z.boolean(),
        productionStatus: z.boolean(),
        routeDecision: z.boolean(),
      })
      .strict(),
    baselineQuality: globalQualityMetricsSchema,
    finalQuality: globalQualityMetricsSchema,
    productionHashes: z
      .object({
        canonicalText: sha256,
        canonicalTiming: sha256,
        presentation: sha256,
        ass: sha256,
        srt: sha256,
        vtt: sha256,
      })
      .strict(),
    canonicalTextMutationCount: count,
    canonicalTimingMutationCount: z.literal(0),
    runtimeGoldInputCount: z.literal(0),
    datasetHardcodingFindingCount: z.literal(0),
    unsafeFinalizationEscapeCount: z.literal(0),
    networkUsedDuringAcceptance: z.literal(false),
    sourceReadOnlyVerified: z.literal(true),
    goldReadOnlyVerified: z.literal(true),
    engineeringGatePassed: z.boolean(),
    arbitrationSafetyGatePassed: z.boolean(),
    crossModelSafeGainConfirmed: z.boolean(),
    strictC602GatePassed: z.boolean(),
    routeDecision: z.enum([
      "GO_C6_0_2",
      "HOLD_FOR_TIMING_QUALITY_RECOVERY",
      "HOLD_FOR_ARBITRATION_EVIDENCE_REDESIGN",
      "DISABLE_AUTOMATIC_REAZON_ENFORCEMENT",
      "ARBITRATION_TOO_CONSERVATIVE_OR_EVIDENCE_INSUFFICIENT",
      "CROSS_MODEL_ARBITRATION_SAFE_GAIN_CONFIRMED",
    ]),
    productionStatus: z.literal("needs-review"),
    finalizationMethod: z.literal("none"),
    machineOnlyReleaseAuthorized: z.literal(false),
    semanticHash: sha256,
  })
  .strict();

export type C60110PolicyProfileName = z.infer<
  typeof c60110PolicyProfileNameSchema
>;
export type C60110ProductionProfile = z.infer<
  typeof c60110ProductionProfileSchema
>;
export type C60110Scope = z.infer<typeof c60110ScopeSchema>;
export type C60110Decision = z.infer<typeof c60110DecisionSchema>;
export type C60110ReasonCode = z.infer<typeof c60110ReasonCodeSchema>;
export type C60110EvidenceFamily = z.infer<typeof c60110EvidenceFamilySchema>;
export type C60110EvidenceTier = z.infer<typeof c60110EvidenceTierSchema>;
export type CrossModelArbitrationEvidenceBundle = z.infer<
  typeof crossModelArbitrationEvidenceBundleSchema
>;
export type MachineCrossModelArbitrationEvidence = z.infer<
  typeof machineCrossModelArbitrationEvidenceSchema
>;
export type C60110PolicyProfiles = z.infer<typeof c60110PolicyProfilesSchema>;
export type CrossModelArbitrationDecisionRecord = z.infer<
  typeof crossModelArbitrationDecisionRecordSchema
>;
export type MachineCrossModelArbitrationLedger = z.infer<
  typeof machineCrossModelArbitrationLedgerSchema
>;
export type C60110Dev24Evaluation = z.infer<typeof c60110Dev24EvaluationSchema>;
export type C60110PolicyFreeze = z.infer<typeof c60110PolicyFreezeSchema>;
export type C60110HoldoutSelection = z.infer<
  typeof c60110HoldoutSelectionSchema
>;
export type C60110HoldoutReazonRuntime = z.infer<
  typeof c60110HoldoutReazonRuntimeSchema
>;
export type C60110HoldoutArbitration = z.infer<
  typeof c60110HoldoutArbitrationSchema
>;
export type CrossModelTextMutationProposal = z.infer<
  typeof crossModelTextMutationProposalSchema
>;
export type MachineCrossModelTextMutationProposals = z.infer<
  typeof machineCrossModelTextMutationProposalsSchema
>;
export type C60110OracleCaptureEvaluation = z.infer<
  typeof c60110OracleCaptureEvaluationSchema
>;
export type C60110ControlRegressionEvaluation = z.infer<
  typeof c60110ControlRegressionEvaluationSchema
>;
export type C60110QualityPolicy = z.infer<typeof c60110QualityPolicySchema>;
export type C60110Validation = z.infer<typeof c60110ValidationSchema>;
