/** Cache-only boundary observability audit. No dispatch or subtitle serialization. */
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { verifyOnset } from "./subtitle-tool-timing-onset.mjs";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { safePath } from "../packages/video-subtitler/dist/standalone/recovery.js";
import {
  boundaryObservationPolicy,
  observeActivityBoundary,
} from "./lib/activity-boundary-observation.mjs";

const [sourceArg, outputArg] = process.argv.slice(2);
assert(
  sourceArg && outputArg,
  "Usage: node scripts/audit-activity-boundaries.mjs ONSET_RUN OUTPUT_PARENT",
);
const source = await fs.realpath(sourceArg);
const out = path.resolve(outputArg);
await safePath(out, true);
assert(out !== source && !out.startsWith(source + path.sep), "PRESERVE_SOURCE");
const integrity = await verifyOnset(source);
const read = async (f) => JSON.parse(await fs.readFile(f, "utf8"));
const p = await read(path.join(source, "plan.json"));
// This diagnostic implements the existing 512-sample Silero contract, not a generic VAD mapping.
assert.equal(p.vadProfile.threshold, boundaryObservationPolicy.threshold);
assert.equal(p.vadProfile.minSilenceMs, 100);
assert.equal(p.vadProfile.speechPadMs, 0);
assert.equal(p.vadProfile.samplesOverlap, 0);
assert(p.planned.targets.length <= 4);
const files = [
  "plan.json",
  "plan-freeze.json",
  "machine-freeze.json",
  "result.json",
  "machine-candidate.srt",
].map((n) => path.join(source, n));
const results = [];
for (const t of p.planned.targets) {
  const f = path.join(source, t.id, "raw.json");
  files.push(f);
  const raw = await read(f);
  results.push(observeActivityBoundary(t, raw));
}
files.push(
  import.meta.filename,
  path.join(import.meta.dirname, "lib/activity-boundary-observation.mjs"),
  path.join(
    import.meta.dirname,
    "../packages/video-subtitler/src/standalone/bounded.ts",
  ),
);
const bindings = await Promise.all(
  files.map(async (file) => ({ file, sha256: await fileHash(file) })),
);
await fs.mkdir(out, { recursive: true });
const root = await fs.mkdtemp(path.join(out, "boundary-audit-"));
const put = (n, v) =>
  fs.writeFile(path.join(root, n), JSON.stringify(v, null, 2) + "\n", {
    flag: "wx",
  });
await put("result.json", {
  policy: boundaryObservationPolicy,
  source,
  sourceIntegrity: integrity.integrity,
  selection:
    "all-four-existing-onset-targets; known-development-sample; not a calibrated benchmark",
  results,
  modelLoads: 0,
  newInference: 0,
  subtitleMutations: 0,
  referenceRead: false,
  qualityStatus: "needs-review",
  bindings,
});
for (const b of bindings)
  assert.equal(await fileHash(b.file), b.sha256, "SOURCE_CHANGED_DURING_AUDIT");
await put("freeze.json", {
  files: { "result.json": await fileHash(path.join(root, "result.json")) },
  bindings,
});
console.log(
  JSON.stringify(
    { root, results, newInference: 0, subtitleMutations: 0 },
    null,
    2,
  ),
);
