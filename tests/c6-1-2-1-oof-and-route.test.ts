import { describe, expect, it } from "vitest";
import { type C6121ProfileMetric, type C6121Coverage } from "@mvl/shared";
import { c6121Fixture } from "./helpers/c6121-fixture.js";
import { SHA } from "./helpers/c612-fixture.js";
import { c612Defined } from "../packages/video-subtitler/src/consensus/top-k/c612-policy.js";
import { C612_RERANKERS } from "../packages/video-subtitler/src/consensus/top-k/linear-reranker.js";
import { rebindC6121CandidateLabels } from "../packages/video-subtitler/src/consensus/evaluation-recovery/c6121-label-rebinding.js";
import { retrainC6121Oof } from "../packages/video-subtitler/src/consensus/evaluation-recovery/same-profile-oof-retrainer.js";
import { evaluateC6121Profiles } from "../packages/video-subtitler/src/consensus/evaluation-recovery/c6121-profile-evaluation.js";
import {
  decideC6121Route,
  diagnoseC6121Completeness,
  c6121SafeProfile,
  c6121SafeProfileSort,
} from "../packages/video-subtitler/src/consensus/evaluation-recovery/c6121-route-decision.js";
import {
  hash,
  fraction,
  validateC6121Artifact,
} from "../packages/video-subtitler/src/consensus/evaluation-recovery/c6121-policy.js";
function fixture() {
  const f = c6121Fixture(),
    graph = f.graph(),
    gold = f.timing().map((c) => ({ ...c, text: "明日は晴れ" }));
  const labels = rebindC6121CandidateLabels(f.frozen, graph.map, gold, SHA);
  return { f, graph, gold, labels };
}
describe("C6.1.2.1 unchanged OOF algorithm with rebound numeric labels", () => {
  it("keeps features/folds/profiles fixed and serializes deterministic models", () => {
    const { f, graph, labels, gold } = fixture(),
      before = hash(f.frozen),
      profilesBefore = hash(C612_RERANKERS);
    const a = retrainC6121Oof(f.frozen, graph.map, labels, SHA);
    const b = retrainC6121Oof(
      f.frozen,
      graph.map,
      { ...labels, labels: [...labels.labels].reverse() },
      SHA,
    );
    expect(b).toEqual(a);
    expect(a.models.models).toHaveLength(45);
    expect(a.models.featureHash).toBe(f.features.semanticHash);
    expect(a.models.foldHash).toBe(f.folds.semanticHash);
    expect(hash(f.frozen)).toBe(before);
    expect(hash(C612_RERANKERS)).toBe(profilesBefore);
    expect(a.models.rawGoldTextFeatureCount).toBe(0);
    for (const artifact of Object.values(a))
      expect(() => validateC6121Artifact(artifact)).not.toThrow();
    const metrics = evaluateC6121Profiles({
      frozen: f.frozen,
      map: graph.map,
      gold,
      labels: labels.labels.map((l) => l.label),
      rankings: a.rankings.rows,
      decisions: a.decisions.rows,
      track: "SAME_FEATURE_SAME_PROFILE_OOF_RETRAIN",
    });
    expect(new Set(metrics.map((p) => p.supergroupMapHash))).toEqual(
      new Set([graph.map.semanticHash]),
    );
  }, 60000);
  it("outer test labels cannot affect that fold's model, imputer, threshold or predictions", () => {
    const { f, graph, labels } = fixture(),
      test = c612Defined(f.folds.folds[0]);
    const a = retrainC6121Oof(f.frozen, graph.map, labels, SHA);
    const changed = structuredClone(labels);
    for (const row of changed.labels.filter((r) =>
      test.eventIds.includes(r.eventId),
    )) {
      row.label.normalizedGain = row.label.eligible ? 1000 : null;
      row.label.candidateNormalizedError = row.label.eligible ? 1000 : null;
    }
    const b = retrainC6121Oof(f.frozen, graph.map, changed, SHA);
    expect(
      b.models.models.filter((m) => m.outerFoldId === test.foldId),
    ).toEqual(a.models.models.filter((m) => m.outerFoldId === test.foldId));
    expect(
      b.thresholds.rows.filter((m) => m.outerFoldId === test.foldId),
    ).toEqual(a.thresholds.rows.filter((m) => m.outerFoldId === test.foldId));
    expect(b.rankings.rows.filter((m) => m.foldId === test.foldId)).toEqual(
      a.rankings.rows.filter((m) => m.foldId === test.foldId),
    );
    for (const model of a.models.models) {
      const fold = c612Defined(
        f.folds.folds.find((f) => f.foldId === model.outerFoldId),
      );
      expect(
        model.trainingEventIds.some((id) => fold.eventIds.includes(id)),
      ).toBe(false);
    }
  }, 60000);
  it.each(["fold", "raw-Gold", "duplicate", "eligibility"])(
    "fails closed on %s training input corruption",
    (mode) => {
      const { f, graph, labels } = fixture();
      const row = c612Defined(labels.labels.find((l) => l.oofTrainingEligible));
      if (mode === "fold") row.foldId = "wrong-fold";
      if (mode === "raw-Gold")
        Object.assign(row.label, { goldText: "must never be a feature" });
      if (mode === "duplicate") labels.labels.push(row);
      if (mode === "eligibility") row.oofTrainingEligible = false;
      expect(() => retrainC6121Oof(f.frozen, graph.map, labels, SHA)).toThrow();
    },
  );
});

// Explicit synthetic gate fixtures exercise fixed thresholds, not observed data.
function profile(id = "L6", changes = 5): C6121ProfileMetric {
  return {
    profileId: id,
    track: "SAME_FEATURE_SAME_PROFILE_OOF_RETRAIN",
    supergroupMapHash: SHA,
    changedSupergroups: changes,
    evaluableChangedSupergroups: changes,
    changedMachineGroups: changes,
    improved: changes,
    regressed: 0,
    neutral: 0,
    unknown: 0,
    selectionPrecision: changes ? 1 : null,
    harmRate: changes ? 0 : null,
    exactJointGain: changes,
    normalizedJointGain: changes,
    materialDelta: 0,
    legacyMaterialDelta: 0,
    catastrophicDeletionCount: 0,
    changedSupergroupCoverage: fraction(changes, changes),
    changedMachineGroupCoverage: fraction(changes, changes),
    zeroSelectionChangedCoverage: changes ? 1 : 0,
    activeFoldCount: changes ? 3 : 0,
    negativeGainFoldCount: 0,
    unknownGainFoldCount: 0,
    top1Accuracy: fraction(1, 1),
    folds: [],
    groups: [],
  };
}
function routeInput() {
  const { f, graph, labels } = fixture();
  const coverage: C6121Coverage = {
    evaluableSupergroupCoverage: fraction(10, 10),
    evaluableMachineGroupCoverage: fraction(10, 10),
    evaluableProductionCueCoverage: fraction(10, 10),
    evaluableGoldCueCoverage: fraction(10, 10),
    evaluableMachineDurationCoverage: fraction(20, 20),
    evaluableGoldDurationCoverage: fraction(20, 20),
    candidateEventLabelCoverage: fraction(10, 10),
    candidateLabelCoverage: fraction(20, 20),
    topKCandidateLabelCoverage: fraction(20, 20),
    evaluableGoldCharacterCoverage: null,
  };
  return {
    engineering: true,
    aBParity: true,
    productionMutation: 0,
    coverage,
    integrity: graph.integrity,
    frozen: [profile()],
    retrained: [profile()],
    completeness: diagnoseC6121Completeness(f.frozen, labels, [], [], true),
  };
}
describe("C6.1.2.1 predeclared profile and route gates", () => {
  it.each(["engineering", "parity", "production"])(
    "engineering invalid has priority for %s failure",
    (reason) => {
      const input = routeInput();
      if (reason === "engineering") input.engineering = false;
      if (reason === "parity") input.aBParity = false;
      if (reason === "production") input.productionMutation = 1;
      expect(decideC6121Route(input).route).toBe(
        "C6_1_2_1_ENGINEERING_INVALID",
      );
    },
  );
  it.each([
    "evaluableMachineGroupCoverage",
    "evaluableProductionCueCoverage",
    "evaluableGoldCueCoverage",
    "candidateEventLabelCoverage",
  ] as const)("requires >=80 percent %s", (key) => {
    const input = routeInput();
    input.coverage[key] = fraction(79, 100);
    expect(decideC6121Route(input).route).toBe(
      "EVALUATION_COVERAGE_STILL_INSUFFICIENT",
    );
  });
  it("zero selection retains null precision/harm and zero utility coverage", () => {
    const input = routeInput();
    input.retrained = [profile("L6", 0)];
    const result = decideC6121Route(input);
    expect(result.selectedSafeProfile).toBeNull();
    expect(result.evaluationCoverageGate).toBe(false);
    expect(input.retrained[0]?.selectionPrecision).toBeNull();
    expect(input.retrained[0]?.harmRate).toBeNull();
    expect(input.retrained[0]?.zeroSelectionChangedCoverage).toBe(0);
  });
  it("authorizes prospective shadow only after coverage and strong gates", () => {
    const result = decideC6121Route(routeInput());
    expect(result.route).toBe(
      "GO_C6_1_3_FROZEN_TOP_K_RERANKER_PROSPECTIVE_SHADOW",
    );
    expect(result.productionMutation).toBe(0);
  });
  it("uses completeness as a route only after evaluation coverage passes", () => {
    const input = routeInput();
    c612Defined(input.retrained[0]).catastrophicDeletionCount = 1;
    input.completeness.diagnosticMainBlocker = true;
    expect(decideC6121Route(input).route).toBe(
      "GO_C6_1_2_2_ACOUSTIC_COMPLETENESS_CALIBRATION",
    );
    input.coverage.evaluableGoldCueCoverage = fraction(1, 2);
    expect(decideC6121Route(input).route).toBe(
      "EVALUATION_COVERAGE_STILL_INSUFFICIENT",
    );
  });
  it("stops automatic reranking when covered but unsafe and not completeness-explained", () => {
    const input = routeInput();
    c612Defined(input.retrained[0]).catastrophicDeletionCount = 1;
    expect(decideC6121Route(input).route).toBe(
      "STOP_EXISTING_CANDIDATE_AUTOMATIC_RERANKING",
    );
  });
  it.each([
    "negative-fold",
    "unknown-fold",
    "catastrophic",
    "too-few",
    "negative-gain",
    "material",
    "low-precision",
    "high-harm",
  ])("does not grant strong support for %s", (reason) => {
    const input = routeInput(),
      p = c612Defined(input.retrained[0]);
    if (reason === "negative-fold") p.negativeGainFoldCount = 1;
    if (reason === "unknown-fold") p.unknownGainFoldCount = 1;
    if (reason === "catastrophic") p.catastrophicDeletionCount = 1;
    if (reason === "too-few") p.evaluableChangedSupergroups = 4;
    if (reason === "negative-gain") p.normalizedJointGain = -1;
    if (reason === "material") p.materialDelta = 1;
    if (reason === "low-precision") p.selectionPrecision = 0.84;
    if (reason === "high-harm") p.harmRate = 0.11;
    expect(decideC6121Route(input).rerankerStrongSupportGate).toBe(false);
  });
  it("selects by the fixed safety/tie-break rule rather than raw largest gain", () => {
    const lowHarm = profile("L4"),
      highGain = { ...profile("L3"), normalizedJointGain: 100, harmRate: 0.09 };
    expect([highGain, lowHarm].sort(c6121SafeProfileSort)[0]?.profileId).toBe(
      "L4",
    );
    expect(
      c6121SafeProfile({ ...highGain, catastrophicDeletionCount: 1 }),
    ).toBe(false);
  });
});
