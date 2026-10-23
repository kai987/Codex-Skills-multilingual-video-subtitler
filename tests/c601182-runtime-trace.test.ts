import { describe, expect, it } from "vitest";
import {
  compareBehavior,
  reserveTraceTask,
  TRACE_BUILD,
  traceConclusion,
  validateRuntimeTrace,
} from "../packages/video-subtitler/src/machine-quality/request-bound-runtime-trace.js";
const hash = "0".repeat(64);
function required<T>(value: T | undefined): T {
  if (value === undefined) throw Error("FIXTURE_MISSING");
  return value;
}
const result = { text: "neutral", tokens: ["neutral"], timestamps: [0.04] };
const sum = {
  frames: 3,
  dim: 1,
  elements: 3,
  dtype: "float32",
  byteOrder: "little-endian",
  sha256: hash,
  finite: 3,
  nan: 0,
  inf: 0,
  thirds: [{}, {}, {}],
};
const tensor = { shape: [1, 3, 1], dtype: 1, elements: 3, sha256: hash };
const length = { shape: [1], dtype: 7, elements: 1, values: [3] };
function fixture() {
  const pairs: [string, Record<string, unknown>][] = [
    ["request-start", { native: true }],
    ["native-waveform", { sampleRate: 16000, sampleCount: 480, sha256: hash }],
    ["features", sum],
    ["encoder-input-before-cast", { tensor, length }],
    ["encoder-input-after-cast", { tensor, length }],
    ["encoder-output", { tensor, length, validSummary: sum }],
    ["decoder-input", { tensor, effectiveLength: length }],
    [
      "decoder-init",
      {
        effectiveLength: length,
        sortedIndexes: [0],
        batchSizes: [1, 1, 1],
        blankId: 0,
        unkId: 1,
        contextSize: 2,
        vocabSize: 3,
      },
    ],
    ["initial-context", { tokens: [-1, 0] }],
    ...[0, 2, 1].map((id, i): [string, Record<string, unknown>] => [
      "decoder-step",
      {
        frameIndex: i,
        batchLocalIndex: 0,
        originalIndex: 0,
        argmax: id,
        classification: ["blank", "lexical", "unk"][i],
        appended: i === 1,
        lexicalCount: i === 0 ? 0 : 1,
        contextUpdated: i === 1,
      },
    ]),
    ["decoder-context-updated", { frameIndex: 1, decoderOutput: tensor }],
    ["tokens-before-context-removal", { tokens: [-1, 0, 2], timestamps: [1] }],
    ["tokens-after-context-removal", { tokens: [2], timestamps: [1] }],
    ["native-result", result],
    ["request-end", { success: true, overflow: false }],
  ];
  return {
    schema: "c601182-v1",
    runtimeBuildId: TRACE_BUILD,
    overflow: false,
    events: pairs.map(([kind, observed], i) => ({
      experimentId: "neutral",
      arm: "T",
      requestId: "unit-neutral",
      unitId: "unit-neutral",
      streamId: "1",
      modelInstanceId: "model",
      inputHash: hash,
      runtimeBuildId: TRACE_BUILD,
      probeSchema: "c601182-v1",
      eventSequence: i,
      kind,
      source: "native:test-fixture-not-real-inference",
      observed: structuredClone(observed),
    })),
  };
}
const expected = {
  requestId: "unit-neutral",
  inputHash: hash,
  sampleCount: 480,
};
describe("bounded native trace contracts, synthetic only", () => {
  it("accounts continuous frames, mutually exclusive selections and lexical accumulation", () => {
    const r = validateRuntimeTrace(fixture(), expected, result);
    expect([r.visited, r.blank, r.unk, r.lexical]).toEqual([3, 1, 1, 1]);
  });
  it("rejects crossed request identities", () => {
    const f = fixture();
    required(f.events[4]).requestId = "other";
    expect(() => validateRuntimeTrace(f, expected, result)).toThrow(
      "REQUEST_IDENTITY_CROSSED",
    );
  });
  it.each(["streamId", "modelInstanceId", "inputHash"])(
    "rejects crossed %s",
    (key) => {
      const f = fixture();
      Object.assign(required(f.events[4]), { [key]: "other" });
      expect(() => validateRuntimeTrace(f, expected, result)).toThrow();
    },
  );
  it.each(["encoder-input-before-cast", "encoder-output"])(
    "distinguishes %s capacity from effective length",
    (kind) => {
      const f = fixture();
      required(f.events.find((e) => e.kind === kind)).observed.length = {
        ...length,
        values: [4],
      };
      expect(() => validateRuntimeTrace(f, expected, result)).toThrow();
    },
  );
  it.each([0, 3])("rejects duplicate or skipped frame %s", (index) => {
    const f = fixture();
    required(
      f.events.find(
        (e) => e.kind === "decoder-step" && e.observed.frameIndex === 1,
      ),
    ).observed.frameIndex = index;
    expect(() => validateRuntimeTrace(f, expected, result)).toThrow(
      "SKIPPED_DUPLICATE_OR_REORDERED_FRAME",
    );
  });
  it("rejects overlapping blank and unk", () => {
    const f = fixture();
    required(f.events.find((e) => e.kind === "decoder-init")).observed.unkId =
      0;
    expect(() => validateRuntimeTrace(f, expected, result)).toThrow(
      "BLANK_UNK_ALIAS",
    );
  });
  it("detects a previously emitted lexical token lost before conversion", () => {
    const f = fixture();
    required(
      f.events.find((e) => e.kind === "tokens-after-context-removal"),
    ).observed.tokens = [];
    expect(() => validateRuntimeTrace(f, expected, result)).toThrow(
      "CONTEXT_REMOVAL_LOST_LEXICAL",
    );
  });
  it("detects result conversion loss", () => {
    expect(() =>
      validateRuntimeTrace(fixture(), expected, { ...result, text: "" }),
    ).toThrow("NATIVE_PUBLIC_RESULT_MISMATCH");
  });
  it("requires actual decoder context update return, not only branch intent", () => {
    const f = fixture();
    required(
      f.events.find((e) => e.kind === "decoder-context-updated"),
    ).observed.frameIndex = 0;
    expect(() => validateRuntimeTrace(f, expected, result)).toThrow(
      "ACTUAL_CONTEXT_UPDATE_MISMATCH",
    );
  });
  it.each(["request-end", "sequence", "overflow"])(
    "does not promote incomplete trace %s",
    (kind) => {
      const f = fixture();
      if (kind === "request-end") f.events.pop();
      else if (kind === "sequence") required(f.events[3]).eventSequence = 99;
      else f.overflow = true;
      expect(() => validateRuntimeTrace(f, expected, result)).toThrow();
    },
  );
  it("does not normalize away timing/text differences", () => {
    const a = {
      status: "SUCCESS_NONEMPTY",
      result,
      rawResponseComplete: true,
      acousticForwardAttempted: true,
      rawSampleCount: 1,
      paddedSampleCount: 2,
    };
    expect(
      compareBehavior(a, {
        ...a,
        result: { ...result, timestamps: [0.04000001] },
      }).all,
    ).toBe(false);
  });
  it("cannot attribute history after observer or build divergence", () => {
    expect(traceConclusion(true, true, false, true)).toBe(
      "OBSERVER_OR_RUNTIME_VARIANCE_UNRESOLVED",
    );
    expect(traceConclusion(true, false, true, true)).toBe(
      "HISTORICAL_BEHAVIOR_NOT_REPRODUCED",
    );
    expect(traceConclusion(true, true, true, false)).toBe(
      "TRACE_INCOMPLETE_OR_BUILD_BLOCKED",
    );
  });
  it("counts failed reservations and rejects successful or unknown retries", () => {
    const task = { arm: "H", unitId: "neutral", seconds: 28.74 };
    for (const status of ["RESERVED", "SUCCESS_NONEMPTY"])
      expect(() => reserveTraceTask([{ ...task, status }], task, 1)).toThrow();
    expect(
      reserveTraceTask([{ ...task, status: "EXECUTION_FAILED" }], task, 1)
        .status,
    ).toBe("RESERVED");
  });
  it("rejects load/audio/attempt ceilings and nonfinite budgets", () => {
    const t = { arm: "T", unitId: "neutral", seconds: 28.74 };
    expect(() => reserveTraceTask([], t, 6)).toThrow();
    expect(() => reserveTraceTask([], { ...t, seconds: NaN }, 1)).toThrow();
    expect(() =>
      reserveTraceTask(
        Array.from({ length: 8 }, () => ({ ...t, status: "EXECUTION_FAILED" })),
        t,
        1,
      ),
    ).toThrow();
  });
});
