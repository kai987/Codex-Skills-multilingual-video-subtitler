import {
  c60113RegionReviewPrioritySchema,
  type C60113EvidenceFamilyGraph,
  type C60113PriorityVector,
  type C60113RegionReviewPriority,
  type C60113ReviewItemV3,
  type C60113ReviewPolicy,
  type C60113ReviewRegionsV2,
} from "@mvl/shared";

import {
  c60113ArtifactHeader,
  uniqueC60113,
  withC60113SemanticHash,
} from "./c60113-policy.js";
import {
  c60113CorrelationGroups,
  c60113IndependentFamilies,
} from "./review-evidence-family-graph.js";

export const C60113_MANDATORY_ORDER: Readonly<
  Record<C60113PriorityVector["mandatorySafetyClass"], number>
> = {
  NONE: 0,
  STRONG_HALLUCINATION: 4,
  STRONG_MISSING: 4,
  STRONG_TIMING: 3,
  STRONG_OVERLAP: 3,
  STRUCTURAL_CORRUPTION: 5,
};

export function c60113RegionInitialUtility(input: {
  riskCoverageKeys: readonly string[];
  actionableCoverageKeys: readonly string[];
  mandatoryReasons: readonly string[];
  priorityVector: C60113PriorityVector;
  policy: C60113ReviewPolicy;
}): number {
  const weights = input.policy.marginalUtility;
  return (
    input.riskCoverageKeys.length *
      weights.riskWeight *
      input.priorityVector.positiveEvidenceStrength *
      input.priorityVector.errorTypeSeverity +
    input.mandatoryReasons.length * weights.mandatoryWeight +
    input.actionableCoverageKeys.length * weights.actionableWeight
  );
}

export function buildC60113RegionPriority(input: {
  items: readonly C60113ReviewItemV3[];
  regions: C60113ReviewRegionsV2;
  evidenceFamilies: C60113EvidenceFamilyGraph;
  policy: C60113ReviewPolicy;
}): C60113RegionReviewPriority {
  const itemMap = new Map(input.items.map((item) => [item.reviewItemId, item]));
  const entries = input.regions.regions
    .map((region) => {
      const items = region.reviewItemIds.map((id) => {
        const item = itemMap.get(id);
        if (item === undefined)
          throw new Error(`C60113_REGION_ITEM_MISSING:${id}`);
        return item;
      });
      const evidence = input.evidenceFamilies.evidence.filter(
        (entry) =>
          entry.itemIds.some((id) => region.reviewItemIds.includes(id)) &&
          entry.positiveRisk &&
          !entry.evidenceAbsence &&
          !entry.contradiction,
      );
      const groups = c60113CorrelationGroups(evidence);
      const independentEvidenceFamilies = c60113IndependentFamilies(evidence);
      const strongest = items.toSorted(
        (a, b) =>
          C60113_MANDATORY_ORDER[b.priorityVector.mandatorySafetyClass] -
            C60113_MANDATORY_ORDER[a.priorityVector.mandatorySafetyClass] ||
          a.reviewItemId.localeCompare(b.reviewItemId),
      )[0];
      if (strongest === undefined)
        throw new Error("C60113_EMPTY_PRIORITY_REGION");
      const evidenceMap = new Map(
        evidence.map((entry) => [entry.evidenceId, entry]),
      );
      const groupStrengths = groups.map((group) =>
        Math.max(
          ...group.evidenceIds.map((id) => evidenceMap.get(id)?.strength ?? 0),
        ),
      );
      const positiveEvidenceStrength =
        groupStrengths.length === 0
          ? 0
          : groupStrengths.reduce((sum, value) => sum + value, 0) /
            groupStrengths.length;
      const average = (
        field:
          | "errorTypeSeverity"
          | "crossModelConflictStrength"
          | "hallucinationStrength"
          | "missingStrength"
          | "timingStrength",
      ) =>
        items.reduce((sum, item) => sum + item.priorityVector[field], 0) /
        items.length;
      const localization = items
        .map((item) => item.priorityVector.localizationQuality)
        .filter((value): value is number => value !== null);
      const candidateActionableCount = items.filter(
        (item) => item.priorityVector.candidateActionability > 0,
      ).length;
      const priorityVector: C60113PriorityVector = {
        mandatorySafetyClass: strongest.priorityVector.mandatorySafetyClass,
        positiveEvidenceStrength,
        independentEvidenceFamilyCount: independentEvidenceFamilies.length,
        errorTypeSeverity: average("errorTypeSeverity"),
        crossModelConflictStrength: average("crossModelConflictStrength"),
        hallucinationStrength: average("hallucinationStrength"),
        missingStrength: average("missingStrength"),
        timingStrength: average("timingStrength"),
        candidateActionability: candidateActionableCount / items.length,
        localizationQuality:
          localization.length === 0
            ? null
            : localization.reduce((sum, value) => sum + value, 0) /
              localization.length,
        estimatedReviewCost:
          input.policy.marginalUtility.fixedReviewOverheadSeconds +
          region.contextEnd -
          region.contextStart,
        sourceTime: region.sourceInterval.start,
      };
      // Keys deduplicate the same event/family across neighboring regions. They
      // contain provenance identifiers only; no lexical content or Gold utility.
      const evidenceIds = new Set(evidence.map((entry) => entry.evidenceId));
      const riskCoverageKeys = input.evidenceFamilies.correlationGroups
        .filter((group) => group.evidenceIds.some((id) => evidenceIds.has(id)))
        .map((group) => group.groupId)
        .toSorted();
      const actionableCoverageKeys = uniqueC60113(
        items
          .filter((item) => item.priorityVector.candidateActionability > 0)
          .flatMap((item) =>
            item.finalCueIds.length > 0
              ? item.finalCueIds.map((cueId) => `cue:${cueId}`)
              : [`item:${item.reviewItemId}`],
          ),
      );
      const mandatoryReasons = uniqueC60113(
        items.flatMap((item) => item.mandatoryReasons),
      );
      const estimatedUniqueAudioSeconds =
        region.contextEnd - region.contextStart;
      const base = {
        regionId: region.regionId,
        itemIds: region.reviewItemIds,
        sourceInterval: region.sourceInterval,
        contextInterval: region.contextInterval,
        itemRiskSummary: {
          uniqueAffectedCueCount: region.finalCueIds.length,
          uniqueEventCount: region.eventIds.length,
          independentRiskGroupCount: groups.length,
          mandatoryItemCount: items.filter(
            (item) => item.requiredLevel === "REQUIRED",
          ).length,
          missingClassifications: [
            ...new Set(
              items
                .map((item) => item.missingClassification)
                .filter(
                  (value): value is NonNullable<typeof value> => value !== null,
                ),
            ),
          ].toSorted(),
        },
        independentEvidenceFamilies,
        mandatoryReasons,
        candidateActionableCount,
        estimatedUniqueAudioSeconds,
        priorityVector,
        riskCoverageKeys,
        actionableCoverageKeys,
        rankScore: 0,
        rankPosition: 1,
      };
      base.rankScore =
        c60113RegionInitialUtility({ ...base, policy: input.policy }) /
        (input.policy.marginalUtility.fixedReviewOverheadSeconds +
          Math.max(
            input.policy.marginalUtility.minimumAudioCostSeconds,
            estimatedUniqueAudioSeconds,
          ));
      return base;
    })
    .toSorted(
      (a, b) =>
        C60113_MANDATORY_ORDER[b.priorityVector.mandatorySafetyClass] -
          C60113_MANDATORY_ORDER[a.priorityVector.mandatorySafetyClass] ||
        b.rankScore - a.rankScore ||
        a.sourceInterval.start - b.sourceInterval.start ||
        a.regionId.localeCompare(b.regionId),
    );
  const regions = entries.map((entry, index) =>
    withC60113SemanticHash({ ...entry, rankPosition: index + 1 }),
  );
  return c60113RegionReviewPrioritySchema.parse(
    withC60113SemanticHash({
      ...c60113ArtifactHeader(input.policy),
      artifactType: "c6-0-1-13-machine-region-review-priority",
      ranker: "REGION_RISK_DENSITY_V3",
      scoreMeaning: "EXPLAINABLE_RANKING_SCORE_NOT_PROBABILITY",
      regionsHash: input.regions.semanticHash,
      regions,
    }),
  );
}
