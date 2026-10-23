/** Finish interrupted diagnostic export from saved responses. No inference entrypoint. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import {
  formats,
  serializeRecords,
} from "../packages/video-subtitler/dist/standalone/bounded.js";
import { verifySoftSpeech } from "./subtitle-tool-soft-speech.mjs";
import { durable } from "./lib/bounded-asr-ab.mjs";
const json = async (p) => JSON.parse(await fs.readFile(p, "utf8"));

// Only diagnostic clocks use tick equality. Raw records and full delivery stay unchanged.
export function diagnosticFiles(records) {
  const cues = records.map((r) => {
    assert(Number.isFinite(r.sourceStart) && Number.isFinite(r.sourceEnd));
    assert(r.sourceStart >= 0 && r.sourceEnd > r.sourceStart);
    assert(typeof r.text === "string" && r.text.length > 0);
    const start = Math.round(r.sourceStart * 100) / 100;
    const end = Math.round(r.sourceEnd * 100) / 100;
    assert(end > start, "DIAGNOSTIC_QUANTIZATION_COLLAPSE");
    return { id: r.recordId, start, end, text: r.text };
  });
  for (let i = 1; i < cues.length; i++)
    assert(cues[i].start >= cues[i - 1].end, "DIAGNOSTIC_OVERLAP");
  const files = {};
  for (const [ext, adapter] of Object.entries(formats)) {
    const content = adapter.format(cues),
      parsed = adapter.parse(content);
    assert.equal(parsed.length, cues.length);
    parsed.forEach((cue, i) => {
      assert.equal(cue.text, cues[i].text, "DIAGNOSTIC_TEXT_LOSS");
      for (const key of ["start", "end"]) {
        assert.equal(
          Math.round(cue[key] * 100),
          Math.round(cues[i][key] * 100),
        );
        assert(
          Math.abs(cue[key] - cues[i][key]) < 1e-9,
          "DIAGNOSTIC_CLOCK_LOSS",
        );
      }
    });
    files[ext] = content;
  }
  return files;
}
async function inventory(root) {
  const files = {};
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const p = path.join(root, entry.name);
    assert(!entry.isSymbolicLink(), "SYMLINK_EVIDENCE");
    if (entry.isDirectory()) {
      for (const [name, hash] of Object.entries(await inventory(p)))
        files[`${entry.name}/${name}`] = hash;
    } else files[entry.name] = await fileHash(p);
  }
  return files;
}
export async function completeSoftSpeechOffline(root) {
  root = path.resolve(root);
  const before = await inventory(root);
  assert(!before["machine-freeze.json"], "ALREADY_FROZEN");
  assert(!before["reference-evaluation.json"], "REFERENCE_ALREADY_OPENED");
  const p = await json(path.join(root, "plan.json"));
  const reservation = await json(path.join(root, "execution-reservation.json"));
  const audioSeconds = p.probes.reduce((s, r) => s + (2 * r.frames) / 16000, 0);
  assert.equal(reservation.requests, p.probes.length * 2);
  assert.equal(reservation.audioSeconds, audioSeconds);
  assert.equal(reservation.retries, 0);
  assert.equal((await json(path.join(root, "kotoba-exit.json"))).exitCode, 0);
  assert.equal(
    (await json(path.join(root, "kotoba-runtime.json"))).modelLoadCount,
    1,
  );
  for (const r of p.probes) {
    const dir = path.join(root, r.id);
    assert.equal((await json(path.join(dir, "whisper-exit.json"))).exitCode, 0);
    assert.equal(
      (await json(path.join(dir, "kotoba-reserved.json"))).wavHash,
      r.wavHash,
    );
    assert(before[`${r.id}/kotoba-raw.json`]);
  }
  const freeze = {
    at: new Date().toISOString(),
    files: before,
    newVadPasses: 0,
    asrRequests: reservation.requests,
    audioSeconds,
    qualityStatus: "needs-review",
    finalizationMethod: "none",
    humanValidated: false,
    referenceUsed: false,
  };
  // Validate the original plan, source PCM, software hashes and raw-response replay
  // in an isolated copy before publishing a freeze into the actual run directory.
  const stage = await fs.mkdtemp(
    path.join(os.tmpdir(), "soft-speech-offline-"),
  );
  try {
    const stagedRun = path.join(stage, "run");
    await fs.cp(root, stagedRun, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    await durable(path.join(stagedRun, "machine-freeze.json"), freeze, true);
    await verifySoftSpeech(stagedRun);
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
  }
  const candidate = serializeRecords(
    await json(path.join(root, "candidate-records.json")),
    "ja",
  );
  for (const [ext, content] of Object.entries(candidate.files))
    assert.equal(
      await fs.readFile(
        path.join(root, `soft-speech.machine-candidate.${ext}`),
        "utf8",
      ),
      content,
    );
  const views = await json(path.join(root, "views.json"));
  const additions = [],
    strictSerializationIssues = [];
  for (const v of views) {
    if (v.unresolvedCount || !v.records.length) continue;
    try {
      serializeRecords(v.records, "ja");
    } catch (e) {
      if (!/^SERIALIZATION_TEXT_OR_TIMING_LOSS:/u.test(e.message)) throw e;
      strictSerializationIssues.push({
        targetId: v.targetId,
        backend: v.backend,
        error: e.message,
      });
    }
    for (const [ext, content] of Object.entries(diagnosticFiles(v.records))) {
      const name = `${v.targetId}/${v.backend}.diagnostic.${ext}`;
      if (before[name])
        assert.equal(await fs.readFile(path.join(root, name), "utf8"), content);
      else additions.push({ name, content });
    }
  }
  assert.deepEqual(
    await inventory(root),
    before,
    "SOURCE_CHANGED_DURING_RECOVERY",
  );
  for (const { name, content } of additions)
    await fs.writeFile(path.join(root, name), content, { flag: "wx" });
  await durable(
    path.join(root, "offline-completion.json"),
    {
      version: "diagnostic-tick-roundtrip-v1",
      at: new Date().toISOString(),
      newInference: 0,
      newModelLoads: 0,
      newVadPasses: 0,
      sourceFiles: before,
      addedFiles: additions.map((a) => a.name),
      strictSerializationIssues,
      rawRecordsChanged: false,
      decisionsChanged: false,
      quantization:
        "diagnostics only: nearest centisecond; clock equality within 1e-9 seconds and identical integer ticks",
      software: {
        path: import.meta.filename,
        sha256: await fileHash(import.meta.filename),
      },
    },
    true,
  );
  await durable(
    path.join(root, "machine-freeze.json"),
    { ...freeze, files: await inventory(root) },
    true,
  );
  return verifySoftSpeech(root);
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    console.log(
      JSON.stringify(await completeSoftSpeechOffline(process.argv[2]), null, 2),
    );
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  }
}
