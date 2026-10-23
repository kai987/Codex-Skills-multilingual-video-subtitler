import { createHash } from "node:crypto";

import {
  winnerTimingRepairArtifactSchema,
  type ReferenceTimelineArtifact,
  type SubtitleCue,
  type WinnerTimingRepairArtifact,
} from "@mvl/shared";

export interface WinnerTimingRepairResult {
  cues: SubtitleCue[];
  artifact: WinnerTimingRepairArtifact;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalized(value: string): string {
  return value.normalize("NFKC").replace(/[♪\s、。，．,.!?！？…]/gu, "");
}

function bigramSimilarity(left: string, right: string): number {
  const make = (value: string) => {
    const characters = Array.from(normalized(value));
    return new Set(
      characters.length < 2
        ? characters
        : characters
            .slice(0, -1)
            .map((char, index) => `${char}${characters[index + 1] ?? ""}`),
    );
  };
  const leftSet = make(left);
  const rightSet = make(right);
  const common = [...leftSet].filter((entry) => rightSet.has(entry)).length;
  return (2 * common) / Math.max(1, leftSet.size + rightSet.size);
}

function timingQuality(cue: SubtitleCue): number {
  const duration = cue.end - cue.start;
  const characters = Math.max(1, Array.from(normalized(cue.text)).length);
  const plausible =
    duration >= 0.4 &&
    duration <= 12 &&
    characters / Math.max(0.001, duration) <= 16;
  const speechStart = cue.timingEvidence?.speechStart ?? null;
  const speechEnd = cue.timingEvidence?.speechEnd ?? null;
  return (
    (cue.timingEvidence?.tokenTimestampsUsed === true ? 5 : 0) +
    ((cue.timingEvidence?.tokens.length ?? 0) > 0 ? 2 : 0) +
    (speechStart !== null && speechEnd !== null ? 2 : 0) +
    ((cue.timingEvidence?.speechIntervals?.length ?? 0) > 0 ? 1 : 0) +
    (plausible ? 2 : 0)
  );
}

function timingSuspicious(cue: SubtitleCue): boolean {
  const duration = cue.end - cue.start;
  const characters = Array.from(normalized(cue.text)).length;
  return (
    duration <= 0 ||
    (duration < 0.4 && characters > 5) ||
    ((cue.style === undefined || cue.style === "default") && duration > 12) ||
    characters / Math.max(0.001, duration) > 16
  );
}

function tokenInterval(
  cue: SubtitleCue,
): { start: number; end: number } | null {
  const tokens = (cue.timingEvidence?.tokens ?? [])
    .filter((token) => token.text.trim() !== "" && token.end > token.start)
    .toSorted(
      (left, right) => left.start - right.start || left.end - right.end,
    );
  const first = tokens[0];
  const last = tokens.at(-1);
  return first === undefined || last === undefined
    ? null
    : { start: first.start, end: last.end };
}

function speechInterval(
  cue: SubtitleCue,
): { start: number; end: number } | null {
  const start = cue.timingEvidence?.speechStart;
  const end = cue.timingEvidence?.speechEnd;
  if (
    start !== null &&
    start !== undefined &&
    end !== null &&
    end !== undefined &&
    end > start
  ) {
    return { start, end };
  }
  const intervals = (cue.timingEvidence?.speechIntervals ?? [])
    .filter((interval) => interval.end > interval.start)
    .toSorted(
      (left, right) => left.start - right.start || left.end - right.end,
    );
  const first = intervals[0];
  const last = intervals.at(-1);
  return first === undefined || last === undefined
    ? null
    : { start: first.start, end: last.end };
}

function referenceInterval(
  cue: SubtitleCue,
  timeline: ReferenceTimelineArtifact | undefined,
): { start: number; end: number } | null {
  if (timeline === undefined) return null;
  const ids = new Set(cue.provenance?.referenceAnchorIds ?? []);
  if (ids.size === 0) return null;
  const anchors = timeline.anchors.filter(
    (anchor) => ids.has(anchor.id) && anchor.timingTrusted,
  );
  if (anchors.length === 0) return null;
  return {
    start: Math.min(...anchors.map((anchor) => anchor.interval.start)),
    end: Math.max(...anchors.map((anchor) => anchor.interval.end)),
  };
}

export function repairTopScoreWinnerTiming(input: {
  cues: readonly SubtitleCue[];
  equivalentCandidates?: readonly SubtitleCue[];
  referenceTimeline?: ReferenceTimelineArtifact;
}): WinnerTimingRepairResult {
  const candidates = input.equivalentCandidates ?? input.cues;
  const repairs: WinnerTimingRepairArtifact["repairs"] = [];
  let unresolvedTimingCount = 0;
  const cues = input.cues.map((cue) => {
    if (!timingSuspicious(cue)) return cue;
    const ownTokens = tokenInterval(cue);
    const ownSpeech = speechInterval(cue);
    const donor = candidates
      .filter(
        (candidate) =>
          candidate.id !== cue.id &&
          (normalized(candidate.text) === normalized(cue.text) ||
            bigramSimilarity(candidate.text, cue.text) >= 0.9) &&
          !timingSuspicious(candidate),
      )
      .toSorted(
        (left, right) =>
          timingQuality(right) - timingQuality(left) ||
          left.id.localeCompare(right.id),
      )[0];
    const donorTokens = donor === undefined ? null : tokenInterval(donor);
    const donorSpeech = donor === undefined ? null : speechInterval(donor);
    const reference = referenceInterval(cue, input.referenceTimeline);
    const donorInterval =
      donor === undefined ? reference : { start: donor.start, end: donor.end };
    const selected =
      ownTokens ?? donorTokens ?? ownSpeech ?? donorSpeech ?? donorInterval;
    const method: WinnerTimingRepairArtifact["repairs"][number]["timingRepairMethod"] =
      ownTokens !== null
        ? "winner-token"
        : donorTokens !== null
          ? "equivalent-candidate-token"
          : ownSpeech !== null
            ? (cue.timingEvidence?.speechIntervals?.length ?? 0) > 0
              ? "speech-interval"
              : "speech-boundary"
            : donorSpeech !== null
              ? (donor?.timingEvidence?.speechIntervals?.length ?? 0) > 0
                ? "speech-interval"
                : "speech-boundary"
              : donor !== undefined
                ? "equivalent-candidate-interval"
                : reference !== null
                  ? "reference-anchor"
                  : "unchanged";
    if (selected === null || selected.end <= selected.start) {
      unresolvedTimingCount += 1;
      repairs.push({
        id: `winner-timing-repair-${String(repairs.length + 1).padStart(5, "0")}`,
        textWinnerCueId: cue.id,
        timingDonorCueId: null,
        before: { start: cue.start, end: cue.end },
        after: { start: cue.start, end: cue.end },
        timingRepairMethod: "unchanged",
        textChanged: false,
        reasons: ["suspicious-timing-has-no-supported-repair-evidence"],
      });
      return {
        ...cue,
        textAudit: {
          rawAsrText: cue.textAudit?.rawAsrText ?? cue.text,
          repairedText: cue.textAudit?.repairedText ?? cue.text,
          normalizedText: cue.textAudit?.normalizedText ?? cue.text,
          winnerClusterIds: cue.textAudit?.winnerClusterIds ?? [],
          sourceWinnerCueIds: cue.textAudit?.sourceWinnerCueIds ?? [cue.id],
          replacements: cue.textAudit?.replacements ?? [],
          deduplicationActions: cue.textAudit?.deduplicationActions ?? [],
          reviewRecommended: true,
          reviewReasons: [
            ...new Set([
              ...(cue.textAudit?.reviewReasons ?? []),
              "TIMING_REPAIR_UNRESOLVED",
            ]),
          ],
        },
      };
    }
    const timingDonorCueId =
      method === "equivalent-candidate-token" ||
      method === "equivalent-candidate-interval" ||
      (ownSpeech === null && donorSpeech !== null)
        ? (donor?.id ?? null)
        : null;
    const repaired: SubtitleCue = {
      ...cue,
      start: selected.start,
      end: selected.end,
      ...(timingDonorCueId === null || donor?.timingEvidence === undefined
        ? {}
        : { timingEvidence: donor.timingEvidence }),
      textAudit: {
        rawAsrText: cue.textAudit?.rawAsrText ?? cue.text,
        repairedText: cue.textAudit?.repairedText ?? cue.text,
        normalizedText: cue.textAudit?.normalizedText ?? cue.text,
        winnerClusterIds: cue.textAudit?.winnerClusterIds ?? [],
        sourceWinnerCueIds: cue.textAudit?.sourceWinnerCueIds ?? [cue.id],
        ...(cue.textAudit?.winnerScore === undefined
          ? {}
          : { winnerScore: cue.textAudit.winnerScore }),
        ...(cue.textAudit?.runnerUpCueId === undefined
          ? {}
          : { runnerUpCueId: cue.textAudit.runnerUpCueId }),
        ...(cue.textAudit?.runnerUpScore === undefined
          ? {}
          : { runnerUpScore: cue.textAudit.runnerUpScore }),
        ...(cue.textAudit?.scoreGap === undefined
          ? {}
          : { scoreGap: cue.textAudit.scoreGap }),
        replacements: cue.textAudit?.replacements ?? [],
        deduplicationActions: cue.textAudit?.deduplicationActions ?? [],
        timingDonorCueId,
        timingRepairMethod: method,
        reviewRecommended: true,
        reviewReasons: [
          ...new Set([
            ...(cue.textAudit?.reviewReasons ?? []),
            "WINNER_TIMING_REPAIRED",
          ]),
        ],
      },
    };
    repairs.push({
      id: `winner-timing-repair-${String(repairs.length + 1).padStart(5, "0")}`,
      textWinnerCueId: cue.id,
      timingDonorCueId,
      before: { start: cue.start, end: cue.end },
      after: { start: repaired.start, end: repaired.end },
      timingRepairMethod: method,
      textChanged: false,
      reasons: [
        "top-score-text-preserved",
        `timing-evidence:${method}`,
        "character-ratio-timing-disabled",
      ],
    });
    return repaired;
  });
  const artifact = winnerTimingRepairArtifactSchema.parse({
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    inputHash: hash(input.cues),
    characterRatioTimingAllowed: false,
    repairs,
    summary: {
      repairCount: repairs.filter(
        (repair) => repair.timingRepairMethod !== "unchanged",
      ).length,
      timingDonorCount: repairs.filter(
        (repair) => repair.timingDonorCueId !== null,
      ).length,
      unresolvedTimingCount,
    },
  });
  return {
    cues: cues.toSorted(
      (left, right) =>
        left.start - right.start ||
        left.end - right.end ||
        left.id.localeCompare(right.id),
    ),
    artifact,
  };
}
