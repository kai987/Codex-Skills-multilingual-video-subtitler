/* global AbortController */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Buffer } from "node:buffer";
import cp from "node:child_process";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import {
  projectRecord,
  formatProjection,
  validateProjection,
} from "../scripts/lib/representation-grid.mjs";
import {
  coverage,
  localize,
  planWindows,
} from "../scripts/lib/missing-dialogue-localization.mjs";
import {
  parseReference,
  fullComparison,
  textStream,
  compareStreams,
} from "../scripts/lib/historical-reference-text.mjs";
import { hash, json } from "../scripts/lib/content-review-plan.mjs";
import {
  buildRecovery,
  verifyRecovery,
} from "../scripts/lib/bounded-recovery.mjs";
import { mapRaw } from "../packages/video-subtitler/dist/standalone/bounded.js";
import { fixture, stub } from "./helpers/bounded-offline-fixture.mjs";
import { legacyFixtureReport } from "./helpers/legacy-bounded-fixture.mjs";
import { runB } from "../scripts/lib/bounded-asr-ab.mjs";
import { reportRevision } from "../scripts/lib/bounded-report-revision.mjs";
import {
  prepareReview,
  write,
} from "../scripts/lib/bounded-content-review.mjs";
import { attachReference } from "../scripts/lib/historical-reference-review.mjs";

const rawClock = (ms) =>
  `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
function projection(
  startMs,
  endMs,
  localS,
  localE,
  rate = 1000,
  offset = 0,
  sourceEnd = 100,
) {
  const chunk = {
      id: "neutral",
      index: 0,
      inputStart: (startMs * rate) / 1000,
      inputEnd: (endMs * rate) / 1000,
    },
    m = {
      pcm: { sampleRate: rate, frames: rate * 100 },
      audioOffset: offset,
      sourceEnd,
      language: "en",
    },
    content = `1\n${rawClock(localS)} --> ${rawClock(localE)}\nneutral text\n`,
    r = mapRaw(content, hash(content), chunk, rate, offset, sourceEnd)[0];
  return { r, chunk, m, result: projectRecord(r, chunk, m) };
}

for (const [name, s, e, ls, le, status, expected] of [
  ["start inward", 10004, 15004, 0, 1000, "RECOVERED", [10.01, 11]],
  ["end inward", 18008, 20008, 1000, 2000, "RECOVERED", [19.01, 20]],
  ["exact boundary", 10000, 12000, 0, 2000, "UNCHANGED", [10, 12]],
  ["tiny interval", 10004, 10008, 0, 4, "UNRECOVERED", null],
  ["raw 4ms overrun", 10000, 12004, 0, 2008, "UNRECOVERED", null],
  ["large overrun", 10000, 12000, 0, 6000, "UNRECOVERED", null],
  ["both edges", 10004, 12008, 0, 2004, "RECOVERED", [10.01, 12]],
])
  test(name, () => {
    const { result } = projection(s, e, ls, le);
    assert.equal(result.status, status);
    if (expected)
      assert.deepEqual(
        [
          result.recoveredSerialized.start.seconds,
          result.recoveredSerialized.end.seconds,
        ],
        expected,
      );
  });
test("nonzero offset is applied once; non-16000 sample geometry", () => {
  const p = projection(10004, 12008, 0, 2004, 48000, 3);
  assert.equal(p.result.recoveredSerialized.start.seconds, 13.01);
  assert.equal(p.result.recoveredSerialized.end.seconds, 15);
  assert.equal(p.result.geometry.sampleRate, 48000);
});
test("source edge raw legal but mapped outside is not recovered", () =>
  assert.equal(
    projection(10004, 12008, 0, 2004, 1000, 0, 12).result.status,
    "UNRECOVERED",
  ));
test("unknown geometry fails closed", () => {
  const p = projection(0, 1000, 0, 900);
  p.m.pcm.sampleRate = 0;
  assert.throws(() => projectRecord(p.r, p.chunk, p.m), /GEOMETRY/);
});
test("integer enumeration oracle across all millisecond remainders", () => {
  for (let start = 10000; start < 10010; start++)
    for (let end = 12000; end < 12010; end++) {
      const p = projection(start, end, 0, end - start);
      const ls = Math.floor((start + 5) / 10),
        le = Math.floor((end + 5) / 10);
      const legal = [];
      for (let t = 999; t <= 1201; t++)
        if (t * 10 >= start && t * 10 <= end) legal.push(t);
      const expected = [
        ls * 10 < start ? legal[0] : ls,
        le * 10 > end ? legal.at(-1) : le,
      ];
      assert.deepEqual(
        [
          p.result.recoveredSerialized.start.seconds,
          p.result.recoveredSerialized.end.seconds,
        ],
        expected.map((t) => t / 100),
      );
      assert.equal(p.r.rawStart, rawClock(0));
      assert.equal(p.r.rawEnd, rawClock(end - start));
    }
});
test("lossy text is not rescued", () => {
  const p = projection(10004, 12008, 0, 2004);
  p.r.text = "<i>neutral</i>";
  assert.notEqual(projectRecord(p.r, p.chunk, p.m).status, "RECOVERED");
});
test("independent sample fraction oracle at 44100 Hz", () => {
  const rate = 44100,
    chunk = { id: "fraction", index: 0, inputStart: 441001, inputEnd: 882001 };
  const m = {
    pcm: { sampleRate: rate, frames: rate * 40 },
    audioOffset: 0,
    sourceEnd: 40,
    language: "en",
  };
  const text = "1\n00:00:00,000 --> 00:00:01,000\nneutral\n";
  const r = mapRaw(text, hash(text), chunk, rate, 0, 40)[0],
    p = projectRecord(r, chunk, m);
  const numerator = BigInt(chunk.inputStart) * 100n,
    denominator = BigInt(rate);
  const expectedTick = (numerator + denominator - 1n) / denominator;
  assert.equal(p.status, "RECOVERED");
  assert.equal(p.recoveredSerialized.start.seconds, Number(expectedTick) / 100);
  assert.equal(p.recoveredSerialized.end.seconds, 11);
});
test("three actual formats disk reread, malformed format and record mapping", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "grid-formats-"));
  try {
    const rs = [
        {
          recordId: "first",
          sourceStart: 10.01,
          sourceEnd: 11,
          text: "neutral 😀",
          language: "en",
        },
      ],
      formatted = formatProjection(rs, "en"),
      actual = {};
    for (const [f, v] of Object.entries(formatted)) {
      await fs.writeFile(path.join(dir, f), v);
      actual[f] = await fs.readFile(path.join(dir, f), "utf8");
    }
    assert.equal(validateProjection(actual, rs).status, "passed");
    assert.throws(
      () => validateProjection({ ...actual, ass: "[Events]\n" }, rs),
      /COUNT|no dialogue/,
    );
    assert.throws(
      () => validateProjection(actual, [{ ...rs[0], recordId: "different" }]),
      /ORDER/,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

const ref = (id, start, end, text = "abcdef", style = "Default") => ({
  refId: id,
  start,
  end,
  visibleText: text,
  parseStatus: "PARSED",
  style,
});
const rec = (id, s, e, text = "") => ({
  recordId: id,
  sourceStart: s,
  sourceEnd: e,
  text,
});
const edits = (refs, machine) =>
  compareStreams(
    textStream(refs, "R"),
    textStream(machine, "B"),
    "exact-visible-v1",
  );
test("temporal union, repeated records, zero and invalid duration", () => {
  assert.deepEqual(
    coverage(1, 5, [rec("a", 1, 3), rec("b", 2, 4), rec("c", 1, 3)]),
    { recordIds: ["a", "b", "c"], unionSeconds: 3, ratio: 0.75 },
  );
  assert.equal(coverage(1, 5, []).ratio, 0);
  assert.equal(coverage(1, 1, []).ratio, null);
  assert.equal(coverage(null, 2, []).ratio, null);
});
test("perfect full stream, Unicode, Music and whitespace-only", () => {
  const r = [ref("r", 1, 2, "😀猫", "Music"), ref("s", 3, 4, "  ")],
    b = [rec("b", 1, 4, "😀猫  ")],
    l = localize(r, b, edits(r, b), { start: 0, end: 10 });
  assert.ok(l.rows.every((x) => x.matchCount === x.visibleTextLength));
  assert.equal(l.rows[0].style, "Music");
  assert.equal(l.candidates.length, 0);
});
test("P0 P1 diagnostic-only P2 and invalid reference are separate", () => {
  const r = [
      ref("p0", 1, 2),
      ref("p1", 3, 4),
      ref("p2", 5, 6),
      ref("invalid", 7, 7),
      ref("single", 8, 9, "x"),
    ],
    b = [rec("b1", 3, 3.1), rec("b2", 5, 6)],
    l = localize(r, b, edits(r, b), { start: 0, end: 10 });
  assert.deepEqual(
    l.rows.map((x) => x.priority),
    ["P0", "P1", "P2", null, null],
  );
  assert.equal(l.rows[3].localizationClass, "UNLOCATABLE");
  assert.equal(l.candidates.length, 2);
  assert.ok(l.plan.scheduled.every((x) => !x.referenceIds.includes("p2")));
  assert.equal(l.rows[2].deletionCount, 6);
});
test("region transitive 0.5 second merge, beyond boundary separated", () => {
  const r = [
      ref("a", 1, 2),
      ref("b", 2.5, 3),
      ref("c", 3.5, 4),
      ref("d", 4.501, 5),
    ],
    l = localize(r, [], edits(r, []), { start: 0, end: 10 });
  assert.equal(l.regions.length, 2);
  assert.deepEqual(l.regions[0].referenceIds, ["a", "b", "c"]);
});
test("repeated phrase edit path ambiguity stays explicit", () => {
  const r = [ref("a", 1, 2, "abcabc"), ref("b", 3, 4, "abcabc")],
    b = [rec("b", 1, 4, "abcabc")],
    l = localize(r, b, edits(r, b), { start: 0, end: 10 });
  assert.ok(l.rows.every((x) => x.repeatedTextAlignmentMayBeAmbiguous));
  assert.equal(
    l.rows.reduce((n, r) => n + r.deletionCount, 0),
    6,
  );
});
const region = (i, s, e) => ({
  regionId: "region-" + String(i).padStart(2, "0"),
  sourceStart: s,
  sourceEnd: e,
  priority: "P0",
  p0ReferenceCount: 1,
  referenceIds: ["r" + i],
  deletionCodepoints: 6,
  temporalCoverageRatio: 0,
});
test("long region uses saved cue boundaries; unsplittable remainder deferred", () => {
  const r = region(1, 1, 80),
    refs = [
      ref("a", 1, 20),
      ref("b", 20, 40),
      ref("c", 40, 60),
      ref("d", 60, 80),
    ],
    p = planWindows([r], refs, [], { start: 0, end: 90 });
  assert.ok(p.scheduled.every((x) => x.seconds <= 30));
  assert.deepEqual(
    p.scheduled.map((x) => x.coreEnd),
    [20, 40, 60, 80],
  );
  const fail = planWindows([r], [ref("long", 1, 80)], [], {
    start: 0,
    end: 90,
  });
  assert.equal(fail.deferred[0].reason, "NO_SAVED_LEGAL_SPLIT_BOUNDARY");
  assert.equal(fail.scheduled.length, 0);
});
test("window and seconds budgets; deterministic deferred ordering", () => {
  const regions = Array.from({ length: 15 }, (_, i) =>
    region(i, 10 + i * 10, 11 + i * 10),
  );
  const p = planWindows(regions, [], [], { start: 0, end: 200 });
  assert.equal(p.scheduled.length, 12);
  assert.equal(p.deferred.length, 3);
  assert.deepEqual(
    p,
    planWindows([...regions].reverse(), [], [], { start: 0, end: 200 }),
  );
  const long = regions.map((r, i) => ({
      ...r,
      sourceStart: i * 40 + 1,
      sourceEnd: i * 40 + 29,
    })),
    budget = planWindows(long, [], [], { start: 0, end: 700 });
  assert.equal(budget.plannedSeconds, 180);
  assert.equal(budget.plannedWindows, 6);
  assert.ok(budget.deferred.every((r) => r.reason === "AUDIO_SECONDS_BUDGET"));
});
test("full comparison raw streams retain original order and distance", () => {
  const r = [ref("a", 0, 2, "abc😀")],
    a = [rec("a", 0, 1, "a b")],
    b = [rec("b", 0, 1, "abc")],
    before = json({ a, b, r }),
    first = fullComparison(a, b, r);
  localize(r, b, edits(r, b), { start: 0, end: 10 });
  assert.equal(json({ a, b, r }), before);
  assert.deepEqual(fullComparison(a, b, r), first);
});

async function referenceFixture(old, manifest, root) {
  const parent = JSON.parse(
      await fs.readFile(path.join(old.root, "bundle.json")),
    ),
    experiment = await fs.readFile(manifest),
    reference = Buffer.from(
      "[Events]\nFormat: Start, End, Style, Text\nDialogue: 0:00:01.00,0:00:02.00,Default,neutral\n",
    ),
    parsed = parseReference(reference),
    humanBaseline = Buffer.from(
      json({
        status: "ready",
        cues: parsed.records.map((r) => ({
          start: r.start,
          end: r.end,
          text: r.visibleText,
          style: r.style.toLowerCase(),
        })),
      }),
    );
  const blobs = {
    reference,
    humanBaseline,
    finalization: Buffer.from(
      json({
        status: "needs-review",
        finalizationMethod: "none",
        baseSubtitlePackageHash: hash(humanBaseline),
        humanReviewedBaseline: {
          authority: "user-confirmed-human-review",
          sourceFileSha256: hash(reference),
          sourceFileSize: reference.length,
          cueCount: 1,
          sourceReadOnlyVerified: true,
        },
      }),
    ),
    reviewPackage: Buffer.from(
      json({
        sourceFingerprint: {
          sha256: JSON.parse(experiment).baseline.source.sha256,
        },
        baseSubtitlePackageHash: hash(humanBaseline),
        items: [],
      }),
    ),
    experiment,
  };
  assert.equal(parent.payload.input.manifest, hash(experiment));
  const dir = path.join(root, "ref-input");
  await fs.mkdir(dir);
  const entries = {};
  for (const [role, b] of Object.entries(blobs)) {
    entries[role] = { path: role + ".data", size: b.length, sha256: hash(b) };
    await fs.writeFile(path.join(dir, entries[role].path), b);
  }
  await fs.writeFile(
    path.join(dir, "index.json"),
    json({
      version: "reference-inputs-v1",
      inventoryAuthority: "BYTE_INVENTORY_ONLY_NOT_NEW_HUMAN_CERTIFICATION",
      files: entries,
    }),
  );
  return attachReference({
    bundle: old.root,
    reference: path.join(dir, "reference.data"),
    referenceEvidence: path.join(dir, "index.json"),
    outputRoot: path.join(root, "ref-out"),
  });
}
test("complete offline build, portable verify, reuse, immutable inputs, guards, tamper, cancellation and atomic failure", async () => {
  const f = await fixture();
  try {
    await runB(f.manifest, {
      runner: stub("1\n00:00:01,000 --> 00:00:02,000\nneutral\n"),
    });
    await legacyFixtureReport(f.manifest, { exportPartial: true });
    const d = await reportRevision(f.manifest, {
        outputRoot: path.join(f.original, "diag"),
        exportPartial: true,
      }),
      old = await prepareReview({
        manifest: f.manifest,
        diagnostics: d.revision,
        audioRoot: f.root,
        outputRoot: path.join(f.original, "listening"),
        exportListeningAudio: true,
      }),
      r = await referenceFixture(old, f.manifest, f.original),
      o = {
        diagnostics: d.revision,
        referenceBundle: r.root,
        outputRoot: path.join(f.original, "new"),
        exportRecoveredSubtitles: true,
      };
    const replacements = [];
    for (const [obj, keys] of [
      [
        cp,
        [
          "spawn",
          "exec",
          "execFile",
          "fork",
          "spawnSync",
          "execSync",
          "execFileSync",
        ],
      ],
      [http, ["get", "request"]],
      [https, ["get", "request"]],
      [globalThis, ["fetch"]],
    ])
      for (const k of keys) {
        replacements.push([obj, k, obj[k]]);
        obj[k] = () => {
          throw Error("FORBIDDEN_CAPABILITY");
        };
      }
    syncBuiltinESMExports();
    try {
      const first = await buildRecovery(o);
      assert.equal(first.integrity, "passed");
      assert.equal(first.operations.newASRRequests, 0);
      assert.equal((await buildRecovery(o)).reused, true);
      const frozenInputPaths = [
        path.join(d.revision, "B/subtitles/primary-minimal.partial.ass"),
        path.join(r.root, "review/content-review.csv"),
        path.join(r.root, "reference/source.ass"),
      ];
      const frozenInputHashes = await Promise.all(
        frozenInputPaths.map(async (p) => hash(await fs.readFile(p))),
      );
      const relocated = path.join(f.original, "relocated");
      await fs.cp(first.root, relocated, { recursive: true });
      assert.equal((await verifyRecovery(relocated)).identity, first.identity);
      await fs.appendFile(
        path.join(relocated, "localization/local-asr-plan.csv"),
        "tamper",
      );
      await assert.rejects(verifyRecovery(relocated), /FREEZE/);
      const controller = new AbortController();
      controller.abort();
      await assert.rejects(
        buildRecovery({
          ...o,
          outputRoot: path.join(f.original, "cancelled"),
          signal: controller.signal,
        }),
      );
      const midway = new AbortController(),
        midRoot = path.join(f.original, "mid-cancel");
      await assert.rejects(
        buildRecovery({
          ...o,
          outputRoot: midRoot,
          signal: midway.signal,
          write: async (stage, p, v) => {
            await write(stage, p, v);
            midway.abort();
          },
        }),
      );
      assert.deepEqual(await fs.readdir(midRoot), []);
      for (const failure of ["ass", "srt", "vtt"]) {
        const dir = path.join(f.original, "failure-" + failure);
        await assert.rejects(
          buildRecovery({
            ...o,
            outputRoot: dir,
            write: async (stage, p, v) =>
              write(stage, p, p.endsWith("." + failure) ? "malformed" : v),
          }),
          /DERIVATION|COUNT|TEXT/,
        );
        assert.deepEqual(await fs.readdir(dir), []);
      }
      await assert.rejects(
        buildRecovery({ ...o, outputRoot: path.join(r.root, "nested") }),
        /OVERLAP/,
      );
      await assert.rejects(
        buildRecovery({ ...o, exportRecoveredSubtitles: false }),
        /EXPLICIT/,
      );
      assert.deepEqual(
        await Promise.all(
          frozenInputPaths.map(async (p) => hash(await fs.readFile(p))),
        ),
        frozenInputHashes,
      );
    } finally {
      for (const [obj, k, v] of replacements) obj[k] = v;
      syncBuiltinESMExports();
    }
  } finally {
    await fs.rm(f.original, { recursive: true, force: true });
  }
});
