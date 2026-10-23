/** Source-bound, zero-model diagnostics. No reference input or subtitle writeback. */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { parseSrt } from "../../packages/subtitle-core/dist/parse.js";
import { safePath } from "../../packages/video-subtitler/dist/standalone/recovery.js";
import { readPcm, slicePcm } from "./bounded-asr-ab.mjs";
import {
  scanAudioActivity,
  planAudioCoverage,
} from "./audio-coverage-observation.mjs";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (v) => JSON.stringify(v, null, 2) + "\n";

export async function loadAudioCoverageInputs(task, subtitlePath) {
  await safePath(task);
  const inputs = [];
  const read = async (file) => {
    await safePath(file);
    const bytes = await fs.readFile(file);
    inputs.push({ file: path.resolve(file), sha256: hash(bytes) });
    return bytes;
  };
  const checkpoint = JSON.parse(
    await read(path.join(task, "bounded-task.json")),
  );
  const planBytes = await read(path.join(task, "bounded-plan.json"));
  assert.equal(
    hash(planBytes),
    checkpoint.files["bounded-plan.json"],
    "PLAN_HASH",
  );
  const plan = JSON.parse(planBytes);
  assert(plan.config.language === "ja", "JAPANESE_TASK_REQUIRED");
  const audioStat = await fs.stat(path.join(task, "audio.wav"));
  assert(audioStat.size <= 1800 * 16000 * 2 + 1048576, "AUDIO_READ_BUDGET");
  const audioBytes = await read(path.join(task, "audio.wav"));
  assert.equal(hash(audioBytes), checkpoint.files["audio.wav"], "AUDIO_HASH");
  assert.equal(hash(audioBytes), plan.audioHash, "PLAN_AUDIO_HASH");
  const pcm = readPcm(audioBytes);
  assert.equal(pcm.sampleRate, plan.sampleRate, "SAMPLE_RATE");
  assert.equal(pcm.frames, plan.fullFrames, "FULL_FRAMES");
  assert.equal(hash(pcm.data), plan.pcmHash, "PCM_HASH");
  assert(
    Math.abs(
      plan.effectiveRange.start -
        (plan.audioOffset + plan.firstFrame / pcm.sampleRate),
    ) < 1e-8,
    "RANGE_START_MAPPING",
  );
  assert(
    Math.abs(
      plan.effectiveRange.end -
        (plan.audioOffset + (plan.firstFrame + plan.frames) / pcm.sampleRate),
    ) < 1e-8,
    "RANGE_END_MAPPING",
  );
  assert(
    subtitlePath && path.extname(subtitlePath) === ".srt",
    "PREFERRED_SRT_REQUIRED",
  );
  const subtitleBytes = await read(subtitlePath);
  const relative = path.relative(task, subtitlePath);
  if (checkpoint.files[relative]) {
    assert.equal(
      hash(subtitleBytes),
      checkpoint.files[relative],
      "SUBTITLE_HASH",
    );
  } else {
    // A seam candidate must be bound to this exact baseline audio and plan,
    // not merely a same-duration SRT from another video.
    const freeze = JSON.parse(
      await read(path.join(path.dirname(subtitlePath), "machine-freeze.json")),
    );
    assert.equal(
      freeze.version,
      "seam-text-only-two-view-v1",
      "CANDIDATE_BINDING_KIND",
    );
    assert.equal(
      freeze.files[path.basename(subtitlePath)],
      hash(subtitleBytes),
      "CANDIDATE_SRT_HASH",
    );
    const parentFreezeBytes = await read(
      path.join(freeze.input, "machine-freeze.json"),
    );
    assert.equal(
      hash(parentFreezeBytes),
      freeze.inputFreezeHash,
      "PARENT_FREEZE_HASH",
    );
    const parentFreeze = JSON.parse(parentFreezeBytes);
    const parentPlanBytes = await read(path.join(freeze.input, "plan.json"));
    assert.equal(
      hash(parentPlanBytes),
      parentFreeze.files["plan.json"],
      "PARENT_PLAN_HASH",
    );
    const parentPlan = JSON.parse(parentPlanBytes);
    assert.equal(
      parentPlan.baselineFiles["bounded-plan.json"],
      hash(planBytes),
      "WRONG_SOURCE_PLAN",
    );
    assert.equal(
      parentPlan.baselineFiles["audio.wav"],
      hash(audioBytes),
      "WRONG_SOURCE_AUDIO",
    );
  }
  const records = parseSrt(subtitleBytes.toString("utf8")).map((r, i) => ({
    id: `preferred-${i + 1}`,
    start: r.start,
    end: r.end,
    text: r.text,
  }));
  return { inputs, plan, pcm, records };
}

export async function verifyCoverageInputs(inputs) {
  for (const i of inputs) {
    await safePath(i.file);
    assert.equal(
      hash(await fs.readFile(i.file)),
      i.sha256,
      `INPUT_CHANGED:${path.basename(i.file)}`,
    );
  }
}

export async function deliverAudioCoverage({
  task,
  subtitlePath,
  outputRoot,
  signal,
}) {
  signal?.throwIfAborted();
  const loaded = await loadAudioCoverageInputs(task, subtitlePath);
  signal?.throwIfAborted();
  const { inputs, plan, pcm, records } = loaded;
  const activity = scanAudioActivity(pcm, plan);
  const coverage = planAudioCoverage(records, activity);
  signal?.throwIfAborted();
  await verifyCoverageInputs(inputs);
  const files = {};
  const put = async (name, bytes) => {
    signal?.throwIfAborted();
    await fs.writeFile(path.join(outputRoot, name), bytes, { flag: "wx" });
    files[name] = hash(bytes);
  };
  if (coverage.previews.length)
    await fs.mkdir(path.join(outputRoot, "audio-coverage-review"));
  for (const preview of coverage.previews) {
    const first = Math.round(
      (preview.start - plan.audioOffset) * pcm.sampleRate,
    );
    const end = Math.round((preview.end - plan.audioOffset) * pcm.sampleRate);
    assert(
      first >= plan.firstFrame && end <= plan.firstFrame + plan.frames,
      "PREVIEW_OUTSIDE_SCAN_RANGE",
    );
    preview.firstFrame = first;
    preview.endFrame = end;
    preview.sourceStart = plan.audioOffset + first / pcm.sampleRate;
    preview.sourceEnd = plan.audioOffset + end / pcm.sampleRate;
    preview.audioFile = `audio-coverage-review/${preview.id}.wav`;
    await put(preview.audioFile, slicePcm(pcm, first, end));
    preview.audioHash = files[preview.audioFile];
  }
  const audit = {
    version: "audio-coverage-delivery-v1",
    task: path.resolve(task),
    subtitlePath: path.resolve(subtitlePath),
    inputs,
    activity,
    coverage,
    subtitleTextHash: hash(json(records.map((r) => [r.id, r.text]))),
    subtitleTimingHash: hash(json(records.map((r) => [r.id, r.start, r.end]))),
    newInference: 0,
    referenceUsed: false,
    subtitleTextMutations: 0,
    subtitleTimingMutations: 0,
    qualityStatus: "needs-review",
    finalizationMethod: "none",
    humanValidated: false,
  };
  await put("AUDIO_COVERAGE_OBSERVATION.json", json(audit));
  const lines = [
    "# 字幕覆盖与音频活动观察",
    "",
    "只读现有机器稿和源音频。能量活动可能是语音、音乐、噪音或音效；以下不是已确认漏句，也不提供可写回的词语时间。低能量不代表无语音。",
    "",
    `总候选 ${coverage.summary.candidateCount}：无 cue 活动 ${coverage.summary.uncoveredActivityCount}；长 cue 内短活动 ${coverage.summary.embeddedActivityCount}。`,
    `首批试听 ${coverage.summary.previewCount} 段，共 ${coverage.summary.requestedListeningSeconds.toFixed(2)} 秒；未覆盖候选 ${coverage.deferred.length}，明确保留，不代表已检查。`,
    "",
    "原有短句观察清单仍保留。本清单不按人工答案选择，也不自动识别或替换。",
    "",
    "## 结构证据排序试听（排序有效性未验证）",
    "",
  ];
  for (const p of coverage.previews) {
    const unit = coverage.candidates.find((c) => c.id === p.unitId);
    lines.push(
      `- [${p.id}：${p.sourceStart.toFixed(2)}–${p.sourceEnd.toFixed(2)} 秒](<${p.audioFile}>) — ${p.kind}；目标活动 ${unit.start.toFixed(2)}–${unit.end.toFixed(2)} 秒。`,
    );
    lines.push(
      `  现有字幕：${unit.neighboringCues.map((c) => c.text.replace(/\r?\n/gu, " ")).join(" / ") || "无重叠字幕"}`,
    );
    lines.push(
      `  排序依据：tier ${unit.priority.tier}；${unit.priority.relation}；父活动 ${unit.priority.parentActivitySeconds.toFixed(2)} 秒；声音类别未确认，不代表漏句。`,
    );
  }
  lines.push(
    "",
    "[完整机器证据和延后候选](AUDIO_COVERAGE_OBSERVATION.json)。0 新推理，0 字幕文字/时间改写，needs-review。",
    "",
  );
  await put("AUDIO_COVERAGE_OBSERVATION.md", lines.join("\n"));
  await verifyCoverageInputs(inputs);
  const softwareFiles = [
    "./audio-coverage-observation.mjs",
    "./audio-coverage-delivery.mjs",
    "./bounded-asr-ab.mjs",
    "../../packages/subtitle-core/dist/parse.js",
  ];
  const software = await Promise.all(
    softwareFiles.map(async (name) => {
      const file = new URL(name, import.meta.url);
      return { file: file.href, sha256: hash(await fs.readFile(file)) };
    }),
  );
  await put(
    "audio-coverage-freeze.json",
    json({
      version: "audio-coverage-freeze-v1",
      files: { ...files },
      software,
      referenceUsed: false,
      newInference: 0,
    }),
  );
  signal?.throwIfAborted();
  return {
    status: "observed",
    mode: "observe-only",
    artifact: path.join(outputRoot, "AUDIO_COVERAGE_OBSERVATION.json"),
    index: path.join(outputRoot, "AUDIO_COVERAGE_OBSERVATION.md"),
    ...coverage.summary,
    newInference: 0,
    subtitleMutationAuthorized: false,
  };
}

export async function verifyAudioCoverage(root) {
  await safePath(root);
  const freeze = JSON.parse(
    await fs.readFile(path.join(root, "audio-coverage-freeze.json"), "utf8"),
  );
  assert.equal(freeze.version, "audio-coverage-freeze-v1");
  for (const required of [
    "AUDIO_COVERAGE_OBSERVATION.json",
    "AUDIO_COVERAGE_OBSERVATION.md",
  ])
    assert(freeze.files[required], "INCOMPLETE_FREEZE");
  for (const [name, digest] of Object.entries(freeze.files)) {
    assert(
      !path.isAbsolute(name) && !name.split(/[\\/]/u).includes(".."),
      "UNSAFE_FREEZE_PATH",
    );
    const file = path.join(root, name);
    await safePath(file);
    assert.equal(
      hash(await fs.readFile(file)),
      digest,
      `OUTPUT_CHANGED:${name}`,
    );
  }
  for (const f of freeze.software)
    assert.equal(
      hash(await fs.readFile(new URL(f.file))),
      f.sha256,
      "SOFTWARE_CHANGED",
    );
  const audit = JSON.parse(
    await fs.readFile(
      path.join(root, "AUDIO_COVERAGE_OBSERVATION.json"),
      "utf8",
    ),
  );
  await verifyCoverageInputs(audit.inputs);
  return audit;
}
