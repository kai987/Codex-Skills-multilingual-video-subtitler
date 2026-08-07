import type { LanguageTag, MediaIdentity } from "@mvl/shared";
import type { SubtitleFormat } from "@mvl/subtitle-core";

export type SubtitleKind =
  | "original"
  | "hearing-impaired"
  | "translation"
  | "machine-translation"
  | "unknown";

export interface SubtitleSearchQuery {
  identity: MediaIdentity;
  primaryLanguages: readonly LanguageTag[];
  referenceLanguages: readonly LanguageTag[];
}

export interface SubtitleSearchCandidate {
  id: string;
  title: string;
  originalTitle?: string;
  season?: number;
  episode?: number;
  year?: number;
  runtimeSeconds?: number;
  releaseSource?: string;
  releaseGroup?: string;
  language: LanguageTag;
  kind: SubtitleKind;
  format: SubtitleFormat;
  content: string;
  sourcePage?: string;
  license?: string;
  sampledDialogueSimilarity?: number;
}

export interface SubtitleSearchAdapter {
  readonly id: string;
  readonly displayName: string;
  search(
    query: SubtitleSearchQuery,
  ): Promise<readonly SubtitleSearchCandidate[]>;
}

export interface SubtitleScoreBreakdown {
  title: number;
  seasonEpisode: number;
  year: number;
  runtime: number;
  release: number;
  boundaries: number;
  sampledDialogue: number;
  integrity: number;
}

export type SubtitleClassification =
  "primary" | "needs-review" | "reference" | "rejected";

export interface ScoredSubtitleCandidate {
  candidate: SubtitleSearchCandidate;
  source: { id: string; displayName: string };
  score: number;
  scoreBreakdown: SubtitleScoreBreakdown;
  classification: SubtitleClassification;
  integrity: { valid: boolean; cueCount: number; error: string | null };
}

export interface SubtitleScoreThresholds {
  primary: number;
  needsReview: number;
  reference: number;
}

export interface SubtitleSearchRun {
  performed: boolean;
  skippedReason: string | null;
  candidates: ScoredSubtitleCandidate[];
  sourceErrors: { sourceId: string; message: string }[];
}
