import { createHash } from "node:crypto";

import {
  subtitleTimestampEvidenceIntegritySchema,
  timestampAttemptIntegritySchema,
  type LegacyOverlapCachePolicy,
  type OverlapAcousticAttempt,
  type OverlapAcousticProfile,
  type SubtitleTimestampEvidenceIntegrity,
  type TimestampAttemptIntegrity,
  type TimestampCoordinateSystem,
  type TimestampEvidenceIntegrityMode,
  type TimestampHealthConfiguration,
  type TimestampMappingMethod,
  type TimestampRuntimeCapability,
  type TokenTimestampPolicy,
  type TokenTimelineStatus,
  type OverlapCueAlignment,
} from "@mvl/shared";

export const TIMESTAMP_MAPPING_VERSION =
  "c5.16-official-mapped-getter-v1" as const;
export const TOKEN_HEALTH_POLICY_VERSION = "c5.16-token-health-v1" as const;
export const RAW_VAD_POLICY_VERSION =
  "c5.16-whisper-internal-vad-getter-v1" as const;
export const RAW_VAD_BOUNDARY_POLICY_VERSION =
  "c5.16.1-vad-boundary-normalization-v1" as const;
export const RAW_VAD_BOUNDARY_NORMALIZATION_HARD_MAXIMUM_SECONDS = 0.1;

export const DEFAULT_TIMESTAMP_HEALTH_CONFIGURATION: Readonly<TimestampHealthConfiguration> =
  {
    auditContainmentToleranceSeconds: 0.05,
    trustContainmentToleranceSeconds: 0.2,
    hardMaximumTokenSegmentDriftSeconds: 0.5,
    maximumZeroDurationLexicalTokenRatio: 0.2,
    maximumBoundaryClampedLexicalTokenRatio: 0.2,
    minimumUsableLexicalTokenRatio: 0.7,
    minimumDecisionMargin: 0.1,
    timestampMappingVersion: TIMESTAMP_MAPPING_VERSION,
    tokenHealthPolicyVersion: TOKEN_HEALTH_POLICY_VERSION,
    rawVadBoundaryNormalizationToleranceSeconds: 0.05,
  };

export interface RawTimestampToken {
  tokenId: string;
  text: string;
  rawStart: number;
  rawEnd: number;
  probability: number | null;
  rawCoordinateSystem?: TimestampCoordinateSystem;
  officialMappedStart?: number | null;
  officialMappedEnd?: number | null;
  declaredSegmentRelative?: boolean;
}

export interface RawTimestampSegment {
  segmentId: string;
  text: string;
  rawStart: number;
  rawEnd: number;
  confidence: number | null;
  tokens: readonly RawTimestampToken[];
}

export interface TimestampAuditResult {
  segments: OverlapAcousticAttempt["segments"];
  tokens: OverlapAcousticAttempt["tokens"];
  decodedSegmentIntervals: NonNullable<
    OverlapAcousticAttempt["decodedSegmentIntervals"]
  >;
  mappedTrustedTokenIntervals: NonNullable<
    OverlapAcousticAttempt["mappedTrustedTokenIntervals"]
  >;
  rawVadIntervals: NonNullable<OverlapAcousticAttempt["rawVadIntervals"]>;
  sourceCueIntervals: NonNullable<OverlapAcousticAttempt["sourceCueIntervals"]>;
  integrity: TimestampAttemptIntegrity;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .toSorted()
      .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function timestampIntegrityHash(value: unknown): string {
  return createHash("sha256").update(stable(value)).digest("hex");
}

function round(value: number): number {
  return Number(value.toFixed(6));
}

export function isSpecialTimestampToken(text: string): boolean {
  const normalized = text.trim();
  if (normalized.includes("�")) return false;
  return (
    normalized === "" ||
    /^\[[^\]]+\]$/u.test(normalized) ||
    /^<\|[^|]+\|>$/u.test(normalized) ||
    /^[\p{C}\p{Z}\p{P}\p{S}_]+$/u.test(normalized)
  );
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

function drift(input: {
  tokenStart: number;
  tokenEnd: number;
  segmentStart: number;
  segmentEnd: number;
}): { early: number; late: number; maximum: number } {
  const early = Math.max(0, input.segmentStart - input.tokenStart);
  const late = Math.max(0, input.tokenEnd - input.segmentEnd);
  return { early, late, maximum: Math.max(early, late) };
}

function intervalContained(input: {
  tokenStart: number;
  tokenEnd: number;
  segmentStart: number;
  segmentEnd: number;
  tolerance: number;
}): boolean {
  return (
    input.tokenStart >= input.segmentStart - input.tolerance &&
    input.tokenEnd <= input.segmentEnd + input.tolerance
  );
}

function initialTokenMapping(input: {
  token: RawTimestampToken;
  segment: RawTimestampSegment;
  useVad: boolean;
  extraction: { start: number; end: number };
  tokenTimestampPolicy: TokenTimestampPolicy;
  mappedTokenGetterActuallyUsed: boolean;
}): {
  rawCoordinateSystem: TimestampCoordinateSystem;
  mappedStart: number | null;
  mappedEnd: number | null;
  mappedCoordinateSystem: TimestampCoordinateSystem;
  mappingMethod: TimestampMappingMethod;
  mappingConfidence: number;
} {
  const rawCoordinateSystem =
    input.token.rawCoordinateSystem ??
    (input.useVad ? "vad-processed-local" : "original-audio-local");
  if (input.tokenTimestampPolicy === "off") {
    return {
      rawCoordinateSystem,
      mappedStart: null,
      mappedEnd: null,
      mappedCoordinateSystem: "unknown",
      mappingMethod: "quarantined",
      mappingConfidence: 0,
    };
  }
  if (
    input.mappedTokenGetterActuallyUsed &&
    input.token.officialMappedStart !== null &&
    input.token.officialMappedStart !== undefined &&
    input.token.officialMappedEnd !== null &&
    input.token.officialMappedEnd !== undefined
  ) {
    return {
      rawCoordinateSystem,
      mappedStart: input.extraction.start + input.token.officialMappedStart,
      mappedEnd: input.extraction.start + input.token.officialMappedEnd,
      mappedCoordinateSystem: "original-media-global",
      mappingMethod: "official-mapped-token-getter",
      mappingConfidence: 1,
    };
  }
  if (
    rawCoordinateSystem === "segment-relative" &&
    input.token.declaredSegmentRelative === true
  ) {
    return {
      rawCoordinateSystem,
      mappedStart:
        input.extraction.start + input.segment.rawStart + input.token.rawStart,
      mappedEnd:
        input.extraction.start + input.segment.rawStart + input.token.rawEnd,
      mappedCoordinateSystem: "original-media-global",
      mappingMethod: "verified-segment-relative-offset",
      mappingConfidence: 0.9,
    };
  }
  if (
    !input.useVad &&
    rawCoordinateSystem === "original-audio-local" &&
    input.tokenTimestampPolicy !== "mapped-only"
  ) {
    return {
      rawCoordinateSystem,
      mappedStart: input.extraction.start + input.token.rawStart,
      mappedEnd: input.extraction.start + input.token.rawEnd,
      mappedCoordinateSystem: "original-media-global",
      mappingMethod: "identity-original-local",
      mappingConfidence: 0.95,
    };
  }
  return {
    rawCoordinateSystem,
    mappedStart: null,
    mappedEnd: null,
    mappedCoordinateSystem: "unknown",
    mappingMethod: "unmapped",
    mappingConfidence: 0,
  };
}

function statusForGroup(input: {
  useVad: boolean;
  mapped: boolean;
  mappingMethod: TimestampMappingMethod;
  monotonic: boolean;
  maximumDrift: number;
  zeroRatio: number;
  clampRatio: number;
  usableRatio: number;
  containmentTrustRatio: number;
  configuration: TimestampHealthConfiguration;
}): TokenTimelineStatus {
  if (!input.mapped && input.useVad) return "vad-processed-unmapped";
  if (!input.mapped) return "untrusted";
  if (!input.monotonic) return "non-monotonic";
  if (
    input.maximumDrift > input.configuration.hardMaximumTokenSegmentDriftSeconds
  )
    return "parent-segment-drift";
  if (
    input.zeroRatio > input.configuration.maximumZeroDurationLexicalTokenRatio
  )
    return "zero-collapsed";
  if (
    input.clampRatio >
    input.configuration.maximumBoundaryClampedLexicalTokenRatio
  )
    return "boundary-clamped";
  if (
    input.usableRatio < input.configuration.minimumUsableLexicalTokenRatio ||
    input.containmentTrustRatio <
      input.configuration.minimumUsableLexicalTokenRatio
  )
    return "mixed-health";
  if (input.mappingMethod === "official-mapped-token-getter")
    return "trusted-mapped-original-timeline";
  if (input.mappingMethod === "verified-segment-relative-offset")
    return "trusted-segment-relative-remap";
  return "trusted-original-timeline";
}

export function auditTimestampEvidenceAttempt(input: {
  attemptId: string;
  profile: OverlapAcousticProfile;
  useVad: boolean;
  extractionInterval: { start: number; end: number };
  segments: readonly RawTimestampSegment[];
  sourceCueIntervals?: readonly {
    intervalId: string;
    start: number;
    end: number;
  }[];
  rawVadIntervals?: readonly {
    intervalId: string;
    start: number;
    end: number;
    coordinateSystem?: "original-audio-local" | "original-media-global";
  }[];
  tokenTimestampsRequested: boolean;
  tokenTimestampPolicy: TokenTimestampPolicy;
  mappedTokenGetterActuallyUsed: boolean;
  actualAudioDurationSeconds?: number;
  durationMeasurementMethod?: string;
  configuration?: Partial<TimestampHealthConfiguration>;
}): TimestampAuditResult {
  const configuration = {
    ...DEFAULT_TIMESTAMP_HEALTH_CONFIGURATION,
    ...input.configuration,
  };
  const duration =
    input.extractionInterval.end - input.extractionInterval.start;
  const actualAudioDurationSeconds =
    input.actualAudioDurationSeconds ?? duration;
  const runtimeStabilizationActive =
    input.actualAudioDurationSeconds !== undefined ||
    input.configuration?.rawVadBoundaryNormalizationToleranceSeconds !==
      undefined;
  if (
    !Number.isFinite(actualAudioDurationSeconds) ||
    actualAudioDurationSeconds <= 0
  ) {
    throw new Error(
      "Actual extracted-audio duration must be finite and positive.",
    );
  }
  if (
    configuration.rawVadBoundaryNormalizationToleranceSeconds >
    RAW_VAD_BOUNDARY_NORMALIZATION_HARD_MAXIMUM_SECONDS
  ) {
    throw new Error(
      `Raw VAD boundary normalization tolerance cannot exceed ${String(RAW_VAD_BOUNDARY_NORMALIZATION_HARD_MAXIMUM_SECONDS)} seconds.`,
    );
  }
  const outputTokens: OverlapAcousticAttempt["tokens"] = [];
  const segmentHealth: TimestampAttemptIntegrity["segmentHealth"] = [];
  const outputSegments: OverlapAcousticAttempt["segments"] = [];

  const rawVadBoundaryDuration =
    Math.abs(actualAudioDurationSeconds - duration) <= 0.005 &&
    Number(actualAudioDurationSeconds.toFixed(2)) ===
      Number(duration.toFixed(2))
      ? duration
      : actualAudioDurationSeconds;
  const rawVadEvaluations = (input.rawVadIntervals ?? []).map(
    (interval, index, intervals) => {
      const coordinateSystem =
        interval.coordinateSystem ?? "original-audio-local";
      const previous = intervals[index - 1];
      const finite =
        Number.isFinite(interval.start) && Number.isFinite(interval.end);
      const ordered =
        previous === undefined ||
        !Number.isFinite(previous.start) ||
        interval.start >= previous.start;
      const structurallyValid =
        finite && interval.end > interval.start && ordered;
      const localRawStart =
        coordinateSystem === "original-audio-local"
          ? interval.start
          : interval.start - input.extractionInterval.start;
      const localRawEnd =
        coordinateSystem === "original-audio-local"
          ? interval.end
          : interval.end - input.extractionInterval.start;
      const startOverrun = Math.max(0, -localRawStart);
      const endOverrun = Math.max(0, localRawEnd - rawVadBoundaryDuration);
      const maximumBoundaryOverrun = Math.max(startOverrun, endOverrun);
      const completelyOutside =
        finite && (localRawEnd <= 0 || localRawStart >= rawVadBoundaryDuration);
      const normalizationEligible =
        structurallyValid &&
        !completelyOutside &&
        maximumBoundaryOverrun > 1e-9 &&
        maximumBoundaryOverrun <=
          configuration.rawVadBoundaryNormalizationToleranceSeconds + 1e-9;
      const normalizedLocalStart = normalizationEligible
        ? Math.max(0, localRawStart)
        : localRawStart;
      const normalizedLocalEnd = normalizationEligible
        ? Math.min(rawVadBoundaryDuration, localRawEnd)
        : localRawEnd;
      const normalizationProducesDuration =
        normalizedLocalEnd > normalizedLocalStart;
      const normalizationApplied =
        normalizationEligible && normalizationProducesDuration;
      const normalizedStart =
        coordinateSystem === "original-audio-local"
          ? normalizedLocalStart
          : input.extractionInterval.start + normalizedLocalStart;
      const normalizedEnd =
        coordinateSystem === "original-audio-local"
          ? normalizedLocalEnd
          : input.extractionInterval.start + normalizedLocalEnd;
      const mappedStart = input.extractionInterval.start + normalizedLocalStart;
      const mappedEnd = input.extractionInterval.start + normalizedLocalEnd;
      const withinAudio =
        structurallyValid && startOverrun <= 1e-9 && endOverrun <= 1e-9;
      const overlapsPrevious =
        structurallyValid &&
        previous !== undefined &&
        Number.isFinite(previous.end) &&
        interval.start < previous.end;
      const healthStatus =
        !structurallyValid ||
        (normalizationEligible && !normalizationProducesDuration)
          ? ("invalid" as const)
          : completelyOutside || (!withinAudio && !normalizationApplied)
            ? ("out-of-range" as const)
            : normalizationApplied
              ? ("trusted-with-boundary-normalization" as const)
              : overlapsPrevious
                ? ("overlapping-with-padding" as const)
                : ("trusted" as const);
      const timingUsable =
        healthStatus === "trusted" ||
        healthStatus === "trusted-with-boundary-normalization" ||
        healthStatus === "overlapping-with-padding";
      const maximumNormalizationDelta = normalizationApplied
        ? Math.max(
            Math.abs(normalizedLocalStart - localRawStart),
            Math.abs(normalizedLocalEnd - localRawEnd),
          )
        : 0;
      const timingTrustScore =
        healthStatus === "trusted"
          ? 1
          : healthStatus === "overlapping-with-padding"
            ? 0.95
            : healthStatus === "trusted-with-boundary-normalization"
              ? round(
                  Math.max(
                    0.8,
                    1 -
                      (maximumNormalizationDelta /
                        Math.max(
                          configuration.rawVadBoundaryNormalizationToleranceSeconds,
                          0.001,
                        )) *
                        0.15,
                  ),
                )
              : 0;
      return {
        interval,
        index,
        coordinateSystem,
        mappedStart,
        mappedEnd,
        normalizedStart,
        normalizedEnd,
        normalizationApplied,
        normalizationDeltaStart: normalizationApplied
          ? round(Math.abs(normalizedLocalStart - localRawStart))
          : 0,
        normalizationDeltaEnd: normalizationApplied
          ? round(Math.abs(normalizedLocalEnd - localRawEnd))
          : 0,
        normalizationReason: normalizationApplied
          ? startOverrun > 0 && endOverrun > 0
            ? "RAW_VAD_BOTH_AUDIO_BOUNDARIES_EXCEEDED_WITHIN_TOLERANCE"
            : startOverrun > 0
              ? "RAW_VAD_START_PRECEDES_AUDIO_BOUNDARY_WITHIN_TOLERANCE"
              : "RAW_VAD_END_EXCEEDS_AUDIO_BOUNDARY_WITHIN_TOLERANCE"
          : null,
        healthStatus,
        timingTrustScore,
        timingUsable,
      };
    },
  );

  for (const segment of input.segments) {
    const segmentGlobalStart =
      input.extractionInterval.start + segment.rawStart;
    const segmentGlobalEnd = input.extractionInterval.start + segment.rawEnd;
    const mapped = segment.tokens.map((token) => ({
      token,
      mapping: initialTokenMapping({
        token,
        segment,
        useVad: input.useVad,
        extraction: input.extractionInterval,
        tokenTimestampPolicy: input.tokenTimestampPolicy,
        mappedTokenGetterActuallyUsed: input.mappedTokenGetterActuallyUsed,
      }),
    }));
    const lexical = mapped.filter(
      ({ token }) => !isSpecialTimestampToken(token.text),
    );
    const specialCount = mapped.length - lexical.length;
    const auditSpans = lexical.map(({ token, mapping }) => {
      const tokenStart = mapping.mappedStart ?? token.rawStart;
      const tokenEnd = mapping.mappedEnd ?? token.rawEnd;
      const parentStart =
        mapping.mappedStart === null ? segment.rawStart : segmentGlobalStart;
      const parentEnd =
        mapping.mappedEnd === null ? segment.rawEnd : segmentGlobalEnd;
      return {
        token,
        mapping,
        tokenStart,
        tokenEnd,
        parentStart,
        parentEnd,
        drift: drift({
          tokenStart,
          tokenEnd,
          segmentStart: parentStart,
          segmentEnd: parentEnd,
        }),
        extractionContained:
          mapping.mappedStart !== null &&
          mapping.mappedEnd !== null &&
          mapping.mappedStart >=
            input.extractionInterval.start -
              configuration.trustContainmentToleranceSeconds &&
          mapping.mappedEnd <=
            input.extractionInterval.end +
              configuration.trustContainmentToleranceSeconds,
        zero: token.rawEnd <= token.rawStart,
        boundary:
          mapping.mappedStart !== null && mapping.mappedEnd !== null
            ? mapping.mappedStart - input.extractionInterval.start <=
                configuration.auditContainmentToleranceSeconds ||
              input.extractionInterval.end - mapping.mappedEnd <=
                configuration.auditContainmentToleranceSeconds
            : token.rawStart <=
                configuration.auditContainmentToleranceSeconds ||
              token.rawEnd >=
                duration - configuration.auditContainmentToleranceSeconds,
      };
    });
    const monotonic = auditSpans.every((item, index) => {
      const previous = auditSpans[index - 1];
      return (
        previous === undefined ||
        (item.tokenStart >= previous.tokenStart - 1e-9 &&
          item.tokenEnd >= previous.tokenEnd - 1e-9)
      );
    });
    const containment50 = auditSpans.filter((item) =>
      intervalContained({
        tokenStart: item.tokenStart,
        tokenEnd: item.tokenEnd,
        segmentStart: item.parentStart,
        segmentEnd: item.parentEnd,
        tolerance: configuration.auditContainmentToleranceSeconds,
      }),
    ).length;
    const containmentTrust = auditSpans.filter(
      (item) =>
        item.extractionContained &&
        intervalContained({
          tokenStart: item.tokenStart,
          tokenEnd: item.tokenEnd,
          segmentStart: item.parentStart,
          segmentEnd: item.parentEnd,
          tolerance: configuration.trustContainmentToleranceSeconds,
        }),
    ).length;
    const zeroCount = auditSpans.filter((item) => item.zero).length;
    const boundaryCount = auditSpans.filter((item) => item.boundary).length;
    const maximumEarly = Math.max(
      0,
      ...auditSpans.map((item) => item.drift.early),
    );
    const maximumLate = Math.max(
      0,
      ...auditSpans.map((item) => item.drift.late),
    );
    const maximumDrift = Math.max(maximumEarly, maximumLate);
    const mappedGroup = lexical.every(
      ({ mapping }) =>
        mapping.mappedStart !== null &&
        mapping.mappedEnd !== null &&
        mapping.mappedCoordinateSystem === "original-media-global",
    );
    const firstMapping = lexical[0]?.mapping;
    const prelimUsable = auditSpans.filter(
      (item) =>
        !item.token.text.includes("�") &&
        item.mapping.mappedStart !== null &&
        item.mapping.mappedEnd !== null &&
        item.mapping.mappedEnd > item.mapping.mappedStart &&
        item.extractionContained &&
        !item.zero &&
        item.drift.maximum <=
          configuration.hardMaximumTokenSegmentDriftSeconds &&
        intervalContained({
          tokenStart: item.tokenStart,
          tokenEnd: item.tokenEnd,
          segmentStart: item.parentStart,
          segmentEnd: item.parentEnd,
          tolerance: configuration.trustContainmentToleranceSeconds,
        }),
    ).length;
    const status =
      lexical.length === 0
        ? "unavailable"
        : statusForGroup({
            useVad: input.useVad,
            mapped: mappedGroup,
            mappingMethod: firstMapping?.mappingMethod ?? "unmapped",
            monotonic,
            maximumDrift,
            zeroRatio: ratio(zeroCount, lexical.length),
            clampRatio: ratio(boundaryCount, lexical.length),
            usableRatio: ratio(prelimUsable, lexical.length),
            containmentTrustRatio: ratio(containmentTrust, lexical.length),
            configuration,
          });
    const groupTrusted = status.startsWith("trusted");
    const groupReasons = [
      ...(!mappedGroup
        ? [input.useVad ? "VAD_TIMELINE_UNMAPPED" : "TOKEN_TIMELINE_UNMAPPED"]
        : []),
      ...(!monotonic ? ["NON_MONOTONIC_TOKEN_SEQUENCE"] : []),
      ...(maximumDrift > configuration.hardMaximumTokenSegmentDriftSeconds
        ? ["TOKEN_OUTSIDE_PARENT_SEGMENT"]
        : []),
      ...(ratio(zeroCount, lexical.length) >
      configuration.maximumZeroDurationLexicalTokenRatio
        ? ["ZERO_COLLAPSED_TOKEN_SEQUENCE"]
        : []),
      ...(ratio(boundaryCount, lexical.length) >
      configuration.maximumBoundaryClampedLexicalTokenRatio
        ? ["BOUNDARY_CLAMPED_TOKEN_SEQUENCE"]
        : []),
      ...(input.tokenTimestampPolicy === "off"
        ? ["TOKEN_TIMESTAMP_POLICY_OFF"]
        : []),
    ];
    let usableCount = 0;
    for (const { token, mapping } of mapped) {
      const special = isSpecialTimestampToken(token.text);
      const invalidText = token.text.includes("�");
      const localDrift =
        mapping.mappedStart === null || mapping.mappedEnd === null
          ? drift({
              tokenStart: token.rawStart,
              tokenEnd: token.rawEnd,
              segmentStart: segment.rawStart,
              segmentEnd: segment.rawEnd,
            })
          : drift({
              tokenStart: mapping.mappedStart,
              tokenEnd: mapping.mappedEnd,
              segmentStart: segmentGlobalStart,
              segmentEnd: segmentGlobalEnd,
            });
      const individualContained =
        mapping.mappedStart !== null &&
        mapping.mappedEnd !== null &&
        intervalContained({
          tokenStart: mapping.mappedStart,
          tokenEnd: mapping.mappedEnd,
          segmentStart: segmentGlobalStart,
          segmentEnd: segmentGlobalEnd,
          tolerance: configuration.trustContainmentToleranceSeconds,
        }) &&
        mapping.mappedStart >=
          input.extractionInterval.start -
            configuration.trustContainmentToleranceSeconds &&
        mapping.mappedEnd <=
          input.extractionInterval.end +
            configuration.trustContainmentToleranceSeconds;
      const boundaryClamped =
        mapping.mappedStart !== null && mapping.mappedEnd !== null
          ? mapping.mappedStart - input.extractionInterval.start <=
              configuration.auditContainmentToleranceSeconds ||
            input.extractionInterval.end - mapping.mappedEnd <=
              configuration.auditContainmentToleranceSeconds
          : token.rawStart <= configuration.auditContainmentToleranceSeconds ||
            token.rawEnd >=
              duration - configuration.auditContainmentToleranceSeconds;
      const timingUsable =
        !special &&
        !invalidText &&
        groupTrusted &&
        individualContained &&
        token.rawEnd > token.rawStart &&
        localDrift.maximum <= configuration.hardMaximumTokenSegmentDriftSeconds;
      if (timingUsable) usableCount += 1;
      const quarantineReasons = timingUsable
        ? []
        : [
            ...groupReasons,
            ...(special ? ["SPECIAL_TOKEN"] : []),
            ...(invalidText ? ["INVALID_UTF8_REPLACEMENT_CHARACTER"] : []),
            ...(token.rawEnd <= token.rawStart ? ["ZERO_DURATION_TOKEN"] : []),
            ...(!individualContained && mapping.mappedStart !== null
              ? ["TOKEN_OUTSIDE_PARENT_SEGMENT"]
              : []),
          ];
      const mappedStart = mapping.mappedStart;
      const mappedEnd = mapping.mappedEnd;
      outputTokens.push({
        tokenId: token.tokenId,
        parentSegmentId: segment.segmentId,
        text: token.text,
        start: mappedStart ?? token.rawStart,
        end: mappedEnd ?? token.rawEnd,
        probability: token.probability,
        rawStart: token.rawStart,
        rawEnd: token.rawEnd,
        rawCoordinateSystem: mapping.rawCoordinateSystem,
        mappedStart,
        mappedEnd,
        mappedCoordinateSystem:
          mappedStart === null || mappedEnd === null
            ? "unknown"
            : mapping.mappedCoordinateSystem,
        mappingMethod:
          mappedStart === null || mappedEnd === null
            ? "quarantined"
            : mapping.mappingMethod,
        mappingVersion: configuration.timestampMappingVersion,
        mappingConfidence: timingUsable ? mapping.mappingConfidence : 0,
        textUsable: !special && !invalidText,
        timingUsable,
        tokenTimelineStatus: status,
        tokenTimelineTrustScore: timingUsable
          ? round(
              Math.max(
                0,
                1 -
                  localDrift.maximum /
                    Math.max(
                      configuration.hardMaximumTokenSegmentDriftSeconds,
                      0.001,
                    ),
              ),
            )
          : 0,
        quarantineReasons: [...new Set(quarantineReasons)].toSorted(),
        specialToken: special,
        boundaryClamped,
      });
    }
    const tokenIds = segment.tokens.map((token) => token.tokenId);
    outputSegments.push({
      segmentId: segment.segmentId,
      text: segment.text,
      start: segmentGlobalStart,
      end: segmentGlobalEnd,
      confidence: segment.confidence,
      tokenIds,
      rawStart: segment.rawStart,
      rawEnd: segment.rawEnd,
      rawCoordinateSystem: "original-audio-local",
      mappedCoordinateSystem: "original-media-global",
      timingUsable: true,
    });
    segmentHealth.push({
      segmentId: segment.segmentId,
      lexicalTokenCount: lexical.length,
      specialTokenCount: specialCount,
      usableTokenCount: usableCount,
      quarantinedTokenCount: lexical.length - usableCount,
      tokenSegmentContainmentRatio50ms: round(
        ratio(containment50, lexical.length),
      ),
      tokenSegmentContainmentRatioTrustTolerance: round(
        ratio(containmentTrust, lexical.length),
      ),
      tokenMonotonicityPassed: monotonic,
      zeroDurationLexicalTokenRatio: round(ratio(zeroCount, lexical.length)),
      boundaryClampedLexicalTokenRatio: round(
        ratio(boundaryCount, lexical.length),
      ),
      maximumEarlyDriftSeconds: round(maximumEarly),
      maximumLateDriftSeconds: round(maximumLate),
      maximumAbsoluteDriftSeconds: round(maximumDrift),
      rawCoordinateSystem:
        firstMapping?.rawCoordinateSystem ??
        (input.useVad ? "vad-processed-local" : "original-audio-local"),
      mappedCoordinateSystem: groupTrusted
        ? "original-media-global"
        : "unknown",
      tokenTimelineStatus: status,
      tokenTimelineTrustScore:
        lexical.length === 0
          ? 0
          : round(
              ratio(usableCount, lexical.length) *
                ratio(containmentTrust, lexical.length),
            ),
      quarantineReasons: [...new Set(groupReasons)].toSorted(),
    });
  }

  const trustedTokens = outputTokens.filter(
    (token) => token.timingUsable === true,
  );
  const lexicalTokens = outputTokens.filter(
    (token) => token.textUsable !== false && token.specialToken !== true,
  );
  const groups = segmentHealth.filter((health) => health.lexicalTokenCount > 0);
  const mappedLexicalTokens = lexicalTokens.filter(
    (token) =>
      token.mappingMethod === "official-mapped-token-getter" &&
      token.mappedStart !== null &&
      token.mappedStart !== undefined &&
      token.mappedEnd !== null &&
      token.mappedEnd !== undefined,
  );
  const integrity = timestampAttemptIntegritySchema.parse({
    attemptId: input.attemptId,
    profile: input.profile,
    useVad: input.useVad,
    rawTokenCoordinateSystem:
      groups[0]?.rawCoordinateSystem ??
      (input.useVad ? "vad-processed-local" : "original-audio-local"),
    mappedTokenCoordinateSystem:
      trustedTokens.length > 0 ? "original-media-global" : "unknown",
    mappingMethod:
      trustedTokens[0]?.mappingMethod ??
      (input.useVad ? "quarantined" : "unmapped"),
    mappingVersion: configuration.timestampMappingVersion,
    segmentHealth,
    attemptMetrics: {
      segmentCount: input.segments.length,
      segmentWithTokenCount: groups.length,
      trustedSegmentTokenGroupCount: groups.filter((health) =>
        health.tokenTimelineStatus.startsWith("trusted"),
      ).length,
      untrustedSegmentTokenGroupCount: groups.filter(
        (health) => !health.tokenTimelineStatus.startsWith("trusted"),
      ).length,
      lexicalTokenCount: lexicalTokens.length,
      trustedTokenCount: trustedTokens.length,
      quarantinedTokenCount: lexicalTokens.length - trustedTokens.length,
      tokenSegmentContainmentRatio: round(
        ratio(
          groups.reduce(
            (sum, health) =>
              sum +
              health.tokenSegmentContainmentRatioTrustTolerance *
                health.lexicalTokenCount,
            0,
          ),
          lexicalTokens.length,
        ),
      ),
      zeroDurationTokenRatio: round(
        ratio(
          groups.reduce(
            (sum, health) =>
              sum +
              health.zeroDurationLexicalTokenRatio * health.lexicalTokenCount,
            0,
          ),
          lexicalTokens.length,
        ),
      ),
      boundaryClampedTokenRatio: round(
        ratio(
          groups.reduce(
            (sum, health) =>
              sum +
              health.boundaryClampedLexicalTokenRatio *
                health.lexicalTokenCount,
            0,
          ),
          lexicalTokens.length,
        ),
      ),
      maximumTokenSegmentDriftSeconds: round(
        Math.max(
          0,
          ...groups.map((health) => health.maximumAbsoluteDriftSeconds),
        ),
      ),
      tokenTimestampsRequested: input.tokenTimestampsRequested,
      tokenTimestampsReturned: outputTokens.length > 0,
      trustedTokenTimestampsAvailable: trustedTokens.length > 0,
      trustedTokenTimestampsUsed: false,
      decodedSegmentIntervalsAvailable: outputSegments.length > 0,
      rawVadIntervalsAvailable: (input.rawVadIntervals?.length ?? 0) > 0,
      mappedTokenCount: mappedLexicalTokens.length,
      mappedTokenTrustedCount: mappedLexicalTokens.filter(
        (token) => token.timingUsable === true,
      ).length,
      mappedTokenQuarantinedCount: mappedLexicalTokens.filter(
        (token) => token.timingUsable !== true,
      ).length,
      rawVadTrustedIntervalCount: rawVadEvaluations.filter(
        (evaluation) => evaluation.timingUsable,
      ).length,
      rawVadBoundaryNormalizedIntervalCount: rawVadEvaluations.filter(
        (evaluation) => evaluation.normalizationApplied,
      ).length,
      rawVadInvalidIntervalCount: rawVadEvaluations.filter(
        (evaluation) => !evaluation.timingUsable,
      ).length,
      rawVadMaximumNormalizationDeltaSeconds: round(
        Math.max(
          0,
          ...rawVadEvaluations.map((evaluation) =>
            Math.max(
              evaluation.normalizationDeltaStart,
              evaluation.normalizationDeltaEnd,
            ),
          ),
        ),
      ),
    },
    trustedTokenIds: trustedTokens.map((token) => token.tokenId).toSorted(),
    quarantinedTokenIds: outputTokens
      .filter((token) => token.timingUsable !== true)
      .map((token) => token.tokenId)
      .toSorted(),
    quarantineReasons: [
      ...new Set(segmentHealth.flatMap((health) => health.quarantineReasons)),
    ].toSorted(),
    nominalExtractionInterval: input.extractionInterval,
    nominalDurationSeconds: round(duration),
    actualAudioDurationSeconds: round(actualAudioDurationSeconds),
    actualAudioLocalEndSeconds: round(actualAudioDurationSeconds),
    actualMediaGlobalEndSeconds: round(
      input.extractionInterval.start + actualAudioDurationSeconds,
    ),
    durationDifferenceSeconds: round(actualAudioDurationSeconds - duration),
    durationMeasurementMethod:
      input.durationMeasurementMethod ?? "nominal-extraction-interval-fallback",
    rawVadEvaluations: rawVadEvaluations.map((evaluation) => ({
      intervalId: evaluation.interval.intervalId,
      rawStart: Number.isFinite(evaluation.interval.start)
        ? evaluation.interval.start
        : null,
      rawEnd: Number.isFinite(evaluation.interval.end)
        ? evaluation.interval.end
        : null,
      rawCoordinateSystem: evaluation.coordinateSystem,
      normalizedStart:
        evaluation.timingUsable && Number.isFinite(evaluation.normalizedStart)
          ? evaluation.normalizedStart
          : null,
      normalizedEnd:
        evaluation.timingUsable && Number.isFinite(evaluation.normalizedEnd)
          ? evaluation.normalizedEnd
          : null,
      normalizationApplied: evaluation.normalizationApplied,
      normalizationDeltaStart: evaluation.normalizationDeltaStart,
      normalizationDeltaEnd: evaluation.normalizationDeltaEnd,
      normalizationReason: evaluation.normalizationReason,
      healthStatus: evaluation.healthStatus,
      timingTrustScore: evaluation.timingTrustScore,
      timingUsable: evaluation.timingUsable,
      evidenceLineageId: `whisper-internal-vad:${input.attemptId}:${evaluation.interval.intervalId}:${String(evaluation.index)}`,
    })),
  });
  return {
    segments: outputSegments,
    tokens: outputTokens,
    decodedSegmentIntervals: outputSegments.map((segment) => ({
      intervalId: segment.segmentId,
      source: "decoded-segment" as const,
      coordinateSystem: "original-media-global" as const,
      start: segment.start,
      end: segment.end,
      timingUsable: true,
    })),
    mappedTrustedTokenIntervals: trustedTokens.flatMap((token) =>
      token.mappedStart === null ||
      token.mappedStart === undefined ||
      token.mappedEnd === null ||
      token.mappedEnd === undefined
        ? []
        : [
            {
              intervalId: token.tokenId,
              source: input.useVad
                ? ("trusted-mapped-token" as const)
                : ("trusted-no-vad-token" as const),
              coordinateSystem: "original-media-global" as const,
              start: token.mappedStart,
              end: token.mappedEnd,
              timingUsable: true,
            },
          ],
    ),
    rawVadIntervals: rawVadEvaluations.flatMap((evaluation) => {
      if (!evaluation.timingUsable) return [];
      const { interval, index, coordinateSystem, mappedStart, mappedEnd } =
        evaluation;
      return [
        {
          intervalId: interval.intervalId,
          source: "raw-vad" as const,
          coordinateSystem: "original-media-global" as const,
          start: mappedStart,
          end: mappedEnd,
          timingUsable: true,
          rawStart: interval.start,
          rawEnd: interval.end,
          ...(runtimeStabilizationActive
            ? {
                normalizedStart: evaluation.normalizedStart,
                normalizedEnd: evaluation.normalizedEnd,
                normalizationApplied: evaluation.normalizationApplied,
                normalizationDeltaStart: evaluation.normalizationDeltaStart,
                normalizationDeltaEnd: evaluation.normalizationDeltaEnd,
                normalizationReason: evaluation.normalizationReason,
              }
            : {}),
          rawCoordinateSystem: coordinateSystem,
          mappingMethod: "verified-original-audio-local-offset" as const,
          rawVadIntervalHealthStatus: evaluation.healthStatus,
          ...(runtimeStabilizationActive
            ? {
                healthStatus: evaluation.healthStatus,
                timingTrustScore: evaluation.timingTrustScore,
              }
            : {}),
          evidenceLineageId: `whisper-internal-vad:${input.attemptId}:${interval.intervalId}:${String(index)}`,
        },
      ];
    }),
    sourceCueIntervals: (input.sourceCueIntervals ?? []).map((interval) => ({
      ...interval,
      source: "source-cue" as const,
      coordinateSystem: "original-media-global" as const,
      timingUsable: true,
    })),
    integrity,
  };
}

export function buildTimestampEvidenceIntegrityArtifact(input: {
  generatedAt?: string;
  sourceOverlapArtifactHash: string;
  runtimeCapability: TimestampRuntimeCapability;
  mode: TimestampEvidenceIntegrityMode;
  tokenTimestampPolicy: TokenTimestampPolicy;
  legacyOverlapCachePolicy: LegacyOverlapCachePolicy;
  attempts: readonly TimestampAttemptIntegrity[];
  configuration?: Partial<TimestampHealthConfiguration>;
  trustedTokenUsedForTimingIds?: ReadonlySet<string>;
  untrustedTokenUsedForTimingIds?: ReadonlySet<string>;
  rawVadIntervalCount?: number;
  integrityGateFailures?: readonly string[];
}): SubtitleTimestampEvidenceIntegrity {
  const configuration = {
    ...DEFAULT_TIMESTAMP_HEALTH_CONFIGURATION,
    ...input.configuration,
  };
  const health = input.attempts.flatMap((attempt) => attempt.segmentHealth);
  const metrics = input.attempts.map((attempt) => attempt.attemptMetrics);
  const integrityPayload = {
    attempts: input.attempts,
    runtimeTimestampCapabilityHash:
      input.runtimeCapability.runtimeTimestampCapabilityHash,
    configuration,
  };
  return subtitleTimestampEvidenceIntegritySchema.parse({
    schemaVersion: "1.0.0",
    artifactType: "subtitle-timestamp-evidence-integrity",
    integrityVersion: "C5.16.1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    sourceOverlapArtifactHash: input.sourceOverlapArtifactHash,
    runtimeCapability: input.runtimeCapability,
    configuration: {
      ...configuration,
      mode: input.mode,
      tokenTimestampPolicy: input.tokenTimestampPolicy,
      legacyOverlapCachePolicy: input.legacyOverlapCachePolicy,
    },
    attempts: input.attempts,
    summary: {
      segmentTokenGroupCount: health.filter(
        (item) => item.lexicalTokenCount > 0,
      ).length,
      containmentFailureCount50ms: health.filter(
        (item) =>
          item.lexicalTokenCount > 0 &&
          item.tokenSegmentContainmentRatio50ms < 1,
      ).length,
      containmentFailureCountTrustTolerance: health.filter(
        (item) =>
          item.lexicalTokenCount > 0 &&
          item.tokenSegmentContainmentRatioTrustTolerance < 1,
      ).length,
      nonMonotonicGroupCount: health.filter(
        (item) => !item.tokenMonotonicityPassed,
      ).length,
      zeroCollapsedGroupCount: health.filter(
        (item) =>
          item.zeroDurationLexicalTokenRatio >
          configuration.maximumZeroDurationLexicalTokenRatio,
      ).length,
      boundaryClampedGroupCount: health.filter(
        (item) =>
          item.boundaryClampedLexicalTokenRatio >
          configuration.maximumBoundaryClampedLexicalTokenRatio,
      ).length,
      largeDriftGroupCount: health.filter(
        (item) =>
          item.maximumAbsoluteDriftSeconds >
          configuration.hardMaximumTokenSegmentDriftSeconds,
      ).length,
      lexicalTokenCount: metrics.reduce(
        (sum, item) => sum + item.lexicalTokenCount,
        0,
      ),
      trustedTokenCount: metrics.reduce(
        (sum, item) => sum + item.trustedTokenCount,
        0,
      ),
      quarantinedTokenCount: metrics.reduce(
        (sum, item) => sum + item.quarantinedTokenCount,
        0,
      ),
      untrustedTokenUsedForTimingCount:
        input.untrustedTokenUsedForTimingIds?.size ?? 0,
      trustedTokenUsedForTimingCount:
        input.trustedTokenUsedForTimingIds?.size ?? 0,
      mappedVadTokenCount: input.attempts
        .filter((attempt) => attempt.useVad)
        .reduce(
          (sum, attempt) =>
            sum +
            (attempt.attemptMetrics.mappedTokenCount ??
              attempt.attemptMetrics.trustedTokenCount),
          0,
        ),
      legacyVadTokenQuarantinedCount: input.attempts
        .filter((attempt) => attempt.useVad)
        .reduce(
          (sum, attempt) => sum + attempt.attemptMetrics.quarantinedTokenCount,
          0,
        ),
      decodedSegmentCount: metrics.reduce(
        (sum, item) => sum + item.segmentCount,
        0,
      ),
      rawVadIntervalCount:
        input.rawVadIntervalCount ??
        metrics.reduce(
          (sum, item) =>
            sum +
            (item.rawVadTrustedIntervalCount ?? 0) +
            (item.rawVadInvalidIntervalCount ?? 0),
          0,
        ),
      mappedNoVadTokenCount: input.attempts
        .filter((attempt) => !attempt.useVad)
        .reduce(
          (sum, attempt) =>
            sum +
            (attempt.attemptMetrics.mappedTokenCount ??
              attempt.attemptMetrics.trustedTokenCount),
          0,
        ),
      mappedTokenContainmentFailureCount: health.filter(
        (item) =>
          item.lexicalTokenCount > 0 &&
          item.tokenSegmentContainmentRatioTrustTolerance < 1,
      ).length,
      mappedTokenMonotonicityFailureCount: health.filter(
        (item) => !item.tokenMonotonicityPassed,
      ).length,
      mappedTokenQuarantinedCount: metrics.reduce(
        (sum, item) =>
          sum +
          (item.mappedTokenQuarantinedCount ?? item.quarantinedTokenCount),
        0,
      ),
      mappedTokenTrustedCount: metrics.reduce(
        (sum, item) =>
          sum + (item.mappedTokenTrustedCount ?? item.trustedTokenCount),
        0,
      ),
      rawVadTrustedIntervalCount: metrics.reduce(
        (sum, item) => sum + (item.rawVadTrustedIntervalCount ?? 0),
        0,
      ),
      rawVadFullyTrustedCount: metrics.reduce(
        (sum, item) =>
          sum +
          Math.max(
            0,
            (item.rawVadTrustedIntervalCount ?? 0) -
              (item.rawVadBoundaryNormalizedIntervalCount ?? 0),
          ),
        0,
      ),
      rawVadBoundaryNormalizedCount: metrics.reduce(
        (sum, item) => sum + (item.rawVadBoundaryNormalizedIntervalCount ?? 0),
        0,
      ),
      rawVadInvalidIntervalCount: metrics.reduce(
        (sum, item) => sum + (item.rawVadInvalidIntervalCount ?? 0),
        0,
      ),
      rawVadMaximumNormalizationDeltaSeconds: round(
        Math.max(
          0,
          ...metrics.map(
            (item) => item.rawVadMaximumNormalizationDeltaSeconds ?? 0,
          ),
        ),
      ),
      runtimeCapabilityVerified:
        input.runtimeCapability.timestampCapabilityStatus ===
          "mapped-original-timeline" &&
        input.runtimeCapability.mappedTokenGetterAvailable &&
        input.runtimeCapability.mappedTokenGetterActuallyUsed &&
        (!input.runtimeCapability.rawVadGetterAvailable ||
          input.runtimeCapability.rawVadGetterActuallyUsed),
      runtimeResponseSchemaVerified:
        input.runtimeCapability.serverResponseFormat ===
          "mvl-whisper-server-response/1.0.0" &&
        input.runtimeCapability.timestampCapabilityStatus ===
          "mapped-original-timeline",
      unknownCoordinateTokenUsedForTimingCount: 0,
      decodedSegmentMislabelledAsRawVadCount: (
        input.integrityGateFailures ?? []
      ).includes("DECODED_SEGMENT_MISLABELED_AS_RAW_VAD")
        ? 1
        : 0,
      maximumObservedDriftSeconds: round(
        Math.max(
          0,
          ...metrics.map((item) => item.maximumTokenSegmentDriftSeconds),
        ),
      ),
      integrityGateFailures: [
        ...new Set([
          ...((input.untrustedTokenUsedForTimingIds?.size ?? 0) > 0
            ? ["UNTRUSTED_TOKEN_USED_FOR_TIMING"]
            : []),
          ...(input.integrityGateFailures ?? []),
        ]),
      ].toSorted(),
      integrityHash: timestampIntegrityHash(integrityPayload),
    },
  });
}

export type TimestampIntegrityGateFailure =
  | "UNTRUSTED_TOKEN_USED_FOR_TIMING"
  | "UNKNOWN_COORDINATE_TOKEN_USED_FOR_TIMING"
  | "TOKEN_OUTSIDE_PARENT_SEGMENT_USED"
  | "NON_MONOTONIC_TOKEN_SEQUENCE_USED"
  | "ZERO_COLLAPSED_TOKEN_SEQUENCE_USED"
  | "LEGACY_UNVERSIONED_TOKEN_USED_FOR_TIMING"
  | "DECODED_SEGMENT_MISLABELED_AS_RAW_VAD"
  | "TIMESTAMP_CAPABILITY_CLAIM_UNVERIFIED";

export function evaluateTimestampEvidenceIntegrityGate(input: {
  attempts: readonly OverlapAcousticAttempt[];
  alignments: readonly OverlapCueAlignment[];
  runtimeCapability?: TimestampRuntimeCapability;
}): TimestampIntegrityGateFailure[] {
  const tokenById = new Map(
    input.attempts.flatMap((attempt) =>
      attempt.tokens.map((token) => [token.tokenId, token] as const),
    ),
  );
  const segmentIds = new Set(
    input.attempts.flatMap((attempt) =>
      attempt.segments.map((segment) => segment.segmentId),
    ),
  );
  const rawVadIds = new Set(
    input.attempts.flatMap((attempt) =>
      (attempt.rawVadIntervals ?? []).map((interval) => interval.intervalId),
    ),
  );
  const timingIntervals = input.alignments.flatMap(
    (alignment) => alignment.matchedIntervals,
  );
  const timingTokens = timingIntervals.flatMap((interval) => {
    if (
      interval.source !== "trusted-mapped-token" &&
      interval.source !== "trusted-no-vad-token" &&
      interval.source !== "token" &&
      interval.source !== "legacy-token-untrusted"
    )
      return [];
    return (interval.evidenceId ?? "").split("+").flatMap((id) => {
      const token = tokenById.get(id);
      return token === undefined ? [] : [token];
    });
  });
  const failures: TimestampIntegrityGateFailure[] = [];
  if (
    timingIntervals.some(
      (interval) =>
        interval.timingUsable === false ||
        interval.source === "legacy-token-untrusted",
    ) ||
    timingTokens.some((token) => token.timingUsable === false)
  )
    failures.push("UNTRUSTED_TOKEN_USED_FOR_TIMING");
  if (
    timingTokens.some(
      (token) =>
        token.mappedCoordinateSystem !== undefined &&
        token.mappedCoordinateSystem !== "original-media-global",
    )
  )
    failures.push("UNKNOWN_COORDINATE_TOKEN_USED_FOR_TIMING");
  if (
    timingTokens.some(
      (token) =>
        token.quarantineReasons?.includes("TOKEN_OUTSIDE_PARENT_SEGMENT") ===
        true,
    ) ||
    timingIntervals.some(
      (interval) => interval.parentSegmentContainmentPassed === false,
    )
  )
    failures.push("TOKEN_OUTSIDE_PARENT_SEGMENT_USED");
  if (
    timingTokens.some((token) => token.tokenTimelineStatus === "non-monotonic")
  )
    failures.push("NON_MONOTONIC_TOKEN_SEQUENCE_USED");
  if (
    timingTokens.some((token) => token.tokenTimelineStatus === "zero-collapsed")
  )
    failures.push("ZERO_COLLAPSED_TOKEN_SEQUENCE_USED");
  if (
    timingTokens.some(
      (token) =>
        token.mappingVersion === undefined ||
        token.mappingVersion === "legacy-unversioned",
    )
  )
    failures.push("LEGACY_UNVERSIONED_TOKEN_USED_FOR_TIMING");
  if (
    timingIntervals.some(
      (interval) =>
        (interval.source === "raw-vad" || interval.source === "vad") &&
        ((interval.evidenceId !== undefined &&
          segmentIds.has(interval.evidenceId)) ||
          (interval.evidenceId !== undefined &&
            !rawVadIds.has(interval.evidenceId))),
    )
  )
    failures.push("DECODED_SEGMENT_MISLABELED_AS_RAW_VAD");
  if (
    input.runtimeCapability !== undefined &&
    (input.runtimeCapability.timestampCapabilityStatus === "unverified" ||
      (input.runtimeCapability.mappedTokenGetterActuallyUsed &&
        !input.runtimeCapability.mappedTokenGetterAvailable) ||
      (input.runtimeCapability.rawVadGetterActuallyUsed &&
        !input.runtimeCapability.rawVadGetterAvailable))
  )
    failures.push("TIMESTAMP_CAPABILITY_CLAIM_UNVERIFIED");
  return [...new Set(failures)].toSorted();
}

export function auditLegacyOverlapAttempt(
  attempt: OverlapAcousticAttempt,
  configuration: TimestampHealthConfiguration = DEFAULT_TIMESTAMP_HEALTH_CONFIGURATION,
  extractionInterval?: { start: number; end: number },
): {
  segmentTokenGroupCount: number;
  containmentFailureCount50ms: number;
  containmentFailureCountTrustTolerance: number;
  zeroDurationTokenCount: number;
  boundaryClampedTokenCount: number;
  maximumObservedDriftSeconds: number;
} {
  const tokenById = new Map(
    attempt.tokens.map((token) => [token.tokenId, token]),
  );
  let groups = 0;
  let failures50 = 0;
  let failuresTrust = 0;
  let zero = 0;
  let boundary = 0;
  let maximum = 0;
  for (const segment of attempt.segments) {
    const tokens = segment.tokenIds.flatMap((id) => {
      const token = tokenById.get(id);
      return token === undefined ? [] : [token];
    });
    if (tokens.length === 0) continue;
    groups += 1;
    const contained50 = tokens.every((token) =>
      intervalContained({
        tokenStart: token.start,
        tokenEnd: token.end,
        segmentStart: segment.start,
        segmentEnd: segment.end,
        tolerance: configuration.auditContainmentToleranceSeconds,
      }),
    );
    const containedTrust = tokens.every((token) =>
      intervalContained({
        tokenStart: token.start,
        tokenEnd: token.end,
        segmentStart: segment.start,
        segmentEnd: segment.end,
        tolerance: configuration.trustContainmentToleranceSeconds,
      }),
    );
    if (!contained50) failures50 += 1;
    if (!containedTrust) failuresTrust += 1;
    for (const token of tokens) {
      if (token.end <= token.start) zero += 1;
      if (
        extractionInterval !== undefined &&
        (Math.abs(token.start - extractionInterval.start) <= 1e-9 ||
          Math.abs(token.end - extractionInterval.end) <= 1e-9)
      )
        boundary += 1;
      maximum = Math.max(
        maximum,
        Math.max(0, segment.start - token.start, token.end - segment.end),
      );
    }
  }
  return {
    segmentTokenGroupCount: groups,
    containmentFailureCount50ms: failures50,
    containmentFailureCountTrustTolerance: failuresTrust,
    zeroDurationTokenCount: zero,
    boundaryClampedTokenCount: boundary,
    maximumObservedDriftSeconds: round(maximum),
  };
}
