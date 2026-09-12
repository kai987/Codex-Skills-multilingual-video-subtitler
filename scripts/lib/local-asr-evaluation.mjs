/** Phase 2 only. The generation module has no import of this module. */
import fs from "node:fs/promises";
import path from "node:path";
import { Buffer } from "node:buffer";
import {
  verifyIntegration,
  readJson,
  immutable,
  inventory,
  checkFiles,
  fileHash,
  journal,
  checkJournal,
  exists,
} from "./local-asr-run.mjs";
import { verifyRecovery } from "./bounded-recovery.mjs";
import {
  parseReference,
  textStream,
  compareStreams,
  referenceFlags,
} from "./historical-reference-text.mjs";
import { localize } from "./missing-dialogue-localization.mjs";
import { identity } from "./content-review-plan.mjs";
export const gates = Object.freeze({
  qualityStatus: "needs-review",
  finalizationMethod: "none",
  CER: "NOT_MEASURED",
  humanValidated: false,
  referenceIsValidatedGold: false,
  machineOnlyReleaseAuthorized: false,
  productDefaultChanged: false,
  fullTimedExportAllowed: false,
});
export async function evaluate(run) {
  const { c, input, result } = await verifyIntegration(run);
  if (await exists(path.join(run, "results-freeze.json"))) {
    await verifyResults(run);
    return readJson(path.join(run, "evaluation/summary.json"));
  }
  const beforeFreeze = await fileHash(
    path.join(run, "integration/decision-freeze.json"),
  );
  // First access to reference-bearing inputs occurs only after both freezes verified.
  await verifyRecovery(c.recoveryBundle);
  const e = await readJson(path.join(c.recoveryBundle, "input-evidence.json"));
  const R = parseReference(Buffer.from(e.referenceAss)).records;
  const rows = [];
  for (const [side, records] of Object.entries({
    before: input.baseline,
    after: result.records,
  }))
    for (const policy of ["exact-visible-v1", "whitespace-only-v1"]) {
      const { edits, ...row } = compareStreams(
        textStream(R, "R"),
        textStream(records, side),
        policy,
      );
      rows.push({ side, ...row, editPathHash: identity(edits) });
    }
  // v1 localization uses full raw machine stream for deletion association, and
  // the deliverable stream for temporal coverage. Retain that distinction.
  const rawAfter = [...input.raw, ...result.inserted].sort(
    (a, b) => (a.sourceStart ?? Infinity) - (b.sourceStart ?? Infinity),
  );
  const loc = {};
  for (const [side, raw, retained] of [
    ["before", input.raw, input.baseline],
    ["after", rawAfter, result.records],
  ])
    loc[side] = localize(
      R,
      retained,
      compareStreams(
        textStream(R, "R"),
        textStream(raw, "B"),
        "exact-visible-v1",
      ),
      { start: c.experiment.audioOffset, end: c.experiment.sourceEnd },
    );
  const counts = (l) => ({
    P0: l.candidates.filter((x) => x.priority === "P0").length,
    P1: l.candidates.filter((x) => x.priority === "P1").length,
    P2: l.rows.filter((x) => x.priority === "P2").length,
    regions: l.regions.length,
  });
  const localizedBefore = counts(loc.before);
  for (const k of ["P0", "P1", "P2", "regions"])
    if (localizedBefore[k] !== input.manifest.stats[k])
      throw Error("LOCALIZATION_BASELINE_DRIFT:" + k);
  const dir = path.join(run, "evaluation");
  await fs.mkdir(dir, { recursive: true });
  await immutable(path.join(dir, "before-after-reference-comparison.json"), {
    comparisonKind: "DELIVERABLE_TO_HISTORICAL_REFERENCE",
    ...referenceFlags,
    CER: "NOT_MEASURED",
    rows,
  });
  await immutable(path.join(dir, "localization-before-after.json"), {
    before: loc.before,
    after: loc.after,
    counts: { before: localizedBefore, after: counts(loc.after) },
    diagnosticOnly: true,
    newPlansAuthorized: false,
  });
  const local = await readJson(
    path.join(run, "integration/local-candidates.json"),
  );
  await immutable(
    path.join(dir, "per-window-reference-diagnostics.json"),
    c.windows.map((w) => ({
      windowId: w.windowId,
      reference: R.filter(
        (r) => r.start < w.requestEnd && r.end > w.requestStart,
      ),
      local: local
        .filter((r) => r.record.windowId === w.windowId)
        .map((x) => x.record),
      diagnosticOnly: true,
      acousticCorrectness: "NOT_VERIFIED",
    })),
  );
  if (
    (await fileHash(path.join(run, "integration/decision-freeze.json"))) !==
    beforeFreeze
  )
    throw Error("POST_REFERENCE_DECISION_MUTATION");
  await verifyIntegration(run);
  const ledger = await journal(run),
    operations = checkJournal(c, ledger),
    finished = ledger.filter((r) => r.kind === "finished");
  const summary = {
    statuses: [
      "LOCAL_ASR_EXECUTION_COMPLETE",
      "LOCAL_ASR_RAW_EVIDENCE_FROZEN",
      "MACHINE_INTEGRATION_EVALUATED",
      result.inserted.length
        ? "LOCAL_ASR_RECOVERY_CANDIDATE_READY"
        : "LOCAL_ASR_NO_SAFE_INSERTIONS",
      "FULL_TIMED_EXPORT_STILL_BLOCKED",
    ],
    ...gates,
    LOCAL_ASR_EXECUTED: true,
    newASRPrimaryRequests: operations.primary,
    newASRPrimaryAudioSeconds:
      c.budget.primarySamples / c.authorization.sampleRate,
    newASRAudioWindows: c.windows.length,
    technicalRetries: operations.retries,
    totalDispatches: operations.dispatches,
    totalAudioSeconds: operations.samples / c.authorization.sampleRate,
    providerProcessStarts: finished.length,
    modelLoadCount: "UNKNOWN",
    newWholeMediaASRRequests: 0,
    newVADDispatches: 0,
    newVADInference: 0,
    newSourceMediaExtractions: 0,
    newExternalReferenceSearches: 0,
    referenceTextUsedAsPromptCount: 0,
    existingSubtitleTextMutations: 0,
    existingSubtitleRawTimingMutations: 0,
    existingSubtitleMappedTimingMutations: 0,
    beforeCount: input.baseline.length,
    insertedCount: result.inserted.length,
    afterCount: result.records.length,
    localRawRecords: local.length,
    decisionCounts: Object.fromEntries(
      [...new Set(result.decisions.map((x) => x.status))].map((s) => [
        s,
        result.decisions.filter((x) => x.status === s).length,
      ]),
    ),
    windowStates: finished.map((x) => ({
      requestId: x.requestId,
      status: x.status,
    })),
    localization: { before: localizedBefore, after: counts(loc.after) },
    referenceBodyReadAfterRawAndDecisionFreeze: true,
  };
  await immutable(path.join(dir, "summary.json"), summary);
  await immutable(path.join(run, "results-freeze.json"), {
    version: "frozen-local-asr-results-v1",
    decisionFreezeHash: beforeFreeze,
    files: [
      ...(await inventory(dir)).map((r) => ({
        ...r,
        path: "evaluation/" + r.path,
      })),
      ...(await inventory(path.join(run, "integration"))).map((r) => ({
        ...r,
        path: "integration/" + r.path,
      })),
      {
        path: "raw-freeze.json",
        sha256: await fileHash(path.join(run, "raw-freeze.json")),
      },
    ],
  });
  return summary;
}
export async function verifyResults(run) {
  await verifyIntegration(run);
  const f = await readJson(path.join(run, "results-freeze.json"));
  await checkFiles(run, f.files);
  if (
    (await fileHash(path.join(run, "integration/decision-freeze.json"))) !==
    f.decisionFreezeHash
  )
    throw Error("RESULTS_DECISION_BINDING");
  return true;
}
