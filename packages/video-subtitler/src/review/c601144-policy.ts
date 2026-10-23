import {
  utilityPolicy144Schema,
  type UtilityPolicy144,
  type C60114SourceIdentity,
} from "@mvl/shared";
import { hashed141 } from "./c601141-policy.js";

export const C601144_TIERS = [
  "TIER_5_VERIFIED_MULTI_FAMILY_SPEECH",
  "TIER_4_VERIFIED_INDEPENDENT_EXCLUSIVE_SPEECH",
  "TIER_3_VERIFIED_SINGLE_FAMILY_SPEECH",
  "TIER_2_MASKED_OR_SUBTHRESHOLD_SPEECH",
  "TIER_1_AUDIT_ONLY_SPEECH_CANDIDATE",
  "TIER_0_INELIGIBLE_OR_CONTRADICTED",
] as const;

export function policy144(): UtilityPolicy144 {
  return utilityPolicy144Schema.parse(
    hashed141({
      schemaVersion: "1.0.0",
      policyVersion: "c6.0.1.14.4-machine-evidence-utility-selection-v1",
      artifactType: "c6-0-1-14-4-machine-evidence-utility-policy",
      executionPolicy: "replay-only",
      mode: "REPLAY_ONLY_UTILITY_AND_SELECTION_REPAIR",
      maximumInferenceCount: 0,
      maximumModelLoadCount: 0,
      maximumProviderProcessStartCount: 0,
      maximumActiveSafetyBundles: 24,
      maximumSpeechCoreUnionSeconds: 60,
      maximumFullQueueEpisodeRatio: 0.95,
      forcedInclusionMaximumChildren: 32,
      maximumSearchStates: 5_000_000,
      durationBucketsSeconds: [0.2, 0.5, 1, 2, 4],
      durationUtilityCap: 5,
      evidenceStratumOrder: [
        "AUDIT_ONLY",
        "MASKED_SUBTHRESHOLD",
        "MULTI_VIEW_SAME_DETECTOR",
        "PYANNOTE_EXCLUSIVE",
        "SILERO_EXCLUSIVE",
        "WEBRTC_EXCLUSIVE",
        "LEGACY_FINGERPRINT_EXCLUSIVE",
        "MULTI_DETECTOR",
        "EXISTING_VERIFIED",
      ],
      posteriorSupportClasses: [
        "POSTERIOR_UNAVAILABLE",
        "POSTERIOR_LOW",
        "POSTERIOR_MEDIUM",
        "POSTERIOR_HIGH",
      ],
      speechEvidenceTiers: [...C601144_TIERS],
      independentFamilySemantics:
        "ONE_VOTE_PER_DETECTOR_OR_LEGACY_CORRELATION_FAMILY",
      sameDetectorViewProfileDeduplicated: true,
      webRtcBinaryNotProbability: true,
      sourceTimeUtilityFeatureAllowed: false,
      sourceTimeFinalTieBreakOnly: true,
      rawRecognizedTextAllowed: false,
      goldFeaturesAllowed: false,
      reviewSafetyPrimarySignal: "SPEECH_EVIDENCE_UTILITY",
      textCandidateSignalOrder: "LOWER_ORDER_AUXILIARY",
      contradictionGate: "INELIGIBLE",
      fullyProtectedCoverageGate: "AUDIT_ONLY",
      plannerObjectives: [
        "HARD_PHASE_A_OBLIGATION_COVERAGE",
        "TIER_5_OPTIONAL_REVIEW_UTILITY",
        "TIER_4_OPTIONAL_REVIEW_UTILITY",
        "TIER_3_OPTIONAL_REVIEW_UTILITY",
        "HIGH_TIER_OPTIONAL_CHILD_COUNT_AND_CAPPED_COVERAGE",
        "INDEPENDENT_FAMILY_AND_STRATUM_BREADTH",
        "TIMELINE_AND_SCENE_DIVERSITY",
        "TEXT_CANDIDATE_UTILITY",
        "LOW_TIER_CAPPED_COVERAGE",
        "MINIMUM_ACTIVE_BUNDLE_COUNT",
        "MINIMUM_SPEECH_CORE_UNION",
        "MINIMUM_INCREMENTAL_AUDIO",
        "MINIMUM_INTERNAL_SILENCE",
        "SOURCE_NATIVE_START_AND_STABLE_ID_TIE_BREAK",
      ],
      routeDecisionOrder: [
        "INTEGRITY",
        "UTILITY_PROPAGATION",
        "MONOTONICITY",
        "SEARCH_COMPLETENESS",
        "FEASIBILITY",
        "TARGET_SELECTION",
        "REVIEW_AUDIO",
        "QUALITY_GATE",
      ],
      rankerRetrained: false,
      newOofRun: false,
      canonicalMutationAllowed: false,
    }),
  );
}

export function header144(
  policy: UtilityPolicy144,
  sourceIdentity: C60114SourceIdentity,
) {
  return {
    schemaVersion: "1.0.0" as const,
    policyVersion: policy.policyVersion,
    policyHash: policy.semanticHash,
    sourceIdentity,
    sourceTimebase: "SOURCE_GLOBAL_NATIVE_SAMPLES" as const,
    runtimeGoldInputCount: 0 as const,
    visibility: "LOCAL_ONLY" as const,
  };
}

export function lexCompare144(a: readonly number[], b: readonly number[]) {
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

export function nonzero144(vector: readonly number[]) {
  return vector.some((value) => value !== 0);
}

export function durationBucket144(seconds: number) {
  if (seconds < 0.2) return { name: "LT_020" as const, ordinal: 0 };
  if (seconds < 0.5) return { name: "FROM_020_TO_050" as const, ordinal: 1 };
  if (seconds < 1) return { name: "FROM_050_TO_100" as const, ordinal: 2 };
  if (seconds < 2) return { name: "FROM_100_TO_200" as const, ordinal: 3 };
  if (seconds < 4) return { name: "FROM_200_TO_400" as const, ordinal: 4 };
  return { name: "GTE_400_CAPPED" as const, ordinal: 5 };
}

export function emptyTierCounts144() {
  return Object.fromEntries(C601144_TIERS.map((tier) => [tier, 0])) as Record<
    (typeof C601144_TIERS)[number],
    number
  >;
}

export function tierOrdinal144(tier: (typeof C601144_TIERS)[number]) {
  return 5 - C601144_TIERS.indexOf(tier);
}
