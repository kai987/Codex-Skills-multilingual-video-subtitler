import {
  c60111PolicyVersion,
  c60111RouteDecisionSchema,
  type C60111CvResults,
  type C60111DataQualityAudit,
  type C60111RouteDecision,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";

export function decideC60111Route(input: {
  generatedAt: string;
  bestCv: C60111CvResults;
  pairedWhisperCoverage: number;
  independentVerifierEngineeringValid: boolean;
  independentScorableCoverage: number;
  evaluableDisagreementCount: number;
  dataQuality: C60111DataQualityAudit;
}): C60111RouteDecision {
  const minimumSelected = Math.max(
    5,
    Math.ceil(input.evaluableDisagreementCount * 0.05),
  );
  const positiveOrSafeZeroFoldCount = input.bestCv.foldResults.filter(
    (fold) =>
      fold.metrics.realizedGain > 0 ||
      (fold.metrics.realizedGain === 0 && fold.metrics.wrongCount === 0),
  ).length;
  const strongCalibrationPass =
    input.pairedWhisperCoverage >= 0.9 &&
    input.independentVerifierEngineeringValid &&
    input.bestCv.aggregate.selectedCount >= minimumSelected &&
    input.bestCv.aggregate.wrongCount === 0 &&
    input.bestCv.aggregate.realizedGain > 0 &&
    input.bestCv.aggregate.negativeGainFoldCount === 0 &&
    positiveOrSafeZeroFoldCount >= 4 &&
    (input.bestCv.aggregate.precision ?? 0) >= 0.95 &&
    input.dataQuality.passed;
  const promisingSignal =
    input.independentVerifierEngineeringValid &&
    input.dataQuality.passed &&
    (input.bestCv.aggregate.precision ?? 0) >= 0.9 &&
    input.bestCv.aggregate.harmRate <= 0.1 &&
    input.bestCv.aggregate.realizedGain > 0;
  const promisingCalibration = !strongCalibrationPass && promisingSignal;
  let decision: C60111RouteDecision["decision"];
  let nextStage: C60111RouteDecision["nextStage"];
  if (strongCalibrationPass) {
    decision = "GO_C6_0_1_12_PROSPECTIVE_DISCRIMINATOR_ARBITRATION";
    nextStage = "PROSPECTIVE_FROZEN_OBSERVE_ONLY";
  } else if (promisingCalibration) {
    decision = "SELECTIVE_CALIBRATION_PROMISING_BUT_NOT_PROVEN";
    nextStage = "ADD_INDEPENDENT_EPISODE_CALIBRATION_DATA";
  } else if (!input.independentVerifierEngineeringValid) {
    decision = "HOLD_FOR_INDEPENDENT_VERIFIER_REDESIGN";
    nextStage = "REDESIGN_INDEPENDENT_VERIFIER";
  } else if (input.independentScorableCoverage < 0.5) {
    decision = "INDEPENDENT_VERIFIER_NOT_USEFUL";
    nextStage = "MULTI_ASR_REVIEW_ASSISTANCE";
  } else {
    decision = "AUTOMATIC_PROVIDER_SELECTION_NOT_SUPPORTED";
    nextStage = "MULTI_ASR_REVIEW_ASSISTANCE";
  }
  const reasons = [
    `paired-whisper-coverage=${input.pairedWhisperCoverage.toFixed(6)}`,
    `independent-engineering-valid=${String(input.independentVerifierEngineeringValid)}`,
    `selected=${input.bestCv.aggregate.selectedCount};minimum=${minimumSelected}`,
    `wrong=${input.bestCv.aggregate.wrongCount}`,
    `realized-gain=${input.bestCv.aggregate.realizedGain}`,
    `negative-gain-folds=${input.bestCv.aggregate.negativeGainFoldCount}`,
    `positive-or-safe-zero-folds=${positiveOrSafeZeroFoldCount}`,
    `precision=${String(input.bestCv.aggregate.precision)}`,
    `data-quality=${String(input.dataQuality.passed)}`,
  ];
  const core = {
    schemaVersion: "1.0.0" as const,
    policyVersion: c60111PolicyVersion,
    generatedAt: input.generatedAt,
    artifactType: "c6-0-1-11-route-decision" as const,
    decision,
    automaticProviderSelectionSupported: strongCalibrationPass,
    strongCalibrationPass,
    promisingCalibration,
    stopAutomaticProviderSwitchExpansion:
      !strongCalibrationPass && !promisingCalibration,
    nextStage,
    reasons,
    productionProfile: "DISABLED" as const,
    productionStatus: "needs-review" as const,
    finalizationMethod: "none" as const,
    machineOnlyReleaseAuthorized: false as const,
    c602Status: "HOLD" as const,
  };
  return c60111RouteDecisionSchema.parse({
    ...core,
    semanticHash: machineQualitySemanticHash({
      ...core,
      generatedAt: undefined,
    }),
  });
}
