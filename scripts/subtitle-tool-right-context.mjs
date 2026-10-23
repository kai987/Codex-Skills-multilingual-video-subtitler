/** One VAD-only right-context probe; existing runner owns reservation and receipts. */
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { verifyOnset } from "./subtitle-tool-timing-onset.mjs";
import {
  listeningVadPolicy,
  vadProfile,
  runListeningVad,
  verifyListeningVad,
} from "./subtitle-tool-listening-vad.mjs";
import { readPcm, slicePcm } from "./lib/bounded-asr-ab.mjs";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { safePath } from "../packages/video-subtitler/dist/standalone/recovery.js";
import {
  planRightContext,
  compareRightContext,
  rightContextPolicy,
} from "./lib/right-context-probe.mjs";
const read = async (f) => JSON.parse(await fs.readFile(f, "utf8"));
const put = (f, v) =>
  fs.writeFile(f, JSON.stringify(v, null, 2) + "\n", { flag: "wx" });
const bind = async (file) => ({
  file: await fs.realpath(file),
  sha256: await fileHash(file),
});
async function prepare(source, out) {
  source = await fs.realpath(source);
  out = path.resolve(out);
  await safePath(out, true);
  assert(out !== source && !out.startsWith(source + path.sep));
  await verifyOnset(source);
  const p = await read(path.join(source, "plan.json"));
  assert.equal(p.audioOffset, 0);
  assert.deepEqual(p.vadProfile, vadProfile);
  const old = p.planned.targets.find((t) => t.id === "cue-114");
  assert(old);
  const rawFile = path.join(source, old.id, "raw.json"),
    raw = await read(rawFile);
  const probe = planRightContext(old, raw, p.duration, p.baseline);
  const audio = p.inputs.find((b) => b.file.endsWith("/audio.wav"));
  assert(audio);
  assert.equal(await fileHash(audio.file), audio.sha256);
  const pcm = readPcm(await fs.readFile(audio.file));
  assert.equal(pcm.sampleRate, 16000);
  const runtime = {
    python: p.runtime.python,
    model: p.runtime.vadModel,
    library: p.runtime.vadLibrary,
  };
  const identities = await Promise.all(Object.values(runtime).map(bind));
  for (const b of identities)
    assert(
      p.identities.some((x) => x.file === b.file && x.sha256 === b.sha256),
      "RUNTIME_IDENTITY",
    );
  await fs.mkdir(out, { recursive: true });
  const root = await fs.mkdtemp(path.join(out, "right-context-"));
  const audioPath = path.join(root, "input.wav"),
    t = probe.target;
  await fs.writeFile(audioPath, slicePcm(pcm, t.firstFrame, t.endFrame), {
    flag: "wx",
  });
  const inputs = await Promise.all(
    [
      rawFile,
      audio.file,
      audioPath,
      path.join(source, "plan.json"),
      path.join(source, "machine-freeze.json"),
    ].map(bind),
  );
  const software = await Promise.all(
    [
      import.meta.filename,
      ...[
        "lib/right-context-probe.mjs",
        "lib/activity-boundary-observation.mjs",
        "subtitle-tool-listening-vad.mjs",
        "lib/bounded-asr-ab.mjs",
        "runtime/bounded_silero.py",
        "runtime/c601141_speech_activity_worker.py",
      ].map((n) => path.join(import.meta.dirname, n)),
    ].map(bind),
  );
  const item = {
    id: t.id,
    cohort: "right-context-probe",
    start: t.start,
    end: t.end,
    frames: t.endFrame - t.firstFrame,
    audioPath,
    audioHash: await fileHash(audioPath),
    localTargetStart: probe.before.rawSourceIntervals.at(-1).start - t.start,
    localTargetEnd: old.end - t.start,
  };
  await put(path.join(root, "plan.json"), {
    policy: listeningVadPolicy,
    profile: vadProfile,
    items: [item],
    seconds: item.frames / 16000,
    runtime,
    identities,
    software,
    inputs,
    annotationInput: false,
    probe,
    source,
    rawFile,
  });
  await put(path.join(root, "plan-freeze.json"), {
    planHash: await fileHash(path.join(root, "plan.json")),
  });
  return { root, requests: 1, seconds: item.frames / 16000 };
}
async function finish(root, write) {
  const v = await verifyListeningVad(root),
    p = v.plan;
  assert.deepEqual(p.probe.policy, rightContextPolicy);
  assert.equal(p.items.length, 1);
  assert.equal(v.vadPasses, 1);
  assert.equal(v.modelLoads, 1);
  const r = compareRightContext(
    p.probe,
    await read(p.rawFile),
    await read(path.join(root, p.probe.target.id, "raw.json")),
  );
  if (write) {
    await put(path.join(root, "boundary-result.json"), r);
    await put(path.join(root, "boundary-freeze.json"), {
      sha256: await fileHash(path.join(root, "boundary-result.json")),
      machineFreezeHash: await fileHash(path.join(root, "machine-freeze.json")),
    });
  } else {
    const f = await read(path.join(root, "boundary-freeze.json"));
    assert.equal(
      await fileHash(path.join(root, "boundary-result.json")),
      f.sha256,
    );
    assert.equal(
      await fileHash(path.join(root, "machine-freeze.json")),
      f.machineFreezeHash,
    );
    assert.deepEqual(await read(path.join(root, "boundary-result.json")), r);
  }
  return r;
}
const [cmd, a, b] = process.argv.slice(2);
let result;
if (cmd === "prepare") result = await prepare(a, b);
else if (cmd === "run") {
  assert.equal(b, "--authorize-local");
  const p = await read(path.join(a, "plan.json"));
  assert.deepEqual(p.probe.policy, rightContextPolicy);
  assert.equal(p.items.length, 1);
  assert(p.seconds <= 12);
  await runListeningVad(a, { authorize: true });
  result = await finish(a, true);
} else {
  assert.equal(cmd, "verify");
  result = await finish(a, false);
}
console.log(JSON.stringify(result, null, 2));
