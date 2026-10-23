import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

import type {
  independentAcousticOutcomeSchema,
  MachineIndependentAcousticDiscriminator,
} from "@mvl/shared";
import type { z } from "zod";

import { machineQualitySemanticHash } from "./evidence-correlation.js";
import type { IndependentCtcRepresentation } from "./independent-ctc-projection.js";

export type IndependentAcousticOutcome = z.infer<
  typeof independentAcousticOutcomeSchema
>;

export const C60111_INDEPENDENT_MODEL_ID =
  "jonatasgrosman/wav2vec2-large-xlsr-53-japanese" as const;
export const C60111_INDEPENDENT_MODEL_REVISION =
  "cf031e020336460d15a417eba710bbc5bb43be9a" as const;

export interface IndependentCtcProjectedScore {
  representation: "NORMALIZED_DISPLAY" | "PRONUNCIATION";
  representationHash: string;
  encodedTokenCount: number;
  unknownTokenCount: number;
  coverageRatio: number;
  rawNll: number | null;
  nllPerTargetToken: number | null;
  acousticFrameCount: number;
  targetCoverage: number;
  blockers: string[];
}

export interface IndependentCtcWorkerReady {
  pythonVersion: string;
  versions: {
    torch: string;
    transformers: string;
    scikitLearn: string;
    numpy: string;
    scipy: string;
  };
  device: "cpu";
  precision: "fp32";
  sampleRate: 16000;
  processorClass: string;
  modelClass: string;
  tokenizerClass: string;
  vocabularyHash: string;
  vocabularySize: number;
  blankTokenId: number;
  unknownTokenId: number | null;
  modelLoadCount: number;
}

interface ScoreResult {
  type: "score-result";
  requestId: string;
  audioSampleCount: number;
  whisper: IndependentCtcProjectedScore;
  reazon: IndependentCtcProjectedScore;
  forwardPassCount: 1;
  wallClockSeconds: number;
}

interface Pending {
  resolve: (result: ScoreResult) => void;
  reject: (error: Error) => void;
}

function workerErrorMessage(
  value: Record<string, unknown>,
  fallback: string,
): string {
  if (typeof value.message === "string") return value.message;
  if (typeof value.code === "string" || typeof value.code === "number") {
    return String(value.code);
  }
  return fallback;
}

export function independentCtcCacheKey(input: {
  audioSha256: string;
  whisperRepresentations: readonly IndependentCtcRepresentation[];
  reazonRepresentations: readonly IndependentCtcRepresentation[];
  modelSnapshotHash: string;
  runtimeId: string;
}): string {
  return machineQualitySemanticHash({
    namespace: "c6-0-1-11-independent-ctc-v1",
    ...input,
  });
}

export function classifyIndependentAcousticMargin(input: {
  whisperNllPerTargetToken: number | null;
  reazonNllPerTargetToken: number | null;
  nearTieTolerance?: number;
}): { margin: number | null; outcome: IndependentAcousticOutcome } {
  const whisper = input.whisperNllPerTargetToken;
  const reazon = input.reazonNllPerTargetToken;
  if (
    whisper === null ||
    reazon === null ||
    !Number.isFinite(whisper) ||
    !Number.isFinite(reazon)
  ) {
    return { margin: null, outcome: "INDEPENDENT_UNSCORABLE" };
  }
  const margin = whisper - reazon;
  const tolerance = input.nearTieTolerance ?? 1e-6;
  if (Math.abs(margin) <= tolerance) {
    return { margin, outcome: "INDEPENDENT_NEAR_TIE" };
  }
  return {
    margin,
    outcome:
      margin > 0 ? "INDEPENDENT_FAVORS_REAZON" : "INDEPENDENT_FAVORS_WHISPER",
  };
}

export function buildIndependentDiscriminatorEvent(input: {
  eventId: string;
  audioSha256: string;
  whisperCandidateId: string;
  reazonCandidateId: string;
  result: Pick<ScoreResult, "whisper" | "reazon">;
}): MachineIndependentAcousticDiscriminator["events"][number] {
  const preference = classifyIndependentAcousticMargin({
    whisperNllPerTargetToken: input.result.whisper.nllPerTargetToken,
    reazonNllPerTargetToken: input.result.reazon.nllPerTargetToken,
  });
  const core = {
    eventId: input.eventId,
    audioSha256: input.audioSha256,
    whisper: {
      candidateId: input.whisperCandidateId,
      ...input.result.whisper,
    },
    reazon: {
      candidateId: input.reazonCandidateId,
      ...input.result.reazon,
    },
    pairwiseMargin: preference.margin,
    outcome: preference.outcome,
    scorability:
      preference.outcome === "INDEPENDENT_UNSCORABLE"
        ? ("UNSCORABLE" as const)
        : ("SCORABLE" as const),
  };
  return { ...core, semanticHash: machineQualitySemanticHash(core) };
}

export class IndependentCtcDiscriminatorWorker {
  readonly ready: Promise<IndependentCtcWorkerReady>;
  #child: ChildProcessWithoutNullStreams;
  #pending = new Map<string, Pending>();
  #fatal: Error | null = null;
  #resolveReady!: (ready: IndependentCtcWorkerReady) => void;
  #rejectReady!: (error: Error) => void;

  constructor(input: {
    pythonExecutable: string;
    workerPath: string;
    modelDirectory: string;
    minimumCoverage?: number;
  }) {
    this.ready = new Promise((resolve, reject) => {
      this.#resolveReady = resolve;
      this.#rejectReady = reject;
    });
    const environment = {
      ...process.env,
      HF_HUB_OFFLINE: "1",
      TRANSFORMERS_OFFLINE: "1",
      HF_HUB_DISABLE_TELEMETRY: "1",
      TOKENIZERS_PARALLELISM: "false",
      http_proxy: "",
      https_proxy: "",
      HTTP_PROXY: "",
      HTTPS_PROXY: "",
      NO_PROXY: "*",
      no_proxy: "*",
    };
    this.#child = spawn(
      input.pythonExecutable,
      [
        input.workerPath,
        "--model-directory",
        input.modelDirectory,
        "--minimum-coverage",
        String(input.minimumCoverage ?? 0.95),
      ],
      { env: environment, stdio: ["pipe", "pipe", "pipe"] },
    );
    const lines = createInterface({ input: this.#child.stdout });
    lines.on("line", (line) => this.#handleLine(line));
    this.#child.stderr.on("data", (chunk: Buffer) => {
      process.stderr.write(chunk);
    });
    this.#child.once("error", (error) => this.#failAll(error));
    this.#child.once("exit", (code, signal) => {
      if (code !== 0 && this.#fatal === null) {
        this.#failAll(
          new Error(
            `Independent CTC worker exited with ${String(code)}${signal === null ? "" : ` (${signal})`}.`,
          ),
        );
      }
    });
  }

  #handleLine(line: string): void {
    let value: Record<string, unknown>;
    try {
      value = JSON.parse(line) as Record<string, unknown>;
    } catch (error) {
      this.#failAll(
        new Error(
          `Independent CTC worker emitted invalid JSON: ${String(error)}`,
        ),
      );
      return;
    }
    if (value.type === "ready") {
      this.#resolveReady(value as unknown as IndependentCtcWorkerReady);
      return;
    }
    if (value.type === "fatal") {
      this.#failAll(new Error(workerErrorMessage(value, "Worker fatal")));
      return;
    }
    const requestId =
      typeof value.requestId === "string" ? value.requestId : "";
    const pending = this.#pending.get(requestId);
    if (pending === undefined) return;
    this.#pending.delete(requestId);
    if (value.type === "error") {
      pending.reject(new Error(workerErrorMessage(value, "Score failed")));
    } else {
      pending.resolve(value as unknown as ScoreResult);
    }
  }

  #failAll(error: Error): void {
    this.#fatal = error;
    this.#rejectReady(error);
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }

  async scorePair(input: {
    requestId?: string;
    audioPath: string;
    whisperRepresentations: readonly IndependentCtcRepresentation[];
    reazonRepresentations: readonly IndependentCtcRepresentation[];
  }): Promise<ScoreResult> {
    await this.ready;
    if (this.#fatal !== null) throw this.#fatal;
    const requestId = input.requestId ?? randomUUID();
    const result = new Promise<ScoreResult>((resolve, reject) => {
      this.#pending.set(requestId, { resolve, reject });
    });
    this.#child.stdin.write(
      `${JSON.stringify({ type: "score-pair", requestId, ...input })}\n`,
    );
    return await result;
  }

  async close(): Promise<void> {
    if (!this.#child.killed) {
      this.#child.stdin.write(`${JSON.stringify({ type: "shutdown" })}\n`);
      this.#child.stdin.end();
    }
    await new Promise<void>((resolve) => {
      if (this.#child.exitCode !== null) resolve();
      else this.#child.once("exit", () => resolve());
    });
  }
}

export function independentVerifierRuntimeId(input: {
  modelSnapshotHash: string;
  workerSourceSha256: string;
  versions: IndependentCtcWorkerReady["versions"];
  pythonVersion: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        policy: "candidate-conditioned-ctc-loss-cpu-fp32-v1",
        ...input,
      }),
    )
    .digest("hex");
}
