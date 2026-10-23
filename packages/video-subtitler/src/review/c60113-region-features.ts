import {
  c60113FeatureNames,
  c60113RegionFeaturesSchema,
  type C60113FeatureName,
  type C60113FeatureValue,
  type C60113RegionFeatures,
  type C60113EvidenceFamilyGraph,
  type C60113ReviewItemsV3,
  type C60113ReviewRegionsV2,
  type C60113RegionReviewPriority,
  type C60113RegionPriorityEntry,
} from "@mvl/shared";
import { machineQualitySemanticHash } from "../machine-quality/evidence-correlation.js";

export const C60113_CALIBRATION_POLICY =
  "c6.0.1.13-region-burden-calibration-v1" as const;
export interface C60113Interval {
  start: number;
  end: number;
}

/** Text and label fields are deliberately absent. IDs are joins, never predictors. */
export interface C60113RegionFeatureInput {
  regionId: string;
  itemIds: string[];
  sourceInterval: C60113Interval;
  contextInterval: C60113Interval;
  sceneIds?: string[];
  speakerGroupIds?: string[];
  mandatory: boolean;
  legacyItemPriority: number;
  legacyRegionPriority: number;
  missingCalibratedPriority: number;
  deterministicRiskUtility: number;
  crossModelDisagreement: boolean;
  selectorEvidence?: C60113RegionPriorityEntry;
  values: Partial<Record<C60113FeatureName, C60113FeatureValue | number>>;
}

export function c60113Hash(value: unknown): string {
  return machineQualitySemanticHash(value);
}
export function c60113HashPayload(value: object): string {
  return c60113Hash(
    Object.fromEntries(
      Object.entries(value).filter(
        ([key]) => key !== "generatedAt" && key !== "semanticHash",
      ),
    ),
  );
}
export function c60113Require<T>(value: T | undefined): T {
  if (value === undefined)
    throw new Error("MISSING_CALIBRATION_STRUCTURAL_ENTRY");
  return value;
}
export function c60113IntervalUnion(
  intervals: readonly C60113Interval[],
): C60113Interval[] {
  const union: C60113Interval[] = [];
  for (const interval of [...intervals].sort(
    (a, b) => a.start - b.start || a.end - b.end,
  )) {
    if (
      !Number.isFinite(interval.start) ||
      !Number.isFinite(interval.end) ||
      interval.start < 0 ||
      interval.end <= interval.start
    )
      throw new Error("INVALID_SOURCE_GLOBAL_AUDIO_INTERVAL");
    const previous = union.at(-1);
    if (previous && interval.start <= previous.end)
      previous.end = Math.max(previous.end, interval.end);
    else union.push({ ...interval });
  }
  return union;
}
export function c60113UniqueSeconds(
  intervals: readonly C60113Interval[],
): number {
  return c60113IntervalUnion(intervals).reduce(
    (sum, interval) => sum + interval.end - interval.start,
    0,
  );
}
export function c60113IncrementalSeconds(
  interval: C60113Interval,
  selected: readonly C60113Interval[],
): number {
  return Math.max(
    0,
    c60113UniqueSeconds([...selected, interval]) -
      c60113UniqueSeconds(selected),
  );
}
export function c60113IntersectionSeconds(
  a: C60113Interval,
  b: C60113Interval,
): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}
export function c60113FeatureNumber(
  row: C60113RegionFeatures["regions"][number],
  name: C60113FeatureName,
): number | null {
  const cell = row.values[name];
  return cell.status === "OBSERVED" ? cell.value : null;
}

export function buildC60113RegionFeatures(input: {
  regions: readonly C60113RegionFeatureInput[];
  generatedAt: string;
  policyHash: string;
}): C60113RegionFeatures {
  const ids = input.regions.map((region) => region.regionId);
  if (new Set(ids).size !== ids.length)
    throw new Error("DUPLICATE_REGION_FEATURE_ID");
  const sorted = [...input.regions].sort(
    (a, b) =>
      a.sourceInterval.start - b.sourceInterval.start ||
      a.regionId.localeCompare(b.regionId),
  );
  const selectedIntervals: C60113Interval[] = [];
  const regions = sorted.map((region) => {
    const unknown = Object.keys(region.values).filter(
      (name) => !c60113FeatureNames.includes(name as C60113FeatureName),
    );
    if (unknown.length) throw new Error("FORBIDDEN_OR_UNKNOWN_RANKER_FEATURE");
    c60113IntervalUnion([region.sourceInterval, region.contextInterval]);
    if (
      region.contextInterval.start > region.sourceInterval.start ||
      region.contextInterval.end < region.sourceInterval.end
    )
      throw new Error("FEATURE_CONTEXT_DOES_NOT_COVER_REGION");
    const derived: Partial<Record<C60113FeatureName, number>> = {
      coreDurationSeconds:
        region.sourceInterval.end - region.sourceInterval.start,
      contextDurationSeconds:
        region.contextInterval.end - region.contextInterval.start,
      chronologicalIncrementalAudioSeconds: c60113IncrementalSeconds(
        region.contextInterval,
        selectedIntervals,
      ),
      neighborContextOverlapSeconds: c60113UniqueSeconds(
        sorted
          .filter((other) => other.regionId !== region.regionId)
          .map((other) => ({
            start: Math.max(
              other.contextInterval.start,
              region.contextInterval.start,
            ),
            end: Math.min(
              other.contextInterval.end,
              region.contextInterval.end,
            ),
          }))
          .filter((interval) => interval.end > interval.start),
      ),
      sceneCount: new Set(region.sceneIds ?? []).size,
      speakerGroupCount: new Set(region.speakerGroupIds ?? []).size,
    };
    const values = Object.fromEntries(
      c60113FeatureNames.map((name) => {
        const raw = derived[name] ?? region.values[name];
        const value: C60113FeatureValue =
          typeof raw === "number"
            ? { status: "OBSERVED", value: raw }
            : (raw ?? { status: "UNKNOWN", value: null });
        return [name, value];
      }),
    ) as Record<C60113FeatureName, C60113FeatureValue>;
    selectedIntervals.push(region.contextInterval);
    const row = {
      regionId: region.regionId,
      itemIds: [...new Set(region.itemIds)].sort(),
      sourceInterval: region.sourceInterval,
      contextInterval: region.contextInterval,
      sceneIds: [...new Set(region.sceneIds ?? [])].sort(),
      speakerGroupIds: [...new Set(region.speakerGroupIds ?? [])].sort(),
      mandatory: region.mandatory,
      legacyItemPriority: region.legacyItemPriority,
      legacyRegionPriority: region.legacyRegionPriority,
      missingCalibratedPriority: region.missingCalibratedPriority,
      deterministicRiskUtility: region.deterministicRiskUtility,
      crossModelDisagreement: region.crossModelDisagreement,
      selectorEvidence: region.selectorEvidence ?? null,
      values,
    };
    return { ...row, semanticHash: c60113Hash(row) };
  });
  const payload = {
    schemaVersion: "1.0.0" as const,
    policyVersion: C60113_CALIBRATION_POLICY,
    artifactType: "machine-review-region-features" as const,
    featureSchemaVersion: "c60113-structural-features-v1" as const,
    featureNames: [...c60113FeatureNames],
    policyHash: input.policyHash,
    goldInputCount: 0 as const,
    rawTextFeatureCount: 0 as const,
    identityPredictorCount: 0 as const,
    absoluteTimePredictorCount: 0 as const,
    regions,
  };
  return c60113RegionFeaturesSchema.parse({
    ...payload,
    generatedAt: input.generatedAt,
    semanticHash: c60113Hash(payload),
  });
}

export function assertC60113FeatureHash(features: C60113RegionFeatures): void {
  c60113RegionFeaturesSchema.parse(features);
  if (
    c60113HashPayload(features) !== features.semanticHash ||
    features.regions.some((row) => c60113HashPayload(row) !== row.semanticHash)
  )
    throw new Error("STALE_MACHINE_REGION_FEATURES_HASH");
  if (
    JSON.stringify(features.featureNames) !== JSON.stringify(c60113FeatureNames)
  )
    throw new Error("FEATURE_ORDER_CHANGED");
}

/** Project existing artifacts into a closed numeric feature table without serializing dialogue. */
export function buildC60113RegionFeaturesFromArtifacts(input: {
  regionsV2: C60113ReviewRegionsV2;
  itemsV3: C60113ReviewItemsV3;
  regionPriority: C60113RegionReviewPriority;
  evidenceFamilies: C60113EvidenceFamilyGraph;
  legacyItemPriorities: ReadonlyMap<string, number>;
  legacyRegionPrioritiesByItem: ReadonlyMap<string, number>;
  missingCalibratedItemPriorities: ReadonlyMap<string, number>;
  generatedAt: string;
}): C60113RegionFeatures {
  const regions = input.regionsV2.regions.map(
    (region): C60113RegionFeatureInput => {
      const priority = input.regionPriority.regions.find(
        (row) => row.regionId === region.regionId,
      );
      if (!priority) throw new Error("REGION_PRIORITY_FEATURE_LINEAGE_MISSING");
      const items = input.itemsV3.items.filter((item) =>
        region.reviewItemIds.includes(item.reviewItemId),
      );
      const evidence = input.evidenceFamilies.evidence.filter((entry) =>
        entry.itemIds.some((id) => region.reviewItemIds.includes(id)),
      );
      const observedStrength = (
        family: C60113EvidenceFamilyGraph["evidence"][number]["family"],
      ): C60113FeatureValue => {
        const observations = evidence.filter(
          (entry) => entry.family === family && !entry.evidenceAbsence,
        );
        return observations.length
          ? {
              status: "OBSERVED",
              value: Math.max(
                ...observations.map((entry) =>
                  entry.positiveRisk ? entry.strength : 0,
                ),
              ),
            }
          : { status: "UNAVAILABLE", value: null };
      };
      const vector = priority.priorityVector;
      const previous = items
        .map((item) => input.legacyItemPriorities.get(item.reviewItemId))
        .filter((value): value is number => value !== undefined);
      const previousRegion = items
        .map((item) =>
          input.legacyRegionPrioritiesByItem.get(item.reviewItemId),
        )
        .filter((value): value is number => value !== undefined);
      const missingOnly = items
        .map((item) =>
          input.missingCalibratedItemPriorities.get(item.reviewItemId),
        )
        .filter((value): value is number => value !== undefined);
      return {
        regionId: region.regionId,
        itemIds: region.reviewItemIds,
        sourceInterval: region.sourceInterval,
        contextInterval: region.contextInterval,
        sceneIds: region.sceneIds,
        speakerGroupIds: region.speakerGroupIds,
        mandatory: region.requiredLevel === "REQUIRED",
        legacyItemPriority: previous.length ? Math.max(...previous) : 0,
        legacyRegionPriority: previousRegion.length
          ? Math.max(...previousRegion)
          : 0,
        missingCalibratedPriority: Math.max(...missingOnly, 0),
        deterministicRiskUtility:
          priority.rankScore *
          (C60113_FEATURE_COST_OVERHEAD + priority.estimatedUniqueAudioSeconds),
        crossModelDisagreement: items.some((item) =>
          item.itemTypes.includes("TEXT_CROSS_MODEL_DISAGREEMENT"),
        ),
        selectorEvidence: priority,
        values: {
          missingSeverity: vector.missingStrength,
          hallucinationStrength: vector.hallucinationStrength,
          timingStrength: vector.timingStrength,
          crossModelConflictStrength: vector.crossModelConflictStrength,
          whisperInstability: observedStrength("WHISPER_STABILITY"),
          reazonInstability: observedStrength("REAZON_STABILITY"),
          acousticMargin: { status: "UNAVAILABLE", value: null },
          acousticScorability: evidence.some(
            (entry) =>
              entry.family === "ACOUSTIC_ALIGNMENT" && !entry.evidenceAbsence,
          )
            ? 1
            : { status: "UNAVAILABLE", value: null },
          speechCompleteness: evidence.some(
            (entry) =>
              entry.detailCode === "SPEECH_INCOMPLETE" &&
              !entry.evidenceAbsence,
          )
            ? 0
            : { status: "UNKNOWN", value: null },
          requestEdgeRisk: evidence.some(
            (entry) =>
              entry.detailCode === "REQUEST_EDGE_RISK" &&
              !entry.evidenceAbsence,
          )
            ? 1
            : { status: "UNKNOWN", value: null },
          localizationQuality: vector.localizationQuality ?? {
            status: "UNAVAILABLE",
            value: null,
          },
          independentFamilyCount: vector.independentEvidenceFamilyCount,
          correlatedEvidenceCount: Math.max(
            0,
            evidence.length -
              new Set(evidence.map((entry) => entry.correlationGroup)).size,
          ),
          affectedCueCount: priority.itemRiskSummary.uniqueAffectedCueCount,
          affectedEventCount: priority.itemRiskSummary.uniqueEventCount,
          candidateActionableCount: priority.candidateActionableCount,
          orphanCount: items.filter((item) => item.finalCueIds.length === 0)
            .length,
          positiveEvidenceStrength: vector.positiveEvidenceStrength,
        },
      };
    },
  );
  return buildC60113RegionFeatures({
    regions,
    generatedAt: input.generatedAt,
    policyHash: input.regionsV2.policyHash,
  });
}

const C60113_FEATURE_COST_OVERHEAD = 8;
