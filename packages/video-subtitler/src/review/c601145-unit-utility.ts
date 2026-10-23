import {
  unitUtility145Schema,
  type AtomUtility144,
  type CoverageUnit145,
  type CoverageUnits145,
  type Policy145,
  type UnitUtility145,
  type UnitUtilityRow145,
} from "@mvl/shared";
import { assertHash141, hash141, hashed141 } from "./c601141-policy.js";
import {
  C601145_UNIT_TIERS,
  emptyUnitTierCounts145,
  header145,
} from "./c601145-policy.js";

const maximumVector145 = (vectors: readonly number[][]) => {
  const length = Math.max(0, ...vectors.map((row) => row.length));
  return Array.from({ length }, (_, index) =>
    Math.max(0, ...vectors.map((row) => row[index] ?? 0)),
  );
};

export function durationBucket145(seconds: number) {
  if (seconds < 0.2) return { name: "LT_020" as const, ordinal: 0 };
  if (seconds < 0.5) return { name: "FROM_020_TO_050" as const, ordinal: 1 };
  if (seconds < 1) return { name: "FROM_050_TO_100" as const, ordinal: 2 };
  if (seconds < 2) return { name: "FROM_100_TO_200" as const, ordinal: 3 };
  if (seconds < 4) return { name: "FROM_200_TO_400" as const, ordinal: 4 };
  return { name: "GTE_400_CAPPED" as const, ordinal: 5 };
}

function unitTier145(unit: CoverageUnit145) {
  if (!unit.verifiedTimebase || unit.strongContradiction)
    return "UNIT_TIER_0_INELIGIBLE_OR_CONTRADICTED" as const;
  const independent = unit.independentEvidenceFamilies.length;
  if (independent >= 2) return "UNIT_TIER_5_MULTI_FAMILY_VERIFIED" as const;
  if (
    independent === 1 &&
    unit.evidenceStrata.some((value) => value.endsWith("_EXCLUSIVE"))
  )
    return "UNIT_TIER_4_INDEPENDENT_EXCLUSIVE_VERIFIED" as const;
  if (independent === 1) return "UNIT_TIER_3_SINGLE_FAMILY_VERIFIED" as const;
  if (
    unit.evidenceStrata.some((value) =>
      ["MASKED_SUBTHRESHOLD", "MULTI_VIEW_SAME_DETECTOR"].includes(value),
    )
  )
    return "UNIT_TIER_2_MASKED_OR_SUBTHRESHOLD" as const;
  return "UNIT_TIER_1_AUDIT_ONLY" as const;
}

function posteriorClass145(unit: CoverageUnit145) {
  if (!unit.posteriorSummary.coveredUnionRatio)
    return "POSTERIOR_UNAVAILABLE" as const;
  if (unit.posteriorSummary.weightedMean >= 0.7)
    return "POSTERIOR_HIGH" as const;
  if (unit.posteriorSummary.weightedMean >= 0.35)
    return "POSTERIOR_MEDIUM" as const;
  return "POSTERIOR_LOW" as const;
}

export function buildUnitUtilityRow145(input: {
  unit: CoverageUnit145;
  atomUtilityRows: AtomUtility144["rows"];
}): UnitUtilityRow145 {
  const { unit } = input,
    atomIds = new Set(unit.evidenceAtomIds),
    atomRows = input.atomUtilityRows.filter((row) => atomIds.has(row.atomId)),
    tier = unitTier145(unit),
    tierOrdinal = Math.max(0, 5 - C601145_UNIT_TIERS.indexOf(tier)),
    posterior = posteriorClass145(unit),
    posteriorOrdinal = [
      "POSTERIOR_UNAVAILABLE",
      "POSTERIOR_LOW",
      "POSTERIOR_MEDIUM",
      "POSTERIOR_HIGH",
    ].indexOf(posterior),
    duration = durationBucket145(unit.coreUnionSeconds),
    detectorExclusiveNovelty =
      unit.independentEvidenceFamilies.length === 1 &&
      unit.evidenceStrata.some((value) => value.endsWith("_EXCLUSIVE")),
    textVector = maximumVector145(
      atomRows.map((row) => row.textCandidateUtilityVector),
    ),
    featurePayload = {
      verifiedSourceGlobal: unit.verifiedTimebase,
      independentDetectorFamilies: unit.independentEvidenceFamilies,
      evidenceStrata: unit.evidenceStrata,
      posteriorSupportClass: posterior,
      distinctPcmViewSupport: unit.distinctPcmViewIds,
      detectorExclusiveNovelty,
      sourceNativeCoreSamples: unit.coreUnionSamples,
      cappedDurationBucket: duration.name,
      contradictionStatus: unit.strongContradiction,
      existingTargetCoverage: unit.existingTargetCoverage,
      existingPlaybackCoverage: unit.existingPlaybackCoverage,
      localizedTextCandidateAvailability: unit.candidateIds.length > 0,
      textCandidateRelationVector: textVector,
      timelineBins: unit.timelineBins,
      sceneIds: unit.sceneIds,
    },
    speechVector = [
      tierOrdinal,
      Math.min(unit.independentEvidenceFamilies.length, 4),
      Math.min(unit.evidenceStrata.length, 8),
      posteriorOrdinal,
      Math.min(unit.distinctPcmViewIds.length, 8),
      detectorExclusiveNovelty ? 1 : 0,
      duration.ordinal,
      unit.existingTargetCoverage >= 0.95 ? 0 : 1,
      unit.existingPlaybackCoverage >= 0.95 ? 0 : 1,
    ],
    eligibility =
      unit.verifiedTimebase &&
      !unit.strongContradiction &&
      tier !== "UNIT_TIER_0_INELIGIBLE_OR_CONTRADICTED";
  return unitUtility145Schema.shape.rows.element.parse(
    hashed141({
      coverageUnitId: unit.coverageUnitId,
      sourceUnitHash: unit.semanticHash,
      speechTier: tier,
      independentDetectorFamilies: unit.independentEvidenceFamilies,
      evidenceStrata: unit.evidenceStrata,
      posteriorSupportClass: posterior,
      detectorExclusiveNovelty,
      cappedDurationBucket: duration.name,
      cappedDurationUtility: duration.ordinal,
      textCandidateAvailability: unit.candidateIds.length > 0,
      speechEvidenceUtilityVector: speechVector,
      textCandidateUtilityVector: textVector,
      reviewSafetyUtilityVector: [...speechVector, ...textVector],
      utilityEligibility: eligibility,
      utilityReasons: eligibility
        ? ["VERIFIED_SOURCE_GLOBAL_COVERAGE_UNIT"]
        : ["INELIGIBLE_OR_CONTRADICTED_UNIT"],
      featureHash: hash141(featurePayload),
    }),
  );
}

export function buildUnitUtility145(input: {
  policy: Policy145;
  units: CoverageUnits145;
  atomUtility: AtomUtility144;
}): UnitUtility145 {
  [input.policy, input.units, input.atomUtility].forEach(assertHash141);
  const rows = input.units.units.map((unit) =>
      buildUnitUtilityRow145({
        unit,
        atomUtilityRows: input.atomUtility.rows,
      }),
    ),
    tierCounts = emptyUnitTierCounts145();
  rows.forEach((row) => tierCounts[row.speechTier]++);
  return unitUtility145Schema.parse(
    hashed141({
      ...header145(input.policy, input.units.sourceIdentity),
      artifactType: "machine-speech-safety-coverage-unit-utility-v1",
      coverageUnitsHash: input.units.semanticHash,
      rows,
      rowCount: rows.length,
      eligibleUnitCount: rows.filter((row) => row.utilityEligibility).length,
      tierCounts,
      segmentationDependentUnitUtilityCount: 0,
      atomCountFeatureCount: 0,
      childCountFeatureCount: 0,
      bundleCountFeatureCount: 0,
      goldFeatureCount: 0,
      utilityGatePassed: true,
    }),
  );
}
