import {
  c6015PolicyVersion,
  c6015QualityPolicySchema,
  type C6015Mode,
  type C6015QualityPolicy,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";
import { C6015_RAW_ASR_EPISODE_REQUEST_BUDGET } from "./raw-asr-event-recovery.js";

export function createC6015QualityPolicy(input: {
  evidenceToCanonical: C6015Mode;
  singleVariantAudit: C6015Mode;
  rawAsrEventRecovery: C6015Mode;
  artifactSemanticHashes: readonly string[];
  generatedAt?: string;
}): C6015QualityPolicy {
  const core = {
    evidenceToCanonical: input.evidenceToCanonical,
    singleVariantAudit: input.singleVariantAudit,
    rawAsrEventRecovery: input.rawAsrEventRecovery,
    runtimeGoldInputCount: 0 as const,
    productionStatus: "needs-review" as const,
    finalizationMethod: "none" as const,
    machineOnlyReleaseAuthorized: false as const,
    gates: {
      minimumCoverage: 0.9 as const,
      maximumMissing: 15 as const,
      maximumHallucinations: 2 as const,
      maximumMaterialErrors: 45 as const,
      maximumRawAsrOriginErrors: 30 as const,
      maximumAssociationErrors: 10 as const,
      maximumNormalizedCer: 0.55 as const,
      maximumSevereTimingErrors: 30 as const,
      maximumStartMaeSeconds: 1.2 as const,
      maximumEndMaeSeconds: 1.2 as const,
      maximumP95BoundaryErrorSeconds: 3.5 as const,
      maximumOverlapPairs: 20 as const,
      minimumEventFinalLineageCoverage: 0.95 as const,
      maximumUnsupportedMutationCount: 0 as const,
      maximumRuntimeGoldInputCount: 0 as const,
      maximumDatasetHardcodingCount: 0 as const,
      maximumUnsafeFinalizationEscapeCount: 0 as const,
    },
    mutationPolicy: {
      textReplacementMinimumEvidenceTier: "STRONG" as const,
      minimumTokenCoverage: 0.8 as const,
      structuralMutationMode: "observe-only" as const,
      candidateTextPromptAllowed: false as const,
      goldRuntimeInputAllowed: false as const,
      maximumRequestsPerEvent: 3 as const,
      episodeRequestBudget: C6015_RAW_ASR_EPISODE_REQUEST_BUDGET,
    },
    artifactSemanticHashes: [...input.artifactSemanticHashes],
  };
  return c6015QualityPolicySchema.parse({
    schemaVersion: "1.0.0",
    policyVersion: c6015PolicyVersion,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    artifactType: "c6-0-1-5-quality-policy",
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
}
