import { cp, mkdir, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  InputError,
  asrCacheManifestArtifactSchema,
  atomicWriteJson,
  c516StockPatchedRuntimeAbArtifactSchema,
  mvlWhisperServerResponseSchema,
  subtitleOverlapAcousticResolutionSchema,
  subtitleTimestampEvidenceIntegritySchema,
  type OverlapAcousticProfile,
  type TimestampAttemptIntegrity,
} from "@mvl/shared";
import {
  auditTimestampEvidenceAttempt,
  buildTimestampEvidenceIntegrityArtifact,
} from "@mvl/transcription-core";
import {
  auditC5161ShareableArtifacts,
  deterministicId,
  generateC5161ShareableArtifacts,
  locateSubtitlePackage,
  measureWavDurationFromBuffer,
  migrateC516AbMetricSemantics,
} from "@mvl/video-subtitler";

const { values } = parseArgs({
  options: {
    task: { type: "string" },
    output: { type: "string" },
    "stock-patched-ab": { type: "string" },
    "source-video": { type: "string" },
    "human-reviewed-subtitle": { type: "string" },
    "raw-vad-boundary-tolerance": { type: "string", default: "0.05" },
  },
  strict: true,
});

if (values.task === undefined || values["stock-patched-ab"] === undefined) {
  throw new InputError(
    "Usage: npm run replay:c5-16-1-offline-evidence -- --task <C5.16 task> --stock-patched-ab <A/B.json> [--output <new directory>] [--source-video <video>] [--human-reviewed-subtitle <ASS>]",
  );
}

const tolerance = Number(values["raw-vad-boundary-tolerance"]);
if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 0.1) {
  throw new InputError(
    "--raw-vad-boundary-tolerance must be between 0 and 0.10 seconds.",
  );
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function allocateOutput(sourceTask: string): Promise<string> {
  if (values.output !== undefined) {
    const explicit = path.resolve(values.output);
    if (await exists(explicit)) {
      throw new InputError(`Offline replay output already exists: ${explicit}`);
    }
    return explicit;
  }
  const parent = path.dirname(sourceTask);
  const preferred = `${path.basename(sourceTask)}-c5-16-1-offline-evidence`;
  for (let index = 0; index < 1000; index += 1) {
    const candidate = path.join(
      parent,
      index === 0
        ? preferred
        : `${preferred}-${String(index).padStart(2, "0")}`,
    );
    if (!(await exists(candidate))) return candidate;
  }
  throw new InputError(
    "Unable to allocate a collision-safe offline replay output.",
  );
}

async function listJsonFiles(root: string): Promise<string[]> {
  const output: string[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile() && entry.name.endsWith(".json"))
        output.push(target);
    }
  }
  await visit(root);
  return output.toSorted();
}

function profileForVadMode(value: string): OverlapAcousticProfile {
  if (value === "no-vad") return "no-vad";
  return value === "extra-sensitive-v1"
    ? "extra-sensitive-vad"
    : "current-sensitive-vad";
}

function cacheEnvelope(value: unknown): {
  audioSha256: string;
  profile: OverlapAcousticProfile;
  response: ReturnType<typeof mvlWhisperServerResponseSchema.parse>;
} | null {
  if (value === null || typeof value !== "object") return null;
  const record = value as {
    identity?: { audioContentSha256?: unknown; vadMode?: unknown };
    result?: { raw?: { mvlResponse?: unknown } };
  };
  if (
    typeof record.identity?.audioContentSha256 !== "string" ||
    typeof record.identity.vadMode !== "string" ||
    record.result?.raw?.mvlResponse === undefined
  ) {
    return null;
  }
  const response = mvlWhisperServerResponseSchema.safeParse(
    record.result.raw.mvlResponse,
  );
  if (!response.success) return null;
  return {
    audioSha256: record.identity.audioContentSha256,
    profile: profileForVadMode(record.identity.vadMode),
    response: response.data,
  };
}

const sourceTask = path.resolve(values.task);
const stockPatchedAbPath = path.resolve(values["stock-patched-ab"]);
const outputRoot = await allocateOutput(sourceTask);
await mkdir(outputRoot, { recursive: false });
const located = await locateSubtitlePackage(sourceTask);
const overlapPath = path.join(
  located.subtitleDirectory,
  "subtitle-overlap-acoustic-resolution.json",
);
const integrityPath = path.join(
  located.subtitleDirectory,
  "subtitle-timestamp-evidence-integrity.json",
);
const cacheManifestPath = path.join(
  located.subtitleDirectory,
  "overlap-asr-cache-manifest.json",
);
const [overlap, priorIntegrity, cacheManifest, legacyAb] = await Promise.all([
  readFile(overlapPath, "utf8").then((value) =>
    subtitleOverlapAcousticResolutionSchema.parse(JSON.parse(value) as unknown),
  ),
  readFile(integrityPath, "utf8").then((value) =>
    subtitleTimestampEvidenceIntegritySchema.parse(
      JSON.parse(value) as unknown,
    ),
  ),
  readFile(cacheManifestPath, "utf8").then((value) =>
    asrCacheManifestArtifactSchema.parse(JSON.parse(value) as unknown),
  ),
  readFile(stockPatchedAbPath, "utf8").then((value) =>
    c516StockPatchedRuntimeAbArtifactSchema.parse(JSON.parse(value) as unknown),
  ),
]);

if (cacheManifest.portableRoot === null) {
  throw new InputError(
    "C5.16 cache manifest does not contain a portable root.",
  );
}
const componentByAudioHash = new Map(
  overlap.components.flatMap((component) =>
    component.audioSha256 === null
      ? []
      : [[component.audioSha256, component] as const],
  ),
);
const actualDurationByComponent = new Map<
  string,
  ReturnType<typeof measureWavDurationFromBuffer>
>();
for (const component of overlap.components) {
  if (component.audioPath === null) continue;
  actualDurationByComponent.set(
    component.componentId,
    measureWavDurationFromBuffer(
      await readFile(path.join(located.subtitleDirectory, component.audioPath)),
    ),
  );
}

const audits: TimestampAttemptIntegrity[] = [];
const details: {
  componentId: string;
  attemptId: string;
  profile: OverlapAcousticProfile;
  nominalExtractionInterval: { start: number; end: number };
  nominalDurationSeconds: number;
  actualAudioDurationSeconds: number;
  durationDifferenceSeconds: number;
  intervalId: string;
  rawStart: number | null;
  rawEnd: number | null;
  normalizedStart: number | null;
  normalizedEnd: number | null;
  normalizationApplied: boolean;
  normalizationDeltaStart: number;
  normalizationDeltaEnd: number;
  normalizationReason: string | null;
  healthStatus: string;
  timingTrustScore: number;
  timingUsable: boolean;
}[] = [];

for (const cachePath of await listJsonFiles(cacheManifest.portableRoot)) {
  const envelope = cacheEnvelope(
    JSON.parse(await readFile(cachePath, "utf8")) as unknown,
  );
  if (envelope === null) continue;
  const component = componentByAudioHash.get(envelope.audioSha256);
  if (component === undefined) continue;
  const attempt = overlap.attempts.find(
    (item) =>
      item.componentId === component.componentId &&
      item.profile === envelope.profile,
  );
  if (attempt === undefined) {
    throw new InputError(
      `Missing overlap attempt for ${component.componentId}:${envelope.profile}.`,
    );
  }
  const measurement = actualDurationByComponent.get(component.componentId);
  if (measurement === undefined) {
    throw new InputError(`Missing measured WAV for ${component.componentId}.`);
  }
  const rawSegments = envelope.response.transcription.flatMap(
    (segment, segmentIndex) => {
      if (segment.endSeconds <= segment.startSeconds) return [];
      const segmentId = deterministicId("overlap-segment", {
        requestId: attempt.requestId,
        segmentIndex,
        start: segment.startSeconds,
        end: segment.endSeconds,
        text: segment.text,
      });
      return [
        {
          segmentId,
          text: segment.text,
          rawStart: segment.startSeconds,
          rawEnd: segment.endSeconds,
          confidence: null,
          tokens: segment.words.flatMap((word, tokenIndex) => {
            if (
              word.rawStartCentiseconds === null ||
              word.rawEndCentiseconds === null ||
              word.mappedStartCentiseconds === null ||
              word.mappedEndCentiseconds === null
            ) {
              return [];
            }
            const rawStart = word.rawStartCentiseconds * 0.01;
            const rawEnd = word.rawEndCentiseconds * 0.01;
            return [
              {
                tokenId: deterministicId("overlap-token", {
                  requestId: attempt.requestId,
                  segmentIndex,
                  tokenIndex,
                  start: rawStart,
                  end: rawEnd,
                  text: word.word,
                }),
                text: word.word,
                rawStart,
                rawEnd,
                probability: word.probability,
                rawCoordinateSystem: envelope.response.request.vad
                  ? ("vad-processed-local" as const)
                  : ("original-audio-local" as const),
                officialMappedStart: word.mappedStartCentiseconds * 0.01,
                officialMappedEnd: word.mappedEndCentiseconds * 0.01,
              },
            ];
          }),
        },
      ];
    },
  );
  const audited = auditTimestampEvidenceAttempt({
    attemptId: attempt.attemptId,
    profile: envelope.profile,
    useVad: envelope.response.request.vad,
    extractionInterval: component.extractionInterval,
    segments: rawSegments,
    rawVadIntervals: envelope.response.vad_segments.map((interval) => ({
      intervalId: deterministicId("raw-vad", {
        requestId: attempt.requestId,
        index: interval.index,
        start: interval.startSeconds,
        end: interval.endSeconds,
      }),
      start: interval.startSeconds,
      end: interval.endSeconds,
      coordinateSystem: "original-audio-local" as const,
    })),
    tokenTimestampsRequested: true,
    tokenTimestampPolicy: "mapped-only",
    mappedTokenGetterActuallyUsed:
      envelope.response.runtime.capabilities.mapped_token_getter_used,
    actualAudioDurationSeconds: measurement.durationSeconds,
    durationMeasurementMethod:
      "wav-frame-count/sample-rate;ffprobe-crosscheck-source-run",
    configuration: {
      rawVadBoundaryNormalizationToleranceSeconds: tolerance,
    },
  });
  audits.push(audited.integrity);
  for (const evaluation of audited.integrity.rawVadEvaluations ?? []) {
    details.push({
      componentId: component.componentId,
      attemptId: attempt.attemptId,
      profile: envelope.profile,
      nominalExtractionInterval: component.extractionInterval,
      nominalDurationSeconds:
        component.extractionInterval.end - component.extractionInterval.start,
      actualAudioDurationSeconds: measurement.durationSeconds,
      durationDifferenceSeconds:
        measurement.durationSeconds -
        (component.extractionInterval.end - component.extractionInterval.start),
      intervalId: evaluation.intervalId,
      rawStart: evaluation.rawStart,
      rawEnd: evaluation.rawEnd,
      normalizedStart: evaluation.normalizedStart,
      normalizedEnd: evaluation.normalizedEnd,
      normalizationApplied: evaluation.normalizationApplied,
      normalizationDeltaStart: evaluation.normalizationDeltaStart,
      normalizationDeltaEnd: evaluation.normalizationDeltaEnd,
      normalizationReason: evaluation.normalizationReason,
      healthStatus: evaluation.healthStatus,
      timingTrustScore: evaluation.timingTrustScore,
      timingUsable: evaluation.timingUsable,
    });
  }
}

audits.sort((left, right) => left.attemptId.localeCompare(right.attemptId));
details.sort((left, right) =>
  `${left.componentId}:${left.profile}:${left.rawStart ?? -1}`.localeCompare(
    `${right.componentId}:${right.profile}:${right.rawStart ?? -1}`,
  ),
);
if (audits.length !== overlap.attempts.length) {
  throw new InputError(
    `Offline replay matched ${String(audits.length)} attempts; expected ${String(overlap.attempts.length)}.`,
  );
}

const rawVadSummary = {
  total: details.length,
  fullyTrusted: details.filter((item) => item.healthStatus === "trusted")
    .length,
  boundaryNormalized: details.filter(
    (item) => item.healthStatus === "trusted-with-boundary-normalization",
  ).length,
  invalid: details.filter((item) => !item.timingUsable).length,
  maximumNormalizationDeltaSeconds: Math.max(
    0,
    ...details.map((item) =>
      Math.max(item.normalizationDeltaStart, item.normalizationDeltaEnd),
    ),
  ),
};
const integrity = buildTimestampEvidenceIntegrityArtifact({
  sourceOverlapArtifactHash: priorIntegrity.sourceOverlapArtifactHash,
  runtimeCapability: priorIntegrity.runtimeCapability,
  mode: priorIntegrity.configuration.mode,
  tokenTimestampPolicy: priorIntegrity.configuration.tokenTimestampPolicy,
  legacyOverlapCachePolicy:
    priorIntegrity.configuration.legacyOverlapCachePolicy,
  attempts: audits,
  configuration: {
    auditContainmentToleranceSeconds:
      priorIntegrity.configuration.auditContainmentToleranceSeconds,
    trustContainmentToleranceSeconds:
      priorIntegrity.configuration.trustContainmentToleranceSeconds,
    hardMaximumTokenSegmentDriftSeconds:
      priorIntegrity.configuration.hardMaximumTokenSegmentDriftSeconds,
    maximumZeroDurationLexicalTokenRatio:
      priorIntegrity.configuration.maximumZeroDurationLexicalTokenRatio,
    maximumBoundaryClampedLexicalTokenRatio:
      priorIntegrity.configuration.maximumBoundaryClampedLexicalTokenRatio,
    minimumUsableLexicalTokenRatio:
      priorIntegrity.configuration.minimumUsableLexicalTokenRatio,
    minimumDecisionMargin: priorIntegrity.configuration.minimumDecisionMargin,
    timestampMappingVersion:
      priorIntegrity.configuration.timestampMappingVersion,
    tokenHealthPolicyVersion:
      priorIntegrity.configuration.tokenHealthPolicyVersion,
    rawVadBoundaryNormalizationToleranceSeconds: tolerance,
  },
  rawVadIntervalCount: details.length,
});
const preservedIntegrity = subtitleTimestampEvidenceIntegritySchema.parse({
  ...integrity,
  summary: {
    ...integrity.summary,
    trustedTokenUsedForTimingCount:
      priorIntegrity.summary.trustedTokenUsedForTimingCount,
  },
});
const migratedAb = migrateC516AbMetricSemantics(legacyAb);

const localArtifacts = path.join(outputRoot, "local-artifacts");
await mkdir(localArtifacts);
for (const name of [
  "subtitle-finalization-report.json",
  "subtitle-presentation-resolution.json",
  "subtitle-overlap-acoustic-resolution.json",
  "whisper-runtime-capability.json",
] as const) {
  await cp(
    path.join(located.subtitleDirectory, name),
    path.join(localArtifacts, name),
    {
      errorOnExist: true,
      force: false,
    },
  );
}
await atomicWriteJson(
  path.join(localArtifacts, "subtitle-timestamp-evidence-integrity.json"),
  preservedIntegrity,
  { overwrite: false },
);
const migratedAbPath = path.join(
  outputRoot,
  "c5-16-stock-patched-runtime-ab.migrated.json",
);
await atomicWriteJson(migratedAbPath, migratedAb, { overwrite: false });
const offlineEvidencePath = path.join(
  outputRoot,
  "c5-16-1-offline-evidence-replay.json",
);
await atomicWriteJson(
  offlineEvidencePath,
  {
    schemaVersion: "1.0.0",
    artifactType: "c5-16-1-offline-evidence-replay",
    generatedAt: new Date().toISOString(),
    pathPolicy: "local-only",
    shareable: false,
    sourceTask,
    cacheRoot: cacheManifest.portableRoot,
    configuration: {
      rawVadBoundaryNormalizationToleranceSeconds: tolerance,
      rawVadBoundaryPolicyVersion: "c5.16.1-vad-boundary-normalization-v1",
    },
    execution: {
      asrRequestCount: 0,
      workerStartCount: 0,
      modelLoadCount: 0,
      cacheEvidenceEntryCount: audits.length,
      wholeMediaAsrRequestCount: 0,
      networkAccessed: false,
      openAIApiCalled: false,
    },
    rawVad: { ...rawVadSummary, details },
    abMetricMigration: {
      groupedWordParityPassed: migratedAb.summary.rawGroupedWordParityPassed,
      groupedWordComparablePairCount:
        migratedAb.summary.rawGroupedWordComparablePairCount,
      individualRawTokenParityStatus:
        migratedAb.summary.individualRawTokenParityStatus,
      individualRawTokenComparablePairCount:
        migratedAb.summary.individualRawTokenComparablePairCount,
      individualRawTokenParityPassed:
        migratedAb.summary.individualRawTokenParityPassed,
    },
    outcome: {
      status: "needs-review",
      finalizationMethod: "none",
      canonicalTextMutationCount: 0,
      canonicalTimingMutationCount: 0,
      rawVad: rawVadSummary,
    },
  },
  { overwrite: false },
);

const externalFiles = [];
if (values["source-video"] !== undefined) {
  externalFiles.push({
    role: "source-video",
    filePath: path.resolve(values["source-video"]),
  });
}
if (values["human-reviewed-subtitle"] !== undefined) {
  externalFiles.push({
    role: "human-reviewed-subtitle",
    filePath: path.resolve(values["human-reviewed-subtitle"]),
  });
}
const shareable = await generateC5161ShareableArtifacts({
  taskRoot: outputRoot,
  subtitleDirectory: localArtifacts,
  localExecutionSummaryPath: offlineEvidencePath,
  stockPatchedRuntimeAbPath: stockPatchedAbPath,
  externalFiles,
});
const audit = await auditC5161ShareableArtifacts(shareable.outputDirectory);
if (!audit.validationPassed) {
  throw new InputError("Offline replay shareable artifact audit failed.");
}

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      outputRoot,
      offlineEvidencePath,
      integrityPath: path.join(
        localArtifacts,
        "subtitle-timestamp-evidence-integrity.json",
      ),
      migratedAbPath,
      rawVad: rawVadSummary,
      shareableDirectory: shareable.outputDirectory,
      shareableArtifactCount: shareable.manifest.summary.artifactCount,
      shareableAbsolutePathLeakCount: audit.absolutePathLeakCount,
      shareableProhibitedSecretCount: audit.prohibitedSecretCount,
    },
    null,
    2,
  )}\n`,
);
