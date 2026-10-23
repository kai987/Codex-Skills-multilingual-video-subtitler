/** Read frozen evidence only. No model dispatcher, reference input, or subtitle writer. */
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { verifyWordBoundary } from "./subtitle-tool-word-boundary.mjs";
import { auditAlignmentCoverage } from "./lib/alignment-coverage.mjs";
const json = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const repo = path.resolve(import.meta.dirname, "..");
async function derive(parent) {
  await verifyWordBoundary(parent);
  const p = await json(path.join(parent, "plan.json"));
  const context = await json(path.join(p.parent, "plan.json"));
  const baseline = await json(path.join(p.parent, "baseline-records.json"));
  const views = await json(path.join(p.parent, "views.json"));
  assert.equal(context.selected.length, 1, "ONE_FROZEN_TARGET_REQUIRED");
  const analysis = auditAlignmentCoverage({
    baseline,
    recordIds: p.recordIds,
    text: p.text,
    windows: p.windows,
    views,
    viewWindow: context.selected[0],
    offset: context.audioOffset,
    end: context.duration,
  });
  return {
    analysis,
    contextParent: p.parent,
    bindings: await Promise.all(
      [
        path.join(parent, "machine-freeze.json"),
        path.join(p.parent, "machine-freeze.json"),
        path.join(repo, "scripts/subtitle-tool-alignment-coverage.mjs"),
        path.join(repo, "scripts/lib/alignment-coverage.mjs"),
      ].map(async (p) => ({ path: p, sha256: await fileHash(p) })),
    ),
  };
}
export async function createCoverageAudit(parent, output) {
  parent = path.resolve(parent);
  output = path.resolve(output);
  const { analysis, bindings, contextParent } = await derive(parent);
  for (const old of [parent, contextParent])
    assert(
      output !== old && !output.startsWith(old + path.sep),
      "OUTPUT_INSIDE_FROZEN_INPUT",
    );
  await fs.mkdir(output, { recursive: true });
  const root = await fs.mkdtemp(path.join(output, "coverage-"));
  await fs.writeFile(
    path.join(root, "coverage.json"),
    JSON.stringify(analysis, null, 2) + "\n",
    { flag: "wx" },
  );
  await fs.writeFile(
    path.join(root, "audit-freeze.json"),
    JSON.stringify(
      {
        parent,
        bindings,
        coverageHash: await fileHash(path.join(root, "coverage.json")),
        newInference: 0,
        canonicalMutation: 0,
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  return verifyCoverageAudit(root);
}
export async function verifyCoverageAudit(root) {
  root = path.resolve(root);
  const f = await json(path.join(root, "audit-freeze.json"));
  assert.equal(f.newInference, 0);
  assert.equal(f.canonicalMutation, 0);
  for (const b of f.bindings)
    assert.equal(await fileHash(b.path), b.sha256, `CHANGED:${b.path}`);
  assert.equal(
    await fileHash(path.join(root, "coverage.json")),
    f.coverageHash,
    "COVERAGE_CHANGED",
  );
  const { analysis, bindings } = await derive(f.parent);
  assert.deepEqual(bindings, f.bindings);
  assert.deepEqual(await json(path.join(root, "coverage.json")), analysis);
  return {
    root,
    integrity: "passed",
    newInference: 0,
    canonicalMutation: 0,
    status: analysis.status,
    blockers: analysis.blockers,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const [command, input, output] = process.argv.slice(2);
    assert(
      input && (command === "verify" || (command === "audit" && output)),
      "usage: audit FROZEN_WORD_RUN OUTPUT_ROOT | verify AUDIT_ROOT",
    );
    console.log(
      JSON.stringify(
        command === "verify"
          ? await verifyCoverageAudit(input)
          : await createCoverageAudit(input, output),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
