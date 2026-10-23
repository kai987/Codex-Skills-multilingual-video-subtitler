import {
  c60110PolicyVersion,
  c60110QualityPolicySchema,
  type C60110PolicyFreeze,
  type C60110QualityPolicy,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";

export function buildC60110QualityPolicy(input: {
  generatedAt: string;
  policyFreeze: C60110PolicyFreeze;
}): C60110QualityPolicy {
  const enabled = input.policyFreeze.enforcementEnabled;
  const core = {
    schemaVersion: "1.0.0" as const,
    policyVersion: c60110PolicyVersion,
    generatedAt: input.generatedAt,
    artifactType: "c6-0-1-10-quality-policy" as const,
    arbitrationMode: enabled
      ? ("enforce" as const)
      : ("observe-disabled" as const),
    selectedProductionProfile: input.policyFreeze.selectedProductionProfile,
    defaultDecision: "KEEP_CURRENT_WHISPER" as const,
    textMutationMode: enabled
      ? ("safe-text-only" as const)
      : ("disabled" as const),
    timingMutationAllowed: false as const,
    aggressiveProfileProductionAllowed: false as const,
    rawCrossModelConfidenceComparisonAllowed: false as const,
    ctcWinnerSelectionAllowed: false as const,
    ctcIndependentVoteAllowed: false as const,
    goldRuntimeSelectionAllowed: false as const,
    thirdAsrAllowed: false as const,
    llmWinnerAllowed: false as const,
    productionStatus: "needs-review" as const,
    finalizationMethod: "none" as const,
    machineOnlyReleaseAuthorized: false as const,
  };
  return c60110QualityPolicySchema.parse({
    ...core,
    semanticHash: machineQualitySemanticHash({
      ...core,
      generatedAt: undefined,
    }),
  });
}
