import { machineQualitySemanticHash } from "../machine-quality/evidence-correlation.js";

export const C60112_REVIEW_POLICY_VERSION =
  "c6.0.1.12-multi-asr-review-assistance-v2" as const;

export const C60112_REVIEW_ITEM_TYPES = [
  "TEXT_CROSS_MODEL_DISAGREEMENT",
  "TEXT_WHISPER_INSTABILITY",
  "TEXT_REAZON_INSTABILITY",
  "TEXT_HALLUCINATION_RISK",
  "TEXT_LOW_ACOUSTIC_SUPPORT",
  "TEXT_PARTIAL_AGREEMENT",
  "MISSING_SPEECH_RISK",
  "TIMING_BOUNDARY_RISK",
  "TIMING_SEVERE_RISK",
  "OVERLAP_RISK",
  "MULTI_SPEAKER_RISK",
  "LOCALIZATION_RISK",
  "SPAN_LINEAGE_BLOCKED",
  "EVIDENCE_CONFLICT",
  "GENERAL_UNCERTAINTY",
] as const;

export type C60112ReviewItemType = (typeof C60112_REVIEW_ITEM_TYPES)[number];

export const C60112_REVIEW_REASON_CODES = [
  "WHISPER_REAZON_LEXICAL_CONFLICT",
  "WHISPER_CORE_UNSTABLE",
  "REAZON_CORE_UNSTABLE",
  "WHISPER_HALLUCINATION_SIGNAL",
  "REAZON_HALLUCINATION_SIGNAL",
  "INDEPENDENT_ACOUSTIC_DISAGREEMENT",
  "INDEPENDENT_ACOUSTIC_LOW_MARGIN",
  "DECODER_WEAK",
  "SPEECH_INCOMPLETE",
  "REQUEST_EDGE_RISK",
  "TIMING_EVIDENCE_CONFLICT",
  "OVERLAP_UNRESOLVED",
  "SPEAKER_OVERLAP",
  "LOCALIZATION_AMBIGUOUS",
  "MISSING_DIALOGUE_SUSPECTED",
  "SPAN_LINEAGE_UNAVAILABLE",
  "MACHINE_EVIDENCE_INCOMPLETE",
] as const;

export type C60112ReviewReasonCode =
  (typeof C60112_REVIEW_REASON_CODES)[number];

export const C60112_SUGGESTED_ACTIONS = [
  "KEEP_CURRENT",
  "USE_REAZON",
  "USE_WHISPER_ALTERNATE",
  "MANUAL_EDIT",
  "TIMING_EDIT",
  "ADD_NEW_CUE",
  "MARK_FALSE_POSITIVE",
  "UNRESOLVED",
  "WAIVE_REVIEW",
] as const;

export type C60112SuggestedAction = (typeof C60112_SUGGESTED_ACTIONS)[number];

export type C60112PriorityTier = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export type C60112RequiredLevel = "REQUIRED" | "RECOMMENDED" | "INFORMATIONAL";

export interface C60112Interval {
  start: number;
  end: number;
}

export interface C60112ReviewItem {
  reviewItemId: string;
  eventIds: string[];
  finalCueIds: string[];
  itemTypes: C60112ReviewItemType[];
  sourceInterval: C60112Interval;
  coreInterval: C60112Interval;
  currentText: string | null;
  candidateIds: string[];
  evidenceIds: string[];
  reviewReasons: C60112ReviewReasonCode[];
  priorityTier: C60112PriorityTier;
  priorityScore: number;
  requiredLevel: C60112RequiredLevel;
  suggestedActions: C60112SuggestedAction[];
  sceneIds: string[];
  speakerGroupIds: string[];
  semanticHash: string;
}

export interface C60112ReviewPolicy {
  schemaVersion: "1.0.0";
  policyVersion: typeof C60112_REVIEW_POLICY_VERSION;
  artifactType: "c6-0-1-12-review-assistance-policy";
  productRoute: "HUMAN_ON_EXCEPTION";
  policyFrozenAt: string;
  reviewItemTaxonomy: readonly C60112ReviewItemType[];
  priorityWeights: Readonly<Record<C60112ReviewItemType, number>>;
  priorityTierThresholds: {
    critical: number;
    high: number;
    medium: number;
  };
  priorityScoreMeaning: "EXPLAINABLE_RISK_RANK_NOT_ERROR_PROBABILITY";
  requiredRules: {
    allCritical: true;
    highTypes: readonly C60112ReviewItemType[];
    unresolvedDoesNotComplete: true;
    explicitWaiveAllowed: true;
  };
  regionMergePolicy: {
    sourceGlobalTimeRequired: true;
    maximumGapSeconds: number;
    maximumCoreDurationSeconds: number;
    preserveSceneBoundaries: true;
    preserveMultiSpeakerBoundaries: true;
  };
  audioContextPolicy: {
    preContextSeconds: number;
    postContextSeconds: number;
    localOnly: true;
    shareable: false;
  };
  candidateDisplayRules: {
    labels: readonly ["CURRENT", "WHISPER", "WHISPER_ALT", "REAZON"];
    normalizedDuplicateDisplayCollapse: true;
    preserveAllProvenance: true;
    calibratedConfidencePercentageAllowed: false;
    humanSelectionOnly: true;
  };
  goldBarrierRules: {
    runtimeGoldInputAllowed: false;
    freezeBeforeGoldEvaluation: true;
    goldMayTuneSameVersion: false;
    goldMayCreateHumanDecisions: false;
  };
  semanticHash: string;
}

const PRIORITY_WEIGHTS: Readonly<Record<C60112ReviewItemType, number>> = {
  TEXT_CROSS_MODEL_DISAGREEMENT: 74,
  TEXT_WHISPER_INSTABILITY: 67,
  TEXT_REAZON_INSTABILITY: 67,
  TEXT_HALLUCINATION_RISK: 96,
  TEXT_LOW_ACOUSTIC_SUPPORT: 64,
  TEXT_PARTIAL_AGREEMENT: 44,
  MISSING_SPEECH_RISK: 100,
  TIMING_BOUNDARY_RISK: 52,
  TIMING_SEVERE_RISK: 96,
  OVERLAP_RISK: 78,
  MULTI_SPEAKER_RISK: 88,
  LOCALIZATION_RISK: 72,
  SPAN_LINEAGE_BLOCKED: 76,
  EVIDENCE_CONFLICT: 75,
  GENERAL_UNCERTAINTY: 32,
};

function assertFiniteInterval(interval: C60112Interval, label: string): void {
  if (
    !Number.isFinite(interval.start) ||
    !Number.isFinite(interval.end) ||
    interval.start < 0 ||
    interval.end <= interval.start
  ) {
    throw new Error(`INVALID_SOURCE_GLOBAL_INTERVAL:${label}`);
  }
}

export function assertC60112Interval(
  interval: C60112Interval,
  label: string,
): void {
  assertFiniteInterval(interval, label);
}

function goldFieldIsZeroOrFalse(value: unknown): boolean {
  return value === 0 || value === false || value === null;
}

/**
 * Runtime review builders are a hard machine-only boundary. Zero-valued audit
 * counters may cross that boundary, but labels, paths, text, and identities may
 * not. Evaluation code must run only after the review package freeze exists.
 */
export function assertC60112MachineOnlyInput(
  value: unknown,
  label = "review-builder-input",
): void {
  const seen = new Set<object>();
  const inspect = (current: unknown, path: string): void => {
    if (typeof current === "string") {
      if (/(?:^|[\s/\\:._-])gold(?:$|[\s/\\:._-])/iu.test(current)) {
        throw new Error(`GOLD_INPUT_FORBIDDEN:${path}`);
      }
      return;
    }
    if (current === null || typeof current !== "object") return;
    if (seen.has(current)) return;
    seen.add(current);
    if (Array.isArray(current)) {
      current.forEach((entry, index) => {
        inspect(entry, `${path}[${index}]`);
      });
      return;
    }
    for (const [key, entry] of Object.entries(
      current as Record<string, unknown>,
    )) {
      const entryPath = `${path}.${key}`;
      if (key.toLocaleLowerCase("en-US").includes("gold")) {
        if (!goldFieldIsZeroOrFalse(entry)) {
          throw new Error(`GOLD_INPUT_FORBIDDEN:${entryPath}`);
        }
        continue;
      }
      inspect(entry, entryPath);
    }
  };
  inspect(value, label);
}

export function assertC60112ReviewPolicy(policy: C60112ReviewPolicy): void {
  const runtimePolicy = policy as unknown as {
    policyVersion: string;
    productRoute: string;
    goldBarrierRules: {
      runtimeGoldInputAllowed: boolean;
      freezeBeforeGoldEvaluation: boolean;
      goldMayTuneSameVersion: boolean;
      goldMayCreateHumanDecisions: boolean;
    };
  };
  if (
    runtimePolicy.policyVersion !== C60112_REVIEW_POLICY_VERSION ||
    runtimePolicy.productRoute !== "HUMAN_ON_EXCEPTION" ||
    runtimePolicy.goldBarrierRules.runtimeGoldInputAllowed ||
    !runtimePolicy.goldBarrierRules.freezeBeforeGoldEvaluation ||
    runtimePolicy.goldBarrierRules.goldMayTuneSameVersion ||
    runtimePolicy.goldBarrierRules.goldMayCreateHumanDecisions
  ) {
    throw new Error("INVALID_C60112_GOLD_BARRIER_POLICY");
  }
  const { semanticHash, ...core } = policy;
  if (machineQualitySemanticHash(core) !== semanticHash) {
    throw new Error("C60112_REVIEW_POLICY_HASH_MISMATCH");
  }
}

export function buildC60112ReviewPolicy(input: {
  policyFrozenAt: string;
}): C60112ReviewPolicy {
  const core = {
    schemaVersion: "1.0.0" as const,
    policyVersion: C60112_REVIEW_POLICY_VERSION,
    artifactType: "c6-0-1-12-review-assistance-policy" as const,
    productRoute: "HUMAN_ON_EXCEPTION" as const,
    policyFrozenAt: input.policyFrozenAt,
    reviewItemTaxonomy: C60112_REVIEW_ITEM_TYPES,
    priorityWeights: PRIORITY_WEIGHTS,
    priorityTierThresholds: {
      critical: 90,
      high: 68,
      medium: 40,
    },
    priorityScoreMeaning:
      "EXPLAINABLE_RISK_RANK_NOT_ERROR_PROBABILITY" as const,
    requiredRules: {
      allCritical: true as const,
      highTypes: [
        "TEXT_HALLUCINATION_RISK",
        "MISSING_SPEECH_RISK",
        "TIMING_SEVERE_RISK",
        "MULTI_SPEAKER_RISK",
        "SPAN_LINEAGE_BLOCKED",
      ] as const,
      unresolvedDoesNotComplete: true as const,
      explicitWaiveAllowed: true as const,
    },
    regionMergePolicy: {
      sourceGlobalTimeRequired: true as const,
      maximumGapSeconds: 1.5,
      maximumCoreDurationSeconds: 30,
      preserveSceneBoundaries: true as const,
      preserveMultiSpeakerBoundaries: true as const,
    },
    audioContextPolicy: {
      preContextSeconds: 2,
      postContextSeconds: 2,
      localOnly: true as const,
      shareable: false as const,
    },
    candidateDisplayRules: {
      labels: ["CURRENT", "WHISPER", "WHISPER_ALT", "REAZON"] as const,
      normalizedDuplicateDisplayCollapse: true as const,
      preserveAllProvenance: true as const,
      calibratedConfidencePercentageAllowed: false as const,
      humanSelectionOnly: true as const,
    },
    goldBarrierRules: {
      runtimeGoldInputAllowed: false as const,
      freezeBeforeGoldEvaluation: true as const,
      goldMayTuneSameVersion: false as const,
      goldMayCreateHumanDecisions: false as const,
    },
  };
  return {
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  };
}
