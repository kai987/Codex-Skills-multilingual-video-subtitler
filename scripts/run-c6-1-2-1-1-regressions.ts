import path from "node:path";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { stripVTControlCharacters } from "node:util";
import { z } from "zod";
import { c61211QaSchema } from "@mvl/shared";
import { c612Arguments } from "../packages/video-subtitler/src/consensus/top-k/c612-delivery-io.js";
import { c6121QaSourceSnapshot } from "../packages/video-subtitler/src/consensus/evaluation-recovery/qa-source-snapshot.js";
import {
  c61211Artifact,
  demand,
} from "../packages/video-subtitler/src/consensus/evaluation-partition/c61211-policy.js";
import {
  writeC61211,
  shaBytes,
} from "../packages/video-subtitler/src/consensus/evaluation-partition/artifact-io.js";

const keys = ["--output", "--skill-validator", "--ctc-python", "--network"],
  arg = c612Arguments(keys, keys);
const repository = path.resolve(import.meta.dirname, ".."),
  output = path.resolve(arg("--output"));
demand(
  path.relative(repository, output).startsWith(".."),
  "C61211_QA_OUTPUT_MUST_BE_EXTERNAL",
);
await mkdir(output, { recursive: false });
await mkdir(path.join(output, "logs"));
const before = await c6121QaSourceSnapshot(repository);
const environment: NodeJS.ProcessEnv = {
  ...process.env,
  VITEST_MAX_WORKERS: "2",
  MVL_SPEAKER_INTEGRATION_TEST: "0",
  MVL_MFA_INTEGRATION_TEST: "0",
  MVL_CTC_INTEGRATION_TEST: "0",
  HF_HUB_OFFLINE: "1",
  TRANSFORMERS_OFFLINE: "1",
  PYTHONDONTWRITEBYTECODE: "1",
};
delete environment.HF_TOKEN;
delete environment.HUGGING_FACE_HUB_TOKEN;
const tests = (await readdir(path.join(repository, "tests")))
  .filter((n) => n.endsWith(".test.ts"))
  .sort();
interface Spec {
  stage: string;
  command: string;
  args: string[];
  tests?: boolean;
}
const targeted = (stage: string, names: string[]): Spec => ({
  stage,
  command: process.execPath,
  args: ["node_modules/vitest/vitest.mjs", "run", ...names],
  tests: true,
});
const names = (prefix: string, excluded = "") =>
  tests
    .filter(
      (n) => n.startsWith(prefix) && (!excluded || !n.startsWith(excluded)),
    )
    .map((n) => "tests/" + n);
const specs: Spec[] = [
  ...["generate:schemas", "typecheck", "lint", "format:check", "build"].map(
    (stage) => ({ stage, command: "npm", args: ["run", stage] }),
  ),
  { stage: "unit", command: "npm", args: ["test", "--"], tests: true },
  {
    stage: "e2e",
    command: "npm",
    args: ["run", "test:e2e", "--"],
    tests: true,
  },
  targeted("c6-1-targeted", [
    ...tests.filter((n) => /^c6-1-(?![12]-)/.test(n)).map((n) => "tests/" + n),
    "tests/e2e/c6-1-multi-asr-consensus-investigation-flow.test.ts",
  ]),
  targeted("c6-1-1-targeted", [
    ...names("c6-1-1-"),
    "tests/e2e/c6-1-1-selective-mbr-flow.test.ts",
  ]),
  targeted("c6-1-2-targeted", [
    ...names("c6-1-2-", "c6-1-2-1-"),
    "tests/e2e/c6-1-2-top-k-reranking-investigation-flow.test.ts",
  ]),
  targeted("c6-1-2-1-targeted", [
    ...names("c6-1-2-1-", "c6-1-2-1-1-"),
    "tests/e2e/c6-1-2-1-evaluation-supergroup-recovery-flow.test.ts",
  ]),
  targeted("c6-1-2-1-1-targeted", [
    ...names("c6-1-2-1-1-"),
    "tests/e2e/c6-1-2-1-1-monotonic-partition-recovery-flow.test.ts",
  ]),
  targeted("historical-targeted", [
    ...tests
      .filter((n) =>
        /^(?:c[456]-|japanese-|presentation|subtitle|review)/.test(n),
      )
      .map((n) => "tests/" + n),
    "tests/e2e/c6-0-1-12-review-assistance-flow.test.ts",
    "tests/e2e/c6-1-multi-asr-consensus-investigation-flow.test.ts",
    "tests/e2e/c6-1-1-selective-mbr-flow.test.ts",
    "tests/e2e/c6-1-2-top-k-reranking-investigation-flow.test.ts",
    "tests/e2e/c6-1-2-1-evaluation-supergroup-recovery-flow.test.ts",
    "tests/e2e/c6-1-2-1-1-monotonic-partition-recovery-flow.test.ts",
  ]),
  {
    stage: "python-ctc-unit",
    command: arg("--ctc-python"),
    args: ["tests/runtime/c612_candidate_ctc_test.py"],
  },
  {
    stage: "skill",
    command: "python3",
    args: [
      arg("--skill-validator"),
      ".agents/skills/multilingual-video-subtitler",
    ],
  },
];
const summary = z.object({
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
const checks: z.infer<typeof c61211QaSchema>["checks"] = [];
for (const spec of specs) {
  const stem = spec.stage.replaceAll(":", "-"),
    started = Date.now(),
    report = path.join(output, "logs", stem + ".tests.json");
  const args = spec.tests
    ? [...spec.args, "--reporter=json", "--outputFile=" + report]
    : spec.args;
  process.stdout.write("START " + spec.stage + "\n");
  const result = await new Promise<{ code: number; log: string }>((resolve) => {
    const child = spawn(spec.command, args, {
      cwd: repository,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";
    child.stdout.on("data", (b: Buffer) => {
      log += b.toString();
    });
    child.stderr.on("data", (b: Buffer) => {
      log += b.toString();
    });
    child.on("error", (e) => {
      log += String(e);
    });
    child.on("close", (code) => resolve({ code: code ?? 1, log }));
  });
  let testPassed: number | null = null,
    testFailed: number | null = null,
    testSkipped: number | null = null;
  let skipReasons: string[] = [];
  if (spec.tests) {
    try {
      const r = summary.parse(JSON.parse(await readFile(report, "utf8")));
      testPassed = r.numPassedTests;
      testFailed = r.numFailedTests;
      testSkipped = r.numPendingTests;
      skipReasons = r.testResults.flatMap((f) =>
        f.assertionResults
          .filter((t) => ["pending", "skipped", "todo"].includes(t.status))
          .map(
            (t) =>
              t.fullName +
              ": pre-existing optional real-model test; acoustic inference prohibited",
          ),
      );
    } catch (e) {
      result.code = 1;
      result.log += "\nInvalid test reporter: " + String(e);
    }
  }
  if (spec.stage === "python-ctc-unit") {
    testPassed = Number(/Ran (\d+) tests/.exec(result.log)?.[1] ?? 0);
    testFailed = result.code ? 1 : 0;
    testSkipped = 0;
  }
  const logPath = "logs/" + stem + ".log",
    text = stripVTControlCharacters(result.log);
  await writeFile(path.join(output, logPath), text, { flag: "wx" });
  const row = {
    stage: spec.stage,
    command: [spec.command, ...args].join(" "),
    exitCode: result.code,
    passed: result.code === 0 && (testFailed === null || testFailed === 0),
    logPath,
    logSha256: shaBytes(text),
    elapsedSeconds: (Date.now() - started) / 1000,
    testPassed,
    testFailed,
    testSkipped,
    skipReasons,
  };
  checks.push(row);
  process.stdout.write(JSON.stringify(row) + "\n");
}
const after = await c6121QaSourceSnapshot(repository);
const evidence = c61211QaSchema.parse(
  c61211Artifact("c6-1-2-1-1-regression-evidence", {
    checks,
    sourceBeforeHash: before.semanticHash,
    sourceAfterHash: after.semanticHash,
    passed:
      checks.every((c) => c.passed) &&
      before.semanticHash === after.semanticHash,
    modelExecutionCount: 0,
    generatedAt: new Date().toISOString(),
  }),
);
await writeC61211(output, evidence);
process.stdout.write(
  JSON.stringify({
    passed: evidence.passed,
    stages: checks.length,
    sourceHash: after.semanticHash,
  }) + "\n",
);
if (!evidence.passed) process.exitCode = 1;
