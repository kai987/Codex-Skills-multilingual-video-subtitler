import path from "node:path";
import { mkdir, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import {
  c61211QaSchema,
  c61211ValidationSchema,
  c6121QaSchema,
} from "@mvl/shared";
import {
  c612Arguments,
  safeC612ArtifactPath,
} from "../packages/video-subtitler/src/consensus/top-k/c612-delivery-io.js";
import { c6121QaSourceSnapshot } from "../packages/video-subtitler/src/consensus/evaluation-recovery/qa-source-snapshot.js";
import { readC6121Artifact } from "../packages/video-subtitler/src/consensus/evaluation-recovery/baseline-freeze-verification.js";
import { installC6121OfflineGuard } from "../packages/video-subtitler/src/consensus/evaluation-recovery/offline-runtime-guard.js";
import {
  c61211Artifact,
  demand,
} from "../packages/video-subtitler/src/consensus/evaluation-partition/c61211-policy.js";
import {
  readC61211,
  writeC61211,
  c61211Files,
  shaBytes,
} from "../packages/video-subtitler/src/consensus/evaluation-partition/artifact-io.js";
import {
  validateC61211Run,
  validateC61211Tree,
  verifyC61211SchemaContracts,
  sameC61211,
  shareableC61211,
} from "../packages/video-subtitler/src/consensus/evaluation-partition/artifact-validator.js";
import { decideC61211Route } from "../packages/video-subtitler/src/consensus/evaluation-partition/terminal-route.js";

const keys = [
  "--a",
  "--b",
  "--qa",
  "--output",
  "--baseline",
  "--baseline-peer",
  "--baseline-validation",
  "--baseline-repository",
  "--frozen-repository",
  "--training-baseline-repository",
  "--network",
];
const arg = c612Arguments(keys, keys),
  guard = installC6121OfflineGuard();
const repository = path.resolve(import.meta.dirname, ".."),
  output = path.resolve(arg("--output"));
for (const root of [
  repository,
  arg("--a"),
  arg("--b"),
  arg("--baseline"),
  arg("--baseline-peer"),
  arg("--baseline-validation"),
])
  demand(
    path.relative(path.resolve(root), output).startsWith(".."),
    "C61211_ACCEPTANCE_OUTPUT_MUST_BE_INDEPENDENT",
  );
await mkdir(output, { recursive: false });
const qa = c61211QaSchema.parse(await readC61211(arg("--qa")));
demand(
  qa.passed &&
    qa.checks.every((c) => c.passed && c.exitCode === 0) &&
    qa.sourceBeforeHash === qa.sourceAfterHash,
  "C61211_QA_NOT_PASSED",
);
demand(
  (await c6121QaSourceSnapshot(repository)).semanticHash === qa.sourceAfterHash,
  "C61211_SOURCE_CHANGED_AFTER_QA",
);
const stages = [
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
  "c6-1-2-1-1-targeted",
  "historical-targeted",
  "python-ctc-unit",
  "skill",
];
sameC61211(
  qa.checks.map((c) => c.stage).sort(),
  stages.sort(),
  "C61211_QA_STAGE_MISSING",
);
for (const row of qa.checks)
  demand(
    shaBytes(
      await readFile(
        await safeC612ArtifactPath(path.dirname(arg("--qa")), row.logPath),
      ),
    ) === row.logSha256,
    "C61211_QA_LOG_CHANGED",
  );
const oldQaFiles = (await c61211Files(arg("--baseline-validation"))).filter(
  (n) => n.endsWith("c6-1-2-1-regression-evidence.json"),
);
demand(oldQaFiles.length > 0, "C61211_BASELINE_QA_MISSING");
for (const relative of oldQaFiles) {
  const old = c6121QaSchema.parse(
    await readC6121Artifact(path.join(arg("--baseline-validation"), relative)),
  );
  if (!old.passed) continue;
  for (const oldStage of old.checks.filter((c) => c.testPassed !== null)) {
    const current = qa.checks.find((c) => c.stage === oldStage.stage);
    demand(
      current &&
        (current.testPassed ?? -1) >= (oldStage.testPassed ?? 0) &&
        (current.testSkipped ?? Infinity) <= (oldStage.testSkipped ?? 0),
      "C61211_HISTORICAL_REGRESSION_COVERAGE_REDUCED:" + oldStage.stage,
    );
  }
}
const fresh = qa.checks.find((c) => c.stage === "c6-1-2-1-1-targeted");
demand(
  fresh &&
    (fresh.testPassed ?? 0) > 0 &&
    fresh.testSkipped === 0 &&
    fresh.testFailed === 0,
  "C61211_NEW_TESTS_NOT_ALL_EXECUTED",
);
const base = "43e3693288a73701a3ca9a5438b6aba5b2e2f43a";
const legacyTests = execFileSync(
  "git",
  ["ls-tree", "-r", "--name-only", base, "tests"],
  { cwd: repository, encoding: "utf8" },
)
  .trim()
  .split("\n");
const unchanged = [
  ...legacyTests,
  ".agents/skills/multilingual-grammar-report-generator",
  ".agents/skills/multilingual-grammar-learning-site-builder",
  "packages/grammar-report-core",
  "packages/site-builder-core",
  "apps/grammar-learning-site-template",
  "schemas/subtitle-package.schema.json",
  "packages/subtitle-core",
];
const prohibited = execFileSync("git", ["diff", base, "--", ...unchanged], {
  cwd: repository,
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
});
demand(
  prohibited.length === 0,
  "C61211_PRIOR_TESTS_SKILL_2_3_OR_V1_CONTRACT_CHANGED",
);
const schemaCount = await verifyC61211SchemaContracts(repository);
const paths = {
  repository,
  baseline: arg("--baseline"),
  baselinePeer: arg("--baseline-peer"),
  baselineValidation: arg("--baseline-validation"),
  baselineRepository: arg("--baseline-repository"),
  frozenRepository: arg("--frozen-repository"),
  trainingBaselineRepository: arg("--training-baseline-repository"),
};
const a = await validateC61211Run(arg("--a"), paths, (m) =>
  process.stdout.write("A " + m + "\n"),
);
const b = await validateC61211Run(arg("--b"), paths, (m) =>
  process.stdout.write("B " + m + "\n"),
);
const filesA = await c61211Files(a.directory),
  filesB = await c61211Files(b.directory);
sameC61211(filesA, filesB, "C61211_AB_FILESET_MISMATCH");
let semanticPairs = 0,
  bytePairs = 0;
for (const relative of filesA) {
  const left = await readFile(path.join(a.directory, relative)),
    right = await readFile(path.join(b.directory, relative));
  if (relative.endsWith(".json") && !relative.startsWith("research-shadow/")) {
    const l = await readC61211(path.join(a.directory, relative)),
      r = await readC61211(path.join(b.directory, relative));
    demand(
      l.semanticHash === r.semanticHash,
      "C61211_AB_SEMANTIC_MISMATCH:" + relative,
    );
    semanticPairs++;
  } else {
    demand(left.equals(right), "C61211_AB_SHADOW_BYTE_MISMATCH:" + relative);
    bytePairs++;
  }
}
const checks = [
  ...a.checks.map((c) => ({ ...c, name: "A:" + c.name })),
  ...b.checks.map((c) => ({ ...c, name: "B:" + c.name })),
  {
    name: "independent-A-B-semantic-and-byte-parity",
    passed: true,
    observed: `${semanticPairs} semantic artifact pairs; ${bytePairs} exact shadow byte pairs`,
    expected: "clock-independent semantics and exact research subtitle bytes",
  },
  {
    name: "full-QA-source-freeze-and-prior-assertions",
    passed: true,
    observed: `${qa.checks.length} stages; source ${qa.sourceAfterHash}; prior tests unchanged`,
    expected: "all checks passed, no prior assertions weakened",
  },
  {
    name: "strict-schemas-and-Skill2-3-v1-isolation",
    passed: true,
    observed: `${schemaCount} schemas; all 39 new contracts strict; no Skill2/3 or subtitle v1 change`,
    expected: "strict and isolated",
  },
];
const routes = [a, b].map((run) =>
  decideC61211Route({
    engineering: true,
    aBParity: true,
    productionMutation: 0,
    conservation: run.conservation,
    coverage: run.gate,
    bias: run.bias,
    frozen: run.frozenProfiles,
    retrained: run.retrainedProfiles,
    completeness: run.completeness,
  }),
);
sameC61211(routes[0], routes[1], "C61211_ROUTE_PARITY");
for (const [index, run] of [a, b].entries()) {
  const route = routes[index];
  demand(route, "C61211_FINAL_ROUTE_MISSING");
  await writeC61211(run.directory, route);
  await writeC61211(
    path.join(run.directory, "shareable"),
    shareableC61211(run, route),
  );
}
demand(
  guard().attemptedNetworkRequests === 0,
  "C61211_RESEARCH_NETWORK_ATTEMPT",
);
checks.push({
  name: "terminal-route-and-aggregate-only-shareable-audit",
  passed: true,
  observed:
    "identical routes; no Gold/candidate text, private absolute paths, secrets or media in shareable summaries",
  expected:
    "only aggregate shareable subdirectories; run roots remain local research",
});
const checkedArtifacts =
  (await validateC61211Tree(a.directory, repository)) +
  (await validateC61211Tree(b.directory, repository));
const validation = c61211ValidationSchema.parse(
  c61211Artifact("c6-1-2-1-1-validation", {
    checks,
    passed: checks.every((c) => c.passed),
    checkedArtifacts,
    schemaCount,
    aBSemanticParity: true,
    aBByteParity: true,
    productionParity: true,
    sourceReadOnly: true,
    goldReadOnly: true,
    modelExecutionCount: 0,
    networkDuringResearch: false,
    qaEvidenceHash: qa.semanticHash,
    generatedAt: new Date().toISOString(),
  }),
);
await writeC61211(output, validation);
process.stdout.write(
  JSON.stringify({
    engineeringGate: validation.passed,
    route: routes[0]?.route,
    coverage: routes[0]?.evaluationCoverageGate,
    strongSupport: routes[0]?.rerankerStrongSupportGate,
    checks: checks.length,
    checkedArtifacts,
    schemaCount,
    aBParity: true,
  }) + "\n",
);
