import { InputError, detectTextLanguage, type SubtitleCue } from "@mvl/shared";

import { cleanSubtitleText } from "./clean.js";
import type {
  NormalizationChange,
  NormalizedSubtitle,
  ParsedCue,
} from "./types.js";

export function normalizeSubtitleCues(
  parsed: readonly ParsedCue[],
): NormalizedSubtitle {
  const changes: NormalizationChange[] = [];
  const warnings: string[] = [];
  const sorted = parsed
    .map((cue, originalIndex) => ({ ...cue, originalIndex }))
    .sort((a, b) => {
      if (a.start !== b.start) return a.start - b.start;
      return a.end - b.end;
    });

  const cues: SubtitleCue[] = sorted.map((cue, index) => {
    const id = `cue-${String(index + 1).padStart(4, "0")}`;
    if (cue.originalIndex !== index) {
      changes.push({
        cueId: id,
        kind: "reorder",
        before: cue.originalIndex,
        after: index,
      });
    }
    if (cue.end <= cue.start) {
      throw new InputError(
        `Cue at source line ${cue.sourceLine} has a non-positive duration.`,
        {
          line: cue.sourceLine,
          start: cue.start,
          end: cue.end,
        },
      );
    }
    const cleaned = cleanSubtitleText(cue.text);
    if (cleaned === "") {
      throw new InputError(
        `Cue at source line ${cue.sourceLine} is empty after cleanup.`,
        {
          line: cue.sourceLine,
        },
      );
    }
    if (cleaned !== cue.text) {
      changes.push({
        cueId: id,
        kind: "clean-text",
        before: cue.text,
        after: cleaned,
      });
    }
    const detected = detectTextLanguage(cleaned);
    return {
      id,
      start: cue.start,
      end: cue.end,
      language: detected.language,
      languages: detected.languages,
      text: cleaned,
      speaker: cue.speaker,
      confidence: null,
    };
  });

  for (let index = 1; index < cues.length; index += 1) {
    const previous = cues[index - 1];
    const current = cues[index];
    if (
      previous === undefined ||
      current === undefined ||
      previous.end <= current.start
    )
      continue;
    if (current.start - previous.start >= 0.1) {
      const before = previous.end;
      previous.end = current.start;
      changes.push({
        cueId: previous.id,
        kind: "adjust-overlap",
        before,
        after: previous.end,
      });
      continue;
    }
    warnings.push(
      `${previous.id} and ${current.id} overlap and could not be adjusted without creating a near-zero cue.`,
    );
  }

  return { cues, changes, warnings };
}
