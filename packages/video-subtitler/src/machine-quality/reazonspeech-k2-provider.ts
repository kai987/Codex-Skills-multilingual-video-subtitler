import { createHash } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import os from "node:os";
import path from "node:path";

import type { IndependentAsrModelIdentity } from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";
import {
  assertIndependentAsrAudioRequest,
  type IndependentAsrProvider,
  type IndependentAsrProviderDiagnostics,
  type IndependentAsrProviderRequest,
  type IndependentAsrProviderResult,
} from "./independent-asr-provider.js";

export const REAZON_K2_MODEL_ID = "reazon-research/reazonspeech-k2-v2" as const;
export const REAZON_K2_MODEL_REVISION =
  "291488c8151be24d7da4bf7af26e533fad96e407" as const;
export const REAZON_K2_MODEL_FILES = [
  "encoder-epoch-99-avg-1.onnx",
  "decoder-epoch-99-avg-1.onnx",
  "joiner-epoch-99-avg-1.onnx",
  "tokens.txt",
] as const;
export const REAZON_K2_FP32_FILE_IDENTITIES = {
  "encoder-epoch-99-avg-1.onnx": {
    size: 592_347_848,
    sha256: "ecdb0b771e16104aaf8e579cb3c1e32fbd589eb641c5946d82b615bd366c5f96",
  },
  "decoder-epoch-99-avg-1.onnx": {
    size: 11_767_836,
    sha256: "58b18211ae06265466bfa17172dab574df94f76c8bcb61a3640c28ba860e4124",
  },
  "joiner-epoch-99-avg-1.onnx": {
    size: 10_720_115,
    sha256: "d38a81d1191c9ed6de6a1719503692e07e3e973e2364adde0abae5eaaded1174",
  },
  "tokens.txt": {
    size: 45_754,
    sha256: "2c3ac659818a48a0c04010e0593bbc4d7c8a24a054340b01131499c05fd52def",
  },
} as const;

async function sha256File(file: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
}

export async function loadReazonK2ModelIdentity(
  modelDirectory: string,
): Promise<IndependentAsrModelIdentity> {
  const files = await Promise.all(
    REAZON_K2_MODEL_FILES.map(async (fileName) => {
      const file = path.join(modelDirectory, fileName);
      const info = await stat(file);
      if (!info.isFile() || info.size === 0) {
        throw new Error(`Reazon K2 model file is invalid: ${fileName}`);
      }
      const actual = {
        fileName,
        size: info.size,
        sha256: await sha256File(file),
      };
      const expected = REAZON_K2_FP32_FILE_IDENTITIES[fileName];
      if (actual.size !== expected.size || actual.sha256 !== expected.sha256) {
        throw new Error(`Reazon K2 pinned file identity mismatch: ${fileName}`);
      }
      return actual;
    }),
  );
  return {
    providerId: "reazonspeech-k2-v2",
    modelId: REAZON_K2_MODEL_ID,
    modelRevision: REAZON_K2_MODEL_REVISION,
    architecture: "Zipformer character RNN-T",
    modelFiles: files,
    modelSnapshotHash: machineQualitySemanticHash({
      modelId: REAZON_K2_MODEL_ID,
      modelRevision: REAZON_K2_MODEL_REVISION,
      files,
      precision: "fp32",
    }),
    precision: "fp32",
    device: "cpu",
    language: "ja",
  };
}

interface WorkerReadyMessage extends IndependentAsrProviderDiagnostics {
  type: "ready";
}

interface WorkerResultMessage extends IndependentAsrProviderResult {
  type: "result";
  peakRssBytes: number | null;
}

interface PendingRequest {
  resolve: (value: WorkerResultMessage) => void;
  reject: (error: Error) => void;
}

function sanitized(value: unknown): string {
  return (value instanceof Error ? value.message : String(value))
    .replace(/\/Users\/[^\s"']+/gu, "LOCAL_PATH_REDACTED")
    .replace(/(?:hf|api)[_-]?token\s*[:=]\s*\S+/giu, "TOKEN_REDACTED")
    .slice(0, 1_000);
}

export class ReazonSpeechK2Provider implements IndependentAsrProvider {
  readonly providerId = "reazonspeech-k2-v2" as const;
  readonly maxAudioSeconds = 30 as const;
  readonly #pythonExecutable: string;
  readonly #workerScriptPath: string;
  readonly #modelDirectory: string;
  #child: ChildProcessWithoutNullStreams | null = null;
  #ready: Promise<WorkerReadyMessage> | null = null;
  #pending = new Map<string, PendingRequest>();
  #stderr = "";

  constructor(input: {
    pythonExecutable: string;
    workerScriptPath: string;
    modelDirectory: string;
  }) {
    this.#pythonExecutable = input.pythonExecutable;
    this.#workerScriptPath = input.workerScriptPath;
    this.#modelDirectory = input.modelDirectory;
  }

  async start(): Promise<WorkerReadyMessage> {
    if (this.#ready !== null) return await this.#ready;
    this.#ready = new Promise<WorkerReadyMessage>((resolve, reject) => {
      const environment = { ...process.env };
      delete environment.HF_TOKEN;
      delete environment.HUGGING_FACE_HUB_TOKEN;
      delete environment.OPENAI_API_KEY;
      environment.HF_HUB_OFFLINE = "1";
      environment.TRANSFORMERS_OFFLINE = "1";
      environment.HF_HUB_DISABLE_TELEMETRY = "1";
      environment.NO_PROXY = "*";
      environment.no_proxy = "*";
      const child = spawn(
        this.#pythonExecutable,
        [
          this.#workerScriptPath,
          "--model-directory",
          this.#modelDirectory,
          "--threads",
          "1",
        ],
        { shell: false, env: environment, stdio: ["pipe", "pipe", "pipe"] },
      );
      this.#child = child;
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        this.#stderr = `${this.#stderr}${chunk}`.slice(-8_000);
      });
      const lines = createInterface({ input: child.stdout });
      lines.on("line", (line) => {
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(line) as Record<string, unknown>;
        } catch (error) {
          reject(
            new Error(
              `Independent ASR worker emitted invalid JSON: ${sanitized(error)}`,
            ),
          );
          return;
        }
        if (message.type === "ready") {
          resolve(message as unknown as WorkerReadyMessage);
          return;
        }
        if (message.type === "result") {
          const requestId = String(message.requestId ?? "");
          const pending = this.#pending.get(requestId);
          if (pending === undefined) return;
          this.#pending.delete(requestId);
          pending.resolve(message as unknown as WorkerResultMessage);
          return;
        }
        if (message.type === "fatal") {
          reject(
            new Error(
              `Independent ASR worker failed closed: ${sanitized(message.message)}`,
            ),
          );
        }
      });
      child.once("error", (error) => {
        reject(
          new Error(
            `Unable to start independent ASR worker: ${sanitized(error)}`,
          ),
        );
      });
      child.once("close", (code) => {
        const error = new Error(
          `Independent ASR worker exited with ${String(code)}: ${sanitized(this.#stderr)}`,
        );
        reject(error);
        for (const pending of this.#pending.values()) pending.reject(error);
        this.#pending.clear();
      });
    });
    return await this.#ready;
  }

  async transcribeBatch(requests: readonly IndependentAsrProviderRequest[]) {
    await Promise.all(requests.map(assertIndependentAsrAudioRequest));
    const ready = await this.start();
    if (this.#child === null)
      throw new Error("Independent ASR worker is unavailable.");
    const results: WorkerResultMessage[] = [];
    for (const request of requests) {
      const response = new Promise<WorkerResultMessage>((resolve, reject) => {
        this.#pending.set(request.requestId, { resolve, reject });
      });
      this.#child.stdin.write(
        `${JSON.stringify({
          type: "transcribe",
          requestId: request.requestId,
          audioPath: request.audioPath,
          maximumPaddedSeconds: this.maxAudioSeconds,
        })}\n`,
      );
      results.push(await response);
    }
    return {
      results: results.map(
        ({ type: _type, peakRssBytes: _rss, ...result }) => result,
      ),
      diagnostics: {
        ...ready,
        peakRssBytes: results.reduce<number | null>(
          (maximum, result) =>
            result.peakRssBytes === null
              ? maximum
              : Math.max(maximum ?? 0, result.peakRssBytes),
          ready.peakRssBytes,
        ),
      },
    };
  }

  runtimeIdentity(input: {
    modelIdentity: IndependentAsrModelIdentity;
    adapterSourceSha256: string;
    pythonVersion: string;
    sherpaOnnxVersion: string;
  }): string {
    return machineQualitySemanticHash({
      providerId: this.providerId,
      adapterType: "DIRECT_SHERPA_ONNX_OFFICIAL_REAZON_FP32",
      os: `${os.platform()} ${os.release()}`,
      arch: os.arch(),
      cpu: os.cpus()[0]?.model ?? "unknown",
      modelIdentity: input.modelIdentity,
      adapterSourceSha256: input.adapterSourceSha256,
      pythonVersion: input.pythonVersion,
      sherpaOnnxVersion: input.sherpaOnnxVersion,
      threadCount: 1,
    });
  }

  async close(): Promise<void> {
    if (this.#child === null) return;
    const child = this.#child;
    this.#child = null;
    if (child.exitCode !== null || child.killed) return;
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGTERM");
        finish();
      }, 5_000);
      timer.unref();
      child.once("close", finish);
      try {
        child.stdin.write(`${JSON.stringify({ type: "shutdown" })}\n`);
        child.stdin.end();
      } catch {
        child.kill("SIGTERM");
      }
    });
  }
}
