/** Offline replay. Old frozen providers/policies remain byte-for-byte untouched. */
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { safePath } from "../packages/video-subtitler/dist/standalone/recovery.js";
import { verifyRecovery } from "./subtitle-tool-vad-local-recovery.mjs";
import {
  routeSourceOccurrence,
  sourceOccurrenceInputs,
} from "./lib/source-occurrence-routing.mjs";

const [sourceArg, outputArg] = process.argv.slice(2);
assert(sourceArg && outputArg, "RECOVERY_ROOT OUTPUT_PARENT");
await safePath(sourceArg);
await safePath(path.resolve(outputArg), true);
const source = await fs.realpath(sourceArg),
  output = path.resolve(outputArg);
assert(
  output !== source && !output.startsWith(source + path.sep),
  "OUTPUT_INSIDE_SOURCE",
);
const verification = await verifyRecovery(source);
const read = async (n) =>
  JSON.parse(await fs.readFile(path.join(source, n), "utf8"));
const p = await read("plan.json"),
  views = await read("views.json");
const bindingPaths = [
  "plan.json",
  "views.json",
  "candidate.json",
  "machine-freeze.json",
].map((n) => path.join(source, n));
bindingPaths.push(
  import.meta.filename,
  path.join(import.meta.dirname, "lib/source-occurrence-routing.mjs"),
  path.join(import.meta.dirname, "lib/speech-support-policy.mjs"),
);
const bindings = await Promise.all(
  bindingPaths.map(async (file) => ({ file, sha256: await fileHash(file) })),
);
const inputs = sourceOccurrenceInputs(p, views);
const rows = inputs.map(routeSourceOccurrence);
const result = {
  rows,
  sourceVerification: verification,
  historicalAsrRequests: verification.recordedAsrRequests,
  newInference: 0,
  modelLoads: 0,
  baselineUnchanged: true,
  unsupportedRetainedIds: p.selected.unsupportedRetainedIds,
  routes: Object.fromEntries(
    [...new Set(rows.map((r) => r.route))].map((route) => [
      route,
      rows.filter((r) => r.route === route).length,
    ]),
  ),
  scope: "offline-routing-only-not-default-generation",
  qualityStatus: "needs-review",
  finalizationMethod: "none",
};
assert.deepEqual(await read("candidate.json"), p.baseline, "BASELINE_MUTATED");
await fs.mkdir(output, { recursive: true });
const root = await fs.mkdtemp(path.join(output, "occurrence-"));
const put = (n, v) =>
  fs.writeFile(path.join(root, n), JSON.stringify(v, null, 2) + "\n", {
    flag: "wx",
  });
await put("machine-inputs.json", inputs);
await put("routing.json", result);
await put("provenance.json", {
  bindings,
  labelsRead: false,
  humanConfirmationRead: false,
});
for (const b of bindings)
  assert.equal(await fileHash(b.file), b.sha256, "INPUT_CHANGED");
const files = {};
for (const name of ["machine-inputs.json", "routing.json", "provenance.json"])
  files[name] = await fileHash(path.join(root, name));
await put("routing-freeze.json", {
  files,
  newInference: 0,
  subtitleMutationAuthorized: false,
});
console.log(
  JSON.stringify(
    { root, routes: result.routes, targets: rows.length, newInference: 0 },
    null,
    2,
  ),
);
