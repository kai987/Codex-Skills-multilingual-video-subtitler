// Zero-execution reader: run with Node permissions denying subprocesses/addons.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  AUDIT_ZERO_EXECUTION,
  auditExit,
  auditWave,
  assertExactIds,
  expectedLengths,
  objectHash,
  outputStatistics,
  publicCoverage,
  savedResponseSchema,
  tokenTableContract,
  verifyTextChain,
  normalizedAuditText,
} from "../packages/video-subtitler/dist/machine-quality/reazon-runtime-audit.js";

const [oldArg, failedArg, parentArg, sourcesArg] = process.argv.slice(2);
if (![oldArg, failedArg, parentArg, sourcesArg].every(Boolean))
  throw Error(
    "Usage: audit-c601181 OLD_COMPLETED OLD_STARTUP_FAILED OUTPUT_PARENT PINNED_SOURCE_DIRECTORY",
  );
const old = fs.realpathSync.native(oldArg),
  failed = fs.realpathSync.native(failedArg),
  sources = fs.realpathSync.native(sourcesArg);
const parent = fs.realpathSync.native(parentArg);
if (
  [old, failed, sources].some(
    (p) => parent === p || parent.startsWith(p + path.sep),
  )
)
  throw Error("OUTPUT_INSIDE_INPUT");
const inspected = new Map();
const digest = (b) => createHash("sha256").update(b).digest("hex");
const bytes = (p) => {
  const b = fs.readFileSync(p);
  inspected.set(p, { size: b.length, sha256: digest(b) });
  return b;
};
const read = (p) => JSON.parse(bytes(p).toString("utf8"));
const oldPath = (relative) => {
  const p = fs.realpathSync.native(path.resolve(old, relative));
  if (!p.startsWith(old + path.sep)) throw Error("INPUT_PATH_ESCAPE");
  return p;
};
const eq = (a, b, code) => {
  if (objectHash(a) !== objectHash(b)) throw Error(code);
};
const plan = read(oldPath("request-plan.json")),
  planHash = objectHash(plan);
const modelFreeze = read(oldPath("model-input-freeze.json"));
for (const [p, h] of Object.entries(modelFreeze.files))
  eq(digest(bytes(oldPath(p))), h, "MODEL_INPUT_FREEZE_DRIFT");
const pins = read(path.join(sources, "pins.json")),
  network = read(path.join(sources, "network-receipt.json"));
for (const s of network.filter((s) => s.status === 200))
  eq(digest(bytes(path.join(sources, s.file))), s.sha256, "SOURCE_FILE_DRIFT");
const ledger = read(oldPath("execution-ledger.json")),
  failedLedger = read(path.join(failed, "execution-ledger.json"));
eq(ledger.planHash, planHash, "LEDGER_PLAN");
eq(read(path.join(failed, "request-plan.json")), plan, "STARTUP_PLAN_CHANGED");
const stdout = bytes(oldPath("attempts/session-0.stdout.jsonl"))
  .toString("utf8")
  .trim()
  .split("\n")
  .map((s) => JSON.parse(s));
const responses = stdout.filter((x) => x.type === "result"),
  forwards = stdout.filter((x) => x.type === "forward-start");
const ids = plan.units.map((u) => u.id);
if (ids.length !== 12 || plan.logicalTasks !== 12)
  throw Error("EXPECTED_TWELVE_UNITS");
assertExactIds(
  ids,
  responses.map((r) => r.requestId),
);
assertExactIds(
  ids,
  forwards.map((r) => r.requestId),
);
eq(
  ids,
  responses.map((r) => r.requestId),
  "RESPONSE_ORDER",
);
assertExactIds(
  ids,
  fs
    .readdirSync(oldPath("evidence/reazon-same-unit"))
    .filter((n) => n.endsWith(".json"))
    .map((n) => n.slice(0, -5)),
);
const reservedFiles = fs
  .readdirSync(oldPath("attempts"))
  .filter((n) => n.endsWith(".reserved.json"));
const reservations = reservedFiles.map((n) => read(oldPath("attempts/" + n)));
assertExactIds(
  ids,
  reservations.map((r) => r.unitId),
);
const rows = [],
  details = [];
let primaryNormalizedCharacters = 0;
for (const u of plan.units) {
  if (!/^unit-[a-z0-9-]+$/.test(u.id)) throw Error("UNSAFE_ID");
  const wave = auditWave(bytes(oldPath(u.audio)));
  for (const k of [
    "wavHash",
    "pcmHash",
    "sampleCount",
    "sampleRate",
    "seconds",
    "paddedSampleCount",
    "decodedFloat32Hash",
    "format",
    "channels",
    "bits",
  ])
    eq(wave[k], u[k], "WAVE_BINDING_" + k);
  const reservation = reservations.find((r) => r.unitId === u.id);
  eq(reservation.planHash, planHash, "RESERVATION_PLAN");
  const request = read(
    oldPath("attempts/" + reservation.attemptId + ".request.json"),
  );
  eq(
    request,
    {
      type: "transcribe",
      requestId: u.id,
      audioPath: path.join(old, u.audio),
      maximumPaddedSeconds: 32,
    },
    "REQUEST_BINDING",
  );
  const f = read(
    oldPath("attempts/" + reservation.attemptId + ".forward.json"),
  );
  eq(
    f,
    forwards.find((x) => x.requestId === u.id),
    "FORWARD_PERSISTENCE",
  );
  eq(
    [f.sampleCount, f.paddedSampleCount, f.decodedFloat32Hash],
    [wave.sampleCount, wave.paddedSampleCount, wave.decodedFloat32Hash],
    "FORWARD_INPUT",
  );
  const response = read(
    oldPath("attempts/" + reservation.attemptId + ".response.json"),
  );
  savedResponseSchema.parse(response);
  eq(
    response,
    responses.find((x) => x.requestId === u.id),
    "STDOUT_RESPONSE",
  );
  eq(
    [response.rawSampleCount, response.paddedSampleCount],
    [wave.sampleCount, wave.paddedSampleCount],
    "RESPONSE_SAMPLES",
  );
  const envelope = read(oldPath("evidence/reazon-same-unit/" + u.id + ".json"));
  eq(
    [
      envelope.unitId,
      envelope.planHash,
      envelope.audioHash,
      envelope.pcmHash,
      envelope.model,
      envelope.responseHash,
      envelope.response,
    ],
    [
      u.id,
      planHash,
      u.wavHash,
      u.pcmHash,
      plan.model,
      objectHash(response),
      response,
    ],
    "ENVELOPE_BINDING",
  );
  const full = outputStatistics(response.result, u.seconds, u.sourceOffset),
    chains = [];
  for (const run of ["run-a", "run-b"]) {
    const base = run + "/" + u.id + "/R0-second-asr-transcript/",
      transcript = read(oldPath(base + "transcript.json"));
    eq(
      read(oldPath(base + "raw-response.json")),
      response,
      "EXPORTED_RAW_RESPONSE",
    );
    eq(
      [
        transcript.responseHash,
        transcript.planHash,
        transcript.audioHash,
        transcript.pcmHash,
      ],
      [envelope.responseHash, planHash, u.wavHash, u.pcmHash],
      "TRANSCRIPT_BINDING",
    );
    const chain = verifyTextChain(
      response.result.text,
      transcript.text,
      bytes(oldPath(base + "transcript.txt")),
    );
    if (!chain.jsonMatches || !chain.utf8Matches)
      throw Error("TEXT_CHAIN_DIFFERENCE");
    chains.push(chain);
  }
  const primary = read(
    oldPath("run-a/" + u.id + "/W0-primary-transcript/transcript.json"),
  );
  primaryNormalizedCharacters += Array.from(
    normalizedAuditText(primary.text),
  ).length;
  details.push({
    unit: u.id,
    wave,
    output: full,
    textChains: chains,
    lengths: expectedLengths(wave.paddedSampleCount, pins.fbank),
  });
  rows.push({
    unit: u.id,
    rawSeconds: wave.seconds,
    paddedSeconds: wave.paddedSeconds,
    rawCharacters: full.rawCharacters,
    normalizedCharacters: full.normalizedCharacters,
    tokenCount: full.tokenCount,
    timestampCount: full.timestampCount,
    firstPoint: full.firstPoint,
    lastPoint: full.lastPoint,
    firstGap: full.gaps[0] ?? null,
    maximumGap: full.maximumGap,
    allAdjacentGaps: JSON.stringify(full.gaps),
    paddedPoints: JSON.stringify(full.coordinates.map((p) => p.padded)),
    originalLocalPoints: JSON.stringify(
      full.coordinates.map((p) => p.originalLocal),
    ),
    sourceGlobalPoints: JSON.stringify(
      full.coordinates.map((p) => p.sourceGlobal),
    ),
    nonFinitePoints: full.nonFinitePoints,
    nonMonotonicGaps: full.nonMonotonicGaps,
    outOfPaddedBounds: full.outOfPaddedBounds,
    paddingPoints: full.paddingPoints,
    charactersPerSecond: full.normalizedCharactersPerRawSecond,
    expectedFeatureFrames: Math.floor((wave.paddedSampleCount + 80) / 160),
    observedFeatureFrames: null,
    expectedEncoderLength: null,
    observedEncoderLength: null,
  });
}
eq(ledger.actualRecognitionAttempts, reservations.length, "ATTEMPT_COUNT");
eq(ledger.acousticForwards, forwards.length, "FORWARD_COUNT");
const runtime = read(oldPath("runtime.local-only.json"));
eq(
  digest(bytes(fs.realpathSync.native(runtime.reazonPython))),
  plan.runtimePythonHash,
  "PYTHON_DRIFT",
);
for (const f of plan.identityFiles)
  eq(digest(bytes(f.path)), f.sha256, "RUNTIME_FILE_DRIFT");
const remoteModel = read(path.join(sources, "model-revision.json"));
eq(remoteModel.sha, plan.model.modelRevision, "MODEL_REVISION");
for (const f of plan.model.modelFiles) {
  const b = bytes(path.join(runtime.reazonModel, f.fileName)),
    remote = remoteModel.siblings.find((x) => x.rfilename === f.fileName);
  eq([b.length, digest(b)], [f.size, f.sha256], "MODEL_FILE_DRIFT");
  if (remote.lfs)
    eq(
      [remote.lfs.size, remote.lfs.sha256],
      [f.size, f.sha256],
      "OFFICIAL_MODEL_LFS",
    );
  else
    eq(
      createHash("sha1")
        .update("blob " + b.length + "\0")
        .update(b)
        .digest("hex"),
      remote.blobId,
      "OFFICIAL_TOKEN_BLOB",
    );
}
const tokens = tokenTableContract(
  bytes(path.join(runtime.reazonModel, "tokens.txt")).toString("utf8"),
  null,
);
const summary = {
  ...publicCoverage(details.map((d) => d.output)),
  primaryNormalizedCharacters,
  rawSeconds: rows.reduce((n, r) => n + r.rawSeconds, 0),
  paddedSeconds: rows.reduce((n, r) => n + r.paddedSeconds, 0),
  textChainPassed: details.length,
  greaterThan30Padded: rows.filter((r) => r.paddedSeconds > 30).length,
};
// Only aggregate metadata, no references or evaluator invocation.
const contract = read(
  new URL("./c601181-runtime-contract.json", import.meta.url),
);
const out = fs.mkdtempSync(
  path.join(
    parent,
    "reazon-runtime-audit-c6-0-1-18-1-" +
      new Date().toISOString().slice(0, 10).replaceAll("-", "") +
      "-",
  ),
);
const write = (f, v) =>
  fs.writeFileSync(
    path.join(out, f),
    typeof v === "string" ? v : JSON.stringify(v, null, 2) + "\n",
    { flag: "wx", mode: 0o600 },
  );
write(
  "output-coverage.csv",
  Object.keys(rows[0]).join(",") +
    "\n" +
    rows
      .map((r) =>
        Object.values(r)
          .map((v) => '"' + String(v ?? "").replaceAll('"', '""') + '"')
          .join(","),
      )
      .join("\n") +
    "\n",
);
write("coverage-details.local-only.json", details);
write("runtime-contract-matrix.json", {
  ...contract,
  tokens,
  pins,
  model: plan.model,
  installedRuntime: plan.runtime,
  runtimeFilesRechecked: plan.identityFiles.length,
  graphSignatures: null,
  initializerShapes: null,
  externalData: null,
  graphStatus:
    "UNVERIFIED_OR_UNAVAILABLE: no installed static ONNX parser or saved graph sidecar; no installation/session attempted",
});
write("observability-gaps.json", {
  primaryGap:
    "feature-length -> encoder-effective-length -> decoder-traversed-frame accounting for the same request",
  observedInternalFields: null,
  futureOnly: contract.futureTrace,
  notExecuted: true,
});
write("audit-manifest.json", {
  version: "c601181-v1",
  baseline: "8d97a4168c3e3fa96826665abf5af929f410697d",
  auditedAt: new Date().toISOString(),
  classification: "LOCAL_RESEARCH_PACKAGE_NOT_PUBLIC_SHAREABLE",
  summary,
  execution: AUDIT_ZERO_EXECUTION,
  historicalExecution: { completed: ledger, startupFailed: failedLedger },
  sources: network,
  pins,
  primaryExit: auditExit(
    [
      ...(!tokens.uniqueIds || !tokens.uniqueSymbols
        ? ["DUPLICATE_VOCAB_ENTRY"]
        : []),
      ...(tokens.blankCompatibleWithPinnedDecoder === false
        ? ["BLANK_ID_CONFLICT"]
        : []),
    ],
    false,
  ),
  missingMaterials: [
    "C6_0_1_18_INDEPENDENT_REVIEW_AND_NEXT_STEP.md",
    "C6_0_1_18_INDEPENDENT_AUDIT_SUMMARY.json",
    "saved ONNX graph metadata",
    "historical internal feature/encoder/decoder traces",
  ],
  quality: {
    QUALITY_EVALUATION: "NOT_RERUN",
    FINAL_SUBTITLE_CHANGE: 0,
    G11_CHANGED: false,
    DEFAULT_PROMOTION_AUTHORIZED: false,
    MACHINE_RELEASE_AUTHORIZED: false,
    status: "needs-review",
    finalizationMethod: "none",
  },
  inspectedFiles: Object.fromEntries(inspected),
  auditCode: {
    entry: digest(fs.readFileSync(new URL(import.meta.url))),
    core: digest(
      fs.readFileSync(
        new URL(
          "../packages/video-subtitler/dist/machine-quality/reazon-runtime-audit.js",
          import.meta.url,
        ),
      ),
    ),
  },
});
for (const [p, i] of inspected)
  if (digest(fs.readFileSync(p)) !== i.sha256)
    throw Error("INPUT_CHANGED_DURING_AUDIT");
write("validation.json", {
  artifactBindingsPassed: true,
  inputBytesUnchanged: true,
  modelFilesStaticallyHashed: 4,
  staticHashingIsModelLoading: false,
  ...AUDIT_ZERO_EXECUTION,
  engineeringTests: "SEPARATE_RECEIPT_PENDING",
  summary,
});
write(
  "AUDIT_INDEX.md",
  "# C6.0.1.18.1 zero-inference audit\n\nAll twelve units: output-coverage.csv. Private waveform/text chains: coverage-details.local-only.json. Runtime contract: runtime-contract-matrix.json. Unknown internal execution: observability-gaps.json.\n\nNo quality evaluation or subtitle modification. Local paths/text are private. No graph parser was installed; graph internals remain unknown.\n",
);
console.log(
  JSON.stringify({ output: out, summary, ...AUDIT_ZERO_EXECUTION }, null, 2),
);
