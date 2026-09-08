import path from "node:path";
import {
  read,
  write,
  oh,
  walk,
  freeze,
  verify,
  VARIANTS,
} from "./c60117-common.mjs";
const [rootArg, evalArg] = process.argv.slice(2),
  root = path.resolve(rootArg),
  evalRoot = path.resolve(evalArg);
verify(root, "final-code-config-freeze.json");
const dataset = read(path.join(root, "dataset-selection.json"));
const metrics = {
  D: read(path.join(evalRoot, "d-config1/metrics.json")),
  C: read(path.join(evalRoot, "c-final/metrics.json")),
};
const rows = [],
  index = [
    "# C6.0.1.17 local clip delivery",
    "",
    "All files are experimental clips: needs-review; finalizationMethod=none. No whole-episode completion or publication authority. Times in primary exports are source-global; mapping JSON supplies local offsets. D/C are development-known episode partitions, not independent unseen media.",
    "",
    "P2 uses one opt-in deduplication overlap guard. Actual measured changes and boundary uncertainty are listed below. AUX Reazon is untimed text only.",
    "",
    "| Partition / stratum | Source seconds | P2 ASS / SRT / VTT | Text changed vs P1 | Precise scope |",
    "| --- | --- | --- | --- | --- |",
  ];
const q = (v) => '"' + String(v).replaceAll('"', '""') + '"';
const csv = [
  "partition,stratum,clip_id,precise,variant,S,D,I,N,distance,CER,cues,start_MAE,end_MAE,P95,IoU",
];
for (const c of dataset.clips) {
  const run = c.partition.toLowerCase() + "-final-a",
    folder = path.join(root, run, c.id);
  const before = read(
      path.join(folder, VARIANTS[1], "subtitle-package.needs-review.json"),
    ).cues,
    after = read(
      path.join(folder, VARIANTS[2], "subtitle-package.needs-review.json"),
    ).cues;
  const metric = metrics[c.partition].rows.find((r) => r.clip.id === c.id);
  const textChanged =
    oh(before.map((c) => c.text)) !== oh(after.map((c) => c.text));
  const journal = {
    clipId: c.id,
    family: "occurrence-overlap-required",
    before,
    after,
    inputHash: oh(before),
    outputHash: oh(after),
    textChanged,
    timingOrStructureChanged:
      oh(before.map((c) => [c.start, c.end])) !==
      oh(after.map((c) => [c.start, c.end])),
    stageTrace: path.relative(
      root,
      path.join(folder, VARIANTS[2], "stage-trace.json"),
    ),
    referenceNotUsedByGeneration: true,
  };
  write(path.join(root, "delivery", c.id, "mutation-journal.json"), journal);
  write(path.join(root, "delivery", c.id, "time-map.json"), {
    sourceInterval: { start: c.start, end: c.end },
    originalAudioSampleRate: 16000,
    mapping: "sourceGlobalSeconds = clipLocalSeconds + sourceInterval.start",
    cues: after.map((v) => ({
      id: v.id,
      sourceGlobal: { start: v.start, end: v.end },
      clipLocal: { start: v.start - c.start, end: v.end - c.start },
    })),
  });
  rows.push({
    clipId: c.id,
    partition: c.partition,
    stratum: c.stratum,
    textChanged,
    timingOrStructureChanged: journal.timingOrStructureChanged,
    preciseEligible: metric.preciseEligible,
    p1: metric.byVariant[VARIANTS[1]].normalized,
    p2: metric.byVariant[VARIANTS[2]].normalized,
    causes: metric.causes,
  });
  const links = ["ass", "srt", "vtt"]
    .map(
      (e) =>
        `[${e.toUpperCase()}](${run}/${c.id}/${VARIANTS[2]}/machine-candidate.${e})`,
    )
    .join(" / ");
  index.push(
    `| ${c.partition} / ${c.stratum} | ${c.start.toFixed(3)}–${c.end.toFixed(3)} | ${links} | ${textChanged} | ${metric.preciseEligible} |`,
  );
  for (const v of VARIANTS) {
    const m = metric.byVariant[v];
    csv.push(
      [
        c.partition,
        c.stratum,
        c.id,
        metric.preciseEligible,
        v,
        m.normalized.S,
        m.normalized.D,
        m.normalized.I,
        m.normalized.N,
        m.normalized.distance,
        m.normalized.CER,
        m.cueCount,
        m.timing.startMAE,
        m.timing.endMAE,
        m.timing.boundaryP95,
        m.timing.meanIoU,
      ]
        .map(q)
        .join(","),
    );
  }
}
write(
  path.join(root, "delivery/per-region-comparison.csv"),
  csv.join("\n") + "\n",
);
write(path.join(root, "delivery/changes.json"), rows);
write(path.join(root, "delivery/heldout-metrics.json"), {
  status: "HELDOUT_VALIDATION_NOT_RUN",
  reason: "No separate eligible media/reference pair supplied",
  passed: null,
});
write(
  path.join(root, "delivery/error-family-summary.json"),
  Object.fromEntries(
    ["D", "C"].map((p) => [
      p,
      Object.fromEntries(
        [
          ...new Set(
            rows
              .filter((r) => r.partition === p)
              .flatMap((r) => r.causes.map((c) => c.tag)),
          ),
        ].map((tag) => [
          tag,
          rows.filter(
            (r) => r.partition === p && r.causes.some((c) => c.tag === tag),
          ).length,
        ]),
      ),
    ]),
  ),
);
index.push(
  "",
  "## Evidence and limits",
  "",
  "- [Validation](validation.json), [changes](delivery/changes.json), [per-region metrics](delivery/per-region-comparison.csv), [selection](dataset-selection.json), [budget and model identity](evidence-plan.json).",
  `- Full D/C metrics and private reference scopes are in the separate folder ${path.relative(root, evalRoot)}. Reference copies are evaluation-only, not runtime input.`,
  `- D ambiguous/empty clips: ${metrics.D.ambiguousOrEmptyClips}; C: ${metrics.C.ambiguousOrEmptyClips}. Approximate whole-clip metrics do not establish precise quality gains.`,
  "- Model weights are not delivery content. The hidden audio/.models-no-coreml entry is a runtime link, not a redistributable copied model.",
  "- Earlier failed preparation folders and d-baseline-preflight-failed are retained for audit; they performed zero ASR.",
);
write(path.join(root, "OUTPUT_INDEX.md"), index.join("\n") + "\n");
write(path.join(root, "experiment-manifest.json"), {
  version: "c60117-manifest-v1",
  datasetHash: oh(dataset),
  selectedConfig: read(path.join(root, "selected-config.json")),
  variants: VARIANTS,
  outputs: rows,
  validation: read(path.join(root, "validation.json")),
  status: "needs-review",
  finalizationMethod: "none",
  humanValidated: false,
  machineOnlyReleaseAuthorized: false,
  defaultPromotionAuthorized: false,
});
freeze(root, "delivery-freeze.json", [
  ...walk(path.join(root, "delivery")),
  path.join(root, "OUTPUT_INDEX.md"),
  path.join(root, "experiment-manifest.json"),
]);
console.log("DELIVERY WRITTEN: " + rows.length + " clips");
