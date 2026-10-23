import {
  c6019PolicyVersion,
  c6019RouteDecisionSchema,
  type C6019RouteDecision,
  type GoldCrossModelComplementarityEvaluation,
  type GoldSecondAsrControlRegression,
  type MachineCrossModelUnionOracleEvaluation,
  type MachineSecondAsrStability,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";

export function buildC6019RouteDecision(input: {
  generatedAt: string;
  complementarity: GoldCrossModelComplementarityEvaluation;
  oracle: MachineCrossModelUnionOracleEvaluation;
  controls: GoldSecondAsrControlRegression;
  stability: MachineSecondAsrStability;
}): C6019RouteDecision {
  const evidenceSufficient =
    input.complementarity.summary.targetEvaluableCount >= 10 &&
    input.controls.summary.controlEvaluableCount >= 9;
  const independentGain =
    input.complementarity.summary.reazonOnlyBetterCount +
    input.complementarity.summary.reazonOnlyCorrectCount;
  const meaningfulOracleGain =
    input.oracle.summary.absoluteGain > 0 &&
    input.oracle.summary.improvedEventCount >= 2 &&
    input.oracle.summary.relativeGain >= 0.05;
  const catastrophicControlPattern =
    input.controls.summary.reazonHallucinationCount +
      input.controls.summary.reazonEmptyCount >=
      4 || input.controls.summary.blindReazonRegressionCount >= 9;
  const tooUnstable =
    input.stability.summary.lexicallyUnstableCount +
      input.stability.summary.hallucinationUnstableCount >=
      14 && !meaningfulOracleGain;
  let complementarityResult: C6019RouteDecision["complementarityResult"];
  if (!evidenceSufficient)
    complementarityResult = "INSUFFICIENT_SECOND_ASR_EVIDENCE";
  else if (tooUnstable) complementarityResult = "SECOND_ASR_TOO_UNSTABLE";
  else if (
    independentGain >= 2 &&
    meaningfulOracleGain &&
    !catastrophicControlPattern
  ) {
    complementarityResult = "SECOND_ASR_COMPLEMENTARITY_CONFIRMED";
  } else if (independentGain > 0 || input.oracle.summary.absoluteGain > 0) {
    complementarityResult = "SECOND_ASR_COMPLEMENTARITY_WEAK";
  } else complementarityResult = "SECOND_ASR_NOT_USEFUL";
  const routeDecision =
    complementarityResult === "SECOND_ASR_COMPLEMENTARITY_CONFIRMED"
      ? ("GO_C6_0_1_10_CROSS_MODEL_ARBITRATION" as const)
      : complementarityResult === "SECOND_ASR_COMPLEMENTARITY_WEAK"
        ? ("HOLD_FOR_SECOND_ASR_SELECTION_DECISION" as const)
        : complementarityResult === "INSUFFICIENT_SECOND_ASR_EVIDENCE"
          ? ("INSUFFICIENT_SECOND_ASR_EVIDENCE" as const)
          : ("REJECT_REAZONSPEECH_K2_AS_ENSEMBLE_MEMBER" as const);
  const reasons = [
    `target-evaluable:${input.complementarity.summary.targetEvaluableCount}`,
    `control-evaluable:${input.controls.summary.controlEvaluableCount}`,
    `independent-better-or-correct:${independentGain}`,
    `union-absolute-gain:${input.oracle.summary.absoluteGain}`,
    `union-relative-gain:${input.oracle.summary.relativeGain.toFixed(6)}`,
    `union-improved-events:${input.oracle.summary.improvedEventCount}`,
    `control-blind-regressions:${input.controls.summary.blindReazonRegressionCount}`,
    `second-asr-stability-rate:${input.stability.summary.stableRate.toFixed(6)}`,
  ];
  const blockers = [
    ...(!evidenceSufficient ? ["local-evaluation-coverage-insufficient"] : []),
    ...(catastrophicControlPattern
      ? ["control-regression-or-failure-pattern"]
      : []),
    ...(tooUnstable
      ? ["core-context-lexical-instability-too-high-for-observed-gain"]
      : []),
  ];
  const core = {
    schemaVersion: "1.0.0" as const,
    policyVersion: c6019PolicyVersion,
    generatedAt: input.generatedAt,
    artifactType: "c6-0-1-9-route-decision" as const,
    complementarityResult,
    routeDecision,
    confidence:
      evidenceSufficient &&
      input.complementarity.summary.targetEvaluableCount === 12
        ? ("HIGH" as const)
        : evidenceSufficient
          ? ("MEDIUM" as const)
          : ("LOW" as const),
    supportingMetrics: {
      targetEvaluableCount: input.complementarity.summary.targetEvaluableCount,
      targetBaselineWrongCount:
        input.complementarity.summary.targetBaselineWrongCount,
      reazonOnlyBetterCount:
        input.complementarity.summary.reazonOnlyBetterCount,
      reazonOnlyCorrectCount:
        input.complementarity.summary.reazonOnlyCorrectCount,
      unionOracleAbsoluteGain: input.oracle.summary.absoluteGain,
      unionOracleRelativeGain: input.oracle.summary.relativeGain,
      unionOracleImprovedEventCount: input.oracle.summary.improvedEventCount,
      complementarityRate: input.oracle.summary.complementarityRate,
      controlEvaluableCount: input.controls.summary.controlEvaluableCount,
      blindReazonRegressionCount:
        input.controls.summary.blindReazonRegressionCount,
      secondAsrStabilityRate: input.stability.summary.stableRate,
    },
    reasons,
    blockers,
    recommendCrossModelArbitrationNext:
      complementarityResult === "SECOND_ASR_COMPLEMENTARITY_CONFIRMED",
    rejectReazonK2: [
      "SECOND_ASR_NOT_USEFUL",
      "SECOND_ASR_TOO_UNSTABLE",
    ].includes(complementarityResult),
    canonicalTextMutationCount: 0 as const,
    canonicalTimingMutationCount: 0 as const,
    productionStatus: "needs-review" as const,
    finalizationMethod: "none" as const,
    machineReleaseAuthorized: false as const,
    goC602: false as const,
    runtimeGoldInputCount: 0 as const,
  };
  return c6019RouteDecisionSchema.parse({
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
}
