import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  buildPortableAsrCacheIdentityV2,
  PortableAsrCache,
  WhisperCppWorkerPool,
  type TranscriptionChunkResult,
} from "@mvl/transcription-core";
import {
  asrCacheManifestArtifactSchema,
  atomicWriteJson,
  coverageRecoveryPlanArtifactSchema,
  NodeProcessRunner,
  pathExists,
  portableTranscriptionChunkResultSchema,
  type CoverageRecoveryPlanArtifact,
} from "@mvl/shared";

const C4_ROOT = path.resolve(
  "output/carnation-reference-guided-c4-cached-20260801",
);
const SOURCE_AUDIO = path.resolve(
  "output/carnation-reference-guided-c2-uncached-20260730/audio/full-audio.mp3",
);
const WHISPER =
  "/Users/paulasmith/.cache/multilingual-video-subtitler/whisper.cpp-v1.9.1-coreml/build-coreml/bin/whisper-cli";
const MODEL = "/Users/paulasmith/.cache/whisper.cpp/ggml-large-v3.bin";
const VAD_MODEL = "/Users/paulasmith/.cache/whisper.cpp/ggml-silero-v6.2.0.bin";
const AUDIO_DIRECTORY = path.join(C4_ROOT, "coverage-targeted-asr");
const RESULT_PATH = path.join(C4_ROOT, "coverage-targeted-asr-results.json");

async function sha256File(filePath: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    digest.update(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return digest.digest("hex");
}

async function findSubtitleDirectory(): Promise<string> {
  const { readdir } = await import("node:fs/promises");
  const name = (await readdir(C4_ROOT)).find((entry) =>
    entry.startsWith("subtitle-"),
  );
  if (name === undefined) throw new Error("C4 subtitle directory is missing");
  return path.join(C4_ROOT, name);
}

interface Profile {
  id: string;
  useVad: boolean;
  vadProfile: "sensitive-v2" | "extra-sensitive-v1";
}

function profilesFor(
  route: CoverageRecoveryPlanArtifact["units"][number]["route"],
): Profile[] {
  if (route === "vad-and-no-vad") {
    return [
      { id: "sensitive-vad", useVad: true, vadProfile: "sensitive-v2" },
      { id: "no-vad", useVad: false, vadProfile: "sensitive-v2" },
    ];
  }
  if (route === "extra-sensitive-vad") {
    return [
      {
        id: "extra-sensitive-vad",
        useVad: true,
        vadProfile: "extra-sensitive-v1",
      },
    ];
  }
  if (route === "sensitive-vad") {
    return [{ id: "sensitive-vad", useVad: true, vadProfile: "sensitive-v2" }];
  }
  return [{ id: "no-vad", useVad: false, vadProfile: "sensitive-v2" }];
}

function normalized(text: string): string {
  return text.normalize("NFKC").replace(/[\s、。，．,.!?！？…♪]/gu, "");
}

function repeatedPhrase(text: string): boolean {
  const value = normalized(text);
  if (value.length < 12) return false;
  for (let length = 4; length <= Math.floor(value.length / 3); length += 1) {
    const phrase = value.slice(0, length);
    if (value.split(phrase).length - 1 >= 3) return true;
  }
  return false;
}

function acceptableSegment(
  segment: TranscriptionChunkResult["segments"][number],
): { accepted: boolean; reasons: string[]; confidence: number } {
  const text = segment.text.trim();
  const characters = Array.from(normalized(text));
  const japanese = characters.filter((character) =>
    /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(character),
  ).length;
  const japaneseRatio =
    characters.length === 0 ? 0 : japanese / characters.length;
  const boilerplate =
    /(?:ご視聴|チャンネル登録|字幕|この動画|ありがとうございました|地下鉄|撮影現場|MBC)/u.test(
      text,
    );
  const tokenProbabilities = (segment.tokens ?? []).flatMap((token) =>
    token.probability === undefined || token.probability === null
      ? []
      : [token.probability],
  );
  const confidence =
    segment.confidence ??
    segment.metrics?.tokenProbability ??
    (tokenProbabilities.length === 0
      ? 0.65
      : tokenProbabilities.reduce((sum, value) => sum + value, 0) /
        tokenProbabilities.length);
  const reasons = [
    `japanese-ratio:${japaneseRatio.toFixed(3)}`,
    `confidence:${confidence.toFixed(3)}`,
    ...(boilerplate ? ["known-boilerplate-hallucination"] : []),
    ...(repeatedPhrase(text) ? ["repeated-phrase-hallucination"] : []),
    ...(text === "" ? ["empty-text"] : []),
  ];
  return {
    accepted:
      text !== "" &&
      japaneseRatio >= 0.35 &&
      confidence >= 0.45 &&
      !boilerplate &&
      !repeatedPhrase(text) &&
      segment.end - segment.start >= 0.12,
    reasons,
    confidence,
  };
}

const subtitleDirectory = await findSubtitleDirectory();
const plan = coverageRecoveryPlanArtifactSchema.parse(
  JSON.parse(
    await readFile(
      path.join(subtitleDirectory, "coverage-recovery-plan.json"),
      "utf8",
    ),
  ),
);
const units = plan.units.filter((unit) => unit.shouldRunAsr);
const runner = new NodeProcessRunner();
const pool = new WhisperCppWorkerPool({ mode: "persistent" });
const cache = new PortableAsrCache({
  taskLocalRoot: path.join(C4_ROOT, "asr-cache-v2"),
  importRoots: [
    C4_ROOT,
    path.resolve("output/carnation-reference-guided-c3-cached-20260801"),
    path.resolve("output/carnation-reference-guided-c2-uncached-20260730"),
  ],
  mode: "read-write",
  migrateLegacy: true,
  sourceOutputDirectory: C4_ROOT,
});
const modelHash = await sha256File(MODEL);
await mkdir(AUDIO_DIRECTORY, { recursive: true });
interface RecoveryWindow {
  unitId: string;
  referenceAnchorIds: string[];
  requestIds: string[];
  cacheHitCount: number;
  accepted: boolean;
  reasons: string[];
  segments: {
    id: string;
    requestId: string;
    profileId: string;
    start: number;
    end: number;
    text: string;
    confidence: number | null;
    tokens?: {
      text: string;
      start: number;
      end: number;
      probability?: number | null;
    }[];
  }[];
}

interface RecoveryRun {
  round: number;
  sourcePlanHash: string;
  windows: RecoveryWindow[];
  execution: ReturnType<WhisperCppWorkerPool["metrics"]>;
}

const previousResult = (await pathExists(RESULT_PATH))
  ? (JSON.parse(await readFile(RESULT_PATH, "utf8")) as {
      sourcePlanHash: string;
      windows: RecoveryWindow[];
      execution: ReturnType<WhisperCppWorkerPool["metrics"]>;
      runs?: RecoveryRun[];
    })
  : null;
let priorRuns: RecoveryRun[] =
  previousResult?.runs ??
  (previousResult === null
    ? []
    : [
        {
          round: 1,
          sourcePlanHash: previousResult.sourcePlanHash,
          windows: previousResult.windows,
          execution: previousResult.execution,
        },
      ]);
if (priorRuns.at(-1)?.sourcePlanHash === plan.inputHash) {
  priorRuns = priorRuns.slice(0, -1);
}
const currentRound = units[0]?.round ?? Math.min(2, priorRuns.length + 1);
const windows: RecoveryWindow[] = [];

try {
  for (const unit of units) {
    const clipPath = path.join(AUDIO_DIRECTORY, `${unit.id}.wav`);
    await runner.run("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-ss",
      String(unit.interval.start),
      "-t",
      String(unit.interval.end - unit.interval.start),
      "-i",
      SOURCE_AUDIO,
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      clipPath,
    ]);
    const audioHash = await sha256File(clipPath);
    const windowSegments: RecoveryWindow["segments"] = [];
    const requestIds: string[] = [];
    const reasons: string[] = [];
    let cacheHitCount = 0;
    for (const profile of profilesFor(unit.route)) {
      const requestId = `${unit.id}:${profile.id}`;
      requestIds.push(requestId);
      const prompt =
        "Transcribe only Japanese speech audibly present in this short clip. Do not translate. Do not invent speech for noise, silence, music, or crowd sounds.";
      const identity = buildPortableAsrCacheIdentityV2({
        audioContentSha256: audioHash,
        interval: unit.interval,
        sampleRate: 16_000,
        channels: 1,
        codec: "pcm_s16le",
        adapterId: "whisper.cpp-large-v3-coreml-coverage-recovery",
        model: MODEL,
        modelHash,
        modelFamily: "large-v3",
        coreML: true,
        whisperCppVersion: "1.9.1",
        language: "ja",
        vadMode: profile.useVad ? profile.vadProfile : "no-vad",
        timestampStrategy: "segment",
        tokenTimestamps: true,
        prompt,
        decodeConfiguration: {
          language: "ja",
          vad: profile.useVad,
          vadProfile: profile.vadProfile,
          tokenTimestamps: true,
          timestampStrategy: "segment",
        },
      });
      const lookup = await cache.lookup({
        requestId,
        requestType: "coverage-recovery",
        identity,
      });
      let result: TranscriptionChunkResult;
      if (lookup.hit && lookup.result !== null) {
        result = lookup.result;
        cacheHitCount += 1;
        pool.recordCacheHits(1);
      } else {
        result = await pool.transcribe({
          request: {
            audioPath: clipPath,
            chunk: {
              id: requestId,
              relativePath: path.relative(C4_ROOT, clipPath),
              start: unit.interval.start,
              end: unit.interval.end,
              duration: unit.interval.end - unit.interval.start,
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
          initialPrompt: prompt,
          processFallback: () => {
            throw new Error("Persistent Core ML worker fallback is disabled");
          },
        });
        await cache.store({
          requestId,
          requestType: "coverage-recovery",
          identity,
          result: portableTranscriptionChunkResultSchema.parse(result),
        });
      }
      for (const [index, segment] of result.segments.entries()) {
        const acceptance = acceptableSegment(segment);
        reasons.push(
          `${requestId}:segment-${String(index + 1).padStart(3, "0")}:${acceptance.accepted ? "accepted" : "rejected"}:${acceptance.reasons.join("|")}`,
        );
        if (!acceptance.accepted) continue;
        windowSegments.push({
          id: `c4-coverage-recovery:${requestId}:segment-${String(index + 1).padStart(4, "0")}`,
          requestId,
          profileId: profile.id,
          start: unit.interval.start + segment.start,
          end: unit.interval.start + segment.end,
          text: segment.text,
          confidence: acceptance.confidence,
          ...(segment.tokens === undefined
            ? {}
            : {
                tokens: segment.tokens.map((token) => ({
                  text: token.text,
                  start: unit.interval.start + token.start,
                  end: unit.interval.start + token.end,
                  ...(token.probability === undefined
                    ? {}
                    : { probability: token.probability }),
                })),
              }),
        });
      }
    }
    windows.push({
      unitId: unit.id,
      referenceAnchorIds: unit.anchorIds,
      requestIds,
      cacheHitCount,
      accepted: windowSegments.length > 0,
      reasons: reasons.length === 0 ? ["no-audible-japanese-segment"] : reasons,
      segments: windowSegments,
    });
    const currentExecution = pool.metrics();
    await atomicWriteJson(
      RESULT_PATH,
      {
        schemaVersion: "1.0.0",
        sourcePlanHash: plan.inputHash,
        coreMLRequired: true,
        persistentWorkerRequired: true,
        referenceTextUsedAsPrompt: false,
        windows,
        execution: currentExecution,
        runs: [
          ...priorRuns,
          {
            round: currentRound,
            sourcePlanHash: plan.inputHash,
            windows,
            execution: currentExecution,
          },
        ],
      },
      { overwrite: true },
    );
  }
} finally {
  await pool.close();
}

const execution = pool.metrics();
await Promise.all([
  atomicWriteJson(
    RESULT_PATH,
    {
      schemaVersion: "1.0.0",
      sourcePlanHash: plan.inputHash,
      coreMLRequired: true,
      persistentWorkerRequired: true,
      referenceTextUsedAsPrompt: false,
      windows,
      execution,
      runs: [
        ...priorRuns,
        {
          round: currentRound,
          sourcePlanHash: plan.inputHash,
          windows,
          execution,
        },
      ],
    },
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(subtitleDirectory, "asr-cache-manifest.json"),
    asrCacheManifestArtifactSchema.parse(cache.manifest()),
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(subtitleDirectory, "asr-cache-migration.json"),
    cache.migrationArtifact(),
    { overwrite: true },
  ),
  atomicWriteJson(
    path.join(subtitleDirectory, "coverage-targeted-whisper-metrics.json"),
    execution,
    { overwrite: true },
  ),
]);

console.log(
  JSON.stringify(
    {
      plannedUnitCount: units.length,
      completedUnitCount: windows.length,
      acceptedWindowCount: windows.filter((window) => window.accepted).length,
      acceptedSegmentCount: windows.reduce(
        (sum, window) => sum + window.segments.length,
        0,
      ),
      cache: cache.manifest().summary,
      execution,
    },
    null,
    2,
  ),
);
