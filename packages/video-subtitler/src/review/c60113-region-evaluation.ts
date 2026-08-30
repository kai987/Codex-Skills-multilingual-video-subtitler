import {
  c60113FeatureNames,
  c60113RegionRankingEvaluationSchema,
  c60113RegionRankerFreezeSchema,
  c60113RankerOofSchema,
  c60113RankerNameSchema,
  type C60113DataQualityAudit,
  type C60113RankerFolds,
  type C60113RankerMachineFreeze,
  type C60113RankerOof,
  type C60113RankingName,
  type C60113RegionFeatures,
  type C60113RegionLabels,
  type C60113RegionRankingEvaluation,
  type C60113RegionRankerFreeze,
} from "@mvl/shared";
import {
  C60113_CALIBRATION_POLICY,
  c60113Hash,
  c60113HashPayload,
  c60113UniqueSeconds,
  c60113Require,
} from "./c60113-region-features.js";
import {
  assertC60113LabelFreeze,
  auditC60113CalibrationData,
  fitC60113LinearRanker,
  trainC60113OofRanker,
} from "./c60113-region-ranker-calibration.js";
import { buildC60113ReviewPolicy } from "./c60113-policy.js";
import { selectC60113Regions } from "./review-burden-planner.js";

type Row = C60113RegionFeatures["regions"][number];
type Metric =
  C60113RegionRankingEvaluation["rankings"][number]["pooled"][number];
type Component = C60113RegionLabels["errorComponents"][number];
export const C60113_FIXED_REVIEW_OVERHEAD_SECONDS = 8;
const percentages = [10, 20, 30, 40, 50] as const;
const ratio = (numerator: number, denominator: number): number =>
  denominator ? numerator / denominator : 1;

/** All scores are machine-only or held-out. No label is accepted by the selector. */
export function selectC60113UniqueAudioBudget(input: {
  regions: readonly Row[];
  ranker: C60113RankingName;
  budgetSeconds: number | null;
  oofScores?: ReadonlyMap<string, number>;
  mandatoryOnly?: boolean;
}): { selected: Row[]; incrementalUniqueSeconds: number[] } {
  const dynamic =
    input.ranker === "R3_REGION_RISK_DENSITY_V3" ||
    input.ranker === "R4_LINEAR_OOF_REGION_RANKER";
  const priority = (row: Row): number => {
    switch (input.ranker) {
      case "R0_CURRENT_ITEM_PRIORITY":
        return row.legacyItemPriority;
      case "R1_CURRENT_REGION_MAX":
        return row.legacyRegionPriority;
      case "R2_MISSING_CALIBRATED_DETERMINISTIC":
        return row.missingCalibratedPriority;
      case "R3_REGION_RISK_DENSITY_V3":
        return row.deterministicRiskUtility;
      case "R4_LINEAR_OOF_REGION_RANKER": {
        const score = input.oofScores?.get(row.regionId);
        if (score === undefined)
          throw new Error("MISSING_HELD_OUT_REGION_SCORE");
        return score;
      }
      case "R0_CHRONOLOGICAL":
        return 0;
      case "C60112_R3_FULL_EVIDENCE_RANK":
        return row.legacyRegionPriority;
      case "C60112_R2_DISAGREEMENT_ONLY":
        return row.crossModelDisagreement ? 1 : 0;
    }
  };
  const evidence = input.regions.map((row) => {
    if (row.selectorEvidence === null)
      throw new Error("MISSING_FROZEN_REGION_SELECTOR_EVIDENCE");
    if (
      row.selectorEvidence.regionId !== row.regionId ||
      JSON.stringify(row.selectorEvidence.contextInterval) !==
        JSON.stringify(row.contextInterval) ||
      row.mandatory !== row.selectorEvidence.mandatoryReasons.length > 0
    )
      throw new Error("REGION_SELECTOR_FEATURE_LINEAGE_MISMATCH");
    return row.selectorEvidence;
  });
  const policy = buildC60113ReviewPolicy();
  const selection = selectC60113Regions({
    regions: evidence,
    policy,
    budgetSeconds: input.budgetSeconds,
    mandatoryOnly: input.mandatoryOnly ?? false,
    ...(dynamic
      ? {}
      : {
          staticOrder: [...input.regions]
            .sort(
              (a, b) =>
                priority(b) - priority(a) ||
                a.sourceInterval.start - b.sourceInterval.start ||
                a.regionId.localeCompare(b.regionId),
            )
            .map((row) => row.regionId),
        }),
    ...(input.ranker === "R4_LINEAR_OOF_REGION_RANKER"
      ? {
          rankingScoreByRegion: Object.fromEntries(
            input.regions.map((row) => [row.regionId, priority(row)]),
          ),
        }
      : {}),
  });
  return {
    selected: selection.regions.map((region) =>
      c60113Require(
        input.regions.find((row) => row.regionId === region.regionId),
      ),
    ),
    incrementalUniqueSeconds: selection.selectionSteps.map(
      (step) => step.incrementalPlaybackSeconds,
    ),
  };
}

export function evaluateC60113RegionSelection(input: {
  budget: string;
  budgetSeconds: number;
  selected: Row[];
  incrementalUniqueSeconds: number[];
  components: readonly Component[];
}): Metric {
  const ids = new Set(input.selected.map((row) => row.regionId));
  const covered = input.components.filter((component) =>
    component.coveredRegionIds.some((id) => ids.has(id)),
  );
  const count = (components: readonly Component[], label: string): number =>
    components.filter((component) =>
      component.labels.some((value) => value === label),
    ).length;
  const clipSumSeconds = input.selected.reduce(
    (sum, row) => sum + row.contextInterval.end - row.contextInterval.start,
    0,
  );
  const uniqueUnionSeconds = c60113UniqueSeconds(
    input.selected.map((row) => row.contextInterval),
  );
  return {
    budget: input.budget,
    budgetSeconds: input.budgetSeconds,
    selectedRegionIds: [...ids],
    selectedRegionCount: ids.size,
    selectedItemCount: new Set(input.selected.flatMap((row) => row.itemIds))
      .size,
    clipSumSeconds,
    uniqueUnionSeconds,
    duplicateContextSeconds: Math.max(0, clipSumSeconds - uniqueUnionSeconds),
    incrementalUniqueSeconds: input.incrementalUniqueSeconds,
    materialRecall: ratio(
      count(covered, "MATERIAL_TEXT_ERROR"),
      count(input.components, "MATERIAL_TEXT_ERROR"),
    ),
    severeTimingRecall: ratio(
      count(covered, "SEVERE_TIMING_ERROR"),
      count(input.components, "SEVERE_TIMING_ERROR"),
    ),
    hallucinationRecall: ratio(
      count(covered, "HALLUCINATION"),
      count(input.components, "HALLUCINATION"),
    ),
    missingDialogueRecall: ratio(
      count(covered, "MISSING_DIALOGUE"),
      count(input.components, "MISSING_DIALOGUE"),
    ),
    reviewPrecision: ids.size
      ? input.selected.filter((row) =>
          covered.some((component) =>
            component.coveredRegionIds.includes(row.regionId),
          ),
        ).length / ids.size
      : 0,
    residualErrorRate: input.components.length
      ? (input.components.length - covered.length) / input.components.length
      : 0,
    coveredErrorComponentIds: covered
      .map((component) => component.errorComponentId)
      .sort(),
    totalMaterialErrors: count(input.components, "MATERIAL_TEXT_ERROR"),
    totalSevereTimingErrors: count(input.components, "SEVERE_TIMING_ERROR"),
    totalHallucinations: count(input.components, "HALLUCINATION"),
    totalMissingDialogue: count(input.components, "MISSING_DIALOGUE"),
  };
}

function rankerMetrics(input: {
  ranker: C60113RankingName;
  regions: Row[];
  components: readonly Component[];
  duration: number;
  oofScores: ReadonlyMap<string, number>;
}): Metric[] {
  const budgets = [
    ...percentages.map((percent) => ({
      name: `UNIQUE_AUDIO_${percent}_PERCENT`,
      seconds: (input.duration * percent) / 100,
    })),
    ...[90, 180, 270, 360, 450].map((seconds) => ({
      name: `UNIQUE_AUDIO_${seconds}_SECONDS`,
      seconds,
    })),
    { name: "ALL_MANDATORY", seconds: null },
    { name: "FULL_QUEUE", seconds: null },
  ];
  return budgets.map((budget) => {
    const selection = selectC60113UniqueAudioBudget({
      regions: input.regions,
      ranker: input.ranker,
      budgetSeconds: budget.seconds,
      oofScores: input.oofScores,
      mandatoryOnly: budget.name === "ALL_MANDATORY",
    });
    return evaluateC60113RegionSelection({
      budget: budget.name,
      budgetSeconds: budget.seconds ?? input.duration,
      ...selection,
      components: input.components,
    });
  });
}
const at = (metrics: Metric[], percent: number): Metric =>
  c60113Require(
    metrics.find((row) => row.budget === `UNIQUE_AUDIO_${percent}_PERCENT`),
  );
const utility = (metrics: Metric[]): number =>
  percentages.reduce(
    (sum, percent) =>
      sum +
      (at(metrics, percent).materialRecall +
        at(metrics, percent).severeTimingRecall) /
        2,
    0,
  ) / percentages.length;

export function evaluateC60113RegionRankings(input: {
  features: C60113RegionFeatures;
  folds: C60113RankerFolds;
  machineFreeze: C60113RankerMachineFreeze;
  labels: C60113RegionLabels;
  oof: C60113RankerOof;
  dataQuality: C60113DataQualityAudit;
  episodeDurationSeconds: number;
  legacyRequiredUniqueAudioSeconds?: number;
  generatedAt: string;
}): C60113RegionRankingEvaluation {
  assertC60113LabelFreeze(input);
  if (
    input.oof.machineFreezeHash !== input.machineFreeze.semanticHash ||
    c60113HashPayload(input.oof) !== input.oof.semanticHash
  )
    throw new Error("OOF_FREEZE_MISMATCH");
  if (
    c60113HashPayload(input.dataQuality) !== input.dataQuality.semanticHash ||
    input.dataQuality.machineFeaturesHash !== input.features.semanticHash ||
    input.dataQuality.foldsHash !== input.folds.semanticHash ||
    input.dataQuality.labelsHash !== input.labels.semanticHash ||
    input.dataQuality.passed !==
      input.dataQuality.checks.every((check) => check.passed)
  )
    throw new Error("CALIBRATION_DATA_QUALITY_AUDIT_MISMATCH");
  const oofScores = new Map(
    input.oof.predictions.map((prediction) => [
      prediction.regionId,
      prediction.rankingScore,
    ]),
  );
  const rankings = c60113RankerNameSchema.options.map((ranker) => {
    const pooled = rankerMetrics({
      ranker,
      regions: input.features.regions,
      components: input.labels.errorComponents,
      duration: input.episodeDurationSeconds,
      oofScores,
    });
    const folds = input.folds.folds.map((fold) => {
      const regions = input.features.regions.filter((region) =>
        fold.regionIds.includes(region.regionId),
      );
      const components = input.labels.errorComponents.filter(
        (component) => component.foldId === fold.foldId,
      );
      const duration = fold.timelineRanges.length
        ? Math.max(...fold.timelineRanges.map((range) => range.end)) -
          Math.min(...fold.timelineRanges.map((range) => range.start))
        : 0;
      const evaluated = rankerMetrics({
        ranker,
        regions,
        components,
        duration,
        oofScores,
      });
      const baseline = rankerMetrics({
        ranker: "C60112_R3_FULL_EVIDENCE_RANK",
        regions,
        components,
        duration,
        oofScores,
      });
      const current = at(evaluated, 30);
      const previous = at(baseline, 30);
      const gain =
        (current.materialRecall +
          current.severeTimingRecall -
          previous.materialRecall -
          previous.severeTimingRecall) /
        2;
      return {
        foldId: fold.foldId,
        hasMajorPositive: components.some((component) =>
          component.labels.some(
            (label) => label !== "OVERLAP_ERROR" && label !== "CLEAN_OR_MINOR",
          ),
        ),
        metrics: evaluated,
        gainAt30VersusLegacy: gain,
        negativeGain: gain < -1e-9,
      };
    });
    return {
      ranker,
      pooled,
      folds,
      meanMaterialTimingRecall: utility(pooled),
      negativeFoldCount: folds.filter((fold) => fold.negativeGain).length,
    };
  });
  const by = (name: C60113RankingName) =>
    c60113Require(rankings.find((row) => row.ranker === name));
  const learned = by("R4_LINEAR_OOF_REGION_RANKER");
  const legacy = by("C60112_R3_FULL_EVIDENCE_RANK");
  const required = c60113Require(
    learned.pooled.find((row) => row.budget === "ALL_MANDATORY"),
  );
  const requiredUniqueAudioRatio = Math.min(
    1,
    required.uniqueUnionSeconds / input.episodeDurationSeconds,
  );
  const learned50 = at(learned.pooled, 50);
  const learned30 = at(learned.pooled, 30);
  const independentEvaluationSupported =
    input.dataQuality.passed &&
    input.folds.actualFoldCount >= 2 &&
    input.oof.models.every((model) => model.model.trainingStatus === "FITTED");
  const safetyRequired =
    required.hallucinationRecall === 1 && required.missingDialogueRecall === 1;
  const learnedFreezeEligible =
    independentEvaluationSupported &&
    learned.meanMaterialTimingRecall > legacy.meanMaterialTimingRecall + 1e-9 &&
    learned.meanMaterialTimingRecall >
      by("R0_CHRONOLOGICAL").meanMaterialTimingRecall + 1e-9 &&
    learned.folds.every((fold) => fold.gainAt30VersusLegacy > -0.25) &&
    learned30.materialRecall >= 0.45 &&
    learned30.severeTimingRecall >= 0.45 &&
    learned50.materialRecall >= 0.65 &&
    learned50.severeTimingRecall >= 0.65 &&
    learned50.hallucinationRecall === 1 &&
    learned50.missingDialogueRecall === 1 &&
    safetyRequired &&
    requiredUniqueAudioRatio <= 0.5;
  const selectedRanker = learnedFreezeEligible
    ? ("R4_LINEAR_OOF_REGION_RANKER" as const)
    : ("R3_REGION_RISK_DENSITY_V3" as const);
  const selected = by(selectedRanker);
  const selected30 = at(selected.pooled, 30);
  const selected50 = at(selected.pooled, 50);
  const improved =
    selected.meanMaterialTimingRecall > legacy.meanMaterialTimingRecall &&
    selected.meanMaterialTimingRecall >
      by("R0_CHRONOLOGICAL").meanMaterialTimingRecall;
  const safe =
    safetyRequired &&
    selected50.hallucinationRecall === 1 &&
    selected50.missingDialogueRecall === 1;
  const strong =
    safe &&
    improved &&
    selected30.materialRecall >= 0.6 &&
    selected30.severeTimingRecall >= 0.6 &&
    selected50.materialRecall >= 0.8 &&
    selected50.severeTimingRecall >= 0.8;
  const promising =
    safe &&
    improved &&
    selected30.materialRecall >= 0.45 &&
    selected30.severeTimingRecall >= 0.45 &&
    selected50.materialRecall >= 0.65 &&
    selected50.severeTimingRecall >= 0.65;
  const rankingResult = !independentEvaluationSupported
    ? ("REGION_RANKER_UNSUPPORTED" as const)
    : strong
      ? ("REGION_RANKER_STRONG_PASS" as const)
      : promising
        ? ("REGION_RANKER_PROMISING" as const)
        : ("REGION_RANKER_WEAK" as const);
  const reduced =
    input.legacyRequiredUniqueAudioSeconds !== undefined &&
    required.uniqueUnionSeconds < input.legacyRequiredUniqueAudioSeconds - 1e-7;
  const severeRegression =
    selected30.materialRecall < at(legacy.pooled, 30).materialRecall - 0.15 ||
    selected30.severeTimingRecall <
      at(legacy.pooled, 30).severeTimingRecall - 0.15;
  const burdenResult =
    reduced && (!safe || severeRegression)
      ? ("REVIEW_BURDEN_REDUCTION_UNSAFE" as const)
      : reduced && requiredUniqueAudioRatio <= 0.4
        ? ("REVIEW_BURDEN_STRONG_REDUCTION" as const)
        : reduced && requiredUniqueAudioRatio <= 0.5
          ? ("REVIEW_BURDEN_PROMISING_REDUCTION" as const)
          : ("REVIEW_BURDEN_NO_MEANINGFUL_REDUCTION" as const);
  const missedSafetyComponents = input.labels.errorComponents
    .filter(
      (component) =>
        component.labels.some(
          (label) => label === "HALLUCINATION" || label === "MISSING_DIALOGUE",
        ) &&
        !required.coveredErrorComponentIds.includes(component.errorComponentId),
    )
    .map((component) => ({
      errorComponentId: component.errorComponentId,
      labels: component.labels,
      coveredRegionIds: component.coveredRegionIds,
      reason: !component.coveredRegionIds.length
        ? "NO_REVIEW_ITEM_LINEAGE_COVERS_GOLD_ERROR"
        : "REVIEW_REGION_EXISTS_BUT_MACHINE_POSITIVE_SAFETY_EVIDENCE_INSUFFICIENT_FOR_MANDATORY",
    }));
  const selectionReasons = [
    learnedFreezeEligible
      ? "OOF_LEARNED_RANKER_MET_PREDECLARED_SAFETY_GAIN_BURDEN_GATES"
      : "LEARNED_GATES_NOT_MET_FREEZE_GOLD_FREE_DETERMINISTIC_FALLBACK",
    ...(safetyRequired
      ? []
      : ["MANDATORY_QUEUE_DOES_NOT_CAPTURE_ALL_SAFETY_ERRORS"]),
    ...(independentEvaluationSupported
      ? []
      : ["OOF_SUPPORT_OR_DATA_QUALITY_INSUFFICIENT"]),
    ...(selected.negativeFoldCount
      ? ["NEGATIVE_FOLDS_REPORTED_NOT_REPARTITIONED_OR_RETUNED"]
      : []),
    ...(severeRegression
      ? ["MATERIAL_OR_TIMING_RECALL_REGRESSION_AT_30_PERCENT"]
      : []),
  ];
  const payload = {
    schemaVersion: "1.0.0" as const,
    policyVersion: C60113_CALIBRATION_POLICY,
    artifactType: "c6-0-1-13-region-ranking-evaluation" as const,
    machineFreezeHash: input.machineFreeze.semanticHash,
    labelsHash: input.labels.semanticHash,
    oofHash: input.oof.semanticHash,
    episodeDurationSeconds: input.episodeDurationSeconds,
    formalLearnedMetricsOofOnly: true as const,
    rankings,
    selectedRanker,
    rankingResult,
    burdenResult,
    requiredUniqueAudioRatio,
    requiredSafetyRecall: {
      hallucination: required.hallucinationRecall,
      missingDialogue: required.missingDialogueRecall,
    },
    learnedFreezeEligible,
    selectionReasons,
    missedSafetyComponents,
  };
  return c60113RegionRankingEvaluationSchema.parse({
    ...payload,
    generatedAt: input.generatedAt,
    semanticHash: c60113Hash(payload),
  });
}

export function freezeC60113ProspectiveRanker(input: {
  features: C60113RegionFeatures;
  folds: C60113RankerFolds;
  labels: C60113RegionLabels;
  oof: C60113RankerOof;
  evaluation: C60113RegionRankingEvaluation;
  generatedAt: string;
}): C60113RegionRankerFreeze {
  c60113RankerOofSchema.parse(input.oof);
  c60113RegionRankingEvaluationSchema.parse(input.evaluation);
  if (
    c60113HashPayload(input.oof) !== input.oof.semanticHash ||
    c60113HashPayload(input.evaluation) !== input.evaluation.semanticHash ||
    input.evaluation.oofHash !== input.oof.semanticHash ||
    input.evaluation.labelsHash !== input.labels.semanticHash ||
    input.oof.machineFeaturesHash !== input.features.semanticHash ||
    input.oof.foldsHash !== input.folds.semanticHash ||
    input.oof.labelsHash !== input.labels.semanticHash
  )
    throw new Error("PROSPECTIVE_RANKER_FREEZE_LINEAGE_MISMATCH");
  const learned = input.evaluation.learnedFreezeEligible;
  if (
    learned &&
    !["REGION_RANKER_STRONG_PASS", "REGION_RANKER_PROMISING"].includes(
      input.evaluation.rankingResult,
    )
  )
    throw new Error("LEARNED_RANKER_NOT_PROMISING");
  const positiveIds = new Set(
    input.labels.regions
      .filter((row) => row.majorError)
      .map((row) => row.regionId),
  );
  const payload = {
    schemaVersion: "1.0.0" as const,
    policyVersion: C60113_CALIBRATION_POLICY,
    artifactType: "c6-0-1-13-region-ranker-freeze" as const,
    rankerType: learned
      ? ("L2_LOGISTIC_REGRESSION" as const)
      : ("REGION_RISK_DENSITY_V3" as const),
    featureSchemaVersion: "c60113-structural-features-v1" as const,
    featureNames: [...c60113FeatureNames],
    model: learned
      ? fitC60113LinearRanker(input.features.regions, positiveIds)
      : null,
    rankingPolicy: C60113_CALIBRATION_POLICY,
    mandatoryPolicy: "POSITIVE_SAFETY_EVIDENCE_ONLY" as const,
    burdenSelectionPolicy:
      "MARGINAL_UNIQUE_AUDIO_GREEDY_FIXED_OVERHEAD_V1" as const,
    fixedReviewOverheadSeconds: C60113_FIXED_REVIEW_OVERHEAD_SECONDS,
    trainingDatasetHash: learned ? input.labels.semanticHash : null,
    foldsHash: input.folds.semanticHash,
    oofHash: input.oof.semanticHash,
    evaluationHash: input.evaluation.semanticHash,
    use: "FUTURE_UNREVIEWED_EPISODES_ONLY" as const,
    episodeOneProspectiveClaim: false as const,
    reason: learned
      ? "FULL_DATA_FIT_AFTER_OOF_GATES_FOR_FUTURE_EPISODES_ONLY"
      : "NO_LEARNED_MODEL_FROZEN_DETERMINISTIC_FALLBACK_NOT_A_TRIAL_READINESS_CLAIM",
  };
  return c60113RegionRankerFreezeSchema.parse({
    ...payload,
    generatedAt: input.generatedAt,
    semanticHash: c60113Hash(payload),
  });
}

export function runC60113RankerCalibration(input: {
  features: C60113RegionFeatures;
  folds: C60113RankerFolds;
  machineFreeze: C60113RankerMachineFreeze;
  labels: C60113RegionLabels;
  episodeDurationSeconds: number;
  legacyRequiredUniqueAudioSeconds?: number;
  generatedAt: string;
}): {
  oof: C60113RankerOof;
  evaluation: C60113RegionRankingEvaluation;
  rankerFreeze: C60113RegionRankerFreeze;
  dataQuality: C60113DataQualityAudit;
} {
  let oof = trainC60113OofRanker(input);
  const scores = new Map(
    oof.predictions.map((prediction) => [
      prediction.regionId,
      prediction.rankingScore,
    ]),
  );
  const selectedByBudget = percentages.map((percent) => ({
    budget: `UNIQUE_AUDIO_${percent}_PERCENT`,
    ids: new Set(
      selectC60113UniqueAudioBudget({
        regions: input.features.regions,
        ranker: "R4_LINEAR_OOF_REGION_RANKER",
        budgetSeconds: (input.episodeDurationSeconds * percent) / 100,
        oofScores: scores,
      }).selected.map((row) => row.regionId),
    ),
  }));
  const predictions = oof.predictions.map((prediction) => {
    const payload = {
      ...prediction,
      selectedAtBudgets: selectedByBudget
        .filter((budget) => budget.ids.has(prediction.regionId))
        .map((budget) => budget.budget),
    };
    return { ...payload, semanticHash: c60113HashPayload(payload) };
  });
  oof = c60113RankerOofSchema.parse({
    ...oof,
    predictions,
    semanticHash: c60113HashPayload({ ...oof, predictions }),
  });
  const dataQuality = auditC60113CalibrationData({ ...input, oof });
  const evaluation = evaluateC60113RegionRankings({
    ...input,
    oof,
    dataQuality,
  });
  const rankerFreeze = freezeC60113ProspectiveRanker({
    ...input,
    oof,
    evaluation,
  });
  return { oof, evaluation, rankerFreeze, dataQuality };
}
