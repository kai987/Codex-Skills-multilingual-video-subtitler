import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { subtitlePackageSchema } from "../packages/shared/dist/index.js";
import {
  formatAss,
  formatSrt,
  formatVtt,
  parseAss,
  parseSrt,
  parseVtt,
} from "../packages/subtitle-core/dist/index.js";
import { primaryMinimal } from "../packages/video-subtitler/dist/machine-quality/experimental-profile.js";
import {
  freshMatchedEvidenceSchema,
  replayPrimaryAssembly,
  REPLAY_SCOPE,
} from "../packages/video-subtitler/dist/machine-quality/matched-replay.js";
import {
  read,
  write as writeBytes,
  oh,
  digest,
  VARIANTS,
} from "./c60117-common.mjs";
const write = (p, v) =>
  writeBytes(
    p,
    typeof v === "string"
      ? v
      : JSON.stringify(v, (k, x) => (k === "generatedAt" ? undefined : x), 2),
  );
const [input, configFile, output] = process.argv.slice(2);
const e = freshMatchedEvidenceSchema.parse(read(input));
const config = z
  .object({
    partition: z.enum(["D", "C"]),
    runName: z.string().regex(/^[a-zA-Z0-9-]+$/),
    repair: z.enum(["none", "occurrence-overlap-required"]),
  })
  .strict()
  .parse(read(configFile));
const hashes = Object.fromEntries(
  Object.entries({
    primaryMinimal:
      "video-subtitler/dist/machine-quality/experimental-profile.js",
    deduplicateTopScoreWinners:
      "transcription-core/dist/winner-deduplication.js",
    repairIntraCueHypothesisRepetition:
      "transcription-core/dist/intra-cue-repetition.js",
    buildAcousticSemanticCueSegments: "subtitle-core/dist/segmentation.js",
    layoutSubtitleCuesWithDiagnostics: "subtitle-core/dist/layout.js",
  }).map(([s, p]) => [
    s,
    digest(fs.readFileSync(new URL("../packages/" + p, import.meta.url))),
  ]),
);
const current = replayPrimaryAssembly(e, false, hashes);
const candidate =
  config.repair === "none"
    ? replayPrimaryAssembly(e, false, hashes)
    : replayPrimaryAssembly(e, false, hashes, undefined, undefined, undefined, {
        deduplication: "overlap-required",
      });
const views = [
  { cues: primaryMinimal(e), trace: [] },
  current,
  candidate,
  replayPrimaryAssembly(e, false, hashes),
];
for (const [index, variant] of VARIANTS.entries()) {
  const v = views[index],
    cues = v.cues;
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
    const f = path.join(output, variant, "machine-candidate." + ext);
    write(f, rendered[ext]);
    const back = parser(fs.readFileSync(f, "utf8"));
    if (
      back.length !== cues.length ||
      back.some(
        (c, i) =>
          c.text.replace(/\s/gu, "") !== cues[i].text.replace(/\s/gu, "") ||
          Math.abs(c.start - cues[i].start) >
            (ext === "ass" ? 0.011 : 0.0011) ||
          Math.abs(c.end - cues[i].end) > (ext === "ass" ? 0.011 : 0.0011),
      )
    )
      throw Error("Export roundtrip failed");
  }
  const pkg = subtitlePackageSchema.parse({
    schemaVersion: "1.0.0",
    packageType: "multilingual-subtitle-package",
    status: "ready",
    sourceLanguage: "ja",
    detectedLanguages: ["ja"],
    source: {
      fileName: "source-media",
      container: "matroska",
      durationSeconds: e.source.durationSeconds,
    },
    identity: { title: null, season: null, episode: null, year: null },
    primarySubtitle: {
      language: "ja",
      sourceType: "transcription",
      validationStatus: "needs-review",
      streamIndex: e.source.audioStream,
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
      "MATCHED_AVAILABLE_PROFILE",
      "EXPERIMENTAL_CLIP_NOT_FULL_EPISODE",
      "NOT_RELEASE_AUTHORIZED",
    ],
  });
  write(path.join(output, variant, "subtitle-package.needs-review.json"), pkg);
  write(path.join(output, variant, "stage-trace.json"), v.trace);
  write(path.join(output, variant, "generation-state.json"), {
    variant,
    repair: variant === VARIANTS[2] ? config.repair : "none",
    evidenceHash: oh(e),
    textHash: oh(cues.map((c) => c.text)),
    timingHash: oh(cues.map((c) => [c.start, c.end])),
    presentationHash: oh(rendered),
    cueCount: cues.length,
    status: "needs-review",
    finalizationMethod: "none",
    humanValidated: false,
    defaultPromotionAuthorized: false,
    machineOnlyReleaseAuthorized: false,
  });
}
write(path.join(output, "profile.json"), {
  scope: "MATCHED_AVAILABLE_PROFILE",
  fixedPrimary: "fresh Whisper singleton",
  secondAsrRole: "AUX untimed transcript only; no invented segment intervals",
  executedChain: REPLAY_SCOPE.executedChain,
  unavailableOrDisabled: REPLAY_SCOPE.unavailableOrDisabled,
  repair: config.repair,
  generatorInputs: ["fresh primary clip evidence", "strict non-Gold config"],
  newInference: 0,
});
