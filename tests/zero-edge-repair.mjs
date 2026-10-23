import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { repairZeroEdges } from "../scripts/lib/zero-edge-repair.mjs";
const pcm = (seconds = 10) => ({
  sampleRate: 16000,
  frames: seconds * 16000,
  data: Buffer.alloc(seconds * 32000),
});
const row = (id = "a", sourceStart = 0, sourceEnd = 10, text = "テスト") => ({
  recordId: id,
  sourceStart,
  sourceEnd,
  text,
  issues: [],
  order: 1,
});
function verifySignal(p, before, after, offset = 0) {
  for (
    let i = Math.round((before.sourceStart - offset) * 16000);
    i < Math.round((before.sourceEnd - offset) * 16000);
    i++
  )
    if (p.data.readInt16LE(i * 2) !== 0)
      assert(
        i >= Math.round((after.sourceStart - offset) * 16000) &&
          i < Math.round((after.sourceEnd - offset) * 16000),
      );
}
test("trim both edges only, preserve text, all signal samples and display padding", () => {
  const p = pcm();
  p.data.fill(1, 3 * 32000, 7 * 32000);
  const rows = [row()],
    snapshot = JSON.stringify(rows),
    r = repairZeroEdges(rows, p);
  assert.equal(JSON.stringify(rows), snapshot);
  assert.equal(r.records[0].sourceStart, 2.85);
  assert.equal(r.records[0].sourceEnd, 7.15);
  assert.equal(r.records[0].text, rows[0].text);
  verifySignal(p, rows[0], r.records[0]);
  assert(r.decisions[0].removed.every((e) => e.allSamplesExactlyZero));
  assert.equal(r.policy.acousticTimingVerified, false);
  assert.deepEqual(repairZeroEdges(r.records, p).records, r.records);
});
test("all-zero and internal-only silence never delete text or split a cue", () => {
  const p = pcm(),
    rows = [row()];
  assert.deepEqual(repairZeroEdges(rows, p).records, rows);
  p.data.writeInt16LE(1, 0);
  p.data.writeInt16LE(1, p.data.length - 2);
  assert.deepEqual(repairZeroEdges(rows, p).records, rows);
});
test("quiet nonzero samples survive; a click is not silently treated as absent", () => {
  const p = pcm();
  for (let i = 0; i < p.frames; i++) p.data.writeInt16LE(1, i * 2);
  assert.deepEqual(repairZeroEdges([row()], p).records, [row()]);
  p.data.fill(0);
  p.data.writeInt16LE(1, 0);
  p.data.fill(1, 8 * 32000);
  assert.equal(repairZeroEdges([row()], p).records[0].sourceStart, 0);
});
test("offset is applied once with conservative centisecond rounding", () => {
  const p = pcm();
  p.data.fill(1, 3 * 32000 + 14, 7 * 32000 + 10);
  const old = row("x", 100, 110),
    r = repairZeroEdges([old], p, 100).records[0];
  assert.equal(r.sourceStart, 102.85);
  assert.equal(r.sourceEnd, 107.16);
  verifySignal(p, old, r, 100);
});
test("no shorter than two-second edge is changed; single clicks are held as too short", () => {
  const p = pcm();
  p.data.fill(1, 1.99 * 32000);
  assert.deepEqual(repairZeroEdges([row()], p).records, [row()]);
  p.data.fill(0);
  p.data.writeInt16LE(1, 5 * 32000);
  const r = repairZeroEdges([row()], p);
  assert.equal(r.decisions[0].status, "held-too-short");
  assert.deepEqual(r.records, [row()]);
});
test("neighbor order and separate genuine occurrences are preserved", () => {
  const p = pcm();
  p.data.fill(1, 5 * 32000);
  const rows = [row(), row("b", 2, 4, "別の句")];
  const r = repairZeroEdges(rows, p);
  assert.equal(r.decisions[0].status, "held-neighbor-order");
  assert.deepEqual(r.records, rows);
  const repeated = [
    row("1", 0, 2, "同じ句"),
    row("2", 2, 4, "同じ句"),
    row("3", 4, 6, "同じ句"),
    row("4", 6, 8, "同じ句"),
  ];
  assert.deepEqual(
    repairZeroEdges(repeated, p).records.map((r) => r.text),
    repeated.map((r) => r.text),
  );
});
test("invalid identity and out-of-audio range reject instead of clamping", () => {
  const p = pcm();
  assert.throws(() => repairZeroEdges([row(), row()], p), /IDENTITY/);
  assert.throws(() => repairZeroEdges([row("a", -1, 10)], p), /RANGE/);
  assert.throws(() => repairZeroEdges([row("a", 0, 11)], p), /RANGE/);
  assert.throws(() => repairZeroEdges([row("a", null, 10)], p), /TIME/);
});
