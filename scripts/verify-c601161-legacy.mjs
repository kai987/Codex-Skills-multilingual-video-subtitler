import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const [oldArg, inputArg, runArg, destArg] = process.argv.slice(2);
if (!oldArg || !inputArg || !runArg || !destArg)
  throw new Error(
    "Usage: verify-c601161-legacy.mjs clean-baseline-worktree primary-evidence.json current-run new-receipt.json",
  );
const old = path.resolve(oldArg);
const git = (...a) => execFileSync("git", a, { cwd: old, encoding: "utf8" });
if (
  git("rev-parse", "HEAD").trim() !==
    "948dc5e56f6dd53a2c52fe899cc70c6379427567" ||
  git("status", "--porcelain")
)
  throw new Error("Wrong or dirty historical implementation");
const hash = (b) => createHash("sha256").update(b).digest("hex");
const module = async (p) => import(pathToFileURL(path.join(old, p)).href);
const { primaryMinimal } = await module(
  "packages/video-subtitler/dist/machine-quality/experimental-profile.js",
);
const { deduplicateTopScoreWinners, repairIntraCueHypothesisRepetition } =
  await module("packages/transcription-core/dist/index.js");
const {
  buildAcousticSemanticCueSegments,
  layoutSubtitleCuesWithDiagnostics,
  formatAss,
  formatSrt,
  formatVtt,
} = await module("packages/subtitle-core/dist/index.js");
const e = JSON.parse(fs.readFileSync(inputArg));
const d = deduplicateTopScoreWinners(primaryMinimal(e), "pre-normalization");
const r = repairIntraCueHypothesisRepetition({ cues: d.cues });
const s = buildAcousticSemanticCueSegments(r.cues, {
  mode: "acoustic-semantic",
  japaneseTextAnalyzer: "intl-segmenter",
});
const p = layoutSubtitleCuesWithDiagnostics(s.cues, {
  segmentationMode: "presegmented",
  allowTemporalCueSplitting: false,
});
const html = p.cues.map((c) => ({
  ...c,
  text: c.text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;"),
}));
const files = {
  ass: formatAss(p.cues),
  srt: formatSrt(html),
  vtt: formatVtt(html),
};
for (const [ext, bytes] of Object.entries(files))
  if (
    bytes !==
    fs.readFileSync(
      path.join(runArg, "R1-legacy-replay/machine-candidate." + ext),
      "utf8",
    )
  )
    throw new Error("Framework changed legacy subtitle " + ext);
const modulePaths = [
  "packages/transcription-core/dist/intra-cue-repetition.js",
  "packages/transcription-core/src/intra-cue-repetition.ts",
  "packages/transcription-core/dist/winner-deduplication.js",
  "packages/subtitle-core/dist/segmentation.js",
  "packages/subtitle-core/dist/layout.js",
];
fs.writeFileSync(
  destArg,
  JSON.stringify(
    {
      passed: true,
      baselineCommit: git("rev-parse", "HEAD").trim(),
      executed: [
        "primaryMinimal",
        "deduplicateTopScoreWinners",
        "repairIntraCueHypothesisRepetition",
        "buildAcousticSemanticCueSegments",
        "layoutSubtitleCuesWithDiagnostics",
        "formatAss/formatSrt/formatVtt",
      ],
      oldImplementationModules: modulePaths.map((p) => ({
        file: p,
        sha256: hash(fs.readFileSync(path.join(old, p))),
      })),
      threeFormatByteParity: true,
      cueCount: p.cues.length,
      adapterEffect:
        "unique internal IDs only; no exported text, timing or style changes",
      historicalH1Reproduction: false,
      scope: "PRIMARY_ONLY_MATCHED_PROFILE",
    },
    null,
    2,
  ),
  { flag: "wx" },
);
console.log(
  "Independent old-worktree business replay matches R1 exported bytes",
);
