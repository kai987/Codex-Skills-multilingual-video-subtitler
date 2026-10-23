/** Post-freeze evaluation only. Never imported by generation. */
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { verifySpeech } from "./subtitle-tool-speech-support.mjs";
import { verifySoftSpeech } from "./subtitle-tool-soft-speech.mjs";
import { includeSongs } from "./evaluate-seam-refinement.mjs";
import { compareReference } from "./lib/subtitle-reference-comparison.mjs";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { durable } from "./lib/bounded-asr-ab.mjs";
const json = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
export async function evaluateSpeech(root, reference) {
  const plan = await json(path.join(root, "plan.json"));
  const soft = plan.version === "soft-speech-probes-v1";
  const integrity = await (soft ? verifySoftSpeech(root) : verifySpeech(root));
  const baseline = await json(path.join(root, "baseline-records.json")),
    candidate = await json(path.join(root, "candidate-records.json"));
  // First reference access happens only after the machine result is immutable and replay-checked.
  const referenceHash = await fileHash(reference),
    ass = await fs.readFile(reference, "utf8");
  const rows = (v) =>
    v.map((r) => ({
      id: r.recordId,
      start: r.sourceStart,
      end: r.sourceEnd,
      text: r.text.replace(/\p{S}/gu, ""),
    }));
  const comparison = compareReference({
    referenceAss: includeSongs(ass),
    baselineRecords: rows(baseline),
    candidateRecords: rows(candidate),
    windows: [
      {
        id: "full-episode",
        kind: "whole-source",
        start: 0,
        end: plan.duration,
      },
    ],
  }).perWindow[0];
  const diagnosticComparisons = [];
  if (soft) {
    const views = await json(path.join(root, "views.json"));
    for (const probe of plan.probes)
      for (const view of views.filter((v) => v.targetId === probe.id)) {
        diagnosticComparisons.push({
          targetId: probe.id,
          backend: view.backend,
          unresolvedCount: view.unresolvedCount,
          comparison: compareReference({
            referenceAss: includeSongs(ass),
            baselineRecords: rows(baseline),
            candidateRecords: rows(view.records),
            windows: [
              {
                id: probe.id,
                kind: "diagnostic-crop-not-full-delivery",
                start: probe.start,
                end: probe.end,
              },
            ],
          }).perWindow[0],
        });
      }
  }
  const report = {
    version: soft
      ? "soft-speech-evaluation-v1"
      : "speech-support-evaluation-v1",
    at: new Date().toISOString(),
    freezeHash: await fileHash(path.join(root, "machine-freeze.json")),
    referenceHash,
    integrity,
    comparison,
    diagnosticComparisons,
    qualityStatus: "needs-review",
    humanValidated: false,
    limitations: [
      "Known-video development evaluation, not an unseen holdout",
      "Human reference used for evaluation only",
      "No listening performed",
      "VAD negative does not prove silence",
      "Whisper and Kotoba are correlated model families",
      "A matching short word is not proof of exact timing",
    ],
  };
  await (soft ? verifySoftSpeech(root) : verifySpeech(root));
  if ((await fileHash(reference)) !== referenceHash)
    throw Error("REFERENCE_CHANGED");
  await durable(path.join(root, "reference-evaluation.json"), report, true);
  return report;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    console.log(
      JSON.stringify(await evaluateSpeech(...process.argv.slice(2)), null, 2),
    );
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  }
}
