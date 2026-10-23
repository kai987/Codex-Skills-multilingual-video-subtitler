/** Observe existing scheduling without selecting, suppressing or dispatching requests. */
import assert from "node:assert/strict";
import { planLocalRecovery } from "./vad-local-recovery.mjs";
import {
  planContextRecovery,
  boundActivityToCrop,
} from "./recovery-context-routing.mjs";

export function observeLocalRecoveryPlan({
  triage,
  baseline,
  duration,
  observations,
}) {
  assert(Array.isArray(triage.rows) && triage.rows.length, "TARGETS_REQUIRED");
  const ids = triage.rows.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, "DUPLICATE_TARGET");
  assert.deepEqual(
    observations.map((r) => r.id).sort(),
    [...ids].sort(),
    "OBSERVATION_INVENTORY",
  );
  for (const r of triage.rows) {
    assert(
      ["supported", "partial", "unsupported"].includes(r.state),
      "INVALID_TRIAGE",
    );
    assert(
      Number.isFinite(r.targetStart) &&
        Number.isFinite(r.targetEnd) &&
        r.targetStart >= 0 &&
        r.targetEnd > r.targetStart &&
        r.targetEnd <= duration,
      "INVALID_TARGET",
    );
  }
  // Keep the established scheduler and exact budget/order. No local-ASR output
  // participates here: planning must be reproducible before requests run.
  const selected = planLocalRecovery(triage, baseline, duration);
  const candidates = [...selected.probes, ...selected.deferred];
  const input = {
    baseline,
    targets: triage.rows.map((r) => {
      const c = candidates.find((p) => p.id === r.id);
      const probe = {
        id: r.id,
        start: c?.start ?? r.playbackStart,
        end: c?.end ?? r.playbackEnd,
        targetStart: r.targetStart,
        targetEnd: r.targetEnd,
      };
      const o = observations.find((p) => p.id === r.id);
      return {
        probe,
        observation: {
          id: r.id,
          sourceIntervals: boundActivityToCrop(o.sourceIntervals, probe),
        },
        views: [],
      };
    }),
  };
  const routing = planContextRecovery(input);
  const rows = routing.rows.map((r) => {
    const p = selected.probes.find((c) => c.id === r.id);
    const deferred = selected.deferred.find((c) => c.id === r.id);
    const purpose =
      r.route === "inside-existing-cue-review"
        ? "check-existing-cue-and-embedded-response"
        : r.route === "between-cues-association-review"
          ? "associate-neighboring-utterances"
          : r.route === "cue-boundary-continuation-review"
            ? "check-continuation-and-extra-response"
            : r.route === "overlapping-cues-association-review"
              ? "check-overlapping-cues"
              : r.route === "retain-unsupported-review"
                ? "retain-unverified-activity"
                : "check-unlocalized-speech";
    return {
      id: r.id,
      target: r.target,
      route: r.route,
      purpose,
      scheduling: p
        ? "selected"
        : deferred
          ? "deferred"
          : "unsupported-retained",
      deferredReason: deferred?.reason ?? null,
      plannedRequests: p ? 2 : 0,
      priorRelation: (p ?? deferred)?.relation ?? null,
      geometry: r.baselineGeometry,
      warnings: r.warnings,
      automaticInsertionAuthorized: false,
      suppressionAuthorized: false,
      missingEmbeddedResponseStillPossible: true,
      retained: true,
      reviewRequired: true,
    };
  });
  const requests = selected.probes.flatMap((p) =>
    ["whisper", "kotoba"].map((backend) => ({
      targetId: p.id,
      backend,
      start: p.start,
      end: p.end,
      frames: p.frames,
      purpose: rows.find((r) => r.id === p.id).purpose,
      dispatchAuthorized: false,
    })),
  );
  return {
    version: "local-recovery-context-plan-v1",
    mode: "observe-only",
    selected,
    rows,
    requests,
    planningEvidence: "baseline-and-vad-only-no-post-request-asr",
    selectedTargets: selected.probes.length,
    deferredTargets: selected.deferred.length,
    unsupportedRetained: selected.unsupportedRetainedIds.length,
    plannedRequests: requests.length,
    plannedAudioSeconds: selected.probes.reduce(
      (s, p) => s + (2 * p.frames) / 16000,
      0,
    ),
    actualNewRequests: 0,
    requestsSaved: 0,
    modelLoads: 0,
    schedulingChanged: false,
    decisionGatesChanged: false,
    droppedTargets: 0,
    textMutations: 0,
    timingMutations: 0,
    labelsUsed: false,
    referenceUsed: false,
    qualityStatus: "needs-review",
    finalizationMethod: "none",
  };
}
