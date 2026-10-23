import fs from "node:fs";
import path from "node:path";
import {
  parseAss,
  parseSrt,
  parseVtt,
} from "../packages/subtitle-core/dist/index.js";
import { normalizeC601GoldAssTimestamps } from "../packages/video-subtitler/dist/blind-acceptance/gold-evaluation.js";
import {
  evaluateQuality,
  qualityText,
} from "../packages/video-subtitler/dist/machine-quality/experimental-metrics.js";
import {
  read,
  write,
  verify,
  checkFiles,
  hashFile,
  objectHash,
  variants,
} from "./c6011641-common.mjs";
const [output, gold] = process.argv.slice(2),
  plan = verify(output);
const frozen = read(path.join(output, "generation-freeze.json"));
checkFiles(output, frozen.files);
fs.mkdirSync(path.join(output, "evaluation"));
write(output, "evaluation/first-reference-read.json", {
  readAt: new Date().toISOString(),
  freezeHash: hashFile(path.join(output, "generation-freeze.json")),
  dataset: "development-known",
  priorDeveloperExposure: true,
});
const goldHash = hashFile(gold);
const reference = parseAss(
  normalizeC601GoldAssTimestamps(fs.readFileSync(gold, "utf8")).content,
).map((c, i) => ({ ...c, id: `reference-${i}` }));
const metrics = {},
  cues = {};
for (const variant of variants) {
  const dir = path.join(output, "run-a", variant),
    pkg = read(path.join(dir, "subtitle-package.needs-review.json"));
  const formats = {};
  for (const [ext, parser] of Object.entries({
    srt: parseSrt,
    ass: parseAss,
    vtt: parseVtt,
  })) {
    const cs = parser(
      fs.readFileSync(path.join(dir, "machine-candidate." + ext), "utf8"),
    ).map((c, i) => ({
      ...c,
      id: pkg.cues[i].id,
      style: pkg.cues[i].style ?? "default",
    }));
    formats[ext] = evaluateQuality(cs, reference);
    if (ext === "srt") cues[variant] = cs;
  }
  metrics[variant] = {
    ...formats.srt,
    formats,
    presentationOverflowCues: cues[variant].filter(
      (c) =>
        c.text.split("\n").length > 2 ||
        c.text.split("\n").some((l) => Array.from(l).length > 16),
    ).length,
  };
}
const base = variants[0],
  main = variants[2];
for (const v of variants)
  for (const field of ["exact", "normalized"])
    if (objectHash(metrics[v][field]) !== objectHash(metrics[base][field]))
      throw Error("TEXT_METRICS_CHANGED_IN_END_ONLY_EXPERIMENT");
// This binding is made ONCE from U0, never from the changed end of U1/U2.
const fixed = metrics[base].matches.filter((m) => m.timingEligible);
const envelope =
  plan.requests.find((r) => r.windowId === "W+4")?.window ??
  plan.requests[0].window;
const ambiguity = plan.targets.flatMap((t) => {
  const c = cues[base].find((c) => c.id === t.cueId),
    text = qualityText(c.text);
  const possible = reference.filter(
    (r) =>
      qualityText(r.text) === text &&
      r.end > envelope.start &&
      r.start < envelope.end,
  );
  if (possible.length <= 1) return [];
  return [
    {
      cueId: c.id,
      status: "OCCURRENCE_AMBIGUOUS",
      candidateReferenceIds: possible.map((r) => r.id),
      orderConstraint:
        "candidate indices must be monotonic across successive same-text target cues; no reference reused",
      candidateCorrespondences: possible.map((r) => ({
        referenceId: r.id,
        start: r.start,
        end: r.end,
        errors: Object.fromEntries(
          variants.map((v) => [
            v,
            Math.abs(cues[v].find((n) => n.id === c.id).end - r.end),
          ]),
        ),
      })),
      sensitivity: Object.fromEntries(
        variants.map((v) => {
          const errors = possible.map((r) =>
            Math.abs(cues[v].find((n) => n.id === c.id).end - r.end),
          );
          return [v, { min: Math.min(...errors), max: Math.max(...errors) }];
        }),
      ),
      confirmedFixedSupportGainEligible: false,
    },
  ];
});
const ambiguousIds = new Set(ambiguity.map((a) => a.cueId));
const comparison = fixed.map((m) => {
  const ref = reference.filter((r) => m.referenceIds.includes(r.id)),
    end = Math.max(...ref.map((r) => r.end)),
    start = Math.min(...ref.map((r) => r.start));
  return {
    hypothesisIds: m.hypothesisIds,
    referenceIds: m.referenceIds,
    ambiguous: m.hypothesisIds.some((id) => ambiguousIds.has(id)),
    variants: Object.fromEntries(
      variants.map((v) => {
        const cs = cues[v].filter((c) => m.hypothesisIds.includes(c.id)),
          hs = Math.min(...cs.map((c) => c.start)),
          he = Math.max(...cs.map((c) => c.end));
        return [
          v,
          {
            endError: Math.abs(he - end),
            startError: Math.abs(hs - start),
            iou:
              Math.max(0, Math.min(he, end) - Math.max(hs, start)) /
              (Math.max(he, end) - Math.min(hs, start)),
          },
        ];
      }),
    ),
  };
});
const eligible = comparison.filter((c) => !c.ambiguous);
const summary = Object.fromEntries(
  variants.map((v) => [
    v,
    {
      groups: eligible.length,
      endMAE:
        eligible.reduce((s, c) => s + c.variants[v].endError, 0) /
        eligible.length,
      meanIoU:
        eligible.reduce((s, c) => s + c.variants[v].iou, 0) / eligible.length,
    },
  ]),
);
const changes = read(
  path.join(output, "run-a", main, "mutation-journal.json"),
).changes;
const gain = changes.length > 0 && summary[main].endMAE < summary[base].endMAE;
const regression = metrics[main].timing.endMAE > metrics[base].timing.endMAE;
const gate =
  changes.length === 0
    ? "GUARD_IMPROVEMENT_ONLY_NO_QUALITY_GAIN"
    : gain
      ? regression
        ? "QUALITY_TRADEOFF_HOLD"
        : "LOCAL_TIMING_GAIN_ONLY"
      : regression
        ? "QUALITY_REGRESSION_HOLD"
        : "BOUNDARY_EVIDENCE_INSUFFICIENT";
write(output, "evaluation/metrics.json", {
  metrics,
  fixedSupport: {
    bindingSource: "U0_FROZEN_MATCHES_NO_VARIANT_REMATCH",
    summary,
    comparison,
  },
  goldHash,
  textPreserved: true,
  gate,
  heldout: "HELDOUT_VALIDATION_NOT_RUN",
  defaultPromotionAuthorized: false,
});
write(output, "evaluation/occurrence-ambiguity.json", {
  policy: plan.policy.evaluationMatching,
  ambiguity,
  formalScoresRetainAllGroups: true,
  orderConstrainedAssignmentsNotSelectedForBetterScore: true,
});
write(
  output,
  "evaluation/fixed-support-comparison.csv",
  "hypothesisIds,referenceIds,ambiguous,variant,endError,startError,iou\n" +
    comparison
      .flatMap((c) =>
        variants.map((v) =>
          [
            c.hypothesisIds.join("|"),
            c.referenceIds.join("|"),
            c.ambiguous,
            v,
            c.variants[v].endError,
            c.variants[v].startError,
            c.variants[v].iou,
          ].join(","),
        ),
      )
      .join("\n"),
);
write(
  output,
  "evaluation/changes.md",
  `# End-only evaluation\n\nGate: ${gate}. Actual U2 end changes: ${changes.length}. Text metrics identical across controls.\n\nFixed-support binding comes only from U0, and ambiguous repeated text remains excluded from confirmed gain. Official evaluator results are preserved independently. No direct acoustic human verification or held-out validation.\n`,
);
if (hashFile(gold) !== goldHash) throw Error("GOLD_CHANGED");
checkFiles(output, frozen.files);
console.log(
  JSON.stringify(
    {
      gate,
      changes: changes.length,
      fixedSupport: summary,
      ambiguity: ambiguity.length,
    },
    null,
    2,
  ),
);
