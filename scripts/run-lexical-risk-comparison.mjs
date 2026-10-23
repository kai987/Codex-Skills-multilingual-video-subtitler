/** Explicit development-only paired local ASR. No reference input or default promotion. */
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { safePath } from "../packages/video-subtitler/dist/standalone/recovery.js";
import {
  serializeRecords,
  formats,
} from "../packages/video-subtitler/dist/standalone/bounded.js";
import { statusBounded } from "./lib/bounded-product.mjs";
import {
  readPcm,
  slicePcm,
  durable,
  EvidenceRunner,
} from "./lib/bounded-asr-ab.mjs";
import {
  lexicalRiskPolicy,
  associateTokenEvidence,
  selectLexicalRisks,
} from "./lib/lexical-risk-selection.mjs";
import { recoverWholeDialogue } from "./lib/whole-dialogue-recovery.mjs";
const json = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const put = (root, name, value) => durable(path.join(root, name), value, true);
const worker = path.join(
  import.meta.dirname,
  "runtime/lexical_comparison_worker.py",
);
const bind = async (file) => ({ file, sha256: await fileHash(file) });
async function check(bindings) {
  for (const b of bindings)
    assert.equal(await fileHash(b.file), b.sha256, `BINDING_CHANGED:${b.file}`);
}
async function inventory(root) {
  const files = {};
  for (const e of await fs.readdir(root, { withFileTypes: true })) {
    const file = path.join(root, e.name);
    await safePath(file);
    if (e.isDirectory())
      for (const [p, h] of Object.entries(await inventory(file)))
        files[`${e.name}/${p}`] = h;
    else files[e.name] = await fileHash(file);
  }
  return files;
}
async function verifyInventory(root, files) {
  for (const [name, sha] of Object.entries(files)) {
    assert(
      !path.isAbsolute(name) && !name.split(/[\\/]/u).includes(".."),
      "UNSAFE_PATH",
    );
    await safePath(path.join(root, name));
    assert.equal(await fileHash(path.join(root, name)), sha, name);
  }
}
export async function prepareLexicalComparison(spec, output) {
  assert.deepEqual(Object.keys(spec).sort(), ["kotoba", "python", "tasks"]);
  assert(
    Array.isArray(spec.tasks) &&
      spec.tasks.length > 0 &&
      spec.tasks.length <= 3,
    "SOURCE_LIMIT",
  );
  assert.equal(new Set(spec.tasks).size, spec.tasks.length, "DUPLICATE_TASK");
  const parent = path.resolve(output);
  await safePath(parent, true);
  const sources = [],
    bindings = [],
    runtimeBindings = [],
    windows = [];
  let primary;
  for (const [index, taskPath] of spec.tasks.entries()) {
    const task = await fs.realpath(taskPath);
    assert(
      parent !== task && !parent.startsWith(task + path.sep),
      "OUTPUT_INSIDE_SOURCE",
    );
    const state = await statusBounded(task);
    assert.equal(state.executionStatus, "completed");
    assert.equal(state.artifactIntegrity, "passed");
    assert.equal(state.unresolvedCount, 0);
    assert.equal(state.aliasCount, 0);
    const plan = await json(path.join(task, "bounded-plan.json"));
    assert.equal(plan.audioOffset, 0, "SOURCE_TIMEBASE_REQUIRED");
    assert.equal(plan.config.language, "ja");
    if (primary)
      for (const key of ["model", "runtime"])
        assert.deepEqual(plan.identities[key], primary.identities[key]);
    else primary = { identities: plan.identities, config: plan.config };
    const mapped = (await json(path.join(task, "mapped-records.json"))).records;
    const rows = mapped.map((r) => ({
      id: r.recordId,
      start: r.sourceStart,
      end: r.sourceEnd,
      text: r.text,
    }));
    const rawByRequest = new Map(),
      risks = [];
    for (const r of mapped) {
      assert(/^[a-z0-9-]+$/u.test(r.requestId), "INVALID_REQUEST_ID");
      if (!rawByRequest.has(r.requestId)) {
        const file = path.join(
          task,
          "requests",
          r.requestId,
          "raw-response.json",
        );
        assert.equal(
          await fileHash(file),
          state.files[path.relative(task, file)],
          "RAW_NOT_BOUND",
        );
        rawByRequest.set(r.requestId, await json(file));
        bindings.push(await bind(file));
      }
      risks.push(
        associateTokenEvidence(r, rawByRequest.get(r.requestId).transcription),
      );
    }
    const pcm = readPcm(await fs.readFile(path.join(task, "audio.wav")));
    assert.equal(pcm.sampleRate, 16000);
    assert.equal(await fileHash(path.join(task, "audio.wav")), plan.audioHash);
    const selection = selectLexicalRisks(rows, risks, plan.duration);
    const source = {
      id: `source-${index + 1}`,
      task,
      baseline: rows,
      selection,
      duration: plan.duration,
    };
    sources.push(source);
    for (const s of selection.selected) {
      const startFrame = Math.round(s.window.start * 16000),
        endFrame = Math.round(s.window.end * 16000);
      windows.push({
        id: `window-${windows.length + 1}`,
        sourceId: source.id,
        target: s.target,
        start: startFrame / 16000,
        end: endFrame / 16000,
        samples: endFrame - startFrame,
        bytes: slicePcm(pcm, startFrame, endFrame),
      });
    }
    for (const [name, sha256] of Object.entries(state.files))
      bindings.push({ file: path.join(task, name), sha256 });
    bindings.push(await bind(path.join(task, "bounded-task.json")));
  }
  assert(
    windows.length <= 3 &&
      windows.every((w) => w.samples <= 15 * 16000) &&
      windows.reduce((s, w) => s + (w.samples * 2) / 16000, 0) <= 90,
    "BUDGET",
  );
  const modelFiles = await Promise.all(
    [
      "model.bin",
      "config.json",
      "preprocessor_config.json",
      "tokenizer.json",
      "vocabulary.json",
    ].map((n) => bind(path.join(spec.kotoba, n))),
  );
  runtimeBindings.push(...modelFiles, await bind(spec.python));
  for (const k of ["model", "runtime"])
    runtimeBindings.push({
      file: primary.identities[k].path,
      sha256: primary.identities[k].sha256,
    });
  await check(runtimeBindings);
  const software = [
    import.meta.filename,
    worker,
    ...[
      "lexical-risk-selection.mjs",
      "whole-dialogue-recovery.mjs",
      "content-safety-gate.mjs",
      "seam-text-only.mjs",
      "bounded-asr-ab.mjs",
    ].map((n) => path.join(import.meta.dirname, "lib", n)),
  ];
  // Bind transitive compiled runtime/parsers as well as authored decision code.
  for (const base of [
    "video-subtitler",
    "subtitle-core",
    "transcription-core",
  ]) {
    const dir = path.resolve(import.meta.dirname, `../packages/${base}/dist`);
    for (const name of Object.keys(await inventory(dir)))
      software.push(path.join(dir, name));
  }
  bindings.push(...(await Promise.all(software.map(bind))));
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, "lexical-"));
  for (const w of windows) {
    await fs.mkdir(path.join(root, w.id));
    await fs.writeFile(path.join(root, w.id, "input.wav"), w.bytes, {
      flag: "wx",
    });
    delete w.bytes;
    w.audioHash = await fileHash(path.join(root, w.id, "input.wav"));
  }
  const plan = {
    version: lexicalRiskPolicy.version,
    policy: lexicalRiskPolicy,
    createdAt: new Date().toISOString(),
    sources,
    windows,
    primary,
    kotoba: spec.kotoba,
    python: spec.python,
    kotobaHash: modelFiles[0].sha256,
    bindings,
    runtimeBindings,
    requestLimit: windows.length * 2,
    requestAudioSeconds: windows.reduce(
      (s, w) => s + (w.samples * 2) / 16000,
      0,
    ),
    referenceUsed: false,
    evaluationContext: "previously-seen-development-material-not-blind",
    qualityStatus: "needs-review",
    decode: {
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
  };
  await put(root, "plan.json", plan);
  await put(root, "plan-freeze.json", {
    sha256: await fileHash(path.join(root, "plan.json")),
  });
  return {
    root,
    requests: plan.requestLimit,
    seconds: plan.requestAudioSeconds,
    selected: windows.map((w) => ({
      source: w.sourceId,
      target: w.target,
      start: w.start,
      end: w.end,
    })),
  };
}
async function checked(root, runtime = false) {
  const f = await json(path.join(root, "plan-freeze.json"));
  assert.equal(await fileHash(path.join(root, "plan.json")), f.sha256);
  const p = await json(path.join(root, "plan.json"));
  assert.deepEqual(p.policy, lexicalRiskPolicy);
  await check(p.bindings);
  if (runtime) await check(p.runtimeBindings);
  assert(
    p.windows.length <= 3 &&
      p.requestLimit === p.windows.length * 2 &&
      p.requestAudioSeconds <= 90,
    "BUDGET",
  );
  for (const w of p.windows) {
    const wav = path.join(root, w.id, "input.wav");
    assert.equal(await fileHash(wav), w.audioHash);
    const pcm = readPcm(await fs.readFile(wav));
    assert.equal(pcm.frames, w.samples);
    assert.equal(pcm.sampleRate, 16000);
    assert(w.samples > 0 && w.samples <= 15 * 16000);
    const source = p.sources.find((s) => s.id === w.sourceId);
    assert(source);
    const original = readPcm(
      await fs.readFile(path.join(source.task, "audio.wav")),
    );
    assert(
      pcm.data.equals(
        original.data.subarray(
          Math.round(w.start * 16000) * 2,
          Math.round(w.end * 16000) * 2,
        ),
      ),
      "PCM_SOURCE_MISMATCH",
    );
  }
  return p;
}
export async function executeLexicalComparison(
  root,
  { authorize = false } = {},
) {
  assert(authorize, "EXPLICIT_LOCAL_AUTHORIZATION_REQUIRED");
  const p = await checked(root, true);
  await put(root, "execution-reservation.json", {
    at: new Date().toISOString(),
    requests: p.requestLimit,
    seconds: p.requestAudioSeconds,
    retries: 0,
  });
  const runner = new EvidenceRunner();
  for (const w of p.windows) {
    const dir = path.join(root, w.id);
    const args = [
      "--model",
      p.primary.config.model,
      "--file",
      path.join(dir, "input.wav"),
      "--language",
      "ja",
      "--threads",
      "4",
      "--output-srt",
      "--output-file",
      path.join(dir, "large"),
      "--suppress-nst",
      "--no-prints",
    ];
    await put(dir, "large-request.json", {
      audioHash: w.audioHash,
      args,
      prompt: null,
    });
    console.log(`large-v3 ${w.id}`);
    const exit = await runner.run(p.primary.config.runtime, args, {
      cwd: dir,
      timeoutMs: 120000,
    });
    await put(dir, "large-exit.json", exit);
    assert.equal(exit.exitCode, 0, "ASR_FAILED_NO_RETRY");
  }
  if (p.windows.length) {
    const exit = await runner.run(p.python, [worker, root], {
      cwd: root,
      timeoutMs: 300000,
    });
    await put(root, "kotoba-exit.json", exit);
    assert.equal(exit.exitCode, 0, "KOTOBA_FAILED_NO_RETRY");
  }
  await checked(root, true);
  const result = await replay(root, p);
  await put(root, "result.json", result);
  for (const s of result.sources)
    for (const [kind, rows] of [
      ["baseline", s.baseline],
      ["candidate", s.candidate],
    ]) {
      const out = serializeRecords(
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
      for (const [ext, bytes] of Object.entries(out.files))
        await fs.writeFile(
          path.join(root, `${s.id}.${kind}.needs-review.${ext}`),
          bytes,
          { flag: "wx" },
        );
    }
  await put(root, "machine-freeze.json", {
    at: new Date().toISOString(),
    files: await inventory(root),
  });
  return verifyLexicalComparison(root);
}
async function replay(root, p) {
  const sources = [];
  for (const source of p.sources) {
    const windows = p.windows.filter((w) => w.sourceId === source.id),
      views = [];
    for (const w of windows) {
      const srt = path.join(root, w.id, "large.srt"),
        kotoba = path.join(root, w.id, "kotoba.json");
      const k = await json(kotoba);
      assert.equal(k.requestId, w.id);
      assert.equal(k.audioHash, w.audioHash);
      for (const [mode, rows, file, modelHash] of [
        [
          "large",
          formats.srt.parse(await fs.readFile(srt, "utf8")),
          srt,
          p.primary.identities.model.sha256,
        ],
        ["kotoba", k.segments, kotoba, p.kotobaHash],
      ]) {
        assert(
          rows.every(
            (r) =>
              Number.isFinite(r.start) &&
              Number.isFinite(r.end) &&
              r.start >= 0 &&
              r.end > r.start &&
              r.end <= w.samples / 16000 + 0.001 &&
              typeof r.text === "string",
          ),
          "INVALID_LOCAL_TIMING",
        );
        views.push({
          id: `${w.id}-${mode}`,
          targetId: w.target.id,
          start: w.start,
          end: w.end,
          audioHash: w.audioHash,
          rawHash: await fileHash(file),
          modelHash,
          records: rows.map((r, i) => ({
            id: `${w.id}-${mode}-${i}`,
            start: r.start + w.start,
            end: r.end + w.start,
            text: r.text,
          })),
        });
      }
    }
    sources.push({
      id: source.id,
      ...recoverWholeDialogue(
        source.baseline,
        windows.map((w) => w.target),
        views,
      ),
    });
  }
  return {
    version: lexicalRiskPolicy.version,
    sources,
    referenceUsed: false,
    preferredOutputs: [],
    automaticPromotionAllowed: false,
    qualityStatus: "needs-review",
  };
}
export async function verifyLexicalComparison(root) {
  const f = await json(path.join(root, "machine-freeze.json"));
  await verifyInventory(root, f.files);
  const p = await checked(root);
  const result = await replay(root, p);
  assert.deepEqual(result, await json(path.join(root, "result.json")));
  for (const s of result.sources)
    for (const [kind, rows] of [
      ["baseline", s.baseline],
      ["candidate", s.candidate],
    ]) {
      const out = serializeRecords(
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
      for (const [ext, bytes] of Object.entries(out.files)) {
        assert.equal(
          await fs.readFile(
            path.join(root, `${s.id}.${kind}.needs-review.${ext}`),
            "utf8",
          ),
          bytes,
        );
        assert.deepEqual(
          formats[ext].parse(bytes).map((r) => [r.start, r.end, r.text]),
          out.cues.map((r) => [r.start, r.end, r.text]),
        );
      }
    }
  return {
    root,
    integrity: "passed",
    requests: p.requestLimit,
    requestAudioSeconds: p.requestAudioSeconds,
    changedTargets: result.sources.reduce((n, s) => n + s.changedTargets, 0),
    decisions: result.sources.flatMap((s) =>
      s.decisions.map((d) => ({
        source: s.id,
        status: d.status,
        reason: d.reason,
      })),
    ),
    newInferenceDuringVerification: 0,
    qualityStatus: "needs-review",
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [mode, a, b] = process.argv.slice(2);
  const result =
    mode === "prepare" && a && b
      ? await prepareLexicalComparison(await json(a), b)
      : mode === "execute" && a && b === "--authorize-local-asr"
        ? await executeLexicalComparison(path.resolve(a), { authorize: true })
        : mode === "verify" && a && !b
          ? await verifyLexicalComparison(path.resolve(a))
          : null;
  assert(
    result,
    "Usage: prepare SPEC OUTPUT | execute ROOT --authorize-local-asr | verify ROOT",
  );
  console.log(JSON.stringify(result, null, 2));
}
