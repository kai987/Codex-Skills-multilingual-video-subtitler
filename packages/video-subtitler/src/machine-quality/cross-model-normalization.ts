import type { CrossModelDisagreementClass } from "./second-asr-types.js";

import {
  candidateTextSimilarity,
  normalizeCandidateText,
} from "./evidence-correlation.js";

export interface CrossModelTextView {
  displayText: string;
  normalizedDisplayText: string;
  pronunciationText: string;
  hallucinationRisk: number;
}

export function normalizeIndependentAsrDisplay(value: string): string {
  return value
    .normalize("NFC")
    .replace(/[\p{Z}\s]+/gu, " ")
    .trim();
}

export function normalizeIndependentAsrLexical(value: string): string {
  return normalizeCandidateText(normalizeIndependentAsrDisplay(value));
}

export function normalizeJapanesePronunciation(value: string): string {
  return Array.from(normalizeIndependentAsrLexical(value))
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 0x30a1 && code <= 0x30f6
        ? String.fromCodePoint(code - 0x60)
        : character;
    })
    .join("");
}

export function independentAsrLexicalEditDistance(
  left: string,
  right: string,
): number {
  const source = Array.from(left);
  const target = Array.from(right);
  const previous = target.map((_, index) => index + 1);
  previous.unshift(0);
  for (let sourceIndex = 0; sourceIndex < source.length; sourceIndex += 1) {
    const current = [sourceIndex + 1];
    for (let targetIndex = 0; targetIndex < target.length; targetIndex += 1) {
      current.push(
        Math.min(
          (current[targetIndex] ?? 0) + 1,
          (previous[targetIndex + 1] ?? 0) + 1,
          (previous[targetIndex] ?? 0) +
            (source[sourceIndex] === target[targetIndex] ? 0 : 1),
        ),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous.at(-1) ?? source.length;
}

export function normalizedEditSimilarity(left: string, right: string): number {
  const maximum = Math.max(Array.from(left).length, Array.from(right).length);
  if (maximum === 0) return 1;
  return Math.max(
    0,
    1 - independentAsrLexicalEditDistance(left, right) / maximum,
  );
}

export function genericHallucinationRisk(input: {
  text: string;
  durationSeconds: number;
}): number {
  const normalized = normalizeIndependentAsrLexical(input.text);
  const characters = Array.from(normalized);
  if (characters.length === 0) return 0;
  const density = characters.length / Math.max(0.1, input.durationSeconds);
  let longestRun = 1;
  let run = 1;
  for (let index = 1; index < characters.length; index += 1) {
    if (characters[index] === characters[index - 1]) {
      run += 1;
      longestRun = Math.max(longestRun, run);
    } else {
      run = 1;
    }
  }
  const phrases = new Map<string, number>();
  for (
    let width = 2;
    width <= Math.min(6, Math.floor(characters.length / 2));
    width += 1
  ) {
    for (let index = 0; index + width <= characters.length; index += 1) {
      const phrase = characters.slice(index, index + width).join("");
      phrases.set(phrase, (phrases.get(phrase) ?? 0) + 1);
    }
  }
  const maximumPhraseCount = Math.max(1, ...phrases.values());
  const runRisk = Math.max(0, longestRun - 2) / 5;
  const phraseRisk = Math.max(0, maximumPhraseCount - 2) / 5;
  const densityRisk = Math.max(0, density - 12) / 18;
  return Math.min(1, Math.max(runRisk, phraseRisk, densityRisk));
}

export function compareCrossModelText(
  whisper: CrossModelTextView,
  reazon: CrossModelTextView,
): {
  exactAgreement: boolean;
  normalizedAgreement: boolean;
  pronunciationAgreement: boolean;
  normalizedSimilarity: number;
  pronunciationSimilarity: number;
  disagreementClass: CrossModelDisagreementClass;
} {
  const exactAgreement = whisper.displayText === reazon.displayText;
  const normalizedAgreement =
    whisper.normalizedDisplayText !== "" &&
    whisper.normalizedDisplayText === reazon.normalizedDisplayText;
  const pronunciationAgreement =
    whisper.pronunciationText !== "" &&
    whisper.pronunciationText === reazon.pronunciationText;
  const normalizedSimilarity = candidateTextSimilarity(
    whisper.normalizedDisplayText,
    reazon.normalizedDisplayText,
  );
  const pronunciationSimilarity = normalizedEditSimilarity(
    normalizeJapanesePronunciation(whisper.pronunciationText),
    normalizeJapanesePronunciation(reazon.pronunciationText),
  );
  let disagreementClass: CrossModelDisagreementClass;
  if (reazon.normalizedDisplayText === "") disagreementClass = "REAZON_EMPTY";
  else if (whisper.normalizedDisplayText === "")
    disagreementClass = "WHISPER_EMPTY";
  else if (exactAgreement) disagreementClass = "EXACT_AGREEMENT";
  else if (normalizedAgreement) disagreementClass = "NORMALIZED_AGREEMENT";
  else if (pronunciationAgreement)
    disagreementClass = "PRONUNCIATION_AGREEMENT";
  else if (normalizedSimilarity >= 0.9 || pronunciationSimilarity >= 0.9) {
    disagreementClass = "ORTHOGRAPHY_ONLY_DIFFERENCE";
  } else if (
    whisper.hallucinationRisk >= 0.6 &&
    reazon.hallucinationRisk >= 0.6
  ) {
    disagreementClass = "BOTH_LOW_SUPPORT";
  } else if (whisper.hallucinationRisk >= 0.6) {
    disagreementClass = "WHISPER_HALLUCINATION_RISK";
  } else if (reazon.hallucinationRisk >= 0.6) {
    disagreementClass = "REAZON_HALLUCINATION_RISK";
  } else disagreementClass = "LEXICAL_DISAGREEMENT";
  return {
    exactAgreement,
    normalizedAgreement,
    pronunciationAgreement,
    normalizedSimilarity,
    pronunciationSimilarity,
    disagreementClass,
  };
}
