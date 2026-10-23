import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  auditPrefixTransfer,
  inspectPrefixTransfer,
  selectPrefixControls,
  verifyPrefixTransfer,
} from "../scripts/audit-prefix-negative-transfer.mjs";

const hash = (b) => createHash("sha256").update(b).digest("hex");
async function fixture(t) {
  const temp = await fs.mkdtemp(
    path.join(await fs.realpath(os.tmpdir()), "prefix-transfer-test-"),
  );
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const source = path.join(temp, "source");
  await fs.mkdir(source);
  const put = async (name, value) => {
    const bytes = JSON.stringify(value);
    await fs.writeFile(path.join(source, name), bytes);
    return { path: name, sha256: hash(bytes) };
  };
  const rows = [
    {
      recordId: "a",
      sourceStart: 10,
      sourceEnd: 11,
      text: "行ってらっしゃい",
      issues: [],
      chunkIndex: 1,
      requestId: "one",
    },
    {
      recordId: "b",
      sourceStart: 11,
      sourceEnd: 12,
      text: "行ってらっしゃい",
      issues: [],
      chunkIndex: 1,
      requestId: "one",
    },
  ];
  const bound = [
    await put("baseline-records.json", rows),
    await put("manifest.json", { sourceMediaHash: "a".repeat(64) }),
  ];
  const input = await put("input-freeze.json", { files: bound });
  await put("raw-freeze.json", { files: [...bound, input] });
  return { source, output: path.join(temp, "out"), put };
}

test("saved nonoverlapping repeat controls remain unchanged; zero evidence is never acoustic acceptance", async (t) => {
  const f = await fixture(t);
  const r = await auditPrefixTransfer(f.source, f.output);
  assert.equal(r.controls, 1);
  assert.equal(r.preservedRecords, 2);
  assert.equal(r.acousticAcceptance, "not-assessed");
  assert.equal(r.automaticPromotionAllowed, false);
  assert.equal(r.inferenceRequests, 0);
  assert.deepEqual(await fs.readdir(r.root), ["audit.json", "freeze.json"]);
  assert.equal((await verifyPrefixTransfer(r.root)).integrity, "passed");
});
test("tampered baseline fails instead of counting unchanged records as passes", async (t) => {
  const f = await fixture(t);
  await fs.appendFile(path.join(f.source, "baseline-records.json"), " ");
  await assert.rejects(inspectPrefixTransfer(f.source), /INPUT_HASH_MISMATCH/);
});
test("missing raw evidence fails closed", async (t) => {
  const f = await fixture(t);
  await f.put("raw-freeze.json", {
    files: [{ path: "missing.wav", sha256: "a".repeat(64) }],
  });
  await assert.rejects(inspectPrefixTransfer(f.source), /ENOENT/);
});
test("path escape is rejected before external file access", async (t) => {
  const f = await fixture(t);
  await f.put("input-freeze.json", {
    files: [{ path: "../outside.json", sha256: "a".repeat(64) }],
  });
  await assert.rejects(inspectPrefixTransfer(f.source), /UNSAFE_FREEZE_PATH/);
});
test("cannot create an audit within source evidence, including through a symlink", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    auditPrefixTransfer(f.source, path.join(f.source, "new")),
    /OUTPUT_INSIDE_SOURCE/,
  );
  await fs.symlink(f.source, f.output);
  await assert.rejects(
    auditPrefixTransfer(f.source, path.join(f.output, "new")),
    /OUTPUT_INSIDE_SOURCE/,
  );
  await assert.rejects(fs.access(path.join(f.source, "new")), /ENOENT/);
});
test("audit output tampering is detected on replay", async (t) => {
  const f = await fixture(t),
    r = await auditPrefixTransfer(f.source, f.output);
  await fs.appendFile(path.join(r.root, "audit.json"), " ");
  await assert.rejects(verifyPrefixTransfer(r.root), /AUDIT_CHANGED/);
});
test("selection is time-ordered, closes intervening records and does not cherry-pick a cap", () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({
    id: `r${i}`,
    start: i * 10,
    end: i * 10 + 1,
    text: "そうです",
  }));
  const paired = rows.flatMap((r) => [
    r,
    { ...r, id: r.id + "b", start: r.end, end: r.end + 1 },
  ]);
  assert.equal(selectPrefixControls([...paired].reverse()).length, 12);
  const closed = selectPrefixControls([
    { id: "a", start: 0, end: 1, text: "おはよう" },
    { id: "b", start: 1, end: 2, text: "別の発話" },
    { id: "c", start: 2, end: 3, text: "おはよう" },
  ]);
  assert.deepEqual(closed[0].recordIds, ["a", "b", "c"]);
});
