/** Frozen local experiment. Reference-bearing files are not read by this module. */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  authorizationSchema,
  bindPlan,
  sampleAt,
  localPolicy,
  localRecords,
  integrateRecords,
} from "./local-asr-policy.mjs";
import {
  durable,
  experimentSchema,
  EvidenceRunner,
  readPcm,
  slicePcm,
} from "./bounded-asr-ab.mjs";
import { authenticateAudio, coreSlice } from "./bounded-content-review.mjs";
import { hash, identity, json } from "./content-review-plan.mjs";
import {
  formatProjection,
  validateProjection,
} from "./representation-grid.mjs";

export const readJson = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
export const exists = async (p) =>
  fs.access(p).then(
    () => true,
    (e) => {
      if (e.code === "ENOENT") return false;
      throw e;
    },
  );
export async function fileHash(p) {
  const h = createHash("sha256");
  for await (const b of createReadStream(p)) h.update(b);
  return h.digest("hex");
}
const same = (a, b, s) => {
  if (json(a) !== json(b)) throw Error(s);
};
export async function immutable(p, v) {
  if (await exists(p)) {
    same(await readJson(p), v, "IMMUTABLE_CONFLICT:" + path.basename(p));
    return;
  }
  await durable(p, v, true);
}
export async function inventory(root, rel = "") {
  const rows = [];
  for (const n of (await fs.readdir(path.join(root, rel))).sort()) {
    const r = path.posix.join(rel, n),
      p = path.join(root, r),
      s = await fs.lstat(p);
    if (s.isSymbolicLink()) throw Error("FREEZE_SYMLINK");
    if (s.isDirectory()) rows.push(...(await inventory(root, r)));
    else if (s.isFile())
      rows.push({ path: r, sha256: await fileHash(p), bytes: s.size });
    else throw Error("FREEZE_SPECIAL_FILE");
  }
  return rows;
}
export async function checkFiles(root, files) {
  for (const r of files) {
    if (path.isAbsolute(r.path) || r.path.split("/").includes(".."))
      throw Error("UNSAFE_PATH");
    if ((await fileHash(path.join(root, r.path))) !== r.sha256)
      throw Error("FROZEN_FILE_CHANGED:" + r.path);
  }
}
const prefix = "B/representation-recovered/";
// Explicit allowlist: never read input-evidence.json, reference/, or comparison/ here.
export async function machineInput(bundle, a) {
  const freezeBytes = await fs.readFile(
    path.join(bundle, "results-freeze.json"),
  );
  if (hash(freezeBytes) !== a.recoveryFreezeSha256)
    throw Error("RECOVERY_FREEZE_CHANGED");
  const freeze = JSON.parse(freezeBytes);
  if (freeze.identity !== a.recoveryIdentity) throw Error("RECOVERY_IDENTITY");
  const names = [
    "recovery-manifest.json",
    "localization/local-asr-plan.json",
    "B/raw-records.json",
    prefix + "representation-recovery-map.json",
    prefix + "export-map.json",
    ...["ass", "srt", "vtt"].map(
      (f) => prefix + "primary-minimal.representation-recovered.partial." + f,
    ),
  ];
  const contents = {};
  for (const name of names) {
    const b = await fs.readFile(path.join(bundle, name));
    if (hash(b) !== freeze.files.find((x) => x.path === name)?.sha256)
      throw Error("MACHINE_INPUT_CHANGED:" + name);
    contents[name] = b;
  }
  const manifest = JSON.parse(contents["recovery-manifest.json"]);
  if (
    manifest.identity !== identity(manifest.payload) ||
    manifest.identity !== a.recoveryIdentity
  )
    throw Error("RECOVERY_MANIFEST");
  const raw = JSON.parse(contents["B/raw-records.json"]),
    projection = JSON.parse(
      contents[prefix + "representation-recovery-map.json"],
    ),
    map = JSON.parse(contents[prefix + "export-map.json"]);
  const ordered = map.accounting
    .filter((r) => r.disposition === "retained")
    .sort((a, b) => a.outputOrdinal - b.outputOrdinal);
  const baseline = ordered.map((r, i) => {
    if (r.outputOrdinal !== i + 1) throw Error("BASELINE_ORDER");
    const original = raw.find((x) => x.recordId === r.recordId),
      p = projection.records.find((x) => x.recordId === r.recordId);
    if (!original || !p?.recoveredSerialized)
      throw Error("BASELINE_PROJECTION");
    return {
      ...original,
      sourceStart: p.recoveredSerialized.start.seconds,
      sourceEnd: p.recoveredSerialized.end.seconds,
    };
  });
  if (
    baseline.length !== a.baselineCount ||
    new Set(baseline.map((x) => x.recordId)).size !== a.baselineCount
  )
    throw Error("BASELINE_COUNT");
  validateProjection(
    Object.fromEntries(
      ["ass", "srt", "vtt"].map((f) => [
        f,
        contents[
          prefix + "primary-minimal.representation-recovered.partial." + f
        ].toString(),
      ]),
    ),
    baseline,
  );
  return {
    baseline,
    raw,
    planBytes: contents["localization/local-asr-plan.json"],
    files: names.map((name) => ({ path: name, sha256: hash(contents[name]) })),
    manifest,
  };
}
export function decoderArgs(model, wav, out, m) {
  return [
    "--model",
    model,
    "--file",
    wav,
    "--language",
    m.language,
    "--threads",
    String(m.threads),
    "--output-srt",
    "--output-file",
    out,
    "--suppress-nst",
    "--no-prints",
  ];
}
// Historical evidence stored the options section, excluding usage/backend banners.
const normalizeHelp = (s) => s.slice(s.indexOf("options:")).trim();
const repo = path.resolve(import.meta.dirname, "../..");
async function executionCode() {
  const names = [
    "scripts/lib/local-asr-run.mjs",
    "scripts/lib/local-asr-policy.mjs",
    "scripts/lib/bounded-asr-ab.mjs",
    "scripts/lib/bounded-content-review.mjs",
    "scripts/lib/representation-grid.mjs",
    "scripts/lib/bounded-diagnostics.mjs",
    "packages/video-subtitler/dist/standalone/recovery.js",
  ];
  return Promise.all(
    names.map(async (p) => ({
      path: p,
      sha256: await fileHash(path.join(repo, p)),
    })),
  );
}
export async function prepare(o) {
  const a = authorizationSchema.parse(await readJson(o.authorization));
  const input = await machineInput(o.recoveryBundle, a),
    plan = bindPlan(input.planBytes, a, o.authorizeFrozenLocalAsr);
  const eb = await fs.readFile(path.join(o.audioRoot, "experiment.json"));
  if (hash(eb) !== a.experimentSha256) throw Error("EXPERIMENT_CHANGED");
  const m = experimentSchema.parse(JSON.parse(eb));
  if (
    m.pcm.pcmHash !== a.sourcePcmSha256 ||
    m.pcm.frames !== a.sourceFrames ||
    m.audioOffset !== a.audioOffset ||
    m.baseline.source.sha256 !== a.sourceMediaSha256
  )
    throw Error("SOURCE_BINDING");
  if (
    m.baseline.model.sha256 !== a.modelSha256 ||
    m.baseline.runtime.sha256 !== a.runtimeSha256 ||
    (await fileHash(o.model)) !== a.modelSha256 ||
    (await fileHash(o.runtime)) !== a.runtimeSha256
  )
    throw Error("RUNTIME_MODEL_BINDING");
  if (
    m.decode.prompt !== null ||
    m.decode.vad !== false ||
    m.decode.coreML !== false ||
    m.decode.suppressNst !== true ||
    m.decode.timestamp !== "segment" ||
    m.decode.requestIsolation !== "independent-cli-process"
  )
    throw Error("DECODER_CONTRACT");
  const help = await new EvidenceRunner().run(o.runtime, ["--help"]);
  const helpText = help.stdout + help.stderr;
  if (normalizeHelp(helpText) !== normalizeHelp(m.decode.optionsText))
    throw Error("RUNTIME_OPTIONS_CHANGED");
  const audio = await authenticateAudio({ root: o.audioRoot, m }, o.audioRoot);
  if (audio.proof.status !== "AUTHENTICATED") throw Error(audio.proof.status);
  await fs.mkdir(o.outputRoot, { recursive: true });
  const run = await fs.mkdtemp(path.join(o.outputRoot, "frozen-local-asr-"));
  await fs.chmod(run, 0o700);
  for (const d of ["source", "windows", "runtime"])
    await fs.mkdir(path.join(run, d));
  await fs.symlink(
    await fs.realpath(o.model),
    path.join(run, "runtime", "model.bin"),
  );
  await durable(
    path.join(run, "source/reconstruction.json"),
    audio.proof,
    true,
  );
  const windows = [];
  for (const w of plan.windows) {
    const start =
        sampleAt(w.requestStart, a.sampleRate) -
        sampleAt(a.audioOffset, a.sampleRate),
      end =
        sampleAt(w.requestEnd, a.sampleRate) -
        sampleAt(a.audioOffset, a.sampleRate),
      slice = coreSlice(audio.chunks, start, end),
      wav = slicePcm(
        { sampleRate: a.sampleRate, frames: end - start, data: slice.data },
        0,
        end - start,
      ),
      dir = path.join(run, "windows", w.windowId);
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, "input.wav"), wav, { flag: "wx" });
    const reread = readPcm(await fs.readFile(path.join(dir, "input.wav")));
    if (reread.frames !== end - start || hash(reread.data) !== hash(slice.data))
      throw Error("WAV_REREAD");
    const request = {
      ...w,
      startSample: start,
      endSample: end,
      pcmHash: hash(slice.data),
      wavHash: hash(wav),
      sourceSegments: slice.segments,
      referenceTextUsedAsPrompt: false,
      prompt: null,
    };
    request.requestId = identity({
      window: w,
      pcmHash: request.pcmHash,
      runtime: a.runtimeSha256,
      model: a.modelSha256,
      decode: m.decode,
    });
    await durable(path.join(dir, "request.json"), request, true);
    windows.push(request);
  }
  const config = {
    version: "frozen-local-asr-execution-v1",
    code: await executionCode(),
    authorization: a,
    recoveryBundle: await fs.realpath(o.recoveryBundle),
    audioRoot: await fs.realpath(o.audioRoot),
    runtime: await fs.realpath(o.runtime),
    model: await fs.realpath(o.model),
    experiment: m,
    windows,
    inputFiles: input.files,
    baselineHash: identity(input.baseline),
    policy: localPolicy,
    help: {
      sha256: hash(helpText),
      currentText: helpText,
      contractMatched: true,
    },
    budget: {
      primaryRequests: plan.windows.length,
      primarySamples: plan.primarySamples,
      maxDispatches: plan.windows.length + 1,
      maxSamples: plan.primarySamples + plan.maxSamples,
    },
    referenceBodyRead: false,
    wholeSourceDecoded: false,
  };
  await durable(path.join(run, "experiment.json"), config, true);
  await durable(
    path.join(run, "execution-policy.json"),
    {
      identity: identity(config),
      referenceBodyRead: false,
      prompt: null,
      allowlist: windows.map((w) => w.requestId),
      budget: config.budget,
    },
    true,
  );
  await fs.writeFile(path.join(run, "execution-ledger.jsonl"), "", {
    flag: "wx",
  });
  await durable(
    path.join(run, "execution-freeze.json"),
    {
      configHash: identity(config),
      files: [
        {
          path: "experiment.json",
          sha256: await fileHash(path.join(run, "experiment.json")),
        },
        {
          path: "execution-policy.json",
          sha256: await fileHash(path.join(run, "execution-policy.json")),
        },
        ...(await inventory(path.join(run, "source"))).map((r) => ({
          ...r,
          path: "source/" + r.path,
        })),
        ...(await inventory(path.join(run, "windows"))).map((r) => ({
          ...r,
          path: "windows/" + r.path,
        })),
      ],
    },
    true,
  );
  return run;
}
export async function journal(run) {
  const text = await fs.readFile(
    path.join(run, "execution-ledger.jsonl"),
    "utf8",
  );
  if (text && !text.endsWith("\n")) throw Error("TORN_LEDGER");
  const rows = text.trim()
    ? text
        .trim()
        .split("\n")
        .map((s) => JSON.parse(s))
    : [];
  let previous = null;
  for (const [index, r] of rows.entries()) {
    const { hash: h, ...v } = r;
    if (
      v.index !== index ||
      v.previous !== previous ||
      identity(v) !== h ||
      !["reserved", "finished"].includes(r.kind)
    )
      throw Error("LEDGER_CHAIN");
    previous = h;
  }
  return rows;
}
async function append(run, v) {
  const rows = await journal(run),
    entry = { ...v, index: rows.length, previous: rows.at(-1)?.hash ?? null };
  entry.hash = identity(entry);
  const h = await fs.open(path.join(run, "execution-ledger.jsonl"), "a");
  try {
    await h.writeFile(JSON.stringify(entry) + "\n");
    await h.sync();
  } finally {
    await h.close();
  }
  return entry;
}
export function checkJournal(config, rows) {
  const reserved = rows.filter((x) => x.kind === "reserved"),
    finished = rows.filter((x) => x.kind === "finished");
  let samples = 0,
    retries = 0;
  const seen = new Set();
  for (const r of reserved) {
    const w = config.windows.find((w) => w.requestId === r.requestId);
    if (
      !w ||
      r.samples !== w.endSample - w.startSample ||
      seen.has(r.attemptId)
    )
      throw Error("LEDGER_REQUEST");
    seen.add(r.attemptId);
    const prior = reserved.filter(
      (x) => x.requestId === r.requestId && x.index < r.index,
    );
    if (prior.length) {
      retries++;
      const f = finished.find((x) => x.attemptId === prior.at(-1).attemptId);
      if (
        prior.length !== 1 ||
        f?.status !== "TECHNICAL_FAILED" ||
        f.index >= r.index
      )
        throw Error("ILLEGAL_RETRY");
    }
    samples += r.samples;
  }
  for (const f of finished) {
    const r = reserved.find((r) => r.attemptId === f.attemptId);
    if (
      !r ||
      r.index >= f.index ||
      finished.filter((x) => x.attemptId === f.attemptId).length !== 1 ||
      ![
        "TECHNICAL_FAILED",
        "SUCCESS_EMPTY",
        "SUCCESS_NONEMPTY",
        "SUCCESS_TIMING_INVALID",
      ].includes(f.status)
    )
      throw Error("LEDGER_FINISH");
  }
  if (
    retries > 1 ||
    reserved.length > config.budget.maxDispatches ||
    samples > config.budget.maxSamples
  )
    throw Error("BUDGET_EXCEEDED");
  return {
    dispatches: reserved.length,
    primary: reserved.length - retries,
    retries,
    samples,
  };
}
export async function loadRun(run) {
  const f = await readJson(path.join(run, "execution-freeze.json"));
  await checkFiles(run, f.files);
  const c = await readJson(path.join(run, "experiment.json"));
  if (c.code) await checkFiles(repo, c.code);
  if (identity(c) !== f.configHash) throw Error("EXECUTION_FREEZE");
  return c;
}
export async function execute(run, authorized, runner = new EvidenceRunner()) {
  if (!authorized) throw Error("EXPLICIT_AUTHORIZATION_REQUIRED");
  const lock = path.join(run, "execution.lock");
  const handle = await fs.open(lock, "wx");
  try {
    const c = await loadRun(run);
    let rows = await journal(run);
    checkJournal(c, rows);
    if (await exists(path.join(run, "raw-freeze.json"))) {
      await verifyRaw(run);
      return { newASR: 0, checkpointReused: c.windows.length };
    }
    if (
      (await exists(path.join(run, "integration/decision-freeze.json"))) ||
      (await exists(path.join(run, "evaluation")))
    )
      throw Error("POST_FREEZE_EXECUTION_FORBIDDEN");
    if (
      (await fileHash(c.runtime)) !== c.authorization.runtimeSha256 ||
      (await fileHash(c.model)) !== c.authorization.modelSha256
    )
      throw Error("RUNTIME_MODEL_CHANGED");
    let dispatched = 0;
    for (const w of c.windows) {
      let prior = rows.filter(
        (r) => r.kind === "reserved" && r.requestId === w.requestId,
      );
      const last = prior.at(-1);
      let done = last
        ? rows.find(
            (r) => r.kind === "finished" && r.attemptId === last.attemptId,
          )
        : null;
      if (last && !done)
        throw Error("UNCERTAIN_DISPATCH_REQUIRES_OPERATOR_AUDIT");
      if (done?.status.startsWith("SUCCESS")) {
        await checkFiles(run, done.files);
        continue;
      }
      while (!done?.status.startsWith("SUCCESS")) {
        const counts = checkJournal(c, rows);
        if (prior.length && (counts.retries >= 1 || prior.length >= 2))
          throw Error("TECHNICAL_RETRY_EXHAUSTED");
        const attemptId = w.requestId + "-attempt-" + (prior.length + 1),
          rel = "windows/" + w.windowId + "/" + attemptId,
          dir = path.join(run, rel);
        await fs.mkdir(dir);
        const input = path.join(run, "windows", w.windowId, "input.wav"),
          out = path.join(dir, "raw-response"),
          args = decoderArgs(
            path.join(run, "runtime/model.bin"),
            input,
            out,
            c.experiment,
          );
        const invocation = {
          requestId: w.requestId,
          attemptId,
          args,
          executable: c.runtime,
          prompt: null,
          referenceBodyRead: false,
          decode: c.experiment.decode,
        };
        await durable(path.join(dir, "invocation.json"), invocation, true);
        await append(run, {
          kind: "reserved",
          attemptId,
          requestId: w.requestId,
          samples: w.endSample - w.startSample,
          invocationHash: identity(invocation),
          startedAt: new Date().toISOString(),
        });
        rows = await journal(run);
        checkJournal(c, rows);
        let receipt;
        try {
          receipt = await runner.run(c.runtime, args, {
            cwd: dir,
            timeoutMs: 900000,
          });
        } catch (e) {
          receipt = {
            exitCode: null,
            signal: null,
            stdout: "",
            stderr: String(e),
            spawnError: true,
          };
        }
        dispatched++;
        await fs.writeFile(path.join(dir, "stdout.log"), receipt.stdout);
        await fs.writeFile(path.join(dir, "stderr.log"), receipt.stderr);
        let status = "TECHNICAL_FAILED",
          records = [];
        if (receipt.exitCode === 0 && (await exists(out + ".srt"))) {
          const bytes = await fs.readFile(out + ".srt");
          records = localRecords(bytes, w, c.experiment, {
            requestId: w.requestId,
            attemptId,
            rawHash: hash(bytes),
            modelHash: c.authorization.modelSha256,
            runtimeHash: c.authorization.runtimeSha256,
            pcmHash: w.pcmHash,
            availableMetrics: null,
          });
          status = !records.length
            ? "SUCCESS_EMPTY"
            : records.some((r) => r.ownership === "INVALID_TIMING")
              ? "SUCCESS_TIMING_INVALID"
              : "SUCCESS_NONEMPTY";
        }
        await durable(path.join(dir, "mapped-records.json"), records, true);
        await durable(
          path.join(dir, "result.json"),
          {
            status,
            exitCode: receipt.exitCode,
            signal: receipt.signal,
            spawnError: receipt.spawnError ?? false,
            modelLoadCount: "UNKNOWN",
            recordCount: records.length,
            completedAt: new Date().toISOString(),
          },
          true,
        );
        const files = (await inventory(dir)).map((r) => ({
          ...r,
          path: rel + "/" + r.path,
        }));
        done = await append(run, {
          kind: "finished",
          attemptId,
          requestId: w.requestId,
          status,
          files,
        });
        rows = await journal(run);
        prior = rows.filter(
          (r) => r.kind === "reserved" && r.requestId === w.requestId,
        );
        checkJournal(c, rows);
        console.log(JSON.stringify({ window: w.windowId, status, dispatched }));
      }
    }
    rows = await journal(run);
    const counts = checkJournal(c, rows);
    await immutable(path.join(run, "raw-freeze.json"), {
      version: "frozen-local-asr-raw-v1",
      executionHash: identity(c),
      ledgerSha256: await fileHash(path.join(run, "execution-ledger.jsonl")),
      ledgerTail: rows.at(-1)?.hash,
      counts,
      files: (await inventory(path.join(run, "windows"))).map((r) => ({
        ...r,
        path: "windows/" + r.path,
      })),
      referenceBodyRead: false,
    });
    return {
      newASR: dispatched,
      checkpointReused: c.windows.length - dispatched,
    };
  } finally {
    await handle.close();
    await fs.unlink(lock);
  }
}
export async function verifyRaw(run) {
  const c = await loadRun(run),
    f = await readJson(path.join(run, "raw-freeze.json"));
  if (
    f.executionHash !== identity(c) ||
    f.ledgerSha256 !==
      (await fileHash(path.join(run, "execution-ledger.jsonl")))
  )
    throw Error("RAW_FREEZE");
  await checkFiles(run, f.files);
  same(
    f.files,
    (await inventory(path.join(run, "windows"))).map((r) => ({
      ...r,
      path: "windows/" + r.path,
    })),
    "RAW_FILE_SET",
  );
  const rows = await journal(run);
  same(f.counts, checkJournal(c, rows), "RAW_COUNTS");
  if (f.ledgerTail !== rows.at(-1)?.hash) throw Error("RAW_LEDGER_TAIL");
  const locals = [];
  for (const w of c.windows) {
    const done = rows
      .filter((r) => r.kind === "finished" && r.requestId === w.requestId)
      .at(-1);
    if (!done?.status.startsWith("SUCCESS")) throw Error("INCOMPLETE_RAW");
    await checkFiles(run, done.files);
    const rel = done.files.find((x) => x.path.endsWith("/mapped-records.json"));
    locals.push(...(await readJson(path.join(run, rel.path))));
  }
  return { c, f, rows, locals };
}
export async function publishTriple(
  destination,
  records,
  language,
  writer = fs.writeFile,
) {
  if (await exists(destination)) throw Error("PUBLICATION_EXISTS");
  const stage = await fs.mkdtemp(
    path.join(path.dirname(destination), ".triple-"),
  );
  const name = "primary-minimal.local-asr-recovered.machine-candidate";
  const contents = formatProjection(records, language);
  for (const f of ["ass", "srt", "vtt"])
    await writer(path.join(stage, name + "." + f), contents[f], { flag: "wx" });
  validateProjection(
    Object.fromEntries(
      await Promise.all(
        ["ass", "srt", "vtt"].map(async (f) => [
          f,
          await fs.readFile(path.join(stage, name + "." + f), "utf8"),
        ]),
      ),
    ),
    records,
  );
  await durable(
    path.join(stage, "export-map.json"),
    {
      records: records.map((r, i) => ({
        ordinal: i + 1,
        recordId: r.recordId,
        requestId: r.requestId ?? null,
        integrationDecisionId: r.integrationDecisionId ?? null,
        source: r.source ?? "frozen-B-baseline",
      })),
      count: records.length,
    },
    true,
  );
  await fs.rename(stage, destination);
}
export async function integrate(run) {
  const { c, locals } = await verifyRaw(run);
  const input = await machineInput(c.recoveryBundle, c.authorization);
  if (identity(input.baseline) !== c.baselineHash)
    throw Error("BASELINE_CHANGED");
  const result = integrateRecords(input.baseline, locals),
    dir = path.join(run, "integration");
  await fs.mkdir(dir, { recursive: true });
  for (const [name, v] of Object.entries({
    "local-candidates.json": locals,
    "integration-decisions.json": result.decisions,
    "inserted-records.json": result.inserted,
    "before-records.json": input.baseline,
    "after-records.json": result.records,
  }))
    await immutable(path.join(dir, name), v);
  await immutable(path.join(dir, "decision-freeze.json"), {
    rawFreezeHash: await fileHash(path.join(run, "raw-freeze.json")),
    policy: localPolicy,
    referenceBodyRead: false,
    files: (await inventory(dir))
      .filter(
        (x) =>
          !x.path.startsWith("B-after/") &&
          !x.path.startsWith(".triple-") &&
          x.path !== "decision-freeze.json",
      )
      .map((r) => ({ ...r, path: "integration/" + r.path })),
  });
  if (!(await exists(path.join(dir, "B-after"))))
    await publishTriple(
      path.join(dir, "B-after"),
      result.records,
      c.experiment.language,
    );
  return {
    inserted: result.inserted.length,
    before: input.baseline.length,
    after: result.records.length,
  };
}
export async function verifyIntegration(run) {
  const { c, locals } = await verifyRaw(run),
    f = await readJson(path.join(run, "integration/decision-freeze.json"));
  await checkFiles(run, f.files);
  if (f.rawFreezeHash !== (await fileHash(path.join(run, "raw-freeze.json"))))
    throw Error("DECISION_RAW_BINDING");
  const input = await machineInput(c.recoveryBundle, c.authorization),
    result = integrateRecords(input.baseline, locals);
  same(
    result.decisions,
    await readJson(path.join(run, "integration/integration-decisions.json")),
    "DECISIONS_CHANGED",
  );
  same(
    result.records,
    await readJson(path.join(run, "integration/after-records.json")),
    "ASSEMBLY_CHANGED",
  );
  const stem = path.join(
    run,
    "integration/B-after/primary-minimal.local-asr-recovered.machine-candidate",
  );
  validateProjection(
    Object.fromEntries(
      await Promise.all(
        ["ass", "srt", "vtt"].map(async (f) => [
          f,
          await fs.readFile(stem + "." + f, "utf8"),
        ]),
      ),
    ),
    result.records,
  );
  return { c, input, result };
}
