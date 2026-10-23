/** Offline baseline-preserving patch workspace. No reference reads or inference. */
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { fileHash, inventory, checkFiles, readJson } from "./local-asr-run.mjs";
import { identity } from "./content-review-plan.mjs";
import { statusBounded } from "./bounded-product.mjs";
import { readPcm } from "./bounded-asr-ab.mjs";
import {
  readRecoverySource,
  safePath,
} from "../../packages/video-subtitler/dist/standalone/recovery.js";
import {
  mapRaw,
  serializeRecords,
  formats,
} from "../../packages/video-subtitler/dist/standalone/bounded.js";
import {
  proposeBaselinePatch,
  projectBaselinePatches,
} from "./baseline-patch-policy.mjs";
import {
  saveActionSnapshot,
  readActionSnapshot,
} from "./review-action-store.mjs";

const sha = z.string().regex(/^[a-f0-9]{64}$/u);
const configSchema = z
  .object({
    baselineTask: z.string().min(1),
    baselineManifestHash: sha,
    baselineRawHash: sha,
    evidenceRoot: z.string().min(1),
    evidenceFreezeHash: sha,
    outputRoot: z.string().min(1),
  })
  .strict();
const freezeSchema = z
  .object({
    version: z.literal("baseline-patch-workspace-freeze-v1"),
    workspaceHash: sha,
    files: z.array(
      z
        .object({
          path: z.string(),
          sha256: sha,
          bytes: z.number().int().nonnegative(),
        })
        .strict(),
    ),
  })
  .strict();
export const patchActionsSchema = z
  .object({
    version: z.literal("baseline-patch-actions-v1"),
    workspaceHash: sha,
    reviewVersion: z.literal(1),
    actions: z
      .array(
        z
          .object({
            patchId: z.string().min(1),
            evidenceHash: sha,
            action: z.enum(["ACCEPT_PATCH", "KEEP_ORIGINAL"]),
            acknowledgedUncertainties: z.boolean(),
            reason: z.string().min(1).max(2000),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
const save = (p, v) =>
  fs.writeFile(p, JSON.stringify(v, null, 2) + "\n", { flag: "wx" });
const within = (root, p) => p === root || p.startsWith(root + path.sep);
const relative = (p) => {
  if (
    path.isAbsolute(p) ||
    p.split(/[\\/]/u).some((x) => !x || x === ".." || x === ".")
  )
    throw Error("UNSAFE_RELATIVE_PATH");
  return p;
};
async function verifyFiles(root, files) {
  const paths = new Set();
  for (const f of files) {
    relative(f.path);
    if (paths.has(f.path)) throw Error("DUPLICATE_FREEZE_PATH");
    paths.add(f.path);
    await safePath(path.join(root, f.path));
  }
  await checkFiles(root, files);
}
async function software() {
  return Promise.all(
    [
      "baseline-patch-run.mjs",
      "baseline-patch-policy.mjs",
      "review-action-store.mjs",
      "machine-content-audit.mjs",
      "../../packages/video-subtitler/dist/standalone/recovery.js",
      "../../packages/video-subtitler/dist/standalone/bounded.js",
    ].map(async (p) => {
      const filename = path.resolve(import.meta.dirname, p);
      return { path: filename, sha256: await fileHash(filename) };
    }),
  );
}
function project(w, ids) {
  const r = projectBaselinePatches(w.baseline, w.proposals, ids, {
    sourceHash: w.sourceHash,
    mode: "preview",
  });
  if (r.status === "REJECTED")
    throw Error("PATCH_PROJECTION_REJECTED:" + r.reasons.join(","));
  return r;
}
export async function prepareBaselinePatch(value) {
  const c = configSchema.parse(value);
  const base = await readRecoverySource(c.baselineTask),
    evidenceRoot = path.resolve(c.evidenceRoot),
    outputRoot = path.resolve(c.outputRoot);
  if (
    base.taskHash !== c.baselineManifestHash ||
    base.m.rawHash !== c.baselineRawHash
  )
    throw Error("BASELINE_IDENTITY_MISMATCH");
  await safePath(evidenceRoot);
  await safePath(outputRoot, true);
  if ([base.task, evidenceRoot].some((r) => within(r, outputRoot)))
    throw Error("SEPARATE_OUTPUT_REQUIRED");
  const frozenPath = await safePath(
    path.join(evidenceRoot, "machine-freeze.json"),
  );
  if ((await fileHash(frozenPath)) !== c.evidenceFreezeHash)
    throw Error("EVIDENCE_FREEZE_MISMATCH");
  const frozen = await readJson(frozenPath);
  if (!Array.isArray(frozen.files)) throw Error("INVALID_EVIDENCE_FREEZE");
  await verifyFiles(evidenceRoot, frozen.files);
  const planPath = await safePath(path.join(evidenceRoot, "plan.json"));
  if ((await fileHash(planPath)) !== frozen.planHash)
    throw Error("EVIDENCE_PLAN_MISMATCH");
  const plan = await readJson(planPath);
  if (
    plan.inputHash !== base.m.inputHash ||
    plan.rawHash !== base.m.rawHash ||
    plan.baselineManifestHash !== base.taskHash
  )
    throw Error("EVIDENCE_BASELINE_MISMATCH");
  if (
    !Array.isArray(plan.windows) ||
    !plan.windows.length ||
    plan.windows.length > 20
  )
    throw Error("INVALID_WINDOWS");
  const baseline = base.analysis.records,
    decisions = [],
    donors = [],
    audio = [];
  const seenWindows = new Set();
  for (const window of plan.windows) {
    if (
      !/^[a-z0-9-]+$/u.test(window.id) ||
      seenWindows.has(window.id) ||
      !Number.isFinite(window.start) ||
      !Number.isFinite(window.end) ||
      window.start < 0 ||
      window.end <= window.start ||
      window.end > base.m.duration
    )
      throw Error("INVALID_WINDOW");
    seenWindows.add(window.id);
    const matches = frozen.files.filter(
      (f) =>
        f.path.startsWith(window.id + "/") &&
        f.path.endsWith("/bounded-task.json"),
    );
    if (matches.length !== 1) throw Error("UNIQUE_DONOR_TASK_REQUIRED");
    const task = path.join(evidenceRoot, path.dirname(matches[0].path));
    const state = await statusBounded(task),
      p = state.plan;
    if (
      state.inputHash !== base.m.inputHash ||
      p.audioHash !== base.m.audioHash ||
      p.duration !== base.m.duration ||
      p.effectiveRange.start !== window.start ||
      p.effectiveRange.end !== window.end ||
      state.executionStatus !== "completed"
    )
      throw Error("DONOR_SOURCE_BINDING");
    const taskRel = path.relative(evidenceRoot, task);
    for (const name of [
      "bounded-plan.json",
      "mapped-records.json",
      ...state.attempts
        .filter((a) => a.state === "completed")
        .map((a) => a.rawPath),
    ]) {
      if (!frozen.files.some((f) => f.path === taskRel + "/" + name))
        throw Error("UNFROZEN_DONOR_FILE");
    }
    const mapped = await readJson(path.join(task, "mapped-records.json")),
      reconstructed = [];
    for (const a of state.attempts.filter((a) => a.state === "completed")) {
      reconstructed.push(
        ...mapRaw(
          await fs.readFile(path.join(task, relative(a.rawPath)), "utf8"),
          a.rawHash,
          p.chunks.find((x) => x.id === a.chunkId),
          p.sampleRate,
          p.effectiveRange.start,
          p.duration,
          a.id,
        ),
      );
    }
    if (identity(reconstructed) !== identity(mapped.records))
      throw Error("DONOR_RAW_MAPPING_MISMATCH");
    const donorEvidenceHash = identity({
      freeze: c.evidenceFreezeHash,
      task: matches[0].sha256,
      mapped: state.files["mapped-records.json"],
      source: base.m.inputHash,
    });
    const result = proposeBaselinePatch({
      baseline,
      donorRecords: mapped.records,
      window: { start: window.start, end: window.end },
      sourceHash: base.m.inputHash,
      donorSourceHash: state.inputHash,
      donorEvidenceHash,
    });
    decisions.push({
      windowId: window.id,
      window: { start: window.start, end: window.end },
      ...result,
    });
    donors.push({
      windowId: window.id,
      records: mapped.records,
      donorEvidenceHash,
      sourceHash: state.inputHash,
    });
    if (result.status === "PROPOSED") {
      const request = state.attempts.find((a) => a.state === "completed");
      if (state.attempts.filter((a) => a.state === "completed").length !== 1)
        throw Error("PATCH_REVIEW_SINGLE_CLIP_REQUIRED");
      const rel = "requests/" + request.id + "/input.wav",
        expected = state.files[rel];
      if (
        !expected ||
        !frozen.files.some(
          (f) => f.path === taskRel + "/" + rel && f.sha256 === expected,
        )
      )
        throw Error("UNBOUND_REVIEW_AUDIO");
      const clip = path.join(task, rel),
        pcm = readPcm(await fs.readFile(clip)),
        chunk = p.chunks.find((x) => x.id === request.chunkId);
      if (
        pcm.sampleRate !== p.sampleRate ||
        pcm.frames !== chunk.inputEnd - chunk.inputStart
      )
        throw Error("REVIEW_PCM_LENGTH");
      audio.push({
        windowId: window.id,
        sourcePath: clip,
        sha256: expected,
        path: "audio/" + window.id + ".wav",
        sourceStart: window.start + chunk.inputStart / p.sampleRate,
        sourceEnd: window.start + chunk.inputEnd / p.sampleRate,
      });
    }
  }
  const code = await software();
  const workspace = {
    version: "baseline-patch-workspace-v1",
    reviewVersion: 1,
    sourceHash: base.m.inputHash,
    sourceDuration: base.m.duration,
    language: base.m.config.language,
    baseline,
    donors,
    decisions,
    proposals: decisions
      .filter((d) => d.status === "PROPOSED")
      .map((d) => d.proposal),
    audio: audio.map((a) => {
      const entry = { ...a };
      delete entry.sourcePath;
      return entry;
    }),
    software: code,
    bindings: {
      baselineTask: base.task,
      baselineManifestHash: base.taskHash,
      baselineRawHash: base.m.rawHash,
      evidenceRoot,
      evidenceFreezeHash: c.evidenceFreezeHash,
    },
    referenceUsed: false,
    newInferenceRequests: 0,
    modelLoads: 0,
    qualityStatus: "needs-review",
    finalizationMethod: "none",
    machineOnlyReleaseAuthorized: false,
  };
  project(
    workspace,
    workspace.proposals.map((p) => p.patchId),
  );
  await fs.mkdir(outputRoot, { recursive: true });
  const root = await fs.mkdtemp(path.join(outputRoot, "baseline-patch-"));
  await fs.mkdir(path.join(root, "audio"));
  for (const a of audio) {
    await fs.copyFile(
      a.sourcePath,
      path.join(root, a.path),
      fs.constants.COPYFILE_EXCL,
    );
    if ((await fileHash(path.join(root, a.path))) !== a.sha256)
      throw Error("REVIEW_AUDIO_CHANGED");
  }
  await save(path.join(root, "workspace.json"), workspace);
  await verifyFiles(evidenceRoot, frozen.files);
  if (
    (await fileHash(frozenPath)) !== c.evidenceFreezeHash ||
    (await fileHash(path.join(base.task, "task.json"))) !== base.taskHash ||
    (await fileHash(path.join(base.task, "raw-primary.srt"))) !== base.m.rawHash
  )
    throw Error("SOURCE_CHANGED_DURING_PREPARE");
  for (const s of code)
    if ((await fileHash(s.path)) !== s.sha256)
      throw Error("SOFTWARE_CHANGED_DURING_PREPARE");
  await save(path.join(root, "workspace-freeze.json"), {
    version: "baseline-patch-workspace-freeze-v1",
    workspaceHash: identity(workspace),
    files: await inventory(root),
  });
  const empty = {
    version: "baseline-patch-actions-v1",
    workspaceHash: identity(workspace),
    reviewVersion: 1,
    actions: [],
  };
  await saveActionSnapshot(root, empty);
  await save(path.join(root, "accept-actions.template.json"), {
    ...empty,
    actions: workspace.proposals.map((p) => ({
      patchId: p.patchId,
      evidenceHash: p.evidenceHash,
      action: "ACCEPT_PATCH",
      acknowledgedUncertainties: false,
      reason:
        "Replace this note after reviewing the candidate and its uncertainties.",
    })),
  });
  await fs.writeFile(
    path.join(root, "OUTPUT_INDEX.md"),
    `# 原始整集底稿的局部修订\n\nneeds-review。新增推理 0，人工确认 0。原始文件不修改。\n\n候选数 ${workspace.proposals.length}。使用同一审核命令的 preview-patch 查看候选，apply-patch 明确确认，undo-patch 恢复动作快照。模板默认未确认风险，不能直接应用。\n\n[机器工作区](workspace.json) · [待填写确认模板](accept-actions.template.json)\n\n原始非法时间保留为未解决；除非显式 export-partial，否则不生成不完整字幕。候选删除的异常记录仅为提案替换，不叫做时间修复。\n`,
    { flag: "wx" },
  );
  return {
    root,
    proposals: workspace.proposals.length,
    abstentions: decisions.length - workspace.proposals.length,
    baselineRecords: baseline.length,
    newInferenceRequests: 0,
    qualityStatus: "needs-review",
  };
}
export async function loadBaselinePatch(root) {
  root = await safePath(path.resolve(root));
  const freeze = freezeSchema.parse(
    await readJson(await safePath(path.join(root, "workspace-freeze.json"))),
  );
  if (!freeze.files.some((f) => f.path === "workspace.json"))
    throw Error("MISSING_WORKSPACE");
  await verifyFiles(root, freeze.files);
  const w = await readJson(path.join(root, "workspace.json"));
  if (
    identity(w) !== freeze.workspaceHash ||
    w.version !== "baseline-patch-workspace-v1" ||
    w.referenceUsed !== false ||
    w.newInferenceRequests !== 0 ||
    w.machineOnlyReleaseAuthorized !== false
  )
    throw Error("WORKSPACE_IDENTITY");
  for (const d of w.decisions) {
    const donor = w.donors.find((x) => x.windowId === d.windowId);
    if (!donor) throw Error("MISSING_DONOR");
    const result = proposeBaselinePatch({
      baseline: w.baseline,
      donorRecords: donor.records,
      window: d.window,
      sourceHash: w.sourceHash,
      donorSourceHash: donor.sourceHash,
      donorEvidenceHash: donor.donorEvidenceHash,
    });
    const stored = { ...d };
    delete stored.windowId;
    delete stored.window;
    if (identity(result) !== identity(stored))
      throw Error("STALE_PATCH_POLICY:" + d.windowId);
  }
  if (
    identity(w.proposals) !==
    identity(
      w.decisions.filter((d) => d.status === "PROPOSED").map((d) => d.proposal),
    )
  )
    throw Error("PROPOSAL_BINDING");
  project(
    w,
    w.proposals.map((p) => p.patchId),
  );
  return w;
}
export function validatePatchActions(w, value) {
  const a = patchActionsSchema.parse(value);
  if (a.workspaceHash !== identity(w) || a.reviewVersion !== w.reviewVersion)
    throw Error("STALE_WORKSPACE");
  const seen = new Set();
  for (const item of a.actions) {
    const p = w.proposals.find((p) => p.patchId === item.patchId);
    if (!p || p.evidenceHash !== item.evidenceHash || seen.has(item.patchId))
      throw Error("STALE_OR_DUPLICATE_PATCH");
    seen.add(item.patchId);
    if (item.action === "ACCEPT_PATCH" && !item.acknowledgedUncertainties)
      throw Error("EXPLICIT_UNCERTAINTY_ACKNOWLEDGMENT_REQUIRED");
  }
  project(
    w,
    a.actions.filter((a) => a.action === "ACCEPT_PATCH").map((a) => a.patchId),
  );
  return a;
}
function exportable(records, sourceDuration, language) {
  const eligible = [],
    unresolved = [];
  for (const r of records) {
    const reasons = [...(r.issues ?? [])];
    if (
      !Number.isFinite(r.sourceStart) ||
      !Number.isFinite(r.sourceEnd) ||
      r.sourceStart < 0 ||
      r.sourceEnd > sourceDuration ||
      r.sourceEnd <= r.sourceStart
    )
      reasons.push("INVALID_TIME");
    if (typeof r.text !== "string" || !r.text.trim())
      reasons.push("INVALID_TEXT");
    if (!reasons.length) {
      try {
        serializeRecords([r], language);
      } catch {
        reasons.push("SERIALIZATION_LOSS");
      }
    }
    if (reasons.length)
      unresolved.push({
        recordId: r.recordId,
        reasons: [...new Set(reasons)],
        text: r.text,
      });
    else eligible.push(r);
  }
  return { eligible, unresolved };
}

/** Validate the exact exported bytes before reference access, not only JSON summaries. */
export async function validateBaselinePatchExport(w, output, freeze, summary) {
  if (
    summary.version !== "baseline-patch-export-v1" ||
    summary.workspaceHash !== identity(w) ||
    typeof summary.exportPartial !== "boolean" ||
    !["preview", "reviewed-copy"].includes(summary.role) ||
    (summary.role === "preview" && summary.actionsHash !== null) ||
    summary.referenceUsed !== false ||
    summary.newInferenceRequests !== 0 ||
    summary.machineOnlyReleaseAuthorized !== false
  )
    throw Error("INVALID_EXPORT_CONTRACT");
  const projected = project(w, summary.selectedPatchIds);
  if (identity(projected) !== identity(summary.projection))
    throw Error("EXPORT_PROJECTION_MISMATCH");
  const frozenNames = new Set(freeze.files.map((f) => f.path)),
    serialized = {};
  for (const [side, records] of [
    ["baseline", w.baseline],
    ["candidate", projected.records],
  ]) {
    const { eligible, unresolved } = exportable(
      records,
      w.sourceDuration,
      w.language,
    );
    const willExport =
      eligible.length > 0 && (!unresolved.length || summary.exportPartial);
    const projection = willExport
      ? serializeRecords(eligible, w.language)
      : null;
    const names = projection
      ? Object.keys(projection.files).map(
          (ext) =>
            side +
            (unresolved.length ? ".partial" : "") +
            ".needs-review." +
            ext,
        )
      : [];
    const expected = {
      recordCount: records.length,
      recordHash: identity(records),
      eligibleCount: eligible.length,
      unresolvedCount: unresolved.length,
      omittedRecordIds: unresolved.map((r) => r.recordId),
      exportedRecordIds: willExport ? eligible.map((r) => r.recordId) : [],
      files: names,
      partial: unresolved.length > 0,
    };
    if (identity(summary[side]) !== identity(expected))
      throw Error("EXPORT_ACCOUNTING_MISMATCH:" + side);
    for (const filename of names) {
      if (!frozenNames.has(filename))
        throw Error("UNFROZEN_DECLARED_SUBTITLE:" + filename);
      const ext = path.extname(filename).slice(1),
        file = await safePath(path.join(output, filename));
      const bytes = await fs.readFile(file, "utf8");
      if (bytes !== projection.files[ext])
        throw Error("EXPORTED_SUBTITLE_CONTENT_MISMATCH:" + filename);
      const parsed = formats[ext].parse(bytes);
      if (
        parsed.length !== projection.cues.length ||
        parsed.some(
          (r, i) =>
            r.text !== projection.cues[i].text ||
            r.start !== projection.cues[i].start ||
            r.end !== projection.cues[i].end,
        )
      )
        throw Error("EXPORTED_SUBTITLE_ROUNDTRIP");
      if (ext === "srt") serialized[side] = parsed;
    }
    serialized[side] ??= null;
  }
  return { projected, serialized };
}
async function exportProjection(
  root,
  w,
  ids,
  { exportPartial = false, role, actionsHash = null },
) {
  const projected = project(w, ids);
  const parent = path.join(root, "exports");
  await safePath(parent, true);
  await fs.mkdir(parent, { recursive: true });
  await safePath(parent);
  const output = await fs.mkdtemp(path.join(parent, role + "-"));
  const summaries = {};
  for (const [side, records] of [
    ["baseline", w.baseline],
    ["candidate", projected.records],
  ]) {
    const { eligible, unresolved } = exportable(
      records,
      w.sourceDuration,
      w.language,
    );
    await save(path.join(output, side + "-records.json"), records);
    await fs.writeFile(
      path.join(output, side + ".full.txt"),
      records.map((r) => r.text ?? r.rawBlock ?? "").join("\n") + "\n",
      { flag: "wx" },
    );
    await save(path.join(output, side + "-unresolved.json"), unresolved);
    const files = [];
    if (eligible.length && (!unresolved.length || exportPartial)) {
      const projection = serializeRecords(eligible, w.language);
      for (const [ext, bytes] of Object.entries(projection.files)) {
        const filename =
          side + (unresolved.length ? ".partial" : "") + ".needs-review." + ext;
        await fs.writeFile(path.join(output, filename), bytes, { flag: "wx" });
        const parsed = formats[ext].parse(
          await fs.readFile(path.join(output, filename), "utf8"),
        );
        if (
          parsed.length !== projection.cues.length ||
          parsed.some(
            (r, i) =>
              r.text !== projection.cues[i].text ||
              r.start !== projection.cues[i].start ||
              r.end !== projection.cues[i].end,
          )
        )
          throw Error("SUBTITLE_DISK_ROUNDTRIP");
        files.push(filename);
      }
    }
    summaries[side] = {
      recordCount: records.length,
      recordHash: identity(records),
      eligibleCount: eligible.length,
      unresolvedCount: unresolved.length,
      omittedRecordIds: unresolved.map((r) => r.recordId),
      exportedRecordIds: files.length ? eligible.map((r) => r.recordId) : [],
      files,
      partial: unresolved.length > 0,
    };
  }
  const selected = w.proposals.filter((p) => ids.includes(p.patchId));
  const targets = new Set(selected.flatMap((p) => p.targetRecordIds));
  const summary = {
    version: "baseline-patch-export-v1",
    workspaceHash: identity(w),
    role,
    exportPartial,
    actionsHash,
    selectedPatchIds: ids,
    projection: projected,
    baseline: summaries.baseline,
    candidate: summaries.candidate,
    originalAccounting: w.baseline.map((r) => ({
      recordId: r.recordId,
      disposition: targets.has(r.recordId)
        ? "replaced-in-proposal"
        : "preserved",
      hadInvalidTiming: (r.issues ?? []).length > 0,
    })),
    replacedOriginalIssues: selected.flatMap((p) =>
      w.baseline
        .filter(
          (r) => p.targetRecordIds.includes(r.recordId) && r.issues?.length,
        )
        .map((r) => ({
          recordId: r.recordId,
          issues: r.issues,
          disposition:
            "included-in-text-and-segmentation-proposal-not-timing-repaired",
        })),
    ),
    sourceMutations: 0,
    newInferenceRequests: 0,
    referenceUsed: false,
    humanValidated: false,
    qualityStatus: "needs-review",
    finalizationMethod: "none",
    machineOnlyReleaseAuthorized: false,
  };
  await save(path.join(output, "patch-export.json"), summary);
  await loadBaselinePatch(root);
  if (actionsHash !== null) await safePath(path.join(root, "actions.json"));
  if (
    actionsHash !== null &&
    identity(await readJson(path.join(root, "actions.json"))) !== actionsHash
  )
    throw Error("REVIEW_ACTIONS_CHANGED_DURING_EXPORT");
  await save(path.join(output, "machine-freeze.json"), {
    version: "baseline-patch-export-freeze-v1",
    workspaceHash: identity(w),
    files: await inventory(output),
  });
  await fs.writeFile(
    path.join(output, "OUTPUT_INDEX.md"),
    `# ${role === "preview" ? "未确认的整集局部修订预览" : "显式审核动作的独立修订副本"}\n\n原底稿 ${summaries.baseline.recordCount} 条 → 候选 ${summaries.candidate.recordCount} 条。候选未解决 ${summaries.candidate.unresolvedCount} 条；新增推理 0。\n\n${summaries.candidate.files.map((f) => `- [${f}](${f})`).join("\n")}\n\n[修改与原记录对账](patch-export.json) · [全文（含未解决）](candidate.full.txt) · [未解决记录](candidate-unresolved.json)\n\n未确认预览不是人工审核，也不是默认字幕。保留 source-global 时间；试听 clip 从0开始。仍为 needs-review。\n`,
    { flag: "wx" },
  );
  return {
    output,
    role,
    selectedPatchIds: ids,
    ...summaries,
    newInferenceRequests: 0,
    qualityStatus: "needs-review",
  };
}
export async function previewBaselinePatch(root, options = {}) {
  const w = await loadBaselinePatch(root);
  return exportProjection(
    root,
    w,
    w.proposals.map((p) => p.patchId),
    { ...options, role: "preview" },
  );
}
export async function applyBaselinePatch(root, value, options = {}) {
  const w = await loadBaselinePatch(root),
    a = validatePatchActions(w, value);
  await saveActionSnapshot(root, a);
  return exportProjection(
    root,
    w,
    a.actions.filter((a) => a.action === "ACCEPT_PATCH").map((a) => a.patchId),
    { ...options, role: "reviewed-copy", actionsHash: identity(a) },
  );
}
export async function restoreBaselinePatch(root, snapshotHash, options = {}) {
  const w = await loadBaselinePatch(root),
    a = validatePatchActions(w, await readActionSnapshot(root, snapshotHash));
  return applyBaselinePatch(root, a, options);
}
