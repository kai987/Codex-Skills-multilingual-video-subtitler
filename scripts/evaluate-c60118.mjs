// One-shot evaluator, after all model and replay output is frozen.
import fs from "node:fs";
import path from "node:path";
import {
  parseSrt,
  parseAss,
  parseVtt,
} from "../packages/subtitle-core/dist/index.js";
import { qualityText } from "../packages/video-subtitler/dist/machine-quality/experimental-metrics.js";
import { transcriptMetric } from "../packages/video-subtitler/dist/machine-quality/representative-evaluation.js";
import {
  compareCandidate,
  aggregateCandidates,
} from "../packages/video-subtitler/dist/machine-quality/same-unit-evaluation.js";
import { closure } from "../packages/video-subtitler/dist/machine-quality/reference-complete.js";
import {
  read,
  write,
  hash,
  oh,
  verify,
  freeze,
  walk,
} from "./c60117-common.mjs";
import { checkImplementation } from "./c60118-common.mjs";
const [rootArg, referenceArg] = process.argv.slice(2),
  root = path.resolve(rootArg);
for (const f of [
  "input-freeze.json",
  "model-input-freeze.json",
  "generation-freeze.json",
  "run-a-freeze.json",
  "run-b-freeze.json",
])
  verify(root, f);
checkImplementation(root);
const receipt = read(path.join(root, "input-receipt.local-only.json")),
  plan = read(path.join(root, "request-plan.json"));
write(path.join(root, "evaluation-once.json"), {
  firstReferenceFilesystemReadAt: new Date().toISOString(),
  generationFreezeAt: read(path.join(root, "generation-freeze.json")).frozenAt,
});
if ((await hash(referenceArg)) !== receipt.referenceManifestHash)
  throw Error("REFERENCE_HASH_MISMATCH");
const reference = read(referenceArg),
  rows = [];
if (
  oh(reference.units.map((u) => u.id).sort()) !==
  oh(plan.units.map((u) => u.id).sort())
)
  throw Error("UNIT_SET_MISMATCH");
for (const u of reference.units) {
  const machine = plan.units.find((x) => x.id === u.id),
    scope = closure(u, reference.fullReference);
  if (
    !scope.complete ||
    oh(scope.included) !== oh(u.reference) ||
    u.start !== machine.sourceOffset ||
    Math.abs(u.end - u.start - machine.seconds) > 1e-7
  )
    throw Error("REFERENCE_CLOSURE_INVALID");
  const folder = path.join(root, "run-a", u.id),
    w = read(path.join(folder, "W0-primary-transcript/transcript.json")),
    r = read(path.join(folder, "R0-second-asr-transcript/transcript.json"));
  const rt = u.reference.map((c) => c.text).join(""),
    formats = {};
  for (const [ext, parser] of Object.entries({
    srt: parseSrt,
    ass: parseAss,
    vtt: parseVtt,
  }))
    formats[ext] = parser(
      fs.readFileSync(
        path.join(folder, "W1-frozen-G11/machine-candidate." + ext),
        "utf8",
      ),
    )
      .map((c) => c.text)
      .join("");
  const modes = {};
  for (const mode of ["exact", "normalized"]) {
    const normalized = mode === "normalized",
      comparison = compareCandidate(w.text, r.text, rt, normalized);
    modes[mode] = {
      ...comparison,
      W1: transcriptMetric(formats.srt, rt, normalized),
      W1Formats: Object.fromEntries(
        Object.entries(formats).map(([ext, text]) => [
          ext,
          transcriptMetric(text, rt, normalized),
        ]),
      ),
      sourceText: {
        reference: qualityText(rt, normalized),
        W0: qualityText(w.text, normalized),
        W1: qualityText(formats.srt, normalized),
        R0: r.text === null ? null : qualityText(r.text, normalized),
      },
      outputCharacters: {
        W0: Array.from(qualityText(w.text, normalized)).length,
        W1: Array.from(qualityText(formats.srt, normalized)).length,
        R0:
          r.text === null
            ? null
            : Array.from(qualityText(r.text, normalized)).length,
      },
    };
  }
  if (modes.normalized.sourceText.W0 !== modes.normalized.sourceText.W1)
    throw Error("FROZEN_NORMALIZED_PARITY_LOST");
  rows.push({
    id: u.id,
    partition: u.partition,
    stratum: u.stratum,
    exposure: "KNOWN_DEVELOPMENT_RECHECK",
    responseStatus: r.status,
    rawResponseComplete: r.rawResponseComplete,
    timingStatus: r.timingStatus,
    modes,
  });
}
const summaries = {};
for (const p of ["D1", "C1"]) {
  const rr = rows.filter((r) => r.partition === p),
    old = read(path.join(receipt.baselineRoot, "evaluation", p + ".json"));
  summaries[p] = {};
  for (const mode of ["exact", "normalized"]) {
    const summary = aggregateCandidates(rr.map((r) => r.modes[mode]));
    if (summary.plannedN !== old.aggregates["P0-primary-minimal"][mode].N)
      throw Error("FROZEN_REFERENCE_DENOMINATOR_DRIFT");
    summaries[p][mode] = {
      ...summary,
      strata: Object.fromEntries(
        ["coverage", "machine-risk", "low-risk"].map((s) => [
          s,
          aggregateCandidates(
            rr.filter((r) => r.stratum === s).map((r) => r.modes[mode]),
          ),
        ]),
      ),
    };
  }
}
const total = Object.fromEntries(
  ["exact", "normalized"].map((mode) => [
    mode,
    aggregateCandidates(rows.map((r) => r.modes[mode])),
  ]),
);
const n = total.normalized,
  route =
    n.pairedUnits !== plan.units.length
      ? "PAIRED_EVALUATION_INCOMPLETE"
      : n.delta < 0 && n.improved > 1
        ? "SECOND_ASR_GAIN_ON_KNOWN_UNITS"
        : n.oracleGain > 0
          ? "SELECTIVE_COMPLEMENTARITY_ON_KNOWN_UNITS"
          : "NO_WHOLE_UNIT_GAIN_DEMONSTRATED";
const gains = rows.map((r) => ({
  id: r.id,
  gain:
    r.modes.normalized.second === null
      ? 0
      : Math.max(
          0,
          r.modes.normalized.primary.distance -
            r.modes.normalized.second.distance,
        ),
}));
write(path.join(root, "evaluation/candidate-gain.json"), {
  route,
  summaries,
  total,
  rows,
  gains,
  maximumUnitShareOfOracleGain: n.oracleGain
    ? Math.max(...gains.map((g) => g.gain)) / n.oracleGain
    : null,
  automaticCrossModelSelection: "NOT_IMPLEMENTED",
  finalSubtitleApplication: "NOT_IMPLEMENTED",
  HELDOUT_VALIDATION: "NOT_RUN",
});
write(path.join(root, "evaluation/whole-unit-oracle.json"), {
  definition: "sum(Ew)-sum(min(Ew,Er)) on identical successful paired units",
  total,
  summaries,
  warning:
    "Gold-conditioned diagnostic, not an implemented selector; no selected output exported",
});
write(
  path.join(root, "evaluation/per-unit-comparison.csv"),
  "unit,partition,stratum,mode,view,S,D,I,N,distance,CER,outputCharacters,status,category\n" +
    rows
      .flatMap((r) =>
        ["exact", "normalized"].flatMap((mode) =>
          ["W0", "W1", "R0"].map((view) => {
            const m = r.modes[mode],
              score =
                view === "W0" ? m.primary : view === "W1" ? m.W1 : m.second;
            return [
              r.id,
              r.partition,
              r.stratum,
              mode,
              view,
              score?.S,
              score?.D,
              score?.I,
              score?.N,
              score?.distance,
              score?.CER,
              m.outputCharacters[view],
              r.responseStatus,
              m.category,
            ].join(",");
          }),
        ),
      )
      .join("\n") +
    "\n",
);
write(
  path.join(root, "evaluation/changes.md"),
  "# Same-unit full-text comparison\n\n" +
    rows
      .map(
        (r) =>
          "- " +
          r.id +
          ": " +
          r.modes.normalized.category +
          "; R0-W0 edits=" +
          (r.modes.normalized.second === null
            ? "unavailable"
            : r.modes.normalized.second.distance -
              r.modes.normalized.primary.distance),
      )
      .join("\n") +
    "\n\n" +
    route +
    "\nKnown development units only. Reference insertions are not confirmed hallucinations; fewer deletions do not establish acoustic speech recovery. W1 exports are unchanged. R0 has no fine subtitle application.\n",
);
freeze(root, "evaluation-freeze.json", walk(path.join(root, "evaluation")));
console.log(JSON.stringify({ route, summaries, total }, null, 2));
