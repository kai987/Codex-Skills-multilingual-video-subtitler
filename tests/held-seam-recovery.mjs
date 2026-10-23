import test from "node:test";
import assert from "node:assert/strict";
import { recoverHeldSeams } from "../scripts/lib/held-seam-recovery.mjs";
const text = "今日は駅まで歩きますそして帰ります";
function fixture() {
  const row = (recordId, text, sourceStart, sourceEnd, requestId = "base") => ({
    recordId,
    text,
    sourceStart,
    sourceEnd,
    requestId,
    issues: [],
    chunkIndex: 0,
    order: 1,
  });
  return {
    baseline: [
      row("a", "今日は駅まで歩きます", 10, 13),
      row("b", "駅まで歩きますそして帰ります", 12, 15),
      row("risk", "ご視聴ありがとうございました", 50, 55),
    ],
    targets: [
      {
        id: "t",
        sourceStart: 10,
        sourceEnd: 15,
        recordIds: ["a", "b"],
        shared: "駅まで歩きます",
      },
    ],
    views: [1, 2].map((i) => ({
      targetId: "t",
      requestId: `r${i}`,
      audioHash: String(i),
      start: 10 - i,
      end: 15 + i,
      records: [row(`donor${i}`, text, 10, 15, `r${i}`)],
    })),
  };
}
test("distant HOLD does not block a cached whole-dialogue candidate or authorize release", () => {
  const f = fixture(),
    before = globalThis.structuredClone(f),
    r = recoverHeldSeams(f);
  assert.equal(r.changedTargets, 1);
  assert.equal(r.candidateCueCount, 2);
  assert.equal(r.candidate[0].text, text);
  assert.deepEqual(
    [r.candidate[0].sourceStart, r.candidate[0].sourceEnd],
    [10, 15],
  );
  assert.deepEqual(r.candidate[1], f.baseline[2]);
  assert.equal(r.finalSafety.status, "HOLD");
  assert.deepEqual(r.preferredOutputs, []);
  assert.equal(r.automaticPromotionAllowed, false);
  assert.equal(r.newInference, 0);
  assert.deepEqual(f, before);
});
test("risk in request padding blocks even if target itself is clean", () => {
  const f = fixture();
  Object.assign(f.baseline[2], { sourceStart: 8.2, sourceEnd: 9.2 });
  const r = recoverHeldSeams(f);
  assert.equal(r.changedTargets, 0);
  assert.equal(r.decisions[0].reason, "RISK_INTERSECTS_REQUEST_CONTEXT");
});
test("unlocalized invalid timing blocks every local repair", () => {
  const f = fixture();
  f.baseline[2].sourceEnd = NaN;
  assert.equal(
    recoverHeldSeams(f).decisions[0].reason,
    "UNLOCALIZED_BASELINE_RISK",
  );
});
test("risky donor is not accepted just because baseline target is clean", () => {
  const f = fixture();
  f.views[0].records[0].text = "ご視聴ありがとうございました";
  assert.equal(
    recoverHeldSeams(f).decisions[0].reason,
    "CACHED_DONOR_CONTENT_RISK",
  );
});
test("text conflict still abstains without fuzzy spelling repair", () => {
  const f = fixture();
  f.views[1].records[0].text = text.replace("駅", "海");
  assert.equal(recoverHeldSeams(f).changedTargets, 0);
});
test("declared songs are not passed through dialogue dedup", () => {
  const f = fixture();
  f.views[0].records[0].style = "music";
  assert.equal(
    recoverHeldSeams(f).decisions[0].reason,
    "DECLARED_MUSIC_REQUIRES_SEPARATE_PATH",
  );
});
test("one cached view cannot buy a fresh request", () => {
  const f = fixture();
  f.views.pop();
  const r = recoverHeldSeams(f);
  assert.equal(r.changedTargets, 0);
  assert.equal(r.newInference, 0);
});
test("two copies of one audio request cannot fake corroboration", () => {
  const f = fixture();
  f.views[1].audioHash = f.views[0].audioHash;
  assert.equal(recoverHeldSeams(f).changedTargets, 0);
});
test("unrelated clean cue is preserved field for field", () => {
  const f = fixture();
  const other = {
    ...f.baseline[0],
    recordId: "later",
    sourceStart: 60,
    sourceEnd: 65,
  };
  f.baseline.push(other);
  const r = recoverHeldSeams(f);
  assert.deepEqual(
    r.candidate.find((x) => x.recordId === "later"),
    other,
  );
});
test("duplicate input identifiers fail closed", () => {
  const f = fixture();
  f.baseline.push(f.baseline[0]);
  assert.throws(() => recoverHeldSeams(f), /DUPLICATE_BASELINE_ID/);
});
