import { createHash } from "node:crypto";

import {
  overlapAcousticComponentSchema,
  subtitleOverlapAcousticResolutionSchema,
  subtitlePresentationResolutionSchema,
  type OverlapAcousticAttempt,
  type OverlapAcousticComponent,
  type OverlapAcousticProfile,
  type OverlapAcousticResolutionMode,
  type OverlapCueAlignment,
  type OverlapDecision,
  type OverlapRelationship,
  type SubtitleCue,
  type SubtitleOverlapAcousticResolution,
  type SubtitlePresentationResolution,
} from "@mvl/shared";

import {
  builtinJapaneseReadingAnalyzer,
  type JapaneseReadingAnalyzer,
} from "./japanese-normalization.js";
import { legalOverlapPresentationOverrides } from "./overlap-classification.js";
import {
  presentationResolutionHash,
  type SubtitlePresentationResolutionResult,
} from "./presentation-resolution.js";

export interface OverlapAcousticScoringWeights {
  surfaceOrReading: number;
  tokenCoverage: number;
  temporalCoverage: number;
  profileConsensus: number;
  boundarySupport: number;
  neighborIntrusionPenalty: number;
}

export interface OverlapAcousticConfiguration {
  contextSeconds: number;
  maximumWindowSeconds: number;
  hardMaximumWindowSeconds: number;
  maximumAsrRequests: number;
  profiles: readonly OverlapAcousticProfile[];
  maximumTimingAdjustmentSeconds: number;
  minimumPostRepairCueDurationSeconds: number;
  maximumNeighborIntrusionRatio: number;
  minimumBoundaryConfidence: number;
  minimumAlignmentConfidence: number;
  minimumIndependentProfileSupport: number;
  minimumDecisionMargin: number;
  scoringWeights: OverlapAcousticScoringWeights;
}

export const DEFAULT_OVERLAP_ACOUSTIC_CONFIGURATION: Readonly<OverlapAcousticConfiguration> =
  {
    contextSeconds: 1.5,
    maximumWindowSeconds: 20,
    hardMaximumWindowSeconds: 30,
    maximumAsrRequests: 21,
    profiles: ["current-sensitive-vad", "no-vad", "extra-sensitive-vad"],
    maximumTimingAdjustmentSeconds: 0.5,
    minimumPostRepairCueDurationSeconds: 0.4,
    maximumNeighborIntrusionRatio: 0.15,
    minimumBoundaryConfidence: 0.72,
    minimumAlignmentConfidence: 0.72,
    minimumIndependentProfileSupport: 2,
    minimumDecisionMargin: 0.1,
    // These generic weights favor lexical/token evidence and require timing
    // and cross-profile support before a component can become non-blocking.
    scoringWeights: {
      surfaceOrReading: 0.3,
      tokenCoverage: 0.2,
      temporalCoverage: 0.15,
      profileConsensus: 0.15,
      boundarySupport: 0.2,
      neighborIntrusionPenalty: 0.2,
    },
  };

export interface OverlapAcousticComponentPlan {
  componentId: string;
  sourceOverlapDecisionId: string;
  cueIds: string[];
  unionInterval: { start: number; end: number };
  extractionInterval: { start: number; end: number };
  profiles: OverlapAcousticProfile[];
}

interface MatchCandidate {
  attemptId: string;
  profile: OverlapAcousticProfile;
  modelHash: string;
  source: "token" | "segment";
  sourceIds: string[];
  text: string;
  start: number;
  end: number;
  timingUsable: boolean;
  timingTrustScore: number;
  timestampTrustStatus: OverlapAcousticAttempt["tokens"][number]["tokenTimelineStatus"];
  evidenceSource:
    | "trusted-mapped-token"
    | "trusted-no-vad-token"
    | "decoded-segment"
    | "token"
    | "segment"
    | "speech"
    | "vad";
  parentSegmentContainmentPassed: boolean;
  evidenceLineageId: string;
  surfaceScore: number;
  readingScore: number | null;
  lexicalScore: number;
  temporalScore: number;
  score: number;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .toSorted()
      .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value: unknown): string {
  return createHash("sha256").update(stable(value)).digest("hex");
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round(value: number): number {
  return Number(value.toFixed(6));
}

export function normalizeOverlapSurface(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ja")
    .replace(/[\s♪\p{P}\p{S}]/gu, "");
}

function bigrams(value: string): Set<string> {
  const characters = Array.from(value);
  if (characters.length < 2) return new Set(characters);
  return new Set(
    characters.slice(0, -1).map((character, index) => {
      return `${character}${characters[index + 1] ?? ""}`;
    }),
  );
}

function lcsRatio(left: string, right: string): number {
  const a = Array.from(left);
  const b = Array.from(right);
  if (a.length === 0 || b.length === 0) return 0;
  let previous = new Array<number>(b.length + 1).fill(0);
  for (const character of a) {
    const current = new Array<number>(b.length + 1).fill(0);
    for (let index = 1; index <= b.length; index += 1) {
      current[index] =
        character === b[index - 1]
          ? (previous[index - 1] ?? 0) + 1
          : Math.max(previous[index] ?? 0, current[index - 1] ?? 0);
    }
    previous = current;
  }
  return (2 * (previous[b.length] ?? 0)) / (a.length + b.length);
}

export function overlapAcousticTextSimilarity(
  left: string,
  right: string,
): number {
  const a = normalizeOverlapSurface(left);
  const b = normalizeOverlapSurface(right);
  if (a === b && a !== "") return 1;
  if (a === "" || b === "") return 0;
  const aBigrams = bigrams(a);
  const bBigrams = bigrams(b);
  const shared = [...aBigrams].filter((value) => bBigrams.has(value)).length;
  const dice = (2 * shared) / Math.max(1, aBigrams.size + bBigrams.size);
  return clamp(Math.max(lcsRatio(a, b), dice));
}

function overlapSeconds(
  left: { start: number; end: number },
  right: { start: number; end: number },
): number {
  return Math.max(
    0,
    Math.min(left.end, right.end) - Math.max(left.start, right.start),
  );
}

function coverage(
  target: { start: number; end: number },
  evidence: { start: number; end: number },
): number {
  return clamp(
    overlapSeconds(target, evidence) /
      Math.max(0.001, target.end - target.start),
  );
}

function intervalOverlapRatio(
  left: { start: number; end: number },
  right: { start: number; end: number },
): number {
  return clamp(
    overlapSeconds(left, right) /
      Math.max(0.001, Math.min(left.end - left.start, right.end - right.start)),
  );
}

function unionInterval(cues: readonly SubtitleCue[]): {
  start: number;
  end: number;
} {
  return {
    start: Math.min(...cues.map((cue) => cue.start)),
    end: Math.max(...cues.map((cue) => cue.end)),
  };
}

function extractionInterval(input: {
  union: { start: number; end: number };
  mediaDurationSeconds: number;
  configuration: OverlapAcousticConfiguration;
}): { start: number; end: number } {
  const componentDuration = input.union.end - input.union.start;
  if (componentDuration > input.configuration.hardMaximumWindowSeconds) {
    throw new Error(
      `Overlap component ${componentDuration.toFixed(3)}s exceeds the hard ${input.configuration.hardMaximumWindowSeconds.toFixed(3)}s window limit.`,
    );
  }
  const softLimit = Math.max(
    componentDuration,
    input.configuration.maximumWindowSeconds,
  );
  const availableContext = Math.max(0, softLimit - componentDuration);
  const desiredBefore = Math.min(
    input.configuration.contextSeconds,
    input.union.start,
  );
  const desiredAfter = Math.min(
    input.configuration.contextSeconds,
    Math.max(0, input.mediaDurationSeconds - input.union.end),
  );
  let before = Math.min(desiredBefore, availableContext / 2);
  let after = Math.min(desiredAfter, availableContext - before);
  let remaining = Math.max(0, availableContext - before - after);
  const beforeExtra = Math.min(remaining, desiredBefore - before);
  before += beforeExtra;
  remaining -= beforeExtra;
  after += Math.min(remaining, desiredAfter - after);
  return {
    start: round(Math.max(0, input.union.start - before)),
    end: round(Math.min(input.mediaDurationSeconds, input.union.end + after)),
  };
}

export function planOverlapAcousticComponents(input: {
  cues: readonly SubtitleCue[];
  presentation: SubtitlePresentationResolution;
  mediaDurationSeconds: number;
  configuration?: Partial<OverlapAcousticConfiguration>;
}): OverlapAcousticComponentPlan[] {
  const configuration: OverlapAcousticConfiguration = {
    ...DEFAULT_OVERLAP_ACOUSTIC_CONFIGURATION,
    ...input.configuration,
    scoringWeights: {
      ...DEFAULT_OVERLAP_ACOUSTIC_CONFIGURATION.scoringWeights,
      ...input.configuration?.scoringWeights,
    },
  };
  if (configuration.maximumAsrRequests > 28) {
    throw new Error(
      "maximumOverlapAsrRequests exceeds the absolute limit of 28.",
    );
  }
  const cueById = new Map(input.cues.map((cue) => [cue.id, cue]));
  const plans = input.presentation.overlapDecisions
    .filter(
      (decision) => decision.relationship === "unresolved" && decision.blocking,
    )
    .map((decision) => {
      const cues = decision.cueIds.flatMap((cueId) => {
        const cue = cueById.get(cueId);
        return cue === undefined ? [] : [cue];
      });
      if (cues.length !== decision.cueIds.length) {
        throw new Error(
          `Overlap decision ${decision.decisionId} references a missing cue.`,
        );
      }
      const union = unionInterval(cues);
      return {
        componentId: `overlap-acoustic-${hash({
          sourceOverlapDecisionId: decision.decisionId,
          cueIds: decision.cueIds,
          union,
        }).slice(0, 20)}`,
        sourceOverlapDecisionId: decision.decisionId,
        cueIds: [...decision.cueIds],
        unionInterval: union,
        extractionInterval: extractionInterval({
          union,
          mediaDurationSeconds: input.mediaDurationSeconds,
          configuration,
        }),
        profiles: [...configuration.profiles],
      };
    });
  if (
    plans.reduce((sum, plan) => sum + plan.profiles.length, 0) >
    configuration.maximumAsrRequests
  ) {
    throw new Error(
      "The overlap evidence plan exceeds maximumOverlapAsrRequests.",
    );
  }
  return plans;
}

function temporalCandidateScore(
  cue: SubtitleCue,
  interval: { start: number; end: number },
): number {
  const directCoverage = coverage(cue, interval);
  const cueCenter = (cue.start + cue.end) / 2;
  const intervalCenter = (interval.start + interval.end) / 2;
  const proximity = clamp(1 - Math.abs(cueCenter - intervalCenter) / 3);
  return clamp(directCoverage * 0.7 + proximity * 0.3);
}

function candidateFromText(input: {
  cue: SubtitleCue;
  cueReading: string | null;
  attempt: OverlapAcousticAttempt;
  source: "token" | "segment";
  sourceIds: string[];
  text: string;
  start: number;
  end: number;
  timingUsable?: boolean;
  timingTrustScore?: number;
  timestampTrustStatus?: MatchCandidate["timestampTrustStatus"];
  evidenceSource?: MatchCandidate["evidenceSource"];
  parentSegmentContainmentPassed?: boolean;
  evidenceLineageId?: string;
  readingAnalyzer: JapaneseReadingAnalyzer;
}): MatchCandidate {
  const surfaceScore = overlapAcousticTextSimilarity(
    input.cue.text,
    input.text,
  );
  const evidenceReading = input.readingAnalyzer.analyze(input.text).reading;
  const readingScore =
    input.cueReading === null || evidenceReading === null
      ? null
      : overlapAcousticTextSimilarity(input.cueReading, evidenceReading);
  const lexicalScore = Math.max(surfaceScore, readingScore ?? 0);
  const timingUsable = input.timingUsable ?? true;
  const temporalScore = timingUsable
    ? temporalCandidateScore(input.cue, input)
    : 0;
  return {
    attemptId: input.attempt.attemptId,
    profile: input.attempt.profile,
    modelHash: input.attempt.modelHash,
    source: input.source,
    sourceIds: input.sourceIds,
    text: input.text,
    start: input.start,
    end: input.end,
    timingUsable,
    timingTrustScore: input.timingTrustScore ?? (timingUsable ? 0.7 : 0),
    timestampTrustStatus: input.timestampTrustStatus,
    evidenceSource: input.evidenceSource ?? input.source,
    parentSegmentContainmentPassed:
      input.parentSegmentContainmentPassed ?? timingUsable,
    evidenceLineageId:
      input.evidenceLineageId ??
      `${input.source}:${hash(input.sourceIds.toSorted()).slice(0, 24)}`,
    surfaceScore,
    readingScore,
    lexicalScore,
    temporalScore,
    score: clamp(lexicalScore * 0.8 + temporalScore * 0.2),
  };
}

function attemptCandidates(input: {
  cue: SubtitleCue;
  cueReading: string | null;
  attempt: OverlapAcousticAttempt;
  readingAnalyzer: JapaneseReadingAnalyzer;
}): MatchCandidate[] {
  const output: MatchCandidate[] = [];
  for (const segment of input.attempt.segments) {
    output.push(
      candidateFromText({
        ...input,
        source: "segment",
        sourceIds: [segment.segmentId],
        text: segment.text,
        start: segment.start,
        end: segment.end,
        timingUsable: segment.timingUsable ?? true,
        timingTrustScore: segment.timingUsable === false ? 0 : 0.65,
        evidenceSource:
          input.attempt.decodedSegmentIntervals === undefined
            ? input.attempt.useVad
              ? "vad"
              : "speech"
            : "decoded-segment",
        parentSegmentContainmentPassed: true,
      }),
    );
  }
  const tokens = input.attempt.tokens.filter(
    (token) => token.textUsable !== false && token.specialToken !== true,
  );
  const targetLength = Math.max(
    1,
    Array.from(normalizeOverlapSurface(input.cue.text)).length,
  );
  for (let startIndex = 0; startIndex < tokens.length; startIndex += 1) {
    let text = "";
    for (
      let endIndex = startIndex;
      endIndex < Math.min(tokens.length, startIndex + 24);
      endIndex += 1
    ) {
      const token = tokens[endIndex];
      const first = tokens[startIndex];
      if (token === undefined || first === undefined) continue;
      text += token.text;
      const normalizedLength = Array.from(normalizeOverlapSurface(text)).length;
      if (normalizedLength > targetLength * 2.2 + 6) break;
      const sequence = tokens.slice(startIndex, endIndex + 1);
      const parentSegmentIds = new Set(
        sequence.flatMap((value) =>
          value.parentSegmentId === undefined ? [] : [value.parentSegmentId],
        ),
      );
      const monotonic = sequence.every((value, index) => {
        const previous = sequence[index - 1];
        if (previous === undefined) return true;
        return (
          (value.mappedStart ?? value.start) >=
            (previous.mappedStart ?? previous.start) - 1e-9 &&
          (value.mappedEnd ?? value.end) >=
            (previous.mappedEnd ?? previous.end) - 1e-9 &&
          (value.mappedStart ?? value.start) -
            (previous.mappedEnd ?? previous.end) <=
            0.75
        );
      });
      const timestampIntegrityAware =
        input.attempt.timestampIntegrityRef !== undefined ||
        sequence.some((value) => value.mappingVersion !== undefined);
      const timingUsable =
        (!timestampIntegrityAware || parentSegmentIds.size === 1) &&
        monotonic &&
        sequence.every(
          (value) =>
            (value.timingUsable ?? true) &&
            (!timestampIntegrityAware ||
              (value.mappedStart !== null &&
                value.mappedStart !== undefined &&
                value.mappedEnd !== null &&
                value.mappedEnd !== undefined)),
        );
      const sequenceStart =
        timingUsable && first.mappedStart !== undefined
          ? (first.mappedStart ?? first.start)
          : first.start;
      const sequenceEnd =
        timingUsable && token.mappedEnd !== undefined
          ? (token.mappedEnd ?? token.end)
          : token.end;
      output.push(
        candidateFromText({
          ...input,
          source: "token",
          sourceIds: sequence.map((value) => value.tokenId),
          text,
          start: sequenceStart,
          end: sequenceEnd,
          timingUsable,
          timingTrustScore: timingUsable
            ? Math.min(
                ...sequence.map(
                  (value) => value.tokenTimelineTrustScore ?? 0.7,
                ),
              )
            : 0,
          timestampTrustStatus: timingUsable
            ? sequence[0]?.tokenTimelineStatus
            : (sequence.find((value) => value.timingUsable === false)
                ?.tokenTimelineStatus ?? "untrusted"),
          evidenceSource:
            input.attempt.decodedSegmentIntervals === undefined
              ? "token"
              : input.attempt.useVad
                ? "trusted-mapped-token"
                : "trusted-no-vad-token",
          parentSegmentContainmentPassed: timingUsable,
          evidenceLineageId: `mapped-token-sequence:${hash(
            sequence.map((value) => value.tokenId),
          ).slice(0, 24)}`,
        }),
      );
    }
  }
  return output.toSorted(
    (left, right) =>
      right.score - left.score ||
      right.lexicalScore - left.lexicalScore ||
      left.start - right.start ||
      left.attemptId.localeCompare(right.attemptId),
  );
}

function intervalsForSpeech(
  attempts: readonly OverlapAcousticAttempt[],
  cue: SubtitleCue,
): number {
  const unique = attempts.flatMap(
    (attempt) =>
      attempt.decodedSegmentIntervals ??
      attempt.speechIntervals.map((interval, index) => ({
        ...interval,
        intervalId: `${attempt.attemptId}:legacy-speech:${String(index)}`,
        source: "decoded-segment" as const,
        coordinateSystem: "original-media-global" as const,
        timingUsable: true,
      })),
  );
  const covered = unique.reduce(
    (sum, interval) => sum + overlapSeconds(cue, interval),
    0,
  );
  return clamp(
    covered /
      Math.max(0.001, cue.end - cue.start) /
      Math.max(1, attempts.length),
  );
}

function boundaryConsensus(candidates: readonly MatchCandidate[]): number {
  const trusted = [
    ...new Map(
      candidates
        .filter((candidate) => candidate.timingUsable)
        .toSorted((left, right) => right.score - left.score)
        .map((candidate) => [candidate.evidenceLineageId, candidate] as const),
    ).values(),
  ];
  if (trusted.length < 2) return trusted.length === 1 ? 0.4 : 0;
  const pairs: number[] = [];
  for (let index = 0; index < trusted.length; index += 1) {
    for (let other = index + 1; other < trusted.length; other += 1) {
      const left = trusted[index];
      const right = trusted[other];
      if (left === undefined || right === undefined) continue;
      const difference =
        Math.abs(left.start - right.start) + Math.abs(left.end - right.end);
      pairs.push(clamp(1 - difference / 0.6));
    }
  }
  return pairs.length === 0
    ? 0
    : pairs.reduce((sum, value) => sum + value, 0) / pairs.length;
}

export function alignOverlapComponentCues(input: {
  cues: readonly SubtitleCue[];
  attempts: readonly OverlapAcousticAttempt[];
  configuration?: Partial<OverlapAcousticConfiguration>;
  readingAnalyzer?: JapaneseReadingAnalyzer;
}): OverlapCueAlignment[] {
  const configuration: OverlapAcousticConfiguration = {
    ...DEFAULT_OVERLAP_ACOUSTIC_CONFIGURATION,
    ...input.configuration,
    scoringWeights: {
      ...DEFAULT_OVERLAP_ACOUSTIC_CONFIGURATION.scoringWeights,
      ...input.configuration?.scoringWeights,
    },
  };
  const analyzer = input.readingAnalyzer ?? builtinJapaneseReadingAnalyzer;
  const successfulAttempts = input.attempts.filter(
    (attempt) => attempt.failure === null,
  );
  return [...input.cues]
    .toSorted(
      (left, right) =>
        left.start - right.start || left.id.localeCompare(right.id),
    )
    .map((cue) => {
      const reading = analyzer.analyze(cue.text);
      const bestByAttempt = successfulAttempts.flatMap((attempt) => {
        const best = attemptCandidates({
          cue,
          cueReading: reading.reading,
          attempt,
          readingAnalyzer: analyzer,
        })[0];
        return best === undefined ? [] : [best];
      });
      const supported = bestByAttempt
        .filter(
          (candidate) =>
            candidate.lexicalScore >= 0.48 && candidate.score >= 0.52,
        )
        .toSorted(
          (left, right) =>
            right.score - left.score ||
            left.attemptId.localeCompare(right.attemptId),
        );
      const selected =
        supported[0] ?? bestByAttempt.toSorted((a, b) => b.score - a.score)[0];
      const trustedTimingSupported = supported.filter(
        (candidate) => candidate.timingUsable,
      );
      const timingSelected = trustedTimingSupported.toSorted(
        (left, right) =>
          right.timingTrustScore - left.timingTrustScore ||
          right.score - left.score ||
          left.attemptId.localeCompare(right.attemptId),
      )[0];
      const profiles = new Set(supported.map((candidate) => candidate.profile));
      const models = new Set(supported.map((candidate) => candidate.modelHash));
      const trustedTimingProfiles = new Set(
        trustedTimingSupported.map((candidate) => candidate.profile),
      );
      const trustedTimingModels = new Set(
        trustedTimingSupported.map((candidate) => candidate.modelHash),
      );
      const trustedTimingSourceTypes = new Set(
        trustedTimingSupported.map((candidate) => candidate.evidenceSource),
      );
      const profileConsensusScore = clamp(
        profiles.size /
          Math.max(
            1,
            new Set(successfulAttempts.map((attempt) => attempt.profile)).size,
          ),
      );
      const surfaceAlignmentScore = selected?.surfaceScore ?? 0;
      const readingScores = supported.flatMap((candidate) =>
        candidate.readingScore === null ? [] : [candidate.readingScore],
      );
      const readingAlignmentScore =
        reading.reading === null || readingScores.length === 0
          ? null
          : Math.max(...readingScores);
      const tokenMatches = supported.filter(
        (candidate) => candidate.source === "token",
      );
      const tokenCoverageScore =
        tokenMatches.length === 0
          ? 0
          : Math.max(
              ...tokenMatches.map((candidate) => candidate.lexicalScore),
            );
      const temporalCoverageRatio =
        timingSelected === undefined ? 0 : coverage(cue, timingSelected);
      const localSpeechCoverageRatio = intervalsForSpeech(
        successfulAttempts,
        cue,
      );
      const neighborScores = input.cues
        .filter((other) => other.id !== cue.id && selected !== undefined)
        .map((other) =>
          overlapAcousticTextSimilarity(other.text, selected?.text ?? ""),
        );
      const neighborLexicalAdvantage =
        Math.max(0, ...(neighborScores.length === 0 ? [0] : neighborScores)) -
        (selected?.lexicalScore ?? 0);
      const temporalOutside =
        timingSelected === undefined
          ? 1
          : 1 -
            clamp(
              overlapSeconds(cue, timingSelected) /
                Math.max(0.001, timingSelected.end - timingSelected.start),
            );
      const neighborIntrusionRatio = clamp(
        Math.max(0, neighborLexicalAdvantage) * 0.65 + temporalOutside * 0.35,
      );
      const boundarySupportScore = boundaryConsensus(trustedTimingSupported);
      const lexical = Math.max(
        surfaceAlignmentScore,
        readingAlignmentScore ?? 0,
      );
      const weights = configuration.scoringWeights;
      const alignmentConfidence = clamp(
        lexical * weights.surfaceOrReading +
          tokenCoverageScore * weights.tokenCoverage +
          temporalCoverageRatio * weights.temporalCoverage +
          profileConsensusScore * weights.profileConsensus +
          boundarySupportScore * weights.boundarySupport -
          neighborIntrusionRatio * weights.neighborIntrusionPenalty,
      );
      const blockers = [
        ...(selected === undefined ? ["NO_LOCAL_LEXICAL_MATCH"] : []),
        ...(profiles.size < configuration.minimumIndependentProfileSupport
          ? ["INSUFFICIENT_PROFILE_SUPPORT"]
          : []),
        ...(trustedTimingProfiles.size <
        configuration.minimumIndependentProfileSupport
          ? ["INSUFFICIENT_TRUSTED_TIMING_PROFILE_SUPPORT"]
          : []),
        ...(alignmentConfidence < configuration.minimumAlignmentConfidence
          ? ["LOW_ALIGNMENT_CONFIDENCE"]
          : []),
        ...(neighborIntrusionRatio > configuration.maximumNeighborIntrusionRatio
          ? ["NEIGHBOR_INTRUSION"]
          : []),
        ...(reading.reading === null ? ["READING_UNAVAILABLE"] : []),
      ];
      const matchedIntervals: OverlapCueAlignment["matchedIntervals"] =
        trustedTimingSupported.map((candidate) => ({
          attemptId: candidate.attemptId,
          source: candidate.evidenceSource,
          start: candidate.start,
          end: candidate.end,
          evidenceId: candidate.sourceIds.join("+"),
          timingUsable: true,
          timestampTrustStatus: candidate.timestampTrustStatus,
          timingTrustScore: round(candidate.timingTrustScore),
          alignmentScore: round(candidate.score),
          parentSegmentContainmentPassed:
            candidate.parentSegmentContainmentPassed,
          profileConsensusScore: round(profileConsensusScore),
          boundaryConfidence: round(boundarySupportScore),
          neighborIntrusionRatio: round(neighborIntrusionRatio),
          containmentScore: candidate.parentSegmentContainmentPassed ? 1 : 0,
          sourceTypeSupportCount: trustedTimingSourceTypes.size,
          evidenceLineageId: candidate.evidenceLineageId,
        }));
      const lexicalTokenIds = [
        ...new Set(
          supported
            .filter((candidate) => candidate.source === "token")
            .flatMap((candidate) => candidate.sourceIds),
        ),
      ].toSorted();
      const trustedTokenIds = [
        ...new Set(
          trustedTimingSupported
            .filter((candidate) => candidate.source === "token")
            .flatMap((candidate) => candidate.sourceIds),
        ),
      ].toSorted();
      const tokenById = new Map(
        successfulAttempts.flatMap((attempt) =>
          attempt.tokens.map((token) => [token.tokenId, token] as const),
        ),
      );
      const individuallyTrustedTokenIds = lexicalTokenIds.filter(
        (tokenId) => tokenById.get(tokenId)?.timingUsable === true,
      );
      const individuallyQuarantinedTokenIds = lexicalTokenIds.filter(
        (tokenId) => tokenById.get(tokenId)?.timingUsable !== true,
      );
      const trustedTokenSequences = trustedTimingSupported.filter(
        (candidate) => candidate.source === "token",
      );
      const selectedTimingSequence = trustedTokenSequences[0];
      const sequenceParentSegmentIds = [
        ...new Set(
          (selectedTimingSequence?.sourceIds ?? []).flatMap((tokenId) => {
            const parent = tokenById.get(tokenId)?.parentSegmentId;
            return parent === undefined ? [] : [parent];
          }),
        ),
      ].toSorted();
      const lexicalOnlySequences = supported.filter(
        (candidate) => candidate.source === "token" && !candidate.timingUsable,
      );
      const lexicalOnlySequenceTokenIds = [
        ...new Set(
          lexicalOnlySequences.flatMap((candidate) => candidate.sourceIds),
        ),
      ].toSorted();
      const sequenceTimingUsable =
        selectedTimingSequence !== undefined &&
        sequenceParentSegmentIds.length === 1;
      const sequenceQuarantineReasons = [
        ...(lexicalOnlySequences.some((candidate) =>
          candidate.sourceIds.some(
            (tokenId) => tokenById.get(tokenId)?.timingUsable !== true,
          ),
        )
          ? ["SEQUENCE_CONTAINS_INDIVIDUALLY_QUARANTINED_TOKEN"]
          : []),
        ...(lexicalOnlySequences.some(
          (candidate) =>
            new Set(
              candidate.sourceIds.flatMap((tokenId) => {
                const parent = tokenById.get(tokenId)?.parentSegmentId;
                return parent === undefined ? [] : [parent];
              }),
            ).size !== 1,
        )
          ? ["SEQUENCE_CROSSES_PARENT_SEGMENT"]
          : []),
        ...(lexicalOnlySequences.length > 0 &&
        !lexicalOnlySequences.some((candidate) =>
          candidate.sourceIds.some(
            (tokenId) => tokenById.get(tokenId)?.timingUsable !== true,
          ),
        )
          ? ["SEQUENCE_TIMING_HEALTH_FAILED"]
          : []),
      ];
      const rawVadEvidence = [
        ...new Map(
          successfulAttempts
            .flatMap((attempt) =>
              (attempt.rawVadIntervals ?? []).flatMap((interval) =>
                interval.timingUsable &&
                (overlapSeconds(cue, interval) > 0 ||
                  (timingSelected !== undefined &&
                    overlapSeconds(timingSelected, interval) > 0))
                  ? [
                      {
                        intervalId: interval.intervalId,
                        lineageId:
                          interval.evidenceLineageId ??
                          `raw-vad:${attempt.attemptId}:${interval.intervalId}`,
                      },
                    ]
                  : [],
              ),
            )
            .map((value) => [value.lineageId, value] as const),
        ).values(),
      ];
      return {
        cueId: cue.id,
        canonicalText: cue.text,
        normalizedSurface: normalizeOverlapSurface(cue.text),
        normalizedReading: reading.reading,
        readingAvailable: reading.reading !== null,
        surfaceAlignmentScore: round(surfaceAlignmentScore),
        readingAlignmentScore:
          readingAlignmentScore === null ? null : round(readingAlignmentScore),
        tokenCoverageScore: round(tokenCoverageScore),
        temporalCoverageRatio: round(temporalCoverageRatio),
        localSpeechCoverageRatio: round(localSpeechCoverageRatio),
        neighborIntrusionRatio: round(neighborIntrusionRatio),
        profileConsensusScore: round(profileConsensusScore),
        boundarySupportScore: round(boundarySupportScore),
        boundaryConfidence: round(boundarySupportScore),
        independentProfileSupportCount: profiles.size,
        independentModelSupportCount: models.size,
        matchedAttemptIds: [
          ...new Set(supported.map((candidate) => candidate.attemptId)),
        ].toSorted(),
        matchedSegmentIds: [
          ...new Set(
            supported
              .filter((candidate) => candidate.source === "segment")
              .flatMap((candidate) => candidate.sourceIds),
          ),
        ].toSorted(),
        matchedTokenIds: lexicalTokenIds,
        trustedMatchedTokenIds: trustedTokenIds,
        quarantinedMatchedTokenIds: individuallyQuarantinedTokenIds,
        individuallyTrustedMatchedTokenIds: individuallyTrustedTokenIds,
        individuallyQuarantinedMatchedTokenIds: individuallyQuarantinedTokenIds,
        lexicalOnlySequenceTokenIds,
        sequenceTimingUsable,
        sequenceTimingEvidenceIds: sequenceTimingUsable
          ? [selectedTimingSequence.evidenceLineageId]
          : [],
        sequenceQuarantineReasons,
        sequenceParentSegmentIds,
        trustedMappedTokenEvidenceIds: matchedIntervals
          .filter(
            (interval) =>
              interval.source === "trusted-mapped-token" ||
              interval.source === "trusted-no-vad-token",
          )
          .flatMap((interval) =>
            interval.evidenceId === undefined ? [] : [interval.evidenceId],
          ),
        trustedRawVadEvidenceIds: rawVadEvidence
          .map((value) => value.intervalId)
          .toSorted(),
        decodedSegmentEvidenceIds: matchedIntervals
          .filter((interval) => interval.source === "decoded-segment")
          .flatMap((interval) =>
            interval.evidenceId === undefined ? [] : [interval.evidenceId],
          ),
        timingEvidenceLineageIds: [
          ...new Set([
            ...matchedIntervals.flatMap((interval) =>
              interval.evidenceLineageId === undefined
                ? []
                : [interval.evidenceLineageId],
            ),
            ...rawVadEvidence.map((value) => value.lineageId),
          ]),
        ].toSorted(),
        trustedTimingEvidenceIds: matchedIntervals.flatMap((interval) =>
          interval.evidenceId === undefined ? [] : [interval.evidenceId],
        ),
        lexicalOnlyEvidenceIds: lexicalOnlySequences.map(
          (candidate) => candidate.evidenceLineageId,
        ),
        trustedTimingProfileSupportCount: trustedTimingProfiles.size,
        trustedTimingSourceTypeCount: trustedTimingSourceTypes.size,
        trustedTimingModelSupportCount: trustedTimingModels.size,
        matchedIntervals,
        alignmentMethod:
          selected === undefined
            ? "unresolved"
            : selected.source === "token"
              ? readingAlignmentScore !== null &&
                readingAlignmentScore > surfaceAlignmentScore
                ? "reading-token-sequence"
                : "surface-token-sequence"
              : "surface-segment",
        alignmentConfidence: round(alignmentConfidence),
        blockers: [...new Set(blockers)].toSorted(),
        evidence: [
          `reading-analyzer:${analyzer.id}`,
          `profile-support:${String(profiles.size)}`,
          `model-support:${String(models.size)}`,
          `raw-vad-boundary-evidence:${String(rawVadEvidence.length)}`,
          "raw-vad-speaker-inference:prohibited",
          ...(selected === undefined
            ? []
            : [
                `best-match-attempt:${selected.attemptId}`,
                `best-match-source:${selected.source}`,
              ]),
        ],
      } satisfies OverlapCueAlignment;
    });
}

function representativeInterval(
  alignment: OverlapCueAlignment,
): OverlapCueAlignment["matchedIntervals"][number] | null {
  const legacySources = new Set([
    "token",
    "segment",
    "speech",
    "vad",
    "source",
  ]);
  if (
    alignment.matchedIntervals.length > 0 &&
    alignment.matchedIntervals.every((interval) =>
      legacySources.has(interval.source),
    )
  ) {
    const priority: Record<string, number> = {
      token: 0,
      segment: 1,
      speech: 2,
      vad: 3,
      source: 4,
    };
    return (
      alignment.matchedIntervals.toSorted(
        (left, right) =>
          (priority[left.source] ?? 99) - (priority[right.source] ?? 99) ||
          left.attemptId.localeCompare(right.attemptId),
      )[0] ?? null
    );
  }
  return (
    alignment.matchedIntervals
      .filter((interval) => interval.timingUsable !== false)
      .toSorted((left, right) => {
        const priority: Record<
          OverlapCueAlignment["matchedIntervals"][number]["source"],
          number
        > = {
          "trusted-mapped-token": 0,
          "trusted-no-vad-token": 1,
          "raw-vad": 2,
          "decoded-segment": 3,
          "source-cue": 4,
          pause: 5,
          token: 1,
          segment: 3,
          speech: 3,
          vad: 4,
          source: 4,
          "legacy-token-untrusted": 99,
        };
        return (
          priority[left.source] - priority[right.source] ||
          (right.timingTrustScore ?? 0) - (left.timingTrustScore ?? 0) ||
          (right.alignmentScore ?? 0) - (left.alignmentScore ?? 0) ||
          Number(right.parentSegmentContainmentPassed ?? false) -
            Number(left.parentSegmentContainmentPassed ?? false) ||
          (right.profileConsensusScore ?? 0) -
            (left.profileConsensusScore ?? 0) ||
          (right.boundaryConfidence ?? 0) - (left.boundaryConfidence ?? 0) ||
          (left.neighborIntrusionRatio ?? 1) -
            (right.neighborIntrusionRatio ?? 1) ||
          (left.evidenceId ?? left.attemptId).localeCompare(
            right.evidenceId ?? right.attemptId,
          )
        );
      })[0] ?? null
  );
}

function rawVadBoundaryRelation(input: {
  attempts: readonly OverlapAcousticAttempt[];
  left: OverlapCueAlignment["matchedIntervals"][number] | null;
  right: OverlapCueAlignment["matchedIntervals"][number] | null;
  minimumProfileSupport: number;
}): {
  relation:
    | "pause-supported"
    | "continuous-speech-island"
    | "conflicting"
    | "unavailable";
  profileSupportCount: number;
  evidenceIds: string[];
} {
  if (input.left === null || input.right === null) {
    return {
      relation: "unavailable",
      profileSupportCount: 0,
      evidenceIds: [],
    };
  }
  const pauseProfiles = new Set<OverlapAcousticProfile>();
  const continuousProfiles = new Set<OverlapAcousticProfile>();
  const pauseIds = new Set<string>();
  const continuousIds = new Set<string>();
  for (const attempt of input.attempts) {
    const intervals = (attempt.rawVadIntervals ?? [])
      .filter(
        (interval) =>
          interval.timingUsable &&
          (interval.rawVadIntervalHealthStatus === "trusted" ||
            interval.rawVadIntervalHealthStatus === "overlapping-with-padding"),
      )
      .toSorted(
        (left, right) =>
          left.start - right.start ||
          left.intervalId.localeCompare(right.intervalId),
      );
    for (const interval of intervals) {
      // A single island is continuous only when it actually reaches both
      // observed lexical boundaries. A broad tolerance here would let either
      // side of a real pause masquerade as a spanning island.
      if (
        interval.start <= input.left.end + 0.02 &&
        interval.end >= input.right.start - 0.02
      ) {
        continuousProfiles.add(attempt.profile);
        continuousIds.add(interval.intervalId);
      }
    }
    for (let index = 1; index < intervals.length; index += 1) {
      const before = intervals[index - 1];
      const after = intervals[index];
      if (before === undefined || after === undefined) continue;
      if (
        after.start - before.end >= 0.03 &&
        Math.abs(before.end - input.left.end) <= 0.45 &&
        Math.abs(after.start - input.right.start) <= 0.45
      ) {
        pauseProfiles.add(attempt.profile);
        pauseIds.add(before.intervalId);
        pauseIds.add(after.intervalId);
      }
    }
  }
  const pauseSupported = pauseProfiles.size >= input.minimumProfileSupport;
  const continuousSupported =
    continuousProfiles.size >= input.minimumProfileSupport;
  if (pauseSupported && continuousSupported) {
    return {
      relation: "conflicting",
      profileSupportCount: Math.max(
        pauseProfiles.size,
        continuousProfiles.size,
      ),
      evidenceIds: [...new Set([...pauseIds, ...continuousIds])].toSorted(),
    };
  }
  if (pauseSupported) {
    return {
      relation: "pause-supported",
      profileSupportCount: pauseProfiles.size,
      evidenceIds: [...pauseIds].toSorted(),
    };
  }
  if (continuousSupported) {
    return {
      relation: "continuous-speech-island",
      profileSupportCount: continuousProfiles.size,
      evidenceIds: [...continuousIds].toSorted(),
    };
  }
  return {
    relation: "unavailable",
    profileSupportCount: Math.max(pauseProfiles.size, continuousProfiles.size),
    evidenceIds: [...new Set([...pauseIds, ...continuousIds])].toSorted(),
  };
}

function repeatedCallStructure(value: string): boolean {
  const units = value.match(/[^!?！？]+[!?！？]+/gu) ?? [];
  if (units.length < 2) return false;
  const normalized = units.map(normalizeOverlapSurface);
  return normalized.every((unit) => unit !== "" && unit === normalized[0]);
}

function supportedAlignment(
  alignment: OverlapCueAlignment,
  configuration: OverlapAcousticConfiguration,
): boolean {
  return (
    alignment.alignmentConfidence >= configuration.minimumAlignmentConfidence &&
    alignment.boundaryConfidence >= configuration.minimumBoundaryConfidence &&
    alignment.independentProfileSupportCount >=
      configuration.minimumIndependentProfileSupport &&
    (alignment.trustedTimingProfileSupportCount ??
      alignment.independentProfileSupportCount) >=
      configuration.minimumIndependentProfileSupport &&
    alignment.neighborIntrusionRatio <=
      configuration.maximumNeighborIntrusionRatio
  );
}

function mutationBoundarySource(
  source: OverlapCueAlignment["matchedIntervals"][number]["source"],
): OverlapAcousticComponent["timingMutations"][number]["boundarySource"] {
  if (source === "segment" || source === "speech") return "speech";
  if (source === "token") return "token";
  if (source === "vad") return "vad";
  if (source === "source") return "source-cue";
  if (source === "legacy-token-untrusted") {
    throw new Error(
      "Untrusted token evidence cannot source a timing mutation.",
    );
  }
  return source;
}

function atomicTimingProposal(input: {
  componentId: string;
  allCues: readonly SubtitleCue[];
  componentCues: readonly SubtitleCue[];
  alignments: readonly OverlapCueAlignment[];
  configuration: OverlapAcousticConfiguration;
}): {
  mutations: OverlapAcousticComponent["timingMutations"];
  valid: boolean;
  reasons: string[];
} {
  const ordered = [...input.componentCues].toSorted(
    (left, right) =>
      left.start - right.start || left.id.localeCompare(right.id),
  );
  const alignmentById = new Map(
    input.alignments.map((value) => [value.cueId, value]),
  );
  const proposed = new Map(
    ordered.map((cue) => [cue.id, { start: cue.start, end: cue.end }]),
  );
  const evidenceByCue = new Map<
    string,
    { source: ReturnType<typeof mutationBoundarySource>; ids: string[] }
  >();
  const reasons: string[] = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const left = ordered[index - 1];
    const right = ordered[index];
    if (
      left === undefined ||
      right === undefined ||
      right.start >= left.end - 0.01
    )
      continue;
    const leftAlignment = alignmentById.get(left.id);
    const rightAlignment = alignmentById.get(right.id);
    const leftEvidence =
      leftAlignment === undefined
        ? null
        : representativeInterval(leftAlignment);
    const rightEvidence =
      rightAlignment === undefined
        ? null
        : representativeInterval(rightAlignment);
    if (
      leftAlignment === undefined ||
      rightAlignment === undefined ||
      leftEvidence === null ||
      rightEvidence === null ||
      !supportedAlignment(leftAlignment, input.configuration) ||
      !supportedAlignment(rightAlignment, input.configuration) ||
      leftEvidence.end > rightEvidence.start + 0.01
    ) {
      reasons.push(
        `pair:${left.id}:${right.id}:trusted-ordered-boundary-unavailable`,
      );
      return { mutations: [], valid: false, reasons };
    }
    const leftProposal = proposed.get(left.id);
    const rightProposal = proposed.get(right.id);
    if (leftProposal === undefined || rightProposal === undefined) {
      return {
        mutations: [],
        valid: false,
        reasons: ["component-cue-missing"],
      };
    }
    // Use the two observed acoustic boundaries as-is. Do not average them and
    // do not manufacture an overlap midpoint.
    leftProposal.end = Math.min(leftProposal.end, leftEvidence.end);
    rightProposal.start = Math.max(rightProposal.start, rightEvidence.start);
    evidenceByCue.set(left.id, {
      source: mutationBoundarySource(leftEvidence.source),
      ids: [leftEvidence.evidenceId ?? leftEvidence.attemptId],
    });
    evidenceByCue.set(right.id, {
      source: mutationBoundarySource(rightEvidence.source),
      ids: [rightEvidence.evidenceId ?? rightEvidence.attemptId],
    });
  }
  const byId = new Map(input.allCues.map((cue) => [cue.id, cue]));
  const mutations = ordered.flatMap((cue) => {
    const after = proposed.get(cue.id);
    const evidence = evidenceByCue.get(cue.id);
    if (
      after === undefined ||
      evidence === undefined ||
      (after.start === cue.start && after.end === cue.end)
    ) {
      return [];
    }
    return [
      {
        mutationId: `overlap-timing-${hash({ componentId: input.componentId, cueId: cue.id, before: cue, after }).slice(0, 20)}`,
        componentId: input.componentId,
        cueId: cue.id,
        beforeStart: cue.start,
        beforeEnd: cue.end,
        afterStart: round(after.start),
        afterEnd: round(after.end),
        startDelta: round(after.start - cue.start),
        endDelta: round(after.end - cue.end),
        boundarySource: evidence.source,
        evidenceIds: evidence.ids,
        textChanged: false as const,
      },
    ];
  });
  const mutationById = new Map(mutations.map((value) => [value.cueId, value]));
  const finalCues = input.allCues.map((cue) => {
    const mutation = mutationById.get(cue.id);
    return mutation === undefined
      ? cue
      : { ...cue, start: mutation.afterStart, end: mutation.afterEnd };
  });
  const invalid = mutations.some(
    (mutation) =>
      Math.abs(mutation.startDelta) >
        input.configuration.maximumTimingAdjustmentSeconds + 1e-9 ||
      Math.abs(mutation.endDelta) >
        input.configuration.maximumTimingAdjustmentSeconds + 1e-9 ||
      mutation.afterEnd - mutation.afterStart <
        input.configuration.minimumPostRepairCueDurationSeconds,
  );
  const orderedFinal = [...finalCues].toSorted(
    (left, right) =>
      left.start - right.start || left.id.localeCompare(right.id),
  );
  const componentIds = new Set(input.componentCues.map((cue) => cue.id));
  const newOverlap = orderedFinal.some((cue, index) => {
    const previous = orderedFinal[index - 1];
    if (previous === undefined || cue.start >= previous.end - 0.01)
      return false;
    if (!componentIds.has(previous.id) && !componentIds.has(cue.id))
      return false;
    const pairOriginallyOverlapped =
      overlapSeconds(
        byId.get(previous.id) ?? previous,
        byId.get(cue.id) ?? cue,
      ) > 0.01;
    return !pairOriginallyOverlapped;
  });
  const remainingComponentOverlap = ordered.some((cue, index) => {
    const previous = ordered[index - 1];
    if (previous === undefined) return false;
    const left = mutationById.get(previous.id);
    const right = mutationById.get(cue.id);
    const leftEnd = left?.afterEnd ?? previous.end;
    const rightStart = right?.afterStart ?? cue.start;
    return rightStart < leftEnd - 0.01;
  });
  if (
    invalid ||
    newOverlap ||
    remainingComponentOverlap ||
    mutations.length === 0
  ) {
    return {
      mutations: [],
      valid: false,
      reasons: [
        ...reasons,
        ...(invalid ? ["timing-safety-limit-failed"] : []),
        ...(newOverlap ? ["timing-proposal-created-new-overlap"] : []),
        ...(remainingComponentOverlap ? ["component-overlap-remains"] : []),
        ...(mutations.length === 0 ? ["no-timing-mutation-proposed"] : []),
        "component-atomic-rollback",
      ],
    };
  }
  return {
    mutations,
    valid: true,
    reasons: ["component-atomic-proposal-valid"],
  };
}

export function classifyOverlapAcousticComponent(input: {
  plan: OverlapAcousticComponentPlan;
  allCues: readonly SubtitleCue[];
  sourceDecision: OverlapDecision;
  attempts: readonly OverlapAcousticAttempt[];
  mode: OverlapAcousticResolutionMode;
  configuration?: Partial<OverlapAcousticConfiguration>;
  audioPath: string | null;
  audioSha256: string | null;
  audioDurationSeconds: number | null;
  audioFullyCoversComponent: boolean;
  readingAnalyzer?: JapaneseReadingAnalyzer;
}): OverlapAcousticComponent {
  const configuration: OverlapAcousticConfiguration = {
    ...DEFAULT_OVERLAP_ACOUSTIC_CONFIGURATION,
    ...input.configuration,
    scoringWeights: {
      ...DEFAULT_OVERLAP_ACOUSTIC_CONFIGURATION.scoringWeights,
      ...input.configuration?.scoringWeights,
    },
  };
  const cueById = new Map(input.allCues.map((cue) => [cue.id, cue]));
  const componentCues = input.plan.cueIds.flatMap((cueId) => {
    const cue = cueById.get(cueId);
    return cue === undefined ? [] : [cue];
  });
  const attempts = input.attempts.filter(
    (attempt) => attempt.componentId === input.plan.componentId,
  );
  const timestampIntegrityAware = attempts.some(
    (attempt) => attempt.timestampIntegrityRef !== undefined,
  );
  const alignments = alignOverlapComponentCues({
    cues: componentCues,
    attempts,
    configuration,
    ...(input.readingAnalyzer === undefined
      ? {}
      : { readingAnalyzer: input.readingAnalyzer }),
  });
  const alignmentById = new Map(
    alignments.map((value) => [value.cueId, value]),
  );
  const ordered = [...componentCues].toSorted(
    (left, right) =>
      left.start - right.start || left.id.localeCompare(right.id),
  );
  const pairAssessments = ordered.slice(1).flatMap((right, index) => {
    const left = ordered[index];
    const leftAlignment =
      left === undefined ? undefined : alignmentById.get(left.id);
    const rightAlignment = alignmentById.get(right.id);
    const leftInterval =
      leftAlignment === undefined
        ? null
        : representativeInterval(leftAlignment);
    const rightInterval =
      rightAlignment === undefined
        ? null
        : representativeInterval(rightAlignment);
    if (left === undefined) return [];
    const matchedOverlap =
      leftInterval === null || rightInterval === null
        ? 0
        : overlapSeconds(leftInterval, rightInterval);
    const rawVadBoundary = rawVadBoundaryRelation({
      attempts,
      left: leftInterval,
      right: rightInterval,
      minimumProfileSupport: configuration.minimumIndependentProfileSupport,
    });
    const sameOccurrenceLikely =
      leftInterval !== null &&
      rightInterval !== null &&
      overlapAcousticTextSimilarity(left.text, right.text) >= 0.86 &&
      intervalOverlapRatio(leftInterval, rightInterval) >= 0.7;
    const simultaneouslySupported =
      leftAlignment !== undefined &&
      rightAlignment !== undefined &&
      supportedAlignment(leftAlignment, configuration) &&
      supportedAlignment(rightAlignment, configuration) &&
      matchedOverlap >= 0.1;
    return [
      {
        leftCueId: left.id,
        rightCueId: right.id,
        originalOverlapSeconds: round(overlapSeconds(left, right)),
        matchedIntervalOverlapSeconds: round(matchedOverlap),
        orderConsistent:
          leftInterval !== null &&
          rightInterval !== null &&
          leftInterval.start <= rightInterval.start,
        sameOccurrenceLikely,
        simultaneousSpeechSupported: simultaneouslySupported,
        boundaryEvidenceIds: [
          ...(leftInterval === null
            ? []
            : [leftInterval.evidenceId ?? leftInterval.attemptId]),
          ...(rightInterval === null
            ? []
            : [rightInterval.evidenceId ?? rightInterval.attemptId]),
          ...rawVadBoundary.evidenceIds,
        ],
        rawVadBoundaryRelation: rawVadBoundary.relation,
        rawVadProfileSupportCount: rawVadBoundary.profileSupportCount,
        rawVadBoundaryEvidenceIds: rawVadBoundary.evidenceIds,
        confidence: round(
          Math.min(
            leftAlignment?.alignmentConfidence ?? 0,
            rightAlignment?.alignmentConfidence ?? 0,
          ),
        ),
      },
    ];
  });
  const allSupported =
    alignments.length === componentCues.length &&
    alignments.every((alignment) =>
      supportedAlignment(alignment, configuration),
    );
  const allOrdered =
    pairAssessments.length > 0 &&
    pairAssessments.every((pair) => pair.orderConsistent);
  const matchedOverlapTotal = pairAssessments.reduce(
    (sum, pair) => sum + pair.matchedIntervalOverlapSeconds,
    0,
  );
  const originalOverlapTotal = pairAssessments.reduce(
    (sum, pair) => sum + pair.originalOverlapSeconds,
    0,
  );
  const sameOccurrence = pairAssessments.some(
    (pair) => pair.sameOccurrenceLikely,
  );
  const simultaneous =
    pairAssessments.some((pair) => pair.simultaneousSpeechSupported) &&
    allSupported;
  const nestedPair = componentCues.some((outer) =>
    componentCues.some(
      (inner) =>
        outer.id !== inner.id &&
        outer.start <= inner.start &&
        outer.end >= inner.end &&
        outer.end - outer.start >= (inner.end - inner.start) * 1.35,
    ),
  );
  const repeatedCue = componentCues.find((cue) =>
    repeatedCallStructure(cue.text),
  );
  const lexicalCue = componentCues.find(
    (cue) =>
      cue.id !== repeatedCue?.id &&
      normalizeOverlapSurface(cue.text).length >= 3,
  );
  const crowdCall =
    repeatedCue !== undefined &&
    lexicalCue !== undefined &&
    nestedPair &&
    allSupported &&
    (alignmentById.get(lexicalCue.id)?.independentProfileSupportCount ?? 0) >=
      configuration.minimumIndependentProfileSupport;
  const maximumOriginalPairOverlap = Math.max(
    0,
    ...pairAssessments.map((pair) => pair.originalOverlapSeconds),
  );
  const orderedNoOverlapScore = clamp(
    (allSupported ? 0.45 : 0) +
      (allOrdered ? 0.3 : 0) +
      (matchedOverlapTotal <= 0.02 ? 0.25 : 0),
  );
  const rapidTurnScore = clamp(
    (allSupported ? 0.4 : 0) +
      (allOrdered ? 0.25 : 0) +
      (maximumOriginalPairOverlap <= 0.75 ? 0.2 : 0) +
      (matchedOverlapTotal <= 0.25 ? 0.15 : 0),
  );
  const nestedScore = clamp(
    (nestedPair ? 0.35 : 0) +
      (allSupported ? 0.35 : 0) +
      (simultaneous ? 0.2 : 0) +
      (crowdCall ? 0.1 : 0),
  );
  const simultaneousScore = clamp(
    (allSupported ? 0.4 : 0) +
      (simultaneous ? 0.4 : 0) +
      (matchedOverlapTotal > 0.25 ? 0.2 : 0),
  );
  const sameAlternativeScore = clamp(
    (sameOccurrence ? 0.75 : 0) +
      (input.sourceDecision.textSimilarity >= 0.9 ? 0.25 : 0),
  );
  const counterfactuals = [
    { hypothesis: "ordered-no-overlap" as const, score: orderedNoOverlapScore },
    { hypothesis: "rapid-turn-taking" as const, score: rapidTurnScore },
    { hypothesis: "nested-background-foreground" as const, score: nestedScore },
    {
      hypothesis: "true-simultaneous-speech" as const,
      score: simultaneousScore,
    },
    {
      hypothesis: "same-utterance-alternative" as const,
      score: sameAlternativeScore,
    },
  ].map((value) => ({
    ...value,
    score: round(value.score),
    evidenceIds: pairAssessments.flatMap((pair) => pair.boundaryEvidenceIds),
    blockers: allSupported ? [] : ["INSUFFICIENT_ACOUSTIC_ALIGNMENT"],
  }));
  const rankedHypotheses = [...counterfactuals].toSorted(
    (left, right) =>
      right.score - left.score ||
      left.hypothesis.localeCompare(right.hypothesis),
  );
  const bestHypothesis = rankedHypotheses[0];
  const runnerUpHypothesis = rankedHypotheses[1] ?? null;
  if (bestHypothesis === undefined) {
    throw new Error("Overlap classification produced no hypotheses.");
  }
  const decisionMargin = round(
    Math.max(0, bestHypothesis.score - (runnerUpHypothesis?.score ?? 0)),
  );
  const decisionMarginSufficient =
    !timestampIntegrityAware ||
    decisionMargin >= configuration.minimumDecisionMargin;
  let relationship: OverlapRelationship = "unresolved";
  let recommendedAction: OverlapAcousticComponent["recommendedAction"] =
    "review";
  let safeAutomaticAction: OverlapAcousticComponent["safeAutomaticAction"] =
    "none";
  let blocking = true;
  let timingMutations: OverlapAcousticComponent["timingMutations"] = [];
  const reasons: string[] = [];
  if (!input.audioFullyCoversComponent) {
    reasons.push("component-audio-coverage-incomplete");
  } else if (sameAlternativeScore >= 0.8) {
    relationship = "same-utterance-alternative";
    recommendedAction = "select-alternative";
    reasons.push("same-acoustic-occurrence-requires-human-selection");
  } else if (crowdCall && nestedScore >= 0.75 && decisionMarginSufficient) {
    relationship = "crowd-call-plus-dialogue";
    recommendedAction = "preserve-overlap";
    safeAutomaticAction = "presentation-only";
    blocking = false;
    reasons.push(
      "repeated-call-and-independent-nested-lexical-speech-supported",
    );
  } else if (
    nestedPair &&
    nestedScore >= 0.8 &&
    simultaneous &&
    decisionMarginSufficient
  ) {
    relationship = "nested-background-speech";
    recommendedAction = "preserve-overlap";
    safeAutomaticAction = "presentation-only";
    blocking = false;
    reasons.push("nested-background-and-foreground-acoustic-support");
  } else if (
    simultaneousScore >= 0.85 &&
    simultaneousScore > orderedNoOverlapScore + 0.08 &&
    decisionMarginSufficient
  ) {
    relationship = "true-simultaneous-speech";
    recommendedAction = "preserve-overlap";
    safeAutomaticAction = "presentation-only";
    blocking = false;
    reasons.push("two-acoustically-supported-matched-intervals-overlap");
  } else if (
    orderedNoOverlapScore >= 0.85 &&
    originalOverlapTotal > 0 &&
    decisionMarginSufficient
  ) {
    const proposal = atomicTimingProposal({
      componentId: input.plan.componentId,
      allCues: input.allCues,
      componentCues,
      alignments,
      configuration,
    });
    reasons.push(...proposal.reasons);
    if (proposal.valid) {
      relationship = "different-dialogue-boundary-error";
      recommendedAction = "trim-boundary";
      safeAutomaticAction = "timing-only";
      timingMutations = proposal.mutations;
      blocking = false;
    }
  } else if (
    rapidTurnScore >= 0.85 &&
    maximumOriginalPairOverlap <= 0.75 &&
    !simultaneous &&
    decisionMarginSufficient
  ) {
    relationship = "rapid-turn-taking";
    recommendedAction = "preserve-overlap";
    safeAutomaticAction = "presentation-only";
    blocking = false;
    reasons.push("small-ordered-overlap-supported-as-rapid-turn-taking");
  } else {
    reasons.push("acoustic-evidence-insufficient-or-conflicting");
    if (!decisionMarginSufficient) {
      reasons.push("uncalibrated-hypothesis-decision-margin-insufficient");
    }
  }
  const timestampIntegrityGateFailures = [
    ...(alignments.some((alignment) =>
      alignment.matchedIntervals.some(
        (interval) =>
          interval.source === "legacy-token-untrusted" ||
          interval.timingUsable === false,
      ),
    )
      ? ["UNTRUSTED_TOKEN_USED_FOR_TIMING"]
      : []),
    ...(alignments.some((alignment) =>
      alignment.matchedIntervals.some(
        (interval) =>
          interval.timestampTrustStatus !== undefined &&
          !interval.timestampTrustStatus.startsWith("trusted") &&
          (interval.source === "trusted-mapped-token" ||
            interval.source === "trusted-no-vad-token"),
      ),
    )
      ? ["UNKNOWN_COORDINATE_TOKEN_USED_FOR_TIMING"]
      : []),
    ...(alignments.some((alignment) =>
      alignment.matchedIntervals.some(
        (interval) => interval.parentSegmentContainmentPassed === false,
      ),
    )
      ? ["TOKEN_OUTSIDE_PARENT_SEGMENT_USED"]
      : []),
  ];
  if (timestampIntegrityGateFailures.length > 0) {
    relationship = "unresolved";
    recommendedAction = "review";
    safeAutomaticAction = "none";
    timingMutations = [];
    blocking = true;
    reasons.push(...timestampIntegrityGateFailures);
  }
  if (input.mode !== "enforce") {
    if (relationship !== "unresolved") {
      reasons.push("observe-mode-does-not-close-blocking-findings");
    }
    safeAutomaticAction = "none";
    timingMutations = [];
    blocking = true;
  }
  const presentationOverrides =
    !blocking && safeAutomaticAction === "presentation-only"
      ? legalOverlapPresentationOverrides(componentCues)
      : { ass: [], vtt: [] };
  const classificationConfidence = bestHypothesis.score;
  return overlapAcousticComponentSchema.parse({
    componentId: input.plan.componentId,
    sourceOverlapDecisionId: input.plan.sourceOverlapDecisionId,
    cueIds: input.plan.cueIds,
    unionInterval: input.plan.unionInterval,
    extractionInterval: input.plan.extractionInterval,
    audioPath: input.audioPath,
    audioSha256: input.audioSha256,
    audioDurationSeconds: input.audioDurationSeconds,
    audioFullyCoversComponent: input.audioFullyCoversComponent,
    profileAttemptIds: attempts.map((attempt) => attempt.attemptId).toSorted(),
    cueAlignments: alignments,
    pairAssessments,
    counterfactuals,
    finalRelationship: relationship,
    classificationConfidence: round(classificationConfidence),
    bestHypothesis: bestHypothesis.hypothesis,
    bestHypothesisScore: bestHypothesis.score,
    runnerUpHypothesis: runnerUpHypothesis?.hypothesis ?? null,
    runnerUpHypothesisScore: runnerUpHypothesis?.score ?? null,
    decisionMargin,
    scoreCalibrationStatus: "uncalibrated-heuristic",
    timestampIntegrityGateFailures,
    recommendedAction,
    safeAutomaticAction,
    timingMutations,
    assEventOverrides: presentationOverrides.ass,
    vttCueSettings: presentationOverrides.vtt,
    blocking,
    reasons: [...new Set(reasons)].toSorted(),
  });
}

function cuesContainOverlap(cues: readonly SubtitleCue[]): boolean {
  const ordered = [...cues].toSorted(
    (left, right) => left.start - right.start || left.end - right.end,
  );
  let maximumEnd = -Infinity;
  for (const cue of ordered) {
    if (cue.start < maximumEnd - 0.01) return true;
    maximumEnd = Math.max(maximumEnd, cue.end);
  }
  return false;
}

export function applyOverlapAcousticResolution(input: {
  presentation: SubtitlePresentationResolutionResult;
  acoustic: SubtitleOverlapAcousticResolution;
  mode: OverlapAcousticResolutionMode;
}): SubtitlePresentationResolutionResult {
  const componentsByDecisionId = new Map(
    input.acoustic.components.map((component) => [
      component.sourceOverlapDecisionId,
      component,
    ]),
  );
  const mutationByCueId = new Map(
    input.mode === "enforce"
      ? input.acoustic.components
          .flatMap((component) =>
            component.blocking ? [] : component.timingMutations,
          )
          .map((mutation) => [mutation.cueId, mutation] as const)
      : [],
  );
  const cues = input.presentation.cues.map((cue) => {
    const mutation = mutationByCueId.get(cue.id);
    return mutation === undefined
      ? cue
      : { ...cue, start: mutation.afterStart, end: mutation.afterEnd };
  });
  const overlapDecisions = input.presentation.artifact.overlapDecisions.map(
    (decision) => {
      const component = componentsByDecisionId.get(decision.decisionId);
      if (component === undefined) return decision;
      const enforced = input.mode === "enforce";
      return {
        ...decision,
        relationship:
          enforced && !component.blocking
            ? component.finalRelationship
            : decision.relationship,
        recommendedAction:
          enforced && !component.blocking
            ? component.recommendedAction
            : decision.recommendedAction,
        safeAutomaticAction:
          enforced && !component.blocking
            ? component.safeAutomaticAction
            : "none",
        timingMutations:
          enforced && !component.blocking
            ? component.timingMutations.map((mutation) => ({
                cueId: mutation.cueId,
                before: {
                  start: mutation.beforeStart,
                  end: mutation.beforeEnd,
                },
                after: {
                  start: mutation.afterStart,
                  end: mutation.afterEnd,
                },
                boundarySource:
                  mutation.boundarySource === "pause" ||
                  mutation.boundarySource === "decoded-segment"
                    ? ("speech" as const)
                    : mutation.boundarySource === "trusted-mapped-token" ||
                        mutation.boundarySource === "trusted-no-vad-token"
                      ? ("token" as const)
                      : mutation.boundarySource === "raw-vad"
                        ? ("vad" as const)
                        : mutation.boundarySource === "source-cue"
                          ? ("source" as const)
                          : mutation.boundarySource,
              }))
            : [],
        assEventOverrides:
          enforced && !component.blocking ? component.assEventOverrides : [],
        vttCueSettings:
          enforced && !component.blocking ? component.vttCueSettings : [],
        blocking: enforced ? component.blocking : true,
        reasons: [...new Set([...decision.reasons, ...component.reasons])],
        resolutionSource: "targeted-acoustic" as const,
        acousticEvidenceIds: [
          component.componentId,
          ...component.profileAttemptIds,
        ],
        classificationConfidence: component.classificationConfidence,
        counterfactualScores: Object.fromEntries(
          component.counterfactuals.map((value) => [
            value.hypothesis,
            value.score,
          ]),
        ),
      } satisfies OverlapDecision;
    },
  );
  const displayTextByCueId = new Map(input.presentation.displayTextByCueId);
  const assEventOverridesByCueId = new Map(
    input.presentation.assEventOverridesByCueId,
  );
  const vttCueSettingsByCueId = new Map(
    input.presentation.vttCueSettingsByCueId,
  );
  if (input.mode === "enforce") {
    for (const component of input.acoustic.components.filter(
      (value) => !value.blocking,
    )) {
      for (const event of component.assEventOverrides) {
        assEventOverridesByCueId.set(event.cueId, {
          layer: event.layer,
          ...(event.alignment === null ? {} : { alignment: event.alignment }),
          ...(event.marginLeft === null
            ? {}
            : { marginLeft: event.marginLeft }),
          ...(event.marginRight === null
            ? {}
            : { marginRight: event.marginRight }),
          ...(event.marginVertical === null
            ? {}
            : { marginVertical: event.marginVertical }),
          ...(event.position === null ? {} : { position: event.position }),
        });
      }
      for (const setting of component.vttCueSettings) {
        vttCueSettingsByCueId.set(setting.cueId, setting.settings);
      }
    }
  }
  const canonicalCueHash = presentationResolutionHash(cues);
  const presentationCueHash = presentationResolutionHash({
    cues: cues.map((cue) => ({
      id: cue.id,
      start: cue.start,
      end: cue.end,
      canonicalText: cue.text,
      displayText: displayTextByCueId.get(cue.id) ?? cue.text,
    })),
    assEventOverrides: [...assEventOverridesByCueId.entries()],
    vttCueSettings: [...vttCueSettingsByCueId.entries()],
  });
  const cueById = new Map(cues.map((cue) => [cue.id, cue]));
  const decisionHasOverlap = (decision: OverlapDecision): boolean =>
    cuesContainOverlap(
      decision.cueIds.flatMap((cueId) => {
        const cue = cueById.get(cueId);
        return cue === undefined ? [] : [cue];
      }),
    );
  const serializedSrtContainsOverlap = cuesContainOverlap(cues);
  const legalSrtOverlapRenderingMayVary = overlapDecisions.some(
    (decision) => !decision.blocking && decisionHasOverlap(decision),
  );
  const unresolvedSrtOverlapPresent = overlapDecisions.some(
    (decision) => decision.blocking && decisionHasOverlap(decision),
  );
  const base = input.presentation.artifact;
  const artifact = subtitlePresentationResolutionSchema.parse({
    ...base,
    resolutionVersion: "C5.16",
    generatedAt: input.acoustic.generatedAt,
    canonicalCueHash,
    presentationCueHash,
    overlapDecisions,
    summary: {
      ...base.summary,
      overlapResolvedCount: overlapDecisions.filter(
        (decision) => !decision.blocking,
      ).length,
      overlapBlockingCount: overlapDecisions.filter(
        (decision) => decision.blocking,
      ).length,
      timingMutationCount: overlapDecisions.reduce(
        (sum, decision) => sum + decision.timingMutations.length,
        0,
      ),
      canonicalTimingMutationCount: mutationByCueId.size,
      reviewGroupCount:
        base.summary.layoutBlockingCount +
        base.summary.repetitionBlockingCount +
        overlapDecisions.filter((decision) => decision.blocking).length,
      serializedSrtContainsOverlap,
      legalSrtOverlapRenderingMayVary,
      unresolvedSrtOverlapPresent,
      srtOverlapRenderingMayVary: serializedSrtContainsOverlap,
    },
  });
  return {
    cues,
    artifact,
    displayTextByCueId,
    assEventOverridesByCueId,
    vttCueSettingsByCueId,
  };
}

export function buildSubtitleOverlapAcousticResolution(input: {
  generatedAt?: string;
  sourceFingerprint: SubtitleOverlapAcousticResolution["sourceFingerprint"];
  baseCueHash: string;
  basePresentationResolutionHash: string;
  mode: OverlapAcousticResolutionMode;
  audioStreamIndex: number;
  configuration?: Partial<OverlapAcousticConfiguration>;
  attempts: readonly OverlapAcousticAttempt[];
  components: readonly OverlapAcousticComponent[];
}): SubtitleOverlapAcousticResolution {
  const configuration: OverlapAcousticConfiguration = {
    ...DEFAULT_OVERLAP_ACOUSTIC_CONFIGURATION,
    ...input.configuration,
    scoringWeights: {
      ...DEFAULT_OVERLAP_ACOUSTIC_CONFIGURATION.scoringWeights,
      ...input.configuration?.scoringWeights,
    },
  };
  return subtitleOverlapAcousticResolutionSchema.parse({
    schemaVersion: "1.0.0",
    artifactType: "subtitle-overlap-acoustic-resolution",
    resolutionVersion: "C5.16",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    sourceFingerprint: input.sourceFingerprint,
    baseCueHash: input.baseCueHash,
    basePresentationResolutionHash: input.basePresentationResolutionHash,
    configuration: {
      mode: input.mode,
      audioStreamIndex: input.audioStreamIndex,
      ...configuration,
    },
    attempts: input.attempts,
    components: input.components,
    summary: {
      componentCount: input.components.length,
      cueCount: new Set(
        input.components.flatMap((component) => component.cueIds),
      ).size,
      audioExtractedCount: input.components.filter(
        (component) => component.audioPath !== null,
      ).length,
      audioFullyCoveredCount: input.components.filter(
        (component) => component.audioFullyCoversComponent,
      ).length,
      profileAttemptCount: input.attempts.length,
      asrRequestCount: input.attempts.filter((attempt) => !attempt.cacheHit)
        .length,
      cacheHitCount: input.attempts.filter((attempt) => attempt.cacheHit)
        .length,
      resolvedCount: input.components.filter((component) => !component.blocking)
        .length,
      timingOnlyResolvedCount: input.components.filter(
        (component) =>
          !component.blocking &&
          component.safeAutomaticAction === "timing-only",
      ).length,
      legalOverlapResolvedCount: input.components.filter(
        (component) =>
          !component.blocking &&
          component.safeAutomaticAction === "presentation-only",
      ).length,
      unresolvedCount: input.components.filter(
        (component) => component.blocking,
      ).length,
      timingMutationCount: input.components.reduce(
        (sum, component) => sum + component.timingMutations.length,
        0,
      ),
      canonicalTextMutationCount: 0,
      wholeMediaAsrRequestCount: 0,
      midpointRepairCount: 0,
      characterRatioRepairCount: 0,
      trustedTokenCount: input.attempts.reduce(
        (sum, attempt) =>
          sum +
          attempt.tokens.filter((token) => token.timingUsable === true).length,
        0,
      ),
      quarantinedTokenCount: input.attempts.reduce(
        (sum, attempt) =>
          sum +
          attempt.tokens.filter(
            (token) =>
              token.textUsable !== false && token.timingUsable === false,
          ).length,
        0,
      ),
      untrustedTokenUsedForTimingCount: 0,
    },
  });
}

export function parseSubtitleOverlapAcousticResolution(
  value: unknown,
): SubtitleOverlapAcousticResolution {
  return subtitleOverlapAcousticResolutionSchema.parse(value);
}
