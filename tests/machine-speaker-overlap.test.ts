import { machineSpeakerOverlapRecoverySchema } from "@mvl/shared";
import { deriveMachineIntegrationSummaryCounts } from "@mvl/video-subtitler";
import { describe, expect, it } from "vitest";

import {
  c6011ArtifactHeader,
  verifiedEvidenceQuality,
} from "./helpers/c6-0-1-1-quality-fixture.js";

describe("C6.0.1.1 machine speaker overlap", () => {
  it("separates speaker-relationship resolution from subtitle timing mutation", () => {
    const counts = deriveMachineIntegrationSummaryCounts(
      "machine-speaker-overlap-recovery",
      {
        summary: {
          pipelineInferenceCount: 6,
          modelLoadCount: 1,
          cacheHitCount: 0,
          targetComponentCount: 3,
          resolvedComponentCount: 1,
          canonicalTextMutationCount: 0,
          timingMutationCount: 0,
        },
      },
    );
    const artifact = machineSpeakerOverlapRecoverySchema.parse({
      ...c6011ArtifactHeader,
      artifactType: "machine-speaker-overlap-recovery",
      integration: {
        status: "applied",
        runtimeIdentity: "speaker-runtime",
        ...counts,
        reasons: [],
      },
      evidenceQuality: verifiedEvidenceQuality,
    });
    expect(artifact.integration.appliedCount).toBe(1);
    expect(artifact.integration.canonicalTimingMutationCount).toBe(0);
  });
});
