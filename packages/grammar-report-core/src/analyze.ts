import { createHash } from "node:crypto";
import path from "node:path";

import { AppError, atomicWriteJson, pathExists, readJson } from "@mvl/shared";

import { sentenceAnalysisSchema } from "./analysis-schema.js";
import type {
  GrammarReportOptions,
  ReconstructedSentence,
  SentenceAnalysis,
} from "./types.js";

const ANALYZER_VERSION = "1.0.0";

export function analysisCacheKey(
  sentence: ReconstructedSentence,
  configurationHash: string,
  explanationLanguage: string,
  analysisProvider: string,
  context: {
    previousText: string | null;
    nextText: string | null;
  } = { previousText: null, nextText: null },
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        text: sentence.text,
        language: sentence.language,
        languages: sentence.languages,
        previousText: context.previousText,
        nextText: context.nextText,
        analysisProvider,
        schemaVersion: "1.0.0",
        analyzerVersion: ANALYZER_VERSION,
        configurationHash,
        explanationLanguage,
      }),
    )
    .digest("hex");
}

function sentenceContext(
  sentence: ReconstructedSentence,
  sentencesById: ReadonlyMap<string, ReconstructedSentence>,
): { previousText: string | null; nextText: string | null } {
  return {
    previousText:
      sentence.previousSentenceId === null
        ? null
        : (sentencesById.get(sentence.previousSentenceId)?.text ?? null),
    nextText:
      sentence.nextSentenceId === null
        ? null
        : (sentencesById.get(sentence.nextSentenceId)?.text ?? null),
  };
}

export function sentenceAnalysisCachePath(input: {
  sentence: ReconstructedSentence;
  sentencesById: ReadonlyMap<string, ReconstructedSentence>;
  analyzer: GrammarReportOptions["analyzer"];
  explanationLanguage: string;
  cacheDirectory: string;
}): string {
  const key = analysisCacheKey(
    input.sentence,
    input.analyzer.configurationHash,
    input.explanationLanguage,
    input.analyzer.provider,
    sentenceContext(input.sentence, input.sentencesById),
  );
  return path.join(input.cacheDirectory, `${key}.json`);
}

export async function loadCachedSentenceAnalyses(input: {
  sentences: readonly ReconstructedSentence[];
  analyzer: GrammarReportOptions["analyzer"];
  explanationLanguage: string;
  cacheDirectory: string;
}): Promise<{
  analyses: Map<string, SentenceAnalysis>;
  misses: ReconstructedSentence[];
}> {
  const analyses = new Map<string, SentenceAnalysis>();
  const misses: ReconstructedSentence[] = [];
  const sentencesById = new Map(
    input.sentences.map((sentence) => [sentence.id, sentence]),
  );
  for (const sentence of input.sentences) {
    const cachePath = sentenceAnalysisCachePath({
      sentence,
      sentencesById,
      analyzer: input.analyzer,
      explanationLanguage: input.explanationLanguage,
      cacheDirectory: input.cacheDirectory,
    });
    if (await pathExists(cachePath)) {
      analyses.set(
        sentence.id,
        sentenceAnalysisSchema.parse(await readJson(cachePath)),
      );
    } else {
      misses.push(sentence);
    }
  }
  return { analyses, misses };
}

export async function cacheSentenceAnalyses(input: {
  sentences: readonly ReconstructedSentence[];
  analyses: readonly SentenceAnalysis[];
  analyzer: GrammarReportOptions["analyzer"];
  explanationLanguage: string;
  cacheDirectory: string;
}): Promise<void> {
  const sentencesById = new Map(
    input.sentences.map((sentence) => [sentence.id, sentence]),
  );
  await Promise.all(
    input.analyses.map(async (analysis) => {
      const sentence = sentencesById.get(analysis.sentenceId);
      if (sentence === undefined) {
        throw new AppError(
          `Cannot cache analysis for unknown sentence ID: ${analysis.sentenceId}`,
          { code: "ANALYSIS_FAILED" },
        );
      }
      await atomicWriteJson(
        sentenceAnalysisCachePath({
          sentence,
          sentencesById,
          analyzer: input.analyzer,
          explanationLanguage: input.explanationLanguage,
          cacheDirectory: input.cacheDirectory,
        }),
        sentenceAnalysisSchema.parse(analysis),
        { overwrite: true },
      );
    }),
  );
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

export async function analyzeSentencesWithCache(input: {
  sentences: readonly ReconstructedSentence[];
  options: GrammarReportOptions;
  cacheDirectory: string;
  onProgress?: (completedSentenceIds: readonly string[]) => Promise<void>;
}): Promise<{
  analyses: Map<string, SentenceAnalysis>;
  cacheHits: number;
  analyzed: number;
}> {
  const explanationLanguage = input.options.explanationLanguage ?? "zh-CN";
  const cached = await loadCachedSentenceAnalyses({
    sentences: input.sentences,
    analyzer: input.options.analyzer,
    explanationLanguage,
    cacheDirectory: input.cacheDirectory,
  });
  const analyses = cached.analyses;
  const misses = cached.misses;
  const cacheHits = analyses.size;
  if (input.onProgress !== undefined) {
    await input.onProgress([...analyses.keys()]);
  }
  for (const batch of chunks(misses, input.options.batchSize ?? 8)) {
    let pending = batch;
    let lastError: unknown;
    const maxRetries = input.options.maxRetries ?? 2;
    for (
      let attempt = 0;
      pending.length > 0 && attempt <= maxRetries;
      attempt += 1
    ) {
      try {
        const returned = await input.options.analyzer.analyze(
          pending,
          explanationLanguage,
        );
        const requestedIds = new Set(pending.map((sentence) => sentence.id));
        const returnedById = new Map(
          returned.map((analysis) => {
            const parsed = sentenceAnalysisSchema.parse(analysis);
            if (!requestedIds.has(parsed.sentenceId)) {
              throw new AppError(
                `Analyzer returned an unrequested sentence ID: ${parsed.sentenceId}`,
                { code: "ANALYSIS_FAILED" },
              );
            }
            return [parsed.sentenceId, parsed] as const;
          }),
        );
        const nextPending: ReconstructedSentence[] = [];
        for (const sentence of pending) {
          const analysis = returnedById.get(sentence.id);
          if (analysis === undefined) {
            nextPending.push(sentence);
            continue;
          }
          analyses.set(sentence.id, analysis);
          await cacheSentenceAnalyses({
            sentences: input.sentences,
            analyses: [analysis],
            analyzer: input.options.analyzer,
            explanationLanguage,
            cacheDirectory: input.cacheDirectory,
          });
        }
        pending = nextPending;
        if (input.onProgress !== undefined) {
          await input.onProgress([...analyses.keys()]);
        }
        if (pending.length > 0) {
          lastError = new Error("Analyzer omitted sentence results.");
        }
      } catch (error) {
        lastError = error;
      }
    }
    if (pending.length > 0) {
      if (
        lastError instanceof AppError &&
        lastError.code === "HOST_ANALYSIS_VALIDATION_FAILED"
      ) {
        throw lastError;
      }
      throw new AppError(
        "Grammar analysis failed after retrying only unfinished sentences.",
        {
          code: "ANALYSIS_FAILED",
          details: {
            sentenceIds: pending.map((sentence) => sentence.id),
            cause:
              lastError instanceof Error
                ? lastError.message
                : String(lastError),
          },
          cause: lastError,
        },
      );
    }
  }
  return { analyses, cacheHits, analyzed: misses.length };
}

export { ANALYZER_VERSION };
