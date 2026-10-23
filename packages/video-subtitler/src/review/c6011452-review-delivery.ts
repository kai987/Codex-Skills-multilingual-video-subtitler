import {
  reviewAudio1452Schema,
  reviewItems1452Schema,
  reviewPlayback1452Schema,
  reviewRegions1452Schema,
  reviewTargets1452Schema,
  type DegenerateEligibility1452,
  type EffectiveRealizations1452,
  type InheritedRealizations1452,
  type Policy1452,
  type ReviewAudio1451,
  type ReviewItems1451,
  type ReviewPlayback1451,
  type ReviewRegions1451,
  type ReviewTargets1451,
  type WitnessGroups1452,
} from "@mvl/shared";
import { hashed141 } from "./c601141-policy.js";
import { buildPlaybackChainMap1452 } from "./c6011452-witness-connectivity.js";

const unique = (values: readonly string[]) =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right));

export function projectReviewDelivery1452(input: {
  policy: Policy1452;
  eligibility: DegenerateEligibility1452;
  inherited: InheritedRealizations1452;
  effective: EffectiveRealizations1452;
  witnesses: WitnessGroups1452;
  targets: ReviewTargets1451;
  items: ReviewItems1451;
  regions: ReviewRegions1451;
  audio: ReviewAudio1451;
  playback: ReviewPlayback1451;
}) {
  const eligibilityByTarget = new Map(
      input.eligibility.rows.map((row) => [row.targetId, row]),
    ),
    playbackChainBySegment = buildPlaybackChainMap1452({
      policy: input.policy,
      playback: input.playback,
    }),
    targetRows = input.targets.targets.map((source) => {
      const eligibility = eligibilityByTarget.get(source.reviewTargetId),
        inherited = input.inherited.realizations.filter((row) =>
          row.targetIds.includes(source.reviewTargetId),
        ),
        finalBindingRequirement =
          eligibility?.finalBindingRequirement ?? source.unitBindingRequirement,
        finalProductEligibility =
          eligibility?.finalProductEligibility ?? source.productBindingEligible,
        classification = eligibility?.classification ?? "NOT_DEGENERATE",
        productOutcomeRole =
          eligibility?.productOutcomeRole ??
          (source.unitBindingRequirement === "UNIT_BINDING_NOT_APPLICABLE"
            ? "NON_SPEECH_AUDIT_TARGET"
            : "PRODUCT_CONTRACT_TARGET");
      return reviewTargets1452Schema.shape.targets.element.parse(
        hashed141({
          ...source,
          semanticHash: undefined,
          degenerateOrphanClassification: classification,
          productOutcomeRole,
          finalBindingRequirement,
          finalProductEligibility,
          inheritedRealizationV2Ids: inherited.map((row) => row.realizationId),
          productScorabilityRole: finalProductEligibility
            ? "PRODUCT_CONTRACT_INPUT"
            : classification === "DEGENERATE_ORPHAN_BOUNDARY_SLIVER"
              ? "AUDIT_ONLY_DEGENERATE_BOUNDARY_RESIDUE"
              : "NON_PRODUCT_REVIEW_EVIDENCE",
        }),
      );
    }),
    targets = reviewTargets1452Schema.parse(
      hashed141({
        ...input.targets,
        policyVersion: input.policy.policyVersion,
        policyHash: input.policy.semanticHash,
        artifactType: "machine-review-target-intervals-v9",
        targets: targetRows,
        eligibilityHash: input.eligibility.semanticHash,
        realizationV2Hash: input.inherited.semanticHash,
        semanticHash: undefined,
      }),
    ),
    targetById = new Map(
      targets.targets.map((row) => [row.reviewTargetId, row]),
    ),
    itemRows = input.items.items.map((source) => {
      const linked = source.reviewTargetIds.flatMap((id) => {
          const row = targetById.get(id);
          return row ? [row] : [];
        }),
        inherited = input.inherited.realizations.filter((row) =>
          row.targetIds.some((id) => source.reviewTargetIds.includes(id)),
        ),
        roles = unique(linked.map((row) => row.productOutcomeRole)),
        hasProductTarget = linked.some((row) => row.finalProductEligibility);
      return reviewItems1452Schema.shape.items.element.parse(
        hashed141({
          ...source,
          semanticHash: undefined,
          inheritedRealizationV2Ids: inherited.map((row) => row.realizationId),
          productOutcomeRoles: roles,
          productScorabilityStatus: hasProductTarget
            ? "DETERMINATE_EVALUATION_PENDING_GOLD"
            : "AUDIT_ONLY_NOT_A_PRODUCT_DENOMINATOR",
        }),
      );
    }),
    items = reviewItems1452Schema.parse(
      hashed141({
        ...input.items,
        policyVersion: input.policy.policyVersion,
        policyHash: input.policy.semanticHash,
        artifactType: "machine-review-items-v11",
        items: itemRows,
        eligibilityHash: input.eligibility.semanticHash,
        realizationV2Hash: input.inherited.semanticHash,
        semanticHash: undefined,
      }),
    ),
    audioById = new Map(input.audio.audio.map((row) => [row.audioId, row])),
    playbackSegmentsByAudio = new Map<string, ReviewPlayback1451["segments"]>();
  for (const segment of input.playback.segments) {
    const rows = playbackSegmentsByAudio.get(segment.audioId) ?? [];
    rows.push(segment);
    playbackSegmentsByAudio.set(segment.audioId, rows);
  }
  const regionRows = input.regions.regions.map((source) => {
      const inherited = input.inherited.realizations.filter((row) =>
          row.regionIds.includes(source.regionId),
        ),
        effective = input.effective.realizations.filter((row) =>
          row.regionIds.includes(source.regionId),
        ),
        witnesses = input.witnesses.groups.filter((row) =>
          row.regionIds.includes(source.regionId),
        ),
        regionAudioIds = new Set(
          input.audio.audio
            .filter((audio) => audio.regionIds.includes(source.regionId))
            .map((audio) => audio.audioId),
        ),
        chainIds = unique(
          input.playback.segments.flatMap((segment) => {
            const chain = playbackChainBySegment.get(segment.playbackSegmentId);
            return chain && regionAudioIds.has(segment.audioId) ? [chain] : [];
          }),
        );
      return reviewRegions1452Schema.shape.regions.element.parse(
        hashed141({
          ...source,
          semanticHash: undefined,
          inheritedRegionRealizationIds: inherited.map(
            (row) => row.realizationId,
          ),
          regionPlaybackChainIds: chainIds,
          effectiveRealizationIds: effective.map(
            (row) => row.effectiveRealizationId,
          ),
          productWitnessGroupIds: witnesses.map((row) => row.witnessGroupId),
        }),
      );
    }),
    regions = reviewRegions1452Schema.parse(
      hashed141({
        ...input.regions,
        policyVersion: input.policy.policyVersion,
        policyHash: input.policy.semanticHash,
        artifactType: "machine-review-regions-v10",
        regions: regionRows,
        realizationV2Hash: input.inherited.semanticHash,
        witnessGroupV2Hash: input.witnesses.semanticHash,
        semanticHash: undefined,
      }),
    ),
    audioRows = input.audio.audio.map((source) => {
      const inherited = input.inherited.realizations.filter((row) =>
          row.audioIds.includes(source.audioId),
        ),
        witnesses = input.witnesses.groups.filter((row) =>
          row.audioIds.includes(source.audioId),
        ),
        boundPlaybackSegmentIds = unique(
          playbackSegmentsByAudio
            .get(source.audioId)
            ?.map((row) => row.playbackSegmentId) ?? [],
        );
      return reviewAudio1452Schema.shape.audio.element.parse(
        hashed141({
          ...source,
          semanticHash: undefined,
          physicalAudioContainerInterval: source.nativeSourceInterval,
          inheritedRealizationV2Ids: inherited.map((row) => row.realizationId),
          productWitnessGroupIds: witnesses.map((row) => row.witnessGroupId),
          boundPlaybackSegmentIds,
        }),
      );
    }),
    audio = reviewAudio1452Schema.parse(
      hashed141({
        ...input.audio,
        policyVersion: input.policy.policyVersion,
        policyHash: input.policy.semanticHash,
        artifactType: "machine-review-audio-manifest-v10",
        audio: audioRows,
        realizationV2Hash: input.inherited.semanticHash,
        witnessGroupV2Hash: input.witnesses.semanticHash,
        semanticHash: undefined,
      }),
    ),
    playbackRows = input.playback.segments.map((source) => {
      const inherited = input.inherited.realizations.filter((row) =>
          row.playbackSegmentIds.includes(source.playbackSegmentId),
        ),
        effective = input.effective.realizations.filter((row) =>
          row.playbackSegmentIds.includes(source.playbackSegmentId),
        ),
        witnesses = input.witnesses.groups.filter((row) =>
          row.playbackSegmentIds.includes(source.playbackSegmentId),
        );
      return reviewPlayback1452Schema.shape.segments.element.parse(
        hashed141({
          ...source,
          semanticHash: undefined,
          playbackChainId:
            playbackChainBySegment.get(source.playbackSegmentId) ??
            `playback-chain-unbound-${source.playbackSegmentId}`,
          inheritedRealizationV2Ids: inherited.map((row) => row.realizationId),
          effectiveRealizationIds: effective.map(
            (row) => row.effectiveRealizationId,
          ),
          witnessGroupIds: witnesses.map((row) => row.witnessGroupId),
        }),
      );
    }),
    playback = reviewPlayback1452Schema.parse(
      hashed141({
        ...input.playback,
        policyVersion: input.policy.policyVersion,
        policyHash: input.policy.semanticHash,
        artifactType: "machine-review-playback-timeline-v9",
        segments: playbackRows,
        realizationV2Hash: input.inherited.semanticHash,
        witnessGroupV2Hash: input.witnesses.semanticHash,
        semanticHash: undefined,
      }),
    );

  for (const row of audio.audio)
    if (!audioById.has(row.audioId))
      throw new Error(`C6011452_AUDIO_PROJECTION_ID_DRIFT:${row.audioId}`);
  return { targets, items, regions, audio, playback };
}
