import { z } from "zod";
import { c60114SourceIdentitySchema } from "./c6-0-1-14-evidence-schemas.js";
import { c60114LineageStatusSchema } from "./c6-0-1-14-completion-schemas.js";

const id = z.string().min(1);
const ids = z.array(id);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const seconds = z.number().nonnegative();
const count = z.number().int().nonnegative();
const ratio = z.number().min(0).max(1);
export const c60114EvaluationIntervalSchema = z
  .object({ start: seconds, end: seconds })
  .strict()
  .refine(
    (value) => value.end > value.start,
    "Interval must have positive duration",
  );
const interval = c60114EvaluationIntervalSchema;
const identity = c60114SourceIdentitySchema;
export const c60114ErrorLabelSchema = z.enum([
  "MATERIAL_TEXT_ERROR",
  "SEVERE_TIMING_ERROR",
  "MISSING_DIALOGUE",
  "HALLUCINATION",
]);
export const c60114ErrorComponentSchema = z
  .object({
    errorComponentId: id,
    sourceIdentity: identity,
    labels: z.array(c60114ErrorLabelSchema).min(1),
    defectIds: ids,
    alignmentIds: ids,
    coveredItemIds: ids,
    coveredRegionIds: ids,
    errorIntervals: z.array(interval),
    mappingStatus: z.enum(["RESOLVED", "GOLD_MAPPING_UNRESOLVED"]),
    mappingReasons: z.array(z.string()),
  })
  .strict();

/** Strict projections deliberately exclude text, scores and any Gold matching policy. */
export const c60114CoverageItemSchema = z
  .object({
    reviewItemId: id,
    sourceIdentity: identity,
  })
  .strict();
export const c60114CoverageTargetSchema = z
  .object({
    reviewTargetId: id,
    parentReviewItemId: id.nullable(),
    sourceInterval: interval,
    mandatoryForAudio: z.boolean(),
    audioRequired: z.boolean().optional(),
    sourceIdentity: identity,
  })
  .strict();
export const c60114CoverageRegionSchema = z
  .object({
    regionId: id,
    reviewTargetIds: ids,
    reviewItemIds: ids,
    sourceIntervals: z.array(interval),
    contextIntervals: z.array(interval),
    sourceIdentity: identity,
  })
  .strict();
export const c60114CoveragePhysicalAudioSchema = z
  .object({
    audioId: id,
    relativePath: id.refine(
      (value) =>
        !value.startsWith("/") &&
        !/^[A-Za-z]:[\\/]/u.test(value) &&
        !value.split(/[\\/]/u).includes("..") &&
        !value.includes("\0"),
      "Unsafe relative artifact path",
    ),
    sourceMediaSha256: hash,
    sourceInterval: interval,
    requestedInterval: interval,
    actualSourceInterval: interval.optional(),
    requestedSourceInterval: interval.optional(),
    sampleRate: z.number().int().positive(),
    channels: z.number().int().positive(),
    bitDepth: z.number().int().positive(),
    codec: id,
    frameCount: z.number().int().positive(),
    actualDuration: z.number().positive(),
    sha256: hash,
    playable: z.boolean(),
    hashVerified: z.boolean(),
    physicalMetadataVerified: z.boolean(),
    coveredReviewTargetIds: ids,
    regionIds: ids,
    sourceIdentity: identity,
    semanticHash: hash,
  })
  .strict();
export const c60114CoveragePlaybackSegmentSchema = z
  .object({
    playbackSegmentId: id,
    audioId: id,
    sourceInterval: interval,
    audioLocalInterval: interval,
    reviewTargetIds: ids,
    reviewItemIds: ids,
    regionIds: ids,
    sourceIdentity: identity,
    semanticHash: hash,
  })
  .strict();
export const c60114CoveragePlanSchema = z
  .object({
    planId: id,
    budgetSeconds: seconds.nullable(),
    regionIds: ids,
    reviewTargetIds: ids,
    playbackSegmentIds: ids,
  })
  .strict();
export const c60114CoverageSpeechIslandSchema = z
  .object({
    islandId: id,
    sourceInterval: interval,
    speechPositive: z.boolean(),
    localizationStatus: z.enum(["VERIFIED", "UNRESOLVED"]),
    sourceIdentity: identity,
  })
  .strict();
export const c60114CoverageLexicalEvidenceSchema = z
  .object({
    evidenceId: id,
    sourceInterval: interval.nullable(),
    reliableLocalizedLexical: z.boolean(),
    mappingStatus: z.enum(["VERIFIED", "QUARANTINED"]),
    providerFamily: id,
    rootLineageIds: ids,
    correlationGroup: id,
    sourceIdentity: identity,
  })
  .strict();
export const c60114CoverageOrphanSchema = z
  .object({
    orphanId: id,
    sourceInterval: interval,
    speechPositive: z.boolean(),
    localizationStatus: z.enum(["VERIFIED", "UNRESOLVED"]),
    sourceIdentity: identity,
  })
  .strict();
export const c60114EngineeringGatesSchema = z
  .object({
    engineeringPassed: z.boolean(),
    baselineParityPassed: z.boolean(),
    runtimeGoldInputCount: count,
    canonicalMutationCount: count,
    machineDraftMutationCount: count,
    sourceMutationCount: count,
    goldMutationCount: count,
    machineFreezeVerified: z.boolean(),
  })
  .strict();
export const c60114PlaybackCoverageInputSchema = z
  .object({
    sourceIdentity: identity,
    generatedAt: z.iso.datetime(),
    errorComponents: z.array(c60114ErrorComponentSchema),
    items: z.array(c60114CoverageItemSchema),
    targets: z.array(c60114CoverageTargetSchema),
    regions: z.array(c60114CoverageRegionSchema),
    physicalAudio: z.array(c60114CoveragePhysicalAudioSchema),
    playbackSegments: z.array(c60114CoveragePlaybackSegmentSchema),
    plans: z.array(c60114CoveragePlanSchema),
    speechIslands: z.array(c60114CoverageSpeechIslandSchema),
    lexicalEvidence: z.array(c60114CoverageLexicalEvidenceSchema),
    orphans: z.array(c60114CoverageOrphanSchema),
    lineageEvidence: z
      .array(
        z
          .object({
            evidenceId: id,
            sourceIdentity: identity,
            claimedInterval: interval.nullable(),
            status: c60114LineageStatusSchema,
            speechPositive: z.boolean(),
          })
          .strict(),
      )
      .optional(),
    engineeringGates: c60114EngineeringGatesSchema,
  })
  .strict();

export const c60114CoverageLayerNames = [
  "itemLineage",
  "regionMembership",
  "targetInterval",
  "regionContext",
  "physicalAudio",
  "playbackSegments",
  "machineSpeech",
  "localizedLexical",
  "orphan",
  "audibleReviewCoverage",
] as const;
export const c60114CoverageLayerSchema = z
  .object({
    covered: z.boolean(),
    overlapSeconds: seconds,
    errorDurationSeconds: seconds,
    coverageRatio: ratio,
    coveringIds: ids,
    any: z.boolean(),
    majority: z.boolean(),
    audible: z.boolean(),
    full: z.boolean(),
    status: z.enum([
      "NOT_A_PLAYBACK_RECALL_METRIC",
      "NO_OVERLAP",
      "PARTIAL",
      "MAJORITY",
      "AUDIBLE",
      "FULL",
      "INTEGRITY_FAILED",
      "GOLD_MAPPING_UNRESOLVED",
    ]),
  })
  .strict();
const layers = z
  .object(
    Object.fromEntries(
      c60114CoverageLayerNames.map((name) => [name, c60114CoverageLayerSchema]),
    ) as Record<
      (typeof c60114CoverageLayerNames)[number],
      typeof c60114CoverageLayerSchema
    >,
  )
  .strict();
export const c60114MissingDiagnosisSchema = z.enum([
  "DIRECT_CROSS_SOURCE_LEXICAL",
  "DIRECT_SINGLE_SOURCE_LEXICAL",
  "SPEECH_ACTIVITY_ONLY",
  "REVIEW_AUDIO_WITHOUT_SPEECH",
  "SPEECH_DETECTION_MISS",
  "LOCALIZATION_MISS",
  "REVIEW_AUDIO_OMISSION",
  "GOLD_MAPPING_UNRESOLVED",
  "EVALUATION_INTEGRITY_FAILURE",
  "SOURCE_GLOBAL_LINEAGE_UNVERIFIED",
  "MACHINE_SPEECH_DETECTION_MISS",
  "MACHINE_REVIEW_LOCALIZATION_MISS",
  "MACHINE_REVIEW_AUDIO_OMISSION",
  "LOCALIZED_LEXICAL_EVIDENCE_INCOMPLETE",
  "FULLY_PLAYBACK_COVERED",
]);
export const c60114HallucinationDiagnosisSchema = z.enum([
  "TARGET_AND_AUDIO_COVERED",
  "LINEAGE_ONLY",
  "REGION_MEMBERSHIP_ONLY",
  "REVIEW_AUDIO_OMISSION",
  "DETECTOR_MISS",
  "GOLD_MAPPING_UNRESOLVED",
]);
export const c60114ComponentCoverageSchema = z
  .object({
    errorComponentId: id,
    labels: z.array(c60114ErrorLabelSchema),
    errorIntervals: z.array(interval),
    layers,
    independentLocalizedLexicalSourceCount: count,
    missingDiagnosis: c60114MissingDiagnosisSchema.nullable(),
    hallucinationDiagnosis: c60114HallucinationDiagnosisSchema.nullable(),
    diagnosisFlags: z.array(z.string()),
    findings: z.array(
      z.enum([
        "LINEAGE_ONLY_FALSE_COVERAGE",
        "REGION_MEMBERSHIP_WITHOUT_PLAYBACK_COVERAGE",
        "PLAYBACK_OMISSION",
        "TARGET_WITHOUT_AUDIO",
        "AUDIO_WITHOUT_BINDING",
        "PLAYBACK_OMITS_TARGET",
      ]),
    ),
  })
  .strict();
const recall = z
  .object({
    total: count,
    covered: count,
    recall: ratio,
    coveredErrorComponentIds: ids,
  })
  .strict();
const layeredRecall = z
  .object(
    Object.fromEntries(
      c60114CoverageLayerNames.map((name) => [name, recall]),
    ) as Record<(typeof c60114CoverageLayerNames)[number], typeof recall>,
  )
  .strict();
export const c60114BudgetCoverageSchema = z
  .object({
    planId: id,
    budgetSeconds: seconds.nullable(),
    selectedRegionIds: ids,
    selectedReviewTargetIds: ids,
    selectedPlaybackSegmentIds: ids,
    selectedAudioIds: ids,
    exactPlaybackSegments: z.array(c60114CoveragePlaybackSegmentSchema),
    playableSourceIntervals: z.array(interval),
    selectedPlaybackIntervals: z.array(interval),
    audibleIntersectionIntervals: z.array(interval),
    actualAudibleUniqueSeconds: seconds,
    missingRecall: layeredRecall,
    hallucinationRecall: layeredRecall,
    officialMissingRecall: recall,
    officialHallucinationRecall: recall,
    componentCoverage: z.array(c60114ComponentCoverageSchema),
    integrityFailures: z.array(z.string()),
  })
  .strict();
export const c60114EvaluationRouteSchema = z.enum([
  "GO_C6_0_1_15_REGION_RANKER_RECALIBRATION",
  "HOLD_FOR_ENGINEERING_REPAIR",
  "HOLD_FOR_EVALUATION_INTEGRITY_REPAIR",
  "HOLD_FOR_SOURCE_GLOBAL_LINEAGE_REPAIR",
  "HOLD_FOR_MACHINE_SPEECH_DETECTION_REPAIR",
  "HOLD_FOR_REVIEW_LOCALIZATION_REPAIR",
  "HOLD_FOR_REVIEW_AUDIO_COVERAGE_REPAIR",
  "HOLD_FOR_LOCALIZED_LEXICAL_EVIDENCE_REPAIR",
]);
export const c60114RootCauseSchema = z.enum([
  "EVALUATION_INTEGRITY_FAILURE",
  "SOURCE_GLOBAL_LINEAGE_UNVERIFIED",
  "MACHINE_SPEECH_DETECTION_MISS",
  "MACHINE_REVIEW_LOCALIZATION_MISS",
  "MACHINE_REVIEW_AUDIO_OMISSION",
  "LOCALIZED_LEXICAL_EVIDENCE_INCOMPLETE",
  "FULLY_PLAYBACK_COVERED",
]);
export const c60114RouteDecisionSchema = z
  .object({
    primaryDecision: c60114EvaluationRouteSchema,
    blockers: z.array(
      z
        .object({ diagnosis: id, errorComponentIds: ids, reasons: ids })
        .strict(),
    ),
    advisories: z.array(
      z
        .object({ diagnosis: id, errorComponentIds: ids, reasons: ids })
        .strict(),
    ),
    perComponentDiagnoses: z.array(
      z
        .object({
          errorComponentId: id,
          primaryDiagnosis: c60114RootCauseSchema,
          diagnoses: z.array(c60114RootCauseSchema),
          unverifiedLineageEvidenceIds: ids,
          reasons: ids,
        })
        .strict(),
    ),
    fullQueueGatePassed: z.boolean(),
    requiredTargetAudioGatePassed: z.boolean(),
    mandatorySubsetRecallIsBlocking: z.literal(false),
    lexicalIncompleteWhenAudibleIsBlocking: z.literal(false),
  })
  .strict();
export const c60114PlaybackCoverageEvaluationSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    policyVersion: z.literal("c6.0.1.14-playback-grounded-coverage-v1"),
    artifactType: z.literal("c6-0-1-14-playback-grounded-coverage-evaluation"),
    generatedAt: z.iso.datetime(),
    sourceIdentity: identity,
    thresholds: z
      .object({
        any: z.literal(0),
        anyComparison: z.literal("STRICTLY_GREATER_THAN"),
        majority: z.literal(0.5),
        audible: z.literal(0.8),
        full: z.literal(0.95),
      })
      .strict(),
    officialRecallMetric: z.literal(
      "PHYSICAL_PLAYABLE_AUDIO_INTERSECT_ACTUAL_PLAYBACK_AUDIBLE_0_8",
    ),
    lineageMetricStatus: z.literal("NOT_A_PLAYBACK_RECALL_METRIC"),
    errorIntervalPolicy: z.literal(
      "UNION_OF_ATOMIC_ALIGNMENT_INTERVALS_NEVER_OUTER_ENVELOPE",
    ),
    budgets: z.array(c60114BudgetCoverageSchema),
    integrityFailures: z.array(z.string()),
    route: c60114EvaluationRouteSchema,
    routeReasons: z.array(z.string()),
    routeDecision: c60114RouteDecisionSchema,
    engineeringGates: c60114EngineeringGatesSchema,
    rankerTrainingPerformed: z.literal(false),
    c602Status: z.literal("HOLD"),
    realHumanTrialExecuted: z.literal(false),
    productionStatus: z.literal("needs-review"),
    finalizationMethod: z.literal("none"),
    machineOnlyReleaseAuthorized: z.literal(false),
    semanticHash: hash,
  })
  .strict();

export type C60114EvaluationInterval = z.infer<typeof interval>;
export type C60114ErrorComponent = z.infer<typeof c60114ErrorComponentSchema>;
export type C60114PlaybackCoverageInput = z.infer<
  typeof c60114PlaybackCoverageInputSchema
>;
export type C60114CoverageLayer = z.infer<typeof c60114CoverageLayerSchema>;
export type C60114CoverageLayerName = (typeof c60114CoverageLayerNames)[number];
export type C60114ComponentCoverage = z.infer<
  typeof c60114ComponentCoverageSchema
>;
export type C60114BudgetCoverage = z.infer<typeof c60114BudgetCoverageSchema>;
export type C60114PlaybackCoverageEvaluation = z.infer<
  typeof c60114PlaybackCoverageEvaluationSchema
>;
export type C60114RouteDecision = z.infer<typeof c60114RouteDecisionSchema>;
const fileIdentity = z
  .object({
    sha256: hash,
    size: count,
    mtimeMs: z.number().nonnegative(),
    inode: count,
  })
  .strict();
export const c60114PostFreezeEvaluationAuditSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    artifactType: z.literal("c6-0-1-14-post-freeze-evaluation-audit"),
    visibility: z.literal("LOCAL_ONLY"),
    generatedAt: z.iso.datetime(),
    firstGoldReadAt: z.iso.datetime(),
    finalAFreezeHash: hash,
    finalBFreezeHash: hash,
    finalAFreezeCompletedAt: z.iso.datetime(),
    finalBFreezeCompletedAt: z.iso.datetime(),
    projectionSemanticHash: hash,
    projectionVariantCount: z.literal(9),
    machineFilesVerifiedBeforeGold: count,
    freezeBeforeGold: z.literal(true),
    machineABSemanticParity: z.literal(true),
    canonicalABByteParity: z.literal(true),
    sourceIdentityBefore: fileIdentity,
    sourceIdentityAfter: fileIdentity,
    goldIdentityBefore: fileIdentity,
    goldIdentityAfter: fileIdentity,
    upstreamGoldEvaluationHash: hash,
    upstreamQualityEvaluationHash: hash,
    upstreamRegionLabelsHash: hash,
    codeValidationByteHash: hash,
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

/** Freezeable machine-only projection; no evaluator labels, timestamps or gate overrides. */
export const c60114MachineCoverageProjectionSchema =
  c60114PlaybackCoverageInputSchema.omit({
    errorComponents: true,
    generatedAt: true,
    engineeringGates: true,
  });
export const c60114CoverageProjectionVariantSchema = z
  .object({
    stage: z.enum(["A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8"]),
    description: id,
    projection: c60114MachineCoverageProjectionSchema,
    diagnostics: z
      .object({
        comparisonRole: z.enum([
          "LEGACY_LINEAGE_DIAGNOSTIC_BASELINE",
          "DIRECT_PLAYBACK_GROUNDED_COMPARISON",
        ]),
        lineageRecallMeaning: z.literal("NOT_A_PLAYBACK_RECALL_METRIC"),
        physicalAudioOrigin: z.enum([
          "BASELINE_C60113_VERIFIED_WAV",
          "C60114_FINAL_VERIFIED_WAV",
        ]),
        parentGapCount: count,
        speechIslandCount: count,
        machineSpeechEvidenceIntervalCount: count,
        orphanCount: count,
        probeTargetCount: count,
        probeRequestCount: count,
        localizedLexicalCount: count,
        localizedLexicalRequestIds: ids,
        itemCount: count,
        targetCount: count,
        regionCount: count,
        audioCount: count,
        targetAudioCoverage: z
          .object({
            threshold: z.literal(0.8),
            totalTargets: count,
            coveredTargets: count,
            coverageRatio: ratio,
            uncoveredTargetIds: ids,
          })
          .strict(),
        audioBurden: z
          .object({
            clipSumSeconds: seconds,
            uniquePhysicalAudioSeconds: seconds,
            selectedFullQueueUniqueAudioSeconds: seconds,
          })
          .strict(),
        missingClassificationCounts: z.record(z.string(), count),
        unboundTargetIds: ids,
        baselinePlaybackIntervalsWithoutPhysicalAudio: z.array(interval),
        sourceArtifactHashes: z.record(z.string(), hash),
        runtimeGoldInputCount: z.literal(0),
        projectionInferenceCount: z.literal(0),
        canonicalTextMutationCount: z.literal(0),
        canonicalTimingMutationCount: z.literal(0),
        machineDraftMutationCount: z.literal(0),
        sourceMutationCount: z.literal(0),
        selectionRetunedFromGold: z.literal(false),
      })
      .strict(),
    semanticHash: hash,
  })
  .strict();
export const c60114CoverageProjectionsSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    artifactType: z.literal("c6-0-1-14-machine-coverage-projections"),
    policyVersion: z.literal("c6.0.1.14-playback-grounded-coverage-v1"),
    sourceIdentity: identity,
    variants: z.array(c60114CoverageProjectionVariantSchema).length(9),
    runtimeGoldInputCount: z.literal(0),
    semanticHash: hash,
  })
  .strict()
  .refine(
    (value) => value.variants.every((row, index) => row.stage === `A${index}`),
    "A0-A8 projections must occur exactly once in stage order",
  );
export type C60114MachineCoverageProjection = z.infer<
  typeof c60114MachineCoverageProjectionSchema
>;
export type C60114CoverageProjectionVariant = z.infer<
  typeof c60114CoverageProjectionVariantSchema
>;
export type C60114CoverageProjections = z.infer<
  typeof c60114CoverageProjectionsSchema
>;
