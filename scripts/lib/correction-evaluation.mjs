/** Post-decision diagnostics only. Generation must not import this module. */
import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { hash, identity, json } from "./content-review-plan.mjs";
import {
  parseReference,
  textStream,
  compareStreams,
  textRules,
  referenceFlags,
} from "./historical-reference-text.mjs";

const requiredFiles = [
  "manifest.json",
  "baseline-records.json",
  "candidate-records.json",
  "plan.json",
];
const policies = ["exact-visible-v1", "whitespace-only-v1"];
const gates = Object.freeze({
  evaluationRole: "development-targeted-posthoc",
  heldOut: false,
  postHoc: true,
  acousticCorrectness: "NOT_VERIFIED",
  CER: "NOT_MEASURED",
  timingAccuracy: "NOT_MEASURED",
  qualityStatus: "needs-review",
  finalizationMethod: "none",
  humanValidated: false,
  machineOnlyReleaseAuthorized: false,
  productDefaultChanged: false,
});

function relativeParts(relative) {
  if (
    typeof relative !== "string" ||
    !relative ||
    relative.includes("\\") ||
    relative.includes("\0") ||
    path.posix.isAbsolute(relative) ||
    /^[a-z]:/iu.test(relative) ||
    relative.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw Error("UNSAFE_FROZEN_PATH");
  return relative.split("/");
}

// Check every component, not only the final filename: a directory symlink can
// otherwise escape the run while keeping a superficially relative file entry.
async function readRegular(root, relative) {
  const parts = relativeParts(relative);
  let current = root;
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink()) throw Error("FROZEN_SYMLINK_FORBIDDEN");
    if (index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())
      throw Error("FROZEN_ENTRY_NOT_REGULAR");
  }
  const handle = await fs.open(
    current,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    if (!(await handle.stat()).isFile())
      throw Error("FROZEN_ENTRY_NOT_REGULAR");
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

function parseJson(bytes) {
  return JSON.parse(bytes.toString("utf8"));
}

async function verifyFreeze(root, expectedFreezeHash) {
  const bytes = await readRegular(root, "decision-freeze.json");
  const freezeHash = hash(bytes);
  if (expectedFreezeHash && freezeHash !== expectedFreezeHash)
    throw Error("POST_REFERENCE_DECISION_FREEZE_MUTATION");
  const freeze = parseJson(bytes);
  if (!freeze || !Array.isArray(freeze.files) || !freeze.files.length)
    throw Error("INVALID_DECISION_FREEZE");
  const captured = new Map();
  const names = new Set();
  for (const entry of freeze.files) {
    if (
      !entry ||
      typeof entry.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(entry.sha256)
    )
      throw Error("INVALID_FROZEN_FILE_ENTRY");
    relativeParts(entry.path);
    if (
      names.has(entry.path) ||
      entry.path === "decision-freeze.json" ||
      entry.path === "evaluation" ||
      entry.path.startsWith("evaluation/")
    )
      throw Error("INVALID_FROZEN_FILE_SET");
    names.add(entry.path);
    const content = await readRegular(root, entry.path);
    if (hash(content) !== entry.sha256)
      throw Error("FROZEN_FILE_HASH_MISMATCH:" + entry.path);
    if (requiredFiles.includes(entry.path)) captured.set(entry.path, content);
  }
  for (const required of requiredFiles)
    if (!captured.has(required))
      throw Error("UNFROZEN_REQUIRED_FILE:" + required);
  const manifest = parseJson(captured.get("manifest.json"));
  if (!manifest || Array.isArray(manifest) || typeof manifest !== "object")
    throw Error("INVALID_CORRECTION_MANIFEST");
  return {
    captured,
    freezeHash,
    manifestHash: hash(captured.get("manifest.json")),
    verifiedFileCount: names.size,
  };
}

function recordsFrom(bytes, side) {
  const records = parseJson(bytes);
  if (!Array.isArray(records))
    throw Error("INVALID_CORRECTION_RECORDS:" + side);
  const ids = new Set();
  for (const record of records) {
    if (
      !record ||
      typeof record.recordId !== "string" ||
      !record.recordId ||
      ids.has(record.recordId) ||
      typeof record.text !== "string" ||
      !Number.isFinite(record.sourceStart) ||
      !Number.isFinite(record.sourceEnd) ||
      record.sourceStart < 0 ||
      record.sourceEnd <= record.sourceStart
    )
      throw Error("INVALID_CORRECTION_RECORD:" + side);
    ids.add(record.recordId);
  }
  return records;
}

function targetsFrom(bytes, baseline) {
  const plan = parseJson(bytes);
  if (!plan || !Array.isArray(plan.targets))
    throw Error("INVALID_CORRECTION_PLAN");
  const ids = new Set();
  const baselineIds = new Set(baseline.map((record) => record.recordId));
  for (const target of plan.targets) {
    if (
      !target ||
      typeof target.id !== "string" ||
      !target.id ||
      ids.has(target.id) ||
      !Number.isFinite(target.start) ||
      !Number.isFinite(target.end) ||
      target.start < 0 ||
      target.end <= target.start ||
      typeof target.reason !== "string" ||
      !Array.isArray(target.baselineIds) ||
      new Set(target.baselineIds).size !== target.baselineIds.length ||
      target.baselineIds.some((id) => !baselineIds.has(id))
    )
      throw Error("INVALID_CORRECTION_TARGET");
    ids.add(target.id);
  }
  return plan.targets;
}

function compare(reference, records, side) {
  return policies.map((policy) => {
    const { edits, ...row } = compareStreams(
      textStream(reference, "R"),
      textStream(records, side),
      policy,
    );
    return { side, ...row, editPathHash: identity(edits) };
  });
}

const intersects = (start, end, target) =>
  Number.isFinite(start) &&
  Number.isFinite(end) &&
  end > start &&
  start < target.end &&
  end > target.start;

function textIndex(records, key) {
  const index = new Map();
  for (const record of records) {
    const text = record[key];
    if (typeof text !== "string" || !text.length) continue;
    const entries = index.get(text) ?? [];
    entries.push(record);
    index.set(text, entries);
  }
  return index;
}

function timingDiagnostics(
  records,
  reference,
  target,
  machineIndex,
  referenceIndex,
) {
  const referenceIds = new Set(reference.map((record) => record.refId));
  return records.map((record) => {
    const matches = referenceIndex.get(record.text) ?? [];
    const machineMatches = machineIndex.get(record.text) ?? [];
    const match = matches[0];
    const exactUnique =
      record.text.length > 0 &&
      matches.length === 1 &&
      machineMatches.length === 1 &&
      referenceIds.has(match.refId) &&
      match.parseStatus === "PARSED" &&
      intersects(match.start, match.end, target);
    const base = {
      recordId: record.recordId,
      basis: "whole-record-unique-exact-visible-text",
      acousticAlignmentVerified: false,
      textLocalized: false,
    };
    if (!exactUnique)
      return {
        ...base,
        status: "NOT_ALIGNED",
        reason:
          matches.length > 1 || machineMatches.length > 1
            ? "NON_UNIQUE_EXACT_TEXT"
            : "NO_UNIQUE_VALID_OVERLAPPING_EXACT_TEXT",
        referenceSpan: null,
        machineSpan: null,
        startDeltaSeconds: null,
        endDeltaSeconds: null,
      };
    return {
      ...base,
      status: "EXACT_TEXT_MATCHED_TIMING_DIAGNOSTIC",
      refId: match.refId,
      referenceSpan: { start: match.start, end: match.end },
      machineSpan: { start: record.sourceStart, end: record.sourceEnd },
      startDeltaSeconds: record.sourceStart - match.start,
      endDeltaSeconds: record.sourceEnd - match.end,
    };
  });
}

/** Explicit reference path is read only after all generation files are frozen. */
export async function evaluateCorrection(run, referencePath) {
  if (
    typeof run !== "string" ||
    !run ||
    typeof referencePath !== "string" ||
    !referencePath
  )
    throw Error("EXPLICIT_RUN_AND_REFERENCE_REQUIRED");
  const runPath = path.resolve(run);
  const stat = await fs.lstat(runPath);
  if (stat.isSymbolicLink() || !stat.isDirectory())
    throw Error("INVALID_CORRECTION_RUN");
  const root = await fs.realpath(runPath);
  const frozen = await verifyFreeze(root);
  const baseline = recordsFrom(
    frozen.captured.get("baseline-records.json"),
    "baseline",
  );
  const candidate = recordsFrom(
    frozen.captured.get("candidate-records.json"),
    "candidate",
  );
  const targets = targetsFrom(frozen.captured.get("plan.json"), baseline);
  const evaluationDirectory = path.join(root, "evaluation");
  // No resume or overwrite: an evaluation belongs to exactly one explicit import.
  await fs.mkdir(evaluationDirectory);
  const referenceBytes = await fs.readFile(referencePath);
  const parsed = parseReference(referenceBytes);
  if (!parsed.records.length) throw Error("NO_REFERENCE_DIALOGUE");
  const reference = parsed.records;
  const rows = [
    ...compare(reference, baseline, "baseline"),
    ...compare(reference, candidate, "candidate"),
  ];
  const referenceIndex = textIndex(reference, "visibleText");
  const machineIndexes = {
    baseline: textIndex(baseline, "text"),
    candidate: textIndex(candidate, "text"),
  };
  const perTarget = targets.map((target) => {
    const relevantReference = reference.filter((record) =>
      intersects(record.start, record.end, target),
    );
    const machine = Object.fromEntries(
      Object.entries({ baseline, candidate }).map(([side, records]) => {
        const relevant = records.filter((record) =>
          intersects(record.sourceStart, record.sourceEnd, target),
        );
        return [
          side,
          {
            records: relevant,
            comparisons: compare(relevantReference, relevant, side),
            timing: timingDiagnostics(
              relevant,
              relevantReference,
              target,
              machineIndexes[side],
              referenceIndex,
            ),
          },
        ];
      }),
    );
    return {
      target,
      reference: relevantReference,
      machine,
      association: "half-open-time-overlap-whole-record",
      wholeRecords: true,
      textLocalized: false,
      crossTargetDoubleCountingPossible: true,
      acousticCorrectness: "NOT_VERIFIED",
      perTargetCER: "NOT_MEASURED",
    };
  });
  await verifyFreeze(root, frozen.freezeHash);
  const comparison = {
    comparisonKind: "FROZEN_DELIVERABLE_TO_HISTORICAL_REFERENCE",
    ...gates,
    ...referenceFlags,
    rules: textRules,
    rows,
    limitations: [
      "Development-targeted, post-hoc comparison; no held-out or unbiased quality claim.",
      "Reference completeness and acoustic correctness are not reverified; this is not validated Gold.",
      "Edit distance and S/D/I are text comparison diagnostics, not acoustic CER or error categories.",
      "Per-target comparison includes entire overlapping cues, not clipped or localized dialogue; do not sum target rows.",
      "Timing deltas exist only for globally unique exact whole-record text matches overlapping the target; they are not verified acoustic alignment.",
      "No automatic winner, acceptance threshold, reference-to-decision feedback, or product promotion.",
    ],
  };
  const summary = {
    version: "correction-reference-evaluation-v1",
    status: rows.every((row) => row.status === "COMPUTED")
      ? "REFERENCE_DIAGNOSTICS_READY"
      : "REFERENCE_DIAGNOSTICS_PARTIAL",
    ...gates,
    ...referenceFlags,
    referenceSha256: parsed.audit.sourceHash,
    decisionFreezeSha256: frozen.freezeHash,
    manifestSha256: frozen.manifestHash,
    verifiedDecisionFileCount: frozen.verifiedFileCount,
    decisionFilesReverifiedAfterEvaluation: true,
    referenceBodyReadAfterDecisionFreeze: true,
    referenceValuesWrittenToDecisionFiles: 0,
    baselineCount: baseline.length,
    candidateCount: candidate.length,
    referenceCount: reference.length,
    targetCount: targets.length,
    comparisons: rows,
    timingMatchCounts: Object.fromEntries(
      ["baseline", "candidate"].map((side) => [
        side,
        perTarget.reduce(
          (total, row) =>
            total +
            row.machine[side].timing.filter(
              (item) => item.status === "EXACT_TEXT_MATCHED_TIMING_DIAGNOSTIC",
            ).length,
          0,
        ),
      ]),
    ),
    timingMatchCountsMayRepeatAcrossTargets: true,
    artifacts: [
      "evaluation/reference-comparison.json",
      "evaluation/per-target-diagnostics.json",
      "evaluation/reference-audit.json",
    ],
  };
  for (const [name, value] of [
    ["reference-comparison.json", comparison],
    ["per-target-diagnostics.json", perTarget],
    ["reference-audit.json", parsed.audit],
  ])
    await fs.writeFile(path.join(evaluationDirectory, name), json(value), {
      flag: "wx",
    });
  await verifyFreeze(root, frozen.freezeHash);
  // A failed final hash check cannot leave a summary that claims completion.
  await fs.writeFile(
    path.join(evaluationDirectory, "summary.json"),
    json(summary),
    { flag: "wx" },
  );
  return summary;
}
