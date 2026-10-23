import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import Ajv from "ajv/dist/2020.js";
import {
  repo,
  loadExperiment,
  ledger,
  validateJournal,
} from "./lib/bounded-asr-ab.mjs";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { safePath } from "../packages/video-subtitler/dist/standalone/recovery.js";
import {
  boundaryDedup,
  serializeRecords,
} from "../packages/video-subtitler/dist/standalone/bounded.js";

const manifest = process.argv[2];
if (!manifest)
  throw Error(
    "Usage: node scripts/validate-bounded-asr-ab.mjs /path/experiment.json",
  );
const root = path.dirname(manifest),
  m = await loadExperiment(manifest);
const read = async (name) => {
  const p = path.join(root, name);
  await safePath(p);
  return JSON.parse(await fs.readFile(p, "utf8"));
};
const schema = JSON.parse(
  await fs.readFile(
    path.join(
      repo,
      "schemas/subtitle-tool-v1/bounded-asr-experiment.schema.json",
    ),
    "utf8",
  ),
);
const validate = new Ajv({ strict: true, allErrors: true }).compile(schema);
assert.ok(validate(m), JSON.stringify(validate.errors));
for (const extra of [
  { humanValidated: true },
  { machineOnlyReleaseAuthorized: true },
  { finalizationMethod: "human" },
  { unknown: true },
])
  assert.equal(validate({ ...m, ...extra }), false);
const entries = await ledger(root),
  attempts = validateJournal(m, entries),
  freeze = await read("results-freeze.json");
assert.equal(freeze.planHash, m.planHash);
assert.equal(freeze.ledgerTail, entries.at(-1)?.hash ?? null);
assert.equal(freeze.referenceRead, false);
for (const file of freeze.files) {
  assert.ok(!file.path.includes("..") && !path.isAbsolute(file.path));
  await safePath(path.join(root, file.path));
  assert.equal(await fileHash(path.join(root, file.path)), file.sha256);
}
assert.equal(
  await fileHash(path.join(root, "A/raw-primary.srt")),
  m.baseline.raw.sha256,
);
for (const attempt of attempts.filter((a) => a.state === "completed"))
  assert.equal(
    await fileHash(path.join(root, attempt.rawPath)),
    attempt.rawHash,
  );
for (const group of ["A", "B"]) {
  const raw = await read(`${group}/raw-records.json`),
    mapped = await read(`${group}/mapped-before-dedup.json`),
    exportMap = await read(`${group}/export-map.json`),
    metrics = await read(`${group}/metrics.json`);
  assert.equal(raw.length, mapped.length);
  assert.equal(metrics.rawRecords, raw.length);
  assert.deepEqual(
    raw.map((r) => r.recordId),
    mapped.map((r) => r.recordId),
  );
  assert.equal(
    new Set(exportMap.accounting.map((r) => r.recordId)).size,
    raw.length,
  );
  assert.deepEqual(
    raw.map((r) => r.recordId),
    exportMap.accounting.map((r) => r.recordId),
  );
  const retainedIds = new Set(
    exportMap.accounting
      .filter((r) => r.disposition === "retained")
      .map((r) => r.recordId),
  );
  for (const r of exportMap.accounting) {
    assert.ok(["retained", "alias", "unresolved"].includes(r.disposition));
    if (r.disposition === "alias") assert.ok(retainedIds.has(r.aliasOf));
  }
  if (group === "B")
    assert.deepEqual(
      boundaryDedup(mapped, m.chunks, m.pcm.sampleRate).decisions,
      await read("B/boundary-decisions.json"),
    );
  const assembled = await read(`${group}/assembled-records.json`);
  assert.equal(assembled.length, retainedIds.size);
  assert.equal(exportMap.humanValidated, false);
  assert.equal(exportMap.machineOnlyReleaseAuthorized, false);
  assert.equal(exportMap.finalizationMethod, "none");
  if (["partial", "machine-draft"].includes(exportMap.delivery)) {
    const result = serializeRecords(assembled, m.language);
    for (const [f, value] of Object.entries(result.files))
      assert.equal(
        await fs.readFile(
          path.join(
            root,
            group,
            "subtitles",
            `primary-minimal.${exportMap.delivery}.${f}`,
          ),
          "utf8",
        ),
        value,
      );
  }
}
console.log(
  JSON.stringify(
    {
      schema: "passed",
      forgedAuthorityRejected: 4,
      sampleCoverage: "passed",
      ledgerBudget: "passed",
      resultFreeze: "passed",
      rawByteIdentity: "passed",
      recordAccounting: "passed",
      boundaryDecisions: "passed",
      diskFormats: "passed",
      newInference: 0,
    },
    null,
    2,
  ),
);
