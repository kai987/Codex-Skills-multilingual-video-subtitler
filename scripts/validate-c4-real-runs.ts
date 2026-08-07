import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import {
  anchorTextCoverageArtifactSchema,
  asrCacheManifestArtifactSchema,
  asrCacheMigrationArtifactSchema,
  blindGenerationProofArtifactSchema,
  c4FinalOutputAuditArtifactSchema,
  c4PersistentWorkerVerificationArtifactSchema,
  c4ReplayReportArtifactSchema,
  coverageRecoveryPlanArtifactSchema,
  coverageRecoveryResultsArtifactSchema,
  finalReviewQueueSchema,
  finalSubtitleIntegrityArtifactSchema,
  finalSubtitleRepairArtifactSchema,
  finalTextIntegrityArtifactSchema,
  japaneseLexicalNormalizationArtifactSchema,
  referenceClassificationReviewArtifactSchema,
  subtitlePackageSchema,
  textIntegrityRepairArtifactSchema,
} from "@mvl/shared";

async function subtitleDirectory(root: string): Promise<string> {
  const directoryName = (await readdir(root)).find((entry) =>
    entry.startsWith("subtitle-"),
  );
  if (directoryName === undefined) {
    throw new Error(`No subtitle-* directory under ${root}`);
  }
  return path.join(root, directoryName);
}

async function json(directory: string, fileName: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(directory, fileName), "utf8")) as
    object | unknown[];
}

async function hash(filePath: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

async function extensionHash(
  directory: string,
  extension: "srt" | "vtt" | "ass",
): Promise<string> {
  const fileName = (await readdir(directory)).find(
    (entry) =>
      entry.endsWith(`.${extension}`) && !entry.startsWith("subtitle-diff"),
  );
  if (fileName === undefined) {
    throw new Error(`No primary .${extension} file under ${directory}`);
  }
  return hash(path.join(directory, fileName));
}

const [c4RootInput, a4RootInput, b4RootInput] = process.argv.slice(2);
if (
  c4RootInput === undefined ||
  a4RootInput === undefined ||
  b4RootInput === undefined
) {
  throw new Error(
    "Usage: validate-c4-real-runs.ts <c4-root> <a4-root> <b4-root>",
  );
}

const [c4Directory, a4Directory, b4Directory] = await Promise.all([
  subtitleDirectory(path.resolve(c4RootInput)),
  subtitleDirectory(path.resolve(a4RootInput)),
  subtitleDirectory(path.resolve(b4RootInput)),
]);

const c4 = {
  report: c4ReplayReportArtifactSchema.parse(
    await json(c4Directory, "c4-replay-report.json"),
  ),
  audit: c4FinalOutputAuditArtifactSchema.parse(
    await json(c4Directory, "c4-final-output-audit.json"),
  ),
  textRepair: textIntegrityRepairArtifactSchema.parse(
    await json(c4Directory, "text-integrity-repair.json"),
  ),
  subtitleRepair: finalSubtitleRepairArtifactSchema.parse(
    await json(c4Directory, "final-subtitle-repair.json"),
  ),
  coveragePlan: coverageRecoveryPlanArtifactSchema.parse(
    await json(c4Directory, "coverage-recovery-plan.json"),
  ),
  coverageResults: coverageRecoveryResultsArtifactSchema.parse(
    await json(c4Directory, "coverage-recovery-results.json"),
  ),
  classificationReview: referenceClassificationReviewArtifactSchema.parse(
    await json(c4Directory, "reference-classification-review.json"),
  ),
  normalization: japaneseLexicalNormalizationArtifactSchema.parse(
    await json(c4Directory, "japanese-lexical-normalization.json"),
  ),
  finalText: finalTextIntegrityArtifactSchema.parse(
    await json(c4Directory, "final-text-integrity.json"),
  ),
  finalSubtitle: finalSubtitleIntegrityArtifactSchema.parse(
    await json(c4Directory, "final-subtitle-integrity.json"),
  ),
  review: finalReviewQueueSchema.parse(
    await json(c4Directory, "final-review-queue.json"),
  ),
  coverage: anchorTextCoverageArtifactSchema.parse(
    await json(c4Directory, "anchor-text-coverage.json"),
  ),
  package: subtitlePackageSchema.parse(
    await json(c4Directory, "subtitle-package.json"),
  ),
  cache: asrCacheManifestArtifactSchema.parse(
    await json(c4Directory, "asr-cache-manifest.json"),
  ),
  migration: asrCacheMigrationArtifactSchema.parse(
    await json(c4Directory, "asr-cache-migration.json"),
  ),
  persistentWorker: c4PersistentWorkerVerificationArtifactSchema.parse(
    await json(
      path.dirname(c4Directory),
      "coverage-targeted-persistent-worker-verification.json",
    ),
  ),
};

const [a4Proof, b4Proof, a4Cache, b4Cache, a4Migration, b4Migration] = [
  blindGenerationProofArtifactSchema.parse(
    await json(a4Directory, "blind-generation-proof.json"),
  ),
  blindGenerationProofArtifactSchema.parse(
    await json(b4Directory, "blind-generation-proof.json"),
  ),
  asrCacheManifestArtifactSchema.parse(
    await json(a4Directory, "asr-cache-manifest.json"),
  ),
  asrCacheManifestArtifactSchema.parse(
    await json(b4Directory, "asr-cache-manifest.json"),
  ),
  asrCacheMigrationArtifactSchema.parse(
    await json(a4Directory, "asr-cache-migration.json"),
  ),
  asrCacheMigrationArtifactSchema.parse(
    await json(b4Directory, "asr-cache-migration.json"),
  ),
];

const [a4Srt, b4Srt, a4Vtt, b4Vtt, a4Ass, b4Ass] = await Promise.all([
  extensionHash(a4Directory, "srt"),
  extensionHash(b4Directory, "srt"),
  extensionHash(a4Directory, "vtt"),
  extensionHash(b4Directory, "vtt"),
  extensionHash(a4Directory, "ass"),
  extensionHash(b4Directory, "ass"),
]);

if (
  a4Proof.canonicalTranscriptSha256 !== b4Proof.canonicalTranscriptSha256 ||
  a4Proof.generatedSubtitleSha256 !== b4Proof.generatedSubtitleSha256 ||
  a4Srt !== b4Srt ||
  a4Vtt !== b4Vtt ||
  a4Ass !== b4Ass
) {
  throw new Error("Fresh A4/B4 blind hashes do not match");
}
// Parsing with the strict blind-generation schema above proves all four
// reference-isolation flags are the required literal false values.
if (
  c4.audit.finalHardIntegrityErrorCount !== 0 ||
  c4.audit.finalSubtitleIntegrity.metrics.overlapCount !== 0 ||
  c4.audit.characterRatioFallbackCount !== 0
) {
  throw new Error("C4 final integrity acceptance criteria failed");
}
if (
  c4.persistentWorker.requestCount !== 80 ||
  c4.persistentWorker.resultCount !== 80 ||
  c4.persistentWorker.execution.workerStartCount !== 1 ||
  c4.persistentWorker.execution.modelLoadCount !== 1 ||
  c4.persistentWorker.execution.fallbackProcessCount !== 0 ||
  c4.persistentWorker.execution.backend !== "coreml"
) {
  throw new Error("C4 persistent Core ML worker acceptance criteria failed");
}

console.log(
  JSON.stringify(
    {
      strictArtifactsParsed: 21,
      c4: {
        finalCueCount: c4.audit.acceptedCueCount,
        hardIntegrityErrors: c4.audit.finalHardIntegrityErrorCount,
        overlapCount: c4.audit.finalSubtitleIntegrity.metrics.overlapCount,
        trueMissingDialogueGroups: c4.review.trueMissingDialogueGroupCount ?? 0,
        persistentWorker: {
          requestCount: c4.persistentWorker.requestCount,
          workerStartCount: c4.persistentWorker.execution.workerStartCount,
          modelLoadCount: c4.persistentWorker.execution.modelLoadCount,
          backend: c4.persistentWorker.execution.backend,
          fallbackProcessCount:
            c4.persistentWorker.execution.fallbackProcessCount,
        },
      },
      a4b4: {
        hashesEqual: true,
        canonical: a4Proof.canonicalTranscriptSha256,
        srt: a4Srt,
        vtt: a4Vtt,
        ass: a4Ass,
        a4Cache: a4Cache.summary,
        b4Cache: b4Cache.summary,
        migratedEntries:
          a4Migration.summary.migratedEntryCount +
          b4Migration.summary.migratedEntryCount,
      },
    },
    null,
    2,
  ),
);
