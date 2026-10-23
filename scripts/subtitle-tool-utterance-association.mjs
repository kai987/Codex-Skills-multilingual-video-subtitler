/** Offline saved-evidence association and separately authorized bounded timing probe. */
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { safePath } from "../packages/video-subtitler/dist/standalone/recovery.js";
import { EvidenceRunner, readPcm, slicePcm } from "./lib/bounded-asr-ab.mjs";
import { verifyRecovery } from "./subtitle-tool-vad-local-recovery.mjs";
import {
  planAssociation,
  summarizeUtteranceTiming,
} from "./lib/utterance-association.mjs";

const repo = path.resolve(import.meta.dirname, "..");
const json = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const put = (p, v) =>
  fs.writeFile(p, JSON.stringify(v, null, 2) + "\n", { flag: "wx" });
const bind = async (file) => ({
  file: await fs.realpath(file),
  sha256: await fileHash(file),
});
const bridge = path.join(repo, "scripts/runtime/utterance_ctc.py");
async function inspect(root) {
  await verifyRecovery(root);
  const parent = await json(path.join(root, "plan.json"));
  const views = await json(path.join(root, "views.json"));
  return {
    parent,
    association: planAssociation(parent.probes, parent.baseline, views),
  };
}
export async function prepareAssociation(sourceRoot, ctc, outputParent) {
  sourceRoot = await fs.realpath(sourceRoot);
  outputParent = path.resolve(outputParent);
  await safePath(outputParent, true);
  const { parent, association } = await inspect(sourceRoot);
  assert(
    !outputParent.startsWith(sourceRoot + path.sep) &&
      outputParent !== sourceRoot,
    "OUTPUT_INSIDE_INPUT",
  );
  const files = [
    "plan.json",
    "views.json",
    "machine-freeze.json",
    "local-recovery.machine-candidate.srt",
  ].map((n) => path.join(sourceRoot, n));
  const audio = path.join(parent.spec.task, "audio.wav");
  files.push(audio, ctc.python);
  for (const entry of await fs.readdir(ctc.model))
    files.push(path.join(ctc.model, entry));
  for (const n of [
    "scripts/subtitle-tool-utterance-association.mjs",
    "scripts/lib/utterance-association.mjs",
    "scripts/lib/local-acoustic-policy.mjs",
    "scripts/lib/speech-support-policy.mjs",
    "scripts/runtime/utterance_ctc.py",
    "scripts/runtime/ctc_worker.py",
    "scripts/lib/bounded-asr-ab.mjs",
  ])
    files.push(path.join(repo, n));
  const bindings = await Promise.all(files.map(bind));
  const pcm = readPcm(await fs.readFile(audio));
  await fs.mkdir(outputParent, { recursive: true });
  const root = await fs.mkdtemp(path.join(outputParent, "utterance-"));
  for (const q of association.requests) {
    assert(/^[a-zA-Z0-9][a-zA-Z0-9._-]+$/u.test(q.id), "INVALID_ID");
    await fs.mkdir(path.join(root, q.id));
    const wav = path.join(root, q.id, "input.wav");
    await fs.writeFile(
      wav,
      slicePcm(
        pcm,
        Math.round(q.start * 16000),
        Math.round(q.start * 16000) + q.frames,
      ),
      { flag: "wx" },
    );
    q.wavHash = await fileHash(wav);
  }
  await put(path.join(root, "plan.json"), {
    sourceRoot,
    ctc,
    association,
    bindings,
    vadObservations: parent.vadObservations,
    referenceUsed: false,
    labelsUsed: false,
  });
  await put(path.join(root, "plan-freeze.json"), {
    planHash: await fileHash(path.join(root, "plan.json")),
  });
  return {
    root,
    routes: association.rows.map((r) => ({ id: r.id, route: r.route })),
    requests: association.requests.length,
    seconds: association.seconds,
  };
}
async function load(root) {
  await safePath(root);
  const p = await json(path.join(root, "plan.json"));
  assert.equal(
    await fileHash(path.join(root, "plan.json")),
    (await json(path.join(root, "plan-freeze.json"))).planHash,
    "PLAN_CHANGED",
  );
  for (const b of p.bindings)
    assert.equal(await fileHash(b.file), b.sha256, `CHANGED:${b.file}`);
  const fresh = (await inspect(p.sourceRoot)).association;
  assert.deepEqual(
    p.association,
    {
      ...fresh,
      requests: fresh.requests.map((q) => ({
        ...q,
        wavHash: p.association.requests.find((r) => r.id === q.id)?.wavHash,
      })),
    },
    "ASSOCIATION_CHANGED",
  );
  const parent = await json(path.join(p.sourceRoot, "plan.json"));
  const pcm = readPcm(
    await fs.readFile(path.join(parent.spec.task, "audio.wav")),
  );
  for (const q of p.association.requests) {
    const wav = path.join(root, q.id, "input.wav");
    await safePath(wav);
    assert.equal(await fileHash(wav), q.wavHash, "AUDIO_CHANGED");
    assert.deepEqual(
      await fs.readFile(wav),
      slicePcm(
        pcm,
        Math.round(q.start * 16000),
        Math.round(q.start * 16000) + q.frames,
      ),
      "AUDIO_SOURCE_MISMATCH",
    );
  }
  assert.deepEqual(p.vadObservations, parent.vadObservations);
  return p;
}
export async function reserveAlignment(root, plan, authorized) {
  assert(authorized, "EXPLICIT_LOCAL_AUTHORIZATION_REQUIRED");
  assert.equal(plan.association.requests.length, 2, "TWO_REQUESTS_REQUIRED");
  await put(path.join(root, "execution-reservation.json"), {
    requests: 2,
    retries: 0,
    asrRequests: 0,
    seconds: plan.association.seconds,
    planHash: await fileHash(path.join(root, "plan.json")),
  });
}
export async function runAssociation(
  root,
  authorized,
  runner = new EvidenceRunner(),
) {
  assert(authorized, "EXPLICIT_LOCAL_AUTHORIZATION_REQUIRED");
  const p = await load(root);
  await reserveAlignment(root, p, authorized);
  const result = await runner.run(p.ctc.python, [bridge, root], {
    cwd: root,
    timeoutMs: 180000,
  });
  await put(path.join(root, "exit.json"), result);
  assert.equal(result.exitCode, 0, "CTC_FAILED_NO_RETRY");
  return finishAssociation(root);
}
async function replay(root, p) {
  const results = [];
  for (const q of p.association.requests) {
    assert.deepEqual(
      (await json(path.join(root, q.id, "reserved.json"))).request,
      q,
      "RESERVATION_CHANGED",
    );
    const raw = await json(path.join(root, q.id, "raw.json"));
    assert.equal(raw.requestId, q.id);
    results.push({ ...raw, request: q });
  }
  const runtime = await json(path.join(root, "ready.json"));
  assert.equal(runtime.modelLoadCount, 1);
  assert.equal(runtime.deviceUsed, "cpu");
  const targetId = p.association.requests[0]?.targetId;
  return {
    association: p.association,
    timing: summarizeUtteranceTiming(
      results,
      p.vadObservations.find((v) => v.id === targetId)?.sourceIntervals ?? [],
    ),
    runtime,
    recordedCtcRequests: results.length,
    newAsrRequests: 0,
    textMutation: 0,
    timingMutation: 0,
    qualityStatus: "needs-review",
    finalizationMethod: "none",
    referenceUsed: false,
    labelsUsed: false,
  };
}
export async function finishAssociation(root) {
  const p = await load(root),
    result = await replay(root, p);
  assert.equal((await json(path.join(root, "exit.json"))).exitCode, 0);
  await put(path.join(root, "result.json"), result);
  await fs.copyFile(
    path.join(p.sourceRoot, "local-recovery.machine-candidate.srt"),
    path.join(root, "preserved.machine-candidate.srt"),
    fs.constants.COPYFILE_EXCL,
  );
  const names = [
    "plan.json",
    "plan-freeze.json",
    "execution-reservation.json",
    "exit.json",
    "ready.json",
    "result.json",
    "preserved.machine-candidate.srt",
    ...p.association.requests.flatMap((q) =>
      ["input.wav", "raw.json", "reserved.json"].map((n) => `${q.id}/${n}`),
    ),
  ];
  await put(path.join(root, "machine-freeze.json"), {
    files: Object.fromEntries(
      await Promise.all(
        names.map(async (n) => [n, await fileHash(path.join(root, n))]),
      ),
    ),
  });
  return { root, timing: result.timing, textMutation: 0, timingMutation: 0 };
}
export async function verifyAssociation(root) {
  const p = await load(root);
  const frozen = await json(path.join(root, "machine-freeze.json"));
  for (const [n, h] of Object.entries(frozen.files)) {
    assert(
      !path.isAbsolute(n) && !n.split(/[\\/]/u).includes(".."),
      "UNSAFE_PATH",
    );
    await safePath(path.join(root, n));
    assert.equal(await fileHash(path.join(root, n)), h, `CHANGED:${n}`);
  }
  assert.deepEqual(
    await replay(root, p),
    await json(path.join(root, "result.json")),
  );
  assert.equal(
    await fileHash(path.join(root, "preserved.machine-candidate.srt")),
    await fileHash(
      path.join(p.sourceRoot, "local-recovery.machine-candidate.srt"),
    ),
  );
  return {
    root,
    integrity: "passed",
    newInference: 0,
    recordedCtcRequests: 2,
    textMutation: 0,
    timingMutation: 0,
    qualityStatus: "needs-review",
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [cmd, a, b, c] = process.argv.slice(2);
  try {
    const result =
      cmd === "prepare"
        ? await prepareAssociation(a, (await json(b)).ctc, c)
        : cmd === "run"
          ? await runAssociation(a, b === "--authorize-local")
          : cmd === "finish"
            ? await finishAssociation(a)
            : cmd === "verify"
              ? await verifyAssociation(a)
              : (() => {
                  throw Error(
                    "prepare SOURCE RUNTIME_SPEC OUTPUT | run ROOT --authorize-local | finish ROOT | verify ROOT",
                  );
                })();
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  }
}
