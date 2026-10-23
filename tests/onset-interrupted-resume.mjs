import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { inspectInterruptedOnset } from "../scripts/lib/onset-interrupted-resume.mjs";
const hash = (s) => createHash("sha256").update(s).digest("hex");
async function fixture(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "onset-resume-test-"));
  const put = (n, v) =>
    fs.writeFile(
      path.join(root, n),
      typeof v === "string" ? v : JSON.stringify(v),
    );
  try {
    const t = {
      id: "cue-1",
      recordId: "a",
      text: "今日は晴れです",
      oldStart: 10,
      oldEnd: 16,
      start: 9.5,
      end: 16.5,
      firstFrame: 152000,
      endFrame: 264000,
    };
    await fs.mkdir(path.join(root, t.id));
    await put("cue-1/input.wav", "test-only-pcm-binding");
    const p = {
      runtime: { asrModel: await fs.realpath(root) },
      planned: {
        targets: [{ ...t, audioHash: hash("test-only-pcm-binding") }],
      },
      inputs: [],
      identities: [],
      software: [],
    };
    await put("plan.json", p);
    await put("plan-freeze.json", { planHash: hash(JSON.stringify(p)) });
    await put("exit.json", { exitCode: null, signal: "SIGSEGV" });
    await put(
      "stderr.log",
      "whisper_vad_detect_speech_no_reset: detecting speech",
    );
    await put("cue-1/reserved.json", { asr: 1, vad: 1 });
    const asr = {
      language: "ja",
      segments: [
        {
          text: "違う内容",
          words: [{ word: "違う内容", start: 3, end: 5, probability: 0.9 }],
        },
      ],
    };
    await put("cue-1/asr.json", asr);
    await fn({ root, t, put, asr });
  } finally {
    await fs.rm(root, { recursive: true });
  }
}
test("saved conflicting ASR is reused for abstention, not re-inferred", () =>
  fixture(async ({ root, t }) => {
    const v = await inspectInterruptedOnset(root, [t], root);
    assert.equal(v.reuse.length, 1);
    assert.equal(v.reuse[0].expectedReason, "NO_UNIQUE_EXACT_WHOLE_WORD_TEXT");
    assert.equal(v.priorAsrAttempts, 1);
    assert.equal(v.priorVadAttempts, 1);
  }));
test("resume refuses a different audio occurrence", () =>
  fixture(async ({ root, t }) => {
    await assert.rejects(
      inspectInterruptedOnset(root, [{ ...t, firstFrame: 0 }], root),
      /RESUME_TARGET_CHANGED/,
    );
  }));
test("saved matching text cannot silently skip its missing VAD", () =>
  fixture(async ({ root, t, put, asr }) => {
    asr.segments[0].text = t.text;
    asr.segments[0].words[0].word = t.text;
    await put("cue-1/asr.json", asr);
    await assert.rejects(inspectInterruptedOnset(root, [t], root));
  }));
test("completed raw result cannot be misreported as a crashed request", () =>
  fixture(async ({ root, t, put }) => {
    await put("cue-1/raw.json", {});
    await assert.rejects(inspectInterruptedOnset(root, [t], root));
  }));
