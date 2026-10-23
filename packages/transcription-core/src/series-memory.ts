import { createHash } from "node:crypto";

import {
  seriesIdentitySchema,
  seriesLanguageMemorySchema,
  subtitleSeriesMemoryEvidenceSchema,
  type SeriesIdentity,
  type SeriesLanguageMemory,
  type SeriesLanguageMemoryEntry,
  type SubtitleCue,
  type SubtitleSeriesMemoryEvidence,
} from "@mvl/shared";

export const C519_MEMORY_TIE_BREAK_MARGIN = 0.05;
export const C519_MAXIMUM_MEMORY_ENTRIES = 128;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function stableMemoryHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

export function normalizeSeriesTitle(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/(?:第\s*[0-9０-９]+\s*話|ep(?:isode)?\s*[0-9]+).*$/giu, "")
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .toLocaleLowerCase("ja");
}

export function buildSeriesIdentity(input: {
  title: string | null;
  year: number | null;
  season: number | null;
  episode: number | null;
  mediaType?: "series" | "movie" | "special" | "unknown";
  explicitSeriesVerification?: boolean;
}): SeriesIdentity {
  const title = input.title?.normalize("NFC").trim() ?? "";
  const normalizedTitle = normalizeSeriesTitle(title);
  const titleAvailable = normalizedTitle.length > 0;
  const verified =
    titleAvailable &&
    (input.year !== null || input.explicitSeriesVerification === true);
  const identityStatus = !titleAvailable
    ? "insufficient"
    : verified
      ? "verified"
      : "provisional";
  const mediaType = input.mediaType ?? "series";
  const keyPayload = {
    normalizedTitle: normalizedTitle || "untitled",
    year: input.year ?? "unknown-year",
    season: input.season ?? "unknown-season",
    mediaType,
  };
  const seriesKey = `series-${stableMemoryHash(keyPayload).slice(0, 24)}`;
  return seriesIdentitySchema.parse({
    seriesKey,
    title: title || "unknown-series",
    normalizedTitle: normalizedTitle || "unknown-series",
    year: input.year,
    season: input.season,
    mediaType,
    identitySource:
      input.explicitSeriesVerification === true
        ? "explicit-series-task"
        : "subtitle-package-media-identity",
    identityStatus,
    identityEvidence: [
      titleAvailable ? "normalized-title-present" : "title-missing",
      input.year === null ? "year-missing" : "year-present",
      input.season === null ? "season-missing" : "season-present",
      input.explicitSeriesVerification === true
        ? "explicit-series-task-verification"
        : "no-explicit-series-verification",
      "episode-number-excluded-from-series-key",
    ],
    memoryScope: verified ? "series" : "episode",
  });
}

export function memoryStatistics(
  entries: readonly SeriesLanguageMemoryEntry[],
  duplicateMemoryEvidenceCount = 0,
  memoryEvidenceDoubleCountPreventedCount = 0,
) {
  const properTypes = new Set([
    "proper-noun",
    "person-name",
    "place-name",
    "organization-name",
    "title-name",
  ]);
  return {
    entryCount: entries.length,
    properNounEntryCount: entries.filter((entry) =>
      properTypes.has(entry.entryType),
    ).length,
    terminologyEntryCount: entries.filter((entry) =>
      ["terminology", "regional-term", "domain-term"].includes(entry.entryType),
    ).length,
    dialectEntryCount: entries.filter(
      (entry) => entry.entryType === "dialect-form",
    ).length,
    correctionEntryCount: entries.filter(
      (entry) => entry.entryType === "correction-pair",
    ).length,
    pronunciationEntryCount: entries.filter(
      (entry) =>
        entry.readingHiragana !== null || entry.pronunciationPhones.length > 0,
    ).length,
    acousticAliasCount: entries.reduce(
      (sum, entry) => sum + entry.acousticAliases.length,
      0,
    ),
    ambiguousMemoryAliasCount: entries.filter((entry) =>
      entry.conflicts.includes("alias-conflict"),
    ).length,
    conflictedReadingCount: entries.filter((entry) =>
      entry.conflicts.includes("reading-conflict"),
    ).length,
    duplicateMemoryEvidenceCount,
    memoryEvidenceDoubleCountPreventedCount,
  };
}

export function emptySeriesLanguageMemory(
  seriesIdentity: SeriesIdentity,
  generatedAt = new Date().toISOString(),
): SeriesLanguageMemory {
  const configuration = {
    maximumEntryCount: C519_MAXIMUM_MEMORY_ENTRIES,
    memoryTieBreakMargin: C519_MEMORY_TIE_BREAK_MARGIN,
    globalReplacementEnabled: false as const,
    finalizationAuthorityEnabled: false as const,
    networkUsed: false as const,
  };
  const identity = {
    seriesIdentity,
    entries: [] as SeriesLanguageMemoryEntry[],
    conflicts: [],
    configuration,
  };
  const memoryHash = stableMemoryHash(identity);
  const base = {
    schemaVersion: "1.0.0" as const,
    artifactType: "series-language-memory" as const,
    memoryVersion: "C5.19" as const,
    generatedAt,
    seriesIdentity,
    parentMemoryHash: null,
    memoryHash,
    revisionId: `memory-revision-${memoryHash.slice(0, 20)}`,
    memoryRevisionId: `memory-revision-${memoryHash.slice(0, 20)}`,
    appliedDeltaHash: null,
    sourceEpisodeIds: [],
    configuration,
    entries: [],
    conflicts: [],
    statistics: memoryStatistics([]),
  };
  return seriesLanguageMemorySchema.parse({
    ...base,
    semanticHash: stableMemoryHash({ ...base, generatedAt: null }),
  });
}

function matchedEntries(
  text: string,
  memory: SeriesLanguageMemory,
): SeriesLanguageMemoryEntry[] {
  const normalized = text.normalize("NFKC");
  return memory.entries.filter((entry) =>
    [
      entry.canonicalSurface,
      ...entry.variants,
      ...entry.orthographicVariants,
      ...entry.observedWrongForms,
    ].some((surface) => normalized.includes(surface.normalize("NFKC"))),
  );
}

export function buildSubtitleSeriesMemoryEvidence(input: {
  cues: readonly SubtitleCue[];
  memory: SeriesLanguageMemory;
  baseCueHash: string;
  generatedAt?: string;
}): SubtitleSeriesMemoryEvidence {
  const cues = input.cues.map((cue) => {
    const matched = matchedEntries(cue.text, input.memory);
    return {
      cueId: cue.id,
      canonicalTextHash: stableMemoryHash(cue.text),
      matchedEntryIds: matched.map((entry) => entry.entryId).toSorted(),
      matchCount: matched.length,
      appliedAs: [
        ...new Set(
          matched.flatMap((entry) => [
            ...(entry.applicationEligibility.includes("ranking")
              ? (["ranking-prior"] as const)
              : []),
            ...(entry.acousticAliases.length > 0
              ? (["pronunciation-projection"] as const)
              : []),
          ]),
        ),
      ].toSorted(),
      canonicalTextChanged: false as const,
    };
  });
  const base = {
    schemaVersion: "1.0.0" as const,
    artifactType: "subtitle-series-memory-evidence" as const,
    evidenceVersion: "C5.19" as const,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    seriesKey: input.memory.seriesIdentity.seriesKey,
    memoryHash: input.memory.memoryHash,
    baseCueHash: input.baseCueHash,
    cues,
    summary: {
      matchedCueCount: cues.filter((cue) => cue.matchCount > 0).length,
      matchedEntryCount: new Set(cues.flatMap((cue) => cue.matchedEntryIds))
        .size,
      globalReplacementCount: 0 as const,
      canonicalTextMutationCount: 0 as const,
      crossSeriesMemoryLeakCount: 0 as const,
    },
  };
  return subtitleSeriesMemoryEvidenceSchema.parse({
    ...base,
    semanticHash: stableMemoryHash({ ...base, generatedAt: null }),
  });
}

export function assertSeriesMemoryCompatible(input: {
  identity: SeriesIdentity;
  memory: SeriesLanguageMemory;
}): void {
  if (
    input.identity.identityStatus !== "verified" ||
    input.memory.seriesIdentity.seriesKey !== input.identity.seriesKey
  ) {
    throw new Error(
      "Series memory identity mismatch; fail closed to episode-only.",
    );
  }
}
