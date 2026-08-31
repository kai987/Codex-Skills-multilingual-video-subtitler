import {
  C612_FEATURE_NAMES,
  c612ModelSchema,
  type C612FeatureRow,
  type C612Label,
  type C612Model,
} from "@mvl/shared";
import { C612_POLICY, hash, c612Defined } from "./c612-policy.js";
export interface RerankerProfile {
  id: string;
  algorithm: C612Model["algorithm"];
  retrieval: 0 | 1 | 3;
  enabled: boolean[];
  completenessGate: boolean;
  contractionGate: boolean;
  correlationBalanced: boolean;
  abstention: boolean;
}
const all = () => C612_FEATURE_NAMES.map(() => true);
const omit = (names: readonly string[]) =>
  C612_FEATURE_NAMES.map((n) => !names.includes(n));
const acoustic = C612_FEATURE_NAMES.slice(25, 34),
  correlation = C612_FEATURE_NAMES.slice(17, 23),
  provider = C612_FEATURE_NAMES.slice(14, 16);
const config = (
  id: string,
  fields: Partial<RerankerProfile> = {},
): RerankerProfile => ({
  id,
  algorithm: "LISTWISE_SOFTMAX",
  retrieval: 3,
  enabled: all(),
  completenessGate: false,
  contractionGate: true,
  correlationBalanced: false,
  abstention: false,
  ...fields,
});
export const C612_RERANKERS: readonly RerankerProfile[] = [
  config("L0", {
    algorithm: "FIXED_BASELINE",
    retrieval: 0,
    contractionGate: false,
  }),
  config("L1", {
    algorithm: "FIXED_BASELINE",
    retrieval: 1,
    contractionGate: false,
  }),
  config("L2", { algorithm: "PAIRWISE_LOGISTIC", contractionGate: false }),
  config("L3", { contractionGate: false }),
  config("L4", { completenessGate: true }),
  config("L5", { completenessGate: true, correlationBalanced: true }),
  config("L6", {
    completenessGate: true,
    correlationBalanced: true,
    abstention: true,
  }),
  config("L7", {
    completenessGate: true,
    correlationBalanced: true,
    abstention: true,
    enabled: omit(provider),
  }),
  config("L8", {
    completenessGate: true,
    correlationBalanced: true,
    abstention: true,
    enabled: omit(acoustic),
  }),
  config("A0_H2_BASELINE", {
    algorithm: "FIXED_BASELINE",
    retrieval: 0,
    contractionGate: false,
  }),
  config("A1_TOP_K_TEXT_STRUCTURAL_ONLY", {
    enabled: omit([...acoustic, ...correlation, ...provider]),
    contractionGate: false,
  }),
  config("A2_TOP_K_PLUS_CORRELATION", {
    enabled: omit([...acoustic, ...provider]),
    contractionGate: false,
    correlationBalanced: true,
  }),
  config("A3_TOP_K_PLUS_ACOUSTIC_COMPLETENESS", {
    enabled: omit([...correlation, ...provider]),
    completenessGate: true,
  }),
  config("A4_TOP_K_PLUS_CORRELATION_PLUS_COMPLETENESS", {
    completenessGate: true,
    correlationBalanced: true,
  }),
  config("A5_WITHOUT_PROVIDER_IDENTITY", {
    completenessGate: true,
    correlationBalanced: true,
    enabled: omit(provider),
  }),
  config("A6_WITHOUT_CTC", {
    completenessGate: true,
    correlationBalanced: true,
    enabled: omit(["candidateCtcLossPerToken", "relativeCtcMargin"]),
  }),
  config("A7_WITHOUT_CONTRACTION_GATE", {
    completenessGate: true,
    correlationBalanced: true,
    contractionGate: false,
  }),
  config("A8_ABSTENTION_FIRST_FULL", {
    completenessGate: true,
    correlationBalanced: true,
    abstention: true,
  }),
];
export const C612_RERANKER_PROFILE_HASH = hash(C612_RERANKERS);
export const softmax = (values: readonly number[]) => {
  const maximum = Math.max(...values),
    exp = values.map((v) => Math.exp(v - maximum)),
    sum = exp.reduce((a, b) => a + b, 0);
  return exp.map((v) => v / sum);
};
function vector(
  row: C612FeatureRow,
  model: Pick<C612Model, "means" | "scales" | "enabled">,
) {
  return row.values
    .map((v, i) =>
      model.enabled[i]
        ? ((v ?? c612Defined(model.means[i])) - c612Defined(model.means[i])) /
          c612Defined(model.scales[i])
        : 0,
    )
    .concat(
      row.missing.map((missing, i) => (model.enabled[i] ? Number(missing) : 0)),
    );
}
/** This prediction function accepts no labels, group outcomes, text or Gold path. */
export function predictLinear(model: C612Model, row: C612FeatureRow): number {
  const x = vector(row, model);
  if (model.weights.length !== x.length)
    throw new Error("C612_MODEL_DIMENSION");
  const score = x.reduce(
    (sum, v, i) => sum + v * c612Defined(model.weights[i]),
    model.intercept,
  );
  if (!Number.isFinite(score)) throw new Error("C612_NONFINITE_PREDICTION");
  return score;
}
/** Input labels must already have been restricted to the outer training partition. */
export function trainLinearReranker(input: {
  profile: RerankerProfile;
  outerFoldId: string;
  features: readonly C612FeatureRow[];
  labels: readonly C612Label[];
  forbiddenEventIds: readonly string[];
}): C612Model {
  const labels = input.labels
    .filter((l) => l.eligible && l.candidateNormalizedError !== null)
    .toSorted((a, b) => a.candidateId.localeCompare(b.candidateId));
  if (labels.some((l) => input.forbiddenEventIds.includes(l.eventId)))
    throw new Error("C612_OUTER_TEST_LABEL_IN_TRAINING");
  const allowed = new Set(labels.map((l) => l.candidateId));
  if (allowed.size !== labels.length)
    throw new Error("C612_DUPLICATE_TRAINING_LABEL");
  const features = input.features
    .filter((r) => allowed.has(r.candidateId))
    .toSorted((a, b) => a.candidateId.localeCompare(b.candidateId));
  if (
    features.length !== labels.length ||
    new Set(features.map((r) => r.candidateId)).size !== labels.length ||
    features.some(
      (r) =>
        labels.find((l) => l.candidateId === r.candidateId)?.eventId !==
        r.eventId,
    )
  )
    throw new Error("C612_LABEL_FEATURE_BINDING");
  const featureById = new Map(features.map((r) => [r.candidateId, r]));
  const means = C612_FEATURE_NAMES.map((_, i) => {
    const values = features.flatMap((r) =>
      r.values[i] === null ? [] : [c612Defined(r.values[i])],
    );
    return values.length
      ? values.reduce((a, b) => a + b, 0) / values.length
      : 0;
  });
  const scales = means.map((mean, i) => {
    const values = features.flatMap((r) =>
      r.values[i] === null ? [] : [c612Defined(r.values[i])],
    );
    const std = Math.sqrt(
      values.reduce((n, x) => n + (x - mean) ** 2, 0) /
        Math.max(1, values.length),
    );
    return std > 1e-8 ? std : 1;
  });
  const transform = { means, scales, enabled: input.profile.enabled },
    vectors = new Map(
      features.map((r) => [r.candidateId, vector(r, transform)]),
    );
  const weights = Array.from(
    { length: C612_FEATURE_NAMES.length * 2 },
    () => 0,
  );
  const events = [...new Set(labels.map((l) => l.eventId))]
    .sort()
    .map((eventId) => labels.filter((l) => l.eventId === eventId));
  const groupCounts = new Map<string, number>();
  events.forEach((list) => {
    const g = list[0]?.groupId;
    if (g) groupCounts.set(g, (groupCounts.get(g) ?? 0) + 1);
  });
  const iterations =
    input.profile.algorithm === "FIXED_BASELINE" || !events.length
      ? 0
      : C612_POLICY.rankers.iterations;
  for (let iteration = 0; iteration < iterations; iteration++) {
    const gradient = weights.map((w) => C612_POLICY.rankers.regularization * w);
    let total = 0;
    const accumulated = weights.map(() => 0);
    for (const list of events) {
      const groupWeight =
        1 / (groupCounts.get(c612Defined(list[0]).groupId ?? "") ?? 1);
      const xs = list.map((l) => c612Defined(vectors.get(l.candidateId))),
        scores = xs.map((x) =>
          x.reduce((n, v, i) => n + v * c612Defined(weights[i]), 0),
        );
      if (input.profile.algorithm === "PAIRWISE_LOGISTIC") {
        for (let a = 0; a < list.length; a++)
          for (let b = a + 1; b < list.length; b++) {
            const errorDelta =
              c612Defined(c612Defined(list[a]).candidateNormalizedError) -
              c612Defined(c612Defined(list[b]).candidateNormalizedError);
            if (!errorDelta) continue;
            const sign = errorDelta < 0 ? 1 : -1,
              scale =
                -sign /
                (1 +
                  Math.exp(
                    Math.max(
                      -50,
                      Math.min(
                        50,
                        sign *
                          (c612Defined(scores[a]) - c612Defined(scores[b])),
                      ),
                    ),
                  ));
            for (let d = 0; d < weights.length; d++)
              accumulated[d] =
                c612Defined(accumulated[d]) +
                groupWeight *
                  scale *
                  (c612Defined(c612Defined(xs[a])[d]) -
                    c612Defined(c612Defined(xs[b])[d]));
            total += groupWeight;
          }
      } else {
        const q = softmax(
            list.map((l) => -c612Defined(l.candidateNormalizedError)),
          ),
          p = softmax(scores);
        for (let a = 0; a < list.length; a++) {
          const row = c612Defined(
            featureById.get(c612Defined(list[a]).candidateId),
          );
          const observationWeight =
            input.profile.correlationBalanced && !c612Defined(list[a]).current
              ? 1 / Math.max(1, row.values[17] ?? 1)
              : 1;
          for (let d = 0; d < weights.length; d++)
            accumulated[d] =
              c612Defined(accumulated[d]) +
              groupWeight *
                observationWeight *
                (c612Defined(p[a]) - c612Defined(q[a])) *
                c612Defined(c612Defined(xs[a])[d]);
        }
        total += groupWeight;
      }
    }
    for (let d = 0; d < weights.length; d++) {
      gradient[d] =
        c612Defined(gradient[d]) +
        c612Defined(accumulated[d]) / Math.max(1, total);
      weights[d] =
        c612Defined(weights[d]) -
        C612_POLICY.rankers.learningRate * c612Defined(gradient[d]);
    }
  }
  const body = {
    modelId: `${input.profile.id}:${input.outerFoldId}`,
    profileId: input.profile.id,
    outerFoldId: input.outerFoldId,
    algorithm: input.profile.algorithm,
    featureNames: [...C612_FEATURE_NAMES],
    enabled: [...input.profile.enabled],
    means,
    scales,
    weights,
    intercept: 0,
    regularization: C612_POLICY.rankers.regularization,
    iterations,
    trainingEventIds: [...new Set(labels.map((l) => l.eventId))].sort(),
    trainingGroupIds: [
      ...new Set(labels.flatMap((l) => (l.groupId ? [l.groupId] : []))),
    ].sort(),
    trainingCandidateIds: features.map((r) => r.candidateId),
    trainingLabelHash: hash(labels),
    trainingFeatureHash: hash(features),
    outerTestLabelRead: false as const,
    missingFlagCount: C612_FEATURE_NAMES.length,
  };
  return c612ModelSchema.parse({ ...body, modelHash: hash(body) });
}
