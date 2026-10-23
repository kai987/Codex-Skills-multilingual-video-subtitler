/** Evaluation only. Never imported into candidate generation or selection. */
import assert from "node:assert/strict";
import { assembleLocalRecovery } from "./vad-local-recovery.mjs";

const overlap = (a, b) => a.start < b.end && b.start < a.end;
const unique = (rows) => {
  assert.equal(
    new Set(rows.map((r) => r.id)).size,
    rows.length,
    "DUPLICATE_CASE",
  );
  return new Map(rows.map((r) => [r.id, r]));
};
function confusion(rows, predict) {
  const out = { TP: 0, FP: 0, TN: 0, FN: 0, unscored: 0 };
  for (const row of rows) {
    if (row.speechTruth === null) out.unscored++;
    else
      out[
        row.speechTruth
          ? predict(row)
            ? "TP"
            : "FN"
          : predict(row)
            ? "FP"
            : "TN"
      ]++;
  }
  return {
    ...out,
    precision: out.TP + out.FP ? out.TP / (out.TP + out.FP) : null,
    recall: out.TP + out.FN ? out.TP / (out.TP + out.FN) : null,
  };
}
export function boundaryError(interval, reference) {
  assert(
    [interval.start, interval.end, reference.start, reference.end].every(
      Number.isFinite,
    ),
  );
  assert(interval.end > interval.start && reference.end > reference.start);
  const round = (v) => Math.round(v * 1e6) / 1e6;
  return {
    startErrorSeconds: round(interval.start - reference.start),
    endErrorSeconds: round(interval.end - reference.end),
    durationErrorSeconds: round(
      interval.end - interval.start - (reference.end - reference.start),
    ),
  };
}
export function evaluateShortResponses(input) {
  const {
    manifest,
    labels,
    observations,
    decisions,
    baseline,
    candidate,
    confirmedId,
    confirmation,
    extent,
    tail,
  } = input;
  const obs = unique(observations),
    lab = unique(labels),
    dec = unique(decisions);
  const items = unique(manifest.items);
  assert.equal(items.size, obs.size, "OBSERVATION_COUNT");
  assert.equal(items.size, lab.size, "LABEL_COUNT");
  for (const id of dec.keys()) assert(items.has(id), "FOREIGN_DECISION");
  const gainMode = input.mode === "candidate-gain";
  assert(input.mode === undefined || gainMode, "UNKNOWN_EVALUATION_MODE");
  if (!gainMode) {
    assert.deepEqual(
      candidate,
      baseline,
      "BENCHMARK_REQUIRES_FROZEN_ZERO_INSERTION_BASELINE",
    );
    assert(
      decisions.every(
        (d) => d.status === "ABSTAIN" && d.insertions.length === 0,
      ),
      "UNSUPPORTED_RECOVERY_STATE",
    );
  }
  const gain = evaluateInsertionGain({
    baseline,
    candidate,
    decisions,
    manifest,
    labels,
    confirmedId,
    confirmation,
  });
  const rows = manifest.items.map((item) => {
    const o = obs.get(item.id),
      l = lab.get(item.id),
      d = dec.get(item.id);
    assert(o && l, "MISSING_CASE");
    assert.equal(l.audioHash, item.audioHash, "WRONG_LABEL_AUDIO");
    assert.equal(o.cohort, item.cohort, "WRONG_COHORT");
    assert(
      Number.isFinite(o.targetCoverageFraction) &&
        o.targetCoverageFraction >= 0 &&
        o.targetCoverageFraction <= 1,
    );
    assert.equal(
      o.targetSupported,
      o.targetCoverageFraction >= 0.5,
      "SUPPORT_CHANGED",
    );
    assert.equal(
      o.anyTargetOverlap,
      o.targetCoverageFraction > 0,
      "PARTIAL_CHANGED",
    );
    const speechTruth = ["speech", "mixed-speech"].includes(l.sound)
      ? true
      : ["noise", "effect", "music"].includes(l.sound)
        ? false
        : null;
    const target = { start: item.targetStart, end: item.targetEnd };
    const host = baseline.filter((c) => overlap(c, target));
    return {
      id: item.id,
      cohort: item.cohort,
      target,
      playback: { start: item.start, end: item.end },
      audio: item.audio,
      audioHash: item.audioHash,
      soundLabel: l.sound,
      relationLabel: l.relation,
      speechTruth,
      triage: o.targetSupported
        ? "supported"
        : o.anyTargetOverlap
          ? "partial"
          : "unsupported",
      targetCoverageFraction: o.targetCoverageFraction,
      baselineOverlappingCueIds: host.map((c) => c.id),
      baselineCoverageMeansCorrectText: false,
      asrStatus: d
        ? d.status === "CANDIDATE"
          ? "attempted-candidate"
          : "attempted-abstained"
        : "not-run",
      asrReason: d?.reason ?? null,
      donors: d?.donors ?? null,
      independentUtteranceBoundaryLabel:
        item.id === confirmedId ? confirmation : null,
      automaticInsertions: d?.insertions.length ?? 0,
      requiresUtteranceVerification:
        speechTruth === true && item.id !== confirmedId,
    };
  });
  const known = rows.find((r) => r.id === confirmedId);
  assert(known?.speechTruth, "CONFIRMED_SPEECH_MISSING");
  assert.equal(confirmation.authority, "explicit-human-confirmed-utterance");
  assert(
    confirmation.start >= known.playback.start &&
      confirmation.end <= known.playback.end &&
      confirmation.end > confirmation.start,
    "CONFIRMATION_OUTSIDE_PLAYBACK",
  );
  assert.equal(
    known.baselineOverlappingCueIds.length,
    0,
    "KNOWN_MISSING_BASELINE_CHANGED",
  );
  const groups = {};
  for (const cohort of ["all", "ranked", "reserve"]) {
    const subset = rows.filter((r) => cohort === "all" || r.cohort === cohort);
    groups[cohort] = {
      initialCandidates: confusion(subset, () => true),
      vadSupported: confusion(subset, (r) => r.triage === "supported"),
      triageRetainedSpeechReview: confusion(
        subset,
        (r) => r.triage !== "unsupported",
      ),
    };
  }
  const boundary = extent.results.map((r) => {
    assert.equal(r.intervals.length, 1);
    const w = r.intervals[0];
    return {
      method: "MFA-" + r.id,
      interval: { start: w.sourceStart, end: w.sourceEnd },
      ...boundaryError(
        { start: w.sourceStart, end: w.sourceEnd },
        confirmation,
      ),
      unit: confirmedId,
      authorizedSubtitleTiming: false,
    };
  });
  const reasons = {};
  for (const d of decisions) reasons[d.reason] = (reasons[d.reason] ?? 0) + 1;
  return {
    version: gainMode
      ? "short-response-development-benchmark-v2"
      : "short-response-development-benchmark-v1",
    insertionEvaluation: gain,
    rows,
    groups,
    summary: {
      samples: rows.length,
      uniqueAudioSeconds:
        Math.round(
          rows.reduce((n, r) => n + r.playback.end - r.playback.start, 0) * 100,
        ) / 100,
      soundCounts: Object.fromEntries(
        [
          "speech",
          "mixed-speech",
          "noise",
          "effect",
          "music",
          "uncertain",
          "pending",
        ].map((s) => [s, rows.filter((r) => r.soundLabel === s).length]),
      ),
      asrAttempted: decisions.length,
      asrNotRun: rows.length - decisions.length,
      asrReasons: reasons,
      machineCorrectInsertions: gain.correct,
      machineFalseInsertions: gain.false,
      machineTimingFailedInsertions: gain.timingFailed,
      machineUnscoredInsertions: gain.unscored,
      insertionPrecision: gain.scoredPrecision,
      insertionPrecisionReason: gain.precisionReason,
      confirmedMissingUtterances: 1,
      machineRecoveredKnownMissing: gain.recoveredKnownMissing,
      humanAssistedInsertionsExcluded: 1,
      speechUnitsNeedingUtteranceVerification: rows.filter(
        (r) => r.requiresUtteranceVerification,
      ).length,
      humanWholeUtteranceBoundaryLabels: 1,
      boundaryLabelsMissingForSpeech:
        rows.filter((r) => r.speechTruth).length - 1,
      independentGeneralizationAccuracy: null,
      musicLabeledControls: rows.filter((r) => r.soundLabel === "music").length,
    },
    boundaries: {
      referenceRole:
        "explicit-user-estimated-whole-utterance-interval-not-sample-perfect-acoustic-truth",
      methods: boundary,
      pcmTail: tail.windows.map((w) => ({
        id: w.id,
        status: w.status,
        selectedEnd: w.sourceSelectedEnd,
        candidates: w.sourceCandidates.map((c) => c.sourceEnd),
      })),
      scoredUtterances: 1,
      notes:
        "Two windows are one occurrence, not two independent samples. CTC spikes and VAD activity are not scored as lexical extent.",
    },
    validity: {
      fixedSampleSource: "all-existing-16-listening-items-no-outcome-selection",
      labelsPreviouslyExposed: true,
      independentHoldout: false,
      silenceNoiseEffectNotGuaranteedMusicControl: true,
      noNewInference: true,
      subtitleMutations: gain.insertions,
      automaticPipelineChanged: false,
      qualityStatus: "needs-review",
      finalizationMethod: "none",
    },
  };
}

/** Evaluation-only: require exact materialization, then score only explicit labels. */
export function evaluateInsertionGain({
  baseline,
  candidate,
  decisions,
  manifest,
  labels,
  confirmedId,
  confirmation,
}) {
  unique(baseline);
  unique(candidate);
  unique(decisions);
  const items = unique(manifest.items),
    lab = unique(labels);
  for (const d of decisions) {
    assert(items.has(d.id), "FOREIGN_DECISION");
    assert(
      ["CANDIDATE", "ABSTAIN"].includes(d.status),
      "INVALID_DECISION_STATUS",
    );
    assert(Array.isArray(d.insertions), "INSERTIONS_REQUIRED");
    assert(
      d.status === "CANDIDATE"
        ? d.insertions.length > 0
        : d.insertions.length === 0,
      "DECISION_INSERTION_MISMATCH",
    );
  }
  assert.deepEqual(
    candidate,
    assembleLocalRecovery(baseline, decisions),
    "UNACCOUNTED_CANDIDATE_CHANGE",
  );
  assert.equal(confirmation.authority, "explicit-human-confirmed-utterance");
  const known = items.get(confirmedId);
  assert(
    known &&
      Number.isFinite(confirmation.start) &&
      Number.isFinite(confirmation.end) &&
      confirmation.end > confirmation.start &&
      confirmation.start >= known.start &&
      confirmation.end <= known.end,
    "CONFIRMATION_OUTSIDE_PLAYBACK",
  );
  const norm = (s) => s.normalize("NFKC").replace(/[\p{P}\p{Z}\s]/gu, "");
  assert(
    typeof confirmation.text === "string" && norm(confirmation.text),
    "EMPTY_CONFIRMATION",
  );
  // Evaluation tolerance, NOT a generation or permission threshold.
  const boundaryToleranceSeconds = 0.25;
  let matched = false;
  const rows = [];
  for (const d of decisions)
    for (const r of d.insertions) {
      const item = items.get(d.id),
        label = lab.get(d.id);
      assert(label?.audioHash === item.audioHash, "WRONG_LABEL_AUDIO");
      const row = {
        id: r.id,
        unitId: d.id,
        status: "unscored",
        reason: "NO_COMPLETE_UTTERANCE_LABEL",
        boundary: null,
      };
      if (d.id === confirmedId) {
        if (!overlap(r, confirmation))
          Object.assign(row, { status: "false", reason: "WRONG_OCCURRENCE" });
        else if (norm(r.text) !== norm(confirmation.text))
          Object.assign(row, { status: "false", reason: "TEXT_MISMATCH" });
        else if (matched)
          Object.assign(row, { status: "false", reason: "DUPLICATE_RECOVERY" });
        else {
          row.boundary = boundaryError(r, confirmation);
          const acceptable =
            Math.abs(row.boundary.startErrorSeconds) <=
              boundaryToleranceSeconds &&
            Math.abs(row.boundary.endErrorSeconds) <= boundaryToleranceSeconds;
          Object.assign(row, {
            status: acceptable ? "correct" : "timing-failed",
            reason: acceptable
              ? "KNOWN_MISSING_RECOVERED"
              : "TEXT_MATCH_BOUNDARY_FAILED",
          });
          // One occurrence cannot earn multiple successes; a truncated match also claims it.
          matched = true;
        }
      } else if (
        ["noise", "effect"].includes(label.sound) &&
        r.start >= item.targetStart &&
        r.end <= item.targetEnd
      ) {
        Object.assign(row, {
          status: "false",
          reason: "INSIDE_VERIFIED_NON_SPEECH_TARGET",
        });
      }
      rows.push(row);
    }
  const count = (s) => rows.filter((r) => r.status === s).length;
  const correct = count("correct"),
    falseCount = count("false"),
    timingFailed = count("timing-failed"),
    scored = correct + falseCount + timingFailed;
  return {
    rows,
    insertions: rows.length,
    correct,
    false: falseCount,
    timingFailed,
    unscored: count("unscored"),
    scoredPrecision: scored ? correct / scored : null,
    precisionReason: scored
      ? "SCORED_INSERTIONS_ONLY"
      : rows.length
        ? "NO_SCORABLE_INSERTIONS"
        : "NO_MACHINE_INSERTIONS",
    scoredFraction: rows.length ? scored / rows.length : null,
    recoveredKnownMissing: correct,
    remainingKnownMissing: 1 - correct,
    boundaryToleranceSeconds,
    wholeEpisodeAccuracy: null,
  };
}
