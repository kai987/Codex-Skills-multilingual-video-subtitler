import path from "node:path";

import {
  type LanguageTag,
  type MediaIdentity,
  subtitlePackageSchema,
  type SubtitleCue,
  type SubtitlePackage,
} from "@mvl/shared";

import type { MediaStreamInfo, SourceInfo } from "./types.js";

function detectedLanguages(cues: readonly SubtitleCue[]): LanguageTag[] {
  return [
    ...new Set(
      cues.flatMap((cue) =>
        cue.language === "mixed" ? cue.languages : [cue.language],
      ),
    ),
  ];
}

function sourceLanguage(cues: readonly SubtitleCue[]): LanguageTag {
  const languages = detectedLanguages(cues).filter(
    (language) => language !== "und",
  );
  if (languages.length === 0) return "und";
  return languages.length === 1 ? (languages[0] ?? "und") : "mixed";
}

export function createSubtitlePackage(input: {
  sourceInfo: SourceInfo;
  identity: MediaIdentity;
  selectedStream: MediaStreamInfo | null;
  cues: readonly SubtitleCue[];
  files: { srt: string | null; vtt: string | null; ass: string | null };
  primarySubtitle?: {
    language: LanguageTag;
    sourceType: "embedded" | "online" | "transcription";
    validationStatus: "validated" | "needs-review" | "rejected";
    streamIndex: number | null;
  } | null;
  referenceSubtitles?: SubtitlePackage["referenceSubtitles"];
  subtitledPath?: string | null;
  status: SubtitlePackage["status"];
  warnings: readonly string[];
  transcription?: SubtitlePackage["transcription"];
  referenceGuidance?: SubtitlePackage["referenceGuidance"];
}): SubtitlePackage {
  const cueLanguage = sourceLanguage(input.cues);
  const primaryLanguage =
    input.selectedStream?.language !== undefined &&
    input.selectedStream.language !== "und"
      ? input.selectedStream.language
      : cueLanguage;
  const relative = (value: string | null): string | null =>
    value === null ? null : `./${path.basename(value)}`;
  const value: SubtitlePackage = {
    schemaVersion: "1.0.0",
    packageType: "multilingual-subtitle-package",
    status: input.status,
    sourceLanguage: cueLanguage,
    detectedLanguages: detectedLanguages(input.cues),
    source: {
      fileName: input.sourceInfo.fileName,
      container: input.sourceInfo.format.names[0] ?? null,
      durationSeconds: input.sourceInfo.format.durationSeconds,
    },
    identity: {
      title: input.identity.title,
      season: input.identity.season,
      episode: input.identity.episode,
      year: input.identity.year,
    },
    primarySubtitle:
      input.primarySubtitle !== undefined
        ? input.primarySubtitle
        : input.selectedStream === null
          ? null
          : {
              language: primaryLanguage,
              sourceType: "embedded",
              validationStatus: "validated",
              streamIndex: input.selectedStream.index,
            },
    subtitleFiles: {
      srt: relative(input.files.srt),
      vtt: relative(input.files.vtt),
      ass: relative(input.files.ass),
    },
    referenceSubtitles: input.referenceSubtitles ?? [],
    video: {
      sourcePath: null,
      subtitledPath:
        input.subtitledPath === undefined ? null : input.subtitledPath,
    },
    cues: [...input.cues],
    warnings: [...input.warnings],
    ...(input.referenceGuidance === undefined
      ? {}
      : { referenceGuidance: input.referenceGuidance }),
    ...(input.transcription === undefined
      ? {}
      : { transcription: input.transcription }),
  };
  return subtitlePackageSchema.parse(value);
}
