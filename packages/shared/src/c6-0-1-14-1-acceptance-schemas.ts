import { z } from "zod";
import { machineVsGoldEvaluationSchema } from "./c6-0-1-blind-acceptance-schemas.js";
import {
  c601141SweepsSchema,
  c601141AsrProbesSchema,
  c601141FingerprintSchema,
  c601141InventorySchema,
  c601141SafetySchema,
  c601141LexicalSchema,
  c601141AudioViewSchema,
} from "./c6-0-1-14-1-speech-inventory-schemas.js";
import {
  c601141RouteNameSchema,
  c601141EvaluationSchema,
} from "./c6-0-1-14-1-evaluation-schemas.js";

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const id = z.string().min(1);
const count = z.number().int().nonnegative();
const seconds = z.number().nonnegative();
const relative = z
  .string()
  .min(1)
  .refine(
    (v) =>
      !v.startsWith("/") && !v.includes("\\") && !v.split("/").includes(".."),
    "A normalized relative reference is required",
  );
const check = z
  .object({ id, passed: z.boolean(), detail: z.string() })
  .strict();
export const c601141MachineCodeSnapshotSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    artifactType: z.literal("c6-0-1-14-1-machine-code-snapshot"),
    files: z
      .array(z.object({ relativePath: relative, sha256: hash }).strict())
      .min(1),
    semanticHash: hash,
  })
  .strict();
export const c601141ViewControlsSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    artifactType: z.literal("c6-0-1-14-1-audio-view-synthetic-controls"),
    results: z
      .array(
        z
          .object({
            role: c601141AudioViewSchema.shape.role,
            frameCount: count,
            impulsePeakDelays: z.array(z.number().int()).length(3),
            sourceFrameCount: count,
            rationalMapping: z
              .object({ numerator: count, denominator: z.literal(16000) })
              .strict(),
            ptsResetPreservesSourceOrigin: z.literal(true),
          })
          .strict(),
      )
      .length(5),
    passed: z.boolean(),
    semanticHash: hash,
  })
  .strict();
export const c601141FinalReplaySchema = z
  .object({
    mode: z.literal("EXACT_CACHE_ONLY"),
    detector: c601141SweepsSchema.shape.accounting,
    asr: c601141AsrProbesSchema.shape.accounting,
    inferenceCount: z.literal(0),
    modelLoadCount: z.literal(0),
    providerProcessStartCount: z.literal(0),
    machineEvidenceSemanticHash: hash,
  })
  .strict();
export const c601141MachineQualityParitySchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    artifactType: z.literal("c6-0-1-14-1-machine-subtitle-parity-quality"),
    baselineEvaluationByteHash: hash,
    machinePackageByteHash: hash,
    machinePackageABByteParity: z.literal(true),
    metricComputation: z.literal(
      "REUSE_HASH_BOUND_BASELINE_METRICS_FOR_BYTE_IDENTICAL_SUBTITLES",
    ),
    globalTextMetrics: machineVsGoldEvaluationSchema.shape.globalTextMetrics,
    alignmentMetrics: machineVsGoldEvaluationSchema.shape.alignmentMetrics,
    timingMetrics: machineVsGoldEvaluationSchema.shape.timingMetrics,
    coverageMetrics: machineVsGoldEvaluationSchema.shape.coverageMetrics,
    missingDialogueCount: count,
    hallucinationCount: count,
    materialTextErrorCount: count,
    severeTimingErrorCount: count,
    machineOverlapCount: count,
    canonicalMutationCount: z.literal(0),
    productionStatus: z.literal("needs-review"),
    finalizationMethod: z.literal("none"),
    c602Status: z.literal("HOLD"),
    semanticHash: hash,
  })
  .strict();
export const c601141BrowserAuditSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    artifactType: z.literal("c6-0-1-14-1-browser-read-only-acceptance"),
    visibility: z.literal("LOCAL_ONLY"),
    checkedAt: z.iso.datetime(),
    workspaceDataByteHash: hash,
    workspaceJavascriptByteHash: hash,
    checks: z.array(check).min(1),
    consoleErrorCount: count,
    sessionBefore: z.null(),
    sessionAfter: z.null(),
    savedHumanDecisionCount: z.literal(0),
    humanTrialStarted: z.literal(false),
    passed: z.boolean(),
  })
  .strict()
  .refine(
    (v) =>
      v.passed ===
      (v.consoleErrorCount === 0 && v.checks.every((c) => c.passed)),
    "UI pass requires all observed checks and no console errors",
  );
const recall = z
  .object({ total: count, covered: count, recall: z.number().min(0).max(1) })
  .strict();
const physical = z
  .object({
    targetCount: count,
    itemCount: count,
    regionCount: count,
    wavCount: count,
    playableWavCount: count,
    playbackSegmentCount: count,
    requiredItemCount: count,
    fullQueueSeconds: seconds,
    conservativeQueueSeconds: seconds,
    mandatorySeconds: seconds,
    allTargetsAudible: z.boolean(),
  })
  .strict();
const parity = z
  .object({
    speechFreshReplay: z.boolean(),
    asrFreshReplay: z.boolean(),
    finalMachineBytes: z.boolean(),
    canonicalBytes: z.boolean(),
    canonicalTextHash: hash,
    canonicalTimingHash: hash,
    presentationHash: hash,
    machineTextMutationCount: z.literal(0),
    machineTimingMutationCount: z.literal(0),
    machinePresentationMutationCount: z.literal(0),
  })
  .strict();
export const c601141ValidationSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    artifactType: z.literal("c6-0-1-14-1-validation"),
    visibility: z.literal("LOCAL_ONLY"),
    generatedAt: z.iso.datetime(),
    checks: z.array(check).min(1),
    schemaResults: z
      .array(
        z
          .object({
            relativePath: relative,
            schemaId: id,
            byteHash: hash,
            zodPassed: z.literal(true),
            jsonSchemaPassed: z.literal(true),
          })
          .strict(),
      )
      .min(19),
    generatedSchemaCount: count,
    newSchemaCount: count,
    codeValidationHash: hash,
    browserAuditHash: hash,
    postFreezeEvaluationAuditHash: hash,
    speechFresh: c601141SweepsSchema.shape.accounting,
    speechReplay: c601141SweepsSchema.shape.accounting,
    asrFresh: c601141AsrProbesSchema.shape.accounting,
    asrReplay: c601141AsrProbesSchema.shape.accounting,
    physical,
    parity,
    finalAFreezeHash: hash,
    finalBFreezeHash: hash,
    route: c601141RouteNameSchema,
    engineeringAcceptancePassed: z.boolean(),
    coverageGatePassed: z.boolean(),
    runtimeGoldInputCount: z.literal(0),
    validationInferenceCount: z.literal(0),
    rankerRetrained: z.literal(false),
    newOofRun: z.literal(false),
    humanTrialStarted: z.literal(false),
    productionStatus: z.literal("needs-review"),
    finalizationMethod: z.literal("none"),
    c602Status: z.literal("HOLD"),
    machineOnlyReleaseAuthorized: z.literal(false),
    shareableSummaryHash: hash,
    shareableAuditPassed: z.boolean(),
    semanticHash: hash,
  })
  .strict()
  .refine(
    (v) =>
      v.engineeringAcceptancePassed ===
      (v.checks.every((c) => c.passed) && v.shareableAuditPassed),
    "Engineering status must reflect all checks, independently of subtitle coverage",
  );
/** Only aggregate numeric metrics, fixed enums and hashes cross this boundary. */
export const c601141ShareableSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    artifactType: z.literal("c6-0-1-14-1-shareable-summary"),
    visibility: z.literal("AGGREGATE_ONLY"),
    version: z.literal("C6.0.1.14.1"),
    viewCount: count,
    uniquePcmViewCount: count,
    fingerprint: c601141FingerprintSchema.shape.summary,
    speechFresh: c601141SweepsSchema.shape.accounting,
    speechReplay: c601141SweepsSchema.shape.accounting,
    asrFresh: c601141AsrProbesSchema.shape.accounting,
    asrReplay: c601141AsrProbesSchema.shape.accounting,
    startupFailureProviderStarts: count,
    nonSourceWarmupTransportCount: count,
    nonSourceWarmupEncoderDecoderCount: z.literal(0),
    inventory: c601141InventorySchema.shape.summary,
    safety: c601141SafetySchema.shape.summary,
    lexical: c601141LexicalSchema.shape.summary,
    physical,
    missingAudibleRecall: recall,
    missingFullRecall: recall,
    hallucinationAudibleRecall: recall,
    burden: c601141EvaluationSchema.shape.burden,
    parity,
    route: c601141RouteNameSchema,
    engineeringAcceptancePassed: z.boolean(),
    coverageGatePassed: z.boolean(),
    runtimeGoldInputCount: z.literal(0),
    rankerRetrained: z.literal(false),
    humanTrialStarted: z.literal(false),
    productionStatus: z.literal("needs-review"),
    finalizationMethod: z.literal("none"),
    c602Status: z.literal("HOLD"),
    machineOnlyReleaseAuthorized: z.literal(false),
    semanticHash: hash,
  })
  .strict();
export const c601141ShareableAuditSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    artifactType: z.literal("c6-0-1-14-1-shareable-audit"),
    summaryByteHash: hash,
    strictSchemaPassed: z.boolean(),
    absolutePathLeakCount: count,
    secretPatternCount: count,
    rawDialogueOrAudioFieldCount: count,
    sourceOrGoldIntervalFieldCount: count,
    brokenRelativeReferenceCount: count,
    passed: z.boolean(),
  })
  .strict();
export const c601141AcceptanceSchemas = {
  "c6-0-1-14-1-machine-code-snapshot": c601141MachineCodeSnapshotSchema,
  "c6-0-1-14-1-audio-view-synthetic-controls": c601141ViewControlsSchema,
  "c6-0-1-14-1-final-replay-accounting": c601141FinalReplaySchema,
  "c6-0-1-14-1-machine-subtitle-parity-quality":
    c601141MachineQualityParitySchema,
  "c6-0-1-14-1-browser-read-only-acceptance": c601141BrowserAuditSchema,
  "c6-0-1-14-1-validation": c601141ValidationSchema,
  "c6-0-1-14-1-shareable-summary": c601141ShareableSchema,
  "c6-0-1-14-1-shareable-audit": c601141ShareableAuditSchema,
};
export type C601141Validation = z.infer<typeof c601141ValidationSchema>;
export type C601141Shareable = z.infer<typeof c601141ShareableSchema>;
