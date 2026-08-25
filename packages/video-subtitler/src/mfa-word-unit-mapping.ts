import { createHash } from "node:crypto";

export interface MfaCanonicalUnitForMapping {
  unitId: string;
  surface: string;
  normalizedSurface: string;
  reading: string | null;
  phones: readonly string[];
  punctuation: boolean;
  criticalOov: boolean;
}

export interface MfaWordForMapping {
  alignmentId: string;
  label: string;
  phones: readonly string[];
  oov: boolean;
}

export type MfaWordUnitMappingType =
  | "MATCH_1_TO_1"
  | "MATCH_1_TO_MANY"
  | "MATCH_MANY_TO_1"
  | "SKIP_CANONICAL_UNIT"
  | "SKIP_MFA_WORD"
  | "UNRESOLVED_MAPPING";

export interface MfaWordUnitMapping {
  mappingId: string;
  canonicalUnitIds: string[];
  mfaWordIds: string[];
  mappingType: MfaWordUnitMappingType;
  surfaceScore: number;
  readingScore: number | null;
  phoneScore: number | null;
  combinedScore: number;
  ambiguityMargin: number | null;
  mappingConfidence: number;
  blockers: string[];
}

interface Candidate {
  canonicalCount: number;
  wordCount: number;
  mappingType: MfaWordUnitMappingType;
  mapping: Omit<MfaWordUnitMapping, "mappingId" | "ambiguityMargin">;
  score: number;
}

interface Cell {
  score: number;
  mappings: MfaWordUnitMapping[];
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalized(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]/gu, "")
    .replace(/[ァ-ヶ]/gu, (character) =>
      String.fromCodePoint((character.codePointAt(0) ?? 0) - 0x60),
    );
}

function bigrams(value: string): string[] {
  const characters = Array.from(normalized(value));
  if (characters.length <= 1) return characters;
  return characters.slice(0, -1).map((item, index) => {
    const next = characters[index + 1] ?? "";
    return `${item}${next}`;
  });
}

function similarity(left: string, right: string): number {
  const a = normalized(left);
  const b = normalized(right);
  if (a === b && a !== "") return 1;
  if (a === "" || b === "") return 0;
  const leftBigrams = bigrams(a);
  const rightBigrams = [...bigrams(b)];
  let intersection = 0;
  for (const item of leftBigrams) {
    const index = rightBigrams.indexOf(item);
    if (index >= 0) {
      intersection += 1;
      rightBigrams.splice(index, 1);
    }
  }
  return (
    (2 * intersection) / Math.max(1, leftBigrams.length + bigrams(b).length)
  );
}

function phoneSimilarity(
  left: readonly string[],
  right: readonly string[],
): number | null {
  if (left.length === 0 || right.length === 0) return null;
  const a = left.map(normalized).filter(Boolean);
  const b = right.map(normalized).filter(Boolean);
  const matrix = Array.from({ length: a.length + 1 }, () =>
    Array<number>(b.length + 1).fill(0),
  );
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const row = matrix[i];
      if (row === undefined) {
        throw new Error("Phone similarity matrix row is unavailable.");
      }
      row[j] =
        a[i - 1] === b[j - 1]
          ? (matrix[i - 1]?.[j - 1] ?? 0) + 1
          : Math.max(matrix[i - 1]?.[j] ?? 0, matrix[i]?.[j - 1] ?? 0);
    }
  }
  return (matrix[a.length]?.[b.length] ?? 0) / Math.max(a.length, b.length, 1);
}

function candidate(input: {
  canonicalUnits: readonly MfaCanonicalUnitForMapping[];
  words: readonly MfaWordForMapping[];
  mappingType: MfaWordUnitMappingType;
}): Candidate {
  const canonicalSurface = input.canonicalUnits
    .map((unit) => unit.surface)
    .join("");
  const canonicalNormalizedSurface = input.canonicalUnits
    .map((unit) => unit.normalizedSurface)
    .join("");
  const wordSurface = input.words.map((word) => word.label).join("");
  const canonicalReading = input.canonicalUnits
    .map((unit) => unit.reading ?? "")
    .join("");
  const surfaceScore = Math.max(
    similarity(canonicalSurface, wordSurface),
    similarity(canonicalNormalizedSurface, wordSurface),
  );
  const readingScore =
    canonicalReading === "" ? null : similarity(canonicalReading, wordSurface);
  const phoneScore = phoneSimilarity(
    input.canonicalUnits.flatMap((unit) => [...unit.phones]),
    input.words.flatMap((word) => [...word.phones]),
  );
  const observed = [surfaceScore, readingScore, phoneScore].filter(
    (value): value is number => value !== null,
  );
  const combinedScore =
    surfaceScore * 0.5 +
    (readingScore ?? surfaceScore) * 0.3 +
    (phoneScore ?? Math.min(surfaceScore, readingScore ?? surfaceScore)) * 0.2;
  const oovPenalty =
    input.canonicalUnits.some((unit) => unit.criticalOov) ||
    input.words.some((word) => word.oov)
      ? 0.12
      : 0;
  const groupingPenalty = input.mappingType === "MATCH_1_TO_1" ? 0 : 0.03;
  const score = Math.max(0, combinedScore - oovPenalty - groupingPenalty);
  return {
    canonicalCount: input.canonicalUnits.length,
    wordCount: input.words.length,
    mappingType: input.mappingType,
    mapping: {
      canonicalUnitIds: input.canonicalUnits.map((unit) => unit.unitId),
      mfaWordIds: input.words.map((word) => word.alignmentId),
      mappingType: input.mappingType,
      surfaceScore,
      readingScore,
      phoneScore,
      combinedScore,
      mappingConfidence: score,
      blockers: [
        ...(oovPenalty > 0 ? ["WORD_UNIT_MAPPING_OOV"] : []),
        ...(observed.length === 0
          ? ["WORD_UNIT_MAPPING_NO_COMPARABLE_EVIDENCE"]
          : []),
      ],
    },
    score,
  };
}

function mappingWithIdentity(input: {
  candidate: Candidate;
  ambiguityMargin: number | null;
}): MfaWordUnitMapping {
  const ambiguous =
    input.candidate.mappingType.startsWith("MATCH_") &&
    (input.ambiguityMargin ?? 1) < 0.05;
  const lowConfidence =
    input.candidate.mappingType.startsWith("MATCH_") &&
    input.candidate.score < 0.45;
  const mappingType =
    ambiguous || lowConfidence
      ? ("UNRESOLVED_MAPPING" as const)
      : input.candidate.mappingType;
  const blockers = [
    ...input.candidate.mapping.blockers,
    ...(ambiguous ? ["WORD_UNIT_MAPPING_AMBIGUOUS"] : []),
    ...(lowConfidence ? ["WORD_UNIT_MAPPING_SCORE_LOW"] : []),
  ];
  const identity = {
    canonicalUnitIds: input.candidate.mapping.canonicalUnitIds,
    mfaWordIds: input.candidate.mapping.mfaWordIds,
    mappingType,
  };
  return {
    ...input.candidate.mapping,
    mappingType,
    mappingId: `mfa-word-unit-map-${stableHash(identity).slice(0, 20)}`,
    ambiguityMargin: input.ambiguityMargin,
    blockers,
  };
}

function key(i: number, j: number): string {
  return `${String(i)}:${String(j)}`;
}

/**
 * Deterministic monotonic sequence alignment. The path supports 1:1, 1:M,
 * M:1, punctuation skips, and explicit unmatched words/units. No array-index
 * binding or proportional allocation is used.
 */
export function alignMfaWordsToCanonicalUnits(input: {
  canonicalUnits: readonly MfaCanonicalUnitForMapping[];
  words: readonly MfaWordForMapping[];
}): {
  mappings: MfaWordUnitMapping[];
  ambiguousCount: number;
  unresolvedCount: number;
  indexBasedMappingCount: 0;
} {
  const units = input.canonicalUnits;
  const words = input.words;
  const cells = new Map<string, Cell>([
    [key(0, 0), { score: 0, mappings: [] }],
  ]);
  const update = (i: number, j: number, next: Cell): void => {
    const current = cells.get(key(i, j));
    if (
      current === undefined ||
      next.score > current.score + 1e-9 ||
      (Math.abs(next.score - current.score) <= 1e-9 &&
        JSON.stringify(next.mappings) < JSON.stringify(current.mappings))
    ) {
      cells.set(key(i, j), next);
    }
  };

  for (let i = 0; i <= units.length; i += 1) {
    for (let j = 0; j <= words.length; j += 1) {
      const current = cells.get(key(i, j));
      if (current === undefined) continue;
      const candidates: Candidate[] = [];
      if (i < units.length && j < words.length) {
        candidates.push(
          candidate({
            canonicalUnits: units.slice(i, i + 1),
            words: words.slice(j, j + 1),
            mappingType: "MATCH_1_TO_1",
          }),
        );
      }
      for (const count of [2, 3] as const) {
        if (i < units.length && j + count <= words.length) {
          candidates.push(
            candidate({
              canonicalUnits: units.slice(i, i + 1),
              words: words.slice(j, j + count),
              mappingType: "MATCH_1_TO_MANY",
            }),
          );
        }
        if (i + count <= units.length && j < words.length) {
          candidates.push(
            candidate({
              canonicalUnits: units.slice(i, i + count),
              words: words.slice(j, j + 1),
              mappingType: "MATCH_MANY_TO_1",
            }),
          );
        }
      }
      if (i < units.length) {
        const unit = units[i];
        if (unit === undefined) continue;
        candidates.push({
          canonicalCount: 1,
          wordCount: 0,
          mappingType: "SKIP_CANONICAL_UNIT",
          mapping: {
            canonicalUnitIds: [unit.unitId],
            mfaWordIds: [],
            mappingType: "SKIP_CANONICAL_UNIT",
            surfaceScore: 0,
            readingScore: null,
            phoneScore: null,
            combinedScore: 0,
            mappingConfidence: unit.punctuation ? 1 : 0.15,
            blockers: unit.punctuation ? [] : ["CANONICAL_UNIT_UNMAPPED"],
          },
          score: unit.punctuation ? 0 : -0.35,
        });
      }
      if (j < words.length) {
        const word = words[j];
        if (word === undefined) continue;
        candidates.push({
          canonicalCount: 0,
          wordCount: 1,
          mappingType: "SKIP_MFA_WORD",
          mapping: {
            canonicalUnitIds: [],
            mfaWordIds: [word.alignmentId],
            mappingType: "SKIP_MFA_WORD",
            surfaceScore: 0,
            readingScore: null,
            phoneScore: null,
            combinedScore: 0,
            mappingConfidence: 0.1,
            blockers: ["MFA_WORD_UNMAPPED"],
          },
          score: -0.35,
        });
      }
      const ranked = candidates.toSorted(
        (left, right) =>
          right.score - left.score ||
          left.mappingType.localeCompare(right.mappingType) ||
          left.canonicalCount - right.canonicalCount ||
          left.wordCount - right.wordCount,
      );
      for (const option of ranked) {
        const localRunnerUp = ranked.find(
          (value) =>
            value.canonicalCount !== option.canonicalCount ||
            value.wordCount !== option.wordCount ||
            value.mappingType !== option.mappingType,
        );
        const ambiguityMargin = option.mappingType.startsWith("MATCH_")
          ? Math.min(1, Math.max(0, option.score - (localRunnerUp?.score ?? 0)))
          : null;
        const mapping = mappingWithIdentity({
          candidate: option,
          ambiguityMargin,
        });
        update(i + option.canonicalCount, j + option.wordCount, {
          score: current.score + option.score,
          mappings: [...current.mappings, mapping],
        });
      }
    }
  }
  const result = cells.get(key(units.length, words.length));
  if (result === undefined) {
    throw new Error(
      "MFA word/canonical unit sequence alignment produced no path.",
    );
  }
  return {
    mappings: result.mappings,
    ambiguousCount: result.mappings.filter((mapping) =>
      mapping.blockers.includes("WORD_UNIT_MAPPING_AMBIGUOUS"),
    ).length,
    unresolvedCount: result.mappings.filter(
      (mapping) => mapping.mappingType === "UNRESOLVED_MAPPING",
    ).length,
    indexBasedMappingCount: 0,
  };
}
