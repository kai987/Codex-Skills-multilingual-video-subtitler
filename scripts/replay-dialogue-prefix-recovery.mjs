/** Offline application of baseline-owned prefix proposals; preserves the paired run. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { verifyDialogueBatch } from "./run-whole-dialogue-recovery.mjs";
import { recoverBaselinePrefixes } from "./lib/dialogue-prefix-recovery.mjs";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { safePath } from "../packages/video-subtitler/dist/standalone/recovery.js";
import {
  serializeRecords,
  formats,
} from "../packages/video-subtitler/dist/standalone/bounded.js";
const json = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const sources = [
  import.meta.filename,
  path.join(import.meta.dirname, "lib/dialogue-prefix-recovery.mjs"),
];
const files = [
  "result.json",
  "provenance.json",
  ...["ass", "srt", "vtt"].map((e) => `candidate.needs-review.${e}`),
];
async function replay(evidence) {
  await verifyDialogueBatch(evidence);
  const p = await json(path.join(evidence, "plan.json")),
    r = await json(path.join(evidence, "result.json"));
  const sourceRows = await json(
    path.join(p.inputRoots[0], "baseline-records.json"),
  );
  return recoverBaselinePrefixes(
    p.baseline,
    p.targets,
    r.decisions.flatMap((d) => d.evidence),
    sourceRows,
  );
}
const serialized = (r) =>
  serializeRecords(
    r.candidate.map((c, i) => ({
      ...c,
      recordId: c.id,
      order: i + 1,
      sourceStart: c.start,
      sourceEnd: c.end,
      issues: [],
    })),
    "ja",
  );
export async function replayPrefixes(evidence, output) {
  evidence = await fs.realpath(evidence);
  output = path.resolve(output);
  const p = await json(path.join(evidence, "plan.json"));
  await safePath(output, true);
  for (const input of [evidence, p.sourceTask, ...p.inputRoots])
    assert(
      output !== input && !output.startsWith(input + path.sep),
      "OUTPUT_INSIDE_EVIDENCE",
    );
  const result = await replay(evidence);
  await fs.mkdir(output, { recursive: true });
  const root = await fs.mkdtemp(path.join(output, "prefix-"));
  const put = (file, bytes) =>
    fs.writeFile(path.join(root, file), bytes, { flag: "wx" });
  await put("result.json", JSON.stringify(result, null, 2) + "\n");
  await put(
    "provenance.json",
    JSON.stringify(
      {
        evidence,
        referenceUsed: false,
        stage: "post-inference-pre-reference-assembly",
        bindings: await Promise.all(
          [...sources, path.join(evidence, "machine-freeze.json")].map(
            async (file) => ({ file, sha256: await fileHash(file) }),
          ),
        ),
      },
      null,
      2,
    ) + "\n",
  );
  for (const [ext, bytes] of Object.entries(serialized(result).files))
    await put(`candidate.needs-review.${ext}`, bytes);
  await put(
    "machine-freeze.json",
    JSON.stringify(
      {
        frozenAt: new Date().toISOString(),
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
  return verifyPrefixes(root);
}
export async function verifyPrefixes(root) {
  await safePath(root);
  const f = await json(path.join(root, "machine-freeze.json"));
  assert.deepEqual(Object.keys(f.files).sort(), [...files].sort());
  for (const name of files) {
    await safePath(path.join(root, name));
    assert.equal(await fileHash(path.join(root, name)), f.files[name]);
  }
  const p = await json(path.join(root, "provenance.json"));
  assert.deepEqual(
    p.bindings.map((b) => b.file),
    [...sources, path.join(p.evidence, "machine-freeze.json")],
  );
  for (const b of p.bindings) assert.equal(await fileHash(b.file), b.sha256);
  const r = await replay(p.evidence);
  assert.deepEqual(await json(path.join(root, "result.json")), r);
  const expected = serialized(r);
  for (const [ext, bytes] of Object.entries(expected.files)) {
    assert.equal(
      await fs.readFile(
        path.join(root, `candidate.needs-review.${ext}`),
        "utf8",
      ),
      bytes,
    );
    assert.deepEqual(
      formats[ext].parse(bytes).map((c) => [c.start, c.end, c.text]),
      expected.cues.map((c) => [c.start, c.end, c.text]),
    );
  }
  return {
    root,
    integrity: "passed",
    changedTargets: r.changedTargets,
    removedPrefixRecords: r.removedPrefixRecords,
    inputCues: r.baseline.length,
    candidateCues: r.candidate.length,
    protectedRecords: r.protectedRecords,
    newInference: 0,
    qualityStatus: "needs-review",
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [mode, a, b, ...extra] = process.argv.slice(2);
  if (mode === "replay" && a && b && !extra.length)
    console.log(JSON.stringify(await replayPrefixes(a, b), null, 2));
  else if (mode === "verify" && a && !b)
    console.log(JSON.stringify(await verifyPrefixes(a), null, 2));
  else throw Error("Usage: replay EVIDENCE OUTPUT | verify TASK");
}
