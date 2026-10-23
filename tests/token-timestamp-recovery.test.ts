import {
  machineTimingEvidenceSchema,
  machineTokenTimestampRecoverySchema,
} from "@mvl/shared";
import { describe, expect, it } from "vitest";

import { c6011ArtifactHeader } from "./helpers/c6-0-1-1-quality-fixture.js";

describe("C6.0.1.1 token timing", () => {
  it("fails closed when stock VAD has no verified mapped-token timeline", () => {
    const token = machineTokenTimestampRecoverySchema.parse({
      ...c6011ArtifactHeader,
      artifactType: "machine-token-timestamp-recovery",
      baselineCueCount: 10,
      baselineCueWithTokenCount: 0,
      recoveryAttemptCount: 2,
      recoveryAttemptWithTokenCount: 1,
      mappedTokenCount: 0,
      unmappedTokenCount: 4,
      trustedForCanonicalTiming: false,
      rejectionReasons: ["no-verified-mapped-token-timeline-in-current-run"],
    });
    const timing = machineTimingEvidenceSchema.parse({
      ...c6011ArtifactHeader,
      artifactType: "machine-timing-evidence",
      timestampStrategy: "segment",
      targetChunkSeconds: 30,
      vadEnabled: true,
      rawVadEvidenceAvailable: true,
      mappedTokenEvidenceAvailable: false,
      stockVadTimelineTrusted: false,
      timingEvidenceApplied: false,
      timingMutationCount: 0,
      reasons: ["stock-vad-timeline-not-applied-without-verified-mapping"],
    });
    expect(token.trustedForCanonicalTiming).toBe(false);
    expect(timing.timingEvidenceApplied).toBe(false);
  });
});
