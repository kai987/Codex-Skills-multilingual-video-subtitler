import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  InputError,
  atomicWriteJson,
  subtitleFinalizationReportSchema,
  subtitleOverlapAcousticResolutionSchema,
  subtitlePackageSchema,
  subtitlePresentationResolutionSchema,
  subtitleTimestampEvidenceIntegritySchema,
  whisperExecutionMetricsSchema,
} from "@mvl/shared";
import {
  parseAss,
  parseSrt,
  parseVtt,
  presentationLexicalHash,
  type ParsedCue,
} from "@mvl/subtitle-core";
import { sha256Value } from "@mvl/video-subtitler";

const { values } = parseArgs({
  options: {
    fresh: { type: "string" },
    replay: { type: "string" },
    output: { type: "string" },
  },
  strict: true,
});

if (values.fresh === undefined || values.replay === undefined) {
  throw new InputError(
    "Usage: npm run validate:c5-15-1-runs -- --fresh <uncached-task> --replay <cache-replay-task> [--output <validation.json>]",
  );
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new InputError(message);
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

async function subtitleDirectory(taskDirectory: string): Promise<string> {
  const entries = await readdir(taskDirectory, { withFileTypes: true });
  const matches = entries.filter(
    (entry) => entry.isDirectory() && entry.name.startsWith("subtitle-"),
  );
  invariant(
    matches.length === 1 && matches[0] !== undefined,
    `Expected exactly one subtitle-* directory in ${taskDirectory}.`,
  );
  return path.join(taskDirectory, matches[0].name);
}

function lexical(cues: readonly ParsedCue[]): string[] {
  return cues.map((cue) => presentationLexicalHash(cue.text));
}

function maximumTimingDelta(
  left: readonly ParsedCue[],
  right: readonly ParsedCue[],
): number {
  invariant(left.length === right.length, "Serialized cue counts differ.");
  return Math.max(
    0,
    ...left.flatMap((cue, index) => {
      const other = right[index];
      invariant(other !== undefined, "Serialized cue index is missing.");
      return [Math.abs(cue.start - other.start), Math.abs(cue.end - other.end)];
    }),
  );
}

function componentDecisionSnapshot(
  artifact: ReturnType<typeof subtitleOverlapAcousticResolutionSchema.parse>,
) {
  return artifact.components.map((component) => ({
    componentId: component.componentId,
    finalRelationship: component.finalRelationship,
    recommendedAction: component.recommendedAction,
    safeAutomaticAction: component.safeAutomaticAction,
    blocking: component.blocking,
    bestHypothesisScore: component.bestHypothesisScore,
    runnerUpHypothesisScore: component.runnerUpHypothesisScore,
    decisionMargin: component.decisionMargin,
    timingMutations: component.timingMutations,
    timestampIntegrityGateFailures:
      component.timestampIntegrityGateFailures ?? [],
  }));
}

function canonicalTimingHash(
  subtitlePackage: ReturnType<typeof subtitlePackageSchema.parse>,
): string {
  return sha256Value(
    subtitlePackage.cues.map(({ id, start, end }) => ({ id, start, end })),
  );
}

async function loadRun(taskDirectory: string) {
  const subtitle = await subtitleDirectory(taskDirectory);
  const report = subtitleFinalizationReportSchema.parse(
    await readJson(path.join(subtitle, "subtitle-finalization-report.json")),
  );
  const presentation = subtitlePresentationResolutionSchema.parse(
    await readJson(
      path.join(subtitle, "subtitle-presentation-resolution.json"),
    ),
  );
  const acoustic = subtitleOverlapAcousticResolutionSchema.parse(
    await readJson(
      path.join(subtitle, "subtitle-overlap-acoustic-resolution.json"),
    ),
  );
  const integrity = subtitleTimestampEvidenceIntegritySchema.parse(
    await readJson(
      path.join(subtitle, "subtitle-timestamp-evidence-integrity.json"),
    ),
  );
  const execution = whisperExecutionMetricsSchema.parse(
    await readJson(
      path.join(subtitle, "overlap-whisper-execution-metrics.json"),
    ),
  );
  const subtitlePackage = subtitlePackageSchema.parse(
    await readJson(path.join(subtitle, report.outputPaths.subtitlePackage)),
  );
  const [srt, vtt, ass] = await Promise.all([
    readFile(path.join(subtitle, report.outputPaths.srt), "utf8").then(
      parseSrt,
    ),
    readFile(path.join(subtitle, report.outputPaths.vtt), "utf8").then(
      parseVtt,
    ),
    readFile(path.join(subtitle, report.outputPaths.ass), "utf8").then(
      parseAss,
    ),
  ]);
  const replaySummary = (await readJson(
    path.join(taskDirectory, "c5-15-1-timestamp-integrity-replay-summary.json"),
  )) as {
    sourceReadOnly?: {
      video?: { verified?: boolean };
      humanReviewedSubtitle?: { verified?: boolean };
    };
  };
  return {
    subtitle,
    report,
    presentation,
    acoustic,
    integrity,
    execution,
    subtitlePackage,
    srt,
    vtt,
    ass,
    replaySummary,
  };
}

const freshTask = path.resolve(values.fresh);
const replayTask = path.resolve(values.replay);
const [fresh, replay] = await Promise.all([
  loadRun(freshTask),
  loadRun(replayTask),
]);

for (const [label, run] of [
  ["fresh", fresh],
  ["replay", replay],
] as const) {
  invariant(
    run.subtitlePackage.cues.length === 192,
    `${label}: cue count != 192.`,
  );
  invariant(run.srt.length === 192, `${label}: SRT cue count != 192.`);
  invariant(run.vtt.length === 192, `${label}: VTT cue count != 192.`);
  invariant(run.ass.length === 192, `${label}: ASS cue count != 192.`);
  invariant(
    JSON.stringify(lexical(run.srt)) === JSON.stringify(lexical(run.vtt)) &&
      JSON.stringify(lexical(run.srt)) === JSON.stringify(lexical(run.ass)),
    `${label}: SRT/VTT/ASS lexical parity failed.`,
  );
  invariant(
    maximumTimingDelta(run.srt, run.vtt) <= 0.001,
    `${label}: SRT/VTT timing parity failed.`,
  );
  invariant(
    maximumTimingDelta(run.srt, run.ass) <= 0.011,
    `${label}: SRT/ASS timing parity failed.`,
  );
  invariant(
    run.integrity.summary.rawVadIntervalCount === 0,
    `${label}: installed server unexpectedly claimed raw VAD intervals.`,
  );
  invariant(
    run.integrity.configuration.mode === "enforce",
    `${label}: acceptance replay did not enforce timestamp integrity.`,
  );
  invariant(
    run.integrity.summary.untrustedTokenUsedForTimingCount === 0 &&
      run.integrity.summary.integrityGateFailures.length === 0 &&
      run.acoustic.components.every(
        (component) =>
          (component.timestampIntegrityGateFailures?.length ?? 0) === 0,
      ),
    `${label}: timestamp integrity gate did not finish cleanly.`,
  );
  const tokenById = new Map(
    run.acoustic.attempts.flatMap((attempt) =>
      attempt.tokens.map((token) => [token.tokenId, token] as const),
    ),
  );
  for (const interval of run.acoustic.components.flatMap((component) =>
    component.cueAlignments.flatMap((alignment) => alignment.matchedIntervals),
  )) {
    if (
      interval.source !== "trusted-mapped-token" &&
      interval.source !== "trusted-no-vad-token"
    )
      continue;
    for (const tokenId of (interval.evidenceId ?? "").split("+")) {
      const token = tokenById.get(tokenId);
      invariant(token !== undefined, `${label}: timing token is missing.`);
      invariant(
        token.timingUsable === true &&
          token.mappedCoordinateSystem === "original-media-global" &&
          token.tokenTimelineStatus?.startsWith("trusted") === true,
        `${label}: admitted token timing is not trusted/global.`,
      );
    }
  }
  invariant(
    run.acoustic.summary.timingMutationCount === 0,
    `${label}: forbidden automatic timing mutation occurred.`,
  );
  const readOnly = run.replaySummary.sourceReadOnly;
  invariant(
    readOnly?.video?.verified === true &&
      readOnly.humanReviewedSubtitle?.verified === true,
    `${label}: source read-only verification failed.`,
  );
}

invariant(
  fresh.acoustic.summary.asrRequestCount === 21 &&
    fresh.acoustic.summary.cacheHitCount === 0 &&
    fresh.execution.workerStartCount === 1 &&
    fresh.execution.modelLoadCount === 1,
  "Fresh run did not execute exactly 21 uncached requests with one persistent worker/model load.",
);
invariant(
  replay.acoustic.summary.asrRequestCount === 0 &&
    replay.acoustic.summary.cacheHitCount === 21 &&
    replay.execution.workerStartCount === 0 &&
    replay.execution.modelLoadCount === 0,
  "Replay did not produce exactly 21 cache hits without worker/model load.",
);
invariant(
  fresh.presentation.canonicalCueHash ===
    replay.presentation.canonicalCueHash &&
    fresh.presentation.presentationCueHash ===
      replay.presentation.presentationCueHash,
  "Canonical or presentation hashes differ across replay.",
);
invariant(
  canonicalTimingHash(fresh.subtitlePackage) ===
    canonicalTimingHash(replay.subtitlePackage),
  "Canonical timing hashes differ across replay.",
);
invariant(
  fresh.integrity.summary.integrityHash ===
    replay.integrity.summary.integrityHash &&
    fresh.integrity.runtimeCapability.runtimeTimestampCapabilityHash ===
      replay.integrity.runtimeCapability.runtimeTimestampCapabilityHash,
  "Timestamp integrity or runtime capability hashes differ across replay.",
);
invariant(
  JSON.stringify(componentDecisionSnapshot(fresh.acoustic)) ===
    JSON.stringify(componentDecisionSnapshot(replay.acoustic)),
  "Component decisions differ across replay.",
);

const result = {
  schemaVersion: "1.0.0",
  validationType: "C5.15.1 uncached/cache replay parity",
  generatedAt: new Date().toISOString(),
  freshTaskName: path.basename(freshTask),
  replayTaskName: path.basename(replayTask),
  cueCount: fresh.subtitlePackage.cues.length,
  serializedCueCounts: {
    srt: fresh.srt.length,
    vtt: fresh.vtt.length,
    ass: fresh.ass.length,
  },
  formatParity: {
    lexical: true,
    maximumSrtVttTimingDeltaSeconds: maximumTimingDelta(fresh.srt, fresh.vtt),
    maximumSrtAssTimingDeltaSeconds: maximumTimingDelta(fresh.srt, fresh.ass),
  },
  canonicalCueHash: fresh.presentation.canonicalCueHash,
  canonicalTimingHash: canonicalTimingHash(fresh.subtitlePackage),
  presentationCueHash: fresh.presentation.presentationCueHash,
  timestampIntegrityHash: fresh.integrity.summary.integrityHash,
  runtimeTimestampCapabilityHash:
    fresh.integrity.runtimeCapability.runtimeTimestampCapabilityHash,
  tokenHealth: {
    trustedTokenCount: fresh.integrity.summary.trustedTokenCount,
    quarantinedTokenCount: fresh.integrity.summary.quarantinedTokenCount,
    untrustedTokenUsedForTimingCount:
      fresh.integrity.summary.untrustedTokenUsedForTimingCount,
    rawVadIntervalCount: fresh.integrity.summary.rawVadIntervalCount,
  },
  freshExecution: {
    asrRequestCount: fresh.acoustic.summary.asrRequestCount,
    cacheHitCount: fresh.acoustic.summary.cacheHitCount,
    workerStartCount: fresh.execution.workerStartCount,
    modelLoadCount: fresh.execution.modelLoadCount,
    totalWorkerSeconds: fresh.execution.totalWorkerSeconds,
  },
  replayExecution: {
    asrRequestCount: replay.acoustic.summary.asrRequestCount,
    cacheHitCount: replay.acoustic.summary.cacheHitCount,
    workerStartCount: replay.execution.workerStartCount,
    modelLoadCount: replay.execution.modelLoadCount,
    totalWorkerSeconds: replay.execution.totalWorkerSeconds,
  },
  outcome: {
    status: fresh.report.status,
    finalizationMethod: fresh.report.finalizationMethod,
    unresolvedComponentCount: fresh.acoustic.summary.unresolvedCount,
    canonicalTextMutationCount:
      fresh.acoustic.summary.canonicalTextMutationCount,
    timingMutationCount: fresh.acoustic.summary.timingMutationCount,
    sourceReadOnlyVerified: true,
  },
  componentDecisions: componentDecisionSnapshot(fresh.acoustic),
};

if (values.output !== undefined) {
  await atomicWriteJson(path.resolve(values.output), result, {
    overwrite: false,
  });
}
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
