import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { generateBounded } from "../scripts/lib/bounded-product.mjs";
import { slicePcm } from "../scripts/lib/bounded-asr-ab.mjs";
import { auditBoundedEvidence } from "../scripts/lib/bounded-evidence-audit.mjs";

const roots = [],
  prefix = "bounded-evidence-synthetic-";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const json = async (filename) =>
  JSON.parse(await fs.readFile(filename, "utf8"));
const repo = fileURLToPath(new URL("..", import.meta.url));
after(async () => {
  for (const root of roots) {
    if (!path.basename(root).startsWith(prefix))
      throw Error("UNEXPECTED_FIXTURE_CLEANUP_TARGET");
    await fs.rm(root, { recursive: true, force: true });
  }
});

function responseFixture() {
  const clock = (ms) =>
    `00:00:${String(Math.floor(ms / 1000)).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
  const item = (id, text, from, to) => ({
    id,
    text,
    p: 0.9,
    t_dtw: -1,
    offsets: { from, to },
    timestamps: { from: clock(from), to: clock(to) },
  });
  return {
    model: { multilingual: true, vocab: 51866 },
    params: { language: "ja", translate: false },
    result: { language: "ja" },
    transcription: [
      {
        text: "合成テストです",
        offsets: { from: 1000, to: 2000 },
        timestamps: { from: clock(1000), to: clock(2000) },
        tokens: [
          item(50415, "[_TT_50]", 1000, 1000),
          item(100, "合成", 1000, 1300),
          item(101, "テスト", 1300, 1800),
          item(102, "です", 1800, 2000),
          item(50465, "[_TT_100]", 2000, 2000),
        ],
      },
    ],
  };
}

async function fixture({ jsonOutput = true } = {}) {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), prefix)),
  );
  roots.push(root);
  const external = path.join(root, "external");
  await fs.mkdir(external);
  const input = path.join(external, "synthetic-media.mkv"),
    model = path.join(external, "synthetic-model.bin");
  await fs.writeFile(input, "not real media");
  await fs.writeFile(model, "not a real model");
  const executables = Object.fromEntries(
    ["runtime", "ffmpeg", "ffprobe"].map((key) => [
      key,
      path.join(external, key),
    ]),
  );
  for (const executable of Object.values(executables))
    await fs.writeFile(
      executable,
      "synthetic executable; the fake runner must intercept every call",
      { mode: 0o700 },
    );
  const frames = 25 * 16000,
    pcm = slicePcm(
      { sampleRate: 16000, frames, data: Buffer.alloc(frames * 2, 1) },
      0,
      frames,
    );
  let calls = 0,
    syntheticInference = 0;
  const runner = {
    run: async (_executable, args) => {
      calls++;
      if (args[0] === "--help")
        return {
          stdout: `--output-srt ${jsonOutput ? "--output-json-full" : ""}`,
          stderr: "",
          exitCode: 0,
        };
      if (["--version", "-version"].includes(args[0]))
        return { stdout: "11.18.0", stderr: "", exitCode: 0 };
      if (args.includes("-show_entries"))
        return {
          stdout: JSON.stringify({
            format: { duration: "25", start_time: "0" },
            streams: [{ index: 0, codec_type: "audio", start_time: "0" }],
          }),
          stderr: "",
          exitCode: 0,
        };
      if (args.includes("-map")) {
        await fs.writeFile(args.at(-1), pcm, { flag: "wx" });
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      assert.ok(
        args.includes("--output-file"),
        "no unrecognized synthetic process call",
      );
      syntheticInference++;
      const stem = args[args.indexOf("--output-file") + 1];
      await fs.writeFile(
        stem + ".srt",
        "1\n00:00:01,000 --> 00:00:02,000\n合成テストです\n",
      );
      if (jsonOutput)
        await fs.writeFile(stem + ".json", JSON.stringify(responseFixture()));
      return { stdout: "synthetic fixture", stderr: "", exitCode: 0 };
    },
  };
  const result = await generateBounded({
    input,
    outputRoot: path.join(root, "tasks"),
    runner,
    config: {
      model,
      ...executables,
      language: "ja",
      profile: "primary-minimal",
      threads: 1,
    },
  });
  assert.equal(syntheticInference, 1);
  assert.equal(result.executionStatus, "completed");
  // Explicit, fixture-owned files only. Successful audits must not need any of them.
  for (const filename of [input, model, ...Object.values(executables)])
    await fs.unlink(filename);
  await fs.rmdir(external);
  return {
    root,
    task: result.task,
    result,
    outputRoot: path.join(root, "audit-output"),
    get calls() {
      return calls;
    },
  };
}

async function snapshot(root) {
  const entries = {};
  async function walk(directory) {
    for (const entry of (
      await fs.readdir(directory, { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name))) {
      const filename = path.join(directory, entry.name),
        relative = path.relative(root, filename),
        stat = await fs.lstat(filename);
      if (entry.isDirectory()) await walk(filename);
      else
        entries[relative] = {
          sha256: hash(await fs.readFile(filename)),
          size: stat.size,
          mode: stat.mode,
          mtimeMs: stat.mtimeMs,
        };
    }
  }
  await walk(root);
  return entries;
}

async function manifestEdit(f, edit) {
  const filename = path.join(f.task, "bounded-task.json"),
    manifest = await json(filename);
  edit(manifest);
  await fs.writeFile(filename, JSON.stringify(manifest, null, 2) + "\n");
}
async function registeredEdit(f, relative, edit) {
  const filename = path.join(f.task, relative),
    value = await json(filename);
  edit(value);
  const bytes = JSON.stringify(value, null, 2) + "\n";
  await fs.writeFile(filename, bytes);
  await manifestEdit(f, (m) => {
    m.files[relative] = hash(bytes);
  });
}

test("stored audit is offline, byte-immutable and deterministic after external sources/tools are gone", async () => {
  const f = await fixture(),
    before = await snapshot(f.task),
    calls = f.calls;
  const first = await auditBoundedEvidence(f.task, {
      outputRoot: f.outputRoot,
    }),
    artifact = await json(first.report);
  assert.equal(first.newASRRequests, 0);
  assert.equal(artifact.modelLoads, 0);
  assert.equal(artifact.referenceUsed, false);
  assert.equal(artifact.textMutations, 0);
  assert.equal(artifact.timingMutations, 0);
  assert.equal(artifact.canAutoRetime, false);
  assert.equal(artifact.qualityStatus, "needs-review");
  assert.equal(artifact.finalizationMethod, "none");
  assert.equal(artifact.summary.requestCount, 1);
  assert.equal(artifact.summary.segments, 1);
  assert.equal(artifact.summary.textTokenItems, 3);
  assert.equal(artifact.summary.controlItems, 2);
  assert.equal(artifact.summary.unknownItems, 0);
  assert.equal(artifact.requests[0].rows[0].provenance.validated, true);
  assert.equal(artifact.requests[0].rows[0].provenance.timingVerified, false);
  assert.equal(f.calls, calls);
  assert.deepEqual(await snapshot(f.task), before);
  const deliveredBefore = await snapshot(first.directory);
  const again = await auditBoundedEvidence(f.task, {
    outputRoot: f.outputRoot,
  });
  assert.equal(again.sha256, first.sha256);
  assert.equal(again.report, first.report);
  assert.deepEqual(await snapshot(first.directory), deliveredBefore);
  assert.deepEqual(await snapshot(f.task), before);
  const alternate = await auditBoundedEvidence(f.task, {
    outputRoot: path.join(f.root, "other-audit-output"),
  });
  assert.equal(alternate.sha256, first.sha256);
  assert.deepEqual(
    await fs.readFile(alternate.report),
    await fs.readFile(first.report),
  );
});

test("audit-timing CLI works offline and preserves the task", async () => {
  const f = await fixture(),
    before = await snapshot(f.task);
  const cli = spawnSync(
    process.execPath,
    [
      path.join(repo, "scripts/subtitle-tool.mjs"),
      "audit-timing",
      "--task",
      f.task,
      "--output-root",
      f.outputRoot,
    ],
    {
      cwd: repo,
      encoding: "utf8",
      timeout: 30000,
      env: { ...process.env, PATH: "/nonexistent-synthetic-path" },
    },
  );
  assert.equal(cli.status, 0, cli.stderr || cli.error?.message);
  const result = JSON.parse(cli.stdout);
  assert.equal(result.newASRRequests, 0);
  assert.equal(result.qualityStatus, "needs-review");
  assert.ok(
    (await fs.readFile(result.index, "utf8")).includes("diagnostic only"),
  );
  assert.deepEqual(await snapshot(f.task), before);
});

test("source task and nested output roots are rejected without writes", async () => {
  const f = await fixture(),
    before = await snapshot(f.task);
  for (const outputRoot of [
    f.task,
    path.join(f.task, "audit-results"),
    path.join(f.task, "deep", "audit-results"),
  ])
    await assert.rejects(
      auditBoundedEvidence(f.task, { outputRoot }),
      /SEPARATE_OUTPUT_ROOT/u,
    );
  assert.deepEqual(await snapshot(f.task), before);
});

test("an output symlink into the task is rejected without modifying source", async () => {
  const f = await fixture(),
    alias = path.join(f.root, "output-alias"),
    before = await snapshot(f.task);
  await fs.symlink(f.task, alias);
  await assert.rejects(
    auditBoundedEvidence(f.task, { outputRoot: alias }),
    /符号链接|SYMLINK|SEPARATE_OUTPUT_ROOT/u,
  );
  assert.deepEqual(await snapshot(f.task), before);
});

test("a symlinked checkpoint root is not silently trusted", async () => {
  const f = await fixture();
  const alias = path.join(f.root, "task-alias");
  await fs.symlink(f.task, alias);
  await assert.rejects(
    auditBoundedEvidence(alias, { outputRoot: f.outputRoot }),
    /符号链接|SYMLINK/u,
  );
});

test("registered JSON, SRT and request byte tampering are rejected", async () => {
  for (const relative of [
    "requests/chunk-0001-attempt-1/raw-response.json",
    "requests/chunk-0001-attempt-1/raw-response.srt",
    "requests/chunk-0001-attempt-1/request.json",
  ]) {
    const f = await fixture();
    await fs.appendFile(path.join(f.task, relative), "\ntampered");
    const before = await snapshot(f.task);
    await assert.rejects(
      auditBoundedEvidence(f.task, { outputRoot: f.outputRoot }),
      /CHECKPOINT_CHANGED|EVIDENCE_CHANGED/u,
    );
    assert.deepEqual(await snapshot(f.task), before);
  }
});

test("request.json must be registered, not merely present beside a saved response", async () => {
  const f = await fixture();
  await manifestEdit(f, (m) => {
    delete m.files["requests/chunk-0001-attempt-1/request.json"];
  });
  await assert.rejects(
    auditBoundedEvidence(f.task, { outputRoot: f.outputRoot }),
    /UNREGISTERED_EVIDENCE/u,
  );
});

test("physically present but unregistered raw JSON is rejected rather than silently ignored", async () => {
  const f = await fixture();
  await manifestEdit(f, (m) => {
    delete m.files["requests/chunk-0001-attempt-1/raw-response.json"];
  });
  await assert.rejects(
    auditBoundedEvidence(f.task, { outputRoot: f.outputRoot }),
    /UNREGISTERED/u,
  );
});

test("genuinely unavailable optional JSON is explicit and never treated as verified timing", async () => {
  const f = await fixture({ jsonOutput: false });
  const artifact = await json(
    (await auditBoundedEvidence(f.task, { outputRoot: f.outputRoot })).report,
  );
  assert.deepEqual(artifact.requests[0].requestIssues, [
    "STORED_JSON_UNAVAILABLE",
  ]);
  assert.equal(artifact.summary.jsonTokenItems, 0);
  assert.equal(artifact.canAutoRetime, false);
  assert.equal(artifact.summary.proposedRepairCount, 0);
});

test("a rehashed forged request still fails source offset and model/language binding", async () => {
  for (const edit of [
    (request) => {
      request.sourceOffset += 5;
    },
    (request) => {
      request.args[request.args.indexOf("--model") + 1] = "/foreign-model.bin";
    },
    (request) => {
      request.args[request.args.indexOf("--language") + 1] = "en";
    },
    (request) => {
      request.id = "unrelated-attempt";
    },
  ]) {
    const f = await fixture();
    await registeredEdit(f, "requests/chunk-0001-attempt-1/request.json", edit);
    await assert.rejects(
      auditBoundedEvidence(f.task, { outputRoot: f.outputRoot }),
      /REQUEST_BINDING_MISMATCH|REQUEST_CONFIG_MISMATCH/u,
    );
  }
});

test("rehashed mapped text must still match the preserved raw SRT", async () => {
  const f = await fixture();
  await registeredEdit(f, "mapped-records.json", (mapped) => {
    mapped.records[0].text = "別の文字列";
  });
  await assert.rejects(
    auditBoundedEvidence(f.task, { outputRoot: f.outputRoot }),
    // Baseline freshness rejects tampering before the raw mapped-text binding.
    /CONTENT_RECOVERY_BASELINE_CHANGED/u,
  );
});

test("rehashed request arguments remain bound to one input/output attempt without duplicate flags", async () => {
  for (const edit of [
    (r) => {
      r.args[r.args.indexOf("--file") + 1] = "/different-attempt/input.wav";
    },
    (r) => {
      r.args[r.args.indexOf("--output-file") + 1] =
        "/different-attempt/response";
    },
    (r) => {
      r.args.push("--language", "ja");
    },
  ]) {
    const f = await fixture();
    await registeredEdit(f, "requests/chunk-0001-attempt-1/request.json", edit);
    await assert.rejects(
      auditBoundedEvidence(f.task, { outputRoot: f.outputRoot }),
      /REQUEST_IO_BINDING_MISMATCH|REQUEST_FLAG_BINDING_MISMATCH/u,
    );
  }
});

test("rehashed inconsistent JSON/SRT is exposed as invalid evidence, never acoustic timing", async () => {
  const f = await fixture();
  await registeredEdit(
    f,
    "requests/chunk-0001-attempt-1/raw-response.json",
    (body) => {
      body.transcription[0].text = "別の文字列";
    },
  );
  const artifact = await json(
      (await auditBoundedEvidence(f.task, { outputRoot: f.outputRoot })).report,
    ),
    row = artifact.requests[0].rows[0];
  assert.ok(row.issues.includes("JSON_SRT_BINDING_MISMATCH"));
  assert.equal(row.provenance.validated, false);
  assert.equal(row.provenance.timingVerified, false);
  assert.equal(artifact.canAutoRetime, false);
});

test("modified delivered audit is not overwritten on replay", async () => {
  const f = await fixture(),
    result = await auditBoundedEvidence(f.task, { outputRoot: f.outputRoot });
  await fs.appendFile(result.report, "user addition");
  await assert.rejects(
    auditBoundedEvidence(f.task, { outputRoot: f.outputRoot }),
    /EVIDENCE_AUDIT_ARTIFACT_CHANGED/u,
  );
  assert.ok(
    (await fs.readFile(result.report, "utf8")).endsWith("user addition"),
  );
});
