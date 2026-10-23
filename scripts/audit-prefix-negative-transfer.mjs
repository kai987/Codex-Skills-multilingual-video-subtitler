/** Zero-inference structural transfer audit; never exports or promotes subtitles. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { recoverBaselinePrefixes } from "./lib/dialogue-prefix-recovery.mjs";
import {
  closeDialogueTarget,
  dialogueText,
} from "./lib/whole-dialogue-recovery.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const code = [
  import.meta.filename,
  ...[
    "dialogue-prefix-recovery",
    "whole-dialogue-recovery",
    "content-safety-gate",
    "seam-refinement",
    "seam-text-only",
  ].map((n) => path.join(import.meta.dirname, "lib", n + ".mjs")),
];

export function selectPrefixControls(baseline) {
  const sorted = [...baseline].sort(
    (a, b) => a.start - b.start || a.id.localeCompare(b.id),
  );
  const targets = new Map();
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i],
      x = dialogueText(a.text);
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j],
        y = dialogueText(b.text);
      if (b.start > a.end + 2) break;
      if (!x || !y || !(x.startsWith(y) || y.startsWith(x))) continue;
      const t = closeDialogueTarget(baseline, {
        id: `pair-${a.id}-${b.id}`,
        start: Math.min(a.start, b.start),
        end: Math.max(a.end, b.end),
      });
      const key = [...t.recordIds].sort().join("|");
      if (!targets.has(key)) targets.set(key, t);
    }
  }
  return [...targets.values()];
}

async function boundFiles(root, name) {
  const f = await json(path.join(root, name));
  assert(Array.isArray(f.files) && f.files.length, "INVALID_FREEZE");
  assert.equal(
    new Set(f.files.map((r) => r.path)).size,
    f.files.length,
    "DUPLICATE_FREEZE_PATH",
  );
  const bindings = [];
  for (const entry of f.files) {
    assert(
      typeof entry.path === "string" &&
        !path.isAbsolute(entry.path) &&
        !entry.path.split(/[\\/]/u).includes(".."),
      "UNSAFE_FREEZE_PATH",
    );
    const file = path.join(root, entry.path);
    assert(
      (await fs.realpath(file)).startsWith(root + path.sep),
      "EXTERNAL_FREEZE_PATH",
    );
    const bytes = await fs.readFile(file);
    assert.equal(
      hash(bytes),
      entry.sha256,
      `INPUT_HASH_MISMATCH:${entry.path}`,
    );
    if (entry.bytes !== undefined) assert.equal(bytes.length, entry.bytes);
    bindings.push({ path: entry.path, sha256: entry.sha256 });
  }
  return bindings;
}

export async function inspectPrefixTransfer(source) {
  const root = await fs.realpath(source);
  const inputBindings = await boundFiles(root, "input-freeze.json");
  const rawBindings = await boundFiles(root, "raw-freeze.json");
  for (const name of ["baseline-records.json", "manifest.json"])
    assert(
      inputBindings.some((b) => b.path === name),
      "MISSING_REQUIRED_BINDING",
    );
  assert(
    rawBindings.some((b) => b.path === "input-freeze.json"),
    "UNBOUND_INPUT_FREEZE",
  );
  const rows = await json(path.join(root, "baseline-records.json"));
  const manifest = await json(path.join(root, "manifest.json"));
  assert(
    /^[a-f0-9]{64}$/u.test(manifest.sourceMediaHash),
    "MISSING_SOURCE_IDENTITY",
  );
  assert(Array.isArray(rows) && rows.length, "EMPTY_BASELINE");
  assert(
    rows.every(
      (r) =>
        typeof r.recordId === "string" &&
        typeof r.text === "string" &&
        Number.isFinite(r.sourceStart) &&
        Number.isFinite(r.sourceEnd) &&
        r.sourceStart >= 0 &&
        r.sourceEnd > r.sourceStart,
    ),
    "INVALID_BASELINE_ROWS",
  );
  const baseline = rows.map((r) => ({
    id: r.recordId,
    start: r.sourceStart,
    end: r.sourceEnd,
    text: r.text,
  }));
  const targets = selectPrefixControls(baseline);
  // Do not disguise different crops from a single model as paired model evidence.
  const result = recoverBaselinePrefixes(baseline, targets, [], rows);
  assert.equal(result.changedTargets, 0, "EVIDENCE_FREE_MUTATION");
  for (const row of baseline)
    assert.deepEqual(
      result.candidate.find((r) => r.id === row.id),
      row,
    );
  return {
    version: "prefix-structural-transfer-audit-v1",
    source: root,
    sourceMediaHash: manifest.sourceMediaHash,
    selection:
      "all exact normalized-prefix pairs within two seconds; whole-record closure; no reference",
    baselineRecords: baseline.length,
    controls: targets.map((t, i) => ({
      ...t,
      records: baseline.filter((r) => t.recordIds.includes(r.id)),
      decision: result.decisions[i],
    })),
    preservedRecords: result.protectedRecords,
    changedTargets: result.changedTargets,
    inferenceRequests: 0,
    modelLoads: 0,
    referenceUsed: false,
    listeningVerified: false,
    structuralPreservation: "passed",
    acousticAcceptance: "not-assessed",
    pairedEvidenceTrials: 0,
    automaticPromotionAllowed: false,
    promotionStatus: "blocked-insufficient-independent-acoustic-coverage",
    limitations: [
      "Historical development corpus, not unseen validation",
      "No real-repeat truth label inferred from ASR text",
      "Structural abstention is not evidence of acoustic repeat discrimination",
      "No positive duplicate-removal case in this corpus audit",
      "Input/raw artifact hashes checked; historical runtime and original source media not re-executed or reauthenticated",
    ],
    bindings: [...inputBindings, ...rawBindings],
  };
}

export async function auditPrefixTransfer(source, output) {
  source = await fs.realpath(source);
  output = path.resolve(output);
  let ancestor = output;
  for (;;) {
    try {
      const actual = await fs.realpath(ancestor);
      const projected = path.resolve(actual, path.relative(ancestor, output));
      assert(
        projected !== source && !projected.startsWith(source + path.sep),
        "OUTPUT_INSIDE_SOURCE",
      );
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      ancestor = path.dirname(ancestor);
    }
  }
  const result = await inspectPrefixTransfer(source);
  await fs.mkdir(output, { recursive: true });
  output = await fs.realpath(output);
  assert(
    output !== source && !output.startsWith(source + path.sep),
    "OUTPUT_INSIDE_SOURCE",
  );
  const root = await fs.mkdtemp(path.join(output, "negative-transfer-"));
  const bytes = JSON.stringify(result, null, 2) + "\n";
  await fs.writeFile(path.join(root, "audit.json"), bytes, { flag: "wx" });
  const freeze = {
    source,
    auditHash: hash(bytes),
    code: await Promise.all(
      code.map(async (file) => ({
        file,
        sha256: hash(await fs.readFile(file)),
      })),
    ),
  };
  await fs.writeFile(
    path.join(root, "freeze.json"),
    JSON.stringify(freeze, null, 2) + "\n",
    { flag: "wx" },
  );
  return { root, ...(await verifyPrefixTransfer(root)) };
}

export async function verifyPrefixTransfer(root) {
  const f = await json(path.join(root, "freeze.json"));
  assert.deepEqual(
    f.code.map((c) => c.file),
    code,
  );
  for (const c of f.code)
    assert.equal(hash(await fs.readFile(c.file)), c.sha256, "CODE_CHANGED");
  const bytes = await fs.readFile(path.join(root, "audit.json"));
  assert.equal(hash(bytes), f.auditHash, "AUDIT_CHANGED");
  const result = await inspectPrefixTransfer(f.source);
  assert.deepEqual(JSON.parse(bytes), result);
  return {
    integrity: "passed",
    controls: result.controls.length,
    preservedRecords: result.preservedRecords,
    inferenceRequests: 0,
    acousticAcceptance: result.acousticAcceptance,
    automaticPromotionAllowed: false,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [mode, a, b, ...rest] = process.argv.slice(2);
  if (mode === "audit" && a && b && !rest.length)
    console.log(JSON.stringify(await auditPrefixTransfer(a, b), null, 2));
  else if (mode === "verify" && a && !b)
    console.log(JSON.stringify(await verifyPrefixTransfer(a), null, 2));
  else throw Error("Usage: audit SOURCE OUTPUT_ROOT | verify AUDIT_DIR");
}
