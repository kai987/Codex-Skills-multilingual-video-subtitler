import { describe, expect, it } from "vitest";
import { c612RankingSchema, c61211WholeSchema } from "@mvl/shared";
import { c61211Fixture, c61211Geometry } from "./helpers/c61211-fixture.js";
import { SHA } from "./helpers/c612-fixture.js";
import { c612Defined } from "../packages/video-subtitler/src/consensus/top-k/c612-policy.js";
import { partitionC61211 } from "../packages/video-subtitler/src/consensus/evaluation-partition/monotonic-partition-solver.js";
import {
  rebindC61211Labels,
  stabilityC61211,
} from "../packages/video-subtitler/src/consensus/evaluation-partition/partition-label-rebinding.js";
import { rebindC6121CandidateLabels } from "../packages/video-subtitler/src/consensus/evaluation-recovery/c6121-label-rebinding.js";
import { evaluateC61211Profiles } from "../packages/video-subtitler/src/consensus/evaluation-partition/partition-profile-evaluation.js";
import {
  wholeC61211,
  biasC61211,
} from "../packages/video-subtitler/src/consensus/evaluation-partition/whole-component-diagnostic.js";
import {
  auditC61211Conservation,
  auditC61211Cuts,
} from "../packages/video-subtitler/src/consensus/evaluation-partition/partition-audits.js";
import {
  c61211Artifact,
  c61211Body,
  hash,
  validateC61211Artifact,
} from "../packages/video-subtitler/src/consensus/evaluation-partition/c61211-policy.js";

function fixture(
  f: Pick<
    ReturnType<typeof c61211Fixture>,
    "frozen" | "input"
  > = c61211Fixture(),
) {
  const p = partitionC61211(f.input),
    gold = f.input.goldTiming.map((g) => ({ ...g, text: "明日は晴れ" }));
  const labels = rebindC61211Labels(f.frozen, p.map, gold, SHA),
    old = rebindC6121CandidateLabels(f.frozen, p.graph.map, gold, SHA);
  const rankings = [
    c612RankingSchema.parse({
      profileId: "L0",
      eventId: "synthetic",
      foldId: "synthetic",
      modelHash: SHA,
      currentCandidateId: "current",
      ranked: [],
      proposedCandidateId: "current",
      selectedCandidateId: "current",
      marginOverCurrent: 0,
      abstained: true,
      reasons: ["SYNTHETIC_CURRENT_ONLY"],
      testLabelUsed: false,
    }),
  ];
  const profiles = evaluateC61211Profiles({
    frozen: f.frozen,
    map: p.map,
    gold,
    labels: labels.labels.map((l) => l.label),
    rankings,
    decisions: [],
    track: "FROZEN_DECISION_REEVALUATION",
  });
  const whole = wholeC61211({
    frozen: f.frozen,
    graph: p.graph,
    map: p.map,
    gold,
    tracks: [{ profiles, decisions: [] }],
  });
  const bias = biasC61211(
    p.map,
    whole,
    auditC61211Conservation(f.input, p.map, p.graph),
    auditC61211Cuts(p.map, p.graph),
    stabilityC61211(old, labels),
  );
  return { f, p, gold, labels, profiles, whole, bias };
}
describe("C6.1.2.1.1 whole-component diagnostics do not replace the partition evaluator", () => {
  it("keeps all global Gold-only text in global quality, without binding it to a machine candidate", () => {
    const f = c61211Fixture();
    f.input.goldTiming = [
      ...f.input.goldTiming,
      { id: "isolated", start: 999, end: 1000 },
    ];
    const before = hash(f.frozen),
      r = fixture(f);
    expect(r.whole.globalQuality[0]?.goldCueCount).toBe(11);
    expect(r.whole.globalQuality[0]?.goldOnlyMissingCharacters).toBe(5);
    expect(r.whole.globalQuality[0]?.normalizedGoldCharacters).toBe(55);
    expect(r.whole.rows).toHaveLength(10);
    expect(hash(f.frozen)).toBe(before);
  });
  it("never inflates direction agreement with unchanged zero-gain component/profile pairs", () => {
    const r = fixture();
    expect(r.whole.rows).toHaveLength(10);
    expect(r.bias.comparedProfileComponents).toBe(0);
    expect(r.bias.gainDirectionAgreementCount).toBe(0);
    expect(r.bias.gainDirectionDisagreementCount).toBe(0);
    expect(r.bias.passed).toBe(true);
  });
  it("marks partial partitions incomparable rather than summing missing residual scores as zero", () => {
    const f = c61211Geometry(
      [
        { start: 0, end: 2 },
        { start: 2, end: 7 },
      ],
      [
        { start: 0, end: 2.01 },
        { start: 6.5, end: 7 },
      ],
    );
    const r = fixture(f);
    expect(
      r.p.map.components.some(
        (c) => c.status === "PARTIALLY_PARTITIONED_WITH_RESIDUAL",
      ),
    ).toBe(true);
    expect(r.whole.rows.some((row) => !row.fullyEvaluatedPartition)).toBe(true);
    for (const row of r.whole.rows.filter(
      (row) => !row.fullyEvaluatedPartition,
    )) {
      expect(row.partitionNormalizedGain).toBeNull();
      expect(row.partitionMaterialDelta).toBeNull();
      expect(row.normalizedDirectionAgreement).toBeNull();
      expect(row.catastrophicAgreement).toBeNull();
      expect(row.whole.evaluated).toBe(true);
    }
  });
  it("never exposes E4 as training labels, a safe-profile metric or a route input", () => {
    const { whole, bias } = fixture();
    expect(whole.eligibleForTraining).toBe(false);
    expect(whole.eligibleForSafeProfile).toBe(false);
    expect(whole.eligibleForRoute).toBe(false);
    expect(bias.wholeComponentScoresUsedForRoute).toBe(false);
    for (const value of [whole, bias])
      expect(() => validateC61211Artifact(value)).not.toThrow();
  });
  it("reports direction disagreement with explicit component/pair denominators without routing on E4 gains", () => {
    const r = fixture(),
      row = c612Defined(r.whole.rows[0]);
    // A synthetic diagnostic pair, not an observed run or an altered candidate.
    row.whole.changed = true;
    row.normalizedDirectionAgreement = false;
    row.materialDirectionAgreement = false;
    row.catastrophicAgreement = false;
    const changedWhole = c61211WholeSchema.parse(
      c61211Artifact(
        "c6-1-2-1-1-whole-component-diagnostic-evaluation",
        c61211Body(r.whole),
      ),
    );
    const bias = biasC61211(
      r.p.map,
      changedWhole,
      auditC61211Conservation(r.f.input, r.p.map, r.p.graph),
      auditC61211Cuts(r.p.map, r.p.graph),
      stabilityC61211(
        rebindC6121CandidateLabels(r.f.frozen, r.p.graph.map, r.gold, SHA),
        r.labels,
      ),
    );
    expect(bias.comparedProfileComponents).toBe(1);
    expect(bias.gainDirectionDisagreementCount).toBe(1);
    expect(bias.disagreementComponentIds).toEqual([row.parentE2SupergroupId]);
    expect(bias.passed).toBe(true);
    expect(bias.wholeComponentScoresUsedForRoute).toBe(false);
  });
});
