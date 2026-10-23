import type { ExplanationLanguage } from "./types.js";

export const GRAMMAR_PROMPT_VERSION = "3.1.0";

function explanationLanguageInstruction(
  explanationLanguage: ExplanationLanguage,
): string {
  if (explanationLanguage === "zh-CN") {
    return "所有面向读者的 meaning、explanation、formation、nuance、context、例句翻译和词汇释义都必须使用简体中文；原文片段和日语假名读音保持原语言文字。";
  }
  if (explanationLanguage === "ja-JP") {
    return "読者向けの meaning、explanation、formation、nuance、context、例文訳、語彙の意味は、すべて日本語で書いてください。原文表記と読みは元の言語の文字を保ってください。";
  }
  return "Write every reader-facing meaning, explanation, formation note, nuance, context note, example translation, and vocabulary meaning in English. Keep source-language surfaces and readings in their original scripts.";
}

export function hostCoreInstructions(
  explanationLanguage: ExplanationLanguage,
): string[] {
  return [
    "Analyze each supplied sentence as a Chinese, Japanese, English, or mixed-language learning expert.",
    "Preserve the supplied sentence IDs and analyze only grammar supported by the sentence and its adjacent context.",
    "Return only JSON conforming to host-analysis-schema.json; do not add prose outside the JSON.",
    "Use JLPT only for Japanese, HSK only for Chinese, CEFR only for English, and unknown when a mapping is uncertain.",
    "For mixed-language sentences, analyze each language span independently and label each grammar point with its language.",
    "Do not invent grammar points. Treat vocabulary as vocabulary rather than grammar.",
    "Provide exactly one natural, original example sentence for every grammar point. The example must demonstrate that grammar point, must not merely copy the analyzed source sentence, and its translation must use the requested explanation language. Keep the example reading null when it cannot be supplied reliably.",
    "Use lower confidence or null/unknown when evidence is insufficient instead of guessing.",
    "Set pure-Japanese sentence readings and Japanese vocabulary readings to null because SudachiPy supplies them deterministically during finalization.",
    explanationLanguageInstruction(explanationLanguage),
  ];
}

export function grammarSystemPrompt(
  explanationLanguage: ExplanationLanguage,
): string {
  return [
    ...hostCoreInstructions(explanationLanguage),
    "Analyze finite sentences, headlines, captions, and fragments.",
    "Check discourse connectors, particles, inflection, auxiliaries, voice, causative forms, conditionals, concession, modality, relative clauses, nominalization, ellipsis, omitted copulas, tense, aspect, clauses, infinitives, participles, gerunds, phrasal verbs, collocations, Chinese complements, serial verbs, pivotal constructions, and sentence-final particles when supported by the text.",
    "A grammar surface should normally contain functional morphology, a particle, an inflected form, a multi-token construction, a clause relationship, or an explicitly named ellipsis pattern.",
    "Keep nullable reading and translation fields null when uncertain.",
  ].join(" ");
}
