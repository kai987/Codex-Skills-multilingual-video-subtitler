// Sole model coordinator: no reference parser or reference manifest is accessible to worker.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { setTimeout, clearTimeout } from "node:timers";
import { loadReazonK2ModelIdentity } from "../packages/video-subtitler/dist/machine-quality/reazonspeech-k2-provider.js";
import {
  sameUnitRequestSchema,
  reserveSameUnitAttempt,
  completeCandidate,
} from "../packages/video-subtitler/dist/machine-quality/same-unit-candidate.js";
import {
  read,
  write,
  hash,
  oh,
  repo,
  verify,
  childEnv,
} from "./c60117-common.mjs";
import { checkImplementation, pcmIdentity } from "./c60118-common.mjs";
const root = path.resolve(process.argv[2]);
verify(root, "input-freeze.json");
verify(root, "model-input-freeze.json");
checkImplementation(root);
if (fs.existsSync(path.join(root, "generation-freeze.json")))
  throw Error("FORMAL_GENERATION_ALREADY_FROZEN");
const plan = read(path.join(root, "request-plan.json")),
  runtime = read(path.join(root, "runtime.local-only.json")),
  planHash = oh(plan);
if (
  oh(await loadReazonK2ModelIdentity(runtime.reazonModel)) !== oh(plan.model) ||
  (await hash(fs.realpathSync(runtime.reazonPython))) !== plan.runtimePythonHash
)
  throw Error("MODEL_RUNTIME_DRIFT");
for (const f of plan.identityFiles)
  if ((await hash(f.path)) !== f.sha256) throw Error("RUNTIME_DRIFT");
for (const u of plan.units)
  for (const [k, v] of Object.entries(pcmIdentity(path.join(root, u.audio))))
    if (u[k] !== v) throw Error("AUDIO_DRIFT");
fs.mkdirSync(path.join(root, "attempts"), { recursive: true });
const completed = [],
  pending = [];
for (const u of plan.units) {
  const f = path.join(root, "evidence/reazon-same-unit", u.id + ".json");
  if (fs.existsSync(f)) {
    const r = read(f);
    if (r.planHash !== planHash || r.responseHash !== oh(r.response))
      throw Error("REPLAY_IDENTITY_MISMATCH");
    completeCandidate(r.response);
    completed.push({ id: u.id, execution: "VERIFIED_RESPONSE_REPLAY" });
  } else pending.push(u);
}
if (!pending.length) {
  console.log("VERIFIED_RESPONSE_REPLAY " + completed.length);
  process.exit(0);
}
const priorFiles = fs
  .readdirSync(path.join(root, "attempts"))
  .filter((f) => f.endsWith(".reserved.json"));
let prior = priorFiles.map((f) => read(path.join(root, "attempts", f)));
for (const r of prior)
  if (
    !fs.existsSync(path.join(root, "attempts", r.attemptId + ".response.json"))
  )
    throw Error("UNRECONCILED_ATTEMPT_DO_NOT_RETRY");
// Do not silently start a second model after a crashed startup.
const sessionId =
  "session-" +
  fs
    .readdirSync(path.join(root, "attempts"))
    .filter((f) => f.endsWith(".session.json")).length;
if (sessionId !== "session-0")
  throw Error("MODEL_RESTART_REQUIRES_EXPLICIT_FAILURE_RECONCILIATION");
const home = path.dirname(path.dirname(repo)),
  venv = path.dirname(path.dirname(runtime.reazonPython));
const quote = (x) => JSON.stringify(x);
const allowed = [
  venv,
  path.join(repo, "scripts/runtime"),
  path.join(root, "audio"),
  fs.realpathSync(runtime.reazonModel),
  path.dirname(path.dirname(runtime.reazonModel)),
];
const policy =
  "(version 1)(allow default)(deny network*)(deny file-read* (subpath " +
  quote(home) +
  "))(allow file-read-metadata)" +
  allowed.map((p) => "(allow file-read* (subpath " + quote(p) + "))").join("") +
  "(deny file-write* (subpath " +
  quote(home) +
  "))";
write(path.join(root, "model-sandbox.local-only.sb"), policy);
write(path.join(root, "attempts", sessionId + ".session.json"), {
  startedAt: new Date().toISOString(),
  planHash,
  providerStartAttempt: 1,
});
const child = spawn(
  "/usr/bin/sandbox-exec",
  [
    "-p",
    policy,
    runtime.reazonPython,
    path.join(repo, "scripts/runtime/c60118_reazon_worker.py"),
    "--model-directory",
    runtime.reazonModel,
  ],
  {
    env: childEnv,
    cwd: path.join(repo, "scripts/runtime"),
    stdio: ["pipe", "pipe", "pipe"],
  },
);
let queue = [],
  waiter = null,
  closed = null,
  rawLog = "",
  stderr = "";
createInterface({ input: child.stdout }).on("line", (line) => {
  rawLog += line + "\n";
  try {
    const m = JSON.parse(line);
    if (waiter) {
      const w = waiter;
      waiter = null;
      w.resolve(m);
    } else queue.push(m);
  } catch (e) {
    if (waiter) waiter.reject(e);
  }
});
child.stderr.on("data", (b) => {
  stderr += b.toString();
});
child.on("error", (e) => {
  closed = e;
  if (waiter) waiter.reject(e);
});
child.on("close", (code) => {
  closed = new Error("PROVIDER_EXIT " + code);
  if (waiter) waiter.reject(closed);
});
const next = () => {
  if (queue.length) return Promise.resolve(queue.shift());
  if (closed) return Promise.reject(closed);
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(Error("WORKER_TIMEOUT")), 180000);
    waiter = {
      resolve: (m) => {
        clearTimeout(t);
        resolve(m);
      },
      reject: (e) => {
        clearTimeout(t);
        reject(e);
      },
    };
  });
};
let loadAttempts = 0,
  loads = 0,
  forwards = 0,
  ready = null,
  failed = 0;
try {
  while (!ready) {
    const m = await next();
    if (m.type === "load-start") {
      loadAttempts++;
      write(path.join(root, "attempts", sessionId + ".load-start.json"), m);
    } else if (m.type === "ready") {
      ready = m;
      loads++;
      write(path.join(root, "attempts", sessionId + ".ready.json"), m);
    }
  }
  if (
    ready.python !== plan.runtime.python ||
    ready.sherpa !== plan.runtime.sherpa ||
    ready.numpy !== plan.runtime.numpy
  )
    throw Error("RUNTIME_METADATA_MISMATCH");
  for (const u of pending) {
    let again = true;
    while (again) {
      again = false;
      const history = prior.filter((p) => p.unitId === u.id),
        retry = history.length > 0;
      const failedBefore =
        retry &&
        read(
          path.join(
            root,
            "attempts",
            history.at(-1).attemptId + ".response.json",
          ),
        ).status === "EXECUTION_FAILED";
      const reservation = reserveSameUnitAttempt(
          prior,
          u.seconds,
          retry,
          failedBefore,
        ),
        attemptId = u.id + "-attempt-" + history.length;
      const r = {
        ...reservation,
        attemptId,
        unitId: u.id,
        planHash,
        startedAt: new Date().toISOString(),
      };
      write(path.join(root, "attempts", attemptId + ".reserved.json"), r);
      prior.push(r);
      const request = sameUnitRequestSchema.parse({
        type: "transcribe",
        requestId: u.id,
        audioPath: path.join(root, u.audio),
        maximumPaddedSeconds: 32,
      });
      write(path.join(root, "attempts", attemptId + ".request.json"), request);
      console.log("START " + attemptId);
      child.stdin.write(JSON.stringify(request) + "\n");
      let response = null;
      while (!response) {
        const m = await next();
        if (m.requestId !== u.id) throw Error("RESPONSE_REQUEST_MISMATCH");
        if (m.type === "forward-start") {
          forwards++;
          write(path.join(root, "attempts", attemptId + ".forward.json"), m);
          if (
            m.sampleCount !== u.sampleCount ||
            m.paddedSampleCount !== u.paddedSampleCount ||
            m.decodedFloat32Hash !== u.decodedFloat32Hash
          )
            throw Error("DECODED_INPUT_MISMATCH");
        } else if (m.type === "result") response = m;
        else throw Error("UNKNOWN_WORKER_EVENT");
      }
      write(
        path.join(root, "attempts", attemptId + ".response.json"),
        response,
      );
      completeCandidate(response);
      if (response.status === "EXECUTION_FAILED") {
        failed++;
        if (prior.filter((p) => p.retry).length < 2 && prior.length < 14) {
          again = true;
          console.log("EXECUTION_FAILURE_SAME_PARAMETER_RETRY " + u.id);
        }
      }
      if (!again)
        write(path.join(root, "evidence/reazon-same-unit", u.id + ".json"), {
          planHash,
          unitId: u.id,
          audioHash: u.audioHash,
          pcmHash: u.pcmHash,
          model: plan.model,
          execution: "FRESH",
          responseHash: oh(response),
          response,
        });
      console.log("DONE " + attemptId + " " + response.status);
    }
  }
} finally {
  child.stdin.end(JSON.stringify({ type: "shutdown" }) + "\n");
  if (!closed)
    await new Promise((resolve) => {
      const t = setTimeout(() => {
        child.kill();
        resolve();
      }, 5000);
      child.once("close", () => {
        clearTimeout(t);
        resolve();
      });
    });
  write(path.join(root, "attempts", sessionId + ".stdout.jsonl"), rawLog);
  write(path.join(root, "attempts", sessionId + ".stderr.txt"), stderr);
  write(path.join(root, "execution-ledger.json"), {
    planHash,
    logicalTasks: plan.units.length,
    actualRecognitionAttempts: prior.length,
    acousticForwards: forwards,
    modelLoadAttempts: loadAttempts,
    modelLoadSuccesses: loads,
    providerStarts: 1,
    verifiedResponseReplay: completed.length,
    cacheHits: 0,
    failures: failed,
    retries: prior.filter((p) => p.retry).length,
    rawSeconds: prior.reduce((n, p) => n + p.seconds, 0),
    paddingSeconds: prior.length * 1.8,
    decodedSeconds: prior.reduce((n, p) => n + p.seconds + 1.8, 0),
    finishedAt: new Date().toISOString(),
  });
}
