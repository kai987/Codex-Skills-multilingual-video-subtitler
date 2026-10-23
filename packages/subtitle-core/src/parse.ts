import { InputError } from "@mvl/shared";

import { cleanSubtitleText, extractSpeaker } from "./clean.js";
import { parseAssClock, parseClock } from "./time.js";
import type { ParsedCue, SubtitleFormat } from "./types.js";

function normalizeLines(content: string): string[] {
  return content
    .replace(/^\uFEFF/u, "")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n");
}

function parseArrowTimestamp(
  line: string,
  lineNumber: number,
): { start: number; end: number } {
  const [rawStart, rawEndWithSettings, ...extra] = line.split(/\s+-->\s+/u);
  if (
    rawStart === undefined ||
    rawEndWithSettings === undefined ||
    extra.length > 0
  ) {
    throw new InputError(
      `Invalid subtitle timing line ${lineNumber}: ${line}`,
      {
        line: lineNumber,
      },
    );
  }
  const rawEnd = rawEndWithSettings.trim().split(/\s+/u)[0];
  if (rawEnd === undefined) {
    throw new InputError(`Missing end timestamp at line ${lineNumber}.`, {
      line: lineNumber,
    });
  }
  return {
    start: parseClock(rawStart, lineNumber),
    end: parseClock(rawEnd, lineNumber),
  };
}

export function parseSrt(content: string): ParsedCue[] {
  const lines = normalizeLines(content);
  const cues: ParsedCue[] = [];
  let index = 0;
  while (index < lines.length) {
    while (index < lines.length && lines[index]?.trim() === "") index += 1;
    if (index >= lines.length) break;
    const blockStart = index;
    let sourceId: string | null = null;
    const first = lines[index]?.trim() ?? "";
    if (!first.includes("-->")) {
      sourceId = first;
      index += 1;
    }
    const timing = lines[index];
    if (!timing?.includes("-->")) {
      throw new InputError(`Expected SRT timing line at ${index + 1}.`, {
        line: index + 1,
        value: timing ?? null,
      });
    }
    const { start, end } = parseArrowTimestamp(timing, index + 1);
    index += 1;
    const textLines: string[] = [];
    while (index < lines.length && lines[index]?.trim() !== "") {
      textLines.push(lines[index] ?? "");
      index += 1;
    }
    const cleaned = cleanSubtitleText(textLines.join("\n"));
    if (cleaned === "") {
      throw new InputError(
        `Empty SRT cue beginning at line ${blockStart + 1}.`,
        {
          line: blockStart + 1,
        },
      );
    }
    const speaker = extractSpeaker(cleaned);
    cues.push({
      sourceId,
      start,
      end,
      text: cleaned,
      speaker: speaker.speaker,
      sourceLine: blockStart + 1,
    });
  }
  if (cues.length === 0) throw new InputError("Subtitle contains no cues.");
  return cues;
}

export function parseVtt(content: string): ParsedCue[] {
  const lines = normalizeLines(content);
  if (!(lines[0] ?? "").trim().startsWith("WEBVTT")) {
    throw new InputError("VTT input must begin with WEBVTT.", { line: 1 });
  }
  const cueLines: string[] = [];
  let index = 1;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (/^(?:NOTE|STYLE|REGION)(?:\s|$)/u.test(line.trim())) {
      index += 1;
      while (index < lines.length && lines[index]?.trim() !== "") index += 1;
      continue;
    }
    cueLines.push(line);
    index += 1;
  }
  return parseSrt(cueLines.join("\n"));
}

export function parseAss(content: string): ParsedCue[] {
  const lines = normalizeLines(content);
  let inEvents = false;
  let format: string[] = [];
  const cues: ParsedCue[] = [];
  for (const [offset, line] of lines.entries()) {
    const lineNumber = offset + 1;
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) {
      inEvents = trimmed.toLowerCase() === "[events]";
      continue;
    }
    if (!inEvents || trimmed === "" || trimmed.startsWith(";")) continue;
    if (/^Format:/iu.test(trimmed)) {
      format = trimmed
        .slice(trimmed.indexOf(":") + 1)
        .split(",")
        .map((field) => field.trim().toLowerCase());
      continue;
    }
    if (!/^Dialogue:/iu.test(trimmed)) continue;
    if (format.length === 0) {
      throw new InputError(
        `ASS Dialogue appears before Format at line ${lineNumber}.`,
        {
          line: lineNumber,
        },
      );
    }
    const payload = trimmed.slice(trimmed.indexOf(":") + 1).trimStart();
    const fields = payload.split(",");
    if (fields.length < format.length) {
      throw new InputError(`Malformed ASS Dialogue at line ${lineNumber}.`, {
        line: lineNumber,
      });
    }
    const values = [
      ...fields.slice(0, format.length - 1),
      fields.slice(format.length - 1).join(","),
    ];
    const startIndex = format.indexOf("start");
    const endIndex = format.indexOf("end");
    const textIndex = format.indexOf("text");
    const nameIndex = format.indexOf("name");
    if (startIndex < 0 || endIndex < 0 || textIndex < 0) {
      throw new InputError(
        "ASS Format must contain Start, End, and Text fields.",
        {
          line: lineNumber,
        },
      );
    }
    const rawStart = values[startIndex];
    const rawEnd = values[endIndex];
    const rawText = values[textIndex];
    if (
      rawStart === undefined ||
      rawEnd === undefined ||
      rawText === undefined
    ) {
      throw new InputError(`Missing ASS field at line ${lineNumber}.`, {
        line: lineNumber,
      });
    }
    const cleaned = cleanSubtitleText(rawText);
    if (cleaned === "") {
      throw new InputError(`Empty ASS cue at line ${lineNumber}.`, {
        line: lineNumber,
      });
    }
    const inlineSpeaker = extractSpeaker(cleaned);
    const name = nameIndex < 0 ? "" : (values[nameIndex]?.trim() ?? "");
    cues.push({
      sourceId: null,
      start: parseAssClock(rawStart, lineNumber),
      end: parseAssClock(rawEnd, lineNumber),
      text: cleaned,
      speaker: name || inlineSpeaker.speaker,
      sourceLine: lineNumber,
    });
  }
  if (cues.length === 0)
    throw new InputError("ASS/SSA subtitle contains no dialogue cues.");
  return cues;
}

export function parseSubtitle(
  content: string,
  format: SubtitleFormat,
): ParsedCue[] {
  switch (format) {
    case "srt":
      return parseSrt(content);
    case "vtt":
      return parseVtt(content);
    case "ass":
    case "ssa":
      return parseAss(content);
  }
}
