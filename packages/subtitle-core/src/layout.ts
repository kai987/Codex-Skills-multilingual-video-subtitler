import { createHash } from "node:crypto";

import {
  DEFAULT_TIMING_QA_CONFIG,
  countVisibleSubtitleCharacters,
  displayLayoutDecisionSchema,
  lineLayoutIntegrityArtifactSchema,
  type DisplayLayoutDecision,
  type LineLayoutIntegrityArtifact,
  type SubtitleCue,
  type TimingQaConfig,
} from "@mvl/shared";

import { analyzeJapaneseBoundary } from "./japanese-text.js";
import {
  isJapaneseSubtitleText,
  normalizeJapaneseSubtitleWhitespace,
} from "./japanese-typography.js";

export interface SubtitleLayoutOptions {
  maxLines?: number;
  maxCharactersPerLine?: number;
  sourceTimingTrusted?: boolean;
  timingConfig?: Partial<TimingQaConfig> | undefined;
  /**
   * Legacy compatibility switch. The adaptive workflow pre-segments cues with
   * acoustic evidence and disables this presentation-only temporal splitting.
   */
  allowTemporalCueSplitting?: boolean;
  segmentationMode?: "presegmented" | "acoustic-semantic" | "legacy";
}

export interface SubtitleLayoutTimingRecord {
  sourceCueId: string;
  originalInterval: { start: number; end: number };
  outputIntervals: { start: number; end: number }[];
  splitCount: number;
  timingMethod:
    | "preserved-source"
    | "token"
    | "speech-boundary"
    | "pause"
    | "semantic"
    | "vad"
    | "character-ratio";
  characterRatioFallback: boolean;
  reasons: string[];
}

export interface SubtitleLayoutResult {
  cues: SubtitleCue[];
  timingRecords: SubtitleLayoutTimingRecord[];
  characterFallbackSegmentationCount: number;
}

const DEFAULT_MAX_LINES = 2;
const DEFAULT_MAX_CHARACTERS_PER_LINE = 16;
const ASCII_OR_FULLWIDTH_SPACE = /[ \t\u3000]/u;
const NATURAL_BREAK_AFTER = /[ \u3000!?！？…]/u;
const SOFT_JAPANESE_BREAK_AFTER = /[はがをにへとでのもやかねよて]/u;

function visibleCharacters(value: string): string[] {
  return Array.from(value);
}

function trimBreakSpace(value: string): string {
  return value.replace(/^[ \t\u3000]+|[ \t\u3000]+$/gu, "");
}

export function normalizeTypography(
  value: string,
  language?: SubtitleCue["language"],
): string {
  const normalized = value
    .replace(/[０-９]/gu, (digit) =>
      String.fromCharCode(digit.charCodeAt(0) - 0xfee0),
    )
    .replace(/\.{2,}/gu, "…")
    .replace(/[ \t\u3000]+/gu, " ")
    .replace(/ *\n+ */gu, " ")
    .trim();
  return language === "ja" || isJapaneseSubtitleText(normalized)
    ? normalizeJapaneseSubtitleWhitespace(normalized)
    : normalized;
}

function splitLongText(value: string, capacity: number): string[] {
  const chunks: string[] = [];
  let remaining = value;
  while (visibleCharacters(remaining).length > capacity) {
    const characters = visibleCharacters(remaining);
    let splitAt = capacity;
    const minimumSemanticLength = Math.max(1, Math.floor(capacity * 0.55));
    for (let index = capacity; index >= minimumSemanticLength; index -= 1) {
      const previous = characters[index - 1];
      if (previous !== undefined && NATURAL_BREAK_AFTER.test(previous)) {
        splitAt = index;
        break;
      }
    }
    if (splitAt === capacity) {
      for (let index = capacity; index >= minimumSemanticLength; index -= 1) {
        const previous = characters[index - 1];
        if (
          previous !== undefined &&
          SOFT_JAPANESE_BREAK_AFTER.test(previous)
        ) {
          splitAt = index;
          break;
        }
      }
    }
    const head = trimBreakSpace(characters.slice(0, splitAt).join(""));
    if (head !== "") chunks.push(head);
    remaining = trimBreakSpace(characters.slice(splitAt).join(""));
  }
  if (remaining !== "") chunks.push(remaining);
  return chunks;
}

export function lineBreakScore(
  characters: readonly string[],
  index: number,
): number {
  const firstLength = index;
  const secondLength = characters.length - index;
  const previous = characters[index - 1] ?? "";
  const next = characters[index] ?? "";
  const prefix = characters.slice(0, index).join("");
  const suffix = characters.slice(index).join("");
  const japaneseBoundary = analyzeJapaneseBoundary(prefix, suffix);
  if (
    japaneseBoundary.boundarySplitsWord &&
    japaneseBoundary.confidence >= 0.8
  ) {
    return Number.NEGATIVE_INFINITY;
  }
  let score = -Math.abs(firstLength - secondLength) * 2;
  if (japaneseBoundary.confidence >= 0.8) score += 8;
  if (firstLength <= secondLength) score += 3;
  if (secondLength - firstLength >= 1 && secondLength - firstLength <= 3) {
    score += 2;
  }
  if (NATURAL_BREAK_AFTER.test(previous)) score += 24;
  if (ASCII_OR_FULLWIDTH_SPACE.test(next)) score += 6;
  if (SOFT_JAPANESE_BREAK_AFTER.test(previous)) score += 4;
  if (/(?:から|けど|ので|のに|なら|ても|って|さかい)$/u.test(prefix)) {
    score += 10;
  }
  if (
    /[ゃゅょぁぃぅぇぉっゎヵヶャュョァィゥェォッヮー、。，．!?！？）】」』]/u.test(
      next,
    )
  ) {
    score -= 30;
  }
  if (/[A-Za-z0-9]/u.test(previous) && /[A-Za-z0-9]/u.test(next)) {
    score -= 20;
  }
  return score;
}

const PRESENTATION_MARKUP = /\{\\[^}]*\}|<\/?[^>]+>/gu;
const DISPLAY_WHITESPACE = /[\p{White_Space}\u3000]+/gu;
const PROHIBITED_LINE_START =
  /^[ゃゅょぁぃぅぇぉっゎヵヶャュョァィゥェォッヮー、。，．!?！？）】」』]/u;
const PROHIBITED_LINE_END = /[（【「『]$/u;

export function visibleDisplayCharacters(value: string): string[] {
  return Array.from(
    value.replace(PRESENTATION_MARKUP, "").replace(/\r?\n/gu, ""),
  );
}

/**
 * Canonical/display equivalence deliberately removes only presentation
 * markup and display whitespace. It does not normalize Unicode, punctuation,
 * spelling, particles, dialect endings, or music markers.
 */
export function presentationLexicalText(value: string): string {
  return value.replace(PRESENTATION_MARKUP, "").replace(DISPLAY_WHITESPACE, "");
}

export function presentationLexicalHash(value: string): string {
  return createHash("sha256")
    .update(presentationLexicalText(value))
    .digest("hex");
}

function visibleLineLength(value: string): number {
  return Array.from(value.replace(PRESENTATION_MARKUP, "")).length;
}

function displayLinesAreValid(
  value: string,
  maximumLines: number,
  maximumCharactersPerLine: number,
): boolean {
  const lines = value.split(/\r?\n/gu);
  return (
    lines.length <= maximumLines &&
    lines.every((line) => visibleLineLength(line) <= maximumCharactersPerLine)
  );
}

function repeatedChantBoundary(value: string): number | null {
  const units = value.match(/[^!?！？\n]+[!?！？]+/gu) ?? [];
  if (units.length < 4 || units.join("") !== value) return null;
  const normalizedUnits = units.map((unit) =>
    unit.replace(DISPLAY_WHITESPACE, ""),
  );
  if (!normalizedUnits.every((unit) => unit === normalizedUnits[0])) {
    return null;
  }
  return Array.from(units.slice(0, Math.ceil(units.length / 2)).join(""))
    .length;
}

function minimallyCompactJapaneseDisplayWhitespace(
  value: string,
  maximumCharactersPerLine: number,
): string | null {
  if (!isJapaneseSubtitleText(value)) return null;
  const lines = value.split(/\r?\n/gu);
  // Compaction is only a last-mile repair for a human-authored two-line cue
  // whose existing semantic break is already authoritative. A single long
  // line must go through the boundary scorer below so that whitespace is not
  // removed merely to avoid inserting a presentation line break.
  if (lines.length !== 2) return null;
  const compacted = lines.map((line) => {
    let output = line;
    while (visibleLineLength(output) > maximumCharactersPerLine) {
      const characters = Array.from(output);
      const removable = characters
        .map((character, index) => ({ character, index }))
        .filter(
          ({ character, index }) =>
            /[ \t\u3000]/u.test(character) &&
            index > 0 &&
            index < characters.length - 1,
        )
        .at(-1);
      if (removable === undefined) return line;
      characters.splice(removable.index, 1);
      output = characters.join("");
    }
    return output;
  });
  const result = compacted.join("\n");
  return result !== value &&
    displayLinesAreValid(result, 2, maximumCharactersPerLine) &&
    presentationLexicalHash(result) === presentationLexicalHash(value)
    ? result
    : null;
}

function methodForBoundary(input: {
  canonicalText: string;
  flattenedText: string;
  characters: readonly string[];
  index: number;
  style: SubtitleCue["style"];
  chantBoundary: number | null;
}): DisplayLayoutDecision["method"] {
  if (input.chantBoundary === input.index) return "chant-unit-line-break";
  if (input.style === "music" || input.canonicalText.includes("♪")) {
    return "music-decoration-aware-line-break";
  }
  const previous = input.characters[input.index - 1] ?? "";
  if (/[!?！？…、。，．]/u.test(previous)) {
    return "natural-punctuation-line-break";
  }
  const prefix = input.characters.slice(0, input.index).join("");
  if (/(?:は|が|を|に|へ|と|で|の|も|や|から|まで|より|って)$/u.test(prefix)) {
    return "particle-boundary-line-break";
  }
  return "semantic-balanced-line-break";
}

/**
 * Computes a display-only two-line layout. The returned decision never
 * changes cue text, cue count, or timing; callers serialize displayText via a
 * presentation override map while retaining the canonical cue unchanged.
 */
export function resolveDisplayLayout(
  cue: SubtitleCue,
  options: { maximumLines?: number; maximumCharactersPerLine?: number } = {},
): DisplayLayoutDecision {
  const maximumLines = options.maximumLines ?? DEFAULT_MAX_LINES;
  const maximumCharactersPerLine =
    options.maximumCharactersPerLine ?? DEFAULT_MAX_CHARACTERS_PER_LINE;
  const canonicalText = cue.text;
  const canonicalLexicalHash = presentationLexicalHash(canonicalText);
  const existingLines = canonicalText.split(/\r?\n/gu);
  if (
    displayLinesAreValid(canonicalText, maximumLines, maximumCharactersPerLine)
  ) {
    return displayLayoutDecisionSchema.parse({
      decisionId: `layout-${createHash("sha256").update(`${cue.id}\0${canonicalText}`).digest("hex").slice(0, 20)}`,
      cueId: cue.id,
      canonicalText,
      displayText: canonicalText,
      canonicalLexicalHash,
      displayLexicalHash: canonicalLexicalHash,
      lineBreakIndices:
        existingLines.length <= 1
          ? []
          : existingLines
              .slice(0, -1)
              .map((_, index) =>
                existingLines
                  .slice(0, index + 1)
                  .reduce((sum, line) => sum + visibleLineLength(line), 0),
              ),
      lineCount: existingLines.length,
      charactersPerLine: existingLines.map(visibleLineLength),
      maximumLines,
      maximumCharactersPerLine,
      method: "preserved-existing-layout",
      reasons: ["existing-display-layout-satisfies-hard-capacity"],
      changed: false,
      resolved: true,
      blocking: false,
    });
  }

  const compactedExistingLayout = minimallyCompactJapaneseDisplayWhitespace(
    canonicalText,
    maximumCharactersPerLine,
  );
  if (compactedExistingLayout !== null) {
    const compactedLines = compactedExistingLayout.split(/\r?\n/gu);
    return displayLayoutDecisionSchema.parse({
      decisionId: `layout-${createHash("sha256").update(`${cue.id}\0${canonicalText}`).digest("hex").slice(0, 20)}`,
      cueId: cue.id,
      canonicalText,
      displayText: compactedExistingLayout,
      canonicalLexicalHash,
      displayLexicalHash: presentationLexicalHash(compactedExistingLayout),
      lineBreakIndices: compactedLines
        .slice(0, -1)
        .map((_, index) =>
          compactedLines
            .slice(0, index + 1)
            .reduce((sum, line) => sum + visibleLineLength(line), 0),
        ),
      lineCount: compactedLines.length,
      charactersPerLine: compactedLines.map(visibleLineLength),
      maximumLines,
      maximumCharactersPerLine,
      method: "semantic-balanced-line-break",
      reasons: [
        "preserved-existing-semantic-line-boundary",
        "minimally-compacted-display-only-japanese-whitespace",
        "canonical-text-and-timing-preserved",
        "canonical-display-lexical-hash-match",
      ],
      changed: true,
      resolved: true,
      blocking: false,
    });
  }

  const flattenedText = canonicalText.replace(/\r?\n/gu, "");
  const characters = Array.from(flattenedText);
  const visibleCount = visibleDisplayCharacters(flattenedText).length;
  const capacity = maximumLines * maximumCharactersPerLine;
  let best:
    | {
        index: number;
        left: string;
        right: string;
        score: number;
      }
    | undefined;
  const chantBoundary = repeatedChantBoundary(flattenedText);
  if (visibleCount <= capacity && maximumLines === 2) {
    for (let index = 1; index < characters.length; index += 1) {
      const left = trimBreakSpace(characters.slice(0, index).join(""));
      const right = trimBreakSpace(characters.slice(index).join(""));
      if (
        left === "" ||
        right === "" ||
        visibleLineLength(left) > maximumCharactersPerLine ||
        visibleLineLength(right) > maximumCharactersPerLine ||
        PROHIBITED_LINE_START.test(right.replace(PRESENTATION_MARKUP, "")) ||
        PROHIBITED_LINE_END.test(left.replace(PRESENTATION_MARKUP, ""))
      ) {
        continue;
      }
      const previous = characters[index - 1] ?? "";
      const next = characters[index] ?? "";
      const explicitWhitespaceBoundary =
        /[ \t\u3000]/u.test(previous) || /[ \t\u3000]/u.test(next);
      const leftDecoration = left.replace(PRESENTATION_MARKUP, "").trim();
      const rightDecoration = right.replace(PRESENTATION_MARKUP, "").trim();
      if (
        (cue.style === "music" || canonicalText.includes("♪")) &&
        (leftDecoration === "♪" || rightDecoration === "♪")
      ) {
        continue;
      }
      if (/[A-Za-z0-9]/u.test(previous) && /[A-Za-z0-9]/u.test(next)) {
        continue;
      }
      const boundary = analyzeJapaneseBoundary(
        left.replace(PRESENTATION_MARKUP, ""),
        right.replace(PRESENTATION_MARKUP, ""),
      );
      if (
        !explicitWhitespaceBoundary &&
        boundary.boundarySplitsWord &&
        boundary.confidence >= 0.8
      ) {
        continue;
      }
      let score: number;
      if (explicitWhitespaceBoundary) {
        const leftLength = visibleLineLength(left);
        const rightLength = visibleLineLength(right);
        score =
          -Math.abs(leftLength - rightLength) * 2 +
          (leftLength <= rightLength ? 3 : 0) +
          30;
      } else {
        score = lineBreakScore(characters, index);
      }
      if (!Number.isFinite(score)) continue;
      if (chantBoundary === index) score += 100;
      if (
        best === undefined ||
        score > best.score ||
        (score === best.score && index < best.index)
      ) {
        best = { index, left, right, score };
      }
    }
  }

  const displayText =
    best === undefined ? canonicalText : `${best.left}\n${best.right}`;
  const displayLexicalHash = presentationLexicalHash(displayText);
  const lines = displayText.split(/\r?\n/gu);
  const lexicalParity = canonicalLexicalHash === displayLexicalHash;
  const resolved =
    best !== undefined &&
    lexicalParity &&
    displayLinesAreValid(displayText, maximumLines, maximumCharactersPerLine);
  const method =
    best === undefined
      ? "unresolved"
      : methodForBoundary({
          canonicalText,
          flattenedText,
          characters,
          index: best.index,
          style: cue.style,
          chantBoundary,
        });
  return displayLayoutDecisionSchema.parse({
    decisionId: `layout-${createHash("sha256").update(`${cue.id}\0${canonicalText}`).digest("hex").slice(0, 20)}`,
    cueId: cue.id,
    canonicalText,
    displayText,
    canonicalLexicalHash,
    displayLexicalHash,
    lineBreakIndices: best === undefined ? [] : [visibleLineLength(best.left)],
    lineCount: lines.length,
    charactersPerLine: lines.map(visibleLineLength),
    maximumLines,
    maximumCharactersPerLine,
    method,
    reasons: resolved
      ? [
          "display-only-line-break",
          "canonical-text-and-timing-preserved",
          "canonical-display-lexical-hash-match",
        ]
      : [
          visibleCount > capacity
            ? "display-text-exceeds-two-line-capacity"
            : "no-safe-japanese-line-boundary",
          ...(lexicalParity ? [] : ["canonical-display-lexical-hash-mismatch"]),
          "no-temporal-cue-split-created",
          "no-character-ratio-timing-used",
        ],
    changed: resolved && displayText !== canonicalText,
    resolved,
    blocking: !resolved,
  });
}

function balanceLines(value: string, maximum: number): string {
  const characters = visibleCharacters(value);
  if (characters.length <= maximum) return value;
  const minimum = Math.max(1, characters.length - maximum);
  const maximumSplit = Math.min(maximum, characters.length - 1);
  let bestIndex: number | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let index = minimum; index <= maximumSplit; index += 1) {
    const left = trimBreakSpace(characters.slice(0, index).join(""));
    const right = trimBreakSpace(characters.slice(index).join(""));
    if (
      visibleCharacters(left).length > maximum ||
      visibleCharacters(right).length > maximum ||
      left === "" ||
      right === ""
    ) {
      continue;
    }
    const score = lineBreakScore(characters, index);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  if (bestIndex === null) return value;
  const first = trimBreakSpace(characters.slice(0, bestIndex).join(""));
  const second = trimBreakSpace(characters.slice(bestIndex).join(""));
  return `${first}\n${second}`;
}

function decorateMusic(value: string): string {
  const undecorated = value.replace(/^♪\s*/u, "").replace(/\s*♪$/u, "").trim();
  return `♪ ${undecorated} ♪`;
}

function cueWeight(text: string): number {
  return Math.max(1, countVisibleSubtitleCharacters(text));
}

function proportionalIntervals(input: {
  start: number;
  end: number;
  weights: readonly number[];
}): { start: number; end: number }[] {
  const totalWeight = input.weights.reduce((sum, weight) => sum + weight, 0);
  const duration = Math.max(0.001, input.end - input.start);
  let elapsedWeight = 0;
  return input.weights.map((weight, index) => {
    const start = input.start + (duration * elapsedWeight) / totalWeight;
    elapsedWeight += weight;
    return {
      start,
      end:
        index === input.weights.length - 1
          ? input.end
          : input.start + (duration * elapsedWeight) / totalWeight,
    };
  });
}

function equalIntervals(input: {
  start: number;
  end: number;
  count: number;
}): { start: number; end: number }[] {
  return Array.from({ length: input.count }, (_, index) => ({
    start: input.start + ((input.end - input.start) * index) / input.count,
    end:
      index === input.count - 1
        ? input.end
        : input.start + ((input.end - input.start) * (index + 1)) / input.count,
  }));
}

function tokenAlignedIntervals(input: {
  cue: SubtitleCue;
  chunks: readonly string[];
}): { start: number; end: number }[] | null {
  const tokens = (input.cue.timingEvidence?.tokens ?? [])
    .filter(
      (token) =>
        token.text.trim() !== "" &&
        token.end > token.start &&
        token.start >= input.cue.start - 1 &&
        token.end <= input.cue.end + 1,
    )
    .toSorted((left, right) => left.start - right.start);
  if (tokens.length === 0) return null;
  const tokenWeights = tokens.map((token) =>
    Math.max(1, countVisibleSubtitleCharacters(token.text)),
  );
  const chunkWeights = input.chunks.map(cueWeight);
  const totalChunkWeight = chunkWeights.reduce(
    (sum, weight) => sum + weight,
    0,
  );
  const totalTokenWeight = tokenWeights.reduce(
    (sum, weight) => sum + weight,
    0,
  );
  const boundaries = [Math.max(input.cue.start, tokens[0]?.start ?? 0)];
  let tokenCursor = 0;
  let tokenCharacters = tokenWeights[0] ?? 0;
  let chunkCharacters = 0;
  for (let index = 0; index < input.chunks.length - 1; index += 1) {
    chunkCharacters += chunkWeights[index] ?? 0;
    const target =
      (chunkCharacters / Math.max(1, totalChunkWeight)) * totalTokenWeight;
    while (tokenCursor < tokens.length - 1 && tokenCharacters < target) {
      tokenCursor += 1;
      tokenCharacters += tokenWeights[tokenCursor] ?? 0;
    }
    boundaries.push(
      Math.max(
        boundaries.at(-1) ?? input.cue.start,
        Math.min(input.cue.end, tokens[tokenCursor]?.end ?? input.cue.end),
      ),
    );
  }
  boundaries.push(Math.min(input.cue.end, tokens.at(-1)?.end ?? input.cue.end));
  const intervals = input.chunks.map((_, index) => ({
    start: boundaries[index] ?? input.cue.start,
    end: boundaries[index + 1] ?? input.cue.end,
  }));
  return intervals.every((interval) => interval.end > interval.start)
    ? intervals
    : null;
}

function pauseAlignedIntervals(input: {
  cue: SubtitleCue;
  count: number;
  tailSeconds: number;
}): { start: number; end: number }[] | null {
  const speech = (input.cue.timingEvidence?.speechIntervals ?? [])
    .filter(
      (interval) =>
        interval.end > interval.start &&
        interval.start >= input.cue.start - 1 &&
        interval.end <= input.cue.end + 1,
    )
    .toSorted((left, right) => left.start - right.start);
  if (input.count <= 1 || speech.length < input.count) return null;
  const gapIndexes = Array.from({ length: speech.length - 1 }, (_, index) => ({
    index,
    duration: (speech[index + 1]?.start ?? 0) - (speech[index]?.end ?? 0),
  }))
    .filter((gap) => gap.duration > 0.1)
    .toSorted((left, right) => right.duration - left.duration)
    .slice(0, input.count - 1)
    .map((gap) => gap.index)
    .toSorted((left, right) => left - right);
  if (gapIndexes.length !== input.count - 1) return null;
  const groups: { start: number; end: number }[] = [];
  let groupStart = 0;
  for (const gapIndex of gapIndexes) {
    const first = speech[groupStart];
    const last = speech[gapIndex];
    const next = speech[gapIndex + 1];
    if (first === undefined || last === undefined || next === undefined) {
      return null;
    }
    groups.push({
      start: first.start,
      end: Math.min(last.end + input.tailSeconds, next.start),
    });
    groupStart = gapIndex + 1;
  }
  const first = speech[groupStart];
  const last = speech.at(-1);
  if (first === undefined || last === undefined) return null;
  groups.push({
    start: first.start,
    end: Math.min(input.cue.end, last.end + input.tailSeconds),
  });
  return groups.length === input.count &&
    groups.every((interval) => interval.end > interval.start)
    ? groups
    : null;
}

function chunksUseSemanticBoundaries(chunks: readonly string[]): boolean {
  return chunks.slice(0, -1).every((chunk) => {
    const last = Array.from(chunk).at(-1) ?? "";
    return (
      NATURAL_BREAK_AFTER.test(last) ||
      SOFT_JAPANESE_BREAK_AFTER.test(last) ||
      /(?:から|けど|ので|のに|なら|ても|って|さかい)$/u.test(chunk)
    );
  });
}

export function layoutSubtitleCuesWithDiagnostics(
  cues: readonly SubtitleCue[],
  options: SubtitleLayoutOptions = {},
): SubtitleLayoutResult {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const maxCharactersPerLine =
    options.maxCharactersPerLine ?? DEFAULT_MAX_CHARACTERS_PER_LINE;
  if (maxLines !== 2 || maxCharactersPerLine < 4) {
    throw new RangeError(
      "Subtitle layout currently requires two lines and at least four characters per line.",
    );
  }
  const config: TimingQaConfig = {
    ...DEFAULT_TIMING_QA_CONFIG,
    ...options.timingConfig,
  };
  const timingRecords: SubtitleLayoutTimingRecord[] = [];
  let characterFallbackSegmentationCount = 0;
  const outputCues = cues.flatMap((cue) => {
    const normalized = normalizeTypography(cue.text, cue.language) || "…";
    const musicOverhead = cue.style === "music" ? 4 : 0;
    const cueCapacity = maxLines * maxCharactersPerLine - musicOverhead;
    const allowTemporalCueSplitting =
      options.allowTemporalCueSplitting ??
      options.segmentationMode === "legacy";
    const exceedsPresentationCapacity =
      visibleCharacters(normalized).length > cueCapacity;
    const chunks = allowTemporalCueSplitting
      ? splitLongText(normalized, cueCapacity)
      : [normalized];
    const decorated = chunks.map((chunk) =>
      cue.style === "music" ? decorateMusic(chunk) : chunk,
    );
    const weights = decorated.map(cueWeight);
    const sourceTrusted =
      options.sourceTimingTrusted === true ||
      cue.timingEvidence?.sourceTrusted === true;
    let timingMethod: SubtitleLayoutTimingRecord["timingMethod"] = sourceTrusted
      ? "preserved-source"
      : "semantic";
    let characterRatioFallback = false;
    let reasons: string[] = [];
    let intervals: { start: number; end: number }[];
    if (decorated.length === 1) {
      intervals = [{ start: cue.start, end: cue.end }];
      if (!allowTemporalCueSplitting && exceedsPresentationCapacity) {
        reasons = [
          "SEGMENTATION_UNRESOLVED",
          "PRESENTATION_LAYOUT_DID_NOT_CREATE_UNTIMED_CUE_SPLIT",
        ];
      }
    } else {
      const tokenIntervals =
        sourceTrusted || cue.style === "music" || cue.style === "thought"
          ? null
          : tokenAlignedIntervals({ cue, chunks: decorated });
      const pauseIntervals =
        sourceTrusted || cue.style === "music" || cue.style === "thought"
          ? null
          : pauseAlignedIntervals({
              cue,
              count: decorated.length,
              tailSeconds: config.dialogueTailSeconds,
            });
      if (tokenIntervals !== null) {
        intervals = tokenIntervals;
        timingMethod = "token";
      } else if (pauseIntervals !== null) {
        intervals = pauseIntervals;
        timingMethod = "pause";
      } else if (
        !sourceTrusted &&
        cue.style === undefined &&
        cue.timingEvidence?.speechStart !== null &&
        cue.timingEvidence?.speechStart !== undefined &&
        cue.timingEvidence.speechEnd !== null
      ) {
        intervals = equalIntervals({
          start: Math.max(cue.start, cue.timingEvidence.speechStart),
          end: Math.min(
            cue.end,
            cue.timingEvidence.speechEnd + config.dialogueTailSeconds,
          ),
          count: decorated.length,
        });
        timingMethod = chunksUseSemanticBoundaries(chunks)
          ? "semantic"
          : cue.timingEvidence.alignmentSource === "vad"
            ? "vad"
            : "speech-boundary";
        reasons =
          timingMethod === "semantic"
            ? ["SPLIT_BOUNDARY_NOT_SPEECH_ALIGNED"]
            : [];
      } else {
        const originalDuration = cue.end - cue.start;
        const allocatedDuration =
          sourceTrusted || cue.style === "music" || cue.style === "thought"
            ? originalDuration
            : Math.min(
                originalDuration,
                decorated.length * config.maximumPresentationCueSeconds,
              );
        intervals = proportionalIntervals({
          start: cue.start,
          end: cue.start + allocatedDuration,
          weights,
        });
        timingMethod = sourceTrusted ? "preserved-source" : "character-ratio";
        characterRatioFallback = !sourceTrusted;
        if (characterRatioFallback) characterFallbackSegmentationCount += 1;
        reasons = sourceTrusted
          ? []
          : [
              "PRESENTATION_SPLIT_TIMING_ESTIMATE",
              "SPLIT_BOUNDARY_NOT_SPEECH_ALIGNED",
            ];
      }
    }
    const laidOut = decorated.map((text, index) => {
      const interval = intervals[index] ?? {
        start: cue.start,
        end: cue.end,
      };
      return {
        ...cue,
        id:
          decorated.length === 1
            ? cue.id
            : `${cue.id}-${String(index + 1).padStart(2, "0")}`,
        start: interval.start,
        end: interval.end,
        text: balanceLines(text, maxCharactersPerLine),
        timingEvidence: {
          sourceTrusted,
          speechStart: cue.timingEvidence?.speechStart ?? null,
          speechEnd: cue.timingEvidence?.speechEnd ?? null,
          tokenTimestampsAvailable:
            cue.timingEvidence?.tokenTimestampsAvailable ?? false,
          tokenTimestampsUsed: timingMethod === "token",
          tokens: cue.timingEvidence?.tokens ?? [],
          alignmentSource:
            timingMethod === "preserved-source"
              ? ("source" as const)
              : timingMethod === "token"
                ? ("token" as const)
                : timingMethod === "speech-boundary"
                  ? ("speech" as const)
                  : timingMethod === "pause"
                    ? ("pause" as const)
                    : timingMethod === "vad"
                      ? ("vad" as const)
                      : timingMethod === "character-ratio"
                        ? ("character-ratio" as const)
                        : ("semantic" as const),
          presentationTimingMethod: timingMethod,
          ...(cue.timingEvidence?.chunkBoundaryConflict === undefined
            ? {}
            : {
                chunkBoundaryConflict: cue.timingEvidence.chunkBoundaryConflict,
              }),
          ...(cue.timingEvidence?.speechIntervals === undefined
            ? {}
            : {
                speechIntervals: cue.timingEvidence.speechIntervals,
              }),
          ...(cue.timingEvidence?.speechBoundarySource === undefined
            ? {}
            : {
                speechBoundarySource: cue.timingEvidence.speechBoundarySource,
              }),
        },
      };
    });
    timingRecords.push({
      sourceCueId: cue.id,
      originalInterval: { start: cue.start, end: cue.end },
      outputIntervals: laidOut.map((item) => ({
        start: item.start,
        end: item.end,
      })),
      splitCount: decorated.length,
      timingMethod,
      characterRatioFallback,
      reasons,
    });
    return laidOut;
  });
  return {
    cues: outputCues,
    timingRecords,
    characterFallbackSegmentationCount,
  };
}

/**
 * Applies the broadcast layout contract. Generated cue splits use token or
 * acoustic evidence before a bounded, explicitly recorded ratio fallback.
 */
export function layoutSubtitleCues(
  cues: readonly SubtitleCue[],
  options: SubtitleLayoutOptions = {},
): SubtitleCue[] {
  return layoutSubtitleCuesWithDiagnostics(cues, options).cues;
}

export function evaluateLineLayoutIntegrity(
  cues: readonly SubtitleCue[],
  options: { maximumLines?: number; maximumCharactersPerLine?: number } = {},
): LineLayoutIntegrityArtifact {
  const maximumLines = options.maximumLines ?? DEFAULT_MAX_LINES;
  const maximumCharactersPerLine =
    options.maximumCharactersPerLine ?? DEFAULT_MAX_CHARACTERS_PER_LINE;
  const findings: LineLayoutIntegrityArtifact["findings"] = [];
  for (const cue of cues) {
    const lines = cue.text.split("\n");
    if (lines.length > maximumLines) {
      findings.push({
        id: `line-layout-integrity-${String(findings.length + 1).padStart(5, "0")}`,
        code: "FINAL_CUE_EXCEEDS_TWO_LINES",
        cueId: cue.id,
        lineIndex: null,
        observed: lines.length,
        maximum: maximumLines,
        reasons: ["rendered-cue-exceeds-maximum-line-count"],
      });
    }
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex] ?? "";
      const characterCount = Array.from(
        line.replace(/\{\\[^}]*\}/gu, "").replace(/<\/?[^>]+>/gu, ""),
      ).length;
      if (characterCount > maximumCharactersPerLine) {
        findings.push({
          id: `line-layout-integrity-${String(findings.length + 1).padStart(5, "0")}`,
          code: "FINAL_LINE_EXCEEDS_CHARACTER_LIMIT",
          cueId: cue.id,
          lineIndex,
          observed: characterCount,
          maximum: maximumCharactersPerLine,
          reasons: ["rendered-line-exceeds-hard-character-capacity"],
        });
      }
    }
    if (
      lines.length > maximumLines ||
      lines.some(
        (line) =>
          Array.from(
            line.replace(/\{\\[^}]*\}/gu, "").replace(/<\/?[^>]+>/gu, ""),
          ).length > maximumCharactersPerLine,
      )
    ) {
      findings.push({
        id: `line-layout-integrity-${String(findings.length + 1).padStart(5, "0")}`,
        code: "FINAL_UNRESOLVED_PRESENTATION_CAPACITY",
        cueId: cue.id,
        lineIndex: null,
        observed: Array.from(cue.text.replace(/\n/gu, "")).length,
        maximum: maximumLines * maximumCharactersPerLine,
        reasons: ["segmentation-or-layout-could-not-satisfy-hard-capacity"],
      });
    }
    let consumed = 0;
    for (let index = 0; index < lines.length - 1; index += 1) {
      const left = lines.slice(0, index + 1).join("");
      const right = lines.slice(index + 1).join("");
      consumed += Array.from(lines[index] ?? "").length;
      const boundary = analyzeJapaneseBoundary(left, right);
      if (boundary.boundarySplitsWord && boundary.confidence >= 0.8) {
        findings.push({
          id: `line-layout-integrity-${String(findings.length + 1).padStart(5, "0")}`,
          code: "FINAL_VISUAL_LINE_WORD_BREAK",
          cueId: cue.id,
          lineBoundaryIndex: consumed,
          left,
          right,
          reasons: boundary.evidence,
        });
      }
    }
  }
  return lineLayoutIntegrityArtifactSchema.parse({
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    inputHash: createLayoutHash(cues),
    findings,
    visualLineWordBreakCount: findings.filter(
      (finding) => finding.code === "FINAL_VISUAL_LINE_WORD_BREAK",
    ).length,
    lineTooLongCount: findings.filter(
      (finding) => finding.code === "FINAL_LINE_EXCEEDS_CHARACTER_LIMIT",
    ).length,
    tooManyLinesCount: findings.filter(
      (finding) => finding.code === "FINAL_CUE_EXCEEDS_TWO_LINES",
    ).length,
    unresolvedCapacityCount: findings.filter(
      (finding) => finding.code === "FINAL_UNRESOLVED_PRESENTATION_CAPACITY",
    ).length,
    validationStatus: findings.length === 0 ? "passed" : "needs-review",
  });
}

function createLayoutHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
