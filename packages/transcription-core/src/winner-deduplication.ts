import { createHash } from "node:crypto";

import {
  winnerDeduplicationArtifactSchema,
  type SubtitleCue,
  type WinnerDeduplicationArtifact,
} from "@mvl/shared";
import { analyzeJapaneseText } from "@mvl/subtitle-core";

export type WinnerDeduplicationStage =
  "pre-normalization" | "post-normalization";

export interface WinnerDeduplicationResult {
  cues: SubtitleCue[];
  artifact: WinnerDeduplicationArtifact;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalized(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[♪\s、。，．,.!?！？…]/gu, "")
    .toLocaleLowerCase("ja");
}

function spacingNormalized(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, "").trim();
}

function punctuationNormalized(value: string): string {
  return value.normalize("NFKC").replace(/[、。，．,.!?！？…]/gu, "");
}

function overlapSeconds(left: SubtitleCue, right: SubtitleCue): number {
  return Math.max(
    0,
    Math.min(left.end, right.end) - Math.max(left.start, right.start),
  );
}

function bigrams(value: string): Set<string> {
  const chars = Array.from(normalized(value));
  return new Set(
    chars.length < 2
      ? chars
      : chars
          .slice(0, -1)
          .map((char, index) => `${char}${chars[index + 1] ?? ""}`),
  );
}

function similarity(left: string, right: string): number {
  const leftSet = bigrams(left);
  const rightSet = bigrams(right);
  const common = [...leftSet].filter((entry) => rightSet.has(entry)).length;
  return (2 * common) / Math.max(1, leftSet.size + rightSet.size);
}

function shared(left: readonly string[], right: readonly string[]): boolean {
  const rightSet = new Set(right);
  return left.some((entry) => rightSet.has(entry));
}

function isTrustedReferenceOriginalLyrics(cue: SubtitleCue): boolean {
  return (
    cue.style === "music" &&
    (cue.textSource === "reference-original-language" ||
      cue.provenance?.sourceLayer === "reference-original-language") &&
    (cue.timingEvidence?.sourceTrusted === true ||
      cue.provenance?.sourceLayer === "reference-original-language")
  );
}

function isLyricsAsr(cue: SubtitleCue): boolean {
  return cue.style === "music" && cue.provenance?.sourceLayer === "lyrics-asr";
}

function duplicateKind(
  left: SubtitleCue,
  right: SubtitleCue,
  stage: WinnerDeduplicationStage,
): WinnerDeduplicationArtifact["records"][number]["kind"] | null {
  const gap = Math.max(left.start, right.start) - Math.min(left.end, right.end);
  const temporallyRelated = overlapSeconds(left, right) > 0 || gap <= 0.8;
  if (!temporallyRelated) return null;
  if (
    overlapSeconds(left, right) > 0 &&
    ((isTrustedReferenceOriginalLyrics(left) && isLyricsAsr(right)) ||
      (isTrustedReferenceOriginalLyrics(right) && isLyricsAsr(left)))
  ) {
    return "trusted-reference-original-lyrics";
  }
  if (left.text === right.text) return "exact";
  if (spacingNormalized(left.text) === spacingNormalized(right.text)) {
    return "spacing-only-difference";
  }
  if (punctuationNormalized(left.text) === punctuationNormalized(right.text)) {
    return "punctuation-only-difference";
  }
  const leftText = normalized(left.text);
  const rightText = normalized(right.text);
  if (leftText === rightText) {
    return stage === "post-normalization"
      ? "normalized-form-equivalent"
      : "normalized-exact";
  }
  const minimum = Math.min(leftText.length, rightText.length);
  if (
    minimum >= 4 &&
    (leftText.startsWith(rightText) || rightText.startsWith(leftText))
  ) {
    return "prefix-duplicate";
  }
  if (
    minimum >= 4 &&
    (leftText.endsWith(rightText) || rightText.endsWith(leftText))
  ) {
    return "suffix-duplicate";
  }
  const sameSource = shared(
    left.provenance?.sourceRequestIds ?? [],
    right.provenance?.sourceRequestIds ?? [],
  );
  const sameAnchor = shared(
    left.provenance?.referenceAnchorIds ?? [],
    right.provenance?.referenceAnchorIds ?? [],
  );
  const sameRecovery =
    left.provenance?.recoveryUnitId !== null &&
    left.provenance?.recoveryUnitId !== undefined &&
    left.provenance.recoveryUnitId === right.provenance?.recoveryUnitId;
  const textSimilarity = similarity(left.text, right.text);
  if (textSimilarity >= 0.88) return "near-duplicate";
  if (textSimilarity >= 0.72 && sameSource) return "same-source";
  if (textSimilarity >= 0.72 && sameAnchor) return "same-reference-anchor";
  if (textSimilarity >= 0.72 && sameRecovery) return "same-recovery-unit";
  return null;
}

function timingQuality(cue: SubtitleCue): number {
  const duration = cue.end - cue.start;
  const visible = Array.from(normalized(cue.text)).length;
  const plausible =
    duration >= 0.4 &&
    duration <= 12 &&
    visible / Math.max(0.001, duration) <= 16;
  const speechStart = cue.timingEvidence?.speechStart ?? null;
  const speechEnd = cue.timingEvidence?.speechEnd ?? null;
  return (
    (cue.timingEvidence?.tokenTimestampsUsed === true ? 4 : 0) +
    (speechStart !== null && speechEnd !== null ? 2 : 0) +
    ((cue.timingEvidence?.speechIntervals?.length ?? 0) > 0 ? 1 : 0) +
    (plausible ? 2 : 0)
  );
}

function preferred(
  left: SubtitleCue,
  right: SubtitleCue,
  kind: WinnerDeduplicationArtifact["records"][number]["kind"],
): SubtitleCue {
  if (kind === "trusted-reference-original-lyrics") {
    return isTrustedReferenceOriginalLyrics(left) ? left : right;
  }
  const leftComplete = analyzeJapaneseText(left.text);
  const rightComplete = analyzeJapaneseText(right.text);
  const leftLength = normalized(left.text).length;
  const rightLength = normalized(right.text).length;
  if (
    ["prefix-duplicate", "suffix-duplicate"].includes(kind) &&
    leftLength !== rightLength
  ) {
    return leftLength > rightLength ? left : right;
  }
  const leftScore = left.textAudit?.winnerScore ?? left.confidence ?? 0;
  const rightScore = right.textAudit?.winnerScore ?? right.confidence ?? 0;
  if (leftScore !== rightScore) return leftScore > rightScore ? left : right;
  const leftCompleteness =
    Number(!leftComplete.startsMidWord) +
    Number(!leftComplete.endsMidWord) +
    Number(!leftComplete.likelyIncompleteClause);
  const rightCompleteness =
    Number(!rightComplete.startsMidWord) +
    Number(!rightComplete.endsMidWord) +
    Number(!rightComplete.likelyIncompleteClause);
  if (leftCompleteness !== rightCompleteness) {
    return leftCompleteness > rightCompleteness ? left : right;
  }
  if (timingQuality(left) !== timingQuality(right)) {
    return timingQuality(left) > timingQuality(right) ? left : right;
  }
  return left.id.localeCompare(right.id) <= 0 ? left : right;
}

export function deduplicateTopScoreWinners(
  inputCues: readonly SubtitleCue[],
  stage: WinnerDeduplicationStage = "pre-normalization",
): WinnerDeduplicationResult {
  const working = [...inputCues].toSorted(
    (left, right) =>
      left.start - right.start ||
      left.end - right.end ||
      left.id.localeCompare(right.id),
  );
  const removed = new Set<string>();
  const replacementById = new Map<string, SubtitleCue>();
  const records: WinnerDeduplicationArtifact["records"] = [];
  for (let leftIndex = 0; leftIndex < working.length; leftIndex += 1) {
    const originalLeft = working[leftIndex];
    if (originalLeft === undefined || removed.has(originalLeft.id)) continue;
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < working.length;
      rightIndex += 1
    ) {
      const originalRight = working[rightIndex];
      if (originalRight === undefined || removed.has(originalRight.id))
        continue;
      const left = replacementById.get(originalLeft.id) ?? originalLeft;
      const right = replacementById.get(originalRight.id) ?? originalRight;
      if (right.start - left.end > 0.8) break;
      const kind = duplicateKind(left, right, stage);
      if (kind === null) continue;
      const keep = preferred(left, right, kind);
      const discard = keep.id === left.id ? right : left;
      const useTimingDonor =
        kind !== "trusted-reference-original-lyrics" &&
        timingQuality(discard) > timingQuality(keep);
      const kept = useTimingDonor
        ? {
            ...keep,
            start: discard.start,
            end: discard.end,
            ...(discard.timingEvidence === undefined
              ? {}
              : { timingEvidence: discard.timingEvidence }),
          }
        : keep;
      const action = `${kind}:${discard.id}`;
      replacementById.set(keep.id, {
        ...kept,
        textAudit: {
          rawAsrText: kept.textAudit?.rawAsrText ?? kept.text,
          repairedText: kept.textAudit?.repairedText ?? kept.text,
          normalizedText: kept.textAudit?.normalizedText ?? kept.text,
          winnerClusterIds: kept.textAudit?.winnerClusterIds ?? [],
          sourceWinnerCueIds: [
            ...new Set([
              ...(kept.textAudit?.sourceWinnerCueIds ?? [kept.id]),
              ...(discard.textAudit?.sourceWinnerCueIds ?? [discard.id]),
            ]),
          ],
          ...(kept.textAudit?.winnerScore === undefined
            ? {}
            : { winnerScore: kept.textAudit.winnerScore }),
          ...(kept.textAudit?.runnerUpCueId === undefined
            ? {}
            : { runnerUpCueId: kept.textAudit.runnerUpCueId }),
          ...(kept.textAudit?.runnerUpScore === undefined
            ? {}
            : { runnerUpScore: kept.textAudit.runnerUpScore }),
          ...(kept.textAudit?.scoreGap === undefined
            ? {}
            : { scoreGap: kept.textAudit.scoreGap }),
          replacements: kept.textAudit?.replacements ?? [],
          deduplicationActions: [
            ...(kept.textAudit?.deduplicationActions ?? []),
            action,
          ],
          ...(useTimingDonor ? { timingDonorCueId: discard.id } : {}),
          ...(useTimingDonor
            ? { timingRepairMethod: "equivalent-candidate-interval" }
            : {}),
          reviewRecommended:
            (kept.textAudit?.reviewRecommended ?? false) ||
            (discard.textAudit?.reviewRecommended ?? false),
          reviewReasons: [
            ...new Set([
              ...(kept.textAudit?.reviewReasons ?? []),
              ...(discard.textAudit?.reviewReasons ?? []),
            ]),
          ],
        },
      });
      removed.add(discard.id);
      records.push({
        id: `winner-dedup-${String(records.length + 1).padStart(5, "0")}`,
        kind,
        keptCueId: keep.id,
        removedCueIds: [discard.id],
        timingDonorCueId: useTimingDonor ? discard.id : null,
        reasons: [
          "duplicate-top-score-winners-collapsed",
          ...(kind === "trusted-reference-original-lyrics"
            ? [
                "trusted-reference-original-lyrics-outranks-overlapping-lyrics-asr",
              ]
            : []),
          ...(kind === "prefix-duplicate"
            ? ["complete-text-outranks-prefix-fragment"]
            : []),
          ...(useTimingDonor
            ? ["kept-text-inherited-more-reliable-equivalent-timing"]
            : []),
        ],
      });
      if (discard.id === originalLeft.id) break;
    }
  }
  const cues = working
    .filter((cue) => !removed.has(cue.id))
    .map((cue) => replacementById.get(cue.id) ?? cue)
    .toSorted(
      (left, right) =>
        left.start - right.start ||
        left.end - right.end ||
        left.id.localeCompare(right.id),
    );
  const artifact = winnerDeduplicationArtifactSchema.parse({
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    inputHash: hash(inputCues),
    stage,
    inputWinnerCount: inputCues.length,
    outputWinnerCount: cues.length,
    records,
    summary: {
      removedCount: inputCues.length - cues.length,
      prefixDuplicateCount: records.filter(
        (record) => record.kind === "prefix-duplicate",
      ).length,
      timingDonorCount: records.filter(
        (record) => record.timingDonorCueId !== null,
      ).length,
    },
  });
  return { cues, artifact };
}

export function deduplicateNormalizedWinners(
  cues: readonly SubtitleCue[],
): WinnerDeduplicationResult {
  return deduplicateTopScoreWinners(cues, "post-normalization");
}
