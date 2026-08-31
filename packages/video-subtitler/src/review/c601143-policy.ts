import {
  policy143Schema,
  type Policy143,
  type C60114SourceIdentity,
  type Samples142,
} from "@mvl/shared";
import {
  assertHash141,
  hashed141,
  union141,
  subtract141,
  hash141,
} from "./c601141-policy.js";

export function policy143(): Policy143 {
  return policy143Schema.parse(
    hashed141({
      schemaVersion: "1.0.0",
      policyVersion: "c6.0.1.14.3-cross-stage-monotonic-safety-selection-v1",
      executionPolicy: "replay-only",
      mode: "REPLAY_ONLY_SELECTION_AND_DELIVERY_REPAIR",
      maximumInferenceCount: 0,
      maximumModelLoadCount: 0,
      maximumProviderProcessStartCount: 0,
      maximumActiveSafetyTargets: 24,
      maximumSpeechCoreUnionSeconds: 60,
      maximumFullQueueEpisodeRatio: 0.95,
      minimumObligationCoverageRatio: 1,
      roundingToleranceSamples: 1,
      roundingToleranceRequiresVerifiedTransform: true,
      minimumChildCoreSeconds: 0.12,
      preferredMaximumChildCoreSeconds: 4,
      hardMaximumChildEnvelopeSeconds: 6,
      hardParentAuditEnvelopeSeconds: 12,
      maximumBundleEnvelopeSeconds: 12,
      maximumBundleGapSeconds: 0.75,
      reviewContextSeconds: 2,
      diversityBinSeconds: 60,
      maximumSearchStates: 5000000,
      objectives: [
        "OBLIGATION_ZERO_REGRESSION",
        "NEW_INDEPENDENT_SPEECH_COVERAGE",
        "FAMILY_STRATUM_NOVELTY",
        "BIN_SCENE_DIVERSITY",
        "MACHINE_PRIORITY",
        "MINIMUM_BUNDLES",
        "MINIMUM_CORE",
        "MINIMUM_INCREMENTAL_AUDIO",
        "MINIMUM_INTERNAL_SILENCE",
        "SOURCE_TIME_FINAL_TIE_BREAK",
      ],
      sourceTimeTieBreakOnly: true,
      goldBlind: true,
      rankerRetrained: false,
      newOofRun: false,
      canonicalMutationAllowed: false,
    }),
  );
}
export function header143(
  policy: Policy143,
  sourceIdentity: C60114SourceIdentity,
) {
  policy143Schema.parse(policy);
  assertHash141(policy);
  return {
    schemaVersion: "1.0.0" as const,
    policyVersion: policy.policyVersion,
    policyHash: policy.semanticHash,
    sourceIdentity,
    sourceTimebase: "SOURCE_GLOBAL_NATIVE_SAMPLES" as const,
    runtimeGoldInputCount: 0 as const,
    visibility: "LOCAL_ONLY" as const,
  };
}
export const sampleCount143 = (values: readonly Samples142[]) =>
  union141(values).reduce((n, v) => n + v.endSample - v.startSample, 0);
export const difference143 = (
  values: readonly Samples142[],
  masks: readonly Samples142[],
) => union141(values).flatMap((v) => subtract141(v, masks));
export const intersects143 = (a: Samples142, b: Samples142) =>
  a.startSample < b.endSample && b.startSample < a.endSample;
export function intersection143(
  values: readonly Samples142[],
  masks: readonly Samples142[],
) {
  return union141(
    values.flatMap((v) =>
      masks.flatMap((m) => {
        const startSample = Math.max(v.startSample, m.startSample);
        const endSample = Math.min(v.endSample, m.endSample);
        return endSample > startSample ? [{ startSample, endSample }] : [];
      }),
    ),
  );
}
export function assertSource143(
  actual: C60114SourceIdentity,
  expected: C60114SourceIdentity,
) {
  if (hash141(actual) !== hash141(expected))
    throw new Error("C601143_SOURCE_IDENTITY_MISMATCH");
}
export function assertNative143(
  values: readonly Samples142[],
  source: C60114SourceIdentity,
) {
  union141(values);
  const limit = Math.round(source.durationSeconds * source.sampleRate);
  if (values.some((v) => v.endSample > limit))
    throw new Error("C601143_SOURCE_INTERVAL_OUT_OF_BOUNDS");
}
export function assertReplayOnly143(
  executionPolicy: string,
  counts?: {
    inferenceCount: number;
    modelLoadCount: number;
    providerProcessStartCount: number;
    cacheMissCount: number;
  },
) {
  if (executionPolicy !== "replay-only")
    throw new Error("C601143_REPLAY_ONLY_EXECUTION_REQUIRED");
  if (counts && Object.values(counts).some((n) => n !== 0))
    throw new Error("C601143_MODEL_EXECUTION_OR_CACHE_MISS_FORBIDDEN");
}
/** Normalize verified resampling arithmetic, not missing speech. Coverage itself
 * always compares native samples exactly; there is no one-sample loss waiver. */
export function mappedNativeInterval143(input: {
  outputInterval: Samples142;
  sourceStartSample: number;
  numerator: number;
  denominator: number;
  verified: boolean;
  declaredNativeInterval: Samples142;
}) {
  if (
    !input.verified ||
    ![input.sourceStartSample, input.numerator, input.denominator].every(
      Number.isSafeInteger,
    ) ||
    input.sourceStartSample < 0 ||
    input.numerator <= 0 ||
    input.denominator <= 0
  )
    throw new Error("C601143_UNVERIFIED_RESAMPLING_TRANSFORM");
  union141([input.outputInterval, input.declaredNativeInterval]);
  const map = (n: number) =>
    input.sourceStartSample +
    Math.round((n * input.numerator) / input.denominator);
  const expected = {
    startSample: map(input.outputInterval.startSample),
    endSample: map(input.outputInterval.endSample),
  };
  for (const edge of ["startSample", "endSample"] as const) {
    const raw =
      input.sourceStartSample +
      (input.outputInterval[edge] * input.numerator) / input.denominator;
    const declared = input.declaredNativeInterval[edge];
    if (
      Math.abs(declared - expected[edge]) > 1 ||
      ![Math.floor(raw), Math.ceil(raw)].includes(declared)
    )
      throw new Error("C601143_ROUNDING_PROOF_DOES_NOT_COVER_REAL_SAMPLE_LOSS");
  }
  return expected;
}
