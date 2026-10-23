/** Explicit offline completion of the missing-cohort serialization failure. Never dispatch. */
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { summarizeVad } from "./subtitle-tool-listening-vad.mjs";
import {
  compareRightContext,
  planRightContext,
  rightContextPolicy,
} from "./lib/right-context-probe.mjs";
const [root, mode] = process.argv.slice(2);
assert(root && ["finish", "verify"].includes(mode));
const read = async (f) => JSON.parse(await fs.readFile(f, "utf8"));
const local = (n) => path.join(root, n);
const put = (n, v) =>
  fs.writeFile(local(n), JSON.stringify(v, null, 2) + "\n", { flag: "wx" });
const p = await read(local("plan.json")),
  freeze = await read(local("machine-freeze.json"));
assert.equal(
  await fileHash(local("plan.json")),
  (await read(local("plan-freeze.json"))).planHash,
);
for (const [name, h] of Object.entries(freeze.files)) {
  assert(!path.isAbsolute(name) && !name.split(/[\\/]/u).includes(".."));
  assert.equal(await fileHash(local(name)), h);
}
for (const b of [...p.inputs, ...p.identities, ...p.software]) {
  const source =
    b.file === path.join(import.meta.dirname, "subtitle-tool-right-context.mjs")
      ? local("execution-source/subtitle-tool-right-context.mjs")
      : b.file;
  assert.equal(
    await fileHash(source),
    b.sha256,
    "BOUND_INPUT_OR_EXECUTION_SOURCE_CHANGED",
  );
}
assert.deepEqual(p.probe.policy, rightContextPolicy);
assert.equal(p.items.length, 1);
assert.equal(p.items[0].cohort, undefined);
const old = await read(p.rawFile),
  parent = await read(path.join(p.source, "plan.json"));
assert.deepEqual(
  p.probe,
  planRightContext(
    parent.planned.targets.find((t) => t.id === old.id),
    old,
    parent.duration,
    parent.baseline,
  ),
);
const i = p.items[0],
  raw = await read(local(i.id + "/raw.json")),
  saved = await read(local("observations.json"));
// JSON intentionally omits undefined values; compare persisted representations, not object shapes.
assert.deepEqual(
  JSON.parse(JSON.stringify([summarizeVad(i, raw)])),
  saved.observations,
);
assert.equal(saved.vadPasses, 1);
assert.equal(saved.modelLoads, 1);
assert.deepEqual(await read(local(i.id + "/exit.json")), {
  exitCode: 0,
  signal: null,
});
const phases = (await fs.readFile(local(i.id + "/phases.jsonl"), "utf8"))
  .trim()
  .split("\n")
  .map((s) => JSON.parse(s).phase);
for (const phase of [
  "model-loaded",
  "inference-pass-reserved",
  "inference-pass-completed",
])
  assert.equal(phases.filter((x) => x === phase).length, 1);
const result = {
  ...compareRightContext(p.probe, old, raw),
  completion: {
    mode: "offline-missing-cohort-json-shape-reconciliation",
    additionalInference: 0,
    originalVerifierPassed: false,
    rawEvidenceIntegrity: "passed",
  },
};
if (mode === "finish") {
  await put("boundary-result.json", result);
  await put("boundary-freeze.json", {
    sha256: await fileHash(local("boundary-result.json")),
    machineFreezeHash: await fileHash(local("machine-freeze.json")),
    completionSoftware: {
      file: import.meta.filename,
      sha256: await fileHash(import.meta.filename),
    },
  });
} else {
  const f = await read(local("boundary-freeze.json"));
  assert.equal(await fileHash(local("boundary-result.json")), f.sha256);
  assert.equal(
    await fileHash(local("machine-freeze.json")),
    f.machineFreezeHash,
  );
  assert.equal(
    await fileHash(f.completionSoftware.file),
    f.completionSoftware.sha256,
  );
  assert.deepEqual(await read(local("boundary-result.json")), result);
}
console.log(JSON.stringify(result, null, 2));
