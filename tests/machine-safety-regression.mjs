/** Known development examples, not an unseen-episode accuracy benchmark. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { contentSafety } from "../scripts/lib/content-safety-gate.mjs";
import { refineDefaultDelivery } from "../scripts/lib/default-seam-delivery.mjs";
const row = (start, end, text, style) => ({
  start,
  end,
  text,
  ...(style ? { style } : {}),
});
const codes = (r, language = "ja") =>
  contentSafety(r, { language }).issues.map((i) => i.code);

test("confirmed environment me series is flagged despite intervening short cue", () => {
  const r = [
    row(224.7, 227.7, "me"),
    row(233.22, 236.22, "ん"),
    row(243.3, 246.3, "me"),
    row(247.3, 250.3, "me"),
  ];
  const audit = contentSafety(r, { language: "ja" });
  assert.deepEqual(
    audit.issues.find((i) => i.code === "RECURRING_FOREIGN_SHORT_TOKEN")
      .cueIndexes,
    [0, 2, 3],
  );
  assert.equal(audit.automaticDeletionCount, 0);
});
test("foreign-token rule is not a me whitelist, nor an English/name filter", () => {
  const series = [row(10, 11, "ok"), row(20, 21, "OK"), row(30, 31, "ok")];
  assert(codes(series).includes("RECURRING_FOREIGN_SHORT_TOKEN"));
  for (const language of ["en", null])
    assert(!codes(series, language).includes("RECURRING_FOREIGN_SHORT_TOKEN"));
  for (const r of [
    [row(10, 11, "me")],
    [row(10, 11, "AI")],
    [row(10, 11, "PCを使う")],
    [row(0, 1, "me"), row(60, 61, "me"), row(120, 121, "me")],
  ])
    assert(!codes(r).includes("RECURRING_FOREIGN_SHORT_TOKEN"));
});
test("single long sparse phrase is held without requiring duplicate phrase", () => {
  const r = [row(299.7, 325.3, "おやすみなさい")];
  assert(codes(r).includes("SPARSE_LONG_DIALOGUE_REQUIRES_AUDIO"));
  assert(
    codes([row(0, 25, "こんにちは")]).includes(
      "SPARSE_LONG_DIALOGUE_REQUIRES_AUDIO",
    ),
  );
  assert(
    !codes([row(0, 2, "おやすみなさい")]).includes(
      "SPARSE_LONG_DIALOGUE_REQUIRES_AUDIO",
    ),
  );
});
test("mixed decoder run is identified without copying the correct human wording", () => {
  assert(
    codes([
      row(
        593.58,
        600.3,
        "ああああああ ちょいちょいいいちょうだいよそのために飲んだんだから",
      ),
    ]).includes("EMBEDDED_KANA_DECODER_RUN"),
  );
  assert(
    codes([row(1, 4, "うううううう 今日は帰る")]).includes(
      "EMBEDDED_KANA_DECODER_RUN",
    ),
  );
  for (const text of [
    "ああ",
    "ああああああ",
    "ふ",
    "ん？",
    "ちょいちょい",
    "ぐだぐだぐだぐだぐだぐだ",
  ])
    assert(!codes([row(1, 2, text)]).includes("EMBEDDED_KANA_DECODER_RUN"));
});
test("same-span fragment overlap is held; true separated repeats survive", () => {
  assert(
    codes([
      row(1, 2, "それは"),
      row(1.5, 3, "それはポイントカードで以前から"),
      row(2, 2.3, "それは"),
    ]).includes("OVERLAPPING_TEXT_CONTAINMENT_REQUIRES_AUDIO"),
  );
  for (const r of [
    [row(1, 2, "ああ"), row(2, 3, "ああ")],
    [row(7, 8, "ああ"), row(27, 28, "ああ")],
  ])
    assert.equal(contentSafety(r).status, "NO_DETECTED_HIGH_RISK");
});
test("music and actual short vocalizations are not erased by new rules", () => {
  const cases = [
    row(1, 25, "♪ ああ ♪"),
    row(30, 55, "ああ", "music"),
    row(68, 69.58, "ああ"),
    row(49.9, 50.3, "ふ"),
  ];
  const before = JSON.stringify(cases),
    audit = contentSafety(cases, { language: "ja" });
  assert.equal(audit.status, "NO_DETECTED_HIGH_RISK");
  assert.equal(JSON.stringify(cases), before);
});
test("known lexical errors without machine evidence are not magically corrected", () => {
  const r = [
    row(1, 3, "ほうれん草がなってないんだよ"),
    row(4, 6, "山田さんお休みか体験しちゃったのか"),
  ];
  const before = JSON.stringify(r),
    audit = contentSafety(r, { language: "ja" });
  assert.equal(JSON.stringify(r), before);
  assert.equal(audit.acousticCorrectness, "NOT_VERIFIED");
  assert.equal(audit.machineOnlyReleaseAuthorized, false);
});
test("fresh-default wiring carries language and holds foreign-token risks before inference", async (t) => {
  const task = await fs.mkdtemp(path.join(os.tmpdir(), "machine-risk-wiring-"));
  t.after(() => fs.rm(task, { recursive: true, force: true }));
  const srt =
    "1\n00:00:01,000 --> 00:00:02,000\nme\n\n2\n00:00:10,000 --> 00:00:11,000\nme\n\n3\n00:00:20,000 --> 00:00:21,000\nme\n";
  await fs.writeFile(path.join(task, "draft.srt"), srt);
  let prepares = 0;
  const result = await refineDefaultDelivery(
    {
      task,
      outputs: ["draft.srt"],
      executionStatus: "completed",
      coverageScope: "full-audio",
      unresolvedCount: 0,
      aliasCount: 0,
    },
    { language: "ja" },
    {
      prepare: async () => {
        prepares++;
        throw Error("SHOULD_NOT_RUN");
      },
      observe: async () => ({ status: "not-selected" }),
      observeCoverage: async () => ({ status: "not-selected" }),
    },
  );
  assert.equal(prepares, 0);
  assert.equal(result.preferredOutputs.length, 0);
  assert.equal(result.defaultDelivery.contentSafety.language, "ja");
  assert.equal(await fs.readFile(path.join(task, "draft.srt"), "utf8"), srt);
});
