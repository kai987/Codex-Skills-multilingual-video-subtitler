import { describe, expect, it } from "vitest";

import {
  buildGlobalTokenTimelineV2,
  buildRequestTimelineV2,
  buildVadGlobalTimebase,
  composeSampleChain,
  createRequestTimelineV2Entry,
  createSampleTransform,
  mapChildSampleToParent,
} from "@mvl/video-subtitler";

const SOURCE_HASH = "a".repeat(64);
const CLIP_HASH = "b".repeat(64);
const NESTED_HASH = "c".repeat(64);
const COMMAND_HASH = "d".repeat(64);
const RESAMPLE_HASH = "e".repeat(64);
const MODEL_HASH = "f".repeat(64);
const CACHE_HASH = "1".repeat(64);
const ENTRY_HASH = "2".repeat(64);
const CAPABILITY_HASH = "3".repeat(64);
const BINARY_HASH = "4".repeat(64);
const VAD_HASH = "5".repeat(64);

function directTransform() {
  return createSampleTransform({
    transformId: "source-to-clip",
    parentArtifactId: "source-media",
    parentArtifactSha256: SOURCE_HASH,
    childArtifactId: "fresh-clip",
    childArtifactSha256: CLIP_HASH,
    parentSampleRate: 16_000,
    childSampleRate: 16_000,
    parentTotalSamples: 320_000,
    childTotalSamples: 32_000,
    childStartSampleInParent: 16_000,
    childEndSampleInParent: 48_000,
    extractionMethod: "direct-source-ffmpeg-sample-trim",
    ffmpeg: {
      inputSeekPlacement: "before-input",
      inputSeekSample: 16_000,
      outputTrimStartSample: 0,
      outputDurationSamples: 32_000,
      atrimUsed: true,
      asetptsReset: true,
      resampleUsed: false,
      paddingSamples: 0,
      commandIdentity: COMMAND_HASH,
    },
    resamplingIdentity: RESAMPLE_HASH,
    verificationReasons: ["wav-sample-count-verified"],
  });
}

function freshEntry() {
  return createRequestTimelineV2Entry({
    requestId: "fresh-vad-request",
    legacyRequestId: "legacy-vad-request",
    sourceMediaSha256: SOURCE_HASH,
    sourceClipTransform: directTransform(),
    parentChain: ["fresh-clip", "source-media"],
    extractedAudioSha256: CLIP_HASH,
    extractedSampleRate: 16_000,
    extractedSampleCount: 32_000,
    tokenTimeBase: "mapped-original-audio-local",
    mappingStatus: "VERIFIED",
    mappingReason: "fresh-mapped-getter-evidence",
    cacheIdentity: CACHE_HASH,
    cacheEntrySha256: ENTRY_HASH,
    modelIdentity: MODEL_HASH,
    vadEnabled: true,
    promptPresent: false,
    freshEvidence: true,
  });
}

describe("C6.0.1.4 exact sample transform chain", () => {
  it("maps a direct source clip with integer sample identity", () => {
    const transform = directTransform();
    expect(
      mapChildSampleToParent({
        transform,
        childSample: 0,
        boundary: "start",
      }),
    ).toBe(16_000);
    expect(
      mapChildSampleToParent({
        transform,
        childSample: 32_000,
        boundary: "end",
      }),
    ).toBe(48_000);
    expect(
      composeSampleChain({
        transforms: [transform],
        localStartSample: 4_000,
        localEndSample: 8_000,
      }),
    ).toMatchObject({ startSample: 20_000, endSample: 24_000 });
  });

  it("composes source to VAD to nested recovery without float accumulation", () => {
    const source = directTransform();
    const nested = createSampleTransform({
      transformId: "clip-to-nested",
      parentArtifactId: "fresh-clip",
      parentArtifactSha256: CLIP_HASH,
      childArtifactId: "nested-recovery",
      childArtifactSha256: NESTED_HASH,
      parentSampleRate: 16_000,
      childSampleRate: 16_000,
      parentTotalSamples: 32_000,
      childTotalSamples: 8_000,
      childStartSampleInParent: 4_000,
      childEndSampleInParent: 12_000,
      extractionMethod: "nested-recovery-window",
      ffmpeg: {
        inputSeekPlacement: "none",
        inputSeekSample: 0,
        outputTrimStartSample: 4_000,
        outputDurationSamples: 8_000,
        atrimUsed: true,
        asetptsReset: true,
        resampleUsed: false,
        paddingSamples: 0,
        commandIdentity: COMMAND_HASH,
      },
      resamplingIdentity: RESAMPLE_HASH,
      verificationReasons: ["nested-sample-count-verified"],
    });
    expect(
      composeSampleChain({
        transforms: [nested, source],
        localStartSample: 0,
        localEndSample: 8_000,
      }),
    ).toMatchObject({ startSample: 20_000, endSample: 28_000 });
  });

  it("uses rational floor/ceil semantics for sample-rate conversion", () => {
    const transform = createSampleTransform({
      transformId: "resampled",
      parentArtifactId: "source-media",
      parentArtifactSha256: SOURCE_HASH,
      childArtifactId: "resampled-child",
      childArtifactSha256: NESTED_HASH,
      parentSampleRate: 48_000,
      childSampleRate: 16_000,
      parentTotalSamples: 480_000,
      childTotalSamples: 16_000,
      childStartSampleInParent: 48_000,
      childEndSampleInParent: 96_000,
      extractionMethod: "direct-source-ffmpeg-sample-trim",
      ffmpeg: {
        inputSeekPlacement: "before-input",
        inputSeekSample: 48_000,
        outputTrimStartSample: 0,
        outputDurationSamples: 16_000,
        atrimUsed: true,
        asetptsReset: true,
        resampleUsed: true,
        paddingSamples: 0,
        commandIdentity: COMMAND_HASH,
      },
      resamplingIdentity: RESAMPLE_HASH,
      verificationReasons: ["rational-resample-verified"],
    });
    expect(
      composeSampleChain({
        transforms: [transform],
        localStartSample: 1,
        localEndSample: 2,
      }),
    ).toMatchObject({ startSample: 48_003, endSample: 48_006 });
  });

  it("rejects invalid or stale parent identities instead of guessing", () => {
    const source = directTransform();
    const invalid = createSampleTransform({
      transformId: "invalid-nested",
      parentArtifactId: "wrong-parent",
      parentArtifactSha256: NESTED_HASH,
      childArtifactId: "nested-recovery",
      childArtifactSha256: "6".repeat(64),
      parentSampleRate: 16_000,
      childSampleRate: 16_000,
      parentTotalSamples: 32_000,
      childTotalSamples: 8_000,
      childStartSampleInParent: 0,
      childEndSampleInParent: 8_000,
      extractionMethod: "nested-recovery-window",
      ffmpeg: {
        inputSeekPlacement: "none",
        inputSeekSample: 0,
        outputTrimStartSample: 0,
        outputDurationSamples: 8_000,
        atrimUsed: true,
        asetptsReset: true,
        resampleUsed: false,
        paddingSamples: 0,
        commandIdentity: COMMAND_HASH,
      },
      resamplingIdentity: RESAMPLE_HASH,
      verificationReasons: ["fixture"],
    });
    expect(() =>
      composeSampleChain({
        transforms: [invalid, source],
        localStartSample: 0,
        localEndSample: 8_000,
      }),
    ).toThrow(/identity mismatch/u);
  });
});

describe("C6.0.1.4 fresh VAD lineage and token mapping", () => {
  it("persists raw VAD sample mapping from a fresh mapped-getter request", () => {
    const artifact = buildVadGlobalTimebase({
      mode: "enforce",
      generatedAt: "2026-08-28T00:00:00.000Z",
      sourceIdentity: {
        sourceMediaSha256: SOURCE_HASH,
        sourceSampleRate: 16_000,
        sourceTotalSamples: 320_000,
        sourceReadOnlyVerified: true,
      },
      vadProviderIdentity: {
        provider: "whisper.cpp-silero-vad",
        whisperVersion: "1.9.3",
        whisperBinarySha256: BINARY_HASH,
        vadModelSha256: VAD_HASH,
        capabilityHash: CAPABILITY_HASH,
        mappedGetterUsed: true,
        rawVadGetterUsed: true,
        requestStateIsolation: "fresh-whisper-state-per-mvl-request",
      },
      legacyQuarantinedRequestIds: ["legacy-vad-request"],
      requests: [
        {
          requestId: "fresh-vad-request",
          extractedAudioId: "fresh-clip",
          extractedAudioSha256: CLIP_HASH,
          sourceClipTransform: directTransform(),
          cacheIdentity: CACHE_HASH,
          providerSegments: [
            {
              index: 0,
              startCentiseconds: 25,
              endCentiseconds: 125,
              coordinateSystem: "original-audio-local",
            },
          ],
          mappedGetterUsed: true,
          rawVadGetterUsed: true,
          mappingVerified: true,
          failureReasons: [],
        },
      ],
    });
    expect(artifact.freshRemapRequestCount).toBe(1);
    expect(artifact.guessedOffsetCount).toBe(0);
    expect(artifact.vadSegments[0]).toMatchObject({
      providerVadStartSampleInParent: 4_000,
      providerVadEndSampleInParent: 20_000,
      vadStartSampleInParent: 4_000,
      vadEndSampleInParent: 20_000,
      boundaryNormalizationApplied: false,
      boundaryNormalizationDeltaEndSamples: 0,
      sourceGlobalStartSample: 20_000,
      sourceGlobalEndSample: 36_000,
      mappingStatus: "VERIFIED",
    });
  });

  it("normalizes a provider frame-end overrun within 50ms in integer samples", () => {
    const build = () =>
      buildVadGlobalTimebase({
        mode: "enforce",
        generatedAt: "2026-08-28T00:00:00.000Z",
        sourceIdentity: {
          sourceMediaSha256: SOURCE_HASH,
          sourceSampleRate: 16_000,
          sourceTotalSamples: 320_000,
          sourceReadOnlyVerified: true,
        },
        vadProviderIdentity: {
          provider: "whisper.cpp-silero-vad" as const,
          whisperVersion: "1.9.3",
          whisperBinarySha256: BINARY_HASH,
          vadModelSha256: VAD_HASH,
          capabilityHash: CAPABILITY_HASH,
          mappedGetterUsed: true,
          rawVadGetterUsed: true,
          requestStateIsolation: "fresh-whisper-state-per-mvl-request",
        },
        legacyQuarantinedRequestIds: [],
        requests: [
          {
            requestId: "frame-overrun",
            extractedAudioId: "fresh-clip",
            extractedAudioSha256: CLIP_HASH,
            sourceClipTransform: directTransform(),
            cacheIdentity: CACHE_HASH,
            providerSegments: [
              {
                index: 0,
                startCentiseconds: 25,
                endCentiseconds: 202,
                coordinateSystem: "original-audio-local" as const,
              },
            ],
            mappedGetterUsed: true,
            rawVadGetterUsed: true,
            mappingVerified: true,
            failureReasons: [],
          },
        ],
      });
    const artifact = build();
    expect(artifact.boundaryNormalizedSegmentCount).toBe(1);
    expect(artifact.vadSegments[0]).toMatchObject({
      providerVadEndSampleInParent: 32_320,
      vadEndSampleInParent: 32_000,
      boundaryNormalizationApplied: true,
      boundaryNormalizationDeltaStartSamples: 0,
      boundaryNormalizationDeltaEndSamples: 320,
      boundaryNormalizationToleranceSamples: 800,
      boundaryNormalizationReason:
        "RAW_VAD_AUDIO_END_EXCEEDED_WITHIN_TOLERANCE",
      sourceGlobalEndSample: 48_000,
    });
    expect(build().semanticHash).toBe(artifact.semanticHash);
  });

  it("rejects a provider VAD frame-end overrun beyond 50ms", () => {
    expect(() =>
      buildVadGlobalTimebase({
        mode: "enforce",
        generatedAt: "2026-08-28T00:00:00.000Z",
        sourceIdentity: {
          sourceMediaSha256: SOURCE_HASH,
          sourceSampleRate: 16_000,
          sourceTotalSamples: 320_000,
          sourceReadOnlyVerified: true,
        },
        vadProviderIdentity: {
          provider: "whisper.cpp-silero-vad",
          whisperVersion: "1.9.3",
          whisperBinarySha256: BINARY_HASH,
          vadModelSha256: VAD_HASH,
          capabilityHash: CAPABILITY_HASH,
          mappedGetterUsed: true,
          rawVadGetterUsed: true,
          requestStateIsolation: "fresh-whisper-state-per-mvl-request",
        },
        legacyQuarantinedRequestIds: [],
        requests: [
          {
            requestId: "outside-tolerance",
            extractedAudioId: "fresh-clip",
            extractedAudioSha256: CLIP_HASH,
            sourceClipTransform: directTransform(),
            cacheIdentity: CACHE_HASH,
            providerSegments: [
              {
                index: 0,
                startCentiseconds: 25,
                endCentiseconds: 206,
                coordinateSystem: "original-audio-local",
              },
            ],
            mappedGetterUsed: true,
            rawVadGetterUsed: true,
            mappingVerified: true,
            failureReasons: [],
          },
        ],
      }),
    ).toThrow(/escapes its extracted audio/u);
  });

  it("maps fresh mapped tokens but retains raw old VAD tokens as ambiguous", () => {
    const verified = freshEntry();
    const quarantined = {
      ...verified,
      requestId: "old-vad-request",
      legacyRequestId: null,
      tokenTimeBase: "vad-processed-local" as const,
      mappingStatus: "QUARANTINED" as const,
      mappingReason: "legacy-vad-offset-unavailable",
      freshEvidence: false,
      semanticHash: "7".repeat(64),
    };
    const timeline = buildRequestTimelineV2({
      sourceMediaSha256: SOURCE_HASH,
      vadGlobalTimebaseSemanticHash: "8".repeat(64),
      requests: [verified, quarantined],
      generatedAt: "2026-08-28T00:00:00.000Z",
    });
    const tokens = buildGlobalTokenTimelineV2({
      requestTimeline: timeline,
      generatedAt: "2026-08-28T00:00:00.000Z",
      observations: [
        {
          tokenId: "fresh-token",
          requestId: "fresh-vad-request",
          cueId: "cue-1",
          text: "おはよう",
          probability: 0.9,
          localStartCentiseconds: 25,
          localEndCentiseconds: 75,
          coordinateSystem: "mapped-original-audio-local",
          associationStatus: "assigned",
          cacheIdentity: CACHE_HASH,
          freshEvidence: true,
        },
        {
          tokenId: "legacy-token",
          requestId: "old-vad-request",
          cueId: "cue-2",
          text: "旧",
          probability: 0.9,
          localStartCentiseconds: 10,
          localEndCentiseconds: 20,
          coordinateSystem: "vad-processed-local",
          associationStatus: "assigned",
          cacheIdentity: CACHE_HASH,
          freshEvidence: false,
        },
      ],
    });
    expect(
      tokens.tokens.find((token) => token.tokenId === "fresh-token"),
    ).toMatchObject({
      mappingStatus: "TRUSTED",
      sourceGlobalStartSample: 20_000,
      sourceGlobalEndSample: 28_000,
    });
    expect(
      tokens.tokens.find((token) => token.tokenId === "legacy-token"),
    ).toMatchObject({
      mappingStatus: "AMBIGUOUS_TIME_BASE",
      sourceGlobalStartSample: null,
      sourceGlobalEndSample: null,
    });
    expect(tokens.summary).toMatchObject({
      trustedMappedTokenCount: 1,
      ambiguousTimeBaseTokenCount: 1,
      guessedOffsetCount: 0,
    });
  });

  it("keeps verified but unassociated tokens association-pending", () => {
    const timeline = buildRequestTimelineV2({
      sourceMediaSha256: SOURCE_HASH,
      vadGlobalTimebaseSemanticHash: "8".repeat(64),
      requests: [freshEntry()],
      generatedAt: "2026-08-28T00:00:00.000Z",
    });
    const tokens = buildGlobalTokenTimelineV2({
      requestTimeline: timeline,
      observations: [
        {
          tokenId: "pending-token",
          requestId: "fresh-vad-request",
          cueId: null,
          text: "候補",
          probability: 0.9,
          localStartCentiseconds: 10,
          localEndCentiseconds: 20,
          coordinateSystem: "mapped-original-audio-local",
          associationStatus: "pending",
          cacheIdentity: CACHE_HASH,
          freshEvidence: true,
        },
      ],
    });
    expect(tokens.tokens[0]?.mappingStatus).toBe("ASSOCIATION_PENDING");
    expect(tokens.tokens[0]?.trusted).toBe(false);
  });
});
