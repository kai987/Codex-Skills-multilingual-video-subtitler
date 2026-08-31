import path from "node:path";
import { mkdir } from "node:fs/promises";
import {
  c612ValidationSchema,
  c612ShareableSchema,
  c612ShareableAuditSchema,
  c612GeneratedSchemas,
} from "@mvl/shared";
import {
  c612Arguments,
  fileManifest,
  treeFiles,
  writeArtifact,
} from "../packages/video-subtitler/src/consensus/top-k/c612-delivery-io.js";
import {
  validateC612Artifacts,
  auditC612ShareableValue,
  sameC612,
  c612SemanticComparison,
} from "../packages/video-subtitler/src/consensus/top-k/c612-artifact-validator.js";
import { decideC612Route } from "../packages/video-subtitler/src/consensus/top-k/c612-route-decision.js";
import {
  artifact,
  c612Defined,
} from "../packages/video-subtitler/src/consensus/top-k/c612-policy.js";
const keys = [
    "--a",
    "--b",
    "--qa",
    "--source",
    "--production-directory",
    "--fresh-runtime",
    "--output",
    "--network",
  ],
  arg = c612Arguments(keys, keys),
  repository = path.resolve(import.meta.dirname, ".."),
  output = path.resolve(arg("--output"));
for (const root of [repository, arg("--a"), arg("--b")])
  if (!path.relative(path.resolve(root), output).startsWith(".."))
    throw new Error("C612_VALIDATION_OUTPUT_MUST_NOT_MUTATE_INPUT_ROOT");
await mkdir(output, { recursive: false });
const result = await validateC612Artifacts({
  a: arg("--a"),
  b: arg("--b"),
  repository,
  qa: arg("--qa"),
  source: arg("--source"),
  productionDirectory: arg("--production-directory"),
  freshRuntime: arg("--fresh-runtime"),
  progress: (v) => process.stdout.write(v + "\n"),
});
const routes = [result.a, result.b].map((r) =>
  decideC612Route({
    frozen: r.frozen,
    cv: r.cv,
    retrieval: r.retrieval,
    material: r.material,
    engineeringChecks: result.checks,
  }),
);
sameC612(
  c612SemanticComparison(routes[0]),
  c612SemanticComparison(routes[1]),
  "C612_ROUTE_A_B_PARITY",
);
for (const [i, run] of [result.a, result.b].entries()) {
  const route = c612Defined(routes[i]);
  await writeArtifact(path.join(run.root, "evaluation"), route);
  const shareable = c612ShareableSchema.parse(
    artifact("c6-1-2-shareable-summary", {
      benchmark: "KNOWN_DEVELOPMENT_BENCHMARK",
      route: route.route,
      c613: route.c613,
      engineeringPassed: route.engineeringPassed,
      strongSupportPassed: route.strongSupportPassed,
      canonicalTextHash: run.frozen.baseline.canonicalTextHash,
      canonicalTimingHash: run.frozen.baseline.canonicalTimingHash,
      productionCueCount: run.frozen.production.cues.length,
      productionMutationCount: 0,
      asrInference: 0,
      verifierFresh: result.fresh.freshVerifierInference,
      verifierCacheHits: result.fresh.plannedRequests,
      profiles: run.cv.profiles,
      summaryOnly: true,
      candidateTextIncluded: false,
      goldTextIncluded: false,
      sourceAudioIncluded: false,
      packagePrivacy: "FULL_OUTPUT_IS_LOCAL_RESEARCH_ONLY",
    }),
  );
  const audit = auditC612ShareableValue(shareable);
  if (!audit.passed) throw new Error("C612_SHAREABLE_SUMMARY_UNSAFE");
  await writeArtifact(path.join(run.root, "shareable"), shareable);
  const files = await fileManifest(path.join(run.root, "shareable"), [
    "c6-1-2-shareable-summary.json",
  ]);
  await writeArtifact(
    path.join(run.root, "evaluation"),
    c612ShareableAuditSchema.parse(
      artifact("c6-1-2-shareable-audit", {
        files,
        checkedFiles: files.length,
        ...audit,
        scope: "SHAREABLE_SUMMARY_ONLY_NOT_FULL_LOCAL_ARTIFACTS",
      }),
    ),
  );
}
result.checks.push({
  name: "route-A-B-and-shareable-summary-audit",
  passed: true,
  observed:
    "identical route; summaries have zero private paths, secrets or raw-text fields",
  expected: "verified",
});
const passed = result.checks.every((c) => c.passed);
await writeArtifact(
  output,
  c612ValidationSchema.parse(
    artifact("c6-1-2-validation", {
      checks: result.checks,
      passed,
      files: await fileManifest(arg("--a"), await treeFiles(arg("--a"))),
      fileScope: "FINAL_A_TREE",
      schemaCount: c612GeneratedSchemas.length,
      validatedArtifactCount: result.validatedArtifactCount + 6,
      regressionEvidenceHash: result.qa.semanticHash,
      sourceCodeAggregateHash: result.a.frozen.freeze.codeAggregateHash,
      productionParity:
        result.checks.find(
          (c) => c.name === "source-and-production-live-parity",
        )?.passed ?? false,
      semanticParity:
        result.checks.find(
          (c) => c.name === "reranking-shadow-and-evaluation-A-B",
        )?.passed ?? false,
      regressionPassed:
        result.checks.find((c) => c.name === "full-QA-evidence-and-logs")
          ?.passed ?? false,
      rawGoldRuntimeInputCount: 0,
      networkUsed: false,
    }),
  ),
);
process.stdout.write(
  JSON.stringify({
    engineeringPassed: passed,
    route: c612Defined(routes[0]).route,
    strongSupportPassed: c612Defined(routes[0]).strongSupportPassed,
    c613: c612Defined(routes[0]).c613,
    checks: `${result.checks.filter((c) => c.passed).length}/${result.checks.length}`,
  }) + "\n",
);
if (!passed) process.exitCode = 1;
