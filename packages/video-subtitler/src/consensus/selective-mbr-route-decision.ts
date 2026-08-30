import {
  c611RouteInputSchema,
  c611RouteDecisionSchema,
  c611SelectiveMbrFreezeSchema,
  type C611RouteInput,
  type C611RouteDecision,
  type C611RouteProfileEvidence,
  type C611SelectiveMbrFreeze,
  type C611CalibrationPolicy,
  type C611CalibrationFolds,
  type C611CalibrationSample,
  type C611CalibrationLabel,
  type C611PolicyFreeze,
  type C611ThresholdCandidate,
} from "@mvl/shared";
import { machineQualitySemanticHash as hash } from "../machine-quality/evidence-correlation.js";
import { c61Require } from "./japanese-text-representation.js";
import {
  fitC611SelectiveModel,
  predictC611SelectiveModel,
  selectC611Threshold,
  rankC611ThresholdCandidates,
  validateC611Samples,
  verifyC611CalibrationPolicy,
} from "./selective-mbr-calibration.js";
import { c611CalibrationLabels } from "./selective-mbr-oof.js";
import { verifyC611Folds } from "./selective-mbr-folds.js";

type Check = C611RouteDecision["engineeringChecks"][number];
const check = (
  code: string,
  passed: boolean,
  observed: unknown,
  expected: string,
): Check => ({
  code,
  passed,
  observed: typeof observed === "string" ? observed : JSON.stringify(observed),
  expected,
});
function integrity(value: { semanticHash: string }): boolean {
  const { semanticHash, ...body } = value;
  return hash(body) === semanticHash;
}

/** Post-evaluation only. No choice here changes an OOF prediction or a production cue. */
export function decideC611SelectiveRoute(
  raw: C611RouteInput,
): C611RouteDecision {
  const input = c611RouteInputSchema.parse(raw),
    { policy, baselineMetrics: baseline, engineering } = input;
  const expectedFolds = [...input.expectedFoldIds].sort();
  const engineeringChecks: Check[] = [
    check(
      "FROZEN_POLICY_HASH",
      integrity(policy),
      policy.semanticHash,
      "valid self hash",
    ),
    check(
      "ALL_EIGHT_PROFILES_ONCE",
      new Set(input.profiles.map((p) => p.profileId)).size === 8,
      input.profiles.map((p) => p.profileId),
      "S0-S7 once each",
    ),
    check(
      "UNIQUE_EXPECTED_FOLDS",
      new Set(expectedFolds).size === expectedFolds.length,
      expectedFolds,
      "unique frozen fold IDs",
    ),
  ];
  for (const [key, value] of Object.entries(engineering))
    engineeringChecks.push(
      check(
        key,
        typeof value === "boolean" ? value : value === 0,
        value,
        typeof value === "boolean" ? "true" : "0",
      ),
    );
  for (const profile of input.profiles) {
    const m = profile.oof,
      foldIds = profile.foldJointGains.map((f) => f.foldId).sort();
    engineeringChecks.push(
      check(
        `${profile.profileId}:METRIC_IDENTITY`,
        m.profileId === profile.profileId && m.foldId === null && integrity(m),
        m.semanticHash,
        "valid pooled profile metrics identity",
      ),
    );
    engineeringChecks.push(
      check(
        `${profile.profileId}:COUNTS`,
        m.correctSwitchCount + m.wrongSwitchCount + m.neutralSwitchCount ===
          m.evaluableSelectedCount &&
          m.evaluableSelectedCount + m.selectedUnevaluableCount ===
            m.selectedCount &&
          m.evaluableSelectedCount <= m.evaluableProposalCount &&
          m.evaluableProposalCount <= m.eligibleProposalCount,
        m.evaluableSelectedCount,
        "consistent unique proposal outcome counts",
      ),
    );
    engineeringChecks.push(
      check(
        `${profile.profileId}:CHANGED_GROUP_COUNTS`,
        profile.mappedChangedGroupCount <= profile.changedGroupCount,
        [profile.mappedChangedGroupCount, profile.changedGroupCount],
        "mapped <= changed",
      ),
    );
    engineeringChecks.push(
      check(
        `${profile.profileId}:FOLD_COMPLETENESS`,
        JSON.stringify(foldIds) === JSON.stringify(expectedFolds),
        foldIds,
        "all and only frozen folds",
      ),
    );
    engineeringChecks.push(
      check(
        `${profile.profileId}:FOLD_SELECTION_COUNTS`,
        profile.foldJointGains.reduce((s, f) => s + f.selectedCount, 0) ===
          m.selectedCount &&
          profile.foldJointGains.reduce(
            (s, f) => s + f.evaluableSelectedCount,
            0,
          ) === m.evaluableSelectedCount &&
          profile.foldJointGains.every(
            (f) => f.evaluableSelectedCount <= f.selectedCount,
          ),
        profile.foldJointGains,
        "fold selection counts conserve pooled selection",
      ),
    );
    engineeringChecks.push(
      check(
        `${profile.profileId}:CUE_COUNT_PARITY`,
        profile.quality.cueCount === baseline.cueCount,
        profile.quality.cueCount,
        String(baseline.cueCount),
      ),
    );
  }
  const engineeringPassed = engineeringChecks.every((c) => c.passed);
  const profiles = input.profiles.map(
    (p): C611RouteDecision["profiles"][number] => {
      const m = p.oof,
        coverage =
          p.changedGroupCount > 0 &&
          p.mappedChangedGroupCount <= p.changedGroupCount
            ? p.mappedChangedGroupCount / p.changedGroupCount
            : null;
      const minimum = Math.max(
        policy.strongGate.minimumSelected,
        Math.ceil(
          policy.strongGate.minimumSelectedFraction * m.evaluableProposalCount,
        ),
      );
      const active =
        p.profileId !== "S0" &&
        p.profileId !== "S1" &&
        m.evaluableSelectedCount >= minimum;
      const activeFolds = p.foldJointGains.filter((f) => f.selectedCount > 0);
      const negative = activeFolds.filter(
        (f) => f.normalizedGain !== null && f.normalizedGain < 0,
      ).length;
      const unknown = activeFolds.filter(
        (f) => f.normalizedGain === null,
      ).length;
      const common = [
        check(
          "ENGINEERING_VALID",
          engineeringPassed,
          engineeringPassed,
          "true",
        ),
        check(
          "SELECTIVE_PROFILE_ONLY",
          p.profileId !== "S0" && p.profileId !== "S1",
          p.profileId,
          "S2-S7, never null or legacy control",
        ),
        check(
          "FIXED_CHANGED_GROUP_COVERAGE",
          coverage !== null &&
            coverage >= policy.strongGate.minimumFixedCoverage,
          coverage,
          `>=${policy.strongGate.minimumFixedCoverage}`,
        ),
        check(
          "MINIMUM_EVALUABLE_SELECTION",
          m.evaluableSelectedCount >= minimum,
          m.evaluableSelectedCount,
          `>=${minimum}`,
        ),
        check(
          "POSITIVE_JOINT_UNIQUE_GROUP_GAIN",
          p.jointNormalizedGain > 0,
          p.jointNormalizedGain,
          ">0; never proposal counterfactual sum",
        ),
        check(
          "MATERIAL_NON_REGRESSION",
          p.quality.materialErrors <= baseline.materialErrors,
          p.quality.materialErrors,
          `<=${baseline.materialErrors}`,
        ),
      ];
      const strongChecks = [
        ...common,
        check(
          "ZERO_WRONG_SWITCHES",
          m.wrongSwitchCount === policy.strongGate.maximumWrong,
          m.wrongSwitchCount,
          "0",
        ),
        check(
          "ZERO_CATASTROPHIC_DELETION",
          m.catastrophicDeletionRegressionCount ===
            policy.strongGate.maximumCatastrophicDeletion,
          m.catastrophicDeletionRegressionCount,
          "0",
        ),
        check(
          "NORMALIZED_CER_IMPROVES",
          p.quality.normalizedCer < baseline.normalizedCer,
          p.quality.normalizedCer,
          `<${baseline.normalizedCer}`,
        ),
        check(
          "HALLUCINATION_NON_REGRESSION",
          p.quality.hallucination <= baseline.hallucination,
          p.quality.hallucination,
          `<=${baseline.hallucination}`,
        ),
        check(
          "MISSING_NON_REGRESSION",
          p.quality.missing <= baseline.missing,
          p.quality.missing,
          `<=${baseline.missing}`,
        ),
        check(
          "COVERAGE_NON_REGRESSION",
          p.quality.coverage >= baseline.coverage,
          p.quality.coverage,
          `>=${baseline.coverage}`,
        ),
        check(
          "NO_NEGATIVE_ACTIVE_FOLD",
          negative === policy.strongGate.maximumNegativeActiveFolds,
          negative,
          "0",
        ),
        check(
          "ACTIVE_FOLD_GAIN_KNOWN",
          unknown === 0,
          unknown,
          "0 unknown active fold gains",
        ),
      ];
      const precision = m.evaluableSelectedCount
        ? m.correctSwitchCount / m.evaluableSelectedCount
        : null;
      const harm = m.evaluableSelectedCount
        ? m.wrongSwitchCount / m.evaluableSelectedCount
        : null;
      const promisingChecks = [
        ...common,
        check(
          "PROMISING_PRECISION",
          precision !== null &&
            precision >= policy.promisingGate.minimumPrecision,
          precision,
          `>=${policy.promisingGate.minimumPrecision}`,
        ),
        check(
          "PROMISING_HARM",
          harm !== null && harm <= policy.promisingGate.maximumHarm,
          harm,
          `<=${policy.promisingGate.maximumHarm}`,
        ),
      ];
      return {
        profileId: p.profileId,
        activeCandidate: active,
        minimumEvaluableSelected: minimum,
        fixedChangedGroupCoverage: coverage,
        jointNormalizedGain: p.jointNormalizedGain,
        jointExactGain: p.jointExactGain,
        negativeActiveFoldCount: negative,
        unknownActiveFoldCount: unknown,
        strongPassed: strongChecks.every((c) => c.passed),
        promisingPassed: promisingChecks.every((c) => c.passed),
        strongChecks,
        promisingChecks,
      };
    },
  );
  const rank = (a: C611RouteProfileEvidence, b: C611RouteProfileEvidence) =>
    a.oof.wrongSwitchCount - b.oof.wrongSwitchCount ||
    a.oof.catastrophicDeletionRegressionCount -
      b.oof.catastrophicDeletionRegressionCount ||
    b.jointNormalizedGain - a.jointNormalizedGain ||
    a.quality.normalizedCer - b.quality.normalizedCer ||
    b.oof.evaluableSelectedCount - a.oof.evaluableSelectedCount ||
    a.profileId.localeCompare(b.profileId);
  const strong = input.profiles
    .filter(
      (p) => profiles.find((x) => x.profileId === p.profileId)?.strongPassed,
    )
    .sort(rank);
  const promising = input.profiles
    .filter(
      (p) => profiles.find((x) => x.profileId === p.profileId)?.promisingPassed,
    )
    .sort(rank);
  const comparison = input.profiles.filter((p) => p.profileId !== "S0");
  const primaryProposalsSufficient = input.profiles.some(
    (p) =>
      p.profileId !== "S0" &&
      p.profileId !== "S1" &&
      p.oof.evaluableProposalCount >= policy.strongGate.minimumSelected,
  );
  const anyCoverage =
    primaryProposalsSufficient &&
    comparison.some(
      (p) =>
        p.changedGroupCount > 0 &&
        p.mappedChangedGroupCount / p.changedGroupCount >=
          policy.insufficientCoverageThreshold &&
        p.oof.evaluableProposalCount >= policy.strongGate.minimumSelected,
    );
  const outcome: C611RouteDecision["outcome"] = !engineeringPassed
    ? "SELECTIVE_MBR_ENGINEERING_INVALID"
    : strong.length
      ? "SELECTIVE_EXISTING_CANDIDATE_MBR_SUPPORTED"
      : promising.length
        ? "SELECTIVE_MBR_PROMISING_BUT_NOT_PROVEN"
        : !anyCoverage
          ? "EVALUATION_COVERAGE_INSUFFICIENT"
          : "SELECTIVE_MBR_NOT_SUPPORTED";
  const nextRoute: C611RouteDecision["nextRoute"] =
    outcome === "SELECTIVE_MBR_ENGINEERING_INVALID"
      ? "REPAIR_ENGINEERING_BEFORE_QUALITY_CLAIMS"
      : outcome === "SELECTIVE_EXISTING_CANDIDATE_MBR_SUPPORTED"
        ? "GO_C6_1_2_FROZEN_PROSPECTIVE_SHADOW"
        : outcome === "SELECTIVE_MBR_PROMISING_BUT_NOT_PROVEN"
          ? "MORE_INDEPENDENT_EPISODE_CALIBRATION_OR_PROSPECTIVE_OBSERVE_ONLY"
          : outcome === "EVALUATION_COVERAGE_INSUFFICIENT"
            ? "REPAIR_FIXED_EVALUATION_COVERAGE"
            : "STOP_AUTOMATIC_CONSENSUS_DECODER_EXPANSION";
  const selectedProfile =
    strong[0]?.profileId ?? promising[0]?.profileId ?? null;
  const body: Omit<C611RouteDecision, "semanticHash"> = {
    schemaVersion: "1.0.0",
    policyVersion: policy.policyVersion,
    artifactType: "c6-1-1-route-decision",
    policyHash: policy.semanticHash,
    baselineHash: input.baselineHash,
    evidenceHash: hash(input),
    outcome,
    nextRoute,
    engineeringPassed,
    engineeringChecks,
    profiles,
    selectedProfile,
    strongProfiles: strong.map((p) => p.profileId),
    promisingProfiles: promising.map((p) => p.profileId),
    futureModelTrainingAuthorized: selectedProfile !== null,
    reasons: [
      outcome,
      "OOF_JOINT_GROUP_AUTHORITY",
      "KNOWN_BENCHMARK_ONLY",
      "PRODUCTION_REMAINS_FROZEN",
    ],
    benchmarkStatus:
      "KNOWN_DEVELOPMENT_BENCHMARK_CALIBRATION_FEASIBILITY_NOT_UNSEEN_VALIDATION",
    metricAuthority:
      "ACTUAL_JOINT_SHADOW_UNIQUE_FIXED_GROUP_GAIN_NOT_PROPOSAL_SUM",
    productionStatus: "needs-review",
    finalizationMethod: "none",
    machineOnlyReleaseAuthorized: false,
    c602Status: "HOLD",
  };
  return c611RouteDecisionSchema.parse({ ...body, semanticHash: hash(body) });
}

export interface C611FutureModelInput {
  route: C611RouteDecision;
  policy: C611PolicyFreeze;
  calibrationPolicy: C611CalibrationPolicy;
  samples: C611CalibrationSample[];
  labels: C611CalibrationLabel[];
  folds: C611CalibrationFolds;
  machineFeatureFreezeHash: string;
  featureTableHash: string;
  proposalHash: string;
  sourceOofHash: string;
}
/** Optional, AFTER route evaluation. Refit is future-only and is never substituted into OOF. */
export function createC611FutureModelFreeze(
  input: C611FutureModelInput,
): C611SelectiveMbrFreeze {
  const route = c611RouteDecisionSchema.parse(input.route),
    policy = input.policy,
    calibrationPolicy = input.calibrationPolicy;
  verifyC611CalibrationPolicy(calibrationPolicy);
  verifyC611Folds(input.folds, calibrationPolicy);
  if (
    !integrity(route) ||
    !integrity(policy) ||
    route.policyHash !== policy.semanticHash ||
    policy.calibrationPolicyHash !== hash(calibrationPolicy)
  )
    throw new Error("C611_FUTURE_FREEZE_POLICY_IDENTITY_MISMATCH");
  const samples = validateC611Samples(input.samples),
    labels = c611CalibrationLabels(input.labels);
  const ids = new Map(samples.map((s) => [s.proposalId, s.eventId]));
  if (
    labels.length !== samples.length ||
    labels.some((l) => ids.get(l.proposalId) !== l.eventId)
  )
    throw new Error("C611_FUTURE_TRAINING_IDENTITY_MISMATCH");
  const trainingDatasetHash = hash({ samples, labels });
  const eventFolds = new Map(
    input.folds.folds.flatMap((fold) =>
      fold.eventIds.map((eventId) => [eventId, fold.foldId] as const),
    ),
  );
  if (
    new Set(samples.map((sample) => sample.eventId)).size !== eventFolds.size ||
    samples.length !== eventFolds.size ||
    samples.some((sample) => !eventFolds.has(sample.eventId))
  )
    throw new Error("C611_FUTURE_FOLD_SAMPLE_UNIVERSE_MISMATCH");
  const evaluationGroupFolds = new Map<string, Set<string>>();
  for (const label of labels) {
    if (label.outcome === "SWITCH_UNEVALUABLE") continue;
    for (const groupId of label.groupIds) {
      const memberships =
        evaluationGroupFolds.get(groupId) ?? new Set<string>();
      memberships.add(c61Require(eventFolds.get(label.eventId)));
      evaluationGroupFolds.set(groupId, memberships);
    }
  }
  if ([...evaluationGroupFolds.values()].some((group) => group.size > 1))
    throw new Error("C611_FUTURE_EVALUABLE_GROUP_CROSSES_FOLDS");
  const summary: C611SelectiveMbrFreeze["calibrationSummary"] = {
    thresholdCandidates: [],
    chosenMinimumSelected: calibrationPolicy.innerMinimumSelected,
    calibrationSampleCount: samples.length,
    outerTestPredictionCount: 0,
    futureThresholdCalibrationPredictionCount: 0,
    models: [],
    splits: [],
  };
  const base = {
    schemaVersion: "1.0.0" as const,
    policyVersion: policy.policyVersion,
    artifactType: "c6-1-1-selective-mbr-freeze" as const,
    useRestriction:
      "POST_EVALUATION_EXPLORATORY_FUTURE_PROSPECTIVE_SHADOW_ONLY" as const,
    noOofMetricsRewritten: true as const,
    inSampleQualityClaimAllowed: false as const,
    routeHash: route.semanticHash,
    policyHash: policy.semanticHash,
    calibrationPolicyHash: calibrationPolicy.semanticHash,
    fixedAlignmentPolicyHash: policy.fixedAlignmentPolicyHash,
    machinePolicyHash: policy.machinePolicyHash,
    machineFeatureFreezeHash: input.machineFeatureFreezeHash,
    featureTableHash: input.featureTableHash,
    proposalHash: input.proposalHash,
    foldHash: input.folds.semanticHash,
    sourceOofHash: input.sourceOofHash,
    trainingDatasetHash,
    calibrationSummary: summary,
  };
  const unavailable = (reason: string): C611SelectiveMbrFreeze => {
    const body = {
      ...base,
      status: "UNAVAILABLE" as const,
      frozenModelCreated: false,
      reason,
      profileId: null,
      threshold: null,
      thresholdHash: null,
      modelHash: null,
      model: null,
    };
    return c611SelectiveMbrFreezeSchema.parse({
      ...body,
      semanticHash: hash(body),
    });
  };
  const allowed =
    route.engineeringPassed &&
    ((route.outcome === "SELECTIVE_EXISTING_CANDIDATE_MBR_SUPPORTED" &&
      route.strongProfiles.some(
        (profile) => profile === route.selectedProfile,
      )) ||
      (route.outcome === "SELECTIVE_MBR_PROMISING_BUT_NOT_PROVEN" &&
        route.promisingProfiles.some(
          (profile) => profile === route.selectedProfile,
        )));
  if (
    !allowed ||
    !route.futureModelTrainingAuthorized ||
    route.selectedProfile === null
  )
    return unavailable("ROUTE_GATE_NOT_PASSED_NO_FULL_DATA_MODEL_CREATED");
  const profileId = route.selectedProfile;
  if (profileId === "S0" || profileId === "S1")
    throw new Error("C611_CONTROL_CANNOT_CREATE_FUTURE_MODEL");
  if (input.folds.status !== "READY")
    return unavailable("INDEPENDENT_GROUPS_UNAVAILABLE");
  const labelMap = new Map(labels.map((l) => [l.proposalId, l]));
  const candidates: C611ThresholdCandidate[] = [];
  for (const preservationCost of profileId === "S4"
    ? calibrationPolicy.preservationCosts
    : [0]) {
    const scored: {
      sample: C611CalibrationSample;
      score: number | null;
      label: C611CalibrationLabel | undefined;
    }[] = [];
    for (const fold of input.folds.folds) {
      const heldOutEvents = new Set(fold.eventIds),
        train = samples.filter((s) => !heldOutEvents.has(s.eventId)),
        heldOut = samples.filter((s) => heldOutEvents.has(s.eventId));
      const trainIds = new Set(train.map((s) => s.proposalId));
      const model = fitC611SelectiveModel(
        train,
        labels.filter((l) => trainIds.has(l.proposalId)),
        profileId,
        calibrationPolicy,
        preservationCost,
      );
      const predictions = heldOut.map((sample) => ({
        proposalId: sample.proposalId,
        score: predictC611SelectiveModel(sample, model, calibrationPolicy),
      }));
      for (let i = 0; i < heldOut.length; i++)
        scored.push({
          sample: c61Require(heldOut[i]),
          score: c61Require(predictions[i]).score,
          label: labelMap.get(c61Require(heldOut[i]).proposalId),
        });
      summary.models.push(model);
      summary.splits.push({
        foldId: fold.foldId,
        preservationCost,
        trainProposalIds: train.map((s) => s.proposalId),
        heldOutProposalIds: heldOut.map((s) => s.proposalId),
        modelHash: model.semanticHash,
        predictions,
      });
      summary.futureThresholdCalibrationPredictionCount += predictions.length;
    }
    const selection = selectC611Threshold(
      scored,
      calibrationPolicy,
      preservationCost,
    );
    candidates.push(...selection.candidates);
    summary.chosenMinimumSelected = selection.minimumSelected;
  }
  summary.thresholdCandidates = candidates;
  const chosen = rankC611ThresholdCandidates(candidates)[0];
  if (!chosen) return unavailable("NO_ACTIVE_FULL_DATA_CALIBRATION_THRESHOLD");
  const model = fitC611SelectiveModel(
    samples,
    labels,
    profileId,
    calibrationPolicy,
    chosen.preservationCost,
  );
  const binding = {
    routeHash: route.semanticHash,
    policyHash: policy.semanticHash,
    calibrationPolicyHash: calibrationPolicy.semanticHash,
    machineFeatureFreezeHash: input.machineFeatureFreezeHash,
    featureTableHash: input.featureTableHash,
    proposalHash: input.proposalHash,
    foldHash: input.folds.semanticHash,
    trainingDatasetHash,
  };
  const body = {
    ...base,
    status: "AVAILABLE_FUTURE_ONLY" as const,
    frozenModelCreated: true,
    reason:
      "GATE_PASSED_TRAIN_ONLY_GROUPED_FUTURE_THRESHOLD_AND_FULL_DATA_REFIT",
    profileId,
    threshold: chosen.threshold,
    thresholdHash: hash({
      ...binding,
      threshold: chosen.threshold,
      preservationCost: chosen.preservationCost,
    }),
    modelHash: hash({ ...binding, modelHash: model.semanticHash }),
    model,
  };
  return c611SelectiveMbrFreezeSchema.parse({
    ...body,
    semanticHash: hash(body),
  });
}
