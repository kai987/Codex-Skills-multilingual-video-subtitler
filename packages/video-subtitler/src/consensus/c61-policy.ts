import type {
  C61ConsensusProfile,
  C61ConsensusProfileFreeze,
} from "@mvl/shared";
import { machineQualitySemanticHash } from "../machine-quality/evidence-correlation.js";
import { C61_ALIGNMENT_COSTS } from "./pairwise-sequence-alignment.js";
import { createC601EvaluationPolicy } from "../blind-acceptance/policy.js";

export const C61_POLICY_VERSION = "c6.1-consensus-investigation-v1" as const;

export const C61_EVENT_EVALUATION_POLICY = Object.freeze({
  version: "c6.1-time-only-rendered-event-evaluation-v1",
  minimumGoldOverlapRatio: 0.5,
  minimumEventOverlapRatio: 0.5,
  sharedGoldClaimPolicy: "EXCLUDE_ALL_MULTIPLE_EVENT_CLAIMS",
  outputScope: "RENDERED_SHADOW_ONLY",
  currentTextSource: "FROZEN_EVENT_CURRENT_TEXT_OR_EMPTY",
  oracleDistanceUnit: "UNICODE_GRAPHEME_LEVENSHTEIN",
  oracleGoldDenominatorUnit: "UNICODE_GRAPHEME",
  normalization:
    "NFKC_PUNCTUATION_WHITESPACE_INSENSITIVE_LOWERCASE_NO_KANA_GUESS",
  invalidMappingPolicy: "EXCLUDE_FROM_EVENT_METRICS",
  bestProfilePolicy: "PRIMARY_P1_P9_POST_HOC_ONLY",
} as const);

/** Generic constants; changing any value creates a new post-C6.1 policy version. */
export const C61_DECODER_LIMITS = Object.freeze({
  beamWidth: 64,
  maxPaths: 128,
  maxPathLength: 512,
  maxProviderSwitches: 2,
  slotMinimumVoteMargin: 0.05,
  pathMinimumRiskMargin: 0.01,
  providerSwitchPenalty: 0.005,
  epsilonComplexityPenalty: 0.0001,
  combinedGraphemeWeight: 0.75,
});

const profile = (
  profileId: C61ConsensusProfile["profileId"],
  name: string,
  decoder: C61ConsensusProfile["decoder"],
  roverVariant: C61ConsensusProfile["roverVariant"],
  allowAmbiguousSlots = false,
  minimumMargin: number = C61_DECODER_LIMITS.pathMinimumRiskMargin,
): C61ConsensusProfile => ({
  profileId,
  name,
  decoder,
  roverVariant,
  distanceMethod: "COMBINED",
  maxProviderSwitches: C61_DECODER_LIMITS.maxProviderSwitches,
  minimumMargin,
  allowAmbiguousSlots,
});

export function freezeC61Profiles(
  alignmentPolicyHash: string,
): C61ConsensusProfileFreeze {
  // Capture the genuine configuration now; remove the wall-clock field rather
  // than inventing a historical time. Legacy policyHash already excludes time.
  const { frozenAt: creationTime, ...evaluationPolicy } =
    createC601EvaluationPolicy(new Date().toISOString());
  void creationTime;
  const value: Omit<C61ConsensusProfileFreeze, "semanticHash"> = {
    schemaVersion: "1.0.0",
    policyVersion: C61_POLICY_VERSION,
    artifactType: "c6-1-consensus-profile-freeze",
    frozenBeforeGold: true,
    outputClass: "RESEARCH_SHADOW_OUTPUT",
    currentControlVotePolicy: "ZERO_WHEN_REAL_ASR_EXISTS",
    providerTotals: { WHISPER: 1, REAZON: 1 },
    correlationPolicy:
      "EQUAL_PROVIDER_THEN_EQUAL_GROUP_THEN_EQUAL_DISTINCT_HYPOTHESIS",
    stabilityBounds: [0.75, 1],
    acousticBounds: [0.9, 1.1],
    acousticIdentityPolicy: "EXACT_MODEL_AUDIO_CANDIDATE_PROVENANCE_CACHE_ONLY",
    weightInterpretation:
      "NORMALIZED_HYPOTHESIS_WEIGHT_NOT_CALIBRATED_POSTERIOR",
    distancePolicy:
      "LEVENSHTEIN_DIVIDED_BY_MAX_LENGTH_GRAPHEME_PRONUNCIATION_FALLBACK",
    alignmentPolicyHash,
    alignmentCosts: { ...C61_ALIGNMENT_COSTS },
    evaluationPolicy,
    eventEvaluationPolicy: { ...C61_EVENT_EVALUATION_POLICY },
    alignmentAblations: [
      {
        profileId: "ALIGN_PRONUNCIATION_R2",
        center: "CENTER_PROVIDER_BALANCED_MEDOID",
        pronunciationAware: true,
        roverVariant: "R2",
        allowAmbiguousSlots: false,
        minimumMargin: C61_DECODER_LIMITS.pathMinimumRiskMargin,
        maxProviderSwitches: C61_DECODER_LIMITS.maxProviderSwitches,
      },
      {
        profileId: "ALIGN_CENTER_CURRENT_R2",
        center: "CENTER_CURRENT",
        pronunciationAware: false,
        roverVariant: "R2",
        allowAmbiguousSlots: false,
        minimumMargin: C61_DECODER_LIMITS.pathMinimumRiskMargin,
        maxProviderSwitches: C61_DECODER_LIMITS.maxProviderSwitches,
      },
      {
        profileId: "ALIGN_CENTER_MEDOID_R2",
        center: "CENTER_MEDOID",
        pronunciationAware: false,
        roverVariant: "R2",
        allowAmbiguousSlots: false,
        minimumMargin: C61_DECODER_LIMITS.pathMinimumRiskMargin,
        maxProviderSwitches: C61_DECODER_LIMITS.maxProviderSwitches,
      },
    ],
    beamWidth: C61_DECODER_LIMITS.beamWidth,
    maxPaths: C61_DECODER_LIMITS.maxPaths,
    maxPathLength: C61_DECODER_LIMITS.maxPathLength,
    slotMinimumVoteMargin: C61_DECODER_LIMITS.slotMinimumVoteMargin,
    pathMinimumRiskMargin: C61_DECODER_LIMITS.pathMinimumRiskMargin,
    providerSwitchPenalty: C61_DECODER_LIMITS.providerSwitchPenalty,
    epsilonComplexityPenalty: C61_DECODER_LIMITS.epsilonComplexityPenalty,
    combinedGraphemeWeight: C61_DECODER_LIMITS.combinedGraphemeWeight,
    // maxProviderSwitches lives per profile; each ablation is frozen explicitly below.
    switchAblations: [0, 1, 2, 3, null],
    profiles: [
      profile("P0", "CURRENT_FINAL_BASELINE", "CURRENT", null),
      profile("P1", "SIMPLE_ROVER", "ROVER", "R0"),
      profile("P2", "PROVIDER_BALANCED_ROVER", "ROVER", "R1"),
      profile("P3", "CORRELATION_AWARE_ROVER", "ROVER", "R2"),
      profile("P4", "PRONUNCIATION_AWARE_ROVER", "ROVER", "R4"),
      profile("P5", "ACOUSTIC_AWARE_ROVER", "ROVER", "R5"),
      profile("P6", "CANDIDATE_LEVEL_MBR", "CANDIDATE_MBR", null),
      profile("P7", "LEGAL_LATTICE_PATH_MBR", "LATTICE_MBR", null, true),
      profile(
        "P8",
        "ABSTENTION_FIRST_CONSENSUS",
        "ABSTENTION_FIRST",
        "R2",
        false,
        0.05,
      ),
      profile("P9", "EXISTING_CANDIDATE_ONLY_CONSENSUS", "EXISTING_ONLY", "R2"),
    ],
    supplementalRoverVariants: ["R3"],
  };
  // The object is deliberately constructed without a run timestamp: A/B identity is semantic.
  return { ...value, semanticHash: machineQualitySemanticHash(value) };
}
