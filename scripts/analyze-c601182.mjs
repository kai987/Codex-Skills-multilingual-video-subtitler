// Offline, machine-output-only analysis. Never starts a provider or reads a reference.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  compareBehavior,
  validateRuntimeTrace,
  traceConclusion,
} from "../packages/video-subtitler/dist/machine-quality/request-bound-runtime-trace.js";
const root = fs.realpathSync(process.argv[2]);
const read = (p) => JSON.parse(fs.readFileSync(p));
const local = (p) => read(path.join(root, p));
const sha = (p) =>
  createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const frozen = local("result-freeze.json"),
  selection = local("selection.local-only.json"),
  manifest = local("experiment-manifest.json");
if (
  sha(path.join(root, "experiment-manifest.json")) !== frozen.manifestHash ||
  sha(path.join(root, "execution-ledger.json")) !== frozen.ledgerHash
)
  throw Error("RESULT_FREEZE_CHANGED");
for (const f of frozen.artifacts)
  if (sha(path.join(root, f.file)) !== f.sha256)
    throw Error("FROZEN_ARTIFACT_CHANGED");
const symbols = new Map(
  fs
    .readFileSync(
      path.join(selection.runtime.reazonModel, "tokens.txt"),
      "utf8",
    )
    .trimEnd()
    .split("\n")
    .map((line) => {
      const m = line.match(/^(.*)\s+(\d+)$/u);
      if (!m) throw Error("SYMBOL_ROW_INVALID");
      return [Number(m[2]), m[1].replace(/^▁/u, " ")];
    }),
);
const range = (n, a, b) => n >= a && n <= b;
const cjk = (n) =>
  [
    [0x1100, 0x11ff],
    [0x2e80, 0xa4cf],
    [0xa840, 0xd7af],
    [0xf900, 0xfaff],
    [0xfe30, 0xfe4f],
    [0xff65, 0xffdc],
    [0x20000, 0x2ffff],
  ].some(([a, b]) => range(n, a, b));
const punct = (n) =>
  [
    [0x21, 0x2f],
    [0x3a, 0x40],
    [0x5b, 0x60],
    [0x7b, 0x7e],
    [0x3000, 0x303f],
    [0xff01, 0xff0f],
    [0xff1a, 0xff20],
    [0xff3b, 0xff40],
    [0xff5b, 0xff65],
  ].some(([a, b]) => range(n, a, b));
function removeCjkSpaces(text) {
  const a = Array.from(text);
  return a
    .filter(
      (c, i) =>
        !(
          i > 0 &&
          c === " " &&
          i + 1 < a.length &&
          ((cjk(a[i - 1].codePointAt(0)) && cjk(a[i + 1].codePointAt(0))) ||
            punct(a[i + 1].codePointAt(0)))
        ),
    )
    .join("");
}
const dirs = {
  H: "historical-reproduction",
  B: "build-trace-off",
  T: "build-trace-on",
};
const parity = [],
  summary = [];
for (const u of selection.units) {
  const results = {
    H0: read(
      path.join(selection.old, "evidence/reazon-same-unit", u.id + ".json"),
    ).response,
  };
  for (const arm of Object.keys(dirs))
    results[arm] = local(dirs[arm] + "/" + u.id + ".response.json");
  const p = {
    unitId: u.id,
    historicalReproduction: compareBehavior(results.H0, results.H),
    controlledBuildReproduction: compareBehavior(results.H, results.B),
    traceOutputInvariance: compareBehavior(results.B, results.T),
  };
  parity.push(p);
  const trace = local("native-traces/" + u.id + ".json");
  const one = (kind) => trace.events.find((e) => e.kind === kind)?.observed;
  let chain,
    chainError = null;
  try {
    chain = validateRuntimeTrace(
      trace,
      {
        requestId: u.id,
        inputHash: u.decodedFloat32Hash,
        sampleCount: u.paddedSampleCount,
      },
      results.T.result,
    );
  } catch (e) {
    chainError = String(e);
  }
  const post = one("tokens-after-context-removal"),
    native = one("native-result");
  const mapped = post?.tokens.map((id) => symbols.get(id));
  const symbolParity =
    JSON.stringify(mapped) === JSON.stringify(native?.tokens);
  // This specific table must have no emitted byte-fallback/byte-BPE symbols.
  const unsupportedConversion = mapped?.some(
    (s) => s === undefined || /^<0x/u.test(s),
  );
  const conversionText = unsupportedConversion
    ? null
    : removeCjkSpaces(mapped?.join("") ?? "");
  const textConversionParity = conversionText === native?.text;
  const txtParity = Object.entries(dirs).every(
    ([arm, dir]) =>
      fs.readFileSync(path.join(root, dir, u.id + ".txt"), "utf8") ===
      results[arm].result.text,
  );
  const steps = trace.events
    .filter((e) => e.kind === "decoder-step")
    .map((e) => e.observed);
  const runs = [];
  let open = null;
  for (const step of steps) {
    if (!step.appended) {
      if (open === null) open = step.frameIndex;
    } else if (open !== null) {
      runs.push({
        firstFrame: open,
        lastFrame: step.frameIndex - 1,
        frames: step.frameIndex - open,
      });
      open = null;
    }
  }
  if (open !== null)
    runs.push({
      firstFrame: open,
      lastFrame: steps.at(-1).frameIndex,
      frames: steps.at(-1).frameIndex - open + 1,
    });
  runs.sort((a, b) => b.frames - a.frames || a.firstFrame - b.firstFrame);
  const publicIdentity = Object.fromEntries(
    Object.entries(results).map(([a, r]) => [
      a,
      {
        status: r.status,
        textCharacters: Array.from(r.result.text).length,
        tokenCount: r.result.tokens.length,
        firstEmission: r.result.timestamps[0],
        lastEmission: r.result.timestamps.at(-1),
        resultHash: createHash("sha256")
          .update(JSON.stringify(r.result))
          .digest("hex"),
      },
    ]),
  );
  let conclusion = traceConclusion(
    p.historicalReproduction.all,
    p.controlledBuildReproduction.all,
    p.traceOutputInvariance.all,
    chainError === null,
  );
  if (
    p.historicalReproduction.all &&
    p.controlledBuildReproduction.all &&
    p.traceOutputInvariance.all
  ) {
    if (!symbolParity || !textConversionParity || !txtParity)
      conclusion = "EMITTED_TOKENS_LOST_BEFORE_FINAL_RESULT";
    else if (chainError && /LENGTH|CAPACITY|FRAME|SHAPE/u.test(chainError))
      conclusion = "LENGTH_OR_TRAVERSAL_MISMATCH_OBSERVED";
  }
  summary.push({
    unitId: u.id,
    expected: {
      featureLength: u.id === selection.units[0].id ? 2874 : 1245,
      source: "inherited static estimate, not observation",
    },
    observed: chain ?? null,
    chainError,
    publicIdentity,
    symbolParity,
    textConversionParity,
    txtParity,
    unsupportedConversion,
    frameRange: { first: steps[0]?.frameIndex, last: steps.at(-1)?.frameIndex },
    longestNoLexicalInterval: runs[0] ?? null,
    nativeModelInstance: one("decode-start")?.nativeModelInstance,
    streamId: trace.events[0]?.streamId,
    initialContext: one("initial-context"),
    conclusion,
  });
}
const ledger = local("execution-ledger.json");
const output = {
  schema: "c601182-analysis-v1",
  inputResultFreezeHash: sha(path.join(root, "result-freeze.json")),
  units: summary,
  counts: {
    formalTasks: ledger.attempts.length,
    attempts: ledger.attempts.length,
    retries:
      ledger.attempts.length -
      new Set(ledger.attempts.map((a) => a.arm + ":" + a.unitId)).size,
    starts: ledger.starts.length,
    loads: ledger.starts.filter((s) => s.modelLoaded).length,
    forwards: ledger.attempts.filter((a) => a.forwardAttempted).length,
    reservedPaddedSeconds: ledger.reservedPaddedSeconds,
    acceptReturnedSeconds: ledger.attempts
      .filter((a) => a.acceptReturned)
      .reduce((n, a) => n + a.seconds, 0),
    nativeEncoderObservedSeconds: ledger.attempts
      .filter(
        (a) =>
          a.arm === "T" && summary.find((u) => u.unitId === a.unitId)?.observed,
      )
      .reduce((n, a) => n + a.seconds, 0),
  },
  noNewSubtitle: true,
  noGoldRead: true,
  newOtherModelInference: 0,
  directListening: false,
  scope:
    "two isolated units only, no full twelve-request sequence or quality evaluation",
  baseline: manifest.baseline,
};
fs.mkdirSync(path.join(root, "analysis"), { recursive: true });
for (const [name, value] of [
  ["request-chain-summary.json", output],
  ["behavior-parity.json", parity],
]) {
  const dest = path.join(root, "analysis", name),
    bytes = JSON.stringify(value, null, 2);
  if (fs.existsSync(dest)) {
    if (fs.readFileSync(dest, "utf8") !== bytes)
      throw Error("OFFLINE_ANALYSIS_NOT_DETERMINISTIC");
  } else fs.writeFileSync(dest, bytes, { flag: "wx", mode: 0o600 });
}
console.log(
  JSON.stringify(
    {
      counts: output.counts,
      units: summary.map((u) => ({
        unitId: u.unitId,
        conclusion: u.conclusion,
        error: u.chainError,
        observed: u.observed,
        frameRange: u.frameRange,
        longest: u.longestNoLexicalInterval,
        symbolParity: u.symbolParity,
        textConversionParity: u.textConversionParity,
        publicIdentity: u.publicIdentity,
      })),
      parity,
    },
    null,
    2,
  ),
);
