import path from "node:path";

const MAX_ARTIFACT_STEM_BYTES = 240;

function truncateUtf8(value: string, maximumBytes: number): string {
  let output = "";
  for (const character of value) {
    if (Buffer.byteLength(output + character, "utf8") > maximumBytes) break;
    output += character;
  }
  return output;
}

/**
 * Keeps the source filename recognizable while removing characters that are
 * invalid on common filesystems. The byte cap leaves room for extensions.
 */
export function subtitleArtifactStem(inputVideo: string): string {
  const sourceName = path.basename(inputVideo, path.extname(inputVideo));
  const printableName = Array.from(sourceName)
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 31 || code === 127 ? "-" : character;
    })
    .join("");
  const portableName = printableName
    .replace(/[<>:"/\\|?*]/gu, "-")
    .replace(/-+/gu, "-")
    .trim()
    .replace(/[. ]+$/gu, "");
  return truncateUtf8(
    `subtitle-${portableName || "video"}`,
    MAX_ARTIFACT_STEM_BYTES,
  );
}

export function subtitleArtifactDirectory(
  taskDirectory: string,
  inputVideo: string,
): string {
  return path.join(taskDirectory, subtitleArtifactStem(inputVideo));
}
