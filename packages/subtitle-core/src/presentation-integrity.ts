import { createHash } from "node:crypto";

import {
  presentationConstraintIntegrityArtifactSchema,
  type PresentationConstraintIntegrityArtifact,
  type SubtitleCue,
} from "@mvl/shared";

import {
  DEFAULT_ASS_STYLE_CONFIGURATION,
  formatAss,
  type AssStyleConfiguration,
} from "./format.js";
import { evaluateLineLayoutIntegrity } from "./layout.js";

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function assStyle(
  ass: string,
  name: "Default" | "Thought" | "Music",
): string[] | null {
  const line = ass
    .split(/\r?\n/u)
    .find((candidate) => candidate.startsWith(`Style: ${name},`));
  return line === undefined ? null : line.slice("Style: ".length).split(",");
}

export function evaluatePresentationConstraintIntegrity(input: {
  cues: readonly SubtitleCue[];
  maximumLines?: number;
  maximumCharactersPerLine?: number;
  ass?: string;
  assStyleConfiguration?: Partial<AssStyleConfiguration>;
}): PresentationConstraintIntegrityArtifact {
  const maximumLines = input.maximumLines ?? 2;
  const maximumCharactersPerLine = input.maximumCharactersPerLine ?? 16;
  const lineIntegrity = evaluateLineLayoutIntegrity(input.cues, {
    maximumLines,
    maximumCharactersPerLine,
  });
  const ass = input.ass ?? formatAss(input.cues, input.assStyleConfiguration);
  const expected = {
    ...DEFAULT_ASS_STYLE_CONFIGURATION,
    ...input.assStyleConfiguration,
  };
  const defaultStyle = assStyle(ass, "Default");
  const thoughtStyle = assStyle(ass, "Thought");
  const musicStyle = assStyle(ass, "Music");
  const findings: PresentationConstraintIntegrityArtifact["findings"] = [];
  for (const finding of lineIntegrity.findings) {
    if (finding.code === "FINAL_VISUAL_LINE_WORD_BREAK") continue;
    findings.push({
      id: `presentation-constraint-${String(findings.length + 1).padStart(5, "0")}`,
      code: finding.code,
      cueId: finding.cueId,
      reasons: finding.reasons,
    });
  }
  const fontSizeViolations = [defaultStyle, thoughtStyle, musicStyle].filter(
    (style) => Number(style?.[2]) !== expected.fontSize,
  ).length;
  for (let index = 0; index < fontSizeViolations; index += 1) {
    findings.push({
      id: `presentation-constraint-${String(findings.length + 1).padStart(5, "0")}`,
      code: "FINAL_ASS_FONT_SIZE_VIOLATION",
      cueId: null,
      reasons: [`expected-font-size:${String(expected.fontSize)}`],
    });
  }
  const musicPositionViolationCount =
    Number(musicStyle?.[18]) === expected.musicAlignment ? 0 : 1;
  if (musicPositionViolationCount > 0) {
    findings.push({
      id: `presentation-constraint-${String(findings.length + 1).padStart(5, "0")}`,
      code: "FINAL_MUSIC_POSITION_VIOLATION",
      cueId: null,
      reasons: [`expected-music-alignment:${String(expected.musicAlignment)}`],
    });
  }
  const musicItalicViolationCount =
    Number(musicStyle?.[8]) === (expected.musicItalic ? -1 : 0) ? 0 : 1;
  if (musicItalicViolationCount > 0) {
    findings.push({
      id: `presentation-constraint-${String(findings.length + 1).padStart(5, "0")}`,
      code: "FINAL_MUSIC_ITALIC_VIOLATION",
      cueId: null,
      reasons: [
        `expected-music-italic:${String(expected.musicItalic ? -1 : 0)}`,
      ],
    });
  }
  return presentationConstraintIntegrityArtifactSchema.parse({
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    inputHash: hash({ cues: input.cues, ass }),
    cueCount: input.cues.length,
    maximumLines,
    maximumCharactersPerLine,
    lineTooLongCount: lineIntegrity.lineTooLongCount,
    tooManyLinesCount: lineIntegrity.tooManyLinesCount,
    unresolvedCapacityCount: lineIntegrity.unresolvedCapacityCount,
    musicPositionViolationCount,
    musicItalicViolationCount,
    fontSizeViolationCount: fontSizeViolations,
    findings,
    validationStatus: findings.length === 0 ? "passed" : "needs-review",
  });
}
