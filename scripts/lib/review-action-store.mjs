/** Content-addressed JSON storage only. Callers own action/workspace validation. */
import fs from "node:fs/promises";
import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

const hashPattern = /^[a-f0-9]{64}$/u;
const encode = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("ACTION_SNAPSHOT_OBJECT_REQUIRED");
  const text = JSON.stringify(value, null, 2) + "\n";
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw Error("ACTION_SNAPSHOT_OBJECT_REQUIRED");
  return text;
};

// Deliberately identical to the legacy identity(value), including property order.
export const actionSnapshotHash = (value) =>
  createHash("sha256").update(encode(value)).digest("hex");

async function statFile(file, missing = false) {
  let stat;
  try {
    stat = await fs.lstat(file);
  } catch (e) {
    if (missing && e.code === "ENOENT") return null;
    throw e;
  }
  if (stat.isSymbolicLink()) throw Error("ACTION_STORE_SYMLINK");
  if (!stat.isFile()) throw Error("ACTION_STORE_NOT_FILE");
  return stat;
}

async function directory(dir) {
  let part = path.parse(dir).root;
  for (const segment of dir
    .slice(part.length)
    .split(path.sep)
    .filter(Boolean)) {
    part = path.join(part, segment);
    const stat = await fs.lstat(part);
    if (stat.isSymbolicLink()) throw Error("ACTION_STORE_SYMLINK");
    if (!stat.isDirectory()) throw Error("ACTION_STORE_NOT_DIRECTORY");
  }
}

async function checkedRoot(root) {
  if (typeof root !== "string" || !root.trim())
    throw Error("ACTION_STORE_INVALID_ROOT");
  const absolute = path.resolve(root);
  if (absolute === path.parse(absolute).root)
    throw Error("ACTION_STORE_INVALID_ROOT");
  await directory(absolute);
  return absolute;
}

async function readFile(file, missing = false) {
  if (!(await statFile(file, missing))) return null;
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!(await handle.stat()).isFile()) throw Error("ACTION_STORE_NOT_FILE");
    const text = await handle.readFile("utf8");
    const value = JSON.parse(text);
    encode(value);
    return { value, text };
  } finally {
    await handle.close();
  }
}

async function syncDirectory(dir) {
  const handle = await fs.open(dir, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function exclusiveWrite(file, text) {
  const handle = await fs.open(
    file,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(text, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(path.dirname(file));
}

async function appendSnapshot(history, value) {
  const text = encode(value);
  const file = path.join(history, actionSnapshotHash(value) + ".json");
  await directory(history);
  await statFile(file, true);
  try {
    await exclusiveWrite(file, text);
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    const existing = await readFile(file);
    if (encode(existing.value) !== text)
      throw Error("ACTION_HISTORY_COLLISION", { cause: e });
  }
}

/** Returns integrity-checked JSON, NOT schema-validated or workspace-authorized actions. */
export async function readActionSnapshot(root, hash) {
  if (typeof hash !== "string" || !hashPattern.test(hash))
    throw Error("ACTION_SNAPSHOT_INVALID_HASH");
  root = await checkedRoot(root);
  const history = path.join(root, "action-history");
  await directory(history);
  const { value } = await readFile(path.join(history, hash + ".json"));
  if (actionSnapshotHash(value) !== hash)
    throw Error("ACTION_HISTORY_COLLISION");
  return value;
}

/** Preserve both old and new JSON snapshots, then durably replace actions.json. */
export async function saveActionSnapshot(root, validatedActionFile) {
  // Freeze caller-owned objects before any asynchronous IO.
  const text = encode(validatedActionFile);
  const value = JSON.parse(text);
  root = await checkedRoot(root);
  const lock = path.join(root, ".action-store.lock");
  await statFile(lock, true);
  let handle;
  try {
    handle = await fs.open(lock, "wx", 0o600);
  } catch (e) {
    if (e.code === "EEXIST") throw Error("ACTION_STORE_BUSY", { cause: e });
    throw e;
  }
  let temp;
  try {
    await directory(root);
    const currentFile = path.join(root, "actions.json");
    const current = await readFile(currentFile, true);
    const history = path.join(root, "action-history");
    try {
      await fs.mkdir(history, { mode: 0o700 });
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
    await directory(history);
    if (current) await appendSnapshot(history, current.value);
    await appendSnapshot(history, value);
    if (current && encode(current.value) === text) return value;

    temp = path.join(root, ".actions-" + randomUUID() + ".tmp");
    await exclusiveWrite(temp, text);
    await directory(root);
    const latest = await readFile(currentFile, true);
    if (latest?.text !== current?.text) throw Error("ACTION_CURRENT_CHANGED");
    await fs.rename(temp, currentFile);
    temp = undefined;
    await syncDirectory(root);
    return value;
  } finally {
    try {
      if (temp) await fs.unlink(temp);
    } finally {
      await handle.close();
      await fs.unlink(lock);
      await syncDirectory(root);
    }
  }
}
