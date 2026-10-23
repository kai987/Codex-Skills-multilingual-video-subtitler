/** Replay stored VAD, then make a bounded fresh ASR acquisition plan. No reference access. */
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { verifySpeech } from "./subtitle-tool-speech-support.mjs";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
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
  softSpeechPolicy,
  planSoftProbes,
  decideSoftProbe,
  assembleSoftProbes,
} from "./lib/soft-speech-probes.mjs";
const repo = path.resolve(import.meta.dirname, ".."),
  json = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const put = (root, name, value) => durable(path.join(root, name), value, true);
const bind = async (p) => ({
  path: path.resolve(p),
  sha256: await fileHash(p),
});
async function check(files) {
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
async function parentInputs(parent) {
  await verifySpeech(parent);
  const p = await json(path.join(parent, "plan.json")),
    analyses = await json(path.join(parent, "speech-analysis.json")),
    raw = [];
  for (const r of p.regions) {
    const v = await json(path.join(parent, r.id, "vad-raw.json")),
      log = await fs.readFile(
        path.join(parent, r.id, "vad.stderr.log"),
        "utf8",
      );
    if (!/n_window: 512\b/u.test(log))
      throw Error("UNVERIFIED_POSTERIOR_BIN_GEOMETRY");
    raw.push(v);
  }
  return { p, analyses, raw };
}
export async function prepareSoftSpeech(parent, outputRoot) {
  parent = path.resolve(parent);
  outputRoot = path.resolve(outputRoot);
  const { p, analyses, raw } = await parentInputs(parent);
  for (const old of [parent, p.spec.task, p.spec.candidate].filter(Boolean))
    if (
      outputRoot === path.resolve(old) ||
      outputRoot.startsWith(path.resolve(old) + path.sep)
    )
      throw Error("OUTPUT_INSIDE_BASELINE");
  const probes = planSoftProbes(
    p.regions,
    analyses,
    raw,
    p.duration,
    p.audioOffset,
  );
  const audio = p.sourceFiles.find(
    (f) => path.basename(f.path) === "audio.wav",
  );
  await check([audio]);
  const pcm = readPcm(await fs.readFile(audio.path));
  assert.equal(pcm.sampleRate, 16000);
  await fs.mkdir(outputRoot, { recursive: true });
  const root = await fs.mkdtemp(path.join(outputRoot, "soft-speech-"));
  for (const r of probes) {
    const dir = path.join(root, r.id);
    await fs.mkdir(dir);
    const start = Math.round((r.start - p.audioOffset) * 16000);
    await fs.writeFile(
      path.join(dir, "input.wav"),
      slicePcm(pcm, start, start + r.frames),
      { flag: "wx" },
    );
    r.wavHash = await fileHash(path.join(dir, "input.wav"));
  }
  const software = await Promise.all(
    [
      "scripts/subtitle-tool-soft-speech.mjs",
      "scripts/lib/soft-speech-probes.mjs",
      "scripts/runtime/speech_support_kotoba.py",
      "scripts/lib/bounded-asr-ab.mjs",
      "packages/video-subtitler/dist/standalone/bounded.js",
      "packages/subtitle-core/dist/parse.js",
      "packages/subtitle-core/dist/format.js",
    ].map((n) => bind(path.join(repo, n))),
  );
  await put(
    root,
    "baseline-records.json",
    await json(path.join(parent, "candidate-records.json")),
  );
  await put(root, "plan.json", {
    version: softSpeechPolicy.version,
    policy: softSpeechPolicy,
    parent,
    parentFreezeHash: await fileHash(path.join(parent, "machine-freeze.json")),
    duration: p.duration,
    audioOffset: p.audioOffset,
    config: p.config,
    spec: p.spec,
    identities: p.identities,
    software,
    probes,
    referenceUsed: false,
  });
  await put(root, "asr-plan.json", {
    probes,
    model: p.spec.kotobaModel,
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
    requests: probes.length * 2,
    audioSeconds: probes.reduce((s, r) => s + (2 * r.frames) / 16000, 0),
    probes,
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
  assert.deepEqual(p.policy, softSpeechPolicy);
  const parent = await parentInputs(p.parent),
    planned = planSoftProbes(
      parent.p.regions,
      parent.analyses,
      parent.raw,
      p.duration,
      p.audioOffset,
    );
  assert.deepEqual(
    await json(path.join(root, "baseline-records.json")),
    await json(path.join(p.parent, "candidate-records.json")),
  );
  assert.equal(p.probes.length, planned.length);
  const pcm = readPcm(
    await fs.readFile(
      parent.p.sourceFiles.find((f) => path.basename(f.path) === "audio.wav")
        .path,
    ),
  );
  for (const [i, r] of p.probes.entries()) {
    const { wavHash, ...identity } = r;
    assert.deepEqual(identity, planned[i]);
    assert.equal(await fileHash(path.join(root, r.id, "input.wav")), wavHash);
    const start = Math.round((r.start - p.audioOffset) * 16000);
    assert.deepEqual(
      await fs.readFile(path.join(root, r.id, "input.wav")),
      slicePcm(pcm, start, start + r.frames),
    );
  }
  assert.deepEqual(await json(path.join(root, "asr-plan.json")), {
    probes: p.probes,
    model: p.spec.kotobaModel,
    referenceUsed: false,
  });
  assert.equal(
    await fileHash(path.join(root, "asr-plan.json")),
    (await json(path.join(root, "asr-plan-freeze.json"))).sha256,
  );
  return p;
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
  if (r.exitCode !== 0) throw Error(`${name}_FAILED_NO_RETRY`);
}
async function readViews(root, p) {
  const result = [];
  for (const r of p.probes) {
    const dir = path.join(root, r.id),
      raw = await fs.readFile(path.join(dir, "whisper.srt"), "utf8");
    const primary = mapRaw(
      raw,
      await fileHash(path.join(dir, "whisper.srt")),
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
    const k = await json(path.join(dir, "kotoba-raw.json"));
    const secondary = k.segments.map((s, i) => ({
      recordId: `${r.id}-kotoba-${i}`,
      text: s.text.trim(),
      sourceStart: r.start + s.start,
      sourceEnd: r.start + s.end,
      issues: [],
    }));
    result.push(
      {
        targetId: r.id,
        backend: "whisper",
        records: primary,
        unresolvedCount: primary.filter((c) => c.issues.length).length,
      },
      {
        targetId: r.id,
        backend: "kotoba",
        records: secondary,
        unresolvedCount: secondary.filter(
          (c) =>
            !Number.isFinite(c.sourceStart) ||
            !Number.isFinite(c.sourceEnd) ||
            c.sourceStart < r.start ||
            c.sourceEnd <= c.sourceStart ||
            c.sourceEnd > r.end,
        ).length,
      },
    );
  }
  return result;
}
async function exportCues(root, name, rows) {
  const s = serializeRecords(rows, "ja");
  for (const [ext, content] of Object.entries(s.files)) {
    const file = path.join(root, `${name}.${ext}`);
    await fs.writeFile(file, content, { flag: "wx" });
    assert.deepEqual(
      formats[ext]
        .parse(await fs.readFile(file, "utf8"))
        .map((r) => [r.start, r.end, r.text]),
      s.cues.map((r) => [r.start, r.end, r.text]),
    );
  }
}
export async function runSoftSpeech(
  root,
  { authorize = false, runner = new EvidenceRunner() } = {},
) {
  const p = await load(root);
  if (!authorize) throw Error("EXPLICIT_LOCAL_ASR_REQUIRED");
  await check(p.identities);
  await put(root, "execution-reservation.json", {
    at: new Date().toISOString(),
    requests: p.probes.length * 2,
    audioSeconds: p.probes.reduce((s, r) => s + (2 * r.frames) / 16000, 0),
    retries: 0,
  });
  for (const r of p.probes) {
    const dir = path.join(root, r.id);
    console.log(`whisper ${r.id} ${r.start}–${r.end}`);
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
  if (p.probes.length)
    await dispatch(
      runner,
      p.spec.python,
      [path.join(repo, "scripts/runtime/speech_support_kotoba.py"), root],
      root,
      "kotoba",
    );
  const views = await readViews(root, p),
    baseline = await json(path.join(root, "baseline-records.json"));
  const decisions = p.probes.map((r) =>
      decideSoftProbe(
        r,
        baseline,
        views.filter((v) => v.targetId === r.id),
      ),
    ),
    candidate = assembleSoftProbes(baseline, decisions);
  await put(root, "views.json", views);
  await put(root, "decisions.json", decisions);
  await put(root, "candidate-records.json", candidate);
  await exportCues(root, "soft-speech.machine-candidate", candidate);
  for (const v of views)
    if (v.unresolvedCount === 0 && v.records.length)
      await exportCues(
        path.join(root, v.targetId),
        `${v.backend}.diagnostic`,
        v.records,
      );
  await load(root);
  await check(p.identities);
  await put(root, "machine-freeze.json", {
    at: new Date().toISOString(),
    files: await inventory(root),
    newVadPasses: 0,
    asrRequests: p.probes.length * 2,
    audioSeconds: p.probes.reduce((s, r) => s + (2 * r.frames) / 16000, 0),
    qualityStatus: "needs-review",
    finalizationMethod: "none",
    humanValidated: false,
    referenceUsed: false,
  });
  return verifySoftSpeech(root);
}
export async function verifySoftSpeech(root) {
  const f = await json(path.join(root, "machine-freeze.json"));
  for (const [n, h] of Object.entries(f.files)) {
    if (path.isAbsolute(n) || n.split(/[\\/]/u).includes(".."))
      throw Error("UNSAFE_PATH");
    assert.equal(await fileHash(path.join(root, n)), h, `CHANGED:${n}`);
  }
  const p = await load(root),
    views = await readViews(root, p),
    baseline = await json(path.join(root, "baseline-records.json"));
  assert.deepEqual(views, await json(path.join(root, "views.json")));
  const decisions = p.probes.map((r) =>
    decideSoftProbe(
      r,
      baseline,
      views.filter((v) => v.targetId === r.id),
    ),
  );
  assert.deepEqual(decisions, await json(path.join(root, "decisions.json")));
  assert.deepEqual(
    assembleSoftProbes(baseline, decisions),
    await json(path.join(root, "candidate-records.json")),
  );
  assert.equal(f.asrRequests, p.probes.length * 2);
  return {
    root,
    integrity: "passed",
    newInference: 0,
    recordedAsrRequests: f.asrRequests,
    changedTargets: decisions.filter((d) => d.status === "CANDIDATE").length,
    reviewProposals: decisions.filter((d) => d.status === "REVIEW_CANDIDATE")
      .length,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const [cmd, input, output] = process.argv.slice(2);
    if (cmd === "prepare")
      console.log(
        JSON.stringify(await prepareSoftSpeech(input, output), null, 2),
      );
    else if (cmd === "run")
      console.log(
        JSON.stringify(
          await runSoftSpeech(input, {
            authorize: output === "--authorize-local",
          }),
          null,
          2,
        ),
      );
    else if (cmd === "verify")
      console.log(JSON.stringify(await verifySoftSpeech(input), null, 2));
    else
      throw Error(
        "prepare PARENT OUTPUT | run ROOT --authorize-local | verify ROOT",
      );
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  }
}
