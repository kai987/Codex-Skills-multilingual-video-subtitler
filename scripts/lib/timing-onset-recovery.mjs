/** Conservative onset-only candidate policy. No reference input, text edits or end edits. */
import assert from "node:assert/strict";
export const onsetPolicy = Object.freeze({
  version: "local-onset-corroboration-v1",
  maxTargets: 4,
  maxWindowSeconds: 20,
  maxTotalModelSeconds: 120,
  retries: 0,
  contextSeconds: 0.5,
  minimumAdvance: 0.75,
  maximumAdvance: 10,
  boundaryAgreement: 0.25,
  onsetPadding: 0.15,
  maximumEndOverrun: 0.05,
  minimumWordProbability: 0.5,
  minimumMeanProbability: 0.65,
  automaticPromotionAllowed: false,
});
const norm = (s) => s.normalize("NFKC").replace(/[\p{P}\p{Z}\s]/gu, "");
export function accountOnsetContinuation(targets, previousPlan, audit, exit) {
  assert.deepEqual(exit, { exitCode: null, signal: "SIGSEGV" });
  assert.equal(audit.status, "blocked-word-timing-runtime-contract");
  assert.equal(audit.asrAttempted, 1);
  assert.equal(audit.asrCompleted, 0);
  assert.equal(audit.vadAttempted, 0);
  assert.equal(audit.retries, 0);
  assert.equal(audit.targets.length, previousPlan.planned.targets.length);
  assert.equal(
    new Set(audit.targets.map((t) => t.id)).size,
    audit.targets.length,
  );
  assert.equal(targets.length, previousPlan.planned.targets.length);
  const retryTargets = [];
  for (const t of targets) {
    const old = previousPlan.planned.targets.find((p) => p.id === t.id);
    assert(old, "CONTINUATION_TARGET_CHANGED");
    for (const key of [
      "recordId",
      "text",
      "oldStart",
      "oldEnd",
      "firstFrame",
      "endFrame",
    ])
      assert.equal(t[key], old[key], "CONTINUATION_TARGET_CHANGED");
    const prior = audit.targets.find((p) => p.id === t.id);
    assert(prior, "CONTINUATION_MISSING_STATUS");
    if (prior.status === "ASR_CRASHED_BEFORE_RESULT") retryTargets.push(t.id);
    else assert.equal(prior.status, "NOT_DISPATCHED");
  }
  assert.equal(retryTargets.length, 1);
  return {
    authorization: "user-requested-next-round-after-reported-runtime-failure",
    priorAsrAttempts: 1,
    newAsrAttempts: targets.length,
    explicitRetryTargets: retryTargets,
    firstAttemptTargets: targets
      .filter((t) => !retryTargets.includes(t.id))
      .map((t) => t.id),
    cumulativePlannedAsrAttempts: 1 + targets.length,
    automaticRetries: 0,
  };
}
const valid = (r) =>
  Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start;
export function planOnsets(baseline, cueNumbers, duration, offset = 0) {
  assert(cueNumbers.length > 0 && cueNumbers.length <= onsetPolicy.maxTargets);
  assert.equal(new Set(cueNumbers).size, cueNumbers.length, "DUPLICATE_TARGET");
  assert(
    Number.isFinite(offset) && Number.isFinite(duration) && duration > offset,
  );
  const targets = cueNumbers.map((n) => {
    assert(Number.isInteger(n) && n > 0 && n <= baseline.length, "INVALID_CUE");
    const r = baseline[n - 1];
    assert(
      r.issues.length === 0 &&
        r.sourceEnd > r.sourceStart &&
        norm(r.text).length >= 6,
      "INVALID_TARGET",
    );
    const start = Math.max(offset, r.sourceStart - onsetPolicy.contextSeconds);
    const end = Math.min(duration, r.sourceEnd + onsetPolicy.contextSeconds);
    assert(end - start <= onsetPolicy.maxWindowSeconds, "WINDOW_BUDGET");
    return {
      id: `cue-${n}`,
      cueNumber: n,
      recordId: r.recordId,
      text: r.text,
      oldStart: r.sourceStart,
      oldEnd: r.sourceEnd,
      start,
      end,
      firstFrame: Math.round((start - offset) * 16000),
      endFrame: Math.round((end - offset) * 16000),
    };
  });
  const seconds = targets.reduce(
    (s, t) => s + (t.endFrame - t.firstFrame) / 16000,
    0,
  );
  assert(seconds * 2 <= onsetPolicy.maxTotalModelSeconds, "TOTAL_MODEL_BUDGET");
  return {
    policy: onsetPolicy,
    targets,
    secondsPerBackend: seconds,
    totalModelSeconds: seconds * 2,
    selection: "explicit-known-development-cues-not-blind",
  };
}

export function decideOnset(target, raw) {
  const reject = (reason, evidence = {}) => ({
    id: target.id,
    recordId: target.recordId,
    status: "ABSTAIN",
    reason,
    evidence,
  });
  if (
    raw.id !== target.id ||
    raw.frames !== target.endFrame - target.firstFrame ||
    raw.language !== "ja"
  )
    return reject("UNBOUND_RESPONSE");
  const duration = raw.frames / 16000;
  const words = raw.segments
    .flatMap((s) => s.words ?? [])
    .filter((w) => norm(w.word));
  if (
    !words.length ||
    words.some(
      (w, i) =>
        !valid(w) ||
        w.start < 0 ||
        w.end > duration + 1e-6 ||
        !Number.isFinite(w.probability) ||
        w.probability < 0 ||
        w.probability > 1 ||
        (i && w.start < words[i - 1].end - 1e-6),
    )
  )
    return reject("INVALID_WORD_TIMES");
  if (
    norm(raw.segments.map((s) => s.text).join("")) !==
    norm(words.map((w) => w.word).join(""))
  )
    return reject("WORD_TEXT_COVERAGE");
  const matches = [];
  for (let a = 0; a < words.length; a++)
    for (let b = a + 1; b <= words.length; b++)
      if (
        norm(
          words
            .slice(a, b)
            .map((w) => w.word)
            .join(""),
        ) === norm(target.text)
      )
        matches.push({ a, b });
  if (matches.length !== 1)
    return reject("NO_UNIQUE_EXACT_WHOLE_WORD_TEXT", {
      matches: matches.length,
    });
  const { a, b } = matches[0],
    selected = words.slice(a, b);
  const start = target.start + selected[0].start,
    end = target.start + selected.at(-1).end;
  if (
    words.slice(0, a).some((w) => target.start + w.end > target.oldStart) ||
    words.slice(b).some((w) => target.start + w.start < target.oldEnd)
  )
    return reject("OTHER_WORDS_INSIDE_TARGET");
  if (
    selected.some((w) => w.probability < onsetPolicy.minimumWordProbability) ||
    selected.reduce((s, w) => s + w.probability, 0) / selected.length <
      onsetPolicy.minimumMeanProbability
  )
    return reject("WEAK_LEXICAL_SUPPORT");
  if (selected[0].start < 0.08 || selected.at(-1).end > duration - 0.08)
    return reject("CROP_EDGE");
  if (end > target.oldEnd + onsetPolicy.maximumEndOverrun)
    return reject("UNCHANGED_END_WOULD_TRUNCATE");
  const intervals = raw.vad.rawIntervals.map((r) => ({
    start: r.start / 100,
    end: r.end / 100,
  }));
  if (
    raw.vad.rawUnit !== "CENTISECONDS" ||
    raw.vad.sampleRate !== 16000 ||
    raw.vad.inputFrames !== raw.frames ||
    raw.vad.device !== "cpu" ||
    raw.vad.stateIsolation !== "WHISPER_VAD_DETECT_SPEECH_RESETS_LSTM" ||
    intervals.some(
      (r, i) =>
        !valid(r) ||
        r.start < 0 ||
        r.end > duration + 0.05 ||
        (i && r.start < intervals[i - 1].end),
    )
  )
    return reject("INVALID_VAD");
  const speech = intervals.map((r) => ({
    start: target.start + r.start,
    end: target.start + Math.min(r.end, duration),
  }));
  const first = speech.filter(
    (r) => r.start < target.start + selected[0].end && r.end > start,
  );
  if (
    first.length !== 1 ||
    Math.abs(first[0].start - start) > onsetPolicy.boundaryAgreement
  )
    return reject("ONSET_EVIDENCE_DISAGREES", { wordStart: start, first });
  if (
    selected.some(
      (w) =>
        !speech.some(
          (r) =>
            r.start < target.start + w.end && r.end > target.start + w.start,
        ),
    )
  )
    return reject("WORD_WITHOUT_ACTIVITY_SUPPORT");
  const proposedStart =
    Math.round(
      (Math.min(start, first[0].start) - onsetPolicy.onsetPadding) * 100,
    ) / 100;
  if (
    speech.some(
      (r) =>
        r.end > target.oldStart && r.start < proposedStart && r !== first[0],
    )
  )
    return reject("PRECEDING_SPEECH_CONFLICT");
  const advance = proposedStart - target.oldStart;
  if (
    advance < onsetPolicy.minimumAdvance ||
    advance > onsetPolicy.maximumAdvance ||
    proposedStart >= target.oldEnd - 0.5
  )
    return reject("NO_BOUNDED_START_ADVANCE");
  return {
    id: target.id,
    recordId: target.recordId,
    status: "CANDIDATE",
    reason: "WORD_ONSET_AND_VAD_AGREE_WITH_PADDING",
    oldStart: target.oldStart,
    newStart: proposedStart,
    unchangedEnd: target.oldEnd,
    evidence: {
      wordStart: start,
      wordEnd: end,
      vadStart: first[0].start,
      padding: onsetPolicy.onsetPadding,
      words: selected,
    },
    acousticTimingVerified: false,
    qualification:
      "two-model-corroborated-onset-candidate-not-proof-of-silence",
    qualityStatus: "needs-review",
  };
}

export function applyOnsets(baseline, decisions) {
  assert.equal(
    new Set(decisions.map((d) => d.recordId)).size,
    decisions.length,
    "DUPLICATE_DECISION",
  );
  const byId = new Map(baseline.map((r) => [r.recordId, r]));
  assert.equal(byId.size, baseline.length, "DUPLICATE_BASELINE_ID");
  for (const d of decisions) {
    const r = byId.get(d.recordId);
    assert(r, "UNKNOWN_RECORD");
    if (d.status === "CANDIDATE") {
      assert.equal(d.oldStart, r.sourceStart, "STALE_START");
      assert.equal(d.unchangedEnd, r.sourceEnd, "END_CHANGED");
      assert(
        Number.isFinite(d.newStart) &&
          d.newStart > r.sourceStart &&
          d.newStart < r.sourceEnd,
        "INVALID_START",
      );
    } else assert.equal(d.status, "ABSTAIN");
  }
  return baseline.map((r) => {
    const d = decisions.find(
      (d) => d.recordId === r.recordId && d.status === "CANDIDATE",
    );
    // Original raw/local times intentionally remain raw evidence; only presentation sourceStart changes.
    return d ? { ...r, sourceStart: d.newStart } : { ...r };
  });
}
