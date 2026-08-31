import { c6121Fixture } from "./c6121-fixture.js";
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
