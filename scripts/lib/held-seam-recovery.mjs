/** Cached local repair is separate from whole-file release. No inference or reference input. */
import assert from "node:assert/strict";
import { contentSafety } from "./content-safety-gate.mjs";
import { proposeContextText } from "./seam-context-text.mjs";
import { assembleSeams } from "./seam-refinement.mjs";

const safety = (rows) =>
  contentSafety(
    rows.map((r) => ({
      ...r,
      start: r.sourceStart,
      end: r.sourceEnd,
    })),
    { language: "ja" },
  );
const overlap = (a, b) => a.start < b.end && b.start < a.end;
const interval = (x) =>
  Number.isFinite(x.start) &&
  Number.isFinite(x.end) &&
  x.start >= 0 &&
  x.end > x.start;

export function recoverHeldSeams({ baseline, targets, views }) {
  assert(Array.isArray(baseline) && baseline.length, "BASELINE_REQUIRED");
  assert(
    new Set(baseline.map((r) => r.recordId)).size === baseline.length,
    "DUPLICATE_BASELINE_ID",
  );
  assert(
    new Set(targets.map((t) => t.id)).size === targets.length,
    "DUPLICATE_TARGET_ID",
  );
  const initialSafety = safety(baseline);
  const decisions = targets.map((target) => {
    const reject = (reason, extra = {}) => ({
      targetId: target.id,
      status: "ABSTAIN",
      reason,
      replaceIds: [],
      records: [],
      ...extra,
    });
    const selected = views.filter((v) => v.targetId === target.id);
    if (selected.length !== 2 || selected.some((v) => !interval(v)))
      return reject("TWO_VALID_CACHED_WINDOWS_REQUIRED");
    if (initialSafety.issues.some((i) => !interval(i)))
      return reject("UNLOCALIZED_BASELINE_RISK");
    const risk = initialSafety.issues.filter((i) =>
      selected.some((v) => overlap(i, v)),
    );
    if (risk.length)
      return reject("RISK_INTERSECTS_REQUEST_CONTEXT", { blockedBy: risk });
    if (
      selected.some((v) =>
        v.records.some((r) => r.style === "music" || /[♪♫]/u.test(r.text)),
      )
    )
      return reject("DECLARED_MUSIC_REQUIRES_SEPARATE_PATH");
    const donorRisk = selected.flatMap((v) => safety(v.records).issues);
    if (donorRisk.length)
      return reject("CACHED_DONOR_CONTENT_RISK", { blockedBy: donorRisk });
    // Keep all old whole-donor, conflict, occurrence and protected-neighbor guards.
    const decision = proposeContextText(target, baseline, selected);
    if (decision.status !== "CANDIDATE") return decision;
    const old = baseline.filter((r) =>
      decision.replaceIds.includes(r.recordId),
    );
    assert.equal(old.length, decision.replaceIds.length, "UNBOUND_REPLACEMENT");
    assert.equal(decision.records.length, 1, "WHOLE_SINGLE_CUE_REQUIRED");
    const candidate = decision.records[0];
    assert(
      Math.abs(
        candidate.sourceStart - Math.min(...old.map((r) => r.sourceStart)),
      ) < 1e-7 &&
        Math.abs(
          candidate.sourceEnd - Math.max(...old.map((r) => r.sourceEnd)),
        ) < 1e-7,
      "ORIGINAL_OUTER_ENVELOPE_REQUIRED",
    );
    return decision;
  });
  const candidate = assembleSeams(baseline, decisions);
  const removed = new Set(decisions.flatMap((d) => d.replaceIds));
  const preserved = baseline.filter((r) => !removed.has(r.recordId));
  for (const r of preserved)
    assert.deepEqual(
      candidate.find((x) => x.recordId === r.recordId),
      r,
      "PROTECTED_RECORD_CHANGED",
    );
  const finalSafety = safety(candidate);
  return {
    version: "held-seam-cache-recovery-v1",
    baseline,
    candidate,
    decisions,
    initialSafety,
    finalSafety,
    changedTargets: decisions.filter((d) => d.status === "CANDIDATE").length,
    preservedRecords: preserved.length,
    inputCueCount: baseline.length,
    candidateCueCount: candidate.length,
    newInference: 0,
    modelLoads: 0,
    referenceUsed: false,
    humanValidated: false,
    qualityStatus: "needs-review",
    finalizationMethod: "none",
    automaticPromotionAllowed: false,
    timingPolicy: "preserve-target-outer-envelope; no acoustic retiming",
    preferredOutputs: [],
  };
}
