import { describe, expect, test } from "vitest";
import {
  C611_CALIBRATION_FEATURE_NAMES,
  c611SelectiveMbrFreezeSchema,
  type C611CalibrationSample,
  type C611CalibrationLabel,
  type C611Decision,
  type C611RouteInput,
  type C611RouteProfileEvidence,
  type C611CalibrationProfileId,
} from "@mvl/shared";
import { machineQualitySemanticHash as hash } from "../packages/video-subtitler/src/machine-quality/evidence-correlation.js";
import { freezeC611Policy } from "../packages/video-subtitler/src/consensus/c611-policy.js";
import { freezeC611CalibrationPolicy } from "../packages/video-subtitler/src/consensus/selective-mbr-calibration.js";
import { buildC611Folds } from "../packages/video-subtitler/src/consensus/selective-mbr-folds.js";
import { calculateC611SelectiveMetrics } from "../packages/video-subtitler/src/consensus/selective-mbr-oof.js";
import {
  createC611FutureModelFreeze,
  decideC611SelectiveRoute,
} from "../packages/video-subtitler/src/consensus/selective-mbr-route-decision.js";
import { c61Require } from "../packages/video-subtitler/src/consensus/japanese-text-representation.js";
const calibration = freezeC611CalibrationPolicy();
const policy = freezeC611Policy({
  fixedAlignment: { synthetic: true },
  machine: { existingOnly: true },
  calibration,
  oracle: { synthetic: true },
});
const baseline = {
  exactCer: 0.6601049868766404,
  normalizedCer: 0.6015625,
  coverage: 0.96484375,
  missing: 6,
  hallucination: 1,
  materialErrors: 77,
  cueCount: 161,
  severeTiming: 53,
  startMae: 1.6,
  endMae: 1.6,
  boundaryP95: 5.3,
  medianIoU: 0.58,
  overlap: 37,
};
function samples(): C611CalibrationSample[] {
  return Array.from({ length: 20 }, (_, i) => {
    const values: Record<string, number | null> = Object.fromEntries(
      C611_CALIBRATION_FEATURE_NAMES.map((k) => [k, 0]),
    );
    values.rawMbrMargin = i % 2 === 0 ? 0.9 : 0.1;
    values.hierarchicalMbrMargin = values.rawMbrMargin;
    values.speechCompleteness = 1;
    values.spanApplicationSafe = 1;
    return {
      proposalId: `p-${i}`,
      eventId: `event-${i}`,
      currentCandidateId: `current-${i}`,
      proposedCandidateId: `alternative-${i}`,
      eligibilityStatus: "ELIGIBLE",
      values,
      missingFlags: Object.fromEntries(
        C611_CALIBRATION_FEATURE_NAMES.map((k) => [k, false]),
      ),
      proposalHash: hash(["proposal", i]),
      featureHash: hash(values),
    };
  });
}
function labels(
  rows: C611CalibrationSample[],
  gain: (i: number) => number = () => 3,
): C611CalibrationLabel[] {
  return rows.map((row, i) => {
    const g = gain(i);
    return {
      proposalId: row.proposalId,
      eventId: row.eventId,
      groupIds: [`group-${i}`],
      groupIdentityHash: hash(i),
      outcome:
        g > 0
          ? "SWITCH_IMPROVES"
          : g < 0
            ? "SWITCH_REGRESSES"
            : "SWITCH_NEUTRAL",
      baselineError: 5,
      proposedError: 5 - g,
      normalizedGain: g,
      exactGain: g,
      semanticHash: hash([i, g]),
    };
  });
}
function profile(
  profileId: C611CalibrationProfileId,
  selectedCount = 0,
  wrong = 0,
): C611RouteProfileEvidence {
  const rows = samples(),
    ls = labels(rows, (i) => (i < wrong ? -1 : 3));
  const decisions: C611Decision[] = rows.map((row, i) => ({
    profileId,
    eventId: row.eventId,
    proposalId: row.proposalId,
    foldId: `outer-${Math.floor(i / 4) + 1}`,
    proposedCandidateId: row.proposedCandidateId,
    decisionScore: 0.9,
    threshold: 0.8,
    decision: i < selectedCount ? "SELECT_EXISTING_CANDIDATE" : "KEEP_CURRENT",
    machineReasons: ["SYNTHETIC"],
    modelHash: hash("model"),
    policyHash: calibration.semanticHash,
    semanticHash: hash([profileId, i]),
  }));
  return {
    profileId,
    oof: calculateC611SelectiveMetrics({
      profileId,
      samples: rows,
      labels: ls,
      decisions,
      policy: calibration,
    }),
    changedGroupCount: selectedCount ? 10 : 0,
    mappedChangedGroupCount: selectedCount ? 9 : 0,
    jointNormalizedGain: selectedCount ? 10 : 0,
    jointExactGain: selectedCount ? 8 : 0,
    quality: {
      ...baseline,
      normalizedCer: selectedCount ? 0.59 : baseline.normalizedCer,
    },
    foldJointGains: Array.from({ length: 5 }, (_, i) => {
      const count = Math.max(0, Math.min(4, selectedCount - 4 * i));
      return {
        foldId: `outer-${i + 1}`,
        selectedCount: count,
        evaluableSelectedCount: count,
        normalizedGain: count ? 2 : 0,
      };
    }),
  };
}
function input(): C611RouteInput {
  return {
    policy,
    baselineMetrics: baseline,
    baselineHash: hash("baseline"),
    expectedFoldIds: Array.from({ length: 5 }, (_, i) => `outer-${i + 1}`),
    profiles: calibration.profiles.map((p) =>
      profile(p.profileId, p.profileId === "S2" ? 10 : 0),
    ),
    engineering: {
      baselineReplayPassed: true,
      fixedMappingValid: true,
      featureFreezeValid: true,
      foldFreezeValid: true,
      goldBarrierValid: true,
      oofIsolationValid: true,
      candidateProvenanceValid: true,
      aBDeterministic: true,
      productionFilesUnchanged: true,
      productionTextMutation: 0,
      productionTimingMutation: 0,
      unsupportedTokenCount: 0,
      unsupportedAdjacencyCount: 0,
      missingProvenanceCount: 0,
      novelApplicationCount: 0,
      sourceReadOnly: true,
      goldReadOnly: true,
    },
  };
}
const s2 = (x: C611RouteInput) =>
  c61Require(x.profiles.find((p) => p.profileId === "S2"));

describe("C6.1.1 actual joint-shadow route gates", () => {
  test("strong support requires every engineering and unique-group quality gate", () => {
    const result = decideC611SelectiveRoute(input());
    expect(result).toMatchObject({
      outcome: "SELECTIVE_EXISTING_CANDIDATE_MBR_SUPPORTED",
      selectedProfile: "S2",
      futureModelTrainingAuthorized: true,
      nextRoute: "GO_C6_1_2_FROZEN_PROSPECTIVE_SHADOW",
      productionStatus: "needs-review",
      machineOnlyReleaseAuthorized: false,
      c602Status: "HOLD",
    });
  });
  test("engineering failure has precedence over excellent quality", () => {
    const x = input();
    x.engineering.oofIsolationValid = false;
    expect(decideC611SelectiveRoute(x).outcome).toBe(
      "SELECTIVE_MBR_ENGINEERING_INVALID",
    );
    x.engineering.oofIsolationValid = true;
    x.engineering.novelApplicationCount = 1;
    expect(decideC611SelectiveRoute(x).outcome).toBe(
      "SELECTIVE_MBR_ENGINEERING_INVALID",
    );
  });
  test("lower total CER cannot hide material error regression", () => {
    const x = input();
    s2(x).quality.materialErrors = 78;
    s2(x).quality.normalizedCer = 0.1;
    const route = decideC611SelectiveRoute(x);
    expect(route.outcome).toBe("SELECTIVE_MBR_NOT_SUPPORTED");
    expect(route.futureModelTrainingAuthorized).toBe(false);
  });
  test("proposal counterfactual gain does not replace zero or negative joint gain", () => {
    const x = input();
    expect(s2(x).oof.normalizedEditGain).toBeGreaterThan(0);
    s2(x).jointNormalizedGain = -1;
    expect(decideC611SelectiveRoute(x).outcome).toBe(
      "SELECTIVE_MBR_NOT_SUPPORTED",
    );
  });
  test("an active negative-gain fold blocks strong even with positive pooled gain", () => {
    const x = input();
    c61Require(s2(x).foldJointGains[0]).normalizedGain = -1;
    const route = decideC611SelectiveRoute(x);
    expect(route.outcome).toBe("SELECTIVE_MBR_PROMISING_BUT_NOT_PROVEN");
    expect(route.profiles.find((p) => p.profileId === "S2")).toMatchObject({
      negativeActiveFoldCount: 1,
      strongPassed: false,
    });
  });
  test("unknown active fold gains never silently become zero", () => {
    const x = input();
    c61Require(s2(x).foldJointGains[0]).normalizedGain = null;
    expect(
      decideC611SelectiveRoute(x).profiles.find((p) => p.profileId === "S2"),
    ).toMatchObject({ unknownActiveFoldCount: 1, strongPassed: false });
  });
  test("promising allows small harm but never material increase", () => {
    const x = input();
    x.profiles = x.profiles.map((p) =>
      p.profileId === "S2" ? profile("S2", 10, 1) : p,
    );
    expect(decideC611SelectiveRoute(x).outcome).toBe(
      "SELECTIVE_MBR_PROMISING_BUT_NOT_PROVEN",
    );
    s2(x).quality.materialErrors = 78;
    expect(decideC611SelectiveRoute(x).outcome).toBe(
      "SELECTIVE_MBR_NOT_SUPPORTED",
    );
  });
  test("coverage between 70 and 80 percent is not strong/promising; below70 is insufficient", () => {
    const x = input();
    s2(x).changedGroupCount = 100;
    s2(x).mappedChangedGroupCount = 75;
    expect(decideC611SelectiveRoute(x).outcome).toBe(
      "SELECTIVE_MBR_NOT_SUPPORTED",
    );
    s2(x).mappedChangedGroupCount = 69;
    expect(decideC611SelectiveRoute(x).outcome).toBe(
      "EVALUATION_COVERAGE_INSUFFICIENT",
    );
  });
  test("S0 and S1 cannot become the best active selective model", () => {
    const x = input();
    x.profiles = x.profiles.map((p) =>
      profile(
        p.profileId,
        p.profileId === "S0" || p.profileId === "S1" ? 10 : 0,
      ),
    );
    const route = decideC611SelectiveRoute(x);
    expect(route.selectedProfile).toBeNull();
    expect(route.strongProfiles).toEqual([]);
    expect(route.futureModelTrainingAuthorized).toBe(false);
  });
  test("too few effective selections cannot claim an active success", () => {
    const x = input();
    x.profiles = x.profiles.map((p) =>
      p.profileId === "S2" ? profile("S2", 4) : p,
    );
    expect(decideC611SelectiveRoute(x).selectedProfile).toBeNull();
  });
  test("missing fold evidence, stale metric hashes, or contradictory counts invalidate engineering", () => {
    const x = input();
    s2(x).foldJointGains.pop();
    expect(decideC611SelectiveRoute(x).outcome).toBe(
      "SELECTIVE_MBR_ENGINEERING_INVALID",
    );
    const y = input();
    s2(y).oof.wrongSwitchCount = 2;
    expect(decideC611SelectiveRoute(y).outcome).toBe(
      "SELECTIVE_MBR_ENGINEERING_INVALID",
    );
  });
  test("strong checks hallucination, missing, coverage, and CER against actual baseline", () => {
    for (const key of [
      "hallucination",
      "missing",
      "coverage",
      "normalizedCer",
    ] as const) {
      const x = input();
      if (key === "coverage") s2(x).quality[key] = 0.9;
      else if (key === "normalizedCer")
        s2(x).quality[key] = baseline.normalizedCer;
      else s2(x).quality[key] = baseline[key] + 1;
      expect(
        decideC611SelectiveRoute(x).profiles.find((p) => p.profileId === "S2")
          ?.strongPassed,
      ).toBe(false);
    }
  });
});

function futureInput() {
  const rows = samples(),
    ls = labels(rows, (i) => (i % 2 === 0 ? 3 : -2));
  const folds = buildC611Folds(
    rows.map((s, i) => ({
      eventId: s.eventId,
      proposalId: s.proposalId,
      sourceAudioIdentity: hash("source"),
      sourceInterval: { start: i * 10, end: i * 10 + 2 },
      acousticIntervals: [],
      cueIntervals: [],
      finalCueIds: [`cue-${i}`],
      sharedSpanKeys: [],
    })),
    calibration,
  );
  return {
    route: decideC611SelectiveRoute(input()),
    policy,
    calibrationPolicy: calibration,
    samples: rows,
    labels: ls,
    folds,
    machineFeatureFreezeHash: hash("machine-freeze"),
    featureTableHash: hash("features"),
    proposalHash: hash("proposals"),
    sourceOofHash: hash("oof"),
  };
}
describe("C6.1.1 conditional future-only model freeze", () => {
  test("strong route permits deterministic grouped calibration then full refit, never OOF rewriting", () => {
    const args = futureInput();
    const first = createC611FutureModelFreeze(args),
      second = createC611FutureModelFreeze(args);
    expect(first.semanticHash).toBe(second.semanticHash);
    expect(c611SelectiveMbrFreezeSchema.safeParse(first).success).toBe(true);
    expect(first).toMatchObject({
      status: "AVAILABLE_FUTURE_ONLY",
      frozenModelCreated: true,
      noOofMetricsRewritten: true,
      inSampleQualityClaimAllowed: false,
      useRestriction:
        "POST_EVALUATION_EXPLORATORY_FUTURE_PROSPECTIVE_SHADOW_ONLY",
    });
    expect(first.model?.trainingProposalIds).toHaveLength(20);
    expect(first.threshold).not.toBeNull();
    expect(first.modelHash).not.toBeNull();
    for (const split of first.calibrationSummary.splits)
      expect(
        split.trainProposalIds.some((id) =>
          split.heldOutProposalIds.includes(id),
        ),
      ).toBe(false);
  });
  test("failed route creates no full-data model, threshold, or calibration predictions", () => {
    const args = futureInput(),
      bad = input();
    s2(bad).quality.materialErrors = 78;
    args.route = decideC611SelectiveRoute(bad);
    const result = createC611FutureModelFreeze(args);
    expect(result).toMatchObject({
      status: "UNAVAILABLE",
      frozenModelCreated: false,
      model: null,
      threshold: null,
      modelHash: null,
      thresholdHash: null,
    });
    expect(
      result.calibrationSummary.futureThresholdCalibrationPredictionCount,
    ).toBe(0);
  });
  test("passing route alone cannot manufacture an available threshold", () => {
    const args = futureInput();
    args.labels = labels(args.samples, () => 0);
    const result = createC611FutureModelFreeze(args);
    expect(result).toMatchObject({
      status: "UNAVAILABLE",
      reason: "NO_ACTIVE_FULL_DATA_CALIBRATION_THRESHOLD",
      frozenModelCreated: false,
      model: null,
      threshold: null,
    });
  });
  test("future model/threshold identities bind machine, feature, fold and policy identities", () => {
    const args = futureInput();
    const first = createC611FutureModelFreeze(args);
    args.featureTableHash = hash("different-features");
    const changed = createC611FutureModelFreeze(args);
    expect(changed.modelHash).not.toBe(first.modelHash);
    expect(changed.thresholdHash).not.toBe(first.thresholdHash);
    expect(changed.model?.semanticHash).toBe(first.model?.semanticHash);
  });
  test("unavailable schema cannot claim an available model with null fields", () => {
    const args = futureInput();
    args.labels = labels(args.samples, () => 0);
    const unavailable = createC611FutureModelFreeze(args);
    expect(
      c611SelectiveMbrFreezeSchema.safeParse({
        ...unavailable,
        frozenModelCreated: true,
      }).success,
    ).toBe(false);
  });
});
