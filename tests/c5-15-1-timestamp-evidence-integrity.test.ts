import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  overlapAcousticAttemptSchema,
  subtitleTimestampEvidenceIntegritySchema,
  type OverlapAcousticAttempt,
  type OverlapAcousticProfile,
} from "@mvl/shared";
import {
  DEFAULT_TIMESTAMP_HEALTH_CONFIGURATION,
  PortableAsrCache,
  auditLegacyOverlapAttempt,
  auditTimestampEvidenceAttempt,
  alignOverlapComponentCues,
  buildPortableAsrCacheIdentityV2,
  buildPortableAsrCacheKey,
  buildTimestampEvidenceIntegrityArtifact,
  evaluateTimestampEvidenceIntegrityGate,
  timestampIntegrityHash,
} from "@mvl/transcription-core";
import {
  timestampAttemptViewsForMode,
  timestampObserveMutationProhibited,
} from "@mvl/video-subtitler";

const HASH = "a".repeat(64);

interface FixtureGroup {
  groupId: string;
  profile: OverlapAcousticProfile;
  extraction: [number, number];
  segment: [number, number];
  tokens: [number, number][];
}

function audit(input: {
  useVad?: boolean;
  rawCoordinateSystem?:
    | "original-audio-local"
    | "original-media-global"
    | "vad-processed-local"
    | "segment-relative"
    | "unknown";
  segment?: [number, number];
  tokens: {
    text: string;
    start: number;
    end: number;
    officialMappedStart?: number;
    officialMappedEnd?: number;
    declaredSegmentRelative?: boolean;
  }[];
  policy?: "auto" | "mapped-only" | "validated-legacy" | "off";
  mappedGetter?: boolean;
}) {
  const useVad = input.useVad ?? false;
  return auditTimestampEvidenceAttempt({
    attemptId: "attempt-fixture",
    profile: useVad ? "current-sensitive-vad" : "no-vad",
    useVad,
    extractionInterval: { start: 100, end: 110 },
    segments: [
      {
        segmentId: "segment-fixture",
        text: "fixture",
        rawStart: input.segment?.[0] ?? 1,
        rawEnd: input.segment?.[1] ?? 3,
        confidence: 0.9,
        tokens: input.tokens.map((token, index) => ({
          tokenId: `token-${String(index)}`,
          text: token.text,
          rawStart: token.start,
          rawEnd: token.end,
          probability: 0.9,
          ...(input.rawCoordinateSystem === undefined
            ? {}
            : { rawCoordinateSystem: input.rawCoordinateSystem }),
          ...(token.officialMappedStart === undefined
            ? {}
            : { officialMappedStart: token.officialMappedStart }),
          ...(token.officialMappedEnd === undefined
            ? {}
            : { officialMappedEnd: token.officialMappedEnd }),
          ...(token.declaredSegmentRelative === undefined
            ? {}
            : { declaredSegmentRelative: token.declaredSegmentRelative }),
        })),
      },
    ],
    tokenTimestampsRequested: true,
    tokenTimestampPolicy: input.policy ?? "auto",
    mappedTokenGetterActuallyUsed: input.mappedGetter ?? false,
  });
}

describe("C5.15.1 token timestamp health", () => {
  it("keeps off/observe classification compatible and enforces only audited evidence", () => {
    const auditedAttempt = {
      attemptId: "audited",
    } as unknown as OverlapAcousticAttempt;
    const legacyAttempt = {
      attemptId: "legacy",
    } as unknown as OverlapAcousticAttempt;
    expect(
      timestampAttemptViewsForMode({
        mode: "off",
        auditedAttempt,
        legacyAttempt,
      }),
    ).toEqual({
      artifactAttempt: legacyAttempt,
      classificationAttempt: legacyAttempt,
    });
    expect(
      timestampAttemptViewsForMode({
        mode: "observe",
        auditedAttempt,
        legacyAttempt,
      }),
    ).toEqual({
      artifactAttempt: auditedAttempt,
      classificationAttempt: legacyAttempt,
    });
    expect(
      timestampAttemptViewsForMode({
        mode: "enforce",
        auditedAttempt,
        legacyAttempt,
      }),
    ).toEqual({
      artifactAttempt: auditedAttempt,
      classificationAttempt: auditedAttempt,
    });
    expect(timestampObserveMutationProhibited("observe", 1)).toBe(true);
    expect(timestampObserveMutationProhibited("observe", 0)).toBe(false);
    expect(timestampObserveMutationProhibited("enforce", 1)).toBe(false);
  });

  it("trusts healthy no-VAD original-audio-local tokens", () => {
    const result = audit({
      tokens: [
        { text: "あ", start: 1.1, end: 1.5 },
        { text: "い", start: 1.5, end: 2.2 },
      ],
    });
    expect(result.integrity.segmentHealth[0]).toMatchObject({
      tokenTimelineStatus: "trusted-original-timeline",
      usableTokenCount: 2,
      tokenMonotonicityPassed: true,
    });
    expect(result.tokens.every((token) => token.timingUsable)).toBe(true);
    expect(result.tokens[0]).toMatchObject({
      rawStart: 1.1,
      mappedStart: 101.1,
      mappedCoordinateSystem: "original-media-global",
      mappingMethod: "identity-original-local",
    });
  });

  it("quarantines legacy VAD tokens while preserving lexical text", () => {
    const result = audit({
      useVad: true,
      segment: [2, 3],
      tokens: [{ text: "語", start: 0.2, end: 0.7 }],
    });
    expect(result.integrity.segmentHealth[0]?.tokenTimelineStatus).toBe(
      "vad-processed-unmapped",
    );
    expect(result.tokens[0]).toMatchObject({
      textUsable: true,
      timingUsable: false,
      mappedStart: null,
      mappingMethod: "quarantined",
    });
    expect(result.mappedTrustedTokenIntervals).toEqual([]);
  });

  it("accepts an actually-used official mapped getter only after health checks", () => {
    const result = audit({
      useVad: true,
      segment: [2, 3],
      mappedGetter: true,
      tokens: [
        {
          text: "語",
          start: 0.2,
          end: 0.7,
          officialMappedStart: 2.1,
          officialMappedEnd: 2.7,
        },
      ],
    });
    expect(result.tokens[0]).toMatchObject({
      timingUsable: true,
      mappingMethod: "official-mapped-token-getter",
      tokenTimelineStatus: "trusted-mapped-original-timeline",
    });
  });

  it("distinguishes audit drift from trust and hard quarantine tolerances", () => {
    const ordinaryFloat = audit({
      segment: [1, 3],
      tokens: [{ text: "語", start: 0.96, end: 3.04 }],
    });
    const auditOnlyFailure = audit({
      segment: [1, 3],
      tokens: [{ text: "語", start: 0.88, end: 3.12 }],
    });
    const hardFailure = audit({
      segment: [2, 3],
      tokens: [{ text: "語", start: 0.61, end: 2.5 }],
    });
    const hugeFailure = audit({
      segment: [11, 12],
      tokens: [{ text: "語", start: 0.53, end: 1.37 }],
    });
    expect(ordinaryFloat.tokens[0]?.timingUsable).toBe(true);
    expect(
      auditOnlyFailure.integrity.segmentHealth[0]
        ?.tokenSegmentContainmentRatio50ms,
    ).toBe(0);
    expect(auditOnlyFailure.tokens[0]?.timingUsable).toBe(true);
    expect(hardFailure.tokens[0]?.timingUsable).toBe(false);
    expect(
      hugeFailure.integrity.segmentHealth[0]?.maximumEarlyDriftSeconds,
    ).toBe(10.47);
  });

  it("rejects non-monotonic, zero-collapsed, clamped, and unknown sequences", () => {
    const nonMonotonic = audit({
      tokens: [
        { text: "あ", start: 1.5, end: 1.8 },
        { text: "い", start: 1.2, end: 1.4 },
      ],
    });
    const zero = audit({
      tokens: [{ text: "語", start: 1.2, end: 1.2 }],
    });
    const clamped = audit({
      segment: [0, 3],
      tokens: [{ text: "語", start: 0, end: 0.5 }],
    });
    const unknown = audit({
      rawCoordinateSystem: "unknown",
      tokens: [{ text: "語", start: 1.2, end: 1.8 }],
    });
    expect(nonMonotonic.integrity.segmentHealth[0]?.tokenTimelineStatus).toBe(
      "non-monotonic",
    );
    expect(zero.integrity.segmentHealth[0]?.tokenTimelineStatus).toBe(
      "zero-collapsed",
    );
    expect(clamped.integrity.segmentHealth[0]?.tokenTimelineStatus).toBe(
      "boundary-clamped",
    );
    expect(unknown.tokens[0]?.timingUsable).toBe(false);
  });

  it("excludes special tokens from the lexical denominator", () => {
    const result = audit({
      tokens: [
        { text: "[_BEG_]", start: 0, end: 0 },
        { text: "語", start: 1.2, end: 1.8 },
      ],
    });
    expect(result.integrity.segmentHealth[0]).toMatchObject({
      lexicalTokenCount: 1,
      specialTokenCount: 1,
      usableTokenCount: 1,
    });
    expect(result.tokens[0]).toMatchObject({
      specialToken: true,
      timingUsable: false,
    });
  });

  it("quarantines invalid replacement text without treating it as a special token", () => {
    const result = audit({
      tokens: [{ text: "�", start: 1.2, end: 1.8 }],
    });
    expect(result.integrity.segmentHealth[0]).toMatchObject({
      lexicalTokenCount: 1,
      specialTokenCount: 0,
      usableTokenCount: 0,
      quarantinedTokenCount: 1,
    });
    expect(result.tokens[0]).toMatchObject({
      textUsable: false,
      timingUsable: false,
    });
    expect(result.tokens[0]?.quarantineReasons).toContain(
      "INVALID_UTF8_REPLACEMENT_CHARACTER",
    );
  });

  it("preserves raw VAD-local bounds separately from their verified global mapping", () => {
    const result = auditTimestampEvidenceAttempt({
      attemptId: "raw-vad-attempt",
      profile: "current-sensitive-vad",
      useVad: true,
      extractionInterval: { start: 100, end: 110 },
      segments: [],
      rawVadIntervals: [
        {
          intervalId: "raw-vad-1",
          start: 1.25,
          end: 2.5,
          coordinateSystem: "original-audio-local",
        },
      ],
      tokenTimestampsRequested: true,
      tokenTimestampPolicy: "auto",
      mappedTokenGetterActuallyUsed: false,
    });
    expect(result.rawVadIntervals).toEqual([
      {
        intervalId: "raw-vad-1",
        source: "raw-vad",
        coordinateSystem: "original-media-global",
        start: 101.25,
        end: 102.5,
        timingUsable: true,
        rawStart: 1.25,
        rawEnd: 2.5,
        rawCoordinateSystem: "original-audio-local",
        mappingMethod: "verified-vad-timeline-map",
      },
    ]);
    expect(result.integrity.attemptMetrics.rawVadIntervalsAvailable).toBe(true);
  });

  it("permits only explicitly declared and verified segment-relative mapping", () => {
    const undeclared = audit({
      rawCoordinateSystem: "segment-relative",
      tokens: [{ text: "語", start: 0.1, end: 0.5 }],
    });
    const declared = audit({
      rawCoordinateSystem: "segment-relative",
      tokens: [
        {
          text: "語",
          start: 0.1,
          end: 0.5,
          declaredSegmentRelative: true,
        },
      ],
    });
    expect(undeclared.tokens[0]?.timingUsable).toBe(false);
    expect(declared.tokens[0]).toMatchObject({
      timingUsable: true,
      mappingMethod: "verified-segment-relative-offset",
      tokenTimelineStatus: "trusted-segment-relative-remap",
    });
  });

  it("keeps quarantined token text lexical-only and out of timing intervals", () => {
    const result = audit({
      useVad: true,
      segment: [2, 3],
      tokens: [{ text: "語", start: 0.2, end: 0.7 }],
    });
    const attempt = {
      attemptId: "attempt-fixture",
      componentId: "component",
      profile: "current-sensitive-vad",
      requestId: "request",
      requestType: "overlap-evidence",
      useVad: true,
      vadProfile: "sensitive-v2",
      model: "large-v3.bin",
      modelHash: HASH,
      modelFamily: "large-v3",
      coreML: false,
      whisperCppVersion: "1.9.1",
      cacheHit: false,
      promptSha256: HASH,
      targetCueTextUsedAsPrompt: false,
      referenceTranslationUsedAsPrompt: false,
      humanReviewedSentenceUsedAsPrompt: false,
      rawText: "語",
      segments: result.segments,
      tokens: result.tokens,
      speechIntervals: result.decodedSegmentIntervals.map(({ start, end }) => ({
        start,
        end,
      })),
      timestampIntegrityRef:
        "subtitle-timestamp-evidence-integrity.json#attempt:attempt-fixture",
      decodedSegmentIntervals: result.decodedSegmentIntervals,
      mappedTrustedTokenIntervals: [],
      rawVadIntervals: [],
      sourceCueIntervals: [],
      metrics: {
        durationSeconds: 10,
        segmentCount: 1,
        tokenCount: 1,
        speechIntervalCount: 1,
        tokenTimestampsRequested: true,
        tokenTimestampsReturned: true,
        trustedTokenTimestampsAvailable: false,
        trustedTokenTimestampsUsed: false,
        tokenTimestampsUsed: false,
      },
      language: "ja",
      failure: null,
    } as unknown as OverlapAcousticAttempt;
    const alignment = alignOverlapComponentCues({
      cues: [
        {
          id: "cue",
          text: "語",
          start: 102,
          end: 103,
          language: "ja",
          languages: ["ja"],
          speaker: null,
          confidence: 1,
        },
      ],
      attempts: [attempt],
    })[0];
    expect(alignment?.matchedTokenIds).toEqual(["token-0"]);
    expect(alignment?.trustedMatchedTokenIds).toEqual([]);
    expect(alignment?.quarantinedMatchedTokenIds).toEqual(["token-0"]);
    expect(alignment?.matchedIntervals).toEqual([]);
    expect(alignment?.boundaryConfidence).toBe(0);
  });
});

describe("C5.15.1 sanitized P0 fixture", () => {
  it("reproduces all five independent legacy audit invariants", async () => {
    const fixture = JSON.parse(
      await readFile(
        new URL("./fixtures/c5-15-token-timestamp-audit.json", import.meta.url),
        "utf8",
      ),
    ) as { groups: FixtureGroup[]; containsCopyrightedText: boolean };
    expect(fixture.containsCopyrightedText).toBe(false);
    const results = fixture.groups.map((group) => {
      const tokens = group.tokens.map(([start, end], index) => ({
        tokenId: `${group.groupId}-token-${String(index)}`,
        text: "token",
        start,
        end,
        probability: null,
      }));
      const attempt = overlapAcousticAttemptSchema.parse({
        attemptId: group.groupId,
        componentId: group.groupId,
        profile: group.profile,
        requestId: group.groupId,
        requestType: "overlap-evidence",
        useVad: group.profile !== "no-vad",
        vadProfile: group.profile === "no-vad" ? "no-vad" : group.profile,
        model: "fixture.bin",
        modelHash: HASH,
        modelFamily: "large-v3",
        coreML: false,
        whisperCppVersion: "1.9.1",
        cacheHit: false,
        promptSha256: HASH,
        targetCueTextUsedAsPrompt: false,
        referenceTranslationUsedAsPrompt: false,
        humanReviewedSentenceUsedAsPrompt: false,
        rawText: "",
        segments: [
          {
            segmentId: `${group.groupId}-segment`,
            text: "fixture",
            start: group.segment[0],
            end: group.segment[1],
            confidence: null,
            tokenIds: tokens.map((token) => token.tokenId),
          },
        ],
        tokens,
        speechIntervals: [{ start: group.segment[0], end: group.segment[1] }],
        metrics: {
          durationSeconds: group.extraction[1] - group.extraction[0],
          segmentCount: 1,
          tokenCount: tokens.length,
          speechIntervalCount: 1,
          tokenTimestampsRequested: true,
          tokenTimestampsUsed: true,
        },
        language: "ja",
        failure: null,
      });
      return auditLegacyOverlapAttempt(
        attempt,
        DEFAULT_TIMESTAMP_HEALTH_CONFIGURATION,
        { start: group.extraction[0], end: group.extraction[1] },
      );
    });
    const total = (key: keyof (typeof results)[number]) =>
      results.reduce((sum, result) => sum + result[key], 0);
    expect(total("segmentTokenGroupCount")).toBe(56);
    expect(total("containmentFailureCount50ms")).toBe(35);
    expect(total("zeroDurationTokenCount")).toBe(34);
    expect(total("boundaryClampedTokenCount")).toBe(38);
    expect(
      Math.max(...results.map((result) => result.maximumObservedDriftSeconds)),
    ).toBe(10.47);
  });
});

describe("C5.15.1 cache and public artifact semantics", () => {
  it("invalidates cache keys on mapping, health policy, and runtime capability", () => {
    const base = {
      audioContentSha256: HASH,
      interval: { start: 1, end: 2 },
      sampleRate: 16_000,
      channels: 1,
      codec: "pcm_s16le",
      adapterId: "whisper-cpp",
      model: "large-v3.bin",
      vadMode: "no-vad",
      timestampStrategy: "segment+token",
      tokenTimestamps: true,
      timestampMappingVersion: "mapping-v1",
      timestampCoordinateSystem: "original-audio-local",
      tokenHealthPolicyVersion: "health-v1",
      runtimeTimestampCapabilityHash: HASH,
    };
    const current = buildPortableAsrCacheIdentityV2(base);
    const mappingChanged = buildPortableAsrCacheIdentityV2({
      ...base,
      timestampMappingVersion: "mapping-v2",
    });
    const healthChanged = buildPortableAsrCacheIdentityV2({
      ...base,
      tokenHealthPolicyVersion: "health-v2",
    });
    const runtimeChanged = buildPortableAsrCacheIdentityV2({
      ...base,
      runtimeTimestampCapabilityHash: "b".repeat(64),
    });
    expect(
      new Set(
        [current, mappingChanged, healthChanged, runtimeChanged].map(
          buildPortableAsrCacheKey,
        ),
      ).size,
    ).toBe(4);
  });

  it("rejects legacy V2 timing by default and permits text-only reuse explicitly", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "c5-15-1-cache-"));
    const oldRoot = path.join(root, "old");
    const newRoot = path.join(root, "new");
    try {
      const legacyIdentity = buildPortableAsrCacheIdentityV2({
        audioContentSha256: HASH,
        interval: { start: 1, end: 2 },
        sampleRate: 16_000,
        channels: 1,
        codec: "pcm_s16le",
        adapterId: "whisper-cpp",
        model: "large-v3.bin",
        vadMode: "sensitive-v2",
        timestampStrategy: "segment+token",
        tokenTimestamps: true,
      });
      const currentIdentity = buildPortableAsrCacheIdentityV2({
        ...legacyIdentity,
        interval: { start: 1, end: 2 },
        sampleRate: 16_000,
        channels: 1,
        codec: "pcm_s16le",
        timestampMappingVersion: "mapping-v1",
        timestampCoordinateSystem: "vad-processed-local",
        tokenHealthPolicyVersion: "health-v1",
        runtimeTimestampCapabilityHash: HASH,
      });
      const writer = new PortableAsrCache({ portableRoot: oldRoot });
      await writer.store({
        requestId: "request",
        requestType: "overlap-evidence",
        identity: legacyIdentity,
        result: {
          text: "lexical text",
          segments: [
            {
              start: 0.2,
              end: 0.8,
              text: "lexical text",
              speaker: null,
              confidence: null,
              tokens: [{ text: "token", start: 0, end: 0.5 }],
            },
          ],
          raw: null,
        },
      });
      const rejected = await new PortableAsrCache({
        portableRoot: newRoot,
        importRoots: [oldRoot],
        mode: "read",
      }).lookup({
        requestId: "reject",
        requestType: "overlap-evidence",
        identity: currentIdentity,
        legacyV2Identity: legacyIdentity,
        legacyV2Policy: "reject",
      });
      const textOnly = await new PortableAsrCache({
        portableRoot: newRoot,
        importRoots: [oldRoot],
        mode: "read",
      }).lookup({
        requestId: "text-only",
        requestType: "overlap-evidence",
        identity: currentIdentity,
        legacyV2Identity: legacyIdentity,
        legacyV2Policy: "text-only",
      });
      expect(rejected).toMatchObject({ hit: false, hitType: "miss" });
      expect(textOnly).toMatchObject({
        hit: true,
        hitType: "legacy",
        tokenTimingTrust: "legacy-untrusted",
      });
      expect(textOnly.result?.text).toBe("lexical text");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("emits a strict integrity artifact with zero untrusted timing use", () => {
    const result = audit({
      tokens: [{ text: "語", start: 1.2, end: 1.8 }],
    });
    const capabilityPayload = {
      whisperCppVersion: "1.9.1",
      runtimeBinaryPathRecordedAsBasenameOnly: "whisper-server",
      runtimeBinarySha256: HASH,
      runtimeSourceCommit: null,
      serverResponseFormat: "verbose_json",
      mappedTokenGetterAvailable: false,
      mappedTokenGetterActuallyUsed: false,
      rawVadGetterAvailable: false,
      rawVadGetterActuallyUsed: false,
      tokenTimestampControlAvailable: true,
      timestampCapabilityProbeMethod: "fixture",
      timestampCapabilityStatus: "legacy-vad-unmapped" as const,
      evidence: ["fixture"],
    };
    const artifact = buildTimestampEvidenceIntegrityArtifact({
      generatedAt: "2026-08-25T00:00:00.000Z",
      sourceOverlapArtifactHash: HASH,
      runtimeCapability: {
        ...capabilityPayload,
        runtimeTimestampCapabilityHash:
          timestampIntegrityHash(capabilityPayload),
      },
      mode: "enforce",
      tokenTimestampPolicy: "auto",
      legacyOverlapCachePolicy: "reject",
      attempts: [result.integrity],
      trustedTokenUsedForTimingIds: new Set(["token-0"]),
      untrustedTokenUsedForTimingIds: new Set(),
    });
    expect(
      subtitleTimestampEvidenceIntegritySchema.parse(artifact).summary,
    ).toMatchObject({
      untrustedTokenUsedForTimingCount: 0,
      trustedTokenUsedForTimingCount: 1,
    });
    expect(JSON.stringify(artifact)).not.toContain("/opt/homebrew");
  });

  it("allows observe artifacts to report legacy timing use without trusting it", () => {
    const result = audit({
      useVad: true,
      tokens: [{ text: "語", start: 0.2, end: 0.7 }],
    });
    const capabilityPayload = {
      whisperCppVersion: "1.9.1",
      runtimeBinaryPathRecordedAsBasenameOnly: "whisper-server",
      runtimeBinarySha256: HASH,
      runtimeSourceCommit: null,
      serverResponseFormat: "verbose_json",
      mappedTokenGetterAvailable: false,
      mappedTokenGetterActuallyUsed: false,
      rawVadGetterAvailable: false,
      rawVadGetterActuallyUsed: false,
      tokenTimestampControlAvailable: true,
      timestampCapabilityProbeMethod: "fixture",
      timestampCapabilityStatus: "legacy-vad-unmapped" as const,
      evidence: ["fixture"],
    };
    const artifact = buildTimestampEvidenceIntegrityArtifact({
      generatedAt: "2026-08-25T00:00:00.000Z",
      sourceOverlapArtifactHash: HASH,
      runtimeCapability: {
        ...capabilityPayload,
        runtimeTimestampCapabilityHash:
          timestampIntegrityHash(capabilityPayload),
      },
      mode: "observe",
      tokenTimestampPolicy: "auto",
      legacyOverlapCachePolicy: "reject",
      attempts: [result.integrity],
      trustedTokenUsedForTimingIds: new Set(),
      untrustedTokenUsedForTimingIds: new Set(["token-0"]),
    });
    expect(
      subtitleTimestampEvidenceIntegritySchema.parse(artifact).summary,
    ).toMatchObject({
      untrustedTokenUsedForTimingCount: 1,
      integrityGateFailures: ["UNTRUSTED_TOKEN_USED_FOR_TIMING"],
    });
  });

  it("reports every C5.15.1 timing-integrity gate failure explicitly", () => {
    const attempt = {
      attemptId: "gate-attempt",
      componentId: "component-1",
      profile: "current-sensitive-vad",
      model: "large-v3",
      backend: "whisper.cpp",
      useVad: true,
      promptPolicy: "isolated-component-only",
      prompt: null,
      extractionStart: 10,
      extractionEnd: 20,
      cacheHit: false,
      rawText: "語",
      segments: [
        {
          segmentId: "decoded-segment-1",
          text: "語",
          start: 11,
          end: 12,
          confidence: 0.9,
          tokenIds: ["bad-token", "bad-token-nonmono"],
        },
      ],
      tokens: [
        {
          tokenId: "bad-token",
          parentSegmentId: "decoded-segment-1",
          text: "語",
          start: 0,
          end: 0,
          probability: 0.9,
          rawStart: 0,
          rawEnd: 0,
          rawCoordinateSystem: "unknown",
          mappedStart: null,
          mappedEnd: null,
          mappedCoordinateSystem: "unknown",
          mappingMethod: "quarantined",
          mappingVersion: "legacy-unversioned",
          mappingConfidence: 0,
          textUsable: true,
          timingUsable: false,
          tokenTimelineStatus: "zero-collapsed",
          tokenTimelineTrustScore: 0,
          quarantineReasons: ["TOKEN_OUTSIDE_PARENT_SEGMENT"],
          specialToken: false,
          boundaryClamped: true,
        },
        {
          tokenId: "bad-token-nonmono",
          parentSegmentId: "decoded-segment-1",
          text: "逆",
          start: 0.5,
          end: 0.7,
          probability: 0.8,
          rawStart: 0.5,
          rawEnd: 0.7,
          rawCoordinateSystem: "unknown",
          mappedStart: null,
          mappedEnd: null,
          mappedCoordinateSystem: "unknown",
          mappingMethod: "quarantined",
          mappingVersion: "legacy-unversioned",
          mappingConfidence: 0,
          textUsable: true,
          timingUsable: false,
          tokenTimelineStatus: "non-monotonic",
          tokenTimelineTrustScore: 0,
          quarantineReasons: ["NON_MONOTONIC_TOKEN_SEQUENCE"],
          specialToken: false,
          boundaryClamped: false,
        },
      ],
      decodedSegmentIntervals: [],
      mappedTrustedTokenIntervals: [],
      rawVadIntervals: [],
      sourceCueIntervals: [],
      metrics: {
        segmentCount: 1,
        tokenCount: 2,
        tokenTimestampsRequested: true,
        tokenTimestampsReturned: true,
        tokenTimestampsUsed: true,
        trustedTokenTimestampsAvailable: false,
        trustedTokenTimestampsUsed: false,
        lexicalEvidenceTokenCount: 2,
        trustedTimingTokenCount: 0,
        quarantinedTimingTokenCount: 2,
      },
      failure: null,
    } as unknown as OverlapAcousticAttempt;
    const failures = evaluateTimestampEvidenceIntegrityGate({
      attempts: [attempt],
      alignments: [
        {
          cueId: "cue-1",
          canonicalText: "語",
          normalizedSurface: "語",
          normalizedReading: null,
          readingAvailable: false,
          surfaceAlignmentScore: 1,
          readingAlignmentScore: null,
          tokenCoverageScore: 1,
          temporalCoverageRatio: 0,
          localSpeechCoverageRatio: 0,
          neighborIntrusionRatio: 0,
          profileConsensusScore: 0,
          boundarySupportScore: 0,
          boundaryConfidence: 0,
          independentProfileSupportCount: 1,
          independentModelSupportCount: 1,
          matchedAttemptIds: ["gate-attempt"],
          matchedSegmentIds: [],
          matchedTokenIds: ["bad-token"],
          trustedMatchedTokenIds: [],
          quarantinedMatchedTokenIds: ["bad-token"],
          trustedTimingEvidenceIds: [],
          lexicalOnlyEvidenceIds: ["bad-token"],
          trustedTimingProfileSupportCount: 0,
          trustedTimingSourceTypeCount: 0,
          trustedTimingModelSupportCount: 0,
          matchedIntervals: [
            {
              attemptId: "gate-attempt",
              source: "legacy-token-untrusted",
              start: 0,
              end: 0,
              evidenceId: "bad-token+bad-token-nonmono",
              timingUsable: false,
              timestampTrustStatus: "untrusted",
              timingTrustScore: 0,
              alignmentScore: 1,
              parentSegmentContainmentPassed: false,
              profileConsensusScore: 0,
              boundaryConfidence: 0,
              neighborIntrusionRatio: 0,
            },
            {
              attemptId: "gate-attempt",
              source: "raw-vad",
              start: 11,
              end: 12,
              evidenceId: "decoded-segment-1",
              timingUsable: true,
            },
          ],
          alignmentMethod: "unresolved",
          alignmentConfidence: 0,
          blockers: [],
          evidence: [],
        },
      ],
      runtimeCapability: {
        whisperCppVersion: "fixture",
        runtimeBinaryPathRecordedAsBasenameOnly: "whisper-server",
        runtimeBinarySha256: HASH,
        runtimeSourceCommit: null,
        serverResponseFormat: "verbose_json",
        mappedTokenGetterAvailable: false,
        mappedTokenGetterActuallyUsed: true,
        rawVadGetterAvailable: false,
        rawVadGetterActuallyUsed: true,
        tokenTimestampControlAvailable: true,
        timestampCapabilityProbeMethod: "fixture",
        timestampCapabilityStatus: "unverified",
        evidence: ["deliberately inconsistent fixture"],
        runtimeTimestampCapabilityHash: HASH,
      },
    });
    expect(failures).toEqual([
      "DECODED_SEGMENT_MISLABELED_AS_RAW_VAD",
      "LEGACY_UNVERSIONED_TOKEN_USED_FOR_TIMING",
      "NON_MONOTONIC_TOKEN_SEQUENCE_USED",
      "TIMESTAMP_CAPABILITY_CLAIM_UNVERIFIED",
      "TOKEN_OUTSIDE_PARENT_SEGMENT_USED",
      "UNKNOWN_COORDINATE_TOKEN_USED_FOR_TIMING",
      "UNTRUSTED_TOKEN_USED_FOR_TIMING",
      "ZERO_COLLAPSED_TOKEN_SEQUENCE_USED",
    ]);
  });
});
