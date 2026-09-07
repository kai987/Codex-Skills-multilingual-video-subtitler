import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { observationSchema } from "../packages/video-subtitler/dist/machine-quality/bounded-acoustic.js";
import {
  sha256,
  objectHash,
} from "../packages/video-subtitler/dist/machine-quality/experimental-profile.js";
const output = path.resolve(process.argv[2]),
  repo = path.resolve(import.meta.dirname, "..");
const read = (p) => JSON.parse(fs.readFileSync(p));
const plan = read(path.join(output, "experiment-plan.json")),
  bundleFile = path.join(output, "evidence/frozen.json"),
  bundle = read(bundleFile),
  primary = path.join(output, "machine-evidence.json");
if (
  sha256(fs.readFileSync(path.join(output, "experiment-plan.json"))) !==
    bundle.planHash ||
  sha256(fs.readFileSync(primary)) !== bundle.primaryHash
)
  throw Error("Input freeze changed");
for (const req of plan.requests) {
  const result = read(path.join(output, `requests/${req.id}.json`));
  if (
    result.requestHash !== objectHash(req) ||
    result.planHash !== bundle.planHash ||
    result.observationHash !== objectHash(result.observation) ||
    result.observation.resultHash !== objectHash(result.raw) ||
    objectHash(bundle.observations.find((o) => o.requestId === req.id)) !==
      objectHash(observationSchema.parse(result.observation))
  )
    throw Error("Request persistence mismatch");
}
const hashes = {};
for (const run of ["run-a", "run-b"]) {
  const target = path.join(output, run);
  execFileSync(
    process.execPath,
    [
      "--permission",
      "--allow-fs-read=" + repo,
      "--allow-fs-read=" + primary,
      "--allow-fs-read=" + bundleFile,
      "--allow-fs-read=" + target,
      "--allow-fs-read=" + target + "/*",
      "--allow-fs-write=" + target,
      "--allow-fs-write=" + target + "/*",
      path.join(repo, "scripts/generate-c601162.mjs"),
      primary,
      bundleFile,
      target,
    ],
    {
      stdio: "inherit",
      env: { PATH: process.env.PATH, LANG: "en_US.UTF-8", TZ: "UTC" },
    },
  );
  hashes[run] = read(path.join(target, "experiment-manifest.json")).files;
}
if (objectHash(hashes["run-a"]) !== objectHash(hashes["run-b"]))
  throw Error("Final A/B mismatch");
fs.writeFileSync(
  path.join(output, "generation-freeze.json"),
  JSON.stringify(
    {
      version: "c601162-dual-freeze-v1",
      sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: repo,
        encoding: "utf8",
      }).trim(),
      planHash: bundle.planHash,
      evidenceHash: sha256(fs.readFileSync(bundleFile)),
      runs: hashes,
      frozenAt: new Date().toISOString(),
      modelRuns: 0,
      deterministicFixedEvidenceParity: true,
    },
    null,
    2,
  ),
  { flag: "wx", flush: true },
);
console.log("Final A/B frozen; no model rerun");
