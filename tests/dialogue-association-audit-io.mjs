import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  createAssociationAudit,
  verifyAssociationAudit,
} from "../scripts/audit-dialogue-association.mjs";
async function fixture(t) {
  const root = await fs.mkdtemp(
    path.join(await fs.realpath(os.tmpdir()), "association-test-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
test("cannot write diagnostic into immutable source directory", async (t) => {
  const root = await fixture(t);
  await fs.writeFile(
    path.join(root, "plan.json"),
    JSON.stringify({ sources: [] }),
  );
  await assert.rejects(
    createAssociationAudit(root, root),
    /OUTPUT_INSIDE_SOURCE/,
  );
  assert.deepEqual(await fs.readdir(root), ["plan.json"]);
});
test("cannot write diagnostic into source baseline task", async (t) => {
  const root = await fixture(t),
    source = path.join(root, "source"),
    baseline = path.join(root, "baseline");
  await fs.mkdir(source);
  await fs.mkdir(baseline);
  await fs.writeFile(
    path.join(source, "plan.json"),
    JSON.stringify({ sources: [{ task: baseline }] }),
  );
  await assert.rejects(
    createAssociationAudit(source, baseline),
    /OUTPUT_INSIDE_SOURCE/,
  );
  assert.deepEqual(await fs.readdir(baseline), []);
});
test("modified diagnostic is rejected before any source replay", async (t) => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, "diagnostic.json"), "tampered");
  await fs.writeFile(path.join(root, "REPORT.md"), "report");
  await fs.writeFile(
    path.join(root, "audit-freeze.json"),
    JSON.stringify({
      files: { "diagnostic.json": "0".repeat(64), "REPORT.md": "0".repeat(64) },
    }),
  );
  await assert.rejects(verifyAssociationAudit(root), /AUDIT_CHANGED/);
});
test("foreign/path-escaping inventory is rejected", async (t) => {
  const root = await fixture(t);
  await fs.writeFile(
    path.join(root, "audit-freeze.json"),
    JSON.stringify({ files: { "../unexpected": "0".repeat(64) } }),
  );
  await assert.rejects(verifyAssociationAudit(root));
});
