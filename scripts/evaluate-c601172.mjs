// Evaluation-only entry. Sealed reference is never a generation argument.
import fs from "node:fs";
import path from "node:path";
import {
  parseAss,
  parseSrt,
  parseVtt,
} from "../packages/subtitle-core/dist/index.js";
import {
  evaluateQuality,
  qualityText,
} from "../packages/video-subtitler/dist/machine-quality/experimental-metrics.js";
import { aggregateTextMetrics } from "../packages/video-subtitler/dist/machine-quality/representative-evaluation.js";
import { closure } from "../packages/video-subtitler/dist/machine-quality/reference-complete.js";
import {
  factorialEffects,
  primarySequenceStatus,
  actualExportDiff,
} from "../packages/video-subtitler/dist/machine-quality/composed-evaluation.js";
import { COMPOSED_MATRIX } from "../packages/video-subtitler/dist/machine-quality/composed-profile.js";
import { detectIntraCueHypothesisRepetition } from "../packages/transcription-core/dist/intra-cue-repetition.js";
import {
  read,
  write,
  oh,
  hash,
  verify,
  freeze,
  walk,
} from "./c60117-common.mjs";
const [rootArg, referenceArg] = process.argv.slice(2),
  root = path.resolve(rootArg);
for (const f of [
  "input-freeze.json",
  "generation-freeze.json",
  "run-a-freeze.json",
  "run-b-freeze.json",
])
  verify(root, f);
if (!read(path.join(root, "baseline-parity.json")).passed)
  throw Error("BASELINE_REPLAY_MISMATCH");
const receipt = read(path.join(root, "input-receipt.local-only.json"));
// Check the exact previously sealed manifest, not an interchangeable reference.
const oldFreeze = read(path.join(receipt.oldRoot, "dataset-freeze.json"));
if (
  (await hash(path.join(receipt.oldRoot, "dataset-freeze.json"))) !==
  receipt.oldFreezes["dataset-freeze.json"]
)
  throw Error("OLD_FREEZE_DRIFT");
write(path.join(root, "evaluation-once.json"), {
  firstReferenceFilesystemReadAt: new Date().toISOString(),
  generationFreezeAt: read(path.join(root, "generation-freeze.json")).frozenAt,
});
if (
  (await hash(referenceArg)) !==
  oldFreeze.files["dataset/evaluation-only/reference-manifest.json"]
)
  throw Error("REFERENCE_HASH_MISMATCH");
const ref = read(referenceArg),
  variants = COMPOSED_MATRIX.map((p) => p.id),
  rows = [];
if (
  ref.units.length !== 12 ||
  oh(ref.units.map((u) => u.id).sort()) !==
    oh(receipt.credentials.map((u) => u.id).sort())
)
  throw Error("UNIT_SET_MISMATCH");
const distance = (m) => m.S + m.D + m.I;
const sequence = (cs, normal = true) =>
  cs.map((c) => qualityText(c.text, normal)).join("");
const mean = (xs) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const p95 = (xs) =>
  xs.length ? xs.sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1] : null;
for (const u of ref.units) {
  const scope = closure(u, ref.fullReference);
  const machine = receipt.credentials.find((c) => c.id === u.id);
  if (
    !scope.complete ||
    oh(scope.included) !== oh(u.reference) ||
    u.start !== machine.sourceOffset ||
    Math.abs(u.end - u.start - machine.seconds) > 1e-7
  )
    throw Error("REFERENCE_CLOSURE_OR_OFFSET_INVALID");
  const reference = u.reference.map((c) => ({
    ...c,
    start: c.start - u.start,
    end: c.end - u.start,
  }));
  const views = {},
    cues = {};
  for (const v of variants) {
    const folder = path.join(root, "run-a", u.id, v),
      pkg = read(path.join(folder, "subtitle-package.needs-review.json")),
      formats = {};
    for (const [ext, parser] of Object.entries({
      ass: parseAss,
      srt: parseSrt,
      vtt: parseVtt,
    })) {
      const cs = parser(
        fs.readFileSync(path.join(folder, "machine-candidate." + ext), "utf8"),
      ).map((c, i) => ({ ...c, id: pkg.cues[i].id }));
      formats[ext] = evaluateQuality(cs, reference);
      if (ext === "srt") cues[v] = cs;
    }
    const cs = cues[v],
      trace = read(path.join(folder, "stage-trace.json"));
    views[v] = {
      ...formats.srt,
      formats,
      normalizedSequenceHash: oh(sequence(cs)),
      exactSequenceHash: oh(sequence(cs, false)),
      presentation: {
        lineOverflow: cs
          .flatMap((c) => c.text.split("\n"))
          .filter((l) => Array.from(l).length > 16).length,
        overTwoLines: cs.filter((c) => c.text.split("\n").length > 2).length,
        empty: cs.filter((c) => !c.text.trim()).length,
        invalidDuration: cs.filter((c) => c.start < 0 || c.end <= c.start)
          .length,
        adjacentEqual: cs.filter(
          (c, i) =>
            i > 0 && qualityText(c.text) === qualityText(cs[i - 1].text),
        ).length,
        intraCueRepetition: cs.filter(
          (c) =>
            detectIntraCueHypothesisRepetition({ cue: c, sourceCues: cs }) !==
            null,
        ).length,
      },
      sourceLedger: {
        inputRequests: machine.id,
        acousticTruth: "UNKNOWN",
        qualification: "source-preservation-is-not-acoustic-confirmation",
        stages: trace.map((t) => ({
          stage: t.stageName,
          inputHash: t.inputHash,
          outputHash: t.outputHash,
          occurrences: t.occurrenceIds,
          operationCounts: Object.fromEntries(
            [...new Set(t.operations.map((o) => o.operation))].map((op) => [
              op,
              t.operations.filter((o) => o.operation === op).length,
            ]),
          ),
          missingRequestLineage: t.operations.filter(
            (o) => !o.sourceRequestIds.length,
          ).length,
          lineageCaveat:
            "Missing direct request IDs remain uncertain; follow exact source bindings in preceding stage, never Gold.",
          stageCountsAreNotExportDiff: true,
        })),
        intraEvidence: trace[2]?.evidence ?? null,
      },
    };
  }
  const p0 = views[variants[0]],
    g10 = views[variants[2]],
    g11 = views[variants[4]];
  const effects = Object.fromEntries(
    ["exact", "normalized"].map((mode) => [
      mode,
      factorialEffects(
        Object.fromEntries(
          ["P0", "E00", "E10", "E01", "E11"].map((k, i) => [
            k,
            distance(views[variants[i]][mode]),
          ]),
        ),
      ),
    ]),
  );
  const support = (a, b) => {
    const before = views[a].matches.filter((g) => g.timingEligible),
      after = views[b].matches.filter((g) => g.timingEligible);
    const fixed = before.flatMap((g) => {
      const q = after.find(
        (q) =>
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
    return {
      beforeGroups: before.length,
      afterGroups: after.length,
      fixed,
      changedBefore: before.length - fixed.length,
      changedAfter: after.length - fixed.length,
      acousticImprovementClaim: false,
    };
  };
  rows.push({
    id: u.id,
    partition: u.partition,
    stratum: u.stratum,
    exposure: "KNOWN_DEVELOPMENT_RECHECK",
    scoreScopeStatus: "REFERENCE_COMPLETE",
    scope: { start: u.start, end: u.end },
    byVariant: views,
    effects,
    primaryParity: {
      status: primarySequenceStatus(
        sequence(cues[variants[0]]),
        sequence(cues[variants[4]]),
        distance(p0.normalized),
        distance(g11.normalized),
      ),
      normalizedSequenceEqual:
        sequence(cues[variants[0]]) === sequence(cues[variants[4]]),
      exactSequenceEqual:
        sequence(cues[variants[0]], false) ===
        sequence(cues[variants[4]], false),
      normalizedCERNonDegradation:
        distance(g11.normalized) <= distance(p0.normalized),
      exactCERNonDegradation: distance(g11.exact) <= distance(p0.exact),
    },
    fixedSupportVsG10: support(variants[2], variants[4]),
    fixedSupportVsP0: support(variants[0], variants[4]),
  });
  write(path.join(root, "evaluation/mutations", u.id + ".json"), {
    unit: u.id,
    ...actualExportDiff(cues[variants[2]], cues[variants[4]]),
    beforeNormalizedHash: g10.normalizedSequenceHash,
    afterNormalizedHash: g11.normalizedSequenceHash,
    source: "../../generator-input/" + u.id + ".json",
    stageTrace: "../../run-a/" + u.id + "/G11-composed/stage-trace.json",
    acousticTruth: "UNKNOWN",
  });
}
const summaries = {};
for (const p of ["D1", "C1"]) {
  const rr = rows.filter((r) => r.partition === p);
  const aggregates = Object.fromEntries(
    variants.map((v) => {
      const metrics = (rs) =>
        Object.fromEntries(
          ["exact", "normalized"].map((k) => [
            k,
            aggregateTextMetrics(rs.map((r) => r.byVariant[v][k])),
          ]),
        );
      const timed = rr.flatMap((r) =>
        r.byVariant[v].matches.filter((g) => g.timingEligible),
      );
      return [
        v,
        {
          ...metrics(rr),
          strata: Object.fromEntries(
            ["coverage", "machine-risk", "low-risk"].map((s) => [
              s,
              metrics(rr.filter((r) => r.stratum === s)),
            ]),
          ),
          timing: {
            matchedGroups: timed.length,
            matchedReferenceCues: timed.reduce(
              (n, g) => n + g.referenceIds.length,
              0,
            ),
            matchedOutputCues: timed.reduce(
              (n, g) => n + g.hypothesisIds.length,
              0,
            ),
            startMAE: mean(timed.map((g) => g.startError)),
            endMAE: mean(timed.map((g) => g.endError)),
            boundaryP95: p95(timed.flatMap((g) => [g.startError, g.endError])),
            meanIoU: mean(timed.map((g) => g.iou)),
            unmatchedReference: rr.reduce(
              (n, r) => n + r.byVariant[v].timing.unmatchedReferenceCues,
              0,
            ),
            unmatchedOutput: rr.reduce(
              (n, r) => n + r.byVariant[v].timing.unmatchedHypothesisCues,
              0,
            ),
            severeGroups: timed.filter(
              (g) => Math.max(g.startError, g.endError) > 2,
            ).length,
          },
          presentation: Object.fromEntries(
            Object.keys(rr[0].byVariant[v].presentation).map((k) => [
              k,
              rr.reduce((n, r) => n + r.byVariant[v].presentation[k], 0),
            ]),
          ),
          overlapPairs: rr.reduce(
            (n, r) => n + r.byVariant[v].structure.overlaps.length,
            0,
          ),
          cueCount: rr.reduce((n, r) => n + r.byVariant[v].cueCount, 0),
        },
      ];
    }),
  );
  if (
    rr.length !== 6 ||
    aggregates[variants[0]].normalized.N !== (p === "D1" ? 559 : 317)
  )
    throw Error("DENOMINATOR_IDENTITY_MISMATCH");
  summaries[p] = {
    exposure: "KNOWN_DEVELOPMENT_RECHECK",
    aggregates,
    factorialEffects: Object.fromEntries(
      ["exact", "normalized"].map((mode) => [
        mode,
        factorialEffects(
          Object.fromEntries(
            ["P0", "E00", "E10", "E01", "E11"].map((k, i) => [
              k,
              aggregates[variants[i]][mode].distance,
            ]),
          ),
        ),
      ]),
    ),
    beneficialVsG10: rr
      .filter((r) => r.effects.normalized.composedVsCurrent < 0)
      .map((r) => r.id),
    regressedVsG10: rr
      .filter((r) => r.effects.normalized.composedVsCurrent > 0)
      .map((r) => r.id),
    primaryParity: rr.map((r) => ({ id: r.id, ...r.primaryParity })),
    rows: rr,
  };
  write(path.join(root, "evaluation", p + ".json"), summaries[p]);
}
write(path.join(root, "evaluation/factorial-effects.json"), {
  interpretation:
    "deterministic matched-pipeline differences; not statistical interaction or acoustic causality",
  partitions: Object.fromEntries(
    Object.entries(summaries).map(([p, s]) => [p, s.factorialEffects]),
  ),
});
write(
  path.join(root, "evaluation/primary-text-parity.json"),
  rows.map((r) => ({ id: r.id, partition: r.partition, ...r.primaryParity })),
);
write(
  path.join(root, "evaluation/per-unit-metrics.csv"),
  "unit,partition,stratum,variant,mode,S,D,I,N,distance,CER,sequenceHash,cueCount\n" +
    rows
      .flatMap((r) =>
        variants.flatMap((v) =>
          ["exact", "normalized"].map((mode) => {
            const m = r.byVariant[v][mode];
            return [
              r.id,
              r.partition,
              r.stratum,
              v,
              mode,
              m.S,
              m.D,
              m.I,
              m.N,
              distance(m),
              m.CER,
              r.byVariant[v][mode + "SequenceHash"],
              r.byVariant[v].cueCount,
            ].join(",");
          }),
        ),
      )
      .join("\n") +
    "\n",
);
write(
  path.join(root, "evaluation/changes.md"),
  "# Fixed G11 comparison\n\n" +
    rows
      .map(
        (r) =>
          "- " +
          r.id +
          " (" +
          r.partition +
          "): normalized distance G11-G10=" +
          r.effects.normalized.composedVsCurrent +
          "; G11-P0=" +
          r.effects.normalized.composedVsMinimal +
          "; " +
          r.primaryParity.status,
      )
      .join("\n") +
    "\n\nKnown development only; no new acoustic evidence. Exact, timing, presentation and support denominators are reported separately in D1/C1 JSON. Insertions are reference-relative diagnostics, not confirmed hallucinations. No post-evaluation strategy selection.\n",
);
freeze(root, "evaluation-freeze.json", walk(path.join(root, "evaluation")));
console.log(
  JSON.stringify(
    Object.fromEntries(
      Object.entries(summaries).map(([p, s]) => [
        p,
        {
          aggregates: s.aggregates,
          effects: s.factorialEffects,
          benefits: s.beneficialVsG10,
          regressions: s.regressedVsG10,
        },
      ]),
    ),
    null,
    2,
  ),
);
