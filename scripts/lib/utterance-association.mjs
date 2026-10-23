/** Link saved hypotheses to nearby machine cues; activity is not an utterance. */
import assert from "node:assert/strict";
import { normalizeSpeech } from "./speech-support-policy.mjs";
import { summarizeTimingPair } from "./local-acoustic-policy.mjs";

export const associationPolicy = Object.freeze({
  version: "utterance-association-v1",
  narrowContext: 0.75,
  maxTargets: 1,
  maxRequests: 2,
  maxSeconds: 12,
  retries: 0,
  subtitleMutationAuthorized: false,
});
const overlaps = (a, b) => a.start < b.end && b.start < a.end;
const valid = (r) =>
  Number.isFinite(r.start) &&
  Number.isFinite(r.end) &&
  r.start >= 0 &&
  r.end > r.start &&
  typeof r.text === "string" &&
  normalizeSpeech(r.text);

export function associateUtterance(probe, baseline, views) {
  assert(baseline.every(valid), "INVALID_BASELINE");
  assert(
    Number.isFinite(probe.start) &&
      Number.isFinite(probe.end) &&
      probe.start >= 0 &&
      probe.end > probe.start &&
      probe.targetStart >= probe.start &&
      probe.targetEnd <= probe.end &&
      probe.targetEnd > probe.targetStart,
    "INVALID_PROBE",
  );
  assert(
    views.length === 2 &&
      new Set(views.map((v) => v.backend)).size === 2 &&
      views.every(
        (v) =>
          ["whisper", "kotoba"].includes(v.backend) &&
          v.targetId === probe.id &&
          v.records.every(
            (r) =>
              valid(r) &&
              r.start >= probe.start - 1e-6 &&
              r.end <= probe.end + 1e-6,
          ),
      ),
    "INVALID_VIEWS",
  );
  const nearby = baseline.filter((c) => overlaps(c, probe));
  const hypotheses = views.flatMap((v) =>
    v.records.map((r, index) => {
      const text = normalizeSpeech(r.text);
      const matches = nearby.flatMap((c) => {
        const other = normalizeSpeech(c.text);
        // Containment is only a diagnostic link. Short particles cannot absorb full sentences.
        const relation =
          text === other
            ? "exact"
            : Math.min(text.length, other.length) >= 4 &&
                (text.includes(other) || other.includes(text))
              ? "containment"
              : null;
        return relation
          ? [{ cueId: c.id, relation, sourceStart: c.start, sourceEnd: c.end }]
          : [];
      });
      return {
        backend: v.backend,
        index,
        ...r,
        normalizedText: text,
        matches,
        targetOverlap: overlaps(r, {
          start: probe.targetStart,
          end: probe.targetEnd,
        }),
        timingAuthority: "unverified-asr-segment",
      };
    }),
  );
  const texts = views.map((v) => v.records.map((r) => normalizeSpeech(r.text)));
  const singleConsensus =
    texts.every((t) => t.length === 1) && texts[0][0] === texts[1][0];
  const common = [...new Set(texts[0].filter((t) => texts[1].includes(t)))];
  const linked = hypotheses.filter((h) => h.matches.length);
  const route =
    singleConsensus && !linked.length && !probe.hostIds.length
      ? "timing-only-alignment"
      : singleConsensus && linked.length === hypotheses.length
        ? "existing-cue-association-review"
        : linked.length
          ? "mixed-context-existing-cue-review"
          : "text-conflict-review";
  return {
    id: probe.id,
    route,
    target: { start: probe.targetStart, end: probe.targetEnd },
    crop: { start: probe.start, end: probe.end },
    hypotheses,
    nearbyCueIds: nearby.map((c) => c.id),
    commonTexts: common,
    targetText: route === "timing-only-alignment" ? texts[0][0] : null,
    reason:
      route === "timing-only-alignment"
        ? "ROUND_2_SKIPPED_TEXT_ALREADY_STABLE"
        : "DO_NOT_TREAT_ACTIVITY_GAP_AS_NEW_UTTERANCE",
    associationIsProof: false,
    orthographicVariantsResolved: false,
    referenceUsed: false,
    labelsUsed: false,
    asrRerun: false,
    subtitleMutationAuthorized: false,
  };
}

export function planAssociation(probes, baseline, views) {
  assert(
    new Set(probes.map((p) => p.id)).size === probes.length,
    "DUPLICATE_TARGET",
  );
  const rows = probes.map((p) =>
    associateUtterance(
      p,
      baseline,
      views.filter((v) => v.targetId === p.id),
    ),
  );
  const eligible = rows
    .filter((r) => r.route === "timing-only-alignment")
    .sort((a, b) => a.target.start - b.target.start);
  const requests = eligible
    .slice(0, associationPolicy.maxTargets)
    .flatMap((r) => {
      const ranges = {
        narrow: {
          start: Math.max(r.crop.start, r.target.start - 0.75),
          end: Math.min(r.crop.end, r.target.end + 0.75),
        },
        wide: r.crop,
      };
      assert(
        ranges.narrow.end - ranges.narrow.start < r.crop.end - r.crop.start,
        "DISTINCT_WINDOWS_REQUIRED",
      );
      return Object.entries(ranges).map(([view, range]) => ({
        id: `${r.id}-${view}`,
        targetId: r.id,
        kind: "timing",
        backend: "ctc",
        targetText: r.targetText,
        ...range,
        frames: Math.round((range.end - range.start) * 16000),
      }));
    });
  const seconds = requests.reduce((n, r) => n + r.frames / 16000, 0);
  assert(seconds <= associationPolicy.maxSeconds, "ALIGNMENT_BUDGET");
  return {
    policy: associationPolicy,
    rows,
    requests,
    seconds,
    deferred: eligible.slice(associationPolicy.maxTargets).map((r) => r.id),
    referenceUsed: false,
    labelsUsed: false,
  };
}

export function summarizeUtteranceTiming(results, vadIntervals) {
  const pair = summarizeTimingPair(results);
  return {
    pair,
    emissionIntervals: results.map((r) => ({
      requestId: r.requestId,
      interval: r.selectedBoundary ?? null,
      greedyText: r.greedyText ?? null,
      meanTokenPosterior: r.meanTokenPosterior ?? null,
    })),
    vadIntervals,
    vadMeaning: "speech-activity-only-not-lexical-boundaries",
    boundaryMeaning: "ctc-token-emission-support-not-full-utterance-extent",
    displayBoundary: null,
    subtitleMutationAuthorized: false,
    blockers: [...pair.blockers, "INDEPENDENT_UTTERANCE_BOUNDARIES_MISSING"],
    qualityStatus: "needs-review",
    finalizationMethod: "none",
  };
}
