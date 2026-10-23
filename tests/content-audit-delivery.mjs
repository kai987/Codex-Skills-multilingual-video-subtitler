import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  fileHash,
  manifestSchema,
} from "../packages/video-subtitler/dist/standalone/tool.js";
import {
  auditTaskContent,
  deliverContentAudit,
} from "../scripts/lib/content-audit-delivery.mjs";
const exec = promisify(execFile);
const repo = path.resolve(import.meta.dirname, "..");
async function fixture() {
  const dir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "content-audit-test-")),
  );
  const raw =
    "1\n00:00:00,000 --> 00:00:20,000\n同じ文\n\n2\n00:00:20,000 --> 00:00:20,000\n長いまま残す文\n";
  await fs.writeFile(path.join(dir, "raw-primary.srt"), raw);
  const h = "a".repeat(64);
  const m = manifestSchema.parse({
    version: "subtitle-tool-v1",
    taskId: "synthetic",
    createdAt: "test",
    updatedAt: "test",
    input: "/never-read/media",
    inputHash: h,
    config: {
      model: "/never-read/model",
      runtime: "/never-run/runtime",
      language: "ja",
    },
    configHash: h,
    modelHash: h,
    runtimeHash: h,
    ffmpegHash: h,
    ffprobeHash: h,
    track: 0,
    duration: 25,
    origin: 0,
    audioOffset: 0,
    executionStatus: "partial",
    phase: "test",
    artifactIntegrity: "failed",
    qualityStatus: "needs-review",
    contentQuality: "NOT_MEASURED",
    finalizationMethod: "none",
    humanValidated: false,
    machineOnlyReleaseAuthorized: false,
    audioHash: null,
    rawHash: await fileHash(path.join(dir, "raw-primary.srt")),
    evidenceHash: null,
    warnings: [],
    attempts: [
      {
        id: "one",
        startedAt: "test",
        endedAt: "test",
        reservedAudioSeconds: 25,
        state: "completed",
        error: null,
      },
    ],
    budgetSeconds: 50,
    cacheHits: 0,
    modelLoads: null,
    outputs: {},
    ownedFiles: [],
    error: null,
  });
  await fs.writeFile(path.join(dir, "task.json"), JSON.stringify(m));
  return dir;
}
test("offline saved-task audit preserves old task and needs no historical executable/media", async () => {
  const dir = await fixture();
  const before = await fileHash(path.join(dir, "task.json"));
  const output = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "content-audit-out-")),
  );
  const result = await auditTaskContent(dir, { outputRoot: output });
  const report = JSON.parse(await fs.readFile(result.report));
  assert.equal(report.audit.summary.recordCount, 2);
  assert.equal(report.audit.summary.invalidTimingCueCount, 1);
  assert.equal(report.newASRRequests, 0);
  assert.equal(report.referenceUsed, false);
  assert.equal(report.version, "subtitle-content-audit-delivery-v3");
  assert.equal(report.contentSafety.status, "HOLD");
  const plan = JSON.parse(await fs.readFile(result.recoveryPlan, "utf8"));
  assert.deepEqual(plan, report.recoveryPlan);
  assert.equal(plan.automaticDispatch, false);
  assert.equal(plan.newASRRequests, 0);
  assert.equal(plan.referenceUsed, false);
  assert.equal(await fileHash(path.join(dir, "task.json")), before);
  assert.deepEqual((await fs.readdir(dir)).sort(), [
    "raw-primary.srt",
    "task.json",
  ]);
  assert.deepEqual(await auditTaskContent(dir, { outputRoot: output }), result);
});
test("modified audit is not overwritten", async () => {
  const dir = await fixture();
  const first = await auditTaskContent(dir);
  await fs.appendFile(first.report, "user edit");
  await assert.rejects(auditTaskContent(dir), /AUDIT_ARTIFACT_CHANGED/);
});
test("modified recovery plan is not overwritten", async () => {
  const dir = await fixture();
  const first = await auditTaskContent(dir);
  await fs.appendFile(first.recoveryPlan, "user edit");
  await assert.rejects(auditTaskContent(dir), /AUDIT_ARTIFACT_CHANGED/);
});
test("raw identity mismatch fails closed", async () => {
  const dir = await fixture();
  await fs.appendFile(path.join(dir, "raw-primary.srt"), "tamper");
  await assert.rejects(auditTaskContent(dir), /RAW_HASH_MISMATCH/);
});
test("old-task CLI audit works without installed source/model", async () => {
  const dir = await fixture();
  const output = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "content-audit-cli-")),
  );
  const { stdout } = await exec(
    process.execPath,
    [
      "scripts/subtitle-tool.mjs",
      "audit-content",
      "--task",
      dir,
      "--output-root",
      output,
    ],
    { cwd: repo },
  );
  assert.equal(JSON.parse(stdout).summary.recordCount, 2);
});
test("zero issues is not acoustic approval", async () => {
  const outputRoot = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "content-audit-clean-")),
  );
  const result = await deliverContentAudit({
    records: [{ start: 0, end: 2, text: "こんにちは" }],
    language: "ja",
    sourceEnd: 3,
    binding: { synthetic: true },
    outputRoot,
  });
  const report = JSON.parse(await fs.readFile(result.report));
  assert.equal(report.audit.summary.issueCount, 0);
  assert.equal(report.acousticCorrectness, "NOT_VERIFIED");
  assert.equal(report.machineOnlyReleaseAuthorized, false);
});
