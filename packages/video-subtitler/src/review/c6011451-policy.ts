import {
  policy1451Schema,
  type Policy1451,
  type C60114SourceIdentity,
} from "@mvl/shared";
import { hashed141 } from "./c601141-policy.js";

export const header1451 = (
  policy: Policy1451,
  sourceIdentity: C60114SourceIdentity,
) => ({
  schemaVersion: "1.0.0" as const,
  policyVersion: policy.policyVersion,
  policyHash: policy.semanticHash,
  sourceIdentity,
  sourceTimebase: "SOURCE_GLOBAL_NATIVE_SAMPLES" as const,
  runtimeGoldInputCount: 0 as const,
  visibility: "LOCAL_ONLY" as const,
});

export function policy1451(): Policy1451 {
  return policy1451Schema.parse(
    hashed141({
      schemaVersion: "1.0.0",
      policyVersion: "c6.0.1.14.5.1-full-unit-registry-review-binding-v1",
      artifactType: "c6-0-1-14-5-1-full-unit-registry-review-binding-policy",
      executionPolicy: "REPLAY_ONLY_REGISTRY_BINDING_AND_CONTRACT_REEVALUATION",
      maximumInferenceCount: 0,
      maximumModelLoadCount: 0,
      maximumProviderProcessStartCount: 0,
      registryBoundaryPolicyVersion:
        "C6011451_INVENTORY_ATOMIC_COVERAGE_STATE_PARTITION_V1",
      coverageStatePartitionVersion: "C6011451_COVERAGE_STATE_PARTITION_V1",
      planningProjectionPolicyVersion:
        "C601145_UNCOVERED_SAFETY_PLANNING_PROJECTION_V1",
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
      witnessAdjacencySeconds: 0.3,
      fullRegistryRequiredCoverageRatio: 1,
      positiveOverlapRequired: true,
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
