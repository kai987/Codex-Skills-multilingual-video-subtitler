import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  atomicWriteJson,
  c60114ProbeExecutionSchema,
  c60114ProbeCacheManifestSchema,
  c60114ProbePersistenceSchema,
  c60114ProbeRequestSchema,
  type C60114ProbeExecution,
  type C60114ProbeRequest,
  type C60114SourceIdentity,
} from "@mvl/shared";
import { machineQualitySemanticHash } from "../machine-quality/evidence-correlation.js";
import { c60114ProbeSemanticHash } from "./missing-dialogue-local-probe.js";

/** Fail before model construction when a CLI resolved stale built schemas. */
export function assertC60114ProbePersistenceSchema(): void {
  if (
    !("persistence" in c60114ProbeExecutionSchema.shape) ||
    !("budgetException" in c60114ProbeExecutionSchema.shape)
  )
    throw new Error("C60114_STALE_SHARED_SCHEMA_BUILD_REQUIRED");
}
export class C60114ProbePersistenceError extends Error {}

/** Write once before localization or final artifact validation. This is raw
 * recovery provenance, never a substitute for a validated cache entry. */
export async function writeC60114ProbeJournal(input: {
  directory: string;
  sourceIdentity: C60114SourceIdentity;
  request: C60114ProbeRequest;
  phase:
    | "PROVIDER_RAW"
    | "NORMALIZED_RESULT"
    | "INFERENCE_DISPATCH"
    | "FINAL_REQUEST";
  payload: unknown;
}): Promise<void> {
  const directory = path.join(input.directory, "request-journal");
  await mkdir(directory, { recursive: true });
  const core = {
    schemaVersion: "1.0.0",
    artifactType: "c6-0-1-14-probe-request-journal",
    sourceIdentity: input.sourceIdentity,
    sourceTimebase: "SOURCE_GLOBAL_SECONDS",
    runtimeGoldInputCount: 0,
    requestId: input.request.requestId,
    sourceIdentityHash: input.request.sourceIdentityHash,
    sourceMediaSha256: input.request.sourceMediaSha256,
    policyHash: input.request.policyHash,
    selectionHash: input.request.selectionHash,
    phase: input.phase,
    request: input.request,
    payload: input.payload,
  };
  try {
    await atomicWriteJson(
      path.join(directory, `${input.request.cacheKey}.${input.phase}.json`),
      { ...core, journalHash: machineQualitySemanticHash(core) },
    );
  } catch (error) {
    throw new C60114ProbePersistenceError("C60114_JOURNAL_WRITE_FAILED", {
      cause: error,
    });
  }
}

export async function writeC60114ProbeCacheManifest(input: {
  artifact: C60114ProbeExecution;
  cacheDirectory: string;
  outputDirectory: string;
}): Promise<void> {
  const artifact = input.artifact;
  if (!artifact.persistence)
    throw new Error("C60114_PERSISTENCE_PROOF_MISSING");
  await atomicWriteJson(
    path.join(input.outputDirectory, "probe-cache-manifest.local-only.json"),
    c60114ProbeCacheManifestSchema.parse({
      schemaVersion: "1.0.0",
      artifactType: "c6-0-1-14-probe-cache-manifest-local-only",
      sourceIdentity: artifact.sourceIdentity,
      sourceTimebase: "SOURCE_GLOBAL_SECONDS",
      runtimeGoldInputCount: 0,
      policyHash: artifact.policyHash,
      selectionHash: artifact.selectionHash,
      probeSemanticHash: artifact.semanticHash,
      cacheNamespace: artifact.cacheNamespace,
      cacheDirectory: path.resolve(input.cacheDirectory),
      persistence: artifact.persistence,
    }),
  );
}

export async function buildC60114ProbePersistence(input: {
  requests: readonly C60114ProbeRequest[];
  cacheDirectory: string;
  cacheNamespace: string;
}): Promise<NonNullable<C60114ProbeExecution["persistence"]>> {
  const entries: NonNullable<C60114ProbeExecution["persistence"]>["entries"] =
    [];
  for (const request of input.requests) {
    if (request.status === "CACHE_MISS" || request.status === "CACHE_INVALID")
      continue;
    const bytes = await readFile(
      path.join(
        input.cacheDirectory,
        input.cacheNamespace,
        request.provider,
        `${request.cacheKey}.json`,
      ),
    );
    const stored = c60114ProbeRequestSchema.parse(
      JSON.parse(bytes.toString("utf8")),
    );
    if (
      stored.requestId !== request.requestId ||
      stored.semanticHash !== request.semanticHash ||
      stored.semanticHash !== c60114ProbeSemanticHash(stored) ||
      stored.rawOutputHash !== request.rawOutputHash ||
      stored.rawOutputHash !==
        (stored.rawOutput === null
          ? null
          : machineQualitySemanticHash(stored.rawOutput))
    )
      throw new Error("C60114_PERSISTED_REQUEST_HASH_MISMATCH");
    entries.push({
      requestId: request.requestId,
      cacheKey: request.cacheKey,
      provider: request.provider,
      status: stored.status,
      requestSemanticHash: request.semanticHash,
      rawOutputHash: request.rawOutputHash,
      cacheByteSha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  const core = {
    resultCount: entries.length,
    persistedSuccessCount: entries.filter(
      (entry) =>
        (entry.status === "SUCCESS" || entry.status === "EMPTY_OUTPUT") &&
        entry.rawOutputHash !== null,
    ).length,
    entries,
  };
  return c60114ProbePersistenceSchema.parse({
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
}
