/** Zero-inference replay of existing MFA, CTC and VAD. No subtitle writeback. */
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { safePath } from "../packages/video-subtitler/dist/standalone/recovery.js";
import { readPcm } from "./lib/bounded-asr-ab.mjs";
import { summarizeContextWords } from "./lib/context-word-alignment.mjs";
import { verifyContextCtc } from "./subtitle-tool-context-ctc.mjs";
import { verifyRefresh } from "./subtitle-tool-vad-context-refresh.mjs";
import { reconcileContextOccurrences } from "./lib/context-occurrence-reconciliation.mjs";

const json = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const read = async (root, name) => {
  const p = path.join(root, name);
  await safePath(p);
  return json(p);
};
const put = (root, name, v) =>
  fs.writeFile(
    path.join(root, name),
    typeof v === "string" ? v : JSON.stringify(v, null, 2) + "\n",
    { flag: "wx" },
  );
async function verifyFiles(root, files) {
  for (const [n, h] of Object.entries(files)) {
    assert(
      !path.isAbsolute(n) && !n.split(/[\\/]/u).includes(".."),
      "UNSAFE_FILE_NAME",
    );
    await safePath(path.join(root, n));
    assert.equal(await fileHash(path.join(root, n)), h, `CHANGED:${n}`);
  }
}
async function loadSources(roots) {
  assert.deepEqual(Object.keys(roots).sort(), ["ctc", "vad", "words"]);
  for (const r of Object.values(roots)) await safePath(r);
  const p = await read(roots.words, "plan.json"),
    a = await read(roots.words, "result.json");
  await verifyFiles(
    roots.words,
    (await read(roots.words, "machine-freeze.json")).files,
  );
  await verifyFiles(
    roots.words,
    (await read(roots.words, "plan-freeze.json")).files,
  );
  for (const [f, h] of Object.entries(p.bindings)) {
    // Existing pinned runtime executables may be symlinks; read their resolved
    // bytes against the old binding, never execute them during this replay.
    await safePath(await fs.realpath(f));
    assert.equal(await fileHash(f), h, "MFA_INPUT_CHANGED");
  }
  assert.equal(p.referenceUsed, false);
  const raws = await Promise.all(
    p.requests.map((r) => read(roots.words, r.id + "/raw.json")),
  );
  assert.deepEqual(
    a,
    summarizeContextWords(p.requests, raws, p.core),
    "MFA_REPLAY_MISMATCH",
  );
  await verifyContextCtc(roots.ctc);
  await verifyRefresh(roots.vad);
  const cp = await read(roots.ctc, "plan.json"),
    cr = await read(roots.ctc, "result.json"),
    vp = await read(roots.vad, "plan.json"),
    vr = await read(roots.vad, "boundary-review.json");
  const probe = await read(p.source, "plan.json");
  await verifyFiles(
    p.source,
    (await read(p.source, "machine-freeze.json")).files,
  );
  assert.equal(probe.referenceInput, null, "REFERENCE_INPUT_FORBIDDEN");
  const audio = path.join(probe.task, "audio.wav");
  await safePath(audio);
  assert.equal(
    await fileHash(audio),
    probe.sourceAudioHash,
    "SOURCE_AUDIO_CHANGED",
  );
  const pcm = readPcm(await fs.readFile(audio));
  assert.equal(pcm.sampleRate, 16000);
  const pcmChecks = [];
  async function checkPcm(file, r, hash) {
    await safePath(file);
    assert.equal(await fileHash(file), hash, "CLIP_HASH_MISMATCH");
    const clip = readPcm(await fs.readFile(file)),
      start = Math.round(r.start * 16000);
    assert.equal(clip.sampleRate, 16000);
    assert.equal(clip.frames, r.frames);
    assert(
      Math.abs(r.end - r.start - r.frames / 16000) < 1e-6,
      "CLIP_COORDINATE_MISMATCH",
    );
    assert(
      clip.data.equals(pcm.data.subarray(start * 2, (start + r.frames) * 2)),
      "SOURCE_PCM_MISMATCH",
    );
    pcmChecks.push({
      file,
      start: r.start,
      end: r.end,
      frames: r.frames,
      sha256: hash,
      sourcePcmExact: true,
    });
  }
  for (const r of p.requests)
    await checkPcm(path.join(roots.words, r.id, "input.wav"), r, r.audioHash);
  const candidates = cp.requests.filter(
    (r) =>
      r.start === vr.input.sourceWindow.start &&
      r.end === vr.input.sourceWindow.end,
  );
  assert(candidates.length > 0, "CTC_WINDOW_NOT_BOUND");
  for (const r of candidates)
    await checkPcm(path.join(roots.ctc, r.id, "input.wav"), r, r.wavHash);
  assert.equal(vp.items.length, 1);
  await checkPcm(vp.items[0].audioPath, vp.items[0], vp.items[0].audioHash);
  const anchors = cr.rows
    .filter((row) => candidates.some((c) => c.id === row.id))
    .flatMap((row) =>
      row.segments
        .filter((s) => s.text === vr.input.donor.text)
        .map((s) => ({ row, s })),
    );
  assert.equal(anchors.length, 1, "AMBIGUOUS_CTC_DONOR");
  assert.deepEqual(
    anchors[0].s.conditionalCtcInterval,
    vr.input.anchor,
    "CTC_ANCHOR_BINDING",
  );
  assert.equal(anchors[0].row.greedyText, vr.input.greedyText);
  const baseline = await read(p.source, "baseline-records.json");
  const input = {
    requests: p.requests,
    alignment: a,
    sourceAudioHash: probe.sourceAudioHash,
    anchoredInput: {
      ...vr.input,
      baseline: baseline.map((r) => ({
        id: `machine-${r.sourceId}`,
        start: r.start,
        end: r.end,
        text: r.text,
      })),
    },
  };
  const result = reconcileContextOccurrences(input);
  const playback = [...p.requests].sort(
    (x, y) => y.end - y.start - (x.end - x.start),
  )[0];
  return {
    input,
    result,
    pcmChecks,
    playback,
    sourceAudioHash: probe.sourceAudioHash,
  };
}
const escape = (s) =>
  String(s).replace(
    /[&<>"']/gu,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function renderOccurrencePage(result, playback) {
  const seconds = (t) => t.toFixed(3),
    clock = (t) =>
      `${Math.floor(t / 60)}:${(t % 60).toFixed(3).padStart(6, "0")}`;
  const buttons = result.prefixes.map((p) => ({
    label: `句首 ${p.text}`,
    start: p.conditionalMfaInterval.start,
    description: `MFA 条件性位置 ${seconds(p.conditionalMfaInterval.start)}–${seconds(p.conditionalMfaInterval.end)} 秒；独立 CTC/VAD 窗口未必覆盖。`,
  }));
  buttons.push({
    label: `句后 ${result.anchoredResponse.text}`,
    start: result.anchoredResponse.emissionAnchor.start,
    description: `CTC 发射 ${seconds(result.anchoredResponse.emissionAnchor.start)}–${seconds(result.anchoredResponse.emissionAnchor.end)} 秒，不是发话时长。`,
  });
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>短应答：源时间核对</title><style>body{font:18px system-ui;max-width:960px;margin:32px auto;padding:16px;line-height:1.6}audio{width:100%}button{font:inherit;padding:10px;margin:8px}section{border:1px solid #bbb;padding:16px;margin:20px 0}td,th{padding:8px;text-align:left;border-bottom:1px solid #ccc}table{width:100%}</style><h1>句首语气词与句后短答</h1><p>只读机器证据核对页，不是已修好的字幕，也不记录人工确认。所有时间均为原视频源时间。</p><p>完整上下文：${clock(playback.start)}–${clock(playback.end)}；音频第 0 秒 = 源时间 ${seconds(playback.start)} 秒。</p><audio id="audio" controls preload="metadata" src="context.wav"></audio><p id="time">源时间：${seconds(playback.start)} 秒</p><button data-seek="0">从完整上下文开始播放</button>${buttons.map((b) => `<section><h2>${escape(b.label)} · ${clock(b.start)}</h2><p>${escape(b.description)}</p><button data-seek="${Math.max(0, b.start - playback.start - 0.6)}">从标记前 0.6 秒播放后续上下文</button></section>`).join("")}<h2>后续候选，不自动选胜者</h2><table><tr><th>原机器文字</th><th>ASR 区间（秒）</th><th>MFA 条件区间（秒）</th></tr>${result.followingCandidates.map((c) => `<tr><td>${escape(c.text)}</td><td>${seconds(c.originalAsrInterval.start)}–${seconds(c.originalAsrInterval.end)}</td><td>${seconds(c.conditionalMfaInterval.start)}–${seconds(c.conditionalMfaInterval.end)}</td></tr>`).join("")}</table><p>「あ」与「ああ」原样保留；25 ms 发射、200 ms 语音活动和字幕显示时长不能互换。未使用人工稿作为判断输入；字幕修改 0。</p><p><a href="reconciliation.json">机器核对结果 JSON</a></p><script>const a=document.querySelector('#audio');a.addEventListener('timeupdate',()=>document.querySelector('#time').textContent='源时间：'+(${playback.start}+a.currentTime).toFixed(3)+' 秒');for(const b of document.querySelectorAll('[data-seek]')) b.addEventListener('click',()=>{a.currentTime=Number(b.dataset.seek);a.play().catch(()=>{document.querySelector('#time').textContent='请点击音频播放按钮';});});</script></html>`;
}
const names = [
  "reconciliation.json",
  "provenance.json",
  "index.html",
  "context.wav",
];
export async function createOccurrenceReplay(roots, output) {
  const data = await loadSources(roots);
  output = path.resolve(output);
  await safePath(output, true);
  assert(
    Object.values(roots).every(
      (r) => output !== r && !output.startsWith(r + path.sep),
    ),
    "OUTPUT_INSIDE_SOURCE",
  );
  await fs.mkdir(output, { recursive: true });
  const root = await fs.mkdtemp(path.join(output, "occurrences-"));
  const bindingNames = [
    import.meta.filename,
    path.join(import.meta.dirname, "lib/context-occurrence-reconciliation.mjs"),
    path.join(import.meta.dirname, "lib/context-word-alignment.mjs"),
    path.join(import.meta.dirname, "lib/anchored-activity-review.mjs"),
    path.join(import.meta.dirname, "lib/short-response-display.mjs"),
  ];
  const bindings = await Promise.all(
    bindingNames.map(async (file) => ({ file, sha256: await fileHash(file) })),
  );
  await put(root, "reconciliation.json", data.result);
  await put(root, "provenance.json", {
    roots,
    bindings,
    pcmChecks: data.pcmChecks,
    playback: data.playback,
    newInference: 0,
    modelLoads: 0,
    referenceUsed: false,
    baselineSource: "independent-machine-probe",
    sourceAudioHash: data.sourceAudioHash,
  });
  await fs.copyFile(
    path.join(roots.words, data.playback.id, "input.wav"),
    path.join(root, "context.wav"),
    fs.constants.COPYFILE_EXCL,
  );
  await put(
    root,
    "index.html",
    renderOccurrencePage(data.result, data.playback),
  );
  const files = {};
  for (const n of names) files[n] = await fileHash(path.join(root, n));
  await put(root, "freeze.json", { files });
  return { root, ...(await verifyOccurrenceReplay(root)) };
}
export async function verifyOccurrenceReplay(root) {
  await safePath(root);
  const f = await read(root, "freeze.json");
  assert.deepEqual(Object.keys(f.files).sort(), [...names].sort());
  await verifyFiles(root, f.files);
  const p = await read(root, "provenance.json");
  for (const b of p.bindings)
    assert.equal(await fileHash(b.file), b.sha256, "CODE_CHANGED");
  const data = await loadSources(p.roots);
  assert.deepEqual(await read(root, "reconciliation.json"), data.result);
  assert.deepEqual(p.pcmChecks, data.pcmChecks);
  assert.deepEqual(p.playback, data.playback);
  assert.equal(
    await fileHash(path.join(root, "context.wav")),
    data.playback.audioHash,
  );
  assert.equal(
    await fs.readFile(path.join(root, "index.html"), "utf8"),
    renderOccurrencePage(data.result, data.playback),
  );
  return {
    integrity: "passed",
    newInference: 0,
    modelLoads: 0,
    subtitleMutations: 0,
    prefixes: data.result.prefixes.length,
    followingCandidates: data.result.followingCandidates.length,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [cmd, a, b, c, d] = process.argv.slice(2);
  assert(
    cmd === "create" || cmd === "verify",
    "create WORDS CTC VAD OUTPUT | verify ROOT",
  );
  console.log(
    JSON.stringify(
      cmd === "create"
        ? await createOccurrenceReplay(
            {
              words: path.resolve(a),
              ctc: path.resolve(b),
              vad: path.resolve(c),
            },
            d,
          )
        : await verifyOccurrenceReplay(path.resolve(a)),
      null,
      2,
    ),
  );
}
