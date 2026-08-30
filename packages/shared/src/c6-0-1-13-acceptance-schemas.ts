import { z } from "zod";
import {
  c60113CountSchema as count,
  c60113RatioSchema as ratio,
  c60113Sha256Schema as hash,
} from "./c6-0-1-13-review-rank-schemas.js";

const status = z.enum(["PASSED", "FAILED", "NOT_RUN"]);
const header = {
  schemaVersion: z.literal("1.0.0"),
  policyVersion: z.literal("c6.0.1.13-region-burden-calibration-v1"),
  generatedAt: z.iso.datetime(),
};
const fileIdentity = z
  .object({
    sha256: hash,
    size: count,
    mtimeMs: z.number().nonnegative(),
    inode: count,
  })
  .strict();
const canonicalIdentities = z
  .object({
    machineDraftHash: hash,
    cueCount: count,
    canonicalTextHash: hash,
    canonicalTimingHash: hash,
    presentationHash: hash,
  })
  .strict();
const scoreDiagnostics = z
  .object({
    maximumScore: z.number(),
    maximumScoreCount: count,
    largestTieGroup: count,
    uniqueScoreCount: count,
    entropyBits: z.number().nonnegative(),
    distribution: z.array(z.object({ score: z.number(), count }).strict()),
  })
  .strict();
export const c60113BaselineReplaySchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    artifactType: z.literal("c6-0-1-13-baseline-replay"),
    sourceIdentity: fileIdentity,
    sourceDurationSeconds: z.number().positive().nullable(),
    machineDraftHash: hash,
    canonicalIdentities,
    upstreamFreezeHash: hash,
    replayParity: z
      .object({
        items: z.boolean(),
        priority: z.boolean(),
        regions: z.boolean(),
        candidates: z.boolean(),
      })
      .strict(),
    itemCount: count,
    regionCount: count,
    requiredItemCount: count,
    requiredRegionCount: count,
    criticalItemCount: count,
    legacyMissingRiskCount: count,
    scoreDiagnostics,
    totalClipSeconds: z.number().nonnegative(),
    totalUniqueAudioSeconds: z.number().nonnegative(),
    duplicateAudioSeconds: z.number().nonnegative(),
    requiredUniqueAudioSeconds: z.number().nonnegative(),
    requiredUniqueAudioRatio: ratio.nullable(),
    runtimeGoldInputCount: z.literal(0),
    asrInferenceCount: z.literal(0),
    networkUsed: z.literal(false),
    productionStatus: z.literal("needs-review"),
    finalizationMethod: z.literal("none"),
    machineOnlyReleaseAuthorized: z.literal(false),
    semanticHash: hash,
  })
  .strict();

export const c60113ProspectiveTrialReadinessSchema = z
  .object({
    ...header,
    artifactType: z.literal("c6-0-1-13-prospective-trial-readiness"),
    rankerFreezeHash: hash,
    machineFreezeHash: hash,
    workspaceHash: hash,
    episodeEligibility: z.literal("NOT_ELIGIBLE_PRIOR_GOLD_EXPOSURE"),
    episodeOneEligibleForBlindHumanTrial: z.literal(false),
    realHumanSessionExecuted: z.literal(false),
    humanReviewTimeMeasured: z.literal(false),
    realHumanTrialNotExecutedIsExpected: z.literal(true),
    readiness: z.enum([
      "PROSPECTIVE_HUMAN_TRIAL_READY_NOT_EXECUTED",
      "PROSPECTIVE_HUMAN_TRIAL_NOT_READY_RANKER",
      "PROSPECTIVE_HUMAN_TRIAL_NOT_READY_WORKFLOW",
      "PROSPECTIVE_HUMAN_TRIAL_NOT_READY_INSTRUMENTATION",
    ]),
    route: z.enum([
      "GO_TO_NEW_EPISODE_PROSPECTIVE_HUMAN_TRIAL",
      "GO_TO_NEW_EPISODE_TRIAL_WITH_RANKING_CAVEAT",
      "HOLD_FOR_REVIEW_RANKER_REDESIGN",
      "HOLD_FOR_MISSING_EVIDENCE_REPAIR",
      "HOLD_FOR_WORKSPACE_V2_REPAIR",
    ]),
    commands: z.array(z.string()),
    eventTypes: z.array(z.string()),
    instrumentationTestStatus: status,
    syntheticTrialOnly: z.literal(true),
    activeTimePolicy: z.string(),
    idleTimeoutSeconds: z.number().positive(),
    protocolVersion: z.literal("REAL_HUMAN_TRIAL_PROTOCOL_V2"),
    reasons: z.array(z.string()),
    semanticHash: hash,
  })
  .strict();

const audioAccountingFields = {
  clipSumSeconds: z.number().nonnegative(),
  actualClipSumSeconds: z.number().nonnegative(),
  clipSumMeaning: z.literal("ACTUAL_EXTRACTED_WAV_DURATION_SUM"),
  plannedContextSumSeconds: z.number().nonnegative(),
  extractedClipUnionSeconds: z.number().nonnegative(),
  uniqueUnionSeconds: z.number().nonnegative(),
  uniqueUnionMeaning: z.literal("PLANNED_REVIEW_PLAYBACK_UNION"),
  duplicateContextSeconds: z.number().nonnegative(),
  duplicateContextMeaning: z.literal("PLANNED_CONTEXT_SUM_MINUS_PLANNED_UNION"),
};

const burden = z
  .object({
    itemCount: count,
    regionCount: count,
    requiredItemCount: count,
    requiredRegionCount: count,
    ...audioAccountingFields,
    requiredUniqueSeconds: z.number().nonnegative(),
    requiredUniqueRatio: ratio,
    scoreDiagnostics,
  })
  .strict();
export const c60113ReviewBurdenValidationSchema = z
  .object({
    ...header,
    artifactType: z.literal("c6-0-1-13-review-burden-validation"),
    before: burden,
    after: burden,
    requiredAudioReductionSeconds: z.number(),
    requiredAudioReductionRatio: z.number(),
    missingClassificationCounts: z.record(
      z.enum([
        "SPEECH_GAP_OBSERVED",
        "MISSING_DIALOGUE_POSSIBLE",
        "MISSING_DIALOGUE_STRONG",
        "MISSING_DIALOGUE_CONTRADICTED",
        "MISSING_DIALOGUE_UNRESOLVED",
      ]),
      count,
    ),
    independentFamilyMean: z.number().nonnegative(),
    deduplicatedEvidenceCount: count,
    absenceRiskBoostCount: z.literal(0),
    machineTextMutationCount: z.literal(0),
    machineTimingMutationCount: z.literal(0),
    finalABArtifactParity: z.array(
      z
        .object({
          artifact: z.string(),
          aHash: hash,
          bHash: hash,
          equal: z.boolean(),
        })
        .strict(),
    ),
    finalSubtitleByteParity: z.array(
      z
        .object({
          filename: z.string(),
          sourceHash: hash,
          aHash: hash,
          bHash: hash,
          equal: z.boolean(),
        })
        .strict(),
    ),
    canonicalIdentities,
    sourceReadOnly: z.boolean(),
    sourceIdentityBefore: fileIdentity,
    sourceIdentityAfter: fileIdentity,
    goldReadOnly: z.boolean(),
    goldIdentityBefore: fileIdentity,
    goldIdentityAfter: fileIdentity,
    productionStatus: z.literal("needs-review"),
    finalizationMethod: z.literal("none"),
    machineOnlyReleaseAuthorized: z.literal(false),
    c602Status: z.literal("HOLD"),
    semanticHash: hash,
  })
  .strict();

export const c60113ValidationSchema = z
  .object({
    ...header,
    artifactType: z.literal("c6-0-1-13-validation"),
    policyHash: hash,
    machineFreezeHash: hash,
    rankerFreezeHash: hash,
    checks: z.array(
      z.object({ checkId: z.string(), status, evidence: z.string() }).strict(),
    ),
    regressionGroups: z.array(
      z
        .object({
          groupId: z.string(),
          status,
          command: z.string(),
          exitCode: z.number().int().nullable(),
          outputHash: hash.nullable(),
        })
        .strict(),
    ),
    summary: z
      .object({
        passedChecks: count,
        failedChecks: count,
        notRunChecks: count,
        passedRegressionGroups: count,
        failedRegressionGroups: count,
        notRunRegressionGroups: count,
      })
      .strict(),
    engineeringAcceptance: z.enum(["PASSED", "FAILED", "INCOMPLETE"]),
    rankingResult: z.string(),
    burdenResult: z.string(),
    trialReadiness: z.string(),
    route: z.string(),
    runtimeGoldInputCount: z.literal(0),
    asrInferenceCount: z.literal(0),
    networkUsedForAcceptance: z.literal(false),
    datasetSpecificHardcodingCount: count.nullable(),
    machineOnlyReleaseAuthorized: z.literal(false),
    c602Status: z.literal("HOLD"),
    semanticHash: hash,
  })
  .strict();

export const c60113AblationFreezeSchema = z
  .object({
    ...header,
    artifactType: z.literal("c6-0-1-13-ablation-machine-freeze"),
    stages: z.array(
      z
        .object({
          stage: z.enum(["A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7"]),
          description: z.string(),
          artifactHashes: z.record(z.string(), hash),
          featuresHash: hash,
          foldsHash: hash,
          itemCount: count,
          regionCount: count,
          requiredItemCount: count,
          requiredRegionCount: count,
          scoreDiagnostics,
          uniqueAudioSeconds: z.number().nonnegative(),
          requiredUniqueAudioSeconds: z.number().nonnegative(),
          stageMeaning: z.enum([
            "MACHINE_VARIANT",
            "OOF_EVALUATION_OVER_FROZEN_MACHINE_FEATURES",
            "FUTURE_RANKER_WORKSPACE_OVER_FROZEN_MACHINE_FEATURES",
          ]),
        })
        .strict(),
    ),
    frozenBeforeLabels: z.literal(true),
    runtimeGoldInputCount: z.literal(0),
    semanticHash: hash,
  })
  .strict();

export const c60113UiAcceptanceResultsSchema = z
  .object({
    checks: z.array(
      z.object({ checkId: z.string(), status, evidence: z.string() }).strict(),
    ),
    instrumentationTestStatus: status,
    datasetSpecificHardcodingCount: count.nullable().optional(),
  })
  .strict();

export const c60113ShareableSummarySchema = z
  .object({
    ...header,
    artifactType: z.literal("c6-0-1-13-shareable-review-burden-summary"),
    audience: z.literal("AGGREGATE_AUDIT_ONLY"),
    itemCount: count,
    regionCount: count,
    requiredItemCount: count,
    requiredRegionCount: count,
    ...audioAccountingFields,
    requiredUniqueSeconds: z.number().nonnegative(),
    requiredUniqueRatio: ratio,
    maxScoreShare: ratio,
    maximumTieCount: count,
    absenceRiskBoostCount: z.literal(0),
    canonicalTextMutationCount: z.literal(0),
    canonicalTimingMutationCount: z.literal(0),
    rankingResult: z.enum([
      "REGION_RANKER_STRONG_PASS",
      "REGION_RANKER_PROMISING",
      "REGION_RANKER_WEAK",
      "REGION_RANKER_UNSUPPORTED",
    ]),
    burdenResult: z.enum([
      "REVIEW_BURDEN_STRONG_REDUCTION",
      "REVIEW_BURDEN_PROMISING_REDUCTION",
      "REVIEW_BURDEN_NO_MEANINGFUL_REDUCTION",
      "REVIEW_BURDEN_REDUCTION_UNSAFE",
    ]),
    route: z.enum([
      "GO_TO_NEW_EPISODE_PROSPECTIVE_HUMAN_TRIAL",
      "GO_TO_NEW_EPISODE_TRIAL_WITH_RANKING_CAVEAT",
      "HOLD_FOR_REVIEW_RANKER_REDESIGN",
      "HOLD_FOR_MISSING_EVIDENCE_REPAIR",
      "HOLD_FOR_WORKSPACE_V2_REPAIR",
    ]),
    humanReviewTimeMeasured: z.literal(false),
    realHumanSessionExecuted: z.literal(false),
    sourceAudioIncluded: z.literal(false),
    dialogueIncluded: z.literal(false),
    privateEventsIncluded: z.literal(false),
    approvedHashes: z
      .object({
        policy: hash,
        machineFreeze: hash,
        rankerFreeze: hash,
        items: hash,
        regions: hash,
        playback: hash,
        plans: hash,
      })
      .strict(),
    semanticHash: hash,
  })
  .strict();

export const c60113ShareableAuditSchema = z
  .object({
    ...header,
    artifactType: z.literal("c6-0-1-13-shareable-audit"),
    status: z.enum(["PASSED", "FAILED"]),
    files: z.array(
      z
        .object({
          relativePath: z.literal("review-burden-summary.json"),
          sha256: hash,
        })
        .strict(),
    ),
    absolutePathLeakCount: count,
    secretCount: count,
    goldIdentityLeakCount: count,
    brokenRelativeReferenceCount: count,
    fullDialoguePayloadCount: z.literal(0),
    privateEventPayloadCount: z.literal(0),
    semanticHash: hash,
  })
  .strict();
