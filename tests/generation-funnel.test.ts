import { machineGenerationSurvivalFunnelSchema } from "@mvl/shared";
import { describe, expect, it } from "vitest";

import { c6011ArtifactHeader } from "./helpers/c6-0-1-1-quality-fixture.js";

describe("C6.0.1.1 generation funnel", () => {
  it("tracks retained and rejected units without orphaning the final cue", () => {
    const artifact = machineGenerationSurvivalFunnelSchema.parse({
      ...c6011ArtifactHeader,
      artifactType: "machine-generation-survival-funnel",
      stages: [
        {
          id: "candidate-to-final",
          inputCount: 2,
          outputCount: 1,
          droppedCount: 1,
          retentionRatio: 0.5,
          lossReasons: [{ reason: "quality-gate-rejected", count: 1 }],
        },
      ],
      snapshots: [
        {
          id: "candidate",
          unitCount: 2,
          textCharacterCount: 8,
          temporalCoverageSeconds: 4,
          uniqueTemporalCoverageSeconds: 4,
          sourceUnitIds: ["candidate-1", "candidate-2"],
        },
        {
          id: "final-machine-cue",
          unitCount: 1,
          textCharacterCount: 4,
          temporalCoverageSeconds: 2,
          uniqueTemporalCoverageSeconds: 2,
          sourceUnitIds: ["final-1"],
        },
      ],
      finalCueLineage: [
        {
          finalCueId: "final-1",
          rawAsrSegmentIds: ["raw-1"],
          sourceRequestIds: ["request-1"],
          audioIntervals: [{ start: 1, end: 3 }],
          decisionPath: ["candidate", "final-machine-cue"],
          unresolvedLineageReasons: [],
        },
      ],
      rejectedUnits: [
        {
          unitId: "candidate-2",
          stage: "candidate-to-final",
          reason: "quality-gate-rejected",
          evidenceIds: ["finding-1"],
        },
      ],
      summary: {
        whisperRequestCount: 1,
        baselineChunkCount: 1,
        baselineAcceptedCueCount: 1,
        recoveryRequestCount: 0,
        recoveredCueCount: 0,
        rawSegmentCount: 1,
        finalCueCount: 1,
        dominantLossStage: "candidate-to-final",
        dominantLossCount: 1,
        unknownRejectionCount: 0,
        lineageCompleteCueCount: 1,
        lineageIncompleteCueCount: 0,
      },
    });
    expect(artifact.stages[0]?.droppedCount).toBe(1);
    expect(artifact.finalCueLineage[0]?.rawAsrSegmentIds).toEqual(["raw-1"]);
    expect(artifact.summary.unknownRejectionCount).toBe(0);
  });
});
