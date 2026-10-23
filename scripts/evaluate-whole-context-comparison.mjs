/** Post-freeze reference comparison only; never part of candidate selection. */
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { verifyContextComparison } from "./run-whole-context-comparison.mjs";
import { compareReference } from "./lib/subtitle-reference-comparison.mjs";
import { formatAss } from "../packages/subtitle-core/dist/format.js";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { durable } from "./lib/bounded-asr-ab.mjs";
const [root, referenceFile] = process.argv.slice(2);
assert(root && referenceFile, "Usage: ROOT FROZEN_REFERENCE_EVALUATION_V2");
await verifyContextComparison(root);
const read = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const refRoot = path.dirname(referenceFile),
  ef = await read(path.join(refRoot, "EVALUATION_FREEZE_V2.json"));
assert.equal(await fileHash(referenceFile), ef.evaluationHash);
const receiptPath = path.join(refRoot, "reference/receipt.json");
assert.equal(await fileHash(receiptPath), ef.referenceReceiptHash);
for (const f of (await read(receiptPath)).files) {
  assert(!path.isAbsolute(f.path) && !f.path.split(/[\\/]/u).includes(".."));
  assert.equal(
    await fileHash(path.join(refRoot, "reference", f.path)),
    f.sha256,
  );
}
const reference = await read(referenceFile),
  result = await read(path.join(root, "result.json"));
assert.equal(result.sources.length, reference.results.length);
const scores = [],
  changes = [];
for (const [i, s] of result.sources.entries()) {
  const r = reference.results[i];
  assert.deepEqual(s.baseline, r.machine, "REFERENCE_SOURCE_MISMATCH");
  const referenceAss = formatAss(r.reference).replace(
    /^(Dialogue: \d+,[^,]+,[^,]+,)Default,/gm,
    "$1Dialogue,",
  );
  const score = compareReference({
    referenceAss,
    baselineRecords: s.baseline,
    candidateRecords: s.candidate,
    windows: [
      {
        id: r.id,
        start: 0,
        end: r.duration,
        kind: "complete-development-conversation",
      },
    ],
  }).perWindow[0];
  assert.equal(score.reference.recordCount, r.reference.length);
  assert(score.baseline.edit.N > 0);
  assert.deepEqual(score.baseline.edit, r.baseline);
  scores.push({
    id: r.id,
    baseline: score.baseline.edit,
    candidate: score.candidate.edit,
  });
  for (const d of s.decisions)
    if (d.status === "CANDIDATE")
      changes.push({
        source: s.id,
        start: d.start,
        end: d.end,
        before: d.before,
        after: d.records,
        semanticGainVerified: false,
        internalCueBoundariesMerged: true,
      });
}
const sum = (key) => {
  const t = { N: 0, distance: 0, S: 0, D: 0, I: 0 };
  for (const s of scores) for (const k of Object.keys(t)) t[k] += s[key][k];
  return { ...t, CER: t.distance / t.N };
};
const evaluation = {
  evaluatedAt: new Date().toISOString(),
  scores,
  baseline: sum("baseline"),
  candidate: sum("candidate"),
  changes,
  previouslySeenReference: true,
  blindAcceptance: false,
  referenceUsedForGeneration: false,
  semanticGainVerified: false,
  listeningVerified: false,
  qualityStatus: "needs-review",
  limits: [
    "Character errors include orthography and fillers; a lower CER is not proof of dialogue recovery",
    "Shared Whisper ancestry is not independent ground truth",
    "Original target outer envelope retained; internal cue boundaries may be merged; not acoustically validated",
  ],
};
await durable(path.join(root, "evaluation.json"), evaluation, true);
await durable(
  path.join(root, "evaluation-freeze.json"),
  {
    machineFreezeHash: await fileHash(path.join(root, "machine-freeze.json")),
    referenceEvaluationHash: ef.evaluationHash,
    referenceReceiptHash: ef.referenceReceiptHash,
    evaluatorHash: await fileHash(import.meta.filename),
    evaluationHash: await fileHash(path.join(root, "evaluation.json")),
  },
  true,
);
console.log(JSON.stringify(evaluation, null, 2));
