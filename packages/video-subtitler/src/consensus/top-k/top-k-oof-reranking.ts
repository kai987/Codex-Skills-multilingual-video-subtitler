import {
  C612_RETRIEVAL,
  c612ModelsSchema,
  c612ThresholdsSchema,
  c612RankingsSchema,
  c612DecisionsSchema,
  c612ThresholdSchema,
  type C612FeatureRow,
  type C612Folds,
  type C612Set,
  type C612Label,
  type C612Model,
  type C612Ranking,
  type C612Threshold,
  type C612Contraction,
  type C612Completeness,
} from "@mvl/shared";
import {
  artifact,
  hash,
  ratio,
  C612_POLICY,
  C612_POLICY_HASH,
  c612Defined,
} from "./c612-policy.js";
import {
  C612_RERANKERS,
  predictLinear,
  trainLinearReranker,
  type RerankerProfile,
} from "./linear-reranker.js";
export interface C612RankerInputs {
  features: readonly C612FeatureRow[];
  sets: readonly C612Set[];
  completeness: readonly C612Completeness[];
  contractions: readonly C612Contraction[];
}
export function scoreEvent(
  input: C612RankerInputs,
  set: C612Set,
  model: C612Model,
  profile: RerankerProfile,
  threshold: number | null,
): C612Ranking {
  const ids = [set.currentCandidateId, ...set.alternativeIds];
  const ranked = ids
    .map((candidateId) => {
      const feature = input.features.find((r) => r.candidateId === candidateId);
      if (!feature) throw new Error("C612_TOPK_FEATURE_MISSING");
      const current = candidateId === set.currentCandidateId;
      const score =
        profile.algorithm === "FIXED_BASELINE"
          ? current
            ? -1000
            : -(set.alternativeIds.indexOf(candidateId) + 1)
          : predictLinear(model, feature);
      const contraction = input.contractions.find(
          (r) => r.candidateId === candidateId,
        ),
        complete = input.completeness.find(
          (r) => r.candidateId === candidateId,
        );
      const reasons = current
        ? []
        : [
            profile.completenessGate &&
              complete?.acousticCompletenessStatus !== "VERIFIED_COMPLETE" &&
              "ACOUSTIC_COMPLETENESS_NOT_VERIFIED",
            profile.contractionGate &&
              !contraction?.selectable &&
              "CONTRACTION_GATE",
            profile.completenessGate &&
              feature.values[35] !== 1 &&
              "AMBIGUOUS_MACHINE_CUE_GROUP",
            feature.values[36] !== 1 && "MISSING_PROVENANCE",
          ].filter((v): v is string => !!v);
      return {
        candidateId,
        score,
        rank: 0,
        current,
        gateEligible: reasons.length === 0,
        gateReasons: reasons,
      };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.current) - Number(a.current) ||
        a.candidateId.localeCompare(b.candidateId),
    );
  ranked.forEach((r, i) => {
    r.rank = i + 1;
  });
  const proposal = c612Defined(ranked[0]),
    current = c612Defined(ranked.find((r) => r.current)),
    eligible = ranked.find((r) => r.gateEligible) ?? current;
  const margin = eligible.score - current.score;
  const canSwitch =
    !eligible.current &&
    (profile.abstention
      ? threshold !== null && margin > threshold
      : margin > 0);
  return {
    profileId: profile.id,
    eventId: set.eventId,
    foldId: model.outerFoldId,
    modelHash: model.modelHash,
    currentCandidateId: current.candidateId,
    ranked,
    proposedCandidateId: proposal.candidateId,
    selectedCandidateId: canSwitch ? eligible.candidateId : current.candidateId,
    marginOverCurrent: margin,
    abstained: !canSwitch && !proposal.current,
    reasons: canSwitch
      ? []
      : [
          ...proposal.gateReasons,
          profile.abstention && threshold === null
            ? "ABSTAIN_ALL_NO_SAFE_TRAIN_THRESHOLD"
            : "NO_ELIGIBLE_POSITIVE_SWITCH_MARGIN",
        ],
    testLabelUsed: false,
  };
}
function profileSets(
  input: C612RankerInputs,
  profile: RerankerProfile,
  events: readonly string[],
) {
  return input.sets
    .filter(
      (s) =>
        s.profile === C612_RETRIEVAL[profile.retrieval] &&
        events.includes(s.eventId),
    )
    .toSorted((a, b) => a.eventId.localeCompare(b.eventId));
}
function trainingSubset(
  input: C612RankerInputs,
  profile: RerankerProfile,
  events: readonly string[],
  labels: readonly C612Label[],
) {
  const ids = new Set(
    profileSets(input, profile, events).flatMap((s) => [
      s.currentCandidateId,
      ...s.alternativeIds,
    ]),
  );
  return {
    features: input.features.filter((r) => ids.has(r.candidateId)),
    labels: labels.filter(
      (l) => events.includes(l.eventId) && ids.has(l.candidateId),
    ),
  };
}
/** Numeric inner-fold outcomes only; neutral changes are not precision errors. */
export function trainingThresholdUtility(labels: readonly C612Label[]) {
  if (labels.some((l) => !l.eligible || l.normalizedGain === null))
    throw new Error("C612_THRESHOLD_UTILITY_REQUIRES_KNOWN_LABELS");
  const improved = labels.filter(
      (l) => c612Defined(l.normalizedGain) > 0,
    ).length,
    regressed = labels.filter((l) => c612Defined(l.normalizedGain) < 0).length,
    neutral = labels.filter((l) => l.normalizedGain === 0).length;
  return {
    improved,
    regressed,
    neutral,
    precision: ratio(improved, improved + regressed),
    harm: ratio(regressed, labels.length),
    normalizedGain: labels.length
      ? labels.reduce((n, l) => n + c612Defined(l.normalizedGain), 0)
      : null,
  };
}
export function trainFoldThreshold(
  input: C612RankerInputs & {
    profile: RerankerProfile;
    outerFoldId: string;
    trainingFolds: C612Folds["folds"];
    trainingLabels: readonly C612Label[];
    forbiddenEvents: readonly string[];
  },
): C612Threshold {
  if (
    input.trainingLabels.some((l) => input.forbiddenEvents.includes(l.eventId))
  )
    throw new Error("C612_TEST_LABEL_THRESHOLD_LEAK");
  if (!input.profile.abstention)
    return c612ThresholdSchema.parse({
      profileId: input.profile.id,
      outerFoldId: input.outerFoldId,
      threshold: 0,
      status: "NO_SWITCH_THRESHOLD",
      trainingFoldIds: input.trainingFolds.map((f) => f.foldId),
      innerPredictionHash: hash([]),
      candidateThresholds: [],
      outerTestLabelsUsed: false,
    });
  const predictions: C612Ranking[] = [];
  for (const validation of input.trainingFolds) {
    const trainEvents = input.trainingFolds
      .filter((f) => f.foldId !== validation.foldId)
      .flatMap((f) => f.eventIds);
    const subset = trainingSubset(
      input,
      input.profile,
      trainEvents,
      input.trainingLabels,
    );
    const model = trainLinearReranker({
      profile: input.profile,
      outerFoldId: `${input.outerFoldId}:inner-${validation.foldId}`,
      ...subset,
      forbiddenEventIds: [...input.forbiddenEvents, ...validation.eventIds],
    });
    for (const set of profileSets(input, input.profile, validation.eventIds))
      predictions.push(scoreEvent(input, set, model, input.profile, 0));
  }
  const candidateThresholds =
    C612_POLICY.rankers.trainOnlyThresholdCandidates.map((threshold) => {
      const selected = predictions.filter(
        (p) =>
          p.selectedCandidateId !== p.currentCandidateId &&
          p.marginOverCurrent > threshold,
      );
      const labels = selected.flatMap((p) =>
        input.trainingLabels.filter(
          (l) => l.candidateId === p.selectedCandidateId && l.eligible,
        ),
      );
      return {
        threshold,
        selected: selected.length,
        ...trainingThresholdUtility(labels),
      };
    });
  const safe = candidateThresholds
    .filter(
      (t) =>
        t.improved >= C612_POLICY.rankers.innerMinimumImproved &&
        t.precision !== null &&
        t.precision >= C612_POLICY.rankers.innerMinimumPrecision &&
        t.harm !== null &&
        t.harm <= C612_POLICY.rankers.innerMaximumHarm &&
        t.selected === t.improved + t.regressed + t.neutral,
    )
    .sort((a, b) => b.improved - a.improved || b.threshold - a.threshold)[0];
  return c612ThresholdSchema.parse({
    profileId: input.profile.id,
    outerFoldId: input.outerFoldId,
    threshold: safe?.threshold ?? null,
    status: safe
      ? "TRAIN_ONLY_CALIBRATED"
      : "ABSTAIN_ALL_NO_SAFE_TRAIN_THRESHOLD",
    trainingFoldIds: input.trainingFolds.map((f) => f.foldId),
    innerPredictionHash: hash(predictions),
    candidateThresholds,
    outerTestLabelsUsed: false,
  });
}
export function runC612Oof(
  input: C612RankerInputs & {
    labels: readonly C612Label[];
    folds: C612Folds;
    featureHash: string;
    progress?: (s: string) => void;
    profiles?: readonly RerankerProfile[];
  },
) {
  const models: C612Model[] = [],
    thresholds: C612Threshold[] = [],
    rankings: C612Ranking[] = [];
  if (
    input.folds.audioLeakageCount ||
    input.folds.correlationLeakageCount ||
    input.folds.cueGroupLeakageCount ||
    input.folds.folds.length !== 5
  )
    throw new Error("C612_FOLDS_UNSAFE");
  for (const profile of input.profiles ?? C612_RERANKERS) {
    for (const test of input.folds.folds) {
      const trainingFolds = input.folds.folds.filter(
          (f) => f.foldId !== test.foldId,
        ),
        trainEvents = trainingFolds.flatMap((f) => f.eventIds);
      // Discard outer-test labels at the boundary, before imputation, fitting, or thresholding.
      const trainingLabels = input.labels.filter((l) =>
        trainEvents.includes(l.eventId),
      );
      const subset = trainingSubset(
        input,
        profile,
        trainEvents,
        trainingLabels,
      );
      const model = trainLinearReranker({
        profile,
        outerFoldId: test.foldId,
        ...subset,
        forbiddenEventIds: test.eventIds,
      });
      models.push(model);
      const threshold = trainFoldThreshold({
        ...input,
        profile,
        outerFoldId: test.foldId,
        trainingFolds,
        trainingLabels,
        forbiddenEvents: test.eventIds,
      });
      thresholds.push(threshold);
      for (const set of profileSets(input, profile, test.eventIds))
        rankings.push(
          scoreEvent(input, set, model, profile, threshold.threshold),
        );
    }
    input.progress?.(`OOF ${profile.id}: five grouped outer folds completed`);
  }
  const modelArtifact = c612ModelsSchema.parse(
    artifact("machine-c6-1-2-reranker-models", {
      featureHash: input.featureHash,
      foldHash: input.folds.semanticHash,
      profilesFrozenBeforeGold: true,
      supervisedTrainingAfterGoldLabels: true,
      models,
      runtimeRawGoldInputCount: 0,
      rawTextFeatureCount: 0,
    }),
  );
  const rankingArtifact = c612RankingsSchema.parse(
    artifact("c6-1-2-oof-candidate-rankings", {
      featureHash: input.featureHash,
      foldHash: input.folds.semanticHash,
      modelsHash: modelArtifact.semanticHash,
      rows: rankings,
      testLabelInputToPredictionCount: 0,
    }),
  );
  return {
    models: modelArtifact,
    thresholds: c612ThresholdsSchema.parse(
      artifact("machine-c6-1-2-thresholds", {
        policyHash: C612_POLICY_HASH,
        foldHash: input.folds.semanticHash,
        rows: thresholds,
      }),
    ),
    rankings: rankingArtifact,
    decisions: c612DecisionsSchema.parse(
      artifact("machine-c6-1-2-reranker-decisions", {
        rankingHash: rankingArtifact.semanticHash,
        rows: rankings,
        productionWriteAuthorized: false,
      }),
    ),
  };
}
