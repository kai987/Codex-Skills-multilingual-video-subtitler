import {
  subtitleMemoryAssistedRankingSchema,
  type SeriesLanguageMemory,
  type SubtitleMemoryAssistedRanking,
} from "@mvl/shared";

import { stableMemoryHash } from "./series-memory.js";

export type MemoryAssociationClass =
  | "EXACT_TARGET"
  | "PROBABLE_TARGET"
  | "BROAD_WINDOW"
  | "AMBIGUOUS"
  | "UNASSOCIATED"
  | "UNKNOWN";

export interface MemoryRankingCandidateInput {
  candidateId: string;
  text: string;
  associationClass: MemoryAssociationClass;
  baseScore: number;
}

export interface MemoryRankingPoolInput {
  cueId: string;
  cueStart?: number;
  candidates: readonly MemoryRankingCandidateInput[];
  expectedText?: string | null;
}

const ASSOCIATION_PRIORITY: Record<MemoryAssociationClass, number> = {
  EXACT_TARGET: 5,
  PROBABLE_TARGET: 4,
  BROAD_WINDOW: 3,
  AMBIGUOUS: 2,
  UNASSOCIATED: 1,
  UNKNOWN: 0,
};

function matchingEntryIds(input: {
  text: string;
  poolTexts: readonly string[];
  memory: SeriesLanguageMemory;
}): string[] {
  const normalized = input.text.normalize("NFKC");
  return input.memory.entries
    .filter((entry) => {
      if (entry.status !== "active" || entry.applicationEligibility === "none")
        return false;
      if (
        [
          entry.canonicalSurface,
          ...entry.variants,
          ...entry.orthographicVariants,
        ].some((surface) => normalized.includes(surface.normalize("NFKC")))
      ) {
        return true;
      }
      const wrongFormMatched = entry.observedWrongForms.some((surface) =>
        normalized.includes(surface.normalize("NFKC")),
      );
      const canonicalAlreadyExists = input.poolTexts.some((text) =>
        text
          .normalize("NFKC")
          .includes(entry.canonicalSurface.normalize("NFKC")),
      );
      return wrongFormMatched && canonicalAlreadyExists;
    })
    .map((entry) => entry.entryId)
    .toSorted();
}

function baseOrder(candidates: readonly MemoryRankingCandidateInput[]) {
  return [...candidates].toSorted(
    (left, right) =>
      ASSOCIATION_PRIORITY[right.associationClass] -
        ASSOCIATION_PRIORITY[left.associationClass] ||
      right.baseScore - left.baseScore ||
      left.candidateId.localeCompare(right.candidateId),
  );
}

export function rankCandidatesWithSeriesMemory(input: {
  pools: readonly MemoryRankingPoolInput[];
  memory: SeriesLanguageMemory;
  tieBreakMargin?: number;
  generatedAt?: string;
  evaluationMode?: "bootstrap" | "causal" | "frozen";
}): SubtitleMemoryAssistedRanking {
  const tieBreakMargin =
    input.tieBreakMargin ?? input.memory.configuration.memoryTieBreakMargin;
  const decisions = input.pools.map((pool) => {
    const poolTexts = pool.candidates.map((candidate) => candidate.text);
    const orderedBase = baseOrder(pool.candidates);
    const enriched = orderedBase.map((candidate, index) => {
      const memoryEntryIds = matchingEntryIds({
        text: candidate.text,
        poolTexts,
        memory: input.memory,
      });
      return {
        ...candidate,
        memoryScore: Math.min(1, memoryEntryIds.length * 0.2),
        memoryEntryIds,
        adjustedOrder: index + 1,
      };
    });
    const adjusted = [...enriched].toSorted((left, right) => {
      const associationGap =
        ASSOCIATION_PRIORITY[right.associationClass] -
        ASSOCIATION_PRIORITY[left.associationClass];
      if (associationGap !== 0) return associationGap;
      const scoreGap = right.baseScore - left.baseScore;
      if (Math.abs(scoreGap) > tieBreakMargin) return scoreGap;
      return (
        right.memoryScore - left.memoryScore ||
        scoreGap ||
        left.candidateId.localeCompare(right.candidateId)
      );
    });
    const baseRanking = enriched.map((candidate, index) => ({
      ...candidate,
      adjustedOrder: index + 1,
    }));
    const memoryAdjustedRanking = adjusted.map((candidate, index) => ({
      ...candidate,
      adjustedOrder: index + 1,
    }));
    const rankingChanged =
      baseRanking.map((value) => value.candidateId).join("\u0000") !==
      memoryAdjustedRanking.map((value) => value.candidateId).join("\u0000");
    const corrected =
      rankingChanged &&
      pool.expectedText !== null &&
      pool.expectedText !== undefined &&
      memoryAdjustedRanking[0]?.text.normalize("NFKC") ===
        pool.expectedText.normalize("NFKC") &&
      baseRanking[0]?.text.normalize("NFKC") !==
        pool.expectedText.normalize("NFKC");
    const regression =
      rankingChanged &&
      pool.expectedText !== null &&
      pool.expectedText !== undefined &&
      baseRanking[0]?.text.normalize("NFKC") ===
        pool.expectedText.normalize("NFKC") &&
      memoryAdjustedRanking[0]?.text.normalize("NFKC") !==
        pool.expectedText.normalize("NFKC");
    const memoryEvidence = [
      ...new Set(enriched.flatMap((candidate) => candidate.memoryEntryIds)),
    ].toSorted();
    const baseWinnerMatchesCanonical =
      pool.expectedText === null || pool.expectedText === undefined
        ? null
        : baseRanking[0]?.text.normalize("NFKC") ===
          pool.expectedText.normalize("NFKC");
    const memoryWinnerMatchesCanonical =
      pool.expectedText === null || pool.expectedText === undefined
        ? null
        : memoryAdjustedRanking[0]?.text.normalize("NFKC") ===
          pool.expectedText.normalize("NFKC");
    return {
      cueId: pool.cueId,
      memoryHashBefore: input.memory.memoryHash,
      baseWinnerCandidateId: baseRanking[0]?.candidateId ?? null,
      memoryWinnerCandidateId: memoryAdjustedRanking[0]?.candidateId ?? null,
      humanCanonical: pool.expectedText ?? null,
      baseWinnerMatchesCanonical,
      memoryWinnerMatchesCanonical,
      baseRanking,
      memoryEvidence,
      memoryEvidenceIds: memoryEvidence,
      memoryAdjustedRanking,
      rankingReason:
        pool.candidates.length === 0
          ? "no-existing-candidates"
          : rankingChanged
            ? "same-association-close-score-memory-tie-break"
            : "acoustic-association-and-base-ranking-preserved",
      rankingChanged,
      corrected,
      regression,
      memoryCorrectedRanking: corrected,
      memoryRegressedRanking: regression,
      associationPromotionCount: 0 as const,
      fabricatedCandidateCount: 0 as const,
      acousticOverrideViolationCount: 0 as const,
    };
  });
  const base = {
    schemaVersion: "1.0.0" as const,
    artifactType: "subtitle-memory-assisted-ranking" as const,
    rankingVersion: "C5.19" as const,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    memoryHash: input.memory.memoryHash,
    evaluationMode: input.evaluationMode ?? "frozen",
    scoreCalibrationStatus: "rule-based-memory-prior" as const,
    memoryTieBreakMargin: tieBreakMargin,
    decisions,
    summary: {
      memoryRankingEvaluatedCueCount: decisions.length,
      memoryRankingChangedCount: decisions.filter(
        (value) => value.rankingChanged,
      ).length,
      memoryRankingCorrectedCount: decisions.filter((value) => value.corrected)
        .length,
      memoryRankingRegressionCount: 0 as const,
      memoryFabricatedAutoCandidateCount: 0 as const,
      memoryAcousticOverrideViolationCount: 0 as const,
    },
  };
  if (decisions.some((decision) => decision.regression)) {
    throw new Error("Series memory ranking regression detected.");
  }
  return subtitleMemoryAssistedRankingSchema.parse({
    ...base,
    semanticHash: stableMemoryHash({ ...base, generatedAt: null }),
  });
}
