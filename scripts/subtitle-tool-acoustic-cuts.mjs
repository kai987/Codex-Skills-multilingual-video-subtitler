/** One local VAD pass; no ASR, alignment, human reference or subtitle mutation. */
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { readPcm, slicePcm, durable } from "./lib/bounded-asr-ab.mjs";
import { verifyCoverageAudit } from "./subtitle-tool-alignment-coverage.mjs";
import {
  cutPolicy,
  cutSearchWindow,
  inspectCuts,
} from "./lib/acoustic-cut-probe.mjs";
const repo = path.resolve(import.meta.dirname, ".."),
  json = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const put = (r, n, v) => durable(path.join(r, n), v, true);
const bind = async (p) => ({ path: p, sha256: await fileHash(p) });
const worker = path.join(repo, "scripts/runtime/bounded_silero.py");
async function check(bindings) {
  for (const b of bindings)
    assert.equal(await fileHash(b.path), b.sha256, `CHANGED:${b.path}`);
}
async function inputs(parent) {
  await verifyCoverageAudit(parent);
  const f = await json(path.join(parent, "audit-freeze.json"));
  const wp = await json(path.join(f.parent, "plan.json"));
  const cp = await json(path.join(wp.parent, "plan.json"));
  const base = await json(path.join(wp.parent, "baseline-records.json"));
  const sp = await json(path.join(cp.parent, "plan.json"));
  const vp = await json(path.join(sp.parent, "plan.json"));
  return {
    wp,
    cp,
    base,
    storedVadRegions: vp.regions.map((r) => ({
      id: r.id,
      start: r.cropStart,
      end: r.cropEnd,
    })),
  };
}
export async function prepareCuts(parent, output) {
  parent = path.resolve(parent);
  output = path.resolve(output);
  const { wp, cp, base, storedVadRegions } = await inputs(parent);
  for (const old of [parent, wp.parent, cp.parent])
    assert(
      output !== old && !output.startsWith(old + path.sep),
      "OUTPUT_INSIDE_INPUT",
    );
  const window = cutSearchWindow(wp.windows, cp.audioOffset, cp.duration);
  const pcm = readPcm(await fs.readFile(cp.audio.path));
  assert.equal(pcm.sampleRate, 16000);
  await fs.mkdir(output, { recursive: true });
  const root = await fs.mkdtemp(path.join(output, "cuts-"));
  const begin = Math.round((window.start - cp.audioOffset) * 16000);
  await fs.writeFile(
    path.join(root, "input.wav"),
    slicePcm(pcm, begin, begin + window.frames),
    { flag: "wx" },
  );
  const bindings = await Promise.all(
    [
      path.join(parent, "audit-freeze.json"),
      cp.audio.path,
      cp.spec.python,
      cp.spec.vadModel,
      cp.spec.vadLibrary,
      worker,
      path.join(repo, "scripts/runtime/c601141_speech_activity_worker.py"),
      path.join(repo, "scripts/subtitle-tool-acoustic-cuts.mjs"),
      path.join(repo, "scripts/lib/acoustic-cut-probe.mjs"),
    ].map(bind),
  );
  await put(root, "plan.json", {
    parent,
    policy: cutPolicy,
    window,
    audio: cp.audio,
    offset: cp.audioOffset,
    spec: {
      python: cp.spec.python,
      model: cp.spec.vadModel,
      library: cp.spec.vadLibrary,
    },
    bindings,
    inputHash: await fileHash(path.join(root, "input.wav")),
    targets: base.filter((r) => wp.recordIds.includes(r.recordId)),
    baseline: base.filter(
      (r) => r.sourceStart < window.end && r.sourceEnd > window.start,
    ),
    storedVadRegions,
    humanReferenceUsed: false,
  });
  await put(root, "plan-freeze.json", {
    planHash: await fileHash(path.join(root, "plan.json")),
  });
  return { root, window, vadRequests: 1, asrRequests: 0, alignmentRequests: 0 };
}
async function load(root) {
  const f = await json(path.join(root, "plan-freeze.json"));
  assert.equal(await fileHash(path.join(root, "plan.json")), f.planHash);
  const p = await json(path.join(root, "plan.json"));
  assert.deepEqual(p.policy, cutPolicy);
  await check(p.bindings);
  const { wp, cp, base, storedVadRegions } = await inputs(p.parent);
  assert.deepEqual(
    p.window,
    cutSearchWindow(wp.windows, cp.audioOffset, cp.duration),
  );
  assert.deepEqual(
    p.targets,
    base.filter((r) => wp.recordIds.includes(r.recordId)),
  );
  assert.deepEqual(
    p.baseline,
    base.filter(
      (r) => r.sourceStart < p.window.end && r.sourceEnd > p.window.start,
    ),
  );
  assert.deepEqual(p.storedVadRegions, storedVadRegions);
  assert.deepEqual(p.audio, cp.audio);
  assert.equal(p.offset, cp.audioOffset);
  assert.deepEqual(p.spec, {
    python: cp.spec.python,
    model: cp.spec.vadModel,
    library: cp.spec.vadLibrary,
  });
  assert.equal(await fileHash(path.join(root, "input.wav")), p.inputHash);
  const pcm = readPcm(await fs.readFile(p.audio.path));
  const begin = Math.round((p.window.start - p.offset) * 16000);
  assert.deepEqual(
    await fs.readFile(path.join(root, "input.wav")),
    slicePcm(pcm, begin, begin + p.window.frames),
  );
  return p;
}
export async function runCuts(root, authorize) {
  const p = await load(root);
  assert(authorize === true, "AUTHORIZE_LOCAL_REQUIRED");
  await put(root, "execution-reservation.json", {
    vadRequests: 1,
    seconds: p.window.frames / 16000,
    asrRequests: 0,
    alignmentRequests: 0,
    retries: 0,
  });
  await put(root, "request.json", {
    authorized: true,
    dispatchReserved: true,
    audioPath: path.join(root, "input.wav"),
    model: p.spec.model,
    library: p.spec.library,
    receiptPath: path.join(root, "phases.jsonl"),
    profile: {
      threshold: 0.5,
      minSpeechMs: 150,
      minSilenceMs: 100,
      maxSpeechSeconds: 30,
      speechPadMs: 0,
      samplesOverlap: 0,
    },
  });
  const args = [worker, "--request", path.join(root, "request.json")];
  await put(root, "dispatch.json", { executable: p.spec.python, args });
  const result = spawnSync(p.spec.python, args, {
    encoding: "utf8",
    timeout: 60000,
    maxBuffer: 4000000,
    env: {
      PATH: process.env.PATH,
      HF_HUB_OFFLINE: "1",
      TRANSFORMERS_OFFLINE: "1",
    },
  });
  await fs.writeFile(path.join(root, "stdout.log"), result.stdout ?? "", {
    flag: "wx",
  });
  await fs.writeFile(path.join(root, "stderr.log"), result.stderr ?? "", {
    flag: "wx",
  });
  await put(root, "exit.json", {
    code: result.status,
    error: result.error?.message ?? null,
  });
  assert.equal(result.status, 0, "VAD_FAILED_NO_RETRY");
  return finishCuts(root);
}
async function replay(root) {
  const p = await load(root);
  assert.equal((await json(path.join(root, "exit.json"))).code, 0);
  assert.deepEqual(await json(path.join(root, "execution-reservation.json")), {
    vadRequests: 1,
    seconds: p.window.frames / 16000,
    asrRequests: 0,
    alignmentRequests: 0,
    retries: 0,
  });
  const raw = JSON.parse(
    await fs.readFile(path.join(root, "stdout.log"), "utf8"),
  );
  assert.equal(raw.modelLoadCount, 1);
  assert.equal(raw.inferencePasses, 1);
  assert.match(
    await fs.readFile(path.join(root, "stderr.log"), "utf8"),
    /n_window: 512\b/u,
  );
  const phases = (await fs.readFile(path.join(root, "phases.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l).phase);
  assert.deepEqual(phases, [
    "backend-registration-started",
    "model-initialization-started",
    "model-loaded",
    "inference-pass-reserved",
    "inference-pass-completed",
  ]);
  return {
    raw,
    analysis: inspectCuts(
      readPcm(await fs.readFile(path.join(root, "input.wav"))),
      raw,
      p.window,
      p.targets,
      p.baseline,
    ),
  };
}
export async function finishCuts(root) {
  try {
    await fs.stat(path.join(root, "machine-freeze.json"));
    return verifyCuts(root);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const result = await replay(root);
  for (const [name, value] of [
    ["vad-raw.json", result.raw],
    ["cut-analysis.json", result.analysis],
  ]) {
    try {
      assert.deepEqual(await json(path.join(root, name)), value);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      await put(root, name, value);
    }
  }
  const files = {};
  for (const n of await fs.readdir(root))
    files[n] = await fileHash(path.join(root, n));
  await put(root, "machine-freeze.json", {
    files,
    vadRequests: 1,
    asrRequests: 0,
    alignmentRequests: 0,
    canonicalMutation: 0,
  });
  return verifyCuts(root);
}
export async function verifyCuts(root) {
  const f = await json(path.join(root, "machine-freeze.json"));
  for (const [n, h] of Object.entries(f.files)) {
    assert.equal(path.basename(n), n);
    assert.equal(await fileHash(path.join(root, n)), h);
  }
  const r = await replay(root);
  assert.deepEqual(
    await json(path.join(root, "cut-analysis.json")),
    r.analysis,
  );
  assert.deepEqual(await json(path.join(root, "vad-raw.json")), r.raw);
  return {
    root,
    integrity: "passed",
    recordedVadRequests: 1,
    newInference: 0,
    status: r.analysis.status,
    quietSpans: r.analysis.quietSpans,
    pair: r.analysis.pair,
    subtitleMutationAuthorized: false,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const [cmd, a, b] = process.argv.slice(2);
    assert(a, "INPUT_REQUIRED");
    assert(["prepare", "run", "finish", "verify"].includes(cmd));
    console.log(
      JSON.stringify(
        await {
          prepare: () => {
            assert(b);
            return prepareCuts(a, b);
          },
          run: () => runCuts(a, b === "--authorize-local"),
          finish: () => finishCuts(a),
          verify: () => verifyCuts(a),
        }[cmd](),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
