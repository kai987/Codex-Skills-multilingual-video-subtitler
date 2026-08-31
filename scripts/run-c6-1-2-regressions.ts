import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { z } from "zod";
import { c612RegressionSchema, type C612_QA_STAGES } from "@mvl/shared";
import {
  c612Arguments,
  fileManifest,
  writeArtifact,
} from "../packages/video-subtitler/src/consensus/top-k/c612-delivery-io.js";
import { c612RequiredSourceFiles } from "../packages/video-subtitler/src/consensus/top-k/c612-machine-stage.js";
import {
  artifact,
  hash,
} from "../packages/video-subtitler/src/consensus/top-k/c612-policy.js";
import { fileHash } from "../packages/video-subtitler/src/consensus/top-k/c612-acoustic-io.js";

const keys = [
  "--output",
  "--skill-validator",
  "--ctc-python",
  "--baseline-a",
  "--baseline-b",
  "--baseline-repository",
  "--baseline-regression",
  "--network",
];
const arg = c612Arguments(keys, keys),
  repository = path.resolve(import.meta.dirname, ".."),
  output = path.resolve(arg("--output"));
if (!path.relative(repository, output).startsWith(".."))
  throw new Error("C612_QA_OUTPUT_MUST_BE_EXTERNAL");
await mkdir(output, { recursive: false });
await mkdir(path.join(output, "logs"));
const before = await fileManifest(
  repository,
  await c612RequiredSourceFiles(repository),
);
const environment: NodeJS.ProcessEnv = {
  ...process.env,
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
type Stage = (typeof C612_QA_STAGES)[number];
interface Spec {
  stage: Stage;
  command: string;
  args: string[];
  testRun?: boolean;
  cwd?: string;
}
const testSpec = (stage: Stage, names: string[]): Spec => ({
  stage,
  command: process.execPath,
  args: ["node_modules/vitest/vitest.mjs", "run", ...names],
  testRun: true,
});
const specs: Spec[] = [
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
  testSpec("c6-1-targeted", [
    ...tests.filter((n) => /^c6-1-(?![12]-)/u.test(n)).map((n) => `tests/${n}`),
    "tests/e2e/c6-1-multi-asr-consensus-investigation-flow.test.ts",
  ]),
  testSpec("c6-1-1-targeted", [
    ...tests.filter((n) => n.startsWith("c6-1-1-")).map((n) => `tests/${n}`),
    "tests/e2e/c6-1-1-selective-mbr-flow.test.ts",
  ]),
  testSpec("c6-1-2-targeted", [
    ...tests.filter((n) => n.startsWith("c6-1-2-")).map((n) => `tests/${n}`),
    "tests/e2e/c6-1-2-top-k-reranking-investigation-flow.test.ts",
  ]),
  testSpec("historical-targeted", [
    ...tests
      .filter((n) =>
        /^(?:c[456]-|japanese-|presentation|subtitle|review)/u.test(n),
      )
      .map((n) => `tests/${n}`),
    "tests/e2e/c6-0-1-12-review-assistance-flow.test.ts",
    "tests/e2e/c6-1-multi-asr-consensus-investigation-flow.test.ts",
    "tests/e2e/c6-1-1-selective-mbr-flow.test.ts",
    "tests/e2e/c6-1-2-top-k-reranking-investigation-flow.test.ts",
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
  {
    stage: "c6-1-1-independent-acceptance",
    command: process.execPath,
    args: [
      "node_modules/tsx/dist/cli.mjs",
      "--tsconfig",
      "tsconfig.base.json",
      "scripts/validate-c6-1-1-selective-mbr.ts",
      "--a",
      arg("--baseline-a"),
      "--b",
      arg("--baseline-b"),
      "--repository",
      arg("--baseline-repository"),
      "--regression-evidence",
      arg("--baseline-regression"),
      "--output",
      path.join(output, "c611-independent"),
      "--network",
      "off",
    ],
    cwd: arg("--baseline-repository"),
  },
];
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
const checks: z.infer<typeof c612RegressionSchema>["checks"] = [];
for (const spec of specs) {
  const started = Date.now(),
    stem = spec.stage.replaceAll(":", "-"),
    report = path.join(output, "logs", `${stem}.tests.json`);
  const args = spec.testRun
    ? [...spec.args, "--reporter=json", `--outputFile=${report}`]
    : spec.args;
  process.stdout.write(`START ${spec.stage}\n`);
  const result = await new Promise<{ code: number; log: string }>((resolve) => {
    const child = spawn(spec.command, args, {
      cwd: spec.cwd ?? repository,
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
  let counts: { passed: number; failed: number; skipped: number } | null = null,
    skipReasons: string[] = [];
  if (spec.testRun) {
    try {
      const r = summarySchema.parse(JSON.parse(await readFile(report, "utf8")));
      counts = {
        passed: r.numPassedTests,
        failed: r.numFailedTests,
        skipped: r.numPendingTests,
      };
      skipReasons = r.testResults.flatMap((f) =>
        f.assertionResults
          .filter((t) => ["pending", "skipped", "todo"].includes(t.status))
          .map(
            (t) =>
              `${t.fullName}: existing optional real-model opt-in disabled; no inference in QA`,
          ),
      );
    } catch (e) {
      result.code = 1;
      result.log += `\nInvalid reporter JSON: ${String(e)}`;
    }
  } else if (spec.stage === "python-ctc-unit") {
    const match = /Ran (\d+) tests?/u.exec(result.log);
    if (!match || result.code !== 0) result.code = 1;
    counts = {
      passed: result.code === 0 ? Number(match?.[1] ?? 0) : 0,
      failed: result.code === 0 ? 0 : 1,
      skipped: 0,
    };
  }
  const logRelativePath = `logs/${stem}.log`;
  await writeFile(
    path.join(output, logRelativePath),
    stripVTControlCharacters(result.log) +
      `\nTEST_COUNTS ${JSON.stringify(counts)}\n`,
    { flag: "wx" },
  );
  checks.push({
    stage: spec.stage,
    command:
      spec.stage === "skill"
        ? "python3 <skill-creator>/quick_validate.py .agents/skills/multilingual-video-subtitler"
        : spec.stage === "python-ctc-unit"
          ? "<local-ctc-python> tests/runtime/c612_candidate_ctc_test.py"
          : [path.basename(spec.command), ...spec.args].join(" "),
    exitCode: result.code,
    durationMs: Date.now() - started,
    logRelativePath,
    logSha256: await fileHash(path.join(output, logRelativePath)),
    tests: counts,
    skipReasons,
  });
  process.stdout.write(
    JSON.stringify({
      stage: spec.stage,
      exitCode: result.code,
      tests: counts,
      durationMs: Date.now() - started,
    }) + "\n",
  );
}
const after = await fileManifest(
  repository,
  await c612RequiredSourceFiles(repository),
);
if (hash(before) !== hash(after))
  throw new Error("C612_SOURCE_CHANGED_DURING_QA");
await writeArtifact(
  output,
  c612RegressionSchema.parse(
    artifact("c6-1-2-regression-evidence", {
      sourceCodeAggregateHash: hash(before),
      sourceUnchangedDuringChecks: true,
      freshModelInferenceAllowed: false,
      rawGoldRead: false,
      checks,
    }),
  ),
);
if (checks.some((c) => c.exitCode !== 0)) process.exitCode = 1;
