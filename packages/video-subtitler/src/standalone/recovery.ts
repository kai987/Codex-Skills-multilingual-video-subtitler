/** Offline recovery. Never follows historical input/model paths or invokes a provider. */
import {
  readFile,
  writeFile,
  mkdir,
  mkdtemp,
  lstat,
  open,
  rename,
  rm,
  readdir,
} from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";
import { createHash } from "node:crypto";
import { z } from "zod";
import { subtitleCueSchema, type SubtitleCue } from "@mvl/shared";
import {
  parseSrt,
  parseVtt,
  parseAss,
  formatSrt,
  formatVtt,
  formatAss,
} from "@mvl/subtitle-core";
import { manifestSchema, fileHash, type TaskManifest } from "./tool.js";
import { digest } from "./assembly.js";

export const RECOVERY_VERSION = "subtitle-tool-v1.0.1-recovery-2";
function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw Error("Missing bound record value");
  return value;
}
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const byteHash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
export const rawRecordSchema = z
  .object({
    recordId: z.string(),
    order: z.number().int().positive(),
    displayId: z.string().nullable(),
    firstLine: z.number().int().positive(),
    lastLine: z.number().int().positive(),
    rawBlock: z.string(),
    rawStart: z.string().nullable(),
    rawEnd: z.string().nullable(),
    localStart: z.number().nullable(),
    localEnd: z.number().nullable(),
    sourceStart: z.number().nullable(),
    sourceEnd: z.number().nullable(),
    text: z.string().nullable(),
    parseStatus: z.enum(["PARSED", "UNPARSED"]),
    issues: z.array(z.string()),
  })
  .strict();
export type RawRecord = z.infer<typeof rawRecordSchema>;
export const recoverySchema = z
  .object({
    version: z.literal(RECOVERY_VERSION),
    taskId: z.string(),
    taskHash: hash,
    rawHash: hash,
    recoveryId: z.string(),
    sourceIdentity: hash,
    sourceDuration: z.number().positive(),
    audioOffset: z.number().nonnegative(),
    origin: z.number(),
    metadataProvenance: z.literal("SAVED_SUCCESSFUL_TASK_METADATA"),
    sourceReverification: z.literal("NOT_RUN_SOURCE_UNAVAILABLE"),
    sourceReverificationNote: z.literal(
      "Historical paths are not accessed; availability is not probed.",
    ),
    originalExecutionStatus: z.string(),
    originalArtifactIntegrity: z.string(),
    asrAttempt: z.literal("completed"),
    executionStatus: z.literal("partial"),
    fullTimedExport: z.literal("not-produced"),
    recoveryIntegrity: z.literal("passed"),
    partialSubtitle: z.enum([
      "not-requested",
      "generated",
      "no-eligible-records",
      "failed",
    ]),
    qualityStatus: z.literal("needs-review"),
    finalizationMethod: z.literal("none"),
    humanValidated: z.literal(false),
    machineOnlyReleaseAuthorized: z.literal(false),
    profile: z.literal("primary-minimal"),
    recordCount: z.number().int().nonnegative(),
    eligibleIds: z.array(z.string()),
    unresolvedIds: z.array(z.string()),
    textExtractionComplete: z.boolean(),
    warnings: z.array(z.string()),
    files: z.record(z.string(), hash),
    exportError: z.string().nullable(),
    newASRRequests: z.literal(0),
    newModelInference: z.literal(0),
    newModelLoads: z.literal(0),
    newProviderStarts: z.literal(0),
    newAudioExtractions: z.literal(0),
    newAudioWindows: z.literal(0),
  })
  .strict();
type Recovery = z.infer<typeof recoverySchema>;
export const editedValidationSchema = z
  .object({
    version: z.literal(RECOVERY_VERSION),
    taskHash: hash,
    rawHash: hash,
    inputHash: hash,
    timebase: z.enum(["audio", "source"]),
    formatIntegrity: z.enum(["passed", "failed"]),
    sourceTextAccounting: z.enum([
      "ALL_RECORDS_IN_ORDER_TEXT_PRESERVED",
      "SOURCE_COMPLETENESS_UNPROVEN",
    ]),
    contentChange: z.enum(["TIMING_OR_DISPLAY_ONLY", "USER_CONTENT_CHANGED"]),
    originalRecords: z.number().int().nonnegative(),
    editedRecords: z.number().int().nonnegative(),
    userEdited: z.literal(true),
    acousticCorrectness: z.literal("NOT_VERIFIED"),
    humanValidated: z.literal(false),
    machineOnlyReleaseAuthorized: z.literal(false),
    finalizationMethod: z.literal("none"),
    qualityStatus: z.literal("needs-review"),
    styleConversion: z.string(),
    textComparison: z.string(),
    issues: z.array(rawRecordSchema),
    newASRRequests: z.literal(0),
    newModelInference: z.literal(0),
    newModelLoads: z.literal(0),
    newProviderStarts: z.literal(0),
    newAudioExtractions: z.literal(0),
    newAudioWindows: z.literal(0),
    files: z.record(z.string(), hash).optional(),
  })
  .strict();
type Format = "srt" | "vtt" | "ass";
const formats = {
  srt: { parse: parseSrt, format: formatSrt },
  vtt: { parse: parseVtt, format: formatVtt },
  ass: { parse: parseAss, format: formatAss },
};
const zeroWork = {
  newASRRequests: 0,
  newModelInference: 0,
  newModelLoads: 0,
  newProviderStarts: 0,
  newAudioExtractions: 0,
  newAudioWindows: 0,
} as const;
const decode = (bytes: Buffer) =>
  new TextDecoder("utf-8", { fatal: true }).decode(bytes);
const linesOf = (text: string) =>
  text
    .replace(/^\uFEFF/u, "")
    .replace(/\r\n?/gu, "\n")
    .split("\n");

/** Small bookkeeping wrapper around existing parsers; unknown blocks cannot disappear. */
export function rawRecords(
  content: string,
  identity: string,
  format: Format = "srt",
): RawRecord[] {
  const lines = linesOf(content);
  const blocks: { lines: string[]; line: number; assFormat?: string }[] = [];
  if (format === "ass") {
    let events = false,
      declaration = "";
    for (const [i, line] of lines.entries()) {
      const trimmed = line.trim();
      if (trimmed.startsWith("[")) {
        events = trimmed.toLowerCase() === "[events]";
        continue;
      }
      if (!events) {
        if (/^Dialogue:/iu.test(trimmed))
          blocks.push({ lines: [line], line: i + 1 });
        continue;
      }
      if (!trimmed || trimmed.startsWith(";")) continue;
      if (/^Format:/iu.test(trimmed)) {
        declaration = trimmed;
        continue;
      }
      if (/^Comment:/iu.test(trimmed)) continue;
      blocks.push({ lines: [line], line: i + 1, assFormat: declaration });
    }
    if (!blocks.length && content.trim()) blocks.push({ lines, line: 1 });
  } else {
    for (let i = 0; i < lines.length;) {
      if (!lines[i]?.trim()) {
        i++;
        continue;
      }
      const first = i;
      while (i < lines.length && lines[i]?.trim()) i++;
      const chunk = lines.slice(first, i);
      if (
        format === "vtt" &&
        first === 0 &&
        chunk[0]?.startsWith("WEBVTT") &&
        chunk.length === 1
      )
        continue;
      // NOTE/STYLE/REGION are preserved as unparsed rather than silently skipped.
      blocks.push({ lines: chunk, line: first + 1 });
    }
  }
  return blocks.map((block, index) => {
    const r: RawRecord = {
      recordId: `raw-${digest([identity, index + 1]).slice(0, 24)}`,
      order: index + 1,
      displayId: null,
      firstLine: block.line,
      lastLine: block.line + block.lines.length - 1,
      rawBlock: block.lines.join("\n"),
      rawStart: null,
      rawEnd: null,
      localStart: null,
      localEnd: null,
      sourceStart: null,
      sourceEnd: null,
      text: null,
      parseStatus: "UNPARSED",
      issues: [],
    };
    if (format === "ass") {
      try {
        const names = (block.assFormat ?? "")
          .replace(/^Format:/iu, "")
          .split(",")
          .map((s) => s.trim().toLowerCase());
        const values = r.rawBlock.replace(/^\s*Dialogue:\s*/iu, "").split(",");
        if (
          !/^\s*Dialogue:/iu.test(r.rawBlock) ||
          names.at(-1) !== "text" ||
          values.length < names.length ||
          !names.includes("start") ||
          !names.includes("end")
        )
          throw Error("Unknown ASS event");
        r.rawStart = values[names.indexOf("start")] ?? null;
        r.rawEnd = values[names.indexOf("end")] ?? null;
        const clock = (s: string | null) => {
          if (!s || !/^-?\d{1,2}:[0-5]\d:[0-5]\d\.\d{1,2}$/u.test(s.trim()))
            return null;
          const negative = s.trim().startsWith("-");
          const clean = negative ? s.trim().slice(1) : s.trim();
          const c = required(
            parseAss(
              `[Events]\nFormat: Start, End, Text\nDialogue: ${clean},0:00:01.00,x`,
            )[0],
          );
          return negative ? -c.start : c.start;
        };
        r.localStart = clock(r.rawStart);
        r.localEnd = clock(r.rawEnd);
        const body = values.slice(names.length - 1).join(",");
        try {
          r.text = required(
            parseAss(
              `[Events]\nFormat: Start, End, Text\nDialogue: 0:00:00.00,0:00:01.00,${body}`,
            )[0],
          ).text;
        } catch {
          r.text = body;
        }
        if (r.localStart !== null && r.localEnd !== null && r.text.trim())
          r.parseStatus = "PARSED";
      } catch {
        /* full raw event is retained */
      }
    } else {
      const at = block.lines[0]?.includes("-->") ? 0 : 1;
      r.displayId = at === 1 ? (block.lines[0] ?? null) : null;
      const timing = block.lines[at];
      if (timing?.includes("-->")) {
        const parts = timing.split("-->");
        r.rawStart = parts[0]?.trim() ?? null;
        r.rawEnd = parts[1]?.trim().split(/\s+/u)[0] ?? null;
        r.text = block.lines.slice(at + 1).join("\n");
        const clock = (s: string | null) => {
          if (s === null) return null;
          try {
            const negative = s.startsWith("-");
            const value = required(
              parseSrt(
                `1\n${negative ? s.slice(1) : s} --> 00:00:01,000\nx`,
              )[0],
            ).start;
            return Number.isFinite(value) ? (negative ? -value : value) : null;
          } catch {
            return null;
          }
        };
        if (parts.length === 2) {
          r.localStart = clock(r.rawStart);
          r.localEnd = clock(r.rawEnd);
        }
        if (r.localStart !== null && r.localEnd !== null && r.text.trim())
          r.parseStatus = "PARSED";
      }
    }
    return rawRecordSchema.parse(r);
  });
}

function cue(
  r: RawRecord,
  language: TaskManifest["config"]["language"],
): SubtitleCue {
  return subtitleCueSchema.parse({
    id: r.recordId,
    start: Math.round(required(r.sourceStart) * 100) / 100,
    end: Math.round(required(r.sourceEnd) * 100) / 100,
    text: r.text,
    language,
    languages: [language],
    speaker: null,
    confidence: null,
  });
}
function sameCues(
  expected: SubtitleCue[],
  text: string,
  format: Format,
  duration: number,
) {
  const parsed = formats[format].parse(text);
  if (
    parsed.length !== expected.length ||
    parsed.some((c, i) => {
      const e = required(expected[i]);
      return (
        c.text !== e.text ||
        !Number.isFinite(c.start) ||
        !Number.isFinite(c.end) ||
        c.start < 0 ||
        c.start >= c.end ||
        c.end > duration + 0.05 ||
        Math.abs(c.start - e.start) > 0.001 ||
        Math.abs(c.end - e.end) > 0.001
      );
    })
  )
    throw Error(`TEXT_OR_TIMING_ROUNDTRIP_FAILED:${format}`);
}
export function classifyRecords(
  records: RawRecord[],
  m: TaskManifest,
  timebase: "audio" | "source" = "audio",
) {
  const success = m.attempts.filter((a) => a.state === "completed");
  const audioDuration = success.at(-1)?.reservedAudioSeconds;
  if (!audioDuration || !Number.isFinite(audioDuration))
    throw Error("缺少成功请求的音频时长");
  const offset = timebase === "audio" ? m.audioOffset : 0;
  for (const r of records) {
    r.issues = [];
    const s = r.localStart,
      e = r.localEnd;
    if (s === null || e === null || !Number.isFinite(s) || !Number.isFinite(e))
      r.issues.push("NONFINITE_OR_UNPARSED_TIME");
    else {
      r.sourceStart = s + offset;
      r.sourceEnd = e + offset;
      if (s < 0 || e < 0) r.issues.push("NEGATIVE_TIME");
      if (s === e) r.issues.push("ZERO_DURATION");
      if (e < s) r.issues.push("REVERSED_INTERVAL");
      if (
        (timebase === "audio" && e > audioDuration + 0.05) ||
        r.sourceEnd > m.duration + 0.05 ||
        r.sourceStart > m.duration + 0.05
      )
        r.issues.push("OUT_OF_SOURCE_RANGE");
    }
    if (!r.text?.trim()) r.issues.push("EMPTY_OR_UNPARSED_TEXT");
    if (!r.issues.length) {
      if (
        Math.round(required(r.sourceEnd) * 100) <=
        Math.round(required(r.sourceStart) * 100)
      )
        r.issues.push("SERIALIZATION_COLLAPSE");
      else {
        try {
          const c = cue(r, m.config.language);
          for (const f of Object.keys(formats) as Format[])
            sameCues([c], formats[f].format([c]), f, m.duration);
        } catch {
          r.issues.push("SERIALIZATION_TEXT_OR_TIMING_LOSS");
        }
      }
    }
  }
  const eligible = records.filter((r) => !r.issues.length),
    unresolved = records.filter((r) => r.issues.length);
  const warnings = ["MACHINE_TEXT_AND_ACOUSTIC_BOUNDARIES_NOT_VERIFIED"];
  if (
    eligible.some(
      (r, i) =>
        i > 0 && required(r.sourceStart) < required(eligible[i - 1]?.sourceEnd),
    )
  )
    warnings.push("OVERLAPPING_OR_UNORDERED_CUES_PRESERVED");
  if (new Set(records.map((r) => r.text)).size < records.length)
    warnings.push("REPEATED_TEXT_PRESERVED_NOT_CONFIRMED_SPEECH");
  if (
    records.some(
      (r) =>
        (r.text?.split("\n").length ?? 0) > 2 ||
        r.text?.split("\n").some((line) => Array.from(line).length > 16),
    )
  )
    warnings.push("PRESENTATION_OVERFLOW_TEXT_PRESERVED");
  if (
    new Set(records.map((r) => r.recordId)).size !== records.length ||
    eligible.length + unresolved.length !== records.length
  )
    throw Error("记录对账失败");
  return {
    records,
    eligible,
    unresolved,
    cues: eligible.map((r) => cue(r, m.config.language)),
    warnings,
  };
}

/** Reject symlink components, including explicit output-root; do not inspect manifest paths. */
export async function safePath(p: string, allowMissing = false) {
  const absolute = path.resolve(p);
  let part = path.parse(absolute).root;
  for (const segment of absolute
    .slice(part.length)
    .split(path.sep)
    .filter(Boolean)) {
    part = path.join(part, segment);
    try {
      if ((await lstat(part)).isSymbolicLink())
        throw Error("不允许符号链接路径");
    } catch (e) {
      if (!(allowMissing && (e as NodeJS.ErrnoException).code === "ENOENT"))
        throw e;
    }
  }
  return absolute;
}
export async function readRecoverySource(task: string) {
  task = await safePath(task);
  const taskFile = await safePath(path.join(task, "task.json"));
  const rawFile = await safePath(path.join(task, "raw-primary.srt"));
  const taskBytes = await readFile(taskFile);
  const m = manifestSchema.parse(JSON.parse(decode(taskBytes)));
  if (
    m.configHash !== digest(m.config) ||
    !m.rawHash ||
    !m.audioHash ||
    m.attempts.filter((a) => a.state === "completed" && a.endedAt !== null)
      .length !== 1 ||
    !m.ownedFiles.includes("raw-primary.srt")
  )
    throw Error("没有可信的成功请求和原始响应绑定");
  const seconds = required(
    m.attempts.find((a) => a.state === "completed"),
  ).reservedAudioSeconds;
  if (
    !Number.isFinite(seconds) ||
    seconds <= 0 ||
    seconds + m.audioOffset > m.duration + 0.1
  )
    throw Error("保存的音频时长与源时间基冲突");
  const rawBytes = await readFile(rawFile);
  if (byteHash(rawBytes) !== m.rawHash)
    throw Error("原始响应身份 rawHash 不匹配；禁止重新识别");
  const text = decode(rawBytes);
  return {
    task,
    m,
    taskHash: byteHash(taskBytes),
    analysis: classifyRecords(rawRecords(text, m.rawHash), m),
  };
}
async function json(file: string, data: unknown) {
  await writeFile(file, JSON.stringify(data, null, 2) + "\n", { flag: "wx" });
}
async function hashes(
  dir: string,
  relative = "",
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const name of await readdir(path.join(dir, relative))) {
    const rel = path.join(relative, name),
      file = await safePath(path.join(dir, rel));
    if ((await lstat(file)).isDirectory())
      Object.assign(result, await hashes(dir, rel));
    else result[rel] = await fileHash(file);
  }
  return result;
}
async function validateFiles(dir: string, files: Record<string, string>) {
  for (const [relative, hash] of Object.entries(files)) {
    if (
      path.isAbsolute(relative) ||
      relative.split(/[\\/]/u).some((p) => p === ".." || p === "." || !p)
    )
      throw Error("非法产物相对路径");
    if ((await fileHash(await safePath(path.join(dir, relative)))) !== hash)
      throw Error("恢复产物已被修改；保留用户编辑，不覆盖");
  }
}
async function validateRecovery(
  dir: string,
  r: Recovery,
  source: Awaited<ReturnType<typeof readRecoverySource>>,
) {
  const a = source.analysis;
  if (
    r.taskHash !== source.taskHash ||
    r.rawHash !== source.m.rawHash ||
    r.recordCount !== a.records.length ||
    digest(r.eligibleIds) !== digest(a.eligible.map((x) => x.recordId)) ||
    digest(r.unresolvedIds) !== digest(a.unresolved.map((x) => x.recordId)) ||
    r.sourceIdentity !== source.m.inputHash ||
    r.sourceDuration !== source.m.duration ||
    r.audioOffset !== source.m.audioOffset
  )
    throw Error("恢复摘要与原始证据不符");
  await validateFiles(dir, r.files);
  for (const name of [
    "raw-records.json",
    "transcript.full.txt",
    "timing-issues.json",
    "TIMING_ISSUES.md",
    "OUTPUT_INDEX.md",
  ])
    if (!r.files[name]) throw Error("恢复清单缺少必需文件");
  const stored = JSON.parse(
    decode(await readFile(path.join(dir, "raw-records.json"))),
  ) as { records: unknown };
  if (digest(stored.records) !== digest(a.records))
    throw Error("原始记录对账失败");
  if (r.partialSubtitle === "generated") {
    if (!r.files["export-map.json"]) throw Error("缺少导出映射");
    const map = JSON.parse(
      decode(await readFile(path.join(dir, "export-map.json"))),
    ) as {
      recordId: string;
      outputNumber: number;
      start: number;
      end: number;
    }[];
    if (
      map.length !== a.cues.length ||
      map.some(
        (x, i) =>
          x.recordId !== required(a.cues[i]).id ||
          x.outputNumber !== i + 1 ||
          x.start !== required(a.cues[i]).start ||
          x.end !== required(a.cues[i]).end,
      )
    )
      throw Error("导出映射不匹配");
    for (const f of Object.keys(formats) as Format[]) {
      const file = `subtitles/primary-minimal.partial.${f}`;
      if (!r.files[file]) throw Error("缺少三格式哈希");
      sameCues(
        a.cues,
        decode(await readFile(path.join(dir, file))),
        f,
        source.m.duration,
      );
    }
  }
}
async function exportSet(
  dir: string,
  cues: SubtitleCue[],
  stem: string,
  duration: number,
  signal?: AbortSignal,
) {
  const stage = await mkdtemp(path.join(dir, ".formats-"));
  try {
    for (const f of Object.keys(formats) as Format[]) {
      signal?.throwIfAborted();
      const p = path.join(stage, `${stem}.${f}`);
      await writeFile(p, formats[f].format(cues), { flag: "wx" });
      sameCues(cues, decode(await readFile(p)), f, duration);
    }
    signal?.throwIfAborted();
    // One directory rename is the three-format transaction boundary.
    await rename(stage, path.join(dir, "subtitles"));
  } catch (e) {
    await rm(stage, { recursive: true, force: true });
    throw e;
  }
}
interface Options {
  outputRoot?: string;
  exportPartial?: boolean;
  signal?: AbortSignal;
}
export async function recoverTask(task: string, options: Options = {}) {
  options.signal?.throwIfAborted();
  const source = await readRecoverySource(task),
    { m, analysis, taskHash } = source;
  const root = await safePath(
    options.outputRoot ?? path.join(source.task, "recovery"),
    true,
  );
  await mkdir(root, { recursive: true });
  const id = digest([
    RECOVERY_VERSION,
    taskHash,
    m.rawHash,
    !!options.exportPartial,
  ]);
  const target = path.join(root, `recovery-${id.slice(0, 24)}`);
  const lock = await open(path.join(root, `.recovery-${id}.lock`), "wx");
  let stage: string | undefined;
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid }));
    try {
      const r = recoverySchema.parse(
        JSON.parse(
          decode(
            await readFile(await safePath(path.join(target, "recovery.json"))),
          ),
        ),
      );
      if (
        r.recoveryId !== id ||
        r.taskHash !== taskHash ||
        r.rawHash !== m.rawHash
      )
        throw Error("恢复绑定不匹配");
      await validateRecovery(target, r, source);
      return {
        directory: target,
        outputIndex: path.join(target, "OUTPUT_INDEX.md"),
        recovery: r,
        reused: true,
        exitCode: r.partialSubtitle === "failed" ? 1 : 2,
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    // Existing but incomplete directories are never overwritten.
    try {
      await lstat(target);
      throw Error("恢复目录不完整；拒绝覆盖");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    stage = await mkdtemp(path.join(root, ".recovery-stage-"));
    await json(path.join(stage, "raw-records.json"), {
      version: RECOVERY_VERSION,
      rawHash: m.rawHash,
      taskHash,
      records: analysis.records,
    });
    const full = analysis.records
      .flatMap((r) => (r.text === null ? [] : [r.text]))
      .join("\n\n");
    await writeFile(
      path.join(stage, "transcript.full.txt"),
      full + (full ? "\n" : ""),
    );
    const unparsed = analysis.records.filter((r) => r.text === null);
    if (unparsed.length)
      await json(path.join(stage, "unparsed-blocks.json"), unparsed);
    await json(path.join(stage, "timing-issues.json"), {
      unresolvedRecordCount: analysis.unresolved.length,
      records: analysis.unresolved,
    });
    await writeFile(
      path.join(stage, "TIMING_ISSUES.md"),
      `# 未解决记录（不是已确认的真实发话）\n\n${analysis.unresolved.map((r) => `- ${r.recordId}：顺序 ${r.order}，原编号 ${JSON.stringify(r.displayId)}，原行 ${r.firstLine}–${r.lastLine}；${r.issues.join(", ")}。邻接顺序 ${Math.max(1, r.order - 1)} / ${Math.min(analysis.records.length, r.order + 1)}；正文见 raw-records.json。`).join("\n")}\n`,
    );
    let partial: Recovery["partialSubtitle"] = options.exportPartial
        ? "no-eligible-records"
        : "not-requested",
      exportError: string | null = null;
    if (options.exportPartial && analysis.cues.length) {
      try {
        await exportSet(
          stage,
          analysis.cues,
          "primary-minimal.partial",
          m.duration,
          options.signal,
        );
        await json(
          path.join(stage, "export-map.json"),
          analysis.eligible.map((r, i) => ({
            outputNumber: i + 1,
            recordId: r.recordId,
            start: required(analysis.cues[i]).start,
            end: required(analysis.cues[i]).end,
          })),
        );
        partial = "generated";
      } catch (e) {
        options.signal?.throwIfAborted();
        partial = "failed";
        exportError = String(e);
        await rm(path.join(stage, "subtitles"), {
          recursive: true,
          force: true,
        });
        await rm(path.join(stage, "export-map.json"), { force: true });
      }
    }
    await writeFile(
      path.join(stage, "OUTPUT_INDEX.md"),
      `# 部分恢复：不是完整字幕或人工终稿\n\n原始记录 ${analysis.records.length}；可导出 ${analysis.eligible.length}；未解决 ${analysis.unresolved.length}。\n\n[完整可提取正文](transcript.full.txt) · [全部原始记录](raw-records.json) · [时间异常](TIMING_ISSUES.md)\n\n全文未知块 ${unparsed.length}（保留在 unparsed-blocks.json，如有）；重复正文不删除。时间合法不等于声学边界正确。\n\n部分字幕：${partial}。未解决内容没有进入部分字幕；三格式只在全部验证后提交。\n${partial === "generated" ? ["ass", "srt", "vtt"].map((f) => `- [primary-minimal.partial.${f}](subtitles/primary-minimal.partial.${f})`).join("\n") : "显式使用 recover --export-partial 才导出合法子集。"}\n\n旧 task.json 保持不变；本目录仅是恢复视图。再次 resume 不会产生新时间。完整交付未完成，退出码 2；技术故障为 1。内容 needs-review；finalizationMethod=none。\n`,
    );
    const r = recoverySchema.parse({
      version: RECOVERY_VERSION,
      taskId: m.taskId,
      taskHash,
      rawHash: m.rawHash,
      recoveryId: id,
      sourceIdentity: m.inputHash,
      sourceDuration: m.duration,
      audioOffset: m.audioOffset,
      origin: m.origin,
      metadataProvenance: "SAVED_SUCCESSFUL_TASK_METADATA",
      sourceReverification: "NOT_RUN_SOURCE_UNAVAILABLE",
      sourceReverificationNote:
        "Historical paths are not accessed; availability is not probed.",
      originalExecutionStatus: m.executionStatus,
      originalArtifactIntegrity: m.artifactIntegrity,
      asrAttempt: "completed",
      executionStatus: "partial",
      fullTimedExport: "not-produced",
      recoveryIntegrity: "passed",
      partialSubtitle: partial,
      qualityStatus: "needs-review",
      finalizationMethod: "none",
      humanValidated: false,
      machineOnlyReleaseAuthorized: false,
      profile: "primary-minimal",
      recordCount: analysis.records.length,
      eligibleIds: analysis.eligible.map((r) => r.recordId),
      unresolvedIds: analysis.unresolved.map((r) => r.recordId),
      textExtractionComplete: !unparsed.length,
      warnings: analysis.warnings,
      files: await hashes(stage),
      exportError,
      ...zeroWork,
    });
    await json(path.join(stage, "recovery.json"), r);
    options.signal?.throwIfAborted();
    // Recheck only allowlisted task/raw files before committing the view.
    const again = await readRecoverySource(source.task);
    if (again.taskHash !== taskHash || again.m.rawHash !== m.rawHash)
      throw Error("恢复期间原始身份发生变化");
    await rename(stage, target);
    stage = undefined;
    return {
      directory: target,
      outputIndex: path.join(target, "OUTPUT_INDEX.md"),
      recovery: r,
      reused: false,
      exitCode: partial === "failed" ? 1 : 2,
    };
  } finally {
    if (stage) await rm(stage, { recursive: true, force: true });
    await lock.close();
    await rm(path.join(root, `.recovery-${id}.lock`));
  }
}

export async function validateEdited(
  task: string,
  input: string,
  timebase: "audio" | "source" = "source",
  options: Pick<Options, "outputRoot" | "signal"> = {},
) {
  options.signal?.throwIfAborted();
  const source = await readRecoverySource(task);
  input = await safePath(input);
  const ext = path.extname(input).slice(1).toLowerCase();
  if (ext !== "srt" && ext !== "vtt" && ext !== "ass")
    throw Error("仅支持显式 SRT / VTT / ASS 修订文件");
  const inputHash = await fileHash(input);
  const editedText = decode(await readFile(input));
  if (ext === "vtt" && !linesOf(editedText)[0]?.startsWith("WEBVTT"))
    throw Error("VTT 缺少 WEBVTT 文件头");
  const analysis = classifyRecords(
    rawRecords(editedText, inputHash, ext),
    source.m,
    timebase,
  );
  const original = source.analysis.records;
  // Only line-break representation may differ; punctuation, width and spaces are not normalized.
  const displayText = (s: string | null) => s?.replaceAll("\n", "");
  const accounted =
    original.every((r) => r.text !== null) &&
    analysis.records.length === original.length &&
    original.every(
      (r, i) =>
        displayText(r.text) === displayText(required(analysis.records[i]).text),
    );
  const root = await safePath(
    options.outputRoot ?? path.join(source.task, "recovery"),
    true,
  );
  await mkdir(root, { recursive: true });
  const dir = await mkdtemp(path.join(root, "user-edited-"));
  const valid = analysis.records.length > 0 && !analysis.unresolved.length;
  const report = editedValidationSchema.parse({
    version: RECOVERY_VERSION,
    taskHash: source.taskHash,
    rawHash: source.m.rawHash,
    inputHash,
    timebase,
    formatIntegrity: valid ? "passed" : "failed",
    sourceTextAccounting: accounted
      ? "ALL_RECORDS_IN_ORDER_TEXT_PRESERVED"
      : "SOURCE_COMPLETENESS_UNPROVEN",
    contentChange: accounted
      ? "TIMING_OR_DISPLAY_ONLY"
      : "USER_CONTENT_CHANGED",
    originalRecords: original.length,
    editedRecords: analysis.records.length,
    userEdited: true,
    acousticCorrectness: "NOT_VERIFIED",
    humanValidated: false,
    machineOnlyReleaseAuthorized: false,
    finalizationMethod: "none",
    qualityStatus: "needs-review",
    styleConversion:
      "Existing parser visible-text projection; ASS styling is not losslessly preserved in SRT/VTT.",
    textComparison:
      "Exact ordered body comparison allowing only display line-break differences; no NFKC or punctuation deletion.",
    issues: analysis.unresolved,
    ...zeroWork,
  });
  await json(path.join(dir, "edited-records.json"), analysis.records);
  if (valid)
    await exportSet(
      dir,
      analysis.cues,
      "subtitle.user-edited",
      source.m.duration,
      options.signal,
    );
  if (
    (await fileHash(input)) !== inputHash ||
    (await readRecoverySource(source.task)).taskHash !== source.taskHash
  )
    throw Error("修订验证期间输入变化");
  await json(path.join(dir, "validation.json"), {
    ...report,
    files: await hashes(dir),
  });
  await writeFile(
    path.join(dir, "OUTPUT_INDEX.md"),
    `# 用户修订副本检查\n\n格式 ${report.formatIntegrity}；原始文字对账 ${report.sourceTextAccounting}。\n\n[验证报告](validation.json)。声学正确性未验证；humanValidated=false。\n\n${valid ? ["srt", "vtt", "ass"].map((f) => `- [subtitle.user-edited.${f}](subtitles/subtitle.user-edited.${f})`).join("\n") : "时间或文本问题未解决，没有定时导出。"}\n`,
  );
  return {
    directory: dir,
    outputIndex: path.join(dir, "OUTPUT_INDEX.md"),
    report,
    exitCode: valid && accounted ? 0 : 2,
  };
}

export async function recoveryStatus(task: string) {
  const source = await readRecoverySource(task);
  const root = path.join(source.task, "recovery");
  const results: Recovery[] = [];
  try {
    await safePath(root);
    for (const name of await readdir(root)) {
      if (!/^recovery-[a-f0-9]{24}$/u.test(name)) continue;
      const dir = path.join(root, name);
      const r = recoverySchema.parse(
        JSON.parse(
          decode(
            await readFile(await safePath(path.join(dir, "recovery.json"))),
          ),
        ),
      );
      if (r.taskHash !== source.taskHash || r.rawHash !== source.m.rawHash)
        continue;
      await validateRecovery(dir, r, source);
      results.push(r);
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  return {
    historicalTask: source.m,
    recoveryViews: results,
    note: "恢复视图与历史任务状态不同；外部 output-root 由恢复命令直接返回。",
  };
}
