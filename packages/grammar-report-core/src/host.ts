import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AppError,
  MemoryLogger,
  assertJsonSchema,
  atomicWriteJson,
  compileJsonSchema,
  pathExists,
  readJson,
  type Logger,
} from "@mvl/shared";
import { z } from "zod";

import {
  cacheSentenceAnalyses,
  loadCachedSentenceAnalyses,
} from "./analyze.js";
import {
  analysisBatchSchema,
  sentenceAnalysisSchema,
} from "./analysis-schema.js";
import { GRAMMAR_PROMPT_VERSION, hostCoreInstructions } from "./prompts.js";
import {
  SudachiJapaneseReadingEnricher,
  type JapaneseReadingEnricher,
} from "./readings.js";
import type {
  ExplanationLanguage,
  GrammarAnalyzer,
  GrammarReportResult,
  ReconstructedSentence,
  SentenceAnalysis,
} from "./types.js";
import {
  createAnalysisManifest,
  finalizePreparedGrammarReport,
  loadPreparedGrammarReport,
  prepareGrammarReportArtifacts,
  writeAnalysisManifest,
  type AnalysisManifest,
  type GrammarPreparationOptions,
  type PreparedGrammarReport,
} from "./workflow.js";

const HOST_HANDOFF_VERSION = "1.0.0";
const DEFAULT_HOST_MODEL = "current-host-model";

function hashConfiguration(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

const hostRequestSentenceSchema = z
  .object({
    id: z.string().min(1),
    text: z.string().min(1),
    language: z.string().min(1),
    languages: z.array(z.string().min(1)).min(1),
    previousText: z.string().min(1).nullable(),
    nextText: z.string().min(1).nullable(),
    cueIds: z.array(z.string().min(1)),
    start: z.number().nonnegative().nullable(),
    end: z.number().positive().nullable(),
    speakers: z.array(z.string().min(1)),
  })
  .strict();

export const hostAnalysisRequestSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    requestType: z.literal("grammar-host-analysis"),
    analysisProvider: z.literal("host"),
    model: z.string().min(1),
    explanationLanguage: z.enum(["zh-CN", "ja-JP", "en"]),
    promptVersion: z.string().min(1),
    handoffVersion: z.string().min(1),
    configurationHash: z.string().min(1),
    attempt: z.number().int().positive(),
    instructions: z.array(z.string().min(1)).min(1),
    resources: z
      .object({
        responseSchema: z.string().min(1),
        reportSchema: z.string().min(1),
        reportContract: z.string().min(1),
        hostAnalysisRules: z.string().min(1),
      })
      .strict(),
    sentences: z.array(hostRequestSentenceSchema),
  })
  .strict();

export type HostAnalysisRequest = z.infer<typeof hostAnalysisRequestSchema>;

const hostResponseEnvelopeSchema = z
  .object({ sentences: z.array(z.unknown()) })
  .strict();

const validationIssueSchema = z
  .object({
    sentenceId: z.string().min(1).nullable(),
    code: z.string().min(1),
    message: z.string().min(1),
    path: z.string(),
  })
  .strict();

const hostValidationRecordSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    status: z.enum(["failed", "resolved"]),
    attempt: z.number().int().positive(),
    failedSentenceIds: z.array(z.string().min(1)),
    issues: z.array(validationIssueSchema),
    responsePath: z.string().min(1),
    resume: z
      .object({
        requestPath: z.string().min(1),
        responsePath: z.string().min(1),
      })
      .strict(),
  })
  .strict();

type HostValidationIssue = z.infer<typeof validationIssueSchema>;

export class HostResponseGrammarAnalyzer implements GrammarAnalyzer {
  readonly provider = "host" as const;
  readonly id = "host-handoff";
  readonly model: string;
  readonly configurationHash: string;
  readonly configurationDetails: Readonly<Record<string, unknown>>;
  readonly #analysesById: ReadonlyMap<string, SentenceAnalysis>;
  readonly #readingEnricher: JapaneseReadingEnricher | null;

  constructor(
    options: {
      model?: string;
      analyses?: readonly SentenceAnalysis[];
      readingEnricher?: JapaneseReadingEnricher | null;
    } = {},
  ) {
    this.model = options.model ?? DEFAULT_HOST_MODEL;
    this.#analysesById = new Map(
      (options.analyses ?? []).map((analysis) => [
        analysis.sentenceId,
        analysis,
      ]),
    );
    this.#readingEnricher =
      options.readingEnricher === undefined
        ? new SudachiJapaneseReadingEnricher()
        : options.readingEnricher;
    this.configurationDetails = {
      adapter: "host-json-handoff-v1",
      promptVersion: GRAMMAR_PROMPT_VERSION,
      hostModelSelection: "current-host-model",
      externalModelCalls: false,
      readingEnricher:
        this.#readingEnricher === null
          ? null
          : {
              id: this.#readingEnricher.id,
              ...this.#readingEnricher.metadata,
            },
    };
    this.configurationHash = hashConfiguration({
      provider: this.provider,
      model: this.model,
      adapter: "host-json-handoff-v1",
      promptVersion: GRAMMAR_PROMPT_VERSION,
      handoffVersion: HOST_HANDOFF_VERSION,
      schema: "analysis-batch-v1",
      readingEnricher:
        this.#readingEnricher === null
          ? null
          : {
              id: this.#readingEnricher.id,
              configurationHash: this.#readingEnricher.configurationHash,
            },
    });
  }

  async analyze(
    sentences: readonly ReconstructedSentence[],
  ): Promise<readonly SentenceAnalysis[]> {
    const analyses = sentences.map((sentence) =>
      this.#analysesById.get(sentence.id),
    );
    const missing = sentences
      .filter((_sentence, index) => analyses[index] === undefined)
      .map((sentence) => sentence.id);
    if (missing.length > 0) {
      throw new AppError(
        "The host handoff response is missing required sentence analyses.",
        {
          code: "HOST_ANALYSIS_VALIDATION_FAILED",
          exitCode: 2,
          details: { sentenceIds: missing },
        },
      );
    }
    const parsed = analyses.map((analysis) =>
      sentenceAnalysisSchema.parse(analysis),
    );
    return this.#readingEnricher === null
      ? parsed
      : this.#readingEnricher.enrich(sentences, parsed);
  }
}

function repositoryRoot(): string {
  return fileURLToPath(new URL("../../../", import.meta.url));
}

function responseSchemaPath(outputDirectory: string): string {
  return path.join(outputDirectory, "host-analysis-schema.json");
}

function requestPath(outputDirectory: string): string {
  return path.join(outputDirectory, "host-analysis-request.json");
}

function canonicalResponsePath(outputDirectory: string): string {
  return path.join(outputDirectory, "host-analysis-response.json");
}

function validationPath(outputDirectory: string): string {
  return path.join(outputDirectory, "host-validation-errors.json");
}

function requestSentences(
  sentences: readonly ReconstructedSentence[],
  prepared: PreparedGrammarReport,
  previousRequest?: HostAnalysisRequest,
): HostAnalysisRequest["sentences"] {
  const sentencesById = new Map(
    prepared.sentences.map((sentence) => [sentence.id, sentence]),
  );
  const previousById = new Map(
    (previousRequest?.sentences ?? []).map((sentence) => [
      sentence.id,
      sentence,
    ]),
  );
  return sentences.map((sentence) => {
    const prior = previousById.get(sentence.id);
    return {
      id: sentence.id,
      text: sentence.text,
      language: sentence.language,
      languages: sentence.languages,
      previousText:
        sentence.previousSentenceId === null
          ? null
          : (sentencesById.get(sentence.previousSentenceId)?.text ?? null),
      nextText:
        sentence.nextSentenceId === null
          ? null
          : (sentencesById.get(sentence.nextSentenceId)?.text ?? null),
      cueIds: sentence.cueIds,
      start: sentence.start,
      end: sentence.end,
      speakers: [
        ...(prior?.speakers ??
          prepared.speakersBySentenceId.get(sentence.id) ??
          []),
      ],
    };
  });
}

function hostResources(outputDirectory: string) {
  const root = repositoryRoot();
  return {
    responseSchema: responseSchemaPath(outputDirectory),
    reportSchema: path.join(root, "schemas/grammar-report.schema.json"),
    reportContract: path.join(
      root,
      ".agents/skills/multilingual-grammar-report-generator/references/report-contract.md",
    ),
    hostAnalysisRules: path.join(
      root,
      ".agents/skills/multilingual-grammar-report-generator/references/host-analysis.md",
    ),
  };
}

function makeRequest(input: {
  prepared: PreparedGrammarReport;
  analyzer: HostResponseGrammarAnalyzer;
  explanationLanguage: ExplanationLanguage;
  pending: readonly ReconstructedSentence[];
  attempt: number;
  previousRequest?: HostAnalysisRequest;
}): HostAnalysisRequest {
  return hostAnalysisRequestSchema.parse({
    schemaVersion: "1.0.0",
    requestType: "grammar-host-analysis",
    analysisProvider: "host",
    model: input.analyzer.model,
    explanationLanguage: input.explanationLanguage,
    promptVersion: GRAMMAR_PROMPT_VERSION,
    handoffVersion: HOST_HANDOFF_VERSION,
    configurationHash: input.analyzer.configurationHash,
    attempt: input.attempt,
    instructions: hostCoreInstructions(input.explanationLanguage),
    resources: hostResources(input.prepared.outputDirectory),
    sentences: requestSentences(
      input.pending,
      input.prepared,
      input.previousRequest,
    ),
  });
}

export interface HostPreparationResult {
  outputDirectory: string;
  requestPath: string;
  responsePath: string;
  responseSchemaPath: string;
  pendingSentenceIds: string[];
  cacheHits: number;
}

export async function prepareHostGrammarAnalysis(
  options: GrammarPreparationOptions & {
    model?: string;
    readingEnricher?: JapaneseReadingEnricher | null;
  },
): Promise<HostPreparationResult> {
  const now = options.now ?? (() => new Date());
  const explanationLanguage = options.explanationLanguage ?? "zh-CN";
  const prepared = await prepareGrammarReportArtifacts(options);
  const analyzer = new HostResponseGrammarAnalyzer({
    ...(options.model === undefined ? {} : { model: options.model }),
    ...(options.readingEnricher === undefined
      ? {}
      : { readingEnricher: options.readingEnricher }),
  });
  const cached = await loadCachedSentenceAnalyses({
    sentences: prepared.sentences,
    analyzer,
    explanationLanguage,
    cacheDirectory: path.join(prepared.outputDirectory, "analysis-cache"),
  });
  const request = makeRequest({
    prepared,
    analyzer,
    explanationLanguage,
    pending: cached.misses,
    attempt: 1,
  });
  const schema = z.toJSONSchema(analysisBatchSchema, {
    target: "draft-2020-12",
    unrepresentable: "any",
  });
  await Promise.all([
    atomicWriteJson(responseSchemaPath(prepared.outputDirectory), schema, {
      overwrite: true,
    }),
    atomicWriteJson(requestPath(prepared.outputDirectory), request, {
      overwrite: true,
    }),
  ]);
  const manifest = createAnalysisManifest({
    prepared,
    analyzer,
    explanationLanguage,
    now,
    hostHandoff: {
      status: "awaiting-response",
      requestPath: path.basename(requestPath(prepared.outputDirectory)),
      responsePath: path.basename(
        canonicalResponsePath(prepared.outputDirectory),
      ),
      pendingSentenceIds: cached.misses.map((sentence) => sentence.id),
    },
  });
  manifest.completedSentenceIds = [...cached.analyses.keys()];
  await writeAnalysisManifest(prepared.outputDirectory, manifest);
  return {
    outputDirectory: prepared.outputDirectory,
    requestPath: requestPath(prepared.outputDirectory),
    responsePath: canonicalResponsePath(prepared.outputDirectory),
    responseSchemaPath: responseSchemaPath(prepared.outputDirectory),
    pendingSentenceIds: cached.misses.map((sentence) => sentence.id),
    cacheHits: cached.analyses.size,
  };
}

function languageMatches(
  analysisLanguage: string,
  sentenceLanguages: readonly string[],
): boolean {
  if (sentenceLanguages.includes(analysisLanguage)) return true;
  return (
    analysisLanguage.startsWith("zh") &&
    sentenceLanguages.some((language) => language.startsWith("zh"))
  );
}

function semanticIssues(
  analysis: SentenceAnalysis,
  sentence: ReconstructedSentence,
): HostValidationIssue[] {
  const issues: HostValidationIssue[] = [];
  for (const [index, grammar] of analysis.grammar.entries()) {
    if (!languageMatches(grammar.language, sentence.languages)) {
      issues.push({
        sentenceId: sentence.id,
        code: "UNSUPPORTED_GRAMMAR_LANGUAGE",
        message: `Grammar language ${grammar.language} is not present in the sentence.`,
        path: `sentences.${sentence.id}.grammar.${String(index)}.language`,
      });
    }
    const validSystem =
      grammar.levelSystem === "unknown" ||
      (grammar.language === "ja" && grammar.levelSystem === "JLPT") ||
      (grammar.language.startsWith("zh") && grammar.levelSystem === "HSK") ||
      (grammar.language === "en" && grammar.levelSystem === "CEFR");
    if (!validSystem) {
      issues.push({
        sentenceId: sentence.id,
        code: "INVALID_LEVEL_SYSTEM",
        message: `Invalid ${grammar.language}/${grammar.levelSystem} assignment.`,
        path: `sentences.${sentence.id}.grammar.${String(index)}.levelSystem`,
      });
    }
  }
  return issues;
}

function issueFromZod(
  issue: z.core.$ZodIssue,
  sentenceId: string | null,
): HostValidationIssue {
  return {
    sentenceId,
    code: "SCHEMA_VALIDATION_ERROR",
    message: issue.message,
    path: issue.path.map(String).join("."),
  };
}

async function readHostResponse(responseFile: string): Promise<unknown> {
  try {
    return await readJson(responseFile);
  } catch (error) {
    throw new AppError("Host analysis response is not valid JSON.", {
      code: "HOST_ANALYSIS_VALIDATION_FAILED",
      exitCode: 2,
      details: { responsePath: responseFile, cause: String(error) },
      cause: error,
    });
  }
}

function validateHostResponse(input: {
  value: unknown;
  request: HostAnalysisRequest;
  prepared: PreparedGrammarReport;
}): {
  valid: SentenceAnalysis[];
  issues: HostValidationIssue[];
} {
  const envelope = hostResponseEnvelopeSchema.safeParse(input.value);
  if (!envelope.success) {
    return {
      valid: [],
      issues: envelope.error.issues.map((issue) => issueFromZod(issue, null)),
    };
  }
  const expectedIds = new Set(
    input.request.sentences.map((sentence) => sentence.id),
  );
  const sentencesById = new Map(
    input.prepared.sentences.map((sentence) => [sentence.id, sentence]),
  );
  const returnedIds = new Set<string>();
  const valid: SentenceAnalysis[] = [];
  const issues: HostValidationIssue[] = [];
  for (const [index, value] of envelope.data.sentences.entries()) {
    const candidateId =
      typeof value === "object" &&
      value !== null &&
      "sentenceId" in value &&
      typeof value.sentenceId === "string"
        ? value.sentenceId
        : null;
    const parsed = sentenceAnalysisSchema.safeParse(value);
    if (!parsed.success) {
      issues.push(
        ...parsed.error.issues.map((issue) =>
          issueFromZod(
            { ...issue, path: ["sentences", index, ...issue.path] },
            candidateId,
          ),
        ),
      );
      continue;
    }
    const analysis = parsed.data;
    if (!expectedIds.has(analysis.sentenceId)) {
      issues.push({
        sentenceId: analysis.sentenceId,
        code: "UNREQUESTED_SENTENCE_ID",
        message: "The Host returned a sentence that was not requested.",
        path: `sentences.${String(index)}.sentenceId`,
      });
      continue;
    }
    if (returnedIds.has(analysis.sentenceId)) {
      issues.push({
        sentenceId: analysis.sentenceId,
        code: "DUPLICATE_SENTENCE_ID",
        message: "The Host returned the same sentence ID more than once.",
        path: `sentences.${String(index)}.sentenceId`,
      });
      continue;
    }
    returnedIds.add(analysis.sentenceId);
    const sentence = sentencesById.get(analysis.sentenceId);
    if (sentence === undefined) continue;
    const sentenceIssues = semanticIssues(analysis, sentence);
    if (sentenceIssues.length > 0) {
      issues.push(...sentenceIssues);
      continue;
    }
    valid.push(analysis);
  }
  for (const expectedId of expectedIds) {
    if (!valid.some((analysis) => analysis.sentenceId === expectedId)) {
      issues.push({
        sentenceId: expectedId,
        code: "MISSING_SENTENCE_RESULT",
        message: "No valid Host analysis was returned for this sentence.",
        path: "sentences",
      });
    }
  }
  return { valid, issues };
}

export interface FinalizeHostGrammarAnalysisOptions {
  outputDirectory: string;
  hostResponsePath?: string;
  logger?: Logger;
  readingEnricher?: JapaneseReadingEnricher | null;
  batchSize?: number;
  maxHostAttempts?: number;
  overwrite?: boolean;
  now?: () => Date;
}

export interface FinalizeHostGrammarAnalysisResult extends GrammarReportResult {
  requestPath: string;
  responsePath: string;
}

export async function finalizeHostGrammarAnalysis(
  options: FinalizeHostGrammarAnalysisOptions,
): Promise<FinalizeHostGrammarAnalysisResult> {
  const now = options.now ?? (() => new Date());
  const logger = options.logger ?? new MemoryLogger();
  const maxHostAttempts = options.maxHostAttempts ?? 3;
  if (!Number.isSafeInteger(maxHostAttempts) || maxHostAttempts < 1) {
    throw new AppError("maxHostAttempts must be a positive integer.", {
      code: "INVALID_INPUT",
      exitCode: 2,
    });
  }
  const prepared = await loadPreparedGrammarReport(options.outputDirectory);
  const parsedRequest = hostAnalysisRequestSchema.parse(
    await readJson(requestPath(prepared.outputDirectory)),
  );
  const analyzer = new HostResponseGrammarAnalyzer({
    model: parsedRequest.model,
    ...(options.readingEnricher === undefined
      ? {}
      : { readingEnricher: options.readingEnricher }),
  });
  if (parsedRequest.configurationHash !== analyzer.configurationHash) {
    throw new AppError(
      "The Host handoff configuration changed after preparation. Prepare the Host request again before finalizing.",
      {
        code: "HOST_ANALYSIS_VALIDATION_FAILED",
        exitCode: 2,
        details: {
          preparedConfigurationHash: parsedRequest.configurationHash,
          currentConfigurationHash: analyzer.configurationHash,
        },
      },
    );
  }
  const responseFile = path.resolve(
    options.hostResponsePath ?? canonicalResponsePath(prepared.outputDirectory),
  );
  let responseValue: unknown;
  try {
    responseValue = await readHostResponse(responseFile);
  } catch (error) {
    const cached = await loadCachedSentenceAnalyses({
      sentences: prepared.sentences,
      analyzer,
      explanationLanguage: parsedRequest.explanationLanguage,
      cacheDirectory: path.join(prepared.outputDirectory, "analysis-cache"),
    });
    const retryAllowed = parsedRequest.attempt < maxHostAttempts;
    const retryRequest = retryAllowed
      ? makeRequest({
          prepared,
          analyzer,
          explanationLanguage: parsedRequest.explanationLanguage,
          pending: cached.misses,
          attempt: parsedRequest.attempt + 1,
          previousRequest: parsedRequest,
        })
      : parsedRequest;
    await Promise.all([
      atomicWriteJson(requestPath(prepared.outputDirectory), retryRequest, {
        overwrite: true,
      }),
      atomicWriteJson(
        validationPath(prepared.outputDirectory),
        hostValidationRecordSchema.parse({
          schemaVersion: "1.0.0",
          status: "failed",
          attempt: parsedRequest.attempt,
          failedSentenceIds: cached.misses.map((sentence) => sentence.id),
          issues: [
            {
              sentenceId: null,
              code: "INVALID_JSON",
              message: "Host analysis response is not valid JSON.",
              path: "",
            },
          ],
          responsePath: responseFile,
          resume: {
            requestPath: requestPath(prepared.outputDirectory),
            responsePath: canonicalResponsePath(prepared.outputDirectory),
          },
        }),
        { overwrite: true },
      ),
    ]);
    const manifest = createAnalysisManifest({
      prepared,
      analyzer,
      explanationLanguage: parsedRequest.explanationLanguage,
      now,
      hostHandoff: {
        status: retryAllowed ? "awaiting-retry" : "retry-exhausted",
        attempt: retryRequest.attempt,
        maxHostAttempts,
        requestPath: path.basename(requestPath(prepared.outputDirectory)),
        responsePath: path.basename(
          canonicalResponsePath(prepared.outputDirectory),
        ),
        validationErrorsPath: path.basename(
          validationPath(prepared.outputDirectory),
        ),
      },
    });
    manifest.status = "failed";
    manifest.completedSentenceIds = [...cached.analyses.keys()];
    manifest.failedSentenceIds = cached.misses.map((sentence) => sentence.id);
    await writeAnalysisManifest(prepared.outputDirectory, manifest);
    throw error;
  }
  await atomicWriteJson(
    canonicalResponsePath(prepared.outputDirectory),
    responseValue,
    { overwrite: true },
  );
  const validated = validateHostResponse({
    value: responseValue,
    request: parsedRequest,
    prepared,
  });
  const validSentencesById = new Map(
    prepared.sentences.map((sentence) => [sentence.id, sentence]),
  );
  const validSentences = validated.valid.map((analysis) => {
    const sentence = validSentencesById.get(analysis.sentenceId);
    if (sentence === undefined) {
      throw new AppError(
        `Unknown Host response sentence ID: ${analysis.sentenceId}`,
        { code: "HOST_ANALYSIS_VALIDATION_FAILED" },
      );
    }
    return sentence;
  });
  if (validated.valid.length > 0) {
    const enriched = await new HostResponseGrammarAnalyzer({
      model: parsedRequest.model,
      analyses: validated.valid,
      ...(options.readingEnricher === undefined
        ? {}
        : { readingEnricher: options.readingEnricher }),
    }).analyze(validSentences);
    await cacheSentenceAnalyses({
      sentences: prepared.sentences,
      analyses: enriched,
      analyzer,
      explanationLanguage: parsedRequest.explanationLanguage,
      cacheDirectory: path.join(prepared.outputDirectory, "analysis-cache"),
    });
  }
  const cached = await loadCachedSentenceAnalyses({
    sentences: prepared.sentences,
    analyzer,
    explanationLanguage: parsedRequest.explanationLanguage,
    cacheDirectory: path.join(prepared.outputDirectory, "analysis-cache"),
  });

  if (validated.issues.length === 0) {
    const completeResponse = analysisBatchSchema.parse(responseValue);
    const responseSchema = z.toJSONSchema(analysisBatchSchema, {
      target: "draft-2020-12",
      unrepresentable: "any",
    });
    assertJsonSchema(compileJsonSchema(responseSchema), completeResponse);
  }

  if (validated.issues.length > 0 || cached.misses.length > 0) {
    const retryAllowed = parsedRequest.attempt < maxHostAttempts;
    const retryRequest = retryAllowed
      ? makeRequest({
          prepared,
          analyzer,
          explanationLanguage: parsedRequest.explanationLanguage,
          pending: cached.misses,
          attempt: parsedRequest.attempt + 1,
          previousRequest: parsedRequest,
        })
      : parsedRequest;
    await atomicWriteJson(requestPath(prepared.outputDirectory), retryRequest, {
      overwrite: true,
    });
    const validationRecord = hostValidationRecordSchema.parse({
      schemaVersion: "1.0.0",
      status: "failed",
      attempt: parsedRequest.attempt,
      failedSentenceIds: cached.misses.map((sentence) => sentence.id),
      issues: validated.issues,
      responsePath: responseFile,
      resume: {
        requestPath: requestPath(prepared.outputDirectory),
        responsePath: canonicalResponsePath(prepared.outputDirectory),
      },
    });
    await atomicWriteJson(
      validationPath(prepared.outputDirectory),
      validationRecord,
      { overwrite: true },
    );
    const manifest = createAnalysisManifest({
      prepared,
      analyzer,
      explanationLanguage: parsedRequest.explanationLanguage,
      now,
      hostHandoff: {
        status: retryAllowed ? "awaiting-retry" : "retry-exhausted",
        attempt: retryRequest.attempt,
        maxHostAttempts,
        requestPath: path.basename(requestPath(prepared.outputDirectory)),
        responsePath: path.basename(
          canonicalResponsePath(prepared.outputDirectory),
        ),
        validationErrorsPath: path.basename(
          validationPath(prepared.outputDirectory),
        ),
      },
    });
    manifest.status = "failed";
    manifest.completedSentenceIds = [...cached.analyses.keys()];
    manifest.failedSentenceIds = cached.misses.map((sentence) => sentence.id);
    await writeAnalysisManifest(prepared.outputDirectory, manifest);
    throw new AppError(
      retryAllowed
        ? "Host analysis response failed validation. Only failed or missing sentences were written to the retry request."
        : "Host analysis response failed validation and exhausted the configured Host attempts.",
      {
        code: "HOST_ANALYSIS_VALIDATION_FAILED",
        exitCode: 2,
        details: {
          failedSentenceIds: manifest.failedSentenceIds,
          requestPath: requestPath(prepared.outputDirectory),
          responsePath: canonicalResponsePath(prepared.outputDirectory),
          validationErrorsPath: validationPath(prepared.outputDirectory),
          retryAllowed,
          attempt: parsedRequest.attempt,
          maxHostAttempts,
        },
      },
    );
  }

  const result = await finalizePreparedGrammarReport(prepared, {
    analyzer,
    logger,
    explanationLanguage: parsedRequest.explanationLanguage,
    batchSize: options.batchSize ?? 8,
    maxRetries: 0,
    overwrite: options.overwrite ?? true,
    now,
  });
  const manifestValue = (await readJson(
    path.join(prepared.outputDirectory, "analysis-manifest.json"),
  )) as AnalysisManifest;
  manifestValue.hostHandoff = {
    status: "completed",
    requestPath: path.basename(requestPath(prepared.outputDirectory)),
    responsePath: path.basename(
      canonicalResponsePath(prepared.outputDirectory),
    ),
  };
  await writeAnalysisManifest(prepared.outputDirectory, manifestValue);
  if (await pathExists(validationPath(prepared.outputDirectory))) {
    await atomicWriteJson(
      validationPath(prepared.outputDirectory),
      hostValidationRecordSchema.parse({
        schemaVersion: "1.0.0",
        status: "resolved",
        attempt: parsedRequest.attempt,
        failedSentenceIds: [],
        issues: [],
        responsePath: responseFile,
        resume: {
          requestPath: requestPath(prepared.outputDirectory),
          responsePath: canonicalResponsePath(prepared.outputDirectory),
        },
      }),
      { overwrite: true },
    );
  }
  return {
    ...result,
    requestPath: requestPath(prepared.outputDirectory),
    responsePath: canonicalResponsePath(prepared.outputDirectory),
  };
}
