import {
  InputError,
  globalTokenV2Schema,
  machineGlobalTokenTimelineV2Schema,
  type AsrRequestTimelineContractV2,
  type GlobalTokenV2,
  type MachineGlobalTokenTimelineV2,
} from "@mvl/shared";

import {
  machineQualitySemanticHash,
  normalizeCandidateText,
} from "./evidence-correlation.js";

export interface TokenObservationV2 {
  tokenId: string;
  requestId: string;
  cueId: string | null;
  text: string;
  probability: number | null;
  localStartCentiseconds: number | null;
  localEndCentiseconds: number | null;
  coordinateSystem:
    | "original-audio-local"
    | "mapped-original-audio-local"
    | "vad-processed-local"
    | "unknown";
  associationStatus: "assigned" | "pending" | "unassigned";
  cacheIdentity: string;
  freshEvidence: boolean;
}

function centisecondsToSamples(value: number, sampleRate: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new InputError("Token centiseconds must be nonnegative integers.");
  }
  const numerator = BigInt(value) * BigInt(sampleRate);
  if (numerator % 100n !== 0n) {
    throw new InputError(
      "Token centisecond boundary is not exactly representable in samples.",
      { value, sampleRate },
    );
  }
  return Number(numerator / 100n);
}

function convertLocalToSourceSample(input: {
  localSample: number;
  extractedSampleRate: number;
  sourceSampleRate: number;
  sourceGlobalStartSample: number;
  boundary: "start" | "end";
}): number {
  const numerator = BigInt(input.localSample) * BigInt(input.sourceSampleRate);
  const denominator = BigInt(input.extractedSampleRate);
  const scaled =
    input.boundary === "start"
      ? numerator / denominator
      : (numerator + denominator - 1n) / denominator;
  const result = BigInt(input.sourceGlobalStartSample) + scaled;
  const numeric = Number(result);
  if (!Number.isSafeInteger(numeric)) {
    throw new InputError("Mapped token sample exceeds safe integer range.");
  }
  return numeric;
}

export function buildGlobalTokenTimelineV2(input: {
  requestTimeline: AsrRequestTimelineContractV2;
  observations: readonly TokenObservationV2[];
  generatedAt?: string;
}): MachineGlobalTokenTimelineV2 {
  const requests = new Map(
    input.requestTimeline.requests.map((request) => [
      request.requestId,
      request,
    ]),
  );
  const lastEndByRequest = new Map<string, number>();
  let monotonicityFailureCount = 0;
  let containmentFailureCount = 0;
  const tokens: GlobalTokenV2[] = [...input.observations]
    .toSorted(
      (left, right) =>
        left.requestId.localeCompare(right.requestId) ||
        (left.localStartCentiseconds ?? Number.POSITIVE_INFINITY) -
          (right.localStartCentiseconds ?? Number.POSITIVE_INFINITY) ||
        left.tokenId.localeCompare(right.tokenId),
    )
    .map((observation) => {
      const request = requests.get(observation.requestId);
      const lexical = normalizeCandidateText(observation.text) !== "";
      const hasCompleteLocalTime =
        observation.localStartCentiseconds !== null &&
        observation.localEndCentiseconds !== null;
      const localStartSample =
        request === undefined || observation.localStartCentiseconds === null
          ? null
          : centisecondsToSamples(
              observation.localStartCentiseconds,
              request.extractedSampleRate,
            );
      const localEndSample =
        request === undefined || observation.localEndCentiseconds === null
          ? null
          : centisecondsToSamples(
              observation.localEndCentiseconds,
              request.extractedSampleRate,
            );
      const localIntervalValid =
        localStartSample !== null &&
        localEndSample !== null &&
        localEndSample > localStartSample;
      const contained =
        request !== undefined &&
        localStartSample !== null &&
        localEndSample !== null &&
        localStartSample >= 0 &&
        localEndSample <= request.extractedSampleCount &&
        localIntervalValid;
      if (request !== undefined && hasCompleteLocalTime && !contained) {
        containmentFailureCount += 1;
      }
      const mappedCoordinate = [
        "original-audio-local",
        "mapped-original-audio-local",
      ].includes(observation.coordinateSystem);
      const requestVerified = request?.mappingStatus === "VERIFIED";
      const sourceStart =
        request !== undefined &&
        contained &&
        mappedCoordinate &&
        localStartSample !== null
          ? convertLocalToSourceSample({
              localSample: localStartSample,
              extractedSampleRate: request.extractedSampleRate,
              sourceSampleRate: request.sourceSampleRate,
              sourceGlobalStartSample: request.sourceGlobalStartSample,
              boundary: "start",
            })
          : null;
      const sourceEnd =
        request !== undefined &&
        contained &&
        mappedCoordinate &&
        localEndSample !== null
          ? convertLocalToSourceSample({
              localSample: localEndSample,
              extractedSampleRate: request.extractedSampleRate,
              sourceSampleRate: request.sourceSampleRate,
              sourceGlobalStartSample: request.sourceGlobalStartSample,
              boundary: "end",
            })
          : null;
      const previousEnd = lastEndByRequest.get(observation.requestId);
      const monotonic =
        sourceStart === null ||
        previousEnd === undefined ||
        sourceStart >= previousEnd;
      if (!monotonic) monotonicityFailureCount += 1;
      const probabilityPassed =
        observation.probability !== null && observation.probability >= 0.45;
      const baseMappable =
        requestVerified &&
        mappedCoordinate &&
        contained &&
        monotonic &&
        sourceStart !== null &&
        sourceEnd !== null &&
        sourceEnd > sourceStart;
      const trusted =
        baseMappable &&
        lexical &&
        probabilityPassed &&
        observation.associationStatus === "assigned";
      const mappingStatus = trusted
        ? ("TRUSTED" as const)
        : baseMappable && observation.associationStatus === "pending"
          ? ("ASSOCIATION_PENDING" as const)
          : request === undefined
            ? ("UNMAPPED" as const)
            : !hasCompleteLocalTime
              ? ("UNMAPPED" as const)
              : !mappedCoordinate && request.vadEnabled
                ? ("AMBIGUOUS_TIME_BASE" as const)
                : baseMappable
                  ? ("UNTRUSTED" as const)
                  : request.mappingStatus === "QUARANTINED" &&
                      request.vadEnabled
                    ? ("AMBIGUOUS_TIME_BASE" as const)
                    : ("UNMAPPED" as const);
      if (baseMappable && mappingStatus !== "AMBIGUOUS_TIME_BASE") {
        lastEndByRequest.set(observation.requestId, sourceEnd);
      }
      const mappingReason =
        mappingStatus === "TRUSTED"
          ? "verified-source-global-sample-lineage-and-cue-association"
          : mappingStatus === "ASSOCIATION_PENDING"
            ? "verified-request-mapping-awaits-cue-association"
            : !hasCompleteLocalTime
              ? "token-has-no-local-time-evidence"
              : mappingStatus === "AMBIGUOUS_TIME_BASE"
                ? "vad-local-token-has-no-verified-mapped-coordinate"
                : !contained
                  ? "token-outside-extracted-audio"
                  : !monotonic
                    ? "non-monotonic-token-order"
                    : !probabilityPassed
                      ? "lexical-token-probability-below-policy"
                      : "token-unmapped-or-unassigned";
      const core = {
        tokenId: observation.tokenId,
        requestId: observation.requestId,
        cueId: observation.cueId,
        text: observation.text,
        lexical,
        probability: observation.probability,
        decoderLocalStartCentiseconds: observation.localStartCentiseconds,
        decoderLocalEndCentiseconds: observation.localEndCentiseconds,
        decoderLocalStartSample: localStartSample,
        decoderLocalEndSample: localEndSample,
        sourceGlobalStartSample: baseMappable ? sourceStart : null,
        sourceGlobalEndSample: baseMappable ? sourceEnd : null,
        sourceSampleRate: request?.sourceSampleRate ?? 16_000,
        sourceGlobalInterval: baseMappable
          ? {
              start: sourceStart / request.sourceSampleRate,
              end: sourceEnd / request.sourceSampleRate,
            }
          : null,
        mappingStatus,
        mappingReason,
        requestTimelineSemanticHash:
          request?.semanticHash ?? input.requestTimeline.semanticHash,
        parentTransformHashes: request?.parentTransformHashes ?? [],
        cacheIdentity: observation.cacheIdentity,
        trusted,
      };
      return globalTokenV2Schema.parse({
        ...core,
        semanticHash: machineQualitySemanticHash(core),
      });
    });
  const trustedCueCounts = tokens.reduce<Map<string, number>>(
    (counts, token) => {
      if (token.trusted && token.cueId !== null) {
        counts.set(token.cueId, (counts.get(token.cueId) ?? 0) + 1);
      }
      return counts;
    },
    new Map(),
  );
  const freshTokenIds = new Set(
    input.observations
      .filter((observation) => observation.freshEvidence)
      .map((observation) => observation.tokenId),
  );
  const core = {
    requestTimelineSemanticHash: input.requestTimeline.semanticHash,
    sourceMediaSha256: input.requestTimeline.sourceMediaSha256,
    tokens,
    summary: {
      tokenObservationCount: tokens.length,
      lexicalTokenCount: tokens.filter((token) => token.lexical).length,
      trustedMappedTokenCount: tokens.filter((token) => token.trusted).length,
      associationPendingTokenCount: tokens.filter(
        (token) => token.mappingStatus === "ASSOCIATION_PENDING",
      ).length,
      untrustedTokenCount: tokens.filter(
        (token) => token.mappingStatus === "UNTRUSTED",
      ).length,
      ambiguousTimeBaseTokenCount: tokens.filter(
        (token) => token.mappingStatus === "AMBIGUOUS_TIME_BASE",
      ).length,
      unmappedTokenCount: tokens.filter(
        (token) => token.mappingStatus === "UNMAPPED",
      ).length,
      missingLocalTimeTokenCount: tokens.filter(
        (token) => token.decoderLocalStartSample === null,
      ).length,
      freshRecoveredTokenCount: tokens.filter(
        (token) => token.trusted && freshTokenIds.has(token.tokenId),
      ).length,
      trustedCueCount: trustedCueCounts.size,
      timingEligibleCueCount: [...trustedCueCounts.values()].filter(
        (tokenCount) => tokenCount >= 2,
      ).length,
      monotonicityFailureCount,
      containmentFailureCount,
      staleLineageCount: 0 as const,
      guessedOffsetCount: 0 as const,
    },
  };
  return machineGlobalTokenTimelineV2Schema.parse({
    schemaVersion: "1.0.0",
    policyVersion: "c6.0.1.4-vad-timebase-acoustic-text-variant-reasr-v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    artifactType: "machine-global-token-timeline-v2",
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
}
