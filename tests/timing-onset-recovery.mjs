import test from "node:test";
import assert from "node:assert/strict";
import {
  planOnsets,
  decideOnset,
  applyOnsets,
  accountOnsetContinuation,
} from "../scripts/lib/timing-onset-recovery.mjs";
const row = {
  recordId: "a",
  text: "今日は晴れです",
  sourceStart: 10,
  sourceEnd: 16,
  localStart: 0,
  issues: [],
};
const target = () => planOnsets([row], [1], 30).targets[0];
test("continuation preserves explicit prior crash accounting and rejects changed targets", () => {
  const t = target();
  const prior = { planned: { targets: [t] } };
  const audit = {
    status: "blocked-word-timing-runtime-contract",
    asrAttempted: 1,
    asrCompleted: 0,
    vadAttempted: 0,
    retries: 0,
    targets: [{ id: t.id, status: "ASR_CRASHED_BEFORE_RESULT" }],
  };
  const exit = { exitCode: null, signal: "SIGSEGV" };
  const count = accountOnsetContinuation([t], prior, audit, exit);
  assert.deepEqual(count.explicitRetryTargets, [t.id]);
  assert.equal(count.cumulativePlannedAsrAttempts, 2);
  assert.equal(count.automaticRetries, 0);
  assert.throws(
    () => accountOnsetContinuation([{ ...t, oldStart: 9 }], prior, audit, exit),
    /CONTINUATION_TARGET_CHANGED/,
  );
  assert.throws(() =>
    accountOnsetContinuation([t], prior, { ...audit, asrAttempted: 0 }, exit),
  );
  assert.throws(() =>
    accountOnsetContinuation(
      [t],
      prior,
      { ...audit, targets: [{ id: t.id, status: "NOT_DISPATCHED" }] },
      exit,
    ),
  );
});
function raw() {
  return {
    id: "cue-1",
    frames: 112000,
    language: "ja",
    segments: [
      {
        text: row.text,
        words: [
          { word: "今日は", start: 3, end: 4, probability: 0.9 },
          { word: "晴れです", start: 4, end: 6, probability: 0.9 },
        ],
      },
    ],
    vad: {
      rawUnit: "CENTISECONDS",
      sampleRate: 16000,
      inputFrames: 112000,
      device: "cpu",
      stateIsolation: "WHISPER_VAD_DETECT_SPEECH_RESETS_LSTM",
      rawIntervals: [{ start: 295, end: 620 }],
    },
  };
}
test("only start changes, using conservative padding; text and end remain identical", () => {
  const d = decideOnset(target(), raw());
  assert.equal(d.status, "CANDIDATE");
  assert.equal(d.newStart, 12.3);
  const b = [row, { ...row, recordId: "b", sourceStart: 17, sourceEnd: 20 }];
  const c = applyOnsets(b, [d]);
  assert.deepEqual(c[0], { ...row, sourceStart: 12.3 });
  assert.deepEqual(c[1], b[1]);
  assert.equal(row.sourceStart, 10);
});
for (const [name, mutation, reason] of [
  [
    "unverified VAD state reset",
    (r) => {
      delete r.vad.stateIsolation;
    },
    "INVALID_VAD",
  ],
  [
    "wrong identity",
    (r) => {
      r.id = "other";
    },
    "UNBOUND_RESPONSE",
  ],
  [
    "wrong clock unit",
    (r) => {
      r.vad.rawUnit = "SECONDS";
    },
    "INVALID_VAD",
  ],
  [
    "incomplete words",
    (r) => {
      r.segments[0].text += "違う";
    },
    "WORD_TEXT_COVERAGE",
  ],
  [
    "lexical conflict",
    (r) => {
      r.segments[0].words[0].word = "明日は";
      r.segments[0].text = "明日は晴れです";
    },
    "NO_UNIQUE_EXACT_WHOLE_WORD_TEXT",
  ],
  [
    "unreliable probability",
    (r) => {
      r.segments[0].words[0].probability = 0.2;
    },
    "WEAK_LEXICAL_SUPPORT",
  ],
  [
    "other speech before target",
    (r) => {
      r.vad.rawIntervals.unshift({ start: 100, end: 150 });
    },
    "PRECEDING_SPEECH_CONFLICT",
  ],
  [
    "boundary disagreement",
    (r) => {
      r.vad.rawIntervals[0].start = 250;
    },
    "ONSET_EVIDENCE_DISAGREES",
  ],
  [
    "tail beyond unchanged end",
    (r) => {
      r.segments[0].words[1].end = 6.7;
    },
    "UNCHANGED_END_WOULD_TRUNCATE",
  ],
  [
    "crop pinned",
    (r) => {
      r.segments[0].words[0].start = 0;
    },
    "CROP_EDGE",
  ],
  [
    "zero word duration",
    (r) => {
      r.segments[0].words[0].end = 3;
    },
    "INVALID_WORD_TIMES",
  ],
  [
    "negative VAD is not deletion authority",
    (r) => {
      r.vad.rawIntervals = [];
    },
    "ONSET_EVIDENCE_DISAGREES",
  ],
])
  test(name, () => {
    const r = raw();
    mutation(r);
    const d = decideOnset(target(), r);
    assert.equal(d.status, "ABSTAIN");
    assert.equal(d.reason, reason);
    assert.deepEqual(applyOnsets([row], [d]), [row]);
  });
test("repeated exact phrase at two occurrences is ambiguous", () => {
  const r = raw();
  r.segments[0].words = [
    { word: row.text, start: 1, end: 2, probability: 0.9 },
    { word: row.text, start: 3, end: 5, probability: 0.9 },
  ];
  r.segments[0].text = row.text + row.text;
  assert.equal(
    decideOnset(target(), r).reason,
    "NO_UNIQUE_EXACT_WHOLE_WORD_TEXT",
  );
});
test("budgets and duplicate/stale applications fail closed", () => {
  assert.throws(() => planOnsets([row], [1, 1], 30));
  assert.throws(() => planOnsets([row], [1, 2, 3, 4, 5], 30));
  assert.throws(
    () => planOnsets([{ ...row, sourceEnd: 40 }], [1], 50),
    /WINDOW_BUDGET/u,
  );
  const d = decideOnset(target(), raw());
  assert.throws(() => applyOnsets([row], [d, d]), /DUPLICATE/u);
  assert.throws(
    () => applyOnsets([{ ...row, sourceStart: 11 }], [d]),
    /STALE/u,
  );
  assert.throws(
    () => applyOnsets([row], [{ ...d, unchangedEnd: 17 }]),
    /END_CHANGED/u,
  );
});
test("source offset appears once in crop frame calculation", () => {
  const p = planOnsets([row], [1], 30, 5);
  assert.equal(p.targets[0].firstFrame, 72000);
  assert.equal(p.targets[0].start, 9.5);
  assert.equal(p.totalModelSeconds, 14);
});
