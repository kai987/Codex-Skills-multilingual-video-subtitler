import { createHash, randomUUID } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  InputError,
  atomicWriteFile,
  atomicWriteJson,
  c5181CtcBoundaryReplaySummarySchema,
  ctcAlignmentCacheIdentitySchema,
  ctcBoundaryModeSchema,
  ctcCacheModeSchema,
  ctcDeviceSchema,
  ctcRuntimeCapabilitySchema,
  sourceSeparationFallbackSchema,
  subtitleCanonicalAlignmentInputSchema,
  subtitleFinalizationReportSchema,
  subtitleLocalSeparatedStreamEvidenceSchema,
  subtitleLocalSpeakerEvidenceSchema,
  subtitleCtcAlignmentInputSchema,
  subtitlePackageSchema,
  subtitlePresentationResolutionSchema,
  subtitleReviewPackageSchema,
  type CtcAlignmentAttempt,
  type CtcRuntimeCapability,
  type CtcTargetEncoding,
  type SubtitleReviewPackage,
} from "@mvl/shared";
import type { AssEventOverride } from "@mvl/subtitle-core";
import { buildPresentationCueHash } from "@mvl/transcription-core";
import {
  CTC_ALIGNMENT_POLICY,
  CTC_FRAME_MAPPING_POLICY,
  CTC_MODEL_REPO,
  CTC_MODEL_REVISION,
  CTC_VITERBI_POLICY,
  CtcAlignmentCache,
  LocalCtcWorker,
  LocalSourceSeparationWorker,
  SOURCE_SEPARATION_POLICY,
  applyCtcTimingMutations,
  assessSeparatedStreams,
  auditC5161ShareableArtifacts,
  bindReviewCandidates,
  buildLocalCtcBoundaryEvidence,
  buildSubtitleCtcAlignmentInput,
  cropReviewWavFrames,
  evaluateFinalCueQuality,
  generateC5161ShareableArtifacts,
  inspectReviewWav,
  loadAndVerifyCtcRuntime,
  locateSubtitlePackage,
  loadSeparatedPcm,
  normalizeCtcAlignmentText,
  sha256Value,
  selectSourceSeparationTriggers,
  writeReviewDeliveryIntegrity,
  writeSubtitleReviewPage,
  type CtcCueEvidenceInput,
} from "@mvl/video-subtitler";

const { values } = parseArgs({
  options: {
    task: { type: "string" },
    output: { type: "string" },
    "ctc-runtime-manifest": { type: "string" },
    "ctc-model-manifest": { type: "string" },
    "ctc-runtime-capability": { type: "string" },
    "ctc-alignment-input-import": { type: "string" },
    "ctc-boundary": { type: "string", default: "enforce" },
    "ctc-device": { type: "string", default: "auto" },
    "ctc-cache-dir": { type: "string" },
    "ctc-cache-import": { type: "string", multiple: true },
    "ctc-cache-mode": { type: "string", default: "read-write" },
    "ctc-separation-fallback": { type: "string", default: "observe" },
  },
  strict: true,
});

if (
  values.task === undefined ||
  values.output === undefined ||
  values["ctc-runtime-manifest"] === undefined
) {
  throw new InputError(
    "Usage: npm run replay:c5-18-1-ctc-boundary -- --task <C5.18 Fresh> --output <new task> --ctc-runtime-manifest <json> [--ctc-model-manifest <json>]",
  );
}

const sourceTask = path.resolve(values.task);
const outputTask = path.resolve(values.output);
const stagingTask = path.join(
  path.dirname(outputTask),
  `.${path.basename(outputTask)}.staging-${randomUUID()}`,
);
const runtimeManifestPath = path.resolve(values["ctc-runtime-manifest"]);
const modelManifestPath = path.resolve(
  values["ctc-model-manifest"] ??
    path.join(path.dirname(runtimeManifestPath), "ctc-model-manifest.json"),
);
const capabilityInputPath = path.resolve(
  values["ctc-runtime-capability"] ??
    path.join(path.dirname(runtimeManifestPath), "ctc-runtime-capability.json"),
);
const mode = ctcBoundaryModeSchema.parse(values["ctc-boundary"]);
const deviceRequested = ctcDeviceSchema.parse(values["ctc-device"]);
const cacheMode = ctcCacheModeSchema.parse(values["ctc-cache-mode"]);
const separationMode = sourceSeparationFallbackSchema.parse(
  values["ctc-separation-fallback"],
);
type SubtitleReviewItem = SubtitleReviewPackage["items"][number];

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

function targetComponentId(item: SubtitleReviewItem): string {
  const value =
    item.audioSourceComponentId ??
    item.forcedAlignmentEvidence?.componentId ??
    item.speakerEvidenceComponentId;
  if (value === null || value.length === 0) {
    throw new InputError(`Review item ${item.reviewId} has no component ID.`);
  }
  return value;
}

function sameCueSet(left: readonly string[], right: readonly string[]) {
  const orderedLeft = [...left].toSorted();
  const orderedRight = [...right].toSorted();
  return (
    orderedLeft.length === orderedRight.length &&
    orderedLeft.every((cueId, index) => cueId === orderedRight[index])
  );
}

function seedInterval(
  item: SubtitleReviewItem,
  cueId: string,
): { start: number; end: number } {
  const cue = item.forcedAlignmentEvidence?.cues.find(
    (value) => value.cueId === cueId,
  );
  if (cue === undefined) {
    throw new InputError(`Review item ${item.reviewId} lacks cue ${cueId}.`);
  }
  const selectedSafe =
    cue.suggestedTiming !== null &&
    !cue.antiForcingBlockers.some((blocker) =>
      [
        "ALIGNMENT_PINNED_TO_WINDOW_EDGE",
        "ALIGNMENT_WINDOW_UNSTABLE",
        "FORCED_ALIGNMENT_SILENCE_INTRUSION",
        "NEIGHBOR_CUE_INTRUSION",
      ].includes(blocker),
    );
  if (selectedSafe && cue.suggestedTiming !== null) return cue.suggestedTiming;
  if (cue.evidenceDpBoundary !== null) return cue.evidenceDpBoundary;
  return cue.originalTiming;
}

function cacheIdentity(input: {
  attempt: Pick<
    CtcAlignmentAttempt,
    "target" | "audioLocalInterval" | "mediaGlobalInterval" | "windowType"
  >;
  audioSha256: string;
  sourceFrameStart: number;
  sourceFrameEndExclusive: number;
  runtimeIdentityHash: string;
  modelSnapshotHash: string;
  tokenizerIdentityHash: string;
  deviceUsed: "mps" | "cpu";
}) {
  return ctcAlignmentCacheIdentitySchema.parse({
    requestType: "local-ctc-boundary-alignment",
    audioSha256: input.audioSha256,
    audioFrameInterval: {
      startFrame: input.sourceFrameStart,
      endFrameExclusive: input.sourceFrameEndExclusive,
    },
    targetTextSha256: input.attempt.target.targetTextSha256,
    targetTokenIdsSha256: sha256Value(input.attempt.target.tokenIds),
    windowType: input.attempt.windowType,
    audioLocalInterval: input.attempt.audioLocalInterval,
    mediaGlobalInterval: input.attempt.mediaGlobalInterval,
    sampleRate: 16_000,
    runtimeIdentityHash: input.runtimeIdentityHash,
    modelRepo: CTC_MODEL_REPO,
    modelRevision: CTC_MODEL_REVISION,
    modelSnapshotHash: input.modelSnapshotHash,
    tokenizerIdentityHash: input.tokenizerIdentityHash,
    device: input.deviceUsed,
    alignmentPolicyVersion: CTC_ALIGNMENT_POLICY,
    normalizationPolicyVersion: "c5.18.1-ctc-target-normalization-v1",
    viterbiPolicy: CTC_VITERBI_POLICY,
    frameMappingPolicy: CTC_FRAME_MAPPING_POLICY,
  });
}

function independentEvidence(
  item: SubtitleReviewItem,
  cueId: string,
  speakerComponent: ReturnType<
    typeof subtitleLocalSpeakerEvidenceSchema.parse
  >["components"][number],
) {
  const cue = item.forcedAlignmentEvidence?.cues.find(
    (value) => value.cueId === cueId,
  );
  if (cue === undefined) throw new InputError(`Missing evidence for ${cueId}.`);
  const mappedIds = [
    ...item.boundaryEvidence,
    ...item.componentMappedTokenEvidence,
  ]
    .filter(
      (evidence) =>
        (evidence.cueIds.includes(cueId) || evidence.cueIds.length === 0) &&
        ["trusted-mapped-token", "trusted-no-vad-token"].includes(
          evidence.sourceType,
        ),
    )
    .map((evidence) => evidence.evidenceId);
  return {
    mfaBoundary: cue.suggestedTiming,
    mfaStartEvidenceIds:
      cue.suggestedTiming === null ? [] : [`mfa:${cueId}:start`],
    mfaEndEvidenceIds: cue.suggestedTiming === null ? [] : [`mfa:${cueId}:end`],
    mfaValid:
      cue.suggestedTiming !== null && cue.antiForcingBlockers.length === 0,
    mappedTokenBoundary: cue.mappedTokenBoundary,
    mappedTokenEvidenceIds: mappedIds,
    evidenceDpBoundary: cue.evidenceDpBoundary,
    rawVadBoundary: cue.rawVadBoundary,
    speakerBoundary: null,
    speakerEvidenceIds: [speakerComponent.semanticHash],
    speakerContradiction:
      speakerComponent.selectedRelationship === "speaker-evidence-conflict",
  };
}

interface SeparationStreamCacheResult {
  streamId: "stream-a" | "stream-b";
  label: "Candidate Stream A" | "Candidate Stream B";
  audioSha256: string;
  durationSeconds: number;
  rmsDbfs: number | null;
  nonSilentDurationSeconds: number;
  finiteSampleCheck: boolean;
  lengthParity: boolean;
  correlationWithMixture: number | null;
  zeroStream: boolean;
  highCorrelation: boolean;
  lengthMismatch: boolean;
}

interface SeparationCacheEntry {
  schemaVersion: "1.0.0";
  artifactType: "source-separation-cache-entry";
  cacheKey: string;
  identity: {
    inputAudioSha256: string;
    runtimeIdentityHash: string;
    modelSnapshotHash: string;
    sampleRate: 16_000;
    policyVersion: typeof SOURCE_SEPARATION_POLICY;
  };
  result: {
    streams: [SeparationStreamCacheResult, SeparationStreamCacheResult];
    streamCorrelation: number | null;
    mixtureReconstructionError: number | null;
    qualityStatus: "usable-observe-only" | "unreliable";
    qualityBlockers: string[];
  };
  semanticHash: string;
}

function pearson(left: readonly number[], right: readonly number[]) {
  if (left.length === 0 || left.length !== right.length) return null;
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let numerator = 0;
  let leftPower = 0;
  let rightPower = 0;
  for (let index = 0; index < left.length; index += 1) {
    const l = (left[index] ?? 0) - leftMean;
    const r = (right[index] ?? 0) - rightMean;
    numerator += l * r;
    leftPower += l * l;
    rightPower += r * r;
  }
  const denominator = Math.sqrt(leftPower * rightPower);
  return denominator <= Number.EPSILON ? null : numerator / denominator;
}

async function readSeparationCacheEntry(
  roots: readonly string[],
  cacheKey: string,
): Promise<SeparationCacheEntry | null> {
  for (const root of roots) {
    const filePath = path.join(
      root,
      "source-separation",
      cacheKey.slice(0, 2),
      `${cacheKey}.json`,
    );
    try {
      const value = JSON.parse(
        await readFile(filePath, "utf8"),
      ) as SeparationCacheEntry;
      if (
        value.cacheKey !== cacheKey ||
        value.semanticHash !==
          sha256Value({ identity: value.identity, result: value.result })
      ) {
        throw new InputError("Source-separation cache identity mismatch.");
      }
      return value;
    } catch (error) {
      if (
        error !== null &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code?: unknown }).code === "ENOENT"
      ) {
        continue;
      }
      throw error;
    }
  }
  return null;
}

async function writeSeparationCacheEntry(
  root: string,
  entry: SeparationCacheEntry,
): Promise<void> {
  const filePath = path.join(
    root,
    "source-separation",
    entry.cacheKey.slice(0, 2),
    `${entry.cacheKey}.json`,
  );
  await mkdir(path.dirname(filePath), { recursive: true });
  await atomicWriteJson(filePath, entry, { overwrite: true });
}

async function runSourceSeparation(input: {
  mode: "off" | "observe";
  items: readonly SubtitleReviewItem[];
  speaker: ReturnType<typeof subtitleLocalSpeakerEvidenceSchema.parse>;
  subtitleDirectory: string;
  temporaryDirectory: string;
  cacheRoot: string;
  cacheImportRoots: readonly string[];
  cacheMode: "off" | "read" | "read-write";
  ctcCache: CtcAlignmentCache;
  encodingByCueId: ReadonlyMap<string, CtcTargetEncoding>;
  capability: CtcRuntimeCapability;
  runtime: Awaited<ReturnType<typeof loadAndVerifyCtcRuntime>>;
  ensureCtcWorker: () => Promise<LocalCtcWorker>;
}) {
  const separationModel = input.runtime.model.separationModel;
  if (input.mode === "observe" && separationModel === null) {
    throw new InputError(
      "Source-separation observe acceptance requires the fixed SepFormer snapshot.",
    );
  }
  const separationRuntimeIdentityHash =
    separationModel === null
      ? null
      : sha256Value({
          runtimeIdentityHash: input.runtime.runtime.runtimeIdentityHash,
          speechbrainVersion: input.runtime.runtime.packages.find(
            (entry) => entry.name === "speechbrain",
          )?.version,
          policyVersion: SOURCE_SEPARATION_POLICY,
        });
  const triggers =
    input.mode === "off"
      ? []
      : selectSourceSeparationTriggers(
          input.speaker.components.map((component) => ({
            componentId: component.componentId,
            resolutionStatus: component.resolutionStatus,
            speakerTrackCount: component.speakerTracks.length,
            overlapSpeechIntervalCount: component.overlapSpeechIntervals.length,
          })),
        );
  const triggerById = new Map(
    triggers.map((trigger) => [trigger.componentId, trigger]),
  );
  let separationInferenceCount = 0;
  let separationCacheHitCount = 0;
  let separationModelLoadCount = 0;
  let separatedStreamCtcInferenceCount = 0;
  let separatedStreamCtcCacheHitCount = 0;
  let separatedStreamCtcAttemptCount = 0;
  const cacheRoots = [input.cacheRoot, ...input.cacheImportRoots];

  const ensureSeparationWorker = async () => {
    if (separationModel === null) {
      throw new InputError("SepFormer model manifest is missing.");
    }
    if (separationRuntimeState.worker === null) {
      separationRuntimeState.worker = new LocalSourceSeparationWorker({
        pythonExecutable: input.runtime.runtime.pythonExecutable,
        modelDirectory: separationModel.snapshotDirectory,
        workerScriptPath: path.resolve("scripts/runtime/separation_worker.py"),
        device: "cpu",
      });
      const ready = await separationRuntimeState.worker.start();
      separationModelLoadCount += ready.modelLoadCount;
    }
    return separationRuntimeState.worker;
  };

  const components = [];
  for (const item of [...input.items].toSorted((left, right) =>
    targetComponentId(left).localeCompare(targetComponentId(right)),
  )) {
    const componentId = targetComponentId(item);
    const trigger = triggerById.get(componentId);
    if (trigger === undefined) {
      const base = {
        componentId,
        cueIds: item.targetCueIds,
        triggered: false,
        triggerReasons: [],
        separationCacheHit: false,
        separationInferenceExecuted: false,
        streams: [],
        streamCorrelation: null,
        mixtureReconstructionError: null,
        qualityStatus: "not-triggered" as const,
        bestStreamByCue: Object.fromEntries(
          item.targetCueIds.map((cueId) => [cueId, null]),
        ),
        scoreMarginByCue: Object.fromEntries(
          item.targetCueIds.map((cueId) => [cueId, null]),
        ),
        qualityBlockers: [
          input.mode === "off"
            ? "SOURCE_SEPARATION_DISABLED"
            : "SOURCE_SEPARATION_TRIGGER_NOT_MET",
        ],
      };
      components.push({ ...base, semanticHash: sha256Value(base) });
      continue;
    }
    if (
      item.audioClipPath === null ||
      item.audioSha256 === null ||
      item.audioExtractedInterval === null
    ) {
      throw new InputError(`Separation review audio missing: ${item.reviewId}`);
    }
    const audioPath = resolveInside(
      input.subtitleDirectory,
      path.posix.join("review", item.audioClipPath),
    );
    if (separationModel === null || separationRuntimeIdentityHash === null) {
      throw new InputError("Source-separation model identity is unavailable.");
    }
    const identity = {
      inputAudioSha256: item.audioSha256,
      runtimeIdentityHash: separationRuntimeIdentityHash,
      modelSnapshotHash: separationModel.modelSnapshotHash,
      sampleRate: 16_000 as const,
      policyVersion: SOURCE_SEPARATION_POLICY,
    };
    const cacheKey = sha256Value(identity);
    let entry =
      input.cacheMode === "off"
        ? null
        : await readSeparationCacheEntry(cacheRoots, cacheKey);
    const separationCacheHit = entry !== null;
    let separationInferenceExecuted = false;
    const streamPathById = new Map<string, string>();
    if (entry !== null) {
      separationCacheHitCount += 1;
    } else {
      if (input.cacheMode === "read") {
        throw new InputError(
          `Required source-separation cache miss: ${componentId}`,
        );
      }
      const streamAPath = path.join(
        input.temporaryDirectory,
        `${componentId}-stream-a.wav`,
      );
      const streamBPath = path.join(
        input.temporaryDirectory,
        `${componentId}-stream-b.wav`,
      );
      const separationWorker = await ensureSeparationWorker();
      await separationWorker.separate({
        audioPath,
        outputA: streamAPath,
        outputB: streamBPath,
      });
      separationInferenceCount += 1;
      separationInferenceExecuted = true;
      streamPathById.set("stream-a", streamAPath);
      streamPathById.set("stream-b", streamBPath);
      const pcm = await loadSeparatedPcm({
        mixturePath: audioPath,
        streamAPath,
        streamBPath,
      });
      const quality = assessSeparatedStreams(pcm);
      const [streamABuffer, streamBBuffer] = await Promise.all([
        readFile(streamAPath),
        readFile(streamBPath),
      ]);
      const streamValues = [
        {
          id: "stream-a" as const,
          label: "Candidate Stream A" as const,
          buffer: streamABuffer,
          pcm: pcm.streamA,
          rms: quality.streamARms,
          nonSilent: quality.nonSilentDurationA,
        },
        {
          id: "stream-b" as const,
          label: "Candidate Stream B" as const,
          buffer: streamBBuffer,
          pcm: pcm.streamB,
          rms: quality.streamBRms,
          nonSilent: quality.nonSilentDurationB,
        },
      ] as const;
      const streamResults = streamValues.map((stream) => {
        const metadata = inspectReviewWav(stream.buffer);
        return {
          streamId: stream.id,
          label: stream.label,
          audioSha256: createHash("sha256").update(stream.buffer).digest("hex"),
          durationSeconds: metadata.actualDurationSeconds,
          rmsDbfs:
            stream.rms <= 0
              ? null
              : 20 * Math.log10(Math.max(1e-12, stream.rms)),
          nonSilentDurationSeconds: stream.nonSilent,
          finiteSampleCheck: quality.finiteSampleCheck,
          lengthParity: quality.lengthParity,
          correlationWithMixture: pearson(pcm.mixture, stream.pcm),
          zeroStream: stream.rms < 1e-5,
          highCorrelation:
            quality.streamCorrelation !== null &&
            Math.abs(quality.streamCorrelation) >= 0.98,
          lengthMismatch: !quality.lengthParity,
        };
      }) as [SeparationStreamCacheResult, SeparationStreamCacheResult];
      const result = {
        streams: streamResults,
        streamCorrelation: quality.streamCorrelation,
        mixtureReconstructionError: quality.mixtureReconstructionError,
        qualityStatus: quality.qualityStatus,
        qualityBlockers: quality.blockers,
      };
      entry = {
        schemaVersion: "1.0.0",
        artifactType: "source-separation-cache-entry",
        cacheKey,
        identity,
        result,
        semanticHash: sha256Value({ identity, result }),
      };
      if (input.cacheMode === "read-write") {
        await writeSeparationCacheEntry(input.cacheRoot, entry);
      }
    }
    const attemptsByCueAndStream = new Map<string, CtcAlignmentAttempt>();
    for (const cueId of item.targetCueIds) {
      const target = input.encodingByCueId.get(cueId);
      if (target === undefined) {
        throw new InputError(`Separated CTC target missing: ${cueId}`);
      }
      for (const stream of entry.result.streams) {
        separatedStreamCtcAttemptCount += 1;
        if (separatedStreamCtcAttemptCount > 20) {
          throw new InputError("Separated-stream CTC hard maximum exceeded.");
        }
        const attemptId = `ctc-separated-${sha256Value({
          componentId,
          cueId,
          streamId: stream.streamId,
          audioSha256: stream.audioSha256,
          targetTextSha256: target.targetTextSha256,
        }).slice(0, 20)}`;
        const audioLocalInterval = { start: 0, end: stream.durationSeconds };
        const mediaGlobalInterval = {
          start: item.audioExtractedInterval.start,
          end: item.audioExtractedInterval.start + stream.durationSeconds,
        };
        const cacheIdentityValue = cacheIdentity({
          attempt: {
            target,
            audioLocalInterval,
            mediaGlobalInterval,
            windowType: "expanded",
          },
          audioSha256: stream.audioSha256,
          sourceFrameStart: 0,
          sourceFrameEndExclusive: Math.round(stream.durationSeconds * 16_000),
          runtimeIdentityHash: input.capability.runtimeIdentityHash,
          modelSnapshotHash: input.capability.modelSnapshotHash,
          tokenizerIdentityHash: input.capability.tokenizerVocabularyHash,
          deviceUsed: input.capability.deviceUsed,
        });
        let ctcAttempt = await input.ctcCache.get({
          identity: cacheIdentityValue,
          attemptId,
          cueId,
          componentId,
          windowType: "expanded",
          audioSha256: stream.audioSha256,
        });
        if (ctcAttempt !== null) {
          separatedStreamCtcCacheHitCount += 1;
        } else {
          if (input.cacheMode === "read") {
            throw new InputError(
              `Required separated CTC cache miss: ${attemptId}`,
            );
          }
          const streamPath = streamPathById.get(stream.streamId);
          if (streamPath === undefined) {
            throw new InputError(
              "Separated audio was not retained for a cache miss.",
            );
          }
          const ctcWorker = await input.ensureCtcWorker();
          ctcAttempt = await ctcWorker.align({
            attemptId,
            cueId,
            componentId,
            windowType: "expanded",
            audioPath: streamPath,
            audioSha256: stream.audioSha256,
            audioLocalInterval,
            mediaGlobalInterval,
            targetText: target.targetText,
            targetTokenIds: target.tokenIds,
          });
          ctcAttempt = {
            ...ctcAttempt,
            deviceRequested,
            deviceUsed: input.capability.deviceUsed,
          };
          separatedStreamCtcInferenceCount += 1;
          await input.ctcCache.put({
            identity: cacheIdentityValue,
            attempt: ctcAttempt,
          });
        }
        attemptsByCueAndStream.set(`${cueId}:${stream.streamId}`, ctcAttempt);
      }
    }
    const streams = entry.result.streams.map((stream) => ({
      ...stream,
      ctcAttemptIds: item.targetCueIds.map((cueId) => {
        const value = attemptsByCueAndStream.get(`${cueId}:${stream.streamId}`);
        if (value === undefined)
          throw new InputError("Separated CTC attempt missing.");
        return value.attemptId;
      }),
    }));
    const bestStreamByCue: Record<string, string | null> = {};
    const scoreMarginByCue: Record<string, number | null> = {};
    for (const cueId of item.targetCueIds) {
      const a = attemptsByCueAndStream.get(`${cueId}:stream-a`);
      const b = attemptsByCueAndStream.get(`${cueId}:stream-b`);
      const aScore = a?.meanTokenPosterior ?? null;
      const bScore = b?.meanTokenPosterior ?? null;
      if (aScore === null || bScore === null) {
        bestStreamByCue[cueId] = null;
        scoreMarginByCue[cueId] = null;
      } else {
        bestStreamByCue[cueId] =
          aScore >= bScore ? "Candidate Stream A" : "Candidate Stream B";
        scoreMarginByCue[cueId] = Math.abs(aScore - bScore);
      }
    }
    const componentBase = {
      componentId,
      cueIds: item.targetCueIds,
      triggered: true,
      triggerReasons: trigger.triggerReasons,
      separationCacheHit,
      separationInferenceExecuted,
      streams,
      streamCorrelation: entry.result.streamCorrelation,
      mixtureReconstructionError: entry.result.mixtureReconstructionError,
      qualityStatus: entry.result.qualityStatus,
      bestStreamByCue,
      scoreMarginByCue,
      qualityBlockers: entry.result.qualityBlockers,
    };
    components.push({
      ...componentBase,
      semanticHash: sha256Value({
        ...componentBase,
        separationCacheHit: false,
        separationInferenceExecuted: false,
      }),
    });
  }
  const summary = {
    targetComponentCount: 7 as const,
    triggeredComponentCount: triggers.length,
    separationRequestCount: triggers.length,
    separationInferenceCount,
    separationCacheHitCount,
    separationModelLoadCount,
    separatedStreamCtcAttemptCount,
    separatedStreamCtcInferenceCount,
    separatedStreamCtcCacheHitCount,
    timingMutationCount: 0 as const,
    textMutationCount: 0 as const,
  };
  const base = {
    schemaVersion: "1.0.0" as const,
    artifactType: "subtitle-local-separated-stream-evidence" as const,
    evidenceVersion: "C5.18.1" as const,
    generatedAt: new Date().toISOString(),
    mode: input.mode,
    separationRuntimeIdentityHash,
    separationModelRepo: "speechbrain/sepformer-whamr16k" as const,
    separationModelRevision:
      "21a5b500c6f52fddc387c5d9e5fb13ffd6f039c5" as const,
    separationModelSnapshotHash: separationModel?.modelSnapshotHash ?? null,
    trainingLanguage: "English" as const,
    targetLanguage: "Japanese" as const,
    domainMatched: false as const,
    crossDomainUse: "experimental-observe-only" as const,
    crossDomainWarning:
      "English WHAMR separation is experimental observe-only evidence for Japanese dialogue." as const,
    timingActionable: false as const,
    components,
    summary,
  };
  return subtitleLocalSeparatedStreamEvidenceSchema.parse({
    ...base,
    semanticHash: sha256Value({
      ...base,
      generatedAt: null,
      components: components.map((component) => ({
        ...component,
        separationCacheHit: false,
        separationInferenceExecuted: false,
      })),
      summary: {
        ...summary,
        separationInferenceCount: 0,
        separationCacheHitCount: 0,
        separationModelLoadCount: 0,
        separatedStreamCtcInferenceCount: 0,
        separatedStreamCtcCacheHitCount: 0,
      },
    }),
  });
}

if (await exists(outputTask)) {
  throw new InputError(`Replay output already exists: ${outputTask}`);
}

const verifiedRuntime = await loadAndVerifyCtcRuntime({
  runtimeManifestPath,
  modelManifestPath,
});
const capability = ctcRuntimeCapabilitySchema.parse(
  JSON.parse(await readFile(capabilityInputPath, "utf8")) as unknown,
);
if (
  capability.runtimeIdentityHash !==
    verifiedRuntime.runtime.runtimeIdentityHash ||
  capability.modelSnapshotHash !== verifiedRuntime.model.modelSnapshotHash ||
  capability.deviceRequested !== deviceRequested
) {
  throw new InputError(
    "CTC capability does not match the requested runtime, model, or device.",
  );
}

const sourceLocated = await locateSubtitlePackage(sourceTask);
const sourceCriticalPaths = [
  "subtitle-package.needs-review.json",
  "subtitle-review-package.json",
  "subtitle-finalization-report.json",
  "subtitle-canonical-alignment-input.json",
  "subtitle-canonical-forced-alignment.json",
  "subtitle-local-speaker-evidence.json",
  "subtitle-presentation-resolution.json",
].map((name) => path.join(sourceLocated.subtitleDirectory, name));
const sourceHashesBefore = await Promise.all(
  sourceCriticalPaths.map(sha256File),
);
const temporaryDirectory = await mkdtemp(
  path.join(tmpdir(), "mvl-c5-18-1-ctc-"),
);
const runtimeState: { worker: LocalCtcWorker | null } = { worker: null };
const separationRuntimeState: { worker: LocalSourceSeparationWorker | null } = {
  worker: null,
};
let completed = false;

try {
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
  const targetLocated = await locateSubtitlePackage(stagingTask);
  const subtitleDirectory = targetLocated.subtitleDirectory;
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
  const canonicalAlignmentPath = path.join(
    subtitleDirectory,
    "subtitle-canonical-alignment-input.json",
  );
  const speakerEvidencePath = path.join(
    subtitleDirectory,
    "subtitle-local-speaker-evidence.json",
  );
  const sourceReviewPackage = subtitleReviewPackageSchema.parse(
    JSON.parse(await readFile(reviewPackagePath, "utf8")) as unknown,
  );
  const sourceReviewPackageHash = await sha256File(reviewPackagePath);
  const sourceFinalization = subtitleFinalizationReportSchema.parse(
    JSON.parse(await readFile(finalizationPath, "utf8")) as unknown,
  );
  const sourceFinalizationHash = await sha256File(finalizationPath);
  const sourcePresentation = subtitlePresentationResolutionSchema.parse(
    JSON.parse(await readFile(presentationPath, "utf8")) as unknown,
  );
  const sourceAlignment = subtitleCanonicalAlignmentInputSchema.parse(
    JSON.parse(await readFile(canonicalAlignmentPath, "utf8")) as unknown,
  );
  const sourceAlignmentHash = await sha256File(canonicalAlignmentPath);
  const speakerEvidence = subtitleLocalSpeakerEvidenceSchema.parse(
    JSON.parse(await readFile(speakerEvidencePath, "utf8")) as unknown,
  );
  if (
    sourceReviewPackage.items.length !== 7 ||
    sourceAlignment.cues.length !== 16 ||
    new Set(sourceReviewPackage.items.flatMap((item) => item.targetCueIds))
      .size !== 16
  ) {
    throw new InputError(
      "C5.18.1 requires exactly seven review components and sixteen CTC target cues.",
    );
  }

  const finalPackagePath = resolveInside(
    subtitleDirectory,
    sourceFinalization.outputPaths.subtitlePackage,
  );
  const sourcePackage = subtitlePackageSchema.parse(
    JSON.parse(await readFile(finalPackagePath, "utf8")) as unknown,
  );
  if (sourcePackage.cues.length !== 192) {
    throw new InputError("C5.18.1 requires the 192-cue human baseline.");
  }
  const sourceOutputCueHash = sha256Value(sourcePackage.cues);
  const sourceTimingHash = sha256Value(
    sourcePackage.cues.map((cue) => ({
      id: cue.id,
      start: cue.start,
      end: cue.end,
    })),
  );

  const capabilityPath = path.join(
    subtitleDirectory,
    "ctc-runtime-capability.json",
  );
  await atomicWriteJson(capabilityPath, capability, { overwrite: true });
  const alignmentImport =
    values["ctc-alignment-input-import"] === undefined
      ? null
      : subtitleCtcAlignmentInputSchema.parse(
          JSON.parse(
            await readFile(
              path.resolve(values["ctc-alignment-input-import"]),
              "utf8",
            ),
          ) as unknown,
        );
  const importedEncoding = new Map<string, CtcTargetEncoding>(
    alignmentImport?.cues.map((cue) => [cue.cueId, cue.encoding]) ?? [],
  );
  if (
    alignmentImport !== null &&
    (alignmentImport.ctcRuntimeIdentityHash !==
      capability.runtimeIdentityHash ||
      alignmentImport.ctcModelSnapshotHash !== capability.modelSnapshotHash ||
      alignmentImport.tokenizerIdentityHash !==
        capability.tokenizerVocabularyHash)
  ) {
    throw new InputError("Imported CTC alignment input identity mismatch.");
  }

  const cacheRoot = path.resolve(
    values["ctc-cache-dir"] ??
      path.join(homedir(), ".cache", "mvl", "ctc-alignment-cache"),
  );
  const cache = new CtcAlignmentCache({
    root: cacheRoot,
    importRoots: values["ctc-cache-import"] ?? [],
    mode: cacheMode,
  });
  const attempts: CtcAlignmentAttempt[] = [];
  const encodingByCueId = new Map<string, CtcTargetEncoding>(importedEncoding);

  const ensureWorker = async () => {
    if (runtimeState.worker === null) {
      runtimeState.worker = new LocalCtcWorker({
        ...verifiedRuntime,
        device: capability.deviceUsed,
        workerScriptPath: path.resolve("scripts/runtime/ctc_worker.py"),
      });
      const ready = await runtimeState.worker.start();
      if (ready.deviceUsed !== capability.deviceUsed) {
        throw new InputError(
          "CTC worker device differs from verified capability.",
        );
      }
    }
    return runtimeState.worker;
  };

  for (const item of [...sourceReviewPackage.items].toSorted((left, right) =>
    left.reviewId.localeCompare(right.reviewId),
  )) {
    if (
      item.audioClipPath === null ||
      item.audioExtractedInterval === null ||
      item.audioSha256 === null
    ) {
      throw new InputError(`Review audio identity missing: ${item.reviewId}`);
    }
    const componentId = targetComponentId(item);
    const reviewAudioPath = resolveInside(
      subtitleDirectory,
      path.posix.join("review", item.audioClipPath),
    );
    const reviewAudioBuffer = await readFile(reviewAudioPath);
    const reviewAudioSha256 = createHash("sha256")
      .update(reviewAudioBuffer)
      .digest("hex");
    if (reviewAudioSha256 !== item.audioSha256) {
      throw new InputError(`Review WAV hash mismatch: ${item.reviewId}`);
    }
    const reviewWav = inspectReviewWav(reviewAudioBuffer);
    if (
      reviewWav.sampleRate !== 16_000 ||
      reviewWav.channelCount !== 1 ||
      reviewWav.bitsPerSample !== 16
    ) {
      throw new InputError(
        `Review WAV must be mono PCM16 16k: ${item.reviewId}`,
      );
    }
    for (const cueId of item.targetCueIds) {
      const alignmentCue = sourceAlignment.cues.find(
        (cue) => cue.cueId === cueId,
      );
      if (alignmentCue === undefined) {
        throw new InputError(`Canonical alignment input lacks ${cueId}.`);
      }
      const targetText = normalizeCtcAlignmentText(
        alignmentCue.alignmentText,
      ).text;
      const seed = seedInterval(item, cueId);
      for (const windowType of ["narrow", "expanded"] as const) {
        const localStart =
          windowType === "expanded"
            ? 0
            : Math.max(0, seed.start - 0.5 - item.audioExtractedInterval.start);
        const localEnd =
          windowType === "expanded"
            ? reviewWav.actualDurationSeconds
            : Math.min(
                reviewWav.actualDurationSeconds,
                seed.end + 0.5 - item.audioExtractedInterval.start,
              );
        if (localEnd <= localStart) {
          throw new InputError(
            `Invalid ${windowType} CTC window for ${cueId}.`,
          );
        }
        const mediaGlobalInterval = {
          start: item.audioExtractedInterval.start + localStart,
          end: item.audioExtractedInterval.start + localEnd,
        };
        const audioLocalInterval = { start: localStart, end: localEnd };
        let audioPath = reviewAudioPath;
        let audioSha256 = reviewAudioSha256;
        let sourceFrameStart = 0;
        let sourceFrameEndExclusive = reviewWav.frameCount;
        if (windowType === "narrow") {
          sourceFrameStart = Math.round(localStart * 16_000);
          sourceFrameEndExclusive = Math.round(localEnd * 16_000);
          audioPath = path.join(
            temporaryDirectory,
            `${cueId}-${windowType}.wav`,
          );
          const cropped = await cropReviewWavFrames({
            sourcePath: reviewAudioPath,
            targetPath: audioPath,
            startSeconds: localStart,
            endSeconds: localEnd,
          });
          audioSha256 = cropped.sha256;
        }
        const attemptId = `ctc-attempt-${sha256Value({
          cueId,
          componentId,
          windowType,
          audioSha256,
          targetText,
        }).slice(0, 20)}`;
        const imported = importedEncoding.get(cueId);
        let attempt: CtcAlignmentAttempt | null = null;
        let identity =
          imported === undefined
            ? null
            : cacheIdentity({
                attempt: {
                  target: imported,
                  audioLocalInterval,
                  mediaGlobalInterval,
                  windowType,
                },
                audioSha256,
                sourceFrameStart,
                sourceFrameEndExclusive,
                runtimeIdentityHash: capability.runtimeIdentityHash,
                modelSnapshotHash: capability.modelSnapshotHash,
                tokenizerIdentityHash: capability.tokenizerVocabularyHash,
                deviceUsed: capability.deviceUsed,
              });
        if (identity !== null) {
          attempt = await cache.get({
            identity,
            attemptId,
            cueId,
            componentId,
            windowType,
            audioSha256,
          });
          if (attempt === null && cacheMode === "read") {
            throw new InputError(`Required CTC cache miss: ${attemptId}`);
          }
        }
        if (attempt === null) {
          const activeWorker = await ensureWorker();
          const targetTokenIds = encodingByCueId.get(cueId)?.tokenIds;
          attempt = await activeWorker.align({
            attemptId,
            cueId,
            componentId,
            windowType,
            audioPath,
            audioSha256,
            audioLocalInterval,
            mediaGlobalInterval,
            targetText,
            ...(targetTokenIds === undefined ? {} : { targetTokenIds }),
          });
          attempt = {
            ...attempt,
            deviceRequested,
            deviceUsed: capability.deviceUsed,
          };
          const priorEncoding = encodingByCueId.get(cueId);
          if (
            priorEncoding !== undefined &&
            sha256Value(priorEncoding) !== sha256Value(attempt.target)
          ) {
            throw new InputError(
              `CTC tokenizer encoding changed for ${cueId}.`,
            );
          }
          encodingByCueId.set(cueId, attempt.target);
          identity = cacheIdentity({
            attempt,
            audioSha256,
            sourceFrameStart,
            sourceFrameEndExclusive,
            runtimeIdentityHash: capability.runtimeIdentityHash,
            modelSnapshotHash: capability.modelSnapshotHash,
            tokenizerIdentityHash: capability.tokenizerVocabularyHash,
            deviceUsed: capability.deviceUsed,
          });
          if (imported === undefined) {
            const unexpected = await cache.get({
              identity,
              attemptId,
              cueId,
              componentId,
              windowType,
              audioSha256,
              ignoreCurrentRunWrites: true,
            });
            if (unexpected !== null) {
              throw new InputError(
                "Fresh CTC acceptance requires an empty exact cache.",
              );
            }
          }
          await cache.put({ identity, attempt });
        }
        attempts.push(attempt);
      }
    }
  }

  if (attempts.length !== 32 || encodingByCueId.size !== 16) {
    throw new InputError("C5.18.1 direct CTC cardinality is not 32/16.");
  }
  const alignmentInput = buildSubtitleCtcAlignmentInput({
    source: sourceAlignment,
    sourceAlignmentInputHash: sourceAlignmentHash,
    runtimeIdentityHash: capability.runtimeIdentityHash,
    modelSnapshotHash: capability.modelSnapshotHash,
    tokenizerIdentityHash: capability.tokenizerVocabularyHash,
    encodingByCueId,
  });
  const alignmentInputPath = path.join(
    subtitleDirectory,
    "subtitle-ctc-alignment-input.json",
  );
  await atomicWriteJson(alignmentInputPath, alignmentInput, {
    overwrite: true,
  });

  const attemptsByCue = Map.groupBy(attempts, (attempt) => attempt.cueId);
  const cueEvidenceInputs: CtcCueEvidenceInput[] = sourceAlignment.cues.map(
    (cue) => {
      const item = sourceReviewPackage.items.find((reviewItem) =>
        reviewItem.targetCueIds.includes(cue.cueId),
      );
      const speakerComponent = speakerEvidence.components.find(
        (component) => component.componentId === cue.componentId,
      );
      const cueAttempts = attemptsByCue.get(cue.cueId) ?? [];
      const narrow = cueAttempts.find(
        (attempt) => attempt.windowType === "narrow",
      );
      const expanded = cueAttempts.find(
        (attempt) => attempt.windowType === "expanded",
      );
      if (
        item === undefined ||
        speakerComponent === undefined ||
        narrow === undefined ||
        expanded === undefined
      ) {
        throw new InputError(`Incomplete CTC evidence input for ${cue.cueId}.`);
      }
      const forcedCue = item.forcedAlignmentEvidence?.cues.find(
        (value) => value.cueId === cue.cueId,
      );
      return {
        cueId: cue.cueId,
        componentId: cue.componentId,
        canonicalText: cue.canonicalText,
        alignmentText: cue.alignmentText,
        originalInterval: cue.originalInterval,
        narrow,
        expanded,
        independent: independentEvidence(item, cue.cueId, speakerComponent),
        neighborIntrusion:
          forcedCue?.antiForcingBlockers.includes("NEIGHBOR_CUE_INTRUSION") ??
          false,
      };
    },
  );
  const ctcEvidence = buildLocalCtcBoundaryEvidence({
    sourceFingerprint: sourceReviewPackage.sourceFingerprint,
    baseCueHash: sourceAlignment.baseCueHash,
    baseTimingHash: sourceAlignment.baseTimingHash,
    alignmentInputRef: "./subtitle-ctc-alignment-input.json",
    runtimeCapabilityRef: "./ctc-runtime-capability.json",
    mode,
    deviceRequested,
    deviceUsed: capability.deviceUsed,
    attempts,
    cues: cueEvidenceInputs,
    speakerResolvedComponentIds: new Set(
      speakerEvidence.components
        .filter((component) => component.resolutionStatus === "resolved")
        .map((component) => component.componentId),
    ),
  });
  const outputCues = applyCtcTimingMutations({
    cues: sourcePackage.cues,
    evidence: ctcEvidence,
  });
  if (
    sourcePackage.cues.some(
      (cue, index) => cue.text !== outputCues[index]?.text,
    )
  ) {
    throw new InputError(
      "C5.18.1 is not allowed to change canonical subtitle text.",
    );
  }
  const outputCueHash = sha256Value(outputCues);
  const timingHash = sha256Value(
    outputCues.map((cue) => ({
      id: cue.id,
      start: cue.start,
      end: cue.end,
    })),
  );
  if (
    ctcEvidence.mutations.length === 0 &&
    (outputCueHash !== sourceOutputCueHash || timingHash !== sourceTimingHash)
  ) {
    throw new InputError("Zero-mutation CTC replay changed canonical cues.");
  }
  const evidencePath = path.join(
    subtitleDirectory,
    "subtitle-local-ctc-boundary-evidence.json",
  );
  await atomicWriteJson(evidencePath, ctcEvidence, { overwrite: true });

  const separationEvidence = await runSourceSeparation({
    mode: separationMode,
    items: sourceReviewPackage.items,
    speaker: speakerEvidence,
    subtitleDirectory,
    temporaryDirectory,
    cacheRoot,
    cacheImportRoots: values["ctc-cache-import"] ?? [],
    cacheMode,
    ctcCache: cache,
    encodingByCueId,
    capability,
    runtime: verifiedRuntime,
    ensureCtcWorker: ensureWorker,
  });
  const separationPath = path.join(
    subtitleDirectory,
    "subtitle-local-separated-stream-evidence.json",
  );
  await atomicWriteJson(separationPath, separationEvidence, {
    overwrite: true,
  });

  const cacheManifest = cache.manifest({
    inferenceCount:
      ctcEvidence.summary.directInferenceCount +
      separationEvidence.summary.separatedStreamCtcInferenceCount,
    modelLoadCount: ctcEvidence.summary.modelLoadCount,
  });
  const cacheManifestPath = path.join(
    subtitleDirectory,
    "ctc-alignment-cache-manifest.json",
  );
  await atomicWriteJson(cacheManifestPath, cacheManifest, { overwrite: true });

  const updatedOverlapDecisions = sourcePresentation.overlapDecisions.map(
    (decision) => {
      const component = ctcEvidence.components.find((candidate) =>
        sameCueSet(candidate.cueIds, decision.cueIds),
      );
      if (component?.timingMutationApplied !== true) return decision;
      return {
        ...decision,
        recommendedAction: "trim-boundary" as const,
        safeAutomaticAction: "timing-only" as const,
        timingMutations: component.mutations.map((mutation) => ({
          cueId: mutation.cueId,
          before: { start: mutation.oldStart, end: mutation.oldEnd },
          after: { start: mutation.newStart, end: mutation.newEnd },
          boundarySource: "local-ctc-boundary" as const,
        })),
        reasons: [
          ...new Set([
            ...decision.reasons,
            "C5_18_1_TRANSCRIPT_CONSTRAINED_CTC_BOUNDARY_CONSENSUS",
          ]),
        ],
        blocking: false,
        resolutionSource: "local-ctc-boundary" as const,
        acousticEvidenceIds: [component.semanticHash],
        classificationConfidence: null,
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
  const presentation = subtitlePresentationResolutionSchema.parse({
    ...sourcePresentation,
    resolutionVersion: "C5.18.1",
    generatedAt: new Date().toISOString(),
    canonicalCueHash: outputCueHash,
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
      timingMutationCount: ctcEvidence.mutations.length,
      canonicalTextMutationCount: 0,
      canonicalTimingMutationCount: ctcEvidence.mutations.length,
      reviewGroupCount: updatedOverlapDecisions.filter(
        (decision) => decision.blocking,
      ).length,
    },
  });
  await atomicWriteJson(presentationPath, presentation, { overwrite: true });

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
    presentationResolutionMode: "enforce",
  });
  if (
    !quality.serializationRoundTripPassed ||
    !quality.formatSemanticParityPassed ||
    !quality.canonicalParityPassed
  ) {
    throw new InputError(
      "C5.18.1 output serialization failed canonical or semantic parity.",
    );
  }
  if (ctcEvidence.mutations.length > 0) {
    await Promise.all([
      atomicWriteFile(
        resolveInside(subtitleDirectory, sourceFinalization.outputPaths.srt),
        quality.serialized.srt,
        { overwrite: true },
      ),
      atomicWriteFile(
        resolveInside(subtitleDirectory, sourceFinalization.outputPaths.vtt),
        quality.serialized.vtt,
        { overwrite: true },
      ),
      atomicWriteFile(
        resolveInside(subtitleDirectory, sourceFinalization.outputPaths.ass),
        quality.serialized.ass,
        { overwrite: true },
      ),
    ]);
  }
  const outputPackage = subtitlePackageSchema.parse({
    ...sourcePackage,
    cues: outputCues,
    warnings: [
      ...new Set([
        ...sourcePackage.warnings,
        "C5.18.1 CTC uses the existing alignment transcript only for local acoustic timing; greedy text and separated streams never rewrite canonical text.",
      ]),
    ],
  });
  await atomicWriteJson(finalPackagePath, outputPackage, { overwrite: true });

  const ctcEvidenceHash = await sha256File(evidencePath);
  const alignmentInputHash = await sha256File(alignmentInputPath);
  const separationEvidenceHash = separationEvidence.semanticHash;
  const resolvedComponents = new Set(
    ctcEvidence.components
      .filter((component) => component.subtitleOverlapResolved)
      .map((component) => component.componentId),
  );
  const newReviewVersion = `review-v5-${sha256Value({
    prior: sourceReviewPackage.reviewVersion,
    ctcRuntimeIdentityHash: capability.runtimeIdentityHash,
    ctcModelSnapshotHash: capability.modelSnapshotHash,
    ctcAlignmentInputHash: alignmentInput.semanticHash,
    ctcEvidenceHash: ctcEvidence.semanticHash,
    ctcPolicyVersion: CTC_ALIGNMENT_POLICY,
    jointAssignmentHash: ctcEvidence.jointAssignmentHash,
    sourceSeparationEvidenceHash: separationEvidenceHash,
  }).slice(0, 24)}`;
  const reviewItems = sourceReviewPackage.items
    .filter((item) => !resolvedComponents.has(targetComponentId(item)))
    .map((item) => ({
      ...item,
      ctcBoundaryEvidenceComponentId: targetComponentId(item),
      blockers: [
        ...new Set([
          ...item.blockers,
          ...(ctcEvidence.components.find(
            (component) => component.componentId === targetComponentId(item),
          )?.blockers ?? []),
        ]),
      ].toSorted(),
    }));
  const boundItems = bindReviewCandidates({
    items: reviewItems,
    inputEvidenceHash: sourceReviewPackage.inputEvidenceHash,
    reviewVersion: newReviewVersion,
  });
  const reviewPackage = subtitleReviewPackageSchema.parse({
    ...sourceReviewPackage,
    reviewVersion: newReviewVersion,
    generatedAt: new Date().toISOString(),
    ctcBoundaryEvidenceArtifactPath:
      "./subtitle-local-ctc-boundary-evidence.json",
    ctcBoundaryEvidenceArtifactHash: ctcEvidenceHash,
    ctcRuntimeIdentityHash: capability.runtimeIdentityHash,
    ctcModelSnapshotHash: capability.modelSnapshotHash,
    ctcAlignmentInputHash: alignmentInputHash,
    ctcEvidenceHash,
    ctcPolicyVersion: CTC_ALIGNMENT_POLICY,
    ctcJointAssignmentHash: ctcEvidence.jointAssignmentHash,
    sourceSeparationEvidenceHash: separationEvidenceHash,
    items: boundItems,
    summary: {
      ...sourceReviewPackage.summary,
      itemCount: boundItems.length,
      mandatoryItemCount: boundItems.filter((item) => item.requiresHumanReview)
        .length,
      audioClipCount: boundItems.filter((item) => item.audioClipPath !== null)
        .length,
      audioReferencedCount: boundItems.filter(
        (item) => item.audioClipPath !== null,
      ).length,
      audioPlayableCount: boundItems.filter(
        (item) =>
          item.audioClipPath !== null &&
          item.audioValidationStatus === "validated" &&
          item.audioFullyCoversComponent,
      ).length,
    },
  });
  await atomicWriteJson(reviewPackagePath, reviewPackage, { overwrite: true });
  await writeSubtitleReviewPage({
    subtitleDirectory,
    reviewPackage,
    speakerEvidence,
    ctcEvidence,
    separatedStreamEvidence: separationEvidence,
    timelineEnabled: true,
  });

  const finalization = subtitleFinalizationReportSchema.parse({
    ...sourceFinalization,
    finalizationVersion: "C5.18.1-local-ctc-boundary-refinement-v1",
    generatedAt: new Date().toISOString(),
    status: reviewPackage.items.length === 0 ? "finalized" : "needs-review",
    finalizationMethod: reviewPackage.items.length === 0 ? "automatic" : "none",
    metrics: {
      ...sourceFinalization.metrics,
      reviewItemCount: reviewPackage.items.length,
      ctcTargetCueCount: 16,
      ctcTargetEncodableCueCount: ctcEvidence.summary.targetEncodableCueCount,
      ctcDirectAttemptCount: ctcEvidence.summary.directAttemptCount,
      ctcDirectInferenceCount: ctcEvidence.summary.directInferenceCount,
      ctcDirectCacheHitCount: ctcEvidence.summary.directCacheHitCount,
      ctcModelLoadCount: ctcEvidence.summary.modelLoadCount,
      ctcPathSuccessCount: ctcEvidence.summary.pathSuccessCount,
      ctcWindowStableCueCount: ctcEvidence.summary.windowStableCueCount,
      ctcEdgePinnedCueCount: ctcEvidence.summary.edgePinnedCueCount,
      ctcDuplicateOccurrenceConflictCount:
        ctcEvidence.summary.duplicateOccurrenceConflictCount,
      ctcJointAssignmentResolvedComponentCount:
        ctcEvidence.summary.jointAssignmentResolvedComponentCount,
      ctcTimingActionableCueCount: ctcEvidence.summary.timingActionableCueCount,
      ctcTimingActionableComponentCount:
        ctcEvidence.summary.timingActionableComponentCount,
      ctcTimingMutationCueCount: ctcEvidence.summary.timingMutationCueCount,
      ctcTimingMutationComponentCount:
        ctcEvidence.summary.timingMutationComponentCount,
      ctcResolvedSubtitleOverlapComponentCount:
        ctcEvidence.summary.resolvedSubtitleOverlapComponentCount,
      ctcGreedyTextMutationCount: 0,
      ctcTokenRatioRepairCount: 0,
      separationTriggeredComponentCount:
        separationEvidence.summary.triggeredComponentCount,
      separationInferenceCount:
        separationEvidence.summary.separationInferenceCount,
      separationCacheHitCount:
        separationEvidence.summary.separationCacheHitCount,
      separatedStreamCtcAttemptCount:
        separationEvidence.summary.separatedStreamCtcAttemptCount,
      speakerRelationshipResolvedComponentCount: 1,
      subtitleOverlapResolvedComponentCount:
        ctcEvidence.summary.resolvedSubtitleOverlapComponentCount,
    },
    qualityGate: {
      ...sourceFinalization.qualityGate,
      finalIntegrityPassed: quality.finalIntegrityPassed,
      serializationRoundTripPassed: quality.serializationRoundTripPassed,
      formatSemanticParityPassed: quality.formatSemanticParityPassed,
      canonicalParityPassed: quality.canonicalParityPassed,
      presentationParityPassed: quality.presentationParityPassed,
    },
    outputPaths: {
      ...sourceFinalization.outputPaths,
      ctcRuntimeCapability: "ctc-runtime-capability.json",
      ctcAlignmentInput: "subtitle-ctc-alignment-input.json",
      localCtcBoundaryEvidence: "subtitle-local-ctc-boundary-evidence.json",
      ctcAlignmentCacheManifest: "ctc-alignment-cache-manifest.json",
      localSeparatedStreamEvidence:
        "subtitle-local-separated-stream-evidence.json",
    },
  });
  await atomicWriteJson(finalizationPath, finalization, { overwrite: true });
  const delivery = await writeReviewDeliveryIntegrity({
    mode: "enforce",
    sourceTaskName: path.basename(sourceTask),
    subtitleDirectory,
    sourceReviewPackageHash,
    sourceFinalizationReportHash: sourceFinalizationHash,
    baseTimingHash: timingHash,
    canonicalCueHashUnchanged: true,
    canonicalTimingHashUnchanged: true,
  });
  if (delivery.artifact === null || delivery.path === null) {
    throw new InputError("C5.18.1 review delivery was not materialized.");
  }

  const sourceHashesAfter = await Promise.all(
    sourceCriticalPaths.map(sha256File),
  );
  const sourceReadOnlyVerified =
    sha256Value(sourceHashesBefore) === sha256Value(sourceHashesAfter);
  if (!sourceReadOnlyVerified) {
    throw new InputError("C5.18 source artifacts changed during replay.");
  }
  const summaryBase = {
    schemaVersion: "1.0.0" as const,
    artifactType: "c5-18-1-ctc-boundary-replay-summary" as const,
    replayVersion: "C5.18.1" as const,
    generatedAt: new Date().toISOString(),
    runId: `c5-18-1-${randomUUID()}`,
    sourceTaskName: path.basename(sourceTask),
    outputTaskName: path.basename(outputTask),
    mode,
    cacheMode,
    sourceSeparationMode: separationMode,
    runtimeIdentityHash: capability.runtimeIdentityHash,
    modelSnapshotHash: capability.modelSnapshotHash,
    deviceRequested,
    deviceUsed: capability.deviceUsed,
    counts: {
      targetComponentCount: 7 as const,
      targetCueCount: 16 as const,
      directCtcRequestCount: 32 as const,
      directCtcInferenceCount: ctcEvidence.summary.directInferenceCount,
      directCtcCacheHitCount: ctcEvidence.summary.directCacheHitCount,
      ctcModelLoadCount: ctcEvidence.summary.modelLoadCount,
      wholeMediaCtcInferenceCount: 0 as const,
      speakerInferenceCount: 0 as const,
      mfaProcessCount: 0 as const,
      whisperRequestCount: 0 as const,
      wholeMediaAsrRequestCount: 0 as const,
      openAiRequestCount: 0 as const,
      onlineSubtitleSearchCount: 0 as const,
      separationInferenceCount:
        separationEvidence.summary.separationInferenceCount,
      separationCacheHitCount:
        separationEvidence.summary.separationCacheHitCount,
      separationModelLoadCount:
        separationEvidence.summary.separationModelLoadCount,
      separatedStreamCtcAttemptCount:
        separationEvidence.summary.separatedStreamCtcAttemptCount,
      separatedStreamCtcInferenceCount:
        separationEvidence.summary.separatedStreamCtcInferenceCount,
      separatedStreamCtcCacheHitCount:
        separationEvidence.summary.separatedStreamCtcCacheHitCount,
      canonicalTextMutationCount: 0 as const,
      canonicalTimingMutationCount: ctcEvidence.mutations.length,
      greedyTextMutationCount: 0 as const,
      tokenRatioRepairCount: 0 as const,
      forbiddenTimingHeuristicUseCount: 0 as const,
      speakerRelationshipResolvedComponentCount: 1 as const,
      subtitleOverlapResolvedComponentCount:
        ctcEvidence.summary.resolvedSubtitleOverlapComponentCount,
      remainingReviewComponentCount: reviewPackage.items.length,
    },
    hashes: {
      ctcAlignmentInputSemanticHash: alignmentInput.semanticHash,
      ctcEvidenceSemanticHash: ctcEvidence.semanticHash,
      jointAssignmentHash: ctcEvidence.jointAssignmentHash,
      sourceSeparationEvidenceHash: separationEvidence.semanticHash,
      componentDecisionHash: ctcEvidence.componentDecisionHash,
      mutationHash: ctcEvidence.mutationHash,
      outputCueHash,
      timingHash,
      presentationHash: presentation.presentationCueHash,
    },
    runtimeCapabilityPath: "./ctc-runtime-capability.json",
    alignmentInputPath: "./subtitle-ctc-alignment-input.json",
    boundaryEvidencePath: "./subtitle-local-ctc-boundary-evidence.json",
    cacheManifestPath: "./ctc-alignment-cache-manifest.json",
    separatedStreamEvidencePath:
      "./subtitle-local-separated-stream-evidence.json",
    reviewDeliveryIntegrityPassed:
      delivery.artifact.summary.reviewDeliveryIntegrityPassed,
    shareableAuditPassed: true,
    networkUsedDuringInference: false as const,
    sourceReadOnlyVerified,
    humanSubtitleReadOnlyVerified: true,
    finalStatus:
      reviewPackage.items.length === 0
        ? ("finalized" as const)
        : ("needs-review" as const),
    finalizationMethod:
      reviewPackage.items.length === 0
        ? ("automatic" as const)
        : ("none" as const),
  };
  const summary = c5181CtcBoundaryReplaySummarySchema.parse({
    ...summaryBase,
    semanticHash: sha256Value({ ...summaryBase, generatedAt: null }),
  });
  const summaryPath = path.join(
    stagingTask,
    "c5-18-1-ctc-boundary-replay-summary.json",
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
    externalFiles: [],
    c517Artifacts: {
      runtimeCapabilityPath: path.join(
        subtitleDirectory,
        "forced-alignment-runtime-capability.json",
      ),
      canonicalInputPath: canonicalAlignmentPath,
      forcedAlignmentPath: path.join(
        subtitleDirectory,
        "subtitle-canonical-forced-alignment.json",
      ),
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
      reviewActionValidationReportPath: path.join(
        subtitleDirectory,
        "review-action-validation-report.json",
      ),
    },
    c518Artifacts: {
      runtimeCapabilityPath: path.join(
        subtitleDirectory,
        "speaker-evidence-runtime-capability.json",
      ),
      localSpeakerEvidencePath: speakerEvidencePath,
      replaySummaryPath: path.join(
        stagingTask,
        "c5-18-speaker-evidence-replay-summary.json",
      ),
      freshCacheObserveValidationPath: path.join(
        stagingTask,
        "c5-18-fresh-cache-observe-validation.json",
      ),
    },
    c5181Artifacts: {
      runtimeCapabilityPath: capabilityPath,
      alignmentInputPath,
      boundaryEvidencePath: evidencePath,
      cacheManifestPath,
      separatedStreamEvidencePath: separationPath,
      replaySummaryPath: summaryPath,
    },
  });
  const shareableAudit = await auditC5161ShareableArtifacts(
    path.join(stagingTask, "shareable"),
  );
  if (!shareableAudit.validationPassed) {
    throw new InputError("C5.18.1 shareable artifact audit failed.");
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
        runtimeIdentityHash: capability.runtimeIdentityHash,
        modelSnapshotHash: capability.modelSnapshotHash,
        deviceUsed: capability.deviceUsed,
        directCtcRequests: 32,
        directCtcInferenceCount: ctcEvidence.summary.directInferenceCount,
        directCtcCacheHitCount: ctcEvidence.summary.directCacheHitCount,
        ctcModelLoadCount: ctcEvidence.summary.modelLoadCount,
        pathSuccessCount: ctcEvidence.summary.pathSuccessCount,
        windowStableCueCount: ctcEvidence.summary.windowStableCueCount,
        timingMutationCount: ctcEvidence.mutations.length,
        remainingReviewComponentCount: reviewPackage.items.length,
        reviewDeliveryIntegrityPassed:
          delivery.artifact.summary.reviewDeliveryIntegrityPassed,
        shareableAuditPassed: shareableAudit.validationPassed,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await runtimeState.worker?.close();
  await separationRuntimeState.worker?.close();
  await rm(temporaryDirectory, { recursive: true, force: true });
  if (!completed) {
    await rm(stagingTask, { recursive: true, force: true });
  }
}
