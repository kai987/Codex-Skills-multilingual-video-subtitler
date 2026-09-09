import { createReadStream } from "node:fs";
import {
  access,
  constants,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
  open,
  chmod,
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { z } from "zod";
import type { ProcessRunner, RunProcessOptions } from "@mvl/shared";
import { subtitleCueSchema } from "@mvl/shared";
import { WhisperCppTranscriptionAdapter } from "@mvl/transcription-core";
import {
  formatAss,
  formatSrt,
  formatVtt,
  parseAss,
  parseSrt,
  parseVtt,
} from "@mvl/subtitle-core";
import { assemble, digest, lexical } from "./assembly.js";

export const profileSchema = z.enum(["primary-minimal", "g11"]);
export const configSchema = z
  .object({
    model: z.string().min(1),
    runtime: z.string().min(1),
    language: z.enum(["ja", "en", "zh"]).default("ja"),
    profile: profileSchema.default("primary-minimal"),
    threads: z.number().int().min(1).max(32).default(4),
    ffmpeg: z.string().default("ffmpeg"),
    ffprobe: z.string().default("ffprobe"),
  })
  .strict();
export type Configuration = z.infer<typeof configSchema>;
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const manifestSchema = z
  .object({
    version: z.literal("subtitle-tool-v1"),
    taskId: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    input: z.string(),
    inputHash: hashSchema,
    config: configSchema,
    configHash: hashSchema,
    modelHash: hashSchema,
    runtimeHash: hashSchema,
    ffmpegHash: hashSchema,
    ffprobeHash: hashSchema,
    track: z.number().int().nonnegative(),
    duration: z.number().positive(),
    origin: z.number(),
    audioOffset: z.number().nonnegative(),
    executionStatus: z.enum([
      "queued",
      "running",
      "completed",
      "failed",
      "cancelled",
      "partial",
    ]),
    phase: z.string(),
    artifactIntegrity: z.enum(["pending", "passed", "failed"]),
    qualityStatus: z.literal("needs-review"),
    contentQuality: z.literal("NOT_MEASURED"),
    finalizationMethod: z.literal("none"),
    humanValidated: z.literal(false),
    machineOnlyReleaseAuthorized: z.literal(false),
    audioHash: hashSchema.nullable(),
    rawHash: hashSchema.nullable().default(null),
    evidenceHash: hashSchema.nullable(),
    warnings: z.array(z.string()),
    attempts: z.array(
      z
        .object({
          id: z.string(),
          startedAt: z.string(),
          endedAt: z.string().nullable(),
          reservedAudioSeconds: z.number(),
          state: z.enum(["running", "completed", "failed", "cancelled"]),
          error: z.string().nullable(),
        })
        .strict(),
    ),
    budgetSeconds: z.number().positive(),
    cacheHits: z.number().int().nonnegative(),
    rawCheckpointHits: z.number().int().nonnegative().default(0),
    modelLoads: z.number().int().nonnegative().nullable(),
    outputs: z.record(z.string(), hashSchema),
    ownedFiles: z.array(z.string()),
    error: z.string().nullable(),
  })
  .strict();
export type TaskManifest = z.infer<typeof manifestSchema>;
export const evidenceSchema = z
  .object({
    version: z.literal("subtitle-tool-primary-v1"),
    identity: hashSchema,
    rawHash: hashSchema,
    timebase: z.literal("source-global-relative-to-container-origin"),
    cues: z.array(subtitleCueSchema),
  })
  .strict();
export async function fileHash(file: string) {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(file)) h.update(chunk as Buffer);
  return h.digest("hex");
}
export async function atomic(file: string, value: unknown) {
  const temp = file + ".partial-" + randomUUID();
  await writeFile(
    temp,
    typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n",
    { flag: "wx" },
  );
  await rename(temp, file);
}
export const configPath = () =>
  path.join(os.homedir(), ".config", "subtitle-tool", "config.json");
export async function loadConfig(
  file = configPath(),
  overrides: Record<string, unknown> = {},
) {
  let saved: unknown = {};
  try {
    saved = JSON.parse(await readFile(file, "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  return configSchema.parse({ ...(saved as object), ...overrides });
}
export async function saveConfig(file: string, config: Configuration) {
  await mkdir(path.dirname(file), { recursive: true });
  await atomic(file, configSchema.parse(config));
}

/** Read-only permission check; does not create the proposed output directory. */
export async function checkWriteTarget(target: string) {
  let current = path.resolve(target);
  for (;;) {
    try {
      const info = await stat(current);
      if (!info.isDirectory()) throw Error("输出目标或父路径不是目录");
      await access(current, constants.W_OK);
      return {
        target: path.resolve(target),
        checkedParent: current,
        writable: true,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw Error(`输出路径不可写：${current}`, { cause: error });
      const parent = path.dirname(current);
      if (parent === current)
        throw Error("找不到可写的输出父目录", { cause: error });
      current = parent;
    }
  }
}

/** No shell, no unrelated process cleanup, no credential-bearing child environment. */
export class OwnedRunner implements ProcessRunner {
  constructor(readonly signal?: AbortSignal) {}
  async run(
    executable: string,
    args: readonly string[],
    options: RunProcessOptions = {},
  ) {
    this.signal?.throwIfAborted();
    return await new Promise<{
      stdout: string;
      stderr: string;
      exitCode: number;
    }>((resolve, reject) => {
      const child = spawn(executable, args, {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          PATH: process.env.PATH,
          HOME: os.homedir(),
          LANG: "en_US.UTF-8",
          TMPDIR: os.tmpdir(),
        },
        ...(options.cwd ? { cwd: options.cwd } : {}),
      });
      let stdout = "",
        stderr = "",
        killed = false;
      let escalation: NodeJS.Timeout | undefined;
      const stop = () => {
        killed = true;
        child.kill("SIGTERM");
        escalation = setTimeout(() => child.kill("SIGKILL"), 2000);
        escalation.unref();
      };
      this.signal?.addEventListener("abort", stop, { once: true });
      const timer = setTimeout(stop, options.timeoutMs ?? 60_000);
      timer.unref();
      const cleanup = () => {
        clearTimeout(timer);
        if (escalation) clearTimeout(escalation);
        this.signal?.removeEventListener("abort", stop);
      };
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (s: string) => {
        stdout += s;
      });
      child.stderr.on("data", (s: string) => {
        stderr += s;
      });
      child.on("error", (e) => {
        cleanup();
        reject(Error(`无法启动 ${path.basename(executable)}：${e.message}`));
      });
      child.on("close", (code) => {
        cleanup();
        if (killed || code !== 0)
          reject(
            Error(
              this.signal?.aborted
                ? "任务已取消"
                : `进程失败 ${path.basename(executable)} (${code})：${stderr.slice(-3000)}`,
            ),
          );
        else resolve({ stdout, stderr, exitCode: 0 });
      });
    });
  }
}
async function executable(name: string) {
  const candidates = name.includes(path.sep)
    ? [path.resolve(name)]
    : (process.env.PATH ?? "")
        .split(path.delimiter)
        .map((p) => path.join(p, name));
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      /* next PATH entry */
    }
  }
  throw Error(`缺少可执行程序：${name}`);
}
const probeSchema = z
  .object({
    streams: z.array(
      z
        .object({
          index: z.number(),
          codec_type: z.string(),
          sample_rate: z.string().optional(),
          start_time: z.string().optional(),
          duration: z.string().optional(),
          tags: z.record(z.string(), z.unknown()).optional(),
        })
        .loose(),
    ),
    format: z
      .object({ duration: z.string(), start_time: z.string().optional() })
      .loose(),
  })
  .loose();
export async function doctor(
  config: Configuration,
  input?: string,
  track?: number,
  runner: ProcessRunner = new OwnedRunner(),
) {
  if (Number(process.versions.node.split(".")[0]) !== 24)
    throw Error("需要 Node.js 24 和 npm 11，请先切换本地运行环境");
  await access(config.model, constants.R_OK);
  if (!(await stat(config.model)).isFile())
    throw Error("模型必须是本地普通文件");
  const runtime = await executable(config.runtime),
    ffmpeg = await executable(config.ffmpeg),
    ffprobe = await executable(config.ffprobe);
  const [help, ffmpegVersion, ffprobeVersion, npmVersion] = await Promise.all([
    runner.run(runtime, ["--help"]),
    runner.run(ffmpeg, ["-version"]),
    runner.run(ffprobe, ["-version"]),
    runner.run(await executable("npm"), ["--version"]),
  ]);
  if (!npmVersion.stdout.trim().startsWith("11."))
    throw Error("需要 npm 11（与锁文件配套）");
  if (!(help.stdout + help.stderr).includes("--output-srt"))
    throw Error("运行时缺少 whisper.cpp --output-srt 能力");
  const versions = {
    whisperHelp: help.stdout + help.stderr,
    ffmpeg: ffmpegVersion.stdout.split("\n")[0],
    ffprobe: ffprobeVersion.stdout.split("\n")[0],
    npm: npmVersion.stdout.trim(),
  };
  config = {
    ...config,
    model: path.resolve(config.model),
    runtime,
    ffmpeg,
    ffprobe,
  };
  if (!input) return { config, versions, media: null };
  await access(input, constants.R_OK);
  if (!(await stat(input)).isFile()) throw Error("输入必须是本地普通媒体文件");
  const raw = await runner.run(ffprobe, [
    "-v",
    "error",
    "-show_entries",
    "format=duration,start_time:stream=index,codec_type,sample_rate,start_time,duration:stream_tags=language",
    "-of",
    "json",
    path.resolve(input),
  ]);
  const probe = probeSchema.parse(JSON.parse(raw.stdout));
  const audio = probe.streams.filter((s) => s.codec_type === "audio");
  if (!audio.length) throw Error("输入没有音轨");
  const selected =
    track === undefined
      ? audio.length === 1
        ? audio[0]
        : undefined
      : audio.find((s) => s.index === track);
  if (!selected)
    throw Error(`请选择全局音轨索引 --audio-track：${JSON.stringify(audio)}`);
  const duration = Number(probe.format.duration),
    origin = Number(probe.format.start_time ?? 0),
    audioStart = Number(selected.start_time ?? origin);
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    !Number.isFinite(origin) ||
    !Number.isFinite(audioStart) ||
    audioStart < origin - 0.05
  )
    throw Error("媒体时间基准不可验证");
  return {
    config: { ...config, runtime, ffmpeg, ffprobe },
    versions,
    media: {
      duration,
      origin,
      audioOffset: Math.max(0, audioStart - origin),
      track: selected.index,
      tracks: audio,
    },
  };
}
export async function readTask(task: string) {
  return manifestSchema.parse(
    JSON.parse(await readFile(path.join(task, "task.json"), "utf8")),
  );
}
const stamp = () => new Date().toISOString();
export async function createTask(
  config: Configuration,
  input: string,
  outputRoot: string,
  track?: number,
) {
  const check = await doctor(config, input, track);
  const media = check.media;
  if (!media) throw Error("未指定输入媒体");
  config = check.config;
  await mkdir(outputRoot, { recursive: true });
  await access(outputRoot, constants.W_OK);
  const task = await mkdtemp(path.join(path.resolve(outputRoot), "subtitle-"));
  const m: TaskManifest = {
    version: "subtitle-tool-v1",
    taskId: path.basename(task),
    createdAt: stamp(),
    updatedAt: stamp(),
    input: path.resolve(input),
    inputHash: await fileHash(input),
    config,
    configHash: digest(config),
    modelHash: await fileHash(config.model),
    runtimeHash: await fileHash(config.runtime),
    ffmpegHash: await fileHash(config.ffmpeg),
    ffprobeHash: await fileHash(config.ffprobe),
    ...{
      track: media.track,
      duration: media.duration,
      origin: media.origin,
      audioOffset: media.audioOffset,
    },
    executionStatus: "queued",
    phase: "preflight-complete",
    artifactIntegrity: "pending",
    qualityStatus: "needs-review",
    contentQuality: "NOT_MEASURED",
    finalizationMethod: "none",
    humanValidated: false,
    machineOnlyReleaseAuthorized: false,
    audioHash: null,
    rawHash: null,
    evidenceHash: null,
    warnings: [],
    attempts: [],
    budgetSeconds: media.duration * 2,
    cacheHits: 0,
    rawCheckpointHits: 0,
    modelLoads: 0,
    outputs: {},
    ownedFiles: ["task.json", "preflight.json"],
    error: null,
  };
  await atomic(path.join(task, "preflight.json"), check);
  await atomic(path.join(task, "task.json"), manifestSchema.parse(m));
  return task;
}
export async function verifyIdentity(m: TaskManifest) {
  const identities = await Promise.all([
    fileHash(m.input),
    fileHash(m.config.model),
    fileHash(m.config.runtime),
    fileHash(m.config.ffmpeg),
    fileHash(m.config.ffprobe),
  ]);
  if (
    digest(identities) !==
      digest([
        m.inputHash,
        m.modelHash,
        m.runtimeHash,
        m.ffmpegHash,
        m.ffprobeHash,
      ]) ||
    digest(m.config) !== m.configHash
  )
    throw Error(
      "输入、模型、运行时或配置身份已变化；请创建新任务，不得复用旧缓存",
    );
}
export function evidenceIdentity(m: TaskManifest) {
  return digest({
    audio: m.audioHash,
    model: m.modelHash,
    runtime: m.runtimeHash,
    language: m.config.language,
    decode: {
      threads: m.config.threads,
      vad: false,
      coreml: false,
      suppressNst: true,
      prompt: null,
      timestampStrategy: "segment",
    },
    preprocess: {
      ffmpeg: m.ffmpegHash,
      rate: 16000,
      channels: 1,
      filter: "asetpts=PTS-STARTPTS,aresample=async=1:first_pts=0",
      track: m.track,
    },
    mapping: { origin: m.origin, offset: m.audioOffset, duration: m.duration },
    version: "subtitle-tool-v1",
  });
}
export async function runTask(
  task: string,
  options: {
    profile?: "primary-minimal" | "g11";
    signal?: AbortSignal;
    runner?: ProcessRunner;
    progress?: (message: string) => void;
  } = {},
) {
  task = path.resolve(task);
  const lock = path.join(task, ".run-lock");
  try {
    const fd = await open(lock, "wx");
    await fd.writeFile(JSON.stringify({ pid: process.pid }));
    await fd.close();
  } catch {
    throw Error("任务已有运行锁；确认旧进程结束后再 resume --recover-lock");
  }
  let m: TaskManifest;
  try {
    m = await readTask(task);
  } catch (e) {
    await rm(lock, { force: true });
    throw e;
  }
  const runner = options.runner ?? new OwnedRunner(options.signal);
  const put = async (name: string, value: unknown) => {
    await atomic(path.join(task, name), value);
    if (!m.ownedFiles.includes(name)) m.ownedFiles.push(name);
  };
  const save = async () => {
    m.updatedAt = stamp();
    await atomic(path.join(task, "task.json"), manifestSchema.parse(m));
  };
  const phase = async (name: string) => {
    m.phase = name;
    options.progress?.(name);
    await save();
  };
  try {
    await verifyIdentity(m);
    options.signal?.throwIfAborted();
    m.executionStatus = "running";
    m.error = null;
    await phase("提取完整音轨");
    const audio = path.join(task, "audio.wav");
    if (m.audioHash) {
      if ((await fileHash(audio)) !== m.audioHash)
        throw Error("音频检查点损坏");
    } else {
      const partial = path.join(task, "audio.partial.wav");
      await runner.run(
        m.config.ffmpeg,
        [
          "-nostdin",
          "-y",
          "-v",
          "error",
          "-i",
          m.input,
          "-map",
          `0:${m.track}`,
          "-vn",
          "-sn",
          "-dn",
          "-af",
          "asetpts=PTS-STARTPTS,aresample=async=1:first_pts=0",
          "-ac",
          "1",
          "-ar",
          "16000",
          "-c:a",
          "pcm_s16le",
          "-map_metadata",
          "-1",
          partial,
        ],
        { timeoutMs: 3600000 },
      );
      await rename(partial, audio);
      m.audioHash = await fileHash(audio);
      m.ownedFiles.push("audio.wav");
      await save();
    }
    let evidence: z.infer<typeof evidenceSchema>;
    if (m.evidenceHash) {
      if (
        (await fileHash(path.join(task, "primary-evidence.json"))) !==
        m.evidenceHash
      )
        throw Error("证据检查点损坏");
      evidence = evidenceSchema.parse(
        JSON.parse(
          await readFile(path.join(task, "primary-evidence.json"), "utf8"),
        ),
      );
      if (
        evidence.identity !== evidenceIdentity(m) ||
        (await fileHash(path.join(task, "raw-primary.srt"))) !==
          evidence.rawHash
      )
        throw Error("ASR 缓存身份不匹配");
      m.cacheHits++;
      await phase("复用完整 Primary 证据（零推理）");
    } else {
      // One unsegmented request: no boundary duplication, no benchmark cuts or reference prompts.
      const audioProbe = JSON.parse(
        (
          await runner.run(m.config.ffprobe, [
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "json",
            audio,
          ])
        ).stdout,
      ) as { format: { duration: string } };
      const seconds = Number(audioProbe.format.duration);
      if (
        !Number.isFinite(seconds) ||
        seconds <= 0 ||
        seconds + m.audioOffset > m.duration + 0.1
      )
        throw Error("提取音频与源时间线不一致");
      let raw = "";
      if (m.attempts.some((a) => a.state === "completed")) {
        m.rawCheckpointHits++;
        await phase("复用成功请求的原始输出（零推理）；重新校验时间完整性");
      }
      for (
        let n = m.attempts.length;
        n < 2 && !m.attempts.some((a) => a.state === "completed");
        n++
      ) {
        options.signal?.throwIfAborted();
        if (
          m.attempts.reduce((sum, a) => sum + a.reservedAudioSeconds, 0) +
            seconds >
          m.budgetSeconds + 0.1
        )
          throw Error("推理预算耗尽；不会重新运行成功请求");
        const attempt: TaskManifest["attempts"][number] = {
          id: `primary-${n + 1}`,
          startedAt: stamp(),
          endedAt: null,
          reservedAudioSeconds: seconds,
          state: "running",
          error: null,
        };
        m.attempts.push(attempt);
        await phase(
          `Primary 本地识别：0–${seconds.toFixed(3)} 秒；第 ${n + 1}/2 次请求`,
        );
        const capture: ProcessRunner = {
          run: async (exe, args, opts) => {
            const result = await runner.run(exe, args, opts);
            if (exe === m.config.runtime) {
              const prefix = args[args.indexOf("--output-file") + 1];
              if (!prefix) throw Error("缺少原始输出路径");
              raw = await readFile(prefix + ".srt", "utf8");
              await put(`attempt-${n + 1}.log`, result.stderr);
              await put("raw-primary.srt", raw);
              await chmod(path.join(task, "raw-primary.srt"), 0o444);
              m.rawHash = await fileHash(path.join(task, "raw-primary.srt"));
              const observedLoads = (
                result.stderr.match(
                  /whisper_init_from_file_with_params: loading model/gu,
                ) ?? []
              ).length;
              m.modelLoads = observedLoads
                ? (m.modelLoads ?? 0) + observedLoads
                : null;
              attempt.state = "completed";
              attempt.endedAt = stamp();
              await save();
            }
            return result;
          },
        };
        try {
          const adapter = new WhisperCppTranscriptionAdapter({
            executablePath: m.config.runtime,
            modelPath: m.config.model,
            modelHash: m.modelHash,
            runner: capture,
            threads: m.config.threads,
            useVad: false,
            coreML: false,
          });
          await adapter.transcribe({
            audioPath: audio,
            chunk: {
              id: "primary-full",
              relativePath: "audio.wav",
              start: 0,
              end: seconds,
              duration: seconds,
              sha256: m.audioHash,
            },
            language: m.config.language,
            timestampStrategy: "segment",
            tokenTimestamps: false,
          });
          attempt.state = "completed";
          attempt.endedAt = stamp();
          await save();
          break;
        } catch (e) {
          if (attempt.state === "completed") throw e;
          m.modelLoads = null;
          attempt.state = options.signal?.aborted ? "cancelled" : "failed";
          attempt.endedAt = stamp();
          attempt.error = String(e);
          await save();
          if (options.signal?.aborted || n === 1) throw e;
        }
      }
      if (!m.attempts.some((a) => a.state === "completed"))
        throw Error("没有成功的 Primary 请求；预算不允许再次执行");
      if (raw === "")
        raw = await readFile(path.join(task, "raw-primary.srt"), "utf8");
      if ((await fileHash(path.join(task, "raw-primary.srt"))) !== m.rawHash)
        throw Error("成功请求的原始输出身份不匹配；禁止重新识别");
      const parsed = raw.trim() ? parseSrt(raw) : [];
      // Missing model initialization logs are unknown, not proof of zero loads.
      if (m.modelLoads === 0 && m.attempts.some((a) => a.state === "completed"))
        m.modelLoads = null;
      const invalid = parsed.filter(
        (c) => c.start < 0 || c.end <= c.start || c.end > seconds + 0.05,
      );
      if (invalid.length) {
        await put("raw-timing-error.json", {
          rawHash: m.rawHash,
          invalidCount: invalid.length,
          invalid,
          action: "REFUSE_EXPORT_NO_CLAMP_NO_SEMANTIC_RETRY",
        });
        throw Error(
          `原始 ASR 时间无效：${invalid.length} 条越界或非正时长；保留原始输出，不重试识别`,
        );
      }
      // Read preserved raw output, not adapter-clamped segments. Never repair impossible timing by clipping.
      const cues = parsed.map((c, i) => {
        if (c.start < 0 || c.end <= c.start || c.end > seconds + 0.05)
          throw Error("原始 ASR 时间越界，保留原始输出待检查；不会语义重试");
        return subtitleCueSchema.parse({
          id: `primary-${i + 1}`,
          start: c.start + m.audioOffset,
          end: c.end + m.audioOffset,
          text: c.text,
          speaker: null,
          confidence: null,
          language: m.config.language,
          languages: [m.config.language],
        });
      });
      evidence = evidenceSchema.parse({
        version: "subtitle-tool-primary-v1",
        identity: evidenceIdentity(m),
        rawHash: await fileHash(path.join(task, "raw-primary.srt")),
        timebase: "source-global-relative-to-container-origin",
        cues,
      });
      await put("primary-evidence.json", evidence);
      await chmod(path.join(task, "primary-evidence.json"), 0o444);
      m.evidenceHash = await fileHash(path.join(task, "primary-evidence.json"));
      await save();
    }
    await phase("组装与导出机器字幕草稿");
    const profile = options.profile ?? m.config.profile;
    if (profile === "g11" && m.config.language !== "ja")
      throw Error("G11 当前仅支持日语；请使用 primary-minimal");
    const assembled = assemble(evidence.cues, profile);
    if (!assembled.cues.length) {
      m.executionStatus = "partial";
      m.artifactIntegrity = "pending";
      m.warnings = [
        "EMPTY_TRANSCRIPT：模型返回空文本，不能据此确认无语音；没有创建空字幕冒充成功",
      ];
      await put(
        "OUTPUT_INDEX.md",
        "# 尚无可导出的字幕\n\n" + m.warnings.join("\n"),
      );
      await phase("模型请求完成但未获得文本：需检查原音频和模型配置");
      return m;
    }
    // Shared centisecond quantization makes all three formats use exactly one timeline.
    const cues = assembled.cues.map((c) => ({
      ...c,
      start: Math.round(c.start * 100) / 100,
      end: Math.round(c.end * 100) / 100,
    }));
    if (
      cues.some(
        (c) => c.end <= c.start || c.start < 0 || c.end > m.duration + 0.05,
      )
    )
      throw Error("导出时间无效；未作钳制或比例造时");
    m.warnings = ["机器生成，内容准确率未测量，需人工复核"];
    if (!cues.length)
      m.warnings.push(
        "EMPTY_TRANSCRIPT：运行成功但未识别到文本；不代表已确认无语音",
      );
    if (!assembled.normalizedSequencePreserved)
      m.warnings.push(
        "G11_TEXT_SEQUENCE_CHANGED：G11 改变了 Primary 文本序列，请对照原稿",
      );
    if (
      cues.some((c, i) => {
        const previous = cues[i - 1];
        return previous && c.start < previous.end;
      })
    )
      m.warnings.push("OVERLAPPING_CUES：保留原始重叠，未自动裁切");
    if (
      cues.some(
        (c) =>
          c.text.split("\n").length > 2 ||
          c.text.split("\n").some((l) => Array.from(l).length > 16),
      )
    )
      m.warnings.push("PRESENTATION_OVERFLOW：优先保全文本，不伪造内部时间");
    if (new Set(cues.map((c) => c.id)).size !== cues.length)
      throw Error("导出 Cue ID 重复");
    const formats = {
      srt: formatSrt(cues),
      vtt: formatVtt(cues),
      ass: formatAss(cues),
    };
    for (const [extension, bytes] of Object.entries(formats)) {
      const name = `${profile}.machine-draft.${extension}`;
      if (
        m.outputs[name] &&
        (await fileHash(path.join(task, name))) !== m.outputs[name]
      )
        throw Error("机器草稿被外部修改；请先另存为 edited 副本，禁止覆盖");
      await put(name, bytes);
      m.outputs[name] = await fileHash(path.join(task, name));
      const reread = await readFile(path.join(task, name), "utf8");
      const parsed = !cues.length
        ? []
        : extension === "ass"
          ? parseAss(reread)
          : extension === "srt"
            ? parseSrt(reread)
            : parseVtt(reread);
      if (
        parsed.length !== cues.length ||
        lexical(parsed) !== lexical(cues) ||
        parsed.some((c, i) => {
          const source = cues[i];
          return (
            !source ||
            Math.abs(c.start - source.start) > 0.001 ||
            Math.abs(c.end - source.end) > 0.001
          );
        })
      )
        throw Error("跨格式内容或时间一致性校验失败");
    }
    await put(`${profile}.assembly.json`, {
      profile,
      primaryEvidenceHash: m.evidenceHash,
      ...assembled,
      serializedCues: cues,
    });
    await put(
      "OUTPUT_INDEX.md",
      `# 机器字幕草稿（非授权终稿）\n\n${Object.keys(m.outputs)
        .map((p) => `- [${p}](${p})`)
        .join(
          "\n",
        )}\n\n使用外部字幕编辑器打开；编辑前另存为 edited.ass / edited.srt。原始证据和机器草稿保留不动。\n\n${m.warnings.join("\n\n")}\n`,
    );
    m.executionStatus = "completed";
    await verifyIdentity(m);
    m.artifactIntegrity = "passed";
    await phase("完成：机器草稿已导出，仍需复核");
    return m;
  } catch (e) {
    m.executionStatus = options.signal?.aborted
      ? "cancelled"
      : m.evidenceHash
        ? "partial"
        : "failed";
    m.error = String(e);
    m.artifactIntegrity = "failed";
    await save();
    throw e;
  } finally {
    await rm(lock, { force: true });
  }
}
export async function recoverLock(task: string) {
  const file = path.join(path.resolve(task), ".run-lock");
  const lock = JSON.parse(await readFile(file, "utf8")) as { pid: number };
  if (!Number.isInteger(lock.pid) || lock.pid <= 0)
    throw Error("运行锁无效，不能自动移除");
  try {
    process.kill(lock.pid, 0);
    throw Error("锁所属进程仍在运行，不能恢复");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ESRCH") throw e;
  }
  await rm(file);
}
