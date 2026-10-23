/** Clean install plus real ffmpeg plumbing; ASR is explicitly a synthetic test double. */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
const candidate = path.resolve(process.argv[2] ?? "");
if (!process.argv[2])
  throw Error(
    "用法：node scripts/validate-subtitle-tool-candidate.mjs /path/candidate",
  );
const work = await fs.mkdtemp(
  path.join(os.tmpdir(), "subtitle-clean-candidate-"),
);
const results = [];
async function run(name, cmd, args) {
  const startedAt = new Date().toISOString();
  try {
    const r = await exec(cmd, args, {
      cwd: candidate,
      env: process.env,
      maxBuffer: 5 * 1024 * 1024,
    });
    await fs.writeFile(path.join(work, name + ".log"), r.stdout + r.stderr);
    results.push({ name, passed: true, startedAt });
    return r;
  } catch (e) {
    await fs.writeFile(path.join(work, name + ".log"), String(e));
    throw e;
  }
}
await run("install", "npm", ["ci", "--offline"]);
await run("targeted-build", "npm", ["run", "build:subtitle-tool"]);
const stub = path.join(work, "stub-whisper"),
  model = path.join(work, "stub-model.bin"),
  audio = path.join(work, "日本語 音声.wav"),
  config = path.join(work, "config.json"),
  output = path.join(work, "tasks");
await fs.writeFile(
  stub,
  `#!${process.execPath}\nimport fs from 'node:fs';const a=process.argv.slice(2);if(a.includes('--help')){console.log('--output-srt');process.exit(0);}fs.writeFileSync(a[a.indexOf('--output-file')+1]+'.srt','1\\n00:00:00,100 --> 00:00:01,800\\nこれはテストです。\\n');console.error('whisper_init_from_file_with_params: loading model');`,
);
await fs.chmod(stub, 0o755);
await fs.writeFile(model, "synthetic model marker");
await run("media", "ffmpeg", [
  "-v",
  "error",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=440:duration=2",
  "-ar",
  "16000",
  audio,
]);
const cli = (name, args) =>
  run(name, "npm", ["run", "subtitle-tool", "--", ...args]);
await cli("help", []);
await cli("configure", [
  "configure",
  "--config",
  config,
  "--model",
  model,
  "--runtime",
  stub,
]);
await cli("doctor", ["doctor", "--config", config, "--input", audio]);
await cli("generate", [
  "generate",
  "--config",
  config,
  "--input",
  audio,
  "--output-root",
  output,
]);
const tasks = await fs.readdir(output);
if (tasks.length !== 1) throw Error("Task collision");
const task = path.join(output, tasks[0]);
await cli("status", ["status", "--task", task]);
await cli("g11", ["resume", "--task", task, "--profile", "g11"]);
await cli("resume", ["resume", "--task", task]);
const manifest = JSON.parse(
  await fs.readFile(path.join(task, "task.json"), "utf8"),
);
if (
  manifest.executionStatus !== "completed" ||
  manifest.artifactIntegrity !== "passed" ||
  manifest.attempts.length !== 1 ||
  manifest.cacheHits !== 2 ||
  Object.keys(manifest.outputs).length !== 6
)
  throw Error("Candidate closure failed");
await fs.access(path.join(task, "OUTPUT_INDEX.md"));
await fs.writeFile(
  path.join(work, "validation.json"),
  JSON.stringify(
    {
      candidate,
      work,
      realModelInference: 0,
      ASR: "EXPLICIT_TEST_DOUBLE",
      media: "SYNTHETIC_FULL_AUDIO",
      results,
      task,
      manifest,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    passed: true,
    work,
    checks: results.length,
    realModelInference: 0,
  }),
);
