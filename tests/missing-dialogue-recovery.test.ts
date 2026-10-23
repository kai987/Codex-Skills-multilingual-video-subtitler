import { machineCoverageRecoverySchema } from "@mvl/shared";
import { describe, expect, it } from "vitest";

import { c6011ArtifactHeader } from "./helpers/c6-0-1-1-quality-fixture.js";

describe("C6.0.1.1 missing dialogue recovery", () => {
  it("requires machine-only prompt isolation and explicit unresolved counts", () => {
    const artifact = machineCoverageRecoverySchema.parse({
      ...c6011ArtifactHeader,
      artifactType: "machine-coverage-recovery",
      recoveryUnitCount: 3,
      recoveryRequestCount: 6,
      recoveredUnitCount: 1,
      unresolvedUnitCount: 2,
      cacheHitCount: 0,
      adjacentPromptPolicy: "disabled-unverified-context",
      adjacentPromptCount: 0,
      unverifiedAdjacentPromptCount: 0,
      canonicalCueMutationCount: 1,
      canonicalTimingMutationCount: 1,
    });
    expect(artifact.recoveredUnitCount + artifact.unresolvedUnitCount).toBe(
      artifact.recoveryUnitCount,
    );
    expect(artifact.unverifiedAdjacentPromptCount).toBe(0);
  });
});
