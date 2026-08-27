import type { SubtitleCue } from "@mvl/shared";
import {
  hasUnnaturalJapaneseInterwordSpacing,
  isJapaneseSubtitleText,
} from "@mvl/subtitle-core";

import {
  analyzeRepetitionWindow,
  detectCrossCueRepetitionWindows,
  detectRepeatedCueSequenceWindows,
  detectSingleCueDuplicateLines,
  normalizeForExactCueComparison,
  normalizeForRepetitionComparison,
  type RepetitionEvidence,
} from "./repetition.js";
import { detectIntraCueHypothesisRepetition } from "./intra-cue-repetition.js";
import type { AcousticSceneSegment, AsrRoutingPlanArtifact } from "./types.js";

interface Interval {
  start: number;
  end: number;
}

export type VocalRegionType =
  | "dialogue"
  | "singing"
  | "music-with-possible-vocals"
  | "instrumental"
  | "unknown";

export interface VocalRegion {
  id: string;
  interval: Interval;
  type: VocalRegionType;
  vocalEvidence: boolean;
  vocalEvidenceConfidence: number;
  reasons: string[];
  sourceRecoveryUnitIds?: string[] | undefined;
  sourceSceneIds?: string[] | undefined;
}

export type FinalSubtitleIntegrityCode =
  | "PRESENTATION_DUPLICATE_LINE"
  | "CROSS_CUE_EXACT_DUPLICATE"
  | "CROSS_CUE_SENTENCE_LOOP"
  | "CROSS_CUE_LONG_PHRASE_LOOP"
  | "MISSING_LYRICS"
  | "VOCAL_REGION_UNCOVERED"
  | "INVALID_SUBTITLE_TIMESTAMP"
  | "SUBTITLE_OUT_OF_ORDER"
  | "SUBTITLE_OVERLAP"
  | "UNSUPPORTED_LONG_CUE"
  | "SCENE_VOCAL_REGION_UNCOVERED"
  | "SCENE_DIALOGUE_REGION_UNCOVERED"
  | "SCENE_SINGING_REGION_UNCOVERED"
  | "SCENE_ROUTING_CONFLICT"
  | "SCENE_HIGH_CONFIDENCE_MISROUTE"
  | "FINAL_SINGLE_CHARACTER_FRAGMENT"
  | "FINAL_EXTREME_SHORT_DURATION"
  | "FINAL_INCOMPLETE_MORPHEME"
  | "FINAL_INCOMPLETE_CLAUSE"
  | "FINAL_TEXT_BOUNDARY_BREAK"
  | "FINAL_COMPETING_HYPOTHESES"
  | "FINAL_NEAR_DUPLICATE_SEMANTIC_CUE"
  | "FINAL_UNSUPPORTED_CONTENT_WORD"
  | "FINAL_INVALID_JAPANESE_FRAGMENT"
  | "FINAL_LYRICS_HALLUCINATION"
  | "FINAL_LYRICS_INCOMPLETE_LINE"
  | "FINAL_REFERENCE_SEMANTIC_CONFLICT"
  | "FINAL_VISUAL_LINE_WORD_BREAK"
  | "FINAL_INTRA_CUE_HYPOTHESIS_REPETITION"
  | "FINAL_UNNATURAL_JAPANESE_SPACING"
  | "FINAL_LINE_EXCEEDS_CHARACTER_LIMIT"
  | "FINAL_CUE_EXCEEDS_TWO_LINES"
  | "FINAL_UNRESOLVED_PRESENTATION_CAPACITY"
  | "SEGMENTATION_UNRESOLVED";

export interface FinalSubtitleIntegrityFinding {
  id: string;
  code: FinalSubtitleIntegrityCode;
  severity: "hard" | "warning";
  category:
    | "repetition"
    | "coverage"
    | "timing"
    | "fragment"
    | "text"
    | "hypothesis"
    | "lyrics"
    | "segmentation"
    | "semantic"
    | "presentation";
  interval: Interval;
  cueIds: string[];
  sourceCueIds?: string[] | undefined;
  sourceRequestIds?: string[] | undefined;
  referenceAnchorIds?: string[] | undefined;
  vocalRegionIds?: string[] | undefined;
  sceneIds?: string[] | undefined;
  repetitionEvidence?: RepetitionEvidence | undefined;
  reasons: string[];
}

export function evaluateSceneCoverageIntegrity(input: {
  scenes: readonly AcousticSceneSegment[];
  cues: readonly SubtitleCue[];
  activeReviewIntervals?: readonly {
    interval: Interval;
    category?: "missing-dialogue" | "missing-lyrics" | "other" | undefined;
  }[];
  routingPlan?: AsrRoutingPlanArtifact | undefined;
  vocalThreshold?: number | undefined;
}): FinalSubtitleIntegrityFinding[] {
  const findings: FinalSubtitleIntegrityFinding[] = [];
  const vocalThreshold = input.vocalThreshold ?? 0.65;
  const reviews = input.activeReviewIntervals ?? [];
  const coveredCues = (scene: AcousticSceneSegment): SubtitleCue[] =>
    input.cues.filter((cue) => overlapSeconds(cue, scene.interval) > 0);
  const activeReviews = (
    scene: AcousticSceneSegment,
    category?: "missing-dialogue" | "missing-lyrics",
  ) =>
    reviews.filter(
      (review) =>
        overlapSeconds(review.interval, scene.interval) > 0 &&
        (category === undefined || review.category === category),
    );
  const add = (
    scene: AcousticSceneSegment,
    code: FinalSubtitleIntegrityCode,
    reasons: string[],
    cues: readonly SubtitleCue[],
  ) => {
    findings.push({
      id: `scene-integrity-${String(findings.length + 1).padStart(5, "0")}`,
      code,
      severity: "hard",
      category: "coverage",
      interval: scene.interval,
      cueIds: cues.map((cue) => cue.id),
      sceneIds: [scene.id],
      reasons: [...reasons, `scene-id:${scene.id}`],
    });
  };
  for (const scene of input.scenes) {
    const cues = coveredCues(scene);
    const dialogueCues = cues.filter((cue) => cue.style !== "music");
    const musicCues = cues.filter((cue) => cue.style === "music");
    if (
      ["clean-dialogue", "quiet-dialogue", "noisy-dialogue"].includes(
        scene.label,
      ) &&
      dialogueCues.length === 0 &&
      activeReviews(scene).length === 0
    ) {
      add(
        scene,
        "SCENE_DIALOGUE_REGION_UNCOVERED",
        [
          "dialogue-scene-has-no-final-dialogue-cue",
          "dialogue-scene-has-no-active-review",
        ],
        dialogueCues,
      );
    }
    if (
      scene.label === "singing" &&
      musicCues.length === 0 &&
      activeReviews(scene, "missing-lyrics").length === 0
    ) {
      add(
        scene,
        "SCENE_SINGING_REGION_UNCOVERED",
        [
          "singing-scene-has-no-music-cue",
          "singing-scene-has-no-missing-lyrics-review",
        ],
        musicCues,
      );
    }
    if (
      scene.label === "unknown" &&
      scene.probabilities.vocal >= vocalThreshold &&
      cues.length === 0 &&
      activeReviews(scene).length === 0
    ) {
      add(
        scene,
        "SCENE_VOCAL_REGION_UNCOVERED",
        ["unknown-scene-has-high-vocal-evidence", "no-cue-or-active-review"],
        cues,
      );
    }
    if (
      scene.label === "non-speech" &&
      scene.confidence >= 0.97 &&
      scene.probabilities.vocal >= vocalThreshold
    ) {
      add(
        scene,
        "SCENE_HIGH_CONFIDENCE_MISROUTE",
        [
          "non-speech-label-conflicts-with-high-vocal-evidence",
          "non-speech-cannot-close-vocal-findings",
        ],
        cues,
      );
    }
    const route = input.routingPlan?.entries.find(
      (entry) => entry.sceneId === scene.id,
    );
    if (
      route !== undefined &&
      !route.observeOnly &&
      scene.confidence >= 0.75 &&
      ((scene.label === "noisy-dialogue" &&
        route.actualStrategy !== "vad-plus-no-vad") ||
        (scene.label === "singing" && route.actualStrategy !== "lyrics-no-vad"))
    ) {
      add(
        scene,
        "SCENE_ROUTING_CONFLICT",
        [`scene-label:${scene.label}`, `actual-route:${route.actualStrategy}`],
        cues,
      );
    }
    if (route?.actualStrategy === "skip-dialogue-asr") {
      add(
        scene,
        "SCENE_HIGH_CONFIDENCE_MISROUTE",
        ["selective-skip-is-disabled-in-scene-analysis-v1"],
        cues,
      );
    }
  }
  return findings;
}

export interface FinalSubtitleIntegrityMetrics {
  singleCueDuplicateLineCount: number;
  crossCueExactDuplicateCount: number;
  crossCueSentenceLoopCount: number;
  crossCueLongPhraseLoopCount: number;
  missingLyricsRegionCount: number;
  uncoveredVocalRegionCount: number;
  invalidTimestampCount: number;
  outOfOrderCount: number;
  overlapCount: number;
  unsupportedLongCueCount: number;
  intraCueHypothesisRepetitionCount: number;
  unnaturalJapaneseSpacingCount: number;
  lineExceedsCharacterLimitCount: number;
  cueExceedsTwoLinesCount: number;
  unresolvedPresentationCapacityCount: number;
  uniqueNormalizedCueRatio: number;
}

export interface VocalCoverageSummary {
  regionCount: number;
  highConfidenceRegionCount: number;
  totalVocalDurationSeconds: number;
  subtitleCoveredVocalDurationSeconds: number;
  explicitReviewVocalDurationSeconds: number;
  uncoveredVocalDurationSeconds: number;
  subtitleCoverageRatio: number;
}

export interface FinalSubtitleIntegrityArtifact {
  schemaVersion: "1.0.0";
  generatedAt: string;
  validationStatus: "passed" | "needs-review";
  candidateCueCount: number;
  finalCueCount: number;
  quarantinedCueIds: string[];
  candidateMetrics: FinalSubtitleIntegrityMetrics;
  metrics: FinalSubtitleIntegrityMetrics;
  findings: FinalSubtitleIntegrityFinding[];
  vocalRegions: (VocalRegion & {
    finalCueIds: string[];
    coverageRatio: number;
    missingLyrics: boolean;
  })[];
  vocalCoverage: VocalCoverageSummary;
  gateFailures: string[];
}

interface CanonicalHallucinationCandidate {
  id: string;
  start: number;
  end: number;
  text: string;
  qualityStatus?: "accepted" | "suspected-hallucination" | undefined;
  qualityReasons?: string[] | undefined;
  repetitionEvidence?: RepetitionEvidence | undefined;
}

function overlapSeconds(left: Interval, right: Interval): number {
  return Math.max(
    0,
    Math.min(left.end, right.end) - Math.max(left.start, right.start),
  );
}

function unionDuration(intervals: readonly Interval[]): number {
  const merged: Interval[] = [];
  for (const interval of intervals.toSorted(
    (left, right) => left.start - right.start || left.end - right.end,
  )) {
    const previous = merged.at(-1);
    if (previous !== undefined && interval.start <= previous.end) {
      previous.end = Math.max(previous.end, interval.end);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged.reduce(
    (total, interval) => total + interval.end - interval.start,
    0,
  );
}

function normalizedCueRatio(cues: readonly SubtitleCue[]): number {
  const normalized = cues
    .map((cue) => normalizeForRepetitionComparison(cue.text))
    .filter(Boolean);
  return normalized.length === 0
    ? 1
    : new Set(normalized).size / normalized.length;
}

export function buildCanonicalHallucinationIntegrityFindings(
  utterances: readonly CanonicalHallucinationCandidate[],
): FinalSubtitleIntegrityFinding[] {
  const suspects = utterances
    .filter(
      (utterance) => utterance.qualityStatus === "suspected-hallucination",
    )
    .toSorted(
      (left, right) => left.start - right.start || left.end - right.end,
    );
  const groups: CanonicalHallucinationCandidate[][] = [];
  for (const suspect of suspects) {
    const previousGroup = groups.at(-1);
    const previous = previousGroup?.at(-1);
    const previousCore =
      previous?.repetitionEvidence?.normalizedCorePhrase ?? "";
    const currentCore = suspect.repetitionEvidence?.normalizedCorePhrase ?? "";
    const relatedCore =
      previousCore !== "" &&
      currentCore !== "" &&
      (previousCore.includes(currentCore) ||
        currentCore.includes(previousCore));
    if (
      previousGroup !== undefined &&
      previous !== undefined &&
      suspect.start - previous.end <= 2 &&
      relatedCore
    ) {
      previousGroup.push(suspect);
    } else {
      groups.push([suspect]);
    }
  }
  return groups.map((group, index) => {
    const normalized = group.map((item) =>
      normalizeForExactCueComparison(item.text),
    );
    const exactSentenceLoop =
      group.length >= 3 && new Set(normalized).size === 1;
    const detectedRepetitionEvidence =
      group
        .map((item) => item.repetitionEvidence)
        .find((evidence) => evidence !== undefined) ??
      analyzeRepetitionWindow(group);
    // A single utterance can be rejected by its own long-phrase loop detector
    // without providing cross-utterance repetition evidence. Do not fabricate
    // a one-occurrence RepetitionEvidence record: that contract represents at
    // least two independently observed occurrences.
    const repetitionEvidence =
      detectedRepetitionEvidence !== null &&
      detectedRepetitionEvidence.occurrences >= 2
        ? detectedRepetitionEvidence
        : undefined;
    return {
      id: `canonical-integrity-${String(index + 1).padStart(5, "0")}`,
      code: exactSentenceLoop
        ? ("CROSS_CUE_SENTENCE_LOOP" as const)
        : ("CROSS_CUE_LONG_PHRASE_LOOP" as const),
      severity: "hard" as const,
      category: "repetition" as const,
      interval: {
        start: group[0]?.start ?? 0,
        end: group.at(-1)?.end ?? group[0]?.end ?? 0.001,
      },
      cueIds: group.map((item) => item.id),
      ...(repetitionEvidence === undefined ? {} : { repetitionEvidence }),
      reasons: [
        "canonical-utterance-qa-rejected-final-projection",
        "suspected-hallucination",
        "requires-audio-review",
        ...new Set(group.flatMap((item) => item.qualityReasons ?? [])),
      ],
    };
  });
}

export function evaluateLyricsRepetition(input: {
  cues: readonly SubtitleCue[];
  vocalEvidenceConfidence: number;
  independentWindowSupportCount: number;
}): {
  supportedChorus: boolean;
  hallucinationRisk: boolean;
  reasons: string[];
} {
  const repetitions = detectCrossCueRepetitionWindows({
    cues: input.cues,
    minimumCoreLength: 8,
    minimumOccurrences: 3,
    maximumWindowCues: 6,
    maximumWindowSeconds: 45,
  });
  if (repetitions.length === 0) {
    return {
      supportedChorus: false,
      hallucinationRisk: false,
      reasons: ["no-repeated-lyric-phrase"],
    };
  }
  const starts = input.cues.map((cue) => cue.start);
  const gaps = starts
    .slice(1)
    .map((start, index) => start - (starts[index] ?? start))
    .filter((gap) => gap > 0);
  const average =
    gaps.length === 0
      ? 0
      : gaps.reduce((total, gap) => total + gap, 0) / gaps.length;
  const maximumDeviation =
    gaps.length === 0
      ? Number.POSITIVE_INFINITY
      : Math.max(...gaps.map((gap) => Math.abs(gap - average)));
  const stablePhraseSpacing =
    gaps.length >= 2 && average > 0 && maximumDeviation / average <= 0.35;
  const supportedChorus =
    input.vocalEvidenceConfidence >= 0.7 &&
    input.independentWindowSupportCount >= 2 &&
    stablePhraseSpacing;
  return {
    supportedChorus,
    hallucinationRisk: !supportedChorus,
    reasons: supportedChorus
      ? [
          "stable-musical-phrase-spacing",
          "multiple-independent-window-support",
          "vocal-evidence-present",
        ]
      : [
          ...(input.vocalEvidenceConfidence < 0.7
            ? ["insufficient-vocal-evidence"]
            : []),
          ...(input.independentWindowSupportCount < 2
            ? ["single-decoding-support"]
            : []),
          ...(stablePhraseSpacing ? [] : ["unstable-repetition-spacing"]),
        ],
  };
}

export function evaluateSubtitleCoverageIntegrity(input: {
  cues: readonly SubtitleCue[];
  vocalRegions: readonly VocalRegion[];
}): {
  regions: FinalSubtitleIntegrityArtifact["vocalRegions"];
  findings: FinalSubtitleIntegrityFinding[];
  summary: VocalCoverageSummary;
} {
  const regions = input.vocalRegions.map((region) => {
    const musicCues = input.cues.filter(
      (cue) =>
        cue.style === "music" && overlapSeconds(cue, region.interval) > 0,
    );
    const covered = unionDuration(
      musicCues.map((cue) => ({
        start: Math.max(region.interval.start, cue.start),
        end: Math.min(region.interval.end, cue.end),
      })),
    );
    const duration = Math.max(
      0.001,
      region.interval.end - region.interval.start,
    );
    const coverageRatio = Math.min(1, covered / duration);
    const missingLyrics =
      region.vocalEvidence &&
      region.vocalEvidenceConfidence >= 0.7 &&
      ["singing", "music-with-possible-vocals"].includes(region.type) &&
      coverageRatio < 0.4;
    return {
      ...region,
      finalCueIds: musicCues.map((cue) => cue.id),
      coverageRatio,
      missingLyrics,
    };
  });
  const findings = regions.flatMap((region, index) => {
    if (!region.missingLyrics) return [];
    return [
      {
        id: `integrity-coverage-${String(index + 1).padStart(4, "0")}`,
        code: "MISSING_LYRICS" as const,
        severity: "hard" as const,
        category: "coverage" as const,
        interval: region.interval,
        cueIds: region.finalCueIds,
        vocalRegionIds: [region.id],
        reasons: [
          "high-confidence-vocal-region",
          "insufficient-music-cue-coverage",
          "explicit-lyrics-review-required",
        ],
      },
    ];
  });
  const highConfidence = regions.filter(
    (region) => region.vocalEvidence && region.vocalEvidenceConfidence >= 0.7,
  );
  const totalVocalDurationSeconds = unionDuration(
    highConfidence.map((region) => region.interval),
  );
  const subtitleCoveredVocalDurationSeconds = unionDuration(
    highConfidence.flatMap((region) =>
      input.cues
        .filter(
          (cue) =>
            cue.style === "music" && overlapSeconds(cue, region.interval) > 0,
        )
        .map((cue) => ({
          start: Math.max(cue.start, region.interval.start),
          end: Math.min(cue.end, region.interval.end),
        })),
    ),
  );
  const explicitReviewVocalDurationSeconds = unionDuration(
    regions
      .filter((region) => region.missingLyrics)
      .map((region) => region.interval),
  );
  return {
    regions,
    findings,
    summary: {
      regionCount: regions.length,
      highConfidenceRegionCount: highConfidence.length,
      totalVocalDurationSeconds,
      subtitleCoveredVocalDurationSeconds,
      explicitReviewVocalDurationSeconds,
      uncoveredVocalDurationSeconds: Math.max(
        0,
        totalVocalDurationSeconds -
          unionDuration([
            ...highConfidence.flatMap((region) =>
              input.cues
                .filter(
                  (cue) =>
                    cue.style === "music" &&
                    overlapSeconds(cue, region.interval) > 0,
                )
                .map((cue) => ({
                  start: Math.max(cue.start, region.interval.start),
                  end: Math.min(cue.end, region.interval.end),
                })),
            ),
            ...regions
              .filter((region) => region.missingLyrics)
              .map((region) => region.interval),
          ]),
      ),
      subtitleCoverageRatio:
        totalVocalDurationSeconds === 0
          ? 1
          : subtitleCoveredVocalDurationSeconds / totalVocalDurationSeconds,
    },
  };
}

export function evaluateFinalSubtitleIntegrity(input: {
  cues: readonly SubtitleCue[];
  vocalRegions?: readonly VocalRegion[] | undefined;
  supportedLyricsCueIds?: readonly string[] | undefined;
  supportedLongCueIds?: readonly string[] | undefined;
  strictPresentationConstraints?: boolean | undefined;
}): {
  metrics: FinalSubtitleIntegrityMetrics;
  findings: FinalSubtitleIntegrityFinding[];
  vocalRegions: FinalSubtitleIntegrityArtifact["vocalRegions"];
  vocalCoverage: VocalCoverageSummary;
} {
  const supportedLyrics = new Set(input.supportedLyricsCueIds ?? []);
  const supportedLongCues = new Set(input.supportedLongCueIds ?? []);
  const findings: FinalSubtitleIntegrityFinding[] = [];
  let findingIndex = 0;
  const add = (
    finding: Omit<FinalSubtitleIntegrityFinding, "id">,
  ): FinalSubtitleIntegrityFinding => {
    findingIndex += 1;
    const completed = {
      id: `integrity-finding-${String(findingIndex).padStart(5, "0")}`,
      ...finding,
    };
    findings.push(completed);
    return completed;
  };
  for (const cue of input.cues) {
    const duplicate = detectSingleCueDuplicateLines(cue);
    if (
      duplicate !== null &&
      !(cue.style === "music" && supportedLyrics.has(cue.id))
    ) {
      add({
        code: "PRESENTATION_DUPLICATE_LINE",
        severity: "hard",
        category: "repetition",
        interval: { start: cue.start, end: cue.end },
        cueIds: [cue.id],
        repetitionEvidence: duplicate,
        reasons: ["two-normalized-display-lines-are-identical"],
      });
    }
    const intraCue = detectIntraCueHypothesisRepetition({ cue });
    if (
      intraCue !== null &&
      intraCue.relationship !== "true-spoken-repetition" &&
      !(cue.style === "music" && supportedLyrics.has(cue.id))
    ) {
      add({
        code: "FINAL_INTRA_CUE_HYPOTHESIS_REPETITION",
        severity: "hard",
        category: "repetition",
        interval: { start: cue.start, end: cue.end },
        cueIds: [cue.id],
        reasons: [
          `relationship:${intraCue.relationship}`,
          ...intraCue.audioRepetitionEvidence,
        ],
      });
    }
    if (
      (cue.language === "ja" || isJapaneseSubtitleText(cue.text)) &&
      hasUnnaturalJapaneseInterwordSpacing(cue.text)
    ) {
      add({
        code: "FINAL_UNNATURAL_JAPANESE_SPACING",
        severity:
          input.strictPresentationConstraints === true ? "hard" : "warning",
        category: "presentation",
        interval: { start: cue.start, end: cue.end },
        cueIds: [cue.id],
        reasons: ["japanese-character-space-japanese-character"],
      });
    }
    const lines = cue.text.split("\n");
    if (lines.length > 2) {
      add({
        code: "FINAL_CUE_EXCEEDS_TWO_LINES",
        severity:
          input.strictPresentationConstraints === true ? "hard" : "warning",
        category: "presentation",
        interval: { start: cue.start, end: cue.end },
        cueIds: [cue.id],
        reasons: [`line-count:${String(lines.length)}`],
      });
    }
    const tooLongLines = lines.filter(
      (line) =>
        Array.from(
          line.replace(/\{\\[^}]*\}/gu, "").replace(/<\/?[^>]+>/gu, ""),
        ).length > 16,
    );
    if (tooLongLines.length > 0) {
      add({
        code: "FINAL_LINE_EXCEEDS_CHARACTER_LIMIT",
        severity:
          input.strictPresentationConstraints === true ? "hard" : "warning",
        category: "presentation",
        interval: { start: cue.start, end: cue.end },
        cueIds: [cue.id],
        reasons: [
          `longest-line:${String(Math.max(...tooLongLines.map((line) => Array.from(line).length)))}`,
          "maximum-characters-per-line:16",
        ],
      });
      add({
        code: "FINAL_UNRESOLVED_PRESENTATION_CAPACITY",
        severity:
          input.strictPresentationConstraints === true ? "hard" : "warning",
        category: "presentation",
        interval: { start: cue.start, end: cue.end },
        cueIds: [cue.id],
        reasons: ["strict-layout-capacity-remains-unresolved"],
      });
    }
  }
  const sorted = [...input.cues].toSorted(
    (left, right) => left.start - right.start || left.end - right.end,
  );
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (previous === undefined || current === undefined) continue;
    const previousText = normalizeForExactCueComparison(previous.text);
    const currentText = normalizeForExactCueComparison(current.text);
    const lyricsExempt =
      previous.style === "music" &&
      current.style === "music" &&
      supportedLyrics.has(previous.id) &&
      supportedLyrics.has(current.id);
    if (
      !lyricsExempt &&
      previousText.length >= 4 &&
      previousText === currentText &&
      current.start - previous.end <= 2
    ) {
      add({
        code: "CROSS_CUE_EXACT_DUPLICATE",
        severity: "hard",
        category: "repetition",
        interval: { start: previous.start, end: current.end },
        cueIds: [previous.id, current.id],
        repetitionEvidence: {
          normalizedCorePhrase: previousText,
          occurrences: 2,
          contributingSegmentIds: [previous.id, current.id],
          suffixVariants: [""],
          repeatedCharacterRatio: 1,
        },
        reasons: ["adjacent-normalized-cues-are-identical"],
      });
    }
  }
  const dialogueCandidates = sorted.filter(
    (cue) => !(cue.style === "music" && supportedLyrics.has(cue.id)),
  );
  const repeatedSequenceLoops = detectRepeatedCueSequenceWindows({
    cues: dialogueCandidates,
    minimumCoreLength: 8,
    minimumContainment: 0.65,
    maximumWindowCues: 6,
    maximumWindowSeconds: 20,
  });
  const repeatedPhraseLoops = detectCrossCueRepetitionWindows({
    cues: dialogueCandidates,
    minimumCoreLength: 8,
    minimumOccurrences: 3,
    maximumWindowCues: 6,
    maximumWindowSeconds: 20,
  });
  for (const loop of repeatedPhraseLoops) {
    const allExactlyEqual =
      new Set(
        loop.cueIds.map((id) =>
          normalizeForExactCueComparison(
            sorted.find((cue) => cue.id === id)?.text ?? "",
          ),
        ),
      ).size === 1;
    add({
      code: allExactlyEqual
        ? "CROSS_CUE_SENTENCE_LOOP"
        : "CROSS_CUE_LONG_PHRASE_LOOP",
      severity: "hard",
      category: "repetition",
      interval: loop.interval,
      cueIds: loop.cueIds,
      repetitionEvidence: loop.evidence,
      reasons: [
        "two-to-six-cue-sliding-window",
        "core-phrase-at-least-eight-characters",
        "three-or-more-short-window-occurrences",
      ],
    });
  }
  for (const loop of repeatedSequenceLoops) {
    const coveredByThreeOccurrenceLoop = repeatedPhraseLoops.some(
      (phraseLoop) =>
        phraseLoop.interval.start <= loop.interval.start &&
        phraseLoop.interval.end >= loop.interval.end &&
        (phraseLoop.evidence.normalizedCorePhrase.includes(
          loop.evidence.normalizedCorePhrase,
        ) ||
          loop.evidence.normalizedCorePhrase.includes(
            phraseLoop.evidence.normalizedCorePhrase,
          )),
    );
    if (coveredByThreeOccurrenceLoop) continue;
    add({
      code: loop.exactSequence
        ? "CROSS_CUE_SENTENCE_LOOP"
        : "CROSS_CUE_LONG_PHRASE_LOOP",
      severity: "hard",
      category: "repetition",
      interval: loop.interval,
      cueIds: loop.cueIds,
      repetitionEvidence: loop.evidence,
      reasons: [
        "two-to-six-cue-sliding-window",
        "repeated-contiguous-cue-sequence",
        `duplicate-block-size-${String(loop.duplicateCueIds.length)}`,
        "core-phrase-at-least-eight-characters",
        "both-sequence-blocks-cover-at-least-sixty-five-percent",
      ],
    });
  }
  for (let index = 0; index < input.cues.length; index += 1) {
    const cue = input.cues[index];
    const previous = input.cues[index - 1];
    if (cue === undefined) continue;
    if (
      !Number.isFinite(cue.start) ||
      !Number.isFinite(cue.end) ||
      cue.start < 0 ||
      cue.end <= cue.start
    ) {
      add({
        code: "INVALID_SUBTITLE_TIMESTAMP",
        severity: "hard",
        category: "timing",
        interval: {
          start: Number.isFinite(cue.start) ? Math.max(0, cue.start) : 0,
          end:
            Number.isFinite(cue.end) && cue.end > cue.start
              ? cue.end
              : Math.max(0.001, cue.start + 0.001),
        },
        cueIds: [cue.id],
        reasons: ["non-finite-negative-or-empty-timestamp"],
      });
    }
    if (previous !== undefined && cue.start < previous.start) {
      add({
        code: "SUBTITLE_OUT_OF_ORDER",
        severity: "hard",
        category: "timing",
        interval: {
          start: Math.max(0, Math.min(previous.start, cue.start)),
          end: Math.max(previous.end, cue.end),
        },
        cueIds: [previous.id, cue.id],
        reasons: ["cue-order-does-not-match-start-time"],
      });
    }
    if (previous !== undefined && previous.end > cue.start + 0.001) {
      add({
        code: "SUBTITLE_OVERLAP",
        severity: "hard",
        category: "timing",
        interval: {
          start: Math.max(0, cue.start),
          end: Math.min(previous.end, cue.end),
        },
        cueIds: [previous.id, cue.id],
        reasons: ["adjacent-final-cues-overlap"],
      });
    }
    if (
      (cue.style === undefined || cue.style === "default") &&
      cue.end - cue.start > 12 &&
      !supportedLongCues.has(cue.id) &&
      !(
        cue.id.endsWith("-semantic-merge") &&
        (cue.provenance?.sourceRequestIds.length ?? 0) >= 2 &&
        cue.end - cue.start <= 15 &&
        Array.from(cue.text.replace(/\s/gu, "")).length <= 32
      )
    ) {
      add({
        code: "UNSUPPORTED_LONG_CUE",
        severity: "hard",
        category: "timing",
        interval: { start: cue.start, end: cue.end },
        cueIds: [cue.id],
        reasons: ["ordinary-dialogue-cue-exceeds-twelve-seconds"],
      });
    }
  }
  const coverage = evaluateSubtitleCoverageIntegrity({
    cues: input.cues,
    vocalRegions: input.vocalRegions ?? [],
  });
  for (const finding of coverage.findings) {
    const { id: _id, ...withoutId } = finding;
    void _id;
    add({
      ...withoutId,
    });
  }
  const count = (code: FinalSubtitleIntegrityCode): number =>
    findings.filter((finding) => finding.code === code).length;
  return {
    metrics: {
      singleCueDuplicateLineCount: count("PRESENTATION_DUPLICATE_LINE"),
      crossCueExactDuplicateCount: count("CROSS_CUE_EXACT_DUPLICATE"),
      crossCueSentenceLoopCount: count("CROSS_CUE_SENTENCE_LOOP"),
      crossCueLongPhraseLoopCount: count("CROSS_CUE_LONG_PHRASE_LOOP"),
      missingLyricsRegionCount: count("MISSING_LYRICS"),
      uncoveredVocalRegionCount: count("VOCAL_REGION_UNCOVERED"),
      invalidTimestampCount: count("INVALID_SUBTITLE_TIMESTAMP"),
      outOfOrderCount: count("SUBTITLE_OUT_OF_ORDER"),
      overlapCount: count("SUBTITLE_OVERLAP"),
      unsupportedLongCueCount: count("UNSUPPORTED_LONG_CUE"),
      intraCueHypothesisRepetitionCount: count(
        "FINAL_INTRA_CUE_HYPOTHESIS_REPETITION",
      ),
      unnaturalJapaneseSpacingCount: count("FINAL_UNNATURAL_JAPANESE_SPACING"),
      lineExceedsCharacterLimitCount: count(
        "FINAL_LINE_EXCEEDS_CHARACTER_LIMIT",
      ),
      cueExceedsTwoLinesCount: count("FINAL_CUE_EXCEEDS_TWO_LINES"),
      unresolvedPresentationCapacityCount: count(
        "FINAL_UNRESOLVED_PRESENTATION_CAPACITY",
      ),
      uniqueNormalizedCueRatio: normalizedCueRatio(input.cues),
    },
    findings,
    vocalRegions: coverage.regions,
    vocalCoverage: coverage.summary,
  };
}

export function runFinalSubtitleIntegrityGate(input: {
  cues: readonly SubtitleCue[];
  vocalRegions?: readonly VocalRegion[] | undefined;
  supportedLyricsCueIds?: readonly string[] | undefined;
  supportedLongCueIds?: readonly string[] | undefined;
  generatedAt?: string | undefined;
  strictPresentationConstraints?: boolean | undefined;
  reviewOnlyRetentionCodes?: readonly FinalSubtitleIntegrityCode[] | undefined;
}): { cues: SubtitleCue[]; artifact: FinalSubtitleIntegrityArtifact } {
  const candidate = evaluateFinalSubtitleIntegrity(input);
  const reviewOnlyRetentionCodes = new Set(
    input.reviewOnlyRetentionCodes ?? [],
  );
  const quarantineCodes = new Set<FinalSubtitleIntegrityCode>([
    "PRESENTATION_DUPLICATE_LINE",
    "CROSS_CUE_EXACT_DUPLICATE",
    "CROSS_CUE_SENTENCE_LOOP",
    "CROSS_CUE_LONG_PHRASE_LOOP",
    "INVALID_SUBTITLE_TIMESTAMP",
    "SUBTITLE_OUT_OF_ORDER",
    "SUBTITLE_OVERLAP",
    "UNSUPPORTED_LONG_CUE",
    "FINAL_INTRA_CUE_HYPOTHESIS_REPETITION",
    "FINAL_UNNATURAL_JAPANESE_SPACING",
    "FINAL_LINE_EXCEEDS_CHARACTER_LIMIT",
    "FINAL_CUE_EXCEEDS_TWO_LINES",
    "FINAL_UNRESOLVED_PRESENTATION_CAPACITY",
  ]);
  const cueOrder = new Map(
    input.cues.map((cue, index) => [cue.id, index] as const),
  );
  const chooseQuarantinedCueIds = (
    finding: FinalSubtitleIntegrityFinding,
  ): string[] => {
    if (
      finding.code === "CROSS_CUE_EXACT_DUPLICATE" ||
      finding.code === "SUBTITLE_OVERLAP" ||
      finding.code === "SUBTITLE_OUT_OF_ORDER"
    ) {
      return finding.cueIds
        .toSorted(
          (left, right) =>
            (cueOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
            (cueOrder.get(right) ?? Number.MAX_SAFE_INTEGER),
        )
        .slice(1);
    }
    if (
      finding.code === "CROSS_CUE_SENTENCE_LOOP" ||
      finding.code === "CROSS_CUE_LONG_PHRASE_LOOP"
    ) {
      const duplicateBlockReason = finding.reasons.find((reason) =>
        reason.startsWith("duplicate-block-size-"),
      );
      const duplicateBlockSize =
        duplicateBlockReason === undefined
          ? null
          : Number.parseInt(
              duplicateBlockReason.slice("duplicate-block-size-".length),
              10,
            );
      const ordered = finding.cueIds.toSorted(
        (left, right) =>
          (cueOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
          (cueOrder.get(right) ?? Number.MAX_SAFE_INTEGER),
      );
      if (
        duplicateBlockSize !== null &&
        Number.isInteger(duplicateBlockSize) &&
        duplicateBlockSize > 0 &&
        duplicateBlockSize < ordered.length
      ) {
        return ordered.slice(-duplicateBlockSize);
      }
      return ordered.slice(1);
    }
    return finding.cueIds;
  };
  const quarantinedCueIds = [
    ...new Set(
      candidate.findings
        .filter(
          (finding) =>
            finding.severity === "hard" &&
            quarantineCodes.has(finding.code) &&
            !reviewOnlyRetentionCodes.has(finding.code),
        )
        .flatMap(chooseQuarantinedCueIds),
    ),
  ];
  const quarantined = new Set(quarantinedCueIds);
  const cues = input.cues.filter((cue) => !quarantined.has(cue.id));
  const final = evaluateFinalSubtitleIntegrity({
    cues,
    vocalRegions: input.vocalRegions,
    supportedLyricsCueIds: input.supportedLyricsCueIds,
    supportedLongCueIds: input.supportedLongCueIds,
    strictPresentationConstraints: input.strictPresentationConstraints,
  });
  const retainedCandidateFindings = candidate.findings.filter(
    (finding) =>
      quarantineCodes.has(finding.code) ||
      !final.findings.some(
        (current) =>
          current.code === finding.code &&
          overlapSeconds(current.interval, finding.interval) > 0,
      ),
  );
  const findings = [
    ...retainedCandidateFindings,
    ...final.findings.filter(
      (finding) =>
        !retainedCandidateFindings.some(
          (candidateFinding) =>
            candidateFinding.code === finding.code &&
            overlapSeconds(candidateFinding.interval, finding.interval) > 0,
        ),
    ),
  ].map((finding, index) => ({
    ...finding,
    id: `integrity-finding-${String(index + 1).padStart(5, "0")}`,
  }));
  const gateFailures = [...new Set(findings.map((finding) => finding.code))];
  return {
    cues,
    artifact: {
      schemaVersion: "1.0.0",
      generatedAt: input.generatedAt ?? new Date().toISOString(),
      validationStatus: gateFailures.length === 0 ? "passed" : "needs-review",
      candidateCueCount: input.cues.length,
      finalCueCount: cues.length,
      quarantinedCueIds,
      candidateMetrics: candidate.metrics,
      metrics: final.metrics,
      findings,
      vocalRegions: final.vocalRegions,
      vocalCoverage: final.vocalCoverage,
      gateFailures,
    },
  };
}
