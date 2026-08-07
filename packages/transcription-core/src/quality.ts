import {
  DEFAULT_TIMING_QA_CONFIG,
  alignDialogueInterval,
  assessTimingAnomaly,
  countVisibleSubtitleCharacters,
  detectTextLanguage,
  hypothesisQualitySchema,
  measureAcousticCoverage,
  transcriptionQualitySchema,
  vadNoVadComparisonSchema,
  type LanguageTag,
  type HypothesisQuality,
  type HypothesisQualitySignal,
  type SubtitleCue,
  type TranscriptionQuality,
  type TranscriptionClassification,
  type TimingQaConfig,
  type VadNoVadComparison,
} from "@mvl/shared";
import {
  detectCrossCueRepetitionWindows,
  detectSingleCueDuplicateLines,
} from "./repetition.js";

const EVALUATOR_VERSION = "multi-signal-timing-v3";
export const DEFAULT_MAX_MERGED_REFINEMENT_SECONDS = 30;
export const HARD_MAX_MERGED_REFINEMENT_SECONDS = 45;
export const DEFAULT_NO_VAD_TIE_BREAK_BONUS = 0.04;

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

function normalizedText(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/方/gu, "ほう")
    .replace(/子供/gu, "子ども")
    .replace(/[\s、。，．,.!?！？…「」『』"'’‘（）()［］[\]{}]/gu, "");
}

export function normalizeHypothesisText(text: string): string {
  return normalizedText(text);
}

export function hasOneEmptyHypothesis(
  vadText: string,
  noVadText: string,
): boolean {
  return (
    (normalizedText(vadText) === "") !== (normalizedText(noVadText) === "")
  );
}

function normalizedUnits(
  text: string,
  cues: readonly SubtitleCue[] = [],
): string[] {
  const cueUnits = cues
    .map((cue) => normalizedText(cue.text))
    .filter((unit) => unit !== "");
  if (cueUnits.length > 1) return cueUnits;
  return text
    .normalize("NFKC")
    .split(/[\r\n。！？!?]+/u)
    .map((unit) => normalizedText(unit))
    .filter((unit) => unit !== "");
}

function maximumConsecutiveRun(units: readonly string[]): number {
  let maximum = 0;
  let current = 0;
  let previous = "";
  for (const unit of units) {
    if (unit === previous) {
      current += 1;
    } else {
      previous = unit;
      current = 1;
    }
    maximum = Math.max(maximum, current);
  }
  return maximum;
}

function countNonOverlappingOccurrences(text: string, phrase: string): number {
  if (phrase === "") return 0;
  let count = 0;
  let offset = 0;
  while (offset <= text.length - phrase.length) {
    const found = text.indexOf(phrase, offset);
    if (found < 0) break;
    count += 1;
    offset = found + phrase.length;
  }
  return count;
}

function longestRepeatedLongPhrase(text: string): {
  characters: number;
  occurrences: number;
} {
  const normalized = normalizedText(text);
  const maximumLength = Math.min(64, Math.floor(normalized.length / 3));
  for (let length = maximumLength; length >= 8; length -= 1) {
    const visited = new Set<string>();
    for (let offset = 0; offset + length <= normalized.length; offset += 1) {
      const phrase = normalized.slice(offset, offset + length);
      if (visited.has(phrase)) continue;
      visited.add(phrase);
      const occurrences = countNonOverlappingOccurrences(normalized, phrase);
      if (occurrences >= 3) return { characters: length, occurrences };
    }
  }
  return { characters: 0, occurrences: 0 };
}

export function detectHypothesisHallucination(input: {
  text: string;
  cues?: readonly SubtitleCue[];
  prompt?: string;
  acousticRepetitionSupported?: boolean;
}): {
  repetitionHallucination: boolean;
  hardHallucination: boolean;
  signals: HypothesisQualitySignal[];
  metrics: HypothesisQuality["metrics"];
} {
  const normalized = normalizedText(input.text);
  const units = normalizedUnits(input.text, input.cues ?? []);
  const counts = new Map<string, number>();
  for (const unit of units) counts.set(unit, (counts.get(unit) ?? 0) + 1);
  const uniqueUnits = [...counts.keys()];
  const repeatedCharacters = units.reduce(
    (total, unit) => total + ((counts.get(unit) ?? 0) > 1 ? unit.length : 0),
    0,
  );
  const allUnitCharacters = units.reduce(
    (total, unit) => total + unit.length,
    0,
  );
  const repeatedTextRatio =
    allUnitCharacters === 0 ? 0 : repeatedCharacters / allUnitCharacters;
  const uniqueSentenceRatio =
    units.length === 0 ? 1 : uniqueUnits.length / units.length;
  const exactSentenceMaxRun = maximumConsecutiveRun(units);
  const repeatedLongPhrase = longestRepeatedLongPhrase(input.text);
  const cueRun = maximumConsecutiveRun(
    (input.cues ?? [])
      .map((cue) => normalizedText(cue.text))
      .filter((unit) => unit !== ""),
  );
  const prompt = normalizedText(input.prompt ?? "");
  const promptEchoCount =
    prompt.length < 4 ? 0 : countNonOverlappingOccurrences(normalized, prompt);
  const signals: HypothesisQualitySignal[] = [];
  if (exactSentenceMaxRun >= 3) signals.push("EXACT_SENTENCE_LOOP");
  if (
    repeatedTextRatio >= 0.75 &&
    units.length >= 5 &&
    allUnitCharacters >= 40
  ) {
    signals.push("EXTREME_REPETITION_RATIO");
  }
  if (
    repeatedLongPhrase.characters >= 8 &&
    repeatedLongPhrase.occurrences >= 3
  ) {
    signals.push("LONG_PHRASE_LOOP");
  }
  if (cueRun >= 3) signals.push("CONSECUTIVE_DUPLICATE_SEGMENTS");
  if (promptEchoCount >= 3) signals.push("PROMPT_ECHO_LOOP");
  if (uniqueSentenceRatio <= 0.3 && units.length >= 5) {
    signals.push("LOW_UNIQUE_CONTENT_RATIO");
  }
  const repetitionHallucination = signals.some((signal) =>
    [
      "EXACT_SENTENCE_LOOP",
      "EXTREME_REPETITION_RATIO",
      "LONG_PHRASE_LOOP",
      "CONSECUTIVE_DUPLICATE_SEGMENTS",
      "PROMPT_ECHO_LOOP",
      "LOW_UNIQUE_CONTENT_RATIO",
    ].includes(signal),
  );
  const acousticOverride = input.acousticRepetitionSupported === true;
  const hardHallucination =
    !acousticOverride &&
    (exactSentenceMaxRun >= 5 ||
      cueRun >= 5 ||
      promptEchoCount >= 5 ||
      (repeatedLongPhrase.occurrences >= 5 &&
        repeatedLongPhrase.characters >= 8) ||
      (repeatedTextRatio >= 0.85 &&
        uniqueSentenceRatio <= 0.25 &&
        units.length >= 5));
  return {
    repetitionHallucination,
    hardHallucination,
    signals: [...new Set(signals)],
    metrics: {
      normalizedCharacters: Array.from(normalized).length,
      sentenceCount: units.length,
      uniqueSentenceRatio,
      repeatedTextRatio,
      exactSentenceMaxRun,
      longestRepeatedPhraseCharacters: repeatedLongPhrase.characters,
      consecutiveDuplicateSegments: cueRun,
      promptEchoCount,
    },
  };
}

export function evaluateHypothesisQuality(input: {
  text: string;
  cues?: readonly SubtitleCue[];
  interval?: Interval;
  detectedSpeech?: boolean;
  expectedLanguages?: readonly LanguageTag[];
  language?: LanguageTag | null;
  prompt?: string;
  acousticRepetitionSupported?: boolean;
}): HypothesisQuality {
  const normalized = normalizedText(input.text);
  const hallucination = detectHypothesisHallucination(input);
  const signals: HypothesisQualitySignal[] = [...hallucination.signals];
  const intervalInvalid =
    input.interval !== undefined &&
    (!Number.isFinite(input.interval.start) ||
      !Number.isFinite(input.interval.end) ||
      input.interval.start < 0 ||
      input.interval.end <= input.interval.start);
  if (normalized === "") signals.push("EMPTY_TEXT");
  if (intervalInvalid) signals.push("INVALID_INTERVAL");
  const duration =
    input.interval === undefined
      ? null
      : input.interval.end - input.interval.start;
  const overmerged =
    duration !== null &&
    duration > HARD_MAX_MERGED_REFINEMENT_SECONDS &&
    (input.cues?.length ?? 0) <= 1 &&
    normalized.length / Math.max(duration, 0.001) < 1;
  if (overmerged) signals.push("OVERMERGED_TIMING");
  const detectedLanguage =
    input.language ??
    (normalized === "" ? null : detectTextLanguage(input.text).language);
  const languageMismatch =
    detectedLanguage !== null &&
    detectedLanguage !== "und" &&
    (input.expectedLanguages?.length ?? 0) > 0 &&
    !(input.expectedLanguages ?? []).some((expected) =>
      sameLanguage(detectedLanguage, expected),
    );
  if (languageMismatch) signals.push("LANGUAGE_MISMATCH");
  const confidences = (input.cues ?? []).flatMap((cue) =>
    cue.confidence === null ? [] : [cue.confidence],
  );
  const lowConfidence =
    confidences.length > 0 &&
    confidences.reduce((total, value) => total + value, 0) /
      confidences.length <
      0.45;
  if (lowConfidence) signals.push("LOW_DECODER_CONFIDENCE");

  let validity: HypothesisQuality["validity"] = "valid";
  let hardReject = false;
  if (normalized === "") {
    validity = "invalid-empty";
    hardReject = true;
  } else if (hallucination.hardHallucination) {
    validity = "invalid-hallucination";
    hardReject = true;
  } else if (intervalInvalid || overmerged) {
    validity = "invalid-timing";
    hardReject = true;
  } else if (languageMismatch) {
    validity = "invalid-language";
    hardReject = true;
  } else if (
    hallucination.repetitionHallucination ||
    lowConfidence ||
    input.detectedSpeech === false
  ) {
    validity = "weak";
  }
  let qualityScore = 100;
  if (normalized === "") qualityScore = 0;
  if (hallucination.hardHallucination) qualityScore = Math.min(qualityScore, 5);
  else if (hallucination.repetitionHallucination) qualityScore -= 35;
  if (intervalInvalid) qualityScore = 0;
  if (overmerged) qualityScore = Math.min(qualityScore, 20);
  if (languageMismatch) qualityScore = Math.min(qualityScore, 20);
  if (lowConfidence) qualityScore -= 15;
  if (input.detectedSpeech === false && normalized !== "") qualityScore -= 10;
  return hypothesisQualitySchema.parse({
    validity,
    qualityScore: Math.max(0, Math.min(100, Math.round(qualityScore))),
    hardReject,
    repetitionHallucination: hallucination.repetitionHallucination,
    signals: [...new Set(signals)],
    metrics: hallucination.metrics,
  });
}

function editDistance(left: string, right: string): number {
  const a = Array.from(normalizedText(left));
  const b = Array.from(normalizedText(right));
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= a.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= b.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        (current[rightIndex - 1] ?? 0) + 1,
        (previous[rightIndex] ?? 0) + 1,
        (previous[rightIndex - 1] ?? 0) +
          (a[leftIndex - 1] === b[rightIndex - 1] ? 0 : 1),
      );
    }
    for (let index = 0; index < current.length; index += 1) {
      previous[index] = current[index] ?? 0;
    }
  }
  return previous[b.length] ?? Math.max(a.length, b.length);
}

function repeatedPhrase(text: string): boolean {
  const normalized = normalizedText(text);
  if (normalized.length < 6) return false;
  for (
    let length = 2;
    length <= Math.min(12, normalized.length / 3);
    length += 1
  ) {
    for (
      let offset = 0;
      offset + length * 3 <= normalized.length;
      offset += 1
    ) {
      const phrase = normalized.slice(offset, offset + length);
      if (
        phrase !== "" &&
        normalized.slice(offset + length, offset + length * 2) === phrase &&
        normalized.slice(offset + length * 2, offset + length * 3) === phrase
      ) {
        return true;
      }
    }
  }
  return false;
}

function repeatedCharacters(text: string): boolean {
  return /(.)\1{4,}/u.test(normalizedText(text));
}

function repeatedAcrossCueIndexes(cues: readonly SubtitleCue[]): Set<number> {
  const repeated = new Set<number>();
  let runStart = 0;
  const markRun = (runEnd: number) => {
    const normalized = normalizedText(cues[runStart]?.text ?? "");
    if (runEnd - runStart >= 4 && normalized.length >= 6) {
      for (let index = runStart; index < runEnd; index += 1) {
        repeated.add(index);
      }
    }
  };
  for (let index = 1; index <= cues.length; index += 1) {
    const previous = cues[index - 1];
    const current = cues[index];
    const continues =
      previous !== undefined &&
      current !== undefined &&
      current.start - previous.end <= 2 &&
      normalizedText(previous.text) === normalizedText(current.text);
    if (continues) continue;
    markRun(index);
    runStart = index;
  }
  return repeated;
}

function hallucinationPattern(text: string): boolean {
  const normalized = text.normalize("NFKC").toLocaleLowerCase();
  return (
    repeatedPhrase(normalized) ||
    /\b(?:subscribe|subtitle by|thanks for watching)\b/iu.test(normalized) ||
    /(?:ご視聴ありがとうございました|チャンネル登録).*(?:ご視聴ありがとうございました|チャンネル登録)/u.test(
      normalized,
    )
  );
}

function similarity(left: string, right: string): number {
  const a = Array.from(normalizedText(left));
  const b = Array.from(normalizedText(right));
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  return 1 - editDistance(left, right) / Math.max(a.length, b.length);
}

function sameLanguage(left: LanguageTag | null, right: LanguageTag | null) {
  if (left === null || right === null || left === "und" || right === "und") {
    return true;
  }
  return (
    left === right ||
    (left.startsWith("zh") && right.startsWith("zh")) ||
    left === "mixed" ||
    right === "mixed"
  );
}

function cueText(cues: readonly SubtitleCue[], interval: Interval): string {
  return cues
    .filter((cue) => overlapSeconds(cue, interval) > 0)
    .map((cue) => cue.text.trim())
    .filter(Boolean)
    .join(" ");
}

function cueCoverage(
  cues: readonly SubtitleCue[],
  interval: Interval,
): Interval | null {
  const matches = cues.filter((cue) => overlapSeconds(cue, interval) > 0);
  if (matches.length === 0) return null;
  return {
    start: Math.max(
      interval.start,
      Math.min(...matches.map((cue) => cue.start)),
    ),
    end: Math.min(interval.end, Math.max(...matches.map((cue) => cue.end))),
  };
}

function intervalHasEvidence(
  interval: Interval,
  evidence: readonly Interval[],
): boolean {
  return evidence.some((candidate) => overlapSeconds(interval, candidate) > 0);
}

export function compareVadNoVadTranscripts(input: {
  vadCues: readonly SubtitleCue[];
  noVadCues: readonly SubtitleCue[];
  vadSpeechIntervals?: readonly Interval[];
  highBackgroundNoise?: boolean;
  highBackgroundNoiseIntervals?: readonly Interval[];
  model: string;
  mergeGapSeconds?: number;
  boundaryDisagreementSeconds?: number | undefined;
}): VadNoVadComparison[] {
  const mergeGapSeconds = input.mergeGapSeconds ?? 0.75;
  const ranges = [...input.vadCues, ...input.noVadCues]
    .map((cue) => ({ start: cue.start, end: cue.end }))
    .toSorted(
      (left, right) => left.start - right.start || left.end - right.end,
    );
  const groups: Interval[] = [];
  for (const range of ranges) {
    const previous = groups.at(-1);
    if (
      previous !== undefined &&
      range.start <= previous.end + mergeGapSeconds
    ) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      groups.push({ ...range });
    }
  }
  return groups.map((interval) => {
    const vadCues = input.vadCues.filter(
      (cue) => overlapSeconds(cue, interval) > 0,
    );
    const noVadCues = input.noVadCues.filter(
      (cue) => overlapSeconds(cue, interval) > 0,
    );
    const vadText = cueText(vadCues, interval);
    const noVadText = cueText(noVadCues, interval);
    const normalizedVad = normalizedText(vadText);
    const normalizedNoVad = normalizedText(noVadText);
    const normalizedSimilarity = similarity(vadText, noVadText);
    const characterEditDistance = editDistance(vadText, noVadText);
    const longestLength = Math.max(
      Array.from(normalizedVad).length,
      Array.from(normalizedNoVad).length,
      1,
    );
    const lengthRatio =
      Math.min(
        Array.from(normalizedVad).length,
        Array.from(normalizedNoVad).length,
      ) / longestLength;
    const vadCoverage = cueCoverage(input.vadCues, interval);
    const noVadCoverage = cueCoverage(input.noVadCues, interval);
    const timingOverlap =
      vadCoverage === null || noVadCoverage === null
        ? null
        : overlapSeconds(vadCoverage, noVadCoverage) /
          Math.max(
            vadCoverage.end - vadCoverage.start,
            noVadCoverage.end - noVadCoverage.start,
            0.001,
          );
    const startDifferenceSeconds =
      vadCoverage === null || noVadCoverage === null
        ? null
        : Math.abs(vadCoverage.start - noVadCoverage.start);
    const endDifferenceSeconds =
      vadCoverage === null || noVadCoverage === null
        ? null
        : Math.abs(vadCoverage.end - noVadCoverage.end);
    const durationDifferenceSeconds =
      vadCoverage === null || noVadCoverage === null
        ? null
        : Math.abs(
            vadCoverage.end -
              vadCoverage.start -
              (noVadCoverage.end - noVadCoverage.start),
          );
    const vadSegmentCount = input.vadCues.filter(
      (cue) => overlapSeconds(cue, interval) > 0,
    ).length;
    const noVadSegmentCount = input.noVadCues.filter(
      (cue) => overlapSeconds(cue, interval) > 0,
    ).length;
    const segmentCountDifference = Math.abs(
      vadSegmentCount - noVadSegmentCount,
    );
    const speechBoundaryDifferenceSeconds =
      startDifferenceSeconds === null || endDifferenceSeconds === null
        ? null
        : Math.max(startDifferenceSeconds, endDifferenceSeconds);
    const boundaryDisagreement =
      speechBoundaryDifferenceSeconds !== null &&
      speechBoundaryDifferenceSeconds >
        (input.boundaryDisagreementSeconds ??
          DEFAULT_TIMING_QA_CONFIG.vadNoVadBoundaryDisagreementSeconds);
    const vadLanguage =
      vadText === "" ? null : detectTextLanguage(vadText).language;
    const noVadLanguage =
      noVadText === "" ? null : detectTextLanguage(noVadText).language;
    const languageConflict = !sameLanguage(vadLanguage, noVadLanguage);
    const oneSideEmpty = hasOneEmptyHypothesis(vadText, noVadText);
    const vadDetectedSpeech =
      vadText !== "" ||
      intervalHasEvidence(interval, input.vadSpeechIntervals ?? []);
    const speechEvidence = vadDetectedSpeech
      ? ("strong" as const)
      : noVadText !== ""
        ? ("weak" as const)
        : ("unknown" as const);
    const highBackgroundNoise =
      input.highBackgroundNoise === true ||
      intervalHasEvidence(interval, input.highBackgroundNoiseIntervals ?? []);
    const vadQuality = evaluateHypothesisQuality({
      text: vadText,
      cues: vadCues,
      interval,
      detectedSpeech: vadDetectedSpeech,
      language: vadLanguage,
    });
    const noVadQuality = evaluateHypothesisQuality({
      text: noVadText,
      cues: noVadCues,
      interval,
      detectedSpeech: noVadText !== "",
      language: noVadLanguage,
    });
    const repetitionConflict =
      vadQuality.repetitionHallucination !==
      noVadQuality.repetitionHallucination;
    const meaningfulNonEmptyLength = Math.max(
      Array.from(normalizedVad).length,
      Array.from(normalizedNoVad).length,
    );
    const vadNoVadConflict =
      boundaryDisagreement ||
      (normalizedVad !== normalizedNoVad &&
        (oneSideEmpty
          ? meaningfulNonEmptyLength >= 4 && speechEvidence !== "unknown"
          : normalizedSimilarity < 0.72 ||
            lengthRatio < 0.55 ||
            languageConflict ||
            repetitionConflict ||
            (timingOverlap !== null &&
              timingOverlap < 0.25 &&
              normalizedSimilarity < 0.9)));
    const validCandidateConflict =
      vadNoVadConflict && !vadQuality.hardReject && !noVadQuality.hardReject;
    const conflictCodes = [
      ...(validCandidateConflict ? ["VAD_NO_VAD_VALID_CONFLICT" as const] : []),
      ...(boundaryDisagreement
        ? ["VAD_NO_VAD_BOUNDARY_DISAGREEMENT" as const]
        : []),
      ...(vadQuality.validity === "invalid-hallucination"
        ? ["VAD_HALLUCINATION" as const]
        : vadQuality.hardReject
          ? ["VAD_INVALID" as const]
          : []),
      ...(noVadQuality.validity === "invalid-hallucination"
        ? ["NO_VAD_HALLUCINATION" as const]
        : noVadQuality.hardReject
          ? ["NO_VAD_INVALID" as const]
          : []),
    ];
    return vadNoVadComparisonSchema.parse({
      interval,
      vad: {
        text: vadText,
        model: input.model,
        detectedSpeech: vadDetectedSpeech,
        language: vadLanguage,
        quality: vadQuality,
        segments: vadCues.map((cue) => ({
          start: cue.start,
          end: cue.end,
          text: cue.text,
          confidence: cue.confidence,
          language: cue.language,
        })),
      },
      noVad: {
        text: noVadText,
        model: input.model,
        detectedSpeech: noVadText !== "",
        language: noVadLanguage,
        quality: noVadQuality,
        segments: noVadCues.map((cue) => ({
          start: cue.start,
          end: cue.end,
          text: cue.text,
          confidence: cue.confidence,
          language: cue.language,
        })),
      },
      metrics: {
        normalizedSimilarity,
        characterEditDistance,
        timingOverlap,
        startDifferenceSeconds,
        endDifferenceSeconds,
        durationDifferenceSeconds,
        segmentCountDifference,
        speechBoundaryDifferenceSeconds,
        boundaryDisagreement,
        vadBoundary: vadCoverage,
        noVadBoundary: noVadCoverage,
        lengthRatio,
        languageConflict,
        oneSideEmpty,
        repetitionConflict,
      },
      vadNoVadConflict,
      validCandidateConflict,
      conflictCodes,
      highBackgroundNoise,
      speechEvidence,
      stableConsensus: false,
      largeV3Conflict: false,
      classification:
        vadQuality.validity === "invalid-hallucination" ||
        noVadQuality.validity === "invalid-hallucination"
          ? "suspected-hallucination"
          : vadNoVadConflict
            ? "ambiguous-speech"
            : "normal",
    });
  });
}

export function evaluateTranscriptConsensus(input: {
  vadText: string;
  noVadText: string;
  refinementText: string;
  refinementConfidence?: number | null;
  timingConsistency?: number | null;
  referenceText?: string;
  highBackgroundNoise?: boolean;
  speechEvidence?: "strong" | "weak" | "unknown";
}): {
  stable: boolean;
  classification: TranscriptionClassification;
  similarities: { vad: number; noVad: number; reference: number | null };
} {
  const vadSimilarity = similarity(input.vadText, input.refinementText);
  const noVadSimilarity = similarity(input.noVadText, input.refinementText);
  const referenceSimilarity =
    input.referenceText === undefined
      ? null
      : similarity(input.referenceText, input.refinementText);
  const exactBaselineMatch =
    normalizedText(input.refinementText) !== "" &&
    (normalizedText(input.refinementText) === normalizedText(input.vadText) ||
      normalizedText(input.refinementText) === normalizedText(input.noVadText));
  const timingGood =
    input.timingConsistency === undefined ||
    input.timingConsistency === null ||
    input.timingConsistency >= 0.5;
  const confidenceGood =
    input.refinementConfidence === undefined ||
    input.refinementConfidence === null ||
    input.refinementConfidence >= 0.65;
  const referenceSupport =
    referenceSimilarity !== null && referenceSimilarity >= 0.75;
  const allModelsAgree =
    vadSimilarity >= 0.75 &&
    noVadSimilarity >= 0.75 &&
    similarity(input.vadText, input.noVadText) >= 0.72;
  const stable =
    input.refinementText.trim() !== "" &&
    timingGood &&
    confidenceGood &&
    (referenceSupport ||
      allModelsAgree ||
      (exactBaselineMatch && input.highBackgroundNoise !== true));
  if (stable) {
    return {
      stable: true,
      classification: "normal",
      similarities: {
        vad: vadSimilarity,
        noVad: noVadSimilarity,
        reference: referenceSimilarity,
      },
    };
  }
  const probableNonSpeech =
    input.highBackgroundNoise === true &&
    input.speechEvidence !== "strong" &&
    Math.max(vadSimilarity, noVadSimilarity) < 0.45;
  return {
    stable: false,
    classification: probableNonSpeech
      ? "probable-non-speech"
      : input.highBackgroundNoise === true
        ? "suspected-hallucination"
        : "ambiguous-speech",
    similarities: {
      vad: vadSimilarity,
      noVad: noVadSimilarity,
      reference: referenceSimilarity,
    },
  };
}

function bestLocalSimilarity(
  candidateText: string,
  refinementText: string,
): number {
  const candidate = Array.from(normalizedText(candidateText));
  const refinement = Array.from(normalizedText(refinementText));
  if (candidate.length === 0 || refinement.length === 0) return 0;
  const direct = similarity(candidateText, refinementText);
  if (
    candidate.join("").includes(refinement.join("")) ||
    refinement.join("").includes(candidate.join(""))
  ) {
    return 1;
  }
  if (candidate.length <= refinement.length) return direct;
  let best = direct;
  const minimumLength = Math.max(1, Math.floor(refinement.length * 0.8));
  const maximumLength = Math.min(
    candidate.length,
    Math.ceil(refinement.length * 1.2),
  );
  for (let length = minimumLength; length <= maximumLength; length += 1) {
    for (let offset = 0; offset + length <= candidate.length; offset += 1) {
      best = Math.max(
        best,
        similarity(
          candidate.slice(offset, offset + length).join(""),
          refinementText,
        ),
      );
      if (best >= 0.99) return best;
    }
  }
  return best;
}

function meanConfidence(cues: readonly SubtitleCue[]): number | null {
  const values = cues.flatMap((cue) =>
    cue.confidence === null ? [] : [cue.confidence],
  );
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

export interface LocalConsensusResult {
  localComparison: boolean;
  alignmentMode: "time-aligned" | "text-window-fallback" | "unavailable";
  localInterval: Interval | null;
  localTexts: {
    vad: string;
    noVad: string;
    refinement: string;
  };
  support: {
    vad: {
      text: number;
      timing: number;
      acoustic: number;
      model: number;
      language: number;
      total: number;
    };
    noVad: {
      text: number;
      timing: number;
      acoustic: number;
      model: number;
      language: number;
      total: number;
    };
    refinement: number;
  };
  tieBreakApplied: boolean;
}

export function evaluateLocalConsensus(input: {
  interval: Interval;
  vadText: string;
  noVadText: string;
  refinementText: string;
  vadQuality: HypothesisQuality;
  noVadQuality: HypothesisQuality;
  refinementQuality: HypothesisQuality;
  vadCues?: readonly SubtitleCue[];
  noVadCues?: readonly SubtitleCue[];
  refinementCues?: readonly SubtitleCue[];
  speechIntervals?: readonly Interval[];
  speechEvidence?: "strong" | "weak" | "unknown";
  highBackgroundNoise?: boolean;
  noVadTieBreakBonus?: number;
}): LocalConsensusResult {
  const refinementCues = input.refinementCues ?? [];
  const refinementCoverage = cueCoverage(refinementCues, input.interval);
  const timeAligned =
    refinementCoverage !== null &&
    ((input.vadCues?.length ?? 0) > 0 || (input.noVadCues?.length ?? 0) > 0);
  const localInterval = timeAligned ? refinementCoverage : null;
  const localVadText =
    localInterval === null
      ? input.vadText
      : cueText(input.vadCues ?? [], localInterval);
  const localNoVadText =
    localInterval === null
      ? input.noVadText
      : cueText(input.noVadCues ?? [], localInterval);
  const localRefinementText =
    localInterval === null
      ? input.refinementText
      : cueText(refinementCues, localInterval);
  const alignmentMode =
    normalizedText(localRefinementText) === ""
      ? ("unavailable" as const)
      : timeAligned
        ? ("time-aligned" as const)
        : ("text-window-fallback" as const);
  const comparisonInterval = localInterval ?? input.interval;
  const intervalDuration = Math.max(
    0.001,
    comparisonInterval.end - comparisonInterval.start,
  );
  const speechSeconds = (input.speechIntervals ?? []).reduce(
    (total, speech) => total + overlapSeconds(comparisonInterval, speech),
    0,
  );
  const acoustic =
    (input.speechIntervals?.length ?? 0) > 0
      ? Math.min(1, speechSeconds / intervalDuration)
      : input.speechEvidence === "strong"
        ? 1
        : input.speechEvidence === "weak"
          ? 0.5
          : 0.5;
  const candidateSupport = (
    text: string,
    quality: HypothesisQuality,
    cues: readonly SubtitleCue[],
  ) => {
    const semanticSimilarity = bestLocalSimilarity(text, localRefinementText);
    const candidateCharacters = Array.from(normalizedText(text)).length;
    const refinementCharacters = Array.from(
      normalizedText(localRefinementText),
    ).length;
    const refinementCoverage =
      refinementCharacters === 0
        ? 0
        : Math.min(1, candidateCharacters / refinementCharacters);
    const textSupport = semanticSimilarity * (0.7 + refinementCoverage * 0.3);
    const coverage = cueCoverage(cues, comparisonInterval);
    const timing =
      coverage === null
        ? timeAligned
          ? 0
          : 0.5
        : Math.min(
            1,
            overlapSeconds(coverage, comparisonInterval) / intervalDuration,
          );
    const candidateLanguage =
      normalizedText(text) === "" ? null : detectTextLanguage(text).language;
    const refinementLanguage =
      normalizedText(localRefinementText) === ""
        ? null
        : detectTextLanguage(localRefinementText).language;
    const language =
      candidateLanguage === null ||
      refinementLanguage === null ||
      sameLanguage(candidateLanguage, refinementLanguage)
        ? 1
        : 0;
    const model = quality.qualityScore / 100;
    const total =
      textSupport * 0.6 +
      timing * 0.15 +
      acoustic * 0.05 +
      model * 0.15 +
      language * 0.05;
    return {
      text: textSupport,
      timing,
      acoustic,
      model,
      language,
      total: Math.max(0, Math.min(1, total)),
    };
  };
  const vad = candidateSupport(
    localVadText,
    input.vadQuality,
    input.vadCues ?? [],
  );
  const noVad = candidateSupport(
    localNoVadText,
    input.noVadQuality,
    input.noVadCues ?? [],
  );
  const refinementConfidence = meanConfidence(refinementCues);
  const refinementSupport = Math.max(
    0,
    Math.min(
      1,
      (input.refinementQuality.qualityScore / 100) * 0.7 +
        acoustic * 0.2 +
        (refinementConfidence ?? 0.5) * 0.1,
    ),
  );
  const bonus = Math.min(
    0.05,
    Math.max(0, input.noVadTieBreakBonus ?? DEFAULT_NO_VAD_TIE_BREAK_BONUS),
  );
  const tieBreakEligible =
    bonus > 0 &&
    input.vadQuality.validity === "valid" &&
    input.noVadQuality.validity === "valid" &&
    input.refinementQuality.validity === "valid" &&
    input.speechEvidence === "strong" &&
    input.highBackgroundNoise !== true &&
    Math.abs(input.vadQuality.qualityScore - input.noVadQuality.qualityScore) <=
      10 &&
    vad.text >= 0.75 &&
    noVad.text >= 0.75 &&
    similarity(localVadText, localNoVadText) >= 0.85 &&
    Math.abs(vad.total - noVad.total) <= bonus;
  return {
    localComparison: timeAligned,
    alignmentMode,
    localInterval,
    localTexts: {
      vad: localVadText,
      noVad: localNoVadText,
      refinement: localRefinementText,
    },
    support: {
      vad,
      noVad: {
        ...noVad,
        total: Math.min(1, noVad.total + (tieBreakEligible ? bonus : 0)),
      },
      refinement: refinementSupport,
    },
    tieBreakApplied: tieBreakEligible,
  };
}

export interface HypothesisArbitrationResult {
  selected: "vad" | "no-vad" | "refinement" | "none";
  status:
    "accepted-after-refinement" | "needs-refinement" | "needs-human-review";
  stableConsensus: boolean;
  classification: TranscriptionClassification;
  reasons: string[];
}

export function arbitrateHypotheses(input: {
  vadQuality: HypothesisQuality;
  noVadQuality: HypothesisQuality;
  refinementQuality: HypothesisQuality;
  consensus: LocalConsensusResult;
  highBackgroundNoise?: boolean;
  speechEvidence?: "strong" | "weak" | "unknown";
  lastRound?: boolean;
}): HypothesisArbitrationResult {
  const unresolved = (
    classification: TranscriptionClassification,
    reasons: string[],
  ): HypothesisArbitrationResult => ({
    selected: "none",
    status: input.lastRound ? "needs-human-review" : "needs-refinement",
    stableConsensus: false,
    classification,
    reasons: [
      ...reasons,
      input.lastRound ? "maximum-rounds-reached" : "retry-wider-context",
    ],
  });
  if (input.refinementQuality.hardReject) {
    return unresolved(
      input.highBackgroundNoise === true
        ? "suspected-hallucination"
        : "ambiguous-speech",
      ["large-v3-invalid-hypothesis"],
    );
  }
  const vadUsable = !input.vadQuality.hardReject;
  const noVadUsable = !input.noVadQuality.hardReject;
  const supportThreshold = input.highBackgroundNoise === true ? 0.82 : 0.68;
  const marginThreshold = input.highBackgroundNoise === true ? 0.2 : 0.1;
  if (vadUsable !== noVadUsable) {
    const selected = vadUsable ? ("vad" as const) : ("no-vad" as const);
    const support =
      input.consensus.support[selected === "vad" ? "vad" : "noVad"];
    if (support.total >= supportThreshold && support.text >= 0.65) {
      return {
        selected,
        status: "accepted-after-refinement",
        stableConsensus: true,
        classification: "normal",
        reasons: [
          vadUsable
            ? input.noVadQuality.validity === "invalid-hallucination"
              ? "no-vad-invalid-hallucination"
              : "no-vad-invalid"
            : input.vadQuality.validity === "invalid-hallucination"
              ? "vad-invalid-hallucination"
              : "vad-invalid",
          `large-v3-supports-${selected}`,
        ],
      };
    }
    return unresolved("ambiguous-speech", [
      `${selected}-only-valid-baseline`,
      "large-v3-local-support-insufficient",
    ]);
  }
  if (vadUsable && noVadUsable) {
    const vadSupport = input.consensus.support.vad.total;
    const noVadSupport = input.consensus.support.noVad.total;
    if (
      input.highBackgroundNoise === true &&
      Math.max(
        input.consensus.support.vad.text,
        input.consensus.support.noVad.text,
      ) < 0.95
    ) {
      return unresolved(
        input.speechEvidence === "strong"
          ? "suspected-hallucination"
          : "probable-non-speech",
        ["true-valid-candidate-conflict", "noisy-local-consensus-insufficient"],
      );
    }
    const winner =
      vadSupport >= noVadSupport ? ("vad" as const) : ("no-vad" as const);
    const winnerSupport = Math.max(vadSupport, noVadSupport);
    const margin = Math.abs(vadSupport - noVadSupport);
    if (
      winnerSupport >= supportThreshold &&
      (margin >= marginThreshold || input.consensus.tieBreakApplied)
    ) {
      return {
        selected: winner,
        status: "accepted-after-refinement",
        stableConsensus: true,
        classification: "normal",
        reasons: [
          `large-v3-supports-${winner}`,
          ...(input.consensus.tieBreakApplied
            ? ["no-vad-weak-tie-break-prior"]
            : ["local-consensus-margin"]),
        ],
      };
    }
    return unresolved(
      input.highBackgroundNoise === true
        ? input.speechEvidence === "strong"
          ? "suspected-hallucination"
          : "probable-non-speech"
        : "ambiguous-speech",
      ["true-valid-candidate-conflict", "large-v3-local-consensus-unresolved"],
    );
  }
  if (
    input.refinementQuality.validity === "valid" &&
    input.consensus.support.refinement >= 0.75 &&
    input.speechEvidence === "strong" &&
    input.highBackgroundNoise !== true
  ) {
    return {
      selected: "refinement",
      status: "accepted-after-refinement",
      stableConsensus: true,
      classification: "normal",
      reasons: ["both-baselines-invalid", "large-v3-diagnostic-valid"],
    };
  }
  return unresolved(
    input.highBackgroundNoise === true
      ? input.speechEvidence === "strong"
        ? "suspected-hallucination"
        : "probable-non-speech"
      : "ambiguous-speech",
    ["all-hypotheses-invalid-or-unsupported"],
  );
}

function referenceConflict(
  cue: SubtitleCue,
  references: readonly SubtitleCue[],
): boolean | null {
  const overlapping = references
    .filter((reference) => overlapSeconds(cue, reference) > 0)
    .toSorted(
      (left, right) => overlapSeconds(cue, right) - overlapSeconds(cue, left),
    )[0];
  if (overlapping === undefined) return null;
  return similarity(cue.text, overlapping.text) < 0.45;
}

function continuityConcern(text: string, language: LanguageTag): boolean {
  if (language === "ja") {
    return /(?:は|が|を|に|で|と|から|けど|ので|って)\s*$/u.test(text);
  }
  if (language.startsWith("zh")) return /(?:但|因为|所以|如果)\s*$/u.test(text);
  if (language === "en")
    return /\b(?:and|but|because|if|that)\s*$/iu.test(text);
  return false;
}

function expectedLanguageConflict(
  cue: SubtitleCue,
  expectedLanguages: readonly LanguageTag[],
): boolean {
  if (
    expectedLanguages.length === 0 ||
    expectedLanguages.includes("mixed") ||
    expectedLanguages.includes("und")
  ) {
    return false;
  }
  const detection =
    cue.language === "und" ? detectTextLanguage(cue.text) : null;
  const detectedLanguages =
    cue.language === "mixed"
      ? cue.languages
      : detection?.language === "mixed"
        ? detection.languages
        : [detection?.language ?? cue.language];
  const matches = (detected: LanguageTag, expected: LanguageTag): boolean =>
    detected === expected ||
    (detected.startsWith("zh") && expected.startsWith("zh"));
  return !detectedLanguages.some(
    (detected) =>
      detected === "und" ||
      expectedLanguages.some((expected) => matches(detected, expected)),
  );
}

function qualityStatus(
  reasons: readonly string[],
): "accepted" | "needs-refinement" {
  return reasons.length === 0 ? "accepted" : "needs-refinement";
}

function emptySignals() {
  return {
    confidence: "unavailable" as const,
    lowTokenProbability: null,
    averageLogProbabilityLow: null,
    noSpeechConflict: false,
    decoderFallback: null,
    highEntropy: null,
    repeatedPhrase: false,
    repeatedCharacters: false,
    hallucinationPattern: false,
    vadSpeechButEmpty: true,
    speechTextMismatch: true,
    charactersPerSecond: null,
    charactersPerSecondStatus: "unknown" as const,
    languageConflict: false,
    referenceConflict: null,
    timestampAnomaly: false,
    timestampAnomalyScore: 0,
    timestampAnomalyBand: "pass" as const,
    timestampAnomalyReasons: [],
    overlapAnomaly: false,
    continuityConcern: false,
    vadNoVadConflict: false,
    largeV3Conflict: false,
    highBackgroundNoise: false,
    stableConsensus: false,
  };
}

export interface TimingRepairRecord {
  cueId: string;
  before: Interval;
  after: Interval;
  method: "none" | "timing-only-token" | "timing-only-speech";
  reasons: string[];
}

export function repairTranscriptionTimings(input: {
  cues: readonly SubtitleCue[];
  speechIntervals: readonly Interval[];
  mediaDurationSeconds?: number;
  timingConfig?: Partial<TimingQaConfig> | undefined;
  speechBoundarySource?: "silence" | "vad" | "segment";
}): { cues: SubtitleCue[]; repairs: TimingRepairRecord[] } {
  const config: TimingQaConfig = {
    ...DEFAULT_TIMING_QA_CONFIG,
    ...input.timingConfig,
  };
  const sorted = [...input.cues].toSorted(
    (left, right) => left.start - right.start || left.end - right.end,
  );
  const repairs: TimingRepairRecord[] = [];
  const repaired = sorted.map((cue, index) => {
    if (
      cue.style === "music" ||
      cue.style === "thought" ||
      cue.timingEvidence?.sourceTrusted === true
    ) {
      repairs.push({
        cueId: cue.id,
        before: { start: cue.start, end: cue.end },
        after: { start: cue.start, end: cue.end },
        method: "none",
        reasons: [],
      });
      return cue;
    }
    const validTokens = (cue.timingEvidence?.tokens ?? []).filter(
      (token) =>
        token.text.trim() !== "" &&
        token.end > token.start &&
        token.start >= cue.start - 1 &&
        token.end <= cue.end + 1,
    );
    const acoustic = measureAcousticCoverage(cue, input.speechIntervals);
    const cueSpeechIntervals = input.speechIntervals
      .map((interval) => ({
        start: Math.max(cue.start, interval.start),
        end: Math.min(cue.end, interval.end),
      }))
      .filter((interval) => interval.end > interval.start);
    const tokenStart = validTokens[0]?.start;
    const tokenEnd = validTokens.at(-1)?.end;
    const useToken =
      tokenStart !== undefined &&
      tokenEnd !== undefined &&
      tokenEnd > tokenStart;
    const speechStart = useToken ? tokenStart : acoustic.speechStart;
    const speechEnd = useToken ? tokenEnd : acoustic.speechEnd;
    if (
      speechStart === null ||
      speechEnd === null ||
      speechEnd <= speechStart
    ) {
      repairs.push({
        cueId: cue.id,
        before: { start: cue.start, end: cue.end },
        after: { start: cue.start, end: cue.end },
        method: "none",
        reasons: ["INSUFFICIENT_CONTEXT"],
      });
      return cue;
    }
    const nextCueStart = sorted[index + 1]?.start;
    const aligned = alignDialogueInterval({
      speechStart,
      speechEnd,
      ...(nextCueStart === undefined ? {} : { nextCueStart }),
      ...(input.mediaDurationSeconds === undefined
        ? {}
        : { mediaDuration: input.mediaDurationSeconds }),
      config,
    });
    const method = useToken
      ? ("timing-only-token" as const)
      : ("timing-only-speech" as const);
    const reasons = [
      ...(cue.start + 0.05 < speechStart ? ["WHISPER_START_TOO_EARLY"] : []),
      ...(cue.end > speechEnd + config.dialogueTailSeconds + 0.05
        ? ["WHISPER_END_TOO_LATE"]
        : []),
    ];
    repairs.push({
      cueId: cue.id,
      before: { start: cue.start, end: cue.end },
      after: aligned,
      method,
      reasons,
    });
    return {
      ...cue,
      ...aligned,
      timingEvidence: {
        sourceTrusted: false,
        speechStart,
        speechEnd,
        tokenTimestampsAvailable:
          cue.timingEvidence?.tokenTimestampsAvailable ?? false,
        tokenTimestampsUsed: useToken,
        tokens: cue.timingEvidence?.tokens ?? [],
        alignmentSource: useToken
          ? ("token" as const)
          : input.speechBoundarySource === "vad"
            ? ("vad" as const)
            : ("speech" as const),
        presentationTimingMethod:
          cue.timingEvidence?.presentationTimingMethod ?? null,
        ...(cue.timingEvidence?.chunkBoundaryConflict === undefined
          ? {}
          : {
              chunkBoundaryConflict: cue.timingEvidence.chunkBoundaryConflict,
            }),
        speechIntervals: cueSpeechIntervals,
        speechBoundarySource: input.speechBoundarySource ?? "silence",
      },
    };
  });
  for (let index = 1; index < repaired.length; index += 1) {
    const previous = repaired[index - 1];
    const current = repaired[index];
    if (
      previous !== undefined &&
      current !== undefined &&
      previous.end > current.start
    ) {
      previous.end = Math.max(previous.start + 0.001, current.start);
    }
  }
  return { cues: repaired, repairs };
}

export function evaluateTranscriptionQuality(input: {
  cues: readonly SubtitleCue[];
  speechIntervals?: readonly Interval[];
  expectedLanguages?: readonly LanguageTag[];
  originalLanguageReferences?: readonly SubtitleCue[];
  refinementRounds?: Readonly<Record<string, number>>;
  vadNoVadComparisons?: readonly VadNoVadComparison[];
  timingConfig?: Partial<TimingQaConfig> | undefined;
}): TranscriptionQuality {
  const timingConfig: TimingQaConfig = {
    ...DEFAULT_TIMING_QA_CONFIG,
    ...input.timingConfig,
  };
  const cues = [...input.cues].toSorted(
    (left, right) => left.start - right.start || left.end - right.end,
  );
  const repeatedAcrossCues = repeatedAcrossCueIndexes(cues);
  const crossCueLongPhraseLoops = detectCrossCueRepetitionWindows({
    cues,
    minimumCoreLength: 8,
    minimumOccurrences: 3,
    maximumWindowCues: 6,
    maximumWindowSeconds: 20,
  });
  const crossCueLoopIds = new Set(
    crossCueLongPhraseLoops.flatMap((loop) => loop.cueIds),
  );
  const segments: TranscriptionQuality["segments"] = cues.map((cue, index) => {
    const duration = cue.end - cue.start;
    const charactersPerSecond =
      duration <= 0
        ? null
        : countVisibleSubtitleCharacters(cue.text) / duration;
    const charactersPerSecondStatus =
      charactersPerSecond === null
        ? ("unknown" as const)
        : cue.style !== undefined
          ? ("ok" as const)
          : charactersPerSecond > 18
            ? ("high" as const)
            : charactersPerSecond < timingConfig.veryLowCps &&
                duration >= timingConfig.veryLowCpsMinimumDurationSeconds
              ? ("low" as const)
              : ("ok" as const);
    const previous = cues[index - 1];
    const metrics = cue.transcriptionMetrics;
    const lowTokenProbability =
      metrics?.tokenProbability === undefined ||
      metrics.tokenProbability === null
        ? null
        : metrics.tokenProbability < 0.25;
    const averageLogProbabilityLow =
      metrics?.averageLogProbability === undefined ||
      metrics.averageLogProbability === null
        ? null
        : metrics.averageLogProbability < -1;
    const noSpeechConflict =
      (metrics?.noSpeechProbability ?? 0) > 0.8 && cue.text.trim() !== "";
    const hypothesisHallucination =
      cue.style === "music"
        ? null
        : detectHypothesisHallucination({
            text: cue.text,
            cues: [cue],
          });
    const duplicateLine =
      cue.style === "music" ? null : detectSingleCueDuplicateLines(cue);
    const repeated =
      repeatedPhrase(cue.text) ||
      repeatedAcrossCues.has(index) ||
      crossCueLoopIds.has(cue.id) ||
      hypothesisHallucination?.repetitionHallucination === true ||
      duplicateLine !== null;
    const repeatedChars = repeatedCharacters(cue.text);
    const hallucination =
      hallucinationPattern(cue.text) ||
      repeatedAcrossCues.has(index) ||
      crossCueLoopIds.has(cue.id) ||
      hypothesisHallucination?.repetitionHallucination === true ||
      duplicateLine !== null;
    const languageConflict = expectedLanguageConflict(
      cue,
      input.expectedLanguages ?? [],
    );
    const timestampAnomaly =
      !Number.isFinite(cue.start) ||
      !Number.isFinite(cue.end) ||
      cue.start < 0 ||
      cue.end <= cue.start;
    const reportStart = Number.isFinite(cue.start) ? Math.max(0, cue.start) : 0;
    const reportEnd =
      Number.isFinite(cue.end) && cue.end > reportStart
        ? cue.end
        : reportStart + 0.001;
    const overlapAnomaly =
      previous !== undefined && previous.end - cue.start > 0.25;
    const reference = referenceConflict(
      cue,
      input.originalLanguageReferences ?? [],
    );
    const highEntropy =
      metrics?.entropy === undefined || metrics.entropy === null
        ? null
        : metrics.entropy > 5;
    const vadNoVad = (input.vadNoVadComparisons ?? [])
      .filter((comparison) => overlapSeconds(cue, comparison.interval) > 0)
      .toSorted(
        (left, right) =>
          overlapSeconds(cue, right.interval) -
          overlapSeconds(cue, left.interval),
      )[0];
    const mandatoryVadNoVadConflict =
      vadNoVad?.vadNoVadConflict === true && !vadNoVad.stableConsensus;
    const acousticEvidence =
      (input.speechIntervals?.length ?? 0) > 0
        ? (input.speechIntervals ?? [])
        : cue.timingEvidence?.speechStart !== null &&
            cue.timingEvidence?.speechStart !== undefined &&
            cue.timingEvidence.speechEnd !== null
          ? [
              {
                start: cue.timingEvidence.speechStart,
                end: cue.timingEvidence.speechEnd,
              },
            ]
          : [];
    const acoustic = measureAcousticCoverage(
      { start: reportStart, end: reportEnd },
      acousticEvidence,
    );
    const ordinaryDialogue = cue.style === undefined;
    const timingAssessment = assessTimingAnomaly(
      {
        durationSeconds: ordinaryDialogue
          ? Math.max(0.001, reportEnd - reportStart)
          : 0.001,
        visibleCharacters: ordinaryDialogue
          ? countVisibleSubtitleCharacters(cue.text)
          : 1,
        charactersPerSecond: ordinaryDialogue ? charactersPerSecond : null,
        acoustic: ordinaryDialogue
          ? acoustic
          : measureAcousticCoverage({ start: reportStart, end: reportEnd }, []),
        overlapAnomaly,
        invalidTimestamp: timestampAnomaly,
        vadNoVadBoundaryDisagreement:
          vadNoVad?.metrics.boundaryDisagreement === true,
        chunkBoundaryConflict:
          cue.timingEvidence?.chunkBoundaryConflict === true,
        presentationTimingEstimate:
          cue.timingEvidence?.presentationTimingMethod === "character-ratio",
      },
      timingConfig,
    );
    const reasons = [
      ...(cue.confidence !== null && cue.confidence < 0.65
        ? ["low-confidence"]
        : []),
      ...(lowTokenProbability === true ? ["low-token-probability"] : []),
      ...(averageLogProbabilityLow === true
        ? ["low-average-log-probability"]
        : []),
      ...(noSpeechConflict ? ["no-speech-conflict"] : []),
      ...(metrics?.decoderFallback === true ? ["decoder-fallback"] : []),
      ...(highEntropy === true ? ["high-entropy"] : []),
      ...(repeated ? ["repeated-phrase"] : []),
      ...(hypothesisHallucination?.signals.includes("LONG_PHRASE_LOOP") === true
        ? ["long-phrase-loop"]
        : []),
      ...(crossCueLoopIds.has(cue.id) ? ["cross-cue-long-phrase-loop"] : []),
      ...(duplicateLine === null ? [] : ["presentation-duplicate-line"]),
      ...(repeatedChars ? ["repeated-characters"] : []),
      ...(hallucination ? ["hallucination-pattern"] : []),
      ...(charactersPerSecondStatus === "high"
        ? ["characters-per-second-high"]
        : []),
      ...(charactersPerSecondStatus === "low"
        ? ["characters-per-second-low"]
        : []),
      ...(languageConflict ? ["language-conflict"] : []),
      ...(reference === true ? ["original-reference-conflict"] : []),
      ...(timestampAnomaly ? ["timestamp-anomaly"] : []),
      ...(overlapAnomaly ? ["segment-overlap"] : []),
      ...timingAssessment.reasons,
      ...(mandatoryVadNoVadConflict ? ["vad-no-vad-conflict"] : []),
      ...(vadNoVad?.largeV3Conflict === true ? ["large-v3-conflict"] : []),
    ];
    return {
      id: `segment-${String(index + 1).padStart(5, "0")}`,
      cueId: cue.id,
      interval: { start: reportStart, end: reportEnd },
      text: cue.text,
      status:
        timingAssessment.score >= 60
          ? "needs-refinement"
          : qualityStatus(reasons),
      classification: vadNoVad?.classification ?? "normal",
      signals: {
        confidence:
          cue.confidence === null
            ? ("unavailable" as const)
            : cue.confidence < 0.65
              ? ("low" as const)
              : ("ok" as const),
        lowTokenProbability,
        averageLogProbabilityLow,
        noSpeechConflict,
        decoderFallback: metrics?.decoderFallback ?? null,
        highEntropy,
        repeatedPhrase: repeated,
        repeatedCharacters: repeatedChars,
        hallucinationPattern: hallucination,
        vadSpeechButEmpty: false,
        speechTextMismatch:
          charactersPerSecondStatus === "low" ||
          charactersPerSecondStatus === "high",
        charactersPerSecond,
        charactersPerSecondStatus,
        languageConflict,
        referenceConflict: reference,
        timestampAnomaly: timestampAnomaly || timingAssessment.score >= 30,
        timestampAnomalyScore: timingAssessment.score,
        timestampAnomalyBand: timingAssessment.band,
        timestampAnomalyReasons: timingAssessment.reasons,
        overlapAnomaly,
        continuityConcern: continuityConcern(cue.text, cue.language),
        vadNoVadConflict: vadNoVad?.vadNoVadConflict ?? false,
        largeV3Conflict: vadNoVad?.largeV3Conflict ?? false,
        highBackgroundNoise: vadNoVad?.highBackgroundNoise ?? false,
        stableConsensus: vadNoVad?.stableConsensus ?? false,
      },
      timing: {
        durationSeconds: Math.max(0.001, reportEnd - reportStart),
        visibleCharacters: countVisibleSubtitleCharacters(cue.text),
        charactersPerSecond,
        speechStart: acoustic.speechStart,
        speechEnd: acoustic.speechEnd,
        leadingSilenceSeconds: acoustic.leadingSilenceSeconds,
        trailingSilenceSeconds: acoustic.trailingSilenceSeconds,
        speechDurationSeconds: acoustic.speechDurationSeconds,
        speechRatio: acoustic.speechRatio,
        maxInternalSilenceSeconds: acoustic.maxInternalSilenceSeconds,
        vadNoVadStartDifferenceSeconds:
          vadNoVad?.metrics.startDifferenceSeconds ?? null,
        vadNoVadEndDifferenceSeconds:
          vadNoVad?.metrics.endDifferenceSeconds ?? null,
        vadNoVadDurationDifferenceSeconds:
          vadNoVad?.metrics.durationDifferenceSeconds ?? null,
        vadBoundary: vadNoVad?.metrics.vadBoundary ?? null,
        noVadBoundary: vadNoVad?.metrics.noVadBoundary ?? null,
        vadNoVadTextSimilarity: vadNoVad?.metrics.normalizedSimilarity ?? null,
        tokenTimestampsAvailable:
          cue.timingEvidence?.tokenTimestampsAvailable ?? false,
        tokenTimestampsUsed: cue.timingEvidence?.tokenTimestampsUsed ?? false,
        alignmentSource: cue.timingEvidence?.alignmentSource ?? "segment",
        repairAttempted:
          cue.timingEvidence?.sourceTrusted !== true &&
          ["token", "speech", "vad"].includes(
            cue.timingEvidence?.alignmentSource ?? "",
          ),
        repairMethod:
          cue.timingEvidence?.alignmentSource === "token"
            ? "timing-only-token"
            : ["speech", "vad"].includes(
                  cue.timingEvidence?.alignmentSource ?? "",
                )
              ? "timing-only-speech"
              : null,
        requiresHumanReview: timingAssessment.score >= 80,
      },
      reasons,
      refinementRounds: input.refinementRounds?.[cue.id] ?? 0,
    };
  });

  const speechIntervals = input.speechIntervals ?? [];
  for (const speech of speechIntervals) {
    const duration = speech.end - speech.start;
    if (duration < 0.8) continue;
    const coveredRanges = cues
      .filter((cue) => overlapSeconds(speech, cue) > 0)
      .map((cue) => ({
        start: Math.max(speech.start, cue.start),
        end: Math.min(speech.end, cue.end),
      }))
      .filter(
        (interval) =>
          Number.isFinite(interval.start) &&
          Number.isFinite(interval.end) &&
          interval.end > interval.start,
      )
      .toSorted((left, right) => left.start - right.start);
    const mergedCoverage: Interval[] = [];
    for (const range of coveredRanges) {
      const previous = mergedCoverage.at(-1);
      if (previous !== undefined && range.start <= previous.end) {
        previous.end = Math.max(previous.end, range.end);
      } else {
        mergedCoverage.push({ ...range });
      }
    }
    const addSpeechGap = (
      interval: Interval,
      reason: string,
      vadSpeechButEmpty: boolean,
    ) => {
      segments.push({
        id: `speech-gap-${String(segments.length + 1).padStart(5, "0")}`,
        cueId: null,
        interval,
        text: "",
        status: "needs-refinement",
        classification: "ambiguous-speech",
        signals: {
          ...emptySignals(),
          vadSpeechButEmpty,
        },
        reasons: [reason],
        refinementRounds: 0,
      });
    };
    if (mergedCoverage.length === 0) {
      addSpeechGap({ ...speech }, "vad-speech-empty-transcript", true);
      continue;
    }
    const totalCovered = mergedCoverage.reduce(
      (total, interval) => total + interval.end - interval.start,
      0,
    );
    if (duration >= 30 && totalCovered / duration < 0.05) {
      addSpeechGap({ ...speech }, "large-speech-text-mismatch", false);
      continue;
    }
    for (let index = 1; index < mergedCoverage.length; index += 1) {
      const previous = mergedCoverage[index - 1];
      const current = mergedCoverage[index];
      if (
        previous !== undefined &&
        current !== undefined &&
        current.start - previous.end >= 2
      ) {
        addSpeechGap(
          { start: previous.end, end: current.start },
          "unexplained-speech-gap",
          false,
        );
      }
    }
  }
  for (const comparison of input.vadNoVadComparisons ?? []) {
    if (!comparison.vadNoVadConflict || comparison.stableConsensus) {
      continue;
    }
    const matching = segments.filter(
      (segment) => overlapSeconds(segment.interval, comparison.interval) > 0,
    );
    if (matching.length > 0) {
      for (const segment of matching) {
        segment.classification = comparison.classification;
        segment.signals.vadNoVadConflict = true;
        segment.signals.largeV3Conflict = comparison.largeV3Conflict;
        segment.signals.highBackgroundNoise = comparison.highBackgroundNoise;
        segment.signals.stableConsensus = false;
        segment.reasons = [
          ...new Set([
            ...segment.reasons,
            "vad-no-vad-conflict",
            ...(comparison.largeV3Conflict ? ["large-v3-conflict"] : []),
          ]),
        ];
        segment.status = "needs-refinement";
      }
      continue;
    }
    segments.push({
      id: `vad-no-vad-conflict-${String(segments.length + 1).padStart(5, "0")}`,
      cueId: null,
      interval: comparison.interval,
      text: "",
      status: "needs-refinement",
      classification: comparison.classification,
      signals: {
        ...emptySignals(),
        vadSpeechButEmpty:
          comparison.vad.detectedSpeech && comparison.vad.text.trim() === "",
        vadNoVadConflict: true,
        largeV3Conflict: comparison.largeV3Conflict,
        highBackgroundNoise: comparison.highBackgroundNoise,
        stableConsensus: false,
      },
      reasons: [
        "vad-no-vad-conflict",
        ...(comparison.largeV3Conflict ? ["large-v3-conflict"] : []),
      ],
      refinementRounds: 0,
    });
  }
  segments.sort(
    (left, right) =>
      left.interval.start - right.interval.start ||
      left.interval.end - right.interval.end,
  );
  const summary = {
    accepted: segments.filter((segment) =>
      ["accepted", "accepted-after-refinement"].includes(segment.status),
    ).length,
    needsRefinement: segments.filter(
      (segment) => segment.status === "needs-refinement",
    ).length,
    needsHumanReview: segments.filter(
      (segment) => segment.status === "needs-human-review",
    ).length,
    vadNoVadConflicts: (input.vadNoVadComparisons ?? []).filter(
      (comparison) => comparison.vadNoVadConflict,
    ).length,
    resolvedByLargeV3: (input.vadNoVadComparisons ?? []).filter(
      (comparison) => comparison.vadNoVadConflict && comparison.stableConsensus,
    ).length,
    suspectedHallucinations: (input.vadNoVadComparisons ?? []).filter(
      (comparison) => comparison.classification === "suspected-hallucination",
    ).length,
    probableNonSpeech: (input.vadNoVadComparisons ?? []).filter(
      (comparison) => comparison.classification === "probable-non-speech",
    ).length,
    autoResolvedVad: (input.vadNoVadComparisons ?? []).filter(
      (comparison) => comparison.selectedHypothesis === "vad",
    ).length,
    autoResolvedNoVad: (input.vadNoVadComparisons ?? []).filter(
      (comparison) => comparison.selectedHypothesis === "no-vad",
    ).length,
    autoResolvedLargeV3: (input.vadNoVadComparisons ?? []).filter(
      (comparison) => comparison.selectedHypothesis === "refinement",
    ).length,
    rejectedVadHallucinations: (input.vadNoVadComparisons ?? []).filter(
      (comparison) =>
        comparison.vad.quality?.validity === "invalid-hallucination",
    ).length,
    rejectedNoVadHallucinations: (input.vadNoVadComparisons ?? []).filter(
      (comparison) =>
        comparison.noVad.quality?.validity === "invalid-hallucination",
    ).length,
    trueUnresolvedConflicts: (input.vadNoVadComparisons ?? []).filter(
      (comparison) =>
        comparison.validCandidateConflict === true &&
        !comparison.stableConsensus,
    ).length,
  };
  return transcriptionQualitySchema.parse({
    schemaVersion: "1.0.0",
    evaluatorVersion: EVALUATOR_VERSION,
    segments,
    summary,
    needsHumanReviewCount: summary.needsHumanReview,
    needsHumanReviewIntervals: segments
      .filter((segment) => segment.status === "needs-human-review")
      .map((segment) => ({
        ...segment.interval,
        reasons: segment.reasons,
      })),
  });
}

export function mergeNearbyRefinementIntervals(
  intervals: readonly Interval[],
  mergeGapSeconds = 1.5,
  options: {
    maxMergedRefinementSeconds?: number;
    speechIntervals?: readonly Interval[];
    preferredBoundaries?: readonly number[];
  } = {},
): Interval[] {
  const maximum = Math.min(
    HARD_MAX_MERGED_REFINEMENT_SECONDS,
    Math.max(
      1,
      options.maxMergedRefinementSeconds ??
        DEFAULT_MAX_MERGED_REFINEMENT_SECONDS,
    ),
  );
  const sorted = intervals
    .flatMap((interval) =>
      splitRefinementInterval({
        interval,
        maxSeconds: maximum,
        speechIntervals: options.speechIntervals ?? [],
        preferredBoundaries: options.preferredBoundaries ?? [],
      }),
    )
    .toSorted(
      (left, right) => left.start - right.start || left.end - right.end,
    );
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const previous = merged.at(-1);
    const sameAcousticContext =
      previous === undefined ||
      intervalHasEvidence(previous, options.speechIntervals ?? []) ===
        intervalHasEvidence(interval, options.speechIntervals ?? []);
    if (
      previous !== undefined &&
      interval.start - previous.end <= mergeGapSeconds &&
      Math.max(previous.end, interval.end) - previous.start <= maximum &&
      sameAcousticContext
    ) {
      previous.end = Math.max(previous.end, interval.end);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

export function splitRefinementInterval(input: {
  interval: Interval;
  maxSeconds?: number;
  speechIntervals?: readonly Interval[];
  preferredBoundaries?: readonly number[];
}): Interval[] {
  const maximum = Math.min(
    HARD_MAX_MERGED_REFINEMENT_SECONDS,
    Math.max(1, input.maxSeconds ?? DEFAULT_MAX_MERGED_REFINEMENT_SECONDS),
  );
  if (input.interval.end - input.interval.start <= maximum) {
    return [{ ...input.interval }];
  }
  const speech = (input.speechIntervals ?? [])
    .filter((candidate) => overlapSeconds(candidate, input.interval) > 0)
    .toSorted(
      (left, right) => left.start - right.start || left.end - right.end,
    );
  const silenceBoundaries = speech.slice(1).flatMap((current, index) => {
    const previous = speech[index];
    if (
      previous === undefined ||
      current.start <= previous.end ||
      current.start - previous.end < 0.4
    ) {
      return [];
    }
    return [(previous.end + current.start) / 2];
  });
  const boundaries = [
    ...silenceBoundaries,
    ...speech.flatMap((candidate) => [candidate.start, candidate.end]),
    ...(input.preferredBoundaries ?? []),
  ]
    .filter(
      (boundary) =>
        boundary > input.interval.start && boundary < input.interval.end,
    )
    .toSorted((left, right) => left - right);
  const result: Interval[] = [];
  let start = input.interval.start;
  while (input.interval.end - start > maximum) {
    const target = start + maximum;
    const minimumUseful = start + Math.min(5, maximum / 3);
    const candidate = boundaries
      .filter((boundary) => boundary >= minimumUseful && boundary <= target)
      .toSorted((left, right) => {
        const leftSilence = silenceBoundaries.includes(left);
        const rightSilence = silenceBoundaries.includes(right);
        return (
          Number(rightSilence) - Number(leftSilence) ||
          Math.abs(target - left) - Math.abs(target - right)
        );
      })[0];
    const end = candidate ?? target;
    result.push({ start, end });
    start = end;
  }
  if (input.interval.end > start) {
    result.push({ start, end: input.interval.end });
  }
  return result;
}

function alignToSpeechBoundaries(
  interval: Interval,
  speechIntervals: readonly Interval[],
  maxBoundaryAdjustmentSeconds: number,
): Interval {
  const overlapping = speechIntervals.filter(
    (speech) => overlapSeconds(interval, speech) > 0,
  );
  if (overlapping.length === 0) return interval;
  const speechStart = Math.min(...overlapping.map((speech) => speech.start));
  const speechEnd = Math.max(...overlapping.map((speech) => speech.end));
  return {
    start:
      interval.start - speechStart <= maxBoundaryAdjustmentSeconds
        ? Math.min(interval.start, speechStart)
        : interval.start,
    end:
      speechEnd - interval.end <= maxBoundaryAdjustmentSeconds
        ? Math.max(interval.end, speechEnd)
        : interval.end,
  };
}

export function refinementIntervals(input: {
  quality: TranscriptionQuality;
  durationSeconds: number;
  contextSeconds?: number;
  mergeGapSeconds?: number;
  speechIntervals?: readonly Interval[];
  maxMergedRefinementSeconds?: number;
}): { interval: Interval; expandedInterval: Interval }[] {
  const contextSeconds = input.contextSeconds ?? 5;
  const originals = mergeNearbyRefinementIntervals(
    input.quality.segments
      .filter((segment) => segment.status === "needs-refinement")
      .map((segment) => segment.interval),
    input.mergeGapSeconds ?? 1.5,
    {
      maxMergedRefinementSeconds:
        input.maxMergedRefinementSeconds ??
        DEFAULT_MAX_MERGED_REFINEMENT_SECONDS,
      speechIntervals: input.speechIntervals ?? [],
      preferredBoundaries: input.quality.segments.flatMap((segment) => [
        segment.interval.start,
        segment.interval.end,
      ]),
    },
  );
  return originals.map((interval) => {
    const expanded = {
      start: Math.max(0, interval.start - contextSeconds),
      end: Math.min(input.durationSeconds, interval.end + contextSeconds),
    };
    const aligned = alignToSpeechBoundaries(
      expanded,
      input.speechIntervals ?? [],
      contextSeconds,
    );
    const maximumExpanded = Math.min(
      HARD_MAX_MERGED_REFINEMENT_SECONDS,
      Math.max(
        1,
        input.maxMergedRefinementSeconds ??
          DEFAULT_MAX_MERGED_REFINEMENT_SECONDS,
      ),
    );
    const alignedDuration = aligned.end - aligned.start;
    let capped = aligned;
    if (alignedDuration > maximumExpanded) {
      const intervalDuration = interval.end - interval.start;
      const extra = Math.max(0, maximumExpanded - intervalDuration);
      const leading = Math.min(interval.start - aligned.start, extra / 2);
      let start = Math.max(0, interval.start - leading);
      let end = Math.min(input.durationSeconds, start + maximumExpanded);
      if (end < interval.end) {
        end = interval.end;
        start = Math.max(0, end - maximumExpanded);
      }
      capped = { start, end };
    }
    return {
      interval,
      expandedInterval: capped,
    };
  });
}

export function compareTranscripts(input: {
  baselineText: string;
  refinementText: string;
  baselineInterval?: Interval;
  refinementInterval?: Interval;
}): {
  similarity: number;
  timingConsistency: number | null;
  significantDisagreement: boolean;
} {
  const textSimilarity = similarity(input.baselineText, input.refinementText);
  const timingConsistency =
    input.baselineInterval === undefined ||
    input.refinementInterval === undefined
      ? null
      : overlapSeconds(input.baselineInterval, input.refinementInterval) /
        Math.max(
          input.baselineInterval.end - input.baselineInterval.start,
          input.refinementInterval.end - input.refinementInterval.start,
          0.001,
        );
  return {
    similarity: textSimilarity,
    timingConsistency,
    significantDisagreement:
      textSimilarity < 0.75 ||
      (timingConsistency !== null && timingConsistency < 0.5),
  };
}

export function finalizeQualityWithoutRefinement(
  quality: TranscriptionQuality,
): TranscriptionQuality {
  const segments = quality.segments.map((segment) =>
    segment.status === "needs-refinement"
      ? {
          ...segment,
          status: "needs-human-review" as const,
          reasons: [
            ...new Set([...segment.reasons, "automatic-refinement-not-run"]),
          ],
        }
      : segment,
  );
  const needsHumanReviewIntervals = segments
    .filter((segment) => segment.status === "needs-human-review")
    .map((segment) => ({
      ...segment.interval,
      reasons: segment.reasons,
    }));
  return transcriptionQualitySchema.parse({
    ...quality,
    segments,
    summary: {
      ...quality.summary,
      accepted: segments.filter((segment) =>
        ["accepted", "accepted-after-refinement"].includes(segment.status),
      ).length,
      needsRefinement: 0,
      needsHumanReview: segments.filter(
        (segment) => segment.status === "needs-human-review",
      ).length,
    },
    needsHumanReviewCount: needsHumanReviewIntervals.length,
    needsHumanReviewIntervals,
  });
}
