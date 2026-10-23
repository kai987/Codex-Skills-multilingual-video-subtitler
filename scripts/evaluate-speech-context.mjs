/** Gold is opened only after context generation is frozen and replay verified. */
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { verifyContext } from "./subtitle-tool-speech-context.mjs";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { durable } from "./lib/bounded-asr-ab.mjs";
import { compareReference } from "./lib/subtitle-reference-comparison.mjs";
import { includeSongs } from "./evaluate-seam-refinement.mjs";
const json = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
export async function evaluateContext(root, reference) {
  const integrity = await verifyContext(root);
  const p = await json(path.join(root, "plan.json")),
    baseline = await json(path.join(root, "baseline-records.json"));
  const old = await json(path.join(root, "short-views.json")),
    current = await json(path.join(root, "views.json"));
  const referenceHash = await fileHash(reference),
    referenceAss = includeSongs(await fs.readFile(reference, "utf8"));
  const rows = (records) =>
    records.map((r) => ({
      id: r.recordId,
      start: r.sourceStart,
      end: r.sourceEnd,
      text: r.text.replace(/\p{S}/gu, ""),
    }));
  const comparisons = [];
  for (const probe of p.selected)
    for (const backend of ["whisper", "kotoba"]) {
      const a = old.find(
          (v) => v.targetId === probe.id && v.backend === backend,
        ),
        b = current.find(
          (v) => v.targetId === probe.id && v.backend === backend,
        );
      comparisons.push({
        targetId: probe.id,
        backend,
        caution:
          "Different audio coverage: local CER is diagnostic, not a causal accuracy gain. Whole overlapping reference rows may cross the crop.",
        comparison: compareReference({
          referenceAss,
          baselineRecords: rows(a.records),
          candidateRecords: rows(b.records),
          windows: [
            {
              id: probe.id,
              start: probe.start,
              end: probe.end,
              kind: "expanded-context-diagnostic",
            },
          ],
        }).perWindow[0],
      });
    }
  const whole = compareReference({
    referenceAss,
    baselineRecords: rows(baseline),
    candidateRecords: rows(baseline),
    windows: [
      {
        id: "full-episode",
        start: 0,
        end: p.duration,
        kind: "unchanged-delivery",
      },
    ],
  }).perWindow[0];
  await verifyContext(root);
  assert.equal(await fileHash(reference), referenceHash);
  const report = {
    version: "speech-context-evaluation-v1",
    at: new Date().toISOString(),
    integrity,
    machineFreezeHash: await fileHash(path.join(root, "machine-freeze.json")),
    referenceHash,
    comparisons,
    whole,
    canonicalMutation: 0,
    qualityStatus: "needs-review",
    humanValidated: false,
    limitations: [
      "Known-video development test, not unseen holdout",
      "No listening performed",
      "Machine cue coverage does not establish complete acoustic utterance",
      "Local short/long transcript comparison has different source coverage",
    ],
  };
  await durable(path.join(root, "reference-evaluation.json"), report, true);
  return report;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const r = await evaluateContext(...process.argv.slice(2));
    console.log(
      JSON.stringify(
        {
          integrity: r.integrity,
          whole: r.whole.candidate.edit,
          diagnostics: r.comparisons.map((c) => ({
            targetId: c.targetId,
            backend: c.backend,
            short: c.comparison.baseline.edit,
            expanded: c.comparison.candidate.edit,
            cautions: c.comparison.cautions,
          })),
        },
        null,
        2,
      ),
    );
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  }
}
