import test from "node:test";
import assert from "node:assert/strict";
import { proposeHeldSeamText } from "../scripts/lib/held-seam-text-proposal.mjs";
import { proposeSeamTextOnly } from "../scripts/lib/seam-text-only.mjs";
import { proposeContextText } from "../scripts/lib/seam-context-text.mjs";

const sourceHash = "a".repeat(64);
const previousText = "まず話を聞いてください それから質問と選択肢を聞いて";
const previousSuffix = "それから質問と選択肢を聞いて";
const secondPrefix = "質問と選択肢を聞いて";
const leftText = "1から4の中から最も良いものを 一つ";
const rightText = "一つ選んでください";
const modelBody = "1から4の中から最も良いものを1つ選んでください";
const candidateText = "1から4の中から最も良いものを 一つ選んでください";
const followingText = "では始めます";

function fixture() {
  const row = (id, text, start, end, requestId, order) => ({
    recordId: id,
    text,
    sourceStart: start,
    sourceEnd: end,
    requestId,
    order,
    chunkIndex: 4,
    issues: [],
  });
  return {
    target: {
      id: "instruction",
      recordIds: ["left", "right"],
      shared: "一つ",
      sourceStart: 10.16,
      sourceEnd: 16.5,
    },
    baseline: [
      row("previous", previousText, 2.62, 10.16, "baseline", 1),
      row("left", leftText, 10.16, 15.3, "baseline", 2),
      row("right", rightText, 14.7, 16.5, "baseline", 3),
      row("following", followingText, 16.5, 22.22, "baseline", 4),
    ],
    views: [
      {
        targetId: "instruction",
        requestId: "view-one",
        audioHash: "b".repeat(64),
        sourceAudioHash: sourceHash,
        start: 6,
        end: 21,
        records: [
          row("one-context", previousSuffix, 6, 10.14, "view-one", 1),
          row("one-body", modelBody, 10.14, 16.52, "view-one", 2),
          row("one-tail", followingText, 16.52, 21.08, "view-one", 3),
        ],
      },
      {
        targetId: "instruction",
        requestId: "view-two",
        audioHash: "c".repeat(64),
        sourceAudioHash: sourceHash,
        start: 8,
        end: 23,
        records: [
          row(
            "two-context-body",
            secondPrefix + modelBody,
            8,
            16.5,
            "view-two",
            1,
          ),
          row("two-tail", followingText, 16.5, 21.28, "view-two", 2),
        ],
      },
    ],
    options: { language: "ja", sourceAudioHash: sourceHash },
  };
}

const propose = (f) =>
  proposeHeldSeamText(f.target, f.baseline, f.views, f.options);

function rejection(name, mutate) {
  test(name, () => {
    const f = fixture();
    mutate(f);
    const original = globalThis.structuredClone(f);
    const decision = propose(f);
    assert.equal(decision.status, "ABSTAIN");
    assert.deepEqual(decision.records, []);
    assert.deepEqual(decision.replaceIds, []);
    assert.deepEqual(f, original, "rejection must preserve every raw field");
  });
}

test("one seam counter is removed only in a separately inspectable text proposal", () => {
  const f = fixture();
  const original = globalThis.structuredClone(f);
  const decision = propose(f);
  assert.equal(decision.status, "REVIEW_ONLY_TEXT_PROPOSAL");
  assert.equal(decision.records.length, 1);
  assert.deepEqual(decision.replaceIds, ["left", "right"]);
  assert.equal(decision.records[0].text, candidateText);
  assert.deepEqual(
    [decision.records[0].sourceStart, decision.records[0].sourceEnd],
    [10.16, 16.5],
  );
  assert.equal(decision.records[0].order, original.baseline[1].order);
  assert.equal(decision.records[0].chunkIndex, original.baseline[1].chunkIndex);
  assert.equal((leftText + rightText).split("一つ").length - 1, 2);
  assert.equal(candidateText.split("一つ").length - 1, 1);
  assert.equal(
    candidateText.replace("一つ", ""),
    "1から4の中から最も良いものを 選んでください",
  );
  assert.equal(decision.records[0].text.includes("1つ"), false);
  assert.deepEqual(
    f,
    original,
    "raw baseline and both model views are immutable",
  );
  const assembled = [f.baseline[0], ...decision.records, f.baseline[3]];
  assert.deepEqual(assembled[0], original.baseline[0]);
  assert.deepEqual(assembled.at(-1), original.baseline.at(-1));
});

test("invalid whole-view timing remains HOLD and is not promoted or advertised as aligned", () => {
  const decision = propose(fixture());
  assert.equal(decision.status, "REVIEW_ONLY_TEXT_PROPOSAL");
  assert.equal(decision.automaticPromotionAllowed, false);
  assert.equal(decision.inspectableOnly, true);
  assert.equal(decision.acousticTimingVerified, false);
  assert.equal(decision.humanValidated, false);
  assert.equal(decision.finalizationMethod, "none");
  assert.equal(decision.qualityStatus, "needs-review");
  assert.equal(decision.newInference, 0);
  assert.equal(decision.modelTimingIntegrity.status, "HOLD");
  assert.ok(
    decision.timingIssues.some(
      (issue) => issue.code === "END_AFTER_REQUEST_AUDIO",
    ),
  );
  assert.equal(decision.timingIssues.length, 1);
  const issue = decision.timingIssues[0];
  assert.equal(issue.recordId, "one-tail");
  assert.equal(issue.requestId, "view-one");
  assert.equal(issue.rawSourceEnd, 21.08);
  assert.equal(issue.requestSourceEnd, 21);
  assert.ok(Math.abs(issue.excessSeconds - 0.08) < 1e-7);
  assert.equal(issue.rawPreserved, true);
  assert.equal(issue.timestampCorrected, false);
  assert.equal(issue.usedInCandidate, false);
  assert.deepEqual(decision.modelTimingIntegrity.invalidViews, ["view-one"]);
  assert.equal(decision.modelTimingIntegrity.rawPreserved, true);
  assert.equal(decision.modelTimingIntegrity.timestampCorrected, false);
});

test("raw complete views and exact typed counter mappings remain available for review", () => {
  const f = fixture();
  const decision = propose(f);
  assert.deepEqual(decision.rawViews, f.views);
  assert.equal(decision.rawViews[0].records[2].sourceEnd, 21.08);
  assert.equal(decision.evidence.substringTimeInferred, false);
  assert.equal(decision.evidence.preservedPrecedingId, "previous");
  assert.equal(decision.evidence.preservedFollowingId, "following");
  assert.equal(decision.evidence.wholeDonorId, "one-body");
  assert.equal(decision.evidence.supportingParentId, "two-context-body");
  assert.equal(decision.evidence.sharedCountBefore, 2);
  assert.equal(decision.evidence.sharedCountAfter, 1);
  assert.equal(decision.evidence.mappings.length, 2);
  for (const mapping of decision.evidence.mappings) {
    assert.equal(mapping.positions.length, 1);
    assert.equal(mapping.positions[0].from, "1つ");
    assert.equal(mapping.positions[0].to, "一つ");
    assert.equal(mapping.positions[0].unit, "normalized-UTF16-not-time");
    assert.equal(mapping.originalText.includes("1から4"), true);
    assert.equal(mapping.projectedText.includes("1から4"), true);
    assert.equal(mapping.projectedText.includes("一から四"), false);
  }
});

test("whitespace outside the duplicate counter is preserved or the input is rejected", () => {
  const f = fixture();
  f.baseline[1].text += " \n";
  f.baseline[2].text = " \n" + f.baseline[2].text;
  const original = globalThis.structuredClone(f);
  const decision = propose(f);
  if (decision.status === "REVIEW_ONLY_TEXT_PROPOSAL") {
    assert.equal(
      decision.records[0].text,
      f.baseline[1].text + f.baseline[2].text.replace("一つ", ""),
      "a counter deletion cannot also trim raw baseline whitespace",
    );
  } else {
    assert.equal(decision.status, "ABSTAIN");
    assert.deepEqual(decision.records, []);
    assert.deepEqual(decision.replaceIds, []);
  }
  assert.deepEqual(f, original);
});

test("existing ordinary seam helpers continue to abstain on the full invalid view", () => {
  const f = fixture();
  for (const helper of [proposeSeamTextOnly, proposeContextText]) {
    const decision = helper(f.target, f.baseline, f.views);
    assert.equal(decision.status, "ABSTAIN");
    assert.deepEqual(decision.records, []);
    assert.deepEqual(decision.replaceIds, []);
  }
});

test("source offsets are not hardcoded to the N1 video", () => {
  const f = fixture();
  const shift = 2210;
  f.target.sourceStart += shift;
  f.target.sourceEnd += shift;
  for (const row of f.baseline) {
    row.sourceStart += shift;
    row.sourceEnd += shift;
  }
  for (const view of f.views) {
    view.start += shift;
    view.end += shift;
    for (const row of view.records) {
      row.sourceStart += shift;
      row.sourceEnd += shift;
    }
  }
  const decision = propose(f);
  assert.equal(decision.status, "REVIEW_ONLY_TEXT_PROPOSAL");
  assert.equal(decision.records[0].text, candidateText);
  assert.deepEqual(
    [decision.records[0].sourceStart, decision.records[0].sourceEnd],
    [2220.16, 2226.5],
  );
  assert.equal(decision.modelTimingIntegrity.status, "HOLD");
});

test("evidence view order does not affect the baseline-derived text or time envelope", () => {
  const f = fixture();
  f.views.reverse();
  const decision = propose(f);
  assert.equal(decision.status, "REVIEW_ONLY_TEXT_PROPOSAL");
  assert.equal(decision.records[0].text, candidateText);
  assert.deepEqual(decision.replaceIds, ["left", "right"]);
  assert.equal(decision.modelTimingIntegrity.status, "HOLD");
});

rejection("target must select exactly two records", (f) => {
  f.target.recordIds = ["left"];
});
rejection("duplicate target ids are rejected", (f) => {
  f.target.recordIds = ["left", "left"];
});
rejection("missing baseline record is rejected", (f) => {
  f.target.recordIds = ["left", "missing"];
});
rejection("target record order may not reverse the baseline", (f) => {
  f.target.recordIds.reverse();
});
rejection("selected baseline records must be adjacent", (f) => {
  f.baseline.splice(2, 0, {
    ...f.baseline[1],
    recordId: "intervening",
    text: "保護された別の発話",
    sourceStart: 15.3,
    sourceEnd: 15.4,
  });
});
rejection("duplicate baseline ids are rejected", (f) => {
  f.baseline.push({ ...f.baseline[1] });
});
rejection("preceding protected cue may not overlap the target", (f) => {
  f.baseline[0].sourceEnd = 10.5;
});
rejection("following protected cue may not overlap the target", (f) => {
  f.baseline[3].sourceStart = 16.2;
});
rejection("target envelope must match the original group start", (f) => {
  f.target.sourceStart = 10.14;
});
rejection("target envelope must match the original group end", (f) => {
  f.target.sourceEnd = 16.52;
});
rejection("baseline selected time cannot be reversed", (f) => {
  f.baseline[1].sourceEnd = f.baseline[1].sourceStart - 0.01;
});
rejection("baseline selected time cannot be nonfinite", (f) => {
  f.baseline[2].sourceStart = Number.NaN;
});
rejection("baseline selected time cannot be zero duration", (f) => {
  f.baseline[1].sourceEnd = f.baseline[1].sourceStart;
});
rejection(
  "baseline needs a literal shared seam at the end of the left cue",
  (f) => {
    f.baseline[1].text = "1から4の中から最も良いものを 一つ追加";
  },
);
rejection(
  "baseline needs a literal shared seam at the start of the right cue",
  (f) => {
    f.baseline[2].text = "追加一つ選んでください";
  },
);
rejection(
  "this typed comparison may not generalize to another shared phrase",
  (f) => {
    f.target.shared = "選んで";
  },
);
rejection("additional literal shared counters make the edit ambiguous", (f) => {
  f.baseline[1].text = "一つ " + f.baseline[1].text;
});
rejection(
  "whole donor must match the candidate after only the counter mapping",
  (f) => {
    f.views[0].records[1].text = modelBody.replace("最も", "とても");
  },
);
rejection("digit in 1から4 cannot be converted to a Japanese numeral", (f) => {
  for (const view of f.views) {
    for (const row of view.records)
      row.text = row.text.replace("1から4", "一から四");
  }
});
rejection("11つ is not a spelling equivalent of 一つ", (f) => {
  for (const view of f.views) {
    for (const row of view.records) row.text = row.text.replace("1つ", "11つ");
  }
});
rejection("alternate counter words cannot be silently normalized", (f) => {
  for (const view of f.views) {
    for (const row of view.records) row.text = row.text.replace("1つ", "1個");
  }
});
rejection("second view must contain the entire candidate as a suffix", (f) => {
  f.views[1].records[0].text += "追加語";
});
rejection("second view cannot provide only a partial candidate", (f) => {
  f.views[1].records[0].text =
    secondPrefix + modelBody.replace("選んでください", "");
});
rejection(
  "second view prefix must belong to the protected preceding cue",
  (f) => {
    f.views[1].records[0].text = "別の説明を聞いて" + modelBody;
  },
);
rejection(
  "first view context must belong to the same protected preceding cue",
  (f) => {
    f.views[0].records[0].text = "別の説明を聞いて";
  },
);
rejection(
  "context is not accepted merely because it appears somewhere in the prior cue",
  (f) => {
    f.views[1].records[0].text = "まず話を聞いてください" + modelBody;
  },
);
rejection("missing original preceding owner cannot establish context", (f) => {
  f.baseline.shift();
});
rejection(
  "missing original following owner cannot isolate the invalid tail",
  (f) => {
    f.baseline.pop();
  },
);
rejection("context carrying a duplicate complete target is ambiguous", (f) => {
  f.views[1].records[0].text = secondPrefix + modelBody + modelBody;
});
rejection("exactly two input views are required", (f) => {
  f.views.pop();
});
rejection("three views cannot sneak through a two-view rule", (f) => {
  f.views.push(globalThis.structuredClone(f.views[1]));
});
rejection("two view request identities must be distinct", (f) => {
  f.views[1].requestId = f.views[0].requestId;
  for (const row of f.views[1].records) row.requestId = f.views[0].requestId;
});
rejection("two view audio identities must be distinct", (f) => {
  f.views[1].audioHash = f.views[0].audioHash;
});
rejection("two crop envelopes must be distinct", (f) => {
  f.views[1].start = f.views[0].start;
  f.views[1].end = f.views[0].end;
});
rejection("source audio identities must match explicit options", (f) => {
  f.views[1].sourceAudioHash = "d".repeat(64);
});
rejection("source audio identity is required", (f) => {
  delete f.views[0].sourceAudioHash;
});
rejection("malformed audio hash is rejected", (f) => {
  f.views[0].audioHash = "not-a-hash";
});
rejection("target binding is required on both views", (f) => {
  f.views[1].targetId = "other-target";
});
rejection("missing request identity is rejected", (f) => {
  delete f.views[0].requestId;
});
rejection("foreign request-bound record is rejected", (f) => {
  f.views[0].records[1].requestId = "other-request";
});
rejection("missing request binding on a raw record is rejected", (f) => {
  delete f.views[1].records[0].requestId;
});
rejection(
  "duplicate raw record identities inside one view are rejected",
  (f) => {
    f.views[0].records[2].recordId = f.views[0].records[1].recordId;
  },
);
rejection(
  "raw record identities may not collide across two distinct views",
  (f) => {
    f.views[1].records[0].recordId = f.views[0].records[1].recordId;
  },
);
rejection("selected donor cannot exceed the request end", (f) => {
  f.views[0].records[1].sourceEnd = 21.01;
});
rejection("selected donor cannot start before request audio", (f) => {
  f.views[0].records[1].sourceStart = 5.99;
});
rejection("selected donor cannot reverse its own interval", (f) => {
  f.views[0].records[1].sourceEnd = 10;
});
rejection("selected donor cannot have zero duration", (f) => {
  f.views[0].records[1].sourceEnd = f.views[0].records[1].sourceStart;
});
rejection("selected donor cannot have a nonfinite edge", (f) => {
  f.views[0].records[1].sourceStart = Number.POSITIVE_INFINITY;
});
rejection("selected donor with a recorded issue is not eligible", (f) => {
  f.views[0].records[1].issues = ["UNBOUND_TIMESTAMP"];
});
rejection("whole donor must be temporally associated with the target", (f) => {
  f.views[0].records[1].sourceStart = 11;
});
rejection("context must retain chronological source order", (f) => {
  f.views[0].records[0].sourceStart = 17;
  f.views[0].records[0].sourceEnd = 18;
});
rejection(
  "invalid tail text cannot be borrowed from an unknown following cue",
  (f) => {
    f.views[0].records[2].text = "幻覚の追加発話";
  },
);
rejection("invalid tail cannot start inside the selected target", (f) => {
  f.views[0].records[2].sourceStart = 16.4;
});
rejection("invalid tail with an out-of-request start is not eligible", (f) => {
  f.views[0].records[2].sourceStart = 21.02;
});
rejection("invalid tail with a nonfinite end is not eligible", (f) => {
  f.views[0].records[2].sourceEnd = Number.NaN;
});
rejection(
  "two out-of-request tails cannot be treated as one isolated warning",
  (f) => {
    f.views[1].records[1].sourceEnd = 23.08;
  },
);
rejection("an invalid earlier context row cannot be silently excluded", (f) => {
  f.views[0].records[0].sourceStart = 5.9;
});
rejection(
  "out-of-request overshoot greater than 0.1 seconds is not eligible",
  (f) => {
    f.views[0].records[2].sourceEnd = 21.11;
  },
);
rejection("request audio duration is bounded to 15 seconds", (f) => {
  f.views[1].end = 23.01;
});
rejection("request audio interval cannot be reversed", (f) => {
  f.views[1].end = 7;
});
rejection("request audio interval cannot be nonfinite", (f) => {
  f.views[1].end = Number.POSITIVE_INFINITY;
});
rejection("explicit Japanese language is required", (f) => {
  f.options.language = "zh";
});
rejection("explicit source hash is required", (f) => {
  delete f.options.sourceAudioHash;
});
rejection("missing target is rejected instead of throwing", (f) => {
  f.target = null;
});
rejection("null baseline row is rejected instead of throwing", (f) => {
  f.baseline[1] = null;
});
rejection("null whole view is rejected instead of throwing", (f) => {
  f.views[0] = null;
});
rejection("null raw record is rejected instead of throwing", (f) => {
  f.views[0].records[1] = null;
});
rejection("missing baseline array is rejected instead of throwing", (f) => {
  f.baseline = null;
});
rejection("missing views array is rejected instead of throwing", (f) => {
  f.views = null;
});
rejection("missing raw records array is rejected instead of throwing", (f) => {
  f.views[0].records = null;
});
rejection("missing raw issues array is rejected instead of throwing", (f) => {
  delete f.views[0].records[1].issues;
});
rejection("a nonstring donor cannot enter normalization", (f) => {
  f.views[0].records[1].text = 123;
});
rejection(
  "without the diagnostic HOLD this special inspection route abstains",
  (f) => {
    f.views[0].records[2].sourceEnd = 21;
  },
);
