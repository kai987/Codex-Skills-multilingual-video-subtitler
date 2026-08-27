import { z } from "zod";

export const c6012PolicyVersion =
  "c6.0.1.2-candidate-precision-global-timeline-v1" as const;

export const candidateConsensusModeSchema = z.enum([
  "off",
  "observe",
  "enforce",
]);
export const globalTokenTimelineModeSchema = candidateConsensusModeSchema;

const schemaVersion = z.literal("1.0.0");
const policyVersion = z.literal(c6012PolicyVersion);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const count = z.number().int().nonnegative();
const interval = z
  .object({ start: z.number().nonnegative(), end: z.number().positive() })
  .strict()
  .refine((value) => value.end > value.start, {
    message: "Interval end must be greater than start.",
  });
const artifactHeader = {
  schemaVersion,
  policyVersion,
  generatedAt: z.iso.datetime(),
} as const;

export const machineAcousticEventFamiliesSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-acoustic-event-families"),
    familyVersion: z.literal("c6.0.1.2-acoustic-event-family-v1"),
    mode: candidateConsensusModeSchema,
    sourceIdentity: z
      .object({
        sourceMediaSha256: sha256.nullable(),
        goldRuntimeInputCount: z.literal(0),
      })
      .strict(),
    inputCandidateHash: sha256,
    inputSemanticHash: sha256,
    outputSemanticHash: sha256,
    families: z.array(
      z
        .object({
          familyId: z.string().min(1),
          interval,
          normalizedText: z.string().min(1),
          candidateIds: z.array(z.string().min(1)).min(1),
          representativeCueId: z.string().min(1),
          sourceRequestIds: z.array(z.string().min(1)),
          requestIds: z.array(z.string().min(1)),
          sourceWindowIds: z.array(z.string().min(1)),
          sourceProfileIds: z.array(z.string().min(1)),
          speakerHypotheses: z.array(z.string().min(1)),
          textVariants: z.array(z.string().min(1)).min(1),
          temporalAgreement: z.number().min(0).max(1),
          lexicalAgreement: z.number().min(0).max(1),
          correlationGroupIds: z.array(z.string().min(1)).min(1),
          independentEvidenceGroupIds: z.array(z.string().min(1)).min(1),
          independentEvidenceFamilies: z.array(z.string().min(1)).min(1),
          correlatedEvidenceGroups: z.array(z.string().min(1)).min(1),
          status: z.enum(["stable", "ambiguous", "rejected"]),
          ambiguityStatus: z.enum(["assigned", "ambiguous", "rejected"]),
          reasons: z.array(z.string().min(1)),
          semanticHash: sha256,
        })
        .strict(),
    ),
    unassignedCandidates: z.array(z.string().min(1)),
    ambiguousAssignments: z.array(
      z
        .object({
          candidateId: z.string().min(1),
          familyIds: z.array(z.string().min(1)).min(1),
          reasons: z.array(z.string().min(1)).min(1),
        })
        .strict(),
    ),
    summary: z
      .object({
        candidateCount: count,
        familyCount: count,
        stableFamilyCount: count,
        ambiguousFamilyCount: count,
        collapsedDuplicateCount: count,
        correlatedDuplicateCount: count,
      })
      .strict(),
    stats: z
      .object({
        candidateCount: count,
        familyCount: count,
        singletonFamilyCount: count,
        multiCandidateFamilyCount: count,
        multiSpeakerFamilyCount: count,
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

export const machineCrossWindowConsensusSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-cross-window-consensus"),
    mode: candidateConsensusModeSchema,
    familySemanticHash: sha256,
    outputSemanticHash: sha256,
    decisions: z.array(
      z
        .object({
          familyId: z.string().min(1),
          candidateIds: z.array(z.string().min(1)).min(1),
          selectedCueId: z.string().min(1).nullable(),
          independentSupportCount: count,
          correlatedSupportCount: count,
          stable: z.boolean(),
          mutationAllowed: z.boolean(),
          candidateRankings: z.array(
            z
              .object({
                candidateId: z.string().min(1),
                rank: z.number().int().positive(),
                evidenceStrength: z.number().min(0).max(1),
              })
              .strict(),
          ),
          evidenceGroups: z.array(z.string().min(1)),
          correlatedEvidence: z.array(z.string().min(1)),
          alternativeCandidateIds: z.array(z.string().min(1)),
          decision: z.enum([
            "CONSENSUS_ACCEPT",
            "CONSENSUS_AMBIGUOUS",
            "MULTI_SPEAKER_EVENT",
            "LOW_SUPPORT",
            "REJECT_HALLUCINATION",
          ]),
          confidenceClass: z.enum(["high", "medium", "low", "unknown"]),
          reasons: z.array(z.string().min(1)),
          semanticHash: sha256,
        })
        .strict(),
    ),
    summary: z
      .object({
        decisionCount: count,
        stableDecisionCount: count,
        mutationAllowedCount: count,
        emittedCandidateCount: count,
        diagnosticOnly: z.boolean(),
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

export const asrRequestTimelineContractSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("asr-request-timeline-contract"),
    requests: z.array(
      z
        .object({
          requestId: z.string().min(1),
          manifestRequestId: z.string().min(1).nullable(),
          requestAliases: z.array(z.string().min(1)),
          sourceMediaSha256: sha256,
          requestType: z.enum([
            "baseline",
            "refinement",
            "recovery",
            "coverage",
            "lyrics",
            "overlap",
          ]),
          requestedInterval: interval,
          extractedInterval: interval,
          sourceMediaStartSeconds: z.number().nonnegative(),
          sourceMediaEndSeconds: z.number().positive(),
          requestedIntervalStart: z.number().nonnegative(),
          requestedIntervalEnd: z.number().positive(),
          extractedAudioStart: z.number().nonnegative(),
          extractedAudioEnd: z.number().positive(),
          extractedAudioDurationSeconds: z.number().positive(),
          sampleRate: z.number().int().positive(),
          sampleCount: count,
          decoderChunkStartSeconds: z.literal(0),
          ffmpegSeekMode: z.literal("input-seek-before-i"),
          ffmpegInputSeekSeconds: z.number().nonnegative(),
          ffmpegOutputTrimSeconds: z.literal(0),
          ffmpegSeekPlacement: z.literal("before-input"),
          ffmpegOutputTimeOrigin: z.literal("zero"),
          decodeAudioZero: z.literal(0),
          decoderReportedSegmentStart: z.number().nonnegative().nullable(),
          decoderReportedSegmentEnd: z.number().nonnegative().nullable(),
          tokenTimeBase: z.enum([
            "original-audio-local",
            "vad-processed-local",
            "unknown",
          ]),
          cacheIdentity: sha256,
          cacheLineage: z
            .object({
              currentKey: sha256,
              legacyKeys: z.array(z.string().min(1)),
              entryStatus: z.enum([
                "portable-verified",
                "artifact-derived",
                "unavailable",
              ]),
            })
            .strict(),
          parentRequestId: z.string().min(1).nullable(),
          vadEnabled: z.boolean(),
          coordinateSystem: z.enum([
            "original-audio-local",
            "vad-processed-local",
            "unknown",
          ]),
          mappingMethod: z.enum([
            "verified-extraction-offset",
            "official-mapped-token-getter",
            "unverified-vad-coordinate",
            "unavailable",
          ]),
          contractStatus: z.enum(["verified", "quarantined", "unavailable"]),
          evidence: z.array(z.string().min(1)),
          exactGlobalOffset: z.number().nonnegative().nullable(),
          offsetSource: z.string().min(1),
          offsetVerified: z.boolean(),
          timelineSemanticHash: sha256,
        })
        .strict(),
    ),
    summary: z
      .object({
        requestCount: count,
        verifiedRequestCount: count,
        quarantinedRequestCount: count,
        unavailableRequestCount: count,
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

export const machineGlobalTokenTimelineSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-global-token-timeline"),
    mode: globalTokenTimelineModeSchema,
    requestContractSemanticHash: sha256,
    tokens: z.array(
      z
        .object({
          tokenId: z.string().min(1),
          cueId: z.string().min(1),
          requestId: z.string().min(1),
          text: z.string(),
          localInterval: interval.nullable(),
          globalInterval: interval.nullable(),
          coordinateSystem: z.enum([
            "original-audio-local",
            "vad-processed-local",
            "original-media-global",
            "unknown",
          ]),
          mappingMethod: z.enum([
            "verified-extraction-offset",
            "official-mapped-token-getter",
            "quarantined-vad-token",
            "unmapped",
          ]),
          trustScore: z.number().min(0).max(1),
          trusted: z.boolean(),
          mappingStatus: z.enum([
            "TRUSTED",
            "USABLE_WITH_CAUTION",
            "UNTRUSTED",
            "UNMAPPED",
          ]),
          failureReason: z
            .enum([
              "missing-request-contract",
              "offset-unverified",
              "stale-cache",
              "out-of-request",
              "non-monotonic",
              "invalid-token-time",
              "segment-containment-failure",
              "source-containment-failure",
              "parent-lineage-mismatch",
              "ambiguous-time-base",
              "unknown",
            ])
            .nullable(),
          reasons: z.array(z.string().min(1)),
        })
        .strict(),
    ),
    summary: z
      .object({
        tokenCount: count,
        lexicalTokenCount: count,
        trustedMappedTokenCount: count,
        quarantinedVadTokenCount: count,
        unmappedTokenCount: count,
        trustedRequestCount: count,
        rawTokenCount: count,
        mappedTokenCount: count,
        cautionTokenCount: count,
        rejectedTokenCount: count,
        mappingFailureReasons: z.record(z.string(), count),
        requestCoverage: z.number().min(0).max(1),
        cueCoverage: z.number().min(0).max(1),
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

export const machineCueTimelineEvidenceSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-cue-timeline-evidence"),
    mode: globalTokenTimelineModeSchema,
    tokenTimelineSemanticHash: sha256,
    cues: z.array(
      z
        .object({
          cueId: z.string().min(1),
          currentInterval: interval,
          trustedTokenIds: z.array(z.string().min(1)),
          trustedTokenInterval: interval.nullable(),
          lexicalCoverageRatio: z.number().min(0).max(1),
          timingEligible: z.boolean(),
          evidencePriority: z.enum([
            "trusted-mapped-token",
            "stable-mfa-ctc-consensus",
            "verified-asr-segment",
            "speech-vad",
            "coarse-source-window",
            "unavailable",
          ]),
          blockers: z.array(z.string().min(1)),
        })
        .strict(),
    ),
    summary: z
      .object({
        cueCount: count,
        cueWithTrustedTokenCount: count,
        timingEligibleCueCount: count,
        eligibleCueCoverageRatio: z.number().min(0).max(1),
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

export const machineTimingNonDegradationSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-timing-non-degradation"),
    mode: globalTokenTimelineModeSchema,
    decisions: z.array(
      z
        .object({
          cueId: z.string().min(1),
          before: interval,
          proposed: interval,
          result: z.enum(["unchanged", "accepted", "rejected"]),
          trustedTokenIds: z.array(z.string().min(1)),
          overlapSecondsBefore: z.number().nonnegative(),
          overlapSecondsAfter: z.number().nonnegative(),
          reasons: z.array(z.string().min(1)),
        })
        .strict(),
    ),
    summary: z
      .object({
        evaluatedCueCount: count,
        acceptedMutationCount: count,
        rejectedMutationCount: count,
        unchangedCueCount: count,
        timingRegressionCount: z.literal(0),
        proposedMutationCount: count,
        expansionRejectedCount: count,
        weakEvidenceRejectedCount: count,
        trustedTokenAppliedCount: count,
        mfaAppliedCount: count,
        ctcAppliedCount: count,
        netBoundaryShiftSeconds: z.number().nonnegative(),
      })
      .strict(),
    beforeTimingHash: sha256,
    afterTimingHash: sha256,
  })
  .strict();

export const machineLexicalConservationSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-lexical-conservation"),
    mode: candidateConsensusModeSchema,
    beforeTextHash: sha256,
    afterTextHash: sha256,
    decisions: z.array(
      z
        .object({
          operationId: z.string().min(1),
          sourceCueIds: z.array(z.string().min(1)).min(1),
          outputCueIds: z.array(z.string().min(1)).min(1),
          operation: z.enum(["preserve", "duplicate-collapse", "reject"]),
          conserved: z.boolean(),
          lostNormalizedText: z.array(z.string().min(1)),
          reasons: z.array(z.string().min(1)),
        })
        .strict(),
    ),
    summary: z
      .object({
        inputCueCount: count,
        outputCueCount: count,
        duplicateCollapseCount: count,
        rejectedMutationCount: count,
        lexicalLossCount: z.literal(0),
        sourceCharacters: count,
        consensusCharacters: count,
        finalCharacters: count,
        presentationOnlyMutationCount: count,
        lexicalMutationCount: count,
        truncationCount: count,
        mergeCount: count,
        deletionCount: count,
        evidenceSupportedMutationCount: count,
        unsupportedMutationRejectedCount: count,
      })
      .strict(),
  })
  .strict();

export const machineOverlapEventClassificationSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-overlap-event-classification"),
    mode: candidateConsensusModeSchema,
    pairs: z.array(
      z
        .object({
          pairId: z.string().min(1),
          leftCueId: z.string().min(1),
          rightCueId: z.string().min(1),
          interval,
          overlapSeconds: z.number().positive(),
          classification: z.enum([
            "DUPLICATE_EVENT_OVERLAP",
            "POSSIBLE_MULTI_SPEAKER",
            "RAPID_TURN_PADDING",
            "TIMELINE_CONFLICT",
            "UNKNOWN_OVERLAP",
          ]),
          confidence: z.number().min(0).max(1),
          automaticallyResolved: z.boolean(),
          reasons: z.array(z.string().min(1)),
        })
        .strict(),
    ),
    summary: z
      .object({
        overlapPairCount: count,
        duplicatePairCount: count,
        boundaryCollisionCount: count,
        concurrentSpeechCount: count,
        unknownCount: count,
        automaticallyResolvedCount: count,
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

const qualityMetricsSchema = z
  .object({
    cueCount: count,
    exactCer: z.number().nonnegative(),
    normalizedCer: z.number().nonnegative(),
    goldCoverage: z.number().min(0).max(1),
    missingCount: count,
    hallucinationCount: count,
    materialErrorCount: count,
    severeTimingErrorCount: count,
    startMaeSeconds: z.number().nonnegative(),
    endMaeSeconds: z.number().nonnegative(),
    p95BoundaryErrorSeconds: z.number().nonnegative(),
    meanTemporalIou: z.number().min(0).max(1),
    overlapPairCount: count,
  })
  .strict();

const qualityDeltasSchema = z
  .object({
    cueCount: z.number(),
    exactCer: z.number(),
    normalizedCer: z.number(),
    goldCoverage: z.number(),
    missingCount: z.number(),
    hallucinationCount: z.number(),
    materialErrorCount: z.number(),
    severeTimingErrorCount: z.number(),
    startMaeSeconds: z.number(),
    endMaeSeconds: z.number(),
    p95BoundaryErrorSeconds: z.number(),
    meanTemporalIou: z.number(),
    overlapPairCount: z.number(),
  })
  .strict();

export const c6012QualityPolicySchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-2-quality-policy"),
    candidateConsensus: candidateConsensusModeSchema,
    globalTokenTimeline: globalTokenTimelineModeSchema,
    goldRuntimeInputCount: z.literal(0),
    productionStatus: z.literal("needs-review"),
    finalizationMethod: z.literal("none"),
    machineOnlyRelease: z.literal(false),
    gates: z
      .object({
        minimumCoverage: z.literal(0.9),
        maximumMissing: z.literal(15),
        maximumHallucinations: z.literal(2),
        maximumMaterialErrors: z.literal(45),
        maximumSevereTimingErrors: z.literal(30),
        maximumStartMaeSeconds: z.literal(1.2),
        maximumEndMaeSeconds: z.literal(1.2),
        maximumP95BoundaryErrorSeconds: z.literal(3.5),
        maximumNormalizedCer: z.literal(0.55),
        maximumOverlapPairs: z.literal(20),
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

export const c6012AblationSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-2-ablation"),
    stages: z.array(
      z
        .object({
          id: z.enum(["V0", "V1", "V2", "V3", "V4", "V5", "final"]),
          label: z.string().min(1),
          outputPath: z.string().min(1),
          outputFreezeHash: sha256.nullable(),
          metrics: qualityMetricsSchema.nullable(),
          status: z.enum(["completed", "not-run", "failed"]),
        })
        .strict(),
    ),
    semanticHash: sha256,
  })
  .strict();

export const c6012QualityComparisonSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-2-quality-comparison"),
    baseline: qualityMetricsSchema,
    rawAsrBaseline: qualityMetricsSchema,
    candidate: qualityMetricsSchema,
    deltas: qualityDeltasSchema,
    gateResults: z.record(z.string(), z.boolean()),
    outcome: z.enum(["GO", "HOLD"]),
    semanticHash: sha256,
  })
  .strict();

export const c6012ValidationSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-2-validation"),
    branch: z.literal("codex/c6-0-1-2-candidate-precision-global-timeline"),
    repositoryCommit: z.string().regex(/^[a-f0-9]{40}$/u),
    sourceMediaSha256: sha256,
    goldRuntimeInputCount: z.literal(0),
    checks: z.array(
      z
        .object({
          id: z.string().min(1),
          passed: z.boolean(),
          evidence: z.array(z.string().min(1)),
        })
        .strict(),
    ),
    outputSemanticParity: z.boolean(),
    unseenGoldAccessCount: z.literal(0),
    datasetHardcodingFindingCount: z.literal(0),
    outcome: z.enum(["GO", "HOLD"]),
    semanticHash: sha256,
  })
  .strict();

export type CandidateConsensusMode = z.infer<
  typeof candidateConsensusModeSchema
>;
export type GlobalTokenTimelineMode = z.infer<
  typeof globalTokenTimelineModeSchema
>;
export type MachineAcousticEventFamilies = z.infer<
  typeof machineAcousticEventFamiliesSchema
>;
export type MachineCrossWindowConsensus = z.infer<
  typeof machineCrossWindowConsensusSchema
>;
export type AsrRequestTimelineContract = z.infer<
  typeof asrRequestTimelineContractSchema
>;
export type MachineGlobalTokenTimeline = z.infer<
  typeof machineGlobalTokenTimelineSchema
>;
export type MachineCueTimelineEvidence = z.infer<
  typeof machineCueTimelineEvidenceSchema
>;
export type MachineTimingNonDegradation = z.infer<
  typeof machineTimingNonDegradationSchema
>;
export type MachineLexicalConservation = z.infer<
  typeof machineLexicalConservationSchema
>;
export type MachineOverlapEventClassification = z.infer<
  typeof machineOverlapEventClassificationSchema
>;
export type C6012QualityMetrics = z.infer<typeof qualityMetricsSchema>;
