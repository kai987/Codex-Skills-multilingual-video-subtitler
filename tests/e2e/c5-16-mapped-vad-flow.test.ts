import { describe, expect, it } from "vitest";

import {
  mvlWhisperServerCapabilitiesSchema,
  mvlWhisperServerResponseSchema,
  overlapAcousticAttemptSchema,
  type OverlapAcousticAttempt,
  type OverlapAcousticProfile,
  type OverlapDecision,
  type SubtitleCue,
} from "@mvl/shared";
import {
  alignOverlapComponentCues,
  auditTimestampEvidenceAttempt,
  classifyOverlapAcousticComponent,
  evaluateMvlCapabilityHandshake,
  type OverlapAcousticComponentPlan,
} from "@mvl/transcription-core";

const HASH = "a".repeat(64);
const COMMIT = "371b5a7561823ab2bb32142d2751e35e7534727b";
const PATCH_SHA =
  "bba39640e7005a1fdeb62c549d04ba76b6fc0d8aedae43daf9c9de1ab10a735d";

interface Span {
  text: string;
  start: number;
  end: number;
}

function cue(
  id: string,
  text: string,
  start: number,
  end: number,
): SubtitleCue {
  return {
    id,
    text,
    start,
    end,
    language: "ja",
    languages: ["ja"],
    speaker: null,
    confidence: 1,
  };
}

function componentPlan(
  cues: readonly SubtitleCue[],
): OverlapAcousticComponentPlan {
  return {
    componentId: "c5-16-component",
    sourceOverlapDecisionId: "c5-16-decision",
    cueIds: cues.map((value) => value.id),
    unionInterval: {
      start: Math.min(...cues.map((value) => value.start)),
      end: Math.max(...cues.map((value) => value.end)),
    },
    extractionInterval: {
      start: Math.max(0, Math.min(...cues.map((value) => value.start)) - 1.5),
      end: Math.max(...cues.map((value) => value.end)) + 1.5,
    },
    profiles: ["current-sensitive-vad", "no-vad", "extra-sensitive-vad"],
  };
}

function decision(cues: readonly SubtitleCue[]): OverlapDecision {
  const left = cues[0];
  const right = cues[1];
  if (left === undefined || right === undefined)
    throw new Error("two cues required");
  const overlapSeconds = Math.max(
    0.01,
    Math.min(left.end, right.end) - Math.max(left.start, right.start),
  );
  return {
    decisionId: "c5-16-decision",
    cueIds: cues.map((value) => value.id),
    relationship: "unresolved",
    interval: {
      start: Math.min(...cues.map((value) => value.start)),
      end: Math.max(...cues.map((value) => value.end)),
    },
    overlapPairs: [
      {
        leftCueId: left.id,
        rightCueId: right.id,
        overlapSeconds,
        overlapRatio: Math.min(
          1,
          overlapSeconds /
            Math.min(left.end - left.start, right.end - right.start),
        ),
        textSimilarity: 0,
        textContainment: 0,
      },
    ],
    overlapSeconds,
    overlapRatio: Math.min(
      1,
      overlapSeconds / Math.min(left.end - left.start, right.end - right.start),
    ),
    textSimilarity: 0,
    textContainment: 0,
    speakerEvidence: [],
    styleEvidence: [],
    layerEvidence: [],
    sourceEvidence: [],
    tokenBoundaryEvidence: [],
    speechBoundaryEvidence: [],
    sceneEvidence: [],
    humanReviewedAuthority: true,
    recommendedAction: "review",
    safeAutomaticAction: "none",
    timingMutations: [],
    assEventOverrides: [],
    vttCueSettings: [],
    reasons: ["fixture-unresolved"],
    blocking: true,
    resolutionSource: "presentation-only",
    acousticEvidenceIds: [],
    classificationConfidence: null,
    counterfactualScores: {},
  };
}

function patchedAttempt(input: {
  cues: readonly SubtitleCue[];
  profile: OverlapAcousticProfile;
  spans: readonly Span[];
  rawVadGlobal?: readonly [number, number][];
}): OverlapAcousticAttempt {
  const plan = componentPlan(input.cues);
  const useVad = input.profile !== "no-vad";
  const attemptId = `attempt-${input.profile}`;
  const rawSegments = input.spans.map((span, index) => {
    const localStart = span.start - plan.extractionInterval.start;
    const localEnd = span.end - plan.extractionInterval.start;
    return {
      segmentId: `segment-${input.profile}-${String(index)}`,
      text: span.text,
      rawStart: localStart,
      rawEnd: localEnd,
      confidence: 0.95,
      tokens: [
        {
          tokenId: `token-${input.profile}-${String(index)}`,
          text: span.text,
          rawStart: localStart,
          rawEnd: localEnd,
          probability: 0.95,
          rawCoordinateSystem: useVad
            ? ("vad-processed-local" as const)
            : ("original-audio-local" as const),
          officialMappedStart: localStart,
          officialMappedEnd: localEnd,
        },
      ],
    };
  });
  const audit = auditTimestampEvidenceAttempt({
    attemptId,
    profile: input.profile,
    useVad,
    extractionInterval: plan.extractionInterval,
    segments: rawSegments,
    rawVadIntervals: useVad
      ? (input.rawVadGlobal ?? []).map(([start, end], index) => ({
          intervalId: `raw-vad-${input.profile}-${String(index)}`,
          start: start - plan.extractionInterval.start,
          end: end - plan.extractionInterval.start,
          coordinateSystem: "original-audio-local" as const,
        }))
      : [],
    tokenTimestampsRequested: true,
    tokenTimestampPolicy: "mapped-only",
    mappedTokenGetterActuallyUsed: true,
  });
  return overlapAcousticAttemptSchema.parse({
    attemptId,
    componentId: plan.componentId,
    profile: input.profile,
    requestId: `request-${input.profile}`,
    requestType: "overlap-evidence",
    useVad,
    vadProfile: useVad ? input.profile : "no-vad",
    model: "ggml-large-v3.bin",
    modelHash: HASH,
    modelFamily: "large-v3",
    coreML: false,
    whisperCppVersion: "1.9.3",
    cacheHit: false,
    promptSha256:
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    targetCueTextUsedAsPrompt: false,
    referenceTranslationUsedAsPrompt: false,
    humanReviewedSentenceUsedAsPrompt: false,
    runtimeCapabilityRef: "whisper-runtime-capability.json",
    responseSchemaVersion: "mvl-whisper-server-response/1.0.0",
    rawText: input.spans.map((span) => span.text).join(""),
    segments: audit.segments,
    tokens: audit.tokens,
    rawTokens: audit.tokens.map((token) => ({
      tokenId: token.tokenId,
      parentSegmentId: token.parentSegmentId,
      text: token.text,
      special: false,
      start: token.rawStart,
      end: token.rawEnd,
      coordinateSystem: token.rawCoordinateSystem,
    })),
    mappedTokens: audit.tokens.map((token) => ({
      tokenId: token.tokenId,
      parentSegmentId: token.parentSegmentId,
      text: token.text,
      start: token.mappedStart,
      end: token.mappedEnd,
      coordinateSystem: "original-media-global",
      mappingMethod: "official-mapped-token-getter",
      timingUsable: token.timingUsable,
    })),
    speechIntervals: audit.decodedSegmentIntervals.map(({ start, end }) => ({
      start,
      end,
    })),
    timestampIntegrityRef: `subtitle-timestamp-evidence-integrity.json#attempt:${attemptId}`,
    decodedSegmentIntervals: audit.decodedSegmentIntervals,
    mappedTrustedTokenIntervals: audit.mappedTrustedTokenIntervals,
    rawVadIntervals: audit.rawVadIntervals,
    sourceCueIntervals: [],
    metrics: {
      durationSeconds:
        plan.extractionInterval.end - plan.extractionInterval.start,
      segmentCount: audit.segments.length,
      tokenCount: audit.tokens.length,
      speechIntervalCount: audit.decodedSegmentIntervals.length,
      tokenTimestampsRequested: true,
      tokenTimestampsReturned: true,
      trustedTokenTimestampsAvailable: true,
      trustedTokenTimestampsUsed: false,
      tokenTimestampsUsed: false,
    },
    language: "ja",
    failure: null,
  });
}

function threeProfiles(input: {
  cues: readonly SubtitleCue[];
  spans: readonly Span[];
  rawVadGlobal?: readonly [number, number][];
}): OverlapAcousticAttempt[] {
  return (
    ["current-sensitive-vad", "no-vad", "extra-sensitive-vad"] as const
  ).map((profile) =>
    patchedAttempt({
      ...input,
      profile,
    }),
  );
}

function classify(input: {
  cues: SubtitleCue[];
  spans: Span[];
  rawVadGlobal?: [number, number][];
  attempts?: OverlapAcousticAttempt[];
}) {
  const attempts =
    input.attempts ??
    threeProfiles({
      cues: input.cues,
      spans: input.spans,
      ...(input.rawVadGlobal === undefined
        ? {}
        : { rawVadGlobal: input.rawVadGlobal }),
    });
  return classifyOverlapAcousticComponent({
    plan: componentPlan(input.cues),
    allCues: input.cues,
    sourceDecision: decision(input.cues),
    attempts,
    mode: "enforce",
    audioPath: "audio/overlap/component.wav",
    audioSha256: HASH,
    audioDurationSeconds: 5,
    audioFullyCoversComponent: true,
  });
}

describe("C5.16 mock patched-server evidence flow", () => {
  it("validates capability and response contracts before evidence admission", () => {
    const capability = mvlWhisperServerCapabilitiesSchema.parse({
      schema_version: "mvl-whisper-server-capabilities/1.0.0",
      whisper_cpp_version: "1.9.3",
      upstream_commit: COMMIT,
      patch_id: "mvl-mapped-token-raw-vad-json-v1",
      patch_sha256: PATCH_SHA,
      mapped_token_getter_available: true,
      raw_vad_getter_available: true,
      supported_response_formats: ["mvl_verbose_json_v1"],
      time_units: ["centiseconds", "seconds"],
      coordinate_system_contract: {
        segment: "original-audio-local",
        token_raw_with_vad: "vad-processed-local",
        token_raw_without_vad: "original-audio-local",
        token_mapped: "original-audio-local",
        raw_vad: "original-audio-local",
      },
    });
    expect(
      evaluateMvlCapabilityHandshake({
        rawCapabilities: capability,
        expectedRuntime: {
          upstreamCommit: COMMIT,
          patchId: "mvl-mapped-token-raw-vad-json-v1",
          patchSha256: PATCH_SHA,
          binarySha256: HASH,
          buildFlagsHash: HASH,
        },
        actualBinarySha256: HASH,
      }).verified,
    ).toBe(true);
    expect(
      mvlWhisperServerResponseSchema.safeParse({ schema_version: "wrong" })
        .success,
    ).toBe(false);
  });

  it("performs a verified boundary repair with mapped tokens and a cross-profile VAD pause", () => {
    const cues = [cue("a", "前", 10, 11.4), cue("b", "後", 10.6, 12)];
    const result = classify({
      cues,
      spans: [
        { text: "前", start: 10.1, end: 10.9 },
        { text: "後", start: 11.1, end: 11.9 },
      ],
      rawVadGlobal: [
        [9.9, 10.9],
        [11.1, 12.2],
      ],
    });
    expect(result).toMatchObject({
      finalRelationship: "different-dialogue-boundary-error",
      safeAutomaticAction: "timing-only",
      blocking: false,
    });
    expect(result.pairAssessments[0]?.rawVadBoundaryRelation).toBe(
      "pause-supported",
    );
    expect(result.timingMutations).toHaveLength(2);
    expect(
      result.timingMutations.map((mutation) => mutation.textChanged),
    ).toEqual([false, false]);
  });

  it("keeps a continuous raw VAD island from becoming speaker evidence", () => {
    const cues = [cue("a", "前", 10, 11.2), cue("b", "後", 11, 12.2)];
    const result = classify({
      cues,
      spans: [
        { text: "前", start: 10.1, end: 11.05 },
        { text: "後", start: 11, end: 12 },
      ],
      rawVadGlobal: [[9.9, 12.2]],
    });
    expect(result.finalRelationship).toBe("rapid-turn-taking");
    expect(result.pairAssessments[0]?.rawVadBoundaryRelation).toBe(
      "continuous-speech-island",
    );
    expect(result.pairAssessments[0]?.simultaneousSpeechSupported).toBe(false);
  });

  it("preserves multi-island raw VAD lineage independently of decoded segments", () => {
    const cues = [cue("a", "前", 10, 11.4), cue("b", "後", 10.6, 12)];
    const attempts = threeProfiles({
      cues,
      spans: [
        { text: "前", start: 10.1, end: 10.9 },
        { text: "後", start: 11.1, end: 11.9 },
      ],
      rawVadGlobal: [
        [9.9, 10.9],
        [11.1, 12.2],
      ],
    });
    const alignments = alignOverlapComponentCues({ cues, attempts });
    // The two VAD-enabled profiles are independent acoustic observations, so
    // both islands from both profiles remain addressable. Duplicate
    // representations inside one lineage are still collapsed by the aligner.
    expect(alignments[0]?.trustedRawVadEvidenceIds).toHaveLength(4);
    expect(new Set(alignments[0]?.timingEvidenceLineageIds ?? []).size).toBe(
      alignments[0]?.timingEvidenceLineageIds.length,
    );
    expect(
      alignments[0]?.timingEvidenceLineageIds.some((id) =>
        id.startsWith("whisper-internal-vad:"),
      ),
    ).toBe(true);
  });

  it("keeps legacy VAD token timing quarantined when the stock endpoint is absent", () => {
    const handshake = evaluateMvlCapabilityHandshake({
      rawCapabilities: null,
      expectedRuntime: undefined,
      actualBinarySha256: null,
    });
    const audited = auditTimestampEvidenceAttempt({
      attemptId: "legacy",
      profile: "current-sensitive-vad",
      useVad: true,
      extractionInterval: { start: 10, end: 15 },
      segments: [
        {
          segmentId: "segment",
          text: "旧",
          rawStart: 1,
          rawEnd: 2,
          confidence: 0.8,
          tokens: [
            {
              tokenId: "legacy-token",
              text: "旧",
              rawStart: 0.1,
              rawEnd: 0.5,
              probability: 0.8,
            },
          ],
        },
      ],
      tokenTimestampsRequested: true,
      tokenTimestampPolicy: "auto",
      mappedTokenGetterActuallyUsed: false,
    });
    expect(handshake.verified).toBe(false);
    expect(audited.tokens[0]).toMatchObject({
      textUsable: true,
      timingUsable: false,
      mappedStart: null,
    });
  });

  it("blocks a capability mismatch and a mapped token health failure", () => {
    const mismatch = evaluateMvlCapabilityHandshake({
      rawCapabilities: {
        schema_version: "mvl-whisper-server-capabilities/1.0.0",
      },
      expectedRuntime: {
        upstreamCommit: COMMIT,
        patchId: "mvl-mapped-token-raw-vad-json-v1",
        patchSha256: PATCH_SHA,
        binarySha256: HASH,
        buildFlagsHash: HASH,
      },
      actualBinarySha256: HASH,
    });
    const failedMapping = auditTimestampEvidenceAttempt({
      attemptId: "bad-mapped",
      profile: "current-sensitive-vad",
      useVad: true,
      extractionInterval: { start: 10, end: 15 },
      segments: [
        {
          segmentId: "segment",
          text: "外",
          rawStart: 1,
          rawEnd: 2,
          confidence: 0.8,
          tokens: [
            {
              tokenId: "outside",
              text: "外",
              rawStart: 0.1,
              rawEnd: 0.5,
              probability: 0.8,
              rawCoordinateSystem: "vad-processed-local",
              officialMappedStart: 4.8,
              officialMappedEnd: 5.2,
            },
          ],
        },
      ],
      tokenTimestampsRequested: true,
      tokenTimestampPolicy: "mapped-only",
      mappedTokenGetterActuallyUsed: true,
    });
    expect(mismatch.verified).toBe(false);
    expect(failedMapping.tokens[0]?.timingUsable).toBe(false);
  });

  it("applies a three-cue timing proposal atomically", () => {
    const cues = [
      cue("a", "一", 20, 21.4),
      cue("b", "二", 20.6, 22.4),
      cue("c", "三", 21.6, 23),
    ];
    const result = classify({
      cues,
      spans: [
        { text: "一", start: 20.1, end: 20.95 },
        { text: "二", start: 21.05, end: 21.95 },
        { text: "三", start: 22.05, end: 22.9 },
      ],
      rawVadGlobal: [
        [19.9, 20.95],
        [21.05, 21.95],
        [22.05, 23.1],
      ],
    });
    expect(result.timingMutations.map((mutation) => mutation.cueId)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(result.reasons).toContain("component-atomic-proposal-valid");
  });

  it("keeps evidence-insufficient components unresolved without text mutation", () => {
    const cues = [cue("a", "前", 10, 11.4), cue("b", "後", 10.6, 12)];
    const onlyOneProfile = [
      patchedAttempt({
        cues,
        profile: "current-sensitive-vad",
        spans: [
          { text: "前", start: 10.1, end: 10.9 },
          { text: "後", start: 11.1, end: 11.9 },
        ],
        rawVadGlobal: [
          [9.9, 10.9],
          [11.1, 12.2],
        ],
      }),
    ];
    const result = classify({
      cues,
      spans: [],
      attempts: onlyOneProfile,
    });
    expect(result).toMatchObject({
      finalRelationship: "unresolved",
      blocking: true,
      safeAutomaticAction: "none",
      timingMutations: [],
    });
  });
});
