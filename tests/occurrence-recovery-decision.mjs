import test from "node:test";
import assert from "node:assert/strict";
import { decideOccurrenceRecovery } from "../scripts/lib/occurrence-recovery-decision.mjs";

function fixture() {
  return {
    probe: {
      id: "synthetic",
      start: 10,
      end: 18,
      targetStart: 12,
      targetEnd: 15,
    },
    baseline: [{ id: "host", start: 11, end: 13, text: "既存の発話" }],
    observation: {
      id: "synthetic",
      sourceIntervals: [{ start: 11, end: 15.5 }],
    },
    views: ["whisper", "kotoba"].map((backend) => ({
      backend,
      targetId: "synthetic",
      records: [
        { start: 11.2, end: 12.8, text: "既存の発話" },
        { start: 13.3, end: 14.4, text: "はい" },
      ],
    })),
  };
}
test("mixed context plus paired full short reply yields only a separate review candidate", () => {
  const x = fixture(),
    before = JSON.stringify(x),
    r = decideOccurrenceRecovery(x);
  assert.equal(r.originalDecision.status, "ABSTAIN");
  assert.equal(r.originalDecision.reason, "TARGET_NOT_SINGLE_LOCALIZED_CUE");
  assert.equal(r.reviewCandidates.length, 1);
  assert.equal(r.reviewCandidates[0].text, "はい");
  assert.equal(r.reviewCandidates[0].start, 13.3);
  assert.equal(r.retainedDonors, 4);
  assert.equal(r.pairDecisions[0].status, "ABSTAIN");
  assert.equal(r.pairDecisions[1].legacyGate.acousticTimingVerified, false);
  assert.deepEqual(r.insertions, []);
  assert.equal(r.subtitleMutationAuthorized, false);
  assert.equal(JSON.stringify(x), before);
});
test("one-backend extra reply is retained, never invented from the other backend", () => {
  const x = fixture();
  x.views[1].records.pop();
  const r = decideOccurrenceRecovery(x);
  assert.equal(r.reviewCandidates.length, 0);
  assert.equal(
    r.evidence.find((e) => e.id === "whisper:1").evidenceStatus,
    "unpaired-evidence-retained",
  );
  assert.equal(r.retainedDonors, 3);
});
test("merged versus split text cannot be repaired by subtracting known baseline words", () => {
  const x = fixture();
  x.views[1].records = [{ start: 11.2, end: 14.4, text: "既存の発話はい" }];
  const r = decideOccurrenceRecovery(x);
  assert.equal(r.reviewCandidates.length, 0);
  assert.equal(r.pairDecisions.length, 0);
  assert.equal(r.evidence.length, 3);
});
test("existing repeated whole sentence is blocked by unchanged legacy collision gate", () => {
  const r = decideOccurrenceRecovery(fixture());
  assert(
    r.pairDecisions[0].blockers.includes(
      "EXISTING_CUE_COLLISION_OR_CONTINUATION",
    ),
  );
  assert.equal(r.pairDecisions[0].candidate, null);
});
test("matching context outside the target cannot be moved onto the target", () => {
  const x = fixture();
  x.probe.targetStart = 13;
  const r = decideOccurrenceRecovery(x);
  assert(r.pairDecisions[0].blockers.includes("PAIR_OUTSIDE_TARGET"));
});
test("differing spellings do not manufacture consensus", () => {
  const x = fixture();
  x.views[1].records[1].text = "ええ";
  assert.equal(decideOccurrenceRecovery(x).reviewCandidates.length, 0);
});
test("crop edge and timing disagreement remain blocking", () => {
  const x = fixture();
  x.views.forEach((v) => {
    v.records[1].end = 18;
  });
  assert(
    decideOccurrenceRecovery(x).pairDecisions[1].blockers.includes("CROP_EDGE"),
  );
  const y = fixture();
  y.views[1].records[1].end = 14.9;
  assert(
    decideOccurrenceRecovery(y).pairDecisions[1].blockers.includes(
      "TIMING_CONFLICT",
    ),
  );
});
test("cross-component transcript does not become a localized short response", () => {
  const x = fixture();
  x.observation.sourceIntervals = [
    { start: 11, end: 13.6 },
    { start: 14, end: 15.5 },
  ];
  const r = decideOccurrenceRecovery(x);
  assert.equal(r.reviewCandidates.length, 0);
  assert(
    r.pairDecisions[1].blockers.includes("OCCURRENCE_ACTIVITY_NOT_LOCALIZED"),
  );
});
test("partial VAD support is not silently upgraded to acoustic verification", () => {
  const x = fixture();
  x.observation.sourceIntervals = [{ start: 13.3, end: 13.4 }];
  const r = decideOccurrenceRecovery(x);
  assert(
    r.pairDecisions[1].blockers.includes("INSUFFICIENT_DONOR_ACTIVITY_SUPPORT"),
  );
  assert.equal(r.reviewCandidates.length, 0);
});
test("many-to-one repeated-word pairing remains ambiguous", () => {
  const x = fixture();
  x.views[0].records = [
    { start: 13, end: 13.5, text: "はい" },
    { start: 13.5, end: 14, text: "はい" },
  ];
  x.views[1].records = [{ start: 13, end: 14, text: "はい" }];
  const r = decideOccurrenceRecovery(x);
  assert(
    r.pairDecisions.every((d) => d.blockers.includes("AMBIGUOUS_PAIRING")),
  );
  assert.equal(r.reviewCandidates.length, 0);
  assert.equal(r.retainedDonors, 3);
});
test("a cue covering the reply still blocks even when it contains unrelated text", () => {
  const x = fixture();
  x.baseline[0].end = 16;
  assert.equal(decideOccurrenceRecovery(x).reviewCandidates.length, 0);
});
test("two distinct supported short replies stay distinct candidates with unique ids", () => {
  const x = fixture();
  x.probe.targetEnd = 17;
  x.observation.sourceIntervals[0].end = 17;
  x.views.forEach((v) => v.records.push({ start: 15, end: 16, text: "ええ" }));
  const r = decideOccurrenceRecovery(x);
  assert.deepEqual(
    r.reviewCandidates.map((d) => d.text),
    ["はい", "ええ"],
  );
  assert.equal(new Set(r.reviewCandidates.map((d) => d.id)).size, 2);
});
test("unknown interjection type cannot generate lexical text when ASR was not run", () => {
  const x = fixture();
  x.views = [];
  const r = decideOccurrenceRecovery(x);
  assert.equal(r.notRun, true);
  assert.equal(r.reviewCandidates.length, 0);
  assert.equal(r.originalDecision.reason, "TWO_BACKENDS_REQUIRED");
});
test("invalid identities and human-label inputs fail before candidate decisions", () => {
  const x = fixture();
  assert.throws(
    () => decideOccurrenceRecovery({ ...x, labels: [] }),
    /MACHINE_EVIDENCE_FIELDS_ONLY/,
  );
  x.views[1].targetId = "different";
  assert.throws(() => decideOccurrenceRecovery(x), /INVALID_VIEWS/);
});
