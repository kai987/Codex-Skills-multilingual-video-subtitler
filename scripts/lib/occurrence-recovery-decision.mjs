/** Full-segment pairing only: never subtract baseline text to invent a reply. */
import { routeSourceOccurrence } from "./source-occurrence-routing.mjs";
import { decideLocalRecovery } from "./vad-local-recovery.mjs";

const overlap = (a, b) =>
  Math.min(a.end, b.end) - Math.max(a.start, b.start) > 1e-8;

export function decideOccurrenceRecovery(input) {
  const occurrence = routeSourceOccurrence(input); // strict machine input validation
  const { baseline, probe, views, observation } = input;
  const donors = occurrence.donors;
  const pairs = donors
    .filter((d) => d.backend === "whisper")
    .flatMap((a) =>
      donors
        .filter(
          (b) =>
            b.backend === "kotoba" &&
            a.normalizedText === b.normalizedText &&
            overlap(a, b),
        )
        .map((b) => ({ a, b })),
    );
  const degree = (id) =>
    pairs.filter(({ a, b }) => a.id === id || b.id === id).length;
  const decisions = pairs.map(({ a, b }, index) => {
    const id = `${probe.id}:pair:${index}`;
    const common = {
      start: Math.max(a.start, b.start, occurrence.target.start),
      end: Math.min(a.end, b.end, occurrence.target.end),
    };
    const envelope = {
      start: Math.min(a.start, b.start),
      end: Math.max(a.end, b.end),
    };
    const commonActivity = a.activityIds.filter((v) =>
      b.activityIds.includes(v),
    );
    const blockers = [];
    if (common.end - common.start <= 1e-8) blockers.push("PAIR_OUTSIDE_TARGET");
    if (degree(a.id) !== 1 || degree(b.id) !== 1)
      blockers.push("AMBIGUOUS_PAIRING");
    if (
      commonActivity.length !== 1 ||
      a.activityIds.length !== 1 ||
      b.activityIds.length !== 1
    )
      blockers.push("OCCURRENCE_ACTIVITY_NOT_LOCALIZED");
    if (
      donors.some((d) => d.id !== a.id && d.id !== b.id && overlap(d, envelope))
    )
      blockers.push("COMPETING_SEGMENT_OVERLAP");
    // Only the full, independently timed donor segments may narrow a search
    // target. Neither characters nor VAD endpoints define this interval.
    const localProbe = {
      ...probe,
      targetStart: common.start,
      targetEnd: common.end,
      hostIds: baseline.filter((c) => overlap(c, envelope)).map((c) => c.id),
    };
    const pairViews = [a, b].map((d) => ({
      backend: d.backend,
      records: [{ start: d.start, end: d.end, text: d.text }],
    }));
    const legacyGate = blockers.length
      ? null
      : decideLocalRecovery(
          localProbe,
          baseline,
          pairViews,
          observation.sourceIntervals,
        );
    if (legacyGate?.status === "ABSTAIN") blockers.push(legacyGate.reason);
    const candidate =
      legacyGate?.status === "CANDIDATE" && !blockers.length
        ? { ...legacyGate.insertions[0], id: `local-${id}` }
        : null;
    return {
      id,
      donorIds: [a.id, b.id],
      commonTargetInterval: common.end > common.start ? common : null,
      segmentEnvelope: envelope,
      activityIds: commonActivity,
      status: candidate ? "REVIEW_CANDIDATE" : "ABSTAIN",
      blockers,
      legacyGate,
      candidate,
      acousticTimingVerified: false,
      automaticInsertionAuthorized: false,
    };
  });
  // Pairwise qualification alone cannot authorize overlapping insertions.
  for (const d of decisions)
    if (
      d.candidate &&
      decisions.some(
        (other) =>
          other.id !== d.id &&
          other.candidate &&
          overlap(d.candidate, other.candidate),
      )
    ) {
      d.blockers.push("COMPETING_CANDIDATE_OVERLAP");
    }
  for (const d of decisions)
    if (d.blockers.includes("COMPETING_CANDIDATE_OVERLAP")) {
      d.candidate = null;
      d.status = "ABSTAIN";
    }
  const evidence = donors.map((d) => ({
    ...d,
    pairedDecisionIds: decisions
      .filter((p) => p.donorIds.includes(d.id))
      .map((p) => p.id),
    evidenceStatus: degree(d.id)
      ? "paired-evidence-retained"
      : "unpaired-evidence-retained",
    unresolvedReason: degree(d.id)
      ? null
      : "NO_MATCHING_FULL_SEGMENT_AT_SAME_TIME",
    retained: true,
    confirmedSpeech: null,
  }));
  const reviewCandidates = decisions.flatMap((d) =>
    d.candidate ? [d.candidate] : [],
  );
  const normalizedViews = ["whisper", "kotoba"]
    .map((backend) => views.find((v) => v.backend === backend))
    .filter(Boolean);
  const originalDecision = decideLocalRecovery(
    {
      ...probe,
      hostIds: baseline
        .filter((b) => overlap(b, occurrence.target))
        .map((b) => b.id),
    },
    baseline,
    normalizedViews,
    observation.sourceIntervals,
  );
  return {
    version: "occurrence-recovery-decision-v1",
    id: probe.id,
    originalDecision,
    occurrence,
    evidence,
    pairDecisions: decisions,
    reviewCandidates,
    status: reviewCandidates.length ? "REVIEW_CANDIDATE" : "ABSTAIN",
    notRun: !views.length,
    retainedDonors: evidence.length,
    droppedDonors: 0,
    requests: [],
    insertions: [],
    deletions: [],
    timingChanges: [],
    newInference: 0,
    labelsUsed: false,
    referenceUsed: false,
    subtitleMutationAuthorized: false,
    qualityStatus: "needs-review",
    finalizationMethod: "none",
  };
}
