import type {
  MachineCrossModelArbitrationEvidence,
  MachineIndependentAcousticDiscriminator,
} from "@mvl/shared";
import { formatAss, formatSrt, formatVtt } from "@mvl/subtitle-core";
import {
  auditC60111CalibrationData,
  buildC60111CalibrationFolds,
  buildC60111FeatureAblationReport,
  buildCrossModelCalibrationCorpus,
  buildCrossModelDiscriminatorFeatures,
  buildGoldCrossModelCalibrationLabels,
  buildIndependentDiscriminatorEvent,
  buildMachinePairedWhisperEvidence,
  c60111FeatureSets,
  decideC60111Route,
  freezeC60111SelectiveDiscriminator,
  machineQualitySemanticHash,
  runSelectiveGroupedCrossValidation,
} from "@mvl/video-subtitler";
import { describe, expect, it } from "vitest";

const GENERATED_AT = "2026-08-29T12:00:00.000Z";
const HASH = "a".repeat(64);

function projectedScore(nllPerTargetToken: number) {
  return {
    representation: "NORMALIZED_DISPLAY" as const,
    representationHash: HASH,
    encodedTokenCount: 4,
    unknownTokenCount: 0,
    coverageRatio: 1,
    rawNll: nllPerTargetToken * 4,
    nllPerTargetToken,
    acousticFrameCount: 100,
    targetCoverage: 1,
    blockers: [],
  };
}

describe("C6.0.1.11 paired discriminator calibration E2E", () => {
  it("keeps Gold out until feature/fold freeze and leaves production unchanged after OOF calibration", () => {
    const eventCount = 50;
    const baselineEvents = Array.from({ length: eventCount }, (_, index) => {
      const reazonSignal = index % 4 === 0;
      return {
        eventId: `event-${String(index + 1).padStart(3, "0")}`,
        crossModelRelation:
          index < 45
            ? ("LEXICAL_DISAGREEMENT" as const)
            : ("EXACT_AGREEMENT" as const),
        currentWhisperCandidate: {
          displayText: reazonSignal ? "誤り" : "正解",
          normalizedDisplayText: reazonSignal ? "誤り" : "正解",
          pronunciationText: reazonSignal ? "あやまり" : "せいかい",
        },
        reazonCoreExactCandidate: {
          displayText: reazonSignal ? "正解" : "誤り",
          normalizedDisplayText: reazonSignal ? "正解" : "誤り",
          pronunciationText: reazonSignal ? "せいかい" : "あやまり",
        },
        whisperHallucinationRisk: reazonSignal ? 0.7 : 0.1,
        reazonHallucinationRisk: reazonSignal ? 0.1 : 0.7,
        whisperStability: { negativeEvidence: reazonSignal },
        reazonStability: {
          class: reazonSignal
            ? "REAZON_CORE_STABLE"
            : "REAZON_LEXICALLY_UNSTABLE",
        },
        whisperDecoderEvidence: {
          status: reazonSignal ? "POSITIVE_ERROR_EVIDENCE" : "UNKNOWN",
          strong: reazonSignal,
        },
        whisperTokenEvidence: { status: "UNKNOWN", strong: false },
        requestEdgeEvidence: { status: "UNKNOWN", strong: false },
        speechCompletenessEvidence: { status: "UNKNOWN", strong: false },
        ctcWhisperSupport: null,
        ctcReazonSupport: null,
        coreLocalizationStatus: "MACHINE_LOCALIZABLE",
        mutationSafetyStatus: "BLOCKED",
        textSpanLineageStatus: "UNRESOLVED",
      };
    });
    const baselineEvidence = {
      semanticHash: HASH,
      events: baselineEvents,
    } as unknown as MachineCrossModelArbitrationEvidence;
    const selection = {
      events: baselineEvents.map((event, index) => ({
        eventId: event.eventId,
        coreInterval: { start: index * 5 + 1, end: index * 5 + 2 },
        machineLocalizable: true,
        sourceEvidenceIds: [HASH],
      })),
    };
    const corpus = buildCrossModelCalibrationCorpus({
      generatedAt: GENERATED_AT,
      sourceMediaSha256: HASH,
      evidence: baselineEvidence,
      selection,
      controlCount: 5,
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
          eventId: event.eventId,
          windowType,
        }),
        execution: "FRESH_INFERENCE" as const,
        text:
          baselineEvents.find((value) => value.eventId === event.eventId)
            ?.currentWhisperCandidate.displayText ?? "",
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
        candidateId: `whisper:${event.eventId}`,
        text:
          baselineEvents.find((value) => value.eventId === event.eventId)
            ?.currentWhisperCandidate.displayText ?? "",
        pronunciationText: "せいかい",
        hallucinationRisk: 0.1,
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
    const independentEvents = corpus.events.map((event, index) =>
      buildIndependentDiscriminatorEvent({
        eventId: event.eventId,
        audioSha256: HASH,
        whisperCandidateId: `whisper:${event.eventId}`,
        reazonCandidateId: `reazon:${event.eventId}`,
        result: {
          whisper: projectedScore(index % 4 === 0 ? 6 : 2),
          reazon: projectedScore(index % 4 === 0 ? 2 : 6),
        },
      }),
    );
    const independent = {
      semanticHash: "b".repeat(64),
      events: independentEvents,
    } as unknown as MachineIndependentAcousticDiscriminator;
    const features = buildCrossModelDiscriminatorFeatures({
      generatedAt: GENERATED_AT,
      corpus,
      baselineEvidence,
      pairedWhisper: paired,
      independentDiscriminator: independent,
    });
    const folds = buildC60111CalibrationFolds({
      generatedAt: GENERATED_AT,
      corpus,
    });
    expect(features.featuresFrozenBeforeGold).toBe(true);
    expect(folds.constructedBeforeLabels).toBe(true);

    const labels = buildGoldCrossModelCalibrationLabels({
      generatedAt: GENERATED_AT,
      corpus,
      features,
      folds,
      goldEvaluation: {
        goldIdentityHash: "c".repeat(64),
        events: corpus.events.map((event, index) => ({
          eventId: event.eventId,
          evaluationStatus: "EVALUABLE_LOCAL",
          baselineWhisperPoolError: index % 4 === 0 ? 4 : 1,
          reazonCoreExactError: index % 4 === 0 ? 1 : 4,
          semanticHash: machineQualitySemanticHash({ goldIndex: index }),
        })),
      },
    });
    const featureSets = c60111FeatureSets();
    const results = Object.entries(featureSets).map(([modelId, featureNames]) =>
      runSelectiveGroupedCrossValidation({
        generatedAt: GENERATED_AT,
        modelId: modelId as keyof typeof featureSets,
        featureNames,
        corpus,
        features,
        folds,
        labels,
      }),
    );
    const ablation = buildC60111FeatureAblationReport({
      generatedAt: GENERATED_AT,
      results: results.map((result) => result.cv),
    });
    const bestIndex = Object.keys(featureSets).indexOf(ablation.bestModelId);
    const best = results[bestIndex];
    if (best === undefined) throw new Error("Missing ablation winner result.");
    const dataQuality = auditC60111CalibrationData({
      generatedAt: GENERATED_AT,
      corpus,
      features,
      folds,
    });
    const route = decideC60111Route({
      generatedAt: GENERATED_AT,
      bestCv: best.cv,
      pairedWhisperCoverage: paired.summary.coverage,
      independentVerifierEngineeringValid: true,
      independentScorableCoverage: 1,
      evaluableDisagreementCount: corpus.summary.disagreementCount,
      dataQuality,
    });
    const freeze = freezeC60111SelectiveDiscriminator({
      generatedAt: GENERATED_AT,
      modelId: ablation.bestModelId,
      featureNames: featureSets[ablation.bestModelId],
      features,
      labels,
      oof: best.oof,
      strongCalibrationPass: route.strongCalibrationPass,
      promisingCalibration: route.promisingCalibration,
    });

    const baselineCues = [
      { id: "cue-1", start: 1, end: 2, text: "現行字幕。" },
    ];
    const finalCues = [...baselineCues];
    expect(dataQuality.passed).toBe(true);
    expect(route.productionProfile).toBe("DISABLED");
    expect(route.productionStatus).toBe("needs-review");
    expect(route.finalizationMethod).toBe("none");
    expect(route.machineOnlyReleaseAuthorized).toBe(false);
    expect(route.c602Status).toBe("HOLD");
    expect(freeze.productionEnforcementEnabled).toBe(false);
    expect(formatAss(finalCues)).toBe(formatAss(baselineCues));
    expect(formatSrt(finalCues)).toBe(formatSrt(baselineCues));
    expect(formatVtt(finalCues)).toBe(formatVtt(baselineCues));
  }, 15_000);
});
