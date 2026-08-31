import { z } from "zod";
import {
  header142Shape,
  hash142Schema as h,
  id142Schema as id,
  count142Schema as n,
  ratio142Schema as ratio,
  family142Schema,
} from "./c6-0-1-14-2-selection-detector-schemas.js";
import {
  accounting142Schema,
  scoreStats142Schema,
  acousticFeatures142Schema,
} from "./c6-0-1-14-2-acoustic-schemas.js";
import { asrProbes142Schema } from "./c6-0-1-14-2-review-schemas.js";
import {
  c60114MachineCoverageProjectionSchema,
  c60114PlaybackCoverageEvaluationSchema,
  c60114ErrorComponentSchema,
} from "./c6-0-1-14-evaluation-schemas.js";
import {
  c601141EvaluationAuditSchema,
  c601141CodeValidationSchema,
} from "./c6-0-1-14-1-evaluation-schemas.js";
import {
  c601141BrowserAuditSchema,
  c601141MachineCodeSnapshotSchema,
  c601141MachineQualityParitySchema,
  c601141ShareableAuditSchema,
} from "./c6-0-1-14-1-acceptance-schemas.js";
import {
  c601141MachineFreezeSchema,
  c601141SweepsSchema,
  c601141AsrProbesSchema,
} from "./c6-0-1-14-1-speech-inventory-schemas.js";
const seconds = z.number().nonnegative();
export const relative142Schema = z
  .string()
  .min(1)
  .refine(
    (v) =>
      !v.startsWith("/") &&
      !v.includes("\\") &&
      !v.split("/").includes("..") &&
      !v.includes("\0"),
    "Safe relative path required",
  );
export const stages142 = [
  "A0",
  "A1",
  "A2",
  "A3",
  "B1",
  "B2",
  "B3",
  "B4",
  "B5",
  "B6",
  "B7",
  "B8",
] as const;
export const policyBinding142Schema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    artifactType: z.literal("c6-0-1-14-2-policy-name-binding"),
    requestedPolicyVersion: z.literal(
      "c6.0.1.14.2-detector-exclusive-selection-masked-speech-ceiling-v1",
    ),
    frozenExecutionPolicyVersion: z.literal(
      "c6.0.1.14.2-safety-selection-detector-ceiling-v1",
    ),
    executionPolicyHash: h,
    aliasOnly: z.literal(true),
    thresholdsChanged: z.literal(false),
    cacheKeysChanged: z.literal(false),
    inferenceCount: z.literal(0),
    semanticHash: h,
  })
  .strict();
export const stage142Schema = z.enum(stages142);
export const comparisonInputs142Schema = z
  .object({
    ...header142Shape,
    artifactType: z.literal("c6-0-1-14-2-comparison-input-projections"),
    baselineProjectionHash: h,
    entries: z
      .array(
        z
          .object({
            role: z.enum(["A1", "A2", "A3", "detector-only"]),
            projection: c60114MachineCoverageProjectionSchema,
            workspaceRelativePath: relative142Schema,
            safetyHash: h,
            semanticHash: h,
          })
          .strict(),
      )
      .length(4),
    detectorOnlySelectionPolicy: z.literal(
      "PRESERVE_24_ATOMIC_BASELINE_SLOTS_WITHOUT_SELECTION_REPAIR",
    ),
    inferenceCount: z.literal(0),
    goldBlind: z.literal(true),
  })
  .strict()
  .refine(
    (v) => new Set(v.entries.map((r) => r.role)).size === 4,
    "Four physical comparisons required",
  );
export const projection142Schema = z
  .object({
    stage: stage142Schema,
    description: id,
    projection: c60114MachineCoverageProjectionSchema,
    workspaceRelativePath: relative142Schema,
    officialPlanId: id,
    physicalAudioVerified: z.literal(true),
    inferenceCount: z.literal(0),
    derivedFromFrozenEvidence: z.literal(true),
    semanticHash: h,
  })
  .strict();
export const projections142Schema = z
  .object({
    ...header142Shape,
    artifactType: z.literal("c6-0-1-14-2-machine-coverage-projections"),
    variants: z.array(projection142Schema).length(12),
    comparisonPlans: z
      .array(
        z
          .object({
            planId: z.enum([
              "C601141_BASELINE_FULL_QUEUE",
              "C601142_SELECTION_REPAIR_ONLY",
              "C601142_DETECTOR_CEILING_ONLY",
              "C601142_FINAL_FULL_QUEUE",
            ]),
            projection: c60114MachineCoverageProjectionSchema,
            workspaceRelativePath: relative142Schema,
            officialPlanId: id,
            semanticHash: h,
          })
          .strict(),
      )
      .length(4),
    newInferenceCount: z.literal(0),
    goldBlind: z.literal(true),
    rankerRetrained: z.literal(false),
    newOofRun: z.literal(false),
  })
  .strict()
  .refine(
    (v) =>
      v.variants.every((row, index) => row.stage === stages142[index]) &&
      new Set(v.comparisonPlans.map((p) => p.planId)).size === 4,
    "Every stage and physical comparison must occur once",
  );
export const machineCode142Schema = c601141MachineCodeSnapshotSchema
  .extend({ artifactType: z.literal("c6-0-1-14-2-machine-code-snapshot") })
  .strict();
export const finalReplay142Schema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    artifactType: z.literal("c6-0-1-14-2-final-replay-accounting"),
    mode: z.literal("EXACT_CACHE_ONLY"),
    baselineDetector: c601141SweepsSchema.shape.accounting,
    baselineAsr: c601141AsrProbesSchema.shape.accounting,
    detector: accounting142Schema,
    asr: asrProbes142Schema.shape.accounting,
    inferenceCount: z.literal(0),
    modelLoadCount: z.literal(0),
    providerProcessStartCount: z.literal(0),
    machineEvidenceSemanticHash: h,
    semanticHash: h,
  })
  .strict();
export const machineFreeze142Schema = c601141MachineFreezeSchema
  .extend({
    ...header142Shape,
    artifactType: z.literal("c6-0-1-14-2-machine-selection-detector-freeze"),
    stage: z.literal("FINAL_MACHINE_DELIVERY"),
    codeSnapshotHash: h,
    projectionHash: h,
    reviewWorkspaceHash: h,
    replayAccountingHash: h,
    acquisitionSummary: z
      .object({
        detectorPlanHash: h,
        detectorFresh: accounting142Schema,
        detectorReplay: accounting142Schema,
        asrPlanHash: h,
        asrFresh: asrProbes142Schema.shape.accounting,
        asrReplay: asrProbes142Schema.shape.accounting,
        detectorRuntimeIdentityHashes: z.array(h),
        detectorSnapshotHashes: z.array(h),
        asrRuntimeIdentityHashes: z.array(h),
        asrSnapshotHashes: z.array(h),
        preDetectorFreezeHash: h,
        phaseAHash: h,
        goldInputCount: z.literal(0),
      })
      .strict(),
  })
  .strict();
export const codeCheckIds142 = [
  "npm-ci",
  "schema-generation",
  "typecheck",
  "lint",
  "format-check",
  "build",
  "unit",
  "non-e2e-unit",
  "e2e",
  "c601142-targeted",
  "cross-version",
  "review-ui",
] as const;
export const codeValidation142Schema = z
  .object({
    ...c601141CodeValidationSchema.shape,
    artifactType: z.literal("c6-0-1-14-2-code-validation"),
    results: z
      .array(
        c601141CodeValidationSchema.shape.results.element
          .extend({ id: z.enum(codeCheckIds142) })
          .strict(),
      )
      .length(codeCheckIds142.length),
  })
  .strict()
  .refine(
    (v) =>
      new Set(v.results.map((r) => r.id)).size === codeCheckIds142.length &&
      v.passed === v.results.every((r) => r.passed && r.exitCode === 0),
    "All required checks must occur once and pass",
  );
export const browserAudit142Schema = z
  .object({
    ...c601141BrowserAuditSchema.shape,
    artifactType: z.literal("c6-0-1-14-2-browser-read-only-acceptance"),
  })
  .strict()
  .refine(
    (v) =>
      v.passed ===
      (v.consoleErrorCount === 0 && v.checks.every((c) => c.passed)),
    "Browser pass requires observed checks and zero console errors",
  );
export const machineQuality142Schema = c601141MachineQualityParitySchema
  .extend({
    artifactType: z.literal("c6-0-1-14-2-machine-subtitle-parity-quality"),
  })
  .strict();
export const firstGoldRead142Schema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    artifactType: z.literal("c6-0-1-14-2-durable-first-gold-read-intent"),
    visibility: z.literal("LOCAL_ONLY"),
    firstGoldReadAt: z.iso.datetime(),
    finalAFreezeHash: h,
    finalBFreezeHash: h,
    codeSnapshotHash: h,
    codeValidationHash: h,
    browserAuditHash: h,
    writtenAndFsyncedBeforeGoldOpen: z.literal(true),
    evaluatorOnly: z.literal(true),
    runtimeGoldInputCount: z.literal(0),
    semanticHash: h,
  })
  .strict();
export const evaluationAudit142Schema = c601141EvaluationAuditSchema
  .extend({
    artifactType: z.literal("c6-0-1-14-2-post-freeze-evaluation-audit"),
    firstReadIntentHash: h,
    durableIntentBeforeGoldRead: z.literal(true),
    browserAuditByteHash: h,
  })
  .strict();
export const route142Schema = z
  .object({
    primaryDecision: z.enum([
      "GO_C6_0_1_15_REGION_RANKER_RECALIBRATION",
      "HOLD_FOR_ENGINEERING_REPAIR",
      "HOLD_FOR_EVALUATION_INTEGRITY_REPAIR",
      "HOLD_FOR_SAFETY_TARGET_SELECTION_REPAIR",
      "HOLD_FOR_INDEPENDENT_DETECTOR_RUNTIME",
      "HOLD_FOR_MASKED_SPEECH_DETECTOR_CEILING",
      "HOLD_FOR_DIALOGUE_ENHANCEMENT_SOURCE_SEPARATION_INVESTIGATION",
      "HOLD_FOR_REVIEW_AUDIO_COVERAGE_REPAIR",
    ]),
    blockers: z.array(
      z
        .object({
          diagnosis: id,
          errorComponentIds: z.array(id),
          reasons: z.array(id),
        })
        .strict(),
    ),
    advisories: z.array(id),
    fullQueueGatePassed: z.boolean(),
    targetBudgetPassed: z.boolean(),
    fullQueueBurdenPassed: z.boolean(),
    engineeringPassed: z.boolean(),
    evaluationIntegrityPassed: z.boolean(),
    mandatorySubsetRecallIsBlocking: z.literal(false),
    lexicalIncompleteWhenAudibleIsBlocking: z.literal(false),
    finalizationMethod: z.literal("none"),
    productionStatus: z.literal("needs-review"),
    c602Status: z.literal("HOLD"),
    machineOnlyReleaseAuthorized: z.literal(false),
    rankerRetrained: z.literal(false),
    humanTrialStarted: z.literal(false),
    semanticHash: h,
  })
  .strict();
export const contribution142Schema = z
  .object({
    errorComponentId: id,
    errorIntervals: c60114ErrorComponentSchema.shape.errorIntervals,
    baselineAudible: z.boolean(),
    selectionOnlyAudible: z.boolean(),
    detectorOnlyAudible: z.boolean(),
    finalAudible: z.boolean(),
    finalFull: z.boolean(),
    candidateIds: z.array(id),
    clusterIds: z.array(id),
    selectedTargetIds: z.array(id),
    maskingCandidateIds: z.array(id),
    detectorFamilies: z.array(family142Schema),
    localizedAsrRequestIds: z.array(id),
    directCoverage: z
      .object({
        oldInventory: ratio,
        oldSafety: ratio,
        selectionOnlySafety: ratio,
        newSilero: ratio,
        newPyannote: ratio,
        webRtc: ratio,
        subthresholdMasked: ratio,
        combinedInventory: ratio,
        finalSafety: ratio,
        physicalAudio: ratio,
        playback: ratio,
        localizedLexical: ratio,
      })
      .strict(),
    primaryDiagnosis: z.enum([
      "COVERED_BY_BASELINE",
      "RECOVERED_BY_SELECTION_REPAIR",
      "RECOVERED_BY_DETECTOR_CEILING",
      "AUDIBLE_WITHOUT_LEXICAL_EVIDENCE",
      "RECOVERED_WITH_LOCALIZED_LEXICAL_EVIDENCE",
      "DETECTOR_MISS",
      "SAFETY_TARGET_SELECTION_MISS",
      "REVIEW_AUDIO_OMISSION",
      "GOLD_MAPPING_UNRESOLVED",
    ]),
    scoreDiagnostics: z.array(
      z
        .object({
          runId: id,
          detectorFamily: z.enum(["SILERO", "PYANNOTE", "WEBRTC"]),
          viewId: id,
          scoreKind: z.enum(["PROBABILITY", "BINARY_DECISION"]),
          frameCount: n,
          statistics: scoreStats142Schema.nullable(),
          mainThreshold: ratio,
          auditThreshold: ratio,
          anyMainCrossing: z.boolean(),
          anySubthresholdCrossing: z.boolean(),
          maximumSubthresholdPeakSeconds: seconds,
          preciseSourceMapping: z.literal(true),
          thresholdRetuned: z.literal(false),
        })
        .strict(),
    ),
    acousticDiagnostics: z.array(
      z
        .object({
          candidateId: id,
          features: acousticFeatures142Schema,
          evidenceClass: id,
          contradiction: z.boolean(),
        })
        .strict(),
    ),
    maskingDiagnosis: z.enum([
      "ACOUSTIC_SPEECHLIKE_WITH_DETECTOR_MISS",
      "MAIN_THRESHOLD_CROSSING",
      "SUBTHRESHOLD_ONLY",
      "MUSIC_CONTRADICTION_PROXY",
      "INSUFFICIENT_EVIDENCE",
    ]),
    manualListeningClaim: z.literal("NOT_CLAIMED_BY_AUTOMATED_EVALUATOR"),
    semanticHash: h,
  })
  .strict();
export const evaluation142Schema = z
  .object({
    ...header142Shape,
    artifactType: z.literal(
      "c6-0-1-14-2-selection-detector-ceiling-evaluation",
    ),
    generatedAt: z.iso.datetime(),
    projectionHash: h,
    variants: z
      .array(
        z
          .object({
            stage: stage142Schema,
            evaluation: c60114PlaybackCoverageEvaluationSchema,
          })
          .strict(),
      )
      .length(12),
    comparisonPlans: z
      .array(
        z
          .object({
            planId: id,
            evaluation: c60114PlaybackCoverageEvaluationSchema,
          })
          .strict(),
      )
      .length(4),
    officialPlanId: z.literal("C601142_FINAL_FULL_QUEUE"),
    route: route142Schema,
    sourceContribution: z.array(contribution142Schema),
    burden: z
      .object({
        baselineSafetyCount: n,
        finalSafetyCount: n.max(24),
        baselineSafetyUnionSeconds: seconds,
        finalSafetyUnionSeconds: seconds.max(60.000001),
        slotsRecovered: n,
        baselineFullQueueSeconds: seconds,
        selectionOnlyFullQueueSeconds: seconds,
        detectorOnlyFullQueueSeconds: seconds,
        finalFullQueueSeconds: seconds,
        incrementalFullQueueSeconds: seconds,
        episodeRatio: z.number().min(0).max(1.001),
        safetyTargetsNotOverlappingGoldMissing: n,
        safetyTargetSecondsNotOverlappingGoldMissing: seconds,
        additionalRecoveredMissing: n,
        audioSecondsPerRecoveredMissing: seconds.nullable(),
        nonOverlapMeansConfirmedFalsePositive: z.literal(false),
      })
      .strict(),
    matchingRulesChanged: z.literal(false),
    evaluatorInferenceCount: z.literal(0),
    canonicalMutationCount: z.literal(0),
  })
  .strict();
export const runValidation142Schema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    artifactType: z.literal("c6-0-1-14-2-validation"),
    visibility: z.literal("LOCAL_ONLY"),
    generatedAt: z.iso.datetime(),
    checks: z
      .array(z.object({ id, passed: z.boolean(), detail: z.string() }).strict())
      .min(1),
    schemaResults: z.array(
      z
        .object({
          relativePath: relative142Schema,
          schemaId: id,
          valid: z.boolean(),
          errorCount: n,
        })
        .strict(),
    ),
    schemaCount: n,
    checkedArtifactCount: n,
    engineeringPassed: z.boolean(),
    evaluationIntegrityPassed: z.boolean(),
    allChecksPassed: z.boolean(),
    route: route142Schema,
    semanticHash: h,
  })
  .strict();
export const artifactPreflight142Schema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    artifactType: z.literal("c6-0-1-14-2-machine-artifact-preflight"),
    visibility: z.literal("LOCAL_ONLY"),
    checkedAt: z.iso.datetime(),
    results: runValidation142Schema.shape.schemaResults,
    passed: z.boolean(),
    goldReadCount: z.literal(0),
    inferenceCount: z.literal(0),
    semanticHash: h,
  })
  .strict();
export const shareable142Schema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    artifactType: z.literal("c6-0-1-14-2-shareable-acceptance-summary"),
    visibility: z.literal("SHAREABLE_AGGREGATE_ONLY"),
    codeSnapshotHash: h,
    detectorEvidenceHash: h,
    asrEvidenceHash: h,
    finalEvidenceHash: h,
    canonicalTextHash: h,
    canonicalTimingHash: h,
    presentationHash: h,
    detectorFreshCount: n.max(8),
    detectorReplayHits: n.max(8),
    asrFreshCount: n.max(12),
    asrReplayHits: n.max(12),
    finalAReplayInference: z.literal(0),
    finalBReplayInference: z.literal(0),
    safetyTargetCount: n.max(24),
    safetyUnionSeconds: seconds.max(60.000001),
    physicalWavCount: n,
    targetCount: n,
    regionCount: n,
    missingComponents: n,
    audibleMissingComponents: n,
    fullMissingComponents: n,
    hallucinationComponents: n,
    audibleHallucinationComponents: n,
    fullQueueSeconds: seconds,
    engineeringPassed: z.boolean(),
    evaluationIntegrityPassed: z.boolean(),
    fullQueueGatePassed: z.boolean(),
    route: route142Schema.shape.primaryDecision,
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
export const shareableAudit142Schema = c601141ShareableAuditSchema
  .extend({ artifactType: z.literal("c6-0-1-14-2-shareable-audit") })
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
    "All export checks must agree",
  );
export const c601142AcceptanceSchemas = {
  "c6-0-1-14-2-policy-name-binding": policyBinding142Schema,
  "c6-0-1-14-2-comparison-input-projections": comparisonInputs142Schema,
  "c6-0-1-14-2-machine-coverage-projections": projections142Schema,
  "c6-0-1-14-2-machine-code-snapshot": machineCode142Schema,
  "c6-0-1-14-2-final-replay-accounting": finalReplay142Schema,
  "c6-0-1-14-2-machine-selection-detector-freeze": machineFreeze142Schema,
  "c6-0-1-14-2-code-validation": codeValidation142Schema,
  "c6-0-1-14-2-browser-read-only-acceptance": browserAudit142Schema,
  "c6-0-1-14-2-machine-subtitle-parity-quality": machineQuality142Schema,
  "c6-0-1-14-2-durable-first-gold-read-intent": firstGoldRead142Schema,
  "c6-0-1-14-2-post-freeze-evaluation-audit": evaluationAudit142Schema,
  "c6-0-1-14-2-route-decision": route142Schema,
  "c6-0-1-14-2-selection-detector-ceiling-evaluation": evaluation142Schema,
  "c6-0-1-14-2-validation": runValidation142Schema,
  "c6-0-1-14-2-shareable-acceptance-summary": shareable142Schema,
  "c6-0-1-14-2-shareable-audit": shareableAudit142Schema,
  "c6-0-1-14-2-machine-artifact-preflight": artifactPreflight142Schema,
};
export type Projections142 = z.infer<typeof projections142Schema>;
export type Projection142 = z.infer<typeof projection142Schema>;
export type Stage142 = z.infer<typeof stage142Schema>;
export type MachineFreeze142 = z.infer<typeof machineFreeze142Schema>;
export type Evaluation142 = z.infer<typeof evaluation142Schema>;
export type Route142 = z.infer<typeof route142Schema>;
