/** Separate short-utterance shadow policy. Never changes source cue timing or defaults. */
import assert from "node:assert/strict";
import { diagnoseDialogueAssociation } from "./dialogue-association-diagnostic.mjs";
import { dialogueText } from "./whole-dialogue-recovery.mjs";
import { contentSafety } from "./content-safety-gate.mjs";
export const shortDialoguePolicy = Object.freeze({
  version: "anchored-short-whole-cue-shadow-v1",
  minimumCharacters: 6,
  maximumCharacters: 15,
  minimumCoverage: 0.8,
  maximumEditRatio: 0.25,
  minimumLengthRatio: 0.75,
  maximumLengthRatio: 1.25,
  maximumBoundaryDisagreementSeconds: 0.2,
  minimumAnchorCharacters: 4,
  maxTargets: 3,
  defaultPromotion: false,
  newInference: 0,
  timing: "original-single-cue-unchanged",
});
const norm = dialogueText,
  overlap = (a, b) => a.start < b.end && b.start < a.end;
const occurrences = (s, n) => {
  let k = 0;
  for (let i = 0; (i = s.indexOf(n, i)) >= 0; i++) k++;
  return k;
};
function distance(a, b) {
  a = [...a];
  b = [...b];
  let p = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const r = [i];
    for (let j = 1; j <= b.length; j++)
      r[j] = Math.min(
        r[j - 1] + 1,
        p[j] + 1,
        p[j - 1] + Number(a[i - 1] !== b[j - 1]),
      );
    p = r;
  }
  return p[b.length];
}
function risky(r) {
  return (
    r.style === "music" ||
    /[♪♫]/u.test(r.text) ||
    contentSafety([r], { language: "ja" }).issues.length > 0
  );
}
export function decideShortDialogue(baseline, target, views, duration) {
  assert(
    Number.isFinite(duration) &&
      duration > 0 &&
      baseline.every((r) => r.end <= duration + 1e-7),
    "INVALID_SOURCE_DURATION",
  );
  const diagnostic = diagnoseDialogueAssociation(baseline, target, views);
  const original = baseline.filter((r) => target.recordIds.includes(r.id));
  const base = {
    targetId: target.id,
    status: "ABSTAIN",
    replaceId: null,
    replacement: null,
    timingVerified: false,
  };
  const reject = (reason, details = {}) => ({ ...base, reason, ...details });
  if (original.length !== 1) return reject("ONE_BASELINE_CUE_REQUIRED");
  const old = original[0],
    text = norm(old.text),
    length = [...text].length;
  if (length < 6 || length > 15) return reject("OUTSIDE_SHORT_CUE_SCOPE");
  if (risky(old)) return reject("BASELINE_CONTENT_RISK");
  const outside = baseline.filter((r) => r.id !== old.id);
  if (outside.some((r) => overlap(r, old))) return reject("BASELINE_OVERLAP");
  const context = baseline.filter((r) =>
    diagnostic.context.recordIds.includes(r.id),
  );
  if (occurrences(context.map((r) => norm(r.text)).join(""), text) !== 1)
    return reject("REPEATED_BASELINE_TEXT");
  const options = views.map((v) =>
    v.records.filter((r) => {
      const n = [...norm(r.text)].length;
      const startBoundary = r.start <= v.start + 0.02,
        endBoundary = r.end >= v.end - 0.02;
      return (
        n >= 6 &&
        n <= 15 &&
        !risky(r) &&
        r.start >= old.start - 1e-7 &&
        r.end <= old.end + 1e-7 &&
        (r.end - r.start) / (old.end - old.start) >=
          shortDialoguePolicy.minimumCoverage &&
        (!startBoundary || (v.start === 0 && old.start === 0)) &&
        (!endBoundary || (v.end === duration && old.end === duration)) &&
        !outside.some((o) => overlap(o, r))
      );
    }),
  );
  const pairs = options[0].flatMap((a) =>
    options[1].filter((b) => norm(a.text) === norm(b.text)).map((b) => [a, b]),
  );
  if (pairs.length !== 1)
    return reject("NO_UNIQUE_CONTAINED_SHORT_PAIR", {
      eligibleDonorIds: options.map((rs) => rs.map((r) => r.id)),
    });
  const [a, b] = pairs[0],
    proposed = norm(a.text);
  if (
    views.some(
      (v) =>
        occurrences(v.records.map((r) => norm(r.text)).join(""), proposed) !==
        1,
    ) ||
    outside.some(
      (r) =>
        overlap(r, { start: views[0].start, end: views[0].end }) &&
        norm(r.text).includes(proposed),
    )
  )
    return reject("REPEATED_DONOR_TEXT");
  if (
    Math.abs(a.start - b.start) > 0.2 + 1e-7 ||
    Math.abs(a.end - b.end) > 0.2 + 1e-7
  )
    return reject("DONOR_BOUNDARY_DISAGREEMENT");
  const prev = [...outside]
    .filter((r) => r.end <= old.start)
    .sort((x, y) => y.end - x.end)[0];
  const next = [...outside]
    .filter((r) => r.start >= old.end)
    .sort((x, y) => x.start - y.start)[0];
  const anchors = [];
  for (const [side, neighbor] of [
    ["before", prev],
    ["after", next],
  ]) {
    if (!neighbor) {
      if (
        side === "before"
          ? old.start !== 0 || views[0].start !== 0
          : old.end !== duration || views[0].end !== duration
      )
        return reject("UNANCHORED_SOURCE_EDGE", { side });
      anchors.push({ side, sourceBoundary: true });
      continue;
    }
    const n = norm(neighbor.text);
    if (
      [...n].length < 4 ||
      risky(neighbor) ||
      occurrences(context.map((r) => norm(r.text)).join(""), n) !== 1
    )
      return reject("WEAK_OR_REPEATED_NEIGHBOR_ANCHOR", { side });
    const matches = views.map((v, i) =>
      v.records.filter(
        (r) =>
          r.id !== pairs[0][i].id &&
          norm(r.text) === n &&
          (side === "before"
            ? r.end <= pairs[0][i].start
            : r.start >= pairs[0][i].end),
      ),
    );
    if (
      matches.some((rs) => rs.length !== 1) ||
      views.some(
        (v) =>
          occurrences(v.records.map((r) => norm(r.text)).join(""), n) !== 1,
      )
    )
      return reject("NEIGHBOR_NOT_UNIQUELY_PRESERVED", { side });
    anchors.push({
      side,
      baselineId: neighbor.id,
      donorIds: matches.map((rs) => rs[0].id),
      baselineEnvelopeCaptured:
        neighbor.start >= views[0].start && neighbor.end <= views[0].end,
      meaning:
        "full segment text match in order; not acoustic boundary verification",
    });
  }
  if (proposed === text) return reject("TEXT_UNCHANGED", { anchors });
  const ratio = [...proposed].length / length,
    editRatio =
      distance(text, proposed) / Math.max(length, [...proposed].length);
  if (ratio < 0.75 || ratio > 1.25 || editRatio > 0.25)
    return reject("EXCESSIVE_TEXT_CHANGE", { ratio, editRatio });
  return {
    ...base,
    status: "CANDIDATE",
    reason: "PAIRED_SHORT_WHOLE_TEXT_ORDERED_NEIGHBORS",
    replaceId: old.id,
    replacement: { ...old, text: a.text },
    donorIds: [a.id, b.id],
    anchors,
    ratio,
    editRatio,
    sourceEdgeObserved:
      a.start <= views[0].start + 0.02 || b.start <= views[1].start + 0.02,
    gainClassification: "UNMEASURED_MAY_BE_ORTHOGRAPHY_ONLY",
    semanticGainVerified: false,
  };
}
export function buildShortDialogueCandidate(
  baseline,
  targets,
  views,
  duration,
) {
  assert(
    targets.length <= shortDialoguePolicy.maxTargets &&
      new Set(targets.map((t) => t.id)).size === targets.length,
    "TARGET_LIMIT_OR_DUPLICATE",
  );
  const decisions = targets.map((t) =>
    decideShortDialogue(
      baseline,
      t,
      views.filter((v) => v.targetId === t.id),
      duration,
    ),
  );
  const conflicts = new Set(
    decisions
      .filter(
        (d) =>
          d.status === "CANDIDATE" &&
          decisions.some(
            (e) =>
              e !== d &&
              e.status === "CANDIDATE" &&
              e.replaceId === d.replaceId,
          ),
      )
      .map((d) => d.replaceId),
  );
  for (const d of decisions)
    if (conflicts.has(d.replaceId))
      Object.assign(d, {
        status: "ABSTAIN",
        reason: "TARGET_TRANSACTION_CONFLICT",
        replaceId: null,
        replacement: null,
      });
  const changes = new Map(
    decisions
      .filter((d) => d.status === "CANDIDATE")
      .map((d) => [d.replaceId, d.replacement]),
  );
  const candidate = baseline.map((r) => changes.get(r.id) ?? r);
  return {
    policy: shortDialoguePolicy,
    baseline,
    candidate,
    decisions,
    changedCues: changes.size,
    newInference: 0,
    referenceUsed: false,
    timingMutations: 0,
    preferredOutputs: [],
    automaticPromotionAllowed: false,
    humanValidated: false,
    finalizationMethod: "none",
    qualityStatus: "needs-review",
    limitations: [
      "Whisper-derived models are not independent truth",
      "Full neighbor text match does not verify acoustic completeness",
      "Shadow text candidates retain unverified original timing",
    ],
  };
}
