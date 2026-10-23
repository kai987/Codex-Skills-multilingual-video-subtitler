import test from "node:test";
import assert from "node:assert/strict";
import { planSafetyProbes } from "../scripts/lib/safety-recovery-probe.mjs";

test("bounded machine selection merges overlap chains and preserves inputs", () => {
  const records = [
    { start: 10, end: 15, text: "ああああああ少し待ってください" },
    { start: 40, end: 42, text: "それは" },
    { start: 41, end: 44, text: "それは以前から使っていたカードです" },
    { start: 42, end: 42.3, text: "それは" },
    { start: 60, end: 76, text: "もしかして場所がない" },
  ];
  const original = JSON.stringify(records),
    p = planSafetyProbes(records, 100);
  assert.equal(p.targets.length, 3);
  assert.equal(p.requests.length, 6);
  assert.deepEqual(p.targets[1].cueIndexes, [1, 2, 3]);
  assert(p.reservedAudioSeconds <= 120);
  assert(p.requests.every((r) => r.end - r.start <= 30));
  assert.equal(JSON.stringify(records), original);
  assert.deepEqual(planSafetyProbes(records, 100), p);
});
test("music, standalone response and known template classes do not trigger these probes", () => {
  assert.equal(
    planSafetyProbes(
      [
        { start: 0, end: 4, text: "ああ" },
        { start: 5, end: 10, text: "♪ああああああ歌の続き" },
        { start: 12, end: 16, text: "ご視聴ありがとうございました" },
      ],
      20,
    ).requests.length,
    0,
  );
});
test("out of range input is rejected and overlong sparse windows skipped", () => {
  assert.throws(() =>
    planSafetyProbes([{ start: 0, end: 31, text: "短い言葉" }], 30),
  );
  assert.equal(
    planSafetyProbes([{ start: 0, end: 50, text: "短い言葉" }], 80).requests
      .length,
    0,
  );
});
test("crop bounds use source limits, not invented negative timestamps", () => {
  const p = planSafetyProbes(
    [{ start: 0, end: 3, text: "ああああああ少し待って" }],
    4,
  );
  assert(p.requests.every((r) => r.start === 0 && r.end <= 4));
});

test("a sparse template is excluded before selecting a lexical long-span target", () => {
  const p = planSafetyProbes(
    [
      { start: 10, end: 30, text: "ご視聴ありがとうございました" },
      { start: 40, end: 56, text: "もしかして場所がない" },
    ],
    100,
  );
  assert.deepEqual(
    p.targets.map((t) => t.cueIndexes),
    [[1]],
  );
});
