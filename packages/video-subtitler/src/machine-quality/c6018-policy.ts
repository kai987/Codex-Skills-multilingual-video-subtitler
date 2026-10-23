import {
  c6018PolicyVersion,
  c6018QualityPolicySchema,
  type C6018QualityPolicy,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";

export function buildC6018QualityPolicy(
  generatedAt = new Date().toISOString(),
): C6018QualityPolicy {
  const core = {
    schemaVersion: "1.0.0" as const,
    policyVersion: c6018PolicyVersion,
    generatedAt,
    artifactType: "c6-0-1-8-quality-policy" as const,
    defaultModes: {
      coreSpanProjection: "observe" as const,
      coreAsrStability: "observe" as const,
      coreFreshVerification: "off" as const,
    },
    goldIsolation: {
      machineArtifactGoldInputAllowed: false as const,
      postFreezeEvaluationOnly: true as const,
      goldMayDefineCoreSpan: false as const,
    },
    frozenRules: {
      timingRulesChanged: false as const,
      overlapTrimmingChanged: false as const,
      missingDialogueRecoveryChanged: false as const,
      associationRulesChanged: false as const,
      canonicalAssemblyChanged: false as const,
      riskRulesChanged: false as const,
      secondAsrUsed: false as const,
      ensembleUsed: false as const,
    },
    productionStatus: "needs-review" as const,
    finalizationMethod: "none" as const,
    machineReleaseAuthorized: false as const,
  };
  return c6018QualityPolicySchema.parse({
    ...core,
    semanticHash: machineQualitySemanticHash({
      ...core,
      generatedAt: undefined,
    }),
  });
}
