/** Retain an existing complete baseline record; remove only corroborated seam prefixes. */
import assert from "node:assert/strict";
import { contentSafety } from "./content-safety-gate.mjs";
import { seamRefinementPolicy } from "./seam-refinement.mjs";
import {
  dialogueText,
  closeDialogueTarget,
} from "./whole-dialogue-recovery.mjs";

export const prefixPolicy = Object.freeze({
  version: "cross-model-baseline-owned-prefix-v1",
  // Existing long-side criterion; the text owner already exists in the baseline.
  // This is not the 16-character minimum for creating a new whole-donor sentence.
  minimumOwnerCharacters: seamRefinementPolicy.minimumSideCharacters,
  maximumPrefixCharacters: 8,
  minimumOwnerCoverage: 0.8,
  minimumRetainedRatio: 0.6,
  referenceUsed: false,
  automaticPromotionAllowed: false,
});
const overlap = (a, b) => a.start < b.end && b.start < a.end;
const count = (text, part) => text.split(part).length - 1;
const valid = (r) =>
  Number.isFinite(r.start) &&
  Number.isFinite(r.end) &&
  r.start >= 0 &&
  r.end > r.start &&
  typeof r.text === "string";
function support(view, owner) {
  const text = dialogueText(owner.text),
    matches = [];
  for (const r of view.records) {
    const normalized = dialogueText(r.text);
    if (count(normalized, text) !== 1 || !overlap(r, owner)) continue;
    const coverage =
      Math.max(0, Math.min(r.end, owner.end) - Math.max(r.start, owner.start)) /
      (owner.end - owner.start);
    if (coverage < prefixPolicy.minimumOwnerCoverage) continue;
    const prefix =
      r.text === owner.text || normalized === text
        ? ""
        : [...r.text.matchAll(/[、。！？!?]/gu)]
            .map((m) => r.text.slice(0, m.index + 1))
            .find((p) => dialogueText(r.text.slice(p.length)) === text);
    if (prefix === undefined) continue;
    // Corroboration only. No substring is exported and unowned context remains unresolved.
    matches.push({
      recordId: r.id,
      requestId: view.id,
      text: r.text,
      start: r.start,
      end: r.end,
      coreCoverage: coverage,
      unmaterializedContext: prefix,
    });
  }
  return matches.length === 1 ? matches[0] : null;
}

export function recoverBaselinePrefixes(baseline, targets, views, sourceRows) {
  assert(baseline.length && baseline.every(valid), "INVALID_BASELINE");
  assert(
    new Set(baseline.map((r) => r.id)).size === baseline.length,
    "DUPLICATE_BASELINE_ID",
  );
  assert(
    new Set(targets.map((t) => t.id)).size === targets.length,
    "DUPLICATE_TARGET_ID",
  );
  const byId = new Map(sourceRows.map((r) => [r.recordId, r]));
  assert.equal(byId.size, sourceRows.length, "DUPLICATE_RAW_ID");
  for (const r of baseline) {
    const raw = byId.get(r.id);
    assert(
      raw &&
        raw.text === r.text &&
        raw.sourceStart === r.start &&
        raw.sourceEnd === r.end &&
        Array.isArray(raw.issues) &&
        !raw.issues.length,
      "RAW_BASELINE_BINDING",
    );
  }
  const decisions = targets.map((t) => {
    assert.deepEqual(closeDialogueTarget(baseline, t), t, "TARGET_NOT_CLOSED");
    const old = baseline.filter((r) => t.recordIds.includes(r.id));
    const reject = (reason) => ({
      targetId: t.id,
      status: "ABSTAIN",
      reason,
      replaceIds: [],
      records: [],
    });
    if (old.length < 2) return reject("NO_PREFIX_GROUP");
    const owners = old.filter((r) => {
      const n = dialogueText(r.text);
      return (
        [...n].length >= prefixPolicy.minimumOwnerCharacters &&
        old.every(
          (f) =>
            f === r ||
            (dialogueText(f.text).length >= 2 &&
              [...dialogueText(f.text)].length <=
                prefixPolicy.maximumPrefixCharacters &&
              n.startsWith(dialogueText(f.text)) &&
              count(n, dialogueText(f.text)) === 1 &&
              overlap(f, r)),
        )
      );
    });
    if (owners.length !== 1) return reject("NO_UNIQUE_BASELINE_WHOLE_OWNER");
    const owner = owners[0],
      rawOwner = byId.get(owner.id),
      fragments = old.filter((r) => r !== owner);
    if (
      !Number.isInteger(rawOwner.chunkIndex) ||
      fragments.some((f) => {
        const r = byId.get(f.id);
        return (
          r.chunkIndex + 1 !== rawOwner.chunkIndex ||
          r.requestId === rawOwner.requestId ||
          f.start >= owner.end
        );
      })
    )
      return reject("NOT_ADJACENT_REQUEST_PREFIXES");
    if (
      [...dialogueText(owner.text)].length /
        old.reduce((s, r) => s + [...dialogueText(r.text)].length, 0) <
      prefixPolicy.minimumRetainedRatio
    )
      return reject("EXCESSIVE_PREFIX_REMOVAL");
    const selected = views.filter((v) => v.targetId === t.id);
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
      return reject("MATCHED_AUDIO_REQUIRED");
    if (
      selected.some(
        (v) =>
          v.start > t.start ||
          v.end < t.end ||
          !v.records.length ||
          v.records.some(
            (r, i) =>
              !valid(r) ||
              r.start < v.start - 1e-7 ||
              r.end > v.end + 1e-7 ||
              (i && r.start < v.records[i - 1].end - 1e-7) ||
              r.style === "music" ||
              /[♪♫]/u.test(r.text),
          ),
      )
    )
      return reject("INVALID_OR_MUSIC_VIEW");
    if (
      old.some((r) => r.style === "music" || /[♪♫]/u.test(r.text)) ||
      selected.some(
        (v) => contentSafety(v.records, { language: "ja" }).issues.length,
      )
    )
      return reject("UNSAFE_OR_MUSIC_TEXT");
    const evidence = selected.map((v) => support(v, owner));
    if (evidence.some((r) => !r))
      return reject("NO_UNIQUE_COMPLETE_OWNER_SUPPORT");
    // Every view must say each duplicated prefix exactly once over the entire target.
    // A separate stutter/repeat segment must block removal, even if it has a full donor.
    if (
      selected.some((v) =>
        fragments.some(
          (f) =>
            count(
              dialogueText(
                v.records
                  .filter((r) => overlap(r, t))
                  .map((r) => r.text)
                  .join(""),
              ),
              dialogueText(f.text),
            ) !== 1,
        ),
      )
    )
      return reject("REPEAT_REMAINS_IN_ACOUSTIC_EVIDENCE");
    return {
      targetId: t.id,
      status: "CANDIDATE",
      reason: "BASELINE_WHOLE_OWNER_WITH_SINGLE_OCCURRENCE_SUPPORT",
      replaceIds: old.map((r) => r.id),
      records: [{ ...owner, start: t.start, end: t.end }],
      ownerRecordId: owner.id,
      removedPrefixIds: fragments.map((r) => r.id),
      evidence,
      textSource: "existing-baseline-whole-record",
      timingPolicy: "original-target-outer-envelope-not-acoustic-realignment",
      timingVerified: false,
      unresolvedContext: evidence.some((e) => e.unmaterializedContext),
    };
  });
  const active = decisions.filter((d) => d.status === "CANDIDATE");
  const conflicting = active.filter((d) =>
    active.some(
      (e) => e !== d && e.replaceIds.some((id) => d.replaceIds.includes(id)),
    ),
  );
  for (const d of conflicting)
    Object.assign(d, {
      status: "ABSTAIN",
      reason: "TRANSACTION_CONFLICT",
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
  const protectedRows = baseline.filter((r) => !removed.has(r.id));
  for (const r of protectedRows)
    assert.deepEqual(
      candidate.find((x) => x.id === r.id),
      r,
      "PROTECTED_RECORD_CHANGED",
    );
  return {
    policy: prefixPolicy,
    baseline,
    candidate,
    decisions,
    changedTargets: decisions.filter((d) => d.status === "CANDIDATE").length,
    protectedRecords: protectedRows.length,
    removedPrefixRecords: decisions
      .filter((d) => d.status === "CANDIDATE")
      .reduce((s, d) => s + d.removedPrefixIds.length, 0),
    baselineSafety: contentSafety(baseline, { language: "ja" }),
    candidateSafety: contentSafety(candidate, { language: "ja" }),
    qualityStatus: "needs-review",
    finalizationMethod: "none",
    preferredOutputs: [],
    humanValidated: false,
    automaticPromotionAllowed: false,
    inferenceRequests: 0,
    timingRepairs: 0,
  };
}
