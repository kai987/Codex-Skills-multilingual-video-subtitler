/* global AbortController */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  normalizeShortResponse,
  observeShortResponses,
  deliverShortResponseObservation,
} from "../scripts/lib/short-response-observation.mjs";
import { refineDefaultDelivery } from "../scripts/lib/default-seam-delivery.mjs";
import { replayShortResponseObservation } from "../scripts/subtitle-tool-observe-short-responses.mjs";
import { compareContrast } from "../scripts/lib/short-context-contrast.mjs";
import { evaluateShortResponseObservation } from "../scripts/evaluate-short-response-observation.mjs";

const row = (id, text, start = 1, end = 2) => ({ id, text, start, end });
test("comparison retains small tsu, kana and lexical distinctions", () => {
  assert.equal(normalizeShortResponse(" あれっ？！ "), "あれっ");
  assert.notEqual(
    normalizeShortResponse("あれ"),
    normalizeShortResponse("あれっ"),
  );
  assert.notEqual(
    normalizeShortResponse("何か"),
    normalizeShortResponse("なんか"),
  );
});
test("short cue selection is general, not a target phrase allowlist", () => {
  const r = observeShortResponses([
    row("a", "はい"),
    row("b", "いいえ"),
    row("c", "あいうえおかきく"),
    row("d", "あいうえおかきくけ"),
    row("e", "..."),
    row("f", "hello"),
  ]);
  assert.deepEqual(
    r.entries.map((x) => x.id),
    ["a", "b", "c"],
  );
  assert.equal(r.policy.automaticReplacementAllowed, false);
});
test("long envelopes and overlaps are warnings, never retiming or deletion", () => {
  const r = observeShortResponses([
    row("a", "そう", 1, 6),
    row("b", "はい", 4, 5),
  ]);
  assert.deepEqual(r.entries[0].reasons, [
    "SHORT_TEXT_CONTEXT_UNVERIFIED",
    "LONG_ENVELOPE_SHORT_TEXT",
    "OVERLAPPING_CUE_ENVELOPES",
  ]);
  assert.deepEqual(r.entries[0].overlappingIds, ["b"]);
  assert.equal(r.entries[0].start, 1);
  assert.equal(r.entries[0].end, 6);
  assert.equal(r.entries[0].timingVerified, false);
});
test("non-overlapping identical responses keep both occurrences and source order", () => {
  const r = observeShortResponses([
    row("b", "はい", 8, 9),
    row("a", "はい", 1, 2),
  ]);
  assert.deepEqual(
    r.entries.map((x) => x.id),
    ["a", "b"],
  );
  assert.deepEqual(r.entries[0].overlappingIds, []);
  assert.equal(r.entries[1].previous.id, "a");
});
test("invalid timing is reported, not guessed or scored as no risk", () => {
  const r = observeShortResponses([
    row("zero", "はい", 1, 1),
    row("bad", "はい", null, 2),
    row("negative", "はい", -1, 2),
  ]);
  assert.deepEqual(r.invalidRecordIds, ["zero", "bad", "negative"]);
  assert.equal(r.observedCount, 0);
});
test("duplicate identities fail and frozen input is not mutated", () => {
  assert.throws(
    () => observeShortResponses([row("a", "はい"), row("a", "はい")]),
    /UNIQUE_RECORD/u,
  );
  const r = Object.freeze([Object.freeze(row("x", "えっ"))]);
  const before = JSON.stringify(r);
  observeShortResponses(r);
  assert.equal(JSON.stringify(r), before);
});

async function fixture(t) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "short-observation-test-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const task = path.join(root, "baseline");
  await fs.mkdir(task);
  const recordsPath = path.join(task, "mapped-records.json"),
    subtitlePath = path.join(task, "original.srt");
  const mapped = {
    timebase: "source-global-relative-to-container-origin",
    coverageScope: "full-audio",
    records: [
      { recordId: "raw-1", sourceStart: 1, sourceEnd: 2, text: "はい" },
      { recordId: "raw-2", sourceStart: 5, sourceEnd: 6, text: "いいえ" },
    ],
  };
  await fs.writeFile(recordsPath, JSON.stringify(mapped));
  // The actual preferred file intentionally differs from the raw record set.
  await fs.writeFile(subtitlePath, "1\n00:00:01,000 --> 00:00:02,000\nはい\n");
  return {
    root,
    task,
    recordsPath,
    subtitlePath,
    base: {
      task,
      recordsPath,
      outputs: ["original.srt"],
      executionStatus: "completed",
      coverageScope: "full-audio",
      unresolvedCount: 0,
      aliasCount: 0,
    },
  };
}
test("sidecar observes actual preferred SRT separately and preserves input bytes", async (t) => {
  const f = await fixture(t);
  const before = await Promise.all(
    [f.recordsPath, f.subtitlePath].map((p) => fs.readFile(p)),
  );
  const result = await deliverShortResponseObservation({
    ...f,
    outputRoot: f.task,
  });
  const data = JSON.parse(await fs.readFile(result.artifact, "utf8"));
  assert.equal(data.baseline.observedCount, 2);
  assert.equal(data.preferred.observedCount, 1);
  assert.equal(data.referenceUsed, false);
  assert.equal(data.newInference, 0);
  assert.equal(data.subtitleTextMutations, 0);
  assert.equal(data.subtitleTimingMutations, 0);
  assert.equal(data.qualityStatus, "needs-review");
  assert.deepEqual(
    await Promise.all(
      [f.recordsPath, f.subtitlePath].map((p) => fs.readFile(p)),
    ),
    before,
  );
  const originalArtifact = await fs.readFile(result.artifact);
  await assert.rejects(
    deliverShortResponseObservation({ ...f, outputRoot: f.task }),
    /EEXIST/u,
  );
  assert.deepEqual(await fs.readFile(result.artifact), originalArtifact);
});
test("default Japanese generation observes even with seam ASR disabled", async (t) => {
  const f = await fixture(t);
  const forbidden = async () => {
    throw Error("UNEXPECTED_MODEL_PATH");
  };
  const result = await refineDefaultDelivery(
    f.base,
    { enabled: false, language: "ja" },
    { prepare: forbidden, execute: forbidden, assemble: forbidden },
  );
  assert.equal(
    result.defaultDelivery.shortResponseObservation.status,
    "observed",
  );
  assert.equal(
    result.defaultDelivery.shortResponseObservation.observedCount,
    1,
  );
  assert.equal(result.defaultDelivery.inferenceRequests, 0);
  assert.deepEqual(result.preferredOutputs, [f.subtitlePath]);
  assert.match(
    await fs.readFile(result.outputIndex, "utf8"),
    /SHORT_RESPONSE_OBSERVATION.md/u,
  );
});
test("refined default audits candidate SRT, not the baseline delivery", async (t) => {
  const f = await fixture(t),
    candidate = path.join(f.root, "candidate");
  await fs.mkdir(candidate);
  await fs.writeFile(
    path.join(candidate, "seam-text-only.machine-candidate.srt"),
    "1\n00:00:04,000 --> 00:00:05,000\nえっ\n\n2\n00:00:06,000 --> 00:00:07,000\nはい\n",
  );
  const result = await refineDefaultDelivery(
    f.base,
    { language: "ja" },
    {
      prepare: async () => ({ root: f.root, requests: 2, seconds: 5 }),
      execute: async () => ({ newInference: 0 }),
      assemble: async () => ({ root: candidate, changedTargets: 1 }),
    },
  );
  const data = JSON.parse(
    await fs.readFile(
      result.defaultDelivery.shortResponseObservation.artifact,
      "utf8",
    ),
  );
  assert.equal(data.preferred.observedCount, 2);
  assert.equal(data.preferred.entries[0].text, "えっ");
});
test("unavailable preferred file is not silently replaced with baseline audit", async (t) => {
  const f = await fixture(t);
  const result = await refineDefaultDelivery(
    f.base,
    { language: "ja" },
    {
      prepare: async () => ({ root: f.root, requests: 2, seconds: 5 }),
      execute: async () => ({ newInference: 0 }),
      assemble: async () => ({
        root: path.join(f.root, "absent"),
        changedTargets: 1,
      }),
    },
  );
  assert.equal(
    result.defaultDelivery.shortResponseObservation.status,
    "unavailable",
  );
  assert.equal(
    result.defaultDelivery.shortResponseObservation.observedCount,
    undefined,
  );
});
test("non-Japanese path does not attempt observation", async (t) => {
  const f = await fixture(t);
  const result = await refineDefaultDelivery(f.base, { language: "en" });
  assert.equal(
    result.defaultDelivery.shortResponseObservation.reason,
    "unvalidated-language",
  );
  await assert.rejects(
    fs.access(path.join(f.task, "SHORT_RESPONSE_OBSERVATION.json")),
    /ENOENT/u,
  );
});
test("pre-cancelled no-refinement invocation creates no files", async (t) => {
  const f = await fixture(t),
    controller = new AbortController();
  const before = await fs.readdir(f.task);
  controller.abort();
  await assert.rejects(
    refineDefaultDelivery(f.base, {
      enabled: false,
      language: "ja",
      signal: controller.signal,
    }),
    /abort/iu,
  );
  assert.deepEqual(await fs.readdir(f.task), before);
});
test("explicit offline replay writes outside historical input directory", async (t) => {
  const f = await fixture(t),
    before = await fs.readdir(f.task);
  const r = await replayShortResponseObservation(
    f.recordsPath,
    f.subtitlePath,
    path.join(f.root, "output"),
  );
  assert.equal(r.status, "observed");
  assert.deepEqual(await fs.readdir(f.task), before);
  await assert.rejects(
    replayShortResponseObservation(f.recordsPath, f.subtitlePath, f.task),
    /OUTPUT_INSIDE/u,
  );
  const link = path.join(f.root, "alias");
  await fs.symlink(f.task, link);
  await assert.rejects(
    replayShortResponseObservation(
      f.recordsPath,
      f.subtitlePath,
      path.join(link, "new"),
    ),
    /OUTPUT_INSIDE/u,
  );
});
test("cancellation during observer stage propagates to default delivery", async (t) => {
  const f = await fixture(t),
    controller = new AbortController();
  const result = await refineDefaultDelivery(
    f.base,
    { enabled: false, language: "ja", signal: controller.signal },
    {
      observe: async () => {
        controller.abort();
        return { status: "observed", newInference: 0 };
      },
    },
  );
  assert.equal(result.defaultDelivery.status, "cancelled");
  assert.equal(
    result.defaultDelivery.shortResponseObservation.status,
    "cancelled",
  );
});
test("invalid preferred timing is unavailable instead of zero-risk success", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(
    f.subtitlePath,
    "1\n00:00:02,000 --> 00:00:01,000\nはい\n",
  );
  const result = await refineDefaultDelivery(f.base, {
    enabled: false,
    language: "ja",
  });
  assert.equal(
    result.defaultDelivery.shortResponseObservation.status,
    "unavailable",
  );
  assert.match(
    result.defaultDelivery.shortResponseObservation.reason,
    /INVALID_PREFERRED/u,
  );
});
test("unverified timebase and empty subtitle refuse apparently successful audits", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(f.subtitlePath, "");
  await assert.rejects(
    deliverShortResponseObservation({ ...f, outputRoot: f.task }),
    /NO_PREFERRED|no cues/u,
  );
  await fs.writeFile(f.recordsPath, JSON.stringify({ records: [] }));
  await assert.rejects(
    deliverShortResponseObservation({ ...f, outputRoot: f.task }),
    /SOURCE_GLOBAL/u,
  );
});
test("known human-confirmed short response remains evaluation-only and cannot authorize a vote", async () => {
  const label = JSON.parse(
    await fs.readFile(
      new URL(
        "./fixtures/short-response-human-evaluation.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(label.expectedText, "あれっ");
  assert.equal(label.use, "evaluation-only-known-development-case");
  const views = label.machineTexts.map((text, i) => ({
    backend: i ? "kotoba" : "whisper",
    text,
  }));
  // No human label is passed to either production observation or contrast decision.
  const risk = observeShortResponses([row("machine", views[0].text)]);
  const decision = compareContrast(views, views, []);
  assert.equal(risk.observedCount, 1);
  assert.equal(decision.shortAgreement, true);
  assert.equal(decision.automaticReplacementAllowed, false);
  assert.notEqual(
    normalizeShortResponse(views[0].text),
    normalizeShortResponse(label.expectedText),
  );
});
test("production module and package exclude evaluation fixtures/reference imports", async () => {
  const module = await fs.readFile(
    new URL("../scripts/lib/short-response-observation.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    module,
    /あれっ|compareReference|child_process|worker|referenceAss/u,
  );
  const pack = await fs.readFile(
    new URL("../scripts/package-subtitle-tool.mjs", import.meta.url),
    "utf8",
  );
  assert.match(pack, /scripts\/lib\/short-response-observation.mjs/u);
  assert.doesNotMatch(pack, /short-response-human-evaluation/u);
});
test("evaluation verifies frozen machine data before reading Gold and reports only diagnostics", async (t) => {
  const f = await fixture(t);
  const run = await replayShortResponseObservation(
    f.recordsPath,
    f.subtitlePath,
    path.join(f.root, "evaluation"),
  );
  const reference = path.join(f.root, "gold.ass");
  await fs.writeFile(
    reference,
    "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:02.00,Dialogue,,0,0,0,,はい\n",
  );
  const result = await evaluateShortResponseObservation(run.root, reference);
  assert.equal(result.selectedReferenceCases, 1);
  assert.equal(result.casesWithObservationOverlap, 1);
  assert.equal(result.reviewPrecision, null);
  assert.equal(result.independentHoldoutValidation, "not-run");
  assert.equal(result.automaticReplacementsAttempted, 0);
  const saved = await fs.readFile(
    path.join(run.root, "reference-evaluation.json"),
  );
  await assert.rejects(
    evaluateShortResponseObservation(run.root, reference),
    /EEXIST/u,
  );
  assert.deepEqual(
    await fs.readFile(path.join(run.root, "reference-evaluation.json")),
    saved,
  );
  await fs.appendFile(run.artifact, " ");
  await assert.rejects(
    evaluateShortResponseObservation(
      run.root,
      path.join(f.root, "missing-gold.ass"),
    ),
    /CHANGED:SHORT_RESPONSE/u,
  );
});
