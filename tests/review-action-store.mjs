import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { identity } from "../scripts/lib/content-review-plan.mjs";
import {
  actionSnapshotHash,
  readActionSnapshot,
  saveActionSnapshot,
} from "../scripts/lib/review-action-store.mjs";

const initial = {
  workspaceHash: "a".repeat(64),
  reviewVersion: 1,
  actions: [],
};
const changed = {
  ...initial,
  actions: [{ action: "EDIT_TEXT", text: "修正" }],
};
const restored = { ...initial, actions: [{ action: "KEEP" }] };
async function fixture(t) {
  const root = await fs.mkdtemp(
    path.join(await fs.realpath(os.tmpdir()), "review-action-store-test-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
const current = (root) => path.join(root, "actions.json");
const snapshot = (root, value) =>
  path.join(root, "action-history", actionSnapshotHash(value) + ".json");
const readCurrent = async (root) =>
  JSON.parse(await fs.readFile(current(root), "utf8"));

test("snapshot hashes remain byte-compatible with legacy identity", () => {
  for (const value of [
    initial,
    changed,
    restored,
    { z: 1, a: { q: "日本語" } },
  ])
    assert.equal(actionSnapshotHash(value), identity(value));
});

test("save/read creates content-addressed history and current without schema claims", async (t) => {
  const root = await fixture(t);
  const arbitraryJson = { arbitrarySchema: "caller validates", actions: [] };
  assert.deepEqual(
    await saveActionSnapshot(root, arbitraryJson),
    arbitraryJson,
  );
  assert.deepEqual(await readCurrent(root), arbitraryJson);
  assert.deepEqual(
    await readActionSnapshot(root, actionSnapshotHash(arbitraryJson)),
    arbitraryJson,
  );
  assert.deepEqual((await fs.readdir(root)).sort(), [
    "action-history",
    "actions.json",
  ]);
});

test("first save retains legacy current; restoring snapshots never removes history", async (t) => {
  const root = await fixture(t);
  await fs.writeFile(current(root), JSON.stringify(initial));
  await saveActionSnapshot(root, changed);
  assert.deepEqual(await readActionSnapshot(root, identity(initial)), initial);
  assert.deepEqual(await readActionSnapshot(root, identity(changed)), changed);
  const oldHistory = await fs.readFile(snapshot(root, changed));
  const old = await readActionSnapshot(root, identity(initial));
  // A domain caller must validate `old` against its workspace before saving it.
  await saveActionSnapshot(root, old);
  assert.deepEqual(await readCurrent(root), initial);
  assert.deepEqual(await fs.readFile(snapshot(root, changed)), oldHistory);
  assert.equal((await fs.readdir(path.join(root, "action-history"))).length, 2);
});

test("no-op save is idempotent and does not replace current or historical files", async (t) => {
  const root = await fixture(t);
  await saveActionSnapshot(root, initial);
  const before = await fs.stat(current(root));
  const historyBefore = await fs.stat(snapshot(root, initial));
  await saveActionSnapshot(root, initial);
  const after = await fs.stat(current(root));
  const historyAfter = await fs.stat(snapshot(root, initial));
  assert.equal(after.ino, before.ino);
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.equal(historyAfter.ino, historyBefore.ino);
  assert.equal(historyAfter.mtimeMs, historyBefore.mtimeMs);
  assert.equal((await fs.readdir(path.join(root, "action-history"))).length, 1);
});

test("legacy compact history is reused without rewriting", async (t) => {
  const root = await fixture(t);
  await fs.mkdir(path.join(root, "action-history"));
  const compact = JSON.stringify(changed) + "\n";
  await fs.writeFile(snapshot(root, changed), compact);
  await saveActionSnapshot(root, changed);
  assert.equal(await fs.readFile(snapshot(root, changed), "utf8"), compact);
});

test("history collisions fail closed without replacing current or clobbering history", async (t) => {
  const root = await fixture(t);
  await saveActionSnapshot(root, initial);
  const bad = JSON.stringify(restored);
  await fs.writeFile(snapshot(root, changed), bad);
  await assert.rejects(
    saveActionSnapshot(root, changed),
    /ACTION_HISTORY_COLLISION/u,
  );
  await assert.rejects(
    readActionSnapshot(root, identity(changed)),
    /ACTION_HISTORY_COLLISION/u,
  );
  assert.deepEqual(await readCurrent(root), initial);
  assert.equal(await fs.readFile(snapshot(root, changed), "utf8"), bad);
  assert.equal((await fs.readdir(root)).includes(".action-store.lock"), false);
});

test("a collision in the old snapshot also blocks replacement", async (t) => {
  const root = await fixture(t);
  await saveActionSnapshot(root, initial);
  await fs.writeFile(snapshot(root, initial), JSON.stringify(restored));
  await assert.rejects(
    saveActionSnapshot(root, changed),
    /ACTION_HISTORY_COLLISION/u,
  );
  assert.deepEqual(await readCurrent(root), initial);
  assert.deepEqual(
    (await fs.readdir(path.join(root, "action-history"))).sort(),
    [identity(initial) + ".json"],
  );
});

test("only lowercase 64-hex hashes can address history", async (t) => {
  const root = await fixture(t);
  for (const hash of [
    "../actions",
    "/actions",
    "a".repeat(63),
    "a".repeat(65),
    "A".repeat(64),
    "g".repeat(64),
    null,
  ])
    await assert.rejects(
      readActionSnapshot(root, hash),
      /ACTION_SNAPSHOT_INVALID_HASH/u,
    );
  await assert.rejects(readActionSnapshot(root, "0".repeat(64)), {
    code: "ENOENT",
  });
});

test("corrupt or non-object current data is never silently overwritten", async (t) => {
  const root = await fixture(t);
  for (const bytes of ["{bad", "null", "[]", '"text"']) {
    await fs.writeFile(current(root), bytes);
    await assert.rejects(saveActionSnapshot(root, changed));
    assert.equal(await fs.readFile(current(root), "utf8"), bytes);
  }
  for (const value of [null, [], "text", undefined])
    await assert.rejects(
      saveActionSnapshot(root, value),
      /ACTION_SNAPSHOT_OBJECT_REQUIRED/u,
    );
});

test("writer lock fails closed and is not removed by another writer", async (t) => {
  const root = await fixture(t);
  await saveActionSnapshot(root, initial);
  const lock = path.join(root, ".action-store.lock");
  await fs.writeFile(lock, "another writer");
  await assert.rejects(saveActionSnapshot(root, changed), /ACTION_STORE_BUSY/u);
  assert.equal(await fs.readFile(lock, "utf8"), "another writer");
  assert.deepEqual(await readCurrent(root), initial);
});

test("root and root-ancestor symlinks are rejected", async (t) => {
  const root = await fixture(t);
  const actual = path.join(root, "actual");
  await fs.mkdir(path.join(actual, "child"), { recursive: true });
  const link = path.join(root, "link");
  await fs.symlink(actual, link);
  for (const target of [link, path.join(link, "child")]) {
    await assert.rejects(
      saveActionSnapshot(target, initial),
      /ACTION_STORE_SYMLINK/u,
    );
    await assert.rejects(
      readActionSnapshot(target, identity(initial)),
      /ACTION_STORE_SYMLINK/u,
    );
  }
  assert.deepEqual(await fs.readdir(path.join(actual, "child")), []);
});

test("history, current, snapshot, and lock symlinks never follow external targets", async (t) => {
  const outer = await fixture(t);
  const target = path.join(outer, "target.json");
  await fs.writeFile(target, JSON.stringify(initial));
  for (const kind of ["history", "current", "snapshot", "lock"]) {
    const root = path.join(outer, kind);
    await fs.mkdir(root);
    const history = path.join(root, "action-history");
    if (kind === "history") await fs.symlink(outer, history);
    if (kind === "current") await fs.symlink(target, current(root));
    if (kind === "snapshot") {
      await fs.mkdir(history);
      await fs.symlink(target, snapshot(root, changed));
    }
    if (kind === "lock")
      await fs.symlink(target, path.join(root, ".action-store.lock"));
    await assert.rejects(
      saveActionSnapshot(root, changed),
      /ACTION_STORE_SYMLINK/u,
    );
    if (kind === "history" || kind === "snapshot")
      await assert.rejects(
        readActionSnapshot(root, identity(changed)),
        /ACTION_STORE_SYMLINK/u,
      );
    assert.equal(await fs.readFile(target, "utf8"), JSON.stringify(initial));
  }
});

test("invalid roots and non-file current data fail closed", async (t) => {
  const root = await fixture(t);
  for (const target of ["", " ", null, path.parse(root).root])
    await assert.rejects(
      saveActionSnapshot(target, initial),
      /ACTION_STORE_INVALID_ROOT/u,
    );
  await fs.mkdir(current(root));
  await assert.rejects(
    saveActionSnapshot(root, initial),
    /ACTION_STORE_NOT_FILE/u,
  );
  await assert.rejects(
    saveActionSnapshot(current(root) + "/missing", initial),
    { code: "ENOENT" },
  );
});
