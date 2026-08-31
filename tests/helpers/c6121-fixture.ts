import { c6121BaselineSchema, type C6121GoldTimingCue } from "@mvl/shared";
import { c612EvidenceFixture, SHA } from "./c612-fixture.js";
import {
  c6121Artifact,
  hash,
} from "../../packages/video-subtitler/src/consensus/evaluation-recovery/c6121-policy.js";
import { buildC6121Supergroups } from "../../packages/video-subtitler/src/consensus/evaluation-recovery/frozen-group-gold-bipartite-graph.js";
export function c6121Fixture() {
  const f = c612EvidenceFixture(10);
  const timing = () =>
    f.production.cues.map((c) => ({
      id: "g-" + c.id,
      start: c.start,
      end: c.end,
    }));
  const graph = (goldTiming: readonly C6121GoldTimingCue[] = timing()) =>
    buildC6121Supergroups({
      groups: f.frozen.mapping.groups,
      mappingHash: f.frozen.mapping.semanticHash,
      baselineCueOrder: f.production.cues.map((c) => c.id),
      production: f.production,
      universe: f.universe,
      folds: f.folds,
      goldTiming,
    });
  const baseline = c6121BaselineSchema.parse(
    c6121Artifact("c6-1-2-1-baseline-freeze-verification", {
      machineFrozenAt: "2000-01-01T00:00:00.000Z",
      machineFreezeHashes: [SHA, SHA],
      rerankingFreezeHashes: [SHA, SHA],
      sourceIdentity: SHA,
      generationSourceCommit: "synthetic",
      baselineCommit: "synthetic",
      files: [],
      inputAggregateHash: hash([]),
      productionTextHash: SHA,
      productionTimingHash: SHA,
      checks: [],
      passed: true,
      rawGoldReadCount: 0,
      modelExecutionCount: 0,
      networkUsed: false,
    }),
  );
  return { ...f, graph, timing, baseline };
}
