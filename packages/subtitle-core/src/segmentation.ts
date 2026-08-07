import { createHash } from "node:crypto";

import {
  cueSegmentationPlanArtifactSchema,
  japaneseTextAnalysisArtifactSchema,
  type CueSegmentationMode,
  type CueSegmentationPlanArtifact,
  type JapaneseTextAnalysisArtifact,
  type JapaneseTextAnalyzerMode,
  type ReferenceTimelineArtifact,
  type SubtitleCue,
} from "@mvl/shared";

import { createJapaneseTextAnalyzer } from "./japanese-text.js";
import { analyzeJapaneseBoundary } from "./japanese-text.js";
import { normalizeTypography } from "./layout.js";

export interface AcousticSemanticSegmentationOptions {
  mode?: CueSegmentationMode;
  japaneseTextAnalyzer?: JapaneseTextAnalyzerMode;
  maximumLines?: number;
  maximumCharactersPerLine?: number;
  maximumCueDurationSeconds?: number;
  maximumCharactersPerSecond?: number;
  maximumMergeGapSeconds?: number;
  referenceTimeline?: ReferenceTimelineArtifact;
}

export interface AcousticSemanticSegmentationResult {
  cues: SubtitleCue[];
  plan: CueSegmentationPlanArtifact;
  japaneseTextAnalysis: JapaneseTextAnalysisArtifact;
  unresolvedIntervals: {
    start: number;
    end: number;
    cueIds: string[];
    reasons: string[];
  }[];
}

const NATURAL_BOUNDARY =
  /(?:[、。!?！？…\u3000 ]|から|けど|ので|のに|なら|たら|れば|ても|って|さかい)$/u;

function artifactHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function visibleLength(value: string): number {
  return Array.from(value.replace(/\s/gu, "")).length;
}

function cleanText(value: string): string {
  return value.replace(/\s*\n+\s*/gu, "").trim();
}

function recordedAsrBreakOffsets(cue: SubtitleCue): Set<number> {
  const raw = cue.textAudit?.rawAsrText;
  if (raw === undefined) return new Set();
  const offsets = new Set<number>();
  const characters = Array.from(raw);
  for (let index = 1; index < characters.length - 1; index += 1) {
    if (!/[\p{White_Space}]/u.test(characters[index] ?? "")) continue;
    const prefix = normalizeTypography(
      characters.slice(0, index).join(""),
      cue.language,
    );
    const offset = visibleLength(prefix);
    if (offset > 0) offsets.add(offset);
  }
  return offsets;
}

function expandToReliableTokenEvidence(cue: SubtitleCue): SubtitleCue {
  const timingEvidence = cue.timingEvidence;
  if (
    timingEvidence === undefined ||
    timingEvidence.sourceTrusted ||
    (cue.textAudit?.deduplicationActions ?? []).some((action) =>
      action.startsWith("subtitle-overlap-boundary-trimmed-"),
    )
  ) {
    return cue;
  }
  const tokens = timingEvidence.tokens.filter(
    (token) => token.end > token.start && token.text.trim() !== "",
  );
  if (tokens.length === 0) return cue;
  const tokenCharacterCount = visibleLength(
    tokens.map((token) => token.text).join(""),
  );
  const cueCharacterCount = visibleLength(cue.text);
  if (
    tokenCharacterCount / Math.max(1, cueCharacterCount) < 0.7 ||
    cueCharacterCount / Math.max(1, tokenCharacterCount) < 0.55
  ) {
    return cue;
  }
  const start = Math.min(cue.start, ...tokens.map((token) => token.start));
  const end = Math.max(cue.end, ...tokens.map((token) => token.end));
  if (end <= start || end - start > 15) return cue;
  return {
    ...cue,
    start,
    end,
    timingEvidence: {
      ...timingEvidence,
      speechStart:
        timingEvidence.speechStart === null
          ? start
          : Math.min(start, timingEvidence.speechStart),
      speechEnd:
        timingEvidence.speechEnd === null
          ? end
          : Math.max(end, timingEvidence.speechEnd),
      tokenTimestampsAvailable: true,
      tokenTimestampsUsed: true,
      alignmentSource: "token",
      presentationTimingMethod: "token",
    },
    ...(cue.textAudit === undefined
      ? {}
      : {
          textAudit: {
            ...cue.textAudit,
            timingRepairMethod: "winner-token" as const,
            deduplicationActions: [
              ...cue.textAudit.deduplicationActions,
              "cue-interval-expanded-to-reliable-token-evidence",
            ],
          },
        }),
  };
}

function sourceIds(cue: SubtitleCue): string[] {
  return cue.provenance?.sourceRequestIds.length
    ? cue.provenance.sourceRequestIds
    : [cue.id];
}

function presentationParent(cue: SubtitleCue): string {
  return cue.id.replace(/-(?:\d{2,4})$/u, "");
}

function canMerge(
  left: SubtitleCue,
  right: SubtitleCue,
  maximumGapSeconds: number,
  boundaryContinuation: boolean,
): boolean {
  if (right.start - left.end > maximumGapSeconds) return false;
  if (
    /-(?:semantic|long-split)-\d{2,}$/u.test(left.id) ||
    /-(?:semantic|long-split)-\d{2,}$/u.test(right.id)
  ) {
    return false;
  }
  // A timed lyric line is already a semantic presentation unit. Joining
  // adjacent music cues can collapse distinct reference anchors and produces
  // malformed decoration such as `♪ first ♪♪ second ♪`.
  if (left.style === "music" || right.style === "music") return false;
  if (left.style !== right.style || left.language !== right.language) {
    return false;
  }
  if (left.textSource !== right.textSource) return false;
  return (
    boundaryContinuation ||
    presentationParent(left) === presentationParent(right)
  );
}

function mergeCues(cues: readonly SubtitleCue[]): SubtitleCue {
  const first = cues[0];
  const last = cues.at(-1);
  if (first === undefined || last === undefined) {
    throw new RangeError("At least one cue is required for merging.");
  }
  const allSourceIds = [...new Set(cues.flatMap(sourceIds))];
  const independentSupportCount = Math.max(
    ...cues.map((cue) => cue.provenance?.independentSupportCount ?? 0),
    new Set(cues.flatMap((cue) => cue.provenance?.sourceProfileIds ?? [])).size,
  );
  return {
    ...first,
    id: `${presentationParent(first)}-semantic-merge`,
    start: first.start,
    end: last.end,
    text: cues.map((cue) => cleanText(cue.text)).join(""),
    confidence: cues.every((cue) => cue.confidence !== null)
      ? cues.reduce((sum, cue) => sum + (cue.confidence ?? 0), 0) / cues.length
      : null,
    provenance: first.provenance
      ? {
          ...first.provenance,
          sourceRequestIds: allSourceIds,
          sourceProfileIds: [
            ...new Set(
              cues.flatMap((cue) => cue.provenance?.sourceProfileIds ?? []),
            ),
          ],
          referenceAnchorIds: [
            ...new Set(
              cues.flatMap((cue) => cue.provenance?.referenceAnchorIds ?? []),
            ),
          ],
          referenceUnitIds: [
            ...new Set(
              cues.flatMap((cue) => cue.provenance?.referenceUnitIds ?? []),
            ),
          ],
          independentSupportCount,
        }
      : undefined,
    timingEvidence: first.timingEvidence
      ? {
          ...first.timingEvidence,
          speechStart:
            cues
              .map((cue) => cue.timingEvidence?.speechStart)
              .filter(
                (value): value is number =>
                  value !== null && value !== undefined,
              )
              .toSorted((left, right) => left - right)[0] ?? null,
          speechEnd:
            cues
              .map((cue) => cue.timingEvidence?.speechEnd)
              .filter(
                (value): value is number =>
                  value !== null && value !== undefined,
              )
              .toSorted((left, right) => right - left)[0] ?? null,
          tokens: cues.flatMap((cue) => cue.timingEvidence?.tokens ?? []),
          speechIntervals: cues.flatMap(
            (cue) => cue.timingEvidence?.speechIntervals ?? [],
          ),
        }
      : undefined,
  };
}

function fitsWordSafePresentationUnit(
  value: string,
  maximumCharactersPerLine: number,
  capacity: number,
): boolean {
  const characters = Array.from(value);
  if (characters.length <= maximumCharactersPerLine) return true;
  if (characters.length > capacity) return false;
  const minimum = Math.max(1, characters.length - maximumCharactersPerLine);
  const maximum = Math.min(maximumCharactersPerLine, characters.length - 1);
  for (let index = minimum; index <= maximum; index += 1) {
    const boundary = analyzeJapaneseBoundary(
      characters.slice(0, index).join(""),
      characters.slice(index).join(""),
    );
    if (!boundary.boundarySplitsWord || boundary.confidence < 0.8) return true;
  }
  return false;
}

function semanticChunks(
  text: string,
  capacity: number,
  maximumCharactersPerLine: number,
  preferredBoundaries: ReadonlySet<number> = new Set(),
): string[] {
  const characters = Array.from(cleanText(text));
  if (
    fitsWordSafePresentationUnit(
      characters.join(""),
      maximumCharactersPerLine,
      capacity,
    )
  ) {
    return [characters.join("")];
  }
  const wordBoundaries = new Set(
    Array.from(
      new Intl.Segmenter("ja", { granularity: "word" }).segment(
        characters.join(""),
      ),
      (segment) => segment.index + Array.from(segment.segment).length,
    ),
  );
  const output: string[] = [];
  let start = 0;
  while (
    !fitsWordSafePresentationUnit(
      characters.slice(start).join(""),
      maximumCharactersPerLine,
      capacity,
    )
  ) {
    const remaining = characters.slice(start).join("");
    const effectiveCapacity =
      Array.from(remaining).length <= capacity
        ? maximumCharactersPerLine
        : capacity;
    const minimum = start + Math.floor(effectiveCapacity * 0.55);
    const maximum = Math.min(characters.length, start + effectiveCapacity);
    let split = -1;
    for (let index = maximum; index >= minimum; index -= 1) {
      const prefix = characters.slice(start, index).join("");
      if (
        NATURAL_BOUNDARY.test(prefix) &&
        fitsWordSafePresentationUnit(prefix, maximumCharactersPerLine, capacity)
      ) {
        split = index;
        break;
      }
    }
    if (split < 0) {
      const preferredMinimum =
        start + Math.max(1, Math.floor(effectiveCapacity * 0.45));
      for (let index = maximum; index >= preferredMinimum; index -= 1) {
        const prefix = characters.slice(start, index).join("");
        if (
          preferredBoundaries.has(index) &&
          fitsWordSafePresentationUnit(
            prefix,
            maximumCharactersPerLine,
            capacity,
          )
        ) {
          split = index;
          break;
        }
      }
    }
    if (split < 0) {
      for (let index = maximum; index >= minimum; index -= 1) {
        const prefix = characters.slice(start, index).join("");
        if (
          wordBoundaries.has(index) &&
          fitsWordSafePresentationUnit(
            prefix,
            maximumCharactersPerLine,
            capacity,
          )
        ) {
          split = index;
          break;
        }
      }
    }
    if (split < 0) return [];
    output.push(characters.slice(start, split).join("").trim());
    start = split;
  }
  output.push(characters.slice(start).join("").trim());
  return output.filter(Boolean);
}

function tokenIntervals(
  cue: SubtitleCue,
  count: number,
): { start: number; end: number }[] | null {
  const tokens = (cue.timingEvidence?.tokens ?? [])
    .filter((token) => token.end > token.start && token.text.trim() !== "")
    .toSorted((left, right) => left.start - right.start);
  if (tokens.length < count) return null;
  const output: { start: number; end: number }[] = [];
  for (let index = 0; index < count; index += 1) {
    const from = Math.floor((tokens.length * index) / count);
    const to = Math.max(
      from,
      Math.ceil((tokens.length * (index + 1)) / count) - 1,
    );
    const first = tokens[from];
    const last = tokens[to];
    if (first === undefined || last === undefined) return null;
    output.push({ start: first.start, end: last.end });
  }
  return output.every(
    (interval, index) =>
      interval.end > interval.start &&
      (index === 0 || interval.start >= (output[index - 1]?.end ?? 0)),
  )
    ? output
    : null;
}

function pauseIntervals(
  cue: SubtitleCue,
  count: number,
): { start: number; end: number }[] | null {
  const speech = (cue.timingEvidence?.speechIntervals ?? [])
    .filter((interval) => interval.end > interval.start)
    .toSorted((left, right) => left.start - right.start);
  if (speech.length < count) return null;
  const gaps = Array.from({ length: speech.length - 1 }, (_, index) => ({
    index,
    gap: (speech[index + 1]?.start ?? 0) - (speech[index]?.end ?? 0),
  }))
    .filter((entry) => entry.gap >= 0.1)
    .toSorted((left, right) => right.gap - left.gap)
    .slice(0, count - 1)
    .map((entry) => entry.index)
    .toSorted((left, right) => left - right);
  if (gaps.length !== count - 1) return null;
  const intervals: { start: number; end: number }[] = [];
  let speechStartIndex = 0;
  for (const gapIndex of gaps) {
    const first = speech[speechStartIndex];
    const last = speech[gapIndex];
    const next = speech[gapIndex + 1];
    if (first === undefined || last === undefined || next === undefined) {
      return null;
    }
    intervals.push({
      start: first.start,
      end: Math.min(next.start, last.end + 0.12),
    });
    speechStartIndex = gapIndex + 1;
  }
  const first = speech[speechStartIndex];
  const last = speech.at(-1);
  if (first === undefined || last === undefined) return null;
  intervals.push({ start: first.start, end: last.end });
  return intervals;
}

function speechBoundaryIntervals(
  cue: SubtitleCue,
  count: number,
): { start: number; end: number }[] | null {
  const speech = (cue.timingEvidence?.speechIntervals ?? [])
    .filter((interval) => interval.end > interval.start)
    .toSorted((left, right) => left.start - right.start);
  if (speech.length < count) return null;
  const boundaries = Array.from({ length: count - 1 }, (_, index) => {
    const intervalIndex = Math.floor((speech.length * (index + 1)) / count);
    return speech[intervalIndex]?.start ?? Number.NaN;
  });
  if (
    boundaries.some(
      (boundary, index) =>
        !Number.isFinite(boundary) ||
        boundary <=
          (index === 0 ? cue.start : (boundaries[index - 1] ?? cue.start)) ||
        boundary >= cue.end,
    )
  ) {
    return null;
  }
  const points = [cue.start, ...boundaries, cue.end];
  return Array.from({ length: count }, (_, index) => ({
    start: points[index] ?? cue.start,
    end: points[index + 1] ?? cue.end,
  }));
}

function referenceAnchorIntervals(
  cue: SubtitleCue,
  count: number,
  timeline: ReferenceTimelineArtifact | undefined,
): { start: number; end: number }[] | null {
  if (timeline === undefined || count < 2) return null;
  const cueAnchorIds = new Set(cue.provenance?.referenceAnchorIds ?? []);
  const anchors = timeline.anchors
    .filter(
      (anchor) =>
        cueAnchorIds.has(anchor.id) &&
        anchor.timingTrusted &&
        anchor.interval.start < cue.end &&
        anchor.interval.end > cue.start,
    )
    .toSorted(
      (left, right) =>
        left.interval.start - right.interval.start ||
        left.interval.end - right.interval.end,
    );
  if (anchors.length < count) return null;
  const boundaries = Array.from({ length: count - 1 }, (_, index) => {
    const anchorIndex = Math.floor((anchors.length * (index + 1)) / count);
    return anchors[anchorIndex]?.interval.start ?? Number.NaN;
  });
  if (
    boundaries.some(
      (boundary, index) =>
        !Number.isFinite(boundary) ||
        boundary <=
          (index === 0 ? cue.start : (boundaries[index - 1] ?? cue.start)) ||
        boundary >= cue.end,
    )
  ) {
    return null;
  }
  const points = [cue.start, ...boundaries, cue.end];
  return Array.from({ length: count }, (_, index) => ({
    start: points[index] ?? cue.start,
    end: points[index + 1] ?? cue.end,
  }));
}

function semanticBoundaryIntervals(
  cue: SubtitleCue,
  chunks: readonly string[],
  preferredBoundaries: ReadonlySet<number>,
): { start: number; end: number }[] | null {
  let cumulativeLength = 0;
  const supportedBoundaries = chunks.slice(0, -1).every((chunk) => {
    cumulativeLength += visibleLength(chunk);
    return (
      NATURAL_BOUNDARY.test(chunk) || preferredBoundaries.has(cumulativeLength)
    );
  });
  if (
    chunks.length < 2 ||
    cue.timingEvidence?.sourceTrusted === true ||
    !supportedBoundaries
  ) {
    return null;
  }
  const speechStart = cue.timingEvidence?.speechStart;
  const speechEnd = cue.timingEvidence?.speechEnd;
  if (
    speechStart === null ||
    speechStart === undefined ||
    speechEnd === null ||
    speechEnd === undefined
  ) {
    return null;
  }
  const start = Math.max(cue.start, speechStart);
  const end = Math.min(cue.end, speechEnd);
  if (end <= start || (end - start) / chunks.length < 1) return null;
  return Array.from({ length: chunks.length }, (_, index) => ({
    start: start + ((end - start) * index) / chunks.length,
    end:
      index === chunks.length - 1
        ? end
        : start + ((end - start) * (index + 1)) / chunks.length,
  }));
}

function clampIntervalsToCue(
  cue: SubtitleCue,
  intervals: readonly { start: number; end: number }[],
): { start: number; end: number }[] | null {
  const clamped = intervals.map((interval) => ({
    start: Math.max(cue.start, interval.start),
    end: Math.min(cue.end, interval.end),
  }));
  return clamped.every(
    (interval, index) =>
      interval.end > interval.start &&
      (index === 0 || interval.start >= (clamped[index - 1]?.end ?? cue.start)),
  )
    ? clamped
    : null;
}

function splitCue(
  cue: SubtitleCue,
  chunks: readonly string[],
  intervals: readonly { start: number; end: number }[],
  method:
    | "token"
    | "pause"
    | "speech-interval"
    | "reference-anchor"
    | "japanese-semantic",
): SubtitleCue[] {
  return chunks.map((text, index) => {
    const interval = intervals[index];
    if (interval === undefined) throw new RangeError("Missing split interval.");
    return {
      ...cue,
      id: `${cue.id}-semantic-${String(index + 1).padStart(2, "0")}`,
      start: Math.max(cue.start, interval.start),
      end: Math.min(cue.end, interval.end),
      text,
      timingEvidence: cue.timingEvidence
        ? {
            ...cue.timingEvidence,
            speechStart: interval.start,
            speechEnd: interval.end,
            tokenTimestampsUsed: method === "token",
            alignmentSource:
              method === "token"
                ? "token"
                : method === "pause"
                  ? "pause"
                  : method === "speech-interval"
                    ? "speech"
                    : "semantic",
            presentationTimingMethod:
              method === "token"
                ? "token"
                : method === "pause"
                  ? "pause"
                  : method === "speech-interval"
                    ? "speech-boundary"
                    : "semantic",
          }
        : undefined,
      ...(method === "japanese-semantic" && cue.textAudit !== undefined
        ? {
            textAudit: {
              ...cue.textAudit,
              reviewRecommended: true,
              reviewReasons: [
                ...new Set([
                  ...cue.textAudit.reviewReasons,
                  "SEMANTIC_BOUNDARY_NOT_SPEECH_ALIGNED",
                ]),
              ],
            },
          }
        : {}),
    };
  });
}

export function buildAcousticSemanticCueSegments(
  inputCues: readonly SubtitleCue[],
  options: AcousticSemanticSegmentationOptions = {},
): AcousticSemanticSegmentationResult {
  const mode = options.mode ?? "acoustic-semantic";
  const analyzer = createJapaneseTextAnalyzer(
    options.japaneseTextAnalyzer ?? "auto",
  );
  const maximumLines = options.maximumLines ?? 2;
  const maximumCharactersPerLine = options.maximumCharactersPerLine ?? 16;
  const capacity = maximumLines * maximumCharactersPerLine;
  const maximumCueDurationSeconds = options.maximumCueDurationSeconds ?? 7;
  const maximumCharactersPerSecond = options.maximumCharactersPerSecond ?? 12;
  const maximumMergeGapSeconds = options.maximumMergeGapSeconds ?? 0.4;
  const inputHash = artifactHash(inputCues);
  const generatedAt = new Date().toISOString();
  const sorted = inputCues
    .map((cue) => {
      const timingAlignedCue = expandToReliableTokenEvidence(cue);
      const text = normalizeTypography(timingAlignedCue.text, cue.language);
      if (text === timingAlignedCue.text) return timingAlignedCue;
      return {
        ...timingAlignedCue,
        text,
        ...(timingAlignedCue.textAudit === undefined
          ? {}
          : {
              textAudit: {
                ...timingAlignedCue.textAudit,
                repairedText: text,
                normalizedText: text,
                deduplicationActions: [
                  ...timingAlignedCue.textAudit.deduplicationActions,
                  "japanese-interword-spacing-normalized-before-segmentation",
                ],
              },
            }),
      };
    })
    .toSorted(
      (left, right) => left.start - right.start || left.end - right.end,
    );
  const merged: {
    cue: SubtitleCue;
    sourceCueIds: string[];
    merged: boolean;
  }[] = [];
  for (const cue of sorted) {
    const previous = merged.at(-1);
    if (previous === undefined || mode === "legacy") {
      merged.push({ cue, sourceCueIds: [cue.id], merged: false });
      continue;
    }
    const boundary = analyzer.analyzeBoundary(previous.cue.text, cue.text);
    if (
      canMerge(
        previous.cue,
        cue,
        maximumMergeGapSeconds,
        boundary.boundarySplitsWord &&
          boundary.confidence >= 0.8 &&
          analyzer.analyze(previous.cue.text).sentenceEndingConfidence < 0.8,
      )
    ) {
      previous.cue = mergeCues([previous.cue, cue]);
      previous.sourceCueIds.push(cue.id);
      previous.merged = true;
    } else {
      merged.push({ cue, sourceCueIds: [cue.id], merged: false });
    }
  }

  const output: SubtitleCue[] = [];
  const entries: CueSegmentationPlanArtifact["entries"] = [];
  const unresolvedIntervals: AcousticSemanticSegmentationResult["unresolvedIntervals"] =
    [];
  for (const item of merged) {
    const cue = item.cue;
    const tooLong =
      visibleLength(cue.text) > capacity ||
      cue.end - cue.start > maximumCueDurationSeconds ||
      visibleLength(cue.text) / Math.max(0.001, cue.end - cue.start) >
        maximumCharactersPerSecond;
    if (!tooLong || mode === "legacy") {
      output.push(cue);
      entries.push({
        id: `seg-${cue.id}`,
        sourceCueIds: item.sourceCueIds,
        outputCueIds: [cue.id],
        originalInterval: { start: cue.start, end: cue.end },
        outputIntervals: [{ start: cue.start, end: cue.end }],
        decision: item.merged ? "merged" : "preserved",
        method: item.merged ? "japanese-semantic" : "preserved",
        characterRatioFallback: false,
        reasons: item.merged
          ? ["adjacent-cues-formed-incomplete-japanese-boundary"]
          : ["cue-within-acoustic-semantic-limits"],
      });
      continue;
    }
    const preferredBoundaries = recordedAsrBreakOffsets(cue);
    const chunks = semanticChunks(
      cue.text,
      capacity,
      maximumCharactersPerLine,
      preferredBoundaries,
    );
    const tokenTiming =
      chunks.length > 1 ? tokenIntervals(cue, chunks.length) : null;
    const pauseTiming =
      chunks.length > 1 && mode === "acoustic-semantic"
        ? pauseIntervals(cue, chunks.length)
        : null;
    const speechTiming =
      chunks.length > 1 && mode === "acoustic-semantic"
        ? speechBoundaryIntervals(cue, chunks.length)
        : null;
    const referenceTiming =
      chunks.length > 1
        ? referenceAnchorIntervals(
            cue,
            chunks.length,
            options.referenceTimeline,
          )
        : null;
    const semanticTiming =
      chunks.length > 1 && mode === "acoustic-semantic"
        ? semanticBoundaryIntervals(cue, chunks, preferredBoundaries)
        : null;
    const splitMethod =
      tokenTiming !== null
        ? ("token" as const)
        : speechTiming !== null
          ? ("speech-interval" as const)
          : pauseTiming !== null
            ? ("pause" as const)
            : referenceTiming !== null
              ? ("reference-anchor" as const)
              : semanticTiming !== null
                ? ("japanese-semantic" as const)
                : null;
    const rawIntervals =
      tokenTiming ??
      speechTiming ??
      pauseTiming ??
      referenceTiming ??
      semanticTiming;
    const intervals =
      rawIntervals === null ? null : clampIntervalsToCue(cue, rawIntervals);
    if (chunks.length <= 1 || intervals === null) {
      output.push(cue);
      const reasons = [
        "SEGMENTATION_UNRESOLVED",
        chunks.length <= 1
          ? "no-high-confidence-japanese-semantic-boundary"
          : "no-token-pause-reference-anchor-or-semantic-timing-for-boundary",
        `semantic-chunk-count:${String(chunks.length)}`,
        `semantic-chunk-lengths:${chunks.map(visibleLength).join(",")}`,
        `recorded-asr-break-offsets:${[...preferredBoundaries].join(",") || "none"}`,
      ];
      entries.push({
        id: `seg-${cue.id}`,
        sourceCueIds: item.sourceCueIds,
        outputCueIds: [cue.id],
        originalInterval: { start: cue.start, end: cue.end },
        outputIntervals: [{ start: cue.start, end: cue.end }],
        decision: "unresolved",
        method: "preserved",
        characterRatioFallback: false,
        reasons,
      });
      unresolvedIntervals.push({
        start: cue.start,
        end: cue.end,
        cueIds: [cue.id],
        reasons,
      });
      continue;
    }
    if (splitMethod === null) {
      throw new Error("Resolved intervals require a recorded split method.");
    }
    const split = splitCue(cue, chunks, intervals, splitMethod);
    output.push(...split);
    entries.push({
      id: `seg-${cue.id}`,
      sourceCueIds: item.sourceCueIds,
      outputCueIds: split.map((candidate) => candidate.id),
      originalInterval: { start: cue.start, end: cue.end },
      outputIntervals: split.map((candidate) => ({
        start: candidate.start,
        end: candidate.end,
      })),
      decision: "split",
      method: splitMethod,
      characterRatioFallback: false,
      reasons: [
        splitMethod === "reference-anchor"
          ? "natural-japanese-boundary-with-trusted-reference-anchor-timing"
          : splitMethod === "japanese-semantic"
            ? "natural-japanese-boundary-with-outer-speech-timing-review-required"
            : "natural-japanese-boundary-with-acoustic-timing",
      ],
    });
  }

  const cues = output.toSorted(
    (left, right) => left.start - right.start || left.end - right.end,
  );
  const analysisCues = cues.map((cue, index) => ({
    cueId: cue.id,
    sourceCueIds: sourceIds(cue),
    analysis: analyzer.analyze(cue.text),
    previousBoundary:
      index === 0
        ? null
        : analyzer.analyzeBoundary(cues[index - 1]?.text ?? "", cue.text),
    nextBoundary:
      index === cues.length - 1
        ? null
        : analyzer.analyzeBoundary(cue.text, cues[index + 1]?.text ?? ""),
  }));
  const plan = cueSegmentationPlanArtifactSchema.parse({
    schemaVersion: "1.0.0",
    generatedAt,
    inputHash,
    configuration: {
      mode,
      maximumLines,
      maximumCharactersPerLine,
      maximumCueDurationSeconds,
      maximumCharactersPerSecond,
      allowCharacterRatioFallback: mode === "legacy",
    },
    entries,
    summary: {
      inputCueCount: inputCues.length,
      outputCueCount: cues.length,
      mergedCueCount: entries.filter((entry) => entry.decision === "merged")
        .length,
      splitCueCount: entries.filter((entry) => entry.decision === "split")
        .length,
      unresolvedCueCount: entries.filter(
        (entry) => entry.decision === "unresolved",
      ).length,
      characterFallbackSegmentationCount: 0,
    },
    fallback: null,
  });
  const japaneseTextAnalysis = japaneseTextAnalysisArtifactSchema.parse({
    schemaVersion: "1.0.0",
    generatedAt,
    inputHash: artifactHash(cues),
    configuration: {
      analyzer: analyzer.mode,
      locale: "ja",
      implementation: analyzer.implementation,
    },
    cues: analysisCues,
    fallback: null,
  });
  return { cues, plan, japaneseTextAnalysis, unresolvedIntervals };
}
