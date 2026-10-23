import { beforeAll, describe, expect, it } from "vitest";
import {
  chmod,
  mkdtemp,
  readFile,
  readdir,
  writeFile,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
const repo = path.resolve(import.meta.dirname, "../..");
let dir: string,
  runtime: string,
  model: string,
  audio: string,
  video: string,
  multi: string,
  silent: string,
  config: string;
const cli = (args: string[]) =>
  exec(process.execPath, ["scripts/subtitle-tool.mjs", ...args], {
    cwd: repo,
    env: process.env,
  });
beforeAll(async () => {
  dir = await realpath(await mkdtemp(path.join(os.tmpdir(), "字幕 tool e2e-")));
  runtime = path.join(dir, "stub-whisper");
  model = path.join(dir, "model.bin");
  config = path.join(dir, "config.json");
  await writeFile(model, "test model, no inference");
  await writeFile(
    runtime,
    `#!${process.execPath}\nimport fs from 'node:fs';\nconst a=process.argv.slice(2);if(a.includes('--help')){console.log('--output-srt');process.exit(0);}if(a.includes('--prompt'))throw Error('Unexpected prompt');fs.writeFileSync(a[a.indexOf('--output-file')+1]+'.srt','1\\n00:00:00,000 --> 00:00:01,200\\nこんにちは。\\n\\n2\\n00:00:01,300 --> 00:00:01,900\\n終わりです。\\n');console.error('whisper_init_from_file_with_params: loading model');\n`,
  );
  await chmod(runtime, 0o755);
  audio = path.join(dir, "日本語 音声.wav");
  video = path.join(dir, "日本語 動画.mkv");
  multi = path.join(dir, "複数音声.mkv");
  silent = path.join(dir, "no-audio.mkv");
  await exec("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=2",
    "-ar",
    "16000",
    audio,
  ]);
  await exec("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=black:s=64x64:d=2",
    "-i",
    audio,
    "-c:v",
    "ffv1",
    "-c:a",
    "pcm_s16le",
    video,
  ]);
  await exec("ffmpeg", [
    "-v",
    "error",
    "-i",
    video,
    "-map",
    "0:v",
    "-map",
    "0:a",
    "-map",
    "0:a",
    "-c",
    "copy",
    multi,
  ]);
  await exec("ffmpeg", [
    "-v",
    "error",
    "-i",
    video,
    "-map",
    "0:v",
    "-c",
    "copy",
    silent,
  ]);
  await cli([
    "configure",
    "--config",
    config,
    "--model",
    model,
    "--runtime",
    runtime,
  ]);
}, 30000);
describe("standalone built CLI, real media plumbing / stub ASR", () => {
  it("digital-zero media never invokes ASR and exports no invented transcript", async () => {
    const input = path.join(dir, "digital-zero.wav");
    await exec("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=16000:cl=mono",
      "-t",
      "2",
      "-c:a",
      "pcm_s16le",
      input,
    ]);
    const stub = path.join(dir, "zero-whisper");
    const calls = path.join(dir, "zero-calls.txt");
    await writeFile(
      stub,
      `#!${process.execPath}\nimport fs from 'node:fs';if(process.argv.includes('--help')){console.log('--output-srt');process.exit(0);}fs.writeFileSync(${JSON.stringify(calls)},'UNEXPECTED ASR');process.exit(1);\n`,
    );
    await chmod(stub, 0o755);
    const output = path.join(dir, "zero-tasks");
    await expect(
      cli([
        "generate",
        "--config",
        config,
        "--runtime",
        stub,
        "--input",
        input,
        "--output-root",
        output,
        "--no-refine-seams",
      ]),
    ).rejects.toMatchObject({ code: 2 });
    await expect(readFile(calls)).rejects.toMatchObject({ code: "ENOENT" });
    const name = (await readdir(output))[0];
    if (!name) throw Error("Missing zero task");
    const task = path.join(output, name);
    const m = JSON.parse(
      await readFile(path.join(task, "bounded-task.json"), "utf8"),
    ) as { attempts: unknown[]; recordCount: number; outputs: string[] };
    expect(m.attempts).toHaveLength(0);
    expect(m.recordCount).toBe(0);
    expect(m.outputs).toHaveLength(0);
    await cli(["status", "--task", task]);
    await expect(cli(["resume", "--task", task])).rejects.toMatchObject({
      code: 2,
    });
    await expect(readFile(calls)).rejects.toMatchObject({ code: "ENOENT" });
  }, 30000);
  it.each(["recovered", "persistent", "loss"])(
    "default content recovery CLI holds unresolved=%s without renewing budget",
    async (mode) => {
      const unresolved = mode !== "recovered";
      const input = path.join(dir, `recovery-${mode}.wav`);
      await exec("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=25",
        "-ar",
        "16000",
        input,
      ]);
      const stub = path.join(dir, `recovery-${mode}-whisper`);
      const countFile = path.join(dir, `recovery-${mode}-calls.txt`);
      const candidate =
        mode === "loss"
          ? "1\n00:00:01,000 --> 00:00:02,000\n合成テストです\n"
          : "1\n00:00:00,000 --> 00:00:12,500\n女の人は、この後、何をしますか?\n";
      const raw = Array.from(
        { length: 6 },
        (_, i) =>
          `${i + 1}\n00:00:${String(i * 2).padStart(2, "0")},000 --> 00:00:${String(i * 2 + 2).padStart(2, "0")},000\n女の人は、この後、何をしますか?\n`,
      ).join("\n");
      await writeFile(
        stub,
        `#!${process.execPath}\nimport fs from 'node:fs';\nconst a=process.argv.slice(2);if(a.includes('--help')){console.log('--output-srt');process.exit(0);}const p=a[a.indexOf('--output-file')+1];fs.appendFileSync(${JSON.stringify(countFile)},'call\\n');fs.writeFileSync(p+'.srt',p.includes('-recovery-')&&${mode !== "persistent"}?${JSON.stringify(candidate)}:${JSON.stringify(raw)});\n`,
      );
      await chmod(stub, 0o755);
      const output = path.join(dir, `recovery-${mode}-tasks`);
      const args = [
        "generate",
        "--config",
        config,
        "--runtime",
        stub,
        "--input",
        input,
        "--output-root",
        output,
        "--no-refine-seams",
      ];
      if (unresolved)
        await expect(cli(args)).rejects.toMatchObject({ code: 2 });
      else await cli(args);
      const name = (await readdir(output))[0];
      if (!name) throw Error("Missing bounded task");
      const task = path.join(output, name);
      const delivery = JSON.parse(
        await readFile(path.join(task, "DEFAULT_DELIVERY.json"), "utf8"),
      ) as {
        preferredOutputs: string[];
        contentRecovery: { reservedRequests: number; status: string };
      };
      expect(delivery.preferredOutputs).toHaveLength(unresolved ? 0 : 3);
      expect(delivery.contentRecovery.reservedRequests).toBe(2);
      expect(delivery.contentRecovery.status).toBe(
        unresolved ? "needs-review" : "recovered-machine-draft",
      );
      expect(
        (await readFile(countFile, "utf8")).trim().split("\n"),
      ).toHaveLength(3);
      // Resume reports original baseline HOLD rather than spending a new budget.
      await expect(cli(["resume", "--task", task])).rejects.toMatchObject({
        code: 2,
      });
      await cli(["status", "--task", task]);
      expect(
        (await readFile(countFile, "utf8")).trim().split("\n"),
      ).toHaveLength(3);
    },
    30000,
  );
  it("no arguments and bad arguments show useful help", async () => {
    expect((await cli([])).stdout).toContain("首次使用");
    await expect(cli(["unknown-command"])).rejects.toThrow();
  });
  it("doctor lists full media track and performs no model load", async () => {
    const result = await cli(["doctor", "--config", config, "--input", video]);
    expect(result.stdout).toContain('"track": 1');
    expect((await readdir(dir)).some((f) => f.includes(".srt"))).toBe(false);
  });
  it.each(["audio", "video"])(
    "%s single strategy generate / status / resume / G11 / same output root",
    async (kind) => {
      const output = path.join(dir, kind + "-tasks");
      const input = kind === "audio" ? audio : video;
      await cli([
        "generate",
        "--strategy",
        "single",
        "--config",
        config,
        "--input",
        input,
        "--output-root",
        output,
      ]);
      const first = (await readdir(output))[0];
      if (!first) throw Error("Missing task");
      const task = path.join(output, first);
      const status = await cli(["status", "--task", task]);
      expect(status.stdout).toContain('"executionStatus": "completed"');
      await cli(["resume", "--task", task, "--profile", "g11"]);
      await cli(["resume", "--task", task]);
      const m = JSON.parse(
        await readFile(path.join(task, "task.json"), "utf8"),
      ) as {
        attempts: unknown[];
        cacheHits: number;
        outputs: Record<string, string>;
      };
      expect(m.attempts).toHaveLength(1);
      expect(m.cacheHits).toBe(2);
      expect(Object.keys(m.outputs)).toHaveLength(6);
      expect(
        await readFile(path.join(task, "OUTPUT_INDEX.md"), "utf8"),
      ).toContain("g11.machine-draft.ass");
      await cli([
        "generate",
        "--strategy",
        "single",
        "--config",
        config,
        "--input",
        input,
        "--output-root",
        output,
      ]);
      expect(await readdir(output)).toHaveLength(2);
    },
  );
  it("multi-audio requires global stream index", async () => {
    await expect(
      cli(["doctor", "--config", config, "--input", multi]),
    ).rejects.toThrow("全局音轨索引");
    expect(
      (
        await cli([
          "doctor",
          "--config",
          config,
          "--input",
          multi,
          "--audio-track",
          "2",
        ])
      ).stdout,
    ).toContain('"track": 2');
  });
  it("no audio, missing/corrupt input, missing model/tool fail without recognition", async () => {
    const corrupt = path.join(dir, "corrupt.mkv");
    await writeFile(corrupt, "not media");
    for (const input of [silent, corrupt, path.join(dir, "missing.mkv")])
      await expect(
        cli(["doctor", "--config", config, "--input", input]),
      ).rejects.toThrow();
    await expect(
      cli([
        "doctor",
        "--config",
        config,
        "--model",
        path.join(dir, "missing.bin"),
      ]),
    ).rejects.toThrow();
    await expect(
      cli([
        "doctor",
        "--config",
        config,
        "--ffmpeg",
        path.join(dir, "missing-ffmpeg"),
      ]),
    ).rejects.toThrow();
  });
  it("unwritable output fails before creating task or ASR", async () => {
    const output = path.join(dir, "read-only");
    await exec("mkdir", [output]);
    await chmod(output, 0o500);
    try {
      await expect(
        cli([
          "generate",
          "--config",
          config,
          "--input",
          audio,
          "--output-root",
          output,
        ]),
      ).rejects.toThrow();
    } finally {
      await chmod(output, 0o700);
    }
  });
});
