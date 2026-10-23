import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { subtitlePackageSchema } from "../packages/shared/dist/index.js";
import {
  parseAss,
  parseSrt,
  parseVtt,
} from "../packages/subtitle-core/dist/index.js";
import {
  read,
  write,
  oh,
  hash,
  repo,
  verify,
  walk,
  isolated,
} from "./c60117-common.mjs";
const [rootArg, oldRoot] = process.argv.slice(2),
  root = path.resolve(rootArg);
for (const name of [
  "model-input-freeze.json",
  "dataset-freeze.json",
  "evidence-freeze.json",
  "run-a-freeze.json",
  "run-b-freeze.json",
  "evaluation-freeze.json",
])
  verify(root, name);
const manifest = read(path.join(root, "dataset/generation-manifest.json")),
  ref = read(
    path.join(root, "dataset/evaluation-only/reference-manifest.json"),
  );
const gate = read(path.join(root, "dataset/model-gate.json"));
if (
  (await hash(path.join(root, "dataset/reference-complete-preflight.json"))) !==
  gate.preflightHash
)
  throw Error("Data gate mismatch");
execFileSync("diff", [
  "-qr",
  path.join(root, "run-a"),
  path.join(root, "run-b"),
]);
let packages = 0;
for (const f of walk(path.join(root, "run-a")).filter((p) =>
  p.endsWith("subtitle-package.needs-review.json"),
)) {
  const pkg = subtitlePackageSchema.parse(read(f));
  packages++;
  for (const [ext, parser] of Object.entries({
    ass: parseAss,
    srt: parseSrt,
    vtt: parseVtt,
  })) {
    const cues = parser(
      fs.readFileSync(
        path.join(path.dirname(f), "machine-candidate." + ext),
        "utf8",
      ),
    );
    if (
      cues.length !== pkg.cues.length ||
      cues.some(
        (c, i) =>
          c.text.replace(/\s/gu, "") !== pkg.cues[i].text.replace(/\s/gu, "") ||
          Math.abs(c.start - pkg.cues[i].start) >
            (ext === "ass" ? 0.011 : 0.0011) ||
          Math.abs(c.end - pkg.cues[i].end) > (ext === "ass" ? 0.011 : 0.0011),
      )
    )
      throw Error("Roundtrip mismatch");
  }
}
let oldParity = { status: "NOT_RUN", files: 0 };
if (oldRoot) {
  const temp = fs.mkdtempSync(path.join(root, "validation-old-parity-"));
  const cfg = path.join(temp, "config.json");
  write(cfg, {
    partition: "D",
    runName: "parity",
    repair: "occurrence-overlap-required",
  });
  const clips = read(path.join(oldRoot, "dataset-selection.json")).clips;
  let count = 0;
  for (const c of clips) {
    const input = path.join(oldRoot, "generator-input", c.id + ".json"),
      target = path.join(temp, c.id);
    fs.mkdirSync(target);
    isolated("generate-c60117.mjs", [input, cfg, target], [input, cfg], target);
    const expected = path.join(
      oldRoot,
      c.partition.toLowerCase() + "-final-a",
      c.id,
    );
    execFileSync("diff", ["-qr", expected, target]);
    count += walk(target).length;
  }
  oldParity = { status: "BYTE_IDENTICAL_TO_FROZEN_17", files: count };
}
const lines = [
  "# C6.0.1.17.1 reference-complete units",
  "",
  "Local research outputs, not full-episode final subtitles. needs-review / finalizationMethod=none.",
  "",
  "BENCHMARK_REFERENCE_SEGMENTED=true; UNSEGMENTED_END_TO_END_VALIDATION=NOT_RUN.",
  "D1 is known old D/C remeasurement. C1 is SAME_EPISODE_FIXED_POLICY_CHECK; full reference was exposed. H1: HELDOUT_VALIDATION_NOT_RUN.",
  "",
  "All subtitle timestamps are clip-local. Source-global seconds = clip-local seconds + the offset below. No reference sentence boundary was supplied to generation.",
  "",
];
for (const u of ref.units) {
  const m = manifest.units.find((v) => v.id === u.id);
  lines.push(
    `- ${u.partition} / ${u.stratum}: ${u.id}, source ${u.start.toFixed(5)}–${u.end.toFixed(5)} s; offset=${m.sourceOffset}. [P2 ASS](run-a/${u.id}/P2-frozen-overlap-required/machine-candidate.ass), [SRT](run-a/${u.id}/P2-frozen-overlap-required/machine-candidate.srt), [VTT](run-a/${u.id}/P2-frozen-overlap-required/machine-candidate.vtt), [audio](${m.audio}).`,
  );
}
lines.push(
  "",
  "P0/P1/off are siblings of each P2 folder; run-b is independent frozen evidence replay. Internal generation-state variant retains its .17 name; only the outer P2 folder name is aliased.",
  "",
  "[D1 evaluation](evaluation/D1-remeasurement.json) · [C1 evaluation](evaluation/C1-fixed-policy-check.json) · [Changes](evaluation/changes.md) · [Preflight](dataset/reference-complete-preflight.json)",
);
write(path.join(root, "OUTPUT_INDEX.md"), lines.join("\n") + "\n");
const validation = {
  schemaAndRoundtripPackages: packages,
  ABByteParity: true,
  oldEvidenceParity: oldParity,
  preflightHashVerified: true,
  zeroAdditionalInference: true,
  files: walk(path.join(root, "run-a")).length,
  validatedAt: new Date().toISOString(),
};
write(path.join(root, "validation.json"), validation);
write(path.join(root, "experiment-manifest.json"), {
  version: "C6.0.1.17.1",
  baseline: "43f736f206937ad9253a0bd913d0aeceeb4541b1",
  frozenRepairHash: manifest.frozenRepairHash,
  datasetHash: oh(manifest),
  referenceUsage: {
    dataPreparationReferenceReads: ref.dataPreparationReferenceReads,
    generationReferenceReads: 0,
    evaluationReferenceReads: 1,
  },
  BENCHMARK_REFERENCE_SEGMENTED: true,
  UNSEGMENTED_END_TO_END_VALIDATION: "NOT_RUN",
  AUX: "NOT_RERUN_THIS_EXPERIMENT",
  status: "needs-review",
  finalizationMethod: "none",
  humanValidated: false,
  defaultPromotionAuthorized: false,
  machineOnlyReleaseAuthorized: false,
  scope: "complete benchmark clips, not full-media deliverable",
  sourceFilesReadOnly: true,
  codeRepository: path.basename(repo),
});
console.log(JSON.stringify(validation, null, 2));
