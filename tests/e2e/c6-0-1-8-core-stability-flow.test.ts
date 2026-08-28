import {
  goldLocalCoreEvaluationSchema,
  machineCoreAcousticSpanSchema,
  machineCoreAsrStabilitySchema,
  machineCoreCandidateOracleEvaluationSchema,
  machineCoreTextProjectionSchema,
  machineLocalizedCandidateComparabilitySchema,
} from "@mvl/shared";
import {
  buildGoldLocalCoreEvaluation,
  buildMachineCoreAcousticSpan,
  buildMachineCoreAsrStability,
  buildMachineCoreCandidateOracleEvaluation,
  buildMachineCoreTextProjection,
  buildMachineLocalizedCandidateComparability,
} from "@mvl/video-subtitler";
import { describe, expect, it } from "vitest";

const GENERATED_AT = "2026-08-29T00:00:00.000Z";

describe("C6.0.1.8 machine-freeze then Gold-local evaluation E2E", () => {
  it("keeps machine Core artifacts Gold-free and evaluates a frozen same-Core candidate pool", () => {
    const coreSpans = buildMachineCoreAcousticSpan({
      mode: "observe",
      sourceMediaSha256: "a".repeat(64),
      sourceDurationSeconds: 60,
      sourceReadOnlyVerified: true,
      selectionSemanticHash: "b".repeat(64),
      selectedEventIds: new Set(["event"]),
      events: [
        {
          eventId: "event",
          acousticInterval: { start: 20, end: 22 },
          trustedTokenSpan: { start: 20.2, end: 21.8 },
          eventType: "SINGLE_UTTERANCE",
          semanticHash: "c".repeat(64),
        },
      ],
      vadSegments: [
        { interval: { start: 20.1, end: 21.9 }, evidenceId: "vad" },
      ],
      freshTokens: [],
      generatedAt: GENERATED_AT,
    });
    const projection = buildMachineCoreTextProjection({
      mode: "observe",
      coreSpans,
      generatedAt: GENERATED_AT,
      candidates: [
        {
          eventId: "event",
          candidateId: "current",
          origin: "ORIGINAL",
          requestId: null,
          sourceGlobalInterval: { start: 20.2, end: 21.8 },
          text: "候補甲",
          tokens: [],
          ctcSupport: 0.7,
          pronunciationSupport: 0.7,
          evidenceIds: ["current"],
        },
        {
          eventId: "event",
          candidateId: "fresh-a",
          origin: "FRESH_A",
          requestId: "request-a",
          sourceGlobalInterval: { start: 20, end: 22 },
          text: "候補乙",
          tokens: [
            {
              tokenId: "fresh-token",
              text: "候補乙",
              interval: { start: 20.3, end: 21.7 },
              mappingVerified: true,
              lexical: true,
              probability: 0.9,
            },
          ],
          ctcSupport: 0.8,
          pronunciationSupport: 0.8,
          evidenceIds: ["fresh"],
        },
      ],
    });
    const comparability = buildMachineLocalizedCandidateComparability({
      mode: "observe",
      coreSpans,
      projection,
      generatedAt: GENERATED_AT,
    });
    const stability = buildMachineCoreAsrStability({
      mode: "observe",
      projection,
      comparability,
      generatedAt: GENERATED_AT,
    });
    const machineFreezeHash = stability.semanticHash;

    expect(machineCoreAcousticSpanSchema.parse(coreSpans)).toEqual(coreSpans);
    expect(machineCoreTextProjectionSchema.parse(projection)).toEqual(
      projection,
    );
    expect(
      machineLocalizedCandidateComparabilitySchema.parse(comparability),
    ).toEqual(comparability);
    expect(machineCoreAsrStabilitySchema.parse(stability)).toEqual(stability);
    expect(coreSpans.summary.runtimeGoldInputCount).toBe(0);
    expect(projection.summary.runtimeGoldInputCount).toBe(0);
    expect(stability.summary.runtimeGoldInputCount).toBe(0);

    const gold = buildGoldLocalCoreEvaluation({
      coreSpans,
      machineFreezeHash,
      goldCues: [{ cueId: "gold-1", start: 20.15, end: 21.85, text: "候補乙" }],
      goldIdentityHash: "d".repeat(64),
      generatedAt: GENERATED_AT,
    });
    const oracle = buildMachineCoreCandidateOracleEvaluation({
      projection,
      goldEvaluation: gold.artifact,
      goldTextByEvent: gold.goldTextByEvent,
      currentCandidateIdsByEvent: new Map([["event", "current"]]),
      machineFreezeHash,
      generatedAt: GENERATED_AT,
    });
    expect(goldLocalCoreEvaluationSchema.parse(gold.artifact)).toEqual(
      gold.artifact,
    );
    expect(machineCoreCandidateOracleEvaluationSchema.parse(oracle)).toEqual(
      oracle,
    );
    expect(gold.artifact.machineFreezeHash).toBe(machineFreezeHash);
    expect(gold.artifact.events[0]?.goldTextIncluded).toBe(false);
    expect(oracle.events[0]).toMatchObject({
      oracleCandidateId: "fresh-a",
      oracleError: 0,
      improvement: true,
      goldTextIncluded: false,
    });
    expect(stability.semanticHash).toBe(machineFreezeHash);
  });
});
