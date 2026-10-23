import {
  scoreTrack142Schema,
  type DetectorJob142,
  type Policy142,
  type Samples142,
  type ScoreTrack142,
} from "@mvl/shared";
import { hashed141, union141, subtract141 } from "./c601141-policy.js";

export function decodeScores142(bytes: Buffer): number[] {
  if (!bytes.length || bytes.length % 4)
    throw new Error("C601142_SCORE_BLOB_INVALID");
  const values = Array.from({ length: bytes.length / 4 }, (_, i) =>
    bytes.readFloatLE(4 * i),
  );
  if (values.some((v) => !Number.isFinite(v) || v < 0 || v > 1))
    throw new Error("C601142_SCORE_NOT_PROBABILITY_OR_BINARY");
  return values;
}
export function scoreIntervals142(input: {
  scores: number[];
  hop: number;
  offset: number;
  threshold: number;
  maximumOutputSample: number;
  mapping: DetectorJob142["timeMapping"];
  maximumNativeSample: number;
  minimumSeconds: number;
}) {
  if (
    !Number.isSafeInteger(input.hop) ||
    input.hop <= 0 ||
    !Number.isSafeInteger(input.offset)
  )
    throw new Error("C601142_SCORE_TIMEBASE_INVALID");
  const intervals: Samples142[] = [];
  for (let i = 0; i < input.scores.length; i++) {
    const score = input.scores[i];
    if (
      score === undefined ||
      !Number.isFinite(score) ||
      score < 0 ||
      score > 1
    )
      throw new Error("C601142_SCORE_RANGE_INVALID");
    if (score < input.threshold) continue;
    const start = Math.max(0, input.offset + i * input.hop),
      end = Math.min(
        input.maximumOutputSample,
        input.offset + (i + 1) * input.hop,
      );
    const map = (n: number) =>
      Math.min(
        input.maximumNativeSample,
        input.mapping.sourceStartSample +
          Math.round((n * input.mapping.numerator) / input.mapping.denominator),
      );
    if (end > start && map(end) > map(start))
      intervals.push({ startSample: map(start), endSample: map(end) });
  }
  const rate = input.mapping.sourceSampleRate;
  return union141(intervals).filter(
    (v) =>
      v.endSample - v.startSample >= Math.ceil(input.minimumSeconds * rate),
  );
}
export function materializeScoreTrack142(input: {
  job: DetectorJob142;
  policy: Policy142;
  scores: number[];
  scoreSha256: string;
  relativePath: string;
  kind: "PROBABILITY" | "BINARY_DECISION";
  hop: number;
  window: number;
  offset: number;
  maximumNativeSample: number;
  originalChunkScores: ScoreTrack142["originalChunkScores"];
}) {
  const { job, scores, policy } = input;
  if (scores.length !== Math.ceil(job.frameCount / input.hop))
    throw new Error("C601142_SCORE_FRAME_COUNT_MISMATCH");
  if (
    input.kind === "BINARY_DECISION" &&
    scores.some((v) => v !== 0 && v !== 1)
  )
    throw new Error("C601142_WEBRTC_BINARY_SCORE_EXPECTED");
  const common = {
    scores,
    hop: input.hop,
    offset: input.offset,
    maximumOutputSample: job.frameCount,
    mapping: job.timeMapping,
    maximumNativeSample: input.maximumNativeSample,
    minimumSeconds: 0,
  };
  const mainRaw = scoreIntervals142({
    ...common,
    threshold: job.mainThreshold,
  });
  const minimum =
    job.family === "WEBRTC" ? 0.1 : policy.detectors.subthresholdMinimumSeconds;
  const main = mainRaw.filter(
    (v) =>
      v.endSample - v.startSample >=
      Math.ceil(minimum * job.timeMapping.sourceSampleRate),
  );
  const audit =
    job.family === "WEBRTC"
      ? []
      : scoreIntervals142({ ...common, threshold: job.auditThreshold })
          .flatMap((v) => subtract141(v, mainRaw))
          .filter(
            (v) =>
              v.endSample - v.startSample >=
              Math.ceil(
                policy.detectors.subthresholdMinimumSeconds *
                  job.timeMapping.sourceSampleRate,
              ),
          );
  const sorted = [...scores].sort((a, b) => a - b),
    at = (q: number) => sorted[Math.floor(q * (sorted.length - 1))] ?? 0;
  return scoreTrack142Schema.parse(
    hashed141({
      runId: job.runId,
      family: job.family,
      viewId: job.viewId,
      pcmSha256: job.pcmSha256,
      scoreKind: input.kind,
      relativePath: input.relativePath,
      scoreSha256: input.scoreSha256,
      dtype: "FLOAT32_LITTLE_ENDIAN",
      frameCount: scores.length,
      frameHopSamples16k: input.hop,
      frameWindowSamples16k: input.window,
      frameOffsetSamples16k: input.offset,
      timeMapping: job.timeMapping,
      maximumNativeSample: input.maximumNativeSample,
      mainThreshold: job.mainThreshold,
      auditThreshold: job.auditThreshold,
      statistics: {
        minimum: at(0),
        maximum: at(1),
        mean: scores.reduce((n, v) => n + v, 0) / scores.length,
        q05: at(0.05),
        q25: at(0.25),
        q50: at(0.5),
        q75: at(0.75),
        q95: at(0.95),
        q99: at(0.99),
      },
      mainCrossingNativeIntervals: main,
      subthresholdPeakNativeIntervals: audit,
      originalChunkScores: input.originalChunkScores,
    }),
  );
}
