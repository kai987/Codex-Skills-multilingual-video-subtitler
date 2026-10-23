import assert from "node:assert/strict";
import { formats } from "../../packages/video-subtitler/dist/standalone/bounded.js";
import { formatProjection } from "./representation-grid.mjs";

/** Apply one explicit human-confirmed missing utterance, never a machine inference. */
export function insertConfirmedUtterance(srt, confirmation, context) {
  assert.equal(confirmation.authority, "explicit-human-confirmed-utterance");
  assert.equal(confirmation.timebase, "source-global-seconds");
  assert(
    typeof confirmation.reviewer === "string" && confirmation.reviewer.trim(),
  );
  assert(typeof confirmation.quote === "string" && confirmation.quote.trim());
  const { start, end, text } = confirmation;
  assert([start, end, context.start, context.end].every(Number.isFinite));
  assert(
    context.start >= 0 &&
      start >= context.start &&
      end <= context.end &&
      end > start,
    "CONFIRMATION_OUTSIDE_CONTEXT",
  );
  assert(
    [start, end].every((t) => Math.abs(t * 100 - Math.round(t * 100)) < 1e-7),
    "CENTISECOND_GRID_REQUIRED",
  );
  assert(
    typeof text === "string" &&
      text.trim() === text &&
      text.length > 0 &&
      [...text].length <= 16 &&
      !/[\r\n{}<>\\]/u.test(text),
    "UNSAFE_CONFIRMED_TEXT",
  );
  const baseline = formats.srt.parse(srt).map((c, i) => ({
    recordId: `baseline-${i + 1}`,
    sourceStart: c.start,
    sourceEnd: c.end,
    text: c.text,
  }));
  assert(baseline.length > 0, "EMPTY_BASELINE");
  const expectedBlocks = srt.trim().split(/\r?\n\s*\r?\n/u).length;
  assert.equal(baseline.length, expectedBlocks, "BASELINE_PARSE_LOSS");
  assert(
    baseline.every(
      (r, i) =>
        Number.isFinite(r.sourceStart) &&
        r.sourceStart >= 0 &&
        r.sourceEnd > r.sourceStart &&
        r.text.trim() &&
        (!i || r.sourceStart >= baseline[i - 1].sourceStart),
    ),
    "INVALID_BASELINE",
  );
  // Existing overlaps outside the explicit insertion are preserved, not repaired here.
  const exact = baseline.filter(
    (r) => r.sourceStart === start && r.sourceEnd === end && r.text === text,
  );
  const overlaps = baseline.filter(
    (r) => r.sourceStart < end && start < r.sourceEnd,
  );
  if (exact.length === 1 && overlaps.length === 1)
    return {
      status: "already-present",
      contents: null,
      records: baseline,
      inserted: 0,
      preserved: baseline.length,
    };
  assert.equal(overlaps.length, 0, "HUMAN_INSERTION_OVERLAPS_EXISTING_CUE");
  const inserted = {
    recordId: "human-confirmed-utterance",
    sourceStart: start,
    sourceEnd: end,
    text,
  };
  const records = [...baseline, inserted].sort(
    (a, b) => a.sourceStart - b.sourceStart,
  );
  const contents = formatProjection(records, "ja");
  const actual = formats.srt
    .parse(contents.srt)
    .map((r) => ({ start: r.start, end: r.end, text: r.text }));
  const index = records.findIndex((r) => r.recordId === inserted.recordId);
  actual.splice(index, 1);
  assert.deepEqual(
    actual,
    baseline.map((r) => ({
      start: r.sourceStart,
      end: r.sourceEnd,
      text: r.text,
    })),
    "UNRELATED_CUE_MUTATION",
  );
  return {
    status: "human-assisted-needs-review",
    contents,
    records,
    inserted: 1,
    insertedIndex: index + 1,
    preserved: baseline.length,
    wholeFileHumanValidated: false,
    machineIndependent: false,
    finalizationMethod: "none",
  };
}
