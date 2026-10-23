import {
  c6012QualityPolicySchema,
  machineAcousticEventFamiliesSchema,
  machineCrossWindowConsensusSchema,
  machineCueTimelineEvidenceSchema,
  machineGlobalTokenTimelineSchema,
  machineLexicalConservationSchema,
  machineOverlapEventClassificationSchema,
  machineTimingNonDegradationSchema,
} from "@mvl/shared";
import { runCandidatePrecisionWorkflow } from "@mvl/video-subtitler";
import { describe, expect, it } from "vitest";

import {
  baselineCue,
  noVadCue,
  requestContract,
  vadCue,
} from "../helpers/c6-0-1-2-fixtures.js";

describe("C6.0.1.2 candidate timeline flow", () => {
  it("consolidates candidates, maps only verified tokens, and remains Gold-isolated", () => {
    const result = runCandidatePrecisionWorkflow({
      cues: [baselineCue],
      evidenceCues: [baselineCue, noVadCue, vadCue],
      requestTimelineContract: requestContract,
      candidateConsensus: "enforce",
      globalTokenTimeline: "enforce",
      generatedAt: "2026-08-27T00:00:00.000Z",
    });
    expect(
      machineAcousticEventFamiliesSchema.safeParse(result.acousticEventFamilies)
        .success,
    ).toBe(true);
    expect(
      machineCrossWindowConsensusSchema.safeParse(result.crossWindowConsensus)
        .success,
    ).toBe(true);
    expect(
      machineGlobalTokenTimelineSchema.safeParse(result.globalTokenTimeline)
        .success,
    ).toBe(true);
    expect(
      machineCueTimelineEvidenceSchema.safeParse(result.cueTimelineEvidence)
        .success,
    ).toBe(true);
    expect(
      machineTimingNonDegradationSchema.safeParse(result.timingNonDegradation)
        .success,
    ).toBe(true);
    expect(
      machineLexicalConservationSchema.safeParse(result.lexicalConservation)
        .success,
    ).toBe(true);
    expect(
      machineOverlapEventClassificationSchema.safeParse(
        result.overlapEventClassification,
      ).success,
    ).toBe(true);
    expect(result.globalTokenTimeline.summary.trustedMappedTokenCount).toBe(3);
    expect(JSON.stringify(result)).not.toContain("Gold");
    expect(
      c6012QualityPolicySchema.safeParse({
        schemaVersion: "1.0.0",
        policyVersion: "c6.0.1.2-candidate-precision-global-timeline-v1",
        generatedAt: "2026-08-27T00:00:00.000Z",
        artifactType: "c6-0-1-2-quality-policy",
        candidateConsensus: "enforce",
        globalTokenTimeline: "enforce",
        goldRuntimeInputCount: 0,
        productionStatus: "needs-review",
        finalizationMethod: "none",
        machineOnlyRelease: false,
        artifactSemanticHashes: Array.from({ length: 8 }, () => "a".repeat(64)),
        gates: {
          minimumCoverage: 0.9,
          maximumMissing: 15,
          maximumHallucinations: 2,
          maximumMaterialErrors: 45,
          maximumSevereTimingErrors: 30,
          maximumStartMaeSeconds: 1.2,
          maximumEndMaeSeconds: 1.2,
          maximumP95BoundaryErrorSeconds: 3.5,
          maximumNormalizedCer: 0.55,
          maximumOverlapPairs: 20,
        },
        semanticHash: "b".repeat(64),
      }).success,
    ).toBe(true);
  });
});
