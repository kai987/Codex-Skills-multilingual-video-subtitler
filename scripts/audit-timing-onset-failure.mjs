/** Preserve failed execution evidence. Does not dispatch any model or edit subtitles. */
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
const [root, crashFile] = process.argv.slice(2);
const read = async (name) =>
  JSON.parse(await fs.readFile(path.join(root, name), "utf8"));
const p = await read("plan.json");
assert.equal(
  await fileHash(path.join(root, "plan.json")),
  (await read("plan-freeze.json")).planHash,
);
const snapshots = [];
for (const b of p.software) {
  const snapshot = path.join(
    root,
    "execution-source-snapshot",
    path.basename(b.file),
  );
  assert.equal(await fileHash(snapshot), b.sha256);
  snapshots.push({ original: b.file, snapshot, sha256: b.sha256 });
}
for (const b of [...p.inputs, ...p.identities])
  assert.equal(await fileHash(b.file), b.sha256);
assert.deepEqual(await read("exit.json"), {
  exitCode: null,
  signal: "SIGSEGV",
});
const crashText = await fs.readFile(crashFile, "utf8");
const crash = JSON.parse(crashText.slice(crashText.indexOf("\n") + 1));
assert.equal(crash.exception.signal, "SIGSEGV");
const frames = crash.threads[crash.faultingThread].frames.map((f) => ({
  symbol: f.symbol,
  image: crash.usedImages[f.imageIndex]?.name,
}));
assert(frames[0].symbol.includes("TransformerDecoder::set_alignment_heads"));
const program = path.join(
  import.meta.dirname,
  "runtime/ct2_timing_contract.py",
);
const inspect = spawnSync(p.runtime.python, [program, p.runtime.kotobaModel], {
  encoding: "utf8",
  timeout: 10000,
});
assert.equal(inspect.status, 2, inspect.stderr);
const contract = JSON.parse(inspect.stdout);
const targets = [];
for (const t of p.planned.targets) {
  const entries = await fs.readdir(path.join(root, t.id));
  assert(!entries.includes("raw.json") && !entries.includes("asr.json"));
  assert.equal(await fileHash(path.join(root, t.id, "input.wav")), t.audioHash);
  targets.push({
    id: t.id,
    status: entries.includes("reserved.json")
      ? "ASR_CRASHED_BEFORE_RESULT"
      : "NOT_DISPATCHED",
  });
}
assert.equal(
  targets.filter((t) => t.status === "ASR_CRASHED_BEFORE_RESULT").length,
  1,
);
assert(!(await fs.readdir(root)).includes("machine-freeze.json"));
const result = {
  status: "blocked-word-timing-runtime-contract",
  targets,
  contract,
  frames,
  modelRuntime: await read("runtime.json"),
  plannedAsrPasses: 4,
  plannedVadPasses: 4,
  asrAttempted: 1,
  asrCompleted: 0,
  vadAttempted: 0,
  retries: 0,
  inferenceCountBasis:
    "reservation plus frozen worker sequence and native alignment crash; no result persisted",
  changedCues: 0,
  textMutations: 0,
  timingMutations: 0,
  newQualityEvaluation: false,
  automaticPromotionAllowed: false,
  sourceSnapshots: snapshots,
  crashSource: { file: crashFile, sha256: await fileHash(crashFile) },
  contractChecker: { file: program, sha256: await fileHash(program) },
  baselineRetained: p.parent,
  nextStep:
    "Use a validated word-timing-capable runtime; do not invent alignment heads or loosen evidence thresholds.",
};
await fs.writeFile(
  path.join(root, "failure-audit.json"),
  JSON.stringify(result, null, 2) + "\n",
  { flag: "wx" },
);
console.log(JSON.stringify(result, null, 2));
