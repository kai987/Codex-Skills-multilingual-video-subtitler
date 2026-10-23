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
} from "../scripts/subtitle-tool-speech-support.mjs";
import {
  prepareSoftSpeech,
  runSoftSpeech,
  verifySoftSpeech,
} from "../scripts/subtitle-tool-soft-speech.mjs";
import { completeSoftSpeechOffline } from "../scripts/complete-soft-speech-offline.mjs";
import {
  prepareContext,
  runContext,
  finishContext,
} from "../scripts/subtitle-tool-speech-context.mjs";
test("soft-gate end to end: zero new VAD, paired calls, frozen replay and no silent retry", async (t) => {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "soft-speech-synthetic-")),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const model = path.join(root, "model.bin"),
    input = path.join(root, "media");
  await fs.writeFile(model, "model");
  await fs.writeFile(input, "media");
  const pcm = { sampleRate: 16000, frames: 400000, data: Buffer.alloc(800000) };
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
          "1\n00:00:00,000 --> 00:00:20,000\n短い元の文\n",
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
  const parent = await prepareSpeech(
    {
      task: base.task,
      python: process.execPath,
      vadModel: model,
      vadLibrary: model,
      kotobaModel: root,
    },
    path.join(root, "parent"),
  );
  let vad = 0;
  await executeSpeech(parent.root, {
    authorize: true,
    runner: {
      run: async () => {
        const p = parent.regions[vad++],
          frames = Math.round((p.cropEnd - p.cropStart) * 16000);
        return {
          exitCode: 0,
          stderr: "n_window: 512",
          stdout: JSON.stringify({
            rawUnit: "CENTISECONDS",
            sampleRate: 16000,
            inputFrames: frames,
            rawIntervals: [],
            probabilities: Array(Math.ceil(frames / 512)).fill(0.1),
          }),
        };
      },
    },
  });
  const prepared = await prepareSoftSpeech(
    parent.root,
    path.join(root, "next"),
  );
  assert.equal(prepared.requests, 4);
  const frozen = await fs.readFile(
    path.join(parent.root, "machine-freeze.json"),
  );
  let calls = 0;
  const asr = {
    run: async (_exe, args) => {
      assert(!args.includes("--request"));
      assert(!args.includes("--prompt"));
      if (args.includes("--output-srt")) {
        calls++;
        await fs.writeFile(
          args[args.indexOf("--output-file") + 1] + ".srt",
          "1\n00:00:05,000 --> 00:00:05,500\nああ\n",
        );
      } else {
        await fs.writeFile(
          path.join(prepared.root, "kotoba-runtime.json"),
          JSON.stringify({ modelLoadCount: 1 }),
        );
        for (const r of prepared.probes) {
          calls++;
          await fs.writeFile(
            path.join(prepared.root, r.id, "kotoba-reserved.json"),
            JSON.stringify({ wavHash: r.wavHash }),
          );
          await fs.writeFile(
            path.join(prepared.root, r.id, "kotoba-raw.json"),
            JSON.stringify({
              segments: [{ start: 5.02, end: 5.5, text: "ああ" }],
            }),
          );
        }
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    },
  };
  await assert.rejects(
    runSoftSpeech(prepared.root, { runner: asr }),
    /EXPLICIT/u,
  );
  const result = await runSoftSpeech(prepared.root, {
    authorize: true,
    runner: asr,
  });
  assert.equal(calls, 4);
  const context = await prepareContext(
    prepared.root,
    path.join(root, "context"),
  );
  assert.equal(context.requests, 0);
  const neverRun = {
    run: async () => {
      throw Error("UNEXPECTED_INFERENCE");
    },
  };
  await assert.rejects(
    runContext(context.root, { runner: neverRun }),
    /EXPLICIT/u,
  );
  const contextResult = await runContext(context.root, {
    authorize: true,
    runner: neverRun,
  });
  assert.equal(contextResult.recordedRequests, 0);
  assert.equal((await finishContext(context.root)).integrity, "passed");
  await assert.rejects(
    runContext(context.root, { authorize: true, runner: neverRun }),
    /EEXIST/u,
  );
  const interrupted = path.join(root, "interrupted-export");
  await fs.cp(prepared.root, interrupted, { recursive: true });
  await fs.unlink(path.join(interrupted, "machine-freeze.json"));
  await fs.unlink(path.join(interrupted, "region-1", "kotoba.diagnostic.srt"));
  const recovered = await completeSoftSpeechOffline(interrupted);
  assert.equal(recovered.integrity, "passed");
  assert.equal(recovered.newInference, 0);
  assert.equal(calls, 4);
  await assert.rejects(
    completeSoftSpeechOffline(interrupted),
    /ALREADY_FROZEN/u,
  );
  assert.equal(vad, 2);
  assert.equal(result.integrity, "passed");
  assert.equal(result.changedTargets, 1);
  assert.equal(result.reviewProposals, 1);
  assert.equal((await verifySoftSpeech(prepared.root)).newInference, 0);
  await assert.rejects(
    runSoftSpeech(prepared.root, { authorize: true, runner: asr }),
    /EEXIST/u,
  );
  assert.equal(calls, 4);
  assert.deepEqual(
    await fs.readFile(path.join(parent.root, "machine-freeze.json")),
    frozen,
  );
  await fs.appendFile(
    path.join(prepared.root, "region-1", "whisper.srt"),
    "tamper",
  );
  await assert.rejects(verifySoftSpeech(prepared.root), /CHANGED/u);
});
