import { describe, expect, it } from "vitest";
import { c6121Fixture } from "./helpers/c6121-fixture.js";
import { SHA } from "./helpers/c612-fixture.js";
import { c612Defined } from "../packages/video-subtitler/src/consensus/top-k/c612-policy.js";
import { editDistance } from "../packages/video-subtitler/src/consensus/top-k/c612-structural.js";
import {
  rebindC6121CandidateLabels,
  scoreC6121Supergroup,
  auditC6121LabelStability,
} from "../packages/video-subtitler/src/consensus/evaluation-recovery/c6121-label-rebinding.js";
import {
  hash,
  fraction,
} from "../packages/video-subtitler/src/consensus/evaluation-recovery/c6121-policy.js";
import {
  c6121Coverage,
  c6121CoverageRecovery,
} from "../packages/video-subtitler/src/consensus/evaluation-recovery/supergroup-coverage.js";
function fixture() {
  const f = c6121Fixture(),
    gold = f.timing().map((c) => ({ ...c, text: "明日は晴れ" })),
    graph = f.graph();
  const labels = rebindC6121CandidateLabels(f.frozen, graph.map, gold, SHA);
  return { f, gold, graph, labels };
}
describe("C6.1.2.1 numeric candidate and unique joint labels", () => {
  it("uses an original whole candidate counterfactual without changing timing or production", () => {
    const { f, graph, labels } = fixture(),
      before = hash(f.production);
    expect(
      labels.labels.some(
        (l) => l.label.normalizedGain !== null && l.label.normalizedGain > 0,
      ),
    ).toBe(true);
    expect(
      labels.labels
        .filter((l) => l.label.eligible)
        .every((l) => l.oofTrainingEligible),
    ).toBe(true);
    expect(
      labels.labels.every((l) => l.label.groupId === l.machineGroupIds[0]),
    ).toBe(true);
    expect(
      labels.labels.every(
        (l) =>
          l.supergroupId &&
          graph.map.groups.some((g) => g.supergroupId === l.supergroupId),
      ),
    ).toBe(true);
    expect(hash(f.production)).toBe(before);
    expect(JSON.stringify(labels)).not.toContain("明日は晴れ");
  });
  it("keeps exact/normalized errors and material deltas distinct", () => {
    const { f, graph, gold } = fixture(),
      group = c612Defined(graph.map.groups[0]);
    f.production.cues[0] = {
      ...c612Defined(f.production.cues[0]),
      text: "Ａ。",
    };
    const target = gold.map((c, i) => (i === 0 ? { ...c, text: "a" } : c));
    const result = scoreC6121Supergroup(
      group,
      f.production,
      f.production.cues.map((c, i) => (i === 0 ? { ...c, text: "a" } : c)),
      target,
    );
    expect(result.exactGain).toBeGreaterThan(0);
    expect(result.normalizedGain).toBe(0);
    expect(result.materialDelta).toBe(0);
  });
  it("retains null error and null gain for unevaluable groups", () => {
    const { f, gold } = fixture(),
      graph = f.graph([{ id: "unmapped", start: 500, end: 501 }]);
    const labels = rebindC6121CandidateLabels(
      f.frozen,
      graph.map,
      [...gold, { id: "unmapped", start: 500, end: 501, text: "x" }],
      SHA,
    );
    expect(
      labels.labels.every(
        (l) =>
          l.label.normalizedGain === null &&
          l.label.catastrophicDeletion === null &&
          !l.oofTrainingEligible,
      ),
    ).toBe(true);
  });
  it("detects catastrophic contraction on a locally supported synthetic sentence", () => {
    const { f, graph, gold } = fixture();
    const c = c612Defined(f.production.cues[0]);
    c.text = "これは大切な説明です";
    c612Defined(gold[0]).text = c.text;
    const shadow = f.production.cues.map((c, i) =>
      i === 0 ? { ...c, text: "説明" } : c,
    );
    expect(
      scoreC6121Supergroup(
        c612Defined(graph.map.groups[0]),
        f.production,
        shadow,
        gold,
      ).catastrophicDeletion,
    ).toBe(true);
  });
  it("joint gain differs from summing two overlapping error counterfactuals", () => {
    const { f, graph } = fixture();
    const c = c612Defined(f.production.cues[0]);
    c.text = "ab";
    const gold = f.timing().map((c) => ({ ...c, text: "ba" }));
    const group = c612Defined(graph.map.groups[0]);
    const score = (text: string) =>
      scoreC6121Supergroup(
        group,
        f.production,
        f.production.cues.map((c, i) => (i === 0 ? { ...c, text } : c)),
        gold,
      );
    expect(score("bb").normalizedGain).not.toBe(
      c612Defined(score("ba").normalizedGain) +
        c612Defined(score("aa").normalizedGain),
    );
    expect(score("bb").normalizedGain).toBe(
      editDistance("ab", "ba") - editDistance("bb", "ba"),
    );
  });
  it("scores a joined many-group Gold target exactly once", () => {
    const { f } = fixture();
    Object.assign(c612Defined(f.production.cues[1]), { start: 3, end: 5 });
    const gold = [
      { id: "whole", start: 1, end: 5, text: "明日は曇り明日は晴れ" },
    ];
    const graph = f.graph(
      gold.map(({ id, start, end }) => ({ id, start, end })),
    );
    const group = c612Defined(
      graph.map.groups.find((g) => g.goldCueIds.includes("whole")),
    );
    const shadow = f.production.cues.map((c, i) =>
      i === 1 ? { ...c, text: "明日は晴れ" } : c,
    );
    const score = scoreC6121Supergroup(group, f.production, shadow, gold);
    expect(score.normalizedGain).toBe(2);
    expect(score.goldCueIds).toHaveLength(1);
    expect(group.machineGroupIds).toHaveLength(2);
  });
  it.each(["timing", "cue-count", "missing-cue"])(
    "rejects shadow %s changes",
    (mode) => {
      const { f, graph, gold } = fixture();
      const shadow = structuredClone(f.production.cues);
      if (mode === "timing") c612Defined(shadow[0]).start += 0.2;
      if (mode === "cue-count")
        shadow.push({ ...c612Defined(shadow[0]), id: "extra" });
      if (mode === "missing-cue") shadow.shift();
      expect(() =>
        scoreC6121Supergroup(
          c612Defined(graph.map.groups[0]),
          f.production,
          shadow,
          gold,
        ),
      ).toThrow();
    },
  );
  it("keeps structurally ineligible and cross-supergroup candidates out of labels", () => {
    const { f, graph, gold } = fixture();
    c612Defined(f.universe.events[0]).finalCueIds.push("cue-2");
    const labels = rebindC6121CandidateLabels(f.frozen, graph.map, gold, SHA);
    expect(
      labels.labels
        .filter((r) => r.eventId === f.universe.events[0]?.eventId)
        .every((r) => !r.label.eligible),
    ).toBe(true);
  });
  it("audits newly recovered labels, common-label agreement, and direction disagreement", () => {
    const { f, graph, gold, labels } = fixture();
    const old = f.labels();
    const audit = auditC6121LabelStability(old.labels.labels, labels);
    expect(audit.commonEvaluableCount).toBeGreaterThan(0);
    expect(audit.gainDirectionAgreementCount).toBe(audit.commonEvaluableCount);
    const row = c612Defined(
      old.labels.labels.find((l) => l.eligible && l.normalizedGain !== 0),
    );
    row.normalizedGain = -c612Defined(row.normalizedGain);
    expect(
      auditC6121LabelStability(old.labels.labels, labels).disagreementCount,
    ).toBeGreaterThan(0);
    for (const l of old.labels.labels) l.eligible = false;
    expect(
      auditC6121LabelStability(old.labels.labels, labels)
        .newlyRecoveredCandidateLabels,
    ).toBeGreaterThan(0);
    const coverage = c6121Coverage(
      f.frozen,
      graph.map,
      gold,
      labels.labels.map((l) => l.label),
    );
    const recovery = c6121CoverageRecovery(
      f.frozen,
      graph.map,
      coverage,
      f.labels().groupLabels.rows,
    );
    expect(recovery.coverage.evaluableProductionCueCoverage.ratio).toBe(1);
  });
  it("makes all coverage denominators explicit and preserves zero-denominator null", () => {
    const { f, graph, gold, labels } = fixture();
    const c = c6121Coverage(
      f.frozen,
      graph.map,
      gold,
      labels.labels.map((l) => l.label),
    );
    expect(c.candidateEventLabelCoverage.denominator).toBe(10);
    expect(c.candidateLabelCoverage.denominator).toBe(
      f.frozen.ranks.rows.length,
    );
    expect(c.topKCandidateLabelCoverage.denominator).toBe(
      f.frozen.features.rows.length,
    );
    expect(fraction(0, 0).ratio).toBeNull();
  });
});
