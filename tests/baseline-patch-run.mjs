import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  prepareBaselinePatch,
  loadBaselinePatch,
  previewBaselinePatch,
  validatePatchActions,
  applyBaselinePatch,
  restoreBaselinePatch,
} from "../scripts/lib/baseline-patch-run.mjs";
import { evaluateBaselinePatch } from "../scripts/evaluate-baseline-patch.mjs";
import { identity } from "../scripts/lib/content-review-plan.mjs";
import { inventory } from "../scripts/lib/local-asr-run.mjs";
import {
  actionSnapshotHash,
  readActionSnapshot,
} from "../scripts/lib/review-action-store.mjs";
import { readRecoverySource } from "../packages/video-subtitler/dist/standalone/recovery.js";
import { formats } from "../packages/video-subtitler/dist/standalone/bounded.js";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import {
  baselinePatchFixture,
  json,
  writeJson,
  invalidText,
  controlText,
  donorTexts,
} from "./helpers/baseline-patch-fixture.mjs";

const unchangedSources = async (f) => {
  assert.deepEqual(await inventory(f.baselineTask), f.originals);
  assert.deepEqual(await inventory(f.evidenceRoot), f.diagnostic);
};
const absent = async (file) =>
  assert.rejects(fs.stat(file), { code: "ENOENT" });
const actionsFor = (w, action = "ACCEPT_PATCH") => ({
  version: "baseline-patch-actions-v1",
  workspaceHash: identity(w),
  reviewVersion: 1,
  actions: w.proposals.map((p) => ({
    patchId: p.patchId,
    evidenceHash: p.evidenceHash,
    action,
    acknowledgedUncertainties: true,
    reason: "Synthetic explicit action fixture; not a human quality claim.",
  })),
});
const ready = async (t) => {
  const f = await baselinePatchFixture(t);
  const prepared = await prepareBaselinePatch(f.config);
  const w = await loadBaselinePatch(prepared.root);
  assert.equal(prepared.proposals, 1);
  assert.equal(prepared.abstentions, 1);
  return { ...f, root: prepared.root, prepared, w };
};

test("offline prepare preserves all original records, invalid cues and normal controls", async (t) => {
  const f = await ready(t);
  const source = await readRecoverySource(f.baselineTask);
  assert.deepEqual(f.w.baseline, source.analysis.records);
  assert.equal(f.prepared.baselineRecords, 15);
  assert.equal(f.w.newInferenceRequests, 0);
  assert.equal(f.w.modelLoads, 0);
  assert.equal(f.w.referenceUsed, false);
  assert.equal(f.w.finalizationMethod, "none");
  assert.equal(f.w.machineOnlyReleaseAuthorized, false);
  assert.equal(f.w.qualityStatus, "needs-review");
  assert.equal(
    f.w.baseline.find((r) => r.text === invalidText).sourceStart,
    70,
  );
  assert.deepEqual(f.w.baseline.find((r) => r.text === invalidText).issues, [
    "ZERO_DURATION",
  ]);
  const normal = f.w.decisions.find((d) => d.windowId === "normal");
  assert.equal(normal.status, "ABSTAIN");
  assert.deepEqual(normal.reasons, ["NO_EXTREME_MACHINE_REPETITION"]);
  assert.equal(f.w.audio.length, 1);
  assert.equal(f.w.audio[0].windowId, "loop");
  assert.equal(
    await fileHash(path.join(f.root, f.w.audio[0].path)),
    f.w.audio[0].sha256,
  );
  const saved = await json(path.join(f.root, "actions.json"));
  assert.deepEqual(saved.actions, []);
  assert.deepEqual(
    await readActionSnapshot(f.root, actionSnapshotHash(saved)),
    saved,
  );
  await unchangedSources(f);
});

test("preview predicts a whole-baseline copy without accepting or silently exporting partials", async (t) => {
  const f = await ready(t);
  const actionsBefore = await fs.readFile(path.join(f.root, "actions.json"));
  const historyBefore = await inventory(path.join(f.root, "action-history"));
  const preview = await previewBaselinePatch(f.root);
  assert.equal(preview.role, "preview");
  assert.equal(preview.baseline.recordCount, 15);
  assert.equal(preview.candidate.recordCount, 9);
  assert.equal(preview.candidate.unresolvedCount, 1);
  assert.deepEqual(preview.candidate.files, []);
  assert.deepEqual(preview.baseline.files, []);
  assert.deepEqual(preview.candidate.exportedRecordIds, []);
  const candidate = await json(
    path.join(preview.output, "candidate-records.json"),
  );
  const targets = new Set(f.w.proposals[0].targetRecordIds);
  assert.equal(targets.size, 8);
  const protectedRecords = f.w.baseline.filter((r) => !targets.has(r.recordId));
  assert.deepEqual(
    candidate.filter((r) =>
      protectedRecords.some((b) => b.recordId === r.recordId),
    ),
    protectedRecords,
  );
  assert.deepEqual(
    candidate.filter((r) => donorTexts.includes(r.text)).map((r) => r.text),
    donorTexts,
  );
  assert.equal(candidate.find((r) => r.text === controlText).sourceStart, 41);
  assert.equal(candidate.find((r) => r.text === invalidText).sourceEnd, 70);
  assert.ok(
    (
      await fs.readFile(path.join(preview.output, "candidate.full.txt"), "utf8")
    ).includes(invalidText),
  );
  assert.equal(
    (await fs.readdir(preview.output)).some((p) => /\.(ass|srt|vtt)$/u.test(p)),
    false,
  );
  const summary = await json(path.join(preview.output, "patch-export.json"));
  assert.equal(summary.actionsHash, null);
  assert.equal(summary.sourceMutations, 0);
  assert.equal(summary.newInferenceRequests, 0);
  assert.equal(summary.referenceUsed, false);
  assert.equal(summary.humanValidated, false);
  assert.equal(summary.machineOnlyReleaseAuthorized, false);
  assert.equal(summary.finalizationMethod, "none");
  assert.equal(summary.originalAccounting.length, 15);
  assert.equal(
    summary.originalAccounting.filter((r) => r.disposition === "preserved")
      .length,
    7,
  );
  assert.deepEqual(
    await fs.readFile(path.join(f.root, "actions.json")),
    actionsBefore,
  );
  assert.deepEqual(
    await inventory(path.join(f.root, "action-history")),
    historyBefore,
  );
  await unchangedSources(f);
});

test("explicit partial export accounts for invalid records and round-trips all three formats", async (t) => {
  const f = await ready(t);
  const out = await previewBaselinePatch(f.root, { exportPartial: true });
  const candidate = await json(path.join(out.output, "candidate-records.json"));
  const invalid = candidate.find((r) => r.text === invalidText);
  assert.deepEqual(out.candidate.omittedRecordIds, [invalid.recordId]);
  assert.equal(out.candidate.partial, true);
  assert.equal(out.candidate.files.length, 3);
  assert.equal(out.baseline.files.length, 3);
  const expected = candidate.filter((r) => !r.issues.length);
  for (const file of out.candidate.files) {
    assert.match(file, /^candidate\.partial\.needs-review\.(ass|srt|vtt)$/u);
    const ext = path.extname(file).slice(1);
    const parsed = formats[ext].parse(
      await fs.readFile(path.join(out.output, file), "utf8"),
    );
    assert.deepEqual(
      parsed.map((r) => [r.start, r.end, r.text]),
      expected.map((r) => [r.sourceStart, r.sourceEnd, r.text]),
    );
    assert.equal(
      parsed.some((r) => r.text === invalidText),
      false,
    );
    assert.equal(
      parsed.some((r) => r.text === controlText),
      true,
    );
  }
  assert.deepEqual((await json(path.join(f.root, "actions.json"))).actions, []);
  await unchangedSources(f);
});

test("repeated previews have byte-identical frozen output and do not change the action ledger", async (t) => {
  const f = await ready(t);
  const ledger = await inventory(path.join(f.root, "action-history"));
  const first = await previewBaselinePatch(f.root, { exportPartial: true });
  const second = await previewBaselinePatch(f.root, { exportPartial: true });
  assert.notEqual(first.output, second.output);
  assert.deepEqual(
    await inventory(first.output),
    await inventory(second.output),
  );
  assert.deepEqual(
    await inventory(path.join(f.root, "action-history")),
    ledger,
  );
  await unchangedSources(f);
});

test("explicit actions reject stale or unacknowledged input and undo restores the existing ledger snapshot", async (t) => {
  const f = await ready(t);
  const empty = await json(path.join(f.root, "actions.json"));
  const emptyHash = actionSnapshotHash(empty);
  assert.equal(emptyHash, identity(empty));
  const template = await json(
    path.join(f.root, "accept-actions.template.json"),
  );
  const before = await inventory(f.root);
  await assert.rejects(
    applyBaselinePatch(f.root, template),
    /EXPLICIT_UNCERTAINTY/u,
  );
  const accept = actionsFor(f.w);
  assert.throws(
    () =>
      validatePatchActions(f.w, { ...accept, workspaceHash: "0".repeat(64) }),
    /STALE_WORKSPACE/u,
  );
  assert.throws(
    () =>
      validatePatchActions(f.w, {
        ...accept,
        actions: [accept.actions[0], accept.actions[0]],
      }),
    /STALE_OR_DUPLICATE_PATCH/u,
  );
  assert.throws(
    () =>
      validatePatchActions(f.w, {
        ...accept,
        actions: [{ ...accept.actions[0], evidenceHash: "0".repeat(64) }],
      }),
    /STALE_OR_DUPLICATE_PATCH/u,
  );
  assert.throws(() =>
    validatePatchActions(f.w, {
      ...accept,
      actions: [{ ...accept.actions[0], reason: "" }],
    }),
  );
  assert.deepEqual(await inventory(f.root), before);
  const applied = await applyBaselinePatch(f.root, accept, {
    exportPartial: true,
  });
  assert.equal(applied.role, "reviewed-copy");
  assert.equal(applied.candidate.recordCount, 9);
  assert.deepEqual(await json(path.join(f.root, "actions.json")), accept);
  const appliedBefore = await inventory(applied.output);
  assert.deepEqual(await readActionSnapshot(f.root, emptyHash), empty);
  assert.deepEqual(
    await readActionSnapshot(f.root, actionSnapshotHash(accept)),
    accept,
  );
  const summary = await json(path.join(applied.output, "patch-export.json"));
  assert.equal(summary.actionsHash, actionSnapshotHash(accept));
  assert.equal(summary.humanValidated, false);
  assert.equal(summary.qualityStatus, "needs-review");
  const undo = await restoreBaselinePatch(f.root, emptyHash, {
    exportPartial: true,
  });
  assert.deepEqual(undo.selectedPatchIds, []);
  assert.deepEqual(
    await json(path.join(undo.output, "candidate-records.json")),
    f.w.baseline,
  );
  assert.deepEqual(await json(path.join(f.root, "actions.json")), empty);
  assert.deepEqual(await inventory(applied.output), appliedBefore);
  const keep = await applyBaselinePatch(
    f.root,
    actionsFor(f.w, "KEEP_ORIGINAL"),
  );
  assert.deepEqual(
    await json(path.join(keep.output, "candidate-records.json")),
    f.w.baseline,
  );
  await unchangedSources(f);
});

test("prepare rejects mismatched hashes and unknown config keys before creating output", async (t) => {
  const f = await baselinePatchFixture(t);
  for (const key of [
    "baselineManifestHash",
    "baselineRawHash",
    "evidenceFreezeHash",
  ]) {
    await assert.rejects(
      prepareBaselinePatch({ ...f.config, [key]: "0".repeat(64) }),
      /IDENTITY_MISMATCH|FREEZE_MISMATCH/u,
    );
    await absent(f.config.outputRoot);
  }
  await assert.rejects(
    prepareBaselinePatch({ ...f.config, reference: "/unused/not-read.ass" }),
  );
  await absent(f.config.outputRoot);
  await unchangedSources(f);
});

test("tampered original raw, frozen donor files and workspace are rejected", async (t) => {
  const f = await baselinePatchFixture(t);
  const rawPath = path.join(f.baselineTask, "raw-primary.srt");
  await fs.appendFile(rawPath, "tamper\n");
  await assert.rejects(prepareBaselinePatch(f.config), /rawHash/u);
  await absent(f.config.outputRoot);
  await fs.writeFile(rawPath, f.raw);
  const mappedPath = path.join(f.donorTasks[0], "mapped-records.json");
  const mappedBefore = await fs.readFile(mappedPath);
  await fs.appendFile(mappedPath, "\n");
  await assert.rejects(prepareBaselinePatch(f.config), /FROZEN_FILE_CHANGED/u);
  await absent(f.config.outputRoot);
  await fs.writeFile(mappedPath, mappedBefore);
  const prepared = await prepareBaselinePatch(f.config);
  await fs.appendFile(path.join(prepared.root, "workspace.json"), "\n");
  await assert.rejects(
    loadBaselinePatch(prepared.root),
    /FROZEN_FILE_CHANGED/u,
  );
  await assert.rejects(
    previewBaselinePatch(prepared.root),
    /FROZEN_FILE_CHANGED/u,
  );
  await absent(path.join(prepared.root, "exports"));
  await unchangedSources(f);
});

test("source roots and nested destinations are rejected without source mutation", async (t) => {
  const f = await baselinePatchFixture(t);
  for (const outputRoot of [
    f.baselineTask,
    path.join(f.baselineTask, "nested"),
    f.evidenceRoot,
    path.join(f.evidenceRoot, "nested"),
    f.donorTasks[0],
  ])
    await assert.rejects(
      prepareBaselinePatch({ ...f.config, outputRoot }),
      /SEPARATE_OUTPUT_REQUIRED/u,
    );
  await unchangedSources(f);
});

test("exports symlink is rejected without writing outside the patch workspace", async (t) => {
  const f = await ready(t);
  const external = path.join(f.temporary, "external-export");
  await fs.mkdir(external);
  await fs.symlink(external, path.join(f.root, "exports"));
  await assert.rejects(
    previewBaselinePatch(f.root, { exportPartial: true }),
    /symlink|符号链接/iu,
  );
  assert.deepEqual(await fs.readdir(external), []);
  await unchangedSources(f);
});

test("evaluation validates the export freeze before any missing reference read", async (t) => {
  const f = await ready(t);
  const out = await previewBaselinePatch(f.root);
  const freezePath = path.join(out.output, "machine-freeze.json");
  const freeze = await fs.readFile(freezePath);
  await writeJson(freezePath, { version: "invalid", files: [] });
  const missingReference = path.join(f.temporary, "missing-reference.ass");
  await assert.rejects(
    evaluateBaselinePatch(f.root, out.output, missingReference),
    /EXPORT_FREEZE_MISMATCH/u,
  );
  await fs.writeFile(freezePath, freeze);
  await fs.appendFile(path.join(out.output, "candidate-records.json"), "\n");
  await assert.rejects(
    evaluateBaselinePatch(f.root, out.output, missingReference),
    /FROZEN_FILE_CHANGED/u,
  );
  await absent(path.join(out.output, "evaluation"));
  await unchangedSources(f);
});

test("evaluation rejects missing subtitle bytes even if their freeze entries were removed", async (t) => {
  const f = await ready(t);
  for (const removeAll of [false, true]) {
    const out = await previewBaselinePatch(f.root, { exportPartial: true });
    const allFiles = [...out.baseline.files, ...out.candidate.files];
    const removed = new Set(removeAll ? allFiles : allFiles.slice(0, 1));
    for (const file of removed) await fs.unlink(path.join(out.output, file));
    const freezePath = path.join(out.output, "machine-freeze.json");
    const freeze = await json(freezePath);
    await writeJson(freezePath, {
      ...freeze,
      files: freeze.files.filter((f) => !removed.has(f.path)),
    });
    await assert.rejects(
      evaluateBaselinePatch(
        f.root,
        out.output,
        path.join(f.temporary, "missing-reference.ass"),
      ),
      /UNFROZEN_DECLARED_SUBTITLE/u,
    );
    await absent(path.join(out.output, "evaluation"));
  }
  await unchangedSources(f);
});

test("unplaceable original text stays preserved and blocks whole-source evaluation before reference read", async (t) => {
  const f = await baselinePatchFixture(t, { outsideSource: true });
  const prepared = await prepareBaselinePatch(f.config);
  const out = await previewBaselinePatch(prepared.root, {
    exportPartial: true,
  });
  const candidate = await json(path.join(out.output, "candidate-records.json"));
  assert.equal(candidate.at(-1).text, "源の範囲外でも原文は残します");
  assert.equal(candidate.at(-1).sourceStart, 90);
  assert.equal(out.candidate.unresolvedCount, 2);
  await assert.rejects(
    evaluateBaselinePatch(
      prepared.root,
      out.output,
      path.join(f.temporary, "missing-reference.ass"),
    ),
    /FULL_TEXT_EVALUATION_REQUIRES_SOURCE_PLACEABLE_RECORDS/u,
  );
  await absent(path.join(out.output, "evaluation"));
  await unchangedSources(f);
});

test("post-freeze synthetic reference evaluation compares full text and fixed windows without overwriting", async (t) => {
  const f = await ready(t);
  const out = await previewBaselinePatch(f.root, { exportPartial: true });
  const machineBefore = await inventory(out.output);
  const actionsBefore = await fs.readFile(path.join(f.root, "actions.json"));
  const reference = path.join(f.temporary, "synthetic-reference.ass");
  await fs.writeFile(
    reference,
    [
      "[Events]",
      "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
      `Dialogue: 0,0:00:20.00,0:00:22.50,Dialogue,,0,0,0,,${donorTexts[0]}\\N仅用于测试的译文`,
      `Dialogue: 0,0:00:22.50,0:00:25.00,Dialogue,,0,0,0,,${donorTexts[1]}`,
      `Dialogue: 0,0:00:41.00,0:00:43.00,Dialogue,,0,0,0,,${controlText}`,
      `Dialogue: 0,0:01:09.00,0:01:11.00,Dialogue,,0,0,0,,${invalidText}`,
      "",
    ].join("\n"),
  );
  const result = await evaluateBaselinePatch(f.root, out.output, reference);
  const report = await json(
    path.join(result.output, "reference-comparison.json"),
  );
  assert.equal(report.referenceUsedForGeneration, false);
  assert.equal(report.humanListeningPerformed, false);
  assert.equal(report.machineOnlyReleaseAuthorized, false);
  assert.equal(report.fullTextComparisonIncludesUnresolvedRecords, true);
  assert.equal(report.originalUnresolved, 1);
  assert.equal(report.candidateUnresolved, 1);
  assert.equal(report.protectedRecordCount, 7);
  assert.equal(report.protectedRecordsUnchanged, true);
  assert.equal(report.qualityStatus, "needs-review");
  assert.ok(report.exportedSubsetComparison);
  assert.deepEqual(
    report.comparison.perWindow.map((r) => r.window),
    [
      { id: "whole-episode", kind: "full-source-text", start: 0, end: 80 },
      ...f.w.decisions.map((d) => ({
        id: d.windowId,
        kind: "frozen-machine-window",
        ...d.window,
      })),
    ],
  );
  for (const row of report.comparison.perWindow)
    assert.equal(row.baseline.edit.N, row.candidate.edit.N);
  for (const side of ["baseline", "candidate"])
    assert.equal(
      report.comparison.perWindow[0][side].edit.hypothesisCharacters,
      report.exportedSubsetComparison[side].edit.hypothesisCharacters +
        Array.from(invalidText).length,
    );
  assert.equal(
    JSON.stringify(report.comparison.perWindow[0].reference).includes(
      "仅用于测试的译文",
    ),
    false,
  );
  const evaluationBefore = await inventory(result.output);
  await assert.rejects(
    evaluateBaselinePatch(f.root, out.output, reference),
    /EVALUATION_ALREADY_EXISTS/u,
  );
  assert.deepEqual(await inventory(result.output), evaluationBefore);
  assert.deepEqual(
    (await inventory(out.output)).filter(
      (r) => !r.path.startsWith("evaluation/"),
    ),
    machineBefore,
  );
  assert.deepEqual(
    await fs.readFile(path.join(f.root, "actions.json")),
    actionsBefore,
  );
  await unchangedSources(f);
});
