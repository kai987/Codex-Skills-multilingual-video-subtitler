import { describe, expect, it } from "vitest";

import {
  subtitleFinalizationReportSchema,
  type FinalizationFinding,
  type SubtitleCue,
} from "@mvl/shared";
import {
  buildSubtitlePresentationResolution,
  presentationResolutionHash,
} from "@mvl/transcription-core";
import { calculateC5FinalizationRates } from "@mvl/video-subtitler";

const HASH = "0".repeat(64);

function cue(
  id: string,
  text: string,
  start: number,
  end: number,
  token?: { start: number; end: number },
): SubtitleCue {
  return {
    id,
    text,
    start,
    end,
    language: "ja",
    languages: ["ja"],
    speaker: null,
    confidence: 1,
    ...(token === undefined
      ? {}
      : {
          timingEvidence: {
            sourceTrusted: false,
            speechStart: token.start,
            speechEnd: token.end,
            tokenTimestampsAvailable: true,
            tokenTimestampsUsed: true,
            tokens: [{ text, start: token.start, end: token.end }],
            alignmentSource: "token" as const,
            presentationTimingMethod: null,
          },
        }),
  };
}

function finding(cueIds: string[]): FinalizationFinding {
  return {
    findingId: `finding-${cueIds.join("-")}`,
    severity: "blocking",
    code: "TEST_BLOCKER",
    cueIds,
    message: "test blocker",
  };
}

function rates(input: {
  baseline: SubtitleCue[];
  final?: SubtitleCue[];
  findings?: FinalizationFinding[];
  human?: boolean;
}) {
  const finalCues = input.final ?? input.baseline;
  const presentation = buildSubtitlePresentationResolution({
    cues: input.baseline,
    baseCueHash: presentationResolutionHash(input.baseline),
    humanReviewedAuthority: input.human ?? false,
  });
  return calculateC5FinalizationRates({
    baselineCues: input.baseline,
    finalCues,
    findings: input.findings ?? [],
    decisions: [],
    presentation: presentation.artifact,
    humanReviewedBaseline: input.human ?? false,
  });
}

describe("C5.14 finalization metric semantics", () => {
  it("parses a strict C5.13R.3 report and supplies compatible defaults", () => {
    const parsed = subtitleFinalizationReportSchema.parse({
      schemaVersion: "1.0.0",
      reportType: "subtitle-finalization-report",
      finalizationVersion: "1.1.0",
      generatedAt: "2026-08-23T00:00:00.000Z",
      mode: "review-fallback",
      status: "needs-review",
      finalizationMethod: "none",
      baseSubtitlePackageHash: HASH,
      baseCueHash: HASH,
      inputEvidenceHash: HASH,
      outputCueHash: HASH,
      outputHash: HASH,
      humanReviewedBaseline: null,
      thresholds: {
        minimumAssociationScore: 0.82,
        minimumAssociationMargin: 0.12,
        minimumIndependentSupport: 2,
        minimumExistingCuePreservation: 0.85,
        minimumCandidateCoverage: 0.9,
        maximumContentOmission: 0.15,
        maximumContentAddition: 0.15,
        maximumNeighborCueIntrusion: 0.05,
        minimumLocalSpeechCoverage: 0.8,
      },
      decisions: [],
      findings: [],
      metrics: {
        machineCueCount: 192,
        automaticDecisionCount: 0,
        safeAutomaticMutationCount: 0,
        suggestionOnlyCount: 33,
        blockingFindingCount: 35,
        unresolvedCount: 35,
        reviewItemCount: 33,
        humanDecisionCount: 0,
        finalCueCount: 192,
        unsafeMutationCount: 0,
        multiDecisionConflictCount: 0,
        substringReplacementViolationCount: 0,
        broadWindowVisibleMutationCount: 0,
        ambiguousVisibleMutationCount: 0,
        localIntervalMissingVisibleMutationCount: 0,
        fullCueFragmentReplacementCount: 0,
        formatParityErrorCount: 0,
        automaticCueRate: 0.7552083333,
        manualReviewCueRate: 0.2447916667,
        blockingCueRate: 0.2447916667,
        characterCorrectionRate: 0,
        timingCorrectionRate: 0,
        terminologyCorrectionRate: 0,
        dialectCorrectionRate: 0,
        hallucinationRejectionCount: 0,
      },
      qualityGate: {
        passed: false,
        finalIntegrityPassed: false,
        serializationRoundTripPassed: true,
        formatSemanticParityPassed: true,
        rollbackApplied: false,
        sourceReadOnlyVerified: true,
        blockingCodes: [],
        warningCodes: [],
      },
      outputPaths: {
        srt: "old.srt",
        vtt: "old.vtt",
        ass: "old.ass",
        subtitlePackage: "subtitle-package.needs-review.json",
        reviewPackage: null,
        reviewPage: null,
        correctionFeedback: null,
        subtitledVideo: null,
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- verifies legacy report parsing
    expect(parsed.metrics.automaticCueRate).toBeCloseTo(0.7552083333);
    expect(parsed.metrics.autoResolvedCueRate).toBe(0);
    expect(parsed.outputPaths.presentationResolution).toBeNull();
  });

  it("makes deprecated automaticCueRate exactly equal autoResolvedCueRate", () => {
    const value = rates({
      baseline: [cue("a", "女の子やからって 乗らせてもらえませんでした", 1, 3)],
    });
    expect(value.automaticCueRate).toBe(value.autoResolvedCueRate);
  });

  it("does not count observe-only recommendations as auto resolutions", () => {
    const baseline = [
      cue("a", "女の子やからって 乗らせてもらえませんでした", 1, 3),
    ];
    const presentation = buildSubtitlePresentationResolution({
      cues: baseline,
      baseCueHash: presentationResolutionHash(baseline),
      presentationResolution: "observe",
    });
    const value = calculateC5FinalizationRates({
      baselineCues: baseline,
      finalCues: presentation.cues,
      findings: [],
      decisions: [],
      presentation: presentation.artifact,
      humanReviewedBaseline: false,
    });
    expect(value.presentationAutoResolvedCueRate).toBe(0);
    expect(value.autoResolvedCueRate).toBe(0);
  });

  it("computes non-blocking rate independently", () => {
    const value = rates({
      baseline: [cue("a", "一", 1, 2), cue("b", "二", 3, 4)],
      findings: [finding(["b"])],
    });
    expect(value.nonBlockingCueRate).toBe(0.5);
    expect(value.autoResolvedCueRate).toBe(0);
  });

  it("computes passive baseline acceptance independently", () => {
    const value = rates({
      baseline: [
        cue("a", "女の子やからって 乗らせてもらえませんでした", 1, 3),
        cue("b", "短い文", 4, 5),
      ],
    });
    expect(value.presentationAutoResolvedCueRate).toBe(0.5);
    expect(value.passiveBaselineAcceptanceRate).toBe(0.5);
    expect(value.autoMutationCueRate).toBe(0);
  });

  it("counts intentional repetition as resolution but not mutation", () => {
    const value = rates({
      baseline: [cue("a", "待てー!", 1, 2), cue("b", "待てー!", 3, 4)],
      human: true,
    });
    expect(value.intentionalRepetitionResolvedCueRate).toBe(1);
    expect(value.autoResolvedCueRate).toBe(1);
    expect(value.autoMutationCueRate).toBe(0);
  });

  it("counts trusted timing-only repair as canonical mutation", () => {
    const baseline = [
      cue("a", "前の台詞", 1, 1.9, { start: 1.05, end: 1.45 }),
      cue("b", "次の台詞", 1.4, 2.4, { start: 1.5, end: 2.3 }),
    ];
    const presentation = buildSubtitlePresentationResolution({
      cues: baseline,
      baseCueHash: presentationResolutionHash(baseline),
    });
    const value = calculateC5FinalizationRates({
      baselineCues: baseline,
      finalCues: presentation.cues,
      findings: [],
      decisions: [],
      presentation: presentation.artifact,
      humanReviewedBaseline: false,
    });
    expect(value.autoMutationCueRate).toBe(1);
    expect(value.autoResolvedCueRate).toBe(1);
  });

  it("reports a complete human baseline rate", () => {
    const value = rates({ baseline: [cue("a", "人の文", 1, 2)], human: true });
    expect(value.humanBaselineCueRate).toBe(1);
  });

  it("defines every rate as zero for a zero-cue denominator", () => {
    const value = rates({ baseline: [], human: true });
    expect(Object.values(value).every((item) => item === 0)).toBe(true);
  });

  it("keeps every reported rate inside the closed unit interval", () => {
    const value = rates({
      baseline: [cue("a", "待てー!", 1, 2), cue("b", "待てー!", 3, 4)],
      human: true,
    });
    expect(Object.values(value).every((item) => item >= 0 && item <= 1)).toBe(
      true,
    );
  });
});
