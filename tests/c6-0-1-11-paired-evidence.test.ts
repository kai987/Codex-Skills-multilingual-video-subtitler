import type { MachineCrossModelArbitrationEvidence } from "@mvl/shared";
import {
  buildCrossModelCalibrationCorpus,
  buildMachinePairedWhisperEvidence,
  classifyWhisperCoreStabilityV2,
  machineQualitySemanticHash,
} from "@mvl/video-subtitler";
import { describe, expect, it } from "vitest";

const GENERATED_AT = "2026-08-29T12:00:00.000Z";
const HASH = "a".repeat(64);

function evidence(): MachineCrossModelArbitrationEvidence {
  const relations = [
    "LEXICAL_DISAGREEMENT",
    "WHISPER_HALLUCINATION_RISK",
    "EXACT_AGREEMENT",
    "NORMALIZED_AGREEMENT",
    "ORTHOGRAPHY_ONLY_DIFFERENCE",
  ] as const;
  return {
    semanticHash: HASH,
    events: relations.map((crossModelRelation, index) => ({
      eventId: `event-${index + 1}`,
      crossModelRelation,
      whisperHallucinationRisk: 0.1,
      reazonHallucinationRisk: 0.1,
    })),
  } as unknown as MachineCrossModelArbitrationEvidence;
}

describe("C6.0.1.11 paired cross-model evidence", () => {
  it("selects disagreements and deterministic controls without Gold", () => {
    const input = evidence();
    const corpus = buildCrossModelCalibrationCorpus({
      generatedAt: GENERATED_AT,
      sourceMediaSha256: HASH,
      evidence: input,
      selection: {
        events: input.events.map((event, index) => ({
          eventId: event.eventId,
          coreInterval: { start: index * 3 + 1, end: index * 3 + 2 },
          machineLocalizable: true,
          sourceEvidenceIds: [HASH],
        })),
      },
      controlCount: 3,
    });
    expect(corpus.summary).toMatchObject({
      eventCount: 5,
      disagreementCount: 2,
      controlCount: 3,
      runtimeGoldInputCount: 0,
    });
    const replay = buildCrossModelCalibrationCorpus({
      generatedAt: "2026-08-30T12:00:00.000Z",
      sourceMediaSha256: HASH,
      evidence: input,
      selection: {
        events: input.events.map((event, index) => ({
          eventId: event.eventId,
          coreInterval: { start: index * 3 + 1, end: index * 3 + 2 },
          machineLocalizable: true,
          sourceEvidenceIds: [HASH],
        })),
      },
      controlCount: 3,
    });
    expect(replay.semanticHash).toBe(corpus.semanticHash);
  });

  it("classifies exact/context evidence by lexical behavior", () => {
    expect(
      classifyWhisperCoreStabilityV2({
        exactText: "まだ真っ暗やん",
        contextText: "まだ真っ暗やん",
        exactDurationSeconds: 2,
        contextDurationSeconds: 4,
      }),
    ).toBe("WHISPER_CORE_STABLE");
    expect(
      classifyWhisperCoreStabilityV2({
        exactText: "真っ暗やん",
        contextText: "まだ真っ暗やん",
        exactDurationSeconds: 2,
        contextDurationSeconds: 4,
      }),
    ).toBe("WHISPER_CONTEXT_EXTENSION_ONLY");
    expect(
      classifyWhisperCoreStabilityV2({
        exactText: "おはよう",
        contextText: "さようなら",
        exactDurationSeconds: 2,
        contextDurationSeconds: 4,
      }),
    ).toBe("WHISPER_LEXICALLY_UNSTABLE");
    expect(
      classifyWhisperCoreStabilityV2({
        exactText: null,
        contextText: "声",
        exactDurationSeconds: 0,
        contextDurationSeconds: 4,
      }),
    ).toBe("WHISPER_UNCOMPARABLE");
  });

  it("materializes exact and context requests with measured coverage", () => {
    const input = evidence();
    const corpus = buildCrossModelCalibrationCorpus({
      generatedAt: GENERATED_AT,
      sourceMediaSha256: HASH,
      evidence: input,
      selection: {
        events: input.events.slice(0, 2).map((event, index) => ({
          eventId: event.eventId,
          coreInterval: { start: index * 3 + 1, end: index * 3 + 2 },
          machineLocalizable: true,
          sourceEvidenceIds: [HASH],
        })),
      },
      controlCount: 0,
    });
    const executions = corpus.events.flatMap((event) =>
      (["CORE_EXACT", "CORE_CONTEXT"] as const).map((windowType) => ({
        eventId: event.eventId,
        requestId: `${event.eventId}:${windowType}`,
        windowType,
        sourceInterval:
          windowType === "CORE_EXACT"
            ? event.coreInterval
            : event.sourceInterval,
        audioSha256: HASH,
        cacheKey: machineQualitySemanticHash({
          event: event.eventId,
          windowType,
        }),
        execution: "FRESH_INFERENCE" as const,
        text: event.eventId === "event-1" ? "せやな" : "ほんまやな",
        decoderEvidence: {
          averageLogProbability: -0.2,
          noSpeechProbability: 0.01,
          compressionRatio: 1,
          temperature: 0,
          fallbackCount: 0,
          tokenTimestampAvailable: true,
          decoderSegmentCount: 1,
        },
        tokenEvidenceAvailable: true,
      })),
    );
    const paired = buildMachinePairedWhisperEvidence({
      generatedAt: GENERATED_AT,
      sourceMediaSha256: HASH,
      corpus,
      currentCandidates: corpus.events.map((event) => ({
        eventId: event.eventId,
        candidateId: `current:${event.eventId}`,
        text: "現行",
        pronunciationText: "げんこう",
        hallucinationRisk: 0,
        semanticHash: HASH,
      })),
      executions,
      modelIdentity: {
        modelId: "whisper.cpp/large-v3",
        modelSha256: HASH,
        runtimeId: HASH,
        runtimeBinarySha256: HASH,
        runtimePatchSha256: HASH,
        device: "metal",
        precision: "f16/f32",
      },
      modelLoadCount: 1,
      processStartCount: 1,
    });
    expect(paired.summary.coverage).toBe(1);
    expect(paired.requests).toMatchObject({
      coreExactActualCount: 2,
      coreContextActualCount: 2,
      coreExactFreshInferenceCount: 2,
      coreContextFreshInferenceCount: 2,
    });
    expect(paired.summary.stabilityCounts.WHISPER_CORE_STABLE).toBe(2);
  });
});
