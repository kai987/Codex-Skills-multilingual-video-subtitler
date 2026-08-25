import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  InputError,
  atomicWriteJson,
  forcedAlignmentCacheEntrySchema,
  forcedAlignmentCacheManifestSchema,
  type ForcedAlignmentAttempt,
  type ForcedAlignmentCacheEntry,
  type ForcedAlignmentCacheIdentity,
  type ForcedAlignmentCacheManifest,
} from "@mvl/shared";
import { forcedAlignmentSha256 } from "@mvl/transcription-core";

export type ForcedAlignmentCacheMode = "off" | "read" | "read-write";

export function buildForcedAlignmentCacheKey(
  identity: ForcedAlignmentCacheIdentity,
): string {
  return forcedAlignmentSha256(identity);
}

function entryPath(root: string, cacheKey: string): string {
  if (!/^[a-f0-9]{64}$/u.test(cacheKey)) {
    throw new InputError("Forced-alignment cache key is invalid.");
  }
  return path.join(
    root,
    "canonical-forced-alignment",
    cacheKey.slice(0, 2),
    `${cacheKey}.json`,
  );
}

async function readEntry(
  root: string,
  cacheKey: string,
): Promise<ForcedAlignmentCacheEntry | null> {
  try {
    const raw = JSON.parse(
      await readFile(entryPath(root, cacheKey), "utf8"),
    ) as unknown;
    const entry = forcedAlignmentCacheEntrySchema.parse(raw);
    if (
      entry.cacheKey !== cacheKey ||
      buildForcedAlignmentCacheKey(entry.identity) !== cacheKey
    ) {
      throw new InputError(
        "Forced-alignment cache entry identity does not match its key.",
      );
    }
    return entry;
  } catch (error) {
    if (
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

export class ForcedAlignmentCache {
  readonly #root: string;
  readonly #imports: readonly string[];
  readonly #mode: ForcedAlignmentCacheMode;
  readonly #version: "C5.17" | "C5.17.1";
  readonly #records: ForcedAlignmentCacheManifest["entries"] = [];

  constructor(input: {
    root: string;
    importRoots?: readonly string[];
    mode?: ForcedAlignmentCacheMode;
    version?: "C5.17" | "C5.17.1";
  }) {
    this.#root = path.resolve(input.root);
    this.#imports = (input.importRoots ?? []).map((root) => path.resolve(root));
    this.#mode = input.mode ?? "read-write";
    this.#version = input.version ?? "C5.17";
  }

  async get(input: {
    identity: ForcedAlignmentCacheIdentity;
    attemptId: string;
    cueId: string;
    componentId: string;
    windowType: "narrow" | "expanded";
  }): Promise<ForcedAlignmentAttempt | null> {
    const cacheKey = buildForcedAlignmentCacheKey(input.identity);
    if (this.#mode === "off") {
      this.#record({
        attemptId: input.attemptId,
        cueId: input.cueId,
        componentId: input.componentId,
        windowType: input.windowType,
        cacheKey,
        entrySha256: forcedAlignmentSha256(null),
        hit: false,
      });
      return null;
    }
    for (const root of [this.#root, ...this.#imports]) {
      const entry = await readEntry(root, cacheKey);
      if (entry === null) continue;
      this.#record({
        attemptId: input.attemptId,
        cueId: input.cueId,
        componentId: input.componentId,
        windowType: input.windowType,
        cacheKey,
        entrySha256: forcedAlignmentSha256(entry),
        hit: true,
      });
      return {
        ...entry.attempt,
        attemptId: input.attemptId,
        cacheHit: true,
        wallClockSeconds: 0,
      };
    }
    this.#record({
      attemptId: input.attemptId,
      cueId: input.cueId,
      componentId: input.componentId,
      windowType: input.windowType,
      cacheKey,
      entrySha256: forcedAlignmentSha256(null),
      hit: false,
    });
    return null;
  }

  async put(input: {
    identity: ForcedAlignmentCacheIdentity;
    attempt: ForcedAlignmentAttempt;
  }): Promise<void> {
    if (this.#mode !== "read-write") return;
    const cacheKey = buildForcedAlignmentCacheKey(input.identity);
    const entry = forcedAlignmentCacheEntrySchema.parse({
      schemaVersion: "1.0.0",
      artifactType: "forced-alignment-cache-entry",
      cacheVersion: this.#version,
      requestType: "canonical-forced-alignment",
      createdAt: new Date().toISOString(),
      cacheKey,
      identity: input.identity,
      attempt: { ...input.attempt, cacheHit: false },
    });
    const output = entryPath(this.#root, cacheKey);
    await mkdir(path.dirname(output), { recursive: true });
    await atomicWriteJson(output, entry, { overwrite: true });
  }

  manifest(input: {
    generatedAt?: string;
    mfaProcessCount: number;
  }): ForcedAlignmentCacheManifest {
    const entries = [...this.#records].toSorted((left, right) =>
      left.attemptId.localeCompare(right.attemptId),
    );
    return forcedAlignmentCacheManifestSchema.parse({
      schemaVersion: "1.0.0",
      artifactType: "forced-alignment-cache-manifest",
      cacheVersion: this.#version,
      generatedAt: input.generatedAt ?? new Date().toISOString(),
      requestType: "canonical-forced-alignment",
      cacheRootShareableName: path.basename(this.#root),
      entries,
      summary: {
        entryCount: entries.length,
        hitCount: entries.filter((entry) => entry.hit).length,
        missCount: entries.filter((entry) => !entry.hit).length,
        mfaProcessCount: input.mfaProcessCount,
        legacyAsrCacheHitCount: 0,
      },
    });
  }

  #record(value: ForcedAlignmentCacheManifest["entries"][number]): void {
    const index = this.#records.findIndex(
      (entry) => entry.attemptId === value.attemptId,
    );
    if (index >= 0) this.#records.splice(index, 1);
    this.#records.push(value);
  }
}
