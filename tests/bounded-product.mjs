/* global AbortController */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Buffer } from "node:buffer";
import {
  createBoundedTask,
  generateBounded,
  resumeBounded,
  statusBounded,
} from "../scripts/lib/bounded-product.mjs";
import { slicePcm } from "../scripts/lib/bounded-asr-ab.mjs";
import { refineDefaultDelivery } from "../scripts/lib/default-seam-delivery.mjs";
import { planChunks } from "../packages/video-subtitler/dist/standalone/bounded.js";

const good = "1\n00:00:01,000 --> 00:00:02,000\n合成テストです\n";
const invalid = "2\n00:00:03,000 --> 00:00:03,000\n未解決の合成記録\n";
const fixtureRoots = [];
after(async () => {
  for (const root of fixtureRoots) {
    if (!path.basename(root).startsWith("bounded-product-synthetic-"))
      throw Error("UNEXPECTED_SYNTHETIC_CLEANUP_TARGET");
    await fs.rm(root, { recursive: true, force: true });
  }
});
async function fixture({
  seconds = 55,
  offset = 0,
  raw = good,
  fail = 0,
  jsonOutput = false,
  pcmTransform = (data) => data,
} = {}) {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "bounded-product-synthetic-")),
  );
  fixtureRoots.push(root);
  const input = path.join(root, "selected media.mkv"),
    model = path.join(root, "model.bin");
  await fs.writeFile(input, "synthetic input, not a media file");
  await fs.writeFile(model, "synthetic local model, never loaded");
  const frames = seconds * 16000;
  const data = Buffer.alloc(frames * 2, 1);
  pcmTransform(data);
  const audio = slicePcm({ sampleRate: 16000, frames, data }, 0, frames);
  let inference = 0;
  const invocations = [];
  const runner = {
    run: async (exe, args) => {
      if (args[0] === "--help")
        return {
          stdout: `--output-srt ${jsonOutput ? "--output-json-full" : ""}`,
          stderr: "",
          exitCode: 0,
        };
      if (args[0] === "--version")
        return { stdout: "11.18.0", stderr: "", exitCode: 0 };
      if (args[0] === "-version")
        return { stdout: "synthetic version", stderr: "", exitCode: 0 };
      if (args.includes("-show_entries"))
        return {
          stdout: JSON.stringify({
            format: { duration: String(seconds + offset), start_time: "0" },
            streams: [
              { index: 1, codec_type: "audio", start_time: String(offset) },
            ],
          }),
          stderr: "",
          exitCode: 0,
        };
      if (args.includes("-map")) {
        assert.equal(args[args.indexOf("-map") + 1], "0:1");
        await fs.writeFile(args.at(-1), audio, { flag: "wx" });
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      inference++;
      invocations.push({ exe, args });
      assert.ok(!args.includes("--prompt"));
      assert.ok(!args.includes("--vad"));
      assert.ok(!args.includes("--no-context"));
      assert.equal(args[args.indexOf("--language") + 1], "ja");
      if (inference <= fail)
        return {
          stdout: "failure",
          stderr: "synthetic technical failure",
          exitCode: 1,
        };
      const prefix = args[args.indexOf("--output-file") + 1];
      await fs.writeFile(
        prefix + ".srt",
        typeof raw === "function" ? raw(inference, args) : raw,
      );
      if (jsonOutput)
        await fs.writeFile(
          prefix + ".json",
          JSON.stringify({
            transcription: [{ text: "raw, no validity claim" }],
          }),
        );
      return {
        stdout: "synthetic process",
        stderr: "synthetic process",
        exitCode: 0,
      };
    },
  };
  const options = {
    config: {
      model,
      runtime: process.execPath,
      ffmpeg: process.execPath,
      ffprobe: process.execPath,
      language: "ja",
      profile: "primary-minimal",
      threads: 2,
    },
    input,
    outputRoot: path.join(root, "out"),
    runner,
  };
  return {
    root,
    options,
    runner,
    invocations,
    get inference() {
      return inference;
    },
  };
}

test("bounded product generates independent chunks, globally maps and validates all formats", async () => {
  const f = await fixture();
  const result = await generateBounded(f.options);
  assert.equal(f.inference, 3);
  assert.equal(result.executionStatus, "completed");
  assert.equal(result.qualityStatus, "needs-review");
  assert.equal(result.finalizationMethod, "none");
  assert.equal(result.humanValidated, false);
  assert.equal(result.outputs.length, 3);
  const mapped = JSON.parse(await fs.readFile(result.recordsPath, "utf8"));
  assert.deepEqual(
    mapped.records.map((r) => r.sourceStart),
    [1, 25.7, 50.7],
  );
  assert.equal(
    new Set(f.invocations.map((v) => v.args[v.args.indexOf("--file") + 1]))
      .size,
    3,
  );
  const second = await resumeBounded(result.task, { runner: f.runner });
  assert.equal(f.inference, 3, "successful raw must never be rerun");
  assert.deepEqual(second.files, result.files);
  const status = await statusBounded(result.task);
  assert.equal(status.newASRRequests, 0);
  assert.equal(status.chunks, 3);
});

test("real default planner skips seam-free synthetic output without corrupting frozen baseline", async () => {
  const f = await fixture();
  const base = await generateBounded(f.options);
  const result = await refineDefaultDelivery(base, { language: "ja" });
  assert.equal(result.defaultDelivery.reason, "no-eligible-seams");
  assert.equal(result.defaultDelivery.inferenceRequests, 0);
  assert.equal(
    result.defaultDelivery.audioCoverageObservation.status,
    "observed",
  );
  assert.equal(result.defaultDelivery.audioCoverageObservation.previewCount, 0);
  assert.equal(
    result.defaultDelivery.audioCoverageObservation.subtitleMutationAuthorized,
    false,
  );
  assert.equal(
    result.defaultDelivery.shortResponseObservation.status,
    "observed",
  );
  assert.equal(
    result.defaultDelivery.shortResponseObservation.observedCount,
    3,
  );
  assert.match(
    await fs.readFile(result.outputIndex, "utf8"),
    /SHORT_RESPONSE_OBSERVATION.md/u,
  );
  assert.equal(f.inference, 3);
  const status = await statusBounded(base.task);
  assert.deepEqual(status.files, base.files);
  const resumed = await resumeBounded(base.task, { runner: f.runner });
  assert.deepEqual(resumed.files, base.files);
  assert.equal(f.inference, 3);
});

test("source-global range accounts for audio offset exactly once and is marked partial scope", async () => {
  const f = await fixture({ seconds: 200, offset: 2 });
  const result = await generateBounded({
    ...f.options,
    range: { start: 100, end: 125 },
  });
  const mapped = JSON.parse(await fs.readFile(result.recordsPath, "utf8"));
  assert.equal(f.inference, 1);
  assert.equal(result.coverageScope, "selected-source-range");
  assert.equal(mapped.records[0].sourceStart, 101);
  assert.equal(mapped.records[0].sourceEnd, 102);
  assert.deepEqual(mapped.effectiveRange, { start: 100, end: 125 });
});

test("invalid successful raw is retained with no automatic semantic retry or partial export", async () => {
  const f = await fixture({ seconds: 25, raw: good + "\n" + invalid });
  const result = await generateBounded(f.options);
  assert.equal(f.inference, 1);
  assert.equal(result.executionStatus, "partial");
  assert.equal(result.unresolvedCount, 1);
  assert.equal(result.outputs.length, 0);
  assert.ok(
    (
      await fs.readFile(path.join(result.task, "transcript.full.txt"), "utf8")
    ).includes("未解決の合成記録"),
  );
  const exported = await resumeBounded(result.task, {
    runner: f.runner,
    exportPartial: true,
  });
  assert.equal(f.inference, 1);
  assert.equal(exported.exportedCount, 1);
  assert.equal(exported.outputs.length, 3);
  assert.ok(exported.outputs.every((n) => n.includes(".partial.")));
  const repeated = await resumeBounded(result.task, { runner: f.runner });
  assert.equal(
    repeated.exportedCount,
    1,
    "an explicit earlier partial export remains an idempotent checkpoint",
  );
  const map = JSON.parse(
    await fs.readFile(path.join(result.task, "export-map.json"), "utf8"),
  );
  assert.equal(map.omittedRecordIds.length, 1);
});

test("raw JSON is preserved only if advertised without claiming token validity", async () => {
  const f = await fixture({ seconds: 25, jsonOutput: true });
  const result = await generateBounded(f.options);
  assert.ok(
    Object.keys(result.files).some((n) => n.endsWith("raw-response.json")),
  );
  const plan = JSON.parse(
    await fs.readFile(path.join(result.task, "bounded-plan.json"), "utf8"),
  );
  assert.equal(plan.decode.tokenEvidence, "NOT_VALIDATED");
});

test("one technical retry is charged to existing bounded budget", async () => {
  const f = await fixture({ seconds: 25, fail: 1 });
  const result = await generateBounded(f.options);
  assert.equal(f.inference, 2);
  assert.deepEqual(
    result.attempts.map((a) => a.state),
    ["failed", "completed"],
  );
  const status = await statusBounded(result.task);
  assert.equal(status.requestedAudioSeconds, 50);
});

test("technical failure budget is not renewed by resume", async () => {
  const f = await fixture({ seconds: 25, fail: 10 });
  const task = await createBoundedTask(f.options);
  await assert.rejects(
    resumeBounded(task, { runner: f.runner }),
    /REQUEST_BUDGET_EXCEEDED/u,
  );
  assert.equal(f.inference, 2);
  await assert.rejects(
    resumeBounded(task, { runner: f.runner }),
    /REQUEST_BUDGET_EXCEEDED/u,
  );
  assert.equal(f.inference, 2);
});

test("tampered successful raw and changed model fail closed without rerun", async () => {
  const f = await fixture({ seconds: 25 });
  const result = await generateBounded(f.options);
  const raw = path.join(result.task, result.attempts[0].rawPath);
  await fs.appendFile(raw, "changed");
  await assert.rejects(
    statusBounded(result.task),
    /BOUNDED_CHECKPOINT_CHANGED/u,
  );
  await assert.rejects(
    resumeBounded(result.task, { runner: f.runner }),
    /BOUNDED_CHECKPOINT_CHANGED/u,
  );
  assert.equal(f.inference, 1);
  const g = await fixture({ seconds: 25 });
  const other = await generateBounded(g.options);
  await fs.appendFile(g.options.config.model, "changed");
  await assert.rejects(
    resumeBounded(other.task, { runner: g.runner }),
    /BOUNDED_IDENTITY_CHANGED/u,
  );
  assert.equal(g.inference, 1);
  assert.equal(
    (await statusBounded(other.task)).newASRRequests,
    0,
    "status does not follow model/source paths",
  );
});

test("changed machine draft is never overwritten", async () => {
  const f = await fixture({ seconds: 25 });
  const result = await generateBounded(f.options);
  const output = path.join(result.task, result.outputs[0]);
  await fs.appendFile(output, "user modification");
  await assert.rejects(
    resumeBounded(result.task, { runner: f.runner }),
    /BOUNDED_CHECKPOINT_CHANGED/u,
  );
  assert.ok((await fs.readFile(output, "utf8")).endsWith("user modification"));
  assert.equal(f.inference, 1);
});

test("out-of-range intervals and serialization collapse remain unresolved; no clipping", async () => {
  const f = await fixture({
    seconds: 25,
    raw: "1\n00:00:24,000 --> 00:00:26,000\n範囲外\n\n2\n00:00:01,001 --> 00:00:01,004\n短すぎる\n",
  });
  const result = await generateBounded({ ...f.options, exportPartial: true });
  assert.equal(result.unresolvedCount, 2);
  assert.equal(result.outputs.length, 0);
  assert.equal(result.executionStatus, "partial");
  assert.equal(f.inference, 1);
});

test("aborted task before inference keeps reservation count zero", async () => {
  const f = await fixture({ seconds: 25 });
  const task = await createBoundedTask(f.options);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    resumeBounded(task, { runner: f.runner, signal: controller.signal }),
  );
  assert.equal(f.inference, 0);
  assert.equal((await statusBounded(task)).attempts.length, 0);
});

test("prepared tasks reject invalid ranges/profile and plan overflow without inference", async () => {
  const f = await fixture({ seconds: 25 });
  await assert.rejects(
    generateBounded({ ...f.options, range: { start: 15, end: 10 } }),
    /INVALID_SOURCE_RANGE/u,
  );
  await assert.rejects(
    generateBounded({
      ...f.options,
      config: { ...f.options.config, profile: "g11" },
    }),
    /BOUNDED_PRIMARY_MINIMAL_ONLY/u,
  );
  await assert.rejects(
    generateBounded({ ...f.options, range: { start: 20, end: 40 } }),
    /SOURCE_RANGE_OUTSIDE_AUDIO/u,
  );
  assert.throws(
    () => planChunks(65 * 25 * 16000, 16000, []),
    /PLAN_BUDGET_EXCEEDED/u,
  );
  assert.equal(f.inference, 0);
});

test("empty successful response is partial and never treated as verified no-speech", async () => {
  const f = await fixture({ seconds: 25, raw: "" });
  const result = await generateBounded(f.options);
  assert.equal(result.executionStatus, "partial");
  assert.equal(result.exportedCount, 0);
  assert.equal(result.outputs.length, 0);
  const issues = JSON.parse(
    await fs.readFile(path.join(result.task, "timing-issues.json"), "utf8"),
  );
  assert.equal(issues.emptyChunks.length, 1);
  assert.equal(issues.emptyResponseMeansNoSpeech, false);
  await resumeBounded(result.task, { runner: f.runner });
  assert.equal(f.inference, 1);
});

test("one record that loses text during format serialization is preserved as unresolved", async () => {
  const f = await fixture({
    seconds: 25,
    raw: good + "\n2\n00:00:03,000 --> 00:00:04,000\n{\\an8}危険な書式\n",
  });
  const result = await generateBounded({ ...f.options, exportPartial: true });
  assert.equal(result.executionStatus, "partial");
  assert.equal(result.unresolvedCount, 1);
  assert.equal(result.exportedCount, 1);
  assert.ok(
    (
      await fs.readFile(path.join(result.task, "transcript.full.txt"), "utf8")
    ).includes("{\\an8}"),
  );
});

test("symlinked manifests are rejected before parsing or following their paths", async () => {
  const f = await fixture({ seconds: 25 });
  const task = await createBoundedTask(f.options);
  const plan = path.join(task, "bounded-plan.json"),
    moved = path.join(f.root, "outside-plan.json");
  await fs.rename(plan, moved);
  await fs.symlink(moved, plan);
  await assert.rejects(statusBounded(task), /符号链接/u);
  assert.equal(f.inference, 0);
});

test("interrupted running reservation never silently consumes a new ASR attempt", async () => {
  const f = await fixture({ seconds: 25 });
  const task = await createBoundedTask(f.options);
  const file = path.join(task, "bounded-task.json");
  const m = JSON.parse(await fs.readFile(file, "utf8"));
  m.attempts.push({
    id: "chunk-0001-attempt-1",
    chunkId: "chunk-0001",
    seconds: 25,
    state: "running",
    startedAt: "synthetic",
    endedAt: null,
    error: null,
    rawPath: null,
    rawHash: null,
  });
  await fs.writeFile(file, JSON.stringify(m));
  await assert.rejects(
    resumeBounded(task, { runner: f.runner }),
    /INTERRUPTED_ATTEMPT_REQUIRES_INSPECTION/u,
  );
  assert.equal(f.inference, 0);
});

const loopRaw = Array.from(
  { length: 6 },
  (_, i) =>
    `${i + 1}\n00:00:${String(i * 2).padStart(2, "0")},000 --> 00:00:${String(i * 2 + 2).padStart(2, "0")},000\n女の人は、この後、何をしますか?\n`,
).join("\n");
const recoveryRequest = (args) =>
  args[args.indexOf("--output-file") + 1].includes("-recovery-");
// A replacement must account for the original claimed signal span, not only clear text risk.
const recoveryGood =
  "1\n00:00:00,000 --> 00:00:12,500\n女の人は、この後、何をしますか?\n";

test("default detects before next chunk, retries only the anomalous window, and preserves raw evidence", async () => {
  const f = await fixture({
    seconds: 50,
    raw: (n, args) =>
      recoveryRequest(args) ? recoveryGood : n > 1 ? good : loopRaw,
  });
  const base = await generateBounded(f.options);
  assert.equal(f.inference, 4);
  const order = f.invocations.map((r) => recoveryRequest(r.args));
  assert.deepEqual(
    order,
    [false, true, true, false],
    "correct before continuing primary chunks",
  );
  assert.equal(base.contentRecovery.status, "recovered-machine-draft");
  assert.equal(base.contentRecovery.reservedRequests, 2);
  assert.equal(base.contentRecovery.humanValidated, false);
  assert.equal(base.contentRecovery.after.status, "NO_DETECTED_HIGH_RISK");
  assert.equal(base.contentRecovery.outputs.length, 3);
  assert.equal(
    await fs.readFile(
      path.join(base.task, "requests/chunk-0001-attempt-1/raw-response.srt"),
      "utf8",
    ),
    loopRaw,
  );
  const delivered = await refineDefaultDelivery(
    base,
    { language: "ja" },
    {
      prepare: async () => {
        throw Error("must not add seam budget");
      },
      observe: async () => ({ status: "skipped" }),
      observeCoverage: async () => ({ status: "skipped" }),
    },
  );
  assert.deepEqual(delivered.preferredOutputs, base.contentRecovery.outputs);
  assert.equal(delivered.defaultDelivery.inferenceRequests, 2);
  assert.match(delivered.defaultDelivery.reason, /shared-enhancement-budget/);
  await resumeBounded(base.task, { runner: f.runner });
  await statusBounded(base.task);
  assert.equal(f.inference, 4, "resume/status cannot renew content budget");
});

test("persistent decoder loop gets exactly one round and cannot become preferred output", async () => {
  const f = await fixture({ seconds: 25, raw: loopRaw });
  const base = await generateBounded(f.options);
  assert.equal(f.inference, 3);
  assert.equal(base.contentRecovery.status, "needs-review");
  assert.equal(base.contentRecovery.targets[0].status, "no-gain-hold");
  const result = await refineDefaultDelivery(base, {
    language: "ja",
    enabled: false,
  });
  assert.equal(result.defaultDelivery.contentSafety.status, "HOLD");
  assert.deepEqual(result.preferredOutputs, []);
  assert.equal(result.defaultDelivery.inspectableOutputs.length, 3);
});

test("global recovery budget stops at four chunks/eight requests and records deferred targets", async () => {
  const f = await fixture({
    seconds: 125,
    raw: (_n, args) => (recoveryRequest(args) ? recoveryGood : loopRaw),
  });
  const base = await generateBounded(f.options);
  assert.equal(f.inference, 13);
  assert.equal(base.contentRecovery.reservedRequests, 8);
  assert(base.contentRecovery.reservedAudioSeconds <= 120);
  assert.equal(base.contentRecovery.targets.at(-1).status, "deferred-budget");
  assert.equal(base.contentRecovery.status, "needs-review");
  await resumeBounded(base.task, { runner: f.runner });
  assert.equal(f.inference, 13);
});

test("opt-out disables inference, never detection; four legitimate repeats do not dispatch", async () => {
  const f = await fixture({ seconds: 25, raw: loopRaw });
  const base = await generateBounded({ ...f.options, recoverContent: false });
  assert.equal(f.inference, 1);
  assert.equal(base.contentRecovery.status, "needs-review");
  assert.equal(base.contentRecovery.targets[0].status, "disabled");
  const g = await fixture({
    seconds: 25,
    raw: loopRaw.split("\n\n").slice(0, 4).join("\n\n"),
  });
  const clean = await generateBounded(g.options);
  assert.equal(g.inference, 1);
  assert.equal(clean.contentRecovery.status, "no-detected-risk");
});

test("retry process failure does not consume technical primary retries or restart recovery", async () => {
  const f = await fixture({
    seconds: 25,
    raw: (_n, args) => {
      if (recoveryRequest(args))
        throw Error("synthetic recovery runtime failure");
      return loopRaw;
    },
  });
  const base = await generateBounded(f.options);
  assert.equal(f.inference, 2);
  assert.equal(base.contentRecovery.targets[0].status, "failed-hold");
  assert.deepEqual(
    base.contentRecovery.requests.map((r) => r.state),
    ["failed", "not-started"],
  );
  assert.equal(base.attempts.length, 1);
  await resumeBounded(base.task, { runner: f.runner });
  assert.equal(f.inference, 2);
});

test("empty or invalid retry evidence never replaces full original records", async () => {
  for (const raw of ["", invalid]) {
    const f = await fixture({
      seconds: 25,
      raw: (_n, args) => (recoveryRequest(args) ? raw : loopRaw),
    });
    const base = await generateBounded(f.options);
    assert.equal(base.contentRecovery.status, "needs-review");
    assert.equal(base.contentRecovery.outputs.length, 0);
    assert.equal(base.contentRecovery.targets[0].status, "failed-hold");
    assert.equal(base.recordCount, 6);
  }
});

test("content recovery uses source offset and selected range exactly once", async () => {
  const f = await fixture({
    seconds: 75,
    offset: 2,
    raw: (_n, args) => (recoveryRequest(args) ? recoveryGood : loopRaw),
  });
  const base = await generateBounded({
    ...f.options,
    range: { start: 27, end: 52 },
  });
  assert.equal(base.contentRecovery.status, "recovered-machine-draft");
  const records = JSON.parse(
    await fs.readFile(
      path.join(base.contentRecovery.root, "candidate-records.json"),
      "utf8",
    ),
  );
  assert.deepEqual(
    records.map((r) => r.sourceStart),
    [27, 39.5],
  );
  assert.deepEqual(
    base.contentRecovery.requests.map((r) => [r.sourceStart, r.sourceEnd]),
    [
      [27, 39.5],
      [39.5, 52],
    ],
  );
});

test("cancellation during recovery persists consumed reservation and cannot retry on resume", async () => {
  const controller = new AbortController();
  const f = await fixture({
    seconds: 25,
    raw: (_n, args) => {
      if (recoveryRequest(args)) {
        controller.abort();
        throw Error("cancelled");
      }
      return loopRaw;
    },
  });
  await assert.rejects(
    generateBounded({ ...f.options, signal: controller.signal }),
    /cancelled/,
  );
  const task = path.join(
    f.options.outputRoot,
    (await fs.readdir(f.options.outputRoot))[0],
  );
  const report = JSON.parse(
    await fs.readFile(
      path.join(task, "default-content-recovery/recovery.json"),
      "utf8",
    ),
  );
  assert.equal(report.status, "cancelled");
  assert.equal(report.reservedRequests, 2);
  await resumeBounded(task, { runner: f.runner });
  assert.equal(f.inference, 2);
});

test("three repeats on either side of a seam trigger one bounded round for both chunks", async () => {
  const phrase = (start) =>
    Array.from(
      { length: 3 },
      (_, i) =>
        `${i + 1}\n00:00:${String(start + i * 2).padStart(2, "0")},000 --> 00:00:${String(start + i * 2 + 2).padStart(2, "0")},000\n女の人は、この後、何をしますか?\n`,
    ).join("\n");
  const f = await fixture({
    seconds: 50,
    raw: (n, args) =>
      recoveryRequest(args) ? recoveryGood : phrase(n === 1 ? 18 : 0),
  });
  const base = await generateBounded(f.options);
  assert.equal(f.inference, 6);
  assert.equal(base.contentRecovery.targets.length, 2);
  assert.equal(base.contentRecovery.reservedRequests, 4);
  assert(
    base.contentRecovery.targets.every((t) =>
      t.riskCodes.includes("SENTENCE_DECODER_LOOP"),
    ),
  );
});

test("status verifies frozen recovery evidence, reads no model, and fails closed on tampering", async () => {
  const f = await fixture({
    seconds: 25,
    raw: (_n, args) => (recoveryRequest(args) ? recoveryGood : loopRaw),
  });
  const base = await generateBounded(f.options);
  await fs.rename(f.options.config.model, f.options.config.model + ".moved");
  const status = await statusBounded(base.task);
  assert.equal(status.contentRecovery.status, "recovered-machine-draft");
  assert.equal(status.contentRecovery.newASRRequests, 0);
  await fs.appendFile(
    base.contentRecovery.outputs.find((p) => p.endsWith(".srt")),
    "tampered",
  );
  await assert.rejects(
    statusBounded(base.task),
    /CONTENT_RECOVERY_EVIDENCE_CHANGED/,
  );
  assert.equal(f.inference, 3);
});

test("all-zero primary skips ASR, persists proof, and remains zero calls on resume/status", async () => {
  const f = await fixture({
    seconds: 25,
    pcmTransform: (data) => data.fill(0),
  });
  const base = await generateBounded(f.options);
  assert.equal(f.inference, 0);
  assert.equal(base.attempts.length, 0);
  assert.equal(base.executionStatus, "completed");
  assert.equal(base.recordCount, 0);
  const proof = path.join(base.task, "zero-audio/chunk-0001.json");
  assert.equal(
    JSON.parse(await fs.readFile(proof, "utf8")).allSamplesExactlyZero,
    true,
  );
  await resumeBounded(base.task, { runner: f.runner });
  assert.equal((await statusBounded(base.task)).requestedAudioSeconds, 0);
  assert.equal(f.inference, 0);
  await fs.appendFile(proof, "changed");
  await assert.rejects(statusBounded(base.task), /BOUNDED_CHECKPOINT_CHANGED/);
});

test("mixed primary chunks skip only exact zero and retain the actual signal chunk", async () => {
  const f = await fixture({
    seconds: 50,
    pcmTransform: (data) => data.fill(0, 0, 25.3 * 32000),
  });
  const base = await generateBounded(f.options);
  assert.equal(f.inference, 1);
  assert.equal(base.executionStatus, "completed");
  assert.equal(base.recordCount, 1);
  assert.equal(base.outputs.length, 3);
});

test("recovery skips an all-zero half without fabricating an empty ASR response", async () => {
  const f = await fixture({
    seconds: 25,
    raw: (_n, args) => (recoveryRequest(args) ? recoveryGood : loopRaw),
    pcmTransform: (data) => data.fill(0, 0, 12.5 * 32000),
  });
  const base = await generateBounded(f.options);
  assert.equal(f.inference, 2);
  assert.deepEqual(
    base.contentRecovery.requests.map((r) => r.state),
    ["skipped-digital-zero", "completed"],
  );
  assert.equal(
    base.contentRecovery.reservedRequests,
    2,
    "skip does not renew the budget",
  );
  assert.equal(base.contentRecovery.startedRequests, 1);
  assert.equal(base.contentRecovery.status, "recovered-machine-draft");
});

test("clean-looking short recovery is held for lost signal and never preferred", async () => {
  const f = await fixture({
    seconds: 25,
    raw: (_n, args) => (recoveryRequest(args) ? good : loopRaw),
  });
  const base = await generateBounded(f.options);
  assert.equal(base.contentRecovery.targets[0].status, "regression-hold");
  assert(
    base.contentRecovery.targets[0].regression.issues.some(
      (i) => i.code === "UNEXPLAINED_SIGNAL_SPAN_LOSS",
    ),
  );
  assert.deepEqual(base.contentRecovery.outputs, []);
  const delivered = await refineDefaultDelivery(
    base,
    { language: "ja" },
    {
      prepare: async () => {
        throw Error("must not run");
      },
      observe: async () => ({ status: "skipped" }),
      observeCoverage: async () => ({ status: "skipped" }),
    },
  );
  assert.deepEqual(delivered.preferredOutputs, []);
  assert.equal(base.recordCount, 6);
});

test("long zero-signal display holds even with no text risk or recovery reservation", async () => {
  const f = await fixture({
    seconds: 25,
    raw: "1\n00:00:00,000 --> 00:00:08,000\n二番の問題を聞いてください\n",
    pcmTransform: (data) => data.fill(0, 0, 6 * 32000),
  });
  const base = await generateBounded(f.options);
  assert.equal(base.contentRecovery.reservedRequests, 0);
  assert.equal(base.contentRecovery.audioSupport.status, "HOLD");
  const delivered = await refineDefaultDelivery(
    base,
    { language: "ja" },
    {
      prepare: async () => {
        throw Error("must not run");
      },
      observe: async () => ({ status: "skipped" }),
      observeCoverage: async () => ({ status: "skipped" }),
    },
  );
  assert.deepEqual(delivered.preferredOutputs, []);
  assert.match(delivered.defaultDelivery.reason, /content-recovery-hold/);
  assert.equal(f.inference, 1);
});
