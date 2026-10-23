/* global AbortController */
/** Explicit bounded seam refinement. No reference input and no default generation changes. */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { statusBounded } from "./lib/bounded-product.mjs";
import {
  durable,
  readPcm,
  slicePcm,
  EvidenceRunner,
} from "./lib/bounded-asr-ab.mjs";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { safePath } from "../packages/video-subtitler/dist/standalone/recovery.js";
import {
  mapRaw,
  serializeRecords,
  formats,
} from "../packages/video-subtitler/dist/standalone/bounded.js";
import {
  planSeams,
  decideSeam,
  assembleSeams,
  seamRefinementPolicy,
} from "./lib/seam-refinement.mjs";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const json = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const put = (root, name, value) => durable(path.join(root, name), value, true);
const exists = (p) =>
  fs.access(p).then(
    () => true,
    (e) => {
      if (e.code === "ENOENT") return false;
      throw e;
    },
  );
async function inventory(root) {
  const files = {};
  for (const e of await fs.readdir(root, { withFileTypes: true })) {
    const p = path.join(root, e.name);
    await safePath(p);
    if (e.isDirectory())
      for (const [n, h] of Object.entries(await inventory(p)))
        files[e.name + "/" + n] = h;
    else files[e.name] = await fileHash(p);
  }
  return files;
}
async function verifyInventory(root, files) {
  for (const [n, h] of Object.entries(files)) {
    if (path.isAbsolute(n) || n.split(/[\\/]/u).includes(".."))
      throw Error("UNSAFE_INVENTORY");
    const p = path.join(root, n);
    await safePath(p);
    assert.equal(await fileHash(p), h, `CHANGED:${n}`);
  }
}
async function software() {
  const names = [
    "scripts/subtitle-tool-refine-seams.mjs",
    "scripts/lib/seam-refinement.mjs",
    "scripts/lib/bounded-product.mjs",
    "scripts/lib/bounded-asr-ab.mjs",
    "packages/video-subtitler/dist/standalone/bounded.js",
    "packages/video-subtitler/dist/standalone/tool.js",
    "packages/video-subtitler/dist/standalone/recovery.js",
    "packages/video-subtitler/dist/standalone/assembly.js",
    "packages/subtitle-core/dist/format.js",
    "packages/subtitle-core/dist/parse.js",
    "package-lock.json",
  ];
  return Object.fromEntries(
    await Promise.all(
      names.map(async (n) => [n, await fileHash(path.join(repo, n))]),
    ),
  );
}
async function baseline(task) {
  const state = await statusBounded(task);
  assert.equal(state.executionStatus, "completed");
  assert.equal(state.coverageScope, "full-audio");
  assert.equal(state.unresolvedCount, 0);
  assert.equal(state.aliasCount, 0);
  const records = (await json(path.join(task, "mapped-records.json"))).records;
  const decisions = (await json(path.join(task, "boundary-decisions.json")))
    .decisions;
  return { state, records, decisions };
}
export async function prepareSeams(task, outputRoot) {
  task = path.resolve(task);
  outputRoot = path.resolve(outputRoot);
  if (outputRoot === task || outputRoot.startsWith(task + path.sep))
    throw Error("OUTPUT_INSIDE_IMMUTABLE_BASELINE");
  const { state, records, decisions } = await baseline(task);
  const planned = planSeams(records, decisions, state.duration);
  await safePath(outputRoot, true);
  await fs.mkdir(outputRoot, { recursive: true });
  const root = await fs.mkdtemp(path.join(outputRoot, "seam-refinement-"));
  const p = state.plan;
  const pcm = readPcm(await fs.readFile(path.join(task, "audio.wav")));
  assert.equal(pcm.sampleRate, 16000);
  const inputHashes = {
    ...state.files,
    "bounded-task.json": await fileHash(path.join(task, "bounded-task.json")),
  };
  const plan = {
    version: seamRefinementPolicy.version,
    createdAt: new Date().toISOString(),
    task,
    baselineFiles: inputHashes,
    software: await software(),
    config: p.config,
    identities: p.identities,
    duration: p.duration,
    audioOffset: p.audioOffset,
    planned,
    requests: [],
    qualityStatus: "needs-review",
    finalizationMethod: "none",
    humanValidated: false,
  };
  for (const t of planned.targets)
    for (const w of t.windows) {
      const id = `${t.id}-${w.id}`,
        dir = path.join(root, id);
      await fs.mkdir(dir);
      const startFrame = Math.round((w.start - p.audioOffset) * pcm.sampleRate),
        endFrame = Math.round((w.end - p.audioOffset) * pcm.sampleRate);
      const wav = slicePcm(pcm, startFrame, endFrame);
      await fs.writeFile(path.join(dir, "input.wav"), wav, { flag: "wx" });
      plan.requests.push({
        id,
        targetId: t.id,
        start: w.start,
        end: w.end,
        audioHash: await fileHash(path.join(dir, "input.wav")),
      });
    }
  await put(root, "baseline-records.json", records);
  await put(root, "plan.json", plan);
  await put(root, "plan-freeze.json", {
    planHash: await fileHash(path.join(root, "plan.json")),
    baselineHash: await fileHash(path.join(root, "baseline-records.json")),
  });
  return {
    root,
    targets: planned.targets,
    requests: plan.requests.length,
    seconds: planned.reservedAudioSeconds,
  };
}
async function loadPlan(root) {
  await safePath(root);
  const f = await json(path.join(root, "plan-freeze.json"));
  assert.equal(await fileHash(path.join(root, "plan.json")), f.planHash);
  assert.equal(
    await fileHash(path.join(root, "baseline-records.json")),
    f.baselineHash,
  );
  const p = await json(path.join(root, "plan.json"));
  assert.equal(p.version, seamRefinementPolicy.version);
  assert.deepEqual(p.planned.policy, seamRefinementPolicy);
  await verifyInventory(p.task, p.baselineFiles);
  await verifyInventory(repo, p.software);
  const raw = await baseline(p.task);
  assert.deepEqual(p.config, raw.state.plan.config);
  assert.deepEqual(p.identities, raw.state.plan.identities);
  assert.equal(p.duration, raw.state.plan.duration);
  assert.equal(p.audioOffset, raw.state.plan.audioOffset);
  assert.deepEqual(
    p.planned,
    planSeams(raw.records, raw.decisions, p.duration),
  );
  assert.deepEqual(
    await json(path.join(root, "baseline-records.json")),
    raw.records,
  );
  const windows = p.planned.targets.flatMap((t) =>
    t.windows.map((w) => ({
      id: `${t.id}-${w.id}`,
      targetId: t.id,
      start: w.start,
      end: w.end,
    })),
  );
  assert.equal(p.requests.length, windows.length);
  assert(
    p.requests.length <= 8 &&
      p.requests.reduce((s, r) => s + r.end - r.start, 0) <= 120,
  );
  for (const [i, r] of p.requests.entries()) {
    assert.deepEqual(
      { id: r.id, targetId: r.targetId, start: r.start, end: r.end },
      windows[i],
    );
    assert.equal(
      await fileHash(path.join(root, r.id, "input.wav")),
      r.audioHash,
    );
  }
  return p;
}
export async function verifySeams(root) {
  const f = await json(path.join(root, "machine-freeze.json"));
  await verifyInventory(root, f.files);
  const p = await loadPlan(root);
  const baselineRows = await json(path.join(root, "baseline-records.json"));
  const views = await json(path.join(root, "views.json"));
  for (const r of p.requests) {
    const v = views.find((v) => v.requestId === r.id);
    assert(v);
    const srt = path.join(root, r.id, "response.srt");
    assert.equal(await fileHash(srt), v.rawHash);
    assert.deepEqual(
      v.records,
      mapped(await fs.readFile(srt, "utf8"), v.rawHash, r, p.duration),
    );
  }
  const decisions = p.planned.targets.map((t) =>
    decideSeam(
      t,
      baselineRows,
      views.filter((v) => v.targetId === t.id),
    ),
  );
  assert.deepEqual(decisions, await json(path.join(root, "decisions.json")));
  assert.deepEqual(
    assembleSeams(baselineRows, decisions),
    await json(path.join(root, "candidate-records.json")),
  );
  return {
    root,
    integrity: "passed",
    newInference: 0,
    changedTargets: decisions.filter((d) => d.status === "CANDIDATE").length,
  };
}
function mapped(srt, hash, r, duration) {
  const frames = Math.round((r.end - r.start) * 16000);
  return mapRaw(
    srt,
    hash,
    {
      id: r.id,
      index: 0,
      inputStart: 0,
      inputEnd: frames,
      coreStart: 0,
      coreEnd: frames,
      boundary: "hard-cut",
      candidateSamples: [],
    },
    16000,
    r.start,
    duration,
    r.id,
  );
}
export async function executeSeams(
  root,
  { authorize = false, runner, signal } = {},
) {
  root = path.resolve(root);
  if (await exists(path.join(root, "machine-freeze.json")))
    return verifySeams(root);
  if (!authorize) throw Error("EXPLICIT_LOCAL_ASR_AUTHORIZATION_REQUIRED");
  const p = await loadPlan(root);
  for (const key of ["model", "runtime"])
    assert.equal(
      await fileHash(p.identities[key].path),
      p.identities[key].sha256,
    );
  // Exclusive durable reservation prevents a concurrent or interrupted run from silently retrying.
  await put(root, "execution-reservation.json", {
    at: new Date().toISOString(),
    planHash: await fileHash(path.join(root, "plan.json")),
    requests: p.requests.map((r) => r.id),
    seconds: p.planned.reservedAudioSeconds,
    retries: 0,
  });
  runner ??= new EvidenceRunner(signal);
  const views = [];
  for (const r of p.requests) {
    signal?.throwIfAborted();
    const dir = path.join(root, r.id),
      prefix = path.join(dir, "response");
    const args = [
      "--model",
      p.config.model,
      "--file",
      path.join(dir, "input.wav"),
      "--language",
      p.config.language,
      "--threads",
      String(p.config.threads),
      "--output-srt",
      "--output-file",
      prefix,
      "--suppress-nst",
      "--no-prints",
    ];
    await put(dir, "request.json", {
      ...r,
      executable: p.config.runtime,
      args,
      planHash: await fileHash(path.join(root, "plan.json")),
      prompt: null,
    });
    console.log(`${r.id}: ${(r.end - r.start).toFixed(3)} s`);
    const result = await runner.run(p.config.runtime, args, {
      cwd: dir,
      timeoutMs: 120000,
    });
    await put(dir, "exit.json", {
      exitCode: result.exitCode,
      signal: result.signal,
      finishedAt: new Date().toISOString(),
    });
    if (result.exitCode !== 0) throw Error(`LOCAL_ASR_FAILED_NO_RETRY:${r.id}`);
    const rawHash = await fileHash(prefix + ".srt");
    views.push({
      ...r,
      requestId: r.id,
      rawHash,
      records: mapped(
        await fs.readFile(prefix + ".srt", "utf8"),
        rawHash,
        r,
        p.duration,
      ),
    });
  }
  await loadPlan(root);
  for (const key of ["model", "runtime"])
    assert.equal(
      await fileHash(p.identities[key].path),
      p.identities[key].sha256,
    );
  const old = await json(path.join(root, "baseline-records.json"));
  const decisions = p.planned.targets.map((t) =>
    decideSeam(
      t,
      old,
      views.filter((v) => v.targetId === t.id),
    ),
  );
  const candidate = assembleSeams(old, decisions);
  await put(root, "views.json", views);
  await put(root, "decisions.json", decisions);
  await put(root, "candidate-records.json", candidate);
  const serialized = serializeRecords(candidate, p.config.language);
  await fs.mkdir(path.join(root, "subtitles"));
  for (const [ext, value] of Object.entries(serialized.files)) {
    const dest = path.join(
      root,
      "subtitles",
      `seam-refined.machine-candidate.${ext}`,
    );
    await fs.writeFile(dest, value, { flag: "wx" });
    assert.deepEqual(
      formats[ext]
        .parse(await fs.readFile(dest, "utf8"))
        .map((c) => [c.start, c.end, c.text]),
      serialized.cues.map((c) => [c.start, c.end, c.text]),
    );
  }
  await put(root, "machine-freeze.json", {
    version: seamRefinementPolicy.version,
    frozenAt: new Date().toISOString(),
    files: await inventory(root),
    qualityStatus: "needs-review",
    finalizationMethod: "none",
    humanValidated: false,
    acousticTimingVerified: false,
  });
  return verifySeams(root);
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [command, input, output, ...rest] = process.argv.slice(2);
  try {
    let result;
    if (command === "prepare" && input && output && !rest.length)
      result = await prepareSeams(input, output);
    else if (
      command === "run" &&
      input &&
      output === "--authorize-local-asr" &&
      !rest.length
    ) {
      const controller = new AbortController();
      process.once("SIGINT", () => controller.abort());
      result = await executeSeams(input, {
        authorize: true,
        signal: controller.signal,
      });
    } else if (command === "verify" && input && !output)
      result = await verifySeams(input);
    else
      throw Error(
        "Usage: prepare TASK OUTPUT | run RUN --authorize-local-asr | verify RUN",
      );
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error(String(e));
    process.exitCode = 1;
  }
}
