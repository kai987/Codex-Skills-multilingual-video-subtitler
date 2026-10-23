/** Offline, separate shadow output. No model invocation or reference input. */
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { verifyLexicalComparison } from "./run-lexical-risk-comparison.mjs";
import { buildShortDialogueCandidate } from "./lib/short-dialogue-candidate.mjs";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { safePath } from "../packages/video-subtitler/dist/standalone/recovery.js";
import {
  formats,
  serializeRecords,
} from "../packages/video-subtitler/dist/standalone/bounded.js";
import { durable } from "./lib/bounded-asr-ab.mjs";
const json = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const put = (r, n, v) => durable(path.join(r, n), v, true);
async function replay(source) {
  await verifyLexicalComparison(source);
  const p = await json(path.join(source, "plan.json")),
    r = await json(path.join(source, "result.json"));
  const sources = r.sources.map((s) => {
    const sp = p.sources.find((x) => x.id === s.id);
    assert(sp, "MISSING_SOURCE");
    assert.deepEqual(s.baseline, sp.baseline);
    return {
      id: s.id,
      ...buildShortDialogueCandidate(
        s.baseline,
        p.windows.filter((w) => w.sourceId === s.id).map((w) => w.target),
        s.decisions.flatMap((d) => d.evidence),
        sp.duration,
      ),
    };
  });
  return {
    version: "short-dialogue-shadow-replay-v1",
    sources,
    newInference: 0,
    referenceUsed: false,
    qualityStatus: "needs-review",
    automaticPromotionAllowed: false,
    preferredOutputs: [],
  };
}
function serialize(rows) {
  return serializeRecords(
    rows.map((r, i) => ({
      recordId: r.id,
      order: i + 1,
      sourceStart: r.start,
      sourceEnd: r.end,
      text: r.text,
      issues: [],
    })),
    "ja",
  );
}
function exportsFor(r) {
  return r.sources.flatMap((s) =>
    ["baseline", "candidate"].map((kind) => ({
      stem: `${s.id}.${kind}.needs-review`,
      out: serialize(s[kind]),
    })),
  );
}
export async function createShortCandidate(source, output) {
  source = await fs.realpath(source);
  const parent = path.resolve(output);
  await safePath(parent, true);
  const p = await json(path.join(source, "plan.json"));
  for (const input of [source, ...p.sources.map((s) => s.task)]) {
    const real = await fs.realpath(input);
    assert(
      parent !== real && !parent.startsWith(real + path.sep),
      "OUTPUT_INSIDE_SOURCE",
    );
  }
  const result = await replay(source);
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, "short-shadow-"));
  await put(root, "result.json", result);
  const names = ["result.json"];
  for (const { stem, out } of exportsFor(result))
    for (const [ext, bytes] of Object.entries(out.files)) {
      const name = `${stem}.${ext}`;
      await fs.writeFile(path.join(root, name), bytes, { flag: "wx" });
      names.push(name);
    }
  const software = [
    import.meta.filename,
    ...[
      "short-dialogue-candidate.mjs",
      "dialogue-association-diagnostic.mjs",
    ].map((n) => path.join(import.meta.dirname, "lib", n)),
  ];
  await put(root, "machine-freeze.json", {
    at: new Date().toISOString(),
    source,
    sourceFreezeHash: await fileHash(path.join(source, "machine-freeze.json")),
    software: await Promise.all(
      software.map(async (file) => ({ file, sha256: await fileHash(file) })),
    ),
    files: Object.fromEntries(
      await Promise.all(
        names.map(async (name) => [
          name,
          await fileHash(path.join(root, name)),
        ]),
      ),
    ),
  });
  return verifyShortCandidate(root);
}
export async function verifyShortCandidate(root) {
  await safePath(root);
  const f = await json(path.join(root, "machine-freeze.json"));
  for (const [name, h] of Object.entries(f.files)) {
    assert(
      name === "result.json" ||
        /^source-\d+\.(baseline|candidate)\.needs-review\.(ass|srt|vtt)$/u.test(
          name,
        ),
      "UNSAFE_INVENTORY",
    );
    await safePath(path.join(root, name));
    assert.equal(await fileHash(path.join(root, name)), h, `CHANGED:${name}`);
  }
  for (const s of f.software)
    assert.equal(await fileHash(s.file), s.sha256, "SOFTWARE_CHANGED");
  assert.equal(
    await fileHash(path.join(f.source, "machine-freeze.json")),
    f.sourceFreezeHash,
  );
  const expected = await replay(f.source);
  assert.deepEqual(
    await json(path.join(root, "result.json")),
    expected,
    "REPLAY_CHANGED",
  );
  const names = ["result.json"];
  for (const { stem, out } of exportsFor(expected))
    for (const [ext, bytes] of Object.entries(out.files)) {
      const name = `${stem}.${ext}`;
      names.push(name);
      assert.equal(await fs.readFile(path.join(root, name), "utf8"), bytes);
      assert.deepEqual(
        formats[ext].parse(bytes).map((r) => [r.start, r.end, r.text]),
        out.cues.map((r) => [r.start, r.end, r.text]),
      );
    }
  assert.deepEqual(
    Object.keys(f.files).sort(),
    names.sort(),
    "INCOMPLETE_INVENTORY",
  );
  for (const s of expected.sources)
    assert.deepEqual(
      s.baseline.map((r) => [r.id, r.start, r.end]),
      s.candidate.map((r) => [r.id, r.start, r.end]),
      "TIMING_OR_ORDER_CHANGED",
    );
  return {
    root,
    integrity: "passed",
    newInference: 0,
    timingMutations: 0,
    changedCues: expected.sources.reduce((n, s) => n + s.changedCues, 0),
    decisions: expected.sources.flatMap((s) =>
      s.decisions.map((d) => ({
        source: s.id,
        status: d.status,
        reason: d.reason,
      })),
    ),
    qualityStatus: "needs-review",
    automaticPromotionAllowed: false,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [mode, a, b] = process.argv.slice(2);
  const r =
    mode === "create" && a && b
      ? await createShortCandidate(a, b)
      : mode === "verify" && a && !b
        ? await verifyShortCandidate(a)
        : null;
  assert(r, "Usage: create FROZEN_COMPARISON OUTPUT_PARENT | verify ROOT");
  console.log(JSON.stringify(r, null, 2));
}
