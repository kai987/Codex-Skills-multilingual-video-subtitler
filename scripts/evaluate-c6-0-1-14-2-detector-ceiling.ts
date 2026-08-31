import path from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { parseArgs } from "node:util";
import * as shared from "@mvl/shared";
import { machineQualitySemanticHash } from "@mvl/video-subtitler";
import {
  config142Schema,
  loadBaseline142,
  type State142,
} from "./lib/c601142-input.js";
import {
  verifyFinalFreeze142,
  machineCodeSnapshot142,
} from "./lib/c601142-final.js";
import { verifyProjectionAudio142 } from "./lib/c601142-coverage-projection.js";
import { persistFirstRead142 } from "./lib/c601142-first-read.js";
import { c60114GoldErrorComponents } from "./lib/c60114-post-freeze-evaluation.js";
import { c60StableHash } from "../packages/video-subtitler/src/finalization-risk-policy.js";
import { c60113HashPayload } from "../packages/video-subtitler/src/review/c60113-region-features.js";
import {
  evaluate142,
  officialBudget142,
} from "../packages/video-subtitler/src/review/c601142-evaluation.js";
import { decodeScores142 } from "../packages/video-subtitler/src/review/c601142-scores.js";
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
  required141,
} from "../packages/video-subtitler/src/review/c601141-policy.js";

const { values } = parseArgs({
  strict: true,
  options: Object.fromEntries(
    [
      "state",
      "code-validation",
      "browser-audit",
      "gold",
      "gold-evaluation",
      "gold-evaluation-root",
      "quality-evaluation",
      "region-labels",
    ].map((name) => [name, { type: "string" as const }]),
  ),
});
const arg = (name: string) => path.resolve(required141(values[name]));
const state = (await readJson141(arg("state"))) as State142,
  config = config142Schema.parse(state.config),
  old = await loadBaseline142(config);
if (state.configHash !== hash141(config))
  throw new Error("C601142_EVALUATOR_CONFIG_CHANGED");
const dir = (role: string) => required141(state.outputs[role]),
  source = old.config.source,
  outputRoot = config.outputRoot;
const codePath = arg("code-validation"),
  browserPath = arg("browser-audit");
const code = shared.codeValidation142Schema.parse(await readJson141(codePath)),
  browser = shared.browserAudit142Schema.parse(await readJson141(browserPath));
if (!code.passed || !browser.passed)
  throw new Error("C601142_CODE_AND_BROWSER_ACCEPTANCE_REQUIRED_BEFORE_GOLD");
for (const check of code.results) {
  const log = path.resolve(path.dirname(codePath), check.logRelativePath);
  safeRelative141(path.dirname(codePath), log);
  if (
    !check.passed ||
    check.exitCode !== 0 ||
    (await fileHash141(log)) !== check.logSha256
  )
    throw new Error("C601142_CODE_LOG_CHANGED_OR_FAILED");
}
const a = await verifyFinalFreeze142(outputRoot, dir("final-a"), source),
  b = await verifyFinalFreeze142(outputRoot, dir("final-b"), source);
const codeSnapshot = await machineCodeSnapshot142(process.cwd());
if (
  a.codeSnapshotHash !== codeSnapshot.semanticHash ||
  b.codeSnapshotHash !== codeSnapshot.semanticHash
)
  throw new Error("C601142_CODE_CHANGED_AFTER_DUAL_FREEZE");
const snapshot = (freeze: typeof a, root: string) => {
  const prefix = `${safeRelative141(outputRoot, root)}/`;
  return freeze.artifacts
    .filter((r) => r.relativePath.startsWith(prefix))
    .map((r) => ({
      path: r.relativePath.slice(prefix.length),
      hash: r.byteHash,
    }));
};
if (
  hash141(snapshot(a, dir("final-a"))) !== hash141(snapshot(b, dir("final-b")))
)
  throw new Error("C601142_FINAL_AB_BYTE_PARITY_FAILED");
if (
  a.projectionHash !== b.projectionHash ||
  a.reviewWorkspaceHash !== b.reviewWorkspaceHash ||
  a.replayAccountingHash !== b.replayAccountingHash
)
  throw new Error("C601142_FINAL_AB_SEMANTIC_PARITY_FAILED");
const projections = shared.projections142Schema.parse(
  await readJson141(
    path.join(dir("final-a"), "machine-coverage-projections.json"),
  ),
);
assertHash141(projections);
for (const root of [dir("final-a"), dir("final-b")]) {
  for (const row of [...projections.variants, ...projections.comparisonPlans])
    await verifyProjectionAudio142(
      path.join(root, row.workspaceRelativePath),
      row.projection,
    );
  if (
    (await fileHash141(
      path.join(root, "review-workspace/review-data.json"),
    )) !== browser.workspaceDataByteHash ||
    (await fileHash141(
      path.join(root, "review-workspace/assets/review.js"),
    )) !== browser.workspaceJavascriptByteHash
  )
    throw new Error("C601142_BROWSER_TESTED_DIFFERENT_WORKSPACE");
}
const policy = shared.policy142Schema.parse(
  await readJson141(state.policyPath),
);
const readFinal = (name: string) =>
  readJson141(path.join(dir("final-a"), name));
const inventory = shared.inventory142Schema.parse(
  await readFinal("machine-source-global-speech-inventory-v5.json"),
);
const safety = shared.safety142Schema.parse(
  await readFinal("machine-missing-safety-reserve-targets-v2.json"),
);
const uncovered = shared.uncovered142Schema.parse(
  await readFinal("machine-uncovered-speech-candidates-v2.json"),
);
const clusters = shared.clusters142Schema.parse(
  await readFinal("machine-safety-target-clusters-v2.json"),
);
const masked = shared.masked142Schema.parse(
  await readFinal("machine-masked-speech-candidates-v1.json"),
);
const lexical = shared.lexical142Schema.parse(
  await readFinal("machine-missing-lexical-evidence-v5.json"),
);
const selectionOnly = shared.safety142Schema.parse(
  await readJson141(
    path.join(
      dir("selection-v2"),
      "machine-missing-safety-reserve-targets-v2.json",
    ),
  ),
);
const scores = shared.scoreTracks142Schema.parse(
  await readFinal(
    "cache-replay/detector/machine-speech-detector-score-tracks-v1.json",
  ),
);
const sweeps = shared.sweeps142Schema.parse(
  await readFinal(
    "cache-replay/detector/machine-independent-speech-presence-sweeps.json",
  ),
);
const runtime = shared.webrtcRuntime142Schema.parse(
  await readJson141(
    path.join(
      dir("baseline"),
      "machine-independent-speech-presence-runtime.json",
    ),
  ),
);
const valuesByRun = new Map<string, number[]>();
for (const track of scores.tracks) {
  const file = path.join(
    dir("final-a"),
    "cache-replay/detector",
    track.relativePath,
  );
  if ((await fileHash141(file)) !== track.scoreSha256)
    throw new Error("C601142_SCORE_BLOB_CHANGED_AFTER_FREEZE");
  valuesByRun.set(track.runId, decodeScores142(await readFile(file)));
}
const packageEntry = required141(
  a.protectedMachineFiles.find((p) =>
    p.relativePath.endsWith("/subtitle-package.needs-review.json"),
  ),
);
const sourceBefore = await identity141(source);
// This is the durable barrier. Even hashing Gold is a read, so no Gold identity,
// labels, upstream evaluation or subtitle is opened before this fsync completes.
const intent = await persistFirstRead142({
  directory: dir("evaluation"),
  finalAFreezeHash: a.semanticHash,
  finalBFreezeHash: b.semanticHash,
  finalACompletedAt: a.freezeCompletedAt,
  finalBCompletedAt: b.freezeCompletedAt,
  codeSnapshotHash: codeSnapshot.semanticHash,
  codeValidationHash: await fileHash141(codePath),
  browserAuditHash: await fileHash141(browserPath),
});
const firstGoldReadAt = intent.firstGoldReadAt;

const goldPath = arg("gold"),
  qualityPath = arg("quality-evaluation"),
  labelsPath = arg("region-labels");
const goldBefore = await identity141(goldPath),
  qualityBefore = await identity141(qualityPath),
  labelsBefore = await identity141(labelsPath);
const quality = shared.c60112ReviewQualityEvaluationSchema.parse(
    await readJson141(qualityPath),
  ),
  labels = shared.c60113RegionLabelsSchema.parse(await readJson141(labelsPath));
const { semanticHash: qualityHash, ...qualityCore } = quality;
if (
  qualityHash !==
    machineQualitySemanticHash({ ...qualityCore, generatedAt: undefined }) ||
  labels.semanticHash !== c60113HashPayload(labels)
)
  throw new Error("C601142_UPSTREAM_LABEL_HASH_MISMATCH");
let upstreamPath = values["gold-evaluation"]
  ? path.resolve(values["gold-evaluation"])
  : null;
if (!upstreamPath) {
  const root = arg("gold-evaluation-root"),
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
}
if (!upstreamPath)
  throw new Error("C601142_UPSTREAM_EVALUATION_NOT_FOUND_BY_HASH");
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
  throw new Error("C601142_GOLD_SOURCE_CANONICAL_BINDING_MISMATCH");
const components = c60114GoldErrorComponents(
  upstream,
  labels.errorComponents,
  a.sourceIdentity,
);
if (
  hash141(components.map((v) => v.errorComponentId).sort()) !==
  hash141(quality.errorComponents.map((v) => v.errorComponentId).sort())
)
  throw new Error("C601142_GOLD_DENOMINATOR_CHANGED");
const evaluation = evaluate142({
  projections,
  policy,
  components,
  oldInventory: old.inventory,
  oldSafety: old.safety,
  selectionOnly,
  inventory,
  safety,
  uncovered,
  clusters,
  masked,
  scores,
  sweeps,
  valuesByRun,
  lexical,
  independentRuntimeAvailable: runtime.status === "AVAILABLE",
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
for (let i = 0; i < machinePackage.cues.length; i++)
  for (const next of machinePackage.cues.slice(i + 1)) {
    const cue = required141(machinePackage.cues[i]);
    if (Math.min(cue.end, next.end) > Math.max(cue.start, next.start))
      machineOverlapCount++;
  }
const qualityParity = shared.machineQuality142Schema.parse(
  hashed141({
    schemaVersion: "1.0.0",
    artifactType: "c6-0-1-14-2-machine-subtitle-parity-quality",
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
    throw new Error("C601142_POST_EVALUATION_READ_ONLY_IDENTITY_CHANGED");
await verifyFinalFreeze142(outputRoot, dir("final-a"), source);
await verifyFinalFreeze142(outputRoot, dir("final-b"), source);
const audit = shared.evaluationAudit142Schema.parse(
  hashed141({
    schemaVersion: "1.0.0",
    artifactType: "c6-0-1-14-2-post-freeze-evaluation-audit",
    visibility: "LOCAL_ONLY",
    firstGoldReadAt,
    firstReadIntentHash: intent.semanticHash,
    durableIntentBeforeGoldRead: true,
    browserAuditByteHash: await fileHash141(browserPath),
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
for (const [name, value] of [
  ["gold-c6-0-1-14-2-selection-detector-ceiling-evaluation.json", evaluation],
  ["c6-0-1-14-2-post-freeze-evaluation-audit.local-only.json", audit],
  ["c6-0-1-14-2-route-decision.json", evaluation.route],
  ["c6-0-1-14-2-machine-subtitle-parity-quality.json", qualityParity],
] as const)
  await durableJson141(path.join(dir("evaluation"), name), value);
const full = officialBudget142(
  required141(evaluation.variants.find((v) => v.stage === "B8")).evaluation,
);
console.log(
  JSON.stringify(
    {
      route: evaluation.route.primaryDecision,
      missing: full.officialMissingRecall,
      hallucination: full.officialHallucinationRecall,
      burden: evaluation.burden,
      freezeBeforeGold: true,
      runtimeGoldInputCount: 0,
    },
    null,
    2,
  ),
);
