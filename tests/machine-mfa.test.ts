import { machineMfaIntegrationSchema } from "@mvl/shared";
import { deriveMachineIntegrationSummaryCounts } from "@mvl/video-subtitler";
import { describe, expect, it } from "vitest";

import {
  c6011ArtifactHeader,
  verifiedEvidenceQuality,
} from "./helpers/c6-0-1-1-quality-fixture.js";

describe("C6.0.1.1 machine MFA", () => {
  it("reports real MFA process loads without claiming an unsupported mutation", () => {
    const counts = deriveMachineIntegrationSummaryCounts(
      "machine-mfa-integration",
      {
        summary: {
          mfaProcessCount: 4,
          cacheHitCount: 0,
          eligibleCueCount: 2,
          timingMutationCount: 0,
          canonicalTextMutationCount: 0,
        },
      },
    );
    const artifact = machineMfaIntegrationSchema.parse({
      ...c6011ArtifactHeader,
      artifactType: "machine-mfa-integration",
      integration: {
        status: "observed",
        runtimeIdentity: "mfa-runtime",
        ...counts,
        reasons: [],
      },
      evidenceQuality: verifiedEvidenceQuality,
    });
    expect(artifact.integration.modelInferenceCount).toBe(4);
    expect(artifact.integration.modelLoadCount).toBe(4);
    expect(artifact.integration.canonicalTimingMutationCount).toBe(0);
  });
});
