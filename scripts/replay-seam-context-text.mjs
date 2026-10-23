import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { safePath } from "../packages/video-subtitler/dist/standalone/recovery.js";
import {
  serializeRecords,
  formats,
} from "../packages/video-subtitler/dist/standalone/bounded.js";
import { verifyFrozenBatch } from "./replay-frozen-candidates.mjs";
import { proposeContextText } from "./lib/seam-context-text.mjs";
import { proposeSeamTextOnly } from "./lib/seam-text-only.mjs";
import { assembleSeams } from "./lib/seam-refinement.mjs";
const json = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const put = (p, v) =>
  fs.writeFile(
    p,
    typeof v === "string" ? v : JSON.stringify(v, null, 2) + "\n",
    { flag: "wx" },
  );
const tuples = (rows) => rows.map((r) => [r.start, r.end, r.text]);
const names = [
  "result.json",
  "provenance.json",
  "machine-candidate.ass",
  "machine-candidate.srt",
  "machine-candidate.vtt",
];
export function assembleContextRun(snapshot) {
  const { seam } = snapshot;
  const old = seam.targets.map((t) =>
    proposeSeamTextOnly(
      t,
      seam.baseline,
      seam.views.filter((v) => v.targetId === t.id),
    ),
  );
  const decisions = seam.targets.map((t) =>
    proposeContextText(
      t,
      seam.baseline,
      seam.views.filter((v) => v.targetId === t.id),
    ),
  );
  const baseline = assembleSeams(seam.baseline, old),
    candidate = assembleSeams(seam.baseline, decisions);
  assert.deepEqual(
    tuples(serializeRecords(baseline, "ja").cues),
    tuples(snapshot.local.baseline),
    "CURRENT_BASELINE_MISMATCH",
  );
  const changed = decisions.filter(
    (d, i) => d.status === "CANDIDATE" && old[i].status !== "CANDIDATE",
  );
  for (const [i, d] of old.entries())
    if (d.status === "CANDIDATE")
      assert.deepEqual(decisions[i], d, "PRIOR_REPAIR_CHANGED");
  const ids = new Set(changed.flatMap((d) => d.replaceIds));
  const protectedRecords = baseline.filter((r) => !ids.has(r.recordId));
  assert.deepEqual(
    candidate.filter((r) =>
      protectedRecords.some((b) => b.recordId === r.recordId),
    ),
    protectedRecords,
    "PROTECTED_RECORD_CHANGED",
  );
  return {
    baseline,
    candidate,
    decisions,
    changedTargets: changed.length,
    protectedRecords: protectedRecords.length,
    newInference: 0,
    referenceUsed: false,
    qualityStatus: "needs-review",
    finalizationMethod: "none",
    duration: snapshot.local.duration,
  };
}
async function load(parent) {
  const check = await verifyFrozenBatch(parent);
  assert.equal(
    check.newInsertions,
    0,
    "BASELINE_WITH_LOCAL_INSERTIONS_UNSUPPORTED",
  );
  return assembleContextRun(await json(path.join(parent, "snapshot.json")));
}
export async function createContextRun(parent, out) {
  parent = path.resolve(parent);
  out = path.resolve(out);
  await safePath(out, true);
  assert(
    out !== parent && !out.startsWith(parent + path.sep),
    "OUTPUT_INSIDE_PARENT",
  );
  const result = await load(parent),
    serialized = serializeRecords(result.candidate, "ja");
  const bindings = await Promise.all(
    [
      import.meta.filename,
      path.join(import.meta.dirname, "lib/seam-context-text.mjs"),
      path.join(parent, "machine-freeze.json"),
    ].map(async (file) => ({ file, sha256: await fileHash(file) })),
  );
  await fs.mkdir(out, { recursive: true });
  const root = await fs.mkdtemp(path.join(out, "context-text-"));
  await put(path.join(root, "result.json"), result);
  await put(path.join(root, "provenance.json"), { parent, bindings });
  for (const [ext, content] of Object.entries(serialized.files))
    await put(path.join(root, `machine-candidate.${ext}`), content);
  const files = {};
  for (const n of names) files[n] = await fileHash(path.join(root, n));
  await put(path.join(root, "machine-freeze.json"), {
    version: "seam-context-text-v1",
    frozenAt: new Date().toISOString(),
    files,
  });
  return { root, ...(await verifyContextRun(root)) };
}
export async function verifyContextRun(root) {
  await safePath(root);
  const f = await json(path.join(root, "machine-freeze.json"));
  assert.equal(f.version, "seam-context-text-v1");
  assert.deepEqual(Object.keys(f.files).sort(), [...names].sort());
  for (const n of names) {
    await safePath(path.join(root, n));
    assert.equal(await fileHash(path.join(root, n)), f.files[n]);
  }
  const p = await json(path.join(root, "provenance.json"));
  for (const b of p.bindings)
    assert.equal(await fileHash(b.file), b.sha256, "SOURCE_CHANGED");
  const result = await load(p.parent);
  assert.deepEqual(result, await json(path.join(root, "result.json")));
  const serialized = serializeRecords(result.candidate, "ja");
  for (const [ext, text] of Object.entries(serialized.files)) {
    assert.equal(
      await fs.readFile(path.join(root, `machine-candidate.${ext}`), "utf8"),
      text,
    );
    assert.deepEqual(tuples(formats[ext].parse(text)), tuples(serialized.cues));
  }
  return {
    integrity: "passed",
    newInference: 0,
    changedTargets: result.changedTargets,
    baselineCues: result.baseline.length,
    candidateCues: result.candidate.length,
    protectedRecords: result.protectedRecords,
  };
}
async function evaluate(root, reference) {
  const verified = await verifyContextRun(root),
    freezeHash = await fileHash(path.join(root, "machine-freeze.json"));
  const r = await json(path.join(root, "result.json"));
  const { compareReference } =
    await import("./lib/subtitle-reference-comparison.mjs");
  const { includeSongs } = await import("./evaluate-seam-refinement.mjs");
  const referenceFirstReadAt = new Date().toISOString();
  const ass = await fs.readFile(reference, "utf8"),
    referenceHash = await fileHash(reference);
  const toCues = (records) => serializeRecords(records, "ja").cues;
  const comparison = compareReference({
    referenceAss: includeSongs(ass),
    baselineRecords: toCues(r.baseline),
    candidateRecords: toCues(r.candidate),
    windows: [
      {
        id: "whole-episode",
        kind: "full-source-text",
        start: 0,
        end: r.duration,
      },
      ...r.decisions
        .filter(
          (d) => d.reason === "WHOLE_DONOR_WITH_UNIQUE_CONTEXT_SUFFIX_SUPPORT",
        )
        .map((d) => ({
          id: d.targetId,
          kind: "frozen-machine-target",
          start: d.records[0].sourceStart,
          end: d.records[0].sourceEnd,
        })),
    ],
  });
  await verifyContextRun(root);
  assert.equal(await fileHash(reference), referenceHash);
  assert.equal(
    await fileHash(path.join(root, "machine-freeze.json")),
    freezeHash,
  );
  const out = path.join(root, "evaluation");
  await fs.mkdir(out);
  await put(path.join(out, "result.json"), {
    verified,
    freezeHash,
    referenceHash,
    referenceFirstReadAt,
    comparison,
    knownDevelopmentEpisode: true,
    acousticTimingVerified: false,
  });
  await put(path.join(out, "freeze.json"), {
    resultHash: await fileHash(path.join(out, "result.json")),
    machineFreezeHash: freezeHash,
    evaluatorHash: await fileHash(import.meta.filename),
  });
  return {
    out,
    scores: comparison.perWindow.map((w) => ({
      id: w.window.id,
      baseline: w.baseline.edit,
      candidate: w.candidate.edit,
    })),
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [cmd, a, b] = process.argv.slice(2);
  assert(["create", "verify", "evaluate"].includes(cmd));
  console.log(
    JSON.stringify(
      cmd === "create"
        ? await createContextRun(a, b)
        : cmd === "verify"
          ? await verifyContextRun(a)
          : await evaluate(a, b),
      null,
      2,
    ),
  );
}
