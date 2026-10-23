import { z } from "zod";

export const c6014PolicyVersion =
  "c6.0.1.4-vad-timebase-acoustic-text-variant-reasr-v1" as const;

export const c6014ModeSchema = z.enum(["off", "observe", "enforce"]);
export const vadGlobalTimebaseModeSchema = c6014ModeSchema;
export const textVariantVerifierModeSchema = c6014ModeSchema;
export const targetedEventReasrModeSchema = c6014ModeSchema;

const schemaVersion = z.literal("1.0.0");
const policyVersion = z.literal(c6014PolicyVersion);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const count = z.number().int().nonnegative();
const positiveCount = z.number().int().positive();
const ratio = z.number().min(0).max(1);
const sampleRate = z.number().int().positive();
const sampleIndex = z.number().int().nonnegative();
const interval = z
  .object({ start: z.number().nonnegative(), end: z.number().positive() })
  .strict()
  .refine((value) => value.end > value.start, {
    message: "Interval end must be greater than start.",
  });
const sampleInterval = z
  .object({ startSample: sampleIndex, endSample: positiveCount })
  .strict()
  .refine((value) => value.endSample > value.startSample, {
    message: "Sample interval end must be greater than start.",
  });
const artifactHeader = {
  schemaVersion,
  policyVersion,
  generatedAt: z.iso.datetime(),
} as const;

export const sampleTransformSchema = z
  .object({
    transformId: z.string().min(1),
    parentArtifactId: z.string().min(1),
    parentArtifactSha256: sha256,
    childArtifactId: z.string().min(1),
    childArtifactSha256: sha256,
    parentSampleRate: sampleRate,
    childSampleRate: sampleRate,
    parentTotalSamples: positiveCount,
    childTotalSamples: positiveCount,
    childStartSampleInParent: sampleIndex,
    childEndSampleInParent: positiveCount,
    outputLocalZeroSample: z.literal(0),
    conversionNumerator: positiveCount,
    conversionDenominator: positiveCount,
    roundingPolicy: z.enum([
      "identity-integer",
      "floor-start-ceil-end-rational",
    ]),
    extractionMethod: z.enum([
      "direct-source-ffmpeg-sample-trim",
      "whisper-internal-vad",
      "nested-recovery-window",
      "identity",
    ]),
    ffmpeg: z
      .object({
        inputSeekPlacement: z.enum(["none", "before-input", "after-input"]),
        inputSeekSample: sampleIndex,
        outputTrimStartSample: sampleIndex,
        outputDurationSamples: positiveCount,
        atrimUsed: z.boolean(),
        asetptsReset: z.boolean(),
        resampleUsed: z.boolean(),
        paddingSamples: count,
        commandIdentity: sha256,
      })
      .strict(),
    resamplingIdentity: sha256,
    verified: z.boolean(),
    verificationReasons: z.array(z.string().min(1)).min(1),
    semanticHash: sha256,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.childEndSampleInParent <= value.childStartSampleInParent) {
      context.addIssue({
        code: "custom",
        path: ["childEndSampleInParent"],
        message: "Child sample span must be positive.",
      });
    }
    if (value.childEndSampleInParent > value.parentTotalSamples) {
      context.addIssue({
        code: "custom",
        path: ["childEndSampleInParent"],
        message: "Child sample span must remain inside its parent.",
      });
    }
  });

export const vadSegmentSampleMappingSchema = z
  .object({
    vadSegmentId: z.string().min(1),
    requestId: z.string().min(1),
    sourceMediaSha256: sha256,
    parentArtifactId: z.string().min(1),
    parentArtifactSha256: sha256,
    parentSampleRate: sampleRate,
    parentTotalSamples: positiveCount,
    providerVadStartSampleInParent: sampleIndex,
    providerVadEndSampleInParent: positiveCount,
    vadStartSampleInParent: sampleIndex,
    vadEndSampleInParent: positiveCount,
    vadSampleCount: positiveCount,
    boundaryNormalizationApplied: z.boolean(),
    boundaryNormalizationDeltaStartSamples: count,
    boundaryNormalizationDeltaEndSamples: count,
    boundaryNormalizationToleranceSamples: positiveCount,
    boundaryNormalizationReason: z.enum([
      "NONE",
      "RAW_VAD_AUDIO_END_EXCEEDED_WITHIN_TOLERANCE",
    ]),
    outputSampleRate: sampleRate,
    outputSampleCount: positiveCount,
    outputLocalZeroSample: z.literal(0),
    sourceGlobalStartSample: sampleIndex,
    sourceGlobalEndSample: positiveCount,
    extractionCommandIdentity: sha256,
    resamplingIdentity: sha256,
    providerSegmentIndex: count,
    providerCoordinateSystem: z.literal("original-audio-local"),
    mappingStatus: z.enum(["VERIFIED", "QUARANTINED", "AMBIGUOUS"]),
    mappingReasons: z.array(z.string().min(1)).min(1),
    parentTransformHash: sha256,
    timebaseSemanticHash: sha256,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.boundaryNormalizationApplied !==
      (value.boundaryNormalizationDeltaStartSamples > 0 ||
        value.boundaryNormalizationDeltaEndSamples > 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["boundaryNormalizationApplied"],
        message:
          "VAD boundary normalization status must match its sample deltas.",
      });
    }
    if (
      value.boundaryNormalizationDeltaStartSamples >
        value.boundaryNormalizationToleranceSamples ||
      value.boundaryNormalizationDeltaEndSamples >
        value.boundaryNormalizationToleranceSamples
    ) {
      context.addIssue({
        code: "custom",
        path: ["boundaryNormalizationToleranceSamples"],
        message: "VAD boundary normalization cannot exceed its tolerance.",
      });
    }
    if (
      value.boundaryNormalizationApplied !==
      (value.boundaryNormalizationReason !== "NONE")
    ) {
      context.addIssue({
        code: "custom",
        path: ["boundaryNormalizationReason"],
        message:
          "VAD boundary normalization reason must match its applied status.",
      });
    }
    if (
      value.vadEndSampleInParent - value.vadStartSampleInParent !==
      value.vadSampleCount
    ) {
      context.addIssue({
        code: "custom",
        path: ["vadSampleCount"],
        message: "VAD sample count must equal its parent sample span.",
      });
    }
    if (value.sourceGlobalEndSample <= value.sourceGlobalStartSample) {
      context.addIssue({
        code: "custom",
        path: ["sourceGlobalEndSample"],
        message: "Source-global VAD sample span must be positive.",
      });
    }
  });

export const machineVadGlobalTimebaseSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-vad-global-timebase"),
    mode: vadGlobalTimebaseModeSchema,
    sourceIdentity: z
      .object({
        sourceMediaSha256: sha256,
        sourceSampleRate: sampleRate,
        sourceTotalSamples: positiveCount,
        sourceReadOnlyVerified: z.boolean(),
      })
      .strict(),
    vadProviderIdentity: z
      .object({
        provider: z.literal("whisper.cpp-silero-vad"),
        whisperVersion: z.string().min(1),
        whisperBinarySha256: sha256,
        vadModelSha256: sha256,
        capabilityHash: sha256,
        mappedGetterUsed: z.boolean(),
        rawVadGetterUsed: z.boolean(),
        requestStateIsolation: z.string().min(1),
      })
      .strict(),
    vadSegments: z.array(vadSegmentSampleMappingSchema),
    parentChildTransforms: z.array(sampleTransformSchema),
    legacyQuarantinedRequestIds: z.array(z.string().min(1)),
    freshRecoveryRequestIds: z.array(z.string().min(1)),
    emptyResponseVerifiedRequestIds: z.array(z.string().min(1)),
    verifiedSegmentCount: count,
    quarantinedSegmentCount: count,
    ambiguousSegmentCount: count,
    verifiedRequestCount: count,
    quarantinedRequestCount: count,
    freshRemapRequestCount: count,
    emptyResponseVerifiedRequestCount: count,
    boundaryNormalizationPolicyVersion: z.literal(
      "c6.0.1.4-sample-domain-vad-boundary-normalization-v1",
    ),
    boundaryNormalizedSegmentCount: count,
    sampleMappingCoverage: ratio,
    guessedOffsetCount: z.literal(0),
    semanticHash: sha256,
  })
  .strict();

export const requestTimelineV2EntrySchema = z
  .object({
    requestId: z.string().min(1),
    legacyRequestId: z.string().min(1).nullable(),
    sourceMediaSha256: sha256,
    sourceGlobalStartSample: sampleIndex,
    sourceGlobalEndSample: positiveCount,
    sourceSampleRate: sampleRate,
    parentChain: z.array(z.string().min(1)).min(1),
    parentTransformHashes: z.array(sha256).min(1),
    extractedAudioSha256: sha256,
    extractedSampleRate: sampleRate,
    extractedSampleCount: positiveCount,
    decoderLocalOriginSample: z.literal(0),
    decoderLocalOriginSeconds: z.literal(0),
    tokenTimeBase: z.enum([
      "original-audio-local",
      "mapped-original-audio-local",
      "vad-processed-local",
      "unknown",
    ]),
    mappingStatus: z.enum([
      "VERIFIED",
      "QUARANTINED",
      "AMBIGUOUS",
      "UNAVAILABLE",
    ]),
    mappingReason: z.string().min(1),
    cacheIdentity: sha256,
    cacheEntrySha256: sha256,
    modelIdentity: sha256,
    vadEnabled: z.boolean(),
    promptPresent: z.boolean(),
    freshEvidence: z.boolean(),
    semanticHash: sha256,
  })
  .strict()
  .refine(
    (value) => value.sourceGlobalEndSample > value.sourceGlobalStartSample,
    { message: "Request source-global sample span must be positive." },
  );

export const asrRequestTimelineContractV2Schema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("asr-request-timeline-contract-v2"),
    sourceMediaSha256: sha256,
    vadGlobalTimebaseSemanticHash: sha256,
    requests: z.array(requestTimelineV2EntrySchema),
    summary: z
      .object({
        requestCount: count,
        verifiedRequestCount: count,
        quarantinedRequestCount: count,
        ambiguousRequestCount: count,
        unavailableRequestCount: count,
        freshRequestCount: count,
        promptPresentCount: count,
        guessedOffsetCount: z.literal(0),
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

export const tokenMappingStatusV2Schema = z.enum([
  "TRUSTED",
  "ASSOCIATION_PENDING",
  "UNTRUSTED",
  "AMBIGUOUS_TIME_BASE",
  "UNMAPPED",
]);

export const globalTokenV2Schema = z
  .object({
    tokenId: z.string().min(1),
    requestId: z.string().min(1),
    cueId: z.string().min(1).nullable(),
    text: z.string(),
    lexical: z.boolean(),
    probability: z.number().min(0).max(1).nullable(),
    decoderLocalStartCentiseconds: count.nullable(),
    decoderLocalEndCentiseconds: count.nullable(),
    decoderLocalStartSample: sampleIndex.nullable(),
    decoderLocalEndSample: sampleIndex.nullable(),
    sourceGlobalStartSample: sampleIndex.nullable(),
    sourceGlobalEndSample: sampleIndex.nullable(),
    sourceSampleRate: sampleRate,
    sourceGlobalInterval: interval.nullable(),
    mappingStatus: tokenMappingStatusV2Schema,
    mappingReason: z.string().min(1),
    requestTimelineSemanticHash: sha256,
    parentTransformHashes: z.array(sha256),
    cacheIdentity: sha256,
    trusted: z.boolean(),
    semanticHash: sha256,
  })
  .strict()
  .superRefine((value, context) => {
    const localValues = [
      value.decoderLocalStartCentiseconds,
      value.decoderLocalEndCentiseconds,
      value.decoderLocalStartSample,
      value.decoderLocalEndSample,
    ];
    const localNullCount = localValues.filter((entry) => entry === null).length;
    if (localNullCount !== 0 && localNullCount !== localValues.length) {
      context.addIssue({
        code: "custom",
        path: ["decoderLocalStartCentiseconds"],
        message: "Token local timing must be fully present or fully absent.",
      });
    }
    if (
      value.decoderLocalEndSample !== null &&
      value.decoderLocalStartSample !== null &&
      value.decoderLocalEndSample < value.decoderLocalStartSample
    ) {
      context.addIssue({
        code: "custom",
        path: ["decoderLocalEndSample"],
        message: "Token local end must not precede its start.",
      });
    }
    if (
      value.trusted !== (value.mappingStatus === "TRUSTED") ||
      (value.trusted &&
        (value.sourceGlobalStartSample === null ||
          value.sourceGlobalEndSample === null ||
          value.sourceGlobalInterval === null))
    ) {
      context.addIssue({
        code: "custom",
        path: ["trusted"],
        message: "Trusted token status requires complete source-global timing.",
      });
    }
  });

export const machineGlobalTokenTimelineV2Schema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-global-token-timeline-v2"),
    requestTimelineSemanticHash: sha256,
    sourceMediaSha256: sha256,
    tokens: z.array(globalTokenV2Schema),
    summary: z
      .object({
        tokenObservationCount: count,
        lexicalTokenCount: count,
        trustedMappedTokenCount: count,
        associationPendingTokenCount: count,
        untrustedTokenCount: count,
        ambiguousTimeBaseTokenCount: count,
        unmappedTokenCount: count,
        missingLocalTimeTokenCount: count,
        freshRecoveredTokenCount: count,
        trustedCueCount: count,
        timingEligibleCueCount: count,
        monotonicityFailureCount: count,
        containmentFailureCount: count,
        staleLineageCount: z.literal(0),
        guessedOffsetCount: z.literal(0),
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

export const textVariantOracleClassSchema = z.enum([
  "SELECTOR_ERROR",
  "POOL_INSUFFICIENT",
  "SELECTED_ALREADY_ORACLE",
  "ASSOCIATION_AMBIGUOUS",
  "UNEVALUABLE",
]);

export const machineTextVariantOracleEvaluationSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-text-variant-oracle-evaluation"),
    evaluationPhase: z.literal("post-freeze-gold-isolated"),
    runtimeGoldInputCount: z.literal(0),
    machineFreezeHash: sha256,
    goldIdentityHash: sha256,
    evaluableEventCount: count,
    unevaluableEventCount: count,
    selectedVariantError: z.number().nonnegative(),
    oracleExistingVariantError: z.number().nonnegative(),
    oracleImprovementPotential: z.number().nonnegative(),
    selectorRegret: z.number().nonnegative(),
    eventEntries: z.array(
      z
        .object({
          eventId: z.string().min(1),
          selectedCandidateId: z.string().min(1).nullable(),
          candidateIds: z.array(z.string().min(1)).min(1),
          selectedDistance: z.number().nonnegative().nullable(),
          oracleCandidateId: z.string().min(1).nullable(),
          oracleDistance: z.number().nonnegative().nullable(),
          oracleGain: z.number().nonnegative().nullable(),
          oracleClass: textVariantOracleClassSchema,
          matchedGoldCueIds: z.array(z.string().min(1)),
          goldTextIncluded: z.literal(false),
        })
        .strict(),
    ),
    aggregateMetrics: z
      .object({
        currentSelectedOracleHitCount: count,
        selectorErrorCount: count,
        poolInsufficientCount: count,
        associationAmbiguousCount: count,
        selectedAlreadyOracleCount: count,
        oracleNormalizedError: z.number().nonnegative(),
        theoreticalCandidatePoolGain: z.number().nonnegative(),
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

export const acousticProjectionSchema = z
  .object({
    projectionId: z.string().min(1),
    displayTextHash: sha256,
    projectionText: z.string(),
    projectionTextHash: sha256,
    method: z.enum([
      "kana-literal",
      "sudachi-reading",
      "display-text-fallback",
      "unscorable",
    ]),
    projectionCoverage: ratio,
    unresolvedUnits: z.array(z.string().min(1)),
    humanDerivedEntryCount: z.literal(0),
    canonicalTextMutated: z.literal(false),
    semanticHash: sha256,
  })
  .strict();

export const ctcVariantEvidenceSchema = z
  .object({
    variantId: z.string().min(1),
    projectionId: z.string().min(1),
    evidenceStatus: z.enum([
      "CTC_SCORABLE",
      "CTC_UNSCORABLE",
      "CTC_NO_VALID_PATH",
      "CTC_WEAK",
    ]),
    alignmentCoverage: ratio,
    normalizedAlignmentCost: z.number().nonnegative().nullable(),
    unsupportedUnitRatio: ratio,
    edgePinned: z.boolean(),
    monotonicity: z.boolean(),
    acousticSpanCoverage: ratio,
    unalignedPrefixRatio: ratio,
    unalignedSuffixRatio: ratio,
    projectionCoverage: ratio,
    durationCoverage: ratio,
    targetUnitCount: count,
    meanTokenPosterior: z.number().min(0).max(1).nullable(),
    greedyNormalizedSimilarity: ratio.nullable(),
    attemptIds: z.array(z.string().min(1)),
    blockers: z.array(z.string().min(1)),
    semanticHash: sha256,
  })
  .strict();

export const machineTextVariantAcousticVerificationSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-text-variant-acoustic-verification"),
    mode: textVariantVerifierModeSchema,
    ctcRuntimeIdentityHash: sha256,
    ctcModelSnapshotHash: sha256,
    pronunciationRuntimeIdentityHash: sha256,
    events: z.array(
      z
        .object({
          eventId: z.string().min(1),
          audioEvidenceId: z.string().min(1),
          audioInterval: interval,
          audioSha256: sha256,
          variantIds: z.array(z.string().min(1)).min(1),
          acousticProjections: z.array(acousticProjectionSchema).min(1),
          ctcEvidence: z.array(ctcVariantEvidenceSchema).min(1),
          dominanceRelations: z.array(
            z
              .object({
                dominantVariantId: z.string().min(1),
                dominatedVariantId: z.string().min(1),
                relation: z.enum([
                  "STRONG_DOMINANCE",
                  "WEAK_DOMINANCE",
                  "INCOMPARABLE",
                ]),
                reasons: z.array(z.string().min(1)).min(1),
              })
              .strict(),
          ),
          rejectedVariants: z.array(z.string().min(1)),
          ambiguousVariants: z.array(z.string().min(1)),
          selectedByAcousticEvidence: z.string().min(1).nullable(),
          lengthBiasAuditPassed: z.boolean(),
          prefixBiasAuditPassed: z.boolean(),
          semanticHash: sha256,
        })
        .strict(),
    ),
    summary: z
      .object({
        eventCount: count,
        requestCount: count,
        modelLoadCount: count,
        workerStartCount: count,
        candidatePairComparisons: count,
        ctcScorableVariantCount: count,
        ctcUnscorableVariantCount: count,
        acousticDominanceCount: count,
        weakSeparationCount: count,
        edgePinnedCount: count,
        projectionFailureCount: count,
        lengthBiasAuditPassed: z.boolean(),
        prefixBiasAuditPassed: z.boolean(),
        networkUsed: z.literal(false),
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

export const textVariantDecisionStatusSchema = z.enum([
  "SELECT_EXISTING_VARIANT",
  "AMBIGUOUS_VARIANT",
  "NO_ACOUSTICALLY_SUPPORTED_VARIANT",
  "INSUFFICIENT_EVIDENCE",
  "MULTI_SPEAKER_UNRESOLVED",
  "REJECT_EVENT",
]);

export const machineTextVariantDecisionSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-text-variant-decision"),
    mode: textVariantVerifierModeSchema,
    decisions: z.array(
      z
        .object({
          eventId: z.string().min(1),
          inputVariants: z.array(z.string().min(1)).min(1),
          hardRejected: z.array(z.string().min(1)),
          ctcEvidenceIds: z.array(z.string().min(1)),
          independentSupport: z.record(z.string(), count),
          tokenSupport: z.record(z.string(), count),
          decoderEvidence: z.record(z.string(), z.string()),
          linguisticTieBreak: z
            .object({
              used: z.boolean(),
              selectedVariantId: z.string().min(1).nullable(),
              reasons: z.array(z.string().min(1)),
            })
            .strict(),
          selectedVariant: z.string().min(1).nullable(),
          runnerUp: z.string().min(1).nullable(),
          decisionStatus: textVariantDecisionStatusSchema,
          decisionReasons: z.array(z.string().min(1)).min(1),
          confidenceClass: z.enum(["HIGH", "MEDIUM", "LOW", "UNKNOWN"]),
          magicWeightedScoreUsed: z.literal(false),
          forcedWinner: z.literal(false),
          semanticHash: sha256,
        })
        .strict(),
    ),
    summary: z
      .object({
        eventCount: count,
        multiVariantEventCount: count,
        singleVariantEventCount: count,
        hardRejectedVariantCount: count,
        clearWinnerCount: count,
        ambiguousVariantCount: count,
        replacementCount: count,
        unchangedCount: count,
        unresolvedCount: count,
        forcedWinnerCount: z.literal(0),
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

export const machineCandidatePoolSufficiencySchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-candidate-pool-sufficiency"),
    events: z.array(
      z
        .object({
          eventId: z.string().min(1),
          status: z.enum([
            "SUFFICIENT",
            "AMBIGUOUS",
            "INSUFFICIENT",
            "UNKNOWN",
          ]),
          signals: z.array(
            z.enum([
              "ALL_CTC_COVERAGE_LOW",
              "TRUSTED_TOKEN_CONFLICT",
              "HIGH_EDGE_TRUNCATION",
              "INDEPENDENT_WINDOW_DISAGREEMENT",
              "NO_FULL_SPEECH_SPAN_COVERAGE",
              "UNSTABLE_REASR_OUTPUT",
              "CLEAR_ACOUSTIC_WINNER",
              "SINGLE_VARIANT_NO_INDEPENDENT_SUPPORT",
            ]),
          ),
          reasons: z.array(z.string().min(1)).min(1),
          semanticHash: sha256,
        })
        .strict(),
    ),
    summary: z
      .object({
        eventCount: count,
        sufficientCount: count,
        ambiguousCount: count,
        insufficientCount: count,
        unknownCount: count,
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

const verificationRequestSchema = z
  .object({
    requestId: z.string().min(1),
    requestFamily: z.string().min(1),
    windowType: z.enum(["exact", "small-context", "expanded-context"]),
    sourceGlobalSampleInterval: sampleInterval,
    sourceGlobalInterval: interval,
    extractedAudioSha256: sha256,
    extractedSampleRate: sampleRate,
    extractedSampleCount: positiveCount,
    cacheIdentity: sha256,
    cacheHit: z.boolean(),
    inferenceExecuted: z.boolean(),
    modelLoadCount: count,
    workerStartCount: count,
    promptPresent: z.literal(false),
    candidateTextPromptLeakCount: z.literal(0),
    humanMemoryPromptLeakCount: z.literal(0),
    runtimeGoldInputCount: z.literal(0),
    semanticHash: sha256,
  })
  .strict();

export const machineTargetedEventReasrSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-targeted-event-reasr"),
    mode: targetedEventReasrModeSchema,
    policy: z
      .object({
        maximumRequestsPerEvent: z.literal(3),
        episodeRequestBudget: z.number().int().positive(),
        smallContextMilliseconds: z.literal(600),
        expandedContextMilliseconds: z.literal(1000),
        directSourceGlobalExtraction: z.literal(true),
        promptIsolationRequired: z.literal(true),
      })
      .strict(),
    events: z.array(
      z
        .object({
          eventId: z.string().min(1),
          triggerReasons: z.array(z.string().min(1)).min(1),
          globalAudioInterval: interval,
          verificationRequests: z.array(verificationRequestSchema).max(3),
          requestFamily: z.string().min(1),
          candidateOutputs: z.array(
            z
              .object({
                candidateId: z.string().min(1),
                requestIds: z.array(z.string().min(1)).min(1),
                text: z.string().min(1),
                textHash: sha256,
                normalizedTextHash: sha256,
                sourceGlobalInterval: interval,
                tokenEvidenceIds: z.array(z.string().min(1)),
                decoderEvidenceHash: sha256,
                lineageComplete: z.boolean(),
                semanticHash: sha256,
              })
              .strict(),
          ),
          stability: z.enum(["STRONG", "WEAK", "UNSTABLE", "NO_RESULT"]),
          resultingDecision: textVariantDecisionStatusSchema,
          selectedCandidateId: z.string().min(1).nullable(),
          cacheIdentity: sha256,
          semanticHash: sha256,
        })
        .strict(),
    ),
    summary: z
      .object({
        eligibleEventCount: count,
        triggeredEventCount: count,
        requestCount: count,
        cacheHitCount: count,
        inferenceCount: count,
        modelLoadCount: count,
        workerStartCount: count,
        stableResultEventCount: count,
        unstableResultEventCount: count,
        newCandidateCount: count,
        selectedNewCandidateCount: count,
        unresolvedAfterReasrCount: count,
        budgetExhaustedCount: count,
        promptIsolationPassed: z.boolean(),
        candidateTextPromptLeakCount: z.literal(0),
        humanMemoryLeakCount: z.literal(0),
        runtimeGoldInputCount: z.literal(0),
        networkUsed: z.literal(false),
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict();

export const machineTextReplacementContractSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("machine-text-replacement-contract"),
    records: z.array(
      z
        .object({
          replacementId: z.string().min(1),
          fromCandidateId: z.string().min(1),
          toCandidateId: z.string().min(1),
          eventId: z.string().min(1),
          evidenceTierBefore: z.enum(["NONE", "WEAK", "MEDIUM", "STRONG"]),
          evidenceTierAfter: z.enum(["NONE", "WEAK", "MEDIUM", "STRONG"]),
          acousticComparison: z.enum([
            "DOMINATES",
            "WEAKER",
            "INCOMPARABLE",
            "UNSCORABLE",
          ]),
          tokenComparison: z.enum([
            "MORE_SUPPORT",
            "SAME_SUPPORT",
            "LESS_SUPPORT",
            "CONFLICT",
            "UNAVAILABLE",
          ]),
          independentSupportBefore: count,
          independentSupportAfter: count,
          reason: z.string().min(1),
          accepted: z.boolean(),
          textSourceIsRealMachineCandidate: z.literal(true),
          freeRewriteUsed: z.literal(false),
          timingProposalId: z.string().min(1).nullable(),
          timingNonDegradationPassed: z.boolean(),
          semanticHash: sha256,
        })
        .strict(),
    ),
    summary: z
      .object({
        proposedCount: count,
        acceptedCount: count,
        rejectedCount: count,
        canonicalTextMutationCount: count,
        canonicalTimingMutationCount: count,
        presentationMutationCount: count,
        freeRewriteCount: z.literal(0),
        weakEvidenceReplacementCount: z.literal(0),
      })
      .strict(),
    beforeTextHash: sha256,
    afterTextHash: sha256,
    beforeTimingHash: sha256,
    afterTimingHash: sha256,
    presentationHash: sha256,
    semanticHash: sha256,
  })
  .strict();

export const c6014QualityMetricsSchema = z
  .object({
    cueCount: count,
    exactCer: z.number().nonnegative(),
    normalizedCer: z.number().nonnegative(),
    goldCoverage: ratio,
    missingCount: count,
    hallucinationCount: count,
    materialErrorCount: count,
    severeTimingErrorCount: count,
    startMaeSeconds: z.number().nonnegative(),
    endMaeSeconds: z.number().nonnegative(),
    p95BoundaryErrorSeconds: z.number().nonnegative(),
    medianTemporalIou: ratio,
    overlapPairCount: count,
    trustedMappedTokenCount: count,
    ambiguousTimeBaseTokenCount: count,
  })
  .strict();

export const c6014QualityPolicySchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-4-quality-policy"),
    vadGlobalTimebase: vadGlobalTimebaseModeSchema,
    textVariantVerifier: textVariantVerifierModeSchema,
    targetedEventReasr: targetedEventReasrModeSchema,
    runtimeGoldInputCount: z.literal(0),
    productionStatus: z.literal("needs-review"),
    finalizationMethod: z.literal("none"),
    machineOnlyReleaseAuthorized: z.literal(false),
    gates: z
      .object({
        minimumCoverage: z.literal(0.9),
        maximumMissing: z.literal(15),
        maximumHallucinations: z.literal(2),
        maximumMaterialErrors: z.literal(45),
        maximumSevereTimingErrors: z.literal(30),
        maximumNormalizedCer: z.literal(0.55),
        maximumStartMaeSeconds: z.literal(1.2),
        maximumEndMaeSeconds: z.literal(1.2),
        maximumP95BoundaryErrorSeconds: z.literal(3.5),
        maximumOverlapPairs: z.literal(20),
        minimumTrustedMappedTokens: z.literal(500),
        maximumAmbiguousTimeBaseTokens: z.literal(100),
        maximumRuntimeGoldInputCount: z.literal(0),
        maximumDatasetHardcodingCount: z.literal(0),
        maximumUnsafeFinalizationEscapeCount: z.literal(0),
      })
      .strict(),
    reAsrPolicy: z
      .object({
        maximumRequestsPerEvent: z.literal(3),
        episodeRequestBudget: z.number().int().positive(),
        candidateTextPromptAllowed: z.literal(false),
        humanMemoryPromptAllowed: z.literal(false),
        goldPromptAllowed: z.literal(false),
      })
      .strict(),
    artifactSemanticHashes: z.array(sha256).min(8),
    semanticHash: sha256,
  })
  .strict();

export const c6014AblationSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-4-ablation"),
    stages: z.array(
      z
        .object({
          id: z.enum([
            "V0",
            "V1",
            "V2",
            "V3",
            "V4",
            "V5",
            "V6",
            "V7",
            "full",
            "final-a",
            "final-b",
          ]),
          label: z.string().min(1),
          outputPath: z.string().min(1),
          outputFreezeHash: sha256.nullable(),
          metrics: c6014QualityMetricsSchema.nullable(),
          status: z.enum(["completed", "not-run", "failed"]),
          modelExecutionHash: sha256,
        })
        .strict(),
    ),
    semanticHash: sha256,
  })
  .strict();

export const c6014QualityComparisonSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-4-quality-comparison"),
    rawAsr: c6014QualityMetricsSchema,
    baseline: c6014QualityMetricsSchema,
    candidate: c6014QualityMetricsSchema,
    gateResults: z.record(z.string(), z.boolean()),
    selectorRecoveryPassed: z.boolean(),
    candidatePoolRecoveryPassed: z.boolean(),
    vadTimebaseRecoveryPassed: z.boolean(),
    tokenTimelineRecoveryPassed: z.boolean(),
    precisionRecoveryPassed: z.boolean(),
    timingRecoveryPassed: z.boolean(),
    coverageGuardPassed: z.boolean(),
    outcome: z.enum(["GO_C6_0_2", "HOLD_FOR_MORE_ACOUSTIC_TEXT_RECOVERY"]),
    semanticHash: sha256,
  })
  .strict();

export const c6014ValidationSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-4-validation"),
    branch: z.literal("codex/c6-0-1-4-vad-timebase-text-variant-reasr"),
    repositoryCommit: z.string().regex(/^[a-f0-9]{40}$/u),
    sourceMediaSha256: sha256,
    runtimeGoldInputCount: z.literal(0),
    datasetHardcodingFindingCount: z.literal(0),
    unsafeFinalizationEscapeCount: z.literal(0),
    checks: z.array(
      z
        .object({
          id: z.string().min(1),
          passed: z.boolean(),
          evidence: z.array(z.string().min(1)),
        })
        .strict(),
    ),
    finalABParity: z
      .object({
        text: z.boolean(),
        events: z.boolean(),
        variantDecisions: z.boolean(),
        reAsrTriggers: z.boolean(),
        timebase: z.boolean(),
        shadowOutcome: z.boolean(),
      })
      .strict(),
    productionStatus: z.literal("needs-review"),
    finalizationMethod: z.literal("none"),
    machineOnlyReleaseAuthorized: z.literal(false),
    outcome: z.enum(["GO_C6_0_2", "HOLD_FOR_MORE_ACOUSTIC_TEXT_RECOVERY"]),
    semanticHash: sha256,
  })
  .strict();

export type C6014Mode = z.infer<typeof c6014ModeSchema>;
export type SampleTransform = z.infer<typeof sampleTransformSchema>;
export type VadSegmentSampleMapping = z.infer<
  typeof vadSegmentSampleMappingSchema
>;
export type MachineVadGlobalTimebase = z.infer<
  typeof machineVadGlobalTimebaseSchema
>;
export type RequestTimelineV2Entry = z.infer<
  typeof requestTimelineV2EntrySchema
>;
export type AsrRequestTimelineContractV2 = z.infer<
  typeof asrRequestTimelineContractV2Schema
>;
export type GlobalTokenV2 = z.infer<typeof globalTokenV2Schema>;
export type MachineGlobalTokenTimelineV2 = z.infer<
  typeof machineGlobalTokenTimelineV2Schema
>;
export type MachineTextVariantOracleEvaluation = z.infer<
  typeof machineTextVariantOracleEvaluationSchema
>;
export type AcousticProjection = z.infer<typeof acousticProjectionSchema>;
export type CtcVariantEvidence = z.infer<typeof ctcVariantEvidenceSchema>;
export type MachineTextVariantAcousticVerification = z.infer<
  typeof machineTextVariantAcousticVerificationSchema
>;
export type MachineTextVariantDecision = z.infer<
  typeof machineTextVariantDecisionSchema
>;
export type MachineCandidatePoolSufficiency = z.infer<
  typeof machineCandidatePoolSufficiencySchema
>;
export type MachineTargetedEventReasr = z.infer<
  typeof machineTargetedEventReasrSchema
>;
export type MachineTextReplacementContract = z.infer<
  typeof machineTextReplacementContractSchema
>;
export type C6014QualityMetrics = z.infer<typeof c6014QualityMetricsSchema>;
export type C6014QualityPolicy = z.infer<typeof c6014QualityPolicySchema>;
export type C6014Ablation = z.infer<typeof c6014AblationSchema>;
export type C6014QualityComparison = z.infer<
  typeof c6014QualityComparisonSchema
>;
export type C6014Validation = z.infer<typeof c6014ValidationSchema>;
