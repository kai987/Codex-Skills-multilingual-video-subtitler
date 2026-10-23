/** Evaluation only: target speech, lexical truth and execution are separate. */
import assert from "node:assert/strict";

const interval = (r) =>
  Number.isFinite(r?.start) &&
  Number.isFinite(r?.end) &&
  r.start >= 0 &&
  r.end > r.start;
const overlaps = (a, b) => a.start < b.end && b.start < a.end;
const contains = (a, b) => a.start <= b.start && a.end >= b.end;
const normalized = (s) => s.normalize("NFKC").replace(/[\s\p{P}]/gu, "");
const index = (rows, key = "id") => {
  assert(Array.isArray(rows), "ARRAY_REQUIRED");
  assert(
    rows.every((r) => typeof r[key] === "string" && r[key]),
    "ID_REQUIRED",
  );
  const result = new Map(rows.map((r) => [r[key], r]));
  assert.equal(result.size, rows.length, "DUPLICATE_ID");
  return result;
};

export function speechTruth(label) {
  if (label?.listened !== true) return null;
  if (["speech", "mixed-speech"].includes(label.sound)) return true;
  if (["noise", "effect"].includes(label.sound)) return false;
  // Music can include singing. Neither music nor missing labels prove silence.
  return null;
}

function confusion(rows, predicate) {
  const counts = { TP: 0, FP: 0, TN: 0, FN: 0, unscored: 0 };
  for (const r of rows) {
    if (r.speechTruth === null) counts.unscored++;
    else
      counts[
        r.speechTruth
          ? predicate(r)
            ? "TP"
            : "FN"
          : predicate(r)
            ? "FP"
            : "TN"
      ]++;
  }
  return {
    ...counts,
    precision:
      counts.TP + counts.FP ? counts.TP / (counts.TP + counts.FP) : null,
    recall: counts.TP + counts.FN ? counts.TP / (counts.TP + counts.FN) : null,
  };
}

export function assessShortResponseReadiness(
  snapshot,
  recovery,
  typeAnnotations = [],
) {
  const items = index(snapshot.manifest.items);
  const labels = index(snapshot.labels);
  const observations = index(snapshot.observations);
  const probes = index(recovery.probes);
  const types = index(typeAnnotations);
  assert.deepEqual(
    [...labels.keys()].sort(),
    [...items.keys()].sort(),
    "LABEL_COHORT_MISMATCH",
  );
  assert.deepEqual(
    [...observations.keys()].sort(),
    [...items.keys()].sort(),
    "OBSERVATION_COHORT_MISMATCH",
  );
  const views = new Map();
  for (const view of recovery.views) {
    assert(
      items.has(view.targetId) && probes.has(view.targetId),
      "FOREIGN_VIEW",
    );
    assert(["whisper", "kotoba"].includes(view.backend), "UNKNOWN_BACKEND");
    const key = `${view.targetId}:${view.backend}`;
    assert(!views.has(key), "DUPLICATE_VIEW");
    const probe = probes.get(view.targetId);
    assert(interval(probe), "INVALID_PROBE");
    assert(
      Array.isArray(view.records) &&
        view.records.every(
          (r) =>
            interval(r) &&
            typeof r.text === "string" &&
            r.text.trim() &&
            r.start >= probe.start - 1e-7 &&
            r.end <= probe.end + 1e-7,
        ),
      "INVALID_RECORDS",
    );
    views.set(key, view);
  }
  for (const probe of probes.values()) {
    const item = items.get(probe.id);
    assert(item && interval(probe), "FOREIGN_PROBE");
    assert.equal(probe.targetStart, item.targetStart, "TARGET_CHANGED");
    assert.equal(probe.targetEnd, item.targetEnd, "TARGET_CHANGED");
    assert(
      contains(probe, { start: item.targetStart, end: item.targetEnd }),
      "PROBE_MISSES_TARGET",
    );
  }
  const known = items.get(snapshot.confirmedId);
  const confirmation = snapshot.confirmation;
  assert(
    known &&
      confirmation?.authority === "explicit-human-confirmed-utterance" &&
      confirmation.timebase === "source-global-seconds" &&
      interval(confirmation) &&
      contains(known, confirmation) &&
      overlaps(confirmation, {
        start: known.targetStart,
        end: known.targetEnd,
      }) &&
      typeof confirmation.text === "string" &&
      normalized(confirmation.text),
    "INVALID_CONFIRMATION",
  );
  assert.equal(
    speechTruth(labels.get(known.id)),
    true,
    "CONFIRMATION_NOT_SPEECH",
  );
  for (const note of types.values()) {
    assert(
      items.has(note.id) && note.audioHash === items.get(note.id).audioHash,
      "TYPE_AUDIO_MISMATCH",
    );
    assert(
      note.authority === "explicit-user-statement" &&
        typeof note.quote === "string" &&
        note.quote.trim(),
      "TYPE_AUTHORITY_REQUIRED",
    );
    assert(
      ["interjection", "other-speech"].includes(note.type) &&
        speechTruth(labels.get(note.id)) === true,
      "INVALID_TYPE_LABEL",
    );
  }
  const rows = snapshot.manifest.items.map((item) => {
    assert(/^[a-zA-Z0-9_-]+$/.test(item.id), "UNSAFE_ID");
    assert(interval(item), "INVALID_PLAYBACK");
    const target = { start: item.targetStart, end: item.targetEnd };
    assert(interval(target) && contains(item, target), "INVALID_TARGET");
    const label = labels.get(item.id),
      observation = observations.get(item.id);
    assert.equal(label.audioHash, item.audioHash, "LABEL_AUDIO_MISMATCH");
    assert.equal(observation.cohort, item.cohort, "OBSERVATION_COHORT_CHANGED");
    const fraction = observation.targetCoverageFraction;
    assert(
      Number.isFinite(fraction) && fraction >= 0 && fraction <= 1,
      "INVALID_COVERAGE",
    );
    assert.equal(
      observation.targetSupported,
      fraction >= 0.5,
      "SUPPORT_THRESHOLD_CHANGED",
    );
    assert.equal(
      observation.anyTargetOverlap,
      fraction > 0,
      "PARTIAL_THRESHOLD_CHANGED",
    );
    const truth = speechTruth(label);
    const wholeReference = item.id === known.id ? confirmation : null;
    return {
      id: item.id,
      cohort: item.cohort,
      audioHash: item.audioHash,
      target,
      playback: { start: item.start, end: item.end },
      speechTruth: truth,
      soundLabel: label.sound,
      relationLabel: label.relation,
      interjectionTypeTruth: types.get(item.id)?.type ?? null,
      typeAnnotation: types.get(item.id) ?? null,
      wholeReference,
      triage:
        fraction >= 0.5
          ? "supported"
          : fraction > 0
            ? "partial"
            : "unsupported",
      targetCoverageFraction: fraction,
      backends: ["whisper", "kotoba"].map((backend) => {
        const view = views.get(`${item.id}:${backend}`);
        if (!view)
          return {
            backend,
            status: "not-run",
            targetTextCorrect: null,
            boundaryCorrect: null,
          };
        const probe = probes.get(item.id);
        const matches = wholeReference
          ? view.records.filter(
              (r) => normalized(r.text) === normalized(wholeReference.text),
            )
          : [];
        return {
          backend,
          family: "whisper",
          status: "executed",
          request: { start: probe.start, end: probe.end },
          records: view.records,
          // Segment-envelope intersection is diagnostic, never word localization.
          overlappingSegmentCount: view.records.filter((r) =>
            overlaps(r, target),
          ).length,
          exactReferenceTextSomewhereInWindow: wholeReference
            ? matches.length > 0
            : null,
          matchingSegmentErrors: matches.map((r) => ({
            startErrorSeconds: Number(
              (r.start - wholeReference.start).toFixed(6),
            ),
            endErrorSeconds: Number((r.end - wholeReference.end).toFixed(6)),
          })),
          targetTextCorrect: null,
          boundaryCorrect: null,
        };
      }),
      nextEvidence:
        truth === true && !wholeReference
          ? "target-transcript-and-occurrence-label"
          : truth === false &&
              ![...views.keys()].some((k) => k.startsWith(`${item.id}:`))
            ? "matched-local-asr-negative-control-not-executed"
            : wholeReference
              ? "preserve-existing-confirmation-no-repeat-label-request"
              : "label-status-preserved",
    };
  });
  const modelCoverage = ["whisper", "kotoba"].map((backend) => {
    const executed = rows.filter(
      (r) =>
        r.backends.find((v) => v.backend === backend).status === "executed",
    );
    return {
      backend,
      evidenceFamily: "whisper",
      cohortUnits: rows.length,
      executedUnits: executed.length,
      notRunUnits: rows.length - executed.length,
      speechUnitsExecuted: executed.filter((r) => r.speechTruth === true)
        .length,
      nonSpeechUnitsExecuted: executed.filter((r) => r.speechTruth === false)
        .length,
      asrFalsePositiveRate: null,
      falsePositiveRateReason:
        "REQUIRES_EXECUTED_CONTROLS_AND_TARGET_LOCALIZED_OUTPUT",
    };
  });
  return {
    version: "short-response-readiness-v1",
    rows,
    modelCoverage,
    denominators: {
      fixedCohort: rows.length,
      speechLabeled: rows.filter((r) => r.speechTruth !== null).length,
      speechPositive: rows.filter((r) => r.speechTruth === true).length,
      nonSpeech: rows.filter((r) => r.speechTruth === false).length,
      speechTypeLabeled: types.size,
      completeTextLabeled: 1,
      wholeIntervalLabeled: 1,
      speechWithoutText: rows.filter(
        (r) => r.speechTruth === true && !r.wholeReference,
      ).length,
      musicControls: rows.filter((r) => r.soundLabel === "music").length,
    },
    screening: {
      supported: confusion(rows, (r) => r.triage === "supported"),
      retainedForReview: confusion(rows, (r) => r.triage !== "unsupported"),
    },
    interjectionPrecision: null,
    interjectionRecall: null,
    episodeAccuracy: null,
    validity: {
      previouslyExposedDevelopmentSet: true,
      independentHoldout: false,
      scope:
        "original-16-clip-cohort-and-bound-local-recovery-only-not-all-historical-runs",
      absenceOfDecodeProvesNonSpeech: false,
      relatedBackendsAreIndependentFamilies: false,
      newInference: 0,
      modelLoads: 0,
      subtitleMutations: 0,
      qualityStatus: "needs-review",
      finalizationMethod: "none",
    },
  };
}

export function lexicalLabelGaps(result) {
  return {
    version: "short-response-lexical-label-gaps-v1",
    role: "evaluation-only-never-generation-input",
    labels: result.rows
      .filter((r) => r.speechTruth === true && !r.wholeReference)
      .map((r) => ({
        id: r.id,
        audioHash: r.audioHash,
        target: r.target,
        playback: r.playback,
        priorSoundLabel: r.soundLabel,
        priorRelationLabel: r.relationLabel,
        status: "pending",
        reviewer: "",
        listened: false,
        speechType: r.interjectionTypeTruth,
        targetText: null,
        wholeUtteranceInterval: null,
        contextSufficient: null,
        notes: "",
      })),
  };
}
