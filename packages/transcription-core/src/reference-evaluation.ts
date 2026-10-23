import {
  falseQuarantineReportArtifactSchema,
  referenceSemanticValidationArtifactSchema,
  subtitleEvaluationArtifactSchema,
  type FalseQuarantineReportArtifact,
  type ReferenceCueAlignmentArtifact,
  type ReferenceSemanticValidationMode,
  type ReferenceSubtitleAnalysisArtifact,
  type ReferenceTimelineArtifact,
  type SubtitleCue,
  type SubtitleEvaluationArtifact,
  type TranscriptionGuidanceMode,
} from "@mvl/shared";

interface Interval {
  start: number;
  end: number;
}

function duration(interval: Interval): number {
  return Math.max(0, interval.end - interval.start);
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? null);
}

export function validateReferenceTimingAgainstAlignment(input: {
  analysis: ReferenceSubtitleAnalysisArtifact;
  alignment: ReferenceCueAlignmentArtifact;
  generatedAt?: string;
}): ReferenceSubtitleAnalysisArtifact {
  const matched = input.alignment.entries
    .filter(
      (entry) =>
        entry.referenceAnchorIds.length > 0 &&
        entry.generatedCueIds.length > 0 &&
        entry.startErrorSeconds !== null,
    )
    .toSorted(
      (left, right) =>
        left.interval.start - right.interval.start ||
        left.interval.end - right.interval.end,
    );
  if (matched.length < 3) return input.analysis;
  const startOffsets = matched.flatMap((entry) =>
    entry.startErrorSeconds === null ? [] : [entry.startErrorSeconds],
  );
  const globalOffsetSeconds = median(startOffsets);
  const sampleSize = Math.max(1, Math.floor(matched.length / 3));
  const earlyOffset = median(
    matched
      .slice(0, sampleSize)
      .flatMap((entry) =>
        entry.startErrorSeconds === null ? [] : [entry.startErrorSeconds],
      ),
  );
  const lateOffset = median(
    matched
      .slice(-sampleSize)
      .flatMap((entry) =>
        entry.startErrorSeconds === null ? [] : [entry.startErrorSeconds],
      ),
  );
  const driftSeconds =
    earlyOffset === null || lateOffset === null
      ? null
      : lateOffset - earlyOffset;
  const evidenceSuggestsSuspectTiming =
    Math.abs(globalOffsetSeconds ?? 0) > 0.5 || Math.abs(driftSeconds ?? 0) > 1;
  return {
    ...input.analysis,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    timingValidation: {
      ...input.analysis.timingValidation,
      status: evidenceSuggestsSuspectTiming
        ? "suspect"
        : input.analysis.configuration.timingMode === "trusted"
          ? "trusted"
          : "verified",
      globalOffsetSeconds,
      driftSeconds,
      audioEvidenceMethod: "available",
      evidence: [
        ...input.analysis.timingValidation.evidence.filter(
          (item) =>
            item !== "global-offset-and-drift-require-audio-anchor-pairs",
        ),
        `matched-audio-boundary-pairs:${matched.length}`,
        "global-offset-is-median-signed-start-boundary-error",
        "drift-is-late-minus-early-tertile-median-start-error",
      ],
    },
  };
}

function normalizeText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function recallFor(
  kind: ReferenceTimelineArtifact["anchors"][number]["kind"],
  timeline: ReferenceTimelineArtifact,
  alignment: ReferenceCueAlignmentArtifact,
): number | null {
  const anchors = timeline.anchors.filter((anchor) => anchor.kind === kind);
  if (anchors.length === 0) return null;
  return (
    anchors.filter((anchor) =>
      alignment.entries.some(
        (entry) =>
          entry.referenceAnchorIds.includes(anchor.id) &&
          entry.generatedCueIds.length > 0,
      ),
    ).length / anchors.length
  );
}

function sumUnionDuration(intervals: readonly Interval[]): number {
  const sorted = intervals.toSorted(
    (left, right) => left.start - right.start || left.end - right.end,
  );
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (previous !== undefined && interval.start <= previous.end) {
      previous.end = Math.max(previous.end, interval.end);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged.reduce((sum, interval) => sum + duration(interval), 0);
}

export function evaluateSubtitleAgainstReference(input: {
  timeline: ReferenceTimelineArtifact;
  alignment: ReferenceCueAlignmentArtifact;
  generatedCues: readonly SubtitleCue[];
  generatedSubtitleSha256: string;
  guidanceMode: TranscriptionGuidanceMode;
  falseQuarantineCount?: number | undefined;
  falseAcceptanceCount?: number | undefined;
  duplicateAssLineCount?: number | undefined;
  generatedAt?: string;
}): SubtitleEvaluationArtifact {
  const expected = input.timeline.anchors.filter(
    (anchor) => anchor.expectedSpeech || anchor.expectedSinging,
  );
  const referenceDuration = sumUnionDuration(
    expected.map((anchor) => anchor.interval),
  );
  const generatedDuration = sumUnionDuration(input.generatedCues);
  const coveredReferenceDuration = sumUnionDuration(
    input.alignment.entries
      .filter(
        (entry) =>
          entry.referenceAnchorIds.length > 0 &&
          entry.generatedCueIds.length > 0,
      )
      .map((entry) => entry.interval),
  );
  const matchedGeneratedDuration = sumUnionDuration(
    input.alignment.entries
      .filter(
        (entry) =>
          entry.referenceAnchorIds.length > 0 &&
          entry.generatedCueIds.length > 0,
      )
      .map((entry) => entry.interval),
  );
  const startErrors = input.alignment.entries.flatMap((entry) =>
    entry.startErrorSeconds === null ? [] : [Math.abs(entry.startErrorSeconds)],
  );
  const endErrors = input.alignment.entries.flatMap((entry) =>
    entry.endErrorSeconds === null ? [] : [Math.abs(entry.endErrorSeconds)],
  );
  const textCounts = new Map<string, number>();
  for (const cue of input.generatedCues) {
    const normalized = normalizeText(cue.text);
    textCounts.set(normalized, (textCounts.get(normalized) ?? 0) + 1);
  }
  const exactDuplicateCount = [...textCounts.values()].reduce(
    (sum, count) => sum + Math.max(0, count - 1),
    0,
  );
  const overmergeCount = input.alignment.entries.filter(
    (entry) => entry.mapping === "many-to-one",
  ).length;
  const oversplitCount = input.alignment.entries.filter(
    (entry) => entry.mapping === "one-to-many",
  ).length;
  const differences = input.alignment.entries.flatMap((entry, index) => {
    const category =
      entry.mapping === "unmatched-reference"
        ? input.timeline.anchors.some(
            (anchor) =>
              entry.referenceAnchorIds.includes(anchor.id) &&
              anchor.expectedSinging,
          )
          ? ("MISSING_LYRICS" as const)
          : ("MISSING_DIALOGUE" as const)
        : entry.mapping === "unmatched-generated"
          ? ("TEXT_INSERTION" as const)
          : entry.mapping === "many-to-one"
            ? ("OVERMERGE" as const)
            : entry.mapping === "one-to-many"
              ? ("OVERSPLIT" as const)
              : Math.abs(entry.startErrorSeconds ?? 0) > 0.3
                ? ("TIMING_START_ERROR" as const)
                : Math.abs(entry.endErrorSeconds ?? 0) > 0.3
                  ? ("TIMING_END_ERROR" as const)
                  : null;
    return category === null
      ? []
      : [
          {
            id: `reference-difference-${String(index + 1).padStart(5, "0")}`,
            category,
            alignmentId: entry.id,
            interval: entry.interval,
            evidence: [
              `alignment-mapping:${entry.mapping}`,
              `temporal-iou:${entry.temporalIou.toFixed(3)}`,
              "reference-is-strong-evidence-not-absolute-ground-truth",
            ],
          },
        ];
  });
  const missingDialogueDurationSeconds = input.alignment.entries
    .filter((entry) => {
      if (entry.mapping !== "unmatched-reference") return false;
      return input.timeline.anchors.some(
        (anchor) =>
          entry.referenceAnchorIds.includes(anchor.id) &&
          ["dialogue", "narration"].includes(anchor.kind),
      );
    })
    .reduce((sum, entry) => sum + duration(entry.interval), 0);
  const missingLyricsDurationSeconds = input.alignment.entries
    .filter((entry) => {
      if (entry.mapping !== "unmatched-reference") return false;
      return input.timeline.anchors.some(
        (anchor) =>
          entry.referenceAnchorIds.includes(anchor.id) &&
          anchor.expectedSinging,
      );
    })
    .reduce((sum, entry) => sum + duration(entry.interval), 0);
  return subtitleEvaluationArtifactSchema.parse({
    schemaVersion: "1.0.0",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    referenceSha256: input.timeline.input.referenceSha256,
    generatedSubtitleSha256: input.generatedSubtitleSha256,
    guidanceMode: input.guidanceMode,
    configuration: {
      referenceIsStrongEvidenceNotAbsoluteTruth: true,
    },
    metrics: {
      dialogueAnchorRecall: recallFor(
        "dialogue",
        input.timeline,
        input.alignment,
      ),
      narrationAnchorRecall: recallFor(
        "narration",
        input.timeline,
        input.alignment,
      ),
      lyricsAnchorRecall: recallFor(
        "lyrics-original",
        input.timeline,
        input.alignment,
      ),
      referenceDurationCoverage:
        referenceDuration === 0
          ? 0
          : Math.min(1, coveredReferenceDuration / referenceDuration),
      generatedDurationCoverage:
        generatedDuration === 0
          ? 0
          : Math.min(1, matchedGeneratedDuration / generatedDuration),
      unmatchedReferenceAnchors: input.alignment.entries.reduce(
        (sum, entry) =>
          sum +
          (entry.mapping === "unmatched-reference"
            ? entry.referenceAnchorIds.length
            : 0),
        0,
      ),
      unmatchedGeneratedCues: input.alignment.entries.reduce(
        (sum, entry) =>
          sum +
          (entry.mapping === "unmatched-generated"
            ? entry.generatedCueIds.length
            : 0),
        0,
      ),
      medianStartErrorSeconds: median(startErrors),
      medianEndErrorSeconds: median(endErrors),
      timingIouDistribution: {
        below025: input.alignment.entries.filter(
          (entry) => entry.temporalIou < 0.25,
        ).length,
        from025To05: input.alignment.entries.filter(
          (entry) => entry.temporalIou >= 0.25 && entry.temporalIou < 0.5,
        ).length,
        from05To075: input.alignment.entries.filter(
          (entry) => entry.temporalIou >= 0.5 && entry.temporalIou < 0.75,
        ).length,
        atLeast075: input.alignment.entries.filter(
          (entry) => entry.temporalIou >= 0.75,
        ).length,
      },
      overmergeCount,
      oversplitCount,
      exactDuplicateCount,
      sentenceLoopCount: 0,
      longPhraseLoopCount: 0,
      duplicateAssLineCount: input.duplicateAssLineCount ?? 0,
      missingDialogueDurationSeconds,
      missingLyricsDurationSeconds,
      falseQuarantineCount: input.falseQuarantineCount ?? 0,
      falseAcceptanceCount: input.falseAcceptanceCount ?? 0,
    },
    differences,
    semanticValidation: {
      method: "unavailable",
      reason:
        "No configured cross-language semantic model; temporal and coverage evaluation remains active.",
      evaluatedAlignmentCount: 0,
      entityAgreement: null,
      numberAgreement: null,
      negationConflictCount: null,
    },
    fallback: null,
  });
}

export function buildReferenceSemanticValidation(input: {
  timeline: ReferenceTimelineArtifact;
  generatedSubtitleSha256: string;
  mode: ReferenceSemanticValidationMode;
  generatedAt?: string;
}) {
  return referenceSemanticValidationArtifactSchema.parse({
    schemaVersion: "1.0.0",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    referenceSha256: input.timeline.input.referenceSha256,
    generatedSubtitleSha256: input.generatedSubtitleSha256,
    mode: input.mode,
    configuration: {
      requestedMode: input.mode,
    },
    method: "unavailable",
    reason:
      "No configured local cross-language semantic model; this does not block temporal alignment.",
    results: [],
    fallback: null,
  });
}

export function buildFalseQuarantineReport(input: {
  timeline: ReferenceTimelineArtifact;
  generatedCues: readonly SubtitleCue[];
  generatedSubtitleSha256: string;
  quarantinedCandidates?: readonly {
    id: string;
    interval: Interval;
    layer?:
      | "raw-vad"
      | "raw-no-vad"
      | "large-v3-refinement"
      | "recovery"
      | "canonical-rejected"
      | "quarantined";
    text?: string | undefined;
    repetitionHardError?: boolean | undefined;
    speechSupported?: boolean | undefined;
    independentProfileSupport?: boolean | undefined;
  }[];
  generatedAt?: string;
}): FalseQuarantineReportArtifact {
  const entries: FalseQuarantineReportArtifact["entries"] = [];
  for (const candidate of input.quarantinedCandidates ?? []) {
    const anchorIds = input.timeline.anchors.flatMap((anchor) =>
      anchor.expectedSpeech &&
      anchor.interval.start < candidate.interval.end &&
      candidate.interval.start < anchor.interval.end
        ? [anchor.id]
        : [],
    );
    const falseQuarantine =
      anchorIds.length > 0 &&
      candidate.repetitionHardError !== true &&
      candidate.speechSupported === true &&
      candidate.independentProfileSupport === true;
    const trueQuarantine =
      (anchorIds.length === 0 || candidate.speechSupported === false) &&
      candidate.repetitionHardError === true;
    entries.push({
      id: `quarantine-evaluation-${String(entries.length + 1).padStart(5, "0")}`,
      layer: candidate.layer ?? "quarantined",
      interval: candidate.interval,
      cueId: candidate.id,
      evaluation: falseQuarantine
        ? "false-quarantine"
        : trueQuarantine
          ? "true-quarantine"
          : "unresolved",
      anchorIds,
      evidence: [
        `reference-speech-anchor-overlap:${anchorIds.length > 0}`,
        `repetition-hard-error:${candidate.repetitionHardError === true}`,
        `speech-supported:${candidate.speechSupported === true}`,
        `independent-profile-support:${candidate.independentProfileSupport === true}`,
      ],
    });
  }
  for (const cue of input.generatedCues) {
    const anchorIds = input.timeline.anchors.flatMap((anchor) =>
      (anchor.expectedSpeech || anchor.expectedSinging) &&
      anchor.interval.start < cue.end &&
      cue.start < anchor.interval.end
        ? [anchor.id]
        : [],
    );
    if (anchorIds.length === 0 && (cue.confidence ?? 0) < 0.5) {
      entries.push({
        id: `quarantine-evaluation-${String(entries.length + 1).padStart(5, "0")}`,
        layer: "final-accepted",
        interval: { start: cue.start, end: cue.end },
        cueId: cue.id,
        evaluation: "false-acceptance",
        anchorIds: [],
        evidence: [
          "final-cue-has-no-reference-anchor",
          "cue-confidence-below-0.5",
          "requires-audio-review-before-definitive-classification",
        ],
      });
    }
  }
  const evaluations: FalseQuarantineReportArtifact["entries"][number]["evaluation"][] =
    ["true-quarantine", "false-quarantine", "false-acceptance", "unresolved"];
  return falseQuarantineReportArtifactSchema.parse({
    schemaVersion: "1.0.0",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    referenceSha256: input.timeline.input.referenceSha256,
    generatedSubtitleSha256: input.generatedSubtitleSha256,
    configuration: {
      referenceIsStrongEvidenceNotAbsoluteTruth: true,
    },
    inspectedLayers: [
      "raw-vad",
      "raw-no-vad",
      "large-v3-refinement",
      "recovery",
      "canonical-rejected",
      "quarantined",
      "final-accepted",
    ],
    entries,
    summary: Object.fromEntries(
      evaluations.map((evaluation) => [
        evaluation,
        entries.filter((entry) => entry.evaluation === evaluation).length,
      ]),
    ),
    unavailableLayers: [
      "raw-vad",
      "raw-no-vad",
      "large-v3-refinement",
      "recovery",
      "canonical-rejected",
      "quarantined",
    ].filter(
      (layer) =>
        !(input.quarantinedCandidates ?? []).some(
          (candidate) => (candidate.layer ?? "quarantined") === layer,
        ),
    ),
    fallback: null,
  });
}

export function formatSubtitleEvaluationMarkdown(
  evaluation: SubtitleEvaluationArtifact,
): string {
  const metrics = evaluation.metrics;
  const percent = (value: number | null): string =>
    value === null ? "n/a" : `${(value * 100).toFixed(2)}%`;
  return [
    "# Subtitle Evaluation",
    "",
    `- Guidance mode: ${evaluation.guidanceMode}`,
    `- Dialogue anchor recall: ${percent(metrics.dialogueAnchorRecall)}`,
    `- Narration anchor recall: ${percent(metrics.narrationAnchorRecall)}`,
    `- Lyrics anchor recall: ${percent(metrics.lyricsAnchorRecall)}`,
    `- Unmatched reference anchors: ${metrics.unmatchedReferenceAnchors}`,
    `- Unmatched generated cues: ${metrics.unmatchedGeneratedCues}`,
    `- Median start error: ${metrics.medianStartErrorSeconds?.toFixed(3) ?? "n/a"} s`,
    `- Median end error: ${metrics.medianEndErrorSeconds?.toFixed(3) ?? "n/a"} s`,
    `- Missing-dialogue duration: ${metrics.missingDialogueDurationSeconds.toFixed(3)} s`,
    `- Missing-lyrics duration: ${metrics.missingLyricsDurationSeconds.toFixed(3)} s`,
    `- False quarantine: ${metrics.falseQuarantineCount}`,
    `- False acceptance: ${metrics.falseAcceptanceCount}`,
    "",
    "Semantic validation is unavailable unless a cross-language model is configured; temporal and coverage metrics remain valid.",
    "",
  ].join("\n");
}

export function formatSubtitleDiffAss(input: {
  timeline: ReferenceTimelineArtifact;
  alignment: ReferenceCueAlignmentArtifact;
  generatedCues: readonly SubtitleCue[];
}): string {
  const clock = (seconds: number): string => {
    const centiseconds = Math.round(seconds * 100);
    const hours = Math.floor(centiseconds / 360000);
    const minutes = Math.floor((centiseconds % 360000) / 6000);
    const secs = Math.floor((centiseconds % 6000) / 100);
    const cs = centiseconds % 100;
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
  };
  const escape = (text: string): string =>
    text.replaceAll("\n", "\\N").replaceAll("{", "（").replaceAll("}", "）");
  const lines = input.alignment.entries.flatMap((entry) => {
    if (
      entry.mapping !== "unmatched-reference" &&
      entry.mapping !== "unmatched-generated"
    ) {
      return [];
    }
    const text =
      entry.mapping === "unmatched-reference"
        ? input.timeline.anchors
            .filter((anchor) => entry.referenceAnchorIds.includes(anchor.id))
            .map(
              (anchor) =>
                `[REF MISSING ${anchor.kind}] ${anchor.referenceText}`,
            )
            .join(" / ")
        : input.generatedCues
            .filter((cue) => entry.generatedCueIds.includes(cue.id))
            .map((cue) => `[GEN UNMATCHED] ${cue.text}`)
            .join(" / ");
    return `Dialogue: 0,${clock(entry.interval.start)},${clock(entry.interval.end)},Diff,,0,0,0,,${escape(text)}`;
  });
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 1920",
    "PlayResY: 1080",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Diff,Noto Sans CJK JP,42,&H0000FFFF,&H000000FF,&H00000000,&H78000000,0,0,0,0,100,100,0,0,1,2,0,8,40,40,40,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...lines,
    "",
  ].join("\n");
}
