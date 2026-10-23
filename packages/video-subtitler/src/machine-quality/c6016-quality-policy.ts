import {
  c6016PolicyVersion,
  c6016QualityPolicySchema,
  type C6016QualityPolicy,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";

export function buildC6016QualityPolicy(input: {
  policyFrozenAt: string;
  generatedAt?: string;
}): C6016QualityPolicy {
  const thresholds = {
    requestEdgeDistanceSeconds: 0.35 as const,
    ctcStrongMaximum: 0.35 as const,
    ctcWeakMaximum: 0.55 as const,
    tokenWeakMaximum: 0.4 as const,
    speechIncompleteStrongMaximum: 0.7 as const,
    decoderWeakAverageLogProbability: -1.2 as const,
    decoderStrongAverageLogProbability: -1.5 as const,
    decoderWeakNoSpeechProbability: 0.6 as const,
    decoderStrongNoSpeechProbability: 0.8 as const,
    boundaryCoverageMinimum: 0.8 as const,
    boundaryPaddingSeconds: 0.08 as const,
  };
  const policyHash = machineQualitySemanticHash({
    policyVersion: c6016PolicyVersion,
    thresholds,
    riskTriggerPolicy: "one-strong-or-two-independent-weak",
    requestEdgeSemantics: "source-global-seconds-request-relative",
    spanIndexing: "unicode-code-point-half-open",
    overlapPolicy: "preserve-evidence-supported-real-overlap",
    episodeReAsrRequestBudget: 36,
    maximumRequestsPerEvent: 3,
  });
  const core = {
    policyFrozenAt: input.policyFrozenAt,
    goldAccessBeforeFreezeCount: 0 as const,
    thresholds,
    riskTriggerPolicy: "one-strong-or-two-independent-weak" as const,
    goldRuntimeInputAllowed: false as const,
    candidateTextPromptAllowed: false as const,
    episodeReAsrRequestBudget: 36 as const,
    maximumRequestsPerEvent: 3 as const,
    productionStatus: "needs-review" as const,
    finalizationMethod: "none" as const,
    machineReleaseAuthorized: false as const,
    policyHash,
  };
  return c6016QualityPolicySchema.parse({
    schemaVersion: "1.0.0",
    policyVersion: c6016PolicyVersion,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    artifactType: "c6-0-1-6-quality-policy",
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
}
