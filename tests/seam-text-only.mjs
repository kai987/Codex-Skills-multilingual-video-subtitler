import { test } from "node:test";
import assert from "node:assert/strict";
import { proposeSeamTextOnly } from "../scripts/lib/seam-text-only.mjs";
import { includeSongs } from "../scripts/evaluate-seam-refinement.mjs";
function fixture() {
  const baseline = [
    {
      recordId: "a",
      text: "今日は駅まで歩きます",
      sourceStart: 10,
      sourceEnd: 13,
      issues: [],
      chunkIndex: 0,
    },
    {
      recordId: "b",
      text: "駅まで歩きますそして帰ります",
      sourceStart: 12,
      sourceEnd: 15,
      issues: [],
      chunkIndex: 1,
    },
  ];
  const target = {
    id: "t",
    recordIds: ["a", "b"],
    sourceStart: 10,
    sourceEnd: 15,
    shared: "駅まで歩きます",
  };
  const views = [1, 2].map((i) => ({
    requestId: `r${i}`,
    audioHash: String(i),
    start: 8,
    end: 17,
    records: [
      {
        recordId: `d${i}`,
        requestId: `r${i}`,
        text: "今日は駅まで歩きますそして帰ります",
        sourceStart: 10,
        sourceEnd: i === 1 ? 17 : 15,
        issues: [],
      },
    ],
  }));
  return { target, baseline, views };
}
test("stable whole text uses unchanged old outer times, never donor-edge timing", () => {
  const f = fixture(),
    r = proposeSeamTextOnly(f.target, f.baseline, f.views);
  assert.equal(r.status, "CANDIDATE");
  assert.deepEqual(
    [r.records[0].sourceStart, r.records[0].sourceEnd],
    [10, 15],
  );
  assert.equal(r.acousticTimingVerified, false);
});
test("orthographic conflict is not normalized away", () => {
  const f = fixture();
  f.views[1].records[0].text = "今日は駅まで歩きますそして戻ります";
  assert.equal(
    proposeSeamTextOnly(f.target, f.baseline, f.views).status,
    "ABSTAIN",
  );
});
test("unique phrase outside target time cannot substitute another occurrence", () => {
  const f = fixture();
  f.views.forEach((v) => {
    v.records[0].sourceStart = 16;
    v.records[0].sourceEnd = 17;
  });
  assert.equal(
    proposeSeamTextOnly(f.target, f.baseline, f.views).status,
    "ABSTAIN",
  );
});
test("short genuine repeated responses cannot enter text-only replacement", () => {
  const f = fixture();
  f.baseline.forEach((r) => (r.text = "はい"));
  f.target.shared = "はい";
  f.views.forEach((v) => (v.records[0].text = "はい"));
  assert.equal(
    proposeSeamTextOnly(f.target, f.baseline, f.views).status,
    "ABSTAIN",
  );
});
test("invalid intervals and same evidence rejected", () => {
  const f = fixture();
  f.views[1].audioHash = "1";
  assert.equal(
    proposeSeamTextOnly(f.target, f.baseline, f.views).status,
    "ABSTAIN",
  );
  f.views[1].audioHash = "2";
  f.views[1].records[0].sourceEnd = 10;
  assert.equal(
    proposeSeamTextOnly(f.target, f.baseline, f.views).status,
    "ABSTAIN",
  );
});
test("long repeated utterance in both views is not deduplicated", () => {
  const f = fixture();
  f.views.forEach((v) => {
    v.records[0].text = f.baseline.map((r) => r.text).join("");
  });
  assert.equal(
    proposeSeamTextOnly(f.target, f.baseline, f.views).status,
    "ABSTAIN",
  );
});
test("evaluation includes Song but not RubyDialogue or credits", () => {
  const text =
    "[Events]\nFormat: Start, End, Style, Text\nDialogue: 0:00:01.00,0:00:02.00,Song,♪ 歌 ♪\\N译文\nDialogue: 0:00:01.00,0:00:02.00,RubyDialogue,よみ\n";
  const out = includeSongs(text);
  assert(out.includes(",Dialogue, 歌 \\N译文"));
  assert(out.includes(",RubyDialogue,よみ"));
});
