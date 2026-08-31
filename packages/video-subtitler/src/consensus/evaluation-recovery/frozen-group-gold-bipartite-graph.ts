import {
  c6121GoldTimingCueSchema,
  c6121EdgesSchema,
  c6121MapSchema,
  c6121IntegritySchema,
  type C6121GoldTimingCue,
  type C6121Supergroup,
  type C6121Map,
  type C612Group,
  type C612Folds,
  type C61HypothesisUniverse,
  type SubtitlePackage,
} from "@mvl/shared";
import { c612Defined } from "../top-k/c612-policy.js";
import {
  duration,
  unionIntervals,
  overlap,
  type Interval,
} from "../top-k/c612-structural.js";
import {
  C6121_POLICY,
  C6121_POLICY_HASH,
  hash,
  c6121Artifact,
  demand,
  counts,
} from "./c6121-policy.js";
type Timing = C6121GoldTimingCue;
const ordered = (cues: readonly Timing[]) =>
  cues.toSorted(
    (a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id),
  );
const hull = (cues: readonly Interval[]) => ({
  start: Math.min(...cues.map((c) => c.start)),
  end: Math.max(...cues.map((c) => c.end)),
});
function gap(cues: readonly Timing[]) {
  const spans = unionIntervals(cues);
  return Math.max(
    0,
    ...spans.slice(1).map((c, i) => c.start - c612Defined(spans[i]).end),
  );
}
const contiguous = (indexes: number[]) =>
  indexes.every((n, i) => i === 0 || n === c612Defined(indexes[i - 1]) + 1);
export interface C6121GraphInput {
  groups: readonly C612Group[];
  mappingHash: string;
  baselineCueOrder: readonly string[];
  production: Pick<SubtitlePackage, "cues">;
  universe: Pick<C61HypothesisUniverse, "events">;
  folds: C612Folds;
  goldTiming: readonly C6121GoldTimingCue[];
}
/** Gold text is rejected at runtime as well as absent from the DTO signature. */
export function buildC6121Supergroups(input: C6121GraphInput) {
  const gold = ordered(
    input.goldTiming.map((c) => c6121GoldTimingCueSchema.parse(c)),
  );
  const machine = input.baselineCueOrder.map((id) =>
    c612Defined(input.production.cues.find((c) => c.id === id)),
  );
  demand(
    new Set(machine.map((c) => c.id)).size === machine.length &&
      machine.length === input.production.cues.length,
    "C6121_BASELINE_CUE_ORDER_INVALID",
  );
  demand(
    new Set(gold.map((c) => c.id)).size === gold.length,
    "C6121_DUPLICATE_GOLD_ID",
  );
  demand(
    new Set(input.groups.map((g) => g.groupId)).size === input.groups.length,
    "C6121_DUPLICATE_MACHINE_GROUP_ID",
  );
  const assignments = input.groups.flatMap((g) => g.cueIds);
  demand(
    assignments.length === machine.length &&
      new Set(assignments).size === machine.length &&
      assignments.every((id) => input.baselineCueOrder.includes(id)),
    "C6121_MACHINE_GROUP_CUE_PARTITION_INVALID",
  );
  const groups = input.groups.toSorted((a, b) =>
    a.groupId.localeCompare(b.groupId),
  );
  const goldTimingHash = hash(gold);
  const edges = groups.flatMap((group) => {
    const cues = machine.filter((c) => group.cueIds.includes(c.id));
    return gold.flatMap((g) => {
      const intersections = unionIntervals(
        cues.map((c) => ({
          start: Math.max(c.start, g.start),
          end: Math.min(c.end, g.end),
        })),
      );
      if (!intersections.length) return [];
      const seconds = duration(intersections);
      const body = {
        edgeId:
          "c6121-edge:" +
          hash([group.groupId, g.id, intersections, C6121_POLICY_HASH]).slice(
            0,
            24,
          ),
        machineGroupId: group.groupId,
        machineCueIds: cues.filter((c) => overlap(c, g) > 0).map((c) => c.id),
        goldCueId: g.id,
        overlapStart: c612Defined(intersections[0]).start,
        overlapEnd: c612Defined(intersections.at(-1)).end,
        overlapSeconds: seconds,
        overlapIntervals: intersections,
        machineIntersectionRatio: Math.min(
          1,
          seconds / Math.max(1e-9, duration(cues)),
        ),
        goldIntersectionRatio: Math.min(
          1,
          seconds / Math.max(1e-9, g.end - g.start),
        ),
        edgeType: "STRICT_POSITIVE_TEMPORAL_OVERLAP" as const,
        goldTextUsed: false as const,
      };
      return [{ ...body, semanticHash: hash(body) }];
    });
  });
  const edgeLedger = c6121EdgesSchema.parse(
    c6121Artifact("c6-1-2-1-bipartite-edge-ledger", {
      mappingHash: input.mappingHash,
      foldHash: input.folds.semanticHash,
      goldTimingHash,
      rows: edges,
      goldTextUsedForGroupingCount: 0,
    }),
  );
  const seen = new Set<string>(),
    supergroups: C6121Supergroup[] = [];
  for (const initial of groups) {
    if (seen.has(initial.groupId)) continue;
    const ms = new Set<string>(),
      gs = new Set<string>(),
      pending = [initial.groupId];
    while (pending.length) {
      const m = c612Defined(pending.pop());
      if (ms.has(m)) continue;
      ms.add(m);
      seen.add(m);
      for (const edge of edges.filter((e) => e.machineGroupId === m)) {
        gs.add(edge.goldCueId);
        for (const other of edges.filter((e) => e.goldCueId === edge.goldCueId))
          if (!ms.has(other.machineGroupId)) pending.push(other.machineGroupId);
      }
    }
    const machineGroups = groups.filter((g) => ms.has(g.groupId));
    const cueSet = new Set(machineGroups.flatMap((g) => g.cueIds));
    const mc = machine.filter((c) => cueSet.has(c.id)),
      gc = gold.filter((c) => gs.has(c.id));
    const machineGroupIds = [...ms].sort(),
      goldCueIds = gc.map((c) => c.id);
    const eventIds = [
      ...new Set(machineGroups.flatMap((g) => g.eventIds)),
    ].sort();
    const foldForGroup = machineGroups.map((g) =>
      input.folds.folds.filter((f) => f.groupIds.includes(g.groupId)),
    );
    demand(
      foldForGroup.every((f) => f.length <= 1),
      "C6121_MACHINE_GROUP_MULTIPLE_FOLDS",
    );
    const folds = [
      ...new Set(foldForGroup.flatMap((list) => list.map((f) => f.foldId))),
    ].sort();
    const foldId =
      folds.length === 1 && foldForGroup.every((f) => f.length === 1)
        ? c612Defined(folds[0])
        : null;
    const componentEdges = edges.filter((e) => ms.has(e.machineGroupId));
    const covered = duration(componentEdges.flatMap((e) => e.overlapIntervals));
    const machineCoveredRatio = Math.min(
      1,
      covered / Math.max(1e-9, duration(mc)),
    );
    const goldCoveredRatio = Math.min(
      1,
      covered / Math.max(1e-9, duration(gc)),
    );
    const total = hull([...mc, ...gc]),
      policy = C6121_POLICY.structure,
      reasons: string[] = [];
    const chronological = machine.every(
      (c, i) => i === 0 || c.start >= c612Defined(machine[i - 1]).start,
    );
    if (!gc.length) reasons.push("NO_GOLD_MAPPING");
    if (folds.length > 1) reasons.push("CROSS_FOLD_EVALUATION_COMPONENT");
    if (!foldId) reasons.push("UNASSIGNED_OR_CROSS_FOLD_COMPONENT");
    if (
      !chronological ||
      [...mc, ...gc].some((c) => c.start < 0 || c.end <= c.start)
    )
      reasons.push("STRUCTURE_INCOMPATIBLE");
    if (!contiguous(mc.map((c) => input.baselineCueOrder.indexOf(c.id))))
      reasons.push("NONCONTIGUOUS_MACHINE_CUES");
    if (!contiguous(gc.map((c) => gold.findIndex((x) => x.id === c.id))))
      reasons.push("NONCONTIGUOUS_GOLD_CUES");
    if (mc.length > policy.maxMachineCues || gc.length > policy.maxGoldCues)
      reasons.push("TEMPORAL_COMPONENT_CUE_LIMIT");
    if (total.end - total.start > policy.maxGroupDurationSeconds)
      reasons.push("TEMPORAL_COMPONENT_DURATION_LIMIT");
    if (
      gap(mc) > policy.maxWithinSideGapSeconds ||
      gap(gc) > policy.maxWithinSideGapSeconds
    )
      reasons.push("TEMPORAL_BRIDGE_GAP_LIMIT");
    if (
      machineCoveredRatio < policy.minimumMachineCoveredRatio ||
      goldCoveredRatio < policy.minimumGoldCoveredRatio
    )
      reasons.push("INSUFFICIENT_BIDIRECTIONAL_COVERAGE");
    const eligible = reasons.length === 0;
    const eventEligible = eventIds.filter((eventId) => {
      const event = input.universe.events.find((e) => e.eventId === eventId),
        span = event?.finalSpan;
      const cue = mc.find((c) => c.id === span?.finalCueId);
      const owners = input.groups.filter((g) => g.eventIds.includes(eventId));
      const ef = input.folds.folds.filter((f) => f.eventIds.includes(eventId));
      return !!(
        event &&
        span?.modifiable &&
        cue &&
        owners.length === 1 &&
        owners.every((g) => ms.has(g.groupId)) &&
        event.finalCueIds.every((id) => cueSet.has(id)) &&
        Array.from(cue.text).slice(span.spanStart, span.spanEnd).join("") ===
          span.spanText &&
        span.spanText === event.currentText &&
        ef.length === 1 &&
        ef[0]?.foldId === foldId
      );
    });
    const ambiguousEvents = eventIds.filter((e) => !eventEligible.includes(e));
    let structuralStatus: C6121Supergroup["structuralStatus"] =
      mc.length === 1
        ? gc.length === 1
          ? "FIXED_ONE_TO_ONE"
          : "FIXED_ONE_TO_MANY"
        : gc.length === 1
          ? "FIXED_MANY_TO_ONE"
          : "FIXED_MANY_TO_MANY";
    if (!eligible)
      structuralStatus = !gc.length
        ? "NO_GOLD_MAPPING"
        : folds.length > 1
          ? "CROSS_FOLD_COMPONENT"
          : reasons.includes("STRUCTURE_INCOMPATIBLE") || !foldId
            ? "STRUCTURE_INCOMPATIBLE"
            : (reasons[0] as C6121Supergroup["structuralStatus"]);
    const componentBody = {
      supergroupId:
        "c6121-supergroup:" +
        hash({
          machineGroupIds,
          machineCueIds: mc.map((c) => c.id).sort(),
          goldCueIds: [...goldCueIds].sort(),
          foldId,
          policyHash: C6121_POLICY_HASH,
        }).slice(0, 24),
      machineGroupIds,
      machineCueIds: mc.map((c) => c.id),
      machineEventIds: eventIds,
      goldCueIds,
      edgeIds: componentEdges.map((e) => e.edgeId).sort(),
      foldId,
      frozenFoldIds: folds,
      machineSourceInterval: hull(mc),
      goldSourceInterval: gc.length ? hull(gc) : null,
      totalSourceInterval: total,
      machineCoveredRatio,
      goldCoveredRatio,
      machineCueCount: mc.length,
      goldCueCount: gc.length,
      machineGroupCount: machineGroupIds.length,
      maximumMachineGapSeconds: gap(mc),
      maximumGoldGapSeconds: gap(gc),
      durationSeconds: total.end - total.start,
      structuralStatus,
      shadowEvaluationEligible: eligible,
      candidateLabelEligible: eligible && eventEligible.length > 0,
      oofTrainingEligible:
        eligible && eventEligible.length > 0 && foldId !== null,
      candidateEligibleEventIds: eligible ? eventEligible : [],
      candidateAmbiguousEventIds: ambiguousEvents,
      reasons: [
        ...new Set([
          ...reasons,
          ...(ambiguousEvents.length ? ["CANDIDATE_LABEL_AMBIGUOUS"] : []),
          ...(machineGroups.length > 1 && gc.length
            ? ["GOLD_CUE_CONNECTS_FROZEN_MACHINE_GROUPS"]
            : []),
        ]),
      ].sort(),
    };
    supergroups.push({ ...componentBody, semanticHash: hash(componentBody) });
  }
  // Isolated right-side vertices are real graph components too, never silently dropped.
  for (const cue of gold.filter(
    (g) => !edges.some((e) => e.goldCueId === g.id),
  )) {
    const body: Omit<C6121Supergroup, "semanticHash"> = {
      supergroupId:
        "c6121-supergroup:" +
        hash({
          machineGroupIds: [],
          machineCueIds: [],
          goldCueIds: [cue.id],
          foldId: null,
          policyHash: C6121_POLICY_HASH,
        }).slice(0, 24),
      machineGroupIds: [],
      machineCueIds: [],
      machineEventIds: [],
      goldCueIds: [cue.id],
      edgeIds: [],
      foldId: null,
      frozenFoldIds: [],
      machineSourceInterval: null,
      goldSourceInterval: { start: cue.start, end: cue.end },
      totalSourceInterval: { start: cue.start, end: cue.end },
      machineCoveredRatio: 0,
      goldCoveredRatio: 0,
      machineCueCount: 0,
      goldCueCount: 1,
      machineGroupCount: 0,
      maximumMachineGapSeconds: 0,
      maximumGoldGapSeconds: 0,
      durationSeconds: Math.max(0, cue.end - cue.start),
      structuralStatus:
        cue.start < 0 || cue.end <= cue.start
          ? "STRUCTURE_INCOMPATIBLE"
          : "NO_MACHINE_MAPPING",
      shadowEvaluationEligible: false,
      candidateLabelEligible: false,
      oofTrainingEligible: false,
      candidateEligibleEventIds: [],
      candidateAmbiguousEventIds: [],
      reasons: [
        "NO_MACHINE_MAPPING",
        ...(cue.start < 0 || cue.end <= cue.start
          ? ["STRUCTURE_INCOMPATIBLE"]
          : []),
      ],
    };
    supergroups.push({ ...body, semanticHash: hash(body) });
  }
  supergroups.sort(
    (a, b) =>
      a.totalSourceInterval.start - b.totalSourceInterval.start ||
      a.supergroupId.localeCompare(b.supergroupId),
  );
  const map = c6121MapSchema.parse(
    c6121Artifact("c6-1-2-1-evaluator-supergroup-map", {
      machineMappingHash: input.mappingHash,
      foldHash: input.folds.semanticHash,
      goldTimingHash,
      edgeLedgerHash: edgeLedger.semanticHash,
      baselineCueOrder: [...input.baselineCueOrder],
      goldCueOrder: gold.map((g) => g.id),
      groups: supergroups,
      unmappedGoldCueIds: gold
        .filter((g) => !edges.some((e) => e.goldCueId === g.id))
        .map((g) => g.id),
      goldTextUsedForGroupingCount: 0,
      profileRematchingCount: 0,
    }),
  );
  return {
    edgeLedger,
    map,
    integrity: auditC6121Supergroups(map, edges.length, gold.length),
  };
}
export function auditC6121Supergroups(
  map: C6121Map,
  edgeCount: number,
  goldCueCount: number,
) {
  const groups = map.groups,
    status = (value: string) =>
      groups.filter((g) => g.structuralStatus === value).length;
  const reasonCount = (value: string) =>
    groups.filter((g) => g.reasons.includes(value)).length;
  const ms = groups.flatMap((g) => g.machineGroupIds),
    gs = groups.flatMap((g) => g.goldCueIds);
  return c6121IntegritySchema.parse(
    c6121Artifact("c6-1-2-1-supergroup-integrity-audit", {
      supergroupMapHash: map.semanticHash,
      machineGroupCount: ms.length,
      goldCueCount,
      edgeCount,
      connectedComponentCount: groups.length,
      goldConnectedComponentCount: groups.filter(
        (g) => g.goldCueIds.length && g.machineGroupIds.length,
      ).length,
      noGoldComponentCount: status("NO_GOLD_MAPPING"),
      crossFoldComponentCount: status("CROSS_FOLD_COMPONENT"),
      stableShadowEvaluationCount: groups.filter(
        (g) => g.shadowEvaluationEligible,
      ).length,
      stableCandidateLabelCount: groups.filter((g) => g.candidateLabelEligible)
        .length,
      oofTrainingEligibleCount: groups.filter((g) => g.oofTrainingEligible)
        .length,
      structureIncompatibleCount: status("STRUCTURE_INCOMPATIBLE"),
      durationLimitCount: reasonCount("TEMPORAL_COMPONENT_DURATION_LIMIT"),
      gapLimitCount: reasonCount("TEMPORAL_BRIDGE_GAP_LIMIT"),
      cueLimitCount: reasonCount("TEMPORAL_COMPONENT_CUE_LIMIT"),
      noncontiguousCount: groups.filter((g) =>
        g.reasons.some((r) => r.startsWith("NONCONTIGUOUS_")),
      ).length,
      oneToOne: status("FIXED_ONE_TO_ONE"),
      oneToMany: status("FIXED_ONE_TO_MANY"),
      manyToOne: status("FIXED_MANY_TO_ONE"),
      manyToMany: status("FIXED_MANY_TO_MANY"),
      duplicateMachineAssignmentCount: ms.length - new Set(ms).size,
      duplicateGoldAssignmentCount: gs.length - new Set(gs).size,
      goldTextUsedForGroupingCount: 0,
      profileRematchingCount: 0,
      reasonCounts: counts(groups.flatMap((g) => g.reasons)),
    }),
  );
}
