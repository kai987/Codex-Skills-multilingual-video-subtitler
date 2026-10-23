// Coordinator: verifies frozen credentials; workers receive only one machine JSON.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

import { freshMatchedEvidenceSchema } from "../packages/video-subtitler/dist/machine-quality/matched-replay.js";
import { generationManifestSchema } from "../packages/video-subtitler/dist/machine-quality/reference-complete.js";

import {
  read,
  write,
  oh,
  hash,
  digest,
  repo,
  verify,
  freeze,
  walk,
} from "./c60117-common.mjs";
const [oldArg, baselineArg, runtimeArg, parentArg] = process.argv.slice(2);
if (!oldArg || !parentArg)
  throw Error(
    "Usage: prepare-c60118.mjs OLD_17_1_RUN OLD_17_2_RUN RUNTIME_CONFIG OUTPUT_PARENT",
  );
const old = path.resolve(oldArg);
for (const f of [
  "model-input-freeze.json",
  "dataset-freeze.json",
  "evidence-freeze.json",
  "run-a-freeze.json",
  "run-b-freeze.json",
])
  verify(old, f);
const m = generationManifestSchema.parse(
  read(path.join(old, "dataset/generation-manifest.json")),
);
const gate = read(path.join(old, "dataset/model-gate.json"));
const fixed = read(path.join(old, "frozen-repair-identity.json"));
if (
  m.units.length !== 12 ||
  new Set(m.units.map((u) => u.id)).size !== 12 ||
  gate.status !== "DATA_READY_FOR_FROZEN_REPAIR_CHECK" ||
  gate.generationManifestHash !== oh(m) ||
  gate.preflightHash !==
    (await hash(path.join(old, "dataset/reference-complete-preflight.json"))) ||
  gate.frozenRepairHash !==
    (await hash(path.join(old, "frozen-repair-identity.json")))
)
  throw Error("OLD_DATA_IDENTITY_INVALID");
for (const [p, h] of Object.entries(fixed.code))
  if (digest(fs.readFileSync(path.join(repo, p))) !== h)
    throw Error("Protected algorithm drift: " + p);
const credentials = [];
for (const u of m.units) {
  const file = path.join(old, "generator-input", u.id + ".json");
  const e = freshMatchedEvidenceSchema.parse(read(file));
  const rawFile = path.join(old, "evidence", u.id + ".json"),
    raw = read(rawFile);
  const r = e.primaryRequests[0];
  const key = {
    audioHash: u.audioHash,
    sampleCount: u.sampleCount,
    model: fixed.model,
    preprocessing: "mono PCM16 16k",
    prompt: "",
    timebase: "clip-local",
  };
  if (
    e.primaryRequests.length !== 1 ||
    !r ||
    r.id !== u.id ||
    oh(raw.key) !== oh(key) ||
    raw.cacheKey !== oh(key) ||
    r.cacheKey !== raw.cacheKey ||
    r.cacheFileHash !== (await hash(rawFile)) ||
    r.resultHash !== oh(raw.raw) ||
    r.modelHash !== fixed.model.modelHash ||
    r.runtime !== oh(fixed.model) ||
    r.promptHash !== oh("") ||
    r.decodeHash !== oh(fixed.model.decode) ||
    e.source.sha256 !== u.audioHash ||
    e.source.durationSeconds !== u.seconds ||
    r.interval.start !== 0 ||
    r.interval.end !== u.seconds ||
    oh(r.segments) !==
      oh(
        raw.raw.segments.map((s, i) => ({
          id: u.id + "-s" + i,
          start: s.start,
          end: s.end,
          text: s.text,
        })),
      )
  )
    throw Error("PRIMARY_EVIDENCE_IDENTITY_INVALID: " + u.id);
  credentials.push({
    id: u.id,
    inputHash: await hash(file),
    responseHash: await hash(rawFile),
    originalPromptStatus: e.promptStatus,
    modelHash: r.modelHash,
    runtime: r.runtime,
    promptHash: r.promptHash,
    decodeHash: r.decodeHash,
    sourceOffset: u.sourceOffset,
    seconds: u.seconds,
    audioHash: u.audioHash,
    replayIdentity: "VERIFIED_EVIDENCE_REPLAY",
  });
}

import { loadReazonK2ModelIdentity } from "../packages/video-subtitler/dist/machine-quality/reazonspeech-k2-provider.js";
import {
  SAME_UNIT_POLICY,
  checkSameUnitDurations,
} from "../packages/video-subtitler/dist/machine-quality/same-unit-candidate.js";
import { pcmIdentity, implementationIdentity } from "./c60118-common.mjs";
const baseline = path.resolve(baselineArg),
  runtime = read(runtimeArg);
for (const f of [
  "input-freeze.json",
  "generation-freeze.json",
  "run-a-freeze.json",
  "run-b-freeze.json",
])
  verify(baseline, f);
const baselineReceipt = read(
  path.join(baseline, "input-receipt.local-only.json"),
);
if (baselineReceipt.oldRoot !== old)
  throw Error("BASELINE_UNIT_SOURCE_MISMATCH");
const model = await loadReazonK2ModelIdentity(runtime.reazonModel);
const runtimeMetadata = JSON.parse(
  execFileSync(
    runtime.reazonPython,
    [
      "-c",
      "import sys,importlib.metadata,json;print(json.dumps({'python':sys.version,'sherpa':importlib.metadata.version('sherpa-onnx'),'numpy':importlib.metadata.version('numpy')}))",
    ],
    {
      encoding: "utf8",
      env: { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: "1" },
    },
  ),
);
const metadataExpected = JSON.parse(runtime.expectedMetadata);
if (oh(metadataExpected) !== oh(runtimeMetadata))
  throw Error("INSTALLED_RUNTIME_IDENTITY_DRIFT");
const units = [];
for (const u of m.units) {
  const identity = pcmIdentity(path.join(old, u.audio));
  if (
    identity.wavHash !== u.audioHash ||
    identity.sampleCount !== u.sampleCount ||
    identity.seconds !== u.seconds
  )
    throw Error("WAV_IDENTITY_MISMATCH");
  if (
    (await hash(path.join(old, "generator-input", u.id + ".json"))) !==
    (await hash(path.join(baseline, "generator-input", u.id + ".json")))
  )
    throw Error("BASELINE_PRIMARY_DRIFT");
  units.push({ ...u, ...identity });
}
const durations = checkSameUnitDurations(units.map((u) => u.seconds));
const date = new Date()
  .toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" })
  .replaceAll("-", "");
fs.mkdirSync(parentArg, { recursive: true });
const root = fs.mkdtempSync(
  path.join(path.resolve(parentArg), "machine-quality-c6-0-1-18-" + date + "-"),
);
for (const u of units) {
  fs.mkdirSync(path.join(root, "audio"), { recursive: true });
  fs.copyFileSync(
    path.join(old, u.audio),
    path.join(root, u.audio),
    fs.constants.COPYFILE_EXCL,
  );
  write(
    path.join(root, "generator-input", u.id + ".json"),
    fs.readFileSync(path.join(old, "generator-input", u.id + ".json"), "utf8"),
  );
  write(
    path.join(root, "evidence/whisper-frozen", u.id + ".json"),
    fs.readFileSync(path.join(old, "evidence", u.id + ".json"), "utf8"),
  );
}
const plan = {
  version: "c60118-v1",
  units,
  model,
  runtime: runtimeMetadata,
  host: {
    os: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cpu: os.cpus()[0]?.model ?? "unknown",
  },
  policy: SAME_UNIT_POLICY,
  durations,
  logicalTasks: units.length,
  runtimePythonHash: await hash(fs.realpathSync(runtime.reazonPython)),
  identityFiles: runtime.identityFiles,
  baselineCommit: "48b6dcb180690a0cb29d1da8af68a74c18b4fe13",
  cachePolicy: "EXACT_IDENTITY_ONLY; prior different physical clips ineligible",
  G11: {
    interCuePolicy: "overlap-required",
    intraCuePolicy: "source-preserving",
    acoustic: false,
    stored: false,
    groups: false,
  },
};
for (const f of plan.identityFiles)
  if ((await hash(f.path)) !== f.sha256)
    throw Error("RUNTIME_FILE_HASH_MISMATCH");
write(path.join(root, "request-plan.json"), plan);
write(path.join(root, "runtime.local-only.json"), {
  reazonPython: runtime.reazonPython,
  reazonModel: runtime.reazonModel,
});
write(
  path.join(root, "implementation-identity.json"),
  implementationIdentity(),
);
write(path.join(root, "input-receipt.local-only.json"), {
  oldRoot: old,
  baselineRoot: baseline,
  credentials,
  oldDatasetFreezeHash: await hash(path.join(old, "dataset-freeze.json")),
  referenceManifestHash: read(path.join(old, "dataset-freeze.json")).files[
    "dataset/evaluation-only/reference-manifest.json"
  ],
  referenceIdentityCheck:
    "HASH_ONLY before model; existing closure credential reused; prior human preparation and historical evaluation disclosed",
  dataExposure: "KNOWN_DEVELOPMENT_RECHECK",
  routeRule:
    "paired incomplete -> incomplete; negative aggregate R0-W0 with multi-unit benefits -> gain; otherwise positive oracle -> selective complementarity; else no whole-unit gain; exact tradeoffs separately",
  oracleDefinition:
    "sum(Ew)-sum(min(Ew,Er)); whole-unit diagnostic only; no generation consumption",
});
freeze(
  root,
  "model-input-freeze.json",
  [
    "request-plan.json",
    "runtime.local-only.json",
    "implementation-identity.json",
  ]
    .map((f) => path.join(root, f))
    .concat(walk(path.join(root, "audio"))),
);
freeze(
  root,
  "input-freeze.json",
  [
    "model-input-freeze.json",
    "input-receipt.local-only.json",
    ...walk(path.join(root, "generator-input")).map((f) =>
      path.relative(root, f),
    ),
    ...walk(path.join(root, "evidence/whisper-frozen")).map((f) =>
      path.relative(root, f),
    ),
  ].map((f) => path.join(root, f)),
);
console.log(root);
