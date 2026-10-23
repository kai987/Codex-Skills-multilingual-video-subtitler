/** Context A/B: short side is frozen cache; only expanded side is inferred. */
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { mapRaw } from "../packages/video-subtitler/dist/standalone/bounded.js";
import {
  EvidenceRunner,
  readPcm,
  slicePcm,
  durable,
} from "./lib/bounded-asr-ab.mjs";
import { verifySoftSpeech } from "./subtitle-tool-soft-speech.mjs";
import { diagnosticFiles } from "./complete-soft-speech-offline.mjs";
import {
  contextPolicy,
  planContexts,
  compareContexts,
} from "./lib/speech-context.mjs";
const repo = path.resolve(import.meta.dirname, ".."),
  json = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const put = (r, n, v) => durable(path.join(r, n), v, true);
async function inventory(root) {
  const files = {};
  for (const e of await fs.readdir(root, { withFileTypes: true })) {
    assert(!e.isSymbolicLink(), "SYMLINK_EVIDENCE");
    if (e.isDirectory())
      for (const [n, h] of Object.entries(
        await inventory(path.join(root, e.name)),
      ))
        files[`${e.name}/${n}`] = h;
    else files[e.name] = await fileHash(path.join(root, e.name));
  }
  return files;
}
async function check(files) {
  for (const f of files)
    assert.equal(await fileHash(f.path), f.sha256, `CHANGED:${f.path}`);
}
const bind = async (p) => ({ path: p, sha256: await fileHash(p) });
async function parentInput(parent) {
  await verifySoftSpeech(parent);
  const plan = await json(path.join(parent, "plan.json")),
    baseline = await json(path.join(parent, "candidate-records.json"));
  const earlier = await json(path.join(plan.parent, "plan.json"));
  return {
    plan,
    baseline,
    audio: earlier.sourceFiles.find(
      (f) => path.basename(f.path) === "audio.wav",
    ),
  };
}
export async function prepareContext(parent, output) {
  parent = path.resolve(parent);
  output = path.resolve(output);
  const input = await parentInput(parent);
  for (const old of [
    parent,
    input.plan.parent,
    input.plan.spec.task,
    input.plan.spec.candidate,
  ].filter(Boolean))
    assert(
      output !== old && !output.startsWith(old + path.sep),
      "OUTPUT_INSIDE_BASELINE",
    );
  const planned = planContexts(
    input.plan.probes,
    input.baseline,
    input.plan.duration,
    input.plan.audioOffset,
  );
  await check([input.audio]);
  const pcm = readPcm(await fs.readFile(input.audio.path));
  assert.equal(pcm.sampleRate, 16000);
  await fs.mkdir(output, { recursive: true });
  const root = await fs.mkdtemp(path.join(output, "context-"));
  for (const p of planned.selected) {
    const dir = path.join(root, p.id);
    await fs.mkdir(dir);
    const begin = Math.round((p.start - input.plan.audioOffset) * 16000);
    await fs.writeFile(
      path.join(dir, "input.wav"),
      slicePcm(pcm, begin, begin + p.frames),
      { flag: "wx" },
    );
    p.wavHash = await fileHash(path.join(dir, "input.wav"));
  }
  const software = await Promise.all(
    [
      "scripts/subtitle-tool-speech-context.mjs",
      "scripts/lib/speech-context.mjs",
      "scripts/complete-soft-speech-offline.mjs",
      "scripts/runtime/speech_support_kotoba.py",
      "scripts/lib/bounded-asr-ab.mjs",
      "packages/video-subtitler/dist/standalone/bounded.js",
      "packages/subtitle-core/dist/parse.js",
      "packages/subtitle-core/dist/format.js",
    ].map((n) => bind(path.join(repo, n))),
  );
  await put(root, "plan.json", {
    version: contextPolicy.version,
    policy: contextPolicy,
    parent,
    parentFreezeHash: await fileHash(path.join(parent, "machine-freeze.json")),
    ...planned,
    audio: input.audio,
    config: input.plan.config,
    spec: input.plan.spec,
    identities: input.plan.identities,
    software,
    duration: input.plan.duration,
    audioOffset: input.plan.audioOffset,
    referenceUsed: false,
  });
  await put(root, "baseline-records.json", input.baseline);
  await put(
    root,
    "short-views.json",
    await json(path.join(parent, "views.json")),
  );
  await put(root, "asr-plan.json", {
    probes: planned.selected,
    model: input.plan.spec.kotobaModel,
    referenceUsed: false,
  });
  await put(root, "asr-plan-freeze.json", {
    sha256: await fileHash(path.join(root, "asr-plan.json")),
  });
  await put(root, "plan-freeze.json", {
    planHash: await fileHash(path.join(root, "plan.json")),
    baselineHash: await fileHash(path.join(root, "baseline-records.json")),
  });
  return {
    root,
    requests: planned.selected.length * 2,
    audioSeconds: planned.selected.reduce(
      (s, r) => s + (2 * r.frames) / 16000,
      0,
    ),
    ...planned,
  };
}
async function load(root) {
  const p = await json(path.join(root, "plan.json")),
    f = await json(path.join(root, "plan-freeze.json"));
  assert.equal(await fileHash(path.join(root, "plan.json")), f.planHash);
  assert.equal(
    await fileHash(path.join(root, "baseline-records.json")),
    f.baselineHash,
  );
  assert.equal(
    await fileHash(path.join(p.parent, "machine-freeze.json")),
    p.parentFreezeHash,
  );
  await check(p.software);
  assert.deepEqual(p.policy, contextPolicy);
  const input = await parentInput(p.parent);
  for (const key of ["config", "spec", "identities", "duration", "audioOffset"])
    assert.deepEqual(p[key], input.plan[key]);
  assert.deepEqual(p.audio, input.audio);
  await check([p.audio]);
  assert.deepEqual(
    await json(path.join(root, "baseline-records.json")),
    input.baseline,
  );
  assert.deepEqual(
    await json(path.join(root, "short-views.json")),
    await json(path.join(p.parent, "views.json")),
  );
  const planned = planContexts(
    input.plan.probes,
    input.baseline,
    p.duration,
    p.audioOffset,
  );
  assert.deepEqual(p.deferred, planned.deferred);
  assert.deepEqual(
    p.selected.map(({ wavHash, ...r }) => {
      assert.match(wavHash, /^[a-f0-9]{64}$/u);
      return r;
    }),
    planned.selected,
  );
  const pcm = readPcm(await fs.readFile(p.audio.path));
  for (const r of p.selected) {
    const wav = await fs.readFile(path.join(root, r.id, "input.wav")),
      begin = Math.round((r.start - p.audioOffset) * 16000);
    assert.equal(await fileHash(path.join(root, r.id, "input.wav")), r.wavHash);
    assert.deepEqual(wav, slicePcm(pcm, begin, begin + r.frames));
  }
  assert.deepEqual(await json(path.join(root, "asr-plan.json")), {
    probes: p.selected,
    model: p.spec.kotobaModel,
    referenceUsed: false,
  });
  assert.equal(
    await fileHash(path.join(root, "asr-plan.json")),
    (await json(path.join(root, "asr-plan-freeze.json"))).sha256,
  );
  return p;
}
async function readViews(root, p) {
  const views = [];
  for (const r of p.selected) {
    const dir = path.join(root, r.id),
      raw = path.join(dir, "whisper.srt");
    const primary = mapRaw(
      await fs.readFile(raw, "utf8"),
      await fileHash(raw),
      {
        id: r.id,
        index: 0,
        inputStart: 0,
        inputEnd: r.frames,
        coreStart: 0,
        coreEnd: r.frames,
        boundary: "hard-cut",
        candidateSamples: [],
      },
      16000,
      r.start,
      p.duration,
      r.id,
    );
    const secondary = (
      await json(path.join(dir, "kotoba-raw.json"))
    ).segments.map((s, i) => ({
      recordId: `${r.id}-kotoba-${i}`,
      text: s.text.trim(),
      sourceStart: r.start + s.start,
      sourceEnd: r.start + s.end,
      issues: [],
    }));
    for (const [backend, records] of [
      ["whisper", primary],
      ["kotoba", secondary],
    ])
      views.push({
        targetId: r.id,
        backend,
        records,
        unresolvedCount: records.filter(
          (c) =>
            c.issues.length ||
            !c.text ||
            !Number.isFinite(c.sourceStart) ||
            !Number.isFinite(c.sourceEnd) ||
            c.sourceStart < r.start ||
            c.sourceEnd > r.end ||
            c.sourceEnd <= c.sourceStart,
        ).length,
      });
  }
  return views;
}
async function dispatch(runner, exe, args, dir, name) {
  await put(dir, `${name}-dispatch.json`, {
    executable: exe,
    args,
    at: new Date().toISOString(),
  });
  const r = await runner.run(exe, args, { cwd: dir, timeoutMs: 180000 });
  await fs.writeFile(path.join(dir, `${name}.stdout.log`), r.stdout ?? "", {
    flag: "wx",
  });
  await fs.writeFile(path.join(dir, `${name}.stderr.log`), r.stderr ?? "", {
    flag: "wx",
  });
  await put(dir, `${name}-exit.json`, {
    exitCode: r.exitCode,
    signal: r.signal ?? null,
  });
  assert.equal(r.exitCode, 0, `${name}_FAILED_NO_RETRY`);
}
export async function runContext(
  root,
  { authorize = false, runner = new EvidenceRunner() } = {},
) {
  const p = await load(root);
  assert(authorize, "EXPLICIT_LOCAL_ASR_REQUIRED");
  await check(p.identities);
  await put(root, "execution-reservation.json", {
    at: new Date().toISOString(),
    requests: p.selected.length * 2,
    audioSeconds: p.selected.reduce((s, r) => s + (2 * r.frames) / 16000, 0),
    retries: 0,
  });
  for (const r of p.selected) {
    const dir = path.join(root, r.id);
    console.log(`whisper expanded ${r.id} ${r.start}–${r.end}`);
    await dispatch(
      runner,
      p.config.runtime,
      [
        "--model",
        p.config.model,
        "--file",
        path.join(dir, "input.wav"),
        "--language",
        "ja",
        "--threads",
        String(p.config.threads),
        "--output-srt",
        "--output-file",
        path.join(dir, "whisper"),
        "--suppress-nst",
        "--no-prints",
      ],
      dir,
      "whisper",
    );
  }
  if (p.selected.length)
    await dispatch(
      runner,
      p.spec.python,
      [path.join(repo, "scripts/runtime/speech_support_kotoba.py"), root],
      root,
      "kotoba",
    );
  return finishContext(root);
}
// Idempotent offline completion never clears reservations or invokes a model.
export async function finishContext(root) {
  const p = await load(root),
    reservation = await json(path.join(root, "execution-reservation.json"));
  assert.equal(reservation.requests, p.selected.length * 2);
  assert.equal(reservation.retries, 0);
  assert.equal(
    reservation.audioSeconds,
    p.selected.reduce((s, r) => s + (2 * r.frames) / 16000, 0),
  );
  if (p.selected.length)
    assert.equal((await json(path.join(root, "kotoba-exit.json"))).exitCode, 0);
  for (const r of p.selected)
    assert.equal(
      (await json(path.join(root, r.id, "whisper-exit.json"))).exitCode,
      0,
    );
  const views = await readViews(root, p),
    baseline = await json(path.join(root, "baseline-records.json")),
    old = await json(path.join(root, "short-views.json"));
  const comparison = p.selected.map((r) =>
    compareContexts(r, old, views, baseline),
  );
  const save = async (n, v) => {
    try {
      await put(root, n, v);
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      assert.deepEqual(await json(path.join(root, n)), v);
    }
  };
  await save("views.json", views);
  await save("comparison.json", comparison);
  const diagnostics = [];
  for (const v of views) {
    if (v.unresolvedCount || !v.records.length) {
      diagnostics.push({
        target: v.targetId,
        backend: v.backend,
        status: "RAW_ONLY",
      });
      continue;
    }
    let files;
    try {
      files = diagnosticFiles(v.records);
    } catch (e) {
      diagnostics.push({
        target: v.targetId,
        backend: v.backend,
        status: "RAW_ONLY",
        error: e.message,
      });
      continue;
    }
    for (const [ext, content] of Object.entries(files)) {
      const f = path.join(root, v.targetId, `${v.backend}.diagnostic.${ext}`);
      try {
        await fs.writeFile(f, content, { flag: "wx" });
      } catch (e) {
        if (e.code !== "EEXIST") throw e;
        assert.equal(await fs.readFile(f, "utf8"), content);
      }
    }
    diagnostics.push({
      target: v.targetId,
      backend: v.backend,
      status: "EXPORTED",
    });
  }
  await save("diagnostic-delivery.json", diagnostics);
  await load(root);
  try {
    await fs.access(path.join(root, "machine-freeze.json"));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    await put(root, "machine-freeze.json", {
      at: new Date().toISOString(),
      files: await inventory(root),
      asrRequests: reservation.requests,
      audioSeconds: reservation.audioSeconds,
      newVadPasses: 0,
      referenceUsed: false,
      qualityStatus: "needs-review",
      canonicalMutation: 0,
      finalizationMethod: "none",
    });
  }
  return verifyContext(root);
}
export async function verifyContext(root) {
  const f = await json(path.join(root, "machine-freeze.json"));
  for (const [n, h] of Object.entries(f.files)) {
    assert(!path.isAbsolute(n) && !n.split(/[\\/]/u).includes(".."));
    assert.equal(await fileHash(path.join(root, n)), h, `CHANGED:${n}`);
  }
  const p = await load(root),
    views = await readViews(root, p),
    baseline = await json(path.join(root, "baseline-records.json")),
    old = await json(path.join(root, "short-views.json"));
  assert.deepEqual(await json(path.join(root, "views.json")), views);
  assert.deepEqual(
    await json(path.join(root, "comparison.json")),
    p.selected.map((r) => compareContexts(r, old, views, baseline)),
  );
  assert.equal(f.asrRequests, p.selected.length * 2);
  return {
    root,
    integrity: "passed",
    recordedRequests: f.asrRequests,
    newInference: 0,
    canonicalMutation: 0,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const [cmd, input, output] = process.argv.slice(2);
    let result;
    if (cmd === "prepare") result = await prepareContext(input, output);
    else if (cmd === "run")
      result = await runContext(input, {
        authorize: output === "--authorize-local",
      });
    else if (cmd === "finish") result = await finishContext(input);
    else if (cmd === "verify") result = await verifyContext(input);
    else
      throw Error(
        "prepare PARENT OUTPUT | run ROOT --authorize-local | finish ROOT | verify ROOT",
      );
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  }
}
