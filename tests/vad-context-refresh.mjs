import test from "node:test";
import assert from "node:assert/strict";
import {
  refreshItem,
  runRefresh,
} from "../scripts/subtitle-tool-vad-context-refresh.mjs";
import { reviewAnchoredActivity } from "../scripts/lib/anchored-activity-review.mjs";
function fixture() {
  const input = {
    sourceWindow: { start: 10, end: 14 },
    originalTarget: { start: 11, end: 11.3 },
    activityWindow: { start: 10.5, end: 12.5 },
    anchor: { start: 12.4, end: 12.425 },
    donor: { start: 12, end: 14, text: "ああ" },
    greedyText: "ああ。",
    vadIntervals: [{ start: 12.3, end: 12.5 }],
    baseline: [],
  };
  return {
    targetId: "clip-1",
    input,
    review: reviewAnchoredActivity(input),
    playback: {
      file: "clip.wav",
      sourceStart: 10,
      sourceEnd: 14,
      sha256: "a".repeat(64),
    },
  };
}
test("reuses entire audio and makes the CTC anchor diagnostic target", () => {
  const s = fixture(),
    item = refreshItem([s], "/run");
  assert.equal(item.frames, 64000);
  assert.equal(item.start, 10);
  assert.equal(item.end, 14);
  assert(Math.abs(item.localTargetStart - 2.4) < 1e-6);
});
test("refuses more than one target or more than five seconds", () => {
  const s = fixture();
  assert.throws(() => refreshItem([s, s], "/run"));
  s.input.sourceWindow.end = 16;
  s.playback.sourceEnd = 16;
  s.review = reviewAnchoredActivity(s.input);
  assert.throws(() => refreshItem([s], "/run"), /FIVE_SECOND_LIMIT/u);
});
test("rejects stale review and escaping audio path", () => {
  const s = fixture();
  s.review.rightCensored = false;
  assert.throws(() => refreshItem([s], "/run"));
  const t = fixture();
  t.playback.file = "../clip.wav";
  assert.throws(() => refreshItem([t], "/run"));
});
test("no extra input means no legitimate change to the original cut-off", () => {
  const s = fixture();
  assert.equal(s.review.rightCensored, true);
  const full = reviewAnchoredActivity({
    ...s.input,
    activityWindow: { start: 10, end: 14 },
    vadIntervals: [{ start: 12.3, end: 12.8 }],
  });
  assert.equal(full.rightCensored, false);
  assert.equal(full.subtitleInterval, null);
  assert.equal(full.subtitleMutationAuthorized, false);
});
test("permission checked before file/model access", async () => {
  let called = false;
  await assert.rejects(
    runRefresh("/missing", false, {
      run: () => {
        called = true;
      },
    }),
    /LOCAL_AUTHORIZATION_REQUIRED/u,
  );
  assert.equal(called, false);
});
