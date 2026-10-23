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
} from "./c6011642-common.mjs";
const [output, gold] = process.argv.slice(2),
  plan = verify(output);
checkFiles(output, read(path.join(output, "generation-freeze.json")).files);
fs.mkdirSync(path.join(output, "evaluation"));
write(output, "evaluation/first-reference-read.json", {
  readAt: new Date().toISOString(),
  generationFreezeHash: hashFile(path.join(output, "generation-freeze.json")),
  dataset: "development-known",
  priorDeveloperExposure: true,
});
const goldHash = hashFile(gold),
  reference = parseAss(
    normalizeC601GoldAssTimestamps(fs.readFileSync(gold, "utf8")).content,
  ).map((c, i) => ({ ...c, id: `reference-${i}` }));
const metrics = {},
  cues = {};
for (const v of variants) {
  const pkg = read(
      path.join(output, "run-a", v, "subtitle-package.needs-review.json"),
    ),
    formats = {};
  for (const [ext, parse] of Object.entries({
    ass: parseAss,
    srt: parseSrt,
    vtt: parseVtt,
  })) {
    const cs = parse(
      fs.readFileSync(
        path.join(output, "run-a", v, "machine-candidate." + ext),
        "utf8",
      ),
    ).map((c, i) => ({
      ...c,
      id: pkg.cues[i].id,
      style: pkg.cues[i].style ?? "default",
    }));
    formats[ext] = evaluateQuality(cs, reference);
    if (ext === "srt") cues[v] = cs;
  }
  metrics[v] = {
    ...formats.srt,
    formats,
    presentationOverflowCues: cues[v].filter(
      (c) =>
        c.text.split("\n").length > 2 ||
        c.text.split("\n").some((l) => Array.from(l).length > 16),
    ).length,
  };
}
const base = variants[0],
  main = variants[2],
  targetId = plan.target.cueId;
for (const v of variants) {
  for (const key of ["exact", "normalized"])
    if (objectHash(metrics[v][key]) !== objectHash(metrics[base][key]))
      throw Error("END_ONLY_TEXT_METRIC_CHANGED");
  if (
    objectHash(cues[v].map((c) => [c.id, c.start, c.text])) !==
    objectHash(cues[base].map((c) => [c.id, c.start, c.text]))
  )
    throw Error("NON_END_EVALUATION_DRIFT");
}
const fixed = metrics[base].matches
  .filter((m) => m.timingEligible)
  .map((m) => {
    const rs = reference.filter((r) => m.referenceIds.includes(r.id));
    const a = Math.min(...rs.map((r) => r.start)),
      b = Math.max(...rs.map((r) => r.end));
    return {
      hypothesisIds: m.hypothesisIds,
      referenceIds: m.referenceIds,
      confirmedGainEligible: !m.hypothesisIds.includes(targetId),
      variants: Object.fromEntries(
        variants.map((v) => {
          const cs = cues[v].filter((c) => m.hypothesisIds.includes(c.id)),
            s = Math.min(...cs.map((c) => c.start)),
            e = Math.max(...cs.map((c) => c.end));
          return [
            v,
            {
              endError: Math.abs(e - b),
              startError: Math.abs(s - a),
              iou:
                Math.max(0, Math.min(e, b) - Math.max(s, a)) /
                (Math.max(e, b) - Math.min(s, a)),
            },
          ];
        }),
      ),
    };
  });
const summary = (rows) =>
  Object.fromEntries(
    variants.map((v) => [
      v,
      {
        groups: rows.length,
        endMAE: rows.length
          ? rows.reduce((s, r) => s + r.variants[v].endError, 0) / rows.length
          : null,
        meanIoU: rows.length
          ? rows.reduce((s, r) => s + r.variants[v].iou, 0) / rows.length
          : null,
      },
    ]),
  );
const fixedTarget = fixed.find((m) => m.hypothesisIds.includes(targetId)),
  index = cues[base].findIndex((c) => c.id === targetId),
  target = cues[base][index];
const env = plan.requests.find((r) => r.windowId === "W+4").window;
const idIndex = new Map(reference.map((c, i) => [c.id, i]));
const prev = metrics[base].matches.filter(
  (m) =>
    m.timingEligible &&
    !m.hypothesisIds.includes(targetId) &&
    m.hypothesisIds.some(
      (id) => cues[base].findIndex((c) => c.id === id) < index,
    ),
);
const next = metrics[base].matches.filter(
  (m) =>
    m.timingEligible &&
    !m.hypothesisIds.includes(targetId) &&
    m.hypothesisIds.some(
      (id) => cues[base].findIndex((c) => c.id === id) > index,
    ),
);
const lower = Math.max(
  -1,
  ...prev.flatMap((m) => m.referenceIds.map((id) => idIndex.get(id))),
);
const upper = Math.min(
  reference.length,
  ...next.flatMap((m) => m.referenceIds.map((id) => idIndex.get(id))),
);
function distance(a, b) {
  let d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const n = [i + 1];
    for (let j = 0; j < b.length; j++)
      n.push(Math.min(n[j] + 1, d[j + 1] + 1, d[j] + (a[i] === b[j] ? 0 : 1)));
    d = n;
  }
  return d[b.length];
}
const alternatives = [];
const tt = Array.from(qualityText(target.text));
for (let i = 0; i < reference.length; i++)
  for (let n = 1; n <= 3 && i + n <= reference.length; n++) {
    const rows = reference.slice(i, i + n);
    if (!rows.some((r) => r.end > env.start && r.start < env.end)) continue;
    const text = qualityText(rows.map((r) => r.text).join("")),
      rt = Array.from(text),
      similarity = 1 - distance(tt, rt) / Math.max(1, tt.length, rt.length),
      contained = text.includes(tt.join("")) || tt.join("").includes(text);
    if (similarity < 0.25 && !contained) continue;
    const start = rows[0].start,
      end = rows.at(-1).end;
    alternatives.push({
      referenceIds: rows.map((r) => r.id),
      text,
      similarity,
      contained,
      start,
      end,
      orderCompatible: i > lower && i + n - 1 < upper,
      errors: Object.fromEntries(
        variants.map((v) => {
          const c = cues[v].find((c) => c.id === targetId);
          return [
            v,
            {
              endError: Math.abs(c.end - end),
              startError: Math.abs(c.start - start),
              iou:
                Math.max(0, Math.min(c.end, end) - Math.max(c.start, start)) /
                (Math.max(c.end, end) - Math.min(c.start, start)),
            },
          ];
        }),
      ),
    });
  }
write(output, "evaluation/target-ambiguity.json", {
  policy: plan.evaluationPolicy,
  status: "REFERENCE_OCCURRENCE_UNRESOLVED",
  formalBinding: fixedTarget ?? null,
  orderConstraints: {
    exclusivePreviousIndex: lower,
    exclusiveNextIndex: upper,
  },
  alternatives,
  sensitivity: Object.fromEntries(
    variants.map((v) => {
      const es = alternatives
        .filter((a) => a.orderCompatible)
        .map((a) => a.errors[v].endError);
      return [
        v,
        {
          minimumEndError: es.length ? Math.min(...es) : null,
          maximumEndError: es.length ? Math.max(...es) : null,
        },
      ];
    }),
  ),
  enumerationScope:
    "bounded adjacent 1-3 cue spans with spelling/partial/merge variants; not exhaustive linguistic or acoustic occurrence identification",
  targetExcludedFromConfirmedGain: true,
  audioConfirmed: false,
  listener: null,
});
const changed = read(path.join(output, "run-a", main, "mutation-journal.json"))
  .changes.length;
const gate =
  changed === 0 ? "GUARD_ONLY_NO_QUALITY_GAIN" : "OCCURRENCE_AMBIGUITY_HOLD";
write(output, "evaluation/metrics.json", {
  metrics,
  fixedSupport: {
    bindingSource: "I0_ONLY_NO_REMATCH",
    all: summary(fixed),
    confirmedNonTarget: summary(fixed.filter((r) => r.confirmedGainEligible)),
    comparison: fixed,
  },
  goldHash,
  gate,
  actualEndChanges: changed,
  textPreserved: true,
  audioConfirmed: false,
  listener: null,
  heldout: "HELDOUT_VALIDATION_NOT_RUN",
  defaultPromotionAuthorized: false,
});
write(
  output,
  "evaluation/changes.md",
  `# Evaluation\n\n${gate}. Actual end changes: ${changed}. Formal evaluator unchanged; fixed I0 bindings retained. Target reference occurrence remains unresolved and is excluded from confirmed gain. No listening or held-out validation.\n`,
);
if (hashFile(gold) !== goldHash) throw Error("REFERENCE_CHANGED");
console.log(
  JSON.stringify({
    gate,
    changed,
    referenceAlternatives: alternatives.length,
    orderedAlternatives: alternatives.filter((a) => a.orderCompatible).length,
  }),
);
