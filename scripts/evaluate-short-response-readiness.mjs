/** Read frozen artifacts only. No recognizer/runtime/process or subtitle writer. */
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { parseSrt } from "../packages/subtitle-core/dist/parse.js";
import {
  assessShortResponseReadiness,
  lexicalLabelGaps,
} from "./lib/short-response-readiness.mjs";

const json = async (file) => JSON.parse(await fs.readFile(file, "utf8"));
const hash = async (file) =>
  createHash("sha256")
    .update(await fs.readFile(file))
    .digest("hex");
const put = (file, value) =>
  fs.writeFile(file, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
async function boundFile(root, name) {
  assert(
    typeof name === "string" &&
      name &&
      !path.isAbsolute(name) &&
      !name.split(/[\\/]/u).some((p) => ["..", ".", ""].includes(p)),
    "UNSAFE_ENTRY",
  );
  const file = path.join(root, name);
  assert.equal(await fs.realpath(file), file, "SYMLINK_ENTRY");
  assert((await fs.stat(file)).isFile(), "REGULAR_FILE_REQUIRED");
  return file;
}
export async function checkFrozen(root, name) {
  root = await fs.realpath(root);
  const freeze = await json(await boundFile(root, name));
  assert(freeze.files && Object.keys(freeze.files).length > 0, "EMPTY_FREEZE");
  for (const [entry, digest] of Object.entries(freeze.files)) {
    assert(/^[a-f0-9]{64}$/.test(digest), "INVALID_HASH");
    assert.equal(
      await hash(await boundFile(root, entry)),
      digest,
      `CHANGED:${entry}`,
    );
  }
  return { root, freeze, count: Object.keys(freeze.files).length };
}

async function loadSources(benchmark, recovery, typeNotes) {
  const b = await checkFrozen(benchmark, "evaluation-freeze.json");
  const r = await checkFrozen(recovery, "machine-freeze.json");
  const snapshot = await json(path.join(b.root, "evaluation-inputs.json"));
  const provenance = await json(path.join(b.root, "provenance.json"));
  const recFreeze = path.join(r.root, "machine-freeze.json");
  assert.equal(
    provenance.inputs.find((x) => path.resolve(x.file) === recFreeze)?.sha256,
    await hash(recFreeze),
    "RECOVERY_NOT_BOUND_TO_BENCHMARK",
  );
  const plan = await json(path.join(r.root, "plan.json"));
  assert.deepEqual(plan.baseline, snapshot.baseline, "BASELINE_MISMATCH");
  assert.deepEqual(
    plan.vadObservations,
    snapshot.observations,
    "OBSERVATION_MISMATCH",
  );
  assert.deepEqual(
    await json(path.join(r.root, "decisions.json")),
    snapshot.decisions,
    "DECISION_MISMATCH",
  );
  const views = await json(path.join(r.root, "views.json"));
  const replayed = [];
  assert.equal((await json(path.join(r.root, "kotoba-exit.json"))).code, 0);
  for (const p of plan.selected.probes) {
    assert(/^[a-zA-Z0-9_-]+$/.test(p.id), "UNSAFE_PROBE_ID");
    const directory = path.join(r.root, p.id);
    assert.equal(
      (await json(path.join(directory, "whisper-exit.json"))).code,
      0,
    );
    for (const backend of ["whisper", "kotoba"]) {
      const records =
        backend === "whisper"
          ? parseSrt(
              await fs.readFile(path.join(directory, "whisper.srt"), "utf8"),
            )
          : (await json(path.join(directory, "kotoba-raw.json"))).segments;
      replayed.push({
        targetId: p.id,
        backend,
        records: records.map((c) => ({
          start: p.start + c.start,
          end: p.start + c.end,
          text: c.text.trim(),
        })),
      });
    }
  }
  assert.deepEqual(replayed, views, "RAW_REPLAY_MISMATCH");
  assert.equal(snapshot.manifest.items.length, 16, "FIXED_COHORT_CHANGED");
  for (const item of snapshot.manifest.items) {
    assert.equal(
      b.freeze.files[`audio/${item.id}.wav`],
      item.audioHash,
      "COHORT_AUDIO_NOT_BOUND",
    );
  }
  return {
    snapshot,
    recovery: { probes: plan.selected.probes, views },
    typeAnnotations: await json(typeNotes),
    integrity: {
      benchmarkFiles: b.count,
      recoveryFiles: r.count,
      rawViewsReplayed: replayed.length,
    },
  };
}

function guide(result) {
  const r = (v) => v.toFixed(2);
  return [
    "# 短回应多样本评价：仅补缺失的目标文字",
    "",
    "这是已有开发样本，不是盲测。页面不展示机器候选词，避免用它作为答案。源视频时间是定位用坐标，不是已确认的完整发声区间。",
    "",
    "16段原目标保持不变；8段已有非语音标签无需重标。clip-11 的「ああ」和68.00–69.58秒已确认，不重复要求确认。clip-5 已确认是语气词，只缺具体声音写法/可否辨认。",
    "",
    "对下面7段，说明目标部分说了什么；如果只是上一句末尾，请保留续句关系，不另造独立短回应。听不清可写不确定，片段截断可写上下文不足。只有能听到完整发话时才填写全句起止，不能把播放器起止或目标区间直接当作发声边界。",
    "",
    "可按 clip 编号直接在对话中回复。lexical-label-gaps.json 是评价记录模板，不是机器答案，也不进入生成提示词。",
    "",
    ...result.rows
      .filter((x) => x.speechTruth === true && !x.wholeReference)
      .flatMap((x) => [
        `## ${x.id} — 源时间 ${r(x.target.start)}–${r(x.target.end)} 秒`,
        "",
        `播放上下文 ${r(x.playback.start)}–${r(x.playback.end)} 秒；目标在片段内 ${r(x.target.start - x.playback.start)}–${r(x.target.end - x.playback.start)} 秒。`,
        "",
        `已听审关系：${x.relationLabel === "continuation" ? "同句延续" : "独立发话"}。${x.interjectionTypeTruth === "interjection" ? "已确认类型：语气词，不要求重新确认类型。" : "尚未标注具体语音类型。"}`,
        "",
        `[播放原有片段](audio/${x.id}.wav)`,
        "",
      ]),
    "## 评价边界",
    "",
    "clip-6 的标签只属于726.98–727.24秒；后方727.78秒的「ああ」不是同一个目标，不能继承该标签。724.10–724.38秒的句首「あ」也不属于这16段，未擅自加进分母。",
    "",
    "本地资料含用户音频，不是公开分享包；字幕、源媒体及历史产物均未修改。",
    "",
  ].join("\n");
}

function csv(result) {
  return (
    [
      [
        "clip",
        "target_start",
        "target_end",
        "sound",
        "relation",
        "triage",
        "type_truth",
        "whole_text_label",
        "whisper",
        "kotoba",
        "gap",
      ],
      ...result.rows.map((r) => [
        r.id,
        r.target.start,
        r.target.end,
        r.soundLabel,
        r.relationLabel,
        r.triage,
        r.interjectionTypeTruth ?? "unscored",
        r.wholeReference ? "confirmed" : "missing",
        ...r.backends.map((b) => b.status),
        r.nextEvidence,
      ]),
    ]
      .map((row) =>
        row.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(","),
      )
      .join("\n") + "\n"
  );
}

export async function deliverReadiness(benchmark, recovery, typeNotes, output) {
  const sources = [await fs.realpath(benchmark), await fs.realpath(recovery)];
  typeNotes = await fs.realpath(typeNotes);
  output = path.resolve(output);
  await fs.mkdir(output, { recursive: true });
  output = await fs.realpath(output);
  assert(
    sources.every((s) => output !== s && !output.startsWith(s + path.sep)),
    "OUTPUT_INSIDE_INPUT",
  );
  const bindings = await Promise.all(
    [
      path.join(sources[0], "evaluation-freeze.json"),
      path.join(sources[1], "machine-freeze.json"),
      typeNotes,
      import.meta.filename,
      path.join(import.meta.dirname, "lib/short-response-readiness.mjs"),
      path.resolve(
        import.meta.dirname,
        "../packages/subtitle-core/dist/parse.js",
      ),
    ].map(async (file) => ({ file, sha256: await hash(file) })),
  );
  const data = await loadSources(...sources, typeNotes);
  const result = assessShortResponseReadiness(
    data.snapshot,
    data.recovery,
    data.typeAnnotations,
  );
  const root = await fs.mkdtemp(path.join(output, "readiness-"));
  await fs.mkdir(path.join(root, "audio"));
  for (const item of data.snapshot.manifest.items)
    await fs.copyFile(
      path.join(sources[0], `audio/${item.id}.wav`),
      path.join(root, `audio/${item.id}.wav`),
    );
  await put(path.join(root, "evaluation-inputs.json"), data);
  await put(path.join(root, "readiness.json"), result);
  await put(
    path.join(root, "lexical-label-gaps.json"),
    lexicalLabelGaps(result),
  );
  await fs.writeFile(path.join(root, "LISTENING_GUIDE.md"), guide(result), {
    flag: "wx",
  });
  await fs.writeFile(path.join(root, "cases.csv"), csv(result), { flag: "wx" });
  await put(path.join(root, "provenance.json"), {
    sources,
    typeNotes,
    bindings,
    ...data.integrity,
    newInference: 0,
  });
  await loadSources(...sources, typeNotes);
  for (const b of bindings)
    assert.equal(
      await hash(b.file),
      b.sha256,
      "INPUT_CHANGED_DURING_EVALUATION",
    );
  const files = {};
  for (const n of [
    "evaluation-inputs.json",
    "readiness.json",
    "lexical-label-gaps.json",
    "LISTENING_GUIDE.md",
    "cases.csv",
    "provenance.json",
    ...data.snapshot.manifest.items.map((i) => `audio/${i.id}.wav`),
  ])
    files[n] = await hash(path.join(root, n));
  await put(path.join(root, "evaluation-freeze.json"), {
    files,
    role: "exposed-development-evaluation-only",
    subtitleMutations: 0,
  });
  return {
    root,
    ...(await verifyReadiness(root)),
    denominators: result.denominators,
    modelCoverage: result.modelCoverage,
  };
}

export async function verifyReadiness(root) {
  const checked = await checkFrozen(root, "evaluation-freeze.json");
  root = checked.root;
  const provenance = await json(path.join(root, "provenance.json"));
  for (const b of provenance.bindings)
    assert.equal(await hash(b.file), b.sha256, "BOUND_INPUT_CHANGED");
  const saved = await json(path.join(root, "evaluation-inputs.json"));
  assert.deepEqual(
    await loadSources(...provenance.sources, provenance.typeNotes),
    saved,
    "SOURCE_REPLAY_CHANGED",
  );
  const result = assessShortResponseReadiness(
    saved.snapshot,
    saved.recovery,
    saved.typeAnnotations,
  );
  assert.deepEqual(
    await json(path.join(root, "readiness.json")),
    result,
    "RESULT_REPLAY_CHANGED",
  );
  assert.deepEqual(
    await json(path.join(root, "lexical-label-gaps.json")),
    lexicalLabelGaps(result),
    "GAPS_CHANGED",
  );
  assert.equal(
    await fs.readFile(path.join(root, "LISTENING_GUIDE.md"), "utf8"),
    guide(result),
    "GUIDE_CHANGED",
  );
  assert.equal(
    await fs.readFile(path.join(root, "cases.csv"), "utf8"),
    csv(result),
    "CSV_CHANGED",
  );
  for (const item of saved.snapshot.manifest.items)
    assert.equal(
      await hash(path.join(root, `audio/${item.id}.wav`)),
      item.audioHash,
      "AUDIO_CHANGED",
    );
  return {
    integrity: "passed",
    payloadFiles: checked.count,
    ...saved.integrity,
    newInference: 0,
    subtitleMutations: 0,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const [command, ...args] = process.argv.slice(2);
  assert(
    (command === "evaluate" && args.length === 4) ||
      (command === "verify" && args.length === 1),
    "evaluate BENCHMARK RECOVERY TYPE_NOTES OUTPUT | verify ROOT",
  );
  console.log(
    JSON.stringify(
      command === "evaluate"
        ? await deliverReadiness(...args)
        : await verifyReadiness(...args),
      null,
      2,
    ),
  );
}
