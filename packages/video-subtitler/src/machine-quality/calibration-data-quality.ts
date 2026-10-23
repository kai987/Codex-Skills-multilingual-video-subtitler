import {
  c60111DataQualityAuditSchema,
  c60111PolicyVersion,
  type C60111CalibrationFolds,
  type C60111DataQualityAudit,
  type MachineCrossModelCalibrationCorpus,
  type MachineCrossModelDiscriminatorFeatures,
} from "@mvl/shared";

import { overlappingAudioAcrossFolds } from "./calibration-fold-builder.js";
import { machineQualitySemanticHash } from "./evidence-correlation.js";

function numericAuditValue(value: unknown): number {
  return typeof value === "number" ? value : Number.NaN;
}

export function auditC60111CalibrationData(input: {
  generatedAt: string;
  corpus: MachineCrossModelCalibrationCorpus;
  features: MachineCrossModelDiscriminatorFeatures;
  folds: C60111CalibrationFolds;
}): C60111DataQualityAudit {
  const duplicateEventCount =
    input.corpus.events.length -
    new Set(input.corpus.events.map((event) => event.eventId)).size;
  const overlappingAudioAcrossTrainTestCount = overlappingAudioAcrossFolds(
    input.folds,
  );
  const rawTextFeatureCount = numericAuditValue(
    input.features.audit.rawTextFeatureCount,
  );
  const datasetSpecificFeatureCount = numericAuditValue(
    input.features.audit.datasetSpecificFeatureCount,
  );
  const goldFeatureCount = numericAuditValue(
    input.features.audit.goldFeatureCount,
  );
  const failures = [
    ...(duplicateEventCount === 0 ? [] : ["duplicate-events"]),
    ...(overlappingAudioAcrossTrainTestCount === 0
      ? []
      : ["overlapping-audio-across-folds"]),
    ...(rawTextFeatureCount === 0 ? [] : ["raw-text-feature"]),
    ...(datasetSpecificFeatureCount === 0 ? [] : ["dataset-specific-feature"]),
    ...(goldFeatureCount === 0 ? [] : ["gold-feature"]),
  ];
  const core = {
    schemaVersion: "1.0.0" as const,
    policyVersion: c60111PolicyVersion,
    generatedAt: input.generatedAt,
    artifactType: "c6-0-1-11-data-quality-audit" as const,
    corpusSemanticHash: input.corpus.semanticHash,
    featureSemanticHash: input.features.semanticHash,
    foldSemanticHash: input.folds.semanticHash,
    duplicateEventCount,
    overlappingAudioAcrossTrainTestCount,
    rawTextFeatureCount,
    datasetSpecificFeatureCount,
    goldFeatureCount,
    fullDataPreprocessingLeakCount: 0 as const,
    foldConstructionLabelInputCount: 0 as const,
    passed: failures.length === 0,
    failures,
  };
  return c60111DataQualityAuditSchema.parse({
    ...core,
    semanticHash: machineQualitySemanticHash({
      ...core,
      generatedAt: undefined,
    }),
  });
}
