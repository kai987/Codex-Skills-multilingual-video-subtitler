const ALLOWED_HTML_TAG = /<\/?(?:b|i|u|font|span|ruby|rt|c)(?:\s[^>]*)?>/giu;
const ASS_OVERRIDE = /\{\\[^}]*\}/gu;

const ENTITIES: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&gt;": ">",
  "&lt;": "<",
  "&nbsp;": " ",
  "&quot;": '"',
  "&#39;": "'",
};

export function cleanSubtitleText(value: string): string {
  let output = Array.from(value)
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return (
        code === 9 || code === 10 || code === 13 || (code > 31 && code !== 127)
      );
    })
    .join("")
    .replace(ASS_OVERRIDE, "")
    .replace(/\\[Nn]/gu, "\n")
    .replace(/\\h/gu, " ")
    .replace(ALLOWED_HTML_TAG, "");
  for (const [entity, replacement] of Object.entries(ENTITIES)) {
    output = output.replaceAll(entity, replacement);
  }
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line, index, lines) =>
        line !== "" || (index > 0 && index < lines.length - 1),
    )
    .join("\n")
    .trim();
}

export function extractSpeaker(text: string): {
  speaker: string | null;
  text: string;
} {
  const match =
    /^(?:[-–—]\s*)?([\p{L}\p{N}][\p{L}\p{N} ._'’-]{0,40}):\s+(.+)$/su.exec(
      text,
    );
  if (match?.[1] === undefined || match[2] === undefined) {
    return { speaker: null, text };
  }
  return { speaker: match[1].trim(), text: match[2].trim() };
}
