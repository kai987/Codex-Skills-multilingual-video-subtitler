import { z } from "zod";
import { blindEvaluationPolicySchema } from "./c6-0-1-blind-acceptance-schemas.js";

const sha = z.string().regex(/^[a-f0-9]{64}$/u);
const ratio = z.number().min(0).max(1);
const count = z.number().int().nonnegative();
const id = z.string().min(1);

export const c61DecoderPolicyVersion =
  "c6.1-consensus-investigation-v1" as const;
export const c61RoverVariantSchema = z.enum([
  "R0",
  "R1",
  "R2",
  "R3",
  "R4",
  "R5",
]);
export const c61DistanceMethodSchema = z.enum([
  "GRAPHEME",
  "PRONUNCIATION",
  "COMBINED",
]);
export const c61DecoderOutcomeSchema = z.enum([
  "KEEP_CURRENT",
  "SELECT_EXISTING_CANDIDATE",
  "SELECT_LEGAL_CONSENSUS_PATH",
  "ABSTAIN_AMBIGUOUS",
  "BLOCKED_UNSAFE",
  "SINGLE_HYPOTHESIS_NO_ACTION",
]);
export const c61HypothesisWeightSchema = z
  .object({
    candidateId: id,
    providerFamily: z.enum(["WHISPER", "REAZON", "CURRENT"]),
    correlationGroupId: id,
    rawCandidateSupport: count.positive(),
    correlatedGroupSupport: z.number().nonnegative(),
    providerFamilySupport: z.number().nonnegative(),
    stabilityMultiplier: ratio,
    acousticMultiplier: z.number().min(0.9).max(1.1),
    acousticStatus: z.enum(["EXACT_CACHE_MATCH", "UNKNOWN"]),
    acousticEvidenceId: id.nullable(),
    normalizedHypothesisWeight: ratio,
  })
  .strict();

export const c61SelectedPathSchema = z
  .object({
    nodeIds: z.array(id),
    edgeIds: z.array(id),
    displayText: z.string(),
    normalizedText: z.string(),
    pronunciationText: z.string().nullable(),
    sourceCandidateIds: z.array(id),
    equivalentCandidateIds: z.array(id),
    providerSwitchCount: count,
    candidateSwitchCount: count,
    pathLegal: z.boolean(),
    provenanceComplete: z.boolean(),
    pathKind: z.enum([
      "EXISTING_CANDIDATE_PATH",
      "NOVEL_LEGAL_PATH",
      "CURRENT_CONTROL_PATH",
    ]),
    semanticHash: sha,
  })
  .strict();

export const c61PathRiskSchema = z
  .object({
    path: c61SelectedPathSchema,
    expectedNormalizedDistance: z.number().nonnegative(),
    providerSwitchPenalty: z.number().nonnegative(),
    epsilonComplexityPenalty: z.number().nonnegative(),
    totalRisk: z.number().nonnegative(),
    pronunciationCoverage: ratio,
  })
  .strict();

export const c61NBestSearchSchema = z
  .object({
    algorithm: z.enum(["EXACT_LATTICE_MBR", "APPROXIMATE_LATTICE_MBR"]),
    beamWidth: count.positive(),
    maxPaths: count.positive(),
    maxProviderSwitches: count.nullable(),
    maxPathLength: count.positive(),
    visitedStateCount: count,
    beamPrunedStateCount: count,
    maxPathsTruncatedCount: count,
    lengthRejectedCount: count,
    unsafeRejectedCount: count,
    candidatePathsSeeded: count,
    exhaustiveWithinConstraints: z.boolean(),
    semanticHash: sha,
  })
  .strict();

export const c61SlotDecisionSchema = z
  .object({
    slotId: id,
    position: count,
    status: z.enum(["WINNER", "TIE", "ABSTAIN"]),
    winnerNodeIds: z.array(id),
    alternatives: z.array(
      z
        .object({
          nodeId: id,
          voteWeight: z.number().nonnegative(),
          pronunciationAggregatedWeight: z.number().nonnegative(),
          rawCandidateSupport: count,
          correlatedGroupSupport: count,
          providerFamilySupport: count,
        })
        .strict(),
    ),
    normalizedEntropy: ratio,
    normalizedVoteMargin: ratio,
    acousticEvidenceIds: z.array(id),
    reasons: z.array(z.string()),
  })
  .strict();

export const c61RoverResultSchema = z
  .object({
    profileId: id.optional(),
    eventId: id,
    variant: c61RoverVariantSchema,
    outputMode: z.enum([
      "EXISTING_CANDIDATE_ONLY",
      "LEGAL_LATTICE_PATH",
      "ABSTAIN_PRESERVE_CURRENT",
    ]),
    outcome: c61DecoderOutcomeSchema,
    selectedPath: c61SelectedPathSchema.nullable(),
    slotDecisions: z.array(c61SlotDecisionSchema),
    abstainedSlots: z.array(id),
    candidateSupport: z.array(c61HypothesisWeightSchema),
    providerSwitchCount: count,
    pathLegal: z.boolean(),
    provenanceComplete: z.boolean(),
    ambiguousSlotCount: count,
    ambiguousSpanCount: count,
    normalizedEntropy: ratio,
    providerDisagreement: ratio,
    pathRiskMargin: z.number().nonnegative().nullable(),
    reasons: z.array(z.string()),
    search: c61NBestSearchSchema.nullable(),
    semanticHash: sha,
  })
  .strict();

export const c61CandidateMbrResultSchema = z
  .object({
    profileId: id.optional(),
    eventId: id,
    distanceMethod: c61DistanceMethodSchema,
    outcome: c61DecoderOutcomeSchema,
    selectedCandidateId: id.nullable(),
    candidateRisks: z.array(
      z
        .object({
          candidateId: id,
          expectedNormalizedDistance: z.number().nonnegative(),
          pronunciationCoverage: ratio,
        })
        .strict(),
    ),
    weights: z.array(c61HypothesisWeightSchema),
    pathRiskMargin: z.number().nonnegative().nullable(),
    reasons: z.array(z.string()),
    semanticHash: sha,
  })
  .strict();

export const c61LatticeMbrResultSchema = z
  .object({
    profileId: id.optional(),
    eventId: id,
    distanceMethod: c61DistanceMethodSchema,
    outcome: c61DecoderOutcomeSchema,
    selectedPath: c61SelectedPathSchema.nullable(),
    nBestPaths: z.array(c61PathRiskSchema),
    weights: z.array(c61HypothesisWeightSchema),
    pathRiskMargin: z.number().nonnegative().nullable(),
    search: c61NBestSearchSchema,
    reasons: z.array(z.string()),
    semanticHash: sha,
  })
  .strict();

const header = {
  schemaVersion: z.literal("1.0.0"),
  policyVersion: z.literal(c61DecoderPolicyVersion),
};
export const machineMultiAsrRoverConsensusSchema = z
  .object({
    ...header,
    artifactType: z.literal("machine-multi-asr-rover-consensus"),
    results: z.array(c61RoverResultSchema),
    semanticHash: sha,
  })
  .strict();
export const machineMultiAsrMbrConsensusSchema = z
  .object({
    ...header,
    artifactType: z.literal("machine-multi-asr-mbr-consensus"),
    candidateMbrResults: z.array(c61CandidateMbrResultSchema),
    latticeMbrResults: z.array(c61LatticeMbrResultSchema),
    semanticHash: sha,
  })
  .strict();

export const c61ConsensusProfileSchema = z
  .object({
    profileId: z.enum([
      "P0",
      "P1",
      "P2",
      "P3",
      "P4",
      "P5",
      "P6",
      "P7",
      "P8",
      "P9",
    ]),
    name: z.string().min(1),
    decoder: z.enum([
      "CURRENT",
      "ROVER",
      "CANDIDATE_MBR",
      "LATTICE_MBR",
      "ABSTENTION_FIRST",
      "EXISTING_ONLY",
    ]),
    roverVariant: c61RoverVariantSchema.nullable(),
    distanceMethod: c61DistanceMethodSchema,
    maxProviderSwitches: count,
    minimumMargin: ratio,
    allowAmbiguousSlots: z.boolean(),
  })
  .strict();
export const c61ConsensusProfileFreezeSchema = z
  .object({
    ...header,
    artifactType: z.literal("c6-1-consensus-profile-freeze"),
    frozenBeforeGold: z.literal(true),
    outputClass: z.literal("RESEARCH_SHADOW_OUTPUT"),
    currentControlVotePolicy: z.literal("ZERO_WHEN_REAL_ASR_EXISTS"),
    providerTotals: z
      .object({ WHISPER: z.literal(1), REAZON: z.literal(1) })
      .strict(),
    correlationPolicy: z.literal(
      "EQUAL_PROVIDER_THEN_EQUAL_GROUP_THEN_EQUAL_DISTINCT_HYPOTHESIS",
    ),
    stabilityBounds: z.tuple([ratio, ratio]),
    acousticBounds: z.tuple([z.number(), z.number()]),
    acousticIdentityPolicy: z.literal(
      "EXACT_MODEL_AUDIO_CANDIDATE_PROVENANCE_CACHE_ONLY",
    ),
    weightInterpretation: z.literal(
      "NORMALIZED_HYPOTHESIS_WEIGHT_NOT_CALIBRATED_POSTERIOR",
    ),
    distancePolicy: z.literal(
      "LEVENSHTEIN_DIVIDED_BY_MAX_LENGTH_GRAPHEME_PRONUNCIATION_FALLBACK",
    ),
    combinedGraphemeWeight: ratio,
    alignmentPolicyHash: sha,
    alignmentCosts: z
      .object({
        exact: z.number().nonnegative(),
        normalized: z.number().nonnegative(),
        pronunciation: z.number().nonnegative(),
        substitution: z.number().nonnegative(),
        insertion: z.number().nonnegative(),
        deletion: z.number().nonnegative(),
      })
      .strict(),
    evaluationPolicy: blindEvaluationPolicySchema.omit({ frozenAt: true }),
    eventEvaluationPolicy: z
      .object({
        version: z.literal("c6.1-time-only-rendered-event-evaluation-v1"),
        minimumGoldOverlapRatio: z.literal(0.5),
        minimumEventOverlapRatio: z.literal(0.5),
        sharedGoldClaimPolicy: z.literal("EXCLUDE_ALL_MULTIPLE_EVENT_CLAIMS"),
        outputScope: z.literal("RENDERED_SHADOW_ONLY"),
        currentTextSource: z.literal("FROZEN_EVENT_CURRENT_TEXT_OR_EMPTY"),
        oracleDistanceUnit: z.literal("UNICODE_GRAPHEME_LEVENSHTEIN"),
        oracleGoldDenominatorUnit: z.literal("UNICODE_GRAPHEME"),
        normalization: z.literal(
          "NFKC_PUNCTUATION_WHITESPACE_INSENSITIVE_LOWERCASE_NO_KANA_GUESS",
        ),
        invalidMappingPolicy: z.literal("EXCLUDE_FROM_EVENT_METRICS"),
        bestProfilePolicy: z.literal("PRIMARY_P1_P9_POST_HOC_ONLY"),
      })
      .strict(),
    alignmentAblations: z
      .array(
        z
          .object({
            profileId: z.enum([
              "ALIGN_PRONUNCIATION_R2",
              "ALIGN_CENTER_CURRENT_R2",
              "ALIGN_CENTER_MEDOID_R2",
            ]),
            center: z.enum([
              "CENTER_CURRENT",
              "CENTER_MEDOID",
              "CENTER_PROVIDER_BALANCED_MEDOID",
            ]),
            pronunciationAware: z.boolean(),
            roverVariant: z.literal("R2"),
            allowAmbiguousSlots: z.literal(false),
            minimumMargin: ratio,
            maxProviderSwitches: count,
          })
          .strict(),
      )
      .length(3),
    slotMinimumVoteMargin: ratio,
    pathMinimumRiskMargin: ratio,
    providerSwitchPenalty: z.number().nonnegative(),
    epsilonComplexityPenalty: z.number().nonnegative(),
    beamWidth: count.positive(),
    maxPaths: count.positive(),
    maxPathLength: count.positive(),
    switchAblations: z.array(count.nullable()),
    profiles: z.array(c61ConsensusProfileSchema).length(10),
    supplementalRoverVariants: z.array(c61RoverVariantSchema),
    semanticHash: sha,
  })
  .strict();

export type C61RoverVariant = z.infer<typeof c61RoverVariantSchema>;
export type C61DistanceMethod = z.infer<typeof c61DistanceMethodSchema>;
export type C61HypothesisWeight = z.infer<typeof c61HypothesisWeightSchema>;
export type C61SelectedPath = z.infer<typeof c61SelectedPathSchema>;
export type C61NBestSearch = z.infer<typeof c61NBestSearchSchema>;
export type C61RoverResult = z.infer<typeof c61RoverResultSchema>;
export type C61CandidateMbrResult = z.infer<typeof c61CandidateMbrResultSchema>;
export type C61LatticeMbrResult = z.infer<typeof c61LatticeMbrResultSchema>;
export type C61ConsensusProfile = z.infer<typeof c61ConsensusProfileSchema>;
export type C61ConsensusProfileFreeze = z.infer<
  typeof c61ConsensusProfileFreezeSchema
>;
