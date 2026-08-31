import path from "node:path";
import { readdir } from "node:fs/promises";
import { parseArgs } from "node:util";
import * as shared from "@mvl/shared";
import { machineQualitySemanticHash } from "@mvl/video-subtitler";
import { c60StableHash } from "../packages/video-subtitler/src/finalization-risk-policy.js";
import { c60113HashPayload } from "../packages/video-subtitler/src/review/c60113-region-features.js";
import { c60114GoldErrorComponents } from "./lib/c60114-post-freeze-evaluation.js";
import { verifyFreeze141 } from "./lib/c601141-freeze.js";
import { verifyMachineCode141 } from "./lib/c601141-code-freeze.js";
import {
  identity141,
  readJson141,
  durableJson141,
  fileHash141,
  safeRelative141,
} from "../packages/video-subtitler/src/review/c601141-io.js";
import {
  hash141,
  hashed141,
  assertHash141,
} from "../packages/video-subtitler/src/review/c601141-policy.js";
import {
  evaluateInventory141,
  officialBudget141,
} from "../packages/video-subtitler/src/review/c601141-evaluation.js";
import { verifyPhysicalAudio141 } from "../packages/video-subtitler/src/review/c601141-review-delivery.js";

const { values } = parseArgs({
  strict: true,
  options: Object.fromEntries(
    [
      "state",
      "code-validation",
      "gold",
      "gold-evaluation",
      "gold-evaluation-root",
      "quality-evaluation",
      "region-labels",
    ].map((name) => [name, { type: "string" as const }]),
  ),
});
const required = (name: string) => {
  const value = values[name];
  if (!value) throw new Error(`C601141_REQUIRED_OPTION:${name}`);
  return path.resolve(value);
};
const state = (await readJson141(required("state"))) as {
  config: { outputRoot: string; source: string };
  outputs: Record<string, string>;
  policyPath: string;
};
const dir = (name: string) => {
  const result = state.outputs[name];
  if (!result) throw new Error(`C601141_OUTPUT_MISSING:${name}`);
  return result;
};
const source = state.config.source,
  outputRoot = state.config.outputRoot,
  finalA = dir("final-a"),
  finalB = dir("final-b");
const codePath = required("code-validation"),
  code = shared.c601141CodeValidationSchema.parse(await readJson141(codePath));
if (
  !code.passed ||
  code.results.some((row) => !row.passed || row.exitCode !== 0)
)
  throw new Error("C601141_FULL_REGRESSION_REQUIRED_BEFORE_GOLD");
for (const row of code.results) {
  const file = path.resolve(path.dirname(codePath), row.logRelativePath);
  safeRelative141(path.dirname(codePath), file);
  if ((await fileHash141(file)) !== row.logSha256)
    throw new Error("C601141_CODE_VALIDATION_LOG_HASH_CHANGED");
}
const freezes = await Promise.all(
  [finalA, finalB].map((root) =>
    verifyFreeze141(
      outputRoot,
      path.join(root, "c6-0-1-14-1-machine-speech-inventory-freeze.json"),
      source,
    ),
  ),
);
for (const root of [finalA, finalB]) {
  await verifyMachineCode141(
    process.cwd(),
    path.join(root, "machine-code-snapshot.json"),
  );
  const audio = shared.c601141AudioManifestSchema.parse(
    await readJson141(path.join(root, "machine-review-audio-manifest-v4.json")),
  );
  await verifyPhysicalAudio141(path.join(root, "review-workspace"), audio);
}
const [a, b] = freezes;
if (!a || !b) throw new Error("C601141_DUAL_FINAL_FREEZE_REQUIRED");
if (!a.acquisitionSummary || !b.acquisitionSummary)
  throw new Error("C601141_FINAL_ACQUISITION_SUMMARY_REQUIRED");
const snapshot = (freeze: typeof a, root: string) => {
  const prefix = `${safeRelative141(outputRoot, root)}/`;
  return freeze.artifacts
    .filter((row) => row.relativePath.startsWith(prefix))
    .map((row) => ({
      path: row.relativePath.slice(prefix.length),
      hash: row.byteHash,
    }));
};
if (hash141(snapshot(a, finalA)) !== hash141(snapshot(b, finalB)))
  throw new Error("C601141_FINAL_AB_BYTE_PARITY_FAILED");
const projections = shared.c601141CoverageProjectionsSchema.parse(
  await readJson141(path.join(finalA, "machine-coverage-projections.json")),
);
assertHash141(projections);
projections.variants.forEach(assertHash141);
const policy = shared.c601141PolicySchema.parse(
  await readJson141(state.policyPath),
);
const inventory = shared.c601141InventorySchema.parse(
  await readJson141(
    path.join(finalA, "machine-source-global-speech-inventory-v4.json"),
  ),
);
const fingerprint = shared.c601141FingerprintSchema.parse(
  await readJson141(
    path.join(finalA, "machine-legacy-audio-fingerprint-reconciliation.json"),
  ),
);
const safety = shared.c601141SafetySchema.parse(
  await readJson141(
    path.join(finalA, "machine-missing-safety-reserve-targets-v1.json"),
  ),
);
const packageEntry = a.protectedMachineFiles.find((v) =>
  v.relativePath.endsWith("/subtitle-package.needs-review.json"),
);
if (!packageEntry)
  throw new Error("C601141_CANONICAL_PACKAGE_IDENTITY_MISSING");
const sourceBefore = await identity141(source);
// Gold, labels and prior Gold-linked evaluations are opened ONLY below this
// barrier, after both machine graphs, byte hashes, physical audio and code gates.
const firstGoldReadAt = new Date().toISOString();
if (
  freezes.some(
    (row) =>
      row.stage !== "FINAL_MACHINE_DELIVERY" ||
      row.freezeCompletedAt >= firstGoldReadAt,
  )
)
  throw new Error("C601141_FREEZE_NOT_BEFORE_GOLD");
const goldPath = required("gold"),
  goldBefore = await identity141(goldPath);
const qualityPath = required("quality-evaluation"),
  labelsPath = required("region-labels");
const qualityBefore = await identity141(qualityPath),
  labelsBefore = await identity141(labelsPath);
const quality = shared.c60112ReviewQualityEvaluationSchema.parse(
  await readJson141(qualityPath),
);
const labels = shared.c60113RegionLabelsSchema.parse(
  await readJson141(labelsPath),
);
const { semanticHash: qualityHash, ...qualityCore } = quality;
if (
  qualityHash !==
    machineQualitySemanticHash({ ...qualityCore, generatedAt: undefined }) ||
  labels.semanticHash !== c60113HashPayload(labels)
)
  throw new Error("C601141_UPSTREAM_LABEL_HASH_MISMATCH");
let upstreamPath = values["gold-evaluation"]
  ? path.resolve(values["gold-evaluation"])
  : null;
if (!upstreamPath) {
  const root = required("gold-evaluation-root"),
    matches: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true }))
    if (entry.isDirectory()) {
      const file = path.join(
        root,
        entry.name,
        "machine-vs-gold-evaluation.json",
      );
      try {
        if ((await fileHash141(file)) === quality.goldEvaluationArtifactSha256)
          matches.push(file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  upstreamPath = matches.sort()[0] ?? null;
  if (!upstreamPath)
    throw new Error("C601141_UPSTREAM_EVALUATION_NOT_FOUND_BY_FROZEN_HASH");
}
const upstreamBefore = await identity141(upstreamPath),
  upstream = shared.machineVsGoldEvaluationSchema.parse(
    await readJson141(upstreamPath),
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
  quality.machineDraftHash !== packageEntry.byteHash ||
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
  throw new Error("C601141_GOLD_SOURCE_CANONICAL_LABEL_BINDING_MISMATCH");
const components = c60114GoldErrorComponents(
  upstream,
  labels.errorComponents,
  a.sourceIdentity,
);
if (
  hash141(components.map((v) => v.errorComponentId).sort()) !==
  hash141(quality.errorComponents.map((v) => v.errorComponentId).sort())
)
  throw new Error("C601141_GOLD_DENOMINATOR_CHANGED");
const evaluation = evaluateInventory141({
  projections,
  components,
  inventory,
  fingerprint,
  safety,
  policy,
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
});
const machinePackage = shared.subtitlePackageSchema.parse(
  await readJson141(path.join(outputRoot, packageEntry.relativePath)),
);
let machineOverlapCount = 0;
for (let i = 0; i < machinePackage.cues.length; i++) {
  const cue = machinePackage.cues[i];
  if (!cue) continue;
  for (const next of machinePackage.cues.slice(i + 1))
    if (Math.min(cue.end, next.end) > Math.max(cue.start, next.start))
      machineOverlapCount++;
}
const qualityParity = shared.c601141MachineQualityParitySchema.parse(
  hashed141({
    schemaVersion: "1.0.0",
    artifactType: "c6-0-1-14-1-machine-subtitle-parity-quality",
    baselineEvaluationByteHash: upstreamBefore.sha256,
    machinePackageByteHash: packageEntry.byteHash,
    machinePackageABByteParity: true,
    metricComputation:
      "REUSE_HASH_BOUND_BASELINE_METRICS_FOR_BYTE_IDENTICAL_SUBTITLES",
    globalTextMetrics: upstream.globalTextMetrics,
    alignmentMetrics: upstream.alignmentMetrics,
    timingMetrics: upstream.timingMetrics,
    coverageMetrics: upstream.coverageMetrics,
    missingDialogueCount: upstream.missingDialogueCandidates.length,
    hallucinationCount: upstream.hallucinationCandidates.length,
    materialTextErrorCount: upstream.materialTextErrors.length,
    severeTimingErrorCount: upstream.severeTimingErrors.length,
    machineOverlapCount,
    canonicalMutationCount: 0,
    productionStatus: "needs-review",
    finalizationMethod: "none",
    c602Status: "HOLD",
  }),
);
const sourceAfter = await identity141(source),
  goldAfter = await identity141(goldPath);
for (const [before, after] of [
  [sourceBefore, sourceAfter],
  [goldBefore, goldAfter],
  [qualityBefore, await identity141(qualityPath)],
  [labelsBefore, await identity141(labelsPath)],
  [upstreamBefore, await identity141(upstreamPath)],
] as const)
  if (hash141(before) !== hash141(after))
    throw new Error("C601141_POST_EVALUATION_READ_ONLY_IDENTITY_CHANGED");
for (const root of [finalA, finalB])
  await verifyFreeze141(
    outputRoot,
    path.join(root, "c6-0-1-14-1-machine-speech-inventory-freeze.json"),
    source,
  );
const audit = shared.c601141EvaluationAuditSchema.parse(
  hashed141({
    schemaVersion: "1.0.0",
    artifactType: "c6-0-1-14-1-post-freeze-evaluation-audit",
    visibility: "LOCAL_ONLY",
    firstGoldReadAt,
    finalAFreezeHash: a.semanticHash,
    finalBFreezeHash: b.semanticHash,
    finalAFreezeCompletedAt: a.freezeCompletedAt,
    finalBFreezeCompletedAt: b.freezeCompletedAt,
    projectionSemanticHash: projections.semanticHash,
    codeValidationByteHash: await fileHash141(codePath),
    machineABSemanticParity: true,
    canonicalABByteParity: true,
    freezeBeforeGold: true,
    sourceIdentityBefore: sourceBefore,
    sourceIdentityAfter: sourceAfter,
    goldIdentityBefore: goldBefore,
    goldIdentityAfter: goldAfter,
    upstreamGoldEvaluationHash: upstreamBefore.sha256,
    upstreamQualityEvaluationHash: qualityBefore.sha256,
    upstreamRegionLabelsHash: labelsBefore.sha256,
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
  }),
);
await durableJson141(
  path.join(
    dir("speech-evaluation"),
    "gold-c6-0-1-14-1-speech-inventory-evaluation.json",
  ),
  evaluation,
);
await durableJson141(
  path.join(
    dir("speech-evaluation"),
    "c6-0-1-14-1-post-freeze-evaluation-audit.local-only.json",
  ),
  audit,
);
await durableJson141(
  path.join(dir("speech-evaluation"), "c6-0-1-14-1-route-decision.json"),
  evaluation.route,
);
await durableJson141(
  path.join(
    dir("speech-evaluation"),
    "c6-0-1-14-1-machine-subtitle-parity-quality.json",
  ),
  qualityParity,
);
const final = evaluation.variants.at(-1);
if (!final) throw new Error("C601141_FINAL_EVALUATION_MISSING");
const full = officialBudget141(final.evaluation);
console.log(
  JSON.stringify(
    {
      route: evaluation.route.primaryDecision,
      missing: full.officialMissingRecall,
      hallucination: full.officialHallucinationRecall,
      burden: evaluation.burden,
      freezeBeforeGold: audit.freezeBeforeGold,
      runtimeGoldInputCount: 0,
    },
    null,
    2,
  ),
);
