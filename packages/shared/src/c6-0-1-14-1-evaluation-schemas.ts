import { z } from "zod";
import { c601141HeaderShape } from "./c6-0-1-14-1-speech-inventory-schemas.js";
import {
  c60114MachineCoverageProjectionSchema,
  c60114PlaybackCoverageEvaluationSchema,
} from "./c6-0-1-14-evaluation-schemas.js";

const hash = z.string().regex(/^[a-f0-9]{64}$/u),
  id = z.string().min(1),
  count = z.number().int().nonnegative();
export const c601141AblationSchema = z.enum([
  "A0",
  "A1",
  "A2",
  "A3",
  "A4",
  "A5",
  "A6",
  "A7",
  "A8",
  "A9",
]);
export const c601141CoverageProjectionsSchema = z
  .object({
    ...c601141HeaderShape,
    artifactType: z.literal("c6-0-1-14-1-machine-coverage-projections"),
    variants: z
      .array(
        z
          .object({
            stage: c601141AblationSchema,
            description: id,
            projection: c60114MachineCoverageProjectionSchema,
            physicalAudioOrigin: z.enum([
              "VERIFIED_C60114_BASELINE",
              "VERIFIED_C601141_FINAL",
            ]),
            semanticHash: hash,
          })
          .strict(),
      )
      .length(10),
    ablationChangesMachineSelection: z.literal(false),
    newInferenceCount: z.literal(0),
    rankerRetrained: z.literal(false),
  })
  .strict()
  .refine(
    (v) => v.variants.every((row, i) => row.stage === `A${i}`),
    "A0-A9 must occur once in order",
  );
export const c601141RouteNameSchema = z.enum([
  "GO_C6_0_1_15_REGION_RANKER_RECALIBRATION",
  "HOLD_FOR_ENGINEERING_REPAIR",
  "HOLD_FOR_EVALUATION_INTEGRITY_REPAIR",
  "HOLD_FOR_LEGACY_PROVENANCE_RECOVERY",
  "HOLD_FOR_MACHINE_SPEECH_DETECTION_MODEL_CEILING",
  "HOLD_FOR_DIALOGUE_ENHANCEMENT_SOURCE_SEPARATION_INVESTIGATION",
  "HOLD_FOR_SAFETY_RESERVE_SELECTION_REPAIR",
  "HOLD_FOR_REVIEW_AUDIO_COVERAGE_REPAIR",
]);
export const c601141RouteDecisionSchema = z
  .object({
    primaryDecision: c601141RouteNameSchema,
    blockers: z.array(
      z
        .object({
          diagnosis: id,
          errorComponentIds: z.array(id),
          reasons: z.array(id),
        })
        .strict(),
    ),
    advisories: z.array(
      z
        .object({
          diagnosis: id,
          errorComponentIds: z.array(id),
          reasons: z.array(id),
        })
        .strict(),
    ),
    fullQueueGatePassed: z.boolean(),
    targetBudgetPassed: z.boolean(),
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
    semanticHash: hash,
  })
  .strict();
export const c601141EvaluationSchema = z
  .object({
    ...c601141HeaderShape,
    artifactType: z.literal("c6-0-1-14-1-speech-inventory-evaluation"),
    generatedAt: z.iso.datetime(),
    projectionHash: hash,
    variants: z
      .array(
        z
          .object({
            stage: c601141AblationSchema,
            evaluation: c60114PlaybackCoverageEvaluationSchema,
          })
          .strict(),
      )
      .length(10),
    officialPlanId: z.literal("FULL_QUEUE_WITH_SAFETY_RESERVE"),
    route: c601141RouteDecisionSchema,
    sourceContribution: z.array(
      z
        .object({
          errorComponentId: id,
          baselineSpeechCovered: z.boolean(),
          baselineAudible: z.boolean(),
          fingerprintEvidenceIds: z.array(id),
          sileroNativeEvidenceIds: z.array(id),
          sileroMultiViewEvidenceIds: z.array(id),
          pyannoteEvidenceIds: z.array(id),
          multiDetectorIslandIds: z.array(id),
          safetyTargetIds: z.array(id),
          finalSpeechCovered: z.boolean(),
          finalAudible: z.boolean(),
          retainedHistoricalAudioEvidenceIds: z.array(id),
          historicalAmbiguousEvidenceIds: z.array(id),
          directCoverage: z
            .object({
              existingSpeech: z.number().min(0).max(1),
              fingerprintRecovered: z.number().min(0).max(1),
              sileroNative: z.number().min(0).max(1),
              sileroAllViews: z.number().min(0).max(1),
              pyannote: z.number().min(0).max(1),
              multiDetector: z.number().min(0).max(1),
              combinedInventory: z.number().min(0).max(1),
              safetyTarget: z.number().min(0).max(1),
              physicalAudio: z.number().min(0).max(1),
              playback: z.number().min(0).max(1),
              localizedLexical: z.number().min(0).max(1),
            })
            .strict(),
          primaryDiagnosis: z.enum([
            "RECOVERED_BY_LEGACY_FINGERPRINT",
            "RECOVERED_BY_MULTI_DETECTOR_SPEECH",
            "RECOVERED_BY_MULTI_VIEW_SILERO",
            "RECOVERED_BY_PYANNOTE_ONLY",
            "RECOVERED_BY_SAFETY_RESERVE_TARGET",
            "RECOVERED_WITH_LOCALIZED_LEXICAL_EVIDENCE",
            "AUDIBLE_WITHOUT_LEXICAL_EVIDENCE",
            "LEGACY_AUDIO_UNAVAILABLE",
            "FINGERPRINT_AMBIGUOUS",
            "SPEECH_DETECTOR_MISS",
            "SAFETY_TARGET_SELECTION_MISS",
            "REVIEW_AUDIO_OMISSION",
            "GOLD_MAPPING_UNRESOLVED",
          ]),
          unresolvedHistoricalAttribution: z.literal(
            "UNKNOWN_WITHOUT_VERIFIED_SOURCE_MAPPING",
          ),
        })
        .strict(),
    ),
    burden: z
      .object({
        baselineFullQueueSeconds: z.number().nonnegative(),
        finalFullQueueSeconds: z.number().nonnegative(),
        incrementalFullQueueSeconds: z.number().nonnegative(),
        episodeRatio: z.number().min(0).max(1),
        newTargetCount: count,
        safetyTargetsNotOverlappingGoldMissing: count,
        safetyTargetSecondsNotOverlappingGoldMissing: z.number().nonnegative(),
        additionalRecoveredMissing: count,
        audioSecondsPerRecoveredMissing: z.number().nonnegative().nullable(),
        nonOverlapMeansConfirmedFalsePositive: z.literal(false),
      })
      .strict(),
    matchingRulesChanged: z.literal(false),
    evaluatorInferenceCount: z.literal(0),
    canonicalMutationCount: z.literal(0),
  })
  .strict();
const identity = z
  .object({ sha256: hash, size: count, mtimeMs: z.number(), inode: count })
  .strict();
export const c601141EvaluationAuditSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    artifactType: z.literal("c6-0-1-14-1-post-freeze-evaluation-audit"),
    visibility: z.literal("LOCAL_ONLY"),
    firstGoldReadAt: z.iso.datetime(),
    finalAFreezeHash: hash,
    finalBFreezeHash: hash,
    finalAFreezeCompletedAt: z.iso.datetime(),
    finalBFreezeCompletedAt: z.iso.datetime(),
    projectionSemanticHash: hash,
    codeValidationByteHash: hash,
    machineABSemanticParity: z.literal(true),
    canonicalABByteParity: z.literal(true),
    freezeBeforeGold: z.literal(true),
    sourceIdentityBefore: identity,
    sourceIdentityAfter: identity,
    goldIdentityBefore: identity,
    goldIdentityAfter: identity,
    upstreamGoldEvaluationHash: hash,
    upstreamQualityEvaluationHash: hash,
    upstreamRegionLabelsHash: hash,
    sourceReadOnly: z.literal(true),
    goldReadOnly: z.literal(true),
    runtimeGoldInputCount: z.literal(0),
    evaluatorGoldInputCount: z.literal(1),
    newInferenceCount: z.literal(0),
    modelLoadCount: z.literal(0),
    providerProcessStartCount: z.literal(0),
    matchingRulesChanged: z.literal(false),
    canonicalMutationCount: z.literal(0),
    rankerRetrained: z.literal(false),
    newOofRun: z.literal(false),
    semanticHash: hash,
  })
  .strict();
export const c601141CodeCheckIds = [
  "npm-ci",
  "schema-generation",
  "typecheck",
  "lint",
  "format-check",
  "build",
  "unit",
  "non-e2e-unit",
  "e2e",
  "c601141-targeted",
  "cross-version",
  "review-ui",
] as const;
export const c601141CodeValidationSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    artifactType: z.literal("c6-0-1-14-1-code-validation"),
    generatedAt: z.iso.datetime(),
    nodeVersion: id,
    packageManager: id,
    results: z
      .array(
        z
          .object({
            id: z.enum(c601141CodeCheckIds),
            command: z.array(id),
            exitCode: z.number().int(),
            passed: z.boolean(),
            elapsedSeconds: z.number().nonnegative(),
            logRelativePath: id,
            logSha256: hash,
            testSummary: z.array(z.string()),
          })
          .strict(),
      )
      .length(c601141CodeCheckIds.length),
    passed: z.boolean(),
    realAsrExecutedByValidation: z.literal(false),
    goldEvaluationExecutedByValidation: z.literal(false),
    rankerTrainingExecutedByValidation: z.literal(false),
  })
  .strict()
  .refine(
    (v) =>
      new Set(v.results.map((r) => r.id)).size === c601141CodeCheckIds.length &&
      v.passed === v.results.every((r) => r.passed && r.exitCode === 0),
    "Every required check must be represented once and agree with its exit status",
  );
export const c601141EvaluationSchemas = {
  "c6-0-1-14-1-machine-coverage-projections": c601141CoverageProjectionsSchema,
  "c6-0-1-14-1-speech-inventory-evaluation": c601141EvaluationSchema,
  "c6-0-1-14-1-post-freeze-evaluation-audit": c601141EvaluationAuditSchema,
  "c6-0-1-14-1-route-decision": c601141RouteDecisionSchema,
  "c6-0-1-14-1-code-validation": c601141CodeValidationSchema,
};
export type C601141CoverageProjections = z.infer<
  typeof c601141CoverageProjectionsSchema
>;
export type C601141Evaluation = z.infer<typeof c601141EvaluationSchema>;
export type C601141RouteDecision = z.infer<typeof c601141RouteDecisionSchema>;
