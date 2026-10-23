import test from "node:test";
import assert from "node:assert/strict";
import { localizeStoredContext } from "../scripts/lib/full-context-token-localization.mjs";
const hashes = {
  sourceHash: "a".repeat(64),
  modelHash: "b".repeat(64),
  runtimeHash: "c".repeat(64),
};
const probe = { id: "p", start: 0, end: 4, targetStart: 1, targetEnd: 2 };
function fixture() {
  return {
    referenceUsed: false,
    binding: hashes,
    requests: [
      {
        requestId: "r",
        requestIssues: [],
        rows: [
          {
            requestId: "r",
            recordId: "row",
            text: "前あ後",
            sourceStart: 0,
            sourceEnd: 3,
            issues: [],
            provenance: {
              ...hashes,
              validated: true,
              timebase: "source-global",
            },
            tokens: ["前", "あ", "後"].map((text, i) => ({
              text,
              sourceStart: i,
              sourceEnd: i + 1,
              issues: [],
            })),
          },
        ],
      },
    ],
  };
}
test("preserves complete context without converting overlap to recovery", () => {
  const a = fixture(),
    before = globalThis.structuredClone(a);
  const [r] = localizeStoredContext(a, [probe]);
  assert.equal(r.diagnostic, "UNVERIFIED_TOKEN_OVERLAP");
  assert.equal(r.context[0].fullText, "前あ後");
  assert.deepEqual(
    r.context[0].lexicalTokens.map((t) => t.relation),
    ["before-target", "heuristic-overlap", "after-target"],
  );
  assert.equal(r.canInsertSubtitle, false);
  assert.equal(r.canAutoRetime, false);
  assert.deepEqual(a, before);
});
test("separates whitespace zero duration without discarding lexical evidence", () => {
  const a = fixture(),
    row = a.requests[0].rows[0];
  row.tokens.splice(1, 0, {
    text: " ",
    sourceStart: 1,
    sourceEnd: 1,
    issues: ["ZERO_DURATION"],
  });
  row.text = "前 あ後";
  row.issues = ["ZERO_DURATION"];
  const [r] = localizeStoredContext(a, [probe]);
  assert.equal(r.context[0].whitespaceOnlyZeroSeparated, true);
  assert.equal(r.diagnostic, "UNVERIFIED_TOKEN_OVERLAP");
  assert.equal(r.context[0].formattingTokens.length, 1);
});
test("lexical zero duration and other parent issues remain blocked", () => {
  for (const issue of [
    "ZERO_DURATION",
    "TOKEN_TEXT_MISMATCH",
    "NON_MONOTONIC_TOKEN_SEQUENCE",
  ]) {
    const a = fixture();
    a.requests[0].rows[0].issues = [issue];
    assert.equal(
      localizeStoredContext(a, [probe])[0].diagnostic,
      "NO_USABLE_TOKEN_OVERLAP",
    );
  }
});
test("request issues block otherwise valid tokens", () => {
  const a = fixture();
  a.requests[0].requestIssues = ["REQUEST_INVALID"];
  assert.equal(
    localizeStoredContext(a, [probe])[0].diagnostic,
    "NO_USABLE_TOKEN_OVERLAP",
  );
});
test("does not erase repeated occurrences across requests", () => {
  const a = fixture();
  const r = globalThis.structuredClone(a.requests[0]);
  r.requestId = "r2";
  r.rows[0].requestId = "r2";
  a.requests.push(r);
  assert.equal(localizeStoredContext(a, [probe])[0].context.length, 2);
});
test("rejects foreign source and local timebase", () => {
  for (const patch of [
    { sourceHash: "d".repeat(64) },
    { timebase: "crop-local" },
    { validated: false },
  ]) {
    const a = fixture();
    Object.assign(a.requests[0].rows[0].provenance, patch);
    assert.throws(() => localizeStoredContext(a, [probe]));
  }
});
test("invalid token intervals and text mismatch cannot supply evidence", () => {
  for (const patch of [
    { sourceStart: NaN },
    { sourceEnd: 2000 },
    { sourceStart: 2, sourceEnd: 1 },
    { sourceStart: 1, sourceEnd: 1 },
    { text: "捏造" },
  ]) {
    const a = fixture();
    Object.assign(a.requests[0].rows[0].tokens[1], patch);
    assert.equal(
      localizeStoredContext(a, [probe])[0].diagnostic,
      "NO_USABLE_TOKEN_OVERLAP",
    );
  }
});
test("rejects reference inputs, duplicate IDs and invalid targets", () => {
  const a = fixture();
  a.referenceUsed = true;
  assert.throws(() => localizeStoredContext(a, [probe]));
  assert.throws(() => localizeStoredContext(fixture(), [probe, probe]));
  assert.throws(() =>
    localizeStoredContext(fixture(), [{ ...probe, targetEnd: 5 }]),
  );
});
