import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeSeamEvidence } from "../scripts/lib/bounded-seam-evidence.mjs";

function fixture(
  leftText = "資料を確認してください",
  rightText = "資料を確認してください続けます",
) {
  const sourceOffset = 100;
  const record = (text, index) => ({
    recordId: `record-${index}`,
    requestId: `request-${index}`,
    chunkId: `chunk-${index}`,
    chunkIndex: index,
    text,
    sourceStart: 100,
    sourceEnd: 110,
    audioGlobalStart: 0,
    audioGlobalEnd: 10,
    issues: [],
  });
  const records = [record(leftText, 0), record(rightText, 1)];
  const tokens = (text) =>
    Array.from(text).map((text, index) => ({
      tokenId: text.codePointAt(0),
      text,
      sourceStart: 100 + index * 0.1,
      sourceEnd: 100 + (index + 1) * 0.1,
    }));
  const tokenEvidence = records.map((r) => ({
    recordId: r.recordId,
    requestId: r.requestId,
    text: r.text,
    tokens: tokens(r.text),
    issues: [],
    provenance: {
      validated: true,
      timingVerified: false,
      timebase: "source-global",
      sourceHash: "a".repeat(64),
      modelHash: "b".repeat(64),
      runtimeHash: "c".repeat(64),
      rawResponseHash: "d".repeat(64),
    },
  }));
  return {
    records,
    tokenEvidence,
    sourceOffset,
    decisions: [
      {
        leftId: records[0].recordId,
        rightId: records[1].recordId,
        overlap: [0, 10],
        status: "BOUNDARY_AMBIGUITY",
      },
    ],
  };
}
const analyze = (input) => analyzeSeamEvidence(input).pairs[0];

test("exact suffix/prefix text and overlapping IDs remain diagnostic, never a repair", () => {
  const input = fixture(),
    snapshot = JSON.stringify(input),
    result = analyzeSeamEvidence(input),
    pair = result.pairs[0];
  assert.equal(pair.status, "ABSTAIN");
  assert.equal(pair.proposedRepair, null);
  assert.ok(pair.exactSuffixPrefixCandidate.allTokenIdsEqual);
  assert.ok(pair.exactSuffixPrefixCandidate.allTokenIntervalsExactlyEqual);
  assert.ok(
    pair.blockers.includes("HEURISTIC_TOKEN_TIMING_NOT_ACOUSTICALLY_VERIFIED"),
  );
  assert.equal(result.summary.proposedRepairCount, 0);
  assert.equal(JSON.stringify(input), snapshot);
  assert.deepEqual(analyzeSeamEvidence(input), result);
});

test("a caller timingVerified flag cannot fabricate acoustic occurrence equivalence", () => {
  const input = fixture();
  input.tokenEvidence.forEach((row) => {
    row.provenance.timingVerified = true;
  });
  const pair = analyze(input);
  assert.ok(
    !pair.blockers.includes("HEURISTIC_TOKEN_TIMING_NOT_ACOUSTICALLY_VERIFIED"),
  );
  assert.ok(pair.blockers.includes("ACOUSTIC_OCCURRENCE_EQUIVALENCE_UNPROVEN"));
  assert.equal(pair.proposedRepair, null);
});

test("nonoverlapping genuine repeated phrases stay distinct", () => {
  const input = fixture("こちらをお願いします", "こちらをお願いします");
  input.tokenEvidence[1].tokens.forEach((token) => {
    token.sourceStart += 5;
    token.sourceEnd += 5;
  });
  const pair = analyze(input);
  assert.ok(pair.blockers.includes("SUFFIX_PREFIX_TOKEN_INTERVALS_DISAGREE"));
  assert.ok(
    pair.blockers.includes("SHARED_TEXT_HAS_NONOVERLAPPING_TOKEN_OCCURRENCES"),
  );
  assert.equal(pair.proposedRepair, null);
});

test("short interjections and repeated occurrences are protected", () => {
  const short = analyze(fixture("はい", "はい"));
  assert.ok(short.blockers.includes("SHORT_INTERJECTION_OR_PHRASE_PROTECTED"));
  const repeated = analyze(
    fixture("確認お願いします確認お願いします", "確認お願いします"),
  );
  assert.ok(repeated.blockers.includes("NONUNIQUE_REPEATED_TEXT_OCCURRENCE"));
});

test("conflicting spelling near a shared tail is not fuzzy deletion authority", () => {
  const pair = analyze(
    fixture("前の説明を間違えている", "勘違えているので確認します"),
  );
  assert.equal(pair.exactSuffixPrefixCandidate, null);
  assert.ok(pair.blockers.includes("RIGHT_PREFIX_OR_SPELLING_CONFLICT"));
  assert.ok(pair.sharedTokenRuns.some((run) => run.text === "違えている"));
});

test("same word at another position and time is not a seam duplicate", () => {
  const input = fixture("今回は偶然ですね", "先の話ですが偶然");
  input.tokenEvidence[1].tokens.forEach((token) => {
    token.sourceStart += 4;
    token.sourceEnd += 4;
  });
  const pair = analyze(input);
  assert.equal(pair.exactSuffixPrefixCandidate, null);
  assert.ok(pair.sharedTokenRuns.some((run) => run.text === "偶然"));
  assert.ok(
    pair.blockers.includes("SHARED_TEXT_HAS_NONOVERLAPPING_TOKEN_OCCURRENCES"),
  );
});

test("width, case, punctuation and kanji are not normalized into equality", () => {
  for (const [left, right] of [
    ["ＡＢＣＤＥＦＧＨＩ", "ABCDEFGHI"],
    ["ABCDEFGHI", "abcdefghi"],
    ["こちら、です", "こちらです"],
    ["確認済み", "確認ずみ"],
  ]) {
    assert.equal(
      analyze(fixture(left, right)).exactSuffixPrefixCandidate,
      null,
    );
  }
});

test("raw reversed, null and out-of-record token intervals become blockers", () => {
  for (const [start, end, expected] of [
    [104, 103, "INVALID_TOKEN_INTERVAL"],
    [null, 103, "INVALID_TOKEN_INTERVAL"],
    [99, 100, "TOKEN_OUTSIDE_RECORD_INTERVAL"],
  ]) {
    const input = fixture();
    Object.assign(input.tokenEvidence[0].tokens[0], {
      sourceStart: start,
      sourceEnd: end,
    });
    const pair = analyze(input);
    assert.ok(pair.blockers.includes(expected));
    assert.ok(pair.left.tokenIssues.length);
    assert.deepEqual(JSON.parse(JSON.stringify(pair)), pair);
  }
});

test("Whisper timestamp and begin markers cannot masquerade as lexical tokens", () => {
  for (const text of ["[_BEG_]", "[_TT_1265]"]) {
    const input = fixture();
    input.tokenEvidence[0].tokens[0].text = text;
    assert.ok(analyze(input).blockers.includes("NONLEXICAL_TOKEN"));
  }
});

test("missing evidence, hash provenance, mismatched request and partial text fail closed", () => {
  const missing = fixture();
  missing.tokenEvidence = [];
  assert.ok(analyze(missing).blockers.includes("TOKEN_EVIDENCE_MISSING"));
  for (const [edit, expected] of [
    [
      (row) => {
        row.provenance.validated = false;
      },
      "TOKEN_PROVENANCE_NOT_VALIDATED",
    ],
    [
      (row) => {
        row.provenance.rawResponseHash = "not-hash";
      },
      "TOKEN_PROVENANCE_NOT_VALIDATED",
    ],
    [
      (row) => {
        row.requestId = "wrong";
      },
      "TOKEN_RECORD_BINDING_MISMATCH",
    ],
    [
      (row) => {
        row.tokens.pop();
      },
      "LEXICAL_TOKEN_TEXT_NOT_EXACT_RECORD_TEXT",
    ],
    [
      (row) => {
        row.issues.push("RAW_TOKEN_INVALID");
      },
      "UPSTREAM_TOKEN_EVIDENCE_ISSUES",
    ],
    [
      (row) => {
        row.provenance.sourceHash = "e".repeat(64);
      },
      "SOURCE_OR_TOKEN_NAMESPACE_MISMATCH",
    ],
  ]) {
    const input = fixture();
    edit(input.tokenEvidence[0]);
    assert.ok(analyze(input).blockers.includes(expected));
  }
});

test("wrong source offset and nonadjacent requests are not silently corrected", () => {
  const offset = fixture();
  offset.sourceOffset = 0;
  assert.ok(
    analyze(offset).blockers.includes("SOURCE_GLOBAL_OFFSET_BINDING_MISMATCH"),
  );
  assert.ok(analyze(offset).blockers.includes("NO_SOURCE_GLOBAL_SEAM_OVERLAP"));
  const chunks = fixture();
  chunks.records[1].chunkIndex = 2;
  assert.ok(analyze(chunks).blockers.includes("NONADJACENT_OR_SAME_REQUEST"));
});

test("multiple candidate associations, different token IDs and outside overlap stay review-only", () => {
  const multiple = fixture();
  multiple.decisions.push({ ...multiple.decisions[0] });
  assert.ok(analyze(multiple).blockers.includes("NONUNIQUE_SEAM_ASSOCIATION"));
  const ids = fixture();
  ids.tokenEvidence[1].tokens[0].tokenId++;
  assert.ok(
    analyze(ids).blockers.includes("MATCHING_TEXT_DIFFERENT_TOKEN_IDS"),
  );
  const overlap = fixture();
  overlap.decisions[0].overlap = [1, 2];
  assert.ok(
    analyze(overlap).blockers.includes(
      "MATCHED_TOKENS_OUTSIDE_REQUEST_OVERLAP",
    ),
  );
});

test("malformed shapes and duplicate provenance identities reject explicitly", () => {
  for (const mutate of [
    (input) => {
      input.records.push({ ...input.records[0] });
    },
    (input) => {
      input.tokenEvidence.push({ ...input.tokenEvidence[0] });
    },
    (input) => {
      input.sourceOffset = NaN;
    },
    (input) => {
      input.decisions[0].overlap = [2, 1];
    },
    (input) => {
      input.decisions[0].rightId = "missing";
    },
    (input) => {
      input.tokenEvidence[0].tokens[0] = null;
    },
  ]) {
    const input = fixture();
    mutate(input);
    assert.throws(() => analyze(input), /SEAM_/u);
  }
});

test("highly repetitive token diagnostics remain bounded and disclose truncation", () => {
  const pair = analyze(fixture("確認".repeat(100), "確認".repeat(100)));
  assert.equal(pair.sharedRunEnumerationComplete, false);
  assert.equal(pair.totalSharedTokenRuns, null);
  assert.ok(pair.sharedTokenRuns.length <= 64);
  assert.ok(pair.blockers.includes("SHARED_RUN_DIAGNOSTICS_TRUNCATED"));
  assert.equal(pair.proposedRepair, null);
});
