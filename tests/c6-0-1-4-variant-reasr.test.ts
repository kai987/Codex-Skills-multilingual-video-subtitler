import { describe, expect, it } from "vitest";

import type { CtcAlignmentAttempt } from "@mvl/shared";
import {
  CTC_VITERBI_POLICY,
  assessCandidatePoolSufficiency,
  assessTargetedReasrStability,
  buildAcousticTextVariantVerification,
  buildC6014QualityComparison,
  buildTargetedEventReasrArtifact,
  buildTextReplacementContract,
  evaluateTextVariantOracle,
  planTargetedEventReasr,
  projectJapanesePronunciation,
  resolveTextVariants,
} from "@mvl/video-subtitler";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const GENERATED_AT = "2026-08-28T00:00:00.000Z";

function span(index: number, start: number, end: number) {
  return {
    targetIndex: index,
    tokenId: index + 1,
    token: index === 0 ? "は" : "い",
    startFrame: index * 10,
    endFrameExclusive: index * 10 + 8,
    startSecondsLocal: start,
    endSecondsLocal: end,
    startMediaGlobal: 10 + start,
    endMediaGlobal: 10 + end,
    meanPosterior: 0.9,
    meanLogPosterior: -0.1,
    minLogPosterior: -0.2,
    firstFrameIntervalLocal: { start, end: start + 0.02 },
    lastFrameIntervalLocal: { start: end - 0.02, end },
    representativeStartMediaGlobal: 10 + start,
    representativeEndMediaGlobal: 10 + end,
  };
}

function attempt(input: {
  id: string;
  cost: number;
  boundary?: { start: number; end: number } | null;
  tokenCount?: number;
  edge?: boolean;
}): CtcAlignmentAttempt {
  const boundary =
    input.boundary === undefined ? { start: 10.1, end: 11.9 } : input.boundary;
  const tokenCount = input.tokenCount ?? 2;
  const tokenSpans =
    boundary === null
      ? []
      : Array.from({ length: tokenCount }, (_value, index) =>
          span(index, 0.1 + index * 0.5, 0.5 + index * 0.5),
        );
  return {
    attemptId: input.id,
    cueId: input.id,
    componentId: "event-1",
    windowType: "narrow",
    audioSha256: HASH_A,
    audioSampleRate: 16_000,
    audioFrameCount: 32_000,
    audioDurationSeconds: 2,
    audioLocalInterval: { start: 0, end: 2 },
    mediaGlobalInterval: { start: 10, end: 12 },
    target: {
      targetText: "はい",
      targetTextSha256: HASH_A,
      tokenIds: Array.from(
        { length: tokenCount },
        (_value, index) => index + 1,
      ),
      tokenPieces: Array.from({ length: tokenCount }, (_value, index) =>
        String(index),
      ),
      unknownTokenCount: 0,
      specialTokenCount: 0,
      targetEncodable: true,
      blockers: [],
    },
    targetTokenCount: tokenCount,
    cacheHit: false,
    inferenceExecuted: true,
    modelLoadCount: 0,
    pathStatus: boundary === null ? "no-valid-path" : "success",
    pathExists: boundary !== null,
    predictedFrameCount: 99,
    logitsFrameCount: 99,
    expectedFrameCount: 99,
    frameCountVerified: true,
    tokenSpans,
    selectedBoundary: boundary,
    startPinnedToWindowEdge: input.edge ?? false,
    endPinnedToWindowEdge: input.edge ?? false,
    meanTokenPosterior: boundary === null ? null : 0.9,
    minimumTokenPosterior: boundary === null ? null : 0.8,
    alignedTokenMeanLogPosterior: boundary === null ? null : -input.cost,
    alignedTokenMinLogPosterior: boundary === null ? null : -input.cost - 0.1,
    pathScore: boundary === null ? null : -input.cost,
    normalizedPathLogScore: boundary === null ? null : -input.cost,
    blankFrameRatio: boundary === null ? null : 0.4,
    targetSpanDurationSeconds: boundary === null ? null : 1.8,
    targetSpanToWindowRatio: boundary === null ? null : 0.9,
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
      convKernel: [10, 3, 3, 3, 3, 2, 2],
      convStride: [5, 2, 2, 2, 2, 2, 2],
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
  };
}

function acousticVerification() {
  return buildAcousticTextVariantVerification({
    mode: "enforce",
    ctcRuntimeIdentityHash: HASH_A,
    ctcModelSnapshotHash: HASH_B,
    pronunciationRuntimeIdentityHash: HASH_C,
    workerStartCount: 1,
    generatedAt: GENERATED_AT,
    events: [
      {
        eventId: "event-1",
        audioEvidenceId: "audio-1",
        audioInterval: { start: 10, end: 12 },
        audioSha256: HASH_A,
        variants: [
          {
            variantId: "variant-a",
            displayText: "はい",
            projection: projectJapanesePronunciation({
              projectionId: "projection-a",
              displayText: "はい",
            }),
            attempts: [attempt({ id: "attempt-a", cost: 0.1 })],
          },
          {
            variantId: "variant-b",
            displayText: "いいえ",
            projection: projectJapanesePronunciation({
              projectionId: "projection-b",
              displayText: "いいえ",
            }),
            attempts: [attempt({ id: "attempt-b", cost: 0.5 })],
          },
        ],
      },
    ],
  });
}

describe("C6.0.1.4 pronunciation and acoustic hierarchy", () => {
  it("projects kana without mutating display text or using human memory", () => {
    const projection = projectJapanesePronunciation({
      projectionId: "kana",
      displayText: "カタカナ！",
    });
    expect(projection).toMatchObject({
      projectionText: "かたかな",
      method: "kana-literal",
      canonicalTextMutated: false,
      humanDerivedEntryCount: 0,
    });
  });

  it("uses a generic machine reading for kanji", () => {
    const projection = projectJapanesePronunciation({
      projectionId: "kanji",
      displayText: "水茄子",
      machineReading: "ミズナス",
    });
    expect(projection.projectionText).toBe("みずなす");
    expect(projection.method).toBe("sudachi-reading");
  });

  it("finds a unique pairwise acoustic winner without a magic score", () => {
    const verification = acousticVerification();
    expect(verification.events[0]?.selectedByAcousticEvidence).toBe(
      "variant-a",
    );
    expect(verification.summary.acousticDominanceCount).toBe(1);
  });

  it("does not let a short prefix win when it covers less speech", () => {
    const short = attempt({
      id: "short",
      cost: 0.01,
      boundary: { start: 10.1, end: 10.5 },
      tokenCount: 1,
    });
    const long = attempt({ id: "long", cost: 0.3, tokenCount: 4 });
    const verification = buildAcousticTextVariantVerification({
      mode: "observe",
      ctcRuntimeIdentityHash: HASH_A,
      ctcModelSnapshotHash: HASH_B,
      pronunciationRuntimeIdentityHash: HASH_C,
      workerStartCount: 1,
      generatedAt: GENERATED_AT,
      events: [
        {
          eventId: "event-prefix",
          audioEvidenceId: "audio-prefix",
          audioInterval: { start: 10, end: 12 },
          audioSha256: HASH_A,
          variants: [
            {
              variantId: "short",
              displayText: "父",
              projection: projectJapanesePronunciation({
                projectionId: "short-projection",
                displayText: "ちち",
              }),
              attempts: [short],
            },
            {
              variantId: "long",
              displayText: "父今日は早いな",
              projection: projectJapanesePronunciation({
                projectionId: "long-projection",
                displayText: "ちちきょうははやいな",
              }),
              attempts: [long],
            },
          ],
        },
      ],
    });
    expect(verification.events[0]?.selectedByAcousticEvidence).toBeNull();
    expect(
      verification.events[0]?.dominanceRelations.some((relation) =>
        relation.reasons.includes("short-prefix-bias-guard"),
      ),
    ).toBe(true);
  });
});

describe("C6.0.1.4 resolver, pool proxy, and targeted re-ASR", () => {
  it("selects a real existing acoustic winner and leaves ambiguity unresolved", () => {
    const verification = acousticVerification();
    const decisions = resolveTextVariants({
      mode: "enforce",
      generatedAt: GENERATED_AT,
      acousticVerification: verification,
      events: [
        {
          eventId: "event-1",
          currentSelectedVariantId: "variant-b",
          variants: ["variant-a", "variant-b"].map((variantId) => ({
            variantId,
            hardRejectReasons: [],
            independentSupportCount: 1,
            trustedTokenSupportCount: 0,
            trustedTokenConflict: false,
            decoderEvidence: "machine-decoder",
            edgeTruncationRisk: false,
            linguisticTieBreakRank: null,
            orthographicReadingGroup: null,
          })),
        },
      ],
    });
    expect(decisions.decisions[0]).toMatchObject({
      selectedVariant: "variant-a",
      decisionStatus: "SELECT_EXISTING_VARIANT",
      forcedWinner: false,
      magicWeightedScoreUsed: false,
    });
  });

  it("triggers at most three prompt-isolated source-global windows", () => {
    const verification = acousticVerification();
    const decisions = resolveTextVariants({
      mode: "enforce",
      generatedAt: GENERATED_AT,
      acousticVerification: {
        ...verification,
        events: verification.events.map((event) => ({
          ...event,
          selectedByAcousticEvidence: null,
        })),
      },
      events: [
        {
          eventId: "event-1",
          currentSelectedVariantId: "variant-a",
          variants: ["variant-a", "variant-b"].map((variantId) => ({
            variantId,
            hardRejectReasons: [],
            independentSupportCount: 1,
            trustedTokenSupportCount: 0,
            trustedTokenConflict: false,
            decoderEvidence: "machine-decoder",
            edgeTruncationRisk: false,
            linguisticTieBreakRank: null,
            orthographicReadingGroup: null,
          })),
        },
      ],
    });
    const pool = assessCandidatePoolSufficiency({
      generatedAt: GENERATED_AT,
      acousticVerification: {
        ...verification,
        events: verification.events.map((event) => ({
          ...event,
          selectedByAcousticEvidence: null,
        })),
      },
      decisions,
      events: [
        {
          eventId: "event-1",
          candidateCount: 2,
          independentWindowDisagreement: true,
          trustedTokenConflict: false,
          fullSpeechSpanCovered: true,
        },
      ],
    });
    const plan = planTargetedEventReasr({
      events: [{ eventId: "event-1", interval: { start: 10, end: 12 } }],
      decisions,
      poolSufficiency: pool,
      sourceSampleRate: 16_000,
      sourceTotalSamples: 320_000,
    });
    expect(plan.events[0]?.requests).toHaveLength(3);
    expect(plan.events[0]?.requests.map((request) => request.prompt)).toEqual([
      null,
      null,
      null,
    ]);
    expect(plan.events[0]?.requests[0]?.sourceGlobalSampleInterval).toEqual({
      startSample: 160_000,
      endSample: 192_000,
    });
  });

  it("records stable real machine candidates and complete lineage", () => {
    expect(
      assessTargetedReasrStability(["おはよう", "おはよう", "おはよう!"]),
    ).toBe("STRONG");
    const planRequest = {
      requestId: "family:01",
      eventId: "event-1",
      requestFamily: "family",
      windowType: "exact" as const,
      sourceGlobalSampleInterval: { startSample: 160_000, endSample: 192_000 },
      sourceGlobalInterval: { start: 10, end: 12 },
      prompt: null,
    };
    const artifact = buildTargetedEventReasrArtifact({
      mode: "enforce",
      generatedAt: GENERATED_AT,
      eligibleEventCount: 1,
      budgetExhaustedCount: 0,
      plannedEvents: [
        {
          eventId: "event-1",
          triggerReasons: ["ambiguous"],
          globalAudioInterval: { start: 10, end: 12 },
          requestFamily: "family",
          requests: [planRequest],
        },
      ],
      executedRequests: [
        {
          plan: planRequest,
          extractedAudioSha256: HASH_A,
          extractedSampleRate: 16_000,
          extractedSampleCount: 32_000,
          cacheIdentity: HASH_B,
          cacheHit: false,
          inferenceExecuted: true,
          modelLoadCount: 1,
          workerStartCount: 1,
          responseText: "おはよう",
          responseInterval: { start: 10.1, end: 11.8 },
          tokenEvidenceIds: ["token-1"],
          decoderEvidenceHash: HASH_C,
        },
      ],
    });
    expect(artifact.events[0]?.candidateOutputs[0]).toMatchObject({
      text: "おはよう",
      lineageComplete: true,
    });
    expect(artifact.summary.runtimeGoldInputCount).toBe(0);
  });
});

describe("C6.0.1.4 evaluation and non-degradation contracts", () => {
  it("rejects Oracle access before the machine freeze", () => {
    expect(() =>
      evaluateTextVariantOracle({
        freezeVerifiedBeforeGold: false,
        machineFreezeHash: HASH_A,
        goldIdentityHash: HASH_B,
        events: [],
      }),
    ).toThrow(/freeze/u);
  });

  it("classifies selector error without including Gold text", () => {
    const oracle = evaluateTextVariantOracle({
      freezeVerifiedBeforeGold: true,
      machineFreezeHash: HASH_A,
      goldIdentityHash: HASH_B,
      generatedAt: GENERATED_AT,
      events: [
        {
          eventId: "event-1",
          selectedCandidateId: "bad",
          variants: [
            { candidateId: "bad", text: "おはよ" },
            { candidateId: "good", text: "おはよう" },
          ],
          matchedGoldCues: [{ cueId: "gold-1", text: "おはよう" }],
          associationAmbiguous: false,
        },
      ],
    });
    expect(oracle.eventEntries[0]).toMatchObject({
      oracleCandidateId: "good",
      oracleClass: "SELECTOR_ERROR",
      goldTextIncluded: false,
    });
  });

  it("accepts only a strictly stronger real-machine replacement", () => {
    const contract = buildTextReplacementContract({
      proposals: [
        {
          fromCandidateId: "old",
          fromText: "おはよ",
          toCandidateId: "new",
          toText: "おはよう",
          eventId: "event-1",
          evidenceTierBefore: "WEAK",
          evidenceTierAfter: "STRONG",
          acousticComparison: "DOMINATES",
          tokenComparison: "MORE_SUPPORT",
          independentSupportBefore: 1,
          independentSupportAfter: 2,
          toCandidateIsRealMachineCandidate: true,
          timingProposalId: null,
          timingNonDegradationPassed: true,
        },
      ],
      beforeTextHash: HASH_A,
      afterTextHash: HASH_B,
      beforeTimingHash: HASH_A,
      afterTimingHash: HASH_A,
      presentationHash: HASH_C,
      canonicalTextMutationCount: 1,
      canonicalTimingMutationCount: 0,
      presentationMutationCount: 0,
      generatedAt: GENERATED_AT,
    });
    expect(contract.records[0]?.accepted).toBe(true);
    expect(contract.summary.freeRewriteCount).toBe(0);
  });

  it("fails quality closed when only runtime safety passes", () => {
    const baseline = {
      cueCount: 161,
      exactCer: 0.66,
      normalizedCer: 0.6015625,
      goldCoverage: 0.96484375,
      missingCount: 6,
      hallucinationCount: 1,
      materialErrorCount: 76,
      severeTimingErrorCount: 53,
      startMaeSeconds: 1.63,
      endMaeSeconds: 1.65,
      p95BoundaryErrorSeconds: 6.44,
      medianTemporalIou: 0.58,
      overlapPairCount: 48,
      trustedMappedTokenCount: 235,
      ambiguousTimeBaseTokenCount: 373,
    };
    const comparison = buildC6014QualityComparison({
      rawAsr: baseline,
      baseline,
      candidate: baseline,
      selectorRecoveryPassed: false,
      candidatePoolRecoveryPassed: false,
      vadTimebaseRecoveryPassed: false,
      tokenTimelineRecoveryPassed: false,
      reproducible: true,
      generatedAt: GENERATED_AT,
    });
    expect(comparison.outcome).toBe("HOLD_FOR_MORE_ACOUSTIC_TEXT_RECOVERY");
    expect(comparison.coverageGuardPassed).toBe(true);
    expect(comparison.precisionRecoveryPassed).toBe(false);
  });
});
