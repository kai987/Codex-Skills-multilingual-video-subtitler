/** Gold-isolated development evaluation; never imported by generation. */
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { parseSrt } from "../packages/subtitle-core/dist/parse.js";
import { compareReference } from "./lib/subtitle-reference-comparison.mjs";
import { observeShortResponses } from "./lib/short-response-observation.mjs";
import { intervalUnion } from "./lib/audio-coverage-observation.mjs";
import { verifyAudioCoverage } from "./lib/audio-coverage-delivery.mjs";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const overlap = (a, b) =>
  Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
const norm = (s) => s.normalize("NFKC").replace(/[\s\p{P}\p{S}]/gu, "");
const seconds = (rows) =>
  intervalUnion(rows).reduce((s, r) => s + r.end - r.start, 0);
const coverage = (rows, ref) =>
  intervalUnion(rows).reduce((s, r) => s + overlap(r, ref), 0) /
  (ref.end - ref.start);

export function compareCoveragePlans(records, references, plan) {
  const previous = observeShortResponses(records).entries;
  const selectedIds = new Set(plan.previews.map((p) => p.unitId));
  const selectedUnits = plan.candidates.filter((u) => selectedIds.has(u.id));
  const cases = references.map((r) => ({
    id: `reference-line-${r.line}`,
    start: r.start,
    end: r.end,
    expectedText: r.text,
    oldShortCueIds: previous.filter((c) => overlap(c, r) > 0).map((c) => c.id),
    newCandidateIds: plan.candidates
      .filter((c) => overlap(c, r) > 0)
      .map((c) => c.id),
    oldCoverageFraction: coverage(previous, r),
    newCoverageFraction: coverage(plan.candidates, r),
    combinedCoverageFraction: coverage([...previous, ...plan.candidates], r),
    selectedTargetCoverageFraction: coverage(selectedUnits, r),
    previewIncludingContextCoverageFraction: coverage(plan.previews, r),
    noOverlappingMachineCue: !records.some((c) => overlap(c, r) > 0),
  }));
  return {
    cases,
    summary: {
      referenceCaseCount: cases.length,
      oldShortCueTouchCount: cases.filter((c) => c.oldCoverageFraction > 0)
        .length,
      newCandidateTouchCount: cases.filter((c) => c.newCoverageFraction > 0)
        .length,
      combinedTouchCount: cases.filter((c) => c.combinedCoverageFraction > 0)
        .length,
      newlyFlaggedCaseCount: cases.filter(
        (c) => c.newCoverageFraction > 0 && c.oldCoverageFraction === 0,
      ).length,
      oldAtLeastHalfCovered: cases.filter((c) => c.oldCoverageFraction >= 0.5)
        .length,
      combinedAtLeastHalfCovered: cases.filter(
        (c) => c.combinedCoverageFraction >= 0.5,
      ).length,
      selectedTargetTouchCount: cases.filter(
        (c) => c.selectedTargetCoverageFraction > 0,
      ).length,
      previewIncludingContextTouchCount: cases.filter(
        (c) => c.previewIncludingContextCoverageFraction > 0,
      ).length,
      noMachineCueCaseCount: cases.filter((c) => c.noOverlappingMachineCue)
        .length,
      noMachineCueCasesWithActivityHint: cases.filter(
        (c) => c.noOverlappingMachineCue && c.newCoverageFraction > 0,
      ).length,
      oldObservationCount: previous.length,
      oldObservationUnionSeconds: seconds(previous),
      ...plan.summary,
      reviewPrecision: null,
      confirmedErrorRecall: null,
      independentHoldoutValidation: "not-run",
      newInference: 0,
      subtitleTextMutations: 0,
      subtitleTimingMutations: 0,
    },
  };
}

export async function evaluateAudioCoverage(root, referencePath) {
  const audit = await verifyAudioCoverage(root);
  const subtitleBytes = await fs.readFile(audit.subtitlePath);
  const records = parseSrt(subtitleBytes.toString("utf8")).map((r, i) => ({
    id: `preferred-${i + 1}`,
    start: r.start,
    end: r.end,
    text: r.text,
  }));
  // This is the first reference read; the observer and preview selection are already frozen.
  const reference = await fs.readFile(referencePath);
  const all = compareReference({
    referenceAss: reference.toString("utf8"),
    baselineRecords: records,
    candidateRecords: records,
    windows: [
      {
        id: "frozen-source-range",
        ...audit.activity.range,
        kind: "known-development-evaluation",
      },
    ],
  }).perWindow[0].reference.records;
  const fixed = all.filter(
    (r) => Array.from(norm(r.text)).length <= 6 && r.end - r.start <= 2,
  );
  const comparison = compareCoveragePlans(records, fixed, audit.coverage);
  const report = {
    version: "audio-coverage-development-evaluation-v1",
    referenceHash: hash(reference),
    machineFreezeHash: hash(
      await fs.readFile(path.join(root, "audio-coverage-freeze.json")),
    ),
    caseRule:
      "Same fixed development rule as prior round: strict Dialogue first line; normalized length <=6 and duration <=2 seconds.",
    ...comparison,
    limitations: [
      "Time intersection and half-interval coverage are location diagnostics, NOT ASR accuracy or confirmed-error recall.",
      "Selected target coverage is separate from broader preview context; unselected candidates are not counted as reviewed.",
      "Energy cannot distinguish music or noise from dialogue. Precision remains unknown without listening labels.",
      "This known episode has been used in development; no independent held-out validation was performed.",
      "No subtitle text or timing changed. Machine generation quality gain is not demonstrated.",
    ],
    qualityStatus: "needs-review",
    finalizationMethod: "none",
  };
  await verifyAudioCoverage(root);
  assert.equal(
    hash(await fs.readFile(referencePath)),
    report.referenceHash,
    "REFERENCE_CHANGED",
  );
  assert.equal(
    hash(await fs.readFile(audit.subtitlePath)),
    hash(subtitleBytes),
    "SUBTITLE_CHANGED",
  );
  await fs.writeFile(
    path.join(root, "reference-evaluation.json"),
    JSON.stringify(report, null, 2) + "\n",
    { flag: "wx" },
  );
  return report.summary;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const [root, reference, ...extra] = process.argv.slice(2);
    if (!root || !reference || extra.length)
      throw Error("Usage: FROZEN_AUDIO_COVERAGE_ROOT REFERENCE_ASS");
    console.log(
      JSON.stringify(await evaluateAudioCoverage(root, reference), null, 2),
    );
  } catch (error) {
    console.error(String(error));
    process.exitCode = 1;
  }
}
