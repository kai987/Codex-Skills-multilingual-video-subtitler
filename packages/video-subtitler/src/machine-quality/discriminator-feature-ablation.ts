import {
  c60111FeatureAblationReportSchema,
  c60111PolicyVersion,
  type C60111CvResults,
  type C60111FeatureAblationReport,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";

const descriptions = {
  M0: "C6.0.1.10 machine evidence baseline",
  M1: "baseline plus paired Whisper stability",
  M2: "baseline plus independent acoustic margin",
  M3: "combined old, paired, independent, and generic acoustic features",
  M4: "combined features without correlated legacy CTC",
  M5: "independent acoustic verifier only",
} as const;

function rank(results: readonly C60111CvResults[]): C60111CvResults[] {
  return results.toSorted(
    (left, right) =>
      left.aggregate.wrongCount - right.aggregate.wrongCount ||
      (right.aggregate.precision ?? -1) - (left.aggregate.precision ?? -1) ||
      right.aggregate.realizedGain - left.aggregate.realizedGain ||
      right.aggregate.selectedCount - left.aggregate.selectedCount ||
      left.modelId.localeCompare(right.modelId),
  );
}

export function buildC60111FeatureAblationReport(input: {
  generatedAt: string;
  results: readonly C60111CvResults[];
}): C60111FeatureAblationReport {
  const ids = new Set(input.results.map((result) => result.modelId));
  if (input.results.length !== 6 || ids.size !== 6) {
    throw new Error("C6.0.1.11 ablation requires exactly M0 through M5.");
  }
  const variants = input.results
    .toSorted((left, right) => left.modelId.localeCompare(right.modelId))
    .map((result) => {
      const core = {
        modelId: result.modelId,
        description: descriptions[result.modelId],
        featureSet: result.featureSet,
        metrics: {
          selectedCount: result.aggregate.selectedCount,
          correctCount: result.aggregate.correctCount,
          wrongCount: result.aggregate.wrongCount,
          neutralCount: result.aggregate.neutralCount,
          precision: result.aggregate.precision,
          harmRate: result.aggregate.harmRate,
          selectiveCoverage: result.aggregate.selectiveCoverage,
          realizedGain: result.aggregate.realizedGain,
          availableOracleGain: result.aggregate.availableOracleGain,
          oracleCaptureRate: result.aggregate.oracleCaptureRate,
        },
        negativeGainFoldCount: result.aggregate.negativeGainFoldCount,
        zeroHarmFoldCount: result.aggregate.zeroHarmFoldCount,
      };
      return { ...core, semanticHash: machineQualitySemanticHash(core) };
    });
  const bestModelId = rank(input.results)[0]?.modelId;
  if (bestModelId === undefined)
    throw new Error("No ablation winner available.");
  const core = {
    schemaVersion: "1.0.0" as const,
    policyVersion: c60111PolicyVersion,
    generatedAt: input.generatedAt,
    artifactType: "c6-0-1-11-feature-ablation-report" as const,
    variants,
    bestModelId,
    selectionPerformedWithoutOuterTestRetuning: true as const,
  };
  return c60111FeatureAblationReportSchema.parse({
    ...core,
    semanticHash: machineQualitySemanticHash({
      ...core,
      generatedAt: undefined,
    }),
  });
}
