/** Frozen listening clips -> bounded local VAD diagnostic -> separate labelled evaluation. */
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  verifyListening,
  evaluateListening,
} from "./lib/audio-coverage-calibration.mjs";
import { EvidenceRunner, readPcm } from "./lib/bounded-asr-ab.mjs";
import { safePath } from "../packages/video-subtitler/dist/standalone/recovery.js";

const repo = path.resolve(import.meta.dirname, "..");
const hash = (b) => createHash("sha256").update(b).digest("hex");
const read = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const put = (p, v) =>
  fs.writeFile(p, JSON.stringify(v, null, 2) + "\n", { flag: "wx" });
export const listeningVadPolicy = Object.freeze({
  version: "listening-target-vad-v1",
  maxRequests: 16,
  maxAudioSeconds: 60,
  retries: 0,
  asrRequests: 0,
  decision: "target-covered-by-vad-segments-at-least-half",
  targetCoverageThreshold: 0.5,
  endpointToleranceSeconds: 0.05,
  negativeMeaning: "detector-unsupported-not-confirmed-nonspeech",
  subtitleMutationAuthorized: false,
});
export const vadProfile = Object.freeze({
  threshold: 0.5,
  minSpeechMs: 150,
  minSilenceMs: 100,
  maxSpeechSeconds: 30,
  speechPadMs: 0,
  samplesOverlap: 0,
});
const bind = async (file) => {
  file = await fs.realpath(file);
  return { file, sha256: hash(await fs.readFile(file)) };
};
const check = async (bindings) => {
  for (const b of bindings)
    assert.equal(
      hash(await fs.readFile(b.file)),
      b.sha256,
      `CHANGED:${b.file}`,
    );
};

export function summarizeVad(item, raw) {
  assert.equal(raw.rawUnit, "CENTISECONDS", "VAD_UNIT");
  assert.equal(raw.sampleRate, 16000, "VAD_SAMPLE_RATE");
  assert.equal(raw.inputFrames, item.frames, "VAD_FRAME_COUNT");
  assert.equal(raw.modelLoadCount, 1, "MODEL_LOAD_COUNT");
  assert.equal(raw.inferencePasses, 1, "INFERENCE_COUNT");
  assert.equal(raw.device, "cpu", "DEVICE_CHANGED");
  assert.equal(
    raw.stateIsolation,
    "WHISPER_VAD_DETECT_SPEECH_RESETS_LSTM",
    "STATE_ISOLATION",
  );
  assert(
    Array.isArray(raw.probabilities) &&
      raw.probabilities.length > 0 &&
      raw.probabilities.every((p) => Number.isFinite(p) && p >= 0 && p <= 1),
    "INVALID_PROBABILITIES",
  );
  const duration = item.frames / 16000,
    adjustments = [];
  assert(
    item.localTargetStart >= 0 &&
      item.localTargetEnd > item.localTargetStart &&
      item.localTargetEnd <= duration,
    "INVALID_TARGET",
  );
  const intervals = raw.rawIntervals.map((r, i) => {
    const start = r.start / 100,
      end = r.end / 100;
    assert(
      Number.isFinite(start) &&
        Number.isFinite(end) &&
        start >= 0 &&
        end > start &&
        end <= duration + 0.05 + 1e-8,
      "INVALID_RAW_INTERVAL",
    );
    assert(
      !i || start >= raw.rawIntervals[i - 1].end / 100,
      "OVERLAPPING_RAW_INTERVALS",
    );
    if (end > duration)
      adjustments.push({
        index: i,
        rawEnd: end,
        normalizedEnd: duration,
        delta: duration - end,
        reason: "BOUNDED_ENDPOINT_TOLERANCE",
      });
    assert(start < duration, "START_OUTSIDE_CLIP");
    return { start, end: Math.min(duration, end) };
  });
  const covered = intervals.reduce(
    (n, r) =>
      n +
      Math.max(
        0,
        Math.min(r.end, item.localTargetEnd) -
          Math.max(r.start, item.localTargetStart),
      ),
    0,
  );
  const fraction = covered / (item.localTargetEnd - item.localTargetStart);
  return {
    id: item.id,
    cohort: item.cohort,
    targetCoverageFraction: fraction,
    targetSupported: fraction >= 0.5,
    clipHasDetection: intervals.length > 0,
    anyTargetOverlap: covered > 0,
    intervals,
    endpointAdjustments: adjustments,
    wholeClipPeakProbability: Math.max(...raw.probabilities),
    peakProbabilityUse: "diagnostic-only-not-located-to-target",
    sourceIntervals: intervals.map((r) => ({
      start: item.start + r.start,
      end: item.start + r.end,
    })),
    negativeMeaning: listeningVadPolicy.negativeMeaning,
    subtitleMutationAuthorized: false,
  };
}

export async function prepareListeningVad(listeningRoot, spec, outputParent) {
  listeningRoot = path.resolve(listeningRoot);
  outputParent = path.resolve(outputParent);
  assert(
    outputParent !== listeningRoot &&
      !outputParent.startsWith(listeningRoot + path.sep),
    "OUTPUT_INSIDE_INPUT",
  );
  await safePath(outputParent, true);
  const { manifest, manifestHash } = await verifyListening(listeningRoot);
  assert(
    manifest.items.length > 0 && manifest.items.length <= 16,
    "REQUEST_BUDGET",
  );
  const ids = new Set(),
    items = [],
    inputs = [];
  for (const c of manifest.items) {
    assert(/^clip-\d+$/u.test(c.id) && !ids.has(c.id), "INVALID_CLIP_ID");
    ids.add(c.id);
    assert.equal(c.audio, `audio/${c.id}.wav`, "AUDIO_PATH");
    const file = path.join(listeningRoot, c.audio);
    await safePath(file);
    const bytes = await fs.readFile(file);
    assert.equal(hash(bytes), c.audioHash, "AUDIO_HASH");
    const pcm = readPcm(bytes);
    assert.equal(pcm.sampleRate, 16000);
    assert.equal(pcm.frames, c.endFrame - c.firstFrame);
    assert(
      Math.abs(c.end - c.start - pcm.frames / 16000) < 1e-8,
      "CLIP_DURATION",
    );
    const item = {
      id: c.id,
      cohort: c.cohort,
      start: c.start,
      end: c.end,
      localTargetStart: c.targetStart - c.start,
      localTargetEnd: c.targetEnd - c.start,
      frames: pcm.frames,
      audioPath: file,
      audioHash: c.audioHash,
    };
    assert(
      item.localTargetStart >= 0 &&
        item.localTargetEnd > item.localTargetStart &&
        item.localTargetEnd <= pcm.frames / 16000,
      "TARGET_RANGE",
    );
    items.push(item);
    inputs.push({ file, sha256: c.audioHash });
  }
  const seconds = items.reduce((n, i) => n + i.frames / 16000, 0);
  assert(seconds <= 60 + 1e-8, "AUDIO_BUDGET");
  const runtime = {
    python: await fs.realpath(spec.python),
    model: await fs.realpath(spec.vadModel),
    library: await fs.realpath(spec.vadLibrary),
  };
  const identities = await Promise.all(Object.values(runtime).map(bind));
  const software = await Promise.all(
    [
      "scripts/subtitle-tool-listening-vad.mjs",
      "scripts/lib/audio-coverage-calibration.mjs",
      "scripts/lib/bounded-asr-ab.mjs",
      "scripts/runtime/bounded_silero.py",
      "scripts/runtime/c601141_speech_activity_worker.py",
    ].map((n) => bind(path.join(repo, n))),
  );
  inputs.push(
    await bind(path.join(listeningRoot, "listening-manifest.json")),
    await bind(path.join(listeningRoot, "listening-freeze.json")),
  );
  await fs.mkdir(outputParent, { recursive: true });
  const root = await fs.mkdtemp(path.join(outputParent, "listening-vad-"));
  const plan = {
    policy: listeningVadPolicy,
    profile: vadProfile,
    listeningRoot,
    manifestHash,
    items,
    seconds,
    runtime,
    identities,
    software,
    inputs,
    annotationInput: false,
  };
  await put(path.join(root, "plan.json"), plan);
  await put(path.join(root, "plan-freeze.json"), {
    planHash: hash(await fs.readFile(path.join(root, "plan.json"))),
  });
  return { root, requests: items.length, seconds };
}

async function loadPlan(root) {
  await safePath(root);
  const bytes = await fs.readFile(path.join(root, "plan.json"));
  assert.equal(
    hash(bytes),
    (await read(path.join(root, "plan-freeze.json"))).planHash,
    "PLAN_CHANGED",
  );
  const p = JSON.parse(bytes);
  assert.deepEqual(p.policy, listeningVadPolicy);
  assert.deepEqual(p.profile, vadProfile);
  await check([...p.inputs, ...p.identities, ...p.software]);
  return p;
}
async function inventory(root) {
  const files = {};
  for (const e of await fs.readdir(root, { withFileTypes: true })) {
    assert(!e.isSymbolicLink(), "SYMLINK_OUTPUT");
    if (e.isDirectory())
      for (const [n, h] of Object.entries(
        await inventory(path.join(root, e.name)),
      ))
        files[e.name + "/" + n] = h;
    else files[e.name] = hash(await fs.readFile(path.join(root, e.name)));
  }
  return files;
}

export async function runListeningVad(
  root,
  { authorize = false, runner = new EvidenceRunner() } = {},
) {
  assert(authorize, "LOCAL_AUTHORIZATION_REQUIRED");
  const p = await loadPlan(root);
  await put(path.join(root, "execution-reservation.json"), {
    requests: p.items.length,
    seconds: p.seconds,
    retries: 0,
    asrRequests: 0,
  });
  const observations = [];
  try {
    for (const item of p.items) {
      const dir = path.join(root, item.id);
      await fs.mkdir(dir);
      const request = {
        authorized: true,
        dispatchReserved: true,
        audioPath: item.audioPath,
        model: p.runtime.model,
        library: p.runtime.library,
        receiptPath: path.join(dir, "phases.jsonl"),
        profile: p.profile,
      };
      const requestPath = path.join(dir, "request.json");
      await put(requestPath, request);
      const args = [
        path.join(repo, "scripts/runtime/bounded_silero.py"),
        "--request",
        requestPath,
      ];
      await put(path.join(dir, "dispatch.json"), {
        executable: p.runtime.python,
        args,
      });
      const result = await runner.run(p.runtime.python, args, {
        cwd: dir,
        timeoutMs: 60000,
      });
      await put(path.join(dir, "exit.json"), {
        exitCode: result.exitCode,
        signal: result.signal ?? null,
      });
      assert.equal(result.exitCode, 0, "VAD_FAILED_NO_RETRY");
      const raw = JSON.parse(result.stdout);
      await put(path.join(dir, "raw.json"), raw);
      const phases = (await fs.readFile(request.receiptPath, "utf8"))
        .trim()
        .split("\n")
        .map((s) => JSON.parse(s).phase);
      for (const phase of [
        "model-loaded",
        "inference-pass-reserved",
        "inference-pass-completed",
      ])
        assert.equal(
          phases.filter((s) => s === phase).length,
          1,
          "PHASE_COUNT",
        );
      observations.push(summarizeVad(item, raw));
    }
    await check([...p.inputs, ...p.identities, ...p.software]);
    await put(path.join(root, "observations.json"), {
      policy: p.policy,
      observations,
      vadPasses: observations.length,
      modelLoads: observations.length,
      seconds: p.seconds,
      asrRequests: 0,
      subtitleMutations: 0,
    });
    await put(path.join(root, "machine-freeze.json"), {
      files: await inventory(root),
      labelsRead: false,
    });
    return {
      root,
      vadPasses: observations.length,
      seconds: p.seconds,
      targetSupported: observations.filter((o) => o.targetSupported).length,
      asrRequests: 0,
    };
  } catch (e) {
    await put(path.join(root, "failure.json"), {
      error: e.message,
      completed: observations.length,
      retries: 0,
    });
    throw e;
  }
}

export async function verifyListeningVad(root) {
  const p = await loadPlan(root),
    f = await read(path.join(root, "machine-freeze.json"));
  for (const n of [
    "observations.json",
    "execution-reservation.json",
    "plan.json",
  ])
    assert(f.files[n], "INCOMPLETE_FREEZE");
  for (const [n, h] of Object.entries(f.files)) {
    assert(
      !path.isAbsolute(n) && !n.split(/[\\/]/u).includes(".."),
      "UNSAFE_FREEZE_PATH",
    );
    await safePath(path.join(root, n));
    assert.equal(
      hash(await fs.readFile(path.join(root, n))),
      h,
      "OUTPUT_CHANGED",
    );
  }
  const saved = await read(path.join(root, "observations.json"));
  const replay = [];
  for (const i of p.items)
    replay.push(summarizeVad(i, await read(path.join(root, i.id, "raw.json"))));
  assert.deepEqual(replay, saved.observations, "REPLAY_MISMATCH");
  return { plan: p, ...saved };
}

export function compareVadLabels(observations, labels) {
  assert.equal(
    new Set(observations.map((o) => o.id)).size,
    observations.length,
    "DUPLICATE_OBSERVATION",
  );
  assert.equal(
    new Set(labels.map((o) => o.id)).size,
    labels.length,
    "DUPLICATE_LABEL",
  );
  assert.equal(observations.length, labels.length, "CASE_COUNT");
  const cases = observations.map((o) => {
    const l = labels.find((l) => l.id === o.id);
    assert(l, "MISSING_LABEL");
    const truth = ["speech", "mixed-speech"].includes(l.sound)
      ? true
      : ["music", "effect", "noise"].includes(l.sound)
        ? false
        : null;
    return {
      ...o,
      labelSound: l.sound,
      labelRelation: l.relation,
      truth,
      outcome:
        truth === null
          ? "unscored"
          : truth
            ? o.targetSupported
              ? "TP"
              : "FN"
            : o.targetSupported
              ? "FP"
              : "TN",
    };
  });
  const summary = {};
  for (const cohort of ["all", "ranked", "reserve"]) {
    const rows = cases.filter((c) => cohort === "all" || c.cohort === cohort),
      count = (k) => rows.filter((c) => c.outcome === k).length;
    const TP = count("TP"),
      FP = count("FP"),
      TN = count("TN"),
      FN = count("FN");
    summary[cohort] = {
      TP,
      FP,
      TN,
      FN,
      unscored: count("unscored"),
      precision: TP + FP ? TP / (TP + FP) : null,
      recall: TP + FN ? TP / (TP + FN) : null,
    };
  }
  return { cases, summary };
}

export async function evaluateListeningVad(root, annotationDirectory) {
  const run = await verifyListeningVad(root);
  const { manifest, manifestHash } = await verifyListening(
    run.plan.listeningRoot,
  );
  const labelBytes = await fs.readFile(
    path.join(annotationDirectory, "labels.json"),
  );
  const prior = await read(path.join(annotationDirectory, "evaluation.json"));
  assert.equal(prior.labelsHash, hash(labelBytes), "ANNOTATION_HASH");
  assert.equal(prior.manifestHash, manifestHash, "ANNOTATION_MANIFEST");
  const labels = JSON.parse(labelBytes);
  evaluateListening(manifest, manifestHash, labels);
  const context = await read(
    path.join(annotationDirectory, "annotation-context.json"),
  );
  assert.equal(
    context.annotationMode,
    "reference-assisted-user-listening",
    "ANNOTATION_CONTEXT",
  );
  assert.equal(
    context.referenceAssistance,
    true,
    "REFERENCE_ASSISTANCE_REQUIRED",
  );
  const comparison = compareVadLabels(run.observations, labels.labels);
  const report = {
    ...comparison,
    labelsHash: hash(labelBytes),
    annotationContext: context,
    machineFreezeHash: hash(
      await fs.readFile(path.join(root, "machine-freeze.json")),
    ),
    evaluationMode: "known-development-reference-assisted-labels",
    independentHoldout: false,
    automaticFilteringAuthorized: false,
    asrAccuracyGain: null,
    subtitleMutations: 0,
    qualityStatus: "needs-review",
  };
  await put(path.join(root, "label-evaluation.json"), report);
  return comparison.summary;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const [mode, ...args] = process.argv.slice(2);
    let r;
    if (mode === "prepare" && args.length === 3)
      r = await prepareListeningVad(args[0], await read(args[1]), args[2]);
    else if (
      mode === "run" &&
      args.length === 2 &&
      args[1] === "--authorize-local"
    )
      r = await runListeningVad(args[0], { authorize: true });
    else if (mode === "verify" && args.length === 1) {
      const v = await verifyListeningVad(args[0]);
      r = { integrity: "passed", vadPasses: v.vadPasses };
    } else if (mode === "evaluate" && args.length === 2)
      r = await evaluateListeningVad(...args);
    else
      throw Error(
        "Usage: prepare LISTENING_ROOT LOCAL_SPEC OUTPUT_PARENT | run RUN_ROOT --authorize-local | verify RUN_ROOT | evaluate RUN_ROOT ANNOTATION_DIRECTORY",
      );
    console.log(JSON.stringify(r, null, 2));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
