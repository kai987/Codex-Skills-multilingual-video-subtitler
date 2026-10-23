import { c60114CompletionPolicySchema } from "@mvl/shared";
import { withC60114SemanticHash } from "./c60114-policy.js";

export function buildC60114CompletionPolicy() {
  return c60114CompletionPolicySchema.parse(
    withC60114SemanticHash({
      schemaVersion: "1.0.0",
      artifactType: "c6-0-1-14-completion-policy",
      policyVersion: "c6.0.1.14-completion-v1",
      maximumNewInferenceCount: 0,
      maximumNewProviderProcessCount: 0,
      maximumModelLoadCount: 0,
      runtimeGoldInputCount: 0,
      cacheMode: "FROZEN_REQUEST_SET_READ_ONLY_NO_FALLBACK",
      guardContactMaximumSeconds: 0.05,
      boundaryRoundingToleranceSeconds: 0.001,
      shadowTimeBinCount: 8,
      shadowExecutionAllowed: false,
      lexicalCompletenessIsAdvisoryWhenAudible: true,
      mandatorySubsetRecallIsReleaseGate: false,
      rankerRecalibrationAllowed: false,
      canonicalMutationAllowed: false,
    }),
  );
}
