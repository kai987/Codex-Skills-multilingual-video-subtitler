import {
  normalizeIndependentAsrDisplay,
  normalizeJapanesePronunciation,
} from "./cross-model-normalization.js";

export interface IndependentCtcRepresentation {
  type: "NORMALIZED_DISPLAY" | "PRONUNCIATION";
  text: string;
}

export function independentCtcRepresentations(input: {
  displayText: string;
  pronunciationText?: string;
}): IndependentCtcRepresentation[] {
  const normalizedDisplay = normalizeIndependentAsrDisplay(input.displayText);
  const pronunciation = normalizeJapanesePronunciation(
    input.pronunciationText ?? normalizedDisplay,
  );
  const values: IndependentCtcRepresentation[] = [
    { type: "NORMALIZED_DISPLAY", text: normalizedDisplay },
    { type: "PRONUNCIATION", text: pronunciation },
  ];
  return values.filter(
    (value, index) =>
      value.text !== "" &&
      values.findIndex((candidate) => candidate.text === value.text) === index,
  );
}

