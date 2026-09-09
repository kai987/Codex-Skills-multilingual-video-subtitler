/* global AbortController */
import { legacyFixtureReport } from "./helpers/legacy-bounded-fixture.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import {
  plan,
  runB,
  report as revisedReport,
  slicePcm,
  readPcm,
  ledger,
  attemptsFrom,
  loadExperiment,
  experimentSchema,
} from "../scripts/lib/bounded-asr-ab.mjs";
import {
  configSchema,
  manifestSchema,
  fileHash,
  atomic,
} from "../packages/video-subtitler/dist/standalone/tool.js";
import { digest } from "../packages/video-subtitler/dist/standalone/assembly.js";

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
async function report(manifest, options = {}) {
  await legacyFixtureReport(manifest, { exportPartial: true });
  return revisedReport(manifest, {
    outputRoot: path.join(path.dirname(path.dirname(manifest)), "revisions"),
    ...options,
  });
}
test("sample slices exactly match source and reject invalid indexes", () => {
  const p = { frames: 100, sampleRate: 44100, data: Buffer.alloc(200, 17) };
  const s = readPcm(slicePcm(p, 20, 70));
  assert.equal(s.frames, 50);
  assert.deepEqual(s.data, p.data.subarray(40, 140));
  assert.throws(() => slicePcm(p, -1, 70));
  assert.throws(() => readPcm(Buffer.from("bad")));
});
test("complete synthetic B, same-process and fresh ledger resume reuse all successful raw", async () => {
  const f = await fixture(),
    raw = "1\n00:00:01,000 --> 00:00:02,000\nneutral response\n",
    runner = stub(raw);
  const originalHash = await fileHash(path.join(f.original, "task.json"));
  await runB(f.manifest, { runner });
  assert.equal(runner.calls, f.chunks);
  const noCall = {
    run: () => {
      throw Error("must not run checkpoint");
    },
  };
  const resumed = await runB(f.manifest, { runner: noCall });
  assert.equal(resumed.checkpointHits, f.chunks);
  const c = await report(f.manifest, { exportPartial: true });
  assert.equal(c.B.partial, "generated");
  assert.equal(c.A.partial, "generated");
  assert.equal(c.A.rawRecords, 2);
  assert.equal(c.A.stages.raw.tags.ZERO_DURATION, 1);
  assert.equal(c.historical.counts.ANewRequests, 0);
  assert.equal(c.historical.counts.BRequests, f.chunks);
  assert.equal(
    await fileHash(path.join(f.original, "task.json")),
    originalHash,
  );
  const m = await loadExperiment(f.manifest);
  assert.equal(
    experimentSchema.safeParse({ ...m, humanValidated: true }).success,
    false,
  );
});
test("successful bad timing and empty chunks are never retried; report preserves full records", async () => {
  const f = await fixture(),
    runner = stub((n) =>
      n === 2 ? "" : "1\n00:00:01,000 --> 00:00:01,000\nretained invalid\n",
    );
  await runB(f.manifest, { runner });
  const c = await report(f.manifest);
  assert.equal(runner.calls, f.chunks);
  assert.equal(c.B.emptySuccessfulChunks, 1);
  assert.equal(c.B.rawRecords, f.chunks - 1);
  assert.equal(c.B.unresolvedRecords, f.chunks - 1);
  assert.notEqual(c.B.partial, "generated");
});
test("one technical retry is cumulative; second failure leaves incomplete B", async () => {
  const f = await fixture(),
    runner = stub("", 10);
  await assert.rejects(runB(f.manifest, { runner }), /BUDGET/u);
  assert.equal(runner.calls, 2);
  assert.equal(attemptsFrom(await ledger(f.root)).length, 2);
  const c = await report(f.manifest);
  assert.equal(c.B.completeRequests, false);
  assert.equal(c.historical.counts.BRetries, 1);
  await assert.rejects(runB(f.manifest, { runner }), /BUDGET/u);
  assert.equal(runner.calls, 2);
});
test("one failed then successful request can continue remaining chunks", async () => {
  const f = await fixture(),
    runner = stub("1\n00:00:01,000 --> 00:00:02,000\nneutral\n", 1);
  await runB(f.manifest, { runner });
  assert.equal(runner.calls, f.chunks + 1);
  assert.equal((await report(f.manifest)).B.completeRequests, true);
});
test("raw corruption never launches replacement; partial journal is fail-closed", async () => {
  const f = await fixture(),
    runner = stub("");
  await runB(f.manifest, { runner });
  const a = attemptsFrom(await ledger(f.root))[0];
  await fs.writeFile(path.join(f.root, a.rawPath), "changed");
  await assert.rejects(runB(f.manifest, { runner }), /CORRUPT/u);
  assert.equal(runner.calls, f.chunks);
  await fs.appendFile(path.join(f.root, "requests.jsonl"), "{");
  await assert.rejects(ledger(f.root), /PARTIAL_LEDGER/u);
});
test("plan mutation, software identity change and concurrent lock block before model", async () => {
  const f = await fixture(),
    m = JSON.parse(await fs.readFile(f.manifest, "utf8"));
  await fs.writeFile(path.join(f.root, ".experiment-lock"), "occupied");
  await assert.rejects(runB(f.manifest), /EEXIST/u);
  await fs.unlink(path.join(f.root, ".experiment-lock"));
  await fs.writeFile(f.manifest, JSON.stringify({ ...m, audioOffset: 9 }));
  await assert.rejects(loadExperiment(f.manifest), /FROZEN/u);
  await fs.writeFile(f.manifest, JSON.stringify(m));
  await fs.writeFile(m.baseline.model.path, "changed");
  await assert.rejects(runB(f.manifest), /IDENTITY_CHANGED/u);
});
test("fresh CLI process resumes with zero launches, report works without historical media/model", async () => {
  const f = await fixture(),
    runner = stub("1\n00:00:01,000 --> 00:00:02,000\nneutral\n");
  await runB(f.manifest, { runner });
  const cli = path.resolve("scripts/subtitle-tool-bounded-asr-ab.mjs");
  const resumed = JSON.parse(
    execFileSync(
      process.execPath,
      [cli, "run", "--manifest", f.manifest, "--execute-b"],
      { encoding: "utf8" },
    ),
  );
  assert.equal(resumed.checkpointHits, f.chunks);
  await fs.rename(
    path.join(f.original, "model"),
    path.join(f.original, "model-away"),
  );
  await fs.rename(
    path.join(f.original, "audio.wav"),
    path.join(f.original, "audio-away.wav"),
  );
  await legacyFixtureReport(f.manifest, { exportPartial: true });
  let stdout;
  try {
    execFileSync(
      process.execPath,
      [
        cli,
        "report",
        "--manifest",
        f.manifest,
        "--output-root",
        path.join(f.original, "reports"),
      ],
      { encoding: "utf8" },
    );
  } catch (e) {
    assert.equal(e.status, 2);
    stdout = e.stdout;
  }
  const output = JSON.parse(stdout);
  assert.equal(output.B.subtitleExport, "not-requested");
  assert.equal(output.historical.counts.BRequests, f.chunks);
});
test("cancellation consumes reservation, does not auto retry; symlink output is rejected", async () => {
  const f = await fixture(),
    controller = new AbortController();
  await assert.rejects(
    runB(f.manifest, {
      signal: controller.signal,
      runner: {
        run: async () => {
          controller.abort();
          return { stdout: "", stderr: "cancelled", exitCode: 1 };
        },
      },
    }),
  );
  assert.equal(attemptsFrom(await ledger(f.root)).length, 1);
  assert.equal(attemptsFrom(await ledger(f.root))[0].state, "cancelled");
  const target = path.join(f.original, "escape");
  await fs.symlink(f.root, target);
  await assert.rejects(
    loadExperiment(path.join(target, "experiment.json")),
    /符号链接/u,
  );
});
