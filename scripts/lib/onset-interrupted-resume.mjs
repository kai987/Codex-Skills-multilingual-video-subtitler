/** Only resume untouched requests; an incompatible saved transcript must abstain. */
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { fileHash } from "../../packages/video-subtitler/dist/standalone/tool.js";
import { decideOnset } from "./timing-onset-recovery.mjs";
export async function inspectInterruptedOnset(root, targets, model) {
  if (!root)
    return {
      reuse: [],
      bindings: [],
      priorAsrAttempts: 0,
      priorVadAttempts: 0,
    };
  const read = async (n) =>
    JSON.parse(await fs.readFile(path.join(root, n), "utf8"));
  const p = await read("plan.json");
  assert.equal(
    await fileHash(path.join(root, "plan.json")),
    (await read("plan-freeze.json")).planHash,
  );
  assert.deepEqual(await read("exit.json"), {
    exitCode: null,
    signal: "SIGSEGV",
  });
  assert.equal(await fs.realpath(model), p.runtime.asrModel);
  assert.equal(targets.length, p.planned.targets.length);
  for (const b of [...p.inputs, ...p.identities])
    assert.equal(await fileHash(b.file), b.sha256);
  for (const b of p.software)
    assert.equal(
      await fileHash(
        path.join(root, "execution-source-snapshot", path.basename(b.file)),
      ),
      b.sha256,
    );
  const reuse = [],
    names = ["plan.json", "plan-freeze.json", "exit.json", "stderr.log"];
  for (const t of targets) {
    const old = p.planned.targets.find((v) => v.id === t.id);
    assert(old, "RESUME_TARGET_CHANGED");
    for (const key of [
      "recordId",
      "text",
      "oldStart",
      "oldEnd",
      "firstFrame",
      "endFrame",
    ])
      assert.equal(t[key], old[key], "RESUME_TARGET_CHANGED");
    assert.equal(
      await fileHash(path.join(root, t.id, "input.wav")),
      old.audioHash,
    );
    const entries = await fs.readdir(path.join(root, t.id));
    if (entries.includes("asr.json")) {
      assert(
        entries.includes("reserved.json") && !entries.includes("raw.json"),
      );
      const asr = await read(t.id + "/asr.json");
      const decision = decideOnset(t, {
        id: t.id,
        frames: t.endFrame - t.firstFrame,
        ...asr,
        vad: null,
      });
      assert.equal(
        decision.reason,
        "NO_UNIQUE_EXACT_WHOLE_WORD_TEXT",
        "REUSE_REQUIRES_LEXICAL_ABSTENTION_NO_VAD_RETRY",
      );
      const source = path.join(root, t.id, "asr.json");
      reuse.push({
        id: t.id,
        source,
        sha256: await fileHash(source),
        expectedReason: decision.reason,
      });
      names.push(
        t.id + "/asr.json",
        t.id + "/reserved.json",
        t.id + "/input.wav",
      );
    } else
      assert.deepEqual(entries, ["input.wav"], "ALREADY_DISPATCHED_TARGET");
  }
  assert.equal(reuse.length, 1, "ONLY_ONE_INTERRUPTED_REQUEST_ALLOWED");
  const log = await fs.readFile(path.join(root, "stderr.log"), "utf8");
  assert(log.includes("whisper_vad_detect_speech_no_reset: detecting speech"));
  return {
    reuse,
    priorAsrAttempts: 1,
    priorVadAttempts: 1,
    bindings: await Promise.all(
      names.map(async (n) => ({
        file: path.join(root, n),
        sha256: await fileHash(path.join(root, n)),
      })),
    ),
  };
}
