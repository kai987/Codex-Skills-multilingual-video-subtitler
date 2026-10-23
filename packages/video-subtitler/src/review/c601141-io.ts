import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { assertBudget141, hash141 } from "./c601141-policy.js";

export async function fileHash141(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file))
    hash.update(chunk as Buffer);
  return hash.digest("hex");
}
export async function readJson141(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, "utf8")) as unknown;
}
export async function identity141(file: string) {
  const before = await stat(file),
    sha256 = await fileHash141(file),
    after = await stat(file);
  if (
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    before.ino !== after.ino
  )
    throw new Error("C601141_INPUT_CHANGED_DURING_READ");
  return { sha256, size: after.size, mtimeMs: after.mtimeMs, inode: after.ino };
}
/** Write-once plus fsync, including the directory entry. An interrupted inference
 * can be recovered from its raw receipt, never silently re-dispatched. */
export async function durableJson141(
  file: string,
  value: unknown,
): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const handle = await open(file, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(value, null, 2) + "\n");
    await handle.sync();
  } finally {
    await handle.close();
  }
  const directory = await open(path.dirname(file), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
export async function reserveDispatch141(input: {
  cacheDirectory: string;
  kind: "SPEECH" | "ASR";
  requestId: string;
  identity: unknown;
}) {
  const directory = path.join(
    input.cacheDirectory,
    "dispatch",
    input.kind.toLowerCase(),
  );
  await mkdir(directory, { recursive: true });
  const lock = await open(path.join(directory, ".reservation.lock"), "wx");
  // No automatic stale-lock removal: an interrupted writer needs investigation.
  try {
    const files = (await readdir(directory)).filter((file) =>
      file.endsWith(".json"),
    );
    assertBudget141(input.kind, 1, files.length);
    await durableJson141(
      path.join(directory, `${hash141(input.requestId)}.json`),
      {
        requestId: input.requestId,
        identity: input.identity,
        kind: input.kind,
        inferenceReserved: true,
        retryAllowed: false,
        reservedAt: new Date().toISOString(),
      },
    );
  } finally {
    await lock.close();
    const { unlink } = await import("node:fs/promises");
    await unlink(path.join(directory, ".reservation.lock"));
  }
}
export function pcm141(bytes: Buffer): {
  pcm: Buffer;
  sampleRate: number;
  channels: number;
  frames: number;
} {
  if (
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WAVE"
  )
    throw new Error("C601141_NOT_WAV");
  let sampleRate = 0,
    channels = 0,
    data: Buffer | undefined;
  for (let i = 12; i + 8 <= bytes.length;) {
    const kind = bytes.toString("ascii", i, i + 4),
      size = bytes.readUInt32LE(i + 4),
      begin = i + 8;
    if (begin + size > bytes.length) throw new Error("C601141_TRUNCATED_WAV");
    if (kind === "fmt ") {
      if (
        size < 16 ||
        bytes.readUInt16LE(begin) !== 1 ||
        bytes.readUInt16LE(begin + 14) !== 16
      )
        throw new Error("C601141_WAV_NOT_PCM16");
      channels = bytes.readUInt16LE(begin + 2);
      sampleRate = bytes.readUInt32LE(begin + 4);
    }
    if (kind === "data") data = bytes.subarray(begin, begin + size);
    i = begin + size + (size % 2);
  }
  if (!data || !sampleRate || !channels || data.length % (2 * channels))
    throw new Error("C601141_WAV_INTEGRITY");
  return {
    pcm: data,
    sampleRate,
    channels,
    frames: data.length / (2 * channels),
  };
}
export function wav141(data: Buffer, sampleRate = 16000, channels = 1): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(data.length + 36, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * channels * 2, 28);
  h.writeUInt16LE(channels * 2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
export const bytesHash141 = (value: Buffer) =>
  createHash("sha256").update(value).digest("hex");
export function safeRelative141(root: string, file: string): string {
  const rel = path.relative(root, file);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel))
    throw new Error("C601141_ARTIFACT_OUTSIDE_ROOT");
  return rel;
}
