import { describe, expect, it } from "vitest";

import { evaluateProtectedFinalizationRisk } from "@mvl/video-subtitler";

import {
  protectedAuthority,
  protectedRiskInput,
} from "./helpers/c6-0-protected-fixture.js";

describe("C6.0 protected risk assessment", () => {
  it("separates current-output safety from automatic mutation safety", () => {
    const result = evaluateProtectedFinalizationRisk(protectedRiskInput());
    expect(result.riskAssessment.protectedOutcome).toBe(
      "FINAL_SAFE_WITH_ADVISORIES",
    );
    expect(result.riskAssessment.summary).toMatchObject({
      positiveCurrentOutputDefectEvidenceCount: 0,
      effectiveProtectedFinalBlockerCount: 0,
      effectiveMandatoryReviewCount: 0,
      effectiveAdvisoryReviewCount: 6,
      preservationSupportedReviewCount: 1,
      speakerRelationshipResolvedComponentCount: 1,
      subtitleOverlapResolvedComponentCount: 0,
    });
  });

  it("fails closed for unknown, integrity, positive-risk, and machine-only cases", () => {
    const unknown = evaluateProtectedFinalizationRisk(
      protectedRiskInput({ additionalSignals: ["C6_TEST_UNKNOWN_BLOCKER"] }),
    );
    expect(unknown.riskAssessment.summary.unknownObservedSignalCount).toBe(1);
    expect(unknown.riskAssessment.protectedOutcome).toBe(
      "HUMAN_REVIEW_REQUIRED",
    );

    const integrity = evaluateProtectedFinalizationRisk(
      protectedRiskInput({ additionalSignals: ["SOURCE_MEDIA_CHANGED"] }),
    );
    expect(integrity.riskAssessment.protectedOutcome).toBe(
      "HUMAN_REVIEW_REQUIRED",
    );

    const positive = evaluateProtectedFinalizationRisk(
      protectedRiskInput({ positiveRiskComponent: 0 }),
    );
    expect(
      positive.riskAssessment.summary
        .positiveCurrentOutputDefectEvidenceCount,
    ).toBe(1);
    expect(positive.riskAssessment.protectedOutcome).toBe(
      "HUMAN_REVIEW_REQUIRED",
    );

    const machine = evaluateProtectedFinalizationRisk(
      protectedRiskInput({ authority: protectedAuthority(false) }),
    );
    expect(machine.riskAssessment.protectedOutcome).toBe(
      "MACHINE_ONLY_NOT_AUTHORIZED",
    );
    expect(machine.riskAssessment.machineOnlyReleaseAuthorized).toBe(false);
    expect(machine.riskAssessment.blindAcceptanceRequired).toBe(true);
  });
});
