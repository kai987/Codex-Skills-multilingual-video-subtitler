import {
  InputError,
  asrRequestTimelineContractV2Schema,
  requestTimelineV2EntrySchema,
  type AsrRequestTimelineContractV2,
  type RequestTimelineV2Entry,
  type SampleTransform,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";
import { composeSampleChain } from "./sample-transform-chain.js";

export function createRequestTimelineV2Entry(input: {
  requestId: string;
  legacyRequestId: string | null;
  sourceMediaSha256: string;
  sourceClipTransform: SampleTransform;
  parentChain: readonly string[];
  parentTransforms?: readonly SampleTransform[];
  extractedAudioSha256: string;
  extractedSampleRate: number;
  extractedSampleCount: number;
  tokenTimeBase:
    | "original-audio-local"
    | "mapped-original-audio-local"
    | "vad-processed-local"
    | "unknown";
  mappingStatus: "VERIFIED" | "QUARANTINED" | "AMBIGUOUS" | "UNAVAILABLE";
  mappingReason: string;
  cacheIdentity: string;
  cacheEntrySha256: string;
  modelIdentity: string;
  vadEnabled: boolean;
  promptPresent: boolean;
  freshEvidence: boolean;
}): RequestTimelineV2Entry {
  if (
    input.sourceClipTransform.parentArtifactSha256 !== input.sourceMediaSha256
  ) {
    throw new InputError(
      "Request timeline source transform identity mismatch.",
      {
        requestId: input.requestId,
      },
    );
  }
  if (
    input.sourceClipTransform.childArtifactSha256 !==
      input.extractedAudioSha256 ||
    input.sourceClipTransform.childSampleRate !== input.extractedSampleRate ||
    input.sourceClipTransform.childTotalSamples !== input.extractedSampleCount
  ) {
    throw new InputError(
      "Request timeline extracted audio identity mismatch.",
      {
        requestId: input.requestId,
      },
    );
  }
  if (
    input.mappingStatus === "VERIFIED" &&
    input.tokenTimeBase === "vad-processed-local"
  ) {
    throw new InputError(
      "A raw VAD-processed token timebase cannot be marked verified without mapped coordinates.",
      { requestId: input.requestId },
    );
  }
  const chain = [...(input.parentTransforms ?? []), input.sourceClipTransform];
  const global = composeSampleChain({
    transforms: chain,
    localStartSample: 0,
    localEndSample: input.extractedSampleCount,
  });
  const core = {
    requestId: input.requestId,
    legacyRequestId: input.legacyRequestId,
    sourceMediaSha256: input.sourceMediaSha256,
    sourceGlobalStartSample: global.startSample,
    sourceGlobalEndSample: global.endSample,
    sourceSampleRate: input.sourceClipTransform.parentSampleRate,
    parentChain: [...input.parentChain],
    parentTransformHashes: global.transformHashes,
    extractedAudioSha256: input.extractedAudioSha256,
    extractedSampleRate: input.extractedSampleRate,
    extractedSampleCount: input.extractedSampleCount,
    decoderLocalOriginSample: 0 as const,
    decoderLocalOriginSeconds: 0 as const,
    tokenTimeBase: input.tokenTimeBase,
    mappingStatus: input.mappingStatus,
    mappingReason: input.mappingReason,
    cacheIdentity: input.cacheIdentity,
    cacheEntrySha256: input.cacheEntrySha256,
    modelIdentity: input.modelIdentity,
    vadEnabled: input.vadEnabled,
    promptPresent: input.promptPresent,
    freshEvidence: input.freshEvidence,
  };
  return requestTimelineV2EntrySchema.parse({
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
}

export function buildRequestTimelineV2(input: {
  sourceMediaSha256: string;
  vadGlobalTimebaseSemanticHash: string;
  requests: readonly RequestTimelineV2Entry[];
  generatedAt?: string;
}): AsrRequestTimelineContractV2 {
  const requests = [...input.requests].toSorted((left, right) =>
    left.requestId.localeCompare(right.requestId),
  );
  if (
    new Set(requests.map((request) => request.requestId)).size !==
    requests.length
  ) {
    throw new InputError("Request timeline v2 request IDs must be unique.");
  }
  if (
    requests.some(
      (request) => request.sourceMediaSha256 !== input.sourceMediaSha256,
    )
  ) {
    throw new InputError("Request timeline v2 mixes source media identities.");
  }
  const core = {
    sourceMediaSha256: input.sourceMediaSha256,
    vadGlobalTimebaseSemanticHash: input.vadGlobalTimebaseSemanticHash,
    requests,
    summary: {
      requestCount: requests.length,
      verifiedRequestCount: requests.filter(
        (request) => request.mappingStatus === "VERIFIED",
      ).length,
      quarantinedRequestCount: requests.filter(
        (request) => request.mappingStatus === "QUARANTINED",
      ).length,
      ambiguousRequestCount: requests.filter(
        (request) => request.mappingStatus === "AMBIGUOUS",
      ).length,
      unavailableRequestCount: requests.filter(
        (request) => request.mappingStatus === "UNAVAILABLE",
      ).length,
      freshRequestCount: requests.filter((request) => request.freshEvidence)
        .length,
      promptPresentCount: requests.filter((request) => request.promptPresent)
        .length,
      guessedOffsetCount: 0 as const,
    },
  };
  return asrRequestTimelineContractV2Schema.parse({
    schemaVersion: "1.0.0",
    policyVersion: "c6.0.1.4-vad-timebase-acoustic-text-variant-reasr-v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    artifactType: "asr-request-timeline-contract-v2",
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
}
