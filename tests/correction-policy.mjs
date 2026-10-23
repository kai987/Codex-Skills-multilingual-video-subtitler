import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCorrection,
  correctionPolicy,
} from "../scripts/lib/correction-policy.mjs";

const token = (text, start = 1.2, end = 3.8) => ({
  text,
  start,
  end,
  kind: "LEXICAL",
  flags: [],
  timeStatus: "INTERVAL",
});
const record = (recordId, text, sourceStart = 1, sourceEnd = 4) => ({
  recordId,
  text,
  sourceStart,
  sourceEnd,
  custom: { retained: true },
});
const target = (
  id = "target",
  baselineIds = ["before"],
  start = 1,
  end = 4,
) => ({ id, baselineIds, start, end, reason: "synthetic-machine-risk" });
function paired(t, tokens) {
  return [0, 1].map((i) => ({
    targetId: t.id,
    requestId: `${t.id}-view-${i}`,
    requestStart: 0,
    requestEnd: 6 + i,
    audioHash: String(i + 1).repeat(64),
    rawHash: String(i + 3).repeat(64),
    status: "completed",
    segments: [
      {
        text: tokens
          .filter((value) => value.kind !== "CONTROL")
          .map((value) => value.text)
          .join(""),
        start: 0,
        end: 6,
        tokens: JSON.parse(JSON.stringify(tokens)),
        sourceTextComplete: true,
      },
    ],
  }));
}
function run(before, tokens, edit = () => undefined, t = target()) {
  const views = paired(t, tokens);
  edit(views);
  return buildCorrection(before, { targets: [t] }, views);
}
const before = () => [record("before", "明日は学校へ行きます")];
const kept = (result, expectedReason) => {
  assert.equal(result.changes.length, 0);
  assert.equal(result.decisions[0].status, "ABSTAINED");
  assert.ok(
    result.decisions[0].reasons.includes(expectedReason),
    JSON.stringify(result.decisions[0].reasons),
  );
};

test("frozen candidate policy leaves protected release disabled", () => {
  assert.ok(Object.isFrozen(correctionPolicy));
  assert.equal(correctionPolicy.machineOnlyReleaseAuthorized, false);
  assert.equal(correctionPolicy.finalizationMethod, "none");
});

test("agreed machine text replaces only explicitly owned baseline in a separate candidate", () => {
  const source = before(),
    untouched = record("later", "おはよう", 8, 9);
  source.push(untouched);
  const snapshot = JSON.stringify(source);
  const result = run(source, [token("明日は学校に行きます")]);
  assert.equal(result.changes.length, 1);
  assert.equal(result.changes[0].action, "REPLACE");
  assert.deepEqual(result.changes[0].before, [source[0]]);
  assert.equal(result.records[0].text, "明日は学校に行きます");
  assert.equal(result.records[1], untouched);
  assert.equal(JSON.stringify(source), snapshot);
  assert.equal(result.status, "needs-review");
});

test("real token gap splits with exact character accounting", () => {
  const result = run(
    [record("before", "今日は学校へ行きます明日は休みです")],
    [token("今日は学校へ行きます", 1.2, 2), token("明日は休みです", 2.5, 3.8)],
  );
  assert.equal(result.changes[0].action, "SPLIT");
  assert.deepEqual(
    result.records.map((r) => r.text),
    ["今日は学校へ行きます", "明日は休みです"],
  );
  assert.equal(
    result.records.map((r) => r.text).join(""),
    "今日は学校へ行きます明日は休みです",
  );
});

test("punctuation splits at an existing token boundary, never inside a token", () => {
  const result = run(
    [record("before", "今日は晴れ。明日は雨。")],
    [token("今日は晴れ。", 1.2, 2.3), token("明日は雨。", 2.3, 3.8)],
  );
  assert.equal(result.changes[0].action, "SPLIT");
  assert.equal(result.records.length, 2);
  const one = run(
    [record("before", "今日は晴れ。明日は雨。")],
    [token("今日は晴れ。明日は雨。")],
  );
  assert.equal(one.records.length, 1);
});

test("unchanged lexical text may be retimed from stable paired intervals", () => {
  const result = run(before(), [token("明日は学校へ行きます")]);
  assert.equal(result.changes[0].action, "RETIME");
  assert.equal(result.records[0].sourceStart, 1.2);
  assert.equal(result.records[0].sourceEnd, 3.8);
});

test("two views may insert a new gap cue", () => {
  const t = target("missing", []);
  const result = run([], [token("来た！")], () => undefined, t);
  assert.equal(result.changes[0].action, "INSERT");
  assert.equal(result.records[0].text, "来た！");
});

test("narrower view supplies actual timing; views are not averaged", () => {
  const result = run(
    before(),
    [token("明日は学校へ行きます", 1.211, 3.799)],
    (views) => {
      views[1].segments[0].tokens[0].start = 1.4;
      views[1].segments[0].tokens[0].end = 3.6;
    },
  );
  assert.equal(result.records[0].sourceStart, 1.22);
  assert.equal(result.records[0].sourceEnd, 3.79);
  assert.equal(result.decisions[0].selectedRequestId, "target-view-0");
  assert.deepEqual(result.records[0].correction.rawInterval, {
    start: 1.211,
    end: 3.799,
  });
});

test("whitespace-only view differences agree without rewriting selected text", () => {
  const result = run(before(), [token("明日は学校へ行きます")], (views) => {
    views[1].segments[0].text = "明日は 学校へ行きます";
    views[1].segments[0].tokens[0].text = views[1].segments[0].text;
  });
  assert.equal(result.changes.length, 1);
  assert.equal(result.records[0].text, "明日は学校へ行きます");
});

test("context tokens are explicitly accounted but never clipped into owned text", () => {
  const result = run(before(), [
    token("前", 0.2, 0.8),
    token("明日は学校へ行きます"),
    token("後", 4.3, 5),
  ]);
  assert.equal(result.changes.length, 1);
  for (const evidence of result.decisions[0].evidence) {
    assert.equal(evidence.excludedContextCount, 2);
    assert.deepEqual(
      evidence.accounting.map((row) => row.disposition),
      ["EXCLUDED_CONTEXT_BEFORE", "SELECTED", "EXCLUDED_CONTEXT_AFTER"],
    );
  }
  assert.equal(result.records[0].text, "明日は学校へ行きます");
});

test("segment text without actual token evidence cannot change a cue", () => {
  kept(
    run(before(), [token("明日は学校へ行きます")], (views) => {
      views[0].segments[0].tokens = [];
    }),
    "TOKEN_EVIDENCE_MISSING",
  );
});

test("a lexical token crossing ownership is rejected without cropping", () => {
  kept(
    run(before(), [token("明日は学校へ行きます", 0.8, 3.8)]),
    "TOKEN_CROSSES_OWNERSHIP_BOUNDARY",
  );
});

test("different words or punctuation do not count as paired agreement", () => {
  kept(
    run(before(), [token("明日は学校へ行きます")], (views) => {
      views[1].segments[0].text = "明日は学校へ行きます。";
      views[1].segments[0].tokens[0].text = views[1].segments[0].text;
    }),
    "VIEW_TEXT_DISAGREEMENT",
  );
});

test("unstable interior cue boundary cannot be hidden by equal union boundaries", () => {
  kept(
    run(
      [record("before", "今日は晴れ。明日は雨。")],
      [token("今日は晴れ。", 1.2, 2.2), token("明日は雨。", 2.3, 3.8)],
      (views) => {
        views[1].segments[0].tokens[0].end = 2.7;
        views[1].segments[0].tokens[1].start = 2.8;
      },
    ),
    "VIEW_BOUNDARY_UNSTABLE",
  );
});

test("insertion of the neighboring cue text is rejected", () => {
  const t = target("missing", []);
  kept(
    run(
      [record("left", "来た！", 0, 0.9)],
      [token("来た！")],
      () => undefined,
      t,
    ),
    "POTENTIAL_DUPLICATE_INSERTION",
  );
});

test("large deleted tail remains baseline despite paired agreement", () => {
  kept(
    run(
      [record("before", "学校へ行く予定でしたけど")],
      [token("学校へ行く予定")],
    ),
    "BASELINE_TEXT_LOSS_RISK",
  );
});

test("unrelated replacement does not gain authority through agreement", () => {
  kept(
    run(before(), [token("ご視聴ありがとうございました")]),
    "BASELINE_TEXT_UNRELATED",
  );
});

test("unowned neighboring baseline collision rejects replacement", () => {
  kept(
    run(
      [...before(), record("neighbor", "隣の声", 3.5, 4.5)],
      [token("明日は学校へ行きます")],
    ),
    "UNOWNED_BASELINE_COLLISION",
  );
});

test("multiple overlapping target operations abstain together", () => {
  const a = target("a"),
    b = target("b");
  const result = buildCorrection(before(), { targets: [a, b] }, [
    ...paired(a, [token("明日は学校に行きます")]),
    ...paired(b, [token("明日は学校へ行きます")]),
  ]);
  assert.equal(result.changes.length, 0);
  assert.equal(result.records[0].recordId, "before");
  assert.ok(
    result.decisions.every((d) => d.reasons.includes("MULTI_TARGET_CONFLICT")),
  );
});

test("same audio hash is not an independent supporting view", () => {
  kept(
    run(before(), [token("明日は学校へ行きます")], (views) => {
      views[1].audioHash = views[0].audioHash;
    }),
    "INDEPENDENT_VIEW_IDENTITY_REQUIRED",
  );
});

test("repetition risk is retained as abstention, never erased", () => {
  kept(
    run([], [token("あ".repeat(12))], () => undefined, target("missing", [])),
    "REPETITION_RISK",
  );
});

for (const timeStatus of ["ZERO_DURATION", "MISSING", "INVALID"]) {
  test(`${timeStatus} lexical timing cannot manufacture a split or retime`, () => {
    kept(
      run(before(), [{ ...token("明日は学校へ行きます"), timeStatus }]),
      "LEXICAL_INTERVAL_UNAVAILABLE",
    );
  });
}

test("token order inversion is rejected before sorting can hide it", () => {
  kept(
    run(before(), [token("明日は", 2, 2.5), token("学校へ行きます", 1.2, 1.8)]),
    "TOKEN_ORDER_NONMONOTONIC",
  );
});

test("token text must reconstruct the parent exactly", () => {
  kept(
    run(before(), [token("明日は学校へ行きます")], (views) => {
      views[0].segments[0].text += "未計上";
    }),
    "SOURCE_TEXT_ACCOUNTING_MISMATCH",
  );
});

test("unknown vocabulary and invalid UTF-8 are not silently filtered", () => {
  kept(
    run(before(), [
      { ...token("明日は学校へ行きます"), kind: "UNVERIFIED_CONTROL" },
    ]),
    "TOKEN_VOCABULARY_UNVERIFIED",
  );
  kept(
    run(before(), [token("明日は学校へ行きます\uFFFD")]),
    "SOURCE_TEXT_INCOMPLETE",
  );
});

test("coarse old timing may extend outside the corridor but its whole record is replaced", () => {
  const original = record("before", "明日は学校へ行きます", 0.8, 4.3);
  const result = run([original], [token("明日は学校へ行きます")]);
  assert.equal(result.changes.length, 1);
  assert.equal(result.changes[0].action, "RETIME");
  assert.equal(result.changes[0].before[0], original);
  assert.equal(
    result.records.some((value) => value.recordId === original.recordId),
    false,
  );
  assert.equal(original.sourceStart, 0.8);
  assert.equal(original.sourceEnd, 4.3);
});

test("baseline outside the candidate corridor cannot be targeted by matching text alone", () => {
  kept(
    run(
      [record("before", "明日は学校へ行きます", 5, 6)],
      [token("明日は学校へ行きます", 1.2, 3.5)],
      () => undefined,
      target(),
    ),
    "BASELINE_TARGET_OUTSIDE_OWNERSHIP",
  );
});

test("a failed view retains per-request diagnostics and the successful view accounting", () => {
  const result = run(before(), [token("明日は学校へ行きます")], (views) => {
    views[1].segments[0].tokens = [];
  });
  kept(result, "TOKEN_EVIDENCE_MISSING");
  assert.deepEqual(
    result.decisions[0].viewAssessments.map((view) => [
      view.requestId,
      view.status,
      view.reason,
    ]),
    [
      ["target-view-0", "QUALIFIED", null],
      ["target-view-1", "REJECTED", "TOKEN_EVIDENCE_MISSING"],
    ],
  );
  assert.equal(
    result.decisions[0].evidence[0].accounting[0].disposition,
    "SELECTED",
  );
});

test("failed pair and exact no-change preserve old records", () => {
  kept(
    run(before(), [token("明日は学校へ行きます")], (views) => {
      views[1].status = "failed";
    }),
    "VIEW_NOT_COMPLETED",
  );
  kept(run(before(), [token("明日は学校へ行きます", 1, 4)]), "NO_CHANGE");
});

test("subcentisecond intervals are not expanded into fictional usable time", () => {
  kept(
    run(
      [],
      [token("はい", 1.001, 1.009)],
      () => undefined,
      target("missing", []),
    ),
    "CUE_PROJECTION_COLLAPSE",
  );
});

test("exact 350 ms paired differences are evaluated in decimal arithmetic", () => {
  const t = target("far", ["before"], 240, 246);
  const views = paired(t, [token("明日は学校へ行きます", 243.45, 244.5)]);
  for (const view of views) {
    view.requestStart = 239;
    view.requestEnd = view.requestId.endsWith("0") ? 247 : 248;
    view.segments[0].start = 239;
    view.segments[0].end = 247;
  }
  views[1].segments[0].tokens[0].start = 243.8;
  const result = buildCorrection(
    [record("before", "明日は学校へ行きます", 242, 245)],
    { targets: [t] },
    views,
  );
  assert.equal(result.changes.length, 1);
});

test("partially examined tokens remain visible when a later member is invalid", () => {
  const result = run(before(), [
    token("前", 0.2, 0.8),
    { ...token("明日は学校へ行きます"), timeStatus: "MISSING" },
  ]);
  kept(result, "LEXICAL_INTERVAL_UNAVAILABLE");
  const assessment = result.decisions[0].viewAssessments[0];
  assert.equal(assessment.accountingComplete, false);
  assert.deepEqual(
    assessment.partialAccounting.map((row) => [row.text, row.disposition]),
    [["前", "EXCLUDED_CONTEXT_BEFORE"]],
  );
});

test("extra target evidence and duplicate baseline identities fail the input contract", () => {
  assert.throws(
    () =>
      buildCorrection(
        before(),
        { targets: [] },
        paired(target(), [token("はい")]),
      ),
    /UNPLANNED_VIEW/u,
  );
  assert.throws(
    () => buildCorrection([...before(), ...before()], { targets: [] }, []),
    /BASELINE_CONTRACT/u,
  );
});
