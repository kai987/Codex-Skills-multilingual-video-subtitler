import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { evaluateCorrection } from "../scripts/lib/correction-evaluation.mjs";
import { hash, json } from "../scripts/lib/content-review-plan.mjs";

const record = (recordId, text, sourceStart, sourceEnd) => ({
  recordId,
  text,
  sourceStart,
  sourceEnd,
});
const ass = (texts = ["Hello", "World", "Echo", "Echo"]) =>
  "[Script Info]\nScriptType: v4.00+\n[Events]\n" +
  "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n" +
  texts
    .map(
      (text, index) =>
        `Dialogue: 0,0:00:0${index * 2 + 1}.00,0:00:0${index * 2 + 2}.00,Default,,0,0,0,,${text}\n`,
    )
    .join("");

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "correction-evaluation-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const run = path.join(root, "run");
  await fs.mkdir(run);
  const referencePath = path.join(root, "synthetic-reference.ass");
  await fs.writeFile(referencePath, options.reference ?? ass());
  const baseline = options.baseline ?? [
    record("b1", "Hello", 1.1, 2.1),
    record("b2", "Wrong", 3, 4),
    record("b3", "Echo", 5, 6),
    record("b4", "Echo", 7, 8),
  ];
  const candidate = options.candidate ?? [
    baseline[0],
    record("c2", "World", 3.1, 4.2),
    baseline[2],
    baseline[3],
  ];
  const targets = options.targets ?? [
    {
      id: "correction",
      start: 3,
      end: 4.5,
      baselineIds: ["b2"],
      reason: "synthetic-text-risk",
    },
    {
      id: "whole-overlap",
      start: 1.5,
      end: 1.75,
      baselineIds: ["b1"],
      reason: "synthetic-timing-risk",
    },
    {
      id: "repeat",
      start: 5,
      end: 6,
      baselineIds: ["b3"],
      reason: "synthetic-repeat",
    },
  ];
  for (const [name, data] of [
    [
      "manifest.json",
      {
        version: "synthetic-correction-v1",
        referenceReadDuringGeneration: false,
      },
    ],
    ["baseline-records.json", baseline],
    ["candidate-records.json", candidate],
    ["plan.json", { targets }],
    ["evidence.json", { evidence: "synthetic-neutral" }],
  ])
    await fs.writeFile(path.join(run, name), json(data));
  const freeze = {
    files: await Promise.all(
      [
        "manifest.json",
        "baseline-records.json",
        "candidate-records.json",
        "plan.json",
        "evidence.json",
      ].map(async (relative) => ({
        path: relative,
        sha256: hash(await fs.readFile(path.join(run, relative))),
      })),
    ),
  };
  await fs.writeFile(path.join(run, "decision-freeze.json"), json(freeze));
  return { root, run, referencePath, freeze };
}
const readJson = async (file) => JSON.parse(await fs.readFile(file, "utf8"));

test("evaluation compares frozen before/after without mutating decision or human files", async (t) => {
  const f = await fixture(t);
  const inputPaths = [
    f.referencePath,
    path.join(f.run, "decision-freeze.json"),
    ...f.freeze.files.map((entry) => path.join(f.run, entry.path)),
  ];
  const before = await Promise.all(
    inputPaths.map(async (file) => hash(await fs.readFile(file))),
  );
  const summary = await evaluateCorrection(f.run, f.referencePath);
  assert.equal(summary.status, "REFERENCE_DIAGNOSTICS_READY");
  assert.equal(summary.evaluationRole, "development-targeted-posthoc");
  assert.equal(summary.heldOut, false);
  assert.equal(summary.acousticCorrectness, "NOT_VERIFIED");
  assert.equal(summary.CER, "NOT_MEASURED");
  assert.equal(summary.timingAccuracy, "NOT_MEASURED");
  assert.equal(summary.qualityStatus, "needs-review");
  assert.equal(summary.referenceIsValidatedGold, false);
  assert.equal(summary.machineOnlyReleaseAuthorized, false);
  assert.equal(summary.referenceValuesWrittenToDecisionFiles, 0);
  assert.equal(summary.decisionFilesReverifiedAfterEvaluation, true);
  assert.equal(summary.referenceBodyReadAfterDecisionFreeze, true);
  assert.equal(summary.verifiedDecisionFileCount, 5);
  assert.equal(
    summary.comparisons.find((row) => row.side === "candidate").distance,
    0,
  );
  assert.ok(
    summary.comparisons.find((row) => row.side === "baseline").distance > 0,
  );
  assert.deepEqual(
    await Promise.all(
      inputPaths.map(async (file) => hash(await fs.readFile(file))),
    ),
    before,
  );
  assert.deepEqual(
    await readJson(path.join(f.run, "evaluation/summary.json")),
    summary,
  );
  assert.equal(JSON.stringify(summary).includes(f.root), false);
});

test("target diagnostics retain whole overlapping cues and only unique exact text timing", async (t) => {
  const f = await fixture(t);
  await evaluateCorrection(f.run, f.referencePath);
  const rows = await readJson(
    path.join(f.run, "evaluation/per-target-diagnostics.json"),
  );
  const changed = rows.find((row) => row.target.id === "correction");
  assert.equal(changed.machine.baseline.timing[0].status, "NOT_ALIGNED");
  assert.equal(changed.machine.baseline.timing[0].referenceSpan, null);
  const exact = changed.machine.candidate.timing[0];
  assert.equal(exact.status, "EXACT_TEXT_MATCHED_TIMING_DIAGNOSTIC");
  assert.deepEqual(exact.referenceSpan, { start: 3, end: 4 });
  assert.deepEqual(exact.machineSpan, { start: 3.1, end: 4.2 });
  assert.ok(Math.abs(exact.startDeltaSeconds - 0.1) < 1e-12);
  assert.equal(exact.acousticAlignmentVerified, false);
  const partial = rows.find((row) => row.target.id === "whole-overlap");
  assert.equal(partial.reference[0].visibleText, "Hello");
  assert.equal(partial.machine.baseline.records[0].text, "Hello");
  assert.equal(partial.machine.baseline.comparisons[0].N, 5);
  assert.equal(partial.textLocalized, false);
  assert.equal(partial.crossTargetDoubleCountingPossible, true);
  const repeat = rows.find((row) => row.target.id === "repeat");
  assert.equal(repeat.machine.candidate.timing[0].status, "NOT_ALIGNED");
  assert.equal(
    repeat.machine.candidate.timing[0].reason,
    "NON_UNIQUE_EXACT_TEXT",
  );
  assert.equal(repeat.machine.candidate.timing[0].startDeltaSeconds, null);
});

test("exact visible and whitespace-only comparisons do not normalize punctuation or kana", async (t) => {
  const f = await fixture(t, {
    reference: ass(["{\\i1}あ\\Nい！"]),
    baseline: [record("b", "あい！", 1, 2)],
    candidate: [record("c", "あ\nい!", 1, 2)],
    targets: [
      { id: "x", start: 1, end: 2, baselineIds: ["b"], reason: "synthetic" },
    ],
  });
  const s = await evaluateCorrection(f.run, f.referencePath);
  const find = (side, policy) =>
    s.comparisons.find((row) => row.side === side && row.policy === policy);
  assert.equal(find("baseline", "exact-visible-v1").distance, 1);
  assert.equal(find("baseline", "whitespace-only-v1").distance, 0);
  assert.equal(find("candidate", "whitespace-only-v1").distance, 1);
  const rows = await readJson(
    path.join(f.run, "evaluation/per-target-diagnostics.json"),
  );
  assert.equal(rows[0].machine.baseline.timing[0].status, "NOT_ALIGNED");
});

test("any frozen evidence mutation fails before opening reference", async (t) => {
  const f = await fixture(t);
  await fs.appendFile(path.join(f.run, "evidence.json"), " ");
  await assert.rejects(
    evaluateCorrection(f.run, path.join(f.root, "missing-reference.ass")),
    /FROZEN_FILE_HASH_MISMATCH:evidence.json/,
  );
  await assert.rejects(fs.access(path.join(f.run, "evaluation")), {
    code: "ENOENT",
  });
});

test("all mandatory files must be frozen, and duplicate entries fail closed", async (t) => {
  for (const kind of ["missing", "duplicate"]) {
    const f = await fixture(t);
    if (kind === "missing")
      f.freeze.files = f.freeze.files.filter(
        (entry) => entry.path !== "manifest.json",
      );
    else f.freeze.files.push(f.freeze.files[0]);
    await fs.writeFile(
      path.join(f.run, "decision-freeze.json"),
      json(f.freeze),
    );
    await assert.rejects(
      evaluateCorrection(f.run, f.referencePath),
      kind === "missing" ? /UNFROZEN_REQUIRED_FILE/ : /INVALID_FROZEN_FILE_SET/,
    );
  }
});

test("freeze rejects absolute, traversal, Windows, and ambiguous relative paths", async (t) => {
  for (const relative of [
    "../outside",
    "/etc/hosts",
    "folder/../evidence.json",
    "./evidence.json",
    "C:/outside",
    "folder\\outside",
    "folder//outside",
    "evaluation/result.json",
  ]) {
    const f = await fixture(t);
    f.freeze.files.push({ path: relative, sha256: hash("unused") });
    await fs.writeFile(
      path.join(f.run, "decision-freeze.json"),
      json(f.freeze),
    );
    await assert.rejects(
      evaluateCorrection(f.run, f.referencePath),
      /UNSAFE_FROZEN_PATH|INVALID_FROZEN_FILE_SET/,
    );
  }
});

test("both file and intermediate directory symlinks fail even for hash-matched data", async (t) => {
  for (const directory of [false, true]) {
    const f = await fixture(t);
    const outside = path.join(f.root, "outside");
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, "evidence.json"), "neutral");
    const relative = directory ? "link/evidence.json" : "link.json";
    await fs.symlink(
      directory ? outside : path.join(outside, "evidence.json"),
      path.join(f.run, directory ? "link" : "link.json"),
    );
    f.freeze.files.push({ path: relative, sha256: hash("neutral") });
    await fs.writeFile(
      path.join(f.run, "decision-freeze.json"),
      json(f.freeze),
    );
    await assert.rejects(
      evaluateCorrection(f.run, f.referencePath),
      /FROZEN_SYMLINK_FORBIDDEN/,
    );
  }
});

test("invalid machine timing and unknown target baseline IDs fail before reference", async (t) => {
  const badRecord = await fixture(t, {
    baseline: [record("b", "text", 1, 1)],
    candidate: [],
    targets: [],
  });
  await assert.rejects(
    evaluateCorrection(badRecord.run, "missing.ass"),
    /INVALID_CORRECTION_RECORD/,
  );
  const badTarget = await fixture(t, {
    targets: [
      {
        id: "x",
        start: 1,
        end: 2,
        baselineIds: ["absent"],
        reason: "synthetic",
      },
    ],
  });
  await assert.rejects(
    evaluateCorrection(badTarget.run, "missing.ass"),
    /INVALID_CORRECTION_TARGET/,
  );
});

test("evaluation is exclusive and never overwrites previous reference comparison", async (t) => {
  const f = await fixture(t);
  await evaluateCorrection(f.run, f.referencePath);
  const summary = await fs.readFile(
    path.join(f.run, "evaluation/summary.json"),
  );
  await assert.rejects(
    evaluateCorrection(f.run, path.join(f.root, "missing.ass")),
    { code: "EEXIST" },
  );
  assert.deepEqual(
    await fs.readFile(path.join(f.run, "evaluation/summary.json")),
    summary,
  );
});

test("reference cannot silently mutate baseline or freeze during evaluation", async (t) => {
  for (const target of ["baseline-records.json", "decision-freeze.json"]) {
    const f = await fixture(t);
    const original = fs.readFile;
    fs.readFile = async (file, ...args) => {
      const bytes = await original(file, ...args);
      if (file === f.referencePath)
        await fs.appendFile(path.join(f.run, target), " ");
      return bytes;
    };
    try {
      await assert.rejects(
        evaluateCorrection(f.run, f.referencePath),
        /FROZEN_FILE_HASH_MISMATCH|POST_REFERENCE_DECISION_FREEZE_MUTATION/,
      );
    } finally {
      fs.readFile = original;
    }
    await assert.rejects(
      fs.access(path.join(f.run, "evaluation/summary.json")),
      { code: "ENOENT" },
    );
  }
});

test("empty or uncertain ASS is not presented as a successful quality measurement", async (t) => {
  const empty = await fixture(t, { reference: "[Events]\n" });
  await assert.rejects(
    evaluateCorrection(empty.run, empty.referencePath),
    /NO_REFERENCE_DIALOGUE/,
  );
  const uncertain = await fixture(t, { reference: ass(["{\\unknown1}Hello"]) });
  const s = await evaluateCorrection(uncertain.run, uncertain.referencePath);
  assert.equal(s.status, "REFERENCE_DIAGNOSTICS_PARTIAL");
  assert.ok(s.comparisons.every((row) => row.status === "NOT_COMPUTABLE"));
  const rows = await readJson(
    path.join(uncertain.run, "evaluation/per-target-diagnostics.json"),
  );
  assert.ok(
    rows.every((row) =>
      row.machine.candidate.timing.every(
        (item) => item.status === "NOT_ALIGNED",
      ),
    ),
  );
});

test("comparison cell bound reports unavailable instead of allocating an unbounded edit matrix", async (t) => {
  const text = "あ".repeat(6000);
  const f = await fixture(t, {
    reference: ass([text]),
    baseline: [record("b", text, 1, 2)],
    candidate: [record("c", text, 1, 2)],
    targets: [],
  });
  const summary = await evaluateCorrection(f.run, f.referencePath);
  assert.equal(summary.status, "REFERENCE_DIAGNOSTICS_PARTIAL");
  assert.ok(summary.comparisons.every((row) => row.reason === "DP_CELL_LIMIT"));
  assert.ok(summary.comparisons.every((row) => row.distance === null));
});
