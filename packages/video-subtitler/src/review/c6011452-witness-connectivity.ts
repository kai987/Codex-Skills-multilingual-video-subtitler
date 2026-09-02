import {
  witnessConnectivity1452Schema,
  witnessGroups1452Schema,
  type EffectiveRealizations1452,
  type FullRegistry1451,
  type Policy1452,
  type ReviewPlayback1451,
  type Samples142,
  type WitnessConnectivity1452,
  type WitnessGroups1452,
} from "@mvl/shared";
import { hash141, hashed141, required141, union141 } from "./c601141-policy.js";
import { header1452 } from "./c6011452-policy.js";

const unique = (values: readonly string[]) =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right));

const intersection = (left: readonly string[], right: readonly string[]) => {
  const rightSet = new Set(right);
  return unique(left.filter((value) => rightSet.has(value)));
};

const sampleEnvelope = (values: readonly Samples142[]) => {
  const rows = union141([...values]);
  return {
    startSample: required141(rows[0]).startSample,
    endSample: required141(rows.at(-1)).endSample,
  };
};

const maximumGapSamples = (values: readonly Samples142[]) => {
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

const intervalGap = (left: Samples142, right: Samples142) =>
  left.endSample < right.startSample
    ? right.startSample - left.endSample
    : right.endSample < left.startSample
      ? left.startSample - right.endSample
      : 0;

export function buildPlaybackChainMap1452(input: {
  policy: Policy1452;
  playback: ReviewPlayback1451;
}) {
  const byAudio = new Map<string, ReviewPlayback1451["segments"]>();
  for (const segment of input.playback.segments) {
    const rows = byAudio.get(segment.audioId) ?? [];
    rows.push(segment);
    byAudio.set(segment.audioId, rows);
  }
  const result = new Map<string, string>();
  for (const [audioId, rows] of byAudio) {
    const ordered = [...rows].sort(
      (left, right) =>
        left.sourceInterval.start - right.sourceInterval.start ||
        left.playbackSegmentId.localeCompare(right.playbackSegmentId),
    );
    let chainRows: typeof ordered = [];
    const flush = () => {
      if (!chainRows.length) return;
      const chainId = `playback-chain-v1452-${hash141({
        audioId,
        segmentIds: chainRows.map((row) => row.playbackSegmentId),
      }).slice(0, 24)}`;
      for (const row of chainRows) result.set(row.playbackSegmentId, chainId);
      chainRows = [];
    };
    for (const row of ordered) {
      const previous = chainRows.at(-1);
      if (
        previous &&
        row.sourceInterval.start - previous.sourceInterval.end >
          input.policy.maximumInternalMachineGapSeconds
      )
        flush();
      chainRows.push(row);
    }
    flush();
  }
  return result;
}

export function buildWitnessConnectivity1452(input: {
  policy: Policy1452;
  registry: FullRegistry1451;
  effective: EffectiveRealizations1452;
  playback: ReviewPlayback1451;
}): WitnessConnectivity1452 {
  const chainMap = buildPlaybackChainMap1452(input),
    unitById = new Map(
      input.registry.units.map((unit) => [unit.fullCoverageUnitId, unit]),
    ),
    rows: WitnessConnectivity1452["rows"] = [];
  for (
    let leftIndex = 0;
    leftIndex < input.effective.realizations.length;
    leftIndex++
  )
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < input.effective.realizations.length;
      rightIndex++
    ) {
      const left = required141(input.effective.realizations[leftIndex]),
        right = required141(input.effective.realizations[rightIndex]),
        sharedRegionIds = intersection(left.regionIds, right.regionIds),
        sharedAudioIds = intersection(left.audioIds, right.audioIds),
        leftChains = unique(
          left.playbackSegmentIds.flatMap((id) => {
            const chain = chainMap.get(id);
            return chain ? [chain] : [];
          }),
        ),
        rightChains = unique(
          right.playbackSegmentIds.flatMap((id) => {
            const chain = chainMap.get(id);
            return chain ? [chain] : [];
          }),
        ),
        sharedPlaybackChainIds = intersection(leftChains, rightChains),
        leftUnits = left.fullCoverageUnitIds.map((id) =>
          required141(unitById.get(id)),
        ),
        rightUnits = right.fullCoverageUnitIds.map((id) =>
          required141(unitById.get(id)),
        ),
        unitGapSamples = Math.min(
          ...leftUnits.flatMap((a) =>
            rightUnits.map((b) =>
              intervalGap(a.envelopeInterval, b.envelopeInterval),
            ),
          ),
        ),
        sharedParentIds = intersection(
          unique(leftUnits.flatMap((unit) => unit.parentClusterIds)),
          unique(rightUnits.flatMap((unit) => unit.parentClusterIds)),
        ),
        sharedEvidenceIds = intersection(
          unique(leftUnits.flatMap((unit) => unit.evidenceObservationIds)),
          unique(rightUnits.flatMap((unit) => unit.evidenceObservationIds)),
        ),
        sourceIdentityMatch =
          left.fullCoverageUnitIds.every(
            (id) =>
              required141(unitById.get(id)).sourceIdentity.sourceMediaSha256 ===
              input.registry.sourceIdentity.sourceMediaSha256,
          ) &&
          right.fullCoverageUnitIds.every(
            (id) =>
              required141(unitById.get(id)).sourceIdentity.sourceMediaSha256 ===
              input.registry.sourceIdentity.sourceMediaSha256,
          ),
        provenanceShared =
          sharedRegionIds.length > 0 ||
          sharedAudioIds.length > 0 ||
          sharedParentIds.length > 0 ||
          sharedEvidenceIds.length > 0,
        sourceAdjacent =
          unitGapSamples <=
            input.policy.maximumInternalMachineGapSeconds *
              input.registry.sourceIdentity.sampleRate && provenanceShared,
        connectionTypes = unique([
          ...(sharedAudioIds.length ? ["SHARED_PHYSICAL_AUDIO"] : []),
          ...(sharedRegionIds.length ? ["SHARED_REVIEW_REGION"] : []),
          ...(sharedPlaybackChainIds.length &&
          sharedAudioIds.length &&
          sharedRegionIds.length
            ? ["CONTINUOUS_PLAYBACK_CHAIN"]
            : []),
          ...(sourceAdjacent ? ["SOURCE_ADJACENT_UNITS"] : []),
          ...(sharedParentIds.length ? ["SHARED_PARENT_SPEECH_ISLAND"] : []),
          ...(sharedEvidenceIds.length
            ? ["SHARED_MACHINE_EVIDENCE_LINEAGE"]
            : []),
        ]) as WitnessConnectivity1452["rows"][number]["connectionTypes"],
        connected = sourceIdentityMatch && connectionTypes.length > 0,
        identity = {
          realizationA: left.effectiveRealizationId,
          realizationB: right.effectiveRealizationId,
        };
      rows.push(
        witnessConnectivity1452Schema.shape.rows.element.parse(
          hashed141({
            connectivityId: `witness-connectivity-v2-${hash141(identity).slice(0, 24)}`,
            ...identity,
            connectionTypes,
            sharedRegionIds,
            sharedAudioIds,
            sharedPlaybackChainIds,
            unitGapSamples,
            sharedParentIds,
            sharedEvidenceIds,
            sourceIdentityMatch,
            hardBoundaryCrossed: false,
            connected,
            reasons: connected
              ? connectionTypes
              : [
                  ...(sourceIdentityMatch ? [] : ["SOURCE_IDENTITY_MISMATCH"]),
                  ...(!connectionTypes.length
                    ? ["NO_GOLD_FREE_CONNECTION"]
                    : []),
                ],
          }),
        ),
      );
    }
  rows.sort((left, right) =>
    left.connectivityId.localeCompare(right.connectivityId),
  );
  const connectedRows = rows.filter((row) => row.connected);
  return witnessConnectivity1452Schema.parse(
    hashed141({
      ...header1452(input.policy, input.registry.sourceIdentity),
      artifactType: "machine-witness-connectivity-ledger-v2",
      effectiveRealizationRegistryHash: input.effective.semanticHash,
      rows,
      pairCount: rows.length,
      connectedPairCount: connectedRows.length,
      disconnectedPairCount: rows.length - connectedRows.length,
      sharedAudioConnectionCount: connectedRows.filter((row) =>
        row.connectionTypes.includes("SHARED_PHYSICAL_AUDIO"),
      ).length,
      sharedRegionConnectionCount: connectedRows.filter((row) =>
        row.connectionTypes.includes("SHARED_REVIEW_REGION"),
      ).length,
      continuousPlaybackConnectionCount: connectedRows.filter((row) =>
        row.connectionTypes.includes("CONTINUOUS_PLAYBACK_CHAIN"),
      ).length,
      sourceAdjacentConnectionCount: connectedRows.filter((row) =>
        row.connectionTypes.includes("SOURCE_ADJACENT_UNITS"),
      ).length,
      sharedParentOrLineageConnectionCount: connectedRows.filter(
        (row) =>
          row.connectionTypes.includes("SHARED_PARENT_SPEECH_ISLAND") ||
          row.connectionTypes.includes("SHARED_MACHINE_EVIDENCE_LINEAGE"),
      ).length,
      timeProximityOnlyConnectionCount: 0,
      complete: true,
    }),
  );
}

export function buildWitnessGroups1452(input: {
  policy: Policy1452;
  registry: FullRegistry1451;
  effective: EffectiveRealizations1452;
  connectivity: WitnessConnectivity1452;
}): WitnessGroups1452 {
  type EffectiveRow = EffectiveRealizations1452["realizations"][number];
  const effectiveById = new Map(
      input.effective.realizations.map((row) => [
        row.effectiveRealizationId,
        row,
      ]),
    ),
    connectedPairs = new Map<string, WitnessConnectivity1452["rows"][number]>();
  for (const row of input.connectivity.rows.filter((entry) => entry.connected))
    connectedPairs.set(
      [row.realizationA, row.realizationB].sort().join("|"),
      row,
    );
  const candidates = new Map<string, EffectiveRow[]>(),
    add = (rows: readonly EffectiveRow[]) => {
      const uniqueRows = [
        ...new Map(
          rows.map((row) => [row.effectiveRealizationId, row]),
        ).values(),
      ].sort((left, right) =>
        left.effectiveRealizationId.localeCompare(right.effectiveRealizationId),
      );
      if (!uniqueRows.length) return;
      candidates.set(
        hash141(uniqueRows.map((row) => row.effectiveRealizationId)),
        uniqueRows,
      );
    };
  for (const row of input.effective.realizations) add([row]);
  for (const connection of input.connectivity.rows.filter(
    (row) => row.connected,
  ))
    add([
      required141(effectiveById.get(connection.realizationA)),
      required141(effectiveById.get(connection.realizationB)),
    ]);

  const deliveryGroups = new Map<string, EffectiveRow[]>();
  for (const row of input.effective.realizations)
    for (const regionId of row.regionIds)
      for (const audioId of row.audioIds) {
        const key = `${regionId}:${audioId}`,
          group = deliveryGroups.get(key) ?? [];
        group.push(row);
        deliveryGroups.set(key, group);
      }
  for (const rows of deliveryGroups.values()) {
    const ordered = [
      ...new Map(rows.map((row) => [row.effectiveRealizationId, row])).values(),
    ].sort(
      (left, right) =>
        left.reviewPlaybackEnvelope.startSample -
          right.reviewPlaybackEnvelope.startSample ||
        left.effectiveRealizationId.localeCompare(right.effectiveRealizationId),
    );
    for (let start = 0; start < ordered.length; start++) {
      const window: EffectiveRow[] = [];
      for (let index = start; index < ordered.length; index++) {
        const next = required141(ordered[index]);
        if (
          window.length &&
          !window.some((row) =>
            connectedPairs.has(
              [row.effectiveRealizationId, next.effectiveRealizationId]
                .sort()
                .join("|"),
            ),
          )
        )
          break;
        const proposed = [...window, next],
          unitIds = unique(proposed.flatMap((row) => row.fullCoverageUnitIds)),
          reviewEnvelope = sampleEnvelope(
            proposed.map((row) => row.reviewPlaybackEnvelope),
          ),
          seconds =
            (reviewEnvelope.endSample - reviewEnvelope.startSample) /
            input.registry.sourceIdentity.sampleRate,
          gap =
            maximumGapSamples(
              proposed.flatMap((row) => row.unitAtomicIntervals),
            ) / input.registry.sourceIdentity.sampleRate;
        if (
          proposed.length >
            input.policy.maximumRealizationsPerWitnessCandidate ||
          unitIds.length > input.policy.maximumUnitsPerWitnessCandidate ||
          seconds > input.policy.maximumWitnessReviewEnvelopeSeconds ||
          gap > input.policy.maximumInternalMachineGapSeconds
        )
          break;
        window.push(next);
        if (window.length > 1) add(window);
      }
    }
  }

  const groups: WitnessGroups1452["groups"] = [];
  for (const [signature, rows] of candidates) {
    const unitIds = unique(rows.flatMap((row) => row.fullCoverageUnitIds)),
      realizationIds = rows.map((row) => row.effectiveRealizationId),
      reviewPlaybackEnvelope = sampleEnvelope(
        rows.map((row) => row.reviewPlaybackEnvelope),
      ),
      maximumInternalGapSeconds =
        maximumGapSamples(rows.flatMap((row) => row.unitAtomicIntervals)) /
        input.registry.sourceIdentity.sampleRate,
      pairConnections = rows.flatMap((left, leftIndex) =>
        rows.slice(leftIndex + 1).flatMap((right) => {
          const connection = connectedPairs.get(
            [left.effectiveRealizationId, right.effectiveRealizationId]
              .sort()
              .join("|"),
          );
          return connection ? [connection] : [];
        }),
      ),
      connectedBy =
        rows.length === 1
          ? (["SINGLE_REALIZATION"] as const)
          : (unique(
              pairConnections.flatMap(
                (connection) => connection.connectionTypes,
              ),
            ) as WitnessGroups1452["groups"][number]["connectedBy"]);
    if (
      unitIds.length > input.policy.maximumUnitsPerWitnessCandidate ||
      rows.length > input.policy.maximumRealizationsPerWitnessCandidate ||
      (reviewPlaybackEnvelope.endSample - reviewPlaybackEnvelope.startSample) /
        input.registry.sourceIdentity.sampleRate >
        input.policy.maximumWitnessReviewEnvelopeSeconds ||
      maximumInternalGapSeconds > input.policy.maximumInternalMachineGapSeconds
    )
      continue;
    groups.push(
      witnessGroups1452Schema.shape.groups.element.parse(
        hashed141({
          witnessGroupId: `product-witness-group-v2-${signature.slice(0, 24)}`,
          fullCoverageUnitIds: unitIds,
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
            rows.flatMap((row) => row.machineAnchorIntervals),
          ),
          physicalAudioContainerIntervals: union141(
            rows.flatMap((row) => row.physicalAudioContainerIntervals),
          ),
          playbackIntervalUnion: union141(
            rows.flatMap((row) => row.playbackIntervalUnion),
          ),
          sourceIdentity: input.registry.sourceIdentity,
          connectedBy,
          maximumInternalGapSeconds,
          reviewPlaybackEnvelope,
          witnessEligibility: true,
          rejectionReasons: [],
        }),
      ),
    );
  }
  groups.sort((left, right) =>
    left.witnessGroupId.localeCompare(right.witnessGroupId),
  );
  return witnessGroups1452Schema.parse(
    hashed141({
      ...header1452(input.policy, input.registry.sourceIdentity),
      artifactType: "machine-product-contract-witness-groups-v2",
      effectiveRealizationRegistryHash: input.effective.semanticHash,
      connectivityLedgerHash: input.connectivity.semanticHash,
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
      witnessGroupBuildComplete: true,
      witnessSearchComplete: true,
      goldInputCount: 0,
    }),
  );
}
