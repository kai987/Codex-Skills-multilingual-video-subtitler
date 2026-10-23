/** Evaluation-only entry. No imports from this file are permitted in generation. */
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { verifySeams } from "./subtitle-tool-refine-seams.mjs";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { compareReference } from "./lib/subtitle-reference-comparison.mjs";
import { auditContent } from "./lib/machine-content-audit.mjs";
import {
  proposeSeamTextOnly,
  seamTextOnlyPolicy,
} from "./lib/seam-text-only.mjs";
import { assembleSeams } from "./lib/seam-refinement.mjs";
const json = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const symbols = (s) => s.replace(/\p{S}/gu, "");
async function verifyEvaluationInput(root) {
  const freeze = await json(path.join(root, "machine-freeze.json"));
  if (freeze.version !== seamTextOnlyPolicy.version)
    return {
      integrity: await verifySeams(root),
      plan: await json(path.join(root, "plan.json")),
    };
  for (const [name, expected] of Object.entries(freeze.files)) {
    if (path.isAbsolute(name) || name.split(/[\\/]/u).includes(".."))
      throw Error("UNSAFE_FROZEN_PATH");
    assert.equal(await fileHash(path.join(root, name)), expected);
  }
  assert.equal(
    await fileHash(path.join(freeze.input, "machine-freeze.json")),
    freeze.inputFreezeHash,
  );
  await verifySeams(freeze.input);
  const plan = await json(path.join(freeze.input, "plan.json")),
    rows = await json(path.join(freeze.input, "baseline-records.json")),
    views = await json(path.join(freeze.input, "views.json"));
  assert.deepEqual(await json(path.join(root, "baseline-records.json")), rows);
  assert.deepEqual(
    await json(path.join(root, "policy.json")),
    seamTextOnlyPolicy,
  );
  const decisions = plan.planned.targets.map((t) =>
    proposeSeamTextOnly(
      t,
      rows,
      views.filter((v) => v.targetId === t.id),
    ),
  );
  assert.deepEqual(await json(path.join(root, "decisions.json")), decisions);
  assert.deepEqual(
    await json(path.join(root, "candidate-records.json")),
    assembleSeams(rows, decisions),
  );
  return {
    integrity: { passed: true, newInference: 0, decisionReplay: true },
    plan,
  };
}
export function includeSongs(ass) {
  let format = null,
    inEvents = false;
  return ass
    .split(/\r?\n/u)
    .map((line) => {
      if (line.startsWith("[")) {
        inEvents = line.trim() === "[Events]";
        format = null;
      }
      if (!inEvents) return line;
      if (line.startsWith("Format:"))
        format = line
          .slice(7)
          .split(",")
          .map((x) => x.trim().toLowerCase());
      if (!line.startsWith("Dialogue:")) return line;
      if (!format || format.at(-1) !== "text")
        throw Error("INVALID_ASS_FORMAT");
      let text = line.slice(9).trimStart();
      const values = [];
      for (let i = 0; i < format.length - 1; i++) {
        const index = text.indexOf(",");
        if (index < 0) throw Error("INVALID_ASS_ROW");
        values.push(text.slice(0, index));
        text = text.slice(index + 1);
      }
      values.push(symbols(text));
      const style = format.indexOf("style");
      if (style < 0) throw Error("MISSING_ASS_STYLE");
      if (values[style] === "Song") values[style] = "Dialogue";
      return "Dialogue: " + values.join(",");
    })
    .join("\n");
}
export async function evaluateSeams(root, reference) {
  const { integrity, plan } = await verifyEvaluationInput(root);
  const baseline = await json(path.join(root, "baseline-records.json")),
    candidate = await json(path.join(root, "candidate-records.json"));
  const map = (rows) =>
    rows.map((r) => ({
      id: r.recordId,
      start: r.sourceStart,
      end: r.sourceEnd,
      text: symbols(r.text),
    }));
  // Verify freeze before this explicit reference read. Do not reassemble after seeing scores.
  const referenceHash = await fileHash(reference),
    ass = await fs.readFile(reference, "utf8");
  const compare = (referenceAss) =>
    compareReference({
      referenceAss,
      baselineRecords: map(baseline),
      candidateRecords: map(candidate),
      windows: [
        {
          id: "full-episode",
          kind: "whole-source",
          start: 0,
          end: plan.duration,
        },
      ],
    }).perWindow[0];
  const overall = compare(includeSongs(ass));
  const result = {
    version: "seam-refinement-evaluation-v1",
    createdAt: new Date().toISOString(),
    referenceHash,
    freezeHash: await fileHash(path.join(root, "machine-freeze.json")),
    integrity,
    scope: "whole-known-episode-not-unseen-holdout",
    normalization: "NFKC-remove-punctuation-symbols-separators-whitespace",
    overall,
    changedTargets: (await json(path.join(root, "decisions.json"))).filter(
      (d) => d.status === "CANDIDATE",
    ),
    baselineAudit: auditContent(map(baseline), {
      language: plan.config.language,
      sourceEnd: plan.duration,
    }),
    candidateAudit: auditContent(map(candidate), {
      language: plan.config.language,
      sourceEnd: plan.duration,
    }),
    qualityStatus: "needs-review",
    limitations: [
      "Reference first Japanese lines only; Dialogue plus Song, excluding ruby and credits",
      "No listening performed",
      "No exact text match is not proof of hallucination",
      "Known-video development comparison, not new-video generalization",
      "Same-model two-view agreement is not independent acoustic truth",
    ],
  };
  await verifyEvaluationInput(root);
  if ((await fileHash(reference)) !== referenceHash)
    throw Error("REFERENCE_CHANGED_DURING_EVALUATION");
  await fs.writeFile(
    path.join(root, "reference-evaluation.json"),
    JSON.stringify(result, null, 2) + "\n",
    { flag: "wx" },
  );
  return {
    baseline: overall.baseline.edit,
    candidate: overall.candidate.edit,
    changedTargets: result.changedTargets.length,
    baselineWarnings: result.baselineAudit.summary,
    candidateWarnings: result.candidateAudit.summary,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const [root, reference, ...extra] = process.argv.slice(2);
    if (!root || !reference || extra.length)
      throw Error("Usage: RUN REFERENCE.ass");
    console.log(JSON.stringify(await evaluateSeams(root, reference), null, 2));
  } catch (error) {
    console.error(String(error));
    process.exitCode = 1;
  }
}
