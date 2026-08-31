import { spawn, execFile } from "node:child_process";
import { mkdir, readdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs, promisify, stripVTControlCharacters } from "node:util";
import { codeValidation143Schema } from "@mvl/shared";
import {
  durableJson141,
  fileHash141,
} from "../packages/video-subtitler/src/review/c601141-io.js";
const { values } = parseArgs({
  strict: true,
  options: { output: { type: "string" }, "npm-cli": { type: "string" } },
});
if (!values.output || !values["npm-cli"])
  throw new Error("C601143_VALIDATION_OUTPUT_AND_PINNED_NPM_REQUIRED");
const root = path.resolve(values.output),
  npm = path.resolve(values["npm-cli"]),
  meta = JSON.parse(await readFile("package.json", "utf8")) as {
    packageManager: string;
  };
const env = {
  ...process.env,
  PATH: [
    path.dirname(process.execPath),
    path.resolve(path.dirname(npm), "../../.bin"),
    process.env.PATH ?? "",
  ].join(path.delimiter),
};
const npmVersion = (
  await promisify(execFile)(process.execPath, [npm, "--version"], { env })
).stdout.trim();
if (
  !process.version.startsWith("v24.") ||
  meta.packageManager !== `npm@${npmVersion}`
)
  throw new Error("C601143_PINNED_NODE_NPM_REQUIRED");
await mkdir(root, { recursive: true });
if ((await readdir(root)).length)
  throw new Error("C601143_VALIDATION_OUTPUT_NOT_EMPTY");
const steps = [
  ["npm-ci", ["ci", "--offline", "--ignore-scripts"]],
  ["schema-generation", ["run", "generate:schemas"]],
  ["typecheck", ["run", "typecheck"]],
  ["lint", ["run", "lint"]],
  ["format-check", ["run", "format:check"]],
  ["build", ["run", "build"]],
  ["unit", ["test"]],
  [
    "non-e2e-unit",
    ["exec", "vitest", "--", "run", "--exclude", "tests/e2e/**"],
  ],
  ["e2e", ["run", "test:e2e"]],
  [
    "c601143-targeted",
    [
      "exec",
      "vitest",
      "--",
      "run",
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
      "tests/c6",
      "tests/e2e/c6",
      "tests/c5-19",
      "tests/e2e/c5-19",
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
const results = [];
for (const [id, args] of steps) {
  process.stdout.write(`START ${id}\n`);
  const start = Date.now(),
    chunks: Buffer[] = [];
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, [npm, ...args], {
      cwd: process.cwd(),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (v: Buffer) => chunks.push(Buffer.from(v)));
    child.stderr.on("data", (v: Buffer) => chunks.push(Buffer.from(v)));
    child.on("error", reject);
    child.on("close", (c) => resolve(c ?? -1));
  });
  const output = Buffer.concat(chunks).toString("utf8"),
    logRelativePath = `${id}.log`;
  await writeFile(path.join(root, logRelativePath), output, { flag: "wx" });
  const row = {
    id,
    command: [process.execPath, npm, ...args],
    exitCode,
    passed: exitCode === 0,
    elapsedSeconds: (Date.now() - start) / 1000,
    logRelativePath,
    logSha256: await fileHash141(path.join(root, logRelativePath)),
    testSummary: stripVTControlCharacters(output)
      .split(/\r?\n/u)
      .filter((l) => /^\s*(?:Test Files|Tests|Duration)\s/u.test(l))
      .map((l) => l.trim()),
  };
  results.push(row);
  process.stdout.write(`${JSON.stringify(row)}\n`);
}
const artifact = codeValidation143Schema.parse({
  schemaVersion: "1.0.0",
  artifactType: "c6-0-1-14-3-code-validation",
  generatedAt: new Date().toISOString(),
  nodeVersion: process.version,
  packageManager: `npm@${npmVersion}`,
  results,
  passed: results.every((r) => r.passed),
  realAsrExecutedByValidation: false,
  goldEvaluationExecutedByValidation: false,
  rankerTrainingExecutedByValidation: false,
});
await durableJson141(
  path.join(root, "c6-0-1-14-3-code-validation.json"),
  artifact,
);
if (!artifact.passed) process.exitCode = 1;
