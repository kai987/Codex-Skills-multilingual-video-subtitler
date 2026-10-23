import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import {
  pcmEvidence,
  auditAudioSupport,
  assessReplacement,
} from "../scripts/lib/recovery-evidence-guard.mjs";
import { contentSafety } from "../scripts/lib/content-safety-gate.mjs";
const pcm = (seconds = 30) => ({
  sampleRate: 16000,
  frames: seconds * 16000,
  data: Buffer.alloc(seconds * 32000, 1),
});
const plan = { firstFrame: 0, effectiveRange: { start: 0 } };
const row = (id, sourceStart, sourceEnd, text) => ({
  recordId: id,
  sourceStart,
  sourceEnd,
  text,
});
const safe = { issues: [] };

test("strict zero evidence never treats low signal or a single nonzero sample as absent", () => {
  const p = pcm(2);
  p.data.fill(0);
  assert.equal(pcmEvidence(p, 0, p.frames).allSamplesExactlyZero, true);
  p.data.writeInt16LE(1, 20);
  const e = pcmEvidence(p, 0, p.frames);
  assert.equal(e.allSamplesExactlyZero, false);
  assert.equal(e.firstNonzeroFrame, 10);
  assert.equal(e.speechPresence, "NOT_CLASSIFIED");
  assert.throws(() => pcmEvidence(p, -1, p.frames), /INVALID/);
  assert.throws(() => pcmEvidence(p, 0, p.frames + 1), /INVALID/);
});

test("long leading/trailing/internal digital zeros hold display without inventing boundaries", () => {
  for (const [s, e] of [
    [0, 3],
    [3, 6],
    [6, 10],
  ]) {
    const p = pcm(10);
    p.data.fill(0, s * 32000, e * 32000);
    const rows = [row("number", 100, 110, "2番")];
    const before = JSON.stringify(rows);
    const a = auditAudioSupport(rows, p, {
      firstFrame: 0,
      effectiveRange: { start: 100 },
    });
    assert.equal(a.status, "HOLD");
    assert.equal(a.issues[0].code, "LONG_DIGITAL_ZERO_DISPLAY");
    assert.equal(JSON.stringify(rows), before);
  }
});

test("text risk clearance cannot excuse deletion of a neighboring correct sentence", () => {
  const p = pcm();
  const before = [
    row("loop", 0, 10, "んんんんんんんん"),
    row("neighbor", 10, 15, "次の駅で降ります"),
  ];
  const after = [row("new", 0, 15, "別の内容です")];
  const r = assessReplacement(before, after, p, plan, {
    issues: [{ code: "SINGLE_CHARACTER_DECODER_LOOP", recordIds: ["loop"] }],
  });
  assert.equal(r.status, "HOLD");
  assert(
    r.issues.some(
      (i) => i.code === "UNEXPLAINED_TEXT_LOSS" && i.recordId === "neighbor",
    ),
  );
  assert.equal(r.changes[0].textStatus, "risk-text-replaced");
});

test("large timing shrink with retained text still holds if signal was dropped", () => {
  const p = pcm();
  const before = [row("a", 0, 20, "お疲れ様です")],
    after = [row("b", 18, 20, "お疲れ様です")];
  assert.equal(assessReplacement(before, after, p, plan, safe).status, "HOLD");
  p.data.fill(0, 0, 18 * 32000);
  const r = assessReplacement(before, after, p, plan, safe);
  assert.equal(r.status, "NO_DETECTED_REGRESSION");
  assert.equal(
    r.changes[0].uncoveredIntervals[0].evidence.allSamplesExactlyZero,
    true,
  );
  assert.equal(r.acousticCorrectness, "NOT_VERIFIED");
});

test("legitimate occurrences cannot all be satisfied by one distant equal sentence", () => {
  const before = [0, 6, 12, 18].map((s, i) =>
    row(String(i), s, s + 2, "天気がいいから散歩しましょう"),
  );
  const r = assessReplacement(
    before,
    [row("one", 0, 2, before[0].text)],
    pcm(),
    plan,
    safe,
  );
  assert.equal(r.status, "HOLD");
  assert.equal(
    r.changes.filter((c) => c.textStatus === "unverified-removal").length,
    3,
  );
  const long = assessReplacement(
    before,
    [row("long", 0, 20, before[0].text)],
    pcm(),
    plan,
    safe,
  );
  assert(long.issues.some((i) => i.code === "OCCURRENCE_COUNT_LOSS"));
});

test("N1 contained seams remain held without same-occurrence evidence; no blanket dedup", () => {
  for (const [prefix, full, start, end] of [
    [
      "専門家が",
      "専門家が高齢者に趣味を進める一番の理由は何ですか",
      874.38,
      879.1,
    ],
    ["給与は", "給与はもちろん載せるんですが", 1074.38, 1085.3],
    ["そう", "そうですね同じことをしてもね", 2299.7, 2309.86],
  ]) {
    const rows = [
      { id: "left", start, end: start + 0.92, text: prefix },
      { id: "right", start: start + 0.32, end, text: full },
    ];
    const copy = JSON.stringify(rows);
    const a = contentSafety(rows, { language: "ja" });
    assert(
      a.issues.some(
        (i) => i.code === "OVERLAPPING_TEXT_CONTAINMENT_REQUIRES_AUDIO",
      ),
    );
    assert.equal(a.automaticDeletionCount, 0);
    assert.equal(JSON.stringify(rows), copy);
  }
});

test("range offsets are applied once; unexplained invalid ranges fail closed", () => {
  const p = pcm(30);
  p.data.fill(0, 10 * 32000, 12 * 32000);
  const offsetPlan = { firstFrame: 10 * 16000, effectiveRange: { start: 110 } };
  const before = [row("a", 110, 115, "テスト")],
    after = [row("b", 112, 115, "テスト")];
  assert.equal(
    assessReplacement(before, after, p, offsetPlan, safe).status,
    "NO_DETECTED_REGRESSION",
  );
  assert.equal(
    auditAudioSupport([row("bad", 99, 101, "テスト")], p, offsetPlan).status,
    "HOLD",
  );
});
