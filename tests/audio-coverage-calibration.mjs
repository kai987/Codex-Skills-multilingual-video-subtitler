import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  planListening,
  blankLabels,
  evaluateListening,
  prepareListening,
  verifyListening,
  recordListening,
} from "../scripts/lib/audio-coverage-calibration.mjs";
import { deliverAudioCoverage } from "../scripts/lib/audio-coverage-delivery.mjs";
import { slicePcm, readPcm } from "../scripts/lib/bounded-asr-ab.mjs";
const hash = (x) => createHash("sha256").update(x).digest("hex");
const h = "a".repeat(64);
const mock = () => ({
  sourceRange: { start: 0, end: 200 },
  candidates: Array.from({ length: 40 }, (_, i) => ({
    id: `u${i}`,
    start: i * 5 + 1,
    end: i * 5 + 1.5,
  })),
  previews: Array.from({ length: 8 }, (_, i) => ({
    unitId: `u${i}`,
    start: i * 5 + 0.25,
    end: i * 5 + 2.25,
  })),
});
const manifest = {
  items: [
    { id: "a", audioHash: h, cohort: "ranked" },
    { id: "b", audioHash: h, cohort: "reserve" },
  ],
};
test("reserved sampling is bounded and independent of candidate order, priority, or textual hints", () => {
  const coverage = mock(),
    a = planListening(coverage, h);
  coverage.candidates.reverse();
  coverage.candidates.forEach((c) => {
    c.text = "human answer should be ignored";
    c.priority = { tier: 99 };
  });
  assert.deepEqual(planListening(coverage, h), a);
  assert.equal(a.items.filter((i) => i.cohort === "ranked").length, 8);
  assert.equal(a.items.filter((i) => i.cohort === "reserve").length, 8);
  assert(a.totalSeconds <= 60 && a.reserveSeconds <= 30);
  assert(a.deferred.length > 0);
  assert.equal(a.independentHoldout, false);
  for (const r of a.items.filter((i) => i.cohort === "reserve"))
    assert(
      a.items.every(
        (p) => p === r || Math.min(r.end, p.end) <= Math.max(r.start, p.start),
      ),
    );
});
test("empty or exhausted reserve is reported without making new requests", () => {
  const p = mock();
  p.candidates = p.candidates.slice(0, 8);
  const a = planListening(p, h);
  assert.equal(a.items.length, 8);
  assert.equal(a.policy.newInference, 0);
  assert.throws(
    () => planListening({ ...p, previews: [...p.previews, p.previews[0]] }, h),
    /BUDGET/u,
  );
});
test("all pending remains unknown rather than zero speech or perfect precision", () => {
  const r = evaluateListening(manifest, h, blankLabels(manifest, h));
  assert.equal(r.status, "awaiting-listening-labels");
  assert.equal(r.cohorts.ranked.speechFractionAmongDeterminate, null);
  assert.deepEqual(r.cohorts.ranked.possibleSpeechFractionRange, [0, 1]);
  assert.equal(r.rankingValidated, false);
  assert.equal(r.asrAccuracyGain, null);
});
test("attested speech and non-speech keep cohort denominators separate", () => {
  const s = blankLabels(manifest, h);
  s.reviewer = "tester";
  Object.assign(s.labels[0], {
    listened: true,
    sound: "mixed-speech",
    relation: "independent",
  });
  Object.assign(s.labels[1], {
    listened: true,
    sound: "music",
    relation: "not-applicable",
  });
  const r = evaluateListening(manifest, h, s);
  assert.equal(r.cohorts.ranked.speech, 1);
  assert.equal(r.cohorts.reserve.nonSpeech, 1);
  assert.equal(r.cohorts.ranked.independent, 1);
  assert.equal(r.subtitleMutations, 0);
  assert.equal(r.status, "labels-recorded-needs-validation");
});
test("uncertain labels are not false negatives and do not clear release gates", () => {
  const s = blankLabels(manifest, h);
  s.reviewer = "tester";
  Object.assign(s.labels[0], {
    listened: true,
    sound: "uncertain",
    relation: "uncertain",
  });
  const r = evaluateListening(manifest, h, s);
  assert.equal(r.cohorts.ranked.uncertain, 1);
  assert.equal(r.cohorts.ranked.nonSpeech, 0);
  assert.deepEqual(r.cohorts.ranked.possibleSpeechFractionRange, [0, 1]);
  assert.equal(r.qualityStatus, "needs-review");
});
test("reject stale hashes, omitted, duplicate, unknown, or extra-field labels", () => {
  for (const change of [
    (s) => (s.manifestHash = "b".repeat(64)),
    (s) => s.labels.pop(),
    (s) => (s.labels[1] = { ...s.labels[0] }),
    (s) => (s.labels[0].id = "other"),
    (s) => (s.labels[0].audioHash = "b".repeat(64)),
    (s) => (s.labels[0].text = "answer"),
  ]) {
    const s = blankLabels(manifest, h);
    change(s);
    assert.throws(() => evaluateListening(manifest, h, s));
  }
});
test("nonpending requires explicit listening and reviewer, with sound/relation consistency", () => {
  for (const [sound, relation, listened, reviewer] of [
    ["speech", "independent", false, "me"],
    ["speech", "independent", true, ""],
    ["music", "independent", true, "me"],
    ["speech", "not-applicable", true, "me"],
    ["pending", "independent", true, "me"],
    ["uncertain", "continuation", true, "me"],
  ]) {
    const s = blankLabels(manifest, h);
    s.reviewer = reviewer;
    Object.assign(s.labels[0], { sound, relation, listened });
    assert.throws(() => evaluateListening(manifest, h, s));
  }
});

async function fixture(t) {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "audio-listening-test-")),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const task = path.join(root, "task"),
    source = path.join(root, "observer");
  await fs.mkdir(task);
  await fs.mkdir(source);
  const frames = 16000 * 80,
    data = Buffer.alloc(frames * 2);
  for (let j = 0; j < 20; j++)
    for (let i = (j * 4 + 1) * 16000; i < (j * 4 + 1.5) * 16000; i++)
      data.writeInt16LE(i % 2 ? 2000 : -2000, i * 2);
  const pcm = { frames, sampleRate: 16000, data },
    wav = slicePcm(pcm, 0, frames);
  const srt = "1\n00:00:01,000 --> 00:00:01,500\nはい\n";
  const plan = JSON.stringify({
    config: { language: "ja" },
    audioOffset: 0,
    firstFrame: 0,
    frames,
    fullFrames: frames,
    sampleRate: 16000,
    effectiveRange: { start: 0, end: 80 },
    audioHash: hash(wav),
    pcmHash: hash(data),
  });
  const inputs = {
    "bounded-plan.json": plan,
    "audio.wav": wav,
    "original.srt": srt,
  };
  for (const [name, value] of Object.entries(inputs))
    await fs.writeFile(path.join(task, name), value);
  await fs.writeFile(
    path.join(task, "bounded-task.json"),
    JSON.stringify({
      files: Object.fromEntries(
        Object.entries(inputs).map(([name, value]) => [name, hash(value)]),
      ),
    }),
  );
  await deliverAudioCoverage({
    task,
    subtitlePath: path.join(task, "original.srt"),
    outputRoot: source,
  });
  return { root, source, task, pcm };
}
test("end-to-end blank calibration exports exact audio, blind UI, immutable inputs, and pending evaluation", async (t) => {
  const f = await fixture(t);
  const before = await fs.readFile(
    path.join(f.source, "audio-coverage-freeze.json"),
  );
  const result = await prepareListening(f.source, path.join(f.root, "new"));
  const { manifest: m } = await verifyListening(result.root);
  for (const i of m.items) {
    const wav = readPcm(await fs.readFile(path.join(result.root, i.audio)));
    assert.deepEqual(
      wav.data,
      f.pcm.data.subarray(i.firstFrame * 2, i.endFrame * 2),
    );
  }
  const html = await fs.readFile(path.join(result.root, "index.html"), "utf8");
  assert(!html.includes("__LISTENING_DATA__"));
  assert(!html.includes("priority"));
  assert(!html.includes("ranked"));
  assert(!html.includes("はい"));
  const r = await recordListening(
    result.root,
    path.join(result.root, "labels.blank.json"),
  );
  assert.equal(r.status, "awaiting-listening-labels");
  assert.deepEqual(
    await fs.readFile(path.join(f.source, "audio-coverage-freeze.json")),
    before,
  );
  await assert.rejects(prepareListening(f.source, f.source), /OUTPUT_INSIDE/u);
  await fs.appendFile(path.join(result.root, m.items[0].audio), "tamper");
  await assert.rejects(
    recordListening(result.root, path.join(result.root, "labels.blank.json")),
    /CHANGED/u,
  );
});
test("tampered observer and symlink output fail before producing calibration", async (t) => {
  const f = await fixture(t);
  await fs.symlink(f.source, path.join(f.root, "alias"));
  await assert.rejects(
    prepareListening(f.source, path.join(f.root, "alias/new")),
    /link|符号/u,
  );
  await fs.appendFile(
    path.join(f.source, "AUDIO_COVERAGE_OBSERVATION.json"),
    " ",
  );
  await assert.rejects(
    prepareListening(f.source, path.join(f.root, "new")),
    /OUTPUT_CHANGED/u,
  );
});
