/** Machine-evidence routing only. Activity components are NOT lexical boundaries. */
import assert from "node:assert/strict";
import { normalizeSpeech } from "./speech-support-policy.mjs";

const overlaps = (a, b) =>
  Math.min(a.end, b.end) - Math.max(a.start, b.start) > 1e-8;
const valid = (r) =>
  Number.isFinite(r.start) &&
  Number.isFinite(r.end) &&
  r.start >= 0 &&
  r.end > r.start;
const isText = (r) =>
  valid(r) && typeof r.text === "string" && normalizeSpeech(r.text);

export function sourceOccurrenceInputs(plan, views) {
  assert(
    plan.referenceUsed === false && plan.labelsUsed === false,
    "REFERENCE_INPUT_FORBIDDEN",
  );
  const probes = [...plan.probes, ...plan.selected.deferred];
  const ids = [
    ...probes.map((p) => p.id),
    ...plan.selected.unsupportedRetainedIds,
  ];
  assert.equal(new Set(ids).size, ids.length, "DUPLICATE_TARGET");
  assert.equal(
    new Set(plan.vadObservations.map((o) => o.id)).size,
    plan.vadObservations.length,
    "DUPLICATE_OBSERVATION",
  );
  assert.deepEqual(
    [...ids].sort(),
    plan.vadObservations.map((o) => o.id).sort(),
    "INCOMPLETE_ACTIVITY_INVENTORY",
  );
  assert(
    views.every((v) => plan.probes.some((p) => p.id === v.targetId)),
    "UNEXPECTED_ASR_TARGET",
  );
  assert(
    plan.probes.every(
      (p) => views.filter((v) => v.targetId === p.id).length === 2,
    ),
    "MISSING_EXECUTED_VIEW",
  );
  return probes.map((probe) => ({
    probe,
    baseline: plan.baseline,
    observation: plan.vadObservations.find((o) => o.id === probe.id),
    views: views.filter((v) => v.targetId === probe.id),
  }));
}

export function routeSourceOccurrence(input) {
  assert.deepEqual(
    Object.keys(input).sort(),
    ["baseline", "observation", "probe", "views"],
    "MACHINE_EVIDENCE_FIELDS_ONLY",
  );
  const { probe, baseline, observation, views } = input;
  const target = { start: probe.targetStart, end: probe.targetEnd };
  assert(
    valid(probe) &&
      valid(target) &&
      target.start >= probe.start &&
      target.end <= probe.end,
    "INVALID_PROBE",
  );
  assert(
    typeof probe.id === "string" && probe.id && observation.id === probe.id,
    "TARGET_ID_MISMATCH",
  );
  assert(
    baseline.every(isText) &&
      baseline.every((r) => typeof r.id === "string") &&
      new Set(baseline.map((r) => r.id)).size === baseline.length,
    "INVALID_BASELINE",
  );
  assert(
    Array.isArray(observation.sourceIntervals) &&
      observation.sourceIntervals.every(
        (r, i, all) =>
          valid(r) &&
          r.start >= probe.start &&
          r.end <= probe.end &&
          (!i || r.start >= all[i - 1].end),
      ),
    "INVALID_SOURCE_ACTIVITY",
  );
  assert(
    views.length === 0 ||
      (views.length === 2 &&
        new Set(views.map((v) => v.backend)).size === 2 &&
        views.every((v) => ["whisper", "kotoba"].includes(v.backend))),
    "INVALID_BACKENDS",
  );
  assert(
    views.every(
      (v) =>
        v.targetId === probe.id &&
        v.records.every(
          (r, i, all) =>
            isText(r) &&
            r.start >= probe.start - 1e-8 &&
            r.end <= probe.end + 1e-8 &&
            (!i || r.start >= all[i - 1].end - 1e-8),
        ),
    ),
    "INVALID_VIEWS",
  );
  const activity = observation.sourceIntervals.map((r, index) => ({
    id: `${probe.id}:activity:${index}`,
    ...r,
    targetOverlap: overlaps(r, target),
  }));
  const donors = views.flatMap((v) =>
    v.records.map((r, index) => {
      const text = normalizeSpeech(r.text);
      return {
        id: `${v.backend}:${index}`,
        backend: v.backend,
        index,
        ...r,
        normalizedText: text,
        activityIds: activity.filter((a) => overlaps(a, r)).map((a) => a.id),
        targetOverlap: overlaps(r, target),
        cropEdge: r.start <= probe.start + 0.08 || r.end >= probe.end - 0.08,
        baselineLinks: baseline
          .filter((b) => overlaps(b, probe))
          .flatMap((b) => {
            const other = normalizeSpeech(b.text);
            const relation =
              text === other
                ? "exact"
                : Math.min(Array.from(text).length, Array.from(other).length) >=
                      4 &&
                    (text.includes(other) || other.includes(text))
                  ? "containment"
                  : null;
            return relation
              ? [{ id: b.id, relation, timingOverlap: overlaps(b, r) }]
              : [];
          }),
        timingAuthority: "unverified-asr-segment",
      };
    }),
  );
  const components = activity.map((a) => {
    const selected = donors.filter((d) => d.activityIds.includes(a.id));
    const byBackend = ["whisper", "kotoba"].map((b) =>
      selected.filter((d) => d.backend === b),
    );
    const single = byBackend.every((rows) => rows.length === 1);
    const consensus =
      single &&
      byBackend[0][0].normalizedText === byBackend[1][0].normalizedText
        ? byBackend[0][0].normalizedText
        : null;
    const blockers = [];
    if (!views.length) blockers.push("ASR_NOT_RUN");
    else {
      if (byBackend.some((rows) => rows.length === 0))
        blockers.push("BACKEND_TARGET_EVIDENCE_MISSING");
      if (byBackend.some((rows) => rows.length > 1))
        blockers.push("MULTIPLE_SEGMENTS_WITHIN_ACTIVITY");
      if (selected.some((d) => d.activityIds.length > 1))
        blockers.push("SEGMENT_SPANS_MULTIPLE_ACTIVITIES");
      if (single && !consensus) blockers.push("TEXT_CONFLICT");
      if (selected.some((d) => d.cropEdge)) blockers.push("CROP_EDGE_TIMING");
      if (selected.some((d) => d.baselineLinks.length))
        blockers.push("POSSIBLE_EXISTING_CONTEXT");
      if (baseline.some((b) => overlaps(b, a)))
        blockers.push("EXISTING_CUE_ACTIVITY_OVERLAP");
    }
    const route = !views.length
      ? "asr-not-run"
      : byBackend.some((rows) => rows.length === 0)
        ? "missing-backend-evidence"
        : blockers.includes("MULTIPLE_SEGMENTS_WITHIN_ACTIVITY")
          ? "mixed-context-localization"
          : blockers.includes("SEGMENT_SPANS_MULTIPLE_ACTIVITIES")
            ? "cross-component-localization"
            : !consensus
              ? "text-conflict"
              : blockers.some((b) =>
                    [
                      "POSSIBLE_EXISTING_CONTEXT",
                      "EXISTING_CUE_ACTIVITY_OVERLAP",
                    ].includes(b),
                  )
                ? "existing-context-review"
                : "text-consensus-boundaries-unverified";
    return {
      ...a,
      donorIds: selected.map((d) => d.id),
      consensusText: consensus,
      alignmentText:
        route === "text-consensus-boundaries-unverified" ? consensus : null,
      route,
      blockers,
      subtitleInterval: null,
      activityMeaning: "detection-component-not-word-or-utterance-boundary",
    };
  });
  const selected = components.filter((c) => c.targetOverlap);
  const route = !selected.length
    ? "target-activity-unsupported"
    : !views.length
      ? "asr-not-run"
      : selected.length > 1
        ? "multiple-target-activities"
        : selected[0].route;
  return {
    version: "source-occurrence-routing-v1",
    id: probe.id,
    target,
    crop: { start: probe.start, end: probe.end },
    route,
    components,
    donors,
    targetComponentIds: selected.map((c) => c.id),
    alignmentText: selected.length === 1 ? selected[0].alignmentText : null,
    // Deliberately no automatically executable model requests or subtitle edits.
    requests: [],
    insertions: [],
    subtitleMutationAuthorized: false,
    referenceUsed: false,
    labelsUsed: false,
    sourceTimebase: "source-global-seconds",
    qualityStatus: "needs-review",
    finalizationMethod: "none",
  };
}
