/** Explicit bounded onset-only development run; never imported by default generation. */
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { safePath } from "../packages/video-subtitler/dist/standalone/recovery.js";
import {
  serializeRecords,
  formats,
} from "../packages/video-subtitler/dist/standalone/bounded.js";
import { readPcm, slicePcm, EvidenceRunner } from "./lib/bounded-asr-ab.mjs";
import { verifyContextDelivery } from "./lib/seam-context-delivery.mjs";
import {
  onsetPolicy,
  planOnsets,
  decideOnset,
  applyOnsets,
  accountOnsetContinuation,
} from "./lib/timing-onset-recovery.mjs";
import { vadProfile } from "./subtitle-tool-listening-vad.mjs";
import { inspectInterruptedOnset } from "./lib/onset-interrupted-resume.mjs";
const json = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const put = (p, v) =>
  fs.writeFile(
    p,
    typeof v === "string" || v instanceof Uint8Array
      ? v
      : JSON.stringify(v, null, 2) + "\n",
    { flag: "wx" },
  );
const bind = async (p) => ({
  file: await fs.realpath(p),
  sha256: await fileHash(p),
});
const check = async (bindings) => {
  for (const b of bindings)
    assert.equal(await fileHash(b.file), b.sha256, `INPUT_CHANGED:${b.file}`);
};
const repo = path.resolve(import.meta.dirname, "..");
function timingContract(runtime) {
  try {
    return JSON.parse(
      execFileSync(
        runtime.python,
        [
          path.join(repo, "scripts/runtime/ct2_timing_contract.py"),
          runtime.asrModel ?? runtime.kotobaModel,
        ],
        { encoding: "utf8", timeout: 10000 },
      ),
    );
  } catch (e) {
    throw new Error(
      `WORD_TIMING_RUNTIME_UNSUPPORTED: ${e.stdout ?? e.message}`,
      { cause: e },
    );
  }
}

export async function prepareOnsetRun(specPath, output) {
  const spec = await json(specPath);
  // Metadata-only preflight before crops, reservations, or native model loads.
  const contract = timingContract(spec.runtime);
  await verifyContextDelivery(spec.parent);
  const f = await json(path.join(spec.parent, "machine-freeze.json"));
  const seamPlan = await json(path.join(f.input, "plan.json"));
  const task = seamPlan.task;
  const taskPlan = await json(path.join(task, "bounded-plan.json"));
  const baseline = (await json(path.join(spec.parent, "result.json")))
    .candidate;
  const rawBaseline = await json(path.join(f.input, "baseline-records.json"));
  const planned = planOnsets(
    baseline,
    spec.cueNumbers,
    taskPlan.duration,
    taskPlan.audioOffset,
  );
  const previousFiles = spec.previousFailure
    ? ["plan.json", "failure-audit.json", "exit.json"].map((n) =>
        path.join(spec.previousFailure, n),
      )
    : [];
  const continuation = spec.previousFailure
    ? accountOnsetContinuation(
        planned.targets,
        await json(previousFiles[0]),
        await json(previousFiles[1]),
        await json(previousFiles[2]),
      )
    : null;
  const interrupted = await inspectInterruptedOnset(
    spec.resumeInterrupted,
    planned.targets,
    spec.runtime.asrModel ?? spec.runtime.kotobaModel,
  );
  const audio = path.join(task, "audio.wav");
  assert.equal(await fileHash(audio), taskPlan.audioHash);
  const pcm = readPcm(await fs.readFile(audio));
  assert.equal(pcm.sampleRate, 16000);
  assert.equal(pcm.frames, taskPlan.fullFrames);
  output = path.resolve(output);
  await safePath(output, true);
  for (const source of [spec.parent, task, f.input])
    assert(
      output !== path.resolve(source) &&
        !output.startsWith(path.resolve(source) + path.sep),
      "OUTPUT_INSIDE_SOURCE",
    );
  const mappings = [];
  for (const t of planned.targets) {
    const row = baseline[t.cueNumber - 1];
    assert.deepEqual(
      rawBaseline.find((r) => r.recordId === t.recordId),
      row,
      "TARGET_MUST_BE_UNMODIFIED_RAW_CUE",
    );
    const request = await json(
      path.join(task, "requests", row.requestId, "request.json"),
    );
    const computedStart = request.sourceOffset + row.localStart;
    const computedEnd = request.sourceOffset + row.localEnd;
    assert(
      Math.abs(computedStart - row.sourceStart) < 1e-7 &&
        Math.abs(computedEnd - row.sourceEnd) < 1e-7,
      "TIMEBASE_MAPPING_ERROR",
    );
    mappings.push({
      recordId: t.recordId,
      requestId: row.requestId,
      sourceOffset: request.sourceOffset,
      rawLocalStart: row.localStart,
      rawLocalEnd: row.localEnd,
      computedStart,
      computedEnd,
      mappedStart: row.sourceStart,
      mappedEnd: row.sourceEnd,
      offsetAppliedExactlyOnce: true,
    });
  }
  const runtime = {
    ...spec.runtime,
    asrModel: spec.runtime.asrModel ?? spec.runtime.kotobaModel,
  };
  delete runtime.kotobaModel;
  for (const key of ["python", "asrModel", "vadModel", "vadLibrary"])
    runtime[key] = await fs.realpath(runtime[key]);
  const inputs = await Promise.all(
    [
      specPath,
      path.join(spec.parent, "machine-freeze.json"),
      path.join(spec.parent, "result.json"),
      audio,
      ...previousFiles,
    ].map(bind),
  );
  inputs.push(...interrupted.bindings);
  const identities = await Promise.all(
    [
      runtime.python,
      runtime.vadModel,
      runtime.vadLibrary,
      ...[
        "model.bin",
        "config.json",
        "tokenizer.json",
        "preprocessor_config.json",
        "vocabulary.json",
      ].map((n) => path.join(runtime.asrModel, n)),
    ].map(bind),
  );
  const software = await Promise.all(
    [
      "scripts/subtitle-tool-timing-onset.mjs",
      "scripts/lib/timing-onset-recovery.mjs",
      "scripts/runtime/timing_onset_probe.py",
      "scripts/runtime/timing_onset_isolated.py",
      "scripts/lib/onset-interrupted-resume.mjs",
      "scripts/runtime/ct2_timing_contract.py",
      "scripts/runtime/bounded_silero.py",
      "scripts/runtime/c601141_speech_activity_worker.py",
    ].map((n) => bind(path.join(repo, n))),
  );
  await fs.mkdir(output, { recursive: true });
  const root = await fs.mkdtemp(path.join(output, "onset-"));
  for (const t of planned.targets) {
    const dir = path.join(root, t.id);
    await fs.mkdir(dir);
    await put(
      path.join(dir, "input.wav"),
      slicePcm(pcm, t.firstFrame, t.endFrame),
    );
    t.audioHash = await fileHash(path.join(dir, "input.wav"));
    const reused = interrupted.reuse.find((r) => r.id === t.id);
    if (reused)
      await put(path.join(dir, "asr.json"), await fs.readFile(reused.source));
  }
  await put(path.join(root, "plan.json"), {
    parent: path.resolve(spec.parent),
    planned,
    baseline,
    mappings,
    runtime,
    identities,
    software,
    inputs,
    vadProfile,
    duration: taskPlan.duration,
    audioOffset: taskPlan.audioOffset,
    referenceUsedForTextOrTiming: false,
    timingContract: contract,
    continuation,
    previousFailure: spec.previousFailure ?? null,
    resumeInterrupted: spec.resumeInterrupted ?? null,
    interrupted,
  });
  await put(path.join(root, "plan-freeze.json"), {
    planHash: await fileHash(path.join(root, "plan.json")),
  });
  return {
    root,
    targets: planned.targets.map((t) => t.id),
    asrPasses: planned.targets.length,
    vadPasses: planned.targets.length,
    totalModelSeconds: planned.totalModelSeconds,
    mappings,
  };
}

async function load(root) {
  await safePath(root);
  assert.equal(
    await fileHash(path.join(root, "plan.json")),
    (await json(path.join(root, "plan-freeze.json"))).planHash,
    "PLAN_CHANGED",
  );
  const p = await json(path.join(root, "plan.json"));
  assert.deepEqual(p.planned.policy, onsetPolicy);
  assert.deepEqual(p.vadProfile, vadProfile);
  await check([...p.inputs, ...p.identities, ...p.software]);
  assert.deepEqual(timingContract(p.runtime), p.timingContract);
  assert.deepEqual(
    await inspectInterruptedOnset(
      p.resumeInterrupted,
      p.planned.targets,
      p.runtime.asrModel,
    ),
    p.interrupted,
  );
  assert.deepEqual(
    p.continuation,
    p.previousFailure
      ? accountOnsetContinuation(
          p.planned.targets,
          await json(path.join(p.previousFailure, "plan.json")),
          await json(path.join(p.previousFailure, "failure-audit.json")),
          await json(path.join(p.previousFailure, "exit.json")),
        )
      : null,
  );
  const expected = planOnsets(
    p.baseline,
    p.planned.targets.map((t) => t.cueNumber),
    p.duration,
    p.audioOffset,
  );
  assert.deepEqual(p.planned, {
    ...expected,
    targets: expected.targets.map((t, i) => ({
      ...t,
      audioHash: p.planned.targets[i].audioHash,
    })),
  });
  for (const t of p.planned.targets)
    assert.equal(
      await fileHash(path.join(root, t.id, "input.wav")),
      t.audioHash,
      "CROP_CHANGED",
    );
  return p;
}

export async function runOnset(root, authorize, runner = new EvidenceRunner()) {
  assert.equal(authorize, true, "EXPLICIT_LOCAL_AUTHORIZATION_REQUIRED");
  const p = await load(root);
  const fresh = p.planned.targets.filter(
    (t) => !p.interrupted.reuse.some((r) => r.id === t.id),
  );
  await put(path.join(root, "dispatch-reservation.json"), {
    requests: fresh.length * 2,
    seconds: fresh.reduce(
      (s, t) => s + (2 * (t.endFrame - t.firstFrame)) / 16000,
      0,
    ),
    retries: 0,
  });
  const exit = await runner.run(
    p.runtime.python,
    [path.join(repo, "scripts/runtime/timing_onset_isolated.py"), root],
    { cwd: root, timeoutMs: 600000 },
  );
  await put(path.join(root, "exit.json"), {
    exitCode: exit.exitCode,
    signal: exit.signal ?? null,
  });
  assert.equal(exit.exitCode, 0, "MODEL_FAILED_NO_RETRY");
  await load(root);
  return { root, dispatched: fresh.length * 2 };
}

async function replay(root, p) {
  const freshCount = p.planned.targets.length - p.interrupted.reuse.length;
  assert.equal(
    (await json(path.join(root, "exit.json"))).exitCode,
    0,
    "INCOMPLETE_EXECUTION",
  );
  assert.deepEqual(await json(path.join(root, "worker-reservation.json")), {
    asr: freshCount,
    vad: freshCount,
    retries: 0,
  });
  const decisions = [];
  for (const t of p.planned.targets) {
    const reused = p.interrupted.reuse.find((r) => r.id === t.id);
    assert.deepEqual(await json(path.join(root, t.id, "reserved.json")), {
      asr: reused ? 0 : 1,
      vad: reused ? 0 : 1,
    });
    const asr = await json(path.join(root, t.id, "asr.json"));
    const raw = await json(path.join(root, t.id, "raw.json"));
    assert.deepEqual(raw, {
      id: t.id,
      frames: t.endFrame - t.firstFrame,
      segments: asr.segments,
      language: asr.language,
      vad: reused ? null : await json(path.join(root, t.id, "vad.json")),
    });
    if (reused)
      assert.equal(
        await fileHash(path.join(root, t.id, "asr.json")),
        reused.sha256,
      );
    decisions.push(
      decideOnset(t, await json(path.join(root, t.id, "raw.json"))),
    );
  }
  const candidate = applyOnsets(p.baseline, decisions);
  assert.deepEqual(
    candidate.map((r) => [r.recordId, r.text, r.sourceEnd]),
    p.baseline.map((r) => [r.recordId, r.text, r.sourceEnd]),
  );
  const runtime = await json(path.join(root, "runtime.json"));
  assert.equal(runtime.asrModelLoads, 1);
  assert.equal(runtime.vadModelLoads, 1);
  assert.equal(runtime.device, "cpu");
  assert.equal(runtime.processIsolation, true);
  assert.notEqual(runtime.asrPid, runtime.vadPid);
  for (const stage of ["asr", "vad"])
    assert.deepEqual(await json(path.join(root, stage + "-exit.json")), {
      returncode: 0,
    });
  return {
    baseline: p.baseline,
    candidate,
    decisions,
    changed: decisions.filter((d) => d.status === "CANDIDATE").length,
    asrPasses: freshCount,
    vadPasses: freshCount,
    reusedAsr: p.interrupted.reuse.length,
    priorInterruptedAsrAttempts: p.interrupted.priorAsrAttempts,
    priorInterruptedVadAttempts: p.interrupted.priorVadAttempts,
    runtime,
    continuation: p.continuation,
    textMutations: 0,
    endMutations: 0,
    qualityStatus: "needs-review",
    finalizationMethod: "none",
    automaticPromotionAllowed: false,
  };
}
async function files(root) {
  const result = {};
  for (const e of await fs.readdir(root, { withFileTypes: true })) {
    assert(!e.isSymbolicLink(), "SYMLINK");
    if (e.name === "machine-freeze.json" || e.name === "evaluation") continue;
    if (e.isDirectory())
      for (const [n, h] of Object.entries(await files(path.join(root, e.name))))
        result[e.name + "/" + n] = h;
    else result[e.name] = await fileHash(path.join(root, e.name));
  }
  return result;
}
export async function finishOnset(root) {
  const p = await load(root),
    result = await replay(root, p);
  await put(path.join(root, "result.json"), result);
  for (const [ext, text] of Object.entries(
    serializeRecords(result.candidate, "ja").files,
  ))
    await put(path.join(root, `machine-candidate.${ext}`), text);
  await put(path.join(root, "machine-freeze.json"), {
    version: onsetPolicy.version,
    files: await files(root),
    referenceRead: false,
  });
  return { root, ...(await verifyOnset(root)) };
}
export async function verifyOnset(root) {
  const p = await load(root),
    freeze = await json(path.join(root, "machine-freeze.json"));
  assert.equal(freeze.version, onsetPolicy.version);
  assert.deepEqual(await files(root), freeze.files, "FROZEN_OUTPUT_CHANGED");
  const r = await replay(root, p);
  assert.deepEqual(await json(path.join(root, "result.json")), r);
  const rendered = serializeRecords(r.candidate, "ja");
  for (const [ext, text] of Object.entries(rendered.files)) {
    assert.equal(
      await fs.readFile(path.join(root, `machine-candidate.${ext}`), "utf8"),
      text,
    );
    assert.deepEqual(
      formats[ext].parse(text).map((r) => [r.start, r.end, r.text]),
      rendered.cues.map((r) => [r.start, r.end, r.text]),
    );
  }
  return {
    integrity: "passed",
    changed: r.changed,
    asrPasses: r.asrPasses,
    vadPasses: r.vadPasses,
    textMutations: 0,
    endMutations: 0,
    decisions: r.decisions.map(({ id, status, reason }) => ({
      id,
      status,
      reason,
    })),
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [cmd, a, b] = process.argv.slice(2);
  try {
    assert(["prepare", "run", "finish", "verify"].includes(cmd));
    console.log(
      JSON.stringify(
        cmd === "prepare"
          ? await prepareOnsetRun(a, b)
          : cmd === "run"
            ? await runOnset(a, b === "--authorize-local")
            : cmd === "finish"
              ? await finishOnset(a)
              : await verifyOnset(a),
        null,
        2,
      ),
    );
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  }
}
