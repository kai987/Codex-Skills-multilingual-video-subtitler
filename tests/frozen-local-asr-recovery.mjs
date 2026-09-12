import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Buffer } from "node:buffer";
import {
  bindPlan,
  sampleAt,
  localRecords,
  integrateRecords,
} from "../scripts/lib/local-asr-policy.mjs";
import { hash, identity } from "../scripts/lib/content-review-plan.mjs";
import { coreSlice } from "../scripts/lib/bounded-content-review.mjs";
import { readPcm, slicePcm, durable } from "../scripts/lib/bounded-asr-ab.mjs";
import {
  execute,
  fileHash,
  inventory,
  publishTriple,
  exists,
  checkJournal,
  decoderArgs,
  verifyRaw,
  machineInput,
} from "../scripts/lib/local-asr-run.mjs";
const temp = async () =>
  fs.mkdtemp(path.join(os.tmpdir(), "frozen-local-neutral-"));
const m = {
  pcm: { sampleRate: 16000, frames: 1600000 },
  audioOffset: 0,
  sourceEnd: 100,
  language: "en",
  threads: 4,
  decode: { prompt: null },
};
const w = {
  windowId: "neutral-window",
  regionId: "neutral-region",
  priority: "P0",
  referenceIds: ["neutral-ref"],
  coreStart: 11,
  coreEnd: 14,
  requestStart: 10,
  requestEnd: 15,
  seconds: 5,
  prompt: null,
  referenceTextUsedAsPrompt: false,
  executionAuthorized: false,
  status: "scheduled",
};
const plan = {
  policy: "reference-guided-missing-localization-v1",
  plannedOnly: true,
  LOCAL_ASR_EXECUTED: false,
  selectionUsesA: false,
  deferred: [],
  scheduled: [w],
  plannedWindows: 1,
  plannedSeconds: 5,
};
const bytes = Buffer.from(JSON.stringify(plan));
const a = {
  version: "frozen-local-asr-authorization-v1",
  recoveryIdentity: hash("r"),
  recoveryFreezeSha256: hash("f"),
  planSha256: hash(bytes),
  experimentSha256: hash("e"),
  modelSha256: hash("m"),
  runtimeSha256: hash("x"),
  sourcePcmSha256: hash("p"),
  sourceMediaSha256: hash("s"),
  primaryWindows: 1,
  primarySamples: 80000,
  sampleRate: 16000,
  sourceFrames: 1600000,
  audioOffset: 0,
  baselineCount: 1,
  maxRequestSeconds: 30,
  maxTechnicalRetries: 1,
};
const clock = (n) =>
  `00:00:${String(Math.floor(n / 1000)).padStart(2, "0")},${String(n % 1000).padStart(3, "0")}`;
const local = (s, e, text = "neutral addition", window = w, manifest = m) =>
  localRecords(
    Buffer.from(`1\n${clock(s)} --> ${clock(e)}\n${text}\n`),
    window,
    manifest,
    { requestId: identity(window) },
  )[0];
const base = (s = 1, e = 2, text = "baseline", id = "baseline") => ({
  recordId: id,
  sourceStart: s,
  sourceEnd: e,
  text,
  rawStart: "00:00:01,000",
  rawEnd: "00:00:02,000",
});
test("frozen plan requires authorization, exact hash/count/samples and hard bound", () => {
  assert.equal(bindPlan(bytes, a, true).primarySamples, 80000);
  assert.throws(() => bindPlan(bytes, a, false), /AUTHORIZATION/);
  assert.throws(
    () =>
      bindPlan(
        Buffer.from(JSON.stringify({ ...plan, scheduled: [] })),
        a,
        true,
      ),
    /HASH/,
  );
  for (const key of ["primaryWindows", "primarySamples", "sourceFrames"])
    assert.throws(() => bindPlan(bytes, { ...a, [key]: 2 }, true));
  assert.throws(() => sampleAt(0.000001, 16000), /NONINTEGER/);
  assert.throws(() => bindPlan(bytes, { ...a, maxRequestSeconds: 31 }, true));
});
for (const [name, s, e, expected] of [
  ["inside", 1500, 2500, "CORE_OWNED_EXACT"],
  ["equal", 1000, 4000, "CORE_OWNED_EXACT"],
  ["context", 0, 500, "CONTEXT_ONLY"],
  ["start cross", 500, 2000, "CROSSES_CORE_BOUNDARY"],
  ["end cross", 2000, 4500, "CROSSES_CORE_BOUNDARY"],
  ["whole cross", 0, 5000, "CROSSES_CORE_BOUNDARY"],
  ["zero", 1000, 1000, "INVALID_TIMING"],
  ["reversed", 2000, 1000, "INVALID_TIMING"],
  ["overrun", 0, 6000, "INVALID_TIMING"],
])
  test("ownership " + name, () =>
    assert.equal(local(s, e).ownership, expected),
  );
test("nonzero offset applied exactly once", () => {
  const x = local(
    1000,
    2000,
    "neutral",
    { ...w, requestStart: 20, requestEnd: 25, coreStart: 21, coreEnd: 24 },
    { ...m, audioOffset: 10, sourceEnd: 110 },
  );
  assert.equal(x.record.sourceStart, 21);
  assert.equal(x.timing.geometry.inputStart, 160000);
});
test("no substring cropping even when extraneous token evidence supplied", () => {
  const x = local(0, 5000);
  x.record.tokens = [{ text: "neutral", start: 1, end: 2, trusted: true }];
  const r = integrateRecords([base()], [x]);
  assert.equal(r.inserted.length, 0);
  assert.equal(r.decisions[0].status, "EVIDENCE_ONLY_CORE_BOUNDARY");
  assert.equal(x.record.text, "neutral addition");
});
test("safe gap preserves baseline raw/mapped/text and reference cannot affect decision", () => {
  const b = [base()],
    x = local(1000, 2000),
    r = integrateRecords(b, [x]);
  assert.equal(r.inserted.length, 1);
  assert.deepEqual(r.records[0], b[0]);
  const other = {
    ...x,
    referenceText: "never candidate",
    referenceDistance: 0,
  };
  assert.deepEqual(integrateRecords(b, [other]), r);
});
test("positive overlap, same start and projected overlap blocked", () => {
  for (const b of [base(11.5, 13), base(11, 11.1)])
    assert.equal(integrateRecords([b], [local(1000, 2000)]).inserted.length, 0);
  const x = local(1996, 2500);
  assert.equal(x.projection.recoveredSerialized.start.seconds, 12);
  assert.equal(integrateRecords([base(12, 12.5)], [x]).inserted.length, 0);
});
test("local-local collision excludes all, independent of input order", () => {
  const x = local(1000, 2200, "one"),
    y = local(1500, 2300, "two");
  for (const list of [
    [x, y],
    [y, x],
  ]) {
    const r = integrateRecords([base()], list);
    assert.equal(r.inserted.length, 0);
    assert.ok(
      r.decisions.every((d) => d.status === "LOCAL_CANDIDATE_COLLISION"),
    );
  }
});
test("adjacent exact duplicate rejected, repetition severe rejected", () => {
  assert.equal(
    integrateRecords([base(9, 10, "neutral addition")], [local(1000, 2000)])
      .decisions[0].status,
    "POTENTIAL_DUPLICATE_INSERTION",
  );
  assert.equal(
    integrateRecords([base()], [local(1000, 2000, "a".repeat(80))]).decisions[0]
      .status,
    "BLOCKED_REPETITION_RISK",
  );
});
test("no candidates unchanged; existing ties preserved; safe insert order stable", () => {
  const b = [base(1, 2, "one", "z"), base(1, 2, "two", "a")];
  assert.deepEqual(integrateRecords(b, []).records, b);
  const r = integrateRecords(
    [base()],
    [local(3000, 3500, "second"), local(1000, 1500, "first")],
  );
  assert.deepEqual(
    r.records.map((x) => x.text),
    ["baseline", "first", "second"],
  );
});
test("cross-core exact PCM, no duplicate context, WAV re-read", () => {
  const values = Buffer.alloc(20);
  for (let i = 0; i < 10; i++) values.writeInt16LE(i, i * 2);
  const chunks = [
    {
      chunk: { id: "a", inputStart: 0, coreStart: 0, coreEnd: 5 },
      data: values.subarray(0, 14),
    },
    {
      chunk: { id: "b", inputStart: 3, coreStart: 5, coreEnd: 10 },
      data: values.subarray(6),
    },
  ];
  const s = coreSlice(chunks, 2, 8);
  assert.deepEqual(s.data, values.subarray(4, 16));
  const wav = slicePcm({ sampleRate: 16000, frames: 6, data: s.data }, 0, 6);
  assert.deepEqual(readPcm(wav).data, s.data);
  assert.throws(() => coreSlice(chunks, 2, 11), /INCOMPLETE/);
});
test("triple disk publication and failure does not publish subset", async () => {
  const root = await temp(),
    records = [base()];
  await publishTriple(path.join(root, "okay"), records, "en");
  assert.equal((await fs.readdir(path.join(root, "okay"))).length, 4);
  let calls = 0;
  await assert.rejects(
    publishTriple(path.join(root, "failed"), records, "en", async (...args) => {
      if (++calls === 2) throw Error("injected write");
      return fs.writeFile(...args);
    }),
    /injected/,
  );
  assert.equal(await exists(path.join(root, "failed")), false);
});
test("request args no prompt/state/extra options and order-independent", () => {
  const x = decoderArgs("model", "input", "output", m);
  assert.deepEqual(x, [
    "--model",
    "model",
    "--file",
    "input",
    "--language",
    "en",
    "--threads",
    "4",
    "--output-srt",
    "--output-file",
    "output",
    "--suppress-nst",
    "--no-prints",
  ]);
  assert.equal(x.includes("--prompt"), false);
});
async function executionFixture() {
  const root = await temp();
  for (const d of ["windows", "windows/neutral-window", "runtime"])
    await fs.mkdir(path.join(root, d));
  for (const file of ["runtime/model.bin", "runtime/cli"])
    await fs.writeFile(path.join(root, file), "neutral");
  const input = path.join(root, "windows/neutral-window/input.wav");
  await fs.writeFile(
    input,
    slicePcm(
      { sampleRate: 16000, frames: 80000, data: Buffer.alloc(160000) },
      0,
      80000,
    ),
  );
  const config = {
    authorization: {
      ...a,
      modelSha256: hash("neutral"),
      runtimeSha256: hash("neutral"),
    },
    runtime: path.join(root, "runtime/cli"),
    model: path.join(root, "runtime/model.bin"),
    experiment: m,
    windows: [
      {
        ...w,
        requestId: identity(w),
        startSample: 160000,
        endSample: 240000,
        pcmHash: hash(Buffer.alloc(160000)),
      },
    ],
    budget: { primarySamples: 80000, maxDispatches: 2, maxSamples: 160000 },
  };
  await durable(path.join(root, "experiment.json"), config, true);
  await durable(
    path.join(root, "execution-freeze.json"),
    {
      configHash: identity(config),
      files: [
        {
          path: "experiment.json",
          sha256: await fileHash(path.join(root, "experiment.json")),
        },
        ...(await inventory(path.join(root, "windows"))).map((r) => ({
          ...r,
          path: "windows/" + r.path,
        })),
      ],
    },
    true,
  );
  await fs.writeFile(path.join(root, "execution-ledger.jsonl"), "");
  return root;
}
const stub = (content, failures = 0) => {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async run(_e, args) {
      calls++;
      assert.equal(args.includes("--prompt"), false);
      if (calls <= failures)
        return {
          exitCode: 1,
          signal: null,
          stdout: "",
          stderr: "synthetic process failure",
        };
      await fs.writeFile(
        args[args.indexOf("--output-file") + 1] + ".srt",
        content,
      );
      return { exitCode: 0, signal: null, stdout: "", stderr: "" };
    },
  };
};
for (const [label, text, status] of [
  [
    "nonempty",
    "1\n00:00:01,000 --> 00:00:02,000\nneutral\n",
    "SUCCESS_NONEMPTY",
  ],
  ["empty", "", "SUCCESS_EMPTY"],
  [
    "invalid",
    "1\n00:00:01,000 --> 00:00:01,000\nneutral\n",
    "SUCCESS_TIMING_INVALID",
  ],
  [
    "bad text",
    "1\n00:00:01,000 --> 00:00:02,000\n" + "a".repeat(80) + "\n",
    "SUCCESS_NONEMPTY",
  ],
])
  test(
    "execution " +
      label +
      " persists/reuses, no quality retry or reference read",
    async () => {
      const root = await executionFixture(),
        runner = stub(text);
      const original = fs.readFile;
      fs.readFile = async (p, ...args) => {
        if (/input-evidence|reference|comparison/u.test(String(p)))
          throw Error("REFERENCE_READ_DENIED");
        return original(p, ...args);
      };
      try {
        await execute(root, true, runner);
        assert.equal(runner.calls, 1);
        const r = await verifyRaw(root);
        assert.equal(r.rows.at(-1).status, status);
        assert.equal((await execute(root, true, runner)).newASR, 0);
        assert.equal(runner.calls, 1);
        await fs.writeFile(
          path.join(root, "windows/neutral-window/input.wav"),
          "changed",
        );
        await assert.rejects(execute(root, true, runner), /CHANGED/);
        assert.equal(runner.calls, 1);
      } finally {
        fs.readFile = original;
      }
    },
  );
test("technical retry one globally, second failure stops; budget retained", async () => {
  for (const n of [1, 2]) {
    const root = await executionFixture(),
      r = stub("", n);
    if (n === 1) {
      await execute(root, true, r);
      assert.equal((await verifyRaw(root)).f.counts.retries, 1);
    } else await assert.rejects(execute(root, true, r), /RETRY_EXHAUSTED/);
    assert.equal(r.calls, 2);
  }
});
test("ledger rejects illegal retry/samples and unknown states", () => {
  const c = {
      windows: [{ requestId: "x", startSample: 0, endSample: 5 }],
      budget: { maxDispatches: 2, maxSamples: 10 },
    },
    r = {
      kind: "reserved",
      requestId: "x",
      attemptId: "a",
      samples: 5,
      index: 0,
    };
  assert.equal(checkJournal(c, [r]).samples, 5);
  assert.throws(() => checkJournal(c, [{ ...r, samples: 6 }]), /REQUEST/);
  assert.throws(
    () => checkJournal(c, [r, { ...r, attemptId: "b", index: 1 }]),
    /RETRY/,
  );
  assert.throws(
    () =>
      checkJournal(c, [
        r,
        { kind: "finished", attemptId: "a", index: 1, status: "UNKNOWN" },
      ]),
    /FINISH/,
  );
});
test("machine input refuses unpinned bundle without reference access", async () => {
  const dir = await temp();
  await fs.writeFile(path.join(dir, "results-freeze.json"), "{}");
  await assert.rejects(machineInput(dir, a), /FREEZE_CHANGED/);
});
