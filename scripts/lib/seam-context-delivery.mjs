/** Offline production adapter. No batch/Gold dependency, model loading or dispatch. */
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { verifySeams } from "../subtitle-tool-refine-seams.mjs";
import { proposeContextText, contextTextPolicy } from "./seam-context-text.mjs";
import { proposeSeamTextOnly } from "./seam-text-only.mjs";
import { assembleSeams } from "./seam-refinement.mjs";
import { fileHash } from "../../packages/video-subtitler/dist/standalone/tool.js";
import { safePath } from "../../packages/video-subtitler/dist/standalone/recovery.js";
import {
  serializeRecords,
  formats,
} from "../../packages/video-subtitler/dist/standalone/bounded.js";

const json = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const names = [
  "result.json",
  "machine-candidate.ass",
  "machine-candidate.srt",
  "machine-candidate.vtt",
];
const software = [
  "seam-context-delivery.mjs",
  "seam-context-text.mjs",
  "seam-text-only.mjs",
  "seam-refinement.mjs",
];
const version = "seam-context-delivery-v1";

export function assembleContextEvidence({ baseline, targets, views }) {
  const decide = (policy) =>
    targets.map((t) =>
      policy(
        t,
        baseline,
        views.filter((v) => v.targetId === t.id),
      ),
    );
  const priorDecisions = decide(proposeSeamTextOnly);
  const decisions = decide(proposeContextText);
  for (const [i, d] of priorDecisions.entries())
    if (d.status === "CANDIDATE")
      assert.deepEqual(decisions[i], d, "PRIOR_REPAIR_CHANGED");
  const current = assembleSeams(baseline, priorDecisions);
  const candidate = assembleSeams(baseline, decisions);
  const added = decisions.filter(
    (d, i) =>
      d.status === "CANDIDATE" && priorDecisions[i].status !== "CANDIDATE",
  );
  const replaced = new Set(added.flatMap((d) => d.replaceIds));
  const protectedRows = current.filter((r) => !replaced.has(r.recordId));
  const protectedIds = new Set(protectedRows.map((r) => r.recordId));
  assert.deepEqual(
    candidate.filter((r) => protectedIds.has(r.recordId)),
    protectedRows,
    "PROTECTED_RECORD_CHANGED",
  );
  return {
    baseline: current,
    candidate,
    decisions,
    priorDecisions,
    additionalChangedTargets: added.length,
    totalChangedTargets: decisions.filter((d) => d.status === "CANDIDATE")
      .length,
    protectedRecords: protectedRows.length,
    policy: contextTextPolicy,
    newInference: 0,
    referenceUsed: false,
    qualityStatus: "needs-review",
    finalizationMethod: "none",
    humanValidated: false,
    acousticTimingVerified: false,
    automaticPromotionAllowed: false,
  };
}

async function load(input) {
  await safePath(input);
  await verifySeams(input);
  const plan = await json(path.join(input, "plan.json"));
  assert.equal(plan.config.language, "ja", "JAPANESE_ONLY");
  const result = assembleContextEvidence({
    baseline: await json(path.join(input, "baseline-records.json")),
    targets: plan.planned.targets,
    views: await json(path.join(input, "views.json")),
  });
  return result;
}

export async function assembleContextDelivery(input, outputRoot) {
  input = path.resolve(input);
  outputRoot = path.resolve(outputRoot);
  await safePath(input);
  await safePath(outputRoot, true);
  assert(
    outputRoot !== input && !outputRoot.startsWith(input + path.sep),
    "OUTPUT_INSIDE_FROZEN_RUN",
  );
  const inputFreezeHash = await fileHash(
    path.join(input, "machine-freeze.json"),
  );
  const result = await load(input);
  const code = Object.fromEntries(
    await Promise.all(
      software.map(async (name) => [
        name,
        await fileHash(path.join(import.meta.dirname, name)),
      ]),
    ),
  );
  await fs.mkdir(outputRoot, { recursive: true });
  const root = await fs.mkdtemp(path.join(outputRoot, "context-delivery-"));
  const put = (name, bytes) =>
    fs.writeFile(path.join(root, name), bytes, { flag: "wx" });
  await put("result.json", JSON.stringify(result, null, 2) + "\n");
  const serialized = serializeRecords(result.candidate, "ja");
  for (const [ext, bytes] of Object.entries(serialized.files))
    await put(`machine-candidate.${ext}`, bytes);
  const files = Object.fromEntries(
    await Promise.all(
      names.map(async (name) => [name, await fileHash(path.join(root, name))]),
    ),
  );
  await put(
    "machine-freeze.json",
    JSON.stringify(
      {
        version,
        input,
        inputFreezeHash,
        code,
        files,
        frozenAt: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
  );
  return {
    root,
    ...(await verifyContextDelivery(root)),
    outputs: ["ass", "srt", "vtt"].map((ext) =>
      path.join(root, `machine-candidate.${ext}`),
    ),
  };
}

export async function verifyContextDelivery(root) {
  await safePath(root);
  const freeze = await json(path.join(root, "machine-freeze.json"));
  assert.equal(freeze.version, version);
  assert.deepEqual(Object.keys(freeze.files).sort(), [...names].sort());
  assert.deepEqual(Object.keys(freeze.code).sort(), [...software].sort());
  for (const name of names) {
    await safePath(path.join(root, name));
    assert.equal(
      await fileHash(path.join(root, name)),
      freeze.files[name],
      `OUTPUT_CHANGED:${name}`,
    );
  }
  for (const name of software)
    assert.equal(
      await fileHash(path.join(import.meta.dirname, name)),
      freeze.code[name],
      `CODE_CHANGED:${name}`,
    );
  assert.equal(
    await fileHash(path.join(freeze.input, "machine-freeze.json")),
    freeze.inputFreezeHash,
    "INPUT_FREEZE_CHANGED",
  );
  const result = await load(freeze.input);
  assert.deepEqual(
    await json(path.join(root, "result.json")),
    result,
    "REPLAY_MISMATCH",
  );
  const serialized = serializeRecords(result.candidate, "ja");
  for (const [ext, bytes] of Object.entries(serialized.files)) {
    assert.equal(
      await fs.readFile(path.join(root, `machine-candidate.${ext}`), "utf8"),
      bytes,
    );
    assert.deepEqual(
      formats[ext].parse(bytes).map((r) => [r.start, r.end, r.text]),
      serialized.cues.map((r) => [r.start, r.end, r.text]),
    );
  }
  return {
    integrity: "passed",
    newInference: 0,
    additionalChangedTargets: result.additionalChangedTargets,
    totalChangedTargets: result.totalChangedTargets,
    protectedRecords: result.protectedRecords,
    baselineCues: result.baseline.length,
    candidateCues: result.candidate.length,
    automaticPromotionAllowed: false,
  };
}
