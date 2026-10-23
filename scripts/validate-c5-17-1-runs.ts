import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  InputError,
  atomicWriteJson,
  c5171FreshCacheObserveValidationSchema,
  c517ForcedAlignmentReplaySummarySchema,
} from "@mvl/shared";
import { auditC5161ShareableArtifacts } from "@mvl/video-subtitler";

const { values } = parseArgs({
  options: {
    fresh: { type: "string" },
    observe: { type: "string" },
    cache: { type: "string" },
    output: { type: "string" },
  },
  strict: true,
});

if (
  values.fresh === undefined ||
  values.observe === undefined ||
  values.cache === undefined ||
  values.output === undefined
) {
  throw new InputError(
    "Usage: npm run validate:c5-17-1-runs -- --fresh <task> --observe <task> --cache <task> --output <json>",
  );
}

async function loadSummary(task: string) {
  const taskRoot = path.resolve(task);
  const summary = c517ForcedAlignmentReplaySummarySchema.parse(
    JSON.parse(
      await readFile(
        path.join(taskRoot, "c5-17-forced-alignment-replay-summary.json"),
        "utf8",
      ),
    ) as unknown,
  );
  if (summary.replayVersion !== "C5.17.1") {
    throw new InputError(`Not a C5.17.1 replay: ${taskRoot}`);
  }
  return { taskRoot, summary };
}

const [fresh, observe, cache] = await Promise.all([
  loadSummary(values.fresh),
  loadSummary(values.observe),
  loadSummary(values.cache),
]);
if (
  fresh.summary.runKind !== "fresh" ||
  observe.summary.runKind !== "observe" ||
  cache.summary.runKind !== "cache-replay"
) {
  throw new InputError("Fresh/observe/cache task roles do not match runKind.");
}
if (
  fresh.summary.metrics.attemptCount === 0 ||
  fresh.summary.metrics.mfaProcessCount === 0
) {
  throw new InputError(
    "Fresh validation requires real MFA attempts/processes.",
  );
}
if (
  cache.summary.metrics.cacheHitCount !== fresh.summary.metrics.attemptCount ||
  cache.summary.metrics.mfaProcessCount !== 0
) {
  throw new InputError("Cache replay did not fully hit without MFA execution.");
}
if (observe.summary.metrics.timingMutationCount !== 0) {
  throw new InputError("Observe replay unexpectedly mutated timing.");
}
const audits = await Promise.all([
  auditC5161ShareableArtifacts(path.join(fresh.taskRoot, "shareable")),
  auditC5161ShareableArtifacts(path.join(observe.taskRoot, "shareable")),
  auditC5161ShareableArtifacts(path.join(cache.taskRoot, "shareable")),
] as const);
const shareableAuditPassed = audits.every(
  (audit) =>
    audit.validationPassed &&
    audit.absolutePathLeakCount === 0 &&
    audit.prohibitedSecretCount === 0,
);
if (!shareableAuditPassed) {
  throw new InputError("At least one C5.17.1 shareable audit failed.");
}
const sourceVideoUnchanged = [fresh, observe, cache].every(
  (run) => run.summary.sourceReadOnly.verified,
);
const humanSubtitleUnchanged = [fresh, observe, cache].every(
  (run) => run.summary.humanSubtitleReadOnly.verified,
);
const validation = c5171FreshCacheObserveValidationSchema.parse({
  schemaVersion: "1.0.0",
  artifactType: "c5-17-1-fresh-cache-observe-validation",
  generatedAt: new Date().toISOString(),
  freshTask: path.basename(fresh.taskRoot),
  observeTask: path.basename(observe.taskRoot),
  cacheReplayTask: path.basename(cache.taskRoot),
  freshAttemptCount: fresh.summary.metrics.attemptCount,
  freshMfaProcessCount: fresh.summary.metrics.mfaProcessCount,
  cacheHitCount: cache.summary.metrics.cacheHitCount,
  cacheReplayMfaProcessCount: cache.summary.metrics.mfaProcessCount,
  observeTimingMutationCount: observe.summary.metrics.timingMutationCount,
  alignmentHashMatches:
    fresh.summary.alignmentHash === cache.summary.alignmentHash,
  componentDecisionHashMatches:
    fresh.summary.componentDecisionHash === cache.summary.componentDecisionHash,
  mutationHashMatches:
    fresh.summary.mutationHash !== undefined &&
    fresh.summary.mutationHash === cache.summary.mutationHash,
  outputCueHashMatches:
    fresh.summary.outputCueHash === cache.summary.outputCueHash,
  shareableAuditPassed,
  sourceVideoUnchanged,
  humanSubtitleUnchanged,
});
const output = path.resolve(values.output);
await atomicWriteJson(output, validation, { overwrite: true });
process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      output,
      validation,
      audits: audits.map((audit) => ({
        artifactCount: audit.manifest.summary.artifactCount,
        absolutePathLeakCount: audit.absolutePathLeakCount,
        prohibitedSecretCount: audit.prohibitedSecretCount,
      })),
    },
    null,
    2,
  )}\n`,
);
