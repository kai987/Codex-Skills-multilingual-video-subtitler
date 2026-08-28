import {
  buildMachineCrossModelComparison,
  buildMachineCrossModelCtcArbitration,
  buildMachineCrossModelUnionOracleEvaluation,
  buildMachineIndependentAsrCandidates,
  buildMachineSecondAsrDiagnosticSet,
  buildMachineSecondAsrStability,
  buildC6019RouteDecision,
  buildGoldCrossModelComplementarityEvaluation,
  buildGoldSecondAsrControlRegression,
  compareCrossModelText,
  genericHallucinationRisk,
  independentAsrCacheKey,
  normalizeIndependentAsrLexical,
  normalizeJapanesePronunciation,
} from "@mvl/video-subtitler";
import { describe, expect, it } from "vitest";

const GENERATED_AT = "2026-08-29T06:00:00.000Z";
const HASH = "a".repeat(64);

function diagnosticSet() {
  const targetEvents = Array.from({ length: 12 }, (_, index) => ({
    eventId: `target-${String(index + 1).padStart(2, "0")}`,
    proposedCoreStart: index * 3,
    proposedCoreEnd: index * 3 + 2,
    coreSpanStatus: "VERIFIED_WITH_CAUTION" as const,
    evidenceIds: [`target-evidence-${index}`],
    semanticHash: (index % 10).toString().repeat(64),
  }));
  const controls = Array.from({ length: 14 }, (_, index) => ({
    eventId: `control-${String(index + 1).padStart(2, "0")}`,
    candidateId: `control-candidate-${index + 1}`,
    positiveErrorEvidenceCount: 0,
    strongPositiveErrorEvidenceCount: 0,
    evidenceAbsenceCount: 0,
    correctnessEvidenceCount: 11,
    conflictingEvidence: false,
    absenceOnly: false,
    recommendedAction: "KEEP",
    budgetSelected: false,
    stableTieBreakHash: String(index).padStart(64, "0"),
    semanticHash: "b".repeat(64),
  }));
  return buildMachineSecondAsrDiagnosticSet({
    generatedAt: GENERATED_AT,
    sourceMediaSha256: HASH,
    upstreamTargetSemanticHash: "c".repeat(64),
    targetEvents,
    riskEvents: controls,
    canonicalEvents: controls.map((control, index) => ({
      eventId: control.eventId,
      acousticInterval: { start: 100 + index * 3, end: 102 + index * 3 },
      eventType: "SINGLE_UTTERANCE",
      representativeCandidateId: control.candidateId,
      semanticHash: "d".repeat(64),
    })),
    poolCandidates: controls.map((control) => ({
      eventId: control.eventId,
      candidateId: control.candidateId,
      sourceGlobalVerified: true,
      semanticHash: "e".repeat(64),
    })),
    decoderCandidates: controls.map((control) => ({
      eventId: control.eventId,
      candidateId: control.candidateId,
      availability: "available",
      semanticHash: "f".repeat(64),
    })),
  });
}

function independentCandidates() {
  const diagnostic = diagnosticSet();
  const records = diagnostic.events.flatMap((event, index) =>
    (["CORE_EXACT", "CORE_CONTEXT"] as const).map((windowType) => {
      const interval =
        windowType === "CORE_EXACT"
          ? event.coreInterval
          : {
              start: Math.max(0, event.coreInterval.start - 1),
              end: event.coreInterval.end + 1,
            };
      const request = {
        requestId: `${event.eventId}:${windowType}`,
        eventId: event.eventId,
        diagnosticRole: event.role,
        windowType,
        sourceInterval: interval,
        sourceMediaSha256: HASH,
        audioPath: `/ignored/${event.eventId}-${windowType}.wav`,
        audioSha256: ((index + 1) % 10).toString().repeat(64),
        sampleRate: 16_000 as const,
        sampleCount: Math.round((interval.end - interval.start) * 16_000),
        extractionConfigHash: "1".repeat(64),
      };
      const text = `字幕${index}`;
      return {
        request,
        result: {
          requestId: request.requestId,
          status: "SUCCESS" as const,
          text,
          tokenPoints: [{ token: text, paddedAudioSeconds: 1 }],
          wallClockSeconds: 0.2,
          warnings: [],
        },
        cacheKey: independentAsrCacheKey({
          providerId: "reazonspeech-k2-v2",
          modelRevision: "1".repeat(40),
          modelFileHashes: { model: "2".repeat(64) },
          precision: "fp32",
          audioSha256: request.audioSha256,
          sourceInterval: interval,
          decodingConfig: { method: "greedy" },
          normalizationConfig: { version: 1 },
        }),
      };
    }),
  );
  return {
    diagnostic,
    candidates: buildMachineIndependentAsrCandidates({
      generatedAt: GENERATED_AT,
      executionKind: "OFFICIAL_FRESH_INFERENCE",
      diagnosticSet: diagnostic,
      modelIdentityHash: "3".repeat(64),
      records,
    }),
  };
}

describe("C6.0.1.9 machine-only analysis", () => {
  it("freezes 12 prior targets plus 12 deterministic low-risk controls before Gold", () => {
    const artifact = diagnosticSet();
    expect(artifact.targetEventIds).toHaveLength(12);
    expect(artifact.controlEventIds).toEqual(
      Array.from(
        { length: 12 },
        (_, index) => `control-${String(index + 1).padStart(2, "0")}`,
      ),
    );
    expect(artifact.runtimeGoldInputCount).toBe(0);
    expect(artifact.frozenBeforeGold).toBe(true);
  });

  it("keeps display, lexical, pronunciation and hallucination views distinct", () => {
    expect(normalizeIndependentAsrLexical(" カーネーション！ ")).toBe(
      "カーネーション",
    );
    expect(normalizeJapanesePronunciation("カーネーション")).toBe(
      "かーねーしょん",
    );
    expect(
      genericHallucinationRisk({
        text: "はいはいはいはいはい",
        durationSeconds: 1,
      }),
    ).toBeGreaterThan(0);
    expect(
      compareCrossModelText(
        {
          displayText: "カーネーション",
          normalizedDisplayText: "カーネーション",
          pronunciationText: "かーねーしょん",
          hallucinationRisk: 0,
        },
        {
          displayText: "かーねーしょん",
          normalizedDisplayText: "かーねーしょん",
          pronunciationText: "かーねーしょん",
          hallucinationRisk: 0,
        },
      ).disagreementClass,
    ).toBe("PRONUNCIATION_AGREEMENT");
  });

  it("materializes exactly 48 Fresh candidates and evaluates paired-window stability", () => {
    const { candidates } = independentCandidates();
    expect(candidates.summary).toMatchObject({
      plannedRequestCount: 48,
      actualRequestCount: 48,
      coreExactRequestCount: 24,
      coreContextRequestCount: 24,
      cacheHitCount: 0,
      inferenceCount: 48,
      runtimeGoldInputCount: 0,
    });
    expect(
      candidates.candidates.every((candidate) => !candidate.cacheHit),
    ).toBe(true);
    const stability = buildMachineSecondAsrStability({
      generatedAt: GENERATED_AT,
      candidates,
    });
    expect(stability.summary.coreStableCount).toBe(24);
    expect(stability.summary.stableRate).toBe(1);
  });

  it("compares only CORE_EXACT Reazon text with same-event Whisper candidates", () => {
    const { diagnostic, candidates } = independentCandidates();
    const whisperCandidates = diagnostic.events.map((event, index) => ({
      eventId: event.eventId,
      candidateId: `whisper-${index}`,
      displayText: `字幕${index}`,
      normalizedDisplayText: `字幕${index}`,
      pronunciationText: `字幕${index}`,
      hallucinationRisk: 0,
    }));
    const comparison = buildMachineCrossModelComparison({
      generatedAt: GENERATED_AT,
      diagnosticSet: diagnostic,
      independentCandidates: candidates,
      whisperCandidates,
    });
    expect(comparison.summary.exactAgreementCount).toBe(24);
    expect(comparison.summary.runtimeGoldInputCount).toBe(0);
  });

  it("keeps Gold post-freeze and routes only when complementarity and controls agree", () => {
    const { diagnostic, candidates } = independentCandidates();
    const stability = buildMachineSecondAsrStability({
      generatedAt: GENERATED_AT,
      candidates,
    });
    const comparison = buildMachineCrossModelComparison({
      generatedAt: GENERATED_AT,
      diagnosticSet: diagnostic,
      independentCandidates: candidates,
      whisperCandidates: diagnostic.events.map((event, index) => ({
        eventId: event.eventId,
        candidateId: `whisper-wrong-${index}`,
        displayText: `誤り${index}`,
        normalizedDisplayText: `誤り${index}`,
        pronunciationText: `あやまり${index}`,
        hallucinationRisk: 0,
      })),
    });
    const ctc = buildMachineCrossModelCtcArbitration({
      generatedAt: GENERATED_AT,
      comparison,
      ctcRuntimeIdentityHash: "4".repeat(64),
      ctcModelSnapshotHash: "5".repeat(64),
      evidence: [],
      inferenceCount: 0,
      modelLoadCount: 0,
    });
    const complementarity = buildGoldCrossModelComplementarityEvaluation({
      generatedAt: GENERATED_AT,
      machineFreezeHash: "6".repeat(64),
      goldIdentityHash: "7".repeat(64),
      comparison,
      ctcArbitration: ctc,
      localGold: diagnostic.events.map((event, index) => ({
        eventId: event.eventId,
        diagnosticRole: event.role,
        evaluationStatus: "EVALUABLE_EXACT_LOCAL",
        goldText: `字幕${index}`,
        currentWhisperText: `誤り${index}`,
      })),
    });
    const oracle = buildMachineCrossModelUnionOracleEvaluation({
      generatedAt: GENERATED_AT,
      complementarity,
    });
    const controls = buildGoldSecondAsrControlRegression({
      generatedAt: GENERATED_AT,
      complementarity,
      comparison,
    });
    const route = buildC6019RouteDecision({
      generatedAt: GENERATED_AT,
      complementarity,
      oracle,
      controls,
      stability,
    });
    expect(complementarity.summary.targetEvaluableCount).toBe(12);
    expect(oracle.summary.absoluteGain).toBeGreaterThan(0);
    expect(controls.summary.blindReazonRegressionCount).toBe(0);
    expect(route).toMatchObject({
      complementarityResult: "SECOND_ASR_COMPLEMENTARITY_CONFIRMED",
      routeDecision: "GO_C6_0_1_10_CROSS_MODEL_ARBITRATION",
      productionStatus: "needs-review",
      finalizationMethod: "none",
      machineReleaseAuthorized: false,
      goC602: false,
    });
  });
});
