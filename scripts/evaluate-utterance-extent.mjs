/** Evaluation-only: open the user reference only after machine freeze verification. */
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { verifyExtent } from "./subtitle-tool-utterance-extent.mjs";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { referenceSubset } from "./evaluate-vad-local-recovery.mjs";
import { compareReference } from "./lib/subtitle-reference-comparison.mjs";

const json = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
export function intervalDifference(interval, reference) {
  if (!interval) return null;
  assert(
    [interval, reference].every(
      (r) =>
        Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start,
    ),
  );
  return {
    startDelta: interval.start - reference.start,
    endDelta: interval.end - reference.end,
    referenceDurationCoverage:
      Math.max(
        0,
        Math.min(interval.end, reference.end) -
          Math.max(interval.start, reference.start),
      ) /
      (reference.end - reference.start),
    meaning:
      "temporal geometry against user reference, not an audio-truth or lexical-accuracy score",
  };
}
export async function evaluateExtent(root, reference) {
  await verifyExtent(root);
  const machineFreezeHash = await fileHash(
    path.join(root, "machine-freeze.json"),
  );
  const p = await json(path.join(root, "plan.json")),
    r = await json(path.join(root, "result.json"));
  const referenceHash = await fileHash(reference),
    ass = await fs.readFile(reference, "utf8");
  const w = p.windows[0];
  const comparison = compareReference({
    referenceAss: referenceSubset(ass, "dialogue"),
    baselineRecords: p.baseline,
    candidateRecords: p.baseline,
    windows: [
      {
        id: p.targetId,
        kind: "frozen-machine-narrow-context",
        start: w.start,
        end: w.end,
      },
    ],
  });
  const refs = comparison.perWindow[0].reference.records;
  const evidence = [
    { id: "MFA-word", interval: r.wordInterval },
    ...p.prior.timing.emissionIntervals.map((x) => ({
      id: x.requestId,
      interval: x.interval,
    })),
    ...p.prior.timing.vadIntervals.map((v, i) => ({
      id: `VAD-${i}`,
      interval: v,
    })),
  ];
  const evaluation = {
    mode: "post-freeze-known-episode-not-blind",
    machineFreezeHash,
    referenceHash,
    reference: refs,
    association:
      refs.length === 1
        ? "sole-reference-cue-in-frozen-window-not-lexical-equivalence-proof"
        : "ambiguous",
    evidence: evidence.map((e) => ({
      ...e,
      comparison:
        refs.length === 1 ? intervalDifference(e.interval, refs[0]) : null,
    })),
    humanListeningPerformed: false,
    subtitleMutation: 0,
    qualityStatus: "needs-review",
    finalizationMethod: "none",
  };
  assert.equal(await fileHash(reference), referenceHash);
  assert.equal(
    await fileHash(path.join(root, "machine-freeze.json")),
    machineFreezeHash,
  );
  const out = await fs.mkdtemp(path.join(root, "evaluation-"));
  await fs.writeFile(
    path.join(out, "reference-comparison.json"),
    JSON.stringify(evaluation, null, 2) + "\n",
    { flag: "wx" },
  );
  return { out, ...evaluation };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    console.log(
      JSON.stringify(await evaluateExtent(...process.argv.slice(2)), null, 2),
    );
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  }
}
