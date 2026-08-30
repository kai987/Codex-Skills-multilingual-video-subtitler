import {
  c60113DeploymentRankerSchema,
  type C60113RegionFeatures,
} from "@mvl/shared";
import {
  assertC60113FeatureHash,
  c60113Hash,
  c60113HashPayload,
} from "./c60113-region-features.js";
import { predictC60113LinearRanker } from "./c60113-region-ranker-calibration.js";
import { selectC60113Regions } from "./review-burden-planner.js";
import { buildC60113ReviewPolicy } from "./c60113-policy.js";

/** Prediction only: fitting and evaluation labels are unavailable in this API. */
export function scoreC60113DeploymentRegions(input: {
  deployment: unknown;
  features: C60113RegionFeatures;
}): Record<string, number> | null {
  const deployment = c60113DeploymentRankerSchema.parse(input.deployment);
  assertC60113FeatureHash(input.features);
  if (c60113HashPayload(deployment) !== deployment.semanticHash)
    throw new Error("DEPLOYMENT_RANKER_HASH_MISMATCH");
  if (
    JSON.stringify(input.features.featureNames) !==
    JSON.stringify(deployment.featureNames)
  )
    throw new Error("DEPLOYMENT_FEATURE_SCHEMA_MISMATCH");
  if (deployment.model === null) return null;
  const model = deployment.model;
  return Object.fromEntries(
    input.features.regions.map((region) => [
      region.regionId,
      predictC60113LinearRanker(model, region),
    ]),
  );
}

/** The selected order and incremental costs are bound to the parameters actually used. */
export function selectC60113DeploymentRegions(input: {
  deployment: unknown;
  features: C60113RegionFeatures;
  budgetSeconds: number | null;
  mandatoryOnly?: boolean;
}) {
  const deployment = c60113DeploymentRankerSchema.parse(input.deployment);
  const scores = scoreC60113DeploymentRegions(input);
  const policy = buildC60113ReviewPolicy();
  if (input.features.policyHash !== policy.semanticHash)
    throw new Error("DEPLOYMENT_MACHINE_POLICY_HASH_MISMATCH");
  const regions = input.features.regions.map((row) => {
    if (row.selectorEvidence === null)
      throw new Error("DEPLOYMENT_SELECTOR_EVIDENCE_MISSING");
    if (
      row.selectorEvidence.regionId !== row.regionId ||
      JSON.stringify(row.contextInterval) !==
        JSON.stringify(row.selectorEvidence.contextInterval)
    )
      throw new Error("DEPLOYMENT_SELECTOR_EVIDENCE_MISMATCH");
    return row.selectorEvidence;
  });
  const selection = selectC60113Regions({
    regions,
    policy,
    budgetSeconds: input.budgetSeconds,
    mandatoryOnly: input.mandatoryOnly ?? false,
    ...(scores === null ? {} : { rankingScoreByRegion: scores }),
  });
  const payload = {
    deploymentRankerHash: deployment.semanticHash,
    machineFeaturesHash: input.features.semanticHash,
    budgetSeconds: input.budgetSeconds,
    mandatoryOnly: input.mandatoryOnly ?? false,
    ...selection,
  };
  return { ...payload, semanticHash: c60113Hash(payload) };
}
