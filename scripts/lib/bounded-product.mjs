/** Bounded product path. Fresh-only content recovery; no reference or provider fallback. */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";
import { z } from "zod";
import {
  configSchema,
  doctor,
  fileHash,
} from "../../packages/video-subtitler/dist/standalone/tool.js";
import { digest } from "../../packages/video-subtitler/dist/standalone/assembly.js";
import { safePath } from "../../packages/video-subtitler/dist/standalone/recovery.js";
import {
  POLICY,
  chunkSchema,
  planChunks,
  validateChunks,
  reserveAttempt,
  mapRaw,
  boundaryDedup,
  serializeRecords,
  formats,
} from "../../packages/video-subtitler/dist/standalone/bounded.js";
import {
  durable,
  readPcm,
  slicePcm,
  EvidenceRunner,
} from "./bounded-asr-ab.mjs";
import {
  AUDIO_GUARD_VERSION,
  pcmEvidence,
} from "./recovery-evidence-guard.mjs";

export const BOUNDED_PRODUCT_VERSION = "subtitle-tool-bounded-product-v1";
const now = () => new Date().toISOString();
const byteHash = (b) => createHash("sha256").update(b).digest("hex");
const json = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const identity = z.object({ path: z.string(), sha256: hash }).strict();
const finite = z.number().finite();
const rangeSchema = z
  .object({ start: finite.nonnegative(), end: finite.positive() })
  .strict();
const planSchema = z
  .object({
    version: z.literal(BOUNDED_PRODUCT_VERSION),
    createdAt: z.string(),
    config: configSchema,
    identities: z
      .object({
        input: identity,
        model: identity,
        runtime: identity,
        ffmpeg: identity,
        ffprobe: identity,
      })
      .strict(),
    software: z.array(identity),
    configHash: hash,
    policyHash: hash,
    track: z.number().int().nonnegative(),
    duration: finite.positive(),
    origin: finite,
    audioOffset: finite.nonnegative(),
    requestedRange: rangeSchema.nullable(),
    effectiveRange: rangeSchema,
    coverageScope: z.enum(["full-audio", "selected-source-range"]),
    audioHash: hash,
    pcmHash: hash,
    sampleRate: z.literal(16000),
    fullFrames: z.number().int().positive(),
    firstFrame: z.number().int().nonnegative(),
    frames: z.number().int().positive(),
    chunks: z.array(chunkSchema),
    rawJson: z.boolean(),
    audioGuardVersion: z.literal(AUDIO_GUARD_VERSION).optional(),
    decode: z
      .object({
        prompt: z.null(),
        vad: z.literal(false),
        coreML: z.literal(false),
        suppressNst: z.literal(true),
        timestamp: z.literal("segment"),
        requestIsolation: z.literal("independent-cli-process"),
        tokenEvidence: z.literal("NOT_VALIDATED"),
      })
      .strict(),
  })
  .strict();
const attemptSchema = z
  .object({
    id: z.string(),
    chunkId: z.string(),
    seconds: finite.positive(),
    state: z.enum(["running", "completed", "failed", "cancelled"]),
    startedAt: z.string(),
    endedAt: z.string().nullable(),
    error: z.string().nullable(),
    rawPath: z.string().nullable(),
    rawHash: hash.nullable(),
  })
  .strict();
export const boundedTaskSchema = z
  .object({
    version: z.literal(BOUNDED_PRODUCT_VERSION),
    planHash: hash,
    updatedAt: z.string(),
    executionStatus: z.enum([
      "queued",
      "running",
      "completed",
      "partial",
      "failed",
      "cancelled",
    ]),
    artifactIntegrity: z.enum(["pending", "passed", "failed"]),
    qualityStatus: z.literal("needs-review"),
    finalizationMethod: z.literal("none"),
    humanValidated: z.literal(false),
    machineOnlyReleaseAuthorized: z.literal(false),
    contentQuality: z.literal("NOT_MEASURED"),
    coverageScope: z.enum(["full-audio", "selected-source-range"]),
    attempts: z.array(attemptSchema),
    files: z.record(z.string(), hash),
    outputs: z.array(z.string()),
    recordCount: z.number().int().nonnegative(),
    unresolvedCount: z.number().int().nonnegative(),
    aliasCount: z.number().int().nonnegative(),
    exportedCount: z.number().int().nonnegative(),
    error: z.string().nullable(),
  })
  .strict();
const fp = async (p) => ({ path: path.resolve(p), sha256: await fileHash(p) });
const present = async (p) =>
  fs.access(p).then(
    () => true,
    (e) => {
      if (e.code === "ENOENT") return false;
      throw e;
    },
  );
function local(task, relative) {
  if (
    !relative ||
    path.isAbsolute(relative) ||
    relative.split(/[\\/]/u).includes("..")
  )
    throw Error("UNSAFE_BOUNDED_PATH");
  return path.join(task, relative);
}
async function verifyFiles(task, files) {
  for (const [name, expected] of Object.entries(files)) {
    const p = local(task, name);
    await safePath(p);
    if ((await fileHash(p)) !== expected)
      throw Error(`BOUNDED_CHECKPOINT_CHANGED:${name}`);
  }
}
async function checkExternal(plan) {
  for (const f of [...Object.values(plan.identities), ...plan.software]) {
    if ((await fileHash(f.path)) !== f.sha256)
      throw Error(`BOUNDED_IDENTITY_CHANGED:${path.basename(f.path)}`);
  }
}
async function save(task, m) {
  m.updatedAt = now();
  await durable(
    path.join(task, "bounded-task.json"),
    boundedTaskSchema.parse(m),
  );
}
async function put(task, m, name, value) {
  const p = local(task, name);
  await safePath(p, true);
  const bytes =
    typeof value === "string" || value instanceof Uint8Array
      ? value
      : JSON.stringify(value, null, 2) + "\n";
  const expected = byteHash(bytes);
  if (await present(p)) {
    if ((await fileHash(p)) !== expected)
      throw Error(`IMMUTABLE_BOUNDED_ARTIFACT:${name}`);
  } else {
    await fs.mkdir(path.dirname(p), { recursive: true });
    const temporary = `${p}.partial-${randomUUID()}`;
    const h = await fs.open(temporary, "wx");
    try {
      await h.writeFile(bytes);
      await h.sync();
    } finally {
      await h.close();
    }
    // Publish complete bytes exclusively; never replace a prior user or machine artifact.
    await fs.link(temporary, p);
    await fs.unlink(temporary);
    const directory = await fs.open(path.dirname(p), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
  m.files[name] = expected;
}
async function read(task) {
  await safePath(task);
  await safePath(path.join(task, "bounded-task.json"));
  await safePath(path.join(task, "bounded-plan.json"));
  const m = boundedTaskSchema.parse(
    await json(path.join(task, "bounded-task.json")),
  );
  const p = planSchema.parse(await json(path.join(task, "bounded-plan.json")));
  if (
    digest(p) !== m.planHash ||
    p.policyHash !== digest(POLICY) ||
    p.configHash !== digest(p.config)
  )
    throw Error("BOUNDED_PLAN_BINDING_CHANGED");
  validateChunks(p.chunks, p.frames, p.sampleRate);
  if (
    p.effectiveRange.start !== p.audioOffset + p.firstFrame / p.sampleRate ||
    p.effectiveRange.end !== p.effectiveRange.start + p.frames / p.sampleRate ||
    p.firstFrame + p.frames > p.fullFrames ||
    p.effectiveRange.end > p.duration + 0.1 ||
    m.coverageScope !== p.coverageScope
  )
    throw Error("BOUNDED_TIMEBASE_CHANGED");
  const prior = [];
  for (const a of m.attempts) {
    const reserved = reserveAttempt(p.chunks, p.sampleRate, prior, a.chunkId);
    const expectedId = `${a.chunkId}-attempt-${prior.filter((x) => x.chunkId === a.chunkId).length + 1}`;
    if (
      a.id !== expectedId ||
      a.seconds !== reserved.seconds ||
      (a.state === "completed" &&
        (!a.rawPath ||
          !a.rawHash ||
          a.rawPath !== `requests/${a.id}/raw-response.srt` ||
          m.files[a.rawPath] !== a.rawHash))
    )
      throw Error("BOUNDED_ATTEMPT_BINDING_CHANGED");
    prior.push(a);
  }
  await verifyFiles(task, m.files);
  const zeroFiles = p.chunks.filter((c) => m.files[`zero-audio/${c.id}.json`]);
  if (zeroFiles.length) {
    if (!p.audioGuardVersion) throw Error("UNBOUND_DIGITAL_ZERO_PROOF");
    const pcm = readPcm(await fs.readFile(path.join(task, "audio.wav")));
    for (const c of zeroFiles) {
      const proof = await json(path.join(task, `zero-audio/${c.id}.json`));
      const evidence = pcmEvidence(
        pcm,
        p.firstFrame + c.inputStart,
        p.firstFrame + c.inputEnd,
      );
      if (
        !evidence.allSamplesExactlyZero ||
        proof.pcmSliceHash !== evidence.pcmSliceHash ||
        proof.startFrame !== evidence.startFrame ||
        proof.endFrame !== evidence.endFrame ||
        proof.audioHash !== p.audioHash ||
        proof.pcmHash !== p.pcmHash ||
        proof.chunkId !== c.id ||
        proof.allSamplesExactlyZero !== true ||
        proof.decision !== "skipped-digital-zero" ||
        proof.asrRequests !== 0 ||
        m.attempts.some((a) => a.chunkId === c.id && a.state === "completed")
      )
        throw Error("DIGITAL_ZERO_PROOF_CHANGED");
    }
  }
  return { m, p };
}

/** Creates, extracts and freezes only; never dispatches ASR. */
export async function createBoundedTask(options) {
  const runner = options.runner ?? new EvidenceRunner(options.signal);
  const config = configSchema.parse(options.config);
  if (config.profile !== "primary-minimal")
    throw Error("BOUNDED_PRIMARY_MINIMAL_ONLY");
  const range = options.range ? rangeSchema.parse(options.range) : null;
  if (range && range.end <= range.start) throw Error("INVALID_SOURCE_RANGE");
  await safePath(options.outputRoot, true);
  const check = await doctor(config, options.input, options.audioTrack, runner);
  if (!check.media) throw Error("BOUNDED_INPUT_REQUIRED");
  const identities = Object.fromEntries(
    await Promise.all(
      Object.entries({
        input: options.input,
        model: check.config.model,
        runtime: check.config.runtime,
        ffmpeg: check.config.ffmpeg,
        ffprobe: check.config.ffprobe,
      }).map(async ([k, v]) => [k, await fp(v)]),
    ),
  );
  options.signal?.throwIfAborted();
  await fs.mkdir(options.outputRoot, { recursive: true });
  const task = await fs.mkdtemp(
    path.join(path.resolve(options.outputRoot), "subtitle-bounded-"),
  );
  try {
    options.progress?.("提取完整 PCM 并冻结有界分块计划（此阶段不调用 ASR）");
    const audio = path.join(task, "audio.wav");
    await runner.run(
      check.config.ffmpeg,
      [
        "-nostdin",
        "-n",
        "-v",
        "error",
        "-i",
        path.resolve(options.input),
        "-map",
        `0:${check.media.track}`,
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
        audio,
      ],
      { timeoutMs: 3600000 },
    );
    const pcm = readPcm(await fs.readFile(audio));
    if (
      pcm.sampleRate !== 16000 ||
      pcm.frames / pcm.sampleRate + check.media.audioOffset >
        check.media.duration + 0.1
    )
      throw Error("BOUNDED_EXTRACTED_TIMEBASE_INVALID");
    const firstFrame = range
      ? Math.round((range.start - check.media.audioOffset) * pcm.sampleRate)
      : 0;
    const endFrame = range
      ? Math.round((range.end - check.media.audioOffset) * pcm.sampleRate)
      : pcm.frames;
    if (firstFrame < 0 || endFrame > pcm.frames || endFrame <= firstFrame)
      throw Error("SOURCE_RANGE_OUTSIDE_AUDIO");
    const frames = endFrame - firstFrame;
    const repo = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../..",
    );
    const software = await Promise.all(
      [
        "scripts/lib/bounded-product.mjs",
        "scripts/lib/bounded-asr-ab.mjs",
        "scripts/lib/default-content-recovery.mjs",
        "scripts/lib/content-safety-gate.mjs",
        "scripts/lib/recovery-evidence-guard.mjs",
        "packages/video-subtitler/dist/standalone/tool.js",
        "packages/video-subtitler/dist/standalone/bounded.js",
        "packages/video-subtitler/dist/standalone/recovery.js",
        "packages/video-subtitler/dist/standalone/assembly.js",
        "packages/subtitle-core/dist/format.js",
        "packages/subtitle-core/dist/parse.js",
        "packages/subtitle-core/dist/time.js",
      ].map((n) => fp(path.join(repo, n))),
    );
    const effectiveStart =
      check.media.audioOffset + firstFrame / pcm.sampleRate;
    const p = planSchema.parse({
      version: BOUNDED_PRODUCT_VERSION,
      createdAt: now(),
      config: check.config,
      identities,
      software,
      configHash: digest(check.config),
      policyHash: digest(POLICY),
      track: check.media.track,
      duration: check.media.duration,
      origin: check.media.origin,
      audioOffset: check.media.audioOffset,
      requestedRange: range,
      effectiveRange: {
        start: effectiveStart,
        end: effectiveStart + frames / pcm.sampleRate,
      },
      coverageScope: range ? "selected-source-range" : "full-audio",
      audioHash: await fileHash(audio),
      pcmHash: byteHash(pcm.data),
      sampleRate: 16000,
      fullFrames: pcm.frames,
      firstFrame,
      frames,
      chunks: planChunks(frames, pcm.sampleRate, []),
      rawJson: check.versions.whisperHelp.includes("--output-json-full"),
      audioGuardVersion: AUDIO_GUARD_VERSION,
      decode: {
        prompt: null,
        vad: false,
        coreML: false,
        suppressNst: true,
        timestamp: "segment",
        requestIsolation: "independent-cli-process",
        tokenEvidence: "NOT_VALIDATED",
      },
    });
    await checkExternal(p);
    await durable(path.join(task, "bounded-plan.json"), p, true);
    await durable(path.join(task, "preflight.json"), check, true);
    const m = boundedTaskSchema.parse({
      version: BOUNDED_PRODUCT_VERSION,
      planHash: digest(p),
      updatedAt: now(),
      executionStatus: "queued",
      artifactIntegrity: "pending",
      qualityStatus: "needs-review",
      finalizationMethod: "none",
      humanValidated: false,
      machineOnlyReleaseAuthorized: false,
      contentQuality: "NOT_MEASURED",
      coverageScope: p.coverageScope,
      attempts: [],
      files: {
        "audio.wav": p.audioHash,
        "bounded-plan.json": await fileHash(
          path.join(task, "bounded-plan.json"),
        ),
        "preflight.json": await fileHash(path.join(task, "preflight.json")),
      },
      outputs: [],
      recordCount: 0,
      unresolvedCount: 0,
      aliasCount: 0,
      exportedCount: 0,
      error: null,
    });
    await save(task, m);
    return task;
  } catch (error) {
    await durable(
      path.join(task, "PREPARATION_FAILED.json"),
      { error: String(error), asrRequests: 0 },
      true,
    );
    throw Error(`${error}; task: ${task}`, { cause: error });
  }
}

async function lockTask(task, recoverLock) {
  const name = path.join(task, ".bounded-lock");
  await safePath(name, true);
  if (recoverLock && (await present(name))) {
    const prior = await json(name);
    if (!Number.isSafeInteger(prior.pid) || prior.pid <= 0)
      throw Error("INVALID_BOUNDED_LOCK");
    try {
      process.kill(prior.pid, 0);
      throw Error("BOUNDED_TASK_STILL_RUNNING");
    } catch (e) {
      if (e.code !== "ESRCH") throw e;
    }
    await fs.unlink(name);
  }
  await durable(name, { pid: process.pid }, true);
  return async () => fs.unlink(name);
}

async function deliver(task, m, p, exportPartial) {
  const records = [];
  for (const a of m.attempts.filter((v) => v.state === "completed")) {
    const bytes = await fs.readFile(local(task, a.rawPath));
    const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    records.push(
      ...mapRaw(
        content,
        a.rawHash,
        p.chunks.find((c) => c.id === a.chunkId),
        p.sampleRate,
        p.effectiveRange.start,
        p.duration,
        a.id,
      ),
    );
  }
  // Raw text is retained even if one legal-time record cannot survive every subtitle format.
  for (const record of records) {
    if (record.issues.length) continue;
    try {
      serializeRecords([record], p.config.language);
    } catch (error) {
      record.issues.push(`SERIALIZATION_NOT_LOSSLESS:${String(error)}`);
    }
  }
  const result = boundaryDedup(records, p.chunks, p.sampleRate);
  const zeroChunks = p.audioGuardVersion
    ? p.chunks.filter((c) => m.files[`zero-audio/${c.id}.json`])
    : [];
  const emptyChunks = p.chunks.filter(
    (c) => !records.some((r) => r.chunkId === c.id) && !zeroChunks.includes(c),
  );
  const partial =
    result.unresolved.length > 0 ||
    emptyChunks.length > 0 ||
    m.attempts.filter((a) => a.state === "completed").length +
      zeroChunks.length !==
      p.chunks.length;
  await put(task, m, "mapped-records.json", {
    timebase: "source-global-relative-to-container-origin",
    coverageScope: p.coverageScope,
    effectiveRange: p.effectiveRange,
    records,
  });
  await put(
    task,
    m,
    "transcript.full.txt",
    records.map((r) => r.text ?? r.rawBlock).join("\n") + "\n",
  );
  await put(task, m, "timing-issues.json", {
    unresolved: result.unresolved,
    emptyChunks: emptyChunks.map((c) => c.id),
    emptyResponseMeansNoSpeech: false,
    ...(p.audioGuardVersion
      ? { verifiedDigitalZeroChunks: zeroChunks.map((c) => c.id) }
      : {}),
  });
  await put(task, m, "boundary-decisions.json", {
    decisions: result.decisions,
    aliases: result.aliases,
  });
  const retained = result.retained.toSorted(
    (a, b) =>
      a.sourceStart - b.sourceStart ||
      a.chunkIndex - b.chunkIndex ||
      a.order - b.order,
  );
  let cues = [];
  if (
    retained.length &&
    (!partial ||
      exportPartial ||
      m.outputs.some((name) => name.includes(".partial.")))
  ) {
    const serialized = serializeRecords(retained, p.config.language);
    cues = serialized.cues;
    const stem = partial
      ? "primary-minimal.bounded.partial"
      : "primary-minimal.bounded.machine-draft";
    for (const [ext, value] of Object.entries(serialized.files)) {
      const relative = `subtitles/${stem}.${ext}`;
      await put(task, m, relative, value);
      const parsed = formats[ext].parse(
        await fs.readFile(local(task, relative), "utf8"),
      );
      if (
        parsed.length !== cues.length ||
        parsed.some(
          (c, i) =>
            c.text !== cues[i].text ||
            c.start !== cues[i].start ||
            c.end !== cues[i].end,
        )
      )
        throw Error("BOUNDED_DISK_ROUNDTRIP_FAILURE");
      if (!m.outputs.includes(relative)) m.outputs.push(relative);
    }
    await put(task, m, "export-map.json", {
      coverageScope: p.coverageScope,
      effectiveRange: p.effectiveRange,
      partial,
      records: cues.map((c, i) => ({
        ordinal: i + 1,
        recordId: c.id,
        start: c.start,
        end: c.end,
      })),
      omittedRecordIds: result.unresolved.map((r) => r.recordId),
      aliases: result.aliases,
    });
  }
  m.recordCount = records.length;
  m.unresolvedCount = result.unresolved.length;
  m.aliasCount = Object.keys(result.aliases).length;
  m.exportedCount = cues.length;
  m.executionStatus = partial ? "partial" : "completed";
  m.artifactIntegrity = "passed";
  m.error = partial
    ? "完整定时交付未完成；原始记录保留，成功请求不会自动重跑"
    : null;
  // Two immutable indexes allow an explicit later partial export without overwriting the first view.
  const index = m.outputs.length ? "OUTPUT_INDEX.md" : "TRANSCRIPT_INDEX.md";
  await put(
    task,
    m,
    index,
    `# 有界 ASR 机器草稿（needs-review）\n\n范围：${p.coverageScope}，${p.effectiveRange.start}–${p.effectiveRange.end} 秒。${p.requestedRange ? "仅为用户选择的局部范围，不代表整片完整性。" : "完整音频范围不代表所有对白已识别。"}\n\n${m.outputs.map((n) => `- [${n}](${n})`).join("\n")}\n\n[全部原始映射记录](mapped-records.json) · [全文](transcript.full.txt) · [时间问题](timing-issues.json)\n\n记录 ${records.length}，时间未解决 ${m.unresolvedCount}，边界别名 ${m.aliasCount}，导出 ${cues.length}。${partial ? "此次为部分结果。使用 resume --export-partial 显式导出合法子集。" : ""}\n\n不验证声学正确性；未读取参考稿，不自动校正文本或生成词级时间。JSON sidecar 仅为原始证据，token 时间能力尚未验证。\n`,
  );
  await save(task, m);
}

export async function resumeBounded(task, options = {}) {
  task = path.resolve(task);
  await safePath(task);
  const unlock = await lockTask(task, options.recoverLock);
  let m;
  try {
    const loaded = await read(task),
      p = loaded.p;
    m = loaded.m;
    await checkExternal(p);
    if (m.attempts.some((a) => a.state === "running"))
      throw Error("INTERRUPTED_ATTEMPT_REQUIRES_INSPECTION_NO_AUTOMATIC_RETRY");
    const pcm = readPcm(await fs.readFile(path.join(task, "audio.wav")));
    if (pcm.frames !== p.fullFrames || byteHash(pcm.data) !== p.pcmHash)
      throw Error("BOUNDED_PCM_CHANGED");
    const runner = options.runner ?? new EvidenceRunner(options.signal);
    m.executionStatus = "running";
    m.error = null;
    await save(task, m);
    for (const c of p.chunks) {
      options.signal?.throwIfAborted();
      if (m.attempts.some((a) => a.chunkId === c.id && a.state === "completed"))
        continue;
      if (p.audioGuardVersion) {
        const evidence = pcmEvidence(
          pcm,
          p.firstFrame + c.inputStart,
          p.firstFrame + c.inputEnd,
        );
        if (evidence.allSamplesExactlyZero) {
          await put(task, m, `zero-audio/${c.id}.json`, {
            ...evidence,
            chunkId: c.id,
            audioHash: p.audioHash,
            pcmHash: p.pcmHash,
            sourceStart: p.effectiveRange.start + c.inputStart / p.sampleRate,
            sourceEnd: p.effectiveRange.start + c.inputEnd / p.sampleRate,
            decision: "skipped-digital-zero",
            asrRequests: 0,
          });
          await save(task, m);
          await options.onChunkCompleted?.({ chunkId: c.id, rows: [] });
          continue;
        }
      }
      for (;;) {
        options.signal?.throwIfAborted();
        const reserved = reserveAttempt(
          p.chunks,
          p.sampleRate,
          m.attempts,
          c.id,
        );
        const id = `${c.id}-attempt-${m.attempts.filter((a) => a.chunkId === c.id).length + 1}`;
        const dir = `requests/${id}`,
          audio = `${dir}/input.wav`,
          prefix = local(task, `${dir}/response`);
        const wav = slicePcm(
          pcm,
          p.firstFrame + c.inputStart,
          p.firstFrame + c.inputEnd,
        );
        await put(task, m, audio, wav);
        const args = [
          "--model",
          p.config.model,
          "--file",
          local(task, audio),
          "--language",
          p.config.language,
          "--threads",
          String(p.config.threads),
          "--output-srt",
          ...(p.rawJson ? ["--output-json-full"] : []),
          "--output-file",
          prefix,
          "--suppress-nst",
          "--no-prints",
        ];
        await put(task, m, `${dir}/request.json`, {
          id,
          chunk: c,
          planHash: m.planHash,
          inputHash: m.files[audio],
          sourceOffset: p.effectiveRange.start + c.inputStart / p.sampleRate,
          executable: p.config.runtime,
          args,
        });
        const a = {
          ...reserved,
          id,
          startedAt: now(),
          endedAt: null,
          error: null,
          rawPath: null,
          rawHash: null,
        };
        m.attempts.push(a);
        // Reservation and exact invocation are durable before process creation.
        await save(task, m);
        options.progress?.(
          `${c.id} ${c.index + 1}/${p.chunks.length}：${reserved.seconds.toFixed(3)} 秒；独立本地请求`,
        );
        try {
          const result = await runner.run(p.config.runtime, args, {
            timeoutMs: 300000,
            cwd: local(task, dir),
          });
          await put(task, m, `${dir}/stdout.log`, result.stdout);
          await put(task, m, `${dir}/stderr.log`, result.stderr);
          await put(task, m, `${dir}/exit.json`, {
            exitCode: result.exitCode,
            signal: result.signal ?? null,
          });
          if (result.exitCode !== 0 || result.signal)
            throw Error(
              `BOUNDED_PROCESS_FAILED:${result.exitCode}:${result.signal ?? ""}`,
            );
          const bytes = await fs.readFile(prefix + ".srt");
          a.rawPath = `${dir}/raw-response.srt`;
          await put(task, m, a.rawPath, bytes);
          a.rawHash = m.files[a.rawPath];
          a.state = "completed";
          a.endedAt = now();
          // Valid process success is checkpointed before parsing or optional JSON processing.
          await save(task, m);
          if (p.rawJson && (await present(prefix + ".json"))) {
            await put(
              task,
              m,
              `${dir}/raw-response.json`,
              await fs.readFile(prefix + ".json"),
            );
            await save(task, m);
          }
          // Only generateBounded supplies this callback. Resume never renews a
          // content budget or retries successful evidence for quality reasons.
          await options.onChunkCompleted?.({
            chunkId: c.id,
            rows: mapRaw(
              new TextDecoder("utf-8", { fatal: true }).decode(bytes),
              a.rawHash,
              c,
              p.sampleRate,
              p.effectiveRange.start,
              p.duration,
              a.id,
            ),
          });
          break;
        } catch (error) {
          if (a.state === "completed") throw error;
          a.state = options.signal?.aborted ? "cancelled" : "failed";
          a.endedAt = now();
          a.error = String(error);
          await save(task, m);
          if (options.signal?.aborted) throw error;
          // Existing reserveAttempt grants one technical retry across the entire task.
        }
      }
    }
    await checkExternal(p);
    await deliver(task, m, p, options.exportPartial === true);
    return {
      task,
      ...m,
      outputIndex: path.join(
        task,
        m.outputs.length ? "OUTPUT_INDEX.md" : "TRANSCRIPT_INDEX.md",
      ),
      recordsPath: path.join(task, "mapped-records.json"),
    };
  } catch (error) {
    if (m) {
      m.executionStatus = options.signal?.aborted ? "cancelled" : "failed";
      m.error = String(error);
      m.artifactIntegrity = "failed";
      await save(task, m);
    }
    throw Error(`${error}; task: ${task}`, { cause: error });
  } finally {
    await unlock();
  }
}

export async function generateBounded(options) {
  const task = await createBoundedTask(options);
  const { createContentRecovery } =
    await import("./default-content-recovery.mjs");
  const { p } = await read(task);
  const pcm = readPcm(await fs.readFile(path.join(task, "audio.wav")));
  const recovery = await createContentRecovery(task, p, pcm, {
    ...options,
    enabled: options.recoverContent !== false,
    runner: options.runner ?? new EvidenceRunner(options.signal),
  });
  const result = await resumeBounded(task, {
    ...options,
    onChunkCompleted: recovery.onChunk,
  });
  await read(task); // raw identity must still hold after the optional local round
  return { ...result, contentRecovery: await recovery.finish(result) };
}

/** Read-only local-artifact status; no runtime/model/source access or inference. */
export async function statusBounded(task) {
  task = path.resolve(task);
  const { m, p } = await read(task);
  const { readContentRecovery } =
    await import("./default-content-recovery.mjs");
  return {
    task,
    ...m,
    strategy: "bounded",
    config: p.config,
    inputHash: p.identities.input.sha256,
    duration: p.duration,
    range: p.requestedRange,
    effectiveRange: p.effectiveRange,
    plan: p,
    chunks: p.chunks.length,
    requestedAudioSeconds: m.attempts.reduce((s, a) => s + a.seconds, 0),
    newASRRequests: 0,
    recordsPath: path.join(task, "mapped-records.json"),
    contentRecovery: await readContentRecovery(task),
  };
}
