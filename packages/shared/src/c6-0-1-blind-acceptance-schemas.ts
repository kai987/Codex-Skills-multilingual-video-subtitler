import { z } from "zod";

import { schemaVersionSchema } from "./schemas.js";

export const c601HashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const gitCommitSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const nonEmptyStringSchema = z.string().min(1);
const nonNegativeIntegerSchema = z.number().int().nonnegative();
const nonNegativeNumberSchema = z.number().nonnegative();
const ratioSchema = z.number().min(0).max(1);
const localPathSchema = z.string().min(1);
const relativePathSchema = z
  .string()
  .min(1)
  .regex(/^(?!\/)(?![A-Za-z]:[\\/])(?!\\\\).+/u, "Path must be relative.");

export const c601BenchmarkStatusSchema = z.literal(
  "development-known-runtime-blind",
);

export const c601ShadowOutcomeSchema = z.enum([
  "FINAL_CANDIDATE",
  "REVIEW_REQUIRED",
  "REJECTED",
]);

const sourceVideoIdentitySchema = z
  .object({
    fileName: nonEmptyStringSchema,
    size: nonNegativeIntegerSchema,
    sha256: c601HashSchema,
  })
  .strict();

const genericModelSnapshotSchema = z
  .object({
    modelName: nonEmptyStringSchema,
    fileName: nonEmptyStringSchema,
    snapshotSha256: c601HashSchema,
    size: nonNegativeIntegerSchema,
    genericResource: z.literal(true),
  })
  .strict();

const runtimeIdentitySchema = z
  .object({
    runtimeId: nonEmptyStringSchema,
    name: nonEmptyStringSchema,
    version: nonEmptyStringSchema,
    executableFileName: nonEmptyStringSchema,
    device: nonEmptyStringSchema,
    genericResource: z.literal(true),
  })
  .strict();

const humanArtifactUseSchema = z
  .object({
    artifactClass: z.enum([
      "human-subtitle",
      "human-canonical",
      "human-timing",
      "human-memory",
      "human-alignment",
      "human-ctc",
      "human-correction-feedback",
      "human-authority",
      "human-protected-final",
    ]),
    used: z.literal(false),
    inputCount: z.literal(0),
  })
  .strict();

export const blindGenerationInputManifestSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("blind-generation-input-manifest"),
    manifestVersion: z.literal("c6.0.1-blind-generation-input-v1"),
    generatedAt: z.iso.datetime(),
    generationRunId: nonEmptyStringSchema,
    benchmarkStatus: c601BenchmarkStatusSchema,
    sourceVideo: sourceVideoIdentitySchema,
    repositoryCommit: gitCommitSchema,
    allowedGenericResources: z.array(nonEmptyStringSchema),
    genericModelSnapshots: z.array(genericModelSnapshotSchema).min(1),
    runtimeIdentities: z.array(runtimeIdentitySchema).min(1),
    machineMemoryInitialState: z
      .object({
        storeId: nonEmptyStringSchema,
        entryCount: z.literal(0),
        storeHash: c601HashSchema,
        humanDerived: z.literal(false),
      })
      .strict(),
    importedMediaCaches: z.array(
      z
        .object({
          path: localPathSchema,
          artifactType: nonEmptyStringSchema,
          provenance: nonEmptyStringSchema,
        })
        .strict(),
    ),
    humanArtifacts: z.array(humanArtifactUseSchema).length(9),
    generationArguments: z.array(nonEmptyStringSchema).min(1),
    environmentSummary: z
      .object({
        networkPolicy: z.literal("off"),
        networkUsed: z.literal(false),
        onlineSubtitleSearchUsed: z.literal(false),
        cloudProviderConfigured: z.literal(false),
        guidanceMode: z.literal("reference-free"),
        mediaCacheMode: z.literal("fresh-isolated"),
        machineMemoryMode: z.literal("fresh-empty"),
      })
      .strict(),
    inputSemanticHash: c601HashSchema,
  })
  .strict();

const provenanceNodeSchema = z
  .object({
    nodeId: nonEmptyStringSchema,
    artifactType: nonEmptyStringSchema,
    origin: z.enum(["machine", "generic-resource"]),
    authorityType: z.enum(["none", "machine", "generic"]),
    relativePath: relativePathSchema.nullable(),
    artifactHash: c601HashSchema,
    parentNodeIds: z.array(nonEmptyStringSchema),
    humanDerived: z.literal(false),
    mediaSpecific: z.boolean(),
  })
  .strict();

export const blindProvenanceAuditSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("blind-provenance-audit"),
    auditVersion: z.literal("c6.0.1-blind-provenance-v1"),
    generatedAt: z.iso.datetime(),
    generationRunId: nonEmptyStringSchema,
    inputManifestHash: c601HashSchema,
    nodes: z.array(provenanceNodeSchema).min(1),
    lineageRoots: z.array(nonEmptyStringSchema).min(1),
    knownHumanIdentityMatches: z.array(nonEmptyStringSchema),
    summary: z
      .object({
        nodeCount: nonNegativeIntegerSchema,
        machineNodeCount: nonNegativeIntegerSchema,
        genericNodeCount: nonNegativeIntegerSchema,
        humanDerivedNodeCount: z.literal(0),
        unknownProvenanceNodeCount: z.literal(0),
      })
      .strict(),
    isolationViolations: z.array(nonEmptyStringSchema),
    passed: z.boolean(),
    semanticHash: c601HashSchema,
  })
  .strict();

const evidenceDimensionSchema = z
  .object({
    dimensionId: nonEmptyStringSchema,
    requiredForFinalCandidate: z.boolean(),
    status: z.enum(["passed", "failed", "unknown", "not-applicable"]),
    evidenceRefs: z.array(relativePathSchema),
    reasonCodes: z.array(nonEmptyStringSchema),
  })
  .strict();

const modelExecutionCountsSchema = z
  .object({
    whisper: nonNegativeIntegerSchema,
    mfa: nonNegativeIntegerSchema,
    ctc: nonNegativeIntegerSchema,
    speaker: nonNegativeIntegerSchema,
    separation: nonNegativeIntegerSchema,
    sudachi: nonNegativeIntegerSchema,
    openai: z.literal(0),
    onlineSubtitleSearch: z.literal(0),
    modelLoadCount: nonNegativeIntegerSchema,
    modelInferenceCount: nonNegativeIntegerSchema,
  })
  .strict();

export const machineBaselineEvidenceCoverageSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("machine-baseline-evidence-coverage"),
    coverageVersion: z.literal("c6.0.1-machine-evidence-coverage-v1"),
    generatedAt: z.iso.datetime(),
    generationRunId: nonEmptyStringSchema,
    inputManifestHash: c601HashSchema,
    machinePackageHash: c601HashSchema,
    dimensions: z.array(evidenceDimensionSchema).min(1),
    modelRuntimeIdentities: z.array(runtimeIdentitySchema),
    modelExecutionCounts: modelExecutionCountsSchema,
    summary: z
      .object({
        requiredDimensionCount: nonNegativeIntegerSchema,
        passedRequiredDimensionCount: nonNegativeIntegerSchema,
        failedRequiredDimensionCount: nonNegativeIntegerSchema,
        unknownRequiredDimensionCount: nonNegativeIntegerSchema,
        criticalEvidenceCoveragePassed: z.boolean(),
        unresolvedHighRiskRegionCount: nonNegativeIntegerSchema,
        unknownSignalCount: nonNegativeIntegerSchema,
      })
      .strict(),
    semanticHash: c601HashSchema,
  })
  .strict();

export const machineShadowFinalizationPolicySchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("machine-shadow-finalization-policy"),
    policyVersion: z.literal("c6.0.1-machine-shadow-finalization-v1"),
    machineOnlyReleaseAuthorized: z.literal(false),
    positiveEvidenceRequired: z.literal(true),
    unknownSignalsFailClosed: z.literal(true),
    productionStatusUnaffected: z.literal(true),
    requiredChecks: z.array(nonEmptyStringSchema).min(1),
    rejectionChecks: z.array(nonEmptyStringSchema).min(1),
    rationale: nonEmptyStringSchema,
    policyHash: c601HashSchema,
  })
  .strict();

export const machineShadowFinalizationSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("machine-shadow-finalization"),
    policyVersion: z.literal("c6.0.1-machine-shadow-finalization-v1"),
    generatedAt: z.iso.datetime(),
    generationRunId: nonEmptyStringSchema,
    policyHash: c601HashSchema,
    evidenceCoverageHash: c601HashSchema,
    provenanceAuditHash: c601HashSchema,
    checks: z
      .object({
        sourceIntegrityPassed: z.boolean(),
        canonicalIntegrityPassed: z.boolean(),
        serializationPassed: z.boolean(),
        formatSemanticParityPassed: z.boolean(),
        unknownSignalCountZero: z.boolean(),
        positiveCurrentOutputDefectEvidenceCountZero: z.boolean(),
        criticalEvidenceCoveragePassed: z.boolean(),
        noUnresolvedHighRiskMachineRegion: z.boolean(),
        noGoldDerivedProvenance: z.boolean(),
        blindIsolationPassed: z.boolean(),
      })
      .strict(),
    positiveCurrentOutputDefectEvidenceCount: nonNegativeIntegerSchema,
    shadowMachineOutcome: c601ShadowOutcomeSchema,
    productionStatus: z.literal("needs-review"),
    productionFinalizationMethod: z.literal("none"),
    machineOnlyReleaseAuthorized: z.literal(false),
    blindAcceptanceRequired: z.literal(true),
    reasonCodes: z.array(nonEmptyStringSchema),
    semanticHash: c601HashSchema,
  })
  .strict();

const frozenFileSchema = z
  .object({
    relativePath: relativePathSchema,
    size: nonNegativeIntegerSchema,
    sha256: c601HashSchema,
  })
  .strict();

export const blindOutputFreezeSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("blind-output-freeze"),
    freezeVersion: z.literal("c6.0.1-machine-output-freeze-v1"),
    generationRunId: nonEmptyStringSchema,
    generationCommit: gitCommitSchema,
    sourceVideoSha256: c601HashSchema,
    machinePackageHash: c601HashSchema,
    canonicalTextHash: c601HashSchema,
    canonicalTimingHash: c601HashSchema,
    presentationHash: c601HashSchema,
    assHash: c601HashSchema,
    srtHash: c601HashSchema,
    vttHash: c601HashSchema,
    riskAssessmentHash: c601HashSchema,
    machineEvidenceCoverageHash: c601HashSchema,
    shadowPolicyHash: c601HashSchema,
    shadowOutcome: c601ShadowOutcomeSchema,
    seriesMemoryHash: c601HashSchema,
    provenanceHash: c601HashSchema,
    frozenFiles: z.array(frozenFileSchema).min(1),
    frozenArtifactAggregateHash: c601HashSchema,
    freezeTimestamp: z.iso.datetime(),
    freezeSemanticHash: c601HashSchema,
  })
  .strict();

export const zeroTouchBlindGenerationProofSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("zero-touch-blind-generation-proof"),
    proofVersion: z.literal("c6.0.1-zero-touch-blind-generation-proof-v1"),
    phase: z.enum(["pre-gold", "post-gold"]),
    benchmarkStatus: c601BenchmarkStatusSchema,
    generationRunId: nonEmptyStringSchema,
    sourceVideoIdentity: sourceVideoIdentitySchema,
    repositoryCommit: gitCommitSchema,
    generationStartedAt: z.iso.datetime(),
    generationCompletedAt: z.iso.datetime(),
    goldBarrierReachedAt: z.iso.datetime(),
    machineOutputFrozenAt: z.iso.datetime(),
    goldFirstReadAt: z.iso.datetime().nullable(),
    humanSubtitleAvailableDuringGeneration: z.boolean(),
    humanSubtitleReadDuringGeneration: z.literal(false),
    humanDerivedCanonicalLoaded: z.literal(false),
    humanDerivedTimingLoaded: z.literal(false),
    humanDerivedMemoryLoaded: z.literal(false),
    humanDerivedAlignmentLoaded: z.literal(false),
    humanDerivedCtcLoaded: z.literal(false),
    humanCorrectionFeedbackLoaded: z.literal(false),
    humanAuthorityLoaded: z.literal(false),
    humanProtectedFinalLoaded: z.literal(false),
    priorMediaSpecificCacheImported: z.literal(false),
    onlineSubtitleSearchUsed: z.literal(false),
    networkUsed: z.literal(false),
    machineMemoryStartedEmpty: z.literal(true),
    machineMemoryInitialEntryCount: z.literal(0),
    sameCueMemoryLeakCount: z.literal(0),
    futureCueMemoryLeakCount: z.literal(0),
    goldLoadedAfterOutputFrozen: z.boolean(),
    outputHashBeforeGold: c601HashSchema,
    outputHashAfterGold: c601HashSchema.nullable(),
    outputHashUnchangedAfterGold: z.boolean(),
    isolationViolations: z.array(nonEmptyStringSchema),
    proofPassed: z.boolean(),
    semanticHash: c601HashSchema,
  })
  .strict();

export const dualBlindFreezeBarrierSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("dual-blind-freeze-barrier"),
    barrierVersion: z.literal("c6.0.1-dual-freeze-barrier-v1"),
    acceptanceId: nonEmptyStringSchema,
    createdAt: z.iso.datetime(),
    runAPath: localPathSchema,
    runBPath: localPathSchema,
    runAFreezeHash: c601HashSchema,
    runBFreezeHash: c601HashSchema,
    runAInputHash: c601HashSchema,
    runBInputHash: c601HashSchema,
    runtimeIdentityParity: z.boolean(),
    configurationParity: z.boolean(),
    distinctOutputDirectories: z.boolean(),
    distinctMediaCaches: z.boolean(),
    distinctMachineMemoryStores: z.boolean(),
    bothFrozenBeforeGold: z.boolean(),
    goldReadAuthorized: z.boolean(),
    semanticHash: c601HashSchema,
  })
  .strict();

const evaluationThresholdsSchema = z
  .object({
    maximumAlignmentGroupSize: z.literal(3),
    minimumMatchTextSimilarity: ratioSchema,
    minimumMatchTemporalIoU: ratioSchema,
    maximumMatchCenterDistanceSeconds: nonNegativeNumberSchema,
    materialMinimumCharacters: nonNegativeIntegerSchema,
    materialTextErrorCer: ratioSchema,
    severeTimingBoundarySeconds: nonNegativeNumberSchema,
    minorTimingBoundarySeconds: nonNegativeNumberSchema,
    maximumCrossRunCer: ratioSchema,
    maximumCrossRunBoundaryP95Seconds: nonNegativeNumberSchema,
    maximumCrossRunBoundaryMaxSeconds: nonNegativeNumberSchema,
  })
  .strict();

export const blindEvaluationPolicySchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("blind-evaluation-policy"),
    policyVersion: z.literal("c6.0.1-gold-isolated-evaluation-v1"),
    frozenAt: z.iso.datetime(),
    normalization: z
      .object({
        unicode: z.literal("NFKC"),
        whitespaceInsensitive: z.literal(true),
        punctuationInsensitive: z.literal(true),
        dialectStandardization: z.literal(false),
        arbitraryKanaConversion: z.literal(false),
      })
      .strict(),
    alignmentWeights: z
      .object({
        textSimilarity: ratioSchema,
        temporalIoU: ratioSchema,
        centerDistance: ratioSchema,
      })
      .strict(),
    thresholds: evaluationThresholdsSchema,
    defectRules: z.array(
      z
        .object({
          code: nonEmptyStringSchema,
          severity: z.enum(["P0", "P1", "P2"]),
          rationale: nonEmptyStringSchema,
        })
        .strict(),
    ),
    policyHash: c601HashSchema,
  })
  .strict();

const editMetricsSchema = z
  .object({
    machineCharacterCount: nonNegativeIntegerSchema,
    goldCharacterCount: nonNegativeIntegerSchema,
    editDistance: nonNegativeIntegerSchema,
    insertionCharacters: nonNegativeIntegerSchema,
    deletionCharacters: nonNegativeIntegerSchema,
    substitutionCharacters: nonNegativeIntegerSchema,
    cer: nonNegativeNumberSchema,
  })
  .strict();

const alignedGroupSchema = z
  .object({
    alignmentId: nonEmptyStringSchema,
    machineCueIndexes: z.array(nonNegativeIntegerSchema).max(3),
    goldCueIndexes: z.array(nonNegativeIntegerSchema).max(3),
    machineTextHash: c601HashSchema.nullable(),
    goldTextHash: c601HashSchema.nullable(),
    machineExcerpt: z.string().max(96),
    goldExcerpt: z.string().max(96),
    machineStart: nonNegativeNumberSchema.nullable(),
    machineEnd: nonNegativeNumberSchema.nullable(),
    goldStart: nonNegativeNumberSchema.nullable(),
    goldEnd: nonNegativeNumberSchema.nullable(),
    textSimilarity: ratioSchema,
    temporalIoU: ratioSchema,
    centerDistanceSeconds: nonNegativeNumberSchema.nullable(),
    startDeltaSeconds: z.number().nullable(),
    endDeltaSeconds: z.number().nullable(),
    centerDeltaSeconds: z.number().nullable(),
    classification: z.enum(["matched", "unmatched-machine", "unmatched-gold"]),
  })
  .strict();

const defectSchema = z
  .object({
    defectId: nonEmptyStringSchema,
    code: nonEmptyStringSchema,
    severity: z.enum(["P0", "P1", "P2"]),
    alignmentIds: z.array(nonEmptyStringSchema),
    rationale: nonEmptyStringSchema,
  })
  .strict();

const timingMetricsSchema = z
  .object({
    reliableAlignedGroupCount: nonNegativeIntegerSchema,
    startMaeSeconds: nonNegativeNumberSchema,
    endMaeSeconds: nonNegativeNumberSchema,
    centerMaeSeconds: nonNegativeNumberSchema,
    boundaryMedianSeconds: nonNegativeNumberSchema,
    boundaryP90Seconds: nonNegativeNumberSchema,
    boundaryP95Seconds: nonNegativeNumberSchema,
    boundaryMaxSeconds: nonNegativeNumberSchema,
    timingIoUMedian: ratioSchema,
    within100msRatio: ratioSchema,
    within250msRatio: ratioSchema,
    within500msRatio: ratioSchema,
    within1000msRatio: ratioSchema,
  })
  .strict();

export const machineVsGoldEvaluationSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("machine-vs-gold-evaluation"),
    evaluationVersion: z.literal("c6.0.1-machine-vs-gold-v1"),
    generatedAt: z.iso.datetime(),
    benchmarkStatus: c601BenchmarkStatusSchema,
    generationRunId: nonEmptyStringSchema,
    sourceIdentity: sourceVideoIdentitySchema,
    machineFreezeHash: c601HashSchema,
    goldIdentity: z
      .object({
        fileName: nonEmptyStringSchema,
        size: nonNegativeIntegerSchema,
        sha256: c601HashSchema,
        cueCount: nonNegativeIntegerSchema,
        timestampNormalizationCount: nonNegativeIntegerSchema,
        firstReadAt: z.iso.datetime(),
        readOnlyVerified: z.boolean(),
      })
      .strict(),
    evaluationPolicyVersion: z.literal("c6.0.1-gold-isolated-evaluation-v1"),
    evaluationPolicyHash: c601HashSchema,
    globalTextMetrics: z
      .object({
        exact: editMetricsSchema,
        normalized: editMetricsSchema,
      })
      .strict(),
    alignments: z.array(alignedGroupSchema),
    alignmentMetrics: z
      .object({
        machineCueCount: nonNegativeIntegerSchema,
        goldCueCount: nonNegativeIntegerSchema,
        alignedGroupCount: nonNegativeIntegerSchema,
        matchedGroupCount: nonNegativeIntegerSchema,
        unmatchedGoldGroupCount: nonNegativeIntegerSchema,
        unmatchedMachineGroupCount: nonNegativeIntegerSchema,
      })
      .strict(),
    timingMetrics: timingMetricsSchema,
    coverageMetrics: z
      .object({
        goldGroupCount: nonNegativeIntegerSchema,
        machineGroupCount: nonNegativeIntegerSchema,
        matchedGoldGroupCount: nonNegativeIntegerSchema,
        unmatchedGoldGroupCount: nonNegativeIntegerSchema,
        matchedMachineGroupCount: nonNegativeIntegerSchema,
        unmatchedMachineGroupCount: nonNegativeIntegerSchema,
        goldTextCoverageRatio: ratioSchema,
        machineSupportedTextRatio: ratioSchema,
        goldTemporalCoverageRatio: ratioSchema,
      })
      .strict(),
    missingDialogueCandidates: z.array(defectSchema),
    hallucinationCandidates: z.array(defectSchema),
    materialTextErrors: z.array(defectSchema),
    severeTimingErrors: z.array(defectSchema),
    overlapComparisons: z.array(
      z
        .object({
          comparisonId: nonEmptyStringSchema,
          machineOverlapCount: nonNegativeIntegerSchema,
          goldOverlapCount: nonNegativeIntegerSchema,
          preservedSimultaneousContent: z.boolean(),
        })
        .strict(),
    ),
    properNounMismatches: z.array(nonEmptyStringSchema),
    dialectMismatches: z.array(nonEmptyStringSchema),
    p0Defects: z.array(defectSchema),
    p1Defects: z.array(defectSchema),
    p2Defects: z.array(defectSchema),
    modelInferenceCount: z.literal(0),
    outputHashBeforeGold: c601HashSchema,
    outputHashAfterGold: c601HashSchema,
    outputHashUnchangedAfterGold: z.boolean(),
    goldMutationCount: z.literal(0),
    evaluationWallTimeMs: nonNegativeIntegerSchema,
    semanticHash: c601HashSchema,
  })
  .strict();

const validationRunSchema = z
  .object({
    label: z.enum(["A", "B"]),
    runPath: localPathSchema,
    generationRunId: nonEmptyStringSchema,
    machineCueCount: nonNegativeIntegerSchema,
    canonicalTextHash: c601HashSchema,
    canonicalTimingHash: c601HashSchema,
    presentationHash: c601HashSchema,
    freezeHash: c601HashSchema,
    shadowOutcome: c601ShadowOutcomeSchema,
    evaluationSemanticHash: c601HashSchema,
    p0Count: nonNegativeIntegerSchema,
    p1Count: nonNegativeIntegerSchema,
    p2Count: nonNegativeIntegerSchema,
  })
  .strict();

export const c601BlindAcceptanceDecisionSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("c6-0-1-blind-acceptance-decision"),
    decisionVersion: z.literal("c6.0.1-blind-acceptance-decision-v1"),
    generatedAt: z.iso.datetime(),
    benchmarkStatus: c601BenchmarkStatusSchema,
    goldIsolationPassed: z.boolean(),
    machineGenerationPassed: z.boolean(),
    outputFreezePassed: z.boolean(),
    goldEvaluationPassed: z.boolean(),
    reproducibilityPassed: z.boolean(),
    shadowPolicyEvaluated: z.boolean(),
    unsafeFinalizationEscapeTaskCount: nonNegativeIntegerSchema,
    unsafeFinalizationEscapeDefectCount: nonNegativeIntegerSchema,
    unnecessaryReviewTaskCount: nonNegativeIntegerSchema,
    machinePolicySafetyPassed: z.boolean(),
    runtimeBlindAcceptancePassed: z.boolean(),
    unseenGeneralizationPassed: z.literal(false),
    c6_0_2Required: z.literal(true),
    machineOnlyReleaseAuthorized: z.literal(false),
    finalRecommendation: z.enum(["GO_C6_0_2", "NO_GO_C6_0_2"]),
    reasonCodes: z.array(nonEmptyStringSchema),
    semanticHash: c601HashSchema,
  })
  .strict();

export const c601BlindAcceptanceValidationSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("c6-0-1-blind-acceptance-validation"),
    validationVersion: z.literal("c6.0.1-blind-acceptance-validation-v1"),
    generatedAt: z.iso.datetime(),
    benchmarkStatus: c601BenchmarkStatusSchema,
    repositoryCommit: gitCommitSchema,
    barrierHash: c601HashSchema,
    runs: z.array(validationRunSchema).length(2),
    canonicalTextParity: z.boolean(),
    cueCountParity: z.boolean(),
    canonicalTimingParity: z.boolean(),
    presentationParity: z.boolean(),
    machineMemoryParity: z.boolean(),
    riskDecisionParity: z.boolean(),
    shadowOutcomeParity: z.boolean(),
    crossRunCer: nonNegativeNumberSchema,
    differingCueRegionCount: nonNegativeIntegerSchema,
    boundaryMedianSeconds: nonNegativeNumberSchema,
    boundaryP95Seconds: nonNegativeNumberSchema,
    boundaryMaxSeconds: nonNegativeNumberSchema,
    evaluatorDeterminismPassed: z.boolean(),
    bothRunsFrozenBeforeGold: z.boolean(),
    goldIsolationPassed: z.boolean(),
    sourceVideoReadOnlyVerified: z.boolean(),
    goldReadOnlyVerified: z.boolean(),
    shareableAuditPassed: z.boolean(),
    c60RegressionPassed: z.boolean(),
    skill2Compatibility: z.enum(["passed", "expected-gated", "failed"]),
    skill3Compatibility: z.enum(["passed", "expected-gated", "failed"]),
    decision: c601BlindAcceptanceDecisionSchema,
    passed: z.boolean(),
    semanticHash: c601HashSchema,
  })
  .strict();

export type BlindGenerationInputManifest = z.infer<
  typeof blindGenerationInputManifestSchema
>;
export type BlindProvenanceAudit = z.infer<typeof blindProvenanceAuditSchema>;
export type MachineBaselineEvidenceCoverage = z.infer<
  typeof machineBaselineEvidenceCoverageSchema
>;
export type MachineShadowFinalizationPolicy = z.infer<
  typeof machineShadowFinalizationPolicySchema
>;
export type MachineShadowFinalization = z.infer<
  typeof machineShadowFinalizationSchema
>;
export type BlindOutputFreeze = z.infer<typeof blindOutputFreezeSchema>;
export type ZeroTouchBlindGenerationProof = z.infer<
  typeof zeroTouchBlindGenerationProofSchema
>;
export type DualBlindFreezeBarrier = z.infer<
  typeof dualBlindFreezeBarrierSchema
>;
export type BlindEvaluationPolicy = z.infer<typeof blindEvaluationPolicySchema>;
export type MachineVsGoldEvaluation = z.infer<
  typeof machineVsGoldEvaluationSchema
>;
export type C601BlindAcceptanceDecision = z.infer<
  typeof c601BlindAcceptanceDecisionSchema
>;
export type C601BlindAcceptanceValidation = z.infer<
  typeof c601BlindAcceptanceValidationSchema
>;
