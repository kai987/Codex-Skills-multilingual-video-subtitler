import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";

import { InputError } from "@mvl/shared";

export const SOURCE_SEPARATION_POLICY =
  "c5.18.1-source-separation-observe-v1" as const;
export const SEPARATED_STREAM_LABELS = [
  "Candidate Stream A",
  "Candidate Stream B",
] as const;

export interface SeparationTriggerCandidate {
  componentId: string;
  resolutionStatus:
    "resolved" | "unresolved" | "timing-only" | "presentation-only" | "failed";
  speakerTrackCount: number;
  overlapSpeechIntervalCount: number;
}

export function selectSourceSeparationTriggers(
  candidates: readonly SeparationTriggerCandidate[],
  maximum = 4,
): { componentId: string; triggerReasons: string[] }[] {
  if (!Number.isInteger(maximum) || maximum < 0 || maximum > 4) {
    throw new InputError("Source separation maximum must be from 0 through 4.");
  }
  return [...candidates]
    .filter(
      (candidate) =>
        candidate.resolutionStatus !== "resolved" &&
        (candidate.speakerTrackCount >= 2 ||
          candidate.overlapSpeechIntervalCount > 0),
    )
    .toSorted((left, right) =>
      left.componentId.localeCompare(right.componentId),
    )
    .slice(0, maximum)
    .map((candidate) => ({
      componentId: candidate.componentId,
      triggerReasons: [
        ...(candidate.speakerTrackCount >= 2
          ? ["MULTIPLE_ANONYMOUS_SPEAKER_TRACKS"]
          : []),
        ...(candidate.overlapSpeechIntervalCount > 0
          ? ["OVERLAP_SPEECH_INTERVAL_OBSERVED"]
          : []),
      ],
    }));
}

function finite(values: readonly number[]): boolean {
  return values.every(Number.isFinite);
}

function rms(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return Math.sqrt(
    values.reduce((sum, value) => sum + value * value, 0) / values.length,
  );
}

function correlation(
  left: readonly number[],
  right: readonly number[],
): number | null {
  if (left.length === 0 || left.length !== right.length) return null;
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let numerator = 0;
  let leftPower = 0;
  let rightPower = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftCentered = (left[index] ?? 0) - leftMean;
    const rightCentered = (right[index] ?? 0) - rightMean;
    numerator += leftCentered * rightCentered;
    leftPower += leftCentered * leftCentered;
    rightPower += rightCentered * rightCentered;
  }
  const denominator = Math.sqrt(leftPower * rightPower);
  return denominator <= Number.EPSILON ? null : numerator / denominator;
}

export function assessSeparatedStreams(input: {
  mixture: readonly number[];
  streamA: readonly number[];
  streamB: readonly number[];
  sampleRate?: number;
}): {
  finiteSampleCheck: boolean;
  lengthParity: boolean;
  streamARms: number;
  streamBRms: number;
  nonSilentDurationA: number;
  nonSilentDurationB: number;
  streamCorrelation: number | null;
  mixtureReconstructionError: number | null;
  qualityStatus: "usable-observe-only" | "unreliable";
  blockers: string[];
  timingActionable: false;
} {
  const sampleRate = input.sampleRate ?? 16_000;
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new InputError("Source separation sample rate is invalid.");
  }
  const finiteSampleCheck =
    finite(input.mixture) && finite(input.streamA) && finite(input.streamB);
  const lengthParity =
    input.mixture.length > 0 &&
    input.mixture.length === input.streamA.length &&
    input.streamA.length === input.streamB.length;
  const streamARms = finite(input.streamA) ? rms(input.streamA) : 0;
  const streamBRms = finite(input.streamB) ? rms(input.streamB) : 0;
  const streamCorrelation =
    finiteSampleCheck && lengthParity
      ? correlation(input.streamA, input.streamB)
      : null;
  const mixtureReconstructionError =
    finiteSampleCheck && lengthParity
      ? rms(
          input.mixture.map(
            (value, index) =>
              value - (input.streamA[index] ?? 0) - (input.streamB[index] ?? 0),
          ),
        )
      : null;
  const blockers = [
    ...(!finiteSampleCheck ? ["SEPARATION_NONFINITE_SAMPLE"] : []),
    ...(!lengthParity ? ["SEPARATION_LENGTH_MISMATCH"] : []),
    ...(streamARms < 1e-5 ? ["SEPARATION_STREAM_A_ZERO"] : []),
    ...(streamBRms < 1e-5 ? ["SEPARATION_STREAM_B_ZERO"] : []),
    ...(streamCorrelation !== null && Math.abs(streamCorrelation) >= 0.98
      ? ["SEPARATION_STREAMS_HIGHLY_CORRELATED"]
      : []),
    ...(mixtureReconstructionError !== null &&
    mixtureReconstructionError > Math.max(0.05, rms(input.mixture) * 0.5)
      ? ["SEPARATION_RECONSTRUCTION_ERROR_HIGH"]
      : []),
  ].toSorted();
  return {
    finiteSampleCheck,
    lengthParity,
    streamARms,
    streamBRms,
    nonSilentDurationA:
      input.streamA.filter((value) => Math.abs(value) >= 1e-4).length /
      sampleRate,
    nonSilentDurationB:
      input.streamB.filter((value) => Math.abs(value) >= 1e-4).length /
      sampleRate,
    streamCorrelation,
    mixtureReconstructionError,
    qualityStatus: blockers.length === 0 ? "usable-observe-only" : "unreliable",
    blockers,
    timingActionable: false,
  };
}

function wavDataChunk(buffer: Buffer): { offset: number; length: number } {
  let cursor = 12;
  while (cursor + 8 <= buffer.length) {
    const id = buffer.toString("ascii", cursor, cursor + 4);
    const length = buffer.readUInt32LE(cursor + 4);
    const offset = cursor + 8;
    if (offset + length > buffer.length) {
      throw new InputError("Separated WAV data is truncated.");
    }
    if (id === "data") return { offset, length };
    cursor = offset + length + (length % 2);
  }
  throw new InputError("Separated WAV data chunk is missing.");
}

export function decodeMonoPcm16Wav(buffer: Buffer): number[] {
  if (
    buffer.length < 44 ||
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WAVE" ||
    buffer.readUInt16LE(20) !== 1 ||
    buffer.readUInt16LE(22) !== 1 ||
    buffer.readUInt32LE(24) !== 16_000 ||
    buffer.readUInt16LE(34) !== 16
  ) {
    throw new InputError("Separated WAV must be mono PCM16 at 16 kHz.");
  }
  const chunk = wavDataChunk(buffer);
  return Array.from(
    { length: chunk.length / 2 },
    (_, index) => buffer.readInt16LE(chunk.offset + index * 2) / 32_768,
  );
}

export interface SeparationWorkerReady {
  deviceRequested: "auto" | "mps" | "cpu";
  deviceUsed: "mps" | "cpu";
  fallback: {
    applied: boolean;
    from: "mps" | null;
    to: "cpu" | null;
    reason: string | null;
  };
  modelLoadCount: number;
}

export interface SeparationWorkerResult {
  outputA: string;
  outputB: string;
  inputSampleCount: number;
  outputSampleCount: number;
  wallClockSeconds: number;
}

export class LocalSourceSeparationWorker {
  readonly #pythonExecutable: string;
  readonly #modelDirectory: string;
  readonly #workerScriptPath: string;
  readonly #device: "auto" | "mps" | "cpu";
  #child: ChildProcessWithoutNullStreams | null = null;
  #ready: Promise<SeparationWorkerReady> | null = null;
  #pending = new Map<
    string,
    {
      resolve: (result: SeparationWorkerResult) => void;
      reject: (error: Error) => void;
    }
  >();
  #stderr = "";

  constructor(input: {
    pythonExecutable: string;
    modelDirectory: string;
    workerScriptPath: string;
    device: "auto" | "mps" | "cpu";
  }) {
    this.#pythonExecutable = input.pythonExecutable;
    this.#modelDirectory = input.modelDirectory;
    this.#workerScriptPath = input.workerScriptPath;
    this.#device = input.device;
  }

  async start(): Promise<SeparationWorkerReady> {
    if (this.#ready !== null) return await this.#ready;
    this.#ready = new Promise<SeparationWorkerReady>((resolve, reject) => {
      const environment = { ...process.env };
      delete environment.HF_TOKEN;
      delete environment.HUGGING_FACE_HUB_TOKEN;
      environment.HF_HUB_OFFLINE = "1";
      environment.HF_HUB_DISABLE_TELEMETRY = "1";
      const child = spawn(
        this.#pythonExecutable,
        [
          this.#workerScriptPath,
          "--model-directory",
          this.#modelDirectory,
          "--device",
          this.#device,
        ],
        { shell: false, env: environment, stdio: ["pipe", "pipe", "pipe"] },
      );
      this.#child = child;
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        this.#stderr = `${this.#stderr}${chunk}`.slice(-4_000);
      });
      const lines = createInterface({ input: child.stdout });
      lines.on("line", (line) => {
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(line) as Record<string, unknown>;
        } catch (error) {
          reject(
            new InputError(
              `Separation worker emitted invalid JSON: ${String(error)}`,
            ),
          );
          return;
        }
        if (message.type === "ready") {
          resolve(message as unknown as SeparationWorkerReady);
          return;
        }
        if (message.type === "result" || message.type === "error") {
          const requestId =
            typeof message.requestId === "string" ? message.requestId : "";
          const pending = this.#pending.get(requestId);
          if (pending === undefined) return;
          this.#pending.delete(requestId);
          if (message.type === "error") {
            pending.reject(
              new InputError(
                `Source separation failed (${String(message.code)}): ${String(message.message).slice(0, 800)}`,
              ),
            );
          } else {
            pending.resolve(message as unknown as SeparationWorkerResult);
          }
          return;
        }
        if (message.type === "fatal") {
          reject(
            new InputError(
              `Source separation runtime failed: ${String(message.message).slice(0, 800)}`,
            ),
          );
        }
      });
      child.once("error", reject);
      child.once("close", (code) => {
        const error = new InputError(
          `Source separation worker exited with ${String(code)}: ${this.#stderr}`,
        );
        reject(error);
        for (const pending of this.#pending.values()) pending.reject(error);
        this.#pending.clear();
      });
    });
    return await this.#ready;
  }

  async separate(input: {
    audioPath: string;
    outputA: string;
    outputB: string;
  }): Promise<SeparationWorkerResult> {
    await this.start();
    if (this.#child === null) {
      throw new InputError("Source separation worker is not running.");
    }
    const requestId = randomUUID();
    const result = new Promise<SeparationWorkerResult>((resolve, reject) => {
      this.#pending.set(requestId, { resolve, reject });
    });
    this.#child.stdin.write(
      `${JSON.stringify({ type: "separate", requestId, ...input })}\n`,
    );
    return await result;
  }

  async close(): Promise<void> {
    if (this.#child === null) return;
    const child = this.#child;
    this.#child = null;
    if (child.exitCode !== null || child.killed) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        resolve();
      }, 5_000);
      timer.unref();
      child.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
      child.stdin.write(`${JSON.stringify({ type: "shutdown" })}\n`);
      child.stdin.end();
    });
  }
}

export async function loadSeparatedPcm(input: {
  mixturePath: string;
  streamAPath: string;
  streamBPath: string;
}) {
  const [mixture, streamA, streamB] = await Promise.all([
    readFile(input.mixturePath),
    readFile(input.streamAPath),
    readFile(input.streamBPath),
  ]);
  return {
    mixture: decodeMonoPcm16Wav(mixture),
    streamA: decodeMonoPcm16Wav(streamA),
    streamB: decodeMonoPcm16Wav(streamB),
  };
}
