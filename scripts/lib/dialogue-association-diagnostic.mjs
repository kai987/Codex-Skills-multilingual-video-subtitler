/** Offline explanations only: never creates replacement text or substring timestamps. */
import assert from "node:assert/strict";
import {
  dialoguePolicy,
  dialogueText,
  closeDialogueTarget,
  recoverWholeDialogue,
} from "./whole-dialogue-recovery.mjs";
import { contentSafety } from "./content-safety-gate.mjs";

export const associationDiagnosticPolicy = Object.freeze({
  version: "whole-record-association-diagnostic-v1",
  minimumAnchorCharacters: 4,
  maxViewRecords: 32,
  maxGroups: 128,
  inferenceAllowed: false,
  replacementAllowed: false,
});
const overlap = (a, b) => a.start < b.end && b.start < a.end;
const valid = (r) =>
  typeof r.id === "string" &&
  Number.isFinite(r.start) &&
  Number.isFinite(r.end) &&
  r.start >= 0 &&
  r.end > r.start &&
  typeof r.text === "string" &&
  dialogueText(r.text).length > 0;
const count = (haystack, needle) => {
  let n = 0;
  for (let i = 0; (i = haystack.indexOf(needle, i)) >= 0; i++) n++;
  return n;
};
function groups(view, target, protectedRows) {
  const output = [];
  for (let i = 0; i < view.records.length; i++)
    for (let j = i; j < view.records.length; j++) {
      const rows = view.records.slice(i, j + 1);
      if (rows.some((r) => !overlap(r, target))) continue;
      const normalized = dialogueText(rows.map((r) => r.text).join(""));
      const characters = [...normalized].length;
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
      const protectedIds = protectedRows
        .filter((r) => rows.some((d) => overlap(r, d)))
        .map((r) => r.id);
      const blockers = [];
      if (characters < dialoguePolicy.minimumCharacters)
        blockers.push("SHORT_WHOLE_DONOR");
      if (coverage < dialoguePolicy.minimumCoverage)
        blockers.push("INSUFFICIENT_TARGET_COVERAGE");
      if (protectedIds.length) blockers.push("PROTECTED_NEIGHBOR_OVERLAP");
      if (rows.some((r) => r.style === "music" || /[♪♫]/u.test(r.text)))
        blockers.push("MUSIC");
      if (contentSafety(rows, { language: "ja" }).issues.length)
        blockers.push("CONTENT_RISK");
      output.push({
        id: `${view.id}:${i}-${j}`,
        viewId: view.id,
        recordIds: rows.map((r) => r.id),
        text: rows.map((r) => r.text).join(""),
        normalized,
        characters,
        coverage,
        protectedIds,
        blockers,
        cropEdge:
          rows[0].start <= view.start + 0.02 ||
          rows.at(-1).end >= view.end - 0.02,
        meaning:
          "complete raw segment group; not verified complete spoken utterance",
      });
      assert(
        output.length <= associationDiagnosticPolicy.maxGroups,
        "DIAGNOSTIC_GROUP_LIMIT",
      );
    }
  return output;
}
export function diagnoseDialogueAssociation(baseline, target, views) {
  assert(baseline.length && baseline.every(valid), "INVALID_BASELINE");
  assert.equal(
    new Set(baseline.map((r) => r.id)).size,
    baseline.length,
    "DUPLICATE_BASELINE_ID",
  );
  const closed = closeDialogueTarget(baseline, target);
  assert.deepEqual(closed, target, "TARGET_NOT_WHOLE_RECORD_CLOSED");
  assert.equal(views.length, 2, "TWO_VIEWS_REQUIRED");
  assert(
    views[0].id !== views[1].id && views[0].modelHash !== views[1].modelHash,
    "DISTINCT_MODEL_CONFIGURATIONS_REQUIRED",
  );
  assert(
    views.every((v) =>
      [v.audioHash, v.rawHash, v.modelHash].every((h) =>
        /^[a-f0-9]{64}$/u.test(h),
      ),
    ),
    "INVALID_IDENTITY",
  );
  assert(
    views[0].audioHash === views[1].audioHash &&
      views[0].start === views[1].start &&
      views[0].end === views[1].end,
    "MATCHED_PHYSICAL_AUDIO_REQUIRED",
  );
  for (const v of views) {
    assert(
      v.targetId === target.id &&
        Number.isFinite(v.start) &&
        Number.isFinite(v.end) &&
        v.start >= 0 &&
        v.start <= target.start &&
        v.end >= target.end,
      "INVALID_VIEW_ENVELOPE",
    );
    assert(
      v.records.length <= associationDiagnosticPolicy.maxViewRecords,
      "DIAGNOSTIC_RECORD_LIMIT",
    );
    assert.equal(
      new Set(v.records.map((r) => r.id)).size,
      v.records.length,
      "DUPLICATE_VIEW_RECORD",
    );
    assert(
      v.records.every(
        (r, i) =>
          valid(r) &&
          r.start >= v.start - 1e-7 &&
          r.end <= v.end + 1e-7 &&
          (!i || r.start >= v.records[i - 1].end - 1e-7),
      ),
      "INVALID_VIEW_RECORDS",
    );
  }
  const protectedRows = baseline.filter(
    (r) => !target.recordIds.includes(r.id),
  );
  const context = closeDialogueTarget(baseline, {
    id: "context",
    start: views[0].start,
    end: views[0].end,
  });
  const contextRows = baseline.filter((r) => context.recordIds.includes(r.id));
  const partialContextIds = contextRows
    .filter((r) => r.start < views[0].start || r.end > views[0].end)
    .map((r) => r.id);
  const anchors = contextRows.map((r) => {
    const normalized = dialogueText(r.text),
      characters = [...normalized].length;
    const baselineOccurrences = count(
      contextRows.map((x) => dialogueText(x.text)).join(""),
      normalized,
    );
    const occurrences = views.map((v) => ({
      viewId: v.id,
      count: count(
        v.records.map((x) => dialogueText(x.text)).join(""),
        normalized,
      ),
    }));
    return {
      recordId: r.id,
      role: target.recordIds.includes(r.id) ? "target" : "neighbor",
      text: r.text,
      characters,
      baselineOccurrences,
      occurrences,
      status:
        characters < associationDiagnosticPolicy.minimumAnchorCharacters
          ? "TOO_SHORT"
          : baselineOccurrences !== 1 || occurrences.some((o) => o.count > 1)
            ? "AMBIGUOUS_REPEAT"
            : occurrences.every((o) => o.count === 1)
              ? "UNIQUE_TEXT_IN_BOTH_VIEWS"
              : "NOT_SHARED_EXACTLY",
      acousticOwnershipVerified: false,
    };
  });
  const viewGroups = views.map((v) => ({
    viewId: v.id,
    groups: groups(v, target, protectedRows),
  }));
  const relations = [];
  for (const a of viewGroups[0].groups)
    for (const b of viewGroups[1].groups) {
      const relation =
        a.normalized === b.normalized
          ? "EXACT_WHOLE_GROUP_TEXT"
          : a.normalized.includes(b.normalized) ||
              b.normalized.includes(a.normalized)
            ? "CONTAINMENT_ONLY"
            : "TEXT_DISAGREEMENT";
      relations.push({
        left: a.id,
        right: b.id,
        relation,
        blockers: [...new Set([...a.blockers, ...b.blockers])],
        substringTimingAvailable: false,
      });
    }
  const replay = recoverWholeDialogue(baseline, [target], views).decisions[0];
  // Verify explanatory gates track the actual unchanged group filter, not an alternative selector.
  if (replay.comparableGroups)
    for (const [i, actual] of replay.comparableGroups.entries())
      assert.deepEqual(
        viewGroups[i].groups
          .filter((g) => g.blockers.length === 0)
          .map((g) => g.normalized),
        actual.map((g) => g.normalized),
        "DIAGNOSTIC_POLICY_DRIFT",
      );
  const flags = [];
  if (
    relations.some(
      (r) =>
        r.relation === "EXACT_WHOLE_GROUP_TEXT" &&
        r.blockers.includes("SHORT_WHOLE_DONOR"),
    )
  )
    flags.push("AGREED_SHORT_RAW_GROUP");
  if (viewGroups.some((v) => v.groups.some((g) => g.protectedIds.length)))
    flags.push("NEIGHBOR_BOUNDARY_CONFLICT");
  if (relations.some((r) => r.relation === "CONTAINMENT_ONLY"))
    flags.push("CONTAINMENT_NOT_COMPLETE_AGREEMENT");
  if (
    relations.length &&
    relations.every((r) => r.relation === "TEXT_DISAGREEMENT")
  )
    flags.push("NO_EXACT_OR_CONTAINED_GROUP_TEXT");
  if (partialContextIds.length) flags.push("WHOLE_CONTEXT_NOT_CAPTURED");
  if (anchors.some((a) => a.status === "AMBIGUOUS_REPEAT"))
    flags.push("REPEATED_ANCHOR_AMBIGUITY");
  if (
    anchors.some(
      (a) => a.role === "target" && a.status === "UNIQUE_TEXT_IN_BOTH_VIEWS",
    )
  )
    flags.push("TARGET_TEXT_PRESENT_OWNERSHIP_UNVERIFIED");
  if (views.some((v) => v.records.length === 0))
    flags.push("EMPTY_VIEW_NOT_SILENCE");
  return {
    policy: associationDiagnosticPolicy,
    target,
    originalDecision: { status: replay.status, reason: replay.reason },
    flags,
    context: {
      start: context.start,
      end: context.end,
      recordIds: context.recordIds,
      partialContextIds,
      requestStart: views[0].start,
      requestEnd: views[0].end,
    },
    anchors,
    viewGroups,
    relations,
    referenceUsed: false,
    newInference: 0,
    subtitleMutations: 0,
    timingVerified: false,
    automaticPromotionAllowed: false,
    qualityStatus: "needs-review",
    limitation:
      "Exact text anchors and model agreement do not establish unique acoustic occurrence or substring timing",
  };
}
