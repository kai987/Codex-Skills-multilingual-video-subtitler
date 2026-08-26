import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import {
  atomicWriteJson,
  c5161ShareableExecutionSummarySchema,
  c516StockPatchedRuntimeAbArtifactSchema,
  c517ForcedAlignmentReplaySummarySchema,
  forcedAlignmentRuntimeCapabilitySchema,
  forcedAlignmentCacheManifestSchema,
  shareableArtifactManifestSchema,
  subtitleFinalizationReportSchema,
  subtitleOverlapAcousticResolutionSchema,
  subtitlePresentationResolutionSchema,
  subtitleTimestampEvidenceIntegritySchema,
  subtitleCanonicalAlignmentInputSchema,
  subtitleCanonicalForcedAlignmentSchema,
  subtitleCanonicalPronunciationSchema,
  sudachiRuntimeCapabilitySchema,
  mfaSampleProbeSchema,
  c5171RuntimePreparationSummarySchema,
  c5171FreshCacheObserveValidationSchema,
  c5172ReviewDeliveryReplaySummarySchema,
  subtitleReviewDeliveryIntegritySchema,
  reviewActionValidationReportSchema,
  whisperRuntimeCapabilityArtifactSchema,
  type ShareableArtifactManifest,
  type C516StockPatchedRuntimeAbArtifact,
} from "@mvl/shared";
import type { z } from "zod";

const SHAREABLE_POLICY_VERSION =
  "c5.16.1-shareable-artifact-policy-v1" as const;
const C517_SHAREABLE_POLICY_VERSION =
  "c5.17-shareable-artifact-policy-v1" as const;
const C5171_SHAREABLE_POLICY_VERSION =
  "c5.17.1-shareable-artifact-policy-v1" as const;
const C5172_SHAREABLE_POLICY_VERSION =
  "c5.17.2-shareable-artifact-policy-v1" as const;
const C518_SHAREABLE_POLICY_VERSION =
  "c5.18-shareable-artifact-policy-v1" as const;

const artifactSchemas = {
  "subtitle-finalization-report.json": subtitleFinalizationReportSchema,
  "subtitle-presentation-resolution.json": subtitlePresentationResolutionSchema,
  "subtitle-overlap-acoustic-resolution.json":
    subtitleOverlapAcousticResolutionSchema,
  "subtitle-timestamp-evidence-integrity.json":
    subtitleTimestampEvidenceIntegritySchema,
  "whisper-runtime-capability.json": whisperRuntimeCapabilityArtifactSchema,
  "c5-16-stock-patched-runtime-ab.json":
    c516StockPatchedRuntimeAbArtifactSchema,
  "execution-summary.json": c5161ShareableExecutionSummarySchema,
  "forced-alignment-runtime-capability.json":
    forcedAlignmentRuntimeCapabilitySchema,
  "subtitle-canonical-alignment-input.json":
    subtitleCanonicalAlignmentInputSchema,
  "subtitle-canonical-forced-alignment.json":
    subtitleCanonicalForcedAlignmentSchema,
  "c5-17-forced-alignment-replay-summary.json":
    c517ForcedAlignmentReplaySummarySchema,
  "subtitle-canonical-pronunciation.json": subtitleCanonicalPronunciationSchema,
  "sudachi-runtime-capability.json": sudachiRuntimeCapabilitySchema,
  "forced-alignment-cache-manifest.json": forcedAlignmentCacheManifestSchema,
  "mfa-sample-probe.json": mfaSampleProbeSchema,
  "c5-17-1-runtime-preparation-summary.json":
    c5171RuntimePreparationSummarySchema,
  "c5-17-1-fresh-cache-observe-validation.json":
    c5171FreshCacheObserveValidationSchema,
  "subtitle-review-delivery-integrity.json":
    subtitleReviewDeliveryIntegritySchema,
  "c5-17-2-review-delivery-replay-summary.json":
    c5172ReviewDeliveryReplaySummarySchema,
  "review-action-validation-report.json": reviewActionValidationReportSchema,
} as const;

type ShareableSchema = (typeof artifactSchemas)[keyof typeof artifactSchemas];

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => {
      hash.update(chunk);
    });
    stream.once("error", reject);
    stream.once("end", resolve);
  });
  return hash.digest("hex");
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

function isAllowedUri(value: string): boolean {
  return /^(?:https?|git\+https?|ssh):\/\//iu.test(value);
}

export function shareablePathLeakReasons(value: string): string[] {
  if (isAllowedUri(value)) return [];
  const reasons: string[] = [];
  if (/(?:^|[\s"'=:(,])file:\/\//iu.test(value)) reasons.push("FILE_URI");
  if (/(?:^|[\s"'=:(,])\/(?!\/)/u.test(value)) {
    reasons.push("POSIX_ABSOLUTE_PATH");
  }
  if (/(?:^|[\s"'=:(,])\/[Uu]sers\//u.test(value)) {
    reasons.push("MACOS_USER_PATH");
  }
  if (/(?:^|[\s"'=:(,])\/home\//u.test(value)) {
    reasons.push("LINUX_HOME_PATH");
  }
  if (/(?:^|[\s"'=:(,])\/(?:tmp|private\/var|var\/folders)\//u.test(value)) {
    reasons.push("TEMPORARY_PRIVATE_PATH");
  }
  if (/(?:^|[\s"'=:(,])[A-Za-z]:[\\/]/u.test(value)) {
    reasons.push("WINDOWS_DRIVE_PATH");
  }
  if (/(?:^|[\s"'=:(,])(?:\\\\|\/\/)[^/\\]+[\\/]/u.test(value)) {
    reasons.push("UNC_PATH");
  }
  if (
    /(?:^|[\s"'=:(,])(?:~\/|\$HOME(?:\/|$)|\$\{HOME\}|%USERPROFILE%)/u.test(
      value,
    )
  ) {
    reasons.push("HOME_OR_USER_EXPANSION");
  }
  if (
    /(?:^|[\\/])(?:\.cache|Caches|models?|build)(?:[\\/]|$)/iu.test(value) &&
    /[\\/]/u.test(value)
  ) {
    reasons.push("MODEL_CACHE_OR_BUILD_PATH");
  }
  return [...new Set(reasons)].toSorted();
}

export function shareableSecretReasons(input: {
  key: string | null;
  value: string;
}): string[] {
  const reasons: string[] = [];
  if (/\bsk-[A-Za-z0-9_-]{16,}\b/u.test(input.value)) {
    reasons.push("OPENAI_API_KEY");
  }
  if (/\bgh[pousr]_[A-Za-z0-9]{20,}\b/u.test(input.value)) {
    reasons.push("GITHUB_TOKEN");
  }
  if (/\bBearer\s+[A-Za-z0-9._~+/-]{8,}/iu.test(input.value)) {
    reasons.push("BEARER_TOKEN");
  }
  if (
    input.key !== null &&
    /^(?:authorization|cookie|set-cookie|api[_-]?key|access[_-]?token)$/iu.test(
      input.key,
    ) &&
    input.value.trim() !== ""
  ) {
    reasons.push("SECRET_BEARING_FIELD");
  }
  return [...new Set(reasons)].toSorted();
}

export interface ShareableScanResult {
  absolutePathLeakCount: number;
  prohibitedSecretCount: number;
  findings: {
    jsonPath: string;
    kind: "path" | "secret";
    reasons: string[];
  }[];
}

export function scanShareableValue(value: unknown): ShareableScanResult {
  const findings: ShareableScanResult["findings"] = [];
  const visit = (
    current: unknown,
    jsonPath: string,
    key: string | null,
  ): void => {
    if (typeof current === "string") {
      const pathReasons = shareablePathLeakReasons(current);
      if (pathReasons.length > 0) {
        findings.push({ jsonPath, kind: "path", reasons: pathReasons });
      }
      const secretReasons = shareableSecretReasons({ key, value: current });
      if (secretReasons.length > 0) {
        findings.push({ jsonPath, kind: "secret", reasons: secretReasons });
      }
      return;
    }
    if (Array.isArray(current)) {
      current.forEach((item, index) => {
        visit(item, `${jsonPath}[${String(index)}]`, null);
      });
      return;
    }
    if (current !== null && typeof current === "object") {
      for (const [entryKey, entryValue] of Object.entries(current)) {
        visit(entryValue, `${jsonPath}.${entryKey}`, entryKey);
      }
    }
  };
  visit(value, "$", null);
  return {
    absolutePathLeakCount: findings.filter((item) => item.kind === "path")
      .length,
    prohibitedSecretCount: findings.filter((item) => item.kind === "secret")
      .length,
    findings,
  };
}

function sanitizeString(input: {
  value: string;
  key: string | null;
  taskRoot: string;
}): { value: string; pathReplaced: boolean; secretRedacted: boolean } {
  const secret = shareableSecretReasons({ key: input.key, value: input.value });
  if (secret.length > 0) {
    return {
      value: "[REDACTED]",
      pathReplaced: false,
      secretRedacted: true,
    };
  }
  if (isAllowedUri(input.value)) {
    return {
      value: input.value,
      pathReplaced: false,
      secretRedacted: false,
    };
  }
  if (shareablePathLeakReasons(input.value).length === 0) {
    return {
      value: input.value,
      pathReplaced: false,
      secretRedacted: false,
    };
  }
  const standalonePath =
    /^(?:file:\/\/)?(?:\/|[A-Za-z]:[\\/]|\\\\|~\/|\$HOME(?:\/|$)|\$\{HOME\}|%USERPROFILE%)/iu.test(
      input.value,
    );
  if (!standalonePath) {
    return {
      value: "[PATH_REDACTED]",
      pathReplaced: true,
      secretRedacted: false,
    };
  }
  const withoutFileUri = input.value.replace(/^file:\/\//iu, "");
  const resolved = path.resolve(withoutFileUri);
  const relative = path.relative(input.taskRoot, resolved);
  const insideTask =
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative);
  return {
    value: insideTask
      ? relative.split(path.sep).join(path.posix.sep)
      : path.basename(withoutFileUri),
    pathReplaced: true,
    secretRedacted: false,
  };
}

export function sanitizeShareableValue(input: {
  value: unknown;
  taskRoot: string;
}): {
  value: unknown;
  pathReplacementCount: number;
  secretRedactionCount: number;
} {
  let pathReplacementCount = 0;
  let secretRedactionCount = 0;
  const visit = (current: unknown, key: string | null): unknown => {
    if (typeof current === "string") {
      const sanitized = sanitizeString({
        value: current,
        key,
        taskRoot: input.taskRoot,
      });
      pathReplacementCount += Number(sanitized.pathReplaced);
      secretRedactionCount += Number(sanitized.secretRedacted);
      return sanitized.value;
    }
    if (Array.isArray(current)) return current.map((item) => visit(item, null));
    if (current !== null && typeof current === "object") {
      return Object.fromEntries(
        Object.entries(current).map(([entryKey, entryValue]) => [
          entryKey,
          visit(entryValue, entryKey),
        ]),
      );
    }
    return current;
  };
  return {
    value: visit(input.value, null),
    pathReplacementCount,
    secretRedactionCount,
  };
}

async function fileMetadata(input: {
  role: string;
  filePath: string;
}): Promise<{
  role: string;
  fileName: string;
  size: number;
  mtimeMs: number;
  sha256: string;
  path: null;
}> {
  const [fileSha256, info] = await Promise.all([
    sha256File(input.filePath),
    stat(input.filePath),
  ]);
  return {
    role: input.role,
    fileName: path.basename(input.filePath),
    size: info.size,
    mtimeMs: info.mtimeMs,
    sha256: fileSha256,
    path: null,
  };
}

function schemaFor(name: keyof typeof artifactSchemas): ShareableSchema {
  return artifactSchemas[name];
}

export function migrateC516AbMetricSemantics(
  value: unknown,
): C516StockPatchedRuntimeAbArtifact {
  const legacy = c516StockPatchedRuntimeAbArtifactSchema.parse(value);
  const requestPairs = legacy.requestPairs.map((pair) => ({
    ...pair,
    stockRawGroupedWordHash:
      pair.stockRawGroupedWordHash ?? pair.stockRawTokenHash,
    patchedRawGroupedWordHash:
      pair.patchedRawGroupedWordHash ?? pair.patchedRawTokenHash,
    // C5.16 always emitted grouped word arrays for both runtimes. Its
    // `rawTokensComparable` boolean actually carried the equality result.
    rawGroupedWordsComparable: true,
    rawGroupedWordsEqual: pair.rawGroupedWordsEqual ?? pair.rawTokensComparable,
    individualRawTokenParityStatus:
      pair.individualRawTokenParityStatus ??
      ("not-observable-on-stock-server" as const),
    individualRawTokensComparable: pair.individualRawTokensComparable ?? false,
    individualRawTokensEqual: pair.individualRawTokensEqual ?? null,
  }));
  const perProfile = legacy.perProfile.map((profile) => ({
    ...profile,
    rawGroupedWordParityCount:
      profile.rawGroupedWordParityCount ?? profile.rawTokenParityCount,
    individualRawTokenComparablePairCount:
      profile.individualRawTokenComparablePairCount ?? 0,
  }));
  return c516StockPatchedRuntimeAbArtifactSchema.parse({
    ...legacy,
    requestPairs,
    perProfile,
    summary: {
      ...legacy.summary,
      rawGroupedWordParityPassed:
        legacy.summary.rawGroupedWordParityPassed ??
        legacy.summary.rawTokenParityPassed,
      rawGroupedWordComparablePairCount:
        legacy.summary.rawGroupedWordComparablePairCount ??
        requestPairs.filter((pair) => pair.rawGroupedWordsComparable).length,
      individualRawTokenParityStatus:
        legacy.summary.individualRawTokenParityStatus ??
        "not-observable-on-stock-server",
      individualRawTokenComparablePairCount:
        legacy.summary.individualRawTokenComparablePairCount ?? 0,
      individualRawTokenParityPassed:
        legacy.summary.individualRawTokenParityPassed ?? null,
    },
  });
}

export async function generateC5161ShareableArtifacts(input: {
  taskRoot: string;
  subtitleDirectory: string;
  localExecutionSummaryPath: string;
  stockPatchedRuntimeAbPath: string;
  outputDirectory?: string;
  externalFiles: readonly { role: string; filePath: string }[];
  c517Artifacts?: {
    runtimeCapabilityPath: string;
    canonicalInputPath: string;
    forcedAlignmentPath: string;
    replaySummaryPath: string;
    pronunciationPath?: string;
    sudachiRuntimeCapabilityPath?: string;
    cacheManifestPath?: string;
    sampleProbePath?: string;
    runtimePreparationSummaryPath?: string;
    freshCacheObserveValidationPath?: string;
  };
  c5172Artifacts?: {
    deliveryIntegrityPath: string;
    replaySummaryPath: string;
    reviewActionValidationReportPath?: string;
  };
}): Promise<{
  outputDirectory: string;
  manifestPath: string;
  manifest: ShareableArtifactManifest;
}> {
  const taskRoot = path.resolve(input.taskRoot);
  const outputDirectory = path.resolve(
    input.outputDirectory ?? path.join(taskRoot, "shareable"),
  );
  await mkdir(outputDirectory, { recursive: true });
  const sources: {
    name: keyof typeof artifactSchemas;
    sourcePath: string;
  }[] = [
    {
      name: "subtitle-finalization-report.json",
      sourcePath: path.join(
        input.subtitleDirectory,
        "subtitle-finalization-report.json",
      ),
    },
    {
      name: "subtitle-presentation-resolution.json",
      sourcePath: path.join(
        input.subtitleDirectory,
        "subtitle-presentation-resolution.json",
      ),
    },
    {
      name: "subtitle-overlap-acoustic-resolution.json",
      sourcePath: path.join(
        input.subtitleDirectory,
        "subtitle-overlap-acoustic-resolution.json",
      ),
    },
    {
      name: "subtitle-timestamp-evidence-integrity.json",
      sourcePath: path.join(
        input.subtitleDirectory,
        "subtitle-timestamp-evidence-integrity.json",
      ),
    },
    {
      name: "whisper-runtime-capability.json",
      sourcePath: path.join(
        input.subtitleDirectory,
        "whisper-runtime-capability.json",
      ),
    },
    {
      name: "c5-16-stock-patched-runtime-ab.json",
      sourcePath: path.resolve(input.stockPatchedRuntimeAbPath),
    },
  ];
  if (input.c517Artifacts !== undefined) {
    sources.push(
      {
        name: "forced-alignment-runtime-capability.json",
        sourcePath: path.resolve(input.c517Artifacts.runtimeCapabilityPath),
      },
      {
        name: "subtitle-canonical-alignment-input.json",
        sourcePath: path.resolve(input.c517Artifacts.canonicalInputPath),
      },
      {
        name: "subtitle-canonical-forced-alignment.json",
        sourcePath: path.resolve(input.c517Artifacts.forcedAlignmentPath),
      },
      {
        name: "c5-17-forced-alignment-replay-summary.json",
        sourcePath: path.resolve(input.c517Artifacts.replaySummaryPath),
      },
    );
    for (const [name, sourcePath] of [
      [
        "subtitle-canonical-pronunciation.json",
        input.c517Artifacts.pronunciationPath,
      ],
      [
        "sudachi-runtime-capability.json",
        input.c517Artifacts.sudachiRuntimeCapabilityPath,
      ],
      [
        "forced-alignment-cache-manifest.json",
        input.c517Artifacts.cacheManifestPath,
      ],
      ["mfa-sample-probe.json", input.c517Artifacts.sampleProbePath],
      [
        "c5-17-1-runtime-preparation-summary.json",
        input.c517Artifacts.runtimePreparationSummaryPath,
      ],
      [
        "c5-17-1-fresh-cache-observe-validation.json",
        input.c517Artifacts.freshCacheObserveValidationPath,
      ],
    ] as const) {
      if (sourcePath !== undefined) {
        sources.push({ name, sourcePath: path.resolve(sourcePath) });
      }
    }
  }
  if (input.c5172Artifacts !== undefined) {
    sources.push(
      {
        name: "subtitle-review-delivery-integrity.json",
        sourcePath: path.resolve(input.c5172Artifacts.deliveryIntegrityPath),
      },
      {
        name: "c5-17-2-review-delivery-replay-summary.json",
        sourcePath: path.resolve(input.c5172Artifacts.replaySummaryPath),
      },
    );
    if (input.c5172Artifacts.reviewActionValidationReportPath !== undefined) {
      sources.push({
        name: "review-action-validation-report.json",
        sourcePath: path.resolve(
          input.c5172Artifacts.reviewActionValidationReportPath,
        ),
      });
    }
  }
  const sourceHashes = await Promise.all(
    sources.map(async (source) => sha256(await readFile(source.sourcePath))),
  );
  const taskIdentityHash = sha256(
    stable(
      sources.map((source, index) => ({
        name: source.name,
        hash: sourceHashes[index],
      })),
    ),
  );
  const localSummaryBuffer = await readFile(input.localExecutionSummaryPath);
  const localSummary = JSON.parse(localSummaryBuffer.toString("utf8")) as {
    execution?: unknown;
    outcome?: unknown;
  };
  const executionSummary = c5161ShareableExecutionSummarySchema.parse({
    schemaVersion: "1.0.0",
    artifactType: "c5-16-1-shareable-execution-summary",
    generatedAt: new Date().toISOString(),
    taskIdentityHash,
    pathPolicy: "shareable-relative-only",
    shareable: true,
    localOnlySource: {
      fileName: path.basename(input.localExecutionSummaryPath),
      sha256: sha256(localSummaryBuffer),
      path: null,
    },
    internalArtifacts: sources
      .filter((source) =>
        source.sourcePath.startsWith(`${taskRoot}${path.sep}`),
      )
      .map((source) =>
        path.relative(taskRoot, source.sourcePath).split(path.sep).join("/"),
      ),
    externalFiles: await Promise.all(input.externalFiles.map(fileMetadata)),
    execution:
      localSummary.execution !== null &&
      typeof localSummary.execution === "object"
        ? localSummary.execution
        : {},
    outcome:
      localSummary.outcome !== null && typeof localSummary.outcome === "object"
        ? localSummary.outcome
        : {},
  });
  const materializationSources = [
    ...sources,
    {
      name: "execution-summary.json" as const,
      sourcePath: input.localExecutionSummaryPath,
      preparedValue: executionSummary,
    },
  ];
  const items: ShareableArtifactManifest["items"] = [];
  for (const source of materializationSources) {
    const sourceBuffer = await readFile(source.sourcePath);
    const raw =
      "preparedValue" in source
        ? source.preparedValue
        : (JSON.parse(sourceBuffer.toString("utf8")) as unknown);
    const semanticallyMigrated =
      source.name === "c5-16-stock-patched-runtime-ab.json"
        ? migrateC516AbMetricSemantics(raw)
        : source.name === "subtitle-review-delivery-integrity.json"
          ? (() => {
              const local = subtitleReviewDeliveryIntegritySchema.parse(raw);
              const shareable = {
                ...local,
                items: local.items.map((item) => ({
                  ...item,
                  audioClipPath: null,
                  audioIncludedInShareable: false,
                })),
              };
              return {
                ...shareable,
                semanticHash: sha256(
                  stable({
                    ...shareable,
                    generatedAt: null,
                    semanticHash: null,
                  }),
                ),
              };
            })()
          : raw;
    const sanitized = sanitizeShareableValue({
      value: semanticallyMigrated,
      taskRoot,
    });
    const parsed = schemaFor(source.name).parse(
      sanitized.value,
    ) as z.output<ShareableSchema>;
    const scan = scanShareableValue(parsed);
    const targetPath = path.join(outputDirectory, source.name);
    await atomicWriteJson(targetPath, parsed, { overwrite: true });
    const shareableHash = sha256(await readFile(targetPath));
    items.push({
      sourceArtifactName: path.basename(source.sourcePath),
      sourceArtifactHash: sha256(sourceBuffer),
      shareablePath: path.posix.join(
        path.basename(outputDirectory),
        source.name,
      ),
      shareableHash,
      schemaName: source.name.replace(/\.json$/u, ".schema.json"),
      pathReplacementCount: sanitized.pathReplacementCount,
      secretRedactionCount: sanitized.secretRedactionCount,
      absolutePathLeakCount: scan.absolutePathLeakCount,
      prohibitedSecretCount: scan.prohibitedSecretCount,
      validationPassed:
        scan.absolutePathLeakCount === 0 && scan.prohibitedSecretCount === 0,
    });
  }
  const manifest = shareableArtifactManifestSchema.parse({
    schemaVersion: "1.0.0",
    artifactType: "shareable-artifact-manifest",
    policyVersion:
      input.c5172Artifacts?.reviewActionValidationReportPath !== undefined
        ? C518_SHAREABLE_POLICY_VERSION
        : input.c5172Artifacts !== undefined
          ? C5172_SHAREABLE_POLICY_VERSION
          : input.c517Artifacts === undefined
            ? SHAREABLE_POLICY_VERSION
            : input.c517Artifacts.pronunciationPath === undefined
              ? C517_SHAREABLE_POLICY_VERSION
              : C5171_SHAREABLE_POLICY_VERSION,
    generatedAt: new Date().toISOString(),
    taskIdentityHash,
    pathPolicy: "shareable-relative-only",
    shareable: true,
    items,
    summary: {
      artifactCount: items.length,
      validationPassedCount: items.filter((item) => item.validationPassed)
        .length,
      absolutePathLeakCount: items.reduce(
        (sum, item) => sum + item.absolutePathLeakCount,
        0,
      ),
      prohibitedSecretCount: items.reduce(
        (sum, item) => sum + item.prohibitedSecretCount,
        0,
      ),
      pathReplacementCount: items.reduce(
        (sum, item) => sum + item.pathReplacementCount,
        0,
      ),
      secretRedactionCount: items.reduce(
        (sum, item) => sum + item.secretRedactionCount,
        0,
      ),
    },
  });
  const manifestScan = scanShareableValue(manifest);
  if (
    manifestScan.absolutePathLeakCount > 0 ||
    manifestScan.prohibitedSecretCount > 0
  ) {
    throw new Error("Shareable manifest itself failed path/secret scanning.");
  }
  const manifestPath = path.join(
    outputDirectory,
    "shareable-artifact-manifest.json",
  );
  await atomicWriteJson(manifestPath, manifest, { overwrite: true });
  return { outputDirectory, manifestPath, manifest };
}

export async function auditC5161ShareableArtifacts(
  inputDirectory: string,
): Promise<{
  manifest: ShareableArtifactManifest;
  validationPassed: boolean;
  absolutePathLeakCount: number;
  prohibitedSecretCount: number;
  brokenRelativeReferenceCount: number;
}> {
  const directory = path.resolve(inputDirectory);
  const manifestPath = path.join(directory, "shareable-artifact-manifest.json");
  const manifest = shareableArtifactManifestSchema.parse(
    JSON.parse(await readFile(manifestPath, "utf8")) as unknown,
  );
  let absolutePathLeakCount = 0;
  let prohibitedSecretCount = 0;
  let brokenRelativeReferenceCount = 0;
  let validationPassed = true;
  const taskRoot = path.dirname(directory);
  for (const item of manifest.items) {
    const target = path.resolve(taskRoot, item.shareablePath);
    const buffer = await readFile(target);
    const value = schemaFor(
      path.basename(target) as keyof typeof artifactSchemas,
    ).parse(JSON.parse(buffer.toString("utf8")) as unknown);
    if (path.basename(target) === "subtitle-review-delivery-integrity.json") {
      const delivery = subtitleReviewDeliveryIntegritySchema.parse(value);
      brokenRelativeReferenceCount += delivery.items.filter(
        (item) => item.audioIncludedInShareable || item.audioClipPath !== null,
      ).length;
    }
    const scan = scanShareableValue(value);
    absolutePathLeakCount += scan.absolutePathLeakCount;
    prohibitedSecretCount += scan.prohibitedSecretCount;
    validationPassed &&=
      sha256(buffer) === item.shareableHash &&
      scan.absolutePathLeakCount === 0 &&
      scan.prohibitedSecretCount === 0;
  }
  const manifestScan = scanShareableValue(manifest);
  absolutePathLeakCount += manifestScan.absolutePathLeakCount;
  prohibitedSecretCount += manifestScan.prohibitedSecretCount;
  validationPassed &&=
    manifestScan.absolutePathLeakCount === 0 &&
    manifestScan.prohibitedSecretCount === 0 &&
    manifest.summary.absolutePathLeakCount === 0 &&
    manifest.summary.prohibitedSecretCount === 0 &&
    manifest.summary.validationPassedCount === manifest.summary.artifactCount;
  const files = await readdir(directory, { recursive: true });
  brokenRelativeReferenceCount += files.filter((file) =>
    file.toLowerCase().endsWith(".wav"),
  ).length;
  validationPassed &&= brokenRelativeReferenceCount === 0;
  return {
    manifest,
    validationPassed,
    absolutePathLeakCount,
    prohibitedSecretCount,
    brokenRelativeReferenceCount,
  };
}
