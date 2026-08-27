import type {
  LanguageTag,
  Logger,
  ProcessRunner,
  SubtitleCue,
  TimingQaConfig,
} from "@mvl/shared";
import type { PortableAsrCache } from "./asr-cache.js";

export type TimestampStrategy = "chunk" | "segment";
export type TranscriptionProvider = "auto" | "whisper-cpp" | "openai";
export type TranscriptionStrategy = "auto" | "quality" | "fast" | "adaptive";
export type CoreMLMode = "auto" | "on" | "off";
export type BenchmarkMode = "auto" | "force" | "off";
export type WhisperVadProfile = "sensitive-v2" | "extra-sensitive-v1";
export type AcousticSceneLabel =
  | "clean-dialogue"
  | "quiet-dialogue"
  | "noisy-dialogue"
  | "singing"
  | "non-speech"
  | "unknown";
export type SceneAnalysisMode = "off" | "observe" | "route";
export type SceneRoutingMode = "conservative" | "balanced" | "aggressive";
export type AsrRoutingStrategy =
  | "vad-only"
  | "extra-sensitive-vad"
  | "vad-plus-no-vad"
  | "lyrics-no-vad"
  | "observe-only"
  | "skip-dialogue-asr"
  | "conservative-default";

export interface TranscriptionInterval {
  start: number;
  end: number;
}

export interface AcousticSceneProbabilities {
  speech: number;
  vocal: number;
  music: number;
  drums: number;
  crowd: number;
  overlap: number;
  silence: number;
}

export interface AcousticSceneFeatures {
  rmsDb: number | null;
  snrDb: number | null;
  spectralFlatness: number | null;
  spectralFlux: number | null;
  zeroCrossingRate: number | null;
  speechActivityRatio: number;
  silenceRatio: number;
}

export interface AcousticSceneWindow {
  id: string;
  interval: TranscriptionInterval;
  probabilities: AcousticSceneProbabilities;
  features: AcousticSceneFeatures;
  proposedLabel: AcousticSceneLabel;
  smoothedLabel: AcousticSceneLabel;
  confidence: number;
  evidence: string[];
}

export interface AsrRoutingDecision {
  strategy: AsrRoutingStrategy;
  useVad: boolean;
  useExtraSensitiveVad: boolean;
  useNoVad: boolean;
  useLyricsMode: boolean;
  requireIndependentConsensus: boolean;
  requireLargeV3RefinementOnConflict: boolean;
  requireHumanReviewOnUnresolved: boolean;
  reasons: string[];
}

export interface AcousticSceneSegment {
  id: string;
  interval: TranscriptionInterval;
  label: AcousticSceneLabel;
  confidence: number;
  probabilities: AcousticSceneProbabilities;
  sourceWindowIds: string[];
  evidence: string[];
  boundarySource: "window-hop" | "hysteresis" | "minimum-duration-absorption";
  routingDecision: AsrRoutingDecision;
}

export interface AcousticSceneAnalysisConfig {
  sceneWindowSeconds: number;
  sceneHopSeconds: number;
  sceneMinimumDurationSeconds: number;
  sceneConfidenceThreshold: number;
  nonSpeechSkipConfidence: number;
}

export interface AcousticEventClassifierInput {
  interval: TranscriptionInterval;
  features: AcousticSceneFeatures;
  mediaDurationSeconds: number;
  previousProbabilities?: AcousticSceneProbabilities | undefined;
}

export interface AcousticEventClassifier {
  readonly id: string;
  readonly version: string;
  classifyWindow(
    input: AcousticEventClassifierInput,
  ): Promise<AcousticSceneProbabilities>;
}

export interface AcousticSceneWindowsArtifact {
  schemaVersion: "1.0.0";
  status: "completed" | "failed";
  generatedAt: string;
  analysisVersion: string;
  classifier: {
    id: string;
    version: string;
    kind: "heuristic" | "local-model";
  };
  config: AcousticSceneAnalysisConfig;
  sourceAudio: {
    sha256: string;
    sampleRate: number;
    channels: 1;
    durationSeconds: number;
  } | null;
  cache: {
    key: string | null;
    hit: boolean;
  };
  failure: string | null;
  windows: AcousticSceneWindow[];
}

export interface AcousticScenesArtifact {
  schemaVersion: "1.0.0";
  status: "completed" | "failed";
  generatedAt: string;
  analysisVersion: string;
  config: AcousticSceneAnalysisConfig;
  failure: string | null;
  scenes: AcousticSceneSegment[];
}

export interface AsrRoutingPlanEntry {
  sceneId: string;
  interval: TranscriptionInterval;
  label: AcousticSceneLabel;
  confidence: number;
  probabilities: AcousticSceneProbabilities;
  recommendedStrategy: AsrRoutingStrategy;
  actualStrategy: AsrRoutingStrategy | "legacy-baseline";
  observeOnly: boolean;
  decision: AsrRoutingDecision;
  execution: {
    vadBaseline: boolean;
    extraSensitiveVad: boolean;
    noVad: boolean;
    lyricsMode: boolean;
    cacheHits: number;
    asrRequestIds: string[];
  };
  reasons: string[];
}

export interface AsrRoutingPlanArtifact {
  schemaVersion: "1.0.0";
  status: "completed" | "failed";
  generatedAt: string;
  sceneAnalysisMode: SceneAnalysisMode;
  sceneRoutingMode: SceneRoutingMode;
  additiveOnly: true;
  selectiveSkipEnabled: false;
  analysisVersion: string;
  failure: string | null;
  entries: AsrRoutingPlanEntry[];
  summary: {
    sceneCount: number;
    proactiveNoVadScenes: number;
    proactiveExtraSensitiveVadScenes: number;
    proactiveLyricsScenes: number;
    noVadRequests: number;
    extraSensitiveVadRequests: number;
    lyricsRequests: number;
    cacheHits: number;
  };
}

export interface SceneAwareRefinementInterval {
  interval: TranscriptionInterval;
  expandedInterval: TranscriptionInterval;
  sceneId?: string | undefined;
  sceneLabel?: AcousticSceneLabel | undefined;
  sceneConfidence?: number | undefined;
  sceneProbabilities?: AcousticSceneProbabilities | undefined;
  sceneRoutingReasons?: string[] | undefined;
  referenceAnchorIds?: string[] | undefined;
}

export interface AudioChunk {
  id: string;
  relativePath: string;
  start: number;
  end: number;
  duration: number;
  sha256: string;
}

export interface AudioManifest {
  schemaVersion: "1.0.0";
  sourcePath: string;
  audioStreamIndex: number;
  sampleRate: number;
  channels: number;
  targetChunkSeconds: number;
  silenceThresholdDb: number;
  silenceMinimumSeconds: number;
  chunks: AudioChunk[];
}

export interface TranscriptionSegment {
  start: number;
  end: number;
  text: string;
  speaker: string | null;
  confidence: number | null;
  tokens?:
    | {
        text: string;
        start: number;
        end: number;
        probability?: number | null | undefined;
      }[]
    | undefined;
  metrics?:
    | {
        averageLogProbability?: number | null | undefined;
        noSpeechProbability?: number | null | undefined;
        tokenProbability?: number | null | undefined;
        entropy?: number | null | undefined;
        decoderFallback?: boolean | null | undefined;
        detectedLanguage?: LanguageTag | null | undefined;
      }
    | undefined;
}

export interface TranscriptionChunkResult {
  text: string;
  segments: TranscriptionSegment[];
  raw: unknown;
}

export interface TranscriptionRequest {
  audioPath: string;
  chunk: AudioChunk;
  language?: LanguageTag;
  prompt?: string;
  timestampStrategy: TimestampStrategy;
  tokenTimestamps?: boolean;
}

export interface TranscriptionAdapter {
  readonly id: string;
  readonly model: string;
  readonly runtime?:
    | {
        modelPath: string;
        modelFamily: string;
        modelHash: string;
        coreML: boolean;
        whisperCppVersion: string;
        tokenTimestampsAvailable?: boolean;
        fullJsonAvailable?: boolean;
      }
    | undefined;
  transcribe(request: TranscriptionRequest): Promise<TranscriptionChunkResult>;
}

export interface TranscriptionWorkflowOptions {
  mediaPath: string;
  outputDirectory: string;
  audioStreamIndex: number;
  durationSeconds: number;
  adapter: TranscriptionAdapter;
  runner: ProcessRunner;
  logger: Logger;
  ffmpegPath?: string;
  language?: LanguageTag;
  promptNames?: readonly string[];
  allowPreviousSegmentPrompt?: boolean;
  timestampStrategy?: TimestampStrategy;
  targetChunkSeconds?: number;
  silenceThresholdDb?: number;
  silenceMinimumSeconds?: number;
  speechIntervals?: readonly { start: number; end: number }[];
  sceneBoundaries?: readonly number[];
  canonicalArtifactPath?: string;
  timingConfig?: Partial<TimingQaConfig>;
  overwrite?: boolean;
  asrCache?: PortableAsrCache;
}

export interface TranscriptionWorkflowResult {
  cues: SubtitleCue[];
  audioManifest: AudioManifest;
  rawTranscriptionPath: string;
  canonicalArtifactPath: string;
  rawSegmentCount: number;
  canonicalUtteranceCount: number;
  cacheHits: number;
  transcribedChunks: number;
}

export interface MediaProfileInput {
  mediaPath: string;
  durationSeconds: number;
  dialogueLanguages: readonly LanguageTag[];
  audioTrack: {
    index: number;
    sampleRate: number | null;
    channels: number | null;
  };
  availableEmbeddedSubtitle: boolean;
  availableReferenceSubtitle: boolean;
  availablePrimarySubtitle: boolean;
  runner: ProcessRunner;
  ffmpegPath: string;
}
