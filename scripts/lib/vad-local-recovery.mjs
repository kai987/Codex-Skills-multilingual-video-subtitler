/** Machine-selected diagnostics and insertion-only proposals; no reference inputs. */
import assert from "node:assert/strict";
import { normalizeSpeech } from "./speech-support-policy.mjs";
export const localRecoveryPolicy = Object.freeze({
  version: "vad-local-recovery-v1",
  maxTargets: 4,
  maxRequests: 8,
  maxSeconds: 64,
  contextSeconds: 2,
  maxCropSeconds: 8,
  retries: 0,
  timingAgreement: 0.35,
  donorVadCoverage: 0.5,
  mode: "insertion-only-review-candidate",
});
const overlap = (a, b) =>
  Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
const valid = (r) =>
  Number.isFinite(r.start) &&
  Number.isFinite(r.end) &&
  r.start >= 0 &&
  r.end > r.start &&
  typeof r.text === "string" &&
  r.text.trim();
export function planLocalRecovery(triage, baseline, duration) {
  assert(baseline.length > 0 && baseline.every(valid), "INVALID_BASELINE");
  assert(
    Number.isFinite(duration) &&
      duration > 0 &&
      baseline.every((r) => r.end <= duration),
    "INVALID_DURATION",
  );
  const candidates = triage.rows
    .filter((t) => t.state !== "unsupported")
    .map((t) => {
      assert(["supported", "partial"].includes(t.state), "INVALID_TRIAGE");
      assert(
        Number.isFinite(t.targetStart) &&
          Number.isFinite(t.targetEnd) &&
          t.targetStart >= 0 &&
          t.targetEnd > t.targetStart &&
          t.targetEnd <= duration,
        "INVALID_TARGET",
      );
      const target = { start: t.targetStart, end: t.targetEnd };
      const hosts = baseline.filter((r) => overlap(r, target) > 1e-8);
      const start = Math.max(0, target.start - 2),
        end = Math.min(duration, target.end + 2);
      return {
        id: t.id,
        targetStart: target.start,
        targetEnd: target.end,
        state: t.state,
        hostIds: hosts.map((r) => r.id),
        relation: hosts.length
          ? "covered-timing-not-proof-of-text"
          : "uncovered-gap-not-confirmed-omission",
        start,
        end,
        frames: Math.round((end - start) * 16000),
      };
    });
  candidates.sort(
    (a, b) =>
      Number(a.hostIds.length > 0) - Number(b.hostIds.length > 0) ||
      Number(a.state === "partial") - Number(b.state === "partial") ||
      a.targetStart - b.targetStart,
  );
  const probes = [],
    deferred = [];
  for (const c of candidates) {
    const reason =
      c.frames > 8 * 16000
        ? "CROP_BUDGET"
        : probes.some((p) => overlap(p, c) > 0)
          ? "OVERLAPPING_REQUEST"
          : probes.length >= 4
            ? "TARGET_BUDGET"
            : null;
    if (reason) deferred.push({ ...c, reason });
    else probes.push(c);
  }
  assert(
    probes.reduce((s, p) => s + (2 * p.frames) / 16000, 0) <= 64,
    "AUDIO_BUDGET",
  );
  return {
    policy: localRecoveryPolicy,
    probes,
    deferred,
    unsupportedRetainedIds: triage.rows
      .filter((t) => t.state === "unsupported")
      .map((t) => t.id),
    referenceUsed: false,
    labelsUsed: false,
  };
}

export function decideLocalRecovery(probe, baseline, views, vadIntervals) {
  const abstain = (reason, donors = []) => ({
    id: probe.id,
    status: "ABSTAIN",
    reason,
    donors,
    insertions: [],
  });
  assert(baseline.every(valid), "INVALID_BASELINE");
  if (
    views.length !== 2 ||
    views[0].backend !== "whisper" ||
    views[1].backend !== "kotoba"
  )
    return abstain("TWO_BACKENDS_REQUIRED");
  const target = { start: probe.targetStart, end: probe.targetEnd };
  for (const v of views) {
    if (
      !v.records.every(
        (r, i) =>
          valid(r) &&
          r.start >= probe.start &&
          r.end <= probe.end &&
          (!i || r.start >= v.records[i - 1].end),
      )
    )
      return abstain("INVALID_DONOR_TIMING");
  }
  const selected = views.map((v) =>
    v.records.filter((r) => overlap(r, target) > 0),
  );
  if (selected.some((rows) => rows.length !== 1))
    return abstain("TARGET_NOT_SINGLE_LOCALIZED_CUE", selected);
  const donors = selected.map((rows) => rows[0]);
  const text = donors.map((r) => normalizeSpeech(r.text));
  if (!text[0] || text[0] !== text[1]) return abstain("TEXT_CONFLICT", donors);
  if (
    !/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(text[0]) ||
    Array.from(text[0]).length > 40
  )
    return abstain("NOT_SHORT_JAPANESE", donors);
  if (
    donors.some(
      (r) => r.start <= probe.start + 0.08 || r.end >= probe.end - 0.08,
    )
  )
    return abstain("CROP_EDGE", donors);
  if (
    Math.abs(donors[0].start - donors[1].start) > 0.35 ||
    Math.abs(donors[0].end - donors[1].end) > 0.35
  )
    return abstain("TIMING_CONFLICT", donors);
  // A host cue may contain other words. Never erase or split it based on a short crop.
  if (
    probe.hostIds.length ||
    donors.some((r) => baseline.some((b) => overlap(b, r) > 0))
  )
    return abstain("EXISTING_CUE_COLLISION_OR_CONTINUATION", donors);
  const near = baseline.filter(
    (r) => r.start < probe.end && r.end > probe.start,
  );
  if (
    near.some((r) => {
      const n = normalizeSpeech(r.text);
      return n && (n.includes(text[0]) || text[0].includes(n));
    })
  )
    return abstain("POSSIBLE_NEIGHBOR_CONTINUATION_OR_REPEAT", donors);
  assert(
    vadIntervals.every(
      (r, i) =>
        Number.isFinite(r.start) &&
        Number.isFinite(r.end) &&
        r.end > r.start &&
        (!i || r.start >= vadIntervals[i - 1].end),
    ),
    "INVALID_VAD_INTERVALS",
  );
  if (
    donors.some(
      (r) =>
        vadIntervals.reduce((s, v) => s + overlap(r, v), 0) /
          (r.end - r.start) <
        0.5,
    )
  )
    return abstain("INSUFFICIENT_DONOR_ACTIVITY_SUPPORT", donors);
  return {
    id: probe.id,
    status: "CANDIDATE",
    reason: "PAIRED_LOCAL_TEXT_TIMING_GAP_INSERTION_REQUIRES_REVIEW",
    donors,
    insertions: [
      {
        id: `local-${probe.id}`,
        start: donors[0].start,
        end: donors[0].end,
        text: donors[0].text,
      },
    ],
    acousticTimingVerified: false,
    qualityStatus: "needs-review",
  };
}

export function assembleLocalRecovery(baseline, decisions) {
  assert(baseline.every(valid), "INVALID_BASELINE");
  const inserted = decisions
    .filter((d) => d.status === "CANDIDATE")
    .flatMap((d) => d.insertions);
  const seen = new Set(baseline.map((r) => r.id));
  for (const [i, r] of inserted.entries()) {
    assert(valid(r) && !seen.has(r.id), "INVALID_INSERTION");
    seen.add(r.id);
    assert(
      ![...baseline, ...inserted.slice(0, i)].some((b) => overlap(r, b) > 0),
      "INSERTION_COLLISION",
    );
  }
  return [...baseline.map((r) => ({ ...r })), ...inserted].sort(
    (a, b) => a.start - b.start || a.end - b.end,
  );
}
