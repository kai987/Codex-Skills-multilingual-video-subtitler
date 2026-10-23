import path from "node:path";
import { parseArgs } from "node:util";
import { mkdir, readFile, readdir } from "node:fs/promises";
import type { z } from "zod";
import * as shared from "@mvl/shared";
import type { C60112ReviewWorkspaceData } from "../packages/video-subtitler/src/review/c60112-review-workspace.js";
import { loadBaseline143 } from "./lib/c601143-input.js";
import { loadSelection143 } from "./lib/c601143-selection.js";
import { machineCodeSnapshot143 } from "./lib/c601143-final.js";
import { auditShareable143 } from "./lib/c601143-shareable-audit.js";
import { files141 } from "./lib/c601141-freeze.js";
import { verifyProjectionAudio142 } from "./lib/c601142-coverage-projection.js";
import {
  assertWorkspace143,
  verifyPhysicalAudio143,
} from "../packages/video-subtitler/src/review/c601143-review-delivery.js";
import {
  durableJson141,
  fileHash141,
  identity141,
  readJson141,
  safeRelative141,
} from "../packages/video-subtitler/src/review/c601141-io.js";
import {
  assertHash141,
  hash141,
  hashed141,
  required141,
} from "../packages/video-subtitler/src/review/c601141-policy.js";

const { values } = parseArgs({
  strict: true,
  options: {
    state: { type: "string" },
    "code-validation": { type: "string" },
    "browser-audit": { type: "string" },
    "skill-validation-log": { type: "string" },
    output: { type: "string" },
  },
});
const arg = (
  key:
    | "state"
    | "code-validation"
    | "browser-audit"
    | "skill-validation-log"
    | "output",
) => path.resolve(required141(values[key], `--${key} required`));
const state = shared.state143Schema.parse(await readJson141(arg("state")));
if (hash141(state.config) !== state.configHash)
  throw new Error("C601143_VALIDATOR_CONFIG_CHANGED");
const baseline = await loadBaseline143(state.config),
  selection = await loadSelection143(state);
const root = state.config.outputRoot,
  dir = (role: string) =>
    required141(state.outputs[role], `missing role ${role}`);
const aRoot = dir("final-a"),
  bRoot = dir("final-b"),
  evaluationRoot = dir("evaluation"),
  output = arg("output");
await mkdir(output, { recursive: true });

const checks: { id: string; passed: boolean; evidenceHash: string }[] = [];
const check = (id: string, passed: boolean, evidence: unknown = null) =>
  checks.push({ id, passed, evidenceHash: hash141(evidence) });
const runtimeEqual = (left: unknown, right: unknown) => Object.is(left, right);
const runtimeTrue = (value: unknown) => runtimeEqual(value, true);
const runtimeZero = (value: unknown) => runtimeEqual(value, 0);
const code = shared.codeValidation143Schema.parse(
  await readJson141(arg("code-validation")),
);
const browser = shared.browserAudit143Schema.parse(
  await readJson141(arg("browser-audit")),
);
check(
  "FULL_CODE_VALIDATION",
  code.passed && code.results.every((r) => r.passed && r.exitCode === 0),
  code.results.map((r) => ({
    id: r.id,
    exitCode: r.exitCode,
    sha: r.logSha256,
  })),
);
let codeLogsPassed = true;
for (const row of code.results) {
  const log = path.resolve(
    path.dirname(arg("code-validation")),
    row.logRelativePath,
  );
  safeRelative141(path.dirname(arg("code-validation")), log);
  if ((await fileHash141(log)) !== row.logSha256) codeLogsPassed = false;
}
check(
  "CODE_LOG_HASHES",
  codeLogsPassed,
  code.results.map((r) => r.logSha256),
);
const skillLog = await readFile(arg("skill-validation-log"), "utf8");
check(
  "SKILL1_VALIDATION",
  skillLog.includes("Skill is valid!"),
  await fileHash141(arg("skill-validation-log")),
);
check(
  "BROWSER_READ_ONLY_ACCEPTANCE",
  browser.passed &&
    runtimeZero(browser.savedHumanDecisionCount) &&
    runtimeEqual(browser.humanTrialStarted, false) &&
    browser.checks.length >= 11,
  browser.checks,
);

async function freeze(rootDirectory: string) {
  const value = shared.machineFreeze143Schema.parse(
    await readJson141(
      path.join(rootDirectory, "c6-0-1-14-3-machine-selection-freeze.json"),
    ),
  );
  assertHash141(value);
  let bindingsPassed = true;
  for (const row of [...value.artifacts, ...value.protectedMachineFiles]) {
    const file = path.resolve(root, row.relativePath);
    safeRelative141(root, file);
    if ((await fileHash141(file)) !== row.byteHash) bindingsPassed = false;
  }
  check(`FREEZE_${value.finalRole}_ARTIFACT_BINDINGS`, bindingsPassed, {
    artifactCount: value.artifacts.length,
    protectedCount: value.protectedMachineFiles.length,
  });
  return value;
}
const a = await freeze(aRoot),
  b = await freeze(bRoot),
  codeSnapshot = await machineCodeSnapshot143(process.cwd());
check(
  "FROZEN_MACHINE_CODE",
  codeSnapshot.semanticHash === a.codeSnapshotHash &&
    codeSnapshot.semanticHash === b.codeSnapshotHash,
  codeSnapshot.semanticHash,
);
check(
  "SOURCE_READ_ONLY",
  hash141(await identity141(baseline.old.config.source)) ===
    hash141(a.sourceReadOnlyIdentity) &&
    hash141(a.sourceReadOnlyIdentity) === hash141(b.sourceReadOnlyIdentity),
  a.sourceReadOnlyIdentity,
);

const parity = shared.parity143Schema.parse(
  await readJson141(
    path.join(evaluationRoot, "c6-0-1-14-3-final-ab-parity.json"),
  ),
);
assertHash141(parity);
const snapshot = async (directory: string) => {
  const rows: { relativePath: string; byteHash: string }[] = [];
  for (const file of await files141(directory)) {
    const relativePath = safeRelative141(directory, file);
    if (relativePath === "c6-0-1-14-3-machine-selection-freeze.json") continue;
    rows.push({ relativePath, byteHash: await fileHash141(file) });
  }
  return rows;
};
const aBytes = await snapshot(aRoot),
  bBytes = await snapshot(bRoot);
check(
  "FINAL_AB_INDEPENDENT_BYTE_PARITY",
  hash141(aBytes) === hash141(bBytes) &&
    runtimeTrue(parity.byteParity) &&
    runtimeTrue(parity.semanticParity) &&
    runtimeTrue(parity.audioShaParity) &&
    runtimeTrue(parity.canonicalByteParity),
  { a: hash141(aBytes), b: hash141(bBytes), parity: parity.semanticHash },
);

const replayA = shared.replay143Schema.parse(
  await readJson141(
    path.join(
      aRoot,
      "exact-cache-replay/c6-0-1-14-3-exact-cache-replay-accounting.json",
    ),
  ),
);
const replayB = shared.replay143Schema.parse(
  await readJson141(
    path.join(
      bRoot,
      "exact-cache-replay/c6-0-1-14-3-exact-cache-replay-accounting.json",
    ),
  ),
);
[replayA, replayB].forEach(assertHash141);
const noWork = (v: typeof replayA) =>
  runtimeZero(v.inferenceCount) &&
  runtimeZero(v.modelLoadCount) &&
  runtimeZero(v.providerProcessStartCount) &&
  runtimeZero(v.cacheMissCount) &&
  runtimeZero(v.networkRequestCount) &&
  v.detectorCacheHitCount === v.expectedDetectorRequestCount &&
  v.asrCacheHitCount === v.expectedAsrRequestCount;
check(
  "EXACT_CACHE_ONLY_FINAL_AB",
  noWork(replayA) &&
    noWork(replayB) &&
    replayA.semanticHash === replayB.semanticHash,
  {
    detectorHits: replayA.detectorCacheHitCount,
    asrHits: replayA.asrCacheHitCount,
  },
);

const readWorkspace = async (rootDirectory: string) => {
  const data = (await readJson141(
    path.join(rootDirectory, "review-workspace/review-data.json"),
  )) as C60112ReviewWorkspaceData;
  assertWorkspace143(data);
  return { data, extension: required141(data.monotonicSafetyReviewV3) };
};
const workspaceA = await readWorkspace(aRoot),
  workspaceB = await readWorkspace(bRoot);
const physicalA = await verifyPhysicalAudio143(
  path.join(aRoot, "review-workspace"),
  workspaceA.extension.audio,
);
const physicalB = await verifyPhysicalAudio143(
  path.join(bRoot, "review-workspace"),
  workspaceB.extension.audio,
);
check(
  "FINAL_AB_PHYSICAL_AUDIO",
  runtimeTrue(physicalA.allPassed) && runtimeTrue(physicalB.allPassed),
  {
    a: physicalA,
    b: physicalB,
  },
);
check(
  "REVIEW_DELIVERY_CORE_COVERAGE",
  workspaceA.extension.audio.childCoreCoverage.every((r) => r.coveragePassed) &&
    workspaceA.extension.audio.bundleCoreCoverage.every(
      (r) => r.coveragePassed,
    ) &&
    workspaceA.extension.playback.allChildCorePlaybackPassed &&
    workspaceA.extension.playback.allBundleCorePlaybackPassed,
  workspaceA.extension.audio.summary,
);
check(
  "REVIEW_DELIVERY_SUBSYSTEM_REUSED",
  runtimeEqual(
    workspaceA.extension.reviewDeliverySubsystemVersion,
    "C6.0.1.12_REVIEW_AUDIO",
  ),
  workspaceA.extension.reviewDeliverySubsystemVersion,
);
check(
  "BROWSER_BYTES_BIND_FINAL_AB",
  (await fileHash141(path.join(aRoot, "review-workspace/review-data.json"))) ===
    browser.workspaceDataByteHash &&
    (await fileHash141(
      path.join(bRoot, "review-workspace/review-data.json"),
    )) === browser.workspaceDataByteHash &&
    (await fileHash141(
      path.join(aRoot, "review-workspace/assets/review.js"),
    )) === browser.workspaceJavascriptByteHash &&
    (await fileHash141(
      path.join(bRoot, "review-workspace/assets/review.js"),
    )) === browser.workspaceJavascriptByteHash,
  {
    data: browser.workspaceDataByteHash,
    javascript: browser.workspaceJavascriptByteHash,
  },
);

const projections = shared.projections143Schema.parse(
  await readJson141(path.join(aRoot, "machine-coverage-projections.json")),
);
assertHash141(projections);
for (const rootDirectory of [aRoot, bRoot])
  for (const row of projections.variants)
    await verifyProjectionAudio142(
      path.join(rootDirectory, row.workspaceRelativePath),
      row.projection,
    );
check(
  "A0_A7_PHYSICAL_PROJECTIONS",
  projections.variants.length === 8 &&
    projections.variants.every(
      (v, i) =>
        v.stage === shared.stages143[i] && runtimeTrue(v.physicalAudioVerified),
    ),
  projections.variants.map((v) => ({ stage: v.stage, hash: v.semanticHash })),
);
check(
  "PHASE_A_MONOTONICITY",
  selection.monotonicity.monotonicityPassed &&
    selection.monotonicity.obligationCoverageRatio === 1 &&
    selection.monotonicity.uncoveredNativeSamples === 0,
  selection.monotonicity.semanticHash,
);
check(
  "PLANNER_COMPLETE_WITNESS",
  selection.planner.feasibilityStatus === "FEASIBLE" &&
    selection.planner.searchComplete &&
    selection.planner.feasibilityWitnessVerified &&
    selection.planner.hardConstraintResults.every((r) => r.passed),
  selection.planner.semanticHash,
);
check(
  "SAFETY_BUDGET",
  selection.safety.targets.length <= 24 &&
    selection.safety.summary.speechCoreUnionSeconds <= 60 &&
    runtimeZero(selection.safety.summary.wholeEpisodeCatchAllTargetCount),
  selection.safety.summary,
);

const intent = shared.firstGoldRead143Schema.parse(
  await readJson141(
    path.join(evaluationRoot, "c6-0-1-14-3-first-gold-read-intent.json"),
  ),
);
const evaluation = shared.evaluation143Schema.parse(
  await readJson141(
    path.join(
      evaluationRoot,
      "gold-c6-0-1-14-3-selection-continuity-evaluation.json",
    ),
  ),
);
const route = shared.route143Schema.parse(
  await readJson141(
    path.join(evaluationRoot, "c6-0-1-14-3-route-decision.json"),
  ),
);
const quality = shared.machineQuality143Schema.parse(
  await readJson141(
    path.join(
      evaluationRoot,
      "c6-0-1-14-3-machine-subtitle-parity-quality.json",
    ),
  ),
);
const audit = shared.evaluationAudit143Schema.parse(
  await readJson141(
    path.join(
      evaluationRoot,
      "c6-0-1-14-3-post-freeze-evaluation-audit.local-only.json",
    ),
  ),
);
[intent, evaluation, route, quality, audit].forEach(assertHash141);
check(
  "DURABLE_GOLD_BARRIER",
  runtimeTrue(intent.freezeBeforeGold) &&
    Date.parse(a.freezeCompletedAt) < Date.parse(intent.firstGoldReadAt) &&
    Date.parse(b.freezeCompletedAt) < Date.parse(intent.firstGoldReadAt) &&
    intent.finalAFreezeHash === a.semanticHash &&
    intent.finalBFreezeHash === b.semanticHash,
  intent.semanticHash,
);
check(
  "GOLD_SOURCE_READ_ONLY",
  hash141(audit.sourceIdentityBefore) === hash141(audit.sourceIdentityAfter) &&
    hash141(audit.goldIdentityBefore) === hash141(audit.goldIdentityAfter) &&
    runtimeZero(audit.runtimeGoldInputCount) &&
    runtimeZero(audit.newInferenceCount),
  audit.semanticHash,
);
check(
  "EVALUATION_INTEGRITY",
  evaluation.evaluationIntegrityPassed &&
    evaluation.variants.every(
      (v) => v.evaluation.integrityFailures.length === 0,
    ),
  evaluation.semanticHash,
);
check(
  "CANONICAL_TIMING_PRESENTATION_PRESERVED",
  a.canonicalTextHash === baseline.old.baseline.canonicalTextHash &&
    a.canonicalTimingHash === baseline.old.baseline.canonicalTimingHash &&
    a.presentationHash === baseline.old.baseline.presentationHash &&
    runtimeZero(a.canonicalTextMutationCount) &&
    runtimeZero(a.canonicalTimingMutationCount) &&
    runtimeZero(a.presentationMutationCount),
  {
    text: a.canonicalTextHash,
    timing: a.canonicalTimingHash,
    presentation: a.presentationHash,
  },
);
check(
  "PRODUCTION_AND_C602_REMAIN_HELD",
  runtimeEqual(route.productionStatus, "needs-review") &&
    runtimeEqual(route.finalizationMethod, "none") &&
    runtimeEqual(route.c602Status, "HOLD") &&
    runtimeEqual(quality.productionStatus, "needs-review") &&
    runtimeEqual(quality.finalizationMethod, "none"),
  route.semanticHash,
);

const schemaMap: Record<string, z.ZodType> = {
  ...shared.c601143SelectionSchemas,
  ...shared.c601143ReviewSchemas,
  ...shared.c601143AcceptanceSchemas,
};
const instances: { schemaId: string; file: string; value?: unknown }[] = [
  { schemaId: "c6-0-1-14-3-policy", file: state.policyPath },
  {
    schemaId: "c6-0-1-14-3-baseline-replay",
    file: path.join(dir("baseline"), "c6-0-1-14-3-baseline-replay.json"),
  },
  { schemaId: "c6-0-1-14-3-run-paths.local-only", file: arg("state") },
  {
    schemaId: "machine-cross-stage-selection-transition-audit",
    file: path.join(
      dir("transition-audit"),
      "machine-cross-stage-selection-transition-audit.json",
    ),
  },
  {
    schemaId: "machine-phase-a-coverage-obligations",
    file: path.join(
      dir("obligations"),
      "machine-phase-a-coverage-obligations.json",
    ),
  },
  {
    schemaId: "c6-0-1-14-3-phase-a-obligation-freeze",
    file: path.join(
      dir("obligations"),
      "c6-0-1-14-3-phase-a-obligation-freeze.json",
    ),
  },
  {
    schemaId: "machine-selectable-speech-child-units-v1",
    file: path.join(
      dir("hierarchical-children"),
      "machine-selectable-speech-child-units-v1.json",
    ),
  },
  {
    schemaId: "machine-review-target-bundle-candidates-v1",
    file: path.join(
      dir("target-bundles"),
      "machine-review-target-bundle-candidates-v1.json",
    ),
  },
  {
    schemaId: "machine-target-bundle-dominance-ledger",
    file: path.join(
      dir("target-bundles"),
      "machine-target-bundle-dominance-ledger.json",
    ),
  },
  {
    schemaId: "machine-final-safety-planner-certificate",
    file: path.join(
      dir("final-planner"),
      "machine-final-safety-planner-certificate.json",
    ),
  },
  {
    schemaId: "machine-cross-stage-coverage-monotonicity",
    file: path.join(
      dir("final-planner"),
      "machine-cross-stage-coverage-monotonicity.json",
    ),
  },
  {
    schemaId: "machine-cross-stage-selection-continuity-ledger",
    file: path.join(
      dir("final-planner"),
      "machine-cross-stage-selection-continuity-ledger.json",
    ),
  },
  {
    schemaId: "machine-missing-safety-reserve-targets-v3",
    file: path.join(
      dir("final-planner"),
      "machine-missing-safety-reserve-targets-v3.json",
    ),
  },
  {
    schemaId: "c6-0-1-14-3-code-validation",
    file: arg("code-validation"),
    value: code,
  },
  {
    schemaId: "c6-0-1-14-3-browser-read-only-acceptance",
    file: arg("browser-audit"),
    value: browser,
  },
  {
    schemaId: "c6-0-1-14-3-final-ab-parity",
    file: path.join(evaluationRoot, "c6-0-1-14-3-final-ab-parity.json"),
    value: parity,
  },
  {
    schemaId: "c6-0-1-14-3-durable-first-gold-read-intent",
    file: path.join(evaluationRoot, "c6-0-1-14-3-first-gold-read-intent.json"),
    value: intent,
  },
  {
    schemaId: "gold-c6-0-1-14-3-selection-continuity-evaluation",
    file: path.join(
      evaluationRoot,
      "gold-c6-0-1-14-3-selection-continuity-evaluation.json",
    ),
    value: evaluation,
  },
  {
    schemaId: "c6-0-1-14-3-route-decision",
    file: path.join(evaluationRoot, "c6-0-1-14-3-route-decision.json"),
    value: route,
  },
  {
    schemaId: "c6-0-1-14-3-machine-subtitle-parity-quality",
    file: path.join(
      evaluationRoot,
      "c6-0-1-14-3-machine-subtitle-parity-quality.json",
    ),
    value: quality,
  },
  {
    schemaId: "c6-0-1-14-3-post-freeze-evaluation-audit",
    file: path.join(
      evaluationRoot,
      "c6-0-1-14-3-post-freeze-evaluation-audit.local-only.json",
    ),
    value: audit,
  },
];
for (const rootDirectory of [aRoot, bRoot]) {
  instances.push(
    {
      schemaId: "c6-0-1-14-3-machine-selection-freeze",
      file: path.join(
        rootDirectory,
        "c6-0-1-14-3-machine-selection-freeze.json",
      ),
    },
    {
      schemaId: "c6-0-1-14-3-exact-cache-replay-accounting",
      file: path.join(
        rootDirectory,
        "exact-cache-replay/c6-0-1-14-3-exact-cache-replay-accounting.json",
      ),
    },
    {
      schemaId: "c6-0-1-14-3-machine-code-snapshot",
      file: path.join(rootDirectory, "machine-code-snapshot.json"),
    },
    {
      schemaId: "c6-0-1-14-3-machine-coverage-projections",
      file: path.join(rootDirectory, "machine-coverage-projections.json"),
    },
  );
  for (const [schemaId, name] of Object.entries({
    "machine-review-target-intervals-v5":
      "machine-review-target-intervals-v5.json",
    "machine-review-items-v7": "machine-review-items-v7.json",
    "machine-review-regions-v6": "machine-review-regions-v6.json",
    "machine-review-audio-manifest-v6": "machine-review-audio-manifest-v6.json",
    "machine-review-playback-timeline-v5":
      "machine-review-playback-timeline-v5.json",
    "machine-c601143-frozen-lexical-bindings":
      "machine-c601143-frozen-lexical-bindings.json",
    "machine-c601143-review-workspace": "machine-c601143-review-workspace.json",
  }))
    instances.push({
      schemaId,
      file: path.join(rootDirectory, "review-workspace", name),
    });
}
const schemaResults: {
  schemaId: string;
  relativePath: string;
  valid: boolean;
  errorCount: number;
}[] = [];
for (const row of instances) {
  const value = row.value ?? (await readJson141(row.file)),
    zodSchema = required141(
      schemaMap[row.schemaId],
      `missing Zod schema ${row.schemaId}`,
    );
  const parsed = zodSchema.safeParse(value);
  const jsonSchema = (await readJson141(
    path.join(process.cwd(), "schemas", `${row.schemaId}.schema.json`),
  )) as object;
  const validator = shared.compileJsonSchema(jsonSchema),
    jsonPassed = validator(value);
  schemaResults.push({
    schemaId: row.schemaId,
    relativePath: safeRelative141(root, row.file),
    valid: parsed.success && jsonPassed,
    errorCount:
      (parsed.success ? 0 : parsed.error.issues.length) +
      (jsonPassed ? 0 : (validator.errors?.length ?? 1)),
  });
}
check(
  "STRICT_ZOD_AND_GENERATED_JSON_SCHEMA",
  schemaResults.length >= 35 && schemaResults.every((r) => r.valid),
  schemaResults,
);

const shareable = shared.shareable143Schema.parse(
  hashed141({
    schemaVersion: "1.0.0",
    artifactType: "c6-0-1-14-3-shareable-acceptance-summary",
    visibility: "SHAREABLE_AGGREGATE_ONLY",
    codeSnapshotHash: codeSnapshot.semanticHash,
    obligationHash: selection.obligations.semanticHash,
    hierarchyHash: selection.hierarchy.semanticHash,
    bundleCandidatesHash: selection.bundles.semanticHash,
    plannerCertificateHash: selection.planner.semanticHash,
    finalEvidenceHash: a.replayAccountingHash,
    canonicalTextHash: a.canonicalTextHash,
    canonicalTimingHash: a.canonicalTimingHash,
    presentationHash: a.presentationHash,
    detectorReplayHits: replayA.detectorCacheHitCount,
    asrReplayHits: replayA.asrCacheHitCount,
    finalAReplayInference: 0,
    finalBReplayInference: 0,
    phaseAObligationCount: selection.obligations.obligations.length,
    phaseAObligationCoverage: selection.monotonicity.obligationCoverageRatio,
    phaseARegressionCount: selection.monotonicity.droppedObligationCount,
    childCount: selection.hierarchy.children.length,
    bundleCandidateCount: selection.bundles.candidates.length,
    safetyTargetCount: selection.safety.targets.length,
    safetyUnionSeconds: selection.safety.summary.speechCoreUnionSeconds,
    physicalWavCount: workspaceA.extension.audio.audio.length,
    targetCount: workspaceA.extension.targets.targets.length,
    regionCount: workspaceA.extension.regions.regions.length,
    missingComponents: evaluation.missingTotal,
    audibleMissingComponents: evaluation.missingAudibleCount,
    hallucinationComponents: evaluation.hallucinationTotal,
    audibleHallucinationComponents: evaluation.hallucinationAudibleCount,
    fullQueueSeconds:
      workspaceA.extension.playback.nativeFullQueueSamples /
      workspaceA.extension.sourceIdentity.sampleRate,
    fullQueueEpisodeRatio: workspaceA.extension.playback.fullQueueEpisodeRatio,
    engineeringPassed: code.passed && browser.passed,
    evaluationIntegrityPassed: evaluation.evaluationIntegrityPassed,
    route: route.primaryDecision,
    productionStatus: "needs-review",
    finalizationMethod: "none",
    c602Status: "HOLD",
    canonicalMutationCount: 0,
    rawDialogueIncluded: false,
    goldIncluded: false,
    nativeScoresIncluded: false,
    localPathsIncluded: false,
  }),
);
const shareableAudit = auditShareable143(shareable),
  shareableDirectory = path.join(output, "shareable");
await mkdir(shareableDirectory, { recursive: true });
const summaryPath = path.join(
    shareableDirectory,
    "c6-0-1-14-3-shareable-acceptance-summary.json",
  ),
  auditPath = path.join(shareableDirectory, "c6-0-1-14-3-shareable-audit.json");
await durableJson141(summaryPath, shareable);
await durableJson141(auditPath, shareableAudit);
check("SHAREABLE_AGGREGATE_BOUNDARY", shareableAudit.passed, shareableAudit);

const generatedSchemaCount = (
  await readdir(path.join(process.cwd(), "schemas"))
).filter((name) => name.endsWith(".schema.json")).length;
const validation = shared.validation143Schema.parse(
  hashed141({
    schemaVersion: projections.schemaVersion,
    policyVersion: projections.policyVersion,
    policyHash: projections.policyHash,
    sourceIdentity: projections.sourceIdentity,
    sourceTimebase: projections.sourceTimebase,
    runtimeGoldInputCount: 0,
    visibility: "LOCAL_ONLY",
    artifactType: "c6-0-1-14-3-validation",
    generatedAt: new Date().toISOString(),
    checks,
    passed: checks.every((c) => c.passed),
    routeDecision: route.primaryDecision,
    finalAFreezeHash: a.semanticHash,
    finalBFreezeHash: b.semanticHash,
    codeValidationHash: await fileHash141(arg("code-validation")),
    browserAuditHash: await fileHash141(arg("browser-audit")),
    shareableSummaryHash: shareable.semanticHash,
    shareableAuditHash: await fileHash141(auditPath),
    evaluationHash: evaluation.semanticHash,
    skillValidationHash: await fileHash141(arg("skill-validation-log")),
    schemaValidatedArtifactCount: schemaResults.length,
    generatedSchemaCount,
  }),
);
await durableJson141(
  path.join(output, "c6-0-1-14-3-schema-validation-results.local-only.json"),
  {
    schemaVersion: "1.0.0",
    artifactType: "c6-0-1-14-3-schema-validation-results.local-only",
    visibility: "LOCAL_ONLY",
    results: schemaResults,
  },
);
await durableJson141(
  path.join(output, "c6-0-1-14-3-validation.json"),
  validation,
);
console.log(
  JSON.stringify(
    {
      passed: validation.passed,
      checkCount: checks.length,
      schemaValidatedArtifactCount: schemaResults.length,
      generatedSchemaCount,
      route: route.primaryDecision,
      shareableAudit,
    },
    null,
    2,
  ),
);
if (!validation.passed) process.exitCode = 1;
