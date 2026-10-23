/** Source-bound offline replay; never dispatches ASR or alignment. */
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { safePath } from "../packages/video-subtitler/dist/standalone/recovery.js";
import { verifyRecovery } from "./subtitle-tool-vad-local-recovery.mjs";
import { auditBoundedEvidence } from "./lib/bounded-evidence-audit.mjs";
import { localizeStoredContext } from "./lib/full-context-token-localization.mjs";

const [sourceArg, outputArg, ...ids] = process.argv.slice(2);
assert(
  sourceArg && outputArg && ids.length,
  "RECOVERY_ROOT OUTPUT_PARENT TARGET_IDS...",
);
await safePath(sourceArg);
await safePath(path.resolve(outputArg), true);
const source = await fs.realpath(sourceArg),
  output = path.resolve(outputArg);
assert(
  output !== source && !output.startsWith(source + path.sep),
  "OUTPUT_INSIDE_SOURCE",
);
await verifyRecovery(source);
const planPath = path.join(source, "plan.json");
const plan = JSON.parse(await fs.readFile(planPath, "utf8"));
assert.equal(plan.referenceUsed, false);
assert.equal(plan.labelsUsed, false);
const probes = ids.map((id) => {
  const p = plan.probes.find((p) => p.id === id);
  assert(p, `UNKNOWN_PROBE:${id}`);
  return p;
});
const boundPaths = [
  planPath,
  plan.spec.subtitle,
  path.join(source, "machine-freeze.json"),
  import.meta.filename,
  path.join(import.meta.dirname, "lib/full-context-token-localization.mjs"),
  path.join(import.meta.dirname, "lib/bounded-evidence-audit.mjs"),
  path.join(import.meta.dirname, "lib/stored-token-evidence.mjs"),
];
const bindings = await Promise.all(
  boundPaths.map(async (file) => ({ file, sha256: await fileHash(file) })),
);
const audited = await auditBoundedEvidence(plan.spec.task, {
  outputRoot: output,
});
const auditPath = audited.report;
assert(auditPath, "AUDIT_PATH_REQUIRED");
const audit = JSON.parse(await fs.readFile(auditPath, "utf8"));
bindings.push({ file: auditPath, sha256: await fileHash(auditPath) });
const result = {
  version: "full-context-token-localization-v1",
  targets: localizeStoredContext(audit, probes),
  newASRRequests: 0,
  modelLoads: 0,
  textMutations: 0,
  timingMutations: 0,
  referenceUsed: false,
  labelsUsed: false,
  qualityStatus: "needs-review",
  finalizationMethod: "none",
  scope: "diagnostic-only-not-default-subtitle-generation",
};
for (const b of bindings)
  assert.equal(await fileHash(b.file), b.sha256, "INPUT_CHANGED");
const root = await fs.mkdtemp(path.join(output, "localization-"));
const put = (name, value) =>
  fs.writeFile(path.join(root, name), JSON.stringify(value, null, 2) + "\n", {
    flag: "wx",
  });
await put("localization.json", result);
await put("provenance.json", {
  bindings,
  labelsRead: false,
  referenceRead: false,
});
await put("freeze.json", {
  files: Object.fromEntries(
    await Promise.all(
      ["localization.json", "provenance.json"].map(async (n) => [
        n,
        await fileHash(path.join(root, n)),
      ]),
    ),
  ),
});
console.log(
  JSON.stringify(
    {
      root,
      targets: result.targets.map((t) => ({
        id: t.probe.id,
        diagnostic: t.diagnostic,
        contextRows: t.context.length,
      })),
      newASRRequests: 0,
    },
    null,
    2,
  ),
);
