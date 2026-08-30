import { z } from "zod";
import { c61MetricsSchema } from "./c6-1-evaluation-schemas.js";

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const id = z.string().min(1);
const count = z.number().int().nonnegative();
const ratio = z.number().min(0).max(1);
const header = {
  schemaVersion: z.literal("1.0.0"),
  policyVersion: z.literal("c6.1.1-fixed-alignment-selective-existing-mbr-v1"),
  evaluationOnly: z.literal(true),
  privacy: z.literal("LOCAL_ONLY"),
  semanticHash: hash,
};
export const c611EvaluationCueSchema = z
  .object({
    id,
    start: z.number().nonnegative(),
    end: z.number().nonnegative(),
    text: z.string(),
  })
  .strict();
export const c611FixedAlignmentPolicySchema = z
  .object({
    mappingPolicyVersion: z.literal("c6.1.1-time-connected-fixed-groups-v1"),
    algorithm: z.literal("BASELINE_TEMPORAL_BIPARTITE_COMPONENTS"),
    minimumMachineCoveredRatio: ratio,
    minimumGoldCoveredRatio: ratio,
    maxMachineCues: z.number().int().positive(),
    maxGoldCues: z.number().int().positive(),
    maxGroupDurationSeconds: z.number().positive(),
    maxWithinSideGapSeconds: z.number().nonnegative(),
    profileRematchingAllowed: z.literal(false),
    exactView: z.literal("NFC_GRAPHEME_CONCATENATED_CUES"),
    normalizedView: z.literal(
      "C61_NFKC_CASE_PUNCTUATION_WHITESPACE_INSENSITIVE_GRAPHEMES",
    ),
  })
  .strict();
export const c611FixedMappingStatusSchema = z.enum([
  "FIXED_ONE_TO_ONE",
  "FIXED_ONE_TO_MANY",
  "FIXED_MANY_TO_ONE",
  "FIXED_MANY_TO_MANY",
  "AMBIGUOUS_BASELINE_MAPPING",
  "NO_BASELINE_MAPPING",
  "STRUCTURE_INCOMPATIBLE",
]);
export const c611FixedGroupSchema = z
  .object({
    groupId: id,
    machineCueIds: z.array(id).min(1),
    machineCueIndexes: z.array(count).min(1),
    machineEventIds: z.array(id),
    goldCueIds: z.array(id),
    goldCueIndexes: z.array(count),
    sourceInterval: z
      .object({
        start: z.number().nonnegative(),
        end: z.number().nonnegative(),
      })
      .strict(),
    baselineTextHash: hash,
    baselineTimingHash: hash,
    goldTextHash: hash,
    goldTimingHash: hash,
    machineCoveredRatio: ratio,
    goldCoveredRatio: ratio,
    mappingStatus: c611FixedMappingStatusSchema,
    ambiguityReasons: z.array(id),
    semanticHash: hash,
  })
  .strict();
export const c611FixedBaselineAlignmentMapSchema = z
  .object({
    ...header,
    artifactType: z.literal("c6-1-1-fixed-baseline-alignment-map"),
    machineFreezeHash: hash,
    machineFrozenAt: z.iso.datetime(),
    goldFirstReadAt: z.iso.datetime(),
    machineArtifactsFrozenBeforeGold: z.literal(true),
    baselineCueHash: hash,
    baselineTimingHash: hash,
    baselineCueOrder: z.array(id),
    goldCueHash: hash,
    goldCueOrder: z.array(id),
    eventBindingsHash: hash,
    mappingPolicyVersion: z.literal("c6.1.1-time-connected-fixed-groups-v1"),
    mappingPolicy: c611FixedAlignmentPolicySchema,
    mappingPolicyHash: hash,
    mappingSemanticHash: hash,
    groups: z.array(c611FixedGroupSchema),
    unmappedGoldCueIds: z.array(id),
    summary: z
      .object({
        totalCueGroups: count,
        stableMappedGroups: count,
        ambiguousGroups: count,
        unmappedGroups: count,
        structureIncompatibleGroups: count,
        oneToOne: count,
        oneToMany: count,
        manyToOne: count,
        manyToMany: count,
        assignedMachineCueCount: count,
        assignedGoldCueCount: count,
        unmappedGoldCueCount: count,
      })
      .strict(),
  })
  .strict();
export const c611FixedInvarianceSchema = z
  .object({
    cueIdSetParity: z.boolean(),
    cueOrderParity: z.boolean(),
    timingParity: z.boolean(),
    groupStructureParity: z.boolean(),
    baselineIdentityParity: z.boolean(),
    goldIdentityParity: z.boolean(),
    mappingIntegrityParity: z.boolean(),
    eligible: z.boolean(),
    reasons: z.array(id),
  })
  .strict();
export const c611FixedGroupEvaluationSchema = z
  .object({
    groupId: id,
    eventIds: z.array(id),
    cueIds: z.array(id),
    goldCueIds: z.array(id),
    mappingStatus: c611FixedMappingStatusSchema,
    changed: z.boolean(),
    baselineTextHash: hash,
    shadowTextHash: hash,
    baselineExactError: count.nullable(),
    baselineNormalizedError: count.nullable(),
    shadowExactError: count.nullable(),
    shadowNormalizedError: count.nullable(),
    goldExactGraphemeCount: count.nullable(),
    goldNormalizedGraphemeCount: count.nullable(),
    exactGain: z.number().int().nullable(),
    normalizedGain: z.number().int().nullable(),
    outcome: z.enum(["IMPROVED", "REGRESSED", "NEUTRAL", "UNEVALUABLE"]),
    reasons: z.array(id),
    semanticHash: hash,
  })
  .strict();
export const c611FixedAlignmentEvaluationSchema = z
  .object({
    ...header,
    artifactType: z.literal("c6-1-1-fixed-alignment-evaluation"),
    evaluationMethod: z.literal("FIXED_GROUP_EVALUATION"),
    errorUnit: z.literal("GRAPHEME_EDIT_COUNT_UNIQUE_CUE_GROUP"),
    profileId: id,
    fixedMapHash: hash,
    mappingSemanticHash: hash,
    baselineCueHash: hash,
    shadowCueHash: hash,
    invariance: c611FixedInvarianceSchema,
    groups: z.array(c611FixedGroupEvaluationSchema),
    summary: z
      .object({
        totalCueGroups: count,
        changedCueGroups: count,
        stableMappedGroups: count,
        ambiguousGroups: count,
        unmappedGroups: count,
        structureIncompatibleGroups: count,
        fixedMappedChangedGroupCount: count,
        evaluableGroups: count,
        improvedGroups: count,
        regressedGroups: count,
        neutralGroups: count,
        unevaluableGroups: count,
        fixedEvaluationCoverage: ratio.nullable(),
        changedGroupCoverage: ratio.nullable(),
        baselineExactError: count,
        baselineNormalizedError: count,
        shadowExactError: count,
        shadowNormalizedError: count,
        exactGain: z.number().int(),
        normalizedGain: z.number().int(),
        goldExactGraphemeCount: count,
        goldNormalizedGraphemeCount: count,
        baselineExactCer: z.number().nonnegative().nullable(),
        baselineNormalizedCer: z.number().nonnegative().nullable(),
        shadowExactCer: z.number().nonnegative().nullable(),
        shadowNormalizedCer: z.number().nonnegative().nullable(),
      })
      .strict(),
  })
  .strict();
export const c611ProposalLabelSchema = z
  .object({
    proposalId: id,
    eventId: id,
    candidateId: id.nullable(),
    groupIds: z.array(id),
    groupIdentityHash: hash,
    counterfactualHash: hash,
    outcome: z.enum([
      "SWITCH_IMPROVES",
      "SWITCH_REGRESSES",
      "SWITCH_NEUTRAL",
      "SWITCH_UNEVALUABLE",
    ]),
    baselineError: count.nullable(),
    proposedError: count.nullable(),
    exactGain: z.number().int().nullable(),
    normalizedGain: z.number().int().nullable(),
    reasons: z.array(id),
    groupResults: z.array(c611FixedGroupEvaluationSchema),
    semanticHash: hash,
  })
  .strict();
export const c611ProposalLabelsSchema = z
  .object({
    ...header,
    artifactType: z.literal("gold-selective-existing-candidate-labels"),
    proposalSetHash: hash,
    fixedMapHash: hash,
    foldMembershipHash: hash,
    labels: z.array(c611ProposalLabelSchema),
    summary: z
      .object({
        totalProposals: count,
        improved: count,
        regressed: count,
        neutral: count,
        unevaluable: count,
        fixedGroupCrossFoldCount: count,
        uniqueEvaluableGroups: count,
        groupErrorAggregation: z.literal(
          "NO_SUMMATION_OF_CORRELATED_PROPOSAL_COUNTERFACTUAL_ERRORS",
        ),
      })
      .strict(),
  })
  .strict();
export type C611EvaluationCue = z.infer<typeof c611EvaluationCueSchema>;
export type C611FixedAlignmentPolicy = z.infer<
  typeof c611FixedAlignmentPolicySchema
>;
export type C611FixedMappingStatus = z.infer<
  typeof c611FixedMappingStatusSchema
>;
export type C611FixedGroup = z.infer<typeof c611FixedGroupSchema>;
export type C611FixedBaselineAlignmentMap = z.infer<
  typeof c611FixedBaselineAlignmentMapSchema
>;
export type C611FixedInvariance = z.infer<typeof c611FixedInvarianceSchema>;
export type C611FixedGroupEvaluation = z.infer<
  typeof c611FixedGroupEvaluationSchema
>;
export type C611FixedAlignmentEvaluation = z.infer<
  typeof c611FixedAlignmentEvaluationSchema
>;
export type C611ProposalLabel = z.infer<typeof c611ProposalLabelSchema>;
export type C611ProposalLabels = z.infer<typeof c611ProposalLabelsSchema>;

export const c611SelectiveProfileQualitySchema = z
  .object({
    ...header,
    artifactType: z.literal("c6-1-1-selective-profile-quality"),
    profileId: id,
    fixedEvaluationHash: hash,
    fixedMapHash: hash,
    legacyEvaluationHash: hash,
    baselineLegacyEvaluationHash: hash,
    fixedEvaluationMethod: z.literal("FIXED_GROUP_EVALUATION"),
    fullEpisodeEvaluationMethod: z.literal(
      "LEGACY_GLOBAL_CUE_GROUP_MATCHING_DIAGNOSTIC_ONLY",
    ),
    legacyMetricsUsedForProposalLabels: z.literal(false),
    baselineMetrics: c61MetricsSchema,
    shadowMetrics: c61MetricsSchema,
    timingHashUnchanged: z.boolean(),
    matchingInducedTimingDelta: z.boolean(),
    baselineAllPairOverlapCount: count,
    shadowAllPairOverlapCount: count,
  })
  .strict();
export type C611SelectiveProfileQuality = z.infer<
  typeof c611SelectiveProfileQualitySchema
>;

export const c611GroupedOraclePolicySchema = z
  .object({
    oraclePolicyVersion: z.literal("c6.1.1-fixed-group-existing-oracles-v1"),
    maxCombinationsPerGroup: z.literal(65536),
    objective: z.literal(
      "NORMALIZED_ERROR_THEN_FEWER_SWITCHES_THEN_EXACT_ERROR_THEN_SELECTION_HASH",
    ),
    searchMethod: z.literal("EXHAUSTIVE_COMPLETE_GROUP_ASSIGNMENTS"),
    searchLimitAction: z.literal("SKIP_SEARCH_EXACT_VALUE_UNKNOWN"),
    crossGroupEventAction: z.literal("UNEVALUABLE_COUPLED_ASSIGNMENT"),
    individualProposalGainsSummed: z.literal(false),
    newTextGenerationAllowed: z.literal(false),
  })
  .strict();
const oracleSelection = z.object({ eventId: id, candidateId: id }).strict();
export const c611GroupedOracleSearchSchema = z
  .object({
    status: z.enum(["EXACT", "SEARCH_LIMIT", "UNEVALUABLE", "ASSEMBLY_ERROR"]),
    theoreticalCombinations: z.string().regex(/^[0-9]+$/u),
    searchedCombinations: count,
    validCombinations: count,
    rejectedCombinations: count,
    assemblyErrorCombinations: count,
    rejectionReasons: z.record(id, count),
    bestExactError: count.nullable(),
    bestNormalizedError: count.nullable(),
    exactGain: z.number().int().nullable(),
    normalizedGain: z.number().int().nullable(),
    bestObservedExactError: count.nullable(),
    bestObservedNormalizedError: count.nullable(),
    bestObservedSelections: z.array(oracleSelection),
    bestObservedCueHash: hash.nullable(),
    optimumBounds: z.enum(["EXACT_VALUE", "UNKNOWN"]),
    reasons: z.array(id),
    semanticHash: hash,
  })
  .strict();
export const c611GroupedOracleGroupSchema = z
  .object({
    groupId: id,
    eventIds: z.array(id),
    cueIds: z.array(id),
    mappingStatus: c611FixedMappingStatusSchema,
    currentExactError: count.nullable(),
    currentNormalizedError: count.nullable(),
    goldExactGraphemeCount: count.nullable(),
    goldNormalizedGraphemeCount: count.nullable(),
    proposalOracle: c611GroupedOracleSearchSchema,
    bestExistingCandidateOracle: c611GroupedOracleSearchSchema,
    semanticHash: hash,
  })
  .strict();
const oracleSummary = z
  .object({
    exactGroups: count,
    searchLimitGroups: count,
    unevaluableGroups: count,
    assemblyErrorGroups: count,
    entireFixedMapExact: z.boolean(),
    exactGroupCoverage: ratio.nullable(),
    baselineExactError: count,
    baselineNormalizedError: count,
    bestExactError: count,
    bestNormalizedError: count,
    exactGain: z.number().int(),
    normalizedGain: z.number().int(),
    goldExactGraphemeCount: count,
    goldNormalizedGraphemeCount: count,
    baselineExactCer: z.number().nonnegative().nullable(),
    baselineNormalizedCer: z.number().nonnegative().nullable(),
    bestExactCer: z.number().nonnegative().nullable(),
    bestNormalizedCer: z.number().nonnegative().nullable(),
    searchedCombinations: count,
    validCombinations: count,
    rejectedCombinations: count,
    errorAggregation: z.literal("UNIQUE_EXACT_FIXED_GROUPS_ONLY"),
  })
  .strict();
export const c611GroupedOracleSchema = z
  .object({
    ...header,
    artifactType: z.literal("c6-1-1-grouped-existing-candidate-oracles"),
    fixedMapHash: hash,
    mappingSemanticHash: hash,
    baselineCueHash: hash,
    frozenAlternativeOptionsHash: hash,
    primaryProposalsHash: hash,
    oraclePolicy: c611GroupedOraclePolicySchema,
    oraclePolicyHash: hash,
    productionMutationCount: z.literal(0),
    evaluationMethod: z.literal("FIXED_GROUP_JOINT_COMPLETE_CANDIDATE_SEARCH"),
    groups: z.array(c611GroupedOracleGroupSchema),
    summary: z
      .object({
        totalCueGroups: count,
        unmappedAlternativeEventIds: z.array(id),
        unmappedPrimaryEventIds: z.array(id),
        proposalOracle: oracleSummary,
        bestExistingCandidateOracle: oracleSummary,
      })
      .strict(),
  })
  .strict();
export type C611GroupedOraclePolicy = z.infer<
  typeof c611GroupedOraclePolicySchema
>;
export type C611GroupedOracleSearch = z.infer<
  typeof c611GroupedOracleSearchSchema
>;
export type C611GroupedOracleGroup = z.infer<
  typeof c611GroupedOracleGroupSchema
>;
export type C611GroupedOracle = z.infer<typeof c611GroupedOracleSchema>;
