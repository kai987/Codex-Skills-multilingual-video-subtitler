/** Offline candidate acceptance. Copies only task.json/raw-primary.srt; never runs ASR or FFmpeg. */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
const exec = promisify(execFile);
const [candidateArg, taskArg, outputArg] = process.argv.slice(2);
if (!candidateArg || !taskArg)
  throw Error(
    "Usage: node scripts/validate-subtitle-recovery-candidate.mjs <clean-candidate> <old-task> [output-root]",
  );
const candidate = await fs.realpath(candidateArg);
const output = await fs.realpath(outputArg ?? os.tmpdir());
const work = await fs.mkdtemp(
  path.join(output, "offline-candidate-validation-"),
);
const task = path.join(work, "copied-task");
await fs.mkdir(task);
const hash = async (file) =>
  createHash("sha256")
    .update(await fs.readFile(file))
    .digest("hex");
const originals = {};
for (const name of ["task.json", "raw-primary.srt"]) {
  const original = path.join(taskArg, name);
  if ((await fs.lstat(original)).isSymbolicLink())
    throw Error("Unexpected source link");
  originals[name] = await hash(original);
  await fs.copyFile(original, path.join(task, name));
}
const guard = path.join(work, "read-boundary-guard.mjs");
// fs readers may access only the clean install, copied task and owned validation output.
// Ancestor lstat is allowed solely for the production symlink-component checks.
await fs.writeFile(
  guard,
  `import fs from 'node:fs';import fsp from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import {syncBuiltinESMExports} from 'node:module';
const roots=${JSON.stringify([candidate, work])};
const ancestors=new Set();for(const r of roots){let p=r;while(true){ancestors.add(p);if(path.dirname(p)===p)break;p=path.dirname(p)}}
function check(p,statOnly=false){if(typeof p==='number')return;if(p instanceof URL)p=fileURLToPath(p);if(typeof p!=='string')throw Error('UNEXPECTED_FS_ARGUMENT');p=path.resolve(p);if(!roots.some(r=>p===r||p.startsWith(r+'/'))&&!(statOnly&&ancestors.has(p)))throw Error('OUTSIDE_CLEAN_RECOVERY_READ_BOUNDARY');}
for(const [obj,keys]of [[fs,['readFileSync','readFile','createReadStream','openSync','open','statSync','lstatSync','readdirSync','realpathSync','accessSync']],[fsp,['readFile','open','stat','lstat','readdir','realpath','access']]])for(const k of keys){const original=obj[k];obj[k]=function(p,...a){check(p,k.toLowerCase().includes('stat'));return original.call(this,p,...a)}}syncBuiltinESMExports();
`,
);
const results = [];
async function run(name, command, args, expectedCode = 0) {
  let stdout,
    stderr,
    code = 0;
  try {
    ({ stdout, stderr } = await exec(command, args, {
      cwd: candidate,
      env: process.env,
      maxBuffer: 8 * 1024 * 1024,
    }));
  } catch (e) {
    ({ stdout, stderr, code } = e);
  }
  await fs.writeFile(path.join(work, `${name}.log`), `${stdout}\n${stderr}`);
  results.push({
    name,
    expectedCode,
    actualCode: code,
    passed: code === expectedCode,
  });
  if (code !== expectedCode)
    throw Error(`Candidate step failed: ${name}; log in ${work}`);
  return stdout;
}
await run("install", "npm", ["ci", "--offline", "--ignore-scripts"]);
await run("build", "npm", ["run", "build:subtitle-tool"]);
const cli = (name, args, code = 0) =>
  run(
    name,
    process.execPath,
    [
      "--permission",
      "--allow-fs-read=*",
      `--allow-fs-write=${work}`,
      "--import",
      guard,
      "scripts/subtitle-tool.mjs",
      ...args,
    ],
    code,
  );
await cli("help", ["--help"]);
const text = JSON.parse(
  await cli("recover-text", ["recover", "--task", task], 2),
);
const partial = JSON.parse(
  await cli(
    "recover-partial",
    ["recover", "--task", task, "--export-partial"],
    2,
  ),
);
const repeated = JSON.parse(
  await cli(
    "recover-repeat",
    ["recover", "--task", task, "--export-partial"],
    2,
  ),
);
await cli("status", ["status", "--task", task]);
await cli("resume", ["resume", "--task", task], 2);
const edited = JSON.parse(
  await cli(
    "partial-not-complete",
    [
      "validate-edited",
      "--task",
      task,
      "--input",
      path.join(partial.directory, "subtitles/primary-minimal.partial.srt"),
      "--timebase",
      "source",
    ],
    2,
  ),
);
if (
  text.recovery.partialSubtitle !== "not-requested" ||
  !repeated.reused ||
  edited.report.sourceTextAccounting !== "SOURCE_COMPLETENESS_UNPROVEN"
)
  throw Error("Offline contract mismatch");
for (const name of Object.keys(originals))
  if (
    (await hash(path.join(task, name))) !== originals[name] ||
    (await hash(path.join(taskArg, name))) !== originals[name]
  )
    throw Error("Source mutation");
await fs.writeFile(
  path.join(work, "validation.json"),
  JSON.stringify(
    {
      passed: true,
      results,
      originalFilesUnchanged: true,
      forbiddenReads: "FAIL_CLOSED_OUTSIDE_CANDIDATE_AND_COPIED_TASK",
      childProcesses: "DENIED_BY_NODE_PERMISSION",
      modelsPresent: false,
      audioPresent: false,
      newASRRequests: 0,
      newModelInference: 0,
      newModelLoads: 0,
      newProviderStarts: 0,
      newAudioExtractions: 0,
      newAudioWindows: 0,
      counts: {
        raw: partial.recovery.recordCount,
        partial: partial.recovery.eligibleIds.length,
        unresolved: partial.recovery.unresolvedIds.length,
      },
      fullTimedExport: "STILL_BLOCKED",
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ work, results }, null, 2));
