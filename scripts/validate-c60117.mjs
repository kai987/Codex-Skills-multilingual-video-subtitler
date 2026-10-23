import fs from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { z } from "zod";
import { subtitlePackageSchema } from "../packages/shared/dist/index.js";
import { freshMatchedEvidenceSchema } from "../packages/video-subtitler/dist/machine-quality/matched-replay.js";
import {
  representativeClipSchema,
  reserveAttempt,
} from "../packages/video-subtitler/dist/machine-quality/representative-clips.js";
import {
  read,
  write,
  verify,
  digest,
  oh,
  walk,
  repo,
  wavInfo,
  VARIANTS,
} from "./c60117-common.mjs";
const [rootArg] = process.argv.slice(2),
  root = path.resolve(rootArg);
const dataset = read(path.join(root, "dataset-selection.json")),
  plan = read(path.join(root, "evidence-plan.json"));
verify(root, "dataset-freeze.json");
verify(root, "pre-inference-freeze.json");
verify(root, "evidence-D-freeze.json");
verify(root, "evidence-C-freeze.json");
const selection = read(path.join(root, "selected-config.json"));
const ajv = new Ajv2020({ strict: false });
const schemas = {
  clip: z.toJSONSchema(representativeClipSchema),
  fresh: z.toJSONSchema(freshMatchedEvidenceSchema),
};
const shape = Object.fromEntries(
  Object.entries(schemas).map(([k, s]) => [k, ajv.compile(s)]),
);
for (const c of dataset.clips) {
  representativeClipSchema.parse(c);
  if (!shape.clip(c)) throw Error("Clip schema invalid");
  for (const x of dataset.clips)
    if (x.id !== c.id && x.start < c.end + 1 && x.end > c.start - 1)
      throw Error("Overlapping selection");
  if (dataset.exclusions.some((x) => c.start < x.end && c.end > x.start))
    throw Error("Old-tail intersection");
}
if (dataset.clips.length !== 12) throw Error("Main sample count mismatch");
for (const s of ["coverage", "machine-risk", "low-risk"])
  for (const p of ["D", "C"])
    if (
      dataset.clips.filter((c) => c.stratum === s && c.partition === p)
        .length !== 2
    )
      throw Error("Unbalanced partition");
const attempts = walk(path.join(root, "attempts"))
  .filter((p) => p.endsWith(".reserved.json"))
  .map(read);
const charged = [];
for (const a of attempts)
  charged.push(reserveAttempt(charged, a.inputSeconds, a.retry));
if (attempts.length !== plan.requests.length || attempts.length !== 24)
  throw Error("Missing or duplicate attempts");
for (const r of plan.requests) {
  if (
    oh(r.key) !== r.cacheKey ||
    r.key.prompt !== "" ||
    r.key.timebase !== "original-audio-local"
  )
    throw Error("Request identity mismatch");
  const wav = wavInfo(path.join(root, r.audio));
  if (
    oh(wav) !==
      oh({
        sampleRate: r.sampleRate,
        sampleCount: r.sampleCount,
        seconds: r.seconds,
      }) ||
    digest(fs.readFileSync(path.join(root, r.audio))) !== r.audioHash
  )
    throw Error("Audio mismatch");
  const e = read(path.join(root, "evidence", r.id + ".json"));
  if (e.cacheKey !== r.cacheKey || e.rawHash !== oh(e.raw))
    throw Error("Evidence receipt mismatch");
  if (r.provider === "whisper") {
    const invocation = read(path.join(root, "attempts", r.id + ".args.json"));
    if (
      invocation.args.some((x) =>
        ["--prompt", "--vad", "--translate"].includes(x),
      ) ||
      invocation.args[invocation.args.indexOf("--max-context") + 1] !== "0"
    )
      throw Error("Prompt/context violation");
    const payload = read(
      path.join(root, "generator-input", r.clipId + ".json"),
    );
    freshMatchedEvidenceSchema.parse(payload);
    if (
      !shape.fresh(payload) ||
      payload.primaryRequests[0].resultHash !== e.rawHash
    )
      throw Error("Fresh payload identity/schema mismatch");
  } else if (!Array.isArray(e.raw.results[0].tokenPoints))
    throw Error("Missing point-only AUX evidence");
}
let packages = 0;
const parity = [];
for (const partition of ["d", "c"]) {
  const a = partition + "-final-a",
    b = partition + "-final-b";
  verify(root, a + "-freeze.json");
  verify(root, b + "-freeze.json");
  const fa = walk(path.join(root, a)),
    fb = walk(path.join(root, b));
  if (fa.length !== fb.length) throw Error("A/B file count mismatch");
  for (const file of fa) {
    const relative = path.relative(path.join(root, a), file),
      other = path.join(root, b, relative);
    if (digest(fs.readFileSync(file)) !== digest(fs.readFileSync(other)))
      throw Error("A/B parity mismatch: " + relative);
  }
  for (const clip of dataset.clips.filter(
    (c) => c.partition.toLowerCase() === partition,
  )) {
    const folder = path.join(root, a, clip.id);
    for (const variant of VARIANTS) {
      const pkg = subtitlePackageSchema.parse(
        read(path.join(folder, variant, "subtitle-package.needs-review.json")),
      );
      if (pkg.primarySubtitle.validationStatus !== "needs-review")
        throw Error("Unreviewed promotion");
      const state = read(path.join(folder, variant, "generation-state.json"));
      if (
        state.status !== "needs-review" ||
        state.finalizationMethod !== "none" ||
        state.humanValidated ||
        state.defaultPromotionAuthorized ||
        state.machineOnlyReleaseAuthorized
      )
        throw Error("Unsafe final state");
      packages++;
    }
    for (const ext of ["ass", "srt", "vtt"]) {
      const p = (v) =>
        fs.readFileSync(path.join(folder, v, "machine-candidate." + ext));
      if (digest(p(VARIANTS[1])) !== digest(p(VARIANTS[3])))
        throw Error("Disabled repair differs from P1");
    }
  }
  parity.push({ partition, files: fa.length, byteIdentical: true });
}
const final = verify(root, "final-code-config-freeze.json");
const finalCode = read(path.join(root, "final-code-identity.json"));
for (const [p, h] of Object.entries(finalCode))
  if (digest(fs.readFileSync(path.join(repo, p))) !== h)
    throw Error("Post-freeze implementation changed: " + p);
const whisperProcesses = walk(path.join(root, "attempts"))
  .filter((p) => p.endsWith("-whisper.process.json"))
  .map(read);
const ready = walk(path.join(root, "attempts"))
  .filter((p) => p.endsWith(".ready.json"))
  .map(read);
if (whisperProcesses.some((p) => p.exitCode !== 0))
  throw Error("Failed primary process");
const whisperLoads = whisperProcesses.length,
  reazonLoads = ready.reduce((n, r) => n + r.modelLoadCount, 0);
const counters = {
  logicalTasks: plan.requests.length,
  attempts: attempts.length,
  inferences: plan.requests.length,
  cacheHits: 0,
  failedExecutions: walk(path.join(root, "attempts")).filter((p) =>
    p.endsWith(".failure.json"),
  ).length,
  retries: attempts.filter((a) => a.retry).length,
  whisperInferences: plan.requests.filter((r) => r.provider === "whisper")
    .length,
  reazonInferences: plan.requests.filter((r) => r.provider === "reazon").length,
  whisperModelLoads: whisperLoads,
  reazonModelLoads: reazonLoads,
  modelLoads: whisperLoads + reazonLoads,
  modelProcessStarts:
    whisperProcesses.length +
    ready.reduce((n, r) => n + r.processStartCount, 0),
  physicalClips: dataset.clips.length,
  uniquePhysicalAudioSeconds: dataset.clips.reduce(
    (n, c) => n + c.end - c.start,
    0,
  ),
  chargedModelInputSeconds: attempts.reduce((n, a) => n + a.inputSeconds, 0),
  newVad: 0,
  newCTC: 0,
  newMFA: 0,
  newSpeaker: 0,
};
if (counters.failedExecutions)
  throw Error("Unexpected failure; reconcile counters before acceptance");
const result = {
  version: "c60117-validation-v1",
  passed: true,
  strictSchemas: true,
  packagesValidated: packages,
  independentABParity: parity,
  repairDisabledEqualsP1: true,
  selectedRepair: selection.repair,
  configFrozenAt: final.frozenAt,
  counters,
  status: "needs-review",
  finalizationMethod: "none",
  machineOnlyReleaseAuthorized: false,
  defaultPromotionAuthorized: false,
};
write(path.join(root, "validation.json"), result);
write(path.join(root, "schemas/clip.schema.json"), schemas.clip);
write(path.join(root, "schemas/fresh-evidence.schema.json"), schemas.fresh);
console.log(JSON.stringify(result, null, 2));
