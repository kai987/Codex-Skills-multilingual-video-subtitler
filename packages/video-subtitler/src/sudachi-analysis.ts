import { spawn } from "node:child_process";

import { InputError, UserActionRequiredError } from "@mvl/shared";
import type { SudachiMorphemeAnalysis } from "@mvl/transcription-core";
import { z } from "zod";

const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

const responseSchema = z
  .object({
    engine: z
      .object({
        helperVersion: z.literal("1.0.0"),
        sudachiPyVersion: z.literal("0.6.11"),
        dictionaryVersion: z.literal("20260428"),
        dictionary: z.literal("core"),
        splitMode: z.literal("C"),
        outputScript: z.literal("hiragana"),
      })
      .strict(),
    items: z.array(
      z
        .object({
          id: z.string().min(1),
          reading: z.string().min(1).nullable(),
          unresolvedOov: z.array(z.string().min(1)),
          morphemes: z.array(
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
              .strict()
              .refine((value) => value.endCharacter > value.startCharacter),
          ),
        })
        .strict(),
    ),
  })
  .strict();

export async function runSudachiMorphemeAnalysis(input: {
  pythonExecutable: string;
  helperPath: string;
  items: readonly { id: string; text: string }[];
  timeoutMs?: number;
}): Promise<{
  morphemesById: Map<string, readonly SudachiMorphemeAnalysis[]>;
  readingsById: Map<string, string | null>;
  unresolvedOovById: Map<string, readonly string[]>;
}> {
  const response = await new Promise<unknown>((resolve, reject) => {
    const child = spawn(input.pythonExecutable, [input.helperPath], {
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const settle = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      settle(() =>
        reject(
          new InputError("Sudachi morpheme analysis timed out.", {
            timeoutMs: input.timeoutMs ?? 30_000,
          }),
        ),
      );
    }, input.timeoutMs ?? 30_000);
    child.once("error", (error) => {
      settle(() =>
        reject(
          new UserActionRequiredError(
            "The isolated MFA/Sudachi Python runtime is unavailable.",
            { cause: String(error) },
          ),
        ),
      );
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout, "utf8") > MAX_OUTPUT_BYTES) {
        child.kill("SIGKILL");
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      if (Buffer.byteLength(stderr, "utf8") > MAX_OUTPUT_BYTES) {
        child.kill("SIGKILL");
      }
    });
    child.once("close", (code) => {
      if (code !== 0) {
        settle(() =>
          reject(
            new UserActionRequiredError(
              "Pinned Sudachi morpheme analysis failed in the MFA runtime.",
              { exitCode: code, stderr: stderr.slice(-2_000) },
            ),
          ),
        );
        return;
      }
      settle(() => {
        try {
          resolve(JSON.parse(stdout) as unknown);
        } catch (error) {
          reject(
            new InputError("Sudachi helper returned invalid JSON.", {
              cause: String(error),
            }),
          );
        }
      });
    });
    child.stdin.end(JSON.stringify({ items: input.items }));
  });
  const parsed = responseSchema.parse(response);
  const expectedIds = new Set(input.items.map((item) => item.id));
  if (
    parsed.items.length !== input.items.length ||
    parsed.items.some((item) => !expectedIds.has(item.id)) ||
    new Set(parsed.items.map((item) => item.id)).size !== parsed.items.length
  ) {
    throw new InputError("Sudachi response IDs do not match the request.");
  }
  return {
    morphemesById: new Map(
      parsed.items.map((item) => [item.id, item.morphemes]),
    ),
    readingsById: new Map(parsed.items.map((item) => [item.id, item.reading])),
    unresolvedOovById: new Map(
      parsed.items.map((item) => [item.id, item.unresolvedOov]),
    ),
  };
}
