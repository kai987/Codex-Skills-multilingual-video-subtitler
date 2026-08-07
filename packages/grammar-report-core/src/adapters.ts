import { createHash } from "node:crypto";

import { AppError, InputError } from "@mvl/shared";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";

import {
  analysisBatchSchema,
  sentenceAnalysisSchema,
} from "./analysis-schema.js";
import { GRAMMAR_PROMPT_VERSION, grammarSystemPrompt } from "./prompts.js";
import {
  SudachiJapaneseReadingEnricher,
  type JapaneseReadingEnricher,
} from "./readings.js";
import type {
  AnalysisProvider,
  ExplanationLanguage,
  GrammarAnalyzer,
  ReconstructedSentence,
  SentenceAnalysis,
} from "./types.js";

function hashConfiguration(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function localizedExplanation(language: ExplanationLanguage): string {
  if (language === "ja-JP") {
    return "この文で学習価値の高い構文と語用上の働きを説明します。";
  }
  if (language === "en") {
    return "Explains the most useful structure and its pragmatic role in this sentence.";
  }
  return "说明该句中最有学习价值的结构及其语用作用。";
}

function localizedExample(
  key:
    | "ja-conditional"
    | "ja-invitation"
    | "ja-polite"
    | "zh-completed"
    | "zh-attributive"
    | "en-will"
    | "en-basic",
  explanationLanguage: ExplanationLanguage,
) {
  const examples = {
    "ja-conditional": {
      text: "時間があるなら、一緒に行きましょう。",
      translations: {
        "zh-CN": "如果有时间，就一起去吧。",
        "ja-JP": "時間がある場合は、一緒に行こうという意味です。",
        en: "If you have time, let's go together.",
      },
    },
    "ja-invitation": {
      text: "少し休みましょう。",
      translations: {
        "zh-CN": "我们稍微休息一下吧。",
        "ja-JP": "少し休もうと誘っています。",
        en: "Let's take a short break.",
      },
    },
    "ja-polite": {
      text: "これは新しい資料です。",
      translations: {
        "zh-CN": "这是新资料。",
        "ja-JP": "これは新しい資料だと丁寧に述べています。",
        en: "This is a new document.",
      },
    },
    "zh-completed": {
      text: "我已经看完了。",
      translations: {
        "zh-CN": "我已经看完了。",
        "ja-JP": "私はもう読み終えました。",
        en: "I have already finished reading it.",
      },
    },
    "zh-attributive": {
      text: "这是我昨天买的书。",
      translations: {
        "zh-CN": "这是我昨天买的书。",
        "ja-JP": "これは私が昨日買った本です。",
        en: "This is the book I bought yesterday.",
      },
    },
    "en-will": {
      text: "I will call you tomorrow.",
      translations: {
        "zh-CN": "我明天会给你打电话。",
        "ja-JP": "明日あなたに電話します。",
        en: "The speaker intends to call the listener tomorrow.",
      },
    },
    "en-basic": {
      text: "The team finished the project.",
      translations: {
        "zh-CN": "团队完成了这个项目。",
        "ja-JP": "チームはそのプロジェクトを完了しました。",
        en: "The team completed the project.",
      },
    },
  } as const;
  const example = examples[key];
  return {
    text: example.text,
    reading: null,
    translation: example.translations[explanationLanguage],
  };
}

function pointFor(
  sentence: ReconstructedSentence,
  explanationLanguage: ExplanationLanguage,
) {
  const text = sentence.text;
  const explanation = localizedExplanation(explanationLanguage);
  if (sentence.languages.includes("ja")) {
    const surface = text.includes("なら")
      ? "なら"
      : text.includes("ましょう")
        ? "ましょう"
        : "です／ます";
    return {
      language: "ja" as const,
      surface,
      pattern:
        surface === "なら"
          ? "名詞・普通形＋なら"
          : surface === "ましょう"
            ? "動詞ます形＋ましょう"
            : "名詞・形容詞＋です／動詞ます形",
      category:
        surface === "なら"
          ? "conditional"
          : surface === "ましょう"
            ? "invitation"
            : "politeness",
      formation: surface,
      meaning:
        surface === "なら"
          ? "if / as for"
          : surface === "ましょう"
            ? "let's"
            : "polite statement",
      explanation,
      nuance: null,
      context: null,
      examples: [
        localizedExample(
          surface === "なら"
            ? "ja-conditional"
            : surface === "ましょう"
              ? "ja-invitation"
              : "ja-polite",
          explanationLanguage,
        ),
      ],
      levelSystem: "JLPT" as const,
      level: surface === "なら" ? "N3" : "N5",
      confidence: 0.82,
    };
  }
  if (sentence.languages.some((language) => language.startsWith("zh"))) {
    const surface = text.includes("了") ? "了" : "的";
    return {
      language:
        sentence.languages.find((language) => language.startsWith("zh")) ??
        "zh",
      surface,
      pattern: surface === "了" ? "动词＋了" : "修饰语＋的＋名词",
      category: surface === "了" ? "aspect" : "attributive",
      formation: surface === "了" ? "动词＋了" : "短语＋的＋名词",
      meaning:
        surface === "了"
          ? "completed action or changed state"
          : "attributive modification",
      explanation,
      nuance: null,
      context: null,
      examples: [
        localizedExample(
          surface === "了" ? "zh-completed" : "zh-attributive",
          explanationLanguage,
        ),
      ],
      levelSystem: "HSK" as const,
      level: "2",
      confidence: 0.8,
    };
  }
  const usesWill = /\bwill\b/iu.test(text);
  return {
    language: "en" as const,
    surface: usesWill ? "will" : "basic clause",
    pattern: usesWill
      ? "subject + will + base verb"
      : "subject + verb (+ object)",
    category: usesWill ? "future/modal" : "sentence structure",
    formation: usesWill ? "will + base verb" : "subject + predicate",
    meaning: usesWill ? "future prediction or intention" : "basic proposition",
    explanation,
    nuance: null,
    context: null,
    examples: [
      localizedExample(usesWill ? "en-will" : "en-basic", explanationLanguage),
    ],
    levelSystem: "CEFR" as const,
    level: usesWill ? "A2" : "A1",
    confidence: 0.78,
  };
}

export class MockGrammarAnalyzer implements GrammarAnalyzer {
  readonly provider = "mock" as const;
  readonly id = "mock";
  readonly model = "deterministic-test-analyzer";
  readonly configurationDetails = {
    adapter: "deterministic-test-adapter",
    testOnly: true,
  } as const;
  readonly configurationHash = hashConfiguration({
    provider: this.provider,
    model: this.model,
    rules: 1,
  });
  calls = 0;

  analyze(
    sentences: readonly ReconstructedSentence[],
    explanationLanguage: ExplanationLanguage,
  ): Promise<readonly SentenceAnalysis[]> {
    this.calls += 1;
    return Promise.resolve(
      sentences.map((sentence) =>
        sentenceAnalysisSchema.parse({
          sentenceId: sentence.id,
          reading: null,
          translation: null,
          grammar: sentence.languages
            .filter((language) => language !== "und" && language !== "mixed")
            .map((language) =>
              pointFor(
                { ...sentence, language, languages: [language] },
                explanationLanguage,
              ),
            ),
          vocabulary: [],
        }),
      ),
    );
  }
}

export class OpenAIGrammarAnalyzer implements GrammarAnalyzer {
  readonly provider = "openai" as const;
  readonly id = "openai-responses";
  readonly model: string;
  readonly configurationHash: string;
  readonly configurationDetails: Readonly<Record<string, unknown>>;
  readonly #client: OpenAI;
  readonly #readingEnricher: JapaneseReadingEnricher | null;

  constructor(
    options: {
      apiKey?: string;
      model?: string;
      readingEnricher?: JapaneseReadingEnricher | null;
    } = {},
  ) {
    const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
    if (apiKey === undefined || apiKey.trim() === "") {
      throw new AppError(
        "OPENAI_API_KEY is required for explicitly selected OpenAI grammar analysis.",
        {
          code: "MISSING_OPENAI_API_KEY",
          exitCode: 2,
          details: { environmentVariable: "OPENAI_API_KEY" },
        },
      );
    }
    this.model =
      options.model ?? process.env.OPENAI_GRAMMAR_MODEL ?? "gpt-5.6-sol";
    this.#readingEnricher =
      options.readingEnricher === undefined
        ? new SudachiJapaneseReadingEnricher()
        : options.readingEnricher;
    this.configurationDetails = {
      adapter: "openai-responses-structured-output-v2",
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
      adapter: "openai-responses-structured-output-v2",
      promptVersion: GRAMMAR_PROMPT_VERSION,
      schema: "analysis-batch-v1",
      readingEnricher:
        this.#readingEnricher === null
          ? null
          : {
              id: this.#readingEnricher.id,
              configurationHash: this.#readingEnricher.configurationHash,
            },
    });
    this.#client = new OpenAI({ apiKey });
  }

  async analyze(
    sentences: readonly ReconstructedSentence[],
    explanationLanguage: ExplanationLanguage,
  ): Promise<readonly SentenceAnalysis[]> {
    const response = await this.#client.responses.parse({
      model: this.model,
      input: [
        {
          role: "system",
          content: grammarSystemPrompt(explanationLanguage),
        },
        {
          role: "user",
          content: JSON.stringify({
            outcome:
              "Produce concise grammar, vocabulary, reading, and translation annotations for every supplied sentence.",
            explanationLanguage,
            sentences,
          }),
        },
      ],
      text: {
        format: zodTextFormat(analysisBatchSchema, "grammar_analysis_batch"),
      },
    });
    if (response.output_parsed === null) {
      throw new InputError(
        "OpenAI grammar analysis returned no structured output.",
        { responseId: response.id },
      );
    }
    const parsed = analysisBatchSchema.parse(response.output_parsed).sentences;
    return this.#readingEnricher === null
      ? parsed
      : this.#readingEnricher.enrich(sentences, parsed);
  }
}

export function createGrammarAnalyzer(input: {
  provider: AnalysisProvider;
  model?: string;
  apiKey?: string;
  readingEnricher?: JapaneseReadingEnricher | null;
}): GrammarAnalyzer {
  if (input.provider === "mock") return new MockGrammarAnalyzer();
  if (input.provider === "openai") {
    return new OpenAIGrammarAnalyzer({
      ...(input.model === undefined ? {} : { model: input.model }),
      ...(input.apiKey === undefined ? {} : { apiKey: input.apiKey }),
      ...(input.readingEnricher === undefined
        ? {}
        : { readingEnricher: input.readingEnricher }),
    });
  }
  throw new AppError(
    "The plain Node CLI cannot call the current Codex/ChatGPT Work host model. Prepare a host handoff inside $multilingual-grammar-report-generator, or explicitly select --analysis-provider openai.",
    {
      code: "HOST_CONTEXT_REQUIRED",
      exitCode: 2,
      details: {
        workflow:
          "Run --analysis-provider host --prepare-host, let the current Host model write host-analysis-response.json, then run --finalize-host.",
      },
    },
  );
}
