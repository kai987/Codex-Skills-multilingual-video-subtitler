import { describe, expect, it } from "vitest";

import { c60HumanAuthorityDependencyAuditSchema } from "@mvl/shared";

describe("C6.0 human authority separation", () => {
  it("requires human-baseline and machine-only readiness to be represented independently", () => {
    const result = c60HumanAuthorityDependencyAuditSchema.safeParse({
      schemaVersion: "1.0.0",
      investigationVersion: "C6.0",
      artifactType: "c6-0-human-authority-dependency-audit",
      generatedAt: "2026-08-27T00:00:00.000Z",
      sourceSnapshot: {
        sourceTaskName: "fixture",
        sourceTaskHash: "a".repeat(64),
        canonicalCueHash: "b".repeat(64),
        timingHash: "c".repeat(64),
        outputCueHash: "b".repeat(64),
        sourceStatus: "needs-review",
        sourceFinalizationMethod: "none",
        sourceReviewItemCount: 7,
        sourceFinalArtifactPresent: false,
        causalReplayParity: true,
        frozenReplayParity: true,
      },
      authority: "user-confirmed-human-review",
      baselineCueCount: 192,
      baselineReadOnlyVerified: true,
      humanAuthorityUsedForCanonicalText: true,
      humanAuthorityUsedForCanonicalTiming: true,
      machineOnlyBlindProofPresent: false,
      humanBaselineCounterfactualReady: true,
      machineOnlyZeroTouchReady: false,
      dependencyRisks: ["human baseline dependency"],
      blindDatasetMethodology: ["pre-register a blind held-out corpus"],
      semanticHash: "d".repeat(64),
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.humanBaselineCounterfactualReady).toBe(true);
      expect(result.data.machineOnlyZeroTouchReady).toBe(false);
    }
  });
});
