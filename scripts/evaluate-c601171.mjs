// Evaluator only: this process is never loaded by model or generation workers.
import fs from "node:fs";
import path from "node:path";
import {
  parseAss,
  parseSrt,
  parseVtt,
} from "../packages/subtitle-core/dist/index.js";
import { evaluateQuality } from "../packages/video-subtitler/dist/machine-quality/experimental-metrics.js";
import { aggregateTextMetrics } from "../packages/video-subtitler/dist/machine-quality/representative-evaluation.js";
import { closure } from "../packages/video-subtitler/dist/machine-quality/reference-complete.js";
import {
  read,
  write,
  oh,
  hash,
  verify,
  freeze,
  walk,
} from "./c60117-common.mjs";
const [rootArg] = process.argv.slice(2),
  root = path.resolve(rootArg);
const variants = [
  "P0-primary-minimal",
  "P1-current-matched",
  "P2-frozen-overlap-required",
  "P2-repair-disabled",
];
verify(root, "run-a-freeze.json");
verify(root, "run-b-freeze.json");
verify(root, "dataset-freeze.json");
verify(root, "evidence-freeze.json");
const gf = read(path.join(root, "generation-freeze.json"));
if (
  gf.runAHash !== (await hash(path.join(root, "run-a-freeze.json"))) ||
  gf.runBHash !== (await hash(path.join(root, "run-b-freeze.json")))
)
  throw Error("Generation freeze mismatch");
write(path.join(root, "evaluation-once.json"), {
  evaluationReferenceFirstRead: new Date().toISOString(),
  generationFreeze: gf.frozenAt,
});
const reference = read(
  path.join(root, "dataset/evaluation-only/reference-manifest.json"),
);
const rows = [];
for (const u of reference.units) {
  const scope = closure(u, reference.fullReference);
  if (!scope.complete || oh(scope.included) !== oh(u.reference))
    throw Error("REFERENCE_SCOPE_INVALID");
  const localReference = u.reference.map((c) => ({
      ...c,
      start: c.start - u.start,
      end: c.end - u.start,
    })),
    byVariant = {},
    cuesByVariant = {};
  for (const v of variants) {
    const folder = path.join(root, "run-a", u.id, v),
      pkg = read(path.join(folder, "subtitle-package.needs-review.json")),
      formats = {};
    for (const [ext, parser] of Object.entries({
      ass: parseAss,
      srt: parseSrt,
      vtt: parseVtt,
    })) {
      const file = path.join(folder, "machine-candidate." + ext),
        cues = parser(fs.readFileSync(file, "utf8")).map((c, i) => ({
          ...c,
          id: pkg.cues[i].id,
        }));
      formats[ext] = evaluateQuality(cues, localReference);
      if (ext === "srt") cuesByVariant[v] = cues;
    }
    byVariant[v] = { ...formats.srt, formats, cueCount: pkg.cues.length };
  }
  const p1 = byVariant[variants[1]],
    p2 = byVariant[variants[2]],
    p0 = byVariant[variants[0]];
  const distance = (m) => m.S + m.D + m.I;
  const before = cuesByVariant[variants[1]],
    after = cuesByVariant[variants[2]];
  const sameSupport = p1.matches
    .filter((g) => g.timingEligible)
    .flatMap((g) => {
      const q = p2.matches.find(
        (q) =>
          q.timingEligible &&
          oh(q.referenceIds) === oh(g.referenceIds) &&
          oh(q.hypothesisIds) === oh(g.hypothesisIds),
      );
      return q
        ? [
            {
              referenceIds: g.referenceIds,
              hypothesisIds: g.hypothesisIds,
              startDelta: q.startError - g.startError,
              endDelta: q.endError - g.endError,
            },
          ]
        : [];
    });
  const delta = distance(p2.normalized) - distance(p1.normalized);
  rows.push({
    id: u.id,
    partition: u.partition,
    stratum: u.stratum,
    scope: { start: u.start, end: u.end },
    scoreScopeStatus: "REFERENCE_COMPLETE",
    textNormalizationModes: ["exact", "normalized"],
    referenceN: u.normalizedN,
    byVariant,
    normalizedDistanceDeltaP2P1: delta,
    normalizedDistanceDeltaP2P0:
      distance(p2.normalized) - distance(p0.normalized),
    sameSupport,
    changedMatchingGroups: p2.timing.matchedGroups - sameSupport.length,
  });
  write(path.join(root, "evaluation/mutations", u.id + ".json"), {
    unitId: u.id,
    before,
    after,
    added: after.filter((c) => !before.some((b) => b.id === c.id)),
    removed: before.filter((c) => !after.some((a) => a.id === c.id)),
    modified: after.filter((c) =>
      before.some((b) => b.id === c.id && oh(b) !== oh(c)),
    ),
    trigger:
      "frozen deduplicateTopScoreWinners requireTemporalOverlap=true; <=0.1s non-lyrics duplicate retained",
    sourceEvidence: "../../generator-input/" + u.id + ".json",
    stageTrace:
      "../../run-a/" + u.id + "/P2-frozen-overlap-required/stage-trace.json",
    referenceRelativeDistanceDelta: delta,
    acousticallyVerified: false,
    sameSupport,
  });
}
const summaries = {};
for (const p of ["D1", "C1"]) {
  const rr = rows.filter((r) => r.partition === p),
    aggregates = {};
  for (const v of variants) {
    const agg = (rs) =>
      Object.fromEntries(
        ["exact", "normalized"].map((k) => [
          k,
          aggregateTextMetrics(rs.map((r) => r.byVariant[v][k])),
        ]),
      );
    aggregates[v] = {
      ...agg(rr),
      strata: Object.fromEntries(
        ["coverage", "machine-risk", "low-risk"].map((s) => [
          s,
          agg(rr.filter((r) => r.stratum === s)),
        ]),
      ),
    };
  }
  const a = aggregates[variants[0]],
    b = aggregates[variants[1]],
    c = aggregates[variants[2]],
    benefits = rr.filter((r) => r.normalizedDistanceDeltaP2P1 < 0).length;
  const regressions = rr.filter(
    (r) => r.normalizedDistanceDeltaP2P1 > 0,
  ).length;
  const tradeoffs = rr.filter(
    (r) =>
      ["S", "D", "I"].some(
        (k) =>
          r.byVariant[variants[2]].normalized[k] >
          r.byVariant[variants[1]].normalized[k],
      ) ||
      r.byVariant[variants[2]].exact.CER > r.byVariant[variants[1]].exact.CER ||
      r.sameSupport.some((g) => g.startDelta !== 0 || g.endDelta !== 0),
  );
  const status = regressions
    ? "QUALITY_REGRESSION_HOLD"
    : tradeoffs.length
      ? "QUALITY_TRADEOFF_HOLD"
      : c.normalized.microCER >= b.normalized.microCER
        ? "ENGINEERING_PASS_NO_QUALITY_GAIN"
        : benefits < 2
          ? "LOCAL_CASE_GAIN_ONLY"
          : c.normalized.microCER > a.normalized.microCER
            ? "PARTIAL_RECOVERY_STILL_WORSE_THAN_MINIMAL"
            : "FIXED_POLICY_GAIN_ON_REFERENCE_COMPLETE_UNITS";
  summaries[p] = {
    partition: p,
    claim:
      p === "D1"
        ? "KNOWN_SAMPLE_REMEASUREMENT_ONLY"
        : "SAME_EPISODE_FIXED_POLICY_CHECK",
    status,
    beneficialUnits: benefits,
    regressedUnits: regressions,
    tradeoffUnits: tradeoffs.map((r) => r.id),
    seconds: rr.reduce((n, r) => n + r.scope.end - r.scope.start, 0),
    aggregates,
    rows: rr,
  };
  write(
    path.join(
      root,
      "evaluation",
      p === "D1" ? "D1-remeasurement.json" : "C1-fixed-policy-check.json",
    ),
    summaries[p],
  );
}
write(path.join(root, "evaluation/H1-external-validation.json"), {
  status: "HELDOUT_VALIDATION_NOT_RUN",
  passed: null,
  reason: "No independently eligible second media/reference pair provided",
});
write(
  path.join(root, "evaluation/per-unit-comparison.csv"),
  "unit,partition,stratum,N,P0_distance,P1_distance,P2_distance,P2_minus_P1\n" +
    rows
      .map((r) =>
        [
          r.id,
          r.partition,
          r.stratum,
          r.referenceN,
          ...variants.slice(0, 3).map((v) => {
            const m = r.byVariant[v].normalized;
            return m.S + m.D + m.I;
          }),
          r.normalizedDistanceDeltaP2P1,
        ].join(","),
      )
      .join("\n") +
    "\n",
);
write(
  path.join(root, "evaluation/changes.md"),
  "# Frozen P2 comparison\n\n" +
    rows
      .map(
        (r) =>
          `- ${r.id} (${r.partition}/${r.stratum}): normalized edit-distance delta P2-P1 = ${r.normalizedDistanceDeltaP2P1}; P2-P0 = ${r.normalizedDistanceDeltaP2P0}.`,
      )
      .join("\n") +
    "\n\nReference-relative counts are not independently confirmed acoustic recovery or hallucination counts. No score-based reselection or retuning.\n",
);
freeze(root, "evaluation-freeze.json", walk(path.join(root, "evaluation")));
console.log(
  JSON.stringify(
    Object.fromEntries(
      Object.entries(summaries).map(([p, s]) => [
        p,
        {
          status: s.status,
          benefits: s.beneficialUnits,
          regressions: s.regressedUnits,
          tradeoffs: s.tradeoffUnits,
          metrics: Object.fromEntries(
            variants.map((v) => [v, s.aggregates[v].normalized]),
          ),
        },
      ]),
    ),
    null,
    2,
  ),
);
