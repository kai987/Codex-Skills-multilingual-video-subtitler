import fs from "node:fs";
import path from "node:path";
import { read, write, oh, hash } from "./c60117-common.mjs";
import {
  prepareUnits,
  closure,
} from "../packages/video-subtitler/dist/machine-quality/reference-complete.js";
import { parseSrt } from "../packages/subtitle-core/dist/index.js";
const [root, oldRoot] = process.argv.slice(2);
const reference = read(
  path.join(root, "dataset/evaluation-only/reference-manifest.json"),
);
const old = read(path.join(oldRoot, "dataset-selection.json"));
const remade = prepareUnits({
  reference: reference.fullReference,
  rate: reference.source.sourceSampleRate,
  duration: reference.source.durationSeconds,
  old: old.clips,
  candidates: old.candidates,
  replacementOrder: old.replacementOrder,
  exclusions: old.exclusions,
});
if (
  oh(remade.units) !== oh(reference.units) ||
  oh(remade.ledger) !== oh(reference.ledger)
)
  throw Error("Preparation changed after defensive lint edits");
const variants = [
  "P0-primary-minimal",
  "P1-current-matched",
  "P2-frozen-overlap-required",
  "P2-repair-disabled",
];
const presentation = [];
for (const u of reference.units)
  for (const v of variants) {
    const cues = parseSrt(
      fs.readFileSync(
        path.join(root, "run-a", u.id, v, "machine-candidate.srt"),
        "utf8",
      ),
    );
    presentation.push({
      unitId: u.id,
      partition: u.partition,
      variant: v,
      cues: cues.length,
      overlongLines: cues
        .flatMap((c) => c.text.split("\n"))
        .filter((l) => Array.from(l).length > 16).length,
      overTwoLines: cues.filter((c) => c.text.split("\n").length > 2).length,
      duplicateAdjacent: cues.filter(
        (c, i) => i > 0 && c.text === cues[i - 1].text,
      ).length,
      overlapPairs: cues.flatMap((a, i) =>
        cues.slice(i + 1).filter((b) => a.start < b.end && b.start < a.end),
      ).length,
    });
  }
const scopeRelations = reference.units.map((u) => ({
  id: u.id,
  seedId: u.seed.id,
  oldWindow: { start: u.seed.start, end: u.seed.end },
  newWindow: { start: u.start, end: u.end },
  addedSeconds:
    Math.max(0, u.seed.start - u.start) + Math.max(0, u.end - u.seed.end),
  omittedSeconds:
    Math.max(0, u.start - u.seed.start) + Math.max(0, u.seed.end - u.end),
  complete: closure(u, reference.fullReference).complete,
}));
const timing = [];
for (const p of ["D1", "C1"]) {
  const e = read(
    path.join(
      root,
      "evaluation",
      p === "D1" ? "D1-remeasurement.json" : "C1-fixed-policy-check.json",
    ),
  );
  for (const v of variants) {
    const ms = e.rows.flatMap((r) =>
      r.byVariant[v].matches.filter((m) => m.timingEligible),
    );
    const abs = ms
      .flatMap((m) => [Math.abs(m.startError), Math.abs(m.endError)])
      .sort((a, b) => a - b);
    const mean = (f) =>
      ms.length ? ms.reduce((n, m) => n + f(m), 0) / ms.length : null;
    timing.push({
      partition: p,
      variant: v,
      matchedGroups: ms.length,
      startMAE: mean((m) => Math.abs(m.startError)),
      endMAE: mean((m) => Math.abs(m.endError)),
      P95: abs[Math.ceil(abs.length * 0.95) - 1] ?? null,
      meanIoU: mean((m) => m.iou),
      unmatchedReference: e.rows.reduce(
        (n, r) => n + r.byVariant[v].timing.unmatchedReferenceCues,
        0,
      ),
      unmatchedHypothesis: e.rows.reduce(
        (n, r) => n + r.byVariant[v].timing.unmatchedHypothesisCues,
        0,
      ),
      severe: e.rows.reduce(
        (n, r) => n + r.byVariant[v].timing.severeBoundaryGroups,
        0,
      ),
    });
  }
}
const counters = read(path.join(root, "model-execution-summary.json"));
const file = path.join(root, "supplemental-validation.json");
write(file, {
  preparationSemanticParity: true,
  scopeRelations,
  presentation,
  timing,
  counters,
  preflightHash: await hash(
    path.join(root, "dataset/reference-complete-preflight.json"),
  ),
  interpretation:
    "Reference-relative metrics only. No additional evaluation run, model or parameter selection.",
});
console.log(
  JSON.stringify(
    {
      preparationSemanticParity: true,
      timing,
      presentationTotals: variants.map((v) => ({
        variant: v,
        ...presentation
          .filter((r) => r.variant === v)
          .reduce(
            (a, r) => ({
              overlongLines: a.overlongLines + r.overlongLines,
              overTwoLines: a.overTwoLines + r.overTwoLines,
              duplicateAdjacent: a.duplicateAdjacent + r.duplicateAdjacent,
              overlapPairs: a.overlapPairs + r.overlapPairs,
            }),
            {
              overlongLines: 0,
              overTwoLines: 0,
              duplicateAdjacent: 0,
              overlapPairs: 0,
            },
          ),
      })),
    },
    null,
    2,
  ),
);
