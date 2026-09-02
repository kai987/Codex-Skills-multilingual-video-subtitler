import {
  reviewAudio1451Schema,
  reviewItems1451Schema,
  reviewPlayback1451Schema,
  reviewRegions1451Schema,
  reviewTargets1451Schema,
  type EffectiveRealizations1451,
  type InheritedRealizations1451,
  type Policy1451,
  type ReviewAudio145,
  type ReviewBinding1451,
  type ReviewItems145,
  type ReviewPlayback145,
  type ReviewRegions145,
  type ReviewTargets145,
} from "@mvl/shared";
import { hashed141 } from "./c601141-policy.js";

const unique = (values: readonly string[]) =>
  [...new Set(values)].sort((a, b) => a.localeCompare(b));

export function projectReviewDelivery1451(input: {
  policy: Policy1451;
  binding: ReviewBinding1451;
  inherited: InheritedRealizations1451;
  effective: EffectiveRealizations1451;
  targets: ReviewTargets145;
  items: ReviewItems145;
  regions: ReviewRegions145;
  audio: ReviewAudio145;
  playback: ReviewPlayback145;
}) {
  const targetRows = input.targets.targets.map((source) => {
      const bindings = input.binding.targetBindings.filter(
          (row) => row.targetId === source.reviewTargetId,
        ),
        productBindings = bindings.filter(
          (row) =>
            row.productBindingEligible && row.fullCoverageUnitId !== null,
        ),
        effective = input.effective.realizations.filter((row) =>
          row.targetIds.includes(source.reviewTargetId),
        ),
        first = bindings[0];
      return reviewTargets1451Schema.shape.targets.element.parse(
        hashed141({
          ...source,
          semanticHash: undefined,
          fullCoverageUnitIds: unique(
            bindings.flatMap((row) =>
              row.fullCoverageUnitId ? [row.fullCoverageUnitId] : [],
            ),
          ),
          planningCoverageUnitIds: unique(
            bindings.flatMap((row) => row.legacyPlanningCoverageUnitIds),
          ),
          unitBindingRequirement:
            first?.bindingRequirement ?? "UNIT_BINDING_NOT_APPLICABLE",
          unitBindingStatus:
            productBindings.length > 1
              ? "BOUND_MULTI_UNIT"
              : (first?.bindingStatus ?? "NOT_APPLICABLE_NON_SPEECH_TARGET"),
          unitBindingLedgerIds: bindings.map((row) => row.bindingLedgerId),
          realizationIds: effective.map((row) => row.effectiveRealizationId),
          realizationOrigins: unique(
            effective.flatMap((row) => row.realizationOrigins),
          ),
          targetCoreIntervals: first?.targetCoreIntervals ?? [],
          coreDerivationMethod: first?.coreDerivationMethod ?? "NOT_APPLICABLE",
          productBindingEligible: productBindings.length > 0,
        }),
      );
    }),
    targets = reviewTargets1451Schema.parse(
      hashed141({
        ...input.targets,
        policyVersion: input.policy.policyVersion,
        policyHash: input.policy.semanticHash,
        artifactType: "machine-review-target-intervals-v8",
        targets: targetRows,
        bindingHash: input.binding.semanticHash,
        semanticHash: undefined,
      }),
    ),
    targetById = new Map(
      targets.targets.map((row) => [row.reviewTargetId, row]),
    ),
    itemRows = input.items.items.map((source) => {
      const linked = source.reviewTargetIds.flatMap((id) => {
          const target = targetById.get(id);
          return target ? [target] : [];
        }),
        inherited = input.inherited.realizations.filter((row) =>
          row.targetIds.some((id) => source.reviewTargetIds.includes(id)),
        );
      return reviewItems1451Schema.shape.items.element.parse(
        hashed141({
          ...source,
          semanticHash: undefined,
          fullCoverageUnitIds: unique(
            linked.flatMap((row) => row.fullCoverageUnitIds),
          ),
          inheritedRealizationIds: inherited.map((row) => row.realizationId),
          productBindingStatus: linked.some((row) => row.productBindingEligible)
            ? "BOUND_PRODUCT_DELIVERY"
            : "NOT_APPLICABLE_OR_AUDIT_ONLY",
        }),
      );
    }),
    items = reviewItems1451Schema.parse(
      hashed141({
        ...input.items,
        policyVersion: input.policy.policyVersion,
        policyHash: input.policy.semanticHash,
        artifactType: "machine-review-items-v10",
        items: itemRows,
        bindingHash: input.binding.semanticHash,
        semanticHash: undefined,
      }),
    ),
    regionRows = input.regions.regions.map((source) => {
      const bindings = input.binding.regionBindings.filter(
          (row) => row.regionId === source.regionId,
        ),
        inherited = input.inherited.realizations.filter((row) =>
          row.regionIds.includes(source.regionId),
        );
      return reviewRegions1451Schema.shape.regions.element.parse(
        hashed141({
          ...source,
          semanticHash: undefined,
          fullCoverageUnitIds: unique(
            bindings.flatMap((row) =>
              row.fullCoverageUnitId ? [row.fullCoverageUnitId] : [],
            ),
          ),
          inheritedRealizationIds: inherited.map((row) => row.realizationId),
          unitBindingLedgerIds: bindings.map((row) => row.bindingLedgerId),
          productBindingStatus: bindings.some(
            (row) => row.productBindingEligible,
          )
            ? "BOUND_PRODUCT_DELIVERY"
            : "NOT_APPLICABLE_OR_AUDIT_ONLY",
        }),
      );
    }),
    regions = reviewRegions1451Schema.parse(
      hashed141({
        ...input.regions,
        policyVersion: input.policy.policyVersion,
        policyHash: input.policy.semanticHash,
        artifactType: "machine-review-regions-v9",
        regions: regionRows,
        bindingHash: input.binding.semanticHash,
        semanticHash: undefined,
      }),
    ),
    audioRows = input.audio.audio.map((source) => {
      const bindings = input.binding.audioBindings.filter(
          (row) => row.audioId === source.audioId,
        ),
        inherited = input.inherited.realizations.filter((row) =>
          row.audioIds.includes(source.audioId),
        );
      return reviewAudio1451Schema.shape.audio.element.parse(
        hashed141({
          ...source,
          semanticHash: undefined,
          coveredFullCoverageUnitIds: unique(
            bindings.flatMap((row) =>
              row.fullCoverageUnitId ? [row.fullCoverageUnitId] : [],
            ),
          ),
          audioUnitBindingLedgerIds: bindings.map((row) => row.bindingLedgerId),
          inheritedRealizationIds: inherited.map((row) => row.realizationId),
          actualUnitCoverageRatios: Object.fromEntries(
            bindings.flatMap((row) =>
              row.fullCoverageUnitId
                ? [[row.fullCoverageUnitId, row.unitCoreCoverageRatio]]
                : [],
            ),
          ),
          productBindingStatus: bindings.some(
            (row) => row.productBindingEligible,
          )
            ? "BOUND_PRODUCT_DELIVERY"
            : "NOT_APPLICABLE_OR_AUDIT_ONLY",
        }),
      );
    }),
    audio = reviewAudio1451Schema.parse(
      hashed141({
        ...input.audio,
        policyVersion: input.policy.policyVersion,
        policyHash: input.policy.semanticHash,
        artifactType: "machine-review-audio-manifest-v9",
        audio: audioRows,
        bindingHash: input.binding.semanticHash,
        semanticHash: undefined,
      }),
    ),
    playbackRows = input.playback.segments.map((source) => {
      const bindings = input.binding.playbackBindings.filter(
          (row) => row.playbackSegmentId === source.playbackSegmentId,
        ),
        inherited = input.inherited.realizations.filter((row) =>
          row.playbackSegmentIds.includes(source.playbackSegmentId),
        );
      return reviewPlayback1451Schema.shape.segments.element.parse(
        hashed141({
          ...source,
          semanticHash: undefined,
          fullCoverageUnitIds: unique(
            bindings.flatMap((row) =>
              row.fullCoverageUnitId ? [row.fullCoverageUnitId] : [],
            ),
          ),
          playbackUnitBindingLedgerIds: bindings.map(
            (row) => row.bindingLedgerId,
          ),
          inheritedRealizationIds: inherited.map((row) => row.realizationId),
          actualUnitCoverageRatios: Object.fromEntries(
            bindings.flatMap((row) =>
              row.fullCoverageUnitId
                ? [[row.fullCoverageUnitId, row.unitCoreCoverageRatio]]
                : [],
            ),
          ),
          productBindingStatus: bindings.some(
            (row) => row.productBindingEligible,
          )
            ? "BOUND_PRODUCT_DELIVERY"
            : "NOT_APPLICABLE_OR_AUDIT_ONLY",
        }),
      );
    }),
    playback = reviewPlayback1451Schema.parse(
      hashed141({
        ...input.playback,
        policyVersion: input.policy.policyVersion,
        policyHash: input.policy.semanticHash,
        artifactType: "machine-review-playback-timeline-v8",
        segments: playbackRows,
        bindingHash: input.binding.semanticHash,
        semanticHash: undefined,
      }),
    );
  return { targets, items, regions, audio, playback };
}
