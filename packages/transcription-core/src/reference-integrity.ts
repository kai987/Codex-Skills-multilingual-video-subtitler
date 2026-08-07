import { createHash } from "node:crypto";

import {
  anchorTextCoverageArtifactSchema,
  anchorCoverageIntegrityArtifactSchema,
  referenceCoverageIntegrityArtifactSchema,
  type AnchorCoverageIntegrityArtifact,
  type AnchorTextCoverageArtifact,
  type DiscoveredSpeechAnchorsArtifact,
  type FinalTextIntegrityArtifact,
  type ReferenceCueAlignmentArtifact,
  type ReferenceCoverageIntegrityArtifact,
  type ReferenceTimelineArtifact,
  type SubtitleCue,
} from "@mvl/shared";

interface Interval {
  start: number;
  end: number;
}

function overlapSeconds(left: Interval, right: Interval): number {
  return Math.max(
    0,
    Math.min(left.end, right.end) - Math.max(left.start, right.start),
  );
}

function activeReviewFor(
  interval: Interval,
  activeReviewIntervals: readonly Interval[],
): boolean {
  return activeReviewIntervals.some(
    (review) => overlapSeconds(interval, review) > 0,
  );
}

const TEXT_VALIDITY_FINDING_CODES = new Set([
  "FINAL_COMPETING_HYPOTHESES",
  "FINAL_REFERENCE_SEMANTIC_CONFLICT",
  "FINAL_UNSUPPORTED_CONTENT_WORD",
  "FINAL_LYRICS_HALLUCINATION",
  "FINAL_LYRICS_INCOMPLETE_LINE",
  "FINAL_SINGLE_CHARACTER_FRAGMENT",
  "FINAL_INVALID_JAPANESE_FRAGMENT",
  "FINAL_INCOMPLETE_MORPHEME",
  "FINAL_INCOMPLETE_CLAUSE",
  "FINAL_TEXT_BOUNDARY_BREAK",
  "FINAL_NEAR_DUPLICATE_SEMANTIC_CUE",
]);

export function evaluateAnchorTextCoverage(input: {
  timeline: ReferenceTimelineArtifact;
  alignment: ReferenceCueAlignmentArtifact;
  generatedCues: readonly SubtitleCue[];
  generatedSubtitleSha256: string;
  finalTextIntegrity?: FinalTextIntegrityArtifact | undefined;
  activeReviewIntervals?: readonly Interval[] | undefined;
  minimumTemporalCoverageRatio?: number | undefined;
  generatedAt?: string | undefined;
}): AnchorTextCoverageArtifact {
  const minimumTemporalCoverageRatio =
    input.minimumTemporalCoverageRatio ?? 0.2;
  const activeReviewIntervals = input.activeReviewIntervals ?? [];
  const expected = input.timeline.anchors.filter(
    (anchor) =>
      anchor.timingTrusted && (anchor.expectedSpeech || anchor.expectedSinging),
  );
  const anchors: AnchorTextCoverageArtifact["anchors"] = expected.map(
    (anchor) => {
      const alignment = input.alignment.entries.find((entry) =>
        entry.referenceAnchorIds.includes(anchor.id),
      );
      const cueIds = alignment?.generatedCueIds ?? [];
      const cues = input.generatedCues.filter((cue) => cueIds.includes(cue.id));
      const temporalCoverage =
        alignment !== undefined &&
        cueIds.length > 0 &&
        (alignment.temporalIou >= minimumTemporalCoverageRatio ||
          cues.some((cue) => overlapSeconds(cue, anchor.interval) > 0));
      const generatedEvidenceIds = new Set(
        cues.flatMap((cue) => [
          cue.id,
          ...(cue.provenance?.sourceRequestIds ?? []),
        ]),
      );
      const trustedReferenceOriginalCoverage = cues.some(
        (cue) =>
          (cue.textSource === "reference-original-language" ||
            cue.provenance?.sourceLayer === "reference-original-language") &&
          (cue.provenance?.referenceAnchorIds.includes(anchor.id) ?? false),
      );
      const blockingFindings =
        input.finalTextIntegrity?.findings.filter((finding) => {
          if (!TEXT_VALIDITY_FINDING_CODES.has(finding.code)) return false;
          const provenanceLinked =
            finding.cueIds.some((cueId) => cueIds.includes(cueId)) ||
            finding.sourceCueIds.some((cueId) =>
              generatedEvidenceIds.has(cueId),
            ) ||
            finding.referenceAnchorIds.includes(anchor.id);
          if (provenanceLinked) return true;
          const intervalOnlyFinding =
            finding.cueIds.length === 0 &&
            finding.sourceCueIds.length === 0 &&
            finding.referenceAnchorIds.length === 0 &&
            overlapSeconds(finding.interval, anchor.interval) > 0;
          return intervalOnlyFinding && !trustedReferenceOriginalCoverage;
        }) ?? [];
      const hardFindings = blockingFindings.filter(
        (finding) => finding.severity === "hard",
      );
      const textValidity: AnchorTextCoverageArtifact["anchors"][number]["textValidity"] =
        blockingFindings.some(
          (finding) => finding.code === "FINAL_COMPETING_HYPOTHESES",
        )
          ? "competing"
          : blockingFindings.some((finding) =>
                [
                  "FINAL_REFERENCE_SEMANTIC_CONFLICT",
                  "FINAL_UNSUPPORTED_CONTENT_WORD",
                ].includes(finding.code),
              )
            ? "semantic-conflict"
            : blockingFindings.some(
                  (finding) => finding.code === "FINAL_LYRICS_HALLUCINATION",
                )
              ? "lyrics-hallucination"
              : blockingFindings.some((finding) =>
                    [
                      "FINAL_SINGLE_CHARACTER_FRAGMENT",
                      "FINAL_INVALID_JAPANESE_FRAGMENT",
                    ].includes(finding.code),
                  )
                ? "fragment"
                : blockingFindings.some((finding) =>
                      [
                        "FINAL_INCOMPLETE_MORPHEME",
                        "FINAL_INCOMPLETE_CLAUSE",
                        "FINAL_TEXT_BOUNDARY_BREAK",
                      ].includes(finding.code),
                    )
                  ? "incomplete"
                  : blockingFindings.length > 0
                    ? "unresolved"
                    : "valid";
      const validTextCoverage =
        temporalCoverage &&
        cues.some((cue) => cue.text.trim() !== "") &&
        hardFindings.length === 0 &&
        textValidity === "valid";
      const verifiedTextCoverage =
        validTextCoverage &&
        cues.some(
          (cue) =>
            (cue.provenance?.independentSupportCount ?? 0) >= 2 ||
            cue.textSource === "reference-original-language" ||
            ((cue.confidence ?? 0) >= 0.8 &&
              cue.timingEvidence?.tokenTimestampsUsed === true),
        );
      const activeReview =
        activeReviewFor(anchor.interval, activeReviewIntervals) ||
        blockingFindings.length > 0;
      const level = verifiedTextCoverage
        ? ("verified-text-covered" as const)
        : validTextCoverage
          ? ("valid-text-covered" as const)
          : activeReview
            ? ("active-review" as const)
            : temporalCoverage
              ? ("temporal-covered" as const)
              : ("uncovered" as const);
      return {
        anchorId: anchor.id,
        generatedCueIds: cueIds,
        level,
        temporalCoverage,
        validTextCoverage,
        verifiedTextCoverage,
        textValidity,
        supportingEvidence: [
          `temporal-coverage:${String(temporalCoverage)}`,
          `valid-text-coverage:${String(validTextCoverage)}`,
          `verified-text-coverage:${String(verifiedTextCoverage)}`,
          `blocking-text-findings:${String(blockingFindings.length)}`,
        ],
        blockingFindingIds: blockingFindings.map((finding) => finding.id),
        activeReview,
      };
    },
  );
  const recall = (
    kind: "dialogue" | "narration" | "lyrics-original",
    field: "temporalCoverage" | "validTextCoverage" | "verifiedTextCoverage",
  ): number | null => {
    const ids = expected
      .filter((anchor) => anchor.kind === kind)
      .map((anchor) => anchor.id);
    if (ids.length === 0) return null;
    return (
      anchors.filter((anchor) => ids.includes(anchor.anchorId) && anchor[field])
        .length / ids.length
    );
  };
  return anchorTextCoverageArtifactSchema.parse({
    schemaVersion: "1.0.0",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    inputHash: createHash("sha256")
      .update(
        JSON.stringify({
          timeline: input.timeline,
          cues: input.generatedCues,
          integrity: input.finalTextIntegrity ?? null,
        }),
      )
      .digest("hex"),
    referenceSha256: input.timeline.input.referenceSha256,
    generatedSubtitleSha256: input.generatedSubtitleSha256,
    configuration: {
      minimumTemporalCoverageRatio,
      verifiedRequiresIndependentEvidence: true,
    },
    anchors,
    summary: {
      expectedAnchors: anchors.length,
      temporalCovered: anchors.filter((anchor) => anchor.temporalCoverage)
        .length,
      validTextCovered: anchors.filter((anchor) => anchor.validTextCoverage)
        .length,
      verifiedTextCovered: anchors.filter(
        (anchor) => anchor.verifiedTextCoverage,
      ).length,
      activeReview: anchors.filter((anchor) => anchor.activeReview).length,
      uncovered: anchors.filter((anchor) => anchor.level === "uncovered")
        .length,
      dialogue: {
        temporalRecall: recall("dialogue", "temporalCoverage"),
        validTextRecall: recall("dialogue", "validTextCoverage"),
        verifiedTextRecall: recall("dialogue", "verifiedTextCoverage"),
      },
      narration: {
        temporalRecall: recall("narration", "temporalCoverage"),
        validTextRecall: recall("narration", "validTextCoverage"),
        verifiedTextRecall: recall("narration", "verifiedTextCoverage"),
      },
      lyrics: {
        temporalRecall: recall("lyrics-original", "temporalCoverage"),
        validTextRecall: recall("lyrics-original", "validTextCoverage"),
        verifiedTextRecall: recall("lyrics-original", "verifiedTextCoverage"),
      },
    },
    fallback:
      input.finalTextIntegrity === undefined
        ? "final-text-integrity-unavailable; temporal-and-cue-quality-evidence-only"
        : null,
  });
}

export function evaluateReferenceCoverageIntegrity(input: {
  timeline: ReferenceTimelineArtifact;
  alignment: ReferenceCueAlignmentArtifact;
  generatedCues: readonly SubtitleCue[];
  generatedSubtitleSha256: string;
  activeReviewIntervals?: readonly Interval[] | undefined;
  promoteUncoveredToActiveReview?: boolean | undefined;
  generatedAt?: string;
}): ReferenceCoverageIntegrityArtifact {
  const activeReviewIntervals = input.activeReviewIntervals ?? [];
  const expected = input.timeline.anchors.filter(
    (anchor) =>
      anchor.timingTrusted && (anchor.expectedSpeech || anchor.expectedSinging),
  );
  const findings: ReferenceCoverageIntegrityArtifact["findings"] = [];
  for (const anchor of expected) {
    const alignment = input.alignment.entries.find((entry) =>
      entry.referenceAnchorIds.includes(anchor.id),
    );
    const covered =
      alignment !== undefined && alignment.generatedCueIds.length > 0;
    if (!covered) {
      const promotedToActiveReview =
        input.promoteUncoveredToActiveReview === true;
      const code =
        anchor.kind === "dialogue"
          ? ("REFERENCE_DIALOGUE_UNCOVERED" as const)
          : anchor.kind === "narration"
            ? ("REFERENCE_NARRATION_UNCOVERED" as const)
            : ("REFERENCE_LYRICS_UNCOVERED" as const);
      findings.push({
        id: `reference-coverage-finding-${String(findings.length + 1).padStart(5, "0")}`,
        code,
        interval: anchor.interval,
        anchorIds: [anchor.id],
        cueIds: [],
        activeReview:
          promotedToActiveReview ||
          activeReviewFor(anchor.interval, activeReviewIntervals),
        evidence: [
          "trusted-reference-anchor-has-no-temporal-generated-cue",
          `reference-kind:${anchor.kind}`,
          ...(promotedToActiveReview
            ? ["reference-guided-uncovered-anchor-promoted-to-active-review"]
            : []),
        ],
      });
    }
  }
  for (const entry of input.alignment.entries.filter(
    (candidate) => candidate.mapping === "unmatched-generated",
  )) {
    const cues = input.generatedCues.filter((cue) =>
      entry.generatedCueIds.includes(cue.id),
    );
    findings.push({
      id: `reference-coverage-finding-${String(findings.length + 1).padStart(5, "0")}`,
      code: "REFERENCE_UNSUPPORTED_INSERTION",
      interval: entry.interval,
      anchorIds: [],
      cueIds: cues.map((cue) => cue.id),
      activeReview: activeReviewFor(entry.interval, activeReviewIntervals),
      evidence: [
        "generated-cue-has-no-reference-anchor",
        "reference-is-strong-evidence-not-absolute-ground-truth",
      ],
    });
  }
  for (const cue of input.timeline.anchors.filter(
    (anchor) =>
      anchor.sourceCueIds.length > 1 &&
      anchor.evidence.includes("consecutive-identical-effect-cues-merged"),
  )) {
    findings.push({
      id: `reference-coverage-finding-${String(findings.length + 1).padStart(5, "0")}`,
      code: "REFERENCE_DUPLICATE_EFFECT_CUES",
      interval: cue.interval,
      anchorIds: [cue.id],
      cueIds: [],
      activeReview: false,
      evidence: [
        "multiple-consecutive-identical-reference-cues-merged-to-outer-interval",
      ],
    });
  }
  const uncovered = findings.filter((finding) =>
    [
      "REFERENCE_DIALOGUE_UNCOVERED",
      "REFERENCE_NARRATION_UNCOVERED",
      "REFERENCE_LYRICS_UNCOVERED",
    ].includes(finding.code),
  );
  const unsafeUncovered = uncovered.filter(
    (finding) => !finding.activeReview,
  ).length;
  return referenceCoverageIntegrityArtifactSchema.parse({
    schemaVersion: "1.0.0",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    referenceSha256: input.timeline.input.referenceSha256,
    generatedSubtitleSha256: input.generatedSubtitleSha256,
    configuration: {
      coverageRule: "temporal-alignment",
      promoteUncoveredToActiveReview:
        input.promoteUncoveredToActiveReview === true,
    },
    validationStatus: unsafeUncovered === 0 ? "passed" : "needs-review",
    findings,
    summary: {
      trustedExpectedAnchors: expected.length,
      coveredAnchors: expected.length - uncovered.length,
      uncoveredWithActiveReview: uncovered.filter(
        (finding) => finding.activeReview,
      ).length,
      uncoveredWithoutReview: unsafeUncovered,
      unsupportedInsertions: findings.filter(
        (finding) => finding.code === "REFERENCE_UNSUPPORTED_INSERTION",
      ).length,
    },
    fallback: null,
  });
}

export function evaluateAnchorCoverageIntegrity(input: {
  anchors: DiscoveredSpeechAnchorsArtifact;
  finalCues: readonly SubtitleCue[];
  activeReviewIntervals?: readonly Interval[] | undefined;
  generatedAt?: string;
}): AnchorCoverageIntegrityArtifact {
  const activeReviewIntervals = input.activeReviewIntervals ?? [];
  const highConfidence = input.anchors.anchors.filter(
    (anchor) => anchor.confidence >= 0.75,
  );
  const findings: AnchorCoverageIntegrityArtifact["findings"] = [];
  for (const anchor of highConfidence) {
    const cueIds = input.finalCues.flatMap((cue) =>
      overlapSeconds(anchor.interval, cue) > 0 ? [cue.id] : [],
    );
    const coveredSeconds = input.finalCues.reduce(
      (sum, cue) => sum + overlapSeconds(anchor.interval, cue),
      0,
    );
    const coverageRatio = Math.min(
      1,
      coveredSeconds / (anchor.interval.end - anchor.interval.start),
    );
    if (cueIds.length === 0 || coverageRatio < 0.2) {
      findings.push({
        id: `anchor-coverage-finding-${String(findings.length + 1).padStart(5, "0")}`,
        code:
          anchor.expectedContent === "singing"
            ? "DISCOVERED_SINGING_ANCHOR_UNCOVERED"
            : cueIds.length === 0
              ? "DISCOVERED_SPEECH_ANCHOR_UNCOVERED"
              : "ANCHOR_FINAL_CUE_COVERAGE_INSUFFICIENT",
        interval: anchor.interval,
        anchorId: anchor.id,
        cueIds,
        coverageRatio,
        activeReview: activeReviewFor(anchor.interval, activeReviewIntervals),
        evidence: [
          `anchor-confidence:${anchor.confidence.toFixed(3)}`,
          `final-cue-coverage:${coverageRatio.toFixed(3)}`,
        ],
      });
    }
  }
  const uncoveredWithoutReview = findings.filter(
    (finding) => !finding.activeReview,
  ).length;
  return anchorCoverageIntegrityArtifactSchema.parse({
    schemaVersion: "1.0.0",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    sourceAudioSha256: input.anchors.sourceAudioSha256,
    configuration: {
      highConfidenceThreshold: 0.75,
      minimumCoverageRatio: 0.2,
    },
    validationStatus: uncoveredWithoutReview === 0 ? "passed" : "needs-review",
    findings,
    summary: {
      highConfidenceAnchors: highConfidence.length,
      coveredAnchors: highConfidence.length - findings.length,
      uncoveredWithActiveReview: findings.filter(
        (finding) => finding.activeReview,
      ).length,
      uncoveredWithoutReview,
    },
    fallback: null,
  });
}
