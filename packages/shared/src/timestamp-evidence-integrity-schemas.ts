import { z } from "zod";

import { schemaVersionSchema } from "./schemas.js";

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u);

export const timestampCoordinateSystemSchema = z.enum([
  "original-audio-local",
  "original-media-global",
  "vad-processed-local",
  "segment-relative",
  "unknown",
]);

export const timestampMappingMethodSchema = z.enum([
  "identity-original-local",
  "official-mapped-token-getter",
  "verified-segment-relative-offset",
  "verified-vad-timeline-map",
  "unmapped",
  "quarantined",
]);

export const tokenTimelineStatusSchema = z.enum([
  "trusted-original-timeline",
  "trusted-mapped-original-timeline",
  "trusted-segment-relative-remap",
  "vad-processed-unmapped",
  "parent-segment-drift",
  "non-monotonic",
  "zero-collapsed",
  "boundary-clamped",
  "mixed-health",
  "untrusted",
  "unavailable",
]);

export const timestampEvidenceIntegrityModeSchema = z.enum([
  "off",
  "observe",
  "enforce",
]);

export const tokenTimestampPolicySchema = z.enum([
  "auto",
  "mapped-only",
  "validated-legacy",
  "off",
]);

export const legacyOverlapCachePolicySchema = z.enum(["reject", "text-only"]);

export const timestampHealthConfigurationSchema = z
  .object({
    auditContainmentToleranceSeconds: z.number().nonnegative(),
    trustContainmentToleranceSeconds: z.number().nonnegative(),
    hardMaximumTokenSegmentDriftSeconds: z.number().nonnegative(),
    maximumZeroDurationLexicalTokenRatio: z.number().min(0).max(1),
    maximumBoundaryClampedLexicalTokenRatio: z.number().min(0).max(1),
    minimumUsableLexicalTokenRatio: z.number().min(0).max(1),
    minimumDecisionMargin: z.number().min(0).max(1),
    timestampMappingVersion: z.string().min(1),
    tokenHealthPolicyVersion: z.string().min(1),
  })
  .strict();

export const timestampIntegrityIntervalSchema = z
  .object({
    intervalId: z.string().min(1),
    source: z.enum([
      "decoded-segment",
      "trusted-mapped-token",
      "trusted-no-vad-token",
      "raw-vad",
      "source-cue",
    ]),
    coordinateSystem: timestampCoordinateSystemSchema,
    start: z.number().nonnegative(),
    end: z.number().positive(),
    timingUsable: z.boolean(),
    rawStart: z.number().nonnegative().optional(),
    rawEnd: z.number().positive().optional(),
    rawCoordinateSystem: timestampCoordinateSystemSchema.optional(),
    mappingMethod: timestampMappingMethodSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.end <= value.start) {
      context.addIssue({
        code: "custom",
        path: ["end"],
        message: "Timestamp evidence interval must have positive duration.",
      });
    }
    if ((value.rawStart === undefined) !== (value.rawEnd === undefined)) {
      context.addIssue({
        code: "custom",
        path: ["rawStart"],
        message: "Raw timestamp interval endpoints must be recorded together.",
      });
    }
    if (
      value.rawStart !== undefined &&
      value.rawEnd !== undefined &&
      value.rawEnd <= value.rawStart
    ) {
      context.addIssue({
        code: "custom",
        path: ["rawEnd"],
        message: "Raw timestamp evidence must have positive duration.",
      });
    }
    if (
      value.timingUsable &&
      value.coordinateSystem !== "original-media-global"
    ) {
      context.addIssue({
        code: "custom",
        path: ["coordinateSystem"],
        message:
          "Timing-usable evidence must be mapped to original-media-global.",
      });
    }
  });

export const timestampSegmentHealthSchema = z
  .object({
    segmentId: z.string().min(1),
    lexicalTokenCount: z.number().int().nonnegative(),
    specialTokenCount: z.number().int().nonnegative(),
    usableTokenCount: z.number().int().nonnegative(),
    quarantinedTokenCount: z.number().int().nonnegative(),
    tokenSegmentContainmentRatio50ms: z.number().min(0).max(1),
    tokenSegmentContainmentRatioTrustTolerance: z.number().min(0).max(1),
    tokenMonotonicityPassed: z.boolean(),
    zeroDurationLexicalTokenRatio: z.number().min(0).max(1),
    boundaryClampedLexicalTokenRatio: z.number().min(0).max(1),
    maximumEarlyDriftSeconds: z.number().nonnegative(),
    maximumLateDriftSeconds: z.number().nonnegative(),
    maximumAbsoluteDriftSeconds: z.number().nonnegative(),
    rawCoordinateSystem: timestampCoordinateSystemSchema,
    mappedCoordinateSystem: timestampCoordinateSystemSchema,
    tokenTimelineStatus: tokenTimelineStatusSchema,
    tokenTimelineTrustScore: z.number().min(0).max(1),
    quarantineReasons: z.array(z.string().min(1)),
  })
  .strict();

export const timestampAttemptMetricsSchema = z
  .object({
    segmentCount: z.number().int().nonnegative(),
    segmentWithTokenCount: z.number().int().nonnegative(),
    trustedSegmentTokenGroupCount: z.number().int().nonnegative(),
    untrustedSegmentTokenGroupCount: z.number().int().nonnegative(),
    lexicalTokenCount: z.number().int().nonnegative(),
    trustedTokenCount: z.number().int().nonnegative(),
    quarantinedTokenCount: z.number().int().nonnegative(),
    tokenSegmentContainmentRatio: z.number().min(0).max(1),
    zeroDurationTokenRatio: z.number().min(0).max(1),
    boundaryClampedTokenRatio: z.number().min(0).max(1),
    maximumTokenSegmentDriftSeconds: z.number().nonnegative(),
    tokenTimestampsRequested: z.boolean(),
    tokenTimestampsReturned: z.boolean(),
    trustedTokenTimestampsAvailable: z.boolean(),
    trustedTokenTimestampsUsed: z.boolean(),
    decodedSegmentIntervalsAvailable: z.boolean(),
    rawVadIntervalsAvailable: z.boolean(),
  })
  .strict();

export const timestampAttemptIntegritySchema = z
  .object({
    attemptId: z.string().min(1),
    profile: z.enum(["current-sensitive-vad", "extra-sensitive-vad", "no-vad"]),
    useVad: z.boolean(),
    rawTokenCoordinateSystem: timestampCoordinateSystemSchema,
    mappedTokenCoordinateSystem: timestampCoordinateSystemSchema,
    mappingMethod: timestampMappingMethodSchema,
    mappingVersion: z.string().min(1),
    segmentHealth: z.array(timestampSegmentHealthSchema),
    attemptMetrics: timestampAttemptMetricsSchema,
    trustedTokenIds: z.array(z.string().min(1)),
    quarantinedTokenIds: z.array(z.string().min(1)),
    quarantineReasons: z.array(z.string().min(1)),
  })
  .strict();

export const timestampRuntimeCapabilitySchema = z
  .object({
    whisperCppVersion: z.string().min(1),
    runtimeBinaryPathRecordedAsBasenameOnly: z.string().min(1),
    runtimeBinarySha256: hashSchema,
    runtimeSourceCommit: z.string().min(1).nullable(),
    serverResponseFormat: z.string().min(1),
    mappedTokenGetterAvailable: z.boolean(),
    mappedTokenGetterActuallyUsed: z.boolean(),
    rawVadGetterAvailable: z.boolean(),
    rawVadGetterActuallyUsed: z.boolean(),
    tokenTimestampControlAvailable: z.boolean(),
    timestampCapabilityProbeMethod: z.string().min(1),
    timestampCapabilityStatus: z.enum([
      "mapped-original-timeline",
      "legacy-vad-unmapped",
      "token-timestamps-unavailable",
      "unverified",
    ]),
    runtimeTimestampCapabilityHash: hashSchema,
    evidence: z.array(z.string().min(1)),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.mappedTokenGetterActuallyUsed &&
      !value.mappedTokenGetterAvailable
    ) {
      context.addIssue({
        code: "custom",
        path: ["mappedTokenGetterActuallyUsed"],
        message:
          "A mapped token getter cannot be used unless capability was verified.",
      });
    }
    if (value.rawVadGetterActuallyUsed && !value.rawVadGetterAvailable) {
      context.addIssue({
        code: "custom",
        path: ["rawVadGetterActuallyUsed"],
        message:
          "A raw VAD getter cannot be used unless capability was verified.",
      });
    }
  });

export const timestampEvidenceIntegritySummarySchema = z
  .object({
    segmentTokenGroupCount: z.number().int().nonnegative(),
    containmentFailureCount50ms: z.number().int().nonnegative(),
    containmentFailureCountTrustTolerance: z.number().int().nonnegative(),
    nonMonotonicGroupCount: z.number().int().nonnegative(),
    zeroCollapsedGroupCount: z.number().int().nonnegative(),
    boundaryClampedGroupCount: z.number().int().nonnegative(),
    largeDriftGroupCount: z.number().int().nonnegative(),
    lexicalTokenCount: z.number().int().nonnegative(),
    trustedTokenCount: z.number().int().nonnegative(),
    quarantinedTokenCount: z.number().int().nonnegative(),
    untrustedTokenUsedForTimingCount: z.number().int().nonnegative(),
    trustedTokenUsedForTimingCount: z.number().int().nonnegative(),
    mappedVadTokenCount: z.number().int().nonnegative(),
    legacyVadTokenQuarantinedCount: z.number().int().nonnegative(),
    decodedSegmentCount: z.number().int().nonnegative(),
    rawVadIntervalCount: z.number().int().nonnegative(),
    maximumObservedDriftSeconds: z.number().nonnegative(),
    integrityGateFailures: z.array(z.string().min(1)),
    integrityHash: hashSchema,
  })
  .strict();

export const subtitleTimestampEvidenceIntegritySchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("subtitle-timestamp-evidence-integrity"),
    integrityVersion: z.literal("C5.15.1"),
    generatedAt: z.iso.datetime(),
    sourceOverlapArtifactHash: hashSchema,
    runtimeCapability: timestampRuntimeCapabilitySchema,
    configuration: timestampHealthConfigurationSchema
      .extend({
        mode: timestampEvidenceIntegrityModeSchema,
        tokenTimestampPolicy: tokenTimestampPolicySchema,
        legacyOverlapCachePolicy: legacyOverlapCachePolicySchema,
      })
      .strict(),
    attempts: z.array(timestampAttemptIntegritySchema),
    summary: timestampEvidenceIntegritySummarySchema,
  })
  .strict();

export type TimestampCoordinateSystem = z.infer<
  typeof timestampCoordinateSystemSchema
>;
export type TimestampMappingMethod = z.infer<
  typeof timestampMappingMethodSchema
>;
export type TokenTimelineStatus = z.infer<typeof tokenTimelineStatusSchema>;
export type TimestampEvidenceIntegrityMode = z.infer<
  typeof timestampEvidenceIntegrityModeSchema
>;
export type TokenTimestampPolicy = z.infer<typeof tokenTimestampPolicySchema>;
export type LegacyOverlapCachePolicy = z.infer<
  typeof legacyOverlapCachePolicySchema
>;
export type TimestampHealthConfiguration = z.infer<
  typeof timestampHealthConfigurationSchema
>;
export type TimestampSegmentHealth = z.infer<
  typeof timestampSegmentHealthSchema
>;
export type TimestampAttemptIntegrity = z.infer<
  typeof timestampAttemptIntegritySchema
>;
export type TimestampRuntimeCapability = z.infer<
  typeof timestampRuntimeCapabilitySchema
>;
export type SubtitleTimestampEvidenceIntegrity = z.infer<
  typeof subtitleTimestampEvidenceIntegritySchema
>;
