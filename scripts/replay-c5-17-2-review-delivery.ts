import { createHash } from "node:crypto";
import { cp, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  InputError,
  atomicWriteJson,
  c5172ReviewDeliveryReplaySummarySchema,
  reviewActionHardeningModeSchema,
  reviewAudioModeSchema,
  reviewDeliveryIntegrityModeSchema,
  reviewEvidenceReconciliationModeSchema,
} from "@mvl/shared";
import {
  generateC5161ShareableArtifacts,
  buildReviewActionValidationReport,
  locateSubtitlePackage,
  repairReviewPackageDelivery,
  sha256Value,
  writeReviewDeliveryIntegrity,
} from "@mvl/video-subtitler";

const { values } = parseArgs({
  options: {
    task: { type: "string" },
    output: { type: "string" },
    "source-video": { type: "string" },
    "human-reviewed-subtitle": { type: "string" },
    "review-audio-mode": { type: "string", default: "auto" },
    "review-evidence-reconciliation": {
      type: "string",
      default: "enforce",
    },
    "review-delivery-integrity": { type: "string", default: "enforce" },
    "review-audio-context-seconds": { type: "string", default: "1.5" },
    "review-audio-maximum-seconds": { type: "string", default: "30" },
    "review-page-timeline": { type: "string", default: "true" },
    "review-action-hardening": { type: "string", default: "enforce" },
  },
  strict: true,
});

if (values.task === undefined) {
  throw new InputError(
    "Usage: npm run replay:c5-17-2-review-delivery -- --task <C5.17.1 task> [--output <new task>] [--review-audio-mode reuse-only]",
  );
}

function numberValue(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new InputError(`Invalid ${option}: ${value}`);
  }
  return parsed;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function sha256File(filePath: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

async function fingerprint(filePath: string) {
  const info = await stat(filePath);
  if (!info.isFile()) throw new InputError(`Input is not a file: ${filePath}`);
  return {
    size: info.size,
    mtimeMs: info.mtimeMs,
    sha256: await sha256File(filePath),
  };
}

function readOnlyIdentity(
  before: Awaited<ReturnType<typeof fingerprint>>,
  after: Awaited<ReturnType<typeof fingerprint>>,
) {
  return {
    sizeBefore: before.size,
    sizeAfter: after.size,
    mtimeMsBefore: before.mtimeMs,
    mtimeMsAfter: after.mtimeMs,
    sha256Before: before.sha256,
    sha256After: after.sha256,
    verified:
      before.size === after.size &&
      before.mtimeMs === after.mtimeMs &&
      before.sha256 === after.sha256,
  };
}

async function allocateOutput(sourceTask: string): Promise<string> {
  if (values.output !== undefined) {
    const explicit = path.resolve(values.output);
    if (await exists(explicit)) {
      throw new InputError(`Replay output already exists: ${explicit}`);
    }
    return explicit;
  }
  const parent = path.dirname(sourceTask);
  const sourceName = path.basename(sourceTask);
  const preferred = /c5-17-1[^/]*/u.test(sourceName)
    ? sourceName.replace(
        /c5-17-1[^/]*/u,
        "c5-17-2-review-evidence-audio-handoff-20260826",
      )
    : `${sourceName}-c5-17-2-review-evidence-audio-handoff`;
  for (let index = 0; index < 1_000; index += 1) {
    const candidate = path.join(
      parent,
      index === 0
        ? preferred
        : `${preferred}-${String(index).padStart(2, "0")}`,
    );
    if (!(await exists(candidate))) return candidate;
  }
  throw new InputError("Unable to allocate collision-safe C5.17.2 output.");
}

async function criticalHashes(subtitleDirectory: string) {
  const names = [
    "subtitle-review-package.json",
    "subtitle-finalization-report.json",
    "subtitle-canonical-forced-alignment.json",
    "subtitle-overlap-acoustic-resolution.json",
    "subtitle-timestamp-evidence-integrity.json",
    "subtitle-presentation-resolution.json",
    "subtitle-canonical-pronunciation.json",
    "subtitle-package.needs-review.json",
  ];
  const entries = await Promise.all(
    names.map(async (name): Promise<[string, string]> => [
      name,
      await sha256File(path.join(subtitleDirectory, name)),
    ]),
  );
  return Object.fromEntries(entries);
}

const sourceTask = path.resolve(values.task);
const outputTask = await allocateOutput(sourceTask);
const audioMode = reviewAudioModeSchema.parse(values["review-audio-mode"]);
const evidenceMode = reviewEvidenceReconciliationModeSchema.parse(
  values["review-evidence-reconciliation"],
);
const deliveryMode = reviewDeliveryIntegrityModeSchema.parse(
  values["review-delivery-integrity"],
);
const actionHardeningMode = reviewActionHardeningModeSchema.parse(
  values["review-action-hardening"],
);
const reviewPageTimeline = values["review-page-timeline"] === "true";
if (!["true", "false"].includes(values["review-page-timeline"])) {
  throw new InputError("--review-page-timeline must be true or false.");
}
const sourceVideo =
  values["source-video"] === undefined
    ? null
    : path.resolve(values["source-video"]);
const humanSubtitle =
  values["human-reviewed-subtitle"] === undefined
    ? null
    : path.resolve(values["human-reviewed-subtitle"]);
const sourceVideoBefore =
  sourceVideo === null ? null : await fingerprint(sourceVideo);
const humanSubtitleBefore =
  humanSubtitle === null ? null : await fingerprint(humanSubtitle);
const sourceLocated = await locateSubtitlePackage(sourceTask);
const sourceCriticalBefore = await criticalHashes(
  sourceLocated.subtitleDirectory,
);
const sourceReviewJavascript = await readFile(
  path.join(sourceLocated.subtitleDirectory, "review", "assets", "review.js"),
  "utf8",
);
const legacyShortcutRoutePresent = sourceReviewJavascript.includes(
  "if(e.key==='a')resolution(item,'ACCEPT_SUGGESTION')",
);

await cp(sourceTask, outputTask, {
  recursive: true,
  errorOnExist: true,
  force: false,
  preserveTimestamps: true,
});
const targetLocated = await locateSubtitlePackage(outputTask);
await rm(path.join(outputTask, "shareable"), { recursive: true, force: true });
await rm(path.join(outputTask, "c5-17-2-review-delivery-replay-summary.json"), {
  force: true,
});
// Force a real handoff from the read-only source task instead of treating files
// inherited by the directory copy as newly generated output.
await rm(path.join(targetLocated.subtitleDirectory, "audio", "review"), {
  recursive: true,
  force: true,
});

const repaired = await repairReviewPackageDelivery({
  sourceTaskDirectory: sourceTask,
  targetTaskDirectory: outputTask,
  audioMode,
  evidenceMode,
  sourceVideoPath: sourceVideo,
  contextSeconds: numberValue(
    values["review-audio-context-seconds"],
    "--review-audio-context-seconds",
  ),
  maximumSeconds: numberValue(
    values["review-audio-maximum-seconds"],
    "--review-audio-maximum-seconds",
  ),
  reviewPageTimeline,
});

const sourceCues = repaired.source.subtitlePackage.cues;
const outputCues = repaired.target.subtitlePackage.cues;
// Match the canonical package identity used by finalization (all strict-v1 cue
// fields), while the separate timing hash below makes timing parity explicit.
const canonicalCueHashBefore = sha256Value(sourceCues);
const canonicalCueHashAfter = sha256Value(outputCues);
const canonicalTimingHashBefore = sha256Value(
  sourceCues.map((cue) => ({ id: cue.id, start: cue.start, end: cue.end })),
);
const canonicalTimingHashAfter = sha256Value(
  outputCues.map((cue) => ({ id: cue.id, start: cue.start, end: cue.end })),
);
const delivery = await writeReviewDeliveryIntegrity({
  mode: deliveryMode,
  sourceTaskName: path.basename(sourceTask),
  subtitleDirectory: repaired.targetSubtitleDirectory,
  sourceReviewPackageHash: repaired.source.hashes.reviewPackage,
  sourceFinalizationReportHash: repaired.source.hashes.finalizationReport,
  baseTimingHash: canonicalTimingHashBefore,
  canonicalCueHashUnchanged: canonicalCueHashBefore === canonicalCueHashAfter,
  canonicalTimingHashUnchanged:
    canonicalTimingHashBefore === canonicalTimingHashAfter,
});
if (delivery.artifact === null || delivery.path === null) {
  throw new InputError(
    "C5.17.2 replay requires a review delivery integrity artifact.",
  );
}
if (
  outputCues.length !== 192 ||
  repaired.reviewPackage.items.length !== 7 ||
  repaired.finalizationReport.status !== "needs-review" ||
  repaired.finalizationReport.finalizationMethod !== "none"
) {
  throw new InputError("C5.17.2 canonical/review safety invariants failed.");
}

const pageAssetsHash = sha256Value(
  await Promise.all(
    ["index.html", "assets/review.css", "assets/review.js"].map(
      async (relative) => ({
        relative,
        sha256: await sha256File(
          path.join(repaired.targetSubtitleDirectory, "review", relative),
        ),
      }),
    ),
  ),
);
const sourceVideoAfter =
  sourceVideo === null ? null : await fingerprint(sourceVideo);
const humanSubtitleAfter =
  humanSubtitle === null ? null : await fingerprint(humanSubtitle);
const sourceCriticalAfter = await criticalHashes(
  sourceLocated.subtitleDirectory,
);
const sourceTaskCriticalArtifactsReadOnly =
  sha256Value(sourceCriticalBefore) === sha256Value(sourceCriticalAfter);
const sourceVideoReadOnly =
  sourceVideoBefore === null || sourceVideoAfter === null
    ? null
    : readOnlyIdentity(sourceVideoBefore, sourceVideoAfter);
const humanSubtitleReadOnly =
  humanSubtitleBefore === null || humanSubtitleAfter === null
    ? null
    : readOnlyIdentity(humanSubtitleBefore, humanSubtitleAfter);
if (
  !sourceTaskCriticalArtifactsReadOnly ||
  sourceVideoReadOnly?.verified === false ||
  humanSubtitleReadOnly?.verified === false
) {
  throw new InputError("A read-only C5.17.2 input changed during replay.");
}
const outputReviewPackageHash = await sha256File(
  repaired.target.paths.reviewPackage,
);
const reviewActionValidationReport = buildReviewActionValidationReport({
  mode: actionHardeningMode,
  sourceReviewPackage: repaired.source.reviewPackage,
  targetReviewPackage: repaired.reviewPackage,
  targetReviewPackageHash: outputReviewPackageHash,
  legacyShortcutRoutePresent,
});
const reviewActionValidationReportPath = path.join(
  repaired.targetSubtitleDirectory,
  "review-action-validation-report.json",
);
await atomicWriteJson(
  reviewActionValidationReportPath,
  reviewActionValidationReport,
  { overwrite: true },
);
const outputFinalizationReportHash = await sha256File(
  repaired.target.paths.finalizationReport,
);
const outputReviewPackage = JSON.parse(
  await readFile(repaired.target.paths.reviewPackage, "utf8"),
) as Record<string, unknown>;
const outputFinalizationReport = JSON.parse(
  await readFile(repaired.target.paths.finalizationReport, "utf8"),
) as Record<string, unknown>;
const reviewPackageSemanticHash = sha256Value({
  ...outputReviewPackage,
  generatedAt: null,
});
const finalizationSemanticHash = sha256Value({
  ...outputFinalizationReport,
  generatedAt: null,
});
const reviewAudioHashes = repaired.reviewPackage.items
  .map((item) => ({ reviewId: item.reviewId, sha256: item.audioSha256 }))
  .toSorted((left, right) => left.reviewId.localeCompare(right.reviewId));
const presentationHashAfter = await sha256File(
  repaired.target.paths.presentation,
);
const summaryBase = {
  schemaVersion: "1.0.0" as const,
  artifactType: "c5-17-2-review-delivery-replay-summary" as const,
  replayVersion: "C5.17.2" as const,
  generatedAt: new Date().toISOString(),
  sourceTaskName: path.basename(sourceTask),
  outputTaskName: path.basename(outputTask),
  reviewAudioMode: audioMode,
  reviewEvidenceReconciliation: evidenceMode,
  reviewDeliveryIntegrity: deliveryMode,
  reviewPageTimeline,
  sourceReviewPackageHash: repaired.source.hashes.reviewPackage,
  sourceFinalizationReportHash: repaired.source.hashes.finalizationReport,
  outputReviewPackageHash,
  outputFinalizationReportHash,
  reviewPackageSemanticHash,
  finalizationSemanticHash,
  reviewAudioHashes,
  evidenceReconciliationHash:
    repaired.reviewPackage.evidenceReconciliationHash ?? sha256Value([]),
  deliveryIntegritySemanticHash: delivery.artifact.semanticHash,
  canonicalCueHashBefore,
  canonicalCueHashAfter,
  canonicalTimingHashBefore,
  canonicalTimingHashAfter,
  presentationHashBefore: repaired.source.hashes.presentation,
  presentationHashAfter,
  reviewPageAssetsHash: pageAssetsHash,
  sourceTaskCriticalArtifactsReadOnly,
  sourceVideoReadOnly,
  humanSubtitleReadOnly,
  execution: {
    mfaProcessCount: 0 as const,
    whisperProcessCount: 0 as const,
    sudachiProcessCount: 0 as const,
    g2pProcessCount: 0 as const,
    ffmpegProcessCount: 0 as const,
    wholeMediaAsrRequestCount: 0 as const,
    openAiRequestCount: 0 as const,
    onlineSubtitleLookupCount: 0 as const,
  },
  outcome: {
    cueCount: outputCues.length,
    reviewItemCount: repaired.reviewPackage.summary.itemCount,
    reviewAudioPlayableCount:
      delivery.artifact.summary.reviewAudioPlayableCount,
    reviewDeliveryIntegrityPassed:
      delivery.artifact.summary.reviewDeliveryIntegrityPassed,
    finalStatus: "needs-review" as const,
    finalizationMethod: "none" as const,
  },
};
const summary = c5172ReviewDeliveryReplaySummarySchema.parse({
  ...summaryBase,
  semanticHash: sha256Value({ ...summaryBase, generatedAt: null }),
});
const summaryPath = path.join(
  outputTask,
  "c5-17-2-review-delivery-replay-summary.json",
);
await atomicWriteJson(summaryPath, summary, { overwrite: false });

const sourceShareable = path.join(sourceTask, "shareable");
await generateC5161ShareableArtifacts({
  taskRoot: outputTask,
  subtitleDirectory: repaired.targetSubtitleDirectory,
  localExecutionSummaryPath: summaryPath,
  stockPatchedRuntimeAbPath: path.join(
    sourceShareable,
    "c5-16-stock-patched-runtime-ab.json",
  ),
  outputDirectory: path.join(outputTask, "shareable"),
  externalFiles: [
    ...(sourceVideo === null
      ? []
      : [{ role: "source-video", filePath: sourceVideo }]),
    ...(humanSubtitle === null
      ? []
      : [{ role: "human-reviewed-subtitle", filePath: humanSubtitle }]),
  ],
  c517Artifacts: {
    runtimeCapabilityPath: path.join(
      repaired.targetSubtitleDirectory,
      "forced-alignment-runtime-capability.json",
    ),
    canonicalInputPath: path.join(
      repaired.targetSubtitleDirectory,
      "subtitle-canonical-alignment-input.json",
    ),
    forcedAlignmentPath: repaired.target.paths.forcedAlignment,
    replaySummaryPath: path.join(
      outputTask,
      "c5-17-forced-alignment-replay-summary.json",
    ),
    pronunciationPath: repaired.target.paths.pronunciation,
    sudachiRuntimeCapabilityPath: path.join(
      repaired.targetSubtitleDirectory,
      "sudachi-runtime-capability.json",
    ),
    cacheManifestPath: path.join(
      repaired.targetSubtitleDirectory,
      "forced-alignment-cache-manifest.json",
    ),
    runtimePreparationSummaryPath: path.join(
      sourceShareable,
      "c5-17-1-runtime-preparation-summary.json",
    ),
    freshCacheObserveValidationPath: path.join(
      outputTask,
      "c5-17-1-fresh-cache-observe-validation.json",
    ),
  },
  c5172Artifacts: {
    deliveryIntegrityPath: delivery.path,
    replaySummaryPath: summaryPath,
    reviewActionValidationReportPath,
  },
});

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      outputTask,
      subtitleDirectory: repaired.targetSubtitleDirectory,
      reviewPackage: repaired.target.paths.reviewPackage,
      finalizationReport: repaired.target.paths.finalizationReport,
      deliveryIntegrity: delivery.path,
      replaySummary: summaryPath,
      reviewActionValidationReport: reviewActionValidationReportPath,
      metrics: delivery.artifact.summary,
    },
    null,
    2,
  )}\n`,
);
