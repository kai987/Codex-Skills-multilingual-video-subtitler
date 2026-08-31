import { z } from "zod";

export const c60114PolicyVersion =
  "c6.0.1.14-missing-localization-playback-integrity-v1" as const;
export const c60114Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
export const c60114CountSchema = z.number().int().nonnegative();
export const c60114RatioSchema = z.number().min(0).max(1);
export const c60114IntervalSchema = z
  .object({
    start: z.number().nonnegative(),
    end: z.number().positive(),
  })
  .strict()
  .refine((v) => v.end > v.start, "Interval must have positive duration");
export const c60114SourceIdentitySchema = z
  .object({
    sourceMediaSha256: c60114Sha256Schema,
    durationSeconds: z.number().positive(),
    sampleRate: z.number().int().positive(),
    audioStreamIndex: c60114CountSchema,
    audioTimebase: z.string().regex(/^[1-9]\d*\/[1-9]\d*$/u),
    sourceTimebase: z.literal("SOURCE_GLOBAL_SECONDS"),
  })
  .strict();
export const c60114MachineArtifactHeader = {
  schemaVersion: z.literal("1.0.0"),
  policyVersion: z.literal(c60114PolicyVersion),
  policyHash: c60114Sha256Schema,
  sourceIdentity: c60114SourceIdentitySchema,
  sourceTimebase: z.literal("SOURCE_GLOBAL_SECONDS"),
  runtimeGoldInputCount: z.literal(0),
} as const;
export const c60114PolicySchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    policyVersion: z.literal(c60114PolicyVersion),
    artifactType: z.literal("c6-0-1-14-missing-localization-policy"),
    coverageThresholds: z.tuple([
      z.literal(0.5),
      z.literal(0.8),
      z.literal(0.95),
    ]),
    speech: z
      .object({
        mergeGapSeconds: z.literal(0.25),
        minSeconds: z.literal(0.2),
        maxSeconds: z.literal(12),
        strongContradictionThreshold: z.literal(0.8),
      })
      .strict(),
    probes: z
      .object({
        maxTargets: z.literal(24),
        maxContextTargets: z.literal(8),
        maxRequests: z.literal(64),
        contextMarginSeconds: z.literal(1.5),
        maxContextSeconds: z.literal(15),
        providerCount: z.literal(2),
      })
      .strict(),
    reviewRegion: z
      .object({
        maxTargetGapSeconds: z.literal(0.75),
        maxRegionDurationSeconds: z.literal(30),
        contextSeconds: z.literal(2),
      })
      .strict(),
    exactGuardSeconds: z.literal(0.05),
    cueCoverageToleranceSeconds: z.literal(0.05),
    orphanCoverageThreshold: z.literal(0.8),
    parentGapIsSearchEnvelopeOnly: z.literal(true),
    disjointTargetsRemainSeparate: z.literal(true),
    sharedRootIsCorrelated: z.literal(true),
    goldBarrier: z
      .object({
        runtimeGoldInputAllowed: z.literal(false),
        freezeBeforeLabels: z.literal(true),
        sameVersionRetuneAllowed: z.literal(false),
      })
      .strict(),
    semanticHash: c60114Sha256Schema,
  })
  .strict();
export const c60114TargetTypeSchema = z.enum([
  "CURRENT_CUE_TEXT_TARGET",
  "CURRENT_CUE_HALLUCINATION_TARGET",
  "MISSING_SPEECH_ISLAND_TARGET",
  "ORPHAN_SPEECH_TARGET",
  "CANDIDATE_SOURCE_TARGET",
  "TIMING_BOUNDARY_TARGET",
  "OVERLAP_COMPONENT_TARGET",
  "MULTI_SPEAKER_TARGET",
  "LOCALIZATION_TARGET",
]);
export const c60114ReviewTargetSchema = z
  .object({
    reviewTargetId: z.string().min(1),
    parentReviewItemId: z.string().min(1),
    targetType: c60114TargetTypeSchema,
    sourceInterval: c60114IntervalSchema,
    targetAnchorIds: z.array(z.string().min(1)).min(1),
    finalCueIds: z.array(z.string().min(1)),
    eventIds: z.array(z.string().min(1)),
    evidenceIds: z.array(z.string().min(1)),
    mandatoryForAudio: z.boolean(),
    // Legacy field is retained for old snapshots; audioRequired is full delivery,
    // not REQUIRED queue membership. New builders always populate it.
    audioRequired: z.boolean().optional(),
    localizationStatus: z.enum(["VERIFIED", "UNRESOLVED"]),
    sourceIdentity: c60114SourceIdentitySchema,
    reasons: z.array(z.string().min(1)).min(1),
    semanticHash: c60114Sha256Schema,
  })
  .strict()
  .refine(
    (v) => v.sourceInterval.end <= v.sourceIdentity.durationSeconds,
    "Target exceeds source duration",
  );
export const c60114ReviewTargetsSchema = z
  .object({
    ...c60114MachineArtifactHeader,
    artifactType: z.literal("review-target-intervals-v2"),
    targets: z.array(c60114ReviewTargetSchema),
    unresolvedItems: z.array(
      z
        .object({
          reviewItemId: z.string().min(1),
          reasons: z.array(z.string().min(1)).min(1),
        })
        .strict(),
    ),
    summary: z
      .object({
        targetCount: c60114CountSchema,
        itemCount: c60114CountSchema,
        unresolvedItemCount: c60114CountSchema,
        disjointItemCount: c60114CountSchema,
        coreFallbackCount: z.literal(0),
      })
      .strict(),
    semanticHash: c60114Sha256Schema,
  })
  .strict();

export const c60114EvidenceFamilySchema = z.enum([
  "MAPPED_VAD",
  "DECODED_SEGMENT",
  "TRUSTED_MAPPED_TOKEN",
  "RAW_ASR_SEGMENT",
  "SPEAKER_ACTIVITY",
  "ACOUSTIC_SCENE",
  "CANDIDATE_PROVENANCE",
  "SILENCE",
]);
export const c60114SourceEvidenceSchema = z
  .object({
    evidenceId: z.string().min(1),
    family: c60114EvidenceFamilySchema,
    sourceInterval: c60114IntervalSchema.nullable(),
    mappingStatus: z.enum(["VERIFIED", "QUARANTINED"]),
    speechPositive: z.boolean(),
    lexicalPositive: z.boolean(),
    reliableLocalizedLexical: z.boolean(),
    contradiction: z.boolean(),
    strength: c60114RatioSchema,
    rootLineageIds: z.array(z.string().min(1)).min(1),
    correlationGroup: z.string().min(1),
    providerFamily: z.string().min(1),
    artifactId: z.string().min(1),
    artifactSemanticHash: c60114Sha256Schema,
    sourceIdentityHash: c60114Sha256Schema.nullable(),
    sceneIds: z.array(z.string().min(1)),
    speakerIds: z.array(z.string().min(1)),
    reasons: z.array(z.string().min(1)).min(1),
    semanticHash: c60114Sha256Schema,
  })
  .strict()
  .superRefine((v, c) => {
    if (
      v.mappingStatus === "VERIFIED" &&
      (v.sourceInterval === null || v.sourceIdentityHash === null)
    )
      c.addIssue({
        code: "custom",
        message: "Verified evidence requires interval and source identity",
      });
    if (
      v.mappingStatus === "QUARANTINED" &&
      (v.speechPositive ||
        v.lexicalPositive ||
        v.reliableLocalizedLexical ||
        v.contradiction)
    )
      c.addIssue({
        code: "custom",
        message: "Quarantined coordinates cannot supply active evidence",
      });
    if (v.reliableLocalizedLexical && !v.lexicalPositive)
      c.addIssue({
        code: "custom",
        message: "Reliable lexical requires lexical evidence",
      });
  });
export const c60114ParentGapSchema = z
  .object({
    gapId: z.string().min(1),
    sourceInterval: c60114IntervalSchema,
    itemIds: z.array(z.string().min(1)),
    searchEnvelopeOnly: z.literal(true),
  })
  .strict();
export const c60114BoundarySchema = z
  .object({
    boundaryId: z.string().min(1),
    at: z.number().nonnegative(),
    kind: z.enum(["SILENCE", "CUE", "SCENE", "SPEAKER"]),
    sourceIdentity: c60114SourceIdentitySchema,
    verified: z.literal(true),
  })
  .strict();
export const c60114SpeechIslandSchema = z
  .object({
    islandId: z.string().min(1),
    parentGapIds: z.array(z.string().min(1)),
    itemIds: z.array(z.string().min(1)),
    sourceInterval: c60114IntervalSchema,
    evidenceIds: z.array(z.string().min(1)).min(1),
    rootLineageIds: z.array(z.string().min(1)).min(1),
    correlationGroups: z.array(z.string().min(1)).min(1),
    independentSourceCount: c60114CountSchema,
    lexicalEvidenceIds: z.array(z.string().min(1)),
    reliableLocalizedLexical: z.boolean(),
    speechPositive: z.boolean(),
    strongContradiction: z.boolean(),
    localizationStatus: z.enum(["VERIFIED", "UNRESOLVED"]),
    durationStatus: z.enum(["BOUNDED", "TOO_SHORT", "TOO_LONG"]),
    sceneIds: z.array(z.string().min(1)),
    speakerIds: z.array(z.string().min(1)),
    splitBoundaryIds: z.array(z.string().min(1)),
    reasons: z.array(z.string().min(1)).min(1),
    semanticHash: c60114Sha256Schema,
  })
  .strict();
export const c60114EvidenceAuditSchema = z
  .object({
    evidence: z.array(c60114SourceEvidenceSchema),
    verifiedCount: c60114CountSchema,
    quarantinedCount: c60114CountSchema,
    duplicateInputCount: c60114CountSchema,
    unavailableArtifactIds: z.array(z.string().min(1)),
  })
  .strict();
export const c60114SpeechIslandsSchema = z
  .object({
    ...c60114MachineArtifactHeader,
    artifactType: z.literal("source-global-speech-islands"),
    parentGaps: z.array(c60114ParentGapSchema),
    islands: z.array(c60114SpeechIslandSchema),
    globalIslands: z.array(c60114SpeechIslandSchema),
    boundaries: z.array(c60114BoundarySchema),
    audit: c60114EvidenceAuditSchema,
    summary: z
      .object({
        islandCount: c60114CountSchema,
        globalIslandCount: c60114CountSchema,
        unresolvedParentCount: c60114CountSchema,
        tooShortCount: c60114CountSchema,
        tooLongCount: c60114CountSchema,
        parentGapSpeechEvidenceCount: z.literal(0),
      })
      .strict(),
    semanticHash: c60114Sha256Schema,
  })
  .strict();
export const c60114OrphanClassificationSchema = z.enum([
  "ORPHAN_SPEECH_OBSERVED",
  "ORPHAN_LEXICAL_POSSIBLE",
  "ORPHAN_MULTI_SOURCE_CONFIRMED",
  "COVERED_BY_CUE",
  "COVERED_BY_TARGET",
  "NON_SPEECH_CONTRADICTED",
  "UNVERIFIED",
]);
export const c60114OrphanEntrySchema = z
  .object({
    orphanId: z.string().min(1),
    sourceIslandId: z.string().min(1),
    sourceInterval: c60114IntervalSchema,
    classification: c60114OrphanClassificationSchema,
    evidenceIds: z.array(z.string().min(1)),
    rootLineageIds: z.array(z.string().min(1)),
    correlationGroups: z.array(z.string().min(1)),
    independentSourceCount: c60114CountSchema,
    lexicalEvidenceIds: z.array(z.string().min(1)),
    reliableLocalizedLexical: z.boolean(),
    speechPositive: z.boolean(),
    strongContradiction: z.boolean(),
    durationStatus: z.enum(["BOUNDED", "TOO_SHORT", "TOO_LONG"]),
    cueCoveredRatio: c60114RatioSchema,
    targetCoveredRatio: c60114RatioSchema,
    coveredByCueIds: z.array(z.string().min(1)),
    coveredByTargetIds: z.array(z.string().min(1)),
    reasons: z.array(z.string().min(1)).min(1),
    semanticHash: c60114Sha256Schema,
  })
  .strict();
export const c60114OrphanSpeechSweepSchema = z
  .object({
    ...c60114MachineArtifactHeader,
    artifactType: z.literal("orphan-speech-sweep"),
    entries: z.array(c60114OrphanEntrySchema),
    summary: z
      .object({
        entryCount: c60114CountSchema,
        orphanCount: c60114CountSchema,
        coveredByCueCount: c60114CountSchema,
        coveredByTargetCount: c60114CountSchema,
        contradictedCount: c60114CountSchema,
        unverifiedCount: c60114CountSchema,
        fullMediaAsrRequestCount: z.literal(0),
      })
      .strict(),
    semanticHash: c60114Sha256Schema,
  })
  .strict();
export const c60114ProbeTargetSchema = z
  .object({
    targetId: z.string().min(1),
    sourceInterval: c60114IntervalSchema,
    sourceIslandId: z.string().min(1),
    itemIds: z.array(z.string().min(1)),
    evidenceIds: z.array(z.string().min(1)),
    rootLineageIds: z.array(z.string().min(1)),
    correlationGroups: z.array(z.string().min(1)),
    priorityClass: z.enum([
      "ORPHAN_MULTI_SOURCE",
      "ORPHAN_LEXICAL",
      "UNCOVERED_VERIFIED_SPEECH",
    ]),
    speechPositive: z.literal(true),
    validTimebase: z.literal(true),
    cueCoveredRatio: c60114RatioSchema,
    targetCoveredRatio: c60114RatioSchema,
    strongContradiction: z.literal(false),
    reliableLocalizedLexical: z.literal(false),
    neighborCueIntervals: z.array(c60114IntervalSchema),
    reasons: z.array(z.string().min(1)).min(1),
  })
  .strict();
export const c60114ProbeSelectionSchema = z
  .object({
    ...c60114MachineArtifactHeader,
    artifactType: z.literal("missing-dialogue-probe-selection"),
    targets: z.array(c60114ProbeTargetSchema).max(24),
    decisions: z.array(
      z
        .object({
          candidateId: z.string().min(1),
          sourceInterval: c60114IntervalSchema,
          selected: z.boolean(),
          targetId: z.string().min(1).nullable(),
          reasons: z.array(z.string().min(1)).min(1),
        })
        .strict(),
    ),
    budget: z
      .object({
        maximumTargets: z.literal(24),
        maximumLaterContextTargets: z.literal(8),
        maximumRequests: z.literal(64),
        selectedCoreRequestCount: c60114CountSchema,
        reservedContextRequestCount: z.literal(16),
      })
      .strict(),
    semanticHash: c60114Sha256Schema,
  })
  .strict();

export type C60114Interval = z.infer<typeof c60114IntervalSchema>;
export type C60114SourceIdentity = z.infer<typeof c60114SourceIdentitySchema>;
export type C60114Policy = z.infer<typeof c60114PolicySchema>;
export type C60114ReviewTarget = z.infer<typeof c60114ReviewTargetSchema>;
export type C60114ReviewTargets = z.infer<typeof c60114ReviewTargetsSchema>;
export type C60114SourceEvidence = z.infer<typeof c60114SourceEvidenceSchema>;
export type C60114ParentGap = z.infer<typeof c60114ParentGapSchema>;
export type C60114Boundary = z.infer<typeof c60114BoundarySchema>;
export type C60114SpeechIsland = z.infer<typeof c60114SpeechIslandSchema>;
export type C60114SpeechIslands = z.infer<typeof c60114SpeechIslandsSchema>;
export type C60114OrphanEntry = z.infer<typeof c60114OrphanEntrySchema>;
export type C60114OrphanSpeechSweep = z.infer<
  typeof c60114OrphanSpeechSweepSchema
>;
export type C60114ProbeTarget = z.infer<typeof c60114ProbeTargetSchema>;
export type C60114ProbeSelection = z.infer<typeof c60114ProbeSelectionSchema>;
