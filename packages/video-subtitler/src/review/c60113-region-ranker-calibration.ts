import {
  c60113FeatureNames,
  c60113RegionLabelsSchema,
  c60113RankerOofSchema,
  c60113DataQualityAuditSchema,
  type C60113DataQualityAudit,
  type C60113RankerFolds,
  type C60113RankerMachineFreeze,
  type C60113RankerOof,
  type C60113RegionFeatures,
  type C60113RegionLabels,
} from "@mvl/shared";
import type { C60112ReviewQualityEvaluation } from "./c60112-review-quality-evaluator.js";
import { assertC60113MachineFreeze } from "./c60113-region-ranker-folds.js";
import {
  C60113_CALIBRATION_POLICY,
  c60113Hash,
  c60113HashPayload,
  c60113IntersectionSeconds,
  c60113Require,
  type C60113Interval,
} from "./c60113-region-features.js";

const majorLabels = new Set([
  "MATERIAL_TEXT_ERROR",
  "SEVERE_TIMING_ERROR",
  "HALLUCINATION",
  "MISSING_DIALOGUE",
]);
type Model = C60113RankerOof["models"][number]["model"];
type FeatureRow = C60113RegionFeatures["regions"][number];

/** Reuses C6.0.1.12 unique defect/component lineage. No new Gold text algorithm. */
export function buildC60113RegionLabels(input: {
  features: C60113RegionFeatures;
  folds: C60113RankerFolds;
  machineFreeze: C60113RankerMachineFreeze;
  qualityEvaluation: Pick<
    C60112ReviewQualityEvaluation,
    "errorComponents" | "semanticHash"
  >;
  errorIntervals?: Record<string, C60113Interval>;
  generatedAt: string;
}): C60113RegionLabels {
  assertC60113MachineFreeze(input);
  if (
    Date.parse(input.generatedAt) < Date.parse(input.machineFreeze.generatedAt)
  )
    throw new Error("GOLD_LABELS_PRECEDE_MACHINE_FREEZE");
  if (
    new Set(
      input.qualityEvaluation.errorComponents.map(
        (component) => component.errorComponentId,
      ),
    ).size !== input.qualityEvaluation.errorComponents.length
  )
    throw new Error("DUPLICATE_GOLD_ERROR_COMPONENT_ID");
  const components: C60113RegionLabels["errorComponents"] =
    input.qualityEvaluation.errorComponents.map((component) => {
      const sourceInterval =
        input.errorIntervals?.[component.errorComponentId] ?? null;
      const covered = input.features.regions.filter((row) =>
        row.itemIds.some((id) => component.coveredReviewItemIds.includes(id)),
      );
      // Uncovered components remain in the denominator. Context playback is not assumed to produce a decision.
      const foldScores = input.folds.folds
        .map((fold) => ({
          foldId: fold.foldId,
          overlap: sourceInterval
            ? fold.audioIntervalUnion.reduce(
                (sum, interval) =>
                  sum + c60113IntersectionSeconds(sourceInterval, interval),
                0,
              )
            : fold.regionIds.filter((id) =>
                covered.some((row) => row.regionId === id),
              ).length,
        }))
        .sort(
          (a, b) => b.overlap - a.overlap || a.foldId.localeCompare(b.foldId),
        );
      let foldId =
        foldScores[0] && foldScores[0].overlap > 0
          ? foldScores[0].foldId
          : null;
      if (foldId === null && sourceInterval && input.folds.folds.length) {
        // No review region at this error: assign to the nearest frozen temporal block, never drop the error.
        const midpoint = (sourceInterval.start + sourceInterval.end) / 2;
        const nearest = [...input.folds.folds].sort((a, b) => {
          const distance = (fold: typeof a) =>
            Math.min(
              ...fold.timelineRanges.map((range) =>
                midpoint < range.start
                  ? range.start - midpoint
                  : midpoint > range.end
                    ? midpoint - range.end
                    : 0,
              ),
            );
          return distance(a) - distance(b) || a.foldId.localeCompare(b.foldId);
        })[0];
        foldId = nearest?.foldId ?? null;
      }
      return {
        errorComponentId: component.errorComponentId,
        labels: [...component.labels],
        coveredRegionIds: covered.map((row) => row.regionId).sort(),
        coveredItemIds: [...component.coveredReviewItemIds].sort(),
        sourceInterval,
        foldId,
      };
    });
  const regions = input.features.regions.map((row) => {
    const relevant = components.filter((component) =>
      component.coveredRegionIds.includes(row.regionId),
    );
    const labels: C60113RegionLabels["regions"][number]["labels"] = [
      ...new Set(relevant.flatMap((component) => component.labels)),
    ].sort();
    return {
      regionId: row.regionId,
      labels: labels.length ? labels : ["CLEAN_OR_MINOR" as const],
      errorComponentIds: relevant
        .map((component) => component.errorComponentId)
        .sort(),
      majorError: labels.some((label) => majorLabels.has(label)),
    };
  });
  const payload = {
    schemaVersion: "1.0.0" as const,
    policyVersion: C60113_CALIBRATION_POLICY,
    artifactType: "gold-review-region-labels" as const,
    use: "EVALUATION_CALIBRATION_ONLY" as const,
    datasetRole: "REVIEW_RANKER_CALIBRATION_DATASET" as const,
    machineFreezeHash: input.machineFreeze.semanticHash,
    machineFeaturesHash: input.features.semanticHash,
    foldsHash: input.folds.semanticHash,
    sourceEvaluationHash: input.qualityEvaluation.semanticHash,
    regions,
    errorComponents: components,
    unassignedErrorComponentCount: components.filter(
      (component) => component.foldId === null,
    ).length,
  };
  return c60113RegionLabelsSchema.parse({
    ...payload,
    generatedAt: input.generatedAt,
    semanticHash: c60113Hash(payload),
  });
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? c60113Require(sorted[mid])
    : (c60113Require(sorted[mid - 1]) + c60113Require(sorted[mid])) / 2;
};
const sigmoid = (value: number): number =>
  value >= 0
    ? 1 / (1 + Math.exp(-value))
    : Math.exp(value) / (1 + Math.exp(value));
const encoded = (row: FeatureRow, medians: number[]): number[] =>
  c60113FeatureNames.flatMap((name, index) => {
    const cell = row.values[name];
    return [
      cell.status === "OBSERVED" ? cell.value : c60113Require(medians[index]),
      cell.status === "UNKNOWN" ? 1 : 0,
      cell.status === "UNAVAILABLE" ? 1 : 0,
    ];
  });

/** All learned preprocessing is fit only on the explicitly supplied training rows. */
export function fitC60113LinearRanker(
  rows: readonly FeatureRow[],
  positiveIds: ReadonlySet<string>,
): Model {
  const medians = c60113FeatureNames.map((name) =>
    median(
      rows.flatMap((row) =>
        row.values[name].status === "OBSERVED" ? [row.values[name].value] : [],
      ),
    ),
  );
  const raw = rows.map((row) => encoded(row, medians));
  const dimensions = c60113FeatureNames.length * 3;
  const means = Array.from({ length: dimensions }, (_, index) =>
    raw.length
      ? raw.reduce((sum, row) => sum + c60113Require(row[index]), 0) /
        raw.length
      : 0,
  );
  const scales = means.map((mean, index) =>
    Math.max(
      1e-9,
      raw.length
        ? Math.sqrt(
            raw.reduce(
              (sum, row) => sum + (c60113Require(row[index]) - mean) ** 2,
              0,
            ) / raw.length,
          )
        : 1,
    ),
  );
  const data = raw.map((row) =>
    row.map(
      (value, index) =>
        (value - c60113Require(means[index])) / c60113Require(scales[index]),
    ),
  );
  const positives = rows.filter((row) => positiveIds.has(row.regionId)).length;
  const negatives = rows.length - positives;
  const positiveClassWeight =
    positives && negatives ? rows.length / (2 * positives) : 1;
  const negativeClassWeight =
    positives && negatives ? rows.length / (2 * negatives) : 1;
  const coefficients = Array<number>(dimensions).fill(0);
  let intercept = Math.log((positives + 1) / (negatives + 1));
  const l2 = 1;
  const iterations = positives && negatives ? 600 : 0;
  for (let iteration = 0; iteration < iterations; iteration++) {
    const gradient = coefficients.map((coefficient) => l2 * coefficient);
    let interceptGradient = 0;
    data.forEach((row, index) => {
      const positive = positiveIds.has(c60113Require(rows[index]).regionId);
      const prediction = sigmoid(
        intercept +
          coefficients.reduce(
            (sum, coefficient, j) => sum + coefficient * c60113Require(row[j]),
            0,
          ),
      );
      const error =
        (prediction - (positive ? 1 : 0)) *
        (positive ? positiveClassWeight : negativeClassWeight);
      interceptGradient += error / data.length;
      row.forEach((value, j) => {
        gradient[j] =
          c60113Require(gradient[j]) + (error * value) / data.length;
      });
    });
    const learningRate = 0.04 / Math.sqrt(1 + iteration / 100);
    coefficients.forEach((coefficient, j) => {
      coefficients[j] = coefficient - learningRate * c60113Require(gradient[j]);
    });
    intercept -= learningRate * interceptGradient;
  }
  return {
    modelType: "L2_LOGISTIC_REGRESSION",
    preprocessing: {
      featureNames: c60113FeatureNames.flatMap((name) => [
        name,
        `${name}__unknown`,
        `${name}__unavailable`,
      ]),
      medians,
      means,
      scales,
      fittedRegionIds: rows.map((row) => row.regionId).sort(),
      missingValueEncoding:
        "MEDIAN_PLUS_SEPARATE_UNKNOWN_UNAVAILABLE_INDICATORS",
    },
    coefficients,
    intercept,
    positiveClassWeight,
    negativeClassWeight,
    l2,
    iterations,
    classificationThreshold: 0.5,
    trainingStatus: !rows.length
      ? "NO_TRAINING_DATA"
      : !positives || !negatives
        ? "SINGLE_CLASS_CONSTANT"
        : "FITTED",
  };
}

export function predictC60113LinearRanker(
  model: {
    preprocessing: Pick<Model["preprocessing"], "medians" | "means" | "scales">;
    intercept: number;
    coefficients: number[];
  },
  row: FeatureRow,
): number {
  const values = encoded(row, model.preprocessing.medians).map(
    (value, i) =>
      (value - c60113Require(model.preprocessing.means[i])) /
      c60113Require(model.preprocessing.scales[i]),
  );
  return sigmoid(
    model.intercept +
      values.reduce(
        (sum, value, i) => sum + value * c60113Require(model.coefficients[i]),
        0,
      ),
  );
}

export function assertC60113LabelFreeze(input: {
  features: C60113RegionFeatures;
  folds: C60113RankerFolds;
  machineFreeze: C60113RankerMachineFreeze;
  labels: C60113RegionLabels;
}): void {
  assertC60113MachineFreeze(input);
  c60113RegionLabelsSchema.parse(input.labels);
  if (
    input.labels.machineFreezeHash !== input.machineFreeze.semanticHash ||
    input.labels.machineFeaturesHash !== input.features.semanticHash ||
    input.labels.foldsHash !== input.folds.semanticHash ||
    c60113HashPayload(input.labels) !== input.labels.semanticHash ||
    Date.parse(input.labels.generatedAt) <
      Date.parse(input.machineFreeze.generatedAt)
  )
    throw new Error("GOLD_LABELS_FREEZE_MISMATCH");
}

export function trainC60113OofRanker(input: {
  features: C60113RegionFeatures;
  folds: C60113RankerFolds;
  machineFreeze: C60113RankerMachineFreeze;
  labels: C60113RegionLabels;
  generatedAt: string;
}): C60113RankerOof {
  assertC60113LabelFreeze(input);
  const positives = new Set(
    input.labels.regions
      .filter((row) => row.majorError)
      .map((row) => row.regionId),
  );
  const models = input.folds.folds.map((fold) => {
    const train = input.features.regions.filter(
      (row) => !fold.regionIds.includes(row.regionId),
    );
    return {
      outerFold: fold.foldId,
      trainRegionIds: train.map((row) => row.regionId).sort(),
      testRegionIds: [...fold.regionIds].sort(),
      model: fitC60113LinearRanker(train, positives),
    };
  });
  const scores = input.features.regions
    .map((row) => {
      const model = models.find((candidate) =>
        candidate.testRegionIds.includes(row.regionId),
      );
      if (!model || model.trainRegionIds.includes(row.regionId))
        throw new Error("OOF_REGION_TRAIN_TEST_LEAKAGE");
      return { row, model, score: predictC60113LinearRanker(model.model, row) };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.row.sourceInterval.start - b.row.sourceInterval.start ||
        a.row.regionId.localeCompare(b.row.regionId),
    );
  const predictions = scores.map(({ row, model, score }, index) => {
    const payload = {
      regionId: row.regionId,
      outerFold: model.outerFold,
      modelType: "L2_LOGISTIC_REGRESSION" as const,
      machineFeaturesHash: input.features.semanticHash,
      rankingScore: score,
      rank: index + 1,
      selectedAtBudgets: [] as string[],
    };
    return { ...payload, semanticHash: c60113Hash(payload) };
  });
  const payload = {
    schemaVersion: "1.0.0" as const,
    policyVersion: C60113_CALIBRATION_POLICY,
    artifactType: "c6-0-1-13-review-ranker-oof" as const,
    machineFreezeHash: input.machineFreeze.semanticHash,
    machineFeaturesHash: input.features.semanticHash,
    foldsHash: input.folds.semanticHash,
    labelsHash: input.labels.semanticHash,
    scoreMeaning: "RANKING_SCORE_NOT_CALIBRATED_PROBABILITY" as const,
    predictions,
    models,
    formalMetricsOofOnly: true as const,
  };
  return c60113RankerOofSchema.parse({
    ...payload,
    generatedAt: input.generatedAt,
    semanticHash: c60113Hash(payload),
  });
}

export function auditC60113CalibrationData(input: {
  features: C60113RegionFeatures;
  folds: C60113RankerFolds;
  machineFreeze: C60113RankerMachineFreeze;
  labels: C60113RegionLabels;
  oof: C60113RankerOof;
  generatedAt: string;
}): C60113DataQualityAudit {
  assertC60113LabelFreeze(input);
  const duplicateRegions =
    input.features.regions.length -
    new Set(input.features.regions.map((row) => row.regionId)).size;
  const duplicateComponents =
    input.labels.errorComponents.length -
    new Set(input.labels.errorComponents.map((row) => row.errorComponentId))
      .size;
  const preprocessingLeak = input.oof.models.filter((record) =>
    record.testRegionIds.some((id) =>
      record.model.preprocessing.fittedRegionIds.includes(id),
    ),
  ).length;
  const coverageErrors = input.features.regions.filter(
    (row) =>
      input.oof.predictions.filter(
        (prediction) => prediction.regionId === row.regionId,
      ).length !== 1,
  ).length;
  const checks = [
    { checkId: "NO_DUPLICATE_REGION_IDS", count: duplicateRegions },
    { checkId: "UNIQUE_ERROR_COMPONENT_IDS", count: duplicateComponents },
    {
      checkId: "NO_CROSS_FOLD_AUDIO_LEAKAGE",
      count: input.folds.crossFoldAudioOverlapCount,
    },
    { checkId: "TRAIN_ONLY_PREPROCESSING", count: preprocessingLeak },
    { checkId: "EXACTLY_ONE_OOF_PREDICTION_PER_REGION", count: coverageErrors },
    {
      checkId: "RAW_TEXT_PREDICTORS_EXCLUDED",
      count: input.features.rawTextFeatureCount,
    },
    {
      checkId: "GOLD_MACHINE_FEATURES_EXCLUDED",
      count: input.features.goldInputCount,
    },
    {
      checkId: "ABSOLUTE_SOURCE_TIME_PREDICTORS_EXCLUDED",
      count: input.features.absoluteTimePredictorCount,
    },
    {
      checkId: "IDENTITY_PREDICTORS_EXCLUDED",
      count: input.features.identityPredictorCount,
    },
    {
      checkId: "ALL_ERROR_COMPONENTS_ASSIGNED_TO_FROZEN_TEMPORAL_FOLD",
      count: input.labels.unassignedErrorComponentCount,
    },
  ].map((check) => ({ ...check, passed: check.count === 0 }));
  const featureAvailability = c60113FeatureNames.map((featureName) => ({
    featureName,
    observedCount: input.features.regions.filter(
      (row) => row.values[featureName].status === "OBSERVED",
    ).length,
    trueZeroCount: input.features.regions.filter(
      (row) =>
        row.values[featureName].status === "OBSERVED" &&
        row.values[featureName].value === 0,
    ).length,
    unknownCount: input.features.regions.filter(
      (row) => row.values[featureName].status === "UNKNOWN",
    ).length,
    unavailableCount: input.features.regions.filter(
      (row) => row.values[featureName].status === "UNAVAILABLE",
    ).length,
  }));
  const foldClassBalance = input.folds.folds.map((fold) => {
    const positiveCount = input.labels.regions.filter(
      (row) => row.majorError && fold.regionIds.includes(row.regionId),
    ).length;
    return {
      foldId: fold.foldId,
      positiveCount,
      negativeCount: fold.regionIds.length - positiveCount,
      noMajorPositive: positiveCount === 0,
    };
  });
  const payload = {
    schemaVersion: "1.0.0" as const,
    policyVersion: C60113_CALIBRATION_POLICY,
    artifactType: "c6-0-1-13-data-quality-audit" as const,
    machineFeaturesHash: input.features.semanticHash,
    foldsHash: input.folds.semanticHash,
    labelsHash: input.labels.semanticHash,
    checks,
    featureAvailability,
    foldClassBalance,
    passed: checks.every((check) => check.passed),
  };
  return c60113DataQualityAuditSchema.parse({
    ...payload,
    generatedAt: input.generatedAt,
    semanticHash: c60113Hash(payload),
  });
}
