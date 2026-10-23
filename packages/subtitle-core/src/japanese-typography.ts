const JAPANESE_LEXICAL_CHARACTER =
  /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}\u30fc\u3005]/u;
const JAPANESE_PUNCTUATION = /[!?\u3001\u3002\uff01\uff1f\u2026\u300c-\u3011]/u;
const LATIN_OR_NUMBER = /[\p{Script=Latin}\p{N}]/u;

function isJapaneseBoundaryCharacter(value: string): boolean {
  return (
    JAPANESE_LEXICAL_CHARACTER.test(value) || JAPANESE_PUNCTUATION.test(value)
  );
}

export function isJapaneseSubtitleText(value: string): boolean {
  const characters = Array.from(
    value
      .replace(/\{\\[^}]+\}/gu, "")
      .replace(/<[^>]+>/gu, "")
      .replace(/[\s♪♫]/gu, ""),
  );
  if (characters.length === 0) return false;
  const japaneseCharacters = characters.filter((character) =>
    JAPANESE_LEXICAL_CHARACTER.test(character),
  ).length;
  return japaneseCharacters / characters.length >= 0.35;
}

/**
 * Removes ASR token spacing from ordinary Japanese while retaining useful
 * boundaries around Latin names and numbers. This function only changes
 * typography; it never rewrites recognized words.
 */
export function normalizeJapaneseSubtitleWhitespace(value: string): string {
  const normalized = value
    .replace(/[０-９]/gu, (digit) =>
      String.fromCharCode(digit.charCodeAt(0) - 0xfee0),
    )
    .replace(/\.{2,}/gu, "…")
    .replace(/[\uff0c,]+/gu, "、")
    .replace(/[\uff0e.]+/gu, "。");
  return normalized
    .split(/\r?\n/gu)
    .map((line) => {
      const characters = Array.from(
        line.replace(/[\p{White_Space}]+/gu, " ").trim(),
      );
      const output: string[] = [];
      for (let index = 0; index < characters.length; index += 1) {
        const character = characters[index] ?? "";
        if (character !== " ") {
          output.push(character);
          continue;
        }
        const previous = output.at(-1) ?? "";
        let next = "";
        for (let cursor = index + 1; cursor < characters.length; cursor += 1) {
          const candidate = characters[cursor] ?? "";
          if (candidate !== " ") {
            next = candidate;
            break;
          }
        }
        if (previous === "" || next === "") continue;
        const japanesePair =
          isJapaneseBoundaryCharacter(previous) &&
          isJapaneseBoundaryCharacter(next);
        const punctuationBoundary =
          (JAPANESE_PUNCTUATION.test(previous) &&
            !LATIN_OR_NUMBER.test(next)) ||
          (JAPANESE_PUNCTUATION.test(next) && !LATIN_OR_NUMBER.test(previous));
        if (!japanesePair && !punctuationBoundary) output.push(" ");
      }
      return output.join("");
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

export function hasUnnaturalJapaneseInterwordSpacing(value: string): boolean {
  const text = value
    .replace(/\{\\[^}]+\}/gu, "")
    .replace(/<[^>]+>/gu, "")
    .replace(/^♪\s*|\s*♪$/gu, "");
  return Array.from(text).some((character, index, characters) => {
    if (!/[ \t\u3000]/u.test(character)) return false;
    const previous = characters[index - 1] ?? "";
    const next = characters[index + 1] ?? "";
    return (
      isJapaneseBoundaryCharacter(previous) && isJapaneseBoundaryCharacter(next)
    );
  });
}
