/* global AbortController */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { Buffer } from "node:buffer";
import cp from "node:child_process";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { fixture, stub } from "./helpers/bounded-offline-fixture.mjs";
import { legacyFixtureReport } from "./helpers/legacy-bounded-fixture.mjs";
import { runB } from "../scripts/lib/bounded-asr-ab.mjs";
import { reportRevision } from "../scripts/lib/bounded-report-revision.mjs";
import {
  prepareReview,
  verifyBundle,
  summarizeReview,
  files,
} from "../scripts/lib/bounded-content-review.mjs";
import {
  attachReference,
  bindReference,
  referenceBundleSchema,
} from "../scripts/lib/historical-reference-review.mjs";
import {
  parseReference,
  visibleAss,
  associateReference,
  textStream,
  compareStreams,
  textRules,
  fullComparison,
} from "../scripts/lib/historical-reference-text.mjs";
import {
  referenceSchema,
  schemaColumns,
  referenceUses,
  criteria,
  issueValues,
  statuses,
  overallValues,
  template,
  parseCsv,
  csvCell,
  evaluateCsv,
} from "../scripts/lib/content-review-input.mjs";
import { reviewGuide } from "../scripts/lib/historical-reference-guide.mjs";
import { hash, json } from "../scripts/lib/content-review-plan.mjs";

const ass = (text) =>
  Buffer.from(
    `\uFEFF[Script Info]\r\n; preserve comment\r\n[Events]\r\nFormat: Start, End, Style, Text\r\nDialogue: 0:00:01.00,0:00:02,00,Default,${text}\r\nDialogue: 0:00:03.00,0:00:04.00,Music,♪ ${text} ♪\r\n`,
  );
const raw = (text, id = "neutral") => ({
  recordId: id,
  text,
  order: 1,
  requestId: "neutral-request",
});
const stream = (text) => textStream([raw(text)], "A");
const indexFor = (blobs) =>
  Buffer.from(
    json({
      version: "reference-inputs-v1",
      inventoryAuthority: "BYTE_INVENTORY_ONLY_NOT_NEW_HUMAN_CERTIFICATION",
      files: Object.fromEntries(
        Object.entries(blobs).map(([role, b]) => [
          role,
          {
            path: role === "reference" ? "original.ass" : role + ".json",
            size: b.length,
            sha256: hash(b),
          },
        ]),
      ),
    }),
  );
function evidence(parent, experiment, text = "neutral") {
  const reference = ass(text),
    parsed = parseReference(reference);
  const humanBaseline = Buffer.from(
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
          cueCount: 2,
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
        items: [{ neutral: true }],
      }),
    ),
    experiment,
  };
  return { blobs, index: indexFor(blobs), parent };
}
const machine = Buffer.from(
  json({
    baseline: { source: { sha256: "a".repeat(64) } },
    planHash: "b".repeat(64),
    pcm: {
      sampleRate: 16000,
      frames: 80000,
      pcmHash: "c".repeat(64),
      blockAlign: 2,
    },
    audioOffset: 5,
  }),
);
const parent = {
  payload: {
    input: { manifest: hash(machine), plan: "b".repeat(64) },
    pcm: JSON.parse(machine).pcm,
    audioOffset: 5,
  },
};

test("ASS preserves bytes, comments, BOM, Music, repeated records and unique comma normalization", () => {
  const bytes = ass("同じ,本文\\N続き\\h語"),
    before = hash(bytes),
    p = parseReference(bytes);
  assert.equal(hash(bytes), before);
  assert.equal(p.records.length, 2);
  assert.deepEqual(p.audit.styles, { Default: 1, Music: 1 });
  assert.equal(p.audit.normalizations.length, 1);
  assert.equal(p.audit.normalizations[0].original, "0:00:02,00");
  assert.equal(p.records[0].visibleText, "同じ,本文\n続き 語");
  assert.notEqual(p.records[0].refId, p.records[1].refId);
  assert.ok(p.records[0].originalLine.includes("2,00"));
});
test("Format-bound clocks never repair ambiguous columns or comma text globally", () => {
  for (const bytes of [
    Buffer.from("[Events]\nDialogue: 0,1,x,hello"),
    Buffer.from(
      "[Events]\nFormat: Start, Text, End, Style\nDialogue: 0:00:01.00,x,0:00:02.00,Default",
    ),
    Buffer.from(
      "[Events]\nFormat: Start,End,Style,Text\nDialogue: 0:00:01,000,0:00:02.00,Default,x",
    ),
  ]) {
    const p = parseReference(bytes);
    assert.equal(p.records.length, 1);
    assert.equal(p.records[0].parseStatus, "UNPARSEABLE");
    assert.equal(p.audit.normalizations.length, 0);
  }
});
test("literal visible whitespace, Unicode maps, known override and unknown drawing are explicit", () => {
  const p = visibleAss("  {\\an8}猫\\n犬\\h😀e\u0301  ");
  assert.equal(p.text, "  猫\n犬 😀e\u0301  ");
  assert.equal(p.warnings.length, 0);
  for (const q of p.points) assert.ok(q.rawEnd > q.rawStart);
  for (const s of ["{\\p1}m 0 0 l 1 1", "{\\mystery}word", "{\\i1", "\\x"])
    assert.ok(visibleAss(s).warnings.length);
  assert.throws(
    () => parseReference(Buffer.from([0xff])),
    /encoded|encoding|valid/iu,
  );
});
test("saved provenance binds hashes, size, source media, PCM, count and every cue", () => {
  const e = evidence(parent, machine);
  const b = bindReference(e.index, e.blobs, parent).binding;
  assert.equal(b.historicalPackageStatus, "ready");
  assert.equal(b.historicalFinalizationStatus, "needs-review");
  assert.equal(b.historicalAdditionalReviewItems, 1);
  assert.equal(b.referenceIsValidatedGold, false);
  for (const role of Object.keys(e.blobs)) {
    const bad = {
      ...e.blobs,
      [role]: Buffer.concat([e.blobs[role], Buffer.from(" ")]),
    };
    assert.throws(() => bindReference(e.index, bad, parent), /INDEX_BYTES/);
  }
  const wrong = { ...e.blobs, reference: ass("neutraL") };
  assert.equal(wrong.reference.length, e.blobs.reference.length);
  assert.throws(
    () => bindReference(indexFor(wrong), wrong, parent),
    /AUTHORITY_MISMATCH/,
  );
  for (const [role, change, reason] of [
    [
      "reviewPackage",
      (j) => {
        j.sourceFingerprint.sha256 = "d".repeat(64);
      },
      /SOURCE_MISMATCH/,
    ],
    [
      "reviewPackage",
      (j) => {
        j.baseSubtitlePackageHash = "d".repeat(64);
      },
      /BASE_BYTES/,
    ],
    [
      "finalization",
      (j) => {
        j.humanReviewedBaseline.sourceFileSize++;
      },
      /AUTHORITY/,
    ],
  ]) {
    const j = JSON.parse(e.blobs[role]);
    change(j);
    const bs = { ...e.blobs, [role]: Buffer.from(json(j)) };
    assert.throws(() => bindReference(indexFor(bs), bs, parent), reason);
  }
  assert.throws(
    () =>
      bindReference(e.index, e.blobs, {
        payload: { ...parent.payload, audioOffset: 6 },
      }),
    /TIMEBASE/,
  );
  assert.throws(
    () =>
      bindReference(e.index, e.blobs, {
        payload: {
          ...parent.payload,
          pcm: { ...parent.payload.pcm, frames: 1 },
        },
      }),
    /PCM/,
  );
});
test("same content under another indexed name is accepted; filenames never grant authority", () => {
  const e = evidence(parent, machine),
    index = JSON.parse(e.index);
  index.files.reference.path = "renamed(1).ass";
  assert.equal(
    bindReference(Buffer.from(json(index)), e.blobs, parent).binding
      .sourceFileSha256,
    hash(e.blobs.reference),
  );
});
test("source-time-only associations preserve full long cue and separate context and unlocated", () => {
  const records = [
      { refId: "long", start: 11, end: 19 },
      { refId: "context", start: 9, end: 10 },
      { refId: "invalid", start: 12, end: 12 },
    ],
    items = [
      {
        reviewId: "one",
        start: 12,
        end: 13,
        bounds: { playbackStart: 9, playbackEnd: 15 },
      },
    ];
  const before = json(items),
    map = associateReference(items, records);
  assert.equal(json(items), before);
  assert.deepEqual(
    map[0].references.map((r) => r.label),
    ["EVALUATION_OVERLAP", "PLAYBACK_CONTEXT_ONLY"],
  );
  assert.ok(map[0].references.every((r) => r.wholeRecord && !r.textLocalized));
});
test("stream concatenation keeps invalid-time text, repeats, Unicode and code-point origins", () => {
  const a = [
    raw("😀e\u0301\n", "one"),
    { ...raw("😀", "two"), sourceStart: 5, sourceEnd: 5 },
  ];
  const s = textStream(a, "A");
  assert.equal(s.text, "😀e\u0301\n😀");
  assert.equal(s.points.length, 5);
  assert.equal(s.points[4].recordId, "two");
  assert.equal(s.points[4].recordPosition, 0);
  assert.throws(() => textStream([a[0], a[0]], "A"), /DUPLICATE/);
});
function oracle(a, b) {
  const x = Array.from(a),
    y = Array.from(b);
  let row = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 0; i < x.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < y.length; j++)
      next.push(
        Math.min(row[j] + Number(x[i] !== y[j]), row[j + 1] + 1, next[j] + 1),
      );
    row = next;
  }
  return row[y.length];
}
test("deterministic Unicode edit path agrees with independent row oracle and reconstructs both streams", () => {
  const values = [
    "a",
    "b",
    "ab",
    "ba",
    "aba",
    "aab",
    "日本",
    "😀e\u0301",
    "é",
    "e\u0301",
    " ",
    "aa",
  ];
  for (const a of values)
    for (const b of [...values, ""]) {
      const r = compareStreams(stream(a), stream(b), "exact-visible-v1");
      assert.equal(r.distance, oracle(a, b));
      assert.equal(
        r.edits.map((e) => e.reference?.character ?? "").join(""),
        a,
      );
      assert.equal(r.edits.map((e) => e.machine?.character ?? "").join(""), b);
      assert.equal(r.M + r.S + r.D, Array.from(a).length);
      assert.equal(r.M + r.S + r.I, Array.from(b).length);
      assert.deepEqual(
        r,
        compareStreams(stream(a), stream(b), "exact-visible-v1"),
      );
    }
  assert.deepEqual(
    compareStreams(stream("ab"), stream("ba"), "exact-visible-v1").edits.map(
      (e) => e.op,
    ),
    ["S", "S"],
  );
});
test("whitespace-only removes fixed White_Space and never BOM, zero-width, case, punctuation or kana", () => {
  const a = "あ \n\u0085\u00a0\u3000😀",
    b = "あ😀";
  assert.equal(
    compareStreams(stream(a), stream(b), "whitespace-only-v1").distance,
    0,
  );
  for (const [a, b] of [
    ["A", "a"],
    ["カ", "か"],
    ["。", ""],
    ["\ufeffx", "x"],
    ["\u200bx", "x"],
    ["é", "e\u0301"],
  ])
    assert.ok(
      compareStreams(stream(a), stream(b), "whitespace-only-v1").distance > 0,
    );
});
test("empty, lost text and resource caps are null NOT_COMPUTABLE; ratios can exceed 1", () => {
  for (const [r, m, cap] of [
    [stream(""), stream("a"), 100],
    [stream(" "), stream("a"), 100],
    [{ ...stream("a"), complete: false }, stream("b"), 100],
    [stream("aaa"), stream("bbb"), 4],
  ]) {
    const x = compareStreams(r, m, "whitespace-only-v1", cap);
    assert.equal(x.status, "NOT_COMPUTABLE");
    assert.equal(x.rawReferenceEditRatio, null);
  }
  assert.ok(
    compareStreams(stream("a"), stream("zzzz"), "exact-visible-v1")
      .rawReferenceEditRatio > 1,
  );
  assert.throws(
    () => compareStreams(stream("x"), stream("y"), "NFKC"),
    /UNKNOWN/,
  );
});
test("full raw comparison includes all Music and original request repetitions without item inflation", () => {
  const c = fullComparison(
    [raw("a")],
    [raw("a", "one"), raw("a", "two")],
    parseReference(ass("a")).records,
  );
  assert.equal(c.streams.B.text, "aa");
  assert.equal(c.streams.R.recordCount, 2);
  assert.equal(c.comparison.rows.length, 4);
  assert.equal(c.comparison.comparisonKind, "FULL_RAW_TO_HISTORICAL_REFERENCE");
  assert.equal(c.comparison.referenceIsValidatedGold, false);
});
test("portable Japanese guide derives every enum/column from actual schema", () => {
  const guide = reviewGuide();
  for (const s of [
    ...schemaColumns(referenceSchema),
    ...referenceUses,
    ...criteria,
    ...issueValues,
    ...statuses,
    ...overallValues,
  ])
    assert.ok(guide.includes(s), s);
  assert.ok(guide.includes("source 秒"));
  assert.ok(guide.includes("終了1"));
  assert.ok(guide.includes("validated Gold"));
});

test("offline reference attach, frozen copy parity, portable verify, CSV errors and no runtime capabilities", async () => {
  const f = await fixture();
  try {
    await runB(f.manifest, {
      runner: stub("1\n00:00:01,000 --> 00:00:02,000\nneutral\n"),
    });
    await legacyFixtureReport(f.manifest, { exportPartial: true });
    const d = await reportRevision(f.manifest, {
      outputRoot: path.join(f.original, "diag"),
      exportPartial: true,
    });
    const old = await prepareReview({
      manifest: f.manifest,
      diagnostics: d.revision,
      audioRoot: f.root,
      outputRoot: path.join(f.original, "parent"),
      exportListeningAudio: true,
    });
    const oldBefore = json(await files(old.root)),
      oldCsv = await fs.readFile(
        path.join(old.root, "review/content-review.csv"),
      );
    const parent = JSON.parse(
        await fs.readFile(path.join(old.root, "bundle.json")),
      ),
      e = evidence(
        parent,
        await fs.readFile(f.manifest),
        "<script>neutral</script>",
      );
    const input = path.join(f.original, "reference-inputs");
    await fs.mkdir(input);
    const ix = JSON.parse(e.index);
    for (const [role, v] of Object.entries(ix.files))
      await fs.writeFile(path.join(input, v.path), e.blobs[role]);
    await fs.writeFile(path.join(input, "REFERENCE_INPUTS.json"), e.index);
    const o = {
      bundle: old.root,
      reference: path.join(input, "original.ass"),
      referenceEvidence: path.join(input, "REFERENCE_INPUTS.json"),
      outputRoot: path.join(f.original, "reference-output"),
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
          throw Error("CAPABILITY_DENIED");
        };
      }
    syncBuiltinESMExports();
    try {
      const r = await attachReference(o);
      assert.equal(r.exitCode, 0);
      assert.equal(r.readiness, "REFERENCE_ASSISTED_HANDOFF_READY");
      assert.equal(r.operations.newListeningClipGenerations, 0);
      referenceBundleSchema.parse(
        JSON.parse(await fs.readFile(path.join(r.root, "bundle.json"))),
      );
      const items = JSON.parse(
          await fs.readFile(path.join(r.root, "items.json")),
        ),
        csv = path.join(r.root, "review/content-review.csv"),
        original = await fs.readFile(csv),
        cols = schemaColumns(referenceSchema);
      assert.ok(original.toString().includes("NOT_DECLARED"));
      assert.ok(!oldCsv.toString().includes("referenceUse"));
      for (const f of (await files(old.root)).filter((f) =>
        /^(raw\/|audio\/|items.json|audio-map.json|review-plan.json|targeted-plan.json)/u.test(
          f.path,
        ),
      ))
        assert.deepEqual(
          await fs.readFile(path.join(r.root, f.path)),
          await fs.readFile(path.join(old.root, f.path)),
        );
      assert.notEqual(
        (await fs.stat(path.join(r.root, items[0].audio.path))).ino,
        (await fs.stat(path.join(old.root, items[0].audio.path))).ino,
      );
      const html = await fs.readFile(
        path.join(r.root, "listening-index.html"),
        "utf8",
      );
      assert.ok(!html.includes("<script>"));
      assert.ok(html.includes("&lt;script&gt;neutral&lt;/script&gt;"));
      assert.ok(!html.includes("<details open"));
      const sum = async () =>
        summarizeReview({
          bundle: r.root,
          annotations: csv,
          outputRoot: path.join(f.original, "summaries"),
        });
      assert.equal((await sum()).exitCode, 2);
      const rows = parseCsv(original.toString());
      for (let n = 1; n < rows.length; n++) {
        const item = items[n - 1],
          values = Object.fromEntries(cols.map((k, i) => [k, rows[n][i]]));
        Object.assign(values, {
          status: "UNJUDGEABLE",
          reviewedAt: "2030-01-02T13:45:00+09:00",
          actuallyListened: "TRUE",
          listenedStart: String(item.start),
          listenedEnd: String(item.end),
          overall: "UNJUDGEABLE",
          notes: "SYNTHETIC ONLY",
        });
        for (const s of ["A", "B"])
          for (const c of criteria) values[s + "_" + c] = "UNJUDGEABLE";
        rows[n] = cols.map((k) => values[k]);
      }
      const encode = () =>
        rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
      await fs.writeFile(csv, encode());
      const invalid = await sum();
      assert.equal(invalid.exitCode, 1);
      assert.equal(invalid.validation.valid, false);
      assert.deepEqual(
        await fs.readFile(path.join(invalid.root, "annotation-snapshot.csv")),
        await fs.readFile(csv),
      );
      for (const row of rows.slice(1))
        row[cols.indexOf("referenceUse")] = "UNKNOWN";
      await fs.writeFile(csv, encode());
      const done = await sum();
      assert.equal(done.exitCode, 0);
      assert.ok(done.summary.declaredListenedEvaluationSampleUnion > 0);
      assert.equal(done.summary.contentJudgeableEvaluationSampleUnion, 0);
      assert.equal(done.summary.humanValidated, false);
      assert.equal((await sum()).identity, done.identity);
      const before = await fs.readFile(csv);
      assert.equal((await attachReference(o)).reused, true);
      assert.deepEqual(await fs.readFile(csv), before);
      await fs.writeFile(csv, '"broken');
      assert.equal((await sum()).exitCode, 1);
      await verifyBundle(r.root);
      assert.deepEqual(await fs.readFile(csv), Buffer.from('"broken'));
      await fs.unlink(csv);
      assert.equal(
        (await attachReference(o)).reviewState,
        "MISSING_NOT_RECREATED",
      );
      const portable = path.join(f.original, "portable");
      await fs.cp(r.root, portable, { recursive: true });
      assert.equal((await verifyBundle(portable)).identity, r.identity);
      await fs.appendFile(path.join(portable, "reference/source.ass"), " ");
      await assert.rejects(verifyBundle(portable), /CONTENT_CONFLICT/);
      await assert.rejects(
        attachReference({ ...o, outputRoot: path.join(old.root, "nested") }),
        /OVERLAP/,
      );
      const link = path.join(input, "link.ass");
      await fs.symlink(o.reference, link);
      await assert.rejects(
        attachReference({ ...o, reference: link }),
        /SYMLINK|符号链接/,
      );
      await fs.unlink(link);
      const wrong = path.join(input, "same-size-wrong.ass");
      await fs.writeFile(
        wrong,
        Buffer.from(e.blobs.reference.toString().replace("neutral", "neutraL")),
      );
      await assert.rejects(
        attachReference({ ...o, reference: wrong }),
        /REFERENCE_INDEX_MISMATCH/,
      );
      const originalIndex = await fs.readFile(o.referenceEvidence);
      const unsafeIndex = JSON.parse(originalIndex);
      unsafeIndex.files.reference.path = "../outside.ass";
      await fs.writeFile(o.referenceEvidence, json(unsafeIndex));
      await assert.rejects(attachReference(o));
      await fs.writeFile(o.referenceEvidence, originalIndex);
      const failureRoot = path.join(f.original, "write-failure");
      const open = fs.open;
      fs.open = async (p, ...args) => {
        if (
          String(p).includes(failureRoot) &&
          String(p).endsWith("reference/source.ass")
        )
          throw Error("SYNTHETIC_WRITE_FAILURE");
        return open(p, ...args);
      };
      try {
        await assert.rejects(
          attachReference({ ...o, outputRoot: failureRoot }),
          /SYNTHETIC_WRITE_FAILURE/,
        );
      } finally {
        fs.open = open;
      }
      assert.deepEqual(await fs.readdir(failureRoot), []);
      const controller = new AbortController();
      controller.abort();
      await assert.rejects(
        attachReference({
          ...o,
          outputRoot: path.join(f.original, "cancelled"),
          signal: controller.signal,
        }),
        /abort/iu,
      );
      const concurrent = {
        ...o,
        outputRoot: path.join(f.original, "concurrent"),
      };
      const two = await Promise.allSettled([
        attachReference(concurrent),
        attachReference(concurrent),
      ]);
      assert.ok(two.some((r) => r.status === "fulfilled"));
      assert.equal(json(await files(old.root)), oldBefore);
      assert.deepEqual(
        await fs.readFile(path.join(old.root, "review/content-review.csv")),
        oldCsv,
      );
    } finally {
      for (const [obj, k, v] of replacements) obj[k] = v;
      syncBuiltinESMExports();
    }
  } finally {
    await fs.rm(f.original, { recursive: true, force: true });
  }
});

test("v1 CSV stays readable and invalid CSV exits 1 independently of reference support", () => {
  const item = {
      reviewId: "one",
      kind: "stratified",
      start: 1,
      end: 2,
      bounds: {
        playbackStart: 0,
        playbackEnd: 3,
        evaluationStartSample: 16000,
        evaluationEndSample: 32000,
      },
      audioStatus: "READY",
    },
    b = { identity: "a".repeat(64), pcm: { sampleRate: 16000 } };
  assert.equal(
    evaluateCsv(template([item], b.identity), b, [item]).exitCode,
    2,
  );
  assert.equal(evaluateCsv('"invalid', b, [item]).exitCode, 1);
  const csv = template([item], b.identity, referenceSchema);
  assert.equal(
    evaluateCsv(csv, { ...b, annotationSchema: referenceSchema }, [item])
      .exitCode,
    2,
  );
  assert.ok(textRules.maximumCells > 10000000);
});
