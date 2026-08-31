import { C6121_VERSION, c6121GeneratedSchemas } from "@mvl/shared";
import { C611_FIXED_ALIGNMENT_POLICY } from "../fixed-baseline-alignment-map.js";
import { C612_POLICY, hash } from "../top-k/c612-policy.js";
import {
  C612_RERANKERS,
  C612_RERANKER_PROFILE_HASH,
} from "../top-k/linear-reranker.js";
export { hash };
export const C6121_POLICY = Object.freeze({
  version: C6121_VERSION,
  primaryEvaluator: "E2_FROZEN_MACHINE_GROUP_GOLD_TIMING_SUPERGROUP",
  modes: [
    "E0_MACHINE_GROUP_BINDING",
    "E1_BASELINE_TEMPORAL_BIPARTITE_COMPONENTS",
    "E2_FROZEN_MACHINE_GROUP_GOLD_TIMING_SUPERGROUP",
  ],
  edge: "STRICT_POSITIVE_TEMPORAL_OVERLAP_OF_ACTUAL_PRODUCTION_CUES",
  structure: C611_FIXED_ALIGNMENT_POLICY,
  timingDTO: ["id", "start", "end"],
  barriers: [
    "MACHINE_FREEZE",
    "GOLD_TIMING_ONLY",
    "SUPERGROUP_FREEZE",
    "GOLD_TEXT_SCORING",
  ],
  folds: "EXACT_FROZEN_C612_FOLDS_NO_REPARTITION_CROSS_FOLD_EXCLUDED",
  labels: "SINGLE_LEGAL_EXISTING_CANDIDATE_WHOLE_SUPERGROUP_COUNTERFACTUAL",
  trainingLabelGroupWeight:
    "PRESERVE_FROZEN_MACHINE_GROUP_ID_WEIGHTING_ONLY_NUMERIC_OUTCOMES_CHANGE",
  profiles: C612_RERANKERS,
  profileDefinitionHash: C612_RERANKER_PROFILE_HASH,
  training: C612_POLICY.rankers,
  primaryProfile: "L6",
  coverage: {
    minimum: 0.8,
    primaryProfile: "L6",
    zeroDenominator: null,
    zeroSelectionUtilityCoverage: 0,
  },
  coverageDenominators: {
    machineGroups: "ALL_FROZEN_MACHINE_GROUPS_ALL_CUES_MUST_BE_COVERED",
    productionCues: "ALL_FROZEN_PRODUCTION_CUES",
    goldCues: "ALL_GOLD_TIMING_CUES_INCLUDING_ISOLATED_VERTICES",
    candidateEvents:
      "UNIQUE_FROZEN_TOP_K_EVENTS_CURRENT_AND_ONE_ALTERNATIVE_LABEL_REQUIRED",
    candidateLabels: "ALL_FROZEN_CANDIDATE_RANK_ROWS",
    topKCandidateLabels: "ALL_FROZEN_FEATURE_ROWS",
    durations: "UNION_DURATION_NOT_SUM_OF_OVERLAPPING_CUES",
    profilePrecision:
      "IMPROVED_DIVIDED_BY_IMPROVED_PLUS_REGRESSED_SAME_AS_C612",
    profileHarm: "REGRESSED_DIVIDED_BY_EVALUABLE_CHANGED_SUPERGROUPS",
  },
  safeProfile: {
    catastrophicDeletionCount: 0,
    minimumPrecision: 0.85,
    maximumHarmRate: 0.1,
    minimumNormalizedJointGainExclusive: 0,
    maximumMaterialDelta: 0,
    minimumActiveFolds: 3,
    maximumNegativeGainFolds: 0,
    minimumEvaluableChanges: 5,
    minimumChangedCoverage: 0.8,
  },
  safeProfileOrder: [
    "HARM_ASC",
    "PRECISION_DESC",
    "CATASTROPHIC_ASC",
    "GAIN_DESC",
    "MATERIAL_ASC",
    "ACTIVE_FOLDS_DESC",
    "PROFILE_ID_ASC",
  ],
  strongSupport: {
    maximumUnknownGainFolds: 0,
    productionMutation: 0,
    aBParity: true,
  },
  completenessDiagnosis: {
    insufficientNonUnknownCoverage: 0.8,
    safeCandidate: "POSITIVE_GAIN_NONCATASTROPHIC_NONPOSITIVE_MATERIAL",
  },
  routePriority: [
    "ENGINEERING_INVALID",
    "COVERAGE_INSUFFICIENT",
    "STRONG_SUPPORT",
    "COMPLETENESS_MAIN_BLOCKER",
    "STOP_AUTOMATIC_RERANKING",
  ],
  rawGoldModelInputs: 0,
  newModelInference: 0,
  newCandidateCount: 0,
  productionMutation: false,
});
export const C6121_POLICY_HASH = hash(C6121_POLICY);
const clockFields = new Set([
  "generatedAt",
  "machineFrozenAt",
  "goldTimingFirstReadAt",
  "supergroupFrozenAt",
  "goldTextFirstReadAt",
]);
/** Only top-level run clocks are excluded; actual cue timing and all decisions stay hashed. */
export function c6121SemanticContent(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([key]) => key !== "semanticHash" && !clockFields.has(key),
    ),
  );
}
export function c6121Artifact<const N extends string, T extends object>(
  artifactType: N,
  fields: T,
) {
  const body = {
    schemaVersion: "1.0.0" as const,
    artifactType,
    policyVersion: C6121_VERSION,
    policyHash: C6121_POLICY_HASH,
    ...fields,
  };
  return { ...body, semanticHash: hash(c6121SemanticContent(body)) };
}
export function validateC6121Artifact(value: unknown) {
  if (!value || typeof value !== "object" || !("artifactType" in value))
    throw new Error("C6121_ARTIFACT_EXPECTED");
  const entry = c6121GeneratedSchemas.find(
    ([name]) => name === value.artifactType,
  );
  if (!entry) throw new Error("C6121_UNREGISTERED_ARTIFACT");
  const parsed = entry[1].parse(value);
  if (
    parsed.policyHash !== C6121_POLICY_HASH ||
    parsed.semanticHash !== hash(c6121SemanticContent(parsed))
  )
    throw new Error("C6121_ARTIFACT_HASH_OR_POLICY_MISMATCH");
  return parsed;
}
export function fraction(numerator: number, denominator: number) {
  demand(
    Number.isFinite(numerator) &&
      Number.isFinite(denominator) &&
      numerator >= 0 &&
      denominator >= 0 &&
      numerator <= denominator + 1e-8,
    "C6121_INVALID_COVERAGE_FRACTION",
  );
  return {
    numerator,
    denominator,
    ratio: denominator > 0 ? Math.min(1, numerator / denominator) : null,
  };
}
export function demand(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
export function counts(items: readonly string[]) {
  return [...new Set(items)].sort().map((reason) => ({
    reason,
    count: items.filter((x) => x === reason).length,
  }));
}
