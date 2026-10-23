/** Bounded development batch. No reference input, no default-generation promotion. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { safePath } from "../packages/video-subtitler/dist/standalone/recovery.js";
import {
  serializeRecords,
  formats,
} from "../packages/video-subtitler/dist/standalone/bounded.js";
import { EvidenceRunner, readPcm, durable } from "./lib/bounded-asr-ab.mjs";
import { verifySeams } from "./subtitle-tool-refine-seams.mjs";
import {
  closeDialogueTarget,
  dialoguePolicy,
  recoverWholeDialogue,
} from "./lib/whole-dialogue-recovery.mjs";

const repo = path.resolve(import.meta.dirname, "..");
const worker = path.join(
  repo,
  "scripts/runtime/correction_comparison_worker.py",
);
const json = async (f) => JSON.parse(await fs.readFile(f, "utf8"));
const put = (root, name, value) => durable(path.join(root, name), value, true);
const bind = async (file) => ({ file, sha256: await fileHash(file) });
const codeFiles = [
  import.meta.filename,
  worker,
  ...[
    "whole-dialogue-recovery.mjs",
    "content-safety-gate.mjs",
    "seam-text-only.mjs",
    "bounded-asr-ab.mjs",
  ].map((n) => path.join(import.meta.dirname, "lib", n)),
];
async function checkBindings(bindings) {
  for (const b of bindings)
    assert.equal(await fileHash(b.file), b.sha256, `BINDING_CHANGED:${b.file}`);
}
async function verifyFreeze(root, name) {
  const freeze = await json(path.join(root, name));
  for (const [file, sha] of Object.entries(freeze.files)) {
    assert(
      !path.isAbsolute(file) && !file.split(/[\\/]/u).includes(".."),
      "UNSAFE_FROZEN_PATH",
    );
    await safePath(path.join(root, file));
    assert.equal(
      await fileHash(path.join(root, file)),
      sha,
      `FROZEN_FILE_CHANGED:${file}`,
    );
  }
  return freeze;
}
const normalize = (rows) =>
  rows.map((r, i) => ({
    id: r.recordId ?? `baseline-${i + 1}`,
    start: r.sourceStart ?? r.start,
    end: r.sourceEnd ?? r.end,
    text: r.text,
  }));
const parity = (rows) =>
  rows
    .map(({ start, end, text }) => [
      Math.round(start * 100) / 100,
      Math.round(end * 100) / 100,
      text,
    ])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2].localeCompare(b[2]));

export async function prepareDialogueBatch({
  seams,
  probes,
  output,
  model,
  python,
}) {
  seams = await fs.realpath(seams);
  probes = await fs.realpath(probes);
  await verifySeams(seams);
  await verifyFreeze(probes, "machine-freeze.json");
  const sp = await json(path.join(seams, "plan.json")),
    pp = await json(path.join(probes, "plan.json"));
  assert.equal(sp.task, pp.task, "BASELINE_TASK_MISMATCH");
  const sourcePlan = await json(path.join(sp.task, "bounded-plan.json"));
  assert.equal(
    sourcePlan.audioHash,
    pp.sourceAudioHash,
    "SOURCE_AUDIO_MISMATCH",
  );
  assert.equal(
    await fileHash(path.join(sp.task, "audio.wav")),
    pp.sourceAudioHash,
  );
  const baseline = normalize(
    await json(path.join(seams, "baseline-records.json")),
  );
  assert.deepEqual(
    parity(baseline),
    parity(await json(path.join(probes, "baseline-records.json"))),
    "BASELINE_CONTENT_MISMATCH",
  );
  const sv = await json(path.join(seams, "views.json")),
    pv = await json(path.join(probes, "views.json"));
  const picks = [
    ...sp.planned.targets.slice(0, 3).map((t) => ({
      root: seams,
      view: sv.filter((v) => v.targetId === t.id).at(-1),
      target: {
        id: t.id,
        start: t.sourceStart,
        end: t.sourceEnd,
        kind: "seam",
      },
      modelHash: sp.identities.model.sha256,
    })),
    ...pp.targets.map((t) => ({
      root: probes,
      view: pv.find((v) => v.targetId === t.id && v.context === 2),
      target: { id: `risk-${t.id}`, start: t.start, end: t.end, kind: t.code },
      modelHash: pp.identities.model.sha256,
    })),
  ];
  assert.equal(picks.length, 6, "SIX_TARGET_BATCH_REQUIRED");
  const sourcePcm = readPcm(await fs.readFile(path.join(sp.task, "audio.wav")));
  const targets = [],
    oldViews = [],
    requests = [],
    bindings = [];
  for (const pick of picks) {
    const { view: v, target: t } = pick;
    const target = closeDialogueTarget(baseline, t);
    assert(
      v && v.start <= target.start && v.end >= target.end,
      "TARGET_CONTEXT_INCOMPLETE",
    );
    const audioPath = path.join(pick.root, v.id, "input.wav");
    const pcm = readPcm(await fs.readFile(audioPath));
    const first = Math.round(v.start * 16000);
    assert.equal(pcm.sampleRate, 16000);
    assert(
      pcm.data.equals(
        sourcePcm.data.subarray(first * 2, first * 2 + pcm.data.length),
      ),
      "PCM_NOT_SOURCE_SLICE",
    );
    const wavHash = await fileHash(audioPath);
    assert.equal(wavHash, v.audioHash);
    const rawPath = path.join(pick.root, v.id, "response.srt");
    assert.equal(await fileHash(rawPath), v.rawHash);
    const raw = formats.srt.parse(await fs.readFile(rawPath, "utf8"));
    const records = raw.map((r, i) => ({
      id: `${v.id}-${i + 1}`,
      start: r.start + v.start,
      end: r.end + v.start,
      text: r.text,
    }));
    assert.deepEqual(
      parity(records),
      parity(normalize(v.records)),
      "RAW_VIEW_MAPPING_CHANGED",
    );
    oldViews.push({
      id: `stored-${v.id}`,
      targetId: t.id,
      start: v.start,
      end: v.end,
      audioHash: wavHash,
      rawHash: v.rawHash,
      modelHash: pick.modelHash,
      records,
    });
    targets.push(target);
    requests.push({
      id: `kotoba-${t.id}`,
      targetId: t.id,
      mode: "kotoba",
      audioPath,
      wavHash,
      samples: pcm.data.length / 2,
      start: v.start,
      end: v.end,
    });
    bindings.push(await bind(audioPath), await bind(rawPath));
  }
  const seconds = requests.reduce((s, r) => s + r.samples / 16000, 0);
  assert(
    seconds <= dialoguePolicy.maxAudioSeconds &&
      requests.every((r) => r.samples <= 30 * 16000),
    "REQUEST_BUDGET",
  );
  const modelFiles = await Promise.all(
    [
      "config.json",
      "model.bin",
      "preprocessor_config.json",
      "tokenizer.json",
      "vocabulary.json",
    ].map((n) => bind(path.join(model, n))),
  );
  const rootParent = path.resolve(output);
  await safePath(rootParent, true);
  for (const input of [seams, probes, sp.task])
    assert(
      rootParent !== input && !rootParent.startsWith(input + path.sep),
      "OUTPUT_INSIDE_SOURCE",
    );
  await fs.mkdir(rootParent, { recursive: true });
  const root = await fs.mkdtemp(path.join(rootParent, "dialogue-"));
  for (const r of requests) await fs.mkdir(path.join(root, r.id));
  const plan = {
    version: dialoguePolicy.version,
    policy: dialoguePolicy,
    targets,
    requests,
    baseline,
    oldViews,
    sourceDuration: sourcePlan.duration,
    sourceAudioHash: sourcePlan.audioHash,
    sourceTask: sp.task,
    inputRoots: [seams, probes],
    requestAudioSeconds: seconds,
    python,
    models: { kotoba: { path: model, files: modelFiles } },
    modelHash: modelFiles.find((f) => path.basename(f.file) === "model.bin")
      .sha256,
    kotobaDecode: {
      language: "ja",
      task: "transcribe",
      beam_size: 5,
      best_of: 5,
      temperature: 0,
      condition_on_previous_text: false,
      initial_prompt: null,
      vad_filter: false,
      word_timestamps: false,
    },
    bindings: [
      ...bindings,
      ...(await Promise.all(
        [
          ...codeFiles,
          python,
          path.join(seams, "machine-freeze.json"),
          path.join(probes, "machine-freeze.json"),
          path.join(seams, "baseline-records.json"),
          path.join(probes, "baseline-records.json"),
        ].map(bind),
      )),
    ],
    referenceUsed: false,
    retries: 0,
    freshRequestLimit: 6,
    device: "cpu/float32/4threads",
    baselineMeaning:
      "191-row historical independent machine draft, not human-assisted delivery",
    limitations: [
      "Known development episode, not blind evaluation",
      "Shared Whisper ancestry; different configurations, not independent truth",
      "Text-only candidates preserve baseline outer timing; no default promotion",
    ],
  };
  await put(root, "plan.json", plan);
  await put(root, "plan-freeze.json", {
    files: { "plan.json": await fileHash(path.join(root, "plan.json")) },
  });
  return {
    root,
    requests: requests.length,
    requestAudioSeconds: seconds,
    targets,
  };
}

async function checkedPlan(root, runtime = false) {
  await verifyFreeze(root, "plan-freeze.json");
  const p = await json(path.join(root, "plan.json"));
  await checkBindings(p.bindings);
  assert.deepEqual(p.policy, dialoguePolicy, "POLICY_CHANGED");
  if (runtime) await checkBindings(p.models.kotoba.files);
  return p;
}
export async function executeDialogueBatch(root) {
  const p = await checkedPlan(root, true);
  assert.equal(p.requests.length, 6);
  assert(p.requestAudioSeconds <= 120);
  await put(root, "execution-reservation.json", {
    requests: p.requests.map((r) => r.id),
    retries: 0,
    startedAt: new Date().toISOString(),
  });
  const exit = await new EvidenceRunner().run(
    p.python,
    [worker, path.join(root, "plan.json"), "kotoba"],
    { cwd: root, timeoutMs: 600000 },
  );
  await put(root, "execution-exit.json", exit);
  assert.equal(exit.exitCode, 0, "MODEL_FAILED_NO_RETRY");
  return assembleDialogueBatch(root);
}
async function replay(root) {
  const p = await checkedPlan(root);
  const fresh = [];
  for (const r of p.requests) {
    const file = path.join(root, r.id, "raw.json"),
      raw = await json(file);
    assert.equal(raw.requestId, r.id);
    fresh.push({
      id: r.id,
      targetId: r.targetId,
      start: r.start,
      end: r.end,
      audioHash: r.wavHash,
      rawHash: await fileHash(file),
      modelHash: p.modelHash,
      records: raw.segments.map((s, i) => ({
        id: `${r.id}-${i + 1}`,
        start: s.start + r.start,
        end: s.end + r.start,
        text: s.text,
      })),
    });
  }
  return recoverWholeDialogue(p.baseline, p.targets, [...p.oldViews, ...fresh]);
}
function serialize(rows) {
  return serializeRecords(
    rows.map((r, i) => ({
      recordId: r.id,
      order: i + 1,
      sourceStart: r.start,
      sourceEnd: r.end,
      text: r.text,
      issues: [],
    })),
    "ja",
  );
}
export async function assembleDialogueBatch(root) {
  const result = await replay(root);
  await put(root, "result.json", result);
  const files = [
    "plan.json",
    "plan-freeze.json",
    "execution-reservation.json",
    "execution-exit.json",
    "result.json",
  ];
  for (const r of (await json(path.join(root, "plan.json"))).requests)
    files.push(`${r.id}/raw.json`, `${r.id}/reserved.json`);
  for (const [name, rows] of [
    ["baseline", result.baseline],
    ["candidate", result.candidate],
  ]) {
    for (const [ext, bytes] of Object.entries(serialize(rows).files)) {
      const file = `${name}.needs-review.${ext}`;
      await fs.writeFile(path.join(root, file), bytes, { flag: "wx" });
      files.push(file);
    }
  }
  await put(root, "machine-freeze.json", {
    frozenAt: new Date().toISOString(),
    files: Object.fromEntries(
      await Promise.all(
        files.map(async (f) => [f, await fileHash(path.join(root, f))]),
      ),
    ),
  });
  return verifyDialogueBatch(root);
}
export async function verifyDialogueBatch(root) {
  await verifyFreeze(root, "machine-freeze.json");
  const result = await replay(root);
  assert.deepEqual(
    await json(path.join(root, "result.json")),
    result,
    "DECISION_REPLAY_CHANGED",
  );
  for (const [name, rows] of [
    ["baseline", result.baseline],
    ["candidate", result.candidate],
  ]) {
    const expected = serialize(rows);
    for (const [ext, bytes] of Object.entries(expected.files)) {
      assert.equal(
        await fs.readFile(
          path.join(root, `${name}.needs-review.${ext}`),
          "utf8",
        ),
        bytes,
      );
      assert.deepEqual(
        formats[ext].parse(bytes).map((r) => [r.start, r.end, r.text]),
        expected.cues.map((r) => [r.start, r.end, r.text]),
        "FORMAT_PARITY",
      );
    }
  }
  return {
    root,
    integrity: "passed",
    changedTargets: result.changedTargets,
    inputCues: result.baseline.length,
    candidateCues: result.candidate.length,
    protectedRecords: result.protectedRecords,
    newInferenceDuringVerify: 0,
    qualityStatus: "needs-review",
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === "prepare" && args.length === 5)
    console.log(
      JSON.stringify(
        await prepareDialogueBatch(
          Object.fromEntries(
            ["seams", "probes", "output", "model", "python"].map((k, i) => [
              k,
              args[i],
            ]),
          ),
        ),
        null,
        2,
      ),
    );
  else if (
    mode === "execute" &&
    args.length === 2 &&
    args[1] === "--authorize-local-asr"
  )
    console.log(
      JSON.stringify(
        await executeDialogueBatch(path.resolve(args[0])),
        null,
        2,
      ),
    );
  else if (mode === "verify" && args.length === 1)
    console.log(
      JSON.stringify(await verifyDialogueBatch(path.resolve(args[0])), null, 2),
    );
  else
    throw Error(
      "Usage: prepare SEAMS PROBES OUTPUT MODEL PYTHON | execute TASK --authorize-local-asr | verify TASK",
    );
}
