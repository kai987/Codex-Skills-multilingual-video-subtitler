import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  summarizeVad,
  compareVadLabels,
  prepareListeningVad,
  runListeningVad,
  verifyListeningVad,
} from "../scripts/subtitle-tool-listening-vad.mjs";
import { slicePcm } from "../scripts/lib/bounded-asr-ab.mjs";
import {
  replayVadTriage,
  verifyVadTriage,
} from "../scripts/subtitle-tool-vad-triage.mjs";
const item = {
  id: "clip-1",
  cohort: "ranked",
  frames: 32000,
  start: 100,
  localTargetStart: 0.75,
  localTargetEnd: 1.25,
};
const raw = (intervals = []) => ({
  rawUnit: "CENTISECONDS",
  sampleRate: 16000,
  inputFrames: 32000,
  rawIntervals: intervals,
  modelLoadCount: 1,
  inferencePasses: 1,
  device: "cpu",
  stateIsolation: "WHISPER_VAD_DETECT_SPEECH_RESETS_LSTM",
  probabilities: [0.1, 0.8],
});
test("centiseconds map once and only target overlap contributes to support", () => {
  const r = summarizeVad(item, raw([{ start: 75, end: 125 }]));
  assert.equal(r.targetCoverageFraction, 1);
  assert.equal(r.targetSupported, true);
  assert.deepEqual(r.sourceIntervals, [{ start: 100.75, end: 101.25 }]);
  const context = summarizeVad(item, raw([{ start: 130, end: 175 }]));
  assert.equal(context.clipHasDetection, true);
  assert.equal(context.targetSupported, false);
  assert.equal(context.targetCoverageFraction, 0);
});
test("empty VAD is unsupported, not no speech; weak overlap cannot be called supported", () => {
  assert.match(summarizeVad(item, raw()).negativeMeaning, /not-confirmed/u);
  const r = summarizeVad(item, raw([{ start: 100, end: 110 }]));
  assert.equal(r.anyTargetOverlap, true);
  assert.equal(r.targetSupported, false);
});
test("endpoint tolerance preserves explicit delta and excessive/overlapping intervals fail", () => {
  const r = summarizeVad(item, raw([{ start: 175, end: 202 }]));
  assert.equal(r.endpointAdjustments.length, 1);
  assert.equal(r.intervals[0].end, 2);
  for (const intervals of [
    [{ start: -1, end: 10 }],
    [{ start: 100, end: 220 }],
    [
      { start: 50, end: 100 },
      { start: 90, end: 120 },
    ],
    [{ start: 100, end: 100 }],
  ])
    assert.throws(() => summarizeVad(item, raw(intervals)));
});
test("wrong units, frames, malformed probabilities or missing state isolation fail closed", () => {
  for (const override of [
    { rawUnit: "SECONDS" },
    { inputFrames: 1 },
    { probabilities: [NaN] },
    { probabilities: [] },
    { inferencePasses: 2 },
    { stateIsolation: null },
  ])
    assert.throws(() => summarizeVad(item, { ...raw(), ...override }));
});
test("confusion metrics distinguish pending from negative and retain per-cohort denominators", () => {
  const observations = [true, false, true, false, true].map(
    (targetSupported, i) => ({
      id: String(i),
      targetSupported,
      cohort: i < 2 ? "ranked" : "reserve",
    }),
  );
  const labels = ["speech", "speech", "noise", "effect", "pending"].map(
    (sound, i) => ({ id: String(i), sound, relation: "uncertain" }),
  );
  const r = compareVadLabels(observations, labels);
  assert.deepEqual(r.summary.all, {
    TP: 1,
    FP: 1,
    TN: 1,
    FN: 1,
    unscored: 1,
    precision: 0.5,
    recall: 0.5,
  });
  assert.equal(r.summary.ranked.recall, 0.5);
  assert.equal(r.summary.reserve.recall, null);
  assert.throws(
    () => compareVadLabels(observations, [...labels.slice(0, 4), labels[0]]),
    /DUPLICATE/u,
  );
});
const hash = (b) => createHash("sha256").update(b).digest("hex");
async function fixture(t) {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "listening-vad-test-")),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const listening = path.join(root, "listening");
  await fs.mkdir(listening);
  await fs.mkdir(path.join(listening, "audio"));
  const wav = slicePcm(
    { data: Buffer.alloc(64000), frames: 32000, sampleRate: 16000 },
    0,
    32000,
  );
  const manifest = {
    items: [
      {
        id: "clip-1",
        cohort: "ranked",
        audio: "audio/clip-1.wav",
        audioHash: hash(wav),
        start: 100,
        end: 102,
        targetStart: 100.75,
        targetEnd: 101.25,
        firstFrame: 1600000,
        endFrame: 1632000,
      },
    ],
  };
  const files = {
    "listening-manifest.json": JSON.stringify(manifest),
    "labels.blank.json": "{}",
    "index.html": "test",
    "app.js": "",
    "audio/clip-1.wav": wav,
  };
  for (const [n, b] of Object.entries(files))
    await fs.writeFile(path.join(listening, n), b);
  await fs.writeFile(
    path.join(listening, "listening-freeze.json"),
    JSON.stringify({
      version: "audio-listening-freeze-v1",
      files: Object.fromEntries(
        Object.entries(files).map(([n, b]) => [n, hash(b)]),
      ),
    }),
  );
  const dummy = path.join(root, "dummy-runtime");
  await fs.writeFile(dummy, "test-only-never-executed");
  const prepared = await prepareListeningVad(
    listening,
    { python: dummy, vadModel: dummy, vadLibrary: dummy },
    path.join(root, "outputs"),
  );
  return { ...prepared, listening, dummy };
}
function mockRunner() {
  return {
    calls: 0,
    async run(exe, args) {
      this.calls++;
      const req = JSON.parse(await fs.readFile(args.at(-1), "utf8"));
      await fs.writeFile(
        req.receiptPath,
        ["model-loaded", "inference-pass-reserved", "inference-pass-completed"]
          .map((phase) => JSON.stringify({ phase }))
          .join("\n") + "\n",
      );
      return {
        exitCode: 0,
        stdout: JSON.stringify(raw([{ start: 75, end: 125 }])),
        stderr: "",
      };
    },
  };
}
test("mock flow freezes raw evidence; verify never calls runtime; reservation blocks rerun", async (t) => {
  const f = await fixture(t),
    runner = mockRunner();
  await runListeningVad(f.root, { authorize: true, runner });
  assert.equal(runner.calls, 1);
  const v = await verifyListeningVad(f.root);
  assert.equal(v.observations[0].targetSupported, true);
  await assert.rejects(
    runListeningVad(f.root, { authorize: true, runner }),
    /EEXIST/u,
  );
  assert.equal(runner.calls, 1);
  await fs.appendFile(path.join(f.root, "clip-1/raw.json"), " ");
  await assert.rejects(verifyListeningVad(f.root), /OUTPUT_CHANGED/u);
});
test("unauthorized or changed inputs never dispatch a detector", async (t) => {
  const f = await fixture(t),
    runner = mockRunner();
  await assert.rejects(runListeningVad(f.root, { runner }), /AUTHORIZATION/u);
  await fs.appendFile(path.join(f.listening, "audio/clip-1.wav"), " ");
  await assert.rejects(
    runListeningVad(f.root, { authorize: true, runner }),
    /CHANGED/u,
  );
  assert.equal(runner.calls, 0);
});
test("failed runtime is recorded, not retried or frozen as a successful negative", async (t) => {
  const f = await fixture(t);
  let calls = 0;
  const runner = {
    async run() {
      calls++;
      return { exitCode: 1, stdout: "", stderr: "failure" };
    },
  };
  await assert.rejects(
    runListeningVad(f.root, { authorize: true, runner }),
    /NO_RETRY/u,
  );
  const fail = JSON.parse(await fs.readFile(path.join(f.root, "failure.json")));
  assert.equal(fail.completed, 0);
  await assert.rejects(
    fs.stat(path.join(f.root, "machine-freeze.json")),
    /ENOENT/u,
  );
  await assert.rejects(
    runListeningVad(f.root, { authorize: true, runner }),
    /EEXIST/u,
  );
  assert.equal(calls, 1);
});

test("triage replay is collision-safe, offline and preserves source evidence", async (t) => {
  const f = await fixture(t),
    runner = mockRunner();
  await runListeningVad(f.root, { authorize: true, runner });
  const frozen = await fs.readFile(path.join(f.root, "machine-freeze.json"));
  const parent = path.join(path.dirname(f.root), "triage");
  const a = await replayVadTriage(f.root, parent);
  const b = await replayVadTriage(f.root, parent);
  assert.notEqual(a.root, b.root);
  assert.equal((await verifyVadTriage(a.root)).integrity, "passed");
  assert.equal((await verifyVadTriage(b.root)).retained, 1);
  assert.equal(runner.calls, 1);
  assert.deepEqual(
    await fs.readFile(path.join(f.root, "machine-freeze.json")),
    frozen,
  );
  await fs.appendFile(path.join(a.root, "triage.json"), " ");
  await assert.rejects(verifyVadTriage(a.root), /TRIAGE_CHANGED/u);
});

test("triage refuses writes into original evidence or listening directories", async (t) => {
  const f = await fixture(t),
    runner = mockRunner();
  await runListeningVad(f.root, { authorize: true, runner });
  for (const root of [
    f.root,
    path.join(f.root, "child"),
    f.listening,
    path.join(f.listening, "child"),
  ])
    await assert.rejects(replayVadTriage(f.root, root), /OUTPUT_INSIDE_INPUT/u);
  assert.equal(runner.calls, 1);
});

test("triage verification rejects changed raw evidence and rehashed fabricated rows", async (t) => {
  const f = await fixture(t),
    runner = mockRunner();
  await runListeningVad(f.root, { authorize: true, runner });
  const a = await replayVadTriage(
    f.root,
    path.join(path.dirname(f.root), "triage"),
  );
  const reportPath = path.join(a.root, "triage.json");
  const original = await fs.readFile(reportPath);
  const report = JSON.parse(original);
  report.rows[0].state = "unsupported";
  const changed = JSON.stringify(report);
  await fs.writeFile(reportPath, changed);
  const freezePath = path.join(a.root, "triage-freeze.json");
  const freeze = JSON.parse(await fs.readFile(freezePath));
  freeze.files["triage.json"] = hash(changed);
  await fs.writeFile(freezePath, JSON.stringify(freeze));
  await assert.rejects(verifyVadTriage(a.root), /TRIAGE_REPLAY_MISMATCH/u);
  await fs.writeFile(reportPath, original);
  freeze.files["triage.json"] = hash(original);
  await fs.writeFile(freezePath, JSON.stringify(freeze));
  await fs.appendFile(path.join(f.root, "clip-1/raw.json"), " ");
  await assert.rejects(verifyVadTriage(a.root), /OUTPUT_CHANGED/u);
  assert.equal(runner.calls, 1);
});
