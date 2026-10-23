import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  planCorrection,
  correctionArgs,
  executionPolicy,
  tokenView,
  verifyBoundFiles,
  codeInventory,
  executeCorrection,
  assembleCorrection,
  verifyCorrection,
} from "../scripts/lib/correction-run.mjs";
import { correctionPolicy } from "../scripts/lib/correction-policy.mjs";
import { hash, identity } from "../scripts/lib/content-review-plan.mjs";
import { durable, slicePcm } from "../scripts/lib/bounded-asr-ab.mjs";
import { fileHash, inventory } from "../scripts/lib/local-asr-run.mjs";

const baseline = () => [
  {
    recordId: "before",
    sourceStart: 2,
    sourceEnd: 4,
    text: "明日は学校へ行きます",
    custom: { preserved: true },
  },
];
const target = (overrides = {}) => ({
  id: "target",
  start: 2,
  end: 4,
  baselineIds: ["before"],
  reason: "text-error",
  ...overrides,
});
const plan = (targets = [target()]) => ({
  version: "machine-correction-plan-v1",
  selection: "diagnostic-development-cases-not-blind",
  targets,
});
const missing = (id, start, end) =>
  target({ id, start, end, baselineIds: [], reason: "missing-dialogue" });

test("two bounded views use distinct context and source-relative sample positions", () => {
  const result = planCorrection(plan(), baseline(), 0, 20);
  assert.deepEqual(
    result.requests.map((r) => [r.requestStart, r.requestEnd]),
    [
      [1.5, 4.5],
      [1, 5],
    ],
  );
  assert.equal(result.samples, 7 * 16000);
  const shifted = planCorrection(
    plan([missing("shifted", 22, 24)]),
    [],
    20,
    40,
  );
  assert.equal(shifted.requests[0].startSample, 1.5 * 16000);
  assert.equal(shifted.requests[0].requestStart, 21.5);
  assert.equal(shifted.samples, result.samples);
});

test("eight requests and 120 seconds are hard inclusive planning limits", () => {
  const targets = [0, 1, 2, 3].map((i) =>
    missing(`t${i}`, 2 + i * 20, 15.5 + i * 20),
  );
  const result = planCorrection(plan(targets), [], 0, 100);
  assert.equal(result.requests.length, 8);
  assert.equal(result.samples, 120 * 16000);
  assert.throws(
    () =>
      planCorrection(
        plan(targets.map((t) => ({ ...t, end: t.end + 0.01 }))),
        [],
        0,
        100,
      ),
    /TOTAL_BUDGET/u,
  );
  assert.throws(() =>
    planCorrection(plan([...targets, missing("fifth", 82, 84)]), [], 0, 100),
  );
  assert.throws(
    () => planCorrection(plan([missing("long", 2, 31)]), [], 0, 100),
    /REQUEST_BUDGET/u,
  );
});

test("edge context clips only the request to the physical source", () => {
  const result = planCorrection(plan([missing("edge", 0, 1)]), [], 0, 2);
  assert.deepEqual(
    result.requests.map((r) => [r.startSample, r.endSample]),
    [
      [0, 24000],
      [0, 32000],
    ],
  );
  for (const bounds of [
    [-0.1, 1],
    [1, 3],
    [1, 1],
    [2, 1],
  ]) {
    assert.throws(() =>
      planCorrection(plan([missing("invalid", ...bounds)]), [], 0, 2),
    );
  }
});

test("planning rejects overlap, duplicate targets, and baseline reuse", () => {
  assert.throws(
    () =>
      planCorrection(plan([missing("a", 1, 3), missing("b", 2, 4)]), [], 0, 10),
    /OVERLAPPING_TARGETS/u,
  );
  assert.throws(
    () =>
      planCorrection(plan([missing("a", 1, 2), missing("a", 3, 4)]), [], 0, 10),
    /TARGET_BOUNDS_OR_DUPLICATE/u,
  );
  assert.throws(
    () =>
      planCorrection(
        plan([target({ baselineIds: ["before", "before"] })]),
        baseline(),
        0,
        10,
      ),
    /TARGET_BASELINE_BINDING/u,
  );
  assert.throws(
    () =>
      planCorrection(
        plan([target({ baselineIds: ["absent"] })]),
        baseline(),
        0,
        10,
      ),
    /TARGET_BASELINE_BINDING/u,
  );
  assert.throws(
    () =>
      planCorrection(plan([target({ start: 5, end: 6 })]), baseline(), 0, 10),
    /TARGET_BASELINE_BINDING/u,
  );
});

test("action type, finite timestamps, strict schema, and exact samples bind the plan", () => {
  for (const t of [
    target({ baselineIds: [] }),
    target({ reason: "missing-dialogue" }),
    target({ start: NaN }),
    target({ end: Infinity }),
    target({ referenceText: "not a generation input" }),
  ])
    assert.throws(() => planCorrection(plan([t]), baseline(), 0, 20));
  assert.throws(
    () => planCorrection(plan([missing("fraction", 2.000001, 3)]), [], 0, 20),
    /NONINTEGER_REQUEST_SAMPLE/u,
  );
});

test("runtime argv declares token timestamps and no prompt or VAD", () => {
  const args = correctionArgs(
    { language: "ja", threads: 4 },
    "/tmp/case dir",
    "/tmp/run dir",
  );
  for (const flag of [
    "--output-json-full",
    "--output-srt",
    "--split-on-word",
    "--suppress-nst",
  ])
    assert.ok(args.includes(flag));
  assert.equal(args[args.indexOf("--max-len") + 1], "64");
  assert.equal(
    args[args.indexOf("--model") + 1],
    "/tmp/run dir/runtime/model.bin",
  );
  assert.equal(args[args.indexOf("--file") + 1], "/tmp/case dir/input.wav");
  assert.equal(args[args.indexOf("--language") + 1], "ja");
  assert.ok(args.every((arg) => !/prompt|vad|translate/iu.test(arg)));
  assert.equal(executionPolicy.maxRetries, 0);
  assert.equal(executionPolicy.coreML, false);
});

const rawToken = (text, from, to, id = 200) => ({
  text,
  id,
  p: 0.9,
  offsets: { from, to },
});
const fullJson = (text, tokens, from = 0, to = 4000) => ({
  model: { vocab: 51866, multilingual: true },
  transcription: [{ text, offsets: { from, to }, tokens }],
});
const request = () => ({
  id: "request-01",
  targetId: "target",
  requestId: hash("request"),
  requestStart: 101,
  requestEnd: 105,
  audioHash: hash("audio"),
});
const view = (full, r = request()) =>
  tokenView(full, r, hash(JSON.stringify(full)), hash("plan"));

test("verified multilingual tokens retain controls and apply the request offset exactly once", () => {
  const result = view(
    fullJson("明日は", [
      rawToken("[_BEG_]", 0, 0, 50365),
      rawToken("明日", 500, 1200),
      rawToken("は", 1200, 1500),
      rawToken("[_TT_40]", 1500, 1500, 50405),
    ]),
  );
  assert.equal(result.segments[0].sourceTextComplete, true);
  assert.deepEqual(
    result.segments[0].tokens.map((t) => t.kind),
    ["CONTROL", "LEXICAL", "LEXICAL", "CONTROL"],
  );
  assert.deepEqual(
    result.segments[0].tokens.slice(1, 3).map((t) => [t.start, t.end]),
    [
      [101.5, 102.2],
      [102.2, 102.5],
    ],
  );
  assert.equal(result.segments[0].start, 101);
  assert.equal(result.segments[0].end, 105);
});

test("zero, reversed, absent, and out-of-request timing remain visible evidence", () => {
  const result = view(
    fullJson("零逆欠外", [
      rawToken("零", 500, 500),
      rawToken("逆", 2000, 1000),
      { text: "欠", id: 200 },
      rawToken("外", 3900, 4100),
    ]),
  );
  const tokens = result.segments[0].tokens;
  assert.equal(tokens.map((t) => t.text).join(""), "零逆欠外");
  assert.deepEqual(
    tokens.map((t) => t.timeStatus),
    ["ZERO_DURATION", "INVALID", "MISSING", "INTERVAL"],
  );
  assert.equal(tokens[0].start, tokens[0].end);
  assert.equal(tokens[1].start, null);
  assert.equal(tokens[2].end, null);
  assert.ok(tokens[3].flags.includes("OUTSIDE_PHYSICAL_WINDOW"));
});

test("unknown vocabulary and parent text mismatch cannot claim complete token text", () => {
  const full = fullJson("明日", [rawToken("明日", 500, 1000)]);
  full.model.vocab = 51865;
  const unknown = view(full).segments[0];
  assert.equal(unknown.sourceTextComplete, false);
  assert.equal(unknown.tokens[0].kind, "UNVERIFIED_CONTROL");
  assert.equal(
    view(fullJson("明後日", [rawToken("明日", 500, 1000)])).segments[0]
      .sourceTextComplete,
    false,
  );
});

test("invalid string parent offsets are not coerced into numeric evidence", () => {
  const full = fullJson("明日", [rawToken("明日", 500, 1000)]);
  full.transcription[0].offsets = { from: "0", to: "2000" };
  const segment = view(full).segments[0];
  assert.equal(segment.start, null);
  assert.equal(segment.end, null);
});

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "correction-run-stub-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const run = path.join(root, "run"),
    previous = path.join(root, "previous");
  await fs.mkdir(path.join(run, "runtime"), { recursive: true });
  await fs.mkdir(previous);
  const runtime = path.join(root, "stub-runtime"),
    model = path.join(run, "runtime/model.bin");
  await fs.writeFile(runtime, "not executable; injected stub only");
  await fs.writeFile(model, "not a model; injected stub only");
  await durable(path.join(previous, "source.json"), { synthetic: true }, true);
  const p = plan(),
    b = baseline(),
    bound = planCorrection(p, b, 0, 20),
    requests = [];
  for (const [i, r] of bound.requests.entries()) {
    const data = Buffer.alloc((r.endSample - r.startSample) * 2, i + 1);
    const wav = slicePcm(
      { sampleRate: 16000, frames: data.length / 2, data },
      0,
      data.length / 2,
    );
    const row = {
      ...r,
      id: `request-${i + 1}`,
      audioHash: hash(data),
      wavHash: hash(wav),
      sourceSegments: [],
    };
    row.requestId = identity({ ...row, plan: p, executionPolicy });
    const dir = path.join(run, "requests", row.id);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "input.wav"), wav);
    await durable(path.join(dir, "request.json"), row, true);
    requests.push(row);
  }
  const manifest = {
    version: "machine-correction-run-v1",
    previousRun: previous,
    priorFiles: [
      {
        path: "source.json",
        sha256: await fileHash(path.join(previous, "source.json")),
      },
    ],
    runtime,
    model,
    runtimeHash: await fileHash(runtime),
    modelHash: await fileHash(model),
    sourceStart: 0,
    sourceEnd: 20,
    language: "ja",
    threads: 4,
    planHash: identity(p),
    baselineHash: identity(b),
    executionPolicy,
    correctionPolicy,
    code: await codeInventory(),
    requests,
    budget: {
      requests: requests.length,
      samples: bound.samples,
      seconds: bound.samples / 16000,
      retries: 0,
    },
  };
  await durable(path.join(run, "manifest.json"), manifest, true);
  await durable(path.join(run, "plan.json"), p, true);
  await durable(path.join(run, "baseline-records.json"), b, true);
  const files = (await inventory(path.join(run, "requests"))).map((f) => ({
    ...f,
    path: "requests/" + f.path,
  }));
  for (const name of ["manifest.json", "plan.json", "baseline-records.json"])
    files.push({ path: name, sha256: await fileHash(path.join(run, name)) });
  await durable(path.join(run, "input-freeze.json"), { files }, true);
  return { root, run, previous, manifest };
}

test("stub E2E executes once, changes only independent candidate, and replays without dispatch", async (t) => {
  const { run, previous, manifest } = await fixture(t);
  const before = await fs.readFile(path.join(run, "baseline-records.json"));
  const prior = await fs.readFile(path.join(previous, "source.json"));
  let calls = 0;
  const runner = {
    async run(_bin, args, options) {
      calls++;
      const r = manifest.requests.find(
        (r) => path.basename(options.cwd) === r.id,
      );
      assert.ok(r);
      assert.deepEqual(args, correctionArgs(manifest, options.cwd, run));
      const full = fullJson(
        "明日は学校に行きます",
        [
          rawToken(
            "明日は学校に行きます",
            Math.round((2.2 - r.requestStart) * 1000),
            Math.round((3.8 - r.requestStart) * 1000),
          ),
        ],
        0,
        Math.round((r.requestEnd - r.requestStart) * 1000),
      );
      await durable(path.join(options.cwd, "raw.json"), full, true);
      await fs.writeFile(
        path.join(options.cwd, "raw.srt"),
        "1\n00:00:00,700 --> 00:00:02,300\n明日は学校に行きます\n",
      );
      return { exitCode: 0, signal: null };
    },
  };
  await assert.rejects(
    () => executeCorrection(run, { runner }),
    /AUTHORIZATION/u,
  );
  assert.equal(calls, 0);
  assert.deepEqual(await executeCorrection(run, { authorize: true, runner }), {
    dispatches: 2,
    checkpointHits: 0,
  });
  const result = await assembleCorrection(run);
  assert.equal(result.verified, true);
  assert.equal(result.changedTargets, 1);
  assert.equal(result.baselineFileMutations, 0);
  assert.equal(result.qualityStatus, "needs-review");
  assert.equal(result.humanValidated, false);
  assert.equal(result.fullTimedExportAllowed, false);
  assert.deepEqual(
    await fs.readFile(path.join(run, "baseline-records.json")),
    before,
  );
  assert.deepEqual(
    await fs.readFile(path.join(previous, "source.json")),
    prior,
  );
  const candidate = JSON.parse(
    await fs.readFile(path.join(run, "candidate-records.json"), "utf8"),
  );
  assert.equal(candidate[0].text, "明日は学校に行きます");
  assert.deepEqual(await executeCorrection(run, { authorize: true, runner }), {
    dispatches: 0,
    checkpointHits: 2,
  });
  assert.equal(calls, 2);
  assert.deepEqual(await assembleCorrection(run), result);
  assert.deepEqual(await verifyCorrection(run), result);
  await fs.appendFile(
    path.join(run, "candidate/subtitle.corrected.machine-candidate.ass"),
    "tampered",
  );
  await assert.rejects(() => verifyCorrection(run), /FROZEN_INPUT_CHANGED/u);
});

test("failed requests are retained without automatic retry and preserve baseline", async (t) => {
  const { run } = await fixture(t);
  let calls = 0;
  const runner = {
    async run() {
      calls++;
      return { exitCode: 1, error: "stub failure" };
    },
  };
  assert.deepEqual(await executeCorrection(run, { authorize: true, runner }), {
    dispatches: 2,
    checkpointHits: 0,
  });
  const result = await assembleCorrection(run);
  assert.equal(result.changedTargets, 0);
  assert.equal(result.completedRequests, 0);
  assert.deepEqual(await executeCorrection(run, { authorize: true, runner }), {
    dispatches: 0,
    checkpointHits: 2,
  });
  assert.equal(calls, 2);
});

test("reserved incomplete request never retries automatically", async (t) => {
  const { run, manifest } = await fixture(t);
  await durable(
    path.join(run, "requests", manifest.requests[0].id, "reserved.json"),
    { requestId: manifest.requests[0].requestId },
    true,
  );
  const runner = {
    async run() {
      assert.fail("no dispatch after reservation");
    },
  };
  await assert.rejects(
    () => executeCorrection(run, { authorize: true, runner }),
    /INCOMPLETE_RESERVED_REQUEST_NO_AUTOMATIC_RETRY/u,
  );
});

test("cancellation preserves the current receipt but never reserves the next request", async (t) => {
  const { run, manifest } = await fixture(t);
  const controller = new globalThis.AbortController();
  let calls = 0;
  const runner = {
    signal: controller.signal,
    async run() {
      calls++;
      controller.abort();
      return { exitCode: null, signal: "SIGTERM" };
    },
  };
  await assert.rejects(
    () => executeCorrection(run, { authorize: true, runner }),
    { name: "AbortError" },
  );
  assert.equal(calls, 1);
  const first = JSON.parse(
    await fs.readFile(
      path.join(run, "requests", manifest.requests[0].id, "receipt.json"),
      "utf8",
    ),
  );
  assert.equal(first.requestId, manifest.requests[0].requestId);
  assert.equal(first.status, "failed");
  for (const rel of [
    `requests/${manifest.requests[1].id}/reserved.json`,
    `requests/${manifest.requests[1].id}/receipt.json`,
    "raw-freeze.json",
    ".execution-lock",
  ])
    await assert.rejects(() => fs.stat(path.join(run, rel)), {
      code: "ENOENT",
    });
});

async function refreezeInputs(run) {
  const file = path.join(run, "input-freeze.json");
  const freeze = JSON.parse(await fs.readFile(file, "utf8"));
  for (const row of freeze.files)
    row.sha256 = await fileHash(path.join(run, row.path));
  await durable(file, freeze);
}

test("consistent file hashes cannot hide a request that differs from the frozen plan", async (t) => {
  const { run, manifest } = await fixture(t);
  manifest.requests[0].requestStart += 0.25;
  await durable(path.join(run, "manifest.json"), manifest);
  await durable(
    path.join(run, "requests", manifest.requests[0].id, "request.json"),
    manifest.requests[0],
  );
  await refreezeInputs(run);
  await assert.rejects(
    () => executeCorrection(run, { authorize: true }),
    /REQUEST_BINDING/u,
  );
});

test("frozen baseline identity mismatch is rejected before any reservation", async (t) => {
  const { run, manifest } = await fixture(t);
  manifest.baselineHash = hash("different baseline");
  await durable(path.join(run, "manifest.json"), manifest);
  await refreezeInputs(run);
  await assert.rejects(
    () => executeCorrection(run, { authorize: true }),
    /MANIFEST_BINDING/u,
  );
  await assert.rejects(
    () =>
      fs.stat(
        path.join(run, "requests", manifest.requests[0].id, "reserved.json"),
      ),
    { code: "ENOENT" },
  );
});

test("runtime or model identity drift rejects execution without reservation", async (t) => {
  const { run, manifest } = await fixture(t);
  await fs.appendFile(manifest.model, "changed");
  await assert.rejects(
    () => executeCorrection(run, { authorize: true }),
    /RUNTIME_MODEL_CHANGED/u,
  );
  await assert.rejects(
    () =>
      fs.stat(
        path.join(run, "requests", manifest.requests[0].id, "reserved.json"),
      ),
    { code: "ENOENT" },
  );
});

test("freeze validation rejects changed evidence, unsafe paths, duplicates, and symlinks", async (t) => {
  const { run, manifest, root } = await fixture(t);
  const name = "baseline-records.json",
    sha256 = await fileHash(path.join(run, name));
  await verifyBoundFiles(run, [{ path: name, sha256 }]);
  for (const badPath of ["../outside", "/absolute", "a/../b", "a//b", "./x"])
    await assert.rejects(
      () => verifyBoundFiles(run, [{ path: badPath, sha256 }]),
      /UNSAFE_FREEZE_PATH/u,
    );
  await assert.rejects(
    () =>
      verifyBoundFiles(run, [
        { path: name, sha256 },
        { path: name, sha256 },
      ]),
    /UNSAFE_FREEZE_PATH/u,
  );
  await fs.symlink(root, path.join(run, "alias"));
  await assert.rejects(
    () => verifyBoundFiles(run, [{ path: "alias/file", sha256 }]),
    /FREEZE_SYMLINK/u,
  );
  await fs.appendFile(
    path.join(run, "requests", manifest.requests[0].id, "input.wav"),
    "changed",
  );
  await assert.rejects(
    () =>
      executeCorrection(run, {
        authorize: true,
        runner: {
          async run() {
            assert.fail("tampered input cannot dispatch");
          },
        },
      }),
    /FROZEN_INPUT_CHANGED/u,
  );
});
