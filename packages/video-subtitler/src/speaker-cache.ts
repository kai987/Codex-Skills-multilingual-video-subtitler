import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  InputError,
  atomicWriteJson,
  speakerEvidenceCacheEntrySchema,
  speakerEvidenceCacheManifestSchema,
  type SpeakerCacheMode,
  type SpeakerEvidenceCacheEntry,
  type SpeakerEvidenceCacheIdentity,
  type SpeakerEvidenceCacheManifest,
  type SpeakerWindowType,
} from "@mvl/shared";

import { sha256Value } from "./finalization-support.js";
import type { RawSpeakerInference } from "./speaker-runtime.js";

export function buildSpeakerEvidenceCacheKey(
  identity: SpeakerEvidenceCacheIdentity,
): string {
  return sha256Value({
    ...identity,
    dependencyModelHashes: [...identity.dependencyModelHashes].toSorted(),
  });
}

function cacheEntryPath(root: string, cacheKey: string): string {
  if (!/^[a-f0-9]{64}$/u.test(cacheKey)) {
    throw new InputError("Speaker-evidence cache key is invalid.");
  }
  return path.join(
    root,
    "local-speaker-evidence",
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

async function readCacheEntry(
  root: string,
  cacheKey: string,
): Promise<SpeakerEvidenceCacheEntry | null> {
  try {
    const entry = speakerEvidenceCacheEntrySchema.parse(
      JSON.parse(
        await readFile(cacheEntryPath(root, cacheKey), "utf8"),
      ) as unknown,
    );
    if (
      entry.cacheKey !== cacheKey ||
      buildSpeakerEvidenceCacheKey(entry.requestIdentity) !== cacheKey ||
      sha256Value({
        requestIdentity: entry.requestIdentity,
        result: entry.result,
      }) !== entry.semanticHash
    ) {
      throw new InputError(
        "Speaker-evidence cache entry failed identity or semantic validation.",
      );
    }
    return entry;
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}

export class SpeakerEvidenceCache {
  readonly #root: string;
  readonly #importRoots: readonly string[];
  readonly #mode: SpeakerCacheMode;
  readonly #requests: SpeakerEvidenceCacheManifest["requests"] = [];
  #hitCount = 0;
  #missCount = 0;
  #writeCount = 0;

  constructor(input: {
    root: string;
    importRoots?: readonly string[];
    mode: SpeakerCacheMode;
  }) {
    this.#root = path.resolve(input.root);
    this.#importRoots = (input.importRoots ?? []).map((root) =>
      path.resolve(root),
    );
    this.#mode = input.mode;
  }

  async get(input: {
    attemptId: string;
    audioSha256: string;
    windowType: SpeakerWindowType;
    identity: SpeakerEvidenceCacheIdentity;
  }): Promise<RawSpeakerInference | null> {
    const cacheKey = buildSpeakerEvidenceCacheKey(input.identity);
    if (this.#mode !== "off") {
      for (const root of [this.#root, ...this.#importRoots]) {
        const entry = await readCacheEntry(root, cacheKey);
        if (entry === null) continue;
        this.#hitCount += 1;
        this.#record({
          attemptId: input.attemptId,
          cacheKey,
          cacheHit: true,
          entrySemanticHash: entry.semanticHash,
          audioSha256: input.audioSha256,
          windowType: input.windowType,
        });
        return { ...entry.result, wallClockSeconds: 0 };
      }
    }
    this.#missCount += 1;
    this.#record({
      attemptId: input.attemptId,
      cacheKey,
      cacheHit: false,
      entrySemanticHash: sha256Value(null),
      audioSha256: input.audioSha256,
      windowType: input.windowType,
    });
    return null;
  }

  async put(input: {
    identity: SpeakerEvidenceCacheIdentity;
    inference: RawSpeakerInference;
  }): Promise<void> {
    if (this.#mode !== "read-write") return;
    const cacheKey = buildSpeakerEvidenceCacheKey(input.identity);
    const result = {
      standardTurns: input.inference.standardTurns,
      exclusiveTurns: input.inference.exclusiveTurns,
      confidenceStatus: input.inference.confidenceStatus,
      warnings: input.inference.warnings,
    };
    const entry = speakerEvidenceCacheEntrySchema.parse({
      schemaVersion: "1.0.0",
      requestType: "local-speaker-evidence",
      cacheKey,
      createdAt: new Date().toISOString(),
      requestIdentity: input.identity,
      result,
      semanticHash: sha256Value({ requestIdentity: input.identity, result }),
    });
    const output = cacheEntryPath(this.#root, cacheKey);
    await mkdir(path.dirname(output), { recursive: true });
    await atomicWriteJson(output, entry, { overwrite: true });
    this.#writeCount += 1;
  }

  manifest(input: {
    inferenceCount: number;
    modelLoadCount: number;
    generatedAt?: string;
  }): SpeakerEvidenceCacheManifest {
    const requests = [...this.#requests].toSorted((left, right) =>
      left.attemptId.localeCompare(right.attemptId),
    );
    const base = {
      schemaVersion: "1.0.0" as const,
      artifactType: "speaker-evidence-cache-manifest" as const,
      cacheVersion: "C5.18" as const,
      generatedAt: input.generatedAt ?? new Date().toISOString(),
      requestType: "local-speaker-evidence" as const,
      mode: this.#mode,
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
        requests.map((request) => ({
          attemptId: request.attemptId,
          cacheKey: request.cacheKey,
        })),
      ),
    };
    return speakerEvidenceCacheManifestSchema.parse({
      ...base,
      semanticHash: sha256Value({ ...base, generatedAt: null }),
    });
  }

  #record(value: SpeakerEvidenceCacheManifest["requests"][number]): void {
    const existing = this.#requests.findIndex(
      (request) => request.attemptId === value.attemptId,
    );
    if (existing >= 0) this.#requests.splice(existing, 1);
    this.#requests.push(value);
  }
}
