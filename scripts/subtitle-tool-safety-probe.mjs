/** Explicit, one-shot prompt-free local evidence collection; no subtitle mutation. */
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { formats } from "../packages/video-subtitler/dist/standalone/bounded.js";
import {
  durable,
  readPcm,
  slicePcm,
  EvidenceRunner,
} from "./lib/bounded-asr-ab.mjs";
import { planSafetyProbes } from "./lib/safety-recovery-probe.mjs";
import { contentSafety } from "./lib/content-safety-gate.mjs";
const json = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const put = (root, name, value) => durable(path.join(root, name), value, true);
async function inventory(root) {
  const result = {};
  for (const e of await fs.readdir(root, { withFileTypes: true })) {
    const p = path.join(root, e.name);
    assert(!e.isSymbolicLink(), "SYMLINK_NOT_ALLOWED");
    if (e.isDirectory())
      for (const [n, h] of Object.entries(await inventory(p)))
        result[e.name + "/" + n] = h;
    else result[e.name] = await fileHash(p);
  }
  return result;
}
const [mode, supplied, parent, ...extra] = process.argv.slice(2);
if (mode === "prepare" && supplied && parent && !extra.length) {
  const task = path.resolve(supplied),
    output = path.resolve(parent);
  assert(output !== task && !output.startsWith(task + path.sep));
  const manifest = await json(path.join(task, "bounded-task.json"));
  const planFile = path.join(task, "bounded-plan.json");
  assert.equal(await fileHash(planFile), manifest.files["bounded-plan.json"]);
  const sourcePlan = await json(planFile);
  assert.equal(sourcePlan.config.language, "ja");
  assert.equal(sourcePlan.audioOffset, 0);
  const srt = manifest.outputs.find((n) => n.endsWith(".srt"));
  assert(srt && !path.isAbsolute(srt) && !srt.split(/[\\/]/u).includes(".."));
  assert.equal(await fileHash(path.join(task, srt)), manifest.files[srt]);
  assert.equal(
    await fileHash(path.join(task, "audio.wav")),
    sourcePlan.audioHash,
  );
  const records = formats.srt.parse(
    await fs.readFile(path.join(task, srt), "utf8"),
  );
  const planned = planSafetyProbes(records, sourcePlan.duration);
  const pcm = readPcm(await fs.readFile(path.join(task, "audio.wav")));
  assert.equal(pcm.sampleRate, 16000);
  await fs.mkdir(output, { recursive: true });
  const root = await fs.mkdtemp(path.join(output, "probe-"));
  await put(root, "baseline-records.json", records);
  for (const r of planned.requests) {
    const dir = path.join(root, r.id);
    await fs.mkdir(dir);
    const first = Math.round(r.start * pcm.sampleRate),
      last = Math.round(r.end * pcm.sampleRate);
    const wav = slicePcm(pcm, first, last);
    assert(readPcm(wav).data.equals(pcm.data.subarray(first * 2, last * 2)));
    await fs.writeFile(path.join(dir, "input.wav"), wav, { flag: "wx" });
    r.audioHash = await fileHash(path.join(dir, "input.wav"));
  }
  const files = await inventory(root);
  const software = {};
  for (const name of [
    "scripts/subtitle-tool-safety-probe.mjs",
    "scripts/lib/safety-recovery-probe.mjs",
    "scripts/lib/content-safety-gate.mjs",
    "scripts/lib/bounded-asr-ab.mjs",
    "packages/video-subtitler/dist/standalone/bounded.js",
    "packages/video-subtitler/dist/standalone/tool.js",
    "packages/subtitle-core/dist/parse.js",
    "packages/subtitle-core/dist/time.js",
  ])
    software[path.resolve(name)] = await fileHash(name);
  await put(root, "plan.json", {
    ...planned,
    task,
    createdAt: new Date().toISOString(),
    files,
    software,
    config: sourcePlan.config,
    identities: sourcePlan.identities,
    sourcePlanHash: manifest.files["bounded-plan.json"],
    sourceAudioHash: sourcePlan.audioHash,
    independentModelEvidence: false,
    independence:
      "prompt-free alternative crops of the same model; previously exposed development episode, not blind evaluation",
  });
  await put(root, "plan-freeze.json", {
    planHash: await fileHash(path.join(root, "plan.json")),
  });
  console.log(JSON.stringify({ root, ...planned }, null, 2));
} else if (
  mode === "run" &&
  supplied &&
  parent === "--authorize-local-asr" &&
  !extra.length
) {
  const root = path.resolve(supplied),
    p = await json(path.join(root, "plan.json"));
  assert.equal(
    await fileHash(path.join(root, "plan.json")),
    (await json(path.join(root, "plan-freeze.json"))).planHash,
  );
  for (const [n, h] of Object.entries(p.files))
    assert.equal(await fileHash(path.join(root, n)), h);
  for (const [n, h] of Object.entries(p.software))
    assert.equal(await fileHash(n), h);
  for (const key of ["model", "runtime"])
    assert.equal(
      await fileHash(p.identities[key].path),
      p.identities[key].sha256,
    );
  assert.equal(p.config.model, p.identities.model.path);
  assert.equal(p.config.runtime, p.identities.runtime.path);
  assert.deepEqual(
    planSafetyProbes(
      await json(path.join(root, "baseline-records.json")),
      (await json(path.join(p.task, "bounded-plan.json"))).duration,
    ).targets,
    p.targets,
  );
  assert(p.requests.length <= 6 && p.reservedAudioSeconds <= 120);
  await put(root, "execution-reservation.json", {
    at: new Date().toISOString(),
    requests: p.requests.map((r) => r.id),
    retries: 0,
  });
  const runner = new EvidenceRunner(),
    views = [];
  for (const r of p.requests) {
    const dir = path.join(root, r.id),
      prefix = path.join(dir, "response");
    assert.equal(await fileHash(path.join(dir, "input.wav")), r.audioHash);
    const args = [
      "--model",
      p.config.model,
      "--file",
      path.join(dir, "input.wav"),
      "--language",
      "ja",
      "--threads",
      String(p.config.threads),
      "--output-srt",
      "--output-file",
      prefix,
      "--suppress-nst",
      "--no-prints",
    ];
    await put(dir, "request.json", {
      ...r,
      args,
      prompt: null,
      startedAt: new Date().toISOString(),
    });
    console.log(`START ${r.id} ${r.start}-${r.end}`);
    const exit = await runner.run(p.config.runtime, args, {
      cwd: dir,
      timeoutMs: 120000,
    });
    await put(dir, "exit.json", {
      exitCode: exit.exitCode,
      signal: exit.signal,
      finishedAt: new Date().toISOString(),
    });
    if (exit.exitCode !== 0) throw Error(`ASR_FAILED_NO_RETRY:${r.id}`);
    const records = formats.srt
      .parse(await fs.readFile(prefix + ".srt", "utf8"))
      .map((c) => ({ ...c, start: c.start + r.start, end: c.end + r.start }));
    views.push({
      ...r,
      records,
      audit: contentSafety(records, { language: "ja" }),
      rawHash: await fileHash(prefix + ".srt"),
    });
    console.log(`DONE ${r.id} ${records.length} cues`);
  }
  await put(root, "views.json", views);
  await put(root, "result.json", {
    requests: views.length,
    requestAudioSeconds: p.reservedAudioSeconds,
    modelLoads: views.length,
    prompt: null,
    referenceInput: null,
    subtitleMutations: 0,
    qualityStatus: "needs-review",
    automaticReplacementAllowed: false,
    reason:
      "Alternative crops are not independent models; timing and occurrence checks remain required.",
  });
  await put(root, "machine-freeze.json", {
    frozenAt: new Date().toISOString(),
    files: await inventory(root),
  });
  console.log(
    JSON.stringify({
      root,
      requests: views.length,
      status: "machine-evidence-frozen",
    }),
  );
} else
  throw Error(
    "Usage: prepare TASK OUTPUT_ROOT | run PROBE --authorize-local-asr",
  );
