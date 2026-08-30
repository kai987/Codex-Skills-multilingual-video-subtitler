import {
  C611_CALIBRATION_FEATURE_NAMES,
  c611CalibrationVersion,
  c611CalibrationPolicySchema,
  c611CalibrationSampleSchema,
  c611SelectiveModelSchema,
  type C611CalibrationLabel,
  type C611CalibrationPolicy,
  type C611CalibrationProfileId,
  type C611CalibrationSample,
  type C611SelectiveModel,
  type C611ThresholdCandidate,
} from "@mvl/shared";
import { machineQualitySemanticHash as hash } from "../machine-quality/evidence-correlation.js";
import { c61Require } from "./japanese-text-representation.js";
const completenessFeatures = [
  "hierarchicalMbrMargin",
  "runnerUpMargin",
  "providerSupportCount",
  "correlationSupportCount",
  "decoderTruncationRisk",
  "requestEdgeRisk",
  "speechCompleteness",
  "characterLengthRatio",
  "tokenLengthRatio",
  "normalizedLcsCoverage",
  "deletedCharacterRatio",
  "insertedCharacterRatio",
  "prefixRetention",
  "suffixRetention",
  "longestDeletedSpanRatio",
  "longestInsertedSpanRatio",
  "eventDuration",
  "charactersPerSecond",
  "normalizedDistance",
  "spanApplicationSafe",
] as const;
export function freezeC611CalibrationPolicy(
  options: {
    outerFoldCount?: number;
    innerFoldCount?: number;
    neighborGapSeconds?: number;
  } = {},
): C611CalibrationPolicy {
  const body: Omit<C611CalibrationPolicy, "semanticHash"> = {
    schemaVersion: "1.0.0",
    policyVersion: c611CalibrationVersion,
    artifactType: "c6-1-1-calibration-policy",
    outerFoldCount: options.outerFoldCount ?? 5,
    innerFoldCount: options.innerFoldCount ?? 3,
    neighborGapSeconds: options.neighborGapSeconds ?? 0.5,
    foldConstruction:
      "SOURCE_AUDIO_OVERLAP_NEIGHBOR_SHARED_CUE_CONTIGUOUS_GROUPS",
    foldAdaptation: "NO_LABEL_BASED_REPARTITION",
    thresholdObjective:
      "MIN_WRONG_ZERO_CATASTROPHIC_POSITIVE_GAIN_MIN_ACTIVE_THEN_COVERAGE",
    thresholdCandidates: "INNER_OOF_UNIQUE_SCORES_ONLY",
    innerMinimumSelected: 2,
    minimumSelectedFraction: 0.05,
    outerMinimumSelected: 5,
    l2: 0.1,
    learningRate: 0.1,
    iterations: 500,
    tolerance: 1e-10,
    singleClassPolicy: "SMOOTHED_TRAIN_PRIOR_NO_ACTIVE_WITHOUT_INNER_GAIN",
    preprocessing: "TRAIN_MEDIAN_TRAIN_MEAN_STD_PLUS_EXPLICIT_MISSING_FLAGS",
    preservationCosts: [0, 0.025, 0.05, 0.1],
    catastrophicDeletedRatio: 0.5,
    catastrophicMinimumRegression: 2,
    ruleMarginScale: 0.1,
    ruleDeletionPenalty: 0.1,
    profiles: [
      {
        profileId: "S0",
        name: "KEEP_ALL_CURRENT",
        modelType: "NULL",
        featureNames: [],
      },
      {
        profileId: "S1",
        name: "LEGACY_C6_1_CANDIDATE_MBR",
        modelType: "LEGACY",
        featureNames: [],
      },
      {
        profileId: "S2",
        name: "RAW_MBR_MARGIN_SELECTIVE",
        modelType: "RAW_MARGIN",
        featureNames: ["rawMbrMargin"],
      },
      {
        profileId: "S3",
        name: "HIERARCHICAL_MBR_SELECTIVE",
        modelType: "HIERARCHICAL_MARGIN",
        featureNames: ["hierarchicalMbrMargin"],
      },
      {
        profileId: "S4",
        name: "CURRENT_PRESERVATION_MBR",
        modelType: "PRESERVATION_MARGIN",
        featureNames: ["hierarchicalMbrMargin", "normalizedDistance"],
      },
      {
        profileId: "S5",
        name: "DELETION_COMPLETENESS_AWARE_MBR",
        modelType: "L2_LOGISTIC",
        featureNames: [...completenessFeatures],
      },
      {
        profileId: "S6",
        name: "FULL_MACHINE_EVIDENCE_SELECTIVE_MBR",
        modelType: "L2_LOGISTIC",
        featureNames: [...C611_CALIBRATION_FEATURE_NAMES],
      },
      {
        profileId: "S7",
        name: "CONSERVATIVE_INTERPRETABLE_RULE",
        modelType: "CONSERVATIVE_RULE",
        featureNames: [
          "hierarchicalMbrMargin",
          "runnerUpMargin",
          "providerSupportCount",
          "crossModelAgreement",
          "deletedCharacterRatio",
          "requestEdgeRisk",
          "ctcDirection",
        ],
      },
    ],
  };
  return c611CalibrationPolicySchema.parse({
    ...body,
    semanticHash: hash(body),
  });
}
export function verifyC611CalibrationPolicy(
  policy: C611CalibrationPolicy,
): void {
  const { semanticHash, ...body } = c611CalibrationPolicySchema.parse(policy);
  if (
    hash(body) !== semanticHash ||
    new Set(body.profiles.map((p) => p.profileId)).size !== 8
  )
    throw new Error("C611_CALIBRATION_POLICY_HASH_MISMATCH");
}
/** Metadata is retained for identity only. No string/text value enters a design matrix. */
export function prepareC611CalibrationSamples(
  proposals: {
    proposalId: string;
    eventId: string;
    currentCandidateId: string | null;
    proposedCandidateId: string | null;
    eligibilityStatus: C611CalibrationSample["eligibilityStatus"];
    semanticHash: string;
  }[],
  features: {
    proposalId: string;
    eventId: string;
    values: Record<string, number | null>;
    missingFlags: Record<string, boolean>;
    semanticHash: string;
  }[],
): C611CalibrationSample[] {
  const byId = new Map(features.map((x) => [x.proposalId, x]));
  if (
    byId.size !== features.length ||
    new Set(proposals.map((x) => x.proposalId)).size !== proposals.length ||
    proposals.length !== features.length
  )
    throw new Error("C611_SAMPLE_IDENTITIES_NOT_ONE_TO_ONE");
  return validateC611Samples(
    proposals.map((proposal) => {
      const feature = byId.get(proposal.proposalId);
      if (feature?.eventId !== proposal.eventId)
        throw new Error("C611_FEATURE_PROPOSAL_MISMATCH");
      return {
        proposalId: proposal.proposalId,
        eventId: proposal.eventId,
        currentCandidateId: proposal.currentCandidateId,
        proposedCandidateId: proposal.proposedCandidateId,
        eligibilityStatus: proposal.eligibilityStatus,
        values: feature.values,
        missingFlags: feature.missingFlags,
        proposalHash: proposal.semanticHash,
        featureHash: feature.semanticHash,
      };
    }),
  );
}
export function validateC611Samples(
  input: C611CalibrationSample[],
): C611CalibrationSample[] {
  const samples = input.map((s) => c611CalibrationSampleSchema.parse(s));
  const expected = [...C611_CALIBRATION_FEATURE_NAMES].sort().join("|");
  if (new Set(samples.map((x) => x.proposalId)).size !== samples.length)
    throw new Error("C611_DUPLICATE_SAMPLE");
  for (const sample of samples) {
    if (
      Object.keys(sample.values).sort().join("|") !== expected ||
      Object.keys(sample.missingFlags).sort().join("|") !== expected
    )
      throw new Error("C611_FEATURE_ALLOWLIST_MISMATCH");
    for (const name of C611_CALIBRATION_FEATURE_NAMES)
      if ((sample.values[name] === null) !== sample.missingFlags[name])
        throw new Error("C611_MISSING_FLAG_MISMATCH");
    if (
      sample.eligibilityStatus === "ELIGIBLE" &&
      sample.proposedCandidateId === null
    )
      throw new Error("C611_ELIGIBLE_WITHOUT_CANDIDATE");
  }
  return samples.sort((a, b) => a.proposalId.localeCompare(b.proposalId));
}
export function c611LabelEvaluable(
  label: C611CalibrationLabel | undefined,
): label is C611CalibrationLabel {
  return (
    label !== undefined &&
    label.outcome !== "SWITCH_UNEVALUABLE" &&
    label.normalizedGain !== null &&
    label.exactGain !== null
  );
}
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const half = Math.floor(sorted.length / 2);
  return sorted.length === 0
    ? 0
    : sorted.length % 2
      ? c61Require(sorted[half])
      : (c61Require(sorted[half - 1]) + c61Require(sorted[half])) / 2;
}
const sigmoid = (x: number): number =>
  x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x));
function vector(
  sample: C611CalibrationSample,
  model: Pick<C611SelectiveModel, "preprocessing">,
): number[] {
  return model.preprocessing.flatMap((column) => {
    const raw = sample.values[column.featureName];
    return [
      ((raw ?? column.imputedValue) - column.mean) / column.standardDeviation,
      raw === null ? 1 : 0,
    ];
  });
}
/** Call only with an outer/inner TRAIN partition. Test rows/labels have no parameter. */
export function fitC611SelectiveModel(
  trainingSamples: C611CalibrationSample[],
  trainingLabels: C611CalibrationLabel[],
  profileId: C611CalibrationProfileId,
  policy: C611CalibrationPolicy,
  preservationCost = 0,
): C611SelectiveModel {
  verifyC611CalibrationPolicy(policy);
  const samples = validateC611Samples(trainingSamples);
  const ids = new Set(samples.map((x) => x.proposalId));
  if (trainingLabels.some((x) => !ids.has(x.proposalId)))
    throw new Error("C611_FOREIGN_LABEL_IN_TRAINING");
  if (
    new Set(trainingLabels.map((x) => x.proposalId)).size !==
    trainingLabels.length
  )
    throw new Error("C611_DUPLICATE_TRAINING_LABEL");
  if (new Set(samples.map((x) => x.eventId)).size !== samples.length)
    throw new Error("C611_MULTIPLE_TRAINING_PROPOSALS_PER_EVENT");
  const sampleEvents = new Map(samples.map((x) => [x.proposalId, x.eventId]));
  if (trainingLabels.some((x) => sampleEvents.get(x.proposalId) !== x.eventId))
    throw new Error("C611_TRAINING_LABEL_EVENT_MISMATCH");
  const labelMap = new Map(trainingLabels.map((x) => [x.proposalId, x]));
  const train = samples.filter(
    (s) =>
      s.eligibilityStatus === "ELIGIBLE" &&
      c611LabelEvaluable(labelMap.get(s.proposalId)),
  );
  const profile = policy.profiles.find((x) => x.profileId === profileId);
  if (!profile) throw new Error("C611_UNKNOWN_PROFILE");
  const y = train.map((s) =>
    Number(
      c61Require(labelMap.get(s.proposalId)).outcome === "SWITCH_IMPROVES",
    ),
  );
  const positiveCount = y.reduce((sum, value) => sum + value, 0);
  const preprocessing: C611SelectiveModel["preprocessing"] =
    profile.modelType === "L2_LOGISTIC"
      ? profile.featureNames.map((featureName) => {
          const observed = train
            .map((s) => s.values[featureName])
            .filter((x): x is number => x !== null && x !== undefined);
          const imputedValue = median(observed);
          const filled = train.map(
            (s) => s.values[featureName] ?? imputedValue,
          );
          const mean = filled.length
            ? filled.reduce((sum, x) => sum + x, 0) / filled.length
            : 0;
          const deviation = filled.length
            ? Math.sqrt(
                filled.reduce((sum, x) => sum + (x - mean) ** 2, 0) /
                  filled.length,
              )
            : 0;
          return {
            featureName,
            observedCount: observed.length,
            missingCount: train.length - observed.length,
            imputedValue,
            mean,
            standardDeviation: deviation > 1e-12 ? deviation : 1,
            allMissing: observed.length === 0,
          };
        })
      : [];
  const coefficients = Array.from(
    { length: preprocessing.length * 2 },
    () => 0,
  );
  let intercept = 0,
    iterationsRun = 0;
  let status: C611SelectiveModel["status"] = "NO_TRAINING_REQUIRED";
  if (profile.modelType === "L2_LOGISTIC") {
    status =
      train.length === 0
        ? "NO_EVALUABLE_TRAINING"
        : positiveCount === 0 || positiveCount === train.length
          ? "SINGLE_CLASS"
          : "FITTED";
    const prior = (positiveCount + 0.5) / (train.length + 1);
    intercept = Math.log(prior / (1 - prior));
    if (status === "FITTED") {
      const matrix = train.map((sample) => vector(sample, { preprocessing }));
      for (let iteration = 0; iteration < policy.iterations; iteration++) {
        const gradient = coefficients.map(
          (coefficient) => policy.l2 * coefficient,
        );
        let interceptGradient = 0;
        for (let row = 0; row < matrix.length; row++) {
          const values = c61Require(matrix[row]);
          const prediction = sigmoid(
            intercept +
              values.reduce(
                (sum, x, column) => sum + x * c61Require(coefficients[column]),
                0,
              ),
          );
          const error = (prediction - c61Require(y[row])) / matrix.length;
          interceptGradient += error;
          for (let column = 0; column < values.length; column++)
            gradient[column] =
              c61Require(gradient[column]) + error * c61Require(values[column]);
        }
        intercept -= policy.learningRate * interceptGradient;
        let largest = Math.abs(interceptGradient);
        for (let column = 0; column < coefficients.length; column++) {
          largest = Math.max(largest, Math.abs(c61Require(gradient[column])));
          coefficients[column] =
            c61Require(coefficients[column]) -
            policy.learningRate * c61Require(gradient[column]);
        }
        iterationsRun = iteration + 1;
        if (largest < policy.tolerance) break;
      }
    }
  }
  const body: Omit<C611SelectiveModel, "semanticHash"> = {
    profileId,
    modelType: profile.modelType,
    policyHash: policy.semanticHash,
    trainingProposalIds: train.map((x) => x.proposalId),
    trainingEventIds: [...new Set(train.map((x) => x.eventId))].sort(),
    trainingDatasetHash: hash(
      train.map((sample) => ({
        sample,
        label: labelMap.get(sample.proposalId),
      })),
    ),
    featureNames: profile.featureNames,
    preprocessing,
    coefficients,
    intercept,
    preservationCost,
    positiveCount,
    negativeCount: train.length - positiveCount,
    iterationsRun,
    status,
  };
  return c611SelectiveModelSchema.parse({ ...body, semanticHash: hash(body) });
}
/** Pure machine inference. Deliberately accepts NO labels or evaluation mapping. */
export function predictC611SelectiveModel(
  sample: C611CalibrationSample,
  model: C611SelectiveModel,
  policy: C611CalibrationPolicy,
): number | null {
  verifyC611CalibrationPolicy(policy);
  validateC611Samples([sample]);
  const { semanticHash, ...body } = c611SelectiveModelSchema.parse(model);
  if (hash(body) !== semanticHash || model.policyHash !== policy.semanticHash)
    throw new Error("C611_MODEL_IDENTITY_MISMATCH");
  if (sample.eligibilityStatus !== "ELIGIBLE") return null;
  if (model.modelType === "RAW_MARGIN")
    return sample.values.rawMbrMargin ?? null;
  if (model.modelType === "HIERARCHICAL_MARGIN")
    return sample.values.hierarchicalMbrMargin ?? null;
  if (model.modelType === "PRESERVATION_MARGIN") {
    const margin = sample.values.hierarchicalMbrMargin,
      distance = sample.values.normalizedDistance;
    return margin === null ||
      distance === null ||
      margin === undefined ||
      distance === undefined
      ? null
      : margin - model.preservationCost * (1 + distance);
  }
  if (model.modelType === "L2_LOGISTIC")
    return model.status === "NO_EVALUABLE_TRAINING"
      ? null
      : sigmoid(
          model.intercept +
            vector(sample, model).reduce(
              (sum, x, i) => sum + x * c61Require(model.coefficients[i]),
              0,
            ),
        );
  if (model.modelType === "CONSERVATIVE_RULE") {
    const names = [
      "hierarchicalMbrMargin",
      "runnerUpMargin",
      "providerSupportCount",
      "crossModelAgreement",
      "deletedCharacterRatio",
      "requestEdgeRisk",
    ] as const;
    if (names.some((name) => sample.values[name] === null)) return null;
    const v = sample.values;
    return (
      Math.min(
        c61Require(v.hierarchicalMbrMargin),
        c61Require(v.runnerUpMargin),
        policy.ruleMarginScale *
          Math.min(1, c61Require(v.providerSupportCount) / 2),
        policy.ruleMarginScale * c61Require(v.crossModelAgreement),
      ) -
      policy.ruleDeletionPenalty *
        (c61Require(v.deletedCharacterRatio) + c61Require(v.requestEdgeRisk)) -
      (v.ctcDirection !== null && c61Require(v.ctcDirection) < 0
        ? policy.ruleMarginScale
        : 0)
    );
  }
  return null;
}
export function c611CatastrophicDeletion(
  sample: C611CalibrationSample,
  label: C611CalibrationLabel,
  policy: C611CalibrationPolicy,
): boolean {
  return (
    label.outcome === "SWITCH_REGRESSES" &&
    (label.normalizedGain ?? 0) <= -policy.catastrophicMinimumRegression &&
    (sample.values.deletedCharacterRatio ?? 0) >=
      policy.catastrophicDeletedRatio &&
    sample.values.speechCompleteness !== 1
  );
}
export function selectC611Threshold(
  rows: {
    sample: C611CalibrationSample;
    score: number | null;
    label: C611CalibrationLabel | undefined;
  }[],
  policy: C611CalibrationPolicy,
  preservationCost = 0,
): {
  candidates: C611ThresholdCandidate[];
  chosen: C611ThresholdCandidate | null;
  minimumSelected: number;
} {
  const evaluable = rows.filter(
    (r) =>
      r.sample.eligibilityStatus === "ELIGIBLE" && c611LabelEvaluable(r.label),
  );
  const minimumSelected = Math.max(
    policy.innerMinimumSelected,
    Math.ceil(evaluable.length * policy.minimumSelectedFraction),
  );
  const thresholds = [
    ...new Set(evaluable.flatMap((r) => (r.score === null ? [] : [r.score]))),
  ].sort((a, b) => b - a);
  const candidates = thresholds.map((threshold): C611ThresholdCandidate => {
    const chosen = evaluable.filter(
      (r) => r.score !== null && r.score >= threshold,
    );
    const correct = chosen.filter(
      (r) => c61Require(r.label).outcome === "SWITCH_IMPROVES",
    ).length;
    const wrong = chosen.filter(
      (r) => c61Require(r.label).outcome === "SWITCH_REGRESSES",
    ).length;
    const neutral = chosen.filter(
      (r) => c61Require(r.label).outcome === "SWITCH_NEUTRAL",
    ).length;
    const catastrophic = chosen.filter((r) =>
      c611CatastrophicDeletion(r.sample, c61Require(r.label), policy),
    ).length;
    const normalizedGain = chosen.reduce(
      (sum, r) => sum + c61Require(c61Require(r.label).normalizedGain),
      0,
    );
    const exactGain = chosen.reduce(
      (sum, r) => sum + c61Require(c61Require(r.label).exactGain),
      0,
    );
    return {
      threshold,
      preservationCost,
      selected: chosen.length,
      correct,
      wrong,
      neutral,
      catastrophic,
      normalizedGain,
      exactGain,
      qualified:
        catastrophic === 0 &&
        normalizedGain > 0 &&
        chosen.length >= minimumSelected,
    };
  });
  return {
    candidates,
    chosen: rankC611ThresholdCandidates(candidates)[0] ?? null,
    minimumSelected,
  };
}
export function rankC611ThresholdCandidates(
  candidates: C611ThresholdCandidate[],
): C611ThresholdCandidate[] {
  return candidates
    .filter((x) => x.qualified)
    .sort(
      (a, b) =>
        a.wrong - b.wrong ||
        b.selected - a.selected ||
        b.normalizedGain - a.normalizedGain ||
        b.preservationCost - a.preservationCost ||
        b.threshold - a.threshold,
    );
}
