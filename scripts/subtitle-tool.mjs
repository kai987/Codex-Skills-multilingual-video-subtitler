#!/usr/bin/env node
/* global AbortController */
import { Command, Option } from "commander";
import { setInterval, clearInterval } from "node:timers";
import fs from "node:fs/promises";
import path from "node:path";
import {
  auditTaskContent,
  deliverContentAudit,
  attachRecoveryContentAudit,
} from "./lib/content-audit-delivery.mjs";
import {
  configPath,
  loadConfig,
  saveConfig,
  doctor,
  createTask,
  readTask,
  runTask,
  recoverLock,
  checkWriteTarget,
} from "../packages/video-subtitler/dist/standalone/tool.js";
import {
  recoverTask,
  validateEdited,
  recoveryStatus,
} from "../packages/video-subtitler/dist/standalone/recovery.js";

const cli = new Command()
  .name("subtitle-tool")
  .description("独立字幕工具 v1 候选版 — 本地机器字幕草稿；不代表人工终稿")
  .showHelpAfterError();
const configuration = (command) =>
  command
    .option("--config <path>", "本地配置文件", configPath())
    .option("--model <path>", "Whisper GGML 模型路径")
    .option("--runtime <path>", "whisper-cli 可执行文件")
    .option("--language <language>", "识别语言 ja/en/zh")
    .addOption(
      new Option(
        "--profile <profile>",
        "组装配置（默认 primary-minimal）",
      ).choices(["primary-minimal", "g11"]),
    )
    .option("--threads <count>", "本地线程数", (v) => Number(v))
    .option("--ffmpeg <path>", "FFmpeg 可执行文件")
    .option("--ffprobe <path>", "ffprobe 可执行文件");
const configured = async (o) => {
  const {
    config,
    input,
    outputRoot,
    audioTrack,
    strategy,
    start,
    end,
    exportPartial,
    refineSeams,
    contextSeams,
    recoverContent,
    ...overrides
  } = o;
  void input;
  void outputRoot;
  void audioTrack;
  void strategy;
  void start;
  void end;
  void exportPartial;
  void refineSeams;
  void contextSeams;
  void recoverContent;
  return loadConfig(config, overrides);
};
configuration(
  cli
    .command("configure")
    .description("首次配置：保存模型、运行时和语言；不下载或加载模型"),
).action(async (o) => {
  await saveConfig(o.config, await configured(o));
  console.log(`配置已保存：${o.config}`);
});
configuration(
  cli.command("doctor").description("检查依赖和媒体音轨；零模型加载、零推理"),
)
  .option("--input <path>", "本地视频或音频")
  .option("--output-root <path>", "仅检查输出目录或最近父目录的写权限")
  .option("--audio-track <index>", "容器全局音轨索引", Number)
  .action(async (o) => {
    console.log(
      JSON.stringify(
        {
          ...(await doctor(await configured(o), o.input, o.audioTrack)),
          outputPermission: await checkWriteTarget(
            o.outputRoot ?? process.cwd(),
          ),
        },
        null,
        2,
      ),
    );
  });
async function execute(task, profile) {
  task = await fs.realpath(task);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  const started = Date.now();
  const tick = setInterval(
    () =>
      console.log(
        `任务运行中，已用时 ${Math.floor((Date.now() - started) / 1000)} 秒；没有估算百分比`,
      ),
    30000,
  );
  tick.unref();
  try {
    const result = await runTask(task, {
      ...(profile ? { profile } : {}),
      signal: controller.signal,
      progress: (message) => console.log(message),
    });
    // The existing generator accepts macOS /var aliases. Audit the canonical
    // task directory, while still rejecting symlinked checkpoint files inside it.
    const contentAudit = result.rawHash
      ? await auditTaskContent(await fs.realpath(task))
      : null;
    console.log(
      JSON.stringify(
        {
          task,
          executionStatus: result.executionStatus,
          artifactIntegrity: result.artifactIntegrity,
          qualityStatus: result.qualityStatus,
          outputs: result.outputs,
          warnings: result.warnings,
          phase: result.phase,
          contentAudit,
          contentSafetyStatus: contentAudit?.contentSafety?.status ?? "HOLD",
          deliveryStatus:
            contentAudit?.contentSafety?.status === "NO_DETECTED_HIGH_RISK"
              ? "machine-draft-needs-review"
              : "needs-review-hold",
        },
        null,
        2,
      ),
    );
    if (result.executionStatus === "partial") process.exitCode = 2;
    if (contentAudit?.contentSafety?.status !== "NO_DETECTED_HIGH_RISK")
      process.exitCode = 2;
  } catch (error) {
    console.error(
      `查看失败阶段：npm run subtitle-tool -- status --task ${JSON.stringify(task)}\n复用检查点：npm run subtitle-tool -- resume --task ${JSON.stringify(task)}`,
    );
    throw error;
  } finally {
    clearInterval(tick);
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}
configuration(
  cli
    .command("generate")
    .description("完整媒体 → 本地 Whisper → ASS/SRT/VTT 机器草稿"),
)
  .requiredOption("--input <path>", "完整本地视频或音频")
  .requiredOption("--output-root <path>", "输出根目录，每次新建唯一任务")
  .option("--audio-track <index>", "容器全局音轨索引", Number)
  .addOption(
    new Option(
      "--strategy <strategy>",
      "bounded 默认有界分块；single 使用旧整片流程",
    )
      .choices(["single", "bounded"])
      .default("bounded"),
  )
  .option(
    "--no-recover-content",
    "关闭默认内容异常局部重识别；保留异常检查和 HOLD，不新增纠错推理",
  )
  .option(
    "--no-refine-seams",
    "关闭默认日语接缝复核（最多额外 8 次请求 / 120 秒音频）",
  )
  .option(
    "--no-context-seams",
    "关闭零新增推理的上下文接缝候选（默认旁路产出，不替换推荐稿）",
  )
  .option(
    "--start <seconds>",
    "仅 bounded：源视频时间轴上的局部范围起点",
    Number,
  )
  .option("--end <seconds>", "仅 bounded：源视频时间轴上的局部范围终点", Number)
  .option("--export-partial", "仅 bounded：存在非法时间时明确导出合法子集")
  .action(async (o) => {
    if (o.strategy === "bounded") {
      if ((o.start === undefined) !== (o.end === undefined))
        throw Error("--start 和 --end 必须同时指定");
      await executeBounded(async (options) => {
        const { generateBounded } = await import("./lib/bounded-product.mjs");
        const config = await configured(o);
        const result = await generateBounded({
          ...options,
          config,
          input: o.input,
          outputRoot: o.outputRoot,
          audioTrack: o.audioTrack,
          exportPartial: !!o.exportPartial,
          recoverContent: o.recoverContent,
          ...(o.start !== undefined
            ? { range: { start: o.start, end: o.end } }
            : {}),
        });
        const { refineDefaultDelivery } =
          await import("./lib/default-seam-delivery.mjs");
        return refineDefaultDelivery(result, {
          ...options,
          enabled: o.refineSeams,
          contextSeams: o.contextSeams,
          language: config.language,
        });
      });
      return;
    }
    if (o.start !== undefined || o.end !== undefined || o.exportPartial)
      throw Error("局部范围和 --export-partial 仅适用于 --strategy bounded");
    const task = await createTask(
      await configured(o),
      o.input,
      o.outputRoot,
      o.audioTrack,
    );
    console.log(`任务目录：${task}`);
    await execute(task);
  });
cli
  .command("replay-seam-context")
  .description("离线复用已冻结接缝证据，另建上下文候选；不识别、不读参考稿")
  .requiredOption("--evidence <path>", "已冻结的接缝运行目录")
  .requiredOption("--output-root <path>", "独立输出父目录")
  .action(async (o) => {
    const { assembleContextDelivery } =
      await import("./lib/seam-context-delivery.mjs");
    console.log(
      JSON.stringify(
        await assembleContextDelivery(o.evidence, o.outputRoot),
        null,
        2,
      ),
    );
  });
cli
  .command("recover-held-seams")
  .description(
    "零推理复用接缝缓存，跳过风险及上下文；另建候选，整集 HOLD 不解除",
  )
  .requiredOption("--evidence <path>", "已冻结且身份一致的接缝运行目录")
  .requiredOption("--output-root <path>", "独立输出父目录")
  .action(async (o) => {
    const { recoverHeldSeamCache } = await import("./recover-held-seams.mjs");
    console.log(
      JSON.stringify(
        await recoverHeldSeamCache(o.evidence, o.outputRoot),
        null,
        2,
      ),
    );
  });
cli
  .command("verify-held-seams")
  .description("校验局部去重候选、缓存绑定及三格式一致性；零推理")
  .requiredOption("--task <path>", "局部去重候选目录")
  .action(async (o) => {
    const { verifyHeldSeamCache } = await import("./recover-held-seams.mjs");
    console.log(JSON.stringify(await verifyHeldSeamCache(o.task), null, 2));
  });
cli
  .command("recover-local-occurrences")
  .description("离线逐段配对已有局部识别证据；仅输出待复核候选，不自动改字幕")
  .requiredOption("--evidence <path>", "已冻结的 recovery-context 证据目录")
  .requiredOption("--output-root <path>", "独立输出父目录")
  .action(async (o) => {
    const { recoverLocalOccurrences } =
      await import("./recover-local-occurrences.mjs");
    console.log(
      JSON.stringify(
        await recoverLocalOccurrences(o.evidence, o.outputRoot),
        null,
        2,
      ),
    );
  });
cli
  .command("verify-local-occurrences")
  .description("校验逐段补句判断及证据绑定；零推理")
  .requiredOption("--task <path>", "逐段配对输出目录")
  .action(async (o) => {
    const { verifyLocalOccurrences } =
      await import("./recover-local-occurrences.mjs");
    console.log(JSON.stringify(await verifyLocalOccurrences(o.task), null, 2));
  });
cli
  .command("status")
  .description("读取任务状态；不加载模型")
  .requiredOption("--task <path>", "任务目录")
  .action(async (o) => {
    const task = await fs.realpath(o.task);
    if (await isBoundedTask(task)) {
      const { statusBounded } = await import("./lib/bounded-product.mjs");
      console.log(JSON.stringify(await statusBounded(task), null, 2));
      return;
    }
    const m = await readTask(task);
    console.log(
      JSON.stringify(m.rawHash ? await recoveryStatus(task) : m, null, 2),
    );
  });
async function offlineOperation(fn) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  try {
    const result = await fn(controller.signal);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.exitCode;
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}
cli
  .command("audit-timing")
  .description("审计已有 bounded JSON 时间与接缝证据；零模型、零字幕修改")
  .requiredOption("--task <path>", "已完成的 bounded 任务")
  .requiredOption("--output-root <path>", "独立审计目录，不能位于原任务内")
  .action(async (o) => {
    const { auditBoundedEvidence } =
      await import("./lib/bounded-evidence-audit.mjs");
    console.log(
      JSON.stringify(
        await auditBoundedEvidence(o.task, { outputRoot: o.outputRoot }),
        null,
        2,
      ),
    );
  });
cli
  .command("audit-content")
  .description("读取成功原始响应，检查内容异常；零模型、零正文修改")
  .requiredOption("--task <path>", "已有普通或 bounded 任务")
  .requiredOption("--output-root <path>", "新诊断目录；不修改原任务")
  .action(async (o) => {
    const result = await ((await isBoundedTask(o.task))
      ? auditBoundedContent(o.task, o.outputRoot)
      : auditTaskContent(o.task, { outputRoot: o.outputRoot }));
    console.log(JSON.stringify(result, null, 2));
  });
cli
  .command("recover")
  .description("纯离线取回全文与异常；不会查找模型或重新识别")
  .requiredOption("--task <path>", "已有成功原始响应的任务")
  .option("--export-partial", "明确导出 primary-minimal 合法子集（不完整）")
  .option("--output-root <path>", "独立可写恢复目录；不修改旧任务")
  .action(async (o) => {
    if (await isBoundedTask(o.task))
      throw Error(
        "recover 仅支持普通任务；bounded 原始记录已保存在任务内。本命令不会恢复推理。",
      );
    await offlineOperation(async (signal) => {
      const recovery = await recoverTask(o.task, { ...o, signal });
      signal.throwIfAborted();
      return attachRecoveryContentAudit(o.task, recovery);
    });
  });
async function isBoundedTask(task) {
  try {
    await fs.access(path.join(task, "bounded-task.json"));
    return true;
  } catch (e) {
    if (e.code === "ENOENT") return false;
    throw e;
  }
}
async function auditBoundedContent(task, outputRoot) {
  const { statusBounded } = await import("./lib/bounded-product.mjs");
  const m = await statusBounded(task);
  // The bounded runner revalidates frozen outputs before they are consumed here.
  const p = JSON.parse(
    await fs.readFile(path.join(task, "bounded-plan.json"), "utf8"),
  );
  const mapped = JSON.parse(
    await fs.readFile(path.join(task, "mapped-records.json"), "utf8"),
  );
  const boundaries = JSON.parse(
    await fs.readFile(path.join(task, "boundary-decisions.json"), "utf8"),
  );
  const records = mapped.records.map((r, i) => ({
    id: r.recordId,
    index: i,
    requestId: r.requestId,
    start: r.sourceStart ?? NaN,
    end: r.sourceEnd ?? NaN,
    text: r.text ?? r.rawBlock,
  }));
  return deliverContentAudit({
    records,
    language: p.config.language,
    sourceEnd: p.duration,
    additionalWarnings: boundaries.decisions
      .filter((d) => d.status === "BOUNDARY_AMBIGUITY")
      .map((d) => ({
        code: "BOUNDARY_AMBIGUITY",
        recordIds: [d.leftId, d.rightId],
        sourceOverlap: d.overlap.map((t) => t + p.effectiveRange.start),
        action: "retain-both-for-review; no automatic deletion",
      })),
    binding: {
      planHash: m.planHash,
      inputHash: p.identities.input.sha256,
      mappedRecordsHash: m.files["mapped-records.json"],
      range: p.effectiveRange,
    },
    outputRoot: outputRoot ?? path.join(task, "content-audits"),
  });
}
async function executeBounded(fn) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  try {
    const result = await fn({
      signal: controller.signal,
      progress: (message) => console.log(message),
    });
    const contentAudit = await auditBoundedContent(result.task);
    if (!result.defaultDelivery) {
      const { readContentRecovery } =
        await import("./lib/default-content-recovery.mjs");
      result.contentRecovery = await readContentRecovery(result.task);
    }
    console.log(
      JSON.stringify(
        {
          ...result,
          contentAudit,
          contentAuditScope: "original-bounded-baseline",
        },
        null,
        2,
      ),
    );
    if (result.executionStatus === "partial") process.exitCode = 2;
    if (["failed", "cancelled"].includes(result.defaultDelivery?.status))
      process.exitCode = 2;
    if (result.defaultDelivery?.contentSafety?.status === "HOLD")
      process.exitCode = 2;
    // Resume has no recovery budget. It must still surface baseline risks as
    // non-success rather than silently clearing a previous content HOLD.
    if (!result.defaultDelivery && contentAudit.contentSafety.status === "HOLD")
      process.exitCode = 2;
    if (
      !result.defaultDelivery &&
      (result.outputs.length === 0 ||
        (result.contentRecovery &&
          !["no-detected-risk", "recovered-machine-draft"].includes(
            result.contentRecovery.status,
          )))
    )
      process.exitCode = 2;
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}
cli
  .command("validate-edited")
  .description("只检查显式修订副本；不代表人工质量认证")
  .requiredOption("--task <path>", "原任务")
  .requiredOption("--input <path>", "用户指定 SRT/ASS/VTT 副本")
  .addOption(
    new Option(
      "--timebase <base>",
      "source（默认）：partial 副本；audio：raw 副本，映射一次",
    )
      .choices(["source", "audio"])
      .default("source"),
  )
  .option("--output-root <path>", "独立可写修订输出目录")
  .action(async (o) => {
    await offlineOperation((signal) =>
      validateEdited(o.task, o.input, o.timebase, { ...o, signal }),
    );
  });
cli
  .command("resume")
  .description("恢复未完成任务或从完整证据重新导出；校验所有输入身份")
  .requiredOption("--task <path>", "任务目录")
  .addOption(
    new Option("--profile <profile>", "从同一证据导出另一配置，零 ASR").choices(
      ["primary-minimal", "g11"],
    ),
  )
  .option("--recover-lock", "仅移除已确认死亡进程的旧运行锁")
  .option("--export-partial", "仅 bounded：明确导出已保存原始响应的合法子集")
  .action(async (o) => {
    if (await isBoundedTask(o.task)) {
      if (o.profile)
        throw Error(
          "bounded 仅支持 primary-minimal；不能通过 resume 改变冻结策略",
        );
      await executeBounded(async (options) => {
        const { resumeBounded } = await import("./lib/bounded-product.mjs");
        return resumeBounded(o.task, {
          ...options,
          recoverLock: !!o.recoverLock,
          exportPartial: !!o.exportPartial,
        });
      });
      return;
    }
    if (o.exportPartial)
      throw Error(
        "普通任务请使用 recover --export-partial；本命令不启动该恢复流程",
      );
    if (o.recoverLock) await recoverLock(o.task);
    await execute(o.task, o.profile);
  });
cli.addHelpText(
  "after",
  "\n首次使用：npm run subtitle-tool -- configure --model /path/model.bin --runtime /path/whisper-cli\n日常使用：npm run subtitle-tool -- generate --input /path/movie.mkv --output-root /path/tasks\n编辑字幕：从 OUTPUT_INDEX.md 打开机器草稿，另存 edited 副本；原始证据不变。\n缺少 dist 时：先运行 npm run build:subtitle-tool。\n",
);
try {
  if (process.argv.length === 2) cli.outputHelp();
  else await cli.parseAsync(process.argv);
} catch (e) {
  console.error(
    `字幕工具失败：${e.message}\n请检查路径/配置，或用 status 查看任务；完成检查点可通过 resume 复用。`,
  );
  process.exitCode = 1;
}
