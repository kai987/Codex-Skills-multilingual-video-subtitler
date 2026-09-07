import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const [evidenceArg, outputArg] = process.argv.slice(2);
if (!evidenceArg || !outputArg)
  throw new Error(
    "Usage: run-c60116-experiment.mjs machine-evidence.json new-output-parent",
  );
const inputEvidence = fs.realpathSync(evidenceArg),
  output = path.resolve(outputArg),
  repo = path.resolve(import.meta.dirname, "..");
fs.mkdirSync(output);
const evidence = path.join(output, "machine-evidence.json");
fs.copyFileSync(inputEvidence, evidence, fs.constants.COPYFILE_EXCL);
const hash = (p) =>
  createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const before = hash(evidence);
const codeFiles = [
  "scripts/run-c60116-experiment.mjs",
  ...[
    "experimental-profile",
    "experimental-repetition-recovery",
    "experimental-generate",
    "experimental-metrics",
  ].flatMap((name) => [
    `packages/video-subtitler/src/machine-quality/${name}.ts`,
    `packages/video-subtitler/dist/machine-quality/${name}.js`,
  ]),
];
const codeSnapshot = codeFiles.map((file) => ({
  file,
  sha256: hash(path.join(repo, file)),
}));
const logs = [];
for (const role of ["run-a", "run-b"]) {
  const target = path.join(output, role);
  logs.push(
    execFileSync(
      process.execPath,
      [
        "--permission",
        "--allow-fs-read=" + repo,
        "--allow-fs-read=" + evidence,
        "--allow-fs-read=" + target,
        "--allow-fs-read=" + target + "/*",
        "--allow-fs-write=" + target,
        "--allow-fs-write=" + target + "/*",
        path.join(
          repo,
          "packages/video-subtitler/dist/machine-quality/experimental-generate.js",
        ),
        evidence,
        target,
      ],
      { cwd: repo, encoding: "utf8" },
    ),
  );
}
const a = JSON.parse(
    fs.readFileSync(path.join(output, "run-a/experiment-manifest.json")),
  ),
  b = JSON.parse(
    fs.readFileSync(path.join(output, "run-b/experiment-manifest.json")),
  );
if (
  JSON.stringify(a.files) !== JSON.stringify(b.files) ||
  before !== hash(evidence)
)
  throw new Error("Deterministic replay or input preservation failure");
if (
  before !== hash(inputEvidence) ||
  codeSnapshot.some((f) => hash(path.join(repo, f.file)) !== f.sha256)
)
  throw new Error("Input or implementation changed during replay");
fs.writeFileSync(
  path.join(output, "replay-validation.json"),
  JSON.stringify(
    {
      passed: true,
      outputFiles: a.files.length,
      sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: repo,
        encoding: "utf8",
      }).trim(),
      workingDiffSha256: createHash("sha256")
        .update(execFileSync("git", ["diff", "--binary"], { cwd: repo }))
        .digest("hex"),
      evidenceHash: before,
      codeSnapshot,
      generationPermissionBoundary:
        "code + one strict machine evidence file; write new run directory only",
      b2ReplayParity: true,
      sourceUnchanged: true,
      newInference: 0,
      logs,
    },
    null,
    2,
  ),
);
console.log("B2 deterministic A/B replay passed:", a.files.length, "files");
