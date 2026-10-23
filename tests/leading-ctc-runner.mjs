import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  vocabularyHash,
  runLeadingCtc,
} from "../scripts/subtitle-tool-leading-ctc.mjs";
import { leadingCtcPolicy } from "../scripts/lib/leading-ctc-observation.mjs";
const hash = (s) => createHash("sha256").update(s).digest("hex");

test("vocabulary hash matches Python sorted keys including numeric tokens", () => {
  assert.equal(
    vocabularyHash({ 2: 8, 10: 7, あ: 9 }),
    hash('{"10":7,"2":8,"あ":9}'),
  );
  assert.notEqual(
    vocabularyHash({ 2: 8, 10: 7, あ: 9 }),
    hash(JSON.stringify({ 10: 7, 2: 8, あ: 9 })),
  );
});
test("vocabulary key sort uses Unicode code points, not UTF16 surrogate order", () => {
  assert.equal(
    vocabularyHash({ "𠀀": 2, "\uE000": 1 }),
    hash('{"\uE000":1,"𠀀":2}'),
  );
});
test("run rejects absent explicit authorization before touching files or runner", async () => {
  let called = false;
  await assert.rejects(
    runLeadingCtc("/does-not-exist", false, {
      run() {
        called = true;
      },
    }),
    /AUTHORIZE_LOCAL_REQUIRED/u,
  );
  assert.equal(called, false);
});
test("consumed reservation cannot dispatch another model request", async () => {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "leading-ctc-reservation-")),
  );
  try {
    const audio = Buffer.from("synthetic bytes; no model should run");
    await fs.writeFile(path.join(root, "input.wav"), audio);
    const p = {
      policy: leadingCtcPolicy,
      referenceUsed: false,
      labelsUsed: false,
      bindings: [],
      request: { frames: 1, wavHash: hash(audio) },
    };
    const plan = JSON.stringify(p);
    await fs.writeFile(path.join(root, "plan.json"), plan);
    await fs.writeFile(
      path.join(root, "plan-freeze.json"),
      JSON.stringify({ planHash: hash(plan) }),
    );
    await fs.writeFile(
      path.join(root, "execution-reservation.json"),
      "already consumed",
    );
    let calls = 0;
    await assert.rejects(
      runLeadingCtc(root, true, {
        run() {
          calls++;
        },
      }),
      /EEXIST/u,
    );
    assert.equal(calls, 0);
    p.policy = { ...leadingCtcPolicy, maxRequests: 2 };
    const changed = JSON.stringify(p);
    await fs.writeFile(path.join(root, "plan.json"), changed);
    await fs.writeFile(
      path.join(root, "plan-freeze.json"),
      JSON.stringify({ planHash: hash(changed) }),
    );
    await assert.rejects(
      runLeadingCtc(root, true, {
        run() {
          calls++;
        },
      }),
    );
    assert.equal(calls, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
