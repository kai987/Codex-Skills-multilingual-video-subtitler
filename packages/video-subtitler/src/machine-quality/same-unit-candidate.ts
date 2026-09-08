/** Same-unit experiment contract. No reference or evaluation imports. */
import { z } from "zod";
export const SAME_UNIT_POLICY = Object.freeze({
  rawMaximumSeconds: 30,
  maximumPaddedSeconds: 32,
  paddingPerSide: 0.9,
  maximumAttempts: 14,
  maximumRetries: 2,
  maximumDecodedSeconds: 480,
  language: "ja",
  device: "cpu",
  threads: 1,
  precision: "fp32",
  decoding: "greedy_search",
  prompt: "NOT_SUPPORTED/NOT_SENT",
  hotwords: "NOT_SUPPORTED/NOT_SENT",
  textSource: "complete-result.text-no-trim-no-token-filter",
  automaticCrossModelSelection: "NOT_IMPLEMENTED",
  finalSubtitleApplication: "NOT_IMPLEMENTED",
} as const);
export const sameUnitRequestSchema = z
  .object({
    type: z.literal("transcribe"),
    requestId: z.string().regex(/^unit-[a-z0-9-]+$/u),
    audioPath: z.string(),
    maximumPaddedSeconds: z.literal(32),
  })
  .strict();
export function checkSameUnitDurations(seconds: readonly number[]) {
  if (
    !seconds.length ||
    seconds.length > 12 ||
    seconds.some((s) => !Number.isFinite(s) || s <= 0 || s > 30 || s + 1.8 > 32)
  )
    throw new Error("PROVIDER_DURATION_UNSUPPORTED");
  const padded = seconds.map((s) => s + 1.8);
  if (padded.reduce((a, b) => a + b, 0) > 480)
    throw new Error("BUDGET_EXCEEDED");
  return {
    rawSeconds: seconds.reduce((a, b) => a + b, 0),
    paddedSeconds: padded.reduce((a, b) => a + b, 0),
    maximumPaddedSeconds: Math.max(...padded),
  };
}
export function reserveSameUnitAttempt(
  prior: readonly { seconds: number; retry: boolean }[],
  seconds: number,
  retry: boolean,
  executionFailed: boolean,
) {
  checkSameUnitDurations([seconds]);
  if (
    prior.length >= 14 ||
    prior.reduce((a, b) => a + b.seconds + 1.8, 0) + seconds + 1.8 > 480 ||
    (retry && (!executionFailed || prior.filter((x) => x.retry).length >= 2))
  )
    throw new Error("BUDGET_OR_RETRY_REJECTED");
  return { seconds, retry };
}
const responseSchema = z
  .object({
    status: z.enum([
      "SUCCESS_NONEMPTY",
      "SUCCESS_EMPTY",
      "EXECUTION_FAILED",
      "RESPONSE_INCOMPLETE",
      "PROVIDER_UNAVAILABLE",
    ]),
    rawResponseComplete: z.boolean(),
    result: z
      .object({
        text: z.string(),
        tokens: z.array(z.string()).optional(),
        timestamps: z.array(z.number()).optional(),
      })
      .nullable(),
  })
  .loose();
export function completeCandidate(value: unknown) {
  const r = responseSchema.parse(value);
  const success =
    r.status === "SUCCESS_NONEMPTY" || r.status === "SUCCESS_EMPTY";
  if (
    success &&
    (!r.rawResponseComplete ||
      !r.result ||
      (r.status === "SUCCESS_EMPTY") !== (r.result.text.length === 0))
  )
    throw new Error("RESPONSE_INCOMPLETE");
  return {
    status: r.status,
    text: success ? (r.result?.text ?? null) : null,
    rawResponseComplete: r.rawResponseComplete,
    tokenCount: r.result?.tokens?.length ?? null,
    timestampCount: r.result?.timestamps?.length ?? null,
    timingStatus:
      !r.result?.tokens || !r.result.timestamps
        ? "RAW_CARDINALITY_UNVERIFIABLE"
        : r.result.tokens.length !== r.result.timestamps.length
          ? "RAW_CARDINALITY_MISMATCH"
          : "POINT_ONLY_NOT_WORD_INTERVALS",
    capability: "UNTIMED_OR_POINT_TIMED_TRANSCRIPT_CANDIDATE",
    finalSubtitleApplication: "NOT_IMPLEMENTED",
  };
}
