import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  overlapAcousticAttemptSchema,
  type OverlapAcousticAttempt,
  type OverlapAcousticProfile,
  type OverlapDecision,
  type SubtitleCue,
} from "@mvl/shared";
import {
  PortableAsrCache,
  alignOverlapComponentCues,
  buildPortableAsrCacheIdentityV2,
  buildPortableAsrCacheKey,
  buildSubtitleOverlapAcousticResolution,
  buildSubtitlePresentationResolution,
  clampWhisperSegmentInterval,
  classifyOverlapAcousticComponent,
  normalizeOverlapSurface,
  overlapAcousticTextSimilarity,
  planOverlapAcousticComponents,
  presentationResolutionHash,
  type OverlapAcousticComponentPlan,
} from "@mvl/transcription-core";
import {
  mapOverlapLocalTimestampToGlobal,
  overlapAcousticEvidenceForHash,
  sha256LocalFile,
} from "@mvl/video-subtitler";

const HASH = "a".repeat(64);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

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

function plan(cues: readonly SubtitleCue[]): OverlapAcousticComponentPlan {
  return {
    componentId: "component-fixture",
    sourceOverlapDecisionId: "decision-fixture",
    cueIds: cues.map((item) => item.id),
    unionInterval: {
      start: Math.min(...cues.map((item) => item.start)),
      end: Math.max(...cues.map((item) => item.end)),
    },
    extractionInterval: {
      start: Math.max(0, Math.min(...cues.map((item) => item.start)) - 1.5),
      end: Math.max(...cues.map((item) => item.end)) + 1.5,
    },
    profiles: ["current-sensitive-vad", "no-vad", "extra-sensitive-vad"],
  };
}

function sourceDecision(
  cues: readonly SubtitleCue[],
  textSimilarity = 0,
): OverlapDecision {
  const left = cues[0];
  const right = cues[1];
  if (left === undefined || right === undefined) {
    throw new Error("decision fixture needs two cues");
  }
  const overlapSeconds = Math.max(
    0.01,
    Math.min(left.end, right.end) - Math.max(left.start, right.start),
  );
  return {
    decisionId: "decision-fixture",
    cueIds: cues.map((item) => item.id),
    relationship: "unresolved",
    interval: {
      start: Math.min(...cues.map((item) => item.start)),
      end: Math.max(...cues.map((item) => item.end)),
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
        textSimilarity,
        textContainment: textSimilarity,
      },
    ],
    overlapSeconds,
    overlapRatio: Math.min(
      1,
      overlapSeconds / Math.min(left.end - left.start, right.end - right.start),
    ),
    textSimilarity,
    textContainment: textSimilarity,
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

interface EvidenceSpan {
  text: string;
  start: number;
  end: number;
}

function attempt(
  profile: OverlapAcousticProfile,
  spans: readonly EvidenceSpan[],
  options: {
    componentId?: string;
    requestId?: string;
    modelHash?: string;
    source?: "token" | "segment";
    duplicateSegments?: boolean;
  } = {},
): OverlapAcousticAttempt {
  const requestId = options.requestId ?? `request-${profile}`;
  const useVad = profile !== "no-vad";
  const source = options.source ?? "token";
  const segments =
    source === "segment"
      ? spans.flatMap((span, index) => {
          const segment = {
            segmentId: `segment-${profile}-${index}`,
            text: span.text,
            start: span.start,
            end: span.end,
            confidence: 0.95,
            tokenIds: [],
          };
          return options.duplicateSegments === true
            ? [
                segment,
                { ...segment, segmentId: `${segment.segmentId}-duplicate` },
              ]
            : [segment];
        })
      : [];
  const tokens =
    source === "token"
      ? spans.map((span, index) => ({
          tokenId: `token-${profile}-${index}`,
          text: span.text,
          start: span.start,
          end: span.end,
          probability: 0.95,
        }))
      : [];
  return overlapAcousticAttemptSchema.parse({
    attemptId: `attempt-${profile}-${requestId}`,
    componentId: options.componentId ?? "component-fixture",
    profile,
    requestId,
    requestType: "overlap-evidence",
    useVad,
    vadProfile: useVad ? profile : "no-vad",
    model: "ggml-large-v3.bin",
    modelHash: options.modelHash ?? HASH,
    modelFamily: "large-v3",
    coreML: false,
    whisperCppVersion: "1.9.1",
    cacheHit: false,
    promptSha256:
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    targetCueTextUsedAsPrompt: false,
    referenceTranslationUsedAsPrompt: false,
    humanReviewedSentenceUsedAsPrompt: false,
    rawText: spans.map((span) => span.text).join(""),
    segments,
    tokens,
    speechIntervals: spans.map(({ start, end }) => ({ start, end })),
    metrics: {
      durationSeconds: Math.max(...spans.map((span) => span.end), 0),
      segmentCount: segments.length,
      tokenCount: tokens.length,
      speechIntervalCount: spans.length,
      tokenTimestampsRequested: true,
      tokenTimestampsUsed: tokens.length > 0,
    },
    language: "ja",
    failure: null,
  });
}

function threeProfileAttempts(
  spans: readonly EvidenceSpan[],
  source: "token" | "segment" = "token",
) {
  return (
    ["current-sensitive-vad", "no-vad", "extra-sensitive-vad"] as const
  ).map((profile) => attempt(profile, spans, { source }));
}

function classify(input: {
  cues: SubtitleCue[];
  spans: EvidenceSpan[];
  mode?: "observe" | "enforce";
  source?: "token" | "segment";
  configuration?: Parameters<
    typeof classifyOverlapAcousticComponent
  >[0]["configuration"];
  textSimilarity?: number;
}) {
  return classifyOverlapAcousticComponent({
    plan: plan(input.cues),
    allCues: input.cues,
    sourceDecision: sourceDecision(input.cues, input.textSimilarity),
    attempts: threeProfileAttempts(input.spans, input.source),
    mode: input.mode ?? "enforce",
    configuration: input.configuration,
    audioPath: "audio/overlap/component.wav",
    audioSha256: HASH,
    audioDurationSeconds: 5,
    audioFullyCoversComponent: true,
  });
}

describe("C5.15 acoustic planning and cache", () => {
  it("drops a Whisper segment that becomes empty after chunk clamping", () => {
    expect(
      clampWhisperSegmentInterval({ start: 6.9, end: 7.2, duration: 6.88 }),
    ).toBeNull();
    expect(
      clampWhisperSegmentInterval({ start: -0.2, end: 0.4, duration: 6.88 }),
    ).toEqual({ start: 0, end: 0.4 });
  });

  it("streams model-sized file hashes without changing SHA-256 semantics", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "c5-15-model-hash-"));
    temporaryDirectories.push(root);
    const modelPath = path.join(root, "ggml-large-v3.bin");
    const content = Buffer.alloc(4 * 1024 * 1024, 0x5a);
    await writeFile(modelPath, content);
    expect(await sha256LocalFile(modelPath)).toBe(
      createHash("sha256").update(content).digest("hex"),
    );
  });

  it("plans only unresolved blocking overlap components", () => {
    const cues = [
      cue("a", "あ", 1, 3),
      cue("b", "い", 2, 4),
      cue("c", "う", 6, 8),
      cue("d", "え", 7, 9),
    ];
    const presentation = buildSubtitlePresentationResolution({
      cues,
      baseCueHash: presentationResolutionHash(cues),
      humanReviewedAuthority: true,
    });
    const artifact = {
      ...presentation.artifact,
      overlapDecisions: presentation.artifact.overlapDecisions.map(
        (item, index) =>
          index === 0
            ? {
                ...item,
                blocking: false,
                relationship: "legal-authoritative-overlap" as const,
              }
            : item,
      ),
    };
    const plans = planOverlapAcousticComponents({
      cues,
      presentation: artifact,
      mediaDurationSeconds: 10,
    });
    expect(plans).toHaveLength(1);
    expect(plans[0]?.cueIds).toEqual(["c", "d"]);
    expect(plans[0]?.profiles).toEqual([
      "current-sensitive-vad",
      "no-vad",
      "extra-sensitive-vad",
    ]);
  });

  it("does not create acoustic plans for layout or repetition decisions", () => {
    const cues = [
      cue("a", "あ".repeat(33), 1, 2),
      cue("b", "反復", 3, 4),
      cue("c", "反復", 4, 5),
    ];
    const presentation = buildSubtitlePresentationResolution({
      cues,
      baseCueHash: presentationResolutionHash(cues),
      humanReviewedAuthority: true,
    });
    expect(
      presentation.artifact.layoutDecisions.some((item) => item.blocking),
    ).toBe(true);
    expect(
      planOverlapAcousticComponents({
        cues,
        presentation: presentation.artifact,
        mediaDurationSeconds: 10,
      }),
    ).toEqual([]);
  });

  it("enforces the default request cap and absolute hard cap", () => {
    const cues = Array.from({ length: 16 }, (_, index) =>
      cue(`cue-${index}`, `かな${index}`, index * 3, index * 3 + 2),
    );
    const presentation = buildSubtitlePresentationResolution({
      cues,
      baseCueHash: presentationResolutionHash(cues),
    });
    const decisions = Array.from({ length: 8 }, (_, index) => {
      const pair = cues.slice(index * 2, index * 2 + 2);
      if (pair.length !== 2) throw new Error("missing fixture cue pair");
      return sourceDecision(pair);
    }).map((item, index) => ({ ...item, decisionId: `decision-${index}` }));
    expect(() =>
      planOverlapAcousticComponents({
        cues,
        presentation: { ...presentation.artifact, overlapDecisions: decisions },
        mediaDurationSeconds: 60,
      }),
    ).toThrow(/maximumOverlapAsrRequests/u);
    expect(() =>
      planOverlapAcousticComponents({
        cues,
        presentation: {
          ...presentation.artifact,
          overlapDecisions: decisions.slice(0, 7),
        },
        mediaDurationSeconds: 60,
        configuration: { maximumAsrRequests: 29 },
      }),
    ).toThrow(/absolute limit of 28/u);
  });

  it("counts profiles independently but one shared model only once", () => {
    const cues = [cue("a", "かな", 1, 2)];
    const aligned = alignOverlapComponentCues({
      cues,
      attempts: threeProfileAttempts([{ text: "かな", start: 1, end: 2 }]),
    });
    expect(aligned[0]?.independentProfileSupportCount).toBe(3);
    expect(aligned[0]?.independentModelSupportCount).toBe(1);
  });

  it("keys cache by profile, VAD, model, token mode and prompt", () => {
    const base = {
      audioContentSha256: HASH,
      interval: { start: 10, end: 20 },
      sampleRate: 16_000,
      channels: 1,
      codec: "pcm_s16le",
      adapterId: "whisper-cpp",
      model: "ggml-large-v3.bin",
      modelHash: HASH,
      modelFamily: "large-v3",
      coreML: false,
      whisperCppVersion: "1.9.1",
      language: "ja" as const,
      vadMode: "sensitive-v2",
      timestampStrategy: "segment+token",
      tokenTimestamps: true,
      prompt: undefined,
      decodeConfiguration: { profile: "current-sensitive-vad" },
    };
    const keys = [
      base,
      {
        ...base,
        vadMode: "no-vad",
        decodeConfiguration: { profile: "no-vad" },
      },
      { ...base, modelHash: "b".repeat(64) },
      { ...base, tokenTimestamps: false },
      { ...base, prompt: "forbidden prompt" },
    ].map((value) =>
      buildPortableAsrCacheKey(buildPortableAsrCacheIdentityV2(value)),
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("stores a legal overlap-evidence cache entry and skips work on hit", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "c5-15-cache-"));
    temporaryDirectories.push(root);
    const cache = new PortableAsrCache({
      portableRoot: root,
      mode: "read-write",
    });
    const identity = buildPortableAsrCacheIdentityV2({
      audioContentSha256: HASH,
      interval: { start: 1, end: 2 },
      sampleRate: 16_000,
      channels: 1,
      codec: "pcm_s16le",
      adapterId: "whisper-cpp",
      model: "ggml-large-v3.bin",
      modelHash: HASH,
      modelFamily: "large-v3",
      coreML: false,
      whisperCppVersion: "1.9.1",
      language: "ja",
      vadMode: "sensitive-v2",
      timestampStrategy: "segment+token",
      tokenTimestamps: true,
      decodeConfiguration: {
        requestType: "overlap-evidence",
        profile: "current-sensitive-vad",
      },
    });
    let workerCalls = 0;
    const load = async () => {
      const lookup = await cache.lookup({
        requestId: "request-one",
        requestType: "overlap-evidence",
        identity,
      });
      if (lookup.hit) return lookup.result;
      workerCalls += 1;
      const result = { text: "かな", segments: [], raw: null };
      await cache.store({
        requestId: "request-one",
        requestType: "overlap-evidence",
        identity,
        result,
      });
      return result;
    };
    expect(await load()).toMatchObject({ text: "かな" });
    expect(await load()).toMatchObject({ text: "かな" });
    expect(workerCalls).toBe(1);
    expect(
      cache
        .manifest()
        .entries.every((item) => item.requestType === "overlap-evidence"),
    ).toBe(true);
    expect(cache.manifest().summary.portableHitCount).toBe(1);
  });

  it("never represents reviewed text or a translation as an ASR prompt", () => {
    const parsed = attempt("no-vad", [{ text: "正解", start: 1, end: 2 }]);
    expect(parsed).toMatchObject({
      promptSha256:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      targetCueTextUsedAsPrompt: false,
      referenceTranslationUsedAsPrompt: false,
      humanReviewedSentenceUsedAsPrompt: false,
    });
  });

  it("maps local timestamps into clamped global media time", () => {
    expect(
      mapOverlapLocalTimestampToGlobal(12.25, { start: 10, end: 20 }),
    ).toBe(12.25);
    expect(mapOverlapLocalTimestampToGlobal(9.5, { start: 10, end: 20 })).toBe(
      10,
    );
    expect(mapOverlapLocalTimestampToGlobal(21, { start: 10, end: 20 })).toBe(
      20,
    );
  });

  it("keeps semantic evidence hashes stable between uncached and cached runs", () => {
    const uncachedAttempt = attempt("no-vad", [
      { text: "かな", start: 1, end: 2 },
    ]);
    const common = {
      sourceFingerprint: {
        fileName: "fixture.mkv",
        size: 1024,
        durationSeconds: 10,
        sha256: HASH,
      },
      baseCueHash: HASH,
      basePresentationResolutionHash: HASH,
      mode: "enforce" as const,
      audioStreamIndex: 1,
      components: [],
    };
    const uncached = buildSubtitleOverlapAcousticResolution({
      ...common,
      generatedAt: "2026-08-25T00:00:00.000Z",
      attempts: [uncachedAttempt],
    });
    const cached = buildSubtitleOverlapAcousticResolution({
      ...common,
      generatedAt: "2026-08-25T00:05:00.000Z",
      attempts: [{ ...uncachedAttempt, cacheHit: true }],
    });

    expect(uncached.summary).toMatchObject({
      asrRequestCount: 1,
      cacheHitCount: 0,
    });
    expect(cached.summary).toMatchObject({
      asrRequestCount: 0,
      cacheHitCount: 1,
    });
    expect(
      presentationResolutionHash(overlapAcousticEvidenceForHash(uncached)),
    ).toBe(presentationResolutionHash(overlapAcousticEvidenceForHash(cached)));
  });
});

describe("C5.15 posterior cue alignment", () => {
  it("aligns an exact surface token sequence", () => {
    const result = alignOverlapComponentCues({
      cues: [cue("a", "かなです", 1, 2)],
      attempts: threeProfileAttempts([
        { text: "かなです", start: 1.05, end: 1.95 },
      ]),
    });
    expect(result[0]).toMatchObject({
      surfaceAlignmentScore: 1,
      tokenCoverageScore: 1,
      independentProfileSupportCount: 3,
    });
  });

  it("normalizes punctuation, whitespace and full-width characters", () => {
    expect(normalizeOverlapSurface("Ａ、 かな！")).toBe("aかな");
    expect(overlapAcousticTextSimilarity("Ａ、 かな！", "aかな")).toBe(1);
  });

  it("uses a confirmed kana reading when the surface differs", () => {
    const result = alignOverlapComponentCues({
      cues: [cue("a", "着物", 1, 2)],
      attempts: threeProfileAttempts([
        { text: "きもの", start: 1.05, end: 1.95 },
      ]),
    });
    expect(result[0]?.readingAlignmentScore).toBe(1);
    expect(result[0]?.alignmentMethod).toBe("reading-token-sequence");
  });

  it("falls back to surface evidence with null reading for OOV kanji", () => {
    const result = alignOverlapComponentCues({
      cues: [cue("a", "未知漢字", 1, 2)],
      attempts: threeProfileAttempts([
        { text: "未知漢字", start: 1.05, end: 1.95 },
      ]),
    });
    expect(result[0]).toMatchObject({
      readingAvailable: false,
      normalizedReading: null,
      surfaceAlignmentScore: 1,
    });
  });

  it("does not give a partial fragment full coverage", () => {
    const result = alignOverlapComponentCues({
      cues: [cue("a", "ながいことばです", 1, 2)],
      attempts: threeProfileAttempts([
        { text: "ながい", start: 1.05, end: 1.45 },
      ]),
    });
    expect(result[0]?.tokenCoverageScore).toBeLessThan(1);
    expect(result[0]?.temporalCoverageRatio).toBeLessThan(1);
  });

  it("penalizes evidence that matches a neighboring cue better", () => {
    const base = alignOverlapComponentCues({
      cues: [cue("a", "あか", 1, 2)],
      attempts: threeProfileAttempts([
        { text: "あかあか", start: 1.05, end: 1.95 },
      ]),
    })[0];
    const invaded = alignOverlapComponentCues({
      cues: [cue("a", "あか", 1, 2), cue("b", "あかあか", 1.1, 2.1)],
      attempts: threeProfileAttempts([
        { text: "あかあか", start: 1.05, end: 1.95 },
      ]),
    }).find((item) => item.cueId === "a");
    expect(invaded?.neighborIntrusionRatio).toBeGreaterThan(
      base?.neighborIntrusionRatio ?? 0,
    );
    expect(invaded?.alignmentConfidence).toBeLessThan(
      base?.alignmentConfidence ?? 1,
    );
  });

  it("does not count duplicate segments in one request as independent profiles", () => {
    const result = alignOverlapComponentCues({
      cues: [cue("a", "かな", 1, 2)],
      attempts: [
        attempt("no-vad", [{ text: "かな", start: 1.05, end: 1.95 }], {
          source: "segment",
          duplicateSegments: true,
        }),
      ],
    });
    expect(result[0]?.independentProfileSupportCount).toBe(1);
  });

  it("keeps low-confidence evidence blocked", () => {
    const result = alignOverlapComponentCues({
      cues: [cue("a", "まったくちがう", 1, 2)],
      attempts: threeProfileAttempts([
        { text: "べつのことば", start: 4, end: 5 },
      ]),
    });
    expect(result[0]?.alignmentConfidence).toBeLessThan(0.72);
    expect(result[0]?.blockers).toContain("LOW_ALIGNMENT_CONFIDENCE");
  });

  it("is deterministic regardless of cue and attempt input order", () => {
    const cues = [cue("a", "かな", 1, 2), cue("b", "ことば", 2, 3)];
    const attempts = threeProfileAttempts([
      { text: "かな", start: 1.05, end: 1.95 },
      { text: "ことば", start: 2.05, end: 2.95 },
    ]);
    expect(alignOverlapComponentCues({ cues, attempts })).toEqual(
      alignOverlapComponentCues({
        cues: [...cues].reverse(),
        attempts: [...attempts].reverse(),
      }),
    );
  });
});

describe("C5.15 overlap relationship classification", () => {
  it("classifies a small acoustically overlapping ordered handoff as rapid turn-taking", () => {
    const cues = [cue("a", "まえ", 10, 11.4), cue("b", "つぎ", 11, 12.4)];
    const result = classify({
      cues,
      spans: [
        { text: "まえ", start: 10.1, end: 11.05 },
        { text: "つぎ", start: 11, end: 12.2 },
      ],
    });
    expect(result).toMatchObject({
      finalRelationship: "rapid-turn-taking",
      safeAutomaticAction: "presentation-only",
      blocking: false,
    });
  });

  it("classifies trusted ordered boundaries as a boundary error", () => {
    const cues = [cue("a", "まえ", 10, 11.4), cue("b", "つぎ", 11, 12.4)];
    const result = classify({
      cues,
      spans: [
        { text: "まえ", start: 10.1, end: 10.9 },
        { text: "つぎ", start: 11.1, end: 12.2 },
      ],
    });
    expect(result).toMatchObject({
      finalRelationship: "different-dialogue-boundary-error",
      safeAutomaticAction: "timing-only",
      blocking: false,
    });
  });

  it("classifies repeated crowd calls with nested lexical dialogue", () => {
    const cues = [
      cue("a", "そーりゃ!そーりゃ!", 10, 13),
      cue("b", "みちあけて", 11, 12),
    ];
    const result = classify({
      cues,
      spans: [
        { text: "そーりゃ!そーりゃ!", start: 10.1, end: 12.9 },
        { text: "みちあけて", start: 11.05, end: 11.95 },
      ],
    });
    expect(result).toMatchObject({
      finalRelationship: "crowd-call-plus-dialogue",
      safeAutomaticAction: "presentation-only",
      blocking: false,
    });
  });

  it("classifies a long background utterance plus nested foreground cue", () => {
    const cues = [cue("a", "ながいこえ", 10, 13), cue("b", "みじかい", 11, 12)];
    const result = classify({
      cues,
      spans: [
        { text: "ながいこえ", start: 10.1, end: 12.9 },
        { text: "みじかい", start: 11.05, end: 11.95 },
      ],
    });
    expect(result).toMatchObject({
      finalRelationship: "nested-background-speech",
      safeAutomaticAction: "presentation-only",
      blocking: false,
    });
  });

  it("classifies independently matched overlapping speech as simultaneous", () => {
    const cues = [cue("a", "みぎへ", 10, 12), cue("b", "ひだりへ", 10.5, 12.5)];
    const result = classify({
      cues,
      spans: [
        { text: "みぎへ", start: 10.1, end: 11.8 },
        { text: "ひだりへ", start: 10.6, end: 12.3 },
      ],
    });
    expect(result).toMatchObject({
      finalRelationship: "true-simultaneous-speech",
      safeAutomaticAction: "presentation-only",
      blocking: false,
    });
  });

  it("keeps a same-occurrence alternative for human selection", () => {
    const cues = [cue("a", "おなじ", 10, 12), cue("b", "おなじ", 10.1, 12.1)];
    const result = classify({
      cues,
      spans: [{ text: "おなじ", start: 10.1, end: 11.9 }],
      textSimilarity: 1,
    });
    expect(result).toMatchObject({
      finalRelationship: "same-utterance-alternative",
      recommendedAction: "select-alternative",
      blocking: true,
    });
  });

  it("leaves absent evidence unresolved even with human authority", () => {
    const cues = [cue("a", "まえ", 10, 12), cue("b", "つぎ", 11, 13)];
    const result = classifyOverlapAcousticComponent({
      plan: plan(cues),
      allCues: cues,
      sourceDecision: sourceDecision(cues),
      attempts: [],
      mode: "enforce",
      audioPath: "audio/overlap/component.wav",
      audioSha256: HASH,
      audioDurationSeconds: 5,
      audioFullyCoversComponent: true,
    });
    expect(result).toMatchObject({
      finalRelationship: "unresolved",
      blocking: true,
    });
  });

  it("does not let one profile automatically close a complex overlap", () => {
    const cues = [cue("a", "みぎ", 10, 12), cue("b", "ひだり", 10.5, 12.5)];
    const result = classifyOverlapAcousticComponent({
      plan: plan(cues),
      allCues: cues,
      sourceDecision: sourceDecision(cues),
      attempts: [
        attempt("no-vad", [
          { text: "みぎ", start: 10.1, end: 11.8 },
          { text: "ひだり", start: 10.6, end: 12.3 },
        ]),
      ],
      mode: "enforce",
      audioPath: "audio/overlap/component.wav",
      audioSha256: HASH,
      audioDurationSeconds: 5,
      audioFullyCoversComponent: true,
    });
    expect(result.blocking).toBe(true);
  });
});

describe("C5.15 atomic timing-only repair", () => {
  const twoCues = () => [
    cue("a", "まえ", 10, 11.4),
    cue("b", "つぎ", 11, 12.4),
  ];
  const orderedSpans = [
    { text: "まえ", start: 10.1, end: 10.9 },
    { text: "つぎ", start: 11.1, end: 12.2 },
  ];

  it("uses exact token boundaries without a midpoint", () => {
    const result = classify({ cues: twoCues(), spans: orderedSpans });
    expect(result.timingMutations).toMatchObject([
      {
        cueId: "a",
        afterEnd: 10.9,
        boundarySource: "token",
        textChanged: false,
      },
      {
        cueId: "b",
        afterStart: 11.1,
        boundarySource: "token",
        textChanged: false,
      },
    ]);
    expect(
      result.timingMutations.every(
        (item) => item.afterStart !== 11.05 && item.afterEnd !== 11.05,
      ),
    ).toBe(true);
  });

  it("records no-VAD segment boundaries as speech evidence", () => {
    const attempts = threeProfileAttempts(orderedSpans, "segment");
    const cues = twoCues();
    const result = classifyOverlapAcousticComponent({
      plan: plan(cues),
      allCues: cues,
      sourceDecision: sourceDecision(cues),
      attempts,
      mode: "enforce",
      audioPath: "audio/overlap/component.wav",
      audioSha256: HASH,
      audioDurationSeconds: 5,
      audioFullyCoversComponent: true,
    });
    expect(result.timingMutations.map((item) => item.boundarySource)).toEqual([
      "speech",
      "speech",
    ]);
  });

  it("records VAD-profile segment boundaries as VAD evidence", () => {
    const attempts = [
      attempt("current-sensitive-vad", orderedSpans, {
        source: "segment",
        requestId: "vad-a",
      }),
      attempt("extra-sensitive-vad", orderedSpans, {
        source: "segment",
        requestId: "vad-b",
      }),
    ];
    const cues = twoCues();
    const result = classifyOverlapAcousticComponent({
      plan: plan(cues),
      allCues: cues,
      sourceDecision: sourceDecision(cues),
      attempts,
      mode: "enforce",
      audioPath: "audio/overlap/component.wav",
      audioSha256: HASH,
      audioDurationSeconds: 5,
      audioFullyCoversComponent: true,
    });
    expect(result.timingMutations.map((item) => item.boundarySource)).toEqual([
      "vad",
      "vad",
    ]);
  });

  it("rejects a boundary adjustment beyond the configured limit", () => {
    const result = classify({
      cues: twoCues(),
      spans: [
        { text: "まえ", start: 10.1, end: 10.6 },
        { text: "つぎ", start: 11.2, end: 12.2 },
      ],
    });
    expect(result).toMatchObject({ blocking: true, timingMutations: [] });
    expect(result.reasons).toContain("component-atomic-rollback");
  });

  it("rejects a post-repair cue shorter than the configured minimum", () => {
    const result = classify({
      cues: twoCues(),
      spans: orderedSpans,
      configuration: { minimumPostRepairCueDurationSeconds: 1.2 },
    });
    expect(result).toMatchObject({ blocking: true, timingMutations: [] });
  });

  it("does not create overlap with an unrelated neighboring cue", () => {
    const componentCues = twoCues();
    const cues = [...componentCues, cue("neighbor", "あと", 12.5, 13.2)];
    const result = classifyOverlapAcousticComponent({
      plan: plan(componentCues),
      allCues: cues,
      sourceDecision: sourceDecision(componentCues),
      attempts: threeProfileAttempts(orderedSpans),
      mode: "enforce",
      audioPath: "audio/overlap/component.wav",
      audioSha256: HASH,
      audioDurationSeconds: 5,
      audioFullyCoversComponent: true,
    });
    expect(result.timingMutations).toHaveLength(2);
    const repaired = cues
      .map((item) => {
        const mutation = result.timingMutations.find(
          (value) => value.cueId === item.id,
        );
        return mutation === undefined
          ? item
          : { ...item, start: mutation.afterStart, end: mutation.afterEnd };
      })
      .toSorted((left, right) => left.start - right.start);
    expect(
      repaired.every((item, index) => {
        const previous = repaired[index - 1];
        return previous === undefined || item.start >= previous.end;
      }),
    ).toBe(true);
  });

  it("produces conflict-free mutations for a three-cue component", () => {
    const cues = [
      cue("a", "ひとつ", 10, 11.4),
      cue("b", "ふたつ", 11, 12.4),
      cue("c", "みっつ", 12, 13.4),
    ];
    const result = classify({
      cues,
      spans: [
        { text: "ひとつ", start: 10.1, end: 10.9 },
        { text: "ふたつ", start: 11.1, end: 11.9 },
        { text: "みっつ", start: 12.1, end: 13.2 },
      ],
    });
    expect(result.timingMutations.map((item) => item.cueId)).toEqual([
      "a",
      "b",
      "c",
    ]);
    const middle = result.timingMutations.find((item) => item.cueId === "b");
    expect(middle).toMatchObject({ afterStart: 11.1, afterEnd: 11.9 });
  });

  it("rolls back every mutation when one pair in a component is unsafe", () => {
    const cues = [
      cue("a", "ひとつ", 10, 11.4),
      cue("b", "ふたつ", 11, 12.4),
      cue("c", "みっつ", 12, 13.4),
    ];
    const result = classify({
      cues,
      spans: [
        { text: "ひとつ", start: 10.1, end: 10.9 },
        { text: "ふたつ", start: 11.1, end: 11.9 },
        { text: "みっつ", start: 12.7, end: 13.2 },
      ],
    });
    expect(result).toMatchObject({ blocking: true, timingMutations: [] });
    expect(result.reasons).toContain("component-atomic-rollback");
  });

  it("generates deterministic decisions and mutation IDs", () => {
    expect(classify({ cues: twoCues(), spans: orderedSpans })).toEqual(
      classify({ cues: twoCues(), spans: orderedSpans }),
    );
  });

  it("keeps observe mode blocking and applies no mutation", () => {
    const result = classify({
      cues: twoCues(),
      spans: orderedSpans,
      mode: "observe",
    });
    expect(result).toMatchObject({
      blocking: true,
      safeAutomaticAction: "none",
      timingMutations: [],
    });
  });
});
