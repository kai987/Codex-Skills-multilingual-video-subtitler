import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { z } from "zod";
import {
  storedBundleSchema,
  consumeStoredWhisper,
} from "../packages/video-subtitler/dist/machine-quality/stored-token-span.js";
import {
  acousticBundleSchema,
  observationSchema,
} from "../packages/video-subtitler/dist/machine-quality/bounded-acoustic.js";
import { replayPrimaryAssembly } from "../packages/video-subtitler/dist/machine-quality/matched-replay.js";
import {
  GROUP_POLICY,
  prepareSourceGroup,
  alignmentTarget,
  consumeGroupAlignment,
  sourceGroupSchema,
  alignmentSchema,
  groupPatchSchema,
} from "../packages/video-subtitler/dist/machine-quality/source-bound-group.js";
import { QUALITY_EVALUATION_POLICY } from "../packages/video-subtitler/dist/machine-quality/experimental-metrics.js";
import {
  repo,
  read,
  write,
  hashFile,
  objectHash,
  verifyPlan,
  checkFiles,
  walk,
  wavInfo,
  variants,
} from "./c601164-common.mjs";
const [phase, ...args] = process.argv.slice(2);
const codeFiles = [
  "scripts/runtime/source_group_ctc_worker.py",
  "scripts/runtime/ctc_worker.py",
  "scripts/run-c601164.mjs",
  "scripts/c601164-common.mjs",
  "scripts/generate-c601164.mjs",
  "scripts/evaluate-c601164.mjs",
  "packages/video-subtitler/dist/machine-quality/source-bound-group.js",
  "packages/video-subtitler/dist/machine-quality/matched-replay.js",
  "packages/video-subtitler/dist/machine-quality/stored-token-span.js",
  "packages/video-subtitler/dist/machine-quality/experimental-metrics.js",
  "package-lock.json",
];
if (phase === "prepare") {
  const [oldArg, storedArg, runtimeArg, modelArg, outArg] = args;
  if (!outArg)
    throw Error(
      "prepare <old-acoustic-run> <stored-run> <runtime-manifest> <model-manifest> <new-output>",
    );
  const oldDir = path.resolve(oldArg),
    storedDir = path.resolve(storedArg),
    output = path.resolve(outArg);
  const primaryFile = path.join(oldDir, "machine-evidence.json"),
    oldFile = path.join(oldDir, "evidence/frozen.json"),
    tokenFile = path.join(storedDir, "token-span-evidence.json");
  const old = acousticBundleSchema.parse(read(oldFile)),
    tokens = storedBundleSchema.parse(read(tokenFile)),
    primary = read(primaryFile),
    oldPlan = read(path.join(oldDir, "experiment-plan.json"));
  if (
    old.primaryHash !== hashFile(primaryFile) ||
    tokens.primaryHash !== old.primaryHash ||
    tokens.oldEvidenceHash !== hashFile(oldFile) ||
    old.planHash !== hashFile(path.join(oldDir, "experiment-plan.json"))
  )
    throw Error("Old evidence identities invalid");
  const runtime = read(runtimeArg),
    model = read(modelArg);
  const pinned = "2162c9edb97f362f7623d6b3a2e417458e879bca";
  if (
    model.resolvedRevision !== pinned ||
    model.modelRepo !== "reazon-research/japanese-wav2vec2-large-rs35kh"
  )
    throw Error("Unpinned CTC model");
  fs.accessSync(runtime.pythonExecutable, fs.constants.X_OK);
  for (const f of model.modelFiles)
    if (
      hashFile(path.join(model.snapshotDirectory, f.relativePath)) !== f.sha256
    )
      throw Error("Installed model bytes changed");
  const distributions = path.join(
    runtime.runtimeDirectory,
    "lib",
    "python3.12",
    "site-packages",
  );
  const installed = fs.readdirSync(distributions);
  for (const p of runtime.packages.filter((p) =>
    ["torch", "transformers", "numpy", "soundfile"].includes(p.name),
  ))
    if (
      !installed.some(
        (n) =>
          n.toLowerCase() ===
          `${p.name.replaceAll("-", "_")}-${p.version}.dist-info`.toLowerCase(),
      )
    )
      throw Error("Installed runtime metadata mismatch");
  const stage = replayPrimaryAssembly(primary, true).trace.find(
    (t) => t.stageName === "deduplicateTopScoreWinners",
  ).output;
  const groups = tokens.cases.map((c) =>
    prepareSourceGroup(c, stage, tokens.observations),
  );
  const inputs = [],
    requests = [];
  for (const req of oldPlan.requests) {
    const rfile = path.join(oldDir, `requests/${req.id}.json`),
      r = read(rfile);
    if (
      r.requestHash !== objectHash(req) ||
      r.planHash !== old.planHash ||
      r.observationHash !== objectHash(r.observation) ||
      r.observation.resultHash !== objectHash(r.raw) ||
      objectHash(observationSchema.parse(r.observation)) !==
        objectHash(old.observations.find((o) => o.requestId === req.id))
    )
      throw Error("Persisted response changed");
    inputs.push({ path: rfile, sha256: hashFile(rfile) });
    if (req.family !== "whisper") continue;
    const o = tokens.observations.find((o) => o.requestId === req.id),
      rawFile = path.join(oldDir, `requests/${req.id}.raw.json`);
    if (
      !o ||
      hashFile(rawFile) !== o.rawFileHash ||
      objectHash(read(rawFile)) !== objectHash(o.rawResponse)
    )
      throw Error("Stored full transcript mismatch");
    const regenerated = consumeStoredWhisper(o.rawResponse, o);
    if (objectHash(regenerated) !== objectHash(o))
      throw Error("Stored parser mapping mismatch");
    const c = tokens.cases.find((c) => c.bindingHash === req.caseBindingHash),
      audioPath = path.join(oldDir, "audio-clips", c.id, `${req.windowId}.wav`),
      wav = wavInfo(audioPath);
    if (
      wav.audioHash !== req.audioHash ||
      wav.audioHash !== o.audioHash ||
      Math.abs(wav.durationSeconds - (o.window.end - o.window.start)) >
        1 / 16000
    )
      throw Error("Physical WAV identity mismatch");
    requests.push({
      requestId: o.requestId,
      sourceObservationHash: objectHash(o),
      rawFileHash: o.rawFileHash,
      audioPath,
      ...wav,
      mediaGlobalStart: o.window.start,
      window: o.window,
      ...alignmentTarget(o.parents.map((p) => p.originalText).join("")),
      paddingSeconds: 0,
      logicalTasks: 1,
      device: "cpu",
      dtype: "float32",
      algorithm: "mvl-ctc-viterbi-v1-frame-cells",
    });
  }
  if (
    requests.length !== 6 ||
    requests.some((r) => r.durationSeconds > 30) ||
    requests.reduce((n, r) => n + r.durationSeconds, 0) > 180
  )
    throw Error("Frozen alignment budget invalid");
  fs.mkdirSync(output);
  write(output, "inputs/primary.json", primary);
  write(output, "inputs/old-evidence.json", old);
  write(output, "inputs/stored-evidence.json", tokens);
  write(output, "source-groups.json", groups);
  write(output, "input-verification.json", {
    inputs,
    oldPrimaryHash: old.primaryHash,
    oldPlanHash: old.planHash,
    oldEvidenceHash: hashFile(oldFile),
    storedEvidenceHash: hashFile(tokenFile),
    oldDecode: oldPlan.decode,
    oldModels: oldPlan.models,
    source: primary.source,
    newASRRequests: 0,
  });
  // Positive real-shape consumer tests MUST pass before the frozen acoustic plan.
  const test = execFileSync(
    process.execPath,
    [
      "node_modules/vitest/vitest.mjs",
      "run",
      "tests/c601164-source-bound-group.test.ts",
      "tests/e2e/c601164-group-export.test.ts",
      "--maxWorkers=2",
    ],
    {
      cwd: repo,
      encoding: "utf8",
      env: {
        ...process.env,
        MVL_MFA_INTEGRATION_TEST: "0",
        MVL_SPEAKER_INTEGRATION_TEST: "0",
      },
    },
  );
  write(output, "validation/prealignment-tests.txt", test);
  const plan = {
    version: "c601164-alignment-plan-v1",
    policy: GROUP_POLICY,
    evaluationPolicy: QUALITY_EVALUATION_POLICY,
    evaluationComparison:
      "T2 predeclared main; full-format CER; fixed reference-content groups plus match-set effects; ambiguous local boundaries excluded, never sliced",
    sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repo,
      encoding: "utf8",
    }).trim(),
    primaryHash: hashFile(path.join(output, "inputs/primary.json")),
    baselineExportHashes: Object.fromEntries(
      ["ass", "srt", "vtt"].map((ext) => [
        ext,
        hashFile(
          path.join(
            storedDir,
            `run-a/S0-legacy-policy/machine-candidate.${ext}`,
          ),
        ),
      ]),
    ),
    groupsHash: hashFile(path.join(output, "source-groups.json")),
    codeHashes: Object.fromEntries(
      codeFiles.map((p) => [p, hashFile(path.join(repo, p))]),
    ),
    runtime,
    model: { ...model, separationModel: undefined },
    runtimeManifestHash: hashFile(runtimeArg),
    modelManifestHash: hashFile(modelArg),
    capability:
      "INSTALLED_PINNED_CTC_VITERBI_COMPLETE_SYMBOL_INTERVALS_CONDITIONAL_ON_TEXT",
    requests,
    budget: {
      logicalTasks: 6,
      maximumAttempts: 8,
      retrySlots: 2,
      retriesOnly: "execution failures same request; no automatic retry",
      maximumAudioSeconds: 180,
      maximumTaskSeconds: 30,
      paddingSeconds: 0,
      plannedSeconds: requests.reduce((n, r) => n + r.durationSeconds, 0),
    },
    noASR: true,
    defaultPromotionAuthorized: false,
    humanValidated: false,
    dataset: "KNOWN_DEVELOPMENT_NOT_HELDOUT",
    frozenAt: new Date().toISOString(),
  };
  write(output, "alignment-plan.json", plan);
  for (const [name, schema] of Object.entries({
    "source-group": sourceGroupSchema,
    alignment: alignmentSchema,
    "group-patch": groupPatchSchema,
  }))
    write(output, `validation/${name}.schema.json`, z.toJSONSchema(schema));
  write(output, "prealignment-freeze.json", {
    frozenAt: new Date().toISOString(),
    files: Object.fromEntries(
      walk(output).map((p) => [path.relative(output, p), hashFile(p)]),
    ),
    goldRead: false,
  });
  console.log(
    "PREALIGNMENT_FROZEN",
    requests.length,
    plan.budget.plannedSeconds,
  );
} else if (phase === "execute-alignment") {
  const output = path.resolve(args[0]),
    plan = verifyPlan(output),
    dest = path.join(output, "alignment-evidence");
  for (const f of plan.model.modelFiles)
    if (
      hashFile(path.join(plan.model.snapshotDirectory, f.relativePath)) !==
      f.sha256
    )
      throw Error("Frozen model bytes changed before load");
  if (fs.existsSync(dest))
    throw Error(
      "Existing execution: inspect persisted ledger; automatic resume/retry prohibited",
    );
  fs.mkdirSync(dest);
  const eventsFile = path.join(dest, "events.jsonl");
  const event = (v) =>
    fs.appendFileSync(
      eventsFile,
      JSON.stringify({ ...v, recordedAt: new Date().toISOString() }) + "\n",
      { flush: true },
    );
  event({
    type: "provider-process-start",
    attempted: 1,
    planHash: hashFile(path.join(output, "alignment-plan.json")),
  });
  const literal = (p) => `(literal ${JSON.stringify(p)})`;
  const sb = `(version 1)(allow default)(deny network*)(deny file-read* (subpath ${JSON.stringify(path.join(os.homedir(), "Documents"))}) (subpath ${JSON.stringify(path.join(os.homedir(), "Downloads"))}))(allow file-read* (subpath ${JSON.stringify(repo)}) ${plan.requests.map((r) => literal(r.audioPath)).join(" ")})`;
  const child = spawn(
    "/usr/bin/sandbox-exec",
    [
      "-p",
      sb,
      plan.runtime.pythonExecutable,
      "-u",
      path.join(repo, "scripts/runtime/source_group_ctc_worker.py"),
      plan.model.snapshotDirectory,
    ],
    {
      cwd: repo,
      env: {
        PATH: process.env.PATH,
        LANG: "en_US.UTF-8",
        PYTHONDONTWRITEBYTECODE: "1",
        HF_HUB_OFFLINE: "1",
        TRANSFORMERS_OFFLINE: "1",
        HF_HUB_DISABLE_TELEMETRY: "1",
        OMP_NUM_THREADS: "8",
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  child.stderr.on("data", (b) =>
    fs.appendFileSync(path.join(dest, "stderr.log"), b),
  );
  const queue = [],
    waiting = [];
  let ended = false;
  const deliver = (v) => (waiting.length ? waiting.shift()(v) : queue.push(v));
  createInterface({ input: child.stdout }).on("line", (line) => {
    const v = JSON.parse(line);
    event(v);
    deliver(v);
  });
  child.on("close", (code) => {
    ended = true;
    event({ type: "provider-process-close", code });
    deliver({ type: "closed", code });
  });
  const next = () =>
    queue.length
      ? Promise.resolve(queue.shift())
      : ended
        ? Promise.reject(Error("Worker closed"))
        : new Promise((resolve) => waiting.push(resolve));
  const results = [];
  let ready,
    attempts = 0,
    seconds = 0,
    forwards = 0;
  try {
    while (!ready) {
      const v = await next();
      if (v.type === "closed") throw Error("CTC startup failed");
      if (v.type === "ready") ready = v;
    }
    for (const p of plan.runtime.packages)
      if (
        ready.versions[p.name] !== undefined &&
        ready.versions[p.name] !== p.version
      )
        throw Error("Runtime ready identity mismatch");
    for (const request of plan.requests) {
      attempts++;
      seconds += request.durationSeconds;
      if (attempts > 8 || seconds > 180)
        throw Error("Execution budget exceeded");
      write(dest, `${request.requestId}.attempt.json`, {
        attempt: attempts,
        request,
        requestHash: objectHash(request),
        startedAt: new Date().toISOString(),
        status: "STARTED_NOT_AUTOMATICALLY_RETRYABLE",
      });
      event({
        type: "logical-alignment-attempt",
        requestId: request.requestId,
        attempts,
        seconds,
      });
      child.stdin.write(JSON.stringify(request) + "\n");
      let done = false;
      while (!done) {
        const v = await next();
        if (v.type === "closed")
          throw Error("Worker interrupted; preserve consumed attempt");
        if (v.type === "acoustic-forward-start") forwards++;
        if (v.type === "result") {
          if (v.result.requestId !== request.requestId)
            throw Error("Cross-request result");
          write(dest, `${request.requestId}.raw.json`, v.result);
          results.push(v);
          done = true;
        }
      }
    }
    child.stdin.end(JSON.stringify({ type: "shutdown" }) + "\n");
    while (!ended) {
      const v = await next();
      if (v.type === "closed") break;
    }
    const tokens = storedBundleSchema.parse(
      read(path.join(output, "inputs/stored-evidence.json")),
    );
    const alignments = results.map((v) =>
      consumeGroupAlignment(
        tokens.observations.find((o) => o.requestId === v.result.requestId),
        v.result,
      ),
    );
    write(output, "alignments.json", alignments);
    write(output, "alignment-execution.json", {
      planHash: hashFile(path.join(output, "alignment-plan.json")),
      ready,
      logicalTasks: attempts,
      attempts,
      acousticForwardCount: forwards,
      modelLoads: 1,
      modelLoadAttempts: 1,
      providerStarts: 1,
      requestedAudioSeconds: seconds,
      paddingSeconds: 0,
      retries: 0,
      success: results.filter((r) => r.result.status === "SUCCESS").length,
      failures: results.filter((r) => r.result.status !== "SUCCESS").length,
      newASRRequests: 0,
      newASRModelLoads: 0,
      newASRProviderStarts: 0,
      results: results.map((r) => ({
        requestId: r.result.requestId,
        status: r.result.status,
        wallSeconds: r.wallSeconds,
      })),
    });
    write(output, "alignment-freeze.json", {
      frozenAt: new Date().toISOString(),
      files: Object.fromEntries(
        [
          ...walk(dest),
          path.join(output, "alignments.json"),
          path.join(output, "alignment-execution.json"),
        ].map((p) => [path.relative(output, p), hashFile(p)]),
      ),
    });
    console.log("ALIGNMENT_COMPLETED", attempts, forwards, seconds);
  } finally {
    if (!ended) child.kill("SIGTERM");
  }
} else if (phase === "generate") {
  const output = path.resolve(args[0]);
  verifyPlan(output);
  const alignmentFreeze = read(path.join(output, "alignment-freeze.json"));
  checkFiles(output, alignmentFreeze.files);
  const files = [
    "inputs/primary.json",
    "inputs/old-evidence.json",
    "inputs/stored-evidence.json",
    "source-groups.json",
    "alignments.json",
    "alignment-plan.json",
  ].map((p) => path.join(output, p));
  const runs = {},
    manifests = {};
  for (const run of ["run-a", "run-b"]) {
    const target = path.join(output, run);
    execFileSync(
      "/usr/bin/sandbox-exec",
      [
        "-p",
        "(version 1)(allow default)(deny network*)",
        process.execPath,
        "--permission",
        "--allow-fs-read=" + repo,
        ...files.map((p) => "--allow-fs-read=" + p),
        "--allow-fs-read=" + target,
        "--allow-fs-read=" + target + "/*",
        "--allow-fs-write=" + target,
        "--allow-fs-write=" + target + "/*",
        path.join(repo, "scripts/generate-c601164.mjs"),
        ...files,
        target,
      ],
      {
        stdio: "inherit",
        env: { PATH: process.env.PATH, LANG: "en_US.UTF-8", TZ: "UTC" },
      },
    );
    runs[run] = read(path.join(target, "experiment-manifest.json")).files;
    manifests[run] = hashFile(path.join(target, "experiment-manifest.json"));
  }
  if (objectHash(runs["run-a"]) !== objectHash(runs["run-b"]))
    throw Error("Independent A/B mismatch");
  write(
    output,
    "patches/native.json",
    read(path.join(output, "run-a/patches-native.json")),
  );
  write(
    output,
    "patches/aligned.json",
    read(path.join(output, "run-a/patches-aligned.json")),
  );
  const metadata = Object.fromEntries(
    walk(output)
      .filter((p) => !p.includes("/run-a/") && !p.includes("/run-b/"))
      .map((p) => [path.relative(output, p), hashFile(p)]),
  );
  write(output, "generation-freeze.json", {
    version: "c601164-generation-freeze-v1",
    frozenAt: new Date().toISOString(),
    runs,
    manifests,
    metadata,
    generationIsolation:
      "Node24 exact machine input allowlist; child/addon denied; macOS deny network",
    goldRead: false,
  });
  write(output, "experiment-manifest.json", {
    version: "c601164-experiment-v1",
    generationFreezeHash: hashFile(path.join(output, "generation-freeze.json")),
    status: "needs-review",
    finalizationMethod: "none",
    humanValidated: false,
    defaultPromotionAuthorized: false,
    machineOnlyReleaseAuthorized: false,
    mainResearchCandidate: "T2-aligned-group",
    variants,
  });
  write(
    output,
    "OUTPUT_INDEX.md",
    "# Source-bound local resegmentation\n\nLocal research package, not public-shareable.\n\n- `run-a/T2-aligned-group/machine-candidate.ass`: main research candidate; SRT/VTT beside it\n- `run-a/` and independently executed `run-b/`: four controls\n- `alignment-plan.json`, `source-groups.json`, `prealignment-freeze.json`: pre-execution freeze\n- `alignment-evidence/`, `alignments.json`, `alignment-execution.json`: real bounded conditional timing, not lexical truth\n- `patches/`, stage traces: atomic group mutations and abstentions\n- `generation-freeze.json`: pre-Gold machine barrier\n- `evaluation/`: post-freeze reference evaluation\n\nAll outputs are needs-review; no finalization/default promotion.\n",
  );
  console.log("GENERATION_FROZEN_AB_PARITY");
} else throw Error("Expected prepare, execute-alignment or generate");
