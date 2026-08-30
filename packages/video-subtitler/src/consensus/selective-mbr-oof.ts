import {
  c611CalibrationLabelSchema,
  c611DecisionSchema,
  c611NestedCalibrationAuditSchema,
  c611OofDecisionsSchema,
  c611SelectiveMetricsSchema,
  type C611CalibrationFolds,
  type C611CalibrationLabel,
  type C611CalibrationPolicy,
  type C611CalibrationProfileId,
  type C611CalibrationSample,
  type C611Decision,
  type C611NestedCalibrationAudit,
  type C611OofDecisions,
  type C611SelectiveMetrics,
  type C611ThresholdCandidate,
} from "@mvl/shared";
import { machineQualitySemanticHash as hash } from "../machine-quality/evidence-correlation.js";
import { c61Require } from "./japanese-text-representation.js";
import {
  partitionC611Contiguous,
  verifyC611Folds,
} from "./selective-mbr-folds.js";
import {
  c611CatastrophicDeletion,
  c611LabelEvaluable,
  fitC611SelectiveModel,
  predictC611SelectiveModel,
  rankC611ThresholdCandidates,
  selectC611Threshold,
  validateC611Samples,
  verifyC611CalibrationPolicy,
} from "./selective-mbr-calibration.js";
export function c611WilsonInterval(
  correct: number,
  n: number,
): C611SelectiveMetrics["wilson"] {
  if (
    !Number.isInteger(n) ||
    !Number.isInteger(correct) ||
    n < 0 ||
    correct < 0 ||
    correct > n
  )
    throw new Error("C611_INVALID_WILSON_COUNTS");
  if (n === 0) return { lower: null, upper: null, confidenceLevel: 0.95, n };
  const z = 1.959963984540054;
  const p = correct / n,
    denominator = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denominator;
  const radius =
    (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;
  return {
    lower: Math.max(0, center - radius),
    upper: Math.min(1, center + radius),
    confidenceLevel: 0.95,
    n,
  };
}
/** Accept the fixed evaluator's richer labels but deliberately retain no text. */
export function c611CalibrationLabels(
  input: C611CalibrationLabel[],
): C611CalibrationLabel[] {
  const result = input.map((x) =>
    c611CalibrationLabelSchema.parse({
      proposalId: x.proposalId,
      eventId: x.eventId,
      groupIds: x.groupIds,
      groupIdentityHash: x.groupIdentityHash,
      outcome: x.outcome,
      baselineError: x.baselineError,
      proposedError: x.proposedError,
      exactGain: x.exactGain,
      normalizedGain: x.normalizedGain,
      semanticHash: x.semanticHash,
    }),
  );
  if (new Set(result.map((x) => x.proposalId)).size !== result.length)
    throw new Error("C611_DUPLICATE_PROPOSAL_LABEL");
  for (const label of result) {
    if (label.outcome === "SWITCH_UNEVALUABLE") {
      if (
        label.normalizedGain !== null ||
        label.exactGain !== null ||
        label.baselineError !== null ||
        label.proposedError !== null
      )
        throw new Error("C611_UNEVALUABLE_HAS_ERROR_VALUE");
    } else if (
      label.baselineError === null ||
      label.proposedError === null ||
      label.normalizedGain !== label.baselineError - label.proposedError ||
      label.exactGain === null ||
      (label.outcome === "SWITCH_IMPROVES" && label.normalizedGain <= 0) ||
      (label.outcome === "SWITCH_REGRESSES" && label.normalizedGain >= 0) ||
      (label.outcome === "SWITCH_NEUTRAL" && label.normalizedGain !== 0)
    )
      throw new Error("C611_LABEL_GAIN_CONTRADICTION");
  }
  return result.sort((a, b) => a.proposalId.localeCompare(b.proposalId));
}
export function calculateC611SelectiveMetrics(input: {
  profileId: C611CalibrationProfileId;
  foldId?: string;
  samples: C611CalibrationSample[];
  labels: C611CalibrationLabel[];
  decisions: C611Decision[];
  policy: C611CalibrationPolicy;
  candidateOracleAvailableGain?: number;
}): C611SelectiveMetrics {
  const samples = input.samples;
  const labels = new Map(input.labels.map((l) => [l.proposalId, l]));
  const byId = new Map(samples.map((s) => [s.proposalId, s]));
  const eligible = samples.filter((s) => s.eligibilityStatus === "ELIGIBLE");
  const evaluable = eligible.filter((s) =>
    c611LabelEvaluable(labels.get(s.proposalId)),
  );
  const selected = input.decisions.filter(
    (d) => d.decision === "SELECT_EXISTING_CANDIDATE",
  );
  if (
    selected.some(
      (d) => byId.get(d.proposalId)?.eligibilityStatus !== "ELIGIBLE",
    )
  )
    throw new Error("C611_SELECTED_INELIGIBLE_PROPOSAL");
  const evaluated = selected.filter((d) =>
    c611LabelEvaluable(labels.get(d.proposalId)),
  );
  const correctSwitchCount = evaluated.filter(
    (d) => c61Require(labels.get(d.proposalId)).outcome === "SWITCH_IMPROVES",
  ).length;
  const wrongSwitchCount = evaluated.filter(
    (d) => c61Require(labels.get(d.proposalId)).outcome === "SWITCH_REGRESSES",
  ).length;
  const neutralSwitchCount = evaluated.filter(
    (d) => c61Require(labels.get(d.proposalId)).outcome === "SWITCH_NEUTRAL",
  ).length;
  const normalizedEditGain = evaluated.reduce(
    (sum, d) =>
      sum + c61Require(c61Require(labels.get(d.proposalId)).normalizedGain),
    0,
  );
  const exactEditGain = evaluated.reduce(
    (sum, d) =>
      sum + c61Require(c61Require(labels.get(d.proposalId)).exactGain),
    0,
  );
  const oracleAvailableGain = evaluable.reduce(
    (sum, s) =>
      sum +
      Math.max(
        0,
        c61Require(c61Require(labels.get(s.proposalId)).normalizedGain),
      ),
    0,
  );
  const groupUses = new Map<string, number>();
  for (const sample of evaluable)
    for (const group of new Set(
      c61Require(labels.get(sample.proposalId)).groupIds,
    ))
      groupUses.set(group, (groupUses.get(group) ?? 0) + 1);
  const minimumActiveSelected = Math.max(
    input.policy.outerMinimumSelected,
    Math.ceil(evaluable.length * input.policy.minimumSelectedFraction),
  );
  const body: Omit<C611SelectiveMetrics, "semanticHash"> = {
    profileId: input.profileId,
    foldId: input.foldId ?? null,
    metricUnit: "FROZEN_SINGLE_PROPOSAL_COUNTERFACTUAL",
    sharedEvaluationGroupCount: [...groupUses.values()].filter((n) => n > 1)
      .length,
    eligibleProposalCount: eligible.length,
    evaluableProposalCount: evaluable.length,
    selectedCount: selected.length,
    evaluableSelectedCount: evaluated.length,
    selectedUnevaluableCount: selected.length - evaluated.length,
    correctSwitchCount,
    wrongSwitchCount,
    neutralSwitchCount,
    blockedCount: input.decisions.filter(
      (d) => d.decision === "BLOCKED_STRUCTURAL",
    ).length,
    abstainCount: input.decisions.filter(
      (d) =>
        d.decision === "ABSTAIN_REVIEW" ||
        d.decision === "UNEVALUABLE_FOR_CALIBRATION",
    ).length,
    precision: evaluated.length ? correctSwitchCount / evaluated.length : null,
    harmRate: evaluated.length ? wrongSwitchCount / evaluated.length : null,
    selectiveCoverage: evaluable.length
      ? evaluated.length / evaluable.length
      : null,
    allEligibleCoverage: eligible.length
      ? selected.length / eligible.length
      : null,
    rawSelectedOverEvaluableRatio: evaluable.length
      ? selected.length / evaluable.length
      : null,
    normalizedEditGain,
    exactEditGain,
    oracleAvailableGain,
    oracleCaptureRate:
      oracleAvailableGain > 0 ? normalizedEditGain / oracleAvailableGain : null,
    candidateOracleAvailableGain: input.candidateOracleAvailableGain ?? null,
    candidateOracleCaptureRate:
      (input.candidateOracleAvailableGain ?? 0) > 0
        ? normalizedEditGain / c61Require(input.candidateOracleAvailableGain)
        : null,
    catastrophicDeletionRegressionCount: evaluated.filter((d) =>
      c611CatastrophicDeletion(
        c61Require(byId.get(d.proposalId)),
        c61Require(labels.get(d.proposalId)),
        input.policy,
      ),
    ).length,
    minimumActiveSelected,
    modelClass:
      input.profileId === "S0"
        ? "SAFE_NULL_BASELINE"
        : input.profileId === "S1"
          ? "LEGACY_NONSELECTIVE_CONTROL"
          : evaluated.length >= minimumActiveSelected
            ? "ACTIVE_SELECTIVE_MODEL"
            : "INACTIVE_SELECTIVE_MODEL",
    wilson: c611WilsonInterval(correctSwitchCount, evaluated.length),
  };
  return c611SelectiveMetricsSchema.parse({
    ...body,
    semanticHash: hash(body),
  });
}
function decision(input: Omit<C611Decision, "semanticHash">): C611Decision {
  return c611DecisionSchema.parse({ ...input, semanticHash: hash(input) });
}
export interface C611OofInput {
  samples: C611CalibrationSample[];
  labels: C611CalibrationLabel[];
  folds: C611CalibrationFolds;
  policy: C611CalibrationPolicy;
  legacy: {
    samples: C611CalibrationSample[];
    labels: C611CalibrationLabel[];
    selectedProposalIds: string[];
  };
  candidateOracleAvailableGain?: number;
}
/** Nested OOF orchestrator. Labels enter training/metrics, NEVER test prediction. */
export function runC611Oof(input: C611OofInput): C611OofDecisions {
  const { policy, folds } = input;
  verifyC611CalibrationPolicy(policy);
  verifyC611Folds(folds, policy);
  const primary = validateC611Samples(input.samples),
    legacy = validateC611Samples(input.legacy.samples);
  const primaryLabels = c611CalibrationLabels(input.labels),
    legacyLabels = c611CalibrationLabels(input.legacy.labels);
  const eventFold = new Map(
    folds.folds.flatMap((fold) =>
      fold.eventIds.map((eventId) => [eventId, fold.foldId] as const),
    ),
  );
  if (
    new Set(primary.map((x) => x.eventId)).size !== primary.length ||
    new Set(legacy.map((x) => x.eventId)).size !== legacy.length
  )
    throw new Error("C611_MULTIPLE_PRIMARY_PROPOSALS_PER_EVENT");
  if (
    primary.length !== eventFold.size ||
    legacy.length !== eventFold.size ||
    [...primary, ...legacy].some((s) => !eventFold.has(s.eventId))
  )
    throw new Error("C611_OOF_EVENT_UNIVERSE_MISMATCH");
  for (const [samples, labels] of [
    [primary, primaryLabels],
    [legacy, legacyLabels],
  ] as const) {
    const sampleMap = new Map(samples.map((s) => [s.proposalId, s]));
    if (
      labels.length !== samples.length ||
      labels.some((l) => sampleMap.get(l.proposalId)?.eventId !== l.eventId)
    )
      throw new Error("C611_LABEL_SAMPLE_IDENTITY_MISMATCH");
    const groupFolds = new Map<string, Set<string>>();
    for (const label of labels.filter(c611LabelEvaluable))
      for (const groupId of label.groupIds) {
        const assigned = groupFolds.get(groupId) ?? new Set<string>();
        assigned.add(c61Require(eventFold.get(label.eventId)));
        groupFolds.set(groupId, assigned);
      }
    if ([...groupFolds.values()].some((group) => group.size > 1))
      throw new Error("C611_EVALUABLE_FIXED_GROUP_CROSSES_FOLDS");
  }
  const legacySelected = new Set(input.legacy.selectedProposalIds);
  if (
    input.legacy.selectedProposalIds.length !== legacySelected.size ||
    [...legacySelected].some(
      (id) =>
        !legacy.some(
          (sample) =>
            sample.proposalId === id && sample.eligibilityStatus === "ELIGIBLE",
        ),
    )
  )
    throw new Error("C611_INVALID_LEGACY_SELECTION");
  const decisions: C611Decision[] = [],
    calibrationAudits: C611NestedCalibrationAudit[] = [];
  const profileMetrics: C611SelectiveMetrics[] = [],
    foldMetrics: C611SelectiveMetrics[] = [];
  for (const profile of policy.profiles) {
    const samples = profile.profileId === "S1" ? legacy : primary;
    const labels = profile.profileId === "S1" ? legacyLabels : primaryLabels;
    const labelMap = new Map(labels.map((x) => [x.proposalId, x]));
    const profileDecisions: C611Decision[] = [];
    for (const outer of folds.folds) {
      const testEvents = new Set(outer.eventIds);
      const train = samples.filter((s) => !testEvents.has(s.eventId));
      const test = samples.filter((s) => testEvents.has(s.eventId));
      const trainIds = new Set(train.map((s) => s.proposalId));
      const trainLabels = labels.filter((l) => trainIds.has(l.proposalId));
      const innerSplits: C611NestedCalibrationAudit["innerSplits"] = [];
      const thresholdCandidates: C611ThresholdCandidate[] = [];
      const calibrationProfile =
        profile.profileId !== "S0" && profile.profileId !== "S1";
      let threshold: number | null = null,
        preservationCost = 0,
        minimumInnerSelected = policy.innerMinimumSelected;
      if (calibrationProfile && folds.status === "READY") {
        const trainEvents = new Set(train.map((s) => s.eventId));
        const groups = folds.groups.filter((group) =>
          group.eventIds.some((id) => trainEvents.has(id)),
        );
        const innerPartitions = partitionC611Contiguous(
          groups,
          policy.innerFoldCount,
          (group) => group.eventIds.length,
        );
        if (innerPartitions.length >= 2)
          for (const cost of profile.profileId === "S4"
            ? policy.preservationCosts
            : [0]) {
            const scored: {
              sample: C611CalibrationSample;
              score: number | null;
              label: C611CalibrationLabel | undefined;
            }[] = [];
            for (
              let innerIndex = 0;
              innerIndex < innerPartitions.length;
              innerIndex++
            ) {
              const testIds = new Set(
                c61Require(innerPartitions[innerIndex]).flatMap(
                  (group) => group.eventIds,
                ),
              );
              const innerTrain = train.filter((s) => !testIds.has(s.eventId)),
                innerTest = train.filter((s) => testIds.has(s.eventId));
              const innerTrainIds = new Set(
                innerTrain.map((s) => s.proposalId),
              );
              const model = fitC611SelectiveModel(
                innerTrain,
                trainLabels.filter((l) => innerTrainIds.has(l.proposalId)),
                profile.profileId,
                policy,
                cost,
              );
              const predictions = innerTest.map((sample) => ({
                proposalId: sample.proposalId,
                score: predictC611SelectiveModel(sample, model, policy),
              }));
              for (let i = 0; i < innerTest.length; i++)
                scored.push({
                  sample: c61Require(innerTest[i]),
                  score: c61Require(predictions[i]).score,
                  label: labelMap.get(c61Require(innerTest[i]).proposalId),
                });
              innerSplits.push({
                foldId: `${outer.foldId}/inner-${innerIndex + 1}`,
                trainingProposalIds: innerTrain.map((s) => s.proposalId),
                testProposalIds: innerTest.map((s) => s.proposalId),
                modelHash: model.semanticHash,
                model,
                preservationCost: cost,
                predictions,
              });
            }
            const selected = selectC611Threshold(scored, policy, cost);
            thresholdCandidates.push(...selected.candidates);
            minimumInnerSelected = selected.minimumSelected;
          }
        const best = rankC611ThresholdCandidates(thresholdCandidates)[0];
        if (best) {
          threshold = best.threshold;
          preservationCost = best.preservationCost;
        }
      }
      const model = fitC611SelectiveModel(
        calibrationProfile ? train : [],
        calibrationProfile ? trainLabels : [],
        profile.profileId,
        policy,
        preservationCost,
      );
      for (const sample of test) {
        const score = predictC611SelectiveModel(sample, model, policy);
        let action: C611Decision["decision"] = "KEEP_CURRENT";
        const reasons: string[] = [];
        if (sample.eligibilityStatus === "BLOCKED_STRUCTURAL") {
          action = "BLOCKED_STRUCTURAL";
          reasons.push("STRUCTURAL_PROPOSAL_INELIGIBLE");
        } else if (sample.eligibilityStatus === "NO_ALTERNATIVE")
          reasons.push("NO_EXISTING_ALTERNATIVE");
        else if (profile.profileId === "S0")
          reasons.push("EXPLICIT_SAFE_NULL_BASELINE");
        else if (profile.profileId === "S1") {
          action = legacySelected.has(sample.proposalId)
            ? "SELECT_EXISTING_CANDIDATE"
            : "KEEP_CURRENT";
          reasons.push("FROZEN_C6_1_P6_ACTUAL_ASSEMBLY_CONTROL");
        } else if (folds.status !== "READY") {
          action = "ABSTAIN_REVIEW";
          reasons.push("INSUFFICIENT_INDEPENDENT_GROUPS");
        } else if (threshold === null) {
          action = "ABSTAIN_REVIEW";
          reasons.push("NO_ACTIVE_TRAIN_ONLY_THRESHOLD");
        } else if (score === null) {
          action = "ABSTAIN_REVIEW";
          reasons.push("REQUIRED_MACHINE_EVIDENCE_UNKNOWN");
        } else if (score >= threshold) {
          action = "SELECT_EXISTING_CANDIDATE";
          reasons.push("OUTER_TEST_MACHINE_SCORE_PASSES_INNER_OOF_THRESHOLD");
        } else reasons.push("KEEP_CURRENT_BELOW_TRAIN_ONLY_THRESHOLD");
        profileDecisions.push(
          decision({
            profileId: profile.profileId,
            eventId: sample.eventId,
            proposalId: sample.proposalId,
            foldId: outer.foldId,
            proposedCandidateId: sample.proposedCandidateId,
            decisionScore: score,
            threshold,
            decision: action,
            machineReasons: reasons,
            modelHash: model.semanticHash,
            policyHash: policy.semanticHash,
          }),
        );
      }
      const auditBody: Omit<C611NestedCalibrationAudit, "semanticHash"> = {
        profileId: profile.profileId,
        outerFoldId: outer.foldId,
        outerTrainingProposalIds: train.map((s) => s.proposalId),
        outerTestProposalIds: test.map((s) => s.proposalId),
        outerTrainingEventIds: train.map((s) => s.eventId),
        outerTestEventIds: test.map((s) => s.eventId),
        innerSplits,
        thresholdCandidates,
        threshold,
        preservationCost,
        activeThresholdFound: threshold !== null,
        minimumInnerSelected,
        model,
        trainTestIntersectionCount: train.filter((s) =>
          testEvents.has(s.eventId),
        ).length,
      };
      calibrationAudits.push(
        c611NestedCalibrationAuditSchema.parse({
          ...auditBody,
          semanticHash: hash(auditBody),
        }),
      );
      foldMetrics.push(
        calculateC611SelectiveMetrics({
          profileId: profile.profileId,
          foldId: outer.foldId,
          samples: test,
          labels: labels.filter((l) => testEvents.has(l.eventId)),
          decisions: profileDecisions.filter((d) => d.foldId === outer.foldId),
          policy,
        }),
      );
    }
    if (
      profileDecisions.length !== samples.length ||
      new Set(profileDecisions.map((d) => d.eventId)).size !== samples.length
    )
      throw new Error("C611_OOF_PREDICTION_COVERAGE_INVALID");
    decisions.push(...profileDecisions);
    profileMetrics.push(
      calculateC611SelectiveMetrics({
        profileId: profile.profileId,
        samples,
        labels,
        decisions: profileDecisions,
        policy,
        ...(input.candidateOracleAvailableGain === undefined
          ? {}
          : {
              candidateOracleAvailableGain: input.candidateOracleAvailableGain,
            }),
      }),
    );
  }
  const active = profileMetrics
    .filter((m) => m.modelClass === "ACTIVE_SELECTIVE_MODEL")
    .sort(
      (a, b) =>
        a.wrongSwitchCount - b.wrongSwitchCount ||
        a.catastrophicDeletionRegressionCount -
          b.catastrophicDeletionRegressionCount ||
        b.normalizedEditGain - a.normalizedEditGain ||
        b.evaluableSelectedCount - a.evaluableSelectedCount ||
        a.profileId.localeCompare(b.profileId),
    );
  const body: Omit<C611OofDecisions, "semanticHash"> = {
    schemaVersion: "1.0.0",
    policyVersion: policy.policyVersion,
    artifactType: "c6-1-1-out-of-fold-selective-decisions",
    foldHash: folds.semanticHash,
    policyHash: policy.semanticHash,
    sampleHash: hash({ primary, legacy }),
    evaluationRole: "KNOWN_BENCHMARK_NESTED_OOF_CALIBRATION",
    decisions,
    calibrationAudits,
    profileMetrics,
    foldMetrics,
    bestActiveProfile: active[0]?.profileId ?? null,
    testLabelInputToPredictionCount: 0,
    fullDataPredictionCount: 0,
  };
  return c611OofDecisionsSchema.parse({ ...body, semanticHash: hash(body) });
}
