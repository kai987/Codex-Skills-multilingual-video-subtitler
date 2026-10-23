import path from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import type { z } from "zod";
import * as shared from "@mvl/shared";
import { files141, verifyFreeze141 } from "./lib/c601141-freeze.js";
import { verifyMachineCode141 } from "./lib/c601141-code-freeze.js";
import { verifyValidationOnlyRemediation141 } from "./lib/c601141-validation-remediation.js";
import { auditShareable141 } from "./lib/c601141-shareable-audit.js";
import { config141Schema } from "./lib/c601141-input.js";
import {
  readJson141,
  fileHash141,
  durableJson141,
  safeRelative141,
  identity141,
} from "../packages/video-subtitler/src/review/c601141-io.js";
import {
  hash141,
  hashed141,
  required141,
  assertHash141,
} from "../packages/video-subtitler/src/review/c601141-policy.js";
import {
  assertInventoryWorkspace141,
  verifyPhysicalAudio141,
} from "../packages/video-subtitler/src/review/c601141-review-delivery.js";
import type { C60112ReviewWorkspaceData } from "../packages/video-subtitler/src/review/c60112-review-workspace.js";
import { officialBudget141 } from "../packages/video-subtitler/src/review/c601141-evaluation.js";

const { values } = parseArgs({
  strict: true,
  options: {
    state: { type: "string" },
    "code-validation": { type: "string" },
    "browser-audit": { type: "string" },
    "skill-validation-log": { type: "string" },
    "schema-remediation": { type: "string" },
    "acceptance-code-validation": { type: "string" },
  },
});
const arg = (key: keyof typeof values) =>
  path.resolve(required141(values[key]));
const state = (await readJson141(arg("state"))) as {
  config: unknown;
  outputs: Record<string, string>;
  policyPath: string;
};
const config = config141Schema.parse(state.config);
const dir = (key: string) => required141(state.outputs[key]);
const root = config.outputRoot,
  aRoot = dir("final-a"),
  bRoot = dir("final-b");
const a = await verifyFreeze141(
  root,
  path.join(aRoot, "c6-0-1-14-1-machine-speech-inventory-freeze.json"),
  config.source,
);
const b = await verifyFreeze141(
  root,
  path.join(bRoot, "c6-0-1-14-1-machine-speech-inventory-freeze.json"),
  config.source,
);
const remediationResults = [];
for (const final of [aRoot, bRoot]) {
  const snapshot = path.join(final, "machine-code-snapshot.json");
  if (values["schema-remediation"]) {
    if (!values["acceptance-code-validation"])
      throw new Error("C601141_POST_REMEDIATION_FULL_CODE_CHECKS_REQUIRED");
    remediationResults.push(
      await verifyValidationOnlyRemediation141(
        process.cwd(),
        snapshot,
        arg("schema-remediation"),
      ),
    );
  } else await verifyMachineCode141(process.cwd(), snapshot);
}
const code = shared.c601141CodeValidationSchema.parse(
  await readJson141(arg("code-validation")),
);
const browser = shared.c601141BrowserAuditSchema.parse(
  await readJson141(arg("browser-audit")),
);
const evaluationPath = path.join(
  dir("speech-evaluation"),
  "gold-c6-0-1-14-1-speech-inventory-evaluation.json",
);
const evaluation = shared.c601141EvaluationSchema.parse(
  await readJson141(evaluationPath),
);
assertHash141(evaluation);
const auditPath = path.join(
  dir("speech-evaluation"),
  "c6-0-1-14-1-post-freeze-evaluation-audit.local-only.json",
);
const evaluationAudit = shared.c601141EvaluationAuditSchema.parse(
  await readJson141(auditPath),
);
assertHash141(evaluationAudit);
const codeHash = await fileHash141(arg("code-validation"));
const checks: { id: string; passed: boolean; detail: string }[] = [];
const check = (id: string, passed: boolean, detail = "") =>
  checks.push({ id, passed, detail });
check(
  "FULL_CODE_REGRESSION",
  code.passed && code.results.every((r) => r.passed && r.exitCode === 0),
);
for (const row of code.results) {
  const log = path.resolve(
    path.dirname(arg("code-validation")),
    row.logRelativePath,
  );
  safeRelative141(path.dirname(arg("code-validation")), log);
  check(`CODE_LOG_${row.id}`, (await fileHash141(log)) === row.logSha256);
}
if (remediationResults.length) {
  check(
    "POST_FREEZE_VALIDATION_ONLY_SCHEMA_REMEDIATION",
    remediationResults.length === 2 &&
      hash141(remediationResults[0]) === hash141(remediationResults[1]),
    JSON.stringify(remediationResults[0]),
  );
  const acceptancePath = arg("acceptance-code-validation"),
    acceptance = shared.c601141CodeValidationSchema.parse(
      await readJson141(acceptancePath),
    );
  check(
    "POST_REMEDIATION_FULL_CODE_REGRESSION",
    acceptance.passed &&
      acceptance.results.every((r) => r.passed && r.exitCode === 0),
    JSON.stringify({
      byteHash: await fileHash141(acceptancePath),
      generatedAt: acceptance.generatedAt,
    }),
  );
  for (const row of acceptance.results) {
    const log = path.resolve(path.dirname(acceptancePath), row.logRelativePath);
    safeRelative141(path.dirname(acceptancePath), log);
    check(
      `POST_REMEDIATION_CODE_LOG_${row.id}`,
      (await fileHash141(log)) === row.logSha256,
    );
  }
}
check(
  "EVALUATION_CODE_GATE_BINDING",
  evaluationAudit.codeValidationByteHash === codeHash,
);
check(
  "FROZEN_BEFORE_GOLD",
  a.stage === "FINAL_MACHINE_DELIVERY" &&
    b.stage === "FINAL_MACHINE_DELIVERY" &&
    a.freezeCompletedAt < evaluationAudit.firstGoldReadAt &&
    b.freezeCompletedAt < evaluationAudit.firstGoldReadAt &&
    evaluationAudit.finalAFreezeHash === a.semanticHash &&
    evaluationAudit.finalBFreezeHash === b.semanticHash,
);
check(
  "SOURCE_READ_ONLY",
  hash141(await identity141(config.source)) ===
    hash141(a.sourceReadOnlyIdentity) &&
    hash141(evaluationAudit.sourceIdentityBefore) ===
      hash141(evaluationAudit.sourceIdentityAfter),
);
check(
  "GOLD_READ_ONLY_RECORDED_BY_ISOLATED_EVALUATOR",
  hash141(evaluationAudit.goldIdentityBefore) ===
    hash141(evaluationAudit.goldIdentityAfter),
);
check(
  "BROWSER_READ_ONLY_ACCEPTANCE",
  browser.passed && browser.checks.every((v) => v.passed),
);
check(
  "BROWSER_FROZEN_DELIVERY_BINDING",
  browser.workspaceDataByteHash ===
    (await fileHash141(
      path.join(aRoot, "review-workspace/review-data.json"),
    )) &&
    browser.workspaceJavascriptByteHash ===
      (await fileHash141(
        path.join(aRoot, "review-workspace/assets/review.js"),
      )),
);
const skillLog = await readFile(arg("skill-validation-log"), "utf8");
check("SKILL_VALIDATION", skillLog.includes("Skill is valid!"));
const read = async <T>(schema: z.ZodType<T>, phase: string, file: string) =>
  schema.parse(await readJson141(path.join(dir(phase), file)));
const sf = await read(
  shared.c601141SweepsSchema,
  "speech-sweeps-fresh",
  "machine-whole-media-speech-activity-sweeps.json",
);
const sr = await read(
  shared.c601141SweepsSchema,
  "speech-sweeps-replay",
  "machine-whole-media-speech-activity-sweeps.json",
);
const af = await read(
  shared.c601141AsrProbesSchema,
  "local-asr-fresh",
  "machine-c6-0-1-14-1-local-asr-probes.json",
);
const ar = await read(
  shared.c601141AsrProbesSchema,
  "local-asr-replay",
  "machine-c6-0-1-14-1-local-asr-probes.json",
);
const views = await read(
  shared.c601141AudioViewsSchema,
  "audio-views",
  "machine-source-audio-views-v1.json",
);
const fingerprint = await read(
  shared.c601141FingerprintSchema,
  "legacy-fingerprint",
  "machine-legacy-audio-fingerprint-reconciliation.json",
);
const inventory = await read(
  shared.c601141InventorySchema,
  "final-a",
  "machine-source-global-speech-inventory-v4.json",
);
const safety = await read(
  shared.c601141SafetySchema,
  "final-a",
  "machine-missing-safety-reserve-targets-v1.json",
);
const lexical = await read(
  shared.c601141LexicalSchema,
  "final-a",
  "machine-missing-lexical-evidence-v4.json",
);
for (const v of [
  sf,
  sr,
  af,
  ar,
  views,
  fingerprint,
  inventory,
  safety,
  lexical,
])
  assertHash141(v);
const noReplayWork = (v: {
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
  "SPEECH_FRESH_AND_REPLAY",
  sf.mode === "FRESH" &&
    sr.mode === "EXACT_CACHE_ONLY" &&
    sf.runs.every((v) => v.resultPersisted && v.status === "SUCCESS") &&
    sf.evidenceSemanticHash === sr.evidenceSemanticHash &&
    noReplayWork(sr.accounting) &&
    sr.accounting.cacheHits === sf.runs.length,
);
check(
  "ASR_FRESH_AND_REPLAY",
  af.mode === "FRESH" &&
    ar.mode === "EXACT_CACHE_ONLY" &&
    af.requests.every((v) => v.resultPersisted) &&
    af.evidenceSemanticHash === ar.evidenceSemanticHash &&
    noReplayWork(ar.accounting) &&
    ar.accounting.cacheHits === af.requests.length,
);
check(
  "INFERENCE_DISPATCH_LIMITS",
  sf.accounting.inferenceCount <= 12 &&
    af.accounting.inferenceCount <= 32 &&
    (await readdir(path.join(dir("baseline"), "cache/dispatch/speech"))).filter(
      (n) => n.endsWith(".json"),
    ).length === sf.runs.length &&
    (await readdir(path.join(dir("baseline"), "cache/dispatch/asr"))).filter(
      (n) => n.endsWith(".json"),
    ).length === af.requests.length,
);
const finalSnapshot = (freeze: typeof a, final: string) => {
  const prefix = `${safeRelative141(root, final)}/`;
  return freeze.artifacts
    .filter((v) => v.relativePath.startsWith(prefix))
    .map((v) => ({
      path: v.relativePath.slice(prefix.length),
      byteHash: v.byteHash,
    }));
};
const finalMachineBytes =
  hash141(finalSnapshot(a, aRoot)) === hash141(finalSnapshot(b, bRoot));
check("FINAL_AB_MACHINE_BYTE_PARITY", finalMachineBytes);
const canonicalBytes =
  a.protectedMachineFiles.length > 0 &&
  hash141(a.protectedMachineFiles.map((v) => v.byteHash)) ===
    hash141(b.protectedMachineFiles.map((v) => v.byteHash));
check(
  "CANONICAL_AB_BYTE_PARITY",
  canonicalBytes &&
    a.canonicalTextHash === b.canonicalTextHash &&
    a.canonicalTimingHash === b.canonicalTimingHash &&
    a.presentationHash === b.presentationHash,
);
for (const [label, final] of [
  ["A", aRoot],
  ["B", bRoot],
] as const) {
  const replay = shared.c601141FinalReplaySchema.parse(
    await readJson141(
      path.join(final, "c6-0-1-14-1-final-replay-accounting.json"),
    ),
  );
  check(
    `FINAL_${label}_CACHE_ONLY`,
    noReplayWork(replay.detector) && noReplayWork(replay.asr),
  );
  const data = (await readJson141(
    path.join(final, "review-workspace/review-data.json"),
  )) as C60112ReviewWorkspaceData;
  assertInventoryWorkspace141(data);
  const extension = required141(data.speechInventoryReviewV1);
  const physical = await verifyPhysicalAudio141(
    path.join(final, "review-workspace"),
    extension.audio,
  );
  check(`FINAL_${label}_PHYSICAL_DELIVERY`, physical.allPassed);
}
const data = (await readJson141(
  path.join(aRoot, "review-workspace/review-data.json"),
)) as C60112ReviewWorkspaceData;
const extension = required141(data.speechInventoryReviewV1);
const plan = (id: string) =>
  required141(extension.playback.plans.find((v) => v.planId === id));
const full = officialBudget141(
  required141(evaluation.variants.at(-1)).evaluation,
);
const physical = {
  targetCount: extension.targets.targets.length,
  itemCount: extension.items.items.length,
  regionCount: extension.regions.regions.length,
  wavCount: extension.audio.audio.length,
  playableWavCount: extension.audio.audio.length,
  playbackSegmentCount: extension.playback.segments.length,
  requiredItemCount: extension.items.items.filter(
    (v) => v.requiredLevel === "REQUIRED",
  ).length,
  fullQueueSeconds: plan("FULL_QUEUE_WITH_SAFETY_RESERVE").uniqueAudioSeconds,
  conservativeQueueSeconds: plan("FULL_QUEUE_CONSERVATIVE_SPEECH")
    .uniqueAudioSeconds,
  mandatorySeconds: plan("ALL_MANDATORY").uniqueAudioSeconds,
  allTargetsAudible: true,
};
check(
  "GOLD_EVALUATION_INTEGRITY",
  evaluation.route.evaluationIntegrityPassed &&
    evaluation.variants.every(
      (v) => v.evaluation.integrityFailures.length === 0,
    ),
);
const acquisition = required141(a.acquisitionSummary);
check(
  "ACQUISITION_SUMMARY_BINDING",
  hash141(acquisition) === hash141(b.acquisitionSummary) &&
    hash141(acquisition.speechFresh) === hash141(sf.accounting) &&
    hash141(acquisition.asrFresh) === hash141(af.accounting),
);
const schemaMap: Record<string, z.ZodType> = {
  ...shared.c601141Schemas,
  ...shared.c601141DeliverySchemas,
  ...shared.c601141EvaluationSchemas,
  ...shared.c601141AcceptanceSchemas,
};
const compiled = new Map<string, ReturnType<typeof shared.compileJsonSchema>>();
const schemaResults: shared.C601141Validation["schemaResults"] = [];
const aliases: Record<string, string> = {
  "machine-code-snapshot.json": "c6-0-1-14-1-machine-code-snapshot",
  "c6-0-1-14-1-final-replay-accounting.json":
    "c6-0-1-14-1-final-replay-accounting",
  "c6-0-1-14-1-route-decision.json": "c6-0-1-14-1-route-decision",
};
const validationFiles = [
  ...new Set([
    ...(await files141(aRoot)),
    ...(await files141(bRoot)),
    ...(await files141(dir("speech-evaluation"))),
    ...(await files141(dir("audio-views"))),
    path.join(
      dir("speech-sweeps-fresh"),
      "machine-whole-media-speech-activity-sweeps.json",
    ),
    path.join(
      dir("speech-sweeps-replay"),
      "machine-whole-media-speech-activity-sweeps.json",
    ),
    path.join(
      dir("local-asr-fresh"),
      "machine-c6-0-1-14-1-local-asr-probes.json",
    ),
    path.join(
      dir("local-asr-replay"),
      "machine-c6-0-1-14-1-local-asr-probes.json",
    ),
    arg("code-validation"),
    arg("browser-audit"),
  ]),
].filter((file) => file.endsWith(".json"));
const validateOne = async (file: string, schemaId: string, value: unknown) => {
  required141(schemaMap[schemaId]).parse(value);
  let validator = compiled.get(schemaId);
  if (!validator) {
    validator = shared.compileJsonSchema(
      (await readJson141(
        path.join(process.cwd(), "schemas", `${schemaId}.schema.json`),
      )) as object,
    );
    compiled.set(schemaId, validator);
  }
  shared.assertJsonSchema(validator, value);
  schemaResults.push({
    relativePath: safeRelative141(root, file),
    schemaId,
    byteHash: await fileHash141(file),
    zodPassed: true,
    jsonSchemaPassed: true,
  });
};
for (const file of validationFiles) {
  const value = await readJson141(file);
  const type =
    value &&
    typeof value === "object" &&
    "artifactType" in value &&
    typeof value.artifactType === "string"
      ? value.artifactType
      : aliases[path.basename(file)];
  const schemaId =
    type ??
    (path.basename(file) === "c6-0-1-14-1-policy.json"
      ? "c6-0-1-14-1-policy"
      : undefined);
  if (schemaId && schemaMap[schemaId]) await validateOne(file, schemaId, value);
}
check(
  "STRICT_ZOD_AND_GENERATED_JSON_SCHEMAS",
  schemaResults.length >= 19,
  `${schemaResults.length} artifact instances`,
);
const parity = {
  speechFreshReplay: sf.evidenceSemanticHash === sr.evidenceSemanticHash,
  asrFreshReplay: af.evidenceSemanticHash === ar.evidenceSemanticHash,
  finalMachineBytes,
  canonicalBytes,
  canonicalTextHash: a.canonicalTextHash,
  canonicalTimingHash: a.canonicalTimingHash,
  presentationHash: a.presentationHash,
  machineTextMutationCount: 0 as const,
  machineTimingMutationCount: 0 as const,
  machinePresentationMutationCount: 0 as const,
};
const summarizeRecall = (v: {
  total: number;
  covered: number;
  recall: number;
}) => ({ total: v.total, covered: v.covered, recall: v.recall });
const missingRows = full.componentCoverage.filter((v) =>
  v.labels.includes("MISSING_DIALOGUE"),
);
const missingFullCovered = missingRows.filter(
  (v) => v.layers.audibleReviewCoverage.full,
).length;
const engineeringAcceptancePassed = checks.every((v) => v.passed);
const summary = shared.c601141ShareableSchema.parse(
  hashed141({
    schemaVersion: "1.0.0",
    artifactType: "c6-0-1-14-1-shareable-summary",
    visibility: "AGGREGATE_ONLY",
    version: "C6.0.1.14.1",
    viewCount: views.views.length,
    uniquePcmViewCount: views.summary.uniquePcmViewCount,
    fingerprint: fingerprint.summary,
    speechFresh: sf.accounting,
    speechReplay: sr.accounting,
    asrFresh: af.accounting,
    asrReplay: ar.accounting,
    startupFailureProviderStarts: acquisition.startupFailureProviderStarts,
    nonSourceWarmupTransportCount: acquisition.nonSourceWarmupTransportCount,
    nonSourceWarmupEncoderDecoderCount: 0,
    inventory: inventory.summary,
    safety: safety.summary,
    lexical: lexical.summary,
    physical,
    missingAudibleRecall: summarizeRecall(full.officialMissingRecall),
    missingFullRecall: {
      total: missingRows.length,
      covered: missingFullCovered,
      recall: missingRows.length ? missingFullCovered / missingRows.length : 0,
    },
    hallucinationAudibleRecall: summarizeRecall(
      full.officialHallucinationRecall,
    ),
    burden: evaluation.burden,
    parity,
    route: evaluation.route.primaryDecision,
    engineeringAcceptancePassed,
    coverageGatePassed: evaluation.route.fullQueueGatePassed,
    runtimeGoldInputCount: 0,
    rankerRetrained: false,
    humanTrialStarted: false,
    productionStatus: "needs-review",
    finalizationMethod: "none",
    c602Status: "HOLD",
    machineOnlyReleaseAuthorized: false,
  }),
);
const shareableAudit = auditShareable141(summary);
if (!shareableAudit.passed)
  throw new Error("C601141_SHAREABLE_AGGREGATE_AUDIT_FAILED");
const summaryFile = path.join(
  dir("validation"),
  "shareable/c6-0-1-14-1-shareable-summary.json",
);
await durableJson141(summaryFile, summary);
await validateOne(summaryFile, "c6-0-1-14-1-shareable-summary", summary);
const shareableAuditFile = path.join(
  dir("validation"),
  "shareable/c6-0-1-14-1-shareable-audit.json",
);
await durableJson141(shareableAuditFile, shareableAudit);
await validateOne(
  shareableAuditFile,
  "c6-0-1-14-1-shareable-audit",
  shareableAudit,
);
const schemaNames = (await readdir("schemas")).filter((n) =>
  n.endsWith(".schema.json"),
);
const validation = shared.c601141ValidationSchema.parse(
  hashed141({
    schemaVersion: "1.0.0",
    artifactType: "c6-0-1-14-1-validation",
    visibility: "LOCAL_ONLY",
    generatedAt: new Date().toISOString(),
    checks,
    schemaResults,
    generatedSchemaCount: schemaNames.length,
    newSchemaCount: Object.keys(schemaMap).length,
    codeValidationHash: codeHash,
    browserAuditHash: await fileHash141(arg("browser-audit")),
    postFreezeEvaluationAuditHash: await fileHash141(auditPath),
    speechFresh: sf.accounting,
    speechReplay: sr.accounting,
    asrFresh: af.accounting,
    asrReplay: ar.accounting,
    physical,
    parity,
    finalAFreezeHash: a.semanticHash,
    finalBFreezeHash: b.semanticHash,
    route: evaluation.route.primaryDecision,
    engineeringAcceptancePassed,
    coverageGatePassed: evaluation.route.fullQueueGatePassed,
    runtimeGoldInputCount: 0,
    validationInferenceCount: 0,
    rankerRetrained: false,
    newOofRun: false,
    humanTrialStarted: false,
    productionStatus: "needs-review",
    finalizationMethod: "none",
    c602Status: "HOLD",
    machineOnlyReleaseAuthorized: false,
    shareableSummaryHash: summary.semanticHash,
    shareableAuditPassed: shareableAudit.passed,
  }),
);
const validationSchema = shared.compileJsonSchema(
  (await readJson141("schemas/c6-0-1-14-1-validation.schema.json")) as object,
);
shared.assertJsonSchema(validationSchema, validation);
await durableJson141(
  path.join(dir("validation"), "c6-0-1-14-1-validation.json"),
  validation,
);
console.log(
  JSON.stringify(
    {
      engineeringAcceptancePassed,
      coverageGatePassed: validation.coverageGatePassed,
      route: validation.route,
      checkCount: checks.length,
      schemaInstanceCount: schemaResults.length,
      schemaCount: schemaNames.length,
      physical,
      shareableAudit,
    },
    null,
    2,
  ),
);
if (!engineeringAcceptancePassed) process.exitCode = 1;
