import {
  degenerateAudit1452Schema,
  degenerateEligibility1452Schema,
  type DegenerateAudit1452,
  type DegenerateEligibility1452,
  type FullRegistry1451,
  type Policy1452,
  type ReviewAudio1451,
  type ReviewBinding1451,
  type ReviewTargets1451,
  type Samples142,
} from "@mvl/shared";
import { hashed141, required141, union141 } from "./c601141-policy.js";
import { intersection143, sampleCount143 } from "./c601143-policy.js";
import { header1452 } from "./c6011452-policy.js";

const SPEECH_TARGET_TYPES = new Set([
  "ORPHAN_SPEECH_TARGET",
  "MISSING_SPEECH_ISLAND_TARGET",
]);

const duration = (rows: readonly Samples142[]) =>
  sampleCount143(union141(rows));

export function auditDegenerateOrphans1452(input: {
  policy: Policy1452;
  registry: FullRegistry1451;
  binding: ReviewBinding1451;
  targets: ReviewTargets1451;
  audio: ReviewAudio1451;
}): DegenerateAudit1452 {
  const rate = input.registry.sourceIdentity.sampleRate,
    minimumDurationSamples = Math.round(
      input.policy.minimumSpeechAnchorSeconds * rate,
    ),
    targetBindings = new Map<string, ReviewBinding1451["targetBindings"]>();
  for (const binding of input.binding.targetBindings) {
    const rows = targetBindings.get(binding.targetId) ?? [];
    rows.push(binding);
    targetBindings.set(binding.targetId, rows);
  }
  const audited = input.targets.targets.filter((target) => {
    const bindings = targetBindings.get(target.reviewTargetId) ?? [];
    return (
      SPEECH_TARGET_TYPES.has(target.targetType) ||
      bindings.some((row) => row.bindingRequirement === "UNIT_BINDING_REQUIRED")
    );
  });
  const rows = audited
    .map((target) => {
      const bindings = targetBindings.get(target.reviewTargetId) ?? [],
        first = bindings[0],
        targetIntervals = target.targetCoreIntervals.length
          ? target.targetCoreIntervals
          : [target.nativeInterval],
        durationSamples = duration(targetIntervals),
        positiveOverlapSamples = input.registry.units.reduce(
          (sum, unit) =>
            sum +
            sampleCount143(
              intersection143(targetIntervals, unit.atomicNativeIntervals),
            ),
          0,
        ),
        boundaryUnits = input.registry.units.filter((unit) =>
          targetIntervals.some(
            (targetInterval) =>
              unit.envelopeInterval.endSample === targetInterval.startSample ||
              unit.envelopeInterval.startSample === targetInterval.endSample,
          ),
        ),
        leftUnits = input.registry.units.filter(
          (unit) =>
            unit.envelopeInterval.endSample <=
            target.nativeInterval.startSample,
        ),
        rightUnits = input.registry.units.filter(
          (unit) =>
            unit.envelopeInterval.startSample >=
            target.nativeInterval.endSample,
        ),
        leftGap = leftUnits.length
          ? target.nativeInterval.startSample -
            Math.max(
              ...leftUnits.map((unit) => unit.envelopeInterval.endSample),
            )
          : null,
        rightGap = rightUnits.length
          ? Math.min(
              ...rightUnits.map((unit) => unit.envelopeInterval.startSample),
            ) - target.nativeInterval.endSample
          : null,
        parentAudio = input.audio.audio.filter((audio) =>
          audio.coveredReviewTargetIds.includes(target.reviewTargetId),
        ),
        parentEvidenceIntervals = parentAudio.length
          ? parentAudio.map((audio) => audio.nativeSourceInterval)
          : targetIntervals,
        parentEvidenceDurationSamples = Math.max(
          durationSamples,
          duration(parentEvidenceIntervals),
        ),
        independentLocalizedSpeechCore =
          target.atomicTargetCoreIntervals.length > 0 &&
          (target.childUnitIds.length > 0 ||
            target.atomicMemberCandidateIds.length > 0),
        sourceIdentityMatch =
          target.sourceIdentity.sourceMediaSha256 ===
            input.registry.sourceIdentity.sourceMediaSha256 &&
          target.sourceIdentity.sampleRate ===
            input.registry.sourceIdentity.sampleRate,
        boundaryContactOnly =
          positiveOverlapSamples === 0 && boundaryUnits.length > 0,
        subMinimum = durationSamples < minimumDurationSamples,
        parentClearlyWider =
          parentEvidenceDurationSamples >=
          Math.max(minimumDurationSamples, durationSamples * 2),
        degenerateSliverCandidate =
          target.localizationStatus === "UNRESOLVED" &&
          subMinimum &&
          boundaryContactOnly &&
          parentClearlyWider &&
          !independentLocalizedSpeechCore &&
          sourceIdentityMatch,
        reasons = [
          ...(target.localizationStatus === "UNRESOLVED"
            ? ["UNRESOLVED_MACHINE_LOCALIZATION"]
            : []),
          ...(subMinimum ? ["BELOW_VERSIONED_MINIMUM_SPEECH_ANCHOR"] : []),
          ...(positiveOverlapSamples === 0
            ? ["NO_POSITIVE_FULL_UNIT_OVERLAP"]
            : []),
          ...(boundaryContactOnly ? ["BOUNDARY_CONTACT_ONLY"] : []),
          ...(parentClearlyWider
            ? ["PARENT_MACHINE_EVIDENCE_CLEARLY_WIDER"]
            : []),
          ...(!independentLocalizedSpeechCore
            ? ["NO_INDEPENDENT_LOCALIZED_SPEECH_CORE"]
            : []),
          ...(!sourceIdentityMatch ? ["SOURCE_IDENTITY_MISMATCH"] : []),
          ...(degenerateSliverCandidate
            ? ["DEGENERATE_ORPHAN_BOUNDARY_SLIVER_CANDIDATE"]
            : ["PRODUCT_SPEECH_TARGET_RETAINED"]),
        ];
      return degenerateAudit1452Schema.shape.rows.element.parse(
        hashed141({
          targetId: target.reviewTargetId,
          targetType: target.targetType,
          sourceInterval: target.sourceInterval,
          nativeSourceInterval: target.nativeInterval,
          durationSamples,
          durationSeconds: durationSamples / rate,
          localizationStatus: target.localizationStatus,
          durationStatus: subMinimum ? "SUB_MINIMUM" : "AT_OR_ABOVE_MINIMUM",
          evidenceIds: target.evidenceIds,
          evidenceIntervalUnion: union141(parentEvidenceIntervals),
          fullRegistryPositiveOverlapSamples: positiveOverlapSamples,
          fullRegistryBoundaryContactCount: boundaryUnits.length,
          nearestLeftUnitGapSamples: leftGap,
          nearestRightUnitGapSamples: rightGap,
          parentEvidenceDurationSamples,
          targetToParentDurationRatio: Math.min(
            1,
            durationSamples / parentEvidenceDurationSamples,
          ),
          independentLocalizedSpeechCore,
          sourceIdentityMatch,
          existingBindingRequirement:
            first?.bindingRequirement ?? "UNIT_BINDING_NOT_APPLICABLE",
          existingBindingStatus:
            first?.bindingStatus ?? "NOT_APPLICABLE_NON_SPEECH_TARGET",
          existingProductEligibility: bindings.some(
            (binding) => binding.productBindingEligible,
          ),
          degenerateSliverCandidate,
          reasons,
        }),
      );
    })
    .sort((left, right) => left.targetId.localeCompare(right.targetId));
  return degenerateAudit1452Schema.parse(
    hashed141({
      ...header1452(input.policy, input.registry.sourceIdentity),
      artifactType: "machine-degenerate-orphan-target-baseline-audit",
      reviewTargetsHash: input.targets.semanticHash,
      fullRegistryHash: input.registry.semanticHash,
      bindingHash: input.binding.semanticHash,
      minimumDurationPolicyVersion:
        input.policy.minimumSpeechAnchorPolicyVersion,
      minimumDurationSamples,
      minimumDurationSeconds: input.policy.minimumSpeechAnchorSeconds,
      rows,
      auditedSpeechTargetCount: rows.length,
      orphanSpeechTargetCount: rows.filter((row) =>
        row.targetType.includes("ORPHAN_SPEECH"),
      ).length,
      subMinimumOrphanCount: rows.filter(
        (row) =>
          row.targetType.includes("ORPHAN_SPEECH") &&
          row.durationStatus === "SUB_MINIMUM",
      ).length,
      boundaryContactOnlyCount: rows.filter(
        (row) =>
          row.fullRegistryPositiveOverlapSamples === 0 &&
          row.fullRegistryBoundaryContactCount > 0,
      ).length,
      degenerateSliverCandidateCount: rows.filter(
        (row) => row.degenerateSliverCandidate,
      ).length,
    }),
  );
}

export function reconcileDegenerateEligibility1452(input: {
  policy: Policy1452;
  registry: FullRegistry1451;
  binding: ReviewBinding1451;
  targets: ReviewTargets1451;
  audit: DegenerateAudit1452;
}): DegenerateEligibility1452 {
  const rows = input.audit.rows.map((audit) => {
      const classified = audit.degenerateSliverCandidate,
        productEligible = input.binding.targetBindings.some(
          (row) =>
            row.targetId === audit.targetId && row.productBindingEligible,
        );
      return degenerateEligibility1452Schema.shape.rows.element.parse(
        hashed141({
          targetId: audit.targetId,
          previousBindingRequirement: audit.existingBindingRequirement,
          finalBindingRequirement: classified
            ? "UNIT_BINDING_OPTIONAL_AUDIT_ONLY"
            : audit.existingBindingRequirement,
          previousProductEligibility: productEligible,
          finalProductEligibility: classified ? false : productEligible,
          classification: classified
            ? "DEGENERATE_ORPHAN_BOUNDARY_SLIVER"
            : "NOT_DEGENERATE",
          productOutcomeRole: classified
            ? "AUDIT_ONLY_BOUNDARY_RESIDUE"
            : audit.existingBindingRequirement === "UNIT_BINDING_NOT_APPLICABLE"
              ? "NON_SPEECH_AUDIT_TARGET"
              : "PRODUCT_CONTRACT_TARGET",
          durationPolicyVersion: input.policy.minimumSpeechAnchorPolicyVersion,
          minimumDurationSamples: input.audit.minimumDurationSamples,
          positiveOverlapSamples: audit.fullRegistryPositiveOverlapSamples,
          boundaryContactOnly:
            audit.fullRegistryPositiveOverlapSamples === 0 &&
            audit.fullRegistryBoundaryContactCount > 0,
          auditRetention: true,
          geometryChanged: false,
          reasons: classified
            ? [
                "RETAIN_TARGET_AND_LINEAGE_FOR_AUDIT",
                "REMOVE_FROM_PRODUCT_BINDING_REQUIREMENT",
                "NO_GEOMETRY_EXPANSION",
                "NO_FAKE_UNIT_OR_REALIZATION",
              ]
            : ["PRODUCT_ELIGIBILITY_UNCHANGED"],
        }),
      );
    }),
    classifiedIds = new Set(
      rows
        .filter(
          (row) => row.classification === "DEGENERATE_ORPHAN_BOUNDARY_SLIVER",
        )
        .map((row) => row.targetId),
    ),
    requiredBefore = new Set(
      input.binding.targetBindings
        .filter((row) => row.bindingRequirement === "UNIT_BINDING_REQUIRED")
        .map((row) => row.targetId),
    ),
    requiredAfter = new Set(
      [...requiredBefore].filter((targetId) => !classifiedIds.has(targetId)),
    ),
    boundAfter = new Set(
      input.binding.targetBindings
        .filter(
          (row) =>
            requiredAfter.has(row.targetId) &&
            row.productBindingEligible &&
            row.fullCoverageUnitId !== null,
        )
        .map((row) => row.targetId),
    );
  if (requiredAfter.size !== boundAfter.size)
    throw new Error(
      `C6011452_REQUIRED_TARGET_REMAINS_UNBOUND:${requiredAfter.size - boundAfter.size}`,
    );
  return degenerateEligibility1452Schema.parse(
    hashed141({
      ...header1452(input.policy, input.registry.sourceIdentity),
      artifactType: "machine-degenerate-orphan-target-eligibility-v1",
      auditHash: input.audit.semanticHash,
      rows,
      degenerateSliverClassifiedCount: classifiedIds.size,
      degenerateSliverAuditRetainedCount: classifiedIds.size,
      degenerateSliverGeometryMutationCount: 0,
      degenerateSliverDeletedCount: 0,
      degenerateSliverFakeBindingCount: 0,
      productRequiredDegenerateSliverCountBefore: [...classifiedIds].filter(
        (id) => requiredBefore.has(id),
      ).length,
      productRequiredDegenerateSliverCountAfter: 0,
      bindingRequiredTargetCountBefore: requiredBefore.size,
      bindingRequiredTargetCountAfter: requiredAfter.size,
      requiredTargetBoundCountAfter: boundAfter.size,
      requiredTargetUnboundCountAfter: 0,
      reviewTargetCountBefore: input.targets.targets.length,
      reviewTargetCountAfter: input.targets.targets.length,
      targetIntervalMutationCount: 0,
      passed: true,
    }),
  );
}

export function eligibilityForTarget1452(
  eligibility: DegenerateEligibility1452,
  targetId: string,
) {
  return eligibility.rows.find((row) => row.targetId === targetId);
}

export const assertNoDegenerateFakeBinding1452 = (input: {
  eligibility: DegenerateEligibility1452;
  binding: ReviewBinding1451;
}) => {
  for (const row of input.eligibility.rows.filter(
    (entry) => entry.classification === "DEGENERATE_ORPHAN_BOUNDARY_SLIVER",
  )) {
    const product = input.binding.targetBindings.filter(
      (binding) =>
        binding.targetId === row.targetId && binding.productBindingEligible,
    );
    if (product.length)
      throw new Error(
        `C6011452_DEGENERATE_FAKE_BINDING:${required141(product[0]).bindingLedgerId}`,
      );
  }
};
