import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  runLocalCheck,
  freezeLocalCheck,
  verifyLocalCheck,
} from "../scripts/subtitle-tool-local-acoustic-check.mjs";
import { planLocalChecks } from "../scripts/lib/local-acoustic-policy.mjs";
import { evaluateLocalCheck } from "../scripts/evaluate-local-acoustic-check.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = async (file) => JSON.parse(await fs.readFile(file, "utf8"));
const writeJson = (file, value) =>
  fs.writeFile(file, JSON.stringify(value, null, 2) + "\n");
function wav(frames) {
  const bytes = Buffer.alloc(44 + frames * 2);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24);
  bytes.writeUInt32LE(32000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(frames * 2, 40);
  return bytes;
}
const record = (id, start, end) => ({
  recordId: id,
  sourceStart: start,
  sourceEnd: end,
  text: "合成",
});
async function fixture(t, changeTargets) {
  const temporary = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "local-acoustic-test-")),
  );
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, "run");
  await fs.mkdir(root);
  const fakeFile = path.join(temporary, "external-identity.bin");
  await fs.writeFile(fakeFile, "fixture only; never execute");
  const fingerprint = {
    path: fakeFile,
    sha256: hash(await fs.readFile(fakeFile)),
  };
  let targets = [
    {
      id: "timing",
      kind: "timing",
      sourceEnd: 500,
      records: [record("t", 10, 12)],
    },
    {
      id: "seam-a",
      kind: "seam",
      sourceEnd: 500,
      records: [record("a1", 100, 102), record("a2", 101, 103)],
    },
    {
      id: "seam-b",
      kind: "seam",
      sourceEnd: 500,
      records: [record("b1", 200, 202), record("b2", 201, 203)],
    },
  ];
  if (changeTargets) targets = changeTargets(targets);
  const planning = planLocalChecks(targets);
  const requests = [];
  for (const r of planning.requests) {
    const dir = path.join(root, r.id);
    await fs.mkdir(dir);
    const bytes = wav(r.frames);
    await fs.writeFile(path.join(dir, "input.wav"), bytes);
    requests.push({
      ...r,
      wavHash: hash(bytes),
      audioFrameStart: Math.round(r.start * 16000),
      audioFrameEnd: Math.round(r.start * 16000) + r.frames,
    });
  }
  const plan = {
    version: "bounded-local-acoustic-check-v1",
    ...planning,
    requests,
    sourceFiles: [fingerprint],
    sourceHash: fingerprint.sha256,
    sourceAudioHash: fingerprint.sha256,
    sourceAudioOffset: 0,
    sourceTasks: [],
    model: fingerprint,
    runtime: { whisper: fingerprint, ctc: fingerprint },
    software: [fingerprint],
    ctc: { model: temporary, files: [fingerprint], device: "cpu" },
    threads: 1,
    language: "ja",
    prompt: null,
    vad: false,
    referenceUsedForGeneration: false,
    previouslyExposedDevelopmentCase: true,
    wholeEpisodeASR: false,
    automaticApplication: false,
  };
  const rewritePlan = async () => {
    await writeJson(path.join(root, "plan.json"), plan);
    await writeJson(path.join(root, "plan-freeze.json"), {
      planHash: hash(await fs.readFile(path.join(root, "plan.json"))),
    });
  };
  await rewritePlan();
  return { root, plan, rewritePlan, fakeFile };
}

function ctcRaw(request) {
  const pieces = Array.from(request.targetText);
  return {
    type: "result",
    requestId: request.id,
    pathStatus: "success",
    frameCountVerified: true,
    workerRequestVerified: true,
    predictedFrameCount: 100,
    expectedFrameCount: 100,
    target: {
      targetText: request.targetText,
      targetTextSha256: hash(request.targetText),
      tokenPieces: pieces,
      tokenIds: pieces.map((_, i) => i + 10),
      targetEncodable: true,
      unknownTokenCount: 0,
      specialTokenCount: 0,
      blockers: [],
    },
    tokenSpans: pieces.map((_, i) => ({
      targetIndex: i,
      tokenId: i + 10,
      startFrame: 10 + i * 2,
      endFrameExclusive: 11 + i * 2,
      startMediaGlobal: 10.4 + i * 0.5,
      endMediaGlobal: 10.9 + i * 0.5,
    })),
    selectedBoundary: { start: 10.4, end: 11.4 },
    startPinnedToWindowEdge: false,
    endPinnedToWindowEdge: false,
    blockers: [],
  };
}

function fakeRunner(root, plan, { exitCode = 0, invalidTiming = false } = {}) {
  const calls = [];
  return {
    calls,
    async run(executable, args, options) {
      calls.push({ executable, args, options });
      if (exitCode !== 0) return { exitCode, signal: null };
      if (args.includes("--output-srt")) {
        const output = args[args.indexOf("--output-file") + 1];
        const end = invalidTiming ? 1000 : 2000;
        const endClock = invalidTiming ? "00:00:01,000" : "00:00:02,000";
        await fs.writeFile(
          `${output}.srt`,
          `1\n00:00:01,000 --> ${endClock}\n合成文\n\n`,
        );
        await writeJson(`${output}.json`, {
          model: { multilingual: true, vocab: 51866 },
          params: { language: "ja", translate: false },
          result: { language: "ja" },
          transcription: [
            {
              offsets: { from: 1000, to: end },
              timestamps: { from: "00:00:01,000", to: endClock },
              text: "合成文",
              tokens: [],
            },
          ],
        });
      } else {
        for (const request of plan.requests.filter(
          (r) => r.backend === "ctc",
        )) {
          await writeJson(path.join(root, request.id, "reserved.json"), {
            request,
            reservedAt: 1,
          });
          await writeJson(
            path.join(root, request.id, "raw.json"),
            ctcRaw(request),
          );
        }
      }
      await fs.writeFile(
        path.join(options.cwd, "stdout.log"),
        "synthetic runner: no model executed\n",
      );
      await fs.writeFile(path.join(options.cwd, "stderr.log"), "");
      await writeJson(path.join(options.cwd, "exit.json"), {
        code: 0,
        signal: null,
      });
      return { exitCode: 0, signal: null };
    },
  };
}

test("one-shot fake run freezes four ASR plus two CTC results with bound source times and formats", async (t) => {
  const f = await fixture(t);
  const runner = fakeRunner(f.root, f.plan);
  const result = await runLocalCheck(f.root, { runner });
  assert.equal(
    runner.calls.length,
    5,
    "four independent CLI requests plus one two-request CTC worker",
  );
  assert.equal(result.newRequests, 6);
  assert.equal(result.outputs.length, 12);
  assert.equal(result.totalAudioSeconds, f.plan.totalSeconds);
  assert.equal(result.timing.status, "SUPPORTED_CONDITIONAL_TIMING");
  assert.equal(result.timing.subtitleMutationAuthorized, false);
  for (const call of runner.calls.filter((r) =>
    r.args.includes("--output-srt"),
  )) {
    assert.ok(call.args.includes("--output-json-full"));
    assert.equal(call.args.includes("--prompt"), false);
    assert.equal(call.args.includes("--vad"), false);
  }
  const observations = await json(
    path.join(f.root, "machine-observations.json"),
  );
  assert.equal(observations.newWhisperRequests, 4);
  assert.equal(observations.newCtcRequests, 2);
  assert.equal(observations.sourceTextMutations, 0);
  assert.equal(observations.sourceTimingMutations, 0);
  assert.equal(observations.finalizationMethod, "none");
  for (const request of f.plan.requests.filter(
    (r) => r.backend === "whisper",
  )) {
    const mapped = await json(
      path.join(f.root, request.id, "mapped-records.json"),
    );
    assert.equal(mapped.records[0].sourceStart, request.start + 1);
    assert.equal(mapped.records[0].sourceEnd, request.start + 2);
    assert.equal(mapped.records[0].text, "合成文");
  }
  const freeze = await json(path.join(f.root, "machine-freeze.json"));
  for (const file of freeze.files) {
    assert.equal(
      hash(await fs.readFile(path.join(f.root, file.path))),
      file.sha256,
    );
  }
  assert.equal(
    freeze.files.filter((r) => r.path.endsWith("/raw.json")).length,
    6,
  );
});

test("repeated freeze is byte-identical and cannot dispatch inference", async (t) => {
  const f = await fixture(t);
  const runner = fakeRunner(f.root, f.plan);
  await runLocalCheck(f.root, { runner });
  const names = ["machine-freeze.json", "machine-observations.json"];
  const before = await Promise.all(
    names.map((name) => fs.readFile(path.join(f.root, name), "utf8")),
  );
  await freezeLocalCheck(f.root);
  assert.deepEqual(
    await Promise.all(
      names.map((name) => fs.readFile(path.join(f.root, name), "utf8")),
    ),
    before,
  );
  assert.equal(runner.calls.length, 5);
  await assert.rejects(runLocalCheck(f.root, { runner }), /EEXIST|RESERV/u);
  assert.equal(runner.calls.length, 5);
});

test("failed first dispatch consumes reservation and never permits implicit retry", async (t) => {
  const f = await fixture(t);
  const runner = fakeRunner(f.root, f.plan, { exitCode: 9 });
  await assert.rejects(runLocalCheck(f.root, { runner }), /FAILED_NO_RETRY/u);
  assert.equal(runner.calls.length, 1);
  await assert.rejects(runLocalCheck(f.root, { runner }), /EEXIST|RESERV/u);
  assert.equal(runner.calls.length, 1);
  await assert.rejects(fs.access(path.join(f.root, "machine-freeze.json")));
});

test("plan hash and audio tampering fail before fake runner dispatch", async (t) => {
  const f = await fixture(t);
  const runner = fakeRunner(f.root, f.plan);
  await fs.appendFile(path.join(f.root, "plan.json"), " ");
  await assert.rejects(runLocalCheck(f.root, { runner }), /PLAN_CHANGED/u);
  await f.rewritePlan();
  await fs.appendFile(
    path.join(f.root, f.plan.requests[0].id, "input.wav"),
    "bad",
  );
  await assert.rejects(runLocalCheck(f.root, { runner }), /AUDIO_CHANGED/u);
  assert.equal(runner.calls.length, 0);
});

test("externally changed model/runtime identity fails before reservation", async (t) => {
  const f = await fixture(t);
  await fs.appendFile(f.fakeFile, " changed");
  const runner = fakeRunner(f.root, f.plan);
  await assert.rejects(
    runLocalCheck(f.root, { runner }),
    /FROZEN_IDENTITY_CHANGED/u,
  );
  assert.equal(runner.calls.length, 0);
  await assert.rejects(
    fs.access(path.join(f.root, "execution-reservation.json")),
  );
});

test("rehashed malformed request or dishonest aggregate budget is rejected", async (t) => {
  const f = await fixture(t);
  f.plan.requests[0].start += 1;
  await f.rewritePlan();
  await assert.rejects(verifyLocalCheck(f.root));
  f.plan.requests[0].start -= 1;
  f.plan.totalSeconds = 0;
  f.plan.totalFrames = 0;
  await f.rewritePlan();
  await assert.rejects(verifyLocalCheck(f.root));
});

test("local experiment refuses a rehashed target set without exactly one timing and two seams", async (t) => {
  const f = await fixture(t, (targets) => [targets[0]]);
  await assert.rejects(verifyLocalCheck(f.root));
});

test("CTC raw response request identity cannot be swapped across windows", async (t) => {
  const f = await fixture(t);
  await runLocalCheck(f.root, { runner: fakeRunner(f.root, f.plan) });
  const first = f.plan.requests[0];
  const raw = await json(path.join(f.root, first.id, "raw.json"));
  raw.requestId = "unrelated-request";
  await writeJson(path.join(f.root, first.id, "raw.json"), raw);
  await assert.rejects(freezeLocalCheck(f.root));
});

test("immutable delivery corruption is never overwritten during refreeze", async (t) => {
  const f = await fixture(t);
  const result = await runLocalCheck(f.root, {
    runner: fakeRunner(f.root, f.plan),
  });
  const file = path.join(f.root, result.outputs[0]);
  await fs.writeFile(file, "user change, must remain");
  await assert.rejects(freezeLocalCheck(f.root));
  assert.equal(await fs.readFile(file, "utf8"), "user change, must remain");
});

test("invalid raw timing remains auditable without fabricated timed exports", async (t) => {
  const f = await fixture(t);
  const result = await runLocalCheck(f.root, {
    runner: fakeRunner(f.root, f.plan, { invalidTiming: true }),
  });
  assert.equal(result.outputs.length, 0);
  for (const request of f.plan.requests.filter(
    (r) => r.backend === "whisper",
  )) {
    const mapped = await json(
      path.join(f.root, request.id, "mapped-records.json"),
    );
    assert.equal(mapped.records[0].sourceStart, mapped.records[0].sourceEnd);
    assert.equal(mapped.records[0].text, "合成文");
    assert.ok(mapped.records[0].issues.length > 0);
    await assert.rejects(
      fs.access(path.join(f.root, request.id, "local-candidate.srt")),
    );
  }
  assert.equal(result.qualityStatus, "needs-review");
});

test("mismatched JSON/SRT evidence cannot be frozen as one candidate", async (t) => {
  const f = await fixture(t);
  const runner = fakeRunner(f.root, f.plan);
  const original = runner.run.bind(runner);
  runner.run = async (...args) => {
    const result = await original(...args);
    if (args[1].includes("--output-srt")) {
      const output = args[1][args[1].indexOf("--output-file") + 1];
      const raw = await json(`${output}.json`);
      raw.transcription[0].text = "別の文章";
      await writeJson(`${output}.json`, raw);
    }
    return result;
  };
  await assert.rejects(runLocalCheck(f.root, { runner }));
  await assert.rejects(fs.access(path.join(f.root, "machine-freeze.json")));
});

test("freeze refuses missing or forged execution reservation and missing success receipts", async (t) => {
  const f = await fixture(t);
  await assert.rejects(freezeLocalCheck(f.root));
  await runLocalCheck(f.root, { runner: fakeRunner(f.root, f.plan) });
  await writeJson(path.join(f.root, "execution-reservation.json"), {
    requests: [],
    maxRequests: 999,
    maxSeconds: 9999,
    retries: 99,
  });
  await assert.rejects(freezeLocalCheck(f.root));
  await writeJson(path.join(f.root, "execution-reservation.json"), {
    requests: f.plan.requests.map((r) => r.id),
    maxRequests: 6,
    maxSeconds: 120,
    retries: 0,
  });
  const firstAsr = f.plan.requests.find((r) => r.backend === "whisper");
  await fs.rm(path.join(f.root, firstAsr.id, "receipt.json"));
  await assert.rejects(freezeLocalCheck(f.root));
});

test("evaluation rejects damaged frozen machine evidence before attempting reference access", async (t) => {
  const f = await fixture(t);
  await runLocalCheck(f.root, { runner: fakeRunner(f.root, f.plan) });
  await fs.appendFile(path.join(f.root, "machine-observations.json"), " ");
  const missingReference = path.join(
    path.dirname(f.root),
    "never-created-reference.ass",
  );
  await assert.rejects(
    evaluateLocalCheck(f.root, missingReference),
    /FROZEN_FILE_CHANGED:machine-observations\.json/u,
  );
  await assert.rejects(fs.access(path.join(f.root, "evaluation")));
});

test("frozen mock evaluation delivers six reference-isolated views and refuses overwrite", async (t) => {
  const f = await fixture(t);
  for (const target of f.plan.targets) {
    const task = path.join(path.dirname(f.root), `baseline-${target.id}`);
    await fs.mkdir(task);
    const mappedPath = path.join(task, "mapped-records.json");
    await writeJson(mappedPath, { records: target.records });
    f.plan.sourceFiles.push({
      path: mappedPath,
      sha256: hash(await fs.readFile(mappedPath)),
    });
    f.plan.sourceTasks.push({ id: target.id, task });
  }
  await f.rewritePlan();
  const runner = fakeRunner(f.root, f.plan);
  await runLocalCheck(f.root, { runner });
  const referencePath = path.join(
    path.dirname(f.root),
    "synthetic-reference.ass",
  );
  await fs.writeFile(
    referencePath,
    [
      "[Events]",
      "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
      "Dialogue: 0,0:00:10.40,0:00:11.40,Dialogue,,0,0,0,,合成\\N人工合成测试",
      "Dialogue: 0,0:01:36.00,0:01:37.00,Dialogue,,0,0,0,,合成文",
      "Dialogue: 0,0:03:16.00,0:03:17.00,Dialogue,,0,0,0,,合成文",
      "",
    ].join("\n"),
  );
  const freezeBefore = await fs.readFile(
    path.join(f.root, "machine-freeze.json"),
    "utf8",
  );
  const result = await evaluateLocalCheck(f.root, referencePath);
  assert.equal(result.views, 6);
  assert.equal(result.machineFreezeVerified, true);
  assert.equal(result.qualityStatus, "needs-review");
  const evaluationPath = path.join(
    result.destination,
    "reference-comparison.json",
  );
  const bytesBefore = await fs.readFile(evaluationPath, "utf8");
  const evaluation = JSON.parse(bytesBefore);
  assert.equal(evaluation.views.length, 6);
  assert.equal(
    evaluation.views.filter((view) => view.conditionalTimingOnly).length,
    2,
  );
  assert.equal(evaluation.referenceUsedForGeneration, false);
  assert.equal(evaluation.qualityStatus, "needs-review");
  assert.equal(evaluation.finalizationMethod, "none");
  assert.equal(evaluation.wholeEpisodeAccuracy, null);
  assert.equal(evaluation.humanListeningPerformed, false);
  assert.equal(evaluation.independentTestSet, false);
  assert.ok(
    (
      await fs.readFile(path.join(result.destination, "review.html"), "utf8")
    ).includes("needs-review"),
  );
  await assert.rejects(evaluateLocalCheck(f.root, referencePath), /EEXIST/u);
  assert.equal(await fs.readFile(evaluationPath, "utf8"), bytesBefore);
  assert.equal(
    await fs.readFile(path.join(f.root, "machine-freeze.json"), "utf8"),
    freezeBefore,
  );
  assert.equal(runner.calls.length, 5, "evaluation never dispatches a model");
});
