/** Explicit offline risk-isolation preview; never promoted as a full correction. */
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { formats } from "../packages/video-subtitler/dist/standalone/bounded.js";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { contentSafety } from "./lib/content-safety-gate.mjs";
import { readPcm, slicePcm } from "./lib/bounded-asr-ab.mjs";

export function isolatePreview(bytes, ext, excluded) {
  const parsed = formats[ext].parse(bytes);
  assert(
    excluded.every((i) => Number.isInteger(i) && i >= 0 && i < parsed.length),
    "INVALID_EXCLUSION",
  );
  const omit = new Set(excluded);
  assert(omit.size < parsed.length, "EMPTY_PARTIAL_PREVIEW");
  let ordinal = 0;
  let result;
  if (ext === "ass") {
    result = bytes
      .split("\n")
      .filter((line) => !/^Dialogue:/.test(line) || !omit.has(ordinal++))
      .join("\n");
  } else {
    result =
      bytes
        .trimEnd()
        .split(/\r?\n\s*\r?\n/u)
        .filter((block) => {
          if (!/ --> /u.test(block)) return true;
          return !omit.has(ordinal++);
        })
        .map((block, i) =>
          ext === "srt" ? block.replace(/^\d+\r?\n/u, `${i + 1}\n`) : block,
        )
        .join("\n\n") + "\n";
  }
  assert.equal(ordinal, parsed.length, "PREVIEW_PARSE_COUNT_MISMATCH");
  assert.deepEqual(
    formats[ext]
      .parse(result)
      .map(({ start, end, text }) => [start, end, text]),
    parsed
      .filter((_, i) => !omit.has(i))
      .map(({ start, end, text }) => [start, end, text]),
    "PREVIEW_CONTENT_CHANGED",
  );
  return result;
}

const escape = (s) =>
  String(s).replace(
    /[&<>"']/gu,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export async function prepareContentSafety({ stem, rawTask, outputRoot }) {
  const freeze = JSON.parse(
    await fs.readFile(path.join(path.dirname(stem), "freeze.json"), "utf8"),
  );
  const inputs = [],
    contents = {};
  for (const ext of ["ass", "srt", "vtt"]) {
    const file = `${stem}.${ext}`,
      sha256 = await fileHash(file);
    assert.equal(
      sha256,
      freeze.files[path.basename(file)],
      "BASELINE_FREEZE_MISMATCH",
    );
    inputs.push({ file, sha256 });
    contents[ext] = await fs.readFile(file, "utf8");
  }
  const records = formats.srt.parse(contents.srt);
  for (const ext of ["ass", "vtt"])
    assert.deepEqual(
      formats[ext]
        .parse(contents[ext])
        .map(({ start, end, text }) => [start, end, text]),
      records.map(({ start, end, text }) => [start, end, text]),
    );
  const safety = contentSafety(records);
  // No empty subtitle disguised as a successful delivery.
  assert(
    safety.reviewCueIndexes.length < records.length,
    "ALL_CUES_HELD_NO_PREVIEW",
  );
  const manifest = JSON.parse(
    await fs.readFile(path.join(rawTask, "bounded-task.json"), "utf8"),
  );
  async function verified(relative) {
    assert(
      !relative.includes("..") && !path.isAbsolute(relative),
      "INVALID_EVIDENCE_PATH",
    );
    const file = path.join(rawTask, relative),
      sha256 = await fileHash(file);
    assert.equal(sha256, manifest.files[relative], "RAW_EVIDENCE_CHANGED");
    inputs.push({ file, sha256 });
    return fs.readFile(file);
  }
  const plan = JSON.parse(await verified("bounded-plan.json"));
  const mapped = JSON.parse(await verified("mapped-records.json"));
  const pcm = readPcm(await verified("audio.wav"));
  assert.equal(pcm.sampleRate, 16000);
  assert.equal(plan.effectiveRange.start, 0, "SOURCE_OFFSET_NOT_SUPPORTED");
  const rawSafety = contentSafety(
    mapped.records.map((r) => ({
      id: r.recordId,
      requestId: r.requestId,
      start: r.sourceStart,
      end: r.sourceEnd,
      text: r.text ?? r.rawBlock,
    })),
  );
  const provenance = [];
  for (const requestId of new Set(
    rawSafety.issues.flatMap((issue) =>
      issue.cueIndexes.map((i) => mapped.records[i].requestId),
    ),
  )) {
    assert(/^[a-z0-9-]+$/u.test(requestId), "INVALID_REQUEST_ID");
    await verified(`requests/${requestId}/raw-response.srt`);
    const request = JSON.parse(
      await verified(`requests/${requestId}/request.json`),
    );
    provenance.push({ requestId, request });
  }
  // Merge review envelopes, never infer a speech or silence boundary.
  const regions = [];
  for (const issue of safety.issues
    .filter((i) => i.start !== null)
    .sort((a, b) => a.start - b.start)) {
    const last = regions.at(-1);
    if (last && issue.start <= last.end) {
      last.end = Math.max(last.end, issue.end);
      last.cueIndexes = [...new Set([...last.cueIndexes, ...issue.cueIndexes])];
      last.codes = [...new Set([...last.codes, issue.code])];
    } else
      regions.push({
        start: issue.start,
        end: issue.end,
        cueIndexes: [...issue.cueIndexes],
        codes: [issue.code],
      });
  }
  await fs.mkdir(outputRoot, { recursive: true });
  const root = await fs.mkdtemp(path.join(outputRoot, "content-safety-")),
    files = {};
  const put = async (name, value) => {
    await fs.writeFile(
      path.join(root, name),
      typeof value === "string" || value instanceof Uint8Array
        ? value
        : JSON.stringify(value, null, 2) + "\n",
      { flag: "wx" },
    );
    files[name] = await fileHash(path.join(root, name));
  };
  for (const ext of ["ass", "srt", "vtt"]) {
    await put(`full-preserved.needs-review.${ext}`, contents[ext]);
    await put(
      `risk-isolated.PARTIAL-PREVIEW.${ext}`,
      isolatePreview(contents[ext], ext, safety.reviewCueIndexes),
    );
  }
  for (const [i, r] of regions.entries()) {
    r.audioStart = Math.max(0, r.start - 1);
    r.audioEnd = Math.min(pcm.frames / pcm.sampleRate, r.end + 1);
    r.audio = `review-${i + 1}.wav`;
    await put(
      r.audio,
      slicePcm(
        pcm,
        Math.floor(r.audioStart * pcm.sampleRate),
        Math.ceil(r.audioEnd * pcm.sampleRate),
      ),
    );
  }
  const omissions = safety.reviewCueIndexes.map((i) => ({
    originalCue: i + 1,
    ...records[i],
    disposition: "quarantined-unverified-not-confirmed-absent",
    riskCodes: safety.issues
      .filter((x) => x.cueIndexes.includes(i))
      .map((x) => x.code),
  }));
  await put("content-safety.json", { safety, rawSafety, provenance });
  await put("review-regions.json", regions);
  await put("omissions.json", omissions);
  await put("result.json", {
    status: "HOLD",
    qualityStatus: "needs-review",
    finalizationMethod: "none",
    machineOnlyReleaseAuthorized: false,
    originalCueCount: records.length,
    previewCueCount: records.length - omissions.length,
    quarantinedCueCount: omissions.length,
    confirmedHallucinationsRemoved: 0,
    recoveredDialogueCount: 0,
    retainedTextMutations: 0,
    retainedTimingMutations: 0,
    omittedSpeechStatus: "NOT_VERIFIED; preview may omit real speech or songs",
    preferredOutputs: [],
    fullCopyPreserved: true,
    newInference: 0,
    humanBaselinePreserved: true,
    inputs,
  });
  await put(
    "index.html",
    `<!doctype html><html lang="zh"><meta charset="utf-8"><title>整片内容风险复核</title><style>body{max-width:960px;margin:32px auto;padding:20px;font:18px system-ui;line-height:1.7}article{border:1px solid #bbb;padding:20px;margin:20px 0}audio{width:100%}strong{color:#9c2700}</style><h1>整片内容风险：HOLD</h1><p><strong>隔离预览是部分稿，不是修复完成稿。</strong>只是暂时不显示可疑记录；可能连同真实语气词或歌曲一起缺失。没有确认这些区间无声，也没有自动替换原稿。</p><p>全部 ${records.length} 条原稿保留，隔离 ${omissions.length} 条，预览 ${records.length - omissions.length} 条。原有人工确认的时间不变。</p><p><a href="risk-isolated.PARTIAL-PREVIEW.ass">隔离预览 ASS</a> · <a href="full-preserved.needs-review.ass">完整原稿 ASS</a> · <a href="omissions.json">逐条隔离清单</a></p>${regions.map((r, i) => `<article><h2>区域 ${i + 1}：源时间 ${r.start.toFixed(2)}–${r.end.toFixed(2)} 秒</h2><p>原 cue：${r.cueIndexes.map((n) => n + 1).join(", ")}。播放器 0 秒 = 源 ${r.audioStart.toFixed(2)} 秒；带前后上下文。</p><audio controls preload="metadata" src="${r.audio}"></audio><p>${escape(r.codes.join(", "))}</p><p>${r.cueIndexes.map((n) => escape(records[n].text)).join(" / ")}</p><p>待判别：真实短回应／歌曲／音效或音乐／有对白但文字错误／仍不确定。模型概率和参考空白均不等于声学确认。</p></article>`).join("")}</html>`,
  );
  await put(
    "README.md",
    "# 内容风险隔离预览（HOLD）\n\n这不是完整修复稿。原始稿逐字节保留；隔离预览可能漏掉真实语音或歌曲，不可作为独立机器质量通过。参见 index.html 的源时间、原音频和 omissions.json。\n\n没有重跑 ASR/VAD、没有确认或删除原稿内容，没有修改任何保留句的文字、时间。新检测器默认阻止高风险稿成为 preferred output，不代表风险均已识别。\n",
  );
  for (const input of inputs)
    assert.equal(
      await fileHash(input.file),
      input.sha256,
      "INPUT_CHANGED_DURING_PREVIEW",
    );
  await fs.writeFile(
    path.join(root, "freeze.json"),
    JSON.stringify(
      {
        inputs,
        files,
        software: await fileHash(import.meta.filename),
        detector: await fileHash(
          path.join(import.meta.dirname, "lib/content-safety-gate.mjs"),
        ),
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  return {
    root,
    originalCueCount: records.length,
    previewCueCount: records.length - omissions.length,
    quarantinedCueCount: omissions.length,
    status: "HOLD",
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [stem, rawTask, outputRoot] = process.argv.slice(2);
  assert(
    stem && rawTask && outputRoot,
    "usage: node scripts/subtitle-tool-content-safety.mjs <frozen-subtitle-stem> <raw-bounded-task> <new-output-root>",
  );
  console.log(
    JSON.stringify(
      await prepareContentSafety({ stem, rawTask, outputRoot }),
      null,
      2,
    ),
  );
}
