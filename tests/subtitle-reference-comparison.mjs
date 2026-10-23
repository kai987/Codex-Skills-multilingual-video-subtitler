import { test } from "node:test";
import assert from "node:assert/strict";
import { compareReference } from "../scripts/lib/subtitle-reference-comparison.mjs";

const clock = (s) => `0:00:${String(s).padStart(2, "0")}.00`;
const row = (start, end, text, style = "Dialogue") =>
  `Dialogue: 0,${clock(start)},${clock(end)},${style},,0,0,0,,${text}`;
const ass = (...rows) =>
  "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n" +
  rows.join("\n");
const record = (text, start = 1, end = 2) => ({ start, end, text });
const window = (start = 0, end = 10, id = "fixed") => ({
  id,
  start,
  end,
  kind: "machine-risk",
});
const compare = (
  referenceAss,
  baselineRecords,
  candidateRecords = baselineRecords,
  windows = [window()],
) =>
  compareReference({
    referenceAss,
    baselineRecords,
    candidateRecords,
    windows,
  });

test("strict Dialogue first line drops Chinese translation, RubyDialogue, Song and Sign; retains comma text", () => {
  const r = compare(
    ass(
      row(1, 2, "{\\fs32}はい,そうです！\\N{\\fs24}是的，就是这样！"),
      row(1, 2, "ふりがな", "RubyDialogue"),
      row(3, 4, "うた", "Song"),
      row(4, 5, "かんばん", "Sign"),
      row(5, 6, "中文翻译", "Chinese"),
    ),
    [record("はいそうです")],
  );
  assert.equal(r.counts.reference, 1);
  assert.equal(r.counts.referenceParsing.excludedOtherStyles, 4);
  assert.equal(r.counts.referenceParsing.discardedAdditionalLines, 1);
  assert.equal(r.perWindow[0].reference.records[0].text, "はい,そうです！");
  assert.equal(r.perWindow[0].baseline.edit.CER, 0);
  assert.equal(JSON.stringify(r.perWindow).includes("就是这样"), false);
});

test("NFKC punctuation whitespace normalization is narrow; codepoint S D I counts cover full reference window", () => {
  const r = compare(
    ass(row(1, 2, "あい"), row(3, 4, "うえ")),
    [record("あＺ", 1, 2)],
    [record("あいうえ☆", 1, 4)],
  ).perWindow[0];
  assert.deepEqual(r.baseline.edit, {
    N: 4,
    hypothesisCharacters: 2,
    S: 1,
    D: 2,
    I: 0,
    distance: 3,
    CER: 0.75,
    matchedCharacters: 1,
  });
  assert.equal(r.candidate.edit.I, 1);
  assert.equal(r.candidate.edit.CER, 0.25);
  const n = compare(ass(row(1, 2, "ｶﾀｶﾅ、です！")), [record("カタカナ です")]);
  assert.equal(n.perWindow[0].baseline.edit.CER, 0);
});

test("unique exact timing uses both directions across full inputs, including duplicates outside sample window", () => {
  const refs = ass(row(1, 2, "はい"), row(10, 11, "はい"));
  const dupReference = compare(refs, [record("はい")], undefined, [
    window(0, 3),
  ]);
  assert.equal(dupReference.perWindow[0].baseline.timing.matchCount, 0);
  assert.equal(
    dupReference.perWindow[0].baseline.timing.pairs[0].referenceCandidateCount,
    2,
  );
  const dupMachine = compare(
    ass(row(1, 2, "そうです")),
    [record("そうです"), record("そうです", 10, 11)],
    undefined,
    [window(0, 3)],
  );
  assert.equal(dupMachine.perWindow[0].baseline.timing.matchCount, 0);
  assert.equal(
    dupMachine.perWindow[0].baseline.timing.pairs[0]
      .reverseMachineCandidateCount,
    2,
  );
});

test("timing matches within inclusive 15 seconds only and reports signed and absolute differences", () => {
  const refs = ass(row(1, 2, "こんにちは"));
  const r = compare(
    refs,
    [record("こんにちは", 4.5, 6)],
    [record("こんにちは", 16, 17)],
    [window(0, 20)],
  ).perWindow[0];
  assert.equal(r.baseline.timing.start.meanSigned, 3.5);
  assert.equal(r.baseline.timing.start.greaterThan3Seconds, 1);
  assert.equal(r.candidate.timing.matchCount, 1);
  const outside = compare(
    refs,
    [record("こんにちは", 16.01, 17.01)],
    undefined,
    [window(0, 20)],
  );
  assert.equal(outside.perWindow[0].baseline.timing.matchCount, 0);
  assert.equal(outside.perWindow[0].baseline.timing.start.meanAbsolute, null);
});

test("empty reference has null CER, not zero or invented perfect accuracy; gaps do not prove silence", () => {
  const r = compare(ass(row(20, 21, "こんにちは")), [record("あの")]);
  const w = r.perWindow[0];
  assert.equal(w.baseline.edit.N, 0);
  assert.equal(w.baseline.edit.I, 2);
  assert.equal(w.baseline.edit.CER, null);
  assert.deepEqual(w.baseline.referenceGapIndices, [0]);
  assert.ok(w.cautions.includes("EMPTY_REFERENCE_WINDOW_CER_UNDEFINED"));
  assert.ok(
    w.cautions.includes("REFERENCE_TIMELINE_GAPS_NOT_PROOF_OF_SILENCE"),
  );
  assert.equal(r.overallAccuracy, null);
  assert.equal(r.overallCER, null);
  assert.equal(r.humanValidated, false);
  assert.equal(r.machineWindowFreezeVerified, false);
});

test("boundary crossing reference and machine records are counted whole and flagged, never hidden", () => {
  const r = compare(
    ass(row(1, 5, "あいうえ")),
    [record("あいうえ", 1, 5)],
    [record("あいうえ", 1, 5)],
    [window(2, 3)],
  ).perWindow[0];
  assert.equal(r.reference.recordCount, 1);
  assert.equal(r.baseline.recordCount, 1);
  assert.equal(r.baseline.edit.N, 4);
  assert.equal(r.baseline.edit.hypothesisCharacters, 4);
  assert.equal(r.baseline.edit.CER, 0);
  assert.deepEqual(r.reference.boundaryCrossingIndices, [0]);
  assert.deepEqual(r.candidate.boundaryCrossingIndices, [0]);
  assert.ok(r.cautions.includes("REFERENCE_BOUNDARY_CROSSING_INCLUDED"));
  assert.ok(r.cautions.includes("CANDIDATE_BOUNDARY_CROSSING_INCLUDED"));
});

test("zero-duration raw machine text is preserved in window text and flagged", () => {
  const r = compare(ass(row(1, 2, "あの")), [record("あの", 1.5, 1.5)])
    .perWindow[0];
  assert.equal(r.baseline.recordCount, 1);
  assert.equal(r.baseline.edit.CER, 0);
  assert.deepEqual(r.baseline.zeroDurationIndices, [0]);
  assert.ok(r.cautions.includes("BASELINE_ZERO_DURATION_TEXT_INCLUDED"));
});

test("half-open windows exclude touching records and preserve input objects", () => {
  const input = {
    referenceAss: ass(row(1, 2, "あ"), row(3, 4, "い")),
    baselineRecords: [record("あ", 1, 2), record("い", 3, 4)],
    candidateRecords: [],
    windows: [window(2, 3)],
  };
  const before = JSON.parse(JSON.stringify(input));
  const r = compareReference(input);
  assert.deepEqual(input, before);
  assert.equal(r.perWindow[0].reference.recordCount, 0);
  assert.equal(r.perWindow[0].baseline.recordCount, 0);
});

test("kanji-only first-line ambiguity is disclosed rather than silently discarding Japanese names", () => {
  const r = compare(ass(row(1, 2, "山田\\N山田")), [record("山田")]);
  assert.equal(r.counts.reference, 1);
  assert.equal(r.counts.referenceParsing.hanOnlyFirstLinesLanguageAmbiguous, 1);
  assert.ok(
    r.cautions.includes("HAN_ONLY_FIRST_LINES_RETAINED_LANGUAGE_AMBIGUOUS"),
  );
});

test("reject malformed records/windows and report overlapping sample double counting", () => {
  assert.throws(
    () => compare(ass(), [record("あ", 2, 1)]),
    /INVALID_BASELINE_RECORD/u,
  );
  assert.throws(() => compare(ass(), [], [], []), /FIXED_WINDOWS_REQUIRED/u);
  assert.throws(
    () => compare(ass(), [], [], [window(), window()]),
    /INVALID_OR_DUPLICATE_WINDOW/u,
  );
  const r = compare(ass(), [], [], [window(0, 3, "a"), window(2, 4, "b")]);
  assert.ok(
    r.cautions.includes("OVERLAPPING_WINDOWS_MAY_DOUBLE_COUNT_RECORDS"),
  );
});
