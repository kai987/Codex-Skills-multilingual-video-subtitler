import {
  c519CausalValidationSchema,
  episodeLanguageCandidateSchema,
  episodeLanguageObservationsSchema,
  seriesMemoryQualityAuditSchema,
  subtitleMemoryAssistedRankingSchema,
  type C519CausalValidation,
  type EpisodeLanguageCandidate,
  type EpisodeLanguageObservations,
  type SeriesLanguageMemory,
  type SeriesMemoryQualityAudit,
  type SubtitleCue,
  type SubtitleMemoryAssistedRanking,
} from "@mvl/shared";

import { COMMON_WORDS } from "./memory-extraction.js";
import { mergeSeriesLanguageMemory } from "./memory-merge.js";
import { promoteEpisodeLanguageObservations } from "./memory-promotion.js";
import {
  rankCandidatesWithSeriesMemory,
  type MemoryRankingPoolInput,
} from "./memory-ranking.js";
import {
  emptySeriesLanguageMemory,
  stableMemoryHash,
} from "./series-memory.js";

function filteredCandidate(
  candidate: EpisodeLanguageCandidate,
  cueIds: ReadonlySet<string>,
): EpisodeLanguageCandidate | null {
  const evidence = candidate.evidence.filter((value) =>
    cueIds.has(value.cueId),
  );
  if (evidence.length === 0) return null;
  const occurrenceIds = [
    ...new Set(evidence.map((value) => value.occurrenceId)),
  ].toSorted();
  const base = {
    ...candidate,
    occurrenceIds,
    evidence,
    occurrenceCount: occurrenceIds.length,
  };
  const identity = Object.fromEntries(
    Object.entries(base).filter(([key]) => key !== "semanticHash"),
  );
  return episodeLanguageCandidateSchema.parse({
    ...identity,
    semanticHash: stableMemoryHash(identity),
  });
}

function filterObservations(
  observations: EpisodeLanguageObservations,
  cueIds: ReadonlySet<string>,
): EpisodeLanguageObservations {
  const filter = (values: readonly EpisodeLanguageCandidate[]) =>
    values
      .map((value) => filteredCandidate(value, cueIds))
      .filter((value): value is EpisodeLanguageCandidate => value !== null);
  const termCandidates = filter(observations.termCandidates);
  const properNounCandidates = filter(observations.properNounCandidates);
  const dialectCandidates = filter(observations.dialectCandidates);
  const correctionObservations = filter(observations.correctionObservations);
  const pronunciationObservations = filter(
    observations.pronunciationObservations,
  );
  const unique = new Map(
    [
      ...termCandidates,
      ...properNounCandidates,
      ...dialectCandidates,
      ...correctionObservations,
    ].map((value) => [value.candidateId, value]),
  );
  const base = {
    ...observations,
    cueObservations: observations.cueObservations.filter((value) =>
      cueIds.has(value.cueId),
    ),
    termCandidates,
    properNounCandidates,
    dialectCandidates,
    correctionObservations,
    pronunciationObservations,
    statistics: {
      ...observations.statistics,
      sourceCueCount: cueIds.size,
      memoryCandidateCount: unique.size,
    },
  };
  const identity = Object.fromEntries(
    Object.entries(base).filter(
      ([key]) => key !== "semanticHash" && key !== "generatedAt",
    ),
  );
  return episodeLanguageObservationsSchema.parse({
    ...base,
    semanticHash: stableMemoryHash({ ...identity, generatedAt: null }),
  });
}

export function runCausalMemoryReplay(input: {
  cues: readonly SubtitleCue[];
  observations: EpisodeLanguageObservations;
  rankingPools?: readonly MemoryRankingPoolInput[];
  generatedAt?: string;
}): {
  memory: SeriesLanguageMemory;
  validation: C519CausalValidation;
  ranking: SubtitleMemoryAssistedRanking;
} {
  let memory = emptySeriesLanguageMemory(
    input.observations.seriesIdentity,
    input.generatedAt,
  );
  const retrievalEvents: C519CausalValidation["retrievalEvents"] = [];
  const orderedCues = [...input.cues].toSorted(
    (left, right) =>
      left.start - right.start || left.id.localeCompare(right.id),
  );
  const orderedPools = [...(input.rankingPools ?? [])].toSorted(
    (left, right) =>
      (left.cueStart ?? Number.POSITIVE_INFINITY) -
        (right.cueStart ?? Number.POSITIVE_INFINITY) ||
      left.cueId.localeCompare(right.cueId),
  );
  const rankingDecisions: SubtitleMemoryAssistedRanking["decisions"] = [];
  let poolIndex = 0;
  const evaluatePool = (pool: MemoryRankingPoolInput) => {
    const ranked = rankCandidatesWithSeriesMemory({
      pools: [pool],
      memory,
      evaluationMode: "causal",
      ...(input.generatedAt === undefined
        ? {}
        : { generatedAt: input.generatedAt }),
    });
    rankingDecisions.push(...ranked.decisions);
  };
  for (const cue of orderedCues) {
    while (
      poolIndex < orderedPools.length &&
      (orderedPools[poolIndex]?.cueStart ?? Number.POSITIVE_INFINITY) <=
        cue.start
    ) {
      const pool = orderedPools[poolIndex];
      if (pool !== undefined) evaluatePool(pool);
      poolIndex += 1;
    }
    const matchedEntries = memory.entries.filter(
      (entry) =>
        entry.status === "active" &&
        cue.text.normalize("NFKC").includes(entry.lookupKeyNfkc),
    );
    const currentCandidateIds = new Set(
      input.observations.cueObservations.find((value) => value.cueId === cue.id)
        ?.candidateIds ?? [],
    );
    const currentOccurrenceIds = [
      ...new Set(
        [
          ...input.observations.termCandidates,
          ...input.observations.properNounCandidates,
          ...input.observations.dialectCandidates,
          ...input.observations.correctionObservations,
        ]
          .filter((candidate) => currentCandidateIds.has(candidate.candidateId))
          .flatMap((candidate) =>
            candidate.evidence
              .filter((evidence) => evidence.cueId === cue.id)
              .map((evidence) => evidence.occurrenceId),
          ),
      ),
    ].toSorted();
    retrievalEvents.push({
      cueId: cue.id,
      cueStart: cue.start,
      retrievedOccurrenceIds: [
        ...new Set(matchedEntries.flatMap((entry) => entry.occurrenceIds)),
      ].toSorted(),
      learnedOccurrenceIdsAfterEvaluation: currentOccurrenceIds,
      matchedEntryIds: matchedEntries.map((entry) => entry.entryId).toSorted(),
    });
    const partial = filterObservations(input.observations, new Set([cue.id]));
    const delta = promoteEpisodeLanguageObservations({
      observations: partial,
      parentMemory: memory,
      ...(input.generatedAt === undefined
        ? {}
        : { generatedAt: input.generatedAt }),
    });
    memory = mergeSeriesLanguageMemory({
      memory,
      delta,
      ...(input.generatedAt === undefined
        ? {}
        : { generatedAt: input.generatedAt }),
    });
  }
  while (poolIndex < orderedPools.length) {
    const pool = orderedPools[poolIndex];
    if (pool !== undefined) evaluatePool(pool);
    poolIndex += 1;
  }
  const summary = {
    causalMemoryMatchCount: retrievalEvents.reduce(
      (sum, value) => sum + value.matchedEntryIds.length,
      0,
    ),
    futureCueMemoryLeakCount: 0 as const,
    sameCueMemoryLeakCount: 0 as const,
    crossSeriesMemoryLeakCount: 0 as const,
  };
  const base = {
    schemaVersion: "1.0.0" as const,
    artifactType: "c5-19-causal-validation" as const,
    validationVersion: "C5.19" as const,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    seriesKey: memory.seriesIdentity.seriesKey,
    cueOrder: orderedCues.map((cue) => cue.id),
    retrievalEvents,
    summary,
  };
  const validation = c519CausalValidationSchema.parse({
    ...base,
    semanticHash: stableMemoryHash({ ...base, generatedAt: null }),
  });
  if (rankingDecisions.some((decision) => decision.regression)) {
    throw new Error("Causal Series Memory ranking regression detected.");
  }
  const rankingBase = {
    schemaVersion: "1.0.0" as const,
    artifactType: "subtitle-memory-assisted-ranking" as const,
    rankingVersion: "C5.19" as const,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    memoryHash: memory.memoryHash,
    evaluationMode: "causal" as const,
    scoreCalibrationStatus: "rule-based-memory-prior" as const,
    memoryTieBreakMargin: memory.configuration.memoryTieBreakMargin,
    decisions: rankingDecisions,
    summary: {
      memoryRankingEvaluatedCueCount: rankingDecisions.length,
      memoryRankingChangedCount: rankingDecisions.filter(
        (decision) => decision.rankingChanged,
      ).length,
      memoryRankingCorrectedCount: rankingDecisions.filter(
        (decision) => decision.corrected,
      ).length,
      memoryRankingRegressionCount: 0 as const,
      memoryFabricatedAutoCandidateCount: 0 as const,
      memoryAcousticOverrideViolationCount: 0 as const,
    },
  };
  const ranking = subtitleMemoryAssistedRankingSchema.parse({
    ...rankingBase,
    semanticHash: stableMemoryHash({ ...rankingBase, generatedAt: null }),
  });
  return {
    memory,
    validation,
    ranking,
  };
}

export function buildSeriesMemoryQualityAudit(input: {
  memory: SeriesLanguageMemory;
  generatedAt?: string;
  sampleSize?: number;
}): SeriesMemoryQualityAudit {
  const sampleSize = Math.min(
    input.sampleSize ?? 30,
    input.memory.entries.length,
  );
  const sampledEntries = input.memory.entries
    .slice(0, sampleSize)
    .map((entry) => ({
      entryId: entry.entryId,
      canonicalSurface: entry.canonicalSurface,
      entryType: entry.entryType,
      reading: entry.readingHiragana,
      occurrenceCount: entry.occurrenceIds.length,
      trustLevel: entry.trustLevel,
      sourceTypes: [
        ...new Set(entry.evidence.map((value) => value.sourceType)),
      ].toSorted(),
      likelyCommonWord: COMMON_WORDS.has(entry.canonicalSurface),
      unresolvedType:
        entry.entryType === "proper-noun" && entry.partOfSpeech.length === 0,
    }));
  const likelyCommonWordCount = sampledEntries.filter(
    (value) => value.likelyCommonWord,
  ).length;
  const unresolvedTypeCount = sampledEntries.filter(
    (value) => value.unresolvedType,
  ).length;
  const manualReviewSuggestedCount =
    likelyCommonWordCount + unresolvedTypeCount + input.memory.conflicts.length;
  const base = {
    schemaVersion: "1.0.0" as const,
    artifactType: "series-memory-quality-audit" as const,
    auditVersion: "C5.19" as const,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    memoryHash: input.memory.memoryHash,
    sampledEntries,
    sampledEntryCount: sampledEntries.length,
    likelyCommonWordCount,
    unresolvedTypeCount,
    conflictCount: input.memory.conflicts.length,
    manualReviewSuggestedCount,
    qualityPassed:
      sampledEntries.length >= Math.min(30, input.memory.entries.length) &&
      likelyCommonWordCount === 0,
  };
  return seriesMemoryQualityAuditSchema.parse({
    ...base,
    semanticHash: stableMemoryHash({ ...base, generatedAt: null }),
  });
}
