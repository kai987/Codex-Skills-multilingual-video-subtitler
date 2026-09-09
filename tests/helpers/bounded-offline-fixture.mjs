import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { plan, slicePcm } from "../../scripts/lib/bounded-asr-ab.mjs";
import {
  configSchema,
  manifestSchema,
  fileHash,
  atomic,
} from "../../packages/video-subtitler/dist/standalone/tool.js";
import { digest } from "../../packages/video-subtitler/dist/standalone/assembly.js";
export async function fixture() {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "bounded-ab-synthetic-")),
  );
  const frames = 55 * 16000,
    pcm = { frames, sampleRate: 16000, data: Buffer.alloc(frames * 2) };
  for (let i = 0; i < frames; i++) pcm.data.writeInt16LE(i % 32767, i * 2);
  await fs.writeFile(path.join(root, "audio.wav"), slicePcm(pcm, 0, frames));
  await fs.writeFile(
    path.join(root, "raw-primary.srt"),
    "1\n00:00:01,000 --> 00:00:02,000\nneutral first\n\n1\n00:00:03,000 --> 00:00:03,000\nneutral invalid\n",
  );
  await fs.writeFile(
    path.join(root, "attempt-1.log"),
    "synthetic historical attempt",
  );
  for (const n of ["model", "runtime", "vad", "library", "python"])
    await fs.writeFile(path.join(root, n), `synthetic ${n}`);
  const config = configSchema.parse({
    model: path.join(root, "model"),
    runtime: path.join(root, "runtime"),
    language: "en",
  });
  const m = manifestSchema.parse({
    version: "subtitle-tool-v1",
    taskId: "synthetic",
    createdAt: "fixture",
    updatedAt: "fixture",
    input: path.join(root, "audio.wav"),
    inputHash: await fileHash(path.join(root, "audio.wav")),
    config,
    configHash: digest(config),
    modelHash: await fileHash(config.model),
    runtimeHash: await fileHash(config.runtime),
    ffmpegHash: digest("fixture"),
    ffprobeHash: digest("fixture"),
    track: 0,
    duration: 55,
    origin: 0,
    audioOffset: 0,
    executionStatus: "failed",
    phase: "fixture",
    artifactIntegrity: "failed",
    qualityStatus: "needs-review",
    contentQuality: "NOT_MEASURED",
    finalizationMethod: "none",
    humanValidated: false,
    machineOnlyReleaseAuthorized: false,
    audioHash: await fileHash(path.join(root, "audio.wav")),
    rawHash: await fileHash(path.join(root, "raw-primary.srt")),
    evidenceHash: null,
    warnings: [],
    attempts: [
      {
        id: "primary-1",
        startedAt: "fixture",
        endedAt: "fixture",
        reservedAudioSeconds: 55,
        state: "completed",
        error: null,
      },
    ],
    budgetSeconds: 110,
    cacheHits: 0,
    modelLoads: null,
    outputs: {},
    ownedFiles: [],
    error: "synthetic",
  });
  await atomic(path.join(root, "task.json"), m);
  const help = "GPU name: fixture (SYNTHETIC)\noptions:\n  --fixture [false]\n";
  await atomic(path.join(root, "historical.json"), {
    inputHash: m.inputHash,
    modelHash: m.modelHash,
    runtimeHash: m.runtimeHash,
    prompt: null,
    vad: false,
    coreml: false,
    preflight: {
      config,
      media: { track: 0, origin: 0, audioOffset: 0 },
      versions: { whisperHelp: help },
    },
  });
  let vad = 0;
  const result = await plan(
    {
      input: m.input,
      baselineTask: root,
      baselinePlan: path.join(root, "historical.json"),
      baseSha: "0".repeat(40),
      outputRoot: path.join(root, "out"),
      vadModel: path.join(root, "vad"),
      vadLibrary: path.join(root, "library"),
      python: path.join(root, "python"),
    },
    {
      run: async (_exe, args) => {
        if (args[0] === "--help")
          return { stdout: "", stderr: help, exitCode: 0 };
        vad++;
        assert.equal(vad, 1);
        return {
          stdout: JSON.stringify({
            inputFrames: frames,
            sampleRate: 16000,
            inferencePasses: 1,
            modelLoadCount: 1,
            probabilities: Array.from(
              { length: Math.ceil(frames / 512) },
              () => 0.9,
            ),
          }),
          stderr: "synthetic-vad",
          exitCode: 0,
        };
      },
    },
  );
  return { ...result, original: root, pcm };
}
export function stub(output, fail = 0) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    run: async (_exe, args) => {
      calls++;
      assert.ok(!args.includes("--prompt"));
      assert.ok(!args.includes("--vad"));
      assert.ok(!args.includes("--no-context"));
      assert.ok(args.includes("--suppress-nst"));
      if (calls <= fail)
        return {
          stdout: "partial stdout",
          stderr: "technical failed",
          exitCode: 1,
        };
      const prefix = args[args.indexOf("--output-file") + 1];
      await fs.writeFile(
        prefix + ".srt",
        typeof output === "function" ? output(calls) : output,
      );
      return { stdout: "synthetic", stderr: "synthetic", exitCode: 0 };
    },
  };
}
