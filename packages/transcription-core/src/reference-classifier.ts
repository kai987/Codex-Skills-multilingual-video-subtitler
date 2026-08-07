import {
  referenceCueClassificationArtifactSchema,
  referenceClassificationReviewArtifactSchema,
  type LanguageTag,
  type ReferenceCue,
  type ReferenceCueClassificationArtifact,
  type ReferenceClassificationReviewArtifact,
  type ReferenceCueKind,
  type ReferenceTimingMode,
} from "@mvl/shared";

import type { ParsedReferenceSubtitle } from "./reference-subtitle.js";

export const REFERENCE_CUE_CLASSIFIER_VERSION = "2.0.0";

const creditRolePattern =
  /(?:screenplay|music|musical performance|theme song|cast|director|production|photography|cooperation|research|video titles?|title logo|data sponsor|present(?:s|ed)|performance|episode\s*\d+)/iu;
const visualTextPattern =
  /(?:store|shop|town|city|village|prefecture|early morning|era|year|week\s*\d+|to be continued|photo gallery|serial tv story|carnation|end$)/iu;
const narrationPattern =
  /^(?:the time is|in an era|this is|at night|unknown even|the danjiri (?:is|was)|the (?:town|women|men|carpenters)|dad returned|grandma didn't|inside my head|i had wanted|and my ordinary|taizō-niichan's younger brother|yoshida natsu is|she arrives)/iu;
const characterRolePattern =
  /(?:grandmother|grandfather|mother|father|brother|sister|neighbor(?:hood)?|daughter|son|\byears? old\b)/iu;
const soundDescriptionPattern =
  /^(?:\[[^\]]+\]|\([^)]*(?:sound|music|laugh|sigh|noise|drum)[^)]*\))$/iu;
const translatorNotePattern =
  /(?:\s[-–—]\s.*(?:used|means|type|kind|festival|term)|^(?:note|tl note|translator(?:'s)? note)\s*:)/iu;

function normalizeReferenceText(text: string): string {
  return text
    .replace(/<[^>]+>/gu, "")
    .replace(/\{\\[^}]+\}/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function hasJapaneseScript(text: string): boolean {
  return /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(text);
}

function englishLexicalScore(text: string): number {
  const tokens = text.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/gu) ?? [];
  const EnglishWords = new Set([
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "i",
    "in",
    "is",
    "it",
    "my",
    "no",
    "not",
    "of",
    "on",
    "she",
    "that",
    "the",
    "this",
    "to",
    "was",
    "what",
    "with",
    "you",
    "your",
  ]);
  return tokens.length === 0
    ? 0
    : tokens.filter((token) => EnglishWords.has(token)).length / tokens.length;
}

function looksLikeRomanization(text: string): boolean {
  if (hasJapaneseScript(text) || /[.!?]{2,}/u.test(text)) return false;
  const tokens = text.toLowerCase().match(/[a-zōūāīē]+/gu) ?? [];
  if (tokens.length < 2) return false;
  const japaneseSyllableTokens = tokens.filter((token) =>
    /(?:ai|ao|ei|ie|ou|shi|chi|tsu|kyo|ryo|nya|wa|wo|ga|no|ni|de|te|ta|ru|su|ku|mu|yo|ne|ka|mono|kaze|kokoro|watashi|ima|hito)/u.test(
      token,
    ),
  ).length;
  return /[ōūāīē]/u.test(text) || japaneseSyllableTokens / tokens.length >= 0.5;
}

function looksLikeNameCard(text: string): boolean {
  const lines = text
    .split(/\n/gu)
    .map((line) => line.trim())
    .filter(Boolean);
  const capitalized = lines.filter((line) =>
    /^(?:[A-ZĪŌŪ][\p{L}'’-]+\s*){1,4}$/u.test(line),
  ).length;
  return lines.length > 0 && capitalized / lines.length >= 0.6;
}

function sameInterval(
  left: { start: number; end: number },
  right: {
    start: number;
    end: number;
  },
): boolean {
  return (
    Math.abs(left.start - right.start) <= 0.03 &&
    Math.abs(left.end - right.end) <= 0.03
  );
}

function overlaps(
  left: { start: number; end: number },
  right: {
    start: number;
    end: number;
  },
): boolean {
  return left.start < right.end && right.start < left.end;
}

function classifyCue(input: {
  text: string;
  sameIntervalTexts: readonly string[];
  hasDialogueOverlap: boolean;
  duration: number;
}): { kind: ReferenceCueKind; confidence: number; evidence: string[] } {
  const text = input.text;
  if (soundDescriptionPattern.test(text)) {
    return {
      kind: "sound-description",
      confidence: 0.98,
      evidence: ["bracketed-non-dialogue-description"],
    };
  }
  if (translatorNotePattern.test(text)) {
    return {
      kind: "translator-note",
      confidence: 0.96,
      evidence: ["definition-or-translator-explanation-shape"],
    };
  }
  const intervalTrackTexts = [text, ...input.sameIntervalTexts];
  const hasJapanesePeer = intervalTrackTexts.some(hasJapaneseScript);
  const hasRomanPeer = intervalTrackTexts.some(looksLikeRomanization);
  const hasEnglishPeer = intervalTrackTexts.some(
    (peer) => englishLexicalScore(peer) >= 0.15,
  );
  const isMultiTrackLyrics =
    intervalTrackTexts.length >= 3 &&
    (hasJapanesePeer || hasRomanPeer) &&
    hasEnglishPeer;
  if (isMultiTrackLyrics && hasJapaneseScript(text)) {
    return {
      kind: "lyrics-original",
      confidence: 0.99,
      evidence: [
        "same-interval-multilingual-track",
        "japanese-script-original-track",
      ],
    };
  }
  if (isMultiTrackLyrics && looksLikeRomanization(text)) {
    return {
      kind: "lyrics-romanization",
      confidence: 0.94,
      evidence: [
        "same-interval-multilingual-track",
        "latin-japanese-romanization-shape",
      ],
    };
  }
  if (isMultiTrackLyrics) {
    return {
      kind: "lyrics-translation",
      confidence: 0.92,
      evidence: [
        "same-interval-multilingual-track",
        "english-lexical-translation-track",
      ],
    };
  }
  const lines = text.split(/\n/gu).filter((line) => line.trim() !== "");
  if (
    creditRolePattern.test(text) ||
    (lines.length >= 2 && looksLikeNameCard(text) && !/[.!?]$/u.test(text))
  ) {
    return {
      kind: "credit",
      confidence: creditRolePattern.test(text) ? 0.96 : 0.78,
      evidence: [
        creditRolePattern.test(text)
          ? "production-role-and-name-structure"
          : "stacked-capitalized-name-card",
      ],
    };
  }
  if (
    characterRolePattern.test(text) ||
    (looksLikeNameCard(text) && input.hasDialogueOverlap)
  ) {
    return {
      kind: "character-introduction",
      confidence: characterRolePattern.test(text) ? 0.94 : 0.82,
      evidence: [
        "role-or-name-card-structure",
        ...(input.hasDialogueOverlap ? ["overlaps-spoken-content"] : []),
      ],
    };
  }
  if (
    visualTextPattern.test(text) &&
    (!/[.!?]$/u.test(text) || input.hasDialogueOverlap)
  ) {
    return {
      kind: "on-screen-text",
      confidence: input.hasDialogueOverlap ? 0.92 : 0.78,
      evidence: [
        "title-location-time-or-place-card-shape",
        ...(input.hasDialogueOverlap ? ["overlaps-spoken-content"] : []),
      ],
    };
  }
  if (narrationPattern.test(text) || text.startsWith("...")) {
    return {
      kind: "narration",
      confidence: 0.8,
      evidence: ["expository-or-continuing-narration-shape"],
    };
  }
  if (
    hasJapaneseScript(text) &&
    input.duration >= 4 &&
    input.sameIntervalTexts.length >= 2
  ) {
    return {
      kind: "lyrics-original",
      confidence: 0.78,
      evidence: ["japanese-script-long-vocal-like-overlap"],
    };
  }
  const sentenceLike =
    /[.!?…]$/u.test(text) ||
    /\b(?:i|you|he|she|we|they|it|is|are|was|were|do|did|have|has|will|can|could|would|should|said|say|go|come|want|know|think|look|see|tell|please|don't|can't|won't)\b/iu.test(
      text,
    );
  if (sentenceLike) {
    return {
      kind: "dialogue",
      confidence: 0.86,
      evidence: ["speech-like-sentence-with-predicate-or-terminal-punctuation"],
    };
  }
  return {
    kind: "unknown",
    confidence: 0.55,
    evidence: ["low-confidence-non-sentential-reference-cue"],
  };
}

function refineReferenceCueSequenceClassification(input: {
  cues: readonly ReferenceCue[];
  reviewThreshold: number;
}): ReferenceCue[] {
  const refined = input.cues.map((cue) => ({
    ...cue,
    evidence: [...cue.evidence],
  }));
  const nameLike = refined.map(
    (cue) =>
      looksLikeNameCard(cue.normalizedText) &&
      !/[.!?]$/u.test(cue.normalizedText) &&
      cue.interval.end - cue.interval.start <= 8,
  );
  for (const [index] of refined.entries()) {
    if (!nameLike[index]) continue;
    const cue = refined[index];
    if (cue === undefined) continue;
    const blockIndexes = refined.flatMap((candidate, candidateIndex) =>
      nameLike[candidateIndex] &&
      Math.abs(candidate.interval.start - cue.interval.start) <= 30
        ? [candidateIndex]
        : [],
    );
    if (blockIndexes.length < 3) continue;
    const hasSpokenOverlap = cue.overlappingCueIds.some((id) => {
      const peer = refined.find((candidate) => candidate.id === id);
      return peer?.kind === "dialogue" || peer?.kind === "narration";
    });
    cue.kind = hasSpokenOverlap ? "character-introduction" : "credit";
    cue.classificationConfidence = hasSpokenOverlap ? 0.9 : 0.88;
    cue.evidence.push(
      "sequence-aware-name-card-block",
      `neighboring-name-card-count:${String(blockIndexes.length)}`,
      ...(hasSpokenOverlap ? ["simultaneous-spoken-track"] : []),
    );
  }
  for (const cue of refined) {
    if (cue.kind !== "unknown") continue;
    const nearbyVisualCount = refined.filter(
      (candidate) =>
        ["credit", "character-introduction", "on-screen-text"].includes(
          candidate.kind,
        ) && Math.abs(candidate.interval.start - cue.interval.start) <= 8,
    ).length;
    const shortCard =
      cue.normalizedText.split(/\s+/u).length <= 5 &&
      !/[.!?]$/u.test(cue.normalizedText) &&
      cue.interval.end - cue.interval.start <= 8;
    if (shortCard && nearbyVisualCount >= 2) {
      cue.kind = "on-screen-text";
      cue.classificationConfidence = 0.8;
      cue.evidence.push("sequence-aware-visual-card-continuity");
    }
  }
  for (const cue of refined) {
    if (
      cue.classificationConfidence < input.reviewThreshold &&
      ["dialogue", "narration"].includes(cue.kind)
    ) {
      cue.kind = "unknown";
      cue.evidence.push(
        "below-classification-review-threshold-not-expected-speech",
      );
    }
  }
  return refined;
}

export function classifyReferenceCuesWithReview(input: {
  parsed: ParsedReferenceSubtitle;
  referenceLanguage: LanguageTag;
  mediaDurationSeconds: number;
  timingMode: ReferenceTimingMode;
  reviewThreshold?: number;
  generatedAt?: string;
}): {
  classification: ReferenceCueClassificationArtifact;
  review: ReferenceClassificationReviewArtifact;
} {
  const reviewThreshold = input.reviewThreshold ?? 0.75;
  const normalized = input.parsed.cues.map((cue) =>
    normalizeReferenceText(cue.text),
  );
  const preliminary = input.parsed.cues.map((cue, index) => {
    const overlappingIndexes = input.parsed.cues.flatMap((other, otherIndex) =>
      otherIndex !== index && overlaps(cue, other) ? [otherIndex] : [],
    );
    const sameIntervalTexts = input.parsed.cues.flatMap((other, otherIndex) =>
      otherIndex !== index && sameInterval(cue, other)
        ? [normalized[otherIndex] ?? ""]
        : [],
    );
    return { cue, index, overlappingIndexes, sameIntervalTexts };
  });
  const initialCues: ReferenceCue[] = preliminary.map((entry) => {
    const text = normalized[entry.index] ?? entry.cue.text.trim();
    const overlapTexts = entry.overlappingIndexes.map(
      (index) => normalized[index] ?? "",
    );
    const hasDialogueOverlap = overlapTexts.some(
      (overlapText) =>
        /[.!?]$/u.test(overlapText) &&
        !creditRolePattern.test(overlapText) &&
        !translatorNotePattern.test(overlapText),
    );
    const classified = classifyCue({
      text,
      sameIntervalTexts: entry.sameIntervalTexts,
      hasDialogueOverlap,
      duration: entry.cue.end - entry.cue.start,
    });
    const outOfBounds =
      entry.cue.end > input.mediaDurationSeconds + 0.5 ||
      entry.cue.end <= entry.cue.start;
    const timingTrust = outOfBounds
      ? ("suspect" as const)
      : input.timingMode === "trusted"
        ? ("trusted" as const)
        : ("verified" as const);
    return {
      id: `reference-cue-${String(entry.index + 1).padStart(5, "0")}`,
      sourceIndex: entry.index,
      interval: { start: entry.cue.start, end: entry.cue.end },
      rawText: entry.cue.text,
      normalizedText: text,
      detectedLanguage: hasJapaneseScript(text)
        ? ("ja" as const)
        : looksLikeRomanization(text)
          ? null
          : input.referenceLanguage,
      kind: classified.kind,
      classificationConfidence: classified.confidence,
      overlappingCueIds: entry.overlappingIndexes.map(
        (index) => `reference-cue-${String(index + 1).padStart(5, "0")}`,
      ),
      evidence: [
        ...classified.evidence,
        ...(entry.sameIntervalTexts.length > 0
          ? ["same-interval-peer-track-present"]
          : []),
      ],
      timingTrust,
    };
  });
  const cues = refineReferenceCueSequenceClassification({
    cues: initialCues,
    reviewThreshold,
  });
  const allKinds: ReferenceCueKind[] = [
    "dialogue",
    "narration",
    "lyrics-original",
    "lyrics-romanization",
    "lyrics-translation",
    "on-screen-text",
    "character-introduction",
    "credit",
    "translator-note",
    "sound-description",
    "unknown",
  ];
  const classification = referenceCueClassificationArtifactSchema.parse({
    schemaVersion: "1.0.0",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    input: {
      referencePath: input.parsed.absolutePath,
      referenceSha256: input.parsed.sha256,
      referenceLanguage: input.referenceLanguage,
      mediaDurationSeconds: input.mediaDurationSeconds,
    },
    classifierVersion: REFERENCE_CUE_CLASSIFIER_VERSION,
    configuration: {
      timingMode: input.timingMode,
    },
    cues,
    counts: Object.fromEntries(
      allKinds.map((kind) => [
        kind,
        cues.filter((cue) => cue.kind === kind).length,
      ]),
    ),
    fallback: null,
  });
  const entries: ReferenceClassificationReviewArtifact["entries"] = cues.map(
    (cue, index) => {
      const original = initialCues[index] ?? cue;
      const expectedSpeech = ["dialogue", "narration"].includes(cue.kind);
      const expectedSinging = cue.kind === "lyrics-original";
      return {
        cueId: cue.id,
        originalKind: original.kind,
        refinedKind: cue.kind,
        originalConfidence: original.classificationConfidence,
        refinedConfidence: cue.classificationConfidence,
        expectedSpeech:
          expectedSpeech && cue.classificationConfidence >= reviewThreshold,
        expectedSinging:
          expectedSinging && cue.classificationConfidence >= reviewThreshold,
        reviewRequired: cue.classificationConfidence < reviewThreshold,
        evidence: cue.evidence,
      };
    },
  );
  const wasDialogue = (entry: (typeof entries)[number]): boolean =>
    entry.originalKind === "dialogue";
  const review = referenceClassificationReviewArtifactSchema.parse({
    schemaVersion: "1.0.0",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    referenceSha256: input.parsed.sha256,
    configuration: {
      reviewThreshold,
      lowConfidenceExpectedSpeechDisabled: true,
    },
    entries,
    summary: {
      rawCueCount: entries.length,
      reclassifiedCueCount: entries.filter(
        (entry) => entry.originalKind !== entry.refinedKind,
      ).length,
      dialogueToCreditCount: entries.filter(
        (entry) => wasDialogue(entry) && entry.refinedKind === "credit",
      ).length,
      dialogueToCharacterIntroductionCount: entries.filter(
        (entry) =>
          wasDialogue(entry) && entry.refinedKind === "character-introduction",
      ).length,
      dialogueToOnScreenTextCount: entries.filter(
        (entry) => wasDialogue(entry) && entry.refinedKind === "on-screen-text",
      ).length,
      dialogueToUnknownCount: entries.filter(
        (entry) => wasDialogue(entry) && entry.refinedKind === "unknown",
      ).length,
      originalRecallDenominatorCueCount: entries.filter((entry) =>
        ["dialogue", "narration"].includes(entry.originalKind),
      ).length,
      refinedRecallDenominatorCueCount: entries.filter(
        (entry) => entry.expectedSpeech,
      ).length,
      reviewRequiredCount: entries.filter((entry) => entry.reviewRequired)
        .length,
    },
    fallback: null,
  });
  return { classification, review };
}

export function classifyReferenceCues(
  input: Parameters<typeof classifyReferenceCuesWithReview>[0],
): ReferenceCueClassificationArtifact {
  return classifyReferenceCuesWithReview(input).classification;
}
