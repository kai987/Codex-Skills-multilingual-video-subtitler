import { acousticProjectionSchema, type AcousticProjection } from "@mvl/shared";

import { normalizeCtcAlignmentText } from "../ctc-alignment.js";
import { machineQualitySemanticHash } from "./evidence-correlation.js";

const HAN = /\p{Script=Han}/u;
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}ー]/u;
const LEXICAL =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Letter}\p{Number}]/u;

function katakanaToHiragana(value: string): string {
  return Array.from(value, (character) => {
    const code = character.codePointAt(0);
    if (code !== undefined && code >= 0x30a1 && code <= 0x30f6) {
      return String.fromCodePoint(code - 0x60);
    }
    return character;
  }).join("");
}

function lexicalCharacters(value: string): string[] {
  return Array.from(value).filter((character) => LEXICAL.test(character));
}

export function projectJapanesePronunciation(input: {
  projectionId: string;
  displayText: string;
  machineReading?: string | null;
  unresolvedMachineUnits?: readonly string[];
}): AcousticProjection {
  const normalizedDisplay = normalizeCtcAlignmentText(input.displayText).text;
  const lexical = lexicalCharacters(normalizedDisplay);
  const machineReading = input.machineReading?.normalize("NFC").trim() ?? "";
  const normalizedReading =
    machineReading === ""
      ? ""
      : katakanaToHiragana(normalizeCtcAlignmentText(machineReading).text);
  let method: AcousticProjection["method"];
  let projectionText: string;
  let unresolvedUnits: string[];
  let projectionCoverage: number;
  if (lexical.length === 0) {
    method = "unscorable";
    projectionText = "";
    unresolvedUnits = ["no-lexical-target"];
    projectionCoverage = 0;
  } else if (normalizedReading !== "") {
    method = "sudachi-reading";
    projectionText = normalizedReading;
    unresolvedUnits = [...(input.unresolvedMachineUnits ?? [])];
    projectionCoverage = Math.max(
      0,
      Math.min(1, (lexical.length - unresolvedUnits.length) / lexical.length),
    );
  } else if (!HAN.test(normalizedDisplay) && KANA.test(normalizedDisplay)) {
    method = "kana-literal";
    projectionText = katakanaToHiragana(normalizedDisplay);
    unresolvedUnits = [];
    projectionCoverage = 1;
  } else {
    // The existing Japanese CTC tokenizer supports Japanese graphemes. Keeping
    // the display form is a machine-only fallback, not a claimed pronunciation.
    method = "display-text-fallback";
    projectionText = normalizedDisplay;
    unresolvedUnits = HAN.test(normalizedDisplay)
      ? ["generic-reading-unavailable"]
      : [];
    projectionCoverage = unresolvedUnits.length === 0 ? 1 : 0.5;
  }
  const core = {
    projectionId: input.projectionId,
    displayTextHash: machineQualitySemanticHash(input.displayText),
    projectionText,
    projectionTextHash: machineQualitySemanticHash(projectionText),
    method,
    projectionCoverage,
    unresolvedUnits,
    humanDerivedEntryCount: 0 as const,
    canonicalTextMutated: false as const,
  };
  return acousticProjectionSchema.parse({
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
}

export function projectJapanesePronunciationBatch(input: {
  variants: readonly { variantId: string; displayText: string }[];
  machineReadings?: ReadonlyMap<
    string,
    { reading: string | null; unresolvedUnits: readonly string[] }
  >;
}): AcousticProjection[] {
  return [...input.variants]
    .toSorted((left, right) => left.variantId.localeCompare(right.variantId))
    .map((variant) => {
      const machine = input.machineReadings?.get(variant.variantId);
      return projectJapanesePronunciation({
        projectionId: `acoustic-projection:${variant.variantId}`,
        displayText: variant.displayText,
        ...(machine === undefined
          ? {}
          : {
              machineReading: machine.reading,
              unresolvedMachineUnits: machine.unresolvedUnits,
            }),
      });
    });
}
