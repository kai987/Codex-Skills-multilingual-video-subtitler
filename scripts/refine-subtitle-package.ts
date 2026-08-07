import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  atomicWriteFile,
  atomicWriteJson,
  detectTextLanguage,
  subtitlePackageSchema,
  transcriptionRefinementSchema,
  type SubtitleCue,
} from "@mvl/shared";
import {
  formatAss,
  formatSrt,
  formatVtt,
  layoutSubtitleCues,
  normalizeSubtitleCues,
  parseAss,
  parseSrt,
  parseVtt,
} from "@mvl/subtitle-core";

function required(
  values: Record<string, string | boolean | undefined>,
  key: string,
): string {
  const value = values[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing required --${key} option.`);
  }
  return value;
}

function seconds(
  values: Record<string, string | boolean | undefined>,
  key: string,
): number {
  const value = Number(required(values, key));
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`--${key} must be a non-negative number.`);
  }
  return value;
}

function artifactPath(
  packageDirectory: string,
  relativePath: string | null,
): string | null {
  if (relativePath === null) return null;
  const resolved = path.resolve(packageDirectory, relativePath);
  const prefix = `${path.resolve(packageDirectory)}${path.sep}`;
  if (!resolved.startsWith(prefix)) {
    throw new Error(
      `Subtitle artifact escapes its package directory: ${relativePath}`,
    );
  }
  return resolved;
}

const parsed = parseArgs({
  options: {
    package: { type: "string" },
    "replacement-srt": { type: "string" },
    "replace-start": { type: "string" },
    "replace-end": { type: "string" },
    "replacement-min-start": { type: "string" },
    "music-start": { type: "string" },
    "music-end": { type: "string" },
    "music-replacement-srt": { type: "string" },
    "music-replace-start": { type: "string" },
    "music-replace-end": { type: "string" },
    "music-label": { type: "string" },
    "music-label-start": { type: "string" },
    "music-label-end": { type: "string" },
    corrections: { type: "string" },
    "thought-start": { type: "string" },
    "thought-end": { type: "string" },
    model: { type: "string" },
  },
  strict: true,
});

const values = parsed.values as Record<string, string | boolean | undefined>;
const packagePath = path.resolve(required(values, "package"));
const replacementPath = path.resolve(required(values, "replacement-srt"));
const replaceStart = seconds(values, "replace-start");
const replaceEnd = seconds(values, "replace-end");
const replacementMinimumStart = seconds(values, "replacement-min-start");
const musicStart = seconds(values, "music-start");
const musicEnd = seconds(values, "music-end");
const musicReplacementPath = path.resolve(
  required(values, "music-replacement-srt"),
);
const musicReplaceStart = seconds(values, "music-replace-start");
const musicReplaceEnd = seconds(values, "music-replace-end");
const musicLabel = required(values, "music-label");
const musicLabelStart = seconds(values, "music-label-start");
const musicLabelEnd = seconds(values, "music-label-end");
const correctionsPath = path.resolve(required(values, "corrections"));
const thoughtStart = seconds(values, "thought-start");
const thoughtEnd = seconds(values, "thought-end");
const model = required(values, "model");
if (
  replaceEnd <= replaceStart ||
  musicEnd <= musicStart ||
  musicReplaceStart > musicStart ||
  musicReplaceEnd <= musicEnd ||
  musicLabelEnd <= musicLabelStart ||
  thoughtEnd <= thoughtStart
) {
  throw new Error("Every refinement interval must have a positive duration.");
}

const subtitlePackage = subtitlePackageSchema.parse(
  JSON.parse(await readFile(packagePath, "utf8")),
);
const rawCorrections = JSON.parse(
  await readFile(correctionsPath, "utf8"),
) as unknown;
if (!Array.isArray(rawCorrections)) {
  throw new Error("The corrections file must contain an array.");
}
const corrections = rawCorrections.map((entry: unknown, index) => {
  const candidate =
    typeof entry === "object" && entry !== null
      ? (entry as Record<string, unknown>)
      : null;
  const match = candidate?.match;
  const correctionReplacement = candidate?.replacement;
  if (
    typeof match !== "string" ||
    typeof correctionReplacement !== "string" ||
    match === "" ||
    correctionReplacement === ""
  ) {
    throw new Error(`Invalid correction at index ${index}.`);
  }
  return { match, replacement: correctionReplacement };
});
const replacement = normalizeSubtitleCues(
  parseSrt(await readFile(replacementPath, "utf8")),
)
  .cues.filter(
    (cue) =>
      cue.start >= replacementMinimumStart &&
      cue.start >= replaceStart &&
      cue.end <= replaceEnd,
  )
  .map((cue, index) => ({
    ...cue,
    id: `opening-replacement-${String(index + 1).padStart(3, "0")}`,
  }));
if (replacement.length === 0) {
  throw new Error("The selected opening replacement contains no cues.");
}

const musicReplacement = normalizeSubtitleCues(
  parseSrt(await readFile(musicReplacementPath, "utf8")),
)
  .cues.filter(
    (cue) => cue.start >= musicReplaceStart && cue.end <= musicReplaceEnd,
  )
  .map((cue, index) => ({
    ...cue,
    id: `music-replacement-${String(index + 1).padStart(3, "0")}`,
    ...(cue.start >= musicStart && cue.end <= musicEnd
      ? { style: "music" as const }
      : {}),
  }));
if (musicReplacement.length === 0) {
  throw new Error("The selected music replacement contains no cues.");
}

const retained = subtitlePackage.cues.filter(
  (cue) =>
    (cue.end <= replaceStart || cue.start >= replaceEnd) &&
    (cue.end <= musicReplaceStart || cue.start >= musicReplaceEnd),
);
const labelLanguage = detectTextLanguage(musicLabel);
const musicCue: SubtitleCue = {
  id: "music-identification",
  start: musicLabelStart,
  end: musicLabelEnd,
  language: labelLanguage.language,
  languages: labelLanguage.languages,
  text: musicLabel,
  style: "music",
  speaker: null,
  confidence: 1,
};
let appliedCorrections = 0;
const combined = [
  ...retained,
  ...replacement,
  ...musicReplacement,
  musicCue,
].map((cue) => {
  const correction = corrections.find((entry) => entry.match === cue.text);
  const alreadyCorrected = corrections.some(
    (entry) => entry.replacement === cue.text,
  );
  if (correction !== undefined || alreadyCorrected) appliedCorrections += 1;
  const text = correction?.replacement ?? cue.text;
  return cue.start >= thoughtStart &&
    cue.end <= thoughtEnd &&
    cue.style !== "music"
    ? { ...cue, text, style: "thought" as const }
    : { ...cue, text };
});
const laidOutCues = layoutSubtitleCues(
  combined.sort(
    (left, right) => left.start - right.start || left.end - right.end,
  ),
);
const confirmedLanguage = subtitlePackage.primarySubtitle?.language;
const cues = laidOutCues.map((cue) =>
  confirmedLanguage === "ja" &&
  cue.language === "zh" &&
  cue.languages.length === 1
    ? { ...cue, language: "ja" as const, languages: ["ja" as const] }
    : cue,
);
const detectedLanguages = [
  ...new Set(
    cues.flatMap((cue) =>
      cue.language === "mixed" ? cue.languages : [cue.language],
    ),
  ),
];
const sourceLanguage =
  detectedLanguages.length === 1 ? (detectedLanguages[0] ?? "und") : "mixed";

const packageDirectory = path.dirname(packagePath);
const srtPath = artifactPath(
  packageDirectory,
  subtitlePackage.subtitleFiles.srt,
);
const vttPath = artifactPath(
  packageDirectory,
  subtitlePackage.subtitleFiles.vtt,
);
const assPath = artifactPath(
  packageDirectory,
  subtitlePackage.subtitleFiles.ass,
);
if (srtPath !== null) {
  const content = formatSrt(cues);
  parseSrt(content);
  await atomicWriteFile(srtPath, content, { overwrite: true });
}
if (vttPath !== null) {
  const content = formatVtt(cues);
  parseVtt(content);
  await atomicWriteFile(vttPath, content, { overwrite: true });
}
if (assPath !== null) {
  const content = formatAss(cues);
  parseAss(content);
  await atomicWriteFile(assPath, content, { overwrite: true });
}

const refined = subtitlePackageSchema.parse({
  ...subtitlePackage,
  primarySubtitle:
    subtitlePackage.primarySubtitle?.sourceType === "transcription"
      ? {
          ...subtitlePackage.primarySubtitle,
          validationStatus: "needs-review" as const,
        }
      : subtitlePackage.primarySubtitle,
  sourceLanguage,
  detectedLanguages,
  cues,
  warnings: [
    ...subtitlePackage.warnings.filter(
      (warning) =>
        !warning.startsWith("Replaced ") &&
        !warning.startsWith("Marked ") &&
        !warning.startsWith("Applied "),
    ),
    `Replaced ${replaceStart}-${replaceEnd}s with a verified no-VAD opening diagnostic beginning at ${replacementMinimumStart}s.`,
    `Marked ${musicStart}-${musicEnd}s as music and identified ${musicLabel}.`,
    `Replaced ${musicReplaceStart}-${musicReplaceEnd}s with the no-VAD prologue/music/dialogue pass.`,
    `Applied ${appliedCorrections} evidence-backed transcription corrections.`,
    `Marked ${thoughtStart}-${thoughtEnd}s as verified internal thought.`,
  ],
});
await atomicWriteJson(packagePath, refined, { overwrite: true });
await atomicWriteJson(
  path.join(packageDirectory, "transcription-refinement.json"),
  transcriptionRefinementSchema.parse({
    schemaVersion: "1.0.0",
    strategy: "hybrid-vad",
    basePass: {
      adapter: "whisper-cpp",
      model,
      vadProfile: "sensitive-v2",
      timestampStrategy: "segment",
    },
    replacements: [
      {
        purpose: "opening-dialogue",
        start: replaceStart,
        end: replaceEnd,
        adapter: "whisper-cpp",
        model,
        vadEnabled: false,
      },
      {
        purpose: "prologue-music-dialogue",
        start: musicReplaceStart,
        end: musicReplaceEnd,
        adapter: "whisper-cpp",
        model,
        vadEnabled: false,
      },
    ],
    corrections: {
      relativePath: `./${path.basename(correctionsPath)}`,
      appliedCount: appliedCorrections,
    },
    music: {
      start: musicStart,
      end: musicEnd,
      label: musicLabel,
      source: "local-audio-and-authoritative-identification",
    },
    thought: {
      start: thoughtStart,
      end: thoughtEnd,
      style: "thought",
    },
  }),
  { overwrite: true },
);

console.log(
  JSON.stringify(
    {
      ok: true,
      packagePath,
      cueCount: cues.length,
      openingReplacementCues: replacement.length,
    },
    null,
    2,
  ),
);
