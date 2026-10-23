import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { safePath } from "../packages/video-subtitler/dist/standalone/recovery.js";
import { verifySeams } from "./subtitle-tool-refine-seams.mjs";
import { verifyRecovery } from "./subtitle-tool-vad-local-recovery.mjs";
import { verifyRefresh } from "./subtitle-tool-vad-context-refresh.mjs";
import { replayCandidateBatch } from "./lib/frozen-candidate-batch.mjs";
import { formatProjection } from "./lib/representation-grid.mjs";
const json = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const names = [
  "snapshot.json",
  "batch.json",
  "provenance.json",
  "machine-candidate.srt",
  "machine-candidate.ass",
  "machine-candidate.vtt",
];
async function load(spec) {
  assert.deepEqual(Object.keys(spec).sort(), ["local", "refresh", "seam"]);
  await verifySeams(spec.seam);
  await verifyRecovery(spec.local);
  await verifyRefresh(spec.refresh);
  const sp = await json(path.join(spec.seam, "plan.json")),
    lp = await json(path.join(spec.local, "plan.json"));
  assert.equal(sp.duration, lp.duration);
  return {
    seam: {
      baseline: await json(path.join(spec.seam, "baseline-records.json")),
      targets: sp.planned.targets,
      views: await json(path.join(spec.seam, "views.json")),
    },
    local: { ...lp, views: await json(path.join(spec.local, "views.json")) },
    refreshed: await json(path.join(spec.refresh, "boundary-review.json")),
  };
}
const exportsFor = (batch) =>
  formatProjection(
    batch.candidate.map((r) => ({
      recordId: r.id,
      sourceStart: r.start,
      sourceEnd: r.end,
      text: r.text,
    })),
    "ja",
  );
export async function createFrozenBatch(spec, output) {
  output = path.resolve(output);
  await safePath(output, true);
  for (const source of Object.values(spec))
    assert(
      output !== path.resolve(source) &&
        !output.startsWith(path.resolve(source) + path.sep),
      "OUTPUT_INSIDE_SOURCE",
    );
  const snapshot = await load(spec),
    batch = replayCandidateBatch(snapshot);
  const inputFiles = [
    import.meta.filename,
    path.join(import.meta.dirname, "lib/frozen-candidate-batch.mjs"),
    ...["seam", "local"].map((k) => path.join(spec[k], "machine-freeze.json")),
    path.join(spec.refresh, "boundary-review-freeze.json"),
  ];
  const bindings = await Promise.all(
    inputFiles.map(async (file) => ({ file, sha256: await fileHash(file) })),
  );
  await fs.mkdir(output, { recursive: true });
  const root = await fs.mkdtemp(path.join(output, "batch-"));
  const put = (n, value) =>
    fs.writeFile(
      path.join(root, n),
      typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n",
      { flag: "wx" },
    );
  await put("snapshot.json", snapshot);
  await put("batch.json", batch);
  await put("provenance.json", {
    spec,
    bindings,
    machineOnly: true,
    newInference: 0,
  });
  for (const [ext, text] of Object.entries(exportsFor(batch)))
    await put(`machine-candidate.${ext}`, text);
  const files = {};
  for (const n of names) files[n] = await fileHash(path.join(root, n));
  await put("machine-freeze.json", {
    version: "frozen-candidate-batch-v1",
    files,
    frozenAt: new Date().toISOString(),
  });
  await verifyFrozenBatch(root);
  return { root, ...batch.summary };
}
export async function verifyFrozenBatch(root) {
  await safePath(root);
  const f = await json(path.join(root, "machine-freeze.json"));
  assert.equal(f.version, "frozen-candidate-batch-v1");
  assert.deepEqual(Object.keys(f.files).sort(), [...names].sort());
  for (const n of names) {
    await safePath(path.join(root, n));
    assert.equal(
      await fileHash(path.join(root, n)),
      f.files[n],
      "PAYLOAD_CHANGED",
    );
  }
  const p = await json(path.join(root, "provenance.json"));
  for (const b of p.bindings)
    assert.equal(await fileHash(b.file), b.sha256, "INPUT_CHANGED");
  const snapshot = await load(p.spec),
    batch = replayCandidateBatch(snapshot);
  assert.deepEqual(await json(path.join(root, "snapshot.json")), snapshot);
  assert.deepEqual(await json(path.join(root, "batch.json")), batch);
  for (const [ext, text] of Object.entries(exportsFor(batch)))
    assert.equal(
      await fs.readFile(path.join(root, `machine-candidate.${ext}`), "utf8"),
      text,
    );
  return { integrity: "passed", newInference: 0, ...batch.summary };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [cmd, a, b] = process.argv.slice(2);
  assert(["create", "verify"].includes(cmd));
  console.log(
    JSON.stringify(
      cmd === "create"
        ? await createFrozenBatch(await json(a), b)
        : await verifyFrozenBatch(a),
      null,
      2,
    ),
  );
}
