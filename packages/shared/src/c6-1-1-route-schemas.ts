import { z } from "zod";
import { c61MetricsSchema } from "./c6-1-evaluation-schemas.js";
import { c611PolicyFreezeSchema } from "./c6-1-1-io-schemas.js";
import {
  c611CalibrationProfileIdSchema,
  c611CalibrationVersion,
  c611SelectiveMetricsSchema,
  c611SelectiveModelSchema,
  c611ThresholdCandidateSchema,
} from "./c6-1-1-calibration-schemas.js";

const id = z.string().min(1),
  sha = z.string().regex(/^[a-f0-9]{64}$/u),
  count = z.number().int().nonnegative(),
  finite = z.number();
const header = {
  schemaVersion: z.literal("1.0.0"),
  policyVersion: z.literal(c611CalibrationVersion),
  semanticHash: sha,
};
const check = z
  .object({
    code: id,
    passed: z.boolean(),
    observed: z.string(),
    expected: z.string(),
  })
  .strict();
export const c611FoldJointGainSchema = z
  .object({
    foldId: id,
    selectedCount: count,
    evaluableSelectedCount: count,
    normalizedGain: finite.nullable(),
  })
  .strict();
export const c611RouteProfileEvidenceSchema = z
  .object({
    profileId: c611CalibrationProfileIdSchema,
    oof: c611SelectiveMetricsSchema,
    changedGroupCount: count,
    mappedChangedGroupCount: count,
    jointNormalizedGain: finite,
    jointExactGain: finite,
    quality: c61MetricsSchema,
    foldJointGains: z.array(c611FoldJointGainSchema),
  })
  .strict();
export const c611RouteEngineeringSchema = z
  .object({
    baselineReplayPassed: z.boolean(),
    fixedMappingValid: z.boolean(),
    featureFreezeValid: z.boolean(),
    foldFreezeValid: z.boolean(),
    goldBarrierValid: z.boolean(),
    oofIsolationValid: z.boolean(),
    candidateProvenanceValid: z.boolean(),
    aBDeterministic: z.boolean(),
    productionFilesUnchanged: z.boolean(),
    productionTextMutation: count,
    productionTimingMutation: count,
    unsupportedTokenCount: count,
    unsupportedAdjacencyCount: count,
    missingProvenanceCount: count,
    novelApplicationCount: count,
    sourceReadOnly: z.boolean(),
    goldReadOnly: z.boolean(),
  })
  .strict();
export const c611RouteInputSchema = z
  .object({
    policy: c611PolicyFreezeSchema,
    baselineMetrics: c61MetricsSchema,
    baselineHash: sha,
    expectedFoldIds: z.array(id).min(1),
    profiles: z.array(c611RouteProfileEvidenceSchema).length(8),
    engineering: c611RouteEngineeringSchema,
  })
  .strict();
export const c611SelectiveRouteOutcomeSchema = z.enum([
  "SELECTIVE_EXISTING_CANDIDATE_MBR_SUPPORTED",
  "SELECTIVE_MBR_PROMISING_BUT_NOT_PROVEN",
  "EVALUATION_COVERAGE_INSUFFICIENT",
  "SELECTIVE_MBR_NOT_SUPPORTED",
  "SELECTIVE_MBR_ENGINEERING_INVALID",
]);
export const c611RouteDecisionSchema = z
  .object({
    ...header,
    artifactType: z.literal("c6-1-1-route-decision"),
    policyHash: sha,
    baselineHash: sha,
    evidenceHash: sha,
    outcome: c611SelectiveRouteOutcomeSchema,
    nextRoute: z.enum([
      "GO_C6_1_2_FROZEN_PROSPECTIVE_SHADOW",
      "MORE_INDEPENDENT_EPISODE_CALIBRATION_OR_PROSPECTIVE_OBSERVE_ONLY",
      "STOP_AUTOMATIC_CONSENSUS_DECODER_EXPANSION",
      "REPAIR_FIXED_EVALUATION_COVERAGE",
      "REPAIR_ENGINEERING_BEFORE_QUALITY_CLAIMS",
    ]),
    engineeringPassed: z.boolean(),
    engineeringChecks: z.array(check),
    profiles: z
      .array(
        z
          .object({
            profileId: c611CalibrationProfileIdSchema,
            activeCandidate: z.boolean(),
            minimumEvaluableSelected: count,
            fixedChangedGroupCoverage: z.number().min(0).max(1).nullable(),
            jointNormalizedGain: finite,
            jointExactGain: finite,
            negativeActiveFoldCount: count,
            unknownActiveFoldCount: count,
            strongPassed: z.boolean(),
            promisingPassed: z.boolean(),
            strongChecks: z.array(check),
            promisingChecks: z.array(check),
          })
          .strict(),
      )
      .length(8),
    selectedProfile: c611CalibrationProfileIdSchema.nullable(),
    strongProfiles: z.array(c611CalibrationProfileIdSchema),
    promisingProfiles: z.array(c611CalibrationProfileIdSchema),
    futureModelTrainingAuthorized: z.boolean(),
    reasons: z.array(id),
    benchmarkStatus: z.literal(
      "KNOWN_DEVELOPMENT_BENCHMARK_CALIBRATION_FEASIBILITY_NOT_UNSEEN_VALIDATION",
    ),
    metricAuthority: z.literal(
      "ACTUAL_JOINT_SHADOW_UNIQUE_FIXED_GROUP_GAIN_NOT_PROPOSAL_SUM",
    ),
    productionStatus: z.literal("needs-review"),
    finalizationMethod: z.literal("none"),
    machineOnlyReleaseAuthorized: z.literal(false),
    c602Status: z.literal("HOLD"),
  })
  .strict();
export const c611SelectiveMbrFreezeSchema = z
  .object({
    ...header,
    artifactType: z.literal("c6-1-1-selective-mbr-freeze"),
    status: z.enum(["AVAILABLE_FUTURE_ONLY", "UNAVAILABLE"]),
    frozenModelCreated: z.boolean(),
    reason: id,
    useRestriction: z.literal(
      "POST_EVALUATION_EXPLORATORY_FUTURE_PROSPECTIVE_SHADOW_ONLY",
    ),
    noOofMetricsRewritten: z.literal(true),
    inSampleQualityClaimAllowed: z.literal(false),
    routeHash: sha,
    policyHash: sha,
    calibrationPolicyHash: sha,
    fixedAlignmentPolicyHash: sha,
    machinePolicyHash: sha,
    machineFeatureFreezeHash: sha,
    featureTableHash: sha,
    proposalHash: sha,
    foldHash: sha,
    sourceOofHash: sha,
    profileId: c611CalibrationProfileIdSchema.nullable(),
    threshold: finite.nullable(),
    thresholdHash: sha.nullable(),
    modelHash: sha.nullable(),
    model: c611SelectiveModelSchema.nullable(),
    trainingDatasetHash: sha,
    calibrationSummary: z
      .object({
        thresholdCandidates: z.array(c611ThresholdCandidateSchema),
        chosenMinimumSelected: count,
        calibrationSampleCount: count,
        outerTestPredictionCount: z.literal(0),
        futureThresholdCalibrationPredictionCount: count,
        models: z.array(c611SelectiveModelSchema),
        splits: z.array(
          z
            .object({
              foldId: id,
              preservationCost: finite.nonnegative(),
              trainProposalIds: z.array(id),
              heldOutProposalIds: z.array(id),
              modelHash: sha,
              predictions: z.array(
                z.object({ proposalId: id, score: finite.nullable() }).strict(),
              ),
            })
            .strict(),
        ),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const complete =
      value.model !== null &&
      value.threshold !== null &&
      value.modelHash !== null &&
      value.thresholdHash !== null &&
      value.profileId !== null;
    if (
      value.frozenModelCreated !== complete ||
      (value.status === "AVAILABLE_FUTURE_ONLY") !== complete
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Future model availability must match all bound model/threshold fields",
      });
  });
export type C611RouteInput = z.infer<typeof c611RouteInputSchema>;
export type C611RouteProfileEvidence = z.infer<
  typeof c611RouteProfileEvidenceSchema
>;
export type C611RouteDecision = z.infer<typeof c611RouteDecisionSchema>;
export type C611SelectiveMbrFreeze = z.infer<
  typeof c611SelectiveMbrFreezeSchema
>;
