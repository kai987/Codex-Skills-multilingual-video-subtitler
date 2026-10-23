import type { SubtitleCue } from "@mvl/shared";

export type SubtitleFormat = "srt" | "vtt" | "ass" | "ssa";

export interface ParsedCue {
  sourceId: string | null;
  start: number;
  end: number;
  text: string;
  speaker: string | null;
  sourceLine: number;
}

export interface NormalizationChange {
  cueId: string;
  kind: "clean-text" | "reorder" | "adjust-overlap";
  before: string | number;
  after: string | number;
}

export interface NormalizedSubtitle {
  cues: SubtitleCue[];
  changes: NormalizationChange[];
  warnings: string[];
}
