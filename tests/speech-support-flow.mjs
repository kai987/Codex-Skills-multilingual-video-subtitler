import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Buffer } from "node:buffer";
import { generateBounded } from "../scripts/lib/bounded-product.mjs";
import { slicePcm } from "../scripts/lib/bounded-asr-ab.mjs";
import {
  prepareSpeech,
  executeSpeech,
  verifySpeech,
} from "../scripts/subtitle-tool-speech-support.mjs";
test("synthetic end to end, reservations, source preservation and raw replay", async (t) => {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "speech-support-synthetic-")),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const model = path.join(root, "model.bin"),
    input = path.join(root, "media");
  await fs.writeFile(model, "synthetic model");
  await fs.writeFile(input, "synthetic media");
  const pcm = {
    sampleRate: 16000,
    frames: 25 * 16000,
    data: Buffer.alloc(25 * 16000 * 2),
  };
  const runner = {
    run: async (_exe, args) => {
      if (args[0] === "--help")
        return { stdout: "--output-srt", stderr: "", exitCode: 0 };
      if (["--version", "-version"].includes(args[0]))
        return { stdout: "11.18.0", stderr: "", exitCode: 0 };
      if (args.includes("-show_entries"))
        return {
          stdout: JSON.stringify({
            format: { duration: "25", start_time: "0" },
            streams: [{ index: 1, codec_type: "audio", start_time: "0" }],
          }),
          stderr: "",
          exitCode: 0,
        };
      if (args.includes("-map"))
        await fs.writeFile(args.at(-1), slicePcm(pcm, 0, pcm.frames));
      else
        await fs.writeFile(
          args[args.indexOf("--output-file") + 1] + ".srt",
          "1\n00:00:00,000 --> 00:00:20,000\nとても短い句\n",
        );
      return { stdout: "", stderr: "", exitCode: 0 };
    },
  };
  const base = await generateBounded({
    config: {
      model,
      runtime: process.execPath,
      ffmpeg: process.execPath,
      ffprobe: process.execPath,
      language: "ja",
      profile: "primary-minimal",
      threads: 1,
    },
    input,
    outputRoot: path.join(root, "base"),
    runner,
  });
  const spec = {
    task: base.task,
    python: process.execPath,
    vadModel: model,
    vadLibrary: model,
    kotobaModel: root,
  };
  const prepared = await prepareSpeech(spec, path.join(root, "experiments"));
  const before = await fs.readFile(path.join(base.task, "mapped-records.json"));
  let vadCalls = 0,
    asrCalls = 0;
  const evidenceRunner = {
    run: async (_exe, args) => {
      if (args.includes("--request")) {
        vadCalls++;
        const p = prepared.regions[vadCalls - 1];
        return {
          stdout: JSON.stringify({
            rawUnit: "CENTISECONDS",
            rawIntervals: vadCalls === 1 ? [{ start: 700, end: 750 }] : [],
            inputFrames: Math.round((p.cropEnd - p.cropStart) * 16000),
            sampleRate: 16000,
          }),
          stderr: "",
          exitCode: 0,
        };
      }
      if (args.includes("--output-srt")) {
        asrCalls++;
        await fs.writeFile(
          args[args.indexOf("--output-file") + 1] + ".srt",
          "1\n00:00:01,000 --> 00:00:01,500\nああ\n",
        );
      } else {
        const p = JSON.parse(
          await fs.readFile(path.join(prepared.root, "asr-plan.json"), "utf8"),
        );
        for (const r of p.probes) {
          asrCalls++;
          await fs.writeFile(
            path.join(prepared.root, r.id, "kotoba-raw.json"),
            JSON.stringify({
              segments: [{ start: 1.02, end: 1.5, text: "ああ" }],
            }),
          );
        }
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    },
  };
  await assert.rejects(
    executeSpeech(prepared.root, { runner: evidenceRunner }),
    /AUTHORIZE/u,
  );
  const result = await executeSpeech(prepared.root, {
    authorize: true,
    runner: evidenceRunner,
  });
  assert.equal(result.changedTargets, 1);
  assert.equal(asrCalls, 2);
  assert.equal(vadCalls, 2);
  assert.equal((await verifySpeech(prepared.root)).integrity, "passed");
  await assert.rejects(
    executeSpeech(prepared.root, { authorize: true, runner: evidenceRunner }),
    /EEXIST/u,
  );
  assert.equal(asrCalls, 2);
  assert.equal(vadCalls, 2);
  assert.deepEqual(
    await fs.readFile(path.join(base.task, "mapped-records.json")),
    before,
  );
  await fs.appendFile(
    path.join(prepared.root, "region-1", "whisper.srt"),
    "changed",
  );
  await assert.rejects(verifySpeech(prepared.root), /CHANGED/u);
});
