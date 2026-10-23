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
import { verifyLexicalComparison } from "./run-lexical-risk-comparison.mjs";
import {
  readPcm,
  slicePcm,
  durable,
  EvidenceRunner,
} from "./lib/bounded-asr-ab.mjs";
import {
  contextPolicy,
  planContextWindows,
} from "./lib/whole-context-comparison.mjs";
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
export async function prepareContextComparison(previousRoot, output) {
  const previous = await fs.realpath(previousRoot);
  await verifyLexicalComparison(previous);
  const old = await json(path.join(previous, "plan.json"));
  const parent = path.resolve(output);
  await safePath(parent, true);
  for (const source of [previous, ...old.sources.map((s) => s.task)])
    assert(
      parent !== source && !parent.startsWith(source + path.sep),
      "OUTPUT_INSIDE_SOURCE",
    );
  const selection = planContextWindows(old);
  assert(selection.windows.length, "NO_BOUNDED_CONTEXT_WINDOWS");
  const bindings = [
    ...old.bindings,
    await bind(path.join(previous, "machine-freeze.json")),
    await bind(path.join(previous, "plan.json")),
    await bind(import.meta.filename),
    await bind(
      path.join(import.meta.dirname, "lib/whole-context-comparison.mjs"),
    ),
  ];
  await check(bindings);
  await check(old.runtimeBindings);
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, "context-"));
  const windows = [];
  for (const window of selection.windows) {
    const source = old.sources.find((s) => s.id === window.sourceId);
    const pcm = readPcm(await fs.readFile(path.join(source.task, "audio.wav")));
    assert.equal(pcm.sampleRate, 16000);
    const dir = path.join(root, window.id);
    await fs.mkdir(dir);
    await fs.writeFile(
      path.join(dir, "input.wav"),
      slicePcm(
        pcm,
        Math.round(window.start * 16000),
        Math.round(window.end * 16000),
      ),
      { flag: "wx" },
    );
    windows.push({
      ...window,
      audioHash: await fileHash(path.join(dir, "input.wav")),
    });
  }
  const plan = {
    ...old,
    version: contextPolicy.version,
    policy: contextPolicy,
    createdAt: new Date().toISOString(),
    previous,
    windows,
    deferred: selection.deferred,
    bindings,
    requestLimit: windows.length * 2,
    requestAudioSeconds: windows.reduce(
      (n, w) => n + (w.samples * 2) / 16000,
      0,
    ),
    targetSelection: "same-original-targets-baseline-envelope-closure",
    timingWarning:
      "Baseline envelopes are not acoustic utterance-boundary truth; any candidate merges internal cues.",
  };
  await put(root, "plan.json", plan);
  await put(root, "plan-freeze.json", {
    sha256: await fileHash(path.join(root, "plan.json")),
  });
  return {
    root,
    requests: plan.requestLimit,
    seconds: plan.requestAudioSeconds,
    windows,
    deferred: plan.deferred,
  };
}
async function checked(root, runtime = false) {
  const f = await json(path.join(root, "plan-freeze.json"));
  assert.equal(await fileHash(path.join(root, "plan.json")), f.sha256);
  const p = await json(path.join(root, "plan.json"));
  assert.deepEqual(p.policy, contextPolicy);
  await check(p.bindings);
  const expected = planContextWindows(
    await json(path.join(p.previous, "plan.json")),
  );
  assert.deepEqual(
    p.windows.map((w) => {
      const copy = { ...w };
      delete copy.audioHash;
      return copy;
    }),
    expected.windows,
  );
  assert.deepEqual(p.deferred, expected.deferred);
  assert.equal(
    p.requestAudioSeconds,
    p.windows.reduce((n, w) => n + (w.samples * 2) / 16000, 0),
  );
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
export async function executeContextComparison(
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
  return verifyContextComparison(root);
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
    version: contextPolicy.version,
    sources,
    referenceUsed: false,
    preferredOutputs: [],
    automaticPromotionAllowed: false,
    qualityStatus: "needs-review",
  };
}
export async function verifyContextComparison(root) {
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
      ? await prepareContextComparison(a, b)
      : mode === "execute" && a && b === "--authorize-local-asr"
        ? await executeContextComparison(path.resolve(a), { authorize: true })
        : mode === "verify" && a && !b
          ? await verifyLexicalComparison(path.resolve(a))
          : null;
  assert(
    result,
    "Usage: prepare FROZEN_COMPARISON OUTPUT | execute ROOT --authorize-local-asr | verify ROOT",
  );
  console.log(JSON.stringify(result, null, 2));
}
