/** Fixed-policy PCM-only diagnostic; no model dispatch or subtitle writeback. */
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { safePath } from "../packages/video-subtitler/dist/standalone/recovery.js";
import { readPcm, slicePcm } from "./lib/bounded-asr-ab.mjs";
import { verifyExtent } from "./subtitle-tool-utterance-extent.mjs";

const repo = path.resolve(import.meta.dirname, "..");
const json = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const put = (p, v) =>
  fs.writeFile(p, JSON.stringify(v, null, 2) + "\n", { flag: "wx" });
const run = promisify(execFile);
async function compute(root, plan) {
  for (const b of plan.bindings)
    assert.equal(await fileHash(b.file), b.sha256, `CHANGED:${b.file}`);
  const { stdout } = await run(
    plan.python,
    [
      path.join(repo, "scripts/runtime/vowel_tail_probe.py"),
      path.join(root, "plan.json"),
    ],
    {
      timeout: 30000,
      maxBuffer: 2 ** 20,
      env: {
        PATH: "/usr/bin:/bin",
        PYTHONNOUSERSITE: "1",
        PYTHONDONTWRITEBYTECODE: "1",
      },
    },
  );
  return JSON.parse(stdout);
}
export async function runTail(parent, python, output) {
  parent = await fs.realpath(parent);
  python = path.resolve(python);
  output = path.resolve(output);
  await safePath(output, true);
  assert(output !== parent && !output.startsWith(parent + path.sep));
  await verifyExtent(parent);
  const p = await json(path.join(parent, "plan.json"));
  const r = await json(path.join(parent, "result.json"));
  const windows = p.windows.map((w) => {
    const word = r.results.find((v) => v.id === w.id);
    assert.equal(word.intervals.length, 1);
    const interval = word.intervals[0];
    return {
      ...w,
      wav: path.join(parent, w.id, "input.wav"),
      seed: [interval.start, interval.end],
    };
  });
  assert.equal(windows.length, 2);
  const files = [
    python,
    p.audio,
    path.join(parent, "machine-freeze.json"),
    path.join(parent, "plan.json"),
    path.join(parent, "result.json"),
    path.join(parent, "preserved.machine-candidate.srt"),
    ...[
      "scripts/subtitle-tool-vowel-tail.mjs",
      "scripts/runtime/vowel_tail_probe.py",
      "scripts/runtime/occurrence_tail.py",
      "scripts/lib/bounded-asr-ab.mjs",
    ].map((n) => path.join(repo, n)),
  ];
  const bindings = await Promise.all(
    files.map(async (file) => ({ file, sha256: await fileHash(file) })),
  );
  await fs.mkdir(output, { recursive: true });
  const root = await fs.mkdtemp(path.join(output, "tail-"));
  const plan = {
    parent,
    python,
    windows,
    bindings,
    referenceUsed: false,
    newModelBudget: 0,
  };
  await put(path.join(root, "plan.json"), plan);
  await put(path.join(root, "plan-freeze.json"), {
    sha256: await fileHash(path.join(root, "plan.json")),
  });
  const result = await compute(root, plan);
  await put(path.join(root, "result.json"), result);
  const pcm = readPcm(await fs.readFile(p.audio));
  const crop = windows.find((w) => w.id === "expanded");
  const clips = [
    {
      file: "context.wav",
      start: crop.start,
      end: crop.end,
      meaning: "Full frozen expanded context",
    },
    {
      file: "post-mfa-tail.wav",
      start: Math.max(...r.results.map((v) => v.intervals[0].sourceEnd)),
      end: crop.end,
      meaning: "After both MFA endpoints; not a confirmed speech interval",
    },
  ];
  for (const c of clips) {
    c.startFrame = Math.round(c.start * pcm.sampleRate);
    c.endFrame = Math.round(c.end * pcm.sampleRate);
    await fs.writeFile(
      path.join(root, c.file),
      slicePcm(pcm, c.startFrame, c.endFrame),
      { flag: "wx" },
    );
    c.sha256 = await fileHash(path.join(root, c.file));
  }
  await put(path.join(root, "listening-clips.json"), {
    sourceAudio: p.audio,
    clips,
  });
  await fs.copyFile(
    path.join(parent, "preserved.machine-candidate.srt"),
    path.join(root, "preserved.machine-candidate.srt"),
    fs.constants.COPYFILE_EXCL,
  );
  const frozen = {};
  for (const n of await fs.readdir(root))
    frozen[n] = await fileHash(path.join(root, n));
  await put(path.join(root, "machine-freeze.json"), { files: frozen });
  return {
    root,
    windows: result.windows.map(
      ({ id, status, sourceCandidates, sourceSelectedEnd }) => ({
        id,
        status,
        sourceCandidates,
        sourceSelectedEnd,
      }),
    ),
    newModelCalls: 0,
  };
}
export async function verifyTail(root) {
  const frozen = await json(path.join(root, "machine-freeze.json"));
  for (const [n, h] of Object.entries(frozen.files)) {
    assert.equal(path.basename(n), n);
    await safePath(path.join(root, n));
    assert.equal(await fileHash(path.join(root, n)), h, `CHANGED:${n}`);
  }
  const p = await json(path.join(root, "plan.json"));
  assert.equal(
    await fileHash(path.join(root, "plan.json")),
    (await json(path.join(root, "plan-freeze.json"))).sha256,
  );
  await verifyExtent(p.parent);
  assert.deepEqual(
    await compute(root, p),
    await json(path.join(root, "result.json")),
  );
  assert.equal(
    await fileHash(path.join(root, "preserved.machine-candidate.srt")),
    await fileHash(path.join(p.parent, "preserved.machine-candidate.srt")),
  );
  const delivery = await json(path.join(root, "listening-clips.json"));
  const pcm = readPcm(await fs.readFile(delivery.sourceAudio));
  for (const c of delivery.clips)
    assert.deepEqual(
      await fs.readFile(path.join(root, c.file)),
      slicePcm(pcm, c.startFrame, c.endFrame),
    );
  return {
    root,
    integrity: "passed",
    sourceExactClips: delivery.clips.length,
    newModelCalls: 0,
    subtitleMutations: 0,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === "run")
    console.log(JSON.stringify(await runTail(...args), null, 2));
  else if (cmd === "verify")
    console.log(JSON.stringify(await verifyTail(...args), null, 2));
  else throw Error("run PARENT PYTHON OUTPUT | verify ROOT");
}
