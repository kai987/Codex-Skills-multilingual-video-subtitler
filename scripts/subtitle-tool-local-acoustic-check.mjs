/** Explicit bounded experiment; never imported by normal generate/resume. */
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { statusBounded } from "./lib/bounded-product.mjs";
import {
  durable,
  readPcm,
  slicePcm,
  EvidenceRunner,
} from "./lib/bounded-asr-ab.mjs";
import { fileHash, inventory } from "./lib/local-asr-run.mjs";
import { safePath } from "../packages/video-subtitler/dist/standalone/recovery.js";
import {
  mapRaw,
  serializeRecords,
  formats,
} from "../packages/video-subtitler/dist/standalone/bounded.js";
import {
  planLocalChecks,
  summarizeTimingPair,
} from "./lib/local-acoustic-policy.mjs";

const repo = path.resolve(import.meta.dirname, "..");
const hash = (b) => createHash("sha256").update(b).digest("hex");
const json = async (f) => JSON.parse(await fs.readFile(f, "utf8"));
const bind = async (p) => ({
  path: path.resolve(p),
  sha256: await fileHash(p),
});
const names = [
  "scripts/subtitle-tool-local-acoustic-check.mjs",
  "scripts/lib/local-acoustic-policy.mjs",
  "scripts/runtime/local_acoustic_ctc.py",
  "scripts/runtime/ctc_worker.py",
  "scripts/lib/bounded-asr-ab.mjs",
  "packages/video-subtitler/dist/standalone/bounded.js",
];
async function verify(files) {
  for (const f of files)
    if ((await fileHash(f.path)) !== f.sha256)
      throw Error(`FROZEN_IDENTITY_CHANGED:${f.path}`);
}

export async function prepareLocalCheck(specFile, outputRoot) {
  const spec = await json(specFile);
  if (!Array.isArray(spec.targets) || spec.targets.length !== 3)
    throw Error("THREE_TARGETS_REQUIRED");
  const targets = [],
    sourceFiles = [],
    states = [];
  for (const target of spec.targets) {
    await safePath(target.task);
    const state = await statusBounded(target.task);
    const mapped = await json(path.join(target.task, "mapped-records.json"));
    const records = target.recordIds.map((id) =>
      mapped.records.find((r) => r.recordId === id),
    );
    if (records.some((r) => !r) || !state.files["mapped-records.json"])
      throw Error("TARGET_RECORD_BINDING");
    if (target.kind === "seam") {
      const seam = await json(
        path.join(target.task, "boundary-decisions.json"),
      );
      if (
        !seam.decisions.some(
          (d) =>
            d.leftId === target.recordIds[0] &&
            d.rightId === target.recordIds[1],
        )
      )
        throw Error("SEAM_TARGET_BINDING");
    }
    for (const name of [
      "bounded-task.json",
      "bounded-plan.json",
      "mapped-records.json",
      "boundary-decisions.json",
      "audio.wav",
    ])
      sourceFiles.push(await bind(path.join(target.task, name)));
    targets.push({
      id: target.id,
      kind: target.kind,
      records,
      sourceEnd: state.duration,
    });
    states.push(state);
  }
  if (
    states.some(
      (s) =>
        s.plan.audioHash !== states[0].plan.audioHash ||
        s.plan.identities.input.sha256 !==
          states[0].plan.identities.input.sha256 ||
        s.plan.audioOffset !== states[0].plan.audioOffset,
    )
  )
    throw Error("MIXED_SOURCE_AUDIO");
  const planning = planLocalChecks(targets);
  const state = states[0],
    audio = path.join(spec.targets[0].task, "audio.wav");
  const pcm = readPcm(await fs.readFile(audio));
  if (pcm.sampleRate !== 16000 || pcm.frames !== state.plan.fullFrames)
    throw Error("SOURCE_PCM_CONTRACT");
  const ctcFiles = [];
  for (const name of (await fs.readdir(spec.ctc.model)).sort()) {
    const p = path.join(spec.ctc.model, name);
    if ((await fs.stat(p)).isFile()) ctcFiles.push(await bind(p));
  }
  if (
    !ctcFiles.some((f) => /model\.safetensors|pytorch_model\.bin/u.test(f.path))
  )
    throw Error("CTC_MODEL_UNAVAILABLE");
  await verify([state.plan.identities.model, state.plan.identities.runtime]);
  const runtime = {
    whisper: state.plan.identities.runtime,
    ctc: await bind(spec.ctc.python),
  };
  const software = await Promise.all(
    names.map((n) => bind(path.join(repo, n))),
  );
  await safePath(outputRoot, true);
  await fs.mkdir(outputRoot, { recursive: true });
  const root = await fs.mkdtemp(
    path.join(path.resolve(outputRoot), "local-acoustic-"),
  );
  const requests = [];
  for (const r of planning.requests) {
    const start = Math.round((r.start - state.plan.audioOffset) * 16000),
      end = start + r.frames;
    const wav = slicePcm(pcm, start, end),
      dir = path.join(root, r.id);
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, "input.wav"), wav, { flag: "wx" });
    requests.push({
      ...r,
      wavHash: hash(wav),
      audioFrameStart: start,
      audioFrameEnd: end,
    });
  }
  const plan = {
    version: "bounded-local-acoustic-check-v1",
    createdAt: new Date().toISOString(),
    ...planning,
    requests,
    sourceFiles,
    sourceHash: state.plan.identities.input.sha256,
    sourceAudioHash: state.plan.audioHash,
    sourceAudioOffset: state.plan.audioOffset,
    sourceTasks: spec.targets.map((t, i) => ({
      id: t.id,
      task: t.task,
      effectiveRange: states[i].plan.effectiveRange,
    })),
    model: state.plan.identities.model,
    runtime,
    software,
    ctc: { model: spec.ctc.model, files: ctcFiles, device: "cpu" },
    threads: state.config.threads,
    language: "ja",
    prompt: null,
    vad: false,
    referenceUsedForGeneration: false,
    previouslyExposedDevelopmentCase: true,
    wholeEpisodeASR: false,
    automaticApplication: false,
  };
  await durable(path.join(root, "plan.json"), plan, true);
  await durable(
    path.join(root, "plan-freeze.json"),
    { planHash: await fileHash(path.join(root, "plan.json")) },
    true,
  );
  return {
    root,
    requests: requests.length,
    totalSeconds: planning.totalSeconds,
  };
}

export async function verifyLocalCheck(root, external = false) {
  await safePath(root);
  for (const n of ["plan.json", "plan-freeze.json"])
    await safePath(path.join(root, n));
  const frozen = await json(path.join(root, "plan-freeze.json"));
  if ((await fileHash(path.join(root, "plan.json"))) !== frozen.planHash)
    throw Error("PLAN_CHANGED");
  const p = await json(path.join(root, "plan.json"));
  const planned = planLocalChecks(p.targets);
  if (
    JSON.stringify(planned.policy) !== JSON.stringify(p.policy) ||
    planned.requests.length !== p.requests.length ||
    planned.targets.length !== 3 ||
    planned.targets.filter((t) => t.kind === "timing").length !== 1 ||
    planned.targets.filter((t) => t.kind === "seam").length !== 2 ||
    planned.totalFrames !== p.totalFrames ||
    planned.totalSeconds !== p.totalSeconds
  )
    throw Error("PLAN_POLICY_CHANGED");
  for (const [i, r] of p.requests.entries()) {
    for (const [key, value] of Object.entries(planned.requests[i]))
      if (JSON.stringify(r[key]) !== JSON.stringify(value))
        throw Error("REQUEST_CHANGED");
    const wav = path.join(root, r.id, "input.wav");
    await safePath(wav);
    if ((await fileHash(wav)) !== r.wavHash)
      throw Error("REQUEST_AUDIO_CHANGED");
    const pcm = readPcm(await fs.readFile(wav));
    if (pcm.sampleRate !== 16000 || pcm.frames !== r.frames)
      throw Error("REQUEST_PCM_CHANGED");
  }
  if (external)
    await verify([
      ...p.sourceFiles,
      p.model,
      ...Object.values(p.runtime),
      ...p.ctc.files,
      ...p.software,
    ]);
  return p;
}

export async function runLocalCheck(
  root,
  { runner = new EvidenceRunner() } = {},
) {
  const p = await verifyLocalCheck(root, true);
  // One-shot durable reservation: failed/interrupted execution never renews budget.
  await durable(
    path.join(root, "execution-reservation.json"),
    {
      at: new Date().toISOString(),
      requests: p.requests.map((r) => r.id),
      maxRequests: 6,
      maxSeconds: 120,
      retries: 0,
    },
    true,
  );
  for (const r of p.requests.filter((r) => r.backend === "whisper")) {
    const dir = path.join(root, r.id),
      args = [
        "--model",
        p.model.path,
        "--file",
        path.join(dir, "input.wav"),
        "--language",
        p.language,
        "--threads",
        String(p.threads),
        "--output-srt",
        "--output-json-full",
        "--output-file",
        path.join(dir, "raw"),
        "--suppress-nst",
        "--no-prints",
      ];
    await durable(
      path.join(dir, "reserved.json"),
      { request: r, args, at: new Date().toISOString() },
      true,
    );
    console.log(`Local inference: ${r.id} (${r.start}–${r.end})`);
    const result = await runner.run(p.runtime.whisper.path, args, {
      cwd: dir,
      timeoutMs: 180000,
    });
    await durable(
      path.join(dir, "receipt.json"),
      {
        exitCode: result.exitCode,
        signal: result.signal,
        endedAt: new Date().toISOString(),
      },
      true,
    );
    if (result.exitCode !== 0) throw Error(`FAILED_NO_RETRY:${r.id}`);
  }
  const dir = path.join(root, "ctc");
  await fs.mkdir(dir);
  console.log("Local conditional alignment: 2 requests, CPU, one worker");
  const result = await runner.run(
    p.runtime.ctc.path,
    [path.join(repo, "scripts/runtime/local_acoustic_ctc.py"), root],
    { cwd: dir, timeoutMs: 300000 },
  );
  await durable(
    path.join(dir, "receipt.json"),
    {
      exitCode: result.exitCode,
      signal: result.signal,
      endedAt: new Date().toISOString(),
    },
    true,
  );
  if (result.exitCode !== 0) throw Error("CTC_FAILED_NO_RETRY");
  await verify(p.sourceFiles);
  return freezeLocalCheck(root);
}

export async function freezeLocalCheck(root) {
  const p = await verifyLocalCheck(root);
  await safePath(path.join(root, "execution-reservation.json"));
  const reservation = await json(path.join(root, "execution-reservation.json"));
  if (
    reservation.maxRequests !== 6 ||
    reservation.maxSeconds !== 120 ||
    reservation.retries !== 0 ||
    JSON.stringify(reservation.requests) !==
      JSON.stringify(p.requests.map((r) => r.id))
  )
    throw Error("EXECUTION_RESERVATION_INVALID");
  const completed = async (file) => {
    await safePath(file);
    const receipt = await json(file);
    if (receipt.exitCode !== 0 || receipt.signal !== null)
      throw Error("REQUEST_NOT_SUCCESSFUL");
  };
  await completed(path.join(root, "ctc", "receipt.json"));
  const outputs = [],
    results = [];
  for (const r of p.requests) {
    const dir = path.join(root, r.id);
    await safePath(path.join(dir, "reserved.json"));
    const reserved = await json(path.join(dir, "reserved.json"));
    if (JSON.stringify(reserved.request) !== JSON.stringify(r))
      throw Error("REQUEST_RESERVATION_INVALID");
    await safePath(path.join(dir, "raw.json"));
    const raw = await json(path.join(dir, "raw.json"));
    if (r.backend === "ctc") {
      if (raw.type !== "result" || raw.requestId !== r.id)
        throw Error("CTC_RESULT_BINDING");
      results.push({ ...raw, request: r });
      continue;
    }
    await completed(path.join(dir, "receipt.json"));
    const rawPath = path.join(dir, "raw.srt"),
      rawHash = await fileHash(rawPath);
    await safePath(rawPath);
    const chunk = {
      id: "chunk-0001",
      index: 0,
      coreStart: 0,
      coreEnd: r.frames,
      inputStart: 0,
      inputEnd: r.frames,
      boundary: "tail",
      candidateSamples: [],
    };
    const records = mapRaw(
      await fs.readFile(rawPath, "utf8"),
      rawHash,
      chunk,
      16000,
      r.start,
      r.end,
      r.id,
    );
    if (
      !Array.isArray(raw.transcription) ||
      raw.transcription.length !== records.length ||
      raw.transcription.some(
        (segment, i) =>
          typeof segment.text !== "string" ||
          segment.text.trim() !== records[i].text.trim() ||
          !Number.isFinite(segment.offsets?.from) ||
          !Number.isFinite(segment.offsets?.to) ||
          Math.abs(segment.offsets.from / 1000 - records[i].localStart) >
            0.001 ||
          Math.abs(segment.offsets.to / 1000 - records[i].localEnd) > 0.001,
      )
    )
      throw Error("RAW_JSON_SRT_DISAGREE");
    const invalid = records.filter((record) => record.issues.length);
    // Keep every raw record. An invalid local result is evidence, not an export.
    const projection = invalid.length
      ? null
      : serializeRecords(records, p.language);
    const mapped = {
      request: r,
      records,
      exportBlocked: invalid.length > 0,
      invalidRecordIds: invalid.map((record) => record.recordId),
      qualityStatus: "needs-review",
      automaticApplication: false,
    };
    await immutable(path.join(dir, "mapped-records.json"), mapped);
    for (const [ext, api] of Object.entries(projection ? formats : {})) {
      const file = path.join(dir, `local-candidate.${ext}`),
        bytes = projection.files[ext];
      await immutableText(file, bytes);
      const reparsed = api.parse(await fs.readFile(file, "utf8"));
      if (
        reparsed.length !== projection.cues.length ||
        reparsed.some(
          (c, i) =>
            c.text !== projection.cues[i].text ||
            Math.abs(c.start - projection.cues[i].start) > 0.011 ||
            Math.abs(c.end - projection.cues[i].end) > 0.011,
        )
      )
        throw Error("SERIALIZATION_PARITY_FAILED");
      outputs.push(path.relative(root, file));
    }
    results.push({
      request: r,
      records,
      exportBlocked: invalid.length > 0,
      text: records.map((r) => r.text).join(""),
      rawHash,
    });
  }
  const timing = summarizeTimingPair(
    results.filter((r) => r.request.backend === "ctc"),
  );
  const observations = {
    requests: results,
    timing,
    outputs,
    newWhisperRequests: p.requests.filter((r) => r.backend === "whisper")
      .length,
    newCtcRequests: p.requests.filter((r) => r.backend === "ctc").length,
    totalAudioSeconds: p.totalSeconds,
    referenceUsed: false,
    sourceTextMutations: 0,
    sourceTimingMutations: 0,
    qualityStatus: "needs-review",
    finalizationMethod: "none",
  };
  await immutable(path.join(root, "machine-observations.json"), observations);
  const files = (await inventory(root)).filter(
    (f) =>
      !["machine-freeze.json"].includes(f.path) &&
      !f.path.startsWith("evaluation/") &&
      f.path !== "OUTPUT_INDEX.md",
  );
  const freeze = {
    version: "bounded-local-acoustic-freeze-v1",
    planHash: await fileHash(path.join(root, "plan.json")),
    files,
  };
  await immutable(path.join(root, "machine-freeze.json"), freeze);
  return {
    root,
    timing,
    outputs,
    newRequests: p.requests.length,
    totalAudioSeconds: p.totalSeconds,
    qualityStatus: "needs-review",
  };
}
async function immutableText(file, bytes) {
  try {
    await fs.writeFile(file, bytes, { flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    if ((await fs.readFile(file, "utf8")) !== bytes)
      throw Error("IMMUTABLE_DELIVERY_CHANGED", { cause: error });
  }
}
async function immutable(file, value) {
  return immutableText(file, JSON.stringify(value, null, 2) + "\n");
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const [mode, first, second] = process.argv.slice(2);
  const result =
    mode === "prepare"
      ? await prepareLocalCheck(first, second)
      : mode === "run"
        ? await runLocalCheck(first)
        : mode === "freeze"
          ? await freezeLocalCheck(first)
          : null;
  if (!result)
    throw Error("Usage: prepare SPEC OUTPUT_ROOT | run RUN | freeze RUN");
  console.log(JSON.stringify(result, null, 2));
}
