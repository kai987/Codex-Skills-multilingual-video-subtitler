import path from "node:path";

import type { LanguageTag, MediaIdentity } from "@mvl/shared";
import type { SubtitleFormat } from "@mvl/subtitle-core";
import { unzipSync } from "fflate";
import { createExtractorFromData } from "node-unrar-js";

const MAX_SUBTITLE_BYTES = 5 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 100;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 20 * 1024 * 1024;
const SUBTITLE_EXTENSIONS = new Set([".srt", ".vtt", ".ass", ".ssa"]);

interface SubtitleEntry {
  name: string;
  bytes: Uint8Array;
}

export interface ExtractedSubtitle {
  fileName: string;
  format: SubtitleFormat;
  content: string;
}

function subtitleFormat(fileName: string): SubtitleFormat | null {
  const extension = path.extname(fileName).toLowerCase();
  if (!SUBTITLE_EXTENSIONS.has(extension)) return null;
  return extension.slice(1) as SubtitleFormat;
}

function languageScore(
  fileName: string,
  languages: readonly LanguageTag[],
): number {
  const normalized = fileName.normalize("NFKC").toLowerCase();
  const tokens: Partial<Record<LanguageTag, readonly string[]>> = {
    ja: ["jpn", "japanese", "日本語", "日文", ".ja.", "_ja_"],
    en: ["eng", "english", "英文", ".en.", "_en_"],
    zh: ["chi", "zho", "chinese", "中文"],
    "zh-Hans": ["chs", "sc", "简体", "簡體", "简中"],
    "zh-Hant": ["cht", "tc", "繁体", "繁體", "繁中"],
  };
  for (const [index, language] of languages.entries()) {
    if ((tokens[language] ?? []).some((token) => normalized.includes(token))) {
      return 30 - index;
    }
  }
  return 0;
}

function episodeScore(fileName: string, identity: MediaIdentity): number {
  if (identity.episode === null) return 0;
  const normalized = fileName.normalize("NFKC").toLowerCase();
  const episode = String(identity.episode);
  const paddedEpisode = episode.padStart(2, "0");
  if (identity.season !== null) {
    const season = String(identity.season).padStart(2, "0");
    if (
      new RegExp(`s0*${season}e0*${episode}(?:\\D|$)`, "iu").test(normalized)
    ) {
      return 100;
    }
  }
  if (
    new RegExp(`第\\s*0*${episode}\\s*[話话集]`, "iu").test(normalized) ||
    new RegExp(`(?:^|[\\s._\\-[（(])e?${paddedEpisode}(?:\\D|$)`, "iu").test(
      normalized,
    )
  ) {
    return 60;
  }
  return 0;
}

function entryScore(
  name: string,
  identity: MediaIdentity,
  languages: readonly LanguageTag[],
): number {
  const format = subtitleFormat(name);
  if (format === null) return -1;
  const formatScore = format === "srt" ? 4 : format === "vtt" ? 3 : 2;
  return (
    episodeScore(name, identity) + languageScore(name, languages) + formatScore
  );
}

function chooseEntry(
  entries: readonly SubtitleEntry[],
  identity: MediaIdentity,
  languages: readonly LanguageTag[],
): SubtitleEntry | null {
  return (
    [...entries]
      .filter(
        (entry) =>
          entry.bytes.byteLength > 0 &&
          entry.bytes.byteLength <= MAX_SUBTITLE_BYTES &&
          subtitleFormat(entry.name) !== null,
      )
      .sort(
        (left, right) =>
          entryScore(right.name, identity, languages) -
            entryScore(left.name, identity, languages) ||
          left.name.localeCompare(right.name),
      )[0] ?? null
  );
}

function decodeSubtitle(bytes: Uint8Array): string {
  const encodings = ["utf-8", "shift_jis", "gb18030", "big5", "windows-1252"];
  for (const encoding of encodings) {
    try {
      return new TextDecoder(encoding, { fatal: true })
        .decode(bytes)
        .replace(/^\uFEFF/u, "");
    } catch {
      // Try the next common subtitle encoding.
    }
  }
  return new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/u, "");
}

function isZip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function isRar(bytes: Uint8Array): boolean {
  return (
    bytes[0] === 0x52 &&
    bytes[1] === 0x61 &&
    bytes[2] === 0x72 &&
    bytes[3] === 0x21
  );
}

function extractZip(bytes: Uint8Array): SubtitleEntry[] {
  let entryCount = 0;
  let totalBytes = 0;
  const extracted = unzipSync(bytes, {
    filter: (entry) => {
      if (entryCount >= MAX_ARCHIVE_ENTRIES) return false;
      entryCount += 1;
      if (
        subtitleFormat(entry.name) === null ||
        entry.originalSize <= 0 ||
        entry.originalSize > MAX_SUBTITLE_BYTES ||
        totalBytes + entry.originalSize > MAX_TOTAL_UNCOMPRESSED_BYTES
      ) {
        return false;
      }
      totalBytes += entry.originalSize;
      return true;
    },
  });
  return Object.entries(extracted).map(([name, data]) => ({
    name,
    bytes: data,
  }));
}

async function extractRar(
  bytes: Uint8Array,
  identity: MediaIdentity,
  languages: readonly LanguageTag[],
): Promise<SubtitleEntry[]> {
  const data = Uint8Array.from(bytes).buffer;
  const extractor = await createExtractorFromData({ data });
  const headers = [...extractor.getFileList().fileHeaders]
    .filter(
      (header) =>
        !header.flags.directory &&
        !header.flags.encrypted &&
        header.unpSize > 0 &&
        header.unpSize <= MAX_SUBTITLE_BYTES &&
        subtitleFormat(header.name) !== null,
    )
    .slice(0, MAX_ARCHIVE_ENTRIES)
    .sort(
      (left, right) =>
        entryScore(right.name, identity, languages) -
          entryScore(left.name, identity, languages) ||
        left.name.localeCompare(right.name),
    );
  const selected = headers[0];
  if (selected === undefined) return [];
  const extracted = extractor.extract({ files: [selected.name] });
  return [...extracted.files].flatMap((file) =>
    file.extraction === undefined
      ? []
      : [{ name: file.fileHeader.name, bytes: file.extraction }],
  );
}

export async function extractSubtitleDownload(input: {
  bytes: Uint8Array;
  fileName: string;
  identity: MediaIdentity;
  languages: readonly LanguageTag[];
}): Promise<ExtractedSubtitle | null> {
  let entries: SubtitleEntry[];
  if (isZip(input.bytes)) {
    entries = extractZip(input.bytes);
  } else if (isRar(input.bytes)) {
    entries = await extractRar(input.bytes, input.identity, input.languages);
  } else if (subtitleFormat(input.fileName) !== null) {
    entries = [{ name: input.fileName, bytes: input.bytes }];
  } else {
    return null;
  }
  const selected = chooseEntry(entries, input.identity, input.languages);
  if (selected === null) return null;
  const format = subtitleFormat(selected.name);
  if (format === null) return null;
  const content = decodeSubtitle(selected.bytes);
  return content.trim() === ""
    ? null
    : { fileName: selected.name, format, content };
}
