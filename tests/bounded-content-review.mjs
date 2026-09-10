/* global AbortController */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import cp from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { Buffer } from "node:buffer";
import { fixture, stub } from "./helpers/bounded-offline-fixture.mjs";
import { legacyFixtureReport } from "./helpers/legacy-bounded-fixture.mjs";
import { runB } from "../scripts/lib/bounded-asr-ab.mjs";
import { reportRevision } from "../scripts/lib/bounded-report-revision.mjs";
import {
  prepareReview,
  verifyBundle,
  summarizeReview,
  coreSlice,
  bundleSchema,
  bundleFreezeSchema,
} from "../scripts/lib/bounded-content-review.mjs";
import {
  bounds,
  sampleAt,
  unionSamples,
  planTargets,
  hint,
} from "../scripts/lib/content-review-plan.mjs";
import {
  template,
  parseCsv,
  evaluateCsv,
  columns,
  criteria,
  csvCell,
} from "../scripts/lib/content-review-input.mjs";
const m = {
  pcm: { frames: 1600000, sampleRate: 16000 },
  audioOffset: 1.25,
  sourceEnd: 101.25,
};
const bItem = {
  reviewId: "neutral",
  kind: "stratified",
  start: 2.25001,
  end: 3.25001,
  audioStatus: "READY",
};
bItem.bounds = bounds(bItem, m);
const bound = { identity: "a".repeat(64), pcm: m.pcm };
const encode = (rows) =>
  rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
function reviewed(items = [bItem]) {
  const rows = parseCsv(template(items, bound.identity));
  for (let i = 1; i < rows.length; i++) {
    const item = items[i - 1],
      r = Object.fromEntries(columns.map((c, n) => [c, rows[i][n]]));
    Object.assign(r, {
      status: "REVIEWED",
      reviewedAt: "2026-09-10T12:00:00+09:00",
      actuallyListened: "TRUE",
      listenedStart: String(item.start),
      listenedEnd: String(item.end),
      overall: "B",
      notes: 'SYNTHETIC TEST ONLY 日本語,"quote"\nsecond line',
    });
    for (const side of ["A", "B"])
      for (const c of criteria) r[side + "_" + c] = "NO_ISSUE_OBSERVED";
    rows[i] = columns.map((c) => r[c]);
  }
  return rows;
}
test("rational evaluation ceil/ceil; playback enclosure and nonzero offset", () => {
  assert.equal(sampleAt(2.25001, 1.25, 16000), 16001);
  assert.equal(sampleAt(2.25001, 1.25, 16000, "floor"), 16000);
  assert.equal(bItem.bounds.evaluationEndSample, 32001);
  assert.equal(bItem.bounds.playbackStartSample, 0);
  assert.equal(sampleAt(1.24999, 1.25, 16000, "floor"), -1);
  assert.equal(sampleAt(1.24999, 1.25, 16000), 0);
  assert.equal(
    unionSamples([
      [1, 5],
      [3, 8],
      [8, 9],
    ]),
    8,
  );
});
test("cross-core stitching excludes overlapping context and is byte exact", () => {
  const data = Buffer.from([0, 0, 1, 0, 2, 0, 3, 0, 4, 0, 5, 0]);
  const chunks = [
    {
      chunk: { id: "a", inputStart: 0, coreStart: 0, coreEnd: 3 },
      data: data.subarray(0, 10),
    },
    {
      chunk: { id: "b", inputStart: 2, coreStart: 3, coreEnd: 6 },
      data: data.subarray(4),
    },
  ];
  const r = coreSlice(chunks, 1, 5);
  assert.deepEqual(r.data, data.subarray(2, 10));
  assert.equal(r.segments.length, 2);
  assert.throws(() => coreSlice([chunks[1]], 1, 5), /GAP/);
});
test("CSV round-trips quotes commas CRLF Unicode and preserves formula-like text as data", () => {
  const rows = reviewed();
  rows[1][columns.indexOf("notes")] = '=HYPERLINK("evil")\n日本語';
  assert.deepEqual(parseCsv(encode(rows)), rows);
  const r = evaluateCsv(encode(rows), bound, [bItem]);
  assert.equal(r.exitCode, 0);
  assert.ok(r.validation.warnings.length);
  assert.equal(r.summary.releaseAuthorityGranted, false);
  assert.equal(r.summary.groups.stratified.comparison.B, 1);
  assert.equal(
    r.summary.groups.stratified.pairedCriteria.missingSpeech.denominator,
    1,
  );
});
test("malformed quoting and duplicate headers fail closed", () => {
  for (const value of ['a,"unclosed', 'a,"closed"x', 'ab"c'])
    assert.throws(() => parseCsv(value), /CSV_/);
  const rows = reviewed();
  rows[0][1] = "reviewId";
  assert.equal(
    evaluateCsv(encode(rows), bound, [bItem]).summary
      .humanDeclaredReviewedItems,
    0,
  );
});
for (const [name, column, value] of [
  ["status", "status", "COMPLETE"],
  ["foreign", "bundleIdentity", "b".repeat(64)],
  ["declaration", "actuallyListened", "FALSE"],
  ["datetime", "reviewedAt", ""],
  ["notes", "notes", ""],
  ["context-only", "listenedStart", "3"],
  ["criterion", "B_missingSpeech", "NOT_CHECKED"],
  ["issue-enum", "A_missingSpeech", "OK"],
])
  test("invalid " + name + " cannot become reviewed", () => {
    const r = reviewed();
    r[1][columns.indexOf(column)] = value;
    const result = evaluateCsv(encode(r), bound, [bItem]);
    assert.equal(result.summary.humanDeclaredReviewedItems, 0);
    assert.equal(result.summary.groups.stratified.counts.invalidOrMissing, 1);
    assert.equal(result.exitCode, 1);
  });
test("duplicate ids, missing rows, unknown columns, foreign rows; disjoint group denominators", () => {
  const r = reviewed();
  r.push(r[1]);
  let result = evaluateCsv(encode(r), bound, [bItem]);
  assert.equal(result.summary.groups.stratified.counts.planned, 1);
  assert.equal(result.summary.groups.stratified.counts.invalidOrMissing, 1);
  const unknown = reviewed();
  unknown[0].push("extra");
  unknown[1].push("preserved");
  result = evaluateCsv(encode(unknown), bound, [bItem]);
  assert.equal(result.summary.humanDeclaredReviewedItems, 1);
  assert.ok(
    result.validation.warnings.includes("UNKNOWN_COLUMN_PRESERVED:extra"),
  );
  unknown.push([...unknown[1]]);
  unknown[2][0] = "foreign";
  result = evaluateCsv(encode(unknown), bound, [bItem]);
  assert.equal(result.exitCode, 1);
  assert.equal(result.validation.foreignRows.length, 1);
});
test("overlap counted as evaluation sample union, not playback or utterance rate", () => {
  const second = { ...bItem, reviewId: "second", kind: "seam" };
  const result = evaluateCsv(encode(reviewed([bItem, second])), bound, [
    bItem,
    second,
  ]);
  assert.equal(result.summary.humanDeclaredReviewedItems, 2);
  assert.equal(result.summary.reviewedEvaluationSampleUnion, 16000);
  assert.equal(result.summary.groups.seam.comparison.denominator, 1);
  assert.equal(result.summary.CER, "NOT_MEASURED");
});
test("point clusters anchored at minimum, not transitive; long/raw-invalid full request indexed once", () => {
  const main = { items: [] };
  const d = (id, start) => ({
    recordId: id,
    requestId: "A-historical-full",
    rawIssues: ["ZERO_DURATION"],
    mappedIssues: [],
    serializedIssues: [],
    mapped: { start: { seconds: start }, end: { seconds: start } },
    geometry: { requestStart: { seconds: 0 }, requestEnd: { seconds: 100 } },
  });
  const ds = [d("a", 5), d("b", 5.8), d("c", 6.6)],
    records = { A: ds.map((x) => ({ ...x, text: "neutral" })), B: [] };
  const p = planTargets(main, records, { A: ds, B: [] }, m);
  assert.equal(p.items.length, 2);
  assert.deepEqual(p.items[0].recordIds, ["a", "b"]);
  assert.equal(
    hint({ requestId: "A-historical-full" }, ds[0], { start: 7, end: 8 }),
    "UNLOCATED",
  );
});
async function prepared() {
  const f = await fixture();
  await runB(f.manifest, {
    runner: stub(
      "1\n00:00:01,000 --> 00:00:02,000\n<script>unsafe</script> " +
        "neutral ".repeat(60) +
        "\n",
    ),
  });
  await legacyFixtureReport(f.manifest, { exportPartial: true });
  const d = await reportRevision(f.manifest, {
    outputRoot: path.join(f.original, "diag"),
    exportPartial: true,
  });
  return {
    f,
    o: {
      manifest: f.manifest,
      diagnostics: d.revision,
      audioRoot: f.root,
      outputRoot: path.join(f.original, "handoff"),
    },
  };
}
test("offline handoff/audio verification, portable copy, mutable annotations, immutable summary, no runtime starts", async () => {
  const { f, o } = await prepared();
  const functions = [
      "spawn",
      "exec",
      "execFile",
      "fork",
      "spawnSync",
      "execSync",
      "execFileSync",
    ],
    saved = functions.map((k) => cp[k]);
  for (const k of functions)
    cp[k] = () => {
      throw Error("PROCESS_DENIED");
    };
  syncBuiltinESMExports();
  try {
    const meta = await prepareReview(o);
    assert.equal(meta.stats.derivedListeningClipFiles, 0);
    assert.equal(meta.readiness, "METADATA_ONLY_NOT_LISTENING_READY");
    const ready = await prepareReview({ ...o, exportListeningAudio: true });
    assert.equal(ready.readiness, "LISTENING_HANDOFF_READY");
    assert.equal(ready.stats.humanDeclaredReviewedItems, 0);
    const old = await fs.readFile(path.join(o.diagnostics, "review-plan.json"));
    assert.deepEqual(
      await fs.readFile(path.join(ready.root, "review-plan.json")),
      old,
    );
    bundleSchema.parse(
      JSON.parse(await fs.readFile(path.join(ready.root, "bundle.json"))),
    );
    bundleFreezeSchema.parse(
      JSON.parse(
        await fs.readFile(path.join(ready.root, "bundle-freeze.json")),
      ),
    );
    const html = await fs.readFile(
      path.join(ready.root, "listening-index.html"),
      "utf8",
    );
    assert.ok(html.includes("&lt;script&gt;unsafe&lt;/script&gt;"));
    assert.ok(!html.includes("<script>"));
    assert.ok(html.includes("neutral ".repeat(60).trim()));
    const csv = path.join(ready.root, "review/content-review.csv"),
      snapshot = await fs.readFile(csv),
      summary = await summarizeReview({
        bundle: ready.root,
        annotations: csv,
        outputRoot: path.join(f.original, "summary"),
      });
    assert.equal(summary.exitCode, 2);
    assert.equal(summary.summary.humanDeclaredReviewedItems, 0);
    assert.deepEqual(
      await fs.readFile(path.join(summary.root, "annotation-snapshot.csv")),
      snapshot,
    );
    const actualItems = JSON.parse(
        await fs.readFile(path.join(ready.root, "items.json")),
      ),
      mockRows = reviewed(actualItems);
    for (const r of mockRows.slice(1))
      r[columns.indexOf("bundleIdentity")] = ready.identity;
    const mockPath = path.join(f.original, "SYNTHETIC-annotations.csv");
    await fs.writeFile(mockPath, encode(mockRows));
    const complete = await summarizeReview({
      bundle: ready.root,
      annotations: mockPath,
      outputRoot: path.join(f.original, "mock-summary"),
    });
    assert.equal(complete.exitCode, 0);
    assert.equal(
      complete.summary.humanDeclaredReviewedItems,
      actualItems.length,
    );
    assert.equal(complete.summary.humanValidated, false);
    assert.equal(complete.summary.machineOnlyReleaseAuthorized, false);
    assert.deepEqual(await fs.readFile(csv), snapshot);
    const edit = "invalid human note preserved";
    await fs.writeFile(csv, edit);
    const rerun = await prepareReview({ ...o, exportListeningAudio: true });
    assert.equal(rerun.reused, true);
    assert.equal(await fs.readFile(csv, "utf8"), edit);
    await fs.unlink(csv);
    assert.equal(
      (await verifyBundle(ready.root)).reviewState,
      "MISSING_NOT_RECREATED",
    );
    await prepareReview({ ...o, exportListeningAudio: true });
    assert.equal(await fs.stat(csv).catch(() => null), null);
    const copy = path.join(f.original, "portable");
    await fs.cp(ready.root, copy, { recursive: true });
    assert.equal((await verifyBundle(copy)).integrity, "passed");
    await fs.appendFile(path.join(copy, "items.json"), " ");
    await assert.rejects(verifyBundle(copy), /CONTENT_CONFLICT/);
  } finally {
    functions.forEach((k, i) => {
      cp[k] = saved[i];
    });
    syncBuiltinESMExports();
  }
});
test("unjudgeable is separate and criteria denominators use the same paired items", () => {
  const rows = reviewed();
  rows[1][columns.indexOf("status")] = "UNJUDGEABLE";
  rows[1][columns.indexOf("overall")] = "UNJUDGEABLE";
  rows[1][columns.indexOf("B_missingSpeech")] = "UNJUDGEABLE";
  const r = evaluateCsv(encode(rows), bound, [bItem]);
  assert.equal(r.exitCode, 0);
  assert.equal(r.summary.groups.stratified.counts.reviewed, 0);
  assert.equal(r.summary.groups.stratified.counts.unjudgeable, 1);
  assert.equal(
    r.summary.groups.stratified.pairedCriteria.missingSpeech.denominator,
    0,
  );
  rows[1][columns.indexOf("reviewedAt")] = "2026-02-31T12:00:00Z";
  assert.equal(
    evaluateCsv(encode(rows), bound, [bItem]).summary
      .humanDeclaredReviewedItems,
    0,
  );
});
test("historical model and full-source audio paths are not read authority", async () => {
  const { f, o } = await prepared();
  for (const name of [
    "model",
    "runtime",
    "vad",
    "library",
    "python",
    "audio.wav",
  ])
    await fs.unlink(path.join(f.original, name));
  assert.equal(
    (await prepareReview({ ...o, exportListeningAudio: true })).readiness,
    "LISTENING_HANDOFF_READY",
  );
});
test("missing WAV blocks; wrong bytes, symlinks and revision mismatch fail closed", async () => {
  const { f, o } = await prepared(),
    m = JSON.parse(await fs.readFile(f.manifest));
  const c = m.chunks[0],
    wav = path.join(f.root, `B/chunks/${c.id}/${c.id}-attempt-1/input.wav`),
    original = await fs.readFile(wav);
  await fs.unlink(wav);
  const missing = await prepareReview({ ...o, exportListeningAudio: true });
  assert.equal(missing.exitCode, 2);
  assert.equal(missing.stats.derivedListeningClipFiles, 0);
  await fs.writeFile(wav, Buffer.from("bad"));
  await assert.rejects(prepareReview(o), /WAV_HASH_MISMATCH/);
  await fs.unlink(wav);
  await fs.symlink(path.join(f.original, "audio.wav"), wav);
  await assert.rejects(prepareReview(o), /SYMLINK|符号链接/);
  await fs.unlink(wav);
  await fs.writeFile(wav, original);
  await assert.rejects(
    prepareReview({ ...o, outputRoot: path.join(f.root, "child") }),
    /OVERLAP/,
  );
  await fs.appendFile(path.join(o.diagnostics, "review-plan.json"), " ");
  await assert.rejects(prepareReview(o), /CONTENT_CONFLICT/);
});
test("cancel cleans unpublished staging; competing creators never overwrite", async () => {
  const { f, o } = await prepared(),
    controller = new AbortController();
  controller.abort();
  await assert.rejects(prepareReview({ ...o, signal: controller.signal }));
  const r = await Promise.allSettled([prepareReview(o), prepareReview(o)]);
  assert.ok(r.some((x) => x.status === "fulfilled"));
  assert.ok((await fs.readdir(o.outputRoot)).every((n) => !n.startsWith(".")));
  const item = r.find((x) => x.status === "fulfilled").value;
  await fs.appendFile(path.join(item.root, "items.json"), "broken");
  await assert.rejects(prepareReview(o), /CONTENT_CONFLICT/);
  assert.ok(f.root);
});
