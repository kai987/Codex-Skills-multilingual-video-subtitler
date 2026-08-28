import {
  c6015PolicyVersion,
  machineEventToFinalCueLineageSchema,
  type C6015Mode,
  type LineageRelation,
  type LineageStatus,
  type MachineEventToFinalCueLineage,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";

export interface EventLineageInput {
  eventId: string;
  candidateIds: readonly string[];
  canonicalCueIds: readonly string[];
}

export interface PipelineLineageEdge {
  sourceIds: readonly string[];
  targetIds: readonly string[];
  relationType: LineageRelation["relationType"];
  operationArtifact: string;
  reason: string;
}

export interface ExplicitDroppedLineage {
  sourceId: string;
  operationArtifact: string;
  reason: string;
}

function relation(value: PipelineLineageEdge, index: number): LineageRelation {
  const core = {
    relationId: `lineage-operation-${String(index + 1).padStart(5, "0")}`,
    relationType: value.relationType,
    sourceIds: [...new Set(value.sourceIds)].toSorted(),
    targetIds: [...new Set(value.targetIds)].toSorted(),
    operationArtifact: value.operationArtifact,
    reason: value.reason,
  };
  return { ...core, semanticHash: machineQualitySemanticHash(core) };
}

function reachableFinalCueIds(input: {
  starts: readonly string[];
  adjacency: ReadonlyMap<string, ReadonlySet<string>>;
  finalCueIds: ReadonlySet<string>;
}): Set<string> {
  const queue = [...input.starts];
  const visited = new Set(queue);
  const output = new Set<string>();
  while (queue.length > 0) {
    const source = queue.shift();
    if (source === undefined) continue;
    if (input.finalCueIds.has(source)) output.add(source);
    for (const target of input.adjacency.get(source) ?? []) {
      if (visited.has(target)) continue;
      visited.add(target);
      queue.push(target);
    }
  }
  return output;
}

function reachableNodeIds(input: {
  starts: readonly string[];
  adjacency: ReadonlyMap<string, ReadonlySet<string>>;
}): Set<string> {
  const queue = [...input.starts];
  const visited = new Set(queue);
  while (queue.length > 0) {
    const source = queue.shift();
    if (source === undefined) continue;
    for (const target of input.adjacency.get(source) ?? []) {
      if (visited.has(target)) continue;
      visited.add(target);
      queue.push(target);
    }
  }
  return visited;
}

function classify(input: {
  finalCueIds: readonly string[];
  incomingEventCountByFinalCue: ReadonlyMap<string, number>;
  explicitlyDropped: boolean;
  ambiguous: boolean;
  blockers: readonly string[];
}): LineageStatus {
  if (input.finalCueIds.length === 0) {
    if (input.explicitlyDropped) return "DROPPED";
    return input.ambiguous ? "AMBIGUOUS" : "UNRESOLVED";
  }
  if (input.finalCueIds.length > 1) return "ONE_TO_MANY";
  const finalCueId = input.finalCueIds[0];
  if (
    finalCueId !== undefined &&
    (input.incomingEventCountByFinalCue.get(finalCueId) ?? 0) > 1
  ) {
    return "MANY_TO_ONE";
  }
  return "EXACT_ONE_TO_ONE";
}

/**
 * Builds production mutation identity exclusively from persistent pipeline IDs.
 * Intervals are intentionally absent from the API so a caller cannot fall back
 * to nearest-time matching.
 */
export function buildEventFinalCueLineage(input: {
  mode: C6015Mode;
  events: readonly EventLineageInput[];
  finalCueIds: readonly string[];
  edges: readonly PipelineLineageEdge[];
  dropped: readonly ExplicitDroppedLineage[];
  generatedAt?: string;
}): MachineEventToFinalCueLineage {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const normalizedEdges = input.edges
    .map((edge) => ({
      ...edge,
      sourceIds: [...new Set(edge.sourceIds)].toSorted(),
      targetIds: [...new Set(edge.targetIds)].toSorted(),
    }))
    .toSorted(
      (left, right) =>
        left.operationArtifact.localeCompare(right.operationArtifact) ||
        left.relationType.localeCompare(right.relationType) ||
        left.sourceIds
          .join("\u0000")
          .localeCompare(right.sourceIds.join("\u0000")) ||
        left.targetIds
          .join("\u0000")
          .localeCompare(right.targetIds.join("\u0000")) ||
        left.reason.localeCompare(right.reason),
    );
  const relations = normalizedEdges
    .map(relation)
    .toSorted(
      (left, right) =>
        left.operationArtifact.localeCompare(right.operationArtifact) ||
        left.relationId.localeCompare(right.relationId),
    );
  const adjacency = new Map<string, Set<string>>();
  const reverseAdjacency = new Map<string, Set<string>>();
  for (const edge of relations) {
    for (const sourceId of edge.sourceIds) {
      const targets = adjacency.get(sourceId) ?? new Set<string>();
      for (const targetId of edge.targetIds) {
        targets.add(targetId);
        const sources = reverseAdjacency.get(targetId) ?? new Set<string>();
        sources.add(sourceId);
        reverseAdjacency.set(targetId, sources);
      }
      adjacency.set(sourceId, targets);
    }
  }
  const normalizedFinalCueIds = [...new Set(input.finalCueIds)].toSorted();
  const finalCueIdSet = new Set(normalizedFinalCueIds);
  const droppedBySource = new Map(
    input.dropped.map((entry) => [entry.sourceId, entry] as const),
  );
  const rawReachability = input.events
    .map((event) => ({
      eventId: event.eventId,
      candidateIds: [...new Set(event.candidateIds)].toSorted(),
      canonicalCueIds: [...new Set(event.canonicalCueIds)].toSorted(),
    }))
    .toSorted((left, right) => left.eventId.localeCompare(right.eventId))
    .map((event) => {
      const starts = [
        ...new Set([...event.candidateIds, ...event.canonicalCueIds]),
      ].toSorted();
      return {
        event,
        starts,
        finalCueIds: [
          ...reachableFinalCueIds({
            starts,
            adjacency,
            finalCueIds: finalCueIdSet,
          }),
        ].toSorted(),
      };
    });
  const incomingEventCountByFinalCue = new Map<string, number>();
  for (const entry of rawReachability) {
    for (const finalCueId of entry.finalCueIds) {
      incomingEventCountByFinalCue.set(
        finalCueId,
        (incomingEventCountByFinalCue.get(finalCueId) ?? 0) + 1,
      );
    }
  }
  const events = rawReachability.map(({ event, starts, finalCueIds }) => {
    const forwardReachable = reachableNodeIds({ starts, adjacency });
    const reverseReachable = reachableNodeIds({
      starts: finalCueIds,
      adjacency: reverseAdjacency,
    });
    const relevantRelations = relations.filter(
      (entry) =>
        entry.sourceIds.some((sourceId) => forwardReachable.has(sourceId)) &&
        entry.targetIds.some((targetId) => reverseReachable.has(targetId)),
    );
    const droppedEntries = starts.flatMap((sourceId, droppedIndex) => {
      const dropped = droppedBySource.get(sourceId);
      if (dropped === undefined) return [];
      return [
        relation(
          {
            sourceIds: [sourceId],
            targetIds: [],
            relationType: "DROP",
            operationArtifact: dropped.operationArtifact,
            reason: dropped.reason,
          },
          relations.length + droppedIndex,
        ),
      ];
    });
    const nonFinalTerminalIds = [...forwardReachable]
      .filter(
        (nodeId) =>
          !finalCueIdSet.has(nodeId) &&
          !starts.includes(nodeId) &&
          (adjacency.get(nodeId)?.size ?? 0) === 0,
      )
      .toSorted();
    const ambiguous =
      finalCueIds.length === 0 && nonFinalTerminalIds.length > 1;
    const blockers = [
      ...(finalCueIds.length === 0 && droppedEntries.length === 0
        ? ["no-operation-history-path-to-final-cue"]
        : []),
      ...(ambiguous
        ? [
            `multiple-non-final-terminal-identities:${nonFinalTerminalIds.join(",")}`,
          ]
        : []),
    ];
    const lineageStatus = classify({
      finalCueIds,
      incomingEventCountByFinalCue,
      explicitlyDropped: droppedEntries.length > 0,
      ambiguous,
      blockers,
    });
    const core = {
      eventId: event.eventId,
      sourceCandidateIds: [...new Set(event.candidateIds)].toSorted(),
      canonicalCueIds: [...new Set(event.canonicalCueIds)].toSorted(),
      finalCueIds,
      lineageOperations: [...relevantRelations, ...droppedEntries].toSorted(
        (left, right) => left.semanticHash.localeCompare(right.semanticHash),
      ),
      splitRelations: relevantRelations.filter(
        (entry) => entry.relationType === "SPLIT",
      ),
      mergeRelations: relevantRelations.filter(
        (entry) => entry.relationType === "MERGE",
      ),
      dedupeRelations: relevantRelations.filter(
        (entry) => entry.relationType === "DEDUPE",
      ),
      droppedRelations: droppedEntries,
      timingProjectionRelations: relevantRelations.filter(
        (entry) => entry.relationType === "TIMING_PROJECTION",
      ),
      textProjectionRelations: relevantRelations.filter(
        (entry) => entry.relationType === "TEXT_PROJECTION",
      ),
      lineageStatus,
      blockers,
      // A many-to-one path proves where an event ended up, but it does not
      // prove that an event-local text or timing mutation is safe for the
      // shared final cue. Only the one-to-one identity is mutation-capable.
      modifiable: lineageStatus === "EXACT_ONE_TO_ONE",
    };
    return { ...core, semanticHash: machineQualitySemanticHash(core) };
  });
  const finalCueCoverage = normalizedFinalCueIds
    .map((finalCueId) => {
      const eventIds = events
        .filter((event) => event.finalCueIds.includes(finalCueId))
        .map((event) => event.eventId)
        .toSorted();
      const core = { finalCueId, eventIds };
      return { ...core, semanticHash: machineQualitySemanticHash(core) };
    })
    .filter((entry) => entry.eventIds.length > 0);
  const explicitEventLineageCount = events.filter(
    (event) => !["AMBIGUOUS", "UNRESOLVED"].includes(event.lineageStatus),
  ).length;
  const summary = {
    eventCount: events.length,
    finalCueCount: normalizedFinalCueIds.length,
    exactOneToOneCount: events.filter(
      (event) => event.lineageStatus === "EXACT_ONE_TO_ONE",
    ).length,
    oneToManyCount: events.filter(
      (event) => event.lineageStatus === "ONE_TO_MANY",
    ).length,
    manyToOneCount: events.filter(
      (event) => event.lineageStatus === "MANY_TO_ONE",
    ).length,
    supersededCount: events.filter(
      (event) => event.lineageStatus === "SUPERSEDED",
    ).length,
    droppedCount: events.filter((event) => event.lineageStatus === "DROPPED")
      .length,
    ambiguousCount: events.filter(
      (event) => event.lineageStatus === "AMBIGUOUS",
    ).length,
    unresolvedCount: events.filter(
      (event) => event.lineageStatus === "UNRESOLVED",
    ).length,
    explicitEventLineageCount,
    coveredFinalCueCount: finalCueCoverage.length,
    lineageCoverageRatio:
      events.length + normalizedFinalCueIds.length === 0
        ? 1
        : (explicitEventLineageCount + finalCueCoverage.length) /
          (events.length + normalizedFinalCueIds.length),
    timeNearestIdentityCount: 0 as const,
  };
  const core = {
    mode: input.mode,
    identityPolicy: "operation-history-only-no-time-nearest" as const,
    events,
    finalCueCoverage,
    summary,
  };
  return machineEventToFinalCueLineageSchema.parse({
    schemaVersion: "1.0.0",
    policyVersion: c6015PolicyVersion,
    generatedAt,
    artifactType: "machine-event-to-final-cue-lineage",
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
}
