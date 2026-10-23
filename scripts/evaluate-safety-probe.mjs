/** Read-only, post-freeze reference evaluation. Never imported by ASR. */
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { compareReference } from "./lib/subtitle-reference-comparison.mjs";
const [supplied, reference] = process.argv.slice(2);
assert(supplied && reference, "Usage: PROBE REFERENCE_ASS");
const root = path.resolve(supplied);
const json = async (n) =>
  JSON.parse(await fs.readFile(path.join(root, n), "utf8"));
const freeze = await json("machine-freeze.json");
for (const [n, h] of Object.entries(freeze.files)) {
  assert(!path.isAbsolute(n) && !n.split(/[\\/]/u).includes(".."));
  assert.equal(await fileHash(path.join(root, n)), h);
}
const plan = await json("plan.json"),
  baseline = await json("baseline-records.json"),
  views = await json("views.json");
// All source windows and responses are already frozen before the first reference read.
const referenceAss = await fs.readFile(reference, "utf8");
const comparisons = views.map((v) => {
  const target = plan.targets.find((t) => t.id === v.targetId);
  return {
    requestId: v.id,
    ...compareReference({
      referenceAss,
      baselineRecords: baseline,
      candidateRecords: v.records,
      windows: [
        {
          id: target.id,
          kind: target.code,
          start: target.start,
          end: target.end,
        },
      ],
    }),
    machineWindowFreezeVerified: true,
  };
});
const result = {
  evaluatedAt: new Date().toISOString(),
  machineFreezeHash: await fileHash(path.join(root, "machine-freeze.json")),
  referenceHash: await fileHash(reference),
  evaluationOnly: true,
  previouslyExposedDevelopmentEpisode: true,
  independentBlindEvaluation: false,
  sourceWindows:
    "machine-risk-selected; whole overlapping cues included without proportional text cropping",
  overallAccuracyGain: null,
  automaticRepairs: 0,
  comparisons,
};
await fs.writeFile(
  path.join(root, "reference-evaluation.json"),
  JSON.stringify(result, null, 2) + "\n",
  { flag: "wx" },
);
for (const c of comparisons) {
  const w = c.perWindow[0];
  console.log(
    JSON.stringify({
      request: c.requestId,
      reference: w.reference.records.map((r) => ({
        start: r.start,
        end: r.end,
        text: r.text,
      })),
      baseline: w.baseline.normalizedText,
      candidate: w.candidate.normalizedText,
      edits: [w.baseline.edit, w.candidate.edit],
      cautions: w.cautions,
    }),
  );
}
