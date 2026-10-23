/** Offline diagnostics; never consults media, models or adjacent subtitle files. */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  readTask,
  fileHash,
} from "../../packages/video-subtitler/dist/standalone/tool.js";
import {
  rawRecords,
  safePath,
} from "../../packages/video-subtitler/dist/standalone/recovery.js";
import { auditContent } from "./machine-content-audit.mjs";
import { buildMachineRiskRecoveryPlan } from "./machine-risk-recovery-plan.mjs";
import { contentSafety } from "./content-safety-gate.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");

async function writeOrVerify(file, content) {
  await safePath(path.dirname(file));
  try {
    await fs.writeFile(file, content, { flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    await safePath(file);
    if ((await fs.readFile(file, "utf8")) !== content)
      throw Error("AUDIT_ARTIFACT_CHANGED", { cause: error });
  }
}

export async function loadTaskRecords(task) {
  await safePath(task);
  const manifest = await readTask(task);
  if (
    !manifest.rawHash ||
    !manifest.attempts.some((a) => a.state === "completed")
  )
    throw Error("SUCCESSFUL_RAW_CHECKPOINT_REQUIRED");
  const raw = path.join(task, "raw-primary.srt");
  await safePath(raw);
  if ((await fileHash(raw)) !== manifest.rawHash)
    throw Error("RAW_HASH_MISMATCH");
  const records = rawRecords(
    await fs.readFile(raw, "utf8"),
    manifest.rawHash,
  ).map((r) => ({
    id: r.recordId,
    index: r.order - 1,
    requestId: "single-primary",
    start: r.localStart === null ? NaN : r.localStart + manifest.audioOffset,
    end: r.localEnd === null ? NaN : r.localEnd + manifest.audioOffset,
    text: r.text ?? r.rawBlock,
  }));
  return { manifest, records };
}

export async function deliverContentAudit({
  records,
  language,
  sourceEnd,
  binding,
  outputRoot,
  additionalWarnings = [],
  budget,
  evidenceWindows,
}) {
  const audit = auditContent(records, { language, sourceEnd });
  const recoveryPlan = buildMachineRiskRecoveryPlan({
    records,
    audit,
    sourceEnd,
    binding,
    budget,
    evidenceWindows,
  });
  const artifact = {
    version: "subtitle-content-audit-delivery-v3",
    contentSafety: contentSafety(records, { language }),
    binding,
    audit,
    recoveryPlan,
    additionalWarnings,
    referenceUsed: false,
    newASRRequests: 0,
    textMutations: 0,
    timingMutations: 0,
    acousticCorrectness: "NOT_VERIFIED",
    finalizationMethod: "none",
    humanValidated: false,
    machineOnlyReleaseAuthorized: false,
  };
  const bytes = JSON.stringify(artifact, null, 2) + "\n";
  const identity = hash(bytes);
  const directory = path.join(
    path.resolve(outputRoot),
    `content-audit-${identity.slice(0, 20)}`,
  );
  await safePath(directory, true);
  await fs.mkdir(directory, { recursive: true });
  await safePath(directory);
  const report = path.join(directory, "content-audit.json");
  const recoveryPlanPath = path.join(directory, "recovery-plan.json");
  const index = path.join(directory, "CONTENT_AUDIT.md");
  const summary = [
    "# Machine content warnings — not acoustic validation",
    "",
    `Records: ${audit.summary.recordCount}; flagged cues: ${audit.summary.flaggedCueCount}; warnings: ${audit.summary.issueCount}.`,
    `Additional source/assembly warnings: ${additionalWarnings.length}. These are separate from the text-only heuristic counts.`,
    "",
    "Status: needs-review. A valid subtitle file is not necessarily a reliable transcription.",
    `Content safety: ${artifact.contentSafety.status}; ${artifact.contentSafety.reviewCueIndexes.length} high-risk records. See contentSafety in the JSON. These additional safety findings are not yet dispatched by the legacy recovery plan below.`,
    "No text or timing was changed; no inference or reference reading occurred.",
    "Repetitions and long spans are review signals, not proof of hallucination or permission to delete dialogue.",
    "",
    "## Bounded recovery plan (not executed)",
    "",
    "Every text-audit finding remains in the plan. Selected windows are proposals, not authorization to run a model or replace a cue. Budget-deferred and unlocatable findings remain unresolved.",
    "Source/assembly additionalWarnings above remain separate unresolved evidence; the text-risk planner does not claim to cover them.",
    "Existing candidate coverage is not proof of a successful repair. Partial overlap does not count as full-region coverage.",
    "",
    "[Machine-only recovery plan](recovery-plan.json)",
    "",
    `Selected: ${recoveryPlan.summary.selectedRequestCount} requests / ${recoveryPlan.summary.selectedAudioSeconds} seconds; deferred windows: ${recoveryPlan.summary.deferredWindowCount}; unlocatable records: ${recoveryPlan.summary.unlocatableRecordCount}.`,
    "",
    "| Source region (s) | Risk codes | Planned coverage | Existing candidate coverage |",
    "| --- | --- | --- | --- |",
    ...recoveryPlan.regions.map(
      (r) =>
        `| ${r.start}–${r.end} (${r.kind}) | ${r.riskCodes.join(", ")} | ${r.selectionCoverage}: ${r.selectedCoverageSeconds}s; uncovered ${r.uncoveredSeconds}s | ${r.evidenceCoverage}: ${r.evidenceCoverageSeconds}s |`,
    ),
    "",
    "Details: [content-audit.json](content-audit.json)",
    "",
    `SHA-256: ${identity}`,
    "",
  ].join("\n");
  // Exclusive writes, or exact reuse. Never overwrite a user's edited audit.
  for (const [file, content] of [
    [report, bytes],
    [recoveryPlanPath, JSON.stringify(recoveryPlan, null, 2) + "\n"],
    [index, summary],
  ]) {
    await writeOrVerify(file, content);
  }
  return {
    directory,
    report,
    index,
    recoveryPlan: recoveryPlanPath,
    sha256: identity,
    summary: audit.summary,
    contentSafety: artifact.contentSafety,
    additionalWarnings,
    qualityStatus: "needs-review",
  };
}

export async function auditTaskContent(
  task,
  { outputRoot, budget, evidenceWindows } = {},
) {
  const { manifest: m, records } = await loadTaskRecords(task);
  return deliverContentAudit({
    records,
    language: m.config.language,
    sourceEnd: m.duration,
    binding: {
      taskId: m.taskId,
      inputHash: m.inputHash,
      rawHash: m.rawHash,
      audioOffset: m.audioOffset,
      duration: m.duration,
    },
    outputRoot: outputRoot ?? path.join(task, "content-audits"),
    budget,
    evidenceWindows,
  });
}

/** Add a new delivery index without editing the immutable recovery contract. */
export async function attachRecoveryContentAudit(task, result) {
  const partialStatus = result.recovery.partialSubtitle;
  const partialGenerated = partialStatus === "generated";
  const contentAudit = await auditTaskContent(task, {
    outputRoot: path.join(path.dirname(result.directory), "content-audits"),
  });
  const recoveryLink = path
    .relative(contentAudit.directory, result.outputIndex)
    .split(path.sep)
    .map(encodeURIComponent)
    .join("/");
  const deliveryIndex = path.join(
    contentAudit.directory,
    `DELIVERY_INDEX-${hash(recoveryLink).slice(0, 16)}.md`,
  );
  await writeOrVerify(
    deliveryIndex,
    [
      partialGenerated
        ? "# 部分字幕与机器内容风险：仍需复核"
        : "# 原始记录与机器内容风险：没有生成可用部分字幕",
      "",
      `完整原始记录 ${contentAudit.summary.recordCount}；风险记录 ${contentAudit.summary.flaggedCueCount}；警告 ${contentAudit.summary.issueCount}。`,
      "",
      "时间合法的部分字幕仍可能包含重复幻觉、错词和漏词，不能当作修复后的终稿。",
      `部分字幕状态：${partialStatus}。${partialGenerated ? "已生成时间合法子集，不是全文终稿。" : "本次没有可用的部分字幕；请查看原始记录与恢复说明。"}`,
      "",
      `- [${partialGenerated ? "全文、时间问题与部分字幕" : "全文、时间问题与恢复说明"}](${recoveryLink})`,
      "- [内容风险说明](CONTENT_AUDIT.md)",
      "- [风险覆盖与有界候选计划（未执行）](recovery-plan.json)",
      "",
      "零新增识别；零正文/时间修改。计划选中不代表已解决；deferred-budget / unlocatable 仍待处理。",
      "原始任务及 recovery.json 合同保持不变。needs-review；finalizationMethod=none。",
      "",
    ].join("\n"),
  );
  return { ...result, deliveryIndex, contentAudit };
}
