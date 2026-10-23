import {
  seriesLanguageMemoryEntrySchema,
  seriesLanguageMemorySchema,
  type SeriesLanguageMemory,
  type SeriesLanguageMemoryDelta,
  type SeriesLanguageMemoryEntry,
} from "@mvl/shared";

import {
  C519_MAXIMUM_MEMORY_ENTRIES,
  emptySeriesLanguageMemory,
  memoryStatistics,
  stableMemoryHash,
} from "./series-memory.js";

function mergedEntry(
  left: SeriesLanguageMemoryEntry,
  right: SeriesLanguageMemoryEntry,
): { entry: SeriesLanguageMemoryEntry; prevented: number } {
  const evidenceByLineage = new Map(
    left.evidence.map((evidence) => [evidence.evidenceLineageId, evidence]),
  );
  let prevented = 0;
  for (const evidence of right.evidence) {
    if (evidenceByLineage.has(evidence.evidenceLineageId)) prevented += 1;
    else evidenceByLineage.set(evidence.evidenceLineageId, evidence);
  }
  const readingConflict =
    left.readingHiragana !== null &&
    right.readingHiragana !== null &&
    left.readingHiragana !== right.readingHiragana;
  const aliasValues = [
    ...new Set([...left.acousticAliases, ...right.acousticAliases]),
  ];
  const aliasConflict = aliasValues.length > 1;
  const conflicts = [
    ...new Set([
      ...left.conflicts,
      ...right.conflicts,
      ...(readingConflict ? ["reading-conflict"] : []),
      ...(aliasConflict ? ["alias-conflict"] : []),
    ]),
  ].toSorted();
  const evidence = [...evidenceByLineage.values()].toSorted((a, b) =>
    a.evidenceLineageId.localeCompare(b.evidenceLineageId),
  );
  const occurrenceIds = [
    ...new Set([...left.occurrenceIds, ...right.occurrenceIds]),
  ].toSorted();
  const trustLevel: SeriesLanguageMemoryEntry["trustLevel"] =
    left.entryType === "correction-pair"
      ? "human-corrected"
      : occurrenceIds.length >= 2
        ? "repeated-verified"
        : left.trustLevel === "human-reviewed" ||
            right.trustLevel === "human-reviewed"
          ? "human-reviewed"
          : left.trustLevel;
  const rankingEligible = [
    "human-corrected",
    "human-reviewed",
    "validated-series",
    "repeated-verified",
  ].includes(trustLevel);
  const allAliasProvenance = [
    ...left.acousticAliasProvenance,
    ...right.acousticAliasProvenance,
  ];
  const sourcePriority = {
    "human-correction-reading": 5,
    "manual-reading": 4,
    "mfa-dictionary-reading": 3,
    "sudachi-reading": 2,
    "g2p-reading": 1,
  } as const;
  const aliasProvenance = [
    ...Map.groupBy(allAliasProvenance, (value) => value.alias).entries(),
  ]
    .map(([, values]) => {
      const value = [...values].toSorted(
        (a, b) =>
          sourcePriority[b.source] - sourcePriority[a.source] ||
          a.sourceArtifactHash.localeCompare(b.sourceArtifactHash),
      )[0];
      if (value === undefined) throw new Error("Empty acoustic alias group.");
      const matching = values.filter(
        (candidate) =>
          candidate.source === value.source &&
          candidate.sourceArtifactHash === value.sourceArtifactHash,
      );
      return {
        ...value,
        sourceEvidenceIds: [
          ...new Set(
            matching.flatMap((candidate) => candidate.sourceEvidenceIds),
          ),
        ].toSorted(),
        trustLevel,
        verified: rankingEligible,
      };
    })
    .toSorted(
      (a, b) =>
        a.alias.localeCompare(b.alias, "ja") ||
        a.source.localeCompare(b.source),
    );
  const base = {
    ...left,
    readingHiragana: readingConflict
      ? left.readingHiragana
      : (left.readingHiragana ?? right.readingHiragana),
    readingKatakana: readingConflict
      ? left.readingKatakana
      : (left.readingKatakana ?? right.readingKatakana),
    pronunciationPhones:
      left.pronunciationPhones.length > 0
        ? left.pronunciationPhones
        : right.pronunciationPhones,
    dictionaryForm: left.dictionaryForm ?? right.dictionaryForm,
    normalizedForm: left.normalizedForm ?? right.normalizedForm,
    partOfSpeech:
      left.partOfSpeech.length > 0 ? left.partOfSpeech : right.partOfSpeech,
    variants: [...new Set([...left.variants, ...right.variants])].toSorted(),
    orthographicVariants: [
      ...new Set([...left.orthographicVariants, ...right.orthographicVariants]),
    ].toSorted(),
    acousticAliases: aliasConflict ? [] : aliasValues.toSorted(),
    acousticAliasProvenance: aliasConflict ? [] : aliasProvenance,
    observedWrongForms: [
      ...new Set([...left.observedWrongForms, ...right.observedWrongForms]),
    ].toSorted(),
    status:
      readingConflict || aliasConflict ? ("quarantined" as const) : left.status,
    trustLevel,
    applicationEligibility:
      readingConflict || aliasConflict
        ? ("none" as const)
        : rankingEligible && aliasValues.length > 0
          ? ("ranking-and-pronunciation" as const)
          : rankingEligible
            ? ("ranking-only" as const)
            : aliasValues.length > 0
              ? ("pronunciation-only" as const)
              : ("suggestion-only" as const),
    sourceEpisodes: [
      ...new Set([...left.sourceEpisodes, ...right.sourceEpisodes]),
    ].toSorted(),
    firstSeen: Math.min(left.firstSeen, right.firstSeen),
    lastSeen: Math.max(left.lastSeen, right.lastSeen),
    occurrenceIds,
    evidence,
    conflicts,
  };
  const identity = Object.fromEntries(
    Object.entries(base).filter(([key]) => key !== "semanticHash"),
  );
  return {
    entry: seriesLanguageMemoryEntrySchema.parse({
      ...identity,
      semanticHash: stableMemoryHash(identity),
    }),
    prevented,
  };
}

function conflictRecords(
  entries: readonly SeriesLanguageMemoryEntry[],
): SeriesLanguageMemory["conflicts"] {
  const conflicts: SeriesLanguageMemory["conflicts"] = [];
  const byLookup = Map.groupBy(entries, (entry) => entry.lookupKeyNfkc);
  for (const [lookupKeyNfkc, values] of byLookup) {
    const readings = [
      ...new Set(
        values
          .map((entry) => entry.readingHiragana)
          .filter((value): value is string => value !== null),
      ),
    ].toSorted();
    if (readings.length > 1) {
      const base = {
        conflictId: `memory-conflict-${stableMemoryHash({
          conflictType: "reading-conflict",
          lookupKeyNfkc,
          values: readings,
        }).slice(0, 24)}`,
        conflictType: "reading-conflict" as const,
        lookupKeyNfkc,
        entryIds: values.map((entry) => entry.entryId).toSorted(),
        values: readings,
        resolution: "quarantined" as const,
      };
      conflicts.push({ ...base, semanticHash: stableMemoryHash(base) });
    }
  }
  const aliasOwners = new Map<string, SeriesLanguageMemoryEntry[]>();
  for (const entry of entries) {
    for (const alias of [
      ...entry.acousticAliases,
      ...entry.observedWrongForms,
    ]) {
      aliasOwners.set(alias.normalize("NFKC"), [
        ...(aliasOwners.get(alias.normalize("NFKC")) ?? []),
        entry,
      ]);
    }
  }
  for (const [alias, owners] of aliasOwners) {
    const canonicalValues = [
      ...new Set(owners.map((entry) => entry.canonicalSurface)),
    ].toSorted((a, b) => a.localeCompare(b, "ja"));
    if (canonicalValues.length <= 1) continue;
    const base = {
      conflictId: `memory-conflict-${stableMemoryHash({
        conflictType: "alias-conflict",
        alias,
        values: canonicalValues,
      }).slice(0, 24)}`,
      conflictType: "alias-conflict" as const,
      lookupKeyNfkc: alias,
      entryIds: owners.map((entry) => entry.entryId).toSorted(),
      values: canonicalValues,
      resolution: "quarantined" as const,
    };
    conflicts.push({ ...base, semanticHash: stableMemoryHash(base) });
  }
  return conflicts.toSorted((left, right) =>
    left.conflictId.localeCompare(right.conflictId),
  );
}

function quarantineConflictedEntries(
  entries: readonly SeriesLanguageMemoryEntry[],
  conflicts: readonly SeriesLanguageMemory["conflicts"][number][],
): SeriesLanguageMemoryEntry[] {
  const typesByEntry = new Map<string, string[]>();
  for (const conflict of conflicts) {
    for (const entryId of conflict.entryIds) {
      typesByEntry.set(entryId, [
        ...(typesByEntry.get(entryId) ?? []),
        conflict.conflictType,
      ]);
    }
  }
  return entries.map((entry) => {
    const types = typesByEntry.get(entry.entryId);
    if (types === undefined) return entry;
    const base = {
      ...entry,
      acousticAliases: [],
      acousticAliasProvenance: [],
      status: "quarantined" as const,
      applicationEligibility: "none" as const,
      conflicts: [...new Set([...entry.conflicts, ...types])].toSorted(),
    };
    const identity = Object.fromEntries(
      Object.entries(base).filter(([key]) => key !== "semanticHash"),
    );
    return seriesLanguageMemoryEntrySchema.parse({
      ...identity,
      semanticHash: stableMemoryHash(identity),
    });
  });
}

export function mergeSeriesLanguageMemory(input: {
  memory?: SeriesLanguageMemory | null;
  delta: SeriesLanguageMemoryDelta;
  generatedAt?: string;
  maximumEntryCount?: number;
}): SeriesLanguageMemory {
  const memory =
    input.memory ??
    emptySeriesLanguageMemory(
      input.delta.candidates[0]?.proposedEntry === undefined
        ? (() => {
            throw new Error(
              "Cannot create memory from an empty unscoped delta.",
            );
          })()
        : {
            seriesKey: input.delta.seriesKey,
            title: "series-memory-delta",
            normalizedTitle: "series-memory-delta",
            year: null,
            season: null,
            mediaType: "series",
            identitySource: "curated-memory",
            identityStatus: "verified",
            identityEvidence: ["delta-series-key"],
            memoryScope: "series",
          },
    );
  if (memory.seriesIdentity.seriesKey !== input.delta.seriesKey) {
    throw new Error("Cross-series memory merge rejected.");
  }
  const entries = new Map(
    memory.entries.map((entry) => [entry.entryId, entry]),
  );
  let prevented = 0;
  for (const decision of input.delta.candidates) {
    if (
      !(["promote", "merge"] as const).includes(
        decision.promotionDecision as "promote" | "merge",
      )
    ) {
      continue;
    }
    const existing = entries.get(decision.proposedEntry.entryId);
    if (existing === undefined)
      entries.set(decision.proposedEntry.entryId, decision.proposedEntry);
    else {
      const merged = mergedEntry(existing, decision.proposedEntry);
      entries.set(existing.entryId, merged.entry);
      prevented += merged.prevented;
    }
  }
  const maximum = input.maximumEntryCount ?? C519_MAXIMUM_MEMORY_ENTRIES;
  const initialEntries = [...entries.values()]
    .toSorted((left, right) => left.entryId.localeCompare(right.entryId))
    .slice(0, maximum);
  const initialConflicts = conflictRecords(initialEntries);
  const sortedEntries = quarantineConflictedEntries(
    initialEntries,
    initialConflicts,
  ).toSorted((left, right) => left.entryId.localeCompare(right.entryId));
  const conflicts = conflictRecords(sortedEntries);
  const configuration = {
    ...memory.configuration,
    maximumEntryCount: maximum,
  };
  const memoryHash = stableMemoryHash({
    seriesIdentity: memory.seriesIdentity,
    configuration,
    entries: sortedEntries,
    conflicts,
  });
  if (memoryHash === memory.memoryHash) return memory;
  const base = {
    schemaVersion: "1.0.0" as const,
    artifactType: "series-language-memory" as const,
    memoryVersion: "C5.19" as const,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    seriesIdentity: memory.seriesIdentity,
    parentMemoryHash: memory.entries.length === 0 ? null : memory.memoryHash,
    memoryHash,
    revisionId: `memory-revision-${memoryHash.slice(0, 20)}`,
    memoryRevisionId: `memory-revision-${memoryHash.slice(0, 20)}`,
    appliedDeltaHash: input.delta.deltaHash,
    sourceEpisodeIds: [
      ...new Set(sortedEntries.flatMap((entry) => entry.sourceEpisodes)),
    ].toSorted(),
    configuration,
    entries: sortedEntries,
    conflicts,
    statistics: memoryStatistics(
      sortedEntries,
      memory.statistics.duplicateMemoryEvidenceCount,
      memory.statistics.memoryEvidenceDoubleCountPreventedCount + prevented,
    ),
  };
  return seriesLanguageMemorySchema.parse({
    ...base,
    semanticHash: stableMemoryHash({ ...base, generatedAt: null }),
  });
}
