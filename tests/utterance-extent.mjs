import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { intervalDifference } from "../scripts/evaluate-utterance-extent.mjs";
const { structuredClone } = globalThis;
test("post-freeze timing geometry distinguishes late start from truncated tail", () => {
  const r = intervalDifference({ start: 1.2, end: 1.8 }, { start: 1, end: 2 });
  assert.ok(Math.abs(r.startDelta - 0.2) < 1e-8);
  assert.ok(Math.abs(r.endDelta + 0.2) < 1e-8);
  assert.ok(Math.abs(r.referenceDurationCoverage - 0.6) < 1e-8);
  assert.equal(intervalDifference(null, { start: 1, end: 2 }), null);
});
import { planExtent, analyzeExtent } from "../scripts/lib/utterance-extent.mjs";
import {
  reserveExtent,
  runExtent,
} from "../scripts/subtitle-tool-utterance-extent.mjs";
const baseline = [{ id: "previous", start: 0, end: 1, text: "前の発話" }];
const prior = {
  association: {
    requests: [
      {
        id: "clip-1-narrow",
        targetId: "clip-1",
        targetText: "ああ",
        start: 2,
        end: 4.7,
      },
      {
        id: "clip-1-wide",
        targetId: "clip-1",
        targetText: "ああ",
        start: 1,
        end: 5.7,
      },
    ],
  },
  timing: {
    pair: { stableWithin120ms: true },
    emissionIntervals: [
      { interval: { start: 3.2, end: 3.225 } },
      { interval: { start: 3.21, end: 3.235 } },
    ],
    vadIntervals: [{ start: 3, end: 4.2 }],
  },
};
const raws = (plan) =>
  plan.windows.map((w) => ({
    words: [{ start: 3 - w.start, end: 4.2 - w.start, label: "ああ" }],
    phones: [{ start: 3 - w.start, end: 4.2 - w.start, label: "aː" }],
    fileInterval: { start: 0, end: w.frames / 16000, label: "file" },
  }));
test("nested windows derive from frozen narrow request, exclude old wide neighbor", () => {
  const p = planExtent(prior, baseline);
  assert.deepEqual(
    p.windows.map((w) => [w.start, w.end]),
    [
      [2, 4.7],
      [1.5, 5.2],
    ],
  );
  assert.equal(
    p.windows.reduce((s, w) => s + w.frames / 16000, 0),
    6.4,
  );
  assert.equal(p.referenceUsed, false);
});
test("missing stable CTC or conflicting supplied text blocks planning", () => {
  const a = structuredClone(prior);
  a.timing.pair.stableWithin120ms = false;
  assert.throws(() => planExtent(a, baseline), /UNSTABLE_CTC/);
  const b = structuredClone(prior);
  b.association.requests[1].targetText = "はい";
  assert.throws(() => planExtent(b, baseline), /TEXT_CONFLICT/);
});
test("an omitted existing neighbor blocks inference, never trimmed to fit", () => {
  assert.throws(
    () =>
      planExtent(prior, [
        ...baseline,
        { id: "intrusion", start: 1.6, end: 1.8, text: "隣" },
      ]),
    /NEIGHBOR_TEXT_OMITTED/,
  );
});
test("oversized windows fail budget before dispatch", () => {
  const p = structuredClone(prior);
  p.association.requests[0].end = 8;
  p.association.requests[1].end = 9;
  assert.throws(() => planExtent(p, baseline), /AUDIO_BUDGET/);
});
test("MFA words provide extent; file interval and CTC peak do not", () => {
  const p = planExtent(prior, baseline),
    r = analyzeExtent(p, raws(p), prior, baseline);
  assert.deepEqual(r.wordInterval, { start: 3, end: 4.2, text: "ああ" });
  assert.equal(r.pair.status, "STABLE_CONDITIONAL_WORD_INTERVALS");
  assert.equal(r.sideAgreement.startSupported, true);
  assert.equal(r.sideAgreement.endSupported, true);
  assert.equal(r.subtitleMutationAuthorized, false);
  assert.ok(r.blockers.includes("UNVALIDATED_UTTERANCE_EXTENT_POLICY"));
});
test("start/end support assessed independently", () => {
  const p = planExtent(prior, baseline),
    a = structuredClone(prior);
  a.timing.vadIntervals = [{ start: 3, end: 4.5 }];
  const r = analyzeExtent(p, raws(p), a, baseline);
  assert.equal(r.sideAgreement.startSupported, true);
  assert.equal(r.sideAgreement.endSupported, false);
  assert.ok(r.blockers.includes("END_ACTIVITY_DISAGREEMENT"));
});
test("window instability cannot become a listening proposal", () => {
  const p = planExtent(prior, baseline),
    a = raws(p);
  a[1].words[0].end += 0.2;
  a[1].phones[0].end += 0.2;
  const r = analyzeExtent(p, a, prior, baseline);
  assert.equal(r.listeningProposal, null);
  assert.ok(r.blockers.includes("WORD_BOUNDARY_WINDOW_UNSTABLE"));
});
test("wrong occurrence cannot pass despite stable MFA", () => {
  const p = planExtent(prior, baseline),
    a = structuredClone(prior);
  a.timing.emissionIntervals[0].interval = { start: 2.8, end: 2.825 };
  const r = analyzeExtent(p, raws(p), a, baseline);
  assert.equal(r.listeningProposal, null);
  assert.ok(r.blockers.includes("CTC_ANCHOR_OUTSIDE_WORD"));
});
test("phone-less, unknown, pinned or empty tiers never acquire timing authority", () => {
  const p = planExtent(prior, baseline);
  for (const change of [
    (a) => (a.phones = []),
    (a) => (a.phones[0].label = "spn"),
    (a) => (a.words[0].start = 0),
    (a) => (a.words = []),
  ]) {
    const a = raws(p);
    change(a[0]);
    const r = analyzeExtent(p, a, prior, baseline);
    assert.equal(r.listeningProposal, null);
    assert.equal(r.subtitleMutationAuthorized, false);
  }
});
test("multiple activity islands are not merged into a lexical extent", () => {
  const p = planExtent(prior, baseline),
    a = structuredClone(prior);
  a.timing.vadIntervals = [
    { start: 3, end: 3.4 },
    { start: 3.8, end: 4.2 },
  ];
  assert.equal(analyzeExtent(p, raws(p), a, baseline).sideAgreement, null);
});
test("authorization is checked before reading inputs", async () => {
  await assert.rejects(
    runExtent("/nonexistent", false),
    /AUTHORIZATION|EXPLICIT/,
  );
});
test("exclusive reservation forbids a second attempt", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "extent-test-"));
  try {
    await fs.writeFile(path.join(root, "plan.json"), "{}");
    await reserveExtent(root, true);
    await assert.rejects(reserveExtent(root, true), /EEXIST/);
    assert.equal(
      JSON.parse(
        await fs.readFile(path.join(root, "execution-reservation.json")),
      ).asrRequests,
      0,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
