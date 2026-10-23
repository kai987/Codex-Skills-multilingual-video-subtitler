/** One existing machine-text target, two CTC context views, no ASR or subtitle writes. */
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { safePath } from "../packages/video-subtitler/dist/standalone/recovery.js";
import { verifyOnset } from "./subtitle-tool-timing-onset.mjs";
import { EvidenceRunner, readPcm, slicePcm } from "./lib/bounded-asr-ab.mjs";
import {
  planFixedText,
  inspectFixedText,
  policy,
} from "./lib/fixed-text-onset.mjs";
const json = async (f) => JSON.parse(await fs.readFile(f, "utf8"));
const put = (f, v) =>
  fs.writeFile(
    f,
    typeof v === "string" || v instanceof Uint8Array
      ? v
      : JSON.stringify(v, null, 2) + "\n",
    { flag: "wx" },
  );
const bind = async (file) => ({
  file: await fs.realpath(file),
  sha256: await fileHash(file),
});
const bridge = path.join(
  import.meta.dirname,
  "runtime/context_ctc_contrast.py",
);
async function prepare(specFile, out) {
  const s = await json(specFile);
  await verifyOnset(s.parent);
  const parent = await json(path.join(s.parent, "plan.json"));
  const targets = parent.planned.targets.filter((t) => t.id === s.targetId);
  assert.equal(targets.length, 1);
  const rawPath = path.join(s.parent, s.targetId, "raw.json");
  const analysis = planFixedText(
    targets[0],
    await json(rawPath),
    parent.duration,
  );
  assert.equal(parent.audioOffset, 0, "SOURCE_AUDIO_ZERO_OFFSET_REQUIRED");
  const audio = parent.inputs.find((b) => b.file.endsWith("/audio.wav"));
  assert(audio);
  assert.equal(await fileHash(audio.file), audio.sha256);
  const pcm = readPcm(await fs.readFile(audio.file));
  assert.equal(pcm.sampleRate, 16000);
  const prior = await json(path.join(s.priorRuntime, "plan.json"));
  assert.equal(
    await fileHash(path.join(s.priorRuntime, "plan.json")),
    (await json(path.join(s.priorRuntime, "plan-freeze.json"))).planHash,
  );
  // Reuse exactly the installed model/runtime identity; not an unverified new download.
  for (const file of [
    prior.ctc.python,
    ...(await fs.readdir(prior.ctc.model)).map((n) =>
      path.join(prior.ctc.model, n),
    ),
  ]) {
    const real = await fs.realpath(file),
      b = prior.bindings.find((b) => b.file === real);
    assert(b, `UNBOUND_HISTORICAL_RUNTIME:${file}`);
    assert.equal(await fileHash(real), b.sha256);
  }
  const files = [
    specFile,
    path.join(s.parent, "plan.json"),
    path.join(s.parent, "machine-freeze.json"),
    rawPath,
    audio.file,
    path.join(s.priorRuntime, "plan.json"),
    path.join(s.priorRuntime, "plan-freeze.json"),
    prior.ctc.python,
    import.meta.filename,
    bridge,
    path.join(import.meta.dirname, "runtime/ctc_worker.py"),
    path.join(import.meta.dirname, "lib/fixed-text-onset.mjs"),
    path.join(import.meta.dirname, "lib/context-ctc-contrast.mjs"),
  ];
  for (const n of await fs.readdir(prior.ctc.model))
    files.push(path.join(prior.ctc.model, n));
  const bindings = await Promise.all(files.map(bind));
  out = path.resolve(out);
  await safePath(out, true);
  for (const source of [s.parent, s.priorRuntime])
    assert(out !== source && !out.startsWith(source + path.sep));
  await fs.mkdir(out, { recursive: true });
  const root = await fs.mkdtemp(path.join(out, "fixed-onset-"));
  for (const q of analysis.requests) {
    await fs.mkdir(path.join(root, q.id));
    await put(
      path.join(root, q.id, "input.wav"),
      slicePcm(pcm, q.firstFrame, q.endFrame),
    );
    q.wavHash = await fileHash(path.join(root, q.id, "input.wav"));
  }
  await put(path.join(root, "plan.json"), {
    source: s.parent,
    targetId: s.targetId,
    analysis,
    requests: analysis.requests,
    ctc: prior.ctc,
    bindings,
    referenceUsed: false,
    labelsUsed: false,
  });
  await put(path.join(root, "plan-freeze.json"), {
    planHash: await fileHash(path.join(root, "plan.json")),
  });
  return {
    root,
    requests: 2,
    seconds: analysis.requests.reduce((n, q) => n + q.frames / 16000, 0),
  };
}
async function load(root) {
  await safePath(root);
  assert.equal(
    await fileHash(path.join(root, "plan.json")),
    (await json(path.join(root, "plan-freeze.json"))).planHash,
  );
  const p = await json(path.join(root, "plan.json"));
  assert.deepEqual(p.analysis.policy, policy);
  for (const b of p.bindings)
    assert.equal(
      await fileHash(b.file),
      b.sha256,
      `BOUND_INPUT_CHANGED:${b.file}`,
    );
  for (const q of p.requests)
    assert.equal(await fileHash(path.join(root, q.id, "input.wav")), q.wavHash);
  const parent = await json(path.join(p.source, "plan.json"));
  const reconstructed = planFixedText(
    parent.planned.targets.find((t) => t.id === p.targetId),
    await json(path.join(p.source, p.targetId, "raw.json")),
    parent.duration,
  );
  reconstructed.requests.forEach((q, i) => (q.wavHash = p.requests[i].wavHash));
  assert.deepEqual(p.analysis, reconstructed);
  assert.deepEqual(p.requests, p.analysis.requests);
  return p;
}
async function replay(root, p) {
  assert.equal((await json(path.join(root, "exit.json"))).exitCode, 0);
  const ready = await json(path.join(root, "ready.json"));
  assert.equal(ready.modelLoadCount, 1);
  assert.equal(ready.deviceUsed, "cpu");
  assert.deepEqual(await json(path.join(root, "worker-reservation.json")), {
    requests: 2,
    frames: p.requests.reduce((n, q) => n + q.frames, 0),
    planHash: (await json(path.join(root, "plan-freeze.json"))).planHash,
  });
  const raw = [];
  for (const q of p.requests) {
    const d = await json(path.join(root, q.id, "dispatch.json"));
    assert.equal(d.request.targetText, q.targetText);
    assert.equal(d.request.mediaGlobalStart, q.start);
    assert.equal(d.request.audioFrameEnd, q.frames);
    raw.push(await json(path.join(root, q.id, "raw.json")));
  }
  return inspectFixedText(p.analysis, raw);
}
async function inventory(root) {
  const result = {};
  for (const e of await fs.readdir(root, { withFileTypes: true })) {
    assert(!e.isSymbolicLink());
    if (["machine-freeze.json", "evaluation"].includes(e.name)) continue;
    if (e.isDirectory()) {
      for (const [n, h] of Object.entries(
        await inventory(path.join(root, e.name)),
      ))
        result[e.name + "/" + n] = h;
    } else result[e.name] = await fileHash(path.join(root, e.name));
  }
  return result;
}
async function finish(root) {
  const p = await load(root),
    result = await replay(root, p);
  await put(path.join(root, "result.json"), result);
  await put(path.join(root, "machine-freeze.json"), {
    files: await inventory(root),
    subtitleMutations: 0,
    referenceRead: false,
  });
  return { root, ...result };
}
async function verify(root) {
  const p = await load(root);
  assert.deepEqual(
    await inventory(root),
    (await json(path.join(root, "machine-freeze.json"))).files,
  );
  assert.deepEqual(
    await replay(root, p),
    await json(path.join(root, "result.json")),
  );
  return {
    integrity: "passed",
    status: (await json(path.join(root, "result.json"))).status,
  };
}
const [cmd, a, b] = process.argv.slice(2);
try {
  if (cmd === "prepare")
    console.log(JSON.stringify(await prepare(a, b), null, 2));
  else if (cmd === "run") {
    assert.equal(b, "--authorize-local");
    await load(a);
    await put(path.join(a, "execution-reservation.json"), {
      requests: 2,
      retries: 0,
    });
    const p = await json(path.join(a, "plan.json")),
      r = await new EvidenceRunner().run(p.ctc.python, [bridge, a], {
        cwd: a,
        timeoutMs: 300000,
      });
    await put(path.join(a, "exit.json"), {
      exitCode: r.exitCode,
      signal: r.signal ?? null,
    });
    assert.equal(r.exitCode, 0, "NO_RETRY");
    console.log(JSON.stringify(await finish(a), null, 2));
  } else if (cmd === "verify") console.log(JSON.stringify(await verify(a)));
  else throw Error("USE_PREPARE_RUN_VERIFY");
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}
