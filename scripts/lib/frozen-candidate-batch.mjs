import assert from "node:assert/strict";
import { proposeSeamTextOnly } from "./seam-text-only.mjs";
import { assembleSeams } from "./seam-refinement.mjs";
import {
  decideLocalRecovery,
  assembleLocalRecovery,
} from "./vad-local-recovery.mjs";
import { reviewAnchoredActivity } from "./anchored-activity-review.mjs";
import { serializeRecords } from "../../packages/video-subtitler/dist/standalone/bounded.js";
const tuples = (rows) => rows.map((r) => [r.start, r.end, r.text]);
const stage = (reason) =>
  /TEXT_CONFLICT|TEXT_GROUP/u.test(reason)
    ? "text-evidence"
    : /CROP_EDGE|TIMING|BOUNDAR/u.test(reason)
      ? "timing-evidence"
      : /LOCALIZED|ANCHOR/u.test(reason)
        ? "occurrence-association"
        : "application-policy";

/** Reuse established policies without labels, references, thresholds or new inference. */
export function replayCandidateBatch({ seam, local, refreshed }) {
  assert.equal(local.referenceUsed, false);
  assert.equal(local.labelsUsed, false);
  const seams = seam.targets.map((t) =>
    proposeSeamTextOnly(
      t,
      seam.baseline,
      seam.views.filter((v) => v.targetId === t.id),
    ),
  );
  const historical = assembleSeams(seam.baseline, seams);
  // The selected current baseline must be exactly the already-delivered seam output.
  assert.deepEqual(
    tuples(local.baseline),
    tuples(serializeRecords(historical, "ja").cues),
    "CURRENT_BASELINE_NOT_BOUND_TO_SEAMS",
  );
  const decisions = local.probes.map((p) =>
    decideLocalRecovery(
      p,
      local.baseline,
      local.views.filter((v) => v.targetId === p.id),
      local.vadObservations.find((o) => o.id === p.id).sourceIntervals,
    ),
  );
  const candidate = assembleLocalRecovery(local.baseline, decisions);
  const rows = [
    ...seams.map((d) => ({
      id: `seam:${d.targetId}`,
      route: "seam-text-only",
      status: d.status === "CANDIDATE" ? "already-applied" : "abstained",
      reason: d.reason,
      blockingStage: d.status === "CANDIDATE" ? null : stage(d.reason),
      changesThisRun: 0,
    })),
    ...decisions.map((d) => ({
      id: `local:${d.id}`,
      route: "paired-local-recovery",
      status: d.status === "CANDIDATE" ? "applied-to-copy" : "abstained",
      reason: d.reason,
      blockingStage: d.status === "CANDIDATE" ? null : stage(d.reason),
      changesThisRun: d.insertions.length,
    })),
  ];
  const review = reviewAnchoredActivity(refreshed.input);
  assert.deepEqual(review, refreshed.after, "STALE_REFRESH_REVIEW");
  assert.deepEqual(
    refreshed.input.baseline,
    local.baseline,
    "REFRESH_BASELINE_MISMATCH",
  );
  return {
    version: "frozen-candidate-batch-v1",
    baseline: local.baseline,
    candidate,
    decisions,
    rows,
    diagnostics: [
      {
        text: review.text,
        activity: review.activity,
        blockers: review.blockers,
        route: "diagnostic-only-not-an-insertion",
        primaryMutationAuthorized: false,
      },
    ],
    summary: {
      targets: rows.length,
      alreadyApplied: rows.filter((r) => r.status === "already-applied").length,
      abstained: rows.filter((r) => r.status === "abstained").length,
      newInsertions: candidate.length - local.baseline.length,
      baselineCueCount: local.baseline.length,
      candidateCueCount: candidate.length,
      newInference: 0,
      referenceUsed: false,
      labelsUsed: false,
      qualityStatus: "needs-review",
      finalizationMethod: "none",
    },
  };
}
