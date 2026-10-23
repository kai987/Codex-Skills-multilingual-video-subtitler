import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  asrRequestTimelineContractSchema,
  c6012PolicyVersion,
  portableAsrCacheEntryV2Schema,
  type AsrCacheManifestArtifact,
  type AsrRequestTimelineContract,
  type PortableAsrCacheEntryV2,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";

interface RecoveryInput {
  units: readonly {
    interval: { start: number; end: number };
    extractedInterval: { start: number; end: number };
    id?: string;
    attempts: readonly {
      asrRequestId: string;
      vadEnabled: boolean;
      cacheKey: string;
    }[];
  }[];
}

interface LyricsInput {
  regions: readonly {
    attempts: readonly {
      id: string;
      interval: { start: number; end: number };
      asrRequestId: string;
      vadEnabled: boolean;
      cacheKey: string;
    }[];
  }[];
}

interface ArtifactRequest {
  requestId: string;
  parentRequestId: string | null;
  requestedInterval: { start: number; end: number };
  extractedInterval: { start: number; end: number };
  vadEnabled: boolean;
  cacheKey: string;
}

type TimelineRequest = AsrRequestTimelineContract["requests"][number];

function timelineArtifact(input: {
  requests: readonly TimelineRequest[];
  generatedAt?: string;
}): AsrRequestTimelineContract {
  const requests = [...input.requests].toSorted((left, right) =>
    left.requestId.localeCompare(right.requestId),
  );
  const semanticHash = machineQualitySemanticHash(requests);
  return asrRequestTimelineContractSchema.parse({
    schemaVersion: "1.0.0",
    policyVersion: c6012PolicyVersion,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    artifactType: "asr-request-timeline-contract",
    requests,
    summary: {
      requestCount: requests.length,
      verifiedRequestCount: requests.filter(
        (request) => request.contractStatus === "verified",
      ).length,
      quarantinedRequestCount: requests.filter(
        (request) => request.contractStatus === "quarantined",
      ).length,
      unavailableRequestCount: requests.filter(
        (request) => request.contractStatus === "unavailable",
      ).length,
    },
    semanticHash,
  });
}

function requestType(
  value: AsrCacheManifestArtifact["entries"][number]["requestType"],
): TimelineRequest["requestType"] {
  if (value === "coverage-recovery") return "coverage";
  if (value === "overlap-evidence") return "overlap";
  return value;
}

function artifactRequests(input: {
  recovery: RecoveryInput;
  lyrics?: LyricsInput;
}): ArtifactRequest[] {
  return [
    ...input.recovery.units.flatMap((unit) =>
      unit.attempts.map((attempt) => ({
        requestId: attempt.asrRequestId,
        parentRequestId: unit.id ?? null,
        requestedInterval: unit.interval,
        extractedInterval: unit.extractedInterval,
        vadEnabled: attempt.vadEnabled,
        cacheKey: attempt.cacheKey,
      })),
    ),
    ...(input.lyrics?.regions.flatMap((region) =>
      region.attempts.map((attempt) => ({
        requestId: attempt.asrRequestId,
        parentRequestId: attempt.id,
        requestedInterval: attempt.interval,
        extractedInterval: attempt.interval,
        vadEnabled: attempt.vadEnabled,
        cacheKey: attempt.cacheKey,
      })),
    ) ?? []),
  ];
}

function portableEntryPath(root: string, key: string): string {
  return path.join(root, key.slice(0, 2), `${key}.json`);
}

async function readPortableEntry(
  root: string | null,
  key: string,
): Promise<PortableAsrCacheEntryV2 | null> {
  if (root === null) return null;
  try {
    const parsed = portableAsrCacheEntryV2Schema.parse(
      JSON.parse(await readFile(portableEntryPath(root, key), "utf8")),
    );
    if (
      parsed.cacheKey !== key ||
      parsed.resultSha256 !== machineQualitySemanticHash(parsed.result)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function manifestTimelineRequest(input: {
  sourceMediaSha256: string;
  manifestEntry: AsrCacheManifestArtifact["entries"][number];
  portableEntry: PortableAsrCacheEntryV2 | null;
  artifactRequest?: ArtifactRequest;
}): TimelineRequest {
  const { manifestEntry, portableEntry, artifactRequest } = input;
  const identity = portableEntry?.identity;
  const identityInterval =
    identity === undefined
      ? null
      : {
          start: identity.extractedIntervalMilliseconds.start / 1000,
          end: identity.extractedIntervalMilliseconds.end / 1000,
        };
  const extractedInterval = artifactRequest?.extractedInterval ??
    identityInterval ?? {
      start: 0,
      end: 0.001,
    };
  const requestedInterval =
    artifactRequest?.requestedInterval ?? extractedInterval;
  const sampleRate = identity?.extraction.sampleRate ?? 16000;
  const duration = extractedInterval.end - extractedInterval.start;
  const artifactIntervalMatches =
    artifactRequest === undefined ||
    identityInterval === null ||
    (Math.abs(
      artifactRequest.extractedInterval.start - identityInterval.start,
    ) <= 0.001 &&
      Math.abs(artifactRequest.extractedInterval.end - identityInterval.end) <=
        0.001);
  const decoderTimelineValid =
    portableEntry === null ||
    portableEntry.result.segments.every(
      (segment, index, segments) =>
        Number.isFinite(segment.start) &&
        Number.isFinite(segment.end) &&
        segment.start >= 0 &&
        segment.end > segment.start &&
        segment.end <= duration + 0.1 &&
        (index === 0 || segment.start >= (segments[index - 1]?.start ?? 0)),
    );
  const vadEnabled =
    artifactRequest?.vadEnabled ??
    (identity === undefined
      ? true
      : !/(?:no-vad|suppress-nst)/iu.test(
          `${identity.vadMode}:${identity.model}`,
        ));
  const portableIdentityVerified =
    portableEntry !== null && artifactIntervalMatches && decoderTimelineValid;
  const verified = portableIdentityVerified && !vadEnabled;
  const contractStatus =
    portableEntry !== null
      ? verified
        ? ("verified" as const)
        : ("quarantined" as const)
      : ("unavailable" as const);
  const requestId = artifactRequest?.requestId ?? manifestEntry.requestId;
  const requestAliases = [
    ...new Set([manifestEntry.requestId, requestId]),
  ].filter((alias) => alias !== requestId);
  const requestPayload = {
    requestId,
    manifestRequestId: manifestEntry.requestId,
    requestAliases,
    sourceMediaSha256: input.sourceMediaSha256,
    requestType: requestType(manifestEntry.requestType),
    requestedInterval,
    extractedInterval,
    sourceMediaStartSeconds: extractedInterval.start,
    sourceMediaEndSeconds: extractedInterval.end,
    requestedIntervalStart: requestedInterval.start,
    requestedIntervalEnd: requestedInterval.end,
    extractedAudioStart: extractedInterval.start,
    extractedAudioEnd: extractedInterval.end,
    extractedAudioDurationSeconds: duration,
    sampleRate,
    sampleCount: Math.round(duration * sampleRate),
    decoderChunkStartSeconds: 0 as const,
    ffmpegSeekMode: "input-seek-before-i" as const,
    ffmpegInputSeekSeconds: extractedInterval.start,
    ffmpegOutputTrimSeconds: 0 as const,
    ffmpegSeekPlacement: "before-input" as const,
    ffmpegOutputTimeOrigin: "zero" as const,
    decodeAudioZero: 0 as const,
    decoderReportedSegmentStart:
      portableEntry?.result.segments[0]?.start ?? null,
    decoderReportedSegmentEnd:
      portableEntry?.result.segments.at(-1)?.end ?? null,
    tokenTimeBase: portableIdentityVerified
      ? vadEnabled
        ? ("vad-processed-local" as const)
        : ("original-audio-local" as const)
      : ("unknown" as const),
    cacheIdentity: manifestEntry.currentKey,
    cacheLineage: {
      currentKey: manifestEntry.currentKey,
      legacyKeys: manifestEntry.legacyKeysTried,
      entryStatus: portableIdentityVerified
        ? ("portable-verified" as const)
        : artifactRequest === undefined
          ? ("unavailable" as const)
          : ("artifact-derived" as const),
    },
    parentRequestId: artifactRequest?.parentRequestId ?? null,
    vadEnabled,
    coordinateSystem: portableIdentityVerified
      ? vadEnabled
        ? ("vad-processed-local" as const)
        : ("original-audio-local" as const)
      : ("unknown" as const),
    mappingMethod: portableIdentityVerified
      ? vadEnabled
        ? ("unverified-vad-coordinate" as const)
        : ("verified-extraction-offset" as const)
      : ("unavailable" as const),
    contractStatus,
    evidence: portableIdentityVerified
      ? vadEnabled
        ? [
            "portable-cache-identity-exact-match",
            "ffmpeg-extraction-origin-verified",
            "decoder-chunk-start-zero",
            "vad-remapping-not-proven",
          ]
        : [
            "portable-cache-identity-exact-match",
            "audio-content-hash-bound",
            "extracted-interval-bound",
            "ffmpeg-input-seek-produces-standalone-pcm",
            "decoder-chunk-start-zero",
            "no-vad-preserves-original-extracted-audio-coordinate",
          ]
      : [
          portableEntry === null
            ? "portable-cache-entry-unavailable"
            : !artifactIntervalMatches
              ? "artifact-cache-interval-lineage-mismatch"
              : "decoder-segment-timeline-invalid",
          "token-mapping-fails-closed",
        ],
    exactGlobalOffset: verified ? extractedInterval.start : null,
    offsetSource: verified
      ? "verified-portable-cache-extraction-start"
      : vadEnabled
        ? "unverified-vad-processed-coordinate"
        : "portable-cache-entry-unavailable",
    offsetVerified: verified,
  };
  return {
    ...requestPayload,
    timelineSemanticHash: machineQualitySemanticHash(requestPayload),
  };
}

/**
 * Recovery audio is extracted by ffmpeg with input-side `-ss`, encoded as a
 * standalone PCM WAV, and passed to Whisper with chunk.start=0. No-VAD token
 * times therefore have an auditable extraction-local origin. VAD time remains
 * a processed coordinate system and is deliberately quarantined.
 */
export function buildAsrRequestTimelineContract(input: {
  sourceMediaSha256: string;
  recovery: RecoveryInput;
  generatedAt?: string;
}): AsrRequestTimelineContract {
  const requests = input.recovery.units.flatMap((unit) =>
    unit.attempts.map((attempt) => {
      const vadEnabled = attempt.vadEnabled;
      const duration =
        unit.extractedInterval.end - unit.extractedInterval.start;
      const requestPayload = {
        requestId: attempt.asrRequestId,
        manifestRequestId: null,
        requestAliases: [],
        sourceMediaSha256: input.sourceMediaSha256,
        requestType: "recovery" as const,
        requestedInterval: unit.interval,
        extractedInterval: unit.extractedInterval,
        sourceMediaStartSeconds: unit.extractedInterval.start,
        sourceMediaEndSeconds: unit.extractedInterval.end,
        requestedIntervalStart: unit.interval.start,
        requestedIntervalEnd: unit.interval.end,
        extractedAudioStart: unit.extractedInterval.start,
        extractedAudioEnd: unit.extractedInterval.end,
        extractedAudioDurationSeconds: duration,
        sampleRate: 16000 as const,
        sampleCount: Math.round(duration * 16000),
        decoderChunkStartSeconds: 0 as const,
        ffmpegSeekMode: "input-seek-before-i" as const,
        ffmpegInputSeekSeconds: unit.extractedInterval.start,
        ffmpegOutputTrimSeconds: 0 as const,
        ffmpegSeekPlacement: "before-input" as const,
        ffmpegOutputTimeOrigin: "zero" as const,
        decodeAudioZero: 0 as const,
        decoderReportedSegmentStart: null,
        decoderReportedSegmentEnd: null,
        tokenTimeBase: vadEnabled
          ? ("vad-processed-local" as const)
          : ("original-audio-local" as const),
        cacheIdentity: attempt.cacheKey,
        cacheLineage: {
          currentKey: attempt.cacheKey,
          legacyKeys: [],
          entryStatus: "artifact-derived" as const,
        },
        parentRequestId: unit.id ?? null,
        vadEnabled,
        coordinateSystem: vadEnabled
          ? ("vad-processed-local" as const)
          : ("original-audio-local" as const),
        mappingMethod: vadEnabled
          ? ("unverified-vad-coordinate" as const)
          : ("verified-extraction-offset" as const),
        contractStatus: vadEnabled
          ? ("quarantined" as const)
          : ("verified" as const),
        evidence: vadEnabled
          ? [
              "ffmpeg-extraction-origin-verified",
              "decoder-chunk-start-zero",
              "vad-remapping-not-proven",
            ]
          : [
              "ffmpeg-input-seek-produces-standalone-pcm",
              "decoder-chunk-start-zero",
              "no-vad-preserves-original-extracted-audio-coordinate",
            ],
        exactGlobalOffset: vadEnabled ? null : unit.extractedInterval.start,
        offsetSource: vadEnabled
          ? "unverified-vad-processed-coordinate"
          : "verified-ffmpeg-extraction-start",
        offsetVerified: !vadEnabled,
      };
      return {
        ...requestPayload,
        timelineSemanticHash: machineQualitySemanticHash(requestPayload),
      };
    }),
  );
  return timelineArtifact({
    requests,
    ...(input.generatedAt === undefined
      ? {}
      : { generatedAt: input.generatedAt }),
  });
}

/**
 * Materializes one auditable timeline record for every cache lookup. Recovery
 * and lyrics artifact IDs are retained as the primary IDs used by cue
 * provenance, while the lookup IDs are preserved as aliases. A missing or
 * non-exact portable entry never receives a trusted global offset.
 */
export async function buildCompleteAsrRequestTimelineContract(input: {
  sourceMediaSha256: string;
  recovery: RecoveryInput;
  lyrics?: LyricsInput;
  cacheManifest?: AsrCacheManifestArtifact;
  generatedAt?: string;
}): Promise<AsrRequestTimelineContract> {
  if (
    input.cacheManifest === undefined ||
    input.cacheManifest.entries.length === 0
  ) {
    return buildAsrRequestTimelineContract({
      sourceMediaSha256: input.sourceMediaSha256,
      recovery: input.recovery,
      ...(input.generatedAt === undefined
        ? {}
        : { generatedAt: input.generatedAt }),
    });
  }
  const byCacheKey = new Map<string, ArtifactRequest>();
  for (const request of artifactRequests({
    recovery: input.recovery,
    ...(input.lyrics === undefined ? {} : { lyrics: input.lyrics }),
  })) {
    byCacheKey.set(request.cacheKey, request);
  }
  const requests = await Promise.all(
    input.cacheManifest.entries.map(async (manifestEntry) => {
      const portableEntry = await readPortableEntry(
        input.cacheManifest?.portableRoot ?? null,
        manifestEntry.currentKey,
      );
      const artifactRequest = [
        manifestEntry.currentKey,
        ...manifestEntry.legacyKeysTried,
      ]
        .map((key) => byCacheKey.get(key))
        .find((request) => request !== undefined);
      return manifestTimelineRequest({
        sourceMediaSha256: input.sourceMediaSha256,
        manifestEntry,
        portableEntry,
        ...(artifactRequest === undefined ? {} : { artifactRequest }),
      });
    }),
  );
  return timelineArtifact({
    requests,
    ...(input.generatedAt === undefined
      ? {}
      : { generatedAt: input.generatedAt }),
  });
}
