/** Synthetic identities, PCM and responses only. No process/model is launched. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Buffer } from "node:buffer";
import { generateBounded } from "../../scripts/lib/bounded-product.mjs";
import { slicePcm } from "../../scripts/lib/bounded-asr-ab.mjs";
import { inventory } from "../../scripts/lib/local-asr-run.mjs";
import {
  configSchema,
  manifestSchema,
  fileHash,
} from "../../packages/video-subtitler/dist/standalone/tool.js";
import { digest } from "../../packages/video-subtitler/dist/standalone/assembly.js";

export const json = async (file) => JSON.parse(await fs.readFile(file, "utf8"));
export const writeJson = (file, value) =>
  fs.writeFile(file, JSON.stringify(value, null, 2) + "\n");
const clock = (seconds) => {
  const ms = Math.round(seconds * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};
const srt = (rows) =>
  rows
    .map(
      ([start, end, text], index) =>
        `${index + 1}\n${clock(start)} --> ${clock(end)}\n${text}\n`,
    )
    .join("\n");

export const loopText = "これは合成の繰り返しです";
export const invalidText = "原本の無効な時刻も必ず残します";
export const controlText = "正常な対照区間の原本です";
export const donorTexts = ["合成の候補前半です", "合成の候補後半です"];

export async function baselinePatchFixture(t, { outsideSource = false } = {}) {
  const temporary = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "baseline-patch-synthetic-")),
  );
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const input = path.join(temporary, "media.mkv");
  const model = path.join(temporary, "model.bin");
  await fs.writeFile(input, "synthetic media; no real audio");
  await fs.writeFile(model, "synthetic model; never loaded");
  const frames = 80 * 16000;
  const audio = slicePcm(
    { sampleRate: 16000, frames, data: Buffer.alloc(frames * 2) },
    0,
    frames,
  );
  const evidenceRoot = path.join(temporary, "evidence");
  const windows = [
    { id: "loop", start: 19, end: 26 },
    { id: "normal", start: 40, end: 44 },
  ];
  const raws = [
    srt([
      [1, 3.5, donorTexts[0]],
      [3.5, 6, donorTexts[1]],
    ]),
    srt([[1, 3, "対照窓の別候補は適用しません"]]),
  ];
  let syntheticCalls = 0;
  const runner = {
    async run(_executable, args) {
      if (args[0] === "--help")
        return { stdout: "--output-srt", stderr: "", exitCode: 0 };
      if (args[0] === "--version")
        return { stdout: "11.18.0", stderr: "", exitCode: 0 };
      if (args[0] === "-version")
        return { stdout: "synthetic", stderr: "", exitCode: 0 };
      if (args.includes("-show_entries"))
        return {
          stdout: JSON.stringify({
            format: { duration: "80", start_time: "0" },
            streams: [{ index: 1, codec_type: "audio", start_time: "0" }],
          }),
          stderr: "",
          exitCode: 0,
        };
      if (args.includes("-map")) {
        await fs.writeFile(args.at(-1), audio);
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      assert.ok(args.includes("--output-file"));
      const prefix = args[args.indexOf("--output-file") + 1];
      assert.ok(syntheticCalls < raws.length);
      await fs.writeFile(`${prefix}.srt`, raws[syntheticCalls++]);
      return { stdout: "synthetic only", stderr: "", exitCode: 0 };
    },
  };
  const bounded = [];
  for (const window of windows)
    bounded.push(
      await generateBounded({
        input,
        range: { start: window.start, end: window.end },
        outputRoot: path.join(evidenceRoot, window.id),
        runner,
        config: {
          model,
          runtime: process.execPath,
          ffmpeg: process.execPath,
          ffprobe: process.execPath,
          language: "ja",
          profile: "primary-minimal",
          threads: 1,
        },
      }),
    );
  assert.equal(syntheticCalls, 2);
  const boundedPlan = await json(
    path.join(bounded[0].task, "bounded-plan.json"),
  );
  const baselineTask = path.join(temporary, "original-task");
  await fs.mkdir(baselineTask);
  const raw = srt([
    [1, 2, "最初の正常な原本です"],
    [17, 19, "直前の保護対象です"],
    ...[
      [20, 21],
      [21, 21.02],
      [21.02, 21.04],
      [21.04, 22],
      [22, 22.02],
      [22.02, 23],
      [23, 24],
      [24, 25],
    ].map(([start, end]) => [start, end, loopText]),
    [26, 28, "直後の保護対象です"],
    [41, 43, controlText],
    [62, 63, "診断窓外の正常な原本です"],
    [70, 70, invalidText],
    [75, 77, "最後の正常な原本です"],
    ...(outsideSource ? [[90, 91, "源の範囲外でも原文は残します"]] : []),
  ]);
  await fs.writeFile(path.join(baselineTask, "raw-primary.srt"), raw);
  const config = configSchema.parse({
    model: "/unavailable/synthetic-model",
    runtime: "/unavailable/synthetic-runtime",
    language: "ja",
  });
  const manifest = manifestSchema.parse({
    version: "subtitle-tool-v1",
    taskId: "original-synthetic-task",
    createdAt: "synthetic",
    updatedAt: "synthetic",
    input: "/unavailable/synthetic-input",
    inputHash: boundedPlan.identities.input.sha256,
    config,
    configHash: digest(config),
    modelHash: digest("synthetic-model"),
    runtimeHash: digest("synthetic-runtime"),
    ffmpegHash: digest("synthetic-ffmpeg"),
    ffprobeHash: digest("synthetic-ffprobe"),
    track: boundedPlan.track,
    duration: boundedPlan.duration,
    origin: boundedPlan.origin,
    audioOffset: boundedPlan.audioOffset,
    executionStatus: "failed",
    phase: "timing",
    artifactIntegrity: "failed",
    qualityStatus: "needs-review",
    contentQuality: "NOT_MEASURED",
    finalizationMethod: "none",
    humanValidated: false,
    machineOnlyReleaseAuthorized: false,
    audioHash: boundedPlan.audioHash,
    rawHash: await fileHash(path.join(baselineTask, "raw-primary.srt")),
    evidenceHash: null,
    warnings: [],
    attempts: [
      {
        id: "primary-1",
        startedAt: "synthetic",
        endedAt: "synthetic",
        reservedAudioSeconds: 80,
        state: "completed",
        error: null,
      },
    ],
    budgetSeconds: 160,
    cacheHits: 0,
    modelLoads: null,
    outputs: {},
    ownedFiles: ["task.json", "raw-primary.srt"],
    error: "synthetic invalid timing",
  });
  await writeJson(path.join(baselineTask, "task.json"), manifest);
  const baselineManifestHash = await fileHash(
    path.join(baselineTask, "task.json"),
  );
  await writeJson(path.join(evidenceRoot, "plan.json"), {
    inputHash: manifest.inputHash,
    rawHash: manifest.rawHash,
    baselineManifestHash,
    windows,
  });
  await writeJson(path.join(evidenceRoot, "machine-freeze.json"), {
    version: "synthetic-baseline-patch-diagnostic-freeze-v1",
    planHash: await fileHash(path.join(evidenceRoot, "plan.json")),
    files: await inventory(evidenceRoot),
  });
  const patchConfig = {
    baselineTask,
    baselineManifestHash,
    baselineRawHash: manifest.rawHash,
    evidenceRoot,
    evidenceFreezeHash: await fileHash(
      path.join(evidenceRoot, "machine-freeze.json"),
    ),
    outputRoot: path.join(temporary, "patches"),
  };
  const originals = await inventory(baselineTask);
  const diagnostic = await inventory(evidenceRoot);
  await fs.unlink(input);
  await fs.unlink(model);
  return {
    temporary,
    config: patchConfig,
    baselineTask,
    evidenceRoot,
    donorTasks: bounded.map((b) => b.task),
    originals,
    diagnostic,
    raw,
    manifest,
  };
}
