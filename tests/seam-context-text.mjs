import test from "node:test";
import assert from "node:assert/strict";
import { proposeContextText } from "../scripts/lib/seam-context-text.mjs";
import { assembleContextRun } from "../scripts/replay-seam-context-text.mjs";
import { assembleContextEvidence } from "../scripts/lib/seam-context-delivery.mjs";
import { serializeRecords } from "../packages/video-subtitler/dist/standalone/bounded.js";
const phrase = "今日は駅まで歩きますそして帰ります";
function fixture() {
  const row = (id, text, start, end, requestId = "base") => ({
    recordId: id,
    text,
    sourceStart: start,
    sourceEnd: end,
    requestId,
    issues: [],
    chunkIndex: 0,
  });
  const baseline = [
    row("prev", "それでは皆さん行きましょう", 5, 10),
    row("a", "今日は駅まで歩きます", 10, 13),
    row("b", "駅まで歩きますそして帰ります", 12, 15),
    row("next", "次の話", 15, 17),
  ];
  const views = [
    {
      requestId: "r1",
      audioHash: "1",
      start: 8,
      end: 16,
      records: [row("merged", "皆さん行きましょう、" + phrase, 8, 15.5, "r1")],
    },
    {
      requestId: "r2",
      audioHash: "2",
      start: 7,
      end: 17,
      records: [
        row("prev-view", "皆さん行きましょう", 7, 10, "r2"),
        row("whole", phrase, 10, 15, "r2"),
      ],
    },
  ];
  return {
    target: {
      id: "t",
      recordIds: ["a", "b"],
      sourceStart: 10,
      sourceEnd: 15,
      shared: "駅まで歩きます",
    },
    baseline,
    views,
  };
}
const propose = (f) => proposeContextText(f.target, f.baseline, f.views);
test("whole donor text is selected with explicit context provenance and old outer times", () => {
  const f = fixture(),
    original = globalThis.structuredClone(f),
    d = propose(f);
  assert.equal(d.status, "CANDIDATE");
  assert.equal(d.records[0].text, phrase);
  assert.deepEqual(
    [d.records[0].sourceStart, d.records[0].sourceEnd],
    [10, 15],
  );
  assert.equal(d.evidence.preservedNeighborId, "prev");
  assert.equal(d.evidence.substringTimeInferred, false);
  assert.equal(d.evidence.contextPrefixTextVerified, false);
  assert.deepEqual(d.replaceIds, ["a", "b"]);
  assert.deepEqual(f, original);
});
test("view order does not choose a different answer", () => {
  const f = fixture();
  f.views.reverse();
  assert.equal(propose(f).records[0].text, phrase);
});
test("prefix spelling conflict in target is not repaired by fuzzy matching", () => {
  const f = fixture();
  f.views[0].records[0].text = "皆さん、" + phrase.replace("今日", "明日");
  assert.equal(propose(f).status, "ABSTAIN");
});
test("same target text repeated in one donor is not collapsed", () => {
  const f = fixture();
  f.views[0].records[0].text += "、" + phrase;
  assert.equal(propose(f).status, "ABSTAIN");
});
test("missing punctuation boundary prevents arbitrary substring extraction", () => {
  const f = fixture();
  f.views[0].records[0].text = "皆さん行きましょう" + phrase;
  assert.equal(propose(f).status, "ABSTAIN");
});
test("cannot trim trailing words after the target", () => {
  const f = fixture();
  f.views[0].records[0].text += "次の話";
  assert.equal(propose(f).status, "ABSTAIN");
});
test("unowned or inconsistent preceding cue prevents context attribution", () => {
  for (const change of [
    (f) => f.baseline.shift(),
    (f) => f.views[1].records.shift(),
    (f) => {
      f.views[1].records[0].text = "関係ない言葉";
    },
  ]) {
    const f = fixture();
    change(f);
    assert.equal(propose(f).status, "ABSTAIN");
  }
});
test("text at another occurrence or outside target cannot support a candidate", () => {
  const f = fixture();
  f.views[0].records[0].sourceStart = 15.1;
  f.views[0].records[0].sourceEnd = 16;
  assert.equal(propose(f).status, "ABSTAIN");
});
test("new candidate cannot swallow a non-target neighbor", () => {
  const f = fixture();
  f.baseline.push({
    ...f.baseline[0],
    recordId: "protected",
    sourceStart: 14,
    sourceEnd: 14.5,
  });
  assert.equal(propose(f).reason, "TARGET_ENVELOPE_INTERSECTS_PROTECTED_CUE");
});
test("same evidence and invalid timing cannot gain authority via fallback", () => {
  for (const change of [
    (f) => {
      f.views[0].audioHash = "2";
    },
    (f) => {
      f.views[0].records[0].sourceEnd = 8;
    },
  ]) {
    const f = fixture();
    change(f);
    assert.equal(propose(f).status, "ABSTAIN");
  }
});

test("assembly changes only owned target records, preserving neighbor text and time", () => {
  const f = fixture();
  const current = serializeRecords(f.baseline, "ja").cues;
  const r = assembleContextRun({
    seam: {
      baseline: f.baseline,
      targets: [f.target],
      views: f.views.map((v) => ({ ...v, targetId: "t" })),
    },
    local: { baseline: current, duration: 20 },
  });
  assert.equal(r.changedTargets, 1);
  assert.equal(r.protectedRecords, 2);
  assert.equal(r.candidate.length, 3);
  assert.deepEqual(r.candidate[0], f.baseline[0]);
  assert.deepEqual(r.candidate.at(-1), f.baseline.at(-1));
});
test("another donor occurrence cannot masquerade as unique support", () => {
  const f = fixture();
  f.views[0].start = 0;
  f.views[0].records.unshift({
    ...f.views[0].records[0],
    recordId: "earlier",
    sourceStart: 0,
    sourceEnd: 4,
  });
  assert.equal(propose(f).reason, "NON_UNIQUE_CONTEXT_OCCURRENCE");
});

test("production adapter matches frozen experiment without its batch/local-recovery dependency", () => {
  const f = fixture();
  const seam = {
    baseline: f.baseline,
    targets: [f.target],
    views: f.views.map((v) => ({ ...v, targetId: "t" })),
  };
  const r = assembleContextEvidence(seam);
  const prior = assembleContextRun({
    seam,
    local: { baseline: serializeRecords(f.baseline, "ja").cues, duration: 20 },
  });
  assert.deepEqual(r.candidate, prior.candidate);
  assert.deepEqual(r.decisions, prior.decisions);
  assert.equal(r.additionalChangedTargets, 1);
  assert.equal(r.protectedRecords, 2);
  assert.equal(r.automaticPromotionAllowed, false);
});

test("production assembly preserves every record for true repetition, text conflict and wrong occurrence", () => {
  for (const change of [
    (f) => {
      f.views[0].records[0].text += "、" + phrase;
    },
    (f) => {
      f.views[0].records[0].text = "皆さん、" + phrase.replace("今日", "明日");
    },
    (f) => {
      f.views[0].records[0].sourceStart = 15.1;
      f.views[0].records[0].sourceEnd = 16;
    },
  ]) {
    const f = fixture();
    change(f);
    const r = assembleContextEvidence({
      baseline: f.baseline,
      targets: [f.target],
      views: f.views.map((v) => ({ ...v, targetId: "t" })),
    });
    assert.equal(r.additionalChangedTargets, 0);
    assert.deepEqual(r.candidate, r.baseline);
  }
});
