import { c611PolicyFreezeSchema, type C611PolicyFreeze } from "@mvl/shared";
import { machineQualitySemanticHash as hash } from "../machine-quality/evidence-correlation.js";

export const C611_POLICY_VERSION =
  "c6.1.1-fixed-alignment-selective-existing-mbr-v1" as const;
/** Component policy documents are serialized exactly before labels exist;
 * their separately strict artifacts remain authoritative, not opaque options.
 */
export function freezeC611Policy(policies: {
  fixedAlignment: object;
  machine: object;
  calibration: object;
  oracle: object;
}): C611PolicyFreeze {
  const body = {
    schemaVersion: "1.0.0" as const,
    policyVersion: C611_POLICY_VERSION,
    artifactType: "c6-1-1-policy-freeze" as const,
    fixedAlignmentPolicyHash: hash(policies.fixedAlignment),
    machinePolicyHash: hash(policies.machine),
    calibrationPolicyHash: hash(policies.calibration),
    oraclePolicyHash: hash(policies.oracle),
    existingCandidateOnly: true as const,
    currentIsProviderVote: false as const,
    proposalGoldInputCount: 0 as const,
    featureGoldInputCount: 0 as const,
    novelApplicationAllowed: false as const,
    productionMutationAllowed: false as const,
    profileRematchingAllowed: false as const,
    testFoldThresholdTuningAllowed: false as const,
    policyDefinitions: Object.fromEntries(
      Object.entries(policies).map(([key, value]) => [
        key,
        JSON.stringify(value),
      ]),
    ),
    strongGate: {
      minimumFixedCoverage: 0.8 as const,
      minimumSelected: 5 as const,
      minimumSelectedFraction: 0.05 as const,
      maximumWrong: 0 as const,
      maximumCatastrophicDeletion: 0 as const,
      requirePositiveGain: true as const,
      requireBaselineQualityNonRegression: true as const,
      maximumNegativeActiveFolds: 0 as const,
    },
    promisingGate: {
      minimumFixedCoverage: 0.8 as const,
      minimumPrecision: 0.85 as const,
      maximumHarm: 0.1 as const,
      maximumMaterialErrorIncrease: 0 as const,
    },
    insufficientCoverageThreshold: 0.7 as const,
    c602Status: "HOLD" as const,
  };
  return c611PolicyFreezeSchema.parse({ ...body, semanticHash: hash(body) });
}
