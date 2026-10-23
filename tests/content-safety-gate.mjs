import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  contentSafety,
  inspectContentSafety,
} from "../scripts/lib/content-safety-gate.mjs";
import { isolatePreview } from "../scripts/subtitle-tool-content-safety.mjs";
import { refineDefaultDelivery } from "../scripts/lib/default-seam-delivery.mjs";
const row = (start, text, duration = 1) => ({
  start,
  end: start + duration,
  text,
});

test("sentence loops are detected, including the 925-cue regression, without deleting real repetitions", () => {
  const repeated = Array.from({ length: 925 }, (_, i) => ({
    ...row(i * 2, "女の人は、この後、何をしますか?", 2),
    requestId: "primary",
  }));
  const audit = contentSafety(repeated, { language: "ja" });
  assert(audit.issues.some((i) => i.code === "SENTENCE_DECODER_LOOP"));
  assert(audit.issues.some((i) => i.code === "REQUEST_SENTENCE_LOW_DIVERSITY"));
  assert.equal(audit.automaticDeletionCount, 0);
  for (const rows of [
    repeated.slice(0, 4),
    repeated.slice(0, 7).map((r, i) => ({
      ...r,
      requestId: `independent-${i}`,
      start: i * 60,
      end: i * 60 + 2,
    })),
    repeated.slice(0, 10).map((r) => ({ ...r, style: "music" })),
  ])
    assert.equal(contentSafety(rows).status, "NO_DETECTED_HIGH_RISK");
});

test("whole short-token run includes the first cue across a 3.6 second gap; confidence is not truth", () => {
  const rows = [0, 5.6, 9.6, 13.6, 15.6, 17.6, 19.6, 21.6, 23.6].map((s) => ({
    ...row(s, "ん", 2),
    probability: 1,
  }));
  const before = JSON.stringify(rows),
    audit = contentSafety(rows);
  assert.equal(audit.status, "HOLD");
  assert.deepEqual(audit.reviewCueIndexes, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(JSON.stringify(rows), before);
  assert.equal(audit.automaticDeletionCount, 0);
});
test("isolated and paired short responses, genuine repetitions and unrelated sparse responses survive", () => {
  for (const rows of [
    [row(7, "ああ"), row(27, "ああ")],
    [row(49.9, "ん"), row(51, "ん")],
    [row(1, "はい"), row(2, "はい"), row(3, "はい")],
    Array.from({ length: 7 }, (_, i) => row(i * 60, "ん")),
  ]) {
    assert.equal(contentSafety(rows).status, "NO_DETECTED_HIGH_RISK");
  }
});
test("request-level low diversity survives gaps without crossing independent request identities", () => {
  const rows = Array.from({ length: 6 }, (_, i) => ({
    ...row(i * 8, "ん"),
    requestId: "one",
  }));
  assert(
    contentSafety(rows).issues.some((r) => r.code === "REQUEST_LOW_DIVERSITY"),
  );
  assert.equal(
    contentSafety(rows.map((r, i) => ({ ...r, requestId: String(i) }))).status,
    "NO_DETECTED_HIGH_RISK",
  );
});
test("single cue degeneration, long-span duplication, template phrases are held, never proved false", () => {
  for (const rows of [
    [row(0, "んんんんんんんん")],
    [row(0, "おやすみなさい", 25), row(25, "おやすみなさい", 25)],
    [row(0, "ご視聴ありがとうございました。", 1)],
  ]) {
    const result = contentSafety(rows);
    assert.equal(result.status, "HOLD");
    assert(
      result.issues.every(
        (i) => !i.automaticRemovalAllowed && i.acousticVerdict === "unverified",
      ),
    );
  }
  assert.equal(
    contentSafety([row(0, "ご視聴ありがとうございましたと言っていた")]).status,
    "NO_DETECTED_HIGH_RISK",
  );
});
test("invalid timing holds; detector does not grant acoustic approval even with no risk", () => {
  assert.equal(contentSafety([row(1, "テスト", 0)]).status, "HOLD");
  const result = contentSafety([row(0, "ここならタバコ吸えます")]);
  assert.equal(result.machineOnlyReleaseAuthorized, false);
  assert.equal(result.acousticCorrectness, "NOT_VERIFIED");
});
test("preview preserves timing and text of remaining records and ASS style bytes", () => {
  const srt =
    "1\n00:00:00,000 --> 00:00:01,000\nん\n\n2\n00:08:53,600 --> 00:08:56,340\nここならタバコ吸えます\n\n";
  assert.equal(
    isolatePreview(srt, "srt", [0]),
    "1\n00:08:53,600 --> 00:08:56,340\nここならタバコ吸えます\n",
  );
  assert.throws(() => isolatePreview(srt, "srt", [2]), /INVALID_EXCLUSION/);
  assert.throws(
    () => isolatePreview(srt, "srt", [0, 1]),
    /EMPTY_PARTIAL_PREVIEW/,
  );
  const ass =
    "[Script Info]\nTitle: preserved\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,ん\nDialogue: 0,0:08:53.60,0:08:56.34,Human,,0,0,0,,ここならタバコ吸えます\n";
  const result = isolatePreview(ass, "ass", [0]);
  assert(result.includes("Title: preserved"));
  assert(
    result.includes(
      "Dialogue: 0,0:08:53.60,0:08:56.34,Human,,0,0,0,,ここならタバコ吸えます",
    ),
  );
  const vtt =
    "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nん\n\n00:08:53.600 --> 00:08:56.340\nここならタバコ吸えます\n";
  assert(isolatePreview(vtt, "vtt", [0]).startsWith("WEBVTT\n\n00:08:53.600"));
});
test("real delivery gate stops optional inference and preferred promotion; keeps inspectable original", async (t) => {
  const task = await fs.mkdtemp(path.join(os.tmpdir(), "safety-delivery-"));
  t.after(() => fs.rm(task, { recursive: true, force: true }));
  const raw =
    "1\n00:00:00,000 --> 00:00:25,000\nご視聴ありがとうございました\n";
  await fs.writeFile(path.join(task, "original.srt"), raw);
  let inference = 0;
  const result = await refineDefaultDelivery(
    {
      task,
      outputs: ["original.srt"],
      executionStatus: "completed",
      coverageScope: "full-audio",
      unresolvedCount: 0,
      aliasCount: 0,
    },
    { language: "ja" },
    {
      prepare: async () => {
        inference++;
        throw Error("must not run");
      },
      observe: async () => ({ status: "observed" }),
      observeCoverage: async () => ({ status: "skipped" }),
    },
  );
  assert.equal(inference, 0);
  assert.equal(result.defaultDelivery.contentSafety.status, "HOLD");
  assert.deepEqual(result.preferredOutputs, []);
  assert.deepEqual(result.defaultDelivery.inspectableOutputs, [
    path.join(task, "original.srt"),
  ]);
  assert.equal(await fs.readFile(path.join(task, "original.srt"), "utf8"), raw);
});
test("missing or empty subtitle cannot clear safety; no mutation on read-only inspection", async (t) => {
  const task = await fs.mkdtemp(path.join(os.tmpdir(), "safety-empty-"));
  t.after(() => fs.rm(task, { recursive: true, force: true }));
  await assert.rejects(inspectContentSafety([]), /SRT_REQUIRED/);
  const file = path.join(task, "empty.srt");
  await fs.writeFile(file, "");
  await assert.rejects(inspectContentSafety([file]), /EMPTY_SUBTITLES/);
});
