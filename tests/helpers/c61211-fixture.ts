import { c6121Fixture } from "./c6121-fixture.js";
import { c612EvidenceFixture } from "./c612-fixture.js";
import { c612Defined } from "../../packages/video-subtitler/src/consensus/top-k/c612-policy.js";
import type { C61211PartitionInput } from "../../packages/video-subtitler/src/consensus/evaluation-partition/component-inventory.js";
export function c61211Fixture() {
  const fixture = c6121Fixture();
  const input: C61211PartitionInput = {
    groups: fixture.frozen.mapping.groups,
    mappingHash: fixture.frozen.mapping.semanticHash,
    baselineCueOrder: fixture.production.cues.map((c) => c.id),
    production: fixture.production,
    universe: fixture.universe,
    folds: fixture.folds,
    goldTiming: fixture.timing(),
    candidateReachableMachineGroupIds: fixture.frozen.mapping.groups.map(
      (g) => g.groupId,
    ),
  };
  return { ...fixture, input };
}

/** Synthetic geometry only; this is not a production fold rebuilder. */
export function c61211Geometry(
  machine: { start: number; end: number }[],
  gold: { start: number; end: number }[],
) {
  const f = c612EvidenceFixture(Math.max(10, machine.length));
  f.production.cues = f.production.cues
    .slice(0, machine.length)
    .map((c, i) => ({ ...c, ...machine[i] }));
  const cueIds = f.production.cues.map((c) => c.id);
  f.frozen.mapping.groups = f.frozen.mapping.groups.filter((g) =>
    g.cueIds.every((id) => cueIds.includes(id)),
  );
  f.folds.folds = [
    {
      ...c612Defined(f.folds.folds[0]),
      groupIds: f.frozen.mapping.groups.map((g) => g.groupId),
      eventIds: f.frozen.mapping.groups.flatMap((g) => g.eventIds),
    },
  ];
  const input: C61211PartitionInput = {
    groups: f.frozen.mapping.groups,
    mappingHash: f.frozen.mapping.semanticHash,
    baselineCueOrder: cueIds,
    production: f.production,
    universe: f.universe,
    folds: f.folds,
    goldTiming: gold.map((c, i) => ({
      id: "geometry-gold-" + String(i),
      ...c,
    })),
    candidateReachableMachineGroupIds: f.frozen.mapping.groups.map(
      (g) => g.groupId,
    ),
  };
  return { ...f, input };
}
export function c61211WeakChain() {
  return c61211Geometry(
    Array.from({ length: 12 }, (_, i) => ({ start: i, end: i + 1 })),
    [
      [0, 2.05],
      [2, 4.05],
      [4, 6.05],
      [6, 8.05],
      [8, 10.05],
      [10, 11.05],
      [11, 12],
    ].map(([start, end]) => ({
      start: c612Defined(start),
      end: c612Defined(end),
    })),
  );
}
