/** Reference is opened only after the complete machine freeze verifies. */
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { safePath } from "../packages/video-subtitler/dist/standalone/recovery.js";
import { compareReference } from "./lib/subtitle-reference-comparison.mjs";
import { referenceSubset } from "./evaluate-vad-local-recovery.mjs";
import { compareComponentCrops } from "./lib/component-crop-contrast.mjs";
const [root, reference] = process.argv.slice(2);
assert(root && reference, "FROZEN_ROOT REFERENCE_ASS");
const json = async (n) =>
  JSON.parse(await fs.readFile(path.join(root, n), "utf8"));
const freeze = await json("machine-freeze.json"),
  freezeHash = await fileHash(path.join(root, "machine-freeze.json"));
for (const [n, h] of Object.entries(freeze.files)) {
  assert(!path.isAbsolute(n) && !n.split(/[\\/]/u).includes(".."));
  await safePath(path.join(root, n));
  assert.equal(await fileHash(path.join(root, n)), h, `MACHINE_CHANGED:${n}`);
}
const p = await json("plan.json"),
  views = await json("views.json"),
  comparison = await json("comparison.json");
for (const b of p.bindings)
  assert.equal(await fileHash(b.file), b.sha256, "SOURCE_CHANGED");
assert.deepEqual(
  compareComponentCrops(p.contrast, p.parent, p.oldViews, views),
  comparison,
);
// First Gold access is here, after machine consistency and hashes are checked.
const referenceHash = await fileHash(reference),
  ass = referenceSubset(await fs.readFile(reference, "utf8"), "dialogue");
const windows = p.contrast.crops.map((c) => ({
  id: c.id,
  kind: "frozen-crop",
  start: c.start,
  end: c.end,
}));
const rows = p.contrast.crops.map((c) => {
  const row = comparison.rows.find((r) => r.id === c.id);
  const backends = ["whisper", "kotoba"].map((backend) => {
    const oldRecords = p.oldViews.find(
      (v) => v.targetId === c.targetId && v.backend === backend,
    ).records;
    const newRecords = views.find(
      (v) => v.targetId === c.id && v.backend === backend,
    ).records;
    const evaluated = compareReference({
      referenceAss: ass,
      baselineRecords: oldRecords,
      candidateRecords: newRecords,
      windows: [windows.find((w) => w.id === c.id)],
    }).perWindow[0];
    return { backend, ...evaluated };
  });
  const intervalErrors = row.newViews.flatMap((v) =>
    v.records.map((r, index) => ({
      backend: v.backend,
      index,
      startBeforeCropSeconds: Math.max(0, c.start - r.start),
      endAfterCropSeconds: Math.max(0, r.end - c.end),
      overlapsOriginalTarget: r.start < c.targetEnd && r.end > c.targetStart,
    })),
  );
  return {
    id: c.id,
    targetId: c.targetId,
    originalTarget: { start: c.targetStart, end: c.targetEnd },
    core: c.core,
    crop: { start: c.start, end: c.end },
    status: row.status,
    rawTextAgreement: row.textAgreement,
    validTimingTextAgreement: row.textAgreement && row.invalid.length === 0,
    intervalErrors,
    backends,
  };
});
assert.equal(await fileHash(reference), referenceHash, "REFERENCE_CHANGED");
assert.equal(
  await fileHash(path.join(root, "machine-freeze.json")),
  freezeHash,
);
const out = await fs.mkdtemp(path.join(root, "evaluation-"));
const report = {
  machineFreezeHash: freezeHash,
  referenceHash,
  rows,
  summary: {
    rawPairedTextAgreement: rows.filter((r) => r.rawTextAgreement).length,
    validTimingPairedTextAgreement: rows.filter(
      (r) => r.validTimingTextAgreement,
    ).length,
    insertions: 0,
    newInference: 0,
  },
  limitations: [
    "Previously exposed development episode; not blind acceptance",
    "Whole overlapping reference cues can cross crop boundaries; edit distances are diagnostic only",
    "Reference timing is presentation timing, not exact acoustic extent",
    "No new human listening in this round",
    "Text agreement between two Whisper-family models is not correctness",
    "No full-episode accuracy gain or automatic subtitle edits",
  ],
  qualityStatus: "needs-review",
  finalizationMethod: "none",
};
await fs.writeFile(
  path.join(out, "reference-comparison.json"),
  JSON.stringify(report, null, 2) + "\n",
  { flag: "wx" },
);
console.log(
  JSON.stringify(
    {
      out,
      summary: report.summary,
      rows: rows.map((r) => ({
        id: r.id,
        reference: r.backends[0].reference.records.map((x) => ({
          start: x.start,
          end: x.end,
          text: x.text,
        })),
        hypotheses: r.backends.map((b) => ({
          backend: b.backend,
          newText: b.candidate.normalizedText,
          oldEdit: b.baseline.edit.distance,
          newEdit: b.candidate.edit.distance,
        })),
        intervalErrors: r.intervalErrors,
      })),
    },
    null,
    2,
  ),
);
