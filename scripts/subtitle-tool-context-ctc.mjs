import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { safePath } from "../packages/video-subtitler/dist/standalone/recovery.js";
import {
  EvidenceRunner,
  readPcm,
  slicePcm,
  durable,
} from "./lib/bounded-asr-ab.mjs";
import { verifyRecovery } from "./subtitle-tool-vad-local-recovery.mjs";
import {
  planContextContrast,
  inspectContextAlignment,
  contextCtcPolicy,
} from "./lib/context-ctc-contrast.mjs";
const json = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const put = (p, v) => durable(p, v, true);
const bridge = path.join(
  import.meta.dirname,
  "runtime/context_ctc_contrast.py",
);
const bind = async (file) => ({
  file: await fs.realpath(file),
  sha256: await fileHash(file),
});

export async function prepareContextCtc(source, priorRuntime, output, ids) {
  await safePath(source);
  await verifyRecovery(source);
  source = await fs.realpath(source);
  output = path.resolve(output);
  await safePath(output, true);
  assert(
    output !== source && !output.startsWith(source + path.sep),
    "OUTPUT_INSIDE_SOURCE",
  );
  const parent = await json(path.join(source, "plan.json")),
    views = await json(path.join(source, "views.json"));
  const requests = planContextContrast(parent, views, ids);
  // Runtime/model identity must match an existing local experiment, not just a new path hash.
  const old = await json(path.join(priorRuntime, "plan.json"));
  assert.equal(
    await fileHash(path.join(priorRuntime, "plan.json")),
    (await json(path.join(priorRuntime, "plan-freeze.json"))).planHash,
  );
  for (const b of old.bindings)
    assert.equal(
      await fileHash(b.file),
      b.sha256,
      `HISTORICAL_BINDING:${b.file}`,
    );
  const audio = path.join(parent.spec.task, "audio.wav"),
    pcm = readPcm(await fs.readFile(audio));
  const files = [
    path.join(source, "plan.json"),
    path.join(source, "views.json"),
    path.join(source, "machine-freeze.json"),
    parent.spec.subtitle,
    audio,
    path.join(priorRuntime, "plan.json"),
    path.join(priorRuntime, "plan-freeze.json"),
    old.ctc.python,
    import.meta.filename,
    bridge,
    path.join(import.meta.dirname, "lib/context-ctc-contrast.mjs"),
    path.join(import.meta.dirname, "runtime/ctc_worker.py"),
  ];
  for (const n of await fs.readdir(old.ctc.model))
    files.push(path.join(old.ctc.model, n));
  const bindings = await Promise.all(files.map(bind));
  await fs.mkdir(output, { recursive: true });
  const root = await fs.mkdtemp(path.join(output, "context-ctc-"));
  for (const q of requests) {
    const original = path.join(source, q.targetId, "input.wav");
    assert.equal(await fileHash(original), q.wavHash);
    const bytes = await fs.readFile(original);
    assert.deepEqual(
      bytes,
      slicePcm(
        pcm,
        Math.round(q.start * 16000),
        Math.round(q.start * 16000) + q.frames,
      ),
      "PCM_BINDING",
    );
    await fs.mkdir(path.join(root, q.id));
    await fs.writeFile(path.join(root, q.id, "input.wav"), bytes, {
      flag: "wx",
    });
  }
  await put(path.join(root, "plan.json"), {
    source,
    ctc: old.ctc,
    requests,
    bindings,
    policy: contextCtcPolicy,
    referenceUsed: false,
    labelsUsed: false,
  });
  await put(path.join(root, "plan-freeze.json"), {
    planHash: await fileHash(path.join(root, "plan.json")),
  });
  return {
    root,
    requests: requests.length,
    seconds: requests.reduce((n, q) => n + q.frames / 16000, 0),
  };
}
async function load(root, savedEvidenceOnly = false) {
  await safePath(root);
  assert.equal(
    await fileHash(path.join(root, "plan.json")),
    (await json(path.join(root, "plan-freeze.json"))).planHash,
    "PLAN_CHANGED",
  );
  const p = await json(path.join(root, "plan.json"));
  for (const b of p.bindings) {
    if ((await fileHash(b.file)) === b.sha256) continue;
    const allowed = [
      import.meta.filename,
      path.join(import.meta.dirname, "lib/context-ctc-contrast.mjs"),
    ];
    assert(
      savedEvidenceOnly && allowed.includes(b.file),
      `INPUT_CHANGED:${b.file}`,
    );
    const snap = (
      await json(path.join(root, "execution-source-snapshot.json"))
    ).files.find((s) => s.file === b.file && s.sha256 === b.sha256);
    assert(
      snap && snap.snapshot === `execution-source/${path.basename(b.file)}`,
      "EXECUTION_SOURCE_SNAPSHOT_REQUIRED",
    );
    await safePath(path.join(root, snap.snapshot));
    assert.equal(
      await fileHash(path.join(root, snap.snapshot)),
      b.sha256,
      "SNAPSHOT_CHANGED",
    );
  }
  for (const q of p.requests)
    assert.equal(await fileHash(path.join(root, q.id, "input.wav")), q.wavHash);
  const parent = await json(path.join(p.source, "plan.json")),
    views = await json(path.join(p.source, "views.json"));
  assert.deepEqual(
    p.requests,
    planContextContrast(parent, views, [
      ...new Set(p.requests.map((q) => q.targetId)),
    ]),
  );
  return p;
}
export async function runContextCtc(
  root,
  authorized,
  runner = new EvidenceRunner(),
) {
  assert.equal(authorized, true, "AUTHORIZE_LOCAL_REQUIRED");
  const p = await load(root);
  await put(path.join(root, "execution-reservation.json"), {
    planHash: await fileHash(path.join(root, "plan.json")),
    requests: p.requests.length,
    retries: 0,
  });
  const r = await runner.run(p.ctc.python, [bridge, root], {
    cwd: root,
    timeoutMs: 300000,
  });
  // Persist exit before post-processing. EvidenceRunner already streams logs.
  await put(path.join(root, "exit.json"), {
    exitCode: r.exitCode,
    signal: r.signal ?? null,
  });
  await preserveRunnerLogs(root, r);
  assert.equal(r.exitCode, 0, "CTC_FAILED_NO_RETRY");
  return finishContextCtc(root);
}
export async function preserveRunnerLogs(root, r) {
  for (const [name, value] of [
    ["stdout.log", r.stdout ?? ""],
    ["stderr.log", r.stderr ?? ""],
  ]) {
    const file = path.join(root, name);
    try {
      await fs.writeFile(file, value, { flag: "wx" });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      assert.equal(
        await fs.readFile(file, "utf8"),
        value,
        "RUNNER_LOG_MISMATCH",
      );
    }
  }
}
async function replay(root, p) {
  const rows = [];
  for (const q of p.requests)
    rows.push(
      inspectContextAlignment(q, await json(path.join(root, q.id, "raw.json"))),
    );
  const ready = await json(path.join(root, "ready.json"));
  assert.equal(ready.modelLoadCount, 1);
  assert.equal(ready.deviceUsed, "cpu");
  return {
    rows,
    runtime: ready,
    requests: p.requests.length,
    requestSeconds: p.requests.reduce((n, q) => n + q.frames / 16000, 0),
    newAsrRequests: 0,
    textMutations: 0,
    timingMutations: 0,
    qualityStatus: "needs-review",
    finalizationMethod: "none",
    referenceUsed: false,
  };
}
export async function finishContextCtc(root, recoverSaved = false) {
  const p = await load(root, recoverSaved),
    result = await replay(root, p);
  const extra = [];
  if (recoverSaved) {
    assert.equal(
      await fs.access(path.join(root, "exit.json")).then(
        () => true,
        () => false,
      ),
      false,
      "USE_NORMAL_FINISH_WITH_EXIT",
    );
    const events = (await fs.readFile(path.join(root, "stdout.log"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(events.length, p.requests.length + 1, "INCOMPLETE_WORKER_LOG");
    assert.deepEqual(events[0], result.runtime);
    for (const [i, q] of p.requests.entries()) {
      assert.deepEqual(
        events[i + 1],
        await json(path.join(root, q.id, "raw.json")),
      );
      const d = (await json(path.join(root, q.id, "dispatch.json"))).request;
      assert.equal(d.requestId, q.id);
      assert.equal(d.targetText, q.targetText);
      assert.equal(d.mediaGlobalStart, q.start);
    }
    await put(path.join(root, "recovery-receipt.json"), {
      reason:
        "Wrapper EEXIST after EvidenceRunner streamed logs; all per-request results persisted",
      processExitCode: null,
      completionEvidence:
        "ready plus every bound result, independently matched against stdout",
      newInference: 0,
      analysisBindings: await Promise.all(
        [
          import.meta.filename,
          path.join(import.meta.dirname, "lib/context-ctc-contrast.mjs"),
        ].map(bind),
      ),
    });
    extra.push(
      "recovery-receipt.json",
      "execution-source-snapshot.json",
      ...(
        await json(path.join(root, "execution-source-snapshot.json"))
      ).files.map((s) => s.snapshot),
    );
  } else {
    assert.equal((await json(path.join(root, "exit.json"))).exitCode, 0);
    extra.push("exit.json");
  }
  await put(path.join(root, "result.json"), result);
  const names = [
    "plan.json",
    "plan-freeze.json",
    "execution-reservation.json",
    "worker-reservation.json",
    ...extra,
    "ready.json",
    "result.json",
    "stdout.log",
    "stderr.log",
    ...p.requests.flatMap((q) =>
      ["input.wav", "dispatch.json", "raw.json"].map((n) => `${q.id}/${n}`),
    ),
  ];
  await put(path.join(root, "machine-freeze.json"), {
    files: Object.fromEntries(
      await Promise.all(
        names.map(async (n) => [n, await fileHash(path.join(root, n))]),
      ),
    ),
  });
  return { root, result };
}
export async function verifyContextCtc(root) {
  const recovered = await fs
    .access(path.join(root, "recovery-receipt.json"))
    .then(
      () => true,
      () => false,
    );
  const p = await load(root, recovered),
    f = await json(path.join(root, "machine-freeze.json"));
  for (const [n, h] of Object.entries(f.files)) {
    assert(!path.isAbsolute(n) && !n.split(/[\\/]/u).includes(".."));
    await safePath(path.join(root, n));
    assert.equal(await fileHash(path.join(root, n)), h);
  }
  if (recovered)
    for (const b of (await json(path.join(root, "recovery-receipt.json")))
      .analysisBindings)
      assert.equal(await fileHash(b.file), b.sha256, "ANALYSIS_SOURCE_CHANGED");
  assert.deepEqual(
    await json(path.join(root, "result.json")),
    await replay(root, p),
  );
  return {
    integrity: "passed",
    files: Object.keys(f.files).length,
    bindings: p.bindings.length,
    newInference: 0,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [cmd, a, b, c, ...ids] = process.argv.slice(2);
  const result =
    cmd === "prepare"
      ? await prepareContextCtc(a, b, c, ids)
      : cmd === "run"
        ? await runContextCtc(a, b === "--authorize-local")
        : cmd === "finish"
          ? await finishContextCtc(a, b === "--recover-saved-results")
          : cmd === "verify"
            ? await verifyContextCtc(a)
            : null;
  assert(result, "UNKNOWN_COMMAND");
  console.log(JSON.stringify(result, null, 2));
}
