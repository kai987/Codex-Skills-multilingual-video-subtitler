import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  InputError,
  atomicWriteJson,
  speakerCacheModeSchema,
  speakerDeviceSchema,
  subtitleFinalizationReportSchema,
  subtitlePackageSchema,
  subtitlePresentationResolutionSchema,
  subtitleReviewPackageSchema,
  type SubtitleReviewPackage,
} from "@mvl/shared";
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
  buildSpeakerRuntimeCapability,
  cropReviewWavFrames,
  inspectReviewWav,
  loadAndVerifySpeakerRuntime,
  locateSubtitlePackage,
  sha256Value,
  type RawSpeakerAttemptInput,
  type RawSpeakerInference,
  type SpeakerPcmWindow,
  type SpeakerWorkerReady,
} from "@mvl/video-subtitler";

const { values } = parseArgs({
  options: {
    task: { type: "string" },
    "speaker-runtime-manifest": { type: "string" },
    "speaker-model-manifest": { type: "string" },
    "speaker-cache-dir": { type: "string" },
    "speaker-cache-mode": { type: "string", default: "read-write" },
    "speaker-device": { type: "string", default: "auto" },
    "maximum-components": { type: "string", default: "7" },
  },
  strict: true,
});

if (
  values.task === undefined ||
  values["speaker-runtime-manifest"] === undefined
) {
  throw new InputError(
    "Usage: npm run replay:c6-0-1-1-machine-speaker -- --task <machine task> --speaker-runtime-manifest <json> [--speaker-model-manifest <json>]",
  );
}

const maximumComponents = Number(values["maximum-components"]);
if (
  !Number.isInteger(maximumComponents) ||
  maximumComponents < 1 ||
  maximumComponents > 7
) {
  throw new InputError("--maximum-components must be an integer from 1 to 7.");
}

async function sha256File(filePath: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

function resolveInside(root: string, relativePath: string): string {
  const resolved = path.resolve(root, relativePath);
  const relation = path.relative(root, resolved);
  if (
    relation === ".." ||
    relation.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relation)
  ) {
    throw new InputError(`Artifact path escapes task root: ${relativePath}`);
  }
  return resolved;
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

function componentId(
  item: SubtitleReviewPackage["items"][number],
): string | null {
  return (
    item.audioSourceComponentId ??
    item.forcedAlignmentEvidence?.componentId ??
    item.speakerEvidenceComponentId
  );
}

const taskDirectory = path.resolve(values.task);
const located = await locateSubtitlePackage(taskDirectory);
const subtitleDirectory = located.subtitleDirectory;
const runtimeManifestPath = path.resolve(values["speaker-runtime-manifest"]);
const modelManifestPath = path.resolve(
  values["speaker-model-manifest"] ??
    path.join(path.dirname(runtimeManifestPath), "speaker-model-manifest.json"),
);
const cacheMode = speakerCacheModeSchema.parse(values["speaker-cache-mode"]);
const deviceRequested = speakerDeviceSchema.parse(values["speaker-device"]);
const verifiedRuntime = await loadAndVerifySpeakerRuntime({
  runtimeManifestPath,
  modelManifestPath,
});

const reviewPackagePath = path.join(
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
const forcedAlignmentPath = path.join(
  subtitleDirectory,
  "subtitle-canonical-forced-alignment.json",
);
const overlapAcousticPath = path.join(
  subtitleDirectory,
  "subtitle-overlap-acoustic-resolution.json",
);
const [reviewPackage, finalization, presentation] = await Promise.all([
  readFile(reviewPackagePath, "utf8").then((value) =>
    subtitleReviewPackageSchema.parse(JSON.parse(value) as unknown),
  ),
  readFile(finalizationPath, "utf8").then((value) =>
    subtitleFinalizationReportSchema.parse(JSON.parse(value) as unknown),
  ),
  readFile(presentationPath, "utf8").then((value) =>
    subtitlePresentationResolutionSchema.parse(JSON.parse(value) as unknown),
  ),
]);
const packagePath = resolveInside(
  subtitleDirectory,
  finalization.outputPaths.subtitlePackage,
);
const subtitlePackage = subtitlePackageSchema.parse(
  JSON.parse(await readFile(packagePath, "utf8")) as unknown,
);
if (
  finalization.status !== "needs-review" ||
  finalization.finalizationMethod !== "none"
) {
  throw new InputError(
    "Machine speaker evidence requires a blocked review task.",
  );
}
for (const requiredPath of [forcedAlignmentPath, overlapAcousticPath]) {
  await readFile(requiredPath);
}

const overlapCueSets = presentation.overlapDecisions
  .filter((decision) => decision.blocking)
  .map((decision) => new Set(decision.cueIds));
const uniqueByComponent = new Map<
  string,
  SubtitleReviewPackage["items"][number]
>();
for (const item of [...reviewPackage.items].toSorted((left, right) =>
  left.reviewId.localeCompare(right.reviewId),
)) {
  const id = componentId(item);
  const overlapsMachineComponent = overlapCueSets.some((cueIds) =>
    item.targetCueIds.some((cueId) => cueIds.has(cueId)),
  );
  if (
    id !== null &&
    overlapsMachineComponent &&
    item.forcedAlignmentEvidence !== undefined &&
    item.audioClipPath !== null &&
    item.audioSha256 !== null &&
    item.audioExtractedInterval !== null &&
    !uniqueByComponent.has(id)
  ) {
    uniqueByComponent.set(id, item);
  }
}
const targetItems = [...uniqueByComponent.values()].slice(0, maximumComponents);
if (targetItems.length === 0) {
  throw new InputError(
    "No machine overlap review component has verified local review audio.",
  );
}

const runtimeState: {
  worker: LocalSpeakerWorker | null;
  ready: SpeakerWorkerReady | null;
} = { worker: null, ready: null };
let modelLoadCount = 0;
let pipelineInferenceCount = 0;
let sampleInference: RawSpeakerInference | null = null;
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
const deviceUsed = runtimeState.ready?.deviceUsed;
if (deviceUsed === undefined) {
  throw new InputError(
    "A fresh machine speaker run requires a started worker.",
  );
}
const cacheRoot = path.resolve(
  values["speaker-cache-dir"] ??
    path.join(homedir(), ".cache", "mvl", "c6-0-1-1-speaker-cache"),
);
const cache = new SpeakerEvidenceCache({ root: cacheRoot, mode: cacheMode });
const temporaryAudio = await mkdtemp(
  path.join(tmpdir(), "mvl-c6-0-1-1-speaker-"),
);
const rawAttempts: RawSpeakerAttemptInput[] = [];
const pcmByComponent = new Map<string, SpeakerPcmWindow>();
const dependencyModelHashes = verifiedRuntime.model.dependencyModelSnapshots
  .map((snapshot) => snapshot.modelSnapshotHash)
  .toSorted();

try {
  for (const item of targetItems) {
    const id = componentId(item);
    if (
      id === null ||
      item.audioClipPath === null ||
      item.audioSha256 === null ||
      item.audioExtractedInterval === null
    ) {
      throw new InputError(`Incomplete machine review item: ${item.reviewId}`);
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
      id,
      pcmWindow(audioBuffer, item.audioExtractedInterval.start),
    );
    const unionInterval = item.componentUnionInterval ?? item.interval;
    const localUnion = {
      start: unionInterval.start - item.audioExtractedInterval.start,
      end: unionInterval.end - item.audioExtractedInterval.start,
    };
    if (
      localUnion.start < -0.001 ||
      localUnion.end > wav.actualDurationSeconds + 0.001 ||
      localUnion.end <= localUnion.start
    ) {
      throw new InputError(`Review WAV does not cover ${id}.`);
    }
    const unionPath = path.join(temporaryAudio, `${item.reviewId}-union.wav`);
    const union = await cropReviewWavFrames({
      sourcePath: audioPath,
      targetPath: unionPath,
      startSeconds: Math.max(0, localUnion.start),
      endSeconds: Math.min(wav.actualDurationSeconds, localUnion.end),
    });
    const maximumSpeakers = Math.max(1, Math.min(3, item.targetCueIds.length));
    for (const windowType of ["context", "union"] as const) {
      const context = windowType === "context";
      const audioSha256 = context ? item.audioSha256 : union.sha256;
      const audioLocalInterval = context
        ? { start: 0, end: wav.actualDurationSeconds }
        : localUnion;
      const mediaGlobalInterval = context
        ? item.audioExtractedInterval
        : unionInterval;
      const attemptId = `speaker-attempt-${sha256Value({
        id,
        windowType,
        audioSha256,
      }).slice(0, 20)}`;
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
        minSpeakers: 1,
        maxSpeakers: maximumSpeakers,
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
        const worker = await ensureWorker();
        inference = await worker.infer({
          audioPath: context ? audioPath : unionPath,
          minSpeakers: 1,
          maxSpeakers: maximumSpeakers,
        });
        pipelineInferenceCount += 1;
        await cache.put({ identity, inference });
      }
      sampleInference ??= inference;
      rawAttempts.push({
        componentId: id,
        windowType,
        audioPath: `./review/${path.basename(audioPath)}`,
        audioSha256,
        audioLocalInterval,
        mediaGlobalInterval,
        runtimeIdentityHash: verifiedRuntime.runtime.runtimeIdentityHash,
        modelSnapshotHash: verifiedRuntime.model.modelSnapshotHash,
        device: deviceUsed,
        minSpeakers: 1,
        maxSpeakers: maximumSpeakers,
        cacheHit,
        inference,
      });
    }
  }

  if (sampleInference === null || runtimeState.ready === null) {
    throw new InputError(
      "Machine speaker runtime produced no sample inference.",
    );
  }
  const capability = buildSpeakerRuntimeCapability({
    runtime: verifiedRuntime.runtime,
    model: verifiedRuntime.model,
    ready: runtimeState.ready,
    inference: sampleInference,
    mpsCpuSemanticComparable: null,
  });
  const capabilityPath = path.join(
    subtitleDirectory,
    "speaker-evidence-runtime-capability.json",
  );
  await atomicWriteJson(capabilityPath, capability, { overwrite: true });
  const evidence = analyzeLocalSpeakerEvidence({
    mode: "observe",
    reviewPackage,
    baseTimingHash: sha256Value(
      subtitlePackage.cues.map((cue) => ({
        id: cue.id,
        start: cue.start,
        end: cue.end,
      })),
    ),
    runtimeCapabilityRef: {
      path: "./speaker-evidence-runtime-capability.json",
      sha256: await sha256File(capabilityPath),
    },
    reviewPackageRef: {
      path: "./subtitle-review-package.json",
      sha256: await sha256File(reviewPackagePath),
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
    minimumSpeakers: 1,
    maximumSpeakers: 3,
  });
  const evidencePath = path.join(
    subtitleDirectory,
    "subtitle-local-speaker-evidence.json",
  );
  await atomicWriteJson(evidencePath, evidence, { overwrite: true });
  const cacheManifest = cache.manifest({
    inferenceCount: pipelineInferenceCount,
    modelLoadCount,
  });
  const cacheManifestPath = path.join(
    subtitleDirectory,
    "speaker-evidence-cache-manifest.json",
  );
  await atomicWriteJson(cacheManifestPath, cacheManifest, { overwrite: true });
  const summary = {
    schemaVersion: "1.0.0",
    artifactType: "c6-0-1-1-machine-speaker-run",
    generatedAt: new Date().toISOString(),
    taskDirectory,
    targetComponentCount: evidence.summary.targetComponentCount,
    targetCueCount: evidence.summary.targetCueCount,
    pipelineInferenceCount,
    cacheHitCount: cacheManifest.summary.hitCount,
    modelLoadCount,
    resolvedComponentCount: evidence.summary.resolvedComponentCount,
    timingMutationCount: 0,
    canonicalTextMutationCount: 0,
    productionStatus: "needs-review",
    finalizationMethod: "none",
  };
  await atomicWriteJson(
    path.join(taskDirectory, "c6-0-1-1-machine-speaker-run.json"),
    summary,
    { overwrite: true },
  );
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} finally {
  await runtimeState.worker?.close();
  await rm(temporaryAudio, { recursive: true, force: true });
}
