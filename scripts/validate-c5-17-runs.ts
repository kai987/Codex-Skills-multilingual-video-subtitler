import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  InputError,
  atomicWriteJson,
  c517ForcedAlignmentReplaySummarySchema,
  forcedAlignmentCacheManifestSchema,
  forcedAlignmentRuntimeCapabilitySchema,
  subtitleCanonicalAlignmentInputSchema,
  subtitleCanonicalForcedAlignmentSchema,
  subtitleFinalizationReportSchema,
  subtitleOverlapAcousticResolutionSchema,
  subtitlePackageSchema,
  subtitlePresentationResolutionSchema,
} from "@mvl/shared";
import { auditC5161ShareableArtifacts } from "@mvl/video-subtitler";

const { values } = parseArgs({
  options: {
    fresh: { type: "string" },
    "cache-replay": { type: "string" },
    observe: { type: "string" },
    output: { type: "string" },
  },
  strict: true,
});

if (
  values.fresh === undefined ||
  values["cache-replay"] === undefined ||
  values.observe === undefined
) {
  throw new InputError(
    "Usage: npm run validate:c5-17-runs -- --fresh <task> --cache-replay <task> --observe <task> [--output <validation.json>]",
  );
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new InputError(message);
}

async function json(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

async function findSubtitleDirectory(taskRoot: string): Promise<string> {
  const entries = await readdir(taskRoot, { withFileTypes: true });
  const matches = entries.filter(
    (entry) => entry.isDirectory() && entry.name.startsWith("subtitle-"),
  );
  invariant(
    matches.length === 1 && matches[0] !== undefined,
    `Expected one subtitle-* directory in ${taskRoot}.`,
  );
  return path.join(taskRoot, matches[0].name);
}

async function load(taskInput: string) {
  const taskRoot = path.resolve(taskInput);
  const subtitleDirectory = await findSubtitleDirectory(taskRoot);
  const summary = c517ForcedAlignmentReplaySummarySchema.parse(
    await json(
      path.join(taskRoot, "c5-17-forced-alignment-replay-summary.json"),
    ),
  );
  const canonical = subtitleCanonicalAlignmentInputSchema.parse(
    await json(
      path.join(subtitleDirectory, "subtitle-canonical-alignment-input.json"),
    ),
  );
  const alignment = subtitleCanonicalForcedAlignmentSchema.parse(
    await json(
      path.join(subtitleDirectory, "subtitle-canonical-forced-alignment.json"),
    ),
  );
  const runtime = forcedAlignmentRuntimeCapabilitySchema.parse(
    await json(
      path.join(subtitleDirectory, "forced-alignment-runtime-capability.json"),
    ),
  );
  const cache = forcedAlignmentCacheManifestSchema.parse(
    await json(
      path.join(subtitleDirectory, "forced-alignment-cache-manifest.json"),
    ),
  );
  const report = subtitleFinalizationReportSchema.parse(
    await json(
      path.join(subtitleDirectory, "subtitle-finalization-report.json"),
    ),
  );
  const presentation = subtitlePresentationResolutionSchema.parse(
    await json(
      path.join(subtitleDirectory, "subtitle-presentation-resolution.json"),
    ),
  );
  const overlap = subtitleOverlapAcousticResolutionSchema.parse(
    await json(
      path.join(subtitleDirectory, "subtitle-overlap-acoustic-resolution.json"),
    ),
  );
  const subtitlePackage = subtitlePackageSchema.parse(
    await json(
      path.join(subtitleDirectory, report.outputPaths.subtitlePackage),
    ),
  );
  const shareableDirectory = path.join(taskRoot, "shareable");
  const shareable = await auditC5161ShareableArtifacts(shareableDirectory);
  return {
    taskRoot,
    subtitleDirectory,
    summary,
    canonical,
    alignment,
    runtime,
    cache,
    report,
    presentation,
    overlap,
    subtitlePackage,
    shareable,
  };
}

const [fresh, cacheReplay, observe] = await Promise.all([
  load(values.fresh),
  load(values["cache-replay"]),
  load(values.observe),
]);

invariant(fresh.summary.runKind === "fresh", "Fresh task has wrong runKind.");
invariant(
  cacheReplay.summary.runKind === "cache-replay",
  "Cache replay task has wrong runKind.",
);
invariant(
  observe.summary.runKind === "observe" &&
    observe.summary.forcedAlignmentMode === "observe",
  "Observe task is not an observe-mode run.",
);

for (const [label, run] of [
  ["fresh", fresh],
  ["cache-replay", cacheReplay],
  ["observe", observe],
] as const) {
  invariant(
    run.summary.backend === "hybrid",
    `${label}: backend is not hybrid.`,
  );
  invariant(
    run.summary.runtimeIdentityHash === run.runtime.runtimeIdentityHash,
    `${label}: runtime identity mismatch.`,
  );
  invariant(
    run.canonical.summary.componentCount === 7 &&
      run.canonical.summary.cueCount === 16,
    `${label}: target scope is not 7 components / 16 cues.`,
  );
  invariant(
    run.alignment.summary.attemptCount <= 32 &&
      run.alignment.summary.attemptCount <= run.alignment.summary.cueCount * 2,
    `${label}: alignment attempt bound exceeded.`,
  );
  // Strict schemas already constrain MFA to 3.4.2 and the canonical-text,
  // whole-media-ASR, and prompt-contamination counters to literal zero.
  invariant(
    run.report.metrics.wholeMediaAsrRequestCount === 0 &&
      run.report.metrics.overlapAsrRequestCount === 0,
    `${label}: Whisper or whole-media ASR request detected.`,
  );
  invariant(
    run.subtitlePackage.cues.length === 192 &&
      run.report.metrics.finalCueCount === 192,
    `${label}: canonical cue count is not 192.`,
  );
  invariant(
    run.summary.sourceReadOnly.verified &&
      run.summary.humanSubtitleReadOnly.verified &&
      run.summary.sourceSha256Before === run.summary.sourceSha256After &&
      run.summary.humanSubtitleSha256Before ===
        run.summary.humanSubtitleSha256After,
    `${label}: a read-only input changed.`,
  );
  // Cache schema fixes requestType to canonical-forced-alignment and rejects
  // any nonzero legacy ASR cache hit count.
  invariant(
    run.shareable.validationPassed &&
      run.shareable.absolutePathLeakCount === 0 &&
      run.shareable.prohibitedSecretCount === 0,
    `${label}: shareable artifact audit failed.`,
  );
  invariant(
    run.report.qualityGate.serializationRoundTripPassed &&
      run.report.qualityGate.canonicalParityPassed &&
      run.report.qualityGate.presentationParityPassed,
    `${label}: final round-trip/parity gate failed.`,
  );
  if (run.alignment.summary.unresolvedComponentCount > 0) {
    invariant(
      run.report.status === "needs-review" &&
        run.report.finalizationMethod === "none",
      `${label}: unresolved components require needs-review/none.`,
    );
  } else {
    invariant(
      run.report.status === "human-validated" &&
        run.report.finalizationMethod === "human",
      `${label}: fully resolved human baseline requires human-validated/human.`,
    );
  }
}

invariant(
  fresh.summary.metrics.attemptCount === 32 &&
    fresh.summary.metrics.cacheHitCount === 0 &&
    fresh.summary.metrics.mfaProcessCount === 32,
  "Fresh run must execute 32 MFA attempts with zero cache hits.",
);
invariant(
  cacheReplay.summary.metrics.attemptCount === 32 &&
    cacheReplay.summary.metrics.cacheHitCount === 32 &&
    cacheReplay.summary.metrics.mfaProcessCount === 0,
  "Cache replay must have 32/32 hits and zero MFA process executions.",
);
invariant(
  fresh.summary.canonicalInputHash === cacheReplay.summary.canonicalInputHash &&
    fresh.summary.alignmentHash === cacheReplay.summary.alignmentHash &&
    fresh.summary.componentDecisionHash ===
      cacheReplay.summary.componentDecisionHash &&
    fresh.summary.outputCueHash === cacheReplay.summary.outputCueHash,
  "Fresh and cache replay semantic hashes differ.",
);
invariant(
  fresh.summary.runtimeIdentityHash === cacheReplay.summary.runtimeIdentityHash,
  "Fresh/cache runtime identities differ.",
);
invariant(
  observe.summary.metrics.timingMutationCount === 0 &&
    observe.summary.canonicalTimingUnchanged &&
    observe.summary.blockersClosed === 0 &&
    observe.alignment.components.every(
      (component) =>
        !component.resolved && component.appliedMutations.length === 0,
    ),
  "Observe run modified timing or closed a blocker.",
);
invariant(
  observe.summary.canonicalInputHash === fresh.summary.canonicalInputHash,
  "Observe run canonical input differs from fresh run.",
);

const validation = {
  schemaVersion: "1.0.0",
  artifactType: "c5-17-cross-run-validation",
  generatedAt: new Date().toISOString(),
  runs: {
    fresh: path.basename(fresh.taskRoot),
    cacheReplay: path.basename(cacheReplay.taskRoot),
    observe: path.basename(observe.taskRoot),
  },
  runtimeIdentityHash: fresh.runtime.runtimeIdentityHash,
  hashes: {
    canonicalInputHash: fresh.summary.canonicalInputHash,
    alignmentHash: fresh.summary.alignmentHash,
    componentDecisionHash: fresh.summary.componentDecisionHash,
    outputCueHash: fresh.summary.outputCueHash,
    canonicalCueHash: fresh.report.outputCueHash,
    presentationCueHash: fresh.presentation.presentationCueHash,
  },
  freshMetrics: fresh.summary.metrics,
  cacheReplayMetrics: cacheReplay.summary.metrics,
  observeMetrics: observe.summary.metrics,
  sourceReadOnlyVerified: true,
  humanSubtitleReadOnlyVerified: true,
  shareableAuditPassed: true,
  accepted: true,
};
const outputPath = path.resolve(
  values.output ?? path.join(fresh.taskRoot, "c5-17-cross-run-validation.json"),
);
await atomicWriteJson(outputPath, validation, { overwrite: true });
process.stdout.write(
  `${JSON.stringify({ ok: true, outputPath, validation }, null, 2)}\n`,
);
