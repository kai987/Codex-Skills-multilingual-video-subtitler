import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  WhisperCppWorkerPool,
  type WhisperVadProfile,
} from "@mvl/transcription-core";
import {
  atomicWriteJson,
  c4PersistentWorkerVerificationArtifactSchema,
} from "@mvl/shared";

const C4_ROOT = path.resolve(
  "output/carnation-reference-guided-c4-cached-20260801",
);
const RESULT_PATH = path.join(C4_ROOT, "coverage-targeted-asr-results.json");
const AUDIO_DIRECTORY = path.join(C4_ROOT, "coverage-targeted-asr");
const OUTPUT_PATH = path.join(
  C4_ROOT,
  "coverage-targeted-persistent-worker-verification.json",
);
const WHISPER =
  "/Users/paulasmith/.cache/multilingual-video-subtitler/whisper.cpp-v1.9.1-coreml/build-coreml/bin/whisper-cli";
const MODEL = "/Users/paulasmith/.cache/whisper.cpp/ggml-large-v3.bin";
const VAD_MODEL = "/Users/paulasmith/.cache/whisper.cpp/ggml-silero-v6.2.0.bin";
const PROMPT =
  "Transcribe only Japanese speech audibly present in this short clip. Do not translate. Do not invent speech for noise, silence, music, or crowd sounds.";

interface StoredWindow {
  unitId: string;
  requestIds: string[];
}

interface StoredRun {
  round: number;
  windows: StoredWindow[];
}

interface StoredResults {
  runs: StoredRun[];
}

async function sha256File(filePath: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    digest.update(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return digest.digest("hex");
}

function wavDuration(buffer: Buffer): number {
  if (
    buffer.length < 44 ||
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new Error("Expected a RIFF/WAVE coverage clip.");
  }
  let byteRate: number | null = null;
  let dataBytes: number | null = null;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkBytes = buffer.readUInt32LE(offset + 4);
    if (chunkId === "fmt " && chunkBytes >= 12) {
      byteRate = buffer.readUInt32LE(offset + 8 + 8);
    }
    if (chunkId === "data") {
      dataBytes = Math.min(chunkBytes, buffer.length - offset - 8);
      break;
    }
    offset += 8 + chunkBytes + (chunkBytes % 2);
  }
  if (byteRate === null || byteRate <= 0 || dataBytes === null) {
    throw new Error("The coverage clip has no usable fmt/data WAV chunks.");
  }
  return dataBytes / byteRate;
}

function profileFor(requestId: string): {
  useVad: boolean;
  vadProfile: WhisperVadProfile;
} {
  const profile = requestId.slice(requestId.lastIndexOf(":") + 1);
  if (profile === "no-vad") {
    return { useVad: false, vadProfile: "sensitive-v2" };
  }
  if (profile === "extra-sensitive-vad") {
    return { useVad: true, vadProfile: "extra-sensitive-v1" };
  }
  if (profile !== "sensitive-vad") {
    throw new Error(`Unsupported recovery profile: ${profile}`);
  }
  return { useVad: true, vadProfile: "sensitive-v2" };
}

const stored = JSON.parse(await readFile(RESULT_PATH, "utf8")) as StoredResults;
const requests = stored.runs.flatMap((run) =>
  run.windows.flatMap((window) =>
    window.requestIds.map((requestId) => ({
      round: run.round,
      unitId: window.unitId,
      requestId,
    })),
  ),
);
if (requests.length !== 80) {
  throw new Error(
    `Expected all 80 persisted C4 logical requests, received ${String(requests.length)}.`,
  );
}

const modelHash = await sha256File(MODEL);
const pool = new WhisperCppWorkerPool({ mode: "persistent" });
const results: {
  round: number;
  unitId: string;
  requestId: string;
  duration: number;
  segmentCount: number;
  textSha256: string;
}[] = [];

try {
  for (const [index, item] of requests.entries()) {
    const audioPath = path.join(AUDIO_DIRECTORY, `${item.unitId}.wav`);
    const audio = await readFile(audioPath);
    const duration = wavDuration(audio);
    const audioHash = createHash("sha256").update(audio).digest("hex");
    const profile = profileFor(item.requestId);
    const verificationRequestId = `persistent-check-r${String(item.round)}-${String(index + 1).padStart(3, "0")}-${item.requestId}`;
    const result = await pool.transcribe({
      request: {
        audioPath,
        chunk: {
          id: verificationRequestId,
          relativePath: path.relative(C4_ROOT, audioPath),
          start: 0,
          end: duration,
          duration,
          sha256: audioHash,
        },
        language: "ja",
        timestampStrategy: "segment",
        tokenTimestamps: true,
      },
      capability: {
        executablePath: WHISPER,
        modelPath: MODEL,
        modelHash,
        whisperCppVersion: "1.9.1",
        coreML: true,
        threads: 8,
        language: "ja",
        vadModelPath: VAD_MODEL,
        useVad: profile.useVad,
        vadProfile: profile.vadProfile,
        tokenTimestamps: true,
        promptConstraint: "reference-text-not-used-as-asr-prompt",
      },
      initialPrompt: PROMPT,
      processFallback: () => {
        throw new Error("Persistent Core ML worker fallback is disabled");
      },
    });
    results.push({
      round: item.round,
      unitId: item.unitId,
      requestId: item.requestId,
      duration,
      segmentCount: result.segments.length,
      textSha256: createHash("sha256").update(result.text).digest("hex"),
    });
  }
} finally {
  await pool.close();
}

const execution = pool.metrics();
if (
  execution.asrRequestCount !== 80 ||
  execution.workerStartCount !== 1 ||
  execution.modelLoadCount !== 1 ||
  execution.fallbackProcessCount !== 0 ||
  execution.backend !== "coreml"
) {
  throw new Error(
    `Persistent worker verification failed: ${JSON.stringify(execution)}`,
  );
}

await atomicWriteJson(
  OUTPUT_PATH,
  c4PersistentWorkerVerificationArtifactSchema.parse({
    schemaVersion: "1.0.0",
    verificationKind: "all-c4-targeted-requests-single-persistent-worker",
    generatedAt: new Date().toISOString(),
    authoritativeCandidateSource: false,
    note: "This post-run replay verifies worker/model lifecycle and Core ML for all stored C4 targeted requests. The authoritative C4 candidates remain those in coverage-targeted-asr-results.json.",
    sourceResultPath: path.relative(C4_ROOT, RESULT_PATH),
    requestCount: requests.length,
    resultCount: results.length,
    execution,
    results,
  }),
  { overwrite: true },
);

console.log(
  JSON.stringify(
    {
      outputPath: OUTPUT_PATH,
      requestCount: requests.length,
      workerStartCount: execution.workerStartCount,
      modelLoadCount: execution.modelLoadCount,
      backend: execution.backend,
      fallbackProcessCount: execution.fallbackProcessCount,
      totalWorkerSeconds: execution.totalWorkerSeconds,
    },
    null,
    2,
  ),
);
