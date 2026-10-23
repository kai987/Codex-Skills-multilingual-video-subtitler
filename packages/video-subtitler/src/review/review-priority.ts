import { machineQualitySemanticHash } from "../machine-quality/evidence-correlation.js";
import {
  assertC60112MachineOnlyInput,
  assertC60112ReviewPolicy,
  type C60112PriorityTier,
  type C60112RequiredLevel,
  type C60112ReviewItem,
  type C60112ReviewItemType,
  type C60112ReviewPolicy,
  type C60112ReviewReasonCode,
} from "./c60112-policy.js";

export interface C60112PriorityComponents {
  taxonomyRisk: number;
  multiLabelBoost: number;
  compoundRiskBoost: number;
  evidenceBreadthBoost: number;
}

export interface C60112PriorityResult {
  priorityTier: C60112PriorityTier;
  priorityScore: number;
  requiredLevel: C60112RequiredLevel;
  scoreComponents: C60112PriorityComponents;
  explanationCodes: string[];
}

export interface C60112ReviewPriorityEntry extends C60112PriorityResult {
  reviewItemId: string;
  sourceStart: number;
  itemTypes: C60112ReviewItemType[];
  reviewReasons: C60112ReviewReasonCode[];
  semanticHash: string;
}

export interface C60112ReviewPriorityArtifact {
  schemaVersion: "1.0.0";
  policyVersion: C60112ReviewPolicy["policyVersion"];
  artifactType: "c6-0-1-12-machine-review-priority";
  policyHash: string;
  entries: C60112ReviewPriorityEntry[];
  semanticHash: string;
}

function bounded(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function roundScore(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function hasAll(
  types: ReadonlySet<C60112ReviewItemType>,
  expected: readonly C60112ReviewItemType[],
): boolean {
  return expected.every((type) => types.has(type));
}

function compoundRiskBoost(types: ReadonlySet<C60112ReviewItemType>): {
  score: number;
  explanationCodes: string[];
} {
  let score = 0;
  const explanationCodes: string[] = [];
  if (
    hasAll(types, [
      "TEXT_CROSS_MODEL_DISAGREEMENT",
      "TEXT_WHISPER_INSTABILITY",
      "TEXT_REAZON_INSTABILITY",
    ])
  ) {
    score += 18;
    explanationCodes.push("LEXICAL_CONFLICT_BOTH_ASR_UNSTABLE");
  }
  if (hasAll(types, ["OVERLAP_RISK", "MULTI_SPEAKER_RISK"])) {
    score += 10;
    explanationCodes.push("UNRESOLVED_MULTI_SPEAKER_OVERLAP");
  }
  if (hasAll(types, ["EVIDENCE_CONFLICT", "LOCALIZATION_RISK"])) {
    score += 5;
    explanationCodes.push("CONFLICT_WITH_LOCALIZATION_AMBIGUITY");
  }
  if (hasAll(types, ["MISSING_SPEECH_RISK", "SPAN_LINEAGE_BLOCKED"])) {
    score += 4;
    explanationCodes.push("MISSING_SPEECH_WITHOUT_SAFE_SPAN");
  }
  return { score: bounded(score, 0, 20), explanationCodes };
}

function tierForScore(
  score: number,
  policy: C60112ReviewPolicy,
): C60112PriorityTier {
  if (score >= policy.priorityTierThresholds.critical) return "CRITICAL";
  if (score >= policy.priorityTierThresholds.high) return "HIGH";
  if (score >= policy.priorityTierThresholds.medium) return "MEDIUM";
  return "LOW";
}

function requiredLevelFor(
  tier: C60112PriorityTier,
  types: ReadonlySet<C60112ReviewItemType>,
  policy: C60112ReviewPolicy,
): C60112RequiredLevel {
  if (tier === "CRITICAL") return "REQUIRED";
  if (
    tier === "HIGH" &&
    policy.requiredRules.highTypes.some((type) => types.has(type))
  ) {
    return "REQUIRED";
  }
  if (tier === "LOW") return "INFORMATIONAL";
  return "RECOMMENDED";
}

export function scoreC60112ReviewRisk(input: {
  itemTypes: readonly C60112ReviewItemType[];
  reviewReasons: readonly C60112ReviewReasonCode[];
  policy: C60112ReviewPolicy;
}): C60112PriorityResult {
  assertC60112ReviewPolicy(input.policy);
  const types = new Set(input.itemTypes);
  const uniqueReasons = new Set(input.reviewReasons);
  const taxonomyRisk = Math.max(
    ...[...types].map((type) => input.policy.priorityWeights[type]),
    0,
  );
  const multiLabelBoost = bounded((types.size - 1) * 2, 0, 8);
  const compound = compoundRiskBoost(types);
  const evidenceBreadthBoost = bounded(uniqueReasons.size - 1, 0, 4);
  const scoreComponents: C60112PriorityComponents = {
    taxonomyRisk,
    multiLabelBoost,
    compoundRiskBoost: compound.score,
    evidenceBreadthBoost,
  };
  const priorityScore = roundScore(
    bounded(
      taxonomyRisk + multiLabelBoost + compound.score + evidenceBreadthBoost,
      0,
      100,
    ),
  );
  const priorityTier = tierForScore(priorityScore, input.policy);
  return {
    priorityTier,
    priorityScore,
    requiredLevel: requiredLevelFor(priorityTier, types, input.policy),
    scoreComponents,
    explanationCodes: [
      `TAXONOMY_MAX_${taxonomyRisk}`,
      ...(multiLabelBoost > 0 ? ["MULTI_LABEL_RISK"] : []),
      ...compound.explanationCodes,
      ...(evidenceBreadthBoost > 0 ? ["MULTIPLE_REASON_CODES"] : []),
    ],
  };
}

export function buildC60112ReviewPriority(input: {
  items: readonly C60112ReviewItem[];
  policy: C60112ReviewPolicy;
}): C60112ReviewPriorityArtifact {
  assertC60112ReviewPolicy(input.policy);
  assertC60112MachineOnlyInput(input.items, "build-review-priority.items");
  const entries = input.items
    .map((item): C60112ReviewPriorityEntry => {
      const result = scoreC60112ReviewRisk({
        itemTypes: item.itemTypes,
        reviewReasons: item.reviewReasons,
        policy: input.policy,
      });
      const core = {
        reviewItemId: item.reviewItemId,
        sourceStart: item.sourceInterval.start,
        itemTypes: [...item.itemTypes].toSorted(),
        reviewReasons: [...item.reviewReasons].toSorted(),
        ...result,
      };
      return { ...core, semanticHash: machineQualitySemanticHash(core) };
    })
    .toSorted(
      (left, right) =>
        right.priorityScore - left.priorityScore ||
        left.sourceStart - right.sourceStart ||
        left.reviewItemId.localeCompare(right.reviewItemId),
    );
  const core = {
    schemaVersion: "1.0.0" as const,
    policyVersion: input.policy.policyVersion,
    artifactType: "c6-0-1-12-machine-review-priority" as const,
    policyHash: input.policy.semanticHash,
    entries,
  };
  return { ...core, semanticHash: machineQualitySemanticHash(core) };
}

export function applyC60112ReviewPriority(input: {
  items: readonly C60112ReviewItem[];
  policy: C60112ReviewPolicy;
}): C60112ReviewItem[] {
  assertC60112ReviewPolicy(input.policy);
  assertC60112MachineOnlyInput(input.items, "apply-review-priority.items");
  return input.items.map((item) => {
    const { semanticHash, ...itemWithoutHash } = item;
    if (!/^[0-9a-f]{64}$/u.test(semanticHash)) {
      throw new Error(`INVALID_REVIEW_ITEM_HASH:${item.reviewItemId}`);
    }
    const priority = scoreC60112ReviewRisk({
      itemTypes: item.itemTypes,
      reviewReasons: item.reviewReasons,
      policy: input.policy,
    });
    const core = {
      ...itemWithoutHash,
      priorityTier: priority.priorityTier,
      priorityScore: priority.priorityScore,
      requiredLevel: priority.requiredLevel,
    };
    return {
      ...core,
      semanticHash: machineQualitySemanticHash(core),
    };
  });
}
