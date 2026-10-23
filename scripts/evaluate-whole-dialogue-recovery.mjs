/** Post-freeze reference evaluation only; never imported by generation. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { verifyPrefixes } from "./replay-dialogue-prefix-recovery.mjs";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { compareReference } from "./lib/subtitle-reference-comparison.mjs";
import { includeSongs } from "./evaluate-seam-refinement.mjs";
const json = async (f) => JSON.parse(await fs.readFile(f, "utf8"));
const overlaps = (a, b) => a.start < b.end && b.start < a.end;
const norm = (s) => s.normalize("NFKC").replace(/[\p{P}\p{Z}\s\p{S}]/gu, "");
export async function evaluateDialogue(root, reference) {
  const integrity = await verifyPrefixes(root);
  const result = await json(path.join(root, "result.json"));
  const provenance = await json(path.join(root, "provenance.json"));
  const plan = await json(path.join(provenance.evidence, "plan.json"));
  const machineFreezeHash = await fileHash(
    path.join(root, "machine-freeze.json"),
  );
  // First reference read occurs only after both machine freezes and deterministic replays pass.
  const referenceReadAt = new Date().toISOString();
  const referenceHash = await fileHash(reference),
    ass = await fs.readFile(reference, "utf8");
  const baseline = result.baseline.map((r) => ({
    ...r,
    text: r.text.replace(/\p{S}/gu, ""),
  }));
  const candidate = result.candidate.map((r) => ({
    ...r,
    text: r.text.replace(/\p{S}/gu, ""),
  }));
  const compare = (referenceAss, windows) =>
    compareReference({
      referenceAss,
      baselineRecords: baseline,
      candidateRecords: candidate,
      windows,
    }).perWindow;
  const full = [
    {
      id: "full",
      start: 0,
      end: plan.sourceDuration,
      kind: "whole-episode-dialogue-plus-song",
    },
  ];
  const all = compare(includeSongs(ass), full)[0],
    dialogue = compare(ass, full)[0].reference.records;
  const song = all.reference.records.filter(
    (r) =>
      !dialogue.some(
        (d) => d.start === r.start && d.end === r.end && d.text === r.text,
      ),
  );
  // Close evaluation windows over WHOLE reference/baseline/candidate records.
  // These reference-expanded units never feed back into target selection or ASR.
  const evaluationRows = [...baseline, ...candidate, ...all.reference.records];
  const closed = plan.targets.map((t) => {
    let start = t.start,
      end = t.end;
    for (;;) {
      const rows = evaluationRows.filter((r) => overlaps(r, { start, end }));
      const a = Math.min(start, ...rows.map((r) => r.start)),
        b = Math.max(end, ...rows.map((r) => r.end));
      if (a === start && b === end) break;
      start = a;
      end = b;
    }
    return {
      id: t.id,
      start,
      end,
      kind: "post-freeze-reference-complete-development-unit",
    };
  });
  const units = compare(ass, closed).map((r, i) => ({
    ...r,
    sourceTarget: plan.targets[i],
    dialogueOnly: !song.some((s) => overlaps(s, r.window)),
    overlappingEvaluationUnits: closed
      .filter((w) => w.id !== r.window.id && overlaps(w, r.window))
      .map((w) => w.id),
  }));
  // Descriptive exact-text controls, selected post-freeze and explicitly not a blind holdout.
  const controls = baseline
    .filter(
      (r) =>
        norm(r.text).length >= 8 &&
        !closed.some((w) => overlaps(r, w)) &&
        !song.some((s) => overlaps(r, s)) &&
        dialogue.filter((d) => norm(d.text) === norm(r.text)).length === 1,
    )
    .slice(0, 2)
    .map((r) => ({
      id: r.id,
      unchanged:
        JSON.stringify(result.baseline.find((x) => x.id === r.id)) ===
        JSON.stringify(result.candidate.find((x) => x.id === r.id)),
      text: r.text,
      start: r.start,
      end: r.end,
      selection: "post-freeze-exact-reference-match-control-not-held-out",
    }));
  assert(
    controls.every((c) => c.unchanged),
    "CONTROL_CHANGED",
  );
  const changedUnits = units.filter((u) =>
    result.decisions.some(
      (d) => d.targetId === u.window.id && d.status === "CANDIDATE",
    ),
  );
  const evaluation = {
    version: "whole-dialogue-development-evaluation-v1",
    integrity,
    referenceReadAt,
    referenceHash,
    machineFreezeHash,
    normalization: "NFKC-remove-punctuation-symbols-separators-whitespace",
    overallDialoguePlusSong: all,
    units,
    controls,
    changedUnitResults: changedUnits.map((u) => ({
      id: u.window.id,
      before: u.baseline.edit,
      after: u.candidate.edit,
      netEditReduction: u.baseline.edit.distance - u.candidate.edit.distance,
      dialogueOnly: u.dialogueOnly,
    })),
    protectedRecords: result.protectedRecords,
    qualityStatus: "needs-review",
    limitations: [
      "Known development episode, not unseen-video acceptance",
      "Reference-expanded evaluation units may overlap; do not sum them",
      "Whole-episode metric includes songs; not pure dialogue accuracy",
      "No new listening verification; exact text agreement does not certify acoustic timing",
      "Unmaterialized leading interjection remains unresolved; only existing baseline full text retained",
    ],
  };
  await verifyPrefixes(root);
  assert.equal(await fileHash(reference), referenceHash, "REFERENCE_CHANGED");
  await fs.writeFile(
    path.join(root, "reference-evaluation.json"),
    JSON.stringify(evaluation, null, 2) + "\n",
    { flag: "wx" },
  );
  await fs.writeFile(
    path.join(root, "evaluation-freeze.json"),
    JSON.stringify(
      {
        files: {
          "reference-evaluation.json": await fileHash(
            path.join(root, "reference-evaluation.json"),
          ),
        },
        machineFreezeHash,
        referenceHash,
        evaluatorHash: await fileHash(import.meta.filename),
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  return {
    before: all.baseline.edit,
    after: all.candidate.edit,
    changedUnitResults: evaluation.changedUnitResults,
    controls,
    units: units.map((u) => ({
      id: u.window.id,
      start: u.window.start,
      end: u.window.end,
      before: u.baseline.edit.distance,
      after: u.candidate.edit.distance,
      reference: u.reference.normalizedText,
      overlaps: u.overlappingEvaluationUnits,
    })),
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [root, reference, ...extra] = process.argv.slice(2);
  assert(root && reference && !extra.length);
  console.log(JSON.stringify(await evaluateDialogue(root, reference), null, 2));
}
