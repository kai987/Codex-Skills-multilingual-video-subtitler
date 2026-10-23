/** Reference evaluation only, after immutable local machine evidence exists. */
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileHash, checkFiles } from "./lib/local-asr-run.mjs";
import { verifyLocalCheck } from "./subtitle-tool-local-acoustic-check.mjs";
import { compareReference } from "./lib/subtitle-reference-comparison.mjs";

const read = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const cue = (r) => ({ start: r.sourceStart, end: r.sourceEnd, text: r.text });
const esc = (s) =>
  String(s).replace(
    /[&<>"']/gu,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

export async function evaluateLocalCheck(root, referencePath) {
  const plan = await verifyLocalCheck(root);
  const freeze = await read(path.join(root, "machine-freeze.json"));
  const freezeHash = await fileHash(path.join(root, "machine-freeze.json"));
  const required = [
    "plan.json",
    "machine-observations.json",
    ...plan.requests.flatMap((r) => [`${r.id}/input.wav`, `${r.id}/raw.json`]),
  ];
  if (required.some((name) => !freeze.files.some((f) => f.path === name)))
    throw Error("MACHINE_FREEZE_INCOMPLETE");
  await checkFiles(root, freeze.files);
  // Every baseline remains tied to the pre-inference plan before reading reference.
  for (const f of plan.sourceFiles)
    if ((await fileHash(f.path)) !== f.sha256) throw Error("BASELINE_CHANGED");
  const observations = await read(path.join(root, "machine-observations.json"));
  const referenceFirstReadAt = new Date().toISOString();
  const referenceAss = await fs.readFile(referencePath, "utf8");
  const referenceHash = await fileHash(referencePath);
  const views = [];
  for (const target of plan.targets) {
    const sourceTask = plan.sourceTasks.find((t) => t.id === target.id);
    const baseline = (
      await read(path.join(sourceTask.task, "mapped-records.json"))
    ).records;
    for (const request of plan.requests.filter(
      (r) => r.targetId === target.id,
    )) {
      const result = observations.requests.find(
        (r) => r.request.id === request.id,
      );
      const timing = target.kind === "timing";
      const candidate = timing
        ? result.selectedBoundary
          ? [{ ...result.selectedBoundary, text: target.records[0].text }]
          : []
        : result.records.filter((r) => !r.issues.length).map(cue);
      const baselineRecords = timing
        ? target.records.map(cue)
        : baseline.map(cue);
      const comparison = compareReference({
        referenceAss,
        baselineRecords,
        candidateRecords: candidate,
        windows: [
          {
            id: request.id,
            kind: target.kind,
            start: request.start,
            end: request.end,
          },
        ],
      });
      views.push({
        request,
        conditionalTimingOnly: timing,
        exportBlocked: result.exportBlocked ?? false,
        rawSelectedBoundary: timing ? result.selectedBoundary : null,
        conditionalTimingGate: timing ? observations.timing : null,
        comparison: comparison.perWindow[0],
      });
    }
  }
  await checkFiles(root, freeze.files);
  if ((await fileHash(referencePath)) !== referenceHash)
    throw Error("REFERENCE_CHANGED");
  const evaluation = {
    version: "local-acoustic-reference-evaluation-v1",
    referenceFirstReadAt,
    machineFreezeHash: freezeHash,
    referenceHash,
    views,
    machineFreezeVerified: true,
    previouslyExposedDevelopmentCase: true,
    referenceUsedForGeneration: false,
    humanListeningPerformed: false,
    wholeEpisodeAccuracy: null,
    independentTestSet: false,
    qualityStatus: "needs-review",
    finalizationMethod: "none",
    cautions: [
      "Whole overlapping cues are retained: crop-boundary text differences can confound CER.",
      "Narrow/wide windows share audio and model: they are not independent samples or models.",
      "CTC uses supplied machine text: a stable boundary is conditional, not lexical verification.",
      "ASR local candidates are alternatives, not automatically spliced subtitles.",
      "The user reference is an evaluation reference, not freshly listened acoustic Gold.",
    ],
  };
  const destination = path.join(root, "evaluation");
  await fs.mkdir(destination); // Never overwrite a prior reference evaluation.
  await fs.writeFile(
    path.join(destination, "reference-comparison.json"),
    JSON.stringify(evaluation, null, 2) + "\n",
    { flag: "wx" },
  );
  const rows = (records) =>
    `<ol>${records.map((r) => `<li><code>${r.start.toFixed(3)}–${r.end.toFixed(3)}</code> ${esc(r.text)}</li>`).join("")}</ol>`;
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>局部声学验证</title><style>body{font:16px/1.7 system-ui,sans-serif;max-width:1150px;margin:auto;padding:24px;background:#fafafa;color:#222}section{margin:28px 0;padding:20px;background:white;border:1px solid #ddd}audio{width:100%}code{font-size:13px;color:#555}.columns{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}h2{font-size:20px}h3{font-size:16px}li{margin:8px 0}ol{padding-left:22px}@media(max-width:800px){.columns{grid-template-columns:1fr}}</style><h1>局部声学验证 · needs-review</h1><p>4 次局部识别 + 2 次条件 CTC；总音频 ${plan.totalSeconds} 秒。原字幕未修改。所有时间是原视频时间；播放器从该局部窗口的 0 秒开始。</p><p>机器结果先冻结，再与人工稿比较；这不是全片终稿，也没有进行人工听审。CTC 仅检验给定机器文本的可能时间，不证明文字正确。</p>${views.map((v) => `<section><h2>${esc(v.request.id)} · ${v.request.start}–${v.request.end}s</h2><audio controls preload="metadata" src="../${esc(v.request.id)}/input.wav"></audio>${v.conditionalTimingOnly ? `<p>条件对齐候选：${esc(JSON.stringify(v.rawSelectedBoundary))}；双窗状态：${esc(observations.timing.status)}。未应用。</p>` : `<p>${v.exportBlocked ? "时间无效，已保留证据但阻止字幕导出。" : `<a href="../${esc(v.request.id)}/local-candidate.ass">局部 ASS</a> · <a href="../${esc(v.request.id)}/local-candidate.srt">局部 SRT</a>`}</p>`}<div class="columns"><div><h3>旧机器结果</h3>${rows(v.comparison.baseline.records)}</div><div><h3>新局部候选</h3>${rows(v.comparison.candidate.records)}</div><div><h3>人工参考（仅评价）</h3>${rows(v.comparison.reference.records)}</div></div></section>`).join("")}<p>边缘可能截断句子：这里保留所有与窗口相交的整句，不能把整窗 CER 当作全片准确率或独立增益。</p></html>`;
  await fs.writeFile(path.join(destination, "review.html"), html, {
    flag: "wx",
  });
  return {
    destination,
    views: views.length,
    machineFreezeVerified: true,
    qualityStatus: "needs-review",
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  console.log(
    JSON.stringify(await evaluateLocalCheck(...process.argv.slice(2)), null, 2),
  );
