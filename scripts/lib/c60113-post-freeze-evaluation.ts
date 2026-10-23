import {
  c60113MissingEvidenceEvaluationSchema,
  c60113MissingClassificationSchema,
} from "@mvl/shared";
import type {
  C60113RegionFeatures,
  C60113RegionLabels,
  C60113RankerFolds,
  C60113ReviewBurdenPlans,
  MachineVsGoldEvaluation,
  C60113MissingSpeechEvidence,
  MachineReviewItems,
} from "@mvl/shared";
import {
  c60113IncrementalSeconds,
  c60113UniqueSeconds,
  c60113Require,
  c60113HashPayload,
  type C60113Interval,
} from "../../packages/video-subtitler/src/review/c60113-region-features.js";
import { evaluateC60113RegionSelection } from "../../packages/video-subtitler/src/review/c60113-region-evaluation.js";

/** Reuse exact upstream defect IDs and alignment lineage; never infer IDs from dialogue. */
export function c60113GoldErrorIntervals(
  evaluation: MachineVsGoldEvaluation,
): Record<string, C60113Interval> {
  const byAlignment = new Map(
    evaluation.alignments.map((alignment) => [
      alignment.alignmentId,
      alignment,
    ]),
  );
  const intervals = new Map<string, C60113Interval[]>();
  for (const defect of [
    ...evaluation.materialTextErrors,
    ...evaluation.severeTimingErrors,
    ...evaluation.missingDialogueCandidates,
    ...evaluation.hallucinationCandidates,
  ]) {
    for (const id of defect.alignmentIds) {
      const alignment = byAlignment.get(id);
      if (!alignment) throw new Error("GOLD_DEFECT_ALIGNMENT_LINEAGE_MISSING");
      const start = alignment.goldStart ?? alignment.machineStart;
      const end = alignment.goldEnd ?? alignment.machineEnd;
      if (start === null || end === null || end <= start) continue;
      intervals.set(defect.defectId, [
        ...(intervals.get(defect.defectId) ?? []),
        { start, end },
      ]);
    }
  }
  return Object.fromEntries(
    [...intervals].map(([id, values]) => [
      id,
      {
        start: Math.min(...values.map((value) => value.start)),
        end: Math.max(...values.map((value) => value.end)),
      },
    ]),
  );
}

export interface C60113FrozenSelectionPlan {
  planId: string;
  budgetSeconds: number | null;
  regionIds: string[];
  expectedUniqueUnionSeconds?: number;
}

/** Native old queue baseline: no invented new evidence and no learned fitting. */
export function c60113NativeLegacyPlans(
  features: C60113RegionFeatures,
  episodeDurationSeconds: number,
): C60113FrozenSelectionPlan[] {
  const ordered = [...features.regions].sort(
    (a, b) =>
      b.legacyRegionPriority - a.legacyRegionPriority ||
      a.sourceInterval.start - b.sourceInterval.start ||
      a.regionId.localeCompare(b.regionId),
  );
  const definitions = [
    ...[10, 20, 30, 40, 50].map((percent) => ({
      planId: `UNIQUE_AUDIO_${percent}_PERCENT`,
      budgetSeconds: (episodeDurationSeconds * percent) / 100,
    })),
    ...[90, 180, 270, 360, 450].map((seconds) => ({
      planId: `UNIQUE_AUDIO_${seconds}_SECONDS`,
      budgetSeconds: seconds,
    })),
    { planId: "ALL_MANDATORY", budgetSeconds: null },
    { planId: "FULL_QUEUE", budgetSeconds: null },
  ];
  return definitions.map((definition) => {
    const selected: typeof ordered = [];
    for (const row of ordered) {
      if (definition.planId === "ALL_MANDATORY" && !row.mandatory) continue;
      if (
        definition.budgetSeconds !== null &&
        c60113UniqueSeconds([
          ...selected.map((region) => region.contextInterval),
          row.contextInterval,
        ]) >
          definition.budgetSeconds + 1e-7
      )
        continue;
      selected.push(row);
    }
    return {
      ...definition,
      regionIds: selected.map((row) => row.regionId),
      expectedUniqueUnionSeconds: c60113UniqueSeconds(
        selected.map((row) => row.contextInterval),
      ),
    };
  });
}

export function c60113FrozenPlans(
  plans: C60113ReviewBurdenPlans,
): C60113FrozenSelectionPlan[] {
  return plans.plans.map((plan) => ({
    planId: plan.planId,
    budgetSeconds: plan.budgetSeconds,
    regionIds: plan.regionIds,
    expectedUniqueUnionSeconds: plan.uniqueUnionSeconds,
  }));
}

export function evaluateC60113FrozenPlans(input: {
  features: C60113RegionFeatures;
  folds: C60113RankerFolds;
  labels: C60113RegionLabels;
  plans: C60113FrozenSelectionPlan[];
  episodeDurationSeconds: number;
}) {
  const one = (plan: C60113FrozenSelectionPlan, foldId?: string) => {
    const fold =
      foldId === undefined
        ? null
        : c60113Require(
            input.folds.folds.find((entry) => entry.foldId === foldId),
          );
    const selected = plan.regionIds
      .filter((id) => fold === null || fold.regionIds.includes(id))
      .map((id) =>
        c60113Require(
          input.features.regions.find((row) => row.regionId === id),
        ),
      );
    if (new Set(plan.regionIds).size !== plan.regionIds.length)
      throw new Error("DUPLICATE_REGION_IN_FROZEN_BURDEN_PLAN");
    const previous: C60113Interval[] = [];
    const incrementalUniqueSeconds = selected.map((row) => {
      const seconds = c60113IncrementalSeconds(row.contextInterval, previous);
      previous.push(row.contextInterval);
      return seconds;
    });
    const actual = c60113UniqueSeconds(previous);
    if (
      fold === null &&
      plan.expectedUniqueUnionSeconds !== undefined &&
      Math.abs(actual - plan.expectedUniqueUnionSeconds) > 1e-6
    )
      throw new Error("FROZEN_BURDEN_PLAN_UNIQUE_AUDIO_MISMATCH");
    return evaluateC60113RegionSelection({
      budget: plan.planId,
      budgetSeconds: plan.budgetSeconds ?? input.episodeDurationSeconds,
      selected,
      incrementalUniqueSeconds,
      components:
        fold === null
          ? input.labels.errorComponents
          : input.labels.errorComponents.filter(
              (component) => component.foldId === fold.foldId,
            ),
    });
  };
  return {
    metrics: input.plans.map((plan) => one(plan)),
    foldMetrics: input.folds.folds.map((fold) => ({
      foldId: fold.foldId,
      metrics: input.plans.map((plan) => one(plan, fold.foldId)),
    })),
  };
}

export function evaluateC60113MissingEvidence(input: {
  missingEvidence: Pick<
    C60113MissingSpeechEvidence,
    "policyVersion" | "semanticHash"
  > & {
    gaps: Pick<
      C60113MissingSpeechEvidence["gaps"][number],
      "gapId" | "itemIds" | "classification"
    >[];
  };
  legacyItems: {
    items: Pick<
      MachineReviewItems["items"][number],
      "reviewItemId" | "itemTypes"
    >[];
  };
  labels: C60113RegionLabels;
  generatedAt: string;
}) {
  const missing = input.labels.errorComponents.filter((component) =>
    component.labels.includes("MISSING_DIALOGUE"),
  );
  const legacy = input.legacyItems.items.filter((item) =>
    item.itemTypes.includes("MISSING_SPEECH_RISK"),
  );
  const legacyIds = new Set(legacy.map((item) => item.reviewItemId));
  const trueItems = legacy.filter((item) =>
    missing.some((component) =>
      component.coveredItemIds.includes(item.reviewItemId),
    ),
  );
  const coveredByGap = (gap: (typeof input.missingEvidence.gaps)[number]) =>
    missing.filter((component) =>
      gap.itemIds.some((id) => component.coveredItemIds.includes(id)),
    );
  const classificationMetrics = c60113MissingClassificationSchema.options.map(
    (classification) => {
      const gaps = input.missingEvidence.gaps.filter(
        (gap) => gap.classification === classification,
      );
      const truePositiveGapCount = gaps.filter(
        (gap) => coveredByGap(gap).length > 0,
      ).length;
      const capturedMissingComponentIds = [
        ...new Set(
          gaps.flatMap((gap) =>
            coveredByGap(gap).map((component) => component.errorComponentId),
          ),
        ),
      ].sort();
      return {
        classification,
        gapCount: gaps.length,
        truePositiveGapCount,
        falsePositiveGapCount: gaps.length - truePositiveGapCount,
        precisionIfTreatedAsMissing: gaps.length
          ? truePositiveGapCount / gaps.length
          : null,
        capturedMissingComponentIds,
        recall: missing.length
          ? capturedMissingComponentIds.length / missing.length
          : 1,
      };
    },
  );
  const components = missing.map((component) => {
    const gaps = input.missingEvidence.gaps.filter((gap) =>
      gap.itemIds.some((id) => component.coveredItemIds.includes(id)),
    );
    const capturedByStrong = gaps.some(
      (gap) => gap.classification === "MISSING_DIALOGUE_STRONG",
    );
    return {
      errorComponentId: component.errorComponentId,
      sourceInterval: component.sourceInterval,
      capturedByAnyGap: gaps.length > 0,
      capturedByStrong,
      gapIds: gaps.map((gap) => gap.gapId).sort(),
      legacyItemIds: component.coveredItemIds
        .filter((id) => legacyIds.has(id))
        .sort(),
      classifications: [...new Set(gaps.map((gap) => gap.classification))],
      evidenceGapReason: capturedByStrong
        ? "POSITIVE_INDEPENDENT_MISSING_EVIDENCE_PRESENT"
        : gaps.length
          ? "GAP_OBSERVED_BUT_STRONG_LEXICAL_INDEPENDENCE_OR_COVERAGE_GATES_NOT_MET"
          : "NO_FROZEN_GAP_ITEM_LINEAGE_COVERS_MISSING_COMPONENT",
    };
  });
  const anyGapCapturedMissingComponentCount = components.filter(
    (component) => component.capturedByAnyGap,
  ).length;
  const strongCapturedMissingComponentCount = components.filter(
    (component) => component.capturedByStrong,
  ).length;
  const payload = {
    schemaVersion: "1.0.0",
    policyVersion: input.missingEvidence.policyVersion,
    artifactType: "c6-0-1-13-missing-evidence-evaluation",
    generatedAt: input.generatedAt,
    machineFreezeHash: input.labels.machineFreezeHash,
    missingEvidenceHash: input.missingEvidence.semanticHash,
    labelsHash: input.labels.semanticHash,
    evaluationOnly: true,
    classificationChangedByGold: false,
    denominatorMeaning:
      "DISTINCT_GAPS_AND_DISTINCT_LEGACY_ITEMS_REPORTED_SEPARATELY",
    totalGoldMissingComponents: missing.length,
    legacyMissingItemCount: legacy.length,
    deduplicatedGapCount: input.missingEvidence.gaps.length,
    legacyTruePositiveItemCount: trueItems.length,
    legacyFalsePositiveItemCount: legacy.length - trueItems.length,
    legacyItemPrecision: legacy.length
      ? trueItems.length / legacy.length
      : null,
    anyGapCapturedMissingComponentCount,
    anyGapRecall: missing.length
      ? anyGapCapturedMissingComponentCount / missing.length
      : 1,
    strongCapturedMissingComponentCount,
    strongRecall: missing.length
      ? strongCapturedMissingComponentCount / missing.length
      : 1,
    classifications: classificationMetrics,
    components,
  };
  return c60113MissingEvidenceEvaluationSchema.parse({
    ...payload,
    semanticHash: c60113HashPayload(payload),
  });
}
