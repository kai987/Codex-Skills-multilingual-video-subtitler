/** Explicit human-listening calibration. Never imported by subtitle generation. */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { z } from "zod";
import { safePath } from "../../packages/video-subtitler/dist/standalone/recovery.js";
import {
  verifyAudioCoverage,
  loadAudioCoverageInputs,
} from "./audio-coverage-delivery.mjs";
import { slicePcm } from "./bounded-asr-ab.mjs";

const hash = (b) => createHash("sha256").update(b).digest("hex");
const json = (v) => JSON.stringify(v, null, 2) + "\n";
const overlap = (a, b) => Math.min(a.end, b.end) > Math.max(a.start, b.start);
export const calibrationPolicy = Object.freeze({
  version: "audio-coverage-listening-v1",
  maximumRanked: 8,
  maximumReserve: 8,
  maximumReserveSeconds: 30,
  maximumTotalSeconds: 60,
  reserveSelection:
    "sha256(freezeHash:unitId); no overlap with selected previews; no reference",
  referenceUsed: false,
  newInference: 0,
  subtitleMutationAuthorized: false,
});

export function planListening(coverage, freezeHash) {
  assert(/^[a-f0-9]{64}$/u.test(freezeHash), "INVALID_SOURCE_FREEZE_HASH");
  assert(coverage.previews.length <= 8, "RANKED_BUDGET");
  const items = coverage.previews.map((p) => {
    const c = coverage.candidates.find((c) => c.id === p.unitId);
    assert(c, "MISSING_UNIT");
    return {
      unitId: c.id,
      cohort: "ranked",
      start: p.start,
      end: p.end,
      targetStart: c.start,
      targetEnd: c.end,
    };
  });
  let total = items.reduce((n, r) => n + r.end - r.start, 0),
    reserveSeconds = 0;
  assert(total <= 60 + 1e-8, "LISTENING_BUDGET");
  const selected = new Set(items.map((r) => r.unitId));
  const deferred = [];
  for (const c of [...coverage.candidates]
    .filter((c) => !selected.has(c.id))
    .sort((a, b) =>
      hash(freezeHash + ":" + a.id).localeCompare(
        hash(freezeHash + ":" + b.id),
      ),
    )) {
    const r = {
      unitId: c.id,
      cohort: "reserve",
      targetStart: c.start,
      targetEnd: c.end,
      start: Math.max(coverage.sourceRange.start, c.start - 0.75),
      end: Math.min(coverage.sourceRange.end, c.end + 0.75),
    };
    if (items.some((p) => overlap(p, r))) {
      deferred.push({ unitId: c.id, reason: "PLAYBACK_OVERLAP" });
      continue;
    }
    const seconds = r.end - r.start;
    if (
      items.filter((p) => p.cohort === "reserve").length >= 8 ||
      reserveSeconds + seconds > 30 + 1e-8 ||
      total + seconds > 60 + 1e-8
    ) {
      deferred.push({ unitId: c.id, reason: "LISTENING_BUDGET" });
      continue;
    }
    items.push(r);
    reserveSeconds += seconds;
    total += seconds;
  }
  // Blind presentation order: no candidate kind, tier, neighbor text or Gold in UI.
  items.sort((a, b) =>
    hash("display:" + freezeHash + a.unitId).localeCompare(
      hash("display:" + freezeHash + b.unitId),
    ),
  );
  return {
    policy: calibrationPolicy,
    items: items.map((r, i) => ({ id: `clip-${i + 1}`, ...r })),
    deferred,
    totalSeconds: total,
    reserveSeconds,
    independentHoldout: false,
    cohortMeaning: "Known-episode reserved diagnostics, not unseen validation",
  };
}

const labelSchema = z
  .object({
    id: z.string(),
    audioHash: z.string().regex(/^[a-f0-9]{64}$/u),
    listened: z.boolean(),
    sound: z.enum([
      "pending",
      "speech",
      "mixed-speech",
      "music",
      "effect",
      "noise",
      "uncertain",
    ]),
    relation: z.enum([
      "pending",
      "independent",
      "continuation",
      "uncertain",
      "not-applicable",
    ]),
  })
  .strict();
const submissionSchema = z
  .object({
    version: z.literal("audio-listening-labels-v1"),
    manifestHash: z.string().regex(/^[a-f0-9]{64}$/u),
    reviewer: z.string().max(120),
    labels: z.array(labelSchema).max(16),
  })
  .strict();

export function blankLabels(manifest, manifestHash) {
  return {
    version: "audio-listening-labels-v1",
    manifestHash,
    reviewer: "",
    labels: manifest.items.map((r) => ({
      id: r.id,
      audioHash: r.audioHash,
      listened: false,
      sound: "pending",
      relation: "pending",
    })),
  };
}

export function evaluateListening(manifest, manifestHash, input) {
  const submission = submissionSchema.parse(input);
  assert.equal(submission.manifestHash, manifestHash, "STALE_MANIFEST");
  assert.equal(submission.labels.length, manifest.items.length, "LABEL_COUNT");
  const seen = new Set();
  for (const r of submission.labels) {
    assert(!seen.has(r.id), "DUPLICATE_LABEL");
    seen.add(r.id);
    const item = manifest.items.find((i) => i.id === r.id);
    assert(item, "UNKNOWN_CLIP");
    assert.equal(r.audioHash, item.audioHash, "STALE_AUDIO");
    if (r.sound === "pending") {
      assert.equal(r.relation, "pending", "PENDING_RELATION");
    } else {
      assert(
        r.listened && submission.reviewer.trim(),
        "LISTENER_ATTESTATION_REQUIRED",
      );
      if (["speech", "mixed-speech"].includes(r.sound))
        assert(
          ["independent", "continuation", "uncertain"].includes(r.relation),
          "SPEECH_RELATION",
        );
      else if (r.sound === "uncertain")
        assert.equal(r.relation, "uncertain", "UNCERTAIN_RELATION");
      else assert.equal(r.relation, "not-applicable", "NONSPEECH_RELATION");
    }
  }
  const cohorts = {};
  for (const cohort of ["ranked", "reserve"]) {
    const ids = new Set(
      manifest.items.filter((i) => i.cohort === cohort).map((i) => i.id),
    );
    const rows = submission.labels.filter((r) => ids.has(r.id));
    const count = (test) => rows.filter(test).length;
    const speech = count((r) => ["speech", "mixed-speech"].includes(r.sound));
    const pending = count((r) => r.sound === "pending");
    const uncertain = count((r) => r.sound === "uncertain");
    const nonSpeech = count((r) =>
      ["music", "effect", "noise"].includes(r.sound),
    );
    cohorts[cohort] = {
      total: rows.length,
      pending,
      uncertain,
      speech,
      nonSpeech,
      independent: count((r) => r.relation === "independent"),
      continuation: count((r) => r.relation === "continuation"),
      relationUncertain: count(
        (r) =>
          ["speech", "mixed-speech"].includes(r.sound) &&
          r.relation === "uncertain",
      ),
      speechFractionAmongDeterminate:
        speech + nonSpeech ? speech / (speech + nonSpeech) : null,
      possibleSpeechFractionRange: rows.length
        ? [speech / rows.length, (speech + pending + uncertain) / rows.length]
        : null,
    };
  }
  const pending = submission.labels.filter((r) => r.sound === "pending").length;
  return {
    version: "audio-listening-evaluation-v1",
    status: pending
      ? "awaiting-listening-labels"
      : "labels-recorded-needs-validation",
    cohorts,
    referenceUsed: false,
    newInference: 0,
    subtitleMutations: 0,
    rankingValidated: false,
    independentHoldout: false,
    asrAccuracyGain: null,
    annotationProvenance:
      "user-attested-listening; identity and listening not independently certified",
    finalizationMethod: "none",
    qualityStatus: "needs-review",
  };
}

export async function prepareListening(source, outputParent) {
  source = path.resolve(source);
  outputParent = path.resolve(outputParent);
  await safePath(outputParent, true);
  const audit = await verifyAudioCoverage(source);
  const loaded = await loadAudioCoverageInputs(audit.task, audit.subtitlePath);
  for (const parent of [
    source,
    path.resolve(audit.task),
    path.dirname(path.resolve(audit.subtitlePath)),
  ])
    assert(
      outputParent !== parent && !outputParent.startsWith(parent + path.sep),
      "OUTPUT_INSIDE_EVIDENCE",
    );
  const sourceFreezeHash = hash(
    await fs.readFile(path.join(source, "audio-coverage-freeze.json")),
  );
  const plan = planListening(audit.coverage, sourceFreezeHash);
  await fs.mkdir(outputParent, { recursive: true });
  const root = await fs.mkdtemp(path.join(outputParent, "listening-"));
  const files = {};
  const put = async (name, bytes) => {
    await fs.writeFile(path.join(root, name), bytes, { flag: "wx" });
    files[name] = hash(bytes);
  };
  await fs.mkdir(path.join(root, "audio"));
  for (const item of plan.items) {
    item.firstFrame = Math.round(
      (item.start - loaded.plan.audioOffset) * 16000,
    );
    item.endFrame = Math.round((item.end - loaded.plan.audioOffset) * 16000);
    assert(
      item.firstFrame >= loaded.plan.firstFrame &&
        item.endFrame <= loaded.plan.firstFrame + loaded.plan.frames,
      "CLIP_RANGE",
    );
    item.audio = `audio/${item.id}.wav`;
    const wav = slicePcm(loaded.pcm, item.firstFrame, item.endFrame);
    item.audioHash = hash(wav);
    await put(item.audio, wav);
  }
  const manifest = { ...plan, source, sourceFreezeHash };
  await put("listening-manifest.json", json(manifest));
  const manifestHash = files["listening-manifest.json"];
  const blank = blankLabels(manifest, manifestHash);
  await put("labels.blank.json", json(blank));
  const publicData = {
    submission: blank,
    items: plan.items.map((r) => ({
      id: r.id,
      audio: r.audio,
      targetStart: r.targetStart - r.start,
      targetEnd: r.targetEnd - r.start,
      duration: r.end - r.start,
    })),
  };
  const template = await fs.readFile(
    new URL("../review-audio-coverage/index.html", import.meta.url),
    "utf8",
  );
  await put(
    "index.html",
    template.replace(
      "__LISTENING_DATA__",
      json(publicData).replaceAll("<", "\\u003c"),
    ),
  );
  await put(
    "app.js",
    await fs.readFile(
      new URL("../review-audio-coverage/app.js", import.meta.url),
    ),
  );
  await verifyAudioCoverage(source);
  await put(
    "listening-freeze.json",
    json({
      version: "audio-listening-freeze-v1",
      files: { ...files },
      softwareHash: hash(await fs.readFile(new URL(import.meta.url))),
      newInference: 0,
    }),
  );
  return {
    root,
    items: plan.items.length,
    totalSeconds: plan.totalSeconds,
    status: "awaiting-listening-labels",
  };
}

export async function verifyListening(root) {
  await safePath(root);
  const freeze = JSON.parse(
    await fs.readFile(path.join(root, "listening-freeze.json")),
  );
  assert.equal(freeze.version, "audio-listening-freeze-v1");
  for (const key of [
    "listening-manifest.json",
    "labels.blank.json",
    "index.html",
    "app.js",
  ])
    assert(freeze.files[key], "INCOMPLETE_FREEZE");
  for (const [name, digest] of Object.entries(freeze.files)) {
    assert(
      !path.isAbsolute(name) && !name.split(/[\\/]/u).includes(".."),
      "UNSAFE_FREEZE_PATH",
    );
    await safePath(path.join(root, name));
    assert.equal(
      hash(await fs.readFile(path.join(root, name))),
      digest,
      "CALIBRATION_FILE_CHANGED",
    );
  }
  const manifest = JSON.parse(
    await fs.readFile(path.join(root, "listening-manifest.json")),
  );
  for (const item of manifest.items)
    assert.equal(freeze.files[item.audio], item.audioHash, "UNBOUND_AUDIO");
  return { manifest, manifestHash: freeze.files["listening-manifest.json"] };
}

export async function recordListening(root, labelPath) {
  const { manifest, manifestHash } = await verifyListening(root);
  await safePath(labelPath);
  const labelBytes = await fs.readFile(labelPath);
  const result = evaluateListening(
    manifest,
    manifestHash,
    JSON.parse(labelBytes),
  );
  const directory = await fs.mkdtemp(path.join(root, "evaluation-"));
  await fs.writeFile(path.join(directory, "labels.json"), labelBytes, {
    flag: "wx",
  });
  await fs.writeFile(
    path.join(directory, "evaluation.json"),
    json({ ...result, manifestHash, labelsHash: hash(labelBytes) }),
    { flag: "wx" },
  );
  return { directory, ...result };
}
