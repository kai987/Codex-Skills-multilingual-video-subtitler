import type { GrammarReport, LanguageTag, Logger } from "@mvl/shared";

export type ExplanationLanguage = "zh-CN" | "ja-JP" | "en";
export type AnalysisProvider = "host" | "openai" | "mock";
export type GrammarSentence = GrammarReport["sentences"][number];
export type GrammarPoint = GrammarSentence["grammar"][number];
export type VocabularyItem = GrammarSentence["vocabulary"][number];

export interface ReconstructedSentence {
  id: string;
  cueIds: string[];
  start: number | null;
  end: number | null;
  language: LanguageTag;
  languages: LanguageTag[];
  text: string;
  previousSentenceId: string | null;
  nextSentenceId: string | null;
  reconstructionConfidence: number;
  needsReview: boolean;
}

export interface SentenceAnalysis {
  sentenceId: string;
  reading: string | null;
  translation: string | null;
  grammar: Omit<GrammarPoint, "id">[];
  vocabulary: VocabularyItem[];
}

export interface GrammarAnalyzer {
  readonly provider: AnalysisProvider;
  readonly id: string;
  readonly model: string;
  readonly configurationHash: string;
  readonly configurationDetails?: Readonly<Record<string, unknown>>;
  analyze(
    sentences: readonly ReconstructedSentence[],
    explanationLanguage: ExplanationLanguage,
  ): Promise<readonly SentenceAnalysis[]>;
}

export interface GrammarReportOptions {
  inputPath?: string;
  text?: string;
  outputDirectory?: string;
  explanationLanguage?: ExplanationLanguage;
  analyzer: GrammarAnalyzer;
  logger: Logger;
  batchSize?: number;
  maxRetries?: number;
  pauseThresholdSeconds?: number;
  overwrite?: boolean;
  now?: () => Date;
}

export interface GrammarReportResult {
  outputDirectory: string;
  report: GrammarReport;
  reportJsonPath: string;
  reportMarkdownPath: string;
  cacheHits: number;
  analyzedSentences: number;
}
