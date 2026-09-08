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
  COMPOSED_MATRIX,
  COMPOSED_STATE,
} from "../packages/video-subtitler/dist/machine-quality/composed-profile.js";
import { read, write, oh, hash, repo, verify } from "./c60117-common.mjs";
const root = path.resolve(process.argv[2]);
for (const f of [
  "input-freeze.json",
  "generation-freeze.json",
  "run-a-freeze.json",
  "run-b-freeze.json",
  "evaluation-freeze.json",
])
  verify(root, f);
for (const [p, h] of Object.entries(
  read(path.join(root, "implementation-identity.json")),
))
  if ((await hash(path.join(repo, p))) !== h) throw Error("CODE_DRIFT: " + p);
const receipt = read(path.join(root, "input-receipt.local-only.json")),
  old = receipt.oldRoot;
for (const f of [
  "model-input-freeze.json",
  "dataset-freeze.json",
  "evidence-freeze.json",
  "run-a-freeze.json",
  "run-b-freeze.json",
])
  verify(old, f);
execFileSync("diff", [
  "-qr",
  path.join(root, "run-a"),
  path.join(root, "run-b"),
]);
let count = 0;
for (const run of ["run-a", "run-b"])
  for (const u of receipt.credentials)
    for (const v of COMPOSED_MATRIX) {
      const dir = path.join(root, run, u.id, v.id),
        pkg = subtitlePackageSchema.parse(
          read(path.join(dir, "subtitle-package.needs-review.json")),
        );
      const state = read(path.join(dir, "generation-state.json"));
      if (
        state.evidenceHash !==
          oh(read(path.join(root, "generator-input", u.id + ".json"))) ||
        oh(state.policy) !== oh(v.policy)
      )
        throw Error("MATRIX_INPUT_MISMATCH");
      for (const [k, value] of Object.entries(COMPOSED_STATE))
        if (state[k] !== value) throw Error("STATE_MISMATCH: " + k);
      for (const [ext, parser] of Object.entries({
        ass: parseAss,
        srt: parseSrt,
        vtt: parseVtt,
      })) {
        const cs = parser(
          fs.readFileSync(path.join(dir, "machine-candidate." + ext), "utf8"),
        );
        if (
          cs.length !== pkg.cues.length ||
          cs.some(
            (c, i) =>
              c.text.replace(/\s/gu, "") !==
                pkg.cues[i].text.replace(/\s/gu, "") ||
              Math.abs(c.start - pkg.cues[i].start) >
                (ext === "ass" ? 0.011 : 0.0011) ||
              Math.abs(c.end - pkg.cues[i].end) >
                (ext === "ass" ? 0.011 : 0.0011),
          )
        )
          throw Error("ROUNDTRIP");
      }
      count++;
    }
const lines = [
  "# C6.0.1.17.2 — G11 composed exports",
  "",
  "LOCAL_RESEARCH_PACKAGE_NOT_PUBLIC_SHAREABLE. Twelve discontinuous evaluation clips, not a full-video subtitle. needs-review; finalizationMethod=none.",
  "",
  "All clocks are clip-local. Add the source offset below for original-media coordinates. Existing audio was not recut. D1 and C1 are KNOWN_DEVELOPMENT_RECHECK; HELDOUT_VALIDATION_NOT_RUN.",
  "",
];
for (const u of receipt.credentials) {
  const base = "run-a/" + u.id + "/G11-composed/machine-candidate.";
  const audio = path.relative(root, path.join(old, "audio", u.id + ".wav"));
  lines.push(
    "- " +
      u.id +
      ": source " +
      u.sourceOffset +
      "–" +
      (u.sourceOffset + u.seconds).toFixed(5) +
      " s. [G11 ASS](" +
      base +
      "ass), [SRT](" +
      base +
      "srt), [VTT](" +
      base +
      "vtt), [existing audio](" +
      audio +
      ").",
  );
}
lines.push(
  "",
  "[Per-unit metrics](evaluation/per-unit-metrics.csv) · [Factorial effects](evaluation/factorial-effects.json) · [P0 sequence parity](evaluation/primary-text-parity.json) · [Changes](evaluation/changes.md)",
  "",
  "Sibling folders contain P0/G00/G10/G01. run-b is the independently executed identical replay. Old audio/reference/evidence paths are local-only dependencies. No automatic per-unit winner selection.",
);
write(path.join(root, "OUTPUT_INDEX.md"), lines.join("\n") + "\n");
write(path.join(root, "validation.json"), {
  validatedAt: new Date().toISOString(),
  schemaAndRoundtripPackages: count,
  ABByteParity: true,
  baselineComparisons: read(path.join(root, "baseline-parity.json")).comparisons
    .length,
  baselineParityPassed: read(path.join(root, "baseline-parity.json")).passed,
  preIntraPairs: read(path.join(root, "stage-pair-parity.json")).length,
  frozenCodeVerified: true,
  oldFreezesVerified: true,
  ...COMPOSED_STATE,
});
console.log(JSON.stringify({ packages: count, passed: true }));
