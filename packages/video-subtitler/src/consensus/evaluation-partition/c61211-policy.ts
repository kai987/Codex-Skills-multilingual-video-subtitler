import {
  C61211_VERSION,
  c61211GeneratedSchemas,
  type C61211Mode,
} from "@mvl/shared";
import {
  C6121_POLICY,
  hash,
  demand,
  fraction,
  counts,
} from "../evaluation-recovery/c6121-policy.js";
export { hash, demand, fraction, counts };
export const C61211_PARTITION_POLICY = {
  structure: C6121_POLICY.structure,
  modes: {
    D0_NO_CUT: {
      maximumWeakBridge: 0,
      maximumCutLoss: 0,
      minimumNodeRetained: 1,
      allowCuts: false,
    },
    D1_CONSERVATIVE_MONOTONIC: {
      maximumWeakBridge: 0.15,
      maximumCutLoss: 0.1,
      minimumNodeRetained: 0.8,
      allowCuts: true,
    },
    D2_RELAXED_DIAGNOSTIC_ONLY: {
      maximumWeakBridge: 0.25,
      maximumCutLoss: 0.2,
      minimumNodeRetained: 0.65,
      allowCuts: true,
    },
  },
  strongBridgeMinimumBoth: 0.5,
  objective: [
    "MAX_EVALUABLE_RETAINED_UNION_SECONDS",
    "MAX_CANDIDATE_REACHABLE_MACHINE_GROUPS",
    "MAX_PRODUCTION_CUES",
    "MAX_INTERVENTION_REACHABLE_GOLD_CUES",
    "MIN_CUT_UNION_SECONDS",
    "MIN_RESIDUAL_BILATERAL_NODES",
    "MIN_BLOCK_COUNT",
    "MIN_SEMANTIC_PATH_HASH",
  ],
  solver: "EXACT_MONOTONE_INTERVAL_DAG_ENUMERATION",
  residualOverlapCreditedToEvaluationObjective: false,
  residualIncidentEdgesAudited: true,
  residualNodeRetainedRuleEnforced: true,
  machineGroupAtomic: true,
  goldCueAtomic: true,
} as const;
export const C61211_COVERAGE_POLICY = {
  minimumCoverage: 0.8,
  gateMetrics: [
    "allMachineGroupCoverage",
    "productionCueCoverage",
    "interventionReachableGoldCueCoverage",
    "candidateReachableMachineGroupCoverage",
    "candidateEventLabelCoverage",
    "topKCandidateLabelCoverage",
  ],
  globalGoldScope: "ALL_GOLD_CUES_INCLUDING_GOLD_ONLY",
  interventionScope:
    "AT_LEAST_ONE_STRICT_POSITIVE_EDGE_TO_FROZEN_MACHINE_GROUP",
  candidateScope:
    "FROZEN_TOP_K_EVENT_WITH_CURRENT_AND_STRUCTURALLY_LEGAL_EXISTING_ALTERNATIVE",
  profileSelectionUsed: false,
  globalGoldCoverageUsed: false,
} as const;
export const C61211_ROUTE_POLICY = {
  safeProfile: {
    minimumSelected: 1,
    minimumEvaluableChanges: 5,
    minimumActiveFolds: 3,
    maximumNegativeFolds: 0,
    maximumUnknownFolds: 0,
    minimumChangedCoverage: 0.8,
    minimumPrecision: 0.85,
    maximumHarmRate: 0.1,
    minimumExclusiveGain: 0,
    maximumMaterialDelta: 0,
    maximumCatastrophic: 0,
  },
  completenessKnownMinimum: 0.8,
  manySafeFalseBlockRate: 0.5,
  priority: [
    "ENGINEERING_INVALID",
    "UNSAFE_PARTITION_UNRECOVERABLE",
    "SAFE_PROSPECTIVE_SHADOW",
    "COMPLETENESS_MAIN_BLOCKER",
    "STOP_AUTOMATIC_RERANKING",
  ],
  wholeComponentDiagnosticIsRouteInput: false,
  relaxedDiagnosticIsRouteInput: false,
  furtherEvaluatorLooseningAllowed: false,
} as const;
export const C61211_POLICY = {
  version: C61211_VERSION,
  primaryEvaluator: "E3_CONSTRAINED_MONOTONIC_PARTITIONED_SUPERGROUP",
  partition: C61211_PARTITION_POLICY,
  coverage: C61211_COVERAGE_POLICY,
  route: C61211_ROUTE_POLICY,
  originalTraining: C6121_POLICY.training,
  machineRuntimeGoldInputs: 0,
  acousticModelExecution: 0,
} as const;
export const C61211_POLICY_HASH = hash(C61211_POLICY);
export const c61211Rule = (mode: C61211Mode) =>
  C61211_PARTITION_POLICY.modes[mode];
const clocks = new Set([
  "generatedAt",
  "machineFrozenAt",
  "goldTimingFirstReadAt",
  "partitionFrozenAt",
  "goldTextFirstReadAt",
]);
export function c61211Artifact<N extends string, T extends object>(
  artifactType: N,
  fields: T,
) {
  const body = {
    schemaVersion: "1.0.0" as const,
    artifactType,
    policyVersion: C61211_VERSION,
    policyHash: C61211_POLICY_HASH,
    ...fields,
  };
  return {
    ...body,
    semanticHash: hash(
      Object.fromEntries(
        Object.entries(body).filter(([key]) => !clocks.has(key)),
      ),
    ),
  };
}
export function c61211Body(value: object) {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([k]) =>
        ![
          "schemaVersion",
          "artifactType",
          "policyVersion",
          "policyHash",
          "semanticHash",
        ].includes(k),
    ),
  );
}
export function validateC61211Artifact(value: unknown) {
  demand(!!value && typeof value === "object", "C61211_NOT_ARTIFACT");
  const row = value as Record<string, unknown>;
  const schema = c61211GeneratedSchemas.find(
    ([name]) => name === row.artifactType,
  )?.[1];
  demand(schema, "C61211_UNKNOWN_ARTIFACT:" + String(row.artifactType));
  const parsed = schema.parse(value);
  demand(parsed.policyHash === C61211_POLICY_HASH, "C61211_POLICY_DRIFT");
  demand(
    parsed.semanticHash ===
      hash(
        Object.fromEntries(
          Object.entries(parsed).filter(
            ([key]) => key !== "semanticHash" && !clocks.has(key),
          ),
        ),
      ),
    "C61211_SEMANTIC_HASH_MISMATCH",
  );
  return parsed;
}
