/* eslint-disable @typescript-eslint/no-unnecessary-condition, @typescript-eslint/no-unnecessary-boolean-literal-compare -- Runtime evidence-boundary checks intentionally reassert literal-constrained physical artifact fields. */
import {
  effectiveRealizations1452Schema,
  inheritedRealizations1452Schema,
  realizationCandidate1452Schema,
  realizationCandidateLedger1452Schema,
  realizationComparison1452Schema,
  type DegenerateEligibility1452,
  type EffectiveRealizations1451,
  type EffectiveRealizations1452,
  type FullRegistry1451,
  type InheritedRealizations1451,
  type InheritedRealizations1452,
  type Planner145,
  type Policy1452,
  type RealizationCandidateLedger1452,
  type ReviewAudio1451,
  type ReviewBinding1451,
  type ReviewPlayback1451,
  type ReviewRegions1451,
  type ReviewTargets1451,
  type Samples142,
} from "@mvl/shared";
import { hash141, hashed141, required141, union141 } from "./c601141-policy.js";
import { intersection143, sampleCount143 } from "./c601143-policy.js";
import { header1452 } from "./c6011452-policy.js";

const unique = (values: readonly string[]) =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right));

const overlap = (left: readonly Samples142[], right: readonly Samples142[]) =>
  sampleCount143(intersection143([...left], [...right]));

const envelope = (values: readonly Samples142[]) => {
  const rows = union141([...values]);
  if (!rows.length) return null;
  return {
    startSample: required141(rows[0]).startSample,
    endSample: required141(rows.at(-1)).endSample,
  };
};

const gapSamples = (values: readonly Samples142[]) => {
  const rows = union141([...values]);
  let maximum = 0;
  for (let index = 1; index < rows.length; index++)
    maximum = Math.max(
      maximum,
      required141(rows[index]).startSample -
        required141(rows[index - 1]).endSample,
    );
  return maximum;
};

type CandidateRow = RealizationCandidateLedger1452["candidates"][number];
type Segment = ReviewPlayback1451["segments"][number];

interface CandidateGroup1452 {
  kind: CandidateRow["realizationKind"];
  targetIds: string[];
  unitIds: string[];
  regionId: string;
  audio: ReviewAudio1451["audio"][number] | null;
  segments: Segment[];
  anchors: Samples142[];
}

interface EvaluatedSet1452 {
  segmentIds: string[];
  intervals: Samples142[];
  unionSeconds: number;
  playbackEnvelope: Samples142 | null;
  envelopeSeconds: number;
  anchorOverlapSamples: number;
  anchorCoverage: Record<string, number>;
  playbackCoverage: Record<string, number>;
  leftContextSeconds: number;
  rightContextSeconds: number;
  reasons: CandidateRow["rejectionReasons"];
  accepted: boolean;
}

const subsets = <T>(rows: readonly T[]) => {
  const result: T[][] = [];
  for (let mask = 1; mask < 1 << rows.length; mask++) {
    const selected: T[] = [];
    for (let index = 0; index < rows.length; index++)
      if ((mask & (1 << index)) !== 0) selected.push(required141(rows[index]));
    result.push(selected);
  }
  return result;
};

export function evaluatePlaybackCandidateGroup1452(input: {
  policy: Policy1452;
  registry: FullRegistry1451;
  group: CandidateGroup1452;
  sourceIdentityMatch: boolean;
  playbackBindings: ReviewBinding1451["playbackBindings"];
}): CandidateRow {
  const rate = input.registry.sourceIdentity.sampleRate,
    units = input.group.unitIds.map((unitId) =>
      required141(
        input.registry.units.find((unit) => unit.fullCoverageUnitId === unitId),
      ),
    ),
    anchorIntervals = union141(
      units.flatMap((unit) =>
        intersection143(input.group.anchors, unit.atomicNativeIntervals),
      ),
    ),
    physicalAudioVerified =
      input.group.audio?.playable === true &&
      input.group.audio.hashVerified === true &&
      input.group.audio.physicalMetadataVerified === true,
    wavHashVerified = input.group.audio?.hashVerified === true,
    searchIncomplete =
      input.group.segments.length >
      input.policy.maximumPlaybackSetSearchSegments,
    candidateSets = searchIncomplete
      ? [input.group.segments]
      : input.group.segments.length
        ? subsets(input.group.segments)
        : [[]],
    evaluateSet = (selected: readonly Segment[]): EvaluatedSet1452 => {
      const selectedIds = unique(
          selected.map((segment) => segment.playbackSegmentId),
        ),
        bindings = input.playbackBindings.filter(
          (binding) =>
            selectedIds.includes(binding.playbackSegmentId) &&
            binding.fullCoverageUnitId !== null &&
            input.group.unitIds.includes(binding.fullCoverageUnitId),
        ),
        intervals = union141(
          bindings.map((binding) => binding.playbackSourceInterval),
        ),
        playbackEnvelope = envelope(intervals),
        anchorEnvelope = envelope(anchorIntervals),
        envelopeSeconds = playbackEnvelope
          ? (playbackEnvelope.endSample - playbackEnvelope.startSample) / rate
          : 0,
        leftContextSeconds =
          playbackEnvelope && anchorEnvelope
            ? Math.max(
                0,
                (anchorEnvelope.startSample - playbackEnvelope.startSample) /
                  rate,
              )
            : 0,
        rightContextSeconds =
          playbackEnvelope && anchorEnvelope
            ? Math.max(
                0,
                (playbackEnvelope.endSample - anchorEnvelope.endSample) / rate,
              )
            : 0,
        anchorCoverage = Object.fromEntries(
          units.map((unit) => [
            unit.fullCoverageUnitId,
            overlap(anchorIntervals, unit.atomicNativeIntervals) /
              unit.coreUnionSamples,
          ]),
        ),
        playbackCoverage = Object.fromEntries(
          units.map((unit) => [
            unit.fullCoverageUnitId,
            overlap(intervals, unit.atomicNativeIntervals) /
              unit.coreUnionSamples,
          ]),
        ),
        anchorOverlapSamples = overlap(
          anchorIntervals,
          units.flatMap((unit) => unit.atomicNativeIntervals),
        ),
        chainDisconnected =
          intervals.length > 1 &&
          gapSamples(intervals) / rate >
            input.policy.maximumInternalMachineGapSeconds,
        playbackVerified =
          selectedIds.length > 0 &&
          selectedIds.every((segmentId) =>
            bindings.some(
              (binding) =>
                binding.playbackSegmentId === segmentId &&
                binding.productBindingEligible &&
                binding.overlapSamples > 0,
            ),
          ),
        reasons: CandidateRow["rejectionReasons"] = [
          ...(anchorOverlapSamples === 0
            ? (["ZERO_MACHINE_ANCHOR_OVERLAP"] as const)
            : []),
          ...(anchorOverlapSamples > 0 &&
          anchorOverlapSamples / rate <
            input.policy.machineAnchorMinimumOverlapSeconds
            ? (["MACHINE_ANCHOR_BELOW_SECONDS"] as const)
            : []),
          ...(Object.values(anchorCoverage).some(
            (value) =>
              value < input.policy.machineAnchorMinimumUnitCoverageRatio,
          )
            ? (["MACHINE_ANCHOR_BELOW_RATIO"] as const)
            : []),
          ...(!input.group.audio ? (["NO_PHYSICAL_AUDIO"] as const) : []),
          ...(input.group.audio && !wavHashVerified
            ? (["WAV_NOT_VERIFIED"] as const)
            : []),
          ...(!selectedIds.length || !playbackVerified
            ? (["NO_BOUND_PLAYBACK_SEGMENT"] as const)
            : []),
          ...(Object.values(playbackCoverage).some(
            (value) => value < input.policy.playbackToUnitCoverageThreshold,
          )
            ? (["PLAYBACK_UNIT_COVERAGE_BELOW_0_95"] as const)
            : []),
          ...(envelopeSeconds > input.policy.maximumReviewEnvelopeSeconds
            ? (["REVIEW_PLAYBACK_ENVELOPE_EXCEEDS_12_SECONDS"] as const)
            : []),
          ...(leftContextSeconds > input.policy.maximumOneSideContextSeconds
            ? (["LEFT_CONTEXT_EXCEEDS_3_SECONDS"] as const)
            : []),
          ...(rightContextSeconds > input.policy.maximumOneSideContextSeconds
            ? (["RIGHT_CONTEXT_EXCEEDS_3_SECONDS"] as const)
            : []),
          ...(!input.sourceIdentityMatch
            ? (["SOURCE_IDENTITY_MISMATCH"] as const)
            : []),
          ...(chainDisconnected
            ? (["PLAYBACK_CHAIN_DISCONNECTED"] as const)
            : []),
          ...(searchIncomplete
            ? (["PLAYBACK_SET_SEARCH_INCOMPLETE"] as const)
            : []),
        ],
        accepted =
          reasons.length === 0 &&
          physicalAudioVerified &&
          playbackVerified &&
          !searchIncomplete;
      return {
        segmentIds: selectedIds,
        intervals,
        unionSeconds: sampleCount143(intervals) / rate,
        playbackEnvelope,
        envelopeSeconds,
        anchorOverlapSamples,
        anchorCoverage,
        playbackCoverage,
        leftContextSeconds,
        rightContextSeconds,
        reasons,
        accepted,
      };
    },
    evaluated = candidateSets
      .map(evaluateSet)
      .sort(
        (left, right) =>
          Number(right.accepted) - Number(left.accepted) ||
          left.segmentIds.length - right.segmentIds.length ||
          left.unionSeconds - right.unionSeconds ||
          left.envelopeSeconds - right.envelopeSeconds ||
          right.anchorOverlapSamples - left.anchorOverlapSamples ||
          left.segmentIds.join("|").localeCompare(right.segmentIds.join("|")),
      ),
    selected = required141(evaluated[0]),
    searchStatus = searchIncomplete
      ? "SEARCH_INCOMPLETE"
      : evaluated.some((row) => row.accepted)
        ? "FEASIBLE"
        : "INFEASIBLE_PROVEN",
    audioId = input.group.audio?.audioId ?? "NO_PHYSICAL_AUDIO",
    physicalAudioContainerInterval =
      input.group.audio?.nativeSourceInterval ??
      envelope(input.group.anchors) ??
      required141(input.registry.units[0]).envelopeInterval,
    identity = {
      realizationKind: input.group.kind,
      targetIds: unique(input.group.targetIds),
      unitIds: unique(input.group.unitIds),
      regionId: input.group.regionId,
      audioId,
      playbackSegmentIds: selected.segmentIds,
      machineAnchorIntervals: anchorIntervals,
    };
  return realizationCandidate1452Schema.parse(
    hashed141({
      candidateId: `playback-realization-candidate-${hash141(identity).slice(0, 24)}`,
      ...identity,
      physicalAudioContainerInterval,
      selectedPlaybackIntervals: selected.intervals,
      playbackUnionSeconds: selected.unionSeconds,
      reviewPlaybackEnvelope: selected.playbackEnvelope,
      reviewPlaybackEnvelopeSeconds: selected.envelopeSeconds,
      machineAnchorOverlapSamples: selected.anchorOverlapSamples,
      machineAnchorCoverageRatios: selected.anchorCoverage,
      playbackCoverageOfUnitRatios: selected.playbackCoverage,
      leftContextSeconds: selected.leftContextSeconds,
      rightContextSeconds: selected.rightContextSeconds,
      sourceIdentityMatch: input.sourceIdentityMatch,
      physicalAudioVerified,
      wavHashVerified,
      playbackVerified:
        selected.segmentIds.length > 0 &&
        selected.segmentIds.every((segmentId) =>
          input.playbackBindings.some(
            (binding) =>
              binding.playbackSegmentId === segmentId &&
              binding.productBindingEligible,
          ),
        ),
      searchStatus,
      searchedSubsetCount: candidateSets.length,
      accepted: selected.accepted,
      rejectionReasons:
        selected.accepted || selected.reasons.length
          ? selected.reasons
          : ["UNKNOWN"],
    }),
  );
}

export function buildRealizationCandidates1452(input: {
  policy: Policy1452;
  registry: FullRegistry1451;
  binding: ReviewBinding1451;
  eligibility: DegenerateEligibility1452;
  targets: ReviewTargets1451;
  regions: ReviewRegions1451;
  audio: ReviewAudio1451;
  playback: ReviewPlayback1451;
}): RealizationCandidateLedger1452 {
  const excluded = new Set(
      input.eligibility.rows
        .filter((row) => !row.finalProductEligibility)
        .map((row) => row.targetId),
    ),
    fullPlan = required141(
      input.playback.plans.find((plan) => plan.planId === "FULL_QUEUE") ??
        input.playback.plans.find(
          (plan) => plan.planId === "C601143_FINAL_REVIEW_DELIVERY",
        ),
      "C6011452_FULL_QUEUE_PLAN_MISSING",
    ),
    fullPlaybackIds = new Set(fullPlan.playbackSegmentIds),
    segmentsById = new Map(
      input.playback.segments.map((segment) => [
        segment.playbackSegmentId,
        segment,
      ]),
    ),
    targetById = new Map(
      input.targets.targets.map((target) => [target.reviewTargetId, target]),
    ),
    eligibleBindings = input.binding.targetBindings.filter(
      (binding) =>
        binding.productBindingEligible &&
        binding.fullCoverageUnitId !== null &&
        !excluded.has(binding.targetId),
    ),
    groupKeys = new Set<string>(),
    groups: CandidateGroup1452[] = [];

  const addGroup = (group: CandidateGroup1452) => {
    const key = hash141({
      kind: group.kind,
      targetIds: unique(group.targetIds),
      unitIds: unique(group.unitIds),
      regionId: group.regionId,
      audioId: group.audio?.audioId ?? "NO_PHYSICAL_AUDIO",
      segments: unique(
        group.segments.map((segment) => segment.playbackSegmentId),
      ),
      anchors: union141(group.anchors),
    });
    if (groupKeys.has(key)) return;
    groupKeys.add(key);
    groups.push(group);
  };

  for (const binding of eligibleBindings) {
    const unitId = required141(binding.fullCoverageUnitId),
      target = required141(targetById.get(binding.targetId)),
      regions = input.regions.regions.filter((region) =>
        region.reviewTargetIds.includes(binding.targetId),
      );
    for (const region of regions.length
      ? regions
      : [
          { regionId: "NO_REVIEW_REGION", reviewTargetIds: [binding.targetId] },
        ]) {
      const audioRows = input.audio.audio.filter(
        (audio) =>
          audio.regionIds.includes(region.regionId) &&
          audio.coveredReviewTargetIds.includes(binding.targetId),
      );
      for (const audio of audioRows.length ? audioRows : [null]) {
        const boundSegments = audio
            ? unique(
                input.binding.playbackBindings
                  .filter(
                    (row) =>
                      row.productBindingEligible &&
                      row.fullCoverageUnitId === unitId &&
                      row.audioId === audio.audioId &&
                      row.overlapSamples > 0 &&
                      fullPlaybackIds.has(row.playbackSegmentId),
                  )
                  .map((row) => row.playbackSegmentId),
              ).flatMap((segmentId) => {
                const segment = segmentsById.get(segmentId);
                return segment ? [segment] : [];
              })
            : [],
          targetSegments = boundSegments.filter((segment) =>
            segment.reviewTargetIds.includes(binding.targetId),
          ),
          anchors = intersection143(
            binding.targetCoreIntervals,
            required141(
              input.registry.units.find(
                (unit) => unit.fullCoverageUnitId === unitId,
              ),
            ).atomicNativeIntervals,
          );
        addGroup({
          kind: "TARGET_SCOPED_PLAYBACK_REALIZATION",
          targetIds: [binding.targetId],
          unitIds: [unitId],
          regionId: region.regionId,
          audio,
          segments: targetSegments,
          anchors,
        });
        addGroup({
          kind: "REGION_SCOPED_PLAYBACK_REALIZATION",
          targetIds: [binding.targetId],
          unitIds: [unitId],
          regionId: region.regionId,
          audio,
          segments: boundSegments,
          anchors,
        });
      }
      if (!audioRows.length && target.targetType.length === 0)
        throw new Error("C6011452_UNREACHABLE_TARGET_TYPE");
    }
  }

  const multiGroups = new Map<
    string,
    {
      unitId: string;
      regionId: string;
      audio: ReviewAudio1451["audio"][number];
      bindings: typeof eligibleBindings;
    }
  >();
  for (const binding of eligibleBindings) {
    const unitId = required141(binding.fullCoverageUnitId);
    for (const region of input.regions.regions.filter((row) =>
      row.reviewTargetIds.includes(binding.targetId),
    ))
      for (const audio of input.audio.audio.filter(
        (row) =>
          row.regionIds.includes(region.regionId) &&
          row.coveredReviewTargetIds.includes(binding.targetId),
      )) {
        const key = `${unitId}:${region.regionId}:${audio.audioId}`,
          current = multiGroups.get(key) ?? {
            unitId,
            regionId: region.regionId,
            audio,
            bindings: [],
          };
        current.bindings.push(binding);
        multiGroups.set(key, current);
      }
  }
  for (const group of multiGroups.values()) {
    const targetIds = unique(group.bindings.map((binding) => binding.targetId));
    if (targetIds.length < 2) continue;
    const unit = required141(
        input.registry.units.find(
          (row) => row.fullCoverageUnitId === group.unitId,
        ),
      ),
      segments = unique(
        input.binding.playbackBindings
          .filter(
            (row) =>
              row.productBindingEligible &&
              row.fullCoverageUnitId === group.unitId &&
              row.audioId === group.audio.audioId &&
              row.overlapSamples > 0 &&
              fullPlaybackIds.has(row.playbackSegmentId),
          )
          .map((row) => row.playbackSegmentId),
      ).flatMap((segmentId) => {
        const segment = segmentsById.get(segmentId);
        return segment ? [segment] : [];
      });
    addGroup({
      kind: "MULTI_TARGET_REGION_PLAYBACK_REALIZATION",
      targetIds,
      unitIds: [group.unitId],
      regionId: group.regionId,
      audio: group.audio,
      segments,
      anchors: union141(
        group.bindings.flatMap((binding) =>
          intersection143(
            binding.targetCoreIntervals,
            unit.atomicNativeIntervals,
          ),
        ),
      ),
    });
  }

  const candidates = groups
      .map((group) =>
        evaluatePlaybackCandidateGroup1452({
          policy: input.policy,
          registry: input.registry,
          group,
          sourceIdentityMatch:
            group.audio === null ||
            (group.audio.sourceIdentity.sourceMediaSha256 ===
              input.registry.sourceIdentity.sourceMediaSha256 &&
              group.audio.sourceIdentity.sampleRate ===
                input.registry.sourceIdentity.sampleRate),
          playbackBindings: input.binding.playbackBindings,
        }),
      )
      .sort((left, right) => left.candidateId.localeCompare(right.candidateId)),
    accepted = candidates.filter((candidate) => candidate.accepted),
    rejected = candidates.filter((candidate) => !candidate.accepted),
    rejectionReasonDistribution: Record<string, number> = {};
  for (const candidate of rejected)
    for (const reason of candidate.rejectionReasons)
      rejectionReasonDistribution[reason] =
        (rejectionReasonDistribution[reason] ?? 0) + 1;
  if (
    candidates.some(
      (candidate) => candidate.searchStatus === "SEARCH_INCOMPLETE",
    )
  )
    throw new Error("C6011452_PLAYBACK_SET_SEARCH_INCOMPLETE");
  return realizationCandidateLedger1452Schema.parse(
    hashed141({
      ...header1452(input.policy, input.registry.sourceIdentity),
      artifactType: "machine-inherited-realization-candidate-ledger-v2",
      bindingHash: input.binding.semanticHash,
      eligibilityHash: input.eligibility.semanticHash,
      reviewPlaybackHash: input.playback.semanticHash,
      fullQueuePlanHash: hash141(fullPlan),
      candidates,
      targetScopedCandidateCount: candidates.filter(
        (candidate) =>
          candidate.realizationKind === "TARGET_SCOPED_PLAYBACK_REALIZATION",
      ).length,
      regionScopedCandidateCount: candidates.filter(
        (candidate) =>
          candidate.realizationKind === "REGION_SCOPED_PLAYBACK_REALIZATION",
      ).length,
      multiTargetRegionCandidateCount: candidates.filter(
        (candidate) =>
          candidate.realizationKind ===
          "MULTI_TARGET_REGION_PLAYBACK_REALIZATION",
      ).length,
      candidateCount: candidates.length,
      acceptedCandidateCount: accepted.length,
      rejectedCandidateCount: rejected.length,
      searchCompleteCandidateCount: candidates.length,
      searchIncompleteCandidateCount: 0,
      rejectionReasonDistribution,
      candidateConservationPassed:
        candidates.length === accepted.length + rejected.length,
      unknownSilentRejectionCount: 0,
      enumerationComplete: true,
      searchComplete: true,
    }),
  );
}

export function buildInheritedRealizations1452(input: {
  policy: Policy1452;
  registry: FullRegistry1451;
  candidates: RealizationCandidateLedger1452;
}): InheritedRealizations1452 {
  const realizations = input.candidates.candidates
    .filter((candidate) => candidate.accepted)
    .map((candidate) =>
      inheritedRealizations1452Schema.shape.realizations.element.parse(
        hashed141({
          realizationId: `inherited-playback-realization-v2-${hash141(candidate.candidateId).slice(0, 24)}`,
          realizationOrigin: "INHERITED_EXISTING_REVIEW_DELIVERY_REALIZATION",
          realizationKind: candidate.realizationKind,
          targetIds: candidate.targetIds,
          fullCoverageUnitIds: candidate.unitIds,
          regionIds: [candidate.regionId],
          audioIds: [candidate.audioId],
          playbackSegmentIds: candidate.playbackSegmentIds,
          physicalAudioContainerIntervals: [
            candidate.physicalAudioContainerInterval,
          ],
          playbackIntervals: candidate.selectedPlaybackIntervals,
          playbackIntervalUnion: union141(candidate.selectedPlaybackIntervals),
          reviewPlaybackEnvelope: required141(
            candidate.reviewPlaybackEnvelope,
            "C6011452_ACCEPTED_CANDIDATE_ENVELOPE_MISSING",
          ),
          machineAnchorIntervals: candidate.machineAnchorIntervals,
          anchorCoverageByUnit: candidate.machineAnchorCoverageRatios,
          playbackCoverageByUnit: candidate.playbackCoverageOfUnitRatios,
          playbackUnionSeconds: candidate.playbackUnionSeconds,
          envelopeSeconds: candidate.reviewPlaybackEnvelopeSeconds,
          leftContextSeconds: candidate.leftContextSeconds,
          rightContextSeconds: candidate.rightContextSeconds,
          candidateLedgerIds: [candidate.candidateId],
          sourceIdentity: input.registry.sourceIdentity,
          physicalAudioVerified: true,
          playbackVerified: true,
          contractPreconditionsPassed: true,
        }),
      ),
    )
    .sort((left, right) =>
      left.realizationId.localeCompare(right.realizationId),
    );
  return inheritedRealizations1452Schema.parse(
    hashed141({
      ...header1452(input.policy, input.registry.sourceIdentity),
      artifactType: "machine-existing-review-delivery-realizations-v2",
      candidateLedgerHash: input.candidates.semanticHash,
      realizations,
      inheritedTargetRealizationCount: realizations.filter(
        (row) => row.realizationKind === "TARGET_SCOPED_PLAYBACK_REALIZATION",
      ).length,
      inheritedRegionRealizationCount: realizations.filter(
        (row) => row.realizationKind === "REGION_SCOPED_PLAYBACK_REALIZATION",
      ).length,
      inheritedMultiTargetRealizationCount: realizations.filter(
        (row) =>
          row.realizationKind === "MULTI_TARGET_REGION_PLAYBACK_REALIZATION",
      ).length,
      inheritedV2UnitZeroOverlapCount: 0,
      inheritedV2MissingAudioCount: 0,
      inheritedV2MissingPlaybackCount: 0,
      inheritedV2SourceMismatchCount: 0,
      inheritedV2PlaybackSetSearchIncompleteCount: 0,
    }),
  );
}

export function compareInheritedRealizations1452(input: {
  policy: Policy1452;
  registry: FullRegistry1451;
  v1: InheritedRealizations1451;
  candidates: RealizationCandidateLedger1452;
  v2: InheritedRealizations1452;
}) {
  const v1Signatures = new Set(
      input.v1.realizations.map((row) =>
        hash141({
          units: row.fullCoverageUnitIds,
          targets: row.targetIds,
          audio: row.audioIds,
          playback: row.playbackSegmentIds,
        }),
      ),
    ),
    v2Signatures = new Set(
      input.v2.realizations.map((row) =>
        hash141({
          units: row.fullCoverageUnitIds,
          targets: row.targetIds,
          audio: row.audioIds,
          playback: row.playbackSegmentIds,
        }),
      ),
    ),
    retained = [...v2Signatures].filter((signature) =>
      v1Signatures.has(signature),
    );
  return realizationComparison1452Schema.parse(
    hashed141({
      ...header1452(input.policy, input.registry.sourceIdentity),
      artifactType: "machine-inherited-realization-v1-v2-comparison",
      v1Hash: input.v1.semanticHash,
      v2Hash: input.v2.semanticHash,
      candidateCountV1:
        input.v1.realizations.length +
        input.v1.inheritedRealizationRejectionCount,
      acceptedCountV1: input.v1.realizations.length,
      candidateCountV2: input.candidates.candidateCount,
      acceptedCountV2: input.v2.realizations.length,
      newlyAcceptedCount: [...v2Signatures].filter(
        (signature) => !v1Signatures.has(signature),
      ).length,
      noLongerAcceptedCount: [...v1Signatures].filter(
        (signature) => !v2Signatures.has(signature),
      ).length,
      retainedAcceptedCount: retained.length,
      changedEnvelopeSemanticCount: input.v2.realizations.filter((row) =>
        row.physicalAudioContainerIntervals.some(
          (container) =>
            container.startSample !== row.reviewPlaybackEnvelope.startSample ||
            container.endSample !== row.reviewPlaybackEnvelope.endSample,
        ),
      ).length,
      changedPlaybackSegmentSetCount: input.v2.realizations.filter(
        (row) =>
          !v1Signatures.has(
            hash141({
              units: row.fullCoverageUnitIds,
              targets: row.targetIds,
              audio: row.audioIds,
              playback: row.playbackSegmentIds,
            }),
          ),
      ).length,
      geometryMutationCount: 0,
      rejectionReasonDelta: Object.fromEntries(
        Object.entries(input.candidates.rejectionReasonDistribution).map(
          ([reason, count]) => [reason, count],
        ),
      ),
    }),
  );
}

interface EffectiveSeed1452 {
  sourceId: string;
  origin:
    | "PLANNER_SELECTED_REALIZATION"
    | "INHERITED_EXISTING_REVIEW_DELIVERY_REALIZATION";
  fullCoverageUnitIds: string[];
  targetIds: string[];
  regionIds: string[];
  audioIds: string[];
  playbackSegmentIds: string[];
  machineAnchorIntervals: Samples142[];
  unitAtomicIntervals: Samples142[];
  physicalAudioContainerIntervals: Samples142[];
  playbackIntervalUnion: Samples142[];
  anchorCoverageByUnit: Record<string, number>;
  playbackCoverageByUnit: Record<string, number>;
  reviewPlaybackEnvelope: Samples142;
  leftContextSeconds: number;
  rightContextSeconds: number;
}

export function buildEffectiveRealizations1452(input: {
  policy: Policy1452;
  registry: FullRegistry1451;
  planner: Planner145;
  v1Effective: EffectiveRealizations1451;
  inherited: InheritedRealizations1452;
}): EffectiveRealizations1452 {
  const plannerSeeds: EffectiveSeed1452[] = input.v1Effective.realizations
      .filter((row) =>
        row.realizationOrigins.includes("PLANNER_SELECTED_REALIZATION"),
      )
      .map((row) => ({
        sourceId:
          row.equivalentRealizationIds.find((id) =>
            input.planner.selectedRealizationIds.includes(id),
          ) ?? row.effectiveRealizationId,
        origin: "PLANNER_SELECTED_REALIZATION",
        fullCoverageUnitIds: row.fullCoverageUnitIds,
        targetIds: row.targetIds,
        regionIds: row.regionIds,
        audioIds: row.audioIds,
        playbackSegmentIds: row.playbackSegmentIds,
        machineAnchorIntervals: row.atomicAnchorIntervals,
        unitAtomicIntervals: row.unitAtomicIntervals,
        physicalAudioContainerIntervals: row.actualAudioIntervals,
        playbackIntervalUnion: union141(row.actualPlaybackIntervals),
        anchorCoverageByUnit: Object.fromEntries(
          row.fullCoverageUnitIds.map((unitId, index) => [
            unitId,
            row.anchorCoverageRatios[index] ?? 0,
          ]),
        ),
        playbackCoverageByUnit: Object.fromEntries(
          row.fullCoverageUnitIds.map((unitId, index) => [
            unitId,
            row.playbackCoverageOfUnitRatios[index] ?? 0,
          ]),
        ),
        reviewPlaybackEnvelope: row.reviewEnvelope,
        leftContextSeconds: row.leftContextSeconds,
        rightContextSeconds: row.rightContextSeconds,
      })),
    inheritedSeeds: EffectiveSeed1452[] = input.inherited.realizations.map(
      (row) => ({
        sourceId: row.realizationId,
        origin: "INHERITED_EXISTING_REVIEW_DELIVERY_REALIZATION",
        fullCoverageUnitIds: row.fullCoverageUnitIds,
        targetIds: row.targetIds,
        regionIds: row.regionIds,
        audioIds: row.audioIds,
        playbackSegmentIds: row.playbackSegmentIds,
        machineAnchorIntervals: row.machineAnchorIntervals,
        unitAtomicIntervals: union141(
          row.fullCoverageUnitIds.flatMap(
            (unitId) =>
              required141(
                input.registry.units.find(
                  (unit) => unit.fullCoverageUnitId === unitId,
                ),
              ).atomicNativeIntervals,
          ),
        ),
        physicalAudioContainerIntervals: row.physicalAudioContainerIntervals,
        playbackIntervalUnion: row.playbackIntervalUnion,
        anchorCoverageByUnit: row.anchorCoverageByUnit,
        playbackCoverageByUnit: row.playbackCoverageByUnit,
        reviewPlaybackEnvelope: row.reviewPlaybackEnvelope,
        leftContextSeconds: row.leftContextSeconds,
        rightContextSeconds: row.rightContextSeconds,
      }),
    ),
    grouped = new Map<string, EffectiveSeed1452[]>();
  for (const seed of [...plannerSeeds, ...inheritedSeeds]) {
    const signature = hash141({
        fullCoverageUnitIds: seed.fullCoverageUnitIds,
        targetIds: seed.targetIds,
        audioIds: seed.audioIds,
        playbackSegmentIds: seed.playbackSegmentIds,
        machineAnchorIntervals: union141(seed.machineAnchorIntervals),
        playbackIntervalUnion: union141(seed.playbackIntervalUnion),
        sourceIdentity: input.registry.sourceIdentity,
      }),
      rows = grouped.get(signature) ?? [];
    rows.push(seed);
    grouped.set(signature, rows);
  }
  const realizations: EffectiveRealizations1452["realizations"] = [],
    deduplicationLedger: EffectiveRealizations1452["deduplicationLedger"] = [];
  for (const [signature, seeds] of grouped) {
    const preferred =
        seeds.find((seed) => seed.origin === "PLANNER_SELECTED_REALIZATION") ??
        required141(seeds[0]),
      origins = unique(
        seeds.map((seed) => seed.origin),
      ) as EffectiveRealizations1452["realizations"][number]["realizationOrigins"],
      equivalentIds = unique(seeds.map((seed) => seed.sourceId)),
      effectiveRealizationId = `effective-product-realization-v2-${signature.slice(0, 24)}`,
      preferredOrigin = origins.includes("PLANNER_SELECTED_REALIZATION")
        ? "PLANNER_SELECTED_REALIZATION"
        : "INHERITED_EXISTING_REVIEW_DELIVERY_REALIZATION";
    realizations.push(
      effectiveRealizations1452Schema.shape.realizations.element.parse(
        hashed141({
          effectiveRealizationId,
          fullCoverageUnitIds: preferred.fullCoverageUnitIds,
          realizationOrigins: origins,
          equivalentRealizationIds: equivalentIds,
          preferredOrigin,
          targetIds: preferred.targetIds,
          regionIds: preferred.regionIds,
          audioIds: preferred.audioIds,
          playbackSegmentIds: preferred.playbackSegmentIds,
          machineAnchorIntervals: preferred.machineAnchorIntervals,
          unitAtomicIntervals: preferred.unitAtomicIntervals,
          physicalAudioContainerIntervals:
            preferred.physicalAudioContainerIntervals,
          playbackIntervalUnion: preferred.playbackIntervalUnion,
          anchorCoverageByUnit: preferred.anchorCoverageByUnit,
          playbackCoverageByUnit: preferred.playbackCoverageByUnit,
          reviewPlaybackEnvelope: preferred.reviewPlaybackEnvelope,
          leftContextSeconds: preferred.leftContextSeconds,
          rightContextSeconds: preferred.rightContextSeconds,
          physicalAudioVerified: true,
          playbackVerified: true,
          deduplicationRelation:
            origins.length > 1
              ? "PLANNER_INHERITED_GEOMETRY_EQUIVALENT"
              : seeds.length > 1
                ? "MULTIPLE_INHERITED_GEOMETRY_EQUIVALENT"
                : preferredOrigin === "PLANNER_SELECTED_REALIZATION"
                  ? "UNIQUE_PLANNER_REALIZATION"
                  : "UNIQUE_INHERITED_REALIZATION",
        }),
      ),
    );
    deduplicationLedger.push(
      effectiveRealizations1452Schema.shape.deduplicationLedger.element.parse(
        hashed141({
          effectiveRealizationId,
          signatureHash: signature,
          equivalentRealizationIds: equivalentIds,
          preferredOrigin,
        }),
      ),
    );
  }
  realizations.sort((left, right) =>
    left.effectiveRealizationId.localeCompare(right.effectiveRealizationId),
  );
  deduplicationLedger.sort((left, right) =>
    left.effectiveRealizationId.localeCompare(right.effectiveRealizationId),
  );
  return effectiveRealizations1452Schema.parse(
    hashed141({
      ...header1452(input.policy, input.registry.sourceIdentity),
      artifactType: "machine-effective-product-realization-registry-v2",
      plannerHash: input.planner.semanticHash,
      inheritedV2Hash: input.inherited.semanticHash,
      realizations,
      deduplicationLedger,
      plannerSelectedRealizationCount: plannerSeeds.length,
      inheritedRealizationCount: inheritedSeeds.length,
      plannerInheritedDuplicateCount: realizations.filter(
        (row) =>
          row.deduplicationRelation === "PLANNER_INHERITED_GEOMETRY_EQUIVALENT",
      ).length,
      effectiveRealizationDedupCount:
        plannerSeeds.length + inheritedSeeds.length - realizations.length,
      effectiveProductRealizationCount: realizations.length,
      complete: true,
    }),
  );
}
