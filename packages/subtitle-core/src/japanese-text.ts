import {
  japaneseBoundaryAnalysisSchema,
  japaneseTextAnalysisSchema,
  type JapaneseBoundaryAnalysis,
  type JapaneseTextAnalysis,
  type JapaneseTextAnalyzerMode,
} from "@mvl/shared";

export interface JapaneseTextAnalyzer {
  readonly mode: JapaneseTextAnalyzerMode;
  readonly implementation: string;
  analyze(text: string): JapaneseTextAnalysis;
  analyzeBoundary(left: string, right: string): JapaneseBoundaryAnalysis;
}

const JAPANESE_CHARACTER =
  /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
const HIRAGANA_ONLY = /^[\p{Script=Hiragana}ー]+$/u;
const TERMINAL_MARK = /[.!?。．！？…」』）】]$/u;
const TERMINAL_EXPRESSION =
  /(?:です|ます|でした|ました|ません|ない|たい|だった|やった|ねん|やね|かな|かも|よね|だね|やで|やろ|から|けど|ね|よ|か|や|で|わ|ぞ|ぜ|な)$/u;
const CONTINUATION_PREFIX =
  /^(?:っ|て|で|た|だ|ない|なかった|ます|ました|ません|たい|る|れる|られる|せて|させて|せる|させる|もらう|くれる|いる|ある|こと|もの|よう|ところ|ん|の|か|が|を|に|へ|と|で|は|も|や|から|まで|より)/u;
const PARTICLE_END = /(?:は|が|を|に|へ|と|で|の|も|や|から|まで|より|って)$/u;
const AUXILIARY_START =
  /^(?:て|で|た|だ|ない|なかった|ます|ました|ません|たい|る|れる|られる|せる|させる|いる|ある|もらう|くれる)/u;
const INTERJECTIONS = new Set([
  "あ",
  "ああ",
  "え",
  "ええ",
  "お",
  "おお",
  "おう",
  "うん",
  "ううん",
  "はい",
  "へえ",
  "ほう",
  "まあ",
  "ん",
]);

function normalizeJapaneseText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\{\\[^}]+\}/gu, "")
    .replace(/<[^>]+>/gu, "")
    .replace(/^♪\s*|\s*♪$/gu, "")
    .replace(/\s+/gu, "")
    .trim();
}

function segmentJapanese(text: string): JapaneseTextAnalysis["segments"] {
  const segmenter = new Intl.Segmenter("ja", { granularity: "word" });
  return Array.from(segmenter.segment(text), (segment) => ({
    text: segment.segment,
    start: segment.index,
    end: segment.index + segment.segment.length,
    wordLike: segment.isWordLike ?? JAPANESE_CHARACTER.test(segment.segment),
  })).filter((segment) => segment.text.trim() !== "");
}

function interjectionLikelihood(text: string): number {
  if (INTERJECTIONS.has(text)) return 0.95;
  if (/^[あえおうんへほまあ]+[!?！？…]?$/u.test(text)) return 0.75;
  return 0.05;
}

function likelyIncompleteClause(text: string): boolean {
  if (
    text === "" ||
    TERMINAL_MARK.test(text) ||
    TERMINAL_EXPRESSION.test(text)
  ) {
    return false;
  }
  if (PARTICLE_END.test(text)) return true;
  return /(?:し|て|で|けれど|けど|から|ので|のに|なら|たら|れば)$/u.test(text);
}

function sentenceEndingConfidence(text: string): number {
  if (TERMINAL_MARK.test(text)) return 0.98;
  if (TERMINAL_EXPRESSION.test(text)) return 0.85;
  if (PARTICLE_END.test(text)) return 0.15;
  if (/[ぁぃぅぇぉゃゅょっ]$/u.test(text)) return 0.05;
  return text.length <= 1 ? 0.25 : 0.55;
}

function analyze(text: string): JapaneseTextAnalysis {
  const normalizedText = normalizeJapaneseText(text);
  const segments = segmentJapanese(normalizedText);
  const wordSegments = segments.filter((segment) => segment.wordLike);
  const first = wordSegments[0]?.text ?? normalizedText;
  const last = wordSegments.at(-1)?.text ?? normalizedText;
  const startsMidWord =
    normalizedText !== "" &&
    !INTERJECTIONS.has(normalizedText) &&
    (CONTINUATION_PREFIX.test(normalizedText) ||
      /^[ぁぃぅぇぉゃゅょっ]/u.test(normalizedText));
  const endsMidWord =
    normalizedText !== "" &&
    (/[ぁぃぅぇぉゃゅょっ]$/u.test(normalizedText) ||
      (HIRAGANA_ONLY.test(last) &&
        last.length <= 2 &&
        !INTERJECTIONS.has(last) &&
        !TERMINAL_MARK.test(normalizedText) &&
        !TERMINAL_EXPRESSION.test(normalizedText)));
  const evidence = [
    `intl-word-segments:${String(wordSegments.length)}`,
    `first-segment:${first || "none"}`,
    `last-segment:${last || "none"}`,
  ];
  if (startsMidWord) evidence.push("continuation-prefix-at-cue-start");
  if (endsMidWord) evidence.push("short-hiragana-at-cue-end");
  if (likelyIncompleteClause(normalizedText)) {
    evidence.push("non-terminal-clause-ending");
  }
  return japaneseTextAnalysisSchema.parse({
    normalizedText,
    lexicalCharacterCount: Array.from(normalizedText).filter((character) =>
      JAPANESE_CHARACTER.test(character),
    ).length,
    segments,
    singleCharacter: Array.from(normalizedText).length === 1,
    standaloneInterjectionLikelihood: interjectionLikelihood(normalizedText),
    startsMidWord,
    endsMidWord,
    likelyIncompleteClause: likelyIncompleteClause(normalizedText),
    sentenceEndingConfidence: sentenceEndingConfidence(normalizedText),
    evidence,
  });
}

function crossingWordEvidence(
  left: string,
  right: string,
): { crossing: boolean; token: string | null } {
  const combined = `${left}${right}`;
  const boundary = left.length;
  const token = segmentJapanese(combined).find(
    (segment) =>
      segment.wordLike && segment.start < boundary && segment.end > boundary,
  );
  return { crossing: token !== undefined, token: token?.text ?? null };
}

function analyzeBoundary(
  leftText: string,
  rightText: string,
): JapaneseBoundaryAnalysis {
  const left = normalizeJapaneseText(leftText);
  const right = normalizeJapaneseText(rightText);
  const crossing = crossingWordEvidence(left, right);
  const suffixContinuation =
    left !== "" &&
    right !== "" &&
    (CONTINUATION_PREFIX.test(right) ||
      (HIRAGANA_ONLY.test(left.slice(-2)) && AUXILIARY_START.test(right)));
  const likelyContinuation =
    crossing.crossing ||
    suffixContinuation ||
    (PARTICLE_END.test(left) && !TERMINAL_MARK.test(left));
  const evidence = [
    crossing.crossing
      ? `intl-token-crosses-boundary:${crossing.token ?? "unknown"}`
      : "intl-token-boundary-stable",
  ];
  if (suffixContinuation) evidence.push("hiragana-auxiliary-continuation");
  if (PARTICLE_END.test(left)) evidence.push("left-ends-with-particle");
  return japaneseBoundaryAnalysisSchema.parse({
    boundarySplitsWord: crossing.crossing || suffixContinuation,
    concatenatedTextFormsStableTokenization: crossing.crossing,
    likelyContinuation,
    confidence: crossing.crossing
      ? 0.95
      : suffixContinuation
        ? 0.82
        : likelyContinuation
          ? 0.65
          : 0.3,
    evidence,
  });
}

export function createJapaneseTextAnalyzer(
  mode: JapaneseTextAnalyzerMode = "auto",
): JapaneseTextAnalyzer {
  if (mode === "external") {
    throw new Error(
      "The external Japanese analyzer is not configured; use auto or intl-segmenter.",
    );
  }
  return {
    mode,
    implementation: "Intl.Segmenter(ja)+rule-fallback",
    analyze,
    analyzeBoundary,
  };
}

export function analyzeJapaneseText(
  text: string,
  mode: JapaneseTextAnalyzerMode = "auto",
): JapaneseTextAnalysis {
  return createJapaneseTextAnalyzer(mode).analyze(text);
}

export function analyzeJapaneseBoundary(
  left: string,
  right: string,
  mode: JapaneseTextAnalyzerMode = "auto",
): JapaneseBoundaryAnalysis {
  return createJapaneseTextAnalyzer(mode).analyzeBoundary(left, right);
}
