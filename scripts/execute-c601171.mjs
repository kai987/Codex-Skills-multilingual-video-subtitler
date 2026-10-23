// Model process: exact allowlisted machine inputs only; no reference manifest.
import fs from "node:fs";
import path from "node:path";
import { NodeProcessRunner } from "../packages/shared/dist/index.js";
import { WhisperCppTranscriptionAdapter } from "../packages/transcription-core/dist/index.js";
import { freshMatchedEvidenceSchema } from "../packages/video-subtitler/dist/machine-quality/matched-replay.js";
import {
  generationManifestSchema,
  reserveCompleteAttempt,
} from "../packages/video-subtitler/dist/machine-quality/reference-complete.js";
import { read, write, hash, oh, verify, childEnv } from "./c60117-common.mjs";
const [root] = process.argv.slice(2);
verify(root, "model-input-freeze.json");
const manifest = generationManifestSchema.parse(
    read(path.join(root, "dataset/generation-manifest.json")),
  ),
  gate = read(path.join(root, "dataset/model-gate.json")),
  fixed = read(path.join(root, "frozen-repair-identity.json")),
  runtime = read(path.join(root, "runtime.local-only.json"));
if (
  gate.status !== "DATA_READY_FOR_FROZEN_REPAIR_CHECK" ||
  gate.generationManifestHash !== oh(manifest) ||
  gate.frozenRepairHash !== manifest.frozenRepairHash ||
  (await hash(path.join(root, "frozen-repair-identity.json"))) !==
    gate.frozenRepairHash
)
  throw Error("DATA_PREFLIGHT_FAILED_OR_HASH_MISMATCH");
if (
  (await hash(runtime.whisper)) !== fixed.model.binaryHash ||
  (await hash(runtime.whisperModel)) !== fixed.model.modelHash
)
  throw Error("Runtime drift");
const attemptDir = path.join(root, "attempts");
fs.mkdirSync(attemptDir, { recursive: true });
let prior = fs
  .readdirSync(attemptDir)
  .filter((f) => f.endsWith(".reserved.json"))
  .map((f) => read(path.join(attemptDir, f)));
const retryAuthorized = process.argv[3] === "--retry-execution-failure";
if (prior.length && !retryAuthorized)
  throw Error("Existing attempts: no implicit retries or rerun");
if (!prior.length)
  write(path.join(root, "model-execution-start.json"), {
    startedAt: new Date().toISOString(),
    preflightHash: gate.preflightHash,
    generationReferenceReads: 0,
    aux: "NOT_RERUN_THIS_EXPERIMENT",
  });
for (const u of manifest.units) {
  const key = {
      audioHash: u.audioHash,
      sampleCount: u.sampleCount,
      model: fixed.model,
      preprocessing: "mono PCM16 16k",
      prompt: "",
      timebase: "clip-local",
    },
    cacheKey = oh(key);
  if (fs.existsSync(path.join(root, "evidence", u.id + ".json")))
    throw Error("Completed evidence cannot be implicitly rerun");
  const history = prior.filter((r) => r.unitId === u.id),
    retry = history.length > 0;
  if (
    retry &&
    (!retryAuthorized ||
      history.some((r) => r.cacheKey !== cacheKey) ||
      !fs.existsSync(path.join(attemptDir, u.id + ".failure.json")))
  )
    throw Error("Unreconciled prior attempt");
  const attemptId = u.id + (retry ? "-retry-" + history.length : "");
  const reserved = {
    ...reserveCompleteAttempt(prior, 30, retry, retry),
    unitId: u.id,
    cacheKey,
    physicalSeconds: u.seconds,
    startedAt: new Date().toISOString(),
  };
  write(path.join(attemptDir, attemptId + ".reserved.json"), reserved);
  prior = [...prior, reserved];
  console.log("START " + u.id);
  const begin = Date.now();
  try {
    const runner = {
      run: async (exe, args, opts) => {
        if (args.some((a) => ["--prompt", "--vad", "--translate"].includes(a)))
          throw Error("Prompt/VAD forbidden");
        const actual = [
          ...args,
          "--max-context",
          "0",
          "--temperature",
          "0",
          "--no-fallback",
          "--beam-size",
          "5",
          "--best-of",
          "5",
        ];
        write(path.join(attemptDir, attemptId + ".args.json"), {
          args: actual,
          binaryHash: fixed.model.binaryHash,
        });
        const result = await new NodeProcessRunner().run(exe, actual, {
          ...opts,
          allowNonZero: true,
          environment: childEnv,
        });
        write(path.join(attemptDir, attemptId + ".process.json"), result);
        const prefix = args[args.indexOf("--output-file") + 1];
        for (const ext of ["json", "srt"])
          if (fs.existsSync(prefix + "." + ext))
            fs.copyFileSync(
              prefix + "." + ext,
              path.join(attemptDir, attemptId + ".raw." + ext),
              fs.constants.COPYFILE_EXCL,
            );
        if (result.exitCode !== 0) throw Error("Whisper execution failed");
        return result;
      },
    };
    const adapter = new WhisperCppTranscriptionAdapter({
      executablePath: runtime.whisper,
      modelPath: runtime.whisperModel,
      runner,
      threads: 8,
      useVad: false,
      coreML: false,
      fullJsonAvailable: true,
      tokenTimestampsAvailable: true,
    });
    const raw = await adapter.transcribe({
      audioPath: path.join(root, u.audio),
      chunk: {
        id: u.id,
        start: 0,
        end: u.seconds,
        duration: u.seconds,
        path: u.audio,
      },
      language: "ja",
      timestampStrategy: "segment",
      tokenTimestamps: true,
    });
    const evidenceFile = path.join(root, "evidence", u.id + ".json");
    write(evidenceFile, {
      cacheKey,
      key,
      raw,
      rawHash: oh(raw),
      execution: "FRESH",
      wallSeconds: (Date.now() - begin) / 1000,
    });
    const e = freshMatchedEvidenceSchema.parse({
      version: "c60117-fresh-primary-v1",
      partition: "development-known",
      promptStatus: "FRESH_PROMPT_FREE",
      source: {
        sha256: u.audioHash,
        durationSeconds: u.seconds,
        audioStream: 0,
        sourceSampleRate: 16000,
        mediaStart: 0,
        fileName: "source-media",
      },
      primaryRequests: [
        {
          id: u.id,
          cacheKey,
          cacheFileHash: await hash(evidenceFile),
          audioHash: u.audioHash,
          resultHash: oh(raw),
          modelHash: fixed.model.modelHash,
          model: "large-v3",
          runtime: oh(fixed.model),
          tokenizer: "embedded-in-model",
          promptHash: oh(""),
          decodeHash: oh(fixed.model.decode),
          sampleRate: 16000,
          interval: { start: 0, end: u.seconds },
          timebase: "original-audio-local",
          vadEnabled: false,
          segments: raw.segments.map((s, i) => ({
            id: u.id + "-s" + i,
            start: s.start,
            end: s.end,
            text: s.text,
          })),
        },
      ],
    });
    write(path.join(root, "generator-input", u.id + ".json"), e);
    console.log(
      "DONE " + u.id + " " + ((Date.now() - begin) / 1000).toFixed(1) + "s",
    );
  } catch (error) {
    write(path.join(attemptDir, attemptId + ".failure.json"), {
      error: String(error),
      automaticRetry: false,
      wallSeconds: (Date.now() - begin) / 1000,
    });
    throw error;
  }
}
const processes = fs
  .readdirSync(attemptDir)
  .filter((f) => f.endsWith(".process.json"));
write(path.join(root, "model-execution-summary.json"), {
  logicalRequests: manifest.units.length,
  attempts: prior.length,
  acousticForwards: processes.length,
  modelLoads: processes.length,
  providerProcessStarts: processes.length,
  failures: fs
    .readdirSync(attemptDir)
    .filter((f) => f.endsWith(".failure.json")).length,
  retries: prior.filter((r) => r.retry).length,
  cacheHits: 0,
  physicalSeconds: manifest.units.reduce((n, u) => n + u.seconds, 0),
  chargedInputSeconds: prior.length * 30,
  reazonInference: 0,
  otherModels: 0,
  generationReferenceReads: 0,
  completedAt: new Date().toISOString(),
});
