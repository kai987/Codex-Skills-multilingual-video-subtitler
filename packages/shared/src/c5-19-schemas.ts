import { z } from "zod";

import { schemaVersionSchema, subtitleCueSchema } from "./schemas.js";

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const relativePathSchema = z
  .string()
  .min(1)
  .regex(/^(?!\/)(?![A-Za-z]:[\\/])(?!\\\\).+/u, "Path must be relative.");
const nullableNonEmptyStringSchema = z.string().min(1).nullable();

export const seriesMemoryModeSchema = z.enum(["off", "observe", "learn"]);
export const seriesMemoryRankingModeSchema = z.enum(["off", "observe"]);
export const seriesMemoryProjectionModeSchema = z.enum(["off", "observe"]);
export const seriesMemoryCtcObserveModeSchema = z.enum(["off", "targeted"]);
export const seriesMemoryScopeSchema = z.enum(["episode", "season", "series"]);

export const seriesIdentitySchema = z
  .object({
    seriesKey: z.string().min(1),
    title: z.string().min(1),
    normalizedTitle: z.string().min(1),
    year: z.number().int().min(1800).max(2200).nullable(),
    season: z.number().int().positive().nullable(),
    mediaType: z.enum(["series", "movie", "special", "unknown"]),
    identitySource: z.enum([
      "subtitle-package-media-identity",
      "explicit-series-task",
      "curated-memory",
    ]),
    identityStatus: z.enum(["verified", "provisional", "insufficient"]),
    identityEvidence: z.array(z.string().min(1)),
    memoryScope: seriesMemoryScopeSchema,
  })
  .strict();

export const episodeIdentitySchema = z
  .object({
    episodeId: z.string().min(1),
    seriesKey: z.string().min(1),
    episodeNumber: z.number().int().positive().nullable(),
    sourceFingerprintHash: hashSchema,
  })
  .strict();

export const seriesMemoryEntryTypeSchema = z.enum([
  "proper-noun",
  "person-name",
  "place-name",
  "organization-name",
  "title-name",
  "terminology",
  "regional-term",
  "domain-term",
  "dialect-form",
  "fixed-expression",
  "pronunciation-only",
  "orthographic-variant",
  "correction-pair",
]);

export const seriesMemoryTrustLevelSchema = z.enum([
  "human-corrected",
  "human-reviewed",
  "validated-series",
  "repeated-verified",
  "single-observation",
  "candidate-only",
]);

export const seriesMemoryEvidenceSourceSchema = z.enum([
  "human-reviewed-canonical",
  "human-correction",
  "validated-final-canonical",
  "reference-consensus",
  "sudachi-dictionary",
  "mfa-dictionary",
  "g2p",
  "ctc-projection",
  "asr-candidate",
  "manual-memory-entry",
]);

export const seriesMemoryEvidenceSchema = z
  .object({
    evidenceId: z.string().min(1),
    evidenceLineageId: z.string().min(1),
    episodeId: z.string().min(1),
    cueId: z.string().min(1),
    sourceType: seriesMemoryEvidenceSourceSchema,
    sourceArtifactHash: hashSchema,
    occurrenceId: z.string().min(1),
    observedAtSeconds: z.number().nonnegative(),
    surface: z.string().min(1),
    reading: nullableNonEmptyStringSchema,
    semanticHash: hashSchema,
  })
  .strict();

const dialectMetadataSchema = z
  .object({
    isDialectCandidate: z.boolean(),
    status: z.enum(["not-dialect", "candidate", "verified"]),
    region: z.string().min(1),
    surfaceForm: nullableNonEmptyStringSchema,
    dialectPattern: nullableNonEmptyStringSchema,
    standardEquivalent: nullableNonEmptyStringSchema,
    equivalenceSource: nullableNonEmptyStringSchema,
    markerType: nullableNonEmptyStringSchema,
    preserveSurface: z.boolean(),
    preservationRequired: z.boolean(),
  })
  .strict();

const acousticAliasProvenanceSchema = z
  .object({
    alias: z.string().min(1),
    aliasType: z.enum([
      "reading",
      "orthographic-reading",
      "human-correction-reading",
    ]),
    source: z.enum([
      "sudachi-reading",
      "mfa-dictionary-reading",
      "g2p-reading",
      "manual-reading",
      "human-correction-reading",
    ]),
    sourceArtifactHash: hashSchema,
    sourceEntryId: z.string().min(1),
    sourceEvidenceIds: z.array(z.string().min(1)).min(1),
    trustLevel: seriesMemoryTrustLevelSchema,
    verified: z.boolean(),
  })
  .strict();

const memoryConflictSchema = z
  .object({
    conflictId: z.string().min(1),
    conflictType: z.enum([
      "reading-conflict",
      "alias-conflict",
      "homograph-conflict",
      "series-identity-conflict",
    ]),
    lookupKeyNfkc: z.string().min(1),
    entryIds: z.array(z.string().min(1)).min(1),
    values: z.array(z.string().min(1)).min(1),
    resolution: z.enum(["quarantined", "manual-required", "resolved"]),
    semanticHash: hashSchema,
  })
  .strict();

export const seriesLanguageMemoryEntrySchema = z
  .object({
    entryId: z.string().min(1),
    seriesKey: z.string().min(1),
    entryType: seriesMemoryEntryTypeSchema,
    canonicalSurface: z.string().min(1),
    canonicalSurfaceNfc: z.string().min(1),
    lookupKeyNfkc: z.string().min(1),
    readingHiragana: nullableNonEmptyStringSchema,
    readingKatakana: nullableNonEmptyStringSchema,
    pronunciationPhones: z.array(z.string().min(1)),
    dictionaryForm: nullableNonEmptyStringSchema,
    normalizedForm: nullableNonEmptyStringSchema,
    partOfSpeech: z.array(z.string().min(1)),
    variants: z.array(z.string().min(1)),
    orthographicVariants: z.array(z.string().min(1)),
    acousticAliases: z.array(z.string().min(1)),
    acousticAliasProvenance: z.array(acousticAliasProvenanceSchema),
    observedWrongForms: z.array(z.string().min(1)),
    dialectMetadata: dialectMetadataSchema,
    preservationPolicy: z.enum([
      "preserve-canonical-surface",
      "preserve-dialect-surface",
      "ranking-only",
      "pronunciation-projection-only",
    ]),
    status: z.enum(["active", "quarantined", "deprecated"]),
    trustLevel: seriesMemoryTrustLevelSchema,
    applicationEligibility: z.enum([
      "ranking-and-pronunciation",
      "ranking-only",
      "pronunciation-only",
      "suggestion-only",
      "none",
    ]),
    sourceEpisodes: z.array(z.string().min(1)).min(1),
    firstSeen: z.number().nonnegative(),
    lastSeen: z.number().nonnegative(),
    occurrenceIds: z.array(z.string().min(1)).min(1),
    evidence: z.array(seriesMemoryEvidenceSchema).min(1),
    conflicts: z.array(z.string().min(1)),
    semanticHash: hashSchema,
  })
  .strict()
  .refine((entry) => entry.lastSeen >= entry.firstSeen, {
    message: "lastSeen must be at or after firstSeen.",
  });

export const seriesLanguageMemorySchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("series-language-memory"),
    memoryVersion: z.literal("C5.19"),
    generatedAt: z.iso.datetime(),
    seriesIdentity: seriesIdentitySchema,
    parentMemoryHash: hashSchema.nullable(),
    memoryHash: hashSchema,
    revisionId: z.string().min(1),
    memoryRevisionId: z.string().min(1),
    appliedDeltaHash: hashSchema.nullable(),
    sourceEpisodeIds: z.array(z.string().min(1)),
    configuration: z
      .object({
        maximumEntryCount: z.number().int().positive(),
        memoryTieBreakMargin: z.number().min(0).max(1),
        globalReplacementEnabled: z.literal(false),
        finalizationAuthorityEnabled: z.literal(false),
        networkUsed: z.literal(false),
      })
      .strict(),
    entries: z.array(seriesLanguageMemoryEntrySchema),
    conflicts: z.array(memoryConflictSchema),
    statistics: z
      .object({
        entryCount: z.number().int().nonnegative(),
        properNounEntryCount: z.number().int().nonnegative(),
        terminologyEntryCount: z.number().int().nonnegative(),
        dialectEntryCount: z.number().int().nonnegative(),
        correctionEntryCount: z.number().int().nonnegative(),
        pronunciationEntryCount: z.number().int().nonnegative(),
        acousticAliasCount: z.number().int().nonnegative(),
        ambiguousMemoryAliasCount: z.number().int().nonnegative(),
        conflictedReadingCount: z.number().int().nonnegative(),
        duplicateMemoryEvidenceCount: z.number().int().nonnegative(),
        memoryEvidenceDoubleCountPreventedCount: z.number().int().nonnegative(),
      })
      .strict(),
    semanticHash: hashSchema,
  })
  .strict();

export const episodeLanguageCandidateSchema = z
  .object({
    candidateId: z.string().min(1),
    entryType: seriesMemoryEntryTypeSchema,
    canonicalSurface: z.string().min(1),
    reading: nullableNonEmptyStringSchema,
    pronunciationPhones: z.array(z.string().min(1)),
    dictionaryForm: nullableNonEmptyStringSchema,
    normalizedForm: nullableNonEmptyStringSchema,
    partOfSpeech: z.array(z.string().min(1)),
    observedWrongForms: z.array(z.string().min(1)),
    dialectMetadata: dialectMetadataSchema,
    occurrenceIds: z.array(z.string().min(1)).min(1),
    evidence: z.array(seriesMemoryEvidenceSchema).min(1),
    occurrenceCount: z.number().int().positive(),
    humanReviewed: z.boolean(),
    commonWord: z.boolean(),
    blockers: z.array(z.string().min(1)),
    semanticHash: hashSchema,
  })
  .strict();

export const episodeLanguageObservationsSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("episode-language-observations"),
    observationVersion: z.literal("C5.19"),
    generatedAt: z.iso.datetime(),
    seriesIdentity: seriesIdentitySchema,
    episodeIdentity: episodeIdentitySchema,
    cueObservations: z.array(
      z
        .object({
          cueId: z.string().min(1),
          start: z.number().nonnegative(),
          end: z.number().positive(),
          canonicalTextHash: hashSchema,
          candidateIds: z.array(z.string().min(1)),
        })
        .strict(),
    ),
    termCandidates: z.array(episodeLanguageCandidateSchema),
    properNounCandidates: z.array(episodeLanguageCandidateSchema),
    dialectCandidates: z.array(episodeLanguageCandidateSchema),
    correctionObservations: z.array(episodeLanguageCandidateSchema),
    pronunciationObservations: z.array(episodeLanguageCandidateSchema),
    statistics: z
      .object({
        sourceCueCount: z.number().int().nonnegative(),
        memoryCandidateCount: z.number().int().nonnegative(),
        memoryRejectedCommonWordCount: z.number().int().nonnegative(),
        memoryRejectedLowEvidenceCount: z.number().int().nonnegative(),
        duplicateMemoryEvidenceCount: z.number().int().nonnegative(),
      })
      .strict(),
    sourceArtifactHashes: z.record(z.string().min(1), hashSchema),
    semanticHash: hashSchema,
  })
  .strict();

export const seriesLanguageMemoryDeltaSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("series-language-memory-delta"),
    deltaVersion: z.literal("C5.19"),
    generatedAt: z.iso.datetime(),
    seriesKey: z.string().min(1),
    parentMemoryHash: hashSchema.nullable(),
    candidates: z.array(
      z
        .object({
          candidateId: z.string().min(1),
          proposedEntry: seriesLanguageMemoryEntrySchema,
          evidence: z.array(seriesMemoryEvidenceSchema).min(1),
          promotionDecision: z.enum([
            "promote",
            "merge",
            "quarantine",
            "reject",
          ]),
          promotionReasons: z.array(z.string().min(1)),
          blockers: z.array(z.string().min(1)),
        })
        .strict(),
    ),
    statistics: z
      .object({
        memoryCandidateCount: z.number().int().nonnegative(),
        memoryPromotedCount: z.number().int().nonnegative(),
        memoryMergedCount: z.number().int().nonnegative(),
        memoryQuarantinedCount: z.number().int().nonnegative(),
        memoryRejectedCount: z.number().int().nonnegative(),
      })
      .strict(),
    deltaHash: hashSchema,
    semanticHash: hashSchema,
  })
  .strict();

export const subtitleSeriesMemoryEvidenceSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("subtitle-series-memory-evidence"),
    evidenceVersion: z.literal("C5.19"),
    generatedAt: z.iso.datetime(),
    seriesKey: z.string().min(1),
    memoryHash: hashSchema,
    baseCueHash: hashSchema,
    cues: z.array(
      z
        .object({
          cueId: z.string().min(1),
          canonicalTextHash: hashSchema,
          matchedEntryIds: z.array(z.string().min(1)),
          matchCount: z.number().int().nonnegative(),
          appliedAs: z.array(
            z.enum([
              "ranking-prior",
              "pronunciation-projection",
              "display-only",
            ]),
          ),
          canonicalTextChanged: z.literal(false),
        })
        .strict(),
    ),
    summary: z
      .object({
        matchedCueCount: z.number().int().nonnegative(),
        matchedEntryCount: z.number().int().nonnegative(),
        globalReplacementCount: z.literal(0),
        canonicalTextMutationCount: z.literal(0),
        crossSeriesMemoryLeakCount: z.literal(0),
      })
      .strict(),
    semanticHash: hashSchema,
  })
  .strict();

const rankingCandidateSchema = z
  .object({
    candidateId: z.string().min(1),
    text: z.string().min(1),
    associationClass: z.enum([
      "EXACT_TARGET",
      "PROBABLE_TARGET",
      "BROAD_WINDOW",
      "AMBIGUOUS",
      "UNASSOCIATED",
      "UNKNOWN",
    ]),
    baseScore: z.number().min(0).max(1),
    memoryScore: z.number().min(0).max(1),
    adjustedOrder: z.number().int().positive(),
    memoryEntryIds: z.array(z.string().min(1)),
  })
  .strict();

export const subtitleMemoryAssistedRankingSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("subtitle-memory-assisted-ranking"),
    rankingVersion: z.literal("C5.19"),
    generatedAt: z.iso.datetime(),
    memoryHash: hashSchema,
    evaluationMode: z.enum(["bootstrap", "causal", "frozen"]),
    scoreCalibrationStatus: z.literal("rule-based-memory-prior"),
    memoryTieBreakMargin: z.number().min(0).max(1),
    decisions: z.array(
      z
        .object({
          cueId: z.string().min(1),
          memoryHashBefore: hashSchema,
          baseWinnerCandidateId: nullableNonEmptyStringSchema,
          memoryWinnerCandidateId: nullableNonEmptyStringSchema,
          humanCanonical: nullableNonEmptyStringSchema,
          baseWinnerMatchesCanonical: z.boolean().nullable(),
          memoryWinnerMatchesCanonical: z.boolean().nullable(),
          baseRanking: z.array(rankingCandidateSchema),
          memoryEvidence: z.array(z.string().min(1)),
          memoryEvidenceIds: z.array(z.string().min(1)),
          memoryAdjustedRanking: z.array(rankingCandidateSchema),
          rankingReason: z.string().min(1),
          rankingChanged: z.boolean(),
          corrected: z.boolean(),
          regression: z.boolean(),
          memoryCorrectedRanking: z.boolean(),
          memoryRegressedRanking: z.boolean(),
          associationPromotionCount: z.literal(0),
          fabricatedCandidateCount: z.literal(0),
          acousticOverrideViolationCount: z.literal(0),
        })
        .strict(),
    ),
    summary: z
      .object({
        memoryRankingEvaluatedCueCount: z.number().int().nonnegative(),
        memoryRankingChangedCount: z.number().int().nonnegative(),
        memoryRankingCorrectedCount: z.number().int().nonnegative(),
        memoryRankingRegressionCount: z.literal(0),
        memoryFabricatedAutoCandidateCount: z.literal(0),
        memoryAcousticOverrideViolationCount: z.literal(0),
      })
      .strict(),
    semanticHash: hashSchema,
  })
  .strict();

const projectionSpanSchema = z
  .object({
    occurrenceId: z.string().min(1),
    originalStartChar: z.number().int().nonnegative(),
    originalEndChar: z.number().int().positive(),
    canonicalSurface: z.string().min(1),
    projectedAlias: z.string().min(1),
    entryId: z.string().min(1),
  })
  .strict()
  .refine((value) => value.originalEndChar > value.originalStartChar, {
    message: "Projection span end must be after start.",
  });

export const subtitleMemoryPronunciationProjectionSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("subtitle-memory-pronunciation-projection"),
    projectionVersion: z.literal("C5.19"),
    generatedAt: z.iso.datetime(),
    memoryHash: hashSchema,
    baseCueHash: hashSchema,
    cues: z.array(
      z
        .object({
          cueId: z.string().min(1),
          canonicalText: z.string().min(1),
          canonicalTextHash: hashSchema,
          projectedAlignmentText: z.string().min(1),
          spans: z.array(projectionSpanSchema),
          canonicalTextChanged: z.literal(false),
        })
        .strict(),
    ),
    summary: z
      .object({
        pronunciationProjectionCount: z.number().int().nonnegative(),
        projectedCueCount: z.number().int().nonnegative(),
        pronunciationProjectionCanonicalMutationCount: z.literal(0),
      })
      .strict(),
    semanticHash: hashSchema,
  })
  .strict();

export const memoryAssistedCtcTargetAuditSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("memory-assisted-ctc-target-audit"),
    auditVersion: z.literal("C5.19"),
    generatedAt: z.iso.datetime(),
    ctcRuntimeIdentityHash: hashSchema,
    ctcModelSnapshotHash: hashSchema,
    cues: z.array(
      z
        .object({
          cueId: z.string().min(1),
          beforeEncodable: z.boolean(),
          afterProjectionEncodable: z.boolean(),
          beforeUnknownCount: z.number().int().nonnegative(),
          afterUnknownCount: z.number().int().nonnegative(),
          projectionUsed: z.boolean(),
          memoryEntryIds: z.array(z.string().min(1)),
          canonicalTextChanged: z.literal(false),
        })
        .strict(),
    ),
    summary: z
      .object({
        previousEncodableCueCount: z.number().int().nonnegative(),
        memoryAssistedEncodableCueCount: z.number().int().nonnegative(),
        previousUnencodableCueCount: z.number().int().nonnegative(),
        previousUnencodableCueRescuedCount: z.number().int().nonnegative(),
        pronunciationProjectionCanonicalMutationCount: z.literal(0),
      })
      .strict(),
    semanticHash: hashSchema,
  })
  .strict();

export const memoryAssistedCtcObservationSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("memory-assisted-ctc-observation"),
    observationVersion: z.literal("C5.19"),
    generatedAt: z.iso.datetime(),
    mode: z.enum(["off", "targeted-observe-only"]),
    runtimeAvailable: z.boolean(),
    ctcRuntimeIdentityHash: hashSchema.nullable(),
    ctcModelSnapshotHash: hashSchema.nullable(),
    deviceUsed: z.enum(["cpu", "mps"]).nullable(),
    attempts: z
      .array(
        z
          .object({
            cueId: z.string().min(1),
            windowType: z.enum(["narrow", "expanded"]),
            projectedTargetHash: hashSchema,
            pathStatus: z.string().min(1),
            targetEncodable: z.boolean(),
            cacheHit: z.boolean(),
            inferenceExecuted: z.boolean(),
            timingMutationApplied: z.literal(false),
          })
          .strict(),
      )
      .max(4),
    summary: z
      .object({
        requestCount: z.number().int().min(0).max(4),
        inferenceCount: z.number().int().min(0).max(4),
        cacheHitCount: z.number().int().min(0).max(4),
        pathSuccessCount: z.number().int().min(0).max(4),
        memoryAssistedCtcTimingMutationCount: z.literal(0),
        networkUsed: z.literal(false),
      })
      .strict(),
    semanticHash: hashSchema,
  })
  .strict();

export const c519CausalValidationSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("c5-19-causal-validation"),
    validationVersion: z.literal("C5.19"),
    generatedAt: z.iso.datetime(),
    seriesKey: z.string().min(1),
    cueOrder: z.array(z.string().min(1)),
    retrievalEvents: z.array(
      z
        .object({
          cueId: z.string().min(1),
          cueStart: z.number().nonnegative(),
          retrievedOccurrenceIds: z.array(z.string().min(1)),
          learnedOccurrenceIdsAfterEvaluation: z.array(z.string().min(1)),
          matchedEntryIds: z.array(z.string().min(1)),
        })
        .strict(),
    ),
    summary: z
      .object({
        causalMemoryMatchCount: z.number().int().nonnegative(),
        futureCueMemoryLeakCount: z.literal(0),
        sameCueMemoryLeakCount: z.literal(0),
        crossSeriesMemoryLeakCount: z.literal(0),
      })
      .strict(),
    semanticHash: hashSchema,
  })
  .strict();

export const seriesMemoryQualityAuditSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("series-memory-quality-audit"),
    auditVersion: z.literal("C5.19"),
    generatedAt: z.iso.datetime(),
    memoryHash: hashSchema,
    sampledEntries: z.array(
      z
        .object({
          entryId: z.string().min(1),
          canonicalSurface: z.string().min(1),
          entryType: seriesMemoryEntryTypeSchema,
          reading: nullableNonEmptyStringSchema,
          occurrenceCount: z.number().int().positive(),
          trustLevel: seriesMemoryTrustLevelSchema,
          sourceTypes: z.array(seriesMemoryEvidenceSourceSchema).min(1),
          likelyCommonWord: z.boolean(),
          unresolvedType: z.boolean(),
        })
        .strict(),
    ),
    sampledEntryCount: z.number().int().nonnegative(),
    likelyCommonWordCount: z.number().int().nonnegative(),
    unresolvedTypeCount: z.number().int().nonnegative(),
    conflictCount: z.number().int().nonnegative(),
    manualReviewSuggestedCount: z.number().int().nonnegative(),
    qualityPassed: z.boolean(),
    semanticHash: hashSchema,
  })
  .strict();

export const c519MemoryReplaySummarySchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("c5-19-memory-replay-summary"),
    replayVersion: z.literal("C5.19"),
    generatedAt: z.iso.datetime(),
    runKind: z.enum(["bootstrap", "causal", "frozen"]),
    networkUsed: z.literal(false),
    sourceTaskHash: hashSchema,
    sourceCueCount: z.number().int().nonnegative(),
    seriesIdentity: seriesIdentitySchema,
    memoryHash: hashSchema,
    artifactPaths: z
      .object({
        memory: relativePathSchema,
        observations: relativePathSchema,
        delta: relativePathSchema,
        evidence: relativePathSchema,
        ranking: relativePathSchema,
        pronunciationProjection: relativePathSchema,
        ctcTargetAudit: relativePathSchema,
        ctcObservation: relativePathSchema,
        causalValidation: relativePathSchema,
        qualityAudit: relativePathSchema,
      })
      .strict(),
    hashes: z
      .object({
        canonicalCueHash: hashSchema,
        canonicalTimingHash: hashSchema,
        presentationHash: hashSchema,
        memoryHash: hashSchema,
        observationSemanticHash: hashSchema,
        deltaSemanticHash: hashSchema,
        evidenceSemanticHash: hashSchema,
        rankingSemanticHash: hashSchema,
        pronunciationProjectionSemanticHash: hashSchema,
        ctcTargetAuditSemanticHash: hashSchema,
        causalValidationSemanticHash: hashSchema,
      })
      .strict(),
    metrics: z.record(z.string(), z.number().int().nonnegative()),
    reviewItemCountBefore: z.number().int().nonnegative(),
    reviewItemCountAfter: z.number().int().nonnegative(),
    finalStatus: z.literal("needs-review"),
    finalizationMethod: z.literal("none"),
    semanticHash: hashSchema,
  })
  .strict();

export const c519RunValidationSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("c5-19-run-validation"),
    validationVersion: z.literal("C5.19"),
    generatedAt: z.iso.datetime(),
    bootstrapPath: z.string().min(1),
    causalPath: z.string().min(1),
    frozenPath: z.string().min(1),
    checks: z.record(z.string(), z.boolean()),
    idempotentMerge: z.boolean(),
    passed: z.boolean(),
    semanticHash: hashSchema,
  })
  .strict();

export type SeriesIdentity = z.infer<typeof seriesIdentitySchema>;
export type EpisodeIdentity = z.infer<typeof episodeIdentitySchema>;
export type SeriesMemoryEvidence = z.infer<typeof seriesMemoryEvidenceSchema>;
export type SeriesLanguageMemoryEntry = z.infer<
  typeof seriesLanguageMemoryEntrySchema
>;
export type SeriesLanguageMemory = z.infer<typeof seriesLanguageMemorySchema>;
export type EpisodeLanguageCandidate = z.infer<
  typeof episodeLanguageCandidateSchema
>;
export type EpisodeLanguageObservations = z.infer<
  typeof episodeLanguageObservationsSchema
>;
export type SeriesLanguageMemoryDelta = z.infer<
  typeof seriesLanguageMemoryDeltaSchema
>;
export type SubtitleSeriesMemoryEvidence = z.infer<
  typeof subtitleSeriesMemoryEvidenceSchema
>;
export type SubtitleMemoryAssistedRanking = z.infer<
  typeof subtitleMemoryAssistedRankingSchema
>;
export type SubtitleMemoryPronunciationProjection = z.infer<
  typeof subtitleMemoryPronunciationProjectionSchema
>;
export type MemoryAssistedCtcTargetAudit = z.infer<
  typeof memoryAssistedCtcTargetAuditSchema
>;
export type MemoryAssistedCtcObservation = z.infer<
  typeof memoryAssistedCtcObservationSchema
>;
export type C519CausalValidation = z.infer<typeof c519CausalValidationSchema>;
export type SeriesMemoryQualityAudit = z.infer<
  typeof seriesMemoryQualityAuditSchema
>;
export type C519MemoryReplaySummary = z.infer<
  typeof c519MemoryReplaySummarySchema
>;
export type C519RunValidation = z.infer<typeof c519RunValidationSchema>;

// Retain this import in generated schema output so cue compatibility is checked
// against the canonical shared cue contract rather than a C5.19 duplicate.
export const c519CanonicalCueCompatibilitySchema = subtitleCueSchema;
