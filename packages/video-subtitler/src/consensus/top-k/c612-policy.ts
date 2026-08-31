import {
  C612_FEATURE_NAMES,
  C612_PROFILES,
  C612_RETRIEVAL,
  C612_VERSION,
} from "@mvl/shared";
import { machineQualitySemanticHash as hash } from "../../machine-quality/evidence-correlation.js";

export { hash };
/** Require a proven index/binding at runtime instead of erasing null checks. */
export function c612Defined<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("C612_REQUIRED_VALUE_MISSING");
  return value;
}
export const C612_POLICY = {
  version: C612_VERSION,
  mode: "OFFLINE_SHADOW_ONLY_KNOWN_DEVELOPMENT_BENCHMARK",
  retrieval: {
    profiles: C612_RETRIEVAL,
    k: 4,
    currentConsumesSlot: false,
    primary: C612_RETRIEVAL[3],
    tieBreak: "PROVENANCE_HASH_THEN_CANDIDATE_ID",
    unionSeedPerRanker: 2,
  },
  correlation: {
    verified: "ACTUAL_PCM_PLUS_EXPLICIT_SOURCE_REQUEST_LINEAGE",
    provisional: "EXPLICIT_INTERVAL_NOT_PCM_VERIFIED",
    unknownIsIndependent: false,
    currentVote: 0,
    observationVote: 1,
  },
  completeness: {
    minimumTokenPosterior: 0.65,
    minimumSupportedTokenFraction: 0.9,
    minimumSpeechCoverage: 0.9,
    maximumUncoveredEdgeSeconds: 0.25,
    maximumInternalUncoveredSeconds: 0.3,
    minimumRequestEdgeDistance: 0.04,
    tokenToleranceSeconds: 0.06,
    ctcAloneSelectsWinner: false,
  },
  verifier: {
    mode: "EXACT_CACHE_FIRST_BOUNDED_NON_GENERATIVE",
    maximumAudioRequests: 200,
    maximumWindowSeconds: 30,
    sampleRate: 16000,
    channels: 1,
    precision: "fp32",
    device: "cpu",
    network: false,
    targetGeneration: false,
  },
  contraction: {
    strongLengthRatio: 0.55,
    strongDeletionRatio: 0.45,
    gate: "VERIFIED_COMPLETE_OR_ACOUSTICALLY_PROVEN_HALLUCINATION_REMOVAL",
    unknown: "ABSTAIN",
    lengthOnlyBan: false,
  },
  mapping: {
    method: "MACHINE_CUE_OVERLAP_AND_EXACT_EVENT_LINEAGE_COMPONENTS",
    maximumGroupSeconds: 45,
    minimumGoldTemporalCoverage: 0.5,
    goldTextForBinding: false,
    allProfilesShareBinding: true,
  },
  features: C612_FEATURE_NAMES,
  folds: {
    count: 5,
    method: "CONTIGUOUS_TIME_BLOCKED_CONNECTED_AUDIO_CORRELATION_CUE_GROUPS",
    gapSeconds: 0,
    randomSplit: false,
  },
  rankers: {
    profiles: C612_PROFILES,
    pairwise: "L2_LOGISTIC",
    listwise: "LINEAR_LISTWISE_SOFTMAX",
    regularization: 0.1,
    iterations: 160,
    learningRate: 0.08,
    equalErrorPairs: "EXCLUDE",
    imputation: "TRAIN_ONLY_MEAN_WITH_MISSING_FLAG",
    scaling: "TRAIN_ONLY_STANDARD_DEVIATION",
    trainOnlyThresholdCandidates: [0, 0.1, 0.25, 0.5, 1, 2, 4],
    innerMinimumImproved: 2,
    innerMinimumPrecision: 0.85,
    innerMaximumHarm: 0.1,
  },
  groupConfigurations: {
    maximumConfigurations: 16,
    maximumChangedEvents: 2,
    alwaysRetainCurrent: true,
    noSplitMerge: true,
    noTimingMutation: true,
  },
  gates: {
    minimumConservation: 1,
    minimumProvenance: 1,
    minimumCorrelationCoverage: 0.9,
    minimumCompletenessCoverage: 0.9,
    maximumDoubleCount: 0,
    maximumLeakage: 0,
    minimumChangedEvaluationCoverage: 0.8,
    minimumRecall4: 0.9,
    minimumPrecision: 0.85,
    maximumHarm: 0.1,
    minimumChangedGroups: 5,
    minimumActiveFolds: 3,
    maximumNegativeFolds: 0,
    maximumCatastrophicRegressions: 0,
    maximumMaterialDelta: 0,
    minimumOracleCapture: 0.8,
  },
  chronology: {
    machineFreezeBeforeLabels: true,
    profilesFreezeBeforeLabels: true,
    supervisedOofShadowsAfterTrainLabels: true,
    outerTestLabelsForInference: false,
  },
  productionMutation: false,
} as const;
export const C612_POLICY_HASH = hash(C612_POLICY);
export function artifact<const N extends string, T extends object>(
  artifactType: N,
  value: T,
) {
  const body = {
    schemaVersion: "1.0.0" as const,
    artifactType,
    policyVersion: C612_VERSION,
    ...value,
  };
  return { ...body, semanticHash: hash(body) };
}
export function ratio(n: number, d: number): number | null {
  return d > 0 ? n / d : null;
}
