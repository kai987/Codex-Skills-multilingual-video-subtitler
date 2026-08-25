import { z } from "zod";

import { schemaVersionSchema } from "./schemas.js";

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u);

export const presentationResolutionModeSchema = z.enum([
  "off",
  "observe",
  "enforce",
]);

export const overlapResolutionModeSchema = z.enum(["conservative", "balanced"]);

export const displayLayoutMethodSchema = z.enum([
  "preserved-existing-layout",
  "semantic-balanced-line-break",
  "natural-punctuation-line-break",
  "particle-boundary-line-break",
  "chant-unit-line-break",
  "music-decoration-aware-line-break",
  "unresolved",
]);

export const repetitionRelationshipSchema = z.enum([
  "confirmed-intentional-repetition",
  "likely-intentional-repetition",
  "call-and-response",
  "crowd-chant",
  "separate-utterance-repetition",
  "duplicate-cue",
  "same-utterance-alternative",
  "unresolved",
]);

export const overlapRelationshipSchema = z.enum([
  "exact-duplicate",
  "near-duplicate",
  "same-utterance-alternative",
  "complementary-fragments",
  "rapid-turn-taking",
  "true-simultaneous-speech",
  "crowd-call-plus-dialogue",
  "nested-background-speech",
  "different-dialogue-boundary-error",
  "legal-authoritative-overlap",
  "unresolved",
]);

const intervalSchema = z
  .object({
    start: z.number().nonnegative(),
    end: z.number().positive(),
  })
  .strict()
  .refine((interval) => interval.end > interval.start, {
    message: "Interval end must be greater than start.",
  });

export const displayLayoutDecisionSchema = z
  .object({
    decisionId: z.string().min(1),
    cueId: z.string().min(1),
    canonicalText: z.string().min(1),
    displayText: z.string().min(1),
    canonicalLexicalHash: hashSchema,
    displayLexicalHash: hashSchema,
    lineBreakIndices: z.array(z.number().int().nonnegative()),
    lineCount: z.number().int().positive(),
    charactersPerLine: z.array(z.number().int().nonnegative()).min(1),
    maximumLines: z.number().int().positive(),
    maximumCharactersPerLine: z.number().int().positive(),
    method: displayLayoutMethodSchema,
    reasons: z.array(z.string().min(1)),
    changed: z.boolean(),
    resolved: z.boolean(),
    blocking: z.boolean(),
  })
  .strict();

export const repetitionDecisionSchema = z
  .object({
    decisionId: z.string().min(1),
    cueIds: z.array(z.string().min(1)).min(2),
    relationship: repetitionRelationshipSchema,
    normalizedText: z.string().min(1),
    intervals: z.array(intervalSchema).min(2),
    gapSeconds: z.number(),
    temporalOverlapSeconds: z.number().nonnegative(),
    temporalOverlapRatio: z.number().min(0).max(1),
    sameBounds: z.boolean(),
    sameSourceRequest: z.boolean(),
    independentIntervalEvidence: z.boolean(),
    humanReviewedAuthority: z.boolean(),
    sceneEvidence: z.array(z.string().min(1)),
    tokenEvidence: z.array(z.string().min(1)),
    speechIntervalEvidence: z.array(z.string().min(1)),
    reasons: z.array(z.string().min(1)),
    blocking: z.boolean(),
    recommendedAction: z.enum([
      "preserve-both",
      "delete-duplicate",
      "select-alternative",
      "review",
    ]),
  })
  .strict();

export const overlapPairSchema = z
  .object({
    leftCueId: z.string().min(1),
    rightCueId: z.string().min(1),
    overlapSeconds: z.number().positive(),
    overlapRatio: z.number().min(0).max(1),
    textSimilarity: z.number().min(0).max(1),
    textContainment: z.number().min(0).max(1),
  })
  .strict();

export const timingMutationSchema = z
  .object({
    cueId: z.string().min(1),
    before: intervalSchema,
    after: intervalSchema,
    boundarySource: z.enum([
      "token",
      "speech",
      "vad",
      "source",
      "canonical-forced-alignment",
    ]),
  })
  .strict();

export const assEventPresentationOverrideSchema = z
  .object({
    cueId: z.string().min(1),
    layer: z.number().int().nonnegative(),
    alignment: z.number().int().min(1).max(9).nullable(),
    marginLeft: z.number().int().nonnegative().nullable(),
    marginRight: z.number().int().nonnegative().nullable(),
    marginVertical: z.number().int().nonnegative().nullable(),
    position: z.object({ x: z.number(), y: z.number() }).strict().nullable(),
  })
  .strict();

export const vttCuePresentationSettingSchema = z
  .object({
    cueId: z.string().min(1),
    settings: z.string().min(1),
  })
  .strict();

export const overlapDecisionSchema = z
  .object({
    decisionId: z.string().min(1),
    cueIds: z.array(z.string().min(1)).min(2),
    relationship: overlapRelationshipSchema,
    interval: intervalSchema,
    overlapPairs: z.array(overlapPairSchema).min(1),
    overlapSeconds: z.number().positive(),
    overlapRatio: z.number().min(0).max(1),
    textSimilarity: z.number().min(0).max(1),
    textContainment: z.number().min(0).max(1),
    speakerEvidence: z.array(z.string().min(1)),
    styleEvidence: z.array(z.string().min(1)),
    layerEvidence: z.array(z.string().min(1)),
    sourceEvidence: z.array(z.string().min(1)),
    tokenBoundaryEvidence: z.array(z.string().min(1)),
    speechBoundaryEvidence: z.array(z.string().min(1)),
    sceneEvidence: z.array(z.string().min(1)),
    humanReviewedAuthority: z.boolean(),
    recommendedAction: z.enum([
      "preserve-overlap",
      "delete-duplicate",
      "select-alternative",
      "merge-fragments",
      "trim-boundary",
      "review",
    ]),
    safeAutomaticAction: z.enum([
      "none",
      "presentation-only",
      "timing-only",
      "delete-duplicate",
      "select-alternative",
      "merge-fragments",
    ]),
    timingMutations: z.array(timingMutationSchema),
    assEventOverrides: z.array(assEventPresentationOverrideSchema),
    vttCueSettings: z.array(vttCuePresentationSettingSchema),
    reasons: z.array(z.string().min(1)),
    blocking: z.boolean(),
    resolutionSource: z
      .enum([
        "presentation-only",
        "targeted-acoustic",
        "canonical-forced-alignment",
      ])
      .default("presentation-only"),
    acousticEvidenceIds: z.array(z.string().min(1)).default([]),
    classificationConfidence: z.number().min(0).max(1).nullable().default(null),
    counterfactualScores: z
      .record(z.string().min(1), z.number().min(0).max(1))
      .default({}),
  })
  .strict();

export const subtitlePresentationResolutionSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("subtitle-presentation-resolution"),
    resolutionVersion: z.enum([
      "C5.14",
      "C5.15",
      "C5.15.1",
      "C5.16",
      "C5.16.1",
      "C5.17",
    ]),
    generatedAt: z.string().min(1),
    baseCueHash: hashSchema,
    canonicalCueHash: hashSchema,
    presentationCueHash: hashSchema,
    configuration: z
      .object({
        presentationResolution: presentationResolutionModeSchema,
        overlapResolution: overlapResolutionModeSchema,
        maximumLines: z.number().int().positive(),
        maximumCharactersPerLine: z.number().int().positive(),
        maximumRapidTurnOverlapSeconds: z.number().nonnegative(),
        maximumRapidTurnOverlapRatio: z.number().min(0).max(1),
        maximumTimingAdjustmentSeconds: z.number().nonnegative(),
        minimumPostRepairCueDurationSeconds: z.number().positive(),
      })
      .strict(),
    layoutDecisions: z.array(displayLayoutDecisionSchema),
    repetitionDecisions: z.array(repetitionDecisionSchema),
    overlapDecisions: z.array(overlapDecisionSchema),
    summary: z
      .object({
        canonicalCueCount: z.number().int().nonnegative(),
        presentationCueCount: z.number().int().nonnegative(),
        layoutDecisionCount: z.number().int().nonnegative(),
        layoutChangedCount: z.number().int().nonnegative(),
        layoutResolvedCount: z.number().int().nonnegative(),
        layoutBlockingCount: z.number().int().nonnegative(),
        repetitionDecisionCount: z.number().int().nonnegative(),
        repetitionResolvedCount: z.number().int().nonnegative(),
        repetitionBlockingCount: z.number().int().nonnegative(),
        overlapPairCount: z.number().int().nonnegative(),
        overlapComponentCount: z.number().int().nonnegative(),
        overlapResolvedCount: z.number().int().nonnegative(),
        overlapBlockingCount: z.number().int().nonnegative(),
        timingMutationCount: z.number().int().nonnegative(),
        canonicalTextMutationCount: z.number().int().nonnegative(),
        canonicalTimingMutationCount: z.number().int().nonnegative(),
        displayLexicalMismatchCount: z.number().int().nonnegative(),
        presentationCreatedTemporalCueCount: z.number().int().nonnegative(),
        reviewGroupCount: z.number().int().nonnegative(),
        serializedSrtContainsOverlap: z.boolean().default(false),
        legalSrtOverlapRenderingMayVary: z.boolean().default(false),
        unresolvedSrtOverlapPresent: z.boolean().default(false),
        /** @deprecated Alias of serializedSrtContainsOverlap. */
        srtOverlapRenderingMayVary: z.boolean().default(false),
      })
      .strict(),
  })
  .strict();

export type PresentationResolutionMode = z.infer<
  typeof presentationResolutionModeSchema
>;
export type OverlapResolutionMode = z.infer<typeof overlapResolutionModeSchema>;
export type DisplayLayoutDecision = z.infer<typeof displayLayoutDecisionSchema>;
export type RepetitionRelationship = z.infer<
  typeof repetitionRelationshipSchema
>;
export type RepetitionDecision = z.infer<typeof repetitionDecisionSchema>;
export type OverlapRelationship = z.infer<typeof overlapRelationshipSchema>;
export type OverlapDecision = z.infer<typeof overlapDecisionSchema>;
export type TimingMutation = z.infer<typeof timingMutationSchema>;
export type AssEventPresentationOverride = z.infer<
  typeof assEventPresentationOverrideSchema
>;
export type VttCuePresentationSetting = z.infer<
  typeof vttCuePresentationSettingSchema
>;
export type SubtitlePresentationResolution = z.infer<
  typeof subtitlePresentationResolutionSchema
>;
