import test from "node:test";
import assert from "node:assert/strict";
import {
  alignmentWords,
  boundaryWindows,
  inspectWordAlignment,
  compareWordAlignments,
} from "../scripts/lib/word-boundary-probe.mjs";
test("tokenization preserves surfaces, excluding only punctuation", () => {
  const a = {
    items: [
      { morphemes: [{ surface: "あれ" }, { surface: "?" }], unresolvedOov: [] },
    ],
  };
  assert.deepEqual(alignmentWords(a, "あれ?"), ["あれ"]);
  assert.throws(() => alignmentWords(a, "それ?"), /TEXT_LOSS/u);
});
test("unresolved pronunciation fails closed", () => {
  assert.throws(
    () =>
      alignmentWords(
        { items: [{ morphemes: [{ surface: "字" }], unresolvedOov: ["字"] }] },
        "字",
      ),
    /PRONUNCIATION/u,
  );
});
test("windows are source-global and preserve machine text", () => {
  const r = boundaryWindows(
    { coreRecordIds: ["a"], start: 9, end: 15 },
    [{ recordId: "a", sourceStart: 11, sourceEnd: 13, text: "あれ" }],
    20,
    5,
  );
  assert.equal(r.text, "あれ");
  assert.deepEqual(
    r.windows.map((w) => [w.start, w.end]),
    [
      [10.5, 13.5],
      [9, 15],
    ],
  );
  assert.throws(
    () =>
      boundaryWindows(
        { coreRecordIds: ["a"], start: 9, end: 12 },
        [{ recordId: "a", sourceStart: 11, sourceEnd: 13, text: "a" }],
        20,
      ),
    /NESTED/u,
  );
});
const raw = {
  words: [{ start: 0.5, end: 1, label: "あれ" }],
  phones: [
    { start: 0.5, end: 0.7, label: "a" },
    { start: 0.7, end: 1, label: "ɾe" },
  ],
};
const w = { id: "narrow", start: 10, end: 12, frames: 32000 };
test("word and phone evidence maps exactly once, excluding file envelope", () => {
  const r = inspectWordAlignment(raw, w, ["あれ"]);
  assert.equal(r.intervals[0].sourceStart, 10.5);
  assert.equal(r.intervals[0].sourceEnd, 11);
  assert.deepEqual(r.blockers, []);
  assert.equal(r.intervals[0].phoneCoverage, 1);
});
test("stable MFA pair remains conditional and cannot mutate subtitles", () => {
  const a = inspectWordAlignment(raw, w, ["あれ"]),
    b = inspectWordAlignment(raw, { ...w, id: "wide" }, ["あれ"]);
  const r = compareWordAlignments([a, b]);
  assert.equal(r.status, "STABLE_CONDITIONAL_WORD_INTERVALS");
  assert.equal(r.subtitleMutationAuthorized, false);
  assert.equal(r.independentLexicalVerification, false);
});
test("wordwise instability is blocked even if phrase outer boundary seems plausible", () => {
  const a = inspectWordAlignment(raw, w, ["あれ"]),
    b = inspectWordAlignment(raw, { ...w, start: 10.3 }, ["あれ"]);
  assert(
    compareWordAlignments([a, b]).blockers.includes(
      "WORD_BOUNDARY_WINDOW_UNSTABLE",
    ),
  );
});
test("unknown words, missing phones, reversed time, and edge pinning block", () => {
  assert(
    inspectWordAlignment(
      { ...raw, words: [{ start: 0, end: 1, label: "<unk>" }], phones: [] },
      w,
      ["あれ"],
    ).blockers.includes("CROP_EDGE_PINNED"),
  );
  assert(
    inspectWordAlignment({ ...raw, phones: [] }, w, ["あれ"]).blockers.includes(
      "NO_PHONE_TIER_SUPPORT",
    ),
  );
  assert(
    inspectWordAlignment(
      { ...raw, words: [{ start: 1, end: 0.5, label: "あれ" }] },
      w,
      ["あれ"],
    ).blockers.includes("INVALID_TIER_INTERVALS"),
  );
});
