import test from "node:test";
import assert from "node:assert/strict";
import {
  planContextContrast,
  inspectContextAlignment,
} from "../scripts/lib/context-ctc-contrast.mjs";
import {
  runContextCtc,
  preserveRunnerLogs,
} from "../scripts/subtitle-tool-context-ctc.mjs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const parent = {
  referenceUsed: false,
  labelsUsed: false,
  probes: [
    {
      id: "p",
      start: 10,
      end: 14,
      targetStart: 11,
      targetEnd: 12,
      frames: 64000,
      wavHash: "a".repeat(64),
    },
  ],
};
const views = ["whisper", "kotoba"].map((backend) => ({
  targetId: "p",
  backend,
  records: [
    { start: 10, end: 11, text: "前。" },
    { start: 11, end: 14, text: "あ あ" },
  ],
}));
const clone = (v) => globalThis.structuredClone(v);
test("uses full original window and every source segment, no target-only text", () => {
  const before = clone({ parent, views });
  const q = planContextContrast(parent, views, ["p"]);
  assert.equal(q.length, 2);
  assert.equal(q[0].frames, 64000);
  assert.equal(q[0].targetText, "前ああ");
  assert.deepEqual(q[0].records, views[0].records);
  assert.deepEqual({ parent, views }, before);
});
test("rejects reference or label inputs", () => {
  for (const key of ["referenceUsed", "labelsUsed"])
    assert.throws(() =>
      planContextContrast({ ...parent, [key]: true }, views, ["p"]),
    );
});
test("rejects duplicate, unknown and excessive targets", () => {
  for (const ids of [["p", "p"], ["missing"], ["p", "q", "r"], []])
    assert.throws(() => planContextContrast(parent, views, ids));
});
test("rejects overbudget, wrong frames and invalid view times", () => {
  for (const patch of [
    { end: 20, frames: 160000 },
    { frames: 10 },
    { targetEnd: 20 },
  ]) {
    const p = clone(parent);
    Object.assign(p.probes[0], patch);
    assert.throws(() => planContextContrast(p, views, ["p"]));
  }
  const v = clone(views);
  v[0].records[0].start = 9;
  assert.throws(() => planContextContrast(parent, v, ["p"]));
});
test("missing or duplicate model view cannot silently become a comparison", () => {
  assert.throws(() => planContextContrast(parent, [views[0]], ["p"]));
  assert.throws(() => planContextContrast(parent, [...views, views[0]], ["p"]));
});
function result(q) {
  return {
    type: "result",
    requestId: q.id,
    pathStatus: "success",
    frameCountVerified: true,
    target: { targetText: q.targetText },
    blockers: [],
    greedyText: "前ああ",
    meanTokenPosterior: 0.9,
    minimumTokenPosterior: 0.8,
    tokenSpans: Array.from(q.targetText).map((token, i) => ({
      token,
      targetIndex: i,
      startMediaGlobal: 10 + i,
      endMediaGlobal: 10 + i + 0.5,
      startSecondsLocal: i,
      endSecondsLocal: i + 0.5,
      meanPosterior: 0.9,
    })),
  };
}
test("maps actual token spans to original segments, never character-time ratios", () => {
  const q = planContextContrast(parent, views, ["p"])[0];
  const r = inspectContextAlignment(q, result(q));
  assert.deepEqual(r.segments[1].conditionalCtcInterval, {
    start: 11,
    end: 12.5,
  });
  assert.equal(r.canMutate, false);
  assert.equal(r.posteriorIsCorrectnessProbability, false);
  assert.deepEqual(
    r.targetOverlappingTokens.map((s) => s.token),
    ["あ"],
  );
});
test("rejects foreign text/request and double-offset/global-time overflow", () => {
  const q = planContextContrast(parent, views, ["p"])[0];
  for (const patch of [
    { requestId: "other" },
    { target: { targetText: "別" } },
  ])
    assert.throws(() => inspectContextAlignment(q, { ...result(q), ...patch }));
  const r = result(q);
  r.tokenSpans[0].startMediaGlobal = 20;
  assert.throws(() => inspectContextAlignment(q, r));
});
test("unrepresentable or merged token output never supplies segment boundaries", () => {
  const q = planContextContrast(parent, views, ["p"])[0];
  const r = result(q);
  r.pathStatus = "target-unrepresentable";
  r.tokenSpans = [];
  r.frameCountVerified = false;
  assert.deepEqual(inspectContextAlignment(q, r).segments, []);
  const merged = result(q);
  merged.tokenSpans[0].token = "前あ";
  assert.deepEqual(inspectContextAlignment(q, merged).segments, []);
});
test("provider errors remain evidence, not fake success or retried requests", () => {
  const q = planContextContrast(parent, views, ["p"])[0];
  assert.equal(
    inspectContextAlignment(q, {
      type: "error",
      requestId: q.id,
      code: "FAILED",
    }).status,
    "worker-error",
  );
});
test("authorization checked before reading files or executing models", async () => {
  let calls = 0;
  await assert.rejects(
    runContextCtc("/missing", false, {
      run: () => {
        calls++;
      },
    }),
    /AUTHORIZE_LOCAL_REQUIRED/u,
  );
  assert.equal(calls, 0);
});

test("multi-character tokens map by text boundaries, not assumed character count", () => {
  const q = planContextContrast(parent, views, ["p"])[0],
    r = result(q);
  r.tokenSpans = [
    r.tokenSpans[0],
    {
      ...r.tokenSpans[1],
      token: "ああ",
      endMediaGlobal: 12.5,
      endSecondsLocal: 2.5,
    },
  ];
  const out = inspectContextAlignment(q, r);
  assert.deepEqual(out.segments[1].conditionalCtcInterval, {
    start: 11,
    end: 12.5,
  });
  assert(!out.blockers.includes("TOKEN_TEXT_MISMATCH"));
});
test("a token crossing two original segments cannot be divided into fake times", () => {
  const q = planContextContrast(parent, views, ["p"])[0],
    r = result(q);
  r.tokenSpans = [
    { ...r.tokenSpans[0], token: "前あ" },
    { ...r.tokenSpans[2], targetIndex: 1 },
  ];
  const out = inspectContextAlignment(q, r);
  assert(out.blockers.includes("TOKEN_CROSSES_SEGMENT_BOUNDARY"));
  assert(out.segments.every((s) => s.conditionalCtcInterval === null));
});
test("frame-count failure cannot provide segment boundaries", () => {
  const q = planContextContrast(parent, views, ["p"])[0],
    r = result(q);
  r.frameCountVerified = false;
  assert.deepEqual(inspectContextAlignment(q, r).segments, []);
});
test("streamed logs are verified, not overwritten or recreated", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "context-ctc-log-test-"),
  );
  const r = { stdout: "result\n", stderr: "warning\n" };
  await preserveRunnerLogs(root, r);
  await preserveRunnerLogs(root, r);
  await assert.rejects(
    preserveRunnerLogs(root, { ...r, stdout: "different" }),
    /RUNNER_LOG_MISMATCH/u,
  );
  assert.equal(
    await fs.readFile(path.join(root, "stdout.log"), "utf8"),
    r.stdout,
  );
  await fs.rm(root, { recursive: true });
});
