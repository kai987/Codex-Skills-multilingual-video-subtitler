import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  planComponentCrops,
  compareComponentCrops,
} from "../scripts/lib/component-crop-contrast.mjs";
import {
  reserveComponentContrast,
  runComponentContrast,
} from "../scripts/subtitle-tool-component-contrast.mjs";
function fixture() {
  const parent = {
    referenceUsed: false,
    labelsUsed: false,
    baseline: [],
    probes: [{ id: "x", start: 10, end: 18, targetStart: 12, targetEnd: 14 }],
    selected: { deferred: [], unsupportedRetainedIds: [] },
    vadObservations: [
      {
        id: "x",
        sourceIntervals: [
          { start: 11.8, end: 12.5 },
          { start: 13.4, end: 14.1 },
        ],
      },
    ],
  };
  const views = ["whisper", "kotoba"].map((backend) => ({
    targetId: "x",
    backend,
    records: [{ start: 10, end: 16, text: "これは話です" }],
  }));
  return { parent, views };
}
test("only target-overlapping components form context crops, with exact sample budget", () => {
  const { parent, views } = fixture(),
    p = planComponentCrops(parent, views, ["x"]);
  assert.equal(p.crops.length, 2);
  assert.equal(p.requests, 4);
  assert.equal(p.crops[0].start, 11.05);
  assert.equal(p.crops[0].end, 13.25);
  assert.equal(p.policy.prompt, null);
  assert.equal(p.policy.retries, 0);
  assert.ok(p.crops.every((c) => Number.isInteger(c.frames)));
});
test("stable text-only targets do not spend a fresh ASR budget", () => {
  const { parent, views } = fixture();
  parent.vadObservations[0].sourceIntervals = [{ start: 12, end: 14 }];
  assert.throws(
    () => planComponentCrops(parent, views, ["x"]),
    /NOT_TEXT_LOCALIZATION/,
  );
});
test("duplicate, unknown and excessive targets fail before preparation", () => {
  const { parent, views } = fixture();
  assert.throws(
    () => planComponentCrops(parent, views, ["x", "x"]),
    /TARGET_BUDGET/,
  );
  assert.throws(
    () => planComponentCrops(parent, views, ["z"]),
    /UNKNOWN_TARGET/,
  );
  assert.throws(
    () => planComponentCrops(parent, views, ["a", "b", "c", "d"]),
    /TARGET_BUDGET/,
  );
});
test("same text at crop edge remains timing-unverified, never a subtitle insertion", () => {
  const { parent, views } = fixture(),
    plan = planComponentCrops(parent, views, ["x"]);
  const fresh = plan.crops.flatMap((c) =>
    ["whisper", "kotoba"].map((backend) => ({
      targetId: c.id,
      backend,
      records: [{ start: c.start, end: c.end, text: "はい" }],
    })),
  );
  const r = compareComponentCrops(plan, parent, views, fresh);
  assert.equal(r.summary.pairedTextAgreement, 2);
  assert.equal(r.summary.automaticInsertions, 0);
  assert.ok(
    r.rows.every((x) => x.status === "text-agreement-timing-unverified"),
  );
});
test("invalid and empty fresh output are retained, not silently repaired", () => {
  const { parent, views } = fixture(),
    plan = planComponentCrops(parent, views, ["x"]);
  const fresh = plan.crops.flatMap((c) =>
    ["whisper", "kotoba"].map((backend, i) => ({
      targetId: c.id,
      backend,
      records: i ? [] : [{ start: c.end, end: c.start, text: "不正" }],
    })),
  );
  const r = compareComponentCrops(plan, parent, views, fresh);
  assert.equal(r.summary.invalidTiming, 2);
  assert.equal(r.summary.pairedTextAgreement, 0);
  assert.ok(
    r.rows.every((x) => x.newViews.length === 2 && x.consensusText === null),
  );
});
test("authorization precedes load and dispatch", async () => {
  let called = false;
  await assert.rejects(
    runComponentContrast("/missing", false, {
      run: () => {
        called = true;
      },
    }),
    /AUTHORIZE/,
  );
  assert.equal(called, false);
});
test("durable reservation is exclusive and binds the frozen plan", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "component-reserve-"));
  try {
    await fs.writeFile(path.join(root, "plan.json"), "{}");
    const p = { crops: [{ frames: 16000 }], requests: 2, seconds: 2 };
    await assert.rejects(reserveComponentContrast(root, p, false), /AUTHORIZE/);
    await reserveComponentContrast(root, p, true);
    await assert.rejects(reserveComponentContrast(root, p, true), /EEXIST/);
    await assert.rejects(
      reserveComponentContrast(root, { ...p, seconds: 65 }, true),
      /BUDGET/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
