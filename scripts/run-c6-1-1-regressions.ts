import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { z } from "zod";
import {
  atomicWriteJson,
  c611RegressionEvidenceSchema,
  type C611RegressionEvidence,
} from "@mvl/shared";
import { machineQualitySemanticHash as hash } from "../packages/video-subtitler/src/machine-quality/evidence-correlation.js";
import { c611SourceInventory } from "../packages/video-subtitler/src/consensus/c611-artifact-io.js";
import { c61FileHash } from "../packages/video-subtitler/src/consensus/c61-artifact-io.js";
import { C611_POLICY_VERSION } from "../packages/video-subtitler/src/consensus/c611-policy.js";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`),
    v = i >= 0 ? process.argv[i + 1] : undefined;
  if (!v) throw new Error(`Missing --${name}`);
  return v;
}
const output = path.resolve(arg("output")),
  skillValidator = path.resolve(arg("skill-validator"));
const repository = process.cwd();
await mkdir(output, { recursive: false });
await mkdir(path.join(output, "logs"));
const before = await c611SourceInventory(repository);
const environment: NodeJS.ProcessEnv = {
  ...process.env,
  MVL_SPEAKER_INTEGRATION_TEST: "0",
  MVL_MFA_INTEGRATION_TEST: "0",
  HF_HUB_OFFLINE: "1",
  TRANSFORMERS_OFFLINE: "1",
};
delete environment.HF_TOKEN;
delete environment.HUGGING_FACE_HUB_TOKEN;
const tests = (await readdir("tests"))
  .filter(
    (name) =>
      /^(?:c[456]-|c6-1-1-|japanese-|presentation|subtitle|review)/u.test(
        name,
      ) && name.endsWith(".test.ts"),
  )
  .map((name) => path.join("tests", name))
  .sort();
const checks: C611RegressionEvidence["checks"] = [];
const summarySchema = z.object({
  numPassedTests: z.number(),
  numFailedTests: z.number(),
  numPendingTests: z.number(),
  testResults: z.array(
    z.object({
      assertionResults: z.array(
        z.object({ fullName: z.string(), status: z.string() }),
      ),
    }),
  ),
});
const specs: {
  stage: C611RegressionEvidence["checks"][number]["stage"];
  command: string;
  args: string[];
  testRun?: boolean;
}[] = [
  ...(
    ["generate:schemas", "typecheck", "lint", "format:check", "build"] as const
  ).map((stage) => ({ stage, command: "npm", args: ["run", stage] })),
  { stage: "unit", command: "npm", args: ["test", "--"], testRun: true },
  {
    stage: "e2e",
    command: "npm",
    args: ["run", "test:e2e", "--"],
    testRun: true,
  },
  {
    stage: "targeted",
    command: "node",
    args: [
      "node_modules/vitest/vitest.mjs",
      "run",
      ...tests,
      "tests/e2e/c6-0-1-12-review-assistance-flow.test.ts",
      "tests/e2e/c6-1-multi-asr-consensus-investigation-flow.test.ts",
      "tests/e2e/c6-1-1-selective-mbr-flow.test.ts",
    ],
    testRun: true,
  },
  {
    stage: "skill",
    command: "python3",
    args: [skillValidator, ".agents/skills/multilingual-video-subtitler"],
  },
];
for (const spec of specs) {
  const started = Date.now(),
    stem = spec.stage.replace(/:/gu, "-"),
    resultFile = path.join(output, "logs", `${stem}.tests.json`);
  const args = spec.testRun
    ? [
        ...spec.args,
        "--reporter=json",
        `--outputFile=${path.relative(repository, resultFile)}`,
      ]
    : spec.args;
  console.log(`START ${spec.stage}`);
  const result = await new Promise<{ code: number; log: string }>((resolve) => {
    const child = spawn(spec.command, args, {
      cwd: repository,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";
    child.stdout.on("data", (chunk: Buffer) => {
      log += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      log += chunk.toString();
    });
    child.on("error", (error) => {
      log += error.message;
    });
    child.on("close", (code) => resolve({ code: code ?? 1, log }));
  });
  let testCounts: C611RegressionEvidence["checks"][number]["tests"] = null;
  let skipReasons: string[] = [];
  if (spec.testRun) {
    try {
      const report = summarySchema.parse(
        JSON.parse(await readFile(resultFile, "utf8")),
      );
      testCounts = {
        passed: report.numPassedTests,
        failed: report.numFailedTests,
        skipped: report.numPendingTests,
      };
      skipReasons = report.testResults.flatMap((f) =>
        f.assertionResults
          .filter((t) => ["pending", "skipped", "todo"].includes(t.status))
          .map(
            (t) =>
              `${t.fullName}: optional real-model opt-in disabled; no real inference in acceptance`,
          ),
      );
    } catch (error) {
      result.code = 1;
      result.log += `\nInvalid test report: ${String(error)}`;
    }
  }
  const logRelativePath = `logs/${stem}.log`,
    log =
      stripVTControlCharacters(result.log) +
      `\nTEST_COUNTS ${JSON.stringify(testCounts)}\n`;
  await writeFile(path.join(output, logRelativePath), log, { flag: "wx" });
  const command =
    spec.stage === "skill"
      ? "python3 <skill-creator>/scripts/quick_validate.py .agents/skills/multilingual-video-subtitler"
      : [spec.command, ...args].join(" ");
  checks.push({
    stage: spec.stage,
    command,
    exitCode: result.code,
    durationMs: Date.now() - started,
    logRelativePath,
    logSha256: await c61FileHash(path.join(output, logRelativePath)),
    tests: testCounts,
    skipReasons,
  });
  console.log(
    JSON.stringify({
      stage: spec.stage,
      exitCode: result.code,
      durationMs: Date.now() - started,
      tests: testCounts,
      skipped: skipReasons,
    }),
  );
}
const after = await c611SourceInventory(repository);
if (hash(before) !== hash(after))
  throw new Error("C611_SOURCE_CHANGED_DURING_QA");
const body = {
  schemaVersion: "1.0.0" as const,
  policyVersion: C611_POLICY_VERSION,
  artifactType: "c6-1-1-regression-evidence" as const,
  sourceCodeAggregateHash: hash(before),
  checks,
  freshModelInferenceAllowed: false as const,
  sourceUnchangedDuringChecks: true as const,
};
const evidence = c611RegressionEvidenceSchema.parse({
  ...body,
  semanticHash: hash(body),
});
await atomicWriteJson(
  path.join(output, "c6-1-1-regression-evidence.json"),
  evidence,
);
if (checks.some((c) => c.exitCode !== 0)) process.exitCode = 1;
