import test from "node:test";
import assert from "node:assert/strict";
import {
  assessShortResponseReadiness,
  lexicalLabelGaps,
  speechTruth,
} from "../scripts/lib/short-response-readiness.mjs";

const clone = (x) => globalThis.structuredClone(x);

function fixture() {
  const positive = new Set([1, 2, 5, 6, 7, 11, 12, 14]);
  const continuation = new Set([6, 7, 14]);
  const items = Array.from({ length: 16 }, (_, i) => ({
    id: `clip-${i + 1}`,
    cohort: i % 2 ? "ranked" : "reserve",
    start: 100 + i * 10,
    end: 104 + i * 10,
    targetStart: 101 + i * 10,
    targetEnd: 102 + i * 10,
    audioHash: (i + 1).toString(16).padStart(64, "0"),
  }));
  const labels = items.map((item, i) => ({
    id: item.id,
    audioHash: item.audioHash,
    listened: true,
    sound: positive.has(i + 1) ? "speech" : "noise",
    relation: positive.has(i + 1)
      ? continuation.has(i + 1)
        ? "continuation"
        : "independent"
      : "not-applicable",
  }));
  const observations = items.map((item, i) => {
    const fraction = i === 1 ? 0.25 : positive.has(i + 1) ? 1 : 0;
    return {
      id: item.id,
      cohort: item.cohort,
      targetCoverageFraction: fraction,
      targetSupported: fraction >= 0.5,
      anyTargetOverlap: fraction > 0,
    };
  });
  const known = items[10];
  const snapshot = {
    manifest: { items },
    labels,
    observations,
    confirmedId: known.id,
    confirmation: {
      authority: "explicit-human-confirmed-utterance",
      timebase: "source-global-seconds",
      text: "ああ",
      start: known.targetStart,
      end: known.targetEnd + 0.5,
    },
  };
  const probes = [2, 6, 11, 12].map((n) => {
    const item = items[n - 1];
    return {
      id: item.id,
      start: item.start,
      end: item.end,
      targetStart: item.targetStart,
      targetEnd: item.targetEnd,
    };
  });
  const recovery = {
    probes,
    views: probes.flatMap((p) =>
      ["whisper", "kotoba"].map((backend) => ({
        targetId: p.id,
        backend,
        records: [
          {
            start: p.start + 0.1,
            end: p.start + 0.6,
            text: p.id === known.id ? "ああ。" : "ここです",
          },
        ],
      })),
    ),
  };
  const typeAnnotations = [
    {
      id: "clip-5",
      audioHash: items[4].audioHash,
      authority: "explicit-user-statement",
      quote: "这是一个人的语气词。",
      type: "interjection",
    },
  ];
  return { snapshot, recovery, typeAnnotations };
}
const assess = (f) =>
  assessShortResponseReadiness(f.snapshot, f.recovery, f.typeAnnotations);

test("missing, unknown, music, and unheard labels are unscored rather than non-speech", () => {
  for (const label of [
    undefined,
    null,
    {},
    { listened: true },
    { listened: true, sound: "unknown" },
    { listened: true, sound: "music" },
    { listened: true, sound: "pending" },
    { listened: true, sound: "uncertain" },
    { listened: false, sound: "speech" },
    { listened: false, sound: "noise" },
  ])
    assert.equal(speechTruth(label), null);
  assert.equal(speechTruth({ listened: true, sound: "speech" }), true);
  assert.equal(speechTruth({ listened: true, sound: "mixed-speech" }), true);
  assert.equal(speechTruth({ listened: true, sound: "noise" }), false);
  assert.equal(speechTruth({ listened: true, sound: "effect" }), false);
});

test("retains all sixteen fixed units with separate speech, type, text, and boundary denominators", () => {
  const f = fixture(),
    before = clone(f),
    result = assess(f);
  assert.deepEqual(
    result.rows.map((r) => r.id),
    f.snapshot.manifest.items.map((i) => i.id),
  );
  assert.equal(result.rows.length, 16);
  assert.equal(result.denominators.fixedCohort, 16);
  assert.equal(result.denominators.speechLabeled, 16);
  assert.equal(result.denominators.speechPositive, 8);
  assert.equal(result.denominators.nonSpeech, 8);
  assert.equal(result.denominators.speechTypeLabeled, 1);
  assert.equal(result.denominators.completeTextLabeled, 1);
  assert.equal(result.denominators.wholeIntervalLabeled, 1);
  assert.equal(result.denominators.speechWithoutText, 7);
  assert.equal(result.interjectionPrecision, null);
  assert.equal(result.interjectionRecall, null);
  assert.equal(result.episodeAccuracy, null);
  assert.deepEqual(f, before);
});

test("speech screening counts partial positives without calling them subtitle recovery", () => {
  const result = assess(fixture());
  assert.equal(result.screening.supported.TP, 7);
  assert.equal(result.screening.supported.FN, 1);
  assert.equal(result.screening.supported.FP, 0);
  assert.equal(result.screening.supported.TN, 8);
  assert.equal(result.screening.retainedForReview.TP, 8);
  assert.equal(result.screening.retainedForReview.FN, 0);
  assert.equal(result.validity.subtitleMutations, 0);
  assert.equal(result.validity.newInference, 0);
  assert.equal(result.validity.modelLoads, 0);
});

test("unexecuted negative controls yield unknown ASR false-positive rate, not perfect accuracy", () => {
  const result = assess(fixture());
  for (const coverage of result.modelCoverage) {
    assert.equal(coverage.executedUnits, 4);
    assert.equal(coverage.notRunUnits, 12);
    assert.equal(coverage.nonSpeechUnitsExecuted, 0);
    assert.equal(coverage.asrFalsePositiveRate, null);
  }
  const negative = result.rows.find((r) => r.id === "clip-3");
  assert(negative.backends.every((b) => b.status === "not-run"));
  assert(
    negative.backends.every(
      (b) => b.targetTextCorrect === null && b.boundaryCorrect === null,
    ),
  );
  assert.equal(
    negative.nextEvidence,
    "matched-local-asr-negative-control-not-executed",
  );
});

test("Whisper and Kotoba remain one model family despite two executed outputs", () => {
  const result = assess(fixture());
  const known = result.rows.find((r) => r.id === "clip-11");
  assert.deepEqual(
    known.backends.map((b) => b.family),
    ["whisper", "whisper"],
  );
  assert.equal(result.validity.relatedBackendsAreIndependentFamilies, false);
  assert.equal(result.validity.independentHoldout, false);
});

test("whole text elsewhere in a window does not prove correct occurrence or boundary", () => {
  const result = assess(fixture());
  const known = result.rows.find((r) => r.id === "clip-11");
  for (const backend of known.backends) {
    assert.equal(backend.exactReferenceTextSomewhereInWindow, true);
    assert.equal(backend.overlappingSegmentCount, 0);
    assert.deepEqual(backend.matchingSegmentErrors, [
      { startErrorSeconds: -0.9, endErrorSeconds: -1.9 },
    ]);
    assert.equal(backend.targetTextCorrect, null);
    assert.equal(backend.boundaryCorrect, null);
  }
});

test("continuation truth cannot transfer to a later neighboring token in the same playback", () => {
  const f = fixture();
  const p = f.recovery.probes.find((r) => r.id === "clip-6");
  for (const view of f.recovery.views.filter((v) => v.targetId === p.id))
    view.records = [{ start: p.start + 2.5, end: p.start + 3, text: "ああ" }];
  const row = assess(f).rows.find((r) => r.id === p.id);
  assert.equal(row.speechTruth, true);
  assert.equal(row.relationLabel, "continuation");
  assert.equal(row.interjectionTypeTruth, null);
  assert.equal(row.wholeReference, null);
  for (const backend of row.backends) {
    assert.equal(backend.overlappingSegmentCount, 0);
    assert.equal(backend.exactReferenceTextSomewhereInWindow, null);
    assert.equal(backend.targetTextCorrect, null);
    assert.equal(backend.boundaryCorrect, null);
  }
});

test("existing clip11 confirmation is not collected again and clip5 type is retained", () => {
  const f = fixture(),
    result = assess(f),
    before = clone(result);
  const gaps = lexicalLabelGaps(result);
  assert.equal(gaps.labels.length, 7);
  assert(!gaps.labels.some((r) => r.id === "clip-11"));
  const five = gaps.labels.find((r) => r.id === "clip-5");
  assert.equal(five.speechType, "interjection");
  assert.equal(five.targetText, null);
  assert.equal(five.wholeUtteranceInterval, null);
  assert.equal(five.status, "pending");
  const known = result.rows.find((r) => r.id === "clip-11");
  assert.equal(
    known.nextEvidence,
    "preserve-existing-confirmation-no-repeat-label-request",
  );
  assert.equal(gaps.role, "evaluation-only-never-generation-input");
  assert.deepEqual(result, before);
});

test("missing labels or observations reject cohort shrinkage rather than disappearing from denominators", () => {
  for (const field of ["labels", "observations"]) {
    const f = fixture();
    f.snapshot[field].pop();
    assert.throws(() => assess(f), /COHORT_MISMATCH/);
  }
});

test("duplicate IDs and duplicate views are rejected", () => {
  for (const mutate of [
    (f) => f.snapshot.manifest.items.push(clone(f.snapshot.manifest.items[0])),
    (f) => f.snapshot.labels.push(clone(f.snapshot.labels[0])),
    (f) => f.snapshot.observations.push(clone(f.snapshot.observations[0])),
    (f) => f.recovery.probes.push(clone(f.recovery.probes[0])),
    (f) => f.recovery.views.push(clone(f.recovery.views[0])),
    (f) => f.typeAnnotations.push(clone(f.typeAnnotations[0])),
  ]) {
    const f = fixture();
    mutate(f);
    assert.throws(() => assess(f), /DUPLICATE/);
  }
});

test("wrong label or type audio hashes cannot relabel another waveform", () => {
  for (const mutate of [
    (f) => {
      f.snapshot.labels[0].audioHash = "wrong";
    },
    (f) => {
      f.typeAnnotations[0].audioHash = "wrong";
    },
  ]) {
    const f = fixture();
    mutate(f);
    assert.throws(() => assess(f), /AUDIO_MISMATCH/);
  }
});

test("foreign views, backends, probes, and shifted target intervals fail", () => {
  for (const mutate of [
    (f) => {
      f.recovery.views[0].targetId = "foreign";
    },
    (f) => {
      f.recovery.views[0].backend = "unknown";
    },
    (f) => {
      f.recovery.probes.push({ ...f.recovery.probes[0], id: "foreign" });
    },
    (f) => {
      f.recovery.probes[0].targetStart += 0.1;
    },
    (f) => {
      f.recovery.probes[0].targetEnd -= 0.1;
    },
  ]) {
    const f = fixture();
    mutate(f);
    assert.throws(() => assess(f));
  }
});

test("unknown label semantics never increase verified non-speech controls", () => {
  for (const change of [
    { sound: "music" },
    { sound: "uncertain" },
    { sound: "pending" },
    { sound: "unknown" },
    { listened: false },
  ]) {
    const f = fixture();
    Object.assign(f.snapshot.labels[2], change);
    const result = assess(f);
    assert.equal(result.denominators.speechLabeled, 15);
    assert.equal(result.denominators.nonSpeech, 7);
    assert.equal(result.screening.supported.unscored, 1);
    assert.equal(result.screening.supported.TN, 7);
  }
});

test("interjection type needs explicit authority and a speech-positive target", () => {
  for (const mutate of [
    (n) => {
      n.authority = "machine-inference";
    },
    (n) => {
      n.quote = "";
    },
    (n) => {
      n.type = "independent";
    },
  ]) {
    const f = fixture();
    mutate(f.typeAnnotations[0]);
    assert.throws(() => assess(f));
  }
  const f = fixture();
  f.snapshot.labels[4].sound = "noise";
  assert.throws(() => assess(f), /INVALID_TYPE_LABEL/);
});

test("observation thresholds and original source confirmation cannot silently change", () => {
  for (const mutate of [
    (f) => {
      f.snapshot.observations[1].targetSupported = true;
    },
    (f) => {
      f.snapshot.observations[1].anyTargetOverlap = false;
    },
    (f) => {
      f.snapshot.confirmation.start = 0;
    },
    (f) => {
      f.snapshot.confirmation.timebase = "clip-relative";
    },
    (f) => {
      f.snapshot.confirmation.text = "";
    },
  ]) {
    const f = fixture();
    mutate(f);
    assert.throws(() => assess(f));
  }
});
