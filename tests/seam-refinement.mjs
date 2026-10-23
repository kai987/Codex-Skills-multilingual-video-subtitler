import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Buffer } from "node:buffer";
import { assembleTextOnly } from "../scripts/subtitle-tool-seam-text-only.mjs";
import {
  assembleContextDelivery,
  verifyContextDelivery,
} from "../scripts/lib/seam-context-delivery.mjs";
import {
  planSeams,
  decideSeam,
  assembleSeams,
} from "../scripts/lib/seam-refinement.mjs";
import {
  prepareSeams,
  executeSeams,
  verifySeams,
} from "../scripts/subtitle-tool-refine-seams.mjs";
import { generateBounded } from "../scripts/lib/bounded-product.mjs";
import { refineDefaultDelivery } from "../scripts/lib/default-seam-delivery.mjs";
import { slicePcm } from "../scripts/lib/bounded-asr-ab.mjs";
const row = (recordId, text, sourceStart, sourceEnd, chunkIndex = 0) => ({
  recordId,
  text,
  sourceStart,
  sourceEnd,
  chunkIndex,
  issues: [],
  order: 1,
});
const records = [
  row("a", "今日は駅まで歩きます", 10, 13),
  row("b", "駅まで歩きますそして帰ります", 12, 15, 1),
];
const ds = [{ leftId: "a", rightId: "b", status: "BOUNDARY_AMBIGUITY" }];
const target = () => planSeams(records, ds, 50).targets[0];
const views = () =>
  [1, 2].map((i) => ({
    requestId: `r${i}`,
    audioHash: String(i),
    start: 10 - i,
    end: 15 + i,
    records: [
      {
        ...row(`donor${i}`, "今日は駅まで歩きますそして帰ります", 10.1, 15.1),
        requestId: `r${i}`,
      },
    ],
  }));
test("machine-only deterministic planning, bounded windows and no input mutation", () => {
  const before = JSON.stringify(records);
  assert.deepEqual(planSeams(records, ds, 50), planSeams(records, ds, 50));
  assert.equal(planSeams(records, ds, 50).requests, 2);
  assert.equal(JSON.stringify(records), before);
});
test("two whole-cue views reduce seam duplicate without synthesized text or timing", () => {
  const d = decideSeam(target(), records, views());
  assert.equal(d.status, "CANDIDATE");
  assert.equal(d.records[0].sourceStart, 10.1);
  assert.equal(assembleSeams(records, [d]).length, 1);
});
test("short responses and genuine separate occurrences remain protected", () => {
  assert.equal(
    planSeams([row("a", "はい", 10, 13), row("b", "はい", 12, 15, 1)], ds, 50)
      .targets.length,
    0,
  );
  assert.equal(
    planSeams([records[0], { ...records[1], sourceStart: 14 }], ds, 50).targets
      .length,
    0,
  );
});
test("long closure and invalid baselines rejected", () => {
  assert.equal(
    planSeams([...records, row("c", "隣接する長い発話です", 14, 40)], ds, 50)
      .targets.length,
    0,
  );
  assert.throws(() => planSeams([records[0], records[0]], ds, 50));
});
test("plan bounds all targets and total audio even for many seams", () => {
  const rr = [],
    dd = [];
  for (let i = 0; i < 10; i++) {
    rr.push(
      ...records.map((r, k) => ({
        ...r,
        recordId: `${i}-${k}`,
        sourceStart: r.sourceStart + i * 30,
        sourceEnd: r.sourceEnd + i * 30,
        chunkIndex: i * 2 + k,
      })),
    );
    dd.push({
      leftId: `${i}-0`,
      rightId: `${i}-1`,
      status: "BOUNDARY_AMBIGUITY",
    });
  }
  const p = planSeams(rr, dd, 400);
  assert(
    p.targets.length <= 4 && p.requests <= 8 && p.reservedAudioSeconds <= 120,
  );
});
for (const [name, change, reason] of [
  [
    "text conflict",
    (v) => {
      v[1].records[0].text += "はい";
    },
    "TWO_VIEW_TEXT_OR_SEGMENTATION_DISAGREEMENT",
  ],
  [
    "timing disagreement",
    (v) => {
      v[1].records[0].sourceStart = 10.49;
    },
    "TWO_VIEW_TIMING_DISAGREEMENT",
  ],
  [
    "source boundary drift",
    (v) => {
      v[0].records[0].sourceStart = 9.2;
    },
    "OUTER_ENVELOPE_DRIFT",
  ],
  [
    "request edge",
    (v) => {
      v[0].records[0].sourceStart = 9;
    },
    "DONOR_TOUCHES_REQUEST_EDGE",
  ],
  [
    "same evidence",
    (v) => {
      v[1].audioHash = v[0].audioHash;
    },
    "TWO_DISTINCT_AUDIO_VIEWS_REQUIRED",
  ],
  [
    "lost unique prefix",
    (v) =>
      v.forEach((x) => {
        x.records[0].text = "駅まで歩きますそして帰ります";
      }),
    "OUTER_TEXT_ANCHORS_NOT_PRESERVED",
  ],
])
  test(name, () => {
    const v = views();
    change(v);
    assert.equal(decideSeam(target(), records, v).reason, reason);
  });
test("outside neighbor collision and competing replacements rejected", () => {
  const extra = row("extra", "別の発話", 15, 16);
  assert.equal(
    decideSeam(target(), [...records, extra], views()).reason,
    "NEIGHBOR_COLLISION",
  );
  const d = decideSeam(target(), records, views());
  assert.throws(() => assembleSeams(records, [d, d]), /COMPETING/);
});
async function fixture() {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "seam-refine-synthetic-")),
  );
  const input = path.join(root, "source"),
    model = path.join(root, "model");
  await fs.writeFile(input, "synthetic media");
  await fs.writeFile(model, "synthetic model");
  const pcm = {
    sampleRate: 16000,
    frames: 50 * 16000,
    data: Buffer.alloc(50 * 16000 * 2, 1),
  };
  let calls = 0;
  const runner = {
    run: async (exe, args) => {
      if (args[0] === "--help")
        return { stdout: "--output-srt", stderr: "", exitCode: 0 };
      if (args[0] === "--version" || args[0] === "-version")
        return { stdout: "11.18.0", stderr: "", exitCode: 0 };
      if (args.includes("-show_entries"))
        return {
          stdout: JSON.stringify({
            format: { duration: "50", start_time: "0" },
            streams: [{ index: 1, codec_type: "audio", start_time: "0" }],
          }),
          stderr: "",
          exitCode: 0,
        };
      if (args.includes("-map")) {
        await fs.writeFile(args.at(-1), slicePcm(pcm, 0, pcm.frames));
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      calls++;
      const raw =
        calls === 1
          ? "1\n00:00:22,000 --> 00:00:25,280\n今日は駅まで歩きます\n"
          : "1\n00:00:00,000 --> 00:00:03,300\n駅まで歩きますそして帰ります\n";
      await fs.writeFile(args[args.indexOf("--output-file") + 1] + ".srt", raw);
      return { stdout: "", stderr: "", exitCode: 0 };
    },
  };
  const task = await generateBounded({
    config: {
      model,
      runtime: process.execPath,
      ffmpeg: process.execPath,
      ffprobe: process.execPath,
      language: "ja",
      profile: "primary-minimal",
      threads: 1,
    },
    input,
    outputRoot: path.join(root, "base"),
    runner,
  });
  return { root, task: task.task };
}
test("mock end to end: authorize, preserve baseline, freeze, zero-inference replay, tamper rejection", async () => {
  const f = await fixture();
  try {
    const p = await prepareSeams(f.task, path.join(f.root, "new"));
    assert.equal(p.requests, 2);
    const before = await fs.readFile(path.join(f.task, "mapped-records.json"));
    let calls = 0;
    const runner = {
      run: async (exe, args, options) => {
        calls++;
        assert(!args.includes("--prompt"));
        const req = JSON.parse(
          await fs.readFile(path.join(options.cwd, "request.json")),
        );
        const a = calls === 1 ? 1.1 : 2.1,
          b = calls === 1 ? 7.1 : 8.1;
        assert.equal(req.prompt, null);
        const stamp = (n) => `00:00:0${Math.floor(n)},100`;
        await fs.writeFile(
          args[args.indexOf("--output-file") + 1] + ".srt",
          `1\n${stamp(a)} --> ${stamp(b)}\n今日は駅まで歩きますそして帰ります\n`,
        );
        return { exitCode: 0, signal: null };
      },
    };
    await assert.rejects(executeSeams(p.root, { runner }), /AUTHORIZATION/);
    const r = await executeSeams(p.root, { authorize: true, runner });
    assert.equal(r.changedTargets, 1);
    await executeSeams(p.root, { authorize: true, runner });
    assert.equal(calls, 2);
    const textOnly = await assembleTextOnly(
      p.root,
      path.join(f.root, "text-only"),
    );
    assert.equal(textOnly.newInference, 0);
    assert.equal(textOnly.changedTargets, 1);
    assert.equal(calls, 2);
    const context = await assembleContextDelivery(
      p.root,
      path.join(f.root, "context"),
    );
    assert.equal(context.additionalChangedTargets, 0);
    assert.equal(context.totalChangedTargets, 1);
    assert.equal(context.newInference, 0);
    assert.equal(
      (await verifyContextDelivery(context.root)).integrity,
      "passed",
    );
    assert.deepEqual(
      await fs.readFile(context.outputs.find((p) => p.endsWith(".srt"))),
      await fs.readFile(
        path.join(textOnly.root, "seam-text-only.machine-candidate.srt"),
      ),
    );
    // Real assemblers wired through the normal delivery orchestrator; provider is synthetic.
    const delivery = await refineDefaultDelivery(
      {
        task: f.task,
        executionStatus: "completed",
        coverageScope: "full-audio",
        unresolvedCount: 0,
        aliasCount: 0,
        // Exercise the real safety gate with the generated fixture, not a
        // nonexistent placeholder (which correctly produces a safety HOLD).
        outputs: JSON.parse(
          await fs.readFile(path.join(f.task, "bounded-task.json"), "utf8"),
        ).outputs,
      },
      { language: "ja" },
      {
        prepare: async () => p,
        execute: async () => verifySeams(p.root),
        observe: async () => ({ status: "skipped", reason: "synthetic-test" }),
        observeCoverage: async () => ({
          status: "skipped",
          reason: "synthetic-test",
        }),
      },
    );
    assert.equal(delivery.defaultDelivery.contextCandidate.integrity, "passed");
    assert.equal(
      delivery.defaultDelivery.contextCandidate.additionalChangedTargets,
      0,
    );
    assert.equal(delivery.defaultDelivery.contextCandidate.status, "unchanged");
    assert(
      delivery.preferredOutputs.every((p) =>
        p.includes("seam-text-only.machine-candidate"),
      ),
    );
    assert.equal(calls, 2);
    await assert.rejects(
      assembleContextDelivery(p.root, path.join(p.root, "bad")),
      /OUTPUT_INSIDE/u,
    );
    await fs.appendFile(context.outputs[0], "tampered");
    await assert.rejects(
      verifyContextDelivery(context.root),
      /OUTPUT_CHANGED/u,
    );
    assert.equal(calls, 2);
    assert.deepEqual(
      await fs.readFile(path.join(f.task, "mapped-records.json")),
      before,
    );
    await fs.appendFile(path.join(p.root, "candidate-records.json"), " ");
    await assert.rejects(verifySeams(p.root), /CHANGED/);
  } finally {
    await fs.rm(f.root, { recursive: true });
  }
});
test("failed reservation cannot launch again or silently retry", async () => {
  const f = await fixture();
  try {
    const p = await prepareSeams(f.task, path.join(f.root, "new"));
    let calls = 0;
    const runner = {
      run: async () => {
        calls++;
        return { exitCode: 1, signal: null };
      },
    };
    await assert.rejects(
      executeSeams(p.root, { authorize: true, runner }),
      /NO_RETRY/,
    );
    await assert.rejects(
      executeSeams(p.root, { authorize: true, runner }),
      /EEXIST/,
    );
    assert.equal(calls, 1);
  } finally {
    await fs.rm(f.root, { recursive: true });
  }
});
