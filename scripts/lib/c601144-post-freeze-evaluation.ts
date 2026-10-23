import {
  c60114MachineCoverageProjectionSchema,
  type C60114ComponentCoverage,
  type C60114ErrorComponent,
  type C60114MachineCoverageProjection,
  type ChildUtility144,
  type ForcedInclusion144,
  type Hierarchy143,
  type OptionalChildLedger144,
  type PlanComparison144,
  type Planner144,
  type Propagation144,
  type ReviewAudio144,
  type ReviewPlayback144,
  type SafetyTargets144,
} from "@mvl/shared";
import { evaluateC60114PlaybackCoverage } from "../../packages/video-subtitler/src/review/playback-grounded-coverage-evaluator.js";
import { required141 } from "../../packages/video-subtitler/src/review/c601141-policy.js";

const tiers = [
  "TIER_5_VERIFIED_MULTI_FAMILY_SPEECH",
  "TIER_4_VERIFIED_INDEPENDENT_EXCLUSIVE_SPEECH",
  "TIER_3_VERIFIED_SINGLE_FAMILY_SPEECH",
  "TIER_2_MASKED_OR_SUBTHRESHOLD_SPEECH",
  "TIER_1_AUDIT_ONLY_SPEECH_CANDIDATE",
  "TIER_0_INELIGIBLE_OR_CONTRADICTED",
] as const;
type Tier = (typeof tiers)[number];
type Stage = "U0" | "U1" | "U2" | "U3" | "U4";
interface Interval {
  start: number;
  end: number;
}

const engineeringGates = {
  engineeringPassed: true,
  baselineParityPassed: true,
  runtimeGoldInputCount: 0 as const,
  canonicalMutationCount: 0,
  machineDraftMutationCount: 0,
  sourceMutationCount: 0,
  goldMutationCount: 0,
  machineFreezeVerified: true,
};

function emptyPlayback(
  projection: C60114MachineCoverageProjection,
  retainPhysicalAudio: boolean,
): C60114MachineCoverageProjection {
  return c60114MachineCoverageProjectionSchema.parse({
    ...projection,
    physicalAudio: retainPhysicalAudio ? projection.physicalAudio : [],
    playbackSegments: [],
    plans: projection.plans.map((plan) => ({
      ...plan,
      playbackSegmentIds: [],
    })),
  });
}

export function buildEvaluationProjections144(input: {
  previousOfficial: C60114MachineCoverageProjection;
  utilityOfficial: C60114MachineCoverageProjection;
}) {
  return [
    {
      stage: "U0" as const,
      description: "C6.0.1.14.3.1 official final",
      projection: input.previousOfficial,
    },
    {
      stage: "U1" as const,
      description: "utility annotation only with old selection unchanged",
      projection: input.previousOfficial,
    },
    {
      stage: "U2" as const,
      description: "utility-aware planner target projection",
      projection: emptyPlayback(input.utilityOfficial, false),
    },
    {
      stage: "U3" as const,
      description: "utility-aware physical audio projection",
      projection: emptyPlayback(input.utilityOfficial, true),
    },
    {
      stage: "U4" as const,
      description: "utility-aware final playback delivery",
      projection: input.utilityOfficial,
    },
  ];
}

function recall(
  rows: readonly C60114ComponentCoverage[],
  label: "MISSING_DIALOGUE" | "HALLUCINATION",
  covered: (row: C60114ComponentCoverage) => boolean,
) {
  const relevant = rows.filter((row) => row.labels.includes(label));
  const numerator = relevant.filter(covered).length;
  return {
    numerator,
    denominator: relevant.length,
    ratio: relevant.length ? numerator / relevant.length : 1,
  };
}

export function utilityTierCoverage144(
  selectedChildIds: readonly string[],
  utilities: ChildUtility144,
): Record<Tier, number> {
  const selected = new Set(selectedChildIds);
  const result = Object.fromEntries(tiers.map((tier) => [tier, 0])) as Record<
    Tier,
    number
  >;
  for (const row of utilities.rows)
    if (selected.has(row.childUnitId)) result[row.highestSpeechEvidenceTier]++;
  return result;
}

export function evaluateProjectionStages144(input: {
  projections: ReturnType<typeof buildEvaluationProjections144>;
  planIds: Record<Stage, string>;
  errorComponents: C60114ErrorComponent[];
  generatedAt: string;
  stageMetadata: Record<
    Stage,
    {
      safetyBundleCount: number;
      safetyCoreUnionSeconds: number;
      phaseAObligationCoverage: number;
      phaseARegressionCount: number;
      utilityTierCoverage: Record<Tier, number>;
    }
  >;
}) {
  return input.projections.map((variant) => {
    const evaluation = evaluateC60114PlaybackCoverage({
      ...variant.projection,
      errorComponents: input.errorComponents,
      generatedAt: input.generatedAt,
      engineeringGates,
    });
    const budget = required141(
      evaluation.budgets.find(
        (candidate) => candidate.planId === input.planIds[variant.stage],
      ),
      `C601144_EVALUATION_PLAN_MISSING:${variant.stage}`,
    );
    const meta = input.stageMetadata[variant.stage];
    const missing = (predicate: (row: C60114ComponentCoverage) => boolean) =>
      recall(budget.componentCoverage, "MISSING_DIALOGUE", predicate);
    const hallucination = (
      predicate: (row: C60114ComponentCoverage) => boolean,
    ) => recall(budget.componentCoverage, "HALLUCINATION", predicate);
    return {
      stage: variant.stage,
      description: variant.description,
      evaluation,
      budget,
      metric: {
        stage: variant.stage,
        integrityStatus:
          budget.integrityFailures.length === 0
            ? ("PASSED" as const)
            : ("FAILED" as const),
        targetCount: budget.selectedReviewTargetIds.length,
        safetyBundleCount: meta.safetyBundleCount,
        safetyCoreUnionSeconds: meta.safetyCoreUnionSeconds,
        reviewRegionCount: budget.selectedRegionIds.length,
        physicalAudioCount: budget.selectedAudioIds.length,
        playbackSegmentCount: budget.selectedPlaybackSegmentIds.length,
        fullQueueUniqueAudioSeconds: budget.actualAudibleUniqueSeconds,
        fullQueueEpisodeRatio:
          budget.actualAudibleUniqueSeconds /
          variant.projection.sourceIdentity.durationSeconds,
        phaseAObligationCoverage: meta.phaseAObligationCoverage,
        phaseARegressionCount: meta.phaseARegressionCount,
        utilityTierCoverage: meta.utilityTierCoverage,
        missingInventory: missing((row) => row.layers.machineSpeech.audible),
        missingTarget: missing((row) => row.layers.targetInterval.audible),
        missingPhysicalAudio: missing(
          (row) => row.layers.physicalAudio.audible,
        ),
        missingPlaybackAny: missing(
          (row) => row.layers.audibleReviewCoverage.any,
        ),
        missingPlaybackAudible: missing(
          (row) => row.layers.audibleReviewCoverage.audible,
        ),
        missingPlaybackFull: missing(
          (row) => row.layers.audibleReviewCoverage.full,
        ),
        missingLocalizedLexical: missing(
          (row) => row.layers.localizedLexical.audible,
        ),
        hallucinationTarget: hallucination(
          (row) => row.layers.targetInterval.audible,
        ),
        hallucinationPhysicalAudio: hallucination(
          (row) => row.layers.physicalAudio.audible,
        ),
        hallucinationPlaybackAudible: hallucination(
          (row) => row.layers.audibleReviewCoverage.audible,
        ),
      },
    };
  });
}

const overlaps = (left: readonly Interval[], right: readonly Interval[]) =>
  left.some((a) =>
    right.some((b) => Math.min(a.end, b.end) > Math.max(a.start, b.start)),
  );

export function componentDiagnoses144(input: {
  stages: ReturnType<typeof evaluateProjectionStages144>;
  hierarchy: Hierarchy143;
  childUtility: ChildUtility144;
  optional: OptionalChildLedger144;
  forced: ForcedInclusion144;
  planner: Planner144;
}) {
  const missing = required141(input.stages[4]).budget.componentCoverage.filter(
    (component) => component.labels.includes("MISSING_DIALOGUE"),
  );
  const stageRows = new Map(
    input.stages.map((stage) => [
      stage.stage,
      new Map(
        stage.budget.componentCoverage.map((component) => [
          component.errorComponentId,
          component,
        ]),
      ),
    ]),
  );
  const geometry = new Map(
    input.hierarchy.children.map((child) => [child.childUnitId, child]),
  );
  const childUtilities = new Map(
    input.childUtility.rows.map((row) => [row.childUnitId, row]),
  );
  const high = new Set([
    "TIER_5_VERIFIED_MULTI_FAMILY_SPEECH",
    "TIER_4_VERIFIED_INDEPENDENT_EXCLUSIVE_SPEECH",
  ]);
  const at = (stage: Stage, componentId: string) =>
    required141(
      required141(stageRows.get(stage)).get(componentId),
      `C601144_COMPONENT_STAGE_MISSING:${stage}:${componentId}`,
    );
  return missing.map((final) => {
    const id = final.errorComponentId;
    const u0 = at("U0", id),
      u1 = at("U1", id),
      u2 = at("U2", id),
      u3 = at("U3", id),
      u4 = at("U4", id);
    const relevant = input.optional.entries.filter((entry) => {
      const child = required141(geometry.get(entry.childUnitId));
      return overlaps(final.errorIntervals, child.atomicSourceIntervals);
    });
    const selectedRelevantOptionalChildIds = relevant
      .filter((entry) => entry.utilityPlannerSelected)
      .map((entry) => entry.childUnitId)
      .sort();
    const unselectedHighUtilityChildIds = relevant
      .filter(
        (entry) => !entry.utilityPlannerSelected && high.has(entry.utilityTier),
      )
      .map((entry) => entry.childUnitId)
      .sort();
    const forcedFeasible = relevant.some(
      (entry) =>
        !entry.utilityPlannerSelected &&
        high.has(entry.utilityTier) &&
        input.forced.evaluatedChildren.some(
          (row) =>
            row.childUnitId === entry.childUnitId &&
            row.searchComplete &&
            row.feasibility === "FEASIBLE",
        ),
    );
    const propagationZeroed = relevant.some((entry) =>
      required141(
        childUtilities.get(entry.childUnitId),
      ).reviewSafetyUtilityVector.every((value) => value === 0),
    );
    const stageReached: [Stage, boolean][] = [
      ["U0", u0.layers.audibleReviewCoverage.audible],
      ["U1", u1.layers.audibleReviewCoverage.audible],
      ["U2", u2.layers.targetInterval.audible],
      ["U3", u3.layers.physicalAudio.audible],
      ["U4", u4.layers.audibleReviewCoverage.audible],
    ];
    const bestStageReached =
      stageReached.filter(([, reached]) => reached).at(-1)?.[0] ?? null;
    let finalBlockingReason = "NONE";
    let finalDiagnosis:
      | "BASELINE_ALREADY_AUDIBLE"
      | "PRESERVED_BY_UTILITY_PLANNER"
      | "RECOVERED_BY_MACHINE_EVIDENCE_UTILITY"
      | "RECOVERED_BY_OPTIONAL_CHILD_SELECTION"
      | "RECOVERED_BY_UTILITY_AWARE_BUNDLE"
      | "INVENTORY_PRESENT_TARGET_MISSING"
      | "HIGH_UTILITY_CHILD_UNSELECTED"
      | "UTILITY_PROPAGATION_ZEROED"
      | "UTILITY_PLANNER_SELECTION_MISS"
      | "SAFETY_BUDGET_INFEASIBLE"
      | "PLANNER_SEARCH_INCOMPLETE"
      | "REVIEW_AUDIO_OMISSION"
      | "GOLD_MAPPING_UNRESOLVED";
    if (u4.layers.audibleReviewCoverage.status === "GOLD_MAPPING_UNRESOLVED") {
      finalBlockingReason = "GOLD_MAPPING_UNRESOLVED";
      finalDiagnosis = "GOLD_MAPPING_UNRESOLVED";
    } else if (u0.layers.audibleReviewCoverage.audible) {
      finalDiagnosis = "BASELINE_ALREADY_AUDIBLE";
    } else if (u4.layers.audibleReviewCoverage.audible) {
      finalDiagnosis = selectedRelevantOptionalChildIds.length
        ? "RECOVERED_BY_OPTIONAL_CHILD_SELECTION"
        : u2.layers.targetInterval.audible
          ? "RECOVERED_BY_UTILITY_AWARE_BUNDLE"
          : "RECOVERED_BY_MACHINE_EVIDENCE_UTILITY";
    } else if (!input.planner.searchComplete) {
      finalBlockingReason = "PLANNER_SEARCH_INCOMPLETE";
      finalDiagnosis = "PLANNER_SEARCH_INCOMPLETE";
    } else if (propagationZeroed) {
      finalBlockingReason = "UTILITY_PROPAGATION_ZEROED";
      finalDiagnosis = "UTILITY_PROPAGATION_ZEROED";
    } else if (
      u4.layers.machineSpeech.audible &&
      !u2.layers.targetInterval.audible &&
      forcedFeasible
    ) {
      finalBlockingReason = "HIGH_UTILITY_CHILD_UNSELECTED";
      finalDiagnosis = "HIGH_UTILITY_CHILD_UNSELECTED";
    } else if (
      u4.layers.machineSpeech.audible &&
      !u2.layers.targetInterval.audible &&
      unselectedHighUtilityChildIds.length > 0
    ) {
      finalBlockingReason = "UTILITY_PLANNER_SELECTION_MISS";
      finalDiagnosis = "UTILITY_PLANNER_SELECTION_MISS";
    } else if (u2.layers.targetInterval.audible) {
      finalBlockingReason = "REVIEW_AUDIO_OMISSION";
      finalDiagnosis = "REVIEW_AUDIO_OMISSION";
    } else if (input.planner.feasibilityStatus !== "FEASIBLE") {
      finalBlockingReason = "SAFETY_BUDGET_INFEASIBLE";
      finalDiagnosis = "SAFETY_BUDGET_INFEASIBLE";
    } else if (u4.layers.machineSpeech.audible) {
      finalBlockingReason = "INVENTORY_PRESENT_TARGET_MISSING";
      finalDiagnosis = "INVENTORY_PRESENT_TARGET_MISSING";
    } else {
      finalBlockingReason = "UTILITY_PLANNER_SELECTION_MISS";
      finalDiagnosis = "UTILITY_PLANNER_SELECTION_MISS";
    }
    return {
      errorComponentId: id,
      labels: final.labels,
      baselineInventoryStatus: u0.layers.machineSpeech.status,
      baselineTargetStatus: u0.layers.targetInterval.status,
      utilityTargetStatus: u2.layers.targetInterval.status,
      physicalAudioStatus: u3.layers.physicalAudio.status,
      playbackStatus: u4.layers.audibleReviewCoverage.status,
      lexicalStatus: u4.layers.localizedLexical.status,
      bestStageReached,
      finalStageStatus: u4.layers.audibleReviewCoverage.status,
      finalBlockingReason,
      selectedRelevantOptionalChildIds,
      unselectedHighUtilityChildIds,
      finalDiagnosis,
    };
  });
}

export function decideRoute144(input: {
  engineeringPassed: boolean;
  integrityPassed: boolean;
  propagation: Propagation144;
  childUtility: ChildUtility144;
  optional: OptionalChildLedger144;
  forced: ForcedInclusion144;
  planner: Planner144;
  comparison: PlanComparison144;
  safety: SafetyTargets144;
  audio: ReviewAudio144;
  playback: ReviewPlayback144;
  finalMetric: ReturnType<typeof evaluateProjectionStages144>[number]["metric"];
}) {
  const runtimeEqual = (left: unknown, right: unknown) => left === right;
  const utilityPropagationGate =
    runtimeEqual(input.propagation.silentUtilityLossCount, 0) &&
    runtimeEqual(input.childUtility.eligibleChildZeroUtilityCount, 0);
  const monotonicityGate =
    runtimeEqual(input.planner.obligationCoverageRatio, 1) &&
    runtimeEqual(input.planner.droppedObligationCount, 0);
  const plannerGate =
    input.planner.searchComplete && input.forced.searchIncompleteCount === 0;
  const safetyBudgetGate =
    input.planner.feasibilityStatus === "FEASIBLE" &&
    input.planner.activeBundleCount <= 24 &&
    input.planner.coreUnionSeconds <= 60;
  const forcedFeasibleUnselected = input.optional.entries.filter(
    (entry) =>
      !entry.utilityPlannerSelected &&
      [
        "TIER_5_VERIFIED_MULTI_FAMILY_SPEECH",
        "TIER_4_VERIFIED_INDEPENDENT_EXCLUSIVE_SPEECH",
      ].includes(entry.utilityTier) &&
      entry.forcedInclusionEvaluated &&
      entry.forcedInclusionSearchComplete &&
      entry.forcedInclusionFeasibility === "FEASIBLE",
  );
  const finalTargetSelectionGate = forcedFeasibleUnselected.length === 0;
  const reviewDeliveryGate =
    input.audio.audioExtractionFailureCount === 0 &&
    input.audio.plannedAudioCount === input.audio.actualAudioCount &&
    input.audio.actualAudioCount === input.audio.playableAudioCount &&
    input.audio.actualAudioCount === input.audio.hashVerifiedAudioCount;
  const playbackGate =
    runtimeEqual(input.playback.playbackToAudioCoverageRatio, 1) &&
    runtimeEqual(input.playback.playbackToTargetCoverageRatio, 1);
  const fullQueueCoverageGate =
    input.finalMetric.missingInventory.ratio === 1 &&
    input.finalMetric.missingTarget.ratio === 1 &&
    input.finalMetric.missingPhysicalAudio.ratio === 1 &&
    input.finalMetric.missingPlaybackAudible.ratio === 1 &&
    input.finalMetric.hallucinationPlaybackAudible.ratio === 1;
  const fullQueueQualityGate =
    input.comparison.objectiveNonDegradation &&
    input.planner.predictedFullQueueEpisodeRatio <= 0.95 &&
    runtimeEqual(input.safety.wholeEpisodeCatchAllCount, 0);
  const reasons: string[] = [];
  let route:
    | "GO_C6_0_1_15_REGION_RANKER_RECALIBRATION"
    | "HOLD_FOR_MACHINE_EVIDENCE_UTILITY_PROPAGATION_REPAIR"
    | "HOLD_FOR_MACHINE_EVIDENCE_UTILITY_SELECTION_REPAIR"
    | "HOLD_FOR_SAFETY_BUDGET_MODEL_REDESIGN"
    | "HOLD_FOR_PLANNER_SEARCH_COMPLETENESS"
    | "HOLD_FOR_REVIEW_AUDIO_COVERAGE_REPAIR"
    | "HOLD_FOR_EVALUATION_INTEGRITY_REPAIR"
    | "HOLD_FOR_ENGINEERING_REPAIR" =
    "GO_C6_0_1_15_REGION_RANKER_RECALIBRATION";
  if (!input.engineeringPassed) {
    route = "HOLD_FOR_ENGINEERING_REPAIR";
    reasons.push("PRE_GOLD_ENGINEERING_VALIDATION_FAILED");
  } else if (!input.integrityPassed) {
    route = "HOLD_FOR_EVALUATION_INTEGRITY_REPAIR";
    reasons.push("PROJECTION_NESTED_OR_EVALUATION_INTEGRITY_FAILED");
  } else if (!utilityPropagationGate) {
    route = "HOLD_FOR_MACHINE_EVIDENCE_UTILITY_PROPAGATION_REPAIR";
    reasons.push("POSITIVE_MACHINE_EVIDENCE_UTILITY_PROPAGATION_FAILED");
  } else if (!monotonicityGate) {
    route = "HOLD_FOR_EVALUATION_INTEGRITY_REPAIR";
    reasons.push("PHASE_A_OBLIGATION_MONOTONICITY_FAILED");
  } else if (!plannerGate) {
    route = "HOLD_FOR_PLANNER_SEARCH_COMPLETENESS";
    reasons.push("PRODUCTION_OR_FORCED_INCLUSION_SEARCH_INCOMPLETE");
  } else if (!safetyBudgetGate) {
    const allForcedInfeasible =
      input.forced.evaluatedCount > 0 &&
      input.forced.infeasibleCount === input.forced.evaluatedCount;
    route = allForcedInfeasible
      ? "HOLD_FOR_SAFETY_BUDGET_MODEL_REDESIGN"
      : "HOLD_FOR_PLANNER_SEARCH_COMPLETENESS";
    reasons.push(
      allForcedInfeasible
        ? "ALL_REQUIRED_HIGH_UTILITY_FORCED_INCLUSIONS_INFEASIBLE_PROVEN"
        : "BUDGET_FEASIBILITY_NOT_PROVEN",
    );
  } else if (!finalTargetSelectionGate) {
    route = "HOLD_FOR_MACHINE_EVIDENCE_UTILITY_SELECTION_REPAIR";
    reasons.push(
      `FORCED_FEASIBLE_HIGH_UTILITY_OPTIONAL_CHILD_UNSELECTED:${forcedFeasibleUnselected.length}`,
    );
  } else if (!reviewDeliveryGate || !playbackGate || !fullQueueCoverageGate) {
    route = "HOLD_FOR_REVIEW_AUDIO_COVERAGE_REPAIR";
    reasons.push("FINAL_TARGET_AUDIO_OR_PLAYBACK_COVERAGE_FAILED");
  } else if (!fullQueueQualityGate) {
    route = "HOLD_FOR_REVIEW_AUDIO_COVERAGE_REPAIR";
    reasons.push("FULL_QUEUE_QUALITY_OR_BURDEN_GATE_FAILED");
  } else reasons.push("ALL_C6_0_1_14_4_GATES_PASSED");
  return {
    route,
    utilityPropagationGate,
    monotonicityGate,
    plannerGate,
    safetyBudgetGate,
    finalTargetSelectionGate,
    reviewDeliveryGate,
    playbackGate,
    fullQueueCoverageGate,
    fullQueueQualityGate,
    reasons,
    forcedFeasibleUnselectedCount: forcedFeasibleUnselected.length,
  };
}
