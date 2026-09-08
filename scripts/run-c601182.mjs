// Bounded coordinator. No reference parser/evaluator and no production registration.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { setTimeout, clearTimeout } from "node:timers";
import { reserveTraceTask } from "../packages/video-subtitler/dist/machine-quality/request-bound-runtime-trace.js";
const root = fs.realpathSync.native(process.argv[2]),
  mode = process.argv[3];
const repo = path.resolve(import.meta.dirname, "..");
const read = (n) => JSON.parse(fs.readFileSync(path.join(root, n)));
const write = (n, v) =>
  fs.writeFileSync(path.join(root, n), JSON.stringify(v, null, 2), {
    flag: "wx",
    mode: 0o600,
  });
const sha = (p) =>
  createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const s = read("selection.local-only.json"),
  b = read("runtime-build-manifest.json");
function runtimeFiles(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? runtimeFiles(path.join(dir, e.name))
        : [path.join(dir, e.name)],
    );
}
const watched = [
  ...runtimeFiles(b.controlled),
  ...read("protected-additions.local-only.json").runtimeFiles.map(
    (f) => f.path,
  ),
  b.module,
  b.ort,
  b.originalModule,
  fs.realpathSync(s.runtime.reazonPython),
  ...s.model.modelFiles.map((f) =>
    path.join(s.runtime.reazonModel, f.fileName),
  ),
  ...s.units.map((u) => path.join(s.old, u.audio)),
  ...[
    "scripts/run-c601182.mjs",
    "scripts/runtime/c601182_trace_worker.py",
    "scripts/runtime/c60118_reazon_worker.py",
    "scripts/runtime/reazonspeech_k2_worker.py",
    "packages/video-subtitler/dist/machine-quality/request-bound-runtime-trace.js",
    "patches/c601182/native-trace.patch",
  ].map((f) => path.join(repo, f)),
];
const identity = watched.map((file) => ({ file, sha256: sha(file) }));
if (
  b.moduleHash !== sha(b.module) ||
  b.originalModuleHash !== sha(b.originalModule)
)
  throw Error("RUNTIME_IDENTITY_MISMATCH");
if (mode === "freeze") {
  const pre = read("native-preflight-final/process.json");
  if (pre.status !== 0) throw Error("NATIVE_PREFLIGHT_REQUIRED");
  write("experiment-manifest.json", {
    schema: "c601182-experiment-v1",
    createdAt: new Date().toISOString(),
    baseline: "a516c468aade47e0f0a7d3367fffd676a5d54bb9",
    units: s.units.map((u) => ({
      unitId: u.id,
      audio: u.audio,
      wavHash: u.wavHash,
      inputHash: u.decodedFloat32Hash,
      rawSeconds: u.seconds,
      paddedSeconds: u.paddedSampleCount / 16000,
    })),
    arms: ["H", "B", "T"],
    identity,
    config: {
      device: "cpu",
      threads: 1,
      decoding: "greedy_search",
      blankPenalty: 0,
      sampleRate: 16000,
      featureDim: 80,
      paddingEachSeconds: 0.9,
      source:
        "unchanged from_transducer explicit args and same pinned defaults",
      language: "ja model; no language argument",
      newStreams: true,
      batching: false,
    },
    plannedPaddedSeconds: 123.57,
    limits: read("execution-ledger.json").hardLimits,
    stopConditions: [
      "six tasks complete",
      "budget reached",
      "native trace unavailable",
      "unreconciled failure",
    ],
    noGold: true,
    noQualityEvaluation: true,
    noSubtitleMutation: true,
  });
  console.log("EXPERIMENT_FROZEN_BEFORE_MODEL_LOAD");
  process.exit();
}
if (mode !== "execute") throw Error("USE_freeze_OR_execute");
const freeze = read("experiment-manifest.json");
if (JSON.stringify(freeze.identity) !== JSON.stringify(identity))
  throw Error("FROZEN_IDENTITY_CHANGED");
const lock = fs.openSync(path.join(root, "execution.lock"), "wx");
fs.closeSync(lock);
let ledger = read("execution-ledger.json");
if (ledger.starts.length || ledger.attempts.length)
  throw Error("EXPLICIT_FAILURE_RECONCILIATION_REQUIRED_NO_AUTOMATIC_RERUN");
const persist = () => {
  const tmp = path.join(root, "ledger.next.json");
  fs.writeFileSync(tmp, JSON.stringify(ledger, null, 2));
  fs.renameSync(tmp, path.join(root, "execution-ledger.json"));
};
const q = JSON.stringify;
const allowed = [
  path.dirname(path.dirname(s.runtime.reazonPython)),
  path.join(repo, "scripts/runtime"),
  path.join(s.old, "audio"),
  path.dirname(path.dirname(s.runtime.reazonModel)),
];
const policy =
  "(version 1)(allow default)(deny network*)(deny file-read* (subpath " +
  q(os.homedir()) +
  "))(allow file-read-metadata)" +
  allowed.map((p) => "(allow file-read* (subpath " + q(p) + "))").join("") +
  "(deny file-write*)(allow file-write* (subpath " +
  q(root) +
  ') (literal "/dev/null"))';
write("runtime-sandbox.local-only.json", {
  policy,
  network: false,
  referenceContentAllowed: false,
});
for (const arm of freeze.arms) {
  if (ledger.starts.length >= 5) throw Error("LOAD_START_CEILING");
  const armDir = path.join(
    root,
    { H: "historical-reproduction", B: "build-trace-off", T: "build-trace-on" }[
      arm
    ],
  );
  fs.mkdirSync(armDir);
  const traceDir = path.join(root, "native-traces");
  fs.mkdirSync(traceDir, { recursive: true });
  const env = {
    PATH: "/usr/bin:/bin",
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONNOUSERSITE: "1",
    HF_HUB_OFFLINE: "1",
    TRANSFORMERS_OFFLINE: "1",
    DYLD_PRINT_LIBRARIES: "1",
  };
  let args = [
    path.join(repo, "scripts/runtime/c60118_reazon_worker.py"),
    "--model-directory",
    s.runtime.reazonModel,
  ];
  if (arm !== "H") {
    env.PYTHONPATH = b.controlled;
    env.DYLD_LIBRARY_PATH = path.dirname(b.module);
    args = [
      path.join(repo, "scripts/runtime/c601182_trace_worker.py"),
      "--model-directory",
      s.runtime.reazonModel,
      "--native-sha256",
      b.moduleHash,
      "--experiment-id",
      path.basename(root),
      "--arm",
      arm,
      "--trace-directory",
      traceDir,
    ];
  }
  const start = {
    arm,
    startedAt: new Date().toISOString(),
    providerStartAttempt: 1,
    modelLoadAttempted: false,
    modelLoaded: false,
  };
  ledger.starts.push(start);
  persist();
  const stdout = fs.openSync(path.join(armDir, "stdout.jsonl"), "wx"),
    stderr = fs.openSync(path.join(armDir, "stderr.log"), "wx");
  const child = spawn(
    "/usr/bin/sandbox-exec",
    ["-p", policy, b.python, ...args],
    {
      cwd: path.join(repo, "scripts/runtime"),
      env,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let queue = [],
    waiter,
    ended = false;
  const done = new Promise((resolve) =>
    child.on("close", (code) => {
      ended = true;
      start.exitCode = code;
      persist();
      if (waiter) waiter.reject(Error("WORKER_CLOSED"));
      resolve(code);
    }),
  );
  createInterface({ input: child.stdout }).on("line", (line) => {
    fs.writeSync(stdout, line + "\n");
    try {
      const value = JSON.parse(line);
      if (waiter) {
        const w = waiter;
        waiter = undefined;
        w.resolve(value);
      } else queue.push(value);
    } catch (error) {
      if (waiter) waiter.reject(error);
    }
  });
  child.stderr.on("data", (data) => fs.writeSync(stderr, data));
  child.on("error", (error) => {
    if (waiter) waiter.reject(error);
  });
  const next = () =>
    queue.length
      ? Promise.resolve(queue.shift())
      : ended
        ? Promise.reject(Error("WORKER_CLOSED"))
        : new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
              waiter = undefined;
              reject(Error("WORKER_TIMEOUT"));
            }, 180000);
            waiter = {
              resolve: (v) => {
                clearTimeout(timer);
                resolve(v);
              },
              reject: (e) => {
                clearTimeout(timer);
                reject(e);
              },
            };
          });
  try {
    for (;;) {
      const event = await next();
      if (event.type === "load-start") {
        start.modelLoadAttempted = true;
        persist();
      }
      if (event.type === "native-identity") {
        if (event.sha256 !== b.moduleHash || event.module !== b.module)
          throw Error("LOADED_MODULE_WRONG");
      }
      if (event.type === "ready") {
        start.modelLoaded = true;
        persist();
        break;
      }
    }
    for (const unit of s.units) {
      const row = reserveTraceTask(
        ledger.attempts,
        { arm, unitId: unit.id, seconds: unit.paddedSampleCount / 16000 },
        ledger.starts.length,
      );
      row.reservedAt = new Date().toISOString();
      ledger.attempts.push(row);
      ledger.reservedPaddedSeconds += row.seconds;
      persist();
      const request = {
        type: "transcribe",
        requestId: unit.id,
        audioPath: path.join(s.old, unit.audio),
        maximumPaddedSeconds: 32,
      };
      write(
        path.relative(root, path.join(armDir, unit.id + ".request.json")),
        request,
      );
      child.stdin.write(JSON.stringify(request) + "\n");
      for (;;) {
        const e = await next();
        if (e.requestId !== unit.id) throw Error("RESPONSE_REQUEST_CROSSED");
        if (e.type === "accept-start") {
          row.acceptEntered = true;
          persist();
        }
        if (e.type === "forward-start") {
          row.acceptReturned = true;
          row.forwardAttempted = true;
          if (e.decodedFloat32Hash !== unit.decodedFloat32Hash)
            throw Error("FORWARD_INPUT_HASH");
          persist();
        }
        if (e.type === "result") {
          write(
            path.relative(root, path.join(armDir, unit.id + ".response.json")),
            e,
          );
          row.status = e.status;
          row.completedAt = new Date().toISOString();
          persist();
          if (e.status === "EXECUTION_FAILED")
            throw Error("FORMAL_EXECUTION_FAILED_NO_AUTORETRY");
          fs.writeFileSync(path.join(armDir, unit.id + ".txt"), e.result.text, {
            flag: "wx",
          });
          break;
        }
      }
    }
    child.stdin.end(JSON.stringify({ type: "shutdown" }) + "\n");
    const code = await done;
    if (code !== 0) throw Error("POST_RESULT_WORKER_EXIT");
  } catch (error) {
    start.error = String(error);
    persist();
    child.kill("SIGTERM");
    await done;
    throw error;
  } finally {
    fs.closeSync(stdout);
    fs.closeSync(stderr);
  }
}
write("result-freeze.json", {
  createdAt: new Date().toISOString(),
  manifestHash: sha(path.join(root, "experiment-manifest.json")),
  ledgerHash: sha(path.join(root, "execution-ledger.json")),
  artifacts: [
    "historical-reproduction",
    "build-trace-off",
    "build-trace-on",
    "native-traces",
  ]
    .flatMap((d) => runtimeFiles(path.join(root, d)))
    .map((file) => ({ file: path.relative(root, file), sha256: sha(file) })),
  newWhisper: 0,
  newCTC: 0,
  newVAD: 0,
  newSpeaker: 0,
  newOtherModels: 0,
});
console.log("FORMAL_SIX_TASKS_COMPLETED_NO_AUTOMATIC_FOLLOWUP");
