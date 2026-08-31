import { spawn, execFile } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs, stripVTControlCharacters, promisify } from "node:util";
import { codeValidation142Schema } from "@mvl/shared";
import {
  durableJson141,
  fileHash141,
} from "../packages/video-subtitler/src/review/c601141-io.js";

const { values } = parseArgs({
  strict: true,
  options: { output: { type: "string" }, "npm-cli": { type: "string" } },
});
if (!values.output || !values["npm-cli"])
  throw new Error("C601142_VALIDATION_OUTPUT_AND_PINNED_NPM_REQUIRED");
const root = path.resolve(values.output),
  npm = path.resolve(values["npm-cli"]);
const metadata = JSON.parse(await readFile("package.json", "utf8")) as {
  packageManager: string;
};
const runtimeEnvironment = {
  ...process.env,
  PATH: [
    path.dirname(process.execPath),
    path.resolve(path.dirname(npm), "../../.bin"),
    process.env.PATH ?? "",
  ].join(path.delimiter),
};
const npmVersion = (
  await promisify(execFile)(process.execPath, [npm, "--version"], {
    env: runtimeEnvironment,
  })
).stdout.trim();
if (
  process.versions.node.split(".")[0] !== "24" ||
  metadata.packageManager !== `npm@${npmVersion}`
)
  throw new Error("C601142_NODE24_AND_EXACT_PACKAGE_MANAGER_REQUIRED");
await mkdir(root, { recursive: true });
if ((await readdir(root)).length)
  throw new Error("C601142_VALIDATION_OUTPUT_MUST_BE_EMPTY");
const steps = [
  ["npm-ci", ["ci", "--offline"]],
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
    "c601142-targeted",
    [
      "exec",
      "vitest",
      "--",
      "run",
      "tests/c6-0-1-14-2",
      "tests/e2e/c6-0-1-14-2",
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
      "tests/c6-0-1-13-workspace",
      "tests/c6-0-1-12-review-workspace",
    ],
  ],
] as const;
const results = [];
for (const [id, args] of steps) {
  process.stdout.write(`START ${id}\n`);
  const started = Date.now(),
    chunks: Buffer[] = [];
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, [npm, ...args], {
      cwd: process.cwd(),
      env: runtimeEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (b: Buffer) => chunks.push(Buffer.from(b)));
    child.stderr.on("data", (b: Buffer) => chunks.push(Buffer.from(b)));
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? -1));
  });
  const output = Buffer.concat(chunks).toString("utf8"),
    file = `${id}.log`;
  await writeFile(path.join(root, file), output, { flag: "wx" });
  const result = {
    id,
    command: [process.execPath, npm, ...args],
    exitCode,
    passed: exitCode === 0,
    elapsedSeconds: (Date.now() - started) / 1000,
    logRelativePath: file,
    logSha256: await fileHash141(path.join(root, file)),
    testSummary: stripVTControlCharacters(output)
      .split(/\r?\n/u)
      .filter((line) => /^\s*(?:Test Files|Tests|Duration)\s/u.test(line))
      .map((line) => line.trim()),
  };
  results.push(result);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
const artifact = codeValidation142Schema.parse({
  schemaVersion: "1.0.0",
  artifactType: "c6-0-1-14-2-code-validation",
  generatedAt: new Date().toISOString(),
  nodeVersion: process.version,
  packageManager: `npm@${npmVersion}`,
  results,
  passed: results.every((row) => row.passed),
  realAsrExecutedByValidation: false,
  goldEvaluationExecutedByValidation: false,
  rankerTrainingExecutedByValidation: false,
});
await durableJson141(
  path.join(root, "c6-0-1-14-2-code-validation.json"),
  artifact,
);
if (!artifact.passed) process.exitCode = 1;
