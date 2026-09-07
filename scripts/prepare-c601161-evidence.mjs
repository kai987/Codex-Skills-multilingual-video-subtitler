import fs from "node:fs";
import path from "node:path";
import {
  machineQualityEvidenceSchema,
  sha256,
  objectHash,
} from "../packages/video-subtitler/dist/machine-quality/experimental-profile.js";
import { matchedEvidenceSchema } from "../packages/video-subtitler/dist/machine-quality/matched-replay.js";
import { portableAsrCacheEntryV2Schema } from "../packages/shared/dist/index.js";
import {
  buildPortableAsrCacheKey,
  hashAsrDecodeConfiguration,
} from "../packages/transcription-core/dist/index.js";
const [legacyArg, receiptArg, destArg] = process.argv.slice(2);
if (!legacyArg || !receiptArg || !destArg)
  throw new Error(
    "Usage: prepare-c601161-evidence.mjs verified-c60116-evidence.json its-input-receipt.json new-primary-evidence.json",
  );
const legacyBytes = fs.readFileSync(legacyArg),
  receipt = JSON.parse(fs.readFileSync(receiptArg));
if (sha256(legacyBytes) !== receipt.evidenceHash)
  throw new Error("Legacy evidence receipt mismatch");
const e = machineQualityEvidenceSchema.parse(JSON.parse(legacyBytes));
const inputs = receipt.protectedInputs;
for (const f of inputs)
  if (sha256(fs.readFileSync(f.file)) !== f.sha256)
    throw new Error("Protected input changed: " + f.file);
const rawFile = inputs.find((f) =>
  f.file.endsWith("/audio/raw-transcription.json"),
);
if (!rawFile) throw new Error("Original raw request results absent");
const raw = JSON.parse(fs.readFileSync(rawFile.file));
const verified = [];
for (const r of e.primaryRequests) {
  const c = raw.chunks.find((c) => "baseline:" + c.chunkId === r.id);
  const cacheFile = inputs.find(
    (f) =>
      path.basename(f.file) === r.cacheKey + ".json" &&
      f.sha256 === r.cacheFileHash,
  );
  if (!c || !cacheFile) throw new Error("Missing original request/cache");
  const entry = portableAsrCacheEntryV2Schema.parse(
    JSON.parse(fs.readFileSync(cacheFile.file)),
  );
  const segments = c.result.segments.map((s, i) => ({
    id: c.chunkId + "-raw-" + String(i + 1).padStart(4, "0"),
    start: s.start,
    end: s.end,
    text: s.text,
  }));
  if (
    objectHash(segments) !== objectHash(r.segments) ||
    c.start !== r.interval.start ||
    c.end !== r.interval.end ||
    buildPortableAsrCacheKey(entry.identity) !== r.cacheKey ||
    hashAsrDecodeConfiguration(entry.result) !== r.resultHash ||
    hashAsrDecodeConfiguration(c.result) !== r.resultHash ||
    entry.identity.promptSha256 !== r.promptHash ||
    entry.identity.decodeConfigurationSha256 !== r.decodeHash ||
    entry.identity.audioContentSha256 !== r.audioHash ||
    entry.identity.modelHash !== r.modelHash ||
    !inputs.some((f) => f.file.endsWith(".wav") && f.sha256 === r.audioHash)
  )
    throw new Error("Machine request identity mismatch");
  verified.push({
    requestId: r.id,
    cacheKey: r.cacheKey,
    audioHash: r.audioHash,
    segmentHash: objectHash(segments),
  });
}
const projected = matchedEvidenceSchema.parse({
  version: "c601161-primary-evidence-v1",
  partition: e.partition,
  source: e.source,
  primaryRequests: e.primaryRequests,
  promptStatus: "HISTORICAL_TITLE_PROMPTED_EVIDENCE",
});
fs.writeFileSync(destArg, JSON.stringify(projected, null, 2), { flag: "wx" });
fs.writeFileSync(
  destArg + ".inputs.json",
  JSON.stringify(
    {
      evidenceHash: sha256(fs.readFileSync(destArg)),
      sourceEvidenceHash: sha256(legacyBytes),
      protectedInputs: [
        ...inputs,
        { file: path.resolve(legacyArg), sha256: sha256(legacyBytes) },
        {
          file: path.resolve(receiptArg),
          sha256: sha256(fs.readFileSync(receiptArg)),
        },
      ],
      verified,
      exactPrimaryCacheEntriesVerified: verified.length,
      stripped: [
        "stableCues",
        "canonicalLineage",
        "unprovenRepetition",
        "historicalProvenance",
      ],
      newInference: 0,
      modelLoads: 0,
    },
    null,
    2,
  ),
  { flag: "wx" },
);
console.log("Verified and projected primary-only evidence:", verified.length);
