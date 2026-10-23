import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  acousticBundleSchema,
  observationSchema,
  ACOUSTIC_POLICY,
} from "../packages/video-subtitler/dist/machine-quality/bounded-acoustic.js";
import {
  AUDIT_VERSION,
  providerCapabilities,
  checkActionCapabilities,
  auditDecision,
  replayNormalization,
  auditPoints,
  auditWhisper,
} from "../packages/video-subtitler/dist/machine-quality/timestamp-capability-audit.js";
import { objectHash } from "../packages/video-subtitler/dist/machine-quality/experimental-profile.js";

const [oldDirectory, outputDirectory, semanticsFile] = process.argv.slice(2);
if (!oldDirectory || !outputDirectory || !semanticsFile)
  throw Error(
    "Usage: audit-c6011621 old-experiment new-audit-directory verified-semantics-metadata.json; no models or reference arguments",
  );
const old = path.resolve(oldDirectory),
  output = path.resolve(outputDirectory),
  repo = path.resolve(import.meta.dirname, "..");
if (output === old || output.startsWith(old + path.sep))
  throw Error("Never write inside old experiment");
const inputs = [];
const hash = (b) => createHash("sha256").update(b).digest("hex");
const bytes = (p) => {
  const b = fs.readFileSync(p);
  inputs.push({ path: p, sha256: hash(b) });
  return b;
};
const read = (p) => JSON.parse(bytes(p));
const safe = (rel) => {
  const p = path.resolve(old, rel);
  if (!p.startsWith(old + path.sep)) throw Error("Escaping artifact path");
  return p;
};
const plan = read(safe("experiment-plan.json")),
  planHash = hash(fs.readFileSync(safe("experiment-plan.json")));
const pre = read(safe("pre-inference-freeze.json")),
  cases = read(safe("cases.machine.json"));
const bundleFile = safe("evidence/frozen.json"),
  bundle = acousticBundleSchema.parse(read(bundleFile));
const execution = read(safe("execution-summary.json"));
const generation = read(safe("generation-freeze.json"));
const ledger = bytes(safe("requests/attempts.jsonl"))
  .toString()
  .trim()
  .split("\n")
  .map(JSON.parse);
const semantics = read(path.resolve(semanticsFile));
if (
  bundle.planHash !== planHash ||
  pre.planHash !== planHash ||
  plan.casesHash !== objectHash(cases) ||
  objectHash(bundle.cases) !== objectHash(cases) ||
  bundle.policyHash !== objectHash(ACOUSTIC_POLICY) ||
  execution.evidenceHash !== hash(fs.readFileSync(bundleFile)) ||
  generation.evidenceHash !== execution.evidenceHash ||
  pre.sourceCommit !== generation.sourceCommit
)
  throw Error("Frozen identity mismatch");
if (hash(bytes(safe("machine-evidence.json"))) !== bundle.primaryHash)
  throw Error("Primary identity mismatch");
if (
  plan.requests.length !== 12 ||
  new Set(plan.requests.map((r) => r.id)).size !== 12 ||
  ledger.length !== 12 ||
  ledger.some((r) => r.planHash !== planHash)
)
  throw Error("Historical cohort identity mismatch");
const responses = [],
  normalized = [];
for (const req of plan.requests) {
  const p = safe(`requests/${req.id}.json`);
  if (!fs.existsSync(p))
    throw Error("RESPONSE_AUDIT_BLOCKED_MISSING_ARTIFACTS: " + req.id);
  const saved = read(p),
    o = observationSchema.parse(saved.observation);
  if (
    saved.requestHash !== objectHash(req) ||
    saved.planHash !== planHash ||
    saved.observationHash !== objectHash(saved.observation) ||
    o.resultHash !== objectHash(saved.raw) ||
    objectHash(o) !==
      objectHash(bundle.observations.find((x) => x.requestId === req.id))
  )
    throw Error("Response identity mismatch: " + req.id);
  const replayed = replayNormalization(o, saved.raw);
  if (objectHash(replayed) !== objectHash(o))
    throw Error("Normalization replay differs: " + req.id);
  normalized.push(replayed);
  if (hash(bytes(safe(req.audio))) !== req.audioHash)
    throw Error("Audio identity mismatch");
  const c = bundle.cases.find((c) => c.bindingHash === req.caseBindingHash);
  if (!c) throw Error("Missing case");
  let audit;
  if (req.family === "reazon") {
    const r = saved.raw.results[0];
    audit = auditPoints(r.tokenPoints, {
      window: o.window,
      core: c.core,
      padding: plan.decode.reazon.paddingSecondsEachSide,
      semantics: semantics.reazon.status,
    });
    audit.tokenTextRelationship = {
      tokenConcatenationEqualsText:
        r.tokenPoints
          .map((p) => p.token)
          .join("")
          .trim() === r.text,
      notCardinalityProof: true,
    };
  } else {
    const full = read(safe(`requests/${req.id}.raw.json`)),
      processRecord = read(safe(`requests/${req.id}.process.json`));
    if (objectHash(full) !== objectHash(saved.raw.raw.fullJson))
      throw Error("Whisper full JSON mismatch");
    if (
      !processRecord.args.includes("--output-json-full") ||
      processRecord.args.includes("--prompt")
    )
      throw Error("Whisper argument mismatch");
    audit = auditWhisper(
      full,
      saved.raw.segments.reduce((n, s) => n + (s.tokens?.length ?? 0), 0),
      o,
      c.core,
    );
  }
  responses.push({
    requestId: req.id,
    present: "VERIFIED_RESPONSE_REPLAY",
    rawHash: o.resultHash,
    observationHash: objectHash(o),
    parserVersion: AUDIT_VERSION,
    oldPlanHash: planHash,
    family: req.family,
    sourceWindow: req.window,
    legacyTimingKind: o.timingKind,
    audit,
  });
}
const identities = Object.fromEntries(
  ["whisper", "reazon"].map((f) => {
    const rel =
      f === "whisper"
        ? "packages/transcription-core/src/local.ts"
        : "packages/video-subtitler/src/machine-quality/reazonspeech-k2-provider.ts";
    return [
      f,
      {
        adapterHash: hash(bytes(path.join(repo, rel))),
        runtime: plan.models[f],
        model:
          f === "reazon" ? plan.models[f].identity : plan.models[f].modelHash,
        config: plan.decode[f],
      },
    ];
  }),
);
const caps = providerCapabilities(identities),
  checks = checkActionCapabilities(caps, ACOUSTIC_POLICY, "OBSERVATION_ONLY");
const decisionRows = bundle.cases.map((c) => auditDecision(c, normalized));
const legacy = read(safe("run-a/decisions.json"));
if (objectHash(legacy) !== objectHash(decisionRows.map((r) => r.decision)))
  throw Error("L0 decision differs");
const subtitleHashes = [];
for (const [run, files] of Object.entries(generation.runs))
  for (const f of files) {
    if (hash(bytes(safe(`${run}/${f.path}`))) !== f.sha256)
      throw Error("Historical generation changed");
    if (/\.(ass|srt|vtt)$/.test(f.path))
      subtitleHashes.push({ path: `${run}/${f.path}`, sha256: f.sha256 });
  }
const counts = responses
  .filter((r) => r.family === "reazon")
  .flatMap((r) => r.audit.rows)
  .reduce((a, r) => ((a[r.region] = (a[r.region] ?? 0) + 1), a), {});
const totals = {
  historicalAttempts: ledger.length,
  historicalRawSeconds: ledger.reduce((n, r) => n + r.audioSeconds, 0),
  historicalDecodedSeconds: ledger.reduce((n, r) => n + r.decodedSeconds, 0),
  verifiedResponseReplay: responses.length,
  newInferenceCount: 0,
  newModelLoadCount: 0,
  newProviderStartCount: 0,
  newRecognitionAttemptCount: 0,
  newDecodedAudioSeconds: 0,
};
const stable = {
  matrix: {
    version: AUDIT_VERSION,
    providers: caps,
    checks,
    fieldFlow: {
      whisper:
        "raw full JSON token intervals -> adapter segment.tokens -> omitted by experiment observation -> localizer uses only segments",
      reazon:
        "worker zip points -> provider pass-through -> padding subtracted and source start added once -> TOKEN_POINTS complete=false",
    },
    semantics,
  },
  responses,
  decisionRows,
  totals,
  counts,
};
const repeat = {
  ...stable,
  decisionRows: bundle.cases.map((c) => auditDecision(c, normalized)),
  responses: responses.map((r) => ({ ...r })),
};
if (objectHash(stable) !== objectHash(repeat))
  throw Error("Audit determinism failed");
for (const input of inputs)
  if (hash(fs.readFileSync(input.path)) !== input.sha256)
    throw Error("Audit input changed");
fs.mkdirSync(output);
const write = (name, value) =>
  fs.writeFileSync(
    path.join(output, name),
    typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n",
    { flag: "wx" },
  );
write("provider-action-matrix.json", stable.matrix);
write("response-timestamp-audit.json", {
  version: AUDIT_VERSION,
  layer: "SEMANTIC_AUDIT_SHADOW",
  responses,
  pointRegions: counts,
  decisionEligible: false,
});
write("reachability-report.json", {
  version: AUDIT_VERSION,
  legacyLayer: "LEGACY_REPLAY",
  shadowLayer: "SEMANTIC_AUDIT_SHADOW",
  checks,
  cases: decisionRows,
  subtitleHashes,
  legacyDecisionsUnchanged: true,
  stop: checks.stop,
});
write("audit-manifest.json", {
  version: AUDIT_VERSION,
  base: "5f1c08a53045dd32121b54482820f7f27d2ec197",
  auditedAt: new Date().toISOString(),
  inputDirectory: old,
  inputs,
  semantics,
  totals,
  stableAuditHash: objectHash(stable),
  dataset: "DEVELOPMENT_KNOWN",
  goldRead: false,
  quality: "NOT_EVALUATED_NO_SUBTITLE_CHANGE",
  historicalMetrics: "INHERITED_BASELINE_METRICS_NOT_REEVALUATED",
  defaultPromotionAuthorized: false,
  sourceFiles: [
    "packages/video-subtitler/src/machine-quality/timestamp-capability-audit.ts",
    "scripts/audit-c6011621.mjs",
  ].map((p) => ({
    path: p,
    sha256: hash(fs.readFileSync(path.join(repo, p))),
  })),
});
write("validation.json", {
  version: AUDIT_VERSION,
  totals,
  strictBundleParse: "passed",
  responseHashes: "12/12 verified",
  normalizationReplay: "12/12 exact",
  legacyDecisionParity: "3/3 exact",
  frozenPayloads: "unchanged",
  deterministicAudit: true,
  noApplyInShadow: true,
  executionBoundary:
    "Run under Node permissions without child process, addons or network permission; audit module imports no provider runtime",
  subtitleHashes,
});
write(
  "AUDIT_INDEX.md",
  "# Timestamp capability audit\n\nRead provider-action-matrix.json for structural compatibility, response-timestamp-audit.json for all preserved points and token diagnostics, reachability-report.json for each case condition, and audit-manifest.json for identities and counters.\n\nL0 reproduces old decisions. L1 is read-only and never enters applyAcousticDecisions. No new subtitles, audio, model execution or Gold evaluation. STOP_SAME_POLICY_REINFERENCE. Local-only transcripts and paths: not public-shareable.\n",
);
console.log(
  JSON.stringify({
    output,
    totals,
    counts,
    actions: checks.actions,
    whisper: responses
      .filter((r) => r.family === "whisper")
      .map((r) => ({
        request: r.requestId,
        returned: r.audit.returned,
        parsed: r.audit.parsed,
        shadow: r.audit.shadowCoreIntervals.length,
      })),
    legacyDecisions: decisionRows.map((r) => ({
      case: r.caseId,
      action: r.decision.action,
      isolated: r.conditions.isolated,
    })),
  }),
);
