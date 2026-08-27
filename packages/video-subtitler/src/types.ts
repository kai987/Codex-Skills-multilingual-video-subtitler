import type {
  LanguageTag,
  Logger,
  MediaIdentity,
  ProcessRunner,
  SubtitlePackage,
  CoreMLCapabilityState,
  TimingQaConfig,
  ReferenceContentPolicy,
  ReferenceRepairMode,
  ReferenceSemanticValidationMode,
  ReferenceTimingMode,
  TranscriptionGuidanceMode,
  WhisperExecutionMode,
  CueSegmentationMode,
  ArtifactHypothesisResolutionMode,
  JapaneseTextAnalyzerMode,
  JapaneseNormalizationMode,
  LyricsValidationMode,
  TextIntegrityMode,
  CoverageRecoveryMode,
  MachineQualityRecoveryMode,
  CandidateConsensusMode,
  GlobalTokenTimelineMode,
  CandidateAssociationMode,
  CanonicalAssemblyMode,
  TimelineTransformChainMode,
} from "@mvl/shared";
import type { MediaIdentityOverrides } from "@mvl/media-identity";
import type {
  SubtitleScoreThresholds,
  SubtitleSearchAdapter,
} from "@mvl/subtitle-search";
import type { NormalizationChange } from "@mvl/subtitle-core";
import type {
  TimestampStrategy,
  BenchmarkMode,
  CoreMLMode,
  SceneAnalysisMode,
  SceneRoutingMode,
  TranscriptionAdapter,
  TranscriptionProvider,
  TranscriptionStrategy,
} from "@mvl/transcription-core";
import type { TranscriptionQuality } from "@mvl/shared";

export type StreamType =
  "video" | "audio" | "subtitle" | "attachment" | "data" | "unknown";

export interface MediaStreamInfo {
  index: number;
  type: StreamType;
  codec: string | null;
  codecLongName: string | null;
  language: LanguageTag;
  rawLanguage: string | null;
  title: string | null;
  startTime: number | null;
  durationSeconds: number | null;
  channels: number | null;
  sampleRate: number | null;
  width: number | null;
  height: number | null;
  isDefault: boolean;
  isForced: boolean;
  isTextSubtitle: boolean;
  isGraphicalSubtitle: boolean;
}

export interface TransportAnalysis {
  performed: boolean;
  programCount: number;
  hasMultiplePrograms: boolean;
  hasMissingLanguageTags: boolean;
  hasNonZeroStartTime: boolean;
  warningLines: string[];
  timestampWarnings: string[];
  corruptPacketWarnings: string[];
  needsNormalization: boolean;
  normalizationReason: string | null;
  normalizedRelativePath: string | null;
}

export interface SourceInfo {
  schemaVersion: "1.0.0";
  fileName: string;
  fileSizeBytes: number;
  extension: string;
  supportedExtension: boolean;
  inspectedAt: string;
  format: {
    names: string[];
    longName: string | null;
    durationSeconds: number;
    startTime: number | null;
    bitRate: number | null;
    title: string | null;
    tags: Record<string, string>;
  };
  streams: MediaStreamInfo[];
  programs: {
    id: number | null;
    number: number | null;
    streamIndexes: number[];
    tags: Record<string, string>;
  }[];
  chapters: {
    id: number | null;
    start: number | null;
    end: number | null;
    title: string | null;
  }[];
  transport: TransportAnalysis | null;
  warnings: string[];
}

export type TransportNormalizationMode = "auto" | "never" | "always";

export interface VideoSubtitlerOptions {
  inputVideo: string;
  outputDirectory?: string;
  audioTrack?: number;
  subtitleTrack?: number;
  languageMode?: "auto" | "zh" | "ja" | "en" | "mixed";
  allowOnlineSubtitleSearch?: boolean;
  regenerateSubtitles?: boolean;
  generateSrt?: boolean;
  generateVtt?: boolean;
  generateAss?: boolean;
  burnSubtitles?: boolean;
  burnLanguage?: LanguageTag;
  overwrite?: boolean;
  dryRun?: boolean;
  transportNormalization?: TransportNormalizationMode;
  identity?: MediaIdentityOverrides;
  ffmpegPath?: string;
  ffprobePath?: string;
  subtitleScoreThresholds?: SubtitleScoreThresholds;
  transcribeWhenNeeded?: boolean;
  transcriptionProvider?: TranscriptionProvider;
  transcriptionStrategy?: TranscriptionStrategy;
  coreML?: CoreMLMode;
  benchmark?: BenchmarkMode;
  maxFullQualityRuntimeSeconds?: number;
  maxRefinementRounds?: number;
  refinementContextSeconds?: number;
  refinementMergeGapSeconds?: number;
  maxMergedRefinementSeconds?: number;
  noVadTieBreakBonus?: number;
  fullSecondPass?: boolean;
  refine?: boolean;
  allowQualityFallback?: boolean;
  timestampStrategy?: TimestampStrategy;
  transcriptionModel?: string;
  localTranscriptionModelPath?: string;
  localTranscriptionModelDirectory?: string;
  localVadModelPath?: string;
  useLocalVad?: boolean;
  whisperCppPath?: string;
  whisperExecutionMode?: WhisperExecutionMode;
  reviewGroupGapSeconds?: number;
  sceneAnalysis?: SceneAnalysisMode;
  sceneRouting?: SceneRoutingMode;
  sceneWindowSeconds?: number;
  sceneHopSeconds?: number;
  sceneMinimumDurationSeconds?: number;
  sceneConfidenceThreshold?: number;
  nonSpeechSkipConfidence?: number;
  transcriptionPromptNames?: readonly string[];
  targetAudioChunkSeconds?: number;
  fontDirectories?: readonly string[];
  timingQaConfig?: Partial<TimingQaConfig>;
  referenceSubtitlePath?: string;
  referenceLanguage?: LanguageTag;
  guidanceMode?: TranscriptionGuidanceMode;
  referenceTiming?: ReferenceTimingMode;
  referenceContent?: ReferenceContentPolicy;
  referenceRepair?: ReferenceRepairMode;
  referenceSemanticValidation?: ReferenceSemanticValidationMode;
  semanticValidation?: ReferenceSemanticValidationMode;
  textIntegrity?: TextIntegrityMode;
  cueSegmentation?: CueSegmentationMode;
  hypothesisResolution?: ArtifactHypothesisResolutionMode;
  japaneseTerminologyPath?: string;
  japaneseNormalization?: JapaneseNormalizationMode;
  japaneseTextAnalyzer?: JapaneseTextAnalyzerMode;
  lyricsValidation?: LyricsValidationMode;
  referenceDialogueUnitMaxSeconds?: number;
  referenceNarrationUnitMaxSeconds?: number;
  referenceLyricsUnitMaxSeconds?: number;
  referenceDenseAnchorLimit?: number;
  coverageRecovery?: CoverageRecoveryMode;
  coverageRecoveryRounds?: number;
  coverageRecoveryMaxWindowSeconds?: number;
  asrCacheDirectory?: string;
  asrCacheImportPaths?: readonly string[];
  asrCacheMode?: "off" | "read" | "read-write";
  migrateAsrCache?: boolean;
  referenceClassificationReviewThreshold?: number;
  /** C6.0.1.1 is opt-in; off preserves the pre-C6.0.1.1 pipeline. */
  machineQualityRecovery?: MachineQualityRecoveryMode;
  /** C6.0.1.2 candidate-family and cross-window consensus policy. */
  candidateConsensus?: CandidateConsensusMode;
  /** C6.0.1.2 trusted original-media token timeline policy. */
  globalTokenTimeline?: GlobalTokenTimelineMode;
  /** C6.0.1.3 candidate-to-event association policy. */
  candidateAssociation?: CandidateAssociationMode;
  /** C6.0.1.3 event-first canonical assembly policy. */
  canonicalAssembly?: CanonicalAssemblyMode;
  /** C6.0.1.3 explicit request/token timeline composition policy. */
  timelineTransformChain?: TimelineTransformChainMode;
}

export interface VideoSubtitlerDependencies {
  runner: ProcessRunner;
  logger: Logger;
  now?: () => Date;
  subtitleSearchAdapters?: readonly SubtitleSearchAdapter[];
  transcriptionAdapter?: TranscriptionAdapter;
}

export interface VideoSubtitlerResult {
  dryRun: boolean;
  outputDirectory: string | null;
  sourceInfo: SourceInfo;
  identity: MediaIdentity;
  subtitlePackage: SubtitlePackage | null;
  selectedSubtitleStream: MediaStreamInfo | null;
  normalizationChanges: NormalizationChange[];
  plannedActions: string[];
  transcriptionQuality: TranscriptionQuality | null;
}

export interface ProcessingManifest {
  schemaVersion: "1.0.0";
  taskId: string;
  startedAt: string;
  updatedAt: string;
  sourcePath: string;
  outputDirectory: string;
  status: "running" | "completed" | "failed";
  completedStages: string[];
  workingMediaPath: string;
  operations: {
    executable: string;
    purpose: string;
    exitCode: number;
  }[];
  normalizationChanges: NormalizationChange[];
  transcription?: {
    provider: string;
    strategy: "quality" | "fast" | "adaptive";
    baseline: {
      model: string;
      coreML: boolean;
      coreMLCapability?: CoreMLCapabilityState;
    };
    refinement: {
      model: string;
      coreML: boolean;
      coreMLCapability?: CoreMLCapabilityState;
      rounds: number;
    } | null;
    fallbacks: {
      from: string;
      to: string;
      reason: string;
    }[];
    quality: {
      acceptedSegments: number;
      refinedSegments: number;
      humanReviewSegments: number;
      reviewEventCount?: number;
      vadNoVadConflicts: number;
      resolvedByLargeV3: number;
      suspectedHallucinations: number;
      probableNonSpeech: number;
      autoResolvedVad: number;
      autoResolvedNoVad: number;
      autoResolvedLargeV3: number;
      rejectedVadHallucinations: number;
      rejectedNoVadHallucinations: number;
      trueUnresolvedConflicts: number;
      needsHumanReviewIntervals: {
        start: number;
        end: number;
        reasons: string[];
      }[];
    };
    timing: {
      tokenTimestampsAvailable: boolean;
      tokenTimestampsUsed: boolean;
      timingRepairCount: number;
      characterRatioFallbackCount: number;
      prePresentationQualityPath: string;
      postPresentationQualityPath: string;
      timingFindingsPath?: string;
      finalReviewQueuePath?: string;
      whisperExecutionMetricsPath?: string;
      canonicalAsrSegmentsPath?: string;
      missingDialogueRecoveryPath?: string;
      lyricsTranscriptionPath?: string;
      finalSubtitleIntegrityPath?: string;
      acousticSceneWindowsPath?: string;
      acousticScenesPath?: string;
      asrRoutingPlanPath?: string;
      textIntegrityRepairPath?: string;
      finalSubtitleRepairPath?: string;
      asrCacheManifestPath?: string;
      asrCacheMigrationPath?: string;
    };
  };
  referenceGuidance?: {
    mode: TranscriptionGuidanceMode;
    referencePathKnown: boolean;
    referenceOpenedBeforeBlindGeneration: false;
    referenceTextUsedAsTargetPrompt: false;
    analysisPath?: string;
    classificationReviewPath?: string;
    timelinePath?: string;
    alignmentPath?: string;
    evaluationPath?: string;
    coverageIntegrityPath?: string;
    coverageRecoveryPlanPath?: string;
    coverageRecoveryResultsPath?: string;
    fallback: string | null;
  };
  error: {
    code: string;
    message: string;
    details: Readonly<Record<string, unknown>>;
  } | null;
}
