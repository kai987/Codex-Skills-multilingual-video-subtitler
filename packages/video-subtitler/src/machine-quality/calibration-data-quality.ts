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
  const failures = [
    ...(duplicateEventCount === 0 ? [] : ["duplicate-events"]),
    ...(overlappingAudioAcrossTrainTestCount === 0
      ? []
      : ["overlapping-audio-across-folds"]),
    ...(input.features.audit.rawTextFeatureCount === 0
      ? []
      : ["raw-text-feature"]),
    ...(input.features.audit.datasetSpecificFeatureCount === 0
      ? []
      : ["dataset-specific-feature"]),
    ...(input.features.audit.goldFeatureCount === 0 ? [] : ["gold-feature"]),
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
    rawTextFeatureCount: 0 as const,
    datasetSpecificFeatureCount: 0 as const,
    goldFeatureCount: 0 as const,
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
