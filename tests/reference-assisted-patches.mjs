import test from "node:test";
import assert from "node:assert/strict";
import { formats } from "../packages/video-subtitler/dist/standalone/bounded.js";
import {
  applyReferencePatches,
  readJapaneseReference,
  recordHash,
  renderReferencePatches,
  tuple,
} from "../scripts/lib/reference-assisted-patches.mjs";
const cue = (start, text = "ああ") => ({
  start,
  end: start + 1,
  text,
  style: "dialogue",
});
const records = [cue(1), cue(5, "それは"), cue(5.5, "それは"), cue(8)];
const createPlan = () => ({
  baselineRecordHash: recordHash(records),
  requiredConfirmations: [records[0], records[3]],
  patches: [
    {
      authority: "user-reference-ass",
      reason: "Same occurrence duplicate only",
      remove: [1, 2],
      replacements: [
        { ...cue(5, "それはポイントカードで"), referenceLine: 20 },
      ],
    },
  ],
});
test("restores a lost human utterance without replacing the newer baseline", () => {
  const p = createPlan();
  const confirmed = { ...cue(68), end: 69.58 };
  p.patches.push({
    authority: "explicit-human-confirmed-utterance",
    reason: "Restore ancestor confirmation",
    remove: [],
    replacements: [confirmed],
  });
  p.requiredConfirmations.push(confirmed);
  const c = applyReferencePatches(records, p);
  assert.equal(c.result.at(-1).start, 68);
  assert.equal(c.result.at(-1).end, 69.58);
  assert.equal(c.result.filter((r) => r.text === "ああ").length, 3);
});
test("same occurrence only; genuine repeats and unknowns survive", () => {
  const c = applyReferencePatches(records, createPlan());
  assert.equal(c.result.length, 3);
  assert.deepEqual(c.retained.map(tuple), [
    tuple(records[0]),
    tuple(records[3]),
  ]);
  assert.equal(c.result.filter((r) => r.text === "ああ").length, 2);
});
test("changed text and timing both invalidate baseline binding", () => {
  assert.throws(
    () => applyReferencePatches([cue(1.01), ...records.slice(1)], createPlan()),
    /STALE_BASELINE/u,
  );
  assert.throws(
    () =>
      applyReferencePatches([cue(1, "え"), ...records.slice(1)], createPlan()),
    /STALE_BASELINE/u,
  );
});
test("reject deletion or duplication of prior human confirmation", () => {
  const p = createPlan();
  p.requiredConfirmations.push(records[1]);
  assert.throws(() => applyReferencePatches(records, p), /LOST_OR_DUPLICATED/u);
  const q = createPlan();
  q.patches[0].replacements.push({ ...records[0], referenceLine: 22 });
  assert.throws(() => applyReferencePatches(records, q), /LOST_OR_DUPLICATED/u);
});
test("reject index reuse, invalid time, missing reference source", () => {
  const p = createPlan();
  p.patches.push(p.patches[0]);
  assert.throws(() => applyReferencePatches(records, p), /REUSED_INDEX/u);
  const q = createPlan();
  q.patches[0].replacements[0].end = 0;
  assert.throws(
    () => applyReferencePatches(records, q),
    /INVALID_REPLACEMENT/u,
  );
  const r = createPlan();
  delete r.patches[0].replacements[0].referenceLine;
  assert.throws(
    () => applyReferencePatches(records, r),
    /MISSING_REFERENCE_LINE/u,
  );
});
test("reference parser excludes Ruby/Chinese and retains lyric repetitions", () => {
  const ass =
    "[Events]\nFormat: Layer, Start, End, Style, Text\n" +
    "Dialogue: 0,0:00:01.00,0:00:02.00,Dialogue,{\\i1}ああ\\N中文\n" +
    "Dialogue: 0,0:00:01.00,0:00:02.00,RubyDialogue,あ\n" +
    "Dialogue: 0,0:00:03.00,0:00:04.00,Song,♪ ああ ♪\\N中文\n" +
    "Dialogue: 0,0:00:05.00,0:00:06.00,Song,♪ ああ ♪";
  const parsed = readJapaneseReference(ass);
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].text, "ああ");
  assert.equal(parsed[1].style, "music");
  assert.equal(parsed[2].text, parsed[1].text);
});
test("ASS retains original header and untouched events; all formats agree", () => {
  const ass = formats.ass.format(records.map((r, i) => ({ ...r, id: `${i}` })));
  const c = applyReferencePatches(records, createPlan());
  for (const ext of ["ass", "srt", "vtt"]) {
    const text = renderReferencePatches(ass, c, ext);
    assert.deepEqual(formats[ext].parse(text).map(tuple), c.result.map(tuple));
    if (ext === "ass")
      assert(
        text.includes(ass.split("\n").find((l) => l.startsWith("Dialogue:"))),
      );
  }
});
