import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  localAcousticPolicy,
  planLocalChecks,
  summarizeTimingPair,
} from "../scripts/lib/local-acoustic-policy.mjs";

const record = (id, start, end, text = "合成 テスト。") => ({
  recordId: id,
  sourceStart: start,
  sourceEnd: end,
  text,
});
const target = (id = "timing", start = 100, end = 105) => ({
  id,
  kind: "timing",
  records: [record(`${id}-record`, start, end)],
  sourceEnd: 1000,
});
function pair() {
  const requests = planLocalChecks([target()]).requests;
  return requests.map((request, n) => {
    const pieces = Array.from(request.targetText);
    const start = 101 + n * 0.1,
      end = 104 + n * 0.1;
    return {
      request,
      requestId: request.id,
      pathStatus: "success",
      frameCountVerified: true,
      workerRequestVerified: true,
      predictedFrameCount: 300,
      expectedFrameCount: 300,
      target: {
        targetText: request.targetText,
        targetTextSha256: createHash("sha256")
          .update(request.targetText)
          .digest("hex"),
        targetEncodable: true,
        unknownTokenCount: 0,
        specialTokenCount: 0,
        blockers: [],
        tokenPieces: pieces,
        tokenIds: pieces.map((_, i) => i + 10),
      },
      tokenSpans: pieces.map((_, i) => ({
        targetIndex: i,
        tokenId: i + 10,
        startFrame: 5 + i * 5,
        endFrameExclusive: 10 + i * 5,
        startMediaGlobal: i === 0 ? start : start + i * 0.1,
        endMediaGlobal: i === pieces.length - 1 ? end : start + (i + 1) * 0.1,
      })),
      selectedBoundary: { start, end },
      startPinnedToWindowEdge: false,
      endPinnedToWindowEdge: false,
      blockers: [],
    };
  });
}

test("fixed budgets and paired backend windows preserve source records", () => {
  const input = [
    target(),
    {
      id: "seam1",
      kind: "seam",
      records: [record("a", 200, 202), record("b", 201.5, 205)],
      sourceEnd: 1000,
    },
    {
      id: "seam2",
      kind: "seam",
      records: [record("c", 300, 302), record("d", 301.5, 305)],
      sourceEnd: 1000,
    },
  ];
  const before = JSON.stringify(input);
  const p = planLocalChecks(input);
  assert.equal(p.requests.length, 6);
  assert.equal(p.totalSeconds, 77);
  assert.deepEqual(
    p.requests.map((r) => [r.start, r.end]),
    [
      [99.5, 105.5],
      [99, 106],
      [195, 210],
      [194, 211],
      [295, 310],
      [294, 311],
    ],
  );
  assert.equal(p.policy.retries, 0);
  assert.equal(p.policy.maximumTotalSeconds, 120);
  assert.equal(p.policy.subtitleMutationAuthorized, false);
  assert.equal(p.referenceUsed, false);
  assert.equal(JSON.stringify(input), before);
  assert.equal(p.targets[0].records[0].text, "合成 テスト。");
  assert.equal(p.requests[0].targetText, "合成テスト");
  assert.equal("targetText" in p.requests[2], false);
});

test("only NFC punctuation and whitespace normalization, never lexical or compatibility rewrite", () => {
  const t = target();
  t.records[0].text = "か\u3099　３円、ｶﾞ!";
  assert.equal(planLocalChecks([t]).requests[0].targetText, "が３円ｶﾞ");
});

test("clamps media edges and quantizes once to integer PCM frames", () => {
  const t = target("edge", 0.2, 3.00001);
  t.sourceEnd = 3.7501;
  const p = planLocalChecks([t]);
  assert.deepEqual(
    p.requests.map((r) => r.start),
    [0, 0],
  );
  for (const r of p.requests) {
    assert.ok(r.end <= t.sourceEnd);
    assert.equal(r.frames, Math.round((r.end - r.start) * 16000));
  }
});

test("rejects excessive target and per-request audio budgets rather than widening limits", () => {
  assert.throws(
    () => planLocalChecks([target("a"), target("b"), target("c"), target("d")]),
    /TARGET_BUDGET/u,
  );
  assert.throws(
    () => planLocalChecks([target("long", 100, 130)]),
    /REQUEST_AUDIO_BUDGET/u,
  );
  const many = ["a", "b", "c"].map((id) => target(id, 100, 122));
  assert.throws(() => planLocalChecks(many), /TOTAL_AUDIO_BUDGET/u);
  assert.equal(localAcousticPolicy.maximumTotalSeconds, 120);
});

test("rejects invalid source coordinates, malformed kinds, duplicate IDs, and empty target", () => {
  for (const value of [NaN, Infinity, -1, "100"]) {
    const t = target();
    t.records[0].sourceStart = value;
    assert.throws(() => planLocalChecks([t]), /INVALID_LOCAL_RECORD/u);
  }
  for (const value of [NaN, Infinity, -1, 0, "1000"]) {
    const t = target();
    t.sourceEnd = value;
    assert.throws(() => planLocalChecks([t]), /INVALID_LOCAL_TARGET/u);
  }
  assert.throws(
    () => planLocalChecks([target(), target()]),
    /INVALID_LOCAL_TARGET/u,
  );
  assert.throws(
    () => planLocalChecks([{ ...target(), kind: "other" }]),
    /INVALID_LOCAL_TARGET/u,
  );
  assert.throws(
    () => planLocalChecks([{ ...target(), records: [record("r", 100, 100)] }]),
    /INVALID_LOCAL_RECORD/u,
  );
  assert.throws(
    () =>
      planLocalChecks([
        { ...target(), records: [record("r", 100, 105, "。 ")] },
      ]),
    /EMPTY_CTC_TARGET/u,
  );
});

test("seams require two source records and duplicate clipped windows are not dispatched", () => {
  assert.throws(
    () => planLocalChecks([{ ...target(), kind: "seam" }]),
    /INVALID_LOCAL_TARGET/u,
  );
  const t = target("tiny", 0, 0.2);
  t.sourceEnd = 0.3;
  assert.throws(() => planLocalChecks([t]), /IDENTICAL_LOCAL_WINDOWS/u);
});

test("dual complete alignments select observed narrow boundary, never mean or character timing", () => {
  const rows = pair();
  const before = JSON.stringify(rows);
  const s = summarizeTimingPair(rows.reverse());
  assert.equal(s.status, "SUPPORTED_CONDITIONAL_TIMING");
  assert.deepEqual(s.boundaryCandidate, { start: 101, end: 104 });
  assert.equal(s.selectedRequestId, "timing-narrow");
  assert.equal(s.independentLexicalVerification, false);
  assert.equal(s.subtitleMutationAuthorized, false);
  assert.equal(JSON.stringify(rows.reverse()), before);
});

test("120 ms inclusive tolerance; larger disagreement abstains without averaging", () => {
  const rows = pair();
  rows[1].selectedBoundary.start = 101.12;
  rows[1].tokenSpans[0].startMediaGlobal = 101.12;
  assert.equal(summarizeTimingPair(rows).stableWithin120ms, true);
  rows[1].selectedBoundary.start = 101.121;
  rows[1].tokenSpans[0].startMediaGlobal = 101.121;
  const s = summarizeTimingPair(rows);
  assert.equal(s.status, "ABSTAIN");
  assert.equal(s.boundaryCandidate, null);
  assert.ok(s.blockers.includes("CTC_WINDOWS_DISAGREE"));
});

test("failed, unverified, pinned, or incomplete paths never become timing candidates", () => {
  const mutations = [
    (r) => {
      r.pathStatus = "failed";
    },
    (r) => {
      r.frameCountVerified = false;
    },
    (r) => {
      r.workerRequestVerified = false;
    },
    (r) => {
      r.expectedFrameCount--;
    },
    (r) => {
      r.startPinnedToWindowEdge = true;
    },
    (r) => {
      delete r.endPinnedToWindowEdge;
    },
    (r) => {
      r.target.tokenPieces.pop();
    },
    (r) => {
      r.tokenSpans.pop();
    },
    (r) => {
      r.target.unknownTokenCount = 1;
    },
    (r) => {
      r.target.targetText += "追記";
    },
    (r) => {
      r.target.targetTextSha256 = "0".repeat(64);
    },
    (r) => {
      r.blockers.push("MODEL_BLOCKER");
    },
  ];
  for (const mutate of mutations) {
    const rows = pair();
    mutate(rows[0]);
    const s = summarizeTimingPair(rows);
    assert.equal(s.status, "ABSTAIN");
    assert.equal(s.boundaryCandidate, null);
    assert.equal(s.subtitleMutationAuthorized, false);
  }
});

test("mismatched request binding, same view twice, and missing results abstain", () => {
  for (const rows of [[], [pair()[0]], [pair()[0], pair()[0]], null]) {
    assert.equal(summarizeTimingPair(rows).status, "ABSTAIN");
  }
  const rows = pair();
  rows[0].requestId = "other";
  assert.ok(
    summarizeTimingPair(rows).blockers.includes("CTC_REQUEST_BINDING_INVALID"),
  );
});

test("rejects invalid boundaries and damaged complete-token accounting", () => {
  const mutations = [
    (r) => {
      r.selectedBoundary.start = NaN;
    },
    (r) => {
      r.selectedBoundary.end = Infinity;
    },
    (r) => {
      r.selectedBoundary.end = r.selectedBoundary.start;
    },
    (r) => {
      r.selectedBoundary.start = r.request.start - 0.1;
    },
    (r) => {
      r.tokenSpans[0].startMediaGlobal += 0.1;
    },
    (r) => {
      r.tokenSpans[0].tokenId = 999;
    },
    (r) => {
      r.tokenSpans[0].endFrameExclusive = r.tokenSpans[0].startFrame;
    },
    (r) => {
      r.tokenSpans[1].startFrame = 0;
    },
  ];
  for (const mutate of mutations) {
    const rows = pair();
    mutate(rows[0]);
    assert.equal(summarizeTimingPair(rows).status, "ABSTAIN");
  }
});
