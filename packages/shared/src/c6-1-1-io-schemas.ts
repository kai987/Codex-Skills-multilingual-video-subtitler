import { z } from "zod";
import {
  c61FileIdentitySchema,
  c61MetricsSchema,
  c61ShadowManifestSchema,
} from "./c6-1-evaluation-schemas.js";
import {
  c611CalibrationSampleSchema,
  c611SelectiveMetricsSchema,
  c611CalibrationProfileIdSchema,
} from "./c6-1-1-calibration-schemas.js";
import {
  c611FixedAlignmentEvaluationSchema,
  c611SelectiveProfileQualitySchema,
} from "./c6-1-1-evaluation-schemas.js";

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const count = z.number().int().nonnegative();
export const c611IoHeader = {
  schemaVersion: z.literal("1.0.0"),
  policyVersion: z.literal("c6.1.1-fixed-alignment-selective-existing-mbr-v1"),
  semanticHash: hash,
};
export const c611FingerprintSchema = z
  .object({ size: count, mtimeMs: z.number().nonnegative(), sha256: hash })
  .strict();
const check = z
  .object({
    name: z.string(),
    passed: z.boolean(),
    observed: z.string(),
    expected: z.string(),
  })
  .strict();
export const c611BaselineSchema = z
  .object({
    ...c611IoHeader,
    artifactType: z.literal("c6-1-1-baseline"),
    acceptanceCommit: z.string().regex(/^[a-f0-9]{40}$/u),
    baselineBranch: z.string(),
    c61MachineFreezeHash: hash,
    sourceBefore: c611FingerprintSchema,
    productionFiles: z.array(c61FileIdentitySchema),
    canonicalTextHash: hash,
    canonicalTimingHash: hash,
    candidateUniverseHash: hash,
    inputHashes: z.record(z.string(), hash),
    officialArtifactHashes: z.record(z.string(), hash),
    candidateCounts: z.record(z.string(), count),
    baselineMetrics: c61MetricsSchema,
    legacyP6Metrics: c61MetricsSchema,
    legacyEventEvaluation: z
      .object({
        evaluable: count,
        changed: count,
        improved: count,
        regressed: count,
        neutral: count,
        unevaluable: count,
        renderedChangedCues: count,
      })
      .strict(),
    legacyOracle: z
      .object({
        currentError: count,
        bestExistingError: count,
        bestLegalError: count,
        unrestrictedError: count,
        candidateOracleGain: count,
      })
      .strict(),
    pairwiseCount: count,
    checks: z.array(check),
    baselineReplayPassed: z.boolean(),
    productionStatus: z.literal("needs-review"),
    finalizationMethod: z.literal("none"),
    machineOnlyReleaseAuthorized: z.literal(false),
    c602Status: z.literal("HOLD"),
    networkUsed: z.literal(false),
    newAsrInferenceCount: z.literal(0),
    goldFileOpened: z.literal(false),
  })
  .strict();
export type C611Baseline = z.infer<typeof c611BaselineSchema>;

export const c611PolicyFreezeSchema = z
  .object({
    ...c611IoHeader,
    artifactType: z.literal("c6-1-1-policy-freeze"),
    fixedAlignmentPolicyHash: hash,
    machinePolicyHash: hash,
    calibrationPolicyHash: hash,
    oraclePolicyHash: hash,
    existingCandidateOnly: z.literal(true),
    currentIsProviderVote: z.literal(false),
    proposalGoldInputCount: z.literal(0),
    featureGoldInputCount: z.literal(0),
    novelApplicationAllowed: z.literal(false),
    productionMutationAllowed: z.literal(false),
    profileRematchingAllowed: z.literal(false),
    testFoldThresholdTuningAllowed: z.literal(false),
    policyDefinitions: z.record(z.string(), z.string().min(1)),
    strongGate: z
      .object({
        minimumFixedCoverage: z.literal(0.8),
        minimumSelected: z.literal(5),
        minimumSelectedFraction: z.literal(0.05),
        maximumWrong: z.literal(0),
        maximumCatastrophicDeletion: z.literal(0),
        requirePositiveGain: z.literal(true),
        requireBaselineQualityNonRegression: z.literal(true),
        maximumNegativeActiveFolds: z.literal(0),
      })
      .strict(),
    promisingGate: z
      .object({
        minimumFixedCoverage: z.literal(0.8),
        minimumPrecision: z.literal(0.85),
        maximumHarm: z.literal(0.1),
        maximumMaterialErrorIncrease: z.literal(0),
      })
      .strict(),
    insufficientCoverageThreshold: z.literal(0.7),
    c602Status: z.literal("HOLD"),
  })
  .strict();
export type C611PolicyFreeze = z.infer<typeof c611PolicyFreezeSchema>;

export const c611MachineFeatureFreezeSchema = z
  .object({
    ...c611IoHeader,
    artifactType: z.literal("c6-1-1-machine-feature-freeze"),
    runtimeNodeVersion: z.string().regex(/^v?24\./u),
    sharedSourceEntry: z.literal("packages/shared/src/index.ts"),
    runtimeSourceExecutionVerified: z.literal(true),
    frozenAt: z.iso.datetime(),
    proposalHash: hash,
    featureSchemaHash: hash,
    featureTableHash: hash,
    candidateUniverseHash: hash,
    correlationPolicyHash: hash,
    riskPolicyHash: hash,
    foldHash: hash,
    policyHash: hash,
    baselineHash: hash,
    machineFiles: z.array(c61FileIdentitySchema),
    machineAggregateHash: hash,
    sourceCodeFiles: z.array(c61FileIdentitySchema),
    sourceCodeAggregateHash: hash,
    inputHashes: z.record(z.string(), hash),
    frozenBeforeGold: z.literal(true),
    aBMachineParity: z.literal(true),
    runtimeGoldInputCount: z.literal(0),
    newAsrInferenceCount: z.literal(0),
    networkUsed: z.literal(false),
  })
  .strict();
export type C611MachineFeatureFreeze = z.infer<
  typeof c611MachineFeatureFreezeSchema
>;

export const c611ReadOnlyProofSchema = z
  .object({
    ...c611IoHeader,
    artifactType: z.literal("c6-1-1-read-only-proof"),
    machineFreezeHash: hash,
    frozenAt: z.iso.datetime(),
    goldFirstReadAt: z.iso.datetime(),
    sourceBefore: c611FingerprintSchema,
    sourceAfter: c611FingerprintSchema,
    goldBefore: c611FingerprintSchema,
    goldAfter: c611FingerprintSchema,
    sourceUnchanged: z.boolean(),
    goldUnchanged: z.boolean(),
    productionUnchanged: z.boolean(),
    productionFiles: z.array(c61FileIdentitySchema),
    runtimeCodeUnchanged: z.boolean(),
    freshWhisperInferences: z.literal(0),
    freshReazonInferences: z.literal(0),
    freshCtcInferences: z.literal(0),
    networkUsed: z.literal(false),
  })
  .strict();

export const c611ValidationSchema = z
  .object({
    ...c611IoHeader,
    artifactType: z.literal("c6-1-1-validation"),
    checks: z.array(check),
    engineeringPassed: z.boolean(),
    schemaInstanceCount: count,
    generatedSchemaCount: count,
    aBMachineParity: z.boolean(),
    aBEvaluationParity: z.boolean(),
    aBOutputParity: z.boolean(),
    productionTextMutation: count,
    productionTimingMutation: count,
    regressionEvidenceHash: hash.nullable(),
    sourceReadOnly: z.boolean(),
    goldReadOnly: z.boolean(),
    validatorRawSourceRechecked: z.literal(false),
    validatorRawGoldRechecked: z.literal(false),
    qualityGateStatus: z.string().min(1),
    machineOnlyReleaseAuthorized: z.literal(false),
    c602Status: z.literal("HOLD"),
  })
  .strict();
export type C611Validation = z.infer<typeof c611ValidationSchema>;

export const c611LegacyControlSchema = z
  .object({
    ...c611IoHeader,
    artifactType: z.literal("c6-1-1-legacy-p6-control"),
    originalManifestHash: hash,
    originalSelectionsHash: hash,
    samples: z.array(c611CalibrationSampleSchema),
    selectedProposalIds: z.array(z.string().min(1)),
    originalCanonicalTextHash: hash,
    reproducedCanonicalTextHash: hash,
    canonicalTextParity: z.literal(true),
    canonicalTimingParity: z.literal(true),
    runtimeGoldInputCount: z.literal(0),
  })
  .strict();
export type C611LegacyControl = z.infer<typeof c611LegacyControlSchema>;

export const c611ShadowManifestSchema = z
  .object({
    ...c611IoHeader,
    artifactType: z.literal("c6-1-1-shadow-manifest"),
    profiles: c61ShadowManifestSchema.shape.profiles,
    outputRole: z.literal("RESEARCH_SHADOW_ONLY"),
    productionMutationCount: z.literal(0),
  })
  .strict();
export const c611SelectiveProfileResultsSchema = z
  .object({
    ...c611IoHeader,
    artifactType: z.literal("c6-1-1-selective-profile-results"),
    machineFreezeHash: hash,
    fixedMapHash: hash,
    oofHash: hash,
    metricAuthority: z.literal("ACTUAL_ASSEMBLED_SHADOW_UNIQUE_FIXED_GROUPS"),
    profiles: z
      .array(
        z
          .object({
            profileId: c611CalibrationProfileIdSchema,
            requestedMetrics: c611SelectiveMetricsSchema,
            appliedMetrics: c611SelectiveMetricsSchema,
            fixed: c611FixedAlignmentEvaluationSchema,
            quality: c611SelectiveProfileQualitySchema,
            requestedSelectionCount: count,
            appliedSelectionCount: count,
            blockedRequestedEventIds: z.array(z.string()),
            canonicalTextHash: hash,
            canonicalTimingHash: hash,
            foldJointGains: z.array(
              z
                .object({
                  foldId: z.string(),
                  selectedCount: count,
                  evaluableSelectedCount: count,
                  normalizedGain: z.number().nullable(),
                })
                .strict(),
            ),
          })
          .strict(),
      )
      .length(8),
  })
  .strict();
export type C611SelectiveProfileResults = z.infer<
  typeof c611SelectiveProfileResultsSchema
>;

export const c611ShareableSummarySchema = z
  .object({
    ...c611IoHeader,
    artifactType: z.literal("c6-1-1-shareable-summary"),
    privacy: z.literal("SANITIZED_AGGREGATES_ONLY"),
    machineFreezeHash: hash,
    profileResultsHash: hash,
    routeHash: hash,
    readOnlyProofHash: hash,
    baseline: c61MetricsSchema,
    profiles: z
      .array(
        z
          .object({
            profileId: c611CalibrationProfileIdSchema,
            selected: count,
            evaluableSelected: count,
            correct: count,
            wrong: count,
            neutral: count,
            unknown: count,
            precision: z.number().nullable(),
            harm: z.number().nullable(),
            fixedCoverage: z.number().nullable(),
            jointNormalizedGain: z.number(),
            metrics: c61MetricsSchema,
            canonicalTextHash: hash,
            canonicalTimingHash: hash,
          })
          .strict(),
      )
      .length(8),
    route: z.string().min(1),
    frozenModelCreated: z.boolean(),
    sourceReadOnly: z.boolean(),
    goldReadOnly: z.boolean(),
    productionUnchanged: z.boolean(),
    rawTextIncluded: z.literal(false),
    audioIncluded: z.literal(false),
    absolutePathsIncluded: z.literal(false),
    freshAsrInferences: z.literal(0),
    freshCtcInferences: z.literal(0),
    networkUsed: z.literal(false),
    productionStatus: z.literal("needs-review"),
    finalizationMethod: z.literal("none"),
    machineOnlyReleaseAuthorized: z.literal(false),
    c602Status: z.literal("HOLD"),
  })
  .strict();
