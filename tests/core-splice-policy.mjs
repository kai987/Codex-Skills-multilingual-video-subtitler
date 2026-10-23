import { test } from "node:test";
import assert from "node:assert/strict";
import {
  proposeCoreSplice,
  coreSplicePolicy,
} from "../scripts/lib/core-splice-policy.mjs";

const prefix = "あいうえおかきく",
  suffix = "けこさしすせそた";
const corrected = prefix + "正しい" + suffix;
const clone = (v) => globalThis.structuredClone(v);
const mapped = (
  recordId,
  sourceStart,
  sourceEnd,
  text,
  requestId = "baseline",
  offset = 0,
) => ({
  recordId,
  requestId,
  sourceStart,
  sourceEnd,
  text,
  localStart: sourceStart - offset,
  localEnd: sourceEnd - offset,
  audioGlobalStart: sourceStart - offset,
  audioGlobalEnd: sourceEnd - offset,
  parseStatus: "PARSED",
  issues: [],
});
const view = (id, start, end, hash, rows) => ({
  request: {
    id,
    targetId: "synthetic",
    start,
    end,
    wavHash: hash.repeat(64),
    backend: "whisper",
  },
  records: rows.map(([a, b, text], i) =>
    mapped(`${id}-${i}`, a, b, text, id, start),
  ),
  exportBlocked: false,
  invalidRecordIds: [],
});
function fixture() {
  return {
    targetId: "synthetic",
    records: [
      mapped("before", 8, 10, "前の文言は変更しない"),
      mapped("left", 10, 12, prefix + "誤字重複"),
      mapped("right", 11.5, 13, "誤字重複" + suffix),
      mapped("after", 13, 15, "次の文言も変更しない"),
    ],
    targetRecordIds: ["left", "right"],
    views: [
      // This cue starts at the crop edge, but only its interior text supports
      // the candidate. The long cue may never become a donor substring.
      view("narrow", 8, 15, "a", [
        [8, 13.1, "窓端の前文" + corrected],
        [13.1, 15, "窓端の後文"],
      ]),
      view("wide", 7, 16, "b", [
        [8, 10, "別の前文"],
        [10, 11.4, prefix + "正しい"],
        [11.4, 13.1, suffix],
        [13.1, 16, "別の後文"],
      ]),
    ],
  };
}

test("whole donor cues form a separate suggestion and retain the old outer envelope", () => {
  const input = fixture(),
    before = JSON.stringify(input);
  const result = proposeCoreSplice(input);
  assert.equal(result.status, "PROPOSED");
  assert.equal(result.proposal.text, corrected);
  assert.deepEqual(result.proposal.sourceRecordIds, ["left", "right"]);
  assert.deepEqual(result.proposal.donorRecordIds, ["wide-1", "wide-2"]);
  assert.deepEqual(result.proposal.donorEnvelope, { start: 10, end: 13.1 });
  assert.equal(result.proposal.sourceStart, 10);
  assert.equal(result.proposal.sourceEnd, 13);
  assert.equal(
    result.proposal.timingPolicy,
    "old-union-envelope-not-realigned",
  );
  assert.deepEqual(result.proposal.resegmentation, {
    oldCueCount: 2,
    newCueCount: 1,
    outerBoundaryChanges: 0,
    removedInternalBoundaryCount: 2,
  });
  assert.equal(result.proposal.timingRealigned, false);
  assert.equal(result.proposal.acousticTimingVerified, false);
  assert.equal(result.subtitleMutationAuthorized, false);
  assert.equal(result.automaticApplication, false);
  assert.equal(result.qualityStatus, "needs-review");
  assert.equal(result.finalizationMethod, "none");
  assert.equal(result.referenceUsed, false);
  assert.equal(JSON.stringify(input), before);
});

test("interior support in an edge cue is text-only, with no substring timing authority", () => {
  const result = proposeCoreSplice(fixture());
  const support = result.proposal.supports[0];
  assert.equal(support.requestId, "narrow");
  assert.deepEqual(support.recordIds, ["narrow-0"]);
  assert.ok(support.normalizedCodepointSpan.start > 0);
  assert.equal(support.independentModelEvidence, false);
  assert.equal(support.acousticTimingAuthority, false);
  assert.equal("sourceStart" in support, false);
  assert.equal("sourceEnd" in support, false);
});

test("never derives a donor by slicing a larger cue, even with exact support", () => {
  const input = fixture();
  input.views[1] = view("wide", 7, 16, "b", [[8, 13.1, "前文" + corrected]]);
  assert.equal(proposeCoreSplice(input).status, "ABSTAIN");
});

test("complete donor extending outside the core cannot absorb an earlier occurrence", () => {
  const input = fixture();
  input.views[1].records[1] = mapped(
    "wide-1",
    9.6,
    11.4,
    prefix + "正しい",
    "wide",
    7,
  );
  input.views[1].records[0] = mapped("wide-0", 8, 9.6, "前文", "wide", 7);
  const result = proposeCoreSplice(input);
  assert.equal(result.status, "ABSTAIN");
  assert.ok(
    result.rejectedConditions.includes("DONOR_NOT_COMPLETE_CORE_ENVELOPE"),
  );
});

test("donor must cover each original cue's exclusive edge, not just the overlap", () => {
  const input = fixture();
  input.views[1] = view("wide", 7, 16, "b", [[11.5, 12, corrected]]);
  assert.equal(proposeCoreSplice(input).status, "ABSTAIN");
});

test("no baseline adjacency, temporal overlap, or exclusive edges means abstention", () => {
  for (const mutate of [
    (x) => {
      x.targetRecordIds = ["left", "after"];
    },
    (x) => {
      x.targetRecordIds.reverse();
    },
    (x) => {
      x.records[2] = mapped("right", 12, 13, "誤字重複" + suffix);
    },
    (x) => {
      x.records[2] = mapped("right", 11.5, 12, "誤字重複" + suffix);
    },
  ]) {
    const input = fixture();
    mutate(input);
    assert.equal(proposeCoreSplice(input).status, "ABSTAIN");
  }
});

test("a preserved neighboring cue overlapping the union blocks a splice", () => {
  const input = fixture();
  input.records[0] = mapped("before", 8, 10.1, "前文");
  assert.ok(
    proposeCoreSplice(input).reasons.includes(
      "TARGET_UNION_OVERLAPS_PRESERVED_NEIGHBOR",
    ),
  );
});

test("short utterances and changed outside anchors are never accepted", () => {
  const short = fixture();
  short.records[1].text = "はい";
  assert.ok(
    proposeCoreSplice(short).reasons.includes("SHORT_DIALOGUE_ANCHORS_UNSAFE"),
  );
  for (const field of [1, 2]) {
    const input = fixture();
    input.views[1].records[field].text =
      "改変" + input.views[1].records[field].text + "改変";
    assert.equal(proposeCoreSplice(input).status, "ABSTAIN");
  }
});

test("distinct request IDs and distinct audio hashes are both required", () => {
  const input = fixture();
  input.views[1].request.wavHash = input.views[0].request.wavHash;
  assert.ok(
    proposeCoreSplice(input).reasons.includes(
      "DISTINCT_REQUESTS_AND_AUDIO_REQUIRED",
    ),
  );
  const same = fixture();
  same.views[1].request.id = same.views[0].request.id;
  for (const r of same.views[1].records) r.requestId = same.views[0].request.id;
  assert.ok(
    proposeCoreSplice(same).reasons.includes(
      "DISTINCT_REQUESTS_AND_AUDIO_REQUIRED",
    ),
  );
});

test("unique support means exactly one literal occurrence, not repeated substring evidence", () => {
  const input = fixture();
  input.views[0].records[0].text = "前文" + corrected + corrected;
  assert.ok(
    proposeCoreSplice(input).reasons.includes("NON_UNIQUE_SUPPORT_TEXT"),
  );
});

test("candidate support may span complete adjacent cues without taking donor timing", () => {
  const input = fixture();
  input.views[0] = view("narrow", 8, 15, "a", [
    [8, 11.4, "前文" + prefix + "正しい"],
    [11.4, 13.1, suffix],
    [13.1, 15, "後文"],
  ]);
  const result = proposeCoreSplice(input);
  assert.equal(result.status, "PROPOSED");
  assert.deepEqual(result.proposal.supports[0].recordIds, [
    "narrow-0",
    "narrow-1",
  ]);
});

test("support cannot concatenate matching text across an unrepresented audio gap", () => {
  const input = fixture();
  input.views[0] = view("narrow", 8, 15, "a", [
    [8, 11, "前文" + prefix + "正しい"],
    [11.5, 13.1, suffix],
  ]);
  assert.ok(
    proposeCoreSplice(input).reasons.includes("SUPPORT_TEXT_SPANS_AUDIO_GAP"),
  );
});

test("whitespace differences alone are normalized, never punctuation or spelling", () => {
  const input = fixture();
  input.views[0].records[0].text = "前文" + prefix + " \n正しい　" + suffix;
  assert.equal(proposeCoreSplice(input).status, "PROPOSED");
  input.views[0].records[0].text = "前文" + prefix + "、正しい" + suffix;
  assert.equal(proposeCoreSplice(input).status, "ABSTAIN");
  input.views[0].records[0].text = "前文" + prefix + "正しく" + suffix;
  assert.equal(proposeCoreSplice(input).status, "ABSTAIN");
});

test("Unicode compatibility and canonical composition differences are not silently changed", () => {
  for (const [donor, support] of [
    ["が", "か\u3099"],
    ["３", "3"],
  ]) {
    const input = fixture();
    input.views[1].records[1].text = prefix + donor;
    input.views[0].records[0].text = "前文" + prefix + support + suffix;
    assert.equal(proposeCoreSplice(input).status, "ABSTAIN");
  }
});

test("multiple full-core texts are ambiguous even if one appears in another candidate", () => {
  const input = fixture();
  input.views[0] = view("narrow", 8, 15, "a", [
    [10, 11.4, prefix + "別案"],
    [11.4, 13.1, suffix],
  ]);
  assert.ok(
    proposeCoreSplice(input).reasons.includes("AMBIGUOUS_COMPLETE_CORE_TEXT"),
  );
});

test("equivalent complete donors select deterministic provenance without averaging times", () => {
  const input = fixture();
  input.views[0] = view("narrow", 8, 15, "a", [
    [10.1, 11.5, prefix + "正しい"],
    [11.5, 13.2, suffix],
  ]);
  const a = proposeCoreSplice(input),
    b = proposeCoreSplice({ ...input, views: [...input.views].reverse() });
  assert.equal(a.status, "PROPOSED");
  assert.deepEqual(a.proposal, b.proposal);
  assert.equal(a.proposal.donorRequestId, "narrow");
  assert.equal(a.proposal.sourceStart, 10);
  assert.equal(a.proposal.sourceEnd, 13);
});

test("support touching a crop edge at the actual matching text abstains", () => {
  const input = fixture();
  input.views[0].records[0].text = corrected;
  assert.ok(
    proposeCoreSplice(input).reasons.includes(
      "SUPPORT_MATCH_TOUCHES_WINDOW_EDGE",
    ),
  );
  const right = fixture();
  right.views[0] = view("narrow", 8, 15, "a", [[9, 15, "前文" + corrected]]);
  assert.ok(
    proposeCoreSplice(right).reasons.includes(
      "SUPPORT_MATCH_TOUCHES_WINDOW_EDGE",
    ),
  );
});

test("explicit pinned edges are not erased by an interior text match", () => {
  for (const key of ["startPinnedToWindowEdge", "endPinnedToWindowEdge"]) {
    const input = fixture();
    input.views[0].records[0][key] = true;
    assert.equal(proposeCoreSplice(input).status, "ABSTAIN");
  }
});

test("no-op text does not generate an unnecessary cue merge", () => {
  const input = fixture();
  input.records[1].text = prefix + "正しい";
  input.records[2].text = suffix;
  assert.equal(proposeCoreSplice(input).status, "ABSTAIN");
});

test("incomplete, invalid, and incorrectly bound mapped evidence fails closed", () => {
  const mutations = [
    (x) => {
      delete x.views[1].records[1].parseStatus;
    },
    (x) => {
      x.views[1].records[1].issues = ["INVALID_TIMING"];
    },
    (x) => {
      x.views[1].records[1].sourceEnd = NaN;
    },
    (x) => {
      x.views[1].records[1].sourceStart += 0.1;
    },
    (x) => {
      x.views[1].records[1].requestId = "unbound";
    },
    (x) => {
      x.views[1].records[1].recordId = x.views[1].records[0].recordId;
    },
    (x) => {
      x.views[1].request.targetId = "different-target";
    },
    (x) => {
      x.views[1].request.backend = "ctc";
    },
    (x) => {
      x.views[1].exportBlocked = true;
    },
    (x) => {
      x.views[1].invalidRecordIds = ["other"];
    },
    (x) => {
      x.views[1].records.reverse();
    },
    (x) => {
      x.records[0].sourceStart = Infinity;
    },
    (x) => {
      x.views.pop();
    },
    (x) => {
      x.views.push(clone(x.views[0]));
    },
  ];
  for (const mutate of mutations) {
    const input = fixture();
    mutate(input);
    assert.equal(proposeCoreSplice(input).status, "ABSTAIN");
  }
});

test("malformed requests abstain rather than mutate, throw, or renew model budgets", () => {
  for (const input of [
    undefined,
    null,
    {},
    { records: null },
    { targetId: "bad/path" },
    { targetId: "a", records: [null] },
  ]) {
    assert.equal(proposeCoreSplice(input).status, "ABSTAIN");
  }
  assert.equal(coreSplicePolicy.envelopeToleranceSeconds, 0.3);
  assert.equal(coreSplicePolicy.minimumAnchorCodepoints, 8);
  assert.equal(coreSplicePolicy.subtitleMutationAuthorized, false);
});
