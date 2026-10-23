/** Reference-only post-freeze evaluation. Never imported by generation. */
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { verifyLexicalComparison } from "./run-lexical-risk-comparison.mjs";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { formatAss } from "../packages/subtitle-core/dist/format.js";
import { compareReference } from "./lib/subtitle-reference-comparison.mjs";
import { durable } from "./lib/bounded-asr-ab.mjs";
const [root, referenceEvaluation] = process.argv.slice(2);
assert(
  root && referenceEvaluation,
  "Usage: ROOT FROZEN_REFERENCE_EVALUATION_V2",
);
await verifyLexicalComparison(root);
const read = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const referenceRoot = path.dirname(referenceEvaluation);
const ef = await read(path.join(referenceRoot, "EVALUATION_FREEZE_V2.json"));
assert.equal(await fileHash(referenceEvaluation), ef.evaluationHash);
const receiptPath = path.join(referenceRoot, "reference/receipt.json");
assert.equal(await fileHash(receiptPath), ef.referenceReceiptHash);
const receipt = await read(receiptPath);
for (const f of receipt.files) {
  assert(!path.isAbsolute(f.path) && !f.path.split(/[\\/]/u).includes(".."));
  assert.equal(
    await fileHash(path.join(referenceRoot, "reference", f.path)),
    f.sha256,
  );
}
const reference = await read(referenceEvaluation);
const result = await read(path.join(root, "result.json"));
assert.equal(result.sources.length, reference.results.length);
const scores = [];
for (const [i, source] of result.sources.entries()) {
  const previous = reference.results[i];
  assert.deepEqual(
    source.baseline,
    previous.machine,
    "WRONG_REFERENCE_SOURCE_ASSOCIATION",
  );
  const referenceAss = formatAss(previous.reference).replace(
    /^(Dialogue: \d+,[^,]+,[^,]+,)Default,/gm,
    "$1Dialogue,",
  );
  const comparison = compareReference({
    referenceAss,
    baselineRecords: source.baseline,
    candidateRecords: source.candidate,
    windows: [
      {
        id: previous.id,
        start: 0,
        end: previous.duration,
        kind: "full-development-conversation",
      },
    ],
  });
  const score = comparison.perWindow[0];
  assert.equal(score.reference.recordCount, previous.reference.length);
  assert(score.baseline.edit.N > 0);
  assert.deepEqual(score.baseline.edit, previous.baseline);
  scores.push({
    sourceId: source.id,
    id: previous.id,
    baseline: score.baseline.edit,
    candidate: score.candidate.edit,
  });
}
const sum = (key) => {
  const totals = { N: 0, distance: 0, S: 0, D: 0, I: 0 };
  for (const s of scores)
    for (const k of Object.keys(totals)) totals[k] += s[key][k];
  return { ...totals, CER: totals.distance / totals.N };
};
const evaluation = {
  evaluatedAt: new Date().toISOString(),
  scores,
  baseline: sum("baseline"),
  candidate: sum("candidate"),
  referenceUsedForGeneration: false,
  previouslySeenReference: true,
  blindAcceptance: false,
  listeningVerified: false,
  qualityStatus: "needs-review",
  changedTargets: result.sources.reduce((n, s) => n + s.changedTargets, 0),
  limits: [
    "Reference-relative CER includes orthographic and filler differences",
    "Model agreement is not independent truth",
    "No manual acoustic acceptance",
    "Timing not scored using VAD reference boundaries",
  ],
};
await durable(path.join(root, "evaluation.json"), evaluation, true);
await durable(
  path.join(root, "evaluation-freeze.json"),
  {
    machineFreezeHash: await fileHash(path.join(root, "machine-freeze.json")),
    referenceEvaluationHash: ef.evaluationHash,
    evaluationHash: await fileHash(path.join(root, "evaluation.json")),
    evaluatorHash: await fileHash(import.meta.filename),
    referenceReceiptHash: ef.referenceReceiptHash,
  },
  true,
);
console.log(JSON.stringify(evaluation, null, 2));
