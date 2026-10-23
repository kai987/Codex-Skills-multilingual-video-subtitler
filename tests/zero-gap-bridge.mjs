import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { proposeZeroGapBridge } from "../scripts/lib/zero-gap-bridge.mjs";
function fixture() {
  const data = Buffer.alloc(12 * 100 * 2);
  for (let i = 0; i < 1200; i++)
    if (i < 300 || i >= 800) data.writeInt16LE(1, i * 2);
  const row = (recordId, sourceStart, sourceEnd, text) => ({
    recordId,
    sourceStart,
    sourceEnd,
    text,
    issues: [],
  });
  return {
    left: row("l", 0, 2.9, "これは本当ですか"),
    bridge: row("b", 2.5, 9, "ですか最近イヤホン"),
    right: row("r", 8.5, 12, "最近イヤホンを買いました"),
    leftSupport: row("s1", 0, 3.1, "これは本当ですか"),
    rightSupport: row("s2", 7.5, 12, "最近イヤホンを買いました"),
    pcm: { sampleRate: 100, frames: 1200, data },
  };
}
test("redistribute only fully duplicated text; keep all signal and original neighbor text", () => {
  const f = fixture(),
    before = globalThis.structuredClone(f),
    r = proposeZeroGapBridge(f);
  assert.equal(r.status, "CANDIDATE");
  assert.deepEqual(
    r.records.map((x) => x.text),
    [f.left.text, f.right.text],
  );
  assert.equal(r.records[0].sourceEnd, 3.15);
  assert.equal(r.records[1].sourceStart, 7.85);
  assert.deepEqual(f.left, before.left);
  assert.equal(r.removed.allSamplesExactlyZero, true);
  assert.equal(r.acousticTimingVerified, false);
  for (let i = 0; i < 1200; i++)
    if (f.pcm.data.readInt16LE(2 * i) !== 0)
      assert(
        r.records.some(
          (x) => i >= x.sourceStart * 100 - 1e-8 && i < x.sourceEnd * 100,
        ),
      );
});
test("unique middle words cannot disappear", () => {
  const f = fixture();
  f.bridge.text = "ですか本当に最近イヤホン";
  assert.equal(proposeZeroGapBridge(f).status, "HOLD");
});
test("distant matching text is not support", () => {
  const f = fixture();
  f.leftSupport.sourceStart = 20;
  f.leftSupport.sourceEnd = 23;
  assert.equal(proposeZeroGapBridge(f).reason, "CONTEXT_NOT_SOURCE_BOUND");
});
test("no nonzero or low-signal gap is discarded", () => {
  const f = fixture();
  for (let i = 300; i < 800; i++) f.pcm.data.writeInt16LE(1, i * 2);
  assert.equal(proposeZeroGapBridge(f).status, "HOLD");
});
test("separate repeated utterances and repeated context are held", () => {
  const f = fixture();
  f.bridge.sourceStart = 3.2;
  assert.equal(proposeZeroGapBridge(f).status, "HOLD");
  const g = fixture();
  g.rightSupport.text += g.rightSupport.text;
  assert.equal(proposeZeroGapBridge(g).status, "HOLD");
});
test("one nonzero sample splitting separator does not get removed", () => {
  const f = fixture();
  f.pcm.data.writeInt16LE(1, 550 * 2);
  assert.equal(proposeZeroGapBridge(f).status, "HOLD");
});
test("nonzero source offset is mapped once", () => {
  const f = fixture();
  for (const k of ["left", "bridge", "right", "leftSupport", "rightSupport"]) {
    f[k].sourceStart += 100;
    f[k].sourceEnd += 100;
  }
  f.sourceOffset = 100;
  const r = proposeZeroGapBridge(f);
  assert.equal(r.status, "CANDIDATE");
  assert.equal(r.records[0].sourceEnd, 103.15);
  assert.equal(r.records[1].sourceStart, 107.85);
});
test("malformed identities and evidence range fail closed", () => {
  const f = fixture();
  f.bridge.recordId = f.left.recordId;
  assert.equal(proposeZeroGapBridge(f).status, "HOLD");
  const g = fixture();
  g.sourceOffset = 10;
  assert.throws(() => proposeZeroGapBridge(g), /INVALID_PCM/);
});
