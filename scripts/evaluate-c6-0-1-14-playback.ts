import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import * as shared from "@mvl/shared";
import { machineQualitySemanticHash } from "@mvl/video-subtitler";
import { c60StableHash } from "../packages/video-subtitler/src/finalization-risk-policy.js";
import { c60113HashPayload } from "../packages/video-subtitler/src/review/c60113-region-features.js";
import { evaluateC60114PlaybackCoverage } from "../packages/video-subtitler/src/review/playback-grounded-coverage-evaluator.js";
import { c60114GoldErrorComponents } from "./lib/c60114-post-freeze-evaluation.js";
import { verifyC60114MachineFreeze } from "./lib/c60114-freeze.js";
import { readC60114AcceptanceSnapshot } from "./validate-c6-0-1-14-runs.js";
import {
  c60113FileIdentity,
  c60113FileHash,
  assertC60113ReadOnlyIdentity,
  readC60113Json,
} from "./lib/c60113-acceptance-io.js";
import { allocateC60114Output } from "./lib/c60114-output.js";

const { values } = parseArgs({
  strict: true,
  options: Object.fromEntries(
    [
      "final-a",
      "final-b",
      "source",
      "gold",
      "gold-evaluation",
      "gold-evaluation-root",
      "quality-evaluation",
      "region-labels",
      "output-root",
      "output-stem",
      "code-validation",
    ].map((name) => [name, { type: "string" as const }]),
  ),
});
const required = (name: string): string => {
  const value = values[name];
  if (!value) throw new Error(`Missing --${name}`);
  return path.resolve(value);
};
const finalA = required("final-a"),
  finalB = required("final-b"),
  source = required("source");
const codePath = required("code-validation"),
  code = shared.c60114CodeValidationSchema.parse(
    await readC60113Json(codePath),
  );
if (
  !code.passed ||
  code.results.length !== 7 ||
  code.results.some((row) => !row.passed || row.exitCode !== 0)
)
  throw new Error("C60114_FULL_REGRESSION_REQUIRED_BEFORE_EVALUATION");
for (const row of code.results) {
  if (
    path.isAbsolute(row.logRelativePath) ||
    row.logRelativePath.split(/[\\/]/u).includes("..") ||
    (await c60113FileHash(
      path.join(path.dirname(codePath), row.logRelativePath),
    )) !== row.logSha256
  )
    throw new Error("C60114_CODE_LOG_BINDING_MISMATCH");
}
const [a, b] = await Promise.all([
  readC60114AcceptanceSnapshot(finalA, source, "final-a"),
  readC60114AcceptanceSnapshot(finalB, source, "final-b"),
]);
if (
  machineQualitySemanticHash(a.machineSemanticHashes) !==
    machineQualitySemanticHash(b.machineSemanticHashes) ||
  machineQualitySemanticHash(a.canonicalByteHashes) !==
    machineQualitySemanticHash(b.canonicalByteHashes)
)
  throw new Error("C60114_PRE_GOLD_AB_PARITY_FAILED");
const freezes = await Promise.all(
  [finalA, finalB].map(async (root) => ({
    value: shared.c60114MachineFreezeSchema.parse(
      await readC60113Json(
        path.join(root, "c6-0-1-14-machine-localization-freeze.json"),
      ),
    ),
    verification: await verifyC60114MachineFreeze({ root, sourcePath: source }),
  })),
);
const projections = shared.c60114CoverageProjectionsSchema.parse(
  await readC60113Json(path.join(finalA, "machine-coverage-projections.json")),
);
if (
  projections.semanticHash !== c60113HashPayload(projections) ||
  projections.variants.some(
    (row) => row.semanticHash !== c60113HashPayload(row),
  )
)
  throw new Error("C60114_PRE_GOLD_PROJECTION_HASH_MISMATCH");
const sourceBefore = await c60113FileIdentity(source);
// No label/Gold read occurs above this line. All nine projections and both
// independently materialized final graphs are immutable before the first read.
const firstGoldReadAt = new Date().toISOString();
if (freezes.some((row) => row.value.freezeCompletedAt >= firstGoldReadAt))
  throw new Error("C60114_FREEZE_TIME_NOT_BEFORE_GOLD");
const goldPath = required("gold"),
  goldBefore = await c60113FileIdentity(goldPath);
const qualityPath = required("quality-evaluation"),
  labelsPath = required("region-labels");
const qualityBefore = await c60113FileIdentity(qualityPath),
  labelsBefore = await c60113FileIdentity(labelsPath);
const quality = shared.c60112ReviewQualityEvaluationSchema.parse(
  await readC60113Json(qualityPath),
);
const labels = shared.c60113RegionLabelsSchema.parse(
  await readC60113Json(labelsPath),
);
const { semanticHash: qualityHash, ...qualityCore } = quality;
if (
  qualityHash !==
    machineQualitySemanticHash({ ...qualityCore, generatedAt: undefined }) ||
  labels.semanticHash !== c60113HashPayload(labels)
)
  throw new Error("C60114_UPSTREAM_LABEL_HASH_MISMATCH");
let goldEvaluationPath = values["gold-evaluation"]
  ? path.resolve(values["gold-evaluation"])
  : null;
if (!goldEvaluationPath) {
  // A bounded, post-freeze lookup by the already frozen byte hash, not by content
  // similarity, episode names, desired quality, or any machine selection rule.
  const root = required("gold-evaluation-root"),
    matches: string[] = [];
  for (const directory of await readdir(root, { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;
    const file = path.join(
      root,
      directory.name,
      "machine-vs-gold-evaluation.json",
    );
    try {
      if ((await c60113FileHash(file)) === quality.goldEvaluationArtifactSha256)
        matches.push(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  goldEvaluationPath = matches.sort()[0] ?? null;
  if (!goldEvaluationPath)
    throw new Error("C60114_UPSTREAM_GOLD_EVALUATION_NOT_FOUND_BY_FROZEN_HASH");
}
const upstreamBefore = await c60113FileIdentity(goldEvaluationPath);
const upstream = shared.machineVsGoldEvaluationSchema.parse(
  JSON.parse(await readFile(goldEvaluationPath, "utf8")) as unknown,
);
const { semanticHash: upstreamHash, ...upstreamCore } = upstream;
if (
  upstreamBefore.sha256 !== quality.goldEvaluationArtifactSha256 ||
  c60StableHash({
    ...upstreamCore,
    generatedAt: "<evaluation-time>",
    evaluationWallTimeMs: 0,
    goldIdentity: {
      ...upstream.goldIdentity,
      firstReadAt: "<gold-first-read-time>",
    },
  }) !== upstreamHash ||
  quality.sourceSha256Before !== sourceBefore.sha256 ||
  quality.sourceSha256After !== sourceBefore.sha256 ||
  quality.machineDraftHash !== a.canonicalByteHashes.PACKAGE ||
  quality.goldSha256Before !== goldBefore.sha256 ||
  quality.goldSha256After !== goldBefore.sha256 ||
  upstream.sourceIdentity.sha256 !== sourceBefore.sha256 ||
  upstream.goldIdentity.sha256 !== goldBefore.sha256 ||
  upstream.goldIdentity.size !== goldBefore.size ||
  !upstream.goldIdentity.readOnlyVerified ||
  !upstream.outputHashUnchangedAfterGold ||
  upstream.outputHashBeforeGold !== upstream.outputHashAfterGold ||
  labels.sourceEvaluationHash !== quality.semanticHash
)
  throw new Error("C60114_UPSTREAM_GOLD_BINDING_MISMATCH");
const components = c60114GoldErrorComponents(
  upstream,
  labels.errorComponents,
  a.sourceIdentity,
);
if (
  machineQualitySemanticHash(
    components.map((row) => row.errorComponentId).sort(),
  ) !==
  machineQualitySemanticHash(
    quality.errorComponents.map((row) => row.errorComponentId).sort(),
  )
)
  throw new Error("C60114_FROZEN_ERROR_COMPONENT_DENOMINATOR_MISMATCH");
const evaluations = projections.variants.map((variant) => ({
  stage: variant.stage,
  evaluation: evaluateC60114PlaybackCoverage({
    ...variant.projection,
    errorComponents: components,
    generatedAt: firstGoldReadAt,
    engineeringGates: {
      engineeringPassed: true,
      baselineParityPassed: true,
      runtimeGoldInputCount: 0,
      canonicalMutationCount: 0,
      machineDraftMutationCount: 0,
      sourceMutationCount: 0,
      goldMutationCount: 0,
      machineFreezeVerified: true,
    },
  }),
}));
const sourceAfter = await c60113FileIdentity(source),
  goldAfter = await c60113FileIdentity(goldPath);
assertC60113ReadOnlyIdentity(sourceBefore, sourceAfter);
assertC60113ReadOnlyIdentity(goldBefore, goldAfter);
assertC60113ReadOnlyIdentity(
  qualityBefore,
  await c60113FileIdentity(qualityPath),
);
assertC60113ReadOnlyIdentity(
  labelsBefore,
  await c60113FileIdentity(labelsPath),
);
assertC60113ReadOnlyIdentity(
  upstreamBefore,
  await c60113FileIdentity(goldEvaluationPath),
);
await Promise.all(
  [finalA, finalB].map((root) =>
    verifyC60114MachineFreeze({ root, sourcePath: source }),
  ),
);
const freezeA = freezes[0],
  freezeB = freezes[1];
if (!freezeA || !freezeB) throw new Error("C60114_DUAL_FREEZE_REQUIRED");
const auditCore = {
  schemaVersion: "1.0.0",
  artifactType: "c6-0-1-14-post-freeze-evaluation-audit",
  visibility: "LOCAL_ONLY",
  generatedAt: new Date().toISOString(),
  firstGoldReadAt,
  finalAFreezeHash: a.freezeByteSha256,
  finalBFreezeHash: b.freezeByteSha256,
  finalAFreezeCompletedAt: freezeA.value.freezeCompletedAt,
  finalBFreezeCompletedAt: freezeB.value.freezeCompletedAt,
  projectionSemanticHash: projections.semanticHash,
  projectionVariantCount: 9,
  machineFilesVerifiedBeforeGold: freezes.reduce(
    (n, row) => n + row.verification.verifiedArtifactCount,
    0,
  ),
  freezeBeforeGold: true,
  machineABSemanticParity: true,
  canonicalABByteParity: true,
  sourceIdentityBefore: sourceBefore,
  sourceIdentityAfter: sourceAfter,
  goldIdentityBefore: goldBefore,
  goldIdentityAfter: goldAfter,
  upstreamGoldEvaluationHash: upstreamBefore.sha256,
  upstreamQualityEvaluationHash: qualityBefore.sha256,
  upstreamRegionLabelsHash: labelsBefore.sha256,
  codeValidationByteHash: await c60113FileHash(codePath),
  sourceReadOnly: true,
  goldReadOnly: true,
  runtimeGoldInputCount: 0,
  evaluatorGoldInputCount: 1,
  newInferenceCount: 0,
  modelLoadCount: 0,
  providerProcessStartCount: 0,
  matchingRulesChanged: false,
  canonicalMutationCount: 0,
  rankerRetrained: false,
  newOofRun: false,
};
const audit = shared.c60114PostFreezeEvaluationAuditSchema.parse({
  ...auditCore,
  semanticHash: machineQualitySemanticHash(auditCore),
});
const directory = await allocateC60114Output(
  required("output-root"),
  values["output-stem"] ?? "c60114-playback-evaluation",
);
for (const row of evaluations)
  await shared.atomicWriteJson(
    path.join(directory, `${row.stage}-playback-coverage-evaluation.json`),
    row.evaluation,
  );
const final = evaluations.at(-1);
if (!final) throw new Error("C60114_A8_EVALUATION_REQUIRED");
await shared.atomicWriteJson(
  path.join(directory, "c6-0-1-14-playback-coverage-evaluation.json"),
  final.evaluation,
);
// Required delivery names are byte-equivalent aliases of the same strict
// post-freeze evaluation, not separately recomputed or relaxed results.
for (const name of [
  "gold-review-playback-coverage-integrity.json",
  "c6-0-1-14-missing-hallucination-evaluation.json",
])
  await shared.atomicWriteJson(path.join(directory, name), final.evaluation);
await shared.atomicWriteJson(
  path.join(directory, "c6-0-1-14-route-decision.json"),
  final.evaluation.routeDecision,
);
await shared.atomicWriteJson(
  path.join(directory, "c6-0-1-14-post-freeze-evaluation-audit.json"),
  audit,
);
process.stdout.write(
  `${JSON.stringify({ directory, audit, route: final.evaluation.routeDecision, budgets: final.evaluation.budgets.map((row) => ({ plan: row.planId, missing: row.officialMissingRecall, hallucination: row.officialHallucinationRecall, integrity: row.integrityFailures })) }, null, 2)}\n`,
);
