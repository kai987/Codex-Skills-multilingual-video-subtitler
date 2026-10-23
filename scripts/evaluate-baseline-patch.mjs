/** Reference-only evaluation after workspace and exact export have been frozen. */
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileHash, checkFiles, readJson } from "./lib/local-asr-run.mjs";
import { identity } from "./lib/content-review-plan.mjs";
import {
  loadBaselinePatch,
  validateBaselinePatchExport,
} from "./lib/baseline-patch-run.mjs";
import { projectBaselinePatches } from "./lib/baseline-patch-policy.mjs";
import { compareReference } from "./lib/subtitle-reference-comparison.mjs";
import { safePath } from "../packages/video-subtitler/dist/standalone/recovery.js";

const cues = (records) =>
  records.map((r) => ({
    start: r.sourceStart,
    end: r.sourceEnd,
    text: r.text,
  }));
const save = (p, v) =>
  fs.writeFile(p, JSON.stringify(v, null, 2) + "\n", { flag: "wx" });
export async function evaluateBaselinePatch(root, exportRoot, referencePath) {
  const w = await loadBaselinePatch(root);
  exportRoot = await safePath(path.resolve(exportRoot));
  const freezePath = await safePath(
      path.join(exportRoot, "machine-freeze.json"),
    ),
    freezeHash = await fileHash(freezePath),
    freeze = await readJson(freezePath);
  if (
    freeze.version !== "baseline-patch-export-freeze-v1" ||
    freeze.workspaceHash !== identity(w) ||
    !Array.isArray(freeze.files)
  )
    throw Error("EXPORT_FREEZE_MISMATCH");
  const paths = new Set();
  for (const f of freeze.files) {
    if (
      typeof f.path !== "string" ||
      path.isAbsolute(f.path) ||
      f.path.split(/[\\/]/u).some((p) => !p || p === ".." || p === ".") ||
      paths.has(f.path)
    )
      throw Error("UNSAFE_EXPORT_FREEZE");
    paths.add(f.path);
    await safePath(path.join(exportRoot, f.path));
  }
  for (const name of [
    "baseline-records.json",
    "candidate-records.json",
    "patch-export.json",
  ])
    if (!paths.has(name)) throw Error("INCOMPLETE_EXPORT_FREEZE");
  await checkFiles(exportRoot, freeze.files);
  const summary = await readJson(path.join(exportRoot, "patch-export.json")),
    baseline = await readJson(path.join(exportRoot, "baseline-records.json")),
    candidate = await readJson(path.join(exportRoot, "candidate-records.json"));
  if (
    summary.workspaceHash !== identity(w) ||
    summary.referenceUsed !== false ||
    summary.newInferenceRequests !== 0 ||
    summary.machineOnlyReleaseAuthorized !== false ||
    identity(baseline) !== identity(w.baseline)
  )
    throw Error("EXPORT_LINEAGE_MISMATCH");
  const projected = projectBaselinePatches(
    w.baseline,
    w.proposals,
    summary.selectedPatchIds,
    { sourceHash: w.sourceHash, mode: "preview" },
  );
  if (
    projected.status === "REJECTED" ||
    identity(projected.records) !== identity(candidate) ||
    identity(projected) !== identity(summary.projection)
  )
    throw Error("EXPORT_PROJECTION_MISMATCH");
  const verifiedExport = await validateBaselinePatchExport(
    w,
    exportRoot,
    freeze,
    summary,
  );
  // The shared comparator is time-window based. Do not silently drop unplaceable
  // raw text and then claim full-text coverage. Source-local zero duration is OK.
  if (
    [...baseline, ...candidate].some(
      (r) =>
        typeof r.text !== "string" ||
        !Number.isFinite(r.sourceStart) ||
        !Number.isFinite(r.sourceEnd) ||
        r.sourceStart < 0 ||
        r.sourceStart >= w.sourceDuration ||
        r.sourceEnd < r.sourceStart ||
        r.sourceEnd > w.sourceDuration,
    )
  )
    throw Error("FULL_TEXT_EVALUATION_REQUIRES_SOURCE_PLACEABLE_RECORDS");
  const out = path.join(exportRoot, "evaluation");
  try {
    await fs.lstat(out);
    throw Error("EVALUATION_ALREADY_EXISTS");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  // The first and only reference read in this workflow occurs below this barrier.
  const referenceFirstReadAt = new Date().toISOString(),
    referenceAss = await fs.readFile(referencePath, "utf8"),
    referenceHash = await fileHash(referencePath);
  const windows = [
    {
      id: "whole-episode",
      kind: "full-source-text",
      start: 0,
      end: w.sourceDuration,
    },
    ...w.decisions.map((d) => ({
      id: d.windowId,
      kind: "frozen-machine-window",
      ...d.window,
    })),
  ];
  const comparison = compareReference({
    referenceAss,
    baselineRecords: cues(baseline),
    candidateRecords: cues(candidate),
    windows,
  });
  const exportedComparison =
    summary.baseline.files.length && summary.candidate.files.length
      ? compareReference({
          referenceAss,
          baselineRecords: verifiedExport.serialized.baseline,
          candidateRecords: verifiedExport.serialized.candidate,
          windows: [windows[0]],
        }).perWindow[0]
      : null;
  const originalTargets = new Set(
    w.proposals
      .filter((p) => summary.selectedPatchIds.includes(p.patchId))
      .flatMap((p) => p.targetRecordIds),
  );
  const protectedBefore = baseline.filter(
    (r) => !originalTargets.has(r.recordId),
  );
  const protectedAfter = candidate.filter((r) =>
    protectedBefore.some((b) => b.recordId === r.recordId),
  );
  if (identity(protectedBefore) !== identity(protectedAfter))
    throw Error("PROTECTED_BASELINE_CHANGED");
  await loadBaselinePatch(root);
  await checkFiles(exportRoot, freeze.files);
  if (
    (await fileHash(freezePath)) !== freezeHash ||
    (await fileHash(referencePath)) !== referenceHash
  )
    throw Error("EVALUATION_INPUT_CHANGED");
  const report = {
    version: "baseline-patch-reference-comparison-v1",
    workspaceHash: identity(w),
    exportFreezeHash: freezeHash,
    referenceHash,
    referenceFirstReadAt,
    role: summary.role,
    referenceUsedForGeneration: false,
    previouslyExposedDevelopmentCase: true,
    independentTestSet: false,
    humanListeningPerformed: false,
    fullTextComparisonIncludesUnresolvedRecords: true,
    comparison,
    exportedSubsetComparison: exportedComparison,
    protectedRecordCount: protectedBefore.length,
    protectedRecordsUnchanged: true,
    originalUnresolved: summary.baseline.unresolvedCount,
    candidateUnresolved: summary.candidate.unresolvedCount,
    replacedOriginalIssues: summary.replacedOriginalIssues,
    qualityStatus: "needs-review",
    finalizationMethod: "none",
    machineOnlyReleaseAuthorized: false,
    cautions: [
      "Same full-source reference denominator, but reference includes only declared Dialogue Japanese first lines; not independently certified acoustic accuracy.",
      "A zero-duration record covered by a speculative replacement is not an independently verified timing repair.",
      "Full text and partial serialized subsets are evaluated separately; omitted invalid records remain visible.",
      "Local windows overlap the full-source window and must not be summed.",
      "Reference cannot select, apply, or undo any patch.",
      "Full-text comparison rejects unparseable or out-of-source records before reference access; it never silently excludes their text.",
    ],
  };
  await fs.mkdir(out);
  await save(path.join(out, "reference-comparison.json"), report);
  const rows = comparison.perWindow
    .map(
      (r) =>
        `| ${r.window.id} | ${r.baseline.edit.N} | ${r.baseline.edit.distance} → ${r.candidate.edit.distance} | ${r.baseline.edit.S} → ${r.candidate.edit.S} | ${r.baseline.edit.D} → ${r.candidate.edit.D} | ${r.baseline.edit.I} → ${r.candidate.edit.I} |`,
    )
    .join("\n");
  await fs.writeFile(
    path.join(out, "EVALUATION.md"),
    `# 原始底稿与局部修订：冻结后比较\n\n状态 needs-review；${summary.role === "preview" ? "这是未人工确认的预览，不是已应用补丁。" : "这是显式动作生成的独立副本，不是质量终稿。"}\n\n| 范围 | 参考字符数 | 编辑距离 | 替换 | 遗漏 | 多余 |\n| --- | ---: | ---: | ---: | ---: | ---: |\n${rows}\n\n原始完整记录 ${baseline.length} → 候选 ${candidate.length}；${protectedBefore.length} 条非目标记录完整不变。未解决记录 ${summary.baseline.unresolvedCount} → ${summary.candidate.unresolvedCount}；减少部分只是被候选替换覆盖，不是已验证时间修复。\n\n全片这一行比较全部保存文字，包括未解决记录；实际部分字幕的独立分数见 JSON 的 exportedSubsetComparison，不混用两种分母。窗口与全片有重叠，不得相加。人工稿仅使用 Dialogue 日语第一行；未认证声学准确率，未进行人工听审，也不是独立盲测。\n\n[完整比较数据](reference-comparison.json) · [修订稿索引](../OUTPUT_INDEX.md)\n`,
    { flag: "wx" },
  );
  const full = comparison.perWindow[0];
  return {
    output: out,
    baselineDistance: full.baseline.edit.distance,
    candidateDistance: full.candidate.edit.distance,
    N: full.baseline.edit.N,
    protectedRecordCount: protectedBefore.length,
    qualityStatus: "needs-review",
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  console.log(
    JSON.stringify(
      await evaluateBaselinePatch(...process.argv.slice(2)),
      null,
      2,
    ),
  );
