import { z } from "zod";

export const languageTagSchema = z.enum([
  "zh",
  "zh-Hans",
  "zh-Hant",
  "ja",
  "en",
  "mixed",
  "und",
]);

export type LanguageTag = z.infer<typeof languageTagSchema>;

const SIMPLIFIED_ONLY = /[这汉语龙门书车云后发里为国万与东丝]/u;
const TRADITIONAL_ONLY = /[這漢語龍門書車雲後發裡為國萬與東絲]/u;
const KANA = /[\u3040-\u30ff\u31f0-\u31ff]/u;
const HAN = /\p{Script=Han}/u;
const LATIN = /\p{Script=Latin}/u;

export function detectTextLanguage(text: string): {
  language: LanguageTag;
  languages: LanguageTag[];
} {
  const hasKana = KANA.test(text);
  const hasHan = HAN.test(text);
  const hasLatin = LATIN.test(text);

  const found: LanguageTag[] = [];
  if (hasKana) {
    found.push("ja");
  } else if (hasHan) {
    if (SIMPLIFIED_ONLY.test(text) && !TRADITIONAL_ONLY.test(text)) {
      found.push("zh-Hans");
    } else if (TRADITIONAL_ONLY.test(text) && !SIMPLIFIED_ONLY.test(text)) {
      found.push("zh-Hant");
    } else {
      found.push("zh");
    }
  }
  if (hasLatin) found.push("en");

  const unique = [...new Set(found)];
  if (unique.length === 0) return { language: "und", languages: ["und"] };
  if (unique.length === 1) {
    const language = unique[0] ?? "und";
    return { language, languages: [language] };
  }
  return { language: "mixed", languages: unique };
}

const LANGUAGE_ALIASES: Readonly<Record<string, LanguageTag>> = {
  chi: "zh",
  cmn: "zh",
  en: "en",
  eng: "en",
  ja: "ja",
  jpn: "ja",
  und: "und",
  zh: "zh",
  zho: "zh",
  "zh-cn": "zh-Hans",
  "zh-hans": "zh-Hans",
  "zh-hant": "zh-Hant",
  "zh-tw": "zh-Hant",
};

export function normalizeLanguageTag(value: string | undefined): LanguageTag {
  if (value === undefined || value.trim() === "") return "und";
  return LANGUAGE_ALIASES[value.trim().toLowerCase()] ?? "und";
}
