import {
  asrCacheMigrationArtifactSchema,
  type AsrCacheMigrationArtifact,
} from "@mvl/shared";

import type { PortableAsrCache, PortableAsrCacheLookup } from "./asr-cache.js";

export async function migrateAsrCacheRequests(input: {
  cache: PortableAsrCache;
  requests: readonly PortableAsrCacheLookup[];
}): Promise<AsrCacheMigrationArtifact> {
  const entries: AsrCacheMigrationArtifact["entries"] = [];
  for (const request of input.requests) {
    const lookup = await input.cache.lookup(request);
    const legacyKey = request.legacyKeys?.[0] ?? "not-computable";
    entries.push({
      requestId: request.requestId,
      legacyKey,
      legacyPath:
        lookup.hitType === "legacy"
          ? (lookup.selectedPath ?? "legacy-path-unavailable")
          : "not-found",
      currentKey: lookup.key,
      status:
        lookup.hitType === "legacy"
          ? "migrated"
          : lookup.hit
            ? "not-found"
            : "not-found",
      checks:
        lookup.hitType === "legacy"
          ? ["exact-legacy-key-match", "v2-envelope-written"]
          : ["no-compatible-legacy-entry"],
    });
  }
  return asrCacheMigrationArtifactSchema.parse({
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    importedRoots: input.cache.importRoots,
    entries,
    summary: {
      migratedEntryCount: entries.filter((entry) => entry.status === "migrated")
        .length,
      rejectedEntryCount: entries.filter((entry) => entry.status === "rejected")
        .length,
      corruptEntryCount: entries.filter((entry) => entry.status === "corrupt")
        .length,
    },
  });
}
