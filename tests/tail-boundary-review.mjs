import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Buffer } from "node:buffer";
import {
  validateTailAnnotation,
  renderBoundaryReview,
} from "../scripts/lib/tail-boundary-review.mjs";
import {
  prepareTailReview,
  validateTailReview,
} from "../scripts/subtitle-tool-tail-review.mjs";
import { slicePcm } from "../scripts/lib/bounded-asr-ab.mjs";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";

const m = {
  evidenceHash: "a".repeat(64),
  audioSha256: "b".repeat(64),
  start: 66.93,
  end: 70.63,
  minimum: 68.81,
};
const annotation = (patch = {}) => ({
  version: "human-tail-bracket-v1",
  evidenceHash: m.evidenceHash,
  audioSha256: m.audioSha256,
  reviewer: "synthetic-test-reviewer",
  heardContext: true,
  status: "bracketed",
  stillAudibleAt: 69.1,
  endedBy: 69.6,
  notes: "Synthetic test; not actual listening",
  ...patch,
});
test("human interval never becomes exact endpoint or machine authority", () => {
  const r = validateTailAnnotation(m, annotation());
  assert.deepEqual(r.endpointRange, { after: 69.1, noLaterThan: 69.6 });
  assert.equal(r.exactEnd, null);
  assert.equal(r.subtitleMutationAuthorized, false);
  assert.equal(r.machineIndependent, false);
});
test("uncertainty can be exported without fake times", () => {
  assert.equal(
    validateTailAnnotation(
      m,
      annotation({ status: "uncertain", stillAudibleAt: null, endedBy: null }),
    ).endpointRange,
    null,
  );
  assert.throws(
    () => validateTailAnnotation(m, annotation({ status: "uncertain" })),
    /UNCERTAIN/,
  );
});
test("reject stale evidence, missing confirmation, unknown fields and automatic actions", () => {
  for (const patch of [
    { evidenceHash: "foreign" },
    { audioSha256: "foreign" },
    { reviewer: " " },
    { heardContext: false },
    { action: "EDIT_TIMING" },
    { status: "auto" },
  ])
    assert.throws(() => validateTailAnnotation(m, annotation(patch)));
});
test("reject clip-local, equal, reversed, outside, nonfinite and overprecise boundaries", () => {
  for (const [a, b] of [
    [1.2, 2],
    [69, 69],
    [69.5, 69],
    [68, 69],
    [69, 71],
    [NaN, 70],
    [69.001, 69.8],
    ["69", 70],
  ])
    assert.throws(() =>
      validateTailAnnotation(m, annotation({ stillAudibleAt: a, endedBy: b })),
    );
});
function ui(storageBlocked = false) {
  const nodes = new Map();
  const get = (id) => {
    if (!nodes.has(id))
      nodes.set(id, {
        value: "",
        checked: false,
        textContent: "",
        currentTime: 0,
        pause() {
          /* Synthetic media stub. */
        },
        play() {
          return Promise.resolve();
        },
        focus() {
          /* Synthetic focus stub. */
        },
        select() {
          this.selected = true;
        },
      });
    return nodes.get(id);
  };
  const storage = new Map();
  const context = {
    document: {
      getElementById: get,
      body: {
        append() {
          /* Synthetic DOM stub. */
        },
      },
      createElement() {
        return {
          click() {
            throw Error("download blocked");
          },
          remove() {
            /* Synthetic DOM stub. */
          },
        };
      },
    },
    localStorage: {
      getItem(k) {
        if (storageBlocked) throw Error("blocked");
        return storage.get(k);
      },
      setItem(k, v) {
        if (storageBlocked) throw Error("blocked");
        storage.set(k, v);
      },
    },
    Blob: function () {
      return {};
    },
    URL: {
      createObjectURL() {
        throw Error("download blocked");
      },
    },
    setTimeout() {
      /* Synthetic timer; no browser downloads. */
    },
  };
  const script = renderBoundaryReview(m).match(
    /<script>([\s\S]*)<\/script>/u,
  )[1];
  vm.runInNewContext(script, context);
  return { get, storage };
}
function fill(get) {
  get("reviewer").value = "synthetic-test";
  get("heard").checked = true;
  get("lower").value = "69.10";
  get("upper").value = "69.60";
}
test("actual embedded UI starts without a guessed endpoint", () => {
  const { get } = ui();
  assert.equal(get("lower").value, "");
  assert.equal(get("upper").value, "");
  get("export").onclick();
  assert.equal(get("json").value, "");
  assert.match(get("message").textContent, /未导出/u);
});
test("UI maps source time exactly once and marks explicitly", () => {
  const { get } = ui();
  get("audio").currentTime = 2.17;
  get("mark-lower").onclick();
  assert.equal(get("lower").value, "69.10");
  get("seek").value = "69.10";
  get("jump").onclick();
  assert(Math.abs(get("audio").currentTime - 2.17) < 1e-9);
});
test("download and storage failure retain copyable validated JSON", () => {
  const { get } = ui(true);
  fill(get);
  get("lower").oninput();
  get("download").onclick();
  validateTailAnnotation(m, JSON.parse(get("json").value));
  assert.match(get("message").textContent, /复制/u);
  get("select-json").onclick();
  assert.equal(get("json").selected, true);
});
test("editing clears stale export and uncertainty clears exported times", () => {
  const { get } = ui();
  fill(get);
  get("export").onclick();
  assert(get("json").value);
  get("lower").oninput();
  assert.equal(get("json").value, "");
  get("uncertain").checked = true;
  get("export").onclick();
  const a = JSON.parse(get("json").value);
  assert.equal(a.stillAudibleAt, null);
  assert.equal(a.endedBy, null);
});
test("HTML data cannot close script tags", () => {
  assert(
    !renderBoundaryReview({ ...m, extra: "</script><img src=x>" }).includes(
      "</script><img",
    ),
  );
});
test("packaging and read-only annotation checking bind audio, reject tampering and preserve parent", async () => {
  const dir = await fs.mkdtemp(
    path.join(await fs.realpath(os.tmpdir()), "tail-review-test-"),
  );
  try {
    const parent = path.join(dir, "parent");
    await fs.mkdir(parent);
    const pcm = {
      sampleRate: 16000,
      frames: 59200,
      data: Buffer.alloc(118400),
    };
    await fs.writeFile(
      path.join(parent, "context.wav"),
      slicePcm(pcm, 0, 59200),
    );
    await fs.writeFile(
      path.join(parent, "post-mfa-tail.wav"),
      slicePcm(pcm, 30080, 59200),
    );
    const audioHash = await fileHash(path.join(parent, "context.wav"));
    await fs.writeFile(
      path.join(parent, "listening-clips.json"),
      JSON.stringify({
        clips: [
          {
            file: "context.wav",
            start: 66.93,
            end: 70.63,
            startFrame: 1070880,
            endFrame: 1130080,
            sha256: audioHash,
          },
          { file: "post-mfa-tail.wav", start: 68.81, end: 70.63 },
        ],
      }),
    );
    const files = {};
    for (const n of await fs.readdir(parent))
      files[n] = await fileHash(path.join(parent, n));
    await fs.writeFile(
      path.join(parent, "machine-freeze.json"),
      JSON.stringify({ files }),
    );
    const before = await fileHash(path.join(parent, "machine-freeze.json"));
    await assert.rejects(
      prepareTailReview(parent, path.join(parent, "nested")),
      /OUTPUT_INSIDE/,
    );
    const a = await prepareTailReview(parent, path.join(dir, "out"));
    const b = await prepareTailReview(parent, path.join(dir, "out"));
    assert.notEqual(a.root, b.root);
    const input = path.join(dir, "synthetic-annotation.json");
    await fs.writeFile(
      input,
      JSON.stringify(
        annotation({ evidenceHash: before, audioSha256: audioHash }),
      ),
    );
    const result = await validateTailReview(a.root, input);
    assert.equal(result.subtitleMutationAuthorized, false);
    assert.equal(
      await fileHash(path.join(parent, "machine-freeze.json")),
      before,
    );
    await fs.appendFile(path.join(a.root, "context.wav"), "tampered");
    await assert.rejects(validateTailReview(a.root, input), /CHANGED/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
