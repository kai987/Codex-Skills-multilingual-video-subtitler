import {
  c61CandidateTextSchema,
  c61TextRepresentationSchema,
  type C61CandidateText,
  type C61TextRepresentation,
  type C61TextUnit,
} from "@mvl/shared";
import { machineQualitySemanticHash } from "../machine-quality/evidence-correlation.js";
const segmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });
/** Bounds and graph invariants fail closed, including when loading corrupted artifacts. */
export function c61Require<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("C61_ALIGNMENT_INVARIANT_MISSING");
  return value;
}
export function c61Defined<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("C61_ALIGNMENT_INVARIANT_MISSING");
  return value;
}
export function c61Graphemes(value: string): string[] {
  return [...segmenter.segment(value)].map((part) => part.segment);
}
/** Orthographic normalization only; punctuation and lexical distinctions remain. */
export function normalizeC61Japanese(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\\[Nn]|\r\n?|\n/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}
/** Never infer kanji readings, long-vowel expansions, small-kana equivalence or homophones. */
export function normalizeC61Pronunciation(value: string): string {
  return normalizeC61Japanese(value).replace(/[ァ-ヶ]/gu, (character) =>
    String.fromCodePoint(c61Require(character.codePointAt(0)) - 0x60),
  );
}
export function buildC61Representation(
  input: C61CandidateText,
): C61TextRepresentation {
  const candidate = c61CandidateTextSchema.parse(input);
  const rawUnits = candidate.displayText
    .split(/(\\[Nn]|\r\n|\r|\n|[\t ]+)/gu)
    .filter(Boolean)
    .flatMap((part) =>
      /^(?:\\[Nn]|\s+)$/u.test(part) ? [part] : c61Graphemes(part),
    );
  const projections = new Map<
    number,
    {
      reading: string;
      evidenceId: string;
    }
  >();
  for (const projection of candidate.pronunciationUnits ?? []) {
    if (
      projection.unitIndex >= rawUnits.length ||
      projections.has(projection.unitIndex)
    )
      throw new Error("C61_INVALID_MACHINE_PRONUNCIATION_PROJECTION");
    projections.set(projection.unitIndex, projection);
  }
  const units: C61TextUnit[] = rawUnits.map((displaySurface, unitIndex) => {
    const whitespace = /^(?:\\[Nn]|\s+)$/u.test(displaySurface);
    const normalizedForm = whitespace ? " " : displaySurface.normalize("NFKC");
    const projection = projections.get(unitIndex);
    const kana = /^[\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u.test(
      normalizedForm,
    );
    return {
      unitIndex,
      displaySurface,
      normalizedForm,
      pronunciationForm: projection
        ? normalizeC61Pronunciation(projection.reading)
        : kana
          ? normalizeC61Pronunciation(normalizedForm)
          : null,
      pronunciationEvidenceId:
        projection?.evidenceId ?? (kana ? "DETERMINISTIC_KANA_SURFACE" : null),
      kind: whitespace
        ? "WHITESPACE"
        : /^[\p{P}\p{S}]+$/u.test(normalizedForm)
          ? "PUNCTUATION"
          : "LEXICAL",
    };
  });
  const body = {
    candidate,
    units,
    normalizedText: normalizeC61Japanese(candidate.displayText),
    pronunciationText:
      candidate.pronunciationText === null
        ? null
        : normalizeC61Pronunciation(candidate.pronunciationText),
    normalizationVersion: "c6.1-japanese-nfkc-grapheme-v1" as const,
  };
  return c61TextRepresentationSchema.parse({
    ...body,
    semanticHash: machineQualitySemanticHash(body),
  });
}
export function buildC61Representations(
  candidates: C61CandidateText[],
): C61TextRepresentation[] {
  const ids = new Set<string>();
  for (const candidate of candidates) {
    if (ids.has(candidate.candidateId))
      throw new Error("C61_DUPLICATE_CANDIDATE_ID");
    ids.add(candidate.candidateId);
  }
  return candidates
    .map(buildC61Representation)
    .sort((a, b) => a.semanticHash.localeCompare(b.semanticHash));
}
