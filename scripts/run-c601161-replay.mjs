import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { sha256 } from "../packages/video-subtitler/dist/machine-quality/experimental-profile.js";
const [evidenceArg, outputArg] = process.argv.slice(2);
if (!evidenceArg || !outputArg)
  throw new Error(
    "Usage: run-c601161-replay.mjs primary-evidence.json new-output-parent",
  );
const repo = path.resolve(import.meta.dirname, ".."),
  input = fs.realpathSync(evidenceArg),
  output = path.resolve(outputArg);
fs.mkdirSync(output);
const evidence = path.join(output, "machine-evidence.json");
fs.copyFileSync(input, evidence, fs.constants.COPYFILE_EXCL);
const hash = (p) => sha256(fs.readFileSync(p));
const evidenceHash = hash(evidence);
const tracked = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { cwd: repo },
)
  .toString()
  .split("\0")
  .filter(Boolean);
const codeSnapshot = tracked
  .filter(
    (p) =>
      /^(packages\/|scripts\/|package.*json)/u.test(p) && !p.includes("/dist/"),
  )
  .map((p) => ({ path: p, sha256: hash(path.join(repo, p)) }));
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
          "packages/video-subtitler/dist/machine-quality/matched-generate.js",
        ),
        evidence,
        target,
      ],
      {
        cwd: repo,
        encoding: "utf8",
        env: { PATH: process.env.PATH, LANG: "en_US.UTF-8", TZ: "UTC" },
      },
    ),
  );
}
const read = (p) => JSON.parse(fs.readFileSync(p));
const a = read(path.join(output, "run-a/experiment-manifest.json")),
  b = read(path.join(output, "run-b/experiment-manifest.json"));
if (JSON.stringify(a.files) !== JSON.stringify(b.files))
  throw new Error("A/B payload mismatch");
for (const role of ["run-a", "run-b"])
  for (const f of a.files)
    if (hash(path.join(output, role, f.path)) !== f.sha256)
      throw new Error("Payload changed");
if (
  hash(input) !== evidenceHash ||
  hash(evidence) !== evidenceHash ||
  codeSnapshot.some((f) => hash(path.join(repo, f.path)) !== f.sha256)
)
  throw new Error("Input/code changed");
fs.writeFileSync(
  path.join(output, "experiment-manifest.json"),
  JSON.stringify(
    {
      sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: repo,
        encoding: "utf8",
      }).trim(),
      codeSnapshot,
      evidenceHash,
      payloadFileCount: a.files.length,
      matchedEvidenceVerified: true,
      replayParity: true,
      repairDisabledParity: a.repairDisabledParity,
      scope: a.replayScope,
      newInference: 0,
      modelLoads: 0,
      providerStarts: 0,
      logs,
    },
    null,
    2,
  ),
  { flag: "wx" },
);
fs.writeFileSync(
  path.join(output, "OUTPUT_INDEX.md"),
  "# C6.0.1.16.1\n\n本轮新机器候选 ASS：run-a/R2-source-preserving/machine-candidate.ass。\n\nLOCAL_ONLY / needs-review; finalizationMethod=none. See evaluation for quality, not just engineering parity.\n",
  { flag: "wx" },
);
console.log("Matched replay A/B passed:", a.files.length, "payload files");
