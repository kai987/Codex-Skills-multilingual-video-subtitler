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
  speakerEvidenceRuntimeCapabilitySchema,
  subtitleLocalSpeakerEvidenceSchema,
  c518SpeakerEvidenceReplaySummarySchema,
  c518FreshCacheObserveValidationSchema,
  ctcRuntimeCapabilitySchema,
  subtitleCtcAlignmentInputSchema,
  subtitleLocalCtcBoundaryEvidenceSchema,
  ctcAlignmentCacheManifestSchema,
  subtitleLocalSeparatedStreamEvidenceSchema,
  c5181CtcBoundaryReplaySummarySchema,
  c5181FreshCacheObserveValidationSchema,
  seriesLanguageMemorySchema,
  episodeLanguageObservationsSchema,
  seriesLanguageMemoryDeltaSchema,
  subtitleSeriesMemoryEvidenceSchema,
  subtitleMemoryAssistedRankingSchema,
  subtitleMemoryPronunciationProjectionSchema,
  memoryAssistedCtcTargetAuditSchema,
  memoryAssistedCtcObservationSchema,
  c519MemoryReplaySummarySchema,
  c519CausalValidationSchema,
  seriesMemoryQualityAuditSchema,
  c60ProtectedRiskPolicySchema,
  humanBaselineAuthoritySchema,
  subtitleFinalizationEvidenceFreshnessSchema,
  subtitleBaselinePreservationAssessmentSchema,
  subtitleFinalizationRiskAssessmentSchema,
  subtitleReviewEffectiveDispositionSchema,
  c60ProtectedFinalizationReplaySummarySchema,
  c60ProtectedFinalizationValidationSchema,
  c6016ShareableSummarySchema,
  c6018ShareableSummarySchema,
  machineCoreAcousticSpanSchema,
  machineCoreTextProjectionSchema,
  machineLocalizedCandidateComparabilitySchema,
  machineCoreAsrStabilitySchema,
  goldLocalCoreEvaluationSchema,
  machineCoreFreshVerificationSchema,
  machineCoreCandidateOracleEvaluationSchema,
  machineWhisperCoreStabilityEvaluationSchema,
  c6018RouteDecisionSchema,
  subtitlePackageSchema,
  whisperRuntimeCapabilityArtifactSchema,
  type ShareableArtifactManifest,
  type C516StockPatchedRuntimeAbArtifact,
} from "@mvl/shared";
import type { z } from "zod";

import { c60SemanticHash } from "./finalization-risk-policy.js";

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
const C5181_SHAREABLE_POLICY_VERSION =
  "c5.18.1-shareable-artifact-policy-v1" as const;
const C519_SHAREABLE_POLICY_VERSION =
  "c5.19-shareable-artifact-policy-v1" as const;
const C60_PROTECTED_SHAREABLE_POLICY_VERSION =
  "c6.0-protected-shareable-artifact-policy-v1" as const;
const C6016_SHAREABLE_POLICY_VERSION =
  "c6.0.1.6-shareable-artifact-policy-v1" as const;
const C6018_SHAREABLE_POLICY_VERSION =
  "c6.0.1.8-shareable-artifact-policy-v1" as const;

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
  "speaker-evidence-runtime-capability.json":
    speakerEvidenceRuntimeCapabilitySchema,
  "subtitle-local-speaker-evidence.json": subtitleLocalSpeakerEvidenceSchema,
  "c5-18-speaker-evidence-replay-summary.json":
    c518SpeakerEvidenceReplaySummarySchema,
  "c5-18-fresh-cache-observe-validation.json":
    c518FreshCacheObserveValidationSchema,
  "ctc-runtime-capability.json": ctcRuntimeCapabilitySchema,
  "subtitle-ctc-alignment-input.json": subtitleCtcAlignmentInputSchema,
  "subtitle-local-ctc-boundary-evidence.json":
    subtitleLocalCtcBoundaryEvidenceSchema,
  "ctc-alignment-cache-manifest.json": ctcAlignmentCacheManifestSchema,
  "subtitle-local-separated-stream-evidence.json":
    subtitleLocalSeparatedStreamEvidenceSchema,
  "c5-18-1-ctc-boundary-replay-summary.json":
    c5181CtcBoundaryReplaySummarySchema,
  "c5-18-1-fresh-cache-observe-validation.json":
    c5181FreshCacheObserveValidationSchema,
  "series-language-memory.json": seriesLanguageMemorySchema,
  "episode-language-observations.json": episodeLanguageObservationsSchema,
  "series-language-memory-delta.json": seriesLanguageMemoryDeltaSchema,
  "subtitle-series-memory-evidence.json": subtitleSeriesMemoryEvidenceSchema,
  "subtitle-memory-assisted-ranking.json": subtitleMemoryAssistedRankingSchema,
  "subtitle-memory-pronunciation-projection.json":
    subtitleMemoryPronunciationProjectionSchema,
  "memory-assisted-ctc-target-audit.json": memoryAssistedCtcTargetAuditSchema,
  "memory-assisted-ctc-observation.json": memoryAssistedCtcObservationSchema,
  "c5-19-memory-replay-summary.json": c519MemoryReplaySummarySchema,
  "c5-19-causal-validation.json": c519CausalValidationSchema,
  "series-memory-quality-audit.json": seriesMemoryQualityAuditSchema,
  "c6-0-protected-risk-policy.json": c60ProtectedRiskPolicySchema,
  "human-baseline-authority.json": humanBaselineAuthoritySchema,
  "subtitle-finalization-evidence-freshness.json":
    subtitleFinalizationEvidenceFreshnessSchema,
  "subtitle-baseline-preservation-assessment.json":
    subtitleBaselinePreservationAssessmentSchema,
  "subtitle-finalization-risk-assessment.json":
    subtitleFinalizationRiskAssessmentSchema,
  "subtitle-review-effective-disposition.json":
    subtitleReviewEffectiveDispositionSchema,
  "c6-0-protected-finalization-replay-summary.json":
    c60ProtectedFinalizationReplaySummarySchema,
  "c6-0-protected-finalization-validation.json":
    c60ProtectedFinalizationValidationSchema,
  "c6-0-1-6-summary.json": c6016ShareableSummarySchema,
  "c6-0-1-8-summary.json": c6018ShareableSummarySchema,
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
  c518Artifacts?: {
    runtimeCapabilityPath: string;
    localSpeakerEvidencePath: string;
    replaySummaryPath: string;
    freshCacheObserveValidationPath?: string;
  };
  c5181Artifacts?: {
    runtimeCapabilityPath: string;
    alignmentInputPath: string;
    boundaryEvidencePath: string;
    cacheManifestPath: string;
    separatedStreamEvidencePath: string;
    replaySummaryPath: string;
    freshCacheObserveValidationPath?: string;
  };
  c519Artifacts?: {
    memoryPath: string;
    observationsPath: string;
    deltaPath: string;
    evidencePath: string;
    rankingPath: string;
    pronunciationProjectionPath: string;
    ctcTargetAuditPath: string;
    ctcObservationPath: string;
    replaySummaryPath: string;
    causalValidationPath: string;
    qualityAuditPath: string;
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
  if (input.c518Artifacts !== undefined) {
    sources.push(
      {
        name: "speaker-evidence-runtime-capability.json",
        sourcePath: path.resolve(input.c518Artifacts.runtimeCapabilityPath),
      },
      {
        name: "subtitle-local-speaker-evidence.json",
        sourcePath: path.resolve(input.c518Artifacts.localSpeakerEvidencePath),
      },
      {
        name: "c5-18-speaker-evidence-replay-summary.json",
        sourcePath: path.resolve(input.c518Artifacts.replaySummaryPath),
      },
    );
    if (input.c518Artifacts.freshCacheObserveValidationPath !== undefined) {
      sources.push({
        name: "c5-18-fresh-cache-observe-validation.json",
        sourcePath: path.resolve(
          input.c518Artifacts.freshCacheObserveValidationPath,
        ),
      });
    }
  }
  if (input.c5181Artifacts !== undefined) {
    sources.push(
      {
        name: "ctc-runtime-capability.json",
        sourcePath: path.resolve(input.c5181Artifacts.runtimeCapabilityPath),
      },
      {
        name: "subtitle-ctc-alignment-input.json",
        sourcePath: path.resolve(input.c5181Artifacts.alignmentInputPath),
      },
      {
        name: "subtitle-local-ctc-boundary-evidence.json",
        sourcePath: path.resolve(input.c5181Artifacts.boundaryEvidencePath),
      },
      {
        name: "ctc-alignment-cache-manifest.json",
        sourcePath: path.resolve(input.c5181Artifacts.cacheManifestPath),
      },
      {
        name: "subtitle-local-separated-stream-evidence.json",
        sourcePath: path.resolve(
          input.c5181Artifacts.separatedStreamEvidencePath,
        ),
      },
      {
        name: "c5-18-1-ctc-boundary-replay-summary.json",
        sourcePath: path.resolve(input.c5181Artifacts.replaySummaryPath),
      },
    );
    if (input.c5181Artifacts.freshCacheObserveValidationPath !== undefined) {
      sources.push({
        name: "c5-18-1-fresh-cache-observe-validation.json",
        sourcePath: path.resolve(
          input.c5181Artifacts.freshCacheObserveValidationPath,
        ),
      });
    }
  }
  if (input.c519Artifacts !== undefined) {
    sources.push(
      {
        name: "series-language-memory.json",
        sourcePath: path.resolve(input.c519Artifacts.memoryPath),
      },
      {
        name: "episode-language-observations.json",
        sourcePath: path.resolve(input.c519Artifacts.observationsPath),
      },
      {
        name: "series-language-memory-delta.json",
        sourcePath: path.resolve(input.c519Artifacts.deltaPath),
      },
      {
        name: "subtitle-series-memory-evidence.json",
        sourcePath: path.resolve(input.c519Artifacts.evidencePath),
      },
      {
        name: "subtitle-memory-assisted-ranking.json",
        sourcePath: path.resolve(input.c519Artifacts.rankingPath),
      },
      {
        name: "subtitle-memory-pronunciation-projection.json",
        sourcePath: path.resolve(
          input.c519Artifacts.pronunciationProjectionPath,
        ),
      },
      {
        name: "memory-assisted-ctc-target-audit.json",
        sourcePath: path.resolve(input.c519Artifacts.ctcTargetAuditPath),
      },
      {
        name: "memory-assisted-ctc-observation.json",
        sourcePath: path.resolve(input.c519Artifacts.ctcObservationPath),
      },
      {
        name: "c5-19-memory-replay-summary.json",
        sourcePath: path.resolve(input.c519Artifacts.replaySummaryPath),
      },
      {
        name: "c5-19-causal-validation.json",
        sourcePath: path.resolve(input.c519Artifacts.causalValidationPath),
      },
      {
        name: "series-memory-quality-audit.json",
        sourcePath: path.resolve(input.c519Artifacts.qualityAuditPath),
      },
    );
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
      input.c519Artifacts !== undefined
        ? C519_SHAREABLE_POLICY_VERSION
        : input.c5181Artifacts !== undefined
          ? C5181_SHAREABLE_POLICY_VERSION
          : input.c518Artifacts !== undefined ||
              input.c5172Artifacts?.reviewActionValidationReportPath !==
                undefined
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

export async function appendC518ValidationToShareable(input: {
  taskRoot: string;
  validationPath: string;
}): Promise<{
  manifest: ShareableArtifactManifest;
  validationPassed: boolean;
  absolutePathLeakCount: number;
  prohibitedSecretCount: number;
  brokenRelativeReferenceCount: number;
}> {
  const taskRoot = path.resolve(input.taskRoot);
  const validationPath = path.resolve(input.validationPath);
  if (!validationPath.startsWith(`${taskRoot}${path.sep}`)) {
    throw new Error(
      "C5.18 validation must be materialized inside the task root before sharing.",
    );
  }
  const directory = path.join(taskRoot, "shareable");
  const manifestPath = path.join(directory, "shareable-artifact-manifest.json");
  const existingManifest = shareableArtifactManifestSchema.parse(
    JSON.parse(await readFile(manifestPath, "utf8")) as unknown,
  );
  if (existingManifest.policyVersion !== C518_SHAREABLE_POLICY_VERSION) {
    throw new Error("C5.18 validation requires a C5.18 shareable manifest.");
  }

  const validationName = "c5-18-fresh-cache-observe-validation.json" as const;
  const validationSource = await readFile(validationPath);
  const sanitized = sanitizeShareableValue({
    value: JSON.parse(validationSource.toString("utf8")) as unknown,
    taskRoot,
  });
  const validation = c518FreshCacheObserveValidationSchema.parse(
    sanitized.value,
  );
  const validationScan = scanShareableValue(validation);
  const validationTarget = path.join(directory, validationName);
  await atomicWriteJson(validationTarget, validation, { overwrite: true });

  const retainedItems = existingManifest.items.filter((item) => {
    const name = path.basename(item.shareablePath);
    return name !== validationName && name !== "execution-summary.json";
  });
  const identitySources = [
    ...retainedItems.map((item) => ({
      name: path.basename(item.shareablePath),
      hash: item.sourceArtifactHash,
    })),
    { name: validationName, hash: sha256(validationSource) },
  ];
  const taskIdentityHash = sha256(stable(identitySources));

  const executionTarget = path.join(directory, "execution-summary.json");
  const executionItem = existingManifest.items.find(
    (item) => path.basename(item.shareablePath) === "execution-summary.json",
  );
  if (executionItem === undefined) {
    throw new Error("Shareable manifest is missing execution-summary.json.");
  }
  const execution = c5161ShareableExecutionSummarySchema.parse(
    JSON.parse(await readFile(executionTarget, "utf8")) as unknown,
  );
  const validationRelativePath = path
    .relative(taskRoot, validationPath)
    .split(path.sep)
    .join("/");
  const updatedExecution = c5161ShareableExecutionSummarySchema.parse({
    ...execution,
    taskIdentityHash,
    internalArtifacts: [
      ...execution.internalArtifacts.filter(
        (item) => item !== validationRelativePath,
      ),
      validationRelativePath,
    ],
  });
  await atomicWriteJson(executionTarget, updatedExecution, { overwrite: true });
  const executionScan = scanShareableValue(updatedExecution);

  const items: ShareableArtifactManifest["items"] = [
    ...retainedItems,
    {
      sourceArtifactName: path.basename(validationPath),
      sourceArtifactHash: sha256(validationSource),
      shareablePath: path.posix.join(path.basename(directory), validationName),
      shareableHash: await sha256File(validationTarget),
      schemaName: "c5-18-fresh-cache-observe-validation.schema.json",
      pathReplacementCount: sanitized.pathReplacementCount,
      secretRedactionCount: sanitized.secretRedactionCount,
      absolutePathLeakCount: validationScan.absolutePathLeakCount,
      prohibitedSecretCount: validationScan.prohibitedSecretCount,
      validationPassed:
        validationScan.absolutePathLeakCount === 0 &&
        validationScan.prohibitedSecretCount === 0,
    },
    {
      ...executionItem,
      shareableHash: await sha256File(executionTarget),
      absolutePathLeakCount: executionScan.absolutePathLeakCount,
      prohibitedSecretCount: executionScan.prohibitedSecretCount,
      validationPassed:
        executionScan.absolutePathLeakCount === 0 &&
        executionScan.prohibitedSecretCount === 0,
    },
  ];
  const manifest = shareableArtifactManifestSchema.parse({
    ...existingManifest,
    generatedAt: new Date().toISOString(),
    taskIdentityHash,
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
  await atomicWriteJson(manifestPath, manifest, { overwrite: true });
  return auditC5161ShareableArtifacts(directory);
}

export async function appendC5181ValidationToShareable(input: {
  taskRoot: string;
  validationPath: string;
}): Promise<{
  manifest: ShareableArtifactManifest;
  validationPassed: boolean;
  absolutePathLeakCount: number;
  prohibitedSecretCount: number;
  brokenRelativeReferenceCount: number;
}> {
  const taskRoot = path.resolve(input.taskRoot);
  const validationPath = path.resolve(input.validationPath);
  if (!validationPath.startsWith(`${taskRoot}${path.sep}`)) {
    throw new Error(
      "C5.18.1 validation must be materialized inside the task root before sharing.",
    );
  }
  const directory = path.join(taskRoot, "shareable");
  const manifestPath = path.join(directory, "shareable-artifact-manifest.json");
  const existingManifest = shareableArtifactManifestSchema.parse(
    JSON.parse(await readFile(manifestPath, "utf8")) as unknown,
  );
  if (existingManifest.policyVersion !== C5181_SHAREABLE_POLICY_VERSION) {
    throw new Error(
      "C5.18.1 validation requires a C5.18.1 shareable manifest.",
    );
  }
  const validationName = "c5-18-1-fresh-cache-observe-validation.json" as const;
  const validationSource = await readFile(validationPath);
  const sanitized = sanitizeShareableValue({
    value: JSON.parse(validationSource.toString("utf8")) as unknown,
    taskRoot,
  });
  const validation = c5181FreshCacheObserveValidationSchema.parse(
    sanitized.value,
  );
  const validationScan = scanShareableValue(validation);
  const validationTarget = path.join(directory, validationName);
  await atomicWriteJson(validationTarget, validation, { overwrite: true });

  const retainedItems = existingManifest.items.filter((item) => {
    const name = path.basename(item.shareablePath);
    return name !== validationName && name !== "execution-summary.json";
  });
  const identitySources = [
    ...retainedItems.map((item) => ({
      name: path.basename(item.shareablePath),
      hash: item.sourceArtifactHash,
    })),
    { name: validationName, hash: sha256(validationSource) },
  ];
  const taskIdentityHash = sha256(stable(identitySources));
  const executionTarget = path.join(directory, "execution-summary.json");
  const executionItem = existingManifest.items.find(
    (item) => path.basename(item.shareablePath) === "execution-summary.json",
  );
  if (executionItem === undefined) {
    throw new Error("Shareable manifest is missing execution-summary.json.");
  }
  const execution = c5161ShareableExecutionSummarySchema.parse(
    JSON.parse(await readFile(executionTarget, "utf8")) as unknown,
  );
  const validationRelativePath = path
    .relative(taskRoot, validationPath)
    .split(path.sep)
    .join("/");
  const updatedExecution = c5161ShareableExecutionSummarySchema.parse({
    ...execution,
    taskIdentityHash,
    internalArtifacts: [
      ...execution.internalArtifacts.filter(
        (item) => item !== validationRelativePath,
      ),
      validationRelativePath,
    ],
  });
  await atomicWriteJson(executionTarget, updatedExecution, { overwrite: true });
  const executionScan = scanShareableValue(updatedExecution);
  const items: ShareableArtifactManifest["items"] = [
    ...retainedItems,
    {
      sourceArtifactName: path.basename(validationPath),
      sourceArtifactHash: sha256(validationSource),
      shareablePath: path.posix.join(path.basename(directory), validationName),
      shareableHash: await sha256File(validationTarget),
      schemaName: "c5-18-1-fresh-cache-observe-validation.schema.json",
      pathReplacementCount: sanitized.pathReplacementCount,
      secretRedactionCount: sanitized.secretRedactionCount,
      absolutePathLeakCount: validationScan.absolutePathLeakCount,
      prohibitedSecretCount: validationScan.prohibitedSecretCount,
      validationPassed:
        validationScan.absolutePathLeakCount === 0 &&
        validationScan.prohibitedSecretCount === 0,
    },
    {
      ...executionItem,
      shareableHash: await sha256File(executionTarget),
      absolutePathLeakCount: executionScan.absolutePathLeakCount,
      prohibitedSecretCount: executionScan.prohibitedSecretCount,
      validationPassed:
        executionScan.absolutePathLeakCount === 0 &&
        executionScan.prohibitedSecretCount === 0,
    },
  ];
  const manifest = shareableArtifactManifestSchema.parse({
    ...existingManifest,
    generatedAt: new Date().toISOString(),
    taskIdentityHash,
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
  await atomicWriteJson(manifestPath, manifest, { overwrite: true });
  return auditC5161ShareableArtifacts(directory);
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

export async function finalizeC6016ShareableArtifacts(input: {
  taskRoot: string;
}): Promise<{
  manifest: ShareableArtifactManifest;
  audit: Awaited<ReturnType<typeof auditC5161ShareableArtifacts>>;
}> {
  const taskRoot = path.resolve(input.taskRoot);
  const directory = path.join(taskRoot, "shareable");
  const summaryName = "c6-0-1-6-summary.json" as const;
  const summaryPath = path.join(directory, summaryName);
  const originalSummaryBuffer = await readFile(summaryPath);
  const originalSummary = JSON.parse(
    originalSummaryBuffer.toString("utf8"),
  ) as Record<string, unknown>;
  const summary = c6016ShareableSummarySchema.parse({
    ...originalSummary,
    generatedAt:
      typeof originalSummary.generatedAt === "string"
        ? originalSummary.generatedAt
        : "2026-08-28T14:00:00.000Z",
  });
  await atomicWriteJson(summaryPath, summary, { overwrite: true });
  const summaryBuffer = await readFile(summaryPath);
  const scan = scanShareableValue(summary);
  const summaryHash = sha256(summaryBuffer);
  const item = {
    sourceArtifactName: summaryName,
    sourceArtifactHash: summaryHash,
    shareablePath: path.posix.join(path.basename(directory), summaryName),
    shareableHash: summaryHash,
    schemaName: "c6-0-1-6-shareable-summary.schema.json",
    pathReplacementCount: 0,
    secretRedactionCount: 0,
    absolutePathLeakCount: scan.absolutePathLeakCount,
    prohibitedSecretCount: scan.prohibitedSecretCount,
    validationPassed:
      scan.absolutePathLeakCount === 0 && scan.prohibitedSecretCount === 0,
  };
  const manifest = shareableArtifactManifestSchema.parse({
    schemaVersion: "1.0.0",
    artifactType: "shareable-artifact-manifest",
    policyVersion: C6016_SHAREABLE_POLICY_VERSION,
    generatedAt: summary.generatedAt,
    taskIdentityHash: c60SemanticHash({
      policyVersion: summary.policyVersion,
      stage: summary.stage,
      finalHashes: summary.finalHashes,
    }),
    pathPolicy: "shareable-relative-only",
    shareable: true,
    items: [item],
    summary: {
      artifactCount: 1,
      validationPassedCount: item.validationPassed ? 1 : 0,
      absolutePathLeakCount: item.absolutePathLeakCount,
      prohibitedSecretCount: item.prohibitedSecretCount,
      pathReplacementCount: 0,
      secretRedactionCount: 0,
    },
  });
  await atomicWriteJson(
    path.join(directory, "shareable-artifact-manifest.json"),
    manifest,
    { overwrite: true },
  );
  return {
    manifest,
    audit: await auditC5161ShareableArtifacts(directory),
  };
}

export async function finalizeC6018ShareableArtifacts(input: {
  taskRoot: string;
  stage: "final-a" | "final-b";
  originalFreshInferenceCount: 36;
}): Promise<{
  manifest: ShareableArtifactManifest;
  audit: Awaited<ReturnType<typeof auditC5161ShareableArtifacts>>;
}> {
  const taskRoot = path.resolve(input.taskRoot);
  const entries = await readdir(taskRoot, { withFileTypes: true });
  const subtitleEntry = entries.find(
    (entry) => entry.isDirectory() && entry.name.startsWith("subtitle-"),
  );
  if (subtitleEntry === undefined) {
    throw new Error(`C6.0.1.8 task has no subtitle directory: ${taskRoot}`);
  }
  const subtitleDirectory = path.join(taskRoot, subtitleEntry.name);
  const readArtifact = async <T>(
    name: string,
    schema: z.ZodType<T>,
  ): Promise<T> =>
    schema.parse(
      JSON.parse(
        await readFile(path.join(subtitleDirectory, name), "utf8"),
      ) as unknown,
    );
  const [
    coreSpan,
    projection,
    comparability,
    stability,
    goldLocal,
    freshVerification,
    oracle,
    diagnosis,
    route,
    subtitlePackage,
    machineFreezeRaw,
  ] = await Promise.all([
    readArtifact(
      "machine-core-acoustic-span.json",
      machineCoreAcousticSpanSchema,
    ),
    readArtifact(
      "machine-core-text-projection.json",
      machineCoreTextProjectionSchema,
    ),
    readArtifact(
      "machine-localized-candidate-comparability.json",
      machineLocalizedCandidateComparabilitySchema,
    ),
    readArtifact(
      "machine-core-asr-stability.json",
      machineCoreAsrStabilitySchema,
    ),
    readArtifact(
      "gold-local-core-evaluation.json",
      goldLocalCoreEvaluationSchema,
    ),
    readArtifact(
      "machine-core-fresh-verification.json",
      machineCoreFreshVerificationSchema,
    ),
    readArtifact(
      "machine-core-candidate-oracle-evaluation.json",
      machineCoreCandidateOracleEvaluationSchema,
    ),
    readArtifact(
      "machine-whisper-core-stability-evaluation.json",
      machineWhisperCoreStabilityEvaluationSchema,
    ),
    readArtifact("c6-0-1-8-route-decision.json", c6018RouteDecisionSchema),
    readArtifact("subtitle-package.json", subtitlePackageSchema),
    readFile(
      path.join(subtitleDirectory, "c6-0-1-8-machine-freeze.json"),
      "utf8",
    ).then((value) => JSON.parse(value) as { machineFreezeHash?: unknown }),
  ]);
  if (typeof machineFreezeRaw.machineFreezeHash !== "string") {
    throw new Error("C6.0.1.8 machine freeze is missing its hash.");
  }
  const subtitleFile = (
    value: string | null | undefined,
    label: string,
  ): string => {
    if (value === null || value === undefined) {
      throw new Error(`Subtitle package is missing ${label}.`);
    }
    return path.resolve(subtitleDirectory, value);
  };
  const assPath = subtitleFile(subtitlePackage.subtitleFiles.ass, "ASS");
  const srtPath = subtitleFile(subtitlePackage.subtitleFiles.srt, "SRT");
  const vttPath = subtitleFile(subtitlePackage.subtitleFiles.vtt, "VTT");
  const [assHash, srtHash, vttHash] = await Promise.all([
    sha256File(assPath),
    sha256File(srtPath),
    sha256File(vttPath),
  ]);
  const canonicalHashes = {
    text: c60SemanticHash({
      cues: subtitlePackage.cues.map((cue) => ({ id: cue.id, text: cue.text })),
    }),
    timing: c60SemanticHash({
      cues: subtitlePackage.cues.map((cue) => ({
        id: cue.id,
        start: cue.start,
        end: cue.end,
      })),
    }),
    presentation: c60SemanticHash({ assHash, srtHash, vttHash }),
    ass: assHash,
    srt: srtHash,
    vtt: vttHash,
  };
  const artifactRelativePaths = [
    "machine-core-acoustic-span.json",
    "machine-core-text-projection.json",
    "machine-localized-candidate-comparability.json",
    "machine-core-asr-stability.json",
    "machine-core-fresh-verification.json",
    "gold-local-core-evaluation.json",
    "machine-core-candidate-oracle-evaluation.json",
    "machine-whisper-core-stability-evaluation.json",
    "c6-0-1-8-route-decision.json",
  ];
  const summaryCore = {
    schemaVersion: "1.0.0" as const,
    policyVersion: "c6.0.1.8-core-span-asr-stability-v1" as const,
    generatedAt: route.generatedAt,
    artifactType: "c6-0-1-8-shareable-summary" as const,
    stage: input.stage,
    sourceMediaSha256: coreSpan.sourceIdentity.sourceMediaSha256,
    machineFreezeHash: machineFreezeRaw.machineFreezeHash,
    runtimeGoldInputCount: 0 as const,
    networkUsed: false as const,
    fullGoldTextIncluded: false as const,
    privateAudioIncluded: false as const,
    productionStatus: "needs-review" as const,
    finalizationMethod: "none" as const,
    reusedFreshRuntime: {
      requestCount: 36 as const,
      originalFreshInferenceCount: input.originalFreshInferenceCount,
      additionalCoreInferenceCount: 0 as const,
      runtimeBinarySha256:
        freshVerification.inferenceRuntime.runtimeBinarySha256,
      runtimePatchSha256: freshVerification.inferenceRuntime.runtimePatchSha256,
      modelSha256: freshVerification.inferenceRuntime.modelSha256,
      device: freshVerification.inferenceRuntime.device,
    },
    coreSpanSummary: coreSpan.summary,
    projectionSummary: projection.summary,
    comparabilitySummary: comparability.summary,
    stabilitySummary: stability.summary,
    localGoldSummary: goldLocal.summary,
    oracleSummary: oracle.summary,
    diagnosisSummary: diagnosis.summary,
    route: {
      decision: route.decision,
      confidence: route.confidence,
      recommendation: route.recommendation,
      strictC602QualityGatePassed: route.strictC602QualityGatePassed,
    },
    artifactRelativePaths,
    canonicalHashes,
  };
  const summary = c6018ShareableSummarySchema.parse({
    ...summaryCore,
    semanticHash: c60SemanticHash({ ...summaryCore, generatedAt: undefined }),
  });
  const directory = path.join(taskRoot, "shareable");
  await mkdir(directory, { recursive: true });
  const summaryName = "c6-0-1-8-summary.json" as const;
  const summaryPath = path.join(directory, summaryName);
  await atomicWriteJson(summaryPath, summary, { overwrite: true });
  const summaryBuffer = await readFile(summaryPath);
  const scan = scanShareableValue(summary);
  const summaryHash = sha256(summaryBuffer);
  const item = {
    sourceArtifactName: summaryName,
    sourceArtifactHash: summaryHash,
    shareablePath: path.posix.join(path.basename(directory), summaryName),
    shareableHash: summaryHash,
    schemaName: "c6-0-1-8-shareable-summary.schema.json",
    pathReplacementCount: 0,
    secretRedactionCount: 0,
    absolutePathLeakCount: scan.absolutePathLeakCount,
    prohibitedSecretCount: scan.prohibitedSecretCount,
    validationPassed:
      scan.absolutePathLeakCount === 0 && scan.prohibitedSecretCount === 0,
  };
  const manifest = shareableArtifactManifestSchema.parse({
    schemaVersion: "1.0.0",
    artifactType: "shareable-artifact-manifest",
    policyVersion: C6018_SHAREABLE_POLICY_VERSION,
    generatedAt: summary.generatedAt,
    taskIdentityHash: c60SemanticHash({
      policyVersion: summary.policyVersion,
      stage: summary.stage,
      machineFreezeHash: summary.machineFreezeHash,
      route: summary.route,
      canonicalHashes: summary.canonicalHashes,
    }),
    pathPolicy: "shareable-relative-only",
    shareable: true,
    items: [item],
    summary: {
      artifactCount: 1,
      validationPassedCount: item.validationPassed ? 1 : 0,
      absolutePathLeakCount: item.absolutePathLeakCount,
      prohibitedSecretCount: item.prohibitedSecretCount,
      pathReplacementCount: 0,
      secretRedactionCount: 0,
    },
  });
  await atomicWriteJson(
    path.join(directory, "shareable-artifact-manifest.json"),
    manifest,
    { overwrite: true },
  );
  return {
    manifest,
    audit: await auditC5161ShareableArtifacts(directory),
  };
}

const c60ProtectedShareableNames = [
  "c6-0-protected-risk-policy.json",
  "human-baseline-authority.json",
  "subtitle-finalization-evidence-freshness.json",
  "subtitle-baseline-preservation-assessment.json",
  "subtitle-finalization-risk-assessment.json",
  "subtitle-review-effective-disposition.json",
  "c6-0-protected-finalization-replay-summary.json",
  "subtitle-finalization-report.json",
  "subtitle-presentation-resolution.json",
  "subtitle-local-ctc-boundary-evidence.json",
  "memory-assisted-ctc-target-audit.json",
  "subtitle-review-delivery-integrity.json",
  "subtitle-canonical-forced-alignment.json",
] as const;

export async function generateC60ProtectedShareableArtifacts(input: {
  taskRoot: string;
  subtitleDirectory: string;
  validationPath?: string;
  outputDirectory?: string;
}): Promise<{
  outputDirectory: string;
  manifestPath: string;
  manifest: ShareableArtifactManifest;
}> {
  const taskRoot = path.resolve(input.taskRoot);
  const subtitleDirectory = path.resolve(input.subtitleDirectory);
  const outputDirectory = path.resolve(
    input.outputDirectory ??
      path.join(taskRoot, "shareable-c6-0-protected-finalization"),
  );
  await mkdir(outputDirectory, { recursive: true });
  const sourcePathFor = (name: string): string =>
    name === "c6-0-protected-finalization-replay-summary.json"
      ? path.join(taskRoot, name)
      : path.join(subtitleDirectory, name);
  const sources: {
    name: keyof typeof artifactSchemas;
    sourcePath: string;
  }[] = c60ProtectedShareableNames.map((name) => ({
    name,
    sourcePath: sourcePathFor(name),
  }));
  if (input.validationPath !== undefined) {
    sources.push({
      name: "c6-0-protected-finalization-validation.json",
      sourcePath: path.resolve(input.validationPath),
    });
  }
  const availableNames = sources.map((source) => source.name).toSorted();
  const items: ShareableArtifactManifest["items"] = [];
  for (const source of sources) {
    const sourceBuffer = await readFile(source.sourcePath);
    let raw = JSON.parse(sourceBuffer.toString("utf8")) as unknown;
    if (source.name === "subtitle-review-delivery-integrity.json") {
      const local = subtitleReviewDeliveryIntegritySchema.parse(raw);
      const shareable = {
        ...local,
        items: local.items.map((item) => ({
          ...item,
          audioClipPath: null,
          audioIncludedInShareable: false,
        })),
      };
      raw = {
        ...shareable,
        semanticHash: sha256(
          stable({
            ...shareable,
            generatedAt: null,
            semanticHash: null,
          }),
        ),
      };
    }
    if (source.name === "c6-0-protected-finalization-replay-summary.json") {
      const local = c60ProtectedFinalizationReplaySummarySchema.parse(raw);
      const shareable = {
        ...local,
        outputFiles: availableNames,
      };
      raw = {
        ...shareable,
        semanticHash: c60SemanticHash(shareable),
      };
    }
    const sanitized = sanitizeShareableValue({ value: raw, taskRoot });
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
    policyVersion: C60_PROTECTED_SHAREABLE_POLICY_VERSION,
    generatedAt: new Date().toISOString(),
    taskIdentityHash: sha256(
      stable(
        items.map((item) => ({
          name: item.sourceArtifactName,
          hash: item.sourceArtifactHash,
        })),
      ),
    ),
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
  const manifestPath = path.join(
    outputDirectory,
    "shareable-artifact-manifest.json",
  );
  await atomicWriteJson(manifestPath, manifest, { overwrite: true });
  return { outputDirectory, manifestPath, manifest };
}

export async function auditC60ProtectedShareableArtifacts(
  inputDirectory: string,
): Promise<Awaited<ReturnType<typeof auditC5161ShareableArtifacts>>> {
  const result = await auditC5161ShareableArtifacts(inputDirectory);
  const directory = path.resolve(inputDirectory);
  let brokenRelativeReferenceCount = result.brokenRelativeReferenceCount;
  const replayPath = path.join(
    directory,
    "c6-0-protected-finalization-replay-summary.json",
  );
  const replay = c60ProtectedFinalizationReplaySummarySchema.parse(
    JSON.parse(await readFile(replayPath, "utf8")) as unknown,
  );
  for (const reference of replay.outputFiles) {
    const target = path.resolve(directory, reference);
    if (
      !target.startsWith(`${directory}${path.sep}`) ||
      !(await stat(target).then(
        (value) => value.isFile(),
        () => false,
      ))
    ) {
      brokenRelativeReferenceCount += 1;
    }
  }
  return {
    ...result,
    brokenRelativeReferenceCount,
    validationPassed:
      result.validationPassed && brokenRelativeReferenceCount === 0,
  };
}
