#!/usr/bin/env node

import { Command, InvalidArgumentError, Option } from "commander";

import {
  createGrammarAnalyzer,
  finalizeHostGrammarAnalysis,
  generateGrammarReport,
  prepareHostGrammarAnalysis,
  type AnalysisProvider,
  type GrammarAnalyzer,
} from "@mvl/grammar-report-core";
import { runPipeline } from "@mvl/pipeline-core";
import { buildLearningSite } from "@mvl/site-builder-core";
import { createConfiguredSubtitleSearchAdapters } from "@mvl/subtitle-search";

import {
  ConsoleLogger,
  DEFAULT_TIMING_QA_CONFIG,
  InputError,
  languageTagSchema,
  mediaTypeSchema,
  NodeProcessRunner,
  toAppError,
  type LanguageTag,
  type SubtitlePackage,
} from "@mvl/shared";
import {
  burnValidatedFinalSubtitle,
  finalizeSubtitleTask,
  prepareSubtitleReview,
  runVideoSubtitler,
  type VideoSubtitlerOptions,
} from "@mvl/video-subtitler";

interface GlobalOptions {
  jsonLogs?: boolean;
  debug?: boolean;
}

function transcriptionCliSummary(
  transcription: SubtitlePackage["transcription"] | undefined,
) {
  if (transcription === undefined) return null;
  return {
    coreMLStatus: transcription.coreML?.status ?? null,
    fallback: transcription.coreML?.fallback ?? null,
    vadNoVadConflicts: transcription.qualitySummary.vadNoVadConflicts ?? 0,
    resolvedByLargeV3: transcription.qualitySummary.resolvedByLargeV3 ?? 0,
    suspectedHallucinations:
      transcription.qualitySummary.suspectedHallucinations ?? 0,
    probableNonSpeech: transcription.qualitySummary.probableNonSpeech ?? 0,
    autoResolvedVad: transcription.qualitySummary.autoResolvedVad ?? 0,
    autoResolvedNoVad: transcription.qualitySummary.autoResolvedNoVad ?? 0,
    autoResolvedLargeV3: transcription.qualitySummary.autoResolvedLargeV3 ?? 0,
    rejectedVadHallucinations:
      transcription.qualitySummary.rejectedVadHallucinations ?? 0,
    rejectedNoVadHallucinations:
      transcription.qualitySummary.rejectedNoVadHallucinations ?? 0,
    trueUnresolvedConflicts:
      transcription.qualitySummary.trueUnresolvedConflicts ?? 0,
    needsHumanReview: transcription.qualitySummary.needsHumanReview,
    sceneAnalysis: transcription.sceneAnalysis ?? null,
  };
}

interface SubtitleCliOptions extends GlobalOptions {
  input: string;
  output?: string;
  audioTrack?: number;
  subtitleTrack?: number;
  languageMode: "auto" | "zh" | "ja" | "en" | "mixed";
  title?: string;
  originalTitle?: string;
  alternativeTitle?: string[];
  mediaType?: "movie" | "series" | "anime" | "documentary" | "unknown";
  season?: number;
  episode?: number;
  episodeTitle?: string;
  year?: number;
  releaseSource?: string;
  releaseGroup?: string;
  dialogueLanguage?: string[];
  primarySubtitleLanguage?: string[];
  referenceSubtitleLanguage?: string[];
  referenceSubtitle?: string;
  referenceLanguage?: string;
  guidanceMode: "reference-free" | "reference-assisted" | "reference-guided";
  referenceTiming: "trusted" | "verify" | "auto";
  referenceContent: "dialogue-only" | "dialogue-and-lyrics" | "all";
  referenceRepair: "off" | "missing-only" | "conflicts" | "all";
  referenceSemanticValidation: "off" | "auto" | "on";
  semanticValidation?: "off" | "auto" | "on";
  textIntegrity: "off" | "observe" | "enforce";
  cueSegmentation: "acoustic-semantic" | "token-only" | "legacy";
  hypothesisResolution: "top-score" | "conservative" | "balanced";
  japaneseTerminology?: string;
  japaneseNormalization: "off" | "top-score";
  japaneseTextAnalyzer: "auto" | "intl-segmenter" | "external";
  lyricsValidation: "conservative" | "balanced";
  referenceDialogueUnitMaxSeconds: number;
  referenceNarrationUnitMaxSeconds: number;
  referenceLyricsUnitMaxSeconds: number;
  referenceDenseAnchorLimit: number;
  coverageRecovery: "off" | "auto" | "deep";
  coverageRecoveryRounds: number;
  coverageRecoveryMaxWindow: number;
  asrCacheDir?: string;
  asrCacheImport?: string[];
  asrCacheMode: "off" | "read" | "read-write";
  migrateAsrCache?: boolean;
  referenceClassificationReviewThreshold: number;
  onlineSearch: boolean;
  webSubtitleFallback: boolean;
  regenerateSubtitles?: boolean;
  srt: boolean;
  vtt: boolean;
  ass: boolean;
  burn?: boolean;
  burnLanguage?: string;
  overwrite?: boolean;
  dryRun?: boolean;
  transportNormalization: "auto" | "never" | "always";
  transcriptionProvider: "auto" | "whisper-cpp" | "openai";
  transcriptionStrategy: "auto" | "quality" | "fast" | "adaptive";
  coreml: "auto" | "on" | "off";
  benchmark: "auto" | "force" | "off";
  maxFullQualityRuntimeSeconds: number;
  maxRefinementRounds: number;
  refinementContextSeconds: number;
  refinementMergeGapSeconds: number;
  maxMergedRefinementSeconds: number;
  noVadTieBreakBonus: number;
  fullSecondPass?: boolean;
  refine?: boolean;
  allowQualityFallback?: boolean;
  timestampStrategy?: "chunk" | "segment";
  transcriptionModel?: string;
  localTranscriptionModel?: string;
  localTranscriptionModelDirectory?: string;
  whisperVadModel?: string;
  whisperVad: boolean;
  whisperCppPath?: string;
  whisperExecutionMode: "auto" | "persistent" | "batch" | "process";
  reviewGroupGapSeconds: number;
  sceneAnalysis: "off" | "observe" | "route";
  sceneRouting: "conservative" | "balanced" | "aggressive";
  sceneWindowSeconds: number;
  sceneHopSeconds: number;
  sceneMinDurationSeconds: number;
  sceneConfidenceThreshold: number;
  nonSpeechSkipConfidence: number;
  subtitleSource?: ("opensubtitles" | "assrt")[];
  transcriptionPromptName?: string[];
  targetAudioChunkSeconds?: number;
  fontDirectory?: string[];
  dialogueLongDurationWarningSeconds: number;
  dialogueHighRiskDurationSeconds: number;
  veryShortTextMaxCharacters: number;
  lowCpsThreshold: number;
  leadingSilenceWarningSeconds: number;
  trailingSilenceWarningSeconds: number;
  minimumSpeechRatio: number;
  vadNoVadBoundaryDiffSeconds: number;
  subtitleTailPaddingSeconds: number;
  finalization: "auto" | "review-fallback" | "human";
  prepareReview?: boolean;
}

interface FinalizeCliOptions extends GlobalOptions {
  task: string;
  finalization: "auto" | "review-fallback" | "human";
  resolutions?: string;
  humanReviewedSubtitle?: string;
  sourceVideo?: string;
  prepareReview?: boolean;
  reviewAudio: boolean;
  dryRun?: boolean;
  presentationResolution: "off" | "observe" | "enforce";
  overlapResolution: "conservative" | "balanced";
}

interface ReviewCliOptions extends GlobalOptions {
  task: string;
  humanReviewedSubtitle?: string;
  sourceVideo?: string;
  reviewAudio: boolean;
}

interface GrammarCliOptions extends GlobalOptions {
  input?: string;
  text?: string;
  output?: string;
  explanationLanguage: "zh-CN" | "ja-JP" | "en";
  analysisProvider: AnalysisProvider;
  model?: string;
  prepareHost?: boolean;
  finalizeHost?: boolean;
  hostResponse?: string;
  batchSize: number;
  maxRetries: number;
  pauseThresholdSeconds: number;
  overwrite?: boolean;
}

interface SiteCliOptions extends GlobalOptions {
  input: string;
  output?: string;
  copyVideo?: string;
  overwrite?: boolean;
}

interface PipelineCliOptions extends GlobalOptions {
  input: string;
  output?: string;
  onlineSearch: boolean;
  webSubtitleFallback: boolean;
  title?: string;
  mediaType?: "movie" | "series" | "anime" | "documentary" | "unknown";
  season?: number;
  episode?: number;
  year?: number;
  dialogueLanguage?: string[];
  primarySubtitleLanguage?: string[];
  analysisProvider: AnalysisProvider;
  analysisModel?: string;
  explanationLanguage: "zh-CN" | "ja-JP" | "en";
  grammarBatchSize: number;
  grammarMaxRetries: number;
  transcriptionModel?: string;
  transcriptionProvider: "auto" | "whisper-cpp" | "openai";
  transcriptionStrategy: "auto" | "quality" | "fast" | "adaptive";
  coreml: "auto" | "on" | "off";
  benchmark: "auto" | "force" | "off";
  maxFullQualityRuntimeSeconds: number;
  maxRefinementRounds: number;
  refinementContextSeconds: number;
  refinementMergeGapSeconds: number;
  maxMergedRefinementSeconds: number;
  noVadTieBreakBonus: number;
  fullSecondPass?: boolean;
  refine?: boolean;
  allowQualityFallback?: boolean;
  timestampStrategy?: "chunk" | "segment";
  localTranscriptionModel?: string;
  localTranscriptionModelDirectory?: string;
  whisperVadModel?: string;
  whisperCppPath?: string;
  whisperExecutionMode: "auto" | "persistent" | "batch" | "process";
  hypothesisResolution: "top-score" | "conservative" | "balanced";
  japaneseTerminology?: string;
  japaneseNormalization: "off" | "top-score";
  coverageRecovery: "off" | "auto" | "deep";
  coverageRecoveryRounds: number;
  coverageRecoveryMaxWindow: number;
  asrCacheDir?: string;
  asrCacheImport?: string[];
  asrCacheMode: "off" | "read" | "read-write";
  migrateAsrCache?: boolean;
  reviewGroupGapSeconds: number;
  sceneAnalysis: "off" | "observe" | "route";
  sceneRouting: "conservative" | "balanced" | "aggressive";
  sceneWindowSeconds: number;
  sceneHopSeconds: number;
  sceneMinDurationSeconds: number;
  sceneConfidenceThreshold: number;
  nonSpeechSkipConfidence: number;
  subtitleSource?: ("opensubtitles" | "assrt")[];
  copyVideo?: boolean;
}

function configuredSubtitleSources(
  requested: readonly ("opensubtitles" | "assrt")[] | undefined,
  allowWebFallback: boolean,
) {
  const configured = createConfiguredSubtitleSearchAdapters({
    allowWebFallback,
  });
  return requested === undefined
    ? configured
    : configured.filter((adapter) =>
        requested.includes(adapter.id as "opensubtitles" | "assrt"),
      );
}

function positiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new InvalidArgumentError("Expected a non-negative integer.");
  }
  return parsed;
}

function positiveOneBasedInteger(value: string): number {
  const parsed = positiveInteger(value);
  if (parsed === 0)
    throw new InvalidArgumentError("Expected an integer greater than zero.");
  return parsed;
}

function positiveNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new InvalidArgumentError("Expected a number greater than zero.");
  }
  return parsed;
}

function nonNegativeNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new InvalidArgumentError("Expected a non-negative number.");
  }
  return parsed;
}

function ratio(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new InvalidArgumentError("Expected a number from zero to one.");
  }
  return parsed;
}

function smallTieBreak(value: string): number {
  const parsed = ratio(value);
  if (parsed > 0.05) {
    throw new InvalidArgumentError("Expected a number from zero to 0.05.");
  }
  return parsed;
}

function parseLanguages(
  values: readonly string[] | undefined,
): LanguageTag[] | undefined {
  if (values === undefined) return undefined;
  return values.map((value) => languageTagSchema.parse(value));
}

function grammarAnalyzer(
  provider: AnalysisProvider,
  model: string | undefined,
): GrammarAnalyzer {
  return createGrammarAnalyzer({
    provider,
    ...(model === undefined ? {} : { model }),
  });
}

function languageModeDefaults(
  mode: SubtitleCliOptions["languageMode"],
): LanguageTag[] | undefined {
  switch (mode) {
    case "zh":
      return ["zh"];
    case "ja":
      return ["ja"];
    case "en":
      return ["en"];
    case "mixed":
      return ["zh", "ja", "en"];
    case "auto":
      return undefined;
  }
}

const program = new Command()
  .name("multilingual-video-learning")
  .description("Multilingual subtitle, grammar-report, and learning-site CLI")
  .version("0.1.0")
  .showHelpAfterError()
  .option("--json-logs", "emit newline-delimited JSON logs")
  .option("--debug", "include debug logs");

program
  .command("subtitle")
  .description(
    "Inspect a local video and process text-based embedded subtitles",
  )
  .requiredOption("--input <path>", "user-selected local video")
  .option(
    "--output <directory>",
    "task output directory; defaults to a new output task",
  )
  .option(
    "--audio-track <index>",
    "ffprobe audio stream index",
    positiveInteger,
  )
  .option(
    "--subtitle-track <index>",
    "ffprobe subtitle stream index",
    positiveInteger,
  )
  .addOption(
    new Option("--language-mode <mode>", "dialogue language mode")
      .choices(["auto", "zh", "ja", "en", "mixed"])
      .default("auto"),
  )
  .option("--title <title>", "confirmed title")
  .option("--original-title <title>", "confirmed original title")
  .option("--alternative-title <titles...>", "alternative titles")
  .addOption(
    new Option("--media-type <type>", "media type").choices(
      mediaTypeSchema.options,
    ),
  )
  .option("--season <number>", "season number", positiveOneBasedInteger)
  .option("--episode <number>", "episode number", positiveOneBasedInteger)
  .option("--episode-title <title>", "episode title")
  .option("--year <year>", "release year", positiveOneBasedInteger)
  .option(
    "--release-source <source>",
    "BluRay, WEB-DL, DVD, TV, or another source",
  )
  .option("--release-group <group>", "release group")
  .option("--dialogue-language <codes...>", "dialogue language codes")
  .option(
    "--primary-subtitle-language <codes...>",
    "preferred original subtitle languages",
  )
  .option(
    "--reference-subtitle-language <codes...>",
    "reference subtitle languages",
  )
  .option(
    "--reference-subtitle <path>",
    "local SRT, VTT, or ASS timing/content reference",
  )
  .option(
    "--reference-language <code>",
    "language tag of the local reference subtitle",
  )
  .addOption(
    new Option(
      "--guidance-mode <mode>",
      "reference isolation and transcription guidance mode",
    )
      .choices(["reference-free", "reference-assisted", "reference-guided"])
      .default("reference-free"),
  )
  .addOption(
    new Option("--reference-timing <mode>", "reference timeline trust policy")
      .choices(["trusted", "verify", "auto"])
      .default("auto"),
  )
  .addOption(
    new Option(
      "--reference-content <policy>",
      "reference content admitted to the timeline",
    )
      .choices(["dialogue-only", "dialogue-and-lyrics", "all"])
      .default("dialogue-and-lyrics"),
  )
  .addOption(
    new Option("--reference-repair <mode>", "optional Phase C repair scope")
      .choices(["off", "missing-only", "conflicts", "all"])
      .default("off"),
  )
  .addOption(
    new Option(
      "--reference-semantic-validation <mode>",
      "cross-language semantic validation policy",
    )
      .choices(["off", "auto", "on"])
      .default("auto"),
  )
  .addOption(
    new Option(
      "--semantic-validation <mode>",
      "offline candidate/reference semantic validation policy",
    ).choices(["off", "auto", "on"]),
  )
  .addOption(
    new Option("--text-integrity <mode>", "final Japanese text integrity gate")
      .choices(["off", "observe", "enforce"])
      .default("enforce"),
  )
  .addOption(
    new Option(
      "--cue-segmentation <mode>",
      "cue segmentation before presentation layout",
    )
      .choices(["acoustic-semantic", "token-only", "legacy"])
      .default("acoustic-semantic"),
  )
  .addOption(
    new Option(
      "--hypothesis-resolution <mode>",
      "competing ASR hypothesis arbitration policy",
    )
      .choices(["top-score", "conservative", "balanced"])
      .default("top-score"),
  )
  .option(
    "--japanese-terminology <path>",
    "strict JSON Japanese terminology dictionary",
  )
  .addOption(
    new Option(
      "--japanese-normalization <mode>",
      "contextual Japanese lexical normalization policy",
    )
      .choices(["off", "top-score"])
      .default("top-score"),
  )
  .addOption(
    new Option(
      "--japanese-text-analyzer <mode>",
      "Japanese segmentation analyzer",
    )
      .choices(["auto", "intl-segmenter", "external"])
      .default("auto"),
  )
  .addOption(
    new Option("--lyrics-validation <mode>", "cross-cue lyrics validation")
      .choices(["conservative", "balanced"])
      .default("conservative"),
  )
  .option(
    "--reference-dialogue-unit-max-seconds <seconds>",
    "maximum reference-guided dialogue unit duration",
    positiveNumber,
    10,
  )
  .option(
    "--reference-narration-unit-max-seconds <seconds>",
    "maximum reference-guided narration unit duration",
    positiveNumber,
    16,
  )
  .option(
    "--reference-lyrics-unit-max-seconds <seconds>",
    "maximum reference-guided lyrics unit duration",
    positiveNumber,
    25,
  )
  .option(
    "--reference-dense-anchor-limit <count>",
    "maximum adjacent anchors in one reference-guided unit",
    positiveInteger,
    4,
  )
  .addOption(
    new Option(
      "--coverage-recovery <mode>",
      "targeted coverage recovery policy",
    )
      .choices(["off", "auto", "deep"])
      .default("auto"),
  )
  .option(
    "--coverage-recovery-rounds <count>",
    "maximum fixed-point coverage recovery rounds",
    positiveOneBasedInteger,
    2,
  )
  .option(
    "--coverage-recovery-max-window <seconds>",
    "maximum targeted recovery window",
    positiveNumber,
    12,
  )
  .option("--asr-cache-dir <path>", "portable ASR cache directory")
  .option(
    "--asr-cache-import <paths...>",
    "legacy output/cache roots to import using exact known keys",
  )
  .addOption(
    new Option("--asr-cache-mode <mode>", "portable ASR cache access mode")
      .choices(["off", "read", "read-write"])
      .default("read-write"),
  )
  .option("--migrate-asr-cache", "migrate compatible exact-key legacy entries")
  .option(
    "--reference-classification-review-threshold <ratio>",
    "reference cue classification review threshold",
    ratio,
    0.75,
  )
  .option(
    "--no-online-search",
    "record that online subtitle search is disabled",
  )
  .option(
    "--no-web-subtitle-fallback",
    "disable public-page subtitle lookup when an API credential is absent",
  )
  .addOption(
    new Option(
      "--subtitle-source <sources...>",
      "enabled configured subtitle sources",
    ).choices(["opensubtitles", "assrt"]),
  )
  .option(
    "--regenerate-subtitles",
    "ignore embedded subtitles and continue to later transcription",
  )
  .option("--no-srt", "do not generate SRT")
  .option("--no-vtt", "do not generate VTT")
  .option("--no-ass", "do not generate ASS")
  .option("--burn", "burn subtitles into a new video artifact")
  .option("--burn-language <code>", "primary or reference language to burn")
  .option(
    "--transcription-model <model>",
    "OpenAI transcription model (used only by the OpenAI adapter)",
  )
  .addOption(
    new Option(
      "--transcription-provider <provider>",
      "transcription adapter; auto prefers configured local whisper.cpp",
    )
      .choices(["auto", "whisper-cpp", "openai"])
      .default("auto"),
  )
  .addOption(
    new Option(
      "--transcription-strategy <strategy>",
      "local whisper.cpp strategy",
    )
      .choices(["auto", "quality", "fast", "adaptive"])
      .default("auto"),
  )
  .addOption(
    new Option("--coreml <mode>", "Core ML preference")
      .choices(["auto", "on", "off"])
      .default("auto"),
  )
  .addOption(
    new Option("--benchmark <mode>", "local Whisper benchmark behavior")
      .choices(["auto", "force", "off"])
      .default("auto"),
  )
  .option(
    "--max-full-quality-runtime-seconds <seconds>",
    "auto-strategy target for a complete large-v3 pass",
    positiveNumber,
    300,
  )
  .option(
    "--max-refinement-rounds <rounds>",
    "maximum targeted large-v3 refinement rounds",
    positiveInteger,
    2,
  )
  .option(
    "--refinement-context-seconds <seconds>",
    "context added around uncertain intervals",
    nonNegativeNumber,
    5,
  )
  .option(
    "--refinement-merge-gap-seconds <seconds>",
    "merge uncertain intervals separated by at most this gap",
    nonNegativeNumber,
    1.5,
  )
  .option(
    "--max-merged-refinement-seconds <seconds>",
    "maximum speech-aligned targeted refinement interval (hard cap: 45)",
    positiveNumber,
    30,
  )
  .option(
    "--no-vad-tie-break-bonus <ratio>",
    "weak no-VAD prior used only when every hypothesis is valid",
    smallTieBreak,
    0.04,
  )
  .option(
    "--full-second-pass",
    "explicitly allow large-v3 to re-transcribe the full media after baseline",
  )
  .option(
    "--refine",
    "enable targeted large-v3 refinement with the fast strategy",
  )
  .option(
    "--allow-quality-fallback",
    "allow explicit quality strategy to fall back when large-v3 is unavailable",
  )
  .option(
    "--local-transcription-model <path>",
    "explicit local whisper.cpp GGML model file",
  )
  .option(
    "--local-transcription-model-directory <path>",
    "directory containing local whisper.cpp GGML models",
  )
  .option("--whisper-cpp-path <path>", "whisper-cli executable path")
  .addOption(
    new Option(
      "--whisper-execution-mode <mode>",
      "whisper.cpp execution topology",
    )
      .choices(["auto", "persistent", "batch", "process"])
      .default("auto"),
  )
  .option(
    "--review-group-gap-seconds <seconds>",
    "maximum adjacent timing-review grouping gap",
    nonNegativeNumber,
    0.75,
  )
  .addOption(
    new Option("--scene-analysis <mode>", "acoustic scene analysis mode")
      .choices(["off", "observe", "route"])
      .default("observe"),
  )
  .addOption(
    new Option(
      "--scene-routing <mode>",
      "scene-aware additive routing sensitivity",
    )
      .choices(["conservative", "balanced", "aggressive"])
      .default("conservative"),
  )
  .option(
    "--scene-window-seconds <seconds>",
    "acoustic scene analysis window length",
    positiveNumber,
    3,
  )
  .option(
    "--scene-hop-seconds <seconds>",
    "acoustic scene analysis hop length",
    positiveNumber,
    1,
  )
  .option(
    "--scene-min-duration-seconds <seconds>",
    "minimum smoothed acoustic scene duration",
    positiveNumber,
    2,
  )
  .option(
    "--scene-confidence-threshold <ratio>",
    "minimum confidence for scene-driven routing",
    ratio,
    0.75,
  )
  .option(
    "--non-speech-skip-confidence <ratio>",
    "reserved future selective-skip confidence threshold",
    ratio,
    0.97,
  )
  .option(
    "--whisper-vad-model <path>",
    "optional whisper.cpp Silero VAD model path",
  )
  .option(
    "--no-whisper-vad",
    "disable whisper.cpp VAD when it drops quiet or music-backed dialogue",
  )
  .addOption(
    new Option(
      "--timestamp-strategy <strategy>",
      "transcription timestamp strategy",
    ).choices(["chunk", "segment"]),
  )
  .option(
    "--transcription-prompt-name <names...>",
    "confirmed names or terms for transcription context",
  )
  .option(
    "--target-audio-chunk-seconds <seconds>",
    "target chunk length before silence-boundary adjustment",
    positiveOneBasedInteger,
  )
  .option(
    "--dialogue-long-duration-warning-seconds <seconds>",
    "timing QA warning threshold for normal dialogue",
    positiveNumber,
    DEFAULT_TIMING_QA_CONFIG.longDurationWarningSeconds,
  )
  .option(
    "--dialogue-high-risk-duration-seconds <seconds>",
    "timing QA high-risk duration threshold",
    positiveNumber,
    DEFAULT_TIMING_QA_CONFIG.longDurationHighRiskSeconds,
  )
  .option(
    "--very-short-text-max-characters <count>",
    "maximum visible characters for short-text timing QA",
    positiveInteger,
    DEFAULT_TIMING_QA_CONFIG.shortTextCharacters,
  )
  .option(
    "--low-cps-threshold <cps>",
    "very-low visible characters-per-second threshold",
    nonNegativeNumber,
    DEFAULT_TIMING_QA_CONFIG.veryLowCps,
  )
  .option(
    "--leading-silence-warning-seconds <seconds>",
    "suspicious leading-silence threshold",
    nonNegativeNumber,
    DEFAULT_TIMING_QA_CONFIG.suspiciousLeadingSilenceSeconds,
  )
  .option(
    "--trailing-silence-warning-seconds <seconds>",
    "suspicious trailing-silence threshold",
    nonNegativeNumber,
    DEFAULT_TIMING_QA_CONFIG.suspiciousTrailingSilenceSeconds,
  )
  .option(
    "--minimum-speech-ratio <ratio>",
    "minimum speech coverage ratio for normal dialogue",
    ratio,
    DEFAULT_TIMING_QA_CONFIG.highRiskSpeechRatio,
  )
  .option(
    "--vad-no-vad-boundary-diff-seconds <seconds>",
    "VAD/no-VAD boundary disagreement threshold",
    nonNegativeNumber,
    DEFAULT_TIMING_QA_CONFIG.vadNoVadBoundaryDisagreementSeconds,
  )
  .option(
    "--subtitle-tail-padding-seconds <seconds>",
    "tail padding added after ordinary dialogue speech",
    nonNegativeNumber,
    DEFAULT_TIMING_QA_CONFIG.dialogueTailSeconds,
  )
  .option(
    "--font-directory <paths...>",
    "additional font directories for burn-in",
  )
  .addOption(
    new Option(
      "--finalization <mode>",
      "safe finalization mode after the machine draft",
    )
      .choices(["auto", "review-fallback", "human"])
      .default("review-fallback"),
  )
  .option(
    "--prepare-review",
    "prepare a local review package even when auto-finalization passes",
  )
  .option(
    "--overwrite",
    "overwrite files only inside the selected task output directory",
  )
  .option(
    "--dry-run",
    "inspect and show planned writes without creating output",
  )
  .addOption(
    new Option("--transport-normalization <mode>", "TS/M2TS remux behavior")
      .choices(["auto", "never", "always"])
      .default("auto"),
  )
  .action(async (options: SubtitleCliOptions, command: Command) => {
    const globals = command.optsWithGlobals<GlobalOptions>();
    const logger = new ConsoleLogger(
      globals.jsonLogs ?? false,
      globals.debug === true ? "debug" : "info",
    );
    const modeLanguages = languageModeDefaults(options.languageMode);
    const explicitDialogue = parseLanguages(options.dialogueLanguage);
    const identity = {
      ...(options.title === undefined ? {} : { title: options.title }),
      ...(options.originalTitle === undefined
        ? {}
        : { originalTitle: options.originalTitle }),
      ...(options.alternativeTitle === undefined
        ? {}
        : { alternativeTitles: options.alternativeTitle }),
      ...(options.mediaType === undefined
        ? {}
        : { mediaType: options.mediaType }),
      ...(options.season === undefined ? {} : { season: options.season }),
      ...(options.episode === undefined ? {} : { episode: options.episode }),
      ...(options.episodeTitle === undefined
        ? {}
        : { episodeTitle: options.episodeTitle }),
      ...(options.year === undefined ? {} : { year: options.year }),
      ...(options.releaseSource === undefined
        ? {}
        : { releaseSource: options.releaseSource }),
      ...(options.releaseGroup === undefined
        ? {}
        : { releaseGroup: options.releaseGroup }),
      ...(explicitDialogue === undefined && modeLanguages === undefined
        ? {}
        : { dialogueLanguages: explicitDialogue ?? modeLanguages ?? [] }),
      ...(options.primarySubtitleLanguage === undefined
        ? {}
        : {
            primarySubtitleLanguages:
              parseLanguages(options.primarySubtitleLanguage) ?? [],
          }),
      ...(options.referenceSubtitleLanguage === undefined
        ? {}
        : {
            referenceSubtitleLanguages:
              parseLanguages(options.referenceSubtitleLanguage) ?? [],
          }),
    };
    const runOptions: VideoSubtitlerOptions = {
      inputVideo: options.input,
      languageMode: options.languageMode,
      allowOnlineSubtitleSearch: options.onlineSearch,
      regenerateSubtitles: options.regenerateSubtitles ?? false,
      generateSrt: options.srt,
      generateVtt: options.vtt,
      generateAss: options.ass,
      burnSubtitles: false,
      overwrite: options.overwrite ?? false,
      dryRun: options.dryRun ?? false,
      transportNormalization: options.transportNormalization,
      transcribeWhenNeeded: true,
      transcriptionProvider: options.transcriptionProvider,
      transcriptionStrategy: options.transcriptionStrategy,
      coreML: options.coreml,
      benchmark: options.benchmark,
      maxFullQualityRuntimeSeconds: options.maxFullQualityRuntimeSeconds,
      maxRefinementRounds: options.maxRefinementRounds,
      refinementContextSeconds: options.refinementContextSeconds,
      refinementMergeGapSeconds: options.refinementMergeGapSeconds,
      maxMergedRefinementSeconds: options.maxMergedRefinementSeconds,
      noVadTieBreakBonus: options.noVadTieBreakBonus,
      whisperExecutionMode: options.whisperExecutionMode,
      reviewGroupGapSeconds: options.reviewGroupGapSeconds,
      sceneAnalysis: options.sceneAnalysis,
      sceneRouting: options.sceneRouting,
      sceneWindowSeconds: options.sceneWindowSeconds,
      sceneHopSeconds: options.sceneHopSeconds,
      sceneMinimumDurationSeconds: options.sceneMinDurationSeconds,
      sceneConfidenceThreshold: options.sceneConfidenceThreshold,
      nonSpeechSkipConfidence: options.nonSpeechSkipConfidence,
      guidanceMode: options.guidanceMode,
      referenceTiming: options.referenceTiming,
      referenceContent: options.referenceContent,
      referenceRepair: options.referenceRepair,
      referenceSemanticValidation: options.referenceSemanticValidation,
      ...(options.semanticValidation === undefined
        ? {}
        : { semanticValidation: options.semanticValidation }),
      textIntegrity: options.textIntegrity,
      cueSegmentation: options.cueSegmentation,
      hypothesisResolution: options.hypothesisResolution,
      ...(options.japaneseTerminology === undefined
        ? {}
        : { japaneseTerminologyPath: options.japaneseTerminology }),
      japaneseNormalization: options.japaneseNormalization,
      japaneseTextAnalyzer: options.japaneseTextAnalyzer,
      lyricsValidation: options.lyricsValidation,
      referenceDialogueUnitMaxSeconds: options.referenceDialogueUnitMaxSeconds,
      referenceNarrationUnitMaxSeconds:
        options.referenceNarrationUnitMaxSeconds,
      referenceLyricsUnitMaxSeconds: options.referenceLyricsUnitMaxSeconds,
      referenceDenseAnchorLimit: options.referenceDenseAnchorLimit,
      coverageRecovery: options.coverageRecovery,
      coverageRecoveryRounds: options.coverageRecoveryRounds,
      coverageRecoveryMaxWindowSeconds: options.coverageRecoveryMaxWindow,
      ...(options.asrCacheDir === undefined
        ? {}
        : { asrCacheDirectory: options.asrCacheDir }),
      ...(options.asrCacheImport === undefined
        ? {}
        : { asrCacheImportPaths: options.asrCacheImport }),
      asrCacheMode: options.asrCacheMode,
      ...(options.migrateAsrCache === undefined
        ? {}
        : { migrateAsrCache: options.migrateAsrCache }),
      referenceClassificationReviewThreshold:
        options.referenceClassificationReviewThreshold,
      fullSecondPass: options.fullSecondPass ?? false,
      refine: options.refine ?? false,
      allowQualityFallback: options.allowQualityFallback ?? false,
      timingQaConfig: {
        longDurationWarningSeconds: options.dialogueLongDurationWarningSeconds,
        longDurationHighRiskSeconds: options.dialogueHighRiskDurationSeconds,
        shortTextCharacters: options.veryShortTextMaxCharacters,
        veryLowCps: options.lowCpsThreshold,
        suspiciousLeadingSilenceSeconds: options.leadingSilenceWarningSeconds,
        suspiciousTrailingSilenceSeconds: options.trailingSilenceWarningSeconds,
        highRiskSpeechRatio: options.minimumSpeechRatio,
        vadNoVadBoundaryDisagreementSeconds:
          options.vadNoVadBoundaryDiffSeconds,
        dialogueTailSeconds: options.subtitleTailPaddingSeconds,
      },
      identity,
      ...(options.output === undefined
        ? {}
        : { outputDirectory: options.output }),
      ...(options.audioTrack === undefined
        ? {}
        : { audioTrack: options.audioTrack }),
      ...(options.subtitleTrack === undefined
        ? {}
        : { subtitleTrack: options.subtitleTrack }),
      ...(options.burnLanguage === undefined
        ? {}
        : { burnLanguage: languageTagSchema.parse(options.burnLanguage) }),
      ...(options.transcriptionModel === undefined
        ? {}
        : { transcriptionModel: options.transcriptionModel }),
      ...(options.localTranscriptionModel === undefined
        ? {}
        : { localTranscriptionModelPath: options.localTranscriptionModel }),
      ...(options.localTranscriptionModelDirectory === undefined
        ? {}
        : {
            localTranscriptionModelDirectory:
              options.localTranscriptionModelDirectory,
          }),
      ...(options.whisperCppPath === undefined
        ? {}
        : { whisperCppPath: options.whisperCppPath }),
      ...(options.whisperVadModel === undefined
        ? {}
        : { localVadModelPath: options.whisperVadModel }),
      useLocalVad: options.whisperVad,
      ...(options.timestampStrategy === undefined
        ? {}
        : { timestampStrategy: options.timestampStrategy }),
      ...(options.transcriptionPromptName === undefined
        ? {}
        : { transcriptionPromptNames: options.transcriptionPromptName }),
      ...(options.targetAudioChunkSeconds === undefined
        ? {}
        : { targetAudioChunkSeconds: options.targetAudioChunkSeconds }),
      ...(options.fontDirectory === undefined
        ? {}
        : { fontDirectories: options.fontDirectory }),
      ...(options.referenceSubtitle === undefined
        ? {}
        : { referenceSubtitlePath: options.referenceSubtitle }),
      ...(options.referenceLanguage === undefined
        ? {}
        : {
            referenceLanguage: languageTagSchema.parse(
              options.referenceLanguage,
            ),
          }),
    };
    const runner = new NodeProcessRunner();
    const result = await runVideoSubtitler(runOptions, {
      runner,
      logger,
      subtitleSearchAdapters: configuredSubtitleSources(
        options.subtitleSource,
        options.webSubtitleFallback,
      ),
    });
    let finalization =
      result.dryRun || result.outputDirectory === null
        ? null
        : await finalizeSubtitleTask({
            taskDirectory: result.outputDirectory,
            mode: options.finalization,
            sourceVideoPath: options.input,
            prepareReview: options.prepareReview ?? false,
            runner,
            logger,
          });
    if (
      options.burn === true &&
      finalization !== null &&
      result.outputDirectory !== null
    ) {
      finalization = await burnValidatedFinalSubtitle({
        result: finalization,
        mediaPath: options.input,
        outputDirectory: result.outputDirectory,
        runner,
        logger,
        overwrite: options.overwrite ?? false,
        ...(options.fontDirectory === undefined
          ? {}
          : { fontDirectories: options.fontDirectory }),
      });
    }
    console.log(
      JSON.stringify(
        {
          ok: true,
          dryRun: result.dryRun,
          outputDirectory: result.outputDirectory,
          selectedSubtitleStream: result.selectedSubtitleStream?.index ?? null,
          status: result.subtitlePackage?.status ?? "dry-run",
          transcription: result.subtitlePackage?.transcription ?? null,
          transcriptionSummary: transcriptionCliSummary(
            result.subtitlePackage?.transcription,
          ),
          asrArbitrationSummary: transcriptionCliSummary(
            result.subtitlePackage?.transcription,
          ),
          needsHumanReview:
            result.transcriptionQuality?.needsHumanReviewIntervals ?? [],
          plannedActions: result.plannedActions,
          finalization:
            finalization === null
              ? null
              : {
                  ...finalization.report.metrics,
                  finalizationMethod: finalization.report.finalizationMethod,
                  finalStatus: finalization.report.status,
                  outputPaths: finalization.report.outputPaths,
                },
        },
        null,
        2,
      ),
    );
  });

program
  .command("subtitle-finalize")
  .description("Safely finalize an existing machine subtitle task")
  .requiredOption("--task <directory>", "task or exact subtitle directory")
  .addOption(
    new Option("--finalization <mode>", "finalization mode")
      .choices(["auto", "review-fallback", "human"])
      .default("auto"),
  )
  .option("--resolutions <path>", "human-review-resolutions.json")
  .option(
    "--human-reviewed-subtitle <path>",
    "user-confirmed human-reviewed ASS used as the authoritative baseline",
  )
  .option(
    "--source-video <path>",
    "explicit source video for fingerprint/audio",
  )
  .option("--prepare-review", "always prepare the local review package")
  .addOption(
    new Option(
      "--presentation-resolution <mode>",
      "display-only presentation resolution policy",
    )
      .choices(["off", "observe", "enforce"])
      .default("enforce"),
  )
  .addOption(
    new Option(
      "--overlap-resolution <mode>",
      "evidence threshold for overlap classification",
    )
      .choices(["conservative", "balanced"])
      .default("conservative"),
  )
  .option("--no-review-audio", "skip review audio extraction")
  .option("--dry-run", "validate and compute without writing outputs")
  .action(async (options: FinalizeCliOptions, command: Command) => {
    const globals = command.optsWithGlobals<GlobalOptions>();
    const logger = new ConsoleLogger(
      globals.jsonLogs ?? false,
      globals.debug === true ? "debug" : "info",
    );
    const result = await finalizeSubtitleTask({
      taskDirectory: options.task,
      mode: options.finalization,
      ...(options.resolutions === undefined
        ? {}
        : { resolutionsPath: options.resolutions }),
      ...(options.humanReviewedSubtitle === undefined
        ? {}
        : { humanReviewedSubtitlePath: options.humanReviewedSubtitle }),
      ...(options.sourceVideo === undefined
        ? {}
        : { sourceVideoPath: options.sourceVideo }),
      prepareReview: options.prepareReview ?? false,
      presentationResolution: options.presentationResolution,
      overlapResolution: options.overlapResolution,
      generateReviewAudio: options.reviewAudio,
      dryRun: options.dryRun ?? false,
      runner: new NodeProcessRunner(),
      logger,
    });
    console.log(
      JSON.stringify(
        {
          ok: true,
          dryRun: result.dryRun,
          ...result.report.metrics,
          finalizationMethod: result.report.finalizationMethod,
          finalStatus: result.report.status,
          outputPaths: result.report.outputPaths,
        },
        null,
        2,
      ),
    );
  });

program
  .command("subtitle-review")
  .description("Prepare an offline static review package for a subtitle task")
  .requiredOption("--task <directory>", "task or exact subtitle directory")
  .option(
    "--human-reviewed-subtitle <path>",
    "user-confirmed human-reviewed ASS used as the authoritative baseline",
  )
  .option(
    "--source-video <path>",
    "explicit source video for fingerprint/audio",
  )
  .option("--no-review-audio", "skip review audio extraction")
  .action(async (options: ReviewCliOptions, command: Command) => {
    const globals = command.optsWithGlobals<GlobalOptions>();
    const logger = new ConsoleLogger(
      globals.jsonLogs ?? false,
      globals.debug === true ? "debug" : "info",
    );
    const result = await prepareSubtitleReview({
      taskDirectory: options.task,
      ...(options.humanReviewedSubtitle === undefined
        ? {}
        : { humanReviewedSubtitlePath: options.humanReviewedSubtitle }),
      ...(options.sourceVideo === undefined
        ? {}
        : { sourceVideoPath: options.sourceVideo }),
      generateReviewAudio: options.reviewAudio,
      runner: new NodeProcessRunner(),
      logger,
    });
    console.log(
      JSON.stringify(
        {
          ok: true,
          ...result.report.metrics,
          finalStatus: result.report.status,
          outputPaths: result.report.outputPaths,
        },
        null,
        2,
      ),
    );
  });

program
  .command("grammar-report")
  .description("Generate a validated multilingual grammar report")
  .option("--input <path>", "SRT, VTT, ASS, SSA, TXT, or subtitle-package JSON")
  .option("--text <text>", "direct text input")
  .option("--output <directory>", "report output directory")
  .addOption(
    new Option(
      "--explanation-language <language>",
      "report explanation language",
    )
      .choices(["zh-CN", "ja-JP", "en"])
      .default("zh-CN"),
  )
  .addOption(
    new Option("--analysis-provider <provider>", "analysis adapter")
      .choices(["host", "openai", "mock"])
      .default("host"),
  )
  .option("--model <model>", "grammar analysis model")
  .option(
    "--prepare-host",
    "prepare host-analysis-request.json without calling a model",
  )
  .option("--finalize-host", "validate a Host response and finish the report")
  .option(
    "--host-response <path>",
    "Host-produced response JSON; defaults inside --output",
  )
  .option(
    "--batch-size <number>",
    "sentences per analysis batch",
    positiveOneBasedInteger,
    8,
  )
  .option(
    "--max-retries <number>",
    "retries for unfinished batches",
    positiveInteger,
    2,
  )
  .option(
    "--pause-threshold-seconds <seconds>",
    "subtitle pause that closes a reconstructed sentence",
    Number,
    1.2,
  )
  .option("--overwrite", "replace files inside the selected report directory")
  .action(async (options: GrammarCliOptions, command: Command) => {
    const globals = command.optsWithGlobals<GlobalOptions>();
    const logger = new ConsoleLogger(
      globals.jsonLogs ?? false,
      globals.debug === true ? "debug" : "info",
    );
    if (options.prepareHost === true && options.finalizeHost === true) {
      throw new InputError(
        "Choose exactly one Host handoff phase: --prepare-host or --finalize-host.",
      );
    }
    if (
      options.analysisProvider !== "host" &&
      (options.prepareHost === true ||
        options.finalizeHost === true ||
        options.hostResponse !== undefined)
    ) {
      throw new InputError(
        "Host handoff options require --analysis-provider host.",
      );
    }
    if (options.analysisProvider === "host") {
      if (options.prepareHost === true) {
        const prepared = await prepareHostGrammarAnalysis({
          explanationLanguage: options.explanationLanguage,
          pauseThresholdSeconds: options.pauseThresholdSeconds,
          overwrite: options.overwrite ?? false,
          ...(options.input === undefined ? {} : { inputPath: options.input }),
          ...(options.text === undefined ? {} : { text: options.text }),
          ...(options.output === undefined
            ? {}
            : { outputDirectory: options.output }),
          ...(options.model === undefined ? {} : { model: options.model }),
        });
        console.log(
          JSON.stringify(
            { ok: true, phase: "prepare-host", ...prepared },
            null,
            2,
          ),
        );
        return;
      }
      if (options.finalizeHost === true) {
        if (options.output === undefined) {
          throw new InputError(
            "--output is required when finalizing a Host handoff.",
          );
        }
        if (options.input !== undefined || options.text !== undefined) {
          throw new InputError(
            "Do not pass --input or --text to --finalize-host; use the prepared --output directory.",
          );
        }
        const result = await finalizeHostGrammarAnalysis({
          outputDirectory: options.output,
          logger,
          batchSize: options.batchSize,
          maxHostAttempts: options.maxRetries + 1,
          overwrite: options.overwrite ?? true,
          ...(options.hostResponse === undefined
            ? {}
            : { hostResponsePath: options.hostResponse }),
        });
        console.log(
          JSON.stringify(
            {
              ok: true,
              phase: "finalize-host",
              outputDirectory: result.outputDirectory,
              report: result.reportJsonPath,
              markdown: result.reportMarkdownPath,
              sentenceCount: result.report.summary.sentenceCount,
              grammarPointCount: result.report.summary.grammarPointCount,
              cacheHits: result.cacheHits,
            },
            null,
            2,
          ),
        );
        return;
      }
    }
    const analyzer = grammarAnalyzer(options.analysisProvider, options.model);
    const result = await generateGrammarReport({
      analyzer,
      logger,
      explanationLanguage: options.explanationLanguage,
      batchSize: options.batchSize,
      maxRetries: options.maxRetries,
      pauseThresholdSeconds: options.pauseThresholdSeconds,
      overwrite: options.overwrite ?? false,
      ...(options.input === undefined ? {} : { inputPath: options.input }),
      ...(options.text === undefined ? {} : { text: options.text }),
      ...(options.output === undefined
        ? {}
        : { outputDirectory: options.output }),
    });
    console.log(
      JSON.stringify(
        {
          ok: true,
          outputDirectory: result.outputDirectory,
          report: result.reportJsonPath,
          markdown: result.reportMarkdownPath,
          sentenceCount: result.report.summary.sentenceCount,
          grammarPointCount: result.report.summary.grammarPointCount,
          cacheHits: result.cacheHits,
        },
        null,
        2,
      ),
    );
  });

program
  .command("build-learning-site")
  .description("Build a responsive static multilingual learning site")
  .requiredOption("--input <path>", "validated grammar-report.json")
  .option("--output <directory>", "analysis output directory containing site/")
  .option("--copy-video <path>", "explicitly copy this video into the site")
  .option("--overwrite", "replace only the selected site output directory")
  .action(async (options: SiteCliOptions) => {
    const result = await buildLearningSite({
      inputReport: options.input,
      overwrite: options.overwrite ?? false,
      ...(options.output === undefined
        ? {}
        : { outputDirectory: options.output }),
      ...(options.copyVideo === undefined
        ? {}
        : { copyVideoPath: options.copyVideo }),
    });
    console.log(
      JSON.stringify(
        {
          ok: true,
          outputDirectory: result.outputDirectory,
          siteDirectory: result.siteDirectory,
          report: result.reportPath,
          buildManifest: result.buildManifestPath,
          video: result.videoPath,
        },
        null,
        2,
      ),
    );
  });

program
  .command("pipeline")
  .description("Run or resume the complete subtitle → report → site workflow")
  .requiredOption("--input <path>", "user-selected local video")
  .option("--output <directory>", "task directory; reuse it to resume")
  .option("--no-online-search", "skip all online subtitle sources")
  .option(
    "--no-web-subtitle-fallback",
    "disable public-page subtitle lookup when an API credential is absent",
  )
  .option("--title <title>", "confirmed media title")
  .addOption(
    new Option("--media-type <type>", "media type").choices(
      mediaTypeSchema.options,
    ),
  )
  .option("--season <number>", "season number", positiveOneBasedInteger)
  .option("--episode <number>", "episode number", positiveOneBasedInteger)
  .option("--year <year>", "release year", positiveOneBasedInteger)
  .option("--dialogue-language <codes...>", "dialogue language codes")
  .option(
    "--primary-subtitle-language <codes...>",
    "preferred original subtitle languages",
  )
  .addOption(
    new Option("--analysis-provider <provider>", "grammar analysis adapter")
      .choices(["host", "openai", "mock"])
      .makeOptionMandatory(),
  )
  .option("--analysis-model <model>", "grammar analysis model")
  .addOption(
    new Option(
      "--explanation-language <language>",
      "report explanation language",
    )
      .choices(["zh-CN", "ja-JP", "en"])
      .default("zh-CN"),
  )
  .option(
    "--grammar-batch-size <number>",
    "sentences per grammar analysis batch",
    positiveOneBasedInteger,
    8,
  )
  .option(
    "--grammar-max-retries <number>",
    "retries for unfinished grammar batches",
    positiveInteger,
    2,
  )
  .option("--transcription-model <model>", "OpenAI transcription model")
  .addOption(
    new Option(
      "--transcription-provider <provider>",
      "transcription adapter; auto prefers configured local whisper.cpp",
    )
      .choices(["auto", "whisper-cpp", "openai"])
      .default("auto"),
  )
  .addOption(
    new Option(
      "--transcription-strategy <strategy>",
      "local whisper.cpp strategy",
    )
      .choices(["auto", "quality", "fast", "adaptive"])
      .default("auto"),
  )
  .addOption(
    new Option("--coreml <mode>", "Core ML preference")
      .choices(["auto", "on", "off"])
      .default("auto"),
  )
  .addOption(
    new Option("--benchmark <mode>", "local Whisper benchmark behavior")
      .choices(["auto", "force", "off"])
      .default("auto"),
  )
  .option(
    "--max-full-quality-runtime-seconds <seconds>",
    "auto-strategy target for a complete large-v3 pass",
    positiveNumber,
    300,
  )
  .option(
    "--max-refinement-rounds <rounds>",
    "maximum targeted large-v3 refinement rounds",
    positiveInteger,
    2,
  )
  .option(
    "--refinement-context-seconds <seconds>",
    "context added around uncertain intervals",
    nonNegativeNumber,
    5,
  )
  .option(
    "--refinement-merge-gap-seconds <seconds>",
    "merge uncertain intervals separated by at most this gap",
    nonNegativeNumber,
    1.5,
  )
  .option(
    "--max-merged-refinement-seconds <seconds>",
    "maximum speech-aligned targeted refinement interval (hard cap: 45)",
    positiveNumber,
    30,
  )
  .option(
    "--no-vad-tie-break-bonus <ratio>",
    "weak no-VAD prior used only when every hypothesis is valid",
    smallTieBreak,
    0.04,
  )
  .option("--full-second-pass", "allow a full large-v3 second pass")
  .option("--refine", "refine uncertain intervals in fast strategy")
  .option(
    "--allow-quality-fallback",
    "allow explicit quality strategy fallback",
  )
  .option(
    "--local-transcription-model <path>",
    "explicit local whisper.cpp GGML model file",
  )
  .option(
    "--local-transcription-model-directory <path>",
    "directory containing local whisper.cpp GGML models",
  )
  .option("--whisper-cpp-path <path>", "whisper-cli executable path")
  .addOption(
    new Option(
      "--whisper-execution-mode <mode>",
      "whisper.cpp execution topology",
    )
      .choices(["auto", "persistent", "batch", "process"])
      .default("auto"),
  )
  .option(
    "--review-group-gap-seconds <seconds>",
    "maximum adjacent timing-review grouping gap",
    nonNegativeNumber,
    0.75,
  )
  .addOption(
    new Option("--scene-analysis <mode>", "acoustic scene analysis mode")
      .choices(["off", "observe", "route"])
      .default("observe"),
  )
  .addOption(
    new Option(
      "--scene-routing <mode>",
      "scene-aware additive routing sensitivity",
    )
      .choices(["conservative", "balanced", "aggressive"])
      .default("conservative"),
  )
  .option(
    "--scene-window-seconds <seconds>",
    "acoustic scene analysis window length",
    positiveNumber,
    3,
  )
  .option(
    "--scene-hop-seconds <seconds>",
    "acoustic scene analysis hop length",
    positiveNumber,
    1,
  )
  .option(
    "--scene-min-duration-seconds <seconds>",
    "minimum smoothed acoustic scene duration",
    positiveNumber,
    2,
  )
  .option(
    "--scene-confidence-threshold <ratio>",
    "minimum confidence for scene-driven routing",
    ratio,
    0.75,
  )
  .option(
    "--non-speech-skip-confidence <ratio>",
    "reserved future selective-skip confidence threshold",
    ratio,
    0.97,
  )
  .option(
    "--whisper-vad-model <path>",
    "optional whisper.cpp Silero VAD model path",
  )
  .addOption(
    new Option(
      "--subtitle-source <sources...>",
      "enabled configured subtitle sources",
    ).choices(["opensubtitles", "assrt"]),
  )
  .addOption(
    new Option(
      "--timestamp-strategy <strategy>",
      "transcription timestamp strategy",
    ).choices(["chunk", "segment"]),
  )
  .addOption(
    new Option(
      "--hypothesis-resolution <mode>",
      "Top-Score arbitration; legacy modes map to Top-Score",
    )
      .choices(["top-score", "conservative", "balanced"])
      .default("top-score"),
  )
  .addOption(
    new Option(
      "--coverage-recovery <mode>",
      "targeted coverage recovery policy",
    )
      .choices(["off", "auto", "deep"])
      .default("auto"),
  )
  .option(
    "--coverage-recovery-rounds <count>",
    "maximum fixed-point coverage recovery rounds",
    positiveOneBasedInteger,
    2,
  )
  .option(
    "--coverage-recovery-max-window <seconds>",
    "maximum targeted recovery window",
    positiveNumber,
    12,
  )
  .option("--asr-cache-dir <path>", "portable ASR cache directory")
  .option("--asr-cache-import <paths...>", "legacy output/cache roots")
  .addOption(
    new Option("--asr-cache-mode <mode>", "portable ASR cache access mode")
      .choices(["off", "read", "read-write"])
      .default("read-write"),
  )
  .option("--migrate-asr-cache", "migrate compatible exact-key legacy entries")
  .option(
    "--japanese-terminology <path>",
    "strict JSON Japanese terminology dictionary",
  )
  .addOption(
    new Option(
      "--japanese-normalization <mode>",
      "contextual Japanese lexical normalization policy",
    )
      .choices(["off", "top-score"])
      .default("top-score"),
  )
  .option(
    "--copy-video",
    "explicitly copy the source video into the static site",
  )
  .action(async (options: PipelineCliOptions, command: Command) => {
    const globals = command.optsWithGlobals<GlobalOptions>();
    const logger = new ConsoleLogger(
      globals.jsonLogs ?? false,
      globals.debug === true ? "debug" : "info",
    );
    const analyzer = grammarAnalyzer(
      options.analysisProvider,
      options.analysisModel,
    );
    const dialogueLanguages = parseLanguages(options.dialogueLanguage);
    const primarySubtitleLanguages = parseLanguages(
      options.primarySubtitleLanguage,
    );
    const result = await runPipeline(
      {
        inputVideo: options.input,
        analyzer,
        explanationLanguage: options.explanationLanguage,
        grammarBatchSize: options.grammarBatchSize,
        grammarMaxRetries: options.grammarMaxRetries,
        copyVideoToSite: options.copyVideo ?? false,
        ...(options.output === undefined
          ? {}
          : { outputDirectory: options.output }),
        subtitle: {
          allowOnlineSubtitleSearch: options.onlineSearch,
          transcriptionProvider: options.transcriptionProvider,
          transcriptionStrategy: options.transcriptionStrategy,
          coreML: options.coreml,
          benchmark: options.benchmark,
          maxFullQualityRuntimeSeconds: options.maxFullQualityRuntimeSeconds,
          maxRefinementRounds: options.maxRefinementRounds,
          refinementContextSeconds: options.refinementContextSeconds,
          refinementMergeGapSeconds: options.refinementMergeGapSeconds,
          maxMergedRefinementSeconds: options.maxMergedRefinementSeconds,
          noVadTieBreakBonus: options.noVadTieBreakBonus,
          whisperExecutionMode: options.whisperExecutionMode,
          hypothesisResolution: options.hypothesisResolution,
          ...(options.japaneseTerminology === undefined
            ? {}
            : { japaneseTerminologyPath: options.japaneseTerminology }),
          japaneseNormalization: options.japaneseNormalization,
          coverageRecovery: options.coverageRecovery,
          coverageRecoveryRounds: options.coverageRecoveryRounds,
          coverageRecoveryMaxWindowSeconds: options.coverageRecoveryMaxWindow,
          ...(options.asrCacheDir === undefined
            ? {}
            : { asrCacheDirectory: options.asrCacheDir }),
          ...(options.asrCacheImport === undefined
            ? {}
            : { asrCacheImportPaths: options.asrCacheImport }),
          asrCacheMode: options.asrCacheMode,
          ...(options.migrateAsrCache === undefined
            ? {}
            : { migrateAsrCache: options.migrateAsrCache }),
          reviewGroupGapSeconds: options.reviewGroupGapSeconds,
          sceneAnalysis: options.sceneAnalysis,
          sceneRouting: options.sceneRouting,
          sceneWindowSeconds: options.sceneWindowSeconds,
          sceneHopSeconds: options.sceneHopSeconds,
          sceneMinimumDurationSeconds: options.sceneMinDurationSeconds,
          sceneConfidenceThreshold: options.sceneConfidenceThreshold,
          nonSpeechSkipConfidence: options.nonSpeechSkipConfidence,
          fullSecondPass: options.fullSecondPass ?? false,
          refine: options.refine ?? false,
          allowQualityFallback: options.allowQualityFallback ?? false,
          identity: {
            ...(options.title === undefined ? {} : { title: options.title }),
            ...(options.mediaType === undefined
              ? {}
              : { mediaType: options.mediaType }),
            ...(options.season === undefined ? {} : { season: options.season }),
            ...(options.episode === undefined
              ? {}
              : { episode: options.episode }),
            ...(options.year === undefined ? {} : { year: options.year }),
            ...(dialogueLanguages === undefined ? {} : { dialogueLanguages }),
            ...(primarySubtitleLanguages === undefined
              ? {}
              : { primarySubtitleLanguages }),
          },
          ...(options.transcriptionModel === undefined
            ? {}
            : { transcriptionModel: options.transcriptionModel }),
          ...(options.localTranscriptionModel === undefined
            ? {}
            : { localTranscriptionModelPath: options.localTranscriptionModel }),
          ...(options.localTranscriptionModelDirectory === undefined
            ? {}
            : {
                localTranscriptionModelDirectory:
                  options.localTranscriptionModelDirectory,
              }),
          ...(options.whisperCppPath === undefined
            ? {}
            : { whisperCppPath: options.whisperCppPath }),
          ...(options.whisperVadModel === undefined
            ? {}
            : { localVadModelPath: options.whisperVadModel }),
          ...(options.timestampStrategy === undefined
            ? {}
            : { timestampStrategy: options.timestampStrategy }),
        },
      },
      {
        runner: new NodeProcessRunner(),
        logger,
        subtitleSearchAdapters: configuredSubtitleSources(
          options.subtitleSource,
          options.webSubtitleFallback,
        ),
      },
    );
    console.log(
      JSON.stringify(
        {
          ok: true,
          outputDirectory: result.outputDirectory,
          subtitlePackage: result.subtitlePackagePath,
          grammarReport: result.grammarReportPath,
          siteDirectory: result.siteDirectory,
          skippedStages: result.skippedStages,
          resumedStages: result.resumedStages,
        },
        null,
        2,
      ),
    );
  });

try {
  await program.parseAsync(process.argv);
} catch (error) {
  const appError = toAppError(error);
  const jsonLogs = process.argv.includes("--json-logs");
  if (jsonLogs) {
    console.error(
      JSON.stringify({
        level: "error",
        code: appError.code,
        message: appError.message,
        details: appError.details,
      }),
    );
  } else {
    console.error(`[${appError.code}] ${appError.message}`);
    if (Object.keys(appError.details).length > 0) {
      console.error(JSON.stringify(appError.details, null, 2));
    }
  }
  process.exitCode = appError.exitCode;
}
