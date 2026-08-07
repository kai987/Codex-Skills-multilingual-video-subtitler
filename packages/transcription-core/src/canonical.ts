import {
  DEFAULT_TIMING_QA_CONFIG,
  detectTextLanguage,
  subtitleCueSchema,
  type LanguageTag,
  type SubtitleCue,
  type TimingQaConfig,
} from "@mvl/shared";

import type {
  TranscriptionChunkResult,
  TranscriptionSegment,
} from "./types.js";
import { detectHypothesisHallucination } from "./quality.js";
import {
  analyzeRepetitionWindow,
  detectCrossCueRepetitionWindows,
  isHighContainmentRepetition,
  type RepetitionEvidence,
} from "./repetition.js";

export type AsrSourceAdapter = "whisper-cli" | "whisper-server" | "openai";

export interface CanonicalAsrToken {
  text: string;
  start: number;
  end: number;
  probability?: number | null | undefined;
}

export interface RawAsrSegmentEvidence {
  id: string;
  start: number;
  end: number;
  text: string;
  sourceAdapter: AsrSourceAdapter;
  chunkId?: string | undefined;
  speaker?: string | null | undefined;
  language?: LanguageTag | undefined;
  confidence?: number | null | undefined;
  averageLogProbability?: number | null | undefined;
  noSpeechProbability?: number | null | undefined;
  tokens?: readonly CanonicalAsrToken[] | undefined;
  style?: "dialogue" | "music" | "thought" | undefined;
}

export interface CanonicalAsrUtterance {
  id: string;
  start: number;
  end: number;
  text: string;
  sourceAdapter: AsrSourceAdapter;
  sourceSegmentIds: string[];
  chunkId?: string | undefined;
  speechIslandId?: string | undefined;
  language?: LanguageTag | undefined;
  speaker?: string | null | undefined;
  confidence?: number | null | undefined;
  averageLogProbability?: number | null | undefined;
  noSpeechProbability?: number | null | undefined;
  tokenTimestampsAvailable?: boolean | undefined;
  tokens?: CanonicalAsrToken[] | undefined;
  canonicalization: {
    operation: "preserved" | "merged" | "split";
    reasons: string[];
  };
  qualityStatus?: "accepted" | "suspected-hallucination" | undefined;
  qualityReasons?: string[] | undefined;
  repetitionEvidence?: RepetitionEvidence | undefined;
}

export interface CanonicalSegmentationConfig {
  mergeGapSeconds: number;
  tokenPauseSeconds: number;
  acousticPauseSeconds: number;
  maximumUtteranceSeconds: number;
  maximumUtteranceCharacters: number;
}

export const DEFAULT_CANONICAL_SEGMENTATION_CONFIG: Readonly<CanonicalSegmentationConfig> =
  {
    mergeGapSeconds: 0.75,
    tokenPauseSeconds: 0.45,
    acousticPauseSeconds: 0.75,
    maximumUtteranceSeconds:
      DEFAULT_TIMING_QA_CONFIG.longDurationHighRiskSeconds,
    maximumUtteranceCharacters: 64,
  };

interface Interval {
  start: number;
  end: number;
}

interface SplitPiece extends RawAsrSegmentEvidence {
  splitReason: string | null;
}

function overlaps(left: Interval, right: Interval): boolean {
  return left.start < right.end && right.start < left.end;
}

function visibleCharacters(text: string): number {
  return Array.from(text.replace(/\s/gu, "")).length;
}

function terminal(text: string): boolean {
  return /[。．.!?！？…]\s*$/u.test(text);
}

function languageCompatible(
  left: LanguageTag | undefined,
  right: LanguageTag | undefined,
): boolean {
  if (
    left === undefined ||
    right === undefined ||
    left === "und" ||
    right === "und"
  ) {
    return true;
  }
  if (left === right) return true;
  return left.startsWith("zh") && right.startsWith("zh");
}

function sceneBoundaryBetween(
  left: Interval,
  right: Interval,
  boundaries: readonly number[],
): boolean {
  return boundaries.some(
    (boundary) => boundary > left.end && boundary < right.start,
  );
}

function speechIslandId(
  interval: Interval,
  speechIntervals: readonly Interval[],
): string | undefined {
  const index = speechIntervals.findIndex((speech) =>
    overlaps(speech, interval),
  );
  return index < 0
    ? undefined
    : `speech-island-${String(index + 1).padStart(4, "0")}`;
}

function splitTextAt(text: string, index: number): [string, string] | null {
  const characters = Array.from(text);
  const bounded = Math.max(1, Math.min(characters.length - 1, index));
  const left = characters.slice(0, bounded).join("");
  const right = characters.slice(bounded).join("");
  return left.trim() === "" || right.trim() === "" ? null : [left, right];
}

function nearestTextBoundary(
  text: string,
  preferredIndex: number,
): { index: number; reason: string } | null {
  const characters = Array.from(text);
  const candidates = characters.flatMap((character, index) =>
    /[。．.!?！？…、,，\s]/u.test(character) &&
    index > 0 &&
    index < characters.length - 1
      ? [{ index: index + 1, distance: Math.abs(index + 1 - preferredIndex) }]
      : [],
  );
  const selected = candidates.toSorted(
    (left, right) => left.distance - right.distance || left.index - right.index,
  )[0];
  return selected === undefined
    ? null
    : { index: selected.index, reason: "punctuation-semantic-boundary" };
}

function nearestTemporalBoundary(input: {
  segment: RawAsrSegmentEvidence;
  preferredTime: number;
  speechIntervals: readonly Interval[];
  sceneBoundaries: readonly number[];
  config: CanonicalSegmentationConfig;
}): { time: number; reason: string } | null {
  const tokenCandidates = (input.segment.tokens ?? []).flatMap(
    (token, index, tokens) => {
      const next = tokens[index + 1];
      if (next === undefined) return [];
      const pause = next.start - token.end;
      const punctuation = /[。．.!?！？…、,，]\s*$/u.test(token.text);
      return pause >= input.config.tokenPauseSeconds || punctuation
        ? [
            {
              time: (token.end + next.start) / 2,
              reason:
                pause >= input.config.tokenPauseSeconds
                  ? "token-timestamp-pause"
                  : "token-timestamp-punctuation",
              priority: 1,
            },
          ]
        : [];
    },
  );
  const acousticCandidates = input.speechIntervals.flatMap(
    (speech, index, intervals) => {
      const next = intervals[index + 1];
      if (
        next === undefined ||
        speech.end <= input.segment.start ||
        next.start >= input.segment.end
      ) {
        return [];
      }
      const pause = next.start - speech.end;
      return pause >= input.config.acousticPauseSeconds
        ? [
            {
              time: (speech.end + next.start) / 2,
              reason: "acoustic-pause",
              priority: 2,
            },
          ]
        : [
            {
              time: speech.end,
              reason: "vad-speech-island-boundary",
              priority: 3,
            },
          ];
    },
  );
  const sceneCandidates = input.sceneBoundaries.flatMap((boundary) =>
    boundary > input.segment.start && boundary < input.segment.end
      ? [{ time: boundary, reason: "scene-boundary", priority: 2 }]
      : [],
  );
  const selected = [
    ...tokenCandidates,
    ...acousticCandidates,
    ...sceneCandidates,
  ]
    .filter(
      (candidate) =>
        candidate.time > input.segment.start &&
        candidate.time < input.segment.end,
    )
    .toSorted(
      (left, right) =>
        left.priority - right.priority ||
        Math.abs(left.time - input.preferredTime) -
          Math.abs(right.time - input.preferredTime) ||
        left.time - right.time,
    )[0];
  return selected === undefined
    ? null
    : { time: selected.time, reason: selected.reason };
}

function splitOnce(input: {
  segment: RawAsrSegmentEvidence;
  speechIntervals: readonly Interval[];
  sceneBoundaries: readonly number[];
  config: CanonicalSegmentationConfig;
}): [SplitPiece, SplitPiece] | null {
  const duration = input.segment.end - input.segment.start;
  const characters = Array.from(input.segment.text);
  if (
    duration <= input.config.maximumUtteranceSeconds &&
    visibleCharacters(input.segment.text) <=
      input.config.maximumUtteranceCharacters
  ) {
    return null;
  }
  const preferredTime =
    input.segment.start +
    Math.min(
      input.config.maximumUtteranceSeconds,
      Math.max(0.001, duration / 2),
    );
  const temporal = nearestTemporalBoundary({
    ...input,
    preferredTime,
  });
  const splitTime =
    temporal?.time ??
    Math.min(
      input.segment.end - 0.001,
      Math.max(input.segment.start + 0.001, preferredTime),
    );
  const preferredIndex = Math.round(
    characters.length *
      ((splitTime - input.segment.start) /
        Math.max(0.001, input.segment.end - input.segment.start)),
  );
  const textBoundary =
    temporal === null
      ? nearestTextBoundary(input.segment.text, preferredIndex)
      : null;
  const textSplit =
    splitTextAt(input.segment.text, textBoundary?.index ?? preferredIndex) ??
    splitTextAt(input.segment.text, Math.floor(characters.length / 2));
  if (textSplit === null) return null;
  const reason =
    temporal?.reason ?? textBoundary?.reason ?? "bounded-proportional-fallback";
  const splitRatio =
    Array.from(textSplit[0]).length / Math.max(1, characters.length);
  const resolvedTime =
    temporal?.time ??
    input.segment.start +
      (input.segment.end - input.segment.start) * splitRatio;
  const leftTokens = (input.segment.tokens ?? []).filter(
    (token) => token.end <= resolvedTime,
  );
  const rightTokens = (input.segment.tokens ?? []).filter(
    (token) => token.start >= resolvedTime,
  );
  const common = {
    ...input.segment,
    tokens: undefined,
    splitReason: reason,
  };
  return [
    {
      ...common,
      end: resolvedTime,
      text: textSplit[0],
      ...(leftTokens.length === 0 ? {} : { tokens: leftTokens }),
    },
    {
      ...common,
      start: resolvedTime,
      text: textSplit[1],
      ...(rightTokens.length === 0 ? {} : { tokens: rightTokens }),
    },
  ];
}

function splitRawSegment(input: {
  segment: RawAsrSegmentEvidence;
  speechIntervals: readonly Interval[];
  sceneBoundaries: readonly number[];
  config: CanonicalSegmentationConfig;
}): SplitPiece[] {
  const pending: SplitPiece[] = [{ ...input.segment, splitReason: null }];
  const output: SplitPiece[] = [];
  while (pending.length > 0) {
    const current = pending.shift();
    if (current === undefined) break;
    const split = splitOnce({
      segment: current,
      speechIntervals: input.speechIntervals,
      sceneBoundaries: input.sceneBoundaries,
      config: input.config,
    });
    if (split === null) output.push(current);
    else pending.unshift(...split);
  }
  return output;
}

function joinTexts(left: string, right: string): string {
  if (left === "" || right === "") return `${left}${right}`;
  const needsSpace = /[A-Za-z0-9]$/u.test(left) && /^[A-Za-z0-9]/u.test(right);
  return `${left}${needsSpace ? " " : ""}${right}`;
}

function weightedMetric(
  pieces: readonly SplitPiece[],
  read: (piece: SplitPiece) => number | null | undefined,
): number | null | undefined {
  const values = pieces.flatMap((piece) => {
    const value = read(piece);
    return value === null || value === undefined
      ? []
      : [
          {
            value,
            weight: Math.max(0.001, piece.end - piece.start),
          },
        ];
  });
  if (values.length === 0) return undefined;
  const weight = values.reduce((sum, item) => sum + item.weight, 0);
  return (
    values.reduce((sum, item) => sum + item.value * item.weight, 0) / weight
  );
}

function canMerge(input: {
  current: readonly SplitPiece[];
  next: SplitPiece;
  speechIntervals: readonly Interval[];
  sceneBoundaries: readonly number[];
  config: CanonicalSegmentationConfig;
}): boolean {
  const first = input.current[0];
  const previous = input.current.at(-1);
  if (first === undefined || previous === undefined) return false;
  const gap = input.next.start - previous.end;
  const combinedText = input.current
    .map((piece) => piece.text)
    .reduce(joinTexts, "");
  const nextText = joinTexts(combinedText, input.next.text);
  const currentIsland = speechIslandId(previous, input.speechIntervals);
  const nextIsland = speechIslandId(input.next, input.speechIntervals);
  return (
    gap >= -0.05 &&
    gap <= input.config.mergeGapSeconds &&
    first.sourceAdapter === input.next.sourceAdapter &&
    first.chunkId === input.next.chunkId &&
    (previous.style === "music" ||
      !isHighContainmentRepetition(combinedText, input.next.text)) &&
    !terminal(previous.text) &&
    !sceneBoundaryBetween(previous, input.next, input.sceneBoundaries) &&
    (currentIsland === undefined ||
      nextIsland === undefined ||
      currentIsland === nextIsland) &&
    languageCompatible(previous.language, input.next.language) &&
    (previous.speaker === null ||
      previous.speaker === undefined ||
      input.next.speaker === null ||
      input.next.speaker === undefined ||
      previous.speaker === input.next.speaker) &&
    previous.style === input.next.style &&
    input.next.end - first.start <= input.config.maximumUtteranceSeconds &&
    visibleCharacters(nextText) <= input.config.maximumUtteranceCharacters
  );
}

export function evaluateCanonicalUtteranceQuality(input: {
  utterances: readonly CanonicalAsrUtterance[];
  rawSegments?: readonly RawAsrSegmentEvidence[] | undefined;
}): CanonicalAsrUtterance[] {
  const rawById = new Map(
    (input.rawSegments ?? []).map((segment) => [segment.id, segment] as const),
  );
  const crossUtterance = detectCrossCueRepetitionWindows({
    cues: input.utterances,
    minimumCoreLength: 8,
    minimumOccurrences: 3,
    maximumWindowCues: 6,
    maximumWindowSeconds: 20,
  });
  return input.utterances.map((utterance) => {
    const sourceSegments = utterance.sourceSegmentIds.flatMap((id) => {
      const segment = rawById.get(id);
      return segment === undefined ? [] : [segment];
    });
    const sourceEvidence =
      sourceSegments.length < 2
        ? null
        : analyzeRepetitionWindow(sourceSegments, 8);
    const crossEvidence = crossUtterance
      .filter((finding) => finding.cueIds.includes(utterance.id))
      .toSorted(
        (left, right) =>
          right.evidence.occurrences - left.evidence.occurrences ||
          right.evidence.normalizedCorePhrase.length -
            left.evidence.normalizedCorePhrase.length,
      )[0]?.evidence;
    const self = detectHypothesisHallucination({ text: utterance.text });
    const repetitionEvidence =
      crossEvidence ??
      (sourceEvidence !== null && sourceEvidence.occurrences >= 3
        ? sourceEvidence
        : undefined);
    const sourceContainmentChain = sourceSegments.some((segment, index) => {
      const next = sourceSegments[index + 1];
      return (
        next !== undefined &&
        isHighContainmentRepetition(segment.text, next.text)
      );
    });
    const suspected =
      self.repetitionHallucination ||
      repetitionEvidence !== undefined ||
      sourceContainmentChain;
    if (!suspected) {
      return {
        ...utterance,
        qualityStatus: "accepted" as const,
        qualityReasons: [],
      };
    }
    const fallbackEvidence =
      repetitionEvidence ??
      (sourceSegments.length >= 2
        ? (analyzeRepetitionWindow(sourceSegments, 8) ?? undefined)
        : undefined);
    return {
      ...utterance,
      qualityStatus: "suspected-hallucination" as const,
      qualityReasons: [
        ...(self.signals.includes("LONG_PHRASE_LOOP")
          ? ["LONG_PHRASE_LOOP"]
          : []),
        ...(sourceContainmentChain
          ? ["CANONICAL_SOURCE_CONTAINMENT_LOOP"]
          : []),
        ...(crossEvidence === undefined
          ? []
          : ["CANONICAL_CROSS_UTTERANCE_LOOP"]),
        "CANONICAL_HALLUCINATION_QA_FAILED",
      ],
      ...(fallbackEvidence === undefined
        ? {}
        : { repetitionEvidence: fallbackEvidence }),
    };
  });
}

export function canonicalizeAsrSegments(input: {
  segments: readonly RawAsrSegmentEvidence[];
  speechIntervals?: readonly Interval[] | undefined;
  sceneBoundaries?: readonly number[] | undefined;
  config?: Partial<CanonicalSegmentationConfig> | undefined;
  timingConfig?: Partial<TimingQaConfig> | undefined;
}): CanonicalAsrUtterance[] {
  const speechIntervals = (input.speechIntervals ?? []).toSorted(
    (left, right) => left.start - right.start || left.end - right.end,
  );
  const sceneBoundaries = [...(input.sceneBoundaries ?? [])].toSorted(
    (left, right) => left - right,
  );
  const config: CanonicalSegmentationConfig = {
    ...DEFAULT_CANONICAL_SEGMENTATION_CONFIG,
    ...(input.timingConfig?.longDurationHighRiskSeconds === undefined
      ? {}
      : {
          maximumUtteranceSeconds:
            input.timingConfig.longDurationHighRiskSeconds,
        }),
    ...input.config,
  };
  const split = input.segments
    .filter(
      (segment) =>
        segment.text.trim() !== "" &&
        Number.isFinite(segment.start) &&
        Number.isFinite(segment.end) &&
        segment.end > segment.start,
    )
    .toSorted(
      (left, right) =>
        left.start - right.start ||
        left.end - right.end ||
        left.id.localeCompare(right.id),
    )
    .flatMap((segment) =>
      splitRawSegment({
        segment,
        speechIntervals,
        sceneBoundaries,
        config,
      }),
    );
  const groups: SplitPiece[][] = [];
  for (const piece of split) {
    const current = groups.at(-1);
    if (
      current !== undefined &&
      canMerge({
        current,
        next: piece,
        speechIntervals,
        sceneBoundaries,
        config,
      })
    ) {
      current.push(piece);
    } else {
      groups.push([piece]);
    }
  }
  const utterances = groups.flatMap((pieces, index) => {
    const first = pieces[0];
    const last = pieces.at(-1);
    if (first === undefined || last === undefined) return [];
    const detected = detectTextLanguage(
      pieces.map((piece) => piece.text).reduce(joinTexts, ""),
    );
    const splitReasons = [
      ...new Set(
        pieces.flatMap((piece) =>
          piece.splitReason === null ? [] : [piece.splitReason],
        ),
      ),
    ];
    const operation =
      pieces.length > 1
        ? ("merged" as const)
        : splitReasons.length > 0
          ? ("split" as const)
          : ("preserved" as const);
    const reasons =
      operation === "merged"
        ? [
            "adjacent-compatible-segments",
            ...(speechIslandId(first, speechIntervals) === undefined
              ? []
              : ["same-speech-island"]),
          ]
        : operation === "split"
          ? splitReasons
          : ["adapter-segment-within-canonical-bounds"];
    const tokens = pieces.flatMap((piece) => piece.tokens ?? []);
    const confidence = weightedMetric(pieces, (piece) => piece.confidence);
    const averageLogProbability = weightedMetric(
      pieces,
      (piece) => piece.averageLogProbability,
    );
    const noSpeechProbability = weightedMetric(
      pieces,
      (piece) => piece.noSpeechProbability,
    );
    return [
      {
        id: `canonical-${String(index + 1).padStart(5, "0")}`,
        start: first.start,
        end: last.end,
        text: pieces.map((piece) => piece.text).reduce(joinTexts, ""),
        sourceAdapter: first.sourceAdapter,
        sourceSegmentIds: [...new Set(pieces.map((piece) => piece.id))],
        ...(first.chunkId === undefined ? {} : { chunkId: first.chunkId }),
        ...(speechIslandId(
          { start: first.start, end: last.end },
          speechIntervals,
        ) === undefined
          ? {}
          : {
              speechIslandId: speechIslandId(
                { start: first.start, end: last.end },
                speechIntervals,
              ),
            }),
        language:
          first.language === undefined || first.language === "und"
            ? detected.language
            : first.language,
        speaker: pieces.every((piece) => piece.speaker === first.speaker)
          ? (first.speaker ?? null)
          : null,
        ...(confidence === undefined ? {} : { confidence }),
        ...(averageLogProbability === undefined
          ? {}
          : { averageLogProbability }),
        ...(noSpeechProbability === undefined ? {} : { noSpeechProbability }),
        tokenTimestampsAvailable: tokens.length > 0,
        ...(tokens.length === 0 ? {} : { tokens }),
        canonicalization: { operation, reasons },
      },
    ];
  });
  return evaluateCanonicalUtteranceQuality({
    utterances,
    rawSegments: input.segments,
  });
}

export function sourceAdapterForResult(
  adapterId: string,
  result: TranscriptionChunkResult,
): AsrSourceAdapter {
  if (adapterId === "openai") return "openai";
  const raw =
    typeof result.raw === "object" && result.raw !== null
      ? (result.raw as { executionMode?: unknown })
      : null;
  return raw?.executionMode === "persistent" || raw?.executionMode === "batch"
    ? "whisper-server"
    : "whisper-cli";
}

export function rawEvidenceFromResult(input: {
  result: TranscriptionChunkResult;
  adapterId: string;
  chunkId: string;
  globalStart: number;
  language?: LanguageTag | undefined;
}): RawAsrSegmentEvidence[] {
  const sourceAdapter = sourceAdapterForResult(input.adapterId, input.result);
  return input.result.segments.map((segment, index) =>
    rawEvidenceFromSegment({
      segment,
      id: `${input.chunkId}-raw-${String(index + 1).padStart(4, "0")}`,
      chunkId: input.chunkId,
      globalStart: input.globalStart,
      sourceAdapter,
      language: input.language,
    }),
  );
}

export function rawEvidenceFromSegment(input: {
  segment: TranscriptionSegment;
  id: string;
  globalStart: number;
  sourceAdapter: AsrSourceAdapter;
  chunkId?: string | undefined;
  language?: LanguageTag | undefined;
}): RawAsrSegmentEvidence {
  return {
    id: input.id,
    start: input.globalStart + input.segment.start,
    end: input.globalStart + input.segment.end,
    text: input.segment.text,
    sourceAdapter: input.sourceAdapter,
    ...(input.chunkId === undefined ? {} : { chunkId: input.chunkId }),
    speaker: input.segment.speaker,
    language:
      input.segment.metrics?.detectedLanguage ??
      input.language ??
      detectTextLanguage(input.segment.text).language,
    confidence: input.segment.confidence,
    averageLogProbability: input.segment.metrics?.averageLogProbability,
    noSpeechProbability: input.segment.metrics?.noSpeechProbability,
    tokens: (input.segment.tokens ?? []).map((token) => ({
      ...token,
      start: input.globalStart + token.start,
      end: input.globalStart + token.end,
    })),
  };
}

export function canonicalUtterancesToCues(
  utterances: readonly CanonicalAsrUtterance[],
  options: { includeSuspectedHallucinations?: boolean } = {},
): SubtitleCue[] {
  return utterances
    .filter(
      (utterance) =>
        options.includeSuspectedHallucinations === true ||
        utterance.qualityStatus !== "suspected-hallucination",
    )
    .map((utterance) =>
      subtitleCueSchema.parse({
        id: utterance.id,
        start: utterance.start,
        end: utterance.end,
        language: utterance.language ?? "und",
        languages:
          utterance.language === undefined ||
          utterance.language === "und" ||
          utterance.language === "mixed"
            ? detectTextLanguage(utterance.text).languages
            : [utterance.language],
        text: utterance.text.trim(),
        speaker: utterance.speaker ?? null,
        confidence: utterance.confidence ?? null,
        transcriptionMetrics: {
          averageLogProbability: utterance.averageLogProbability ?? null,
          noSpeechProbability: utterance.noSpeechProbability ?? null,
          tokenProbability:
            utterance.tokens === undefined ||
            utterance.tokens.every(
              (token) =>
                token.probability === null || token.probability === undefined,
            )
              ? null
              : utterance.tokens.reduce(
                  (sum, token) => sum + (token.probability ?? 0),
                  0,
                ) /
                utterance.tokens.filter(
                  (token) =>
                    token.probability !== null &&
                    token.probability !== undefined,
                ).length,
          entropy: null,
          decoderFallback: null,
          detectedLanguage: utterance.language ?? null,
        },
        timingEvidence: {
          sourceTrusted: false,
          speechStart: null,
          speechEnd: null,
          tokenTimestampsAvailable: utterance.tokenTimestampsAvailable ?? false,
          tokenTimestampsUsed: (utterance.tokens?.length ?? 0) > 0,
          tokens: utterance.tokens ?? [],
          alignmentSource:
            (utterance.tokens?.length ?? 0) > 0 ? "token" : "segment",
          presentationTimingMethod: null,
          ...(utterance.speechIslandId === undefined
            ? {}
            : {
                speechBoundarySource: "vad" as const,
                speechIntervals: [
                  { start: utterance.start, end: utterance.end },
                ],
              }),
        },
      }),
    );
}
