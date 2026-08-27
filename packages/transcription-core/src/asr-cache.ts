import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import {
  asrCacheManifestArtifactSchema,
  asrCacheMigrationArtifactSchema,
  portableAsrCacheEntryV2Schema,
  portableAsrCacheIdentityV2Schema,
  portableTranscriptionChunkResultSchema,
  type AsrCacheManifestArtifact,
  type AsrCacheMigrationArtifact,
  type PortableAsrCacheEntryV2,
  type PortableAsrCacheIdentityV2,
} from "@mvl/shared";

import type { TranscriptionChunkResult } from "./types.js";

export type AsrCacheMode = "off" | "read" | "read-write";
export type AsrCacheRequestType =
  | "baseline"
  | "refinement"
  | "recovery"
  | "lyrics"
  | "coverage-recovery"
  | "overlap-evidence";

export interface PortableAsrCacheOptions {
  portableRoot?: string;
  taskLocalRoot?: string;
  importRoots?: readonly string[];
  mode?: AsrCacheMode;
  migrateLegacy?: boolean;
  sourceOutputDirectory?: string | null;
}

export interface PortableAsrCacheLookup {
  requestId: string;
  requestType: AsrCacheRequestType;
  identity: PortableAsrCacheIdentityV2;
  legacyKeys?: readonly string[];
  legacyFileNames?: readonly string[];
  legacyV2Identity?: PortableAsrCacheIdentityV2;
  legacyV2Policy?: "reject" | "text-only";
}

export interface PortableAsrCacheLookupResult {
  key: string;
  hit: boolean;
  hitType: "portable" | "task-local-v2" | "legacy" | "miss" | "off";
  result: TranscriptionChunkResult | null;
  selectedPath: string | null;
  tokenTimingTrust: "current-identity" | "legacy-untrusted";
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .toSorted()
      .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashAsrPrompt(prompt: string | undefined): string {
  return sha256(prompt ?? "");
}

export function hashAsrDecodeConfiguration(value: unknown): string {
  return sha256(stable(value));
}

export function buildPortableAsrCacheIdentityV2(input: {
  audioContentSha256: string;
  interval: { start: number; end: number };
  sampleRate: number;
  channels: number;
  codec: string;
  adapterId: string;
  model: string;
  modelHash?: string | null;
  modelFamily?: string | null;
  coreML?: boolean | null;
  whisperCppVersion?: string | null;
  language?: PortableAsrCacheIdentityV2["language"];
  vadMode: string;
  timestampStrategy: string;
  tokenTimestamps: boolean;
  timestampMappingVersion?: string;
  timestampCoordinateSystem?: string;
  tokenHealthPolicyVersion?: string;
  runtimeTimestampCapabilityHash?: string;
  runtimeType?: "stock" | "mvl-patched" | "legacy-system";
  runtimeBinarySha256?: string;
  runtimeSourceCommit?: string | null;
  runtimePatchSha256?: string | null;
  runtimeResponseSchemaVersion?: string;
  rawVadPolicyVersion?: string;
  rawVadBoundaryPolicyVersion?: string;
  workerStateIsolationPolicyVersion?: string;
  prompt?: string;
  decodeConfiguration?: unknown;
}): PortableAsrCacheIdentityV2 {
  return portableAsrCacheIdentityV2Schema.parse({
    schemaVersion: "2.0.0",
    audioContentSha256: input.audioContentSha256,
    extractedIntervalMilliseconds: {
      start: Math.round(input.interval.start * 1000),
      end: Math.round(input.interval.end * 1000),
    },
    extraction: {
      sampleRate: input.sampleRate,
      channels: input.channels,
      codec: input.codec,
    },
    adapterId: input.adapterId,
    model: input.model,
    modelHash: input.modelHash ?? null,
    modelFamily: input.modelFamily ?? null,
    coreML: input.coreML ?? null,
    whisperCppVersion: input.whisperCppVersion ?? null,
    language: input.language ?? null,
    vadMode: input.vadMode,
    timestampStrategy: input.timestampStrategy,
    tokenTimestamps: input.tokenTimestamps,
    ...(input.timestampMappingVersion === undefined
      ? {}
      : { timestampMappingVersion: input.timestampMappingVersion }),
    ...(input.timestampCoordinateSystem === undefined
      ? {}
      : { timestampCoordinateSystem: input.timestampCoordinateSystem }),
    ...(input.tokenHealthPolicyVersion === undefined
      ? {}
      : { tokenHealthPolicyVersion: input.tokenHealthPolicyVersion }),
    ...(input.runtimeTimestampCapabilityHash === undefined
      ? {}
      : {
          runtimeTimestampCapabilityHash: input.runtimeTimestampCapabilityHash,
        }),
    ...(input.runtimeType === undefined
      ? {}
      : { runtimeType: input.runtimeType }),
    ...(input.runtimeBinarySha256 === undefined
      ? {}
      : { runtimeBinarySha256: input.runtimeBinarySha256 }),
    ...(input.runtimeSourceCommit === undefined
      ? {}
      : { runtimeSourceCommit: input.runtimeSourceCommit }),
    ...(input.runtimePatchSha256 === undefined
      ? {}
      : { runtimePatchSha256: input.runtimePatchSha256 }),
    ...(input.runtimeResponseSchemaVersion === undefined
      ? {}
      : {
          runtimeResponseSchemaVersion: input.runtimeResponseSchemaVersion,
        }),
    ...(input.rawVadPolicyVersion === undefined
      ? {}
      : { rawVadPolicyVersion: input.rawVadPolicyVersion }),
    ...(input.rawVadBoundaryPolicyVersion === undefined
      ? {}
      : { rawVadBoundaryPolicyVersion: input.rawVadBoundaryPolicyVersion }),
    ...(input.workerStateIsolationPolicyVersion === undefined
      ? {}
      : {
          workerStateIsolationPolicyVersion:
            input.workerStateIsolationPolicyVersion,
        }),
    promptSha256: hashAsrPrompt(input.prompt),
    decodeConfigurationSha256: hashAsrDecodeConfiguration(
      input.decodeConfiguration ?? {},
    ),
  });
}

export function buildPortableAsrCacheKey(
  identity: PortableAsrCacheIdentityV2,
): string {
  return sha256(stable(portableAsrCacheIdentityV2Schema.parse(identity)));
}

export function buildLegacyBaselineCacheKeyV1(input: {
  sha256: string;
  interval: { start: number; end: number };
  adapterId: string;
  model: string;
  modelHash: string | null;
  modelFamily: string | null;
  coreML: boolean | null;
  whisperCppVersion: string | null;
  prompt: string;
  timestampStrategy: string;
}): string {
  return sha256(JSON.stringify(input));
}

export function buildLegacyRefinementCacheKeyV1(input: unknown): string {
  return sha256(JSON.stringify(input));
}

export function buildLegacyRecoveryCacheKeyV1(input: unknown): string {
  return sha256(JSON.stringify(input));
}

export function buildLegacyLyricsCacheKeyV1(input: unknown): string {
  return sha256(JSON.stringify(input));
}

export function defaultPortableAsrCacheRoot(): string {
  const configured = process.env.MVL_ASR_CACHE_DIR;
  if (configured !== undefined && configured.trim() !== "") {
    return path.resolve(configured);
  }
  const xdg = process.env.XDG_CACHE_HOME;
  return path.join(
    xdg === undefined || xdg.trim() === ""
      ? path.join(homedir(), ".cache")
      : xdg,
    "multilingual-video-subtitler",
    "asr-v2",
  );
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

async function atomicWrite(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${randomUUID()}.tmp`,
  );
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  try {
    await rename(temporaryPath, filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

function cachePath(root: string, key: string): string {
  return path.join(root, key.slice(0, 2), `${key}.json`);
}

function entryCompatible(
  entry: PortableAsrCacheEntryV2,
  identity: PortableAsrCacheIdentityV2,
  key: string,
): string[] | null {
  const checks: string[] = [];
  if (entry.cacheKey !== key) return null;
  checks.push("cache-key-match");
  if (stable(entry.identity) !== stable(identity)) return null;
  checks.push("identity-exact-match");
  if (entry.resultSha256 !== sha256(stable(entry.result))) return null;
  checks.push("result-sha256-match");
  return checks;
}

export class PortableAsrCache {
  readonly portableRoot: string;
  readonly taskLocalRoot: string | null;
  readonly importRoots: string[];
  readonly mode: AsrCacheMode;
  readonly migrateLegacy: boolean;
  readonly sourceOutputDirectory: string | null;
  private readonly entries: AsrCacheManifestArtifact["entries"] = [];
  private readonly legacyAuditEntries: AsrCacheMigrationArtifact["entries"] =
    [];
  private migratedEntryCount = 0;
  private rejectedLegacyEntryCount = 0;
  private corruptEntryCount = 0;
  private writtenEntryCount = 0;

  constructor(options: PortableAsrCacheOptions = {}) {
    this.portableRoot = path.resolve(
      options.portableRoot ?? defaultPortableAsrCacheRoot(),
    );
    this.taskLocalRoot =
      options.taskLocalRoot === undefined
        ? null
        : path.resolve(options.taskLocalRoot);
    this.importRoots = (options.importRoots ?? []).map((root) =>
      path.resolve(root),
    );
    this.mode = options.mode ?? "read-write";
    this.migrateLegacy = options.migrateLegacy ?? true;
    this.sourceOutputDirectory = options.sourceOutputDirectory ?? null;
  }

  private async readV2(
    filePath: string,
    identity: PortableAsrCacheIdentityV2,
    key: string,
  ): Promise<{ result: TranscriptionChunkResult; checks: string[] } | null> {
    if (!(await exists(filePath))) return null;
    try {
      const parsed = portableAsrCacheEntryV2Schema.parse(
        await readJson(filePath),
      );
      const checks = entryCompatible(parsed, identity, key);
      if (checks === null) {
        this.corruptEntryCount += 1;
        return null;
      }
      return { result: parsed.result, checks };
    } catch {
      this.corruptEntryCount += 1;
      return null;
    }
  }

  private legacyPaths(input: PortableAsrCacheLookup): string[] {
    const names =
      input.legacyFileNames ??
      (input.legacyKeys ?? []).flatMap((key) => [
        `${key}.json`,
        `refinement-${key}.json`,
        `recovery-${key}.json`,
        `lyrics-${key}.json`,
      ]);
    return this.importRoots.flatMap((root) =>
      names.flatMap((name) => [
        path.join(root, "audio", "transcription-cache", name),
        path.join(root, "transcription-cache", name),
        path.join(root, name),
      ]),
    );
  }

  async lookup(
    input: PortableAsrCacheLookup,
  ): Promise<PortableAsrCacheLookupResult> {
    const identity = portableAsrCacheIdentityV2Schema.parse(input.identity);
    const key = buildPortableAsrCacheKey(identity);
    const legacyKeys = [...(input.legacyKeys ?? [])];
    if (this.mode === "off") {
      this.entries.push({
        requestId: input.requestId,
        requestType: input.requestType,
        currentKey: key,
        legacyKeysTried: legacyKeys,
        selectedPath: null,
        hitType: "off",
        compatibilityChecks: ["cache-disabled"],
        migrationStatus: "disabled",
      });
      return {
        key,
        hit: false,
        hitType: "off",
        result: null,
        selectedPath: null,
        tokenTimingTrust: "current-identity",
      };
    }
    const portablePath = cachePath(this.portableRoot, key);
    const portable = await this.readV2(portablePath, identity, key);
    if (portable !== null) {
      this.entries.push({
        requestId: input.requestId,
        requestType: input.requestType,
        currentKey: key,
        legacyKeysTried: legacyKeys,
        selectedPath: portablePath,
        hitType: "portable",
        compatibilityChecks: portable.checks,
        migrationStatus: "not-needed",
      });
      return {
        key,
        hit: true,
        hitType: "portable",
        result: portable.result,
        selectedPath: portablePath,
        tokenTimingTrust: "current-identity",
      };
    }
    if (this.taskLocalRoot !== null) {
      const taskPath = cachePath(this.taskLocalRoot, key);
      const task = await this.readV2(taskPath, identity, key);
      if (task !== null) {
        this.entries.push({
          requestId: input.requestId,
          requestType: input.requestType,
          currentKey: key,
          legacyKeysTried: legacyKeys,
          selectedPath: taskPath,
          hitType: "task-local-v2",
          compatibilityChecks: task.checks,
          migrationStatus: "not-needed",
        });
        return {
          key,
          hit: true,
          hitType: "task-local-v2",
          result: task.result,
          selectedPath: taskPath,
          tokenTimingTrust: "current-identity",
        };
      }
    }
    const currentRoots = new Set(
      [this.portableRoot, this.taskLocalRoot]
        .filter((root): root is string => root !== null)
        .map((root) => path.resolve(root)),
    );
    for (const root of this.importRoots) {
      if (currentRoots.has(root)) continue;
      const importedPath = cachePath(root, key);
      const imported = await this.readV2(importedPath, identity, key);
      if (imported === null) continue;
      const migrated = this.migrateLegacy && this.mode === "read-write";
      if (migrated) {
        await this.writeEntry({
          key,
          identity,
          result: imported.result,
          requestType: input.requestType,
          migratedFromLegacyKey: key,
          migratedFromPath: importedPath,
        });
        this.migratedEntryCount += 1;
      }
      this.entries.push({
        requestId: input.requestId,
        requestType: input.requestType,
        currentKey: key,
        legacyKeysTried: legacyKeys,
        selectedPath: importedPath,
        hitType: "portable",
        compatibilityChecks: [...imported.checks, "import-root-v2-exact-match"],
        migrationStatus: migrated ? "migrated" : "not-needed",
      });
      return {
        key,
        hit: true,
        hitType: "portable",
        result: imported.result,
        selectedPath: importedPath,
        tokenTimingTrust: "current-identity",
      };
    }
    if (input.legacyV2Identity !== undefined) {
      const legacyIdentity = portableAsrCacheIdentityV2Schema.parse(
        input.legacyV2Identity,
      );
      const legacyKey = buildPortableAsrCacheKey(legacyIdentity);
      const roots = [
        this.portableRoot,
        ...(this.taskLocalRoot === null ? [] : [this.taskLocalRoot]),
        ...this.importRoots,
      ];
      for (const root of [...new Set(roots)]) {
        const legacyPath = cachePath(root, legacyKey);
        const legacy = await this.readV2(legacyPath, legacyIdentity, legacyKey);
        if (legacy === null) continue;
        if ((input.legacyV2Policy ?? "reject") === "reject") {
          this.rejectedLegacyEntryCount += 1;
          this.legacyAuditEntries.push({
            requestId: input.requestId,
            legacyKey,
            legacyPath,
            currentKey: key,
            status: "rejected",
            checks: [
              "legacy-v2-identity-exact-match",
              "timestamp-semantics-unversioned",
              "legacy-overlap-cache-policy-reject",
            ],
          });
          continue;
        }
        this.entries.push({
          requestId: input.requestId,
          requestType: input.requestType,
          currentKey: key,
          legacyKeysTried: [legacyKey],
          selectedPath: legacyPath,
          hitType: "legacy",
          compatibilityChecks: [
            ...legacy.checks,
            "timestamp-semantics-unversioned",
            "token-timing-quarantined-text-only",
          ],
          migrationStatus: "not-needed",
        });
        return {
          key,
          hit: true,
          hitType: "legacy",
          result: legacy.result,
          selectedPath: legacyPath,
          tokenTimingTrust: "legacy-untrusted",
        };
      }
    }
    for (const legacyPath of this.legacyPaths(input)) {
      if (!(await exists(legacyPath))) continue;
      const legacyKey = path
        .basename(legacyPath)
        .replace(/^(?:refinement|recovery|lyrics)-/u, "")
        .replace(/\.json$/u, "");
      let rawLegacyResult: unknown;
      try {
        rawLegacyResult = await readJson(legacyPath);
      } catch {
        this.corruptEntryCount += 1;
        this.legacyAuditEntries.push({
          requestId: input.requestId,
          legacyKey,
          legacyPath,
          currentKey: key,
          status: "corrupt",
          checks: ["legacy-json-unreadable"],
        });
        continue;
      }
      const parsedLegacyResult =
        portableTranscriptionChunkResultSchema.safeParse(rawLegacyResult);
      if (!parsedLegacyResult.success) {
        this.rejectedLegacyEntryCount += 1;
        this.legacyAuditEntries.push({
          requestId: input.requestId,
          legacyKey,
          legacyPath,
          currentKey: key,
          status: "rejected",
          checks: ["legacy-result-current-schema-invalid"],
        });
        continue;
      }
      if (!legacyKeys.includes(legacyKey)) {
        this.rejectedLegacyEntryCount += 1;
        this.legacyAuditEntries.push({
          requestId: input.requestId,
          legacyKey,
          legacyPath,
          currentKey: key,
          status: "rejected",
          checks: ["legacy-key-not-an-exact-recomputed-key"],
        });
        continue;
      }
      const result = parsedLegacyResult.data;
      if (this.migrateLegacy && this.mode === "read-write") {
        await this.writeEntry({
          key,
          identity,
          result,
          requestType: input.requestType,
          migratedFromLegacyKey: legacyKey,
          migratedFromPath: legacyPath,
        });
        this.migratedEntryCount += 1;
      }
      this.entries.push({
        requestId: input.requestId,
        requestType: input.requestType,
        currentKey: key,
        legacyKeysTried: legacyKeys,
        selectedPath: legacyPath,
        hitType: "legacy",
        compatibilityChecks: [
          "legacy-key-recomputed-exactly",
          "legacy-result-current-schema-valid",
          "current-request-identity-used-for-v2-envelope",
        ],
        migrationStatus:
          this.migrateLegacy && this.mode === "read-write"
            ? "migrated"
            : "not-needed",
      });
      return {
        key,
        hit: true,
        hitType: "legacy",
        result,
        selectedPath: legacyPath,
        tokenTimingTrust: "legacy-untrusted",
      };
    }
    this.entries.push({
      requestId: input.requestId,
      requestType: input.requestType,
      currentKey: key,
      legacyKeysTried: legacyKeys,
      selectedPath: null,
      hitType: "miss",
      compatibilityChecks: [
        "portable-miss",
        "task-local-v2-miss",
        "exact-legacy-key-miss",
      ],
      migrationStatus: "not-needed",
    });
    return {
      key,
      hit: false,
      hitType: "miss",
      result: null,
      selectedPath: null,
      tokenTimingTrust: "current-identity",
    };
  }

  private async writeEntry(input: {
    key: string;
    identity: PortableAsrCacheIdentityV2;
    result: TranscriptionChunkResult;
    requestType: AsrCacheRequestType;
    migratedFromLegacyKey?: string | null;
    migratedFromPath?: string | null;
  }): Promise<void> {
    const result = portableTranscriptionChunkResultSchema.parse(input.result);
    const entry = portableAsrCacheEntryV2Schema.parse({
      schemaVersion: "2.0.0",
      createdAt: new Date().toISOString(),
      cacheKey: input.key,
      identity: input.identity,
      result,
      provenance: {
        requestType: input.requestType,
        sourceOutputDirectory: this.sourceOutputDirectory,
        migratedFromLegacyKey: input.migratedFromLegacyKey ?? null,
        migratedFromPath: input.migratedFromPath ?? null,
      },
      resultSha256: sha256(stable(result)),
    });
    const roots = [
      this.portableRoot,
      ...(this.taskLocalRoot === null ? [] : [this.taskLocalRoot]),
    ];
    for (const root of roots) {
      const target = cachePath(root, input.key);
      if (!(await exists(target))) await atomicWrite(target, entry);
    }
    this.writtenEntryCount += 1;
  }

  async store(
    input: PortableAsrCacheLookup & { result: TranscriptionChunkResult },
  ): Promise<string> {
    const key = buildPortableAsrCacheKey(input.identity);
    if (this.mode === "read-write") {
      await this.writeEntry({
        key,
        identity: input.identity,
        result: input.result,
        requestType: input.requestType,
      });
    }
    return key;
  }

  manifest(): AsrCacheManifestArtifact {
    const count = (
      hitType: AsrCacheManifestArtifact["entries"][number]["hitType"],
    ): number =>
      this.entries.filter((entry) => entry.hitType === hitType).length;
    const avoided =
      count("portable") + count("task-local-v2") + count("legacy");
    const workerLifecycleAvoided =
      this.entries.length > 0 && count("miss") === 0 ? 1 : 0;
    return asrCacheManifestArtifactSchema.parse({
      schemaVersion: "1.0.0",
      generatedAt: new Date().toISOString(),
      portableRoot: this.mode === "off" ? null : this.portableRoot,
      mode: this.mode,
      summary: {
        requestCount: this.entries.length,
        portableHitCount: count("portable"),
        taskLocalHitCount: count("task-local-v2"),
        legacyHitCount: count("legacy"),
        migratedEntryCount: this.migratedEntryCount,
        missCount: count("miss"),
        rejectedLegacyEntryCount: this.rejectedLegacyEntryCount,
        corruptEntryCount: this.corruptEntryCount,
        writtenEntryCount: this.writtenEntryCount,
        workerRequestsAvoided: avoided,
        workerStartsAvoided: workerLifecycleAvoided,
        modelLoadsAvoided: workerLifecycleAvoided,
      },
      entries: this.entries,
    });
  }

  migrationArtifact(): AsrCacheMigrationArtifact {
    const migrated = this.entries.filter(
      (entry) => entry.migrationStatus === "migrated",
    );
    const rejected = this.entries.filter(
      (entry) => entry.migrationStatus === "rejected",
    );
    return asrCacheMigrationArtifactSchema.parse({
      schemaVersion: "1.0.0",
      generatedAt: new Date().toISOString(),
      importedRoots: this.importRoots,
      entries: [
        ...migrated.map((entry) => ({
          requestId: entry.requestId,
          legacyKey: entry.legacyKeysTried[0] ?? "unknown",
          legacyPath: entry.selectedPath ?? "unknown",
          currentKey: entry.currentKey,
          status: "migrated" as const,
          checks: entry.compatibilityChecks,
        })),
        ...rejected.map((entry) => ({
          requestId: entry.requestId,
          legacyKey: entry.legacyKeysTried[0] ?? "unknown",
          legacyPath: entry.selectedPath ?? "unknown",
          currentKey: entry.currentKey,
          status: "rejected" as const,
          checks: entry.compatibilityChecks,
        })),
        ...this.legacyAuditEntries,
      ],
      summary: {
        migratedEntryCount: migrated.length,
        rejectedEntryCount:
          rejected.length +
          this.legacyAuditEntries.filter((entry) => entry.status === "rejected")
            .length,
        corruptEntryCount: this.corruptEntryCount,
      },
    });
  }
}
