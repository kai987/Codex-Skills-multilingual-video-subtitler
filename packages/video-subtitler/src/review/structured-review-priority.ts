import {
  c60113ReviewItemsV3Schema,
  c60113ScoreDistributionSchema,
  type C60113EvidenceFamily,
  type C60113EvidenceFamilyGraph,
  type C60113EvidenceObservation,
  type C60113MissingClassification,
  type C60113MissingSpeechEvidence,
  type C60113PriorityVector,
  type C60113ReviewItemV3,
  type C60113ReviewItemsV3,
  type C60113ReviewPolicy,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "../machine-quality/evidence-correlation.js";
import {
  assertC60112MachineOnlyInput,
  buildC60112ReviewPolicy,
  type C60112ReviewItem,
} from "./c60112-policy.js";
import {
  assertC60113Policy,
  buildC60113ReviewPolicy,
  c60113ArtifactHeader,
  uniqueC60113,
  withC60113SemanticHash,
} from "./c60113-policy.js";
import {
  buildC60113MissingSpeechEvidence,
  prepareC60113MissingEvidence,
  type C60113FinalCueInterval,
} from "./missing-speech-evidence-v2.js";
import {
  buildC60113RegionPriority,
  C60113_MANDATORY_ORDER,
} from "./region-review-priority.js";
import { buildC60113BurdenPlans } from "./review-burden-planner.js";
import type { C60112ReviewCandidateBundle } from "./review-candidate-bundle.js";
import {
  adaptC60113ReviewEvidence,
  buildC60113EvidenceFamilyGraph,
  c60113CorrelationGroups,
  c60113IndependentFamilies,
  type C60113RawArtifacts,
} from "./review-evidence-family-graph.js";
import { buildC60113PlaybackTimeline } from "./review-playback-timeline.js";
import { scoreC60112ReviewRisk } from "./review-priority.js";
import type { C60112ReviewRegion } from "./review-region-clustering.js";
import { clusterC60113ReviewRegions } from "./review-region-clustering-v2.js";

export type C60113AblationStage =
  | "A1_MISSING_ONLY"
  | "A2_EVIDENCE_FAMILIES"
  | "A3_STRUCTURED_ITEMS"
  | "A4_REGIONS_V2"
  | "A5_RISK_DENSITY";

const MISSING_ORDER: Readonly<Record<C60113MissingClassification, number>> = {
  MISSING_DIALOGUE_CONTRADICTED: 0,
  MISSING_DIALOGUE_UNRESOLVED: 1,
  SPEECH_GAP_OBSERVED: 2,
  MISSING_DIALOGUE_POSSIBLE: 3,
  MISSING_DIALOGUE_STRONG: 4,
};

function maxStrength(
  evidence: readonly C60113EvidenceObservation[],
  families: readonly C60113EvidenceFamily[],
): number {
  return Math.max(
    0,
    ...evidence
      .filter(
        (entry) =>
          families.includes(entry.family) &&
          entry.positiveRisk &&
          !entry.evidenceAbsence &&
          !entry.contradiction,
      )
      .map((entry) => entry.strength),
  );
}

export function c60113StructuredRankKey(
  vector: C60113PriorityVector,
): number[] {
  return [
    C60113_MANDATORY_ORDER[vector.mandatorySafetyClass],
    vector.errorTypeSeverity,
    vector.positiveEvidenceStrength,
    vector.independentEvidenceFamilyCount,
    vector.crossModelConflictStrength,
    vector.hallucinationStrength,
    vector.missingStrength,
    vector.timingStrength,
    vector.candidateActionability,
    vector.localizationQuality ?? -1,
    -vector.estimatedReviewCost,
    -vector.sourceTime,
  ];
}

export function compareC60113StructuredRanks(
  left: readonly number[],
  right: readonly number[],
): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const delta = (right[index] ?? 0) - (left[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

export function c60113ScoreDistribution(items: readonly C60113ReviewItemV3[]) {
  const counts = new Map<number, number>();
  items.forEach((item) =>
    counts.set(
      item.displayPriorityScore,
      (counts.get(item.displayPriorityScore) ?? 0) + 1,
    ),
  );
  const maxScore = Math.max(0, ...counts.keys());
  const maxItems = items.filter(
    (item) => item.displayPriorityScore === maxScore,
  );
  return c60113ScoreDistributionSchema.parse({
    itemCount: items.length,
    maxScore,
    maxScoreItemCount: maxItems.length,
    largestTieGroupCount: Math.max(0, ...counts.values()),
    uniqueScoreCount: counts.size,
    // Exclude source time: it is only a deterministic tie-break, not learned risk.
    uniqueStructuredRankCount: new Set(
      items.map((item) => JSON.stringify(item.structuredRankKey.slice(0, -1))),
    ).size,
    scoreEntropy: [...counts.values()].reduce((sum, count) => {
      const ratio = count / items.length;
      return sum - ratio * Math.log2(ratio);
    }, 0),
    maxScoreShare: items.length === 0 ? 0 : maxItems.length / items.length,
    genuineMandatoryMaxTie:
      maxItems.length > 1 &&
      maxItems.every((item) => item.mandatoryReasons.length > 0),
    distribution: [...counts]
      .toSorted((a, b) => b[0] - a[0])
      .map(([score, count]) => ({ score, count })),
  });
}

function scoreItem(
  item: C60112ReviewItem,
  input: {
    evidenceFamilies: C60113EvidenceFamilyGraph;
    missingEvidence: C60113MissingSpeechEvidence;
    candidateBundles: readonly C60112ReviewCandidateBundle[];
    policy: C60113ReviewPolicy;
    ablationStage: C60113AblationStage;
  },
): Omit<C60113ReviewItemV3, "semanticHash"> {
  const evidence = input.evidenceFamilies.evidence.filter((entry) =>
    entry.itemIds.includes(item.reviewItemId),
  );
  const positive = evidence.filter(
    (entry) =>
      entry.positiveRisk && !entry.evidenceAbsence && !entry.contradiction,
  );
  const groups = c60113CorrelationGroups(positive);
  const groupStrengths = groups.map((group) =>
    Math.max(
      ...positive
        .filter((entry) => group.evidenceIds.includes(entry.evidenceId))
        .map((entry) => entry.strength),
    ),
  );
  const positiveEvidenceStrength =
    groupStrengths.length === 0
      ? 0
      : groupStrengths.reduce((sum, strength) => sum + strength, 0) /
        groupStrengths.length;
  const independentEvidenceFamilies = c60113IndependentFamilies(positive);
  const missing = input.missingEvidence.gaps.filter((gap) =>
    gap.itemIds.includes(item.reviewItemId),
  );
  const missingClassification =
    missing.toSorted(
      (a, b) =>
        MISSING_ORDER[b.classification] - MISSING_ORDER[a.classification],
    )[0]?.classification ?? null;
  const missingStrength =
    missingClassification === "MISSING_DIALOGUE_STRONG"
      ? 0.9
      : missingClassification === "MISSING_DIALOGUE_POSSIBLE"
        ? 0.45
        : missingClassification === "SPEECH_GAP_OBSERVED"
          ? 0.05
          : 0;
  const hallucinationStrength = maxStrength(evidence, ["HALLUCINATION"]);
  const timingStrength = maxStrength(evidence, ["TIMING_BOUNDARY"]);
  const crossModelConflictStrength = maxStrength(evidence, [
    "CROSS_MODEL_CONTENT",
  ]);
  const overlapStrength = maxStrength(evidence, [
    "OVERLAP",
    "SPEAKER_ACTIVITY",
  ]);
  const localizationEvidence = evidence.filter(
    (entry) => entry.family === "LOCALIZATION" && !entry.evidenceAbsence,
  );
  const localizationQuality =
    localizationEvidence.length === 0
      ? null
      : localizationEvidence.some((entry) => entry.positiveRisk)
        ? 1 -
          Math.max(
            ...localizationEvidence
              .filter((entry) => entry.positiveRisk)
              .map((entry) => entry.strength),
          )
        : Math.max(...localizationEvidence.map((entry) => entry.strength));
  const candidate = input.candidateBundles.find(
    (bundle) => bundle.reviewItemId === item.reviewItemId,
  );
  const alternatives =
    candidate?.displayCandidates.filter(
      (entry) =>
        entry.labels.some((label) => label !== "CURRENT") &&
        !entry.evidenceBadges.includes("HALLUCINATION_RISK"),
    ) ?? [];
  const actionable = alternatives.filter((entry) =>
    entry.provenance.some(
      (provenance) =>
        provenance.sourceInterval !== null &&
        provenance.evidenceBadges.includes("LOCALIZATION_SAFE"),
    ),
  );
  const candidateActionability =
    alternatives.length === 0 ? 0 : actionable.length / alternatives.length;
  const severity = Math.max(
    missingStrength,
    hallucinationStrength > 0 ? 0.95 : 0,
    timingStrength >= 0.8 ? 0.85 : timingStrength > 0 ? 0.55 : 0,
    overlapStrength > 0 ? 0.75 : 0,
    crossModelConflictStrength > 0 ? 0.7 : 0,
    maxStrength(evidence, ["WHISPER_STABILITY", "REAZON_STABILITY"]) > 0
      ? 0.65
      : 0,
    maxStrength(evidence, ["ACOUSTIC_ALIGNMENT", "DECODER", "LOCALIZATION"]) > 0
      ? 0.4
      : 0,
    0.1,
  );
  const threshold = input.policy.mandatoryRules.strongEvidenceThreshold;
  let mandatorySafetyClass: C60113PriorityVector["mandatorySafetyClass"] =
    "NONE";
  if (
    positive.some(
      (entry) =>
        entry.family === "STRUCTURAL_INTEGRITY" &&
        entry.strength >= threshold &&
        entry.detailCode === "STRUCTURAL_CORRUPTION_CONFIRMED",
    )
  )
    mandatorySafetyClass = "STRUCTURAL_CORRUPTION";
  else if (hallucinationStrength >= threshold)
    mandatorySafetyClass = "STRONG_HALLUCINATION";
  else if (missingClassification === "MISSING_DIALOGUE_STRONG")
    mandatorySafetyClass = "STRONG_MISSING";
  else if (
    timingStrength >= threshold &&
    c60113IndependentFamilies(
      positive.filter(
        (entry) =>
          ["TIMING_BOUNDARY", "ACOUSTIC_ALIGNMENT", "LOCALIZATION"].includes(
            entry.family,
          ) && entry.strength >= threshold,
      ),
    ).length >= input.policy.mandatoryRules.minimumTimingFamilies
  )
    mandatorySafetyClass = "STRONG_TIMING";
  else if (
    overlapStrength >= threshold &&
    positive.some(
      (entry) =>
        entry.family === "SPEAKER_ACTIVITY" && entry.strength >= threshold,
    )
  )
    mandatorySafetyClass = "STRONG_OVERLAP";
  const positiveIds = new Set(positive.map((entry) => entry.evidenceId));
  const evidenceCorrelationGroups = input.evidenceFamilies.correlationGroups
    .filter((group) => group.evidenceIds.some((id) => positiveIds.has(id)))
    .map((group) => group.groupId)
    .toSorted();
  const mandatoryReasons =
    mandatorySafetyClass === "NONE"
      ? []
      : [
          `${mandatorySafetyClass}:${machineQualitySemanticHash(
            mandatorySafetyClass === "STRONG_MISSING"
              ? missing
                  .filter(
                    (gap) => gap.classification === "MISSING_DIALOGUE_STRONG",
                  )
                  .map((gap) => gap.gapId)
                  .toSorted()
              : evidenceCorrelationGroups,
          ).slice(0, 20)}`,
        ];
  const priorityVector: C60113PriorityVector = {
    mandatorySafetyClass,
    positiveEvidenceStrength,
    independentEvidenceFamilyCount: independentEvidenceFamilies.length,
    errorTypeSeverity: severity,
    crossModelConflictStrength,
    hallucinationStrength,
    missingStrength,
    timingStrength,
    candidateActionability,
    localizationQuality,
    estimatedReviewCost:
      input.policy.marginalUtility.fixedReviewOverheadSeconds +
      item.coreInterval.end -
      item.coreInterval.start,
    sourceTime: item.coreInterval.start,
  };
  let displayPriorityScore =
    Math.round(
      100000 *
        (0.42 * severity +
          0.32 * positiveEvidenceStrength +
          0.12 * Math.min(independentEvidenceFamilies.length / 6, 1) +
          0.08 * candidateActionability +
          0.06 * (localizationQuality ?? 0)),
    ) / 1000;
  if (
    input.ablationStage === "A1_MISSING_ONLY" ||
    input.ablationStage === "A2_EVIDENCE_FAMILIES"
  ) {
    const oldPolicy = buildC60112ReviewPolicy({
      policyFrozenAt: "1970-01-01T00:00:00.000Z",
    });
    const itemTypes = item.itemTypes.filter(
      (type) => type !== "MISSING_SPEECH_RISK",
    );
    const oldScore = scoreC60112ReviewRisk({
      itemTypes,
      reviewReasons: item.reviewReasons,
      policy: oldPolicy,
    });
    displayPriorityScore =
      input.ablationStage === "A1_MISSING_ONLY"
        ? Math.max(oldScore.priorityScore, missingStrength * 100)
        : Math.max(
            oldScore.scoreComponents.taxonomyRisk,
            missingStrength * 100,
          );
  }
  const requiredLevel =
    mandatoryReasons.length > 0
      ? ("REQUIRED" as const)
      : positiveEvidenceStrength > 0 ||
          missingClassification === "MISSING_DIALOGUE_POSSIBLE"
        ? ("RECOMMENDED" as const)
        : ("INFORMATIONAL" as const);
  const priorityTier =
    mandatoryReasons.length > 0
      ? ("CRITICAL" as const)
      : severity >= 0.65 && positiveEvidenceStrength >= 0.4
        ? ("HIGH" as const)
        : positiveEvidenceStrength > 0 ||
            missingClassification === "MISSING_DIALOGUE_POSSIBLE"
          ? ("MEDIUM" as const)
          : ("LOW" as const);
  const { semanticHash: legacySemanticHash, ...legacy } = item;
  return {
    ...legacy,
    priorityScore: displayPriorityScore,
    displayPriorityScore,
    priorityVector,
    structuredRankKey: c60113StructuredRankKey(priorityVector),
    rankPosition: 1,
    priorityTier,
    requiredLevel,
    mandatoryReasons,
    missingClassification,
    missingGapIds: missing.map((gap) => gap.gapId).toSorted(),
    independentEvidenceFamilies,
    evidenceCorrelationGroups,
    uncertaintyReasons: uniqueC60113(
      evidence
        .filter((entry) => entry.evidenceAbsence || entry.strength === 0)
        .map((entry) => entry.detailCode),
    ),
    legacySemanticHash,
  };
}

export function buildC60113ReviewItems(input: {
  items: readonly C60112ReviewItem[];
  evidenceFamilies: C60113EvidenceFamilyGraph;
  missingEvidence: C60113MissingSpeechEvidence;
  candidateBundles: readonly C60112ReviewCandidateBundle[];
  policy: C60113ReviewPolicy;
  ablationStage?: C60113AblationStage;
}): C60113ReviewItemsV3 {
  assertC60112MachineOnlyInput({
    items: input.items,
    candidates: input.candidateBundles,
  });
  const stage = input.ablationStage ?? "A5_RISK_DENSITY";
  const simpleScore =
    stage === "A1_MISSING_ONLY" || stage === "A2_EVIDENCE_FAMILIES";
  const ordered = input.items
    .map((item) => scoreItem(item, { ...input, ablationStage: stage }))
    .toSorted(
      (a, b) =>
        (simpleScore
          ? b.displayPriorityScore - a.displayPriorityScore
          : compareC60113StructuredRanks(
              a.structuredRankKey,
              b.structuredRankKey,
            )) ||
        a.coreInterval.start - b.coreInterval.start ||
        a.reviewItemId.localeCompare(b.reviewItemId),
    );
  const items = ordered.map((item, index) =>
    withC60113SemanticHash({ ...item, rankPosition: index + 1 }),
  );
  return c60113ReviewItemsV3Schema.parse(
    withC60113SemanticHash({
      ...c60113ArtifactHeader(input.policy),
      artifactType: "c6-0-1-13-machine-review-items-v3",
      evidenceFamiliesHash: input.evidenceFamilies.semanticHash,
      missingEvidenceHash: input.missingEvidence.semanticHash,
      items,
      summary: {
        itemCount: items.length,
        requiredItemCount: items.filter(
          (item) => item.requiredLevel === "REQUIRED",
        ).length,
        recommendedItemCount: items.filter(
          (item) => item.requiredLevel === "RECOMMENDED",
        ).length,
        informationalItemCount: items.filter(
          (item) => item.requiredLevel === "INFORMATIONAL",
        ).length,
        criticalItemCount: items.filter(
          (item) => item.priorityTier === "CRITICAL",
        ).length,
        scoreDistribution: c60113ScoreDistribution(items),
      },
    }),
  );
}

export function buildC60113MachineReview(input: {
  items: readonly C60112ReviewItem[];
  regions?: readonly C60112ReviewRegion[];
  candidateBundles: readonly C60112ReviewCandidateBundle[];
  sourceDurationSeconds: number;
  expectedSourceMediaSha256?: string;
  finalCues: readonly C60113FinalCueInterval[];
  rawArtifacts?: C60113RawArtifacts;
  observations?: readonly C60113EvidenceObservation[];
  policy?: C60113ReviewPolicy;
  ablationStage?: C60113AblationStage;
}) {
  const policy = input.policy ?? buildC60113ReviewPolicy();
  assertC60113Policy(policy);
  const ablationStage = input.ablationStage ?? "A5_RISK_DENSITY";
  const rawArtifacts = input.rawArtifacts ?? {};
  const missing = prepareC60113MissingEvidence({
    ...input,
    policy,
    rawArtifacts,
  });
  const observations = [
    ...adaptC60113ReviewEvidence({ items: input.items, rawArtifacts }),
    ...missing.observations,
    ...(input.observations ?? []),
  ];
  const evidenceFamilies = buildC60113EvidenceFamilyGraph({
    observations,
    policy,
  });
  const missingEvidence = buildC60113MissingSpeechEvidence({
    gaps: missing.gaps,
    evidenceFamilies,
    policy,
    legacyMissingItemCount: input.items.filter((item) =>
      item.itemTypes.includes("MISSING_SPEECH_RISK"),
    ).length,
  });
  const itemsV3 = buildC60113ReviewItems({
    ...input,
    policy,
    evidenceFamilies,
    missingEvidence,
    ablationStage,
  });
  const legacyPartition =
    ablationStage === "A1_MISSING_ONLY" ||
    ablationStage === "A2_EVIDENCE_FAMILIES" ||
    ablationStage === "A3_STRUCTURED_ITEMS";
  if (legacyPartition && input.regions === undefined)
    throw new Error("C60113_ABLATION_REQUIRES_LEGACY_REGIONS");
  const regionsV2 = clusterC60113ReviewRegions({
    items: itemsV3.items,
    itemsHash: itemsV3.semanticHash,
    policy,
    sourceDurationSeconds: input.sourceDurationSeconds,
    ...(legacyPartition ? { legacyRegions: input.regions } : {}),
  });
  const regionPriority = buildC60113RegionPriority({
    items: itemsV3.items,
    regions: regionsV2,
    evidenceFamilies,
    policy,
  });
  const playbackTimeline = buildC60113PlaybackTimeline({
    regions: regionsV2,
    policy,
  });
  const staticOrder =
    ablationStage === "A5_RISK_DENSITY"
      ? undefined
      : [...regionPriority.regions]
          .toSorted(
            (a, b) =>
              Math.min(
                ...a.itemIds.map(
                  (id) =>
                    itemsV3.items.find((item) => item.reviewItemId === id)
                      ?.rankPosition ?? Infinity,
                ),
              ) -
                Math.min(
                  ...b.itemIds.map(
                    (id) =>
                      itemsV3.items.find((item) => item.reviewItemId === id)
                        ?.rankPosition ?? Infinity,
                  ),
                ) || a.sourceInterval.start - b.sourceInterval.start,
          )
          .map((region) => region.regionId);
  const burdenPlans = buildC60113BurdenPlans({
    regionPriority,
    sourceDurationSeconds: input.sourceDurationSeconds,
    policy,
    ...(staticOrder === undefined ? {} : { staticOrder }),
  });
  return {
    ablationStage,
    policy,
    missingEvidence,
    evidenceFamilies,
    itemsV3,
    regionsV2,
    regionPriority,
    playbackTimeline,
    burdenPlans,
  };
}

export type C60113MachineReview = ReturnType<typeof buildC60113MachineReview>;
