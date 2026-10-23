import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";
import {
  auditWave,
  objectHash,
} from "../../packages/video-subtitler/src/machine-quality/reazon-runtime-audit.js";

it("actual project worker creates twelve separate stub streams; never imports native ASR", () => {
  const output = execFileSync(
    "/usr/bin/sandbox-exec",
    [
      "-p",
      "(version 1)(allow default)(deny network*)",
      "/Library/Frameworks/Python.framework/Versions/3.13/bin/python3.13",
      "-S",
      "tests/helpers/c601181_worker_stub.py",
    ],
    { encoding: "utf8" },
  );
  expect(output).toContain('"stubStreams": 12');
  expect(output).toContain('"nativeAcousticValidation": false');
});

it("offline CLI binds twelve neutral artifacts under no-addon/no-child permissions", () => {
  const temp = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "c601181-neutral-")),
  );
  const root = path.join(temp, "completed"),
    failed = path.join(temp, "failed"),
    sources = path.join(temp, "sources"),
    out = path.join(temp, "out");
  for (const p of [root, failed, sources, out]) fs.mkdirSync(p);
  const write = (p: string, v: unknown) => {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(
      p,
      typeof v === "string" || Buffer.isBuffer(v) ? v : JSON.stringify(v),
    );
  };
  const hash = (b: Buffer | string) =>
    createHash("sha256").update(b).digest("hex");
  const wave = Buffer.alloc(46);
  wave.write("RIFF");
  wave.writeUInt32LE(38, 4);
  wave.write("WAVEfmt ", 8);
  wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20);
  wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(16000, 24);
  wave.writeUInt32LE(32000, 28);
  wave.writeUInt16LE(2, 32);
  wave.writeUInt16LE(16, 34);
  wave.write("data", 36);
  wave.writeUInt32LE(2, 40);
  const audio = auditWave(wave),
    units = Array.from({ length: 12 }, (_, i) => ({
      id: `unit-neutral-${i}`,
      audio: `audio/unit-neutral-${i}.wav`,
      ...audio,
      sourceOffset: 10,
      audioHash: audio.wavHash,
    }));
  const token = "<blk> 0\n<unk> 1\na 2\n",
    modelFiles = [
      {
        fileName: "tokens.txt",
        size: Buffer.byteLength(token),
        sha256: hash(token),
      },
    ];
  const model = { modelRevision: "neutral-revision", modelFiles },
    plan = {
      units,
      logicalTasks: 12,
      model,
      identityFiles: [],
      runtimePythonHash: hash("not-executable"),
    };
  write(path.join(root, "request-plan.json"), plan);
  write(path.join(failed, "request-plan.json"), plan);
  write(path.join(root, "model-input-freeze.json"), {
    files: { "request-plan.json": hash(JSON.stringify(plan)) },
  });
  write(path.join(root, "python"), "not-executable");
  write(path.join(root, "models/tokens.txt"), token);
  write(path.join(root, "runtime.local-only.json"), {
    reazonPython: path.join(root, "python"),
    reazonModel: path.join(root, "models"),
  });
  write(path.join(root, "execution-ledger.json"), {
    planHash: objectHash(plan),
    actualRecognitionAttempts: 12,
    acousticForwards: 12,
  });
  write(path.join(failed, "execution-ledger.json"), {
    actualRecognitionAttempts: 0,
    acousticForwards: 0,
  });
  write(path.join(sources, "pins.json"), { fbank: "a".repeat(40) });
  write(path.join(sources, "network-receipt.json"), []);
  write(path.join(sources, "model-revision.json"), {
    sha: "neutral-revision",
    siblings: [
      {
        rfilename: "tokens.txt",
        blobId: createHash("sha1")
          .update(`blob ${Buffer.byteLength(token)}\0`)
          .update(token)
          .digest("hex"),
      },
    ],
  });
  const stdout: unknown[] = [];
  for (const u of units) {
    write(path.join(root, u.audio), wave);
    const f = {
      type: "forward-start",
      requestId: u.id,
      sampleCount: audio.sampleCount,
      paddedSampleCount: audio.paddedSampleCount,
      decodedFloat32Hash: audio.decodedFloat32Hash,
    };
    const response = {
      type: "result",
      requestId: u.id,
      status: "SUCCESS_NONEMPTY",
      result: {
        text: "  neutral repeated repeated 🙂 ",
        tokens: ["  neutral repeated repeated 🙂 "],
        timestamps: [0],
      },
      rawResponseComplete: true,
      acousticForwardAttempted: true,
      rawSampleCount: audio.sampleCount,
      paddedSampleCount: audio.paddedSampleCount,
      wallSeconds: 0,
      peakRssBytes: 0,
    };
    const binding = {
      unitId: u.id,
      planHash: objectHash(plan),
      audioHash: audio.wavHash,
      pcmHash: audio.pcmHash,
      model,
      responseHash: objectHash(response),
      response,
    };
    const base = path.join(root, "attempts", u.id + "-attempt-0");
    write(base + ".reserved.json", {
      unitId: u.id,
      attemptId: u.id + "-attempt-0",
      planHash: objectHash(plan),
    });
    write(base + ".request.json", {
      type: "transcribe",
      requestId: u.id,
      audioPath: path.join(root, u.audio),
      maximumPaddedSeconds: 32,
    });
    write(base + ".response.json", response);
    write(base + ".forward.json", f);
    stdout.push(f, response);
    write(
      path.join(root, "evidence/reazon-same-unit", u.id + ".json"),
      binding,
    );
    for (const r of ["run-a", "run-b"]) {
      const d = path.join(root, r, u.id, "R0-second-asr-transcript");
      write(path.join(d, "transcript.json"), {
        ...binding,
        text: response.result.text,
      });
      write(path.join(d, "transcript.txt"), response.result.text);
      write(path.join(d, "raw-response.json"), response);
    }
    write(
      path.join(root, "run-a", u.id, "W0-primary-transcript/transcript.json"),
      { text: "neutral" },
    );
  }
  write(
    path.join(root, "attempts/session-0.stdout.jsonl"),
    stdout.map((x) => JSON.stringify(x)).join("\n"),
  );
  const repo = process.cwd(),
    before = hash(fs.readFileSync(path.join(root, "request-plan.json")));
  const result = execFileSync(
    "/usr/bin/sandbox-exec",
    [
      "-p",
      "(version 1)(allow default)(deny network*)",
      process.execPath,
      "--permission",
      `--allow-fs-read=${repo}/scripts`,
      `--allow-fs-read=${repo}/packages/video-subtitler/dist/machine-quality`,
      `--allow-fs-read=${repo}/node_modules`,
      `--allow-fs-read=${temp}`,
      `--allow-fs-write=${out}`,
      "scripts/audit-c601181.mjs",
      root,
      failed,
      out,
      sources,
    ],
    { encoding: "utf8" },
  );
  expect(result).toContain('"textChainPassed": 12');
  expect(result).toContain('"newProviderStarts": 0');
  expect(hash(fs.readFileSync(path.join(root, "request-plan.json")))).toBe(
    before,
  );
  expect(fs.readdirSync(out)).toHaveLength(1);
});
