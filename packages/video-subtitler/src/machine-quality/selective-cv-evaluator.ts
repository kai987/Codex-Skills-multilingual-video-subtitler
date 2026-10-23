import {
  c60111CvResultsSchema,
  c60111OutOfFoldPredictionsSchema,
  c60111PolicyVersion,
  type C60111CalibrationFolds,
  type C60111CvResults,
  type C60111OutOfFoldPredictions,
  type GoldCrossModelCalibrationLabels,
  type MachineCrossModelCalibrationCorpus,
  type MachineCrossModelDiscriminatorFeatures,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";
import {
  scoreSelectiveClassifier,
  trainSelectiveLogisticRegression,
  type SelectiveTrainingRow,
} from "./selective-provider-classifier.js";
import { selectSafetyFirstThreshold } from "./selective-threshold-calibration.js";

type ModelId = "M0" | "M1" | "M2" | "M3" | "M4" | "M5";
type Label = GoldCrossModelCalibrationLabels["events"][number]["label"];

function wilson(
  successes: number,
  trials: number,
): [number | null, number | null] {
  if (trials === 0) return [null, null];
  const z = 1.959963984540054;
  const p = successes / trials;
  const denominator = 1 + (z * z) / trials;
  const center = (p + (z * z) / (2 * trials)) / denominator;
  const half =
    (z / denominator) *
    Math.sqrt((p * (1 - p)) / trials + (z * z) / (4 * trials * trials));
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

function evaluateMetrics(input: {
  predictions: readonly {
    selected: boolean;
    label: Label;
    localGain: number | null;
    eligibleDisagreement: boolean;
  }[];
}) {
  const selected = input.predictions.filter((value) => value.selected);
  const correct = selected.filter((value) => value.label === "REAZON_BETTER");
  const wrong = selected.filter((value) => value.label === "WHISPER_BETTER");
  const neutral = selected.filter(
    (value) => value.label === "EQUIVALENT" || value.label === "UNEVALUABLE",
  );
  const evaluableOverrideCount = correct.length + wrong.length;
  const eligibleDisagreementCount = input.predictions.filter(
    (value) => value.eligibleDisagreement,
  ).length;
  const availableOracleGain = input.predictions.reduce(
    (sum, value) => sum + Math.max(0, value.localGain ?? 0),
    0,
  );
  const realizedGain = selected.reduce(
    (sum, value) => sum + (value.localGain ?? 0),
    0,
  );
  return {
    selectedCount: selected.length,
    correctCount: correct.length,
    wrongCount: wrong.length,
    neutralCount: neutral.length,
    precision:
      evaluableOverrideCount === 0
        ? null
        : correct.length / evaluableOverrideCount,
    harmRate:
      evaluableOverrideCount === 0 ? 0 : wrong.length / evaluableOverrideCount,
    selectiveCoverage:
      eligibleDisagreementCount === 0
        ? 0
        : selected.filter((value) => value.eligibleDisagreement).length /
          eligibleDisagreementCount,
    realizedGain,
    availableOracleGain,
    oracleCaptureRate:
      availableOracleGain === 0 ? null : realizedGain / availableOracleGain,
  };
}

function calibrationRows(input: {
  trainFoldIds: readonly number[];
  featureNames: readonly string[];
  featuresById: ReadonlyMap<
    string,
    MachineCrossModelDiscriminatorFeatures["events"][number]
  >;
  labelsById: ReadonlyMap<
    string,
    GoldCrossModelCalibrationLabels["events"][number]
  >;
  foldById: ReadonlyMap<string, number>;
}): {
  score: number;
  label: "REAZON_BETTER" | "WHISPER_BETTER" | "EQUIVALENT";
  localGain: number;
}[] {
  const rows = [];
  for (const innerTestFold of input.trainFoldIds) {
    const innerTrain: SelectiveTrainingRow[] = [];
    for (const [eventId, fold] of input.foldById) {
      const label = input.labelsById.get(eventId);
      const feature = input.featuresById.get(eventId);
      if (
        fold === innerTestFold ||
        !input.trainFoldIds.includes(fold) ||
        label === undefined ||
        feature === undefined ||
        label.label === "UNEVALUABLE"
      ) {
        continue;
      }
      innerTrain.push({
        eventId,
        values: feature.featureValues,
        positive: label.label === "REAZON_BETTER",
      });
    }
    if (innerTrain.length === 0) continue;
    const model = trainSelectiveLogisticRegression({
      rows: innerTrain,
      featureNames: input.featureNames,
    });
    for (const [eventId, fold] of input.foldById) {
      if (fold !== innerTestFold) continue;
      const label = input.labelsById.get(eventId);
      const feature = input.featuresById.get(eventId);
      if (
        label === undefined ||
        feature === undefined ||
        label.label === "UNEVALUABLE"
      ) {
        continue;
      }
      rows.push({
        score: scoreSelectiveClassifier(model, feature.featureValues),
        label: label.label,
        localGain: label.localErrorDelta ?? 0,
      });
    }
  }
  return rows;
}

export function runSelectiveGroupedCrossValidation(input: {
  generatedAt: string;
  modelId: ModelId;
  featureNames: readonly string[];
  corpus: MachineCrossModelCalibrationCorpus;
  features: MachineCrossModelDiscriminatorFeatures;
  folds: C60111CalibrationFolds;
  labels: GoldCrossModelCalibrationLabels;
}): { cv: C60111CvResults; oof: C60111OutOfFoldPredictions } {
  const featuresById = new Map(
    input.features.events.map((event) => [event.eventId, event]),
  );
  const labelsById = new Map(
    input.labels.events.map((event) => [event.eventId, event]),
  );
  const corpusById = new Map(
    input.corpus.events.map((event) => [event.eventId, event]),
  );
  const foldById = new Map(
    input.folds.assignments.map((assignment) => [
      assignment.eventId,
      assignment.fold,
    ]),
  );
  const foldResults: C60111CvResults["foldResults"] = [];
  const predictions: C60111OutOfFoldPredictions["predictions"] = [];
  const coefficientSums = new Map<string, number>();
  for (let outerFold = 1; outerFold <= 5; outerFold += 1) {
    const trainFoldIds = [1, 2, 3, 4, 5].filter((fold) => fold !== outerFold);
    const trainRows: SelectiveTrainingRow[] = [];
    for (const [eventId, fold] of foldById) {
      const label = labelsById.get(eventId);
      const feature = featuresById.get(eventId);
      if (
        fold === outerFold ||
        label === undefined ||
        feature === undefined ||
        label.label === "UNEVALUABLE"
      ) {
        continue;
      }
      trainRows.push({
        eventId,
        values: feature.featureValues,
        positive: label.label === "REAZON_BETTER",
      });
    }
    const threshold = selectSafetyFirstThreshold(
      calibrationRows({
        trainFoldIds,
        featureNames: input.featureNames,
        featuresById,
        labelsById,
        foldById,
      }),
    );
    const model = trainSelectiveLogisticRegression({
      rows: trainRows,
      featureNames: input.featureNames,
    });
    for (const [name, coefficient] of Object.entries(model.coefficients)) {
      coefficientSums.set(name, (coefficientSums.get(name) ?? 0) + coefficient);
    }
    const foldPredictionInputs = [];
    for (const [eventId, fold] of foldById) {
      if (fold !== outerFold) continue;
      const feature = featuresById.get(eventId);
      const label = labelsById.get(eventId);
      const corpusEvent = corpusById.get(eventId);
      if (
        feature === undefined ||
        label === undefined ||
        corpusEvent === undefined
      ) {
        continue;
      }
      const score = scoreSelectiveClassifier(model, feature.featureValues);
      const selected = score >= threshold;
      const core = {
        eventId,
        fold: outerFold,
        score,
        threshold,
        decision: selected ? ("SELECT_REAZON" as const) : ("ABSTAIN" as const),
        label: label.label,
        localGain: label.localErrorDelta,
      };
      predictions.push({
        ...core,
        semanticHash: machineQualitySemanticHash(core),
      });
      foldPredictionInputs.push({
        selected,
        label: label.label,
        localGain: label.localErrorDelta,
        eligibleDisagreement: corpusEvent.role === "DISAGREEMENT",
      });
    }
    const metrics = evaluateMetrics({ predictions: foldPredictionInputs });
    const core = {
      fold: outerFold,
      trainCount: trainRows.length,
      testCount: foldPredictionInputs.length,
      threshold,
      metrics,
    };
    foldResults.push({
      ...core,
      semanticHash: machineQualitySemanticHash(core),
    });
  }
  const aggregateInputs = predictions.map((prediction) => ({
    selected: prediction.decision === "SELECT_REAZON",
    label: prediction.label,
    localGain: prediction.localGain,
    eligibleDisagreement:
      corpusById.get(prediction.eventId)?.role === "DISAGREEMENT",
  }));
  const metrics = evaluateMetrics({ predictions: aggregateInputs });
  const evaluableOverrideCount = metrics.correctCount + metrics.wrongCount;
  const [precisionWilsonLower, precisionWilsonUpper] = wilson(
    metrics.correctCount,
    evaluableOverrideCount,
  );
  const cvCore = {
    schemaVersion: "1.0.0" as const,
    policyVersion: c60111PolicyVersion,
    generatedAt: input.generatedAt,
    artifactType: "c6-0-1-11-cv-results" as const,
    modelId: input.modelId,
    modelType: "L2_LOGISTIC_REGRESSION" as const,
    featureSet: [...input.featureNames],
    nestedThresholdCalibration: true as const,
    outerTestLabelsUsedForThreshold: false as const,
    foldResults,
    aggregate: {
      ...metrics,
      precisionWilsonLower,
      precisionWilsonUpper,
      negativeGainFoldCount: foldResults.filter(
        (fold) => fold.metrics.realizedGain < 0,
      ).length,
      zeroHarmFoldCount: foldResults.filter(
        (fold) => fold.metrics.wrongCount === 0,
      ).length,
    },
    coefficients: Object.fromEntries(
      [...coefficientSums.entries()].map(([name, value]) => [name, value / 5]),
    ),
  };
  const cv = c60111CvResultsSchema.parse({
    ...cvCore,
    semanticHash: machineQualitySemanticHash({
      ...cvCore,
      generatedAt: undefined,
    }),
  });
  const oofCore = {
    schemaVersion: "1.0.0" as const,
    policyVersion: c60111PolicyVersion,
    generatedAt: input.generatedAt,
    artifactType: "c6-0-1-11-out-of-fold-predictions" as const,
    modelId: input.modelId,
    cvSemanticHash: cv.semanticHash,
    predictions,
    inSamplePredictionCount: 0 as const,
  };
  const oof = c60111OutOfFoldPredictionsSchema.parse({
    ...oofCore,
    semanticHash: machineQualitySemanticHash({
      ...oofCore,
      generatedAt: undefined,
    }),
  });
  return { cv, oof };
}
