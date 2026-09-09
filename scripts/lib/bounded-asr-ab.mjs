import fs from "node:fs/promises";
import { appendFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout, clearTimeout } from "node:timers";
import path from "node:path";
import os from "node:os";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { WhisperCppTranscriptionAdapter } from "../../packages/transcription-core/dist/index.js";
import {
  fileHash,
  atomic,
  manifestSchema,
} from "../../packages/video-subtitler/dist/standalone/tool.js";
import { safePath } from "../../packages/video-subtitler/dist/standalone/recovery.js";
import { digest } from "../../packages/video-subtitler/dist/standalone/assembly.js";
import {
  POLICY,
  chunkSchema,
  planChunks,
  validateChunks,
  silenceFromScores,
  reserveAttempt,
} from "../../packages/video-subtitler/dist/standalone/bounded.js";

export const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const fingerprint = z.object({ path: z.string(), sha256: hash }).strict();
export const experimentSchema = z
  .object({
    version: z.literal("bounded-longform-asr-ab-v1"),
    baseSha: z.string().regex(/^[a-f0-9]{40}$/u),
    createdAt: z.string(),
    state: z.enum(["prepared", "frozen", "blocked"]),
    blocker: z.string().nullable(),
    policy: z
      .object(
        Object.fromEntries(
          Object.entries(POLICY).map(([k, v]) => [k, z.literal(v)]),
        ),
      )
      .strict(),
    policyHash: hash,
    baseline: z
      .object({
        task: fingerprint,
        raw: fingerprint,
        audio: fingerprint,
        historicalPlan: fingerprint,
        attemptLog: fingerprint,
        source: fingerprint,
        model: fingerprint,
        runtime: fingerprint,
      })
      .strict(),
    vadRuntime: z
      .object({
        model: fingerprint,
        library: fingerprint,
        python: fingerprint,
        script: fingerprint,
        adapter: fingerprint,
      })
      .strict(),
    software: z.array(fingerprint),
    pcm: z
      .object({
        sampleRate: z.number().int().positive(),
        frames: z.number().int().positive(),
        pcmHash: hash,
        blockAlign: z.literal(2),
      })
      .strict(),
    audioOffset: z.number().nonnegative(),
    sourceEnd: z.number().positive(),
    language: z.enum(["ja", "en", "zh"]),
    threads: z.number().int().positive(),
    decode: z
      .object({
        optionsText: z.string(),
        prompt: z.null(),
        vad: z.literal(false),
        coreML: z.literal(false),
        suppressNst: z.literal(true),
        timestamp: z.literal("segment"),
        requestIsolation: z.literal("independent-cli-process"),
        hardware: z.string(),
        historicalEffectiveParameters: z.string(),
        confounds: z.array(z.string()),
      })
      .strict(),
    vadProfile: z
      .object({
        threshold: z.literal(0.5),
        minSpeechMs: z.literal(250),
        minSilenceMs: z.literal(100),
        maxSpeechSeconds: z.literal(9000),
        speechPadMs: z.literal(0),
        samplesOverlap: z.literal(0),
      })
      .strict(),
    vadHash: hash.nullable(),
    chunks: z.array(chunkSchema),
    chunkPcmHashes: z.array(
      z.object({ id: z.string(), sha256: hash }).strict(),
    ),
    planHash: hash.nullable(),
    manualReview: z.array(
      z
        .object({
          kind: z.enum(["stratified", "seam"]),
          start: z.number(),
          end: z.number(),
          status: z.literal("NOT_PERFORMED"),
        })
        .strict(),
    ),
    qualityStatus: z.literal("needs-review"),
    finalizationMethod: z.literal("none"),
    humanValidated: z.literal(false),
    machineOnlyReleaseAuthorized: z.literal(false),
  })
  .strict();
const json = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const now = () => new Date().toISOString();
const fp = async (p) => ({ path: path.resolve(p), sha256: await fileHash(p) });
export async function durable(p, value, exclusive = false) {
  if (exclusive) {
    const handle = await fs.open(p, "wx");
    try {
      await handle.writeFile(JSON.stringify(value) + "\n");
      await handle.sync();
    } finally {
      await handle.close();
    }
  } else {
    await atomic(p, value);
    const h = await fs.open(p, "r");
    try {
      await h.sync();
    } finally {
      await h.close();
    }
  }
  const d = await fs.open(path.dirname(p), "r");
  try {
    await d.sync();
  } finally {
    await d.close();
  }
}
export function readPcm(bytes) {
  if (
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WAVE" ||
    bytes.readUInt32LE(4) + 8 !== bytes.length
  )
    throw Error("INVALID_RIFF_SIZE");
  let fmt, data;
  for (let p = 12; p + 8 <= bytes.length;) {
    const kind = bytes.toString("ascii", p, p + 4),
      n = bytes.readUInt32LE(p + 4),
      start = p + 8;
    if (start + n > bytes.length) throw Error("TRUNCATED_WAV");
    if (kind === "fmt ") {
      if (fmt || n < 16) throw Error("INVALID_WAV_FORMAT");
      fmt = bytes.subarray(start, start + n);
    }
    if (kind === "data") {
      if (data) throw Error("MULTIPLE_PCM_STREAMS");
      data = bytes.subarray(start, start + n);
    }
    p = start + n + (n % 2);
  }
  if (
    !fmt ||
    !data ||
    fmt.readUInt16LE(0) !== 1 ||
    fmt.readUInt16LE(2) !== 1 ||
    fmt.readUInt16LE(14) !== 16 ||
    fmt.readUInt16LE(12) !== 2 ||
    !data.length ||
    data.length % 2
  )
    throw Error("PCM16_MONO_REQUIRED");
  const sampleRate = fmt.readUInt32LE(4);
  if (!sampleRate || fmt.readUInt32LE(8) !== sampleRate * 2)
    throw Error("INVALID_PCM_RATE");
  return { sampleRate, frames: data.length / 2, data };
}
export function slicePcm(pcm, start, end) {
  if (
    ![start, end].every(Number.isSafeInteger) ||
    start < 0 ||
    end > pcm.frames ||
    end <= start
  )
    throw Error("INVALID_SAMPLE_SLICE");
  const data = pcm.data.subarray(start * 2, end * 2),
    out = Buffer.alloc(44 + data.length);
  out.write("RIFF", 0);
  out.writeUInt32LE(out.length - 8, 4);
  out.write("WAVEfmt ", 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(pcm.sampleRate, 24);
  out.writeUInt32LE(pcm.sampleRate * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write("data", 36);
  out.writeUInt32LE(data.length, 40);
  data.copy(out, 44);
  return out;
}
const contentHash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const scriptNames = [
  "scripts/lib/bounded-asr-ab.mjs",
  "scripts/subtitle-tool-bounded-asr-ab.mjs",
  "packages/video-subtitler/dist/standalone/bounded.js",
  "packages/video-subtitler/dist/standalone/recovery.js",
  "packages/video-subtitler/dist/standalone/assembly.js",
  "packages/transcription-core/dist/local.js",
  "packages/subtitle-core/dist/format.js",
  "packages/subtitle-core/dist/parse.js",
  "packages/subtitle-core/dist/time.js",
  "packages/video-subtitler/dist/standalone/tool.js",
  "package-lock.json",
];
const optionsText = (s) => s.slice(s.indexOf("options:\n")).trim();
function validateManifest(m) {
  if (digest(m.policy) !== digest(POLICY) || m.policyHash !== digest(POLICY))
    throw Error("POLICY_CHANGED");
  return experimentSchema.parse({ ...m, policy: POLICY });
}
export async function verifyFiles(files) {
  for (const f of files)
    if ((await fileHash(f.path)) !== f.sha256)
      throw Error(`IDENTITY_CHANGED:${path.basename(f.path)}`);
}
async function locked(root, action) {
  await safePath(root);
  const lock = path.join(root, ".experiment-lock");
  await durable(lock, { pid: process.pid, at: now() }, true);
  try {
    return await action();
  } finally {
    await fs.unlink(lock);
  }
}
export async function loadExperiment(manifest) {
  await safePath(manifest);
  const m = validateManifest(await json(manifest));
  if (m.state !== "frozen" || m.planHash !== digest({ ...m, planHash: null }))
    throw Error("FROZEN_PLAN_REQUIRED");
  validateChunks(m.chunks, m.pcm.frames, m.pcm.sampleRate);
  if (
    (await fileHash(path.join(path.dirname(manifest), "vad.json"))) !==
    m.vadHash
  )
    throw Error("VAD_CHECKPOINT_CORRUPT");
  return m;
}
export function validateJournal(m, entries) {
  const seen = [];
  for (const e of entries) {
    if (
      ![
        "reserved",
        "process-dispatch",
        "completed",
        "failed",
        "cancelled",
        "run-finished",
      ].includes(e.kind)
    )
      throw Error("UNKNOWN_LEDGER_EVENT");
    if (e.kind === "reserved") {
      const prior = attemptsFrom(seen),
        expected = reserveAttempt(m.chunks, m.pcm.sampleRate, prior, e.chunkId);
      const id = `${e.chunkId}-attempt-${prior.filter((a) => a.chunkId === e.chunkId).length + 1}`;
      if (
        e.id !== id ||
        e.seconds !== expected.seconds ||
        e.planHash !== m.planHash ||
        !hash.safeParse(e.inputHash).success
      )
        throw Error("RESERVATION_BINDING_CHANGED");
    }
    if (e.kind === "completed") {
      const prior = attemptsFrom(seen).find((a) => a.id === e.id);
      if (
        !prior ||
        e.rawPath !== `B/chunks/${prior.chunkId}/${e.id}/raw-response.srt` ||
        !hash.safeParse(e.rawHash).success ||
        e.exitCode !== 0
      )
        throw Error("RAW_CHECKPOINT_BINDING_CHANGED");
    }
    seen.push(e);
  }
  return attemptsFrom(seen);
}
/** One durable reservation per attempt; hash chained, never reset by resume. */
export async function ledger(root) {
  let data;
  try {
    data = await fs.readFile(path.join(root, "requests.jsonl"), "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
  if (data && !data.endsWith("\n"))
    throw Error("PARTIAL_LEDGER_REQUIRES_INSPECTION");
  const entries = data.trim() ? data.trim().split("\n").map(JSON.parse) : [];
  let previous = null;
  for (const e of entries) {
    if (e.previous !== previous || e.hash !== digest({ ...e, hash: null }))
      throw Error("LEDGER_HASH_FAILURE");
    previous = e.hash;
  }
  return entries;
}
async function append(root, event) {
  const entries = await ledger(root),
    e = {
      ...event,
      at: now(),
      previous: entries.at(-1)?.hash ?? null,
      hash: null,
    };
  e.hash = digest(e);
  const h = await fs.open(path.join(root, "requests.jsonl"), "a");
  try {
    await h.writeFile(JSON.stringify(e) + "\n");
    await h.sync();
  } finally {
    await h.close();
  }
  const directoryHandle = await fs.open(root, "r");
  try {
    await directoryHandle.sync();
  } finally {
    await directoryHandle.close();
  }
}
export function attemptsFrom(entries) {
  const attempts = [];
  for (const e of entries) {
    if (e.kind === "reserved") {
      if (attempts.some((a) => a.id === e.id))
        throw Error("DUPLICATE_RESERVATION");
      attempts.push({ ...e, state: "running" });
    } else if (["completed", "failed", "cancelled"].includes(e.kind)) {
      const a = attempts.find((v) => v.id === e.id);
      if (!a || a.state !== "running")
        throw Error("INVALID_ATTEMPT_TRANSITION");
      Object.assign(a, e, { state: e.kind });
    }
  }
  return attempts;
}
export async function plan(o, runner = new EvidenceRunner()) {
  const planStarted = Date.now();
  await safePath(o.outputRoot, true);
  await fs.mkdir(o.outputRoot, { recursive: true });
  const root = await fs.mkdtemp(
    path.join(o.outputRoot, "bounded-longform-asr-ab-"),
  );
  try {
    const taskFile = path.join(o.baselineTask, "task.json"),
      task = manifestSchema.parse(await json(taskFile));
    const historical = await json(o.baselinePlan);
    const baseline = {
      task: await fp(taskFile),
      raw: await fp(path.join(o.baselineTask, "raw-primary.srt")),
      audio: await fp(path.join(o.baselineTask, "audio.wav")),
      historicalPlan: await fp(o.baselinePlan),
      attemptLog: await fp(path.join(o.baselineTask, "attempt-1.log")),
      source: await fp(o.input),
      model: await fp(task.config.model),
      runtime: await fp(task.config.runtime),
    };
    if (
      baseline.raw.sha256 !== task.rawHash ||
      baseline.audio.sha256 !== task.audioHash ||
      baseline.source.sha256 !== task.inputHash ||
      baseline.model.sha256 !== task.modelHash ||
      baseline.runtime.sha256 !== task.runtimeHash ||
      digest(task.config) !== task.configHash ||
      historical.inputHash !== task.inputHash ||
      historical.modelHash !== task.modelHash ||
      historical.runtimeHash !== task.runtimeHash ||
      digest(historical.preflight.config) !== task.configHash ||
      historical.prompt !== null ||
      historical.vad !== false ||
      historical.coreml !== false ||
      task.attempts.length !== 1 ||
      task.attempts[0].state !== "completed"
    )
      throw Error("AB_COMPARISON_BLOCKED_BASELINE_IDENTITY");
    const pcm = readPcm(await fs.readFile(baseline.audio.path));
    if (
      pcm.sampleRate !== 16000 ||
      Math.abs(
        task.attempts[0].reservedAudioSeconds - pcm.frames / pcm.sampleRate,
      ) > 0.000001 ||
      historical.preflight.media.track !== task.track ||
      historical.preflight.media.origin !== task.origin ||
      historical.preflight.media.audioOffset !== task.audioOffset
    )
      throw Error("AB_COMPARISON_BLOCKED_AUDIO_TIMEBASE");
    const helpResult = await runner.run(task.config.runtime, ["--help"]),
      help = helpResult.stdout + helpResult.stderr;
    const historicalHelp = historical.preflight.versions.whisperHelp;
    if (
      !help.includes("options:\n") ||
      optionsText(help) !== optionsText(historicalHelp)
    )
      throw Error("AB_COMPARISON_BLOCKED_RUNTIME_DEFAULTS");
    const hardware = help.match(/GPU name:.*\(([^)]+)\)/u)?.[1];
    if (!hardware || !historicalHelp.includes(hardware))
      throw Error("AB_COMPARISON_BLOCKED_BACKEND");
    const raw = await fs.readFile(baseline.raw.path);
    await fs.mkdir(path.join(root, "A"));
    await fs.writeFile(path.join(root, "A/raw-primary.srt"), raw, {
      flag: "wx",
    });
    await durable(path.join(root, "A/baseline-binding.json"), {
      ...baseline,
      historicalRequests: 1,
      newRequests: 0,
      historicalAttempt: task.attempts[0],
      rawByteIdentityVerified: true,
      invocationProvenance:
        "saved task plus frozen baseline adapter source; argv not separately recorded historically",
    });
    await fs.writeFile(path.join(root, "runtime-help.txt"), help);
    const m = {
      version: "bounded-longform-asr-ab-v1",
      baseSha: o.baseSha,
      createdAt: now(),
      state: "prepared",
      blocker: null,
      policy: POLICY,
      policyHash: digest(POLICY),
      baseline,
      vadRuntime: {
        model: await fp(o.vadModel),
        library: await fp(o.vadLibrary),
        python: await fp(o.python),
        script: await fp(path.join(repo, "scripts/runtime/bounded_silero.py")),
        adapter: await fp(
          path.join(repo, "scripts/runtime/c601141_speech_activity_worker.py"),
        ),
      },
      software: await Promise.all(
        scriptNames.map((n) => fp(path.join(repo, n))),
      ),
      pcm: {
        sampleRate: pcm.sampleRate,
        frames: pcm.frames,
        pcmHash: contentHash(pcm.data),
        blockAlign: 2,
      },
      audioOffset: task.audioOffset,
      sourceEnd: task.audioOffset + pcm.frames / pcm.sampleRate,
      language: task.config.language,
      threads: task.config.threads,
      decode: {
        optionsText: optionsText(help),
        prompt: null,
        vad: false,
        coreML: false,
        suppressNst: true,
        timestamp: "segment",
        requestIsolation: "independent-cli-process",
        hardware,
        historicalEffectiveParameters:
          "Same hashed CLI and identical help defaults plus baseline adapter argv. max-context=-1; best-of=5; beam-size=5; temperature=0; increment=0.2; fallback enabled; flash attention on; processors=1; no prompt/tokens transferred. Internal no_context default unmodified, no invented flag.",
        confounds: [
          "Historical dynamic-library hashes were not recorded; current backend names/versions match saved logs but historical transitive-byte identity cannot be proven.",
          "Single historical A timing is not a controlled repeated performance measurement.",
        ],
      },
      vadProfile: {
        threshold: 0.5,
        minSpeechMs: 250,
        minSilenceMs: 100,
        maxSpeechSeconds: 9000,
        speechPadMs: 0,
        samplesOverlap: 0,
      },
      vadHash: null,
      chunks: [],
      chunkPcmHashes: [],
      planHash: null,
      manualReview: Array.from({ length: 12 }, (_, i) => ({
        kind: "stratified",
        start: Math.max(
          0,
          ((i + 0.5) * pcm.frames) / pcm.sampleRate / 12 - 7.5,
        ),
        end: Math.min(
          pcm.frames / pcm.sampleRate,
          ((i + 0.5) * pcm.frames) / pcm.sampleRate / 12 + 7.5,
        ),
        status: "NOT_PERFORMED",
      })),
      qualityStatus: "needs-review",
      finalizationMethod: "none",
      humanValidated: false,
      machineOnlyReleaseAuthorized: false,
    };
    validateManifest(m);
    await durable(path.join(root, "pre-vad-freeze.json"), m, true);
    await durable(path.join(root, "experiment.json"), m);
    await durable(
      path.join(root, "vad-request.json"),
      {
        authorized: true,
        dispatchReserved: true,
        freezeHash: digest(m),
        audioPath: baseline.audio.path,
        model: o.vadModel,
        library: o.vadLibrary,
        receiptPath: path.join(root, "vad-phases.jsonl"),
        profile: m.vadProfile,
      },
      true,
    );
    // Reservation is durable before the ONLY VAD model dispatch. Plan is never retried in-place.
    await durable(
      path.join(root, "vad-reservation.json"),
      { at: now(), maxPasses: 1, state: "reserved" },
      true,
    );
    const started = Date.now();
    const vadResult = await runner.run(
      o.python,
      [
        m.vadRuntime.script.path,
        "--request",
        path.join(root, "vad-request.json"),
      ],
      { timeoutMs: 300000, cwd: root },
    );
    await fs.writeFile(path.join(root, "vad.stdout.log"), vadResult.stdout);
    await fs.writeFile(path.join(root, "vad.stderr.log"), vadResult.stderr);
    if (vadResult.exitCode !== 0)
      throw Error(
        `VAD_PROCESS_FAILED: ${vadResult.exitCode}/${vadResult.signal ?? "none"}`,
      );
    const vad = JSON.parse(vadResult.stdout);
    if (
      vad.inputFrames !== pcm.frames ||
      vad.sampleRate !== pcm.sampleRate ||
      vad.inferencePasses !== 1
    )
      throw Error("VAD_INPUT_IDENTITY_FAILED");
    await durable(path.join(root, "vad.json"), {
      ...vad,
      wallMs: Date.now() - started,
    });
    m.vadHash = await fileHash(path.join(root, "vad.json"));
    const cutStarted = Date.now();
    m.chunks = planChunks(
      pcm.frames,
      pcm.sampleRate,
      silenceFromScores(vad.probabilities, pcm.frames, pcm.sampleRate),
    );
    const cutPlanningMs = Date.now() - cutStarted;
    m.manualReview.push(
      ...m.chunks.slice(0, -1).map((c) => ({
        kind: "seam",
        start: Math.max(0, c.coreEnd / pcm.sampleRate - 2),
        end: Math.min(
          pcm.frames / pcm.sampleRate,
          c.coreEnd / pcm.sampleRate + 2,
        ),
        status: "NOT_PERFORMED",
      })),
    );
    await durable(path.join(root, "chunks.json"), m.chunks);
    m.chunkPcmHashes = m.chunks.map((c) => ({
      id: c.id,
      sha256: contentHash(pcm.data.subarray(c.inputStart * 2, c.inputEnd * 2)),
    }));
    m.state = "frozen";
    m.planHash = digest({ ...m, planHash: null });
    await durable(path.join(root, "experiment.json"), validateManifest(m));
    await durable(path.join(root, "input-identity.json"), {
      baseline,
      pcm: m.pcm,
      audioOffset: m.audioOffset,
      sourceEnd: m.sourceEnd,
      fullAudioExtractions: 0,
    });
    await durable(path.join(root, "planning-cost.json"), {
      planWallMs: Date.now() - planStarted,
      cutPlanningMs,
      peakMemoryBytes: "UNKNOWN",
      energyJoules: "UNKNOWN",
    });
    return {
      root,
      manifest: path.join(root, "experiment.json"),
      chunks: m.chunks.length,
      ...validateChunks(m.chunks, pcm.frames, pcm.sampleRate),
    };
  } catch (error) {
    await durable(path.join(root, "BLOCKED.json"), {
      state: "blocked",
      reason: String(error),
      newASRRequests: 0,
      note: "Inspect vad-reservation and logs; do not repeat real VAD in a new plan without accounting.",
    });
    throw Error(`${error}; artifacts: ${root}`, { cause: error });
  }
}

/** Same isolated environment as the product runner, with crash-surviving raw logs. */
export class EvidenceRunner {
  constructor(signal) {
    this.signal = signal;
  }
  async run(executable, args, options = {}) {
    this.signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      let stdout = "",
        stderr = "",
        timeout,
        escalation;
      const child = spawn(executable, args, {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          PATH: process.env.PATH,
          HOME: os.homedir(),
          LANG: "en_US.UTF-8",
          TMPDIR: os.tmpdir(),
        },
      });
      const stop = () => {
        child.kill("SIGTERM");
        escalation = setTimeout(() => child.kill("SIGKILL"), 2000);
      };
      timeout = setTimeout(stop, options.timeoutMs ?? 300000);
      this.signal?.addEventListener("abort", stop, { once: true });
      const cleanup = () => {
        clearTimeout(timeout);
        clearTimeout(escalation);
        this.signal?.removeEventListener("abort", stop);
      };
      child.stdout.on("data", (value) => {
        stdout += value;
        if (options.cwd)
          appendFileSync(path.join(options.cwd, "stdout.log"), value);
      });
      child.stderr.on("data", (value) => {
        stderr += value;
        if (options.cwd)
          appendFileSync(path.join(options.cwd, "stderr.log"), value);
      });
      child.once("error", (error) => {
        cleanup();
        reject(error);
      });
      child.once("close", (exitCode, signal) => {
        cleanup();
        resolve({ stdout, stderr, exitCode, signal });
      });
    });
  }
}
export async function runB(manifest, { runner, signal } = {}) {
  runner ??= new EvidenceRunner(signal);
  const root = path.dirname(manifest);
  return locked(root, async () => {
    const m = await loadExperiment(manifest);
    const runStarted = Date.now();
    let pcmSliceMs = 0;
    validateJournal(m, await ledger(root));
    await verifyFiles([
      ...Object.values(m.baseline),
      ...Object.values(m.vadRuntime),
      ...m.software,
    ]);
    const pcm = readPcm(await fs.readFile(m.baseline.audio.path));
    if (
      pcm.frames !== m.pcm.frames ||
      pcm.sampleRate !== m.pcm.sampleRate ||
      contentHash(pcm.data) !== m.pcm.pcmHash
    )
      throw Error("PCM_CHANGED");
    let checkpointHits = 0;
    for (const c of m.chunks) {
      signal?.throwIfAborted();
      const attempts = attemptsFrom(await ledger(root));
      const completed = attempts.find(
        (a) => a.chunkId === c.id && a.state === "completed",
      );
      if (completed) {
        await safePath(path.join(root, completed.rawPath));
        if (
          (await fileHash(path.join(root, completed.rawPath))) !==
          completed.rawHash
        )
          throw Error("CORRUPT_SUCCESS_NO_AUTOMATIC_RETRY");
        checkpointHits++;
        continue;
      }
      for (;;) {
        const all = attemptsFrom(await ledger(root)),
          reserved = reserveAttempt(m.chunks, m.pcm.sampleRate, all, c.id),
          id = `${c.id}-attempt-${all.filter((a) => a.chunkId === c.id).length + 1}`;
        const relative = `B/chunks/${c.id}/${id}`,
          dir = path.join(root, relative);
        await safePath(dir, true);
        await fs.mkdir(dir, { recursive: true });
        const sliceStarted = Date.now();
        const audio = path.join(dir, "input.wav"),
          wav = slicePcm(pcm, c.inputStart, c.inputEnd);
        await fs.writeFile(audio, wav, { flag: "wx" });
        pcmSliceMs += Date.now() - sliceStarted;
        const inputHash = await fileHash(audio);
        if (
          contentHash(wav.subarray(44)) !==
          m.chunkPcmHashes.find((x) => x.id === c.id)?.sha256
        )
          throw Error("CHUNK_PCM_CHANGED");
        await durable(path.join(dir, "request.json"), {
          id,
          chunk: c,
          planHash: m.planHash,
          inputHash,
          pcmHash: contentHash(wav.subarray(44)),
          modelHash: m.baseline.model.sha256,
          runtimeHash: m.baseline.runtime.sha256,
          decode: m.decode,
        });
        await append(root, {
          kind: "reserved",
          ...reserved,
          id,
          inputHash,
          planHash: m.planHash,
        });
        const start = Date.now();
        let captured = false,
          spawned = false,
          rawPath,
          rawHash;
        const capture = {
          run: async (exe, args, opts) => {
            const model = args[args.indexOf("--model") + 1],
              prefix = args[args.indexOf("--output-file") + 1];
            const expected = [
              "--model",
              model,
              "--file",
              audio,
              "--language",
              m.language,
              "--threads",
              String(m.threads),
              "--output-srt",
              "--output-file",
              prefix,
              "--suppress-nst",
              "--no-prints",
            ];
            if (
              exe !== m.baseline.runtime.path ||
              JSON.stringify(args) !== JSON.stringify(expected) ||
              (await fileHash(model)) !== m.baseline.model.sha256 ||
              (await fileHash(exe)) !== m.baseline.runtime.sha256
            )
              throw Error("REQUEST_PARAMETER_IDENTITY_CHANGED");
            await durable(path.join(dir, "invocation.json"), {
              executable: exe,
              args,
              planHash: m.planHash,
            });
            spawned = true;
            await append(root, { kind: "process-dispatch", id });
            const result = await runner.run(exe, args, { ...opts, cwd: dir });
            await fs.writeFile(path.join(dir, "stdout.log"), result.stdout);
            await fs.writeFile(path.join(dir, "stderr.log"), result.stderr);
            await durable(path.join(dir, "exit.json"), {
              exitCode: result.exitCode,
              signal: result.signal ?? null,
            });
            if (result.exitCode !== 0)
              throw Error(
                `TECHNICAL_PROCESS_FAILURE:${result.exitCode}:${result.signal ?? ""}`,
              );
            const bytes = await fs.readFile(prefix + ".srt");
            rawPath = `${relative}/raw-response.srt`;
            await fs.writeFile(path.join(root, rawPath), bytes, { flag: "wx" });
            rawHash = await fileHash(path.join(root, rawPath));
            // Successful raw bytes are authoritative even if downstream strict parsing fails.
            await append(root, {
              kind: "completed",
              id,
              rawPath,
              rawHash,
              durationMs: Date.now() - start,
              exitCode: result.exitCode ?? 0,
              modelLoads:
                (
                  result.stderr.match(
                    /whisper_init_from_file_with_params: loading model/gu,
                  ) ?? []
                ).length || null,
            });
            captured = true;
            return result;
          },
        };
        try {
          const adapter = new WhisperCppTranscriptionAdapter({
            executablePath: m.baseline.runtime.path,
            modelPath: m.baseline.model.path,
            modelHash: m.baseline.model.sha256,
            runner: capture,
            threads: m.threads,
            useVad: false,
            coreML: false,
          });
          await adapter.transcribe({
            audioPath: audio,
            chunk: {
              id: c.id,
              relativePath: "input.wav",
              start: 0,
              end: reserved.seconds,
              duration: reserved.seconds,
              sha256: inputHash,
            },
            language: m.language,
            timestampStrategy: "segment",
            tokenTimestamps: false,
          });
        } catch (error) {
          await durable(path.join(dir, "error.json"), {
            error: String(error),
            captured,
            spawned,
          });
          if (!captured) {
            await append(root, {
              kind: signal?.aborted ? "cancelled" : "failed",
              id,
              error: String(error),
              durationMs: Date.now() - start,
            });
            if (signal?.aborted || !spawned) throw error;
            continue;
          }
        }
        if (!captured) throw Error("NO_COMPLETE_RAW_RESPONSE");
        console.log(
          `${c.id} complete (${c.index + 1}/${m.chunks.length}); raw preserved`,
        );
        break;
      }
    }
    await verifyFiles(Object.values(m.baseline));
    const result = {
      at: now(),
      checkpointHits,
      attempts: attemptsFrom(await ledger(root)).length,
      newAudioExtractions: 0,
      wallMs: Date.now() - runStarted,
      pcmSliceMs,
    };
    await append(root, { kind: "run-finished", ...result });
    return result;
  });
}

export async function report(manifest, options) {
  const { reportRevision } = await import("./bounded-report-revision.mjs");
  return reportRevision(manifest, options);
}
