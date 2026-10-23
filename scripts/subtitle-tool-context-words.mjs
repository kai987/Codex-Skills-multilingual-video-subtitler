/** Explicit bounded MFA alignment of complete saved ASR crops. No ASR or subtitle writes. */
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { setTimeout, clearTimeout } from "node:timers";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { formats } from "../packages/video-subtitler/dist/standalone/bounded.js";
import { durable, readPcm } from "./lib/bounded-asr-ab.mjs";
import { alignmentWords } from "./lib/word-boundary-probe.mjs";
import {
  contextWordPolicy,
  sharedWordCore,
  summarizeContextWords,
} from "./lib/context-word-alignment.mjs";
const repo = path.resolve(import.meta.dirname, ".."),
  json = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const put = (r, n, v) => durable(path.join(r, n), v, true);
async function inventory(root) {
  const files = {};
  for (const e of await fs.readdir(root, { withFileTypes: true })) {
    if (["temporary", "mfa-state"].includes(e.name)) continue;
    assert(!e.isSymbolicLink());
    const p = path.join(root, e.name);
    if (e.isDirectory())
      for (const [n, h] of Object.entries(await inventory(p)))
        files[e.name + "/" + n] = h;
    else files[e.name] = await fileHash(p);
  }
  return files;
}
async function verifyFiles(root, files) {
  for (const [n, h] of Object.entries(files)) {
    assert(!path.isAbsolute(n) && !n.split(/[\\/]/u).includes(".."));
    assert.equal(await fileHash(path.join(root, n)), h, `CHANGED:${n}`);
  }
}
async function load(root) {
  await verifyFiles(
    root,
    (await json(path.join(root, "plan-freeze.json"))).files,
  );
  const p = await json(path.join(root, "plan.json"));
  assert.deepEqual(p.policy, contextWordPolicy);
  for (const [file, h] of Object.entries(p.bindings))
    assert.equal(await fileHash(file), h);
  assert.equal(p.requests.length, 2);
  assert(p.requests.reduce((n, r) => n + r.frames / 16000, 0) <= 30);
  for (const r of p.requests) {
    assert(r.frames <= 15 * 16000);
    assert.equal(
      await fileHash(path.join(root, r.id, "input.wav")),
      r.audioHash,
    );
    assert.equal(
      await fs.readFile(path.join(root, r.id, "input.lab"), "utf8"),
      r.words.join(" ") + "\n",
    );
  }
  assert.deepEqual(sharedWordCore(p.requests), p.core);
  return p;
}
const [mode, a, b, c, d] = process.argv.slice(2);
if (mode === "prepare") {
  assert(a && b && c && d, "prepare PROBE_ROOT TARGET_ID SETTINGS OUTPUT");
  const source = path.resolve(a),
    spec = await json(c),
    parent = path.resolve(d);
  assert(parent !== source && !parent.startsWith(source + path.sep));
  const freeze = await json(path.join(source, "machine-freeze.json"));
  await verifyFiles(source, freeze.files);
  const prior = await json(path.join(source, "plan.json")),
    all = await json(path.join(source, "views.json")),
    target = prior.targets.find((t) => t.id === b);
  assert(
    target && target.code === "OVERLAPPING_TEXT_CONTAINMENT_REQUIRES_AUDIO",
  );
  const views = all.filter((v) => v.targetId === b);
  assert.equal(views.length, 2);
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
  const requests = [],
    analyses = [];
  for (const v of views) {
    const rawFile = path.join(source, v.id, "response.srt");
    assert.equal(await fileHash(rawFile), v.rawHash);
    assert.deepEqual(
      formats.srt
        .parse(await fs.readFile(rawFile, "utf8"))
        .map((r) => ({ ...r, start: r.start + v.start, end: r.end + v.start })),
      v.records,
    );
    const pcm = readPcm(
      await fs.readFile(path.join(source, v.id, "input.wav")),
    );
    assert.equal(pcm.sampleRate, 16000);
    assert(pcm.frames <= 15 * 16000);
    assert.equal(
      await fileHash(path.join(source, v.id, "input.wav")),
      v.audioHash,
    );
    const analysis = JSON.parse(
      execFileSync(
        spec.sudachiPython,
        [path.join(repo, "scripts/sudachi-readings.py")],
        {
          input: JSON.stringify({
            items: v.records.map((r, i) => ({ id: String(i), text: r.text })),
          }),
          encoding: "utf8",
          timeout: 30000,
        },
      ),
    );
    analyses.push(analysis);
    const words = [],
      segments = [];
    for (let i = 0; i < v.records.length; i++) {
      const text = v.records[i].text,
        sw = alignmentWords({ items: [analysis.items[i]] }, text),
        wordStart = words.length;
      words.push(...sw);
      segments.push({
        text,
        words: sw,
        wordStart,
        wordEnd: words.length,
        originalInterval: { start: v.records[i].start, end: v.records[i].end },
      });
    }
    const ranks = v.records
      .map((r, i) => ({
        i,
        overlap: Math.max(
          0,
          Math.min(r.end, target.end) - Math.max(r.start, target.start),
        ),
      }))
      .sort((x, y) => y.overlap - x.overlap);
    assert(
      ranks[0].overlap > 0 && ranks[0].overlap > ranks[1].overlap,
      "AMBIGUOUS_TARGET_SEGMENT",
    );
    requests.push({
      id: v.id,
      start: v.start,
      end: v.end,
      frames: pcm.frames,
      audioHash: v.audioHash,
      segments,
      words,
      targetSegmentIndex: ranks[0].i,
    });
  }
  assert(requests.reduce((n, r) => n + r.frames / 16000, 0) <= 30);
  const core = sharedWordCore(requests),
    entries = new Map(requests.flatMap((r) => r.words).map((w) => [w, []]));
  for (const line of (await fs.readFile(spec.dictionary, "utf8")).split(
    /\r?\n/u,
  )) {
    const [w, ...phones] = line.trim().split(/\s+/u);
    if (entries.has(w)) entries.get(w).push(phones);
  }
  const missing = [...entries].filter(([, p]) => !p.length).map(([w]) => w);
  assert.equal(missing.length, 0, `DICTIONARY_OOV:${missing.join(",")}`);
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, "context-words-"));
  await put(root, "tokenization.json", analyses);
  await put(root, "dictionary-evidence.json", Object.fromEntries(entries));
  for (const r of requests) {
    const dir = path.join(root, r.id);
    await fs.mkdir(dir);
    await fs.copyFile(
      path.join(source, r.id, "input.wav"),
      path.join(dir, "input.wav"),
      fs.constants.COPYFILE_EXCL,
    );
    await fs.writeFile(path.join(dir, "input.lab"), r.words.join(" ") + "\n", {
      flag: "wx",
    });
  }
  const bindings = {};
  for (const file of [
    ...Object.values(spec),
    path.join(source, "machine-freeze.json"),
    ...Object.keys(freeze.files).map((n) => path.join(source, n)),
    ...[
      "scripts/subtitle-tool-context-words.mjs",
      "scripts/lib/context-word-alignment.mjs",
      "scripts/lib/word-boundary-probe.mjs",
      "scripts/sudachi-readings.py",
      "scripts/parse-mfa-output.py",
    ].map((n) => path.join(repo, n)),
  ])
    bindings[file] = await fileHash(file);
  await put(root, "plan.json", {
    policy: contextWordPolicy,
    source,
    target,
    requests,
    core,
    spec,
    bindings,
    referenceUsed: false,
    subtitleMutations: 0,
    coverage:
      "all stored segments of each exact original crop; completeness unverified; conflicting contexts preserved separately",
  });
  await put(root, "plan-freeze.json", { files: await inventory(root) });
  console.log(
    JSON.stringify(
      {
        root,
        requests: requests.map((r) => ({
          id: r.id,
          seconds: r.frames / 16000,
          words: r.words,
        })),
        core,
      },
      null,
      2,
    ),
  );
} else if (mode === "run" || mode === "verify") {
  const root = path.resolve(a),
    p = await load(root);
  const bin = path.dirname(p.spec.mfa),
    env = {
      PATH: bin + path.delimiter + process.env.PATH,
      CONDA_PREFIX: path.dirname(bin),
      MFA_ROOT_DIR: path.join(root, "mfa-state"),
      LANG: "en_US.UTF-8",
      HF_HUB_OFFLINE: "1",
      TRANSFORMERS_OFFLINE: "1",
    };
  if (mode === "run") {
    assert.equal(b, "--authorize-local");
    await put(root, "execution-reservation.json", {
      at: new Date().toISOString(),
      requests: 2,
      requestAudioSeconds: p.requests.reduce((n, r) => n + r.frames / 16000, 0),
      retries: 0,
      asrRequests: 0,
    });
    for (const r of p.requests) {
      const dir = path.join(root, r.id),
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
      console.log(`MFA START ${r.id}`);
      const exit = await new Promise((resolve, reject) => {
        const child = spawn(p.spec.mfa, args, {
          env,
          stdio: ["ignore", "pipe", "pipe"],
        });
        let out = "",
          err = "",
          kill;
        const timer = setTimeout(() => {
          child.kill("SIGTERM");
          kill = setTimeout(() => child.kill("SIGKILL"), 2000);
        }, 180000);
        child.stdout.on("data", (b) => (out += b));
        child.stderr.on("data", (b) => (err += b));
        child.on("error", (error) => {
          clearTimeout(timer);
          clearTimeout(kill);
          reject(error);
        });
        child.on("close", (code, signal) => {
          clearTimeout(timer);
          clearTimeout(kill);
          resolve({ code, signal, out, err });
        });
      });
      await put(dir, "exit.json", {
        exitCode: exit.code,
        signal: exit.signal,
        finishedAt: new Date().toISOString(),
      });
      await fs.writeFile(path.join(dir, "stdout.log"), exit.out, {
        flag: "wx",
      });
      await fs.writeFile(path.join(dir, "stderr.log"), exit.err, {
        flag: "wx",
      });
      assert.equal(exit.code, 0, "MFA_FAILED_NO_RETRY");
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
      console.log(`MFA DONE ${r.id}`);
    }
  }
  const raws = await Promise.all(
      p.requests.map((r) => json(path.join(root, r.id, "raw.json"))),
    ),
    result = summarizeContextWords(p.requests, raws, p.core);
  await load(root);
  if (mode === "run") {
    await put(root, "result.json", result);
    await put(root, "machine-freeze.json", {
      files: await inventory(root),
      mfaRequests: 2,
      asrRequests: 0,
    });
  } else {
    await verifyFiles(
      root,
      (await json(path.join(root, "machine-freeze.json"))).files,
    );
    assert.deepEqual(await json(path.join(root, "result.json")), result);
  }
  console.log(JSON.stringify({ root, mode, result }, null, 2));
} else throw Error("prepare | run | verify");
