import {
  machineCandidateAssociationLedgerSchema,
  machineCanonicalAssemblySchema,
  machineCanonicalEventsSchema,
  machineCanonicalNonDegradationLedgerSchema,
  machineOverlapRootCauseSchema,
  machineStageQualityTraceSchema,
  machineSupportedTextRetentionSchema,
  machineTimelineTransformChainSchema,
  type SubtitleCue,
} from "@mvl/shared";
import {
  deduplicateTopScoreWinners,
  repairTopScoreFragments,
  resolveCompetingHypotheses,
} from "@mvl/transcription-core";
import {
  buildAcousticEventFamilies,
  buildGlobalTokenTimeline,
  runCandidateAssociationAssembly,
} from "@mvl/video-subtitler";
import { describe, expect, it } from "vitest";

import {
  baselineCue,
  noVadCue,
  requestContract,
  vadCue,
} from "./helpers/c6-0-1-2-fixtures.js";

const generatedAt = "2026-08-28T00:00:00.000Z";

function run(cues: readonly SubtitleCue[]) {
  const hypothesis = resolveCompetingHypotheses({
    cues,
    evidenceCues: cues,
    mode: "top-score",
  });
  const families = buildAcousticEventFamilies({
    cues,
    mode: "enforce",
    sourceMediaSha256: requestContract.requests[0]?.sourceMediaSha256 ?? null,
    generatedAt,
  }).artifact;
  const tokenTimeline = buildGlobalTokenTimeline({
    cues,
    requestContract,
    mode: "enforce",
    generatedAt,
  });
  return runCandidateAssociationAssembly({
    atoms: hypothesis.atomization.atoms,
    atomicClusters: hypothesis.atomicClusters,
    candidateEvidence: hypothesis.candidateEvidence,
    topScoreResolution: hypothesis.topScoreResolution,
    winnerCues: hypothesis.cues,
    acousticEventFamilies: families,
    globalTokenTimeline: tokenTimeline,
    requestTimelineContract: requestContract,
    candidateAssociation: "enforce",
    canonicalAssembly: "enforce",
    timelineTransformChain: "enforce",
    generatedAt,
  });
}

describe("C6.0.1.3 candidate association and canonical assembly", () => {
  it("accounts for every candidate and treats many-to-one clustering as grouping", () => {
    const result = run([baselineCue, noVadCue, vadCue]);

    expect(result.candidateAssociationLedger.summary.sourceCandidateCount).toBe(
      result.candidateAssociationLedger.records.length,
    );
    expect(
      result.candidateAssociationLedger.summary.unaccountedCandidateCount,
    ).toBe(0);
    expect(
      result.candidateAssociationLedger.summary.multiAssignedCandidateCount,
    ).toBe(0);
    expect(result.candidateAssociationLedger.summary.unknownReasonCount).toBe(
      0,
    );
    expect(
      result.candidateAssociationLedger.summary.groupedCandidateCount,
    ).toBe(
      result.candidateAssociationLedger.summary.sourceCandidateCount -
        result.candidateAssociationLedger.summary.atomicClusterCount,
    );
    expect(
      result.candidateAssociationLedger.records.every(
        (record) => record.assignedClusterId !== null,
      ),
    ).toBe(true);
  });

  it("assembles only a real candidate and never synthesizes joined text", () => {
    const shortCue: SubtitleCue = {
      ...baselineCue,
      id: "short-prefix",
      text: "まだ真っ暗",
      confidence: 0.72,
    };
    const longCue: SubtitleCue = {
      ...noVadCue,
      id: "supported-long",
      text: "まだ真っ暗やん。",
      confidence: 0.93,
      provenance: {
        ...noVadCue.provenance,
        independentSupportCount: 2,
      },
    };
    const result = run([shortCue, longCue]);
    const emittedTexts = new Set([shortCue.text, longCue.text]);

    expect(result.canonicalAssembly.summary.syntheticJoinCount).toBe(0);
    expect(
      result.canonicalAssembly.operations.map(
        (operation) => operation.syntheticTextJoin,
      ),
    ).not.toContain(true);
    expect(result.cues.every((cue) => emittedTexts.has(cue.text))).toBe(true);
    expect(
      result.supportedTextRetention.summary.unsupportedStrongTextDeletionCount,
    ).toBe(0);
    expect(
      result.canonicalNonDegradation.summary.runtimeNonDegradationPassed,
    ).toBe(true);
  });

  it("separates request-level mapping from cue association and quarantines VAD", () => {
    const associationPendingCue: SubtitleCue = {
      ...noVadCue,
      id: "association-pending-cue",
      start: 11.8,
      end: 12.1,
    };
    const result = run([associationPendingCue, vadCue]);
    const noVad = result.timelineTransformChain.chains.find(
      (chain) => chain.requestId === "recovery-no-vad",
    );
    const vad = result.timelineTransformChain.chains.find(
      (chain) => chain.requestId === "recovery-vad",
    );

    expect(noVad?.status).toBe("VERIFIED");
    expect(noVad?.requestMappedTokenCount).toBeGreaterThan(0);
    expect(noVad?.associationPendingTokenCount).toBeGreaterThan(0);
    expect(vad?.status).toBe("QUARANTINED");
    expect(vad?.failureReason).toBe("AMBIGUOUS_TIME_BASE");
    expect(
      result.timelineTransformChain.summary.unverifiedOffsetAppliedCount,
    ).toBe(0);
  });

  it("emits every strict runtime artifact with no runtime Gold input", () => {
    const result = run([baselineCue, noVadCue, vadCue]);
    const checks = [
      machineCandidateAssociationLedgerSchema.safeParse(
        result.candidateAssociationLedger,
      ),
      machineCanonicalEventsSchema.safeParse(result.canonicalEvents),
      machineCanonicalAssemblySchema.safeParse(result.canonicalAssembly),
      machineSupportedTextRetentionSchema.safeParse(
        result.supportedTextRetention,
      ),
      machineTimelineTransformChainSchema.safeParse(
        result.timelineTransformChain,
      ),
      machineCanonicalNonDegradationLedgerSchema.safeParse(
        result.canonicalNonDegradation,
      ),
      machineStageQualityTraceSchema.safeParse(result.stageQualityTrace),
      machineOverlapRootCauseSchema.safeParse(result.overlapRootCause),
    ];
    expect(checks.every((check) => check.success)).toBe(true);
    expect(result.stageQualityTrace.runtimeGoldInputCount).toBe(0);
    expect(JSON.stringify(result)).not.toMatch(/gold(?:en)?[ -_]?subtitle/iu);
  });

  it("preserves sequential repeated speech and blocks unsupported cross-event merges", () => {
    const repeatedLeft: SubtitleCue = {
      ...baselineCue,
      id: "repeated-left",
      start: 20,
      end: 21,
      text: "だんじりや!",
      provenance: {
        ...baselineCue.provenance,
        sourceRequestIds: ["request-left"],
      },
    };
    const repeatedRight: SubtitleCue = {
      ...repeatedLeft,
      id: "repeated-right",
      start: 21,
      end: 22,
      provenance: {
        ...baselineCue.provenance,
        sourceRequestIds: ["request-right"],
      },
    };
    expect(
      deduplicateTopScoreWinners(
        [repeatedLeft, repeatedRight],
        "pre-normalization",
        { requireTemporalOverlap: true },
      ).cues,
    ).toHaveLength(2);

    const fragmentLeft: SubtitleCue = {
      ...repeatedLeft,
      id: "fragment-left",
      text: "行くわけ",
    };
    const fragmentRight: SubtitleCue = {
      ...repeatedRight,
      id: "fragment-right",
      text: "ほら!行ってきます!",
    };
    expect(
      repairTopScoreFragments([fragmentLeft, fragmentRight], {
        eventFirst: true,
      }).cues,
    ).toHaveLength(2);
  });
});
