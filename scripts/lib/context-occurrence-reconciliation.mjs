/** Saved-evidence association only: never turn emissions or activity into cue timing. */
import assert from "node:assert/strict";
import { sharedWordCore } from "./context-word-alignment.mjs";
import { compareWordAlignments } from "./word-boundary-probe.mjs";
import { reviewAnchoredActivity } from "./anchored-activity-review.mjs";
import { planShortResponseDisplay } from "./short-response-display.mjs";

const key = (s) => s.normalize("NFC").replace(/[\p{P}\p{Z}\s]/gu, "");
const valid = (r) =>
  r &&
  Number.isFinite(r.start) &&
  Number.isFinite(r.end) &&
  r.start >= 0 &&
  r.end > r.start;
const contains = (a, b) => b.start >= a.start - 1e-6 && b.end <= a.end + 1e-6;
const overlaps = (a, b) => Math.min(a.end, b.end) > Math.max(a.start, b.start);
const span = (words) => ({
  start: words[0].sourceStart,
  end: words.at(-1).sourceEnd,
});

export function observationCoverage(window, interval) {
  assert(valid(window) && valid(interval), "INVALID_INTERVAL");
  return contains(window, interval)
    ? "covered"
    : overlaps(window, interval)
      ? "partial"
      : "outside-observation-window";
}

export function reconcileContextOccurrences(input) {
  assert.deepEqual(
    Object.keys(input).sort(),
    ["alignment", "anchoredInput", "requests", "sourceAudioHash"],
    "MACHINE_FIELDS_ONLY",
  );
  const { requests, alignment, anchoredInput, sourceAudioHash } = input;
  assert(/^[a-f0-9]{64}$/u.test(sourceAudioHash), "SOURCE_IDENTITY_REQUIRED");
  assert(
    Array.isArray(requests) &&
      requests.length === 2 &&
      new Set(requests.map((r) => r.id)).size === requests.length,
    "REQUEST_IDENTITY_MISMATCH",
  );
  for (const r of requests) {
    assert(
      Array.isArray(r.segments) &&
        r.segments.length &&
        Number.isInteger(r.targetSegmentIndex) &&
        r.targetSegmentIndex >= 0 &&
        r.targetSegmentIndex < r.segments.length,
      "INVALID_TARGET_SEGMENT",
    );
    assert(
      r.segments.every(
        (s, i) => s.wordStart === (i ? r.segments[i - 1].wordEnd : 0),
      ) && r.segments.at(-1).wordEnd === r.words.length,
      "SEGMENT_WORD_BINDING",
    );
  }
  const core = sharedWordCore(requests);
  assert.deepEqual(alignment.core, core, "CORE_BINDING_MISMATCH");
  assert.equal(
    alignment.full.length,
    requests.length,
    "ALIGNMENT_COUNT_MISMATCH",
  );
  const full = requests.map((r) => {
    assert(valid(r), "INVALID_REQUEST_WINDOW");
    const matches = alignment.full.filter((f) => f.id === r.id);
    assert.equal(matches.length, 1, "ALIGNMENT_REQUEST_BINDING");
    const f = matches[0];
    assert.deepEqual(
      f.intervals.map((w) => w.label),
      r.words,
      "WORD_SEQUENCE_MISMATCH",
    );
    assert(
      f.intervals.every(
        (w, i, all) =>
          valid({ start: w.sourceStart, end: w.sourceEnd }) &&
          contains(r, { start: w.sourceStart, end: w.sourceEnd }) &&
          (!i || w.sourceStart >= all[i - 1].sourceEnd - 1e-6),
      ),
      "INVALID_WORD_TIMEBASE",
    );
    assert(
      r.segments.every(
        (s) =>
          valid(s.originalInterval) &&
          contains(r, s.originalInterval) &&
          Number.isInteger(s.wordStart) &&
          Number.isInteger(s.wordEnd) &&
          s.wordEnd > s.wordStart &&
          s.wordStart >= 0 &&
          s.wordEnd <= r.words.length &&
          JSON.stringify(s.words) ===
            JSON.stringify(r.words.slice(s.wordStart, s.wordEnd)),
      ),
      "SEGMENT_WORD_BINDING",
    );
    return f;
  });
  const review = reviewAnchoredActivity(anchoredInput);
  const coreComparison = compareWordAlignments(
    full.map((f, i) => ({
      ...f,
      intervals: f.intervals.slice(
        core.mappings[i].start,
        core.mappings[i].end,
      ),
    })),
  );
  assert.deepEqual(
    alignment.coreComparison,
    coreComparison,
    "CORE_COMPARISON_BINDING",
  );
  const prefixes = requests.flatMap((r, i) => {
    const m = core.mappings[i],
      target = r.segments[r.targetSegmentIndex];
    if (m.start === target.wordStart) return [];
    const words = full[i].intervals.slice(target.wordStart, m.start),
      interval = span(words);
    const coverage = observationCoverage(anchoredInput.sourceWindow, interval);
    return [
      {
        id: `${r.id}:target-prefix`,
        requestId: r.id,
        text: words.map((w) => w.label).join(""),
        parentText: target.text,
        conditionalMfaInterval: interval,
        independentObservationCoverage: coverage,
        absenceCanReject: false,
        externalAnchorAtSamePosition: contains(interval, anchoredInput.anchor),
        otherContextViews: requests
          .filter((other) => other.id !== r.id)
          .map((other) => ({
            requestId: other.id,
            windowCoverage: observationCoverage(other, interval),
            targetText: other.segments[other.targetSegmentIndex].text,
            meaning: "transcript-difference-not-acoustic-rejection",
          })),
        route:
          coverage === "outside-observation-window"
            ? "retain-prefix-independent-window-missing"
            : "retain-prefix-local-evidence-unresolved",
        subtitleInterval: null,
      },
    ];
  });
  // Restrict to complete post-core segments. Never infer a character-level time split.
  const followingCandidates = requests.flatMap((r, i) =>
    r.segments.flatMap((s, index) => {
      if (s.wordStart < core.mappings[i].end) return [];
      const interval = span(full[i].intervals.slice(s.wordStart, s.wordEnd));
      const asrContainsAnchor = contains(
        s.originalInterval,
        anchoredInput.anchor,
      );
      const alignmentContainsAnchor = contains(interval, anchoredInput.anchor);
      const exactText = key(s.text) === key(anchoredInput.donor.text);
      return [
        {
          id: `${r.id}:segment:${index}`,
          requestId: r.id,
          text: s.text,
          originalAsrInterval: s.originalInterval,
          conditionalMfaInterval: interval,
          asrContainsAnchor,
          alignmentContainsAnchor,
          exactText,
          route:
            asrContainsAnchor && !alignmentContainsAnchor
              ? "asr-envelope-overlap-alignment-position-conflict"
              : alignmentContainsAnchor
                ? "same-position-conditional-candidate"
                : "separate-position-conditional-candidate",
          timingUsableForAnchoredResponse: false,
          textDifference: exactText ? null : "preserved-not-normalized-away",
          subtitleInterval: null,
        },
      ];
    }),
  );
  return {
    version: "context-occurrence-reconciliation-v1",
    sourceAudioHash,
    commonCore: coreComparison,
    inheritedContextWarnings: full.map((f) => ({
      requestId: f.id,
      blockers: f.blockers,
    })),
    prefixes,
    followingCandidates,
    anchoredResponse: {
      ...review,
      occurrenceId: `${sourceAudioHash}:${anchoredInput.anchor.start}:${anchoredInput.anchor.end}`,
      evidenceMeaning: {
        ctc: "one-model-family emission plus greedy diagnostic, not two independent votes",
        vad: "activity not utterance duration",
        mfa: "transcript-conditioned; conflict never overwrites emission anchor",
      },
      displayPreview: planShortResponseDisplay(anchoredInput),
    },
    newInference: 0,
    subtitleMutations: 0,
    automaticReplacementAllowed: false,
    qualityStatus: "needs-review",
    finalizationMethod: "none",
    referenceUsed: false,
  };
}
