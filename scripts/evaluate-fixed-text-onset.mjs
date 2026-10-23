/** Reference enters only after the fixed-text machine evidence is frozen. */
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { compareReference } from "./lib/subtitle-reference-comparison.mjs";
const [root, reference] = process.argv.slice(2);
execFileSync(process.execPath, [
  path.join(import.meta.dirname, "subtitle-tool-fixed-text-onset.mjs"),
  "verify",
  root,
]);
const read = async (n) =>
  JSON.parse(await fs.readFile(path.join(root, n), "utf8"));
const p = await read("plan.json"),
  r = await read("result.json"),
  t = p.analysis.target;
const machineFreezeHash = await fileHash(
  path.join(root, "machine-freeze.json"),
);
const windows = p.requests.map((q) => ({
  id: q.id,
  kind: "fixed-machine-text-context",
  start: q.start,
  end: q.end,
}));
const out = path.join(root, "evaluation");
await fs.mkdir(out);
const put = (name, v) =>
  fs.writeFile(path.join(out, name), JSON.stringify(v, null, 2) + "\n", {
    flag: "wx",
  });
await put("selection-freeze.json", {
  machineFreezeHash,
  windows,
  knownDevelopmentTarget: true,
});
const referenceHash = await fileHash(reference);
const records = [{ start: t.oldStart, end: t.oldEnd, text: t.text }];
const comparison = compareReference({
  referenceAss: await fs.readFile(reference, "utf8"),
  baselineRecords: records,
  candidateRecords: records,
  windows,
});
const match = comparison.perWindow[0].baseline.timing.pairs[0];
assert.equal(match.status, "UNIQUE_EXACT_NORMALIZED_TEXT");
const views = [];
for (const q of p.requests) {
  const raw = await read(q.id + "/raw.json");
  views.push({
    id: q.id,
    window: [q.start, q.end],
    ctcBoundary: raw.selectedBoundary,
    ctcStartMinusReference: raw.selectedBoundary?.start - match.referenceStart,
    ctcEndMinusReference: raw.selectedBoundary?.end - match.referenceEnd,
    firstTokenDuration:
      raw.tokenSpans[0]?.endSecondsLocal - raw.tokenSpans[0]?.startSecondsLocal,
    firstTokenPosterior: raw.tokenSpans[0]?.meanPosterior,
    lastTokenPosterior: raw.tokenSpans.at(-1)?.meanPosterior,
    greedyText: raw.greedyText,
  });
}
const summary = {
  status: r.status,
  blockers: r.blockers,
  text: t.text,
  reference: { start: match.referenceStart, end: match.referenceEnd },
  oldMachine: { start: t.oldStart, end: t.oldEnd },
  storedWhisperStart: p.analysis.storedWordStart,
  views,
  onsetSpread: r.onsetSpread,
  subtitleMutations: 0,
  blindAcceptance: false,
  listeningPerformed: false,
  conclusion:
    "Stable conditional CTC emissions are not verified utterance boundaries; no timing writeback.",
};
await put("comparison.json", comparison);
await put("summary.json", summary);
assert.equal(await fileHash(reference), referenceHash);
assert.equal(
  await fileHash(path.join(root, "machine-freeze.json")),
  machineFreezeHash,
);
await put("evaluation-freeze.json", {
  machineFreezeHash,
  reference: { file: reference, sha256: referenceHash },
  files: await Promise.all(
    ["selection-freeze.json", "comparison.json", "summary.json"].map(
      async (file) => ({ file, sha256: await fileHash(path.join(out, file)) }),
    ),
  ),
  software: await Promise.all(
    [
      import.meta.filename,
      path.join(import.meta.dirname, "lib/subtitle-reference-comparison.mjs"),
    ].map(async (file) => ({ file, sha256: await fileHash(file) })),
  ),
});
console.log(JSON.stringify(summary, null, 2));
