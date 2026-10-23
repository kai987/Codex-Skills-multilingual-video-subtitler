import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  InputError,
  detectTextLanguage,
  readJson,
  subtitlePackageSchema,
  type SubtitleCue,
} from "@mvl/shared";
import {
  normalizeSubtitleCues,
  parseSubtitle,
  type SubtitleFormat,
} from "@mvl/subtitle-core";

import type { ReconstructedSentence } from "./types.js";

export interface LoadedGrammarInput {
  sourceType: "subtitle" | "text" | "subtitle-package";
  title: string | null;
  fileName: string | null;
  cues: SubtitleCue[];
  text: string;
}

const TERMINAL_PUNCTUATION = /(?:[。！？!?…]+|[.!?]+["'”’』」）)]*)$/u;

function joinCueText(parts: readonly string[]): string {
  return parts.reduce((result, part) => {
    if (result === "") return part.trim();
    const next = part.trim();
    const needsSpace =
      /[\p{Script=Latin}\p{N}]$/u.test(result) &&
      /^[\p{Script=Latin}\p{N}]/u.test(next);
    return `${result}${needsSpace ? " " : ""}${next}`;
  }, "");
}

function finalizeLinks(
  sentences: ReconstructedSentence[],
): ReconstructedSentence[] {
  return sentences.map((sentence, index) => ({
    ...sentence,
    previousSentenceId: sentences[index - 1]?.id ?? null,
    nextSentenceId: sentences[index + 1]?.id ?? null,
  }));
}

export function reconstructSubtitleSentences(
  cues: readonly SubtitleCue[],
  pauseThresholdSeconds = 1.2,
): ReconstructedSentence[] {
  const groups: {
    cues: SubtitleCue[];
    confidence: number;
    needsReview: boolean;
  }[] = [];
  let current: SubtitleCue[] = [];
  const flush = (confidence: number, needsReview = false): void => {
    if (current.length === 0) return;
    groups.push({ cues: current, confidence, needsReview });
    current = [];
  };
  for (const cue of cues) {
    const previous = current.at(-1);
    if (
      previous !== undefined &&
      ((previous.speaker !== null &&
        cue.speaker !== null &&
        previous.speaker !== cue.speaker) ||
        cue.start - previous.end >= pauseThresholdSeconds)
    ) {
      flush(0.82);
    }
    current.push(cue);
    const combined = joinCueText(current.map((item) => item.text));
    if (TERMINAL_PUNCTUATION.test(combined)) flush(0.97);
    else if (combined.length >= 180) flush(0.65, true);
  }
  flush(0.72, true);
  return finalizeLinks(
    groups.map((group, index) => {
      const text = joinCueText(group.cues.map((cue) => cue.text));
      const detected = detectTextLanguage(text);
      return {
        id: `sentence-${String(index + 1).padStart(4, "0")}`,
        cueIds: group.cues.map((cue) => cue.id),
        start: group.cues[0]?.start ?? null,
        end: group.cues.at(-1)?.end ?? null,
        language: detected.language,
        languages: detected.languages,
        text,
        previousSentenceId: null,
        nextSentenceId: null,
        reconstructionConfidence: group.confidence,
        needsReview: group.needsReview,
      };
    }),
  );
}

export function reconstructTextSentences(
  text: string,
): ReconstructedSentence[] {
  const normalized = text
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .trim();
  if (normalized === "") throw new InputError("Text input is empty.");
  const pieces = normalized
    .split(/(?<=[。！？!?…])\s*|(?<=[.!?])\s+|\n+/u)
    .map((value) => value.trim())
    .filter(Boolean);
  return finalizeLinks(
    pieces.map((sentence, index) => {
      const detected = detectTextLanguage(sentence);
      return {
        id: `sentence-${String(index + 1).padStart(4, "0")}`,
        cueIds: [],
        start: null,
        end: null,
        language: detected.language,
        languages: detected.languages,
        text: sentence,
        previousSentenceId: null,
        nextSentenceId: null,
        reconstructionConfidence: 1,
        needsReview: false,
      };
    }),
  );
}

function subtitleFormat(extension: string): SubtitleFormat | null {
  if ([".srt", ".vtt", ".ass", ".ssa"].includes(extension)) {
    return extension.slice(1) as SubtitleFormat;
  }
  return null;
}

export async function loadGrammarInput(input: {
  inputPath?: string;
  text?: string;
}): Promise<LoadedGrammarInput> {
  if ((input.inputPath === undefined) === (input.text === undefined)) {
    throw new InputError("Provide exactly one of inputPath or text.");
  }
  if (input.text !== undefined) {
    return {
      sourceType: "text",
      title: null,
      fileName: null,
      cues: [],
      text: input.text,
    };
  }
  const inputPath = path.resolve(input.inputPath ?? "");
  const extension = path.extname(inputPath).toLowerCase();
  if (extension === ".json") {
    const value = subtitlePackageSchema.safeParse(await readJson(inputPath));
    if (!value.success) {
      throw new InputError(
        "JSON grammar input must be a valid subtitle-package.json; arbitrary objects are rejected.",
        { issues: value.error.issues },
      );
    }
    return {
      sourceType: "subtitle-package",
      title: value.data.identity.title,
      fileName: path.basename(inputPath),
      cues: value.data.cues,
      text: value.data.cues.map((cue) => cue.text).join("\n"),
    };
  }
  if (extension === ".txt") {
    const text = await readFile(inputPath, "utf8");
    return {
      sourceType: "text",
      title: null,
      fileName: path.basename(inputPath),
      cues: [],
      text,
    };
  }
  const format = subtitleFormat(extension);
  if (format === null) {
    throw new InputError("Unsupported grammar input format.", {
      extension,
      supported: [".srt", ".vtt", ".ass", ".ssa", ".txt", ".json"],
    });
  }
  const content = await readFile(inputPath, "utf8");
  const normalized = normalizeSubtitleCues(parseSubtitle(content, format));
  return {
    sourceType: "subtitle",
    title: null,
    fileName: path.basename(inputPath),
    cues: normalized.cues,
    text: normalized.cues.map((cue) => cue.text).join("\n"),
  };
}
