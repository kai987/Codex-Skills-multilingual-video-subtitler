import {
  policy1452Schema,
  type FullRegistry1451,
  type Policy1452,
} from "@mvl/shared";
import { hashed141 } from "./c601141-policy.js";

export const header1452 = (
  policy: Policy1452,
  sourceIdentity: FullRegistry1451["sourceIdentity"],
) => ({
  schemaVersion: "1.0.0" as const,
  policyVersion: policy.policyVersion,
  policyHash: policy.semanticHash,
  sourceIdentity,
  sourceTimebase: "SOURCE_GLOBAL_NATIVE_SAMPLES" as const,
  runtimeGoldInputCount: 0 as const,
  visibility: "LOCAL_ONLY" as const,
});

export function policy1452(): Policy1452 {
  return policy1452Schema.parse(
    hashed141({
      schemaVersion: "1.0.0",
      policyVersion:
        "c6.0.1.14.5.2-product-scorability-playback-realization-v1",
      artifactType:
        "c6-0-1-14-5-2-product-scorability-playback-realization-policy",
      executionPolicy:
        "REPLAY_ONLY_PRODUCT_SCORABILITY_AND_PLAYBACK_REALIZATION",
      maximumInferenceCount: 0,
      maximumModelLoadCount: 0,
      maximumProviderProcessStartCount: 0,
      minimumSpeechAnchorPolicyVersion: "C601143_MINIMUM_CHILD_CORE_SECONDS_V1",
      minimumSpeechAnchorSeconds: 0.12,
      degenerateOrphanPolicyVersion:
        "C6011452_DEGENERATE_ORPHAN_BOUNDARY_SLIVER_V1",
      physicalContainerPlaybackSeparationVersion:
        "C6011452_PHYSICAL_CONTAINER_PLAYBACK_UNION_V1",
      playbackSetSearchVersion:
        "C6011452_EXACT_BOUNDED_INTERVAL_COVER_SEARCH_V1",
      witnessConnectivityVersion: "C6011452_GOLD_FREE_WITNESS_CONNECTIVITY_V2",
      productOutcomeDeterminacyVersion:
        "C6011452_DETERMINATE_PRODUCT_OUTCOME_V1",
      machineAnchorMinimumOverlapSeconds: 0.2,
      machineAnchorMinimumUnitCoverageRatio: 0.1,
      unitToGoldCoverageThreshold: 0.8,
      playbackToGoldCoverageThreshold: 0.8,
      playbackToUnitCoverageThreshold: 0.95,
      maximumReviewEnvelopeSeconds: 12,
      maximumOneSideContextSeconds: 3,
      maximumUnitsPerWitnessCandidate: 8,
      maximumRealizationsPerWitnessCandidate: 8,
      maximumWitnessReviewEnvelopeSeconds: 20,
      maximumInternalMachineGapSeconds: 0.5,
      coverageUnitMergeGapSeconds: 0.3,
      maximumPlaybackSetSearchSegments: 20,
      auditOnlyTargetSemantics: true,
      exactPlaybackSegmentSetEnumeration: true,
      completeRejectionLedgerRequired: true,
      determinateAbsenceIsScorableFail: true,
      notScorableReservedForInfrastructure: true,
      trueAllMandatoryPreserved: true,
      goldFeaturesAllowedBeforeFreeze: false,
      targetGeometryMutationAllowed: false,
      regionGeometryMutationAllowed: false,
      audioGeometryMutationAllowed: false,
      playbackGeometryMutationAllowed: false,
      canonicalMutationAllowed: false,
      plannerMutationAllowed: false,
      machineOnlyReleaseAuthorized: false,
      rankerRetrained: false,
    }),
  );
}
