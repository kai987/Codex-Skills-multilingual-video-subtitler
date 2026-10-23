/* global structuredClone */
import test from "node:test";
import assert from "node:assert/strict";
import { planContextWindows } from "../scripts/lib/whole-context-comparison.mjs";
const row = (id, start, end) => ({ id, start, end, text: "発話のテスト" });
const fixture = () => ({
  sources: [
    {
      id: "s",
      duration: 30,
      baseline: [row("a", 0, 2), row("b", 2, 4), row("c", 4, 7)],
    },
  ],
  windows: [
    {
      id: "window-1",
      sourceId: "s",
      start: 1,
      end: 5,
      target: { id: "t", start: 2, end: 4, recordIds: ["b"] },
    },
  ],
});
test("expands same target request to complete neighbor envelopes, without mutation", () => {
  const p = fixture(),
    before = structuredClone(p),
    out = planContextWindows(p);
  assert.deepEqual(p, before);
  assert.deepEqual(out.windows[0].target, {
    id: "context-window-1",
    start: 0,
    end: 7,
    recordIds: ["a", "b", "c"],
  });
  assert.equal(out.windows[0].samples, 112000);
  assert.deepEqual(out.windows[0].originalTarget, p.windows[0].target);
});
test("closure includes transitive overlapping records", () => {
  const p = fixture();
  p.sources[0].baseline.push(row("d", 6, 9));
  assert.equal(planContextWindows(p).windows[0].end, 9);
});
test("over-budget context is deferred whole, never cropped", () => {
  const p = fixture();
  p.sources[0].baseline[2].end = 20;
  assert.equal(planContextWindows(p).windows.length, 0);
  assert.equal(planContextWindows(p).deferred[0].target.end, 20);
});
test("rejects extra targets beyond three", () => {
  const p = fixture();
  p.windows = Array.from({ length: 4 }, (_, i) => ({
    ...p.windows[0],
    id: `w-${i}`,
  }));
  assert.throws(() => planContextWindows(p), /WINDOW_LIMIT/);
});
for (const [name, mutate, error] of [
  [
    "unknown source",
    (p) => (p.windows[0].sourceId = "missing"),
    /INVALID_SOURCE/,
  ],
  ["unsafe ID", (p) => (p.windows[0].id = "../a"), /INVALID_WINDOW_ID/],
  ["duplicate window", (p) => p.windows.push(p.windows[0]), /DUPLICATE_WINDOW/],
  ["duplicate source", (p) => p.sources.push(p.sources[0]), /DUPLICATE_SOURCE/],
  [
    "incomplete original target",
    (p) => (p.windows[0].target.recordIds = []),
    /ORIGINAL_TARGET_NOT_CLOSED/,
  ],
  [
    "target outside crop",
    (p) => (p.windows[0].target.end = 9),
    /INVALID_ORIGINAL_TARGET/,
  ],
  [
    "invalid baseline",
    (p) => (p.sources[0].baseline[0].end = NaN),
    /INVALID_BASELINE/,
  ],
  ["out of source", (p) => (p.windows[0].end = 31), /INVALID_WINDOW/],
])
  test(name, () => {
    const p = fixture();
    mutate(p);
    assert.throws(() => planContextWindows(p), error);
  });
