import path from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";
import { parseArgs } from "node:util";
import type { z } from "zod";
import * as shared from "@mvl/shared";
import {
  config142Schema,
  loadBaseline142,
  type State142,
} from "./lib/c601142-input.js";
import { files141 } from "./lib/c601141-freeze.js";
import {
  verifyFinalFreeze142,
  machineCodeSnapshot142,
} from "./lib/c601142-final.js";
import { verifyProjectionAudio142 } from "./lib/c601142-coverage-projection.js";
import { auditShareable142 } from "./lib/c601142-shareable-audit.js";
import {
  assertWorkspace142,
  verifyPhysicalAudio142,
} from "../packages/video-subtitler/src/review/c601142-review-delivery.js";
import type { C60112ReviewWorkspaceData } from "../packages/video-subtitler/src/review/c60112-review-workspace.js";
import { officialBudget142 } from "../packages/video-subtitler/src/review/c601142-evaluation.js";
import {
  identity141,
  readJson141,
  fileHash141,
  durableJson141,
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
      "skill-validation-log",
      "output",
    ].map((name) => [name, { type: "string" as const }]),
  ),
});
const arg = (key: string) => path.resolve(required141(values[key]));
const state = (await readJson141(arg("state"))) as State142,
  config = config142Schema.parse(state.config),
  old = await loadBaseline142(config);
const dir = (role: string) => required141(state.outputs[role]),
  root = config.outputRoot,
  aRoot = dir("final-a"),
  bRoot = dir("final-b"),
  output = values.output ? arg("output") : dir("validation");
const checks: { id: string; passed: boolean; detail: string }[] = [];
const check = (id: string, passed: boolean, detail = "") => {
  checks.push({ id, passed, detail });
};
const code = shared.codeValidation142Schema.parse(
    await readJson141(arg("code-validation")),
  ),
  browser = shared.browserAudit142Schema.parse(
    await readJson141(arg("browser-audit")),
  );
const a = await verifyFinalFreeze142(root, aRoot, old.config.source),
  b = await verifyFinalFreeze142(root, bRoot, old.config.source);
const snapshot = await machineCodeSnapshot142(process.cwd());
check(
  "FROZEN_MACHINE_CODE",
  snapshot.semanticHash === a.codeSnapshotHash &&
    snapshot.semanticHash === b.codeSnapshotHash,
);
check(
  "FULL_CODE_VALIDATION",
  code.passed && code.results.every((r) => r.passed && r.exitCode === 0),
);
for (const row of code.results) {
  const file = path.resolve(
    path.dirname(arg("code-validation")),
    row.logRelativePath,
  );
  safeRelative141(path.dirname(arg("code-validation")), file);
  check(`CODE_LOG_${row.id}`, (await fileHash141(file)) === row.logSha256);
}
check(
  "SKILL_VALIDATION",
  (await readFile(arg("skill-validation-log"), "utf8")).includes(
    "Skill is valid!",
  ),
);
check("BROWSER_READ_ONLY", browser.passed);
const read = async <T>(schema: z.ZodType<T>, role: string, file: string) =>
  schema.parse(await readJson141(path.join(dir(role), file)));
const sf = await read(
    shared.sweeps142Schema,
    "detectors-fresh",
    "machine-independent-speech-presence-sweeps.json",
  ),
  sr = await read(
    shared.sweeps142Schema,
    "detectors-replay",
    "machine-independent-speech-presence-sweeps.json",
  );
const af = await read(
    shared.asrProbes142Schema,
    "local-asr-fresh",
    "machine-c6-0-1-14-2-local-asr-probes.json",
  ),
  ar = await read(
    shared.asrProbes142Schema,
    "local-asr-replay",
    "machine-c6-0-1-14-2-local-asr-probes.json",
  );
const pre = await read(
  shared.detectorFreeze142Schema,
  "baseline",
  "machine-c601142-pre-detector-freeze.json",
);
const phaseA = await read(
  shared.phaseA142Schema,
  "selection-v2",
  "c6-0-1-14-2-phase-a-selection-projection.json",
);
const prior = await read(
  shared.baselineReplay142Schema,
  "baseline",
  "c6-0-1-14-2-baseline-replay.local-only.json",
);
const evaluation = await read(
  shared.evaluation142Schema,
  "evaluation",
  "gold-c6-0-1-14-2-selection-detector-ceiling-evaluation.json",
);
const audit = await read(
  shared.evaluationAudit142Schema,
  "evaluation",
  "c6-0-1-14-2-post-freeze-evaluation-audit.local-only.json",
);
const intent = await read(
  shared.firstGoldRead142Schema,
  "evaluation",
  "c6-0-1-14-2-first-gold-read-intent.json",
);
const quality = await read(
  shared.machineQuality142Schema,
  "evaluation",
  "c6-0-1-14-2-machine-subtitle-parity-quality.json",
);
[
  sf,
  sr,
  af,
  ar,
  pre,
  phaseA,
  prior,
  evaluation,
  audit,
  intent,
  quality,
].forEach(assertHash141);
for (const entry of pre.files) {
  const base =
    entry.domain === "SOURCE_CODE"
      ? process.cwd()
      : entry.domain === "OUTPUT"
        ? root
        : config.webrtcRuntimeDirectory;
  const file = path.resolve(base, entry.relativePath);
  safeRelative141(base, file);
  check(
    `PRE_DETECTOR_FROZEN_${entry.domain}_${entry.relativePath}`,
    (await fileHash141(file)) === entry.sha256,
  );
}
check(
  "PHASE_A_ZERO_INFERENCE",
  shared.phaseA142Schema.safeParse(phaseA).success &&
    pre.phaseAHash === phaseA.semanticHash,
);
const noWork = (v: {
  inferenceCount: number;
  modelLoadCount: number;
  providerProcessStartCount: number;
  cacheMisses: number;
}) =>
  v.inferenceCount === 0 &&
  v.modelLoadCount === 0 &&
  v.providerProcessStartCount === 0 &&
  v.cacheMisses === 0;
check(
  "BASELINE_EXACT_CACHE",
  noWork(prior.detector) &&
    noWork(prior.asr) &&
    prior.detector.cacheHits === old.sweeps.runs.length &&
    prior.asr.cacheHits === old.asr.requests.length,
);
check(
  "DETECTOR_FRESH_REPLAY",
  sf.mode === "FRESH" &&
    sr.mode === "EXACT_CACHE_ONLY" &&
    sf.runs.every((r) => r.resultPersisted && r.status === "SUCCESS") &&
    sf.evidenceSemanticHash === sr.evidenceSemanticHash &&
    noWork(sr.accounting) &&
    sr.accounting.cacheHits === sf.runs.length,
);
check(
  "ASR_FRESH_REPLAY",
  af.mode === "FRESH" &&
    ar.mode === "EXACT_CACHE_ONLY" &&
    af.requests.every((r) => r.resultPersisted) &&
    af.evidenceSemanticHash === ar.evidenceSemanticHash &&
    noWork(ar.accounting) &&
    ar.accounting.cacheHits === af.requests.length,
);
const detectorTickets = await readdir(
    path.join(dir("baseline"), "cache/dispatch/detector"),
  ),
  asrTickets = await readdir(path.join(dir("baseline"), "cache/dispatch/asr"));
check(
  "DISPATCH_ACCOUNTING",
  sf.accounting.inferenceCount <= 8 &&
    af.accounting.inferenceCount <= 12 &&
    detectorTickets.filter((f) => f.endsWith(".json")).length ===
      sf.accounting.inferenceCount &&
    asrTickets.filter((f) => f.endsWith(".json")).length ===
      af.accounting.inferenceCount,
);
check(
  "NO_OLD_ASR_REPEAT_OR_BACKFILL",
  shared.asrProbes142Schema.safeParse(af).success,
  "Strict schema requires repeatedPreviousRequestCount, targetBackfillCount, hiddenRetryCount and fullMediaAsrCount to equal zero",
);
const normalized = (freeze: typeof a, directory: string) => {
  const prefix = `${safeRelative141(root, directory)}/`;
  return freeze.artifacts
    .filter((f) => f.relativePath.startsWith(prefix))
    .map((f) => ({
      file: f.relativePath.slice(prefix.length),
      hash: f.byteHash,
    }));
};
check(
  "FINAL_AB_MACHINE_BYTES",
  hash141(normalized(a, aRoot)) === hash141(normalized(b, bRoot)),
);
check(
  "FINAL_AB_SEMANTIC_PARITY",
  a.projectionHash === b.projectionHash &&
    a.reviewWorkspaceHash === b.reviewWorkspaceHash &&
    a.replayAccountingHash === b.replayAccountingHash &&
    hash141(a.acquisitionSummary) === hash141(b.acquisitionSummary),
);
check(
  "CANONICAL_TEXT_TIMING_PRESENTATION",
  a.canonicalTextHash === prior.canonicalTextHash &&
    a.canonicalTimingHash === prior.canonicalTimingHash &&
    a.presentationHash === prior.presentationHash &&
    a.canonicalTextHash === b.canonicalTextHash &&
    a.canonicalTimingHash === b.canonicalTimingHash &&
    a.presentationHash === b.presentationHash &&
    hash141(a.protectedMachineFiles.map((f) => f.byteHash)) ===
      hash141(b.protectedMachineFiles.map((f) => f.byteHash)),
);
check(
  "DURABLE_GOLD_BARRIER",
  intent.semanticHash === audit.firstReadIntentHash &&
    intent.firstGoldReadAt === audit.firstGoldReadAt &&
    a.freezeCompletedAt < intent.firstGoldReadAt &&
    b.freezeCompletedAt < intent.firstGoldReadAt &&
    audit.finalAFreezeHash === a.semanticHash &&
    audit.finalBFreezeHash === b.semanticHash,
);
check(
  "VALIDATION_AND_BROWSER_BINDINGS",
  (await fileHash141(arg("code-validation"))) ===
    audit.codeValidationByteHash &&
    (await fileHash141(arg("browser-audit"))) === audit.browserAuditByteHash,
);
check(
  "SOURCE_AND_GOLD_READ_ONLY",
  hash141(await identity141(old.config.source)) ===
    hash141(a.sourceReadOnlyIdentity) &&
    hash141(audit.sourceIdentityBefore) ===
      hash141(audit.sourceIdentityAfter) &&
    hash141(audit.goldIdentityBefore) === hash141(audit.goldIdentityAfter),
);
let oldMetadataIntact = true;
for (const entry of prior.priorOutputMetadata) {
  const now = await stat(entry.file);
  if (
    now.size !== entry.size ||
    now.mtimeMs !== entry.mtimeMs ||
    now.ino !== entry.inode
  )
    oldMetadataIntact = false;
}
check(
  "PREVIOUS_OUTPUT_METADATA_IMMUTABLE",
  oldMetadataIntact,
  `${prior.priorOutputMetadata.length} old files`,
);
const projections = await read(
  shared.projections142Schema,
  "final-a",
  "machine-coverage-projections.json",
);
for (const [label, directory] of [
  ["A", aRoot],
  ["B", bRoot],
] as const) {
  const replay = shared.finalReplay142Schema.parse(
    await readJson141(
      path.join(directory, "c6-0-1-14-2-final-replay-accounting.json"),
    ),
  );
  check(
    `FINAL_${label}_CACHE_ONLY`,
    [
      replay.baselineDetector,
      replay.baselineAsr,
      replay.detector,
      replay.asr,
    ].every(noWork) &&
      replay.detector.cacheHits === sf.runs.length &&
      replay.asr.cacheHits === af.requests.length,
  );
  const data = (await readJson141(
    path.join(directory, "review-workspace/review-data.json"),
  )) as C60112ReviewWorkspaceData;
  assertWorkspace142(data);
  const extension = required141(data.detectorCeilingReviewV2);
  check(
    `FINAL_${label}_PHYSICAL_WAVS`,
    (
      await verifyPhysicalAudio142(
        path.join(directory, "review-workspace"),
        extension.audio,
      )
    ).allPassed,
  );
  for (const projection of [
    ...projections.variants,
    ...projections.comparisonPlans,
  ])
    await verifyProjectionAudio142(
      path.join(directory, projection.workspaceRelativePath),
      projection.projection,
    );
  check(`FINAL_${label}_ALL_COMPARISON_WAVS`, true);
  check(
    `FINAL_${label}_BROWSER_MATCH`,
    (await fileHash141(
      path.join(directory, "review-workspace/review-data.json"),
    )) === browser.workspaceDataByteHash &&
      (await fileHash141(
        path.join(directory, "review-workspace/assets/review.js"),
      )) === browser.workspaceJavascriptByteHash,
  );
}
const workspace = (await readJson141(
    path.join(aRoot, "review-workspace/review-data.json"),
  )) as C60112ReviewWorkspaceData,
  extension = required141(workspace.detectorCeilingReviewV2);
check(
  "SAFETY_BUDGET_AND_OLD_COVERAGE",
  extension.safety.targets.length <= 24 &&
    extension.safety.summary.targetUnionSeconds <= 60.000001 &&
    extension.safety.summary.oldCoveragePreserved,
);
check(
  "MANDATORY_LEVEL_AND_ORDER_UNCHANGED",
  extension.items.items
    .filter((i) => i.reviewLayer === "MISSING_SAFETY_RESERVE")
    .every((i) => i.requiredLevel === "RECOMMENDED"),
);
check(
  "FULL_QUEUE_BURDEN",
  extension.playback.burdenGate === "PASSED" &&
    extension.playback.fullQueueEpisodeRatio <= 0.95,
);
check(
  "EVALUATION_INTEGRITY",
  evaluation.route.evaluationIntegrityPassed &&
    evaluation.variants.every(
      (v) => v.evaluation.integrityFailures.length === 0,
    ),
);
check(
  "QUALITY_NOT_CHANGED_OR_RELEASED",
  shared.machineQuality142Schema.safeParse(quality).success &&
    shared.route142Schema.safeParse(evaluation.route).success,
  "Strict schemas require zero canonical mutation, A/B parity, C6.0.2 HOLD and no machine-only release",
);

const schemaMap: Record<string, z.ZodType> = {
  ...shared.c601141Schemas,
  ...shared.c601141DeliverySchemas,
  ...shared.c601141EvaluationSchemas,
  ...shared.c601141AcceptanceSchemas,
  ...shared.c601142SelectionSchemas,
  ...shared.c601142AcousticSchemas,
  ...shared.c601142ReviewSchemas,
  ...shared.c601142AcceptanceSchemas,
  ...shared.c601142LocalSchemas,
  "c6-0-1-14-machine-coverage-projection":
    shared.c60114MachineCoverageProjectionSchema,
  "c6-0-1-14-probe-request-journal": shared.c60114ProbeJournalSchema,
  "machine-review-evidence-families": shared.c60113EvidenceFamilyGraphSchema,
  "machine-review-items-v4": shared.c60114ReviewItemsV4Schema,
  "machine-review-regions-v3": shared.c60114ReviewRegionsV3Schema,
  "machine-review-target-intervals-v2": shared.c60114ReviewTargetsSchema,
  "machine-review-audio-manifest-v3": shared.c60114ReviewAudioManifestV3Schema,
  "machine-review-playback-timeline-v2": shared.c60114PlaybackTimelineV2Schema,
  "c6-0-1-12-review-package-freeze": shared.c60112ReviewPackageFreezeSchema,
  "subtitle-package": shared.subtitlePackageSchema,
};
const aliases: Record<string, string> = {
  "machine-code-snapshot.json": "c6-0-1-14-2-machine-code-snapshot",
  "machine-coverage-projections.json":
    "c6-0-1-14-2-machine-coverage-projections",
  "machine-coverage-projection.json": "c6-0-1-14-machine-coverage-projection",
  "c6-0-1-14-2-route-decision.json": "c6-0-1-14-2-route-decision",
  "c6-0-1-14-2-policy.json": "c6-0-1-14-2-policy",
  "c6-0-1-14-2-run-paths.local-only.json": "c6-0-1-14-2-run-paths",
  "detector-execution.local-only.json": "c6-0-1-14-2-detector-execution",
  "result-receipt.json": "c6-0-1-14-2-detector-result-receipt",
  "request.local-only.json": "c6-0-1-14-2-detector-request",
  "cache-binding.json": "c6-0-1-14-2-detector-cache-binding",
  "execution-started.json": "c6-0-1-14-2-detector-execution-started",
  "transport-receipt.local-only.json": "c6-0-1-14-2-detector-transport",
  "dsp-request.local-only.json": "c6-0-1-14-2-dsp-request",
  "dsp-measurements.local-only.json": "c6-0-1-14-2-dsp-measurements",
  "acoustic-features-request.local-only.json":
    "c6-0-1-14-2-acoustic-features-request",
  "c601142-review-delivery-selection.json": "c6-0-1-14-2-delivery-selection",
  "subtitle-package.needs-review.json": "subtitle-package",
};
const compiled = new Map<string, ReturnType<typeof shared.compileJsonSchema>>(),
  schemaResults: z.infer<
    typeof shared.runValidation142Schema
  >["schemaResults"] = [];
const validate = async (
  file: string,
  schemaId: string,
  value: unknown,
  suffix = "",
) => {
  const parsed = required141(schemaMap[schemaId]).safeParse(value);
  let validator = compiled.get(schemaId);
  if (!validator) {
    validator = shared.compileJsonSchema(
      (await readJson141(
        path.join(process.cwd(), "schemas", `${schemaId}.schema.json`),
      )) as object,
    );
    compiled.set(schemaId, validator);
  }
  const validJson = validator(value);
  schemaResults.push({
    relativePath: safeRelative141(root, file) + suffix,
    schemaId,
    valid: parsed.success && validJson,
    errorCount:
      (parsed.success ? 0 : parsed.error.issues.length) +
      (validJson ? 0 : (validator.errors?.length ?? 1)),
  });
  if (!parsed.success)
    console.error(
      JSON.stringify({
        file: safeRelative141(root, file),
        schemaId,
        errors: parsed.error.issues,
      }),
    );
  if (!validJson)
    console.error(
      JSON.stringify({
        file: safeRelative141(root, file),
        schemaId,
        errors: validator.errors,
      }),
    );
};
const files = [
  ...new Set(
    (await Promise.all(Object.values(state.outputs).map(files141)))
      .flat()
      .concat([arg("code-validation"), arg("browser-audit")]),
  ),
].filter((f) => f.endsWith(".json"));
for (const file of files) {
  const value = await readJson141(file);
  const object =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  let schemaId =
    typeof object?.artifactType === "string"
      ? object.artifactType
      : aliases[path.basename(file)];
  if (schemaId === "c6-0-1-13-machine-review-evidence-families")
    schemaId = "machine-review-evidence-families";
  if (schemaId === "review-target-intervals-v2")
    schemaId = "machine-review-target-intervals-v2";
  if (!schemaId && object?.clusterTargetId && object.requestIdentityHash)
    schemaId = "c6-0-1-14-2-asr-request-result";
  if (!schemaId && object?.jobHash && object.scoreTrack !== undefined)
    schemaId = "c6-0-1-14-2-detector-run";
  if (
    !schemaId &&
    object?.rawOutput !== undefined &&
    object.decoder &&
    object.wallClockSeconds !== undefined
  )
    schemaId = "c6-0-1-14-2-asr-raw-result";
  if (schemaId && schemaMap[schemaId]) await validate(file, schemaId, value);
  else if (schemaId && /(?:c601142|c6-0-1-14-2)/u.test(schemaId))
    check(
      `UNREGISTERED_NEW_ARTIFACT_${schemaId}`,
      false,
      safeRelative141(root, file),
    );
  if (object?.detectorCeilingReviewV2)
    await validate(
      file,
      "c6-0-1-14-2-workspace-extension",
      object.detectorCeilingReviewV2,
      "#detectorCeilingReviewV2",
    );
}
check(
  "STRICT_ZOD_AND_GENERATED_JSON_SCHEMAS",
  schemaResults.length > 100 && schemaResults.every((r) => r.valid),
  `${schemaResults.length} artifact instances`,
);
const full = officialBudget142(
  required141(
    evaluation.comparisonPlans.find(
      (p) => p.planId === "C601142_FINAL_FULL_QUEUE",
    ),
  ).evaluation,
);
const engineeringPassed = checks.every((c) => c.passed),
  evaluationIntegrityPassed = evaluation.route.evaluationIntegrityPassed;
const summary = shared.shareable142Schema.parse(
  hashed141({
    schemaVersion: "1.0.0",
    artifactType: "c6-0-1-14-2-shareable-acceptance-summary",
    visibility: "SHAREABLE_AGGREGATE_ONLY",
    codeSnapshotHash: snapshot.semanticHash,
    detectorEvidenceHash: sf.evidenceSemanticHash,
    asrEvidenceHash: af.evidenceSemanticHash,
    finalEvidenceHash: a.replayAccountingHash,
    canonicalTextHash: a.canonicalTextHash,
    canonicalTimingHash: a.canonicalTimingHash,
    presentationHash: a.presentationHash,
    detectorFreshCount: sf.accounting.inferenceCount,
    detectorReplayHits: sr.accounting.cacheHits,
    asrFreshCount: af.accounting.inferenceCount,
    asrReplayHits: ar.accounting.cacheHits,
    finalAReplayInference: 0,
    finalBReplayInference: 0,
    safetyTargetCount: extension.safety.targets.length,
    safetyUnionSeconds: extension.safety.summary.targetUnionSeconds,
    physicalWavCount: extension.audio.audio.length,
    targetCount: extension.targets.targets.length,
    regionCount: extension.regions.regions.length,
    missingComponents: full.officialMissingRecall.total,
    audibleMissingComponents: full.officialMissingRecall.covered,
    fullMissingComponents: full.componentCoverage.filter(
      (c) =>
        c.labels.includes("MISSING_DIALOGUE") &&
        c.layers.audibleReviewCoverage.full,
    ).length,
    hallucinationComponents: full.officialHallucinationRecall.total,
    audibleHallucinationComponents: full.officialHallucinationRecall.covered,
    fullQueueSeconds: full.actualAudibleUniqueSeconds,
    engineeringPassed,
    evaluationIntegrityPassed,
    fullQueueGatePassed: evaluation.route.fullQueueGatePassed,
    route: evaluation.route.primaryDecision,
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
const shareableAudit = auditShareable142(summary);
check("SHAREABLE_AGGREGATE_BOUNDARY", shareableAudit.passed);
for (const [schemaId, value] of [
  ["c6-0-1-14-2-shareable-acceptance-summary", summary],
  ["c6-0-1-14-2-shareable-audit", shareableAudit],
] as const) {
  const file = path.join(output, "shareable", `${schemaId}.json`);
  await durableJson141(file, value);
  await validate(file, schemaId, value);
}
const artifact = shared.runValidation142Schema.parse(
  hashed141({
    schemaVersion: "1.0.0",
    artifactType: "c6-0-1-14-2-validation",
    visibility: "LOCAL_ONLY",
    generatedAt: new Date().toISOString(),
    checks,
    schemaResults,
    schemaCount: (await readdir("schemas")).filter((f) =>
      f.endsWith(".schema.json"),
    ).length,
    checkedArtifactCount: schemaResults.length,
    engineeringPassed: checks.every((c) => c.passed),
    evaluationIntegrityPassed,
    allChecksPassed:
      checks.every((c) => c.passed) && schemaResults.every((r) => r.valid),
    route: evaluation.route,
  }),
);
shared.assertJsonSchema(
  shared.compileJsonSchema(
    (await readJson141("schemas/c6-0-1-14-2-validation.schema.json")) as object,
  ),
  artifact,
);
await durableJson141(
  path.join(output, "c6-0-1-14-2-validation.json"),
  artifact,
);
console.log(
  JSON.stringify(
    {
      passed: artifact.allChecksPassed,
      checkCount: checks.length,
      schemaInstanceCount: schemaResults.length,
      schemaCount: artifact.schemaCount,
      route: evaluation.route.primaryDecision,
      missing: full.officialMissingRecall,
      hallucination: full.officialHallucinationRecall,
      shareableAudit,
    },
    null,
    2,
  ),
);
if (!artifact.allChecksPassed) process.exitCode = 1;
