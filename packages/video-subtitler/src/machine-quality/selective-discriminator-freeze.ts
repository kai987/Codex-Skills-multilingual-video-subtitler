import {
  c60111PolicyVersion,
  c60111SelectiveDiscriminatorFreezeSchema,
  type C60111OutOfFoldPredictions,
  type C60111SelectiveDiscriminatorFreeze,
  type GoldCrossModelCalibrationLabels,
  type MachineCrossModelDiscriminatorFeatures,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";
import {
  trainSelectiveLogisticRegression,
  type SelectiveTrainingRow,
} from "./selective-provider-classifier.js";
import { selectSafetyFirstThreshold } from "./selective-threshold-calibration.js";

export function freezeC60111SelectiveDiscriminator(input: {
  generatedAt: string;
  modelId: "M0" | "M1" | "M2" | "M3" | "M4" | "M5";
  featureNames: readonly string[];
  features: MachineCrossModelDiscriminatorFeatures;
  labels: GoldCrossModelCalibrationLabels;
  oof: C60111OutOfFoldPredictions;
  strongCalibrationPass: boolean;
  promisingCalibration: boolean;
}): C60111SelectiveDiscriminatorFreeze {
  const shouldCreate =
    input.strongCalibrationPass || input.promisingCalibration;
  const labelsById = new Map(
    input.labels.events.map((event) => [event.eventId, event]),
  );
  const rows: SelectiveTrainingRow[] = input.features.events.flatMap(
    (event) => {
      const label = labelsById.get(event.eventId);
      return label === undefined || label.label === "UNEVALUABLE"
        ? []
        : [
            {
              eventId: event.eventId,
              values: event.featureValues,
              positive: label.label === "REAZON_BETTER",
            },
          ];
    },
  );
  const model = shouldCreate
    ? trainSelectiveLogisticRegression({
        rows,
        featureNames: input.featureNames,
      })
    : null;
  const threshold = shouldCreate
    ? selectSafetyFirstThreshold(
        input.oof.predictions.flatMap((prediction) =>
          prediction.label === "UNEVALUABLE"
            ? []
            : [
                {
                  score: prediction.score,
                  label: prediction.label,
                  localGain: prediction.localGain ?? 0,
                },
              ],
        ),
      )
    : null;
  const core = {
    schemaVersion: "1.0.0" as const,
    policyVersion: c60111PolicyVersion,
    generatedAt: input.generatedAt,
    artifactType: "c6-0-1-11-selective-discriminator-freeze" as const,
    created: shouldCreate,
    modelType: shouldCreate ? ("L2_LOGISTIC_REGRESSION" as const) : null,
    modelId: shouldCreate ? input.modelId : null,
    featureSchemaHash: input.features.featureSchemaHash,
    coefficients: model?.coefficients ?? {},
    intercept: model?.intercept ?? null,
    threshold,
    preprocessing: {
      medians: model?.medians ?? {},
      means: model?.means ?? {},
      scales: model?.scales ?? {},
    },
    productionEnforcementEnabled: false as const,
    trainedOnEpisode1CalibrationOnly: true as const,
  };
  return c60111SelectiveDiscriminatorFreezeSchema.parse({
    ...core,
    semanticHash: machineQualitySemanticHash({
      ...core,
      generatedAt: undefined,
    }),
  });
}
