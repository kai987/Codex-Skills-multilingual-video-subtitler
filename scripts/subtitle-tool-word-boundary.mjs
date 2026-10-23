/** Two local MFA calls over frozen machine text. No ASR, reference, or writeback. */
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { verifyContext } from "./subtitle-tool-speech-context.mjs";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { readPcm, slicePcm, durable } from "./lib/bounded-asr-ab.mjs";
import {
  alignmentWords,
  boundaryWindows,
  inspectWordAlignment,
  compareWordAlignments,
  wordBoundaryPolicy,
} from "./lib/word-boundary-probe.mjs";
const repo = path.resolve(import.meta.dirname, ".."),
  json = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const put = (r, n, v) => durable(path.join(r, n), v, true),
  bind = async (p) => ({ path: p, sha256: await fileHash(p) });
async function check(files) {
  for (const f of files)
    assert.equal(await fileHash(f.path), f.sha256, `CHANGED:${f.path}`);
}
async function inventory(root) {
  const out = {};
  for (const e of await fs.readdir(root, { withFileTypes: true })) {
    assert(!e.isSymbolicLink(), "SYMLINK");
    if (e.name === "mfa-state" || e.name === "temporary") continue;
    const p = path.join(root, e.name);
    if (e.isDirectory())
      for (const [n, h] of Object.entries(await inventory(p)))
        out[`${e.name}/${n}`] = h;
    else out[e.name] = await fileHash(p);
  }
  return out;
}
export async function prepareWordBoundary(parent, settings, output) {
  parent = path.resolve(parent);
  output = path.resolve(output);
  await verifyContext(parent);
  const prior = await json(path.join(parent, "plan.json")),
    baseline = await json(path.join(parent, "baseline-records.json"));
  assert.equal(prior.selected.length, 1, "ONE_FROZEN_TARGET_REQUIRED");
  assert(!output.startsWith(parent + path.sep) && output !== parent);
  const target = boundaryWindows(
      prior.selected[0],
      baseline,
      prior.duration,
      prior.audioOffset,
    ),
    spec = await json(settings);
  const mfa = await json(spec.manifest),
    sudachi = await json(spec.sudachiManifest);
  assert.equal(mfa.mfaVersion, "3.4.2");
  assert.equal(mfa.commandCapabilities.alignOneCommand, "align_one");
  assert.equal(await fileHash(spec.acoustic), mfa.acousticModel.sha256);
  assert.equal(await fileHash(spec.dictionary), mfa.dictionaryModel.sha256);
  assert.equal(
    await fileHash(path.join(repo, "scripts/sudachi-readings.py")),
    sudachi.helperSha256,
  );
  const analysis = JSON.parse(
    execFileSync(
      spec.sudachiPython,
      [path.join(repo, "scripts/sudachi-readings.py")],
      {
        input: JSON.stringify({
          items: [{ id: "machine-core", text: target.text }],
        }),
        encoding: "utf8",
        timeout: 30000,
      },
    ),
  );
  const words = alignmentWords(analysis, target.text),
    entries = new Map(words.map((w) => [w, []]));
  for (const line of (await fs.readFile(spec.dictionary, "utf8")).split(
    /\r?\n/u,
  )) {
    const [w, ...phones] = line.trim().split(/\s+/u);
    if (entries.has(w)) entries.get(w).push(phones);
  }
  assert(
    [...entries.values()].every((a) => a.length > 0),
    "DICTIONARY_OOV_NO_GUESSED_PHONES",
  );
  await check([prior.audio]);
  const pcm = readPcm(await fs.readFile(prior.audio.path));
  assert.equal(pcm.sampleRate, 16000);
  await fs.mkdir(output, { recursive: true });
  const root = await fs.mkdtemp(path.join(output, "word-boundary-"));
  await put(root, "tokenization.json", analysis);
  await put(root, "dictionary-evidence.json", Object.fromEntries(entries));
  for (const w of target.windows) {
    const dir = path.join(root, w.id);
    await fs.mkdir(dir);
    const start = Math.round((w.start - prior.audioOffset) * 16000);
    await fs.writeFile(
      path.join(dir, "input.wav"),
      slicePcm(pcm, start, start + w.frames),
      { flag: "wx" },
    );
    await fs.writeFile(path.join(dir, "input.lab"), words.join(" ") + "\n", {
      flag: "wx",
    });
    w.wavHash = await fileHash(path.join(dir, "input.wav"));
  }
  const identities = await Promise.all(
    [
      spec.mfa,
      spec.python,
      spec.sudachiPython,
      spec.manifest,
      spec.sudachiManifest,
      spec.acoustic,
      spec.dictionary,
    ].map(bind),
  );
  const software = await Promise.all(
    [
      "scripts/subtitle-tool-word-boundary.mjs",
      "scripts/lib/word-boundary-probe.mjs",
      "scripts/sudachi-readings.py",
      "scripts/parse-mfa-output.py",
    ].map((n) => bind(path.join(repo, n))),
  );
  await put(root, "plan.json", {
    policy: wordBoundaryPolicy,
    parent,
    parentFreezeHash: await fileHash(path.join(parent, "machine-freeze.json")),
    ...target,
    words,
    spec,
    identities,
    software,
    audio: prior.audio,
    audioOffset: prior.audioOffset,
    referenceUsed: false,
    automaticMutation: false,
  });
  await put(root, "plan-freeze.json", { files: await inventory(root) });
  return {
    root,
    text: target.text,
    words,
    windows: target.windows,
    requests: 2,
    audioSeconds: target.windows.reduce((s, w) => s + w.frames / 16000, 0),
  };
}
async function load(root) {
  const freeze = await json(path.join(root, "plan-freeze.json"));
  for (const [n, h] of Object.entries(freeze.files)) {
    assert(!path.isAbsolute(n) && !n.split(/[\\/]/u).includes(".."));
    assert.equal(await fileHash(path.join(root, n)), h, `CHANGED:${n}`);
  }
  const p = await json(path.join(root, "plan.json"));
  assert.deepEqual(p.policy, wordBoundaryPolicy);
  await check([...p.identities, ...p.software, p.audio]);
  await verifyContext(p.parent);
  assert.equal(
    await fileHash(path.join(p.parent, "machine-freeze.json")),
    p.parentFreezeHash,
  );
  const old = await json(path.join(p.parent, "plan.json")),
    base = await json(path.join(p.parent, "baseline-records.json"));
  const target = boundaryWindows(
    old.selected[0],
    base,
    old.duration,
    old.audioOffset,
  );
  assert.equal(p.text, target.text);
  assert.deepEqual(p.recordIds, target.recordIds);
  assert.deepEqual(
    p.words,
    alignmentWords(await json(path.join(root, "tokenization.json")), p.text),
  );
  assert.deepEqual(
    p.windows.map((w) => ({
      id: w.id,
      start: w.start,
      end: w.end,
      frames: w.frames,
    })),
    target.windows,
  );
  const pcm = readPcm(await fs.readFile(p.audio.path));
  for (const w of p.windows) {
    const begin = Math.round((w.start - p.audioOffset) * 16000);
    assert.deepEqual(
      await fs.readFile(path.join(root, w.id, "input.wav")),
      slicePcm(pcm, begin, begin + w.frames),
    );
    assert.equal(await fileHash(path.join(root, w.id, "input.wav")), w.wavHash);
    assert.equal(
      await fs.readFile(path.join(root, w.id, "input.lab"), "utf8"),
      p.words.join(" ") + "\n",
    );
  }
  return p;
}
export async function runWordBoundary(root, authorize = false) {
  const p = await load(root);
  assert(authorize, "EXPLICIT_LOCAL_ALIGNMENT_REQUIRED");
  await put(root, "execution-reservation.json", {
    at: new Date().toISOString(),
    mfaRequests: 2,
    asrRequests: 0,
    retries: 0,
    audioSeconds: p.windows.reduce((s, w) => s + w.frames / 16000, 0),
  });
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
    await put(dir, "dispatch.json", {
      executable: p.spec.mfa,
      args,
      at: new Date().toISOString(),
    });
    console.log(`MFA ${w.id} ${w.start}–${w.end}`);
    const execution = spawnSync(p.spec.mfa, args, {
      env,
      encoding: "utf8",
      timeout: 180000,
      maxBuffer: 8000000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    await fs.writeFile(path.join(dir, "stdout.log"), execution.stdout ?? "", {
      flag: "wx",
    });
    await fs.writeFile(path.join(dir, "stderr.log"), execution.stderr ?? "", {
      flag: "wx",
    });
    await put(dir, "exit.json", {
      exitCode: execution.status,
      signal: execution.signal,
      error: execution.error?.message ?? null,
    });
    if (execution.status !== 0) throw Error("MFA_FAILED_NO_RETRY");
    const raw = JSON.parse(
      execFileSync(
        p.spec.python,
        [
          path.join(repo, "scripts/parse-mfa-output.py"),
          path.join(dir, "output.TextGrid"),
        ],
        { env, encoding: "utf8", timeout: 30000 },
      ),
    );
    await put(dir, "raw.json", raw);
  }
  await load(root);
  const results = [];
  for (const w of p.windows)
    results.push(
      inspectWordAlignment(
        await json(path.join(root, w.id, "raw.json")),
        w,
        p.words,
      ),
    );
  await put(root, "alignment-analysis.json", {
    results,
    comparison: compareWordAlignments(results),
  });
  await put(root, "machine-freeze.json", {
    at: new Date().toISOString(),
    files: await inventory(root),
    mfaRequests: 2,
    asrRequests: 0,
    canonicalMutation: 0,
    qualityStatus: "needs-review",
  });
  return verifyWordBoundary(root);
}
export async function verifyWordBoundary(root) {
  const f = await json(path.join(root, "machine-freeze.json"));
  for (const [n, h] of Object.entries(f.files)) {
    assert(!path.isAbsolute(n) && !n.split(/[\\/]/u).includes(".."));
    assert.equal(await fileHash(path.join(root, n)), h, `CHANGED:${n}`);
  }
  const p = await load(root),
    results = [];
  for (const w of p.windows) {
    assert.equal((await json(path.join(root, w.id, "exit.json"))).exitCode, 0);
    results.push(
      inspectWordAlignment(
        await json(path.join(root, w.id, "raw.json")),
        w,
        p.words,
      ),
    );
  }
  const analysis = { results, comparison: compareWordAlignments(results) };
  assert.deepEqual(
    await json(path.join(root, "alignment-analysis.json")),
    analysis,
  );
  return {
    root,
    integrity: "passed",
    newInference: 0,
    recordedMfaRequests: f.mfaRequests,
    asrRequests: 0,
    ...analysis.comparison,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const [cmd, a, b, c] = process.argv.slice(2);
    let r;
    if (cmd === "prepare") r = await prepareWordBoundary(a, b, c);
    else if (cmd === "run")
      r = await runWordBoundary(a, b === "--authorize-local");
    else if (cmd === "verify") r = await verifyWordBoundary(a);
    else
      throw Error(
        "prepare PARENT SETTINGS OUTPUT | run ROOT --authorize-local | verify ROOT",
      );
    console.log(JSON.stringify(r, null, 2));
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  }
}
