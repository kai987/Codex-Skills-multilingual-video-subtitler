export interface TimingInterval {
  start: number;
  end: number;
}

export interface TimingQaConfig {
  longDurationWarningSeconds: number;
  longDurationHighRiskSeconds: number;
  shortTextCharacters: number;
  veryLowCps: number;
  veryLowCpsMinimumDurationSeconds: number;
  suspiciousLeadingSilenceSeconds: number;
  suspiciousTrailingSilenceSeconds: number;
  highRiskSpeechRatio: number;
  vadNoVadBoundaryDisagreementSeconds: number;
  dialogueTailSeconds: number;
  refinementContextSeconds: number;
  maximumPresentationCueSeconds: number;
}

export const DEFAULT_TIMING_QA_CONFIG: Readonly<TimingQaConfig> = {
  longDurationWarningSeconds: 8,
  longDurationHighRiskSeconds: 12,
  shortTextCharacters: 5,
  veryLowCps: 1,
  veryLowCpsMinimumDurationSeconds: 5,
  suspiciousLeadingSilenceSeconds: 1.5,
  suspiciousTrailingSilenceSeconds: 1.5,
  highRiskSpeechRatio: 0.3,
  vadNoVadBoundaryDisagreementSeconds: 1.25,
  dialogueTailSeconds: 0.2,
  refinementContextSeconds: 5,
  maximumPresentationCueSeconds: 8,
};

export type TimestampAnomalyBand =
  "pass" | "suspicious" | "auto-refine" | "mandatory-refine";

export interface AcousticCoverage {
  speechStart: number | null;
  speechEnd: number | null;
  leadingSilenceSeconds: number | null;
  trailingSilenceSeconds: number | null;
  speechDurationSeconds: number;
  speechRatio: number;
  maxInternalSilenceSeconds: number;
}

export function countVisibleSubtitleCharacters(text: string): number {
  return Array.from(
    text
      .replace(/\{\\[^}]*\}/gu, "")
      .replace(/<\/?[^>]+>/gu, "")
      .replace(/^♪\s*|\s*♪$/gu, "")
      .replace(/\\[Nn]/gu, "")
      .replace(/\s/gu, ""),
  ).length;
}

export function measureAcousticCoverage(
  cue: TimingInterval,
  speechIntervals: readonly TimingInterval[],
): AcousticCoverage {
  const clipped = speechIntervals
    .map((interval) => ({
      start: Math.max(cue.start, interval.start),
      end: Math.min(cue.end, interval.end),
    }))
    .filter((interval) => interval.end > interval.start)
    .toSorted((left, right) => left.start - right.start);
  const merged: TimingInterval[] = [];
  for (const interval of clipped) {
    const previous = merged.at(-1);
    if (previous !== undefined && interval.start <= previous.end) {
      previous.end = Math.max(previous.end, interval.end);
    } else {
      merged.push({ ...interval });
    }
  }
  const duration = Math.max(0, cue.end - cue.start);
  const speechDurationSeconds = merged.reduce(
    (sum, interval) => sum + interval.end - interval.start,
    0,
  );
  const speechStart = merged[0]?.start ?? null;
  const speechEnd = merged.at(-1)?.end ?? null;
  let maxInternalSilenceSeconds = 0;
  for (let index = 1; index < merged.length; index += 1) {
    const previous = merged[index - 1];
    const current = merged[index];
    if (previous !== undefined && current !== undefined) {
      maxInternalSilenceSeconds = Math.max(
        maxInternalSilenceSeconds,
        current.start - previous.end,
      );
    }
  }
  return {
    speechStart,
    speechEnd,
    leadingSilenceSeconds:
      speechStart === null ? null : Math.max(0, speechStart - cue.start),
    trailingSilenceSeconds:
      speechEnd === null ? null : Math.max(0, cue.end - speechEnd),
    speechDurationSeconds,
    speechRatio:
      duration <= 0 ? 0 : Math.min(1, speechDurationSeconds / duration),
    maxInternalSilenceSeconds,
  };
}

export interface TimingAnomalyInput {
  durationSeconds: number;
  visibleCharacters: number;
  charactersPerSecond: number | null;
  acoustic: AcousticCoverage;
  overlapAnomaly?: boolean;
  invalidTimestamp?: boolean;
  vadNoVadBoundaryDisagreement?: boolean;
  chunkBoundaryConflict?: boolean;
  presentationTimingEstimate?: boolean;
}

export interface TimingAnomalyAssessment {
  score: number;
  band: TimestampAnomalyBand;
  reasons: string[];
}

function anomalyBand(score: number): TimestampAnomalyBand {
  if (score >= 80) return "mandatory-refine";
  if (score >= 60) return "auto-refine";
  if (score >= 30) return "suspicious";
  return "pass";
}

export function assessTimingAnomaly(
  input: TimingAnomalyInput,
  config: TimingQaConfig = DEFAULT_TIMING_QA_CONFIG,
): TimingAnomalyAssessment {
  const reasons: string[] = [];
  let score = 0;
  if (input.invalidTimestamp === true) {
    reasons.push("WHISPER_TIMESTAMP_ANOMALY");
    score += 100;
  }
  if (input.overlapAnomaly === true) {
    reasons.push("POSTPROCESS_TIMING_DRIFT");
    score += 45;
  }
  if (input.durationSeconds > config.longDurationWarningSeconds) {
    reasons.push("EXCESSIVE_DURATION");
    score +=
      input.durationSeconds > config.longDurationHighRiskSeconds ? 60 : 30;
  }
  if (
    input.visibleCharacters <= config.shortTextCharacters &&
    input.durationSeconds > config.longDurationWarningSeconds
  ) {
    reasons.push("SHORT_TEXT_LONG_INTERVAL");
    score += 45;
  }
  if (
    input.charactersPerSecond !== null &&
    input.durationSeconds >= config.veryLowCpsMinimumDurationSeconds &&
    input.charactersPerSecond < config.veryLowCps
  ) {
    reasons.push("VERY_LOW_CPS", "LOW_TEXT_DENSITY");
    score += 40;
  }
  if (
    input.acoustic.leadingSilenceSeconds !== null &&
    input.acoustic.leadingSilenceSeconds >
      config.suspiciousLeadingSilenceSeconds
  ) {
    reasons.push("WHISPER_START_TOO_EARLY", "VAD_BOUNDARY_TOO_WIDE");
    score += 35;
  }
  if (
    input.acoustic.trailingSilenceSeconds !== null &&
    input.acoustic.trailingSilenceSeconds >
      config.suspiciousTrailingSilenceSeconds
  ) {
    reasons.push("WHISPER_END_TOO_LATE", "VAD_BOUNDARY_TOO_WIDE");
    score += 35;
  }
  if (
    input.acoustic.speechStart !== null &&
    input.acoustic.speechRatio < config.highRiskSpeechRatio
  ) {
    reasons.push("VAD_OVERMERGE", "VAD_NON_SPEECH_CONTAMINATION");
    score += 60;
  }
  if (input.vadNoVadBoundaryDisagreement === true) {
    reasons.push("VAD_NO_VAD_BOUNDARY_DISAGREEMENT", "VAD_OVERMERGE");
    score += 80;
  }
  if (input.chunkBoundaryConflict === true) {
    reasons.push("CHUNK_BOUNDARY_CONFLICT", "CROSS_CHUNK_UTTERANCE");
    score += 60;
  }
  if (input.presentationTimingEstimate === true) {
    reasons.push(
      "PRESENTATION_SPLIT_TIMING_ESTIMATE",
      "SPLIT_BOUNDARY_NOT_SPEECH_ALIGNED",
    );
    score += 35;
  }
  const boundedScore = Math.min(100, score);
  return {
    score: boundedScore,
    band: anomalyBand(boundedScore),
    reasons: [...new Set(reasons)],
  };
}

export function alignDialogueInterval(input: {
  speechStart: number;
  speechEnd: number;
  nextCueStart?: number;
  mediaDuration?: number;
  config?: TimingQaConfig;
}): TimingInterval {
  const config = input.config ?? DEFAULT_TIMING_QA_CONFIG;
  const maximumEnd = Math.min(
    input.nextCueStart ?? Number.POSITIVE_INFINITY,
    input.mediaDuration ?? Number.POSITIVE_INFINITY,
  );
  const start = Math.max(0, input.speechStart);
  const requestedEnd = input.speechEnd + config.dialogueTailSeconds;
  return {
    start,
    end: Math.max(start + 0.001, Math.min(requestedEnd, maximumEnd)),
  };
}
