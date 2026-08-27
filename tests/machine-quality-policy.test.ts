import { machineQualityRecoveryPolicySchema } from "@mvl/shared";
import { describe, expect, it } from "vitest";

import { c6011ArtifactHeader } from "./helpers/c6-0-1-1-quality-fixture.js";

describe("C6.0.1.1 machine quality policy", () => {
  it("keeps full review retention separate from release authorization", () => {
    const artifact = machineQualityRecoveryPolicySchema.parse({
      ...c6011ArtifactHeader,
      artifactType: "machine-quality-recovery-policy",
      defaultMode: "off",
      productionStatus: "needs-review",
      finalizationMethod: "none",
      machineOnlyReleaseAuthorized: false,
      humanDerivedRuntimeInputAllowed: false,
      strategies: {
        targetChunkSeconds: 30,
        vadMode: "off",
        sceneRouting: "aggressive",
        adjacentPromptPolicy: "disabled-unverified-context",
        reviewEvidenceRetention: "needs-review-only",
      },
      milestone: {
        normalizedCerMaximum: 0.65,
        coverageMinimum: 0.8,
        missingDialogueMaximum: 35,
        materialTextDefectMaximum: 30,
        startMaeSecondsMaximum: 1.75,
        endMaeSecondsMaximum: 1.75,
        p95BoundaryErrorSecondsMaximum: 4.5,
        severeTimingDefectMaximum: 25,
        hallucinationMaximum: 2,
      },
    });
    expect(artifact.strategies.reviewEvidenceRetention).toBe(
      "needs-review-only",
    );
    expect(artifact.machineOnlyReleaseAuthorized).toBe(false);
    expect(artifact.finalizationMethod).toBe("none");
  });
});
