/** Explicit bounded ASR on frozen machine-selected VAD targets. No Gold imports. */
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { safePath } from "../packages/video-subtitler/dist/standalone/recovery.js";
import { parseSrt } from "../packages/subtitle-core/dist/parse.js";
import { formatSrt, formatAss } from "../packages/subtitle-core/dist/format.js";
import { EvidenceRunner, slicePcm } from "./lib/bounded-asr-ab.mjs";
import {
  loadAudioCoverageInputs,
  verifyAudioCoverage,
} from "./lib/audio-coverage-delivery.mjs";
import { verifyVadTriage } from "./subtitle-tool-vad-triage.mjs";
import { verifyListeningVad } from "./subtitle-tool-listening-vad.mjs";
import {
  localRecoveryPolicy,
  planLocalRecovery,
  decideLocalRecovery,
  assembleLocalRecovery,
} from "./lib/vad-local-recovery.mjs";

const repo = path.resolve(import.meta.dirname, "..");
const json = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const put = (p, value) =>
  fs.writeFile(p, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
const bind = async (file) => ({
  file: await fs.realpath(file),
  sha256: await fileHash(file),
});
const worker = path.join(repo, "scripts/runtime/speech_support_kotoba.py");
async function inventory(root) {
  const files = {};
  for (const e of await fs.readdir(root, { withFileTypes: true })) {
    assert(!e.isSymbolicLink(), "SYMLINK_OUTPUT");
    if (e.isDirectory())
      for (const [n, h] of Object.entries(
        await inventory(path.join(root, e.name)),
      ))
        files[`${e.name}/${n}`] = h;
    else files[e.name] = await fileHash(path.join(root, e.name));
  }
  return files;
}
async function checkInventory(root, files) {
  for (const [n, h] of Object.entries(files)) {
    assert(
      !path.isAbsolute(n) && !n.split(/[\\/]/u).includes(".."),
      "UNSAFE_PATH",
    );
    await safePath(path.join(root, n));
    assert.equal(await fileHash(path.join(root, n)), h, `CHANGED:${n}`);
  }
}
async function sources(spec) {
  await verifyVadTriage(spec.triage);
  const tf = await json(path.join(spec.triage, "triage-freeze.json"));
  const vad = await verifyListeningVad(tf.sourceRoot);
  const manifest = await json(
    path.join(vad.plan.listeningRoot, "listening-manifest.json"),
  );
  const audit = await verifyAudioCoverage(manifest.source);
  assert.equal(
    await fileHash(path.join(manifest.source, "audio-coverage-freeze.json")),
    manifest.sourceFreezeHash,
    "LISTENING_SOURCE_CHANGED",
  );
  assert.equal(path.resolve(audit.task), path.resolve(spec.task), "WRONG_TASK");
  assert.equal(
    path.resolve(audit.subtitlePath),
    path.resolve(spec.subtitle),
    "WRONG_SUBTITLE",
  );
  const loaded = await loadAudioCoverageInputs(spec.task, spec.subtitle);
  assert.equal(loaded.plan.audioOffset, 0, "FULL_SOURCE_REQUIRED");
  const duration = loaded.pcm.frames / 16000;
  for (const c of vad.plan.items) {
    const first = Math.round(c.start * 16000);
    assert.deepEqual(
      await fs.readFile(c.audioPath),
      slicePcm(loaded.pcm, first, first + c.frames),
      "VAD_SOURCE_AUDIO_MISMATCH",
    );
  }
  const triage = await json(path.join(spec.triage, "triage.json"));
  return {
    ...loaded,
    duration,
    vad,
    triage,
    vadRoot: tf.sourceRoot,
    selected: planLocalRecovery(triage, loaded.records, duration),
  };
}

export async function prepareRecovery(spec, outputParent) {
  outputParent = path.resolve(outputParent);
  await safePath(outputParent, true);
  const s = await sources(spec);
  for (const input of [
    spec.task,
    path.dirname(spec.subtitle),
    spec.triage,
    s.vadRoot,
    s.vad.plan.listeningRoot,
  ])
    assert(
      outputParent !== path.resolve(input) &&
        !outputParent.startsWith(path.resolve(input) + path.sep),
      "OUTPUT_INSIDE_INPUT",
    );
  const identities = await Promise.all(
    [spec.python, s.plan.config.model, s.plan.config.runtime].map(bind),
  );
  for (const e of await fs.readdir(spec.kotobaModel, { withFileTypes: true }))
    if (e.isFile() || e.isSymbolicLink())
      identities.push(await bind(path.join(spec.kotobaModel, e.name)));
  assert(
    identities.some(
      (b) => path.basename(b.file) === "model.bin" || b.file.includes("blobs"),
    ),
    "KOTOBA_IDENTITY",
  );
  const software = await Promise.all(
    [
      "scripts/subtitle-tool-vad-local-recovery.mjs",
      "scripts/lib/vad-local-recovery.mjs",
      "scripts/lib/speech-support-policy.mjs",
      "scripts/runtime/speech_support_kotoba.py",
      "scripts/lib/bounded-asr-ab.mjs",
      "scripts/lib/audio-coverage-delivery.mjs",
      "packages/subtitle-core/dist/parse.js",
      "packages/subtitle-core/dist/format.js",
      "packages/subtitle-core/dist/time.js",
    ].map((n) => bind(path.join(repo, n))),
  );
  await fs.mkdir(outputParent, { recursive: true });
  const root = await fs.mkdtemp(path.join(outputParent, "local-recovery-"));
  const probes = [];
  for (const p of s.selected.probes) {
    const dir = path.join(root, p.id);
    await fs.mkdir(dir);
    const wav = path.join(dir, "input.wav");
    await fs.writeFile(
      wav,
      slicePcm(
        s.pcm,
        Math.round(p.start * 16000),
        Math.round(p.start * 16000) + p.frames,
      ),
      { flag: "wx" },
    );
    probes.push({ ...p, wavHash: await fileHash(wav) });
  }
  const plan = {
    spec,
    selected: s.selected,
    probes,
    duration: s.duration,
    config: s.plan.config,
    identities,
    software,
    inputs: s.inputs,
    baseline: s.records,
    vadObservations: s.vad.observations,
    sourceFreezes: await Promise.all(
      [
        path.join(spec.triage, "triage-freeze.json"),
        path.join(s.vadRoot, "machine-freeze.json"),
      ].map(bind),
    ),
    referenceUsed: false,
    labelsUsed: false,
  };
  await put(path.join(root, "plan.json"), plan);
  await put(path.join(root, "asr-plan.json"), {
    probes,
    model: spec.kotobaModel,
    referenceUsed: false,
  });
  await put(path.join(root, "asr-plan-freeze.json"), {
    sha256: await fileHash(path.join(root, "asr-plan.json")),
  });
  await put(path.join(root, "plan-freeze.json"), {
    files: await inventory(root),
  });
  return {
    root,
    probes: probes.map(({ id, start, end, hostIds }) => ({
      id,
      start,
      end,
      hostIds,
    })),
    requests: probes.length * 2,
    seconds: probes.reduce((n, p) => n + (p.frames * 2) / 16000, 0),
  };
}
async function load(root) {
  await safePath(root);
  await checkInventory(
    root,
    (await json(path.join(root, "plan-freeze.json"))).files,
  );
  const p = await json(path.join(root, "plan.json"));
  assert.deepEqual(p.selected.policy, localRecoveryPolicy);
  for (const b of [
    ...p.inputs,
    ...p.identities,
    ...p.software,
    ...p.sourceFreezes,
  ]) {
    // Model weights can exceed Node's readFile 2 GiB limit; hash as a stream.
    assert.equal(await fileHash(b.file), b.sha256, `INPUT_CHANGED:${b.file}`);
  }
  const s = await sources(p.spec);
  assert.deepEqual(p.selected, s.selected, "SELECTION_CHANGED");
  assert.deepEqual(p.baseline, s.records, "BASELINE_CHANGED");
  assert.deepEqual(p.vadObservations, s.vad.observations, "VAD_CHANGED");
  assert.equal(p.duration, s.duration);
  assert.deepEqual(p.config, s.plan.config);
  assert.deepEqual(
    p.probes.map(({ wavHash, ...r }) => {
      assert(/^[a-f0-9]{64}$/u.test(wavHash), "INVALID_AUDIO_HASH");
      return r;
    }),
    s.selected.probes,
  );
  assert.deepEqual(await json(path.join(root, "asr-plan.json")), {
    probes: p.probes,
    model: p.spec.kotobaModel,
    referenceUsed: false,
  });
  for (const r of p.probes) {
    const wav = path.join(root, r.id, "input.wav");
    assert.equal(await fileHash(wav), r.wavHash);
    assert.deepEqual(
      await fs.readFile(wav),
      slicePcm(
        s.pcm,
        Math.round(r.start * 16000),
        Math.round(r.start * 16000) + r.frames,
      ),
    );
  }
  return p;
}
export async function reserveRecovery(root, p, authorize) {
  assert.equal(authorize, true, "AUTHORIZE_LOCAL_REQUIRED");
  assert(
    p.probes.length > 0 &&
      p.probes.length <= 4 &&
      p.probes.every((r) => r.frames > 0 && r.frames <= 8 * 16000),
    "REQUEST_BUDGET",
  );
  const seconds = p.probes.reduce((n, r) => n + (r.frames * 2) / 16000, 0);
  assert(seconds <= 64, "AUDIO_BUDGET");
  await put(path.join(root, "execution-reservation.json"), {
    requests: p.probes.length * 2,
    seconds,
    retries: 0,
  });
}
async function dispatch(runner, exe, args, dir, name) {
  await put(path.join(dir, `${name}-dispatch.json`), { executable: exe, args });
  const r = await runner.run(exe, args, { cwd: dir, timeoutMs: 300000 });
  await fs.writeFile(path.join(dir, `${name}.stdout.log`), r.stdout ?? "", {
    flag: "wx",
  });
  await fs.writeFile(path.join(dir, `${name}.stderr.log`), r.stderr ?? "", {
    flag: "wx",
  });
  await put(path.join(dir, `${name}-exit.json`), {
    code: r.exitCode,
    signal: r.signal ?? null,
  });
  assert.equal(r.exitCode, 0, `${name}_FAILED_NO_RETRY`);
}
async function replay(root, p) {
  const views = [],
    decisions = [];
  assert.equal((await json(path.join(root, "kotoba-exit.json"))).code, 0);
  assert.equal(
    (await json(path.join(root, "kotoba-runtime.json"))).modelLoadCount,
    1,
  );
  assert.deepEqual(await json(path.join(root, "execution-reservation.json")), {
    requests: p.probes.length * 2,
    seconds: p.probes.reduce((s, r) => s + (r.frames * 2) / 16000, 0),
    retries: 0,
  });
  for (const r of p.probes) {
    const dir = path.join(root, r.id);
    assert.equal((await json(path.join(dir, "whisper-exit.json"))).code, 0);
    assert.equal(
      (await json(path.join(dir, "kotoba-reserved.json"))).wavHash,
      r.wavHash,
    );
    const primary = parseSrt(
      await fs.readFile(path.join(dir, "whisper.srt"), "utf8"),
    );
    const secondary = (await json(path.join(dir, "kotoba-raw.json"))).segments;
    const pair = [
      { backend: "whisper", records: primary },
      { backend: "kotoba", records: secondary },
    ].map((v) => ({
      targetId: r.id,
      backend: v.backend,
      records: v.records.map((c) => ({
        start: r.start + c.start,
        end: r.start + c.end,
        text: c.text.trim(),
      })),
    }));
    views.push(...pair);
    decisions.push(
      decideLocalRecovery(
        r,
        p.baseline,
        pair,
        p.vadObservations.find((v) => v.id === r.id).sourceIntervals,
      ),
    );
  }
  return {
    views,
    decisions,
    candidate: assembleLocalRecovery(p.baseline, decisions),
  };
}
export async function runRecovery(
  root,
  authorize,
  runner = new EvidenceRunner(),
) {
  assert.equal(authorize, true, "AUTHORIZE_LOCAL_REQUIRED");
  const p = await load(root);
  await reserveRecovery(root, p, authorize);
  try {
    for (const r of p.probes) {
      const dir = path.join(root, r.id);
      console.log(`Whisper ${r.id} ${r.start}–${r.end}`);
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
    console.log(`Kotoba batch: ${p.probes.length} requests`);
    await dispatch(runner, p.spec.python, [worker, root], root, "kotoba");
    return await finishRecovery(root);
  } catch (e) {
    await put(path.join(root, "failure.json"), {
      error: e.message,
      retries: 0,
      noAutomaticRerun: true,
    });
    throw e;
  }
}
export async function finishRecovery(root) {
  const p = await load(root),
    result = await replay(root, p);
  // Offline finish is resumable only when existing bytes match; never re-dispatch.
  const writeSame = async (name, content) => {
    const file = path.join(root, name);
    try {
      assert.equal(
        await fs.readFile(file, "utf8"),
        content,
        "PARTIAL_OUTPUT_CHANGED",
      );
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      await fs.writeFile(file, content, { flag: "wx" });
    }
  };
  for (const [n, v] of Object.entries(result))
    await writeSame(`${n}.json`, JSON.stringify(v, null, 2) + "\n");
  const srt = formatSrt(result.candidate);
  assert.deepEqual(
    parseSrt(srt).map((r) => [r.start, r.end, r.text]),
    result.candidate.map((r) => [
      Math.round(r.start * 1000) / 1000,
      Math.round(r.end * 1000) / 1000,
      r.text,
    ]),
    "SRT_ROUNDTRIP",
  );
  await writeSame("local-recovery.machine-candidate.srt", srt);
  await writeSame(
    "local-recovery.machine-candidate.ass",
    formatAss(result.candidate),
  );
  await load(root);
  try {
    await fs.stat(path.join(root, "machine-freeze.json"));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    await put(path.join(root, "machine-freeze.json"), {
      files: await inventory(root),
      recordedAsrRequests: p.probes.length * 2,
      referenceUsed: false,
      labelsUsed: false,
      qualityStatus: "needs-review",
      finalizationMethod: "none",
      humanValidated: false,
      machineOnlyReleaseAuthorized: false,
    });
  }
  return verifyRecovery(root);
}
export async function verifyRecovery(root) {
  const f = await json(path.join(root, "machine-freeze.json"));
  await checkInventory(root, f.files);
  const p = await load(root),
    r = await replay(root, p);
  for (const [n, v] of Object.entries(r))
    assert.deepEqual(await json(path.join(root, `${n}.json`)), v);
  assert.equal(
    await fs.readFile(
      path.join(root, "local-recovery.machine-candidate.srt"),
      "utf8",
    ),
    formatSrt(r.candidate),
  );
  assert.equal(
    await fs.readFile(
      path.join(root, "local-recovery.machine-candidate.ass"),
      "utf8",
    ),
    formatAss(r.candidate),
  );
  return {
    root,
    integrity: "passed",
    recordedAsrRequests: f.recordedAsrRequests,
    newInference: 0,
    inserted: r.candidate.length - p.baseline.length,
    decisions: r.decisions.map(({ id, status, reason }) => ({
      id,
      status,
      reason,
    })),
    qualityStatus: "needs-review",
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const [cmd, a, b] = process.argv.slice(2);
    let result;
    if (cmd === "prepare" && a && b)
      result = await prepareRecovery(await json(a), b);
    else if (cmd === "run" && a)
      result = await runRecovery(a, b === "--authorize-local");
    else if (cmd === "finish" && a) result = await finishRecovery(a);
    else if (cmd === "verify" && a) result = await verifyRecovery(a);
    else
      throw Error(
        "Usage: prepare SPEC OUTPUT | run ROOT --authorize-local | finish ROOT | verify ROOT",
      );
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  }
}
