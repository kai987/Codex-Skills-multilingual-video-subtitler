/** One explicitly authorized VAD-only refresh, reusing the original full WAV. */
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { fileHash } from "../packages/video-subtitler/dist/standalone/tool.js";
import { safePath } from "../packages/video-subtitler/dist/standalone/recovery.js";
import { readPcm } from "./lib/bounded-asr-ab.mjs";
import { reviewAnchoredActivity } from "./lib/anchored-activity-review.mjs";
import {
  listeningVadPolicy,
  vadProfile,
  verifyListeningVad,
  runListeningVad,
} from "./subtitle-tool-listening-vad.mjs";
const json = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const put = (p, v) =>
  fs.writeFile(p, JSON.stringify(v, null, 2) + "\n", { flag: "wx" });
const bind = async (file) => ({
  file: await fs.realpath(file),
  sha256: await fileHash(file),
});
export const refreshPolicy = Object.freeze({
  maxRequests: 1,
  maxFrames: 80000,
  retries: 0,
  asrRequests: 0,
});

export function refreshItem(selected, root) {
  assert.equal(selected.length, 1, "ONE_TARGET_ONLY");
  const s = selected[0];
  assert.equal(
    s.review.rightCensored,
    true,
    "RIGHT_CENSORED_ACTIVITY_REQUIRED",
  );
  assert.deepEqual(s.review, reviewAnchoredActivity(s.input), "STALE_REVIEW");
  assert(/^clip-\d+$/u.test(s.targetId), "INVALID_TARGET_ID");
  assert(
    s.playback.file === path.basename(s.playback.file),
    "UNSAFE_AUDIO_PATH",
  );
  assert.equal(s.playback.sourceStart, s.input.sourceWindow.start);
  assert.equal(s.playback.sourceEnd, s.input.sourceWindow.end);
  const frames = Math.round(
    (s.playback.sourceEnd - s.playback.sourceStart) * 16000,
  );
  assert(frames > 0 && frames <= refreshPolicy.maxFrames, "FIVE_SECOND_LIMIT");
  const item = {
    id: s.targetId,
    cohort: "context-refresh",
    start: s.playback.sourceStart,
    end: s.playback.sourceEnd,
    frames,
    audioPath: path.join(root, s.playback.file),
    audioHash: s.playback.sha256,
    localTargetStart: s.input.anchor.start - s.playback.sourceStart,
    localTargetEnd: s.input.anchor.end - s.playback.sourceStart,
  };
  assert(
    item.localTargetStart >= 0 &&
      item.localTargetEnd > item.localTargetStart &&
      item.localTargetEnd <= frames / 16000,
    "ANCHOR_RANGE",
  );
  return item;
}
async function check(bindings) {
  for (const b of bindings) {
    await safePath(b.file);
    assert.equal(await fileHash(b.file), b.sha256, `INPUT_CHANGED:${b.file}`);
  }
}
async function verifyReview(root) {
  await safePath(root);
  const f = await json(path.join(root, "freeze.json"));
  for (const [n, h] of Object.entries(f.files)) {
    assert(!path.isAbsolute(n) && !n.split(/[\\/]/u).includes(".."));
    await safePath(path.join(root, n));
    assert.equal(await fileHash(path.join(root, n)), h);
  }
  await check((await json(path.join(root, "provenance.json"))).bindings);
  const r = await json(path.join(root, "activity-review.json"));
  assert.equal(r.referenceUsed, false);
  assert.equal(r.labelsUsed, false);
  return r;
}
export async function prepareRefresh(reviewRoot, priorVadRoot, output) {
  const review = await verifyReview(reviewRoot),
    old = await verifyListeningVad(priorVadRoot);
  const item = refreshItem(review.selected, reviewRoot);
  const oldItem = old.plan.items.find((i) => i.id === item.id);
  assert(oldItem, "OLD_TARGET_MISSING");
  assert.equal(review.selected[0].input.activityWindow.start, oldItem.start);
  assert.equal(
    review.selected[0].input.activityWindow.end,
    oldItem.start + oldItem.frames / 16000,
  );
  assert.deepEqual(
    review.selected[0].input.vadIntervals,
    old.observations.find((o) => o.id === item.id).sourceIntervals,
  );
  assert.deepEqual(old.plan.profile, vadProfile, "UNCHANGED_PROFILE_REQUIRED");
  assert.equal(await fileHash(item.audioPath), item.audioHash);
  const pcm = readPcm(await fs.readFile(item.audioPath));
  assert.equal(pcm.sampleRate, 16000);
  assert.equal(pcm.frames, item.frames);
  output = path.resolve(output);
  await safePath(output, true);
  for (const src of [reviewRoot, priorVadRoot])
    assert(
      output !== path.resolve(src) &&
        !output.startsWith(path.resolve(src) + path.sep),
      "OUTPUT_INSIDE_SOURCE",
    );
  const inputs = await Promise.all(
    [
      item.audioPath,
      path.join(reviewRoot, "activity-review.json"),
      path.join(reviewRoot, "freeze.json"),
      path.join(priorVadRoot, "plan.json"),
      path.join(priorVadRoot, "machine-freeze.json"),
    ].map(bind),
  );
  const software = [
    ...old.plan.software,
    await bind(import.meta.filename),
    await bind(
      path.join(import.meta.dirname, "lib/anchored-activity-review.mjs"),
    ),
  ];
  await fs.mkdir(output, { recursive: true });
  const root = await fs.mkdtemp(path.join(output, "vad-refresh-"));
  const plan = {
    policy: listeningVadPolicy,
    profile: vadProfile,
    refreshPolicy,
    reviewRoot,
    priorVadRoot,
    itemTargetMeaning: "CTC interior emission anchor, not complete utterance",
    items: [item],
    seconds: item.frames / 16000,
    runtime: old.plan.runtime,
    identities: old.plan.identities,
    software,
    inputs,
    annotationInput: false,
  };
  await put(path.join(root, "plan.json"), plan);
  await put(path.join(root, "plan-freeze.json"), {
    planHash: await fileHash(path.join(root, "plan.json")),
  });
  return { root, requests: 1, seconds: plan.seconds };
}
export async function runRefresh(root, authorize, runner) {
  assert.equal(authorize, true, "LOCAL_AUTHORIZATION_REQUIRED");
  const p = await json(path.join(root, "plan.json"));
  assert.equal(
    await fileHash(path.join(root, "plan.json")),
    (await json(path.join(root, "plan-freeze.json"))).planHash,
  );
  assert.deepEqual(p.refreshPolicy, refreshPolicy);
  const prior = await verifyReview(p.reviewRoot);
  assert.deepEqual(p.items, [refreshItem(prior.selected, p.reviewRoot)]);
  // Existing runner reserves exclusively before model dispatch and has no retries.
  return runListeningVad(root, { authorize, ...(runner ? { runner } : {}) });
}
export async function finishRefresh(root) {
  const fresh = await verifyListeningVad(root),
    p = fresh.plan,
    old = await verifyReview(p.reviewRoot);
  assert.deepEqual(p.items, [refreshItem(old.selected, p.reviewRoot)]);
  assert.equal(fresh.vadPasses, 1);
  assert.equal(fresh.modelLoads, 1);
  const previous = old.selected[0],
    observation = fresh.observations[0];
  const input = {
    ...previous.input,
    activityWindow: { start: p.items[0].start, end: p.items[0].end },
    vadIntervals: observation.sourceIntervals,
  };
  const current = reviewAnchoredActivity(input);
  return {
    before: previous.review,
    after: current,
    input,
    observation,
    rightEdgeConcernCleared:
      previous.review.rightCensored === true &&
      current.activity !== null &&
      current.rightCensored === false,
    recordedVadRequests: 1,
    recordedModelLoads: 1,
    asrRequests: 0,
    requestSeconds: p.seconds,
    subtitleMutations: 0,
    qualityStatus: "needs-review",
    finalizationMethod: "none",
  };
}
export async function saveRefresh(root) {
  const result = await finishRefresh(root);
  await put(path.join(root, "boundary-review.json"), result);
  await put(path.join(root, "boundary-review-freeze.json"), {
    files: {
      "boundary-review.json": await fileHash(
        path.join(root, "boundary-review.json"),
      ),
      "machine-freeze.json": await fileHash(
        path.join(root, "machine-freeze.json"),
      ),
    },
  });
  return result;
}
export async function verifyRefresh(root) {
  const f = await json(path.join(root, "boundary-review-freeze.json"));
  for (const [n, h] of Object.entries(f.files)) {
    assert(["boundary-review.json", "machine-freeze.json"].includes(n));
    assert.equal(await fileHash(path.join(root, n)), h);
  }
  assert.deepEqual(
    await finishRefresh(root),
    await json(path.join(root, "boundary-review.json")),
  );
  return { integrity: "passed", newInference: 0, recordedVadRequests: 1 };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [cmd, a, b, c] = process.argv.slice(2);
  const r =
    cmd === "prepare"
      ? await prepareRefresh(a, b, c)
      : cmd === "run"
        ? await runRefresh(a, b === "--authorize-local")
        : cmd === "finish"
          ? await saveRefresh(a)
          : cmd === "verify"
            ? await verifyRefresh(a)
            : null;
  assert(r, "UNKNOWN_COMMAND");
  console.log(JSON.stringify(r, null, 2));
}
