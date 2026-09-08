import { z } from "zod";

export const TRACE_BUILD = "c601182-native-probe-v1-1cb484af";
const integer = z.number().int().nonnegative();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const traceSchema = z
  .object({
    schema: z.literal("c601182-v1"),
    runtimeBuildId: z.literal(TRACE_BUILD),
    overflow: z.literal(false),
    events: z
      .array(
        z
          .object({
            experimentId: z.string(),
            arm: z.literal("T"),
            requestId: z.string(),
            unitId: z.string(),
            streamId: z.string(),
            modelInstanceId: z.string(),
            inputHash: hash,
            runtimeBuildId: z.literal(TRACE_BUILD),
            probeSchema: z.literal("c601182-v1"),
            eventSequence: integer,
            kind: z.string(),
            source: z.string(),
            observed: z.record(z.string(), z.unknown()),
          })
          .strict(),
      )
      .min(2),
  })
  .strict();
const tensor = z.object({
  shape: z.array(integer),
  dtype: integer,
  elements: integer,
  values: z.array(z.number().int()).optional(),
  sha256: hash.optional(),
});
const summary = z.object({
  frames: integer,
  dim: integer,
  elements: integer,
  dtype: z.literal("float32"),
  byteOrder: z.literal("little-endian"),
  sha256: hash,
  finite: integer,
  nan: integer,
  inf: integer,
  thirds: z.array(z.record(z.string(), z.unknown())).length(3),
});
const resultSchema = z.object({
  text: z.string(),
  tokens: z.array(z.string()),
  timestamps: z.array(z.number()),
});
function eq(a: unknown, b: unknown, reason: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw Error(reason);
}

/** No model, reference or filesystem access; reject missing data, never fill expected values. */
export function validateRuntimeTrace(
  input: unknown,
  expected: { requestId: string; inputHash: string; sampleCount: number },
  publicResult: unknown,
) {
  const trace = traceSchema.parse(input),
    events = trace.events,
    first = events[0];
  if (!first) throw Error("TRACE_EMPTY");
  for (const [i, e] of events.entries()) {
    eq(e.eventSequence, i, "TRACE_SEQUENCE_GAP");
    for (const k of [
      "experimentId",
      "arm",
      "requestId",
      "unitId",
      "streamId",
      "modelInstanceId",
      "inputHash",
    ] as const)
      eq(e[k], first[k], "REQUEST_IDENTITY_CROSSED");
  }
  eq(first.requestId, expected.requestId, "WRONG_REQUEST");
  eq(first.unitId, expected.requestId, "WRONG_UNIT");
  eq(first.inputHash, expected.inputHash, "WRONG_INPUT");
  eq(first.kind, "request-start", "MISSING_NATIVE_START");
  eq(events.at(-1)?.kind, "request-end", "TRACE_INCOMPLETE");
  function one(kind: string) {
    const rows = events.filter((e) => e.kind === kind);
    if (rows.length !== 1) throw Error("MISSING_OR_DUPLICATE_" + kind);
    const row = rows[0];
    if (!row) throw Error("TRACE_EVENT_MISSING");
    return row.observed;
  }
  eq(one("request-end").success, true, "TRACE_EXECUTION_FAILED");
  eq(one("request-end").overflow, false, "TRACE_OVERFLOW");
  const wave = z
    .object({
      sampleRate: z.literal(16000),
      sampleCount: integer,
      sha256: hash,
    })
    .parse(one("native-waveform"));
  eq(wave.sha256, expected.inputHash, "NATIVE_WAVE_HASH");
  eq(wave.sampleCount, expected.sampleCount, "NATIVE_WAVE_LENGTH");
  const feature = summary.parse(one("features"));
  eq(feature.elements, feature.frames * feature.dim, "FEATURE_CAPACITY");
  const before = z
    .object({ tensor, length: tensor })
    .parse(one("encoder-input-before-cast"));
  const after = z
    .object({ tensor, length: tensor })
    .parse(one("encoder-input-after-cast"));
  eq(
    before.tensor.shape,
    [1, feature.frames, feature.dim],
    "FEATURE_ENCODER_SHAPE",
  );
  eq(before.tensor.sha256, feature.sha256, "FEATURE_ENCODER_CONTENT");
  eq(before.length.values, [feature.frames], "FEATURE_EFFECTIVE_LENGTH");
  eq(before.length.dtype, 7, "BEFORE_CAST_DTYPE");
  eq(after.tensor, before.tensor, "CAST_CHANGED_FEATURES");
  eq(after.length.values, before.length.values, "CAST_CHANGED_LENGTH");
  if (![6, 7].includes(after.length.dtype)) throw Error("INVALID_LENGTH_DTYPE");
  const output = z
    .object({ tensor, length: tensor, validSummary: summary })
    .parse(one("encoder-output"));
  const received = z
    .object({ tensor, effectiveLength: tensor })
    .parse(one("decoder-input"));
  const valid = output.length.values?.[0];
  if (
    valid === undefined ||
    valid < 0 ||
    valid > (output.tensor.shape[1] ?? -1)
  )
    throw Error("ENCODER_EFFECTIVE_CAPACITY");
  eq(output.tensor, received.tensor, "ENCODER_DECODER_TENSOR");
  eq(received.effectiveLength.values, [valid], "ENCODER_DECODER_LENGTH");
  eq(output.validSummary.frames, valid, "ENCODER_SUMMARY_NOT_VALID_REGION");
  const init = z
    .object({
      effectiveLength: tensor,
      sortedIndexes: z.array(integer),
      batchSizes: z.array(integer),
      blankId: integer,
      unkId: integer,
      contextSize: integer,
      vocabSize: integer,
    })
    .parse(one("decoder-init"));
  eq(init.effectiveLength.values, [valid], "DECODER_RECEIVED_LENGTH");
  eq(init.sortedIndexes, [0], "BATCH_MAPPING");
  eq(init.batchSizes, Array(valid).fill(1), "PACKED_FRAME_COVERAGE");
  if (init.blankId === init.unkId) throw Error("BLANK_UNK_ALIAS");
  const steps = events
    .filter((e) => e.kind === "decoder-step")
    .map((e) =>
      z
        .object({
          frameIndex: integer,
          batchLocalIndex: z.literal(0),
          originalIndex: z.literal(0),
          argmax: integer,
          classification: z.enum(["blank", "unk", "lexical"]),
          appended: z.boolean(),
          lexicalCount: integer,
          contextUpdated: z.boolean(),
        })
        .parse(e.observed),
    );
  eq(
    steps.map((s) => s.frameIndex),
    Array.from({ length: valid }, (_, i) => i),
    "SKIPPED_DUPLICATE_OR_REORDERED_FRAME",
  );
  const lexical: number[] = [],
    emissions: number[] = [];
  let blank = 0,
    unk = 0,
    longest = 0,
    gap = 0;
  for (const s of steps) {
    if (s.argmax >= init.vocabSize) throw Error("TOKEN_OUT_OF_VOCAB");
    const kind =
      s.argmax === init.blankId
        ? "blank"
        : s.argmax === init.unkId
          ? "unk"
          : "lexical";
    eq(s.classification, kind, "CLASSIFICATION_NOT_EXCLUSIVE");
    eq(s.appended, kind === "lexical", "APPEND_MISMATCH");
    eq(s.contextUpdated, s.appended, "CONTEXT_UPDATE_MISMATCH");
    if (kind === "lexical") {
      lexical.push(s.argmax);
      emissions.push(s.frameIndex);
      gap = 0;
    } else {
      if (kind === "blank") blank++;
      else unk++;
      gap++;
      longest = Math.max(longest, gap);
    }
    eq(s.lexicalCount, lexical.length, "TOKEN_ACCUMULATION_MISMATCH");
  }
  const contextUpdates = events
    .filter((e) => e.kind === "decoder-context-updated")
    .map((e) =>
      z
        .object({ frameIndex: integer, decoderOutput: tensor })
        .parse(e.observed),
    );
  eq(
    contextUpdates.map((e) => e.frameIndex),
    emissions,
    "ACTUAL_CONTEXT_UPDATE_MISMATCH",
  );
  const initial = z
    .object({ tokens: z.array(z.number().int()) })
    .parse(one("initial-context"));
  eq(initial.tokens.length, init.contextSize, "INITIAL_CONTEXT_LENGTH");
  const pre = z
    .object({ tokens: z.array(z.number().int()), timestamps: z.array(integer) })
    .parse(one("tokens-before-context-removal"));
  const post = z
    .object({ tokens: z.array(integer), timestamps: z.array(integer) })
    .parse(one("tokens-after-context-removal"));
  eq(pre.tokens, [...initial.tokens, ...lexical], "APPENDED_TOKENS_LOST");
  eq(post.tokens, lexical, "CONTEXT_REMOVAL_LOST_LEXICAL");
  eq(post.timestamps, emissions, "APPEND_TIME_LOST");
  eq(pre.timestamps, post.timestamps, "CONTEXT_REMOVAL_TIME_LOSS");
  const native = resultSchema.parse(one("native-result")),
    result = resultSchema.parse(publicResult);
  eq(native, result, "NATIVE_PUBLIC_RESULT_MISMATCH");
  eq(native.tokens.length, lexical.length, "SYMBOL_CONVERSION_LOSS");
  eq(native.timestamps.length, lexical.length, "TIMESTAMP_CONVERSION_LOSS");
  const thirds = [0, 1, 2].map((i) => {
    const ss = steps.slice(
      Math.floor((valid * i) / 3),
      Math.floor((valid * (i + 1)) / 3),
    );
    return {
      startFrame: Math.floor((valid * i) / 3),
      endFrameExclusive: Math.floor((valid * (i + 1)) / 3),
      visited: ss.length,
      blank: ss.filter((s) => s.classification === "blank").length,
      unk: ss.filter((s) => s.classification === "unk").length,
      lexical: ss.filter((s) => s.appended).length,
    };
  });
  return {
    requestId: first.requestId,
    observedFeatureLength: feature.frames,
    observedEncoderLength: valid,
    visited: steps.length,
    blank,
    unk,
    lexical: lexical.length,
    longestNoLexicalFrames: longest,
    thirds,
    feature,
    encoder: output.validSummary,
    continuousFrameCoverage: true,
    tokenAccumulationPreserved: true,
    finiteValues:
      feature.nan +
        feature.inf +
        output.validSummary.nan +
        output.validSummary.inf ===
      0,
  };
}

export function compareBehavior(a: unknown, b: unknown) {
  const schema = z.object({
    status: z.string(),
    result: resultSchema,
    rawResponseComplete: z.boolean(),
    acousticForwardAttempted: z.boolean(),
    rawSampleCount: integer,
    paddedSampleCount: integer,
  });
  const x = schema.parse(a),
    y = schema.parse(b);
  return {
    text: x.result.text === y.result.text,
    tokens: JSON.stringify(x.result.tokens) === JSON.stringify(y.result.tokens),
    timestamps:
      JSON.stringify(x.result.timestamps) ===
      JSON.stringify(y.result.timestamps),
    status: x.status === y.status,
    all: JSON.stringify(x) === JSON.stringify(y),
  };
}
export function reserveTraceTask(
  prior: { arm: string; unitId: string; seconds: number; status: string }[],
  task: { arm: string; unitId: string; seconds: number },
  startCount: number,
) {
  z.object({
    arm: z.enum(["H", "B", "T"]),
    unitId: z.string().min(1),
    seconds: z.number().positive(),
  }).parse(task);
  integer.parse(startCount);
  if (
    prior.length >= 8 ||
    startCount > 5 ||
    task.seconds > 32 ||
    task.seconds <= 0 ||
    prior.reduce((n, r) => n + r.seconds, 0) + task.seconds > 240
  )
    throw Error("TRACE_BUDGET_EXCEEDED");
  const same = prior.filter(
    (r) => r.arm === task.arm && r.unitId === task.unitId,
  );
  const retries =
    prior.length - new Set(prior.map((r) => r.arm + ":" + r.unitId)).size;
  if (
    same.length &&
    (same.at(-1)?.status !== "EXECUTION_FAILED" || retries >= 2)
  )
    throw Error("SUCCESS_OR_UNRECONCILED_NOT_RETRYABLE");
  if (
    !same.length &&
    new Set(prior.map((r) => r.arm + ":" + r.unitId)).size >= 6
  )
    throw Error("FORMAL_TASK_LIMIT");
  return { ...task, status: "RESERVED" };
}
export function traceConclusion(
  historical: boolean,
  build: boolean,
  observer: boolean,
  traceComplete: boolean,
) {
  if (!observer) return "OBSERVER_OR_RUNTIME_VARIANCE_UNRESOLVED";
  if (!historical || !build) return "HISTORICAL_BEHAVIOR_NOT_REPRODUCED";
  if (!traceComplete) return "TRACE_INCOMPLETE_OR_BUILD_BLOCKED";
  return "FULL_TRAVERSAL_LOW_EMISSION_OBSERVED";
}
