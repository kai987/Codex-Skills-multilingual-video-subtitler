/** Post-freeze reference comparison; never imported by core assembly. */
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileHash, checkFiles } from "./lib/local-asr-run.mjs";
import { compareReference } from "./lib/subtitle-reference-comparison.mjs";
import { safePath } from "../packages/video-subtitler/dist/standalone/recovery.js";

const read = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const cue = (r) => ({ start: r.sourceStart, end: r.sourceEnd, text: r.text });
const esc = (v) =>
  String(v).replace(
    /[&<>"']/gu,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

export async function evaluateCoreSplice(root, referencePath) {
  await safePath(root);
  const freezePath = path.join(root, "machine-freeze.json");
  await safePath(freezePath);
  const freeze = await read(freezePath),
    freezeHash = await fileHash(freezePath);
  if (
    freeze.version !== "core-splice-freeze-v1" ||
    !freeze.files.some((f) => f.path === "core-splice.json")
  )
    throw Error("INVALID_CORE_FREEZE");
  for (const f of freeze.files) {
    if (path.isAbsolute(f.path) || f.path.split(/[\\/]/u).includes(".."))
      throw Error("UNSAFE_CORE_FREEZE_PATH");
    await safePath(path.join(root, f.path));
  }
  await checkFiles(root, freeze.files);
  const result = await read(path.join(root, "core-splice.json"));
  if (
    result.referenceUsed !== false ||
    result.newInferenceRequests !== 0 ||
    result.machineOnlyReleaseAuthorized !== false
  )
    throw Error("CORE_LINEAGE_INVALID");
  const referenceFirstReadAt = new Date().toISOString();
  const referenceAss = await fs.readFile(referencePath, "utf8"),
    referenceHash = await fileHash(referencePath);
  const comparisons = result.targets.map((t) => {
    const comparison = compareReference({
      referenceAss,
      baselineRecords: t.baseline.map(cue),
      candidateRecords: t.candidate.map(cue),
      windows: [{ id: t.id, kind: t.kind, ...t.effectiveRange }],
    });
    return {
      targetId: t.id,
      status: t.decision.status,
      integrity: t.integrity,
      comparison: comparison.perWindow[0],
    };
  });
  await checkFiles(root, freeze.files);
  if (
    (await fileHash(freezePath)) !== freezeHash ||
    (await fileHash(referencePath)) !== referenceHash
  )
    throw Error("EVALUATION_INPUT_CHANGED");
  const output = path.join(root, "evaluation");
  await fs.mkdir(output);
  const report = {
    version: "core-splice-reference-comparison-v1",
    machineFreezeHash: freezeHash,
    referenceHash,
    referenceFirstReadAt,
    referenceUsedForGeneration: false,
    previouslyExposedDevelopmentCase: true,
    independentTestSet: false,
    comparisons,
    wholeEpisodeAccuracy: null,
    humanListeningPerformed: false,
    displayBoundaryValidated: false,
    qualityStatus: "needs-review",
    finalizationMethod: "none",
    machineOnlyReleaseAuthorized: false,
    scope:
      "fixed original bounded windows; same reference denominator; source context preserved",
    cautions: [
      "Single development episode; not independent accuracy estimation.",
      "Whole overlapping reference cues may cross fixed window boundaries on both sides.",
      "Proposal changes two cues to one: old outer envelope preserved, internal timing structure changed.",
      "No acoustic timing improvement is claimed. Reference cannot select or change frozen candidate.",
    ],
  };
  await fs.writeFile(
    path.join(output, "reference-comparison.json"),
    JSON.stringify(report, null, 2) + "\n",
    { flag: "wx" },
  );
  const rows = (records) =>
    `<ol>${records.map((r) => `<li><code>${r.start.toFixed(2)}–${r.end.toFixed(2)}</code> ${esc(r.text)}</li>`).join("")}</ol>`;
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>核心片段修订候选</title><style>body{font:16px/1.7 system-ui,sans-serif;max-width:1200px;margin:auto;padding:24px;color:#222;background:#fafafa}section{margin:24px 0;background:white;border:1px solid #ccc;padding:20px}.cols{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}li{margin:8px 0}ol{padding-left:22px}code{font-size:13px;color:#555}audio{width:100%}@media(max-width:800px){.cols{grid-template-columns:1fr}}</style><h1>核心片段修订候选 · needs-review</h1><p>零新增推理。原文件未修改，只有独立候选副本。合并采用旧外边界，未通过声学时间验收；不是全片字幕或人工终稿。</p>${comparisons
    .map((c) => {
      const t = result.targets.find((t) => t.id === c.targetId),
        a = result.audio.find((a) => a.targetId === c.targetId);
      return `<section><h2>${esc(c.targetId)} · ${esc(c.status)}</h2><p>原字幕比较范围 ${t.effectiveRange.start}–${t.effectiveRange.end}s；下方音频仅覆盖局部 ${a.sourceStart}–${a.sourceEnd}s（播放器从 0 秒开始）。保留上下文 ${t.integrity.protectedRecordCount} 条。</p><audio controls preload="metadata" src="../${esc(a.path)}"></audio><p><a href="../${esc(t.id)}/candidate.needs-review.ass">候选 ASS</a> · <a href="../${esc(t.id)}/candidate.needs-review.srt">候选 SRT</a> · <a href="../${esc(t.id)}/baseline.needs-review.ass">原机器副本</a></p><p>${t.decision.status === "PROPOSED" ? `仅目标两条合为一条；旧外边界保持，内部切分改变。${esc(t.decision.proposal.text)}` : `不改：${esc(t.decision.reasons.join(", "))}`}</p><div class="cols"><div><h3>旧机器字幕</h3>${rows(c.comparison.baseline.records)}</div><div><h3>核心修订候选</h3>${rows(c.comparison.candidate.records)}</div><div><h3>人工参考（冻结后评价）</h3>${rows(c.comparison.reference.records)}</div></div></section>`;
    })
    .join(
      "",
    )}<p>没有人工听审，没有自动覆盖原字幕；所有时间为源视频时间。</p></html>`;
  await fs.writeFile(path.join(output, "review.html"), html, { flag: "wx" });
  return {
    output,
    comparisons: comparisons.map((c) => ({
      target: c.targetId,
      status: c.status,
      baselineDistance: c.comparison.baseline.edit.distance,
      candidateDistance: c.comparison.candidate.edit.distance,
      N: c.comparison.baseline.edit.N,
    })),
    qualityStatus: "needs-review",
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  console.log(
    JSON.stringify(await evaluateCoreSplice(...process.argv.slice(2)), null, 2),
  );
