import {
  InputError,
  machineVadGlobalTimebaseSchema,
  type C6014Mode,
  type MachineVadGlobalTimebase,
  type SampleTransform,
  type VadSegmentSampleMapping,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";
import {
  composeSampleChain,
  createSampleTransform,
} from "./sample-transform-chain.js";

const RAW_VAD_BOUNDARY_NORMALIZATION_TOLERANCE_NUMERATOR = 5n;
const RAW_VAD_BOUNDARY_NORMALIZATION_TOLERANCE_DENOMINATOR = 100n;
const RAW_VAD_BOUNDARY_NORMALIZATION_POLICY_VERSION =
  "c6.0.1.4-sample-domain-vad-boundary-normalization-v1" as const;

export interface FreshVadRequestEvidence {
  requestId: string;
  extractedAudioId: string;
  extractedAudioSha256: string;
  sourceClipTransform: SampleTransform;
  cacheIdentity: string;
  providerSegments: readonly {
    index: number;
    startCentiseconds: number;
    endCentiseconds: number;
    coordinateSystem: "original-audio-local";
  }[];
  mappedGetterUsed: boolean;
  rawVadGetterUsed: boolean;
  emptyResponse: boolean;
  mappingVerified: boolean;
  failureReasons: readonly string[];
}

function centisecondsToSamples(value: number, sampleRate: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new InputError("VAD centiseconds must be nonnegative integers.");
  }
  const numerator = BigInt(value) * BigInt(sampleRate);
  if (numerator % 100n !== 0n) {
    throw new InputError(
      "VAD centisecond boundary is not exactly representable at the sample rate.",
      { value, sampleRate },
    );
  }
  return Number(numerator / 100n);
}

function rawVadBoundaryToleranceSamples(sampleRate: number): number {
  const numerator =
    BigInt(sampleRate) * RAW_VAD_BOUNDARY_NORMALIZATION_TOLERANCE_NUMERATOR;
  return Number(
    (numerator + RAW_VAD_BOUNDARY_NORMALIZATION_TOLERANCE_DENOMINATOR - 1n) /
      RAW_VAD_BOUNDARY_NORMALIZATION_TOLERANCE_DENOMINATOR,
  );
}

export function buildVadGlobalTimebase(input: {
  mode: C6014Mode;
  generatedAt?: string;
  sourceIdentity: {
    sourceMediaSha256: string;
    sourceSampleRate: number;
    sourceTotalSamples: number;
    sourceReadOnlyVerified: boolean;
  };
  vadProviderIdentity: {
    provider: "whisper.cpp-silero-vad";
    whisperVersion: string;
    whisperBinarySha256: string;
    vadModelSha256: string;
    capabilityHash: string;
    mappedGetterUsed: boolean;
    rawVadGetterUsed: boolean;
    requestStateIsolation: string;
  };
  legacyQuarantinedRequestIds: readonly string[];
  requests: readonly FreshVadRequestEvidence[];
}): MachineVadGlobalTimebase {
  const transforms: SampleTransform[] = [];
  const segments: VadSegmentSampleMapping[] = [];
  const verifiedRequestIds: string[] = [];
  const quarantinedRequestIds: string[] = [];
  const emptyResponseVerifiedRequestIds: string[] = [];
  for (const request of [...input.requests].toSorted((left, right) =>
    left.requestId.localeCompare(right.requestId),
  )) {
    if (
      request.sourceClipTransform.parentArtifactSha256 !==
        input.sourceIdentity.sourceMediaSha256 ||
      request.sourceClipTransform.parentSampleRate !==
        input.sourceIdentity.sourceSampleRate ||
      request.sourceClipTransform.parentTotalSamples !==
        input.sourceIdentity.sourceTotalSamples
    ) {
      throw new InputError("Fresh VAD request has stale source lineage.", {
        requestId: request.requestId,
      });
    }
    transforms.push(request.sourceClipTransform);
    if (
      !request.mappingVerified ||
      !request.rawVadGetterUsed ||
      (!request.mappedGetterUsed && !request.emptyResponse)
    ) {
      quarantinedRequestIds.push(request.requestId);
      continue;
    }
    verifiedRequestIds.push(request.requestId);
    if (request.emptyResponse) {
      if (request.providerSegments.length !== 0) {
        throw new InputError(
          "An empty VAD response cannot contain provider segments.",
          { requestId: request.requestId },
        );
      }
      emptyResponseVerifiedRequestIds.push(request.requestId);
    }
    for (const providerSegment of request.providerSegments) {
      const localStartSample = centisecondsToSamples(
        providerSegment.startCentiseconds,
        request.sourceClipTransform.childSampleRate,
      );
      const localEndSample = centisecondsToSamples(
        providerSegment.endCentiseconds,
        request.sourceClipTransform.childSampleRate,
      );
      const boundaryNormalizationToleranceSamples =
        rawVadBoundaryToleranceSamples(
          request.sourceClipTransform.childSampleRate,
        );
      const endOverrunSamples = Math.max(
        0,
        localEndSample - request.sourceClipTransform.childTotalSamples,
      );
      const boundaryNormalizationApplied =
        endOverrunSamples > 0 &&
        endOverrunSamples <= boundaryNormalizationToleranceSamples;
      const normalizedLocalEndSample = boundaryNormalizationApplied
        ? request.sourceClipTransform.childTotalSamples
        : localEndSample;
      if (
        normalizedLocalEndSample <= localStartSample ||
        normalizedLocalEndSample > request.sourceClipTransform.childTotalSamples
      ) {
        throw new InputError("Raw VAD segment escapes its extracted audio.", {
          requestId: request.requestId,
          providerSegment,
          extractedSamples: request.sourceClipTransform.childTotalSamples,
          boundaryNormalizationToleranceSamples,
          endOverrunSamples,
        });
      }
      const virtualSegmentIdentity = machineQualitySemanticHash({
        requestId: request.requestId,
        extractedAudioSha256: request.extractedAudioSha256,
        providerSegment,
        normalizedLocalStartSample: localStartSample,
        normalizedLocalEndSample,
        boundaryNormalizationApplied,
        endOverrunSamples,
      });
      const vadSegmentId = `fresh-vad:${request.requestId}:${String(
        providerSegment.index,
      ).padStart(4, "0")}`;
      const virtualTransform = createSampleTransform({
        transformId: `transform:${vadSegmentId}:to-extracted-audio`,
        parentArtifactId: request.extractedAudioId,
        parentArtifactSha256: request.extractedAudioSha256,
        childArtifactId: vadSegmentId,
        childArtifactSha256: virtualSegmentIdentity,
        parentSampleRate: request.sourceClipTransform.childSampleRate,
        childSampleRate: request.sourceClipTransform.childSampleRate,
        parentTotalSamples: request.sourceClipTransform.childTotalSamples,
        childTotalSamples: normalizedLocalEndSample - localStartSample,
        childStartSampleInParent: localStartSample,
        childEndSampleInParent: normalizedLocalEndSample,
        extractionMethod: "whisper-internal-vad",
        ffmpeg: {
          inputSeekPlacement: "none",
          inputSeekSample: 0,
          outputTrimStartSample: localStartSample,
          outputDurationSamples: normalizedLocalEndSample - localStartSample,
          atrimUsed: false,
          asetptsReset: false,
          resampleUsed: false,
          paddingSamples: 0,
          commandIdentity: input.vadProviderIdentity.capabilityHash,
        },
        resamplingIdentity: machineQualitySemanticHash({
          sourceSampleRate: request.sourceClipTransform.childSampleRate,
          targetSampleRate: request.sourceClipTransform.childSampleRate,
          method: "identity",
        }),
        verificationReasons: [
          "raw-vad-getter-used",
          "raw-vad-original-audio-local-coordinate",
          "fresh-direct-source-extraction",
          ...(boundaryNormalizationApplied
            ? [
                "raw-vad-audio-end-normalized-within-50ms-sample-domain-tolerance",
              ]
            : []),
        ],
      });
      transforms.push(virtualTransform);
      const global = composeSampleChain({
        transforms: [virtualTransform, request.sourceClipTransform],
        localStartSample: 0,
        localEndSample: virtualTransform.childTotalSamples,
      });
      const mappingCore = {
        vadSegmentId,
        requestId: request.requestId,
        sourceMediaSha256: input.sourceIdentity.sourceMediaSha256,
        parentArtifactId: request.extractedAudioId,
        parentArtifactSha256: request.extractedAudioSha256,
        parentSampleRate: request.sourceClipTransform.childSampleRate,
        parentTotalSamples: request.sourceClipTransform.childTotalSamples,
        providerVadStartSampleInParent: localStartSample,
        providerVadEndSampleInParent: localEndSample,
        vadStartSampleInParent: localStartSample,
        vadEndSampleInParent: normalizedLocalEndSample,
        vadSampleCount: normalizedLocalEndSample - localStartSample,
        boundaryNormalizationApplied,
        boundaryNormalizationDeltaStartSamples: 0,
        boundaryNormalizationDeltaEndSamples: endOverrunSamples,
        boundaryNormalizationToleranceSamples,
        boundaryNormalizationReason: boundaryNormalizationApplied
          ? ("RAW_VAD_AUDIO_END_EXCEEDED_WITHIN_TOLERANCE" as const)
          : ("NONE" as const),
        outputSampleRate: request.sourceClipTransform.childSampleRate,
        outputSampleCount: normalizedLocalEndSample - localStartSample,
        outputLocalZeroSample: 0 as const,
        sourceGlobalStartSample: global.startSample,
        sourceGlobalEndSample: global.endSample,
        extractionCommandIdentity:
          request.sourceClipTransform.ffmpeg.commandIdentity,
        resamplingIdentity: request.sourceClipTransform.resamplingIdentity,
        providerSegmentIndex: providerSegment.index,
        providerCoordinateSystem: "original-audio-local" as const,
        mappingStatus: "VERIFIED" as const,
        mappingReasons: [
          "fresh-source-global-extraction",
          "integer-sample-transform-composed",
          "mapped-token-getter-verified",
          "raw-vad-getter-verified",
          ...(boundaryNormalizationApplied
            ? [
                "raw-vad-provider-end-preserved-and-effective-end-normalized-in-sample-domain",
              ]
            : []),
        ],
        parentTransformHash: request.sourceClipTransform.semanticHash,
      };
      segments.push({
        ...mappingCore,
        timebaseSemanticHash: machineQualitySemanticHash(mappingCore),
      });
    }
  }
  const verifiedSegments = segments.filter(
    (segment) => segment.mappingStatus === "VERIFIED",
  ).length;
  const quarantinedSegments = segments.filter(
    (segment) => segment.mappingStatus === "QUARANTINED",
  ).length;
  const ambiguousSegments = segments.filter(
    (segment) => segment.mappingStatus === "AMBIGUOUS",
  ).length;
  const freshRecoveryRequestIds = [...verifiedRequestIds].toSorted();
  const core = {
    mode: input.mode,
    sourceIdentity: input.sourceIdentity,
    vadProviderIdentity: input.vadProviderIdentity,
    vadSegments: segments,
    parentChildTransforms: transforms,
    legacyQuarantinedRequestIds: [
      ...input.legacyQuarantinedRequestIds,
    ].toSorted(),
    freshRecoveryRequestIds,
    emptyResponseVerifiedRequestIds: [
      ...emptyResponseVerifiedRequestIds,
    ].toSorted(),
    verifiedSegmentCount: verifiedSegments,
    quarantinedSegmentCount: quarantinedSegments,
    ambiguousSegmentCount: ambiguousSegments,
    verifiedRequestCount: verifiedRequestIds.length,
    quarantinedRequestCount: quarantinedRequestIds.length,
    freshRemapRequestCount: verifiedRequestIds.length,
    emptyResponseVerifiedRequestCount: emptyResponseVerifiedRequestIds.length,
    boundaryNormalizationPolicyVersion:
      RAW_VAD_BOUNDARY_NORMALIZATION_POLICY_VERSION,
    boundaryNormalizedSegmentCount: segments.filter(
      (segment) => segment.boundaryNormalizationApplied,
    ).length,
    sampleMappingCoverage:
      input.requests.length === 0
        ? 0
        : verifiedRequestIds.length / input.requests.length,
    guessedOffsetCount: 0 as const,
  };
  return machineVadGlobalTimebaseSchema.parse({
    schemaVersion: "1.0.0",
    policyVersion: "c6.0.1.4-vad-timebase-acoustic-text-variant-reasr-v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    artifactType: "machine-vad-global-timebase",
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
}
