import { createHash, randomUUID } from "node:crypto";
import { cp, mkdtemp, readFile, rename, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  InputError,
  atomicWriteJson,
  c519MemoryReplaySummarySchema,
  correctionFeedbackSchema,
  ctcRuntimeCapabilitySchema,
  episodeIdentitySchema,
  memoryAssistedCtcObservationSchema,
  subtitleCanonicalAlignmentInputSchema,
  subtitleCanonicalPronunciationSchema,
  subtitleCtcAlignmentInputSchema,
  subtitleFinalizationReportSchema,
  subtitleLocalCtcBoundaryEvidenceSchema,
  subtitleLocalSeparatedStreamEvidenceSchema,
  subtitleLocalSpeakerEvidenceSchema,
  subtitlePackageSchema,
  subtitlePresentationResolutionSchema,
  subtitleReviewDeliveryIntegritySchema,
  subtitleReviewPackageSchema,
  type CtcTargetEncoding,
  type MemoryAssistedCtcObservation,
  type SubtitleMemoryPronunciationProjection,
  type SubtitleReviewPackage,
} from "@mvl/shared";
import {
  buildMemoryAssistedCtcTargetAudit,
  buildSeriesIdentity,
  mergeSeriesLanguageMemory,
  promoteEpisodeLanguageObservations,
  stableMemoryHash,
  type MemoryAssociationClass,
  type MemoryRankingPoolInput,
} from "@mvl/transcription-core";
import {
  LocalCtcWorker,
  attachSeriesMemoryReviewContext,
  atomicWriteSeriesLanguageMemory,
  auditC5161ShareableArtifacts,
  cropReviewWavFrames,
  generateC5161ShareableArtifacts,
  inspectReviewWav,
  loadAndVerifyCtcRuntime,
  locateSubtitlePackage,
  normalizeCtcAlignmentText,
  readSeriesLanguageMemory,
  runSeriesMemoryWorkflow,
  sha256LocalFile,
  writeReviewDeliveryIntegrity,
  writeSubtitleReviewPage,
} from "@mvl/video-subtitler";

const EXPECTED_BASE_CUE_HASH =
  "8ec01ef362387aa4a4b61cb7c7cb3d2d4f4932f38aff3a4b5695deedfa1ccc83";
const EXPECTED_TIMING_HASH =
  "510c3f20b82ecd263cd2234057536eaddda0dc94efac599ffe72aa3fc843ec02";
const EXPECTED_PRESENTATION_HASH =
  "9e1371375397df403bf2647cc805b8c70d6c2628eca1eb4f94dca32cc7eed4de";

const { values } = parseArgs({
  options: {
    task: { type: "string" },
    output: { type: "string" },
    "memory-mode": { type: "string" },
    "memory-input": { type: "string" },
    "memory-output": { type: "string" },
    "series-memory-store": { type: "string" },
    "memory-ranking": { type: "string" },
    "memory-pronunciation-projection": { type: "string" },
    "memory-ctc-observe": { type: "string" },
    "memory-ctc-observation-input": { type: "string" },
    "causal-memory": { type: "string" },
    "start-empty-memory": { type: "string" },
    "ctc-runtime-manifest": { type: "string" },
    "ctc-model-manifest": { type: "string" },
  },
  strict: true,
});

if (values.task === undefined || values.output === undefined) {
  throw new InputError(
    "Usage: replay:c5-19-series-memory -- --task <task> --output <output> --memory-mode <off|observe|learn>",
  );
}
const memoryMode = values["memory-mode"] ?? "observe";
const memoryRankingMode = values["memory-ranking"] ?? "observe";
const projectionMode = values["memory-pronunciation-projection"] ?? "observe";
const ctcObserveMode = values["memory-ctc-observe"] ?? "off";
if (!(["off", "observe", "learn"] as const).includes(memoryMode as never)) {
  throw new InputError("--memory-mode must be off, observe, or learn.");
}
if (!(["off", "observe"] as const).includes(memoryRankingMode as never)) {
  throw new InputError("C5.19 memory ranking supports off or observe only.");
}
if (!(["off", "observe"] as const).includes(projectionMode as never)) {
  throw new InputError(
    "C5.19 pronunciation projection supports off or observe only.",
  );
}
if (!(["off", "targeted"] as const).includes(ctcObserveMode as never)) {
  throw new InputError("C5.19 CTC observe supports off or targeted only.");
}

const sourceTask = path.resolve(values.task);
const outputTask = path.resolve(values.output);
const runKind =
  values["causal-memory"] === "true"
    ? ("causal" as const)
    : values["memory-input"] !== undefined
      ? ("frozen" as const)
      : ("bootstrap" as const);
if (runKind === "causal" && values["start-empty-memory"] !== "true") {
  throw new InputError("Causal replay requires --start-empty-memory true.");
}
if (runKind === "frozen" && memoryMode === "learn") {
  throw new InputError(
    "Frozen replay is read-only and cannot use --memory-mode learn.",
  );
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function clampScore(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : 0;
}

function overlapRatio(
  left: { start: number; end: number } | null,
  right: { start: number; end: number },
): number {
  if (left === null) return 0;
  const intersection = Math.max(
    0,
    Math.min(left.end, right.end) - Math.max(left.start, right.start),
  );
  return intersection / Math.max(0.001, left.end - left.start);
}

function rankingPoolsFromUnknown(value: unknown): MemoryRankingPoolInput[] {
  if (value === null || typeof value !== "object") return [];
  const items = (value as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  return items.flatMap((rawItem): MemoryRankingPoolInput[] => {
    if (rawItem === null || typeof rawItem !== "object") return [];
    const item = rawItem as Record<string, unknown>;
    if (
      typeof item.reviewItemId !== "string" ||
      !Array.isArray(item.candidates)
    ) {
      return [];
    }
    const window = {
      start: typeof item.windowStart === "number" ? item.windowStart : 0,
      end: typeof item.windowEnd === "number" ? item.windowEnd : 0,
    };
    const candidates = item.candidates.flatMap(
      (raw): MemoryRankingPoolInput["candidates"] => {
        if (raw === null || typeof raw !== "object") return [];
        const candidate = raw as Record<string, unknown>;
        if (
          typeof candidate.candidateId !== "string" ||
          typeof candidate.text !== "string" ||
          candidate.text.trim() === ""
        ) {
          return [];
        }
        const sourceInterval =
          candidate.sourceInterval !== null &&
          typeof candidate.sourceInterval === "object"
            ? (candidate.sourceInterval as { start: number; end: number })
            : null;
        const localized = overlapRatio(sourceInterval, window);
        const blocked =
          Array.isArray(candidate.hardBlockReasons) &&
          candidate.hardBlockReasons.length > 0;
        const lexical = candidate.lexicalTextOptionEligible === true;
        const associationClass: MemoryAssociationClass = blocked
          ? "UNASSOCIATED"
          : lexical && localized >= 0.8
            ? "EXACT_TARGET"
            : lexical && localized >= 0.5
              ? "PROBABLE_TARGET"
              : localized > 0
                ? "BROAD_WINDOW"
                : "UNASSOCIATED";
        return [
          {
            candidateId: candidate.candidateId,
            text: candidate.text,
            associationClass,
            baseScore: clampScore(
              candidate.textCandidateScore ??
                candidate.reviewLocalScore ??
                candidate.sourceSelectionScore,
            ),
          },
        ];
      },
    );
    const context = Array.isArray(item.currentFinalCueContext)
      ? (item.currentFinalCueContext as { text?: unknown }[])
      : [];
    const expectedText = context
      .map((cue) => (typeof cue.text === "string" ? cue.text : ""))
      .filter(Boolean)
      .join("\n");
    return [
      {
        cueId: item.reviewItemId,
        cueStart: window.start,
        candidates,
        expectedText: expectedText || null,
      },
    ];
  });
}

function offlineCtcEncoding(input: {
  text: string;
  vocabulary: Readonly<Record<string, number>>;
}): CtcTargetEncoding {
  const normalized = normalizeCtcAlignmentText(input.text).text;
  const specials = new Set(["<unk>", "<pad>", "<s>", "</s>", "|"]);
  const tokens = Object.keys(input.vocabulary)
    .filter((token) => !specials.has(token) && token.length > 0)
    .toSorted(
      (left, right) => right.length - left.length || left.localeCompare(right),
    );
  const tokenIds: number[] = [];
  const tokenPieces: string[] = [];
  let unknownTokenCount = 0;
  let index = 0;
  while (index < normalized.length) {
    const token = tokens.find((candidate) =>
      normalized.startsWith(candidate, index),
    );
    if (token === undefined) {
      tokenIds.push(input.vocabulary["<unk>"] ?? 0);
      tokenPieces.push("<unk>");
      unknownTokenCount += 1;
      index += (normalized.codePointAt(index) ?? 0) > 0xffff ? 2 : 1;
      continue;
    }
    tokenIds.push(input.vocabulary[token] ?? 0);
    tokenPieces.push(token);
    index += token.length;
  }
  return {
    targetText: normalized,
    targetTextSha256: sha256Text(normalized),
    tokenIds,
    tokenPieces,
    unknownTokenCount,
    specialTokenCount: unknownTokenCount,
    targetEncodable: unknownTokenCount === 0,
    blockers: unknownTokenCount === 0 ? [] : ["CTC_TARGET_UNREPRESENTABLE"],
  };
}

async function targetedCtcObservation(input: {
  subtitleDirectory: string;
  reviewPackage: SubtitleReviewPackage;
  projection: SubtitleMemoryPronunciationProjection;
  runtimeManifestPath: string;
  modelManifestPath: string;
  capabilityPath: string;
  temporaryDirectory: string;
  projectedEncodings: Map<string, CtcTargetEncoding>;
  enabled: boolean;
  generatedAt: string;
}): Promise<MemoryAssistedCtcObservation> {
  const capability = ctcRuntimeCapabilitySchema.parse(
    JSON.parse(await readFile(input.capabilityPath, "utf8")) as unknown,
  );
  if (!input.enabled) {
    const base = {
      schemaVersion: "1.0.0" as const,
      artifactType: "memory-assisted-ctc-observation" as const,
      observationVersion: "C5.19" as const,
      generatedAt: input.generatedAt,
      mode: "off" as const,
      runtimeAvailable: true,
      ctcRuntimeIdentityHash: capability.runtimeIdentityHash,
      ctcModelSnapshotHash: capability.modelSnapshotHash,
      deviceUsed: capability.deviceUsed,
      attempts: [],
      summary: {
        requestCount: 0,
        inferenceCount: 0,
        cacheHitCount: 0,
        pathSuccessCount: 0,
        memoryAssistedCtcTimingMutationCount: 0 as const,
        networkUsed: false as const,
      },
    };
    return memoryAssistedCtcObservationSchema.parse({
      ...base,
      semanticHash: stableMemoryHash({ ...base, generatedAt: null }),
    });
  }
  const verified = await loadAndVerifyCtcRuntime({
    runtimeManifestPath: input.runtimeManifestPath,
    modelManifestPath: input.modelManifestPath,
  });
  if (
    verified.runtime.runtimeIdentityHash !== capability.runtimeIdentityHash ||
    verified.model.modelSnapshotHash !== capability.modelSnapshotHash
  ) {
    throw new InputError(
      "Targeted CTC runtime identity differs from C5.18.1 acceptance.",
    );
  }
  const targetCues = input.projection.cues.filter((cue) =>
    cue.spans.some((span) => span.canonicalSurface === "水茄子"),
  );
  if (targetCues.length !== 2) {
    throw new InputError(
      `Expected exactly two 水茄子 projection cues; found ${targetCues.length}.`,
    );
  }
  const worker = new LocalCtcWorker({
    ...verified,
    device: capability.deviceUsed,
    workerScriptPath: path.resolve("scripts/runtime/ctc_worker.py"),
  });
  const attempts: MemoryAssistedCtcObservation["attempts"] = [];
  try {
    const ready = await worker.start();
    if (ready.deviceUsed !== capability.deviceUsed) {
      throw new InputError("Targeted CTC worker changed the verified device.");
    }
    for (const projection of targetCues) {
      const item = input.reviewPackage.items.find((value) =>
        value.targetCueIds.includes(projection.cueId),
      );
      if (item === undefined) {
        throw new InputError(
          `Targeted CTC review item missing for ${projection.cueId}.`,
        );
      }
      if (
        item.audioClipPath === null ||
        item.audioExtractedInterval === null ||
        item.audioSha256 === null
      ) {
        throw new InputError(
          `Targeted CTC review audio missing for ${projection.cueId}.`,
        );
      }
      const reviewAudioPath = path.resolve(
        input.subtitleDirectory,
        "review",
        item.audioClipPath,
      );
      const relative = path.relative(
        path.dirname(input.subtitleDirectory),
        reviewAudioPath,
      );
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new InputError("Targeted CTC audio escapes the task root.");
      }
      const reviewAudio = await readFile(reviewAudioPath);
      const binaryHash = createHash("sha256").update(reviewAudio).digest("hex");
      if (binaryHash !== item.audioSha256) {
        throw new InputError(
          `Review WAV hash mismatch for ${projection.cueId}.`,
        );
      }
      const metadata = inspectReviewWav(reviewAudio);
      const forcedCue = item.forcedAlignmentEvidence?.cues.find(
        (cue) => cue.cueId === projection.cueId,
      );
      const interval = forcedCue?.originalTiming ?? item.interval;
      for (const windowType of ["narrow", "expanded"] as const) {
        const localStart =
          windowType === "expanded"
            ? 0
            : Math.max(
                0,
                interval.start - 0.5 - item.audioExtractedInterval.start,
              );
        const localEnd =
          windowType === "expanded"
            ? metadata.actualDurationSeconds
            : Math.min(
                metadata.actualDurationSeconds,
                interval.end + 0.5 - item.audioExtractedInterval.start,
              );
        if (localEnd <= localStart) {
          throw new InputError(`Invalid targeted ${windowType} CTC window.`);
        }
        let audioPath = reviewAudioPath;
        let audioSha256 = binaryHash;
        if (windowType === "narrow") {
          audioPath = path.join(
            input.temporaryDirectory,
            `${projection.cueId}-memory-${windowType}.wav`,
          );
          const cropped = await cropReviewWavFrames({
            sourcePath: reviewAudioPath,
            targetPath: audioPath,
            startSeconds: localStart,
            endSeconds: localEnd,
          });
          audioSha256 = cropped.sha256;
        }
        const attempt = await worker.align({
          attemptId: `memory-ctc-${stableMemoryHash({
            cueId: projection.cueId,
            windowType,
            target: projection.projectedAlignmentText,
            audioSha256,
          }).slice(0, 20)}`,
          cueId: projection.cueId,
          componentId:
            item.ctcBoundaryEvidenceComponentId ??
            `memory-component-${item.reviewId}`,
          windowType,
          audioPath,
          audioSha256,
          audioLocalInterval: { start: localStart, end: localEnd },
          mediaGlobalInterval: {
            start: item.audioExtractedInterval.start + localStart,
            end: item.audioExtractedInterval.start + localEnd,
          },
          targetText: normalizeCtcAlignmentText(
            projection.projectedAlignmentText,
          ).text,
        });
        input.projectedEncodings.set(projection.cueId, attempt.target);
        attempts.push({
          cueId: projection.cueId,
          windowType,
          projectedTargetHash: attempt.target.targetTextSha256,
          pathStatus: attempt.pathStatus,
          targetEncodable: attempt.target.targetEncodable,
          cacheHit: false,
          inferenceExecuted: true,
          timingMutationApplied: false,
        });
      }
    }
  } finally {
    await worker.close();
  }
  if (attempts.length > 4)
    throw new InputError("C5.19 targeted CTC hard limit exceeded.");
  const base = {
    schemaVersion: "1.0.0" as const,
    artifactType: "memory-assisted-ctc-observation" as const,
    observationVersion: "C5.19" as const,
    generatedAt: input.generatedAt,
    mode: "targeted-observe-only" as const,
    runtimeAvailable: true,
    ctcRuntimeIdentityHash: capability.runtimeIdentityHash,
    ctcModelSnapshotHash: capability.modelSnapshotHash,
    deviceUsed: capability.deviceUsed,
    attempts,
    summary: {
      requestCount: attempts.length,
      inferenceCount: attempts.filter((value) => value.inferenceExecuted)
        .length,
      cacheHitCount: 0,
      pathSuccessCount: attempts.filter(
        (value) => value.pathStatus === "success",
      ).length,
      memoryAssistedCtcTimingMutationCount: 0 as const,
      networkUsed: false as const,
    },
  };
  return memoryAssistedCtcObservationSchema.parse({
    ...base,
    semanticHash: stableMemoryHash({ ...base, generatedAt: null }),
  });
}

async function readVerifiedTargetedCtcObservation(input: {
  filePath: string;
  projection: SubtitleMemoryPronunciationProjection;
}): Promise<MemoryAssistedCtcObservation> {
  const observation = memoryAssistedCtcObservationSchema.parse(
    JSON.parse(await readFile(path.resolve(input.filePath), "utf8")) as unknown,
  );
  const targetCues = input.projection.cues.filter((cue) =>
    cue.spans.some((span) => span.canonicalSurface === "水茄子"),
  );
  const expected = new Map(
    targetCues.map((cue) => [
      cue.cueId,
      sha256Text(normalizeCtcAlignmentText(cue.projectedAlignmentText).text),
    ]),
  );
  if (
    observation.mode !== "targeted-observe-only" ||
    observation.attempts.length !== 4 ||
    observation.summary.requestCount !== 4 ||
    observation.summary.inferenceCount !== 4 ||
    observation.summary.pathSuccessCount !== 4 ||
    targetCues.length !== 2
  ) {
    throw new InputError(
      "Imported C5.19 targeted CTC observation is incomplete.",
    );
  }
  for (const cue of targetCues) {
    const attempts = observation.attempts.filter(
      (attempt) => attempt.cueId === cue.cueId,
    );
    if (
      attempts.length !== 2 ||
      !attempts.some((attempt) => attempt.windowType === "narrow") ||
      !attempts.some((attempt) => attempt.windowType === "expanded") ||
      attempts.some(
        (attempt) =>
          attempt.projectedTargetHash !== expected.get(cue.cueId) ||
          !attempt.targetEncodable ||
          !attempt.inferenceExecuted ||
          attempt.cacheHit,
      )
    ) {
      throw new InputError(
        `Imported targeted CTC observation does not match ${cue.cueId}.`,
      );
    }
  }
  return observation;
}

const stagingTask = `${outputTask}.partial-${randomUUID()}`;
const generatedAt = new Date().toISOString();
const temporaryDirectory = await mkdtemp(
  path.join(tmpdir(), "mvl-c5-19-memory-"),
);
let completed = false;
try {
  try {
    await stat(outputTask);
    throw new InputError(`Replay output already exists: ${outputTask}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await cp(sourceTask, stagingTask, {
    recursive: true,
    force: false,
    errorOnExist: true,
    preserveTimestamps: true,
  });
  await rm(path.join(stagingTask, "shareable"), {
    recursive: true,
    force: true,
  });
  const located = await locateSubtitlePackage(stagingTask);
  const subtitleDirectory = located.subtitleDirectory;
  const sourceLocated = await locateSubtitlePackage(sourceTask);
  const packagePath = path.join(
    subtitleDirectory,
    "subtitle-package.human-reviewed-base.json",
  );
  const alignmentPath = path.join(
    subtitleDirectory,
    "subtitle-canonical-alignment-input.json",
  );
  const pronunciationPath = path.join(
    subtitleDirectory,
    "subtitle-canonical-pronunciation.json",
  );
  const ctcInputPath = path.join(
    subtitleDirectory,
    "subtitle-ctc-alignment-input.json",
  );
  const reviewPath = path.join(
    subtitleDirectory,
    "subtitle-review-package.json",
  );
  const finalizationPath = path.join(
    subtitleDirectory,
    "subtitle-finalization-report.json",
  );
  const presentationPath = path.join(
    subtitleDirectory,
    "subtitle-presentation-resolution.json",
  );
  const correctionFeedbackPath = path.join(
    subtitleDirectory,
    "correction-feedback.json",
  );
  const packageValue = subtitlePackageSchema.parse(
    JSON.parse(await readFile(packagePath, "utf8")) as unknown,
  );
  const alignment = subtitleCanonicalAlignmentInputSchema.parse(
    JSON.parse(await readFile(alignmentPath, "utf8")) as unknown,
  );
  const pronunciation = subtitleCanonicalPronunciationSchema.parse(
    JSON.parse(await readFile(pronunciationPath, "utf8")) as unknown,
  );
  const ctcInput = subtitleCtcAlignmentInputSchema.parse(
    JSON.parse(await readFile(ctcInputPath, "utf8")) as unknown,
  );
  const sourceReviewPackage = subtitleReviewPackageSchema.parse(
    JSON.parse(await readFile(reviewPath, "utf8")) as unknown,
  );
  const presentation = subtitlePresentationResolutionSchema.parse(
    JSON.parse(await readFile(presentationPath, "utf8")) as unknown,
  );
  let correctionFeedback = null;
  let correctionFeedbackHash: string | null = null;
  try {
    correctionFeedback = correctionFeedbackSchema.parse(
      JSON.parse(await readFile(correctionFeedbackPath, "utf8")) as unknown,
    );
    correctionFeedbackHash = await sha256LocalFile(correctionFeedbackPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (
    packageValue.cues.length !== 192 ||
    sourceReviewPackage.items.length !== 7 ||
    presentation.canonicalCueHash !== EXPECTED_BASE_CUE_HASH ||
    presentation.presentationCueHash !== EXPECTED_PRESENTATION_HASH ||
    alignment.baseCueHash !== EXPECTED_BASE_CUE_HASH ||
    alignment.baseTimingHash !== EXPECTED_TIMING_HASH
  ) {
    throw new InputError(
      "C5.19 input is not the accepted C5.18.1 Fresh v4 baseline.",
    );
  }
  const seriesIdentity = buildSeriesIdentity({
    title: packageValue.identity.title,
    year: packageValue.identity.year,
    season: packageValue.identity.season,
    episode: packageValue.identity.episode,
    mediaType: "series",
    explicitSeriesVerification: true,
  });
  if (
    seriesIdentity.identityStatus !== "verified" ||
    seriesIdentity.memoryScope !== "series"
  ) {
    throw new InputError("Explicit C5.19 Series Identity verification failed.");
  }
  const sourceFingerprintHash = stableMemoryHash(
    sourceReviewPackage.sourceFingerprint,
  );
  const episodeIdentity = episodeIdentitySchema.parse({
    episodeId: `episode-${stableMemoryHash({
      seriesKey: seriesIdentity.seriesKey,
      episode: packageValue.identity.episode,
      sourceFingerprintHash,
    }).slice(0, 24)}`,
    seriesKey: seriesIdentity.seriesKey,
    episodeNumber: packageValue.identity.episode,
    sourceFingerprintHash,
  });
  const sourceArtifactHashes = {
    canonical: await sha256LocalFile(packagePath),
    alignment: await sha256LocalFile(alignmentPath),
    pronunciation: await sha256LocalFile(pronunciationPath),
    review: await sha256LocalFile(reviewPath),
    ...(correctionFeedbackHash === null
      ? {}
      : { correction: correctionFeedbackHash }),
  };
  const queuePath = path.join(
    subtitleDirectory,
    "mandatory-lexical-speech-review-queue.json",
  );
  const rankingPools =
    memoryRankingMode === "off"
      ? []
      : rankingPoolsFromUnknown(
          JSON.parse(await readFile(queuePath, "utf8")) as unknown,
        );
  const memoryInput =
    values["memory-input"] === undefined
      ? null
      : await readSeriesLanguageMemory(path.resolve(values["memory-input"]));
  if (
    memoryInput !== null &&
    memoryInput.seriesIdentity.seriesKey !== seriesIdentity.seriesKey
  ) {
    throw new InputError("Frozen input memory belongs to a different Series.");
  }
  const workflow = runSeriesMemoryWorkflow({
    runKind,
    memoryMode: memoryMode as "off" | "observe" | "learn",
    pronunciationProjectionEnabled: projectionMode === "observe",
    cues: packageValue.cues,
    alignment,
    pronunciation,
    seriesIdentity,
    episodeIdentity,
    sourceArtifactHashes,
    baseCueHash: EXPECTED_BASE_CUE_HASH,
    rankingPools,
    memoryInput,
    generatedAt,
    correctionFeedback,
  });
  if (memoryMode === "off" && workflow.memory.entries.length > 0) {
    throw new InputError(
      "--memory-mode off cannot materialize learned entries.",
    );
  }

  const runtimeRoot = path.join(
    homedir(),
    ".cache",
    "mvl",
    "ctc-runtime",
    "c5181-bbcbea8d5a11af2e",
    "manifests",
  );
  const runtimeManifestPath = path.resolve(
    values["ctc-runtime-manifest"] ??
      path.join(runtimeRoot, "ctc-runtime-manifest.json"),
  );
  const modelManifestPath = path.resolve(
    values["ctc-model-manifest"] ??
      path.join(runtimeRoot, "ctc-model-manifest.json"),
  );
  const modelManifest = JSON.parse(
    await readFile(modelManifestPath, "utf8"),
  ) as {
    snapshotDirectory?: unknown;
  };
  if (typeof modelManifest.snapshotDirectory !== "string") {
    throw new InputError("CTC model manifest lacks snapshotDirectory.");
  }
  const vocabulary = JSON.parse(
    await readFile(
      path.join(modelManifest.snapshotDirectory, "vocab.json"),
      "utf8",
    ),
  ) as Record<string, number>;
  const projectedEncodings = new Map<string, CtcTargetEncoding>(
    ctcInput.cues.map((cue) => [cue.cueId, cue.encoding]),
  );
  if (projectionMode === "observe") {
    for (const cue of workflow.pronunciationProjection.cues) {
      if (cue.spans.length === 0) continue;
      projectedEncodings.set(
        cue.cueId,
        offlineCtcEncoding({ text: cue.projectedAlignmentText, vocabulary }),
      );
    }
  }
  if (
    values["memory-ctc-observation-input"] !== undefined &&
    ctcObserveMode !== "targeted"
  ) {
    throw new InputError(
      "--memory-ctc-observation-input requires --memory-ctc-observe targeted.",
    );
  }
  const ctcObservation =
    values["memory-ctc-observation-input"] === undefined
      ? await targetedCtcObservation({
          subtitleDirectory,
          reviewPackage: sourceReviewPackage,
          projection: workflow.pronunciationProjection,
          runtimeManifestPath,
          modelManifestPath,
          capabilityPath: path.join(
            subtitleDirectory,
            "ctc-runtime-capability.json",
          ),
          temporaryDirectory,
          projectedEncodings,
          enabled: ctcObserveMode === "targeted",
          generatedAt,
        })
      : await readVerifiedTargetedCtcObservation({
          filePath: values["memory-ctc-observation-input"],
          projection: workflow.pronunciationProjection,
        });
  const ctcTargetAudit = buildMemoryAssistedCtcTargetAudit({
    ctcInput,
    projection: workflow.pronunciationProjection,
    projectedEncodings,
    generatedAt,
  });
  if (
    ctcTargetAudit.summary.previousEncodableCueCount !== 14 ||
    ctcTargetAudit.summary.previousUnencodableCueCount !== 2
  ) {
    throw new InputError("C5.19 CTC target baseline is not 14/16.");
  }

  const artifactPaths = {
    memory: path.join(subtitleDirectory, "series-language-memory.json"),
    observations: path.join(
      subtitleDirectory,
      "episode-language-observations.json",
    ),
    delta: path.join(subtitleDirectory, "series-language-memory-delta.json"),
    evidence: path.join(
      subtitleDirectory,
      "subtitle-series-memory-evidence.json",
    ),
    ranking: path.join(
      subtitleDirectory,
      "subtitle-memory-assisted-ranking.json",
    ),
    pronunciationProjection: path.join(
      subtitleDirectory,
      "subtitle-memory-pronunciation-projection.json",
    ),
    ctcTargetAudit: path.join(
      subtitleDirectory,
      "memory-assisted-ctc-target-audit.json",
    ),
    ctcObservation: path.join(
      subtitleDirectory,
      "memory-assisted-ctc-observation.json",
    ),
    causalValidation: path.join(
      subtitleDirectory,
      "c5-19-causal-validation.json",
    ),
    qualityAudit: path.join(
      subtitleDirectory,
      "series-memory-quality-audit.json",
    ),
    replaySummary: path.join(stagingTask, "c5-19-memory-replay-summary.json"),
  };
  await atomicWriteSeriesLanguageMemory({
    filePath: artifactPaths.memory,
    memory: workflow.memory,
    overwrite: true,
  });
  await Promise.all([
    atomicWriteJson(artifactPaths.observations, workflow.observations, {
      overwrite: true,
    }),
    atomicWriteJson(artifactPaths.delta, workflow.delta, { overwrite: true }),
    atomicWriteJson(artifactPaths.evidence, workflow.evidence, {
      overwrite: true,
    }),
    atomicWriteJson(artifactPaths.ranking, workflow.ranking, {
      overwrite: true,
    }),
    atomicWriteJson(
      artifactPaths.pronunciationProjection,
      workflow.pronunciationProjection,
      { overwrite: true },
    ),
    atomicWriteJson(artifactPaths.ctcTargetAudit, ctcTargetAudit, {
      overwrite: true,
    }),
    atomicWriteJson(artifactPaths.ctcObservation, ctcObservation, {
      overwrite: true,
    }),
    atomicWriteJson(artifactPaths.causalValidation, workflow.causalValidation, {
      overwrite: true,
    }),
    atomicWriteJson(artifactPaths.qualityAudit, workflow.qualityAudit, {
      overwrite: true,
    }),
  ]);
  if (values["memory-output"] !== undefined) {
    await atomicWriteSeriesLanguageMemory({
      filePath: path.resolve(values["memory-output"]),
      memory: workflow.memory,
      overwrite: true,
    });
  }
  if (memoryMode === "learn" && values["series-memory-store"] !== undefined) {
    await atomicWriteSeriesLanguageMemory({
      filePath: path.resolve(values["series-memory-store"]),
      memory: workflow.memory,
      overwrite: true,
    });
  }

  const secondDelta = promoteEpisodeLanguageObservations({
    observations: workflow.observations,
    parentMemory: workflow.memory,
    generatedAt,
  });
  const secondMerge = mergeSeriesLanguageMemory({
    memory: workflow.memory,
    delta: secondDelta,
    generatedAt,
  });
  const idempotentMerge = secondMerge.memoryHash === workflow.memory.memoryHash;
  if (!idempotentMerge) {
    const secondById = new Map(
      secondMerge.entries.map((entry) => [entry.entryId, entry]),
    );
    const changedEntries = workflow.memory.entries
      .filter(
        (entry) =>
          entry.semanticHash !== secondById.get(entry.entryId)?.semanticHash,
      )
      .map((entry) => entry.entryId);
    throw new InputError(
      `Series memory merge is not idempotent: ${workflow.memory.memoryHash} -> ${secondMerge.memoryHash}; changed=${changedEntries.join(",")}`,
    );
  }

  const metrics = {
    sourceCueCount: packageValue.cues.length,
    memoryCandidateCount: workflow.observations.statistics.memoryCandidateCount,
    memoryPromotedCount: workflow.delta.statistics.memoryPromotedCount,
    memoryEntryCount: workflow.memory.statistics.entryCount,
    properNounEntryCount: workflow.memory.statistics.properNounEntryCount,
    terminologyEntryCount: workflow.memory.statistics.terminologyEntryCount,
    dialectEntryCount: workflow.memory.statistics.dialectEntryCount,
    correctionEntryCount: workflow.memory.statistics.correctionEntryCount,
    pronunciationEntryCount: workflow.memory.statistics.pronunciationEntryCount,
    acousticAliasCount: workflow.memory.statistics.acousticAliasCount,
    ambiguousMemoryAliasCount:
      workflow.memory.statistics.ambiguousMemoryAliasCount,
    conflictedReadingCount: workflow.memory.statistics.conflictedReadingCount,
    duplicateMemoryEvidenceCount:
      workflow.memory.statistics.duplicateMemoryEvidenceCount,
    memoryEvidenceDoubleCountPreventedCount:
      workflow.memory.statistics.memoryEvidenceDoubleCountPreventedCount,
    causalMemoryMatchCount:
      workflow.causalValidation.summary.causalMemoryMatchCount,
    frozenMemoryMatchCount:
      runKind === "frozen" ? workflow.evidence.summary.matchedEntryCount : 0,
    memoryRankingEvaluatedCueCount:
      workflow.ranking.summary.memoryRankingEvaluatedCueCount,
    memoryRankingChangedCount:
      workflow.ranking.summary.memoryRankingChangedCount,
    memoryRankingCorrectedCount:
      workflow.ranking.summary.memoryRankingCorrectedCount,
    memoryRankingRegressionCount:
      workflow.ranking.summary.memoryRankingRegressionCount,
    dialectPreservationCount: workflow.memory.entries.filter(
      (entry) => entry.dialectMetadata.preservationRequired,
    ).length,
    dialectStandardizationAttemptCount: 0,
    pronunciationProjectionCount:
      workflow.pronunciationProjection.summary.pronunciationProjectionCount,
    previousUnencodableCueCount:
      ctcTargetAudit.summary.previousUnencodableCueCount,
    previousUnencodableCueRescuedCount:
      ctcTargetAudit.summary.previousUnencodableCueRescuedCount,
    canonicalTextMutationCount: 0,
    timingMutationCount: 0,
    memoryFabricatedAutoCandidateCount: 0,
    memoryAcousticOverrideViolationCount: 0,
    crossSeriesMemoryLeakCount: 0,
    futureCueMemoryLeakCount:
      workflow.causalValidation.summary.futureCueMemoryLeakCount,
    sameCueMemoryLeakCount:
      workflow.causalValidation.summary.sameCueMemoryLeakCount,
    globalReplacementCount: 0,
    pronunciationProjectionCanonicalMutationCount: 0,
    targetedCtcObserveCount: ctcObservation.summary.requestCount,
    memoryAssistedCtcTimingMutationCount: 0,
    idempotentMergePassed: 1,
  };
  const relative = (filePath: string) =>
    path.relative(subtitleDirectory, filePath).split(path.sep).join("/");

  const sourceFinalization = subtitleFinalizationReportSchema.parse(
    JSON.parse(await readFile(finalizationPath, "utf8")) as unknown,
  );
  if (
    sourceFinalization.status !== "needs-review" ||
    sourceFinalization.finalizationMethod !== "none"
  ) {
    throw new InputError(
      "C5.19 must preserve needs-review with finalizationMethod none.",
    );
  }
  const c519Finalization = subtitleFinalizationReportSchema.parse({
    ...sourceFinalization,
    finalizationVersion: "C5.19-series-language-memory-observe-v1",
    generatedAt,
    metrics: {
      ...sourceFinalization.metrics,
      seriesMemorySourceCueCount: metrics.sourceCueCount,
      memoryCandidateCount: metrics.memoryCandidateCount,
      memoryPromotedCount: metrics.memoryPromotedCount,
      memoryEntryCount: metrics.memoryEntryCount,
      properNounEntryCount: metrics.properNounEntryCount,
      terminologyEntryCount: metrics.terminologyEntryCount,
      dialectEntryCount: metrics.dialectEntryCount,
      correctionEntryCount: metrics.correctionEntryCount,
      pronunciationEntryCount: metrics.pronunciationEntryCount,
      acousticAliasCount: metrics.acousticAliasCount,
      ambiguousMemoryAliasCount: metrics.ambiguousMemoryAliasCount,
      conflictedReadingCount: metrics.conflictedReadingCount,
      duplicateMemoryEvidenceCount: metrics.duplicateMemoryEvidenceCount,
      memoryEvidenceDoubleCountPreventedCount:
        metrics.memoryEvidenceDoubleCountPreventedCount,
      causalMemoryMatchCount: metrics.causalMemoryMatchCount,
      frozenMemoryMatchCount: metrics.frozenMemoryMatchCount,
      memoryRankingEvaluatedCueCount: metrics.memoryRankingEvaluatedCueCount,
      memoryRankingChangedCount: metrics.memoryRankingChangedCount,
      memoryRankingCorrectedCount: metrics.memoryRankingCorrectedCount,
      memoryRankingRegressionCount: metrics.memoryRankingRegressionCount,
      dialectPreservationCount: metrics.dialectPreservationCount,
      dialectStandardizationAttemptCount:
        metrics.dialectStandardizationAttemptCount,
      pronunciationProjectionCount: metrics.pronunciationProjectionCount,
      previousUnencodableCueCount: metrics.previousUnencodableCueCount,
      previousUnencodableCueRescuedCount:
        metrics.previousUnencodableCueRescuedCount,
      memoryCanonicalTextMutationCount: metrics.canonicalTextMutationCount,
      memoryTimingMutationCount: metrics.timingMutationCount,
      memoryFabricatedAutoCandidateCount:
        metrics.memoryFabricatedAutoCandidateCount,
      memoryAcousticOverrideViolationCount:
        metrics.memoryAcousticOverrideViolationCount,
      crossSeriesMemoryLeakCount: metrics.crossSeriesMemoryLeakCount,
      futureCueMemoryLeakCount: metrics.futureCueMemoryLeakCount,
      sameCueMemoryLeakCount: metrics.sameCueMemoryLeakCount,
      memoryGlobalReplacementCount: metrics.globalReplacementCount,
      pronunciationProjectionCanonicalMutationCount:
        metrics.pronunciationProjectionCanonicalMutationCount,
      targetedMemoryCtcObserveCount: metrics.targetedCtcObserveCount,
      memoryAssistedCtcTimingMutationCount:
        metrics.memoryAssistedCtcTimingMutationCount,
      seriesMemoryIdempotentMergePassed: metrics.idempotentMergePassed,
    },
    outputPaths: {
      ...sourceFinalization.outputPaths,
      seriesLanguageMemory: relative(artifactPaths.memory),
      episodeLanguageObservations: relative(artifactPaths.observations),
      seriesLanguageMemoryDelta: relative(artifactPaths.delta),
      subtitleSeriesMemoryEvidence: relative(artifactPaths.evidence),
      subtitleMemoryAssistedRanking: relative(artifactPaths.ranking),
      subtitleMemoryPronunciationProjection: relative(
        artifactPaths.pronunciationProjection,
      ),
      memoryAssistedCtcTargetAudit: relative(artifactPaths.ctcTargetAudit),
      memoryAssistedCtcObservation: relative(artifactPaths.ctcObservation),
      c519CausalValidation: relative(artifactPaths.causalValidation),
      seriesMemoryQualityAudit: relative(artifactPaths.qualityAudit),
    },
  });
  await atomicWriteJson(finalizationPath, c519Finalization, {
    overwrite: true,
  });

  const reviewPackage = attachSeriesMemoryReviewContext({
    reviewPackage: sourceReviewPackage,
    seriesMemoryHash: workflow.memory.memoryHash,
    memoryRanking: workflow.ranking,
    pronunciationProjectionHash: workflow.pronunciationProjection.semanticHash,
    generatedAt,
  });
  await atomicWriteJson(reviewPath, reviewPackage, { overwrite: true });
  const [speakerEvidence, ctcEvidence, separationEvidence] = await Promise.all([
    readFile(
      path.join(subtitleDirectory, "subtitle-local-speaker-evidence.json"),
      "utf8",
    ).then((text) =>
      subtitleLocalSpeakerEvidenceSchema.parse(JSON.parse(text) as unknown),
    ),
    readFile(
      path.join(subtitleDirectory, "subtitle-local-ctc-boundary-evidence.json"),
      "utf8",
    ).then((text) =>
      subtitleLocalCtcBoundaryEvidenceSchema.parse(JSON.parse(text) as unknown),
    ),
    readFile(
      path.join(
        subtitleDirectory,
        "subtitle-local-separated-stream-evidence.json",
      ),
      "utf8",
    ).then((text) =>
      subtitleLocalSeparatedStreamEvidenceSchema.parse(
        JSON.parse(text) as unknown,
      ),
    ),
  ]);
  await writeSubtitleReviewPage({
    subtitleDirectory,
    reviewPackage,
    speakerEvidence,
    ctcEvidence,
    separatedStreamEvidence: separationEvidence,
    seriesMemory: workflow.memory,
    seriesMemoryEvidence: workflow.evidence,
    memoryRanking: workflow.ranking,
    memoryProjection: workflow.pronunciationProjection,
    timelineEnabled: true,
  });
  const priorDelivery = subtitleReviewDeliveryIntegritySchema.parse(
    JSON.parse(
      await readFile(
        path.join(subtitleDirectory, "subtitle-review-delivery-integrity.json"),
        "utf8",
      ),
    ) as unknown,
  );
  await writeReviewDeliveryIntegrity({
    mode: "enforce",
    sourceTaskName: priorDelivery.sourceTaskIdentity.taskName,
    subtitleDirectory,
    sourceReviewPackageHash:
      priorDelivery.sourceTaskIdentity.sourceReviewPackageHash,
    sourceFinalizationReportHash:
      priorDelivery.sourceTaskIdentity.sourceFinalizationReportHash,
    baseTimingHash: EXPECTED_TIMING_HASH,
    canonicalCueHashUnchanged: true,
    canonicalTimingHashUnchanged: true,
  });

  const summaryBase = {
    schemaVersion: "1.0.0" as const,
    artifactType: "c5-19-memory-replay-summary" as const,
    replayVersion: "C5.19" as const,
    generatedAt,
    runKind,
    networkUsed: false as const,
    sourceTaskHash: stableMemoryHash(sourceArtifactHashes),
    sourceCueCount: packageValue.cues.length,
    seriesIdentity,
    memoryHash: workflow.memory.memoryHash,
    artifactPaths: {
      memory: relative(artifactPaths.memory),
      observations: relative(artifactPaths.observations),
      delta: relative(artifactPaths.delta),
      evidence: relative(artifactPaths.evidence),
      ranking: relative(artifactPaths.ranking),
      pronunciationProjection: relative(artifactPaths.pronunciationProjection),
      ctcTargetAudit: relative(artifactPaths.ctcTargetAudit),
      ctcObservation: relative(artifactPaths.ctcObservation),
      causalValidation: relative(artifactPaths.causalValidation),
      qualityAudit: relative(artifactPaths.qualityAudit),
    },
    hashes: {
      canonicalCueHash: EXPECTED_BASE_CUE_HASH,
      canonicalTimingHash: EXPECTED_TIMING_HASH,
      presentationHash: EXPECTED_PRESENTATION_HASH,
      memoryHash: workflow.memory.memoryHash,
      observationSemanticHash: workflow.observations.semanticHash,
      deltaSemanticHash: workflow.delta.semanticHash,
      evidenceSemanticHash: workflow.evidence.semanticHash,
      rankingSemanticHash: workflow.ranking.semanticHash,
      pronunciationProjectionSemanticHash:
        workflow.pronunciationProjection.semanticHash,
      ctcTargetAuditSemanticHash: ctcTargetAudit.semanticHash,
      causalValidationSemanticHash: workflow.causalValidation.semanticHash,
    },
    metrics,
    reviewItemCountBefore: sourceReviewPackage.items.length,
    reviewItemCountAfter: reviewPackage.items.length,
    finalStatus: "needs-review" as const,
    finalizationMethod: "none" as const,
  };
  const replaySummary = c519MemoryReplaySummarySchema.parse({
    ...summaryBase,
    semanticHash: stableMemoryHash({ ...summaryBase, generatedAt: null }),
  });
  await atomicWriteJson(artifactPaths.replaySummary, replaySummary, {
    overwrite: true,
  });
  const localExecutionSummaryPath = path.join(
    stagingTask,
    "c5-19-local-execution-summary.json",
  );
  await atomicWriteJson(
    localExecutionSummaryPath,
    {
      execution: {
        runKind,
        memoryMode,
        memoryRankingMode,
        projectionMode,
        ctcObserveMode,
        networkUsed: false,
      },
      outcome: metrics,
    },
    { overwrite: true },
  );
  const rootFile = (name: string) => path.join(stagingTask, name);
  const subFile = (name: string) => path.join(subtitleDirectory, name);
  await generateC5161ShareableArtifacts({
    taskRoot: stagingTask,
    subtitleDirectory,
    localExecutionSummaryPath,
    stockPatchedRuntimeAbPath: path.join(
      sourceTask,
      "shareable",
      "c5-16-stock-patched-runtime-ab.json",
    ),
    externalFiles: [],
    c517Artifacts: {
      runtimeCapabilityPath: subFile(
        "forced-alignment-runtime-capability.json",
      ),
      canonicalInputPath: subFile("subtitle-canonical-alignment-input.json"),
      forcedAlignmentPath: subFile("subtitle-canonical-forced-alignment.json"),
      replaySummaryPath: rootFile("c5-17-forced-alignment-replay-summary.json"),
      pronunciationPath,
      sudachiRuntimeCapabilityPath: subFile("sudachi-runtime-capability.json"),
      cacheManifestPath: subFile("forced-alignment-cache-manifest.json"),
      runtimePreparationSummaryPath: path.join(
        sourceTask,
        "shareable",
        "c5-17-1-runtime-preparation-summary.json",
      ),
      freshCacheObserveValidationPath: rootFile(
        "c5-17-1-fresh-cache-observe-validation.json",
      ),
    },
    c5172Artifacts: {
      deliveryIntegrityPath: subFile("subtitle-review-delivery-integrity.json"),
      replaySummaryPath: rootFile(
        "c5-17-2-review-delivery-replay-summary.json",
      ),
      reviewActionValidationReportPath: subFile(
        "review-action-validation-report.json",
      ),
    },
    c518Artifacts: {
      runtimeCapabilityPath: subFile(
        "speaker-evidence-runtime-capability.json",
      ),
      localSpeakerEvidencePath: subFile("subtitle-local-speaker-evidence.json"),
      replaySummaryPath: rootFile("c5-18-speaker-evidence-replay-summary.json"),
      freshCacheObserveValidationPath: rootFile(
        "c5-18-fresh-cache-observe-validation.json",
      ),
    },
    c5181Artifacts: {
      runtimeCapabilityPath: subFile("ctc-runtime-capability.json"),
      alignmentInputPath: ctcInputPath,
      boundaryEvidencePath: subFile(
        "subtitle-local-ctc-boundary-evidence.json",
      ),
      cacheManifestPath: subFile("ctc-alignment-cache-manifest.json"),
      separatedStreamEvidencePath: subFile(
        "subtitle-local-separated-stream-evidence.json",
      ),
      replaySummaryPath: rootFile("c5-18-1-ctc-boundary-replay-summary.json"),
      freshCacheObserveValidationPath: rootFile(
        "c5-18-1-fresh-cache-observe-validation.json",
      ),
    },
    c519Artifacts: {
      memoryPath: artifactPaths.memory,
      observationsPath: artifactPaths.observations,
      deltaPath: artifactPaths.delta,
      evidencePath: artifactPaths.evidence,
      rankingPath: artifactPaths.ranking,
      pronunciationProjectionPath: artifactPaths.pronunciationProjection,
      ctcTargetAuditPath: artifactPaths.ctcTargetAudit,
      ctcObservationPath: artifactPaths.ctcObservation,
      replaySummaryPath: artifactPaths.replaySummary,
      causalValidationPath: artifactPaths.causalValidation,
      qualityAuditPath: artifactPaths.qualityAudit,
    },
  });
  const shareable = await auditC5161ShareableArtifacts(
    path.join(stagingTask, "shareable"),
  );
  if (!shareable.validationPassed) {
    throw new InputError("C5.19 shareable artifact audit failed.");
  }
  const sourceHashesAfter = await Promise.all([
    sha256LocalFile(
      path.join(
        sourceLocated.subtitleDirectory,
        "subtitle-package.human-reviewed-base.json",
      ),
    ),
    sha256LocalFile(
      path.join(
        sourceLocated.subtitleDirectory,
        "subtitle-canonical-alignment-input.json",
      ),
    ),
    sha256LocalFile(
      path.join(
        sourceLocated.subtitleDirectory,
        "subtitle-canonical-pronunciation.json",
      ),
    ),
  ]);
  if (
    sourceHashesAfter[0] !== sourceArtifactHashes.canonical ||
    sourceHashesAfter[1] !== sourceArtifactHashes.alignment ||
    sourceHashesAfter[2] !== sourceArtifactHashes.pronunciation
  ) {
    throw new InputError("C5.19 source task changed during replay.");
  }
  await rename(stagingTask, outputTask);
  completed = true;
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        runKind,
        output: outputTask,
        seriesKey: seriesIdentity.seriesKey,
        memoryHash: workflow.memory.memoryHash,
        metrics,
        shareable: shareable.validationPassed,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
  if (!completed) await rm(stagingTask, { recursive: true, force: true });
}
