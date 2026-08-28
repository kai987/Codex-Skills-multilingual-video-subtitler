import {
  c6017PolicyVersion,
  c6017QualityPolicySchema,
  type C6017QualityPolicy,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";

export function buildC6017QualityPolicy(input: {
  policyFrozenAt: string;
  generatedAt?: string;
}): C6017QualityPolicy {
  const policyCore = {
    riskTriggerPolicy:
      "one-strong-positive-or-two-supporting-provider-families-or-independent-window-or-incomplete-speech" as const,
    freshWindowPolicy: "near-exact-small-context-expanded-context" as const,
    eventBudget: 12 as const,
    requestBudget: 36 as const,
    maximumRequestsPerEvent: 3 as const,
    freshCacheNamespace: "c6-0-1-7-fresh-targeted-reasr-v1" as const,
    promptAllowed: false as const,
    runtimeGoldInputAllowed: false as const,
    timingPolicy: "frozen-c6-0-1-5-safe-six-no-new-rules" as const,
    c602Thresholds: {
      coverageMinimum: 0.9 as const,
      missingMaximum: 15 as const,
      hallucinationMaximum: 2 as const,
      materialErrorMaximum: 45 as const,
      normalizedCerMaximum: 0.55 as const,
      severeTimingMaximum: 30 as const,
      startMaeMaximumSeconds: 1.2 as const,
      endMaeMaximumSeconds: 1.2 as const,
      p95MaximumSeconds: 3.5 as const,
      overlapMaximum: 20 as const,
    },
    productionStatus: "needs-review" as const,
    finalizationMethod: "none" as const,
    machineReleaseAuthorized: false as const,
  };
  const policyHash = machineQualitySemanticHash(policyCore);
  const core = {
    policyFrozenAt: input.policyFrozenAt,
    goldAccessBeforeFreezeCount: 0 as const,
    ...policyCore,
    policyHash,
  };
  return c6017QualityPolicySchema.parse({
    schemaVersion: "1.0.0",
    policyVersion: c6017PolicyVersion,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    artifactType: "c6-0-1-7-quality-policy",
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
}
