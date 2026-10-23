import test from "node:test";
import assert from "node:assert/strict";
import {
  anchoredContinuationPolicy,
  proposeAnchoredContinuation,
} from "../scripts/lib/anchored-continuation-text.mjs";
import { proposeContextText } from "../scripts/lib/seam-context-text.mjs";

const sourceHash = "a".repeat(64);
const opener = "運動指導について学びます";
const bodyStart = "最近では健康維持のために運動をする高齢";
const conclusion = "高齢者専門のトレーナーの需要が増えています";
const body = `${bodyStart}者も多く、${conclusion}`;
const normalize = (text) =>
  text.normalize("NFKC").replace(/[\p{P}\p{Z}\s]/gu, "");
const phraseCount = (text, phrase) =>
  normalize(text).split(normalize(phrase)).length - 1;

function fixture() {
  const row = (id, text, start, end, requestId = "baseline") => ({
    recordId: id,
    text,
    sourceStart: start,
    sourceEnd: end,
    requestId,
    order: 1,
    chunkIndex: 4,
    issues: [],
  });
  return {
    target: {
      id: "senior",
      recordIds: ["left", "right"],
      sourceStart: 10,
      sourceEnd: 20,
      shared: "高齢",
    },
    baseline: [
      row("previous", "前の説明は保持します", 3, 10),
      row("left", opener + bodyStart, 10, 16),
      row("right", conclusion, 15, 20),
      row("next", "次の説明も保持します", 20, 24),
    ],
    views: [
      {
        targetId: "senior",
        requestId: "view-one",
        audioHash: "b".repeat(64),
        sourceAudioHash: sourceHash,
        start: 7,
        end: 22,
        records: [
          row(
            "one-opener",
            "まず四では高齢者を対象とする" + opener,
            7,
            12,
            "view-one",
          ),
          row("one-body", body, 12, 20, "view-one"),
        ],
      },
      {
        targetId: "senior",
        requestId: "view-two",
        audioHash: "c".repeat(64),
        sourceAudioHash: sourceHash,
        start: 8,
        end: 23,
        records: [
          row("two-opener", "高齢者を対象とする" + opener, 8, 12, "view-two"),
          row("two-body", bodyStart + "者も多く", 12, 17, "view-two"),
          row("two-conclusion", conclusion, 17, 20, "view-two"),
        ],
      },
    ],
    options: { language: "ja", sourceAudioHash: sourceHash },
  };
}

const propose = (f) =>
  proposeAnchoredContinuation(f.target, f.baseline, f.views, f.options);
function rejectCase(name, change, reason) {
  test(name, () => {
    const f = fixture();
    change(f);
    const unchanged = globalThis.structuredClone(f);
    const decision = propose(f);
    assert.equal(decision.status, "ABSTAIN");
    if (reason) assert.equal(decision.reason, reason);
    assert.deepEqual(decision.records, []);
    assert.deepEqual(decision.replaceIds, []);
    assert.deepEqual(
      f,
      unchanged,
      "failed proposals must not edit supplied evidence",
    );
  });
}

test("frozen opener plus two complete continuations inserts only 者も多く", () => {
  const f = fixture();
  const original = globalThis.structuredClone(f);
  const decision = propose(f);
  assert.equal(decision.status, "CANDIDATE");
  assert.equal(
    decision.reason,
    "FROZEN_OPENER_AND_COMPLETE_CONTINUATION_AGREE",
  );
  assert.equal(decision.records.length, 1);
  assert.deepEqual(decision.replaceIds, ["left", "right"]);
  assert.equal(decision.records[0].text, opener + body);
  assert.equal(decision.evidence.insertion.text, "者も多く");
  assert.equal(
    decision.evidence.insertion.unit,
    "normalized-codepoint-not-time",
  );
  const before = normalize(f.baseline[1].text + f.baseline[2].text);
  const after = normalize(decision.records[0].text);
  const insertion = decision.evidence.insertion;
  assert.equal(
    after.slice(0, insertion.at) +
      after.slice(insertion.at + insertion.text.length),
    before,
  );
  assert.equal(phraseCount(before, "高齢"), 2);
  assert.equal(phraseCount(after, "高齢"), 2);
  assert.equal(decision.evidence.preservedBaselineOpener, opener);
  assert.deepEqual(
    decision.evidence.views.map((v) => v.donorIds.length),
    [1, 2],
  );
  assert.deepEqual(
    [decision.records[0].sourceStart, decision.records[0].sourceEnd],
    [10, 20],
  );
  assert.equal(decision.records[0].order, f.baseline[1].order);
  assert.equal(decision.records[0].chunkIndex, f.baseline[1].chunkIndex);
  assert.deepEqual(f, original);
  const assembled = [f.baseline[0], ...decision.records, f.baseline[3]];
  assert.deepEqual(assembled[0], original.baseline[0]);
  assert.deepEqual(assembled.at(-1), original.baseline.at(-1));
  assert.equal(assembled.length, original.baseline.length - 1);
});

test("existing context route abstains instead of deleting a meaningful repeated 高齢", () => {
  const f = fixture();
  const decision = proposeContextText(f.target, f.baseline, f.views);
  assert.equal(decision.status, "ABSTAIN");
  assert.deepEqual(decision.records, []);
  assert.deepEqual(decision.replaceIds, []);
});

test("proposal is explicitly offline, non-promoted, non-acoustically-aligned, and needs review", () => {
  const decision = propose(fixture());
  assert.equal(Object.isFrozen(anchoredContinuationPolicy), true);
  assert.equal(decision.policy, anchoredContinuationPolicy);
  assert.equal(decision.newInference, 0);
  assert.equal(decision.referenceUsed, false);
  assert.equal(decision.acousticTimingVerified, false);
  assert.equal(decision.humanValidated, false);
  assert.equal(decision.finalizationMethod, "none");
  assert.equal(decision.qualityStatus, "needs-review");
  assert.equal(decision.automaticPromotionAllowed, false);
  assert.equal(decision.policy.automaticPromotionAllowed, false);
  assert.equal(decision.evidence.originalTextRetainedInOrder, true);
  assert.equal(decision.evidence.sharedPhraseCountPreserved, true);
  assert.equal(decision.evidence.substringTimeInferred, false);
  assert.equal(
    decision.evidence.sameRelatedModelViewsNotIndependentModels,
    true,
  );
});

test("view order and segment divisions cannot change normalized selected text", () => {
  const f = fixture();
  const forward = propose(f);
  f.views.reverse();
  const reverse = propose(f);
  assert.equal(reverse.status, "CANDIDATE");
  assert.equal(
    normalize(reverse.records[0].text),
    normalize(forward.records[0].text),
  );
  assert.deepEqual(reverse.evidence.insertion, forward.evidence.insertion);
  assert.deepEqual(
    [reverse.records[0].sourceStart, reverse.records[0].sourceEnd],
    [10, 20],
  );
});

test("new preceding words in either donor never enter the candidate", () => {
  const f = fixture();
  f.views[0].records[0].text = "追加した前文は導入しない" + opener;
  f.views[1].records[0].text = "別の新しい前文も導入しない" + opener;
  const decision = propose(f);
  assert.equal(decision.status, "CANDIDATE");
  assert.equal(decision.records[0].text, opener + body);
  assert.equal(decision.records[0].text.includes("導入しない"), false);
  assert.equal(decision.evidence.preservedBaselineOpener, opener);
});

test("raw opener spaces, punctuation, and newlines remain intact without competing cuts", () => {
  for (const separator of [" ", "。", "。\n", " \n。 "]) {
    const f = fixture();
    f.baseline[1].text = opener + separator + bodyStart;
    const decision = propose(f);
    assert.equal(decision.status, "CANDIDATE", JSON.stringify(separator));
    assert.equal(decision.evidence.preservedBaselineOpener, opener + separator);
    assert.equal(decision.records[0].text, opener + separator + body);
    assert.equal(decision.evidence.insertion.text, "者も多く");
  }
});

test("explicit bounded limits are part of the advertised policy", () => {
  assert.equal(anchoredContinuationPolicy.maximumTargetSeconds, 13);
  assert.equal(anchoredContinuationPolicy.maximumWindowSeconds, 15);
  assert.equal(anchoredContinuationPolicy.maximumRecordCharacters, 4096);
  assert.equal(anchoredContinuationPolicy.maximumViewRecords, 64);
});

test("a 13-second target at the permitted boundary still needs full continuation support", () => {
  const f = fixture();
  f.target.sourceEnd = 23;
  f.baseline[2].sourceEnd = 23;
  f.baseline[3].sourceStart = 23;
  f.baseline[3].sourceEnd = 27;
  for (const [index, view] of f.views.entries()) {
    view.start = 9 + index * 0.5;
    view.end = view.start + 15;
    view.records[0].sourceStart = view.start;
    view.records.at(-1).sourceEnd = 23;
  }
  const decision = propose(f);
  assert.equal(decision.status, "CANDIDATE");
  assert.deepEqual(
    [decision.records[0].sourceStart, decision.records[0].sourceEnd],
    [10, 23],
  );
});

test("64 valid view records remain legal without consuming outside-context text", () => {
  const f = fixture();
  for (let i = 0; i < 62; i++) {
    f.views[0].records.push({
      ...f.views[0].records[1],
      recordId: `extra-context-${i}`,
      text: "音",
      sourceStart: 20 + i * 0.03,
      sourceEnd: 20 + (i + 1) * 0.03,
    });
  }
  assert.equal(f.views[0].records.length, 64);
  const decision = propose(f);
  assert.equal(decision.status, "CANDIDATE");
  assert.equal(decision.records[0].text, opener + body);
});

rejectCase(
  "duplicate opener across the whole view makes occurrence attribution ambiguous",
  (f) => {
    f.views[0].records[0].text = opener + "、" + f.views[0].records[0].text;
  },
  "NO_UNIQUE_INSERTION_ONLY_COMPLETE_CONTINUATION",
);
rejectCase(
  "a view wider than 15 seconds is rejected before text recovery",
  (f) => {
    f.views[0].end += 0.01;
  },
  "INVALID_VIEW_TIME_OR_SOURCE_BINDING",
);
rejectCase(
  "a baseline record longer than 4096 characters is rejected",
  (f) => {
    f.baseline[0].text = "あ".repeat(4097);
  },
  "INVALID_BASELINE",
);
rejectCase(
  "a donor record longer than 4096 characters is rejected",
  (f) => {
    f.views[0].records[0].text = "あ".repeat(4097);
  },
  "INVALID_VIEW_TIME_OR_SOURCE_BINDING",
);
rejectCase(
  "more than 64 view records is rejected before candidate search",
  (f) => {
    for (let i = 0; i < 63; i++) {
      f.views[0].records.push({
        ...f.views[0].records[1],
        recordId: `extra-context-${i}`,
        text: "音",
        sourceStart: 20 + i * 0.03,
        sourceEnd: 20 + (i + 1) * 0.03,
      });
    }
  },
  "INVALID_VIEW_TIME_OR_SOURCE_BINDING",
);
rejectCase(
  "missing target identity is rejected",
  (f) => {
    delete f.target.id;
  },
  "INVALID_TARGET",
);

rejectCase(
  "conflicting complete continuation cannot provide a winner",
  (f) => {
    f.views[1].records[1].text = bodyStart + "者も少なく";
  },
  "NO_UNIQUE_INSERTION_ONLY_COMPLETE_CONTINUATION",
);
rejectCase(
  "repeated complete continuation is not collapsed",
  (f) => {
    f.views[0].records[1].text += "、" + body;
  },
  "NO_UNIQUE_INSERTION_ONLY_COMPLETE_CONTINUATION",
);
rejectCase(
  "a missing final clause cannot be supplied from the baseline",
  (f) => {
    f.views[1].records[2].text = conclusion.slice(0, -3);
  },
  "NO_UNIQUE_INSERTION_ONLY_COMPLETE_CONTINUATION",
);
rejectCase(
  "an additional trailing sentence is not trimmed away",
  (f) => {
    f.views[0].records[1].text += "そして次の説明です";
  },
  "NO_UNIQUE_INSERTION_ONLY_COMPLETE_CONTINUATION",
);
rejectCase(
  "existing middle words cannot be deleted even when both views agree",
  (f) => {
    for (const view of f.views) {
      for (const row of view.records)
        row.text = row.text.replace("健康維持", "健康");
    }
  },
  "NO_UNIQUE_INSERTION_ONLY_COMPLETE_CONTINUATION",
);
rejectCase(
  "shared 高齢 cannot be removed from agreeing donor views",
  (f) => {
    for (const view of f.views) {
      for (const row of view.records)
        row.text = row.text.replace("高齢者も多く", "者も多く");
    }
  },
  "NO_UNIQUE_INSERTION_ONLY_COMPLETE_CONTINUATION",
);
rejectCase(
  "insertion must not exceed the bounded character allowance",
  (f) => {
    for (const view of f.views) {
      for (const row of view.records)
        row.text = row.text.replace("者も多く", "者もかなり数多くいるので");
    }
  },
  "NO_UNIQUE_INSERTION_ONLY_COMPLETE_CONTINUATION",
);
rejectCase(
  "without new characters, a seam merge is not a recovery candidate",
  (f) => {
    for (const view of f.views) {
      for (const row of view.records)
        row.text = row.text.replace("者も多く、", "").replace("者も多く", "");
    }
  },
  "NO_UNIQUE_INSERTION_ONLY_COMPLETE_CONTINUATION",
);

rejectCase(
  "the same WAV cannot count as two views",
  (f) => {
    f.views[1].audioHash = f.views[0].audioHash;
  },
  "TWO_DISTINCT_VIEWS_REQUIRED",
);
rejectCase(
  "the same physical window cannot count as two views",
  (f) => {
    f.views[1].start = f.views[0].start;
    f.views[1].end = f.views[0].end;
  },
  "TWO_DISTINCT_VIEWS_REQUIRED",
);
rejectCase(
  "the same request cannot count as two views",
  (f) => {
    f.views[1].requestId = f.views[0].requestId;
  },
  "TWO_DISTINCT_VIEWS_REQUIRED",
);
rejectCase(
  "one view cannot support the recovery",
  (f) => {
    f.views.pop();
  },
  "TWO_DISTINCT_VIEWS_REQUIRED",
);
rejectCase(
  "source hash mismatch is rejected",
  (f) => {
    f.views[1].sourceAudioHash = "d".repeat(64);
  },
  "INVALID_VIEW_TIME_OR_SOURCE_BINDING",
);
rejectCase(
  "invalid source hash option is rejected",
  (f) => {
    f.options.sourceAudioHash = "not-a-sha256";
  },
  "EXPLICIT_SOURCE_AND_LANGUAGE_REQUIRED",
);
rejectCase(
  "non-Japanese request is rejected",
  (f) => {
    f.options.language = "en";
  },
  "EXPLICIT_SOURCE_AND_LANGUAGE_REQUIRED",
);
rejectCase(
  "invalid WAV hash is rejected",
  (f) => {
    f.views[0].audioHash = "b";
  },
  "INVALID_VIEW_TIME_OR_SOURCE_BINDING",
);
rejectCase(
  "wrong target identity is rejected",
  (f) => {
    f.views[0].targetId = "another-target";
  },
  "INVALID_VIEW_TIME_OR_SOURCE_BINDING",
);
rejectCase(
  "donor record request binding is required",
  (f) => {
    f.views[0].records[1].requestId = "unrelated-request";
  },
  "INVALID_VIEW_TIME_OR_SOURCE_BINDING",
);
rejectCase(
  "duplicate donor record identity across views is rejected",
  (f) => {
    f.views[1].records[1].recordId = f.views[0].records[1].recordId;
  },
  "DUPLICATE_DONOR_IDENTITY",
);

rejectCase(
  "an out-of-window trailing segment invalidates the entire view",
  (f) => {
    f.views[0].records.push({
      ...f.views[0].records[1],
      recordId: "out-of-window-tail",
      text: "次に始めます",
      sourceStart: 21,
      sourceEnd: 22.1,
    });
  },
  "INVALID_VIEW_TIME_OR_SOURCE_BINDING",
);
rejectCase(
  "reversed donor order is rejected rather than silently sorted",
  (f) => {
    f.views[1].records.reverse();
  },
  "INVALID_VIEW_TIME_OR_SOURCE_BINDING",
);
rejectCase(
  "overlapping donor segment times are rejected",
  (f) => {
    f.views[1].records[2].sourceStart = 16.9;
  },
  "INVALID_VIEW_TIME_OR_SOURCE_BINDING",
);
rejectCase(
  "a continuation outside the original target cannot be cropped",
  (f) => {
    f.views[0].records[1].sourceEnd = 20.1;
  },
  "NO_UNIQUE_INSERTION_ONLY_COMPLETE_CONTINUATION",
);
rejectCase(
  "insufficient whole-continuation duration cannot be promoted",
  (f) => {
    f.views[0].records[1].sourceStart = 12.1;
  },
  "NO_UNIQUE_INSERTION_ONLY_COMPLETE_CONTINUATION",
);
rejectCase(
  "a context opener that does not cross the original start is insufficient",
  (f) => {
    f.views[0].records[0].sourceStart = 10;
  },
  "NO_UNIQUE_INSERTION_ONLY_COMPLETE_CONTINUATION",
);
rejectCase(
  "changed frozen opener is not fuzzy-matched",
  (f) => {
    f.views[0].records[0].text = f.views[0].records[0].text.replace(
      "運動指導",
      "運動練習",
    );
  },
  "NO_UNIQUE_INSERTION_ONLY_COMPLETE_CONTINUATION",
);

rejectCase(
  "duplicate baseline identity is rejected",
  (f) => {
    f.baseline[0].recordId = "left";
  },
  "INVALID_BASELINE",
);
rejectCase(
  "baseline with an unresolved issue is rejected",
  (f) => {
    f.baseline[1].issues.push("INVALID_TIMING");
  },
  "INVALID_BASELINE",
);
rejectCase(
  "baseline with invalid time is rejected",
  (f) => {
    f.baseline[2].sourceEnd = f.baseline[2].sourceStart;
  },
  "INVALID_BASELINE",
);
rejectCase(
  "baseline with blank text is rejected",
  (f) => {
    f.baseline[1].text = " ";
  },
  "INVALID_BASELINE",
);
rejectCase(
  "target must identify exactly two different rows",
  (f) => {
    f.target.recordIds = ["left", "left"];
  },
  "INVALID_TARGET",
);
rejectCase(
  "target rows must be contiguous in the original baseline",
  (f) => {
    f.target.recordIds = ["left", "next"];
  },
  "CONTIGUOUS_BASELINE_PAIR_REQUIRED",
);
rejectCase(
  "target cannot refer to missing baseline rows",
  (f) => {
    f.target.recordIds = ["missing", "right"];
  },
  "CONTIGUOUS_BASELINE_PAIR_REQUIRED",
);
rejectCase(
  "target must preserve the entire original outer interval",
  (f) => {
    f.target.sourceEnd = 19.9;
  },
  "WHOLE_ORIGINAL_ENVELOPE_REQUIRED",
);
rejectCase(
  "target must remain within the local duration limit",
  (f) => {
    f.target.sourceEnd = 24;
  },
  "INVALID_TARGET",
);
rejectCase(
  "disjoint baseline rows are not a seam target",
  (f) => {
    f.baseline[1].sourceEnd = 15;
  },
  "WHOLE_ORIGINAL_ENVELOPE_REQUIRED",
);
rejectCase(
  "short baseline is protected even with agreeing continuation views",
  (f) => {
    f.baseline[1].text = "高齢";
    f.baseline[2].text = "高齢者です";
  },
  "SHORT_TARGET_PROTECTED",
);
rejectCase(
  "intersecting non-target neighbor cannot be swallowed or modified",
  (f) => {
    f.baseline[0].sourceEnd = 10.01;
  },
  "PROTECTED_NEIGHBOR_COLLISION",
);
