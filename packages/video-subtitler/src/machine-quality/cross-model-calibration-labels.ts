import {
  c60111PolicyVersion,
  goldCrossModelCalibrationLabelsSchema,
  type C60111CalibrationFolds,
  type GoldCrossModelCalibrationLabels,
  type MachineCrossModelCalibrationCorpus,
  type MachineCrossModelDiscriminatorFeatures,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";

export interface C60111GoldEvaluationView {
  goldIdentityHash: string;
  events: readonly {
    eventId: string;
    evaluationStatus: string;
    baselineWhisperPoolError: number | null;
    reazonCoreExactError: number | null;
    semanticHash: string;
  }[];
}

export function buildGoldCrossModelCalibrationLabels(input: {
  generatedAt: string;
  corpus: MachineCrossModelCalibrationCorpus;
  features: MachineCrossModelDiscriminatorFeatures;
  folds: C60111CalibrationFolds;
  goldEvaluation: C60111GoldEvaluationView;
}): GoldCrossModelCalibrationLabels {
  if (!input.features.featuresFrozenBeforeGold || !input.folds.constructedBeforeLabels) {
    throw new Error("Features and folds must be frozen before Gold labels.");
  }
  const goldByEvent = new Map(
    input.goldEvaluation.events.map((event) => [event.eventId, event]),
  );
  const events = input.corpus.events.map((event) => {
    const evaluation = goldByEvent.get(event.eventId);
    const whisperError = evaluation?.baselineWhisperPoolError ?? null;
    const reazonError = evaluation?.reazonCoreExactError ?? null;
    const evaluable =
      evaluation?.evaluationStatus === "EVALUABLE_LOCAL" &&
      whisperError !== null &&
      reazonError !== null;
    const label = !evaluable
      ? ("UNEVALUABLE" as const)
      : reazonError < whisperError
        ? ("REAZON_BETTER" as const)
        : whisperError < reazonError
          ? ("WHISPER_BETTER" as const)
          : ("EQUIVALENT" as const);
    const localErrorDelta =
      whisperError === null || reazonError === null
        ? null
        : whisperError - reazonError;
    const core = {
      eventId: event.eventId,
      label,
      whisperLocalError: whisperError,
      reazonLocalError: reazonError,
      localErrorDelta,
      evaluationEvidenceIds:
        evaluation === undefined ? [] : [evaluation.semanticHash],
    };
    return { ...core, semanticHash: machineQualitySemanticHash(core) };
  });
  const core = {
    schemaVersion: "1.0.0" as const,
    policyVersion: c60111PolicyVersion,
    generatedAt: input.generatedAt,
    artifactType: "gold-cross-model-calibration-labels" as const,
    datasetRole: "CALIBRATION_DATASET" as const,
    featureFreezeSemanticHash: input.features.semanticHash,
    foldFreezeSemanticHash: input.folds.semanticHash,
    goldIdentityHash: input.goldEvaluation.goldIdentityHash,
    fullGoldTextIncluded: false as const,
    events,
    summary: {
      reazonBetterCount: events.filter((event) => event.label === "REAZON_BETTER")
        .length,
      whisperBetterCount: events.filter(
        (event) => event.label === "WHISPER_BETTER",
      ).length,
      equivalentCount: events.filter((event) => event.label === "EQUIVALENT")
        .length,
      unevaluableCount: events.filter((event) => event.label === "UNEVALUABLE")
        .length,
      availableOracleGain: events.reduce(
        (sum, event) => sum + Math.max(0, event.localErrorDelta ?? 0),
        0,
      ),
    },
  };
  return goldCrossModelCalibrationLabelsSchema.parse({
    ...core,
    semanticHash: machineQualitySemanticHash({ ...core, generatedAt: undefined }),
  });
}

