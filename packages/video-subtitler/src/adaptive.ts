import { performance } from "node:perf_hooks";
import path from "node:path";

import {
  ACOUSTIC_SCENE_ANALYSIS_VERSION,
  DEFAULT_ACOUSTIC_SCENE_CONFIG,
  SCENE_ROUTING_VERSION,
  analyzeAcousticScenes,
  buildAsrRoutingPlan,
  buildCanonicalHallucinationIntegrityFindings,
  buildSceneRoutedIntervals,
  createWhisperCppAdapterForCapability,
  buildFinalReviewQueue,
  buildReferenceTranscriptionPlan,
  compareVadNoVadTranscripts,
  detectSongRegions,
  discoverSpeechAnchors,
  evaluateTranscriptionQuality,
  extractWhisperBenchmarkSample,
  finalizeQualityWithoutRefinement,
  planTranscription,
  planMissingDialogueRecovery,
  profileDevice,
  profileMedia,
  refinementIntervals,
  repairTranscriptionTimings,
  recordAsrRoutingExecution,
  rebuildQualityAfterMissingDialogueRecovery,
  runMissingDialogueRecovery,
  runLyricsTranscription,
  runTargetedRefinement,
  runWhisperBenchmark,
  referenceRecoveryRequirements,
  transcribeIntervalsForComparison,
  transcribeMedia,
  type TranscriptionAdapter,
  type AcousticScenesArtifact,
  type AsrRoutingPlanArtifact,
  type SceneAwareRefinementInterval,
  type MissingDialogueRecoveryArtifact,
  type FinalSubtitleIntegrityFinding,
  type PortableAsrCache,
  uncoveredDiscoveredAnchorRequirements,
  WhisperCppWorkerPool,
} from "@mvl/transcription-core";
import {
  AppError,
  acousticSceneWindowsArtifactSchema,
  acousticScenesArtifactSchema,
  asrRoutingPlanArtifactSchema,
  atomicWriteJson,
  lyricsTranscriptionArtifactSchema,
  missingDialogueRecoveryArtifactSchema,
  readJson,
  transcriptionPlanSchema,
  type AdaptiveRefinementRecord,
  type LanguageTag,
  type LyricsTranscriptionArtifact,
  type Logger,
  type MediaIdentity,
  type ProcessRunner,
  type SubtitleCue,
  type DiscoveredSpeechAnchorsArtifact,
  type ReferenceTimelineArtifact,
  type ReferenceTranscriptionPlanArtifact,
  type TranscriptionPlan,
  type TranscriptionQuality,
  type WhisperExecutionMetrics,
  type WhisperModelCapability,
} from "@mvl/shared";

import type {
  MediaStreamInfo,
  SourceInfo,
  VideoSubtitlerOptions,
} from "./types.js";
import {
  allowRefinementContextPromptForMachineQuality,
  machineQualityTargetChunkSeconds,
  recoveryPromptCuesForMachineQuality,
} from "./machine-quality/policy.js";

function benchmarkCandidates(
  capabilities: readonly WhisperModelCapability[],
  coreML: VideoSubtitlerOptions["coreML"],
): WhisperModelCapability[] {
  const runtimeAllowed = (capability: WhisperModelCapability): boolean => {
    if (coreML === "on") {
      return capability.runtime === "coreml" && capability.coreML.supported;
    }
    if (coreML === "off") return capability.runtime === "cpu";
    if (capability.runtime === "cpu") return true;
    return capability.coreML.supported;
  };
  const usable = capabilities.filter(
    (capability) =>
      ["large-v3", "large-v3-turbo"].includes(capability.modelFamily) &&
      runtimeAllowed(capability),
  );
  const groups = new Map<string, WhisperModelCapability[]>();
  for (const capability of usable) {
    const key = `${capability.modelFamily}:${capability.runtime}`;
    groups.set(key, [...(groups.get(key) ?? []), capability]);
  }
  return [...groups.values()].flatMap((group) => {
    const preferred = group.toSorted(
      (left, right) =>
        Number(left.quantization !== null) -
          Number(right.quantization !== null) ||
        left.id.localeCompare(right.id),
    )[0];
    return preferred === undefined ? [] : [preferred];
  });
}

function capabilityFor(
  deviceModels: readonly WhisperModelCapability[],
  capabilityId: string,
): WhisperModelCapability {
  const capability = deviceModels.find(
    (candidate) => candidate.id === capabilityId,
  );
  if (capability === undefined) {
    throw new AppError(
      `The planned Whisper capability is no longer available: ${capabilityId}.`,
      {
        code: "MISSING_DEPENDENCY",
        exitCode: 4,
        details: { capabilityId },
      },
    );
  }
  return capability;
}

function promptNames(
  identity: MediaIdentity,
  configured: readonly string[],
): string[] {
  return [
    ...new Set(
      [
        identity.title,
        identity.originalTitle,
        identity.episodeTitle,
        ...configured,
      ].filter(
        (value): value is string => value !== null && value.trim() !== "",
      ),
    ),
  ];
}

async function createAdapter(input: {
  capability: WhisperModelCapability;
  executablePath: string;
  whisperCppVersion: string;
  runner: ProcessRunner;
  options: VideoSubtitlerOptions;
  logicalCores: number;
  tokenTimestampsAvailable: boolean;
  fullJsonAvailable: boolean;
  workerPool: WhisperCppWorkerPool;
}): Promise<TranscriptionAdapter> {
  if (
    input.capability.runtime === "coreml" &&
    !input.capability.coreML.supported
  ) {
    if (input.capability.coreML.status === "not-compiled") {
      throw new AppError(
        "Core ML is available on this device, but the configured whisper.cpp binary was not compiled with Core ML support. Rebuild whisper.cpp with Core ML support, rerun with --coreml auto, or rerun with --coreml off.",
        {
          code: "COREML_NOT_COMPILED",
          exitCode: 4,
          details: {
            capabilityId: input.capability.id,
            coreMLStatus: input.capability.coreML.status,
          },
        },
      );
    }
    throw new AppError(
      `Core ML is not runtime-validated for ${input.capability.modelFamily}.`,
      {
        code: "MISSING_DEPENDENCY",
        exitCode: 4,
        details: {
          capabilityId: input.capability.id,
          coreMLStatus: input.capability.coreML.status,
        },
      },
    );
  }
  return await createWhisperCppAdapterForCapability({
    capability: input.capability,
    executablePath: input.executablePath,
    whisperCppVersion: input.whisperCppVersion,
    runner: input.runner,
    logicalCores: input.logicalCores,
    tokenTimestampsAvailable: input.tokenTimestampsAvailable,
    fullJsonAvailable: input.fullJsonAvailable,
    workerPool: input.workerPool,
    ...(input.options.localVadModelPath === undefined
      ? {}
      : { vadModelPath: input.options.localVadModelPath }),
    ...(input.options.useLocalVad === undefined
      ? {}
      : { useVad: input.options.useLocalVad }),
  });
}

function adaptiveSummary(input: {
  plan: TranscriptionPlan;
  quality: TranscriptionQuality;
  refinedIntervals: number;
  canonicalSegmentation?: {
    artifactPath: string;
    rawSegmentCount: number;
    canonicalUtteranceCount: number;
  };
  missingDialogueRecovery?: MissingDialogueRecoveryArtifact;
  lyricsTranscription?: LyricsTranscriptionArtifact;
  acousticScenes?: AcousticScenesArtifact;
  asrRoutingPlan?: AsrRoutingPlanArtifact;
}) {
  return {
    provider: "whisper-cpp",
    strategy: input.plan.strategy,
    coreML: {
      status:
        input.plan.baseline.coreMLCapability?.status ??
        (input.plan.baseline.coreML ? "available" : "disabled-by-user"),
      fallback:
        input.plan.fallbacks.find((fallback) =>
          fallback.reason.startsWith("coreml-"),
        ) ?? null,
    },
    qualitySummary: {
      accepted: input.quality.summary.accepted,
      refined: input.refinedIntervals,
      needsHumanReview: input.quality.needsHumanReviewCount,
      vadNoVadConflicts: input.quality.summary.vadNoVadConflicts,
      resolvedByLargeV3: input.quality.summary.resolvedByLargeV3,
      suspectedHallucinations: input.quality.summary.suspectedHallucinations,
      probableNonSpeech: input.quality.summary.probableNonSpeech,
      autoResolvedVad: input.quality.summary.autoResolvedVad,
      autoResolvedNoVad: input.quality.summary.autoResolvedNoVad,
      autoResolvedLargeV3: input.quality.summary.autoResolvedLargeV3,
      rejectedVadHallucinations:
        input.quality.summary.rejectedVadHallucinations,
      rejectedNoVadHallucinations:
        input.quality.summary.rejectedNoVadHallucinations,
      trueUnresolvedConflicts: input.quality.summary.trueUnresolvedConflicts,
    },
    ...(input.canonicalSegmentation === undefined
      ? {}
      : { canonicalSegmentation: input.canonicalSegmentation }),
    ...(input.missingDialogueRecovery === undefined
      ? {}
      : {
          missingDialogueRecovery: {
            artifactPath: "missing-dialogue-recovery.json",
            ...input.missingDialogueRecovery.summary,
          },
        }),
    ...(input.lyricsTranscription === undefined
      ? {}
      : {
          lyricsTranscription: {
            artifactPath: "lyrics-transcription.json",
            ...input.lyricsTranscription.summary,
          },
        }),
    ...(input.acousticScenes === undefined || input.asrRoutingPlan === undefined
      ? {}
      : {
          sceneAnalysis: {
            windowsArtifactPath: "acoustic-scene-windows.json",
            scenesArtifactPath: "acoustic-scenes.json",
            routingPlanArtifactPath: "asr-routing-plan.json",
            status: input.acousticScenes.status,
            mode: input.asrRoutingPlan.sceneAnalysisMode,
            routingMode: input.asrRoutingPlan.sceneRoutingMode,
            ...input.asrRoutingPlan.summary,
          },
        }),
  } as const;
}

function combineSceneAndQualityIntervals(input: {
  qualityIntervals: readonly {
    interval: { start: number; end: number };
    expandedInterval: { start: number; end: number };
  }[];
  sceneIntervals: readonly SceneAwareRefinementInterval[];
  durationSeconds: number;
  contextSeconds: number;
  maximumSeconds: number;
}): SceneAwareRefinementInterval[] {
  const maximum = Math.min(45, Math.max(1, input.maximumSeconds));
  const sorted: SceneAwareRefinementInterval[] = [
    ...input.qualityIntervals,
    ...input.sceneIntervals,
  ].toSorted(
    (left, right) =>
      left.interval.start - right.interval.start ||
      left.interval.end - right.interval.end,
  );
  const merged: SceneAwareRefinementInterval[] = [];
  for (const candidate of sorted) {
    const previous = merged.at(-1);
    const sceneCompatible =
      previous?.sceneId === undefined ||
      candidate.sceneId === undefined ||
      previous.sceneId === candidate.sceneId;
    if (
      previous !== undefined &&
      sceneCompatible &&
      candidate.interval.start <= previous.interval.end &&
      Math.max(previous.interval.end, candidate.interval.end) -
        previous.interval.start <=
        maximum
    ) {
      previous.interval.end = Math.max(
        previous.interval.end,
        candidate.interval.end,
      );
      if (previous.sceneId === undefined && candidate.sceneId !== undefined) {
        previous.sceneId = candidate.sceneId;
        previous.sceneLabel = candidate.sceneLabel;
        previous.sceneConfidence = candidate.sceneConfidence;
        previous.sceneProbabilities = candidate.sceneProbabilities;
        previous.sceneRoutingReasons = candidate.sceneRoutingReasons;
      }
      continue;
    }
    merged.push({
      ...candidate,
      interval: { ...candidate.interval },
      expandedInterval: { ...candidate.expandedInterval },
    });
  }
  return merged.map((planned) => {
    const contextSeconds = planned.sceneRoutingReasons?.includes(
      "trusted-reference-time-anchor",
    )
      ? Math.min(2, input.contextSeconds)
      : input.contextSeconds;
    const duration = planned.interval.end - planned.interval.start;
    const available = Math.max(0, maximum - duration);
    const before = Math.min(
      contextSeconds,
      available / 2,
      planned.interval.start,
    );
    let start = planned.interval.start - before;
    let end = Math.min(
      input.durationSeconds,
      planned.interval.end + Math.min(contextSeconds, available - before),
    );
    if (end - start > maximum) end = start + maximum;
    if (end < planned.interval.end) {
      end = planned.interval.end;
      start = Math.max(0, end - maximum);
    }
    return {
      ...planned,
      expandedInterval: { start, end },
    };
  });
}

export interface AdaptiveLocalTranscriptionResult {
  cues: SubtitleCue[];
  hypothesisCandidates: SubtitleCue[];
  quality: TranscriptionQuality;
  plan: TranscriptionPlan;
  baselineAdapter: TranscriptionAdapter;
  refinedIntervals: number;
  refinementRoundsExecuted: number;
  cacheHits: number;
  transcribedUnits: number;
  packageTranscription: ReturnType<typeof adaptiveSummary>;
  executionMetrics: WhisperExecutionMetrics;
  canonicalSegmentation: {
    artifactPath: string;
    rawSegmentCount: number;
    canonicalUtteranceCount: number;
  };
  missingDialogueRecovery: MissingDialogueRecoveryArtifact;
  lyricsTranscription: LyricsTranscriptionArtifact;
  vocalRegions: ReturnType<typeof detectSongRegions>;
  supportedLyricsCueIds: string[];
  canonicalIntegrityFindings: FinalSubtitleIntegrityFinding[];
  refinementRecord?: AdaptiveRefinementRecord;
  timingRepairs: ReturnType<typeof repairTranscriptionTimings>["repairs"];
  speechIntervals: { start: number; end: number }[];
  acousticScenes?: AcousticScenesArtifact | undefined;
  asrRoutingPlan?: AsrRoutingPlanArtifact | undefined;
  discoveredSpeechAnchors: DiscoveredSpeechAnchorsArtifact;
  referenceTranscriptionPlan?: ReferenceTranscriptionPlanArtifact | undefined;
  quarantineEvidenceCandidates: {
    id: string;
    interval: { start: number; end: number };
    layer:
      | "raw-vad"
      | "raw-no-vad"
      | "large-v3-refinement"
      | "recovery"
      | "canonical-rejected";
    text?: string;
    repetitionHardError?: boolean;
    speechSupported?: boolean;
    independentProfileSupport?: boolean;
  }[];
}

function overlapSeconds(
  left: { start: number; end: number },
  right: { start: number; end: number },
): number {
  return Math.max(
    0,
    Math.min(left.end, right.end) - Math.max(left.start, right.start),
  );
}

function annotateAdaptiveCueProvenance(input: {
  cues: readonly SubtitleCue[];
  refinementRecord?: AdaptiveRefinementRecord | undefined;
  recovery: MissingDialogueRecoveryArtifact;
  lyrics: LyricsTranscriptionArtifact;
  acousticScenes?: AcousticScenesArtifact | undefined;
  referencePlan?: ReferenceTranscriptionPlanArtifact | undefined;
}): SubtitleCue[] {
  return input.cues.map((cue) => {
    const recoveryUnit = input.recovery.units.find((unit) =>
      cue.id.startsWith(`${unit.id}-recovered-`),
    );
    const lyricsRegion = input.lyrics.regions.find((region) =>
      region.acceptedMusicCues.some((candidate) => candidate.id === cue.id),
    );
    const refinement = input.refinementRecord?.replacements
      .filter(
        (replacement) =>
          replacement.decision.selected !== "baseline" &&
          replacement.decision.selected !== "none" &&
          replacement.decision.selected !== "needs-human-review" &&
          overlapSeconds(replacement.interval, cue) > 0,
      )
      .toSorted(
        (left, right) =>
          overlapSeconds(right.interval, cue) -
          overlapSeconds(left.interval, cue),
      )[0];
    const referenceUnits =
      input.referencePlan?.units.filter(
        (unit) => overlapSeconds(unit.targetInterval, cue) > 0,
      ) ?? [];
    const scene =
      refinement?.sceneId === undefined
        ? input.acousticScenes?.scenes
            .filter((candidate) => overlapSeconds(candidate.interval, cue) > 0)
            .toSorted(
              (left, right) =>
                overlapSeconds(right.interval, cue) -
                overlapSeconds(left.interval, cue),
            )[0]
        : input.acousticScenes?.scenes.find(
            (candidate) => candidate.id === refinement.sceneId,
          );
    const selectedRecoveryAttempt = recoveryUnit?.attempts.find(
      (attempt) => attempt.id === recoveryUnit.selectedAttemptId,
    );
    const sourceLayer =
      recoveryUnit !== undefined
        ? ("recovery" as const)
        : lyricsRegion !== undefined
          ? ("lyrics-asr" as const)
          : refinement?.decision.selected === "no-vad"
            ? ("no-vad" as const)
            : refinement?.decision.selected === "refinement"
              ? ("large-v3-refinement" as const)
              : ("baseline-vad" as const);
    const refinementSupport = [
      refinement?.consensus?.vadSupport ?? 0,
      refinement?.consensus?.noVadSupport ?? 0,
      refinement?.consensus?.refinementSupport ?? 0,
    ].filter((support) => support >= 0.5).length;
    const independentSupportCount =
      lyricsRegion !== undefined
        ? lyricsRegion.independentSupportProfiles.length
        : recoveryUnit !== undefined
          ? recoveryUnit.attempts.filter(
              (attempt) => attempt.decision === "candidate-valid",
            ).length
          : Math.max(1, refinementSupport);
    return {
      ...cue,
      provenance: {
        sourceLayer,
        sourceRequestIds:
          recoveryUnit !== undefined
            ? selectedRecoveryAttempt === undefined
              ? []
              : [selectedRecoveryAttempt.asrRequestId]
            : lyricsRegion !== undefined
              ? lyricsRegion.attempts.map((attempt) => attempt.asrRequestId)
              : [cue.id],
        sourceProfileIds:
          recoveryUnit !== undefined
            ? selectedRecoveryAttempt === undefined
              ? []
              : [selectedRecoveryAttempt.profile]
            : lyricsRegion !== undefined
              ? [...lyricsRegion.independentSupportProfiles]
              : [
                  refinement?.decision.selected === "no-vad"
                    ? "no-vad"
                    : refinement?.decision.selected === "refinement"
                      ? "large-v3"
                      : "baseline-vad",
                ],
        referenceAnchorIds: [
          ...new Set(referenceUnits.flatMap((unit) => unit.anchorIds)),
        ],
        referenceUnitIds: referenceUnits.map((unit) => unit.id),
        recoveryUnitId: recoveryUnit?.id ?? null,
        sceneId: scene?.id ?? refinement?.sceneId ?? null,
        sceneLabel: scene?.label ?? refinement?.sceneLabel ?? null,
        independentSupportCount,
        qualityScore: cue.confidence,
      },
    };
  });
}

export async function runAdaptiveLocalTranscription(input: {
  mediaPath: string;
  taskDirectory: string;
  subtitleDirectory: string;
  sourceInfo: SourceInfo;
  identity: MediaIdentity;
  audioStream: MediaStreamInfo;
  options: VideoSubtitlerOptions;
  runner: ProcessRunner;
  logger: Logger;
  ffmpegPath: string;
  ffprobePath: string;
  overwrite: boolean;
  availableEmbeddedSubtitle: boolean;
  availableReferenceSubtitle: boolean;
  availablePrimarySubtitle: boolean;
  sourceMediaSha256: string;
  referenceTimeline?: ReferenceTimelineArtifact | undefined;
  asrCache?: PortableAsrCache | undefined;
}): Promise<AdaptiveLocalTranscriptionResult | null> {
  const machineQualityRecovery = input.options.machineQualityRecovery ?? "off";
  const targetChunkSeconds = machineQualityTargetChunkSeconds({
    mode: machineQualityRecovery,
    configured: input.options.targetAudioChunkSeconds,
  });
  const language: LanguageTag | undefined =
    input.identity.dialogueLanguages.length === 1
      ? input.identity.dialogueLanguages[0]
      : undefined;
  const media = await profileMedia({
    mediaPath: input.mediaPath,
    durationSeconds: input.sourceInfo.format.durationSeconds,
    dialogueLanguages: input.identity.dialogueLanguages,
    audioTrack: {
      index: input.audioStream.index,
      sampleRate: input.audioStream.sampleRate,
      channels: input.audioStream.channels,
    },
    availableEmbeddedSubtitle: input.availableEmbeddedSubtitle,
    availableReferenceSubtitle: input.availableReferenceSubtitle,
    availablePrimarySubtitle: input.availablePrimarySubtitle,
    runner: input.runner,
    ffmpegPath: input.ffmpegPath,
  });
  const sceneAnalysisMode = input.options.sceneAnalysis ?? "observe";
  const sceneRoutingMode = input.options.sceneRouting ?? "conservative";
  const sceneConfig = {
    ...DEFAULT_ACOUSTIC_SCENE_CONFIG,
    sceneWindowSeconds:
      input.options.sceneWindowSeconds ??
      DEFAULT_ACOUSTIC_SCENE_CONFIG.sceneWindowSeconds,
    sceneHopSeconds:
      input.options.sceneHopSeconds ??
      DEFAULT_ACOUSTIC_SCENE_CONFIG.sceneHopSeconds,
    sceneMinimumDurationSeconds:
      input.options.sceneMinimumDurationSeconds ??
      DEFAULT_ACOUSTIC_SCENE_CONFIG.sceneMinimumDurationSeconds,
    sceneConfidenceThreshold:
      input.options.sceneConfidenceThreshold ??
      DEFAULT_ACOUSTIC_SCENE_CONFIG.sceneConfidenceThreshold,
    nonSpeechSkipConfidence:
      input.options.nonSpeechSkipConfidence ??
      DEFAULT_ACOUSTIC_SCENE_CONFIG.nonSpeechSkipConfidence,
  };
  let acousticScenes: AcousticScenesArtifact | undefined;
  let asrRoutingPlan: AsrRoutingPlanArtifact | undefined;
  if (sceneAnalysisMode !== "off") {
    try {
      const analyzed = await analyzeAcousticScenes({
        mediaPath: input.mediaPath,
        audioStreamIndex: input.audioStream.index,
        mediaDurationSeconds: input.sourceInfo.format.durationSeconds,
        speechIntervals: media.speechIntervals,
        outputDirectory: input.taskDirectory,
        artifactDirectory: input.subtitleDirectory,
        runner: input.runner,
        ffmpegPath: input.ffmpegPath,
        config: sceneConfig,
        overwrite: input.overwrite,
      });
      acousticScenes = analyzed.scenesArtifact;
      asrRoutingPlan = asrRoutingPlanArtifactSchema.parse(
        buildAsrRoutingPlan({
          scenes: acousticScenes.scenes,
          sceneAnalysisMode,
          sceneRoutingMode,
          sceneConfidenceThreshold: sceneConfig.sceneConfidenceThreshold,
        }),
      );
      await atomicWriteJson(
        path.join(input.subtitleDirectory, "asr-routing-plan.json"),
        asrRoutingPlan,
        { overwrite: input.overwrite },
      );
    } catch (error) {
      const failure = error instanceof Error ? error.message : String(error);
      input.logger.log(
        "warning",
        "Acoustic scene analysis failed; continuing with the legacy VAD/no-VAD workflow.",
        { failure },
      );
      const generatedAt = new Date().toISOString();
      const failedWindows = acousticSceneWindowsArtifactSchema.parse({
        schemaVersion: "1.0.0",
        status: "failed",
        generatedAt,
        analysisVersion: ACOUSTIC_SCENE_ANALYSIS_VERSION,
        classifier: {
          id: "existing-evidence-heuristic",
          version: "1.2.0",
          kind: "heuristic",
        },
        config: sceneConfig,
        sourceAudio: null,
        cache: { key: null, hit: false },
        failure,
        windows: [],
      });
      acousticScenes = acousticScenesArtifactSchema.parse({
        schemaVersion: "1.0.0",
        status: "failed",
        generatedAt,
        analysisVersion: ACOUSTIC_SCENE_ANALYSIS_VERSION,
        config: sceneConfig,
        failure,
        scenes: [],
      });
      asrRoutingPlan = asrRoutingPlanArtifactSchema.parse({
        schemaVersion: "1.0.0",
        status: "failed",
        generatedAt,
        sceneAnalysisMode,
        sceneRoutingMode,
        additiveOnly: true,
        selectiveSkipEnabled: false,
        analysisVersion: SCENE_ROUTING_VERSION,
        failure,
        entries: [],
        summary: {
          sceneCount: 0,
          proactiveNoVadScenes: 0,
          proactiveExtraSensitiveVadScenes: 0,
          proactiveLyricsScenes: 0,
          noVadRequests: 0,
          extraSensitiveVadRequests: 0,
          lyricsRequests: 0,
          cacheHits: 0,
        },
      });
      await Promise.all([
        atomicWriteJson(
          path.join(input.subtitleDirectory, "acoustic-scene-windows.json"),
          failedWindows,
          { overwrite: input.overwrite },
        ),
        atomicWriteJson(
          path.join(input.subtitleDirectory, "acoustic-scenes.json"),
          acousticScenes,
          { overwrite: input.overwrite },
        ),
        atomicWriteJson(
          path.join(input.subtitleDirectory, "asr-routing-plan.json"),
          asrRoutingPlan,
          { overwrite: input.overwrite },
        ),
      ]);
    }
  }
  const sceneBoundaries = [
    ...input.sourceInfo.chapters.flatMap((chapter) =>
      chapter.start === null || chapter.start <= 0 ? [] : [chapter.start],
    ),
    ...(sceneAnalysisMode === "route" && acousticScenes?.status === "completed"
      ? acousticScenes.scenes
          .map((scene) => scene.interval.start)
          .filter((start) => start > 0)
      : []),
  ].toSorted((left, right) => left - right);
  const referenceTranscriptionPlan =
    input.referenceTimeline === undefined
      ? undefined
      : buildReferenceTranscriptionPlan({
          timeline: input.referenceTimeline,
          ...(input.options.referenceDialogueUnitMaxSeconds === undefined
            ? {}
            : {
                dialogueUnitMaxSeconds:
                  input.options.referenceDialogueUnitMaxSeconds,
              }),
          ...(input.options.referenceNarrationUnitMaxSeconds === undefined
            ? {}
            : {
                narrationUnitMaxSeconds:
                  input.options.referenceNarrationUnitMaxSeconds,
              }),
          ...(input.options.referenceLyricsUnitMaxSeconds === undefined
            ? {}
            : {
                lyricsUnitMaxSeconds:
                  input.options.referenceLyricsUnitMaxSeconds,
              }),
          ...(input.options.referenceDenseAnchorLimit === undefined
            ? {}
            : {
                denseAnchorLimit: input.options.referenceDenseAnchorLimit,
              }),
          ...(acousticScenes?.status === "completed"
            ? { scenes: acousticScenes.scenes }
            : {}),
        });
  if (referenceTranscriptionPlan !== undefined) {
    await atomicWriteJson(
      path.join(input.subtitleDirectory, "reference-transcription-plan.json"),
      referenceTranscriptionPlan,
      { overwrite: input.overwrite },
    );
  }
  const sample = await extractWhisperBenchmarkSample({
    mediaPath: input.mediaPath,
    audioStreamIndex: input.audioStream.index,
    outputDirectory: input.taskDirectory,
    runner: input.runner,
    ffmpegPath: input.ffmpegPath,
    speechIntervals: media.speechIntervals,
    sampleAudioSeconds: 45,
    mediaDurationSeconds: input.sourceInfo.format.durationSeconds,
  });
  const device = await profileDevice({
    runner: input.runner,
    ffmpegPath: input.ffmpegPath,
    ffprobePath: input.ffprobePath,
    sampleAudioPath: sample.path,
    ...(input.options.whisperCppPath === undefined
      ? {}
      : { whisperCppPath: input.options.whisperCppPath }),
    ...(input.options.localTranscriptionModelPath === undefined
      ? {}
      : { modelPath: input.options.localTranscriptionModelPath }),
    ...(input.options.localTranscriptionModelDirectory === undefined
      ? {}
      : {
          modelDirectory: input.options.localTranscriptionModelDirectory,
        }),
    includeDefaultModelDirectories:
      input.options.localTranscriptionModelDirectory === undefined &&
      input.options.localTranscriptionModelPath === undefined &&
      process.env.WHISPER_MODEL_PATH === undefined &&
      process.env.WHISPER_MODEL_DIR === undefined &&
      process.env.WHISPER_MODEL_DIRECTORY === undefined,
  });
  await Promise.all([
    atomicWriteJson(
      path.join(input.subtitleDirectory, "device-profile.json"),
      device,
      { overwrite: input.overwrite },
    ),
    atomicWriteJson(
      path.join(input.subtitleDirectory, "media-profile.json"),
      media,
      { overwrite: input.overwrite },
    ),
  ]);
  if (
    !device.whisperCpp.available ||
    device.whisperCpp.executablePath === null ||
    device.models.length === 0
  ) {
    return null;
  }
  const hasAdaptivePlannerFamily = device.models.some((capability) =>
    ["large-v3", "large-v3-turbo"].includes(capability.modelFamily),
  );
  if (
    !hasAdaptivePlannerFamily &&
    (input.options.transcriptionStrategy ?? "auto") === "auto" &&
    (input.options.coreML ?? "auto") !== "on"
  ) {
    // Preserve the established low-memory/smaller-model resolver when the new
    // high-quality/adaptive families are not installed.
    return null;
  }
  const executablePath = device.whisperCpp.executablePath;
  const whisperCppVersion = device.whisperCpp.version ?? "unknown";
  const candidates = benchmarkCandidates(device.models, input.options.coreML);
  const benchmark = await runWhisperBenchmark({
    mode: input.options.benchmark ?? "auto",
    deviceFingerprint: device.fingerprint,
    whisperCppVersion,
    capabilities: candidates,
    sampleAudioSeconds: sample.duration,
    runCandidate: async (capability) => {
      const adapter = await createWhisperCppAdapterForCapability({
        capability,
        executablePath,
        whisperCppVersion,
        runner: input.runner,
        logicalCores: device.cpu.logicalCores,
        useVad: false,
      });
      const started = performance.now();
      await adapter.transcribe({
        audioPath: sample.path,
        chunk: {
          id: "benchmark-sample",
          relativePath: path.basename(sample.path),
          start: 0,
          end: sample.duration,
          duration: sample.duration,
          sha256: capability.modelHash,
        },
        timestampStrategy: "segment",
        ...(language === undefined ? {} : { language }),
      });
      return (performance.now() - started) / 1000;
    },
  });
  await atomicWriteJson(
    path.join(input.subtitleDirectory, "whisper-benchmark.json"),
    benchmark,
    { overwrite: input.overwrite },
  );
  let plan = planTranscription({
    device,
    media,
    benchmark,
    strategy: input.options.transcriptionStrategy ?? "auto",
    coreML: input.options.coreML ?? "auto",
    maxFullQualityRuntimeSeconds:
      input.options.maxFullQualityRuntimeSeconds ?? 300,
    maxRefinementRounds: input.options.maxRefinementRounds ?? 2,
    refinementContextSeconds: input.options.refinementContextSeconds ?? 5,
    refinementMergeGapSeconds: input.options.refinementMergeGapSeconds ?? 1.5,
    maxMergedRefinementSeconds: input.options.maxMergedRefinementSeconds ?? 30,
    noVadTieBreakBonus: input.options.noVadTieBreakBonus ?? 0.04,
    fullSecondPass: input.options.fullSecondPass ?? false,
    refineFast: input.options.refine ?? false,
    allowQualityFallback: input.options.allowQualityFallback ?? false,
  });
  const workerPool = new WhisperCppWorkerPool({
    mode: input.options.whisperExecutionMode ?? "auto",
  });
  try {
    let baselineCapability = capabilityFor(
      device.models,
      plan.baseline.capabilityId,
    );
    let baselineAdapter = await createAdapter({
      capability: baselineCapability,
      executablePath,
      whisperCppVersion,
      runner: input.runner,
      options: input.options,
      logicalCores: device.cpu.logicalCores,
      tokenTimestampsAvailable:
        device.whisperCpp.tokenTimestampsAvailable ?? false,
      fullJsonAvailable: device.whisperCpp.fullJsonAvailable ?? false,
      workerPool,
    });
    await atomicWriteJson(
      path.join(input.subtitleDirectory, "transcription-plan.json"),
      plan,
      { overwrite: input.overwrite },
    );

    let baseline;
    try {
      baseline = await transcribeMedia({
        mediaPath: input.mediaPath,
        outputDirectory: input.taskDirectory,
        audioStreamIndex: input.audioStream.index,
        durationSeconds: input.sourceInfo.format.durationSeconds,
        adapter: baselineAdapter,
        runner: input.runner,
        logger: input.logger,
        ffmpegPath: input.ffmpegPath,
        overwrite: input.overwrite,
        timestampStrategy: "segment",
        speechIntervals: media.speechIntervals,
        sceneBoundaries,
        canonicalArtifactPath: path.join(
          input.subtitleDirectory,
          "canonical-asr-segments.json",
        ),
        ...(input.options.timingQaConfig === undefined
          ? {}
          : { timingConfig: input.options.timingQaConfig }),
        ...(language === undefined ? {} : { language }),
        ...(targetChunkSeconds === undefined
          ? {}
          : {
              targetChunkSeconds,
            }),
        promptNames: promptNames(
          input.identity,
          input.options.transcriptionPromptNames ?? [],
        ),
        ...(input.asrCache === undefined ? {} : { asrCache: input.asrCache }),
      });
    } catch (error) {
      if (
        !baselineCapability.coreML.supported ||
        input.options.coreML === "on"
      ) {
        throw error;
      }
      const cpuFallback = device.models.find(
        (capability) =>
          capability.modelPath === baselineCapability.modelPath &&
          capability.runtime === "cpu",
      );
      if (cpuFallback === undefined) throw error;
      const failedCoreMLCapability = {
        ...baselineCapability.coreML,
        supported: false,
        status: "load-failed" as const,
        runtimeValidated: false,
        reason: error instanceof Error ? error.message : String(error),
      };
      plan = transcriptionPlanSchema.parse({
        ...plan,
        baseline: {
          ...plan.baseline,
          capabilityId: cpuFallback.id,
          coreML: false,
          coreMLCapability: failedCoreMLCapability,
        },
        fallbacks: [
          ...plan.fallbacks,
          {
            from: baselineCapability.id,
            to: cpuFallback.id,
            reason: "coreml-runtime-failure",
          },
        ],
        reason: [...plan.reason, "coreml-runtime-failure-cpu-fallback"],
      });
      baselineCapability = cpuFallback;
      baselineAdapter = await createAdapter({
        capability: baselineCapability,
        executablePath,
        whisperCppVersion,
        runner: input.runner,
        options: input.options,
        logicalCores: device.cpu.logicalCores,
        tokenTimestampsAvailable:
          device.whisperCpp.tokenTimestampsAvailable ?? false,
        fullJsonAvailable: device.whisperCpp.fullJsonAvailable ?? false,
        workerPool,
      });
      await atomicWriteJson(
        path.join(input.subtitleDirectory, "transcription-plan.json"),
        plan,
        { overwrite: true },
      );
      baseline = await transcribeMedia({
        mediaPath: input.mediaPath,
        outputDirectory: input.taskDirectory,
        audioStreamIndex: input.audioStream.index,
        durationSeconds: input.sourceInfo.format.durationSeconds,
        adapter: baselineAdapter,
        runner: input.runner,
        logger: input.logger,
        ffmpegPath: input.ffmpegPath,
        overwrite: true,
        timestampStrategy: "segment",
        speechIntervals: media.speechIntervals,
        sceneBoundaries,
        canonicalArtifactPath: path.join(
          input.subtitleDirectory,
          "canonical-asr-segments.json",
        ),
        ...(input.options.timingQaConfig === undefined
          ? {}
          : { timingConfig: input.options.timingQaConfig }),
        ...(language === undefined ? {} : { language }),
        promptNames: promptNames(
          input.identity,
          input.options.transcriptionPromptNames ?? [],
        ),
        ...(input.asrCache === undefined ? {} : { asrCache: input.asrCache }),
      });
    }

    const baselineQuality = evaluateTranscriptionQuality({
      cues: baseline.cues,
      speechIntervals: media.speechIntervals,
      expectedLanguages: input.identity.dialogueLanguages,
      timingConfig: input.options.timingQaConfig,
    });
    const comparisonContextSeconds = Math.max(
      5,
      input.options.refinementContextSeconds ?? 5,
    );
    const comparisonMaximumSeconds =
      input.options.maxMergedRefinementSeconds ?? 30;
    const qualityNoVadIntervals = refinementIntervals({
      quality: baselineQuality,
      durationSeconds: input.sourceInfo.format.durationSeconds,
      contextSeconds: comparisonContextSeconds,
      mergeGapSeconds: input.options.refinementMergeGapSeconds ?? 1.5,
      maxMergedRefinementSeconds: comparisonMaximumSeconds,
      speechIntervals: media.speechIntervals,
    });
    const referenceNoVadIntervals: SceneAwareRefinementInterval[] =
      referenceTranscriptionPlan?.units.flatMap((unit) =>
        [
          "reference-extra-sensitive-vad",
          "reference-vad-plus-no-vad",
          "reference-lyrics",
        ].includes(unit.strategy)
          ? [
              {
                interval: { ...unit.targetInterval },
                expandedInterval: { ...unit.extractionInterval },
                ...(unit.sceneId === undefined
                  ? {}
                  : { sceneId: unit.sceneId }),
                ...(unit.sceneLabel === undefined
                  ? {}
                  : { sceneLabel: unit.sceneLabel }),
                sceneRoutingReasons: [
                  ...unit.reasons,
                  "reference-text-not-used-as-target-prompt",
                ],
                referenceAnchorIds: [...unit.anchorIds],
              },
            ]
          : [],
      ) ?? [];
    const referenceExtraSensitiveIntervals: SceneAwareRefinementInterval[] =
      referenceTranscriptionPlan?.units.flatMap((unit) =>
        unit.strategy === "reference-extra-sensitive-vad"
          ? [
              {
                interval: { ...unit.targetInterval },
                expandedInterval: { ...unit.extractionInterval },
                ...(unit.sceneId === undefined
                  ? {}
                  : { sceneId: unit.sceneId }),
                ...(unit.sceneLabel === undefined
                  ? {}
                  : { sceneLabel: unit.sceneLabel }),
                sceneRoutingReasons: [
                  ...unit.reasons,
                  "reference-text-not-used-as-target-prompt",
                ],
                referenceAnchorIds: [...unit.anchorIds],
              },
            ]
          : [],
      ) ?? [];
    const sceneNoVadIntervals = [
      ...(asrRoutingPlan === undefined
        ? []
        : buildSceneRoutedIntervals({
            plan: asrRoutingPlan,
            profile: "no-vad",
            mediaDurationSeconds: input.sourceInfo.format.durationSeconds,
            contextSeconds: comparisonContextSeconds,
            maximumSeconds: comparisonMaximumSeconds,
          })),
      ...referenceNoVadIntervals,
    ];
    const sceneExtraSensitiveIntervals = [
      ...(asrRoutingPlan === undefined
        ? []
        : buildSceneRoutedIntervals({
            plan: asrRoutingPlan,
            profile: "extra-sensitive-vad",
            mediaDurationSeconds: input.sourceInfo.format.durationSeconds,
            contextSeconds: comparisonContextSeconds,
            maximumSeconds: comparisonMaximumSeconds,
          })),
      ...referenceExtraSensitiveIntervals,
    ];
    let noVadTargeted:
      Awaited<ReturnType<typeof transcribeIntervalsForComparison>> | undefined;
    let extraSensitiveTargeted:
      Awaited<ReturnType<typeof transcribeIntervalsForComparison>> | undefined;
    let noVadIntervals: SceneAwareRefinementInterval[] = [];
    if (
      baselineAdapter.model.includes("vad-sensitive") &&
      sceneExtraSensitiveIntervals.length > 0
    ) {
      const extraSensitiveAdapter = await createWhisperCppAdapterForCapability({
        capability: baselineCapability,
        executablePath,
        whisperCppVersion,
        runner: input.runner,
        logicalCores: device.cpu.logicalCores,
        tokenTimestampsAvailable:
          device.whisperCpp.tokenTimestampsAvailable ?? false,
        fullJsonAvailable: device.whisperCpp.fullJsonAvailable ?? false,
        ...(input.options.localVadModelPath === undefined
          ? {}
          : { vadModelPath: input.options.localVadModelPath }),
        useVad: true,
        vadProfile: "extra-sensitive-v1",
        workerPool,
      });
      extraSensitiveTargeted = await transcribeIntervalsForComparison({
        mediaPath: input.mediaPath,
        outputDirectory: path.join(
          input.taskDirectory,
          "scene-extra-sensitive-vad",
        ),
        audioStreamIndex: input.audioStream.index,
        adapter: extraSensitiveAdapter,
        runner: input.runner,
        ffmpegPath: input.ffmpegPath,
        intervals: sceneExtraSensitiveIntervals,
        contextCues: baseline.cues,
        allowContextTextPrompt: allowRefinementContextPromptForMachineQuality(
          machineQualityRecovery,
        ),
        ...(language === undefined ? {} : { language }),
        promptNames: promptNames(
          input.identity,
          input.options.transcriptionPromptNames ?? [],
        ),
        ...(input.asrCache === undefined ? {} : { asrCache: input.asrCache }),
      });
      if (asrRoutingPlan !== undefined) {
        const sceneIds = [
          ...new Set(
            sceneExtraSensitiveIntervals.flatMap((interval) =>
              interval.sceneId === undefined ? [] : [interval.sceneId],
            ),
          ),
        ];
        for (const [sceneIndex, sceneId] of sceneIds.entries()) {
          const requestIds = sceneExtraSensitiveIntervals.flatMap(
            (interval, index) =>
              interval.sceneId === sceneId
                ? [
                    `${sceneId}:extra-sensitive-vad:${String(index + 1).padStart(4, "0")}`,
                  ]
                : [],
          );
          asrRoutingPlan = recordAsrRoutingExecution({
            plan: asrRoutingPlan,
            sceneId,
            profile: "extra-sensitive-vad",
            requestIds,
            cacheHits: sceneIndex === 0 ? extraSensitiveTargeted.cacheHits : 0,
          });
        }
      }
    }
    if (
      (baselineAdapter.model.includes("vad-sensitive") ||
        referenceNoVadIntervals.length > 0) &&
      (qualityNoVadIntervals.length > 0 || sceneNoVadIntervals.length > 0)
    ) {
      const noVadAdapter = await createWhisperCppAdapterForCapability({
        capability: baselineCapability,
        executablePath,
        whisperCppVersion,
        runner: input.runner,
        logicalCores: device.cpu.logicalCores,
        tokenTimestampsAvailable:
          device.whisperCpp.tokenTimestampsAvailable ?? false,
        fullJsonAvailable: device.whisperCpp.fullJsonAvailable ?? false,
        useVad: false,
        workerPool,
      });
      noVadIntervals = combineSceneAndQualityIntervals({
        qualityIntervals: qualityNoVadIntervals,
        sceneIntervals: sceneNoVadIntervals,
        durationSeconds: input.sourceInfo.format.durationSeconds,
        contextSeconds: comparisonContextSeconds,
        maximumSeconds: comparisonMaximumSeconds,
      });
      noVadTargeted = await transcribeIntervalsForComparison({
        mediaPath: input.mediaPath,
        outputDirectory: path.join(input.taskDirectory, "vad-no-vad"),
        audioStreamIndex: input.audioStream.index,
        adapter: noVadAdapter,
        runner: input.runner,
        ffmpegPath: input.ffmpegPath,
        intervals: noVadIntervals,
        contextCues: baseline.cues,
        allowContextTextPrompt: allowRefinementContextPromptForMachineQuality(
          machineQualityRecovery,
        ),
        ...(language === undefined ? {} : { language }),
        promptNames: promptNames(
          input.identity,
          input.options.transcriptionPromptNames ?? [],
        ),
        ...(input.asrCache === undefined ? {} : { asrCache: input.asrCache }),
      });
      if (asrRoutingPlan !== undefined) {
        const sceneIds = [
          ...new Set(
            noVadIntervals.flatMap((interval) =>
              interval.sceneId === undefined ? [] : [interval.sceneId],
            ),
          ),
        ];
        for (const [sceneIndex, sceneId] of sceneIds.entries()) {
          const requestIds = noVadIntervals.flatMap((interval, index) =>
            interval.sceneId === sceneId
              ? [`${sceneId}:no-vad:${String(index + 1).padStart(4, "0")}`]
              : [],
          );
          asrRoutingPlan = recordAsrRoutingExecution({
            plan: asrRoutingPlan,
            sceneId,
            profile: "no-vad",
            requestIds,
            cacheHits: sceneIndex === 0 ? noVadTargeted.cacheHits : 0,
          });
        }
      }
    }
    if (asrRoutingPlan !== undefined) {
      await atomicWriteJson(
        path.join(input.subtitleDirectory, "asr-routing-plan.json"),
        asrRoutingPlanArtifactSchema.parse(asrRoutingPlan),
        { overwrite: true },
      );
    }
    const vadNoVadComparisons =
      noVadTargeted === undefined
        ? []
        : compareVadNoVadTranscripts({
            vadCues: baseline.cues.filter((cue) =>
              noVadIntervals.some(
                (planned) =>
                  cue.start < planned.interval.end &&
                  planned.interval.start < cue.end,
              ),
            ),
            noVadCues: noVadTargeted.cues,
            vadSpeechIntervals: media.speechIntervals,
            highBackgroundNoise:
              media.musicHeavy ||
              noVadIntervals.some(
                (interval) => interval.sceneLabel === "noisy-dialogue",
              ),
            model: baselineAdapter.model,
            mergeGapSeconds: input.options.refinementMergeGapSeconds ?? 1.5,
            boundaryDisagreementSeconds:
              input.options.timingQaConfig?.vadNoVadBoundaryDisagreementSeconds,
          });
    if (
      vadNoVadComparisons.some((comparison) => comparison.vadNoVadConflict) &&
      plan.refinement === null
    ) {
      const mandatoryLargeV3 = device.models
        .filter(
          (capability) =>
            capability.modelFamily === "large-v3" &&
            (capability.runtime === "cpu" ||
              (capability.coreML.status === "available" &&
                capability.coreML.runtimeValidated)),
        )
        .toSorted(
          (left, right) =>
            Number(right.runtime === "coreml") -
              Number(left.runtime === "coreml") ||
            Number(left.quantization !== null) -
              Number(right.quantization !== null),
        )[0];
      if (mandatoryLargeV3 !== undefined) {
        const diagnostic =
          mandatoryLargeV3.runtime === "coreml"
            ? mandatoryLargeV3.coreML
            : (device.models.find(
                (candidate) =>
                  candidate.runtime === "coreml" &&
                  candidate.modelPath === mandatoryLargeV3.modelPath,
              )?.coreML ?? mandatoryLargeV3.coreML);
        plan = transcriptionPlanSchema.parse({
          ...plan,
          refinement: {
            capabilityId: mandatoryLargeV3.id,
            modelFamily: mandatoryLargeV3.modelFamily,
            model: path.basename(mandatoryLargeV3.modelPath),
            coreML: mandatoryLargeV3.runtime === "coreml",
            coreMLCapability: diagnostic,
            role: "refinement",
            fallbackCoreML: mandatoryLargeV3.runtime !== "coreml",
            maxRounds: input.options.maxRefinementRounds ?? 2,
            contextSeconds: Math.max(
              5,
              input.options.refinementContextSeconds ?? 5,
            ),
            mergeGapSeconds: input.options.refinementMergeGapSeconds ?? 1.5,
            maxMergedRefinementSeconds: Math.min(
              45,
              input.options.maxMergedRefinementSeconds ?? 30,
            ),
            noVadTieBreakBonus: input.options.noVadTieBreakBonus ?? 0.04,
          },
          reason: [
            ...plan.reason,
            "vad-no-vad-conflict-mandatory-large-v3-refinement",
          ],
        });
        await atomicWriteJson(
          path.join(input.subtitleDirectory, "transcription-plan.json"),
          plan,
          { overwrite: true },
        );
      }
    }

    const timingRepair = repairTranscriptionTimings({
      cues: baseline.cues,
      speechIntervals: media.speechIntervals,
      mediaDurationSeconds: input.sourceInfo.format.durationSeconds,
      timingConfig: input.options.timingQaConfig,
      speechBoundarySource: media.profilingMethod === "vad" ? "vad" : "silence",
    });
    let cues = timingRepair.cues;
    let quality = evaluateTranscriptionQuality({
      cues,
      speechIntervals: media.speechIntervals,
      expectedLanguages: input.identity.dialogueLanguages,
      vadNoVadComparisons,
      timingConfig: input.options.timingQaConfig,
    });
    let refinedIntervals = 0;
    let refinementCacheHits = 0;
    let refinementTranscribed = 0;
    let refinementRoundsExecuted = 0;
    let refinementRecord: AdaptiveRefinementRecord | undefined;
    if (plan.refinement !== null) {
      let refinementCapability = capabilityFor(
        device.models,
        plan.refinement.capabilityId,
      );
      let refinementAdapter = await createAdapter({
        capability: refinementCapability,
        executablePath,
        whisperCppVersion,
        runner: input.runner,
        options: input.options,
        logicalCores: device.cpu.logicalCores,
        tokenTimestampsAvailable:
          device.whisperCpp.tokenTimestampsAvailable ?? false,
        fullJsonAvailable: device.whisperCpp.fullJsonAvailable ?? false,
        workerPool,
      });
      const refine = async () =>
        await runTargetedRefinement({
          mediaPath: input.mediaPath,
          outputDirectory: input.taskDirectory,
          audioStreamIndex: input.audioStream.index,
          durationSeconds: input.sourceInfo.format.durationSeconds,
          baselineCues: cues,
          baselineAdapter,
          refinementAdapter,
          plan,
          runner: input.runner,
          logger: input.logger,
          ffmpegPath: input.ffmpegPath,
          speechIntervals: media.speechIntervals,
          vadNoVadComparisons,
          ...(sceneAnalysisMode === "route" &&
          acousticScenes?.status === "completed"
            ? { acousticScenes: acousticScenes.scenes }
            : {}),
          timingConfig: input.options.timingQaConfig,
          promptNames: promptNames(
            input.identity,
            input.options.transcriptionPromptNames ?? [],
          ),
          allowContextTextPrompt: allowRefinementContextPromptForMachineQuality(
            machineQualityRecovery,
          ),
          ...(language === undefined ? {} : { language }),
          ...(input.asrCache === undefined ? {} : { asrCache: input.asrCache }),
        });
      let refined: Awaited<ReturnType<typeof runTargetedRefinement>>;
      try {
        refined = await refine();
      } catch (error) {
        if (
          !refinementCapability.coreML.supported ||
          input.options.coreML === "on"
        ) {
          throw error;
        }
        const cpuFallback = device.models.find(
          (capability) =>
            capability.modelPath === refinementCapability.modelPath &&
            capability.runtime === "cpu",
        );
        if (cpuFallback === undefined) throw error;
        const failedCoreMLCapability = {
          ...refinementCapability.coreML,
          supported: false,
          status: "load-failed" as const,
          runtimeValidated: false,
          reason: error instanceof Error ? error.message : String(error),
        };
        plan = transcriptionPlanSchema.parse({
          ...plan,
          refinement: {
            ...plan.refinement,
            capabilityId: cpuFallback.id,
            coreML: false,
            coreMLCapability: failedCoreMLCapability,
            fallbackCoreML: true,
          },
          fallbacks: [
            ...plan.fallbacks,
            {
              from: refinementCapability.id,
              to: cpuFallback.id,
              reason: "coreml-refinement-runtime-failure",
            },
          ],
          reason: [
            ...plan.reason,
            "coreml-refinement-runtime-failure-cpu-fallback",
          ],
        });
        refinementCapability = cpuFallback;
        refinementAdapter = await createAdapter({
          capability: refinementCapability,
          executablePath,
          whisperCppVersion,
          runner: input.runner,
          options: input.options,
          logicalCores: device.cpu.logicalCores,
          tokenTimestampsAvailable:
            device.whisperCpp.tokenTimestampsAvailable ?? false,
          fullJsonAvailable: device.whisperCpp.fullJsonAvailable ?? false,
          workerPool,
        });
        await atomicWriteJson(
          path.join(input.subtitleDirectory, "transcription-plan.json"),
          plan,
          { overwrite: true },
        );
        refined = await refine();
      }
      cues = refined.cues;
      quality = refined.quality;
      refinedIntervals = refined.corrections.replacements.filter(
        (replacement) => replacement.reviewStatus === "accepted",
      ).length;
      refinementCacheHits = refined.cacheHits;
      refinementTranscribed = refined.transcribedIntervals;
      refinementRoundsExecuted = refined.record.roundsExecuted;
      refinementRecord = refined.record;
      await Promise.all([
        atomicWriteJson(
          path.join(input.subtitleDirectory, "transcription-refinement.json"),
          refined.record,
          { overwrite: input.overwrite },
        ),
        atomicWriteJson(
          path.join(input.subtitleDirectory, "transcription-corrections.json"),
          refined.corrections,
          { overwrite: input.overwrite },
        ),
      ]);
    } else {
      quality = finalizeQualityWithoutRefinement(quality);
    }
    const preRecoveryQuality = quality;
    const preliminaryReview = buildFinalReviewQueue({
      historicalQuality: quality,
      postPresentationQuality: quality,
      finalCues: cues,
      refinementRecord,
      timingRepairs: timingRepair.repairs,
      speechIntervals: media.speechIntervals,
      sceneBoundaries,
      reviewGroupGapSeconds: input.options.reviewGroupGapSeconds ?? 0.75,
    });
    const canonicalArtifact = (await readJson(
      baseline.canonicalArtifactPath,
    )) as {
      rawSegments?: { start?: number; end?: number }[];
      utterances?: {
        id: string;
        start: number;
        end: number;
        text: string;
        qualityStatus?: "accepted" | "suspected-hallucination";
        qualityReasons?: string[];
        repetitionEvidence?: {
          normalizedCorePhrase: string;
          occurrences: number;
          contributingSegmentIds: string[];
          suffixVariants: string[];
          repeatedCharacterRatio: number;
        };
      }[];
    };
    const canonicalIntegrityFindings =
      buildCanonicalHallucinationIntegrityFindings(
        canonicalArtifact.utterances ?? [],
      );
    const rawSegmentBoundaries = (canonicalArtifact.rawSegments ?? []).flatMap(
      (segment) =>
        typeof segment.start === "number" && typeof segment.end === "number"
          ? [segment.start, segment.end]
          : [],
    );
    const acceptedCueIds = new Set(
      quality.segments.flatMap((segment) =>
        ["accepted", "accepted-after-refinement"].includes(segment.status) &&
        segment.cueId !== null
          ? [segment.cueId]
          : [],
      ),
    );
    const discoveredSpeechAnchors = discoverSpeechAnchors({
      sourceAudioSha256: input.sourceMediaSha256,
      speechIntervals: media.speechIntervals,
      ...(acousticScenes?.status === "completed"
        ? { acousticScenes: acousticScenes.scenes }
        : {}),
      baselineCues: cues,
      ...(noVadTargeted === undefined ? {} : { noVadCues: noVadTargeted.cues }),
      ...(extraSensitiveTargeted === undefined
        ? {}
        : { extraSensitiveCues: extraSensitiveTargeted.cues }),
    });
    await atomicWriteJson(
      path.join(input.subtitleDirectory, "discovered-speech-anchors.json"),
      discoveredSpeechAnchors,
      { overwrite: input.overwrite },
    );
    const reliableCues = cues.filter((cue) => acceptedCueIds.has(cue.id));
    const requiredRecoveryIntervals = [
      ...uncoveredDiscoveredAnchorRequirements({
        artifact: discoveredSpeechAnchors,
        reliableCues,
      }),
      ...(referenceTranscriptionPlan === undefined
        ? []
        : referenceRecoveryRequirements(referenceTranscriptionPlan)),
    ];
    const recoveryUnits = planMissingDialogueRecovery({
      reviewQueue: preliminaryReview.queue,
      speechIntervals: media.speechIntervals,
      sceneBoundaries,
      rawSegmentBoundaries,
      reliableCues,
      requiredIntervals: requiredRecoveryIntervals,
      mediaDurationSeconds: input.sourceInfo.format.durationSeconds,
      maximumActualWavSeconds: 30,
      maximumUnitSeconds: 20,
      preferredContextSeconds: 5,
      ...(sceneAnalysisMode === "route" &&
      acousticScenes?.status === "completed"
        ? { acousticScenes: acousticScenes.scenes }
        : {}),
    });
    const largeV3Capability =
      device.models.find(
        (capability) =>
          capability.id ===
            (plan.refinement?.capabilityId ?? plan.baseline.capabilityId) &&
          capability.modelFamily === "large-v3",
      ) ??
      device.models
        .filter(
          (capability) =>
            capability.modelFamily === "large-v3" &&
            (capability.runtime === "cpu" ||
              (capability.coreML.status === "available" &&
                capability.coreML.runtimeValidated)),
        )
        .toSorted(
          (left, right) =>
            Number(right.runtime === "coreml") -
              Number(left.runtime === "coreml") ||
            Number(left.quantization !== null) -
              Number(right.quantization !== null),
        )[0];
    const recoveryProfiles =
      recoveryUnits.length === 0 || largeV3Capability === undefined
        ? []
        : await Promise.all([
            createWhisperCppAdapterForCapability({
              capability: largeV3Capability,
              executablePath,
              runner: input.runner,
              whisperCppVersion,
              logicalCores: device.cpu.logicalCores,
              tokenTimestampsAvailable:
                device.whisperCpp.tokenTimestampsAvailable ?? false,
              fullJsonAvailable: device.whisperCpp.fullJsonAvailable ?? false,
              ...(input.options.localVadModelPath === undefined
                ? {}
                : { vadModelPath: input.options.localVadModelPath }),
              useVad: true,
              vadProfile: "sensitive-v2",
              workerPool,
            }),
            createWhisperCppAdapterForCapability({
              capability: largeV3Capability,
              executablePath,
              runner: input.runner,
              whisperCppVersion,
              logicalCores: device.cpu.logicalCores,
              tokenTimestampsAvailable:
                device.whisperCpp.tokenTimestampsAvailable ?? false,
              fullJsonAvailable: device.whisperCpp.fullJsonAvailable ?? false,
              ...(input.options.localVadModelPath === undefined
                ? {}
                : { vadModelPath: input.options.localVadModelPath }),
              useVad: true,
              vadProfile: "extra-sensitive-v1",
              workerPool,
            }),
            createWhisperCppAdapterForCapability({
              capability: largeV3Capability,
              executablePath,
              runner: input.runner,
              whisperCppVersion,
              logicalCores: device.cpu.logicalCores,
              tokenTimestampsAvailable:
                device.whisperCpp.tokenTimestampsAvailable ?? false,
              fullJsonAvailable: device.whisperCpp.fullJsonAvailable ?? false,
              ...(input.options.localVadModelPath === undefined
                ? {}
                : { vadModelPath: input.options.localVadModelPath }),
              useVad: false,
              workerPool,
            }),
          ]);
    const recovery = await runMissingDialogueRecovery({
      mediaPath: input.mediaPath,
      audioStreamIndex: input.audioStream.index,
      outputDirectory: input.taskDirectory,
      units: recoveryUnits,
      profiles: recoveryProfiles.map((adapter, index) => ({
        profile:
          index === 0
            ? ("current-sensitive-vad" as const)
            : index === 1
              ? ("extra-sensitive-vad" as const)
              : ("no-vad" as const),
        adapter,
        vadEnabled: index !== 2,
      })),
      // Recovery prompts are decode constraints, not harmless context. The
      // legacy path admitted every provisional cue and could amplify a single
      // false-positive baseline into every local recovery request. C6.0.1.1
      // enforce therefore performs acoustic recovery without unverified text
      // prompts. Off/observe deliberately preserve the legacy behavior.
      existingCues: recoveryPromptCuesForMachineQuality({
        mode: machineQualityRecovery,
        provisionalCues: cues,
      }),
      speechIntervals: media.speechIntervals,
      mediaDurationSeconds: input.sourceInfo.format.durationSeconds,
      runner: input.runner,
      logger: input.logger,
      ffmpegPath: input.ffmpegPath,
      confirmedNames: promptNames(
        input.identity,
        input.options.transcriptionPromptNames ?? [],
      ),
      highBackgroundNoise: media.musicHeavy,
      ...(language === undefined ? {} : { language }),
      ...(input.asrCache === undefined ? {} : { asrCache: input.asrCache }),
    });
    const parsedRecovery = missingDialogueRecoveryArtifactSchema.parse(
      recovery.artifact,
    ) as MissingDialogueRecoveryArtifact;
    const vocalRegions = detectSongRegions({
      recovery: parsedRecovery,
      speechIntervals: media.speechIntervals,
      mediaDurationSeconds: input.sourceInfo.format.durationSeconds,
      musicHeavy: media.musicHeavy,
      ...(sceneAnalysisMode === "route" &&
      acousticScenes?.status === "completed"
        ? { acousticScenes: acousticScenes.scenes }
        : {}),
    });
    const noVadLyricsAdapter =
      recoveryProfiles.at(2) ??
      (vocalRegions.length === 0 || largeV3Capability === undefined
        ? undefined
        : await createWhisperCppAdapterForCapability({
            capability: largeV3Capability,
            executablePath,
            runner: input.runner,
            whisperCppVersion,
            logicalCores: device.cpu.logicalCores,
            tokenTimestampsAvailable:
              device.whisperCpp.tokenTimestampsAvailable ?? false,
            fullJsonAvailable: device.whisperCpp.fullJsonAvailable ?? false,
            useVad: false,
            workerPool,
          }));
    const lyricsResult =
      noVadLyricsAdapter === undefined
        ? {
            artifact: {
              schemaVersion: "1.0.0" as const,
              generatedAt: new Date().toISOString(),
              maximumWindowSeconds: 25,
              summary: {
                detectedSongRegions: vocalRegions.length,
                lyricsAcceptedRegions: 0,
                missingLyricsRegions: vocalRegions.length,
                musicCueCount: 0,
                lyricsAsrRequests: 0,
                cacheHits: 0,
              },
              regions: vocalRegions.map((region) => ({
                region,
                attempts: [],
                decision: "missing-lyrics" as const,
                acceptedMusicCues: [],
                supportedCueIds: [],
                independentSupportProfiles: [],
                reasons: [
                  "lyrics-model-capability-unavailable",
                  "explicit-missing-lyrics-review-required",
                ],
              })),
            },
            musicCues: [] as SubtitleCue[],
            supportedCueIds: [] as string[],
            asrRequests: 0,
            cacheHits: 0,
          }
        : await runLyricsTranscription({
            mediaPath: input.mediaPath,
            audioStreamIndex: input.audioStream.index,
            outputDirectory: input.taskDirectory,
            regions: vocalRegions,
            adapter: noVadLyricsAdapter,
            runner: input.runner,
            logger: input.logger,
            ffmpegPath: input.ffmpegPath,
            ...(language === undefined ? {} : { language }),
            ...(input.asrCache === undefined
              ? {}
              : { asrCache: input.asrCache }),
          });
    const parsedLyrics = lyricsTranscriptionArtifactSchema.parse(
      lyricsResult.artifact,
    );
    const finalDiscoveredSpeechAnchors = discoverSpeechAnchors({
      sourceAudioSha256: input.sourceMediaSha256,
      speechIntervals: media.speechIntervals,
      ...(acousticScenes?.status === "completed"
        ? { acousticScenes: acousticScenes.scenes }
        : {}),
      baselineCues: cues,
      ...(noVadTargeted === undefined ? {} : { noVadCues: noVadTargeted.cues }),
      ...(extraSensitiveTargeted === undefined
        ? {}
        : { extraSensitiveCues: extraSensitiveTargeted.cues }),
      lyricsRegions: vocalRegions.map((region) => ({
        interval: region.interval,
      })),
    });
    if (asrRoutingPlan !== undefined) {
      for (const region of parsedLyrics.regions) {
        for (const sceneId of region.region.sourceSceneIds ?? []) {
          asrRoutingPlan = recordAsrRoutingExecution({
            plan: asrRoutingPlan,
            sceneId,
            profile: "lyrics",
            requestIds: region.attempts.map(
              (attempt) => `${sceneId}:lyrics:${attempt.asrRequestId}`,
            ),
            cacheHits: region.attempts.filter((attempt) => attempt.cacheHit)
              .length,
          });
        }
      }
      await atomicWriteJson(
        path.join(input.subtitleDirectory, "asr-routing-plan.json"),
        asrRoutingPlanArtifactSchema.parse(asrRoutingPlan),
        { overwrite: true },
      );
    }
    if (recovery.recoveredCues.length > 0) {
      cues = [...cues, ...recovery.recoveredCues].toSorted(
        (left, right) =>
          left.start - right.start ||
          left.end - right.end ||
          left.id.localeCompare(right.id),
      );
    }
    if (lyricsResult.musicCues.length > 0) {
      cues = [...cues, ...lyricsResult.musicCues].toSorted(
        (left, right) =>
          left.start - right.start ||
          left.end - right.end ||
          left.id.localeCompare(right.id),
      );
    }
    cues = annotateAdaptiveCueProvenance({
      cues,
      ...(refinementRecord === undefined ? {} : { refinementRecord }),
      recovery: parsedRecovery,
      lyrics: parsedLyrics,
      ...(acousticScenes === undefined ? {} : { acousticScenes }),
      ...(referenceTranscriptionPlan === undefined
        ? {}
        : { referencePlan: referenceTranscriptionPlan }),
    });
    const evidenceCue = (
      cue: SubtitleCue,
      inputEvidence: {
        idPrefix: string;
        sourceLayer: NonNullable<SubtitleCue["provenance"]>["sourceLayer"];
        sourceRequestIds: string[];
        sourceProfileIds: string[];
        independentSupportCount: number;
        recoveryUnitId?: string | null;
        sceneId?: string | null;
        sceneLabel?: string | null;
      },
    ): SubtitleCue => {
      const referenceUnits =
        referenceTranscriptionPlan?.units.filter(
          (unit) => overlapSeconds(unit.targetInterval, cue) > 0,
        ) ?? [];
      return {
        ...cue,
        id: `${inputEvidence.idPrefix}:${cue.id}`,
        provenance: {
          sourceLayer: inputEvidence.sourceLayer,
          sourceRequestIds: inputEvidence.sourceRequestIds,
          sourceProfileIds: inputEvidence.sourceProfileIds,
          referenceAnchorIds: [
            ...new Set(referenceUnits.flatMap((unit) => unit.anchorIds)),
          ],
          referenceUnitIds: referenceUnits.map((unit) => unit.id),
          recoveryUnitId: inputEvidence.recoveryUnitId ?? null,
          sceneId: inputEvidence.sceneId ?? null,
          sceneLabel: inputEvidence.sceneLabel ?? null,
          independentSupportCount: inputEvidence.independentSupportCount,
          qualityScore: cue.confidence,
        },
      };
    };
    const hypothesisCandidates: SubtitleCue[] = [
      ...baseline.cues.map((cue) =>
        evidenceCue(cue, {
          idPrefix: "baseline-vad",
          sourceLayer: "baseline-vad",
          sourceRequestIds: [cue.id],
          sourceProfileIds: ["baseline-vad"],
          independentSupportCount: 1,
        }),
      ),
      ...(noVadTargeted?.cues ?? []).map((cue) =>
        evidenceCue(cue, {
          idPrefix: "no-vad",
          sourceLayer: "no-vad",
          sourceRequestIds: [cue.id],
          sourceProfileIds: ["no-vad"],
          independentSupportCount: 1,
        }),
      ),
      ...(extraSensitiveTargeted?.cues ?? []).map((cue) =>
        evidenceCue(cue, {
          idPrefix: "extra-sensitive-vad",
          sourceLayer: "scene-extra-sensitive-vad",
          sourceRequestIds: [cue.id],
          sourceProfileIds: ["extra-sensitive-vad"],
          independentSupportCount: 1,
        }),
      ),
      ...parsedRecovery.units.flatMap((unit) =>
        unit.attempts.flatMap((attempt) =>
          attempt.canonicalCues.map((cue) =>
            evidenceCue(cue, {
              idPrefix: `recovery:${attempt.id}`,
              sourceLayer: "recovery",
              sourceRequestIds: [attempt.asrRequestId],
              sourceProfileIds: [attempt.profile],
              independentSupportCount: unit.attempts.filter(
                (candidate) => candidate.decision === "candidate-valid",
              ).length,
              recoveryUnitId: unit.id,
              sceneId: unit.sceneId ?? null,
              sceneLabel: unit.sceneLabel ?? null,
            }),
          ),
        ),
      ),
      ...parsedLyrics.regions.flatMap((region) =>
        region.attempts.flatMap((attempt) =>
          attempt.canonicalCues.map((cue) =>
            evidenceCue(
              {
                id: cue.id,
                start: cue.start,
                end: cue.end,
                text: cue.text,
                language: cue.language,
                languages: [cue.language],
                style: cue.style ?? "music",
                speaker: null,
                confidence: null,
              },
              {
                idPrefix: `lyrics:${attempt.id}`,
                sourceLayer: "lyrics-asr",
                sourceRequestIds: [attempt.asrRequestId],
                sourceProfileIds: [attempt.profile],
                independentSupportCount:
                  region.independentSupportProfiles.length,
                sceneId: region.region.sourceSceneIds?.[0] ?? null,
                sceneLabel: "singing",
              },
            ),
          ),
        ),
      ),
      ...(refinementRecord?.replacements ?? []).flatMap(
        (replacement, index) => {
          if (replacement.refinement.text.trim() === "") return [];
          const nearby = cues.find(
            (cue) => overlapSeconds(cue, replacement.interval) > 0,
          );
          const cue: SubtitleCue = {
            ...(nearby ?? {
              id: "refinement-placeholder",
              language: language ?? "und",
              languages: [language ?? "und"],
              speaker: null,
              confidence: null,
            }),
            id: `refinement-${String(index + 1).padStart(5, "0")}`,
            start: replacement.interval.start,
            end: replacement.interval.end,
            text: replacement.refinement.text,
          };
          return [
            evidenceCue(cue, {
              idPrefix: "large-v3-refinement",
              sourceLayer: "large-v3-refinement",
              sourceRequestIds: [
                `large-v3-refinement-${String(index + 1).padStart(5, "0")}`,
              ],
              sourceProfileIds: ["large-v3"],
              independentSupportCount: [
                replacement.consensus?.vadSupport ?? 0,
                replacement.consensus?.noVadSupport ?? 0,
                replacement.consensus?.refinementSupport ?? 0,
              ].filter((support) => support >= 0.5).length,
              sceneId: replacement.sceneId ?? null,
              sceneLabel: replacement.sceneLabel ?? null,
            }),
          ];
        },
      ),
    ];
    quality = rebuildQualityAfterMissingDialogueRecovery({
      previousQuality: preRecoveryQuality,
      cues,
      speechIntervals: media.speechIntervals,
      expectedLanguages: input.identity.dialogueLanguages,
      recovery: parsedRecovery,
    });
    await Promise.all([
      atomicWriteJson(
        path.join(
          input.subtitleDirectory,
          "transcription-quality-pre-recovery.json",
        ),
        preRecoveryQuality,
        { overwrite: input.overwrite },
      ),
      atomicWriteJson(
        path.join(input.subtitleDirectory, "missing-dialogue-recovery.json"),
        parsedRecovery,
        { overwrite: input.overwrite },
      ),
      atomicWriteJson(
        path.join(input.subtitleDirectory, "lyrics-transcription.json"),
        parsedLyrics,
        { overwrite: input.overwrite },
      ),
      atomicWriteJson(
        path.join(input.subtitleDirectory, "discovered-speech-anchors.json"),
        finalDiscoveredSpeechAnchors,
        { overwrite: true },
      ),
    ]);
    await atomicWriteJson(
      path.join(input.subtitleDirectory, "transcription-quality.json"),
      quality,
      { overwrite: input.overwrite },
    );
    await atomicWriteJson(
      path.join(input.subtitleDirectory, "transcription-timing-repairs.json"),
      {
        schemaVersion: "1.0.0",
        repairs: timingRepair.repairs,
      },
      { overwrite: input.overwrite },
    );
    const rawPath = path.join(
      input.taskDirectory,
      "audio",
      "raw-transcription.json",
    );
    const raw = (await readJson(rawPath)) as Record<string, unknown>;
    await atomicWriteJson(
      rawPath,
      {
        ...raw,
        baselineCues: raw.cues,
        cues,
        strategy: plan.strategy,
        qualitySummary: quality.summary,
      },
      { overwrite: true },
    );
    const cacheHits =
      baseline.cacheHits +
      (noVadTargeted?.cacheHits ?? 0) +
      (extraSensitiveTargeted?.cacheHits ?? 0) +
      refinementCacheHits +
      recovery.cacheHits +
      lyricsResult.cacheHits;
    workerPool.recordCacheHits(cacheHits);
    await workerPool.close();
    const executionMetrics = workerPool.metrics();
    await atomicWriteJson(
      path.join(input.subtitleDirectory, "whisper-execution-metrics.json"),
      executionMetrics,
      { overwrite: input.overwrite },
    );
    return {
      cues,
      hypothesisCandidates,
      quality,
      plan,
      baselineAdapter,
      refinedIntervals,
      refinementRoundsExecuted,
      cacheHits,
      transcribedUnits:
        baseline.transcribedChunks +
        (noVadTargeted?.transcribedIntervals ?? 0) +
        (extraSensitiveTargeted?.transcribedIntervals ?? 0) +
        refinementTranscribed +
        recovery.asrRequests +
        lyricsResult.asrRequests,
      packageTranscription: adaptiveSummary({
        plan,
        quality,
        refinedIntervals,
        canonicalSegmentation: {
          artifactPath: "canonical-asr-segments.json",
          rawSegmentCount: baseline.rawSegmentCount,
          canonicalUtteranceCount: baseline.canonicalUtteranceCount,
        },
        missingDialogueRecovery: parsedRecovery,
        lyricsTranscription: parsedLyrics,
        ...(acousticScenes === undefined ? {} : { acousticScenes }),
        ...(asrRoutingPlan === undefined ? {} : { asrRoutingPlan }),
      }),
      executionMetrics,
      canonicalSegmentation: {
        artifactPath: "canonical-asr-segments.json",
        rawSegmentCount: baseline.rawSegmentCount,
        canonicalUtteranceCount: baseline.canonicalUtteranceCount,
      },
      missingDialogueRecovery: parsedRecovery,
      lyricsTranscription: parsedLyrics,
      vocalRegions,
      supportedLyricsCueIds: lyricsResult.supportedCueIds,
      canonicalIntegrityFindings,
      ...(refinementRecord === undefined ? {} : { refinementRecord }),
      timingRepairs: timingRepair.repairs,
      speechIntervals: media.speechIntervals,
      ...(acousticScenes === undefined ? {} : { acousticScenes }),
      ...(asrRoutingPlan === undefined ? {} : { asrRoutingPlan }),
      discoveredSpeechAnchors: finalDiscoveredSpeechAnchors,
      ...(referenceTranscriptionPlan === undefined
        ? {}
        : { referenceTranscriptionPlan }),
      quarantineEvidenceCandidates: [
        ...baseline.cues.map((cue) => ({
          id: `raw-vad:${cue.id}`,
          interval: { start: cue.start, end: cue.end },
          layer: "raw-vad" as const,
          text: cue.text,
          repetitionHardError: false,
          speechSupported: media.speechIntervals.some(
            (speech) => speech.start < cue.end && cue.start < speech.end,
          ),
          independentProfileSupport: false,
        })),
        ...(noVadTargeted?.cues ?? []).map((cue) => ({
          id: `raw-no-vad:${cue.id}`,
          interval: { start: cue.start, end: cue.end },
          layer: "raw-no-vad" as const,
          text: cue.text,
          repetitionHardError: false,
          speechSupported: media.speechIntervals.some(
            (speech) => speech.start < cue.end && cue.start < speech.end,
          ),
          independentProfileSupport: false,
        })),
        ...parsedRecovery.units.flatMap((unit) =>
          unit.attempts.flatMap((attempt) =>
            attempt.canonicalCues.map((cue) => ({
              id: `recovery:${attempt.id}:${cue.id}`,
              interval: { start: cue.start, end: cue.end },
              layer: "recovery" as const,
              text: cue.text,
              repetitionHardError: attempt.decision === "invalid-hallucination",
              speechSupported: unit.speechIslandIds.length > 0,
              independentProfileSupport:
                unit.attempts.filter(
                  (candidate) => candidate.decision === "candidate-valid",
                ).length >= 2,
            })),
          ),
        ),
        ...(canonicalArtifact.utterances ?? []).flatMap((utterance) =>
          utterance.qualityStatus === "suspected-hallucination"
            ? [
                {
                  id: `canonical-rejected:${utterance.id}`,
                  interval: {
                    start: utterance.start,
                    end: utterance.end,
                  },
                  layer: "canonical-rejected" as const,
                  text: utterance.text,
                  repetitionHardError: true,
                  speechSupported: media.speechIntervals.some(
                    (speech) =>
                      speech.start < utterance.end &&
                      utterance.start < speech.end,
                  ),
                  independentProfileSupport: false,
                },
              ]
            : [],
        ),
        ...(refinementRecord?.replacements ?? []).map((replacement, index) => ({
          id: `large-v3-refinement:${String(index + 1).padStart(5, "0")}`,
          interval: replacement.interval,
          layer: "large-v3-refinement" as const,
          text: replacement.refinement.text,
          repetitionHardError:
            replacement.refinement.quality?.hardReject ?? false,
          speechSupported:
            replacement.conflict?.speechEvidence === "strong" ||
            media.speechIntervals.some(
              (speech) =>
                speech.start < replacement.interval.end &&
                replacement.interval.start < speech.end,
            ),
          independentProfileSupport:
            Math.max(
              replacement.consensus?.vadSupport ?? 0,
              replacement.consensus?.noVadSupport ?? 0,
            ) >= 0.5,
        })),
      ],
    };
  } catch (error) {
    await workerPool.close();
    await atomicWriteJson(
      path.join(input.subtitleDirectory, "whisper-execution-metrics.json"),
      workerPool.metrics(),
      { overwrite: true },
    );
    throw error;
  }
}
