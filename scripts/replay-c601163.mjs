import fs from "node:fs";
import { TextDecoder } from "node:util";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { z } from "zod";
import {
  acousticBundleSchema,
  observationSchema,
} from "../packages/video-subtitler/dist/machine-quality/bounded-acoustic.js";
import {
  consumeStoredWhisper,
  storedBundleSchema,
  STORED_TOKEN_POLICY,
} from "../packages/video-subtitler/dist/machine-quality/stored-token-span.js";
import { QUALITY_EVALUATION_POLICY } from "../packages/video-subtitler/dist/machine-quality/experimental-metrics.js";
import {
  sha256,
  objectHash,
} from "../packages/video-subtitler/dist/machine-quality/experimental-profile.js";
const [oldArg, outArg] = process.argv.slice(2);
const oldDir = path.resolve(oldArg),
  output = path.resolve(outArg),
  repo = path.resolve(import.meta.dirname, "..");
const read = (p) => JSON.parse(fs.readFileSync(p));
const oldBundleFile = path.join(oldDir, "evidence/frozen.json"),
  primaryFile = path.join(oldDir, "machine-evidence.json");
const oldBytes = fs.readFileSync(oldBundleFile),
  old = acousticBundleSchema.parse(JSON.parse(oldBytes));
const planBytes = fs.readFileSync(path.join(oldDir, "experiment-plan.json")),
  plan = JSON.parse(planBytes);
if (
  sha256(planBytes) !== old.planHash ||
  sha256(fs.readFileSync(primaryFile)) !== old.primaryHash
)
  throw Error("Old input identity mismatch");
if (objectHash(plan.evaluationPolicy) !== objectHash(QUALITY_EVALUATION_POLICY))
  throw Error("Fixed evaluation policy mismatch");
const inputs = [],
  observations = [];
for (const req of plan.requests) {
  const file = path.join(oldDir, `requests/${req.id}.json`),
    bytes = fs.readFileSync(file),
    r = JSON.parse(bytes);
  if (
    r.requestHash !== objectHash(req) ||
    r.planHash !== old.planHash ||
    r.observationHash !== objectHash(r.observation) ||
    r.observation.resultHash !== objectHash(r.raw) ||
    objectHash(observationSchema.parse(r.observation)) !==
      objectHash(old.observations.find((o) => o.requestId === req.id))
  )
    throw Error("Persisted response identity mismatch");
  if (
    r.observation.audioHash !== req.audioHash ||
    r.observation.window.start !== req.window.start ||
    r.observation.window.end !== req.window.end ||
    r.observation.timebase !== "source-global-once"
  )
    throw Error("Request source time mapping mismatch");
  inputs.push({
    requestId: req.id,
    family: req.family,
    responseHash: sha256(bytes),
    request: req,
    rawResultHash: objectHash(r.raw),
  });
  if (req.family !== "whisper") continue;
  const rawBytes = fs.readFileSync(
    path.join(oldDir, `requests/${req.id}.raw.json`),
  );
  const full = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(rawBytes),
  );
  if (objectHash(full) !== objectHash(r.raw.raw.fullJson))
    throw Error("Full JSON persistence mismatch");
  const c = old.cases.find((c) => c.bindingHash === req.caseBindingHash);
  if (!c) throw Error("Missing source case");
  observations.push(
    consumeStoredWhisper(full, {
      requestId: req.id,
      caseBindingHash: c.bindingHash,
      windowId: req.windowId,
      audioHash: r.observation.audioHash,
      window: r.observation.window,
      rawFileHash: sha256(rawBytes),
      sourceRequestIds: c.sourceRequestIds,
      occurrenceIds: c.occurrenceIds,
    }),
  );
}
if (
  inputs.length !== plan.requests.length ||
  new Set(inputs.map((i) => i.requestId)).size !== inputs.length
)
  throw Error("Response cardinality mismatch");
const bundle = storedBundleSchema.parse({
  version: "c601163-token-span-evidence-v1",
  strategy: STORED_TOKEN_POLICY.version,
  primaryHash: old.primaryHash,
  oldEvidenceHash: sha256(oldBytes),
  policyHash: objectHash(STORED_TOKEN_POLICY),
  cases: old.cases,
  observations,
});
fs.mkdirSync(output);
const write = (name, v) => {
  const p = path.join(output, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, typeof v === "string" ? v : JSON.stringify(v, null, 2), {
    flag: "wx",
    flush: true,
  });
};
write("token-span-evidence.json", bundle);
write("cases.machine.json", old.cases);
write("experiment-plan.json", {
  evaluationPolicy: plan.evaluationPolicy,
  requests: plan.requests,
  strategy: STORED_TOKEN_POLICY,
  originalPlanHash: old.planHash,
});
write("input-verification.json", {
  mode: "VERIFIED_RESPONSE_REPLAY",
  originalPlanHash: old.planHash,
  primaryHash: old.primaryHash,
  oldEvidenceHash: sha256(oldBytes),
  inputs,
  originalModelRuntimeIdentity: plan.models ?? plan.runtime ?? plan,
  originalDecodeIdentity: plan.decode,
  derivedEvidenceMode: "DERIVED_FROM_FROZEN_RESPONSES",
  newRecognitionAttempts: 0,
  newInferenceCount: 0,
  newModelLoads: 0,
  newProviderStarts: 0,
  newDecodedAudioSeconds: 0,
});
write(
  "validation/token-span-evidence.schema.json",
  z.toJSONSchema(storedBundleSchema),
);
const hashes = {},
  manifests = {};
for (const run of ["run-a", "run-b"]) {
  const target = path.join(output, run),
    bundleFile = path.join(output, "token-span-evidence.json");
  if (process.platform !== "darwin" || !fs.existsSync("/usr/bin/sandbox-exec"))
    throw Error(
      "This replay requires the verified macOS network-denial wrapper",
    );
  execFileSync(
    "/usr/bin/sandbox-exec",
    [
      "-p",
      "(version 1)(allow default)(deny network*)",
      process.execPath,
      "--permission",
      "--allow-fs-read=" + repo,
      "--allow-fs-read=" + primaryFile,
      "--allow-fs-read=" + oldBundleFile,
      "--allow-fs-read=" + bundleFile,
      "--allow-fs-read=" + target,
      "--allow-fs-read=" + target + "/*",
      "--allow-fs-write=" + target,
      "--allow-fs-write=" + target + "/*",
      path.join(repo, "scripts/generate-c601163.mjs"),
      primaryFile,
      oldBundleFile,
      bundleFile,
      target,
    ],
    {
      stdio: "inherit",
      env: { PATH: process.env.PATH, LANG: "en_US.UTF-8", TZ: "UTC" },
    },
  );
  hashes[run] = read(path.join(target, "experiment-manifest.json")).files;
  manifests[run] = sha256(
    fs.readFileSync(path.join(target, "experiment-manifest.json")),
  );
}
if (objectHash(hashes["run-a"]) !== objectHash(hashes["run-b"]))
  throw Error("Final A/B parity mismatch");
for (const ext of ["ass", "srt", "vtt"]) {
  if (
    !fs
      .readFileSync(
        path.join(output, `run-a/S0-legacy-policy/machine-candidate.${ext}`),
      )
      .equals(
        fs.readFileSync(
          path.join(
            oldDir,
            `run-a/E1-acoustic-decision/machine-candidate.${ext}`,
          ),
        ),
      )
  )
    throw Error("S0 old export mismatch");
}
write("generation-freeze.json", {
  version: "c601163-dual-freeze-v1",
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repo,
    encoding: "utf8",
  }).trim(),
  planHash: sha256(fs.readFileSync(path.join(output, "experiment-plan.json"))),
  evidenceHash: sha256(
    fs.readFileSync(path.join(output, "token-span-evidence.json")),
  ),
  policyHash: bundle.policyHash,
  runs: hashes,
  manifests,
  metadata: Object.fromEntries(
    [
      "cases.machine.json",
      "input-verification.json",
      "validation/token-span-evidence.schema.json",
    ].map((p) => [p, sha256(fs.readFileSync(path.join(output, p)))]),
  ),
  frozenAt: new Date().toISOString(),
  deterministicFixedEvidenceParity: true,
  generationIsolation:
    "Node24 permission: exact machine inputs/output; no child/addon; macOS sandbox denies network",
  newRecognitionAttempts: 0,
  newInferenceCount: 0,
  newModelLoads: 0,
  newProviderStarts: 0,
  newDecodedAudioSeconds: 0,
});
write("experiment-manifest.json", {
  version: "c601163-experiment-v1",
  mode: "DERIVED_FROM_FROZEN_RESPONSES",
  primaryHash: old.primaryHash,
  policyHash: bundle.policyHash,
  generationFreezeHash: sha256(
    fs.readFileSync(path.join(output, "generation-freeze.json")),
  ),
  outputs: [
    "run-a/S0-legacy-policy",
    "run-a/S1-token-observe",
    "run-a/S2-token-apply",
    "run-b/S0-legacy-policy",
    "run-b/S1-token-observe",
    "run-b/S2-token-apply",
  ],
  status: "needs-review",
  finalizationMethod: "none",
  defaultPromotionAuthorized: false,
  machineOnlyReleaseAuthorized: false,
  humanValidated: false,
});
write(
  "OUTPUT_INDEX.md",
  "# Stored token-span experiment\n\nThis local research output is not a public-shareable package. Raw machine responses and source paths are retained for provenance.\n\n- `token-span-evidence.json`: complete persisted raw/token evidence\n- `input-verification.json`: 12 verified existing responses, runtime/model/decode identity\n- `run-a/decisions.json`: six candidates and three target decisions\n- `run-a/S2-token-apply/machine-candidate.ass` (also SRT/VTT): experimental subtitles\n- `run-a/S0-legacy-policy/`, `run-a/S1-token-observe/`: controls\n- `run-b/`: independent deterministic generation\n- `generation-freeze.json`: pre-reference freeze\n- `evaluation/metrics.json`, `evaluation/cue-diff.csv`, `evaluation/changes.md`: post-freeze reference evaluation\n\nAll outputs remain needs-review; no automatic finalization or release.\n",
);
console.log(
  "Frozen two independent S0/S1/S2 runs; old exports exact; zero inference",
);
