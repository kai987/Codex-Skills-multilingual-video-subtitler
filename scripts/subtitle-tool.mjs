#!/usr/bin/env node
/* global AbortController */
import { Command, Option } from "commander";
import { setInterval, clearInterval } from "node:timers";
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
  const { config, input, outputRoot, audioTrack, ...overrides } = o;
  void input;
  void outputRoot;
  void audioTrack;
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
    console.log(
      JSON.stringify(
        {
          task,
          executionStatus: result.executionStatus,
          artifactIntegrity: result.artifactIntegrity,
          qualityStatus: result.qualityStatus,
          outputs: result.outputs,
          warnings: result.warnings,
        },
        null,
        2,
      ),
    );
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
  .action(async (o) => {
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
  .command("status")
  .description("读取任务状态；不加载模型")
  .requiredOption("--task <path>", "任务目录")
  .action(async (o) =>
    console.log(JSON.stringify(await readTask(o.task), null, 2)),
  );
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
  .action(async (o) => {
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
