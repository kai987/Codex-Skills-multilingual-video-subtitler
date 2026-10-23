/** One preceding-context diagnostic pair, no reference or subtitle writes. */
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
import { verifyIslands } from "./subtitle-tool-acoustic-islands.mjs";
import {
  planContrast,
  compareContrast,
} from "./lib/short-context-contrast.mjs";
const repo = path.resolve(import.meta.dirname, ".."),
  json = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const put = (r, n, v) => durable(path.join(r, n), v, true);
const worker = path.join(repo, "scripts/runtime/speech_support_kotoba.py");
async function inventory(root) {
  const out = {};
  for (const e of await fs.readdir(root, { withFileTypes: true })) {
    assert(!e.isSymbolicLink());
    const p = path.join(root, e.name);
    if (e.isDirectory())
      for (const [n, h] of Object.entries(await inventory(p)))
        out[`${e.name}/${n}`] = h;
    else out[e.name] = await fileHash(p);
  }
  return out;
}
async function inputs(parent, targetId) {
  await verifyIslands(parent);
  const p = await json(path.join(parent, "plan.json"));
  const cut = await json(path.join(p.parent, "plan.json"));
  const coverage = await json(path.join(cut.parent, "audit-freeze.json"));
  const word = await json(path.join(coverage.parent, "plan.json"));
  const context = await json(path.join(word.parent, "plan.json"));
  const planned = planContrast(p, context, targetId);
  const shortViews = (
    await json(path.join(parent, "island-analysis.json"))
  ).views.filter((v) => v.targetId === targetId);
  const candidates = p.baseline
    .filter(
      (r) =>
        r.sourceStart < planned.activity.end &&
        r.sourceEnd > planned.activity.start,
    )
    .map(({ recordId, text, sourceStart, sourceEnd }) => ({
      recordId,
      text,
      sourceStart,
      sourceEnd,
    }));
  return { p, planned, shortViews, candidates };
}
export async function prepareContrast(parent, targetId, output) {
  parent = path.resolve(parent);
  output = path.resolve(output);
  const { p, planned, shortViews, candidates } = await inputs(parent, targetId);
  assert(
    output !== parent && !output.startsWith(parent + path.sep),
    "OUTPUT_INSIDE_PARENT",
  );
  const pcm = readPcm(await fs.readFile(p.audio.path));
  await fs.mkdir(output, { recursive: true });
  const root = await fs.mkdtemp(path.join(output, "contrast-"));
  const dir = path.join(root, planned.probe.id);
  await fs.mkdir(dir);
  const begin = Math.round((planned.probe.start - p.offset) * 16000);
  await fs.writeFile(
    path.join(dir, "input.wav"),
    slicePcm(pcm, begin, begin + planned.probe.frames),
    { flag: "wx" },
  );
  const probe = {
    ...planned.probe,
    wavHash: await fileHash(path.join(dir, "input.wav")),
  };
  const bindings = await Promise.all(
    [
      path.join(parent, "machine-freeze.json"),
      worker,
      path.join(repo, "scripts/subtitle-tool-short-context.mjs"),
      path.join(repo, "scripts/lib/short-context-contrast.mjs"),
      path.join(repo, "scripts/lib/bounded-asr-ab.mjs"),
    ].map(async (p) => ({ path: p, sha256: await fileHash(p) })),
  );
  await put(root, "plan.json", {
    parent,
    ...planned,
    probe,
    shortViews,
    candidates,
    bindings,
    identities: p.identities,
    config: p.config,
    spec: p.spec,
    audio: p.audio,
    offset: p.offset,
    duration: p.duration,
    referenceUsed: false,
  });
  await put(root, "asr-plan.json", {
    probes: [probe],
    model: p.spec.kotobaModel,
    referenceUsed: false,
  });
  await put(root, "asr-plan-freeze.json", {
    sha256: await fileHash(path.join(root, "asr-plan.json")),
  });
  await put(root, "plan-freeze.json", { files: await inventory(root) });
  return { root, probe, requests: 2, seconds: (probe.frames * 2) / 16000 };
}
async function load(root) {
  const f = await json(path.join(root, "plan-freeze.json"));
  for (const [n, h] of Object.entries(f.files)) {
    assert(!path.isAbsolute(n) && !n.split(/[\\/]/u).includes(".."));
    assert.equal(await fileHash(path.join(root, n)), h);
  }
  const p = await json(path.join(root, "plan.json"));
  for (const b of [...p.bindings, ...p.identities, p.audio])
    assert.equal(await fileHash(b.path), b.sha256);
  const input = await inputs(p.parent, p.targetId);
  for (const k of [
    "policy",
    "targetId",
    "targetCrop",
    "activity",
    "claim",
    "lexicalPrompt",
  ])
    assert.deepEqual(p[k], input.planned[k]);
  const { wavHash, ...probe } = p.probe;
  assert.deepEqual(probe, input.planned.probe);
  for (const k of [
    "config",
    "spec",
    "identities",
    "audio",
    "offset",
    "duration",
  ])
    assert.deepEqual(p[k], input.p[k]);
  assert.deepEqual(p.shortViews, input.shortViews);
  assert.deepEqual(p.candidates, input.candidates);
  const wav = path.join(root, p.probe.id, "input.wav");
  assert.equal(await fileHash(wav), wavHash);
  const pcm = readPcm(await fs.readFile(p.audio.path)),
    begin = Math.round((p.probe.start - p.offset) * 16000);
  assert.deepEqual(
    await fs.readFile(wav),
    slicePcm(pcm, begin, begin + p.probe.frames),
  );
  assert.deepEqual(await json(path.join(root, "asr-plan.json")), {
    probes: [p.probe],
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
  await put(dir, `${name}-dispatch.json`, { executable: exe, args });
  const r = await runner.run(exe, args, { cwd: dir, timeoutMs: 180000 });
  await fs.writeFile(path.join(dir, `${name}.stdout.log`), r.stdout ?? "", {
    flag: "wx",
  });
  await fs.writeFile(path.join(dir, `${name}.stderr.log`), r.stderr ?? "", {
    flag: "wx",
  });
  await put(dir, `${name}-exit.json`, {
    code: r.exitCode,
    signal: r.signal ?? null,
  });
  assert.equal(r.exitCode, 0, "FAILED_NO_RETRY");
}
export async function runContrast(
  root,
  authorize,
  runner = new EvidenceRunner(),
) {
  const p = await load(root);
  assert(authorize === true, "AUTHORIZE_LOCAL_REQUIRED");
  await put(root, "execution-reservation.json", {
    requests: 2,
    seconds: (p.probe.frames * 2) / 16000,
    retries: 0,
  });
  const dir = path.join(root, p.probe.id);
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
  await dispatch(runner, p.spec.python, [worker, root], root, "kotoba");
  return finishContrast(root);
}
async function replay(root) {
  const p = await load(root),
    r = p.probe,
    dir = path.join(root, r.id);
  assert.deepEqual(await json(path.join(root, "execution-reservation.json")), {
    requests: 2,
    seconds: (r.frames * 2) / 16000,
    retries: 0,
  });
  assert.equal((await json(path.join(dir, "whisper-exit.json"))).code, 0);
  assert.equal((await json(path.join(root, "kotoba-exit.json"))).code, 0);
  assert.equal(
    (await json(path.join(root, "kotoba-runtime.json"))).modelLoadCount,
    1,
  );
  assert.equal(
    (await json(path.join(dir, "kotoba-reserved.json"))).wavHash,
    r.wavHash,
  );
  const file = path.join(dir, "whisper.srt");
  const rows = mapRaw(
    await fs.readFile(file, "utf8"),
    await fileHash(file),
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
  const secondary = (await json(path.join(dir, "kotoba-raw.json"))).segments;
  return compareContrast(
    p.shortViews,
    [
      {
        backend: "whisper",
        text: rows.map((v) => v.text).join(""),
        records: rows,
      },
      {
        backend: "kotoba",
        text: secondary.map((v) => v.text.trim()).join(""),
        records: secondary,
      },
    ],
    p.candidates,
  );
}
export async function finishContrast(root) {
  try {
    await fs.stat(path.join(root, "machine-freeze.json"));
    return verifyContrast(root);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const result = await replay(root);
  try {
    assert.deepEqual(
      await json(path.join(root, "contrast-analysis.json")),
      result,
    );
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    await put(root, "contrast-analysis.json", result);
  }
  await put(root, "machine-freeze.json", {
    files: await inventory(root),
    canonicalMutation: 0,
  });
  return verifyContrast(root);
}
export async function verifyContrast(root) {
  const f = await json(path.join(root, "machine-freeze.json"));
  assert.equal(f.canonicalMutation, 0);
  for (const [n, h] of Object.entries(f.files)) {
    assert(!path.isAbsolute(n) && !n.split(/[\\/]/u).includes(".."));
    assert.equal(await fileHash(path.join(root, n)), h);
  }
  const r = await replay(root);
  assert.deepEqual(await json(path.join(root, "contrast-analysis.json")), r);
  return {
    root,
    integrity: "passed",
    newInference: 0,
    status: r.status,
    short: r.short.map(({ backend, text }) => ({ backend, text })),
    expanded: r.expanded.map(({ backend, text }) => ({ backend, text })),
    automaticReplacementAllowed: false,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const [cmd, a, b, c] = process.argv.slice(2);
    assert(a);
    assert(["prepare", "run", "finish", "verify"].includes(cmd));
    console.log(
      JSON.stringify(
        await {
          prepare: () => {
            assert(b && c);
            return prepareContrast(a, b, c);
          },
          run: () => runContrast(a, b === "--authorize-local"),
          finish: () => finishContrast(a),
          verify: () => verifyContrast(a),
        }[cmd](),
        null,
        2,
      ),
    );
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  }
}
