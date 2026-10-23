import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  executeContextComparison,
  verifyContextComparison,
} from "../scripts/run-whole-context-comparison.mjs";
async function fixture(t) {
  const root = await fs.mkdtemp(
    path.join(await fs.realpath(os.tmpdir()), "context-comparison-test-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
test("ASR requires explicit local authorization before touching disk", async (t) => {
  const root = await fixture(t);
  await assert.rejects(
    executeContextComparison(root),
    /EXPLICIT_LOCAL_AUTHORIZATION_REQUIRED/,
  );
  assert.deepEqual(await fs.readdir(root), []);
});
test("tampered artifact is rejected before reading sources", async (t) => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, "result.json"), "tampered");
  await fs.writeFile(
    path.join(root, "machine-freeze.json"),
    JSON.stringify({ files: { "result.json": "0".repeat(64) } }),
  );
  await assert.rejects(verifyContextComparison(root), /result.json/);
});
test("frozen inventory cannot escape root", async (t) => {
  const root = await fixture(t);
  await fs.writeFile(
    path.join(root, "machine-freeze.json"),
    JSON.stringify({ files: { "../outside": "0".repeat(64) } }),
  );
  await assert.rejects(verifyContextComparison(root), /UNSAFE_PATH/);
});
test("modified plan fails before runtime loading or budget reservation", async (t) => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, "plan.json"), "{}");
  await fs.writeFile(
    path.join(root, "plan-freeze.json"),
    JSON.stringify({ sha256: "0".repeat(64) }),
  );
  await assert.rejects(executeContextComparison(root, { authorize: true }));
  assert.deepEqual((await fs.readdir(root)).sort(), [
    "plan-freeze.json",
    "plan.json",
  ]);
});
