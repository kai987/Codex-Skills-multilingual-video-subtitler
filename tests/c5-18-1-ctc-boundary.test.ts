import { describe, expect, it } from "vitest";

import {
  ctcAlignmentCacheIdentitySchema,
  ctcTargetEncodingSchema,
  type CtcAlignmentAttempt,
  type SubtitleCue,
} from "@mvl/shared";
import {
  CTC_ALIGNMENT_POLICY,
  CTC_FRAME_MAPPING_POLICY,
  CTC_VITERBI_POLICY,
  SEPARATED_STREAM_LABELS,
  applyCtcTimingMutations,
  assessCtcWindowStability,
  assessSeparatedStreams,
  assignCtcComponentJointly,
  buildCtcAlignmentCacheKey,
  buildWav2Vec2FrameMapping,
  collapseCtcGreedyTokens,
  ctcViterbiAlign,
  normalizeCtcAlignmentText,
  selectSourceSeparationTriggers,
  sha256Value,
  wav2Vec2OutputFrameCount,
} from "@mvl/video-subtitler";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const REVISION = "1".repeat(40);
const KERNEL = [10, 3, 3, 3, 3, 2, 2];
const STRIDE = [5, 2, 2, 2, 2, 2, 2];

function attempt(
  cueId: string,
  interval: { start: number; end: number } | null,
  overrides: Partial<CtcAlignmentAttempt> = {},
): CtcAlignmentAttempt {
  return {
    attemptId: `attempt-${cueId}`,
    cueId,
    componentId: "component-a",
    windowType: "narrow",
    audioSha256: HASH_A,
    audioSampleRate: 16_000,
    audioFrameCount: 16_000,
    audioDurationSeconds: 1,
    audioLocalInterval: { start: 0, end: 1 },
    mediaGlobalInterval: { start: 10, end: 11 },
    target: {
      targetText: "はい",
      targetTextSha256: HASH_A,
      tokenIds: [1, 2],
      tokenPieces: ["は", "い"],
      unknownTokenCount: 0,
      specialTokenCount: 0,
      targetEncodable: true,
      blockers: [],
    },
    targetTokenCount: 2,
    cacheHit: false,
    inferenceExecuted: true,
    modelLoadCount: 0,
    pathStatus: interval === null ? "no-valid-path" : "success",
    pathExists: interval !== null,
    predictedFrameCount: 49,
    logitsFrameCount: 49,
    expectedFrameCount: 49,
    frameCountVerified: true,
    tokenSpans: [],
    selectedBoundary: interval,
    startPinnedToWindowEdge: false,
    endPinnedToWindowEdge: false,
    meanTokenPosterior: 0.8,
    minimumTokenPosterior: 0.7,
    alignedTokenMeanLogPosterior: -0.2,
    alignedTokenMinLogPosterior: -0.4,
    pathScore: -0.2,
    normalizedPathLogScore: -0.2,
    blankFrameRatio: 0.5,
    targetSpanDurationSeconds: interval === null ? null : 0.5,
    targetSpanToWindowRatio: interval === null ? null : 0.5,
    scoreCalibrationStatus: "uncalibrated-ctc-score",
    greedyText: "はい",
    greedyTextMatchesTarget: true,
    greedyNormalizedSimilarity: 1,
    greedyEditRatio: 0,
    greedyDiagnosticOnly: true,
    workerRequestVerified: true,
    viterbiPolicy: CTC_VITERBI_POLICY,
    frameMapping: {
      sampleRate: 16_000,
      convKernel: KERNEL,
      convStride: STRIDE,
      totalStrideSamples: 320,
      receptiveFieldSamples: 400,
      frameCountFormula: "iterated-valid-convolution-v1",
      frameIntervalPolicy: "receptive-field-clipped-v1",
    },
    deviceRequested: "cpu",
    deviceUsed: "cpu",
    wallClockSeconds: 0.01,
    warnings: [],
    blockers: [],
    ...overrides,
  };
}

function timingMutation(cue: SubtitleCue, componentId = "component-a") {
  return {
    componentId,
    cueId: cue.id,
    oldStart: cue.start,
    oldEnd: cue.end,
    newStart: cue.start + 0.1,
    newEnd: cue.end + 0.1,
    startEvidenceIds: ["ctc-start", "mfa-start"],
    endEvidenceIds: ["ctc-end", "mfa-end"],
    ctcEvidenceIds: ["ctc-start", "ctc-end"],
    independentLexicalEvidenceIds: ["mfa-start", "mfa-end"],
    speakerEvidenceIds: ["speaker-component"],
    deltaStart: 0.1,
    deltaEnd: 0.1,
    atomicComponentDecisionId: "ctc-component-decision",
    textChanged: false as const,
  };
}

describe("C5.18.1 timing-only materialization", () => {
  const cues: SubtitleCue[] = [
    {
      id: "cue-a",
      text: "おはよう",
      start: 1,
      end: 2,
      language: "ja",
      languages: ["ja"],
      speaker: null,
      confidence: 1,
    },
    {
      id: "cue-b",
      text: "ございます",
      start: 2.1,
      end: 3.2,
      language: "ja",
      languages: ["ja"],
      speaker: null,
      confidence: 1,
    },
  ];
  const requiredCue = (index: number): SubtitleCue => {
    const cue = cues[index];
    if (cue === undefined)
      throw new Error(`Missing fixture cue ${String(index)}.`);
    return cue;
  };

  it("applies an authorized component atomically without changing text", () => {
    const mutations = cues.map((cue) => timingMutation(cue));
    const output = applyCtcTimingMutations({
      cues,
      evidence: {
        mutations,
        components: [
          {
            componentId: "component-a",
            cueIds: cues.map((cue) => cue.id),
            timingMutationApplied: true,
            mutations,
          },
        ],
      },
    });
    expect(output.map((cue) => cue.text)).toEqual(cues.map((cue) => cue.text));
    expect(output[0]?.start).toBeCloseTo(1.1);
    expect(output[0]?.end).toBeCloseTo(2.1);
    expect(output[1]?.start).toBeCloseTo(2.2);
    expect(output[1]?.end).toBeCloseTo(3.3);
  });

  it("rejects a partially materialized component", () => {
    const mutation = timingMutation(requiredCue(0));
    expect(() =>
      applyCtcTimingMutations({
        cues,
        evidence: {
          mutations: [mutation],
          components: [
            {
              componentId: "component-a",
              cueIds: cues.map((cue) => cue.id),
              timingMutationApplied: true,
              mutations: [mutation],
            },
          ],
        },
      }),
    ).toThrow(/not atomic/u);
  });

  it("rejects a mutation whose serialized prior does not match the cue", () => {
    const mutation = { ...timingMutation(requiredCue(0)), oldStart: 0 };
    expect(() =>
      applyCtcTimingMutations({
        cues,
        evidence: {
          mutations: [mutation],
          components: [
            {
              componentId: "component-a",
              cueIds: [requiredCue(0).id],
              timingMutationApplied: true,
              mutations: [mutation],
            },
          ],
        },
      }),
    ).toThrow(/prior mismatch/u);
  });
});

describe("C5.18.1 deterministic float64 CTC Viterbi", () => {
  it("aligns one token through blank transitions", () => {
    const result = ctcViterbiAlign({
      logProbabilities: [
        [-0.1, -2, -3],
        [-2, -0.1, -3],
        [-0.1, -2, -3],
      ],
      targetTokenIds: [1],
      blankTokenId: 0,
    });
    expect(result.status).toBe("success");
  });

  it("aligns two Japanese-character tokens", () => {
    const result = ctcViterbiAlign({
      logProbabilities: [
        [-2, -0.1, -4],
        [-0.1, -2, -4],
        [-2, -4, -0.1],
      ],
      targetTokenIds: [1, 2],
      blankTokenId: 0,
    });
    expect(result.status).toBe("success");
  });

  it("requires a blank between repeated tokens", () => {
    const result = ctcViterbiAlign({
      logProbabilities: [
        [-2, -0.1],
        [-0.1, -2],
        [-2, -0.1],
      ],
      targetTokenIds: [1, 1],
      blankTokenId: 0,
    });
    expect(result.status).toBe("success");
  });

  it("fails when repeated tokens have too few frames", () => {
    expect(
      ctcViterbiAlign({
        logProbabilities: [
          [-2, -0.1],
          [-2, -0.1],
        ],
        targetTokenIds: [1, 1],
        blankTokenId: 0,
      }).status,
    ).toBe("no-valid-path");
  });

  it.each([
    [[], "invalid-logits"],
    [[[Number.NaN, 0]], "invalid-logits"],
    [[[Number.POSITIVE_INFINITY, 0]], "invalid-logits"],
  ] as const)("fails closed for invalid logits %#", (matrix, status) => {
    expect(
      ctcViterbiAlign({
        logProbabilities: matrix,
        targetTokenIds: [1],
        blankTokenId: 0,
      }).status,
    ).toBe(status);
  });

  it("backtracks deterministically on ties", () => {
    const input = {
      logProbabilities: Array.from({ length: 5 }, () => [-1, -1, -1]),
      targetTokenIds: [1, 2],
      blankTokenId: 0,
    };
    expect(ctcViterbiAlign(input)).toEqual(ctcViterbiAlign(input));
  });

  it("collapses repeats while retaining blank-separated repetition", () => {
    expect(collapseCtcGreedyTokens([0, 1, 1, 0, 1, 2, 2, 0], 0)).toEqual([
      1, 1, 2,
    ]);
  });

  it("uses the repository Viterbi policy and no torchaudio policy", () => {
    expect(CTC_VITERBI_POLICY).toBe("mvl-ctc-viterbi-v1");
    expect(CTC_VITERBI_POLICY).not.toMatch(/torchaudio/u);
  });
});

describe("C5.18.1 Wav2Vec2 convolution frame mapping", () => {
  it("computes the exact output frame count", () => {
    expect(wav2Vec2OutputFrameCount(16_000, KERNEL, STRIDE)).toBe(49);
  });

  it("computes 320-sample stride and 400-sample receptive field", () => {
    const mapping = buildWav2Vec2FrameMapping({
      inputSamples: 16_000,
      convKernel: KERNEL,
      convStride: STRIDE,
    });
    expect(mapping).toMatchObject({
      totalStrideSamples: 320,
      receptiveFieldSamples: 400,
      expectedFrameCount: 49,
    });
  });

  it("maps the first frame from sample zero", () => {
    const mapping = buildWav2Vec2FrameMapping({
      inputSamples: 16_000,
      convKernel: KERNEL,
      convStride: STRIDE,
    });
    expect(mapping.intervals[0]).toEqual({
      startSeconds: 0,
      endSeconds: 0.025,
    });
  });

  it("maps the last receptive interval without ratio interpolation", () => {
    const mapping = buildWav2Vec2FrameMapping({
      inputSamples: 16_000,
      convKernel: KERNEL,
      convStride: STRIDE,
    });
    expect(mapping.intervals.at(-1)?.startSeconds).toBe(0.96);
    expect(mapping.frameIntervalPolicy).toBe("receptive-field-clipped-v1");
  });

  it("clips the final receptive interval to short audio", () => {
    const mapping = buildWav2Vec2FrameMapping({
      inputSamples: 800,
      convKernel: KERNEL,
      convStride: STRIDE,
    });
    expect(mapping.intervals.at(-1)?.endSeconds).toBeLessThanOrEqual(0.05);
  });

  it("fails closed when predicted and expected frame counts differ", () => {
    expect(() =>
      buildWav2Vec2FrameMapping({
        inputSamples: 16_000,
        convKernel: KERNEL,
        convStride: STRIDE,
        predictedFrameCount: 50,
      }),
    ).toThrow(/frame count mismatch/iu);
  });

  it.each([0, -1, 1.2])("rejects invalid sample counts %s", (samples) => {
    expect(() => wav2Vec2OutputFrameCount(samples, KERNEL, STRIDE)).toThrow();
  });

  it("declares the exact frame-mapping policy", () => {
    expect(CTC_FRAME_MAPPING_POLICY).toBe("wav2vec2-conv-receptive-field-v1");
  });
});

describe("C5.18.1 alignment target normalization", () => {
  it.each([
    ["あきまへんって。", "あきまへんって"],
    ["糸子 おはよう", "糸子おはよう"],
    ["アホか！\n調子乗んな！", "アホか調子乗んな"],
    ["１２３ A", "１２３A"],
    ["カーネーション♪", "カーネーション"],
  ])("normalizes %j without lexical substitution", (input, expected) => {
    const result = normalizeCtcAlignmentText(input);
    expect(result.text).toBe(expected);
    expect(result.lexicalCharacterDeletionCount).toBe(0);
  });

  it("records display-newline removal", () => {
    const result = normalizeCtcAlignmentText("はい\nいいえ");
    expect(result.operations).toContainEqual({
      operation: "remove-display-newline",
      count: 1,
    });
  });

  it("records punctuation-only removal", () => {
    const result = normalizeCtcAlignmentText("はい!?...");
    expect(
      result.operations.find(
        (operation) => operation.operation === "remove-nonspoken-punctuation",
      )?.count,
    ).toBeGreaterThan(0);
  });

  it("keeps Han, Hiragana, Katakana, Latin, and digits", () => {
    expect(normalizeCtcAlignmentText("漢あアA1").text).toBe("漢あアA1");
  });

  it("models an unknown token as a fail-closed target", () => {
    const encoding = ctcTargetEncodingSchema.parse({
      targetText: "未知",
      targetTextSha256: HASH_A,
      tokenIds: [3],
      tokenPieces: ["<unk>"],
      unknownTokenCount: 1,
      specialTokenCount: 0,
      targetEncodable: false,
      blockers: ["CTC_TARGET_UNREPRESENTABLE"],
    });
    expect(encoding.targetEncodable).toBe(false);
  });

  it("hashes a normalized target deterministically", () => {
    const target = normalizeCtcAlignmentText("お は よ う").text;
    expect(sha256Value(target)).toBe(sha256Value(target));
  });
});

describe("C5.18.1 dual-window stability", () => {
  it.each([
    [0, 0, true, true],
    [0.12, 0.12, true, true],
    [0.121, 0.01, false, true],
    [0.01, 0.121, true, false],
  ])(
    "evaluates start/end independently %#",
    (startDelta, endDelta, startStable, endStable) => {
      const result = assessCtcWindowStability({
        narrow: { start: 10, end: 12 },
        expanded: { start: 10 + startDelta, end: 12 + endDelta },
      });
      expect(result.startStable).toBe(startStable);
      expect(result.endStable).toBe(endStable);
    },
  );

  it.each([
    [true, false],
    [false, true],
    [true, true],
  ])("blocks edge pinning %#", (narrowPinned, expandedPinned) => {
    const result = assessCtcWindowStability({
      narrow: { start: 10, end: 12 },
      expanded: { start: 10, end: 12 },
      narrowEdgePinned: narrowPinned,
      expandedEdgePinned: expandedPinned,
    });
    expect(result.stable).toBe(false);
  });

  it("fails closed when either window has no path", () => {
    expect(
      assessCtcWindowStability({
        narrow: null,
        expanded: { start: 10, end: 12 },
      }).stable,
    ).toBe(false);
  });
});

describe("C5.18.1 component joint assignment", () => {
  it("resolves clear monotonic two-cue ordering", () => {
    const result = assignCtcComponentJointly({
      componentId: "component-a",
      cues: [
        {
          cueId: "cue-a",
          targetText: "おはよう",
          originalInterval: { start: 10, end: 11 },
          selectedAttempt: attempt("cue-a", { start: 10, end: 11 }),
        },
        {
          cueId: "cue-b",
          targetText: "はい",
          originalInterval: { start: 11, end: 12 },
          selectedAttempt: attempt("cue-b", { start: 11, end: 12 }),
        },
      ],
    });
    expect(result.resolved).toBe(true);
    expect(result.candidatePermutationCount).toBe(2);
  });

  it.each([
    [
      "missing",
      null,
      { start: 11, end: 12 },
      "CTC_JOINT_ASSIGNMENT_CANDIDATE_MISSING",
    ],
    [
      "non-monotonic",
      { start: 12, end: 13 },
      { start: 11, end: 12 },
      "CTC_JOINT_ASSIGNMENT_NON_MONOTONIC",
    ],
    [
      "duplicate",
      { start: 10, end: 12 },
      { start: 10.1, end: 12.1 },
      "CTC_DUPLICATE_OCCURRENCE_CONFLICT",
    ],
  ] as const)("blocks %s assignment", (_label, left, right, blocker) => {
    const result = assignCtcComponentJointly({
      componentId: "component-a",
      cues: [
        {
          cueId: "cue-a",
          targetText: "おはよう",
          originalInterval: { start: 10, end: 11 },
          selectedAttempt: attempt("cue-a", left),
        },
        {
          cueId: "cue-b",
          targetText: _label === "duplicate" ? "おはよう" : "はい",
          originalInterval: { start: 11, end: 12 },
          selectedAttempt: attempt("cue-b", right),
        },
      ],
    });
    expect(result.blockers).toContain(blocker);
  });

  it("handles three cues with six candidate permutations", () => {
    const result = assignCtcComponentJointly({
      componentId: "component-three",
      cues: [0, 1, 2].map((index) => ({
        cueId: `cue-${String(index)}`,
        targetText: `文${String(index)}`,
        originalInterval: { start: index, end: index + 1 },
        selectedAttempt: attempt(`cue-${String(index)}`, {
          start: index,
          end: index + 1,
        }),
      })),
    });
    expect(result.candidatePermutationCount).toBe(6);
  });

  it("is independent of input permutation", () => {
    const cues = [
      {
        cueId: "cue-a",
        targetText: "あ",
        originalInterval: { start: 1, end: 2 },
        selectedAttempt: attempt("cue-a", { start: 1, end: 2 }),
      },
      {
        cueId: "cue-b",
        targetText: "い",
        originalInterval: { start: 2, end: 3 },
        selectedAttempt: attempt("cue-b", { start: 2, end: 3 }),
      },
    ];
    expect(
      assignCtcComponentJointly({ componentId: "x", cues }).semanticHash,
    ).toBe(
      assignCtcComponentJointly({
        componentId: "x",
        cues: cues.toReversed(),
      }).semanticHash,
    );
  });
});

describe("C5.18.1 source-separation observe safety", () => {
  it("selects only unresolved multi-track or overlap candidates", () => {
    const result = selectSourceSeparationTriggers([
      {
        componentId: "a",
        resolutionStatus: "resolved",
        speakerTrackCount: 2,
        overlapSpeechIntervalCount: 1,
      },
      {
        componentId: "b",
        resolutionStatus: "unresolved",
        speakerTrackCount: 1,
        overlapSpeechIntervalCount: 0,
      },
      {
        componentId: "c",
        resolutionStatus: "unresolved",
        speakerTrackCount: 2,
        overlapSpeechIntervalCount: 0,
      },
    ]);
    expect(result.map((item) => item.componentId)).toEqual(["c"]);
  });

  it("enforces the hard maximum of four", () => {
    const result = selectSourceSeparationTriggers(
      Array.from({ length: 7 }, (_, index) => ({
        componentId: `c-${String(index)}`,
        resolutionStatus: "unresolved" as const,
        speakerTrackCount: 2,
        overlapSpeechIntervalCount: 1,
      })),
    );
    expect(result).toHaveLength(4);
  });

  it.each([
    ["zero A", [0, 0, 0], [0.2, -0.2, 0.1], "SEPARATION_STREAM_A_ZERO"],
    ["zero B", [0.2, -0.2, 0.1], [0, 0, 0], "SEPARATION_STREAM_B_ZERO"],
    [
      "identical",
      [0.2, -0.2, 0.1],
      [0.2, -0.2, 0.1],
      "SEPARATION_STREAMS_HIGHLY_CORRELATED",
    ],
  ] as const)("rejects %s stream output", (_label, a, b, blocker) => {
    const quality = assessSeparatedStreams({
      mixture: [0.2, -0.2, 0.1],
      streamA: a,
      streamB: b,
    });
    expect(quality.blockers).toContain(blocker);
    expect(quality.timingActionable).toBe(false);
  });

  it("rejects length mismatch", () => {
    expect(
      assessSeparatedStreams({ mixture: [1, 2], streamA: [1], streamB: [0] })
        .blockers,
    ).toContain("SEPARATION_LENGTH_MISMATCH");
  });

  it("rejects non-finite separated samples", () => {
    expect(
      assessSeparatedStreams({
        mixture: [0.1],
        streamA: [Number.NaN],
        streamB: [0.1],
      }).blockers,
    ).toContain("SEPARATION_NONFINITE_SAMPLE");
  });

  it("uses candidate-stream labels and never speaker labels", () => {
    expect(SEPARATED_STREAM_LABELS).toEqual([
      "Candidate Stream A",
      "Candidate Stream B",
    ]);
    expect(SEPARATED_STREAM_LABELS.join(" ")).not.toMatch(/Speaker/u);
  });
});

describe("C5.18.1 portable exact cache identity", () => {
  function identity() {
    return ctcAlignmentCacheIdentitySchema.parse({
      requestType: "local-ctc-boundary-alignment",
      audioSha256: HASH_A,
      audioFrameInterval: { startFrame: 0, endFrameExclusive: 16_000 },
      targetTextSha256: HASH_A,
      targetTokenIdsSha256: HASH_B,
      windowType: "narrow",
      audioLocalInterval: { start: 0, end: 1 },
      mediaGlobalInterval: { start: 10, end: 11 },
      sampleRate: 16_000,
      runtimeIdentityHash: HASH_A,
      modelRepo: "reazon-research/japanese-wav2vec2-large-rs35kh",
      modelRevision: REVISION,
      modelSnapshotHash: HASH_B,
      tokenizerIdentityHash: HASH_A,
      device: "cpu",
      alignmentPolicyVersion: CTC_ALIGNMENT_POLICY,
      normalizationPolicyVersion: "c5.18.1-ctc-target-normalization-v1",
      viterbiPolicy: CTC_VITERBI_POLICY,
      frameMappingPolicy: CTC_FRAME_MAPPING_POLICY,
    });
  }

  it("is deterministic", () => {
    expect(buildCtcAlignmentCacheKey(identity())).toBe(
      buildCtcAlignmentCacheKey(identity()),
    );
  });

  it("keeps cue identity outside the portable acoustic cache key", () => {
    const first = identity();
    const second = identity();
    expect(buildCtcAlignmentCacheKey(first)).toBe(
      buildCtcAlignmentCacheKey(second),
    );
  });

  it.each([
    ["audioSha256", HASH_B],
    ["targetTextSha256", HASH_B],
    ["windowType", "expanded"],
    ["modelSnapshotHash", HASH_A],
    ["runtimeIdentityHash", HASH_B],
    ["device", "mps"],
  ] as const)("misses when %s changes", (field, value) => {
    const base = identity();
    const changed = { ...base, [field]: value } as typeof base;
    expect(buildCtcAlignmentCacheKey(changed)).not.toBe(
      buildCtcAlignmentCacheKey(base),
    );
  });

  it("has no task path, output path, or generatedAt identity field", () => {
    const keys = Object.keys(identity());
    expect(keys).not.toContain("taskPath");
    expect(keys).not.toContain("outputPath");
    expect(keys).not.toContain("generatedAt");
  });
});
