import {
  c60110OracleCaptureEvaluationSchema,
  c60110PolicyVersion,
  type C60110OracleCaptureEvaluation,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";

export interface C60110ArbitrationEvaluationSummaryInput {
  evaluableSwitchCount: number;
  correctSwitchCount: number;
  wrongSwitchCount: number;
  neutralSwitchCount: number;
  avoidedRegressionCount: number;
  availableOracleGain: number;
  realizedArbitrationGain: number;
}

function summary(input: C60110ArbitrationEvaluationSummaryInput) {
  const precisionDenominator = input.evaluableSwitchCount;
  return {
    ...input,
    oracleCaptureRate:
      input.availableOracleGain === 0
        ? null
        : input.realizedArbitrationGain / input.availableOracleGain,
    arbitrationPrecision:
      precisionDenominator === 0
        ? null
        : (input.correctSwitchCount + input.neutralSwitchCount) /
          precisionDenominator,
    arbitrationHarmRate:
      precisionDenominator === 0
        ? null
        : input.wrongSwitchCount / precisionDenominator,
  };
}

export function buildC60110OracleCaptureEvaluation(input: {
  generatedAt: string;
  machineFreezeHash: string;
  goldIdentityHash: string;
  dev24: C60110ArbitrationEvaluationSummaryInput;
  holdout: C60110ArbitrationEvaluationSummaryInput;
  wrongProviderSwitchEventIds: string[];
}): C60110OracleCaptureEvaluation {
  const fullEpisode = {
    evaluableSwitchCount:
      input.dev24.evaluableSwitchCount + input.holdout.evaluableSwitchCount,
    correctSwitchCount:
      input.dev24.correctSwitchCount + input.holdout.correctSwitchCount,
    wrongSwitchCount:
      input.dev24.wrongSwitchCount + input.holdout.wrongSwitchCount,
    neutralSwitchCount:
      input.dev24.neutralSwitchCount + input.holdout.neutralSwitchCount,
    avoidedRegressionCount:
      input.dev24.avoidedRegressionCount + input.holdout.avoidedRegressionCount,
    availableOracleGain:
      input.dev24.availableOracleGain + input.holdout.availableOracleGain,
    realizedArbitrationGain:
      input.dev24.realizedArbitrationGain +
      input.holdout.realizedArbitrationGain,
  };
  const core = {
    schemaVersion: "1.0.0" as const,
    policyVersion: c60110PolicyVersion,
    generatedAt: input.generatedAt,
    artifactType: "c6-0-1-10-oracle-capture-evaluation" as const,
    evaluationPhase: "post-final-freeze-gold-isolated" as const,
    machineFreezeHash: input.machineFreezeHash,
    goldIdentityHash: input.goldIdentityHash,
    metricDirection: "LOWER_IS_BETTER" as const,
    dev24: summary(input.dev24),
    holdout: summary(input.holdout),
    fullEpisode: summary(fullEpisode),
    wrongProviderSwitchEventIds: input.wrongProviderSwitchEventIds,
    goldTextIncluded: false as const,
    runtimeGoldInputCount: 0 as const,
  };
  return c60110OracleCaptureEvaluationSchema.parse({
    ...core,
    semanticHash: machineQualitySemanticHash({
      ...core,
      generatedAt: undefined,
    }),
  });
}
