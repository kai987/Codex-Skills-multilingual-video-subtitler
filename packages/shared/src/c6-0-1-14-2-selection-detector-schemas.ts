import { z } from "zod";
import { c60114SourceIdentitySchema } from "./c6-0-1-14-evidence-schemas.js";
import {
  c601141SampleIntervalSchema,
  c601141IntervalSchema,
  c601141ObservationSchema,
  c601141IslandSchema,
} from "./c6-0-1-14-1-speech-inventory-schemas.js";

export const hash142Schema = z.string().regex(/^[a-f0-9]{64}$/u);
export const id142Schema = z.string().min(1);
export const count142Schema = z.number().int().nonnegative();
export const ratio142Schema = z.number().min(0).max(1);
const h = hash142Schema,
  id = id142Schema,
  n = count142Schema;
const samples = c601141SampleIntervalSchema,
  interval = c601141IntervalSchema;
export const version142Schema = z.literal(
  "c6.0.1.14.2-safety-selection-detector-ceiling-v1",
);
export const header142Shape = {
  schemaVersion: z.literal("1.0.0"),
  policyVersion: version142Schema,
  policyHash: h,
  sourceIdentity: c60114SourceIdentitySchema,
  sourceTimebase: z.literal("SOURCE_GLOBAL_NATIVE_SAMPLES"),
  runtimeGoldInputCount: z.literal(0),
  visibility: z.literal("LOCAL_ONLY"),
  semanticHash: h,
};
export const policy142Schema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    policyVersion: version142Schema,
    cluster: z
      .object({
        maximumGapSeconds: z.literal(0.3),
        maximumEnvelopeSeconds: z.literal(12),
        minimumCoreSeconds: z.literal(0.12),
        silenceBridgingAllowed: z.literal(false),
        cueCrossingAllowed: z.literal(false),
        targetCrossingAllowed: z.literal(false),
        sceneCrossingAllowed: z.literal(false),
        speakerCrossingAllowed: z.literal(false),
      })
      .strict(),
    selection: z
      .object({
        maximumTargets: z.literal(24),
        maximumCoreUnionSeconds: z.literal(60),
        reservedExclusiveSlots: z.literal(4),
        binSeconds: z.literal(60),
        localWindowSeconds: z.literal(15),
        maximumLocalTargets: z.literal(3),
        preserveOldCoverage: z.literal(true),
        sourceTimeTieBreakOnly: z.literal(true),
        weights: z
          .object({
            evidence: z.number(),
            newSeconds: z.number(),
            newFamily: z.number(),
            newStratum: z.number(),
            newBin: z.number(),
            newScene: z.number(),
            independent: z.number(),
            redundancy: z.number(),
            density: z.number(),
            slotCost: z.number(),
            unionCost: z.number(),
          })
          .strict(),
      })
      .strict(),
    detectors: z
      .object({
        maximumRuns: z.literal(8),
        maximumWebrtc: z.literal(4),
        maximumSilero: z.literal(2),
        maximumPyannote: z.literal(2),
        retryCount: z.literal(0),
        backfillAllowed: z.literal(false),
        sileroMainThreshold: z.literal(0.2),
        sileroAuditThreshold: z.literal(0.1),
        pyannoteMainThreshold: z.literal(0.5),
        pyannoteAuditThreshold: z.literal(0.25),
        subthresholdMinimumSeconds: z.literal(0.12),
        webrtc: z
          .object({
            sampleRate: z.literal(16000),
            channels: z.literal(1),
            bitDepth: z.literal(16),
            frameMs: z.literal(20),
            aggressiveness: z.literal(0),
            mergeGapMs: z.literal(160),
            minimumSpeechMs: z.literal(100),
            paddingMs: z.literal(40),
            maximumIntervalSeconds: z.literal(12),
          })
          .strict(),
      })
      .strict(),
    masked: z
      .object({
        minimumVoiceBandRatio: z.number().min(0).max(1),
        minimumModulationRatio: z.number().min(0).max(1),
        maximumFlatness: z.number().min(0).max(1),
        minimumRms: z.number().nonnegative(),
        energyAloneAllowed: z.literal(false),
        sameFamilyVotesIndependent: z.literal(false),
      })
      .strict(),
    asr: z
      .object({
        maximumTargets: z.literal(4),
        maximumContextTargets: z.literal(2),
        maximumRequests: z.literal(12),
        contextSeconds: z.literal(0.75),
        prompt: z.literal(""),
        vadEnabled: z.literal(false),
        retryCount: z.literal(0),
        backfillAllowed: z.literal(false),
        fullMediaAllowed: z.literal(false),
      })
      .strict(),
    coverage: z
      .object({
        majority: z.literal(0.5),
        audible: z.literal(0.8),
        full: z.literal(0.95),
        maximumEpisodeBurden: z.literal(0.95),
      })
      .strict(),
    goldBlind: z.literal(true),
    rankerRetrained: z.literal(false),
    canonicalMutationAllowed: z.literal(false),
    semanticHash: h,
  })
  .strict();
export const family142Schema = z.enum([
  "SILERO",
  "PYANNOTE",
  "WEBRTC",
  "LEGACY_FINGERPRINT",
  "EXISTING_VERIFIED",
  "LOCALIZED_LEXICAL",
]);
export const stratum142Schema = z.enum([
  "MULTI_DETECTOR",
  "PYANNOTE_EXCLUSIVE",
  "SILERO_EXCLUSIVE",
  "WEBRTC_EXCLUSIVE",
  "LEGACY_FINGERPRINT_EXCLUSIVE",
  "MULTI_VIEW_SAME_DETECTOR",
  "EXISTING_VERIFIED",
  "MASKED_SUBTHRESHOLD",
  "AUDIT_ONLY",
]);
export const observation142Schema = c601141ObservationSchema
  .extend({
    family: family142Schema,
    scoreLevel: z.enum(["MAIN", "AUDIT_SUBTHRESHOLD", "LEGACY"]),
    independentSpeechTruth: z.boolean(),
    scoreTrackHash: h.nullable(),
  })
  .strict();
export const island142Schema = c601141IslandSchema
  .extend({
    evidenceClass: z.enum([
      ...c601141IslandSchema.shape.evidenceClass.options,
      "WEBRTC_EXCLUSIVE_SPEECH_CANDIDATE",
      "MASKED_SPEECH_SAFETY_CANDIDATE",
      "CROSS_DETECTOR_SUBTHRESHOLD_CANDIDATE",
      "SUBTHRESHOLD_MULTI_VIEW_CANDIDATE",
    ]),
    detectorFamilies: z.array(family142Schema),
    evidenceStratum: stratum142Schema,
    maskedEvidenceIds: z.array(id),
    speechTruthVerified: z.boolean(),
  })
  .strict();
export const candidate142Schema = island142Schema
  .extend({
    candidateId: id,
    parentIslandId: id,
    uncoveredRatio: ratio142Schema,
    partialCueOverlap: z.boolean(),
    partialExistingTargetOverlap: z.boolean(),
    diversityBin: n,
    priority: z.number(),
    sceneIds: z.array(id),
  })
  .strict();
export const uncovered142Schema = z
  .object({
    ...header142Shape,
    artifactType: z.literal("machine-uncovered-speech-candidates-v2"),
    inventoryHash: h,
    finalCueHash: h,
    previousTargetsHash: h,
    subtractedActiveSafetyHash: h.nullable(),
    candidates: z.array(candidate142Schema),
    summary: z
      .object({ candidateCount: n, uncoveredSeconds: z.number().nonnegative() })
      .strict(),
  })
  .strict();
export const cluster142Schema = z
  .object({
    clusterId: id,
    memberCandidateIds: z.array(id).min(1),
    parentIslandIds: z.array(id).min(1),
    atomicNativeIntervals: z.array(samples).min(1),
    atomicSourceIntervals: z.array(interval).min(1),
    targetCoreUnion: z.array(samples).min(1),
    reviewEnvelope: samples,
    observationIds: z.array(id),
    evidenceIds: z.array(id),
    requestIds: z.array(id),
    detectorFamilies: z.array(family142Schema),
    independentFamilies: z.array(id),
    independentFamilyCount: n,
    evidenceStrata: z.array(stratum142Schema),
    distinctPcmViewIds: z.array(id),
    diversityBins: z.array(n),
    sceneIds: z.array(id),
    uncoveredSpeechSeconds: z.number().positive(),
    internalSilenceSeconds: z.number().nonnegative(),
    crossesCueBoundary: z.literal(false),
    crossesExistingTarget: z.literal(false),
    crossesSceneBoundary: z.literal(false),
    crossesSpeakerBoundary: z.literal(false),
    verifiedTimebase: z.boolean(),
    strongContradiction: z.boolean(),
    eligible: z.boolean(),
    eligibilityReasons: z.array(id),
    evidenceStrength: z.number(),
    oldTargetIds: z.array(id),
    maskedEvidenceIds: z.array(id),
    semanticHash: h,
  })
  .strict();
export const clusters142Schema = z
  .object({
    ...header142Shape,
    artifactType: z.literal("machine-safety-target-clusters-v2"),
    uncoveredHash: h,
    oldSafetyHash: h,
    boundaryHash: h,
    speechUnionHash: h,
    clusters: z.array(cluster142Schema),
    summary: z
      .object({
        atomicCandidateCount: n,
        clusterCount: n,
        eligibleClusterCount: n,
        mergedCandidateCount: n,
        largestClusterMemberCount: n,
        speechCoreUnionSeconds: z.number().nonnegative(),
        envelopeAsSpeechCount: z.literal(0),
      })
      .strict(),
  })
  .strict();
export const selectionAudit142Schema = z
  .object({
    clusterId: id,
    candidateIds: z.array(id),
    targetId: id.nullable(),
    status: z.enum([
      "SELECTED",
      "SUPERSEDED_BY_CLUSTER",
      "BUDGET_OVERFLOW",
      "REDUNDANT_WITH_SELECTED_CLUSTER",
      "LOCAL_DENSITY_REJECTED",
      "LOW_SUPPORT_AUDIT_ONLY",
      "CONTRADICTED",
      "INVALID_TIMEBASE",
    ]),
    reason: id,
    densityOverrideReason: id.nullable(),
  })
  .strict();
export const safetyTarget142Schema = cluster142Schema
  .extend({
    targetId: id,
    selectionStage: z.enum([
      "PRESERVE_OLD",
      "EXCLUSIVE_RESERVE",
      "TIMELINE_DIVERSITY",
      "DYNAMIC_MARGINAL",
      "STATIC_ABLATION",
    ]),
    marginalUtility: z.number(),
    incrementalUnionSeconds: z.number().nonnegative(),
    densityOverrideReason: id.nullable(),
    requiredLevel: z.enum(["RECOMMENDED", "INFORMATIONAL"]),
    canonicalInsertAllowed: z.literal(false),
  })
  .strict();
export const safety142Schema = z
  .object({
    ...header142Shape,
    artifactType: z.literal("machine-missing-safety-reserve-targets-v2"),
    variant: z.enum([
      "CLUSTER_ONLY",
      "STRATUM_DIVERSITY",
      "SELECTION_REPAIR_ONLY",
      "DETECTOR_CEILING_ONLY",
      "DETECTOR_CEILING_COMBINED",
    ]),
    clustersHash: h,
    oldSafetyHash: h,
    targets: z.array(safetyTarget142Schema).max(24),
    audit: z.array(selectionAudit142Schema),
    decisionTrace: z.array(
      z
        .object({
          iteration: n,
          selectedClusterId: id,
          stage: safetyTarget142Schema.shape.selectionStage,
          selectedSetBeforeHash: h,
          eligiblePoolHash: h,
          utility: z.number(),
          incrementalUnionSeconds: z.number().nonnegative(),
        })
        .strict(),
    ),
    summary: z
      .object({
        targetCount: n.max(24),
        atomicMemberCount: n,
        targetUnionSeconds: z.number().min(0).max(60),
        slotUtilization: ratio142Schema,
        durationUtilization: ratio142Schema,
        preservedOldTargetCount: n,
        oldCoveragePreserved: z.boolean(),
        reservedExclusiveSelectedCount: n,
        unusedReservedSlotsReturned: n,
        overflowCount: n,
        auditOnlyCount: n,
        densityRejectedCount: n,
        densityOverrideCount: n,
        selectedBins: z.array(n),
        selectedStrata: z.array(stratum142Schema),
        catchAllTargetCount: z.literal(0),
        requiredLevelPromotionCount: z.literal(0),
      })
      .strict(),
  })
  .strict()
  .refine(
    (v) =>
      v.summary.targetCount === v.targets.length &&
      v.targets.every(
        (t) =>
          t.eligible &&
          t.verifiedTimebase &&
          !t.strongContradiction &&
          (t.reviewEnvelope.endSample - t.reviewEnvelope.startSample) /
            v.sourceIdentity.sampleRate <=
            12 + 1e-9,
      ),
    "Selected clusters must be bounded eligible verified speech candidates",
  );
export const supersession142Schema = z
  .object({
    ...header142Shape,
    artifactType: z.literal("machine-safety-target-supersession-ledger"),
    oldSafetyHash: h,
    safetyHash: h,
    entries: z.array(
      z
        .object({
          oldTargetId: id,
          newTargetIds: z.array(id),
          status: z.enum([
            "RETAINED_EQUIVALENT",
            "MERGED_AND_SUPERSEDED",
            "COVERAGE_LOST",
          ]),
          oldNativeInterval: samples,
          coveredSamples: n,
          coveragePreserved: z.boolean(),
        })
        .strict(),
    ),
    summary: z
      .object({
        oldTargetCount: n,
        retainedOldCount: n,
        mergedOldCount: n,
        releasedSlots: n,
        newTargetCount: n,
        detectorExclusiveAddedCount: n,
        overflowCount: n,
        coveragePreserved: z.boolean(),
      })
      .strict(),
  })
  .strict();
export const pathology142Schema = z
  .object({
    ...header142Shape,
    artifactType: z.literal("machine-safety-target-selection-pathology-audit"),
    oldSafetyHash: h,
    uncoveredHash: h,
    clustersHash: h,
    counts: z
      .object({
        candidates: n,
        eligible: n,
        selected: n,
        overflow: n,
        auditOnly: n,
        slotsMaximum: z.literal(24),
        secondsMaximum: z.literal(60),
        selectedUnionSeconds: z.number().nonnegative(),
        slotUtilization: ratio142Schema,
        durationUtilization: ratio142Schema,
        largestClusterMemberCount: n,
        adjacentSelectedFragmentCount: n,
        maximumRollingDensity: n,
        exclusiveOverflowCount: n,
        exclusiveSelectedCount: n,
      })
      .strict(),
    groups: z.array(
      z
        .object({
          dimension: z.enum(["STRATUM", "DETECTOR", "TIME_BIN"]),
          key: id,
          eligible: n,
          selected: n,
          overflow: n,
          auditOnly: n,
          selectedSeconds: z.number().nonnegative(),
        })
        .strict(),
    ),
    exclusiveStarvation: z.array(
      z
        .object({
          stratum: stratum142Schema,
          eligible: n,
          selected: n,
          overflow: n,
          starved: z.boolean(),
        })
        .strict(),
    ),
    diagnosis: z.array(id),
    inferenceCount: z.literal(0),
    modelLoadCount: z.literal(0),
    providerProcessStartCount: z.literal(0),
  })
  .strict();
export const phaseA142Schema = z
  .object({
    ...header142Shape,
    artifactType: z.literal("c6-0-1-14-2-phase-a-selection-projection"),
    frozenAt: z.iso.datetime(),
    oldSafetyHash: h,
    pathologyHash: h,
    clustersHash: h,
    variants: z.array(safety142Schema).length(3),
    supersessionHash: h,
    predictedAddedCoreSeconds: z.number().nonnegative(),
    predictedAddedEnvelopeSeconds: z.number().nonnegative(),
    actualAudioNotYetMaterialized: z.literal(true),
    inferenceCount: z.literal(0),
    modelLoadCount: z.literal(0),
    providerProcessStartCount: z.literal(0),
  })
  .strict();

export const c601142SelectionSchemas = {
  "c6-0-1-14-2-policy": policy142Schema,
  "machine-uncovered-speech-candidates-v2": uncovered142Schema,
  "machine-safety-target-clusters-v2": clusters142Schema,
  "machine-missing-safety-reserve-targets-v2": safety142Schema,
  "machine-safety-target-supersession-ledger": supersession142Schema,
  "machine-safety-target-selection-pathology-audit": pathology142Schema,
  "c6-0-1-14-2-phase-a-selection-projection": phaseA142Schema,
};
export type Policy142 = z.infer<typeof policy142Schema>;
export type Samples142 = z.infer<typeof samples>;
export type Observation142 = z.infer<typeof observation142Schema>;
export type Island142 = z.infer<typeof island142Schema>;
export type Candidate142 = z.infer<typeof candidate142Schema>;
export type Uncovered142 = z.infer<typeof uncovered142Schema>;
export type Cluster142 = z.infer<typeof cluster142Schema>;
export type Clusters142 = z.infer<typeof clusters142Schema>;
export type Safety142 = z.infer<typeof safety142Schema>;
export type SafetyTarget142 = z.infer<typeof safetyTarget142Schema>;
export type Family142 = z.infer<typeof family142Schema>;
export type Stratum142 = z.infer<typeof stratum142Schema>;
