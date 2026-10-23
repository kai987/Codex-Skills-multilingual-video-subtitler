import {
  subtitleReviewPackageSchema,
  type SubtitleMemoryAssistedRanking,
  type SubtitleReviewPackage,
} from "@mvl/shared";

import { sha256Value } from "./finalization-support.js";
import { bindReviewCandidates } from "./review-action-validation.js";

export const C519_MEMORY_POLICY_VERSION = "c5.19-series-memory-policy-v1";

export function attachSeriesMemoryReviewContext(input: {
  reviewPackage: SubtitleReviewPackage;
  seriesMemoryHash: string;
  memoryRanking: SubtitleMemoryAssistedRanking;
  pronunciationProjectionHash: string;
  generatedAt?: string;
}): SubtitleReviewPackage {
  const rankingDependency =
    input.memoryRanking.summary.memoryRankingChangedCount > 0;
  const memoryRankingPolicyHash = sha256Value({
    policyVersion: C519_MEMORY_POLICY_VERSION,
    tieBreakMargin: input.memoryRanking.memoryTieBreakMargin,
    scoreCalibrationStatus: input.memoryRanking.scoreCalibrationStatus,
    associationPromotionAllowed: false,
    finalizationAuthorityEnabled: false,
  });
  const reviewVersion = rankingDependency
    ? `review-v6-${sha256Value({
        priorReviewVersion: input.reviewPackage.reviewVersion,
        seriesMemoryHash: input.seriesMemoryHash,
        memoryPolicyVersion: C519_MEMORY_POLICY_VERSION,
        memoryRankingPolicyHash,
        pronunciationProjectionHash: input.pronunciationProjectionHash,
      }).slice(0, 24)}`
    : input.reviewPackage.reviewVersion;
  const items = rankingDependency
    ? bindReviewCandidates({
        items: input.reviewPackage.items,
        inputEvidenceHash: input.reviewPackage.inputEvidenceHash,
        reviewVersion,
      })
    : input.reviewPackage.items;
  return subtitleReviewPackageSchema.parse({
    ...input.reviewPackage,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    reviewVersion,
    seriesMemoryHash: input.seriesMemoryHash,
    memoryPolicyVersion: C519_MEMORY_POLICY_VERSION,
    memoryRankingPolicyHash,
    pronunciationProjectionHash: input.pronunciationProjectionHash,
    seriesMemoryDecisionDependency: rankingDependency ? "ranking" : "none",
    items,
  });
}
