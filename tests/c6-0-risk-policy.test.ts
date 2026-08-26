import { describe, expect, it } from "vitest";

import {
  C60_INVESTIGATION_BASELINE_COMMIT,
  C60_OBSERVED_INVESTIGATION_CODES,
  C60_PROTECTED_POLICY_HASH,
  C60_PROTECTED_RISK_POLICY,
  c60PolicyEntry,
  createC60ProtectedRiskPolicy,
  verifyC60ProtectedRiskPolicy,
} from "@mvl/video-subtitler";

describe("C6.0 protected risk policy", () => {
  it("covers all 70 investigation signals with exact-match entries", () => {
    expect(C60_OBSERVED_INVESTIGATION_CODES).toHaveLength(70);
    expect(new Set(C60_OBSERVED_INVESTIGATION_CODES).size).toBe(70);
    expect(
      C60_OBSERVED_INVESTIGATION_CODES.every(
        (code) => c60PolicyEntry(code) !== undefined,
      ),
    ).toBe(true);
    expect(C60_PROTECTED_RISK_POLICY.exactMatchOnly).toBe(true);
    expect(C60_PROTECTED_RISK_POLICY.unknownSignalsFailClosed).toBe(true);
  });

  it("does not demote unknown or prefix-related codes", () => {
    expect(c60PolicyEntry("C6_TEST_UNKNOWN_BLOCKER")).toBeUndefined();
    expect(
      c60PolicyEntry("CTC_START_WINDOW_UNSTABLE_FUTURE_VARIANT"),
    ).toBeUndefined();
  });

  it("has deterministic provenance and detects policy tampering", () => {
    expect(createC60ProtectedRiskPolicy().policyHash).toBe(
      C60_PROTECTED_POLICY_HASH,
    );
    expect(verifyC60ProtectedRiskPolicy(C60_PROTECTED_RISK_POLICY)).toBe(true);
    expect(C60_PROTECTED_RISK_POLICY.investigationBaselineCommit).toBe(
      C60_INVESTIGATION_BASELINE_COMMIT,
    );
    const tampered = structuredClone(C60_PROTECTED_RISK_POLICY);
    const firstEntry = tampered.entries.at(0);
    if (firstEntry === undefined) throw new Error("Expected policy entry.");
    firstEntry.rationale = "tampered";
    expect(verifyC60ProtectedRiskPolicy(tampered)).toBe(false);
  });
});
