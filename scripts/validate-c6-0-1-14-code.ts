import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs, stripVTControlCharacters } from "node:util";
import { atomicWriteFile, atomicWriteJson } from "@mvl/shared";
import { allocateC60114Output } from "./lib/c60114-output.js";
import { c60113FileHash } from "./lib/c60113-acceptance-io.js";

const { values } = parseArgs({
  strict: true,
  options: {
    "output-root": { type: "string" },
    "output-stem": { type: "string" },
  },
});
if (!values["output-root"] || !values["output-stem"])
  throw new Error("Specify --output-root and --output-stem");
const directory = await allocateC60114Output(
  values["output-root"],
  values["output-stem"],
);
const commands: { id: string; command: string; args: string[] }[] = [
  { id: "typecheck", command: "npm", args: ["run", "typecheck"] },
  { id: "lint", command: "npm", args: ["run", "lint"] },
  { id: "format-check", command: "npm", args: ["run", "format:check"] },
  { id: "build", command: "npm", args: ["run", "build"] },
  { id: "unit", command: "npm", args: ["test"] },
  { id: "e2e", command: "npm", args: ["run", "test:e2e"] },
  {
    id: "c60114-targeted",
    command: "npm",
    args: ["exec", "vitest", "--", "run", "tests/c6-0-1-14"],
  },
];
const results = [];
for (const step of commands) {
  process.stdout.write(`START ${step.id}\n`);
  const start = Date.now(),
    chunks: Buffer[] = [];
  const code = await new Promise<number>((resolve, reject) => {
    const child = spawn(step.command, step.args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (data: Buffer) => chunks.push(Buffer.from(data)));
    child.stderr.on("data", (data: Buffer) => chunks.push(Buffer.from(data)));
    child.on("error", reject);
    child.on("close", (value) => resolve(value ?? -1));
  });
  const output = Buffer.concat(chunks).toString("utf8");
  const fileName = `${step.id}.log`,
    file = path.join(directory, fileName);
  await atomicWriteFile(file, output);
  const result = {
    id: step.id,
    command: [step.command, ...step.args],
    exitCode: code,
    passed: code === 0,
    elapsedSeconds: (Date.now() - start) / 1000,
    logRelativePath: fileName,
    logSha256: await c60113FileHash(file),
    testSummary: stripVTControlCharacters(output)
      .split(/\r?\n/u)
      .filter((line) => /^\s*(?:Test Files|Tests|Duration)\s/u.test(line))
      .map((line) => line.trim()),
  };
  results.push(result);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
  packageManager: string;
};
await atomicWriteJson(path.join(directory, "c6-0-1-14-code-validation.json"), {
  schemaVersion: "1.0.0",
  artifactType: "c6-0-1-14-code-validation",
  generatedAt: new Date().toISOString(),
  nodeVersion: process.version,
  packageManager: packageJson.packageManager,
  results,
  passed: results.every((result) => result.passed),
  realAsrExecutedByValidation: false,
  goldEvaluationExecutedByValidation: false,
  rankerTrainingExecutedByValidation: false,
});
process.stdout.write(`VALIDATION_DIRECTORY ${directory}\n`);
if (results.some((result) => !result.passed)) process.exitCode = 1;
