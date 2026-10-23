import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Buffer } from "node:buffer";
import {
  prepareOnsetRun,
  runOnset,
} from "../scripts/subtitle-tool-timing-onset.mjs";

test("invalid alignment heads block before artifacts, reservations or any native model import", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "onset-preflight-test-"),
  );
  try {
    const u32 = (n) => {
      const b = Buffer.alloc(4);
      b.writeUInt32LE(n);
      return b;
    };
    const str = (s) => {
      const b = Buffer.from(s + "\0");
      const n = Buffer.alloc(2);
      n.writeUInt16LE(b.length);
      return Buffer.concat([n, b]);
    };
    const variable = (name, type, data) =>
      Buffer.concat([
        str(name),
        Buffer.from([0, type]),
        u32(data.length),
        data,
      ]);
    const headCount = Buffer.alloc(2);
    headCount.writeInt16LE(20);
    await fs.writeFile(
      path.join(root, "model.bin"),
      Buffer.concat([
        u32(6),
        str("WhisperSpec"),
        u32(3),
        u32(3),
        variable("decoder/num_heads", 2, headCount),
        variable("decoder/layer_0/test", 0, Buffer.alloc(4)),
        variable("decoder/layer_1/test", 0, Buffer.alloc(4)),
        u32(0),
      ]),
    );
    await fs.writeFile(
      path.join(root, "config.json"),
      JSON.stringify({ alignment_heads: [[25, 6]] }),
    );
    const spec = path.join(root, "spec.json");
    await fs.writeFile(
      spec,
      JSON.stringify({
        runtime: {
          python: process.env.SUBTITLE_PYTHON ?? "python3",
          kotobaModel: root,
        },
        parent: "intentionally-absent",
      }),
    );
    const out = path.join(root, "output");
    await assert.rejects(
      prepareOnsetRun(spec, out),
      /WORD_TIMING_RUNTIME_UNSUPPORTED.*decoderLayers.*invalidAlignmentHeads/s,
    );
    await assert.rejects(fs.access(out));
    assert.deepEqual((await fs.readdir(root)).sort(), [
      "config.json",
      "model.bin",
      "spec.json",
    ]);
  } finally {
    await fs.rm(root, { recursive: true });
  }
});

test("unauthorized run rejects before input or model work", async () => {
  await assert.rejects(
    runOnset("intentionally-absent", false),
    /EXPLICIT_LOCAL_AUTHORIZATION_REQUIRED/,
  );
});
