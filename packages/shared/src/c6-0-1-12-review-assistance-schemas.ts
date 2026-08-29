import { z } from "zod";

export const c60112PolicyVersion =
  "c6.0.1.12-multi-asr-review-assistance-v2" as const;

const schemaVersion = z.literal("1.0.0");
const policyVersion = z.literal(c60112PolicyVersion);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const count = z.number().int().nonnegative();
const positiveCount = z.number().int().positive();
const finite = z.number();
const ratio = finite.min(0).max(1);
const cer = finite.nonnegative();
const timestamp = z.iso.datetime();

const artifactHeader = {
  schemaVersion,
  policyVersion,
  generatedAt: timestamp,
} as const;

const deterministicArtifactHeader = {
  schemaVersion,
  policyVersion,
} as const;

const intervalSchema = z
  .object({
    start: finite.nonnegative(),
    end: finite.positive(),
  })
  .strict()
  .refine((value) => value.end > value.start, {
    message: "Interval end must be greater than start.",
  });

const nullableIntervalSchema = intervalSchema.nullable();

const relativeArtifactPathSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !/^[A-Za-z]:[\\/]/u.test(value) &&
      !value.split(/[\\/]/u).includes("..") &&
      !value.includes("\0"),
    { message: "Artifact paths must be safe workspace-relative paths." },
  );

export const reviewItemTypeSchema = z.enum([
  "TEXT_CROSS_MODEL_DISAGREEMENT",
  "TEXT_WHISPER_INSTABILITY",
  "TEXT_REAZON_INSTABILITY",
  "TEXT_HALLUCINATION_RISK",
  "TEXT_LOW_ACOUSTIC_SUPPORT",
  "TEXT_PARTIAL_AGREEMENT",
  "MISSING_SPEECH_RISK",
  "TIMING_BOUNDARY_RISK",
  "TIMING_SEVERE_RISK",
  "OVERLAP_RISK",
  "MULTI_SPEAKER_RISK",
  "LOCALIZATION_RISK",
  "SPAN_LINEAGE_BLOCKED",
  "EVIDENCE_CONFLICT",
  "GENERAL_UNCERTAINTY",
]);

export const reviewReasonSchema = z.enum([
  "WHISPER_REAZON_LEXICAL_CONFLICT",
  "WHISPER_CORE_UNSTABLE",
  "REAZON_CORE_UNSTABLE",
  "WHISPER_HALLUCINATION_SIGNAL",
  "REAZON_HALLUCINATION_SIGNAL",
  "INDEPENDENT_ACOUSTIC_DISAGREEMENT",
  "INDEPENDENT_ACOUSTIC_LOW_MARGIN",
  "DECODER_WEAK",
  "SPEECH_INCOMPLETE",
  "REQUEST_EDGE_RISK",
  "TIMING_EVIDENCE_CONFLICT",
  "OVERLAP_UNRESOLVED",
  "SPEAKER_OVERLAP",
  "LOCALIZATION_AMBIGUOUS",
  "MISSING_DIALOGUE_SUSPECTED",
  "SPAN_LINEAGE_UNAVAILABLE",
  "MACHINE_EVIDENCE_INCOMPLETE",
]);

export const reviewPriorityTierSchema = z.enum([
  "CRITICAL",
  "HIGH",
  "MEDIUM",
  "LOW",
]);

export const reviewRequiredLevelSchema = z.enum([
  "REQUIRED",
  "RECOMMENDED",
  "INFORMATIONAL",
]);

export const reviewDecisionTypeSchema = z.enum([
  "KEEP_CURRENT",
  "USE_REAZON",
  "USE_WHISPER_ALTERNATE",
  "MANUAL_EDIT",
  "TIMING_EDIT",
  "ADD_NEW_CUE",
  "MARK_FALSE_POSITIVE",
  "UNRESOLVED",
  "WAIVE_REVIEW",
]);

export const reviewCandidateLabelSchema = z.enum([
  "CURRENT",
  "WHISPER",
  "WHISPER_ALT",
  "REAZON",
]);

export const reviewEvidenceBadgeSchema = z.enum([
  "STABLE",
  "CONTEXT_EXTENSION_ONLY",
  "LEXICALLY_UNSTABLE",
  "HALLUCINATION_RISK",
  "ACOUSTIC_FAVORED",
  "ACOUSTIC_DISFAVORED",
  "NEAR_TIE",
  "LOW_TOKEN_SUPPORT",
  "TIMING_UNCERTAIN",
  "LOCALIZATION_SAFE",
  "LOCALIZATION_AMBIGUOUS",
  "EVIDENCE_UNAVAILABLE",
]);

const machineReviewItemSchema = z
  .object({
    reviewItemId: z.string().min(1),
    eventIds: z.array(z.string().min(1)),
    finalCueIds: z.array(z.string().min(1)),
    itemTypes: z.array(reviewItemTypeSchema).min(1),
    sourceInterval: intervalSchema,
    coreInterval: intervalSchema,
    currentText: z.string().nullable(),
    candidateIds: z.array(z.string().min(1)),
    evidenceIds: z.array(z.string().min(1)),
    reviewReasons: z.array(reviewReasonSchema).min(1),
    priorityTier: reviewPriorityTierSchema,
    priorityScore: finite.min(0).max(100),
    requiredLevel: reviewRequiredLevelSchema,
    suggestedActions: z.array(reviewDecisionTypeSchema).min(1),
    sceneIds: z.array(z.string().min(1)),
    speakerGroupIds: z.array(z.string().min(1)),
    semanticHash: sha256,
  })
  .strict()
  .superRefine((value, context) => {
    const missing = value.itemTypes.includes("MISSING_SPEECH_RISK");
    if (!missing && value.finalCueIds.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["finalCueIds"],
        message: "Only missing-dialogue review items may omit final cue IDs.",
      });
    }
    if (missing && !value.suggestedActions.includes("ADD_NEW_CUE")) {
      context.addIssue({
        code: "custom",
        path: ["suggestedActions"],
        message: "Missing-dialogue items must offer ADD_NEW_CUE.",
      });
    }
  });

export const machineReviewItemsSchema = z
  .object({
    ...deterministicArtifactHeader,
    artifactType: z.literal("c6-0-1-12-machine-review-items"),
    policyHash: sha256,
    sourceTimebase: z.literal("SOURCE_GLOBAL_SECONDS"),
    runtimeGoldInputCount: z.literal(0),
    items: z.array(machineReviewItemSchema),
    summary: z
      .object({
        itemCount: count,
        signalCount: count,
        multiLabelItemCount: count,
        orphanItemCount: count,
        requiredItemCount: count,
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.summary.itemCount !== value.items.length) {
      context.addIssue({
        code: "custom",
        path: ["summary", "itemCount"],
        message: "Item summary count must match the item array.",
      });
    }
  });

const rankedReviewItemSchema = z
  .object({
    reviewItemId: z.string().min(1),
    sourceStart: finite.nonnegative(),
    itemTypes: z.array(reviewItemTypeSchema).min(1),
    reviewReasons: z.array(reviewReasonSchema).min(1),
    priorityTier: reviewPriorityTierSchema,
    priorityScore: finite.min(0).max(100),
    requiredLevel: reviewRequiredLevelSchema,
    scoreComponents: z
      .object({
        taxonomyRisk: finite.min(0).max(100),
        multiLabelBoost: finite.min(0).max(100),
        compoundRiskBoost: finite.min(0).max(100),
        evidenceBreadthBoost: finite.min(0).max(100),
      })
      .strict(),
    explanationCodes: z.array(z.string().min(1)),
    semanticHash: sha256,
  })
  .strict();

export const machineReviewPrioritySchema = z
  .object({
    ...deterministicArtifactHeader,
    artifactType: z.literal("c6-0-1-12-machine-review-priority"),
    policyHash: sha256,
    entries: z.array(rankedReviewItemSchema),
    semanticHash: sha256,
  })
  .strict();

const machineReviewRegionSchema = z
  .object({
    regionId: z.string().min(1),
    reviewItemIds: z.array(z.string().min(1)).min(1),
    eventIds: z.array(z.string().min(1)).min(1),
    finalCueIds: z.array(z.string().min(1)),
    contextStart: finite.nonnegative(),
    contextEnd: finite.positive(),
    coreIntervals: z
      .array(
        z
          .object({
            reviewItemId: z.string().min(1),
            start: finite.nonnegative(),
            end: finite.positive(),
          })
          .strict()
          .refine((value) => value.end > value.start, {
            message: "Core interval end must be greater than start.",
          }),
      )
      .min(1),
    maxPriority: z
      .object({
        tier: reviewPriorityTierSchema,
        score: finite.min(0).max(100),
      })
      .strict(),
    aggregateReasons: z.array(reviewReasonSchema).min(1),
    itemTypes: z.array(reviewItemTypeSchema).min(1),
    requiredLevel: reviewRequiredLevelSchema,
    sceneIds: z.array(z.string().min(1)),
    speakerGroupIds: z.array(z.string().min(1)),
    semanticHash: sha256,
  })
  .strict()
  .refine((value) => value.contextEnd > value.contextStart, {
    path: ["contextEnd"],
    message: "Region context end must be greater than its start.",
  });

export const machineReviewRegionsSchema = z
  .object({
    ...deterministicArtifactHeader,
    artifactType: z.literal("c6-0-1-12-machine-review-regions"),
    policyHash: sha256,
    sourceTimebase: z.literal("SOURCE_GLOBAL_SECONDS"),
    runtimeGoldInputCount: z.literal(0),
    regions: z.array(machineReviewRegionSchema),
    summary: z
      .object({
        regionCount: count,
        itemCount: count,
        mergedItemCount: count,
        requiredRegionCount: count,
        totalContextAudioSeconds: finite.nonnegative(),
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.summary.regionCount !== value.regions.length) {
      context.addIssue({
        code: "custom",
        path: ["summary", "regionCount"],
        message: "Region summary count must match the region array.",
      });
    }
  });

const reviewCandidateProvenanceSchema = z
  .object({
    candidateId: z.string().min(1),
    label: reviewCandidateLabelSchema,
    sourceInterval: nullableIntervalSchema,
    evidenceIds: z.array(z.string().min(1)),
    provenanceIds: z.array(z.string().min(1)),
    evidenceBadges: z.array(reviewEvidenceBadgeSchema),
  })
  .strict();

const displayCandidateSchema = z
  .object({
    displayCandidateId: z.string().min(1),
    displayText: z.string().min(1),
    normalizedTextHash: sha256,
    labels: z.array(reviewCandidateLabelSchema).min(1),
    evidenceBadges: z.array(reviewEvidenceBadgeSchema),
    provenance: z.array(reviewCandidateProvenanceSchema).min(1),
    semanticHash: sha256,
  })
  .strict();

const reviewCandidateBundleSchema = z
  .object({
    reviewItemId: z.string().min(1),
    displayCandidates: z.array(displayCandidateSchema),
    missingCandidateIds: z.array(z.string().min(1)),
    availableActions: z.array(reviewDecisionTypeSchema).min(1),
    selectionAuthority: z.literal("HUMAN_ONLY"),
    calibratedConfidencePercentageDisplayed: z.literal(false),
    semanticHash: sha256,
  })
  .strict();

export const machineReviewCandidateBundlesSchema = z
  .object({
    ...deterministicArtifactHeader,
    artifactType: z.literal("c6-0-1-12-machine-review-candidate-bundles"),
    policyHash: sha256,
    runtimeGoldInputCount: z.literal(0),
    bundles: z.array(reviewCandidateBundleSchema),
    summary: z
      .object({
        reviewItemCount: count,
        displayCandidateCount: count,
        collapsedDuplicateCount: count,
        missingCandidateReferenceCount: count,
        candidateActionableItemCount: count,
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.summary.reviewItemCount !== value.bundles.length) {
      context.addIssue({
        code: "custom",
        path: ["summary", "reviewItemCount"],
        message: "Review item count must match the bundle array.",
      });
    }
  });

const reviewAudioEntrySchema = z
  .object({
    regionId: z.string().min(1),
    itemIds: z.array(z.string().min(1)).min(1),
    relativePath: relativeArtifactPathSchema,
    requestedInterval: intervalSchema,
    extractedInterval: intervalSchema,
    coreInterval: intervalSchema,
    coreOffsetSeconds: finite.nonnegative(),
    coreDurationSeconds: finite.positive(),
    actualDurationSeconds: finite.positive(),
    sampleRate: z.literal(16000),
    channelCount: z.literal(1),
    bitsPerSample: z.literal(16),
    frameCount: positiveCount,
    sha256,
    playable: z.literal(true),
    sourceMediaSha256: sha256,
  })
  .strict();

export const machineReviewAudioManifestSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-12-review-audio-manifest"),
    sourceMediaSha256: sha256,
    extractionPolicy: z.literal(
      "region-core-plus-two-second-context-pcm-s16le-16khz-mono-v1",
    ),
    ffmpegIdentity: z.string().min(1),
    clips: z.array(reviewAudioEntrySchema),
    summary: z
      .object({
        regionCount: count,
        generatedCount: count,
        playableCount: count,
        failedCount: z.literal(0),
        totalAudioSeconds: finite.nonnegative(),
        asrInferenceCount: z.literal(0),
        networkUsed: z.literal(false),
      })
      .strict(),
    semanticHash: sha256,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.summary.generatedCount !== value.clips.length) {
      context.addIssue({
        code: "custom",
        path: ["summary", "generatedCount"],
        message: "Generated count must match the audio clip array.",
      });
    }
    if (
      value.summary.regionCount !== value.summary.generatedCount ||
      value.summary.playableCount !== value.summary.generatedCount
    ) {
      context.addIssue({
        code: "custom",
        path: ["summary"],
        message: "Every planned review region must have playable audio.",
      });
    }
  });

export const c60112ReviewPackageFreezeSchema = z
  .object({
    ...deterministicArtifactHeader,
    artifactType: z.literal("c6-0-1-12-review-package-freeze"),
    frozenAt: timestamp,
    sourceMediaSha256: sha256,
    machineDraftHash: sha256,
    itemHash: sha256,
    priorityHash: sha256,
    regionHash: sha256,
    candidateHash: sha256,
    audioManifestHash: sha256,
    workspaceDataHash: sha256,
    policyHash: sha256,
    aggregateHash: sha256,
    runtimeGoldInputCount: z.literal(0),
    goldAccessBeforeFreezeCount: z.literal(0),
    frozenBeforeGoldEvaluation: z.literal(true),
    semanticHash: sha256,
  })
  .strict();

const reviewDecisionNewCueSchema = z
  .object({
    cueId: z.string().min(1),
    text: z.string().min(1),
    start: finite.nonnegative(),
    end: finite.positive(),
  })
  .strict()
  .refine((value) => value.end > value.start, {
    path: ["end"],
    message: "New cue end must be greater than start.",
  });

export const reviewDecisionSchema = z
  .object({
    decisionType: reviewDecisionTypeSchema,
    selectedCandidateId: z.string().min(1).nullable(),
    manualText: z.string().min(1).nullable(),
    timing: nullableIntervalSchema,
    newCue: reviewDecisionNewCueSchema.nullable(),
    reviewerNote: z.string().min(1).nullable(),
    candidateSetHash: sha256,
    evidenceSnapshotHash: sha256,
    decidedAt: timestamp,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      ["USE_REAZON", "USE_WHISPER_ALTERNATE"].includes(value.decisionType) &&
      value.selectedCandidateId === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["selectedCandidateId"],
        message: "Candidate-selection decisions require an exact candidate ID.",
      });
    }
    if (value.decisionType === "MANUAL_EDIT" && value.manualText === null) {
      context.addIssue({
        code: "custom",
        path: ["manualText"],
        message: "MANUAL_EDIT requires replacement text.",
      });
    }
    if (value.decisionType === "TIMING_EDIT" && value.timing === null) {
      context.addIssue({
        code: "custom",
        path: ["timing"],
        message: "TIMING_EDIT requires a valid interval.",
      });
    }
    if (value.decisionType === "ADD_NEW_CUE" && value.newCue === null) {
      context.addIssue({
        code: "custom",
        path: ["newCue"],
        message: "ADD_NEW_CUE requires complete new cue data.",
      });
    }
    if (value.decisionType === "WAIVE_REVIEW" && value.reviewerNote === null) {
      context.addIssue({
        code: "custom",
        path: ["reviewerNote"],
        message: "WAIVE_REVIEW requires an explicit reviewer note.",
      });
    }
  });

const reviewSessionItemStateSchema = z
  .object({
    recordId: z.string().min(1),
    decisionId: z.string().min(1),
    decisionType: reviewDecisionTypeSchema,
    selectedCandidateId: z.string().min(1).nullable(),
    afterText: z.string().min(1).nullable(),
    afterStart: finite.nonnegative().nullable(),
    afterEnd: finite.positive().nullable(),
    reviewerNote: z.string().min(1).nullable(),
    updatedAt: timestamp,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      ["USE_REAZON", "USE_WHISPER_ALTERNATE"].includes(value.decisionType) &&
      value.selectedCandidateId === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["selectedCandidateId"],
        message: "Candidate decisions require a selected candidate ID.",
      });
    }
    if (value.decisionType === "MANUAL_EDIT" && value.afterText === null) {
      context.addIssue({
        code: "custom",
        path: ["afterText"],
        message: "MANUAL_EDIT requires replacement text.",
      });
    }
    if (
      ["TIMING_EDIT", "ADD_NEW_CUE"].includes(value.decisionType) &&
      (value.afterStart === null ||
        value.afterEnd === null ||
        value.afterEnd <= value.afterStart)
    ) {
      context.addIssue({
        code: "custom",
        path: ["afterEnd"],
        message: "Timing decisions require valid replacement timestamps.",
      });
    }
    if (value.decisionType === "ADD_NEW_CUE" && value.afterText === null) {
      context.addIssue({
        code: "custom",
        path: ["afterText"],
        message: "ADD_NEW_CUE requires replacement text.",
      });
    }
    if (value.decisionType === "WAIVE_REVIEW" && value.reviewerNote === null) {
      context.addIssue({
        code: "custom",
        path: ["reviewerNote"],
        message: "WAIVE_REVIEW requires an explicit reviewer note.",
      });
    }
  });

const reviewSessionRegionStateSchema = z
  .object({
    requiredItemCount: count,
    completedRequiredCount: count,
    unresolvedRequiredCount: count,
    complete: z.boolean(),
  })
  .strict();

export const reviewSessionSchema = z
  .object({
    schemaVersion,
    sessionId: z.string().min(1),
    sourceMediaIdentity: z.record(z.string().min(1), z.unknown()),
    machineDraftIdentity: z.record(z.string().min(1), z.unknown()),
    machineDraftHash: sha256,
    reviewPolicyVersion: policyVersion,
    reviewPackageSemanticHash: sha256,
    createdAt: timestamp,
    updatedAt: timestamp,
    itemStates: z.record(z.string().min(1), reviewSessionItemStateSchema),
    regionStates: z.record(z.string().min(1), reviewSessionRegionStateSchema),
    completedRequiredCount: count,
    unresolvedRequiredCount: count,
    reviewComplete: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    const regionStates = Object.values(value.regionStates);
    if (regionStates.length > 0) {
      const regionCompleted = regionStates.reduce(
        (sum, state) => sum + state.completedRequiredCount,
        0,
      );
      const regionUnresolved = regionStates.reduce(
        (sum, state) => sum + state.unresolvedRequiredCount,
        0,
      );
      if (
        regionCompleted !== value.completedRequiredCount ||
        regionUnresolved !== value.unresolvedRequiredCount
      ) {
        context.addIssue({
          code: "custom",
          path: ["regionStates"],
          message:
            "Region completion totals must match the REQUIRED session totals.",
        });
      }
    }
    if (value.reviewComplete !== (value.unresolvedRequiredCount === 0)) {
      context.addIssue({
        code: "custom",
        path: ["reviewComplete"],
        message:
          "Review is complete only after every REQUIRED item is resolved or waived.",
      });
    }
  });

export const reviewAuditRecordSchema = z
  .object({
    schemaVersion,
    auditId: z.string().min(1),
    operation: z.enum(["DECISION", "UNDO"]),
    timestamp,
    sessionId: z.string().min(1),
    reviewItemId: z.string().min(1),
    previousDecision: z.string().min(1).nullable(),
    newDecision: z.string().min(1).nullable(),
    undoneRecordId: z.string().min(1).nullable(),
    beforeHash: sha256,
    afterHash: sha256,
  })
  .strict();

export const humanCorrectionRecordSchema = z
  .object({
    schemaVersion,
    recordId: z.string().min(1),
    decisionId: z.string().min(1),
    sessionId: z.string().min(1),
    reviewItemId: z.string().min(1),
    regionId: z.string().min(1),
    eventIds: z.array(z.string().min(1)),
    cueIds: z.array(z.string().min(1)),
    sourceInterval: intervalSchema,
    machineDraftHash: sha256,
    evidenceSnapshotHash: sha256,
    candidateSetHash: sha256,
    decisionType: reviewDecisionTypeSchema,
    selectedCandidateId: z.string().min(1).nullable(),
    beforeText: z.string().nullable(),
    afterText: z.string().nullable(),
    beforeStart: finite.nonnegative().nullable(),
    beforeEnd: finite.positive().nullable(),
    afterStart: finite.nonnegative().nullable(),
    afterEnd: finite.positive().nullable(),
    itemTypes: z.array(reviewItemTypeSchema).min(1),
    priorityAtDecision: z
      .object({
        tier: reviewPriorityTierSchema,
        score: finite.min(0).max(100),
        requiredLevel: reviewRequiredLevelSchema,
      })
      .strict(),
    reviewerNote: z.string().min(1).nullable(),
    createdAt: timestamp,
  })
  .strict()
  .superRefine((value, context) => {
    for (const [prefix, start, end] of [
      ["before", value.beforeStart, value.beforeEnd],
      ["after", value.afterStart, value.afterEnd],
    ] as const) {
      if (
        (start === null) !== (end === null) ||
        (start !== null && end !== null && end <= start)
      ) {
        context.addIssue({
          code: "custom",
          path: [`${prefix}End`],
          message:
            "Correction timestamps must be absent together or form a valid interval.",
        });
      }
    }
    if (
      ["USE_REAZON", "USE_WHISPER_ALTERNATE"].includes(value.decisionType) &&
      value.selectedCandidateId === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["selectedCandidateId"],
        message: "Candidate decisions must bind the selected candidate ID.",
      });
    }
    if (
      value.decisionType === "ADD_NEW_CUE" &&
      (value.afterText === null ||
        value.afterStart === null ||
        value.afterEnd === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["afterText"],
        message: "ADD_NEW_CUE requires text and timestamps.",
      });
    }
    if (value.decisionType === "MANUAL_EDIT" && value.afterText === null) {
      context.addIssue({
        code: "custom",
        path: ["afterText"],
        message: "MANUAL_EDIT requires replacement text.",
      });
    }
    if (
      value.decisionType === "TIMING_EDIT" &&
      (value.afterStart === null || value.afterEnd === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["afterStart"],
        message: "TIMING_EDIT requires replacement timestamps.",
      });
    }
    if (value.decisionType === "WAIVE_REVIEW" && value.reviewerNote === null) {
      context.addIssue({
        code: "custom",
        path: ["reviewerNote"],
        message: "WAIVE_REVIEW requires an explicit reviewer note.",
      });
    }
  });

const reviewDecisionCountsSchema = z
  .object({
    KEEP_CURRENT: count,
    USE_REAZON: count,
    USE_WHISPER_ALTERNATE: count,
    MANUAL_EDIT: count,
    TIMING_EDIT: count,
    ADD_NEW_CUE: count,
    MARK_FALSE_POSITIVE: count,
    UNRESOLVED: count,
    WAIVE_REVIEW: count,
  })
  .strict();

export const humanReviewManifestSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("human-review-manifest"),
    sessionId: z.string().min(1),
    machineDraftHash: sha256,
    reviewSessionHash: sha256,
    correctionLogHash: sha256,
    reviewedSubtitlePackageHash: sha256,
    reviewedAssHash: sha256,
    reviewedSrtHash: sha256,
    reviewedVttHash: sha256,
    textChangedCueCount: count,
    timingChangedCueCount: count,
    newCueCount: count,
    decisionCounts: reviewDecisionCountsSchema,
    unresolvedCount: count,
    strictSubtitlePackageValidated: z.literal(true),
    machineOnlyReleaseAuthorized: z.literal(false),
    semanticHash: sha256,
  })
  .strict();

export const correctionDatasetSummarySchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("correction-dataset-summary"),
    locality: z.literal("LOCAL_ONLY"),
    shareable: z.literal(false),
    sourceCorrectionLogHash: sha256,
    datasetJsonlHash: sha256,
    recordCount: count,
    uniqueSessionCount: count,
    uniqueReviewItemCount: count,
    decisionCounts: reviewDecisionCountsSchema,
    containsFullDialogueText: z.literal(true),
    trainingPerformed: z.literal(false),
    semanticHash: sha256,
  })
  .strict();

const reviewErrorComponentLabelSchema = z.enum([
  "MATERIAL_TEXT_ERROR",
  "HALLUCINATION",
  "MISSING_DIALOGUE",
  "SEVERE_TIMING_ERROR",
  "OVERLAP_ERROR",
]);

export const reviewGoldErrorLabelSchema = z.enum([
  ...reviewErrorComponentLabelSchema.options,
  "CLEAN_OR_MINOR",
]);

export const reviewBudgetSchema = z.enum([
  "TOP_10_PERCENT",
  "TOP_20_PERCENT",
  "TOP_30_PERCENT",
  "TOP_40_PERCENT",
  "TOP_50_PERCENT",
  "ALL_REQUIRED",
]);

const uniqueErrorCountsSchema = z
  .object({
    materialText: count,
    severeTiming: count,
    hallucination: count,
    missingDialogue: count,
    overlap: count,
  })
  .strict();

const reviewBudgetMetricsSchema = z
  .object({
    budget: reviewBudgetSchema,
    selectedReviewItemCount: count,
    selectedRegionCount: count,
    selectedAudioSeconds: finite.nonnegative(),
    coveredUniqueErrors: uniqueErrorCountsSchema,
    materialRecall: ratio,
    severeTimingRecall: ratio,
    hallucinationRecall: ratio,
    missingDialogueRecall: ratio,
    reviewItemPrecision: ratio,
    regionErrorRecall: ratio,
    unreviewedResidualErrorRate: ratio,
    residualExactCer: cer,
    residualNormalizedCer: cer,
    residualMaterialErrors: count,
    residualSevereTiming: count,
    residualMissing: count,
    residualHallucination: count,
  })
  .strict();

const reviewErrorComponentSchema = z
  .object({
    errorComponentId: z.string().min(1),
    labels: z.array(reviewErrorComponentLabelSchema).min(1),
    coveredReviewItemIds: z.array(z.string().min(1)),
    coveredRegionIds: z.array(z.string().min(1)),
    semanticHash: sha256,
  })
  .strict();

export const reviewCandidateFixabilitySchema = z.enum([
  "CURRENT_ALREADY_CORRECT",
  "WHISPER_ALT_FIXABLE",
  "REAZON_FIXABLE",
  "BOTH_CANDIDATE_FIXABLE",
  "CANDIDATE_PARTIAL_FIX",
  "MANUAL_EDIT_REQUIRED",
  "UNEVALUABLE",
]);

const candidateFixabilityRecordSchema = z
  .object({
    reviewItemId: z.string().min(1),
    errorComponentIds: z.array(z.string().min(1)).min(1),
    classification: reviewCandidateFixabilitySchema,
    fullFixCandidateIds: z.array(z.string().min(1)),
    partialFixCandidateIds: z.array(z.string().min(1)),
    semanticHash: sha256,
  })
  .strict();

const materialErrorFixabilityRecordSchema = z
  .object({
    errorComponentId: z.string().min(1),
    reviewItemIds: z.array(z.string().min(1)),
    classification: reviewCandidateFixabilitySchema,
    fullFixCandidateIds: z.array(z.string().min(1)),
    partialFixCandidateIds: z.array(z.string().min(1)),
    semanticHash: sha256,
  })
  .strict();

const candidateFixabilitySummarySchema = z
  .object({
    materialErrorCount: count,
    candidateFixableMaterialErrorCount: count,
    candidateFixRate: ratio,
    whisperAlternateFixableCount: count,
    reazonFixableCount: count,
    bothCandidateFixableCount: count,
    partialFixCount: count,
    manualEditRequiredCount: count,
    manualEditRate: ratio,
    unevaluableCount: count,
  })
  .strict();

export const reviewRankingBaselineSchema = z.enum([
  "R0_CHRONOLOGICAL",
  "R1_OLD_SINGLE_ASR_RISK",
  "R2_CROSS_MODEL_DISAGREEMENT_ONLY",
  "R3_FULL_EVIDENCE_RANK",
]);

const rankingBaselineEvaluationSchema = z
  .object({
    baseline: reviewRankingBaselineSchema,
    budgetMetrics: z.array(reviewBudgetMetricsSchema).min(1),
    audioMatchedBudgetMetrics: z.array(reviewBudgetMetricsSchema).min(1),
    utilityScore: finite,
  })
  .strict();

export const reviewRankingResultSchema = z.enum([
  "REVIEW_PRIORITY_EFFECTIVE",
  "REVIEW_PRIORITY_WEAK",
  "REVIEW_PRIORITY_NOT_EFFECTIVE",
]);

const c60112DetailedReviewQualityEvaluationSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-12-review-quality-evaluation"),
    reviewPackageFreezeHash: sha256,
    reviewPackageFreezeVerifiedBeforeGoldRead: z.literal(true),
    reviewPackageFrozenBeforeGoldRead: z.literal(true),
    machineReviewBuildGoldInputCount: z.literal(0),
    evaluatorGoldInputCount: z.literal(1),
    goldReadAfterFreeze: z.literal(true),
    sourceSha256Before: sha256,
    sourceSha256After: sha256,
    goldSha256Before: sha256,
    goldSha256After: sha256,
    goldEvaluationArtifactSha256: sha256,
    machineDraftHash: sha256,
    machineFinalMutated: z.literal(false),
    idealSimulationMethod: z.literal(
      "GLOBAL_TEXT_RECOMPUTATION_WITH_SELECTED_GOLD_ALIGNMENTS",
    ),
    rankingInputHashes: z
      .object({
        oldSingleAsrRiskArtifactSha256: sha256,
      })
      .strict(),
    overlapEvaluation: z
      .object({
        status: z.literal("UNEVALUABLE_GLOBAL_ONLY"),
        machineOverlapCount: count,
        goldOverlapCount: count,
        reason: z.string().min(1),
      })
      .strict(),
    uniqueErrorCounts: uniqueErrorCountsSchema,
    errorComponents: z.array(reviewErrorComponentSchema),
    itemLabels: z.array(
      z
        .object({
          reviewItemId: z.string().min(1),
          labels: z.array(reviewGoldErrorLabelSchema).min(1),
          errorComponentIds: z.array(z.string().min(1)),
        })
        .strict(),
    ),
    budgetMetrics: z.array(reviewBudgetMetricsSchema).min(1),
    rankingBaselines: z.array(rankingBaselineEvaluationSchema).min(4),
    rankingResult: reviewRankingResultSchema,
    candidateFixability: z.array(candidateFixabilityRecordSchema),
    materialErrorFixability: z.array(materialErrorFixabilityRecordSchema),
    candidateFixabilitySummary: candidateFixabilitySummarySchema,
    specialErrorRanks: z.array(
      z
        .object({
          errorComponentId: z.string().min(1),
          label: z.enum(["HALLUCINATION", "MISSING_DIALOGUE"]),
          queueCaptured: z.boolean(),
          rankPositions: z.record(
            reviewRankingBaselineSchema,
            positiveCount.nullable(),
          ),
        })
        .strict(),
    ),
    burden: z
      .object({
        totalReviewItems: count,
        requiredItems: count,
        totalReviewRegions: count,
        requiredRegions: count,
        totalReviewAudioSeconds: finite.nonnegative(),
        requiredReviewAudioSeconds: finite.nonnegative(),
        reviewAudioEpisodeRatio: finite.nonnegative(),
        candidateActionableItems: count,
        manualEditLikelyItems: count,
        humanReviewTimeStatus: z.literal("NOT_MEASURED_IN_C6_0_1_12"),
      })
      .strict(),
    containsFullGoldText: z.literal(false),
    semanticHash: sha256,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.sourceSha256Before !== value.sourceSha256After) {
      context.addIssue({
        code: "custom",
        path: ["sourceSha256After"],
        message: "The source media must remain read-only during evaluation.",
      });
    }
    if (value.goldSha256Before !== value.goldSha256After) {
      context.addIssue({
        code: "custom",
        path: ["goldSha256After"],
        message: "Gold must remain read-only during evaluation.",
      });
    }
    const errorIds = value.errorComponents.map(
      (component) => component.errorComponentId,
    );
    if (new Set(errorIds).size !== errorIds.length) {
      context.addIssue({
        code: "custom",
        path: ["errorComponents"],
        message: "Gold error components must have unique identities.",
      });
    }
    const expectedBudgets = new Set(reviewBudgetSchema.options);
    const verifyBudgets = (
      values: readonly { budget: z.infer<typeof reviewBudgetSchema> }[],
      path: (string | number)[],
    ): void => {
      const actual = values.map((entry) => entry.budget);
      if (
        actual.length !== expectedBudgets.size ||
        new Set(actual).size !== actual.length ||
        [...expectedBudgets].some((budget) => !actual.includes(budget))
      ) {
        context.addIssue({
          code: "custom",
          path,
          message: "Every review budget must appear exactly once.",
        });
      }
    };
    verifyBudgets(value.budgetMetrics, ["budgetMetrics"]);
    const expectedRankings = new Set(reviewRankingBaselineSchema.options);
    const actualRankings = value.rankingBaselines.map(
      (baseline) => baseline.baseline,
    );
    if (
      actualRankings.length !== expectedRankings.size ||
      new Set(actualRankings).size !== actualRankings.length ||
      [...expectedRankings].some(
        (baseline) => !actualRankings.includes(baseline),
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["rankingBaselines"],
        message: "Every ranking baseline must appear exactly once.",
      });
    }
    value.rankingBaselines.forEach((baseline, index) => {
      verifyBudgets(baseline.budgetMetrics, [
        "rankingBaselines",
        index,
        "budgetMetrics",
      ]);
      verifyBudgets(baseline.audioMatchedBudgetMetrics, [
        "rankingBaselines",
        index,
        "audioMatchedBudgetMetrics",
      ]);
    });
  });

export const c60112ReviewQualityEvaluationSchema =
  c60112DetailedReviewQualityEvaluationSchema;

const idealReviewBudgetResultSchema = z
  .object({
    budget: reviewBudgetSchema,
    selectedReviewItems: count,
    selectedRegions: count,
    audioSeconds: finite.nonnegative(),
    residualExactCer: cer,
    residualNormalizedCer: cer,
    residualMaterialErrors: count,
    residualSevereTiming: count,
    residualMissing: count,
    residualHallucination: count,
  })
  .strict();

export const c60112IdealReviewUpperBoundSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-12-ideal-review-upper-bound"),
    simulationType: z.literal("IDEAL_REVIEWER_SIMULATION"),
    simulationMethod: z.literal(
      "GLOBAL_TEXT_RECOMPUTATION_WITH_SELECTED_GOLD_ALIGNMENTS",
    ),
    reviewPackageFreezeHash: sha256,
    qualityEvaluationHash: sha256,
    reviewPackageFreezeVerifiedBeforeGoldRead: z.literal(true),
    evaluatorGoldInputCount: z.literal(1),
    budgetResults: z.array(idealReviewBudgetResultSchema).min(1),
    humanReviewSessionCreated: z.literal(false),
    humanCorrectionLogCreated: z.literal(false),
    humanReviewedProductionOutputCreated: z.literal(false),
    machineFinalMutated: z.literal(false),
    semanticHash: sha256,
  })
  .strict()
  .superRefine((value, context) => {
    const expected = new Set(reviewBudgetSchema.options);
    const actual = value.budgetResults.map((result) => result.budget);
    if (
      actual.length !== expected.size ||
      new Set(actual).size !== actual.length ||
      [...expected].some((budget) => !actual.includes(budget))
    ) {
      context.addIssue({
        code: "custom",
        path: ["budgetResults"],
        message: "Every ideal-review budget must appear exactly once.",
      });
    }
  });

export const reviewProductRouteDecisionSchema = z.enum([
  "REVIEW_ASSISTANCE_PRODUCT_READY_FOR_REAL_HUMAN_TRIAL",
  "REVIEW_ASSISTANCE_ENGINEERING_READY_RANKING_WEAK",
  "REVIEW_ASSISTANCE_DATA_GAPS",
  "REVIEW_ASSISTANCE_NOT_READY",
]);

const c60112BuilderRouteDecisionSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-12-route-decision"),
    route: z.literal("HUMAN_ON_EXCEPTION"),
    nextStage: z.enum([
      "REAL_HUMAN_TRIAL_ON_UNSEEN_EPISODE",
      "IMPROVE_REVIEW_RANKING",
      "REPAIR_DATA_GAPS",
    ]),
    result: reviewProductRouteDecisionSchema,
    engineeringComplete: z.boolean(),
    rankingEffective: z.boolean(),
    realHumanTrialAuthorized: z.boolean(),
    workloadReductionClaimAllowed: z.boolean(),
    automaticProviderSwitching: z.literal(false),
    carnationHumanSessionCreated: z.literal(false),
    productionStatus: z.literal("needs-review"),
    finalizationMethod: z.literal("none"),
    machineOnlyReleaseAuthorized: z.literal(false),
    c602Status: z.literal("HOLD"),
    reasons: z.array(z.string().min(1)).min(1),
    semanticHash: sha256,
  })
  .strict()
  .superRefine((value, context) => {
    const expectedResult = !value.engineeringComplete
      ? value.result === "REVIEW_ASSISTANCE_DATA_GAPS"
        ? "REVIEW_ASSISTANCE_DATA_GAPS"
        : "REVIEW_ASSISTANCE_NOT_READY"
      : value.rankingEffective
        ? "REVIEW_ASSISTANCE_PRODUCT_READY_FOR_REAL_HUMAN_TRIAL"
        : "REVIEW_ASSISTANCE_ENGINEERING_READY_RANKING_WEAK";
    if (value.result !== expectedResult) {
      context.addIssue({
        code: "custom",
        path: ["result"],
        message: "Route result is inconsistent with engineering/ranking state.",
      });
    }
    if (value.realHumanTrialAuthorized !== value.engineeringComplete) {
      context.addIssue({
        code: "custom",
        path: ["realHumanTrialAuthorized"],
        message: "A real unseen-episode trial requires engineering completion.",
      });
    }
    if (
      value.workloadReductionClaimAllowed !==
      (value.engineeringComplete && value.rankingEffective)
    ) {
      context.addIssue({
        code: "custom",
        path: ["workloadReductionClaimAllowed"],
        message:
          "A workload-reduction claim requires complete engineering and effective ranking.",
      });
    }
    const trialStage = value.nextStage === "REAL_HUMAN_TRIAL_ON_UNSEEN_EPISODE";
    if (trialStage !== value.realHumanTrialAuthorized) {
      context.addIssue({
        code: "custom",
        path: ["nextStage"],
        message: "The next stage must match real-human-trial authorization.",
      });
    }
  });

export const c60112RouteDecisionSchema = c60112BuilderRouteDecisionSchema;

const validationCheckSchema = z
  .object({
    checkId: z.string().min(1),
    status: z.enum(["PASSED", "FAILED", "SKIPPED"]),
    evidenceHashes: z.array(sha256),
    detail: z.string().min(1),
  })
  .strict();

export const c60112ReviewAssistanceValidationSchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-12-review-assistance-validation"),
    validationVersion: z.literal("c6.0.1.12-review-assistance-validation-v2"),
    inputArtifactHashes: z.record(z.string().min(1), sha256),
    outputArtifactHashes: z.record(z.string().min(1), sha256),
    checks: z.array(validationCheckSchema).min(1),
    machineFinalParity: z
      .object({
        canonicalTextParity: z.boolean(),
        canonicalTimingParity: z.boolean(),
        assParity: z.boolean(),
        srtParity: z.boolean(),
        vttParity: z.boolean(),
        textMutationCount: count,
        timingMutationCount: count,
      })
      .strict(),
    goldIsolation: z
      .object({
        reviewPackageFrozenBeforeGold: z.boolean(),
        machineReviewBuildGoldInputCount: count,
        workspaceGoldInputCount: count,
        syntheticWorkflowGoldInputCount: count,
        evaluatorGoldInputCount: count,
      })
      .strict(),
    reviewWorkspaceOffline: z.boolean(),
    reviewWorkspaceLocalOnly: z.boolean(),
    reviewAudioLocalOnly: z.boolean(),
    realCarnationHumanSessionCreated: z.boolean(),
    sourceReadOnlyVerified: z.boolean(),
    goldReadOnlyVerified: z.boolean(),
    networkUsed: z.boolean(),
    shareableAuditPassed: z.boolean(),
    productionStatus: z.literal("needs-review"),
    finalizationMethod: z.literal("none"),
    machineOnlyReleaseAuthorized: z.literal(false),
    c602Status: z.literal("HOLD"),
    regressions: z.array(
      z
        .object({
          suite: z.string().min(1),
          status: z.enum(["PASSED", "FAILED", "SKIPPED"]),
        })
        .strict(),
    ),
    passed: z.boolean(),
    semanticHash: sha256,
  })
  .strict()
  .superRefine((value, context) => {
    const statuses = [
      ...value.checks.map((check) => check.status),
      ...value.regressions.map((regression) => regression.status),
    ];
    const complete = statuses.every((status) => status === "PASSED");
    if (value.passed !== complete) {
      context.addIssue({
        code: "custom",
        path: ["passed"],
        message:
          "Validation passes if and only if every check and regression passed.",
      });
    }
    if (
      value.passed &&
      (!value.machineFinalParity.canonicalTextParity ||
        !value.machineFinalParity.canonicalTimingParity ||
        !value.machineFinalParity.assParity ||
        !value.machineFinalParity.srtParity ||
        !value.machineFinalParity.vttParity ||
        value.machineFinalParity.textMutationCount !== 0 ||
        value.machineFinalParity.timingMutationCount !== 0 ||
        !value.goldIsolation.reviewPackageFrozenBeforeGold ||
        value.goldIsolation.machineReviewBuildGoldInputCount !== 0 ||
        value.goldIsolation.workspaceGoldInputCount !== 0 ||
        value.goldIsolation.syntheticWorkflowGoldInputCount !== 0 ||
        value.goldIsolation.evaluatorGoldInputCount !== 1 ||
        !value.reviewWorkspaceOffline ||
        !value.reviewWorkspaceLocalOnly ||
        !value.reviewAudioLocalOnly ||
        value.realCarnationHumanSessionCreated ||
        !value.sourceReadOnlyVerified ||
        !value.goldReadOnlyVerified ||
        value.networkUsed ||
        !value.shareableAuditPassed)
    ) {
      context.addIssue({
        code: "custom",
        path: ["passed"],
        message: "A passing validation must satisfy every safety invariant.",
      });
    }
  });

export const c60112ShareableSummarySchema = z
  .object({
    ...artifactHeader,
    artifactType: z.literal("c6-0-1-12-shareable-summary"),
    shareable: z.literal(true),
    reviewPackageFreezeHash: sha256,
    reviewQualityEvaluationHash: sha256.nullable(),
    routeDecisionHash: sha256.nullable(),
    counts: z
      .object({
        reviewItems: count,
        reviewRegions: count,
        requiredItems: count,
        requiredRegions: count,
        candidateActionableItems: count,
        correctionRecords: count,
      })
      .strict(),
    decisionCounts: reviewDecisionCountsSchema,
    qualityMetrics: z
      .object({
        rankingResult: reviewRankingResultSchema.nullable(),
        candidateFixRate: ratio.nullable(),
        manualEditRate: ratio.nullable(),
        materialRecallAt10: ratio.nullable(),
        materialRecallAt50: ratio.nullable(),
      })
      .strict(),
    localReviewAudioIncluded: z.literal(false),
    localReviewWorkspaceIncluded: z.literal(false),
    localCorrectionDatasetIncluded: z.literal(false),
    containsRawAudio: z.literal(false),
    containsFullDialogueText: z.literal(false),
    containsFullGoldText: z.literal(false),
    containsAbsolutePaths: z.literal(false),
    secretCount: z.literal(0),
    brokenRelativeReferenceCount: z.literal(0),
    semanticHash: sha256,
  })
  .strict();

export type ReviewItemType = z.infer<typeof reviewItemTypeSchema>;
export type ReviewReason = z.infer<typeof reviewReasonSchema>;
export type ReviewPriorityTier = z.infer<typeof reviewPriorityTierSchema>;
export type ReviewRequiredLevel = z.infer<typeof reviewRequiredLevelSchema>;
export type ReviewDecisionType = z.infer<typeof reviewDecisionTypeSchema>;
export type ReviewDecision = z.infer<typeof reviewDecisionSchema>;
export type ReviewCandidateLabel = z.infer<typeof reviewCandidateLabelSchema>;
export type ReviewEvidenceBadge = z.infer<typeof reviewEvidenceBadgeSchema>;
export type MachineReviewItems = z.infer<typeof machineReviewItemsSchema>;
export type MachineReviewPriority = z.infer<typeof machineReviewPrioritySchema>;
export type MachineReviewRegions = z.infer<typeof machineReviewRegionsSchema>;
export type MachineReviewCandidateBundles = z.infer<
  typeof machineReviewCandidateBundlesSchema
>;
export type MachineReviewAudioManifest = z.infer<
  typeof machineReviewAudioManifestSchema
>;
export type C60112ReviewPackageFreeze = z.infer<
  typeof c60112ReviewPackageFreezeSchema
>;
export type ReviewSession = z.infer<typeof reviewSessionSchema>;
export type ReviewAuditRecord = z.infer<typeof reviewAuditRecordSchema>;
export type HumanCorrectionRecord = z.infer<typeof humanCorrectionRecordSchema>;
export type HumanReviewManifest = z.infer<typeof humanReviewManifestSchema>;
export type CorrectionDatasetSummary = z.infer<
  typeof correctionDatasetSummarySchema
>;
export type ReviewGoldErrorLabel = z.infer<typeof reviewGoldErrorLabelSchema>;
export type ReviewBudget = z.infer<typeof reviewBudgetSchema>;
export type ReviewCandidateFixability = z.infer<
  typeof reviewCandidateFixabilitySchema
>;
export type ReviewRankingBaseline = z.infer<typeof reviewRankingBaselineSchema>;
export type ReviewRankingResult = z.infer<typeof reviewRankingResultSchema>;
export type C60112ReviewQualityEvaluation = z.infer<
  typeof c60112ReviewQualityEvaluationSchema
>;
export type C60112IdealReviewUpperBound = z.infer<
  typeof c60112IdealReviewUpperBoundSchema
>;
export type ReviewProductRouteDecision = z.infer<
  typeof reviewProductRouteDecisionSchema
>;
export type C60112RouteDecision = z.infer<typeof c60112RouteDecisionSchema>;
export type C60112ReviewAssistanceValidation = z.infer<
  typeof c60112ReviewAssistanceValidationSchema
>;
export type C60112ShareableSummary = z.infer<
  typeof c60112ShareableSummarySchema
>;
