import { describe, expect, it } from "vitest";

import {
  buildReviewEffectiveDisposition,
  evaluateProtectedFinalizationRisk,
} from "@mvl/video-subtitler";

import {
  protectedAuthority,
  protectedReviewPackage,
  protectedRiskInput,
} from "./helpers/c6-0-protected-fixture.js";

describe("C6.0 Review effective disposition", () => {
  it("retains all seven Review artifacts while deriving 0/6/1", () => {
    const evaluated = evaluateProtectedFinalizationRisk(protectedRiskInput());
    expect(evaluated.reviewDisposition.summary).toEqual({
      legacyReviewItemCount: 7,
      protectedReviewArtifactItemCount: 7,
      effectiveMandatoryReviewCount: 0,
      effectiveAdvisoryReviewCount: 6,
      preservationSupportedReviewCount: 1,
    });
    expect(evaluated.reviewDisposition.items).toHaveLength(7);
    expect(
      evaluated.reviewDisposition.items.filter(
        (item) => item.preservationSupported,
      ),
    ).toHaveLength(1);
  });

  it("keeps every machine-only Review item mandatory", () => {
    const evaluated = evaluateProtectedFinalizationRisk(protectedRiskInput());
    const result = buildReviewEffectiveDisposition({
      generatedAt: "2026-08-27T00:00:00.000Z",
      reviewPackage: protectedReviewPackage(),
      componentRisks: evaluated.riskAssessment.componentRisks,
      humanAuthorityVerified: protectedAuthority(false).authorityVerified,
    });
    expect(result.summary.effectiveMandatoryReviewCount).toBe(7);
  });
});
