/** Whole-record, text-only development candidates. Never a finalization gate. */
import assert from "node:assert/strict";
import { contentSafety } from "./content-safety-gate.mjs";
import { seamTextOnlyPolicy } from "./seam-text-only.mjs";

export const dialoguePolicy = Object.freeze({
  version: "whole-dialogue-paired-donor-v1",
  minimumCharacters: seamTextOnlyPolicy.minimumCharacters,
  minimumCoverage: seamTextOnlyPolicy.minimumTargetTimeCoverage,
  minimumRetainedRatio: seamTextOnlyPolicy.minimumRetainedRatio,
  maximumExpansionRatio: 1.25,
  minimumSimilarity: 0.5,
  maxTargets: 6,
  maxRequests: 6,
  maxAudioSeconds: 120,
  retries: 0,
  timing: "unchanged-original-whole-record-outer-envelope",
  defaultPromotion: false,
});
export const dialogueText = (s) =>
  s.normalize("NFKC").replace(/[\p{P}\p{Z}\s]/gu, "");
const overlap = (a, b) => a.start < b.end && b.start < a.end;
const valid = (r) =>
  Number.isFinite(r.start) &&
  Number.isFinite(r.end) &&
  r.start >= 0 &&
  r.end > r.start &&
  typeof r.text === "string" &&
  !!dialogueText(r.text);
const risk = (rows) => contentSafety(rows, { language: "ja" }).issues;
function similarity(a, b) {
  a = [...a];
  b = [...b];
  let previous = b.map((_, i) => i + 1);
  previous.unshift(0);
  for (const [i, x] of a.entries()) {
    const row = [i + 1];
    for (const [j, y] of b.entries())
      row.push(
        Math.min(
          row[j] + 1,
          previous[j + 1] + 1,
          previous[j] + Number(x !== y),
        ),
      );
    previous = row;
  }
  return 1 - previous[b.length] / Math.max(a.length, b.length, 1);
}

export function closeDialogueTarget(baseline, target) {
  let start = target.start,
    end = target.end,
    rows;
  for (;;) {
    rows = baseline.filter((r) => overlap(r, { start, end }));
    assert(rows.length, "EMPTY_TARGET");
    const a = Math.min(start, ...rows.map((r) => r.start));
    const b = Math.max(end, ...rows.map((r) => r.end));
    if (a === start && b === end) break;
    start = a;
    end = b;
  }
  return { ...target, start, end, recordIds: rows.map((r) => r.id) };
}

/** Complete consecutive donor groups only; no substring extraction or token retiming. */
function groups(view, target, protectedRows) {
  const found = [];
  if (
    !view.records.length ||
    view.records.some(
      (r, i) =>
        !valid(r) ||
        r.start < view.start - 1e-7 ||
        r.end > view.end + 1e-7 ||
        (i && r.start < view.records[i - 1].end - 1e-7),
    )
  )
    return found;
  for (let i = 0; i < view.records.length; i++) {
    for (let j = i; j < view.records.length; j++) {
      const rows = view.records.slice(i, j + 1);
      if (rows.some((r) => !overlap(r, target))) continue;
      const coverage =
        rows.reduce(
          (s, r) =>
            s +
            Math.max(
              0,
              Math.min(r.end, target.end) - Math.max(r.start, target.start),
            ),
          0,
        ) /
        (target.end - target.start);
      const text = rows.map((r) => r.text).join("");
      if (
        coverage < dialoguePolicy.minimumCoverage ||
        [...dialogueText(text)].length < dialoguePolicy.minimumCharacters
      )
        continue;
      if (
        rows.some((r) => r.style === "music" || /[♪♫]/u.test(r.text)) ||
        risk(rows).length
      )
        continue;
      // A broad donor absorbing another baseline utterance is not a local repair.
      if (protectedRows.some((r) => rows.some((d) => overlap(r, d)))) continue;
      found.push({
        text,
        normalized: dialogueText(text),
        records: rows,
        coverage,
        requestId: view.id,
        cropEdge:
          rows[0].start <= view.start + 0.02 ||
          rows.at(-1).end >= view.end - 0.02,
      });
    }
  }
  return found;
}

export function recoverWholeDialogue(baseline, targets, views) {
  assert(baseline.length && baseline.every(valid), "INVALID_BASELINE");
  assert(
    new Set(baseline.map((r) => r.id)).size === baseline.length,
    "DUPLICATE_BASELINE_ID",
  );
  assert(
    targets.length <= dialoguePolicy.maxTargets &&
      new Set(targets.map((t) => t.id)).size === targets.length,
    "TARGET_LIMIT_OR_ID",
  );
  const decisions = targets.map((t) => {
    const closed = closeDialogueTarget(baseline, t);
    assert.deepEqual(closed.recordIds, t.recordIds, "TARGET_NOT_CLOSED");
    assert.equal(closed.start, t.start);
    assert.equal(closed.end, t.end);
    const old = baseline.filter((r) => t.recordIds.includes(r.id));
    const outside = baseline.filter((r) => !t.recordIds.includes(r.id));
    const selected = views.filter((v) => v.targetId === t.id);
    const decision = {
      targetId: t.id,
      start: t.start,
      end: t.end,
      status: "ABSTAIN",
      replaceIds: [],
      records: [],
      before: old,
      evidence: selected,
    };
    const reject = (reason, detail = {}) => ({
      ...decision,
      reason,
      ...detail,
    });
    if (old.some((r) => r.style === "music" || /[♪♫]/u.test(r.text)))
      return reject("MUSIC_SEPARATE_ROUTE");
    if (
      selected.length !== 2 ||
      selected[0].id === selected[1].id ||
      selected[0].modelHash === selected[1].modelHash ||
      selected.some(
        (v) =>
          !/^[a-f0-9]{64}$/u.test(v.modelHash) ||
          !/^[a-f0-9]{64}$/u.test(v.rawHash),
      )
    )
      return reject("TWO_BOUND_MODEL_CONFIGURATIONS_REQUIRED");
    if (
      !/^[a-f0-9]{64}$/u.test(selected[0].audioHash) ||
      selected[0].audioHash !== selected[1].audioHash ||
      selected[0].start !== selected[1].start ||
      selected[0].end !== selected[1].end
    )
      return reject("MATCHED_PHYSICAL_AUDIO_REQUIRED");
    if (selected.some((v) => v.start > t.start || v.end < t.end))
      return reject("WHOLE_TARGET_NOT_IN_REQUEST");
    const candidates = selected.map((v) => groups(v, t, outside));
    const pairs = candidates[0].flatMap((a) =>
      candidates[1]
        .filter((b) => a.normalized === b.normalized)
        .map((b) => [a, b]),
    );
    if (pairs.length !== 1)
      return reject("NO_UNIQUE_COMPLETE_TEXT_PAIR", {
        comparableGroups: candidates,
      });
    const [a, b] = pairs[0],
      before = dialogueText(old.map((r) => r.text).join(""));
    if (a.normalized === before) return reject("TEXT_UNCHANGED");
    const ratio = [...a.normalized].length / [...before].length;
    if (
      ratio < dialoguePolicy.minimumRetainedRatio ||
      ratio > dialoguePolicy.maximumExpansionRatio ||
      similarity(before, a.normalized) < dialoguePolicy.minimumSimilarity
    )
      return reject("EXCESSIVE_TEXT_CHANGE", { comparableGroups: candidates });
    // Edge timestamps and cross-model timing disagreement do NOT become new cue times.
    // Keeping a text-only candidate separate is not permission for default application.
    return {
      ...decision,
      status: "CANDIDATE",
      reason: "PAIRED_WHOLE_TEXT_ORIGINAL_ENVELOPE",
      replaceIds: t.recordIds,
      records: [
        {
          id: `${t.id}-whole-dialogue`,
          start: t.start,
          end: t.end,
          text: a.text,
        },
      ],
      pairedDonors: [a, b],
      timingVerified: false,
      cropEdgeObserved: a.cropEdge || b.cropEdge,
    };
  });
  // Reject both conflicting transactions, never use first-wins ordering.
  for (const d of decisions)
    if (
      d.status === "CANDIDATE" &&
      decisions.some(
        (e) =>
          e !== d &&
          e.status === "CANDIDATE" &&
          e.replaceIds.some((id) => d.replaceIds.includes(id)),
      )
    )
      d.conflict = true;
  for (const d of decisions)
    if (d.conflict)
      Object.assign(d, {
        status: "ABSTAIN",
        reason: "TARGET_TRANSACTION_CONFLICT",
        replaceIds: [],
        records: [],
      });
  const removed = new Set(decisions.flatMap((d) => d.replaceIds));
  const candidate = [
    ...baseline.filter((r) => !removed.has(r.id)),
    ...decisions.flatMap((d) => d.records),
  ].sort(
    (a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id),
  );
  return {
    policy: dialoguePolicy,
    decisions,
    baseline,
    candidate,
    protectedRecords: baseline.length - removed.size,
    changedTargets: decisions.filter((d) => d.status === "CANDIDATE").length,
    baselineSafety: contentSafety(baseline, { language: "ja" }),
    candidateSafety: contentSafety(candidate, { language: "ja" }),
    referenceUsed: false,
    automaticPromotionAllowed: false,
    preferredOutputs: [],
    qualityStatus: "needs-review",
    finalizationMethod: "none",
    humanValidated: false,
    timingPolicy: dialoguePolicy.timing,
    timingRepairs: 0,
    modelIndependence:
      "different-model-configurations-with-shared-Whisper-ancestry-not-independent-truth",
  };
}
