import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { InputError, UserActionRequiredError } from "@mvl/shared";
import { z } from "zod";

import { sentenceAnalysisSchema } from "./analysis-schema.js";
import type { ReconstructedSentence, SentenceAnalysis } from "./types.js";

const SUDACHI_HELPER_VERSION = "1.0.0";
const SUDACHI_PY_VERSION = "0.6.11";
const SUDACHI_DICTIONARY_VERSION = "20260428";
const SUDACHI_DICTIONARY = "core";
const SUDACHI_SPLIT_MODE = "C";
const SUDACHI_OUTPUT_SCRIPT = "hiragana";
const DEFAULT_SUDACHI_TIMEOUT_MS = 30_000;
const MAX_HELPER_OUTPUT_BYTES = 10 * 1024 * 1024;
type SudachiBatchRunner = (request: unknown) => Promise<unknown>;

const readingResponseSchema = z
  .object({
    engine: z
      .object({
        helperVersion: z.literal(SUDACHI_HELPER_VERSION),
        sudachiPyVersion: z.literal(SUDACHI_PY_VERSION),
        dictionaryVersion: z.literal(SUDACHI_DICTIONARY_VERSION),
        dictionary: z.literal(SUDACHI_DICTIONARY),
        splitMode: z.literal(SUDACHI_SPLIT_MODE),
        outputScript: z.literal(SUDACHI_OUTPUT_SCRIPT),
      })
      .strict(),
    items: z.array(
      z
        .object({
          id: z.string().min(1),
          reading: z.string().min(1).nullable(),
          unresolvedOov: z.array(z.string().min(1)),
          morphemes: z
            .array(
              z
                .object({
                  surface: z.string().min(1),
                  normalizedSurface: z.string().min(1),
                  dictionaryForm: z.string().min(1),
                  reading: z.string().min(1).nullable(),
                  partOfSpeech: z.array(z.string()).min(1),
                  isOov: z.boolean(),
                  startCharacter: z.number().int().nonnegative(),
                  endCharacter: z.number().int().positive(),
                })
                .strict(),
            )
            .optional(),
        })
        .strict(),
    ),
  })
  .strict();

export interface JapaneseReadingEnricher {
  readonly id: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly configurationHash: string;
  enrich(
    sentences: readonly ReconstructedSentence[],
    analyses: readonly SentenceAnalysis[],
  ): Promise<readonly SentenceAnalysis[]>;
}

function hashConfiguration(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function repositoryRoot(): string {
  return fileURLToPath(new URL("../../../", import.meta.url));
}

function defaultPythonExecutable(): string {
  return path.join(
    repositoryRoot(),
    ".venv-sudachi",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
}

function defaultHelperPath(): string {
  return path.join(repositoryRoot(), "scripts/sudachi-readings.py");
}

function runSudachiBatch(input: {
  pythonExecutable: string;
  helperPath: string;
  timeoutMs: number;
  request: unknown;
}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.pythonExecutable, [input.helperPath], {
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      action();
    };
    const fail = (error: unknown): void => {
      finish(() =>
        reject(error instanceof Error ? error : new Error(String(error))),
      );
    };
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      fail(
        new InputError("SudachiPy reading analysis timed out.", {
          timeoutMs: input.timeoutMs,
        }),
      );
    }, input.timeoutMs);

    child.on("error", (error) => {
      fail(
        new UserActionRequiredError(
          "SudachiPy is unavailable. Run the grammar-report skill wrapper to install the pinned local reading environment.",
          {
            pythonExecutable: input.pythonExecutable,
            cause: String(error),
          },
        ),
      );
    });
    child.stdin.on("error", fail);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout, "utf8") > MAX_HELPER_OUTPUT_BYTES) {
        child.kill("SIGKILL");
        fail(new InputError("SudachiPy returned an oversized response."));
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      if (Buffer.byteLength(stderr, "utf8") > MAX_HELPER_OUTPUT_BYTES) {
        child.kill("SIGKILL");
        fail(new InputError("SudachiPy returned oversized error output."));
      }
    });
    child.on("close", (code) => {
      if (code !== 0) {
        fail(
          new UserActionRequiredError(
            "SudachiPy reading analysis failed. Reinstall the pinned local reading environment.",
            {
              pythonExecutable: input.pythonExecutable,
              helperPath: input.helperPath,
              exitCode: code,
              stderr: stderr.slice(-2_000),
            },
          ),
        );
        return;
      }
      finish(() => {
        try {
          resolve(JSON.parse(stdout) as unknown);
        } catch (error) {
          reject(
            new InputError("SudachiPy returned invalid JSON.", {
              cause: String(error),
              stdout: stdout.slice(-2_000),
            }),
          );
        }
      });
    });

    child.stdin.end(JSON.stringify(input.request));
  });
}

export class SudachiJapaneseReadingEnricher implements JapaneseReadingEnricher {
  readonly id = "sudachipy-core";
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly configurationHash: string;
  readonly #pythonExecutable: string;
  readonly #helperPath: string;
  readonly #timeoutMs: number;
  readonly #batchRunner: SudachiBatchRunner;

  constructor(
    options: {
      pythonExecutable?: string;
      helperPath?: string;
      timeoutMs?: number;
      batchRunner?: SudachiBatchRunner;
      batchRunnerConfigurationHash?: string;
    } = {},
  ) {
    if (
      options.batchRunner !== undefined &&
      (options.batchRunnerConfigurationHash === undefined ||
        options.batchRunnerConfigurationHash.trim() === "")
    ) {
      throw new InputError(
        "A custom Sudachi batch runner requires a configuration hash.",
      );
    }
    const configuredPython = process.env.SUDACHI_PYTHON?.trim();
    this.#pythonExecutable =
      options.pythonExecutable ??
      (configuredPython === undefined || configuredPython === ""
        ? defaultPythonExecutable()
        : configuredPython);
    this.#helperPath = options.helperPath ?? defaultHelperPath();
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_SUDACHI_TIMEOUT_MS;
    this.#batchRunner =
      options.batchRunner ??
      ((request) =>
        runSudachiBatch({
          pythonExecutable: this.#pythonExecutable,
          helperPath: this.#helperPath,
          timeoutMs: this.#timeoutMs,
          request,
        }));
    this.metadata = {
      adapter: this.id,
      helperVersion: SUDACHI_HELPER_VERSION,
      sudachiPyVersion: SUDACHI_PY_VERSION,
      dictionaryVersion: SUDACHI_DICTIONARY_VERSION,
      dictionary: SUDACHI_DICTIONARY,
      splitMode: SUDACHI_SPLIT_MODE,
      outputScript: SUDACHI_OUTPUT_SCRIPT,
      oovPolicy: "null-on-unresolved-substantive-oov-v1",
      ...(options.batchRunnerConfigurationHash === undefined
        ? {}
        : {
            batchRunnerConfigurationHash: options.batchRunnerConfigurationHash,
          }),
    };
    this.configurationHash = hashConfiguration(this.metadata);
  }

  async enrich(
    sentences: readonly ReconstructedSentence[],
    analyses: readonly SentenceAnalysis[],
  ): Promise<readonly SentenceAnalysis[]> {
    const sentencesById = new Map(
      sentences.map((sentence) => [sentence.id, sentence]),
    );
    const items: { id: string; text: string }[] = [];

    for (const analysis of analyses) {
      const sentence = sentencesById.get(analysis.sentenceId);
      if (
        sentence?.language === "ja" &&
        sentence.languages.every((language) => language === "ja")
      ) {
        items.push({
          id: `sentence:${analysis.sentenceId}`,
          text: sentence.text,
        });
      }
      for (const [index, vocabulary] of analysis.vocabulary.entries()) {
        if (vocabulary.language === "ja") {
          items.push({
            id: `vocabulary:${analysis.sentenceId}:${String(index)}`,
            text: vocabulary.surface,
          });
        }
      }
    }

    if (items.length === 0) {
      return analyses.map((analysis) => sentenceAnalysisSchema.parse(analysis));
    }

    const response = readingResponseSchema.parse(
      await this.#batchRunner({ items }),
    );
    const requestedIds = new Set(items.map((item) => item.id));
    const readingsById = new Map<string, string | null>();
    for (const item of response.items) {
      if (!requestedIds.has(item.id)) {
        throw new InputError(
          `SudachiPy returned an unrequested reading ID: ${item.id}`,
        );
      }
      if (readingsById.has(item.id)) {
        throw new InputError(
          `SudachiPy returned a duplicate reading ID: ${item.id}`,
        );
      }
      readingsById.set(item.id, item.reading);
    }
    for (const item of items) {
      if (!readingsById.has(item.id)) {
        throw new InputError(
          `SudachiPy omitted a requested reading ID: ${item.id}`,
        );
      }
    }

    return analyses.map((analysis) => {
      const sentence = sentencesById.get(analysis.sentenceId);
      const sentenceReadingId = `sentence:${analysis.sentenceId}`;
      const shouldOverrideSentence =
        sentence?.language === "ja" &&
        sentence.languages.every((language) => language === "ja");
      return sentenceAnalysisSchema.parse({
        ...analysis,
        reading: shouldOverrideSentence
          ? (readingsById.get(sentenceReadingId) ?? null)
          : analysis.reading,
        vocabulary: analysis.vocabulary.map((vocabulary, index) =>
          vocabulary.language === "ja"
            ? {
                ...vocabulary,
                reading:
                  readingsById.get(
                    `vocabulary:${analysis.sentenceId}:${String(index)}`,
                  ) ?? null,
              }
            : vocabulary,
        ),
      });
    });
  }
}
