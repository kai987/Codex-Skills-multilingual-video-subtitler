import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  InputError,
  atomicWriteJson,
  c516StockPatchedRuntimeAbArtifactSchema,
  grammarReportSchema,
  subtitleFinalizationReportSchema,
  subtitleOverlapAcousticResolutionSchema,
  subtitlePackageSchema,
  subtitlePresentationResolutionSchema,
  subtitleTimestampEvidenceIntegritySchema,
  whisperExecutionMetricsSchema,
  whisperRuntimeCapabilityArtifactSchema,
} from "@mvl/shared";
import {
  parseAss,
  parseSrt,
  parseVtt,
  presentationLexicalHash,
  type ParsedCue,
} from "@mvl/subtitle-core";
import {
  overlapAcousticEvidenceForHash,
  sha256Value,
} from "@mvl/video-subtitler";

const EXPECTED = {
  upstreamCommit: "371b5a7561823ab2bb32142d2751e35e7534727b",
  patchSha256:
    "bba39640e7005a1fdeb62c549d04ba76b6fc0d8aedae43daf9c9de1ab10a735d",
  patchedBinarySha256:
    "da90c5114004888473cdde9a5407a2f3e2b630f9a4900481132558447d7f8952",
  canonicalCueHash:
    "8ec01ef362387aa4a4b61cb7c7cb3d2d4f4932f38aff3a4b5695deedfa1ccc83",
  canonicalTimingHash:
    "510c3f20b82ecd263cd2234057536eaddda0dc94efac599ffe72aa3fc843ec02",
  presentationCueHash:
    "9e1371375397df403bf2647cc805b8c70d6c2628eca1eb4f94dca32cc7eed4de",
  videoSha256:
    "294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43",
  videoSize: 847_774_958,
  humanSubtitleSha256:
    "a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e",
  humanSubtitleSize: 17_094,
} as const;

const { values } = parseArgs({
  options: {
    fresh: { type: "string" },
    replay: { type: "string" },
    ab: { type: "string" },
    output: { type: "string" },
  },
  strict: true,
});

if (
  values.fresh === undefined ||
  values.replay === undefined ||
  values.ab === undefined
) {
  throw new InputError(
    "Usage: npm run validate:c5-16-runs -- --fresh <uncached-task> --replay <cache-replay-task> --ab <runtime-ab.json> [--output <validation.json>]",
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

function canonicalTimingHash(
  subtitlePackage: ReturnType<typeof subtitlePackageSchema.parse>,
): string {
  return sha256Value(
    subtitlePackage.cues.map(({ id, start, end }) => ({ id, start, end })),
  );
}

function mappedTokenHash(
  artifact: ReturnType<typeof subtitleOverlapAcousticResolutionSchema.parse>,
): string {
  return sha256Value(
    artifact.attempts.map((attempt) => ({
      attemptId: attempt.attemptId,
      mappedTokens: attempt.mappedTokens ?? [],
    })),
  );
}

function rawVadHash(
  artifact: ReturnType<typeof subtitleOverlapAcousticResolutionSchema.parse>,
): string {
  return sha256Value(
    artifact.attempts.map((attempt) => ({
      attemptId: attempt.attemptId,
      rawVadIntervals: attempt.rawVadIntervals ?? [],
    })),
  );
}

function componentSnapshot(
  artifact: ReturnType<typeof subtitleOverlapAcousticResolutionSchema.parse>,
) {
  return artifact.components.map((component) => ({
    componentId: component.componentId,
    cueIds: component.cueIds,
    unionInterval: component.unionInterval,
    extractionInterval: component.extractionInterval,
    bestHypothesis: component.bestHypothesis,
    bestHypothesisScore: component.bestHypothesisScore,
    runnerUpHypothesis: component.runnerUpHypothesis,
    runnerUpHypothesisScore: component.runnerUpHypothesisScore,
    decisionMargin: component.decisionMargin,
    finalRelationship: component.finalRelationship,
    blocking: component.blocking,
    timingMutations: component.timingMutations,
  }));
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
  const runtime = whisperRuntimeCapabilityArtifactSchema.parse(
    await readJson(path.join(subtitle, "whisper-runtime-capability.json")),
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
    path.join(taskDirectory, "c5-16-mapped-vad-replay-summary.json"),
  )) as {
    sourceReadOnly?: {
      video?: {
        before?: { sha256?: string; size?: number; mtimeMs?: number };
        after?: { sha256?: string; size?: number; mtimeMs?: number };
        verified?: boolean;
      };
      humanReviewedSubtitle?: {
        before?: { sha256?: string; size?: number; mtimeMs?: number };
        after?: { sha256?: string; size?: number; mtimeMs?: number };
        verified?: boolean;
      };
    };
  };
  const grammarReport = grammarReportSchema.parse(
    await readJson(
      path.join(taskDirectory, "skill2-compatibility", "grammar-report.json"),
    ),
  );
  return {
    subtitle,
    report,
    presentation,
    acoustic,
    integrity,
    execution,
    runtime,
    subtitlePackage,
    srt,
    vtt,
    ass,
    replaySummary,
    grammarReport,
  };
}

const freshTask = path.resolve(values.fresh);
const replayTask = path.resolve(values.replay);
const [fresh, replay, runtimeAb] = await Promise.all([
  loadRun(freshTask),
  loadRun(replayTask),
  readJson(path.resolve(values.ab)).then((value) =>
    c516StockPatchedRuntimeAbArtifactSchema.parse(value),
  ),
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
    run.presentation.canonicalCueHash === EXPECTED.canonicalCueHash &&
      run.presentation.presentationCueHash === EXPECTED.presentationCueHash &&
      canonicalTimingHash(run.subtitlePackage) === EXPECTED.canonicalTimingHash,
    `${label}: canonical or presentation baseline hash changed.`,
  );
  invariant(
    run.integrity.integrityVersion === "C5.16" &&
      run.acoustic.resolutionVersion === "C5.16",
    `${label}: C5.16 artifact version missing.`,
  );
  invariant(
    run.integrity.configuration.mode === "enforce" &&
      run.integrity.configuration.tokenTimestampPolicy === "mapped-only",
    `${label}: timestamp evidence was not enforced as mapped-only.`,
  );
  invariant(
    run.integrity.summary.mappedVadTokenCount > 0 &&
      run.integrity.summary.rawVadIntervalCount > 0 &&
      (run.integrity.summary.mappedTokenTrustedCount ?? 0) > 0,
    `${label}: mapped VAD tokens or raw VAD intervals are missing.`,
  );
  invariant(
    run.integrity.summary.untrustedTokenUsedForTimingCount === 0 &&
      run.integrity.summary.unknownCoordinateTokenUsedForTimingCount === 0 &&
      run.integrity.summary.decodedSegmentMislabelledAsRawVadCount === 0 &&
      run.integrity.summary.integrityGateFailures.length === 0,
    `${label}: timestamp integrity gate failed.`,
  );
  invariant(
    run.runtime.verified &&
      run.runtime.failures.length === 0 &&
      run.runtime.mappedGetterDeclared &&
      run.runtime.mappedGetterActuallyUsed &&
      run.runtime.rawVadGetterDeclared &&
      run.runtime.rawVadGetterActuallyUsed &&
      run.runtime.upstreamCommit === EXPECTED.upstreamCommit &&
      run.runtime.patchSha256 === EXPECTED.patchSha256 &&
      run.runtime.binarySha256 === EXPECTED.patchedBinarySha256,
    `${label}: patched runtime capability or identity is unverified.`,
  );
  invariant(
    run.acoustic.summary.componentCount === 7 &&
      run.acoustic.summary.cueCount === 16 &&
      run.acoustic.summary.profileAttemptCount === 21 &&
      run.acoustic.summary.timingMutationCount === 0 &&
      run.acoustic.summary.unresolvedCount === 7,
    `${label}: overlap safety or scope invariant failed.`,
  );
  invariant(
    run.report.status === "needs-review" &&
      run.report.finalizationMethod === "none" &&
      run.report.metrics.reviewItemCount === 7,
    `${label}: finalization status or review queue is incorrect.`,
  );
  for (const component of run.acoustic.components) {
    invariant(
      component.timingMutations.length === 0 && component.blocking,
      `${label}: unresolved component mutated timing or lost its blocker.`,
    );
    for (const alignment of component.cueAlignments) {
      invariant(
        new Set(alignment.timingEvidenceLineageIds ?? []).size ===
          (alignment.timingEvidenceLineageIds?.length ?? 0),
        `${label}: duplicate timing evidence lineage detected.`,
      );
      if (alignment.sequenceTimingUsable) {
        invariant(
          (alignment.sequenceTimingEvidenceIds?.length ?? 0) > 0 &&
            (alignment.sequenceParentSegmentIds?.length ?? 0) === 1,
          `${label}: timing-usable sequence crosses or lacks a parent segment.`,
        );
      }
    }
  }
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
        `${label}: admitted timing token is not trusted original-media-global evidence.`,
      );
    }
  }
  const readOnly = run.replaySummary.sourceReadOnly;
  invariant(
    readOnly?.video?.verified === true &&
      readOnly.video.before?.sha256 === EXPECTED.videoSha256 &&
      readOnly.video.after?.sha256 === EXPECTED.videoSha256 &&
      readOnly.video.before.size === EXPECTED.videoSize &&
      readOnly.video.after.size === EXPECTED.videoSize &&
      readOnly.video.before.mtimeMs === readOnly.video.after.mtimeMs &&
      readOnly.humanReviewedSubtitle?.verified === true &&
      readOnly.humanReviewedSubtitle.before?.sha256 ===
        EXPECTED.humanSubtitleSha256 &&
      readOnly.humanReviewedSubtitle.after?.sha256 ===
        EXPECTED.humanSubtitleSha256 &&
      readOnly.humanReviewedSubtitle.before.size ===
        EXPECTED.humanSubtitleSize &&
      readOnly.humanReviewedSubtitle.after.size ===
        EXPECTED.humanSubtitleSize &&
      readOnly.humanReviewedSubtitle.before.mtimeMs ===
        readOnly.humanReviewedSubtitle.after.mtimeMs,
    `${label}: source read-only verification failed.`,
  );
  invariant(
    run.grammarReport.summary.sentenceCount === 106 &&
      run.grammarReport.summary.grammarPointCount === 106,
    `${label}: strict Skill 2 v1 compatibility is not 106/106.`,
  );
}

invariant(
  fresh.acoustic.summary.asrRequestCount === 21 &&
    fresh.acoustic.summary.cacheHitCount === 0 &&
    fresh.execution.workerStartCount === 1 &&
    fresh.execution.modelLoadCount === 1 &&
    fresh.execution.workers.length === 1 &&
    fresh.execution.workers[0]?.warmupCount === 1 &&
    fresh.execution.fallbackProcessCount === 0,
  "Fresh run did not execute 21 requests through one worker/model/warm-up without fallback.",
);
invariant(
  replay.acoustic.summary.asrRequestCount === 0 &&
    replay.acoustic.summary.cacheHitCount === 21 &&
    replay.execution.workerStartCount === 0 &&
    replay.execution.modelLoadCount === 0 &&
    replay.execution.workers.length === 0 &&
    replay.execution.fallbackProcessCount === 0,
  "Replay did not produce 21 cache hits with zero ASR/worker/model work.",
);

const freshMappedTokenHash = mappedTokenHash(fresh.acoustic);
const replayMappedTokenHash = mappedTokenHash(replay.acoustic);
const freshRawVadHash = rawVadHash(fresh.acoustic);
const replayRawVadHash = rawVadHash(replay.acoustic);
const freshOverlapEvidenceHash = sha256Value(
  overlapAcousticEvidenceForHash(fresh.acoustic),
);
const replayOverlapEvidenceHash = sha256Value(
  overlapAcousticEvidenceForHash(replay.acoustic),
);

invariant(
  freshMappedTokenHash === replayMappedTokenHash &&
    freshRawVadHash === replayRawVadHash &&
    freshOverlapEvidenceHash === replayOverlapEvidenceHash &&
    fresh.integrity.summary.integrityHash ===
      replay.integrity.summary.integrityHash &&
    fresh.runtime.capabilityHash === replay.runtime.capabilityHash &&
    JSON.stringify(componentSnapshot(fresh.acoustic)) ===
      JSON.stringify(componentSnapshot(replay.acoustic)),
  "Fresh/cache replay semantic evidence hashes or decisions differ.",
);

invariant(
  runtimeAb.summary.accepted &&
    runtimeAb.summary.pairCount === 21 &&
    runtimeAb.summary.freshRequestCount === 42 &&
    runtimeAb.summary.textParityPassed &&
    runtimeAb.summary.segmentParityPassed &&
    runtimeAb.summary.rawTokenParityPassed &&
    runtimeAb.summary.languageParityPassed &&
    runtimeAb.summary.requestConfigurationParityPassed &&
    runtimeAb.summary.promptParityPassed &&
    runtimeAb.summary.patchedMappedTokenCount > 0 &&
    runtimeAb.summary.patchedRawVadIntervalCount > 0 &&
    runtimeAb.build.sameSource &&
    runtimeAb.build.sameBuildConfiguration &&
    runtimeAb.upstream.commit === EXPECTED.upstreamCommit &&
    runtimeAb.build.patchSha256 === EXPECTED.patchSha256 &&
    runtimeAb.build.patchedBinarySha256 === EXPECTED.patchedBinarySha256,
  "Stock/patched A/B acceptance failed.",
);

const result = {
  schemaVersion: "1.0.0",
  validationType: "C5.16 fresh/cache/A-B acceptance",
  generatedAt: new Date().toISOString(),
  freshTaskName: path.basename(freshTask),
  replayTaskName: path.basename(replayTask),
  runtimeAbArtifactName: path.basename(values.ab),
  hashes: {
    canonicalCueHash: fresh.presentation.canonicalCueHash,
    canonicalTimingHash: canonicalTimingHash(fresh.subtitlePackage),
    presentationCueHash: fresh.presentation.presentationCueHash,
    timestampIntegrityHash: fresh.integrity.summary.integrityHash,
    runtimeCapabilityHash: fresh.runtime.capabilityHash,
    mappedTokenHash: freshMappedTokenHash,
    rawVadHash: freshRawVadHash,
    overlapEvidenceHash: freshOverlapEvidenceHash,
  },
  evidence: {
    mappedVadTokenCount: fresh.integrity.summary.mappedVadTokenCount,
    mappedNoVadTokenCount: fresh.integrity.summary.mappedNoVadTokenCount,
    mappedTokenTrustedCount: fresh.integrity.summary.mappedTokenTrustedCount,
    mappedTokenQuarantinedCount:
      fresh.integrity.summary.mappedTokenQuarantinedCount,
    rawVadIntervalCount: fresh.integrity.summary.rawVadIntervalCount,
    rawVadTrustedIntervalCount:
      fresh.integrity.summary.rawVadTrustedIntervalCount,
    rawVadInvalidIntervalCount:
      fresh.integrity.summary.rawVadInvalidIntervalCount,
    untrustedTokenUsedForTimingCount:
      fresh.integrity.summary.untrustedTokenUsedForTimingCount,
    unknownCoordinateTokenUsedForTimingCount:
      fresh.integrity.summary.unknownCoordinateTokenUsedForTimingCount,
    decodedSegmentMislabelledAsRawVadCount:
      fresh.integrity.summary.decodedSegmentMislabelledAsRawVadCount,
  },
  freshExecution: {
    asrRequestCount: fresh.acoustic.summary.asrRequestCount,
    cacheHitCount: fresh.acoustic.summary.cacheHitCount,
    workerStartCount: fresh.execution.workerStartCount,
    modelLoadCount: fresh.execution.modelLoadCount,
    warmupCount: fresh.execution.workers.at(0)?.warmupCount ?? 0,
    fallbackProcessCount: fresh.execution.fallbackProcessCount,
    totalWorkerSeconds: fresh.execution.totalWorkerSeconds,
  },
  replayExecution: {
    asrRequestCount: replay.acoustic.summary.asrRequestCount,
    cacheHitCount: replay.acoustic.summary.cacheHitCount,
    workerStartCount: replay.execution.workerStartCount,
    modelLoadCount: replay.execution.modelLoadCount,
    warmupCount: 0,
    fallbackProcessCount: replay.execution.fallbackProcessCount,
    totalWorkerSeconds: replay.execution.totalWorkerSeconds,
  },
  runtimeAb: runtimeAb.summary,
  outcome: {
    status: fresh.report.status,
    finalizationMethod: fresh.report.finalizationMethod,
    unresolvedComponentCount: fresh.acoustic.summary.unresolvedCount,
    reviewItemCount: fresh.report.metrics.reviewItemCount,
    canonicalTextMutationCount:
      fresh.acoustic.summary.canonicalTextMutationCount,
    timingMutationCount: fresh.acoustic.summary.timingMutationCount,
    wholeMediaAsrRequestCount: fresh.acoustic.summary.wholeMediaAsrRequestCount,
    cueCount: fresh.subtitlePackage.cues.length,
    skill2SentenceCount: fresh.grammarReport.summary.sentenceCount,
    skill2GrammarPointCount: fresh.grammarReport.summary.grammarPointCount,
    sourceReadOnlyVerified: true,
  },
  formatParity: {
    lexical: true,
    maximumSrtVttTimingDeltaSeconds: maximumTimingDelta(fresh.srt, fresh.vtt),
    maximumSrtAssTimingDeltaSeconds: maximumTimingDelta(fresh.srt, fresh.ass),
  },
  components: componentSnapshot(fresh.acoustic),
  accepted: true,
};

if (values.output !== undefined) {
  await atomicWriteJson(path.resolve(values.output), result, {
    overwrite: false,
  });
}
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
