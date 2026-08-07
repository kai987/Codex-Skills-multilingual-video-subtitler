import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  referenceSubtitleAnalysisArtifactSchema,
  type LanguageTag,
  type ReferenceContentPolicy,
  type ReferenceSubtitleAnalysisArtifact,
  type ReferenceTimingMode,
} from "@mvl/shared";
import { parseAss, parseSrt, parseVtt } from "@mvl/subtitle-core";

export const REFERENCE_SUBTITLE_PARSER_VERSION = "1.0.0";

export interface ParsedReferenceSubtitleCue {
  sourceId: string | null;
  sourceIndex: number;
  start: number;
  end: number;
  text: string;
  sourceLine: number;
}

export interface ParsedReferenceSubtitle {
  format: "srt" | "vtt" | "ass";
  absolutePath: string;
  sha256: string;
  cues: ParsedReferenceSubtitleCue[];
}

function referenceFormat(filePath: string): ParsedReferenceSubtitle["format"] {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".srt") return "srt";
  if (extension === ".vtt") return "vtt";
  if (extension === ".ass" || extension === ".ssa") return "ass";
  throw new Error(
    `Unsupported reference subtitle extension: ${extension || "(none)"}`,
  );
}

export async function parseReferenceSubtitleFile(
  filePath: string,
): Promise<ParsedReferenceSubtitle> {
  const absolutePath = path.resolve(filePath);
  const bytes = await readFile(absolutePath);
  const content = bytes.toString("utf8");
  const format = referenceFormat(absolutePath);
  const parsed =
    format === "srt"
      ? parseSrt(content)
      : format === "vtt"
        ? parseVtt(content)
        : parseAss(content);
  return {
    format,
    absolutePath,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    cues: parsed.map((cue, sourceIndex) => ({
      sourceId: cue.sourceId,
      sourceIndex,
      start: cue.start,
      end: cue.end,
      text: cue.text,
      sourceLine: cue.sourceLine,
    })),
  };
}

export function analyzeReferenceSubtitle(input: {
  parsed: ParsedReferenceSubtitle;
  referenceLanguage: LanguageTag;
  mediaDurationSeconds: number;
  timingMode: ReferenceTimingMode;
  contentPolicy: ReferenceContentPolicy;
  classifiedCueCount: number;
  suspectTimingCueCount: number;
  duplicateEffectCueCount: number;
  multiTrackIntervalCount: number;
  generatedAt?: string;
}): ReferenceSubtitleAnalysisArtifact {
  const referenceEndSeconds = Math.max(
    0,
    ...input.parsed.cues.map((cue) => cue.end),
  );
  const outOfBoundsCueCount = input.parsed.cues.filter(
    (cue) =>
      cue.start < 0 ||
      cue.end <= cue.start ||
      cue.end > input.mediaDurationSeconds + 0.5,
  ).length;
  const abnormalShortCueCount = input.parsed.cues.filter(
    (cue) => cue.end - cue.start < 0.35,
  ).length;
  const overlappingCueCount = input.parsed.cues.filter((cue, index, cues) =>
    cues.some(
      (other, otherIndex) =>
        otherIndex !== index && cue.start < other.end && other.start < cue.end,
    ),
  ).length;
  const durationDeltaSeconds = referenceEndSeconds - input.mediaDurationSeconds;
  const structurallySuspect =
    outOfBoundsCueCount > 0 ||
    Math.abs(durationDeltaSeconds) >
      Math.max(5, input.mediaDurationSeconds * 0.02);
  const status = structurallySuspect
    ? ("suspect" as const)
    : input.timingMode === "trusted"
      ? ("trusted" as const)
      : ("verified" as const);
  const cacheKey = createHash("sha256")
    .update(
      JSON.stringify({
        referenceSha256: input.parsed.sha256,
        parserVersion: REFERENCE_SUBTITLE_PARSER_VERSION,
        classifierVersion: "1.0.0",
        timelineVersion: "1.0.0",
        contentPolicy: input.contentPolicy,
        timingMode: input.timingMode,
      }),
    )
    .digest("hex");
  return referenceSubtitleAnalysisArtifactSchema.parse({
    schemaVersion: "1.0.0",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    parserVersion: REFERENCE_SUBTITLE_PARSER_VERSION,
    classifierVersion: "1.0.0",
    timelineVersion: "1.0.0",
    cacheKey,
    cacheHit: false,
    input: {
      referencePath: input.parsed.absolutePath,
      referenceSha256: input.parsed.sha256,
      referenceLanguage: input.referenceLanguage,
      mediaDurationSeconds: input.mediaDurationSeconds,
    },
    format: input.parsed.format,
    configuration: {
      timingMode: input.timingMode,
      contentPolicy: input.contentPolicy,
    },
    summary: {
      rawCueCount: input.parsed.cues.length,
      classifiedCueCount: input.classifiedCueCount,
      suspectTimingCueCount: input.suspectTimingCueCount,
      overlappingCueCount,
    },
    timingValidation: {
      status,
      referenceEndSeconds,
      durationDeltaSeconds,
      outOfBoundsCueCount,
      abnormalShortCueCount,
      duplicateEffectCueCount: input.duplicateEffectCueCount,
      multiTrackIntervalCount: input.multiTrackIntervalCount,
      globalOffsetSeconds: null,
      driftSeconds: null,
      audioEvidenceMethod: "unavailable",
      evidence: [
        "reference-duration-compared-with-media-duration",
        "cue-bounds-validated",
        "short-cue-frequency-measured",
        "overlapping-content-tracks-detected",
        "global-offset-and-drift-require-audio-anchor-pairs",
      ],
    },
    fallback: null,
  });
}
