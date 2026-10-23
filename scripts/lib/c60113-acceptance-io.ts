import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  stat,
} from "node:fs/promises";
import path from "node:path";

import { atomicWriteJson } from "@mvl/shared";
import { machineQualitySemanticHash } from "@mvl/video-subtitler";

export interface C60113FileIdentity {
  sha256: string;
  size: number;
  mtimeMs: number;
  inode: number;
}

export async function readC60113Json(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, "utf8")) as unknown;
}

export async function c60113FileHash(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file) as AsyncIterable<Buffer>) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

export async function c60113FileIdentity(
  file: string,
): Promise<C60113FileIdentity> {
  const before = await stat(file);
  const sha256 = await c60113FileHash(file);
  const after = await stat(file);
  if (
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    before.ino !== after.ino
  ) {
    throw new Error("INPUT_CHANGED_DURING_IDENTITY_READ");
  }
  return { sha256, size: after.size, mtimeMs: after.mtimeMs, inode: after.ino };
}

export function assertC60113ReadOnlyIdentity(
  before: C60113FileIdentity,
  after: C60113FileIdentity,
): void {
  if (
    machineQualitySemanticHash(before) !== machineQualitySemanticHash(after)
  ) {
    throw new Error("READ_ONLY_INPUT_IDENTITY_CHANGED");
  }
}

export async function c60113OnlySubtitleDirectory(
  root: string,
): Promise<string> {
  const entries = (await readdir(root, { withFileTypes: true })).filter(
    (entry) => entry.isDirectory() && entry.name.startsWith("subtitle-"),
  );
  const entry = entries[0];
  if (entries.length !== 1 || !entry)
    throw new Error("EXPECTED_ONE_SUBTITLE_DIRECTORY");
  return path.join(root, entry.name);
}

/** Paths in machine artifacts are never followed without containment checks. */
export async function c60113ContainedFile(
  root: string,
  relative: string,
): Promise<string> {
  if (
    !relative ||
    path.isAbsolute(relative) ||
    relative.includes("\0") ||
    relative.split(/[\\/]/u).includes("..")
  ) {
    throw new Error("UNSAFE_ARTIFACT_RELATIVE_PATH");
  }
  const realRoot = await realpath(root);
  const candidate = path.resolve(realRoot, relative);
  const realCandidate = await realpath(candidate);
  const difference = path.relative(realRoot, realCandidate);
  if (
    difference.startsWith("..") ||
    path.isAbsolute(difference) ||
    (await lstat(candidate)).isSymbolicLink()
  ) {
    throw new Error("ARTIFACT_ESCAPES_WORKSPACE");
  }
  return realCandidate;
}

export async function c60113TreeManifest(
  root: string,
): Promise<{ relativePath: string; sha256: string; size: number }[]> {
  const entries: { relativePath: string; sha256: string; size: number }[] = [];
  const walk = async (current: string): Promise<void> => {
    for (const entry of (
      await readdir(current, { withFileTypes: true })
    ).toSorted((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === ".DS_Store") continue;
      const absolute = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error("SYMLINK_IN_ACCEPTANCE_TREE");
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile())
        entries.push({
          relativePath: path.relative(root, absolute),
          sha256: await c60113FileHash(absolute),
          size: (await stat(absolute)).size,
        });
    }
  };
  await walk(root);
  return entries.toSorted((a, b) =>
    a.relativePath.localeCompare(b.relativePath),
  );
}

/** Never delete/replace an existing run. Repeated builds require a fresh directory. */
export async function createC60113OutputDirectory(
  directory: string,
): Promise<void> {
  await mkdir(path.dirname(path.resolve(directory)), { recursive: true });
  await mkdir(directory, { recursive: false });
}

export async function copyC60113ReadOnlyTree(
  source: string,
  target: string,
): Promise<void> {
  const before = await c60113TreeManifest(source);
  await cp(source, target, {
    recursive: true,
    force: false,
    errorOnExist: true,
  });
  const after = await c60113TreeManifest(target);
  if (
    machineQualitySemanticHash(before) !== machineQualitySemanticHash(after)
  ) {
    throw new Error("COPIED_MACHINE_FINAL_TREE_MISMATCH");
  }
}

export function c60113IntervalUnionSeconds(
  intervals: readonly { start: number; end: number }[],
): number {
  let lastEnd = -1;
  let seconds = 0;
  for (const interval of intervals.toSorted(
    (a, b) => a.start - b.start || a.end - b.end,
  )) {
    if (
      !Number.isFinite(interval.start) ||
      !Number.isFinite(interval.end) ||
      interval.start < 0 ||
      interval.end <= interval.start
    )
      throw new Error("INVALID_AUDIO_INTERVAL");
    seconds += Math.max(0, interval.end - Math.max(interval.start, lastEnd));
    lastEnd = Math.max(lastEnd, interval.end);
  }
  return seconds;
}

export function c60113ScoreDiagnostics(scores: readonly number[]): {
  maximumScore: number;
  maximumScoreCount: number;
  largestTieGroup: number;
  uniqueScoreCount: number;
  entropyBits: number;
  distribution: { score: number; count: number }[];
} {
  const counts = new Map<number, number>();
  for (const score of scores) counts.set(score, (counts.get(score) ?? 0) + 1);
  const distribution = [...counts]
    .toSorted((a, b) => b[0] - a[0])
    .map(([score, count]) => ({ score, count }));
  return {
    maximumScore: distribution[0]?.score ?? 0,
    maximumScoreCount: distribution[0]?.count ?? 0,
    largestTieGroup: Math.max(0, ...counts.values()),
    uniqueScoreCount: counts.size,
    entropyBits: distribution.reduce((sum, entry) => {
      const p = entry.count / scores.length;
      return sum - p * Math.log2(p);
    }, 0),
    distribution,
  };
}

export async function writeC60113Artifact<T extends object>(
  file: string,
  core: T,
): Promise<T & { semanticHash: string }> {
  const artifact = { ...core, semanticHash: machineQualitySemanticHash(core) };
  await atomicWriteJson(file, artifact);
  return artifact;
}
