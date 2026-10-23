import { createHash } from "node:crypto";

import {
  canonicalAlignmentCueInputSchema,
  forcedAlignmentComponentSchema,
  subtitleOverlapAcousticResolutionSchema,
  subtitlePresentationResolutionSchema,
  subtitleCanonicalAlignmentInputSchema,
  subtitleCanonicalForcedAlignmentSchema,
  type AntiForcingMetrics,
  type CanonicalAlignmentCueInput,
  type CanonicalAlignmentWordUnit,
  type CanonicalMorpheme,
  type EvidenceDpResult,
  type EvidenceDpUnit,
  type ForcedAlignmentAttempt,
  type ForcedAlignmentComponent,
  type ForcedAlignmentConfiguration,
  type ForcedAlignmentCueDecision,
  type ForcedAlignmentHypothesis,
  type ForcedAlignmentMode,
  type ForcedAlignmentTimingMutation,
  type SourceFingerprint,
  type SubtitleCanonicalAlignmentInput,
  type SubtitleCanonicalForcedAlignment,
  type SubtitleCue,
  type SubtitleOverlapAcousticResolution,
} from "@mvl/shared";

import {
  buildPresentationCueHash,
  presentationResolutionHash,
  summarizeSrtOverlapStatus,
  type SubtitlePresentationResolutionResult,
} from "./presentation-resolution.js";

export const FORCED_ALIGNMENT_OUTPUT_PARSER_VERSION =
  "c5-17-1-praatio-lexical-utterance-boundary-v1";
export const ANTI_FORCE_POLICY_VERSION = "c5-17-1-anti-forcing-v1";
export const JOINT_ASSIGNMENT_POLICY_VERSION =
  "c5-17-1-actionable-component-joint-assignment-v1";

export const DEFAULT_FORCED_ALIGNMENT_CONFIGURATION = {
  mode: "enforce",
  backend: "hybrid",
  narrowContextSeconds: 0.5,
  expandedContextSeconds: 1,
  maximumAttemptsPerCue: 2,
  maximumTotalAlignmentAttempts: 32,
  concurrency: 1,
  minimumWordCoverageRatio: 0.82,
  minimumReadingCoverageRatio: 0.82,
  minimumPhoneCoverageRatio: 0.72,
  minimumCanonicalUnitCoverageRatio: 0.82,
  minimumPronunciationUnitCoverageRatio: 0.82,
  minimumExpectedPhoneCoverageRatio: 0.72,
  maximumWindowBoundaryDifferenceSeconds: 0.2,
  maximumTimingAdjustmentSeconds: 0.5,
  minimumPostRepairCueDurationSeconds: 0.4,
  maximumNeighborIntrusionRatio: 0.2,
  minimumBestHypothesisScore: 0.72,
  minimumDecisionMargin: 0.08,
  antiForcePolicyVersion: ANTI_FORCE_POLICY_VERSION,
  jointAssignmentPolicyVersion: JOINT_ASSIGNMENT_POLICY_VERSION,
  outputParserVersion: FORCED_ALIGNMENT_OUTPUT_PARSER_VERSION,
  textGridLexicalBoundaryPolicyVersion: "c5.17.1-lexical-utterance-boundary-v1",
  wordUnitMappingPolicyVersion: "c5.17.1-word-unit-sequence-mapping-v1",
  pronunciationCoveragePolicyVersion: "c5.17.1-pronunciation-phone-coverage-v1",
  boundaryAgreementPolicyVersion: "c5.17.1-two-sided-boundary-agreement-v1",
  g2pPreparationPolicyVersion: "c5.17.1-mfa-g2p-preparation-v1",
  wholeMediaAsrAllowed: false,
  whisperPromptAllowed: false,
} as const satisfies ForcedAlignmentConfiguration;

const DIALECT_FORMS = [
  "あきまへん",
  "せえへん",
  "なっちゃる",
  "さかわしい",
  "あんじょう",
  "なんや",
  "やけど",
  "買うた",
] as const;

const PUNCTUATION_PATTERN = /^[\p{P}\p{S}\s]+$/u;
const ALIGNMENT_PUNCTUATION_PATTERN = /([、。！？!?…：:；;「」『』（）()])/gu;
const STYLE_MARKER_PATTERN = /\{[^}\r\n]*\}|<[^>\r\n]*>/gu;

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .toSorted()
      .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function requiredAt<T>(
  values: readonly T[],
  index: number,
  context: string,
): T {
  const value = values[index];
  if (value === undefined) {
    throw new RangeError(`Missing ${context} at index ${String(index)}.`);
  }
  return value;
}

export function forcedAlignmentSha256(value: unknown): string {
  return createHash("sha256").update(stable(value)).digest("hex");
}

export function katakanaToHiragana(value: string): string {
  return Array.from(value)
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint >= 0x30a1 && codePoint <= 0x30f6
        ? String.fromCodePoint(codePoint - 0x60)
        : character;
    })
    .join("");
}

export interface AlignmentTextNormalization {
  alignmentText: string;
  displayNewlinesRemoved: number;
  styleMarkersRemoved: number;
}

/**
 * Produces a pronunciation/alignment representation without ever mutating the
 * authoritative cue text. Punctuation is separated, not silently discarded.
 */
export function normalizeCanonicalAlignmentText(
  canonicalText: string,
): AlignmentTextNormalization {
  const styleMarkers = canonicalText.match(STYLE_MARKER_PATTERN) ?? [];
  const withoutStyle = canonicalText.replace(STYLE_MARKER_PATTERN, " ");
  const newlines = withoutStyle.match(/\r\n|\r|\n/gu) ?? [];
  const alignmentText = withoutStyle
    .replace(/\r\n|\r|\n/gu, " ")
    .normalize("NFKC")
    .replace(ALIGNMENT_PUNCTUATION_PATTERN, " $1 ")
    .replace(/\s+/gu, " ")
    .trim();
  return {
    alignmentText,
    displayNewlinesRemoved: newlines.length,
    styleMarkersRemoved: styleMarkers.length,
  };
}

export interface SudachiMorphemeAnalysis {
  surface: string;
  normalizedSurface: string;
  dictionaryForm: string;
  reading: string | null;
  partOfSpeech: readonly string[];
  isOov: boolean;
  startCharacter: number;
  endCharacter: number;
}

export interface VerifiedTerminologyReading {
  surface: string;
  reading: string;
  evidenceId: string;
}

function isKanaLiteral(value: string): boolean {
  return (
    value.length > 0 &&
    /^[\p{Script=Hiragana}\p{Script=Katakana}ー\s\p{P}\p{S}]+$/u.test(value)
  );
}

function fallbackMorphemes(text: string): SudachiMorphemeAnalysis[] {
  const values: SudachiMorphemeAnalysis[] = [];
  const matcher =
    /[\p{Script=Han}々〆ヶ]+|[\p{Script=Hiragana}ー]+|[\p{Script=Katakana}ー]+|[\p{L}\p{N}]+|[^\s]/gu;
  for (const match of text.matchAll(matcher)) {
    const surface = match[0];
    const startCharacter = Array.from(text.slice(0, match.index)).length;
    const endCharacter = startCharacter + Array.from(surface).length;
    const kana = isKanaLiteral(surface) && !PUNCTUATION_PATTERN.test(surface);
    values.push({
      surface,
      normalizedSurface: surface.normalize("NFKC"),
      dictionaryForm: surface,
      reading: kana ? katakanaToHiragana(surface.normalize("NFKC")) : null,
      partOfSpeech: [PUNCTUATION_PATTERN.test(surface) ? "補助記号" : "未知語"],
      isOov: !kana && !PUNCTUATION_PATTERN.test(surface),
      startCharacter,
      endCharacter,
    });
  }
  return values;
}

function readingForMorpheme(input: {
  morpheme: SudachiMorphemeAnalysis;
  terminology: readonly VerifiedTerminologyReading[];
}): {
  reading: string | null;
  source: CanonicalMorpheme["readingSource"];
  terminologyMatch: VerifiedTerminologyReading | null;
} {
  const terminologyMatch = input.terminology.find(
    (entry) =>
      entry.surface.normalize("NFKC") ===
      input.morpheme.surface.normalize("NFKC"),
  );
  if (terminologyMatch !== undefined) {
    return {
      reading: katakanaToHiragana(terminologyMatch.reading.normalize("NFKC")),
      source: "verified-terminology",
      terminologyMatch,
    };
  }
  if (
    !input.morpheme.isOov &&
    input.morpheme.reading !== null &&
    input.morpheme.reading.trim() !== "" &&
    input.morpheme.reading !== "*"
  ) {
    return {
      reading: katakanaToHiragana(input.morpheme.reading.normalize("NFKC")),
      source: "sudachi-dictionary",
      terminologyMatch: null,
    };
  }
  if (isKanaLiteral(input.morpheme.surface)) {
    return {
      reading: katakanaToHiragana(input.morpheme.surface.normalize("NFKC")),
      source: "kana-literal",
      terminologyMatch: null,
    };
  }
  return { reading: null, source: "unresolved", terminologyMatch: null };
}

export function buildCanonicalAlignmentCue(input: {
  cue: SubtitleCue;
  componentId: string;
  sudachiMorphemes?: readonly SudachiMorphemeAnalysis[];
  terminology?: readonly VerifiedTerminologyReading[];
}): CanonicalAlignmentCueInput {
  const normalized = normalizeCanonicalAlignmentText(input.cue.text);
  if (normalized.alignmentText === "") {
    throw new Error(`Cue ${input.cue.id} has no alignable text.`);
  }
  const analyses =
    input.sudachiMorphemes === undefined
      ? fallbackMorphemes(normalized.alignmentText)
      : [...input.sudachiMorphemes];
  const alignmentCharacters = Array.from(normalized.alignmentText);
  let previousEndCharacter = 0;
  for (const morpheme of analyses) {
    const actualSurface = alignmentCharacters
      .slice(morpheme.startCharacter, morpheme.endCharacter)
      .join("");
    if (
      morpheme.startCharacter < previousEndCharacter ||
      morpheme.endCharacter <= morpheme.startCharacter ||
      morpheme.endCharacter > alignmentCharacters.length ||
      actualSurface !== morpheme.surface
    ) {
      throw new Error(
        `Cue ${input.cue.id} has invalid Sudachi morpheme offsets for ${morpheme.surface}.`,
      );
    }
    previousEndCharacter = morpheme.endCharacter;
  }
  const terminology = input.terminology ?? [];
  const matches: VerifiedTerminologyReading[] = [];
  const morphemes = analyses.map((morpheme): CanonicalMorpheme => {
    const resolved = readingForMorpheme({ morpheme, terminology });
    if (resolved.terminologyMatch !== null) {
      matches.push(resolved.terminologyMatch);
    }
    return {
      surface: morpheme.surface,
      normalizedSurface: morpheme.normalizedSurface.normalize("NFKC"),
      dictionaryForm: morpheme.dictionaryForm,
      reading: resolved.reading,
      partOfSpeech: [...morpheme.partOfSpeech],
      isOov: morpheme.isOov,
      startCharacter: morpheme.startCharacter,
      endCharacter: morpheme.endCharacter,
      readingSource: resolved.source,
      dialectSurface:
        DIALECT_FORMS.find((form) => morpheme.surface.includes(form)) ?? null,
    };
  });
  const wordUnits: CanonicalAlignmentWordUnit[] = morphemes.map(
    (morpheme, index) => {
      const punctuation = PUNCTUATION_PATTERN.test(morpheme.surface);
      return {
        unitId: `canonical-unit-${forcedAlignmentSha256({ cueId: input.cue.id, index, surface: morpheme.surface }).slice(0, 20)}`,
        surface: morpheme.surface,
        normalizedSurface: morpheme.normalizedSurface,
        reading: morpheme.reading,
        readingSource: morpheme.readingSource,
        morphemeIndexes: [index],
        punctuation,
        criticalOov: !punctuation && morpheme.readingSource === "unresolved",
      };
    },
  );
  const lexicalUnits = wordUnits.filter((unit) => !unit.punctuation);
  const resolvedUnits = lexicalUnits.filter((unit) => unit.reading !== null);
  const unresolvedOov = lexicalUnits
    .filter((unit) => unit.criticalOov)
    .map((unit) => unit.surface);
  const normalizedReading =
    unresolvedOov.length === 0 && resolvedUnits.length > 0
      ? resolvedUnits.map((unit) => unit.reading).join("")
      : null;
  return canonicalAlignmentCueInputSchema.parse({
    cueId: input.cue.id,
    componentId: input.componentId,
    originalInterval: { start: input.cue.start, end: input.cue.end },
    canonicalText: input.cue.text,
    canonicalTextSha256: forcedAlignmentSha256(input.cue.text),
    alignmentText: normalized.alignmentText,
    alignmentTextSha256: forcedAlignmentSha256(normalized.alignmentText),
    displayNewlinesRemoved: normalized.displayNewlinesRemoved,
    styleMarkersRemoved: normalized.styleMarkersRemoved,
    punctuationHandling: "separated-not-deleted-from-canonical",
    morphemes,
    wordUnits,
    normalizedReading,
    readingAvailable: resolvedUnits.length > 0 && unresolvedOov.length === 0,
    readingCoverageRatio:
      lexicalUnits.length === 0
        ? 0
        : resolvedUnits.length / lexicalUnits.length,
    unresolvedOov,
    verifiedTerminologyMatches: [
      ...new Map(matches.map((entry) => [entry.evidenceId, entry])).values(),
    ],
    alignmentEligibility: lexicalUnits.length > 0,
    blockers: [
      ...(lexicalUnits.length === 0 ? ["NO_LEXICAL_ALIGNMENT_UNITS"] : []),
      ...(unresolvedOov.length > 0 ? ["CRITICAL_OOV_READING_UNRESOLVED"] : []),
    ],
  });
}

export function buildSubtitleCanonicalAlignmentInput(input: {
  components: readonly {
    componentId: string;
    cues: readonly SubtitleCue[];
  }[];
  baseCueHash: string;
  baseTimingHash: string;
  generatedAt?: string;
  sudachiMorphemesByCueId?: ReadonlyMap<
    string,
    readonly SudachiMorphemeAnalysis[]
  >;
  terminology?: readonly VerifiedTerminologyReading[];
  alignmentVersion?: "C5.17" | "C5.17.1";
}): SubtitleCanonicalAlignmentInput {
  const cues = input.components.flatMap((component) =>
    component.cues.map((cue) => {
      const sudachiMorphemes = input.sudachiMorphemesByCueId?.get(cue.id);
      return buildCanonicalAlignmentCue({
        cue,
        componentId: component.componentId,
        ...(sudachiMorphemes === undefined ? {} : { sudachiMorphemes }),
        ...(input.terminology === undefined
          ? {}
          : { terminology: input.terminology }),
      });
    }),
  );
  return subtitleCanonicalAlignmentInputSchema.parse({
    schemaVersion: "1.0.0",
    artifactType: "subtitle-canonical-alignment-input",
    alignmentVersion: input.alignmentVersion ?? "C5.17",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    baseCueHash: input.baseCueHash,
    baseTimingHash: input.baseTimingHash,
    configuration: {
      unicodeNormalization: "NFKC",
      displayNewlines: "remove-from-alignment-only",
      styleMarkers: "remove-from-alignment-only",
      punctuation: "separate-for-alignment",
      dialectPolicy: "preserve-surface",
      oovPolicy:
        "terminology-then-sudachi-then-official-g2p-then-kana-else-unresolved",
    },
    cues,
    summary: {
      componentCount: input.components.length,
      cueCount: cues.length,
      eligibleCueCount: cues.filter((cue) => cue.alignmentEligibility).length,
      ineligibleCueCount: cues.filter((cue) => !cue.alignmentEligibility)
        .length,
      unresolvedOovCount: cues.reduce(
        (sum, cue) => sum + cue.unresolvedOov.length,
        0,
      ),
      canonicalTextMutationCount: 0,
    },
  });
}

function comparable(value: string): string {
  return katakanaToHiragana(value.normalize("NFKC"))
    .toLocaleLowerCase("ja")
    .replace(/[\p{P}\p{S}\s]/gu, "");
}

function bigrams(value: string): string[] {
  const characters = Array.from(value);
  if (characters.length < 2) return characters;
  return characters.slice(0, -1).map((item, index) => {
    const next = characters[index + 1] ?? "";
    return `${item}${next}`;
  });
}

function dice(left: string, right: string): number {
  if (left === right && left !== "") return 1;
  if (left === "" || right === "") return 0;
  const a = bigrams(left);
  const b = [...bigrams(right)];
  let common = 0;
  for (const item of a) {
    const index = b.indexOf(item);
    if (index >= 0) {
      common += 1;
      b.splice(index, 1);
    }
  }
  return (2 * common) / Math.max(1, a.length + bigrams(right).length);
}

function pairScore(
  canonical: CanonicalAlignmentWordUnit,
  evidence: EvidenceDpUnit,
): { surface: number; reading: number; combined: number } {
  const canonicalSurface = comparable(canonical.normalizedSurface);
  const evidenceSurface = comparable(evidence.text);
  const surface = dice(canonicalSurface, evidenceSurface);
  const reading =
    canonical.reading === null || evidence.reading === null
      ? 0
      : dice(comparable(canonical.reading), comparable(evidence.reading));
  const combined = Math.max(surface, reading, (surface + reading) / 2);
  return { surface, reading, combined };
}

interface DpCell {
  score: number;
  previous: "diagonal" | "up" | "left" | "origin";
}

/**
 * Monotonic lexical/reading alignment against pre-existing evidence. Timing is
 * copied only from matched, trusted evidence units; gaps never receive invented
 * boundaries.
 */
export function alignCanonicalReadingWithEvidence(input: {
  cue: CanonicalAlignmentCueInput;
  evidenceUnits: readonly EvidenceDpUnit[];
}): EvidenceDpResult {
  const canonical = input.cue.wordUnits.filter((unit) => !unit.punctuation);
  const evidence = input.evidenceUnits.filter(
    (unit) =>
      unit.source === "trusted-mapped-token" ||
      unit.source === "decoded-segment",
  );
  const gap = -0.35;
  const cells: DpCell[][] = Array.from({ length: canonical.length + 1 }, () =>
    Array.from({ length: evidence.length + 1 }, () => ({
      score: Number.NEGATIVE_INFINITY,
      previous: "origin" as const,
    })),
  );
  requiredAt(cells, 0, "DP row")[0] = { score: 0, previous: "origin" };
  for (let i = 1; i <= canonical.length; i += 1) {
    requiredAt(cells, i, "DP row")[0] = {
      score: i * gap,
      previous: "up",
    };
  }
  for (let j = 1; j <= evidence.length; j += 1) {
    requiredAt(cells, 0, "DP row")[j] = {
      score: j * gap,
      previous: "left",
    };
  }
  for (let i = 1; i <= canonical.length; i += 1) {
    for (let j = 1; j <= evidence.length; j += 1) {
      const match = pairScore(
        requiredAt(canonical, i - 1, "canonical DP unit"),
        requiredAt(evidence, j - 1, "evidence DP unit"),
      );
      const diagonal =
        requiredAt(requiredAt(cells, i - 1, "DP row"), j - 1, "DP cell").score +
        (match.combined >= 0.45 ? match.combined : -0.55);
      const up =
        requiredAt(requiredAt(cells, i - 1, "DP row"), j, "DP cell").score +
        gap;
      const left =
        requiredAt(requiredAt(cells, i, "DP row"), j - 1, "DP cell").score +
        gap;
      const row = requiredAt(cells, i, "DP row");
      if (diagonal >= up && diagonal >= left) {
        row[j] = { score: diagonal, previous: "diagonal" };
      } else if (up >= left) {
        row[j] = { score: up, previous: "up" };
      } else {
        row[j] = { score: left, previous: "left" };
      }
    }
  }
  const matches: EvidenceDpResult["matchedCanonicalUnits"] = [];
  const matchedEvidenceIds = new Set<string>();
  const matchedCanonicalIds = new Set<string>();
  let i = canonical.length;
  let j = evidence.length;
  while (i > 0 || j > 0) {
    const cell = requiredAt(requiredAt(cells, i, "DP row"), j, "DP cell");
    if (cell.previous === "diagonal") {
      const canonicalUnit = requiredAt(canonical, i - 1, "canonical DP unit");
      const evidenceUnit = requiredAt(evidence, j - 1, "evidence DP unit");
      const score = pairScore(canonicalUnit, evidenceUnit);
      if (score.combined >= 0.45) {
        matches.push({
          unitId: canonicalUnit.unitId,
          evidenceIds: [evidenceUnit.evidenceId],
          surfaceScore: score.surface,
          readingScore: score.reading,
        });
        matchedCanonicalIds.add(canonicalUnit.unitId);
        matchedEvidenceIds.add(evidenceUnit.evidenceId);
      }
      i -= 1;
      j -= 1;
    } else if (cell.previous === "up") {
      i -= 1;
    } else if (cell.previous === "left") {
      j -= 1;
    } else {
      break;
    }
  }
  matches.reverse();
  const timingEvidence = evidence.flatMap((unit) => {
    const interval = unit.interval;
    return matchedEvidenceIds.has(unit.evidenceId) &&
      unit.timingUsable &&
      interval?.coordinateSystem === "original-media-global"
      ? [{ ...unit, interval }]
      : [];
  });
  const startBoundary =
    timingEvidence.length === 0
      ? null
      : Math.min(...timingEvidence.map((unit) => unit.interval.start));
  const endBoundary =
    timingEvidence.length === 0
      ? null
      : Math.max(...timingEvidence.map((unit) => unit.interval.end));
  const coverageRatio =
    canonical.length === 0 ? 0 : matches.length / canonical.length;
  const lexicalScore =
    matches.length === 0
      ? 0
      : matches.reduce((sum, match) => sum + match.surfaceScore, 0) /
        matches.length;
  const readingScore =
    matches.length === 0
      ? 0
      : matches.reduce((sum, match) => sum + match.readingScore, 0) /
        matches.length;
  const temporalScore =
    timingEvidence.length === 0
      ? 0
      : timingEvidence.every(
            (unit, index) =>
              index === 0 ||
              unit.interval.start >=
                requiredAt(timingEvidence, index - 1, "timed evidence").interval
                  .start,
          )
        ? 1
        : 0;
  const pathScore = Math.max(
    0,
    Math.min(
      1,
      coverageRatio * 0.5 +
        Math.max(lexicalScore, readingScore) * 0.35 +
        temporalScore * 0.15,
    ),
  );
  return {
    cueId: input.cue.cueId,
    matchedCanonicalUnits: matches,
    unmatchedCanonicalUnits: canonical
      .filter((unit) => !matchedCanonicalIds.has(unit.unitId))
      .map((unit) => unit.unitId),
    matchedEvidenceUnits: [...matchedEvidenceIds],
    unusedEvidenceUnits: evidence
      .filter((unit) => !matchedEvidenceIds.has(unit.evidenceId))
      .map((unit) => unit.evidenceId),
    pathScore,
    lexicalScore,
    readingScore,
    temporalScore,
    coverageRatio,
    startBoundary,
    endBoundary,
    boundaryEvidenceIds: timingEvidence.map((unit) => unit.evidenceId),
    blockers: [
      ...(coverageRatio < 0.7 ? ["EVIDENCE_DP_LOW_COVERAGE"] : []),
      ...(startBoundary === null || endBoundary === null
        ? ["EVIDENCE_DP_BOUNDARY_UNAVAILABLE"]
        : []),
    ],
    fabricatedBoundaryCount: 0,
  };
}

function attemptBoundary(
  attempt: ForcedAlignmentAttempt | null,
): { start: number; end: number } | null {
  return attempt?.alignmentSucceeded === true &&
    attempt.boundaryStart !== null &&
    attempt.boundaryEnd !== null
    ? { start: attempt.boundaryStart, end: attempt.boundaryEnd }
    : null;
}

function edgeDifference(
  left: { start: number; end: number },
  right: { start: number; end: number },
): number {
  return Math.max(
    Math.abs(left.start - right.start),
    Math.abs(left.end - right.end),
  );
}

function alignmentTierDifference(input: {
  narrow: ForcedAlignmentAttempt;
  expanded: ForcedAlignmentAttempt;
  tier: "word" | "phone";
}): number | null {
  const narrow =
    input.tier === "word"
      ? input.narrow.wordAlignments
      : input.narrow.phoneAlignments;
  const expanded =
    input.tier === "word"
      ? input.expanded.wordAlignments
      : input.expanded.phoneAlignments;
  const firstNarrow = narrow[0]?.mappedInterval;
  const lastNarrow = narrow.at(-1)?.mappedInterval;
  const firstExpanded = expanded[0]?.mappedInterval;
  const lastExpanded = expanded.at(-1)?.mappedInterval;
  if (
    firstNarrow === undefined ||
    lastNarrow === undefined ||
    firstExpanded === undefined ||
    lastExpanded === undefined
  ) {
    return null;
  }
  return Math.max(
    Math.abs(firstNarrow.start - firstExpanded.start),
    Math.abs(lastNarrow.end - lastExpanded.end),
  );
}

export interface WindowStabilityResult {
  status: "unavailable" | "single-window" | "stable" | "unstable";
  stable: boolean;
  startBoundaryDifferenceSeconds: number | null;
  endBoundaryDifferenceSeconds: number | null;
  boundaryDifferenceSeconds: number | null;
  wordBoundaryDifferenceSeconds: number | null;
  phoneBoundaryDifferenceSeconds: number | null;
  coverageDifference: number | null;
  score: number;
  blockers: string[];
}

export function evaluateForcedAlignmentWindowStability(input: {
  narrow: ForcedAlignmentAttempt | null;
  expanded: ForcedAlignmentAttempt | null;
  maximumDifferenceSeconds?: number;
}): WindowStabilityResult {
  const maximumDifferenceSeconds = input.maximumDifferenceSeconds ?? 0.2;
  const narrowBoundary = attemptBoundary(input.narrow);
  const expandedBoundary = attemptBoundary(input.expanded);
  const availableCount = [narrowBoundary, expandedBoundary].filter(
    (value) => value !== null,
  ).length;
  if (availableCount < 2) {
    const status = availableCount === 0 ? "unavailable" : "single-window";
    return {
      status,
      stable: false,
      startBoundaryDifferenceSeconds: null,
      endBoundaryDifferenceSeconds: null,
      boundaryDifferenceSeconds: null,
      wordBoundaryDifferenceSeconds: null,
      phoneBoundaryDifferenceSeconds: null,
      coverageDifference: null,
      score: 0,
      blockers: [
        status === "unavailable"
          ? "ALIGNMENT_WINDOW_PAIR_UNAVAILABLE"
          : "ALIGNMENT_SINGLE_WINDOW_ONLY",
      ],
    };
  }
  if (
    input.narrow === null ||
    input.expanded === null ||
    narrowBoundary === null ||
    expandedBoundary === null
  ) {
    throw new Error("Window availability count is inconsistent.");
  }
  const startBoundaryDifferenceSeconds = Math.abs(
    narrowBoundary.start - expandedBoundary.start,
  );
  const endBoundaryDifferenceSeconds = Math.abs(
    narrowBoundary.end - expandedBoundary.end,
  );
  const boundaryDifferenceSeconds = edgeDifference(
    narrowBoundary,
    expandedBoundary,
  );
  const wordBoundaryDifferenceSeconds = alignmentTierDifference({
    narrow: input.narrow,
    expanded: input.expanded,
    tier: "word",
  });
  const phoneBoundaryDifferenceSeconds = alignmentTierDifference({
    narrow: input.narrow,
    expanded: input.expanded,
    tier: "phone",
  });
  const coverageDifference = Math.max(
    Math.abs(input.narrow.wordCoverageRatio - input.expanded.wordCoverageRatio),
    Math.abs(
      input.narrow.readingCoverageRatio - input.expanded.readingCoverageRatio,
    ),
    Math.abs(
      input.narrow.phoneCoverageRatio - input.expanded.phoneCoverageRatio,
    ),
  );
  const observedDifferences = [
    boundaryDifferenceSeconds,
    wordBoundaryDifferenceSeconds,
    phoneBoundaryDifferenceSeconds,
  ].filter((value): value is number => value !== null);
  const maximumObserved = Math.max(...observedDifferences);
  const stable =
    maximumObserved <= maximumDifferenceSeconds + 1e-9 &&
    coverageDifference <= 0.15;
  return {
    status: stable ? "stable" : "unstable",
    stable,
    startBoundaryDifferenceSeconds,
    endBoundaryDifferenceSeconds,
    boundaryDifferenceSeconds,
    wordBoundaryDifferenceSeconds,
    phoneBoundaryDifferenceSeconds,
    coverageDifference,
    score: stable
      ? Math.max(
          0,
          1 - maximumObserved / Math.max(0.001, maximumDifferenceSeconds),
        )
      : 0,
    blockers: stable ? [] : ["ALIGNMENT_WINDOW_UNSTABLE"],
  };
}

function intervalOverlap(
  left: { start: number; end: number },
  right: { start: number; end: number },
): number {
  return Math.max(
    0,
    Math.min(left.end, right.end) - Math.max(left.start, right.start),
  );
}

function overlapRatio(
  left: { start: number; end: number },
  right: { start: number; end: number },
): number {
  const intersection = intervalOverlap(left, right);
  return (
    intersection /
    Math.max(0.001, Math.min(left.end - left.start, right.end - right.start))
  );
}

export interface BoundaryAgreementResult {
  startDifferenceSeconds: number | null;
  endDifferenceSeconds: number | null;
  fullBoundaryDifferenceSeconds: number | null;
  startScore: number;
  endScore: number;
  fullScore: number;
  startEvidenceIds: string[];
  endEvidenceIds: string[];
}

export function evaluateTwoSidedBoundaryAgreement(input: {
  boundary: { start: number; end: number } | null;
  intervals: readonly { evidenceId?: string; start: number; end: number }[];
  toleranceSeconds?: number;
}): BoundaryAgreementResult {
  const boundary = input.boundary;
  if (boundary === null || input.intervals.length === 0) {
    return {
      startDifferenceSeconds: null,
      endDifferenceSeconds: null,
      fullBoundaryDifferenceSeconds: null,
      startScore: 0,
      endScore: 0,
      fullScore: 0,
      startEvidenceIds: [],
      endEvidenceIds: [],
    };
  }
  const tolerance = input.toleranceSeconds ?? 0.35;
  const startDifference = Math.min(
    ...input.intervals.flatMap((interval) => [
      Math.abs(boundary.start - interval.start),
      Math.abs(boundary.start - interval.end),
    ]),
  );
  const endDifference = Math.min(
    ...input.intervals.flatMap((interval) => [
      Math.abs(boundary.end - interval.start),
      Math.abs(boundary.end - interval.end),
    ]),
  );
  const score = (difference: number) =>
    Math.max(0, 1 - difference / Math.max(0.001, tolerance));
  const evidenceIds = (boundaryValue: number) =>
    input.intervals.flatMap((interval) => {
      const difference = Math.min(
        Math.abs(boundaryValue - interval.start),
        Math.abs(boundaryValue - interval.end),
      );
      return difference <= tolerance && interval.evidenceId !== undefined
        ? [interval.evidenceId]
        : [];
    });
  return {
    startDifferenceSeconds: startDifference,
    endDifferenceSeconds: endDifference,
    fullBoundaryDifferenceSeconds: Math.max(startDifference, endDifference),
    startScore: score(startDifference),
    endScore: score(endDifference),
    fullScore: Math.min(score(startDifference), score(endDifference)),
    startEvidenceIds: [...new Set(evidenceIds(boundary.start))],
    endEvidenceIds: [...new Set(evidenceIds(boundary.end))],
  };
}

function phonePlausibility(attempt: ForcedAlignmentAttempt | null): number {
  if (attempt === null || attempt.phoneAlignments.length === 0) return 0;
  const plausible = attempt.phoneAlignments.filter((phone) => {
    const duration = phone.mappedInterval.end - phone.mappedInterval.start;
    return duration >= 0.015 && duration <= 0.5;
  }).length;
  return plausible / attempt.phoneAlignments.length;
}

function silenceIntrusion(
  attempt: ForcedAlignmentAttempt | null,
  boundary: { start: number; end: number } | null,
): number {
  if (attempt === null || boundary === null) return 1;
  const duration = boundary.end - boundary.start;
  const overlap = attempt.silenceIntervals.reduce(
    (sum, interval) => sum + intervalOverlap(boundary, interval),
    0,
  );
  return Math.min(1, overlap / Math.max(0.001, duration));
}

export interface AntiForcingEvaluation {
  metrics: AntiForcingMetrics;
  passed: boolean;
  blockers: string[];
  selectedBoundary: { start: number; end: number } | null;
  boundarySources: ForcedAlignmentCueDecision["boundarySources"];
  boundaryEvidenceIds: string[];
  startBoundaryEvidenceIds: string[];
  endBoundaryEvidenceIds: string[];
  windowPairStatus: WindowStabilityResult["status"];
}

export function evaluateAntiForcingGate(input: {
  cue: CanonicalAlignmentCueInput;
  narrow: ForcedAlignmentAttempt | null;
  expanded: ForcedAlignmentAttempt | null;
  evidenceDp: EvidenceDpResult;
  mappedTokenIntervals: readonly {
    evidenceId: string;
    start: number;
    end: number;
  }[];
  rawVadIntervals: readonly {
    evidenceId: string;
    start: number;
    end: number;
  }[];
  decodedSegmentIntervals: readonly {
    evidenceId: string;
    start: number;
    end: number;
  }[];
  neighborIntervals?: readonly { start: number; end: number }[];
  duplicateOccurrenceOverlapRatio?: number;
  configuration?: Partial<ForcedAlignmentConfiguration>;
}): AntiForcingEvaluation {
  const configuration = {
    ...DEFAULT_FORCED_ALIGNMENT_CONFIGURATION,
    ...input.configuration,
  };
  const narrowBoundary = attemptBoundary(input.narrow);
  const expandedBoundary = attemptBoundary(input.expanded);
  const stability = evaluateForcedAlignmentWindowStability({
    narrow: input.narrow,
    expanded: input.expanded,
    maximumDifferenceSeconds:
      configuration.maximumWindowBoundaryDifferenceSeconds,
  });
  const selectedBoundary = stability.stable ? narrowBoundary : null;
  const mappedAgreement = evaluateTwoSidedBoundaryAgreement({
    boundary: selectedBoundary,
    intervals: input.mappedTokenIntervals,
  });
  const vadAgreement = evaluateTwoSidedBoundaryAgreement({
    boundary: selectedBoundary,
    intervals: input.rawVadIntervals,
  });
  const decodedAgreement = evaluateTwoSidedBoundaryAgreement({
    boundary: selectedBoundary,
    intervals: input.decodedSegmentIntervals,
  });
  const phoneAgreement = evaluateTwoSidedBoundaryAgreement({
    boundary: selectedBoundary,
    intervals: [input.narrow, input.expanded].flatMap((attempt) =>
      attempt === null
        ? []
        : attempt.phoneAlignments.map((phone) => ({
            evidenceId: phone.alignmentId,
            start: phone.mappedInterval.start,
            end: phone.mappedInterval.end,
          })),
    ),
    toleranceSeconds: 0.12,
  });
  const evidenceDpBoundary =
    input.evidenceDp.startBoundary === null ||
    input.evidenceDp.endBoundary === null
      ? null
      : {
          start: input.evidenceDp.startBoundary,
          end: input.evidenceDp.endBoundary,
        };
  const evidenceDpAgreement =
    selectedBoundary === null || evidenceDpBoundary === null
      ? 0
      : Math.max(
          0,
          1 - edgeDifference(selectedBoundary, evidenceDpBoundary) / 0.5,
        );
  const sourceCuePriorAgreement =
    selectedBoundary === null
      ? 0
      : Math.max(
          0,
          1 -
            edgeDifference(selectedBoundary, input.cue.originalInterval) /
              Math.max(0.001, configuration.maximumTimingAdjustmentSeconds),
        );
  const neighborCueIntrusionRatio =
    selectedBoundary === null
      ? 1
      : Math.min(
          1,
          (input.neighborIntervals ?? []).reduce(
            (sum, interval) =>
              sum + intervalOverlap(selectedBoundary, interval),
            0,
          ) / Math.max(0.001, selectedBoundary.end - selectedBoundary.start),
        );
  const metrics: AntiForcingMetrics = {
    wordCoverageRatio: Math.min(
      input.narrow?.wordCoverageRatio ?? 0,
      input.expanded?.wordCoverageRatio ?? 0,
    ),
    phoneCoverageRatio: Math.min(
      input.narrow?.phoneCoverageRatio ?? 0,
      input.expanded?.phoneCoverageRatio ?? 0,
    ),
    readingCoverageRatio: Math.min(
      input.narrow?.readingCoverageRatio ?? 0,
      input.expanded?.readingCoverageRatio ?? 0,
    ),
    oovRatio:
      Math.max(
        input.narrow?.expectedWordCount ?? 0,
        input.expanded?.expectedWordCount ?? 0,
      ) === 0
        ? 0
        : Math.max(input.narrow?.oovCount ?? 0, input.expanded?.oovCount ?? 0) /
          Math.max(
            input.narrow?.expectedWordCount ?? 0,
            input.expanded?.expectedWordCount ?? 0,
          ),
    windowBoundaryPinningScore:
      input.narrow?.startPinnedToWindowEdge === true ||
      input.narrow?.endPinnedToWindowEdge === true ||
      input.expanded?.startPinnedToWindowEdge === true ||
      input.expanded?.endPinnedToWindowEdge === true
        ? 1
        : 0,
    windowStabilityScore: stability.score,
    phoneDurationPlausibility: Math.min(
      phonePlausibility(input.narrow),
      phonePlausibility(input.expanded),
    ),
    silenceIntrusionRatio: Math.max(
      silenceIntrusion(input.narrow, narrowBoundary),
      silenceIntrusion(input.expanded, expandedBoundary),
    ),
    mappedWhisperAgreement: mappedAgreement.fullScore,
    rawVadBoundaryAgreement: vadAgreement.fullScore,
    decodedSegmentAgreement: decodedAgreement.fullScore,
    evidenceDpAgreement,
    sourceCuePriorAgreement,
    neighborCueIntrusionRatio,
    duplicateOccurrenceOverlapRatio: input.duplicateOccurrenceOverlapRatio ?? 0,
    canonicalUnitCoverageRatio: Math.min(
      input.narrow?.canonicalUnitCoverageRatio ?? 0,
      input.expanded?.canonicalUnitCoverageRatio ?? 0,
    ),
    alignedWordCoverageRatio: Math.min(
      input.narrow?.alignedWordCoverageRatio ?? 0,
      input.expanded?.alignedWordCoverageRatio ?? 0,
    ),
    pronunciationUnitCoverageRatio: Math.min(
      input.narrow?.pronunciationUnitCoverageRatio ?? 0,
      input.expanded?.pronunciationUnitCoverageRatio ?? 0,
    ),
    expectedPhoneCoverageRatio: Math.min(
      input.narrow?.expectedPhoneCoverageRatio ?? 0,
      input.expanded?.expectedPhoneCoverageRatio ?? 0,
    ),
    wordWithAnyPhoneRatio: Math.min(
      input.narrow?.wordWithAnyPhoneRatio ?? 0,
      input.expanded?.wordWithAnyPhoneRatio ?? 0,
    ),
    alignedPhonePlausibilityRatio: Math.min(
      input.narrow?.alignedPhonePlausibilityRatio ?? 0,
      input.expanded?.alignedPhonePlausibilityRatio ?? 0,
    ),
    startBoundaryDifferenceSeconds: stability.startBoundaryDifferenceSeconds,
    endBoundaryDifferenceSeconds: stability.endBoundaryDifferenceSeconds,
    startBoundaryAgreementScore: Math.min(
      mappedAgreement.startScore,
      vadAgreement.startScore,
    ),
    endBoundaryAgreementScore: Math.min(
      mappedAgreement.endScore,
      vadAgreement.endScore,
    ),
    fullBoundaryAgreementScore: Math.min(
      mappedAgreement.fullScore,
      vadAgreement.fullScore,
    ),
  };
  const startExternallySupported =
    mappedAgreement.startScore >= 0.35 && vadAgreement.startScore >= 0.35;
  const endExternallySupported =
    mappedAgreement.endScore >= 0.35 && vadAgreement.endScore >= 0.35;
  const blockers = [
    ...stability.blockers,
    ...((metrics.canonicalUnitCoverageRatio ?? 0) <
    (configuration.minimumCanonicalUnitCoverageRatio ??
      configuration.minimumWordCoverageRatio)
      ? ["FORCED_ALIGNMENT_WORD_COVERAGE_LOW"]
      : []),
    ...((metrics.pronunciationUnitCoverageRatio ?? 0) <
    (configuration.minimumPronunciationUnitCoverageRatio ??
      configuration.minimumReadingCoverageRatio)
      ? ["FORCED_ALIGNMENT_READING_COVERAGE_LOW"]
      : []),
    ...((metrics.expectedPhoneCoverageRatio ?? 0) <
    (configuration.minimumExpectedPhoneCoverageRatio ??
      configuration.minimumPhoneCoverageRatio)
      ? ["FORCED_ALIGNMENT_PHONE_COVERAGE_LOW"]
      : []),
    ...(input.cue.unresolvedOov.length > 0
      ? ["CRITICAL_OOV_READING_UNRESOLVED"]
      : []),
    ...(metrics.windowBoundaryPinningScore > 0
      ? ["ALIGNMENT_PINNED_TO_WINDOW_EDGE"]
      : []),
    ...(metrics.phoneDurationPlausibility < 0.8
      ? ["PHONE_DURATION_IMPLAUSIBLE"]
      : []),
    ...(metrics.silenceIntrusionRatio > 0.35
      ? ["FORCED_ALIGNMENT_SILENCE_INTRUSION"]
      : []),
    ...(!startExternallySupported && !endExternallySupported
      ? ["MFA_SIDE_SPECIFIC_EXTERNAL_BOUNDARY_SUPPORT_MISSING"]
      : []),
    ...(metrics.evidenceDpAgreement < 0.35
      ? ["MFA_EVIDENCE_DP_DISAGREEMENT"]
      : []),
    ...(metrics.neighborCueIntrusionRatio >
    configuration.maximumNeighborIntrusionRatio
      ? ["NEIGHBOR_CUE_INTRUSION"]
      : []),
    ...(metrics.duplicateOccurrenceOverlapRatio >= 0.7
      ? ["DUPLICATE_ACOUSTIC_OCCURRENCE_ASSIGNMENT"]
      : []),
  ];
  const mfaEvidenceIds = [
    ...(input.narrow?.attemptId === undefined ? [] : [input.narrow.attemptId]),
    ...(input.expanded?.attemptId === undefined
      ? []
      : [input.expanded.attemptId]),
  ];
  const startBoundaryEvidenceIds = [
    ...mfaEvidenceIds,
    ...mappedAgreement.startEvidenceIds,
    ...vadAgreement.startEvidenceIds,
    ...decodedAgreement.startEvidenceIds,
    ...phoneAgreement.startEvidenceIds,
  ];
  const endBoundaryEvidenceIds = [
    ...mfaEvidenceIds,
    ...mappedAgreement.endEvidenceIds,
    ...vadAgreement.endEvidenceIds,
    ...decodedAgreement.endEvidenceIds,
    ...phoneAgreement.endEvidenceIds,
  ];
  const boundaryEvidenceIds = [
    ...startBoundaryEvidenceIds,
    ...endBoundaryEvidenceIds,
  ];
  return {
    metrics,
    passed: selectedBoundary !== null && blockers.length === 0,
    blockers: [...new Set(blockers)],
    selectedBoundary,
    boundarySources: [
      ...(input.narrow === null ? [] : (["mfa-narrow"] as const)),
      ...(input.expanded === null ? [] : (["mfa-expanded"] as const)),
      ...(input.evidenceDp.boundaryEvidenceIds.length === 0
        ? []
        : (["evidence-dp"] as const)),
      ...(!startExternallySupported && !endExternallySupported
        ? []
        : (["mapped-token", "raw-vad"] as const)),
      ...(decodedAgreement.startScore < 0.35 && decodedAgreement.endScore < 0.35
        ? []
        : (["decoded-segment"] as const)),
      "source-cue-prior",
    ],
    boundaryEvidenceIds: [...new Set(boundaryEvidenceIds)],
    startBoundaryEvidenceIds: [...new Set(startBoundaryEvidenceIds)],
    endBoundaryEvidenceIds: [...new Set(endBoundaryEvidenceIds)],
    windowPairStatus: stability.status,
  };
}

export function buildAcousticOccurrenceId(input: {
  audioSha256: string;
  boundary: { start: number; end: number };
  wordAlignments: ForcedAlignmentAttempt["wordAlignments"];
  phoneAlignments: ForcedAlignmentAttempt["phoneAlignments"];
  evidenceLineageIds: readonly string[];
}): string {
  return `forced-occurrence-${forcedAlignmentSha256({
    audioSha256: input.audioSha256,
    boundary: {
      start: Number(input.boundary.start.toFixed(3)),
      end: Number(input.boundary.end.toFixed(3)),
    },
    words: input.wordAlignments.map((word) => ({
      label: comparable(word.label),
      start: Number(word.mappedInterval.start.toFixed(3)),
      end: Number(word.mappedInterval.end.toFixed(3)),
    })),
    phones: input.phoneAlignments.map((phone) => ({
      label: phone.label,
      start: Number(phone.mappedInterval.start.toFixed(3)),
      end: Number(phone.mappedInterval.end.toFixed(3)),
    })),
    evidenceLineageIds: [...input.evidenceLineageIds].toSorted(),
  }).slice(0, 20)}`;
}

export function buildForcedAlignmentCueDecision(input: {
  cue: CanonicalAlignmentCueInput;
  narrow: ForcedAlignmentAttempt | null;
  expanded: ForcedAlignmentAttempt | null;
  evidenceDp: EvidenceDpResult;
  mappedTokenIntervals: readonly {
    evidenceId: string;
    start: number;
    end: number;
  }[];
  rawVadIntervals: readonly {
    evidenceId: string;
    start: number;
    end: number;
  }[];
  decodedSegmentIntervals: readonly {
    evidenceId: string;
    start: number;
    end: number;
  }[];
  neighborIntervals?: readonly { start: number; end: number }[];
  configuration?: Partial<ForcedAlignmentConfiguration>;
}): ForcedAlignmentCueDecision {
  const gate = evaluateAntiForcingGate(input);
  const selectedAttempt = input.narrow?.alignmentSucceeded
    ? input.narrow
    : input.expanded;
  const occurrenceId =
    gate.selectedBoundary === null || selectedAttempt === null
      ? null
      : buildAcousticOccurrenceId({
          audioSha256: selectedAttempt.audioSha256,
          boundary: gate.selectedBoundary,
          wordAlignments: selectedAttempt.wordAlignments,
          phoneAlignments: selectedAttempt.phoneAlignments,
          evidenceLineageIds: gate.boundaryEvidenceIds,
        });
  return {
    cueId: input.cue.cueId,
    canonicalText: input.cue.canonicalText,
    alignmentText: input.cue.alignmentText,
    normalizedReading: input.cue.normalizedReading,
    unresolvedOov: input.cue.unresolvedOov,
    narrowAttemptId: input.narrow?.attemptId ?? null,
    expandedAttemptId: input.expanded?.attemptId ?? null,
    evidenceDp: input.evidenceDp,
    selectedBoundary: gate.selectedBoundary,
    acousticOccurrenceId: occurrenceId,
    antiForcingMetrics: gate.metrics,
    antiForcingPassed: gate.passed,
    blockers: gate.blockers,
    boundaryEvidenceIds: gate.boundaryEvidenceIds,
    startBoundaryEvidenceIds: gate.startBoundaryEvidenceIds,
    endBoundaryEvidenceIds: gate.endBoundaryEvidenceIds,
    windowPairStatus: gate.windowPairStatus,
    boundarySources: gate.boundarySources,
    textChanged: false,
  };
}

interface DuplicateConflict {
  leftCueId: string;
  rightCueId: string;
  acousticOccurrenceId: string;
  intervalOverlapRatio: number;
  wordOverlapRatio: number;
  phoneOverlapRatio: number;
}

export function detectDuplicateOccurrenceAssignments(input: {
  cueAlignments: readonly ForcedAlignmentCueDecision[];
  attempts: readonly ForcedAlignmentAttempt[];
}): DuplicateConflict[] {
  const attemptsById = new Map(
    input.attempts.map((item) => [item.attemptId, item]),
  );
  const conflicts: DuplicateConflict[] = [];
  for (
    let leftIndex = 0;
    leftIndex < input.cueAlignments.length;
    leftIndex += 1
  ) {
    const left = requiredAt(
      input.cueAlignments,
      leftIndex,
      "left cue alignment",
    );
    if (left.selectedBoundary === null) continue;
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < input.cueAlignments.length;
      rightIndex += 1
    ) {
      const right = requiredAt(
        input.cueAlignments,
        rightIndex,
        "right cue alignment",
      );
      if (right.selectedBoundary === null) continue;
      const intervalRatio = overlapRatio(
        left.selectedBoundary,
        right.selectedBoundary,
      );
      const sameText =
        comparable(left.canonicalText) === comparable(right.canonicalText);
      const leftAttempt =
        attemptsById.get(left.narrowAttemptId ?? "") ??
        attemptsById.get(left.expandedAttemptId ?? "");
      const rightAttempt =
        attemptsById.get(right.narrowAttemptId ?? "") ??
        attemptsById.get(right.expandedAttemptId ?? "");
      const wordOverlapRatio =
        leftAttempt === undefined || rightAttempt === undefined
          ? 0
          : tierOverlapRatio(
              leftAttempt.wordAlignments,
              rightAttempt.wordAlignments,
            );
      const phoneOverlapRatio =
        leftAttempt === undefined || rightAttempt === undefined
          ? 0
          : tierOverlapRatio(
              leftAttempt.phoneAlignments,
              rightAttempt.phoneAlignments,
            );
      const sameOccurrence =
        left.acousticOccurrenceId !== null &&
        left.acousticOccurrenceId === right.acousticOccurrenceId;
      if (
        sameOccurrence ||
        (sameText && intervalRatio >= 0.7) ||
        (wordOverlapRatio >= 0.8 && phoneOverlapRatio >= 0.8)
      ) {
        conflicts.push({
          leftCueId: left.cueId,
          rightCueId: right.cueId,
          acousticOccurrenceId:
            left.acousticOccurrenceId ??
            right.acousticOccurrenceId ??
            `forced-occurrence-conflict-${forcedAlignmentSha256({
              left: left.selectedBoundary,
              right: right.selectedBoundary,
            }).slice(0, 20)}`,
          intervalOverlapRatio: intervalRatio,
          wordOverlapRatio,
          phoneOverlapRatio,
        });
      }
    }
  }
  return conflicts;
}

function tierOverlapRatio(
  left: readonly { mappedInterval: { start: number; end: number } }[],
  right: readonly { mappedInterval: { start: number; end: number } }[],
): number {
  if (left.length === 0 || right.length === 0) return 0;
  const leftInterval = {
    start: Math.min(...left.map((item) => item.mappedInterval.start)),
    end: Math.max(...left.map((item) => item.mappedInterval.end)),
  };
  const rightInterval = {
    start: Math.min(...right.map((item) => item.mappedInterval.start)),
    end: Math.max(...right.map((item) => item.mappedInterval.end)),
  };
  return overlapRatio(leftInterval, rightInterval);
}

function hypothesis(
  relationship: ForcedAlignmentHypothesis["relationship"],
  score: number,
  cueAlignments: readonly ForcedAlignmentCueDecision[],
  blockers: readonly string[] = [],
  speakerEvidenceRequired = false,
): ForcedAlignmentHypothesis {
  return {
    relationship,
    score: Math.max(0, Math.min(1, score)),
    selectedAttemptIds: cueAlignments.flatMap((cue) =>
      cue.narrowAttemptId === null ? [] : [cue.narrowAttemptId],
    ),
    occurrenceIds: cueAlignments.flatMap((cue) =>
      cue.acousticOccurrenceId === null ? [] : [cue.acousticOccurrenceId],
    ),
    blockers: [...blockers],
    speakerEvidenceRequired,
    speakerEvidenceAvailable: false,
  };
}

function proposedMutation(input: {
  componentId: string;
  cue: CanonicalAlignmentCueInput;
  decision: ForcedAlignmentCueDecision;
  configuration: ForcedAlignmentConfiguration;
}): ForcedAlignmentTimingMutation | null {
  const boundary = input.decision.selectedBoundary;
  if (!input.decision.antiForcingPassed || boundary === null) return null;
  const candidateStartDelta = boundary.start - input.cue.originalInterval.start;
  const candidateEndDelta = boundary.end - input.cue.originalInterval.end;
  const supportsSide = (ids: readonly string[]) => {
    const mapped = ids.filter((id) => /token|mapped/iu.test(id));
    const acoustic = ids.filter((id) => /vad|pause|mfa-phone/iu.test(id));
    return {
      supported: mapped.length > 0 && acoustic.length > 0,
      mapped,
      acoustic,
    };
  };
  const startEvidenceIds = input.decision.startBoundaryEvidenceIds ?? [];
  const endEvidenceIds = input.decision.endBoundaryEvidenceIds ?? [];
  const startSupport = supportsSide(startEvidenceIds);
  const endSupport = supportsSide(endEvidenceIds);
  const startChanges = Math.abs(candidateStartDelta) > 0.001;
  const endChanges = Math.abs(candidateEndDelta) > 0.001;
  const afterStart =
    startChanges && startSupport.supported
      ? boundary.start
      : input.cue.originalInterval.start;
  const afterEnd =
    endChanges && endSupport.supported
      ? boundary.end
      : input.cue.originalInterval.end;
  const startDelta = afterStart - input.cue.originalInterval.start;
  const endDelta = afterEnd - input.cue.originalInterval.end;
  if (Math.abs(startDelta) <= 0.001 && Math.abs(endDelta) <= 0.001) return null;
  if (
    Math.abs(startDelta) >
      input.configuration.maximumTimingAdjustmentSeconds + 1e-9 ||
    Math.abs(endDelta) >
      input.configuration.maximumTimingAdjustmentSeconds + 1e-9 ||
    afterEnd - afterStart <
      input.configuration.minimumPostRepairCueDurationSeconds
  ) {
    return null;
  }
  const effectiveStartEvidenceIds =
    Math.abs(startDelta) <= 0.001 ? [] : startEvidenceIds;
  const effectiveEndEvidenceIds =
    Math.abs(endDelta) <= 0.001 ? [] : endEvidenceIds;
  const mappedTokenEvidenceIds = [
    ...new Set(
      [...effectiveStartEvidenceIds, ...effectiveEndEvidenceIds].filter((id) =>
        /token|mapped/iu.test(id),
      ),
    ),
  ];
  const rawVadEvidenceIds = [
    ...new Set(
      [...effectiveStartEvidenceIds, ...effectiveEndEvidenceIds].filter((id) =>
        /vad/iu.test(id),
      ),
    ),
  ];
  return {
    mutationId: `forced-timing-mutation-${forcedAlignmentSha256({
      componentId: input.componentId,
      cueId: input.cue.cueId,
      before: input.cue.originalInterval,
      after: { start: afterStart, end: afterEnd },
    }).slice(0, 20)}`,
    componentId: input.componentId,
    cueId: input.cue.cueId,
    beforeStart: input.cue.originalInterval.start,
    beforeEnd: input.cue.originalInterval.end,
    afterStart,
    afterEnd,
    startDelta,
    endDelta,
    boundarySources: input.decision.boundarySources,
    mfaEvidenceIds: [
      ...(input.decision.narrowAttemptId === null
        ? []
        : [input.decision.narrowAttemptId]),
      ...(input.decision.expandedAttemptId === null
        ? []
        : [input.decision.expandedAttemptId]),
    ],
    mappedTokenEvidenceIds,
    rawVadEvidenceIds,
    startBoundaryEvidenceIds: effectiveStartEvidenceIds,
    endBoundaryEvidenceIds: effectiveEndEvidenceIds,
    textChanged: false,
    method: "evidence-backed-forced-alignment-boundaries",
  };
}

function introducesNewOverlap(input: {
  cues: readonly CanonicalAlignmentCueInput[];
  mutations: readonly ForcedAlignmentTimingMutation[];
}): boolean {
  const mutationByCue = new Map(
    input.mutations.map((item) => [item.cueId, item]),
  );
  for (let index = 1; index < input.cues.length; index += 1) {
    const left = requiredAt(input.cues, index - 1, "left cue");
    const right = requiredAt(input.cues, index, "right cue");
    const leftMutation = mutationByCue.get(left.cueId);
    const rightMutation = mutationByCue.get(right.cueId);
    const before = intervalOverlap(
      left.originalInterval,
      right.originalInterval,
    );
    const after = intervalOverlap(
      leftMutation === undefined
        ? left.originalInterval
        : { start: leftMutation.afterStart, end: leftMutation.afterEnd },
      rightMutation === undefined
        ? right.originalInterval
        : { start: rightMutation.afterStart, end: rightMutation.afterEnd },
    );
    if (after > before + 0.001) return true;
  }
  return false;
}

/** Selects all cues in one component as a single atomic decision. */
export function jointlyAssignForcedAlignmentComponent(input: {
  componentId: string;
  componentInterval: { start: number; end: number };
  canonicalCues: readonly CanonicalAlignmentCueInput[];
  cueAlignments: readonly ForcedAlignmentCueDecision[];
  attempts: readonly ForcedAlignmentAttempt[];
  mode: ForcedAlignmentMode;
  configuration?: Partial<ForcedAlignmentConfiguration>;
}): ForcedAlignmentComponent {
  const configuration = {
    ...DEFAULT_FORCED_ALIGNMENT_CONFIGURATION,
    ...input.configuration,
    mode: input.mode,
  } as ForcedAlignmentConfiguration;
  const orderedCues = [...input.canonicalCues].toSorted(
    (left, right) =>
      left.originalInterval.start - right.originalInterval.start ||
      left.cueId.localeCompare(right.cueId),
  );
  const decisionByCue = new Map(
    input.cueAlignments.map((decision) => [decision.cueId, decision]),
  );
  const cueAlignments = orderedCues
    .map((cue) => decisionByCue.get(cue.cueId))
    .filter((decision): decision is ForcedAlignmentCueDecision =>
      Boolean(decision),
    );
  const duplicateConflicts = detectDuplicateOccurrenceAssignments({
    cueAlignments,
    attempts: input.attempts,
  });
  const allPassed =
    cueAlignments.length === orderedCues.length &&
    cueAlignments.every(
      (decision) =>
        decision.antiForcingPassed && decision.selectedBoundary !== null,
    );
  const chronological = cueAlignments.every((decision, index) => {
    if (index === 0 || decision.selectedBoundary === null) return true;
    const previous = cueAlignments[index - 1]?.selectedBoundary;
    return previous === null || previous === undefined
      ? true
      : decision.selectedBoundary.start >= previous.start;
  });
  const averageGateScore =
    cueAlignments.length === 0
      ? 0
      : cueAlignments.reduce(
          (sum, cue) =>
            sum +
            (cue.antiForcingMetrics.wordCoverageRatio * 0.2 +
              cue.antiForcingMetrics.readingCoverageRatio * 0.2 +
              cue.antiForcingMetrics.phoneCoverageRatio * 0.1 +
              cue.antiForcingMetrics.windowStabilityScore * 0.15 +
              cue.antiForcingMetrics.mappedWhisperAgreement * 0.15 +
              cue.antiForcingMetrics.rawVadBoundaryAgreement * 0.1 +
              cue.antiForcingMetrics.evidenceDpAgreement * 0.1),
          0,
        ) / cueAlignments.length;
  const hasSelectedOverlap = cueAlignments.some((cue, index) => {
    if (index === 0 || cue.selectedBoundary === null) return false;
    const previous = cueAlignments[index - 1]?.selectedBoundary;
    return previous !== null && previous !== undefined
      ? intervalOverlap(previous, cue.selectedBoundary) > 0
      : false;
  });
  const ordered = hypothesis(
    hasSelectedOverlap ? "rapid-turn-taking" : "ordered-no-overlap",
    allPassed && chronological && duplicateConflicts.length === 0
      ? averageGateScore
      : averageGateScore * 0.45,
    cueAlignments,
    [
      ...(!allPassed ? ["CUE_ALIGNMENT_GATE_FAILED"] : []),
      ...(!chronological ? ["OCCURRENCE_ORDER_CONFLICT"] : []),
      ...(duplicateConflicts.length > 0
        ? ["DUPLICATE_ACOUSTIC_OCCURRENCE_ASSIGNMENT"]
        : []),
    ],
  );
  const partial = hypothesis(
    "partial-alignment",
    cueAlignments.some((cue) => cue.antiForcingPassed)
      ? averageGateScore * 0.7
      : 0.15,
    cueAlignments,
    ["COMPONENT_PARTIAL_ALIGNMENT_NOT_ATOMIC"],
  );
  const sameOccurrence = hypothesis(
    "same-occurrence-alternative",
    duplicateConflicts.length > 0 ? Math.max(0.6, averageGateScore) : 0.05,
    cueAlignments,
    duplicateConflicts.length > 0
      ? ["DUPLICATE_ACOUSTIC_OCCURRENCE_ASSIGNMENT"]
      : [],
  );
  const nested = hypothesis(
    "nested-background-foreground",
    hasSelectedOverlap ? 0.35 : 0.05,
    cueAlignments,
    ["SPEAKER_OR_FOREGROUND_EVIDENCE_UNAVAILABLE"],
    true,
  );
  const unresolved = hypothesis(
    "unresolved",
    allPassed && chronological && duplicateConflicts.length === 0 ? 0.2 : 0.75,
    cueAlignments,
    ["COMPONENT_REMAINS_UNRESOLVED"],
  );
  const counterfactualHypotheses = [
    ordered,
    partial,
    sameOccurrence,
    nested,
    unresolved,
  ].toSorted(
    (left, right) =>
      right.score - left.score ||
      left.relationship.localeCompare(right.relationship),
  );
  const actionableHypotheses = counterfactualHypotheses.filter(
    (item) =>
      item.relationship !== "unresolved" &&
      (!item.speakerEvidenceRequired || item.speakerEvidenceAvailable),
  );
  const bestHypothesis = requiredAt(
    actionableHypotheses,
    0,
    "best actionable hypothesis",
  );
  const runnerUpHypothesis = requiredAt(
    actionableHypotheses,
    1,
    "runner-up actionable hypothesis",
  );
  const decisionMargin = Math.max(
    0,
    bestHypothesis.score - runnerUpHypothesis.score,
  );
  const proposedMutations = orderedCues.flatMap((cue) => {
    const decision = decisionByCue.get(cue.cueId);
    if (decision === undefined) return [];
    const mutation = proposedMutation({
      componentId: input.componentId,
      cue,
      decision,
      configuration,
    });
    return mutation === null ? [] : [mutation];
  });
  const allMutationCandidatesPresent =
    proposedMutations.length === orderedCues.length;
  const insideComponent = proposedMutations.every(
    (mutation) =>
      mutation.afterStart >= input.componentInterval.start - 1e-9 &&
      mutation.afterEnd <= input.componentInterval.end + 1e-9,
  );
  const noNewOverlap = !introducesNewOverlap({
    cues: orderedCues,
    mutations: proposedMutations,
  });
  const relationshipEligible = [
    "ordered-no-overlap",
    "rapid-turn-taking",
  ].includes(bestHypothesis.relationship);
  const scoreEligible =
    bestHypothesis.score >= configuration.minimumBestHypothesisScore &&
    decisionMargin >= configuration.minimumDecisionMargin;
  const atomicApplicationPassed =
    allPassed &&
    chronological &&
    duplicateConflicts.length === 0 &&
    allMutationCandidatesPresent &&
    insideComponent &&
    noNewOverlap &&
    relationshipEligible &&
    scoreEligible;
  const resolved = atomicApplicationPassed && input.mode === "enforce";
  const blockers = [
    ...cueAlignments.flatMap((cue) => cue.blockers),
    ...bestHypothesis.blockers,
    ...(!allMutationCandidatesPresent
      ? ["COMPONENT_TIMING_GATE_INCOMPLETE"]
      : []),
    ...(!insideComponent ? ["MUTATION_OUTSIDE_COMPONENT"] : []),
    ...(!noNewOverlap ? ["MUTATION_CREATES_NEW_ILLEGAL_OVERLAP"] : []),
    ...(!scoreEligible ? ["JOINT_DECISION_SCORE_OR_MARGIN_LOW"] : []),
    ...(input.mode === "observe" ? ["FORCED_ALIGNMENT_OBSERVE_ONLY"] : []),
  ];
  const uniqueBlockers = [...new Set(blockers)];
  return forcedAlignmentComponentSchema.parse({
    componentId: input.componentId,
    cueIds: orderedCues.map((cue) => cue.cueId),
    componentInterval: input.componentInterval,
    cueAlignments,
    counterfactualHypotheses,
    bestHypothesis,
    runnerUpHypothesis,
    bestHypothesisScore: bestHypothesis.score,
    runnerUpHypothesisScore: runnerUpHypothesis.score,
    decisionMargin,
    scoreCalibrationStatus: "uncalibrated-heuristic",
    duplicateOccurrenceConflicts: duplicateConflicts,
    proposedMutations,
    appliedMutations: resolved ? proposedMutations : [],
    atomicApplicationPassed,
    resolved,
    resolutionStatus: resolved ? "resolved" : "blocked",
    bestActionableHypothesis: bestHypothesis,
    runnerUpActionableHypothesis: runnerUpHypothesis,
    bestActionableHypothesisScore: bestHypothesis.score,
    runnerUpActionableHypothesisScore: runnerUpHypothesis.score,
    actionableDecisionMargin: decisionMargin,
    unresolvedReasons: resolved ? [] : uniqueBlockers,
    blocking: !resolved,
    blockers: uniqueBlockers,
    reviewRequired: !resolved,
  });
}

export function applyCanonicalForcedAlignment(input: {
  cues: readonly SubtitleCue[];
  components: readonly ForcedAlignmentComponent[];
  mode: ForcedAlignmentMode;
}): {
  cues: SubtitleCue[];
  appliedMutations: ForcedAlignmentTimingMutation[];
  rolledBackComponentIds: string[];
} {
  if (input.mode !== "enforce") {
    return {
      cues: [...input.cues],
      appliedMutations: [],
      rolledBackComponentIds: [],
    };
  }
  const cueById = new Map(input.cues.map((cue) => [cue.id, cue]));
  const appliedMutations: ForcedAlignmentTimingMutation[] = [];
  const rolledBackComponentIds: string[] = [];
  for (const component of input.components) {
    if (
      !component.resolved ||
      !component.atomicApplicationPassed ||
      component.appliedMutations.length !== component.cueIds.length
    ) {
      if (component.appliedMutations.length > 0) {
        rolledBackComponentIds.push(component.componentId);
      }
      continue;
    }
    const originals = component.cueIds.map((cueId) => cueById.get(cueId));
    if (originals.some((cue) => cue === undefined)) {
      rolledBackComponentIds.push(component.componentId);
      continue;
    }
    const staged = component.appliedMutations.map((mutation) => {
      const original = cueById.get(mutation.cueId);
      if (original === undefined) {
        throw new RangeError(`Missing mutation cue ${mutation.cueId}.`);
      }
      return {
        ...original,
        start: mutation.afterStart,
        end: mutation.afterEnd,
        text: original.text,
      };
    });
    if (
      staged.some((cue) => {
        const original = cueById.get(cue.id);
        return (
          original === undefined ||
          cue.end <= cue.start ||
          cue.text !== original.text
        );
      })
    ) {
      rolledBackComponentIds.push(component.componentId);
      continue;
    }
    staged.forEach((cue) => cueById.set(cue.id, cue));
    appliedMutations.push(...component.appliedMutations);
  }
  return {
    cues: input.cues.map((cue) => cueById.get(cue.id) ?? cue),
    appliedMutations,
    rolledBackComponentIds,
  };
}

export function buildSubtitleCanonicalForcedAlignment(input: {
  generatedAt?: string;
  sourceFingerprint: SourceFingerprint;
  baseCueHash: string;
  baseTimingHash: string;
  baseOverlapArtifactHash: string;
  runtimeCapabilityRef: string | null;
  canonicalInputRef: string;
  configuration?: Partial<ForcedAlignmentConfiguration>;
  attempts: readonly ForcedAlignmentAttempt[];
  cueAlignments: readonly ForcedAlignmentCueDecision[];
  components: readonly ForcedAlignmentComponent[];
  appliedMutations: readonly ForcedAlignmentTimingMutation[];
  eligibleCueCount: number;
  ineligibleCueCount: number;
  mfaProcessCount: number;
}): SubtitleCanonicalForcedAlignment {
  const configuration = {
    ...DEFAULT_FORCED_ALIGNMENT_CONFIGURATION,
    ...input.configuration,
  } as ForcedAlignmentConfiguration;
  return subtitleCanonicalForcedAlignmentSchema.parse({
    schemaVersion: "1.0.0",
    artifactType: "subtitle-canonical-forced-alignment",
    alignmentVersion: configuration.outputParserVersion.includes("c5-17-1")
      ? "C5.17.1"
      : "C5.17",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    sourceFingerprint: input.sourceFingerprint,
    baseCueHash: input.baseCueHash,
    baseTimingHash: input.baseTimingHash,
    baseOverlapArtifactHash: input.baseOverlapArtifactHash,
    runtimeCapabilityRef: input.runtimeCapabilityRef,
    canonicalInputRef: input.canonicalInputRef,
    configuration,
    attempts: input.attempts,
    cueAlignments: input.cueAlignments,
    components: input.components,
    mutations: input.appliedMutations,
    summary: {
      componentCount: input.components.length,
      cueCount: input.cueAlignments.length,
      eligibleCueCount: input.eligibleCueCount,
      ineligibleCueCount: input.ineligibleCueCount,
      attemptCount: input.attempts.length,
      successfulAttemptCount: input.attempts.filter(
        (attempt) => attempt.alignmentSucceeded,
      ).length,
      failedAttemptCount: input.attempts.filter(
        (attempt) => !attempt.alignmentSucceeded,
      ).length,
      cacheHitCount: input.attempts.filter((attempt) => attempt.cacheHit)
        .length,
      mfaProcessCount: input.mfaProcessCount,
      stableWindowAlignmentCount: input.cueAlignments.filter(
        (cue) => cue.windowPairStatus === "stable",
      ).length,
      unstableWindowAlignmentCount: input.cueAlignments.filter(
        (cue) => cue.windowPairStatus === "unstable",
      ).length,
      windowEdgePinnedCount: input.cueAlignments.filter(
        (cue) => cue.antiForcingMetrics.windowBoundaryPinningScore > 0,
      ).length,
      criticalOovCount: input.cueAlignments.reduce(
        (sum, cue) => sum + cue.unresolvedOov.length,
        0,
      ),
      mfaAlignedCueCount: input.cueAlignments.filter(
        (cue) => cue.narrowAttemptId !== null || cue.expandedAttemptId !== null,
      ).length,
      evidenceDpAlignedCueCount: input.cueAlignments.filter(
        (cue) => cue.evidenceDp.startBoundary !== null,
      ).length,
      hybridAlignedCueCount: input.cueAlignments.filter(
        (cue) =>
          cue.evidenceDp.startBoundary !== null &&
          (cue.narrowAttemptId !== null || cue.expandedAttemptId !== null),
      ).length,
      duplicateOccurrenceConflictCount: input.components.reduce(
        (sum, component) => sum + component.duplicateOccurrenceConflicts.length,
        0,
      ),
      autoResolvedComponentCount: input.components.filter(
        (component) => component.resolved,
      ).length,
      timingMutationCount: input.appliedMutations.length,
      unresolvedComponentCount: input.components.filter(
        (component) => component.blocking,
      ).length,
      canonicalTextMutationCount: 0,
      untrustedForcedAlignmentTimingUseCount: 0,
      duplicateOccurrenceAssignedCount: 0,
      wholeMediaAsrRequestCount: 0,
      whisperAsrRequestCount: 0,
      openAiRequestCount: 0,
      onlineSubtitleLookupCount: 0,
      whisperPromptContaminationCount: 0,
      midpointRepairCount: 0,
      characterRatioRepairCount: 0,
      readingRatioRepairCount: 0,
      phoneCountRatioRepairCount: 0,
      mfaRuntimeVerified: input.attempts.length > 0,
      mfaModelIdentityVerified: input.attempts.length > 0,
      mfaFreshExecuted: input.mfaProcessCount > 0,
      windowPairAvailableCount: input.cueAlignments.filter((cue) =>
        ["stable", "unstable"].includes(cue.windowPairStatus ?? ""),
      ).length,
      windowPairUnavailableCount: input.cueAlignments.filter(
        (cue) => cue.windowPairStatus === "unavailable",
      ).length,
      windowPairStableCount: input.cueAlignments.filter(
        (cue) => cue.windowPairStatus === "stable",
      ).length,
      windowPairUnstableCount: input.cueAlignments.filter(
        (cue) => cue.windowPairStatus === "unstable",
      ).length,
      singleWindowOnlyCount: input.cueAlignments.filter(
        (cue) => cue.windowPairStatus === "single-window",
      ).length,
      uniqueBlockingComponentCount: new Set(
        input.components
          .filter((component) => component.blocking)
          .map((component) => component.componentId),
      ).size,
      uniqueBlockingCueCount: new Set(
        input.components
          .filter((component) => component.blocking)
          .flatMap((component) => component.cueIds),
      ).size,
      diagnosticBlockingFindingCount: input.components.reduce(
        (sum, component) => sum + component.blockers.length,
        0,
      ),
      actionableHypothesisAvailableCount: input.components.filter(
        (component) => component.bestActionableHypothesis !== null,
      ).length,
      canonicalUnitCoverageMean:
        input.attempts.length === 0
          ? 0
          : input.attempts.reduce(
              (sum, attempt) => sum + (attempt.canonicalUnitCoverageRatio ?? 0),
              0,
            ) / input.attempts.length,
      pronunciationCoverageMean:
        input.attempts.length === 0
          ? 0
          : input.attempts.reduce(
              (sum, attempt) =>
                sum + (attempt.pronunciationUnitCoverageRatio ?? 0),
              0,
            ) / input.attempts.length,
      expectedPhoneCoverageMean:
        input.attempts.length === 0
          ? 0
          : input.attempts.reduce(
              (sum, attempt) => sum + (attempt.expectedPhoneCoverageRatio ?? 0),
              0,
            ) / input.attempts.length,
      wordUnitMappingAmbiguousCount: input.attempts.reduce(
        (sum, attempt) => sum + (attempt.ambiguousMappingCount ?? 0),
        0,
      ),
      fileIntervalUsedForTimingCount: 0,
      readingCoverageCopiedFromWordCoverageCount: 0,
      indexBasedWordUnitMappingCount: 0,
      oneSidedBoundaryAcceptedAsFullAgreementCount: 0,
    },
  });
}

function forcedRelationship(
  value: ForcedAlignmentHypothesis["relationship"],
): SubtitleOverlapAcousticResolution["components"][number]["finalRelationship"] {
  if (value === "rapid-turn-taking") return "rapid-turn-taking";
  if (value === "same-occurrence-alternative") {
    return "same-utterance-alternative";
  }
  if (value === "ordered-no-overlap") {
    return "different-dialogue-boundary-error";
  }
  return "unresolved";
}

/** Adds C5.17 evidence to the C5.16.1 audit without erasing its lineage. */
export function applyForcedAlignmentEvidenceToOverlapArtifact(input: {
  overlap: SubtitleOverlapAcousticResolution;
  forcedAlignment: SubtitleCanonicalForcedAlignment;
}): SubtitleOverlapAcousticResolution {
  const forcedById = new Map(
    input.forcedAlignment.components.map((component) => [
      component.componentId,
      component,
    ]),
  );
  const components = input.overlap.components.map((component) => {
    const forced = forcedById.get(component.componentId);
    if (forced === undefined) return component;
    const resolved = forced.resolved && !forced.blocking;
    return {
      ...component,
      finalRelationship: resolved
        ? forcedRelationship(forced.bestHypothesis.relationship)
        : component.finalRelationship,
      classificationConfidence: resolved
        ? forced.bestHypothesisScore
        : component.classificationConfidence,
      bestHypothesis:
        forced.bestHypothesis.relationship === "same-occurrence-alternative"
          ? "same-utterance-alternative"
          : forced.bestHypothesis.relationship === "partial-alignment" ||
              forced.bestHypothesis.relationship === "unresolved"
            ? component.bestHypothesis
            : forced.bestHypothesis.relationship,
      bestHypothesisScore: forced.bestHypothesisScore,
      runnerUpHypothesis:
        forced.runnerUpHypothesis.relationship === "same-occurrence-alternative"
          ? "same-utterance-alternative"
          : forced.runnerUpHypothesis.relationship === "partial-alignment" ||
              forced.runnerUpHypothesis.relationship === "unresolved"
            ? null
            : forced.runnerUpHypothesis.relationship,
      runnerUpHypothesisScore: forced.runnerUpHypothesisScore,
      decisionMargin: forced.decisionMargin,
      scoreCalibrationStatus: "uncalibrated-heuristic" as const,
      recommendedAction: resolved
        ? ("trim-boundary" as const)
        : ("review" as const),
      safeAutomaticAction: resolved
        ? ("timing-only" as const)
        : ("none" as const),
      timingMutations: resolved
        ? forced.appliedMutations.map((mutation) => ({
            mutationId: mutation.mutationId,
            componentId: mutation.componentId,
            cueId: mutation.cueId,
            beforeStart: mutation.beforeStart,
            beforeEnd: mutation.beforeEnd,
            afterStart: mutation.afterStart,
            afterEnd: mutation.afterEnd,
            startDelta: mutation.startDelta,
            endDelta: mutation.endDelta,
            boundarySource: "canonical-forced-alignment" as const,
            evidenceIds: [
              ...mutation.mfaEvidenceIds,
              ...mutation.mappedTokenEvidenceIds,
              ...mutation.rawVadEvidenceIds,
            ],
            textChanged: false as const,
          }))
        : component.timingMutations,
      blocking: !resolved,
      reasons: [
        ...component.reasons,
        ...(resolved
          ? ["C5.17_CANONICAL_FORCED_ALIGNMENT_TIMING_GATE_PASSED"]
          : ["C5.17_CANONICAL_FORCED_ALIGNMENT_REMAINS_UNRESOLVED"]),
        ...forced.blockers,
      ],
      forcedAlignmentComponentId: forced.componentId,
      forcedAlignmentEvidenceIds: forced.cueAlignments.flatMap(
        (cue) => cue.boundaryEvidenceIds,
      ),
      forcedAlignmentBlockers: forced.blockers,
      forcedAlignmentResolved: resolved,
    };
  });
  const forcedComponents = input.forcedAlignment.components;
  return subtitleOverlapAcousticResolutionSchema.parse({
    ...input.overlap,
    resolutionVersion: "C5.17",
    components,
    summary: {
      ...input.overlap.summary,
      resolvedCount: components.filter((component) => !component.blocking)
        .length,
      timingOnlyResolvedCount: components.filter(
        (component) =>
          !component.blocking &&
          component.safeAutomaticAction === "timing-only",
      ).length,
      unresolvedCount: components.filter((component) => component.blocking)
        .length,
      timingMutationCount: components.reduce(
        (sum, component) => sum + component.timingMutations.length,
        0,
      ),
      forcedAlignmentAnalyzedCount: forcedComponents.length,
      forcedAlignmentResolvedCount: forcedComponents.filter(
        (component) => component.resolved,
      ).length,
      forcedAlignmentTimingMutationCount:
        input.forcedAlignment.summary.timingMutationCount,
    },
  });
}

/** Projects timing-only forced-alignment results into the presentation audit. */
export function applyForcedAlignmentToPresentation(input: {
  presentation: SubtitlePresentationResolutionResult;
  forcedAlignment: SubtitleCanonicalForcedAlignment;
  cues: readonly SubtitleCue[];
}): SubtitlePresentationResolutionResult {
  const forcedByCueSet = new Map(
    input.forcedAlignment.components.map((component) => [
      [...component.cueIds].toSorted().join("\u0000"),
      component,
    ]),
  );
  const overlapDecisions = input.presentation.artifact.overlapDecisions.map(
    (decision) => {
      const forced = forcedByCueSet.get(
        [...decision.cueIds].toSorted().join("\u0000"),
      );
      if (forced === undefined) return decision;
      const resolved = forced.resolved && !forced.blocking;
      return {
        ...decision,
        relationship: resolved
          ? forcedRelationship(forced.bestHypothesis.relationship)
          : decision.relationship,
        recommendedAction: resolved
          ? ("trim-boundary" as const)
          : ("review" as const),
        safeAutomaticAction: resolved
          ? ("timing-only" as const)
          : ("none" as const),
        timingMutations: resolved
          ? forced.appliedMutations.map((mutation) => ({
              cueId: mutation.cueId,
              before: {
                start: mutation.beforeStart,
                end: mutation.beforeEnd,
              },
              after: {
                start: mutation.afterStart,
                end: mutation.afterEnd,
              },
              boundarySource: "canonical-forced-alignment" as const,
            }))
          : decision.timingMutations,
        reasons: [
          ...decision.reasons,
          ...(resolved
            ? ["C5.17_CANONICAL_FORCED_ALIGNMENT_TIMING_GATE_PASSED"]
            : ["C5.17_CANONICAL_FORCED_ALIGNMENT_REMAINS_UNRESOLVED"]),
          ...forced.blockers,
        ],
        blocking: !resolved,
        resolutionSource: "canonical-forced-alignment" as const,
        acousticEvidenceIds: forced.cueAlignments.flatMap(
          (cue) => cue.boundaryEvidenceIds,
        ),
        classificationConfidence: forced.bestHypothesisScore,
        counterfactualScores: Object.fromEntries(
          forced.counterfactualHypotheses.map((hypothesis) => [
            hypothesis.relationship,
            hypothesis.score,
          ]),
        ),
      };
    },
  );
  const overlapStatus = summarizeSrtOverlapStatus({
    cues: input.cues,
    decisions: overlapDecisions,
  });
  const presentationResolution =
    input.presentation.artifact.configuration.presentationResolution;
  const serializedAssOverrides =
    presentationResolution === "enforce"
      ? input.presentation.artifact.overlapDecisions.flatMap(
          (decision) => decision.assEventOverrides,
        )
      : [];
  const serializedVttSettings =
    presentationResolution === "enforce"
      ? input.presentation.artifact.overlapDecisions.flatMap(
          (decision) => decision.vttCueSettings,
        )
      : [];
  const artifact = subtitlePresentationResolutionSchema.parse({
    ...input.presentation.artifact,
    resolutionVersion: "C5.17",
    canonicalCueHash: presentationResolutionHash(input.cues),
    presentationCueHash: buildPresentationCueHash({
      cues: input.cues,
      displayTextByCueId: input.presentation.displayTextByCueId,
      assEventOverrides: serializedAssOverrides,
      vttCueSettings: serializedVttSettings,
    }),
    overlapDecisions,
    summary: {
      ...input.presentation.artifact.summary,
      overlapResolvedCount: overlapDecisions.filter(
        (decision) => !decision.blocking,
      ).length,
      overlapBlockingCount: overlapDecisions.filter(
        (decision) => decision.blocking,
      ).length,
      timingMutationCount: overlapDecisions.reduce(
        (sum, decision) => sum + decision.timingMutations.length,
        0,
      ),
      ...overlapStatus,
    },
  });
  return {
    ...input.presentation,
    cues: [...input.cues],
    artifact,
  };
}
