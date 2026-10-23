import { createHash } from "node:crypto";

import {
  fragmentRepairArtifactSchema,
  type FragmentRepairArtifact,
  type SubtitleCue,
} from "@mvl/shared";
import {
  analyzeJapaneseBoundary,
  analyzeJapaneseText,
} from "@mvl/subtitle-core";

export interface FragmentRepairResult {
  cues: SubtitleCue[];
  artifact: FragmentRepairArtifact;
}

const DEFAULT_GAPS = {
  dialogue: 0.6,
  rapidDialogue: 0.35,
  narration: 1,
} as const;

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalized(value: string): string {
  return value.normalize("NFKC").replace(/[♪\s、。，．,.!?！？…]/gu, "");
}

function compatibleProvenance(left: SubtitleCue, right: SubtitleCue): boolean {
  if (left.style === "music" || right.style === "music") return false;
  if ((left.style ?? "default") !== (right.style ?? "default")) return false;
  if (left.language !== right.language) return false;
  if (
    left.speaker !== null &&
    right.speaker !== null &&
    left.speaker !== right.speaker
  ) {
    return false;
  }
  const leftAnchors = left.provenance?.referenceAnchorIds ?? [];
  const rightAnchors = right.provenance?.referenceAnchorIds ?? [];
  if (leftAnchors.length === 0 || rightAnchors.length === 0) return true;
  const rightSet = new Set(rightAnchors);
  return leftAnchors.some((anchor) => rightSet.has(anchor));
}

function maximumGap(left: SubtitleCue, right: SubtitleCue): number {
  if (
    left.provenance?.sceneLabel === "clean-dialogue" ||
    right.provenance?.sceneLabel === "clean-dialogue"
  ) {
    return DEFAULT_GAPS.rapidDialogue;
  }
  if (
    (left.provenance?.referenceAnchorIds.length ?? 0) > 0 &&
    (right.provenance?.referenceAnchorIds.length ?? 0) > 0
  ) {
    return DEFAULT_GAPS.narration;
  }
  return DEFAULT_GAPS.dialogue;
}

function isPrefix(left: SubtitleCue, right: SubtitleCue): boolean {
  const leftText = normalized(left.text);
  const rightText = normalized(right.text);
  return (
    leftText.length >= 4 &&
    leftText.length < rightText.length &&
    rightText.startsWith(leftText)
  );
}

function isSuffix(left: SubtitleCue, right: SubtitleCue): boolean {
  const leftText = normalized(left.text);
  const rightText = normalized(right.text);
  return (
    leftText.length >= 4 &&
    leftText.length < rightText.length &&
    rightText.endsWith(leftText)
  );
}

function shouldMerge(
  left: SubtitleCue,
  right: SubtitleCue,
  options: { eventFirst?: boolean } = {},
): {
  merge: boolean;
  reasons: string[];
} {
  const gap = right.start - left.end;
  if (gap > maximumGap(left, right) || gap < -0.25) {
    return { merge: false, reasons: [] };
  }
  if (!compatibleProvenance(left, right)) {
    return { merge: false, reasons: [] };
  }
  const leftAnalysis = analyzeJapaneseText(left.text);
  const rightAnalysis = analyzeJapaneseText(right.text);
  const boundary = analyzeJapaneseBoundary(left.text, right.text);
  if (leftAnalysis.sentenceEndingConfidence >= 0.8) {
    return { merge: false, reasons: [] };
  }
  const strongBoundary =
    boundary.boundarySplitsWord && boundary.confidence >= 0.8;
  const sharedRequest = (left.provenance?.sourceRequestIds ?? []).some(
    (requestId) =>
      (right.provenance?.sourceRequestIds ?? []).includes(requestId),
  );
  const sharedRecoveryUnit =
    left.provenance?.recoveryUnitId !== null &&
    left.provenance?.recoveryUnitId !== undefined &&
    left.provenance.recoveryUnitId === right.provenance?.recoveryUnitId;
  const crossSourceLayer =
    left.provenance?.sourceLayer !== right.provenance?.sourceLayer;
  if (
    options.eventFirst === true &&
    ((crossSourceLayer && !sharedRequest && !sharedRecoveryUnit) ||
      (!strongBoundary && !sharedRequest && !sharedRecoveryUnit))
  ) {
    return { merge: false, reasons: [] };
  }
  const incompleteClauseContinuation =
    leftAnalysis.likelyIncompleteClause && gap <= 0.25;
  const merge =
    strongBoundary ||
    leftAnalysis.endsMidWord ||
    rightAnalysis.startsMidWord ||
    incompleteClauseContinuation;
  return {
    merge,
    reasons: merge
      ? [
          ...boundary.evidence,
          `gap-seconds:${gap.toFixed(3)}`,
          `left-ends-mid-word:${String(leftAnalysis.endsMidWord)}`,
          `right-starts-mid-word:${String(rightAnalysis.startsMidWord)}`,
          `incomplete-clause-continuation:${String(incompleteClauseContinuation)}`,
          left.provenance?.sourceLayer === right.provenance?.sourceLayer
            ? "same-source-layer"
            : "cross-source-layer-compatible",
        ]
      : [],
  };
}

function mergedText(left: string, right: string): string {
  const cleanLeft = left.replace(/\s+$/gu, "");
  const cleanRight = right.replace(/^\s+/gu, "");
  const normalizedLeft = normalized(cleanLeft);
  const normalizedRight = normalized(cleanRight);
  if (normalizedRight.startsWith(normalizedLeft)) return cleanRight;
  if (normalizedLeft.endsWith(normalizedRight)) return cleanLeft;
  return `${cleanLeft}${cleanRight}`;
}

function merge(left: SubtitleCue, right: SubtitleCue, id: string): SubtitleCue {
  const text = mergedText(left.text, right.text);
  const speechStarts = [
    left.timingEvidence?.speechStart,
    right.timingEvidence?.speechStart,
  ].filter((value): value is number => value !== null && value !== undefined);
  const speechEnds = [
    left.timingEvidence?.speechEnd,
    right.timingEvidence?.speechEnd,
  ].filter((value): value is number => value !== null && value !== undefined);
  const sourceRequestIds = [
    ...new Set([
      ...(left.provenance?.sourceRequestIds ?? [left.id]),
      ...(right.provenance?.sourceRequestIds ?? [right.id]),
    ]),
  ];
  const sourceProfileIds = [
    ...new Set([
      ...(left.provenance?.sourceProfileIds ?? []),
      ...(right.provenance?.sourceProfileIds ?? []),
    ]),
  ];
  return {
    ...left,
    id,
    start:
      speechStarts.length > 0
        ? Math.min(...speechStarts, left.start, right.start)
        : Math.min(left.start, right.start),
    end:
      speechEnds.length > 0
        ? Math.max(...speechEnds, left.end, right.end)
        : Math.max(left.end, right.end),
    text,
    confidence:
      left.confidence === null || right.confidence === null
        ? (left.confidence ?? right.confidence)
        : (left.confidence + right.confidence) / 2,
    provenance:
      left.provenance === undefined && right.provenance === undefined
        ? undefined
        : {
            ...(left.provenance ?? right.provenance),
            sourceLayer:
              left.provenance?.sourceLayer ??
              right.provenance?.sourceLayer ??
              "baseline-vad",
            sourceRequestIds,
            sourceProfileIds,
            referenceAnchorIds: [
              ...new Set([
                ...(left.provenance?.referenceAnchorIds ?? []),
                ...(right.provenance?.referenceAnchorIds ?? []),
              ]),
            ],
            referenceUnitIds: [
              ...new Set([
                ...(left.provenance?.referenceUnitIds ?? []),
                ...(right.provenance?.referenceUnitIds ?? []),
              ]),
            ],
            recoveryUnitId:
              left.provenance?.recoveryUnitId ??
              right.provenance?.recoveryUnitId ??
              null,
            sceneId:
              left.provenance?.sceneId ?? right.provenance?.sceneId ?? null,
            sceneLabel:
              left.provenance?.sceneLabel ??
              right.provenance?.sceneLabel ??
              null,
            independentSupportCount: Math.max(
              left.provenance?.independentSupportCount ?? 0,
              right.provenance?.independentSupportCount ?? 0,
              sourceProfileIds.length,
            ),
            qualityScore: Math.max(
              left.provenance?.qualityScore ?? 0,
              right.provenance?.qualityScore ?? 0,
            ),
          },
    timingEvidence:
      left.timingEvidence === undefined && right.timingEvidence === undefined
        ? undefined
        : {
            sourceTrusted:
              left.timingEvidence?.sourceTrusted === true &&
              right.timingEvidence?.sourceTrusted === true,
            speechStart:
              speechStarts.length === 0 ? null : Math.min(...speechStarts),
            speechEnd: speechEnds.length === 0 ? null : Math.max(...speechEnds),
            tokenTimestampsAvailable:
              left.timingEvidence?.tokenTimestampsAvailable === true ||
              right.timingEvidence?.tokenTimestampsAvailable === true,
            tokenTimestampsUsed:
              left.timingEvidence?.tokenTimestampsUsed === true ||
              right.timingEvidence?.tokenTimestampsUsed === true,
            tokens: [
              ...(left.timingEvidence?.tokens ?? []),
              ...(right.timingEvidence?.tokens ?? []),
            ].toSorted((a, b) => a.start - b.start || a.end - b.end),
            alignmentSource:
              (left.timingEvidence?.tokens.length ?? 0) +
                (right.timingEvidence?.tokens.length ?? 0) >
              0
                ? "token"
                : "speech",
            presentationTimingMethod: null,
            speechIntervals: [
              ...(left.timingEvidence?.speechIntervals ?? []),
              ...(right.timingEvidence?.speechIntervals ?? []),
            ].toSorted((a, b) => a.start - b.start || a.end - b.end),
          },
    textAudit: {
      rawAsrText: [
        left.textAudit?.rawAsrText ?? left.text,
        right.textAudit?.rawAsrText ?? right.text,
      ].join(" | "),
      repairedText: text,
      normalizedText: text,
      winnerClusterIds: [
        ...new Set([
          ...(left.textAudit?.winnerClusterIds ?? []),
          ...(right.textAudit?.winnerClusterIds ?? []),
        ]),
      ],
      sourceWinnerCueIds: [
        ...new Set([
          ...(left.textAudit?.sourceWinnerCueIds ?? [left.id]),
          ...(right.textAudit?.sourceWinnerCueIds ?? [right.id]),
        ]),
      ],
      winnerScore: Math.max(
        left.textAudit?.winnerScore ?? 0,
        right.textAudit?.winnerScore ?? 0,
      ),
      replacements: [
        ...(left.textAudit?.replacements ?? []),
        ...(right.textAudit?.replacements ?? []),
      ],
      deduplicationActions: [
        ...(left.textAudit?.deduplicationActions ?? []),
        ...(right.textAudit?.deduplicationActions ?? []),
      ],
      repairType: "fragment-merge",
      reviewRecommended:
        (left.textAudit?.reviewRecommended ?? false) ||
        (right.textAudit?.reviewRecommended ?? false),
      reviewReasons: [
        ...new Set([
          ...(left.textAudit?.reviewReasons ?? []),
          ...(right.textAudit?.reviewReasons ?? []),
        ]),
      ],
    },
  };
}

export function repairTopScoreFragments(
  inputCues: readonly SubtitleCue[],
  options: { eventFirst?: boolean } = {},
): FragmentRepairResult {
  const sorted = [...inputCues].toSorted(
    (left, right) =>
      left.start - right.start ||
      left.end - right.end ||
      left.id.localeCompare(right.id),
  );
  const output: SubtitleCue[] = [];
  const repairs: FragmentRepairArtifact["repairs"] = [];
  for (let index = 0; index < sorted.length; index += 1) {
    const cue = sorted[index];
    if (cue === undefined) continue;
    const next = sorted[index + 1];
    if (
      next !== undefined &&
      isPrefix(cue, next) &&
      next.start - cue.end <= 0.8
    ) {
      output.push(next);
      repairs.push({
        id: `fragment-repair-${String(repairs.length + 1).padStart(5, "0")}`,
        repairType: "prefix-superseded",
        sourceWinnerIds: [cue.id, next.id],
        rawSourceTexts: [cue.text, next.text],
        outputCueId: next.id,
        mergedText: next.text,
        mergeEvidence: ["complete-next-winner-contains-current-prefix"],
      });
      index += 1;
      continue;
    }
    if (
      next !== undefined &&
      isSuffix(cue, next) &&
      next.start - cue.end <= 0.8
    ) {
      output.push(next);
      repairs.push({
        id: `fragment-repair-${String(repairs.length + 1).padStart(5, "0")}`,
        repairType: "suffix-superseded",
        sourceWinnerIds: [cue.id, next.id],
        rawSourceTexts: [cue.text, next.text],
        outputCueId: next.id,
        mergedText: next.text,
        mergeEvidence: ["complete-next-winner-contains-current-suffix"],
      });
      index += 1;
      continue;
    }
    const previous = output.at(-1);
    if (previous !== undefined) {
      const decision = shouldMerge(previous, cue, options);
      if (decision.merge) {
        const merged = merge(
          previous,
          cue,
          `${previous.id}+${cue.id}-fragment-repair`,
        );
        output[output.length - 1] = merged;
        repairs.push({
          id: `fragment-repair-${String(repairs.length + 1).padStart(5, "0")}`,
          repairType: "merge-previous",
          sourceWinnerIds: [previous.id, cue.id],
          rawSourceTexts: [previous.text, cue.text],
          outputCueId: merged.id,
          mergedText: merged.text,
          mergeEvidence: decision.reasons,
        });
        continue;
      }
    }
    // Only look forward after a real previous winner was considered and found
    // incompatible. Otherwise keep the first fragment in the output so the
    // following iteration can apply the required previous-first policy.
    if (previous !== undefined && next !== undefined) {
      const decision = shouldMerge(cue, next, options);
      if (decision.merge) {
        const merged = merge(cue, next, `${cue.id}+${next.id}-fragment-repair`);
        output.push(merged);
        repairs.push({
          id: `fragment-repair-${String(repairs.length + 1).padStart(5, "0")}`,
          repairType: "merge-next",
          sourceWinnerIds: [cue.id, next.id],
          rawSourceTexts: [cue.text, next.text],
          outputCueId: merged.id,
          mergedText: merged.text,
          mergeEvidence: decision.reasons,
        });
        index += 1;
        continue;
      }
    }
    output.push(cue);
  }
  const cues = output.toSorted(
    (left, right) =>
      left.start - right.start ||
      left.end - right.end ||
      left.id.localeCompare(right.id),
  );
  const artifact = fragmentRepairArtifactSchema.parse({
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    inputHash: hash(inputCues),
    configuration: {
      dialogueMaximumGapSeconds: DEFAULT_GAPS.dialogue,
      rapidDialogueMaximumGapSeconds: DEFAULT_GAPS.rapidDialogue,
      narrationMaximumGapSeconds: DEFAULT_GAPS.narration,
      previousWinnerPreferred: true,
    },
    inputWinnerCount: inputCues.length,
    outputWinnerCount: cues.length,
    repairs,
    summary: {
      repairCount: repairs.length,
      fragmentMergeCount: repairs.filter((repair) =>
        repair.repairType.startsWith("merge-"),
      ).length,
      mergedWithPreviousCount: repairs.filter(
        (repair) => repair.repairType === "merge-previous",
      ).length,
      mergedWithNextCount: repairs.filter(
        (repair) => repair.repairType === "merge-next",
      ).length,
      prefixSupersededCount: repairs.filter(
        (repair) => repair.repairType === "prefix-superseded",
      ).length,
    },
  });
  return { cues, artifact };
}
