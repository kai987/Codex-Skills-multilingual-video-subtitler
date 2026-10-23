import { z } from "zod";
import { header143Shape } from "./c6-0-1-14-3-monotonic-selection-schemas.js";
import {
  hash142Schema as h,
  id142Schema as id,
  count142Schema as n,
} from "./c6-0-1-14-2-selection-detector-schemas.js";
import { c601141MachineFreezeSchema } from "./c6-0-1-14-1-speech-inventory-schemas.js";
import {
  c601141SweepsSchema,
  c601141AsrProbesSchema,
} from "./c6-0-1-14-1-speech-inventory-schemas.js";
import { accounting142Schema } from "./c6-0-1-14-2-acoustic-schemas.js";
import { asrProbes142Schema } from "./c6-0-1-14-2-review-schemas.js";
import { relative142Schema } from "./c6-0-1-14-2-acceptance-schemas.js";
import {
  c60114MachineCoverageProjectionSchema,
  c60114PlaybackCoverageEvaluationSchema,
} from "./c6-0-1-14-evaluation-schemas.js";
import {
  c601141CodeValidationSchema,
  c601141EvaluationAuditSchema,
} from "./c6-0-1-14-1-evaluation-schemas.js";
import {
  c601141MachineCodeSnapshotSchema,
  c601141BrowserAuditSchema,
  c601141ShareableAuditSchema,
  c601141MachineQualityParitySchema,
} from "./c6-0-1-14-1-acceptance-schemas.js";
const identity = c601141MachineFreezeSchema.shape.sourceReadOnlyIdentity;
export const obligationFreeze143Schema = z
  .object({
    ...header143Shape,
    artifactType: z.literal("c6-0-1-14-3-phase-a-obligation-freeze"),
    frozenAt: z.iso.datetime(),
    obligationArtifactHash: h,
    obligationArtifactByteHash: h,
    policyByteHash: h,
    phaseASelectionHash: h,
    immutableTargetsHash: h,
    sourceReadOnlyIdentity: identity,
    goldReadStarted: z.literal(false),
    inputBindings: z.array(
      z.object({ relativePath: relative142Schema, byteHash: h }).strict(),
    ),
  })
  .strict()
  .refine(
    (v) =>
      v.inputBindings.every(
        (b) =>
          !/(?:^|[/_-])(?:gold|evaluation|human-correction)(?:[/_.-]|$)/iu.test(
            b.relativePath,
          ),
      ),
    "Gold/evaluation bindings are forbidden in the machine obligation freeze",
  );
export const baseline143Schema = z
  .object({
    ...header143Shape,
    artifactType: z.literal("c6-0-1-14-3-baseline-replay"),
    baselineCommit: z.string().regex(/^[a-f0-9]{40}$/u),
    sourceReadOnlyIdentity: identity,
    previousFinalAHash: h,
    previousFinalBHash: h,
    phaseAHash: h,
    combinedInventoryHash: h,
    canonicalTextHash: h,
    canonicalTimingHash: h,
    presentationHash: h,
    machineCueCount: n,
    phaseASafetyCount: n,
    phaseASafetyCoreSeconds: z.number().nonnegative(),
    oldFinalSafetyCount: n,
    oldFinalSafetyCoreSeconds: z.number().nonnegative(),
    immutableTargetCount: n,
    immutableItemCount: n,
    immutableRegionCount: n,
    sourceAudioStreamIndex: n,
    sourceNativeSampleRate: n.positive(),
    sourceDurationSeconds: z.number().positive(),
    inferenceCount: z.literal(0),
    modelLoadCount: z.literal(0),
    providerProcessStartCount: z.literal(0),
    canonicalTextMutationCount: z.literal(0),
    canonicalTimingMutationCount: z.literal(0),
    presentationMutationCount: z.literal(0),
    productionStatus: z.literal("needs-review"),
    finalizationMethod: z.literal("none"),
    baselineGoldMetricsDeferredUntilPostFreezeEvaluator: z.literal(true),
  })
  .strict();
export const state143Schema = z
  .object({
    config: z
      .object({
        baselineState: id,
        outputRoot: id,
        prefix: z.string().regex(/^[a-z0-9-]+$/u),
        date: z.string().regex(/^\d{8}$/u),
        executionPolicy: z.literal("replay-only"),
      })
      .strict(),
    configHash: h,
    outputs: z.record(z.string().regex(/^[a-z0-9-]+$/u), id),
    createdAt: z.iso.datetime(),
    policyPath: id,
  })
  .strict();
export const replay143Schema = z
  .object({
    ...header143Shape,
    artifactType: z.literal("c6-0-1-14-3-exact-cache-replay-accounting"),
    executionPolicy: z.literal("replay-only"),
    mode: z.literal("EXACT_CACHE_ONLY"),
    previousDetector: c601141SweepsSchema.shape.accounting,
    currentDetector: accounting142Schema,
    previousAsr: c601141AsrProbesSchema.shape.accounting,
    currentAsr: asrProbes142Schema.shape.accounting,
    expectedDetectorRequestCount: n,
    detectorCacheHitCount: n,
    expectedAsrRequestCount: n,
    asrCacheHitCount: n,
    detectorEvidenceSemanticHashes: z.array(h),
    asrEvidenceSemanticHashes: z.array(h),
    scoreTracksHash: h,
    detectorRuntimeIdentityHashes: z.array(h),
    detectorModelSnapshotHashes: z.array(h),
    asrRuntimeIdentityHashes: z.array(h),
    asrModelIdentityHashes: z.array(h),
    asrModelFileManifestHashes: z.array(h),
    sourceReadOnlyIdentity: identity,
    previousEvidenceParity: z.literal(true),
    currentEvidenceParity: z.literal(true),
    inferenceCount: z.literal(0),
    modelLoadCount: z.literal(0),
    providerProcessStartCount: z.literal(0),
    cacheMissCount: z.literal(0),
    retryCount: z.literal(0),
    backfillCount: z.literal(0),
    networkRequestCount: z.literal(0),
  })
  .strict()
  .refine(
    (v) =>
      v.detectorCacheHitCount === v.expectedDetectorRequestCount &&
      v.asrCacheHitCount === v.expectedAsrRequestCount,
    "Every frozen request must hit exact cache",
  );
export const machineCode143Schema = c601141MachineCodeSnapshotSchema
  .extend({ artifactType: z.literal("c6-0-1-14-3-machine-code-snapshot") })
  .strict();
export const stages143 = [
  "A0",
  "A1",
  "A2",
  "A3",
  "A4",
  "A5",
  "A6",
  "A7",
] as const;
export const projection143Schema = z
  .object({
    stage: z.enum(stages143),
    description: id,
    projection: c60114MachineCoverageProjectionSchema,
    workspaceRelativePath: relative142Schema,
    officialPlanId: id,
    selectionUnit: z.enum([
      "C601141_BASELINE",
      "C601142_PHASE_A",
      "C601142_FINAL",
      "PHASE_A_OBLIGATION",
      "SELECTED_CHILD_UNIT",
      "TARGET_BUNDLE",
      "PLANNER_TARGET",
      "FINAL_DELIVERY",
    ]),
    safetyTargetCount: n,
    safetyCoreUnionSeconds: z.number().nonnegative(),
    phaseAObligationCoverage: z.number().min(0).max(1),
    phaseARegressionCount: n,
    physicalAudioVerified: z.literal(true),
    derivedFromFrozenEvidence: z.literal(true),
    goldBlind: z.literal(true),
    semanticHash: h,
  })
  .strict();
export const projections143Schema = z
  .object({
    ...header143Shape,
    artifactType: z.literal("c6-0-1-14-3-machine-coverage-projections"),
    variants: z.array(projection143Schema).length(8),
    officialStage: z.literal("A7"),
    officialPlanId: z.literal("C601143_FINAL_REVIEW_DELIVERY"),
    newInferenceCount: z.literal(0),
    rankerRetrained: z.literal(false),
    goldBlind: z.literal(true),
  })
  .strict()
  .refine(
    (v) => v.variants.every((r, i) => r.stage === stages143[i]),
    "A0-A7 must be ordered and complete",
  );
const artifactBinding = z
  .object({
    relativePath: relative142Schema,
    byteHash: h,
    semanticHash: h.nullable(),
  })
  .strict();
export const machineFreeze143Schema = c601141MachineFreezeSchema
  .extend({
    ...header143Shape,
    artifactType: z.literal("c6-0-1-14-3-machine-selection-freeze"),
    stage: z.literal("FINAL_MACHINE_DELIVERY"),
    baselineReplayHash: h,
    transitionAuditHash: h,
    phaseAObligationsHash: h,
    obligationFreezeHash: h,
    hierarchyHash: h,
    bundleCandidatesHash: h,
    dominanceLedgerHash: h,
    plannerCertificateHash: h,
    continuityLedgerHash: h,
    safetyTargetsHash: h,
    reviewTargetsHash: h,
    reviewItemsHash: h,
    reviewRegionsHash: h,
    audioManifestHash: h,
    playbackTimelineHash: h,
    projectionHash: h,
    replayAccountingHash: h,
    codeSnapshotHash: h,
    artifactBindings: z.array(artifactBinding),
    detectorInferenceCount: z.literal(0),
    asrInferenceCount: z.literal(0),
    detectorCacheMissCount: z.literal(0),
    asrCacheMissCount: z.literal(0),
    runtimeGoldInputBeforeFreeze: z.literal(0),
    finalRole: z.enum(["A", "B"]),
  })
  .strict()
  .refine(
    (v) =>
      v.artifactBindings.every(
        (b) =>
          !/(?:^|[/_-])(?:gold|evaluation|human-correction)(?:[/_.-]|$)/iu.test(
            b.relativePath,
          ),
      ),
    "Gold/evaluation bindings are forbidden in the machine freeze",
  );
export const parity143Schema = z
  .object({
    ...header143Shape,
    artifactType: z.literal("c6-0-1-14-3-final-ab-parity"),
    finalAFreezeHash: h,
    finalBFreezeHash: h,
    comparedFiles: n,
    semanticCompared: n,
    audioCompared: n,
    protectedFilesCompared: n,
    byteParity: z.literal(true),
    semanticParity: z.literal(true),
    audioShaParity: z.literal(true),
    canonicalByteParity: z.literal(true),
    normalizedFreezeParity: z.literal(true),
    mismatches: z.array(id).length(0),
  })
  .strict();
export const firstGoldRead143Schema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    artifactType: z.literal("c6-0-1-14-3-durable-first-gold-read-intent"),
    visibility: z.literal("LOCAL_ONLY"),
    firstGoldReadAt: z.iso.datetime(),
    machineFreezeCompletedAt: z.iso.datetime(),
    freezeBeforeGold: z.literal(true),
    finalAFreezeHash: h,
    finalBFreezeHash: h,
    codeSnapshotHash: h,
    codeValidationHash: h,
    browserAuditHash: h,
    parityHash: h,
    writtenAndFsyncedBeforeGoldOpen: z.literal(true),
    evaluatorOnly: z.literal(true),
    runtimeGoldInputCount: z.literal(0),
    semanticHash: h,
  })
  .strict();
const diagnosis = z.enum([
  "BASELINE_ALREADY_COVERED",
  "PRESERVED_FROM_PHASE_A",
  "RECOVERED_BY_HIERARCHICAL_CHILD_SELECTION",
  "RECOVERED_BY_TARGET_BUNDLE",
  "RECOVERED_BY_CONSTRAINED_FINAL_PLANNER",
  "PHASE_A_COVERAGE_REGRESSION",
  "HIERARCHICAL_CHILD_SELECTION_MISS",
  "SAFETY_BUDGET_INFEASIBLE",
  "PLANNER_SEARCH_INCOMPLETE",
  "REVIEW_AUDIO_OMISSION",
  "GOLD_MAPPING_UNRESOLVED",
]);
export const component143Schema = z
  .object({
    errorComponentId: id,
    labels: z.array(id),
    baselineStatus: id,
    phaseAStatus: id,
    c601142FinalStatus: id,
    c601143FinalStatus: id,
    bestStageReached: z.enum(stages143).nullable(),
    regressedAfterStage: z.enum(stages143).nullable(),
    inventoryCoverage: z.number().min(0).max(1),
    targetCoverage: z.number().min(0).max(1),
    physicalAudioCoverage: z.number().min(0).max(1),
    playbackCoverage: z.number().min(0).max(1),
    localizedLexicalCoverage: z.number().min(0).max(1),
    finalDiagnosis: diagnosis,
  })
  .strict();
export const evaluation143Schema = z
  .object({
    ...header143Shape,
    artifactType: z.literal("gold-c6-0-1-14-3-selection-continuity-evaluation"),
    generatedAt: z.iso.datetime(),
    projectionHash: h,
    freezeHash: h,
    firstReadIntentHash: h,
    variants: z
      .array(
        z
          .object({
            stage: z.enum(stages143),
            evaluation: c60114PlaybackCoverageEvaluationSchema,
          })
          .strict(),
      )
      .length(8),
    components: z.array(component143Schema),
    officialStage: z.literal("A7"),
    officialPlanId: z.literal("C601143_FINAL_REVIEW_DELIVERY"),
    missingTotal: n,
    hallucinationTotal: n,
    missingAudibleCount: n,
    hallucinationAudibleCount: n,
    evaluationIntegrityPassed: z.boolean(),
    matchingRulesChanged: z.literal(false),
    evaluatorInferenceCount: z.literal(0),
    canonicalMutationCount: z.literal(0),
  })
  .strict();
export const routeNames143 = [
  "GO_C6_0_1_15_REGION_RANKER_RECALIBRATION",
  "HOLD_FOR_CROSS_STAGE_COVERAGE_REGRESSION",
  "HOLD_FOR_HIERARCHICAL_TARGET_SELECTION_REPAIR",
  "HOLD_FOR_SAFETY_BUDGET_MODEL_REDESIGN",
  "HOLD_FOR_PLANNER_SEARCH_COMPLETENESS",
  "HOLD_FOR_REVIEW_AUDIO_COVERAGE_REPAIR",
  "HOLD_FOR_EVALUATION_INTEGRITY_REPAIR",
  "HOLD_FOR_ENGINEERING_REPAIR",
] as const;
export const route143Schema = z
  .object({
    ...header143Shape,
    artifactType: z.literal("c6-0-1-14-3-route-decision"),
    primaryDecision: z.enum(routeNames143),
    blockers: z.array(id),
    engineeringGatePassed: z.boolean(),
    evaluationIntegrityGatePassed: z.boolean(),
    phaseAObligationCoverage: z.number().min(0).max(1),
    phaseARegressionCount: n,
    missingPlaybackAudible: z.object({ covered: n, total: n }).strict(),
    hallucinationPlaybackAudible: z.object({ covered: n, total: n }).strict(),
    audioRequiredTargetCoveragePassed: z.boolean(),
    playbackTargetCoveragePassed: z.boolean(),
    targetBudgetPassed: z.boolean(),
    coreBudgetPassed: z.boolean(),
    fullQueueBurdenPassed: z.boolean(),
    wholeEpisodeCatchAllCount: z.literal(0),
    runtimeGoldInputCount: z.literal(0),
    datasetHardcodingCount: z.literal(0),
    detectorInferenceCount: z.literal(0),
    asrInferenceCount: z.literal(0),
    canonicalTextMutationCount: z.literal(0),
    canonicalTimingMutationCount: z.literal(0),
    finalABParity: z.boolean(),
    productionStatus: z.literal("needs-review"),
    finalizationMethod: z.literal("none"),
    c602Status: z.literal("HOLD"),
  })
  .strict();
export const codeValidation143Schema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    artifactType: z.literal("c6-0-1-14-3-code-validation"),
    generatedAt: z.iso.datetime(),
    nodeVersion: id,
    packageManager: id,
    results: z
      .array(
        c601141CodeValidationSchema.shape.results.element
          .omit({ id: true })
          .extend({
            id: z.enum([
              "npm-ci",
              "schema-generation",
              "typecheck",
              "lint",
              "format-check",
              "build",
              "unit",
              "non-e2e-unit",
              "e2e",
              "c601143-targeted",
              "cross-version",
              "review-ui",
            ]),
          })
          .strict(),
      )
      .length(12),
    passed: z.boolean(),
    realAsrExecutedByValidation: z.literal(false),
    goldEvaluationExecutedByValidation: z.literal(false),
    rankerTrainingExecutedByValidation: z.literal(false),
  })
  .strict()
  .refine(
    (v) =>
      new Set(v.results.map((r) => r.id)).size === 12 &&
      v.passed === v.results.every((r) => r.passed && r.exitCode === 0),
    "Every required C6.0.1.14.3 check must occur and pass",
  );
export const browserAudit143Schema = z
  .object({
    ...c601141BrowserAuditSchema.shape,
    artifactType: z.literal("c6-0-1-14-3-browser-read-only-acceptance"),
  })
  .strict()
  .refine(
    (v) =>
      v.passed ===
      (v.consoleErrorCount === 0 && v.checks.every((c) => c.passed)),
    "UI pass requires all observed checks and no console errors",
  );
export const shareableAudit143Schema = z
  .object({
    ...c601141ShareableAuditSchema.shape,
    artifactType: z.literal("c6-0-1-14-3-shareable-audit"),
  })
  .strict()
  .refine(
    (v) =>
      v.passed ===
      (v.strictSchemaPassed &&
        v.absolutePathLeakCount === 0 &&
        v.secretPatternCount === 0 &&
        v.rawDialogueOrAudioFieldCount === 0 &&
        v.sourceOrGoldIntervalFieldCount === 0 &&
        v.brokenRelativeReferenceCount === 0),
    "Shareable audit pass requires every disclosure and integrity counter to be zero",
  );
export const shareable143Schema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    artifactType: z.literal("c6-0-1-14-3-shareable-acceptance-summary"),
    visibility: z.literal("SHAREABLE_AGGREGATE_ONLY"),
    codeSnapshotHash: h,
    obligationHash: h,
    hierarchyHash: h,
    bundleCandidatesHash: h,
    plannerCertificateHash: h,
    finalEvidenceHash: h,
    canonicalTextHash: h,
    canonicalTimingHash: h,
    presentationHash: h,
    detectorReplayHits: n,
    asrReplayHits: n,
    finalAReplayInference: z.literal(0),
    finalBReplayInference: z.literal(0),
    phaseAObligationCount: n,
    phaseAObligationCoverage: z.number().min(0).max(1),
    phaseARegressionCount: n,
    childCount: n,
    bundleCandidateCount: n,
    safetyTargetCount: n.max(24),
    safetyUnionSeconds: z.number().nonnegative().max(60),
    physicalWavCount: n,
    targetCount: n,
    regionCount: n,
    missingComponents: n,
    audibleMissingComponents: n,
    hallucinationComponents: n,
    audibleHallucinationComponents: n,
    fullQueueSeconds: z.number().nonnegative(),
    fullQueueEpisodeRatio: z.number().min(0).max(1),
    engineeringPassed: z.boolean(),
    evaluationIntegrityPassed: z.boolean(),
    route: z.enum(routeNames143),
    productionStatus: z.literal("needs-review"),
    finalizationMethod: z.literal("none"),
    c602Status: z.literal("HOLD"),
    canonicalMutationCount: z.literal(0),
    rawDialogueIncluded: z.literal(false),
    goldIncluded: z.literal(false),
    nativeScoresIncluded: z.literal(false),
    localPathsIncluded: z.literal(false),
    semanticHash: h,
  })
  .strict();
export const machineQuality143Schema = z
  .object({
    ...c601141MachineQualityParitySchema.shape,
    artifactType: z.literal("c6-0-1-14-3-machine-subtitle-parity-quality"),
  })
  .strict();
export const evaluationAudit143Schema = z
  .object({
    ...c601141EvaluationAuditSchema.shape,
    artifactType: z.literal("c6-0-1-14-3-post-freeze-evaluation-audit"),
  })
  .strict();
export const validation143Schema = z
  .object({
    ...header143Shape,
    artifactType: z.literal("c6-0-1-14-3-validation"),
    generatedAt: z.iso.datetime(),
    checks: z.array(
      z.object({ id: id, passed: z.boolean(), evidenceHash: h }).strict(),
    ),
    passed: z.boolean(),
    routeDecision: z.enum(routeNames143),
    finalAFreezeHash: h,
    finalBFreezeHash: h,
    codeValidationHash: h,
    browserAuditHash: h,
    shareableSummaryHash: h,
    shareableAuditHash: h,
    evaluationHash: h,
    skillValidationHash: h,
    schemaValidatedArtifactCount: n,
    generatedSchemaCount: n,
  })
  .strict()
  .refine(
    (v) => v.passed === v.checks.every((c) => c.passed),
    "Validation pass must reflect every check",
  );
export const c601143AcceptanceSchemas = {
  "c6-0-1-14-3-phase-a-obligation-freeze": obligationFreeze143Schema,
  "c6-0-1-14-3-baseline-replay": baseline143Schema,
  "c6-0-1-14-3-run-paths.local-only": state143Schema,
  "c6-0-1-14-3-exact-cache-replay-accounting": replay143Schema,
  "c6-0-1-14-3-machine-code-snapshot": machineCode143Schema,
  "c6-0-1-14-3-machine-coverage-projections": projections143Schema,
  "c6-0-1-14-3-machine-selection-freeze": machineFreeze143Schema,
  "c6-0-1-14-3-final-ab-parity": parity143Schema,
  "c6-0-1-14-3-durable-first-gold-read-intent": firstGoldRead143Schema,
  "gold-c6-0-1-14-3-selection-continuity-evaluation": evaluation143Schema,
  "c6-0-1-14-3-route-decision": route143Schema,
  "c6-0-1-14-3-code-validation": codeValidation143Schema,
  "c6-0-1-14-3-browser-read-only-acceptance": browserAudit143Schema,
  "c6-0-1-14-3-shareable-audit": shareableAudit143Schema,
  "c6-0-1-14-3-shareable-acceptance-summary": shareable143Schema,
  "c6-0-1-14-3-machine-subtitle-parity-quality": machineQuality143Schema,
  "c6-0-1-14-3-post-freeze-evaluation-audit": evaluationAudit143Schema,
  "c6-0-1-14-3-validation": validation143Schema,
};
export type Projections143 = z.infer<typeof projections143Schema>;
export type MachineFreeze143 = z.infer<typeof machineFreeze143Schema>;
export type Evaluation143 = z.infer<typeof evaluation143Schema>;
export type Route143 = z.infer<typeof route143Schema>;
