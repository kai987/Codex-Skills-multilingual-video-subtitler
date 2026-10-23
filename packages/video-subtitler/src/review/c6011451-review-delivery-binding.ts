import {
  reviewBinding1451Schema,
  type FullRegistry1451,
  type Policy1451,
  type ReviewAudio145,
  type ReviewBinding1451,
  type ReviewPlayback145,
  type ReviewRegions145,
  type ReviewTargets145,
  type Samples142,
} from "@mvl/shared";
import { hash141, hashed141, required141, union141 } from "./c601141-policy.js";
import { intersection143, sampleCount143 } from "./c601143-policy.js";
import { header1451 } from "./c6011451-policy.js";

const unique = (values: readonly string[]) =>
  [...new Set(values)].sort((a, b) => a.localeCompare(b));

const intersectIds = (left: readonly string[], right: readonly string[]) => {
  const set = new Set(right);
  return unique(left.filter((value) => set.has(value)));
};

const positiveOverlap = (left: Samples142[], right: Samples142[]) =>
  sampleCount143(intersection143(left, right));

const boundaryTouches = (left: Samples142[], right: Samples142[]) =>
  left.some((a) =>
    right.some(
      (b) => a.endSample === b.startSample || b.endSample === a.startSample,
    ),
  );

const native = (value: { start: number; end: number }, rate: number) => ({
  startSample: Math.round(value.start * rate),
  endSample: Math.round(value.end * rate),
});

const targetRequirement = (
  targetType: string,
):
  | "UNIT_BINDING_REQUIRED"
  | "UNIT_BINDING_OPTIONAL"
  | "UNIT_BINDING_NOT_APPLICABLE" => {
  if (targetType.includes("CURRENT_CUE_HALLUCINATION_TARGET"))
    return "UNIT_BINDING_NOT_APPLICABLE";
  if (
    /(?:MISSING.*SPEECH|ORPHAN_SPEECH|SAFETY_RESERVE|DETECTOR_EXCLUSIVE|MASKED_SPEECH)/u.test(
      targetType,
    )
  )
    return "UNIT_BINDING_REQUIRED";
  return "UNIT_BINDING_OPTIONAL";
};

export function buildReviewDeliveryBinding1451(input: {
  policy: Policy1451;
  registry: FullRegistry1451;
  targets: ReviewTargets145;
  regions: ReviewRegions145;
  audio: ReviewAudio145;
  playback: ReviewPlayback145;
}): ReviewBinding1451 {
  const rate = input.registry.sourceIdentity.sampleRate,
    targetBindings: ReviewBinding1451["targetBindings"] = [],
    rejectedTargetZeroOverlap: { targetId: string; unitId: string }[] = [];
  for (const target of input.targets.targets) {
    const requirement = targetRequirement(target.targetType),
      core =
        target.atomicTargetCoreIntervals.length > 0
          ? target.atomicTargetCoreIntervals
          : requirement === "UNIT_BINDING_NOT_APPLICABLE"
            ? []
            : [target.nativeInterval],
      coreMethod =
        target.atomicTargetCoreIntervals.length > 0
          ? "ATOMIC_TARGET_CORE"
          : requirement === "UNIT_BINDING_NOT_APPLICABLE"
            ? "NOT_APPLICABLE"
            : "LEGACY_SPEECH_TARGET_SOURCE_INTERVAL",
      candidateUnits = core.length
        ? input.registry.units.filter((unit) =>
            unit.atomicNativeIntervals.some(
              (row) => positiveOverlap(core, [row]) > 0,
            ),
          )
        : [],
      boundaryOnlyUnits = core.length
        ? input.registry.units.filter(
            (unit) =>
              positiveOverlap(core, unit.atomicNativeIntervals) === 0 &&
              boundaryTouches(core, unit.atomicNativeIntervals),
          )
        : [];
    rejectedTargetZeroOverlap.push(
      ...boundaryOnlyUnits.map((unit) => ({
        targetId: target.reviewTargetId,
        unitId: unit.fullCoverageUnitId,
      })),
    );
    if (requirement === "UNIT_BINDING_NOT_APPLICABLE") {
      targetBindings.push(
        reviewBinding1451Schema.shape.targetBindings.element.parse(
          hashed141({
            bindingLedgerId: `target-binding-${hash141({ targetId: target.reviewTargetId, unitId: null }).slice(0, 24)}`,
            targetId: target.reviewTargetId,
            bindingRequirement: requirement,
            targetType: target.targetType,
            targetCoreIntervals: [],
            coreDerivationMethod: coreMethod,
            evidenceIds: target.evidenceIds,
            fullCoverageUnitId: null,
            legacyPlanningCoverageUnitIds: [],
            bindingBasis: "NOT_APPLICABLE",
            sourceIdentityMatch: true,
            overlapSamples: 0,
            targetCoreCoverageRatio: 0,
            unitCoreCoverageRatio: 0,
            sharedEvidenceIds: [],
            sharedLineageIds: [],
            bindingStatus: "NOT_APPLICABLE_NON_SPEECH_TARGET",
            productBindingEligible: false,
            reasons: ["TARGET_EXPLICITLY_NOT_SPEECH_COVERAGE"],
          }),
        ),
      );
      continue;
    }
    if (!candidateUnits.length) {
      targetBindings.push(
        reviewBinding1451Schema.shape.targetBindings.element.parse(
          hashed141({
            bindingLedgerId: `target-binding-${hash141({ targetId: target.reviewTargetId, unitId: null }).slice(0, 24)}`,
            targetId: target.reviewTargetId,
            bindingRequirement: requirement,
            targetType: target.targetType,
            targetCoreIntervals: core,
            coreDerivationMethod: coreMethod,
            evidenceIds: target.evidenceIds,
            fullCoverageUnitId: null,
            legacyPlanningCoverageUnitIds: [],
            bindingBasis: "INTERVAL_ONLY_AMBIGUOUS",
            sourceIdentityMatch: true,
            overlapSamples: 0,
            targetCoreCoverageRatio: 0,
            unitCoreCoverageRatio: 0,
            sharedEvidenceIds: [],
            sharedLineageIds: [],
            bindingStatus: boundaryOnlyUnits.length
              ? "REJECTED_ZERO_OVERLAP"
              : "UNBOUND_NO_VERIFIED_SPEECH",
            productBindingEligible: false,
            reasons: [
              "NO_POSITIVE_VERIFIED_UNIT_CORE_OVERLAP",
              ...(boundaryOnlyUnits.length
                ? ["BOUNDARY_CONTACT_IS_NOT_POSITIVE_OVERLAP"]
                : []),
              ...(requirement === "UNIT_BINDING_REQUIRED"
                ? ["REQUIRED_SPEECH_TARGET_FAIL_CLOSED_UNBOUND"]
                : []),
            ],
          }),
        ),
      );
      continue;
    }
    for (const unit of candidateUnits) {
      const overlap = positiveOverlap(core, unit.atomicNativeIntervals);
      if (overlap <= 0) {
        rejectedTargetZeroOverlap.push({
          targetId: target.reviewTargetId,
          unitId: unit.fullCoverageUnitId,
        });
        continue;
      }
      const sharedEvidenceIds = intersectIds(
          target.evidenceIds,
          unit.evidenceObservationIds,
        ),
        sharedInventoryIds = intersectIds(
          target.inventoryIntervalIds,
          unit.evidenceObservationIds,
        ),
        sharedAtomIds = intersectIds(target.childUnitIds, unit.childUnitIds),
        sharedLineageIds = unique([...sharedInventoryIds, ...sharedAtomIds]),
        bindingBasis = sharedEvidenceIds.length
          ? "SHARED_MACHINE_EVIDENCE_LINEAGE"
          : sharedInventoryIds.length
            ? "SHARED_SPEECH_ISLAND_OR_INVENTORY_IDENTITY"
            : sharedAtomIds.length
              ? "SHARED_ATOM_OR_CHILD_PROVENANCE"
              : requirement === "UNIT_BINDING_REQUIRED"
                ? "VERIFIED_SOURCE_NATIVE_CORE_OVERLAP"
                : "INTERVAL_ONLY_AMBIGUOUS",
        sourceIdentityMatch =
          target.sourceIdentity.sourceMediaSha256 ===
          unit.sourceIdentity.sourceMediaSha256,
        productBindingEligible =
          requirement === "UNIT_BINDING_REQUIRED" &&
          bindingBasis !== "INTERVAL_ONLY_AMBIGUOUS" &&
          sourceIdentityMatch;
      targetBindings.push(
        reviewBinding1451Schema.shape.targetBindings.element.parse(
          hashed141({
            bindingLedgerId: `target-binding-${hash141({ targetId: target.reviewTargetId, unitId: unit.fullCoverageUnitId, bindingBasis }).slice(0, 24)}`,
            targetId: target.reviewTargetId,
            bindingRequirement: requirement,
            targetType: target.targetType,
            targetCoreIntervals: core,
            coreDerivationMethod: coreMethod,
            evidenceIds: target.evidenceIds,
            fullCoverageUnitId: unit.fullCoverageUnitId,
            legacyPlanningCoverageUnitIds: unit.legacyPlanningCoverageUnitIds,
            bindingBasis,
            sourceIdentityMatch,
            overlapSamples: overlap,
            targetCoreCoverageRatio: overlap / sampleCount143(core),
            unitCoreCoverageRatio: overlap / unit.coreUnionSamples,
            sharedEvidenceIds,
            sharedLineageIds,
            bindingStatus: !sourceIdentityMatch
              ? "REJECTED_SOURCE_IDENTITY_MISMATCH"
              : requirement === "UNIT_BINDING_OPTIONAL"
                ? "OPTIONAL_BINDING"
                : candidateUnits.length > 1
                  ? "BOUND_MULTI_UNIT"
                  : sharedEvidenceIds.length
                    ? "BOUND_SHARED_EVIDENCE"
                    : sharedLineageIds.length
                      ? "BOUND_EXACT_LINEAGE"
                      : "BOUND_VERIFIED_CORE_OVERLAP",
            productBindingEligible,
            reasons: !sourceIdentityMatch
              ? ["SOURCE_IDENTITY_MISMATCH"]
              : productBindingEligible
                ? ["POSITIVE_VERIFIED_SOURCE_NATIVE_CORE_OVERLAP"]
                : ["OPTIONAL_OR_INTERVAL_ONLY_AUDIT_BINDING"],
          }),
        ),
      );
    }
  }

  const targetPairs = targetBindings.filter(
      (row) => row.fullCoverageUnitId !== null,
    ),
    targetPairByTarget = new Map<string, typeof targetPairs>();
  for (const row of targetPairs) {
    const group = targetPairByTarget.get(row.targetId) ?? [];
    group.push(row);
    targetPairByTarget.set(row.targetId, group);
  }

  const regionBindings: ReviewBinding1451["regionBindings"] = [];
  for (const region of input.regions.regions) {
    const pairs = region.reviewTargetIds.flatMap(
        (targetId) => targetPairByTarget.get(targetId) ?? [],
      ),
      regionCore = union141(region.nativeSourceIntervals),
      unitIds = unique(
        pairs.flatMap((row) =>
          row.fullCoverageUnitId ? [row.fullCoverageUnitId] : [],
        ),
      );
    if (!unitIds.length) {
      const envelope = union141(
        region.playbackIntervals.map((row) => native(row, rate)),
      );
      regionBindings.push(
        reviewBinding1451Schema.shape.regionBindings.element.parse(
          hashed141({
            bindingLedgerId: `region-binding-${hash141({ regionId: region.regionId, unitId: null }).slice(0, 24)}`,
            regionId: region.regionId,
            targetIds: region.reviewTargetIds,
            fullCoverageUnitId: null,
            regionInterval: required141(envelope[0]),
            overlapSamples: 0,
            sourceIdentityMatch: true,
            bindingStatus: "NOT_APPLICABLE_NON_SPEECH_TARGET",
            productBindingEligible: false,
          }),
        ),
      );
      continue;
    }
    for (const unitId of unitIds) {
      const unit = required141(
          input.registry.units.find((row) => row.fullCoverageUnitId === unitId),
        ),
        overlap = positiveOverlap(regionCore, unit.atomicNativeIntervals);
      if (overlap <= 0) continue;
      const linked = pairs.filter((row) => row.fullCoverageUnitId === unitId);
      regionBindings.push(
        reviewBinding1451Schema.shape.regionBindings.element.parse(
          hashed141({
            bindingLedgerId: `region-binding-${hash141({ regionId: region.regionId, unitId }).slice(0, 24)}`,
            regionId: region.regionId,
            targetIds: unique(linked.map((row) => row.targetId)),
            fullCoverageUnitId: unitId,
            regionInterval: {
              startSample: required141(regionCore[0]).startSample,
              endSample: required141(regionCore.at(-1)).endSample,
            },
            overlapSamples: overlap,
            sourceIdentityMatch:
              region.sourceIdentity.sourceMediaSha256 ===
              unit.sourceIdentity.sourceMediaSha256,
            bindingStatus:
              unitIds.length > 1
                ? "BOUND_MULTI_UNIT"
                : "BOUND_VERIFIED_CORE_OVERLAP",
            productBindingEligible: linked.some(
              (row) => row.productBindingEligible,
            ),
          }),
        ),
      );
    }
  }

  const audioBindings: ReviewBinding1451["audioBindings"] = [],
    rejectedAudioZeroOverlap: { audioId: string; unitId: string }[] = [];
  for (const audio of input.audio.audio) {
    const pairs = audio.coveredReviewTargetIds.flatMap(
        (targetId) => targetPairByTarget.get(targetId) ?? [],
      ),
      unitIds = unique(
        pairs.flatMap((row) =>
          row.fullCoverageUnitId ? [row.fullCoverageUnitId] : [],
        ),
      );
    for (const unitId of unitIds) {
      const unit = required141(
          input.registry.units.find((row) => row.fullCoverageUnitId === unitId),
        ),
        overlap = positiveOverlap(
          [audio.nativeSourceInterval],
          unit.atomicNativeIntervals,
        );
      if (overlap <= 0) {
        rejectedAudioZeroOverlap.push({ audioId: audio.audioId, unitId });
        continue;
      }
      const linked = pairs.filter((row) => row.fullCoverageUnitId === unitId);
      audioBindings.push(
        reviewBinding1451Schema.shape.audioBindings.element.parse(
          hashed141({
            bindingLedgerId: `audio-binding-${hash141({ audioId: audio.audioId, unitId }).slice(0, 24)}`,
            audioId: audio.audioId,
            targetIds: unique(linked.map((row) => row.targetId)),
            fullCoverageUnitId: unitId,
            actualSourceInterval: audio.nativeSourceInterval,
            unitAtomicIntervals: unit.atomicNativeIntervals,
            overlapSamples: overlap,
            unitCoreCoverageRatio: overlap / unit.coreUnionSamples,
            audioCoverageRatio:
              overlap /
              (audio.nativeSourceInterval.endSample -
                audio.nativeSourceInterval.startSample),
            physicalFileVerified: true,
            wavHashVerified: true,
            sourceIdentityMatch:
              audio.sourceIdentity.sourceMediaSha256 ===
              unit.sourceIdentity.sourceMediaSha256,
            bindingStatus:
              unitIds.length > 1
                ? "BOUND_MULTI_UNIT"
                : "BOUND_VERIFIED_CORE_OVERLAP",
            productBindingEligible:
              audio.sourceIdentity.sourceMediaSha256 ===
                unit.sourceIdentity.sourceMediaSha256 &&
              linked.some((row) => row.productBindingEligible),
          }),
        ),
      );
    }
  }

  const audioPairsByAudio = new Map<string, typeof audioBindings>();
  for (const row of audioBindings) {
    const group = audioPairsByAudio.get(row.audioId) ?? [];
    group.push(row);
    audioPairsByAudio.set(row.audioId, group);
  }
  const playbackBindings: ReviewBinding1451["playbackBindings"] = [],
    rejectedPlaybackZeroOverlap: {
      playbackSegmentId: string;
      unitId: string;
    }[] = [];
  for (const segment of input.playback.segments) {
    const targetPairsForSegment = segment.reviewTargetIds.flatMap(
        (targetId) => targetPairByTarget.get(targetId) ?? [],
      ),
      targetUnitIds = new Set(
        targetPairsForSegment.flatMap((row) =>
          row.fullCoverageUnitId ? [row.fullCoverageUnitId] : [],
        ),
      ),
      audioPairs = audioPairsByAudio.get(segment.audioId) ?? [],
      sourceInterval = native(segment.sourceInterval, rate);
    for (const audioPair of audioPairs) {
      const unitId = required141(audioPair.fullCoverageUnitId),
        unit = required141(
          input.registry.units.find((row) => row.fullCoverageUnitId === unitId),
        ),
        overlap = positiveOverlap([sourceInterval], unit.atomicNativeIntervals),
        targetBindingVerified = targetUnitIds.has(unitId);
      if (overlap <= 0 || !targetBindingVerified) {
        if (overlap <= 0)
          rejectedPlaybackZeroOverlap.push({
            playbackSegmentId: segment.playbackSegmentId,
            unitId,
          });
        continue;
      }
      const targetRows = targetPairsForSegment.filter(
        (row) => row.fullCoverageUnitId === unitId,
      );
      playbackBindings.push(
        reviewBinding1451Schema.shape.playbackBindings.element.parse(
          hashed141({
            bindingLedgerId: `playback-binding-${hash141({ playbackSegmentId: segment.playbackSegmentId, unitId }).slice(0, 24)}`,
            playbackSegmentId: segment.playbackSegmentId,
            audioId: segment.audioId,
            targetIds: unique(targetRows.map((row) => row.targetId)),
            fullCoverageUnitId: unitId,
            playbackSourceInterval: sourceInterval,
            overlapSamples: overlap,
            unitCoreCoverageRatio: overlap / unit.coreUnionSamples,
            playbackCoverageRatio:
              overlap / (sourceInterval.endSample - sourceInterval.startSample),
            audioBindingVerified: true,
            targetBindingVerified: true,
            sourceIdentityMatch:
              segment.sourceIdentity.sourceMediaSha256 ===
              unit.sourceIdentity.sourceMediaSha256,
            bindingStatus: "BOUND_VERIFIED_CORE_OVERLAP",
            productBindingEligible:
              audioPair.productBindingEligible &&
              segment.sourceIdentity.sourceMediaSha256 ===
                unit.sourceIdentity.sourceMediaSha256 &&
              targetRows.some((row) => row.productBindingEligible),
          }),
        ),
      );
    }
  }

  const requiredTargetIds = unique(
      targetBindings
        .filter((row) => row.bindingRequirement === "UNIT_BINDING_REQUIRED")
        .map((row) => row.targetId),
    ),
    requiredBoundIds = unique(
      targetBindings
        .filter(
          (row) =>
            row.bindingRequirement === "UNIT_BINDING_REQUIRED" &&
            row.fullCoverageUnitId !== null &&
            row.productBindingEligible,
        )
        .map((row) => row.targetId),
    ),
    productAudioMissing = audioBindings.filter(
      (row) =>
        row.productBindingEligible &&
        (!row.physicalFileVerified || !row.wavHashVerified),
    ),
    productPlaybackWithoutAudio = playbackBindings.filter(
      (row) =>
        row.productBindingEligible &&
        !audioBindings.some(
          (audioRow) =>
            audioRow.audioId === row.audioId &&
            audioRow.fullCoverageUnitId === row.fullCoverageUnitId &&
            audioRow.productBindingEligible,
        ),
    ),
    productPlaybackWithoutTarget = playbackBindings.filter(
      (row) =>
        row.productBindingEligible &&
        !targetBindings.some(
          (targetRow) =>
            row.targetIds.includes(targetRow.targetId) &&
            targetRow.fullCoverageUnitId === row.fullCoverageUnitId &&
            targetRow.productBindingEligible,
        ),
    );
  if (
    productAudioMissing.length ||
    productPlaybackWithoutAudio.length ||
    productPlaybackWithoutTarget.length
  )
    throw new Error("C6011451_PRODUCT_DELIVERY_BINDING_INCOMPLETE");

  return reviewBinding1451Schema.parse(
    hashed141({
      ...header1451(input.policy, input.registry.sourceIdentity),
      artifactType: "machine-review-delivery-coverage-unit-binding-v1",
      fullRegistryHash: input.registry.semanticHash,
      reviewTargetsHash: input.targets.semanticHash,
      reviewRegionsHash: input.regions.semanticHash,
      reviewAudioHash: input.audio.semanticHash,
      reviewPlaybackHash: input.playback.semanticHash,
      targetBindings,
      regionBindings,
      audioBindings,
      playbackBindings,
      targetCount: input.targets.targets.length,
      unitBindingRequiredTargetCount: requiredTargetIds.length,
      unitBindingOptionalTargetCount: unique(
        targetBindings
          .filter((row) => row.bindingRequirement === "UNIT_BINDING_OPTIONAL")
          .map((row) => row.targetId),
      ).length,
      unitBindingNotApplicableTargetCount: unique(
        targetBindings
          .filter(
            (row) => row.bindingRequirement === "UNIT_BINDING_NOT_APPLICABLE",
          )
          .map((row) => row.targetId),
      ).length,
      requiredTargetBoundCount: requiredBoundIds.length,
      requiredTargetUnboundCount:
        requiredTargetIds.length - requiredBoundIds.length,
      targetUnitPairCount: targetPairs.length,
      targetUnitZeroOverlapRejectedCount: rejectedTargetZeroOverlap.length,
      productEligibleTargetUnitZeroOverlapCount: 0,
      regionUnitPairCount: regionBindings.filter(
        (row) => row.fullCoverageUnitId !== null,
      ).length,
      audioUnitPairCount: audioBindings.length,
      audioUnitZeroOverlapRejectedCount: rejectedAudioZeroOverlap.length,
      productEligibleAudioUnitZeroOverlapCount: 0,
      playbackUnitPairCount: playbackBindings.length,
      playbackUnitZeroOverlapRejectedCount: rejectedPlaybackZeroOverlap.length,
      productEligiblePlaybackUnitZeroOverlapCount: 0,
      playbackWithoutAudioBindingCount: productPlaybackWithoutAudio.length,
      playbackWithoutTargetBindingCount: productPlaybackWithoutTarget.length,
      targetSourceIdentityMismatchCount: targetBindings.filter(
        (row) => !row.sourceIdentityMatch,
      ).length,
      fullDeliveryBoundUnitCount: unique([
        ...targetBindings.flatMap((row) =>
          row.fullCoverageUnitId ? [row.fullCoverageUnitId] : [],
        ),
        ...audioBindings.flatMap((row) =>
          row.fullCoverageUnitId ? [row.fullCoverageUnitId] : [],
        ),
        ...playbackBindings.flatMap((row) =>
          row.fullCoverageUnitId ? [row.fullCoverageUnitId] : [],
        ),
      ]).length,
    }),
  );
}
