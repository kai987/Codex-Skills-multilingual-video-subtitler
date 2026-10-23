import { z } from "zod";

import { schemaVersionSchema } from "./schemas.js";

export const c60ProtectedHashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const gitCommitSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const nonEmptyStringSchema = z.string().min(1);
const nonNegativeIntegerSchema = z.number().int().nonnegative();
const relativePathSchema = z
  .string()
  .min(1)
  .regex(/^(?!\/)(?![A-Za-z]:[\\/])(?!\\\\).+/u, "Path must be relative.");

export const c60FinalizationPolicyModeSchema = z.enum([
  "legacy",
  "protected-observe",
  "protected-enforce",
]);

export const c60ProtectedDispositionSchema = z.enum([
  "FINAL_BLOCKER",
  "MUTATION_GUARD",
  "REVIEW_ADVISORY",
  "DIAGNOSTIC_ONLY",
  "CONTEXT_DEPENDENT",
  "SUPERSEDED",
  "UNKNOWN",
]);

export const c60ProtectedBlockingScopeSchema = z.enum([
  "current-output-safety",
  "automatic-mutation-safety",
  "evidence-availability",
  "evidence-consistency",
  "delivery-integrity",
  "format-compatibility",
  "review-routing",
  "diagnostic-only",
]);

export const c60ProtectedEvidencePolaritySchema = z.enum([
  "positive-risk-evidence",
  "absence-of-support",
  "contradictory-evidence",
  "execution-diagnostic",
  "format-advisory",
  "preservation-support",
]);

export const c60CurrentOutputRiskSchema = z.enum([
  "PROVEN_UNSAFE",
  "HIGH_RISK",
  "UNKNOWN",
  "LOW_RISK",
  "NO_POSITIVE_DEFECT_EVIDENCE",
]);

export const c60ProposedMutationRiskSchema = z.enum([
  "HIGH",
  "MEDIUM",
  "LOW",
  "NOT_APPLICABLE",
]);

export const c60ProtectedOutcomeSchema = z.enum([
  "FINAL_SAFE",
  "FINAL_SAFE_WITH_ADVISORIES",
  "HUMAN_REVIEW_REQUIRED",
  "REJECTED",
  "MACHINE_ONLY_NOT_AUTHORIZED",
]);

export const c60ProtectedRiskPolicyEntrySchema = z
  .object({
    code: nonEmptyStringSchema,
    rootRiskFamily: nonEmptyStringSchema,
    blockingScope: c60ProtectedBlockingScopeSchema,
    evidencePolarity: c60ProtectedEvidencePolaritySchema,
    disposition: c60ProtectedDispositionSchema,
    currentOutputRisk: c60CurrentOutputRiskSchema,
    proposedMutationRisk: c60ProposedMutationRiskSchema,
    providerSpecific: z.boolean(),
    contextRule: nonEmptyStringSchema,
    rationale: nonEmptyStringSchema,
  })
  .strict();

const investigationSemanticHashesSchema = z
  .object({
    blockerInventory: c60ProtectedHashSchema,
    blockerOntology: c60ProtectedHashSchema,
    blockerRootCauseGraph: c60ProtectedHashSchema,
    blockerSupersessionAudit: c60ProtectedHashSchema,
    componentEvidenceMatrix: c60ProtectedHashSchema,
    componentRiskAudit: c60ProtectedHashSchema,
    finalizationCounterfactual: c60ProtectedHashSchema,
    humanAuthorityDependencyAudit: c60ProtectedHashSchema,
    investigationSummary: c60ProtectedHashSchema,
    zeroTouchReadiness: c60ProtectedHashSchema,
  })
  .strict();

export const c60ProtectedRiskPolicySchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("c6-0-protected-risk-policy"),
    policyVersion: z.literal("c6.0-protected-finalization-risk-v1"),
    investigationBaselineCommit: gitCommitSchema,
    investigationParentCommit: gitCommitSchema,
    createdFromInvestigationVersion: z.literal("C6.0"),
    runASemanticHashes: investigationSemanticHashesSchema,
    runBSemanticHashes: investigationSemanticHashesSchema,
    ontologyHash: c60ProtectedHashSchema,
    rootCauseGraphHash: c60ProtectedHashSchema,
    machineOnlyReleaseAuthorized: z.literal(false),
    exactMatchOnly: z.literal(true),
    unknownSignalsFailClosed: z.literal(true),
    entries: z.array(c60ProtectedRiskPolicyEntrySchema).min(1),
    policyHash: c60ProtectedHashSchema,
  })
  .strict();

export const humanBaselineAuthoritySchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("human-baseline-authority"),
    authorityVersion: z.literal("c6.0-human-baseline-authority-v1"),
    generatedAt: z.iso.datetime(),
    authorityType: z.enum(["user-confirmed-human-reviewed", "none"]),
    sourceFileName: nonEmptyStringSchema.nullable(),
    sourceFileSha256: c60ProtectedHashSchema.nullable(),
    sourceFileSize: nonNegativeIntegerSchema.nullable(),
    sourceCueHash: c60ProtectedHashSchema.nullable(),
    sourceTimingHash: c60ProtectedHashSchema.nullable(),
    sourceVideoFileName: nonEmptyStringSchema.nullable(),
    sourceVideoSha256: c60ProtectedHashSchema.nullable(),
    sourceVideoSize: nonNegativeIntegerSchema.nullable(),
    cueCount: nonNegativeIntegerSchema,
    textAuthority: z.boolean(),
    timingAuthority: z.boolean(),
    readOnlyVerified: z.boolean(),
    sourceVideoReadOnlyVerified: z.boolean(),
    coverageVerified: z.boolean(),
    lineageVerified: z.boolean(),
    authorityVerified: z.boolean(),
    verificationFailures: z.array(nonEmptyStringSchema),
    semanticHash: c60ProtectedHashSchema,
  })
  .strict();

const freshnessEntrySchema = z
  .object({
    freshnessId: nonEmptyStringSchema,
    code: nonEmptyStringSchema,
    cueId: nonEmptyStringSchema,
    componentId: nonEmptyStringSchema.nullable(),
    originalEvidenceRef: relativePathSchema,
    originalEvidenceHash: c60ProtectedHashSchema,
    laterEvidenceRef: relativePathSchema,
    laterEvidenceHash: c60ProtectedHashSchema.nullable(),
    canonicalCueHash: c60ProtectedHashSchema,
    canonicalTimingHash: c60ProtectedHashSchema,
    semanticSubject: nonEmptyStringSchema,
    originalMeaning: nonEmptyStringSchema,
    laterMeaning: nonEmptyStringSchema.nullable(),
    cueIdentityMatched: z.boolean(),
    canonicalHashMatched: z.boolean(),
    timingHashMatched: z.boolean(),
    semanticSubjectMatched: z.boolean(),
    lineageCompatible: z.boolean(),
    canonicalTextChanged: z.boolean(),
    canonicalTimingChanged: z.boolean(),
    freshnessStatus: z.enum([
      "current",
      "superseded",
      "missing-later-evidence",
      "cue-mismatch",
      "hash-mismatch",
      "subject-mismatch",
      "canonical-changed",
      "timing-changed",
      "lineage-mismatch",
    ]),
    supersededByEvidenceIds: z.array(nonEmptyStringSchema),
    reasonCodes: z.array(nonEmptyStringSchema),
  })
  .strict();

export const subtitleFinalizationEvidenceFreshnessSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("subtitle-finalization-evidence-freshness"),
    freshnessVersion: z.literal("c6.0-evidence-freshness-v1"),
    generatedAt: z.iso.datetime(),
    policyHash: c60ProtectedHashSchema,
    baseCueHash: c60ProtectedHashSchema,
    baseTimingHash: c60ProtectedHashSchema,
    entries: z.array(freshnessEntrySchema),
    summary: z
      .object({
        assessedCount: nonNegativeIntegerSchema,
        currentCount: nonNegativeIntegerSchema,
        supersededCount: nonNegativeIntegerSchema,
        failedCount: nonNegativeIntegerSchema,
      })
      .strict(),
    integrityPassed: z.boolean(),
    semanticHash: c60ProtectedHashSchema,
  })
  .strict();

const baselinePreservationChecksSchema = z
  .object({
    humanAuthorityVerified: z.boolean(),
    sourceReadOnlyVerified: z.boolean(),
    humanSubtitleReadOnlyVerified: z.boolean(),
    canonicalCueHashUnchanged: z.boolean(),
    canonicalTimingHashUnchanged: z.boolean(),
    noCanonicalTextMutation: z.boolean(),
    noCanonicalTimingMutation: z.boolean(),
    noPositiveCurrentOutputDefectEvidence: z.boolean(),
    noIntegrityFinalBlockers: z.boolean(),
    noUnknownObservedSignals: z.boolean(),
    freshnessIntegrityPassed: z.boolean(),
    policyIntegrityPassed: z.boolean(),
    serializationRoundTripPassed: z.boolean(),
    formatSemanticParityPassed: z.boolean(),
    presentationIntegrityPassed: z.boolean(),
    reviewDeliveryIntegrityPassed: z.boolean(),
  })
  .strict();

export const subtitleBaselinePreservationAssessmentSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("subtitle-baseline-preservation-assessment"),
    preservationVersion: z.literal("c6.0-human-baseline-preservation-v1"),
    generatedAt: z.iso.datetime(),
    decisionPath: z.literal("BASELINE_PRESERVATION"),
    canonicalCueHashBefore: c60ProtectedHashSchema,
    canonicalCueHashAfter: c60ProtectedHashSchema,
    canonicalTimingHashBefore: c60ProtectedHashSchema,
    canonicalTimingHashAfter: c60ProtectedHashSchema,
    canonicalTextMutationCount: nonNegativeIntegerSchema,
    canonicalTimingMutationCount: nonNegativeIntegerSchema,
    checks: baselinePreservationChecksSchema,
    eligible: z.boolean(),
    applied: z.boolean(),
    reasonCodes: z.array(nonEmptyStringSchema),
    semanticHash: c60ProtectedHashSchema,
  })
  .strict();

const effectiveFindingSchema = z
  .object({
    findingId: nonEmptyStringSchema,
    originalSeverity: z.enum(["blocking", "warning"]),
    originalCode: nonEmptyStringSchema,
    cueIds: z.array(nonEmptyStringSchema),
    effectiveDisposition: c60ProtectedDispositionSchema,
    effectiveFinalBlocking: z.boolean(),
    effectiveReviewAdvisory: z.boolean(),
    riskScope: c60ProtectedBlockingScopeSchema,
    rootRiskFamily: nonEmptyStringSchema,
    freshnessStatus: z.enum([
      "current",
      "superseded",
      "not-applicable",
      "failed",
    ]),
    rationale: nonEmptyStringSchema,
    evidenceRefs: z.array(relativePathSchema),
    reasonCodes: z.array(nonEmptyStringSchema),
  })
  .strict();

const signalAssessmentSchema = z
  .object({
    signalId: nonEmptyStringSchema,
    code: nonEmptyStringSchema,
    occurrenceCount: nonNegativeIntegerSchema,
    policyMatched: z.boolean(),
    rootRiskFamily: nonEmptyStringSchema,
    blockingScope: c60ProtectedBlockingScopeSchema,
    evidencePolarity: c60ProtectedEvidencePolaritySchema,
    originalDisposition: c60ProtectedDispositionSchema,
    effectiveDisposition: c60ProtectedDispositionSchema,
    currentOutputRisk: c60CurrentOutputRiskSchema,
    proposedMutationRisk: c60ProposedMutationRiskSchema,
    finalBlocking: z.boolean(),
    reasonCodes: z.array(nonEmptyStringSchema),
  })
  .strict();

const rootRiskSchema = z
  .object({
    rootRiskId: nonEmptyStringSchema,
    rootRiskFamily: nonEmptyStringSchema,
    memberSignalIds: z.array(nonEmptyStringSchema),
    derivedFindingIds: z.array(nonEmptyStringSchema),
    metaFindingIds: z.array(nonEmptyStringSchema),
    effectiveDisposition: c60ProtectedDispositionSchema,
  })
  .strict();

const componentRiskSchema = z
  .object({
    reviewId: nonEmptyStringSchema,
    componentId: nonEmptyStringSchema,
    cueIds: z.array(nonEmptyStringSchema).min(2),
    currentOutputRisk: c60CurrentOutputRiskSchema,
    proposedMutationRisk: c60ProposedMutationRiskSchema,
    positiveCurrentOutputDefectEvidence: z.boolean(),
    safeAutomaticMutationAvailable: z.boolean(),
    speakerRelationshipResolved: z.boolean(),
    subtitleOverlapResolved: z.boolean(),
    preservationSupported: z.boolean(),
    preservationSupportEvidenceIds: z.array(nonEmptyStringSchema),
    reasonCodes: z.array(nonEmptyStringSchema),
  })
  .strict();

const riskSummarySchema = z
  .object({
    observedSignalCount: nonNegativeIntegerSchema,
    policyCoveredObservedSignalCount: nonNegativeIntegerSchema,
    unknownObservedSignalCount: nonNegativeIntegerSchema,
    unknownSignalFailClosedCount: nonNegativeIntegerSchema,
    legacyBlockingFindingCount: nonNegativeIntegerSchema,
    effectiveProtectedFinalBlockerCount: nonNegativeIntegerSchema,
    effectiveMutationGuardCount: nonNegativeIntegerSchema,
    effectiveReviewAdvisoryCount: nonNegativeIntegerSchema,
    effectiveDiagnosticCount: nonNegativeIntegerSchema,
    effectiveSupersededCount: nonNegativeIntegerSchema,
    positiveCurrentOutputDefectEvidenceCount: nonNegativeIntegerSchema,
    rootRiskFamilyCount: nonNegativeIntegerSchema,
    legacyReviewItemCount: nonNegativeIntegerSchema,
    protectedReviewArtifactItemCount: nonNegativeIntegerSchema,
    effectiveMandatoryReviewCount: nonNegativeIntegerSchema,
    effectiveAdvisoryReviewCount: nonNegativeIntegerSchema,
    preservationSupportedReviewCount: nonNegativeIntegerSchema,
    speakerRelationshipResolvedComponentCount: nonNegativeIntegerSchema,
    subtitleOverlapResolvedComponentCount: nonNegativeIntegerSchema,
    canonicalTextMutationCount: nonNegativeIntegerSchema,
    canonicalTimingMutationCount: nonNegativeIntegerSchema,
  })
  .strict();

export const subtitleFinalizationRiskAssessmentSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("subtitle-finalization-risk-assessment"),
    riskVersion: z.literal("C6.0-protected"),
    policyVersion: z.literal("c6.0-protected-finalization-risk-v1"),
    policyHash: c60ProtectedHashSchema,
    generatedAt: z.iso.datetime(),
    sourceIdentity: z
      .object({
        taskName: nonEmptyStringSchema,
        sourceFileName: nonEmptyStringSchema,
        sourceFileSha256: c60ProtectedHashSchema,
        sourceFileSize: nonNegativeIntegerSchema,
        canonicalCueHash: c60ProtectedHashSchema,
        canonicalTimingHash: c60ProtectedHashSchema,
        presentationHash: c60ProtectedHashSchema,
      })
      .strict(),
    humanAuthority: z
      .object({
        authorityType: z.enum(["user-confirmed-human-reviewed", "none"]),
        authorityVerified: z.boolean(),
        authoritySemanticHash: c60ProtectedHashSchema,
      })
      .strict(),
    mode: c60FinalizationPolicyModeSchema,
    machineOnlyReleaseAuthorized: z.literal(false),
    blindAcceptanceRequired: z.literal(true),
    legacyState: z
      .object({
        status: nonEmptyStringSchema,
        finalizationMethod: nonEmptyStringSchema,
        qualityPassed: z.boolean(),
        blockingFindingCount: nonNegativeIntegerSchema,
        reviewItemCount: nonNegativeIntegerSchema,
      })
      .strict(),
    policyIntegrityPassed: z.boolean(),
    signalAssessments: z.array(signalAssessmentSchema),
    freshnessAssessments: z.array(freshnessEntrySchema),
    effectiveFindings: z.array(effectiveFindingSchema),
    rootRisks: z.array(rootRiskSchema),
    componentRisks: z.array(componentRiskSchema),
    baselinePreservation: subtitleBaselinePreservationAssessmentSchema,
    summary: riskSummarySchema,
    protectedOutcome: c60ProtectedOutcomeSchema,
    semanticHash: c60ProtectedHashSchema,
  })
  .strict();

const reviewEffectiveDispositionItemSchema = z
  .object({
    reviewId: nonEmptyStringSchema,
    componentId: nonEmptyStringSchema,
    legacyRequiresHumanReview: z.boolean(),
    protectedDisposition: z.enum([
      "mandatory",
      "advisory",
      "preservation-supported",
    ]),
    protectedMandatory: z.boolean(),
    advisory: z.boolean(),
    preservationSupported: z.boolean(),
    reasonCodes: z.array(nonEmptyStringSchema),
    riskEvidenceIds: z.array(nonEmptyStringSchema),
  })
  .strict();

export const subtitleReviewEffectiveDispositionSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("subtitle-review-effective-disposition"),
    policyVersion: z.literal("c6.0-protected-finalization-risk-v1"),
    generatedAt: z.iso.datetime(),
    items: z.array(reviewEffectiveDispositionItemSchema),
    summary: z
      .object({
        legacyReviewItemCount: nonNegativeIntegerSchema,
        protectedReviewArtifactItemCount: nonNegativeIntegerSchema,
        effectiveMandatoryReviewCount: nonNegativeIntegerSchema,
        effectiveAdvisoryReviewCount: nonNegativeIntegerSchema,
        preservationSupportedReviewCount: nonNegativeIntegerSchema,
      })
      .strict(),
    semanticHash: c60ProtectedHashSchema,
  })
  .strict();

const modelExecutionCountsSchema = z
  .object({
    whisper: z.literal(0),
    mfa: z.literal(0),
    speaker: z.literal(0),
    ctc: z.literal(0),
    separation: z.literal(0),
    openai: z.literal(0),
    onlineSubtitleSearch: z.literal(0),
    wholeMediaAsr: z.literal(0),
    modelInferenceCount: z.literal(0),
    modelLoadCount: z.literal(0),
  })
  .strict();

export const c60ProtectedFinalizationReplaySummarySchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("c6-0-protected-finalization-replay-summary"),
    runId: nonEmptyStringSchema,
    generatedAt: z.iso.datetime(),
    mode: c60FinalizationPolicyModeSchema,
    sourceTask: nonEmptyStringSchema,
    authorityType: z.enum(["user-confirmed-human-reviewed", "none"]),
    authorityVerified: z.boolean(),
    riskPolicyHash: c60ProtectedHashSchema,
    freshnessHash: c60ProtectedHashSchema,
    rootRiskHash: c60ProtectedHashSchema,
    riskAssessmentHash: c60ProtectedHashSchema,
    reviewDispositionHash: c60ProtectedHashSchema,
    legacyStatus: nonEmptyStringSchema,
    protectedOutcome: c60ProtectedOutcomeSchema,
    effectiveStatus: nonEmptyStringSchema,
    effectiveFinalizationMethod: nonEmptyStringSchema,
    legacyBlockingFindingCount: nonNegativeIntegerSchema,
    effectiveFinalBlockerCount: nonNegativeIntegerSchema,
    advisoryCount: nonNegativeIntegerSchema,
    canonicalCueHashBefore: c60ProtectedHashSchema,
    canonicalCueHashAfter: c60ProtectedHashSchema,
    canonicalTimingHashBefore: c60ProtectedHashSchema,
    canonicalTimingHashAfter: c60ProtectedHashSchema,
    presentationHash: c60ProtectedHashSchema,
    outputFiles: z.array(relativePathSchema),
    strictFinalPackageExists: z.boolean(),
    reviewDeliveryIntegrityPassed: z.boolean(),
    reviewAudioPlayableCount: nonNegativeIntegerSchema,
    reviewAudioItemCount: nonNegativeIntegerSchema,
    modelExecutionCounts: modelExecutionCountsSchema,
    networkUsed: z.literal(false),
    semanticHash: c60ProtectedHashSchema,
  })
  .strict();

const validationRunSchema = z
  .object({
    runLabel: z.enum([
      "legacy",
      "default",
      "observe",
      "enforce-a",
      "enforce-b",
      "negative-control",
    ]),
    taskName: nonEmptyStringSchema,
    mode: c60FinalizationPolicyModeSchema,
    protectedOutcome: c60ProtectedOutcomeSchema.nullable(),
    status: nonEmptyStringSchema,
    finalizationMethod: nonEmptyStringSchema,
    canonicalCueHash: c60ProtectedHashSchema,
    canonicalTimingHash: c60ProtectedHashSchema,
    presentationHash: c60ProtectedHashSchema,
    riskAssessmentHash: c60ProtectedHashSchema.nullable(),
    finalPackageExists: z.boolean(),
  })
  .strict();

export const c60ProtectedFinalizationValidationSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("c6-0-protected-finalization-validation"),
    validationVersion: z.literal("c6.0-protected-finalization-validation-v1"),
    generatedAt: z.iso.datetime(),
    runs: z.array(validationRunSchema).length(6),
    legacyDefaultParity: z.boolean(),
    enforceSemanticParity: z.boolean(),
    canonicalCueParity: z.boolean(),
    canonicalTimingParity: z.boolean(),
    presentationParity: z.boolean(),
    machineNegativeControlBlocked: z.boolean(),
    unknownFailClosed: z.boolean(),
    integrityFailClosed: z.boolean(),
    policyIntegrityPassed: z.boolean(),
    freshnessIntegrityPassed: z.boolean(),
    shareableAuditPassed: z.boolean(),
    inputReadOnlyVerified: z.boolean(),
    modelInferenceCount: z.literal(0),
    modelLoadCount: z.literal(0),
    networkUsed: z.literal(false),
    passed: z.boolean(),
    semanticHash: c60ProtectedHashSchema,
  })
  .strict();

export type C60FinalizationPolicyMode = z.infer<
  typeof c60FinalizationPolicyModeSchema
>;
export type C60ProtectedDisposition = z.infer<
  typeof c60ProtectedDispositionSchema
>;
export type C60ProtectedRiskPolicyEntry = z.infer<
  typeof c60ProtectedRiskPolicyEntrySchema
>;
export type C60ProtectedRiskPolicy = z.infer<
  typeof c60ProtectedRiskPolicySchema
>;
export type HumanBaselineAuthority = z.infer<
  typeof humanBaselineAuthoritySchema
>;
export type SubtitleFinalizationEvidenceFreshness = z.infer<
  typeof subtitleFinalizationEvidenceFreshnessSchema
>;
export type SubtitleBaselinePreservationAssessment = z.infer<
  typeof subtitleBaselinePreservationAssessmentSchema
>;
export type SubtitleFinalizationRiskAssessment = z.infer<
  typeof subtitleFinalizationRiskAssessmentSchema
>;
export type SubtitleReviewEffectiveDisposition = z.infer<
  typeof subtitleReviewEffectiveDispositionSchema
>;
export type C60ProtectedFinalizationReplaySummary = z.infer<
  typeof c60ProtectedFinalizationReplaySummarySchema
>;
export type C60ProtectedFinalizationValidation = z.infer<
  typeof c60ProtectedFinalizationValidationSchema
>;
