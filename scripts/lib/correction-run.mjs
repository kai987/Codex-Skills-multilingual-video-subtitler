/** Independent machine candidate; frozen sources and historical contracts stay read-only. */
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { hash, identity } from "./content-review-plan.mjs";
import { add, decimal } from "./bounded-diagnostics.mjs";
import {
  durable,
  EvidenceRunner,
  readPcm,
  slicePcm,
} from "./bounded-asr-ab.mjs";
import { authenticateAudio, coreSlice } from "./bounded-content-review.mjs";
import {
  readJson,
  fileHash,
  exists,
  inventory,
  verifyIntegration,
} from "./local-asr-run.mjs";
import {
  formatProjection,
  validateProjection,
} from "./representation-grid.mjs";
import { consumeStoredWhisper } from "../../packages/video-subtitler/dist/machine-quality/stored-token-span.js";
import { correctionPolicy, buildCorrection } from "./correction-policy.mjs";

const repo = path.resolve(import.meta.dirname, "../..");
const number = z.number().finite().nonnegative();
export const correctionPlanSchema = z
  .object({
    version: z.literal("machine-correction-plan-v1"),
    selection: z.literal("diagnostic-development-cases-not-blind"),
    targets: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-zA-Z0-9_-]+$/u),
            start: number,
            end: number,
            baselineIds: z.array(z.string().min(1)),
            reason: z.enum([
              "text-error",
              "coarse-timing-and-text",
              "missing-dialogue",
            ]),
          })
          .strict(),
      )
      .min(1)
      .max(4),
  })
  .strict();
export const executionPolicy = Object.freeze({
  version: "paired-local-correction-execution-v1",
  contextSeconds: [0.5, 1],
  maxRequests: 8,
  maxRequestSeconds: 30,
  maxTotalSeconds: 120,
  maxRetries: 0,
  prompt: null,
  vad: false,
  coreML: false,
  tokenTimestamps: "whisper-native-experimental-not-acoustic-certification",
  tokenArguments: ["--output-json-full", "--max-len", "64", "--split-on-word"],
  referenceTextUsedByGeneration: false,
});
const codeNames = [
  "scripts/lib/correction-run.mjs",
  "scripts/lib/correction-policy.mjs",
  "scripts/lib/representation-grid.mjs",
  "scripts/lib/bounded-asr-ab.mjs",
  "scripts/lib/bounded-content-review.mjs",
  "scripts/lib/content-review-plan.mjs",
  "scripts/lib/local-asr-run.mjs",
  "scripts/lib/local-asr-policy.mjs",
  "scripts/lib/bounded-diagnostics.mjs",
  "packages/video-subtitler/dist/standalone/recovery.js",
  "packages/video-subtitler/dist/standalone/bounded.js",
  "packages/subtitle-core/dist/format.js",
  "packages/subtitle-core/dist/parse.js",
  "packages/subtitle-core/dist/time.js",
  "packages/video-subtitler/dist/machine-quality/stored-token-span.js",
  "packages/transcription-core/dist/local.js",
];
export const codeInventory = () =>
  Promise.all(
    codeNames.map(async (p) => ({
      path: p,
      sha256: await fileHash(path.join(repo, p)),
    })),
  );
const jsonEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function planCorrection(plan, baseline, sourceStart, sourceEnd) {
  plan = correctionPlanSchema.parse(plan);
  const seenTargets = new Set(),
    seenRecords = new Set(),
    requests = [];
  for (const t of plan.targets) {
    if (
      seenTargets.has(t.id) ||
      !(sourceStart <= t.start && t.start < t.end && t.end <= sourceEnd)
    )
      throw Error("TARGET_BOUNDS_OR_DUPLICATE");
    seenTargets.add(t.id);
    for (const id of t.baselineIds) {
      const r = baseline.find((b) => b.recordId === id);
      if (
        !r ||
        seenRecords.has(id) ||
        !(r.sourceStart < t.end && r.sourceEnd > t.start)
      )
        throw Error("TARGET_BASELINE_BINDING");
      seenRecords.add(id);
    }
    if ((t.reason === "missing-dialogue") !== (t.baselineIds.length === 0))
      throw Error("TARGET_ACTION_BINDING");
    for (const context of executionPolicy.contextSeconds) {
      const start = Math.max(sourceStart, t.start - context),
        end = Math.min(sourceEnd, t.end + context);
      const startSample = Math.round((start - sourceStart) * 16000),
        endSample = Math.round((end - sourceStart) * 16000);
      if (
        Math.abs(startSample / 16000 + sourceStart - start) > 1e-8 ||
        Math.abs(endSample / 16000 + sourceStart - end) > 1e-8
      )
        throw Error("NONINTEGER_REQUEST_SAMPLE");
      if (
        endSample <= startSample ||
        endSample - startSample > 16000 * executionPolicy.maxRequestSeconds
      )
        throw Error("REQUEST_BUDGET");
      requests.push({
        targetId: t.id,
        context,
        startSample,
        endSample,
        requestStart: start,
        requestEnd: end,
      });
    }
  }
  for (let i = 0; i < plan.targets.length; i++)
    for (let j = i + 1; j < plan.targets.length; j++) {
      if (
        plan.targets[i].start < plan.targets[j].end &&
        plan.targets[j].start < plan.targets[i].end
      )
        throw Error("OVERLAPPING_TARGETS");
    }
  const samples = requests.reduce((s, r) => s + r.endSample - r.startSample, 0);
  if (
    requests.length > executionPolicy.maxRequests ||
    samples > 16000 * executionPolicy.maxTotalSeconds
  )
    throw Error("TOTAL_BUDGET");
  return { plan, requests, samples };
}

export async function verifyBoundFiles(run, files) {
  const seen = new Set();
  for (const f of files) {
    if (
      !f.path ||
      path.isAbsolute(f.path) ||
      f.path.split(/[\\/]/u).some((p) => !p || p === ".." || p === ".") ||
      seen.has(f.path)
    )
      throw Error("UNSAFE_FREEZE_PATH");
    seen.add(f.path);
    let p = run;
    for (const part of f.path.split("/")) {
      p = path.join(p, part);
      if ((await fs.lstat(p)).isSymbolicLink()) throw Error("FREEZE_SYMLINK");
    }
    if ((await fileHash(p)) !== f.sha256)
      throw Error("FROZEN_INPUT_CHANGED:" + f.path);
  }
}

export async function prepareCorrection(o) {
  const { c, result } = await verifyIntegration(o.previousRun);
  const m = c.experiment;
  if (m.language !== "ja" || m.pcm.sampleRate !== 16000)
    throw Error("JAPANESE_PCM16_CONTRACT_REQUIRED");
  const p = planCorrection(
    await readJson(o.plan),
    result.records,
    m.audioOffset,
    m.sourceEnd,
  );
  for (const [file, expected] of [
    [c.model, c.authorization.modelSha256],
    [c.runtime, c.authorization.runtimeSha256],
  ]) {
    if ((await fileHash(file)) !== expected)
      throw Error("RUNTIME_IDENTITY_CHANGED");
  }
  const audio = await authenticateAudio({ root: c.audioRoot, m }, c.audioRoot);
  if (audio.proof.status !== "AUTHENTICATED") throw Error(audio.proof.status);
  await fs.mkdir(o.outputRoot, { recursive: true });
  const run = await fs.mkdtemp(path.join(o.outputRoot, "machine-correction-"));
  await fs.chmod(run, 0o700);
  await fs.mkdir(path.join(run, "requests"));
  await fs.mkdir(path.join(run, "runtime"));
  // Do not discover adjacent CoreML models. This isolated model name has none.
  await fs.symlink(
    await fs.realpath(c.model),
    path.join(run, "runtime/model.bin"),
  );
  await durable(path.join(run, "plan.json"), p.plan, true);
  await durable(path.join(run, "baseline-records.json"), result.records, true);
  await durable(path.join(run, "source-audio-proof.json"), audio.proof, true);
  const requests = [];
  for (const [i, r] of p.requests.entries()) {
    const slice = coreSlice(audio.chunks, r.startSample, r.endSample);
    const wav = slicePcm(
      {
        sampleRate: 16000,
        frames: r.endSample - r.startSample,
        data: slice.data,
      },
      0,
      r.endSample - r.startSample,
    );
    const request = {
      ...r,
      id: `request-${String(i + 1).padStart(2, "0")}`,
      audioHash: hash(slice.data),
      wavHash: hash(wav),
      sourceSegments: slice.segments,
    };
    request.requestId = identity({
      ...request,
      modelHash: c.authorization.modelSha256,
      runtimeHash: c.authorization.runtimeSha256,
      executionPolicy,
      plan: p.plan,
    });
    const dir = path.join(run, "requests", request.id);
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, "input.wav"), wav, { flag: "wx" });
    if (
      hash(readPcm(await fs.readFile(path.join(dir, "input.wav"))).data) !==
      request.audioHash
    )
      throw Error("WAV_REREAD");
    await durable(path.join(dir, "request.json"), request, true);
    requests.push(request);
  }
  const priorFiles = [
    "experiment.json",
    "raw-freeze.json",
    "integration/decision-freeze.json",
    "integration/after-records.json",
  ];
  const manifest = {
    version: "machine-correction-run-v1",
    createdAt: new Date().toISOString(),
    previousRun: path.resolve(o.previousRun),
    priorFiles: await Promise.all(
      priorFiles.map(async (p) => ({
        path: p,
        sha256: await fileHash(path.join(o.previousRun, p)),
      })),
    ),
    model: c.model,
    runtime: c.runtime,
    modelHash: c.authorization.modelSha256,
    runtimeHash: c.authorization.runtimeSha256,
    sourcePcmHash: m.pcm.pcmHash,
    sourceMediaHash: m.baseline.source.sha256,
    sourceStart: m.audioOffset,
    sourceEnd: m.sourceEnd,
    language: m.language,
    threads: m.threads,
    baselineHash: identity(result.records),
    planHash: identity(p.plan),
    executionPolicy,
    correctionPolicy,
    code: await codeInventory(),
    requests,
    budget: {
      requests: requests.length,
      samples: p.samples,
      seconds: p.samples / 16000,
      retries: 0,
    },
    selection: p.plan.selection,
    referenceTextUsedByGeneration: false,
    qualityStatus: "needs-review",
    finalizationMethod: "none",
    humanValidated: false,
    machineOnlyReleaseAuthorized: false,
    productDefaultChanged: false,
    fullTimedExportAllowed: false,
  };
  await durable(path.join(run, "manifest.json"), manifest, true);
  const files = (await inventory(path.join(run, "requests"))).map((f) => ({
    ...f,
    path: "requests/" + f.path,
  }));
  for (const name of [
    "manifest.json",
    "plan.json",
    "baseline-records.json",
    "source-audio-proof.json",
  ])
    files.push({ path: name, sha256: await fileHash(path.join(run, name)) });
  await durable(path.join(run, "input-freeze.json"), { files }, true);
  return run;
}

async function readInputs(run, requireCode = true) {
  await verifyBoundFiles(
    run,
    (await readJson(path.join(run, "input-freeze.json"))).files,
  );
  const m = await readJson(path.join(run, "manifest.json"));
  const baseline = await readJson(path.join(run, "baseline-records.json"));
  const plan = await readJson(path.join(run, "plan.json"));
  const bound = planCorrection(plan, baseline, m.sourceStart, m.sourceEnd);
  if (
    identity(plan) !== m.planHash ||
    identity(baseline) !== m.baselineHash ||
    bound.samples !== m.budget.samples ||
    m.requests.length !== bound.requests.length ||
    !jsonEqual(m.executionPolicy, executionPolicy) ||
    !jsonEqual(m.correctionPolicy, correctionPolicy)
  )
    throw Error("MANIFEST_BINDING");
  for (const [i, r] of m.requests.entries()) {
    if (
      !jsonEqual(
        r,
        await readJson(path.join(run, "requests", r.id, "request.json")),
      ) ||
      Object.entries(bound.requests[i]).some(([k, v]) => r[k] !== v)
    )
      throw Error("REQUEST_BINDING");
  }
  if (requireCode && !jsonEqual(m.code, await codeInventory()))
    throw Error("EXECUTION_CODE_CHANGED");
  return { m, baseline, plan };
}

export function correctionArgs(m, dir, run) {
  return [
    "--model",
    path.join(run, "runtime/model.bin"),
    "--file",
    path.join(dir, "input.wav"),
    "--language",
    m.language,
    "--threads",
    String(m.threads),
    "--output-srt",
    "--output-file",
    path.join(dir, "raw"),
    ...executionPolicy.tokenArguments,
    "--suppress-nst",
    "--no-prints",
  ];
}

export async function executeCorrection(
  run,
  {
    authorize = false,
    runner = new EvidenceRunner(),
    progress = () => undefined,
  } = {},
) {
  if (!authorize) throw Error("EXPLICIT_LOCAL_ASR_AUTHORIZATION_REQUIRED");
  const { m } = await readInputs(run, false);
  if (await exists(path.join(run, "raw-freeze.json"))) {
    await verifyBoundFiles(
      run,
      (await readJson(path.join(run, "raw-freeze.json"))).files,
    );
    return { dispatches: 0, checkpointHits: m.requests.length };
  }
  if (!jsonEqual(m.code, await codeInventory()))
    throw Error("EXECUTION_CODE_CHANGED");
  for (const [p, expected] of [
    [m.runtime, m.runtimeHash],
    [path.join(run, "runtime/model.bin"), m.modelHash],
  ])
    if ((await fileHash(p)) !== expected) throw Error("RUNTIME_MODEL_CHANGED");
  const lock = path.join(run, ".execution-lock");
  await durable(lock, { pid: process.pid }, true);
  let dispatches = 0,
    checkpointHits = 0;
  try {
    for (const r of m.requests) {
      runner.signal?.throwIfAborted();
      const dir = path.join(run, "requests", r.id),
        receipt = path.join(dir, "receipt.json");
      if (await exists(receipt)) {
        const saved = await readJson(receipt);
        if (saved.requestId !== r.requestId) throw Error("RECEIPT_BINDING");
        await verifyBoundFiles(dir, saved.files);
        checkpointHits++;
        continue;
      }
      if (await exists(path.join(dir, "reserved.json")))
        throw Error("INCOMPLETE_RESERVED_REQUEST_NO_AUTOMATIC_RETRY:" + r.id);
      const args = correctionArgs(m, dir, run),
        startedAt = new Date().toISOString();
      await durable(
        path.join(dir, "reserved.json"),
        {
          requestId: r.requestId,
          startedAt,
          args,
          runtimeHash: m.runtimeHash,
          samples: r.endSample - r.startSample,
        },
        true,
      );
      progress({ request: r.id, target: r.targetId, stage: "dispatch" });
      dispatches++;
      let outcome;
      try {
        outcome = await runner.run(m.runtime, args, {
          timeoutMs: 180000,
          cwd: dir,
        });
      } catch (error) {
        outcome = { exitCode: null, signal: null, error: String(error) };
      }
      const completed =
        outcome.exitCode === 0 &&
        (await exists(path.join(dir, "raw.json"))) &&
        (await exists(path.join(dir, "raw.srt")));
      const files = await inventory(dir);
      await durable(
        receipt,
        {
          requestId: r.requestId,
          status: completed ? "completed" : "failed",
          exitCode: outcome.exitCode,
          signal: outcome.signal ?? null,
          error: outcome.error ?? null,
          startedAt,
          endedAt: new Date().toISOString(),
          files,
        },
        true,
      );
      progress({ request: r.id, stage: completed ? "completed" : "failed" });
      runner.signal?.throwIfAborted();
    }
    const files = (await inventory(path.join(run, "requests"))).map((f) => ({
      ...f,
      path: "requests/" + f.path,
    }));
    for (const f of (await readJson(path.join(run, "input-freeze.json"))).files)
      if (!files.some((x) => x.path === f.path)) files.push(f);
    files.push({
      path: "input-freeze.json",
      sha256: await fileHash(path.join(run, "input-freeze.json")),
    });
    await durable(
      path.join(run, "raw-freeze.json"),
      { version: "machine-correction-raw-v1", files },
      true,
    );
    return { dispatches, checkpointHits };
  } finally {
    await fs.unlink(lock);
  }
}

export function tokenView(full, r, rawHash, planHash) {
  const observation = consumeStoredWhisper(full, {
    requestId: r.requestId,
    caseBindingHash: planHash,
    windowId: r.id,
    audioHash: r.audioHash,
    window: { start: r.requestStart, end: r.requestEnd },
    rawFileHash: rawHash,
    sourceRequestIds: [r.requestId],
    occurrenceIds: [r.targetId],
  });
  const mapped = (seconds) => {
    if (!Number.isFinite(seconds)) return null;
    const value = add(decimal(r.requestStart), decimal(seconds));
    return Number(value.n) / Number(value.d);
  };
  return {
    targetId: r.targetId,
    requestId: r.requestId,
    requestStart: r.requestStart,
    requestEnd: r.requestEnd,
    audioHash: r.audioHash,
    rawHash,
    status: "completed",
    timestampSemantics: executionPolicy.tokenTimestamps,
    segments: observation.parents.map((p) => ({
      text: p.originalText,
      start: p.bounds ? mapped(p.original.offsets.from / 1000) : null,
      end: p.bounds ? mapped(p.original.offsets.to / 1000) : null,
      sourceTextComplete: p.sourceTextComplete,
      tokens: p.tokens.map((t) => ({
        text: t.originalText,
        start: mapped(t.parsed?.start),
        end: mapped(t.parsed?.end),
        kind: t.kind,
        flags: t.flags,
        timeStatus: t.timeStatus,
      })),
    })),
  };
}

async function calculate(run) {
  // First assembly requires the executed implementation. Later verification may
  // use newer code only if every already-frozen decision is reproduced exactly.
  const { m, baseline, plan } = await readInputs(
    run,
    !(await exists(path.join(run, "decision-freeze.json"))),
  );
  await verifyBoundFiles(
    run,
    (await readJson(path.join(run, "raw-freeze.json"))).files,
  );
  const views = [];
  for (const r of m.requests) {
    const dir = path.join(run, "requests", r.id),
      receipt = await readJson(path.join(dir, "receipt.json"));
    if (receipt.requestId !== r.requestId) throw Error("RECEIPT_BINDING");
    if (receipt.status !== "completed") {
      views.push({ ...r, status: "failed", segments: [] });
      continue;
    }
    const bytes = await fs.readFile(path.join(dir, "raw.json"));
    try {
      views.push(tokenView(JSON.parse(bytes), r, hash(bytes), m.planHash));
    } catch (e) {
      views.push({
        ...r,
        status: "failed",
        segments: [],
        parseFailure: String(e),
      });
    }
  }
  const result = buildCorrection(baseline, plan, views);
  return { m, baseline, plan, views, result };
}

export async function assembleCorrection(run) {
  if (await exists(path.join(run, "decision-freeze.json")))
    return verifyCorrection(run);
  const { m, views, result } = await calculate(run);
  // Every proposed change becomes an independent candidate record, never a baseline rewrite.
  for (const [name, data] of Object.entries({
    "views.json": views,
    "candidate-records.json": result.records,
    "decisions.json": result.decisions,
    "changes.json": result.changes,
  }))
    await durable(path.join(run, name), data, true);
  await fs.mkdir(path.join(run, "candidate"));
  const output = formatProjection(result.records, m.language);
  for (const [f, content] of Object.entries(output))
    await fs.writeFile(
      path.join(run, "candidate", "subtitle.corrected.machine-candidate." + f),
      content,
      { flag: "wx" },
    );
  const contents = Object.fromEntries(
    await Promise.all(
      ["ass", "srt", "vtt"].map(async (f) => [
        f,
        await fs.readFile(
          path.join(
            run,
            "candidate",
            "subtitle.corrected.machine-candidate." + f,
          ),
          "utf8",
        ),
      ]),
    ),
  );
  validateProjection(contents, result.records);
  const receipts = await Promise.all(
    m.requests.map((r) =>
      readJson(path.join(run, "requests", r.id, "receipt.json")),
    ),
  );
  const summary = {
    version: "machine-correction-result-v1",
    qualityStatus: "needs-review",
    finalizationMethod: "none",
    humanValidated: false,
    acousticCorrectness: "NOT_VERIFIED",
    machineOnlyReleaseAuthorized: false,
    productDefaultChanged: false,
    fullTimedExportAllowed: false,
    baselineFileMutations: 0,
    baselineRecords: (await readJson(path.join(run, "baseline-records.json")))
      .length,
    candidateRecords: result.records.length,
    changedTargets: result.changes.length,
    decisions: result.decisions.map((d) => ({
      targetId: d.targetId,
      status: d.status,
      action: d.action,
      reasons: d.reasons,
    })),
    newASRRequests: receipts.length,
    completedRequests: receipts.filter((r) => r.status === "completed").length,
    audioSeconds: m.budget.seconds,
    modelLoadCount: "UNKNOWN",
    retries: 0,
    newWholeMediaASR: 0,
    newVAD: 0,
    referenceTextUsedByGeneration: false,
    baselineHash: m.baselineHash,
    candidateHash: identity(result.records),
  };
  await durable(path.join(run, "summary.json"), summary, true);
  await fs.writeFile(
    path.join(run, "OUTPUT_INDEX.md"),
    `# 独立纠错候选稿\n\n状态：needs-review；不是人工终稿，不替换原件。\n\n- [播放候选 ASS](candidate/subtitle.corrected.machine-candidate.ass)\n- [SRT](candidate/subtitle.corrected.machine-candidate.srt)\n- [逐项改动](changes.json)\n- [保留或拒绝的原因](decisions.json)\n- [运行结果](summary.json)\n\n本地材料可能含私人路径，不应原样公开。参考稿比较在决策冻结后单独进行；案例来自已知问题，不是盲测。\n`,
    { flag: "wx" },
  );
  const files = [];
  for (const name of (await fs.readdir(run)).sort()) {
    if (name === "runtime") continue;
    const s = await fs.lstat(path.join(run, name));
    if (s.isDirectory())
      files.push(
        ...(await inventory(path.join(run, name))).map((f) => ({
          ...f,
          path: name + "/" + f.path,
        })),
      );
    else if (s.isFile())
      files.push({ path: name, sha256: await fileHash(path.join(run, name)) });
    else throw Error("UNEXPECTED_OUTPUT_ENTRY");
  }
  await durable(
    path.join(run, "decision-freeze.json"),
    { version: "machine-correction-decision-v1", files },
    true,
  );
  return verifyCorrection(run);
}

export async function verifyCorrection(run) {
  const frozen = await readJson(path.join(run, "decision-freeze.json"));
  await verifyBoundFiles(run, frozen.files);
  const { m, result, views } = await calculate(run);
  for (const [file, expected] of [
    ["candidate-records.json", result.records],
    ["decisions.json", result.decisions],
    ["changes.json", result.changes],
    ["views.json", views],
  ]) {
    if (!jsonEqual(await readJson(path.join(run, file)), expected))
      throw Error("DECISION_REPLAY_MISMATCH:" + file);
  }
  await verifyBoundFiles(m.previousRun, m.priorFiles);
  validateProjection(
    Object.fromEntries(
      await Promise.all(
        ["ass", "srt", "vtt"].map(async (f) => [
          f,
          await fs.readFile(
            path.join(
              run,
              "candidate",
              "subtitle.corrected.machine-candidate." + f,
            ),
            "utf8",
          ),
        ]),
      ),
    ),
    result.records,
  );
  return {
    verified: true,
    newASR: 0,
    verificationCodeIdenticalToExecution: jsonEqual(
      m.code,
      await codeInventory(),
    ),
    ...(await readJson(path.join(run, "summary.json"))),
  };
}
