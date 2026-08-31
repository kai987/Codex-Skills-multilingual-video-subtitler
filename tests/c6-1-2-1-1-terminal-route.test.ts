import { describe, expect, it } from "vitest";
import { c61211ProfileSchema, type C61211Profile } from "@mvl/shared";
import { c61211Fixture } from "./helpers/c61211-fixture.js";
import { SHA } from "./helpers/c612-fixture.js";
import { c612Defined } from "../packages/video-subtitler/src/consensus/top-k/c612-policy.js";
import { partitionC61211 } from "../packages/video-subtitler/src/consensus/evaluation-partition/monotonic-partition-solver.js";
import {
  auditC61211Conservation,
  auditC61211Cuts,
} from "../packages/video-subtitler/src/consensus/evaluation-partition/partition-audits.js";
import {
  reachableC61211Scope,
  coverageC61211,
  coverageC61211Gate,
} from "../packages/video-subtitler/src/consensus/evaluation-partition/reachable-coverage.js";
import {
  rebindC61211Labels,
  stabilityC61211,
} from "../packages/video-subtitler/src/consensus/evaluation-partition/partition-label-rebinding.js";
import { rebindC6121CandidateLabels } from "../packages/video-subtitler/src/consensus/evaluation-recovery/c6121-label-rebinding.js";
import {
  wholeC61211,
  biasC61211,
} from "../packages/video-subtitler/src/consensus/evaluation-partition/whole-component-diagnostic.js";
import {
  compareC61211SafeProfiles,
  completenessC61211,
  decideC61211Route,
} from "../packages/video-subtitler/src/consensus/evaluation-partition/terminal-route.js";
import { profileC61211Checks } from "../packages/video-subtitler/src/consensus/evaluation-partition/partition-profile-evaluation.js";
import {
  fraction,
  validateC61211Artifact,
} from "../packages/video-subtitler/src/consensus/evaluation-partition/c61211-policy.js";

// Pure, explicitly synthetic gate fixtures. They are never written as run data.
function profile(profileId = "L6", changes = 5): C61211Profile {
  return c61211ProfileSchema.parse({
    profileId,
    track: "SAME_FEATURE_SAME_PROFILE_OOF_RETRAIN",
    partitionMapHash: SHA,
    selectedCount: changes,
    changedBlocks: changes,
    evaluableChangedBlocks: changes,
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
    changedBlockCoverage: fraction(changes, changes),
    changedMachineGroupCoverage: fraction(changes, changes),
    activeFoldCount: changes ? 3 : 0,
    negativeGainFoldCount: 0,
    unknownGainFoldCount: 0,
    top1Accuracy: fraction(1, 1),
    folds: [],
    groups: [],
    safeProfileEligible: changes > 0,
  });
}
function fixture() {
  const f = c61211Fixture(),
    p = partitionC61211(f.input),
    gold = f.input.goldTiming.map((g) => ({ ...g, text: "明日は晴れ" })),
    labels = rebindC61211Labels(f.frozen, p.map, gold, SHA),
    old = rebindC6121CandidateLabels(f.frozen, p.graph.map, gold, SHA),
    conservation = auditC61211Conservation(f.input, p.map, p.graph),
    scope = reachableC61211Scope(f.frozen, p.graph),
    coverage = coverageC61211Gate(
      coverageC61211(f.frozen, p.map, scope, f.input.goldTiming),
      conservation,
    ),
    whole = wholeC61211({
      frozen: f.frozen,
      graph: p.graph,
      map: p.map,
      gold,
      tracks: [],
    }),
    bias = biasC61211(
      p.map,
      whole,
      conservation,
      auditC61211Cuts(p.map, p.graph),
      stabilityC61211(old, labels),
    );
  return {
    f,
    labels,
    input: {
      engineering: true,
      aBParity: true,
      productionMutation: 0,
      conservation,
      coverage,
      bias,
      frozen: [profile()],
      retrained: [profile()],
      completeness: completenessC61211(f.frozen, labels, [], [], true),
    },
  };
}
describe("C6.1.2.1.1 terminal gates are frozen, abstention-first and profile-independent", () => {
  it("rejects a relaxed primary gate even from an untyped caller", () => {
    const { input } = fixture();
    Object.assign(input.coverage, {
      primaryMode: "D2_RELAXED_DIAGNOSTIC_ONLY",
    });
    expect(() => decideC61211Route(input)).toThrow();
  });
  it.each(["engineering", "parity", "production", "bias", "conservation"])(
    "fails engineering closed for %s",
    (reason) => {
      const { input } = fixture();
      if (reason === "engineering") input.engineering = false;
      if (reason === "parity") input.aBParity = false;
      if (reason === "production") input.productionMutation = 1;
      if (reason === "bias") input.bias.passed = false;
      if (reason === "conservation") input.conservation.passed = false;
      expect(decideC61211Route(input).route).toBe(
        "C6_1_2_1_1_ENGINEERING_INVALID",
      );
    },
  );
  it("marks conservative partition coverage terminally unrecoverable, even if a diagnostic or profile looks good", () => {
    const { input } = fixture();
    input.coverage.passed = false;
    input.completeness.coverageQualifiedMainBlocker = true;
    const r = decideC61211Route(input);
    expect(r.route).toBe(
      "EVALUATION_PARTITION_UNRECOVERABLE_WITHOUT_UNSAFE_CUTS",
    );
    expect(r.selectedSafeProfile).toBeNull();
    expect(r.relaxedDiagnosticUsedForRoute).toBe(false);
    expect(r.reasons).toContain("NO_FURTHER_EVALUATOR_LOOSENING_ITERATION");
  });
  it("zero-selection L6 keeps precision/harm null without failing evaluator coverage", () => {
    const { input } = fixture();
    input.retrained = [profile("L6", 0)];
    const r = decideC61211Route(input);
    expect(r.evaluationCoverageGate).toBe(true);
    expect(r.selectedSafeProfile).toBeNull();
    expect(r.descriptiveBestRetrainedProfile).toBeNull();
    expect(r.route).toBe("STOP_EXISTING_CANDIDATE_AUTOMATIC_RERANKING");
    expect(input.retrained[0]?.selectionPrecision).toBeNull();
    expect(input.retrained[0]?.harmRate).toBeNull();
    expect(input.retrained[0]?.changedBlockCoverage.ratio).toBeNull();
  });
  it("requires all gates for prospective shadow and never changes production finalization", () => {
    const r = decideC61211Route(fixture().input);
    expect(r.route).toBe("GO_C6_1_3_FROZEN_TOP_K_RERANKER_PROSPECTIVE_SHADOW");
    expect(r.selectedSafeProfile).toBe("L6");
    expect(r.productionStatus).toBe("needs-review");
    expect(r.finalizationMethod).toBe("none");
    expect(r.productionMutation).toBe(0);
    expect(() => validateC61211Artifact(r)).not.toThrow();
  });
  it("can recommend completeness only after coverage passes and no safe profile exists", () => {
    const { input } = fixture();
    c612Defined(input.retrained[0]).catastrophicDeletionCount = 1;
    input.completeness.coverageQualifiedMainBlocker = true;
    expect(decideC61211Route(input).route).toBe(
      "GO_C6_1_2_2_ACOUSTIC_COMPLETENESS_CALIBRATION",
    );
    input.coverage.passed = false;
    expect(decideC61211Route(input).c6122).toBe("HOLD");
  });
  it.each([
    ["selectedCount", 0],
    ["evaluableChangedBlocks", 4],
    ["activeFoldCount", 2],
    ["negativeGainFoldCount", 1],
    ["unknownGainFoldCount", 1],
    ["selectionPrecision", 0.849],
    ["harmRate", 0.101],
    ["normalizedJointGain", 0],
    ["materialDelta", 1],
    ["catastrophicDeletionCount", 1],
  ] as const)("cannot label %s unsafe evidence a safe winner", (key, value) => {
    const p = profile();
    p[key] = value;
    expect(profileC61211Checks(p).every((c) => c.passed)).toBe(false);
    const { input } = fixture();
    input.retrained = [p];
    expect(decideC61211Route(input).selectedSafeProfile).toBeNull();
  });
  it.each(["changedBlockCoverage", "changedMachineGroupCoverage"] as const)(
    "requires >=80 percent nonempty %s",
    (key) => {
      const p = profile();
      p[key] = fraction(79, 100);
      expect(profileC61211Checks(p).every((c) => c.passed)).toBe(false);
      p[key] = fraction(80, 100);
      expect(profileC61211Checks(p).every((c) => c.passed)).toBe(true);
      p[key] = fraction(0, 0);
      expect(profileC61211Checks(p).every((c) => c.passed)).toBe(false);
    },
  );
  it("does not promote a frozen-track descriptive winner to a retrained safe selection", () => {
    const { input } = fixture();
    input.retrained = [profile("L6", 0)];
    const r = decideC61211Route(input);
    expect(r.descriptiveBestFrozenProfile).toBe("L6");
    expect(r.selectedSafeProfile).toBeNull();
  });
  it("uses the complete deterministic predeclared safe-profile tie break", () => {
    const a = profile("L2"),
      b = profile("L1");
    expect([a, b].toSorted(compareC61211SafeProfiles)[0]?.profileId).toBe("L1");
    for (const key of [
      "harmRate",
      "catastrophicDeletionCount",
      "materialDelta",
    ] as const) {
      const worse = { ...b, [key]: 1 };
      expect(compareC61211SafeProfiles(a, worse)).toBeLessThan(0);
    }
    for (const key of [
      "selectionPrecision",
      "normalizedJointGain",
      "activeFoldCount",
    ] as const) {
      const better = { ...a, [key]: (a[key] ?? 0) + 1 };
      expect(compareC61211SafeProfiles(better, b)).toBeLessThan(0);
    }
  });
  it("negative non-gated profiles do not prove completeness is the main blocker", () => {
    const { f, labels } = fixture(),
      p = profile("L1");
    p.normalizedJointGain = -1;
    p.catastrophicDeletionCount = 1;
    const d = completenessC61211(f.frozen, labels, [], [p], true);
    expect(d.diagnosticMainBlocker).toBe(false);
    expect(d.coverageQualifiedMainBlocker).toBe(false);
    expect(d.nonGatedNegativeGainProfiles).toContain("L1");
    expect(d.blockedSelectionOccurrences).toBe(0);
    expect(d.blockedUniqueCandidates).toBe(0);
  });
  it("positive non-gated gain with deletion risk is insufficient without known evidence shortage or false-block evidence", () => {
    const { f, labels } = fixture(),
      p = profile("L1");
    p.catastrophicDeletionCount = 1;
    const d = completenessC61211(f.frozen, labels, [], [p], false);
    expect(d.nonGatedPositiveUnsafeProfiles).toContain("L1");
    expect(d.coverageQualifiedMainBlocker).toBe(false);
    expect(d.noThresholdChange).toBe(true);
  });
});
