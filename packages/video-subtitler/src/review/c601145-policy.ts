import {
  policy145Schema,
  type Policy145,
  type C60114SourceIdentity,
} from "@mvl/shared";
import { hashed141 } from "./c601141-policy.js";

export const C601145_UNIT_TIERS = [
  "UNIT_TIER_5_MULTI_FAMILY_VERIFIED",
  "UNIT_TIER_4_INDEPENDENT_EXCLUSIVE_VERIFIED",
  "UNIT_TIER_3_SINGLE_FAMILY_VERIFIED",
  "UNIT_TIER_2_MASKED_OR_SUBTHRESHOLD",
  "UNIT_TIER_1_AUDIT_ONLY",
  "UNIT_TIER_0_INELIGIBLE_OR_CONTRADICTED",
] as const;

export const C601145_CONTRACTS = [
  "TARGET_CORE_LOCALIZATION_CONTRACT_V1",
  "MACHINE_ANCHORED_PLAYBACK_AUDIBILITY_CONTRACT_V1",
] as const;

export function policy145(): Policy145 {
  return policy145Schema.parse(
    hashed141({
      schemaVersion: "1.0.0",
      policyVersion: "c6.0.1.14.5-safety-coverage-unit-contract-v1",
      artifactType: "c6-0-1-14-5-safety-coverage-unit-policy",
      executionPolicy: "replay-only",
      mode: "REPLAY_ONLY_SAFETY_COVERAGE_UNIT_CONTRACT",
      maximumInferenceCount: 0,
      maximumModelLoadCount: 0,
      maximumProviderProcessStartCount: 0,
      coverageUnitBoundaryPolicyVersion:
        "C601145_SOURCE_NATIVE_CONNECTED_COMPONENT_V1",
      coverageUnitMergeGapSeconds: 0.3,
      hardBoundaryKinds: [
        "VERIFIED_SILENCE",
        "SOURCE_GLOBAL_TIME_DISCONTINUITY",
        "INCOMPATIBLE_SOURCE_IDENTITY",
        "INVALID_OR_UNVERIFIED_TIMEBASE",
        "STRONG_CONTRADICTION_TRANSITION",
        "IMMUTABLE_TARGET",
        "PHASE_A_OBLIGATION",
        "PHASE_A_TARGET",
        "FINAL_CUE_MASK",
        "STRONG_SCENE_BOUNDARY",
        "STRONG_SPEAKER_TRANSITION",
      ],
      softBoundaryKinds: [
        "DETECTOR_TRANSITION",
        "VIEW_TRANSITION",
        "POSTERIOR_VALLEY",
        "EVIDENCE_STRATUM_TRANSITION",
        "SHORT_GAP",
      ],
      segmentationInvariantIdentity: true,
      segmentationInvariantUtility: true,
      atomCountUtilityAllowed: false,
      childCountUtilityAllowed: false,
      bundleCountUtilityAllowed: false,
      rawRecognizedTextAllowed: false,
      exactSourceTimestampRiskFeatureAllowed: false,
      goldFeaturesAllowed: false,
      productGoContract: "MACHINE_ANCHORED_PLAYBACK_AUDIBILITY_CONTRACT_V1",
      targetCoreContract: "TARGET_CORE_LOCALIZATION_CONTRACT_V1",
      targetCoreGoldCoverageThreshold: 0.8,
      unitCoreGoldCoverageThreshold: 0.8,
      machineAnchorMinimumOverlapSeconds: 0.2,
      machineAnchorMinimumUnitCoverageRatio: 0.1,
      playbackGoldCoverageThreshold: 0.8,
      playbackUnitCoverageThreshold: 0.95,
      coreCompleteUnitCoverageThreshold: 0.95,
      maximumReviewEnvelopeSeconds: 12,
      maximumOneSideContextSeconds: 3,
      maximumActiveSafetyBundles: 24,
      maximumSpeechCoreUnionSeconds: 60,
      maximumFullQueueEpisodeRatio: 0.95,
      maximumSearchStates: 5_000_000,
      unitPlannerObjectives: [
        "UNIT_TIER_5_COVERAGE",
        "UNIT_TIER_4_COVERAGE",
        "UNIT_TIER_3_COVERAGE",
        "CAPPED_UNIT_CORE_COVERAGE",
        "INDEPENDENT_FAMILY_BREADTH",
        "EVIDENCE_STRATUM_BREADTH",
        "TIMELINE_SCENE_DIVERSITY",
        "TEXT_CANDIDATE_UTILITY",
        "LOW_TIER_UNIT_COVERAGE",
        "MINIMUM_ACTIVE_BUNDLE_COUNT",
        "MINIMUM_SPEECH_CORE_UNION",
        "MINIMUM_PHYSICAL_REVIEW_AUDIO",
        "MINIMUM_INTERNAL_SILENCE",
        "SOURCE_NATIVE_START_AND_STABLE_ID_TIE_BREAK",
      ],
      projectionHashRebindingRequired: true,
      nestedPreGoldPreflightRequired: true,
      productContractFrozenBeforeGold: true,
      individuallyFeasibleChildDiagnosticOnly: true,
      canonicalMutationAllowed: false,
      machineOnlyReleaseAuthorized: false,
      rankerRetrained: false,
    }),
  );
}

export function header145(
  policy: Policy145,
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

export function emptyUnitTierCounts145() {
  return Object.fromEntries(
    C601145_UNIT_TIERS.map((tier) => [tier, 0]),
  ) as Record<(typeof C601145_UNIT_TIERS)[number], number>;
}

export function lexCompare145(a: readonly number[], b: readonly number[]) {
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}
