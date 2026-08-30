import { z } from "zod";

const id = z.string().min(1);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const count = z.number().int().nonnegative();
const finite = z.number();
const ratio = finite.min(0).max(1);
export const c611MachinePolicyVersion =
  "c6.1.1-fixed-alignment-selective-existing-mbr-v1" as const;
export const c611IntervalSchema = z
  .object({ start: finite.nonnegative(), end: finite.positive() })
  .strict()
  .refine((v) => v.end > v.start);
const header = {
  schemaVersion: z.literal("1.0.0"),
  policyVersion: z.literal(c611MachinePolicyVersion),
  runtimeGoldInputCount: z.literal(0),
  semanticHash: hash,
};
export const c611CandidateMachineMetadataSchema = z
  .object({
    sourceCandidateId: id,
    eventId: id.nullable(),
    sourceArtifactHash: hash,
    sourceTextHash: hash.nullable(),
    modelRevisionHash: hash.nullable(),
    coreAudioSha256: hash.nullable(),
    coreInterval: c611IntervalSchema.nullable(),
    requestAudioSha256: hash.nullable(),
    requestInterval: c611IntervalSchema.nullable(),
    decodeConfigurationHash: hash.nullable(),
    promptPolicyHash: hash.nullable(),
    requestId: id.nullable(),
    windowType: id.nullable(),
    speechCompletenessStatus: z.enum(["COMPLETE", "INCOMPLETE", "UNKNOWN"]),
    requestEdgeRisk: ratio.nullable(),
    leftEdgePinned: z.boolean().nullable(),
    rightEdgePinned: z.boolean().nullable(),
    incompleteSpeech: z.boolean().nullable(),
    decoderTruncationRisk: ratio.nullable(),
    tokenSupportCoverage: ratio.nullable(),
    hallucinationRisk: ratio.nullable(),
    semanticHash: hash,
  })
  .strict();
export const c611CorrelationObservationSchema = z
  .object({
    candidateId: id,
    eventId: id,
    providerFamily: z.enum(["WHISPER", "REAZON"]),
    legacyCorrelationGroupId: id,
    modelGroupId: id,
    coreGroupId: id,
    observationGroupId: id,
    modelIdentity: id,
    sourceInterval: c611IntervalSchema,
    coreInterval: c611IntervalSchema.nullable(),
    requestInterval: c611IntervalSchema.nullable(),
    coreAudioSha256: hash.nullable(),
    requestAudioSha256: hash.nullable(),
    decodeConfigurationHash: hash.nullable(),
    promptPolicyHash: hash.nullable(),
    requestId: id.nullable(),
    windowType: id,
    metadataEvidenceHashes: z.array(hash),
    missingMetadata: z.array(id),
    coreIdentityVerified: z.boolean(),
    normalizedTextHash: hash,
    semanticHash: hash,
  })
  .strict();
export const machineC611HierarchicalCorrelationGroupsSchema = z
  .object({
    ...header,
    artifactType: z.literal("machine-c6-1-1-hierarchical-correlation-groups"),
    candidateUniverseHash: hash,
    correlationPolicyHash: hash,
    sourceAudioIdentity: hash,
    observations: z.array(c611CorrelationObservationSchema),
    currentIndependentVoteCount: z.literal(0),
  })
  .strict();
const groupSummary = z
  .object({
    totalGroups: count,
    singletonGroups: count,
    singletonRate: ratio,
    groupsByProvider: z.object({ WHISPER: count, REAZON: count }).strict(),
    candidatesPerGroup: z.array(z.object({ groupId: id, count }).strict()),
    sameAudioDifferentRequestGroups: count,
    sameModelSameCoreSplitGroups: count,
    exactContextSeparatedGroups: count,
    duplicateTextAcrossGroups: count,
    divergentTextWithinGroup: count,
  })
  .strict();
export const machineC611CandidateCorrelationAuditSchema = z
  .object({
    ...header,
    artifactType: z.literal("machine-c6-1-1-candidate-correlation-audit"),
    correlationGroupsHash: hash,
    legacy: groupSummary,
    legacyAllIncludedGroupCount: count,
    legacyAllIncludedSingletonCount: count,
    legacyAllIncludedSingletonRate: ratio,
    hierarchical: groupSummary,
    includedAsrCandidateCount: count,
    currentControlCount: count,
    unknownCoreIdentityCount: count,
    unknownDecodeConfigurationCount: count,
    unknownPromptPolicyCount: count,
    reconciledSameCoreSplitGroupCount: count,
    reasons: z.array(id),
  })
  .strict();
export const c611CandidateRiskSchema = z
  .object({
    eventId: id,
    candidateId: id.nullable(),
    role: z.enum(["CURRENT_NO_SWITCH", "ASR_CANDIDATE"]),
    providerFamily: z.enum(["WHISPER", "REAZON", "CURRENT"]),
    legacyRisk: finite.nonnegative().nullable(),
    withinProviderRisk: finite.nonnegative().nullable(),
    crossProviderRisk: finite.nonnegative().nullable(),
    withinCorrelationRisk: finite.nonnegative().nullable(),
    providerBalancedRisk: finite.nonnegative().nullable(),
    hierarchicalRisk: finite.nonnegative().nullable(),
    providerRisks: z.array(
      z
        .object({
          providerFamily: z.enum(["WHISPER", "REAZON"]),
          meanRisk: finite.nonnegative(),
          medoidCandidateId: id,
          medoidRisk: finite.nonnegative(),
          coreGroupCount: count,
        })
        .strict(),
    ),
    semanticHash: hash,
  })
  .strict();
export const machineExistingCandidateMbrRiskLedgerSchema = z
  .object({
    ...header,
    artifactType: z.literal("machine-existing-candidate-mbr-risk-ledger"),
    candidateUniverseHash: hash,
    correlationGroupsHash: hash,
    riskPolicyHash: hash,
    rows: z.array(c611CandidateRiskSchema),
    currentIndependentVoteCount: z.literal(0),
    reasons: z.array(id),
  })
  .strict();
const variant = z.enum(["H0", "H1", "H2"]);
const eligibility = z.enum([
  "ELIGIBLE",
  "BLOCKED_STRUCTURAL",
  "NO_ALTERNATIVE",
]);
export const c611SpanApplicationSchema = z
  .object({
    finalCueId: id,
    spanStart: count,
    spanEnd: count,
    baselineSpanTextHash: hash,
    cueTextHash: hash,
    cueTimingHash: hash,
    lineageEvidenceHash: hash,
    replacementTextHash: hash,
    applicationProofHash: hash,
  })
  .strict();
export const c611ProposalSchema = z
  .object({
    proposalId: id,
    eventId: id,
    sourceAudioIdentity: hash,
    sourceInterval: c611IntervalSchema,
    acousticIntervals: z.array(c611IntervalSchema),
    finalCueIds: z.array(id),
    currentCandidateId: id.nullable(),
    proposedCandidateId: id.nullable(),
    proposedProvider: z.enum(["WHISPER", "REAZON"]).nullable(),
    proposedRole: id.nullable(),
    currentMbrRisk: finite.nonnegative().nullable(),
    proposedMbrRisk: finite.nonnegative().nullable(),
    rawMbrMargin: finite.nullable(),
    hierarchicalMbrMargin: finite.nullable(),
    runnerUpCandidateId: id.nullable(),
    runnerUpMargin: finite.nonnegative().nullable(),
    topKCandidateIds: z.array(id),
    eligibilityStatus: eligibility,
    eligibilityReasons: z.array(id),
    spanApplication: c611SpanApplicationSchema.nullable(),
    eligibleCandidates: z.array(
      z
        .object({ candidateId: id, spanApplication: c611SpanApplicationSchema })
        .strict(),
    ),
    diagnosticProposals: z.array(
      z
        .object({
          variant,
          candidateId: id.nullable(),
          currentRisk: finite.nonnegative().nullable(),
          proposedRisk: finite.nonnegative().nullable(),
          margin: finite.nullable(),
          eligibilityStatus: eligibility,
        })
        .strict(),
    ),
    rejectedCandidates: z.array(
      z.object({ candidateId: id, reasons: z.array(id).min(1) }).strict(),
    ),
    semanticHash: hash,
  })
  .strict();
export const machineSelectiveExistingCandidateProposalsSchema = z
  .object({
    ...header,
    artifactType: z.literal("machine-selective-existing-candidate-proposals"),
    candidateUniverseHash: hash,
    correlationGroupsHash: hash,
    riskLedgerHash: hash,
    proposalPolicyHash: hash,
    primaryVariant: z.literal("H2"),
    novelApplicationCount: z.literal(0),
    records: z.array(c611ProposalSchema),
  })
  .strict();
export const c611CompletenessRiskClassSchema = z.enum([
  "NO_CONTRACTION_RISK",
  "MILD_CONTRACTION_RISK",
  "STRONG_CONTRACTION_RISK",
  "EDGE_TRUNCATION_RISK",
  "INCOMPLETE_SPEECH_RISK",
  "UNSUPPORTED_DELETION_RISK",
]);
export const c611CompletenessRowSchema = z
  .object({
    proposalId: id,
    eventId: id,
    currentCharacterCount: count,
    proposedCharacterCount: count.nullable(),
    characterLengthRatio: finite.nonnegative().nullable(),
    currentTokenCount: count,
    proposedTokenCount: count.nullable(),
    tokenLengthRatio: finite.nonnegative().nullable(),
    normalizedLcsCoverage: ratio.nullable(),
    deletedCharacterRatio: ratio.nullable(),
    insertedCharacterRatio: ratio.nullable(),
    prefixRetention: ratio.nullable(),
    suffixRetention: ratio.nullable(),
    longestDeletedSpan: count.nullable(),
    longestInsertedSpan: count.nullable(),
    speechCompletenessStatus: z.enum(["COMPLETE", "INCOMPLETE", "UNKNOWN"]),
    requestEdgeRisk: ratio.nullable(),
    leftEdgePinned: z.boolean().nullable(),
    rightEdgePinned: z.boolean().nullable(),
    incompleteSpeech: z.boolean().nullable(),
    decoderTruncationRisk: ratio.nullable(),
    tokenSupportCoverage: ratio.nullable(),
    hallucinationRisk: ratio.nullable(),
    eventDuration: finite.positive(),
    charactersPerSecond: finite.nonnegative().nullable(),
    riskClasses: z.array(c611CompletenessRiskClassSchema),
    missingEvidence: z.array(id),
    softEvidenceOnly: z.literal(true),
    semanticHash: hash,
  })
  .strict();
export const machineExistingCandidateCompletenessRiskSchema = z
  .object({
    ...header,
    artifactType: z.literal("machine-existing-candidate-completeness-risk"),
    proposalHash: hash,
    riskPolicyHash: hash,
    rows: z.array(c611CompletenessRowSchema),
  })
  .strict();
export const C611_FEATURE_NAMES = [
  "rawMbrMargin",
  "hierarchicalMbrMargin",
  "runnerUpMargin",
  "providerCode",
  "candidateRoleCode",
  "providerSupportCount",
  "correlationSupportCount",
  "whisperStability",
  "reazonStability",
  "crossModelAgreement",
  "ctcDirection",
  "ctcMargin",
  "tokenSupportCoverage",
  "decoderTruncationRisk",
  "hallucinationRisk",
  "requestEdgeRisk",
  "speechCompleteness",
  "characterLengthRatio",
  "tokenLengthRatio",
  "normalizedLcsCoverage",
  "deletedCharacterRatio",
  "insertedCharacterRatio",
  "prefixRetention",
  "suffixRetention",
  "longestDeletedSpanRatio",
  "longestInsertedSpanRatio",
  "eventDuration",
  "charactersPerSecond",
  "normalizedDistance",
  "spanApplicationSafe",
] as const;
export const c611FeatureNameSchema = z.enum(C611_FEATURE_NAMES);
const featureValues = z
  .object(
    Object.fromEntries(
      C611_FEATURE_NAMES.map((name) => [name, finite.nullable()]),
    ) as Record<
      (typeof C611_FEATURE_NAMES)[number],
      z.ZodNullable<typeof finite>
    >,
  )
  .strict();
const featureMissing = z
  .object(
    Object.fromEntries(
      C611_FEATURE_NAMES.map((name) => [name, z.boolean()]),
    ) as Record<(typeof C611_FEATURE_NAMES)[number], z.ZodBoolean>,
  )
  .strict();
export const c611FeatureRowSchema = z
  .object({
    proposalId: id,
    eventId: id,
    values: featureValues,
    missingFlags: featureMissing,
    acousticEvidenceHashes: z.array(hash),
    semanticHash: hash,
  })
  .strict()
  .refine(
    (row) =>
      C611_FEATURE_NAMES.every(
        (name) => row.missingFlags[name] === (row.values[name] === null),
      ),
    "Missing flags must exactly match null evidence.",
  );
export const machineSelectiveMbrFeaturesSchema = z
  .object({
    ...header,
    artifactType: z.literal("machine-selective-mbr-features"),
    proposalHash: hash,
    completenessHash: hash,
    featureSchemaHash: hash,
    featureNames: z.array(c611FeatureNameSchema).length(30),
    rawTextFeatureCount: z.literal(0),
    goldFeatureCount: z.literal(0),
    datasetSpecificFeatureCount: z.literal(0),
    rows: z.array(c611FeatureRowSchema),
  })
  .strict()
  .refine(
    (v) => v.featureNames.every((name, i) => name === C611_FEATURE_NAMES[i]),
    "Feature ordering is fixed.",
  );

export type C611CandidateMachineMetadata = z.infer<
  typeof c611CandidateMachineMetadataSchema
>;
export type C611CorrelationObservation = z.infer<
  typeof c611CorrelationObservationSchema
>;
export type C611CorrelationGroups = z.infer<
  typeof machineC611HierarchicalCorrelationGroupsSchema
>;
export type C611CorrelationAudit = z.infer<
  typeof machineC611CandidateCorrelationAuditSchema
>;
export type C611CandidateRisk = z.infer<typeof c611CandidateRiskSchema>;
export type C611RiskLedger = z.infer<
  typeof machineExistingCandidateMbrRiskLedgerSchema
>;
export type C611Proposal = z.infer<typeof c611ProposalSchema>;
export type C611Proposals = z.infer<
  typeof machineSelectiveExistingCandidateProposalsSchema
>;
export type C611SpanApplication = z.infer<typeof c611SpanApplicationSchema>;
export type C611CompletenessRow = z.infer<typeof c611CompletenessRowSchema>;
export type C611Completeness = z.infer<
  typeof machineExistingCandidateCompletenessRiskSchema
>;
export type C611FeatureName = (typeof C611_FEATURE_NAMES)[number];
export type C611FeatureRow = z.infer<typeof c611FeatureRowSchema>;
export type C611Features = z.infer<typeof machineSelectiveMbrFeaturesSchema>;
