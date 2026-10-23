/** PCM activity is a review hint, never speech, text, or subtitle timing truth. */
import assert from "node:assert/strict";

export const audioCoveragePolicy = Object.freeze({
  version: "audio-coverage-observation-v2",
  sampleRate: 16000,
  frameSamples: 320,
  quietDbfs: -40,
  minimumQuietFrames: 8,
  minimumActivitySeconds: 0.12,
  maximumEmbeddedActivitySeconds: 3,
  maximumUnitSeconds: 6,
  contextSeconds: 0.75,
  maximumPreviews: 8,
  maximumPreviewSeconds: 60,
  maximumScanSeconds: 1800,
  shortCueMaximumCharacters: 8,
  subtitleQuantizationToleranceSeconds: 0.001,
  selection:
    "evidence-tier-first; kind-balanced; source-stratified-within-tier; no reference",
  maximumInitialPreviewsPerKind: 4,
  rankingValidated: false,
  newInference: 0,
  speechVerified: false,
  automaticMutation: false,
});
const norm = (text) => text.normalize("NFKC").replace(/[\s\p{P}\p{S}]/gu, "");
const length = (r) => r.end - r.start;
const overlap = (a, b) =>
  Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
const interval = (r) =>
  Number.isFinite(r.start) &&
  Number.isFinite(r.end) &&
  r.start >= 0 &&
  r.end > r.start;

export function scanAudioActivity(
  pcm,
  { audioOffset, firstFrame = 0, frames = pcm.frames },
) {
  assert(
    pcm.sampleRate === 16000 && pcm.data.length === pcm.frames * 2,
    "PCM_GEOMETRY",
  );
  assert(
    Number.isFinite(audioOffset) && audioOffset >= 0,
    "SOURCE_OFFSET_REQUIRED",
  );
  assert(
    Number.isSafeInteger(firstFrame) &&
      Number.isSafeInteger(frames) &&
      firstFrame >= 0 &&
      frames > 0 &&
      firstFrame + frames <= pcm.frames,
    "SCAN_FRAME_RANGE",
  );
  assert(
    frames <= audioCoveragePolicy.maximumScanSeconds * 16000,
    "SCAN_BUDGET",
  );
  const endFrame = firstFrame + frames;
  const quietRuns = [];
  let quiet = null;
  for (let begin = firstFrame; begin < endFrame; begin += 320) {
    const end = Math.min(endFrame, begin + 320);
    let energy = 0;
    for (let i = begin; i < end; i++)
      energy += (pcm.data.readInt16LE(i * 2) / 32768) ** 2;
    const dbfs = 10 * Math.log10(Math.max(1e-12, energy / (end - begin)));
    if (dbfs <= audioCoveragePolicy.quietDbfs) {
      if (!quiet) quiet = { firstFrame: begin, endFrame: end };
      else quiet.endFrame = end;
    } else if (quiet) {
      quietRuns.push(quiet);
      quiet = null;
    }
  }
  if (quiet) quietRuns.push(quiet);
  const boundaries = quietRuns.filter(
    (r) =>
      r.endFrame - r.firstFrame >= 320 * audioCoveragePolicy.minimumQuietFrames,
  );
  const spans = [];
  let cursor = firstFrame;
  for (const q of [...boundaries, { firstFrame: endFrame, endFrame }]) {
    if (q.firstFrame > cursor)
      spans.push({ firstFrame: cursor, endFrame: q.firstFrame });
    cursor = q.endFrame;
  }
  const source = (frame) => audioOffset + frame / 16000;
  return {
    policy: audioCoveragePolicy,
    range: { start: source(firstFrame), end: source(endFrame) },
    timebase: "source-global-relative-to-container-origin",
    scannedFrames: frames,
    quietBoundaryCount: boundaries.length,
    discardedBriefActivityCount: spans.filter(
      (r) => r.endFrame - r.firstFrame < 0.12 * 16000,
    ).length,
    intervals: spans
      .filter((r) => r.endFrame - r.firstFrame >= 0.12 * 16000)
      .map((r, i) => ({
        id: `activity-${i + 1}`,
        ...r,
        start: source(r.firstFrame),
        end: source(r.endFrame),
        cropEdgeLimited: r.firstFrame === firstFrame || r.endFrame === endFrame,
        speechVerified: false,
      })),
    negativeMeaning:
      "below-fixed-energy-threshold-or-no-isolated-island; not silence or no speech",
  };
}

export function intervalUnion(rows) {
  const result = [];
  for (const r of [...rows].sort(
    (a, b) => a.start - b.start || a.end - b.end,
  )) {
    const last = result.at(-1);
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else result.push({ start: r.start, end: r.end });
  }
  return result;
}

// Structural evidence, NOT speech/music recognition or probability of an error.
export function explainCoveragePriority(unit, records, activity) {
  const a = activity.intervals.find((r) => r.id === unit.activityId);
  assert(a, "MISSING_PARENT_ACTIVITY");
  const overlappingCueIds = records
    .filter((r) => overlap(r, a) > 0)
    .map((r) => r.id);
  const hostPeers = activity.intervals.filter(
    (b) =>
      b.id !== a.id &&
      records.some(
        (r) =>
          unit.hostCueIds.includes(r.id) &&
          b.start >= r.start &&
          b.end <= r.end,
      ),
  );
  const longestPeerSeconds = Math.max(0, ...hostPeers.map(length));
  let relation, tier;
  if (a.cropEdgeLimited) {
    relation = "crop-edge-uncertain";
    tier = 4;
  } else if (length(a) > audioCoveragePolicy.maximumUnitSeconds) {
    relation = "continuous-activity-fragment";
    tier = 4;
  } else if (!unit.activityWhole && overlappingCueIds.length) {
    relation = "cue-boundary-continuation-possible";
    tier = 3;
  } else if (!unit.activityWhole) {
    relation = "partial-activity-uncertain";
    tier = 3;
  } else if (unit.kind === "uncovered-audio-activity") {
    relation = "isolated-uncovered-activity";
    tier =
      length(a) <= audioCoveragePolicy.maximumEmbeddedActivitySeconds ? 0 : 2;
  } else {
    relation = "embedded-isolated-activity";
    tier = longestPeerSeconds >= 2 * length(a) ? 1 : 2;
  }
  return {
    tier,
    relation,
    parentActivityStart: a.start,
    parentActivityEnd: a.end,
    parentActivitySeconds: length(a),
    parentOverlappingCueIds: overlappingCueIds,
    longestHostPeerSeconds: longestPeerSeconds,
    wholeActivity: unit.activityWhole,
    soundClass: "unknown-speech-music-noise",
    confirmedMissingSpeech: false,
    rankingValidated: false,
  };
}

function selectCoveragePreviews(candidates, range) {
  const stratum = (c) =>
    Math.min(7, Math.floor((8 * (c.start - range.start)) / length(range)));
  const selected = [],
    used = new Set(),
    counts = new Map(),
    strata = Array(8).fill(0);
  let seconds = 0;
  // First balance observation kinds. A second pass only fills unused slots.
  for (const balanced of [true, false]) {
    while (selected.length < audioCoveragePolicy.maximumPreviews) {
      const eligible = candidates.filter(
        (c) =>
          !used.has(c.id) &&
          (!balanced ||
            (counts.get(c.kind) ?? 0) <
              audioCoveragePolicy.maximumInitialPreviewsPerKind) &&
          !selected.some((p) => p.start <= c.start && p.end >= c.end),
      );
      eligible.sort(
        (a, b) =>
          a.priority.tier - b.priority.tier ||
          strata[stratum(a)] - strata[stratum(b)] ||
          a.start - b.start ||
          a.id.localeCompare(b.id),
      );
      const c = eligible[0];
      if (!c) break;
      used.add(c.id);
      const start = Math.max(
        range.start,
        c.start - audioCoveragePolicy.contextSeconds,
      );
      const end = Math.min(
        range.end,
        c.end + audioCoveragePolicy.contextSeconds,
      );
      if (
        seconds + end - start >
        audioCoveragePolicy.maximumPreviewSeconds + 1e-8
      )
        continue;
      selected.push({
        id: `review-${selected.length + 1}`,
        unitId: c.id,
        kind: c.kind,
        start,
        end,
        priorityTier: c.priority.tier,
        relation: c.priority.relation,
      });
      seconds += end - start;
      counts.set(c.kind, (counts.get(c.kind) ?? 0) + 1);
      strata[stratum(c)]++;
    }
  }
  return { previews: selected, seconds };
}

export function planAudioCoverage(records, activity) {
  assert(interval(activity.range), "INVALID_SOURCE_RANGE");
  const seen = new Set();
  for (const r of records) {
    assert(
      interval(r) &&
        typeof r.text === "string" &&
        typeof r.id === "string" &&
        !seen.has(r.id),
      "INVALID_CUE",
    );
    assert(
      r.start >= activity.range.start - 0.001 &&
        r.end <= activity.range.end + 0.001,
      "CUE_OUTSIDE_SOURCE_RANGE",
    );
    seen.add(r.id);
  }
  for (const [i, a] of activity.intervals.entries()) {
    assert(
      interval(a) &&
        a.start >= activity.range.start &&
        a.end <= activity.range.end &&
        (!i || a.start >= activity.intervals[i - 1].end),
      "INVALID_ACTIVITY_INTERVALS",
    );
  }
  const covered = intervalUnion(records);
  const gaps = [];
  let cursor = activity.range.start;
  for (const r of [
    ...covered,
    { start: activity.range.end, end: activity.range.end },
  ]) {
    if (r.start > cursor)
      gaps.push({ start: cursor, end: Math.min(r.start, activity.range.end) });
    cursor = Math.max(cursor, r.end);
  }
  const units = [];
  for (const a of activity.intervals) {
    for (const gap of gaps) {
      const start = Math.max(a.start, gap.start),
        end = Math.min(a.end, gap.end);
      if (end - start < audioCoveragePolicy.minimumActivitySeconds) continue;
      for (
        let s = start;
        s < end;
        s += audioCoveragePolicy.maximumUnitSeconds
      ) {
        const stop = Math.min(end, s + audioCoveragePolicy.maximumUnitSeconds);
        if (stop - s < audioCoveragePolicy.minimumActivitySeconds) continue;
        units.push({
          kind: "uncovered-audio-activity",
          start: s,
          end: stop,
          activityId: a.id,
          hostCueIds: [],
          activityWhole: s === a.start && stop === a.end,
        });
      }
    }
    if (
      a.cropEdgeLimited ||
      length(a) > audioCoveragePolicy.maximumEmbeddedActivitySeconds
    )
      continue;
    const hosts = records.filter(
      (r) =>
        Array.from(norm(r.text)).length >
          audioCoveragePolicy.shortCueMaximumCharacters &&
        r.start <= a.start &&
        r.end >= a.end &&
        activity.intervals.filter((b) => b.start >= r.start && b.end <= r.end)
          .length >= 2,
    );
    if (hosts.length)
      units.push({
        kind: "embedded-short-audio-activity",
        start: a.start,
        end: a.end,
        activityId: a.id,
        hostCueIds: hosts.map((r) => r.id),
        activityWhole: true,
      });
  }
  units.sort(
    (a, b) =>
      a.start - b.start || a.end - b.end || a.kind.localeCompare(b.kind),
  );
  const candidates = units.map((r, i) => ({
    id: `coverage-unit-${i + 1}`,
    ...r,
    priority: explainCoveragePriority(r, records, activity),
    neighboringCues: records.filter(
      (c) => overlap(c, { start: r.start - 0.75, end: r.end + 0.75 }) > 0,
    ),
    speechVerified: false,
    lexicalText: null,
    subtitleMutationAuthorized: false,
  }));
  const { previews, seconds } = selectCoveragePreviews(
    candidates,
    activity.range,
  );
  return {
    policy: audioCoveragePolicy,
    sourceRange: activity.range,
    preferredCueCount: records.length,
    subtitleGaps: gaps,
    candidates,
    previews,
    deferred: candidates
      .filter(
        (c) => !previews.some((p) => p.start <= c.start && p.end >= c.end),
      )
      .map((c) => ({ id: c.id, reason: "LISTENING_BUDGET" })),
    summary: {
      candidateCount: candidates.length,
      candidateRelations: Object.fromEntries(
        [...new Set(candidates.map((c) => c.priority.relation))].map(
          (relation) => [
            relation,
            candidates.filter((c) => c.priority.relation === relation).length,
          ],
        ),
      ),
      selectedRelations: Object.fromEntries(
        [...new Set(previews.map((p) => p.relation))].map((relation) => [
          relation,
          previews.filter((p) => p.relation === relation).length,
        ]),
      ),
      uncoveredActivityCount: candidates.filter(
        (c) => c.kind === "uncovered-audio-activity",
      ).length,
      embeddedActivityCount: candidates.filter(
        (c) => c.kind === "embedded-short-audio-activity",
      ).length,
      previewCount: previews.length,
      requestedListeningSeconds: seconds,
      uniqueListeningSeconds: intervalUnion(previews).reduce(
        (s, r) => s + length(r),
        0,
      ),
      candidateUnionSeconds: intervalUnion(candidates).reduce(
        (s, r) => s + length(r),
        0,
      ),
    },
    newInference: 0,
    automaticMutation: false,
    speechVerified: false,
    limitations: [
      "Priority tiers reflect activity geometry, not error likelihood. Music/noise classification and ranking precision remain unvalidated.",
      "Cue-boundary continuation is only a hypothesis; downranked candidates remain in the full registry and may contain missing speech.",
      "Energy activity includes music, impacts and noise; it is not a VAD or missing-dialogue verdict.",
      "Quiet/continuous/low-level speech may be missed; negative results are not silence proof.",
      "Cue occupancy does not establish text completeness; long-cue islands are candidate review locations only.",
      "Preview crops are for listening, not verified utterance boundaries or authorized model requests.",
    ],
  };
}
