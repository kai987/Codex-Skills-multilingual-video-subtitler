import type {
  C60111CvResults,
  C60111DataQualityAudit,
  C60111OutOfFoldPredictions,
  GoldCrossModelCalibrationLabels,
  MachineCrossModelDiscriminatorFeatures,
} from "@mvl/shared";
import {
  buildC60111FeatureAblationReport,
  decideC60111Route,
  freezeC60111SelectiveDiscriminator,
  machineQualitySemanticHash,
} from "@mvl/video-subtitler";
import { describe, expect, it } from "vitest";

const GENERATED_AT = "2026-08-29T12:00:00.000Z";
const HASH = "a".repeat(64);
type ModelId = "M0" | "M1" | "M2" | "M3" | "M4" | "M5";

function cv(
  modelId: ModelId,
  metrics: {
    selected: number;
    correct: number;
    wrong: number;
    gain: number;
    precision: number | null;
  },
): C60111CvResults {
  const foldResults = Array.from({ length: 5 }, (_, index) => ({
    fold: index + 1,
    trainCount: 40,
    testCount: 10,
    threshold: 0.8,
    metrics: {
      selectedCount: index < metrics.selected ? 1 : 0,
      correctCount: index < metrics.correct ? 1 : 0,
      wrongCount: index < metrics.wrong ? 1 : 0,
      neutralCount: 0,
      precision: index < metrics.selected ? 1 : null,
      harmRate: index < metrics.wrong ? 1 : 0,
      selectiveCoverage: index < metrics.selected ? 0.1 : 0,
      realizedGain: index < Math.min(5, metrics.gain) ? 1 : 0,
      availableOracleGain: 10,
      oracleCaptureRate: index < metrics.selected ? 0.1 : 0,
    },
    semanticHash: HASH,
  }));
  return {
    modelId,
    featureSet: [`feature-${modelId}`],
    foldResults,
    aggregate: {
      selectedCount: metrics.selected,
      correctCount: metrics.correct,
      wrongCount: metrics.wrong,
      neutralCount: metrics.selected - metrics.correct - metrics.wrong,
      precision: metrics.precision,
      harmRate:
        metrics.correct + metrics.wrong === 0
          ? 0
          : metrics.wrong / (metrics.correct + metrics.wrong),
      selectiveCoverage: metrics.selected / 50,
      realizedGain: metrics.gain,
      availableOracleGain: 100,
      oracleCaptureRate: metrics.gain / 100,
      precisionWilsonLower: metrics.precision,
      precisionWilsonUpper: metrics.precision,
      negativeGainFoldCount: 0,
      zeroHarmFoldCount: 5,
    },
    coefficients: {},
  } as unknown as C60111CvResults;
}

function passingAudit(): C60111DataQualityAudit {
  return { passed: true } as C60111DataQualityAudit;
}

describe("C6.0.1.11 ablation, route, and freeze", () => {
  it("selects the zero-harm positive-gain ablation winner", () => {
    const results = [
      cv("M0", { selected: 4, correct: 3, wrong: 1, gain: 2, precision: 0.75 }),
      cv("M1", { selected: 5, correct: 5, wrong: 0, gain: 5, precision: 1 }),
      cv("M2", { selected: 5, correct: 4, wrong: 1, gain: 3, precision: 0.8 }),
      cv("M3", { selected: 6, correct: 6, wrong: 0, gain: 8, precision: 1 }),
      cv("M4", { selected: 5, correct: 5, wrong: 0, gain: 7, precision: 1 }),
      cv("M5", { selected: 2, correct: 2, wrong: 0, gain: 3, precision: 1 }),
    ];
    const report = buildC60111FeatureAblationReport({
      generatedAt: GENERATED_AT,
      results,
    });
    expect(report.bestModelId).toBe("M3");
    expect(report.variants).toHaveLength(6);
  });

  it("allows only a well-covered, zero-harm, consistent result into prospective observe-only", () => {
    const decision = decideC60111Route({
      generatedAt: GENERATED_AT,
      bestCv: cv("M3", {
        selected: 6,
        correct: 6,
        wrong: 0,
        gain: 8,
        precision: 1,
      }),
      pairedWhisperCoverage: 1,
      independentVerifierEngineeringValid: true,
      independentScorableCoverage: 0.95,
      evaluableDisagreementCount: 50,
      dataQuality: passingAudit(),
    });
    expect(decision.strongCalibrationPass).toBe(true);
    expect(decision.productionProfile).toBe("DISABLED");
    expect(decision.machineOnlyReleaseAuthorized).toBe(false);
    expect(decision.nextStage).toBe("PROSPECTIVE_FROZEN_OBSERVE_ONLY");
  });

  it("fails closed when one wrong override survives", () => {
    const decision = decideC60111Route({
      generatedAt: GENERATED_AT,
      bestCv: cv("M3", {
        selected: 6,
        correct: 5,
        wrong: 1,
        gain: 3,
        precision: 5 / 6,
      }),
      pairedWhisperCoverage: 1,
      independentVerifierEngineeringValid: true,
      independentScorableCoverage: 0.95,
      evaluableDisagreementCount: 50,
      dataQuality: passingAudit(),
    });
    expect(decision.strongCalibrationPass).toBe(false);
    expect(decision.automaticProviderSelectionSupported).toBe(false);
    expect(decision.stopAutomaticProviderSwitchExpansion).toBe(true);
    expect(decision.nextStage).toBe("MULTI_ASR_REVIEW_ASSISTANCE");
  });

  it("creates a prospective-only full-data freeze only after strong or promising calibration", () => {
    const featureCore = {
      eventId: "event-1",
      audioGroupId: "group-1",
      featureValues: { margin: 1 },
      missingIndicators: { margin: false },
      metadata: {
        coreStart: 1,
        coreEnd: 2,
        mutationSafetyEligible: false,
        spanLineageStatus: "UNRESOLVED",
      },
    };
    const labelCore = {
      eventId: "event-1",
      label: "REAZON_BETTER" as const,
      whisperLocalError: 3,
      reazonLocalError: 1,
      localErrorDelta: 2,
      evaluationEvidenceIds: ["evaluation-1"],
    };
    const features = {
      featureSchemaHash: "b".repeat(64),
      events: [
        {
          ...featureCore,
          semanticHash: machineQualitySemanticHash(featureCore),
        },
      ],
    } as unknown as MachineCrossModelDiscriminatorFeatures;
    const labels = {
      events: [
        { ...labelCore, semanticHash: machineQualitySemanticHash(labelCore) },
      ],
    } as unknown as GoldCrossModelCalibrationLabels;
    const oof = {
      predictions: [
        {
          eventId: "event-1",
          fold: 1,
          score: 0.95,
          threshold: 0.9,
          decision: "SELECT_REAZON",
          label: "REAZON_BETTER",
          localGain: 2,
          semanticHash: HASH,
        },
      ],
    } as unknown as C60111OutOfFoldPredictions;
    const frozen = freezeC60111SelectiveDiscriminator({
      generatedAt: GENERATED_AT,
      modelId: "M5",
      featureNames: ["margin"],
      features,
      labels,
      oof,
      strongCalibrationPass: true,
      promisingCalibration: false,
    });
    expect(frozen.created).toBe(true);
    expect(frozen.productionEnforcementEnabled).toBe(false);
    expect(frozen.threshold).toBe(0.95);
  });
});
