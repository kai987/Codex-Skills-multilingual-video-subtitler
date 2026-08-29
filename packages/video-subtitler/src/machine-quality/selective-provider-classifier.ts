export interface SelectiveLinearModel {
  featureNames: string[];
  medians: Record<string, number>;
  means: Record<string, number>;
  scales: Record<string, number>;
  coefficients: Record<string, number>;
  intercept: number;
}

export interface SelectiveTrainingRow {
  eventId: string;
  values: Record<string, number | null>;
  positive: boolean;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function sigmoid(value: number): number {
  if (value >= 0) return 1 / (1 + Math.exp(-value));
  const exponential = Math.exp(value);
  return exponential / (1 + exponential);
}

function expandedFeatureNames(featureNames: readonly string[]): string[] {
  return featureNames.flatMap((name) => [name, `missing:${name}`]);
}

function preprocess(input: {
  rows: readonly SelectiveTrainingRow[];
  featureNames: readonly string[];
}): {
  medians: Record<string, number>;
  means: Record<string, number>;
  scales: Record<string, number>;
  vectors: number[][];
} {
  const medians = Object.fromEntries(
    input.featureNames.map((name) => [
      name,
      median(
        input.rows.flatMap((row) => {
          const value = row.values[name];
          return value === null ||
            value === undefined ||
            !Number.isFinite(value)
            ? []
            : [value];
        }),
      ),
    ]),
  );
  const rawVectors = input.rows.map((row) =>
    input.featureNames.flatMap((name) => {
      const value = row.values[name];
      const missing =
        value === null || value === undefined || !Number.isFinite(value);
      return [missing ? (medians[name] ?? 0) : value, missing ? 1 : 0];
    }),
  );
  const names = expandedFeatureNames(input.featureNames);
  const means = Object.fromEntries(
    names.map((name, index) => [
      name,
      rawVectors.length === 0
        ? 0
        : rawVectors.reduce((sum, vector) => sum + (vector[index] ?? 0), 0) /
          rawVectors.length,
    ]),
  );
  const scales = Object.fromEntries(
    names.map((name, index) => {
      const mean = means[name] ?? 0;
      const variance =
        rawVectors.length === 0
          ? 0
          : rawVectors.reduce(
              (sum, vector) => sum + ((vector[index] ?? 0) - mean) ** 2,
              0,
            ) / rawVectors.length;
      const scale = Math.sqrt(variance);
      return [name, scale < 1e-9 ? 1 : scale];
    }),
  );
  return {
    medians,
    means,
    scales,
    vectors: rawVectors.map((vector) =>
      vector.map((value, index) => {
        const name = names[index] ?? "";
        return (value - (means[name] ?? 0)) / (scales[name] ?? 1);
      }),
    ),
  };
}

export function trainSelectiveLogisticRegression(input: {
  rows: readonly SelectiveTrainingRow[];
  featureNames: readonly string[];
  l2?: number;
  iterations?: number;
  learningRate?: number;
}): SelectiveLinearModel {
  if (input.rows.length === 0) {
    throw new Error("Selective classifier requires at least one training row.");
  }
  const prepared = preprocess({
    rows: input.rows,
    featureNames: input.featureNames,
  });
  const names = expandedFeatureNames(input.featureNames);
  const coefficients = names.map(() => 0);
  const positiveCount = input.rows.filter((row) => row.positive).length;
  const negativeCount = input.rows.length - positiveCount;
  let intercept = Math.log((positiveCount + 0.5) / (negativeCount + 0.5));
  const positiveWeight = input.rows.length / Math.max(1, 2 * positiveCount);
  const negativeWeight = input.rows.length / Math.max(1, 2 * negativeCount);
  const l2 = input.l2 ?? 1;
  const iterations = input.iterations ?? 1_200;
  const learningRate = input.learningRate ?? 0.05;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const gradient = coefficients.map(() => 0);
    let interceptGradient = 0;
    for (const [rowIndex, row] of input.rows.entries()) {
      const vector = prepared.vectors[rowIndex] ?? [];
      const linear = coefficients.reduce(
        (sum, coefficient, index) => sum + coefficient * (vector[index] ?? 0),
        intercept,
      );
      const target = row.positive ? 1 : 0;
      const weight = row.positive ? positiveWeight : negativeWeight;
      const error = (sigmoid(linear) - target) * weight;
      interceptGradient += error;
      for (let index = 0; index < coefficients.length; index += 1) {
        gradient[index] = (gradient[index] ?? 0) + error * (vector[index] ?? 0);
      }
    }
    const divisor = input.rows.length;
    intercept -= (learningRate * interceptGradient) / divisor;
    for (let index = 0; index < coefficients.length; index += 1) {
      const coefficient = coefficients[index] ?? 0;
      coefficients[index] =
        coefficient -
        learningRate * ((gradient[index] ?? 0) / divisor + l2 * coefficient);
    }
  }
  return {
    featureNames: [...input.featureNames],
    medians: prepared.medians,
    means: prepared.means,
    scales: prepared.scales,
    coefficients: Object.fromEntries(
      names.map((name, index) => [name, coefficients[index] ?? 0]),
    ),
    intercept,
  };
}

export function scoreSelectiveClassifier(
  model: SelectiveLinearModel,
  values: Readonly<Record<string, number | null>>,
): number {
  let linear = model.intercept;
  for (const name of model.featureNames) {
    const value = values[name];
    const missing =
      value === null || value === undefined || !Number.isFinite(value);
    const imputed = missing ? (model.medians[name] ?? 0) : value;
    const standardized =
      (imputed - (model.means[name] ?? 0)) / (model.scales[name] ?? 1);
    linear += standardized * (model.coefficients[name] ?? 0);
    const missingName = `missing:${name}`;
    const missingStandardized =
      ((missing ? 1 : 0) - (model.means[missingName] ?? 0)) /
      (model.scales[missingName] ?? 1);
    linear += missingStandardized * (model.coefficients[missingName] ?? 0);
  }
  return sigmoid(linear);
}
