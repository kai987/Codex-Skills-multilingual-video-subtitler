import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { machineQualityEvidenceSchema } from "../packages/video-subtitler/dist/machine-quality/experimental-profile.js";
import {
  portableAsrCacheEntryV2Schema,
  subtitlePackageSchema,
} from "../packages/shared/dist/index.js";
import {
  buildPortableAsrCacheKey,
  hashAsrDecodeConfiguration,
} from "../packages/transcription-core/dist/index.js";
import {
  parseAss,
  parseSrt,
  parseVtt,
} from "../packages/subtitle-core/dist/index.js";

const [primaryRoot, stableRoot, dest] = process.argv
  .slice(2)
  .map((p) => path.resolve(p));
if (!primaryRoot || !stableRoot || !dest)
  throw new Error(
    "Usage: prepare-c60116-evidence.mjs primary-run stable-run new-evidence.json",
  );
const sha = (b) => createHash("sha256").update(b).digest("hex");
const files = new Map();
const record = (p) => {
  const b = fs.readFileSync(p);
  files.set(p, sha(b));
  return JSON.parse(b);
};
const subdir = (root) => {
  const names = fs
    .readdirSync(root)
    .filter(
      (n) =>
        n.startsWith("subtitle-") &&
        fs.statSync(path.join(root, n)).isDirectory(),
    );
  if (names.length !== 1) throw new Error("Ambiguous subtitle directory");
  return names[0];
};
const sub = subdir(primaryRoot),
  ss = subdir(stableRoot);
const freeze = record(path.join(primaryRoot, "blind-output-freeze.json"));
const frozen = (rel) => {
  const p = path.join(primaryRoot, rel),
    b = fs.readFileSync(p);
  const item = freeze.frozenFiles.find((f) => f.relativePath === rel);
  if (!item || item.sha256 !== sha(b) || item.size !== b.length)
    throw new Error("Frozen artifact mismatch: " + rel);
  files.set(p, sha(b));
  return JSON.parse(b);
};
const manifest = frozen("blind-generation-input-manifest.json");
if (
  manifest.humanArtifacts.some((a) => a.used || a.inputCount) ||
  manifest.environmentSummary.guidanceMode !== "reference-free" ||
  !manifest.generationArguments.includes("--no-whisper-vad")
)
  throw new Error("Primary was not verified reference-free/no-VAD");
const raw = frozen("audio/raw-transcription.json");
const audioManifest = frozen("audio/audio-manifest.json");
const sourceInfo = frozen(sub + "/source-info.json");
const mediaIdentity = frozen(sub + "/media-identity.json");
const mediaNames = [
  ...new Set(
    [
      mediaIdentity.title,
      mediaIdentity.originalTitle,
      mediaIdentity.episodeTitle,
    ].filter(Boolean),
  ),
];
if (mediaNames.some((name) => !manifest.sourceVideo.fileName.includes(name)))
  throw new Error("Legacy title prompt cannot be justified by media filename");
if (sourceInfo.format.startTime !== 0)
  throw new Error(
    "This historical importer requires a proven zero media origin",
  );
const canonical = frozen(sub + "/canonical-asr-segments.json");
const repetitions = frozen(sub + "/intra-cue-repetition-repair.json");
const cacheManifest = frozen(sub + "/asr-cache-manifest.json");
const stablePath = path.join(
  stableRoot,
  ss,
  "subtitle-package.needs-review.json",
);
const stable = subtitlePackageSchema.parse(record(stablePath));
if (
  stable.primarySubtitle.validationStatus !== "needs-review" ||
  stable.primarySubtitle.sourceType !== "transcription" ||
  stable.referenceSubtitles.length
)
  throw new Error("Not a machine-only stable package");
const stableFreeze = record(
  path.join(
    stableRoot,
    "c6-0-1-14-5-2-machine-scorability-playback-freeze.json",
  ),
);
if (
  stableFreeze.sourceIdentity.sourceMediaSha256 !==
    manifest.sourceVideo.sha256 ||
  hashAsrDecodeConfiguration(
    stable.cues.map((c) => ({ id: c.id, text: c.text })),
  ) !== stableFreeze.canonicalTextHash ||
  hashAsrDecodeConfiguration(
    stable.cues.map((c) => ({ id: c.id, start: c.start, end: c.end })),
  ) !== stableFreeze.canonicalTimingHash
)
  throw new Error("Stable canonical freeze mismatch");
const exportHashes = {};
for (const [ext, parse] of Object.entries({
  ass: parseAss,
  srt: parseSrt,
  vtt: parseVtt,
})) {
  const relative = stable.subtitleFiles[ext];
  if (!relative || path.isAbsolute(relative) || relative.includes(".."))
    throw new Error("Unsafe subtitle reference");
  const p = path.join(stableRoot, ss, relative),
    b = fs.readFileSync(p);
  files.set(p, sha(b));
  exportHashes[ext] = sha(b);
  const cues = parse(b.toString());
  if (
    cues.length !== stable.cues.length ||
    cues.some(
      (c, i) =>
        c.text.replace(/\n/g, "") !== stable.cues[i].text.replace(/\n/g, "") ||
        Math.abs(c.start - stable.cues[i].start) > 0.011 ||
        Math.abs(c.end - stable.cues[i].end) > 0.011,
    )
  )
    throw new Error("Stable serialized canonical mismatch " + ext);
}
const primaryRequests = raw.chunks.map((chunk) => {
  const request = cacheManifest.entries.find(
    (e) => e.requestId === "baseline:" + chunk.chunkId,
  );
  if (!request) throw new Error("Missing primary request");
  const rel =
    "isolated-asr-cache/" +
    request.currentKey.slice(0, 2) +
    "/" +
    request.currentKey +
    ".json";
  const entry = portableAsrCacheEntryV2Schema.parse(frozen(rel));
  const audio = audioManifest.chunks.find((c) => c.id === chunk.chunkId);
  if (
    !audio ||
    audio.sha256 !== entry.identity.audioContentSha256 ||
    audio.start !== chunk.start ||
    audio.end !== chunk.end ||
    audioManifest.sampleRate !== entry.identity.extraction.sampleRate ||
    audioManifest.audioStreamIndex !==
      stableFreeze.sourceIdentity.audioStreamIndex
  )
    throw new Error("Primary extraction/cache audio identity mismatch");
  const wavPath = path.resolve(primaryRoot, "audio", audio.relativePath);
  if (!wavPath.startsWith(path.resolve(primaryRoot, "audio") + path.sep))
    throw new Error("Audio path escaped frozen task");
  const wavBytes = fs.readFileSync(wavPath);
  if (sha(wavBytes) !== audio.sha256)
    throw new Error("Physical primary WAV hash mismatch");
  files.set(wavPath, sha(wavBytes));
  const genericPrompt =
    "Transcribe only speech that is audibly present. Preserve the original spoken language; do not translate. Do not invent dialogue for silence or inaudible audio. Preserve natural punctuation and code-switching.";
  const legacyPrompt =
    genericPrompt +
    (mediaNames.length
      ? ` Confirmed names and terms: ${mediaNames.join(", ")}.`
      : "");
  if (entry.identity.promptSha256 !== sha(legacyPrompt))
    throw new Error(
      "Primary prompt is not reproducible from generic instructions and media filename",
    );
  if (
    entry.cacheKey !== request.currentKey ||
    buildPortableAsrCacheKey(entry.identity) !== request.currentKey ||
    hashAsrDecodeConfiguration(entry.result) !== entry.resultSha256 ||
    hashAsrDecodeConfiguration(entry.result) !==
      hashAsrDecodeConfiguration(chunk.result)
  )
    throw new Error("Cache identity/result mismatch");
  if (
    entry.identity.extractedIntervalMilliseconds.start !==
      Math.round(chunk.start * 1000) ||
    entry.identity.extractedIntervalMilliseconds.end !==
      Math.round(chunk.end * 1000)
  )
    throw new Error("Extraction offset mismatch");
  return {
    id: request.requestId,
    cacheKey: entry.cacheKey,
    cacheFileHash: files.get(path.join(primaryRoot, rel)),
    audioHash: entry.identity.audioContentSha256,
    resultHash: entry.resultSha256,
    modelHash: entry.identity.modelHash,
    model: entry.identity.model,
    runtime: entry.identity.whisperCppVersion,
    tokenizer: null,
    promptHash: entry.identity.promptSha256,
    decodeHash: entry.identity.decodeConfigurationSha256,
    sampleRate: entry.identity.extraction.sampleRate,
    interval: { start: chunk.start, end: chunk.end },
    timebase: "original-audio-local",
    vadEnabled: false,
    segments: chunk.result.segments.map((s, i) => ({
      id: chunk.chunkId + "-raw-" + String(i + 1).padStart(4, "0"),
      start: s.start,
      end: s.end,
      text: s.text,
    })),
  };
});
const mapped = primaryRequests.flatMap((r) =>
  r.segments.map((s) => ({
    ...s,
    start: s.start + r.interval.start,
    end: s.end + r.interval.start,
  })),
);
if (
  mapped.length !== canonical.rawSegments.length ||
  mapped.some(
    (c, i) =>
      c.id !== canonical.rawSegments[i].id ||
      c.text !== canonical.rawSegments[i].text ||
      Math.abs(c.start - canonical.rawSegments[i].start) > 0.00001 ||
      Math.abs(c.end - canonical.rawSegments[i].end) > 0.00001,
  )
)
  throw new Error("Primary transform does not reproduce canonical raw track");
const evidence = machineQualityEvidenceSchema.parse({
  version: "c60116-evidence-v1",
  partition: "development-known",
  source: {
    sha256: manifest.sourceVideo.sha256,
    durationSeconds: stable.source.durationSeconds,
    audioStream: stableFreeze.sourceIdentity.audioStreamIndex,
    sourceSampleRate: stableFreeze.sourceIdentity.sampleRate,
    mediaStart: sourceInfo.format.startTime,
    fileName: manifest.sourceVideo.fileName,
  },
  primaryRequests,
  canonicalLineage: canonical.utterances.map((c) => ({
    id: c.id,
    rawSegmentIds: c.sourceSegmentIds,
  })),
  stableCues: stable.cues,
  unprovenRepetition: repetitions.records
    .filter(
      (r) =>
        r.removedSpans.length &&
        r.audioRepetitionEvidence.includes(
          "no-independent-token-timestamps-for-second-utterance",
        ),
    )
    .map((r) => ({
      cueId: r.cueId,
      outputCueIds: r.outputCueIds,
      removedText: r.removedSpans.map((s) => s.text),
      reason: "no-independent-token-timestamps-for-second-utterance",
    })),
  provenance: {
    baselineCommit: "d9fd3c0b0fd5bd3d02088140e587750f85fd13dc",
    stablePackageHash: files.get(stablePath),
    stableAssHash: exportHashes.ass,
    stableSrtHash: exportHashes.srt,
    stableVttHash: exportHashes.vtt,
    primaryArtifactHash: files.get(
      path.join(primaryRoot, "audio/raw-transcription.json"),
    ),
    canonicalArtifactHash: files.get(
      path.join(primaryRoot, sub, "canonical-asr-segments.json"),
    ),
    repetitionArtifactHash: files.get(
      path.join(primaryRoot, sub, "intra-cue-repetition-repair.json"),
    ),
    inputManifestHash: files.get(
      path.join(primaryRoot, "blind-generation-input-manifest.json"),
    ),
    stableReplay: "historical-canonical-verified-not-full-pipeline-replayed",
    humanInputCount: 0,
  },
});
fs.writeFileSync(dest, JSON.stringify(evidence, null, 2), { flag: "wx" });
fs.writeFileSync(
  dest + ".inputs.json",
  JSON.stringify(
    {
      protectedInputs: [...files].map(([file, sha256]) => ({ file, sha256 })),
      evidenceHash: sha(fs.readFileSync(dest)),
      primaryCacheEntriesVerified: primaryRequests.length,
      newASRRequests: 0,
      modelLoads: 0,
    },
    null,
    2,
  ),
  { flag: "wx" },
);
console.log(
  "Prepared frozen machine evidence:",
  primaryRequests.length,
  "primary requests;",
  mapped.length,
  "raw segments;",
  stable.cues.length,
  "stable cues",
);
