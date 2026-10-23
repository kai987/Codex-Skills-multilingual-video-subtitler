/** Bounded acoustic-island ASR. No transcript prompts or subtitle writeback. */
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
import { verifyCuts } from "./subtitle-tool-acoustic-cuts.mjs";
import {
  planIslands,
  compareIslands,
  islandPolicy,
} from "./lib/acoustic-islands.mjs";
const repo = path.resolve(import.meta.dirname, ".."),
  json = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const put = (r, n, v) => durable(path.join(r, n), v, true);
const bind = async (p) => ({ path: p, sha256: await fileHash(p) });
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
async function inputs(parent) {
  await verifyCuts(parent);
  const cut = await json(path.join(parent, "plan.json"));
  const f = await json(path.join(cut.parent, "audit-freeze.json"));
  const wp = await json(path.join(f.parent, "plan.json"));
  const cp = await json(path.join(wp.parent, "plan.json"));
  const baseline = await json(path.join(wp.parent, "baseline-records.json"));
  const planned = planIslands(
    await json(path.join(parent, "cut-analysis.json")),
    cut.targets,
  );
  return { cut, cp, baseline, planned };
}
export async function prepareIslands(parent, output) {
  parent = path.resolve(parent);
  output = path.resolve(output);
  const { cut, cp, baseline, planned } = await inputs(parent);
  for (const old of [parent, cut.parent, cp.parent])
    assert(
      output !== old && !output.startsWith(old + path.sep),
      "OUTPUT_INSIDE_INPUT",
    );
  assert(planned.selected.length, "NO_BOUNDED_ISLAND_NO_MODEL");
  const pcm = readPcm(await fs.readFile(cp.audio.path));
  await fs.mkdir(output, { recursive: true });
  const root = await fs.mkdtemp(path.join(output, "islands-"));
  for (const r of planned.selected) {
    const dir = path.join(root, r.id);
    await fs.mkdir(dir);
    const begin = Math.round((r.start - cp.audioOffset) * 16000);
    await fs.writeFile(
      path.join(dir, "input.wav"),
      slicePcm(pcm, begin, begin + r.frames),
      { flag: "wx" },
    );
    r.wavHash = await fileHash(path.join(dir, "input.wav"));
  }
  const bindings = await Promise.all(
    [
      path.join(parent, "machine-freeze.json"),
      worker,
      path.join(repo, "scripts/subtitle-tool-acoustic-islands.mjs"),
      path.join(repo, "scripts/lib/acoustic-islands.mjs"),
      path.join(repo, "scripts/lib/bounded-asr-ab.mjs"),
      path.join(repo, "packages/video-subtitler/dist/standalone/bounded.js"),
    ].map(bind),
  );
  await put(root, "plan.json", {
    parent,
    ...planned,
    config: cp.config,
    spec: cp.spec,
    identities: cp.identities,
    audio: cp.audio,
    offset: cp.audioOffset,
    duration: cp.duration,
    bindings,
    baseline,
    referenceUsed: false,
  });
  await put(root, "asr-plan.json", {
    probes: planned.selected,
    model: cp.spec.kotobaModel,
    referenceUsed: false,
  });
  await put(root, "asr-plan-freeze.json", {
    sha256: await fileHash(path.join(root, "asr-plan.json")),
  });
  await put(root, "plan-freeze.json", { files: await inventory(root) });
  return {
    root,
    requests: planned.selected.length * 2,
    seconds: planned.selected.reduce((s, r) => s + (r.frames * 2) / 16000, 0),
    selected: planned.selected.map(({ id, start, end }) => ({
      id,
      start,
      end,
    })),
    deferred: planned.deferred,
  };
}
async function load(root) {
  const f = await json(path.join(root, "plan-freeze.json"));
  for (const [n, h] of Object.entries(f.files)) {
    assert(!path.isAbsolute(n) && !n.split(/[\\/]/u).includes(".."));
    assert.equal(await fileHash(path.join(root, n)), h);
  }
  const p = await json(path.join(root, "plan.json"));
  assert.deepEqual(p.policy, islandPolicy);
  for (const b of [...p.identities, ...p.bindings, p.audio])
    assert.equal(await fileHash(b.path), b.sha256, `CHANGED:${b.path}`);
  const { cp, baseline, planned } = await inputs(p.parent);
  assert.deepEqual(
    p.selected.map(({ wavHash, ...r }) => {
      assert.match(wavHash, /^[a-f0-9]{64}$/u);
      return r;
    }),
    planned.selected,
  );
  assert.deepEqual(p.deferred, planned.deferred);
  assert.deepEqual(p.baseline, baseline);
  assert.deepEqual(p.config, cp.config);
  assert.deepEqual(p.spec, cp.spec);
  assert.deepEqual(p.identities, cp.identities);
  assert.deepEqual(p.audio, cp.audio);
  assert.equal(p.offset, cp.audioOffset);
  assert.equal(p.duration, cp.duration);
  const pcm = readPcm(await fs.readFile(p.audio.path));
  for (const r of p.selected) {
    const begin = Math.round((r.start - p.offset) * 16000);
    assert.deepEqual(
      await fs.readFile(path.join(root, r.id, "input.wav")),
      slicePcm(pcm, begin, begin + r.frames),
    );
    assert.equal(await fileHash(path.join(root, r.id, "input.wav")), r.wavHash);
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
async function dispatch(runner, exe, args, root, name) {
  await put(root, `${name}-dispatch.json`, { executable: exe, args });
  const r = await runner.run(exe, args, { cwd: root, timeoutMs: 180000 });
  await fs.writeFile(path.join(root, `${name}.stdout.log`), r.stdout ?? "", {
    flag: "wx",
  });
  await fs.writeFile(path.join(root, `${name}.stderr.log`), r.stderr ?? "", {
    flag: "wx",
  });
  await put(root, `${name}-exit.json`, {
    code: r.exitCode,
    signal: r.signal ?? null,
  });
  assert.equal(r.exitCode, 0, "FAILED_NO_RETRY");
}
export async function runIslands(
  root,
  authorize,
  runner = new EvidenceRunner(),
) {
  const p = await load(root);
  assert(authorize === true, "AUTHORIZE_LOCAL_REQUIRED");
  await put(root, "execution-reservation.json", {
    requests: p.selected.length * 2,
    seconds: p.selected.reduce((s, r) => s + (r.frames * 2) / 16000, 0),
    retries: 0,
  });
  for (const r of p.selected) {
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
  await dispatch(runner, p.spec.python, [worker, root], root, "kotoba");
  return finishIslands(root);
}
async function replay(root) {
  const p = await load(root);
  assert.deepEqual(await json(path.join(root, "execution-reservation.json")), {
    requests: p.selected.length * 2,
    seconds: p.selected.reduce((s, r) => s + (r.frames * 2) / 16000, 0),
    retries: 0,
  });
  assert.equal((await json(path.join(root, "kotoba-exit.json"))).code, 0);
  assert.equal(
    (await json(path.join(root, "kotoba-runtime.json"))).modelLoadCount,
    1,
  );
  const views = [];
  for (const r of p.selected) {
    const dir = path.join(root, r.id);
    assert.equal((await json(path.join(dir, "whisper-exit.json"))).code, 0);
    assert.equal(
      (await json(path.join(dir, "kotoba-reserved.json"))).wavHash,
      r.wavHash,
    );
    const srt = path.join(dir, "whisper.srt");
    const rows = mapRaw(
      await fs.readFile(srt, "utf8"),
      await fileHash(srt),
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
    const kotoba = await json(path.join(dir, "kotoba-raw.json"));
    // Preserve texts even when the ASR's segment timestamps are unusable.
    views.push({
      targetId: r.id,
      backend: "whisper",
      text: rows.map((c) => c.text).join(""),
      records: rows,
    });
    views.push({
      targetId: r.id,
      backend: "kotoba",
      text: kotoba.segments.map((s) => s.text.trim()).join(""),
      records: kotoba.segments,
    });
  }
  return { views, comparisons: compareIslands(p, views, p.baseline) };
}
export async function finishIslands(root) {
  try {
    await fs.stat(path.join(root, "machine-freeze.json"));
    return verifyIslands(root);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const result = await replay(root);
  try {
    assert.deepEqual(
      await json(path.join(root, "island-analysis.json")),
      result,
    );
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    await put(root, "island-analysis.json", result);
  }
  await put(root, "machine-freeze.json", {
    files: await inventory(root),
    canonicalMutation: 0,
  });
  return verifyIslands(root);
}
export async function verifyIslands(root) {
  const f = await json(path.join(root, "machine-freeze.json"));
  assert.equal(f.canonicalMutation, 0);
  for (const [n, h] of Object.entries(f.files)) {
    assert(!path.isAbsolute(n) && !n.split(/[\\/]/u).includes(".."));
    assert.equal(await fileHash(path.join(root, n)), h);
  }
  const r = await replay(root);
  assert.deepEqual(await json(path.join(root, "island-analysis.json")), r);
  return {
    root,
    integrity: "passed",
    newInference: 0,
    comparisons: r.comparisons.map(({ targetId, crop, status, views }) => ({
      targetId,
      crop,
      status,
      texts: views.map((v) => ({ backend: v.backend, text: v.text })),
    })),
    canonicalMutation: 0,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const [cmd, a, b] = process.argv.slice(2);
    assert(a);
    assert(["prepare", "run", "finish", "verify"].includes(cmd));
    console.log(
      JSON.stringify(
        await {
          prepare: () => {
            assert(b);
            return prepareIslands(a, b);
          },
          run: () => runIslands(a, b === "--authorize-local"),
          finish: () => finishIslands(a),
          verify: () => verifyIslands(a),
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
