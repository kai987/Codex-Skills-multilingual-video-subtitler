import {
  c6018PolicyVersion,
  machineCoreFreshVerificationSchema,
  type MachineCoreFreshVerification,
  type MachineFreshTargetedReAsr,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";

export function buildReusedFreshCoreVerification(input: {
  c6017Fresh: MachineFreshTargetedReAsr;
  unresolvedEventIds: readonly string[];
  existingFreshSufficient: boolean;
  generatedAt?: string;
}): MachineCoreFreshVerification {
  if (
    input.c6017Fresh.generationKind !== "FRESH_INFERENCE" ||
    input.c6017Fresh.summary.freshInferenceCount !== 36 ||
    input.c6017Fresh.summary.cacheHitCount !== 0
  ) {
    throw new Error(
      "C6.0.1.8 requires the genuine C6.0.1.7 Fresh artifact, not a replay artifact.",
    );
  }
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const runtime = input.c6017Fresh.inferenceRuntime;
  const core = {
    schemaVersion: "1.0.0" as const,
    policyVersion: c6018PolicyVersion,
    generatedAt,
    artifactType: "machine-core-fresh-verification" as const,
    mode: "off" as const,
    decision: input.existingFreshSufficient
      ? ("NOT_REQUIRED_EXISTING_FRESH_SUFFICIENT" as const)
      : ("BLOCKED_RUNTIME_UNAVAILABLE" as const),
    justification: input.existingFreshSufficient
      ? [
          "all-selected-events-have-three-genuine-prompt-free-c6017-fresh-windows",
          "existing-global-token-evidence-is-sufficient-for-core-stability-diagnosis",
          "additional-inference-would-not-add-a-new-model-family",
        ]
      : [
          "existing-fresh-evidence-could-not-localize-all-unresolved-events",
          "no-additional-inference-was-run-before-route-decision",
        ],
    reusedC6017FreshSemanticHash: input.c6017Fresh.semanticHash,
    reusedFreshRequestCount: 36 as const,
    maximumRequestsPerUnresolvedEvent: 2 as const,
    episodeRequestBudget: 24 as const,
    unresolvedEventIds: [...new Set(input.unresolvedEventIds)].toSorted(),
    executedEventIds: [],
    requests: [],
    inferenceRuntime: {
      runtimeType: runtime.runtimeType,
      runtimeBinarySha256: runtime.runtimeBinarySha256,
      runtimePatchSha256: runtime.runtimePatchSha256,
      modelSha256: runtime.modelSha256,
      device: runtime.device,
    },
    summary: {
      requestedEventCount: 0,
      requestCount: 0,
      freshInferenceCount: 0,
      cacheHitCount: 0 as const,
      modelLoadCount: 0,
      processStartCount: 0,
      promptLeakCount: 0 as const,
      runtimeGoldInputCount: 0 as const,
      networkUsed: false as const,
    },
  };
  return machineCoreFreshVerificationSchema.parse({
    ...core,
    semanticHash: machineQualitySemanticHash({
      ...core,
      generatedAt: undefined,
    }),
  });
}
