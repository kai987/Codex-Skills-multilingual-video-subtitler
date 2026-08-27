import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

import { inferMediaIdentity } from "@mvl/media-identity";
import {
  buildFinalReviewQueue,
  buildTerminologyEvidence,
  deduplicateNormalizedWinners,
  deduplicateTopScoreWinners,
  evaluateFinalSubtitleIntegrity,
  evaluateAnchorCoverageIntegrity,
  evaluateSceneCoverageIntegrity,
  evaluateTranscriptionQuality,
  materializeReferenceOriginalLyrics,
  normalizeJapaneseLexicalForm,
  repairTopScoreFragments,
  repairTopScoreWinnerTiming,
  repairFinalSubtitleIntegrity,
  repairIntraCueHypothesisRepetition,
  repairTextIntegrityFailures,
  PortableAsrCache,
  resolveTranscriptionAdapter,
  resolveCompetingHypotheses,
  runFinalSubtitleIntegrityGate,
  runFinalTextIntegrityGate,
  transcribeMedia,
  validateLyricsText,
  validateSemanticCandidates,
} from "@mvl/transcription-core";
import {
  AppError,
  assertExecutable,
  assertRegularFile,
  atomicWriteFile,
  atomicWriteJson,
  defaultTaskDirectory,
  finalSubtitleIntegrityArtifactSchema,
  intraCueRepetitionRepairArtifactSchema,
  referenceOriginalLyricsResolutionArtifactSchema,
  japaneseTerminologyFileSchema,
  readJson,
  InputError,
  type LanguageTag,
  type SubtitlePackage,
  type DiscoveredSpeechAnchorsArtifact,
  type SubtitleSearchResults,
  type FinalTextIntegrityArtifact,
  type FinalSubtitleIntegrityArtifact,
  type JapaneseTerminologyEntry,
  type IntraCueRepetitionRepairArtifact,
  type ReferenceTimelineArtifact,
  type SubtitleCue,
  type AsrRequestTimelineContract,
  type CandidateConsensusMode,
  type GlobalTokenTimelineMode,
  type CandidateAssociationMode,
  type CanonicalAssemblyMode,
  type TimelineTransformChainMode,
  type TranscriptionQuality,
  subtitlePackageSchema,
  toAppError,
} from "@mvl/shared";
import {
  formatAss,
  formatSrt,
  formatVtt,
  buildAcousticSemanticCueSegments,
  evaluateLineLayoutIntegrity,
  evaluatePresentationConstraintIntegrity,
  layoutSubtitleCues,
  layoutSubtitleCuesWithDiagnostics,
  parseAss,
  parseSrt,
  parseVtt,
} from "@mvl/subtitle-core";

import { extractEmbeddedSubtitle, selectEmbeddedSubtitle } from "./embedded.js";
import { runAdaptiveLocalTranscription } from "./adaptive.js";
import { burnSubtitleIntoVideo } from "./burn.js";
import { processOnlineSubtitles, skippedSearchRecord } from "./online.js";
import { createSubtitlePackage } from "./package.js";
import {
  prepareReferenceSubtitle,
  sha256File,
  writeBlindGenerationProof,
  writeReferenceEvaluationArtifacts,
  type PreparedReferenceSubtitle,
} from "./reference-workflow.js";
import {
  subtitleArtifactDirectory,
  subtitleArtifactStem,
} from "./output-paths.js";
import { isTransportStream, probeMedia } from "./probe.js";
import {
  maybeNormalizeTransportStream,
  scanTransportStream,
} from "./transport.js";
import type {
  ProcessingManifest,
  SourceInfo,
  VideoSubtitlerDependencies,
  VideoSubtitlerOptions,
  VideoSubtitlerResult,
} from "./types.js";
import { runCandidatePrecisionWorkflow } from "./machine-quality/candidate-precision-workflow.js";
import { runCandidateAssociationAssembly } from "./machine-quality/candidate-association-assembly.js";

async function loadJapaneseTerminology(
  filePath: string | undefined,
): Promise<{ entries: JapaneseTerminologyEntry[]; sha256: string | null }> {
  if (filePath === undefined) return { entries: [], sha256: null };
  const absolute = path.resolve(filePath);
  await assertRegularFile(absolute);
  const parsed = japaneseTerminologyFileSchema.safeParse(
    await readJson(absolute),
  );
  if (!parsed.success) {
    throw new InputError(`Invalid Japanese terminology JSON: ${absolute}`, {
      path: absolute,
      issues: parsed.error.issues,
    });
  }
  return { entries: parsed.data.entries, sha256: await sha256File(absolute) };
}

function combineIntraCueRepetitionArtifacts(
  first: IntraCueRepetitionRepairArtifact,
  second: IntraCueRepetitionRepairArtifact,
): IntraCueRepetitionRepairArtifact {
  const records = [...first.records, ...second.records];
  return intraCueRepetitionRepairArtifactSchema.parse({
    ...second,
    inputHash: first.inputHash,
    records,
    summary: {
      inputCueCount: first.summary.inputCueCount,
      outputCueCount: second.summary.outputCueCount,
      detectedCueCount: records.length,
      repairedCueCount:
        first.summary.repairedCueCount + second.summary.repairedCueCount,
      trueSpokenRepetitionCount:
        first.summary.trueSpokenRepetitionCount +
        second.summary.trueSpokenRepetitionCount,
      removedSpanCount:
        first.summary.removedSpanCount + second.summary.removedSpanCount,
      preservedTailCount:
        first.summary.preservedTailCount + second.summary.preservedTailCount,
      japaneseSpacesRemoved:
        first.summary.japaneseSpacesRemoved +
        second.summary.japaneseSpacesRemoved,
    },
    fallback:
      records.length === 0 ? "no-intra-cue-hypothesis-repetition" : null,
  });
}

function runTopScoreTextPipeline(input: {
  cues: readonly SubtitleCue[];
  evidenceCues?: readonly SubtitleCue[];
  referenceTimeline?: ReferenceTimelineArtifact;
  semanticMode: "off" | "auto" | "on";
  terminologyEntries: readonly JapaneseTerminologyEntry[];
  terminologySha256: string | null;
  hypothesisMode: "top-score" | "conservative" | "balanced";
  japaneseNormalization: "off" | "top-score";
  japaneseTextAnalyzer: "auto" | "intl-segmenter" | "external";
  cueSegmentation: "acoustic-semantic" | "token-only" | "legacy";
  lyricsValidation: "conservative" | "balanced";
  textIntegrity: "off" | "observe" | "enforce";
  timingQaConfig: VideoSubtitlerOptions["timingQaConfig"];
  requestTimelineContract?: AsrRequestTimelineContract;
  candidateConsensus?: CandidateConsensusMode;
  globalTokenTimeline?: GlobalTokenTimelineMode;
  candidateAssociation?: CandidateAssociationMode;
  canonicalAssembly?: CanonicalAssemblyMode;
  timelineTransformChain?: TimelineTransformChainMode;
}) {
  const originalEvidenceCues = input.evidenceCues ?? input.cues;
  const candidatePrecision =
    input.requestTimelineContract === undefined
      ? null
      : runCandidatePrecisionWorkflow({
          cues: input.cues,
          evidenceCues: originalEvidenceCues,
          requestTimelineContract: input.requestTimelineContract,
          candidateConsensus: input.candidateConsensus ?? "off",
          globalTokenTimeline: input.globalTokenTimeline ?? "off",
        });
  const pipelineCues = candidatePrecision?.cues ?? input.cues;
  const evidenceCues = candidatePrecision?.evidenceCues ?? originalEvidenceCues;
  const semanticValidation = validateSemanticCandidates({
    cues: evidenceCues,
    ...(input.referenceTimeline === undefined
      ? {}
      : { timeline: input.referenceTimeline }),
    mode: input.semanticMode,
  });
  const terminologyEvidence = buildTerminologyEvidence({
    cues: evidenceCues,
    entries: input.terminologyEntries,
  });
  const hypothesisResolution = resolveCompetingHypotheses({
    cues: pipelineCues,
    evidenceCues,
    mode: input.hypothesisMode,
    terminology: terminologyEvidence,
    semantic: semanticValidation,
    ...(input.referenceTimeline === undefined
      ? {}
      : { referenceTimeline: input.referenceTimeline }),
  });
  const associationAssembly =
    candidatePrecision === null ||
    ((input.candidateAssociation ?? "off") === "off" &&
      (input.canonicalAssembly ?? "off") === "off" &&
      (input.timelineTransformChain ?? "off") === "off")
      ? null
      : runCandidateAssociationAssembly({
          atoms: hypothesisResolution.atomization.atoms,
          atomicClusters: hypothesisResolution.atomicClusters,
          candidateEvidence: hypothesisResolution.candidateEvidence,
          topScoreResolution: hypothesisResolution.topScoreResolution,
          winnerCues: hypothesisResolution.cues,
          acousticEventFamilies: candidatePrecision.acousticEventFamilies,
          globalTokenTimeline: candidatePrecision.globalTokenTimeline,
          requestTimelineContract: candidatePrecision.requestTimelineContract,
          candidateAssociation: input.candidateAssociation ?? "off",
          canonicalAssembly: input.canonicalAssembly ?? "off",
          timelineTransformChain: input.timelineTransformChain ?? "off",
        });
  const winnerDeduplication = deduplicateTopScoreWinners(
    associationAssembly?.cues ?? hypothesisResolution.cues,
    "pre-normalization",
    { requireTemporalOverlap: associationAssembly !== null },
  );
  const fragmentRepair = repairTopScoreFragments(winnerDeduplication.cues, {
    eventFirst: associationAssembly !== null,
  });
  const winnerTimingRepair = repairTopScoreWinnerTiming({
    cues: fragmentRepair.cues,
    equivalentCandidates: hypothesisResolution.atomization.atoms,
    ...(input.referenceTimeline === undefined
      ? {}
      : { referenceTimeline: input.referenceTimeline }),
  });
  const japaneseNormalization = normalizeJapaneseLexicalForm({
    cues: winnerTimingRepair.cues,
    allCandidates: hypothesisResolution.atomization.atoms,
    atomicClusters: hypothesisResolution.atomicClusters,
    terminologyEntries: input.terminologyEntries,
    terminologySha256: input.terminologySha256,
    mode: input.japaneseNormalization,
  });
  const postNormalizationDeduplication = deduplicateNormalizedWinners(
    japaneseNormalization.cues,
    { requireTemporalOverlap: associationAssembly !== null },
  );
  const segmentation = buildAcousticSemanticCueSegments(
    postNormalizationDeduplication.cues,
    {
      mode: input.cueSegmentation,
      japaneseTextAnalyzer: input.japaneseTextAnalyzer,
      ...(input.referenceTimeline === undefined
        ? {}
        : { referenceTimeline: input.referenceTimeline }),
    },
  );
  const lyricsValidity = validateLyricsText({
    cues: segmentation.cues,
    mode: input.lyricsValidation,
  });
  const preliminaryTextIntegrity = runFinalTextIntegrityGate({
    cues: segmentation.cues,
    mode: "observe",
    japaneseTextAnalysis: segmentation.japaneseTextAnalysis,
    candidateEvidence: hypothesisResolution.candidateEvidence,
    hypothesisResolution: hypothesisResolution.resolution,
    segmentationPlan: segmentation.plan,
    lyricsValidity,
  });
  const textIntegrityRepair = repairTextIntegrityFailures({
    cues: segmentation.cues,
    preliminary: preliminaryTextIntegrity.artifact,
    preSegmentationCues: postNormalizationDeduplication.cues,
    allCandidates: hypothesisResolution.atomization.atoms,
    atomicClusters: hypothesisResolution.atomicClusters,
    topScoreResolution: hypothesisResolution.topScoreResolution,
    winnerDeduplication: winnerDeduplication.artifact,
    segmentationPlan: segmentation.plan,
    maximumRepairRounds: 2,
  });
  const intraCueRepetitionRepair = repairIntraCueHypothesisRepetition({
    cues: textIntegrityRepair.cues,
    sourceCues: [
      ...hypothesisResolution.atomization.atoms,
      ...postNormalizationDeduplication.cues,
    ],
    terminologyEntries: input.terminologyEntries,
  });
  const postTextRepairSegmentation = buildAcousticSemanticCueSegments(
    intraCueRepetitionRepair.cues,
    {
      mode: input.cueSegmentation,
      japaneseTextAnalyzer: input.japaneseTextAnalyzer,
      ...(input.referenceTimeline === undefined
        ? {}
        : { referenceTimeline: input.referenceTimeline }),
    },
  );
  const postRepairLyricsValidity = validateLyricsText({
    cues: postTextRepairSegmentation.cues,
    mode: input.lyricsValidation,
  });
  const textIntegrityGate = runFinalTextIntegrityGate({
    cues: postTextRepairSegmentation.cues,
    mode: input.textIntegrity,
    japaneseTextAnalysis: postTextRepairSegmentation.japaneseTextAnalysis,
    candidateEvidence: hypothesisResolution.candidateEvidence,
    hypothesisResolution: hypothesisResolution.resolution,
    segmentationPlan: postTextRepairSegmentation.plan,
    lyricsValidity: postRepairLyricsValidity,
  });
  return {
    candidatePrecision,
    associationAssembly,
    semanticValidation,
    terminologyEvidence,
    hypothesisResolution,
    winnerDeduplication,
    fragmentRepair,
    winnerTimingRepair,
    japaneseNormalization,
    postNormalizationDeduplication,
    segmentation,
    lyricsValidity,
    preliminaryTextIntegrity,
    textIntegrityRepair,
    intraCueRepetitionRepair,
    postTextRepairSegmentation,
    textIntegrityGate,
    postRepairLyricsValidity,
  };
}

function runFinalPresentationPipeline(input: {
  cues: readonly SubtitleCue[];
  sourceCues: readonly SubtitleCue[];
  terminologyEntries: readonly JapaneseTerminologyEntry[];
  cueSegmentation: "acoustic-semantic" | "token-only" | "legacy";
  japaneseTextAnalyzer: "auto" | "intl-segmenter" | "external";
  textIntegrity: "off" | "observe" | "enforce";
  timingQaConfig: VideoSubtitlerOptions["timingQaConfig"];
  vocalRegions?: Parameters<
    typeof evaluateFinalSubtitleIntegrity
  >[0]["vocalRegions"];
  supportedLyricsCueIds?: readonly string[];
  referenceTimeline?: ReferenceTimelineArtifact;
  preserveUnresolvedOverlapForReview?: boolean;
}) {
  const preliminarySubtitleIntegrity = evaluateFinalSubtitleIntegrity({
    cues: input.cues,
    ...(input.vocalRegions === undefined
      ? {}
      : { vocalRegions: input.vocalRegions }),
    ...(input.supportedLyricsCueIds === undefined
      ? {}
      : { supportedLyricsCueIds: input.supportedLyricsCueIds }),
  });
  const finalSubtitleRepair = repairFinalSubtitleIntegrity({
    cues: input.cues,
    findings: preliminarySubtitleIntegrity.findings,
  });
  const intraCueRepetitionRepair = repairIntraCueHypothesisRepetition({
    cues: finalSubtitleRepair.cues,
    sourceCues: input.sourceCues,
    terminologyEntries: input.terminologyEntries,
  });
  const postSubtitleRepairSegmentation = buildAcousticSemanticCueSegments(
    intraCueRepetitionRepair.cues,
    {
      mode: input.cueSegmentation,
      japaneseTextAnalyzer: input.japaneseTextAnalyzer,
      ...(input.referenceTimeline === undefined
        ? {}
        : { referenceTimeline: input.referenceTimeline }),
    },
  );
  const presentation = layoutSubtitleCuesWithDiagnostics(
    postSubtitleRepairSegmentation.cues,
    {
      timingConfig: input.timingQaConfig,
      segmentationMode:
        input.cueSegmentation === "legacy" ? "legacy" : "presegmented",
      allowTemporalCueSplitting: input.cueSegmentation === "legacy",
    },
  );
  const candidateLineLayoutIntegrity = evaluateLineLayoutIntegrity(
    presentation.cues,
  );
  const unsafeCueIds = new Set(
    candidateLineLayoutIntegrity.findings.map((finding) => finding.cueId),
  );
  const strictLayoutCues = presentation.cues.filter(
    (cue) => !unsafeCueIds.has(cue.id),
  );
  const finalTextProjection = runFinalTextIntegrityGate({
    cues: strictLayoutCues,
    mode: input.textIntegrity,
    japaneseTextAnalysis: postSubtitleRepairSegmentation.japaneseTextAnalysis,
    segmentationPlan: postSubtitleRepairSegmentation.plan,
  });
  const finalSubtitleGate = runFinalSubtitleIntegrityGate({
    cues: finalTextProjection.cues,
    ...(input.vocalRegions === undefined
      ? {}
      : { vocalRegions: input.vocalRegions }),
    ...(input.supportedLyricsCueIds === undefined
      ? {}
      : { supportedLyricsCueIds: input.supportedLyricsCueIds }),
    supportedLongCueIds: finalSubtitleRepair.supportedLongCueIds,
    strictPresentationConstraints: true,
    ...(input.preserveUnresolvedOverlapForReview === true
      ? { reviewOnlyRetentionCodes: ["SUBTITLE_OVERLAP" as const] }
      : {}),
  });
  const lineLayoutIntegrity = evaluateLineLayoutIntegrity(
    finalSubtitleGate.cues,
  );
  const presentationConstraintIntegrity =
    evaluatePresentationConstraintIntegrity({
      cues: finalSubtitleGate.cues,
      ass: formatAss(finalSubtitleGate.cues),
    });
  return {
    preliminarySubtitleIntegrity,
    finalSubtitleRepair,
    intraCueRepetitionRepair,
    postSubtitleRepairSegmentation,
    presentation,
    candidateLineLayoutIntegrity,
    unsafeCueIds,
    finalTextProjection,
    finalSubtitleGate,
    lineLayoutIntegrity,
    presentationConstraintIntegrity,
  };
}

function audioLanguages(source: SourceInfo): LanguageTag[] {
  return [
    ...new Set(
      source.streams
        .filter(
          (stream) => stream.type === "audio" && stream.language !== "und",
        )
        .map((stream) => stream.language),
    ),
  ];
}

async function persistManifest(
  pathName: string,
  manifest: ProcessingManifest,
  overwrite: boolean,
): Promise<void> {
  manifest.updatedAt = new Date().toISOString();
  await atomicWriteJson(pathName, manifest, { overwrite });
}

async function persistCandidatePrecisionArtifacts(input: {
  subtitleDirectory: string;
  overwrite: boolean;
  artifacts: NonNullable<ReturnType<typeof runCandidatePrecisionWorkflow>>;
}): Promise<void> {
  await Promise.all([
    atomicWriteJson(
      path.join(
        input.subtitleDirectory,
        "machine-acoustic-event-families.json",
      ),
      input.artifacts.acousticEventFamilies,
      { overwrite: input.overwrite },
    ),
    atomicWriteJson(
      path.join(input.subtitleDirectory, "machine-cross-window-consensus.json"),
      input.artifacts.crossWindowConsensus,
      { overwrite: input.overwrite },
    ),
    atomicWriteJson(
      path.join(input.subtitleDirectory, "asr-request-timeline-contract.json"),
      input.artifacts.requestTimelineContract,
      { overwrite: input.overwrite },
    ),
    atomicWriteJson(
      path.join(input.subtitleDirectory, "machine-global-token-timeline.json"),
      input.artifacts.globalTokenTimeline,
      { overwrite: input.overwrite },
    ),
    atomicWriteJson(
      path.join(input.subtitleDirectory, "machine-cue-timeline-evidence.json"),
      input.artifacts.cueTimelineEvidence,
      { overwrite: input.overwrite },
    ),
    atomicWriteJson(
      path.join(input.subtitleDirectory, "machine-timing-non-degradation.json"),
      input.artifacts.timingNonDegradation,
      { overwrite: input.overwrite },
    ),
    atomicWriteJson(
      path.join(input.subtitleDirectory, "machine-lexical-conservation.json"),
      input.artifacts.lexicalConservation,
      { overwrite: input.overwrite },
    ),
    atomicWriteJson(
      path.join(
        input.subtitleDirectory,
        "machine-overlap-event-classification.json",
      ),
      input.artifacts.overlapEventClassification,
      { overwrite: input.overwrite },
    ),
  ]);
}

async function persistCandidateAssociationAssemblyArtifacts(input: {
  subtitleDirectory: string;
  overwrite: boolean;
  artifacts: NonNullable<
    ReturnType<typeof runTopScoreTextPipeline>["associationAssembly"]
  >;
}): Promise<void> {
  await Promise.all([
    atomicWriteJson(
      path.join(
        input.subtitleDirectory,
        "machine-candidate-association-ledger.json",
      ),
      input.artifacts.candidateAssociationLedger,
      { overwrite: input.overwrite },
    ),
    atomicWriteJson(
      path.join(input.subtitleDirectory, "machine-canonical-events.json"),
      input.artifacts.canonicalEvents,
      { overwrite: input.overwrite },
    ),
    atomicWriteJson(
      path.join(input.subtitleDirectory, "machine-canonical-assembly.json"),
      input.artifacts.canonicalAssembly,
      { overwrite: input.overwrite },
    ),
    atomicWriteJson(
      path.join(
        input.subtitleDirectory,
        "machine-supported-text-retention.json",
      ),
      input.artifacts.supportedTextRetention,
      { overwrite: input.overwrite },
    ),
    atomicWriteJson(
      path.join(
        input.subtitleDirectory,
        "machine-timeline-transform-chain.json",
      ),
      input.artifacts.timelineTransformChain,
      { overwrite: input.overwrite },
    ),
    atomicWriteJson(
      path.join(
        input.subtitleDirectory,
        "machine-canonical-non-degradation-ledger.json",
      ),
      input.artifacts.canonicalNonDegradation,
      { overwrite: input.overwrite },
    ),
    atomicWriteJson(
      path.join(input.subtitleDirectory, "machine-stage-quality-trace.json"),
      input.artifacts.stageQualityTrace,
      { overwrite: input.overwrite },
    ),
    atomicWriteJson(
      path.join(input.subtitleDirectory, "machine-overlap-root-cause.json"),
      input.artifacts.overlapRootCause,
      { overwrite: input.overwrite },
    ),
  ]);
}

export async function runVideoSubtitler(
  options: VideoSubtitlerOptions,
  dependencies: VideoSubtitlerDependencies,
): Promise<VideoSubtitlerResult> {
  const now = dependencies.now ?? (() => new Date());
  const inputPath = path.resolve(options.inputVideo);
  const ffmpegPath = options.ffmpegPath ?? process.env.FFMPEG_PATH ?? "ffmpeg";
  const ffprobePath =
    options.ffprobePath ?? process.env.FFPROBE_PATH ?? "ffprobe";
  const overwrite = options.overwrite ?? false;
  const dryRun = options.dryRun ?? false;
  const generateSrt = options.generateSrt ?? true;
  const generateVtt = options.generateVtt ?? true;
  const generateAss = options.generateAss ?? true;
  const allowOnlineSearch = options.allowOnlineSubtitleSearch ?? true;
  const guidanceMode = options.guidanceMode ?? "reference-free";
  const referenceTiming = options.referenceTiming ?? "auto";
  const referenceContent = options.referenceContent ?? "dialogue-and-lyrics";
  const referenceRepair = options.referenceRepair ?? "off";
  const referenceSemanticValidation =
    options.semanticValidation ?? options.referenceSemanticValidation ?? "auto";
  const textIntegrityMode = options.textIntegrity ?? "enforce";
  const cueSegmentationMode = options.cueSegmentation ?? "acoustic-semantic";
  const hypothesisResolutionMode = options.hypothesisResolution ?? "top-score";
  const japaneseNormalizationMode =
    options.japaneseNormalization ?? "top-score";
  const japaneseTextAnalyzer = options.japaneseTextAnalyzer ?? "auto";
  const lyricsValidationMode = options.lyricsValidation ?? "conservative";
  const taskDirectory = path.resolve(
    options.outputDirectory ?? defaultTaskDirectory(inputPath, now()),
  );
  const subtitleStem = subtitleArtifactStem(inputPath);
  const subtitleDirectory = subtitleArtifactDirectory(taskDirectory, inputPath);
  const asrCache = new PortableAsrCache({
    ...(options.asrCacheDirectory === undefined
      ? {}
      : { portableRoot: options.asrCacheDirectory }),
    taskLocalRoot: path.join(taskDirectory, "asr-cache-v2"),
    importRoots: [taskDirectory, ...(options.asrCacheImportPaths ?? [])],
    mode: options.asrCacheMode ?? "read-write",
    migrateLegacy: options.migrateAsrCache ?? true,
    sourceOutputDirectory: taskDirectory,
  });
  const manifestPath = path.join(subtitleDirectory, "processing-manifest.json");
  const manifest: ProcessingManifest = {
    schemaVersion: "1.0.0",
    taskId: randomUUID(),
    startedAt: now().toISOString(),
    updatedAt: now().toISOString(),
    sourcePath: inputPath,
    outputDirectory: taskDirectory,
    status: "running",
    completedStages: [],
    workingMediaPath: inputPath,
    operations: [],
    normalizationChanges: [],
    referenceGuidance: {
      mode: guidanceMode,
      referencePathKnown: options.referenceSubtitlePath !== undefined,
      referenceOpenedBeforeBlindGeneration: false,
      referenceTextUsedAsTargetPrompt: false,
      fallback: null,
    },
    error: null,
  };

  await assertRegularFile(inputPath);
  await Promise.all([
    assertExecutable(dependencies.runner, ffprobePath),
    assertExecutable(dependencies.runner, ffmpegPath),
  ]);
  const japaneseTerminology = await loadJapaneseTerminology(
    options.japaneseTerminologyPath,
  );
  if (
    hypothesisResolutionMode === "conservative" ||
    hypothesisResolutionMode === "balanced"
  ) {
    dependencies.logger.log(
      "warning",
      `--hypothesis-resolution ${hypothesisResolutionMode} is deprecated and now maps to top-score.`,
    );
  }

  let sourceInfo: SourceInfo;
  let manifestOwned = false;
  try {
    if (!dryRun) {
      await mkdir(subtitleDirectory, { recursive: true });
      await persistManifest(manifestPath, manifest, overwrite);
      manifestOwned = true;
    }
    dependencies.logger.log("info", "Inspecting selected video with ffprobe.", {
      fileName: path.basename(inputPath),
    });
    sourceInfo = await probeMedia(
      inputPath,
      dependencies.runner,
      ffprobePath,
      now(),
    );
    manifest.completedStages.push("media-probe");
    if (options.audioTrack !== undefined) {
      const audioStream = sourceInfo.streams.find(
        (stream) =>
          stream.index === options.audioTrack && stream.type === "audio",
      );
      if (audioStream === undefined) {
        throw new AppError(
          `Audio stream ${options.audioTrack} does not exist.`,
          {
            code: "INVALID_INPUT",
            exitCode: 2,
            details: {
              candidates: sourceInfo.streams
                .filter((stream) => stream.type === "audio")
                .map((stream) => stream.index),
            },
          },
        );
      }
    }

    if (isTransportStream(sourceInfo)) {
      sourceInfo.transport = await scanTransportStream(
        inputPath,
        sourceInfo,
        dependencies.runner,
        ffmpegPath,
        dependencies.logger,
        manifest,
      );
      manifest.completedStages.push("transport-stream-scan");
      if (!dryRun) {
        manifest.workingMediaPath = await maybeNormalizeTransportStream({
          inputPath,
          taskDirectory,
          analysis: sourceInfo.transport,
          mode: options.transportNormalization ?? "auto",
          runner: dependencies.runner,
          ffmpegPath,
          overwrite,
          logger: dependencies.logger,
          manifest,
        });
        if (manifest.workingMediaPath !== inputPath) {
          manifest.completedStages.push("transport-stream-normalization");
        }
      }
    }

    const identity = inferMediaIdentity({
      inputPath,
      durationSeconds: sourceInfo.format.durationSeconds,
      detectedAudioLanguages: audioLanguages(sourceInfo),
      ...(sourceInfo.format.title === null
        ? {}
        : { containerTitle: sourceInfo.format.title }),
      ...(options.identity === undefined
        ? {}
        : { overrides: options.identity }),
    });
    manifest.completedStages.push("media-identity-inference");

    let workingInfo = sourceInfo;
    if (!dryRun && manifest.workingMediaPath !== inputPath) {
      workingInfo = await probeMedia(
        manifest.workingMediaPath,
        dependencies.runner,
        ffprobePath,
        now(),
      );
    }
    const selection =
      options.regenerateSubtitles === true
        ? {
            selected: null,
            textCandidates: workingInfo.streams.filter(
              (stream) => stream.isTextSubtitle,
            ),
            graphicalCandidates: workingInfo.streams.filter(
              (stream) => stream.isGraphicalSubtitle,
            ),
          }
        : selectEmbeddedSubtitle(
            workingInfo.streams,
            options.subtitleTrack,
            identity.primarySubtitleLanguages,
          );

    const plannedActions = [
      "write source-info.json",
      "write media-identity.json",
      ...(selection.selected === null
        ? [
            "record that no text embedded subtitle was selected",
            ...(allowOnlineSearch
              ? [
                  "query configured subtitle search adapters and score candidates",
                ]
              : []),
          ]
        : [
            `extract embedded subtitle stream ${selection.selected.index}`,
            ...(generateSrt ? [`generate ${subtitleStem}.srt`] : []),
            ...(generateVtt ? [`generate ${subtitleStem}.vtt`] : []),
            ...(generateAss ? [`generate ${subtitleStem}.ass`] : []),
          ]),
      ...(options.transcribeWhenNeeded === true
        ? [
            "extract and silence-split selected audio when transcription is needed",
            options.transcriptionProvider === undefined ||
            options.transcriptionProvider === "auto"
              ? "select a configured local transcription adapter first, then a configured cloud fallback"
              : `use the explicitly selected ${options.transcriptionProvider} transcription adapter`,
          ]
        : []),
      ...(options.burnSubtitles === true
        ? ["burn selected subtitles into a new video artifact"]
        : []),
      "validate and write subtitle-package.json",
    ];

    if (dryRun) {
      return {
        dryRun: true,
        outputDirectory: null,
        sourceInfo,
        identity,
        subtitlePackage: null,
        selectedSubtitleStream: selection.selected,
        normalizationChanges: [],
        plannedActions,
        transcriptionQuality: null,
      };
    }

    await atomicWriteJson(
      path.join(subtitleDirectory, "source-info.json"),
      sourceInfo,
      {
        overwrite,
      },
    );
    await atomicWriteJson(
      path.join(subtitleDirectory, "media-identity.json"),
      identity,
      {
        overwrite,
      },
    );
    await persistManifest(manifestPath, manifest, true);

    let preparedReference: PreparedReferenceSubtitle | null = null;
    if (guidanceMode === "reference-guided") {
      if (options.referenceSubtitlePath === undefined) {
        throw new AppError(
          "reference-guided mode requires --reference-subtitle.",
          {
            code: "INVALID_INPUT",
            exitCode: 2,
          },
        );
      }
      preparedReference = await prepareReferenceSubtitle({
        referencePath: options.referenceSubtitlePath,
        referenceLanguage: options.referenceLanguage ?? "und",
        mediaDurationSeconds: workingInfo.format.durationSeconds,
        timingMode: referenceTiming,
        contentPolicy: referenceContent,
        classificationReviewThreshold:
          options.referenceClassificationReviewThreshold ?? 0.75,
        subtitleDirectory,
        overwrite,
      });
      manifest.completedStages.push(
        "reference-subtitle-classification",
        "reference-timeline",
      );
      manifest.referenceGuidance = {
        ...manifest.referenceGuidance,
        mode: guidanceMode,
        referencePathKnown: true,
        referenceOpenedBeforeBlindGeneration: false,
        referenceTextUsedAsTargetPrompt: false,
        analysisPath: "reference-subtitle-analysis.json",
        timelinePath: "reference-timeline.json",
        fallback: null,
      };
    }

    const files = { srt: null, vtt: null, ass: null } as {
      srt: string | null;
      vtt: string | null;
      ass: string | null;
    };
    let cues = [] as Awaited<
      ReturnType<typeof extractEmbeddedSubtitle>
    >["cues"];
    const warnings = [...sourceInfo.warnings];
    let status:
      | "ready"
      | "needs-subtitle-search"
      | "needs-audio-transcription"
      | "no-text-subtitle" = "ready";
    let searchResults: SubtitleSearchResults = skippedSearchRecord(
      "embedded-subtitle-selected",
    );
    let primarySubtitle: SubtitlePackage["primarySubtitle"] | undefined;
    let referenceSubtitles: SubtitlePackage["referenceSubtitles"] = [];
    let transcriptionQuality: TranscriptionQuality | null = null;
    let packageTranscription: SubtitlePackage["transcription"] | undefined;
    let activeReviewIntervals: { start: number; end: number }[] = [];
    let finalSpeechIntervals: { start: number; end: number }[] = [];
    let finalTextIntegrity: FinalTextIntegrityArtifact | null = null;
    let finalSubtitleIntegrity: FinalSubtitleIntegrityArtifact | null = null;
    let discoveredSpeechAnchors: DiscoveredSpeechAnchorsArtifact | null = null;
    let blindGenerationCompleted = false;
    let finalQuarantinedCandidates: {
      id: string;
      interval: { start: number; end: number };
      layer?:
        | "raw-vad"
        | "raw-no-vad"
        | "large-v3-refinement"
        | "recovery"
        | "canonical-rejected"
        | "quarantined";
      text?: string;
      repetitionHardError?: boolean;
      speechSupported?: boolean;
      independentProfileSupport?: boolean;
    }[] = [];

    if (selection.selected !== null) {
      const normalized = await extractEmbeddedSubtitle({
        mediaPath: manifest.workingMediaPath,
        stream: selection.selected,
        taskDirectory,
        runner: dependencies.runner,
        ffmpegPath,
        logger: dependencies.logger,
        manifest,
      });
      cues = layoutSubtitleCues(normalized.cues, {
        sourceTimingTrusted: true,
      });
      manifest.normalizationChanges = normalized.changes;
      warnings.push(...normalized.warnings);
      if (generateSrt) {
        const outputPath = path.join(subtitleDirectory, `${subtitleStem}.srt`);
        files.srt = outputPath;
        const content = formatSrt(cues);
        parseSrt(content);
        await atomicWriteFile(outputPath, content, { overwrite });
      }
      if (generateVtt) {
        const outputPath = path.join(subtitleDirectory, `${subtitleStem}.vtt`);
        files.vtt = outputPath;
        const content = formatVtt(cues);
        parseVtt(content);
        await atomicWriteFile(outputPath, content, { overwrite });
      }
      if (generateAss) {
        const outputPath = path.join(subtitleDirectory, `${subtitleStem}.ass`);
        files.ass = outputPath;
        const content = formatAss(cues);
        parseAss(content);
        await atomicWriteFile(outputPath, content, { overwrite });
      }
      manifest.completedStages.push(
        "embedded-subtitle-extraction",
        "subtitle-normalization",
      );
    } else if (allowOnlineSearch) {
      const online = await processOnlineSubtitles({
        identity,
        adapters: dependencies.subtitleSearchAdapters ?? [],
        subtitleDirectory,
        overwrite,
        logger: dependencies.logger,
        ...(options.subtitleScoreThresholds === undefined
          ? {}
          : { thresholds: options.subtitleScoreThresholds }),
      });
      searchResults = online.record;
      referenceSubtitles = online.references;
      manifest.completedStages.push("subtitle-search");
      if (online.primary !== null) {
        cues = layoutSubtitleCues(online.primary.cues, {
          sourceTimingTrusted: true,
        });
        primarySubtitle = {
          language: online.primary.candidate.candidate.language,
          sourceType: "online",
          validationStatus: online.primary.validationStatus,
          streamIndex: null,
        };
        if (online.primary.validationStatus === "needs-review") {
          warnings.push(
            "The selected online subtitle passed integrity checks but needs manual match review before burn-in.",
          );
        }
        if (generateSrt) {
          const outputPath = path.join(
            subtitleDirectory,
            `${subtitleStem}.srt`,
          );
          files.srt = outputPath;
          const content = formatSrt(cues);
          parseSrt(content);
          await atomicWriteFile(outputPath, content, { overwrite });
        }
        if (generateVtt) {
          const outputPath = path.join(
            subtitleDirectory,
            `${subtitleStem}.vtt`,
          );
          files.vtt = outputPath;
          const content = formatVtt(cues);
          parseVtt(content);
          await atomicWriteFile(outputPath, content, { overwrite });
        }
        if (generateAss) {
          const outputPath = path.join(
            subtitleDirectory,
            `${subtitleStem}.ass`,
          );
          files.ass = outputPath;
          const content = formatAss(cues);
          parseAss(content);
          await atomicWriteFile(outputPath, content, { overwrite });
        }
        manifest.completedStages.push("online-subtitle-selection");
      } else if (
        online.record.skippedReason === "media-identity-needs-confirmation"
      ) {
        status = "needs-subtitle-search";
        warnings.push(
          "Online search was paused because the inferred media identity needs confirmation.",
        );
      } else {
        status = "needs-audio-transcription";
        warnings.push(
          "No validated original-language online subtitle matched; continue with audio transcription.",
        );
      }
      for (const sourceError of online.record.sourceErrors) {
        warnings.push(
          `Subtitle source ${sourceError.sourceId} failed: ${sourceError.message}`,
        );
      }
      if (selection.graphicalCandidates.length > 0) {
        warnings.push(
          "Only graphical embedded subtitles were found; no text was fabricated.",
        );
      }
    } else {
      status = "needs-audio-transcription";
      searchResults = skippedSearchRecord("online-search-disabled-by-user");
      warnings.push(
        "Online subtitle search was disabled; continue with phase 4 transcription.",
      );
      if (selection.graphicalCandidates.length > 0) {
        warnings.push(
          "Only graphical embedded subtitles were found; no text was fabricated.",
        );
      }
    }

    // Persist search diagnostics before transcription so source results survive
    // a later local/cloud adapter failure and can be inspected independently.
    await atomicWriteJson(
      path.join(subtitleDirectory, "subtitle-search-results.json"),
      searchResults,
      { overwrite },
    );

    if (
      status === "needs-audio-transcription" &&
      options.transcribeWhenNeeded === true
    ) {
      const audioStreams = workingInfo.streams.filter(
        (stream) => stream.type === "audio",
      );
      const audioStream =
        (options.audioTrack === undefined
          ? audioStreams.find((stream) => stream.isDefault)
          : audioStreams.find(
              (stream) => stream.index === options.audioTrack,
            )) ?? audioStreams[0];
      if (audioStream === undefined) {
        throw new AppError(
          "The selected video has no audio stream to transcribe.",
          {
            code: "INVALID_INPUT",
            exitCode: 2,
          },
        );
      }
      const transcriptionLanguage =
        identity.dialogueLanguages.length === 1
          ? identity.dialogueLanguages[0]
          : undefined;
      const adaptive =
        dependencies.transcriptionAdapter === undefined &&
        options.transcriptionProvider !== "openai"
          ? await runAdaptiveLocalTranscription({
              mediaPath: manifest.workingMediaPath,
              taskDirectory,
              subtitleDirectory,
              sourceInfo: workingInfo,
              identity,
              audioStream,
              options,
              runner: dependencies.runner,
              logger: dependencies.logger,
              ffmpegPath,
              ffprobePath,
              overwrite,
              availableEmbeddedSubtitle: selection.textCandidates.length > 0,
              availableReferenceSubtitle: referenceSubtitles.length > 0,
              availablePrimarySubtitle: false,
              sourceMediaSha256: await sha256File(inputPath),
              asrCache,
              ...(preparedReference === null
                ? {}
                : { referenceTimeline: preparedReference.timeline }),
            })
          : null;
      if (adaptive !== null) {
        const referenceLyrics =
          guidanceMode === "reference-guided" && preparedReference !== null
            ? materializeReferenceOriginalLyrics({
                timeline: preparedReference.timeline,
                existingCues: adaptive.cues,
              })
            : null;
        const referenceLyricsResolution =
          referenceLyrics?.resolution ??
          referenceOriginalLyricsResolutionArtifactSchema.parse({
            schemaVersion: "1.0.0",
            generatedAt: now().toISOString(),
            inputHash: createHash("sha256")
              .update(JSON.stringify(adaptive.cues))
              .digest("hex"),
            configuration: {
              trustedReferenceOriginalOutranksLyricsAsr: true,
              minimumClassifierConfidence: 1,
            },
            addedCueIds: [],
            replacedCueIds: [],
            removedConflictingCueIds: [],
            conflicts: [],
            fallback: "reference-original-lyrics-unavailable",
          });
        const textPipeline = runTopScoreTextPipeline({
          cues: referenceLyrics?.cues ?? adaptive.cues,
          evidenceCues: [
            ...adaptive.hypothesisCandidates,
            ...(referenceLyrics?.cues.filter(
              (cue) => cue.textSource === "reference-original-language",
            ) ?? []),
          ],
          ...(preparedReference === null
            ? {}
            : { referenceTimeline: preparedReference.timeline }),
          semanticMode: referenceSemanticValidation,
          terminologyEntries: japaneseTerminology.entries,
          terminologySha256: japaneseTerminology.sha256,
          hypothesisMode: hypothesisResolutionMode,
          japaneseNormalization: japaneseNormalizationMode,
          japaneseTextAnalyzer,
          cueSegmentation: cueSegmentationMode,
          lyricsValidation: lyricsValidationMode,
          textIntegrity: textIntegrityMode,
          timingQaConfig: options.timingQaConfig,
          requestTimelineContract: adaptive.requestTimelineContract,
          candidateConsensus: options.candidateConsensus ?? "off",
          globalTokenTimeline: options.globalTokenTimeline ?? "off",
          candidateAssociation: options.candidateAssociation ?? "off",
          canonicalAssembly: options.canonicalAssembly ?? "off",
          timelineTransformChain: options.timelineTransformChain ?? "off",
        });
        if (textPipeline.candidatePrecision !== null) {
          await persistCandidatePrecisionArtifacts({
            subtitleDirectory,
            overwrite,
            artifacts: textPipeline.candidatePrecision,
          });
        }
        if (textPipeline.associationAssembly !== null) {
          await persistCandidateAssociationAssemblyArtifacts({
            subtitleDirectory,
            overwrite,
            artifacts: textPipeline.associationAssembly,
          });
        }
        const {
          semanticValidation,
          terminologyEvidence,
          hypothesisResolution,
          segmentation,
          textIntegrityGate,
        } = textPipeline;
        const supportedLyricsCueIds = [
          ...adaptive.supportedLyricsCueIds,
          ...(referenceLyrics?.addedCueIds ?? []),
        ];
        const finalPresentation = runFinalPresentationPipeline({
          cues: textIntegrityGate.cues,
          sourceCues: [
            ...hypothesisResolution.atomization.atoms,
            ...textPipeline.postNormalizationDeduplication.cues,
          ],
          terminologyEntries: japaneseTerminology.entries,
          cueSegmentation: cueSegmentationMode,
          japaneseTextAnalyzer,
          textIntegrity: textIntegrityMode,
          preserveUnresolvedOverlapForReview:
            options.machineQualityRecovery === "enforce" &&
            textIntegrityMode === "observe",
          timingQaConfig: options.timingQaConfig,
          vocalRegions: adaptive.vocalRegions,
          supportedLyricsCueIds,
          ...(preparedReference === null
            ? {}
            : { referenceTimeline: preparedReference.timeline }),
        });
        const {
          preliminarySubtitleIntegrity,
          finalSubtitleRepair,
          presentation,
          finalSubtitleGate: integrityGate,
          finalTextProjection,
          lineLayoutIntegrity,
          presentationConstraintIntegrity,
          unsafeCueIds: lineUnsafeCueIds,
        } = finalPresentation;
        const intraCueRepetitionRepair = combineIntraCueRepetitionArtifacts(
          textPipeline.intraCueRepetitionRepair.artifact,
          finalPresentation.intraCueRepetitionRepair.artifact,
        );
        finalTextIntegrity = finalTextProjection.artifact;
        const sceneCoverageFindings =
          adaptive.acousticScenes?.status === "completed"
            ? evaluateSceneCoverageIntegrity({
                scenes: adaptive.acousticScenes.scenes,
                cues: integrityGate.cues,
                activeReviewIntervals: [
                  ...adaptive.quality.needsHumanReviewIntervals.map(
                    (interval) => ({
                      interval,
                      category: "other" as const,
                    }),
                  ),
                  ...adaptive.missingDialogueRecovery.units
                    .filter((unit) =>
                      [
                        "needs-human-review",
                        "suspected-hallucination",
                      ].includes(unit.decision),
                    )
                    .map((unit) => ({
                      interval: unit.interval,
                      category: "missing-dialogue" as const,
                    })),
                  ...adaptive.lyricsTranscription.regions
                    .filter((region) => region.decision === "missing-lyrics")
                    .map((region) => ({
                      interval: region.region.interval,
                      category: "missing-lyrics" as const,
                    })),
                ],
                routingPlan: adaptive.asrRoutingPlan,
              })
            : [];
        const combinedIntegrityFindings = [
          ...integrityGate.artifact.findings,
          ...finalTextProjection.artifact.findings,
          ...finalPresentation.candidateLineLayoutIntegrity.findings.flatMap(
            (finding) => {
              const cue = presentation.cues.find(
                (candidate) => candidate.id === finding.cueId,
              );
              return cue === undefined
                ? []
                : [
                    {
                      id: finding.id,
                      code: finding.code,
                      severity: "hard" as const,
                      category: "presentation" as const,
                      interval: { start: cue.start, end: cue.end },
                      cueIds: [cue.id],
                      reasons: finding.reasons,
                    },
                  ];
            },
          ),
          ...adaptive.canonicalIntegrityFindings,
          ...sceneCoverageFindings,
        ].map((finding, index) => ({
          ...finding,
          id: `integrity-finding-${String(index + 1).padStart(5, "0")}`,
        }));
        const finalIntegrity = finalSubtitleIntegrityArtifactSchema.parse({
          ...integrityGate.artifact,
          validationStatus:
            combinedIntegrityFindings.length === 0 ? "passed" : "needs-review",
          candidateCueCount: Math.max(
            integrityGate.artifact.candidateCueCount,
            finalTextProjection.artifact.candidateCueCount,
          ),
          finalCueCount: integrityGate.cues.length,
          quarantinedCueIds: [
            ...new Set([
              ...finalTextProjection.artifact.quarantinedCueIds,
              ...lineUnsafeCueIds,
              ...integrityGate.artifact.quarantinedCueIds,
            ]),
          ],
          findings: combinedIntegrityFindings,
          gateFailures: [
            ...new Set([
              ...integrityGate.artifact.gateFailures,
              ...adaptive.canonicalIntegrityFindings.map(
                (finding) => finding.code,
              ),
              ...finalTextProjection.artifact.findings.map(
                (finding) => finding.code,
              ),
            ]),
          ],
        });
        finalSubtitleIntegrity = finalIntegrity;
        cues = integrityGate.cues;
        const postPresentationQuality = evaluateTranscriptionQuality({
          cues,
          expectedLanguages: identity.dialogueLanguages,
          timingConfig: options.timingQaConfig,
        });
        const finalReview = buildFinalReviewQueue({
          historicalQuality: adaptive.quality,
          postPresentationQuality,
          finalCues: cues,
          refinementRecord: adaptive.refinementRecord,
          timingRepairs: adaptive.timingRepairs,
          presentationTiming: presentation.timingRecords,
          speechIntervals: adaptive.speechIntervals,
          sceneBoundaries: workingInfo.chapters.flatMap((chapter) =>
            chapter.start === null || chapter.start <= 0 ? [] : [chapter.start],
          ),
          recoveryUnits: adaptive.missingDialogueRecovery.units,
          finalIntegrity,
          textIntegrityRepair: textPipeline.textIntegrityRepair.artifact,
          subtitleIntegrityRepair: finalSubtitleRepair.artifact,
          japaneseNormalization: textPipeline.japaneseNormalization.artifact,
          asrCacheManifest: asrCache.manifest(),
          ...(preparedReference === null
            ? {}
            : {
                referenceClassification: preparedReference.classification,
                referenceClassificationReview:
                  preparedReference.classificationReview,
              }),
          reviewGroupGapSeconds: options.reviewGroupGapSeconds ?? 0.75,
        });
        activeReviewIntervals = finalReview.queue.groups.map(
          (group) => group.interval,
        );
        finalSpeechIntervals = adaptive.speechIntervals;
        discoveredSpeechAnchors = adaptive.discoveredSpeechAnchors;
        finalQuarantinedCandidates = finalIntegrity.quarantinedCueIds.flatMap(
          (cueId) => {
            const cue = presentation.cues.find(
              (candidate) => candidate.id === cueId,
            );
            if (cue === undefined) return [];
            const findingCodes = finalIntegrity.findings
              .filter((finding) => finding.cueIds.includes(cueId))
              .map((finding) => finding.code);
            return [
              {
                id: cue.id,
                layer: "quarantined" as const,
                interval: { start: cue.start, end: cue.end },
                text: cue.text,
                repetitionHardError: findingCodes.some((code) =>
                  [
                    "EXACT_DUPLICATE_CUE",
                    "SENTENCE_LOOP",
                    "LONG_PHRASE_LOOP",
                    "CROSS_CUE_REPETITION",
                  ].includes(code),
                ),
                speechSupported: adaptive.speechIntervals.some(
                  (speech) => speech.start < cue.end && cue.start < speech.end,
                ),
                independentProfileSupport: false,
              },
            ];
          },
        );
        finalQuarantinedCandidates = [
          ...adaptive.quarantineEvidenceCandidates,
          ...finalQuarantinedCandidates,
        ];
        await Promise.all([
          atomicWriteJson(
            path.join(
              subtitleDirectory,
              "transcription-quality-pre-presentation.json",
            ),
            adaptive.quality,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(
              subtitleDirectory,
              "transcription-quality-post-presentation.json",
            ),
            postPresentationQuality,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "presentation-timing.json"),
            {
              schemaVersion: "1.0.0",
              records: presentation.timingRecords,
              characterRatioFallbackCount: presentation.timingRecords.filter(
                (record) => record.characterRatioFallback,
              ).length,
              characterFallbackSegmentationCount:
                presentation.characterFallbackSegmentationCount,
            },
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "cue-candidate-evidence.json"),
            hypothesisResolution.candidateEvidence,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "hypothesis-clusters.json"),
            hypothesisResolution.clusters,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "hypothesis-resolution.json"),
            hypothesisResolution.resolution,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "atomic-candidate-segmentation.json"),
            hypothesisResolution.atomization,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "atomic-hypothesis-clusters.json"),
            hypothesisResolution.atomicClusters,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "top-score-resolution.json"),
            hypothesisResolution.topScoreResolution,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "top-score-winners.json"),
            hypothesisResolution.topScoreWinners,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "winner-deduplication.json"),
            textPipeline.winnerDeduplication.artifact,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "fragment-repair.json"),
            textPipeline.fragmentRepair.artifact,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "winner-timing-repair.json"),
            textPipeline.winnerTimingRepair.artifact,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "japanese-lexical-normalization.json"),
            textPipeline.japaneseNormalization.artifact,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(
              subtitleDirectory,
              "post-normalization-deduplication.json",
            ),
            textPipeline.postNormalizationDeduplication.artifact,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "line-layout-integrity.json"),
            lineLayoutIntegrity,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "japanese-text-analysis.json"),
            segmentation.japaneseTextAnalysis,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "cue-segmentation-plan.json"),
            segmentation.plan,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "final-text-integrity.json"),
            finalTextProjection.artifact,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "text-integrity-repair.json"),
            textPipeline.textIntegrityRepair.artifact,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "lyrics-text-validity.json"),
            textPipeline.postRepairLyricsValidity,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "intra-cue-repetition-repair.json"),
            intraCueRepetitionRepair,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "post-text-repair-segmentation.json"),
            textPipeline.postTextRepairSegmentation.plan,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(
              subtitleDirectory,
              "post-subtitle-repair-segmentation.json",
            ),
            finalPresentation.postSubtitleRepairSegmentation.plan,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(
              subtitleDirectory,
              "presentation-constraint-integrity.json",
            ),
            presentationConstraintIntegrity,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "preliminary-subtitle-integrity.json"),
            preliminarySubtitleIntegrity,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(
              subtitleDirectory,
              "reference-original-lyrics-resolution.json",
            ),
            referenceLyricsResolution,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "semantic-candidate-validation.json"),
            semanticValidation,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "terminology-evidence.json"),
            terminologyEvidence,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "transcription-timing-findings.json"),
            finalReview.findings,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "final-review-queue.json"),
            finalReview.queue,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "final-subtitle-integrity.json"),
            finalIntegrity,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "final-subtitle-repair.json"),
            finalSubtitleRepair.artifact,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "asr-cache-manifest.json"),
            asrCache.manifest(),
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "asr-cache-migration.json"),
            asrCache.migrationArtifact(),
            { overwrite },
          ),
        ]);
        const emptyTranscript = cues.length === 0;
        if (emptyTranscript && adaptive.quality.needsHumanReviewCount === 0) {
          throw new AppError(
            "Adaptive transcription returned no audible dialogue cues.",
            {
              code: "USER_ACTION_REQUIRED",
              exitCode: 2,
              details: { audioStreamIndex: audioStream.index },
            },
          );
        }
        transcriptionQuality = adaptive.quality;
        packageTranscription = {
          ...adaptive.packageTranscription,
          textIntegrityRepair: {
            artifactPath: "text-integrity-repair.json",
            attempted:
              textPipeline.textIntegrityRepair.artifact.summary
                .repairAttemptCount,
            succeeded:
              textPipeline.textIntegrityRepair.artifact.summary
                .successfulRepairCount,
            stillHardBlocked:
              textPipeline.textIntegrityRepair.artifact.summary
                .stillHardBlockedCount,
          },
          finalSubtitleRepair: {
            artifactPath: "final-subtitle-repair.json",
            repaired: finalSubtitleRepair.artifact.repairs.filter(
              (repair) => repair.result !== "unresolved",
            ).length,
            unresolved:
              finalSubtitleRepair.artifact.summary.overlapUnresolvedCount +
              finalSubtitleRepair.artifact.summary.quarantinedAfterRepairCount,
          },
          asrCache: {
            manifestPath: "asr-cache-manifest.json",
            migrationPath: "asr-cache-migration.json",
            mode: asrCache.manifest().mode,
            requestCount: asrCache.manifest().summary.requestCount,
            hitCount:
              asrCache.manifest().summary.portableHitCount +
              asrCache.manifest().summary.taskLocalHitCount +
              asrCache.manifest().summary.legacyHitCount,
            migratedEntryCount: asrCache.manifest().summary.migratedEntryCount,
            missCount: asrCache.manifest().summary.missCount,
            workerRequestsAvoided:
              asrCache.manifest().summary.workerRequestsAvoided,
          },
          finalSubtitleIntegrity: {
            artifactPath: "final-subtitle-integrity.json",
            validationStatus: finalIntegrity.validationStatus,
            finalCueCount: finalIntegrity.finalCueCount,
            quarantinedCueCount: finalIntegrity.quarantinedCueIds.length,
            hardFindingCount: finalIntegrity.findings.filter(
              (finding) => finding.severity === "hard",
            ).length,
            subtitleCoverageRatio:
              finalIntegrity.vocalCoverage.subtitleCoverageRatio,
          },
          qualitySummary: {
            ...adaptive.packageTranscription.qualitySummary,
            needsHumanReview:
              finalReview.queue.reviewEventCount ??
              finalReview.queue.uniqueReviewGroupCount,
          },
        };
        primarySubtitle = emptyTranscript
          ? null
          : {
              language:
                transcriptionLanguage ??
                (cues.some((cue) => cue.language === "mixed")
                  ? "mixed"
                  : (cues[0]?.language ?? "und")),
              sourceType: "transcription",
              validationStatus:
                finalIntegrity.validationStatus === "needs-review" ||
                (finalReview.queue.reviewEventCount ??
                  finalReview.queue.uniqueReviewGroupCount) > 0 ||
                cues.some(
                  (cue) => cue.confidence === null || cue.confidence < 0.65,
                )
                  ? "needs-review"
                  : "validated",
              streamIndex: audioStream.index,
            };
        status = emptyTranscript ? "needs-audio-transcription" : "ready";
        if (emptyTranscript) {
          warnings.push(
            "Speech-like audio was detected but no reliable dialogue text was produced; review the recorded intervals or retry with a different local configuration.",
          );
        }
        if (generateSrt && !emptyTranscript) {
          const outputPath = path.join(
            subtitleDirectory,
            `${subtitleStem}.srt`,
          );
          files.srt = outputPath;
          const content = formatSrt(cues);
          parseSrt(content);
          await atomicWriteFile(outputPath, content, { overwrite });
        }
        if (generateVtt && !emptyTranscript) {
          const outputPath = path.join(
            subtitleDirectory,
            `${subtitleStem}.vtt`,
          );
          files.vtt = outputPath;
          const content = formatVtt(cues);
          parseVtt(content);
          await atomicWriteFile(outputPath, content, { overwrite });
        }
        if (generateAss && !emptyTranscript) {
          const outputPath = path.join(
            subtitleDirectory,
            `${subtitleStem}.ass`,
          );
          files.ass = outputPath;
          const content = formatAss(cues);
          parseAss(content);
          await atomicWriteFile(outputPath, content, { overwrite });
        }
        blindGenerationCompleted = !emptyTranscript;
        warnings.push(
          `Adaptive local transcription used ${adaptive.plan.strategy}: ${adaptive.quality.summary.accepted} accepted, ${adaptive.refinedIntervals} refined, ${finalReview.queue.humanReviewFindingCount} final findings, ${finalReview.queue.uniqueReviewGroupCount} review groups, and ${finalReview.queue.reviewEventCount ?? finalReview.queue.uniqueReviewGroupCount} review events.`,
        );
        if (finalIntegrity.validationStatus === "needs-review") {
          warnings.push(
            `Final subtitle integrity gate quarantined ${finalIntegrity.quarantinedCueIds.length} unsafe cues and retained ${finalIntegrity.findings.length} integrity findings for review.`,
          );
        }
        if (finalReview.queue.uniqueReviewGroupCount > 0) {
          warnings.push(
            `${finalReview.queue.uniqueReviewGroupCount} final-state review groups are organized into ${finalReview.queue.reviewEventCount ?? finalReview.queue.uniqueReviewGroupCount} user review events; see final-review-queue.json.`,
          );
        }
        manifest.transcription = {
          provider: "whisper-cpp",
          strategy: adaptive.plan.strategy,
          baseline: {
            model: adaptive.plan.baseline.model,
            coreML: adaptive.plan.baseline.coreML,
            ...(adaptive.plan.baseline.coreMLCapability === undefined
              ? {}
              : {
                  coreMLCapability: adaptive.plan.baseline.coreMLCapability,
                }),
          },
          refinement:
            adaptive.plan.refinement === null
              ? null
              : {
                  model: adaptive.plan.refinement.model,
                  coreML: adaptive.plan.refinement.coreML,
                  ...(adaptive.plan.refinement.coreMLCapability === undefined
                    ? {}
                    : {
                        coreMLCapability:
                          adaptive.plan.refinement.coreMLCapability,
                      }),
                  rounds: adaptive.refinementRoundsExecuted,
                },
          fallbacks: adaptive.plan.fallbacks,
          quality: {
            acceptedSegments: adaptive.quality.summary.accepted,
            refinedSegments: adaptive.refinedIntervals,
            humanReviewSegments: finalReview.queue.uniqueReviewGroupCount,
            reviewEventCount:
              finalReview.queue.reviewEventCount ??
              finalReview.queue.uniqueReviewGroupCount,
            vadNoVadConflicts: adaptive.quality.summary.vadNoVadConflicts,
            resolvedByLargeV3: adaptive.quality.summary.resolvedByLargeV3,
            suspectedHallucinations:
              adaptive.quality.summary.suspectedHallucinations,
            probableNonSpeech: adaptive.quality.summary.probableNonSpeech,
            autoResolvedVad: adaptive.quality.summary.autoResolvedVad ?? 0,
            autoResolvedNoVad: adaptive.quality.summary.autoResolvedNoVad ?? 0,
            autoResolvedLargeV3:
              adaptive.quality.summary.autoResolvedLargeV3 ?? 0,
            rejectedVadHallucinations:
              adaptive.quality.summary.rejectedVadHallucinations ?? 0,
            rejectedNoVadHallucinations:
              adaptive.quality.summary.rejectedNoVadHallucinations ?? 0,
            trueUnresolvedConflicts:
              adaptive.quality.summary.trueUnresolvedConflicts ?? 0,
            needsHumanReviewIntervals: finalReview.queue.groups.map(
              (group) => ({
                ...group.interval,
                reasons: group.reasons,
              }),
            ),
          },
          timing: {
            tokenTimestampsAvailable:
              adaptive.baselineAdapter.runtime?.tokenTimestampsAvailable ??
              false,
            tokenTimestampsUsed: adaptive.cues.some(
              (cue) => cue.timingEvidence?.tokenTimestampsUsed === true,
            ),
            timingRepairCount: adaptive.cues.filter((cue) =>
              ["token", "speech", "vad"].includes(
                cue.timingEvidence?.alignmentSource ?? "",
              ),
            ).length,
            characterRatioFallbackCount: presentation.timingRecords.filter(
              (record) => record.characterRatioFallback,
            ).length,
            prePresentationQualityPath:
              "transcription-quality-pre-presentation.json",
            postPresentationQualityPath:
              "transcription-quality-post-presentation.json",
            timingFindingsPath: "transcription-timing-findings.json",
            finalReviewQueuePath: "final-review-queue.json",
            whisperExecutionMetricsPath: "whisper-execution-metrics.json",
            canonicalAsrSegmentsPath:
              adaptive.canonicalSegmentation.artifactPath,
            missingDialogueRecoveryPath: "missing-dialogue-recovery.json",
            lyricsTranscriptionPath: "lyrics-transcription.json",
            finalSubtitleIntegrityPath: "final-subtitle-integrity.json",
            textIntegrityRepairPath: "text-integrity-repair.json",
            finalSubtitleRepairPath: "final-subtitle-repair.json",
            asrCacheManifestPath: "asr-cache-manifest.json",
            asrCacheMigrationPath: "asr-cache-migration.json",
            ...(adaptive.acousticScenes === undefined
              ? {}
              : {
                  acousticSceneWindowsPath: "acoustic-scene-windows.json",
                  acousticScenesPath: "acoustic-scenes.json",
                }),
            ...(adaptive.asrRoutingPlan === undefined
              ? {}
              : { asrRoutingPlanPath: "asr-routing-plan.json" }),
          },
        };
        manifest.completedStages.push(
          "device-profile",
          "media-profile",
          "transcription-planning",
          "audio-extraction",
          "audio-transcription",
          "transcription-quality-evaluation",
          "canonical-asr-segmentation",
          "missing-dialogue-recovery",
          "song-region-detection",
          "lyrics-transcription",
          ...(adaptive.acousticScenes === undefined
            ? []
            : ["acoustic-scene-analysis", "scene-asr-routing"]),
          "final-subtitle-integrity",
          ...(adaptive.plan.refinement === null
            ? []
            : ["targeted-transcription-refinement"]),
        );
      } else {
        const adapterResolution =
          dependencies.transcriptionAdapter === undefined
            ? await resolveTranscriptionAdapter({
                runner: dependencies.runner,
                durationSeconds: workingInfo.format.durationSeconds,
                ...(options.transcriptionProvider === undefined
                  ? {}
                  : { provider: options.transcriptionProvider }),
                ...(transcriptionLanguage === undefined
                  ? {}
                  : { language: transcriptionLanguage }),
                ...(options.timestampStrategy === undefined
                  ? {}
                  : { timestampStrategy: options.timestampStrategy }),
                ...(options.transcriptionModel === undefined
                  ? {}
                  : { openAIModel: options.transcriptionModel }),
                ...(options.localTranscriptionModelPath === undefined
                  ? {}
                  : { localModelPath: options.localTranscriptionModelPath }),
                ...(options.localTranscriptionModelDirectory === undefined
                  ? {}
                  : {
                      localModelDirectory:
                        options.localTranscriptionModelDirectory,
                    }),
                ...(options.localVadModelPath === undefined
                  ? {}
                  : { vadModelPath: options.localVadModelPath }),
                ...(options.useLocalVad === undefined
                  ? {}
                  : { useVad: options.useLocalVad }),
                ...(options.whisperCppPath === undefined
                  ? {}
                  : { whisperCppPath: options.whisperCppPath }),
              })
            : {
                adapter: dependencies.transcriptionAdapter,
                timestampStrategy:
                  options.timestampStrategy ??
                  (dependencies.transcriptionAdapter.id === "whisper-cpp"
                    ? "segment"
                    : "chunk"),
                rationale:
                  "Used the transcription adapter explicitly supplied by the caller.",
              };
        dependencies.logger.log("info", "Selected transcription adapter.", {
          adapterId: adapterResolution.adapter.id,
          model: adapterResolution.adapter.model,
          timestampStrategy: adapterResolution.timestampStrategy,
          rationale: adapterResolution.rationale,
        });
        const transcription = await transcribeMedia({
          mediaPath: manifest.workingMediaPath,
          outputDirectory: taskDirectory,
          audioStreamIndex: audioStream.index,
          durationSeconds: workingInfo.format.durationSeconds,
          adapter: adapterResolution.adapter,
          runner: dependencies.runner,
          logger: dependencies.logger,
          ffmpegPath,
          overwrite,
          asrCache,
          canonicalArtifactPath: path.join(
            subtitleDirectory,
            "canonical-asr-segments.json",
          ),
          sceneBoundaries: workingInfo.chapters.flatMap((chapter) =>
            chapter.start === null || chapter.start <= 0 ? [] : [chapter.start],
          ),
          ...(options.timingQaConfig === undefined
            ? {}
            : { timingConfig: options.timingQaConfig }),
          ...(transcriptionLanguage === undefined
            ? {}
            : { language: transcriptionLanguage }),
          timestampStrategy: adapterResolution.timestampStrategy,
          ...(options.targetAudioChunkSeconds === undefined
            ? {}
            : { targetChunkSeconds: options.targetAudioChunkSeconds }),
          promptNames: [
            ...new Set(
              [
                identity.title,
                identity.originalTitle,
                identity.episodeTitle,
                ...(options.transcriptionPromptNames ?? []),
              ].filter(
                (value): value is string =>
                  value !== null && value.trim() !== "",
              ),
            ),
          ],
        });
        const prePresentationQuality = evaluateTranscriptionQuality({
          cues: transcription.cues,
          expectedLanguages: identity.dialogueLanguages,
          timingConfig: options.timingQaConfig,
        });
        const referenceLyrics =
          guidanceMode === "reference-guided" && preparedReference !== null
            ? materializeReferenceOriginalLyrics({
                timeline: preparedReference.timeline,
                existingCues: transcription.cues,
              })
            : null;
        const referenceLyricsResolution =
          referenceLyrics?.resolution ??
          referenceOriginalLyricsResolutionArtifactSchema.parse({
            schemaVersion: "1.0.0",
            generatedAt: now().toISOString(),
            inputHash: createHash("sha256")
              .update(JSON.stringify(transcription.cues))
              .digest("hex"),
            configuration: {
              trustedReferenceOriginalOutranksLyricsAsr: true,
              minimumClassifierConfidence: 1,
            },
            addedCueIds: [],
            replacedCueIds: [],
            removedConflictingCueIds: [],
            conflicts: [],
            fallback: "reference-original-lyrics-unavailable",
          });
        const textPipeline = runTopScoreTextPipeline({
          cues: referenceLyrics?.cues ?? transcription.cues,
          ...(preparedReference === null
            ? {}
            : { referenceTimeline: preparedReference.timeline }),
          semanticMode: referenceSemanticValidation,
          terminologyEntries: japaneseTerminology.entries,
          terminologySha256: japaneseTerminology.sha256,
          hypothesisMode: hypothesisResolutionMode,
          japaneseNormalization: japaneseNormalizationMode,
          japaneseTextAnalyzer,
          cueSegmentation: cueSegmentationMode,
          lyricsValidation: lyricsValidationMode,
          textIntegrity: textIntegrityMode,
          timingQaConfig: options.timingQaConfig,
        });
        const {
          semanticValidation,
          terminologyEvidence,
          hypothesisResolution,
          segmentation,
          textIntegrityGate,
        } = textPipeline;
        const supportedLyricsCueIds = referenceLyrics?.addedCueIds ?? [];
        const finalPresentation = runFinalPresentationPipeline({
          cues: textIntegrityGate.cues,
          sourceCues: [
            ...hypothesisResolution.atomization.atoms,
            ...textPipeline.postNormalizationDeduplication.cues,
          ],
          terminologyEntries: japaneseTerminology.entries,
          cueSegmentation: cueSegmentationMode,
          japaneseTextAnalyzer,
          textIntegrity: textIntegrityMode,
          preserveUnresolvedOverlapForReview:
            options.machineQualityRecovery === "enforce" &&
            textIntegrityMode === "observe",
          timingQaConfig: options.timingQaConfig,
          supportedLyricsCueIds,
          ...(preparedReference === null
            ? {}
            : { referenceTimeline: preparedReference.timeline }),
        });
        const {
          preliminarySubtitleIntegrity,
          finalSubtitleRepair,
          presentation,
          finalSubtitleGate: integrityGate,
          finalTextProjection,
          lineLayoutIntegrity,
          presentationConstraintIntegrity,
          unsafeCueIds: lineUnsafeCueIds,
        } = finalPresentation;
        const intraCueRepetitionRepair = combineIntraCueRepetitionArtifacts(
          textPipeline.intraCueRepetitionRepair.artifact,
          finalPresentation.intraCueRepetitionRepair.artifact,
        );
        finalTextIntegrity = finalTextProjection.artifact;
        const combinedFindings = [
          ...integrityGate.artifact.findings,
          ...finalTextProjection.artifact.findings,
          ...finalPresentation.candidateLineLayoutIntegrity.findings.flatMap(
            (finding) => {
              const cue = presentation.cues.find(
                (candidate) => candidate.id === finding.cueId,
              );
              return cue === undefined
                ? []
                : [
                    {
                      id: finding.id,
                      code: finding.code,
                      severity: "hard" as const,
                      category: "presentation" as const,
                      interval: { start: cue.start, end: cue.end },
                      cueIds: [cue.id],
                      reasons: finding.reasons,
                    },
                  ];
            },
          ),
        ].map((finding, index) => ({
          ...finding,
          id: `integrity-finding-${String(index + 1).padStart(5, "0")}`,
        }));
        const finalIntegrity = finalSubtitleIntegrityArtifactSchema.parse({
          ...integrityGate.artifact,
          validationStatus:
            combinedFindings.length === 0 ? "passed" : "needs-review",
          candidateCueCount: Math.max(
            integrityGate.artifact.candidateCueCount,
            finalTextProjection.artifact.candidateCueCount,
          ),
          finalCueCount: integrityGate.cues.length,
          quarantinedCueIds: [
            ...new Set([
              ...finalTextProjection.artifact.quarantinedCueIds,
              ...lineUnsafeCueIds,
              ...integrityGate.artifact.quarantinedCueIds,
            ]),
          ],
          findings: combinedFindings,
          gateFailures: [
            ...new Set([
              ...integrityGate.artifact.gateFailures,
              ...finalTextProjection.artifact.findings.map(
                (finding) => finding.code,
              ),
            ]),
          ],
        });
        finalSubtitleIntegrity = finalIntegrity;
        cues = integrityGate.cues;
        const postPresentationQuality = evaluateTranscriptionQuality({
          cues,
          expectedLanguages: identity.dialogueLanguages,
          timingConfig: options.timingQaConfig,
        });
        const finalReview = buildFinalReviewQueue({
          historicalQuality: prePresentationQuality,
          postPresentationQuality,
          finalCues: cues,
          presentationTiming: presentation.timingRecords,
          finalIntegrity,
          textIntegrityRepair: textPipeline.textIntegrityRepair.artifact,
          subtitleIntegrityRepair: finalSubtitleRepair.artifact,
          japaneseNormalization: textPipeline.japaneseNormalization.artifact,
          asrCacheManifest: asrCache.manifest(),
          reviewGroupGapSeconds: options.reviewGroupGapSeconds ?? 0.75,
        });
        activeReviewIntervals = finalReview.queue.groups.map(
          (group) => group.interval,
        );
        transcriptionQuality = postPresentationQuality;
        await Promise.all([
          atomicWriteJson(
            path.join(
              subtitleDirectory,
              "transcription-quality-pre-presentation.json",
            ),
            prePresentationQuality,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(
              subtitleDirectory,
              "transcription-quality-post-presentation.json",
            ),
            postPresentationQuality,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "presentation-timing.json"),
            {
              schemaVersion: "1.0.0",
              records: presentation.timingRecords,
              characterRatioFallbackCount: presentation.timingRecords.filter(
                (record) => record.characterRatioFallback,
              ).length,
              characterFallbackSegmentationCount:
                presentation.characterFallbackSegmentationCount,
            },
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "cue-candidate-evidence.json"),
            hypothesisResolution.candidateEvidence,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "hypothesis-clusters.json"),
            hypothesisResolution.clusters,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "hypothesis-resolution.json"),
            hypothesisResolution.resolution,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "atomic-candidate-segmentation.json"),
            hypothesisResolution.atomization,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "atomic-hypothesis-clusters.json"),
            hypothesisResolution.atomicClusters,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "top-score-resolution.json"),
            hypothesisResolution.topScoreResolution,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "top-score-winners.json"),
            hypothesisResolution.topScoreWinners,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "winner-deduplication.json"),
            textPipeline.winnerDeduplication.artifact,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "fragment-repair.json"),
            textPipeline.fragmentRepair.artifact,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "winner-timing-repair.json"),
            textPipeline.winnerTimingRepair.artifact,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "japanese-lexical-normalization.json"),
            textPipeline.japaneseNormalization.artifact,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(
              subtitleDirectory,
              "post-normalization-deduplication.json",
            ),
            textPipeline.postNormalizationDeduplication.artifact,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "line-layout-integrity.json"),
            lineLayoutIntegrity,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "japanese-text-analysis.json"),
            segmentation.japaneseTextAnalysis,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "cue-segmentation-plan.json"),
            segmentation.plan,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "final-text-integrity.json"),
            finalTextProjection.artifact,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "text-integrity-repair.json"),
            textPipeline.textIntegrityRepair.artifact,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "lyrics-text-validity.json"),
            textPipeline.postRepairLyricsValidity,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "intra-cue-repetition-repair.json"),
            intraCueRepetitionRepair,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "post-text-repair-segmentation.json"),
            textPipeline.postTextRepairSegmentation.plan,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(
              subtitleDirectory,
              "post-subtitle-repair-segmentation.json",
            ),
            finalPresentation.postSubtitleRepairSegmentation.plan,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(
              subtitleDirectory,
              "presentation-constraint-integrity.json",
            ),
            presentationConstraintIntegrity,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "preliminary-subtitle-integrity.json"),
            preliminarySubtitleIntegrity,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(
              subtitleDirectory,
              "reference-original-lyrics-resolution.json",
            ),
            referenceLyricsResolution,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "semantic-candidate-validation.json"),
            semanticValidation,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "terminology-evidence.json"),
            terminologyEvidence,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "transcription-timing-findings.json"),
            finalReview.findings,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "final-review-queue.json"),
            finalReview.queue,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "final-subtitle-integrity.json"),
            finalIntegrity,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "final-subtitle-repair.json"),
            finalSubtitleRepair.artifact,
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "asr-cache-manifest.json"),
            asrCache.manifest(),
            { overwrite },
          ),
          atomicWriteJson(
            path.join(subtitleDirectory, "asr-cache-migration.json"),
            asrCache.migrationArtifact(),
            { overwrite },
          ),
        ]);
        if (cues.length === 0) {
          throw new AppError(
            "Transcription returned no audible dialogue cues.",
            {
              code: "USER_ACTION_REQUIRED",
              exitCode: 2,
              details: { audioStreamIndex: audioStream.index },
            },
          );
        }
        primarySubtitle = {
          language:
            transcriptionLanguage ??
            (cues.some((cue) => cue.language === "mixed")
              ? "mixed"
              : (cues[0]?.language ?? "und")),
          sourceType: "transcription",
          validationStatus:
            cues.some(
              (cue) => cue.confidence === null || cue.confidence < 0.65,
            ) ||
            finalIntegrity.validationStatus === "needs-review" ||
            finalReview.queue.uniqueReviewGroupCount > 0
              ? "needs-review"
              : "validated",
          streamIndex: audioStream.index,
        };
        status = "ready";
        if (generateSrt) {
          const outputPath = path.join(
            subtitleDirectory,
            `${subtitleStem}.srt`,
          );
          files.srt = outputPath;
          const content = formatSrt(cues);
          parseSrt(content);
          await atomicWriteFile(outputPath, content, { overwrite });
        }
        if (generateVtt) {
          const outputPath = path.join(
            subtitleDirectory,
            `${subtitleStem}.vtt`,
          );
          files.vtt = outputPath;
          const content = formatVtt(cues);
          parseVtt(content);
          await atomicWriteFile(outputPath, content, { overwrite });
        }
        if (generateAss) {
          const outputPath = path.join(
            subtitleDirectory,
            `${subtitleStem}.ass`,
          );
          files.ass = outputPath;
          const content = formatAss(cues);
          parseAss(content);
          await atomicWriteFile(outputPath, content, { overwrite });
        }
        blindGenerationCompleted = cues.length > 0;
        warnings.push(
          `Audio transcription completed with ${transcription.cacheHits} cached and ${transcription.transcribedChunks} newly processed chunks.`,
        );
        if (finalIntegrity.validationStatus === "needs-review") {
          warnings.push(
            `Final subtitle integrity gate quarantined ${finalIntegrity.quarantinedCueIds.length} unsafe cues and retained ${finalIntegrity.findings.length} integrity findings for review.`,
          );
        }
        manifest.completedStages.push(
          "audio-extraction",
          "audio-transcription",
          "final-subtitle-integrity",
        );
      }
    }

    if (blindGenerationCompleted) {
      if (
        guidanceMode === "reference-free" ||
        guidanceMode === "reference-assisted"
      ) {
        await writeBlindGenerationProof({
          guidanceMode,
          referencePathKnownBeforeGeneration:
            options.referenceSubtitlePath !== undefined,
          cues,
          canonicalTranscriptPath: path.join(
            subtitleDirectory,
            "canonical-asr-segments.json",
          ),
          subtitleDirectory,
          overwrite,
        });
        manifest.completedStages.push("blind-generation-proof");
      }
      if (
        guidanceMode === "reference-assisted" &&
        options.referenceSubtitlePath !== undefined
      ) {
        try {
          preparedReference = await prepareReferenceSubtitle({
            referencePath: options.referenceSubtitlePath,
            referenceLanguage: options.referenceLanguage ?? "und",
            mediaDurationSeconds: workingInfo.format.durationSeconds,
            timingMode: referenceTiming,
            contentPolicy: referenceContent,
            subtitleDirectory,
            overwrite,
          });
          manifest.completedStages.push(
            "reference-subtitle-classification",
            "reference-timeline",
          );
          manifest.referenceGuidance = {
            mode: guidanceMode,
            referencePathKnown: true,
            referenceOpenedBeforeBlindGeneration: false,
            referenceTextUsedAsTargetPrompt: false,
            analysisPath: "reference-subtitle-analysis.json",
            classificationReviewPath: "reference-classification-review.json",
            timelinePath: "reference-timeline.json",
            fallback: null,
          };
        } catch (error) {
          const failure =
            error instanceof Error ? error.message : String(error);
          warnings.push(
            `Reference-assisted analysis failed after blind generation; blind subtitles were preserved: ${failure}`,
          );
          manifest.referenceGuidance = {
            mode: guidanceMode,
            referencePathKnown: true,
            referenceOpenedBeforeBlindGeneration: false,
            referenceTextUsedAsTargetPrompt: false,
            fallback: `reference-analysis-failed:${failure}`,
          };
        }
      }
      if (preparedReference !== null) {
        try {
          await writeReferenceEvaluationArtifacts({
            prepared: preparedReference,
            generatedCues: cues,
            guidanceMode,
            semanticMode: referenceSemanticValidation,
            repairMode: referenceRepair,
            subtitleDirectory,
            activeReviewIntervals,
            ...(finalTextIntegrity === null ? {} : { finalTextIntegrity }),
            ...(finalSubtitleIntegrity === null
              ? {}
              : { finalSubtitleIntegrity }),
            coverageRecoveryMode: options.coverageRecovery ?? "auto",
            coverageRecoveryRounds: options.coverageRecoveryRounds ?? 2,
            coverageRecoveryMaxWindowSeconds:
              options.coverageRecoveryMaxWindowSeconds ?? 12,
            ...(options.referenceDialogueUnitMaxSeconds === undefined
              ? {}
              : {
                  referenceDialogueUnitMaxSeconds:
                    options.referenceDialogueUnitMaxSeconds,
                }),
            ...(options.referenceNarrationUnitMaxSeconds === undefined
              ? {}
              : {
                  referenceNarrationUnitMaxSeconds:
                    options.referenceNarrationUnitMaxSeconds,
                }),
            ...(options.referenceLyricsUnitMaxSeconds === undefined
              ? {}
              : {
                  referenceLyricsUnitMaxSeconds:
                    options.referenceLyricsUnitMaxSeconds,
                }),
            ...(options.referenceDenseAnchorLimit === undefined
              ? {}
              : {
                  referenceDenseAnchorLimit: options.referenceDenseAnchorLimit,
                }),
            ...(finalSpeechIntervals.length === 0
              ? {}
              : { speechIntervals: finalSpeechIntervals }),
            ...(finalQuarantinedCandidates.length === 0
              ? {}
              : { quarantinedCandidates: finalQuarantinedCandidates }),
            overwrite,
          });
          manifest.completedStages.push(
            "reference-alignment",
            "reference-evaluation",
            "reference-coverage-integrity",
            "false-quarantine-analysis",
          );
          manifest.referenceGuidance = {
            ...manifest.referenceGuidance,
            mode: guidanceMode,
            referencePathKnown: true,
            referenceOpenedBeforeBlindGeneration: false,
            referenceTextUsedAsTargetPrompt: false,
            analysisPath: "reference-subtitle-analysis.json",
            timelinePath: "reference-timeline.json",
            alignmentPath: "reference-cue-alignment.json",
            evaluationPath: "subtitle-evaluation.json",
            coverageIntegrityPath: "reference-coverage-integrity.json",
            coverageRecoveryPlanPath: "coverage-recovery-plan.json",
            coverageRecoveryResultsPath: "coverage-recovery-results.json",
            fallback: null,
          };
        } catch (error) {
          if (guidanceMode !== "reference-assisted") throw error;
          const failure =
            error instanceof Error ? error.message : String(error);
          warnings.push(
            `Reference-assisted evaluation failed without changing blind subtitles: ${failure}`,
          );
          manifest.referenceGuidance = {
            ...manifest.referenceGuidance,
            mode: guidanceMode,
            referencePathKnown: true,
            referenceOpenedBeforeBlindGeneration: false,
            referenceTextUsedAsTargetPrompt: false,
            fallback: `reference-evaluation-failed:${failure}`,
          };
        }
      }
      if (discoveredSpeechAnchors !== null) {
        const anchorCoverage = evaluateAnchorCoverageIntegrity({
          anchors: discoveredSpeechAnchors,
          finalCues: cues,
          activeReviewIntervals,
        });
        await atomicWriteJson(
          path.join(subtitleDirectory, "anchor-coverage-integrity.json"),
          anchorCoverage,
          { overwrite },
        );
        manifest.completedStages.push("anchor-coverage-integrity");
      }
    }

    let subtitledPath: string | undefined;
    if (options.burnSubtitles === true) {
      const requestedLanguage = options.burnLanguage;
      const primaryLanguage =
        primarySubtitle?.language ??
        (selection.selected?.language === "und"
          ? undefined
          : selection.selected?.language);
      const reference =
        requestedLanguage === undefined || requestedLanguage === primaryLanguage
          ? undefined
          : referenceSubtitles.find(
              (subtitle) => subtitle.language === requestedLanguage,
            );
      if (reference !== undefined) {
        throw new AppError(
          "Reference subtitles cannot be burned as the primary subtitle track.",
          {
            code: "USER_ACTION_REQUIRED",
            exitCode: 2,
            details: { requestedLanguage: requestedLanguage ?? null },
          },
        );
      }
      if (
        primarySubtitle !== null &&
        primarySubtitle !== undefined &&
        primarySubtitle.validationStatus !== "validated"
      ) {
        throw new AppError(
          "Subtitle burn-in requires a validated subtitle; the selected subtitle needs review.",
          {
            code: "USER_ACTION_REQUIRED",
            exitCode: 2,
            details: { requestedLanguage: requestedLanguage ?? null },
          },
        );
      }
      if (
        primarySubtitle === null &&
        (transcriptionQuality?.needsHumanReviewCount ?? 0) > 0
      ) {
        throw new AppError(
          "Subtitle burn-in is unavailable because transcription produced only unresolved review intervals.",
          {
            code: "USER_ACTION_REQUIRED",
            exitCode: 2,
            details: {
              needsHumanReview:
                transcriptionQuality?.needsHumanReviewIntervals ?? [],
            },
          },
        );
      }
      const subtitlePath = files.ass ?? files.srt ?? files.vtt;
      if (subtitlePath === null) {
        throw new AppError(
          "Subtitle burn-in requires a generated subtitle in the requested language.",
          {
            code: "USER_ACTION_REQUIRED",
            exitCode: 2,
            details: { requestedLanguage: requestedLanguage ?? null },
          },
        );
      }
      await burnSubtitleIntoVideo({
        mediaPath: manifest.workingMediaPath,
        subtitlePath,
        outputDirectory: taskDirectory,
        fontDirectories: options.fontDirectories ?? [
          "/System/Library/Fonts",
          "/Library/Fonts",
          path.join(homedir(), "Library/Fonts"),
        ],
        runner: dependencies.runner,
        logger: dependencies.logger,
        ffmpegPath,
        overwrite,
        manifest,
      });
      subtitledPath = "../video/subtitled.mkv";
      manifest.completedStages.push("subtitle-burn-in");
    }

    const subtitlePackage = createSubtitlePackage({
      sourceInfo,
      identity,
      selectedStream: selection.selected,
      cues,
      files,
      ...(primarySubtitle === undefined ? {} : { primarySubtitle }),
      referenceSubtitles,
      ...(subtitledPath === undefined ? {} : { subtitledPath }),
      status,
      warnings,
      ...(packageTranscription === undefined
        ? {}
        : { transcription: packageTranscription }),
      referenceGuidance: {
        mode: guidanceMode,
        referenceLanguage:
          options.referenceSubtitlePath === undefined
            ? null
            : (options.referenceLanguage ?? "und"),
        blindGenerationProofPath:
          guidanceMode === "reference-guided" || !blindGenerationCompleted
            ? null
            : "./blind-generation-proof.json",
        analysisPath:
          preparedReference === null
            ? null
            : "./reference-subtitle-analysis.json",
        classificationReviewPath:
          preparedReference === null
            ? null
            : "./reference-classification-review.json",
        timelinePath:
          preparedReference === null ? null : "./reference-timeline.json",
        alignmentPath:
          preparedReference === null ? null : "./reference-cue-alignment.json",
        evaluationPath:
          preparedReference === null ? null : "./subtitle-evaluation.json",
        coverageIntegrityPath:
          preparedReference === null
            ? null
            : "./reference-coverage-integrity.json",
        coverageRecoveryPlanPath:
          preparedReference === null ? null : "./coverage-recovery-plan.json",
        coverageRecoveryResultsPath:
          preparedReference === null
            ? null
            : "./coverage-recovery-results.json",
        referenceTextUsedAsTargetPrompt: false,
      },
    });
    subtitlePackageSchema.parse(subtitlePackage);
    await atomicWriteJson(
      path.join(subtitleDirectory, "subtitle-search-results.json"),
      searchResults,
      { overwrite: true },
    );
    await atomicWriteJson(
      path.join(subtitleDirectory, "subtitle-package.json"),
      subtitlePackage,
      { overwrite },
    );
    manifest.completedStages.push("subtitle-package-validation");
    manifest.status = "completed";
    await persistManifest(manifestPath, manifest, true);

    return {
      dryRun: false,
      outputDirectory: taskDirectory,
      sourceInfo,
      identity,
      subtitlePackage,
      selectedSubtitleStream: selection.selected,
      normalizationChanges: manifest.normalizationChanges,
      plannedActions,
      transcriptionQuality,
    };
  } catch (error) {
    const appError = toAppError(error);
    manifest.status = "failed";
    manifest.error = {
      code: appError.code,
      message: appError.message,
      details: appError.details,
    };
    if (!dryRun && manifestOwned) {
      try {
        await persistManifest(manifestPath, manifest, true);
      } catch {
        // Preserve the original failure. A missing manifest is reported by the CLI details.
      }
    }
    throw appError;
  }
}
