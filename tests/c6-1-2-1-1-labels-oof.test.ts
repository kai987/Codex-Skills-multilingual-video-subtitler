import { describe, expect, it } from "vitest";
import { c61211Fixture, c61211Geometry } from "./helpers/c61211-fixture.js";
import { SHA } from "./helpers/c612-fixture.js";
import { c612Defined } from "../packages/video-subtitler/src/consensus/top-k/c612-policy.js";
import { partitionC61211 } from "../packages/video-subtitler/src/consensus/evaluation-partition/monotonic-partition-solver.js";
import {
  rebindC61211Labels,
  stabilityC61211,
} from "../packages/video-subtitler/src/consensus/evaluation-partition/partition-label-rebinding.js";
import { rebindC6121CandidateLabels } from "../packages/video-subtitler/src/consensus/evaluation-recovery/c6121-label-rebinding.js";
import { retrainC61211 } from "../packages/video-subtitler/src/consensus/evaluation-partition/same-feature-oof-retrainer.js";
import { evaluateC61211Profiles } from "../packages/video-subtitler/src/consensus/evaluation-partition/partition-profile-evaluation.js";
import { structuralC61211LabelIds } from "../packages/video-subtitler/src/consensus/evaluation-partition/reachable-coverage.js";
import { scoringC61211Adapter } from "../packages/video-subtitler/src/consensus/evaluation-partition/scoring-adapter.js";
import {
  hash,
  validateC61211Artifact,
} from "../packages/video-subtitler/src/consensus/evaluation-partition/c61211-policy.js";
const fixture = () => {
  const f = c61211Fixture(),
    p = partitionC61211(f.input),
    gold = f.input.goldTiming.map((g) => ({ ...g, text: "明日は晴れ" })),
    labels = rebindC61211Labels(f.frozen, p.map, gold, SHA),
    old = rebindC6121CandidateLabels(f.frozen, p.graph.map, gold, SHA);
  return { f, p, gold, labels, old };
};
describe("C6.1.2.1.1 partition counterfactual labels and unchanged OOF", () => {
  it("retains all E2 labels on bounded unchanged components", () => {
    const { labels, old } = fixture(),
      stability = stabilityC61211(old, labels);
    expect(labels.labels.map((r) => r.label)).toEqual(
      old.labels.map((r) => r.label),
    );
    expect(stability.previouslyEvaluableNowLost).toBe(0);
    expect(stability.exactLabelAgreementCount).toBe(
      stability.commonEvaluableCount,
    );
    expect(stability.materialDirectionAgreementCount).toBe(
      stability.commonEvaluableCount,
    );
    expect(stability.catastrophicAgreementCount).toBe(
      stability.commonEvaluableCount,
    );
    expect(() => validateC61211Artifact(stability)).not.toThrow();
  });
  it("gives candidate-in-block the same atomic machine group weight and frozen fold", () => {
    const { f, p, labels } = fixture();
    expect(labels.scoringAdapterHash).toBe(
      scoringC61211Adapter(p.map).semanticHash,
    );
    for (const row of labels.labels.filter((r) => r.oofTrainingEligible)) {
      expect(
        f.frozen.mapping.groups.some(
          (g) =>
            g.groupId === row.label.groupId && g.eventIds.includes(row.eventId),
        ),
      ).toBe(true);
      expect(row.label.foldId).toBe(row.foldId);
      expect(
        p.map.blocks.find((b) => b.partitionBlockId === row.partitionBlockId)
          ?.foldId,
      ).toBe(row.foldId);
    }
    expect(
      labels.labels
        .filter((l) => l.label.eligible)
        .map((l) => l.candidateId)
        .sort(),
    ).toEqual(structuralC61211LabelIds(f.frozen, p.map));
  });
  it("does not duplicate labels for a candidate crossing a recovered/residual boundary", () => {
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
    c612Defined(
      f.universe.events.find((e) => e.eventId === "event-0"),
    ).finalCueIds = ["cue-0", "cue-1"];
    const p = partitionC61211(f.input),
      gold = f.input.goldTiming.map((g) => ({ ...g, text: "明日は晴れ" }));
    // Keep this geometry fixture's candidate universe and mapping in sync.
    const labels = rebindC61211Labels(f.frozen, p.map, gold, SHA);
    const rows = labels.labels.filter((r) => r.eventId === "event-0");
    expect(rows.length).toBeGreaterThan(0);
    expect(
      rows.every(
        (r) =>
          !r.label.eligible &&
          r.label.reasons.includes("CROSS_PARTITION_CANDIDATE_APPLICATION"),
      ),
    ).toBe(true);
    expect(new Set(labels.labels.map((r) => r.candidateId)).size).toBe(
      labels.labels.length,
    );
  });
  it("never scores residual candidates as zero-gain successes", () => {
    const f = c61211Fixture();
    f.input.goldTiming = [{ id: "low", start: 2.9, end: 6 }];
    const p = partitionC61211(f.input),
      labels = rebindC61211Labels(
        f.frozen,
        p.map,
        [{ id: "low", start: 2.9, end: 6, text: "明日は晴れ" }],
        SHA,
      );
    expect(
      labels.labels.every(
        (r) =>
          !r.label.eligible &&
          r.label.normalizedGain === null &&
          r.label.labelClass === "UNEVALUABLE",
      ),
    ).toBe(true);
  });
  it("scores exact label class and material direction disagreements separately", () => {
    const { labels, old } = fixture(),
      changed = structuredClone(labels);
    const row = c612Defined(changed.labels.find((l) => l.label.eligible));
    row.label.labelClass =
      row.label.labelClass === "ORACLE_BEST"
        ? "EQUIVALENT_TO_CURRENT"
        : "ORACLE_BEST";
    row.label.materialDelta = row.label.materialDelta === 0 ? 1 : 0;
    const audit = stabilityC61211(old, changed);
    expect(audit.exactLabelAgreementCount).toBe(audit.commonEvaluableCount - 1);
    expect(audit.materialDirectionAgreementCount).toBe(
      audit.commonEvaluableCount - 1,
    );
    expect(audit.normalizedGainDirectionAgreementCount).toBe(
      audit.commonEvaluableCount,
    );
  });
  it("replays 45 models deterministically with identical feature/fold/profile/grid hashes", () => {
    const { f, p, labels, gold } = fixture(),
      before = hash(f.frozen);
    const a = retrainC61211(f.frozen, p.map, labels, SHA),
      b = retrainC61211(
        f.frozen,
        p.map,
        { ...labels, labels: [...labels.labels].reverse() },
        SHA,
      );
    expect(a).toEqual(b);
    expect(a.models.models).toHaveLength(45);
    expect(a.models.featureHash).toBe(f.features.semanticHash);
    expect(a.models.foldHash).toBe(f.folds.semanticHash);
    expect(hash(f.frozen)).toBe(before);
    for (const value of Object.values(a))
      expect(() => validateC61211Artifact(value)).not.toThrow();
    const profiles = evaluateC61211Profiles({
      frozen: f.frozen,
      map: p.map,
      gold,
      labels: labels.labels.map((l) => l.label),
      rankings: a.rankings.rows,
      decisions: a.decisions.rows,
      track: "SAME_FEATURE_SAME_PROFILE_OOF_RETRAIN",
    });
    expect(profiles).toHaveLength(9);
    expect(
      profiles.every((m) => m.partitionMapHash === p.map.semanticHash),
    ).toBe(true);
  }, 60000);
  it("outer-test numeric labels cannot affect that fold's imputer, model, threshold or predictions", () => {
    const { f, p, labels } = fixture(),
      fold = c612Defined(f.folds.folds[0]),
      a = retrainC61211(f.frozen, p.map, labels, SHA),
      changed = structuredClone(labels);
    for (const row of changed.labels.filter(
      (r) => fold.eventIds.includes(r.eventId) && r.label.eligible,
    )) {
      row.label.normalizedGain = 1000;
      row.label.candidateNormalizedError = 1000;
    }
    const b = retrainC61211(f.frozen, p.map, changed, SHA);
    expect(
      b.models.models.filter((m) => m.outerFoldId === fold.foldId),
    ).toEqual(a.models.models.filter((m) => m.outerFoldId === fold.foldId));
    expect(
      b.thresholds.rows.filter((m) => m.outerFoldId === fold.foldId),
    ).toEqual(a.thresholds.rows.filter((m) => m.outerFoldId === fold.foldId));
    expect(b.rankings.rows.filter((m) => m.foldId === fold.foldId)).toEqual(
      a.rankings.rows.filter((m) => m.foldId === fold.foldId),
    );
    expect(a.models.rawGoldTextFeatureCount).toBe(0);
    expect(a.models.outerTestLabelInputToPredictionCount).toBe(0);
  }, 60000);
  it.each([
    "fold",
    "raw-Gold",
    "duplicate",
    "eligibility",
    "D2",
    "map-binding",
  ])("rejects corrupted %s training inputs", (mode) => {
    const { f, p, labels } = fixture(),
      row = c612Defined(labels.labels.find((l) => l.oofTrainingEligible));
    if (mode === "fold") row.foldId = "wrong";
    if (mode === "raw-Gold") Object.assign(labels, { goldText: "forbidden" });
    if (mode === "duplicate") labels.labels.push(row);
    if (mode === "eligibility") row.oofTrainingEligible = false;
    if (mode === "D2") p.map.mode = "D2_RELAXED_DIAGNOSTIC_ONLY";
    if (mode === "map-binding") labels.partitionMapHash = "0".repeat(64);
    expect(() => retrainC61211(f.frozen, p.map, labels, SHA)).toThrow();
  });
});
