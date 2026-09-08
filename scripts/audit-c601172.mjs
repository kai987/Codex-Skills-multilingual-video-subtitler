// Post-score diagnostics only. No generation, scoring, selection, or mutation.
import fs from "node:fs";
import path from "node:path";
import { read, write, oh, verify } from "./c60117-common.mjs";
const root = path.resolve(process.argv[2]);
for (const f of [
  "run-a-freeze.json",
  "run-b-freeze.json",
  "evaluation-freeze.json",
])
  verify(root, f);
const rows = ["D1", "C1"].flatMap(
  (p) => read(path.join(root, "evaluation", p + ".json")).rows,
);
function lineage(unit, variant) {
  const folder = path.join(root, "run-a", unit, variant);
  const cues = read(
    path.join(folder, "subtitle-package.needs-review.json"),
  ).cues;
  const ts = read(path.join(folder, "stage-trace.json"));
  if (!ts.length) return new Map(cues.map((c) => [c.id, [c.id]]));
  let map = new Map(ts[0].output.map((c) => [c.id, [c.id]]));
  for (const t of ts.slice(1)) {
    const next = new Map();
    for (const c of t.output) {
      const inputs = t.operations
        .filter((o) => o.correspondingOutput.some((x) => x.id === c.id))
        .map((o) => o.affectedInput.id);
      next.set(
        c.id,
        [...new Set(inputs.flatMap((id) => map.get(id) ?? []))].sort(),
      );
    }
    map = next;
  }
  return map;
}
const diagnostic = rows.map((r) => {
  const maps = Object.fromEntries(
    Object.keys(r.byVariant).map((v) => [v, lineage(r.id, v)]),
  );
  const key = (g, v) =>
    oh({
      references: [...g.referenceIds].sort(),
      sources: [
        ...new Set(g.hypothesisIds.flatMap((id) => maps[v].get(id) ?? [])),
      ].sort(),
    });
  const comparisons = Object.fromEntries(
    ["P0-primary-minimal", "G10-cross-guard", "G00-legacy"].map((v) => {
      const old = r.byVariant[v].matches.filter((g) => g.timingEligible),
        next = r.byVariant["G11-composed"].matches.filter(
          (g) => g.timingEligible,
        );
      const pairs = old.flatMap((g) => {
        const k = key(g, v),
          candidates = next.filter((q) => key(q, "G11-composed") === k);
        if (
          candidates.length !== 1 ||
          old.filter((q) => key(q, v) === k).length !== 1
        )
          return [];
        const q = candidates[0];
        return [
          {
            referenceIds: g.referenceIds,
            sourceIds: [
              ...new Set(
                g.hypothesisIds.flatMap((id) => maps[v].get(id) ?? []),
              ),
            ],
            beforeOutputIds: g.hypothesisIds,
            afterOutputIds: q.hypothesisIds,
            startErrorDelta: q.startError - g.startError,
            endErrorDelta: q.endError - g.endError,
          },
        ];
      });
      return [
        v,
        {
          beforeGroups: old.length,
          afterGroups: next.length,
          uniqueLineageBoundPairs: pairs,
          beforeUnpaired: old.length - pairs.length,
          afterUnpaired: next.length - pairs.length,
          caveat:
            "same reference/source ancestry is not independent acoustic truth; duplicate ancestry matches are left unpaired",
        },
      ];
    }),
  );
  const input = read(path.join(root, "generator-input", r.id + ".json"));
  const exportDiff = read(
    path.join(root, "run-a", r.id, "export-diff.json"),
  ).G11vsG10;
  const scored = read(path.join(root, "evaluation/mutations", r.id + ".json"));
  if (
    oh(exportDiff.added) !== oh(scored.added) ||
    oh(exportDiff.removed) !== oh(scored.removed) ||
    oh(exportDiff.modified) !== oh(scored.modified)
  )
    throw Error("PRE_SCORE_EXPORT_DIFF_MISMATCH");
  const formatByteEqualToG10 = Object.fromEntries(
    ["ass", "srt", "vtt"].map((ext) => [
      ext,
      fs
        .readFileSync(
          path.join(
            root,
            "run-a",
            r.id,
            "G10-cross-guard",
            "machine-candidate." + ext,
          ),
        )
        .equals(
          fs.readFileSync(
            path.join(
              root,
              "run-a",
              r.id,
              "G11-composed",
              "machine-candidate." + ext,
            ),
          ),
        ),
    ]),
  );
  return {
    id: r.id,
    partition: r.partition,
    comparisons,
    formatByteEqualToG10,
    repeatedInputRequestImports:
      input.primaryRequests.length -
      new Set(input.primaryRequests.map((q) => q.id)).size,
    duplicateFinalCueIds: Object.fromEntries(
      Object.keys(r.byVariant).map((v) => {
        const cs = read(
          path.join(
            root,
            "run-a",
            r.id,
            v,
            "subtitle-package.needs-review.json",
          ),
        ).cues;
        return [v, cs.length - new Set(cs.map((c) => c.id)).size];
      }),
    ),
    missingLineage: Object.fromEntries(
      Object.entries(maps).map(([v, map]) => [
        v,
        [...map].filter(([, ids]) => !ids.length).map(([id]) => id),
      ]),
    ),
    preScoreExportDiffVerified: true,
  };
});
write(path.join(root, "supplemental-lineage-audit.json"), {
  createdAt: new Date().toISOString(),
  scope:
    "post-score ancestry/byte diagnostics; evaluator and frozen matrix unchanged",
  directIdSupportLimitation:
    "P0 and assembled cue IDs use different namespaces; zero direct-ID pairs are not evidence of all timing changing.",
  rows: diagnostic,
});
console.log(
  JSON.stringify(
    diagnostic.map((r) => ({
      id: r.id,
      byteEqual: r.formatByteEqualToG10,
      missingLineage: r.missingLineage,
      comparisons: Object.fromEntries(
        Object.entries(r.comparisons).map(([v, c]) => [
          v,
          {
            paired: c.uniqueLineageBoundPairs.length,
            beforeUnpaired: c.beforeUnpaired,
            afterUnpaired: c.afterUnpaired,
            changed: c.uniqueLineageBoundPairs.filter(
              (p) => p.startErrorDelta !== 0 || p.endErrorDelta !== 0,
            ),
          },
        ]),
      ),
    })),
    null,
    2,
  ),
);
