/** Bounded MFA word extent for one frozen machine-consensus occurrence. */
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout, clearTimeout } from "node:timers";
import { pathToFileURL } from "node:url";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { safePath } from "../packages/video-subtitler/dist/standalone/recovery.js";
import { readPcm, slicePcm } from "./lib/bounded-asr-ab.mjs";
import { verifyAssociation } from "./subtitle-tool-utterance-association.mjs";
import { planExtent, analyzeExtent } from "./lib/utterance-extent.mjs";

const repo = path.resolve(import.meta.dirname, "..");
const json = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const put = (p, v) =>
  fs.writeFile(p, JSON.stringify(v, null, 2) + "\n", { flag: "wx" });
const bind = async (file) => ({
  file: await fs.realpath(file),
  sha256: await fileHash(file),
});
async function source(root) {
  await verifyAssociation(root);
  const association = await json(path.join(root, "plan.json"));
  const parent = await json(path.join(association.sourceRoot, "plan.json"));
  const prior = await json(path.join(root, "result.json"));
  return {
    prior,
    baseline: parent.baseline,
    sourceRoot: association.sourceRoot,
    audio: path.join(parent.spec.task, "audio.wav"),
    selected: planExtent(prior, parent.baseline),
  };
}
export async function prepareExtent(parent, spec, output) {
  parent = await fs.realpath(parent);
  output = path.resolve(output);
  await safePath(output, true);
  assert(
    output !== parent && !output.startsWith(parent + path.sep),
    "OUTPUT_INSIDE_INPUT",
  );
  const s = await source(parent),
    manifest = await json(spec.manifest);
  assert.equal(manifest.mfaVersion, "3.4.2");
  assert.equal(manifest.commandCapabilities.alignOneCommand, "align_one");
  assert.equal(await fileHash(spec.acoustic), manifest.acousticModel.sha256);
  assert.equal(
    await fileHash(spec.dictionary),
    manifest.dictionaryModel.sha256,
  );
  // This route accepts exactly one directly attested dictionary word. No guessed reading/G2P.
  const entries = (await fs.readFile(spec.dictionary, "utf8"))
    .split(/\r?\n/u)
    .filter((l) => l.split(/\s/u)[0] === s.selected.text);
  assert(entries.length > 0, "EXACT_DICTIONARY_WORD_REQUIRED");
  const files = [
    spec.manifest,
    spec.mfa,
    spec.python,
    spec.acoustic,
    spec.dictionary,
    s.audio,
    path.join(parent, "machine-freeze.json"),
    path.join(parent, "result.json"),
    path.join(parent, "preserved.machine-candidate.srt"),
    ...[
      "scripts/subtitle-tool-utterance-extent.mjs",
      "scripts/lib/utterance-extent.mjs",
      "scripts/lib/word-boundary-probe.mjs",
      "scripts/parse-mfa-output.py",
      "scripts/lib/bounded-asr-ab.mjs",
    ].map((n) => path.join(repo, n)),
  ];
  const bindings = await Promise.all(files.map(bind));
  const pcm = readPcm(await fs.readFile(s.audio));
  assert.equal(pcm.sampleRate, 16000);
  await fs.mkdir(output, { recursive: true });
  const root = await fs.mkdtemp(path.join(output, "extent-"));
  const plan = {
    ...s.selected,
    parent,
    spec,
    bindings,
    audio: s.audio,
    baseline: s.baseline,
    prior: s.prior,
    dictionaryEntries: entries,
  };
  for (const w of plan.windows) {
    const dir = path.join(root, w.id);
    await fs.mkdir(dir);
    await fs.writeFile(
      path.join(dir, "input.wav"),
      slicePcm(
        pcm,
        Math.round(w.start * 16000),
        Math.round(w.start * 16000) + w.frames,
      ),
      { flag: "wx" },
    );
    await fs.writeFile(path.join(dir, "input.lab"), plan.text + "\n", {
      flag: "wx",
    });
    w.wavHash = await fileHash(path.join(dir, "input.wav"));
  }
  await put(path.join(root, "plan.json"), plan);
  await put(path.join(root, "plan-freeze.json"), {
    sha256: await fileHash(path.join(root, "plan.json")),
  });
  return {
    root,
    text: plan.text,
    windows: plan.windows,
    requests: 2,
    seconds: plan.windows.reduce((n, w) => n + w.frames / 16000, 0),
  };
}
async function load(root) {
  await safePath(root);
  assert.equal(
    await fileHash(path.join(root, "plan.json")),
    (await json(path.join(root, "plan-freeze.json"))).sha256,
    "PLAN_CHANGED",
  );
  const p = await json(path.join(root, "plan.json"));
  for (const b of p.bindings)
    assert.equal(await fileHash(b.file), b.sha256, `CHANGED:${b.file}`);
  const s = await source(p.parent);
  assert.deepEqual(p.prior, s.prior);
  assert.deepEqual(p.baseline, s.baseline);
  for (const [k, v] of Object.entries(s.selected))
    if (k !== "windows") assert.deepEqual(p[k], v, `SELECTION_CHANGED:${k}`);
  assert.deepEqual(
    p.windows.map(({ id, start, end, frames }) => ({ id, start, end, frames })),
    s.selected.windows,
  );
  const pcm = readPcm(await fs.readFile(s.audio));
  for (const w of p.windows) {
    const wav = path.join(root, w.id, "input.wav");
    await safePath(wav);
    assert.equal(await fileHash(wav), w.wavHash);
    assert.deepEqual(
      await fs.readFile(wav),
      slicePcm(
        pcm,
        Math.round(w.start * 16000),
        Math.round(w.start * 16000) + w.frames,
      ),
    );
    assert.equal(
      await fs.readFile(path.join(root, w.id, "input.lab"), "utf8"),
      p.text + "\n",
    );
  }
  return p;
}
export async function reserveExtent(root, authorized) {
  assert(authorized, "EXPLICIT_LOCAL_ALIGNMENT_REQUIRED");
  await put(path.join(root, "execution-reservation.json"), {
    planHash: await fileHash(path.join(root, "plan.json")),
    mfaRequests: 2,
    asrRequests: 0,
    ctcRequests: 0,
    retries: 0,
  });
}
const execute = (executable, args, env) =>
  new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "",
      kill;
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      kill = setTimeout(() => child.kill("SIGKILL"), 2000);
    }, 180000);
    child.stdout.on("data", (b) => {
      stdout += b;
    });
    child.stderr.on("data", (b) => {
      stderr += b;
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      clearTimeout(kill);
      reject(e);
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      clearTimeout(kill);
      resolve({ exitCode, signal, stdout, stderr });
    });
  });
export async function runExtent(root, authorized) {
  assert(authorized, "EXPLICIT_LOCAL_ALIGNMENT_REQUIRED");
  const p = await load(root);
  await reserveExtent(root, authorized);
  const bin = path.dirname(p.spec.mfa),
    env = {
      PATH: bin + path.delimiter + process.env.PATH,
      CONDA_PREFIX: path.dirname(bin),
      MFA_ROOT_DIR: path.join(root, "mfa-state"),
      LANG: "en_US.UTF-8",
      HF_HUB_OFFLINE: "1",
      TRANSFORMERS_OFFLINE: "1",
    };
  for (const w of p.windows) {
    const dir = path.join(root, w.id),
      args = [
        "align_one",
        path.join(dir, "input.wav"),
        path.join(dir, "input.lab"),
        p.spec.dictionary,
        p.spec.acoustic,
        path.join(dir, "output.TextGrid"),
        "--no_tokenization",
        "--output_format",
        "long_textgrid",
        "--temporary_directory",
        path.join(dir, "temporary"),
        "--num_jobs",
        "1",
        "--no_use_mp",
        "--single_speaker",
        "--no_textgrid_cleanup",
      ];
    await put(path.join(dir, "dispatch.json"), {
      executable: p.spec.mfa,
      args,
      request: w,
      planHash: await fileHash(path.join(root, "plan.json")),
    });
    console.log(`MFA ${w.id}: ${w.start}–${w.end}`);
    const run = await execute(p.spec.mfa, args, env);
    await put(path.join(dir, "exit.json"), run);
    assert.equal(run.exitCode, 0, "MFA_FAILED_NO_RETRY");
    const parsed = await execute(
      p.spec.python,
      [
        path.join(repo, "scripts/parse-mfa-output.py"),
        path.join(dir, "output.TextGrid"),
      ],
      env,
    );
    await put(path.join(dir, "parser-exit.json"), parsed);
    assert.equal(parsed.exitCode, 0, "PARSER_FAILED");
    await put(path.join(dir, "raw.json"), JSON.parse(parsed.stdout));
  }
  return finishExtent(root);
}
async function replay(root, p) {
  const raws = [];
  assert.equal(
    (await json(path.join(root, "execution-reservation.json"))).planHash,
    await fileHash(path.join(root, "plan.json")),
  );
  for (const w of p.windows) {
    assert.deepEqual(
      (await json(path.join(root, w.id, "dispatch.json"))).request,
      w,
    );
    assert.equal((await json(path.join(root, w.id, "exit.json"))).exitCode, 0);
    const parser = await json(path.join(root, w.id, "parser-exit.json"));
    assert.equal(parser.exitCode, 0);
    const raw = await json(path.join(root, w.id, "raw.json"));
    assert.deepEqual(raw, JSON.parse(parser.stdout));
    raws.push(raw);
  }
  return analyzeExtent(p, raws, p.prior, p.baseline);
}
export async function finishExtent(root) {
  const p = await load(root),
    result = await replay(root, p);
  await put(path.join(root, "result.json"), result);
  await fs.copyFile(
    path.join(p.parent, "preserved.machine-candidate.srt"),
    path.join(root, "preserved.machine-candidate.srt"),
    fs.constants.COPYFILE_EXCL,
  );
  const names = [
    "plan.json",
    "plan-freeze.json",
    "execution-reservation.json",
    "result.json",
    "preserved.machine-candidate.srt",
    ...p.windows.flatMap((w) =>
      [
        "input.wav",
        "input.lab",
        "output.TextGrid",
        "raw.json",
        "dispatch.json",
        "exit.json",
        "parser-exit.json",
      ].map((n) => `${w.id}/${n}`),
    ),
  ];
  await put(path.join(root, "machine-freeze.json"), {
    files: Object.fromEntries(
      await Promise.all(
        names.map(async (n) => [n, await fileHash(path.join(root, n))]),
      ),
    ),
    mfaRequests: 2,
    newAsr: 0,
    newCtc: 0,
    mutation: 0,
  });
  return { root, ...result };
}
export async function verifyExtent(root) {
  const frozen = await json(path.join(root, "machine-freeze.json"));
  for (const [n, h] of Object.entries(frozen.files)) {
    assert(!path.isAbsolute(n) && !n.split(/[\\/]/u).includes(".."));
    await safePath(path.join(root, n));
    assert.equal(await fileHash(path.join(root, n)), h, `CHANGED:${n}`);
  }
  const p = await load(root),
    result = await replay(root, p);
  assert.deepEqual(result, await json(path.join(root, "result.json")));
  assert.equal(
    await fileHash(path.join(root, "preserved.machine-candidate.srt")),
    await fileHash(path.join(p.parent, "preserved.machine-candidate.srt")),
  );
  return {
    root,
    integrity: "passed",
    recordedMfaRequests: 2,
    newInference: 0,
    ...result,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [cmd, a, b, c] = process.argv.slice(2);
  try {
    const result =
      cmd === "prepare"
        ? await prepareExtent(a, await json(b), c)
        : cmd === "run"
          ? await runExtent(a, b === "--authorize-local")
          : cmd === "finish"
            ? await finishExtent(a)
            : cmd === "verify"
              ? await verifyExtent(a)
              : (() => {
                  throw Error(
                    "prepare PARENT RUNTIME_SPEC OUTPUT | run ROOT --authorize-local | finish ROOT | verify ROOT",
                  );
                })();
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  }
}
