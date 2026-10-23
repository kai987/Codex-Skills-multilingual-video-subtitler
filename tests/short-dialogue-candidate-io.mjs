import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  createShortCandidate,
  verifyShortCandidate,
} from "../scripts/replay-short-dialogue-candidate.mjs";
async function fixture(t) {
  const root = await fs.mkdtemp(
    path.join(await fs.realpath(os.tmpdir()), "short-shadow-test-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
test("shadow output cannot overwrite source", async (t) => {
  const root = await fixture(t);
  await fs.writeFile(
    path.join(root, "plan.json"),
    JSON.stringify({ sources: [] }),
  );
  await assert.rejects(
    createShortCandidate(root, root),
    /OUTPUT_INSIDE_SOURCE/,
  );
  assert.deepEqual(await fs.readdir(root), ["plan.json"]);
});
test("shadow output cannot enter original baseline task", async (t) => {
  const root = await fixture(t),
    source = path.join(root, "source"),
    baseline = path.join(root, "baseline");
  await fs.mkdir(source);
  await fs.mkdir(baseline);
  await fs.writeFile(
    path.join(source, "plan.json"),
    JSON.stringify({ sources: [{ task: baseline }] }),
  );
  await assert.rejects(
    createShortCandidate(source, baseline),
    /OUTPUT_INSIDE_SOURCE/,
  );
  assert.deepEqual(await fs.readdir(baseline), []);
});
test("corrupted output rejected before accessing source", async (t) => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, "result.json"), "changed");
  await fs.writeFile(
    path.join(root, "machine-freeze.json"),
    JSON.stringify({ files: { "result.json": "0".repeat(64) } }),
  );
  await assert.rejects(verifyShortCandidate(root), /CHANGED/);
});
test("path escape in frozen output rejected", async (t) => {
  const root = await fixture(t);
  await fs.writeFile(
    path.join(root, "machine-freeze.json"),
    JSON.stringify({ files: { "../wrong": "0".repeat(64) } }),
  );
  await assert.rejects(verifyShortCandidate(root), /UNSAFE_INVENTORY/);
});
