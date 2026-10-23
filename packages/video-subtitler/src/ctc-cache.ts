import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  InputError,
  atomicWriteJson,
  ctcAlignmentCacheEntrySchema,
  ctcAlignmentCacheManifestSchema,
  type CtcAlignmentAttempt,
  type CtcAlignmentCacheEntry,
  type CtcAlignmentCacheIdentity,
  type CtcAlignmentCacheManifest,
  type CtcCacheMode,
} from "@mvl/shared";

import { sha256Value } from "./finalization-support.js";

export function buildCtcAlignmentCacheKey(
  identity: CtcAlignmentCacheIdentity,
): string {
  return sha256Value(identity);
}

function entryPath(root: string, cacheKey: string): string {
  if (!/^[a-f0-9]{64}$/u.test(cacheKey)) {
    throw new InputError("CTC alignment cache key is invalid.");
  }
  return path.join(
    root,
    "local-ctc-boundary-alignment",
    cacheKey.slice(0, 2),
    `${cacheKey}.json`,
  );
}

function isMissingFile(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

async function readEntry(
  root: string,
  cacheKey: string,
): Promise<CtcAlignmentCacheEntry | null> {
  try {
    const entry = ctcAlignmentCacheEntrySchema.parse(
      JSON.parse(await readFile(entryPath(root, cacheKey), "utf8")) as unknown,
    );
    const semanticHash = sha256Value({
      identity: entry.identity,
      result: { ...entry.result, cacheHit: false, inferenceExecuted: true },
    });
    if (
      entry.cacheKey !== cacheKey ||
      buildCtcAlignmentCacheKey(entry.identity) !== cacheKey ||
      semanticHash !== entry.semanticHash
    ) {
      throw new InputError(
        "CTC alignment cache entry failed identity or semantic validation.",
      );
    }
    return entry;
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}

export class CtcAlignmentCache {
  readonly #root: string;
  readonly #imports: readonly string[];
  readonly #mode: CtcCacheMode;
  readonly #records: CtcAlignmentCacheManifest["requests"] = [];
  #hitCount = 0;
  #missCount = 0;
  #writeCount = 0;
  readonly #writtenKeys = new Set<string>();

  constructor(input: {
    root: string;
    importRoots?: readonly string[];
    mode: CtcCacheMode;
  }) {
    this.#root = path.resolve(input.root);
    this.#imports = (input.importRoots ?? []).map((root) => path.resolve(root));
    this.#mode = input.mode;
  }

  async get(input: {
    identity: CtcAlignmentCacheIdentity;
    attemptId: string;
    cueId: string;
    componentId: string;
    windowType: "narrow" | "expanded";
    audioSha256: string;
    ignoreCurrentRunWrites?: boolean;
  }): Promise<CtcAlignmentAttempt | null> {
    const cacheKey = buildCtcAlignmentCacheKey(input.identity);
    if (this.#mode !== "off") {
      for (const root of [this.#root, ...this.#imports]) {
        if (
          input.ignoreCurrentRunWrites === true &&
          root === this.#root &&
          this.#writtenKeys.has(cacheKey)
        ) {
          continue;
        }
        const entry = await readEntry(root, cacheKey);
        if (entry === null) continue;
        this.#hitCount += 1;
        this.#record({
          attemptId: input.attemptId,
          cueId: input.cueId,
          componentId: input.componentId,
          windowType: input.windowType,
          cacheKey,
          cacheHit: true,
          audioSha256: input.audioSha256,
          entrySemanticHash: entry.semanticHash,
        });
        return ctcAlignmentCacheEntrySchema.shape.result.parse({
          ...entry.result,
          attemptId: input.attemptId,
          cueId: input.cueId,
          componentId: input.componentId,
          windowType: input.windowType,
          cacheHit: true,
          inferenceExecuted: false,
          modelLoadCount: 0,
          wallClockSeconds: 0,
        });
      }
    }
    this.#missCount += 1;
    this.#record({
      attemptId: input.attemptId,
      cueId: input.cueId,
      componentId: input.componentId,
      windowType: input.windowType,
      cacheKey,
      cacheHit: false,
      audioSha256: input.audioSha256,
      entrySemanticHash: sha256Value(null),
    });
    return null;
  }

  async put(input: {
    identity: CtcAlignmentCacheIdentity;
    attempt: CtcAlignmentAttempt;
  }): Promise<void> {
    if (this.#mode !== "read-write") return;
    const cacheKey = buildCtcAlignmentCacheKey(input.identity);
    const result = ctcAlignmentCacheEntrySchema.shape.result.parse({
      ...input.attempt,
      cacheHit: false,
      inferenceExecuted: true,
    });
    const entry = ctcAlignmentCacheEntrySchema.parse({
      schemaVersion: "1.0.0",
      artifactType: "ctc-alignment-cache-entry",
      cacheVersion: "C5.18.1",
      createdAt: new Date().toISOString(),
      cacheKey,
      identity: input.identity,
      result,
      semanticHash: sha256Value({ identity: input.identity, result }),
    });
    const outputPath = entryPath(this.#root, cacheKey);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await atomicWriteJson(outputPath, entry, { overwrite: true });
    this.#writtenKeys.add(cacheKey);
    this.#writeCount += 1;
  }

  manifest(input: {
    inferenceCount: number;
    modelLoadCount: number;
    generatedAt?: string;
  }): CtcAlignmentCacheManifest {
    const requests = [...this.#records].toSorted((left, right) =>
      left.attemptId.localeCompare(right.attemptId),
    );
    const base = {
      schemaVersion: "1.0.0" as const,
      artifactType: "ctc-alignment-cache-manifest" as const,
      cacheVersion: "C5.18.1" as const,
      generatedAt: input.generatedAt ?? new Date().toISOString(),
      mode: this.#mode,
      cacheRootShareableName: path.basename(this.#root),
      requests,
      summary: {
        requestCount: requests.length,
        hitCount: this.#hitCount,
        missCount: this.#missCount,
        writeCount: this.#writeCount,
        inferenceCount: input.inferenceCount,
        modelLoadCount: input.modelLoadCount,
      },
      cacheIdentityHash: sha256Value(
        requests.map(({ attemptId, cacheKey }) => ({ attemptId, cacheKey })),
      ),
    };
    return ctcAlignmentCacheManifestSchema.parse({
      ...base,
      semanticHash: sha256Value({ ...base, generatedAt: null }),
    });
  }

  #record(record: CtcAlignmentCacheManifest["requests"][number]): void {
    const index = this.#records.findIndex(
      (entry) => entry.attemptId === record.attemptId,
    );
    if (index >= 0) this.#records.splice(index, 1);
    this.#records.push(record);
  }
}
