/** Bounded local evidence experiment. No reference input or implicit default mutation. */
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { statusBounded } from "./lib/bounded-product.mjs";
import { verifySeams } from "./subtitle-tool-refine-seams.mjs";
import { proposeSeamTextOnly } from "./lib/seam-text-only.mjs";
import { assembleSeams } from "./lib/seam-refinement.mjs";
import {
  EvidenceRunner,
  readPcm,
  slicePcm,
  durable,
} from "./lib/bounded-asr-ab.mjs";
import {
  mapRaw,
  serializeRecords,
  formats,
} from "../packages/video-subtitler/dist/standalone/bounded.js";
import {
  speechSupportPolicy,
  planSpeechRegions,
  planSpeechProbes,
  decideSpeechProbe,
  assembleSpeechProposals,
} from "./lib/speech-support-policy.mjs";
const repo = path.resolve(import.meta.dirname, ".."),
  json = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const put = (root, n, v) => durable(path.join(root, n), v, true);
const bind = async (p) => ({
  path: path.resolve(p),
  sha256: await fileHash(p),
});
const codeNames = [
  "scripts/subtitle-tool-speech-support.mjs",
  "scripts/lib/speech-support-policy.mjs",
  "scripts/runtime/speech_support_kotoba.py",
  "scripts/runtime/bounded_silero.py",
  "scripts/runtime/c601141_speech_activity_worker.py",
  "scripts/lib/bounded-asr-ab.mjs",
  "scripts/lib/bounded-product.mjs",
  "packages/video-subtitler/dist/standalone/bounded.js",
  "packages/subtitle-core/dist/parse.js",
  "packages/subtitle-core/dist/format.js",
];
async function checkFiles(files) {
  for (const f of files)
    assert.equal(await fileHash(f.path), f.sha256, `CHANGED:${f.path}`);
}
async function inventory(root) {
  const out = {};
  for (const e of await fs.readdir(root, { withFileTypes: true })) {
    if (e.isSymbolicLink()) throw Error("SYMLINK_EVIDENCE");
    if (e.isDirectory())
      for (const [n, h] of Object.entries(
        await inventory(path.join(root, e.name)),
      ))
        out[`${e.name}/${n}`] = h;
    else out[e.name] = await fileHash(path.join(root, e.name));
  }
  return out;
}
async function checkInventory(root, files) {
  for (const [name, hash] of Object.entries(files)) {
    if (path.isAbsolute(name) || name.split(/[\\/]/u).includes(".."))
      throw Error("UNSAFE_PATH");
    assert.equal(
      await fileHash(path.join(root, name)),
      hash,
      `CHANGED:${name}`,
    );
  }
}
async function readBaseline(bounded, candidate) {
  const state = await statusBounded(bounded);
  assert.equal(state.executionStatus, "completed");
  assert.equal(state.coverageScope, "full-audio");
  assert.equal(state.unresolvedCount, 0);
  assert.equal(state.aliasCount, 0);
  assert.equal(state.config.language, "ja");
  let rows = (await json(path.join(bounded, "mapped-records.json"))).records;
  if (candidate) {
    const f = await json(path.join(candidate, "machine-freeze.json"));
    await checkInventory(candidate, f.files);
    assert.equal(
      await fileHash(path.join(f.input, "machine-freeze.json")),
      f.inputFreezeHash,
    );
    await verifySeams(f.input);
    const p = await json(path.join(f.input, "plan.json")),
      old = await json(path.join(candidate, "baseline-records.json")),
      views = await json(path.join(f.input, "views.json"));
    assert.equal(path.resolve(p.task), path.resolve(bounded));
    assert.deepEqual(rows, old);
    const decisions = p.planned.targets.map((t) =>
      proposeSeamTextOnly(
        t,
        old,
        views.filter((v) => v.targetId === t.id),
      ),
    );
    assert.deepEqual(
      decisions,
      await json(path.join(candidate, "decisions.json")),
    );
    rows = await json(path.join(candidate, "candidate-records.json"));
    assert.deepEqual(rows, assembleSeams(old, decisions));
  }
  return { state, rows };
}
export async function prepareSpeech(spec, outputRoot) {
  for (const source of [spec.task, spec.candidate].filter(Boolean))
    if (
      path.resolve(outputRoot) === path.resolve(source) ||
      path.resolve(outputRoot).startsWith(path.resolve(source) + path.sep)
    )
      throw Error("OUTPUT_INSIDE_BASELINE");
  const { state, rows } = await readBaseline(spec.task, spec.candidate);
  const regions = planSpeechRegions(rows, state.duration);
  assert(
    regions.length <= 4 &&
      regions.reduce((s, r) => s + r.cropEnd - r.cropStart, 0) <= 120,
  );
  const identities = [
    ...Object.values(state.plan.identities).filter((f) =>
      [state.config.model, state.config.runtime].includes(f.path),
    ),
    ...(await Promise.all(
      [spec.python, spec.vadModel, spec.vadLibrary].map(bind),
    )),
  ];
  for (const e of await fs.readdir(spec.kotobaModel, { withFileTypes: true }))
    if (e.isFile() || e.isSymbolicLink())
      identities.push(await bind(path.join(spec.kotobaModel, e.name)));
  assert(
    identities.some((f) => f.path === path.join(spec.kotobaModel, "model.bin")),
  );
  const software = await Promise.all(
    codeNames.map((n) => bind(path.join(repo, n))),
  );
  const sourceFiles = await Promise.all(
    ["audio.wav", "bounded-plan.json", "mapped-records.json"].map((n) =>
      bind(path.join(spec.task, n)),
    ),
  );
  if (spec.candidate)
    sourceFiles.push(
      await bind(path.join(spec.candidate, "machine-freeze.json")),
      await bind(path.join(spec.candidate, "candidate-records.json")),
    );
  await fs.mkdir(outputRoot, { recursive: true });
  const root = await fs.mkdtemp(
    path.join(path.resolve(outputRoot), "speech-support-"),
  );
  const pcm = readPcm(await fs.readFile(path.join(spec.task, "audio.wav")));
  assert.equal(pcm.sampleRate, 16000);
  for (const r of regions) {
    r.cropStart = Math.round(r.cropStart * 16000) / 16000;
    r.cropEnd = Math.round(r.cropEnd * 16000) / 16000;
    const dir = path.join(root, r.id);
    await fs.mkdir(dir);
    await fs.writeFile(
      path.join(dir, "vad.wav"),
      slicePcm(
        pcm,
        Math.round((r.cropStart - state.plan.audioOffset) * 16000),
        Math.round((r.cropEnd - state.plan.audioOffset) * 16000),
      ),
      { flag: "wx" },
    );
    r.wavHash = await fileHash(path.join(dir, "vad.wav"));
  }
  await put(root, "baseline-records.json", rows);
  await put(root, "plan.json", {
    version: speechSupportPolicy.version,
    policy: speechSupportPolicy,
    spec,
    config: state.config,
    duration: state.duration,
    audioOffset: state.plan.audioOffset,
    regions,
    identities,
    software,
    sourceFiles,
    referenceUsed: false,
  });
  await put(root, "plan-freeze.json", {
    planHash: await fileHash(path.join(root, "plan.json")),
    baselineHash: await fileHash(path.join(root, "baseline-records.json")),
  });
  return { root, regions };
}
async function load(root) {
  const p = await json(path.join(root, "plan.json")),
    f = await json(path.join(root, "plan-freeze.json"));
  assert.equal(await fileHash(path.join(root, "plan.json")), f.planHash);
  assert.equal(
    await fileHash(path.join(root, "baseline-records.json")),
    f.baselineHash,
  );
  assert.deepEqual(p.policy, speechSupportPolicy);
  await checkFiles(p.software);
  await checkFiles(p.sourceFiles);
  assert(
    p.regions.length <= 4 &&
      p.regions.reduce((s, r) => s + r.cropEnd - r.cropStart, 0) <= 120,
  );
  for (const r of p.regions)
    assert.equal(await fileHash(path.join(root, r.id, "vad.wav")), r.wavHash);
  return p;
}
async function dispatch(runner, exe, args, root, name) {
  await put(root, `${name}-dispatch.json`, {
    executable: exe,
    args,
    at: new Date().toISOString(),
  });
  const result = await runner.run(exe, args, { cwd: root, timeoutMs: 180000 });
  await fs.writeFile(
    path.join(root, `${name}.stdout.log`),
    result.stdout ?? "",
    { flag: "wx" },
  );
  await fs.writeFile(
    path.join(root, `${name}.stderr.log`),
    result.stderr ?? "",
    { flag: "wx" },
  );
  await put(root, `${name}-exit.json`, {
    exitCode: result.exitCode,
    signal: result.signal ?? null,
  });
  if (result.exitCode !== 0) throw Error(`${name}_FAILED_NO_RETRY`);
  return result;
}
function mapped(srt, rawHash, r, duration) {
  return mapRaw(
    srt,
    rawHash,
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
    duration,
    r.id,
  );
}
async function viewsFor(root, probes, duration) {
  const views = [];
  for (const r of probes) {
    const dir = path.join(root, r.id),
      raw = await fs.readFile(path.join(dir, "whisper.srt"), "utf8");
    const primary = mapped(
      raw,
      await fileHash(path.join(dir, "whisper.srt")),
      r,
      duration,
    );
    const kotoba = await json(path.join(dir, "kotoba-raw.json"));
    const secondary = kotoba.segments.map((s, i) => ({
      recordId: `${r.id}-kotoba-${i}`,
      text: s.text.trim(),
      sourceStart: r.start + s.start,
      sourceEnd: r.start + s.end,
      issues: [],
    }));
    views.push(
      {
        targetId: r.id,
        backend: "whisper",
        records: primary,
        unresolvedCount: primary.filter((row) => row.issues.length).length,
      },
      {
        targetId: r.id,
        backend: "kotoba",
        records: secondary,
        unresolvedCount: secondary.filter(
          (row) =>
            !Number.isFinite(row.sourceStart) ||
            !Number.isFinite(row.sourceEnd) ||
            row.sourceStart < r.start ||
            row.sourceEnd <= row.sourceStart ||
            row.sourceEnd > r.end,
        ).length,
      },
    );
  }
  return views;
}
export async function executeSpeech(
  root,
  { authorize = false, runner = new EvidenceRunner() } = {},
) {
  const p = await load(root);
  if (!authorize) throw Error("AUTHORIZE_LOCAL_REQUIRED");
  await checkFiles(p.identities);
  // A fresh exclusive reservation is required before any model load. Never unlink it to retry.
  await put(root, "execution-reservation.json", {
    maxVad: 4,
    maxAsr: 8,
    maxVadSeconds: 120,
    maxAsrSeconds: 64,
    retries: 0,
  });
  const analyses = [];
  for (const region of p.regions) {
    const dir = path.join(root, region.id);
    await put(dir, "vad-request.json", {
      authorized: true,
      dispatchReserved: true,
      audioPath: path.join(dir, "vad.wav"),
      model: p.spec.vadModel,
      library: p.spec.vadLibrary,
      receiptPath: path.join(dir, "vad-phases.jsonl"),
      profile: {
        threshold: 0.5,
        minSpeechMs: 150,
        minSilenceMs: 100,
        maxSpeechSeconds: 30,
        speechPadMs: 0,
        samplesOverlap: 0,
      },
    });
    console.log(`VAD ${region.id} ${region.cropStart}–${region.cropEnd}`);
    const result = await dispatch(
      runner,
      p.spec.python,
      [
        path.join(repo, "scripts/runtime/bounded_silero.py"),
        "--request",
        path.join(dir, "vad-request.json"),
      ],
      dir,
      "vad",
    );
    const raw = JSON.parse(result.stdout);
    await put(dir, "vad-raw.json", raw);
    analyses.push(planSpeechProbes(region, raw, p.duration));
  }
  await put(root, "speech-analysis.json", analyses);
  const pcm = readPcm(
    await fs.readFile(
      p.sourceFiles.find((f) => path.basename(f.path) === "audio.wav").path,
    ),
  );
  const probes = analyses.flatMap((a) => (a.probe ? [a.probe] : []));
  assert(
    probes.length * 2 <= 8 &&
      probes.reduce((s, r) => s + 2 * (r.end - r.start), 0) <= 64,
  );
  for (const r of probes) {
    r.start = Math.round(r.start * 16000) / 16000;
    r.end = Math.round(r.end * 16000) / 16000;
    r.frames = Math.round((r.end - r.start) * 16000);
    const wav = path.join(root, r.id, "input.wav");
    await fs.writeFile(
      wav,
      slicePcm(
        pcm,
        Math.round((r.start - p.audioOffset) * 16000),
        Math.round((r.end - p.audioOffset) * 16000),
      ),
      { flag: "wx" },
    );
    r.wavHash = await fileHash(wav);
  }
  await put(root, "asr-plan.json", {
    probes,
    model: p.spec.kotobaModel,
    referenceUsed: false,
  });
  await put(root, "asr-plan-freeze.json", {
    sha256: await fileHash(path.join(root, "asr-plan.json")),
  });
  for (const r of probes) {
    const dir = path.join(root, r.id);
    console.log(`ASR whisper ${r.id} ${r.start}–${r.end}`);
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
  if (probes.length)
    await dispatch(
      runner,
      p.spec.python,
      [path.join(repo, "scripts/runtime/speech_support_kotoba.py"), root],
      root,
      "kotoba",
    );
  const views = await viewsFor(root, probes, p.duration),
    baseline = await json(path.join(root, "baseline-records.json"));
  const decisions = probes.map((r) =>
    decideSpeechProbe(
      r,
      baseline,
      views.filter((v) => v.targetId === r.id),
    ),
  );
  const candidate = assembleSpeechProposals(baseline, decisions);
  await put(root, "views.json", views);
  await put(root, "decisions.json", decisions);
  await put(root, "candidate-records.json", candidate);
  const serialized = serializeRecords(candidate, "ja");
  for (const [ext, content] of Object.entries(serialized.files)) {
    const file = path.join(root, `speech-support.machine-candidate.${ext}`);
    await fs.writeFile(file, content, { flag: "wx" });
    assert.deepEqual(
      formats[ext]
        .parse(await fs.readFile(file, "utf8"))
        .map((r) => [r.start, r.end, r.text]),
      serialized.cues.map((r) => [r.start, r.end, r.text]),
    );
  }
  await load(root);
  await checkFiles(p.identities);
  await put(root, "machine-freeze.json", {
    at: new Date().toISOString(),
    files: await inventory(root),
    vadPasses: p.regions.length,
    asrRequests: probes.length * 2,
    vadSeconds: p.regions.reduce((s, r) => s + r.cropEnd - r.cropStart, 0),
    asrSeconds: probes.reduce((s, r) => s + (2 * r.frames) / 16000, 0),
    qualityStatus: "needs-review",
    finalizationMethod: "none",
    humanValidated: false,
    referenceUsed: false,
  });
  return verifySpeech(root);
}
export async function verifySpeech(root) {
  const f = await json(path.join(root, "machine-freeze.json"));
  await checkInventory(root, f.files);
  const p = await load(root);
  const a = [];
  for (const r of p.regions)
    a.push(
      planSpeechProbes(
        r,
        await json(path.join(root, r.id, "vad-raw.json")),
        p.duration,
      ),
    );
  assert.deepEqual(a, await json(path.join(root, "speech-analysis.json")));
  const probes = (await json(path.join(root, "asr-plan.json"))).probes;
  const rawProbes = a.flatMap((v) => (v.probe ? [v.probe] : []));
  assert.equal(rawProbes.length, probes.length);
  for (const [i, r] of probes.entries()) {
    const { wavHash, frames, ...identity } = r;
    assert.deepEqual(identity, {
      ...rawProbes[i],
      start: Math.round(rawProbes[i].start * 16000) / 16000,
      end: Math.round(rawProbes[i].end * 16000) / 16000,
    });
    assert.equal(await fileHash(path.join(root, r.id, "input.wav")), wavHash);
    assert.equal(frames, Math.round((r.end - r.start) * 16000));
  }
  const views = await viewsFor(root, probes, p.duration);
  assert.deepEqual(views, await json(path.join(root, "views.json")));
  const baseline = await json(path.join(root, "baseline-records.json")),
    decisions = probes.map((r) =>
      decideSpeechProbe(
        r,
        baseline,
        views.filter((v) => v.targetId === r.id),
      ),
    );
  assert.deepEqual(decisions, await json(path.join(root, "decisions.json")));
  assert.deepEqual(
    assembleSpeechProposals(baseline, decisions),
    await json(path.join(root, "candidate-records.json")),
  );
  return {
    root,
    integrity: "passed",
    newInference: 0,
    recordedVadPasses: f.vadPasses,
    recordedAsrRequests: f.asrRequests,
    changedTargets: decisions.filter((d) => d.status === "CANDIDATE").length,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const [command, input, output] = process.argv.slice(2);
    if (command === "prepare")
      console.log(
        JSON.stringify(await prepareSpeech(await json(input), output), null, 2),
      );
    else if (command === "run")
      console.log(
        JSON.stringify(
          await executeSpeech(input, {
            authorize: output === "--authorize-local",
          }),
          null,
          2,
        ),
      );
    else if (command === "verify")
      console.log(JSON.stringify(await verifySpeech(input), null, 2));
    else
      throw Error(
        "Usage: prepare SPEC OUTPUT | run ROOT --authorize-local | verify ROOT",
      );
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  }
}
