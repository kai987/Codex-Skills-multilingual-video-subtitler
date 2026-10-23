/** Post-freeze, read-only reference comparison; never imported by generation. */
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { verifyOnset } from "./subtitle-tool-timing-onset.mjs";
import { compareReference } from "./lib/subtitle-reference-comparison.mjs";
import { includeSongs } from "./evaluate-seam-refinement.mjs";
const [root, reference] = process.argv.slice(2);
const verification = await verifyOnset(root);
const read = async (n) =>
  JSON.parse(await fs.readFile(path.join(root, n), "utf8"));
const p = await read("plan.json"),
  r = await read("result.json");
const map = (rows) =>
  rows.map((v) => ({ start: v.sourceStart, end: v.sourceEnd, text: v.text }));
// Freeze identity and windows before reading the reference file.
const freezeHash = await fileHash(path.join(root, "machine-freeze.json"));
const windows = [
  {
    id: "whole-episode",
    kind: "dialogue-plus-song",
    start: 0,
    end: p.duration,
  },
  ...p.planned.targets.map((t) => ({
    id: t.id,
    kind: "known-development-target",
    start: t.start,
    end: t.end,
  })),
];
const out = path.join(root, "evaluation");
await fs.mkdir(out);
const put = (name, value) =>
  fs.writeFile(path.join(out, name), JSON.stringify(value, null, 2) + "\n", {
    flag: "wx",
  });
await put("selection-freeze.json", {
  machineFreezeHash: freezeHash,
  windows,
  referenceUsedForTargetSelection: true,
  targetSelection: "known-development-cues-not-blind",
  newBoundaryComputationUsesReference: false,
});
const referenceHash = await fileHash(reference);
const comparison = compareReference({
  referenceAss: includeSongs(await fs.readFile(reference, "utf8")),
  baselineRecords: map(r.baseline),
  candidateRecords: map(r.candidate),
  windows,
});
const episode = comparison.perWindow[0];
const targets = p.planned.targets.map((t) => {
  const before = episode.baseline.timing.pairs.find(
    (v) => v.machineIndex === t.cueNumber - 1,
  );
  const after = episode.candidate.timing.pairs.find(
    (v) => v.machineIndex === t.cueNumber - 1,
  );
  const decision = r.decisions.find((d) => d.id === t.id);
  return { id: t.id, text: t.text, decision, before, after };
});
assert.deepEqual(
  r.baseline.map((v) => [v.recordId, v.text, v.sourceEnd]),
  r.candidate.map((v) => [v.recordId, v.text, v.sourceEnd]),
);
const changed = new Set(
  r.decisions.filter((d) => d.status === "CANDIDATE").map((d) => d.recordId),
);
for (let i = 0; i < r.baseline.length; i++)
  if (!changed.has(r.baseline[i].recordId))
    assert.deepEqual(r.baseline[i], r.candidate[i]);
assert.equal(await fileHash(reference), referenceHash);
assert.equal(
  await fileHash(path.join(root, "machine-freeze.json")),
  freezeHash,
);
await verifyOnset(root);
const summary = {
  verification,
  changedCues: r.changed,
  protectedCues: r.baseline.length - r.changed,
  textMutations: 0,
  endMutations: 0,
  baselineEdit: episode.baseline.edit,
  candidateEdit: episode.candidate.edit,
  baselineTiming: episode.baseline.timing.start,
  candidateTiming: episode.candidate.timing.start,
  targets,
  qualityStatus: "needs-review",
  finalizationMethod: "none",
  acousticListeningPerformed: false,
  independentModelFamily: false,
  blindAcceptance: false,
};
await put("comparison.json", comparison);
await put("summary.json", summary);
await put("evaluation-freeze.json", {
  machineFreezeHash: freezeHash,
  reference: { file: reference, sha256: referenceHash },
  files: await Promise.all(
    ["selection-freeze.json", "comparison.json", "summary.json"].map(
      async (file) => ({ file, sha256: await fileHash(path.join(out, file)) }),
    ),
  ),
  software: await Promise.all(
    [
      "evaluate-timing-onset.mjs",
      "evaluate-seam-refinement.mjs",
      "lib/subtitle-reference-comparison.mjs",
    ].map(async (file) => ({
      file,
      sha256: await fileHash(path.join(import.meta.dirname, file)),
    })),
  ),
});
console.log(JSON.stringify(summary, null, 2));
