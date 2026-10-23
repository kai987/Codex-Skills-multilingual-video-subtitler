import { machineCtcIntegrationSchema } from "@mvl/shared";
import { deriveMachineIntegrationSummaryCounts } from "@mvl/video-subtitler";
import { describe, expect, it } from "vitest";

import {
  c6011ArtifactHeader,
  verifiedEvidenceQuality,
} from "./helpers/c6-0-1-1-quality-fixture.js";

describe("C6.0.1.1 machine CTC", () => {
  it("keeps CTC text immutable while counting direct inference", () => {
    const counts = deriveMachineIntegrationSummaryCounts(
      "machine-ctc-integration",
      {
        summary: {
          directInferenceCount: 8,
          directCacheHitCount: 0,
          modelLoadCount: 1,
          targetEncodableCueCount: 4,
          timingMutationCueCount: 1,
          canonicalTextMutationCount: 0,
        },
      },
    );
    const artifact = machineCtcIntegrationSchema.parse({
      ...c6011ArtifactHeader,
      artifactType: "machine-ctc-integration",
      integration: {
        status: "applied",
        runtimeIdentity: "ctc-runtime",
        ...counts,
        reasons: [],
      },
      evidenceQuality: verifiedEvidenceQuality,
    });
    expect(artifact.integration.modelInferenceCount).toBe(8);
    expect(artifact.integration.canonicalCueMutationCount).toBe(0);
  });
});
