import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  InputError,
  atomicWriteJson,
  c519CausalValidationSchema,
  c519MemoryReplaySummarySchema,
  c519RunValidationSchema,
  episodeLanguageObservationsSchema,
  memoryAssistedCtcObservationSchema,
  memoryAssistedCtcTargetAuditSchema,
  seriesLanguageMemoryDeltaSchema,
  seriesLanguageMemorySchema,
  seriesMemoryQualityAuditSchema,
  subtitleFinalizationReportSchema,
  subtitleMemoryAssistedRankingSchema,
  subtitleMemoryPronunciationProjectionSchema,
  subtitleReviewPackageSchema,
  subtitleSeriesMemoryEvidenceSchema,
} from "@mvl/shared";
import { stableMemoryHash } from "@mvl/transcription-core";
import {
  auditC5161ShareableArtifacts,
  auditReviewDeliveryIntegrity,
  locateSubtitlePackage,
} from "@mvl/video-subtitler";

const EXPECTED_CANONICAL =
  "8ec01ef362387aa4a4b61cb7c7cb3d2d4f4932f38aff3a4b5695deedfa1ccc83";
const EXPECTED_TIMING =
  "510c3f20b82ecd263cd2234057536eaddda0dc94efac599ffe72aa3fc843ec02";
const EXPECTED_PRESENTATION =
  "9e1371375397df403bf2647cc805b8c70d6c2628eca1eb4f94dca32cc7eed4de";

function isZero(value: number | undefined): boolean {
  return value === 0;
}

function equalsText(value: string | undefined, expected: string): boolean {
  return value === expected;
}

const { values } = parseArgs({
  options: {
    bootstrap: { type: "string" },
    causal: { type: "string" },
    "frozen-replay": { type: "string" },
    output: { type: "string" },
  },
  strict: true,
});
if (
  values.bootstrap === undefined ||
  values.causal === undefined ||
  values["frozen-replay"] === undefined
) {
  throw new InputError(
    "Usage: validate:c5-19-runs -- --bootstrap <task> --causal <task> --frozen-replay <task>",
  );
}

async function readArtifact<T>(
  filePath: string,
  schema: { parse(value: unknown): T },
): Promise<T> {
  return schema.parse(JSON.parse(await readFile(filePath, "utf8")) as unknown);
}

async function validateRun(
  taskRoot: string,
  expectedKind: "bootstrap" | "causal" | "frozen",
) {
  const root = path.resolve(taskRoot);
  const located = await locateSubtitlePackage(root);
  const subtitleDirectory = located.subtitleDirectory;
  const summary = await readArtifact(
    path.join(root, "c5-19-memory-replay-summary.json"),
    c519MemoryReplaySummarySchema,
  );
  if (summary.runKind !== expectedKind) {
    throw new InputError(`${root} is not a ${expectedKind} replay.`);
  }
  const [
    memory,
    observations,
    delta,
    evidence,
    ranking,
    projection,
    ctcAudit,
    ctcObservation,
    causal,
    quality,
    review,
    finalization,
  ] = await Promise.all([
    readArtifact(
      path.join(subtitleDirectory, "series-language-memory.json"),
      seriesLanguageMemorySchema,
    ),
    readArtifact(
      path.join(subtitleDirectory, "episode-language-observations.json"),
      episodeLanguageObservationsSchema,
    ),
    readArtifact(
      path.join(subtitleDirectory, "series-language-memory-delta.json"),
      seriesLanguageMemoryDeltaSchema,
    ),
    readArtifact(
      path.join(subtitleDirectory, "subtitle-series-memory-evidence.json"),
      subtitleSeriesMemoryEvidenceSchema,
    ),
    readArtifact(
      path.join(subtitleDirectory, "subtitle-memory-assisted-ranking.json"),
      subtitleMemoryAssistedRankingSchema,
    ),
    readArtifact(
      path.join(
        subtitleDirectory,
        "subtitle-memory-pronunciation-projection.json",
      ),
      subtitleMemoryPronunciationProjectionSchema,
    ),
    readArtifact(
      path.join(subtitleDirectory, "memory-assisted-ctc-target-audit.json"),
      memoryAssistedCtcTargetAuditSchema,
    ),
    readArtifact(
      path.join(subtitleDirectory, "memory-assisted-ctc-observation.json"),
      memoryAssistedCtcObservationSchema,
    ),
    readArtifact(
      path.join(subtitleDirectory, "c5-19-causal-validation.json"),
      c519CausalValidationSchema,
    ),
    readArtifact(
      path.join(subtitleDirectory, "series-memory-quality-audit.json"),
      seriesMemoryQualityAuditSchema,
    ),
    readArtifact(
      path.join(subtitleDirectory, "subtitle-review-package.json"),
      subtitleReviewPackageSchema,
    ),
    readArtifact(
      path.join(subtitleDirectory, "subtitle-finalization-report.json"),
      subtitleFinalizationReportSchema,
    ),
  ]);
  const recomputedMemoryHash = stableMemoryHash({
    seriesIdentity: memory.seriesIdentity,
    configuration: memory.configuration,
    entries: memory.entries,
    conflicts: memory.conflicts,
  });
  const shareable = await auditC5161ShareableArtifacts(
    path.join(root, "shareable"),
  );
  const delivery = await auditReviewDeliveryIntegrity(root);
  const checks = {
    summaryKind: summary.runKind === expectedKind,
    cueCount:
      summary.sourceCueCount === 192 &&
      observations.statistics.sourceCueCount === 192,
    seriesVerified:
      memory.seriesIdentity.identityStatus === "verified" &&
      memory.seriesIdentity.memoryScope === "series",
    memorySchema: memory.entries.length === memory.statistics.entryCount,
    memorySemanticHash: recomputedMemoryHash === memory.memoryHash,
    memoryHashParity:
      summary.memoryHash === memory.memoryHash &&
      evidence.memoryHash === memory.memoryHash &&
      ranking.memoryHash === memory.memoryHash &&
      projection.memoryHash === memory.memoryHash,
    canonicalHash: summary.hashes.canonicalCueHash === EXPECTED_CANONICAL,
    timingHash: summary.hashes.canonicalTimingHash === EXPECTED_TIMING,
    presentationHash: summary.hashes.presentationHash === EXPECTED_PRESENTATION,
    noCanonicalMutation:
      isZero(summary.metrics.canonicalTextMutationCount) &&
      isZero(projection.summary.pronunciationProjectionCanonicalMutationCount),
    noTimingMutation:
      isZero(summary.metrics.timingMutationCount) &&
      isZero(ctcObservation.summary.memoryAssistedCtcTimingMutationCount),
    reviewPreserved:
      summary.reviewItemCountBefore === 7 &&
      summary.reviewItemCountAfter === 7 &&
      review.items.length === 7,
    noFabrication: isZero(ranking.summary.memoryFabricatedAutoCandidateCount),
    noAcousticOverride: isZero(
      ranking.summary.memoryAcousticOverrideViolationCount,
    ),
    noRankingRegression: isZero(ranking.summary.memoryRankingRegressionCount),
    noCrossSeriesLeak: isZero(evidence.summary.crossSeriesMemoryLeakCount),
    noCausalLeak:
      isZero(causal.summary.futureCueMemoryLeakCount) &&
      isZero(causal.summary.sameCueMemoryLeakCount),
    noGlobalReplacement: isZero(evidence.summary.globalReplacementCount),
    ctcBaseline:
      ctcAudit.summary.previousEncodableCueCount === 14 &&
      ctcAudit.summary.previousUnencodableCueCount === 2,
    ctcProjection:
      ctcAudit.summary.memoryAssistedEncodableCueCount >= 14 &&
      ctcObservation.attempts.length <= 4,
    qualitySample:
      quality.sampledEntryCount >= Math.min(30, memory.entries.length),
    shareable:
      shareable.validationPassed &&
      shareable.absolutePathLeakCount === 0 &&
      shareable.prohibitedSecretCount === 0 &&
      shareable.brokenRelativeReferenceCount === 0,
    reviewDelivery:
      delivery.passed &&
      delivery.current.summary.reviewAudioPlayableCount === 7,
    finalState:
      equalsText(summary.finalStatus, "needs-review") &&
      equalsText(summary.finalizationMethod, "none") &&
      finalization.status === "needs-review" &&
      finalization.finalizationMethod === "none",
    finalizationMemoryMetrics:
      finalization.finalizationVersion ===
        "C5.19-series-language-memory-observe-v1" &&
      finalization.metrics.seriesMemorySourceCueCount ===
        summary.metrics.sourceCueCount &&
      finalization.metrics.memoryEntryCount ===
        summary.metrics.memoryEntryCount &&
      finalization.metrics.memoryRankingRegressionCount === 0 &&
      finalization.metrics.memoryCanonicalTextMutationCount === 0 &&
      finalization.metrics.memoryTimingMutationCount === 0 &&
      finalization.metrics.targetedMemoryCtcObserveCount ===
        summary.metrics.targetedCtcObserveCount &&
      finalization.metrics.seriesMemoryIdempotentMergePassed === 1 &&
      finalization.outputPaths.seriesLanguageMemory ===
        "series-language-memory.json" &&
      finalization.outputPaths.subtitleMemoryAssistedRanking ===
        "subtitle-memory-assisted-ranking.json" &&
      finalization.outputPaths.memoryAssistedCtcObservation ===
        "memory-assisted-ctc-observation.json",
    idempotentMerge: summary.metrics.idempotentMergePassed === 1,
    deltaSchema: delta.deltaHash.length === 64,
  };
  return { root, summary, memory, ctcAudit, ctcObservation, causal, checks };
}

const [bootstrap, causal, frozen] = await Promise.all([
  validateRun(values.bootstrap, "bootstrap"),
  validateRun(values.causal, "causal"),
  validateRun(values["frozen-replay"], "frozen"),
]);
const checks = {
  bootstrap: Object.values(bootstrap.checks).every(Boolean),
  causal: Object.values(causal.checks).every(Boolean),
  frozen: Object.values(frozen.checks).every(Boolean),
  semanticMemoryParity:
    bootstrap.memory.memoryHash === causal.memory.memoryHash &&
    bootstrap.memory.memoryHash === frozen.memory.memoryHash,
  causalLeakFree:
    isZero(causal.causal.summary.futureCueMemoryLeakCount) &&
    isZero(causal.causal.summary.sameCueMemoryLeakCount),
  targetedCtcBounded:
    bootstrap.ctcObservation.summary.requestCount <= 4 &&
    causal.ctcObservation.summary.requestCount === 0 &&
    frozen.ctcObservation.summary.requestCount === 0,
  waterEggplantRescued:
    bootstrap.ctcAudit.summary.previousUnencodableCueRescuedCount === 2,
  immutableCanonical: [bootstrap, causal, frozen].every(
    (run) =>
      run.summary.hashes.canonicalCueHash === EXPECTED_CANONICAL &&
      run.summary.hashes.canonicalTimingHash === EXPECTED_TIMING,
  ),
};
const passed = Object.values(checks).every(Boolean);
const base = {
  schemaVersion: "1.0.0" as const,
  artifactType: "c5-19-run-validation" as const,
  validationVersion: "C5.19" as const,
  generatedAt: new Date().toISOString(),
  bootstrapPath: bootstrap.root,
  causalPath: causal.root,
  frozenPath: frozen.root,
  checks,
  idempotentMerge: [bootstrap, causal, frozen].every(
    (run) => run.summary.metrics.idempotentMergePassed === 1,
  ),
  passed,
};
const artifact = c519RunValidationSchema.parse({
  ...base,
  semanticHash: stableMemoryHash({ ...base, generatedAt: null }),
});
const output = path.resolve(
  values.output ?? path.join(bootstrap.root, "c5-19-run-validation.json"),
);
await atomicWriteJson(output, artifact, { overwrite: true });
process.stdout.write(
  `${JSON.stringify({ ok: passed, output, checks }, null, 2)}\n`,
);
if (!passed) process.exitCode = 1;
