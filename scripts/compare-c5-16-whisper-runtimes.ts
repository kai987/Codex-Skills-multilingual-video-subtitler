import { createHash } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, readFile, stat } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";

import {
  InputError,
  atomicWriteJson,
  c516StockPatchedRuntimeAbArtifactSchema,
  mvlWhisperServerCapabilitiesSchema,
  mvlWhisperServerResponseSchema,
  subtitleOverlapAcousticResolutionSchema,
  whisperRuntimeBuildManifestSchema,
} from "@mvl/shared";
import { locateSubtitlePackage, sha256LocalFile } from "@mvl/video-subtitler";

import { sha256Bytes, stableJson } from "./whisper-runtime-common.js";

const { values } = parseArgs({
  options: {
    "stock-server": { type: "string" },
    "patched-server": { type: "string" },
    task: { type: "string" },
    model: { type: "string" },
    "vad-model": { type: "string" },
    "runtime-manifest": { type: "string" },
    output: { type: "string" },
    threads: { type: "string", default: "8" },
  },
  strict: true,
});

if (
  values["stock-server"] === undefined ||
  values["patched-server"] === undefined ||
  values.task === undefined ||
  values.model === undefined ||
  values["vad-model"] === undefined
) {
  throw new InputError(
    "Usage: compare:c5-16-whisper-runtimes --stock-server <path> --patched-server <path> --task <C5.15.1 task> --model <large-v3> --vad-model <silero>",
  );
}

const stockServer = path.resolve(values["stock-server"]);
const patchedServer = path.resolve(values["patched-server"]);
const taskDirectory = path.resolve(values.task);
const modelPath = path.resolve(values.model);
const vadModelPath = path.resolve(values["vad-model"]);
const threads = Number(values.threads);
if (!Number.isSafeInteger(threads) || threads < 1) {
  throw new InputError("--threads must be a positive integer.");
}

function inferredManifestPath(): string {
  if (values["runtime-manifest"] !== undefined) {
    return path.resolve(values["runtime-manifest"]);
  }
  return path.resolve(path.dirname(stockServer), "../../build-manifest.json");
}

const runtimeManifestPath = inferredManifestPath();
const buildManifest = whisperRuntimeBuildManifestSchema.parse(
  JSON.parse(await readFile(runtimeManifestPath, "utf8")) as unknown,
);
const [stockSha256, patchedSha256] = await Promise.all([
  sha256LocalFile(stockServer),
  sha256LocalFile(patchedServer),
]);
if (
  stockSha256 !== buildManifest.stock.binarySha256 ||
  patchedSha256 !== buildManifest.patched.binarySha256
) {
  throw new InputError("A/B server binaries do not match the build manifest.");
}

const located = await locateSubtitlePackage(taskDirectory);
const overlapPath = path.join(
  located.subtitleDirectory,
  "subtitle-overlap-acoustic-resolution.json",
);
const overlap = subtitleOverlapAcousticResolutionSchema.parse(
  JSON.parse(await readFile(overlapPath, "utf8")) as unknown,
);
const profiles = [
  // v1.9.3 retains the previous VAD map inside a reused context. Production
  // and A/B therefore schedule every fresh no-VAD request before any VAD
  // request while retaining a single compatible worker/model load.
  "no-vad",
  "current-sensitive-vad",
  "extra-sensitive-vad",
] as const;
const requests = profiles.flatMap((profile) =>
  overlap.components.flatMap((component) => {
    const audioSha256 = component.audioSha256;
    if (component.audioPath === null || audioSha256 === null) return [];
    const audioPath = path.join(located.subtitleDirectory, component.audioPath);
    return [
      {
        componentId: component.componentId,
        profile,
        audioPath,
        audioSha256,
      },
    ];
  }),
);
if (overlap.components.length !== 7 || requests.length !== 21) {
  throw new InputError(
    `C5.16 A/B requires 7 component WAVs and 21 requests; received ${String(overlap.components.length)} components and ${String(requests.length)} requests.`,
  );
}

async function collisionSafeOutput(): Promise<string> {
  if (values.output !== undefined) {
    const explicit = path.resolve(values.output);
    try {
      await stat(explicit);
      throw new InputError(`A/B output already exists: ${explicit}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await mkdir(path.dirname(explicit), { recursive: true });
    return explicit;
  }
  const base = `${path.basename(taskDirectory)}-c5-16-stock-patched-ab`;
  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const directory = path.join(
      path.dirname(taskDirectory),
      suffix === 0 ? base : `${base}-${String(suffix).padStart(2, "0")}`,
    );
    try {
      await stat(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await mkdir(directory, { recursive: false });
      return path.join(directory, "c5-16-stock-patched-runtime-ab.json");
    }
  }
  throw new InputError(
    "Unable to allocate a collision-safe A/B output directory.",
  );
}

async function availablePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("Unable to allocate localhost port."));
        return;
      }
      server.close((error) => {
        if (error === undefined) resolve(address.port);
        else reject(error);
      });
    });
  });
}

async function waitForHealth(
  baseUrl: string,
  child: ChildProcessWithoutNullStreams,
) {
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error("whisper-server exited before health check passed.");
    }
    try {
      const response = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(500),
      });
      if (response.ok) return;
    } catch {
      // Continue until timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for whisper-server health.");
}

async function residentBytes(pid: number | undefined): Promise<number | null> {
  if (pid === undefined || process.platform === "win32") return null;
  return await new Promise((resolve) => {
    const child = spawn("ps", ["-o", "rss=", "-p", String(pid)], {
      shell: false,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.once("error", () => resolve(null));
    child.once("exit", (code) => {
      const kibibytes = Number(stdout.trim());
      resolve(
        code === 0 && Number.isFinite(kibibytes) && kibibytes >= 0
          ? Math.round(kibibytes * 1024)
          : null,
      );
    });
  });
}

function vadConfig(profile: (typeof profiles)[number]) {
  return profile === "extra-sensitive-vad"
    ? {
        useVad: true,
        threshold: "0.25",
        minimumSpeechMs: "50",
        minimumSilenceMs: "100",
        speechPadMs: "400",
        overlap: "0.35",
      }
    : {
        useVad: profile !== "no-vad",
        threshold: "0.35",
        minimumSpeechMs: "100",
        minimumSilenceMs: "150",
        speechPadMs: "250",
        overlap: "0.25",
      };
}

interface RuntimeResponse {
  raw: unknown;
  bytes: number;
  durationSeconds: number;
}

async function runRuntime(input: {
  binary: string;
  patched: boolean;
}): Promise<{
  responses: Map<string, RuntimeResponse>;
  wallClockSeconds: number;
  peakResidentBytes: number | null;
  capability: unknown;
}> {
  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${String(port)}`;
  const args = [
    "--model",
    modelPath,
    "--threads",
    String(threads),
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--language",
    "auto",
    "--suppress-nst",
    "--vad",
    "--vad-model",
    vadModelPath,
    "--vad-threshold",
    "0.35",
    "--vad-min-speech-duration-ms",
    "100",
    "--vad-min-silence-duration-ms",
    "150",
    "--vad-max-speech-duration-s",
    "30",
    "--vad-speech-pad-ms",
    "250",
    "--vad-samples-overlap",
    "0.25",
  ];
  const child = spawn(input.binary, args, {
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk: Buffer) => process.stderr.write(chunk));
  child.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk));
  const started = performance.now();
  try {
    await waitForHealth(baseUrl, child);
    let peakResidentBytes = await residentBytes(child.pid);
    let capability: unknown = null;
    if (input.patched) {
      const response = await fetch(`${baseUrl}/mvl/capabilities`, {
        signal: AbortSignal.timeout(2_000),
      });
      capability = mvlWhisperServerCapabilitiesSchema.parse(
        (await response.json()) as unknown,
      );
    }
    const responses = new Map<string, RuntimeResponse>();
    for (const request of requests) {
      const vad = vadConfig(request.profile);
      const requestStarted = performance.now();
      const form = new FormData();
      form.append(
        "file",
        new Blob([await readFile(request.audioPath)], { type: "audio/wav" }),
        path.basename(request.audioPath),
      );
      form.append(
        "response_format",
        input.patched ? "mvl_verbose_json_v1" : "verbose_json",
      );
      form.append("language", "ja");
      form.append("no_language_probabilities", "true");
      form.append("suppress_nst", "true");
      form.append("vad", vad.useVad ? "true" : "false");
      form.append("token_timestamps", "true");
      form.append("max_len", "64");
      form.append("split_on_word", "true");
      if (vad.useVad) {
        form.append("vad_threshold", vad.threshold);
        form.append("vad_min_speech_duration_ms", vad.minimumSpeechMs);
        form.append("vad_min_silence_duration_ms", vad.minimumSilenceMs);
        form.append("vad_max_speech_duration_s", "30");
        form.append("vad_speech_pad_ms", vad.speechPadMs);
        form.append("vad_samples_overlap", vad.overlap);
      }
      const response = await fetch(`${baseUrl}/inference`, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(60 * 60_000),
      });
      const body = await response.text();
      if (!response.ok) {
        throw new Error(
          `${input.patched ? "patched" : "stock"} inference failed (${String(response.status)}): ${body}`,
        );
      }
      const raw = JSON.parse(body) as unknown;
      if (input.patched) mvlWhisperServerResponseSchema.parse(raw);
      responses.set(`${request.componentId}:${request.profile}`, {
        raw,
        bytes: Buffer.byteLength(body),
        durationSeconds: (performance.now() - requestStarted) / 1000,
      });
      const currentResidentBytes = await residentBytes(child.pid);
      if (currentResidentBytes !== null) {
        peakResidentBytes = Math.max(
          peakResidentBytes ?? 0,
          currentResidentBytes,
        );
      }
    }
    return {
      responses,
      wallClockSeconds: (performance.now() - started) / 1000,
      peakResidentBytes,
      capability,
    };
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 500));
      child.kill("SIGKILL");
    }
  }
}

function stockView(value: unknown) {
  const response = value as {
    text?: unknown;
    language?: unknown;
    segments?: unknown;
  };
  const segments = Array.isArray(response.segments) ? response.segments : [];
  return {
    text: typeof response.text === "string" ? response.text : "",
    language: typeof response.language === "string" ? response.language : "",
    segments: segments.flatMap((raw) => {
      if (typeof raw !== "object" || raw === null) return [];
      const segment = raw as {
        text?: unknown;
        start?: unknown;
        end?: unknown;
        words?: unknown;
      };
      return [
        {
          text: typeof segment.text === "string" ? segment.text : "",
          start: typeof segment.start === "number" ? segment.start : null,
          end: typeof segment.end === "number" ? segment.end : null,
          words: Array.isArray(segment.words)
            ? segment.words.flatMap((word) => {
                if (typeof word !== "object" || word === null) return [];
                const item = word as {
                  word?: unknown;
                  start?: unknown;
                  end?: unknown;
                };
                return [
                  {
                    text: typeof item.word === "string" ? item.word : "",
                    start: typeof item.start === "number" ? item.start : null,
                    end: typeof item.end === "number" ? item.end : null,
                  },
                ];
              })
            : [],
        },
      ];
    }),
  };
}

function patchedView(value: unknown) {
  const response = mvlWhisperServerResponseSchema.parse(value);
  return {
    text: response.text,
    language: response.language,
    segments: response.transcription.map((segment) => ({
      text: segment.text,
      start: segment.startSeconds,
      end: segment.endSeconds,
      words: segment.words.map((word) => ({
        text: word.word,
        start:
          word.rawStartCentiseconds === null
            ? null
            : word.rawStartCentiseconds * 0.01,
        end:
          word.rawEndCentiseconds === null
            ? null
            : word.rawEndCentiseconds * 0.01,
      })),
    })),
    mappedTokenCount: response.transcription.reduce(
      (sum, segment) =>
        sum + segment.tokens.filter((token) => token.mapped !== null).length,
      0,
    ),
    rawVadIntervalCount: response.vad_segments.length,
    request: response.request,
  };
}

function normalizeText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function hash(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

const stockRun = await runRuntime({ binary: stockServer, patched: false });
const patchedRun = await runRuntime({ binary: patchedServer, patched: true });
const pairs = requests.map((request) => {
  const key = `${request.componentId}:${request.profile}`;
  const stock = stockRun.responses.get(key);
  const patched = patchedRun.responses.get(key);
  if (stock === undefined || patched === undefined) {
    throw new Error(`Missing A/B response pair: ${key}`);
  }
  const stockParsed = stockView(stock.raw);
  const patchedParsed = patchedView(patched.raw);
  const stockText = normalizeText(stockParsed.text);
  const patchedText = normalizeText(patchedParsed.text);
  const stockSegments = stockParsed.segments.map(({ text, start, end }) => ({
    text: normalizeText(text),
    start,
    end,
  }));
  const patchedSegments = patchedParsed.segments.map(
    ({ text, start, end }) => ({
      text: normalizeText(text),
      start,
      end,
    }),
  );
  const stockWords = stockParsed.segments.flatMap((segment) => segment.words);
  const patchedWords = patchedParsed.segments.flatMap(
    (segment) => segment.words,
  );
  const textEqual = stockText === patchedText;
  const segmentsEqual =
    stableJson(stockSegments) === stableJson(patchedSegments);
  const rawTokensComparable =
    stableJson(stockWords) === stableJson(patchedWords);
  const languageEqual = stockParsed.language === patchedParsed.language;
  const requestConfiguration = {
    profile: request.profile,
    language: "ja",
    tokenTimestamps: true,
    maxLen: 64,
    splitOnWord: true,
    suppressNst: true,
    prompt: null,
    vad: vadConfig(request.profile),
  };
  const requestConfigurationEqual =
    patchedParsed.request.language === "ja" &&
    !patchedParsed.request.translate &&
    patchedParsed.request.vad === requestConfiguration.vad.useVad &&
    patchedParsed.request.token_timestamps &&
    patchedParsed.request.suppress_nst &&
    patchedParsed.request.max_len === 64 &&
    patchedParsed.request.split_on_word;
  const promptEqual = !patchedParsed.request.prompt_present;
  return {
    componentId: request.componentId,
    profile: request.profile,
    audioSha256: request.audioSha256,
    requestConfigHash: hash(requestConfiguration),
    stockTextHash: hash(stockText),
    patchedTextHash: hash(patchedText),
    textEqual,
    stockSegmentHash: hash(stockSegments),
    patchedSegmentHash: hash(patchedSegments),
    segmentsEqual,
    stockRawTokenHash: hash(stockWords),
    patchedRawTokenHash: hash(patchedWords),
    rawTokensComparable,
    languageEqual,
    requestConfigurationEqual,
    promptEqual,
    patchedMappedTokenCount: patchedParsed.mappedTokenCount,
    patchedRawVadIntervalCount: patchedParsed.rawVadIntervalCount,
    stockResponseBytes: stock.bytes,
    patchedResponseBytes: patched.bytes,
    stockDurationSeconds: stock.durationSeconds,
    patchedDurationSeconds: patched.durationSeconds,
    failures: [
      ...(!textEqual ? ["TRANSCRIPTION_TEXT_MISMATCH"] : []),
      ...(!segmentsEqual ? ["DECODED_SEGMENT_MISMATCH"] : []),
      ...(!rawTokensComparable ? ["RAW_GROUPED_TOKEN_MISMATCH"] : []),
      ...(!languageEqual ? ["LANGUAGE_MISMATCH"] : []),
      ...(!requestConfigurationEqual ? ["REQUEST_CONFIGURATION_MISMATCH"] : []),
      ...(!promptEqual ? ["PROMPT_CONFIGURATION_MISMATCH"] : []),
    ],
  };
});

const perProfile = profiles.map((profile) => {
  const selected = pairs.filter((pair) => pair.profile === profile);
  return {
    profile,
    pairCount: selected.length,
    textParityCount: selected.filter((pair) => pair.textEqual).length,
    segmentParityCount: selected.filter((pair) => pair.segmentsEqual).length,
    rawTokenParityCount: selected.filter((pair) => pair.rawTokensComparable)
      .length,
    languageParityCount: selected.filter((pair) => pair.languageEqual).length,
    patchedMappedTokenCount: selected.reduce(
      (sum, pair) => sum + pair.patchedMappedTokenCount,
      0,
    ),
    patchedRawVadIntervalCount: selected.reduce(
      (sum, pair) => sum + pair.patchedRawVadIntervalCount,
      0,
    ),
  };
});
const patchedMappedTokenCount = pairs.reduce(
  (sum, pair) => sum + pair.patchedMappedTokenCount,
  0,
);
const patchedRawVadIntervalCount = pairs.reduce(
  (sum, pair) => sum + pair.patchedRawVadIntervalCount,
  0,
);
const failures = [
  ...new Set(pairs.flatMap((pair) => pair.failures)),
].toSorted();
if (patchedMappedTokenCount === 0)
  failures.push("PATCHED_MAPPED_TOKEN_COUNT_ZERO");
if (patchedRawVadIntervalCount === 0)
  failures.push("PATCHED_RAW_VAD_COUNT_ZERO");
const artifact = c516StockPatchedRuntimeAbArtifactSchema.parse({
  schemaVersion: "1.0.0",
  artifactType: "c5-16-stock-patched-runtime-ab",
  generatedAt: new Date().toISOString(),
  upstream: {
    repository: buildManifest.upstream.repository,
    tag: buildManifest.upstream.tag,
    commit: buildManifest.upstream.commit,
    sourceTree: buildManifest.upstream.sourceTree,
  },
  build: {
    buildIdentityHash: sha256Bytes(
      stableJson({
        upstream: buildManifest.upstream,
        build: buildManifest.build,
      }),
    ),
    buildFlagsHash: buildManifest.build.flagsHash,
    stockBinarySha256: stockSha256,
    patchedBinarySha256: patchedSha256,
    patchSha256: buildManifest.patch.patchSha256,
    sameSource: true,
    sameBuildConfiguration: buildManifest.build.stockPatchedSameConfiguration,
  },
  modelSha256: await sha256LocalFile(modelPath),
  vadModelSha256: await sha256LocalFile(vadModelPath),
  requestPairs: pairs,
  perProfile,
  summary: {
    pairCount: pairs.length,
    freshRequestCount: pairs.length * 2,
    textParityPassed: pairs.every((pair) => pair.textEqual),
    segmentParityPassed: pairs.every((pair) => pair.segmentsEqual),
    rawTokenParityPassed: pairs.every((pair) => pair.rawTokensComparable),
    languageParityPassed: pairs.every((pair) => pair.languageEqual),
    requestConfigurationParityPassed: pairs.every(
      (pair) => pair.requestConfigurationEqual,
    ),
    promptParityPassed: pairs.every((pair) => pair.promptEqual),
    stockMappedTokenCount: 0,
    patchedMappedTokenCount,
    stockRawVadIntervalCount: 0,
    patchedRawVadIntervalCount,
    stockWallClockSeconds: stockRun.wallClockSeconds,
    patchedWallClockSeconds: patchedRun.wallClockSeconds,
    stockWorkerStartCount: 1,
    patchedWorkerStartCount: 1,
    stockModelLoadCount: 1,
    patchedModelLoadCount: 1,
    stockPeakResidentBytes: stockRun.peakResidentBytes,
    patchedPeakResidentBytes: patchedRun.peakResidentBytes,
    stockResponseBytes: pairs.reduce(
      (sum, pair) => sum + pair.stockResponseBytes,
      0,
    ),
    patchedResponseBytes: pairs.reduce(
      (sum, pair) => sum + pair.patchedResponseBytes,
      0,
    ),
    accepted: failures.length === 0,
    failures,
  },
});
const outputPath = await collisionSafeOutput();
await atomicWriteJson(outputPath, artifact, { overwrite: false });
process.stdout.write(
  `${JSON.stringify({ ok: artifact.summary.accepted, outputPath, summary: artifact.summary }, null, 2)}\n`,
);
if (!artifact.summary.accepted) process.exitCode = 1;
