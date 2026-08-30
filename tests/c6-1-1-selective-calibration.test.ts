import { describe, expect, test } from "vitest";
import {
  C611_CALIBRATION_FEATURE_NAMES,
  c611OofDecisionsSchema,
  type C611CalibrationLabel,
  type C611CalibrationSample,
  type C611Decision,
  type C611FoldUnit,
} from "@mvl/shared";
import { machineQualitySemanticHash as hash } from "../packages/video-subtitler/src/machine-quality/evidence-correlation.js";
import { c61Require } from "../packages/video-subtitler/src/consensus/japanese-text-representation.js";
import {
  buildC611Folds,
  partitionC611Contiguous,
  verifyC611Folds,
} from "../packages/video-subtitler/src/consensus/selective-mbr-folds.js";
import {
  c611CatastrophicDeletion,
  fitC611SelectiveModel,
  freezeC611CalibrationPolicy,
  predictC611SelectiveModel,
  prepareC611CalibrationSamples,
  selectC611Threshold,
  validateC611Samples,
} from "../packages/video-subtitler/src/consensus/selective-mbr-calibration.js";
import {
  c611CalibrationLabels,
  c611WilsonInterval,
  calculateC611SelectiveMetrics,
  runC611Oof,
} from "../packages/video-subtitler/src/consensus/selective-mbr-oof.js";
const policy = freezeC611CalibrationPolicy();
function sample(index: number, margin = 0.9): C611CalibrationSample {
  const values: Record<string, number | null> = Object.fromEntries(
    C611_CALIBRATION_FEATURE_NAMES.map((key) => [key, 0]),
  );
  Object.assign(values, {
    rawMbrMargin: margin,
    hierarchicalMbrMargin: margin,
    runnerUpMargin: margin,
    providerSupportCount: 2,
    correlationSupportCount: 2,
    whisperStability: 1,
    reazonStability: 1,
    crossModelAgreement: 1,
    speechCompleteness: 1,
    characterLengthRatio: 1,
    tokenLengthRatio: 1,
    normalizedLcsCoverage: 1,
    prefixRetention: 1,
    suffixRetention: 1,
    eventDuration: 2,
    charactersPerSecond: 4,
    normalizedDistance: 0.25,
    spanApplicationSafe: 1,
  });
  return {
    proposalId: `proposal-${index}`,
    eventId: `synthetic-event-${index}`,
    currentCandidateId: `current-${index}`,
    proposedCandidateId: `alternative-${index}`,
    eligibilityStatus: "ELIGIBLE",
    values,
    missingFlags: Object.fromEntries(
      C611_CALIBRATION_FEATURE_NAMES.map((key) => [key, false]),
    ),
    proposalHash: hash(["proposal", index]),
    featureHash: hash(values),
  };
}
function label(row: C611CalibrationSample, gain = 3): C611CalibrationLabel {
  const body = {
    proposalId: row.proposalId,
    eventId: row.eventId,
    groupIds: [`group-${row.eventId}`],
    groupIdentityHash: hash(row.eventId),
    outcome:
      gain > 0
        ? ("SWITCH_IMPROVES" as const)
        : gain < 0
          ? ("SWITCH_REGRESSES" as const)
          : ("SWITCH_NEUTRAL" as const),
    baselineError: 5,
    proposedError: 5 - gain,
    exactGain: gain,
    normalizedGain: gain,
  };
  return { ...body, semanticHash: hash(body) };
}
function unknown(row: C611CalibrationSample): C611CalibrationLabel {
  return {
    proposalId: row.proposalId,
    eventId: row.eventId,
    groupIds: [],
    groupIdentityHash: hash(row.eventId),
    outcome: "SWITCH_UNEVALUABLE",
    baselineError: null,
    proposedError: null,
    exactGain: null,
    normalizedGain: null,
    semanticHash: hash([row.eventId, "unknown"]),
  };
}
function unit(row: C611CalibrationSample, index: number): C611FoldUnit {
  return {
    eventId: row.eventId,
    proposalId: row.proposalId,
    sourceAudioIdentity: hash("synthetic-audio"),
    sourceInterval: { start: index * 10, end: index * 10 + 2 },
    acousticIntervals: [],
    cueIntervals: [{ start: index * 10, end: index * 10 + 2 }],
    finalCueIds: [`cue-${index}`],
    sharedSpanKeys: [],
  };
}
function fixture(count = 40) {
  const samples = Array.from({ length: count }, (_, i) =>
    sample(i, i % 4 < 2 ? 0.9 - (i % 4) * 0.1 : 0.1),
  );
  const labels = samples.map((row, i) =>
    label(row, i % 4 < 2 ? 3 : i % 4 === 2 ? -2 : 0),
  );
  const folds = buildC611Folds(samples.map(unit), policy);
  return {
    samples,
    labels,
    folds,
    policy,
    legacy: {
      samples: structuredClone(samples),
      labels: structuredClone(labels),
      selectedProposalIds: samples.map((row) => row.proposalId),
    },
  };
}
function selected(
  row: C611CalibrationSample,
  profileId: C611Decision["profileId"] = "S6",
): C611Decision {
  const body = {
    profileId,
    eventId: row.eventId,
    proposalId: row.proposalId,
    foldId: "outer-1",
    proposedCandidateId: row.proposedCandidateId,
    decisionScore: 0.9,
    threshold: 0.8,
    decision: "SELECT_EXISTING_CANDIDATE" as const,
    machineReasons: ["SYNTHETIC"],
    modelHash: hash("model"),
    policyHash: policy.semanticHash,
  };
  return { ...body, semanticHash: hash(body) };
}
describe("C6.1.1 pre-label grouped contiguous folds", () => {
  test("keeps overlapping core/request audio, cue spans and neighborhoods in one fold", () => {
    const rows = Array.from({ length: 12 }, (_, i) => sample(i));
    const units = rows.map(unit);
    c61Require(units[0]).acousticIntervals.push({ start: 9.8, end: 11 });
    c61Require(units[2]).finalCueIds = c61Require(units[3]).finalCueIds;
    c61Require(units[4]).sourceInterval = { start: 32.4, end: 34 };
    c61Require(units[4]).cueIntervals = [];
    const result = buildC611Folds(units, policy);
    const assignment = new Map(
      result.groups.flatMap((group) =>
        group.eventIds.map((id) => [id, group.foldId]),
      ),
    );
    expect(assignment.get(c61Require(rows[0]).eventId)).toBe(
      assignment.get(c61Require(rows[1]).eventId),
    );
    expect(assignment.get(c61Require(rows[2]).eventId)).toBe(
      assignment.get(c61Require(rows[3]).eventId),
    );
    expect(assignment.get(c61Require(rows[3]).eventId)).toBe(
      assignment.get(c61Require(rows[4]).eventId),
    );
    expect(
      result.audioLeakageCount +
        result.eventLeakageCount +
        result.cueLeakageCount,
    ).toBe(0);
    expect(result.frozenBeforeLabels).toBe(true);
    expect(buildC611Folds([...units].reverse(), policy).semanticHash).toBe(
      result.semanticHash,
    );
  });
  test("does not split a huge acoustic connected component to fake five folds", () => {
    const units = Array.from({ length: 10 }, (_, i) => unit(sample(i), i));
    for (const entry of units)
      entry.acousticIntervals = [{ start: 0, end: 100 }];
    const folds = buildC611Folds(units, policy);
    expect(folds.status).toBe("INSUFFICIENT_INDEPENDENT_GROUPS");
    expect(folds.foldCount).toBe(1);
    expect(c61Require(folds.groups[0]).eventIds).toHaveLength(10);
  });
  test("same event with two proposal observations cannot cross folds", () => {
    const units = Array.from({ length: 7 }, (_, i) => unit(sample(i), i));
    c61Require(units[6]).eventId = c61Require(units[0]).eventId;
    const folds = buildC611Folds(units, policy);
    expect(
      folds.groups.find((g) =>
        g.proposalIds.includes(c61Require(units[0]).proposalId),
      )?.proposalIds,
    ).toContain(c61Require(units[6]).proposalId);
  });
  test("partition is contiguous and freeze rejects relabelled folds", () => {
    expect(partitionC611Contiguous([1, 1, 4, 1, 1], 3, (x) => x)).toEqual([
      [1, 1],
      [4],
      [1, 1],
    ]);
    const { folds } = fixture();
    const changed = structuredClone(folds);
    c61Require(changed.groups[0]).foldId = "outer-5";
    expect(() => verifyC611Folds(changed, policy)).toThrow(
      "FOLD_FREEZE_MISMATCH",
    );
  });
  test("invalid intervals and shared cue across source identities fail closed", () => {
    const units = Array.from({ length: 6 }, (_, i) => unit(sample(i), i));
    c61Require(units[0]).sourceInterval.end = c61Require(
      units[0],
    ).sourceInterval.start;
    expect(() => buildC611Folds(units, policy)).toThrow(
      "INVALID_FOLD_INTERVAL",
    );
    c61Require(units[0]).sourceInterval.end = 2;
    c61Require(units[1]).sourceAudioIdentity = hash("another-audio");
    c61Require(units[1]).finalCueIds = c61Require(units[0]).finalCueIds;
    expect(() => buildC611Folds(units, policy)).toThrow(
      "SHARED_CUE_CROSSES_AUDIO",
    );
  });
});
describe("C6.1.1 train-only preprocessing and interpretable prediction", () => {
  test("strict feature allowlist excludes text, IDs-as-features and unknown-as-zero", () => {
    const row = sample(0);
    row.values.goldLabel = 1;
    expect(() => validateC611Samples([row])).toThrow("FEATURE_ALLOWLIST");
    delete row.values.goldLabel;
    row.values.ctcMargin = null;
    expect(() => validateC611Samples([row])).toThrow("MISSING_FLAG");
    row.missingFlags.ctcMargin = true;
    expect(validateC611Samples([row])).toHaveLength(1);
  });
  test("imputer and scaler use training observations only, with explicit all-missing evidence", () => {
    const rows = [sample(0), sample(1), sample(2)];
    c61Require(rows[0]).values.rawMbrMargin = 1;
    c61Require(rows[1]).values.rawMbrMargin = 3;
    c61Require(rows[2]).values.rawMbrMargin = null;
    c61Require(rows[2]).missingFlags.rawMbrMargin = true;
    for (const row of rows) {
      row.values.ctcMargin = null;
      row.missingFlags.ctcMargin = true;
    }
    const model = fitC611SelectiveModel(
      rows,
      rows.map((row, i) => label(row, i === 0 ? 3 : -1)),
      "S6",
      policy,
    );
    expect(
      model.preprocessing.find((x) => x.featureName === "rawMbrMargin"),
    ).toMatchObject({
      imputedValue: 2,
      mean: 2,
      observedCount: 2,
      missingCount: 1,
    });
    expect(
      model.preprocessing.find((x) => x.featureName === "ctcMargin"),
    ).toMatchObject({
      allMissing: true,
      missingCount: 3,
      observedCount: 0,
      imputedValue: 0,
    });
    const testRow = sample(99, 1e6);
    const before = model.semanticHash;
    expect(
      Number.isFinite(predictC611SelectiveModel(testRow, model, policy)),
    ).toBe(true);
    expect(model.semanticHash).toBe(before);
    expect(model.trainingProposalIds).not.toContain(testRow.proposalId);
  });
  test("unknown required margin abstains rather than becoming zero", () => {
    const row = sample(0);
    row.values.rawMbrMargin = null;
    row.missingFlags.rawMbrMargin = true;
    const model = fitC611SelectiveModel([], [], "S2", policy);
    expect(predictC611SelectiveModel(row, model, policy)).toBeNull();
  });
  test("foreign test label cannot be passed to a training partition", () => {
    expect(() =>
      fitC611SelectiveModel([sample(0)], [label(sample(99))], "S6", policy),
    ).toThrow("FOREIGN_LABEL_IN_TRAINING");
  });
  test("deterministic L2 logistic has no shuffle and no raw text parameters", () => {
    const { samples, labels } = fixture(12);
    const first = fitC611SelectiveModel(samples, labels, "S6", policy);
    const second = fitC611SelectiveModel(
      [...samples].reverse(),
      [...labels].reverse(),
      "S6",
      policy,
    );
    expect(first.semanticHash).toBe(second.semanticHash);
    expect(first.featureNames).toHaveLength(30);
    expect(first.coefficients).toHaveLength(60);
    expect(first.status).toBe("FITTED");
  });
  test("sample adapter preserves identity but not raw candidate text", () => {
    const row = sample(0);
    const samples = prepareC611CalibrationSamples(
      [{ ...row, semanticHash: row.proposalHash }],
      [{ ...row, semanticHash: row.featureHash }],
    );
    expect(samples[0]).toEqual(row);
  });
});
describe("C6.1.1 wrong-first nested threshold policy", () => {
  test("wrong switch first beats higher-coverage but harmful threshold", () => {
    const rows = [0.9, 0.8, 0.7, 0.6].map((score, i) => ({
      sample: sample(i),
      score,
      label: label(sample(i), i === 2 ? -1 : 3),
    }));
    const result = selectC611Threshold(rows, policy);
    expect(result.chosen).toMatchObject({
      selected: 2,
      correct: 2,
      wrong: 0,
      threshold: 0.8,
    });
  });
  test("zero selection is not an active winner; neutral is not positive", () => {
    const rows = [sample(0), sample(1), sample(2)].map((row) => ({
      sample: row,
      score: 0.9,
      label: label(row, 0),
    }));
    expect(selectC611Threshold(rows, policy).chosen).toBeNull();
    const single = [
      { sample: sample(0), score: 1, label: label(sample(0), 3) },
    ];
    expect(selectC611Threshold(single, policy).chosen).toBeNull();
  });
  test("catastrophic deletion requires regression and does not reject hallucination removal", () => {
    const row = sample(0);
    row.values.deletedCharacterRatio = 0.8;
    row.values.speechCompleteness = null;
    row.missingFlags.speechCompleteness = true;
    expect(c611CatastrophicDeletion(row, label(row, -3), policy)).toBe(true);
    expect(c611CatastrophicDeletion(row, label(row, 3), policy)).toBe(false);
    row.values.speechCompleteness = 1;
    row.missingFlags.speechCompleteness = false;
    expect(c611CatastrophicDeletion(row, label(row, -3), policy)).toBe(false);
  });
  test("label contradiction is rejected instead of training on inconsistent signs", () => {
    const wrong = label(sample(0), 3);
    wrong.outcome = "SWITCH_REGRESSES";
    expect(() => c611CalibrationLabels([wrong])).toThrow(
      "LABEL_GAIN_CONTRADICTION",
    );
  });
});
describe("C6.1.1 OOF identity, metrics and Wilson denominators", () => {
  test("each event has one test-only decision per profile and a full legacy control", () => {
    const input = fixture();
    const result = runC611Oof(input);
    expect(c611OofDecisionsSchema.safeParse(result).success).toBe(true);
    expect(result.decisions).toHaveLength(8 * input.samples.length);
    expect(
      result.profileMetrics.find((x) => x.profileId === "S0"),
    ).toMatchObject({
      selectedCount: 0,
      normalizedEditGain: 0,
      modelClass: "SAFE_NULL_BASELINE",
    });
    expect(
      result.profileMetrics.find((x) => x.profileId === "S1"),
    ).toMatchObject({
      selectedCount: 40,
      correctSwitchCount: 20,
      wrongSwitchCount: 10,
      neutralSwitchCount: 10,
      modelClass: "LEGACY_NONSELECTIVE_CONTROL",
    });
    expect(
      result.profileMetrics.find((x) => x.profileId === "S2"),
    ).toMatchObject({
      selectedCount: 20,
      correctSwitchCount: 20,
      wrongSwitchCount: 0,
      normalizedEditGain: 60,
    });
    expect(result.bestActiveProfile).not.toBeNull();
    for (const audit of result.calibrationAudits) {
      expect(audit.trainTestIntersectionCount).toBe(0);
      expect(
        audit.model.trainingEventIds.some((id) =>
          audit.outerTestEventIds.includes(id),
        ),
      ).toBe(false);
      for (const split of audit.innerSplits)
        expect(
          split.model.trainingProposalIds.some((id) =>
            split.testProposalIds.includes(id),
          ),
        ).toBe(false);
    }
  });
  test("changing an outer test fold's labels cannot alter that fold's prediction/model/threshold", () => {
    const input = fixture(20);
    const first = runC611Oof(input);
    const testEvents = new Set(c61Require(input.folds.folds[0]).eventIds);
    const changed = structuredClone(input);
    changed.labels = changed.samples.map((row) =>
      testEvents.has(row.eventId)
        ? label(row, -4)
        : c61Require(input.labels.find((x) => x.proposalId === row.proposalId)),
    );
    const second = runC611Oof(changed);
    const foldId = c61Require(input.folds.folds[0]).foldId;
    expect(second.decisions.filter((d) => d.foldId === foldId)).toEqual(
      first.decisions.filter((d) => d.foldId === foldId),
    );
    expect(
      second.calibrationAudits.filter((d) => d.outerFoldId === foldId),
    ).toEqual(first.calibrationAudits.filter((d) => d.outerFoldId === foldId));
  });
  test("an unevaluable test label does not turn a machine selection into KEEP", () => {
    const input = fixture(20);
    const event = c61Require(input.samples[0]);
    input.labels[0] = unknown(event);
    const result = runC611Oof(input);
    expect(
      result.decisions.find(
        (d) => d.profileId === "S2" && d.proposalId === event.proposalId,
      )?.decision,
    ).toBe("SELECT_EXISTING_CANDIDATE");
    expect(
      result.profileMetrics.find((m) => m.profileId === "S2")
        ?.selectedUnevaluableCount,
    ).toBe(1);
  });
  test("all neutral calibration returns no best active profile, not a manufactured success", () => {
    const input = fixture(15);
    input.labels = input.samples.map((s) => label(s, 0));
    const result = runC611Oof(input);
    expect(result.bestActiveProfile).toBeNull();
    expect(
      result.profileMetrics
        .filter((m) => m.profileId !== "S1")
        .every((m) => m.selectedCount === 0),
    ).toBe(true);
  });
  test("cross-fold fixed Gold groups must already be quarantined, never trigger fold adaptation", () => {
    const input = fixture(15);
    input.labels.forEach((l) => {
      l.groupIds = ["shared-evaluation-group"];
    });
    expect(() => runC611Oof(input)).toThrow(
      "EVALUABLE_FIXED_GROUP_CROSSES_FOLDS",
    );
  });
  test("metrics separate all selections, evaluated selections, neutral, harm and opportunity", () => {
    const samples = [sample(0), sample(1), sample(2), sample(3)];
    const labels = [
      label(c61Require(samples[0]), 3),
      label(c61Require(samples[1]), -2),
      label(c61Require(samples[2]), 0),
      unknown(c61Require(samples[3])),
    ];
    const metrics = calculateC611SelectiveMetrics({
      profileId: "S6",
      samples,
      labels,
      decisions: samples.map((s) => selected(s)),
      policy,
      candidateOracleAvailableGain: 10,
    });
    expect(metrics).toMatchObject({
      selectedCount: 4,
      evaluableSelectedCount: 3,
      selectedUnevaluableCount: 1,
      correctSwitchCount: 1,
      wrongSwitchCount: 1,
      neutralSwitchCount: 1,
      normalizedEditGain: 1,
      oracleAvailableGain: 3,
      selectiveCoverage: 1,
      allEligibleCoverage: 1,
      rawSelectedOverEvaluableRatio: 4 / 3,
      candidateOracleCaptureRate: 0.1,
    });
    expect(metrics.precision).toBeCloseTo(1 / 3);
    expect(metrics.harmRate).toBeCloseTo(1 / 3);
    expect(metrics.oracleCaptureRate).toBeCloseTo(1 / 3);
  });
  test("Wilson is a descriptive binomial interval, including zero selected", () => {
    expect(c611WilsonInterval(0, 0)).toMatchObject({
      lower: null,
      upper: null,
      n: 0,
    });
    expect(c611WilsonInterval(10, 10).lower).toBeCloseTo(0.7224672);
    expect(c611WilsonInterval(0, 10).upper).toBeCloseTo(0.2775328);
    expect(() => c611WilsonInterval(2, 1)).toThrow("INVALID_WILSON");
  });
});
