import {
  c601141PolicySchema,
  type C601141Policy,
  type C601141Samples,
  type C60114SourceIdentity,
} from "@mvl/shared";
import { machineQualitySemanticHash } from "../machine-quality/evidence-correlation.js";

export const hash141 = machineQualitySemanticHash;
export function required141<T>(
  value: T | null | undefined,
  reason = "C601141_REQUIRED_VALUE_MISSING",
): T {
  if (value === undefined || value === null) throw new Error(reason);
  return value;
}
export function hashed141<T extends object>(
  value: T,
): T & { semanticHash: string } {
  const { semanticHash: _previous, ...core } = value as T & {
    semanticHash?: string;
  };
  void _previous;
  return { ...core, semanticHash: hash141(core) } as T & {
    semanticHash: string;
  };
}
export function assertHash141(value: { semanticHash: string }): void {
  if (hashed141(value).semanticHash !== value.semanticHash)
    throw new Error("C601141_SEMANTIC_HASH_MISMATCH");
}
export const unique141 = (values: readonly string[]) =>
  [...new Set(values)].sort();
export const id141 = (kind: string, value: unknown) =>
  `${kind}-${hash141(value).slice(0, 24)}`;
export function policy141(): C601141Policy {
  return c601141PolicySchema.parse(
    hashed141({
      schemaVersion: "1.0.0",
      policyVersion: "c6.0.1.14.1-multiview-speech-inventory-v1",
      profiles: [
        {
          profileId: "sensitive-v2",
          threshold: 0.35,
          minSpeechMs: 160,
          minSilenceMs: 100,
          maxSpeechSeconds: 12,
          speechPadMs: 0,
          samplesOverlap: 0,
        },
        {
          profileId: "extra-sensitive-v1",
          threshold: 0.2,
          minSpeechMs: 96,
          minSilenceMs: 80,
          maxSpeechSeconds: 12,
          speechPadMs: 0,
          samplesOverlap: 0,
        },
      ],
      maxViews: 5,
      maxDetectorRuns: 12,
      maxSileroRuns: 10,
      maxPyannoteRuns: 2,
      maxAsrRequests: 32,
      maxAsrTargets: 12,
      maxContextTargets: 4,
      maxSafetyTargets: 24,
      maxSafetyUnionSeconds: 60,
      maxTargetSeconds: 12,
      maxFingerprintClips: 256,
      maxFingerprintSeconds: 900,
      fingerprint: {
        minimumClipSeconds: 0.3,
        minimumRms: 0.002,
        minimumNormalizedCorrelation: 0.995,
        minimumScoreMargin: 0.035,
        maximumNormalizedResidual: 0.11,
        secondPeakExclusionSeconds: 0.1,
        maximumSpectralPeakRatio: 0.35,
        maximumLagOneCorrelation: 0.9995,
      },
      fusion: {
        minimumIslandSeconds: 0.12,
        splitMaximumSeconds: 12,
        sameFamilyMergeGapSeconds: 0,
        minimumIndependentOverlapSeconds: 0.08,
        timeDiversityBinSeconds: 60,
      },
      asr: {
        exactGuardSeconds: 0,
        contextSeconds: 0.75,
        prompt: "",
        vadEnabled: false,
        retryCount: 0,
        providers: ["whisper-large-v3", "reazonspeech-k2-v2"],
      },
      fullMediaAsrAllowed: false,
      modelDownloadAllowed: false,
      automaticCanonicalMutationAllowed: false,
    }),
  );
}
export function header141(
  policy: C601141Policy,
  sourceIdentity: C60114SourceIdentity,
) {
  c601141PolicySchema.parse(policy);
  assertHash141(policy);
  return {
    schemaVersion: "1.0.0" as const,
    policyVersion: policy.policyVersion,
    policyHash: policy.semanticHash,
    sourceIdentity,
    sourceTimebase: "SOURCE_GLOBAL_NATIVE_SAMPLES" as const,
    runtimeGoldInputCount: 0 as const,
  };
}
export function union141(values: readonly C601141Samples[]): C601141Samples[] {
  const result: C601141Samples[] = [];
  for (const value of [...values].sort(
    (a, b) => a.startSample - b.startSample || a.endSample - b.endSample,
  )) {
    if (
      !Number.isSafeInteger(value.startSample) ||
      !Number.isSafeInteger(value.endSample) ||
      value.startSample < 0 ||
      value.endSample <= value.startSample
    )
      throw new Error("C601141_INVALID_NATIVE_INTERVAL");
    const previous = result.at(-1);
    if (previous && value.startSample <= previous.endSample)
      previous.endSample = Math.max(previous.endSample, value.endSample);
    else result.push({ ...value });
  }
  return result;
}
export function subtract141(
  value: C601141Samples,
  excluded: readonly C601141Samples[],
): C601141Samples[] {
  const result: C601141Samples[] = [];
  let cursor = value.startSample;
  for (const mask of union141(excluded)) {
    if (mask.endSample <= cursor || mask.startSample >= value.endSample)
      continue;
    if (mask.startSample > cursor)
      result.push({
        startSample: cursor,
        endSample: Math.min(mask.startSample, value.endSample),
      });
    cursor = Math.max(cursor, mask.endSample);
    if (cursor >= value.endSample) break;
  }
  if (cursor < value.endSample)
    result.push({ startSample: cursor, endSample: value.endSample });
  return result;
}
export function native141(
  interval: { start: number; end: number },
  sampleRate: number,
): C601141Samples {
  return {
    startSample: Math.max(0, Math.round(interval.start * sampleRate)),
    endSample: Math.round(interval.end * sampleRate),
  };
}
export const seconds141 = (value: C601141Samples, sampleRate: number) => ({
  start: value.startSample / sampleRate,
  end: value.endSample / sampleRate,
});
export const duration141 = (
  values: readonly C601141Samples[],
  sampleRate: number,
) =>
  union141(values).reduce((s, v) => s + v.endSample - v.startSample, 0) /
  sampleRate;
export function assertBudget141(
  kind: "SPEECH" | "ASR",
  planned: number,
  alreadyConsumed = 0,
): void {
  if (
    !Number.isSafeInteger(planned) ||
    planned < 0 ||
    !Number.isSafeInteger(alreadyConsumed) ||
    alreadyConsumed < 0 ||
    planned + alreadyConsumed > (kind === "SPEECH" ? 12 : 32)
  )
    throw new Error(`C601141_${kind}_BUDGET_EXCEEDED`);
}
export function authorize141(
  kind: "SPEECH" | "ASR",
  explicit: boolean,
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    explicit ||
    environment[
      kind === "SPEECH"
        ? "MVL_C601141_SPEECH_SWEEP_AUTHORIZED"
        : "MVL_C601141_LOCAL_ASR_AUTHORIZED"
    ] === "1"
  );
}
