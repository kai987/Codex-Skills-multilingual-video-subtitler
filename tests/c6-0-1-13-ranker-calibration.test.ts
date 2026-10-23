import { describe, expect, it } from "vitest";
import {
  c60113RegionFeaturesSchema,
  c60113RegionRankingEvaluationSchema,
  c60113FeatureNames,
  c60113DeploymentRankerSchema,
} from "@mvl/shared";
import {
  buildC60113RegionFeatures,
  c60113HashPayload,
  c60113Hash,
  c60113Require,
  c60113UniqueSeconds,
  type C60113RegionFeatureInput,
} from "../packages/video-subtitler/src/review/c60113-region-features.js";
import {
  buildC60113RankerFolds,
  createC60113RankerMachineFreeze,
} from "../packages/video-subtitler/src/review/c60113-region-ranker-folds.js";
import {
  buildC60113RegionLabels,
  fitC60113LinearRanker,
  trainC60113OofRanker,
} from "../packages/video-subtitler/src/review/c60113-region-ranker-calibration.js";
import {
  runC60113RankerCalibration,
  selectC60113UniqueAudioBudget,
} from "../packages/video-subtitler/src/review/c60113-region-evaluation.js";
import {
  scoreC60113DeploymentRegions,
  selectC60113DeploymentRegions,
} from "../packages/video-subtitler/src/review/c60113-region-ranker-deployment.js";
import { buildC60113ReviewPolicy } from "../packages/video-subtitler/src/review/c60113-policy.js";
import {
  c60113NativeLegacyPlans,
  evaluateC60113FrozenPlans,
  evaluateC60113MissingEvidence,
} from "../scripts/lib/c60113-post-freeze-evaluation.js";

const generatedAt = "2026-08-30T08:00:00.000Z";
const hash = "a".repeat(64);
function region(
  index: number,
  overrides: Partial<C60113RegionFeatureInput> = {},
): C60113RegionFeatureInput {
  const row: C60113RegionFeatureInput = {
    regionId: `region-${index}`,
    itemIds: [`item-${index}`],
    sourceInterval: { start: index * 20 + 1, end: index * 20 + 8 },
    contextInterval: { start: index * 20, end: index * 20 + 10 },
    mandatory: index === 0,
    legacyItemPriority: 100 - index,
    legacyRegionPriority: 100 - index,
    missingCalibratedPriority: 50 + index,
    deterministicRiskUtility: 10 + index,
    crossModelDisagreement: index % 2 === 0,
    values: {
      missingSeverity: index % 2,
      independentFamilyCount: index + 1,
      acousticMargin: { status: "UNAVAILABLE", value: null },
    },
    ...overrides,
  };
  row.selectorEvidence = {
    regionId: row.regionId,
    itemIds: row.itemIds,
    sourceInterval: row.sourceInterval,
    contextInterval: row.contextInterval,
    itemRiskSummary: {
      uniqueAffectedCueCount: 1,
      uniqueEventCount: 1,
      independentRiskGroupCount: row.deterministicRiskUtility,
      mandatoryItemCount: row.mandatory ? 1 : 0,
      missingClassifications: [],
    },
    independentEvidenceFamilies: ["ASR_LEXICAL_CONTENT"],
    mandatoryReasons: row.mandatory ? [`safety-${index}`] : [],
    candidateActionableCount: 0,
    estimatedUniqueAudioSeconds:
      row.contextInterval.end - row.contextInterval.start,
    priorityVector: {
      mandatorySafetyClass: row.mandatory ? "STRONG_HALLUCINATION" : "NONE",
      positiveEvidenceStrength: 1,
      independentEvidenceFamilyCount: 1,
      errorTypeSeverity: 1,
      crossModelConflictStrength: 0,
      hallucinationStrength: row.mandatory ? 1 : 0,
      missingStrength: 0,
      timingStrength: 0,
      candidateActionability: 0,
      localizationQuality: null,
      estimatedReviewCost: 10,
      sourceTime: row.sourceInterval.start,
    },
    rankScore:
      row.deterministicRiskUtility /
      (8 + row.contextInterval.end - row.contextInterval.start),
    rankPosition: index + 1,
    riskCoverageKeys: Array.from(
      { length: row.deterministicRiskUtility },
      (_, key) => `${index}-risk-${key}`,
    ),
    actionableCoverageKeys: [],
    semanticHash: hash,
  };
  return row;
}
function fixture(count = 10) {
  const features = buildC60113RegionFeatures({
    regions: Array.from({ length: count }, (_, index) => region(index)),
    generatedAt,
    policyHash: hash,
  });
  const folds = buildC60113RankerFolds({ features, generatedAt });
  const machineFreeze = createC60113RankerMachineFreeze({
    features,
    folds,
    generatedAt,
    artifactHashes: { workspace: hash },
  });
  const qualityEvaluation = {
    semanticHash: hash,
    errorComponents: Array.from({ length: count / 2 }, (_, index) => ({
      errorComponentId: `error-${index}`,
      labels: ["MATERIAL_TEXT_ERROR" as const],
      coveredReviewItemIds: [`item-${index * 2}`],
      coveredRegionIds: [],
      semanticHash: hash,
    })),
  };
  const labels = buildC60113RegionLabels({
    features,
    folds,
    machineFreeze,
    qualityEvaluation,
    generatedAt,
  });
  return {
    features,
    folds,
    machineFreeze,
    labels,
    generatedAt,
    episodeDurationSeconds: count * 20,
    legacyRequiredUniqueAudioSeconds: 100,
  };
}

describe("C6.0.1.13 machine-only structural features and folds", () => {
  it("keeps observed zero, unknown and unavailable distinct and rejects text predictors", () => {
    const { features } = fixture();
    const row = c60113Require(features.regions[0]);
    expect(row.values.missingSeverity).toEqual({
      status: "OBSERVED",
      value: 0,
    });
    expect(row.values.acousticMargin).toEqual({
      status: "UNAVAILABLE",
      value: null,
    });
    expect(row.values.hallucinationStrength).toEqual({
      status: "UNKNOWN",
      value: null,
    });
    expect(features.featureNames).not.toContain("sourceTime");
    expect(() =>
      buildC60113RegionFeatures({
        regions: [region(0, { values: { rawText: 4 } as never })],
        generatedAt,
        policyHash: hash,
      }),
    ).toThrow("FORBIDDEN_OR_UNKNOWN");
    expect(
      c60113RegionFeaturesSchema.safeParse({ ...features, goldLabels: [] })
        .success,
    ).toBe(false);
  });
  it("groups overlapping context and neighboring structural metadata before labels", () => {
    const features = buildC60113RegionFeatures({
      generatedAt,
      policyHash: hash,
      regions: [
        region(0),
        region(1, {
          sourceInterval: { start: 9, end: 12 },
          contextInterval: { start: 8, end: 13 },
        }),
        region(2, { sceneIds: ["scene-A"] }),
        region(3, { sceneIds: ["scene-A"] }),
        region(5),
        region(7),
        region(9),
      ],
    });
    const folds = buildC60113RankerFolds({ features, generatedAt });
    expect(folds.frozenBeforeLabels).toBe(true);
    expect(folds.crossFoldAudioOverlapCount).toBe(0);
    expect(
      folds.groups.some(
        (group) =>
          group.regionIds.includes("region-0") &&
          group.regionIds.includes("region-1"),
      ),
    ).toBe(true);
    expect(
      folds.groups.some(
        (group) =>
          group.regionIds.includes("region-2") &&
          group.regionIds.includes("region-3"),
      ),
    ).toBe(true);
    expect(folds.actualFoldCount).toBe(5);
  });
  it("rejects stale machine features before Gold labels enter", () => {
    const input = fixture();
    c60113Require(input.features.regions[0]).values.missingSeverity = {
      status: "OBSERVED",
      value: 1,
    };
    expect(() =>
      buildC60113RegionLabels({
        ...input,
        qualityEvaluation: { semanticHash: hash, errorComponents: [] },
      }),
    ).toThrow("STALE_MACHINE_REGION_FEATURES_HASH");
  });
  it("never chooses a label-driven four-fold repartition", () => {
    const input = fixture(6);
    const result = runC60113RankerCalibration(input);
    expect(input.folds.actualFoldCount).toBe(5);
    expect(
      result.dataQuality.foldClassBalance.some((fold) => fold.noMajorPositive),
    ).toBe(true);
    expect(
      result.evaluation.rankings.every((ranking) => ranking.folds.length === 5),
    ).toBe(true);
  });
});

describe("C6.0.1.13 held-out calibration", () => {
  it("fits median/scaler and weights on training rows only", () => {
    const { features } = fixture();
    const train = features.regions.slice(0, 4);
    const fitted = fitC60113LinearRanker(
      train,
      new Set([c60113Require(train[0]).regionId]),
    );
    expect(fitted.preprocessing.fittedRegionIds).toEqual(
      train.map((row) => row.regionId).sort(),
    );
    expect(fitted.positiveClassWeight).toBe(2);
    expect(fitted.negativeClassWeight).toBeCloseTo(2 / 3);
    expect(fitted.preprocessing.featureNames).not.toContain("sourceTime");
    c60113Require(features.regions[9]).values.independentFamilyCount = {
      status: "OBSERVED",
      value: 1e12,
    };
    expect(
      fitC60113LinearRanker(train, new Set([c60113Require(train[0]).regionId])),
    ).toEqual(fitted);
  });
  it("provides exactly one held-out score and disjoint train/test IDs", () => {
    const input = fixture();
    const oof = trainC60113OofRanker(input);
    expect(oof.predictions).toHaveLength(10);
    for (const model of oof.models) {
      expect(
        model.testRegionIds.some((id) => model.trainRegionIds.includes(id)),
      ).toBe(false);
      expect(
        model.testRegionIds.some((id) =>
          model.model.preprocessing.fittedRegionIds.includes(id),
        ),
      ).toBe(false);
    }
    expect(oof.scoreMeaning).toBe("RANKING_SCORE_NOT_CALIBRATED_PROBABILITY");
  });
  it("retains uncovered errors in pooled and temporal-fold denominators", () => {
    const input = fixture();
    input.labels = buildC60113RegionLabels({
      ...input,
      qualityEvaluation: {
        semanticHash: hash,
        errorComponents: [
          {
            errorComponentId: "missing",
            labels: ["MISSING_DIALOGUE"],
            coveredReviewItemIds: [],
            coveredRegionIds: [],
            semanticHash: hash,
          },
        ],
      },
      errorIntervals: { missing: { start: 17, end: 18 } },
    });
    const result = runC60113RankerCalibration(input);
    const full = c60113Require(
      c60113Require(result.evaluation.rankings[0]).pooled.find(
        (metric) => metric.budget === "FULL_QUEUE",
      ),
    );
    expect(full.totalMissingDialogue).toBe(1);
    expect(full.missingDialogueRecall).toBe(0);
    expect(input.labels.unassignedErrorComponentCount).toBe(0);
    expect(
      c60113Require(result.evaluation.missedSafetyComponents[0]).reason,
    ).toBe("NO_REVIEW_ITEM_LINEAGE_COVERS_GOLD_ERROR");
    expect(result.rankerFreeze.rankerType).toBe("REGION_RISK_DENSITY_V3");
    expect(result.rankerFreeze.model).toBeNull();
    expect(result.evaluation.burdenResult).toBe(
      "REVIEW_BURDEN_REDUCTION_UNSAFE",
    );
  });
  it("produces strict deterministic eight-ranker evaluation without learned in-sample metrics", () => {
    const input = fixture();
    const first = runC60113RankerCalibration(input);
    const second = runC60113RankerCalibration(input);
    expect(first).toEqual(second);
    expect(first.evaluation.rankings).toHaveLength(8);
    expect(
      first.evaluation.rankings.every(
        (ranking) => ranking.pooled.length === 12,
      ),
    ).toBe(true);
    expect(
      first.oof.predictions.some(
        (prediction) => prediction.selectedAtBudgets.length > 0,
      ),
    ).toBe(true);
    expect(first.oof.semanticHash).toBe(c60113HashPayload(first.oof));
    expect(
      c60113RegionRankingEvaluationSchema.safeParse(first.evaluation).success,
    ).toBe(true);
  });
});

describe("C6.0.1.13 independent-audio budget semantics", () => {
  it("keeps native stage plans and missing item/gap denominators distinct", () => {
    const input = fixture();
    const labels = buildC60113RegionLabels({
      ...input,
      qualityEvaluation: {
        semanticHash: hash,
        errorComponents: [
          {
            errorComponentId: "missing-a",
            labels: ["MISSING_DIALOGUE"],
            coveredReviewItemIds: ["item-0", "item-1"],
            coveredRegionIds: [],
            semanticHash: hash,
          },
          {
            errorComponentId: "missing-b",
            labels: ["MISSING_DIALOGUE"],
            coveredReviewItemIds: [],
            coveredRegionIds: [],
            semanticHash: hash,
          },
        ],
      },
      errorIntervals: {
        "missing-a": { start: 1, end: 2 },
        "missing-b": { start: 150, end: 151 },
      },
    });
    const plans = c60113NativeLegacyPlans(
      input.features,
      input.episodeDurationSeconds,
    );
    const native = evaluateC60113FrozenPlans({ ...input, labels, plans });
    expect(native.metrics).toHaveLength(12);
    expect(
      native.metrics.every((metric) => metric.totalMissingDialogue === 2),
    ).toBe(true);
    expect(() =>
      evaluateC60113FrozenPlans({
        ...input,
        labels,
        plans: plans.map((plan) => ({
          ...plan,
          expectedUniqueUnionSeconds:
            (plan.expectedUniqueUnionSeconds ?? 0) + 1,
        })),
      }),
    ).toThrow("FROZEN_BURDEN_PLAN_UNIQUE_AUDIO_MISMATCH");
    const audit = evaluateC60113MissingEvidence({
      generatedAt,
      labels,
      missingEvidence: {
        policyVersion: input.features.policyVersion,
        semanticHash: hash,
        gaps: [
          {
            gapId: "observed",
            itemIds: ["item-0", "item-1"],
            classification: "SPEECH_GAP_OBSERVED",
          },
          {
            gapId: "unresolved",
            itemIds: ["item-2"],
            classification: "MISSING_DIALOGUE_UNRESOLVED",
          },
        ],
      },
      legacyItems: {
        items: [0, 1, 2].map((i) => ({
          reviewItemId: `item-${i}`,
          itemTypes: ["MISSING_SPEECH_RISK"],
        })),
      },
    });
    expect(audit.legacyMissingItemCount).toBe(3);
    expect(audit.deduplicatedGapCount).toBe(2);
    expect(audit.legacyTruePositiveItemCount).toBe(2);
    expect(audit.anyGapRecall).toBe(0.5);
    expect(audit.strongRecall).toBe(0);
    expect(audit.components[1]?.capturedByAnyGap).toBe(false);
    expect(
      audit.classifications.find(
        (row) => row.classification === "MISSING_DIALOGUE_STRONG",
      )?.precisionIfTreatedAsMissing,
    ).toBeNull();
  });
  it("measures union not clip-sum and recomputes marginal cost each selection", () => {
    const features = buildC60113RegionFeatures({
      generatedAt,
      policyHash: hash,
      regions: [
        region(0, { mandatory: false, deterministicRiskUtility: 40 }),
        region(1, {
          sourceInterval: { start: 9, end: 13 },
          contextInterval: { start: 8, end: 14 },
          deterministicRiskUtility: 24,
        }),
        region(2, {
          sourceInterval: { start: 21, end: 23 },
          contextInterval: { start: 20, end: 24 },
          deterministicRiskUtility: 8,
        }),
      ],
    });
    const selection = selectC60113UniqueAudioBudget({
      regions: features.regions,
      ranker: "R3_REGION_RISK_DENSITY_V3",
      budgetSeconds: 14,
    });
    expect(selection.selected.map((row) => row.regionId)).toEqual([
      "region-0",
      "region-1",
    ]);
    expect(selection.incrementalUniqueSeconds).toEqual([10, 4]);
    expect(
      c60113UniqueSeconds(selection.selected.map((row) => row.contextInterval)),
    ).toBe(14);
  });
  it("uses fixed review overhead so near-zero clips do not get infinite priority", () => {
    const features = buildC60113RegionFeatures({
      generatedAt,
      policyHash: hash,
      regions: [
        region(0, { mandatory: false, deterministicRiskUtility: 40 }),
        region(1, {
          sourceInterval: { start: 21, end: 21.01 },
          contextInterval: { start: 21, end: 21.01 },
          deterministicRiskUtility: 1,
        }),
      ],
    });
    const selection = selectC60113UniqueAudioBudget({
      regions: features.regions,
      ranker: "R3_REGION_RISK_DENSITY_V3",
      budgetSeconds: 10,
    });
    expect(c60113Require(selection.selected[0]).regionId).toBe("region-0");
  });
});

describe("C6.0.1.13 future deployment scoring", () => {
  it("actually applies frozen coefficients and binds resulting selection to deployment identity", () => {
    const features = buildC60113RegionFeatures({
      regions: [
        region(0, { mandatory: false }),
        region(1, { mandatory: false }),
      ],
      generatedAt,
      policyHash: buildC60113ReviewPolicy().semanticHash,
    });
    const trained = fitC60113LinearRanker(
      features.regions,
      new Set(["region-1"]),
    );
    const coefficients = trained.coefficients.map(() => 0);
    coefficients[0] = 10;
    const payload = {
      schemaVersion: "1.0.0",
      deploymentVersion: "c6.0.1.13-region-ranker-deployment-v1",
      rankerType: "L2_LOGISTIC_REGRESSION",
      featureSchemaVersion: "c60113-structural-features-v1",
      featureNames: [...c60113FeatureNames],
      rankingPolicy: "c6.0.1.13-region-burden-calibration-v1",
      mandatoryPolicy: "POSITIVE_SAFETY_EVIDENCE_ONLY",
      burdenSelectionPolicy: "MARGINAL_UNIQUE_AUDIO_GREEDY_FIXED_OVERHEAD_V1",
      fixedReviewOverheadSeconds: 8,
      model: {
        coefficients,
        intercept: 0,
        preprocessing: {
          featureNames: trained.preprocessing.featureNames,
          medians: trained.preprocessing.medians,
          means: trained.preprocessing.means,
          scales: trained.preprocessing.scales,
          missingValueEncoding: trained.preprocessing.missingValueEncoding,
        },
      },
    };
    const deployment = c60113DeploymentRankerSchema.parse({
      ...payload,
      semanticHash: c60113Hash(payload),
    });
    const scores = scoreC60113DeploymentRegions({ deployment, features });
    expect(scores?.["region-1"]).toBeGreaterThan(0.99);
    expect(scores?.["region-0"]).toBeLessThan(0.01);
    const selected = selectC60113DeploymentRegions({
      deployment,
      features,
      budgetSeconds: 10,
    });
    expect(selected.regions.map((row) => row.regionId)).toEqual(["region-1"]);
    expect(selected.deploymentRankerHash).toBe(deployment.semanticHash);
    expect(selected.machineFeaturesHash).toBe(features.semanticHash);
    expect(() =>
      scoreC60113DeploymentRegions({
        deployment: { ...deployment, semanticHash: hash },
        features,
      }),
    ).toThrow("DEPLOYMENT_RANKER_HASH_MISMATCH");
    expect(
      c60113DeploymentRankerSchema.safeParse({ ...deployment, goldHash: hash })
        .success,
    ).toBe(false);
    expect(
      c60113DeploymentRankerSchema.safeParse({
        ...deployment,
        model: {
          ...deployment.model,
          preprocessing: { ...trained.preprocessing },
        },
      }).success,
    ).toBe(false);
  });
});
