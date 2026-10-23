/** One explicitly bounded CTC observation of a missing prefix, using a saved crop. */
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { safePath } from "../packages/video-subtitler/dist/standalone/recovery.js";
import { EvidenceRunner, durable, readPcm } from "./lib/bounded-asr-ab.mjs";
import { verifyOccurrenceReplay } from "./replay-context-occurrences.mjs";
import { preserveRunnerLogs } from "./subtitle-tool-context-ctc.mjs";
import {
  leadingCtcPolicy,
  leadingCtcRequest,
  inspectLeadingCtc,
} from "./lib/leading-ctc-observation.mjs";
const json = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const put = (root, name, value) => durable(path.join(root, name), value, true);
const bridge = path.join(
  import.meta.dirname,
  "runtime/leading_ctc_observation.py",
);
const bind = async (file) => ({
  file: await fs.realpath(file),
  sha256: await fileHash(file),
});
const exists = (file) =>
  fs.access(file).then(
    () => true,
    () => false,
  );

export async function prepareLeadingCtc(source, output) {
  source = path.resolve(source);
  output = path.resolve(output);
  await verifyOccurrenceReplay(source);
  const result = await json(path.join(source, "reconciliation.json")),
    provenance = await json(path.join(source, "provenance.json"));
  const prefixes = result.prefixes.filter(
    (p) => p.independentObservationCoverage === "outside-observation-window",
  );
  assert.equal(prefixes.length, 1, "ONE_UNCOVERED_PREFIX_REQUIRED");
  const wordsRoot = provenance.roots.words,
    wordPlan = await json(path.join(wordsRoot, "plan.json"));
  const request = wordPlan.requests.find((r) => r.id === prefixes[0].requestId),
    q = leadingCtcRequest(request, prefixes[0]);
  const old = await json(path.join(provenance.roots.ctc, "plan.json"));
  const original = path.join(wordsRoot, request.id, "input.wav"),
    bytes = await fs.readFile(original);
  assert.equal(await fileHash(original), q.wavHash);
  const pcm = readPcm(bytes);
  assert.equal(pcm.frames, q.frames);
  assert.equal(pcm.sampleRate, 16000);
  const modelFiles = (await fs.readdir(old.ctc.model)).map((n) =>
    path.join(old.ctc.model, n),
  );
  for (const file of [...modelFiles, old.ctc.python]) {
    const real = await fs.realpath(file),
      b = old.bindings.find((b) => b.file === real);
    assert(b, "PINNED_RUNTIME_BINDING_MISSING");
    assert.equal(await fileHash(real), b.sha256, "RUNTIME_CHANGED");
  }
  const files = [
    ...modelFiles,
    old.ctc.python,
    original,
    import.meta.filename,
    bridge,
    path.join(import.meta.dirname, "runtime/ctc_worker.py"),
    path.join(import.meta.dirname, "lib/leading-ctc-observation.mjs"),
    path.join(import.meta.dirname, "lib/context-ctc-contrast.mjs"),
    path.join(import.meta.dirname, "lib/bounded-asr-ab.mjs"),
    path.join(import.meta.dirname, "subtitle-tool-context-ctc.mjs"),
    ...["freeze.json", "reconciliation.json", "provenance.json"].map((n) =>
      path.join(source, n),
    ),
  ];
  const bindings = await Promise.all(files.map(bind));
  await safePath(output, true);
  assert(
    !output.startsWith(source + path.sep) && output !== source,
    "OUTPUT_INSIDE_SOURCE",
  );
  await fs.mkdir(output, { recursive: true });
  const root = await fs.mkdtemp(path.join(output, "leading-ctc-"));
  await fs.writeFile(path.join(root, "input.wav"), bytes, { flag: "wx" });
  await put(root, "plan.json", {
    policy: leadingCtcPolicy,
    source,
    sourceAudioHash: result.sourceAudioHash,
    request: q,
    ctc: old.ctc,
    bindings,
    referenceUsed: false,
    labelsUsed: false,
    mode: "observe-only",
  });
  await put(root, "plan-freeze.json", {
    planHash: await fileHash(path.join(root, "plan.json")),
  });
  return {
    root,
    requests: 1,
    seconds: q.frames / 16000,
    sourceWindow: { start: q.start, end: q.end },
    focus: q.focus,
  };
}
async function load(root, savedOnly = false) {
  await safePath(root);
  const frozen = await json(path.join(root, "plan-freeze.json"));
  assert.equal(
    await fileHash(path.join(root, "plan.json")),
    frozen.planHash,
    "PLAN_CHANGED",
  );
  const p = await json(path.join(root, "plan.json"));
  assert.deepEqual(p.policy, leadingCtcPolicy);
  assert.equal(p.referenceUsed, false);
  assert.equal(p.labelsUsed, false);
  for (const b of p.bindings) {
    if ((await fileHash(b.file)) === b.sha256) continue;
    assert(
      savedOnly && b.file === import.meta.filename,
      `INPUT_CHANGED:${b.file}`,
    );
    const snapshot = path.join(root, "execution-source-runner.mjs");
    await safePath(snapshot);
    assert.equal(
      await fileHash(snapshot),
      b.sha256,
      "EXECUTION_SOURCE_SNAPSHOT_CHANGED",
    );
  }
  assert(
    p.request.frames > 0 && p.request.frames <= 8 * 16000,
    "REQUEST_BUDGET",
  );
  assert.equal(
    await fileHash(path.join(root, "input.wav")),
    p.request.wavHash,
    "AUDIO_CHANGED",
  );
  return p;
}
export function vocabularyHash(vocab) {
  // Object enumeration reorders integer-like tokens; serialize sorted entries
  // directly to match Python json.dumps(sort_keys=True, ensure_ascii=False).
  const entries = Object.entries(vocab).sort(([a], [b]) => {
    const left = Array.from(a, (c) => c.codePointAt(0)),
      right = Array.from(b, (c) => c.codePointAt(0));
    for (let i = 0; i < Math.min(left.length, right.length); i++)
      if (left[i] !== right[i]) return left[i] - right[i];
    return left.length - right.length;
  });
  const canonical =
    "{" +
    entries
      .map(([k, v]) => JSON.stringify(k) + ":" + JSON.stringify(v))
      .join(",") +
    "}";
  return createHash("sha256").update(canonical).digest("hex");
}
async function analyze(root, p) {
  const ready = await json(path.join(root, "ready.json")),
    raw = await json(path.join(root, "raw.json"));
  assert.equal(ready.deviceUsed, "cpu");
  assert.equal(ready.modelLoadCount, 1);
  const dispatch = await json(path.join(root, "dispatch.json"));
  assert.deepEqual(dispatch.request, {
    type: "align",
    requestId: p.request.id,
    audioPath: path.join(root, "input.wav"),
    audioFrameStart: 0,
    audioFrameEnd: p.request.frames,
    device: "cpu",
    alignmentAlgorithmVersion: "mvl-ctc-viterbi-v1",
    targetText: p.request.targetText,
    mediaGlobalStart: p.request.start,
  });
  const events = (await fs.readFile(path.join(root, "stdout.log"), "utf8"))
    .trim()
    .split("\n")
    .map((s) => JSON.parse(s));
  assert.deepEqual(events, [ready, raw], "WORKER_RECEIPT_MISMATCH");
  const vocab = await json(path.join(root, "runtime-vocabulary.json"));
  assert.equal(
    vocabularyHash(vocab),
    ready.tokenizerVocabularyHash,
    "VOCABULARY_IDENTITY",
  );
  if (!(await exists(path.join(root, "greedy-frames.json"))))
    return {
      executionStatus: "no-saved-greedy-forward",
      raw,
      modelLoads: 1,
      observedCtcForwards: 0,
      subtitleMutations: 0,
      qualityStatus: "needs-review",
      finalizationMethod: "none",
    };
  const observation = await json(path.join(root, "greedy-frames.json"));
  return {
    ...inspectLeadingCtc(p.request, raw, observation, ready, vocab),
    executionStatus: "completed-observation",
    runtime: ready,
    modelLoads: 1,
    observedCtcForwards: 1,
    requestSeconds: p.request.frames / 16000,
    whisperRequests: 0,
    mfaRequests: 0,
    sourceAudioHash: p.sourceAudioHash,
  };
}
export async function runLeadingCtc(
  root,
  authorized,
  runner = new EvidenceRunner(),
) {
  assert.equal(authorized, true, "AUTHORIZE_LOCAL_REQUIRED");
  root = path.resolve(root);
  const p = await load(root);
  await put(root, "execution-reservation.json", {
    planHash: await fileHash(path.join(root, "plan.json")),
    requests: 1,
    retries: 0,
  });
  let r;
  try {
    r = await runner.run(p.ctc.python, [bridge, root], {
      cwd: root,
      timeoutMs: 180000,
    });
  } catch (e) {
    await put(root, "launch-error.json", { message: String(e), retries: 0 });
    throw e;
  }
  await put(root, "exit.json", {
    exitCode: r.exitCode,
    signal: r.signal ?? null,
  });
  await preserveRunnerLogs(root, r);
  assert.equal(r.exitCode, 0, "CTC_FAILED_NO_RETRY");
  return finishLeadingCtc(root, false);
}
export async function finishLeadingCtc(root, savedOnly = true) {
  const p = await load(root, savedOnly);
  assert.equal(
    (await json(path.join(root, "exit.json"))).exitCode,
    0,
    "SAVED_PROCESS_DID_NOT_EXIT_SUCCESSFULLY",
  );
  const result = await analyze(root, p);
  await load(root, savedOnly);
  if (savedOnly)
    await put(root, "analysis-recovery-receipt.json", {
      reason:
        "JavaScript integer-key ordering differed from Python sorted vocabulary JSON",
      modelRerun: false,
      newInference: 0,
      processExitCode: 0,
      executionSourceSnapshot: "execution-source-runner.mjs",
      analysisBinding: await bind(import.meta.filename),
    });
  await put(root, "result.json", result);
  const names = [
    "plan.json",
    "plan-freeze.json",
    "input.wav",
    "execution-reservation.json",
    "worker-reservation.json",
    "ready.json",
    "runtime-vocabulary.json",
    "dispatch.json",
    "raw.json",
    "exit.json",
    "stdout.log",
    "stderr.log",
    "result.json",
  ];
  if (await exists(path.join(root, "greedy-frames.json")))
    names.push("greedy-frames.json");
  if (savedOnly)
    names.push("analysis-recovery-receipt.json", "execution-source-runner.mjs");
  const files = {};
  for (const n of names) files[n] = await fileHash(path.join(root, n));
  await put(root, "machine-freeze.json", { files });
  return { root, ...(await verifyLeadingCtc(root)) };
}
export async function verifyLeadingCtc(root) {
  const recovered = await exists(
    path.join(root, "analysis-recovery-receipt.json"),
  );
  if (recovered) {
    const receipt = await json(
      path.join(root, "analysis-recovery-receipt.json"),
    );
    assert.equal(receipt.analysisBinding.file, import.meta.filename);
    assert.equal(
      await fileHash(import.meta.filename),
      receipt.analysisBinding.sha256,
      "ANALYSIS_CODE_CHANGED",
    );
  }
  const p = await load(root, recovered),
    f = await json(path.join(root, "machine-freeze.json"));
  for (const [n, h] of Object.entries(f.files)) {
    assert(path.basename(n) === n, "UNSAFE_FILE_NAME");
    await safePath(path.join(root, n));
    assert.equal(await fileHash(path.join(root, n)), h, `OUTPUT_CHANGED:${n}`);
  }
  const result = await analyze(root, p);
  assert.deepEqual(await json(path.join(root, "result.json")), result);
  assert.equal((await json(path.join(root, "exit.json"))).exitCode, 0);
  return {
    integrity: "passed",
    newInference: 0,
    recordedCtcForwards: result.observedCtcForwards,
    recordedModelLoads: result.modelLoads,
    subtitleMutations: 0,
    interpretation: result.interpretation ?? result.executionStatus,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [cmd, a, b] = process.argv.slice(2);
  assert(
    ["prepare", "run", "verify", "finish-saved"].includes(cmd),
    "prepare REPLAY OUTPUT | run ROOT --authorize-local | verify ROOT | finish-saved ROOT",
  );
  console.log(
    JSON.stringify(
      cmd === "prepare"
        ? await prepareLeadingCtc(a, b)
        : cmd === "run"
          ? await runLeadingCtc(a, b === "--authorize-local")
          : cmd === "finish-saved"
            ? await finishLeadingCtc(a)
            : await verifyLeadingCtc(a),
      null,
      2,
    ),
  );
}
