import { spawn, execFile } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs, promisify } from "node:util";
import { preGoldEngineering144Schema } from "@mvl/shared";
import {
  durableJson141,
  fileHash141,
} from "../packages/video-subtitler/src/review/c601141-io.js";
import { hashed141 } from "../packages/video-subtitler/src/review/c601141-policy.js";
import { machineCodeSnapshot143 } from "./lib/c601143-final.js";

const { values } = parseArgs({
  strict: true,
  options: { output: { type: "string" }, "npm-cli": { type: "string" } },
});
if (!values.output || !values["npm-cli"])
  throw new Error("C601144_VALIDATION_OUTPUT_AND_PINNED_NPM_REQUIRED");
const root = path.resolve(values.output),
  npm = path.resolve(values["npm-cli"]),
  metadata = JSON.parse(await readFile("package.json", "utf8")) as {
    packageManager: string;
  },
  env = {
    ...process.env,
    PATH: [
      path.dirname(process.execPath),
      path.resolve(path.dirname(npm), "../../.bin"),
      process.env.PATH ?? "",
    ].join(path.delimiter),
  },
  npmVersion = (
    await promisify(execFile)(process.execPath, [npm, "--version"], { env })
  ).stdout.trim();
if (
  !process.version.startsWith("v24.") ||
  metadata.packageManager !== `npm@${npmVersion}`
)
  throw new Error("C601144_PINNED_NODE24_NPM11_REQUIRED");
await mkdir(root, { recursive: true });
if ((await readdir(root)).length)
  throw new Error("C601144_VALIDATION_OUTPUT_NOT_EMPTY");

const steps = [
  ["npm-ci", ["ci", "--offline", "--ignore-scripts"]],
  ["schema-generation", ["run", "generate:schemas"]],
  ["typecheck", ["run", "typecheck"]],
  ["lint", ["run", "lint"]],
  ["format-check", ["run", "format:check"]],
  ["build", ["run", "build"]],
  ["unit", ["test"]],
  ["e2e", ["run", "test:e2e"]],
  [
    "c601144-targeted",
    [
      "exec",
      "vitest",
      "--",
      "run",
      "tests/c6-0-1-14-4-machine-evidence-utility.test.ts",
      "tests/e2e/c6-0-1-14-4-machine-evidence-utility-selection-flow.test.ts",
    ],
  ],
  [
    "c6011431-targeted-regression",
    [
      "exec",
      "vitest",
      "--",
      "run",
      "tests/c6-0-1-14-3-1-projection-integrity.test.ts",
      "tests/e2e/c6-0-1-14-3-1-projection-integrity-refreeze-flow.test.ts",
      "tests/c6-0-1-14-3-monotonicity.test.ts",
      "tests/c6-0-1-14-3-planner.test.ts",
      "tests/c6-0-1-14-3-hierarchy-bundles.test.ts",
      "tests/c6-0-1-14-3-replay-barrier.test.ts",
      "tests/e2e/c6-0-1-14-3-monotonic-safety-selection-flow.test.ts",
    ],
  ],
  [
    "cross-version",
    [
      "exec",
      "vitest",
      "--",
      "run",
      "tests/c5-19",
      "tests/e2e/c5-19",
      "tests/c6",
      "tests/e2e/c6",
    ],
  ],
  [
    "review-ui",
    [
      "exec",
      "vitest",
      "--",
      "run",
      "tests/c6-0-1-14-playback-ui",
      "tests/c6-0-1-14-1-playback-ui",
      "tests/c6-0-1-14-2-playback-ui",
      "tests/c6-0-1-14-3-review-ui.test.ts",
      "tests/c6-0-1-13-workspace",
      "tests/c6-0-1-12-review-workspace",
    ],
  ],
] as const;
const checks = [];
for (const [name, args] of steps) {
  process.stdout.write(`START ${name}\n`);
  const chunks: Buffer[] = [];
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, [npm, ...args], {
      cwd: process.cwd(),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (value: Buffer) => chunks.push(Buffer.from(value)));
    child.stderr.on("data", (value: Buffer) => chunks.push(Buffer.from(value)));
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? -1));
  });
  const logRelativePath = `${name}.log`,
    logPath = path.join(root, logRelativePath);
  await writeFile(logPath, Buffer.concat(chunks), { flag: "wx" });
  const check = {
    name,
    passed: exitCode === 0,
    command: [process.execPath, npm, ...args].join(" "),
    logRelativePath,
    logSha256: await fileHash141(logPath),
  };
  checks.push(check);
  process.stdout.write(`${JSON.stringify({ ...check, exitCode })}\n`);
  if (exitCode !== 0)
    throw new Error(`C601144_ENGINEERING_STEP_FAILED:${name}:${exitCode}`);
}
const codeSnapshot = await machineCodeSnapshot143(process.cwd()),
  receipt = preGoldEngineering144Schema.parse(
    hashed141({
      schemaVersion: "1.0.0",
      policyVersion: "c6.0.1.14.4-machine-evidence-utility-selection-v1",
      visibility: "LOCAL_ONLY",
      artifactType: "c6-0-1-14-4-pre-gold-engineering-validation",
      codeSnapshotHash: codeSnapshot.semanticHash,
      checks,
      passed: true,
      networkUsed: false,
      modelInferenceCount: 0,
    }),
  );
await durableJson141(
  path.join(root, "c6-0-1-14-4-pre-gold-engineering-validation.json"),
  receipt,
);
console.log(
  JSON.stringify(
    {
      passed: receipt.passed,
      checkCount: receipt.checks.length,
      codeSnapshotHash: receipt.codeSnapshotHash,
      networkUsed: receipt.networkUsed,
    },
    null,
    2,
  ),
);
