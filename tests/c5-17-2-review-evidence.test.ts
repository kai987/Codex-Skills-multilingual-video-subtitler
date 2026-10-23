import { describe, expect, it } from "vitest";

import type {
  SubtitleCanonicalForcedAlignment,
  SubtitleCanonicalPronunciation,
  SubtitleOverlapAcousticResolution,
  SubtitlePresentationResolution,
  SubtitleTimestampEvidenceIntegrity,
} from "@mvl/shared";
import {
  reconcileReviewEvidence,
  selectRepresentativeMappedInterval,
} from "@mvl/video-subtitler";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);
const HASH_E = "e".repeat(64);
const CUE_ID = "cue-a";
const COMPONENT_ID = "component-a";

function fixtures(
  input: {
    includeTrustedMapped?: boolean;
    includeUntrustedMapped?: boolean;
    includeCueRawProjection?: boolean;
    missingEvidenceId?: boolean;
    reverseMatched?: boolean;
  } = {},
) {
  const matched = [
    ...(input.includeTrustedMapped === false
      ? []
      : [
          {
            evidenceId: input.missingEvidenceId ? undefined : "mapped-high",
            evidenceLineageId: "mapped-lineage-high",
            attemptId: "attempt-z",
            source: "trusted-mapped-token",
            start: 2,
            end: 3.8,
            timingUsable: true,
            parentSegmentContainmentPassed: true,
            timestampTrustStatus: "trusted-mapped-original-timeline",
            timingTrustScore: 0.95,
            alignmentScore: 0.8,
            profileConsensusScore: 0.7,
            boundaryConfidence: 0.75,
            neighborIntrusionRatio: 0.05,
            sourceTypeSupportCount: 2,
          },
          {
            evidenceId: "mapped-low",
            evidenceLineageId: "mapped-lineage-low",
            attemptId: "attempt-a",
            source: "trusted-no-vad-token",
            start: 2.2,
            end: 3.7,
            timingUsable: true,
            parentSegmentContainmentPassed: true,
            timestampTrustStatus: "trusted-original-timeline",
            timingTrustScore: 0.6,
            alignmentScore: 0.99,
            profileConsensusScore: 1,
            boundaryConfidence: 1,
            neighborIntrusionRatio: 0,
            sourceTypeSupportCount: 4,
          },
        ]),
    ...(input.includeUntrustedMapped
      ? [
          {
            evidenceId: "mapped-untrusted",
            evidenceLineageId: "mapped-lineage-untrusted",
            attemptId: "attempt-a",
            source: "trusted-mapped-token",
            start: 1,
            end: 4.5,
            timingUsable: false,
            parentSegmentContainmentPassed: true,
            timestampTrustStatus: "untrusted",
            timingTrustScore: 1,
            alignmentScore: 1,
            profileConsensusScore: 1,
            boundaryConfidence: 1,
            neighborIntrusionRatio: 0,
            sourceTypeSupportCount: 9,
          },
        ]
      : []),
    {
      evidenceId: "decoded-a",
      evidenceLineageId: "decoded-lineage-a",
      attemptId: "attempt-a",
      source: "decoded-segment",
      start: 1.9,
      end: 4.1,
      timingUsable: true,
      parentSegmentContainmentPassed: true,
      timestampTrustStatus: "trusted-original-timeline",
      timingTrustScore: 0.7,
      alignmentScore: 0.7,
      profileConsensusScore: 0.5,
      boundaryConfidence: 0.5,
      neighborIntrusionRatio: 0.1,
      sourceTypeSupportCount: 1,
    },
    ...(input.includeCueRawProjection
      ? [
          {
            evidenceId: "raw-a",
            evidenceLineageId: "raw-lineage-a",
            attemptId: "attempt-a",
            source: "raw-vad",
            start: 1.8,
            end: 4.2,
            timingUsable: true,
            parentSegmentContainmentPassed: true,
            timestampTrustStatus: "trusted-original-timeline",
            timingTrustScore: 1,
            alignmentScore: 0,
            profileConsensusScore: 1,
            boundaryConfidence: 0,
            neighborIntrusionRatio: 0,
            sourceTypeSupportCount: 1,
          },
        ]
      : []),
  ];
  if (input.reverseMatched) matched.reverse();

  const forcedAlignment = {
    attempts: [
      {
        attemptId: "mfa-narrow-a",
        boundaryStart: 1.8,
        boundaryEnd: 4.2,
        alignmentSucceeded: true,
        wordCoverageRatio: 1,
        phoneCoverageRatio: 1,
        readingCoverageRatio: 1,
        selectedBoundarySource: "lexical-word-tier",
        windowType: "narrow",
        lexicalUtteranceInterval: { start: 1.8, end: 4.2 },
        phoneUtteranceInterval: { start: 1.8, end: 4.2 },
        startPinnedToWindowEdge: false,
        endPinnedToWindowEdge: false,
      },
      {
        attemptId: "mfa-expanded-a",
        boundaryStart: 1.7,
        boundaryEnd: 4.3,
        alignmentSucceeded: true,
        wordCoverageRatio: 1,
        phoneCoverageRatio: 1,
        readingCoverageRatio: 1,
        selectedBoundarySource: "lexical-word-tier",
        windowType: "expanded",
        lexicalUtteranceInterval: { start: 1.7, end: 4.3 },
        phoneUtteranceInterval: { start: 1.7, end: 4.3 },
        startPinnedToWindowEdge: false,
        endPinnedToWindowEdge: false,
      },
    ],
    cueAlignments: [
      {
        cueId: CUE_ID,
        evidenceDp: {
          startBoundary: 2,
          endBoundary: 3.8,
          boundaryEvidenceIds: ["dp-a"],
          fabricatedBoundaryCount: 0,
          pathScore: 0.7,
          coverageRatio: 0.8,
          blockers: [],
        },
      },
    ],
    components: [
      {
        componentId: COMPONENT_ID,
        cueAlignments: [
          {
            cueId: CUE_ID,
            narrowAttemptId: "mfa-narrow-a",
            expandedAttemptId: "mfa-expanded-a",
            selectedBoundary: null,
            boundaryEvidenceIds: [],
            antiForcingPassed: false,
            blockers: ["MACHINE_EVIDENCE_ONLY"],
            antiForcingMetrics: {
              windowStabilityScore: 0.9,
              neighborCueIntrusionRatio: 0.1,
            },
          },
        ],
      },
    ],
  } as unknown as SubtitleCanonicalForcedAlignment;

  const overlapAcoustic = {
    attempts: [
      {
        attemptId: "attempt-a",
        profile: "no-vad",
        rawVadIntervals: [
          {
            intervalId: "raw-a",
            start: 1.8,
            end: 4.2,
            timingUsable: true,
          },
        ],
        decodedSegmentIntervals: [
          {
            intervalId: "decoded-a",
            evidenceLineageId: "decoded-lineage-a",
            start: 1.9,
            end: 4.1,
            timingUsable: true,
            timingTrustScore: 0.7,
          },
        ],
      },
      {
        attemptId: "attempt-z",
        profile: "sensitive-vad",
        rawVadIntervals: [],
        decodedSegmentIntervals: [],
      },
    ],
    components: [
      {
        componentId: COMPONENT_ID,
        profileAttemptIds: ["attempt-a", "attempt-z"],
        cueAlignments: [
          {
            cueId: CUE_ID,
            matchedIntervals: matched,
            sequenceParentSegmentIds: ["decoded-a"],
            trustedRawVadEvidenceIds: input.includeCueRawProjection
              ? ["raw-a"]
              : [],
            blockers: [],
          },
        ],
      },
    ],
  } as unknown as SubtitleOverlapAcousticResolution;

  const timestampIntegrity = {
    attempts: [
      {
        attemptId: "attempt-a",
        rawVadEvaluations: [
          {
            intervalId: "raw-a",
            evidenceLineageId: "raw-lineage-a",
            timingUsable: true,
            healthStatus: "trusted",
            timingTrustScore: 1,
            rawStart: 0.2,
            rawEnd: 2.6,
            normalizedStart: 0.2,
            normalizedEnd: 2.6,
            normalizationApplied: false,
            normalizationDeltaStart: 0,
            normalizationDeltaEnd: 0,
          },
        ],
      },
      { attemptId: "attempt-z", rawVadEvaluations: [] },
    ],
  } as unknown as SubtitleTimestampEvidenceIntegrity;

  const presentation = {
    overlapDecisions: [{ cueIds: [CUE_ID] }],
  } as unknown as SubtitlePresentationResolution;
  const pronunciation = {
    cues: [{ cueId: CUE_ID }],
  } as unknown as SubtitleCanonicalPronunciation;
  return {
    componentId: COMPONENT_ID,
    cueIds: [CUE_ID],
    sourceCueIntervals: new Map([[CUE_ID, { start: 2, end: 4 }]]),
    forcedAlignment,
    overlapAcoustic,
    timestampIntegrity,
    presentation,
    pronunciation,
    artifactHashes: {
      canonicalForcedAlignment: HASH_A,
      overlapAcousticResolution: HASH_B,
      timestampEvidenceIntegrity: HASH_C,
      presentationResolution: HASH_D,
      canonicalPronunciation: HASH_E,
    },
  };
}

describe("C5.17.2 representative mapped-token selection", () => {
  const high = {
    interval: { start: 2, end: 3.8 },
    timingTrustScore: 0.95,
    alignmentScore: 0.8,
    profileConsensusScore: 0.7,
    boundaryConfidence: 0.75,
    neighborIntrusionRatio: 0.05,
    sourceTypeSupportCount: 2,
    evidenceId: "z-attempt-but-high-trust",
    evidenceLineageId: "high",
  };
  const low = {
    interval: { start: 2.2, end: 3.7 },
    timingTrustScore: 0.6,
    alignmentScore: 1,
    profileConsensusScore: 1,
    boundaryConfidence: 1,
    neighborIntrusionRatio: 0,
    sourceTypeSupportCount: 5,
    evidenceId: "a-attempt-but-low-trust",
    evidenceLineageId: "low",
  };

  it("prioritizes timing trust before attempt/evidence identifiers", () => {
    expect(selectRepresentativeMappedInterval([low, high])).toEqual(
      high.interval,
    );
  });

  it("is independent of input order", () => {
    expect(selectRepresentativeMappedInterval([high, low])).toEqual(
      selectRepresentativeMappedInterval([low, high]),
    );
  });

  it("deduplicates a lineage before deterministic ranking", () => {
    const duplicate = {
      ...low,
      evidenceId: "duplicate-weaker",
      evidenceLineageId: "high",
    };
    expect(selectRepresentativeMappedInterval([duplicate, high, low])).toEqual(
      high.interval,
    );
  });
});

describe("C5.17.2 evidence lineage reconciliation", () => {
  it("keeps Evidence-DP exclusively labelled as Evidence-DP", () => {
    const result = reconcileReviewEvidence(fixtures());
    const dp = result.cueEvidence
      .get(CUE_ID)
      ?.filter((value) => value.sourceType === "evidence-dp");
    expect(dp).toHaveLength(1);
    expect(dp?.[0]?.evidenceLineageId).toContain("evidence-dp:");
  });

  it("projects the representative boundary from trusted matched tokens", () => {
    const result = reconcileReviewEvidence(fixtures());
    expect(result.mappedTokenBoundaryByCue.get(CUE_ID)).toEqual({
      start: 2,
      end: 3.8,
    });
    expect(
      result.cueEvidence
        .get(CUE_ID)
        ?.filter((value) => value.sourceType === "trusted-mapped-token"),
    ).toHaveLength(1);
  });

  it("does not admit an untrusted or timing-unusable matched token", () => {
    const result = reconcileReviewEvidence(
      fixtures({ includeTrustedMapped: false, includeUntrustedMapped: true }),
    );
    expect(result.mappedTokenBoundaryByCue.get(CUE_ID)).toBeNull();
    expect(
      result.cueEvidence
        .get(CUE_ID)
        ?.some((value) => value.evidenceId === "mapped-untrusted"),
    ).toBe(false);
  });

  it("keeps trusted Raw VAD as component-level speech evidence", () => {
    const result = reconcileReviewEvidence(fixtures());
    expect(result.componentRawVadIntervals).toHaveLength(1);
    expect(result.componentRawVadIntervals[0]).toMatchObject({
      sourceType: "raw-vad",
      scope: "component",
      sideSupport: "none",
      sourceArtifactType: "subtitle-timestamp-evidence-integrity",
    });
    expect(result.rawVadBoundaryByCue.get(CUE_ID)).toBeNull();
  });

  it("only projects legacy Raw VAD when upstream explicitly assigns it", () => {
    const result = reconcileReviewEvidence(
      fixtures({ includeCueRawProjection: true }),
    );
    expect(result.rawVadBoundaryByCue.get(CUE_ID)).toEqual({
      start: 1.8,
      end: 4.2,
    });
    expect(result.componentRawVadIntervals[0]?.scope).toBe("component");
  });

  it("never labels a decoded segment as Raw VAD", () => {
    const result = reconcileReviewEvidence(fixtures());
    expect(result.componentDecodedSegments[0]).toMatchObject({
      sourceType: "decoded-segment",
      scope: "component",
    });
    expect(
      result.componentRawVadIntervals.some(
        (value) => value.evidenceId === "decoded-a",
      ),
    ).toBe(false);
  });

  it("marks the human source cue prior as non-acoustic", () => {
    const result = reconcileReviewEvidence(fixtures());
    expect(
      result.cueEvidence
        .get(CUE_ID)
        ?.find((value) => value.sourceType === "source-cue-prior"),
    ).toMatchObject({ acousticEvidence: false, scope: "cue" });
  });

  it("keeps MFA narrow and expanded attempts distinct", () => {
    const result = reconcileReviewEvidence(fixtures());
    const types = result.cueEvidence
      .get(CUE_ID)
      ?.map((value) => value.sourceType);
    expect(types).toContain("mfa-narrow");
    expect(types).toContain("mfa-expanded");
  });

  it("reports unresolved evidence identities instead of inventing them", () => {
    const result = reconcileReviewEvidence(
      fixtures({ missingEvidenceId: true }),
    );
    expect(result.resolutionStatus).toBe("partial");
    expect(result.unresolvedEvidenceReferences).toContain("attempt-z");
  });

  it("is deterministic when matched interval order changes", () => {
    const first = reconcileReviewEvidence(fixtures());
    const second = reconcileReviewEvidence(fixtures({ reverseMatched: true }));
    expect(second.reconciliationHash).toBe(first.reconciliationHash);
    expect(second.mappedTokenBoundaryByCue.get(CUE_ID)).toEqual(
      first.mappedTokenBoundaryByCue.get(CUE_ID),
    );
  });

  it("permits numeric equality with Evidence-DP only with independent lineage", () => {
    const result = reconcileReviewEvidence(fixtures());
    const values = result.cueEvidence.get(CUE_ID) ?? [];
    const dp = values.find((value) => value.sourceType === "evidence-dp");
    const mapped = values.find(
      (value) => value.sourceType === "trusted-mapped-token",
    );
    expect(mapped?.interval).toEqual(dp?.interval);
    expect(mapped?.evidenceLineageId).not.toBe(dp?.evidenceLineageId);
    expect(mapped?.sourceArtifactType).toBe(
      "subtitle-overlap-acoustic-resolution",
    );
  });
});
