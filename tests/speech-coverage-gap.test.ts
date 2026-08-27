import { machineSpeechCoverageGapSchema } from "@mvl/shared";
import { describe, expect, it } from "vitest";

import { c6011ArtifactHeader } from "./helpers/c6-0-1-1-quality-fixture.js";

describe("C6.0.1.1 speech coverage gaps", () => {
  it("represents only uncovered speech intervals with bounded coverage", () => {
    const artifact = machineSpeechCoverageGapSchema.parse({
      ...c6011ArtifactHeader,
      artifactType: "machine-speech-coverage-gap",
      speechIntervalCount: 2,
      cueCount: 1,
      speechSeconds: 5,
      coveredSpeechSeconds: 3,
      coverageRatio: 0.6,
      gaps: [
        {
          id: "gap-1",
          start: 3,
          end: 5,
          duration: 2,
          reason: "speech-without-subtitle",
        },
      ],
    });
    expect(artifact.gaps).toHaveLength(1);
    expect(artifact.coverageRatio).toBe(0.6);
  });
});
