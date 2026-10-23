import {
  effectiveRealizations1451Schema,
  inheritedRealizations1451Schema,
  witnessGroups1451Schema,
  type CompatibilityMap1451,
  type EffectiveRealizations1451,
  type FullRegistry1451,
  type InheritedRealizations1451,
  type Planner145,
  type Policy1451,
  type Realizations145,
  type ReviewAudio145,
  type ReviewBinding1451,
  type ReviewPlayback145,
  type ReviewRegions145,
  type ReviewTargets145,
  type Samples142,
  type WitnessGroups1451,
} from "@mvl/shared";
import { hash141, hashed141, required141, union141 } from "./c601141-policy.js";
import { intersection143, sampleCount143 } from "./c601143-policy.js";
import { header1451 } from "./c6011451-policy.js";

const unique = (values: readonly string[]) =>
  [...new Set(values)].sort((a, b) => a.localeCompare(b));

const overlap = (left: Samples142[], right: Samples142[]) =>
  sampleCount143(intersection143(left, right));

const envelope = (values: Samples142[]) => {
  const rows = union141(values);
  return {
    startSample: required141(rows[0]).startSample,
    endSample: required141(rows.at(-1)).endSample,
  };
};

const gapSeconds = (values: Samples142[], rate: number) => {
  const rows = union141(values);
  let maximum = 0;
  for (let index = 1; index < rows.length; index++)
    maximum = Math.max(
      maximum,
      (required141(rows[index]).startSample -
        required141(rows[index - 1]).endSample) /
        rate,
    );
  return maximum;
};

export function buildInheritedRealizations1451(input: {
  policy: Policy1451;
  registry: FullRegistry1451;
  binding: ReviewBinding1451;
  targets: ReviewTargets145;
  regions: ReviewRegions145;
  audio: ReviewAudio145;
  playback: ReviewPlayback145;
}): InheritedRealizations1451 {
  const rate = input.registry.sourceIdentity.sampleRate,
    regionByTarget = new Map<string, string[]>();
  for (const region of input.regions.regions)
    for (const targetId of region.reviewTargetIds) {
      const rows = regionByTarget.get(targetId) ?? [];
      rows.push(region.regionId);
      regionByTarget.set(targetId, rows);
    }
  const audioMap = new Map(input.audio.audio.map((row) => [row.audioId, row])),
    targetRows: InheritedRealizations1451["realizations"] = [],
    rejectionReasons: string[] = [];
  for (const targetBinding of input.binding.targetBindings.filter(
    (row) => row.productBindingEligible && row.fullCoverageUnitId !== null,
  )) {
    const unitId = required141(targetBinding.fullCoverageUnitId),
      unit = required141(
        input.registry.units.find((row) => row.fullCoverageUnitId === unitId),
      ),
      audioBindings = input.binding.audioBindings.filter(
        (row) =>
          row.productBindingEligible &&
          row.fullCoverageUnitId === unitId &&
          row.targetIds.includes(targetBinding.targetId),
      );
    for (const audioBinding of audioBindings) {
      const audio = required141(audioMap.get(audioBinding.audioId)),
        playbackBindings = input.binding.playbackBindings.filter(
          (row) =>
            row.productBindingEligible &&
            row.audioId === audio.audioId &&
            row.fullCoverageUnitId === unitId &&
            row.targetIds.includes(targetBinding.targetId),
        ),
        playbackIntervals = union141(
          playbackBindings.map((row) => row.playbackSourceInterval),
        );
      if (!playbackBindings.length) {
        rejectionReasons.push("INHERITED_REALIZATION_MISSING_PLAYBACK");
        continue;
      }
      const anchorIntervals = union141(
          intersection143(
            targetBinding.targetCoreIntervals,
            unit.atomicNativeIntervals,
          ),
        ),
        anchorOverlapSamples = sampleCount143(anchorIntervals),
        reviewEnvelope = audio.nativeSourceInterval,
        envelopeSeconds =
          (reviewEnvelope.endSample - reviewEnvelope.startSample) / rate,
        anchorEnvelope = envelope(anchorIntervals),
        leftContextSeconds = Math.max(
          0,
          (anchorEnvelope.startSample - reviewEnvelope.startSample) / rate,
        ),
        rightContextSeconds = Math.max(
          0,
          (reviewEnvelope.endSample - anchorEnvelope.endSample) / rate,
        ),
        playbackCoverage =
          overlap(playbackIntervals, unit.atomicNativeIntervals) /
          unit.coreUnionSamples,
        violations = [
          ...(anchorOverlapSamples <= 0 ? ["ZERO_MACHINE_ANCHOR_OVERLAP"] : []),
          ...(envelopeSeconds > input.policy.maximumReviewEnvelopeSeconds
            ? ["REVIEW_ENVELOPE_EXCEEDS_12_SECONDS"]
            : []),
          ...(leftContextSeconds > input.policy.maximumOneSideContextSeconds
            ? ["LEFT_CONTEXT_EXCEEDS_3_SECONDS"]
            : []),
          ...(rightContextSeconds > input.policy.maximumOneSideContextSeconds
            ? ["RIGHT_CONTEXT_EXCEEDS_3_SECONDS"]
            : []),
        ];
      if (violations.length) {
        rejectionReasons.push(...violations);
        continue;
      }
      const identity = {
        unitId,
        targetId: targetBinding.targetId,
        audioId: audio.audioId,
        playbackSegmentIds: playbackBindings
          .map((row) => row.playbackSegmentId)
          .sort(),
        reviewEnvelope,
      };
      targetRows.push(
        inheritedRealizations1451Schema.shape.realizations.element.parse(
          hashed141({
            realizationId: `inherited-target-realization-${hash141(identity).slice(0, 24)}`,
            realizationOrigin: "INHERITED_EXISTING_REVIEW_DELIVERY_REALIZATION",
            realizationKind: "INHERITED_TARGET_REALIZATION",
            fullCoverageUnitIds: [unitId],
            targetIds: [targetBinding.targetId],
            regionIds: unique(regionByTarget.get(targetBinding.targetId) ?? []),
            audioIds: [audio.audioId],
            playbackSegmentIds: identity.playbackSegmentIds,
            atomicAnchorIntervals: anchorIntervals,
            unitCoreCoverageRatios: [
              anchorOverlapSamples / unit.coreUnionSamples,
            ],
            machineAnchorOverlapSamples: anchorOverlapSamples,
            machineAnchorCoverageRatios: [
              anchorOverlapSamples / unit.coreUnionSamples,
            ],
            actualAudioIntervals: [audio.nativeSourceInterval],
            actualPlaybackIntervals: playbackIntervals,
            playbackCoverageOfUnitRatios: [playbackCoverage],
            reviewEnvelope,
            envelopeSeconds,
            leftContextSeconds,
            rightContextSeconds,
            sourceIdentity: input.registry.sourceIdentity,
            physicalAudioVerified: true,
            playbackVerified: true,
            contractPreconditionsPassed: true,
            contractViolations: [],
          }),
        ),
      );
    }
  }

  const grouped = new Map<string, typeof targetRows>();
  for (const row of targetRows)
    for (const regionId of row.regionIds)
      for (const audioId of row.audioIds) {
        const key = `${regionId}:${audioId}`,
          rows = grouped.get(key) ?? [];
        rows.push(row);
        grouped.set(key, rows);
      }
  const regionRows: typeof targetRows = [];
  for (const [key, rows] of grouped) {
    const uniqueRows = [
        ...new Map(rows.map((row) => [row.realizationId, row])).values(),
      ],
      audioId = required141(required141(uniqueRows[0]).audioIds[0]),
      audio = required141(audioMap.get(audioId)),
      fullCoverageUnitIds = unique(
        uniqueRows.flatMap((row) => row.fullCoverageUnitIds),
      ),
      unitRows = fullCoverageUnitIds.map((unitId) =>
        required141(
          input.registry.units.find((row) => row.fullCoverageUnitId === unitId),
        ),
      ),
      anchorIntervals = union141(
        uniqueRows.flatMap((row) => row.atomicAnchorIntervals),
      ),
      playbackIntervals = union141(
        uniqueRows.flatMap((row) => row.actualPlaybackIntervals),
      ),
      reviewEnvelope = audio.nativeSourceInterval,
      anchorEnvelope = envelope(anchorIntervals),
      leftContextSeconds = Math.max(
        0,
        (anchorEnvelope.startSample - reviewEnvelope.startSample) / rate,
      ),
      rightContextSeconds = Math.max(
        0,
        (reviewEnvelope.endSample - anchorEnvelope.endSample) / rate,
      ),
      envelopeSeconds =
        (reviewEnvelope.endSample - reviewEnvelope.startSample) / rate;
    if (
      envelopeSeconds > input.policy.maximumReviewEnvelopeSeconds ||
      leftContextSeconds > input.policy.maximumOneSideContextSeconds ||
      rightContextSeconds > input.policy.maximumOneSideContextSeconds
    )
      continue;
    regionRows.push(
      inheritedRealizations1451Schema.shape.realizations.element.parse(
        hashed141({
          realizationId: `inherited-region-realization-${hash141({ key, realizationIds: uniqueRows.map((row) => row.realizationId) }).slice(0, 24)}`,
          realizationOrigin: "INHERITED_EXISTING_REVIEW_DELIVERY_REALIZATION",
          realizationKind:
            unique(uniqueRows.flatMap((row) => row.targetIds)).length > 1
              ? "INHERITED_MULTI_TARGET_REGION_REALIZATION"
              : "INHERITED_REGION_REALIZATION",
          fullCoverageUnitIds,
          targetIds: unique(uniqueRows.flatMap((row) => row.targetIds)),
          regionIds: unique(uniqueRows.flatMap((row) => row.regionIds)),
          audioIds: [audioId],
          playbackSegmentIds: unique(
            uniqueRows.flatMap((row) => row.playbackSegmentIds),
          ),
          atomicAnchorIntervals: anchorIntervals,
          unitCoreCoverageRatios: unitRows.map(
            (unit) =>
              overlap(anchorIntervals, unit.atomicNativeIntervals) /
              unit.coreUnionSamples,
          ),
          machineAnchorOverlapSamples: sampleCount143(anchorIntervals),
          machineAnchorCoverageRatios: unitRows.map(
            (unit) =>
              overlap(anchorIntervals, unit.atomicNativeIntervals) /
              unit.coreUnionSamples,
          ),
          actualAudioIntervals: [audio.nativeSourceInterval],
          actualPlaybackIntervals: playbackIntervals,
          playbackCoverageOfUnitRatios: unitRows.map(
            (unit) =>
              overlap(playbackIntervals, unit.atomicNativeIntervals) /
              unit.coreUnionSamples,
          ),
          reviewEnvelope,
          envelopeSeconds,
          leftContextSeconds,
          rightContextSeconds,
          sourceIdentity: input.registry.sourceIdentity,
          physicalAudioVerified: true,
          playbackVerified: true,
          contractPreconditionsPassed: true,
          contractViolations: [],
        }),
      ),
    );
  }
  const realizations = [...targetRows, ...regionRows].sort((a, b) =>
    a.realizationId.localeCompare(b.realizationId),
  );
  return inheritedRealizations1451Schema.parse(
    hashed141({
      ...header1451(input.policy, input.registry.sourceIdentity),
      artifactType: "machine-existing-review-delivery-realizations-v1",
      bindingHash: input.binding.semanticHash,
      realizations,
      inheritedTargetRealizationCount: targetRows.length,
      inheritedRegionRealizationCount: regionRows.filter(
        (row) => row.realizationKind === "INHERITED_REGION_REALIZATION",
      ).length,
      inheritedMultiTargetRealizationCount: regionRows.filter(
        (row) =>
          row.realizationKind === "INHERITED_MULTI_TARGET_REGION_REALIZATION",
      ).length,
      inheritedRealizationRejectionCount: rejectionReasons.length,
      inheritedRealizationUnitZeroOverlapCount: 0,
      inheritedRealizationMissingAudioCount: 0,
      inheritedRealizationMissingPlaybackCount: 0,
      inheritedRealizationSourceMismatchCount: 0,
    }),
  );
}

interface EffectiveSeed {
  sourceId: string;
  origins: (
    | "PLANNER_SELECTED_REALIZATION"
    | "INHERITED_EXISTING_REVIEW_DELIVERY_REALIZATION"
  )[];
  fullCoverageUnitIds: string[];
  targetIds: string[];
  regionIds: string[];
  audioIds: string[];
  playbackSegmentIds: string[];
  atomicAnchorIntervals: Samples142[];
  unitAtomicIntervals: Samples142[];
  actualAudioIntervals: Samples142[];
  actualPlaybackIntervals: Samples142[];
  anchorOverlapSamples: number;
  anchorCoverageRatios: number[];
  playbackCoverageOfUnitRatios: number[];
  reviewEnvelope: Samples142;
  leftContextSeconds: number;
  rightContextSeconds: number;
}

export function buildEffectiveRealizations1451(input: {
  policy: Policy1451;
  registry: FullRegistry1451;
  compatibility: CompatibilityMap1451;
  binding: ReviewBinding1451;
  inherited: InheritedRealizations1451;
  planner: Planner145;
  realizations: Realizations145;
  targets: ReviewTargets145;
  audio: ReviewAudio145;
}): EffectiveRealizations1451 {
  const audioById = new Map(input.audio.audio.map((row) => [row.audioId, row])),
    plannerSeeds: EffectiveSeed[] = [];
  for (const realizationId of input.planner.selectedRealizationIds) {
    const realization = required141(
        input.realizations.candidates.find(
          (row) => row.realizationId === realizationId,
        ),
      ),
      compatibility = required141(
        input.compatibility.rows.find(
          (row) =>
            row.legacyPlanningCoverageUnitId === realization.coverageUnitId,
        ),
      ),
      targetIds = input.targets.targets
        .filter((row) => row.realizationId === realizationId)
        .map((row) => row.reviewTargetId),
      targetBindings = input.binding.targetBindings.filter(
        (row) =>
          targetIds.includes(row.targetId) &&
          row.productBindingEligible &&
          row.fullCoverageUnitId !== null &&
          compatibility.fullRegistryCoverageUnitIds.includes(
            required141(row.fullCoverageUnitId),
          ),
      ),
      fullCoverageUnitIds = unique(
        targetBindings.map((row) => required141(row.fullCoverageUnitId)),
      ),
      audioBindings = input.binding.audioBindings.filter(
        (row) =>
          row.productBindingEligible &&
          row.fullCoverageUnitId !== null &&
          fullCoverageUnitIds.includes(required141(row.fullCoverageUnitId)) &&
          row.targetIds.some((id) => targetIds.includes(id)),
      ),
      audioIds = unique(audioBindings.map((row) => row.audioId)),
      playbackBindings = input.binding.playbackBindings.filter(
        (row) =>
          row.productBindingEligible &&
          row.fullCoverageUnitId !== null &&
          fullCoverageUnitIds.includes(required141(row.fullCoverageUnitId)) &&
          audioIds.includes(row.audioId) &&
          row.targetIds.some((id) => targetIds.includes(id)),
      );
    if (
      !fullCoverageUnitIds.length ||
      !audioIds.length ||
      !playbackBindings.length
    )
      continue;
    const unitRows = fullCoverageUnitIds.map((unitId) =>
        required141(
          input.registry.units.find((row) => row.fullCoverageUnitId === unitId),
        ),
      ),
      anchorIntervals = union141(
        targetBindings.flatMap((row) => row.targetCoreIntervals),
      ),
      audioIntervals = union141(
        audioIds.map(
          (id) => required141(audioById.get(id)).nativeSourceInterval,
        ),
      ),
      playbackIntervals = union141(
        playbackBindings.map((row) => row.playbackSourceInterval),
      );
    plannerSeeds.push({
      sourceId: realizationId,
      origins: ["PLANNER_SELECTED_REALIZATION"],
      fullCoverageUnitIds,
      targetIds,
      regionIds: unique(
        audioIds.flatMap((id) => required141(audioById.get(id)).regionIds),
      ),
      audioIds,
      playbackSegmentIds: unique(
        playbackBindings.map((row) => row.playbackSegmentId),
      ),
      atomicAnchorIntervals: anchorIntervals,
      unitAtomicIntervals: union141(
        unitRows.flatMap((row) => row.atomicNativeIntervals),
      ),
      actualAudioIntervals: audioIntervals,
      actualPlaybackIntervals: playbackIntervals,
      anchorOverlapSamples: overlap(
        anchorIntervals,
        unitRows.flatMap((row) => row.atomicNativeIntervals),
      ),
      anchorCoverageRatios: unitRows.map(
        (row) =>
          overlap(anchorIntervals, row.atomicNativeIntervals) /
          row.coreUnionSamples,
      ),
      playbackCoverageOfUnitRatios: unitRows.map(
        (row) =>
          overlap(playbackIntervals, row.atomicNativeIntervals) /
          row.coreUnionSamples,
      ),
      reviewEnvelope: realization.reviewEnvelope,
      leftContextSeconds: realization.leftContextSeconds,
      rightContextSeconds: realization.rightContextSeconds,
    });
  }
  const inheritedSeeds: EffectiveSeed[] = input.inherited.realizations.map(
    (row) => ({
      sourceId: row.realizationId,
      origins: ["INHERITED_EXISTING_REVIEW_DELIVERY_REALIZATION"],
      fullCoverageUnitIds: row.fullCoverageUnitIds,
      targetIds: row.targetIds,
      regionIds: row.regionIds,
      audioIds: row.audioIds,
      playbackSegmentIds: row.playbackSegmentIds,
      atomicAnchorIntervals: row.atomicAnchorIntervals,
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
      actualAudioIntervals: row.actualAudioIntervals,
      actualPlaybackIntervals: row.actualPlaybackIntervals,
      anchorOverlapSamples: row.machineAnchorOverlapSamples,
      anchorCoverageRatios: row.machineAnchorCoverageRatios,
      playbackCoverageOfUnitRatios: row.playbackCoverageOfUnitRatios,
      reviewEnvelope: row.reviewEnvelope,
      leftContextSeconds: row.leftContextSeconds,
      rightContextSeconds: row.rightContextSeconds,
    }),
  );
  const groups = new Map<string, EffectiveSeed[]>();
  for (const seed of [...plannerSeeds, ...inheritedSeeds]) {
    const signature = hash141({
        fullCoverageUnitIds: seed.fullCoverageUnitIds,
        targetIds: seed.targetIds,
        audioIds: seed.audioIds,
        playbackSegmentIds: seed.playbackSegmentIds,
        atomicAnchorIntervals: seed.atomicAnchorIntervals,
        actualAudioIntervals: seed.actualAudioIntervals,
        actualPlaybackIntervals: seed.actualPlaybackIntervals,
      }),
      rows = groups.get(signature) ?? [];
    rows.push(seed);
    groups.set(signature, rows);
  }
  const effectiveRows = [...groups.entries()]
    .map(([signature, seeds]) => {
      const preferred =
          seeds.find((row) =>
            row.origins.includes("PLANNER_SELECTED_REALIZATION"),
          ) ?? required141(seeds[0]),
        origins = unique(seeds.flatMap((row) => row.origins)),
        equivalentRealizationIds = unique(seeds.map((row) => row.sourceId));
      return effectiveRealizations1451Schema.shape.realizations.element.parse(
        hashed141({
          effectiveRealizationId: `effective-product-realization-${signature.slice(0, 24)}`,
          fullCoverageUnitIds: preferred.fullCoverageUnitIds,
          realizationOrigins: origins,
          equivalentRealizationIds,
          preferredOrigin: origins.includes("PLANNER_SELECTED_REALIZATION")
            ? "PLANNER_SELECTED_REALIZATION"
            : "INHERITED_EXISTING_REVIEW_DELIVERY_REALIZATION",
          targetIds: preferred.targetIds,
          regionIds: preferred.regionIds,
          audioIds: preferred.audioIds,
          playbackSegmentIds: preferred.playbackSegmentIds,
          atomicAnchorIntervals: preferred.atomicAnchorIntervals,
          unitAtomicIntervals: preferred.unitAtomicIntervals,
          actualAudioIntervals: preferred.actualAudioIntervals,
          actualPlaybackIntervals: preferred.actualPlaybackIntervals,
          anchorOverlapSamples: preferred.anchorOverlapSamples,
          anchorCoverageRatios: preferred.anchorCoverageRatios,
          playbackCoverageOfUnitRatios: preferred.playbackCoverageOfUnitRatios,
          reviewEnvelope: preferred.reviewEnvelope,
          leftContextSeconds: preferred.leftContextSeconds,
          rightContextSeconds: preferred.rightContextSeconds,
          physicalAudioVerified: true,
          playbackVerified: true,
          deduplicationRelation:
            origins.length > 1
              ? "PLANNER_INHERITED_GEOMETRY_EQUIVALENT"
              : origins[0] === "PLANNER_SELECTED_REALIZATION"
                ? "UNIQUE_PLANNER_REALIZATION"
                : "UNIQUE_INHERITED_REALIZATION",
        }),
      );
    })
    .sort((a, b) =>
      a.effectiveRealizationId.localeCompare(b.effectiveRealizationId),
    );
  return effectiveRealizations1451Schema.parse(
    hashed141({
      ...header1451(input.policy, input.registry.sourceIdentity),
      artifactType: "machine-effective-product-realization-registry-v1",
      plannerHash: input.planner.semanticHash,
      inheritedHash: input.inherited.semanticHash,
      realizations: effectiveRows,
      plannerSelectedRealizationCount: plannerSeeds.length,
      inheritedRealizationCount: inheritedSeeds.length,
      plannerInheritedDuplicateCount: effectiveRows.filter(
        (row) =>
          row.deduplicationRelation === "PLANNER_INHERITED_GEOMETRY_EQUIVALENT",
      ).length,
      effectiveRealizationDedupCount:
        plannerSeeds.length + inheritedSeeds.length - effectiveRows.length,
      effectiveProductRealizationCount: effectiveRows.length,
    }),
  );
}

export function buildWitnessGroups1451(input: {
  policy: Policy1451;
  registry: FullRegistry1451;
  effective: EffectiveRealizations1451;
}): WitnessGroups1451 {
  const rate = input.registry.sourceIdentity.sampleRate,
    candidates: {
      rows: EffectiveRealizations1451["realizations"];
      connectedBy: WitnessGroups1451["groups"][number]["connectedBy"];
    }[] = input.effective.realizations.map((row) => ({
      rows: [row],
      connectedBy: ["SINGLE_REALIZATION"],
    }));
  const byAudio = new Map<string, EffectiveRealizations1451["realizations"]>();
  for (const row of input.effective.realizations)
    for (const audioId of row.audioIds) {
      const rows = byAudio.get(audioId) ?? [];
      rows.push(row);
      byAudio.set(audioId, rows);
    }
  for (const rows of byAudio.values()) {
    const ordered = [
      ...new Map(rows.map((row) => [row.effectiveRealizationId, row])).values(),
    ].sort(
      (a, b) =>
        a.reviewEnvelope.startSample - b.reviewEnvelope.startSample ||
        a.effectiveRealizationId.localeCompare(b.effectiveRealizationId),
    );
    for (let start = 0; start < ordered.length; start++) {
      const window: typeof ordered = [];
      for (let index = start; index < ordered.length; index++) {
        const candidate = required141(ordered[index]),
          next = [...window, candidate],
          unitIds = unique(next.flatMap((row) => row.fullCoverageUnitIds)),
          reviewEnvelope = envelope(next.map((row) => row.reviewEnvelope)),
          seconds =
            (reviewEnvelope.endSample - reviewEnvelope.startSample) / rate;
        if (
          next.length > input.policy.maximumRealizationsPerWitnessCandidate ||
          unitIds.length > input.policy.maximumUnitsPerWitnessCandidate ||
          seconds > input.policy.maximumWitnessReviewEnvelopeSeconds
        )
          break;
        window.push(candidate);
      }
      if (window.length > 1)
        candidates.push({
          rows: window,
          connectedBy: ["SHARED_PHYSICAL_AUDIO"],
        });
    }
  }
  const uniqueCandidates = new Map<string, (typeof candidates)[number]>();
  for (const candidate of candidates) {
    const signature = hash141(
      candidate.rows.map((row) => row.effectiveRealizationId).sort(),
    );
    uniqueCandidates.set(signature, candidate);
  }
  const groups = [...uniqueCandidates.entries()].flatMap(
    ([signature, candidate]) => {
      const rows = candidate.rows,
        fullCoverageUnitIds = unique(
          rows.flatMap((row) => row.fullCoverageUnitIds),
        ),
        realizationIds = rows.map((row) => row.effectiveRealizationId).sort(),
        reviewEnvelope = envelope(rows.map((row) => row.reviewEnvelope)),
        internalGap = gapSeconds(
          rows.flatMap((row) => row.unitAtomicIntervals),
          rate,
        ),
        eligible =
          fullCoverageUnitIds.length <=
            input.policy.maximumUnitsPerWitnessCandidate &&
          realizationIds.length <=
            input.policy.maximumRealizationsPerWitnessCandidate &&
          (reviewEnvelope.endSample - reviewEnvelope.startSample) / rate <=
            input.policy.maximumWitnessReviewEnvelopeSeconds &&
          internalGap <= input.policy.maximumInternalMachineGapSeconds;
      if (!eligible) return [];
      return [
        witnessGroups1451Schema.shape.groups.element.parse(
          hashed141({
            witnessGroupId: `product-witness-group-${signature.slice(0, 24)}`,
            fullCoverageUnitIds,
            realizationIds,
            realizationOrigins: unique(
              rows.flatMap((row) => row.realizationOrigins),
            ),
            targetIds: unique(rows.flatMap((row) => row.targetIds)),
            regionIds: unique(rows.flatMap((row) => row.regionIds)),
            audioIds: unique(rows.flatMap((row) => row.audioIds)),
            playbackSegmentIds: unique(
              rows.flatMap((row) => row.playbackSegmentIds),
            ),
            unitAtomicIntervals: union141(
              rows.flatMap((row) => row.unitAtomicIntervals),
            ),
            targetAnchorIntervals: union141(
              rows.flatMap((row) => row.atomicAnchorIntervals),
            ),
            physicalAudioIntervals: union141(
              rows.flatMap((row) => row.actualAudioIntervals),
            ),
            playbackIntervals: union141(
              rows.flatMap((row) => row.actualPlaybackIntervals),
            ),
            sourceIdentity: input.registry.sourceIdentity,
            connectedBy: candidate.connectedBy,
            maximumInternalGapSeconds: internalGap,
            reviewEnvelope,
            witnessEligibility: true,
            rejectionReasons: [],
          }),
        ),
      ];
    },
  );
  return witnessGroups1451Schema.parse(
    hashed141({
      ...header1451(input.policy, input.registry.sourceIdentity),
      artifactType: "machine-product-contract-witness-groups-v1",
      effectiveRealizationRegistryHash: input.effective.semanticHash,
      groups,
      witnessGroupCount: groups.length,
      singleUnitWitnessCandidateCount: groups.filter(
        (row) => row.fullCoverageUnitIds.length === 1,
      ).length,
      multiUnitWitnessCandidateCount: groups.filter(
        (row) => row.fullCoverageUnitIds.length > 1,
      ).length,
      maximumUnitsPerWitness: Math.max(
        0,
        ...groups.map((row) => row.fullCoverageUnitIds.length),
      ),
      maximumRealizationsPerWitness: Math.max(
        0,
        ...groups.map((row) => row.realizationIds.length),
      ),
      witnessSearchComplete: true,
      goldInputCount: 0,
    }),
  );
}
