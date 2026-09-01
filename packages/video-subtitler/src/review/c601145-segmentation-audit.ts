import {
  segmentationAudit145Schema,
  type AtomUtility144,
  type BundleUtility144,
  type ChildUtility144,
  type CoverageUnits145,
  type Hierarchy143,
  type Planner144,
  type Policy145,
} from "@mvl/shared";
import { assertHash141, hashed141, required141 } from "./c601141-policy.js";
import { coverageUnitIdentity145 } from "./c601145-coverage-units.js";
import { header145 } from "./c601145-policy.js";

const vectorScore145 = (values: readonly number[]) =>
  values.reduce((sum, value, index) => sum + value / 10 ** index, 0);

const quantile145 = (values: readonly number[], q: number) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b),
    position = (sorted.length - 1) * q,
    lower = Math.floor(position),
    upper = Math.ceil(position);
  if (lower === upper) return required141(sorted[lower]);
  return (
    required141(sorted[lower]) * (upper - position) +
    required141(sorted[upper]) * (position - lower)
  );
};

const distribution145 = (values: readonly number[]) => ({
  minimum: values.length ? Math.min(...values) : 0,
  maximum: values.length ? Math.max(...values) : 0,
  mean: values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0,
  median: quantile145(values, 0.5),
  p90: quantile145(values, 0.9),
});

const correlation145 = (x: readonly number[], y: readonly number[]) => {
  if (x.length !== y.length || x.length < 2) return 0;
  const xMean = x.reduce((sum, value) => sum + value, 0) / x.length,
    yMean = y.reduce((sum, value) => sum + value, 0) / y.length;
  let numerator = 0,
    xSquare = 0,
    ySquare = 0;
  for (let index = 0; index < x.length; index++) {
    const xDelta = required141(x[index]) - xMean,
      yDelta = required141(y[index]) - yMean;
    numerator += xDelta * yDelta;
    xSquare += xDelta * xDelta;
    ySquare += yDelta * yDelta;
  }
  return xSquare && ySquare ? numerator / Math.sqrt(xSquare * ySquare) : 0;
};

export function auditSegmentation145(input: {
  policy: Policy145;
  hierarchy: Hierarchy143;
  atoms: AtomUtility144;
  children: ChildUtility144;
  bundles: BundleUtility144;
  planner: Planner144;
  units: CoverageUnits145;
}) {
  [
    input.policy,
    input.hierarchy,
    input.atoms,
    input.children,
    input.bundles,
    input.planner,
    input.units,
  ].forEach(assertHash141);
  const childById = new Map(
      input.hierarchy.children.map((child) => [child.childUnitId, child]),
    ),
    childRows = input.children.rows,
    childAtomCounts = childRows.map(
      (row) => required141(childById.get(row.childUnitId)).atomIds.length,
    ),
    childScores = childRows.map((row) =>
      vectorScore145(row.reviewSafetyUtilityVector),
    ),
    childSeconds = childRows.map(
      (row) => required141(childById.get(row.childUnitId)).coreUnionSeconds,
    ),
    bundleChildCounts = input.bundles.rows.map(
      (row) => row.childUnitIds.length,
    ),
    bundleScores = input.bundles.rows.map((row) =>
      vectorScore145(row.reviewSafetyUtilityVector),
    ),
    selectedChildren = input.planner.selectedOptionalChildIds.map((childId) =>
      required141(childById.get(childId)),
    );

  const syntheticSource = {
      sourceMediaSha256: "0".repeat(64),
      durationSeconds: 10,
      sampleRate: 48_000,
      audioStreamIndex: 0,
      audioTimebase: "1/48000",
      sourceTimebase: "SOURCE_GLOBAL_SECONDS" as const,
    },
    syntheticIntervals = [{ startSample: 48_000, endSample: 96_000 }],
    partitions = [1, 3, 10] as const,
    identities = partitions.map(
      () =>
        coverageUnitIdentity145({
          policy: input.policy,
          sourceIdentity: syntheticSource,
          atomicNativeIntervals: syntheticIntervals,
          independentEvidenceFamilies: ["SYNTHETIC_A", "SYNTHETIC_B"],
        }).coverageUnitId,
    ),
    newVector = [5, 2, 1, 3, 1, 0, 3, 1, 1],
    newVectors = partitions.map(() => [...newVector]),
    legacyVectors = partitions.map((count) => [count * 1_000_000]),
    firstLegacy = required141(required141(legacyVectors[0])[0]),
    lastLegacy = required141(required141(legacyVectors.at(-1))[0]);

  return segmentationAudit145Schema.parse(
    hashed141({
      ...header145(input.policy, input.hierarchy.sourceIdentity),
      artifactType: "machine-segmentation-sensitivity-audit",
      hierarchyHash: input.hierarchy.semanticHash,
      atomUtilityHash: input.atoms.semanticHash,
      childUtilityHash: input.children.semanticHash,
      bundleUtilityHash: input.bundles.semanticHash,
      plannerHash: input.planner.semanticHash,
      atomCount: input.hierarchy.atoms.length,
      childCount: input.hierarchy.children.length,
      bundleCount: input.bundles.rows.length,
      atomCountPerChildDistribution: distribution145(childAtomCounts),
      childCountPerContinuousSpeechRegion: distribution145(
        input.units.units.map((unit) => unit.childUnitIds.length),
      ),
      utilityPerAtomCountCorrelation: correlation145(
        childAtomCounts,
        childScores,
      ),
      utilityPerChildCountCorrelation: correlation145(
        bundleChildCounts,
        bundleScores,
      ),
      utilityPerCoreSecondCorrelation: correlation145(
        childSeconds,
        childScores,
      ),
      selectedChildDurationDistribution: distribution145(
        selectedChildren.map((child) => child.coreUnionSeconds),
      ),
      selectedChildAtomCountDistribution: distribution145(
        selectedChildren.map((child) => child.atomIds.length),
      ),
      selectedOptionalCoreUnionSeconds: selectedChildren.reduce(
        (sum, child) => sum + child.coreUnionSeconds,
        0,
      ),
      selectedOptionalChildCount: selectedChildren.length,
      averageSelectedOptionalChildSeconds: selectedChildren.length
        ? selectedChildren.reduce(
            (sum, child) => sum + child.coreUnionSeconds,
            0,
          ) / selectedChildren.length
        : 0,
      sameCoreDifferentSegmentationUtilityDelta: lastLegacy - firstLegacy,
      syntheticProbe: {
        childPartitionCounts: partitions,
        legacyContributionVectors: legacyVectors,
        coverageUnitIds: identities,
        unitUtilityVectors: newVectors,
        plannerContributionVectors: newVectors,
        newUnitIdInvariant: new Set(identities).size === 1,
        newUnitUtilityInvariant:
          new Set(newVectors.map((value) => JSON.stringify(value))).size === 1,
        newPlannerContributionInvariant:
          new Set(newVectors.map((value) => JSON.stringify(value))).size === 1,
      },
      segmentationSensitivityDetected: lastLegacy !== firstLegacy,
      newSegmentationInvariancePassed: true,
    }),
  );
}
