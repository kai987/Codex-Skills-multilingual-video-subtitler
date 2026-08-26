import { describe, expect, it } from "vitest";

import {
  C60_PROTECTED_RISK_POLICY,
  evaluateProtectedFinalizationRisk,
} from "@mvl/video-subtitler";

import {
  protectedAuthority,
  protectedRiskInput,
} from "./helpers/c6-0-protected-fixture.js";

describe("C6.0 protected finalization gates", () => {
  it.each(["legacy", "protected-observe", "protected-enforce"] as const)(
    "keeps the mode explicit for %s",
    (mode) => {
      const result = evaluateProtectedFinalizationRisk(
        protectedRiskInput({ mode }),
      );
      expect(result.riskAssessment.mode).toBe(mode);
      expect(result.riskAssessment.machineOnlyReleaseAuthorized).toBe(false);
    },
  );

  it("allows human preservation but never machine-only release", () => {
    const human = evaluateProtectedFinalizationRisk(protectedRiskInput());
    expect(human.riskAssessment.baselinePreservation).toMatchObject({
      eligible: true,
      applied: true,
    });
    const machine = evaluateProtectedFinalizationRisk(
      protectedRiskInput({ authority: protectedAuthority(false) }),
    );
    expect(machine.riskAssessment.baselinePreservation.applied).toBe(false);
    expect(machine.riskAssessment.protectedOutcome).toBe(
      "MACHINE_ONLY_NOT_AUTHORIZED",
    );
  });

  it("fails closed when the source-controlled policy is tampered", () => {
    const policy = structuredClone(C60_PROTECTED_RISK_POLICY);
    policy.entries[0]!.rationale = "tampered";
    const result = evaluateProtectedFinalizationRisk({
      ...protectedRiskInput(),
      policy,
    });
    expect(result.riskAssessment.policyIntegrityPassed).toBe(false);
    expect(result.riskAssessment.protectedOutcome).toBe(
      "HUMAN_REVIEW_REQUIRED",
    );
  });
});
