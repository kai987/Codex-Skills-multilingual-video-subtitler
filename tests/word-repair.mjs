import test from "node:test";
/* global fetch */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { identity } from "../scripts/lib/content-review-plan.mjs";
import { fileHash, readJson } from "../scripts/lib/local-asr-run.mjs";
import { bindReviewCandidates } from "../packages/video-subtitler/dist/review-action-validation.js";
import {
  completeUnits,
  localDiffs,
  proposeWords,
  proposePriorWords,
  sideEvidence,
  applyActions,
  emptyResolution,
} from "../scripts/lib/word-repair.mjs";
import {
  loadReview,
  saveActions,
  exportReview,
  evaluateReview,
  validateActionFile,
} from "../scripts/lib/word-repair-run.mjs";
import { serveReview } from "../scripts/lib/word-repair-server.mjs";
const base = {
  recordId: "r",
  text: "町の男の人です",
  sourceStart: 1,
  sourceEnd: 3,
};
const candidate = {
  candidateId: "c",
  targetCueIds: ["r"],
  baseText: base.text,
  text: "街の男の人です",
  span: { start: 0, end: 1, before: "町", after: "街" },
  sources: ["frozen"],
};
function fixture() {
  const items = bindReviewCandidates({
    items: [
      {
        reviewId: "i",
        unitId: "u",
        targetCueIds: ["r"],
        interval: { start: 0, end: 4 },
        candidateSuggestions: [candidate],
        allowedHumanActions: [
          "KEEP",
          "MARK_UNRESOLVED",
          "ACCEPT_SUGGESTION",
          "EDIT_TEXT",
          "EDIT_TIMING",
        ],
      },
      {
        reviewId: "missing",
        unitId: "m",
        targetCueIds: ["new"],
        interval: { start: 5, end: 7 },
        candidateSuggestions: [],
        allowedHumanActions: ["KEEP", "EDIT_TEXT", "EDIT_TIMING"],
      },
    ],
    inputEvidenceHash: "x",
    reviewVersion: 1,
  });
  return {
    reviewVersion: 1,
    baseline: [base],
    items,
    sourceEnd: 10,
    units: [
      {
        id: "u",
        start: 1,
        end: 3,
        baselineIds: ["r"],
        referenceText: base.text,
        referenceDistance: 0,
        category: "exact-control",
      },
      {
        id: "m",
        start: 5,
        end: 7,
        baselineIds: [],
        referenceText: "はい",
        referenceDistance: 2,
        category: "missing",
      },
    ],
  };
}
const edit = (text = "修正です") => ({
  ...emptyResolution("i", "EDIT_TEXT"),
  correctedText: text,
});
const time = (start = 1.1, end = 2.9) => ({
  ...emptyResolution("i", "EDIT_TIMING"),
  start,
  end,
});
const accept = (w) => ({
  ...emptyResolution("i", "ACCEPT_SUGGESTION"),
  selectedCandidateId: "c",
  selectedCandidateEvidenceHash:
    w.items[0].candidateActionBindings[0].candidateEvidenceHash,
});
test("complete temporal components preserve whole crossing records", () => {
  const b = [base, { ...base, recordId: "b", sourceStart: 8, sourceEnd: 9 }],
    r = [
      {
        refId: "a",
        start: 2,
        end: 4,
        style: "Default",
        visibleText: base.text,
      },
      {
        refId: "b",
        start: 8,
        end: 9,
        style: "Default",
        visibleText: base.text,
      },
    ];
  const u = completeUnits(b, r, 2).units;
  assert.equal(u[0].start, 1);
  assert.equal(u[0].end, 4);
  assert.deepEqual(u[0].baselineIds, ["r"]);
  assert.equal(u[0].acousticallyReverified, false);
});
test("invalid reference time fails closed", () =>
  assert.throws(
    () =>
      completeUnits(
        [base],
        [{ refId: "x", start: 0, end: 0, visibleText: "x" }],
        2,
      ),
    /UNIT_INPUT/,
  ));
test("sub-character diff expands to a Japanese word", () =>
  assert.deepEqual(
    localDiffs("人形小学校の学生です", "人情小学校の学生です")[0],
    { start: 0, end: 2, before: "人形", after: "人情" },
  ));
test("whole sentence replacement and pure insertion are not word proposals", () => {
  assert.deepEqual(localDiffs("はい", "いいえ"), []);
  assert.deepEqual(localDiffs("町の人です", "町の良い人です"), []);
});
test("ASR time overlap cannot replace target binding", () =>
  assert.deepEqual(
    proposeWords(
      base,
      [
        {
          id: "a",
          start: 0,
          end: 5,
          text: "街の男の人です",
          targetCueIds: ["other"],
        },
      ],
      { entries: [] },
    ),
    [],
  ));
test("wrong occurrence / unrelated ASR is excluded", () =>
  assert.deepEqual(
    proposeWords(
      base,
      [
        {
          id: "a",
          start: 0,
          end: 5,
          text: "ご視聴ありがとうございました",
          targetCueIds: ["r"],
        },
      ],
      { entries: [] },
    ),
    [],
  ));
test("prior lookup stays explicitly prior-only", () => {
  const m = {
    entries: [
      {
        entryId: "term",
        status: "active",
        trustLevel: "human-reviewed",
        applicationEligibility: "ranking-only",
        canonicalSurface: "勘助",
        readingHiragana: "かんすけ",
        acousticAliases: [],
      },
    ],
  };
  const p = proposePriorWords(
    { ...base, text: "カウンスケは学校の生徒です" },
    m,
  );
  assert.ok(p.some((c) => c.span.after === "勘助"));
  assert.ok(
    p.every(
      (c) => c.authority === "prior-word-proposal" && !c.automaticEligible,
    ),
  );
});
test("terminology suggestions cannot delete a particle or expand a known noun", () => {
  const memory = {
    entries: [
      {
        entryId: "school",
        status: "active",
        trustLevel: "human-reviewed",
        applicationEligibility: "ranking-only",
        canonicalSurface: "尋常小学校",
        readingHiragana: null,
        acousticAliases: [],
      },
      {
        entryId: "place",
        status: "active",
        trustLevel: "human-reviewed",
        applicationEligibility: "ranking-only",
        canonicalSurface: "岸和田",
        readingHiragana: null,
        acousticAliases: [],
      },
    ],
  };
  assert.equal(
    proposePriorWords({ ...base, text: "小学校は岸和田にあります" }, memory)
      .length,
    0,
  );
});
const raw = (tail = 0.02) => ({
  pathStatus: "success",
  frameCountVerified: true,
  workerRequestVerified: true,
  target: { targetText: "来たー" },
  selectedBoundary: { start: 1, end: 2 },
  tokenSpans: [{ meanPosterior: 0.3 }, { meanPosterior: tail }],
});
test("CTC start and weak tail evaluated separately", () => {
  assert.equal(sideEvidence([raw(), raw()], "start").stable, true);
  assert.equal(sideEvidence([raw(), raw()], "end").stable, false);
});
test("missing request identity and pinned edge never pass", () => {
  assert.equal(
    sideEvidence([{ ...raw(), workerRequestVerified: false }, raw()], "start")
      .stable,
    false,
  );
  assert.equal(
    sideEvidence([{ ...raw(), endPinnedToWindowEdge: true }, raw(0.5)], "end")
      .stable,
    false,
  );
});
test("KEEP never creates a virtual missing cue", () =>
  assert.equal(
    applyActions(fixture(), [emptyResolution("missing")]).incompleteInsertions
      .length,
    0,
  ));
test("explicit text edit preserves all original times and source", () => {
  const w = fixture(),
    snapshot = identity(w);
  const result = applyActions(w, [edit()]);
  assert.equal(result.records[0].text, "修正です");
  assert.equal(result.records[0].sourceStart, 1);
  assert.equal(identity(w), snapshot);
  assert.equal(result.humanValidated, false);
});
test("explicit timing edit preserves text", () =>
  assert.equal(applyActions(fixture(), [time()]).records[0].text, base.text));
test("wrong candidate hash rejected", () => {
  const w = fixture();
  assert.throws(
    () =>
      applyActions(w, [
        { ...accept(w), selectedCandidateEvidenceHash: "wrong" },
      ]),
    /HASH_MISMATCH/,
  );
});
test("candidate cannot overwrite earlier manual correction", () => {
  const w = fixture();
  assert.throws(
    () => applyActions(w, [edit(), { ...accept(w), resolutionId: "second" }]),
    /STALE_CANDIDATE/,
  );
});
test("unknown payload and unsupported operations rejected", () => {
  assert.throws(() => applyActions(fixture(), [{ ...edit(), unknown: true }]));
  assert.throws(
    () => applyActions(fixture(), [{ ...edit(), action: "DELETE_CUE" }]),
    /UNSUPPORTED/,
  );
});
test("non-grid timing, inverted times and outside interval rejected", () => {
  for (const a of [time(1.111, 2), time(3, 2), time(0, 8)])
    assert.throws(() => applyActions(fixture(), [a]));
});
test("new neighbor overlap rejected", () => {
  const w = fixture();
  w.baseline.push({
    ...base,
    recordId: "other",
    sourceStart: 3.1,
    sourceEnd: 4,
  });
  assert.throws(() => applyActions(w, [time(1, 3.2)]), /NEW_NEIGHBOR_OVERLAP/);
});
test("missing cue needs both explicit text and timing", () => {
  const w = fixture(),
    a = { ...emptyResolution("missing", "EDIT_TEXT"), correctedText: "はい" };
  assert.equal(applyActions(w, [a]).incompleteInsertions.length, 1);
  const b = {
    ...emptyResolution("missing", "EDIT_TIMING"),
    resolutionId: "second",
    start: 5.1,
    end: 6,
  };
  assert.equal(applyActions(w, [a, b]).records.length, 2);
});
test("unsafe ASS tags rejected and duplicate action id rejected", () => {
  assert.throws(() => applyActions(fixture(), [edit("{\\b1}はい")]), /UNSAFE/);
  assert.throws(() => applyActions(fixture(), [edit(), edit()]), /DUPLICATE/);
});
test("baseline control regressions counted separately", () => {
  const w = fixture();
  const e = evaluateReview(w, applyActions(w, [edit()]).records);
  assert.equal(e.regressed, 1);
  assert.equal(e.improved, 0);
});
test("foreign workspace action file rejected", () =>
  assert.throws(
    () =>
      validateActionFile(fixture(), {
        workspaceHash: "0".repeat(64),
        reviewVersion: 1,
        actions: [],
      }),
    /STALE_WORKSPACE/,
  ));
async function diskFixture(t) {
  const root = await fs.mkdtemp(
    path.join(await fs.realpath(os.tmpdir()), "word-repair-test-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const w = fixture();
  w.units.forEach((u) => {
    u.audio = "audio/" + u.id + ".wav";
  });
  const benchmark = { units: w.units };
  await fs.writeFile(
    path.join(root, "benchmark.json"),
    JSON.stringify(benchmark),
  );
  w.benchmarkHash = await fileHash(path.join(root, "benchmark.json"));
  await fs.writeFile(path.join(root, "workspace.json"), JSON.stringify(w));
  await fs.writeFile(
    path.join(root, "benchmark-freeze.json"),
    JSON.stringify({ benchmarkHash: w.benchmarkHash }),
  );
  await fs.writeFile(
    path.join(root, "workspace-freeze.json"),
    JSON.stringify({
      files: await Promise.all(
        ["workspace.json", "benchmark.json", "benchmark-freeze.json"].map(
          async (p) => ({
            path: p,
            sha256: await fileHash(path.join(root, p)),
          }),
        ),
      ),
    }),
  );
  const saved = { workspaceHash: identity(w), reviewVersion: 1, actions: [] };
  await fs.writeFile(path.join(root, "actions.json"), JSON.stringify(saved));
  return { root, w, saved };
}
test("save, reload, export and independent formats use same actions", async (t) => {
  const { root, w, saved } = await diskFixture(t);
  await saveActions(root, { ...saved, actions: [edit()] });
  const out = await exportReview(root);
  assert.equal(out.changes, 1);
  assert.equal(out.status, "needs-review");
  assert.equal(
    (await readJson(path.join(out.directory, "changes.json"))).records[0].text,
    "修正です",
  );
  assert.equal((await loadReview(root)).baseline[0].text, base.text);
  assert.equal((await fs.readdir(path.join(root, "action-history"))).length, 2);
  assert.equal(w.baseline[0].sourceStart, 1);
});
test("incomplete insertion blocks export", async (t) => {
  const { root, saved } = await diskFixture(t);
  await saveActions(root, {
    ...saved,
    actions: [
      { ...emptyResolution("missing", "EDIT_TEXT"), correctedText: "はい" },
    ],
  });
  await assert.rejects(exportReview(root), /INCOMPLETE_INSERTION/);
});
test("tampered frozen workspace rejected", async (t) => {
  const { root } = await diskFixture(t);
  await fs.appendFile(path.join(root, "workspace.json"), " ");
  await assert.rejects(loadReview(root), /HASH_MISMATCH/);
});
test("mandatory freeze rows cannot be removed or duplicated", async (t) => {
  const { root } = await diskFixture(t);
  const p = path.join(root, "workspace-freeze.json"),
    f = await readJson(p);
  await fs.writeFile(p, JSON.stringify({ files: [] }));
  await assert.rejects(loadReview(root), /INCOMPLETE_OR_DUPLICATE/);
  await fs.writeFile(p, JSON.stringify({ files: [...f.files, f.files[0]] }));
  await assert.rejects(loadReview(root), /INCOMPLETE_OR_DUPLICATE/);
});
test("HTTP token, foreign origin, stale revision, persistence and export", async (t) => {
  const { root, saved } = await diskFixture(t),
    { server, url } = await serveReview(root);
  t.after(() => new Promise((r) => server.close(r)));
  const baseUrl = new URL(url),
    q = baseUrl.search;
  const request = (p, body, headers = {}) =>
    fetch(
      baseUrl.origin + p + q,
      body
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json", ...headers },
            body: JSON.stringify(body),
          }
        : { headers },
    );
  assert.equal((await fetch(baseUrl.origin + "/state")).status, 403);
  assert.equal(
    (await request("/state", null, { Origin: "https://example.com" })).status,
    403,
  );
  assert.equal((await request("/../workspace.json")).status, 404);
  const before = await (await request("/state")).json();
  assert.equal(
    (await request("/save", { revision: "old", saved })).status,
    409,
  );
  const updated = await request("/save", {
    revision: before.revision,
    saved: { ...saved, actions: [edit()] },
  });
  assert.equal(updated.status, 200);
  const next = await updated.json();
  assert.equal(next.result.records[0].text, "修正です");
  const out = await (
    await request("/export", { revision: next.revision })
  ).json();
  assert.equal(out.links.length, 6);
  assert.match(
    await (await fetch(baseUrl.origin + out.links[1].url)).text(),
    /修正です/,
  );
  const html = await (await fetch(url)).text();
  assert.match(html, /app.js\?token=/);
  assert.equal((await request("/app.js")).status, 200);
});
