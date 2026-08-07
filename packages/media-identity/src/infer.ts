import path from "node:path";

import { type LanguageTag, type MediaIdentity } from "@mvl/shared";

export interface MediaIdentityOverrides {
  title?: string;
  originalTitle?: string;
  alternativeTitles?: readonly string[];
  mediaType?: MediaIdentity["mediaType"];
  season?: number;
  episode?: number;
  episodeTitle?: string;
  year?: number;
  releaseSource?: string;
  releaseGroup?: string;
  dialogueLanguages?: readonly LanguageTag[];
  primarySubtitleLanguages?: readonly LanguageTag[];
  referenceSubtitleLanguages?: readonly LanguageTag[];
}

export interface InferMediaIdentityInput {
  inputPath: string;
  durationSeconds: number | null;
  containerTitle?: string;
  detectedAudioLanguages?: readonly LanguageTag[];
  overrides?: MediaIdentityOverrides;
}

interface FilenameSignals {
  title: string | null;
  season: number | null;
  episode: number | null;
  year: number | null;
  releaseSource: string | null;
  releaseGroup: string | null;
}

const GENERIC_NAMES =
  /^(?:\d{1,3}|episode(?:[-_. ]?\d+)?|video|test|sample|input)$/iu;
const GENERIC_DIRECTORIES =
  /^(?:fixtures?|generated|input|inputs|output|outputs|temp|tmp|downloads?|videos?)$/iu;
const SEASON_EPISODE = /(?:^|[\s._-])S(\d{1,2})E(\d{1,3})(?:$|[\s._-])/iu;
const JAPANESE_EPISODE = /(?:第)?(\d{1,3})(?:話|集)/u;
const YEAR =
  /(?:^|[\s._(]|\[)(18(?:8[8-9]|9\d)|19\d{2}|20\d{2}|21\d{2})(?=$|[\s._)]|\])/u;
const RELEASE_SOURCE =
  /(?:Blu[-_. ]?ray|WEB[-_. ]?DL|WEB[-_. ]?Rip|HDTV|DVD|TVRip)/iu;
const RELEASE_GROUP = /-([\p{L}\p{N}][\p{L}\p{N}._-]{1,30})$/u;
const RESOLUTION =
  /(?:^|[\s._-])(?:480|576|720|1080|1440|2160)p(?:$|[\s._-])/iu;

function cleanTitle(value: string): string | null {
  const cleaned = value
    .replace(/\[[^\n]*?\]/gu, " ")
    .replace(/[._]+/gu, " ")
    .replace(/\s+/gu, " ")
    .replace(/^[\s-]+|[\s-]+$/gu, "")
    .trim();
  return cleaned === "" || GENERIC_NAMES.test(cleaned) ? null : cleaned;
}

function firstSignalIndex(stem: string): number {
  const patterns = [
    SEASON_EPISODE,
    JAPANESE_EPISODE,
    YEAR,
    RELEASE_SOURCE,
    RESOLUTION,
  ];
  const indexes = patterns
    .map((pattern) => {
      const match = pattern.exec(stem);
      return match?.index ?? -1;
    })
    .filter((index) => index >= 0);
  return indexes.length === 0 ? stem.length : Math.min(...indexes);
}

export function parseFilenameSignals(inputPath: string): FilenameSignals {
  const stem = path.basename(inputPath, path.extname(inputPath));
  const seasonEpisode = SEASON_EPISODE.exec(stem);
  const japaneseEpisode = JAPANESE_EPISODE.exec(stem);
  const yearMatch = YEAR.exec(stem);
  const releaseSourceMatch = RELEASE_SOURCE.exec(stem);
  const groupMatch = RELEASE_GROUP.exec(stem);

  return {
    title: cleanTitle(stem.slice(0, firstSignalIndex(stem))),
    season: seasonEpisode?.[1] === undefined ? null : Number(seasonEpisode[1]),
    episode:
      seasonEpisode?.[2] === undefined
        ? japaneseEpisode?.[1] === undefined
          ? null
          : Number(japaneseEpisode[1])
        : Number(seasonEpisode[2]),
    year: yearMatch?.[1] === undefined ? null : Number(yearMatch[1]),
    releaseSource:
      releaseSourceMatch?.[0] === undefined
        ? null
        : releaseSourceMatch[0].replace(/[._]/gu, "-"),
    releaseGroup: groupMatch?.[1] ?? null,
  };
}

function inferParentTitle(inputPath: string): string | null {
  const parent = path.basename(path.dirname(path.resolve(inputPath)));
  if (GENERIC_DIRECTORIES.test(parent) || GENERIC_NAMES.test(parent))
    return null;
  return cleanTitle(parent);
}

function nonEmptyOrNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? null : trimmed;
}

function defaultReferenceLanguages(
  primary: readonly LanguageTag[],
): LanguageTag[] {
  const values = new Set<LanguageTag>();
  const hasJapanese = primary.includes("ja");
  const hasEnglish = primary.includes("en");
  const hasChinese = primary.some((language) => language.startsWith("zh"));
  if (hasJapanese) {
    values.add("zh-Hans");
    values.add("zh-Hant");
    values.add("en");
  }
  if (hasEnglish) {
    values.add("zh-Hans");
    values.add("zh-Hant");
    values.add("ja");
  }
  if (hasChinese) {
    values.add("ja");
    values.add("en");
  }
  for (const language of primary) values.delete(language);
  return [...values];
}

export function inferMediaIdentity(
  input: InferMediaIdentityInput,
): MediaIdentity {
  const filename = parseFilenameSignals(input.inputPath);
  const overrides = input.overrides ?? {};
  const parentTitle =
    filename.title === null ? inferParentTitle(input.inputPath) : null;
  const containerTitle = cleanTitle(input.containerTitle ?? "");
  const inferredTitle = filename.title ?? containerTitle ?? parentTitle;
  const overrideTitle = nonEmptyOrNull(overrides.title);
  const title = overrideTitle ?? inferredTitle;
  const season = overrides.season ?? filename.season;
  const episode = overrides.episode ?? filename.episode;
  const year = overrides.year ?? filename.year;
  const mediaType =
    overrides.mediaType ??
    (season !== null || episode !== null ? "series" : "unknown");
  const detectedLanguages = (input.detectedAudioLanguages ?? []).filter(
    (language) => language !== "und" && language !== "mixed",
  );
  const dialogueLanguages = [
    ...new Set(overrides.dialogueLanguages ?? detectedLanguages),
  ];
  const primarySubtitleLanguages = [
    ...new Set(overrides.primarySubtitleLanguages ?? dialogueLanguages),
  ];
  const referenceSubtitleLanguages = [
    ...new Set(
      overrides.referenceSubtitleLanguages ??
        defaultReferenceLanguages(primarySubtitleLanguages),
    ),
  ];

  const confirmationReasons: string[] = [];
  if (title === null) confirmationReasons.push("title is unknown");
  if (mediaType === "movie" && year === null) {
    confirmationReasons.push("movie release year is unknown");
  }
  if (mediaType === "series" || mediaType === "anime") {
    if (season === null) confirmationReasons.push("season is unknown");
    if (episode === null) confirmationReasons.push("episode is unknown");
  }

  const userProvided = Object.keys(overrides).length > 0;
  const filenameProvided = filename.title !== null || filename.episode !== null;
  const containerProvided = containerTitle !== null;
  const identificationSource = userProvided
    ? filenameProvided
      ? "filename-and-user-confirmation"
      : "user"
    : filenameProvided && containerProvided
      ? "filename-and-container-metadata"
      : filenameProvided
        ? "filename"
        : containerProvided
          ? "container-metadata"
          : "unknown";

  let confidence = 0;
  if (title !== null) confidence += userProvided ? 0.5 : 0.35;
  if (season !== null) confidence += 0.15;
  if (episode !== null) confidence += 0.2;
  if (year !== null) confidence += 0.1;
  if (filename.releaseSource !== null || overrides.releaseSource !== undefined)
    confidence += 0.05;
  if (input.durationSeconds !== null) confidence += 0.05;
  if (userProvided) confidence += 0.1;
  confidence = Math.min(0.99, confidence);

  return {
    schemaVersion: "1.0.0",
    title: title ?? null,
    originalTitle: nonEmptyOrNull(overrides.originalTitle),
    alternativeTitles: [...new Set(overrides.alternativeTitles ?? [])],
    mediaType,
    season,
    episode,
    episodeTitle: nonEmptyOrNull(overrides.episodeTitle),
    year,
    runtimeSeconds: input.durationSeconds,
    releaseSource: overrides.releaseSource ?? filename.releaseSource,
    releaseGroup: overrides.releaseGroup ?? filename.releaseGroup,
    dialogueLanguages,
    primarySubtitleLanguages,
    referenceSubtitleLanguages,
    identificationSource,
    confidence,
    needsConfirmation: confirmationReasons.length > 0,
    confirmationReasons,
  };
}
