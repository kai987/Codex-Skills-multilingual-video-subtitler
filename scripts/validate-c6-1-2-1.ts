import path from "node:path";
import { mkdir, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { c6121QaSchema, c6121ValidationSchema } from "@mvl/shared";
import {
  c612Arguments,
  treeFiles,
} from "../packages/video-subtitler/src/consensus/top-k/c612-delivery-io.js";
import {
  c6121Artifact,
  demand,
  hash,
} from "../packages/video-subtitler/src/consensus/evaluation-recovery/c6121-policy.js";
import {
  readC6121Artifact,
  writeC6121Artifact,
  fingerprintC6121,
} from "../packages/video-subtitler/src/consensus/evaluation-recovery/baseline-freeze-verification.js";
import {
  validateC6121Run,
  validateC6121Tree,
  verifyC6121SchemaContracts,
  sameC6121,
  c6121ShareableSummary,
} from "../packages/video-subtitler/src/consensus/evaluation-recovery/c6121-artifact-validator.js";
import { decideC6121Route } from "../packages/video-subtitler/src/consensus/evaluation-recovery/c6121-route-decision.js";
import { c6121QaSourceSnapshot } from "../packages/video-subtitler/src/consensus/evaluation-recovery/qa-source-snapshot.js";
import { installC6121OfflineGuard } from "../packages/video-subtitler/src/consensus/evaluation-recovery/offline-runtime-guard.js";
const keys = [
  "--a",
  "--b",
  "--qa",
  "--output",
  "--frozen-repository",
  "--baseline-repository",
  "--network",
];
const arg = c612Arguments(keys, keys),
  guard = installC6121OfflineGuard();
const repository = path.resolve(import.meta.dirname, ".."),
  output = path.resolve(arg("--output"));
for (const root of [repository, arg("--a"), arg("--b")])
  demand(
    path.relative(path.resolve(root), output).startsWith(".."),
    "C6121_ACCEPTANCE_OUTPUT_MUST_BE_INDEPENDENT",
  );
await mkdir(output, { recursive: false });
const qa = c6121QaSchema.parse(await readC6121Artifact(arg("--qa")));
demand(
  qa.passed &&
    qa.checks.every((c) => c.passed && c.exitCode === 0) &&
    qa.sourceBeforeHash === qa.sourceAfterHash,
  "C6121_QA_NOT_PASSED",
);
demand(
  (await c6121QaSourceSnapshot(repository)).semanticHash === qa.sourceAfterHash,
  "C6121_SOURCE_CHANGED_AFTER_QA",
);
const expectedStages = [
  "generate:schemas",
  "typecheck",
  "lint",
  "format:check",
  "build",
  "unit",
  "e2e",
  "c6-1-targeted",
  "c6-1-1-targeted",
  "c6-1-2-targeted",
  "c6-1-2-1-targeted",
  "historical-targeted",
  "python-ctc-unit",
  "skill",
];
sameC6121(
  qa.checks.map((c) => c.stage).sort(),
  expectedStages.sort(),
  "C6121_QA_STAGE_MISSING",
);
for (const row of qa.checks)
  demand(
    (
      await fingerprintC6121(
        path.join(path.dirname(arg("--qa")), row.logPath),
        "qa-log",
      )
    ).sha256 === row.logSha256,
    "C6121_QA_LOG_CHANGED",
  );
const minimum = {
  unit: 1202,
  e2e: 60,
  "c6-1-targeted": 113,
  "c6-1-1-targeted": 197,
  "c6-1-2-targeted": 69,
  "historical-targeted": 1077,
  "python-ctc-unit": 6,
};
for (const [stage, count] of Object.entries(minimum))
  demand(
    (qa.checks.find((c) => c.stage === stage)?.testPassed ?? 0) >= count,
    "C6121_HISTORICAL_TEST_COVERAGE_REDUCED:" + stage,
  );
const schemaCount = await verifyC6121SchemaContracts(repository);
const a = await validateC6121Run(
  arg("--a"),
  repository,
  arg("--frozen-repository"),
  arg("--baseline-repository"),
  (m) => process.stdout.write("A " + m + "\n"),
);
const b = await validateC6121Run(
  arg("--b"),
  repository,
  arg("--frozen-repository"),
  arg("--baseline-repository"),
  (m) => process.stdout.write("B " + m + "\n"),
);
const filesA = await treeFiles(a.directory),
  filesB = await treeFiles(b.directory);
sameC6121(filesA, filesB, "C6121_A_B_FILESET_MISMATCH");
let bytePairs = 0;
for (const relative of filesA) {
  const left = await readFile(path.join(a.directory, relative)),
    right = await readFile(path.join(b.directory, relative));
  if (relative.endsWith(".json") && !relative.startsWith("research-shadow/")) {
    const l = JSON.parse(left.toString("utf8")) as { semanticHash?: string },
      r = JSON.parse(right.toString("utf8")) as { semanticHash?: string };
    demand(
      l.semanticHash && l.semanticHash === r.semanticHash,
      "C6121_A_B_SEMANTIC_MISMATCH:" + relative,
    );
  } else {
    demand(left.equals(right), "C6121_A_B_SHADOW_BYTE_MISMATCH:" + relative);
    bytePairs++;
  }
}
const prohibited = execFileSync(
  "git",
  [
    "diff",
    "d7667e30aac250b5f36ffd38f70637f858e0aff5",
    "--",
    ".agents/skills/multilingual-grammar-report-generator",
    ".agents/skills/multilingual-grammar-learning-site-builder",
    "packages/grammar-report-core",
    "packages/site-builder-core",
    "apps/grammar-learning-site-template",
  ],
  { cwd: repository, encoding: "utf8" },
);
demand(prohibited.length === 0, "C6121_SKILL_2_3_CHANGED");
const checks = [
  ...a.checks.map((c) => ({ ...c, name: "A:" + c.name })),
  ...b.checks.map((c) => ({ ...c, name: "B:" + c.name })),
  {
    name: "independent-A-B-semantic-and-byte-parity",
    passed: true,
    observed: `${filesA.length} file pairs; ${bytePairs} exact shadow byte pairs`,
    expected: "same semantics except run clocks",
  },
  {
    name: "full-QA-and-source-freeze",
    passed: true,
    observed: `${qa.checks.length} stages passed; source ${qa.sourceAfterHash}`,
    expected: "full regression without real acoustic opt-ins",
  },
  {
    name: "strict-schema-generation-and-Skill2-3-isolation",
    passed: true,
    observed: `${schemaCount} generated schemas; no Skill2/3 diff`,
    expected: "strict and unchanged",
  },
];
const routes = [a, b].map((run) =>
  decideC6121Route({
    engineering: true,
    aBParity: true,
    productionMutation: 0,
    coverage: run.coverage,
    integrity: run.integrity,
    frozen: run.frozenMetrics.profiles,
    retrained: run.retrainedMetrics.profiles,
    completeness: run.diagnosis,
  }),
);
sameC6121(routes[0], routes[1], "C6121_ROUTE_PARITY");
for (const [index, run] of [a, b].entries()) {
  const route = routes[index];
  demand(route, "C6121_ROUTE_MISSING");
  await writeC6121Artifact(run.directory, route);
  await writeC6121Artifact(
    path.join(run.directory, "shareable"),
    c6121ShareableSummary(run, route),
  );
}
demand(guard().attemptedNetworkRequests === 0, "C6121_NETWORK_ATTEMPT");
checks.push({
  name: "route-and-aggregate-only-shareable-audit",
  passed: true,
  observed:
    "identical final routes; no private paths, secrets, Gold/candidate text or audio",
  expected: "safe aggregate summaries only",
});
const finalCount =
  (await validateC6121Tree(a.directory, repository)) +
  (await validateC6121Tree(b.directory, repository));
const validation = c6121ValidationSchema.parse(
  c6121Artifact("c6-1-2-1-validation", {
    checks,
    passed: checks.every((c) => c.passed),
    checkedArtifacts: finalCount,
    schemaCount,
    aBSemanticParity: true,
    aBByteParity: true,
    productionParity: true,
    inputReadOnly: true,
    goldReadOnly: true,
    sourceReadOnly: true,
    modelExecutionCount: 0,
    networkDuringResearch: false,
    qaEvidenceHash: qa.semanticHash,
    generatedAt: new Date().toISOString(),
  }),
);
await writeC6121Artifact(output, validation);
process.stdout.write(
  JSON.stringify({
    engineeringGate: true,
    route: routes[0]?.route,
    evaluationCoverageGate: routes[0]?.evaluationCoverageGate,
    strongSupportGate: routes[0]?.rerankerStrongSupportGate,
    checks: checks.length,
    artifacts: finalCount,
    schemaCount,
    A_B: true,
    sourceHash: hash(a.readOnly),
  }) + "\n",
);
