import type {
  MachineCoreCandidateOracleEvaluation,
  MachineLocalizedCandidateComparability,
  MachineWhisperCoreStabilityEvaluation,
} from "@mvl/shared";
import {
  buildC6018RouteDecision,
  buildGoldLocalCoreEvaluation,
  buildMachineCoreAcousticSpan,
  buildMachineCoreCandidateOracleEvaluation,
  buildMachineCoreTextProjection,
  buildMachineLocalizedCandidateComparability,
  groupProjectableTokens,
} from "@mvl/video-subtitler";
import { describe, expect, it } from "vitest";

const GENERATED_AT = "2026-08-29T00:00:00.000Z";
const SOURCE_HASH = "a".repeat(64);

function coreSpans() {
  return buildMachineCoreAcousticSpan({
    mode: "observe",
    sourceMediaSha256: SOURCE_HASH,
    sourceDurationSeconds: 30,
    sourceReadOnlyVerified: true,
    selectionSemanticHash: "b".repeat(64),
    selectedEventIds: new Set(["event-1"]),
    events: [
      {
        eventId: "event-1",
        acousticInterval: { start: 10, end: 12 },
        trustedTokenSpan: { start: 10.2, end: 11.8 },
        eventType: "SINGLE_UTTERANCE",
        semanticHash: "c".repeat(64),
      },
    ],
    vadSegments: [
      {
        interval: { start: 10.1, end: 11.9 },
        evidenceId: "vad:evidence",
      },
    ],
    freshTokens: [],
    generatedAt: GENERATED_AT,
  });
}

describe("C6.0.1.8 acoustic Core Span and grouped-token projection", () => {
  it("prefers trusted token timing and never consults Gold", () => {
    const artifact = coreSpans();
    expect(artifact.events[0]).toMatchObject({
      proposedCoreStart: 10.2,
      proposedCoreEnd: 11.8,
      goldUsed: false,
    });
    expect(artifact.summary.runtimeGoldInputCount).toBe(0);
  });

  it("uses a bounded near-exact Fresh token envelope for a tiny machine event", () => {
    const artifact = buildMachineCoreAcousticSpan({
      mode: "observe",
      sourceMediaSha256: SOURCE_HASH,
      sourceDurationSeconds: 30,
      sourceReadOnlyVerified: true,
      selectionSemanticHash: "b".repeat(64),
      selectedEventIds: new Set(["event-tiny"]),
      events: [
        {
          eventId: "event-tiny",
          acousticInterval: { start: 10, end: 10.1 },
          trustedTokenSpan: null,
          eventType: "SINGLE_UTTERANCE",
          semanticHash: "c".repeat(64),
        },
      ],
      vadSegments: [],
      freshTokens: [
        {
          eventId: "event-tiny",
          requestId: "fresh-a",
          windowType: "near-exact",
          tokenId: "token-1",
          interval: { start: 9.98, end: 10.3 },
          mappingVerified: true,
          lexical: true,
        },
      ],
      generatedAt: GENERATED_AT,
    });
    expect(artifact.events[0]).toMatchObject({
      proposedCoreStart: 9.98,
      proposedCoreEnd: 10.3,
    });
    expect(artifact.events[0]?.ambiguityReasons).toContain(
      "FRESH_TOKEN_FALLBACK_USED",
    );
  });

  it("preserves grouped-word child token IDs and their individual intervals", () => {
    const groups = groupProjectableTokens([
      {
        tokenId: "child-1",
        text: "東",
        interval: { start: 1, end: 1.2 },
        mappingVerified: true,
        lexical: true,
        probability: 0.9,
        groupId: "word-1",
      },
      {
        tokenId: "child-2",
        text: "京",
        interval: { start: 1.2, end: 1.5 },
        mappingVerified: true,
        lexical: true,
        probability: 0.8,
        groupId: "word-1",
      },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      text: "東京",
      childTokenIds: ["child-1", "child-2"],
      childIntervals: [
        { start: 1, end: 1.2 },
        { start: 1.2, end: 1.5 },
      ],
      mappingStatus: "VERIFIED_CHILDREN",
    });
  });
});

describe("C6.0.1.8 localized comparability and Gold-isolated oracle", () => {
  it("compares only texts projected onto the same Core Span", () => {
    const spans = coreSpans();
    const projection = buildMachineCoreTextProjection({
      mode: "observe",
      coreSpans: spans,
      generatedAt: GENERATED_AT,
      candidates: [
        {
          eventId: "event-1",
          candidateId: "current",
          origin: "ORIGINAL",
          requestId: null,
          sourceGlobalInterval: { start: 10.2, end: 11.8 },
          text: "正しい",
          tokens: [],
          ctcSupport: 0.8,
          pronunciationSupport: 0.8,
          evidenceIds: ["current-evidence"],
        },
        {
          eventId: "event-1",
          candidateId: "fresh-a",
          origin: "FRESH_A",
          requestId: "request-a",
          sourceGlobalInterval: { start: 9.5, end: 12.5 },
          text: "前正しい後",
          tokens: [
            {
              tokenId: "pre",
              text: "前",
              interval: { start: 9.5, end: 10 },
              mappingVerified: true,
              lexical: true,
              probability: 0.9,
            },
            {
              tokenId: "core",
              text: "正しい",
              interval: { start: 10.3, end: 11.7 },
              mappingVerified: true,
              lexical: true,
              probability: 0.9,
            },
            {
              tokenId: "post",
              text: "後",
              interval: { start: 12, end: 12.5 },
              mappingVerified: true,
              lexical: true,
              probability: 0.9,
            },
          ],
          ctcSupport: 0.8,
          pronunciationSupport: 0.8,
          evidenceIds: ["fresh-evidence"],
        },
      ],
    });
    const fresh = projection.candidates.find(
      (candidate) => candidate.candidateId === "fresh-a",
    );
    expect(fresh).toMatchObject({
      coreProjectedText: "正しい",
      preCoreText: "前",
      postCoreText: "後",
      projectionStatus: "PARTIAL_TOKEN_PROJECTED",
    });
    const comparability = buildMachineLocalizedCandidateComparability({
      mode: "observe",
      coreSpans: spans,
      projection,
      generatedAt: GENERATED_AT,
    });
    expect(comparability.events[0]).toMatchObject({
      status: "CORE_COMPARABLE",
      distinctCoreTextCount: 1,
    });
    expect(
      comparability.events[0]?.pairwiseComparisons[0]?.fullWindowOnlyDifference,
    ).toBe(true);
  });

  it("represents many-machine-to-one-Gold mappings without altering Core Spans", () => {
    const spans = buildMachineCoreAcousticSpan({
      mode: "observe",
      sourceMediaSha256: SOURCE_HASH,
      sourceDurationSeconds: 30,
      sourceReadOnlyVerified: true,
      selectionSemanticHash: "b".repeat(64),
      selectedEventIds: new Set(["event-a", "event-b"]),
      events: [
        {
          eventId: "event-a",
          acousticInterval: { start: 10, end: 11 },
          trustedTokenSpan: null,
          eventType: "SINGLE_UTTERANCE",
          semanticHash: "c".repeat(64),
        },
        {
          eventId: "event-b",
          acousticInterval: { start: 10.8, end: 12 },
          trustedTokenSpan: null,
          eventType: "SINGLE_UTTERANCE",
          semanticHash: "d".repeat(64),
        },
      ],
      vadSegments: [],
      freshTokens: [],
      generatedAt: GENERATED_AT,
    });
    const result = buildGoldLocalCoreEvaluation({
      coreSpans: spans,
      goldCues: [{ cueId: "gold-1", start: 9.9, end: 12.1, text: "連続会話" }],
      goldIdentityHash: "e".repeat(64),
      generatedAt: GENERATED_AT,
    });
    expect(result.artifact.summary.manyMachineToOneGoldCount).toBe(2);
    expect(
      result.artifact.events.every(
        (event) => event.evaluationStatus === "EVALUABLE_WITH_AMBIGUITY",
      ),
    ).toBe(true);
  });

  it("uses lower-is-better oracle deltas after Gold-local evaluation", () => {
    const spans = coreSpans();
    const projection = buildMachineCoreTextProjection({
      mode: "observe",
      coreSpans: spans,
      generatedAt: GENERATED_AT,
      candidates: [
        {
          eventId: "event-1",
          candidateId: "current",
          origin: "ORIGINAL",
          requestId: null,
          sourceGlobalInterval: { start: 10.2, end: 11.8 },
          text: "誤り",
          tokens: [],
          ctcSupport: null,
          pronunciationSupport: null,
          evidenceIds: ["current"],
        },
        {
          eventId: "event-1",
          candidateId: "fresh",
          origin: "FRESH_A",
          requestId: "request",
          sourceGlobalInterval: { start: 10.2, end: 11.8 },
          text: "正解",
          tokens: [],
          ctcSupport: null,
          pronunciationSupport: null,
          evidenceIds: ["fresh"],
        },
      ],
    });
    const gold = buildGoldLocalCoreEvaluation({
      coreSpans: spans,
      goldCues: [{ cueId: "gold", start: 10.1, end: 11.9, text: "正解" }],
      goldIdentityHash: "e".repeat(64),
      generatedAt: GENERATED_AT,
    });
    const oracle = buildMachineCoreCandidateOracleEvaluation({
      projection,
      goldEvaluation: gold.artifact,
      goldTextByEvent: gold.goldTextByEvent,
      currentCandidateIdsByEvent: new Map([["event-1", "current"]]),
      generatedAt: GENERATED_AT,
    });
    expect(oracle.metricDirection).toBe("LOWER_IS_BETTER");
    expect(oracle.events[0]).toMatchObject({
      oracleCandidateId: "fresh",
      oracleSource: "C6017_FRESH_CORE",
      oracleError: 0,
      improvement: true,
    });
    expect(oracle.events[0]?.delta).toBeLessThan(0);
  });
});

describe("C6.0.1.8 route decision", () => {
  it("recommends a second ASR when same-Core evidence is sufficient and ASR limitation dominates", () => {
    const comparability = {
      summary: { coreComparableCount: 9, partiallyComparableCount: 3 },
    } as unknown as MachineLocalizedCandidateComparability;
    const evaluation = {
      summary: {
        evaluableEventCount: 10,
        pipelineLimitedCount: 0,
        asrLimitedCount: 6,
        localizationBlockedCount: 4,
        referenceBlockedCount: 2,
      },
    } as unknown as MachineWhisperCoreStabilityEvaluation;
    const oracle = {
      summary: { oracleImprovedEventCount: 4 },
    } as unknown as MachineCoreCandidateOracleEvaluation;
    const decision = buildC6018RouteDecision({
      comparability,
      evaluation,
      oracle,
      strictC602QualityGatePassed: false,
      generatedAt: GENERATED_AT,
    });
    expect(decision).toMatchObject({
      decision: "RECOMMEND_SECOND_ASR_ENSEMBLE",
      recommendation: "STOP_SINGLE_WHISPER_RULE_EXPANSION",
      strictC602QualityGatePassed: false,
      productionStatus: "needs-review",
      finalizationMethod: "none",
    });
  });
});
