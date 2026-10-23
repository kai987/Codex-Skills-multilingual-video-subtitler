import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    output: { type: "string" },
    groups: {
      type: "string",
      default: "typecheck,lint,format,build,unit,e2e,schema,skill,targeted",
    },
    "skill-validator": { type: "string" },
  },
});
if (!values.output) throw new Error("--output is required");
const output = path.resolve(values.output);
await mkdir(output, { recursive: false });
const targeted = (await readdir("tests"))
  .filter((name) => /^c(?:5-19|6-0).*\.test\.ts$/u.test(name))
  .sort()
  .map((name) => path.join("tests", name));
const commands: Record<string, string[]> = {
  typecheck: ["npm", "run", "typecheck"],
  lint: ["npm", "run", "lint"],
  format: ["npm", "run", "format:check"],
  build: ["npm", "run", "build"],
  unit: [
    "npx",
    "vitest",
    "run",
    "--exclude",
    "tests/e2e/**",
    "--reporter=json",
    `--outputFile=${path.join(output, "unit.json")}`,
  ],
  e2e: [
    "npx",
    "vitest",
    "run",
    "tests/e2e",
    "--reporter=json",
    `--outputFile=${path.join(output, "e2e.json")}`,
  ],
  schema: ["npm", "run", "generate:schemas"],
  skill: [
    "python3",
    values["skill-validator"] ?? "scripts/validate-skills.py",
    ".agents/skills/multilingual-video-subtitler",
  ],
  targeted: [
    "npx",
    "vitest",
    "run",
    ...targeted,
    "--reporter=json",
    `--outputFile=${path.join(output, "targeted.json")}`,
  ],
};
const results = [];
for (const groupId of values.groups.split(",")) {
  const command = commands[groupId];
  if (!command) throw new Error(`Unknown group ${groupId}`);
  const started = Date.now();
  process.stdout.write(`START ${groupId}\n`);
  let text = "";
  const executable = command[0];
  if (!executable) throw new Error("Empty regression command");
  const child = spawn(executable, command.slice(1), {
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (data: Buffer) => {
    text += data.toString();
  });
  child.stderr.on("data", (data: Buffer) => {
    text += data.toString();
  });
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  await writeFile(path.join(output, `${groupId}.log`), text, { flag: "wx" });
  results.push({
    groupId,
    status: exitCode === 0 ? "PASSED" : "FAILED",
    command: command.join(" "),
    exitCode,
    outputHash: createHash("sha256").update(text).digest("hex"),
  });
  await writeFile(
    path.join(output, "regression-results.json"),
    `${JSON.stringify(results, null, 2)}\n`,
  );
  process.stdout.write(
    `END ${groupId} exit=${exitCode} seconds=${((Date.now() - started) / 1000).toFixed(1)}\n`,
  );
  if (exitCode !== 0) process.stdout.write(text.slice(-12000));
}
if (results.some((entry) => entry.status !== "PASSED")) process.exitCode = 1;
