/** Consume frozen machine responses and original stored tokens. No model entry. */
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { safePath } from "../packages/video-subtitler/dist/standalone/recovery.js";
import { formats } from "../packages/video-subtitler/dist/standalone/bounded.js";
import { reviewCandidateBoundaries } from "./lib/candidate-boundary-review.mjs";
import { localizeStoredContext } from "./lib/full-context-token-localization.mjs";
const [sourceArg, auditArg, parentArg] = process.argv.slice(2);
assert(
  sourceArg && auditArg && parentArg,
  "PROBE_ROOT STORED_AUDIT OUTPUT_PARENT",
);
const source = path.resolve(sourceArg),
  auditFile = path.resolve(auditArg),
  parent = path.resolve(parentArg);
assert(
  parent !== source && !parent.startsWith(source + path.sep),
  "OUTPUT_INSIDE_FROZEN_SOURCE",
);
const read = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const freeze = await read(path.join(source, "machine-freeze.json"));
for (const [n, h] of Object.entries(freeze.files)) {
  assert(!path.isAbsolute(n) && !n.split(/[\\/]/u).includes(".."));
  await safePath(path.join(source, n));
  assert.equal(await fileHash(path.join(source, n)), h);
}
const plan = await read(path.join(source, "plan.json")),
  views = await read(path.join(source, "views.json")),
  audit = await read(auditFile);
const manifestPath = path.join(plan.task, "bounded-task.json"),
  manifest = await read(manifestPath);
assert.equal(await fileHash(manifestPath), audit.binding.manifestHash);
for (const [n, h] of Object.entries(audit.binding.inputFiles)) {
  assert(!path.isAbsolute(n) && !n.split(/[\\/]/u).includes(".."));
  assert.equal(manifest.files[n], h);
  await safePath(path.join(plan.task, n));
  assert.equal(await fileHash(path.join(plan.task, n)), h);
}
for (const k of ["source", "model", "runtime"])
  assert.equal(
    audit.binding[k + "Hash"],
    plan.identities[k === "source" ? "input" : k].sha256,
  );
for (const v of views) {
  const request = plan.requests.find((r) => r.id === v.id);
  assert(request);
  assert.equal(v.start, request.start);
  assert.equal(v.end, request.end);
  assert.equal(v.targetId, request.targetId);
  const raw = path.join(source, v.id, "response.srt");
  assert.equal(await fileHash(raw), v.rawHash);
  const mapped = formats.srt
    .parse(await fs.readFile(raw, "utf8"))
    .map((r) => ({ ...r, start: r.start + v.start, end: r.end + v.start }));
  assert.deepEqual(mapped, v.records, "RAW_VIEW_MAPPING_CHANGED");
}
const targets = plan.targets.map((t) =>
  reviewCandidateBoundaries(
    t,
    views.filter((v) => v.targetId === t.id),
  ),
);
const probes = plan.targets.map((t) => {
  const v = views.filter((v) => v.targetId === t.id);
  return {
    id: t.id,
    start: Math.min(...v.map((r) => r.start)),
    end: Math.max(...v.map((r) => r.end)),
    targetStart: t.start,
    targetEnd: t.end,
  };
});
const tokens = localizeStoredContext(audit, probes);
const result = {
  version: "saved-candidate-boundary-review-v1",
  targets,
  storedTokenContext: tokens,
  provenance: {
    sourceFreezeHash: await fileHash(path.join(source, "machine-freeze.json")),
    storedAuditHash: await fileHash(auditFile),
    sourceAudioHash: plan.sourceAudioHash,
  },
  referenceRead: false,
  humanLabelsRead: false,
  newInference: 0,
  modelLoads: 0,
  subtitleMutations: 0,
  automaticRepairs: 0,
  qualityStatus: "needs-review",
  finalizationMethod: "none",
};
assert.deepEqual(
  targets,
  plan.targets.map((t) =>
    reviewCandidateBoundaries(
      t,
      views.filter((v) => v.targetId === t.id),
    ),
  ),
);
await fs.mkdir(parent, { recursive: true });
const root = await fs.mkdtemp(path.join(parent, "boundary-"));
const put = (n, v) =>
  fs.writeFile(path.join(root, n), JSON.stringify(v, null, 2) + "\n", {
    flag: "wx",
  });
await put("boundary-review.json", result);
const esc = (s) =>
  String(s).replace(
    /[&<>"']/gu,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const stamp = (s) =>
  `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, "0")}`;
const sections = [];
for (const t of targets) {
  const audios = [];
  for (const v of views.filter((v) => v.targetId === t.target.id)) {
    const name = v.id + ".wav";
    await fs.copyFile(
      path.join(source, v.id, "input.wav"),
      path.join(root, name),
      fs.constants.COPYFILE_EXCL,
    );
    assert.equal(await fileHash(path.join(root, name)), v.audioHash);
    audios.push(
      `<h3>上下文 ±${v.context} 秒｜播放器 0 秒 = 源 ${stamp(v.start)}</h3><audio controls preload="metadata" src="${esc(name)}"></audio><table><tr><th>源时间</th><th>原始候选（未经确认）</th></tr>${v.records.map((r) => `<tr><td>${stamp(r.start)}–${stamp(r.end)}</td><td>${esc(r.text)}</td></tr>`).join("")}</table>`,
    );
  }
  sections.push(
    `<section><h2>${esc(t.target.id)}｜机器风险区间 ${stamp(t.target.start)}–${stamp(t.target.end)}</h2><p>风险区间不是已确认的整句起止。本页仅供核对，不会保存复核结果或修改字幕。</p><p>${esc(t.disposition)}</p>${audios.join("")}<details><summary>阻塞原因与对应关系</summary><pre>${esc(JSON.stringify(t.links, null, 2))}</pre></details></section>`,
  );
}
await fs.writeFile(
  path.join(root, "index.html"),
  `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>已保存候选边界核对</title><style>body{font:17px system-ui;max-width:1050px;margin:32px auto;padding:0 20px;color:#18212c;background:#fafafa}section{background:white;padding:24px;margin:24px 0;border:1px solid #ccd1d6;border-radius:10px}audio{width:100%}table{border-collapse:collapse;width:100%;margin:16px 0}td,th{text-align:left;padding:10px;border-bottom:1px solid #ddd}td:first-child{white-space:nowrap}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>已保存候选：发话与边界核对</h1><p>零新增识别；没有读取人工稿。两种窗口来自同一模型，文字相似不证明边界正确。当前自动写回：0。</p>${sections.join("")}</html>`,
  { flag: "wx" },
);
const files = {};
for (const n of await fs.readdir(root))
  files[n] = await fileHash(path.join(root, n));
await put("freeze.json", {
  files,
  source: result.provenance,
  software: Object.fromEntries(
    await Promise.all(
      [
        import.meta.filename,
        path.join(import.meta.dirname, "lib/candidate-boundary-review.mjs"),
        path.join(
          import.meta.dirname,
          "lib/full-context-token-localization.mjs",
        ),
        path.join(import.meta.dirname, "lib/local-acoustic-policy.mjs"),
      ].map(async (f) => [f, await fileHash(f)]),
    ),
  ),
});
console.log(
  JSON.stringify(
    {
      root,
      targets: targets.map((t, i) => ({
        id: t.target.id,
        disposition: t.disposition,
        links: t.links.length,
        originalTokenRows: tokens[i].context.length,
        tokenWarnings: tokens[i].context.map((r) => ({
          text: r.fullText,
          issues: r.blockingIssues,
        })),
      })),
      newInference: 0,
    },
    null,
    2,
  ),
);
