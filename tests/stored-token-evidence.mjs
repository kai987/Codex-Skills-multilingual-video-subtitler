import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeStoredTokens } from "../scripts/lib/stored-token-evidence.mjs";

const clock = (ms) => {
  const h = Math.floor(ms / 3600000),
    m = Math.floor(ms / 60000) % 60,
    s = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};
const interval = (from, to) => ({
  offsets: { from, to },
  timestamps: { from: clock(from), to: clock(to) },
});
const token = (text, from, to, id = 100) => ({
  ...interval(from, to),
  id,
  text,
  t_dtw: -1,
  p: 0.999,
});
function fixture() {
  return {
    response: {
      model: { multilingual: true, vocab: 51866 },
      params: { language: "ja", translate: false },
      result: { language: "ja" },
      transcription: [
        {
          ...interval(1000, 3000),
          text: "合成テスト",
          tokens: [
            token("[_BEG_]", 1000, 1000, 50365),
            token("合成", 1000, 2000),
            token("テスト", 2000, 3000),
            token("[_TT_150]", 3000, 3000, 50515),
          ],
        },
      ],
    },
    records: [
      {
        recordId: "r1",
        requestId: "chunk-1",
        text: "合成テスト",
        localStart: 1,
        localEnd: 3,
        sourceStart: 425.7,
        sourceEnd: 427.7,
      },
    ],
    request: {
      requestId: "chunk-1",
      sourceOffset: 424.7,
      duration: 25.3,
      language: "ja",
      bindingValidated: true,
      sourceHash: "a".repeat(64),
      modelHash: "b".repeat(64),
      runtimeHash: "c".repeat(64),
      rawResponseHash: "d".repeat(64),
      args: ["--output-json-full"],
    },
  };
}

test("millisecond offsets map once; controls are not zero-length words; high p never proves alignment", () => {
  const a = analyzeStoredTokens(fixture());
  assert.equal(a.rows[0].tokens[0].sourceStart, 425.7);
  assert.equal(a.summary.textTokenItems, 2);
  assert.equal(a.summary.controlItems, 2);
  assert.equal(a.summary.zeroDurationTextItems, 0);
  assert.deepEqual(a.rows[0].issues, []);
  assert.equal(a.rows[0].provenance.validated, true);
  assert.equal(a.rows[0].provenance.timingVerified, false);
  assert.equal(a.semantics.dtwAvailability, "unavailable");
  assert.equal(a.canAutoRetime, false);
});
test("a stretched first token is reported but never truncated or retimed", () => {
  const f = fixture();
  f.response.transcription[0] = {
    ...interval(3220, 13960),
    text: "こちらお返し",
    tokens: [token("こちら", 3220, 12180), token("お返し", 12180, 13960)],
  };
  f.request.sourceOffset = 355;
  f.records[0] = {
    ...f.records[0],
    text: "こちらお返し",
    localStart: 3.22,
    localEnd: 13.96,
    sourceStart: 358.22,
    sourceEnd: 368.96,
  };
  const before = JSON.stringify(f),
    a = analyzeStoredTokens(f);
  assert.ok(a.rows[0].issues.includes("DOMINANT_LONG_FIRST_TOKEN"));
  assert.equal(a.rows[0].tokens[0].duration, 8.96);
  assert.equal(a.rows[0].tokens[0].sourceStart, 358.22);
  assert.equal(a.rows[0].proposedRepair, null);
  assert.equal(JSON.stringify(f), before);
});
test("four-way segment containment catches reversed endpoints beyond both boundaries", () => {
  const f = fixture();
  f.response.transcription[0].tokens[1] = token("合成", 3200, 800);
  const a = analyzeStoredTokens(f);
  assert.equal(a.summary.reversedTextItems, 1);
  assert.equal(a.summary.outOfSegmentTextItems, 1);
  assert.ok(a.rows[0].issues.includes("REVERSED_INTERVAL"));
});
test("ordinary zero-duration punctuation and words are both invalid; controls remain separate", () => {
  const f = fixture();
  f.response.transcription[0].tokens[1] = token("合成", 1000, 1000);
  const a = analyzeStoredTokens(f);
  assert.equal(a.summary.zeroDurationTextItems, 1);
  assert.equal(a.summary.nonpositiveTextSegments, 1);
  assert.equal(a.summary.dtwUnavailableItems, 4);
});
test("unknown sentinel strings cannot silently remove text", () => {
  const f = fixture();
  f.response.transcription[0].tokens[1] = token("[_BEG_]", 1000, 2000, 100);
  const a = analyzeStoredTokens(f);
  assert.equal(a.rows[0].items[1].text, "[_BEG_]");
  assert.equal(a.summary.unknownItems, 1);
  assert.ok(a.rows[0].issues.includes("TOKEN_TEXT_COVERAGE_MISMATCH"));
  f.response.transcription[0].tokens[1].id = 50300;
  assert.equal(analyzeStoredTokens(f).summary.unknownItems, 1);
});
test("JSON/SRT text, request identity, local and global timing must bind", () => {
  for (const [key, value] of [
    ["text", "別の文字"],
    ["requestId", "another"],
    ["localStart", 2],
    ["sourceStart", 850.4],
  ]) {
    const f = fixture();
    f.records[0][key] = value;
    const a = analyzeStoredTokens(f);
    assert.equal(a.rows[0].provenance.validated, false);
    assert.ok(a.rows[0].issues.includes("JSON_SRT_BINDING_MISMATCH"));
  }
});
test("count/language mismatch invalidates provenance even if first row matches", () => {
  const f = fixture();
  f.records.push({ ...f.records[0] });
  assert.equal(analyzeStoredTokens(f).rows[0].provenance.validated, false);
  f.records.pop();
  f.response.params.translate = true;
  assert.ok(
    analyzeStoredTokens(f).requestIssues.includes(
      "RESPONSE_LANGUAGE_OR_TASK_MISMATCH",
    ),
  );
});
test("missing fields, negative and nonfinite times are diagnosed, never interpolated", () => {
  for (const offsets of [
    undefined,
    { from: -100, to: 2000 },
    { from: NaN, to: Infinity },
  ]) {
    const f = fixture();
    f.response.transcription[0].tokens[1].offsets = offsets;
    const a = analyzeStoredTokens(f);
    assert.ok(a.rows[0].tokens[0].issues.length);
    assert.equal(a.canAutoRetime, false);
    assert.equal(a.rows[0].proposedRepair, null);
  }
});
test("clock mismatch, request overflow, and nonmonotonicity remain explicit", () => {
  const f = fixture();
  f.response.transcription[0].tokens[1].offsets.to = 28000;
  const issues = analyzeStoredTokens(f).rows[0].issues;
  for (const issue of [
    "CLOCK_OFFSET_MISMATCH",
    "OUTSIDE_REQUEST",
    "OUTSIDE_SEGMENT",
    "NONMONOTONIC_TOKEN_SEQUENCE",
  ])
    assert.ok(issues.includes(issue), issue);
});
test("DTW values do not magically verify token timing; invalid request timebase rejected", () => {
  const f = fixture();
  f.response.transcription[0].tokens[1].t_dtw = 150;
  assert.equal(analyzeStoredTokens(f).rows[0].provenance.timingVerified, false);
  f.request.sourceOffset = NaN;
  assert.throws(() => analyzeStoredTokens(f), /TIMEBASE/u);
  f.request.sourceOffset = -1;
  assert.throws(() => analyzeStoredTokens(f), /TIMEBASE/u);
});

test("JSON items alone do not prove token-time computation", () => {
  const f = fixture();
  f.request.args = [];
  for (const item of f.response.transcription[0].tokens) {
    delete item.offsets;
    delete item.timestamps;
  }
  const a = analyzeStoredTokens(f);
  assert.equal(a.semantics.ordinaryTokenTimingFieldsPresent, false);
  assert.equal(a.semantics.jsonFullRequested, false);
  assert.equal(
    a.semantics.runtimeComputationVerification,
    "NOT_INDEPENDENTLY_OBSERVED",
  );
});
