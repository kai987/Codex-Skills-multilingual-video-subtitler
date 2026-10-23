import assert from "node:assert/strict";
import {
  inspectWordAlignment,
  compareWordAlignments,
} from "./word-boundary-probe.mjs";

export const extentPolicy = Object.freeze({
  version: "utterance-extent-v1",
  maxRequests: 2,
  maxSeconds: 8,
  expandedContext: 0.5,
  sideTolerance: 0.12,
  retries: 0,
  automaticMutation: false,
});
const overlap = (a, b) =>
  Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
const valid = (r) =>
  Number.isFinite(r.start) &&
  Number.isFinite(r.end) &&
  r.start >= 0 &&
  r.end > r.start;

export function planExtent(prior, baseline) {
  const requests = prior.association.requests;
  assert(
    requests.length === 2 && requests[0].targetId === requests[1].targetId,
    "ONE_TARGET_PAIR_REQUIRED",
  );
  assert(prior.timing.pair.stableWithin120ms, "UNSTABLE_CTC_ANCHOR");
  const narrow = requests.find((r) => r.id.endsWith("-narrow"));
  const wide = requests.find((r) => r.id.endsWith("-wide"));
  assert(narrow && wide && valid(narrow) && valid(wide), "INVALID_WINDOWS");
  assert(
    narrow.targetText && narrow.targetText === wide.targetText,
    "TEXT_CONFLICT",
  );
  const windows = [
    { id: "narrow", start: narrow.start, end: narrow.end },
    {
      id: "expanded",
      start: Math.max(wide.start, narrow.start - 0.5),
      end: Math.min(wide.end, narrow.end + 0.5),
    },
  ].map((w) => ({ ...w, frames: Math.round((w.end - w.start) * 16000) }));
  assert(windows[1].frames > windows[0].frames, "DISTINCT_WINDOWS_REQUIRED");
  assert(
    windows.reduce((s, w) => s + w.frames, 0) <= 8 * 16000,
    "AUDIO_BUDGET",
  );
  assert(baseline.every(valid), "INVALID_BASELINE");
  const neighborIds = baseline
    .filter((c) => windows.some((w) => overlap(c, w) > 0))
    .map((c) => c.id);
  assert.equal(neighborIds.length, 0, "NEIGHBOR_TEXT_OMITTED_FROM_WINDOW");
  return {
    policy: extentPolicy,
    targetId: narrow.targetId,
    text: narrow.targetText,
    windows,
    neighborIds,
    contextCoverage:
      "no-existing-machine-cue-in-window; unknown-speech-not-excluded",
    referenceUsed: false,
    labelsUsed: false,
  };
}

export function analyzeExtent(plan, raws, prior, baseline) {
  assert(
    raws.length === 2 && plan.windows.length === 2,
    "TWO_RESULTS_REQUIRED",
  );
  const results = raws.map((raw, i) =>
    inspectWordAlignment(raw, plan.windows[i], [plan.text]),
  );
  const pair = compareWordAlignments(results);
  const blockers = [...pair.blockers];
  const lexical = results[0].intervals;
  const candidate =
    lexical.length === 1
      ? {
          start: lexical[0].sourceStart,
          end: lexical[0].sourceEnd,
          text: plan.text,
        }
      : null;
  const anchors = prior.timing.emissionIntervals.map((r) => r.interval);
  if (
    !candidate ||
    anchors.length !== 2 ||
    !anchors.every(
      (a) =>
        a && valid(a) && a.start >= candidate.start && a.end <= candidate.end,
    )
  )
    blockers.push("CTC_ANCHOR_OUTSIDE_WORD");
  if (candidate && baseline.some((c) => overlap(c, candidate) > 0))
    blockers.push("NEIGHBOR_INTRUSION");
  const vad = prior.timing.vadIntervals.filter(
    (v) => candidate && overlap(v, candidate) > 0,
  );
  const sideAgreement =
    vad.length === 1 && candidate
      ? {
          startDelta: Math.abs(candidate.start - vad[0].start),
          endDelta: Math.abs(candidate.end - vad[0].end),
          startSupported:
            Math.abs(candidate.start - vad[0].start) <= 0.120000001,
          endSupported: Math.abs(candidate.end - vad[0].end) <= 0.120000001,
          meaning:
            "VAD activity agreement only; not independent lexical boundary truth",
        }
      : null;
  if (!sideAgreement?.startSupported)
    blockers.push("START_ACTIVITY_DISAGREEMENT");
  if (!sideAgreement?.endSupported) blockers.push("END_ACTIVITY_DISAGREEMENT");
  return {
    results,
    pair,
    wordInterval: candidate,
    sideAgreement,
    listeningProposal:
      pair.status === "STABLE_CONDITIONAL_WORD_INTERVALS" &&
      candidate &&
      !blockers.includes("CTC_ANCHOR_OUTSIDE_WORD") &&
      !blockers.includes("NEIGHBOR_INTRUSION")
        ? candidate
        : null,
    blockers: [
      ...new Set([...blockers, "UNVALIDATED_UTTERANCE_EXTENT_POLICY"]),
    ],
    textSource: "frozen-machine-consensus",
    timingSource: "MFA-word-phone-tiers",
    ctcRole: "occurrence-interior-anchor-not-word-boundary",
    vadRole: "activity-cross-check-not-transcript",
    subtitleMutationAuthorized: false,
    qualityStatus: "needs-review",
    finalizationMethod: "none",
  };
}
