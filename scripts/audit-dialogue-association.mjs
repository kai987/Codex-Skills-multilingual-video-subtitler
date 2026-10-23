/** Offline sidecar. Uses only frozen machine evidence; never exports replacement subtitles. */
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { verifyLexicalComparison } from "./run-lexical-risk-comparison.mjs";
import { diagnoseDialogueAssociation } from "./lib/dialogue-association-diagnostic.mjs";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { safePath } from "../packages/video-subtitler/dist/standalone/recovery.js";
import { durable } from "./lib/bounded-asr-ab.mjs";
const json = async (f) => JSON.parse(await fs.readFile(f, "utf8"));
const put = (r, n, v) => durable(path.join(r, n), v, true);
async function replay(source) {
  await verifyLexicalComparison(source);
  const p = await json(path.join(source, "plan.json")),
    r = await json(path.join(source, "result.json"));
  const targets = [];
  for (const s of r.sources)
    for (const decision of s.decisions) {
      const window = p.windows.find(
        (w) => w.sourceId === s.id && w.target.id === decision.targetId,
      );
      assert(window, "MISSING_TARGET_BINDING");
      const d = diagnoseDialogueAssociation(
        s.baseline,
        window.target,
        decision.evidence,
      );
      assert.deepEqual(d.originalDecision, {
        status: decision.status,
        reason: decision.reason,
      });
      targets.push({ sourceId: s.id, ...d });
    }
  return {
    version: "dialogue-association-audit-v1",
    targets,
    newInference: 0,
    subtitleMutations: 0,
    referenceUsed: false,
    qualityStatus: "needs-review",
  };
}
function render(report) {
  return [
    "# Dialogue association diagnostic — no subtitle changes",
    "",
    "Offline diagnostic only. No model loads, no reference input, no substring timestamps or replacement exports. Whole raw segments are not proof of complete spoken utterances.",
    "",
    ...report.targets.flatMap((t) => [
      `## ${t.sourceId} / ${t.target.start}–${t.target.end} seconds`,
      "",
      `Original: ${t.originalDecision.status} / ${t.originalDecision.reason}`,
      "",
      ...t.flags.map((f) => `- ${f}`),
      "",
      `Request context: ${t.context.requestStart}–${t.context.requestEnd}; whole baseline closure: ${t.context.start}–${t.context.end}.`,
      "",
      ...t.viewGroups.flatMap((v) => [
        `### ${v.viewId}`,
        "",
        ...v.groups.flatMap((g) => [
          `- Raw group: ${JSON.stringify(g.text)}`,
          `  - ${g.characters} normalized characters; coverage ${g.coverage.toFixed(3)}; blockers: ${g.blockers.join(", ") || "none at group stage"}; crop edge: ${g.cropEdge}.`,
        ]),
        "",
      ]),
      "Text anchors are diagnostic matches, not verified speech ownership. See diagnostic.json for every relation, repeated-anchor count and partial-context record.",
      "",
    ]),
  ].join("\n");
}
export async function createAssociationAudit(source, output) {
  source = await fs.realpath(source);
  const parent = path.resolve(output);
  await safePath(parent, true);
  const p = await json(path.join(source, "plan.json"));
  for (const input of [source, ...p.sources.map((s) => s.task)]) {
    const real = await fs.realpath(input);
    assert(
      parent !== real && !parent.startsWith(real + path.sep),
      "OUTPUT_INSIDE_SOURCE",
    );
  }
  const report = await replay(source);
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, "association-"));
  await put(root, "diagnostic.json", report);
  await fs.writeFile(path.join(root, "REPORT.md"), render(report), {
    flag: "wx",
  });
  const software = [
    import.meta.filename,
    path.join(import.meta.dirname, "lib/dialogue-association-diagnostic.mjs"),
  ];
  await put(root, "audit-freeze.json", {
    source,
    sourceFreezeHash: await fileHash(path.join(source, "machine-freeze.json")),
    software: await Promise.all(
      software.map(async (file) => ({ file, sha256: await fileHash(file) })),
    ),
    files: Object.fromEntries(
      await Promise.all(
        ["diagnostic.json", "REPORT.md"].map(async (n) => [
          n,
          await fileHash(path.join(root, n)),
        ]),
      ),
    ),
  });
  return verifyAssociationAudit(root);
}
export async function verifyAssociationAudit(root) {
  await safePath(root);
  const freeze = await json(path.join(root, "audit-freeze.json"));
  assert.deepEqual(Object.keys(freeze.files).sort(), [
    "REPORT.md",
    "diagnostic.json",
  ]);
  for (const [n, h] of Object.entries(freeze.files)) {
    await safePath(path.join(root, n));
    assert.equal(await fileHash(path.join(root, n)), h, `AUDIT_CHANGED:${n}`);
  }
  for (const s of freeze.software)
    assert.equal(
      await fileHash(s.file),
      s.sha256,
      "DIAGNOSTIC_SOFTWARE_CHANGED",
    );
  assert.equal(
    await fileHash(path.join(freeze.source, "machine-freeze.json")),
    freeze.sourceFreezeHash,
    "SOURCE_FREEZE_CHANGED",
  );
  const expected = await replay(freeze.source);
  assert.deepEqual(
    await json(path.join(root, "diagnostic.json")),
    expected,
    "DIAGNOSTIC_REPLAY_CHANGED",
  );
  assert.equal(
    await fs.readFile(path.join(root, "REPORT.md"), "utf8"),
    render(expected),
  );
  return {
    root,
    integrity: "passed",
    targets: expected.targets.map((t) => ({
      source: t.sourceId,
      flags: t.flags,
    })),
    newInference: 0,
    subtitleMutations: 0,
    qualityStatus: "needs-review",
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [mode, a, b] = process.argv.slice(2);
  const result =
    mode === "create" && a && b
      ? await createAssociationAudit(a, b)
      : mode === "verify" && a && !b
        ? await verifyAssociationAudit(a)
        : null;
  assert(
    result,
    "Usage: create FROZEN_COMPARISON OUTPUT_PARENT | verify AUDIT_ROOT",
  );
  console.log(JSON.stringify(result, null, 2));
}
