import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AppError,
  assertJsonSchema,
  atomicWriteFile,
  atomicWriteJson,
  compileJsonSchema,
  defaultTaskDirectory,
  grammarReportSchema,
  languageTagSchema,
  pathExists,
  readJson,
  safeStem,
  type GrammarReport,
} from "@mvl/shared";
import { z } from "zod";

import { ANALYZER_VERSION, analyzeSentencesWithCache } from "./analyze.js";
import {
  loadGrammarInput,
  reconstructSubtitleSentences,
  reconstructTextSentences,
} from "./input.js";
import { formatGrammarReportMarkdown } from "./markdown.js";
import type {
  AnalysisProvider,
  ExplanationLanguage,
  GrammarAnalyzer,
  GrammarReportOptions,
  GrammarReportResult,
  ReconstructedSentence,
} from "./types.js";

export interface AnalysisManifest {
  schemaVersion: "1.0.0";
  status: "running" | "completed" | "failed";
  analysisProvider: AnalysisProvider;
  analyzer: string;
  model: string;
  explanationLanguage: ExplanationLanguage;
  configurationHash: string;
  configurationDetails?: Readonly<Record<string, unknown>>;
  analyzerVersion: string;
  sentenceCount: number;
  completedSentenceIds: string[];
  failedSentenceIds: string[];
  updatedAt: string;
  hostHandoff?: Readonly<Record<string, unknown>>;
}

export interface GrammarPreparationOptions {
  inputPath?: string;
  text?: string;
  outputDirectory?: string;
  explanationLanguage?: ExplanationLanguage;
  pauseThresholdSeconds?: number;
  overwrite?: boolean;
  now?: () => Date;
}

export interface PreparedGrammarReport {
  outputDirectory: string;
  sourceType: "subtitle" | "text" | "subtitle-package";
  title: string | null;
  sentences: ReconstructedSentence[];
  speakersBySentenceId: ReadonlyMap<string, readonly string[]>;
}

const reconstructedSentenceSchema = z
  .object({
    id: z.string().min(1),
    cueIds: z.array(z.string().min(1)),
    start: z.number().nonnegative().nullable(),
    end: z.number().positive().nullable(),
    language: languageTagSchema,
    languages: z.array(languageTagSchema).min(1),
    text: z.string().min(1),
    previousSentenceId: z.string().min(1).nullable(),
    nextSentenceId: z.string().min(1).nullable(),
    reconstructionConfidence: z.number().min(0).max(1),
    needsReview: z.boolean(),
  })
  .strict();

const preparedSentencesSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    sentences: z.array(reconstructedSentenceSchema),
  })
  .strict();

const inputInfoSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    sourceType: z.enum(["subtitle", "text", "subtitle-package"]),
    fileName: z.string().min(1).nullable(),
    title: z.string().min(1).nullable(),
    cueCount: z.number().int().nonnegative(),
  })
  .strict();

async function writeReplaceableJson(
  filePath: string,
  value: unknown,
  overwrite: boolean,
): Promise<void> {
  await atomicWriteJson(filePath, value, {
    overwrite: overwrite || (await pathExists(filePath)),
  });
}

export async function prepareGrammarReportArtifacts(
  options: GrammarPreparationOptions,
): Promise<PreparedGrammarReport> {
  const now = options.now ?? (() => new Date());
  const loaded = await loadGrammarInput({
    ...(options.inputPath === undefined
      ? {}
      : { inputPath: options.inputPath }),
    ...(options.text === undefined ? {} : { text: options.text }),
  });
  const sentences =
    loaded.cues.length > 0
      ? reconstructSubtitleSentences(loaded.cues, options.pauseThresholdSeconds)
      : reconstructTextSentences(loaded.text);
  const outputDirectory = path.resolve(
    options.outputDirectory ??
      defaultTaskDirectory(
        options.inputPath ?? `${safeStem(loaded.text.slice(0, 40))}.txt`,
        now(),
      ),
  );
  const overwrite = options.overwrite ?? false;
  const normalizedTextPath = path.join(outputDirectory, "normalized-text.txt");
  await Promise.all([
    writeReplaceableJson(
      path.join(outputDirectory, "input-info.json"),
      {
        schemaVersion: "1.0.0",
        sourceType: loaded.sourceType,
        fileName: loaded.fileName,
        title: loaded.title,
        cueCount: loaded.cues.length,
      },
      overwrite,
    ),
    atomicWriteFile(normalizedTextPath, `${loaded.text.trim()}\n`, {
      overwrite: overwrite || (await pathExists(normalizedTextPath)),
    }),
    writeReplaceableJson(
      path.join(outputDirectory, "sentences.json"),
      {
        schemaVersion: "1.0.0",
        sentences,
      },
      overwrite,
    ),
  ]);
  return {
    outputDirectory,
    sourceType: loaded.sourceType,
    title: loaded.title,
    sentences,
    speakersBySentenceId: new Map(
      sentences.map((sentence) => [
        sentence.id,
        [
          ...new Set(
            loaded.cues
              .filter((cue) => sentence.cueIds.includes(cue.id))
              .map((cue) => cue.speaker)
              .filter((speaker): speaker is string => speaker !== null),
          ),
        ],
      ]),
    ),
  };
}

export async function loadPreparedGrammarReport(
  outputDirectory: string,
): Promise<PreparedGrammarReport> {
  const resolved = path.resolve(outputDirectory);
  const [inputInfo, sentenceFile] = await Promise.all([
    readJson(path.join(resolved, "input-info.json")),
    readJson(path.join(resolved, "sentences.json")),
  ]);
  const parsedInput = inputInfoSchema.parse(inputInfo);
  const parsedSentences = preparedSentencesSchema.parse(sentenceFile);
  return {
    outputDirectory: resolved,
    sourceType: parsedInput.sourceType,
    title: parsedInput.title,
    sentences: parsedSentences.sentences,
    speakersBySentenceId: new Map(),
  };
}

export function createAnalysisManifest(input: {
  prepared: PreparedGrammarReport;
  analyzer: GrammarAnalyzer;
  explanationLanguage: ExplanationLanguage;
  now: () => Date;
  hostHandoff?: Readonly<Record<string, unknown>>;
}): AnalysisManifest {
  return {
    schemaVersion: "1.0.0",
    status: "running",
    analysisProvider: input.analyzer.provider,
    analyzer: input.analyzer.id,
    model: input.analyzer.model,
    explanationLanguage: input.explanationLanguage,
    configurationHash: input.analyzer.configurationHash,
    ...(input.analyzer.configurationDetails === undefined
      ? {}
      : { configurationDetails: input.analyzer.configurationDetails }),
    analyzerVersion: ANALYZER_VERSION,
    sentenceCount: input.prepared.sentences.length,
    completedSentenceIds: [],
    failedSentenceIds: [],
    updatedAt: input.now().toISOString(),
    ...(input.hostHandoff === undefined
      ? {}
      : { hostHandoff: input.hostHandoff }),
  };
}

export async function writeAnalysisManifest(
  outputDirectory: string,
  manifest: AnalysisManifest,
): Promise<void> {
  await writeReplaceableJson(
    path.join(outputDirectory, "analysis-manifest.json"),
    manifest,
    true,
  );
}

function summarize(
  sentences: GrammarReport["sentences"],
): GrammarReport["summary"] {
  const languageCounts: Record<string, number> = {};
  const levelCounts: Record<string, number> = {};
  let grammarPointCount = 0;
  for (const sentence of sentences) {
    languageCounts[sentence.language] =
      (languageCounts[sentence.language] ?? 0) + 1;
    for (const grammar of sentence.grammar) {
      grammarPointCount += 1;
      const key = `${grammar.levelSystem}:${grammar.level}`;
      levelCounts[key] = (levelCounts[key] ?? 0) + 1;
    }
  }
  return {
    sentenceCount: sentences.length,
    grammarPointCount,
    languageCounts,
    levelCounts,
  };
}

function assertLevelAssignments(report: GrammarReport): void {
  for (const sentence of report.sentences) {
    for (const grammar of sentence.grammar) {
      const valid =
        grammar.levelSystem === "unknown" ||
        (grammar.language === "ja" && grammar.levelSystem === "JLPT") ||
        (grammar.language.startsWith("zh") && grammar.levelSystem === "HSK") ||
        (grammar.language === "en" && grammar.levelSystem === "CEFR");
      if (!valid) {
        throw new AppError(
          `Invalid level assignment for ${grammar.id}: ${grammar.language}/${grammar.levelSystem}`,
          { code: "ANALYSIS_FAILED" },
        );
      }
    }
  }
}

export async function finalizePreparedGrammarReport(
  prepared: PreparedGrammarReport,
  options: Omit<
    GrammarReportOptions,
    "inputPath" | "text" | "outputDirectory" | "pauseThresholdSeconds"
  >,
): Promise<GrammarReportResult> {
  const now = options.now ?? (() => new Date());
  const explanationLanguage = options.explanationLanguage ?? "zh-CN";
  const overwrite = options.overwrite ?? false;
  const manifest = createAnalysisManifest({
    prepared,
    analyzer: options.analyzer,
    explanationLanguage,
    now,
  });
  await writeAnalysisManifest(prepared.outputDirectory, manifest);
  try {
    const analyzed = await analyzeSentencesWithCache({
      sentences: prepared.sentences,
      options: {
        ...options,
        outputDirectory: prepared.outputDirectory,
      },
      cacheDirectory: path.join(prepared.outputDirectory, "analysis-cache"),
      onProgress: async (completedSentenceIds) => {
        manifest.completedSentenceIds = [...completedSentenceIds];
        manifest.updatedAt = now().toISOString();
        await writeAnalysisManifest(prepared.outputDirectory, manifest);
      },
    });
    let grammarIndex = 0;
    const reportSentences: GrammarReport["sentences"] = prepared.sentences.map(
      (sentence) => {
        const analysis = analyzed.analyses.get(sentence.id);
        if (analysis === undefined) {
          throw new AppError(`Missing completed analysis for ${sentence.id}.`, {
            code: "ANALYSIS_FAILED",
          });
        }
        return {
          ...sentence,
          reading: analysis.reading,
          translation: analysis.translation,
          grammar: analysis.grammar.map((grammar) => ({
            id: `grammar-${String(++grammarIndex).padStart(4, "0")}`,
            ...grammar,
          })),
          vocabulary: analysis.vocabulary,
        };
      },
    );
    const report = grammarReportSchema.parse({
      schemaVersion: "1.0.0",
      reportType: "multilingual-grammar-report",
      explanationLanguage,
      languages: [
        ...new Set(reportSentences.flatMap((sentence) => sentence.languages)),
      ],
      source: { type: prepared.sourceType, title: prepared.title },
      analysis: {
        model: options.analyzer.model,
        modelConfigurationHash: options.analyzer.configurationHash,
        analyzerVersion: ANALYZER_VERSION,
        generatedAt: now().toISOString(),
      },
      summary: summarize(reportSentences),
      sentences: reportSentences,
    });
    assertLevelAssignments(report);
    const schemaPath = fileURLToPath(
      new URL("../../../schemas/grammar-report.schema.json", import.meta.url),
    );
    const schema = JSON.parse(await readFile(schemaPath, "utf8")) as object;
    assertJsonSchema(compileJsonSchema(schema), report);
    const reportJsonPath = path.join(
      prepared.outputDirectory,
      "grammar-report.json",
    );
    const reportMarkdownPath = path.join(
      prepared.outputDirectory,
      "grammar-report.md",
    );
    await Promise.all([
      writeReplaceableJson(reportJsonPath, report, overwrite),
      atomicWriteFile(reportMarkdownPath, formatGrammarReportMarkdown(report), {
        overwrite: overwrite || (await pathExists(reportMarkdownPath)),
      }),
    ]);
    manifest.status = "completed";
    manifest.completedSentenceIds = prepared.sentences.map(
      (sentence) => sentence.id,
    );
    manifest.failedSentenceIds = [];
    manifest.updatedAt = now().toISOString();
    await writeAnalysisManifest(prepared.outputDirectory, manifest);
    options.logger.log("info", "Grammar report completed.", {
      sentenceCount: report.summary.sentenceCount,
      grammarPointCount: report.summary.grammarPointCount,
    });
    return {
      outputDirectory: prepared.outputDirectory,
      report,
      reportJsonPath,
      reportMarkdownPath,
      cacheHits: analyzed.cacheHits,
      analyzedSentences: analyzed.analyzed,
    };
  } catch (error) {
    manifest.status = "failed";
    manifest.failedSentenceIds = prepared.sentences
      .map((sentence) => sentence.id)
      .filter((id) => !manifest.completedSentenceIds.includes(id));
    manifest.updatedAt = now().toISOString();
    await writeAnalysisManifest(prepared.outputDirectory, manifest);
    throw error;
  }
}

export async function generateGrammarReport(
  options: GrammarReportOptions,
): Promise<GrammarReportResult> {
  const prepared = await prepareGrammarReportArtifacts(options);
  return finalizePreparedGrammarReport(prepared, options);
}
