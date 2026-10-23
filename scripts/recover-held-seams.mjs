/** Explicit offline repair from a verified seam cache; historical inputs stay immutable. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { verifySeams } from "./subtitle-tool-refine-seams.mjs";
import { recoverHeldSeams } from "./lib/held-seam-recovery.mjs";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { safePath } from "../packages/video-subtitler/dist/standalone/recovery.js";
import {
  serializeRecords,
  formats,
} from "../packages/video-subtitler/dist/standalone/bounded.js";
const json = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const files = [
  "result.json",
  "provenance.json",
  "local-repair.candidate.ass",
  "local-repair.candidate.srt",
  "local-repair.candidate.vtt",
];
const sources = [
  import.meta.filename,
  ...[
    "held-seam-recovery.mjs",
    "content-safety-gate.mjs",
    "seam-context-text.mjs",
    "seam-text-only.mjs",
    "seam-refinement.mjs",
  ].map((n) => path.join(import.meta.dirname, "lib", n)),
];
async function load(evidence) {
  await verifySeams(evidence);
  const plan = await json(path.join(evidence, "plan.json"));
  assert.equal(plan.config.language, "ja", "JAPANESE_ONLY");
  return {
    plan,
    result: recoverHeldSeams({
      baseline: await json(path.join(evidence, "baseline-records.json")),
      targets: plan.planned.targets,
      views: await json(path.join(evidence, "views.json")),
    }),
  };
}
export async function recoverHeldSeamCache(evidence, outputParent) {
  evidence = await fs.realpath(evidence);
  outputParent = path.resolve(outputParent);
  await safePath(outputParent, true);
  const { plan, result } = await load(evidence);
  for (const input of [evidence, plan.task])
    assert(
      outputParent !== input && !outputParent.startsWith(input + path.sep),
      "OUTPUT_INSIDE_FROZEN_SOURCE",
    );
  const bindings = await Promise.all(
    [...sources, path.join(evidence, "machine-freeze.json")].map(
      async (file) => ({ file, sha256: await fileHash(file) }),
    ),
  );
  await fs.mkdir(outputParent, { recursive: true });
  const root = await fs.mkdtemp(path.join(outputParent, "held-seam-"));
  const put = (file, bytes) =>
    fs.writeFile(path.join(root, file), bytes, { flag: "wx" });
  await put("result.json", JSON.stringify(result, null, 2) + "\n");
  await put(
    "provenance.json",
    JSON.stringify(
      {
        evidence,
        bindings,
        baselineTask: plan.task,
        baselineMeaning:
          "historical-machine-draft-not-current-human-assisted-delivery",
        referenceUsed: false,
        scope: "explicit-cache-only-candidate; not automatic release",
      },
      null,
      2,
    ) + "\n",
  );
  for (const [ext, bytes] of Object.entries(
    serializeRecords(result.candidate, "ja").files,
  ))
    await put(`local-repair.candidate.${ext}`, bytes);
  await put(
    "freeze.json",
    JSON.stringify(
      {
        files: Object.fromEntries(
          await Promise.all(
            files.map(async (f) => [f, await fileHash(path.join(root, f))]),
          ),
        ),
      },
      null,
      2,
    ) + "\n",
  );
  return { root, ...(await verifyHeldSeamCache(root)) };
}
export async function verifyHeldSeamCache(root) {
  await safePath(root);
  const freeze = await json(path.join(root, "freeze.json"));
  assert.deepEqual(
    Object.keys(freeze.files).sort(),
    [...files].sort(),
    "FILE_INVENTORY",
  );
  for (const f of files) {
    await safePath(path.join(root, f));
    assert.equal(
      await fileHash(path.join(root, f)),
      freeze.files[f],
      "OUTPUT_CHANGED",
    );
  }
  const provenance = await json(path.join(root, "provenance.json"));
  assert.deepEqual(
    provenance.bindings.map((b) => b.file),
    [...sources, path.join(provenance.evidence, "machine-freeze.json")],
    "SOURCE_INVENTORY",
  );
  for (const b of provenance.bindings)
    assert.equal(await fileHash(b.file), b.sha256, "SOURCE_CHANGED");
  const { result } = await load(provenance.evidence);
  assert.deepEqual(
    await json(path.join(root, "result.json")),
    result,
    "DECISION_REPLAY_CHANGED",
  );
  const serialized = serializeRecords(result.candidate, "ja");
  for (const [ext, bytes] of Object.entries(serialized.files)) {
    const actual = await fs.readFile(
      path.join(root, `local-repair.candidate.${ext}`),
      "utf8",
    );
    assert.equal(actual, bytes, "SERIALIZATION_CHANGED");
    assert.deepEqual(
      formats[ext].parse(actual).map((c) => [c.start, c.end, c.text]),
      serialized.cues.map((c) => [c.start, c.end, c.text]),
      "FORMAT_PARITY",
    );
  }
  return {
    integrity: "passed",
    changedTargets: result.changedTargets,
    inputCueCount: result.inputCueCount,
    candidateCueCount: result.candidateCueCount,
    preservedRecords: result.preservedRecords,
    contentSafety: result.finalSafety.status,
    newInference: 0,
    modelLoads: 0,
    qualityStatus: "needs-review",
    preferredOutputs: [],
  };
}
