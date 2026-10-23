import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { generateBounded } from "../scripts/lib/bounded-product.mjs";
import { slicePcm } from "../scripts/lib/bounded-asr-ab.mjs";
import {
  prepareLocalCheck,
  runLocalCheck,
} from "../scripts/subtitle-tool-local-acoustic-check.mjs";
import { inventory } from "../scripts/lib/local-asr-run.mjs";

const json = async (file) => JSON.parse(await fs.readFile(file, "utf8"));
const writeJson = (file, value) =>
  fs.writeFile(file, JSON.stringify(value, null, 2) + "\n");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const clock = (seconds) => {
  const ms = Math.round(seconds * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};
const srt = (rows) =>
  rows
    .map(
      ([start, end, text], index) =>
        `${index + 1}\n${clock(start)} --> ${clock(end)}\n${text}\n`,
    )
    .join("\n");

const leftText = "前の文です音声を調べています";
const rightText = "調べていますので問題ありません";
const coreText = "前の文です音声を調べていますので問題ありません";

/** Synthetic media and model identities only; every process runner is injected. */
async function fixture(t) {
  const temporary = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "core-splice-synthetic-")),
  );
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const input = path.join(temporary, "media.mkv");
  const model = path.join(temporary, "model.bin");
  const ctcModel = path.join(temporary, "ctc-model");
  await fs.writeFile(input, "synthetic media; no real audio");
  await fs.writeFile(model, "synthetic model; never loaded");
  await fs.mkdir(ctcModel);
  await fs.writeFile(
    path.join(ctcModel, "model.safetensors"),
    "synthetic CTC identity; never loaded",
  );
  const frames = 80 * 16000;
  const audio = slicePcm(
    { sampleRate: 16000, frames, data: Buffer.alloc(frames * 2) },
    0,
    frames,
  );
  const raws = [
    srt([
      [1, 2, "合成"],
      [20, 22, "開始前の文"],
      [22, 25.3, leftText],
    ]),
    srt([
      [0, 1.5, rightText],
      [1.5, 2.5, "終了後の文"],
      [22, 25.6, "それは偶然ですね"],
    ]),
    srt([
      [0, 5, "あちらも偶然でした"],
      [5, 6, "次の文章を保護します"],
    ]),
    srt([[1, 2, "最後の文章を保護します"]]),
  ];
  let syntheticCalls = 0;
  const runner = {
    async run(_executable, args) {
      if (args[0] === "--help")
        return { stdout: "--output-srt", stderr: "", exitCode: 0 };
      if (args[0] === "--version")
        return { stdout: "11.18.0", stderr: "", exitCode: 0 };
      if (args[0] === "-version")
        return { stdout: "synthetic", stderr: "", exitCode: 0 };
      if (args.includes("-show_entries"))
        return {
          stdout: JSON.stringify({
            format: { duration: "80", start_time: "0" },
            streams: [{ index: 1, codec_type: "audio", start_time: "0" }],
          }),
          stderr: "",
          exitCode: 0,
        };
      if (args.includes("-map")) {
        await fs.writeFile(args.at(-1), audio);
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      const prefix = args[args.indexOf("--output-file") + 1];
      await fs.writeFile(`${prefix}.srt`, raws[syntheticCalls++]);
      return { stdout: "synthetic only", stderr: "", exitCode: 0 };
    },
  };
  const baseline = await generateBounded({
    input,
    outputRoot: path.join(temporary, "baseline"),
    runner,
    config: {
      model,
      runtime: process.execPath,
      ffmpeg: process.execPath,
      ffprobe: process.execPath,
      language: "ja",
      profile: "primary-minimal",
      threads: 1,
    },
  });
  assert.equal(syntheticCalls, 4);
  const old = await json(baseline.recordsPath);
  const id = (text) => old.records.find((r) => r.text === text).recordId;
  const targets = [
    { id: "timing", kind: "timing", recordIds: [id("合成")] },
    { id: "seam-a", kind: "seam", recordIds: [id(leftText), id(rightText)] },
    {
      id: "seam-b",
      kind: "seam",
      recordIds: [id("それは偶然ですね"), id("あちらも偶然でした")],
    },
  ].map((target) => ({ ...target, task: baseline.task }));
  const specFile = path.join(temporary, "spec.json");
  await writeJson(specFile, {
    targets,
    ctc: { model: ctcModel, python: process.execPath },
  });
  const prepared = await prepareLocalCheck(
    specFile,
    path.join(temporary, "acoustic"),
  );
  const plan = await json(path.join(prepared.root, "plan.json"));
  let fakeAcousticCalls = 0;
  await runLocalCheck(prepared.root, {
    runner: {
      async run(_executable, args, options) {
        fakeAcousticCalls++;
        if (args.includes("--output-srt")) {
          const request = plan.requests.find(
            (r) => r.id === path.basename(options.cwd),
          );
          const rows =
            request.targetId === "seam-a"
              ? request.id.endsWith("narrow")
                ? [
                    [20, 26.2, `開始前の文${coreText}`],
                    [26.2, 27.2, "終了後の文"],
                  ]
                : [
                    [request.start + 1.68, request.start + 2.68, "窗外の候補"],
                    [20, 22, "開始前の文"],
                    [22, 24, "前の文です"],
                    [24, 26.28, "音声を調べていますので問題ありません"],
                    [26.28, 27.2, "終了後の文"],
                  ]
              : [
                  [45, 50, "それは偶然ですね"],
                  [50, 54.7, "あちらも偶然でした"],
                  [54.7, 55.7, "次の文章を保護します"],
                ];
          const local = rows.map(([a, b, text]) => [
            a - request.start,
            b - request.start,
            text,
          ]);
          const prefix = args[args.indexOf("--output-file") + 1];
          await fs.writeFile(`${prefix}.srt`, srt(local));
          await writeJson(`${prefix}.json`, {
            transcription: local.map(([a, b, text]) => ({
              text,
              offsets: { from: Math.round(a * 1000), to: Math.round(b * 1000) },
              tokens: [],
            })),
          });
        } else {
          for (const request of plan.requests.filter(
            (r) => r.backend === "ctc",
          )) {
            const dir = path.join(prepared.root, request.id);
            await writeJson(path.join(dir, "reserved.json"), { request });
            await writeJson(path.join(dir, "raw.json"), {
              type: "result",
              requestId: request.id,
              pathStatus: "failure",
              blockers: ["SYNTHETIC_NO_ALIGNMENT"],
            });
          }
        }
        await fs.writeFile(
          path.join(options.cwd, "stdout.log"),
          "synthetic only\n",
        );
        await fs.writeFile(path.join(options.cwd, "stderr.log"), "");
        return { exitCode: 0, signal: null };
      },
    },
  });
  assert.equal(fakeAcousticCalls, 5);
  const filesBefore = await inventory(baseline.task);
  await fs.unlink(input);
  await fs.unlink(model);
  await fs.rm(ctcModel, { recursive: true });
  return {
    root: prepared.root,
    baseline: baseline.task,
    temporary,
    old: old.records,
    filesBefore,
    plan,
  };
}

test("offline replay works without external media/models and preserves protected neighbors", async (t) => {
  const f = await fixture(t);
  const { loadCoreInput, replayCoreSplice } =
    await import("../scripts/subtitle-tool-core-splice.mjs");
  await loadCoreInput(f.root);
  const fractionalMapped = await json(
    path.join(f.root, "seam-a-wide", "mapped-records.json"),
  );
  const fractionalRaw = await json(
    path.join(f.root, "seam-a-wide", "raw.json"),
  );
  assert.equal(fractionalRaw.transcription[0].offsets.from, 1680);
  assert.equal(fractionalMapped.records[0].localStart, 1.6800000000000002);
  const output = await replayCoreSplice(
    f.root,
    path.join(f.temporary, "replay"),
  );
  assert.equal(output.proposals, 1);
  assert.equal(output.abstentions, 2);
  assert.equal(output.newInferenceRequests, 0);
  const result = await json(path.join(output.root, "core-splice.json"));
  assert.equal(result.providerProcesses, 0);
  assert.equal(result.modelLoads, 0);
  assert.equal(result.referenceUsed, false);
  assert.equal(result.finalizationMethod, "none");
  assert.equal(result.machineOnlyReleaseAuthorized, false);
  const seam = result.targets.find((r) => r.id === "seam-a");
  assert.equal(seam.candidate.length, f.old.length - 1);
  assert.equal(seam.decision.proposal.text, coreText);
  assert.equal(seam.decision.proposal.sourceStart, 22);
  assert.equal(seam.decision.proposal.sourceEnd, 26.2);
  const changedIds = new Set(seam.decision.proposal.sourceRecordIds);
  assert.deepEqual(
    seam.candidate.filter((r) => r.recordId !== seam.insertedRecordId),
    f.old.filter((r) => !changedIds.has(r.recordId)),
  );
  assert.equal(seam.integrity.timingStructureChanged, true);
  assert.equal(seam.integrity.displayBoundaryValidated, false);
  for (const id of ["timing", "seam-b"]) {
    const target = result.targets.find((r) => r.id === id);
    assert.deepEqual(target.candidate, target.baseline);
  }
  const freeze = await json(path.join(output.root, "machine-freeze.json"));
  assert.equal(
    freeze.files.filter((r) => /\.(ass|srt|vtt)$/u.test(r.path)).length,
    18,
  );
  for (const file of freeze.files)
    assert.equal(
      hash(await fs.readFile(path.join(output.root, file.path))),
      file.sha256,
    );
  assert.deepEqual(await inventory(f.baseline), f.filesBefore);
});

test("two offline replays produce byte-identical frozen artifacts", async (t) => {
  const f = await fixture(t);
  const { replayCoreSplice } =
    await import("../scripts/subtitle-tool-core-splice.mjs");
  const first = await replayCoreSplice(f.root, path.join(f.temporary, "first"));
  const second = await replayCoreSplice(
    f.root,
    path.join(f.temporary, "second"),
  );
  assert.notEqual(first.root, second.root);
  assert.deepEqual(await inventory(first.root), await inventory(second.root));
  assert.deepEqual(await inventory(f.baseline), f.filesBefore);
});

test("tampered frozen local evidence is rejected before creating output", async (t) => {
  const f = await fixture(t);
  const { replayCoreSplice } =
    await import("../scripts/subtitle-tool-core-splice.mjs");
  await fs.appendFile(path.join(f.root, "seam-a-wide", "raw.srt"), "tamper\n");
  const output = path.join(f.temporary, "rejected");
  await assert.rejects(
    replayCoreSplice(f.root, output),
    /FROZEN_FILE_CHANGED/u,
  );
  await assert.rejects(fs.stat(output), { code: "ENOENT" });
  assert.deepEqual(await inventory(f.baseline), f.filesBefore);
});

test("tampered baseline is rejected even when acoustic artifacts remain valid", async (t) => {
  const f = await fixture(t);
  const { replayCoreSplice } =
    await import("../scripts/subtitle-tool-core-splice.mjs");
  await fs.appendFile(path.join(f.baseline, "mapped-records.json"), "\n");
  const output = path.join(f.temporary, "rejected");
  await assert.rejects(replayCoreSplice(f.root, output), /BASELINE_CHANGED/u);
  await assert.rejects(fs.stat(output), { code: "ENOENT" });
});

test("replay refuses both source roots and nested output destinations without mutation", async (t) => {
  const f = await fixture(t);
  const { replayCoreSplice } =
    await import("../scripts/subtitle-tool-core-splice.mjs");
  const evidenceBefore = await inventory(f.root);
  for (const destination of [
    f.root,
    path.join(f.root, "nested"),
    f.baseline,
    path.join(f.baseline, "nested"),
  ])
    await assert.rejects(
      replayCoreSplice(f.root, destination),
      /SEPARATE_OUTPUT_REQUIRED/u,
    );
  assert.deepEqual(await inventory(f.root), evidenceBefore);
  assert.deepEqual(await inventory(f.baseline), f.filesBefore);
});

test("evaluation rejects invalid freeze before attempting an unavailable reference", async (t) => {
  const f = await fixture(t);
  const { replayCoreSplice } =
    await import("../scripts/subtitle-tool-core-splice.mjs");
  const { evaluateCoreSplice } =
    await import("../scripts/evaluate-core-splice.mjs");
  const output = await replayCoreSplice(
    f.root,
    path.join(f.temporary, "replay"),
  );
  const freezeFile = path.join(output.root, "machine-freeze.json");
  const frozenBytes = await fs.readFile(freezeFile);
  await writeJson(freezeFile, { version: "invalid", files: [] });
  const missingReference = path.join(f.temporary, "not-present.ass");
  await assert.rejects(
    evaluateCoreSplice(output.root, missingReference),
    /INVALID_CORE_FREEZE/u,
  );
  await fs.writeFile(freezeFile, frozenBytes);
  await fs.appendFile(path.join(output.root, "core-splice.json"), "\n");
  await assert.rejects(
    evaluateCoreSplice(output.root, missingReference),
    /FROZEN_FILE_CHANGED/u,
  );
  await assert.rejects(fs.stat(path.join(output.root, "evaluation")), {
    code: "ENOENT",
  });
});

test("post-freeze synthetic reference evaluation compares all original windows and never overwrites", async (t) => {
  const f = await fixture(t);
  const { replayCoreSplice } =
    await import("../scripts/subtitle-tool-core-splice.mjs");
  const { evaluateCoreSplice } =
    await import("../scripts/evaluate-core-splice.mjs");
  const output = await replayCoreSplice(
    f.root,
    path.join(f.temporary, "replay"),
  );
  const machineBefore = await inventory(output.root);
  const reference = path.join(f.temporary, "synthetic-reference.ass");
  await fs.writeFile(
    reference,
    [
      "[Events]",
      "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
      "Dialogue: 0,0:00:01.00,0:00:02.00,Dialogue,,0,0,0,,合成",
      `Dialogue: 0,0:00:22.00,0:00:26.20,Dialogue,,0,0,0,,${coreText}\\N仅用于测试的译文`,
      "Dialogue: 0,0:00:46.70,0:00:50.30,Dialogue,,0,0,0,,それは偶然ですね",
      "Dialogue: 0,0:00:49.70,0:00:54.70,Dialogue,,0,0,0,,あちらも偶然でした",
      "",
    ].join("\n"),
  );
  const result = await evaluateCoreSplice(output.root, reference);
  assert.equal(result.comparisons.length, 3);
  const report = await json(
    path.join(result.output, "reference-comparison.json"),
  );
  assert.equal(report.referenceUsedForGeneration, false);
  assert.equal(report.humanListeningPerformed, false);
  assert.equal(report.machineOnlyReleaseAuthorized, false);
  assert.equal(report.wholeEpisodeAccuracy, null);
  assert.equal(report.qualityStatus, "needs-review");
  const machine = await json(path.join(output.root, "core-splice.json"));
  for (const row of report.comparisons) {
    const original = machine.targets.find((r) => r.id === row.targetId);
    assert.deepEqual(row.comparison.window, {
      id: original.id,
      kind: original.kind,
      ...original.effectiveRange,
    });
    assert.equal(
      row.comparison.baseline.edit.N,
      row.comparison.candidate.edit.N,
    );
    assert.equal(row.comparison.reference.recordCount, 4);
    assert.equal(
      JSON.stringify(row.comparison.reference).includes("仅用于测试的译文"),
      false,
    );
  }
  const evaluationsBefore = await inventory(result.output);
  assert.equal(
    evaluationsBefore.some((r) => r.path === "review.html"),
    true,
  );
  await assert.rejects(evaluateCoreSplice(output.root, reference), {
    code: "EEXIST",
  });
  assert.deepEqual(await inventory(result.output), evaluationsBefore);
  assert.deepEqual(
    (await inventory(output.root)).filter(
      (r) => !r.path.startsWith("evaluation/"),
    ),
    machineBefore,
  );
  assert.deepEqual(await inventory(f.baseline), f.filesBefore);
});
