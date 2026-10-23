import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import {
  configSchema,
  manifestSchema,
} from "../packages/video-subtitler/dist/standalone/tool.js";
import { digest } from "../packages/video-subtitler/dist/standalone/assembly.js";

const exec = promisify(execFile);
const repo = path.resolve(import.meta.dirname, "..");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const cli = async (args) => {
  try {
    return {
      ...(await exec(process.execPath, ["scripts/subtitle-tool.mjs", ...args], {
        cwd: repo,
      })),
      code: 0,
    };
  } catch (error) {
    return { stdout: error.stdout, stderr: error.stderr, code: error.code };
  }
};

test("held seam recovery has no inference or reference switches", async () => {
  const r = await cli(["recover-held-seams", "--help"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /--evidence/u);
  assert.doesNotMatch(r.stdout, /--model|--reference|--authorize-local/u);
  const v = await cli(["verify-held-seams", "--help"]);
  assert.equal(v.code, 0);
  assert.match(v.stdout, /--task/u);
  const bad = await cli(["recover-held-seams", "--model", "never-run"]);
  assert.notEqual(bad.code, 0);
});

test("local occurrence recovery is offline and exposes no inference/reference options", async () => {
  const r = await cli(["recover-local-occurrences", "--help"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /--evidence/u);
  assert.match(r.stdout, /--output-root/u);
  assert.doesNotMatch(r.stdout, /--model|--reference|--authorize-local/u);
  const v = await cli(["verify-local-occurrences", "--help"]);
  assert.equal(v.code, 0);
  assert.match(v.stdout, /--task/u);
});

test("context replay and shadow control are available without config or models", async () => {
  const g = await cli(["generate", "--help"]);
  assert.equal(g.code, 0);
  assert.match(g.stdout, /--no-context-seams/u);
  assert.match(g.stdout, /--no-recover-content/u);
  const r = await cli(["replay-seam-context", "--help"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /--evidence/u);
  assert.doesNotMatch(r.stdout, /--model|--reference/u);
});

async function fixture(t) {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "subtitle-quality-cli-")),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const task = path.join(root, "archived-task");
  await fs.mkdir(task);
  const absent = path.join(root, "absent-do-not-execute");
  const config = configSchema.parse({
    model: absent,
    runtime: absent,
    ffmpeg: absent,
    ffprobe: absent,
  });
  const raw =
    "1\n00:00:01,000 --> 00:00:02,000\nこんにちは。\n\n2\n00:00:03,000 --> 00:00:03,000\n未解決です。\n";
  const m = manifestSchema.parse({
    version: "subtitle-tool-v1",
    taskId: "archived-task",
    createdAt: "synthetic",
    updatedAt: "synthetic",
    input: absent,
    inputHash: hash("input"),
    config,
    configHash: digest(config),
    modelHash: hash("model"),
    runtimeHash: hash("runtime"),
    ffmpegHash: hash("ffmpeg"),
    ffprobeHash: hash("ffprobe"),
    track: 1,
    duration: 12,
    origin: 0,
    audioOffset: 2,
    executionStatus: "partial",
    phase: "synthetic-successful-raw",
    artifactIntegrity: "failed",
    qualityStatus: "needs-review",
    contentQuality: "NOT_MEASURED",
    finalizationMethod: "none",
    humanValidated: false,
    machineOnlyReleaseAuthorized: false,
    audioHash: hash("audio"),
    rawHash: hash(raw),
    evidenceHash: null,
    warnings: [],
    attempts: [
      {
        id: "primary-1",
        startedAt: "synthetic",
        endedAt: "synthetic",
        reservedAudioSeconds: 10,
        state: "completed",
        error: null,
      },
    ],
    budgetSeconds: 20,
    cacheHits: 0,
    rawCheckpointHits: 0,
    modelLoads: null,
    outputs: {},
    ownedFiles: ["task.json", "raw-primary.srt"],
    error: "synthetic zero-duration record",
  });
  await fs.writeFile(path.join(task, "task.json"), JSON.stringify(m));
  await fs.writeFile(path.join(task, "raw-primary.srt"), raw);
  const configPath = path.join(root, "config.json");
  await fs.writeFile(configPath, JSON.stringify(config));
  const before = await Promise.all(
    ["task.json", "raw-primary.srt"].map(async (n) =>
      hash(await fs.readFile(path.join(task, n))),
    ),
  );
  return { root, task, absent, configPath, before };
}

test("recover remains offline with missing historical media and all runtime paths; partial times map once", async (t) => {
  const f = await fixture(t);
  const r = await cli([
    "recover",
    "--task",
    f.task,
    "--output-root",
    path.join(f.root, "recovered"),
    "--export-partial",
  ]);
  assert.equal(r.code, 2, r.stderr);
  const result = JSON.parse(r.stdout);
  const index = await fs.readFile(result.outputIndex, "utf8");
  assert.match(index, /部分/u);
  const delivery = await fs.readFile(result.deliveryIndex, "utf8");
  assert.match(delivery, /时间合法的部分字幕仍可能包含重复幻觉/u);
  const audit = JSON.parse(
    await fs.readFile(result.contentAudit.report, "utf8"),
  );
  assert.equal(audit.referenceUsed, false);
  assert.equal(audit.newASRRequests, 0);
  assert.equal(audit.recoveryPlan.automaticDispatch, false);
  assert.equal(audit.audit.summary.invalidTimingCueCount, 1);
  assert.deepEqual(
    JSON.parse(await fs.readFile(result.contentAudit.recoveryPlan, "utf8")),
    audit.recoveryPlan,
  );
  const subtitle = await fs.readFile(
    path.join(
      path.dirname(result.outputIndex),
      "subtitles/primary-minimal.partial.srt",
    ),
    "utf8",
  );
  assert.match(subtitle, /00:00:03,000 --> 00:00:04,000/u);
  assert.doesNotMatch(subtitle, /未解決/u);
  assert.deepEqual(
    await Promise.all(
      ["task.json", "raw-primary.srt"].map(async (n) =>
        hash(await fs.readFile(path.join(f.task, n))),
      ),
    ),
    f.before,
  );
  assert.deepEqual((await fs.readdir(f.task)).sort(), [
    "raw-primary.srt",
    "task.json",
  ]);
  // Switching only export policy reuses the text audit but has a distinct index.
  const noExport = await cli([
    "recover",
    "--task",
    f.task,
    "--output-root",
    path.join(f.root, "recovered"),
  ]);
  assert.equal(noExport.code, 2, noExport.stderr);
  const other = JSON.parse(noExport.stdout);
  assert.notEqual(other.deliveryIndex, result.deliveryIndex);
  assert.equal(other.contentAudit.report, result.contentAudit.report);
  assert.match(
    await fs.readFile(other.deliveryIndex, "utf8"),
    /部分字幕状态：not-requested/u,
  );
  assert.match(
    await fs.readFile(other.deliveryIndex, "utf8"),
    /没有生成可用部分字幕/u,
  );
});

test("audit-content is offline, uses source-global times, and leaves archived task byte-identical", async (t) => {
  const f = await fixture(t);
  const r = await cli([
    "audit-content",
    "--task",
    f.task,
    "--output-root",
    path.join(f.root, "audits"),
  ]);
  assert.equal(r.code, 0, r.stderr);
  const result = JSON.parse(r.stdout);
  const artifact = JSON.parse(await fs.readFile(result.report, "utf8"));
  assert.equal(artifact.newASRRequests, 0);
  assert.equal(artifact.referenceUsed, false);
  assert.equal(artifact.binding.audioOffset, 2);
  assert.equal(artifact.audit.summary.recordCount, 2);
  assert.deepEqual(
    await Promise.all(
      ["task.json", "raw-primary.srt"].map(async (n) =>
        hash(await fs.readFile(path.join(f.task, n))),
      ),
    ),
    f.before,
  );
  assert.deepEqual((await fs.readdir(f.task)).sort(), [
    "raw-primary.srt",
    "task.json",
  ]);
});

test("bounded recover refuses before reading malformed plan or attempting runtime access", async (t) => {
  const f = await fixture(t);
  const bounded = path.join(f.root, "bounded");
  await fs.mkdir(bounded);
  await fs.writeFile(
    path.join(bounded, "bounded-task.json"),
    "intentionally not JSON",
  );
  const r = await cli(["recover", "--task", bounded, "--export-partial"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /recover 仅支持普通任务/u);
  assert.deepEqual(await fs.readdir(bounded), ["bounded-task.json"]);
});

test("strategy defaults and explicit single strip route-only options before strict config validation", async (t) => {
  const f = await fixture(t);
  for (const strategy of [
    [],
    ["--strategy", "single"],
    ["--no-refine-seams"],
  ]) {
    const r = await cli([
      "generate",
      "--config",
      f.configPath,
      "--input",
      f.absent,
      "--output-root",
      path.join(f.root, "no-output"),
      ...strategy,
    ]);
    assert.equal(r.code, 1);
    assert.doesNotMatch(
      r.stderr,
      /unrecognized_keys|Unrecognized key|Unrecognized keys/u,
    );
    assert.match(r.stderr, /absent-do-not-execute|需要 Node.js 24 和 npm 11/u);
  }
  await assert.rejects(fs.access(path.join(f.root, "no-output")));
});

test("route-specific flags reject before configuration loading or output creation", async (t) => {
  const f = await fixture(t);
  const common = [
    "generate",
    "--config",
    f.absent,
    "--input",
    f.absent,
    "--output-root",
    path.join(f.root, "no-output"),
  ];
  const single = await cli([
    ...common,
    "--strategy",
    "single",
    "--start",
    "1",
    "--end",
    "2",
  ]);
  assert.equal(single.code, 1);
  assert.match(single.stderr, /仅适用于 --strategy bounded/u);
  const bounded = await cli([
    ...common,
    "--strategy",
    "bounded",
    "--start",
    "1",
  ]);
  assert.equal(bounded.code, 1);
  assert.match(bounded.stderr, /--start 和 --end 必须同时指定/u);
  const implicitBounded = await cli([...common, "--start", "1"]);
  assert.equal(implicitBounded.code, 1);
  assert.match(implicitBounded.stderr, /--start 和 --end 必须同时指定/u);
  const resume = await cli(["resume", "--task", f.task, "--export-partial"]);
  assert.equal(resume.code, 1);
  assert.match(resume.stderr, /普通任务请使用 recover --export-partial/u);
  await assert.rejects(fs.access(path.join(f.root, "no-output")));
});
