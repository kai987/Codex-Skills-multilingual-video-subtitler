import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { checkFrozen } from "../scripts/evaluate-short-response-readiness.mjs";

async function fixture(t, entries) {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "short-readiness-test-")),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bytes = "frozen test evidence";
  await fs.writeFile(path.join(root, "input.txt"), bytes);
  const files = entries ?? {
    "input.txt": createHash("sha256").update(bytes).digest("hex"),
  };
  await fs.writeFile(path.join(root, "freeze.json"), JSON.stringify({ files }));
  return root;
}

test("frozen small artifact validates without model imports or processes", async (t) => {
  const root = await fixture(t);
  assert.equal((await checkFrozen(root, "freeze.json")).count, 1);
});

test("changed payload is rejected", async (t) => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, "input.txt"), "changed");
  await assert.rejects(checkFrozen(root, "freeze.json"), /CHANGED:input.txt/);
});

test("parent escape and absolute entries are rejected", async (t) => {
  for (const key of ["../input.txt", "/tmp/input.txt", "x/../input.txt"]) {
    const root = await fixture(t, { [key]: "a".repeat(64) });
    await assert.rejects(checkFrozen(root, "freeze.json"), /UNSAFE_ENTRY/);
  }
});

test("symlink payload is rejected", async (t) => {
  const root = await fixture(t, { "link.txt": "a".repeat(64) });
  await fs.symlink(path.join(root, "input.txt"), path.join(root, "link.txt"));
  await assert.rejects(checkFrozen(root, "freeze.json"), /SYMLINK_ENTRY/);
});

test("empty freeze is not a passed audit", async (t) => {
  await assert.rejects(
    checkFrozen(await fixture(t, {}), "freeze.json"),
    /EMPTY_FREEZE/,
  );
});
