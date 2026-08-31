import { describe, expect, it } from "vitest";
import { C612_FEATURE_NAMES } from "@mvl/shared";
import {
  c612EvidenceFixture,
  feature,
  label,
  SHA,
} from "./helpers/c612-fixture.js";
import {
  C612_RERANKERS,
  predictLinear,
  trainLinearReranker,
} from "../packages/video-subtitler/src/consensus/top-k/linear-reranker.js";
import {
  runC612Oof,
  scoreEvent,
  trainFoldThreshold,
  trainingThresholdUtility,
} from "../packages/video-subtitler/src/consensus/top-k/top-k-oof-reranking.js";
import {
  buildGroupConfigurations,
  renderC612Shadow,
} from "../packages/video-subtitler/src/consensus/top-k/group-shadow-configurations.js";
import {
  rankingQuality,
  evaluateRetrieval,
} from "../packages/video-subtitler/src/consensus/top-k/fixed-group-evaluation.js";
import {
  hash,
  c612Defined,
} from "../packages/video-subtitler/src/consensus/top-k/c612-policy.js";
const profile = (id: string) =>
  c612Defined(C612_RERANKERS.find((p) => p.id === id));
const trainRows = [
  feature("a", "event", 0),
  feature("b", "event", 1),
  feature("event-current", "event", 0.5),
];
const trainLabels = [
  label("a", "event", 4),
  label("b", "event", 1),
  label("event-current", "event", 3, true),
];
describe("C6.1.2 real linear models", () => {
  it.each(["L2", "L3"])(
    "fits %s and prefers a lower-error training candidate",
    (id) => {
      const model = trainLinearReranker({
        profile: profile(id),
        outerFoldId: "fold",
        features: trainRows,
        labels: trainLabels,
        forbiddenEventIds: [],
      });
      expect(model.iterations).toBeGreaterThan(0);
      expect(model.weights.some((w) => w !== 0)).toBe(true);
      expect(predictLinear(model, c612Defined(trainRows[1]))).toBeGreaterThan(
        predictLinear(model, c612Defined(trainRows[0])),
      );
      expect(model.outerTestLabelRead).toBe(false);
      expect(model.weights).toHaveLength(2 * C612_FEATURE_NAMES.length);
    },
  );
  it("fits imputation and scaling on labeled training rows only", () => {
    const build = (features = trainRows) =>
      trainLinearReranker({
        profile: profile("L3"),
        outerFoldId: "fold",
        features,
        labels: trainLabels,
        forbiddenEventIds: ["test"],
      });
    const a = build(),
      b = build([...trainRows, feature("test-candidate", "test", 1e12)]);
    expect(b).toEqual(a);
    expect(a.means[0]).toBe(0.5);
  });
  it("preserves missing flags rather than treating unknown as measured zero", () => {
    const rows = [
      feature("a", "event", 0, true),
      c612Defined(trainRows[1]),
      c612Defined(trainRows[2]),
    ];
    const model = trainLinearReranker({
      profile: profile("L3"),
      outerFoldId: "fold",
      features: rows,
      labels: trainLabels,
      forbiddenEventIds: [],
    });
    expect(model.means[0]).toBe(0.75);
    expect(model.missingFlagCount).toBe(C612_FEATURE_NAMES.length);
    expect(Number.isFinite(predictLinear(model, c612Defined(rows[0])))).toBe(
      true,
    );
  });
  it("fails closed on test labels and duplicate labels", () => {
    expect(() =>
      trainLinearReranker({
        profile: profile("L3"),
        outerFoldId: "fold",
        features: trainRows,
        labels: trainLabels,
        forbiddenEventIds: ["event"],
      }),
    ).toThrow("OUTER_TEST_LABEL");
    expect(() =>
      trainLinearReranker({
        profile: profile("L3"),
        outerFoldId: "fold",
        features: trainRows,
        labels: [...trainLabels, c612Defined(trainLabels[0])],
        forbiddenEventIds: [],
      }),
    ).toThrow("DUPLICATE");
  });
  it("has deterministic coefficient and prediction parity under shuffled input", () => {
    const build = (reverse: boolean) =>
      trainLinearReranker({
        profile: profile("L2"),
        outerFoldId: "fold",
        features: reverse ? [...trainRows].reverse() : trainRows,
        labels: reverse ? [...trainLabels].reverse() : trainLabels,
        forbiddenEventIds: [],
      });
    expect(build(true)).toEqual(build(false));
  });
  it("keeps provider and CTC ablations fixed and exposes provider bias", () => {
    expect(profile("L7").enabled[14]).toBe(false);
    expect(profile("L7").enabled[15]).toBe(false);
    expect(profile("L8").enabled[25]).toBe(false);
    const model = trainLinearReranker({
      profile: profile("L3"),
      outerFoldId: "fold",
      features: trainRows,
      labels: trainLabels,
      forbiddenEventIds: [],
    });
    model.weights.fill(0);
    model.weights[14] = 10;
    const a = feature("a", "test", 0),
      b = feature("b", "test", 0);
    a.values[14] = 1;
    a.missing[14] = false;
    b.values[14] = 0;
    b.missing[14] = false;
    expect(predictLinear(model, a)).toBeGreaterThan(predictLinear(model, b));
    expect(predictLinear({ ...model, enabled: profile("L7").enabled }, a)).toBe(
      predictLinear({ ...model, enabled: profile("L7").enabled }, b),
    );
  });
});
describe("C6.1.2 grouped OOF", () => {
  it("produces one test-fold prediction per event and never trains on that fold", () => {
    const f = c612EvidenceFixture(),
      labels = f.labels().labels.labels;
    const result = runC612Oof({
      features: f.features.rows,
      sets: f.top.topK.sets,
      completeness: f.complete.completeness.rows,
      contractions: f.contraction.rows,
      labels,
      folds: f.folds,
      featureHash: f.features.semanticHash,
      profiles: [profile("L2")],
    });
    expect(result.rankings.rows).toHaveLength(10);
    expect(result.models.models).toHaveLength(5);
    for (const m of result.models.models) {
      const test = c612Defined(
        f.folds.folds.find((fold) => fold.foldId === m.outerFoldId),
      );
      expect(m.trainingEventIds.some((id) => test.eventIds.includes(id))).toBe(
        false,
      );
      expect(m.trainingGroupIds.some((id) => test.groupIds.includes(id))).toBe(
        false,
      );
    }
  });
  it("outer-test label perturbations cannot change that fold's model or prediction", () => {
    const f = c612EvidenceFixture(),
      labels = f.labels().labels.labels,
      test = c612Defined(f.folds.folds[0]);
    const run = (l = labels) =>
      runC612Oof({
        features: f.features.rows,
        sets: f.top.topK.sets,
        completeness: f.complete.completeness.rows,
        contractions: f.contraction.rows,
        labels: l,
        folds: f.folds,
        featureHash: f.features.semanticHash,
        profiles: [profile("L6")],
      });
    const a = run(),
      b = run(
        labels.map((l) =>
          test.eventIds.includes(l.eventId)
            ? { ...l, candidateNormalizedError: 1000, normalizedGain: -999 }
            : l,
        ),
      );
    expect(b.models.models.find((m) => m.outerFoldId === test.foldId)).toEqual(
      a.models.models.find((m) => m.outerFoldId === test.foldId),
    );
    expect(
      b.thresholds.rows.find((t) => t.outerFoldId === test.foldId),
    ).toEqual(a.thresholds.rows.find((t) => t.outerFoldId === test.foldId));
    expect(b.rankings.rows.filter((r) => r.foldId === test.foldId)).toEqual(
      a.rankings.rows.filter((r) => r.foldId === test.foldId),
    );
  });
  it("refuses unsafe fold and threshold contamination", () => {
    const f = c612EvidenceFixture(),
      labels = f.labels().labels.labels;
    const input = {
      features: f.features.rows,
      sets: f.top.topK.sets,
      completeness: f.complete.completeness.rows,
      contractions: f.contraction.rows,
      labels,
      folds: f.folds,
      featureHash: f.features.semanticHash,
    };
    expect(() =>
      runC612Oof({ ...input, folds: { ...f.folds, audioLeakageCount: 1 } }),
    ).toThrow("FOLDS_UNSAFE");
    expect(() =>
      trainFoldThreshold({
        ...input,
        profile: profile("L6"),
        outerFoldId: "outer",
        trainingFolds: f.folds.folds,
        trainingLabels: labels,
        forbiddenEvents: [c612Defined(labels[0]).eventId],
      }),
    ).toThrow("TEST_LABEL_THRESHOLD_LEAK");
  });
  it("unknown acoustic completeness blocks a high-ranking short alternative", () => {
    const f = c612EvidenceFixture(),
      set = c612Defined(
        f.top.topK.sets.find((s) => s.profile.startsWith("T0")),
      ),
      labels = f.labels().labels.labels;
    const model = trainLinearReranker({
      profile: profile("L0"),
      outerFoldId: "fold",
      features: f.features.rows,
      labels,
      forbiddenEventIds: [],
    });
    const p = {
      ...profile("L0"),
      completenessGate: true,
      contractionGate: true,
    };
    const result = scoreEvent(
      {
        features: f.features.rows,
        sets: f.top.topK.sets,
        completeness: f.complete.completeness.rows.map((c) => ({
          ...c,
          acousticCompletenessStatus: "INSUFFICIENT_EVIDENCE",
        })),
        contractions: f.contraction.rows,
      },
      set,
      model,
      p,
      0,
    );
    expect(result.selectedCandidateId).toBe(set.currentCandidateId);
    expect(result.abstained).toBe(true);
  });
  it("keeps current when no safe training threshold exists", () => {
    const f = c612EvidenceFixture(),
      labels = f.labels().labels.labels.map((l) => ({
        ...l,
        candidateNormalizedError: 3,
        normalizedGain: 0,
      }));
    const r = runC612Oof({
      features: f.features.rows,
      sets: f.top.topK.sets,
      completeness: f.complete.completeness.rows,
      contractions: f.contraction.rows,
      labels,
      folds: f.folds,
      featureHash: f.features.semanticHash,
      profiles: [profile("L6")],
    });
    expect(r.thresholds.rows.every((t) => t.threshold === null)).toBe(true);
    expect(
      r.rankings.rows.every(
        (r) => r.selectedCandidateId === r.currentCandidateId,
      ),
    ).toBe(true);
  });
  it("produces identical OOF and whole-candidate shadows under reversed inputs", () => {
    const f = c612EvidenceFixture(),
      labels = f.labels().labels.labels;
    const inputs = {
      features: f.features.rows,
      sets: f.top.topK.sets,
      completeness: f.complete.completeness.rows,
      contractions: f.contraction.rows,
      labels,
      folds: f.folds,
      featureHash: f.features.semanticHash,
      profiles: [profile("L3")],
    };
    const a = runC612Oof(inputs),
      b = runC612Oof({
        ...inputs,
        features: [...inputs.features].reverse(),
        sets: [...inputs.sets].reverse(),
        labels: [...labels].reverse(),
        completeness: [...inputs.completeness].reverse(),
        contractions: [...inputs.contractions].reverse(),
      });
    expect(b).toEqual(a);
    const build = (
      rankings = a.rankings.rows,
      groups = f.mapped.mapping.groups,
    ) =>
      buildGroupConfigurations({
        rankings,
        rankingHash: a.rankings.semanticHash,
        groups,
        mappingHash: f.mapped.mapping.semanticHash,
        production: f.production,
        universe: f.universe,
      });
    const ga = build(),
      gb = build(
        [...a.rankings.rows].reverse(),
        [...f.mapped.mapping.groups].reverse(),
      );
    expect(gb).toEqual(ga);
    const selected = ga.groupDecisions.rows.flatMap((d) => d.selections),
      shadow = renderC612Shadow(f.production, f.universe, selected, "L3"),
      reverse = renderC612Shadow(
        f.production,
        { ...f.universe, candidates: [...f.universe.candidates].reverse() },
        [...selected].reverse(),
        "L3",
      );
    expect(hash([reverse.ass, reverse.srt, reverse.vtt])).toBe(
      hash([shadow.ass, shadow.srt, shadow.vtt]),
    );
    expect(shadow.cues).toHaveLength(f.production.cues.length);
    expect(shadow.cues.map((c) => [c.id, c.start, c.end])).toEqual(
      f.production.cues.map((c) => [c.id, c.start, c.end]),
    );
  });
});
describe("C6.1.2 metric denominator controls", () => {
  it("calibrates inner precision without counting neutral selections as regressions", () => {
    const outcomes = [
      label("a", "train-a", 1),
      label("b", "train-b", 3),
      label("c", "train-c", 4),
    ];
    const utility = trainingThresholdUtility(outcomes);
    expect(utility).toMatchObject({
      improved: 1,
      regressed: 1,
      neutral: 1,
      precision: 0.5,
      harm: 1 / 3,
    });
    expect(
      trainingThresholdUtility([outcomes[1]].filter((x) => x !== undefined))
        .precision,
    ).toBeNull();
    expect(() =>
      trainingThresholdUtility([
        { ...c612Defined(outcomes[0]), eligible: false, normalizedGain: null },
      ]),
    ).toThrow("REQUIRES_KNOWN_LABELS");
  });
  it("does not call the best retrieved candidate an oracle if full-pool oracle is missing", () => {
    const labels = [
      label("a", "event", 2),
      label("b", "event", 0),
      label("event-current", "event", 3, true),
    ];
    const q = c612Defined(rankingQuality(["a", "event-current"], labels));
    expect(q.accuracy).toBe(0);
    expect(q.reciprocalRank).toBe(0);
    expect(q.ndcg4).toBeLessThan(1);
  });
  it("computes retrieval MRR on improvable full-pool oracle events", () => {
    const f = c612EvidenceFixture(),
      l = f.labels();
    const result = evaluateRetrieval({
      labels: l.labels.labels,
      ranks: f.ranks.rows,
      sets: f.top.topK.sets,
      freezeHash: SHA,
    });
    expect(result.profiles).toHaveLength(4);
    expect(result.profiles.every((p) => p.oracleImprovementEvents === 10)).toBe(
      true,
    );
    expect(result.profiles.every((p) => p.recall4 === 1)).toBe(true);
  });
});
