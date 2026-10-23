import { asrRetentionAuditSchema } from "@mvl/shared";
import { describe, expect, it } from "vitest";

import { c6011ArtifactHeader } from "./helpers/c6-0-1-1-quality-fixture.js";

describe("C6.0.1.1 ASR retention", () => {
  it("records enforce-mode prompt isolation and each survival count", () => {
    const artifact = asrRetentionAuditSchema.parse({
      ...c6011ArtifactHeader,
      artifactType: "asr-retention-audit",
      baseline: {
        chunkCount: 30,
        rawSegmentCount: 169,
        canonicalUtteranceCount: 157,
        acceptedCueCount: 98,
        suspectedHallucinationCount: 0,
        crossUtteranceLoopCount: 0,
      },
      candidateRetention: {
        canonicalUtteranceCount: 157,
        candidateCount: 385,
        clusterCount: 203,
        winnerCount: 203,
        postDeduplicationCount: 182,
        postFragmentRepairCount: 172,
        postNormalizationCount: 171,
        finalIntegrityCandidateCount: 125,
        finalCueCount: 98,
      },
      promptContamination: {
        recoveryAttemptCount: 70,
        baselineCarryPromptCount: 0,
        refinementContextPromptCount: 0,
        attemptsWithAdjacentText: 0,
        attemptsWithUnverifiedAdjacentText: 0,
        uniqueAdjacentPromptCount: 0,
        provisionalMachineTextPromptCount: 0,
        promptIsolationPassed: true,
        contaminationDetected: false,
      },
    });
    expect(artifact.promptContamination.promptIsolationPassed).toBe(true);
    expect(artifact.candidateRetention.finalCueCount).toBe(98);
  });
});
