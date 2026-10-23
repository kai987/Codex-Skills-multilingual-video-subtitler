import type { MediaIdentity } from "@mvl/shared";
import { normalizeSubtitleCues, parseSubtitle } from "@mvl/subtitle-core";

import type {
  ScoredSubtitleCandidate,
  SubtitleClassification,
  SubtitleScoreBreakdown,
  SubtitleScoreThresholds,
  SubtitleSearchCandidate,
} from "./types.js";

export const DEFAULT_SCORE_THRESHOLDS: SubtitleScoreThresholds = {
  primary: 90,
  needsReview: 75,
  reference: 60,
};

function normalizedTitle(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

function titleScore(
  identity: MediaIdentity,
  candidate: SubtitleSearchCandidate,
): number {
  const expected = [
    identity.title,
    identity.originalTitle,
    ...identity.alternativeTitles,
  ]
    .filter((value): value is string => value !== null)
    .map(normalizedTitle)
    .filter(Boolean);
  const actual = [candidate.title, candidate.originalTitle]
    .filter((value): value is string => value !== undefined)
    .map(normalizedTitle);
  if (expected.length === 0) return 0;
  if (actual.some((value) => expected.includes(value))) return 20;
  if (
    actual.some((value) =>
      expected.some(
        (target) =>
          value.length >= 4 &&
          target.length >= 4 &&
          (value.includes(target) || target.includes(value)),
      ),
    )
  ) {
    return 10;
  }
  return 0;
}

function episodeScore(
  identity: MediaIdentity,
  candidate: SubtitleSearchCandidate,
): number {
  if (identity.season === null && identity.episode === null) {
    return candidate.season === undefined && candidate.episode === undefined
      ? 25
      : 10;
  }
  let score = 0;
  if (identity.season === null || candidate.season === identity.season)
    score += 10;
  if (identity.episode === null || candidate.episode === identity.episode)
    score += 15;
  return score;
}

function runtimeScore(
  expected: number | null,
  actual: number | undefined,
): number {
  if (expected === null || actual === undefined || expected === 0) return 0;
  const difference = Math.abs(expected - actual) / expected;
  if (difference <= 0.02) return 20;
  if (difference <= 0.05) return 15;
  if (difference <= 0.1) return 8;
  return 0;
}

function normalizedRelease(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return normalizedTitle(value);
}

function releaseScore(
  identity: MediaIdentity,
  candidate: SubtitleSearchCandidate,
): number {
  let score = 0;
  const source = normalizedRelease(identity.releaseSource);
  const group = normalizedRelease(identity.releaseGroup);
  if (source === null) score += 2.5;
  else if (source === normalizedRelease(candidate.releaseSource)) score += 5;
  if (group === null) score += 2.5;
  else if (group === normalizedRelease(candidate.releaseGroup)) score += 5;
  return score;
}

function parseCandidate(candidate: SubtitleSearchCandidate): {
  valid: boolean;
  cueCount: number;
  first: number | null;
  last: number | null;
  error: string | null;
} {
  try {
    const parsed = parseSubtitle(candidate.content, candidate.format);
    const normalized = normalizeSubtitleCues(parsed);
    return {
      valid: normalized.cues.length > 0,
      cueCount: normalized.cues.length,
      first: normalized.cues[0]?.start ?? null,
      last: normalized.cues.at(-1)?.end ?? null,
      error: null,
    };
  } catch (error) {
    return {
      valid: false,
      cueCount: 0,
      first: null,
      last: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function boundaryScore(
  identity: MediaIdentity,
  parsed: ReturnType<typeof parseCandidate>,
): number {
  if (!parsed.valid || parsed.first === null || parsed.last === null) return 0;
  const start = parsed.first <= 15 ? 2 : 0;
  if (identity.runtimeSeconds === null) return start + 1;
  const tolerance = Math.max(30, identity.runtimeSeconds * 0.02);
  const end =
    Math.abs(identity.runtimeSeconds - parsed.last) <= tolerance ? 3 : 0;
  return start + end;
}

export function scoreSubtitleCandidate(input: {
  identity: MediaIdentity;
  candidate: SubtitleSearchCandidate;
  source: { id: string; displayName: string };
  thresholds?: SubtitleScoreThresholds;
}): ScoredSubtitleCandidate {
  const parsed = parseCandidate(input.candidate);
  const breakdown: SubtitleScoreBreakdown = {
    title: titleScore(input.identity, input.candidate),
    seasonEpisode: episodeScore(input.identity, input.candidate),
    year:
      input.identity.year === null
        ? 5
        : input.candidate.year === input.identity.year
          ? 5
          : 0,
    runtime: runtimeScore(
      input.identity.runtimeSeconds,
      input.candidate.runtimeSeconds,
    ),
    release: releaseScore(input.identity, input.candidate),
    boundaries: boundaryScore(input.identity, parsed),
    sampledDialogue: Math.round(
      Math.max(0, Math.min(1, input.candidate.sampledDialogueSimilarity ?? 0)) *
        10,
    ),
    integrity: parsed.valid && parsed.cueCount >= 2 ? 5 : parsed.valid ? 2 : 0,
  };
  const score = Math.round(
    breakdown.title +
      breakdown.seasonEpisode +
      breakdown.year +
      breakdown.runtime +
      breakdown.release +
      breakdown.boundaries +
      breakdown.sampledDialogue +
      breakdown.integrity,
  );
  const thresholds = input.thresholds ?? DEFAULT_SCORE_THRESHOLDS;
  let classification: SubtitleClassification;
  const canBePrimary =
    input.candidate.kind === "original" &&
    input.identity.primarySubtitleLanguages.includes(input.candidate.language);
  if (score >= thresholds.primary && canBePrimary) classification = "primary";
  else if (score >= thresholds.needsReview && canBePrimary)
    classification = "needs-review";
  else if (score >= thresholds.reference) classification = "reference";
  else classification = "rejected";
  return {
    candidate: input.candidate,
    source: input.source,
    score,
    scoreBreakdown: breakdown,
    classification,
    integrity: {
      valid: parsed.valid,
      cueCount: parsed.cueCount,
      error: parsed.error,
    },
  };
}
