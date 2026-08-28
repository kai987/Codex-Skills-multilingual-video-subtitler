import {
  c6019RouteDecisionSchema,
  goldCrossModelComplementarityEvaluationSchema,
  goldSecondAsrControlRegressionSchema,
  machineCrossModelComparisonSchema,
  machineCrossModelCtcArbitrationSchema,
  machineCrossModelUnionOracleEvaluationSchema,
  machineIndependentAsrCandidatesSchema,
  machineSecondAsrDiagnosticSetSchema,
  machineSecondAsrStabilitySchema,
} from "@mvl/shared";
import {
  buildC6019RouteDecision,
  buildGoldCrossModelComplementarityEvaluation,
  buildGoldSecondAsrControlRegression,
  buildMachineCrossModelComparison,
  buildMachineCrossModelCtcArbitration,
  buildMachineCrossModelUnionOracleEvaluation,
  buildMachineIndependentAsrCandidates,
  buildMachineSecondAsrDiagnosticSet,
  buildMachineSecondAsrStability,
  independentAsrCacheKey,
} from "@mvl/video-subtitler";
import { describe, expect, it } from "vitest";

const GENERATED_AT = "2026-08-29T06:00:00.000Z";
const SOURCE_HASH = "a".repeat(64);

describe("C6.0.1.9 independent-ASR complementarity E2E", () => {
  it("flows from a Gold-free diagnostic freeze to a conservative post-Gold route", () => {
    const targets = Array.from({ length: 12 }, (_, index) => ({
      eventId: `target-${String(index + 1).padStart(2, "0")}`,
      proposedCoreStart: index * 3,
      proposedCoreEnd: index * 3 + 2,
      coreSpanStatus: "VERIFIED_WITH_CAUTION" as const,
      evidenceIds: [`target-evidence-${index}`],
      semanticHash: `${index % 10}`.repeat(64),
    }));
    const controlRisk = Array.from({ length: 12 }, (_, index) => ({
      eventId: `control-${String(index + 1).padStart(2, "0")}`,
      candidateId: `control-candidate-${index + 1}`,
      positiveErrorEvidenceCount: 0,
      strongPositiveErrorEvidenceCount: 0,
      evidenceAbsenceCount: 0,
      correctnessEvidenceCount: 11,
      conflictingEvidence: false,
      absenceOnly: false,
      recommendedAction: "KEEP" as const,
      budgetSelected: false,
      stableTieBreakHash: String(index).padStart(64, "0"),
      semanticHash: "b".repeat(64),
    }));
    const diagnostic = buildMachineSecondAsrDiagnosticSet({
      generatedAt: GENERATED_AT,
      sourceMediaSha256: SOURCE_HASH,
      upstreamTargetSemanticHash: "c".repeat(64),
      targetEvents: targets,
      riskEvents: controlRisk,
      canonicalEvents: controlRisk.map((control, index) => ({
        eventId: control.eventId,
        acousticInterval: { start: 100 + index * 3, end: 102 + index * 3 },
        eventType: "SINGLE_UTTERANCE" as const,
        representativeCandidateId: control.candidateId,
        semanticHash: "d".repeat(64),
      })),
      poolCandidates: controlRisk.map((control) => ({
        eventId: control.eventId,
        candidateId: control.candidateId,
        sourceGlobalVerified: true,
        semanticHash: "e".repeat(64),
      })),
      decoderCandidates: controlRisk.map((control) => ({
        eventId: control.eventId,
        candidateId: control.candidateId,
        availability: "available" as const,
        semanticHash: "f".repeat(64),
      })),
    });
    const records = diagnostic.events.flatMap((event, index) =>
      (["CORE_EXACT", "CORE_CONTEXT"] as const).map((windowType) => {
        const sourceInterval =
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
          sourceInterval,
          sourceMediaSha256: SOURCE_HASH,
          audioPath: `/fixture/${event.eventId}-${windowType}.wav`,
          audioSha256: `${(index + 1) % 10}`.repeat(64),
          sampleRate: 16_000 as const,
          sampleCount: Math.round(
            (sourceInterval.end - sourceInterval.start) * 16_000,
          ),
          extractionConfigHash: "1".repeat(64),
        };
        return {
          request,
          result: {
            requestId: request.requestId,
            status: "SUCCESS" as const,
            text: `正答${index}`,
            tokenPoints: [{ token: `正答${index}`, paddedAudioSeconds: 1.1 }],
            wallClockSeconds: 0.2,
            warnings: [],
          },
          cacheKey: independentAsrCacheKey({
            providerId: "reazonspeech-k2-v2",
            modelRevision: "2".repeat(40),
            modelFileHashes: { model: "3".repeat(64) },
            precision: "fp32",
            audioSha256: request.audioSha256,
            sourceInterval,
            decodingConfig: { method: "greedy_search", threads: 1 },
            normalizationConfig: { version: "c6019-v1" },
          }),
        };
      }),
    );
    const candidates = buildMachineIndependentAsrCandidates({
      generatedAt: GENERATED_AT,
      executionKind: "OFFICIAL_FRESH_INFERENCE",
      diagnosticSet: diagnostic,
      modelIdentityHash: "4".repeat(64),
      records,
    });
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
        candidateId: `whisper-${index}`,
        displayText: `誤答${index}`,
        normalizedDisplayText: `誤答${index}`,
        pronunciationText: `ごとう${index}`,
        hallucinationRisk: 0,
      })),
    });
    const ctc = buildMachineCrossModelCtcArbitration({
      generatedAt: GENERATED_AT,
      comparison,
      ctcRuntimeIdentityHash: "5".repeat(64),
      ctcModelSnapshotHash: "6".repeat(64),
      evidence: comparison.events.slice(0, 2).map((event, index) => ({
        eventId: event.eventId,
        whisperProjection: event.whisperCandidates[0]?.displayText ?? "",
        reazonProjection: event.reazonCandidate.displayText,
        ctcWhisperEvidence: index === 0 ? 0.5 : null,
        ctcReazonEvidence: index === 0 ? 0.7 : null,
        evidenceIds: [`ctc-${index}`],
      })),
      inferenceCount: 2,
      modelLoadCount: 1,
    });
    const complementarity = buildGoldCrossModelComplementarityEvaluation({
      generatedAt: GENERATED_AT,
      machineFreezeHash: stability.semanticHash,
      goldIdentityHash: "7".repeat(64),
      comparison,
      ctcArbitration: ctc,
      localGold: diagnostic.events.map((event, index) => ({
        eventId: event.eventId,
        diagnosticRole: event.role,
        evaluationStatus: "EVALUABLE_EXACT_LOCAL",
        goldText: `正答${index}`,
        currentWhisperText: `誤答${index}`,
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

    expect(machineSecondAsrDiagnosticSetSchema.parse(diagnostic)).toEqual(
      diagnostic,
    );
    expect(machineIndependentAsrCandidatesSchema.parse(candidates)).toEqual(
      candidates,
    );
    expect(machineSecondAsrStabilitySchema.parse(stability)).toEqual(stability);
    expect(machineCrossModelComparisonSchema.parse(comparison)).toEqual(
      comparison,
    );
    expect(machineCrossModelCtcArbitrationSchema.parse(ctc)).toEqual(ctc);
    expect(
      goldCrossModelComplementarityEvaluationSchema.parse(complementarity),
    ).toEqual(complementarity);
    expect(machineCrossModelUnionOracleEvaluationSchema.parse(oracle)).toEqual(
      oracle,
    );
    expect(goldSecondAsrControlRegressionSchema.parse(controls)).toEqual(
      controls,
    );
    expect(c6019RouteDecisionSchema.parse(route)).toEqual(route);
    expect(diagnostic.runtimeGoldInputCount).toBe(0);
    expect(candidates.summary).toMatchObject({
      actualRequestCount: 48,
      cacheHitCount: 0,
      inferenceCount: 48,
      runtimeGoldInputCount: 0,
    });
    expect(ctc.correlationPolicy).toBe(
      "DATA_FAMILY_CORRELATED_NOT_AN_INDEPENDENT_VOTE",
    );
    expect(route).toMatchObject({
      complementarityResult: "SECOND_ASR_COMPLEMENTARITY_CONFIRMED",
      routeDecision: "GO_C6_0_1_10_CROSS_MODEL_ARBITRATION",
      canonicalTextMutationCount: 0,
      canonicalTimingMutationCount: 0,
      productionStatus: "needs-review",
      finalizationMethod: "none",
      machineReleaseAuthorized: false,
      goC602: false,
      runtimeGoldInputCount: 0,
    });
  });
});
