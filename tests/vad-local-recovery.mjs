import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  planLocalRecovery,
  decideLocalRecovery,
  assembleLocalRecovery,
} from "../scripts/lib/vad-local-recovery.mjs";
import {
  reserveRecovery,
  runRecovery,
} from "../scripts/subtitle-tool-vad-local-recovery.mjs";
import { referenceSubset } from "../scripts/evaluate-vad-local-recovery.mjs";
import { compareReference } from "../scripts/lib/subtitle-reference-comparison.mjs";
const baseline = [
  { id: "before", start: 0, end: 2, text: "こんにちは" },
  { id: "after", start: 7, end: 9, text: "ありがとう" },
];
const probe = {
  id: "clip-1",
  start: 2,
  end: 7,
  targetStart: 4,
  targetEnd: 5,
  hostIds: [],
};
const pair = (text = "はい") =>
  ["whisper", "kotoba"].map((backend) => ({
    backend,
    records: [{ start: 4, end: 4.8, text }],
  }));
const vad = [{ start: 3.9, end: 4.9 }];
test("post-freeze evaluator separates DialogueTop and Song, excluding translations and ruby", () => {
  const ass = [
    "[Events]",
    "Format: Layer, Start, End, Style, Text",
    "Dialogue: 0,0:00:01.00,0:00:02.00,Dialogue,はい\\N中文",
    "Dialogue: 0,0:00:03.00,0:00:04.00,DialogueTop,ええ",
    "Dialogue: 0,0:00:05.00,0:00:06.00,Song,うた",
    "Dialogue: 0,0:00:01.00,0:00:02.00,RubyDialogue,は",
  ].join("\n");
  const compare = (mode) =>
    compareReference({
      referenceAss: referenceSubset(ass, mode),
      baselineRecords: [],
      candidateRecords: [],
      windows: [{ id: "full", kind: "whole-source", start: 0, end: 10 }],
    });
  assert.equal(
    compare("dialogue").perWindow[0].reference.normalizedText,
    "はいええ",
  );
  assert.equal(compare("song").perWindow[0].reference.normalizedText, "うた");
  assert.equal(compare("combined").counts.reference, 3);
});
test("evaluation keeps unchanged candidate metrics unchanged", () => {
  const ass =
    "[Events]\nFormat: Layer, Start, End, Style, Text\nDialogue: 0,0:00:01.00,0:00:02.00,Dialogue,はい";
  const rows = [{ start: 1, end: 2, text: "はい" }];
  const r = compareReference({
    referenceAss: referenceSubset(ass, "dialogue"),
    baselineRecords: rows,
    candidateRecords: rows,
    windows: [
      { id: "clip", kind: "machine-selected-local-crop", start: 0, end: 3 },
    ],
  }).perWindow[0];
  assert.equal(r.window.id, "clip");
  assert.deepEqual(r.baseline.edit, r.candidate.edit);
});
test("paired localized gap speech creates insertion candidate, preserving all baseline fields", () => {
  const d = decideLocalRecovery(probe, baseline, pair(), vad);
  assert.equal(d.status, "CANDIDATE");
  const c = assembleLocalRecovery(baseline, [d]);
  assert.equal(c.length, 3);
  assert.deepEqual(
    c.filter((r) => !r.id.startsWith("local-")),
    baseline,
  );
  assert.equal(d.acousticTimingVerified, false);
});
test("host cues cannot be replaced from partial crops", () => {
  assert.equal(
    decideLocalRecovery(
      { ...probe, hostIds: ["before"] },
      baseline,
      pair(),
      vad,
    ).reason,
    "EXISTING_CUE_COLLISION_OR_CONTINUATION",
  );
});
test("neighbor text continuation is not inserted again", () => {
  const b = [
    { ...baseline[0], end: 3, text: "はい、わかりました" },
    baseline[1],
  ];
  assert.equal(
    decideLocalRecovery(probe, b, pair(), vad).reason,
    "POSSIBLE_NEIGHBOR_CONTINUATION_OR_REPEAT",
  );
});
test("text conflict, bad time and crop-edge donors abstain", () => {
  const v = pair();
  v[1].records[0].text = "ああ";
  assert.equal(
    decideLocalRecovery(probe, baseline, v, vad).reason,
    "TEXT_CONFLICT",
  );
  v[1].records[0] = { start: 6, end: 5, text: "はい" };
  assert.equal(
    decideLocalRecovery(probe, baseline, v, vad).reason,
    "INVALID_DONOR_TIMING",
  );
  const edge = pair();
  edge.forEach((v) => {
    v.records[0].start = 2;
  });
  assert.equal(
    decideLocalRecovery(probe, baseline, edge, vad).reason,
    "CROP_EDGE",
  );
});
test("only target-overlapping cues compete; ambiguity and context-only donors abstain", () => {
  const v = pair();
  v[0].records.push({ start: 4.9, end: 5, text: "え" });
  assert.equal(
    decideLocalRecovery(probe, baseline, v, vad).reason,
    "TARGET_NOT_SINGLE_LOCALIZED_CUE",
  );
  const context = pair();
  context.forEach((v) => {
    v.records[0].start = 5.1;
    v.records[0].end = 6;
  });
  assert.equal(
    decideLocalRecovery(probe, baseline, context, vad).reason,
    "TARGET_NOT_SINGLE_LOCALIZED_CUE",
  );
});
test("timing agreement and activity support are separate guards", () => {
  const v = pair();
  v[1].records[0].end = 5.2;
  assert.equal(
    decideLocalRecovery(probe, baseline, v, vad).reason,
    "TIMING_CONFLICT",
  );
  assert.equal(
    decideLocalRecovery(probe, baseline, pair(), [{ start: 3, end: 3.9 }])
      .reason,
    "INSUFFICIENT_DONOR_ACTIVITY_SUPPORT",
  );
});
test("competing insertions cannot create a new overlap", () => {
  const a = decideLocalRecovery(probe, baseline, pair(), vad);
  const b = { ...a, insertions: [{ ...a.insertions[0], id: "different" }] };
  assert.throws(() => assembleLocalRecovery(baseline, [a, b]), /COLLISION/u);
});
test("selection prioritizes gaps, bounded by four targets without labels", () => {
  const rows = Array.from({ length: 9 }, (_, i) => ({
    id: `clip-${i + 1}`,
    targetStart: 20 + 10 * i,
    targetEnd: 21 + 10 * i,
    state: i === 8 ? "unsupported" : "supported",
  }));
  const b = [...baseline, { id: "host", start: 19, end: 22, text: "既存" }];
  const p = planLocalRecovery({ rows }, b, 120);
  assert.equal(p.probes.length, 4);
  assert.deepEqual(
    p.probes.map((r) => r.id),
    ["clip-2", "clip-3", "clip-4", "clip-5"],
  );
  assert.equal(p.unsupportedRetainedIds.length, 1);
  assert.equal(p.deferred.length, 4);
  rows.forEach((r) => {
    r.humanLabel = "noise";
  });
  assert.deepEqual(planLocalRecovery({ rows }, b, 120), p);
});
test("invalid sources, oversized or overlapping requests cannot dispatch", () => {
  assert.throws(() =>
    planLocalRecovery({ rows: [] }, [{ ...baseline[0], end: NaN }], 120),
  );
  const rows = [
    { id: "clip-1", targetStart: 20, targetEnd: 30, state: "partial" },
    { id: "clip-2", targetStart: 40, targetEnd: 41, state: "supported" },
    { id: "clip-3", targetStart: 41, targetEnd: 42, state: "supported" },
  ];
  const p = planLocalRecovery({ rows }, baseline, 120);
  assert.equal(p.probes.length, 1);
  assert.deepEqual(p.deferred.map((r) => r.reason).sort(), [
    "CROP_BUDGET",
    "OVERLAPPING_REQUEST",
  ]);
});
test("exclusive reservation enforces authorization, total budget and no rerun", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "local-recovery-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const p = { probes: [{ frames: 80000 }] };
  await assert.rejects(
    reserveRecovery(root, p, false),
    /AUTHORIZATION|AUTHORIZE/u,
  );
  await assert.rejects(
    reserveRecovery(root, { probes: [{ frames: 9 * 16000 }] }, true),
    /BUDGET/u,
  );
  await reserveRecovery(root, p, true);
  await assert.rejects(reserveRecovery(root, p, true), /EEXIST/u);
  await assert.rejects(
    runRecovery(root, false, {
      run() {
        throw Error("MUST_NOT_DISPATCH");
      },
    }),
    /AUTHORIZE/u,
  );
});
