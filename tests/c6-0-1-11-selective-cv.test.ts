import type {
  C60111CalibrationFolds,
  GoldCrossModelCalibrationLabels,
  MachineCrossModelCalibrationCorpus,
  MachineCrossModelDiscriminatorFeatures,
} from "@mvl/shared";
import {
  auditC60111CalibrationData,
  machineQualitySemanticHash,
  runSelectiveGroupedCrossValidation,
  scoreSelectiveClassifier,
  selectSafetyFirstThreshold,
  trainSelectiveLogisticRegression,
} from "@mvl/video-subtitler";
import { describe, expect, it } from "vitest";

const GENERATED_AT = "2026-08-29T12:00:00.000Z";
const HASH = "a".repeat(64);

function syntheticInputs(): {
  corpus: MachineCrossModelCalibrationCorpus;
  features: MachineCrossModelDiscriminatorFeatures;
  folds: C60111CalibrationFolds;
  labels: GoldCrossModelCalibrationLabels;
} {
  const events = Array.from({ length: 50 }, (_, index) => ({
    eventId: `event-${String(index + 1).padStart(3, "0")}`,
    role: index < 45 ? ("DISAGREEMENT" as const) : ("CONTROL" as const),
    sourceInterval: { start: index * 3, end: index * 3 + 2 },
    coreInterval: { start: index * 3 + 0.25, end: index * 3 + 1.75 },
    crossModelRelation: "LEXICAL_DISAGREEMENT" as const,
    selectionReasons: ["synthetic-machine-only"],
    audioGroupId: `audio-group-${index}`,
    goldSeenAtSelection: false as const,
    semanticHash: machineQualitySemanticHash({ event: index }),
  }));
  const assignments = events.map((event, index) => ({
    eventId: event.eventId,
    audioGroupId: event.audioGroupId,
    fold: (Math.floor(index / 10) + 1) as 1 | 2 | 3 | 4 | 5,
    timeBlockStart: event.sourceInterval.start,
    timeBlockEnd: event.sourceInterval.end,
    semanticHash: machineQualitySemanticHash({ assignment: index }),
  }));
  const featureEvents = events.map((event, index) => {
    const positive = index % 4 === 0;
    return {
      eventId: event.eventId,
      role: event.role,
      featureValues: {
        predictiveMargin: positive
          ? 2 + (index % 3) / 10
          : -2 - (index % 3) / 10,
        sparseEvidence: index % 7 === 0 ? null : index / 50,
      },
      missingFeatures: index % 7 === 0 ? ["sparseEvidence"] : [],
      semanticHash: machineQualitySemanticHash({ feature: index }),
    };
  });
  const labelEvents = events.map((event, index) => {
    const positive = index % 4 === 0;
    const core = {
      eventId: event.eventId,
      label: positive
        ? ("REAZON_BETTER" as const)
        : ("WHISPER_BETTER" as const),
      whisperLocalError: positive ? 4 : 1,
      reazonLocalError: positive ? 1 : 4,
      localErrorDelta: positive ? 3 : -3,
      evaluationEvidenceIds: [`evaluation-${index}`],
    };
    return { ...core, semanticHash: machineQualitySemanticHash(core) };
  });
  return {
    corpus: {
      events,
      semanticHash: "b".repeat(64),
    } as unknown as MachineCrossModelCalibrationCorpus,
    features: {
      events: featureEvents,
      audit: {
        rawTextFeatureCount: 0,
        datasetSpecificFeatureCount: 0,
        eventIdSemanticFeatureCount: 0,
        goldFeatureCount: 0,
        fullDataImputationCount: 0,
        fullDataStandardizationCount: 0,
      },
      semanticHash: "c".repeat(64),
    } as unknown as MachineCrossModelDiscriminatorFeatures,
    folds: {
      assignments,
      semanticHash: "d".repeat(64),
    } as unknown as C60111CalibrationFolds,
    labels: {
      events: labelEvents,
      semanticHash: "e".repeat(64),
    } as unknown as GoldCrossModelCalibrationLabels,
  };
}

describe("C6.0.1.11 selective grouped cross-validation", () => {
  it("emits exactly one out-of-fold prediction per event with nested thresholds", () => {
    const inputs = syntheticInputs();
    const result = runSelectiveGroupedCrossValidation({
      generatedAt: GENERATED_AT,
      modelId: "M3",
      featureNames: ["predictiveMargin", "sparseEvidence"],
      ...inputs,
    });
    expect(result.cv.foldResults).toHaveLength(5);
    expect(result.cv.nestedThresholdCalibration).toBe(true);
    expect(result.cv.outerTestLabelsUsedForThreshold).toBe(false);
    expect(result.oof.inSamplePredictionCount).toBe(0);
    expect(result.oof.predictions).toHaveLength(50);
    expect(new Set(result.oof.predictions.map((row) => row.eventId)).size).toBe(
      50,
    );
    expect(
      result.oof.predictions.every(
        (row) =>
          inputs.folds.assignments.find((item) => item.eventId === row.eventId)
            ?.fold === row.fold,
      ),
    ).toBe(true);
  });

  it("calibrates safety-first thresholds by avoiding known harm before gain", () => {
    const threshold = selectSafetyFirstThreshold([
      { score: 0.9, label: "WHISPER_BETTER", localGain: -5 },
      { score: 0.8, label: "REAZON_BETTER", localGain: 8 },
      { score: 0.7, label: "REAZON_BETTER", localGain: 4 },
    ]);
    expect(threshold).toBe(1);
  });

  it("fits preprocessing on training data and scores missing values safely", () => {
    const model = trainSelectiveLogisticRegression({
      rows: [
        { eventId: "a", values: { signal: 1, sparse: null }, positive: true },
        { eventId: "b", values: { signal: -1, sparse: 100 }, positive: false },
      ],
      featureNames: ["signal", "sparse"],
    });
    expect(model.medians.sparse).toBe(100);
    expect(
      scoreSelectiveClassifier(model, { signal: 0.5, sparse: null }),
    ).toBeGreaterThanOrEqual(0);
    expect(
      scoreSelectiveClassifier(model, { signal: 0.5, sparse: null }),
    ).toBeLessThanOrEqual(1);
  });

  it("reports zero cross-fold audio overlap and zero forbidden features", () => {
    const inputs = syntheticInputs();
    const audit = auditC60111CalibrationData({
      generatedAt: GENERATED_AT,
      corpus: inputs.corpus,
      features: inputs.features,
      folds: inputs.folds,
    });
    expect(audit.passed).toBe(true);
    expect(audit.overlappingAudioAcrossTrainTestCount).toBe(0);
    expect(audit.rawTextFeatureCount).toBe(0);
    expect(audit.goldFeatureCount).toBe(0);
  });
});
