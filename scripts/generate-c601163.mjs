import fs from "node:fs";
import {
  storedBundleSchema,
  consumeStoredWhisper,
  decideStoredSpan,
  STORED_TOKEN_POLICY,
} from "../packages/video-subtitler/dist/machine-quality/stored-token-span.js";
import { Buffer } from "node:buffer";
import path from "node:path";
import { subtitlePackageSchema } from "../packages/shared/dist/index.js";
import {
  formatAss,
  formatSrt,
  formatVtt,
  parseAss,
  parseSrt,
  parseVtt,
} from "../packages/subtitle-core/dist/index.js";
import {
  replayPrimaryAssembly,
  matchedEvidenceSchema,
} from "../packages/video-subtitler/dist/machine-quality/matched-replay.js";
import {
  acousticBundleSchema,
  ACOUSTIC_POLICY,
  deriveAcousticCases,
  decideAcoustic,
  exportDiff,
} from "../packages/video-subtitler/dist/machine-quality/bounded-acoustic.js";
import {
  objectHash,
  sha256,
} from "../packages/video-subtitler/dist/machine-quality/experimental-profile.js";
const [primaryFile, oldBundleFile, bundleFile, output] = process.argv.slice(2);
const primaryBytes = fs.readFileSync(primaryFile),
  bundleBytes = fs.readFileSync(bundleFile);
const primary = matchedEvidenceSchema.parse(JSON.parse(primaryBytes)),
  bundle = storedBundleSchema.parse(JSON.parse(bundleBytes)),
  oldBytes = fs.readFileSync(oldBundleFile),
  old = acousticBundleSchema.parse(JSON.parse(oldBytes));
if (
  bundle.primaryHash !== sha256(primaryBytes) ||
  bundle.policyHash !== objectHash(STORED_TOKEN_POLICY) ||
  bundle.oldEvidenceHash !== sha256(oldBytes) ||
  old.policyHash !== objectHash(ACOUSTIC_POLICY) ||
  old.primaryHash !== bundle.primaryHash
)
  throw Error("Evidence policy mismatch");
const legacy = replayPrimaryAssembly(primary, false),
  preserved = replayPrimaryAssembly(primary, true);
const cases = deriveAcousticCases(
  legacy.trace,
  preserved.trace,
  primary.source.sourceSampleRate,
);
if (objectHash(cases) !== objectHash(bundle.cases))
  throw Error("Case lineage mismatch");
if (objectHash(cases) !== objectHash(old.cases))
  throw Error("Old case lineage mismatch");
for (const o of bundle.observations) {
  const regenerated = consumeStoredWhisper(o.rawResponse, {
    requestId: o.requestId,
    caseBindingHash: o.caseBindingHash,
    windowId: o.windowId,
    audioHash: o.audioHash,
    window: o.window,
    rawFileHash: o.rawFileHash,
    sourceRequestIds: o.sourceRequestIds,
    occurrenceIds: o.occurrenceIds,
  });
  if (objectHash(regenerated) !== objectHash(o))
    throw Error("Stored observation source mapping mismatch");
}
const oldDecisions = cases.map((c) => decideAcoustic(c, old.observations));
const decisions = cases.map((c) =>
  decideStoredSpan(c, bundle.observations, old.observations),
);
fs.mkdirSync(output);
const files = [];
const json = (v) =>
  JSON.stringify(v, (k, v) => (k === "generatedAt" ? undefined : v), 2);
const write = (p, v) => {
  const bytes = typeof v === "string" ? v : json(v);
  fs.mkdirSync(path.dirname(path.join(output, p)), { recursive: true });
  fs.writeFileSync(path.join(output, p), bytes, { flag: "wx" });
  files.push({
    path: p,
    sha256: sha256(bytes),
    size: Buffer.byteLength(bytes),
  });
};
const summaries = [],
  all = {};
const implementationHash = sha256(
  fs.readFileSync(
    new URL(
      "../packages/video-subtitler/dist/machine-quality/stored-token-span.js",
      import.meta.url,
    ),
  ),
);
for (const [variant, mode] of [
  ["S0-legacy-policy", "legacy"],
  ["S1-token-observe", "observe"],
  ["S2-token-apply", "apply"],
]) {
  const result = replayPrimaryAssembly(
    primary,
    true,
    { repairIntraCueHypothesisRepetition: implementationHash },
    mode === "legacy" ? { mode: "apply", decisions: oldDecisions } : undefined,
    mode === "legacy" ? undefined : { mode, decisions },
  );
  const cues = result.cues;
  all[variant] = cues;
  const escaped = cues.map((c) => ({
    ...c,
    text: c.text
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;"),
  }));
  const rendered = {
    ass: formatAss(cues),
    srt: formatSrt(escaped),
    vtt: formatVtt(escaped),
  };
  for (const [ext, parser] of Object.entries({
    ass: parseAss,
    srt: parseSrt,
    vtt: parseVtt,
  })) {
    write(`${variant}/machine-candidate.${ext}`, rendered[ext]);
    const readback = parser(
      fs.readFileSync(
        path.join(output, variant, `machine-candidate.${ext}`),
        "utf8",
      ),
    );
    if (
      readback.length !== cues.length ||
      readback.some(
        (c, i) =>
          c.text.replace(/\r?\n/gu, "") !==
            cues[i].text.replace(/\r?\n/gu, "").trim() ||
          Math.abs(c.start - cues[i].start) >
            (ext === "ass" ? 0.011 : 0.0011) ||
          Math.abs(c.end - cues[i].end) > (ext === "ass" ? 0.011 : 0.0011),
      )
    )
      throw Error("Serialization roundtrip failed");
  }
  const pkg = subtitlePackageSchema.parse({
    schemaVersion: "1.0.0",
    packageType: "multilingual-subtitle-package",
    status: "ready",
    sourceLanguage: "ja",
    detectedLanguages: ["ja"],
    source: {
      fileName: primary.source.fileName,
      container: "matroska",
      durationSeconds: primary.source.durationSeconds,
    },
    identity: { title: null, season: null, episode: null, year: null },
    primarySubtitle: {
      language: "ja",
      sourceType: "transcription",
      validationStatus: "needs-review",
      streamIndex: primary.source.audioStream,
    },
    subtitleFiles: {
      ass: "./machine-candidate.ass",
      srt: "./machine-candidate.srt",
      vtt: "./machine-candidate.vtt",
    },
    referenceSubtitles: [],
    video: { sourcePath: null, subtitledPath: null },
    cues,
    warnings: [
      "PRIMARY_ONLY_MATCHED_PROFILE",
      "ACOUSTIC_MACHINE_OBSERVATIONS_NOT_HUMAN_TRUTH",
      "NOT_RELEASE_AUTHORIZED",
    ],
  });
  write(`${variant}/subtitle-package.needs-review.json`, pkg);
  write(`${variant}/stage-trace.json`, result.trace);
  write(
    `${variant}/mutation-journal.json`,
    (mode === "legacy" ? oldDecisions : decisions).map((d) => ({
      ...d,
      applied:
        mode === "apply" && d.action === "REPLACE_BOUND_SOURCE_TEXT_SPAN",
    })),
  );
  const summary = {
    variant,
    cueCount: cues.length,
    primaryHash: bundle.primaryHash,
    acousticEvidenceHash: sha256(bundleBytes),
    textHash: objectHash(cues.map((c) => c.text)),
    timingHash: objectHash(cues.map((c) => [c.start, c.end])),
    presentationHash: objectHash(rendered),
    status: "needs-review",
    finalizationMethod: "none",
    machineOnlyReleaseAuthorized: false,
    humanValidated: false,
    defaultPromotionAuthorized: false,
  };
  write(`${variant}/generation-state.json`, summary);
  summaries.push(summary);
}
if (objectHash(all["S0-legacy-policy"]) !== objectHash(all["S1-token-observe"]))
  throw Error("Observe changed source preserving cues");
write("decisions.json", decisions);
write(
  "export-diff.json",
  exportDiff(all["S0-legacy-policy"], all["S2-token-apply"]),
);
write("decision-policy.json", STORED_TOKEN_POLICY);
write(
  "OUTPUT_INDEX.md",
  "# Stored token experiment\n\nS0 reexecutes the frozen old policy. S1 consumes new tokens without application. S2 enables the source-bound text hook before existing segmentation and layout. All are needs-review. No models, providers or media decoding execute.\n",
);
fs.writeFileSync(
  path.join(output, "experiment-manifest.json"),
  json({
    version: "c601163-generation-v1",
    primaryHash: bundle.primaryHash,
    acousticEvidenceHash: sha256(bundleBytes),
    oldEvidenceHash: bundle.oldEvidenceHash,
    policyHash: bundle.policyHash,
    variants: summaries,
    files,
    freezeCompletedAt: new Date().toISOString(),
    newInference: 0,
    modelLoads: 0,
    providerStarts: 0,
    newRecognitionAttempts: 0,
    newDecodedAudioSeconds: 0,
    scope: "PRIMARY_ONLY_MATCHED_PROFILE",
  }),
  { flag: "wx" },
);
console.log("Generated S0/S1/S2", files.length);
