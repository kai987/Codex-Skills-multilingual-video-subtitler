/* global AbortController */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  scanAudioActivity,
  planAudioCoverage,
} from "../scripts/lib/audio-coverage-observation.mjs";
import {
  deliverAudioCoverage,
  verifyAudioCoverage,
} from "../scripts/lib/audio-coverage-delivery.mjs";
import { replayAudioCoverage } from "../scripts/subtitle-tool-audio-coverage.mjs";
import { readPcm, slicePcm } from "../scripts/lib/bounded-asr-ab.mjs";
import { refineDefaultDelivery } from "../scripts/lib/default-seam-delivery.mjs";
import {
  compareCoveragePlans,
  evaluateAudioCoverage,
} from "../scripts/evaluate-audio-coverage.mjs";
const hash = (b) => createHash("sha256").update(b).digest("hex");
function pcm(seconds, spans, amplitude = 1600) {
  const frames = Math.round(seconds * 16000),
    data = Buffer.alloc(frames * 2);
  for (const [start, end] of spans)
    for (let i = Math.round(start * 16000); i < Math.round(end * 16000); i++)
      data.writeInt16LE(i % 2 ? amplitude : -amplitude, i * 2);
  return { frames, sampleRate: 16000, data };
}
const row = (id, start, end, text = "これは長いテストの文章です") => ({
  id,
  start,
  end,
  text,
});
test("PCM scan finds pause-separated activity without classifying it as speech", () => {
  const a = scanAudioActivity(
    pcm(4, [
      [1, 1.5],
      [2, 2.5],
    ]),
    { audioOffset: 10 },
  );
  assert.deepEqual(
    a.intervals.map((r) => [r.start, r.end]),
    [
      [11, 11.5],
      [12, 12.5],
    ],
  );
  assert(
    a.intervals.every((r) => r.speechVerified === false && !r.cropEdgeLimited),
  );
});
test("short quiet dips cannot manufacture separate response islands", () => {
  const a = scanAudioActivity(
    pcm(4, [
      [1, 1.5],
      [1.6, 2],
    ]),
    { audioOffset: 0 },
  );
  assert.equal(a.intervals.length, 1);
  assert.equal(a.intervals[0].end, 2);
});
test("negative energy result is not reported as silence or no speech", () => {
  for (const data of [pcm(2, []), pcm(2, [[0.5, 1]], 100)]) {
    const a = scanAudioActivity(data, { audioOffset: 0 });
    assert.equal(a.intervals.length, 0);
    assert.match(a.negativeMeaning, /not silence or no speech/u);
  }
});
test("full-waveform offset and selected-range offset are applied exactly once", () => {
  const a = scanAudioActivity(
    pcm(4, [
      [1.2, 1.6],
      [3, 3.5],
    ]),
    { audioOffset: 50, firstFrame: 16000, frames: 16000 },
  );
  assert.deepEqual(a.range, { start: 51, end: 52 });
  assert.deepEqual(
    a.intervals.map((r) => [r.start, r.end]),
    [[51.2, 51.6]],
  );
});
test("invalid PCM geometry, range and source offset fail closed", () => {
  const p = pcm(2, []);
  assert.throws(
    () => scanAudioActivity(p, { audioOffset: NaN }),
    /SOURCE_OFFSET/u,
  );
  assert.throws(
    () =>
      scanAudioActivity(p, {
        audioOffset: 0,
        firstFrame: 30000,
        frames: 10000,
      }),
    /SCAN_FRAME/u,
  );
  assert.throws(
    () => scanAudioActivity({ ...p, sampleRate: 48000 }, { audioOffset: 0 }),
    /PCM_GEOMETRY/u,
  );
});
test("long cue with separate islands yields embedded review units without inferred words", () => {
  const a = scanAudioActivity(
    pcm(6, [
      [1, 1.5],
      [2, 2.5],
      [4, 4.5],
    ]),
    { audioOffset: 0 },
  );
  const records = [row("long", 0.5, 3)],
    before = JSON.stringify(records);
  const p = planAudioCoverage(records, a);
  assert.equal(p.summary.embeddedActivityCount, 2);
  assert.equal(p.summary.uncoveredActivityCount, 1);
  assert(
    p.candidates.every(
      (r) => r.lexicalText === null && !r.subtitleMutationAuthorized,
    ),
  );
  assert.equal(JSON.stringify(records), before);
});
test("overlapping cues use interval union rather than creating fake subtitle gaps", () => {
  const a = scanAudioActivity(pcm(8, [[4, 5]]), { audioOffset: 0 });
  const p = planAudioCoverage(
    [row("a", 0, 6), row("b", 1, 2), row("c", 5.5, 8)],
    a,
  );
  assert.deepEqual(p.subtitleGaps, []);
  assert.equal(p.summary.uncoveredActivityCount, 0);
});
test("separate occurrences are retained even with identical neighboring text", () => {
  const a = scanAudioActivity(
    pcm(8, [
      [1, 1.5],
      [2, 2.5],
      [5, 5.5],
      [6, 6.5],
    ]),
    { audioOffset: 0 },
  );
  const p = planAudioCoverage([row("a", 0.5, 3), row("b", 4.5, 7)], a);
  assert.equal(p.summary.embeddedActivityCount, 4);
  assert.equal(new Set(p.candidates.map((r) => r.id)).size, 4);
});
test("continuous sound is not interpreted as many verified short utterances", () => {
  const a = scanAudioActivity(pcm(20, [[0, 20]]), { audioOffset: 0 });
  const p = planAudioCoverage([row("one", 0, 20)], a);
  assert.equal(p.summary.embeddedActivityCount, 0);
  assert.equal(a.intervals[0].cropEdgeLimited, true);
});
test("listening is bounded, source-stratified, with deferred units retained", () => {
  const spans = Array.from({ length: 50 }, (_, i) => [i * 2 + 0.2, i * 2 + 1]);
  const a = scanAudioActivity(pcm(100, spans), { audioOffset: 0 });
  const p = planAudioCoverage([], a);
  assert.equal(p.candidates.length, 50);
  assert.equal(p.previews.length, 8);
  assert(p.summary.requestedListeningSeconds <= 60);
  assert(p.previews.at(-1).start > 80);
  assert(p.deferred.length > 0);
  assert(p.candidates.every((c) => c.speechVerified === false));
});
test("invalid or out-of-range preferred subtitles cannot be silently ignored", () => {
  const a = scanAudioActivity(pcm(2, []), { audioOffset: 0 });
  assert.throws(() => planAudioCoverage([row("a", 1, 1)], a), /INVALID_CUE/u);
  assert.throws(
    () => planAudioCoverage([row("a", 1, 3)], a),
    /OUTSIDE_SOURCE/u,
  );
});

test("cue tail and onset fragments are retained but downranked below separate uncovered islands", () => {
  const a = scanAudioActivity(
    pcm(10, [
      [1, 2],
      [4, 4.5],
      [7, 8],
    ]),
    { audioOffset: 0 },
  );
  const p = planAudioCoverage(
    [row("tail", 0.5, 1.8), row("onset", 7.2, 8.5)],
    a,
  );
  assert.equal(p.candidates.length, 3);
  assert.equal(p.previews[0].unitId, p.candidates[1].id);
  for (const c of [p.candidates[0], p.candidates[2]]) {
    assert.equal(c.priority.relation, "cue-boundary-continuation-possible");
    assert.equal(c.priority.tier, 3);
    assert.equal(c.priority.wholeActivity, false);
  }
});
test("long continuous background fragments cannot win through small uncovered duration", () => {
  const a = scanAudioActivity(
    pcm(25, [
      [1, 18],
      [21, 21.5],
    ]),
    { audioOffset: 0 },
  );
  const p = planAudioCoverage([row("a", 1, 8), row("b", 8.5, 18)], a);
  const fragment = p.candidates.find((c) => c.start === 8);
  assert.equal(fragment.priority.parentActivitySeconds, 17);
  assert.equal(fragment.priority.relation, "continuous-activity-fragment");
  assert.equal(p.previews[0].relation, "isolated-uncovered-activity");
  assert.equal(fragment.priority.soundClass, "unknown-speech-music-noise");
});
test("embedded brief island is prioritized by host activity contrast, never assigned lexical text", () => {
  const a = scanAudioActivity(
    pcm(8, [
      [1, 3],
      [4, 4.4],
    ]),
    { audioOffset: 0 },
  );
  const p = planAudioCoverage([row("long", 0.5, 5)], a);
  const brief = p.candidates.find((c) => c.start === 4);
  assert.equal(brief.priority.tier, 1);
  assert.equal(brief.priority.longestHostPeerSeconds, 2);
  assert.equal(p.previews[0].unitId, brief.id);
  assert.equal(brief.lexicalText, null);
  assert.equal(brief.priority.confirmedMissingSpeech, false);
});
test("crop boundaries remain uncertain even for whole short energy islands", () => {
  const a = scanAudioActivity(
    pcm(6, [
      [0, 0.4],
      [2, 2.4],
      [5.6, 6],
    ]),
    { audioOffset: 0 },
  );
  const p = planAudioCoverage([], a);
  assert.equal(p.previews[0].relation, "isolated-uncovered-activity");
  assert.equal(p.summary.candidateRelations["crop-edge-uncertain"], 2);
});
test("first pass balances gap and embedded observations and retains unselected units", () => {
  const spans = Array.from({ length: 12 }, (_, i) => [2 + i * 4, 2.4 + i * 4]);
  const hosts = Array.from({ length: 6 }, (_, i) =>
    row(`host-${i}`, 51 + i * 8, 57 + i * 8),
  );
  for (let i = 0; i < 6; i++)
    spans.push([52 + i * 8, 54 + i * 8], [55 + i * 8, 55.4 + i * 8]);
  const a = scanAudioActivity(pcm(105, spans), { audioOffset: 0 });
  const p = planAudioCoverage(hosts, a);
  assert.equal(p.candidates.length, 24);
  assert.equal(
    p.previews.filter((r) => r.kind === "uncovered-audio-activity").length,
    4,
  );
  assert.equal(
    p.previews.filter((r) => r.kind === "embedded-short-audio-activity").length,
    4,
  );
  assert(p.deferred.length > 0);
  assert(p.previews.every((r) => r.priorityTier <= 1));
  assert.deepEqual(planAudioCoverage(hosts, a), p);
  assert(
    p.candidates.every(
      (c) => !c.priority.rankingValidated && !c.subtitleMutationAuthorized,
    ),
  );
});
test("ranking does not erase identical repeated isolated occurrences or infer speech from synthetic sound", () => {
  const a = scanAudioActivity(
    pcm(12, [
      [1, 1.4],
      [5, 5.4],
      [9, 9.4],
    ]),
    { audioOffset: 0 },
  );
  const p = planAudioCoverage([], a);
  assert.equal(p.candidates.length, 3);
  assert.equal(p.previews.length, 3);
  assert(
    p.candidates.every(
      (c) =>
        c.priority.soundClass === "unknown-speech-music-noise" &&
        !c.speechVerified,
    ),
  );
});
test("low-priority units stay in registry when clean isolated units exhaust listening budget", () => {
  const spans = [
    [1, 2],
    ...Array.from({ length: 10 }, (_, i) => [5 + i * 4, 5.5 + i * 4]),
  ];
  const p = planAudioCoverage(
    [row("tail", 0.5, 1.8)],
    scanAudioActivity(pcm(50, spans), { audioOffset: 0 }),
  );
  const tail = p.candidates[0];
  assert.equal(tail.priority.relation, "cue-boundary-continuation-possible");
  assert(p.deferred.some((d) => d.id === tail.id));
  assert(!p.previews.some((r) => r.unitId === tail.id));
  assert.equal(p.previews.length, 8);
});

async function fixture(t) {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "audio-coverage-test-")),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const task = path.join(root, "task"),
    output = path.join(root, "new");
  await fs.mkdir(task);
  await fs.mkdir(output);
  const p = pcm(12, [
    [1, 1.5],
    [2, 2.5],
    [5, 5.4],
    [9, 9.6],
  ]);
  const wav = slicePcm(p, 0, p.frames),
    subtitlePath = path.join(task, "original.srt");
  const srt =
    "1\n00:00:00,500 --> 00:00:03,000\nこれは長いテストの文章です\n\n2\n00:00:06,000 --> 00:00:07,000\nはい\n";
  const plan = {
    config: { language: "ja" },
    audioOffset: 0,
    firstFrame: 0,
    frames: p.frames,
    fullFrames: p.frames,
    sampleRate: 16000,
    effectiveRange: { start: 0, end: 12 },
    audioHash: hash(wav),
    pcmHash: hash(p.data),
  };
  const planBytes = JSON.stringify(plan);
  const files = {
    "bounded-plan.json": hash(planBytes),
    "audio.wav": hash(wav),
    "original.srt": hash(srt),
  };
  await fs.writeFile(path.join(task, "bounded-plan.json"), planBytes);
  await fs.writeFile(
    path.join(task, "bounded-task.json"),
    JSON.stringify({ files }),
  );
  await fs.writeFile(path.join(task, "audio.wav"), wav);
  await fs.writeFile(subtitlePath, srt);
  const recordsPath = path.join(task, "mapped-records.json");
  await fs.writeFile(
    recordsPath,
    JSON.stringify({
      timebase: "source-global-relative-to-container-origin",
      records: [{ recordId: "r", sourceStart: 6, sourceEnd: 7, text: "はい" }],
    }),
  );
  return {
    root,
    task,
    subtitlePath,
    output,
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
test("delivery creates source-exact previews, preserves all inputs and verifies freeze", async (t) => {
  const f = await fixture(t),
    before = await fs.readFile(f.subtitlePath);
  const result = await deliverAudioCoverage({ ...f, outputRoot: f.output });
  assert.equal(result.newInference, 0);
  const audit = await verifyAudioCoverage(f.output);
  assert.equal(audit.coverage.summary.embeddedActivityCount, 2);
  assert.equal(audit.coverage.summary.uncoveredActivityCount, 2);
  const original = readPcm(await fs.readFile(path.join(f.task, "audio.wav")));
  for (const preview of audit.coverage.previews) {
    const clip = readPcm(
      await fs.readFile(path.join(f.output, preview.audioFile)),
    );
    assert.deepEqual(
      clip.data,
      original.data.subarray(preview.firstFrame * 2, preview.endFrame * 2),
    );
  }
  assert.deepEqual(await fs.readFile(f.subtitlePath), before);
  await assert.rejects(
    deliverAudioCoverage({ ...f, outputRoot: f.output }),
    /EEXIST/u,
  );
  await fs.appendFile(
    path.join(f.output, audit.coverage.previews[0].audioFile),
    "tamper",
  );
  await assert.rejects(verifyAudioCoverage(f.output), /OUTPUT_CHANGED/u);
});
test("changed audio and subtitles reject rather than creating unbound observations", async (t) => {
  const f = await fixture(t);
  await fs.appendFile(f.subtitlePath, " ");
  await assert.rejects(
    deliverAudioCoverage({ ...f, outputRoot: f.output }),
    /SUBTITLE_HASH/u,
  );
  await fs.appendFile(path.join(f.task, "audio.wav"), " ");
  await assert.rejects(
    deliverAudioCoverage({ ...f, outputRoot: f.output }),
    /AUDIO_HASH/u,
  );
  assert.deepEqual(await fs.readdir(f.output), []);
});
test("external SRT without same-source frozen candidate binding is rejected", async (t) => {
  const f = await fixture(t),
    other = path.join(f.root, "other.srt");
  await fs.copyFile(f.subtitlePath, other);
  await assert.rejects(
    deliverAudioCoverage({ ...f, subtitlePath: other, outputRoot: f.output }),
    /ENOENT/u,
  );
});
test("replay cannot write in an old task or through a symlink", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    replayAudioCoverage(f.task, f.subtitlePath, f.task),
    /OUTPUT_INSIDE/u,
  );
  await fs.symlink(f.task, path.join(f.root, "alias"));
  await assert.rejects(
    replayAudioCoverage(f.task, f.subtitlePath, path.join(f.root, "alias/new")),
    /link|符号/u,
  );
});
test("fresh default enables both observers without calling a recognizer", async (t) => {
  const f = await fixture(t);
  const result = await refineDefaultDelivery(f.base, {
    language: "ja",
    enabled: false,
  });
  assert.equal(
    result.defaultDelivery.audioCoverageObservation.status,
    "observed",
  );
  assert.equal(result.defaultDelivery.audioCoverageObservation.newInference, 0);
  assert.equal(
    result.defaultDelivery.shortResponseObservation.status,
    "observed",
  );
  assert.match(
    await fs.readFile(result.outputIndex, "utf8"),
    /AUDIO_COVERAGE_OBSERVATION.md/u,
  );
  assert.deepEqual(result.preferredOutputs, [f.subtitlePath]);
});
test("cancellation in coverage stage remains cancellation, not successful generation", async (t) => {
  const f = await fixture(t),
    controller = new AbortController();
  const result = await refineDefaultDelivery(
    f.base,
    { language: "ja", enabled: false, signal: controller.signal },
    {
      observeCoverage: async () => {
        controller.abort();
        return { status: "observed" };
      },
    },
  );
  assert.equal(result.defaultDelivery.status, "cancelled");
  assert.equal(
    result.defaultDelivery.audioCoverageObservation.status,
    "cancelled",
  );
});
test("pre-cancelled scan writes no observation or clips", async (t) => {
  const f = await fixture(t),
    controller = new AbortController();
  controller.abort();
  await assert.rejects(
    deliverAudioCoverage({
      ...f,
      outputRoot: f.output,
      signal: controller.signal,
    }),
    /abort/iu,
  );
  assert.deepEqual(await fs.readdir(f.output), []);
});
test("evaluation does not inflate target coverage with preview context or count deferred work as reviewed", () => {
  const refs = [{ line: 1, start: 5, end: 6, text: "はい" }];
  const plan = {
    candidates: [
      { id: "near", start: 4, end: 4.8 },
      { id: "deferred", start: 5, end: 6 },
    ],
    previews: [{ unitId: "near", start: 3.5, end: 6.5 }],
    summary: {},
  };
  const r = compareCoveragePlans([], refs, plan);
  assert.equal(r.summary.newCandidateTouchCount, 1);
  assert.equal(r.summary.selectedTargetTouchCount, 0);
  assert.equal(r.summary.previewIncludingContextTouchCount, 1);
  assert.equal(r.summary.reviewPrecision, null);
});
test("post-freeze evaluation is isolated, immutable, and rejects modified machine evidence before Gold", async (t) => {
  const f = await fixture(t);
  const result = await deliverAudioCoverage({ ...f, outputRoot: f.output });
  const reference = path.join(f.root, "reference.ass");
  await fs.writeFile(
    reference,
    "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:05.00,0:00:05.40,Dialogue,,0,0,0,,はい\n",
  );
  const summary = await evaluateAudioCoverage(f.output, reference);
  assert.equal(summary.referenceCaseCount, 1);
  assert.equal(summary.noMachineCueCasesWithActivityHint, 1);
  assert.equal(summary.subtitleTextMutations, 0);
  assert.equal(summary.independentHoldoutValidation, "not-run");
  await assert.rejects(evaluateAudioCoverage(f.output, reference), /EEXIST/u);
  await fs.appendFile(result.artifact, " ");
  await assert.rejects(
    evaluateAudioCoverage(f.output, path.join(f.root, "absent.ass")),
    /OUTPUT_CHANGED/u,
  );
});
