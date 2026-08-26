import { createHash, randomUUID } from "node:crypto";
import { cp, mkdtemp, readFile, rename, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  InputError,
  atomicWriteFile,
  atomicWriteJson,
  c518SpeakerEvidenceReplaySummarySchema,
  reviewActionHardeningModeSchema,
  speakerBackendSchema,
  speakerCacheModeSchema,
  speakerDeviceSchema,
  speakerEvidenceModeSchema,
  speakerEvidenceRuntimeCapabilitySchema,
  speakerPresentationResolutionModeSchema,
  speakerWindowModeSchema,
  subtitleFinalizationReportSchema,
  subtitlePackageSchema,
  subtitlePresentationResolutionSchema,
  subtitleReviewPackageSchema,
  type SpeakerEvidenceRuntimeCapability,
  type SubtitleCue,
} from "@mvl/shared";
import type { AssEventOverride } from "@mvl/subtitle-core";
import { buildPresentationCueHash } from "@mvl/transcription-core";
import {
  LocalSpeakerWorker,
  SPEAKER_CUE_ASSIGNMENT_POLICY,
  SPEAKER_NORMALIZATION_POLICY,
  SPEAKER_OVERLAP_POLICY,
  SPEAKER_PROMINENCE_POLICY,
  SPEAKER_RELATIONSHIP_POLICY,
  SPEAKER_WINDOW_MAPPING_POLICY,
  SpeakerEvidenceCache,
  analyzeLocalSpeakerEvidence,
  auditC5161ShareableArtifacts,
  bindReviewCandidates,
  buildReviewActionValidationReport,
  buildSpeakerRuntimeCapability,
  cropReviewWavFrames,
  evaluateFinalCueQuality,
  generateC5161ShareableArtifacts,
  inspectReviewWav,
  loadAndVerifySpeakerRuntime,
  locateSubtitlePackage,
  sha256Value,
  writeReviewDeliveryIntegrity,
  writeSubtitleReviewPage,
  type RawSpeakerAttemptInput,
  type RawSpeakerInference,
  type SpeakerPcmWindow,
  type SpeakerWorkerReady,
} from "@mvl/video-subtitler";

const { values } = parseArgs({
  options: {
    task: { type: "string" },
    output: { type: "string" },
    "source-video": { type: "string" },
    "human-reviewed-subtitle": { type: "string" },
    "review-action-hardening": { type: "string", default: "enforce" },
    "speaker-evidence": { type: "string", default: "enforce" },
    "speaker-backend": {
      type: "string",
      default: "pyannote-community-1",
    },
    "speaker-runtime-manifest": { type: "string" },
    "speaker-model-manifest": { type: "string" },
    "speaker-device": { type: "string", default: "auto" },
    "speaker-window-mode": { type: "string", default: "dual" },
    "speaker-min-speakers": { type: "string", default: "1" },
    "speaker-max-speakers": { type: "string", default: "3" },
    "speaker-evidence-concurrency": { type: "string", default: "1" },
    "speaker-presentation-resolution": {
      type: "string",
      default: "enforce",
    },
    "speaker-cache-dir": { type: "string" },
    "speaker-cache-import": { type: "string", multiple: true },
    "speaker-cache-mode": { type: "string" },
    "asr-cache-mode": { type: "string", default: "read-write" },
    "persist-speaker-embeddings": { type: "boolean", default: false },
  },
  strict: true,
});

if (
  values.task === undefined ||
  values["speaker-runtime-manifest"] === undefined
) {
  throw new InputError(
    "Usage: npm run replay:c5-18-speaker-evidence -- --task <C5.17.2-or-Phase-0-task> --speaker-runtime-manifest <manifest> [--speaker-model-manifest <manifest>] [--output <new-task>]",
  );
}

function boundedInteger(
  value: string,
  option: string,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new InputError(
      `${option} must be an integer from ${String(minimum)} through ${String(maximum)}.`,
    );
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
  const preferred = path.join(
    parent,
    "carnation-reference-guided-c5-18-local-speaker-evidence-20260826",
  );
  for (let index = 0; index < 1_000; index += 1) {
    const candidate =
      index === 0
        ? preferred
        : `${preferred}-${String(index).padStart(2, "0")}`;
    if (!(await exists(candidate))) return candidate;
  }
  throw new InputError("Unable to allocate collision-safe C5.18 output.");
}

function resolveInside(root: string, relative: string): string {
  const resolved = path.resolve(root, relative);
  const relation = path.relative(root, resolved);
  if (
    relation === ".." ||
    relation.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relation)
  ) {
    throw new InputError(`Artifact path escapes its task root: ${relative}`);
  }
  return resolved;
}

async function criticalHashes(subtitleDirectory: string) {
  const names = [
    "subtitle-review-package.json",
    "subtitle-finalization-report.json",
    "subtitle-canonical-forced-alignment.json",
    "subtitle-overlap-acoustic-resolution.json",
    "subtitle-timestamp-evidence-integrity.json",
    "subtitle-presentation-resolution.json",
    "subtitle-review-evidence-reconciliation.json",
    "subtitle-review-delivery-integrity.json",
    "subtitle-package.needs-review.json",
  ];
  return Object.fromEntries(
    await Promise.all(
      names.map(async (name): Promise<[string, string]> => [
        name,
        await sha256File(path.join(subtitleDirectory, name)),
      ]),
    ),
  );
}

function dataChunk(buffer: Buffer): { offset: number; length: number } {
  let cursor = 12;
  while (cursor + 8 <= buffer.length) {
    const id = buffer.toString("ascii", cursor, cursor + 4);
    const length = buffer.readUInt32LE(cursor + 4);
    const offset = cursor + 8;
    if (offset + length > buffer.length) {
      throw new InputError("Review WAV data is truncated.");
    }
    if (id === "data") return { offset, length };
    cursor = offset + length + (length % 2);
  }
  throw new InputError("Review WAV data chunk is missing.");
}

function pcmWindow(buffer: Buffer, mediaStart: number): SpeakerPcmWindow {
  const chunk = dataChunk(buffer);
  const samples = new Int16Array(chunk.length / 2);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = buffer.readInt16LE(chunk.offset + index * 2);
  }
  return { samples, sampleRate: 16_000, mediaStart };
}

function packageVersion(
  packages: readonly { name: string; version: string }[],
  name: string,
): string {
  const normalized = name.replaceAll("_", "-").toLowerCase();
  const value = packages.find(
    (entry) => entry.name.replaceAll("_", "-").toLowerCase() === normalized,
  )?.version;
  if (value === undefined) {
    throw new InputError(`Speaker runtime manifest lacks ${name}.`);
  }
  return value;
}

function sameCueSet(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    [...left]
      .toSorted()
      .every((value, index) => value === [...right].toSorted()[index])
  );
}

function presentationRelationship(value: string) {
  switch (value) {
    case "ordered-different-speaker-turns":
      return "rapid-turn-taking" as const;
    case "same-speaker-boundary-overlap":
      return "different-dialogue-boundary-error" as const;
    case "stable-multi-speaker-overlap":
      return "true-simultaneous-speech" as const;
    case "nested-multi-speaker-activity":
      return "nested-background-speech" as const;
    default:
      return "unresolved" as const;
  }
}

const sourceTask = path.resolve(values.task);
const outputTask = await allocateOutput(sourceTask);
const stagingTask = path.join(
  path.dirname(outputTask),
  `.${path.basename(outputTask)}.staging-${randomUUID()}`,
);
const actionMode = reviewActionHardeningModeSchema.parse(
  values["review-action-hardening"],
);
const speakerMode = speakerEvidenceModeSchema.parse(values["speaker-evidence"]);
speakerBackendSchema.parse(values["speaker-backend"]);
const deviceRequested = speakerDeviceSchema.parse(values["speaker-device"]);
const windowMode = speakerWindowModeSchema.parse(values["speaker-window-mode"]);
const presentationMode = speakerPresentationResolutionModeSchema.parse(
  values["speaker-presentation-resolution"],
);
const cacheMode = speakerCacheModeSchema.parse(
  values["speaker-cache-mode"] ?? values["asr-cache-mode"],
);
const minimumSpeakers = boundedInteger(
  values["speaker-min-speakers"],
  "--speaker-min-speakers",
  1,
  3,
);
const maximumSpeakers = boundedInteger(
  values["speaker-max-speakers"],
  "--speaker-max-speakers",
  1,
  3,
);
const concurrency = boundedInteger(
  values["speaker-evidence-concurrency"],
  "--speaker-evidence-concurrency",
  1,
  1,
);
if (minimumSpeakers > maximumSpeakers) {
  throw new InputError("Minimum speakers cannot exceed maximum speakers.");
}
if (windowMode !== "dual") {
  throw new InputError(
    "C5.18 acceptance requires --speaker-window-mode dual; single-window modes cannot establish stability.",
  );
}
if (values["persist-speaker-embeddings"]) {
  throw new InputError(
    "C5.18 shareable replay refuses persistent speaker embeddings.",
  );
}
if (concurrency !== 1) {
  throw new InputError("C5.18 requires local Community-1 at concurrency 1.");
}

const runtimeManifestPath = path.resolve(values["speaker-runtime-manifest"]);
const modelManifestPath = path.resolve(
  values["speaker-model-manifest"] ??
    path.join(path.dirname(runtimeManifestPath), "speaker-model-manifest.json"),
);
const verifiedRuntime = await loadAndVerifySpeakerRuntime({
  runtimeManifestPath,
  modelManifestPath,
});
const sourceLocated = await locateSubtitlePackage(sourceTask);
const sourceCriticalBefore = await criticalHashes(
  sourceLocated.subtitleDirectory,
);
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

let completed = false;
const runtimeState: {
  worker: LocalSpeakerWorker | null;
  ready: SpeakerWorkerReady | null;
} = { worker: null, ready: null };
const temporaryAudio = await mkdtemp(
  path.join(tmpdir(), "mvl-c5-18-speaker-window-"),
);
try {
  await cp(sourceTask, stagingTask, {
    recursive: true,
    errorOnExist: true,
    force: false,
    preserveTimestamps: true,
  });
  await rm(path.join(stagingTask, "shareable"), {
    recursive: true,
    force: true,
  });
  const targetLocated = await locateSubtitlePackage(stagingTask);
  const subtitleDirectory = targetLocated.subtitleDirectory;
  const reviewPackagePath = path.join(
    subtitleDirectory,
    "subtitle-review-package.json",
  );
  const finalizationReportPath = path.join(
    subtitleDirectory,
    "subtitle-finalization-report.json",
  );
  const presentationPath = path.join(
    subtitleDirectory,
    "subtitle-presentation-resolution.json",
  );
  const forcedAlignmentPath = path.join(
    subtitleDirectory,
    "subtitle-canonical-forced-alignment.json",
  );
  const overlapAcousticPath = path.join(
    subtitleDirectory,
    "subtitle-overlap-acoustic-resolution.json",
  );
  const reconciliationPath = path.join(
    subtitleDirectory,
    "subtitle-review-evidence-reconciliation.json",
  );
  const reviewActionReportPath = path.join(
    subtitleDirectory,
    "review-action-validation-report.json",
  );
  const sourceReviewPackage = subtitleReviewPackageSchema.parse(
    JSON.parse(await readFile(reviewPackagePath, "utf8")) as unknown,
  );
  const sourceReviewPackageHash = await sha256File(reviewPackagePath);
  const sourceFinalizationReport = subtitleFinalizationReportSchema.parse(
    JSON.parse(await readFile(finalizationReportPath, "utf8")) as unknown,
  );
  const sourceFinalizationReportHash = await sha256File(finalizationReportPath);
  const sourcePresentation = subtitlePresentationResolutionSchema.parse(
    JSON.parse(await readFile(presentationPath, "utf8")) as unknown,
  );
  const presentationHashBefore = await sha256File(presentationPath);
  if (
    sourceReviewPackage.items.length !== 7 ||
    new Set(sourceReviewPackage.items.flatMap((item) => item.targetCueIds))
      .size !== 16
  ) {
    throw new InputError(
      "C5.18 requires the verified seven-component, sixteen-cue C5.17.2 review package.",
    );
  }

  const finalPackagePath = resolveInside(
    subtitleDirectory,
    sourceFinalizationReport.outputPaths.subtitlePackage,
  );
  const sourceFinalPackage = subtitlePackageSchema.parse(
    JSON.parse(await readFile(finalPackagePath, "utf8")) as unknown,
  );
  if (sourceFinalPackage.cues.length !== 192) {
    throw new InputError("C5.18 requires the 192-cue human-reviewed baseline.");
  }
  const baseTimingHash = sha256Value(
    sourceFinalPackage.cues.map((cue) => ({
      id: cue.id,
      start: cue.start,
      end: cue.end,
    })),
  );
  const baseCueHash = sha256Value(sourceFinalPackage.cues);

  let existingCapability: SpeakerEvidenceRuntimeCapability | null = null;
  const inheritedCapabilityPath = path.join(
    subtitleDirectory,
    "speaker-evidence-runtime-capability.json",
  );
  if (await exists(inheritedCapabilityPath)) {
    existingCapability = speakerEvidenceRuntimeCapabilitySchema.parse(
      JSON.parse(await readFile(inheritedCapabilityPath, "utf8")) as unknown,
    );
    if (
      existingCapability.runtimeIdentityHash !==
        verifiedRuntime.runtime.runtimeIdentityHash ||
      existingCapability.modelSnapshotHash !==
        verifiedRuntime.model.modelSnapshotHash ||
      existingCapability.deviceRequested !== deviceRequested
    ) {
      throw new InputError(
        "Inherited speaker capability does not match this runtime/model/device request.",
      );
    }
  }

  let sampleInference: RawSpeakerInference | null = null;
  let pipelineInferenceCount = 0;
  let modelLoadCount = 0;
  const ensureWorker = async () => {
    if (runtimeState.worker === null) {
      runtimeState.worker = new LocalSpeakerWorker({
        ...verifiedRuntime,
        device: deviceRequested,
        workerScriptPath: path.resolve("scripts/runtime/speaker_worker.py"),
      });
      runtimeState.ready = await runtimeState.worker.start();
      modelLoadCount += runtimeState.ready.modelLoadCount;
    }
    return runtimeState.worker;
  };
  if (cacheMode !== "read") await ensureWorker();
  const deviceUsed =
    runtimeState.ready?.deviceUsed ?? existingCapability?.deviceUsed ?? null;
  if (deviceUsed === null) {
    throw new InputError(
      "Read-only speaker cache replay requires an inherited, verified runtime capability so the actual device is part of the cache identity.",
    );
  }

  const cacheRoot = path.resolve(
    values["speaker-cache-dir"] ??
      path.join(homedir(), ".cache", "mvl", "speaker-evidence-cache"),
  );
  const cache = new SpeakerEvidenceCache({
    root: cacheRoot,
    importRoots: values["speaker-cache-import"] ?? [],
    mode: cacheMode,
  });
  const rawAttempts: RawSpeakerAttemptInput[] = [];
  const pcmByComponent = new Map<string, SpeakerPcmWindow>();
  const dependencyModelHashes = verifiedRuntime.model.dependencyModelSnapshots
    .map((snapshot) => snapshot.modelSnapshotHash)
    .toSorted();

  for (const item of [...sourceReviewPackage.items].toSorted((left, right) =>
    left.reviewId.localeCompare(right.reviewId),
  )) {
    const componentId =
      item.audioSourceComponentId ??
      item.forcedAlignmentEvidence?.componentId ??
      item.speakerEvidenceComponentId;
    if (!componentId) {
      throw new InputError(`Review item ${item.reviewId} has no component ID.`);
    }
    if (
      item.audioClipPath === null ||
      item.audioSha256 === null ||
      item.audioExtractedInterval === null
    ) {
      throw new InputError(
        `Review item ${item.reviewId} lacks verified WAV identity.`,
      );
    }
    const audioPath = resolveInside(
      subtitleDirectory,
      path.join("review", item.audioClipPath),
    );
    const audioBuffer = await readFile(audioPath);
    if ((await sha256File(audioPath)) !== item.audioSha256) {
      throw new InputError(`Review WAV hash mismatch: ${item.reviewId}`);
    }
    const wav = inspectReviewWav(audioBuffer);
    if (
      wav.sampleRate !== 16_000 ||
      wav.channelCount !== 1 ||
      wav.bitsPerSample !== 16
    ) {
      throw new InputError(`Review WAV metadata mismatch: ${item.reviewId}`);
    }
    pcmByComponent.set(
      componentId,
      pcmWindow(audioBuffer, item.audioExtractedInterval.start),
    );
    const componentUnion = item.componentUnionInterval ?? item.interval;
    const localUnion = {
      start: componentUnion.start - item.audioExtractedInterval.start,
      end: componentUnion.end - item.audioExtractedInterval.start,
    };
    if (
      localUnion.start < -0.001 ||
      localUnion.end > wav.actualDurationSeconds + 0.001 ||
      localUnion.end <= localUnion.start
    ) {
      throw new InputError(`Review WAV does not cover ${componentId}.`);
    }
    const unionPath = path.join(temporaryAudio, `${item.reviewId}-union.wav`);
    const union = await cropReviewWavFrames({
      sourcePath: audioPath,
      targetPath: unionPath,
      startSeconds: Math.max(0, localUnion.start),
      endSeconds: Math.min(wav.actualDurationSeconds, localUnion.end),
    });
    const maximumForComponent = Math.max(
      minimumSpeakers,
      Math.min(maximumSpeakers, 3, item.targetCueIds.length),
    );

    for (const windowType of ["context", "union"] as const) {
      const context = windowType === "context";
      const attemptId = `speaker-attempt-${sha256Value({
        componentId,
        windowType,
        audioSha256: context ? item.audioSha256 : union.sha256,
      }).slice(0, 20)}`;
      const audioLocalInterval = context
        ? { start: 0, end: wav.actualDurationSeconds }
        : localUnion;
      const mediaGlobalInterval = context
        ? item.audioExtractedInterval
        : componentUnion;
      const audioSha256 = context ? item.audioSha256 : union.sha256;
      const identity = {
        requestType: "local-speaker-evidence" as const,
        audioSha256,
        windowType,
        audioLocalInterval,
        mediaGlobalInterval,
        runtimeIdentityHash: verifiedRuntime.runtime.runtimeIdentityHash,
        pyannoteAudioVersion: packageVersion(
          verifiedRuntime.runtime.packages,
          "pyannote.audio",
        ),
        torchVersion: packageVersion(verifiedRuntime.runtime.packages, "torch"),
        torchaudioVersion: packageVersion(
          verifiedRuntime.runtime.packages,
          "torchaudio",
        ),
        modelRepo: verifiedRuntime.model.modelRepo,
        modelRevision: verifiedRuntime.model.resolvedRevision,
        modelSnapshotHash: verifiedRuntime.model.modelSnapshotHash,
        dependencyModelHashes,
        device: deviceUsed,
        minSpeakers: minimumSpeakers,
        maxSpeakers: maximumForComponent,
        speakerNormalizationPolicy: SPEAKER_NORMALIZATION_POLICY,
        windowMappingPolicy: SPEAKER_WINDOW_MAPPING_POLICY,
        overlapPolicy: SPEAKER_OVERLAP_POLICY,
        prominencePolicy: SPEAKER_PROMINENCE_POLICY,
        cueAssignmentPolicy: SPEAKER_CUE_ASSIGNMENT_POLICY,
        relationshipPolicy: SPEAKER_RELATIONSHIP_POLICY,
      };
      let inference = await cache.get({
        attemptId,
        audioSha256,
        windowType,
        identity,
      });
      const cacheHit = inference !== null;
      if (inference === null) {
        if (cacheMode === "read") {
          throw new InputError(
            `SPEAKER_CACHE_MISS_IN_READ_MODE: ${componentId}/${windowType}`,
          );
        }
        const activeWorker = await ensureWorker();
        inference = await activeWorker.infer({
          audioPath: context ? audioPath : unionPath,
          minSpeakers: minimumSpeakers,
          maxSpeakers: maximumForComponent,
        });
        pipelineInferenceCount += 1;
        sampleInference ??= inference;
        await cache.put({ identity, inference });
      } else {
        sampleInference ??= inference;
      }
      rawAttempts.push({
        componentId,
        windowType,
        audioPath: `./audio/review/${path.basename(audioPath)}`,
        audioSha256,
        audioLocalInterval,
        mediaGlobalInterval,
        runtimeIdentityHash: verifiedRuntime.runtime.runtimeIdentityHash,
        modelSnapshotHash: verifiedRuntime.model.modelSnapshotHash,
        device: deviceUsed,
        minSpeakers: minimumSpeakers,
        maxSpeakers: maximumForComponent,
        cacheHit,
        inference,
      });
    }
  }
  if (rawAttempts.length !== 14 || pipelineInferenceCount > 14) {
    throw new InputError(
      "C5.18 must issue exactly 14 bounded dual-window requests.",
    );
  }

  let capability = existingCapability;
  if (runtimeState.ready !== null && sampleInference !== null) {
    capability = buildSpeakerRuntimeCapability({
      runtime: verifiedRuntime.runtime,
      model: verifiedRuntime.model,
      ready: runtimeState.ready,
      inference: sampleInference,
      mpsCpuSemanticComparable: null,
    });
  }
  if (capability === null) {
    throw new InputError(
      "Speaker runtime capability could not be materialized.",
    );
  }
  if (!capability.finiteOutputVerified) {
    throw new InputError(
      "Speaker runtime capability finite-output probe failed.",
    );
  }
  const capabilityPath = path.join(
    subtitleDirectory,
    "speaker-evidence-runtime-capability.json",
  );
  await atomicWriteJson(capabilityPath, capability, { overwrite: true });
  const capabilityHash = await sha256File(capabilityPath);
  const speakerEvidence = analyzeLocalSpeakerEvidence({
    mode: speakerMode,
    reviewPackage: sourceReviewPackage,
    baseTimingHash,
    runtimeCapabilityRef: {
      path: "./speaker-evidence-runtime-capability.json",
      sha256: capabilityHash,
    },
    reviewPackageRef: {
      path: "./subtitle-review-package.json",
      sha256: sourceReviewPackageHash,
    },
    forcedAlignmentRef: {
      path: "./subtitle-canonical-forced-alignment.json",
      sha256: await sha256File(forcedAlignmentPath),
    },
    overlapAcousticRef: {
      path: "./subtitle-overlap-acoustic-resolution.json",
      sha256: await sha256File(overlapAcousticPath),
    },
    rawAttempts,
    pcmByComponent,
    pipelineInferenceCount,
    modelLoadCount,
    deviceRequested,
    minimumSpeakers,
    maximumSpeakers,
  });
  const speakerEvidencePath = path.join(
    subtitleDirectory,
    "subtitle-local-speaker-evidence.json",
  );
  await atomicWriteJson(speakerEvidencePath, speakerEvidence, {
    overwrite: true,
  });
  const speakerEvidenceHash = await sha256File(speakerEvidencePath);
  const cacheManifest = cache.manifest({
    inferenceCount: pipelineInferenceCount,
    modelLoadCount,
  });
  const cacheManifestPath = path.join(
    subtitleDirectory,
    "speaker-evidence-cache-manifest.json",
  );
  await atomicWriteJson(cacheManifestPath, cacheManifest, { overwrite: true });
  const cacheManifestHash = await sha256File(cacheManifestPath);

  const timingMutations =
    speakerMode === "enforce"
      ? speakerEvidence.components.flatMap(
          (component) => component.timingProposal.mutations,
        )
      : [];
  const mutationByCue = new Map(
    timingMutations.map((mutation) => [mutation.cueId, mutation]),
  );
  if (mutationByCue.size !== timingMutations.length) {
    throw new InputError("Multiple C5.18 timing mutations target one cue.");
  }
  const outputCues: SubtitleCue[] = sourceFinalPackage.cues.map((cue) => {
    const mutation = mutationByCue.get(cue.id);
    if (mutation === undefined) return cue;
    if (
      Math.abs(cue.start - mutation.before.start) > 0.001 ||
      Math.abs(cue.end - mutation.before.end) > 0.001
    ) {
      throw new InputError(`C5.18 timing mutation prior mismatch: ${cue.id}`);
    }
    return { ...cue, start: mutation.after.start, end: mutation.after.end };
  });
  if (
    sourceFinalPackage.cues.some(
      (cue, index) => cue.text !== outputCues[index]?.text,
    )
  ) {
    throw new InputError("C5.18 is not allowed to change canonical text.");
  }

  const updatedOverlapDecisions = sourcePresentation.overlapDecisions.map(
    (decision) => {
      const component = speakerEvidence.components.find((candidate) =>
        sameCueSet(candidate.cueIds, decision.cueIds),
      );
      if (component === undefined) return decision;
      const presentationOnly =
        presentationMode === "enforce" &&
        component.resolutionStatus === "presentation-only";
      const timingOnly =
        speakerMode === "enforce" &&
        component.resolutionStatus === "timing-only";
      return {
        ...decision,
        relationship: presentationRelationship(component.selectedRelationship),
        speakerEvidence: [
          component.semanticHash,
          ...component.speakerTracks.flatMap((track) =>
            track.standardTurns.map((turn) => turn.evidenceLineageId),
          ),
        ],
        recommendedAction:
          presentationOnly || timingOnly
            ? ("preserve-overlap" as const)
            : ("review" as const),
        safeAutomaticAction: timingOnly
          ? ("timing-only" as const)
          : presentationOnly
            ? ("presentation-only" as const)
            : ("none" as const),
        timingMutations: timingOnly
          ? component.timingProposal.mutations.map((mutation) => ({
              cueId: mutation.cueId,
              before: mutation.before,
              after: mutation.after,
              boundarySource: "local-speaker-evidence" as const,
            }))
          : [],
        assEventOverrides: presentationOnly
          ? component.presentationOverrides.map((override) => ({
              cueId: override.cueId,
              layer: override.assLayer,
              alignment: override.assAlignment,
              marginLeft: null,
              marginRight: null,
              marginVertical: null,
              position: null,
            }))
          : [],
        vttCueSettings: presentationOnly
          ? component.presentationOverrides.map((override) => ({
              cueId: override.cueId,
              settings: override.vttSettings,
            }))
          : [],
        reasons: [
          ...new Set([
            ...decision.reasons,
            "C5_18_ANONYMOUS_COMPONENT_LOCAL_SPEAKER_EVIDENCE",
            ...component.blockers,
          ]),
        ],
        blocking: !(presentationOnly || timingOnly),
        resolutionSource: "local-speaker-evidence" as const,
        acousticEvidenceIds: [component.semanticHash],
        classificationConfidence: null,
        counterfactualScores: Object.fromEntries(
          component.relationshipHypotheses.map((hypothesis) => [
            hypothesis.relationship,
            hypothesis.score,
          ]),
        ),
      };
    },
  );
  const displayTextByCueId = new Map(
    sourcePresentation.layoutDecisions.map((decision) => [
      decision.cueId,
      decision.displayText,
    ]),
  );
  const assOverrides = updatedOverlapDecisions.flatMap(
    (decision) => decision.assEventOverrides,
  );
  const vttSettings = updatedOverlapDecisions.flatMap(
    (decision) => decision.vttCueSettings,
  );
  const presentationBase = {
    ...sourcePresentation,
    resolutionVersion: "C5.18" as const,
    generatedAt: new Date().toISOString(),
    canonicalCueHash: sha256Value(outputCues),
    presentationCueHash: buildPresentationCueHash({
      cues: outputCues,
      displayTextByCueId,
      assEventOverrides: assOverrides,
      vttCueSettings: vttSettings,
    }),
    overlapDecisions: updatedOverlapDecisions,
    summary: {
      ...sourcePresentation.summary,
      overlapResolvedCount: updatedOverlapDecisions.filter(
        (decision) => !decision.blocking,
      ).length,
      overlapBlockingCount: updatedOverlapDecisions.filter(
        (decision) => decision.blocking,
      ).length,
      timingMutationCount: timingMutations.length,
      canonicalTextMutationCount: 0,
      canonicalTimingMutationCount: timingMutations.length,
    },
  };
  const presentation =
    subtitlePresentationResolutionSchema.parse(presentationBase);
  await atomicWriteJson(presentationPath, presentation, { overwrite: true });
  const presentationHashAfter = await sha256File(presentationPath);
  const quality = evaluateFinalCueQuality({
    cues: outputCues,
    mediaDurationSeconds: sourceReviewPackage.sourceFingerprint.durationSeconds,
    presentation: {
      cues: outputCues,
      artifact: presentation,
      displayTextByCueId,
      assEventOverridesByCueId: new Map<string, AssEventOverride>(
        assOverrides.map((override) => [
          override.cueId,
          {
            layer: override.layer,
            ...(override.alignment === null
              ? {}
              : { alignment: override.alignment }),
            ...(override.marginLeft === null
              ? {}
              : { marginLeft: override.marginLeft }),
            ...(override.marginRight === null
              ? {}
              : { marginRight: override.marginRight }),
            ...(override.marginVertical === null
              ? {}
              : { marginVertical: override.marginVertical }),
            ...(override.position === null
              ? {}
              : { position: override.position }),
          },
        ]),
      ),
      vttCueSettingsByCueId: new Map(
        vttSettings.map((setting) => [setting.cueId, setting.settings]),
      ),
    },
    presentationResolutionMode:
      presentationMode === "enforce" ? "enforce" : "observe",
  });
  if (
    !quality.serializationRoundTripPassed ||
    !quality.formatSemanticParityPassed
  ) {
    throw new InputError(
      "C5.18 output serialization failed semantic parity; staged output was not published.",
    );
  }
  await Promise.all([
    atomicWriteFile(
      resolveInside(
        subtitleDirectory,
        sourceFinalizationReport.outputPaths.srt,
      ),
      quality.serialized.srt,
      { overwrite: true },
    ),
    atomicWriteFile(
      resolveInside(
        subtitleDirectory,
        sourceFinalizationReport.outputPaths.vtt,
      ),
      quality.serialized.vtt,
      { overwrite: true },
    ),
    atomicWriteFile(
      resolveInside(
        subtitleDirectory,
        sourceFinalizationReport.outputPaths.ass,
      ),
      quality.serialized.ass,
      { overwrite: true },
    ),
  ]);
  const outputFinalPackage = subtitlePackageSchema.parse({
    ...sourceFinalPackage,
    primarySubtitle:
      sourceFinalPackage.primarySubtitle === null
        ? null
        : {
            ...sourceFinalPackage.primarySubtitle,
            validationStatus: "needs-review",
          },
    cues: outputCues,
    warnings: [
      ...new Set([
        ...sourceFinalPackage.warnings,
        "C5.18 adds anonymous component-local diarization evidence; it does not identify a real person or establish foreground/background ground truth.",
      ]),
    ],
  });
  await atomicWriteJson(finalPackagePath, outputFinalPackage, {
    overwrite: true,
  });

  const assignmentHash = sha256Value(
    speakerEvidence.components.map((component) => ({
      componentId: component.componentId,
      hypotheses: component.cueSpeakerHypotheses,
    })),
  );
  const relationshipHash = sha256Value(
    speakerEvidence.components.map((component) => ({
      componentId: component.componentId,
      selectedRelationship: component.selectedRelationship,
      resolutionStatus: component.resolutionStatus,
    })),
  );
  const previousReconciliation = JSON.parse(
    await readFile(reconciliationPath, "utf8"),
  ) as Record<string, unknown>;
  const reconciliationBase = {
    ...previousReconciliation,
    generatedAt: new Date().toISOString(),
    speakerEvidenceArtifactHash: speakerEvidenceHash,
    speakerRuntimeIdentityHash: capability.runtimeIdentityHash,
    speakerModelSnapshotHash: capability.modelSnapshotHash,
    speakerEvidencePolicyVersion: "c5.18-local-speaker-evidence-v1",
    speakerAssignmentHash: assignmentHash,
    speakerRelationshipHash: relationshipHash,
  };
  const reconciliation = {
    ...reconciliationBase,
    semanticHash: sha256Value({
      ...reconciliationBase,
      generatedAt: null,
      semanticHash: null,
    }),
  };
  await atomicWriteJson(reconciliationPath, reconciliation, {
    overwrite: true,
  });
  const reconciliationHash = await sha256File(reconciliationPath);

  const newReviewVersion = `review-v4-${sha256Value({
    previousReviewVersion: sourceReviewPackage.reviewVersion,
    speakerEvidenceArtifactHash: speakerEvidenceHash,
    speakerRuntimeIdentityHash: capability.runtimeIdentityHash,
    speakerModelSnapshotHash: capability.modelSnapshotHash,
    speakerAssignmentHash: assignmentHash,
    speakerRelationshipHash: relationshipHash,
  }).slice(0, 24)}`;
  const reviewItems = sourceReviewPackage.items.map((item) => ({
    ...item,
    speakerEvidenceComponentId:
      item.audioSourceComponentId ??
      item.forcedAlignmentEvidence?.componentId ??
      item.reviewId,
  }));
  const boundItems = bindReviewCandidates({
    items: reviewItems,
    inputEvidenceHash: sourceReviewPackage.inputEvidenceHash,
    reviewVersion: newReviewVersion,
  });
  const outputReviewPackage = subtitleReviewPackageSchema.parse({
    ...sourceReviewPackage,
    reviewVersion: newReviewVersion,
    generatedAt: new Date().toISOString(),
    baseCueHash: sha256Value(outputCues),
    evidenceReconciliationHash: reconciliationHash,
    speakerEvidenceArtifactPath: "./subtitle-local-speaker-evidence.json",
    speakerEvidenceArtifactHash: speakerEvidenceHash,
    speakerRuntimeIdentityHash: capability.runtimeIdentityHash,
    speakerModelSnapshotHash: capability.modelSnapshotHash,
    speakerEvidencePolicyVersion: "c5.18-local-speaker-evidence-v1",
    speakerAssignmentHash: assignmentHash,
    speakerRelationshipHash: relationshipHash,
    items: boundItems,
  });
  await atomicWriteJson(reviewPackagePath, outputReviewPackage, {
    overwrite: true,
  });
  await writeSubtitleReviewPage({
    subtitleDirectory,
    reviewPackage: outputReviewPackage,
    speakerEvidence,
    timelineEnabled: true,
  });
  const outputReviewPackageHash = await sha256File(reviewPackagePath);
  const reviewActionReport = buildReviewActionValidationReport({
    mode: actionMode,
    sourceReviewPackage,
    targetReviewPackage: outputReviewPackage,
    targetReviewPackageHash: outputReviewPackageHash,
    legacyShortcutRoutePresent: false,
  });
  await atomicWriteJson(reviewActionReportPath, reviewActionReport, {
    overwrite: true,
  });

  const finalizationReport = subtitleFinalizationReportSchema.parse({
    ...sourceFinalizationReport,
    finalizationVersion: "C5.18-local-speaker-activity-evidence-v1",
    generatedAt: new Date().toISOString(),
    status: "needs-review",
    finalizationMethod: "none",
    outputCueHash: sha256Value(outputCues),
    outputHash: sha256Value(quality.serialized),
    metrics: {
      ...sourceFinalizationReport.metrics,
      safeAutomaticMutationCount: timingMutations.length,
      automaticTimingMutationDecisionCount: timingMutations.length,
      finalCueCount: outputCues.length,
      timingCorrectionRate: timingMutations.length / outputCues.length,
      speakerTargetComponentCount: speakerEvidence.summary.targetComponentCount,
      speakerTargetCueCount: speakerEvidence.summary.targetCueCount,
      speakerInferenceCount: pipelineInferenceCount,
      speakerCacheHitCount: cacheManifest.summary.hitCount,
      speakerModelLoadCount: modelLoadCount,
      speakerStableComponentCount: speakerEvidence.summary.stableComponentCount,
      speakerResolvedComponentCount:
        speakerEvidence.summary.resolvedComponentCount,
      speakerPresentationOnlyComponentCount:
        speakerEvidence.summary.presentationOnlyComponentCount,
      speakerTimingOnlyComponentCount:
        speakerEvidence.summary.timingOnlyComponentCount,
      speakerUnresolvedComponentCount:
        speakerEvidence.summary.unresolvedComponentCount,
      duplicateSpeakerEvidenceLineageCount:
        speakerEvidence.summary.duplicateSpeakerEvidenceLineageCount,
      speakerEvidenceDoubleCountPreventedCount:
        speakerEvidence.summary.speakerEvidenceDoubleCountPreventedCount,
      speakerConfidenceFabricatedCount: 0,
      crossComponentSpeakerLinkCount: 0,
      realPersonIdentificationCount: 0,
      rawEmbeddingInShareableCount: 0,
      forbiddenSpeakerIdentityEvidenceUseCount: 0,
      forbiddenSpeakerTimingHeuristicUseCount: 0,
    },
    qualityGate: {
      ...sourceFinalizationReport.qualityGate,
      finalIntegrityPassed: quality.finalIntegrityPassed,
      serializationRoundTripPassed: quality.serializationRoundTripPassed,
      formatSemanticParityPassed: quality.formatSemanticParityPassed,
      canonicalParityPassed: quality.canonicalParityPassed,
      presentationParityPassed: quality.presentationParityPassed,
    },
    outputPaths: {
      ...sourceFinalizationReport.outputPaths,
      speakerRuntimeCapability: "speaker-evidence-runtime-capability.json",
      localSpeakerEvidence: "subtitle-local-speaker-evidence.json",
      speakerEvidenceCacheManifest: "speaker-evidence-cache-manifest.json",
      reviewActionValidationReport: "review-action-validation-report.json",
    },
  });
  await atomicWriteJson(finalizationReportPath, finalizationReport, {
    overwrite: true,
  });
  const outputTimingHash = sha256Value(
    outputCues.map((cue) => ({ id: cue.id, start: cue.start, end: cue.end })),
  );
  const delivery = await writeReviewDeliveryIntegrity({
    mode: "enforce",
    sourceTaskName: path.basename(sourceTask),
    subtitleDirectory,
    sourceReviewPackageHash,
    sourceFinalizationReportHash,
    baseTimingHash: outputTimingHash,
    canonicalCueHashUnchanged: true,
    canonicalTimingHashUnchanged: true,
  });
  if (delivery.artifact === null || delivery.path === null) {
    throw new InputError("C5.18 review delivery artifact was not produced.");
  }

  const sourceCriticalAfter = await criticalHashes(
    sourceLocated.subtitleDirectory,
  );
  const sourceTaskCriticalArtifactsReadOnly =
    sha256Value(sourceCriticalBefore) === sha256Value(sourceCriticalAfter);
  const sourceVideoAfter =
    sourceVideo === null ? null : await fingerprint(sourceVideo);
  const humanSubtitleAfter =
    humanSubtitle === null ? null : await fingerprint(humanSubtitle);
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
    throw new InputError("A read-only C5.18 input changed during replay.");
  }
  const skill2ReportPath = path.join(
    stagingTask,
    "skill2-compatibility",
    "grammar-report.json",
  );
  const skill2 = JSON.parse(await readFile(skill2ReportPath, "utf8")) as {
    sentences?: unknown[];
  };
  const skill2CompatibilityPassed = skill2.sentences?.length === 106;
  const skill3CompatibilityPassed = await exists(
    path.join(stagingTask, "skill3-compatibility", "site", "index.html"),
  );
  const summaryBase = {
    schemaVersion: "1.0.0" as const,
    artifactType: "c5-18-speaker-evidence-replay-summary" as const,
    replayVersion: "C5.18" as const,
    generatedAt: new Date().toISOString(),
    runId: `c5-18-${randomUUID()}`,
    sourceTaskName: path.basename(sourceTask),
    outputTaskName: path.basename(outputTask),
    reviewActionHardening: actionMode,
    speakerEvidenceMode: speakerMode,
    speakerPresentationResolution: presentationMode,
    cacheMode,
    runtimeCapabilityHash: capabilityHash,
    speakerEvidenceArtifactHash: speakerEvidenceHash,
    cacheManifestHash,
    reviewActionValidationReportHash: await sha256File(reviewActionReportPath),
    reviewDeliveryIntegrityHash: await sha256File(delivery.path),
    sourceReviewPackageHash,
    outputReviewPackageHash,
    canonicalCueHashBefore: baseCueHash,
    canonicalCueHashAfter: sha256Value(outputCues),
    canonicalTimingHashBefore: baseTimingHash,
    canonicalTimingHashAfter: outputTimingHash,
    presentationHashBefore,
    presentationHashAfter,
    componentDecisionHash: speakerEvidence.componentDecisionHash,
    mutationHash: speakerEvidence.mutationHash,
    sourceTaskCriticalArtifactsReadOnly,
    sourceVideoReadOnly,
    humanSubtitleReadOnly,
    execution: {
      speakerInferenceCount: pipelineInferenceCount,
      speakerModelLoadCount: modelLoadCount,
      wholeMediaSpeakerInferenceCount: 0 as const,
      wholeMediaAsrRequestCount: 0 as const,
      whisperRequestCount: 0 as const,
      mfaProcessCount: 0 as const,
      openAiRequestCount: 0 as const,
      onlineSubtitleSearchCount: 0 as const,
      networkUsedDuringInference: false as const,
    },
    outcome: {
      speakerRuntimeIdentityVerified: true,
      speakerModelSnapshotVerified: true,
      targetComponentCount: speakerEvidence.summary.targetComponentCount,
      targetCueCount: speakerEvidence.summary.targetCueCount,
      reviewItemCountBefore: sourceReviewPackage.items.length,
      reviewItemCountAfter: outputReviewPackage.items.length,
      reviewAudioPlayableCount:
        delivery.artifact.summary.reviewAudioPlayableCount,
      reviewDeliveryIntegrityPassed:
        delivery.artifact.summary.reviewDeliveryIntegrityPassed,
      cueCount: outputCues.length,
      canonicalTextMutationCount: 0 as const,
      timingMutationCount: timingMutations.length,
      finalStatus: "needs-review" as const,
      finalizationMethod: "none" as const,
      skill2CompatibilityPassed,
      skill3CompatibilityPassed,
    },
  };
  const summary = c518SpeakerEvidenceReplaySummarySchema.parse({
    ...summaryBase,
    semanticHash: sha256Value({ ...summaryBase, generatedAt: null }),
  });
  const summaryPath = path.join(
    stagingTask,
    "c5-18-speaker-evidence-replay-summary.json",
  );
  await atomicWriteJson(summaryPath, summary, { overwrite: true });

  const sourceShareable = path.join(sourceTask, "shareable");
  await generateC5161ShareableArtifacts({
    taskRoot: stagingTask,
    subtitleDirectory,
    localExecutionSummaryPath: summaryPath,
    stockPatchedRuntimeAbPath: path.join(
      sourceShareable,
      "c5-16-stock-patched-runtime-ab.json",
    ),
    outputDirectory: path.join(stagingTask, "shareable"),
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
        subtitleDirectory,
        "forced-alignment-runtime-capability.json",
      ),
      canonicalInputPath: path.join(
        subtitleDirectory,
        "subtitle-canonical-alignment-input.json",
      ),
      forcedAlignmentPath,
      replaySummaryPath: path.join(
        stagingTask,
        "c5-17-forced-alignment-replay-summary.json",
      ),
      pronunciationPath: path.join(
        subtitleDirectory,
        "subtitle-canonical-pronunciation.json",
      ),
      sudachiRuntimeCapabilityPath: path.join(
        subtitleDirectory,
        "sudachi-runtime-capability.json",
      ),
      cacheManifestPath: path.join(
        subtitleDirectory,
        "forced-alignment-cache-manifest.json",
      ),
      runtimePreparationSummaryPath: path.join(
        sourceShareable,
        "c5-17-1-runtime-preparation-summary.json",
      ),
      freshCacheObserveValidationPath: path.join(
        stagingTask,
        "c5-17-1-fresh-cache-observe-validation.json",
      ),
    },
    c5172Artifacts: {
      deliveryIntegrityPath: delivery.path,
      replaySummaryPath: path.join(
        stagingTask,
        "c5-17-2-review-delivery-replay-summary.json",
      ),
      reviewActionValidationReportPath: reviewActionReportPath,
    },
    c518Artifacts: {
      runtimeCapabilityPath: capabilityPath,
      localSpeakerEvidencePath: speakerEvidencePath,
      replaySummaryPath: summaryPath,
    },
  });
  const shareableAudit = await auditC5161ShareableArtifacts(
    path.join(stagingTask, "shareable"),
  );
  if (!shareableAudit.validationPassed) {
    throw new InputError("C5.18 shareable/privacy audit failed.");
  }
  if (await exists(outputTask)) {
    throw new InputError(
      `Replay output appeared during staging: ${outputTask}`,
    );
  }
  await rename(stagingTask, outputTask);
  completed = true;
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        outputTask,
        subtitleDirectory: path.join(
          outputTask,
          path.relative(stagingTask, subtitleDirectory),
        ),
        runtimeCapability: path.join(
          outputTask,
          path.relative(stagingTask, capabilityPath),
        ),
        speakerEvidence: path.join(
          outputTask,
          path.relative(stagingTask, speakerEvidencePath),
        ),
        cacheManifest: path.join(
          outputTask,
          path.relative(stagingTask, cacheManifestPath),
        ),
        replaySummary: path.join(
          outputTask,
          path.relative(stagingTask, summaryPath),
        ),
        metrics: {
          targetComponentCount: speakerEvidence.summary.targetComponentCount,
          targetCueCount: speakerEvidence.summary.targetCueCount,
          pipelineInferenceCount,
          cacheHitCount: cacheManifest.summary.hitCount,
          modelLoadCount,
          timingMutationCount: timingMutations.length,
          reviewAudioPlayableCount:
            delivery.artifact.summary.reviewAudioPlayableCount,
          reviewDeliveryIntegrityPassed:
            delivery.artifact.summary.reviewDeliveryIntegrityPassed,
        },
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await runtimeState.worker?.close();
  await rm(temporaryAudio, { recursive: true, force: true });
  if (!completed) {
    await rm(stagingTask, { recursive: true, force: true });
  }
}
