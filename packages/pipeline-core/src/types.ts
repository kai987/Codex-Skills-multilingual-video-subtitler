import type {
  ExplanationLanguage,
  GrammarAnalyzer,
} from "@mvl/grammar-report-core";
import type { Logger, ProcessRunner } from "@mvl/shared";
import type { SubtitleSearchAdapter } from "@mvl/subtitle-search";
import type { TranscriptionAdapter } from "@mvl/transcription-core";
import type { VideoSubtitlerOptions } from "@mvl/video-subtitler";

export type PipelineStageName = "subtitle" | "grammar-report" | "learning-site";

export interface PipelineStageState {
  status: "pending" | "running" | "completed" | "failed";
  attempts: number;
  startedAt: string | null;
  completedAt: string | null;
  outputs: string[];
  error: { code: string; message: string } | null;
}

export interface PipelineManifest {
  schemaVersion: "1.0.0";
  taskId: string;
  sourcePath: string;
  outputDirectory: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  updatedAt: string;
  stages: Record<PipelineStageName, PipelineStageState>;
  continuation: { command: "npm"; args: string[] } | null;
}

export interface PipelineOptions {
  inputVideo: string;
  outputDirectory?: string;
  subtitle?: Omit<
    VideoSubtitlerOptions,
    "inputVideo" | "outputDirectory" | "overwrite"
  >;
  analyzer: GrammarAnalyzer;
  explanationLanguage?: ExplanationLanguage;
  grammarBatchSize?: number;
  grammarMaxRetries?: number;
  copyVideoToSite?: boolean;
  now?: () => Date;
}

export interface PipelineDependencies {
  runner: ProcessRunner;
  logger: Logger;
  subtitleSearchAdapters?: readonly SubtitleSearchAdapter[];
  transcriptionAdapter?: TranscriptionAdapter;
}

export interface PipelineResult {
  outputDirectory: string;
  manifest: PipelineManifest;
  subtitlePackagePath: string;
  grammarReportPath: string;
  siteDirectory: string;
  resumedStages: PipelineStageName[];
  skippedStages: PipelineStageName[];
}
