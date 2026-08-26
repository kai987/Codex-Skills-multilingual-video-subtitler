import {
  speakerEvidenceAttemptSchema,
  speakerEvidenceComponentSchema,
  subtitleLocalSpeakerEvidenceSchema,
  type SpeakerDeviceUsed,
  type SpeakerEvidenceAttempt,
  type SpeakerEvidenceComponent,
  type SpeakerEvidenceMode,
  type SpeakerWindowType,
  type SubtitleLocalSpeakerEvidence,
  type SubtitleReviewPackage,
} from "@mvl/shared";

import { sha256Value } from "./finalization-support.js";
import type { RawSpeakerInference, RawSpeakerTurn } from "./speaker-runtime.js";

export const SPEAKER_EVIDENCE_POLICY_VERSION =
  "c5.18-local-speaker-evidence-v1" as const;
export const SPEAKER_NORMALIZATION_POLICY =
  "component-local-first-activity-duration-label-v1" as const;
export const SPEAKER_WINDOW_MAPPING_POLICY =
  "permutation-invariant-temporal-iou-assignment-v1" as const;
export const SPEAKER_OVERLAP_POLICY =
  "standard-distinct-track-cross-window-iou-v1" as const;
export const SPEAKER_PROMINENCE_POLICY =
  "exclusive-non-overlap-rms-uncalibrated-v1" as const;
export const SPEAKER_CUE_ASSIGNMENT_POLICY =
  "anti-forcing-lexical-window-exclusive-coverage-v1" as const;
export const SPEAKER_RELATIONSHIP_POLICY =
  "speaker-window-stable-evidence-conservative-v1" as const;

export const SPEAKER_EVIDENCE_POLICY_HASH = sha256Value({
  policyVersion: SPEAKER_EVIDENCE_POLICY_VERSION,
  normalization: SPEAKER_NORMALIZATION_POLICY,
  windowMapping: SPEAKER_WINDOW_MAPPING_POLICY,
  overlap: SPEAKER_OVERLAP_POLICY,
  prominence: SPEAKER_PROMINENCE_POLICY,
  cueAssignment: SPEAKER_CUE_ASSIGNMENT_POLICY,
  relationship: SPEAKER_RELATIONSHIP_POLICY,
});

export interface RawSpeakerAttemptInput {
  componentId: string;
  windowType: "context" | "union";
  audioPath: string;
  audioSha256: string;
  audioLocalInterval: { start: number; end: number };
  mediaGlobalInterval: { start: number; end: number };
  runtimeIdentityHash: string;
  modelSnapshotHash: string;
  device: SpeakerDeviceUsed;
  minSpeakers: number;
  maxSpeakers: number;
  cacheHit: boolean;
  inference: RawSpeakerInference;
}

export interface SpeakerPcmWindow {
  samples: Int16Array;
  sampleRate: 16_000;
  mediaStart: number;
}

interface LocalTurn extends RawSpeakerTurn {
  source: "standard" | "exclusive";
  startGlobal: number;
  endGlobal: number;
}

interface PreparedAttempt {
  input: RawSpeakerAttemptInput;
  rawTurns: LocalTurn[];
  standardLabels: string[];
  exclusiveLabels: string[];
  allLabels: string[];
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function roundTime(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function duration(interval: { start: number; end: number }): number {
  return Math.max(0, interval.end - interval.start);
}

function intersection(
  left: { start: number; end: number },
  right: { start: number; end: number },
): number {
  return Math.max(
    0,
    Math.min(left.end, right.end) - Math.max(left.start, right.start),
  );
}

function mergeIntervals(
  values: readonly { start: number; end: number }[],
): { start: number; end: number }[] {
  const sorted = values
    .filter((value) => value.end > value.start)
    .map((value) => ({ start: value.start, end: value.end }))
    .toSorted(
      (left, right) => left.start - right.start || left.end - right.end,
    );
  const merged: { start: number; end: number }[] = [];
  for (const value of sorted) {
    const previous = merged.at(-1);
    if (previous === undefined || value.start > previous.end + 0.000_001) {
      merged.push(value);
    } else {
      previous.end = Math.max(previous.end, value.end);
    }
  }
  return merged;
}

function intervalSetDuration(
  values: readonly { start: number; end: number }[],
) {
  return mergeIntervals(values).reduce(
    (sum, value) => sum + duration(value),
    0,
  );
}

function intervalSetIntersection(
  left: readonly { start: number; end: number }[],
  right: readonly { start: number; end: number }[],
): number {
  const leftMerged = mergeIntervals(left);
  const rightMerged = mergeIntervals(right);
  let total = 0;
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < leftMerged.length && rightIndex < rightMerged.length) {
    const leftValue = leftMerged[leftIndex];
    const rightValue = rightMerged[rightIndex];
    if (leftValue === undefined || rightValue === undefined) break;
    total += intersection(leftValue, rightValue);
    if (leftValue.end <= rightValue.end) leftIndex += 1;
    else rightIndex += 1;
  }
  return total;
}

function intervalSetIoU(
  left: readonly { start: number; end: number }[],
  right: readonly { start: number; end: number }[],
): number {
  const overlap = intervalSetIntersection(left, right);
  const union =
    intervalSetDuration(left) + intervalSetDuration(right) - overlap;
  return union <= 0 ? 1 : clamp(overlap / union);
}

function prepareAttempt(input: RawSpeakerAttemptInput): PreparedAttempt {
  const toTurns = (
    turns: readonly RawSpeakerTurn[],
    source: "standard" | "exclusive",
  ): LocalTurn[] =>
    turns
      .filter(
        (turn) =>
          Number.isFinite(turn.start) &&
          Number.isFinite(turn.end) &&
          turn.end > turn.start,
      )
      .map((turn) => ({
        ...turn,
        source,
        startGlobal: input.mediaGlobalInterval.start + turn.start,
        endGlobal: input.mediaGlobalInterval.start + turn.end,
      }));
  const standard = toTurns(input.inference.standardTurns, "standard");
  const exclusive = toTurns(input.inference.exclusiveTurns, "exclusive");
  return {
    input,
    rawTurns: [...standard, ...exclusive],
    standardLabels: [...new Set(standard.map((turn) => turn.speaker))],
    exclusiveLabels: [...new Set(exclusive.map((turn) => turn.speaker))],
    allLabels: [
      ...new Set([...standard, ...exclusive].map((turn) => turn.speaker)),
    ],
  };
}

function rawLabelOrder(attempt: PreparedAttempt): string[] {
  return attempt.allLabels.toSorted((left, right) => {
    const values = (label: string) => {
      const turns = attempt.rawTurns.filter(
        (turn) => turn.speaker === label && turn.source === "standard",
      );
      const fallback = attempt.rawTurns.filter(
        (turn) => turn.speaker === label,
      );
      const selected = turns.length === 0 ? fallback : turns;
      return {
        first: Math.min(...selected.map((turn) => turn.startGlobal)),
        duration: selected.reduce(
          (sum, turn) => sum + (turn.endGlobal - turn.startGlobal),
          0,
        ),
      };
    };
    const leftValues = values(left);
    const rightValues = values(right);
    return (
      leftValues.first - rightValues.first ||
      rightValues.duration - leftValues.duration ||
      left.localeCompare(right)
    );
  });
}

function anonymousLabel(
  componentId: string,
  windowType: SpeakerWindowType,
  index: number,
): string {
  const safeComponent = componentId.replace(/[^A-Za-z0-9_-]/gu, "-");
  const windowMarker = windowType === "context" ? "" : "-union";
  return `component-${safeComponent}${windowMarker}-speaker-${String(index + 1).padStart(2, "0")}`;
}

function activity(
  attempt: PreparedAttempt,
  rawLabel: string,
  source: "standard" | "exclusive",
): { start: number; end: number }[] {
  return attempt.rawTurns
    .filter((turn) => turn.speaker === rawLabel && turn.source === source)
    .map((turn) => ({ start: turn.startGlobal, end: turn.endGlobal }));
}

function pairMappingScore(input: {
  context: PreparedAttempt;
  union: PreparedAttempt;
  contextLabel: string;
  unionLabel: string;
}): number {
  const standard = intervalSetIoU(
    activity(input.context, input.contextLabel, "standard"),
    activity(input.union, input.unionLabel, "standard"),
  );
  const exclusive = intervalSetIoU(
    activity(input.context, input.contextLabel, "exclusive"),
    activity(input.union, input.unionLabel, "exclusive"),
  );
  return clamp(standard * 0.65 + exclusive * 0.35);
}

function bestPermutationMapping(input: {
  context: PreparedAttempt;
  union: PreparedAttempt;
}): {
  pairs: { contextRaw: string; unionRaw: string; score: number }[];
  ambiguous: boolean;
} {
  const contextLabels = rawLabelOrder(input.context);
  const unionLabels = rawLabelOrder(input.union);
  const pairCount = Math.min(contextLabels.length, unionLabels.length);
  let best:
    | {
        pairs: { contextRaw: string; unionRaw: string; score: number }[];
        total: number;
      }
    | undefined;
  let secondTotal = Number.NEGATIVE_INFINITY;
  const visit = (
    index: number,
    usedContext: Set<string>,
    pairs: { contextRaw: string; unionRaw: string; score: number }[],
  ): void => {
    if (index >= unionLabels.length || pairs.length === pairCount) {
      const total = pairs.reduce((sum, pair) => sum + pair.score, 0);
      const signature = pairs
        .map((pair) => `${pair.contextRaw}:${pair.unionRaw}`)
        .join("|");
      const bestSignature =
        best?.pairs
          .map((pair) => `${pair.contextRaw}:${pair.unionRaw}`)
          .join("|") ?? "";
      if (
        best === undefined ||
        total > best.total + 0.000_001 ||
        (Math.abs(total - best.total) <= 0.000_001 &&
          signature.localeCompare(bestSignature) < 0)
      ) {
        if (best !== undefined) secondTotal = Math.max(secondTotal, best.total);
        best = { pairs: [...pairs], total };
      } else {
        secondTotal = Math.max(secondTotal, total);
      }
      return;
    }
    const unionRaw = unionLabels[index];
    if (unionRaw === undefined) return;
    for (const contextRaw of contextLabels) {
      if (usedContext.has(contextRaw)) continue;
      usedContext.add(contextRaw);
      pairs.push({
        contextRaw,
        unionRaw,
        score: pairMappingScore({
          ...input,
          contextLabel: contextRaw,
          unionLabel: unionRaw,
        }),
      });
      visit(index + 1, usedContext, pairs);
      pairs.pop();
      usedContext.delete(contextRaw);
    }
    if (unionLabels.length > contextLabels.length)
      visit(index + 1, usedContext, pairs);
  };
  visit(0, new Set(), []);
  return {
    pairs: best?.pairs ?? [],
    ambiguous:
      best !== undefined &&
      Number.isFinite(secondTotal) &&
      best.total - secondTotal < 0.1,
  };
}

function modelOverlapIntervals(
  turns: readonly {
    speakerId: string;
    startMediaGlobal: number;
    endMediaGlobal: number;
    evidenceLineageId: string;
  }[],
): {
  interval: { start: number; end: number };
  activeSpeakerIds: string[];
  evidenceLineageIds: string[];
}[] {
  const intersections: {
    interval: { start: number; end: number };
    activeSpeakerIds: string[];
    evidenceLineageIds: string[];
  }[] = [];
  for (let leftIndex = 0; leftIndex < turns.length; leftIndex += 1) {
    const left = turns[leftIndex];
    if (left === undefined) continue;
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < turns.length;
      rightIndex += 1
    ) {
      const right = turns[rightIndex];
      if (right === undefined || left.speakerId === right.speakerId) continue;
      const start = Math.max(left.startMediaGlobal, right.startMediaGlobal);
      const end = Math.min(left.endMediaGlobal, right.endMediaGlobal);
      if (end - start < 0.02) continue;
      intersections.push({
        interval: { start, end },
        activeSpeakerIds: [left.speakerId, right.speakerId].toSorted(),
        evidenceLineageIds: [
          left.evidenceLineageId,
          right.evidenceLineageId,
        ].toSorted(),
      });
    }
  }
  return intersections.toSorted(
    (left, right) => left.interval.start - right.interval.start,
  );
}

function attemptChangePoints(
  turns: readonly {
    speakerId: string;
    startMediaGlobal: number;
    endMediaGlobal: number;
  }[],
): number[] {
  const sorted = [...turns].toSorted(
    (left, right) =>
      left.startMediaGlobal - right.startMediaGlobal ||
      left.endMediaGlobal - right.endMediaGlobal,
  );
  const changes: number[] = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (
      previous !== undefined &&
      current !== undefined &&
      previous.speakerId !== current.speakerId
    ) {
      changes.push(roundTime(current.startMediaGlobal));
    }
  }
  return [...new Set(changes)];
}

function normalizedAttempt(input: {
  prepared: PreparedAttempt;
  labelMap: ReadonlyMap<string, string>;
}): SpeakerEvidenceAttempt {
  const standard = input.prepared.rawTurns.filter(
    (turn) => turn.source === "standard",
  );
  const provisional = (
    turns: readonly LocalTurn[],
    source: "standard" | "exclusive",
  ) =>
    turns.map((turn, index) => {
      const speakerId =
        input.labelMap.get(turn.speaker) ??
        anonymousLabel(
          input.prepared.input.componentId,
          input.prepared.input.windowType,
          input.labelMap.size + index,
        );
      return {
        turnId: `speaker-turn-${sha256Value({
          componentId: input.prepared.input.componentId,
          windowType: input.prepared.input.windowType,
          source,
          speakerId,
          start: turn.start,
          end: turn.end,
        }).slice(0, 20)}`,
        speakerId,
        startLocal: roundTime(turn.start),
        endLocal: roundTime(turn.end),
        startMediaGlobal: roundTime(turn.startGlobal),
        endMediaGlobal: roundTime(turn.endGlobal),
        source,
        overlapParticipant: false,
        evidenceLineageId: `speaker-lineage-${sha256Value({
          componentId: input.prepared.input.componentId,
          windowType: input.prepared.input.windowType,
          source,
          speakerId,
          start: turn.start,
          end: turn.end,
        }).slice(0, 20)}`,
      };
    });
  let standardTurns = provisional(standard, "standard");
  const overlap = modelOverlapIntervals(standardTurns);
  const overlapLineages = new Set(
    overlap.flatMap((value) => value.evidenceLineageIds),
  );
  standardTurns = standardTurns.map((turn) => ({
    ...turn,
    overlapParticipant: overlapLineages.has(turn.evidenceLineageId),
  }));
  const exclusiveTurns = provisional(
    input.prepared.rawTurns.filter((turn) => turn.source === "exclusive"),
    "exclusive",
  );
  const labels = [
    ...new Set(
      [...standardTurns, ...exclusiveTurns].map((turn) => turn.speakerId),
    ),
  ].toSorted();
  const attemptId = `speaker-attempt-${sha256Value({
    componentId: input.prepared.input.componentId,
    windowType: input.prepared.input.windowType,
    audioSha256: input.prepared.input.audioSha256,
    runtimeIdentityHash: input.prepared.input.runtimeIdentityHash,
    modelSnapshotHash: input.prepared.input.modelSnapshotHash,
  }).slice(0, 20)}`;
  const semanticBase = {
    attemptId,
    componentId: input.prepared.input.componentId,
    windowType: input.prepared.input.windowType,
    audioSha256: input.prepared.input.audioSha256,
    audioLocalInterval: input.prepared.input.audioLocalInterval,
    mediaGlobalInterval: input.prepared.input.mediaGlobalInterval,
    runtimeIdentityHash: input.prepared.input.runtimeIdentityHash,
    modelSnapshotHash: input.prepared.input.modelSnapshotHash,
    device: input.prepared.input.device,
    minSpeakers: input.prepared.input.minSpeakers,
    maxSpeakers: input.prepared.input.maxSpeakers,
    standardTurns,
    exclusiveTurns,
    speakerLabels: labels,
    overlapSpeechIntervals: overlap.map((value) => value.interval),
    speakerChangePoints: attemptChangePoints(exclusiveTurns),
    confidenceStatus: input.prepared.input.inference.confidenceStatus,
    failure: null,
    warnings: input.prepared.input.inference.warnings,
  };
  return speakerEvidenceAttemptSchema.parse({
    ...semanticBase,
    audioPath: input.prepared.input.audioPath,
    speakerCount: labels.length,
    wallClockSeconds: input.prepared.input.inference.wallClockSeconds,
    cacheHit: input.prepared.input.cacheHit,
    semanticHash: sha256Value(semanticBase),
  });
}

function changePointPairs(
  context: SpeakerEvidenceAttempt,
  union: SpeakerEvidenceAttempt,
  unionToContext: ReadonlyMap<string, string>,
) {
  const contextChanges = attemptChangePoints(context.exclusiveTurns);
  const mappedUnionTurns = union.exclusiveTurns.map((turn) => ({
    ...turn,
    speakerId: unionToContext.get(turn.speakerId) ?? turn.speakerId,
  }));
  const unionChanges = attemptChangePoints(mappedUnionTurns);
  const used = new Set<number>();
  return contextChanges.map((contextTime) => {
    let bestIndex = -1;
    let bestDifference = Number.POSITIVE_INFINITY;
    unionChanges.forEach((unionTime, index) => {
      if (used.has(index)) return;
      const difference = Math.abs(contextTime - unionTime);
      if (difference < bestDifference) {
        bestDifference = difference;
        bestIndex = index;
      }
    });
    const unionTime = bestIndex < 0 ? null : (unionChanges[bestIndex] ?? null);
    if (bestIndex >= 0) used.add(bestIndex);
    return {
      contextTime,
      unionTime,
      difference: unionTime === null ? null : Math.abs(contextTime - unionTime),
    };
  });
}

function assignmentWindow(
  item: SubtitleReviewPackage["items"][number],
  cueId: string,
): {
  interval: { start: number; end: number };
  source:
    | "forced-alignment-selected"
    | "mfa-lexical"
    | "evidence-dp"
    | "source-cue-prior";
  evidenceIds: string[];
} {
  const forced = item.forcedAlignmentEvidence?.cues.find(
    (cue) => cue.cueId === cueId,
  );
  const usableEvidence = (sourceType: "mfa-narrow" | "evidence-dp") =>
    item.boundaryEvidence.filter(
      (evidence) =>
        evidence.cueIds.includes(cueId) &&
        evidence.sourceType === sourceType &&
        evidence.timingUsable &&
        evidence.blockers.length === 0 &&
        (evidence.neighborIntrusionRatio ?? 0) <= 0.05 &&
        (evidence.trustScore ?? evidence.boundaryConfidence ?? 0) >= 0.65,
    );
  const rejected =
    forced?.antiForcingBlockers.some((blocker) =>
      /(?:UNSTABLE|UNAVAILABLE|FAILED|REJECT|PINNED|LOW_|OOV)/u.test(blocker),
    ) ?? true;
  if (
    forced?.suggestedTiming !== null &&
    forced?.suggestedTiming !== undefined &&
    !rejected &&
    forced.windowStabilityScore >= 0.75
  ) {
    return {
      interval: forced.suggestedTiming,
      source: "forced-alignment-selected",
      evidenceIds: item.boundaryEvidence
        .filter(
          (evidence) =>
            evidence.cueIds.includes(cueId) &&
            evidence.sourceType === "forced-alignment-selected",
        )
        .map((evidence) => evidence.evidenceLineageId),
    };
  }
  if (
    forced?.mfaNarrowBoundary !== null &&
    forced?.mfaNarrowBoundary !== undefined &&
    !rejected &&
    forced.wordCoverageRatio >= 0.8 &&
    usableEvidence("mfa-narrow").length > 0
  ) {
    return {
      interval: forced.mfaNarrowBoundary,
      source: "mfa-lexical",
      evidenceIds: item.boundaryEvidence
        .filter(
          (evidence) =>
            evidence.cueIds.includes(cueId) &&
            evidence.sourceType === "mfa-narrow",
        )
        .map((evidence) => evidence.evidenceLineageId),
    };
  }
  if (
    forced?.evidenceDpBoundary !== null &&
    forced?.evidenceDpBoundary !== undefined &&
    usableEvidence("evidence-dp").length > 0
  ) {
    return {
      interval: forced.evidenceDpBoundary,
      source: "evidence-dp",
      evidenceIds: item.boundaryEvidence
        .filter(
          (evidence) =>
            evidence.cueIds.includes(cueId) &&
            evidence.sourceType === "evidence-dp",
        )
        .map((evidence) => evidence.evidenceLineageId),
    };
  }
  const sourcePrior = item.boundaryEvidence.find(
    (evidence) =>
      evidence.cueIds.includes(cueId) &&
      evidence.sourceType === "source-cue-prior",
  );
  const cue = item.targetCueIds.indexOf(cueId);
  const fallback =
    sourcePrior?.interval ??
    (cue <= 0
      ? { start: item.currentStart, end: item.currentEnd }
      : item.interval);
  return {
    interval: fallback,
    source: "source-cue-prior",
    evidenceIds:
      sourcePrior === undefined ? [] : [sourcePrior.evidenceLineageId],
  };
}

function speakerCoverage(
  turns: readonly {
    speakerId: string;
    startMediaGlobal: number;
    endMediaGlobal: number;
  }[],
  interval: { start: number; end: number },
): Record<string, number> {
  const windowDuration = Math.max(0.001, duration(interval));
  const bySpeaker = new Map<string, { start: number; end: number }[]>();
  for (const turn of turns) {
    const clipped = {
      start: Math.max(interval.start, turn.startMediaGlobal),
      end: Math.min(interval.end, turn.endMediaGlobal),
    };
    if (clipped.end <= clipped.start) continue;
    const values = bySpeaker.get(turn.speakerId) ?? [];
    values.push(clipped);
    bySpeaker.set(turn.speakerId, values);
  }
  return Object.fromEntries(
    [...bySpeaker.entries()]
      .map(
        ([speaker, values]) =>
          [
            speaker,
            clamp(intervalSetDuration(values) / windowDuration),
          ] as const,
      )
      .toSorted(([left], [right]) => left.localeCompare(right)),
  );
}

function overlapCoverage(
  overlaps: readonly { interval: { start: number; end: number } }[],
  interval: { start: number; end: number },
): number {
  const clipped = overlaps
    .map((value) => ({
      start: Math.max(interval.start, value.interval.start),
      end: Math.min(interval.end, value.interval.end),
    }))
    .filter((value) => value.end > value.start);
  return clamp(
    intervalSetDuration(clipped) / Math.max(0.001, duration(interval)),
  );
}

function assignmentForCue(input: {
  cueId: string;
  item: SubtitleReviewPackage["items"][number];
  context: SpeakerEvidenceAttempt;
  union: SpeakerEvidenceAttempt;
  unionToContext: ReadonlyMap<string, string>;
  overlaps: readonly { interval: { start: number; end: number } }[];
  windowStable: boolean;
}) {
  const selectedWindow = assignmentWindow(input.item, input.cueId);
  const contextCoverage = speakerCoverage(
    input.context.exclusiveTurns,
    selectedWindow.interval,
  );
  const unionCoverage = speakerCoverage(
    input.union.exclusiveTurns.map((turn) => ({
      ...turn,
      speakerId: input.unionToContext.get(turn.speakerId) ?? turn.speakerId,
    })),
    selectedWindow.interval,
  );
  const combined = new Map<string, number>();
  for (const speaker of new Set([
    ...Object.keys(contextCoverage),
    ...Object.keys(unionCoverage),
  ])) {
    combined.set(
      speaker,
      ((contextCoverage[speaker] ?? 0) + (unionCoverage[speaker] ?? 0)) / 2,
    );
  }
  const ordered = [...combined.entries()].toSorted(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  );
  const dominant = ordered[0] ?? null;
  const runnerUp = ordered[1] ?? null;
  const agreement =
    dominant === null
      ? 0
      : 1 -
        Math.abs(
          (contextCoverage[dominant[0]] ?? 0) -
            (unionCoverage[dominant[0]] ?? 0),
        );
  const overlap = overlapCoverage(input.overlaps, selectedWindow.interval);
  const changeInside = [
    ...input.context.speakerChangePoints,
    ...input.union.speakerChangePoints,
  ].some(
    (time) =>
      time > selectedWindow.interval.start &&
      time < selectedWindow.interval.end,
  );
  const margin = Math.max(0, (dominant?.[1] ?? 0) - (runnerUp?.[1] ?? 0));
  let assignmentStatus:
    | "stable-single-speaker"
    | "stable-multi-speaker"
    | "ambiguous"
    | "unavailable" = "unavailable";
  const blockers: string[] = [];
  if (dominant === null) blockers.push("SPEAKER_ASSIGNMENT_UNAVAILABLE");
  else if (!input.windowStable) blockers.push("SPEAKER_WINDOW_UNSTABLE");
  else if (
    dominant[1] >= 0.55 &&
    runnerUp !== null &&
    runnerUp[1] >= 0.18 &&
    overlap >= 0.12 &&
    agreement >= 0.6
  ) {
    assignmentStatus = "stable-multi-speaker";
  } else if (dominant[1] >= 0.55 && margin >= 0.18 && agreement >= 0.6) {
    assignmentStatus = "stable-single-speaker";
  } else {
    assignmentStatus = "ambiguous";
    blockers.push("SPEAKER_ASSIGNMENT_MARGIN_INSUFFICIENT");
  }
  const lineages = [
    ...input.context.exclusiveTurns,
    ...input.union.exclusiveTurns,
  ]
    .filter(
      (turn) =>
        turn.endMediaGlobal > selectedWindow.interval.start &&
        turn.startMediaGlobal < selectedWindow.interval.end,
    )
    .map((turn) => turn.evidenceLineageId);
  return {
    cueId: input.cueId,
    assignmentWindow: selectedWindow.interval,
    assignmentWindowSource: selectedWindow.source,
    speakerCoverageByCluster: Object.fromEntries(combined),
    dominantSpeakerId: dominant?.[0] ?? null,
    dominantSpeakerCoverage: dominant?.[1] ?? 0,
    runnerUpSpeakerId: runnerUp?.[0] ?? null,
    runnerUpSpeakerCoverage: runnerUp?.[1] ?? 0,
    speakerAssignmentMargin: margin,
    speakerChangeInsideCue: changeInside,
    overlapSpeechCoverage: overlap,
    exclusiveTurnCoverage: clamp(
      Object.values(contextCoverage).reduce((sum, value) => sum + value, 0),
    ),
    contextUnionAgreement: clamp(agreement),
    assignmentStatus,
    evidenceLineageIds: [
      ...new Set([...selectedWindow.evidenceIds, ...lineages]),
    ],
    blockers,
  } as const;
}

function percentile(
  values: readonly number[],
  fraction: number,
): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].toSorted((left, right) => left - right);
  return (
    sorted[
      Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))
    ] ?? null
  );
}

function prominence(input: {
  speakerIds: readonly string[];
  context: SpeakerEvidenceAttempt;
  componentUnion: { start: number; end: number };
  overlaps: readonly { interval: { start: number; end: number } }[];
  assignments: readonly ReturnType<typeof assignmentForCue>[];
  pcm: SpeakerPcmWindow | undefined;
  mappedCoverageByCue: ReadonlyMap<string, number>;
}) {
  const preliminary: SpeakerEvidenceComponent["prominenceEvidence"] =
    input.speakerIds.map((speakerId) => {
      const turns = input.context.exclusiveTurns.filter(
        (turn) =>
          turn.speakerId === speakerId &&
          !input.overlaps.some(
            (overlap) =>
              intersection(overlap.interval, {
                start: turn.startMediaGlobal,
                end: turn.endMediaGlobal,
              }) > 0.001,
          ),
      );
      const rmsValues: number[] = [];
      let nonOverlapSampleDuration = 0;
      if (input.pcm !== undefined) {
        for (const turn of turns) {
          const start = Math.max(
            0,
            Math.floor((turn.startMediaGlobal - input.pcm.mediaStart) * 16_000),
          );
          const end = Math.min(
            input.pcm.samples.length,
            Math.ceil((turn.endMediaGlobal - input.pcm.mediaStart) * 16_000),
          );
          if (end <= start) continue;
          let sumSquares = 0;
          for (let index = start; index < end; index += 1) {
            const sample = (input.pcm.samples[index] ?? 0) / 32_768;
            sumSquares += sample * sample;
          }
          const rms = Math.sqrt(sumSquares / Math.max(1, end - start));
          rmsValues.push(20 * Math.log10(Math.max(rms, 1e-9)));
          nonOverlapSampleDuration += (end - start) / 16_000;
        }
      }
      const totalActivity = intervalSetDuration(
        input.context.standardTurns
          .filter((turn) => turn.speakerId === speakerId)
          .map((turn) => ({
            start: turn.startMediaGlobal,
            end: turn.endMediaGlobal,
          })),
      );
      const overlapActivity = intervalSetIntersection(
        input.context.standardTurns
          .filter((turn) => turn.speakerId === speakerId)
          .map((turn) => ({
            start: turn.startMediaGlobal,
            end: turn.endMediaGlobal,
          })),
        input.overlaps.map((value) => value.interval),
      );
      const assigned = input.assignments.filter(
        (assignment) => assignment.dominantSpeakerId === speakerId,
      );
      return {
        speakerId,
        exclusiveRmsDbfsMedian: percentile(rmsValues, 0.5),
        exclusiveRmsDbfsP90: percentile(rmsValues, 0.9),
        exclusiveActivityDuration: nonOverlapSampleDuration,
        activityPersistenceRatio: clamp(
          totalActivity / Math.max(0.001, duration(input.componentUnion)),
        ),
        overlapOccupancyRatio: clamp(
          overlapActivity / Math.max(0.001, totalActivity),
        ),
        nonOverlapSampleDuration,
        forcedAlignmentCoverage:
          assigned.length === 0
            ? 0
            : assigned.filter(
                (assignment) =>
                  assignment.assignmentWindowSource !== "source-cue-prior",
              ).length / assigned.length,
        mappedTokenLexicalCoverage:
          assigned.length === 0
            ? 0
            : assigned.reduce(
                (sum, assignment) =>
                  sum + (input.mappedCoverageByCue.get(assignment.cueId) ?? 0),
                0,
              ) / assigned.length,
        chantRepetitionScore: 0,
        status: "unknown",
        scoreCalibrationStatus: "uncalibrated-heuristic" as const,
        blockers: [] as string[],
      };
    });
  const usable = preliminary.filter(
    (value) =>
      value.nonOverlapSampleDuration >= 0.4 &&
      value.exclusiveRmsDbfsMedian !== null,
  );
  for (const value of preliminary) {
    if (
      value.nonOverlapSampleDuration < 0.4 ||
      value.exclusiveRmsDbfsMedian === null
    ) {
      value.status = "insufficient-exclusive-audio";
      value.blockers.push("INSUFFICIENT_EXCLUSIVE_AUDIO");
      continue;
    }
    const competitors = usable.filter(
      (other) => other.speakerId !== value.speakerId,
    );
    if (competitors.length === 0) {
      value.status = "unknown";
      continue;
    }
    const strongest = Math.max(
      ...competitors.map((other) => other.exclusiveRmsDbfsMedian ?? -120),
    );
    const weakest = Math.min(
      ...competitors.map((other) => other.exclusiveRmsDbfsMedian ?? 0),
    );
    if (value.exclusiveRmsDbfsMedian - strongest >= 4) {
      value.status = "prominent-likely";
    } else if (weakest - value.exclusiveRmsDbfsMedian >= 4) {
      value.status = "background-likely";
    } else if (
      Math.abs(value.exclusiveRmsDbfsMedian - strongest) <= 2 ||
      Math.abs(value.exclusiveRmsDbfsMedian - weakest) <= 2
    ) {
      value.status = "co-primary";
    }
  }
  return preliminary;
}

function relationship(input: {
  componentUnion: { start: number; end: number };
  windowStable: boolean;
  contextTracks: readonly {
    speakerId: string;
    totalActivityDuration: number;
    firstActivityTime: number | null;
    standardTurns: SpeakerEvidenceAttempt["standardTurns"];
  }[];
  overlaps: readonly {
    interval: { start: number; end: number };
    activeSpeakerIds: string[];
    crossWindowIoU: number;
    stabilityStatus: string;
    evidenceLineageIds: string[];
  }[];
  assignments: readonly ReturnType<typeof assignmentForCue>[];
  changePoints: readonly {
    timeMediaGlobal: number;
    stable: boolean;
    evidenceLineageIds: string[];
  }[];
}) {
  const hypotheses: {
    relationship:
      | "ordered-different-speaker-turns"
      | "same-speaker-boundary-overlap"
      | "stable-multi-speaker-overlap"
      | "nested-multi-speaker-activity"
      | "single-speaker-only"
      | "speaker-evidence-conflict";
    score: number;
    evidenceLineageIds: string[];
    reasons: string[];
  }[] = [];
  const stableAssignments = input.assignments.filter((value) =>
    value.assignmentStatus.startsWith("stable-"),
  );
  const adjacentAssignmentOverlap = stableAssignments.some(
    (value, index) =>
      index > 0 &&
      intersection(
        stableAssignments[index - 1]?.assignmentWindow ??
          value.assignmentWindow,
        value.assignmentWindow,
      ) >= 0.05,
  );
  const stableOverlaps = input.overlaps.filter(
    (value) =>
      value.stabilityStatus === "stable" && value.crossWindowIoU >= 0.35,
  );
  if (input.contextTracks.length === 1 && input.windowStable) {
    hypotheses.push({
      relationship: "single-speaker-only",
      score: adjacentAssignmentOverlap ? 0.68 : 0.8,
      evidenceLineageIds:
        input.contextTracks[0]?.standardTurns.map(
          (turn) => turn.evidenceLineageId,
        ) ?? [],
      reasons: ["ONE_STABLE_COMPONENT_LOCAL_SPEAKER_TRACK"],
    });
  }
  if (stableOverlaps.length > 0 && input.windowStable) {
    hypotheses.push({
      relationship: "stable-multi-speaker-overlap",
      score: clamp(
        0.65 +
          Math.min(
            0.25,
            stableOverlaps.reduce(
              (sum, value) => sum + duration(value.interval),
              0,
            ) / Math.max(0.1, duration(input.componentUnion)),
          ),
      ),
      evidenceLineageIds: [
        ...new Set(stableOverlaps.flatMap((value) => value.evidenceLineageIds)),
      ],
      reasons: ["DISTINCT_STANDARD_TRACKS_OVERLAP_IN_BOTH_WINDOWS"],
    });
  }
  const sortedTracks = [...input.contextTracks].toSorted(
    (left, right) => right.totalActivityDuration - left.totalActivityDuration,
  );
  const persistent = sortedTracks[0];
  const nested = sortedTracks[1];
  if (
    persistent !== undefined &&
    nested !== undefined &&
    input.windowStable &&
    persistent.totalActivityDuration /
      Math.max(0.1, duration(input.componentUnion)) >=
      0.65 &&
    nested.totalActivityDuration /
      Math.max(0.1, persistent.totalActivityDuration) <=
      0.65 &&
    nested.standardTurns.every((turn) =>
      persistent.standardTurns.some(
        (outer) =>
          turn.startMediaGlobal >= outer.startMediaGlobal - 0.1 &&
          turn.endMediaGlobal <= outer.endMediaGlobal + 0.1,
      ),
    )
  ) {
    hypotheses.push({
      relationship: "nested-multi-speaker-activity",
      score: 0.99,
      evidenceLineageIds: [
        ...new Set([
          ...persistent.standardTurns.map((turn) => turn.evidenceLineageId),
          ...nested.standardTurns.map((turn) => turn.evidenceLineageId),
        ]),
      ],
      reasons: ["SECOND_STABLE_TRACK_NESTED_INSIDE_PERSISTENT_TRACK"],
    });
  }
  const orderedAssignments = stableAssignments.filter(
    (value) => value.dominantSpeakerId !== null,
  );
  if (orderedAssignments.length >= 2 && input.windowStable) {
    const speakers = orderedAssignments.map((value) => value.dominantSpeakerId);
    const hasDifferentAdjacent = speakers.some(
      (speaker, index) => index > 0 && speaker !== speakers[index - 1],
    );
    const hasSameAdjacent = speakers.some(
      (speaker, index) => index > 0 && speaker === speakers[index - 1],
    );
    if (
      hasDifferentAdjacent &&
      stableOverlaps.length === 0 &&
      input.changePoints.some((point) => point.stable)
    ) {
      hypotheses.push({
        relationship: "ordered-different-speaker-turns",
        score: 0.76,
        evidenceLineageIds: [
          ...new Set([
            ...orderedAssignments.flatMap((value) => value.evidenceLineageIds),
            ...input.changePoints.flatMap((value) => value.evidenceLineageIds),
          ]),
        ],
        reasons: ["ADJACENT_CUES_MAP_TO_DIFFERENT_STABLE_SPEAKERS"],
      });
    }
    if (hasSameAdjacent && stableOverlaps.length === 0) {
      hypotheses.push({
        relationship: "same-speaker-boundary-overlap",
        score: adjacentAssignmentOverlap ? 0.84 : 0.7,
        evidenceLineageIds: [
          ...new Set(
            orderedAssignments.flatMap((value) => value.evidenceLineageIds),
          ),
        ],
        reasons: ["ADJACENT_CUES_MAP_TO_ONE_CONTINUOUS_SPEAKER_TRACK"],
      });
    }
  }
  if (!input.windowStable) {
    hypotheses.push({
      relationship: "speaker-evidence-conflict",
      score: 0.7,
      evidenceLineageIds: [],
      reasons: ["SPEAKER_WINDOW_UNSTABLE"],
    });
  }
  const sorted = hypotheses.toSorted(
    (left, right) =>
      right.score - left.score ||
      left.relationship.localeCompare(right.relationship),
  );
  const best = sorted[0] ?? null;
  const runnerUp = sorted[1] ?? null;
  const margin = Math.max(0, (best?.score ?? 0) - (runnerUp?.score ?? 0));
  const selected =
    best !== null && best.score >= 0.65 && (runnerUp === null || margin >= 0.08)
      ? best.relationship
      : "unresolved";
  return { hypotheses: sorted, best, runnerUp, margin, selected };
}

function mappedCoverage(
  item: SubtitleReviewPackage["items"][number],
  cueId: string,
) {
  return item.boundaryEvidence.some(
    (evidence) =>
      evidence.cueIds.includes(cueId) &&
      ["trusted-mapped-token", "trusted-no-vad-token"].includes(
        evidence.sourceType,
      ),
  )
    ? 1
    : 0;
}

function safeTimingProposal(input: {
  mode: SpeakerEvidenceMode;
  item: SubtitleReviewPackage["items"][number];
  assignments: readonly ReturnType<typeof assignmentForCue>[];
  changes: readonly {
    timeMediaGlobal: number;
    stable: boolean;
    evidenceLineageIds: string[];
  }[];
  relationship: string;
  decisionMargin: number;
  windowStable: boolean;
}) {
  type BoundaryEvidence =
    SubtitleReviewPackage["items"][number]["boundaryEvidence"][number];
  const disqualifyingEvidenceBlocker =
    /(?:UNSTABLE|UNAVAILABLE|FAILED|REJECT|PINNED|LOW_|OOV|INTRUSION|DISAGREEMENT|SILENCE)/u;
  const supportedBoundary = (
    cueId: string,
    side: "start" | "end",
    speakerBoundary: number,
  ): { time: number; evidenceIds: string[] } | null => {
    const candidates = input.item.boundaryEvidence.filter(
      (evidence): evidence is BoundaryEvidence =>
        evidence.cueIds.includes(cueId) &&
        evidence.timingUsable &&
        evidence.acousticEvidence &&
        evidence.sourceType !== "source-cue-prior" &&
        evidence.sourceType !== "raw-vad" &&
        evidence.blockers.every(
          (blocker) => !disqualifyingEvidenceBlocker.test(blocker),
        ) &&
        (evidence.neighborIntrusionRatio ?? 0) <= 0.05 &&
        (evidence.trustScore ?? evidence.boundaryConfidence ?? 0) >= 0.65 &&
        (evidence.sideSupport === side || evidence.sideSupport === "both"),
    );
    const nearby = candidates
      .map((evidence) => ({
        evidence,
        time: evidence.interval[side],
        difference: Math.abs(evidence.interval[side] - speakerBoundary),
      }))
      .filter((candidate) => candidate.difference <= 0.25)
      .toSorted(
        (left, right) =>
          left.difference - right.difference ||
          left.evidence.evidenceLineageId.localeCompare(
            right.evidence.evidenceLineageId,
          ),
      );
    const selected = nearby[0];
    if (selected === undefined) return null;
    return {
      time: selected.time,
      evidenceIds: nearby
        .filter((candidate) => Math.abs(candidate.time - selected.time) <= 0.05)
        .map((candidate) => candidate.evidence.evidenceLineageId)
        .toSorted(),
    };
  };
  const overlapAmount = (
    left: { start: number; end: number },
    right: { start: number; end: number },
  ) =>
    Math.max(
      0,
      Math.min(left.end, right.end) - Math.max(left.start, right.start),
    );
  const blockers: string[] = [];
  const mutations: {
    cueId: string;
    before: { start: number; end: number };
    after: { start: number; end: number };
    startEvidenceIds: string[];
    endEvidenceIds: string[];
    maximumDeltaSeconds: number;
  }[] = [];
  if (input.mode !== "enforce") blockers.push("SPEAKER_TIMING_OBSERVE_ONLY");
  if (!input.windowStable) blockers.push("SPEAKER_WINDOW_UNSTABLE");
  if (input.decisionMargin < 0.12)
    blockers.push("SPEAKER_DECISION_MARGIN_INSUFFICIENT");
  if (input.relationship !== "ordered-different-speaker-turns") {
    blockers.push("SPEAKER_RELATIONSHIP_NOT_TIMING_ACTIONABLE");
  }
  const stableAssignments = input.assignments.every(
    (assignment) => assignment.assignmentStatus === "stable-single-speaker",
  );
  if (!stableAssignments) blockers.push("SPEAKER_ASSIGNMENT_NOT_STABLE_SINGLE");
  const change = input.changes.find((value) => value.stable);
  if (change === undefined) blockers.push("STABLE_SPEAKER_CHANGE_UNAVAILABLE");
  const cueEvidence = input.item.forcedAlignmentEvidence?.cues ?? [];
  if (change !== undefined && input.item.targetCueIds.length === 2) {
    const left = cueEvidence.find(
      (cue) => cue.cueId === input.item.targetCueIds[0],
    );
    const right = cueEvidence.find(
      (cue) => cue.cueId === input.item.targetCueIds[1],
    );
    const leftAntiForcingPassed =
      left !== undefined &&
      left.windowStabilityScore >= 0.75 &&
      left.antiForcingBlockers.length === 0;
    const rightAntiForcingPassed =
      right !== undefined &&
      right.windowStabilityScore >= 0.75 &&
      right.antiForcingBlockers.length === 0;
    if (!leftAntiForcingPassed || !rightAntiForcingPassed) {
      blockers.push("LEXICAL_ANTI_FORCING_GATE_FAILED");
    }
    const leftBoundary = supportedBoundary(
      input.item.targetCueIds[0] ?? "",
      "end",
      change.timeMediaGlobal,
    );
    const rightBoundary = supportedBoundary(
      input.item.targetCueIds[1] ?? "",
      "start",
      change.timeMediaGlobal,
    );
    if (
      left === undefined ||
      right === undefined ||
      leftBoundary === null ||
      rightBoundary === null
    ) {
      blockers.push("LEXICAL_BOUNDARY_SUPPORT_MISSING");
    } else {
      // The localized, cross-window-stable speaker change is the boundary.
      // Lexical evidence is a gate only; averaging boundaries would reintroduce
      // the forbidden midpoint/ratio family of timing heuristics.
      const roundedBoundary = roundTime(change.timeMediaGlobal);
      const leftAfter = {
        start: left.originalTiming.start,
        end: roundedBoundary,
      };
      const rightAfter = {
        start: roundedBoundary,
        end: right.originalTiming.end,
      };
      const deltas = [
        Math.abs(leftAfter.end - left.originalTiming.end),
        Math.abs(rightAfter.start - right.originalTiming.start),
      ];
      if (Math.max(...deltas) > 0.5)
        blockers.push("TIMING_DELTA_EXCEEDS_LIMIT");
      if (duration(leftAfter) < 0.4 || duration(rightAfter) < 0.4) {
        blockers.push("POST_REPAIR_CUE_TOO_SHORT");
      }
      const previous = input.item.previousCue;
      const next = input.item.nextCue;
      if (
        previous !== null &&
        overlapAmount(previous, leftAfter) >
          overlapAmount(previous, left.originalTiming) + 0.000_001
      ) {
        blockers.push("PREVIOUS_CUE_INTRUSION_INTRODUCED");
      }
      if (
        next !== null &&
        overlapAmount(rightAfter, next) >
          overlapAmount(right.originalTiming, next) + 0.000_001
      ) {
        blockers.push("NEXT_CUE_INTRUSION_INTRODUCED");
      }
      if (
        overlapAmount(leftAfter, rightAfter) >
        overlapAmount(left.originalTiming, right.originalTiming) + 0.000_001
      ) {
        blockers.push("ILLEGAL_TARGET_OVERLAP_INTRODUCED");
      }
      if (blockers.length === 0) {
        mutations.push(
          {
            cueId: left.cueId,
            before: left.originalTiming,
            after: leftAfter,
            startEvidenceIds: [],
            endEvidenceIds: [
              ...new Set([
                ...leftBoundary.evidenceIds,
                ...change.evidenceLineageIds,
              ]),
            ].toSorted(),
            maximumDeltaSeconds: Math.max(...deltas),
          },
          {
            cueId: right.cueId,
            before: right.originalTiming,
            after: rightAfter,
            startEvidenceIds: [
              ...new Set([
                ...rightBoundary.evidenceIds,
                ...change.evidenceLineageIds,
              ]),
            ].toSorted(),
            endEvidenceIds: [],
            maximumDeltaSeconds: Math.max(...deltas),
          },
        );
      }
    }
  }
  const applied = blockers.length === 0 && mutations.length > 0;
  return {
    eligible: applied,
    applied,
    textChanged: false as const,
    mutations,
    blockers: [...new Set(blockers)],
    atomicRollbackApplied: !applied && mutations.length > 0,
    forbiddenHeuristicUseCount: 0 as const,
  };
}

function presentationOverrides(
  relationshipValue: string,
  cueIds: readonly string[],
) {
  if (
    !["stable-multi-speaker-overlap", "nested-multi-speaker-activity"].includes(
      relationshipValue,
    )
  ) {
    return [];
  }
  return cueIds.map((cueId, index) => ({
    cueId,
    assLayer: index + 1,
    assAlignment: index % 2 === 0 ? 2 : 8,
    vttSettings:
      index % 2 === 0 ? "line:85% position:35%" : "line:15% position:65%",
    srtWarning:
      "Simultaneous anonymous speaker activity may render as overlap.",
    reason: "STABLE_MULTI_SPEAKER_PRESENTATION_ONLY",
  }));
}

export function analyzeLocalSpeakerEvidence(input: {
  mode: SpeakerEvidenceMode;
  reviewPackage: SubtitleReviewPackage;
  baseTimingHash: string;
  runtimeCapabilityRef: { path: string; sha256: string };
  reviewPackageRef: { path: string; sha256: string };
  forcedAlignmentRef: { path: string; sha256: string };
  overlapAcousticRef: { path: string; sha256: string };
  rawAttempts: readonly RawSpeakerAttemptInput[];
  pcmByComponent?: ReadonlyMap<string, SpeakerPcmWindow>;
  pipelineInferenceCount: number;
  modelLoadCount: number;
  deviceRequested?: "auto" | "mps" | "cpu";
  minimumSpeakers?: number;
  maximumSpeakers?: number;
}): SubtitleLocalSpeakerEvidence {
  const prepared = input.rawAttempts.map(prepareAttempt);
  const attempts: SpeakerEvidenceAttempt[] = [];
  const components: SpeakerEvidenceComponent[] = [];
  const reviewByComponent = new Map(
    input.reviewPackage.items.map((item) => [
      item.audioSourceComponentId ??
        item.forcedAlignmentEvidence?.componentId ??
        item.reviewId,
      item,
    ]),
  );
  for (const componentId of [
    ...new Set(prepared.map((value) => value.input.componentId)),
  ].toSorted()) {
    const contextRaw = prepared.find(
      (value) =>
        value.input.componentId === componentId &&
        value.input.windowType === "context",
    );
    const unionRaw = prepared.find(
      (value) =>
        value.input.componentId === componentId &&
        value.input.windowType === "union",
    );
    const item = reviewByComponent.get(componentId);
    if (
      contextRaw === undefined ||
      unionRaw === undefined ||
      item === undefined
    )
      continue;
    const contextOrder = rawLabelOrder(contextRaw);
    const unionOrder = rawLabelOrder(unionRaw);
    const contextMap = new Map(
      contextOrder.map((label, index) => [
        label,
        anonymousLabel(componentId, "context", index),
      ]),
    );
    const unionMap = new Map(
      unionOrder.map((label, index) => [
        label,
        anonymousLabel(componentId, "union", index),
      ]),
    );
    const mapping = bestPermutationMapping({
      context: contextRaw,
      union: unionRaw,
    });
    const contextAttempt = normalizedAttempt({
      prepared: contextRaw,
      labelMap: contextMap,
    });
    const unionAttempt = normalizedAttempt({
      prepared: unionRaw,
      labelMap: unionMap,
    });
    attempts.push(contextAttempt, unionAttempt);
    const unionToContext = new Map<string, string>();
    const mappings = mapping.pairs.map((pair) => {
      const contextSpeakerId = contextMap.get(pair.contextRaw);
      const unionSpeakerId = unionMap.get(pair.unionRaw);
      if (contextSpeakerId === undefined || unionSpeakerId === undefined) {
        throw new Error("Speaker normalization map is incomplete.");
      }
      unionToContext.set(unionSpeakerId, contextSpeakerId);
      return { contextSpeakerId, unionSpeakerId, mappingScore: pair.score };
    });
    const unmappedSpeakers = [
      ...contextAttempt.speakerLabels.filter(
        (label) => !mappings.some((value) => value.contextSpeakerId === label),
      ),
      ...unionAttempt.speakerLabels.filter(
        (label) => !mappings.some((value) => value.unionSpeakerId === label),
      ),
    ];
    const changePairs = changePointPairs(
      contextAttempt,
      unionAttempt,
      unionToContext,
    );
    const meanChangeDifference =
      changePairs.length === 0
        ? null
        : changePairs.reduce((sum, pair) => sum + (pair.difference ?? 1), 0) /
          changePairs.length;
    const contextOverlapRaw = modelOverlapIntervals(
      contextAttempt.standardTurns,
    );
    const unionOverlapRaw = modelOverlapIntervals(
      unionAttempt.standardTurns.map((turn) => ({
        ...turn,
        speakerId: unionToContext.get(turn.speakerId) ?? turn.speakerId,
      })),
    );
    const overlapIoU = intervalSetIoU(
      contextOverlapRaw.map((value) => value.interval),
      unionOverlapRaw.map((value) => value.interval),
    );
    const contextActivity = contextAttempt.standardTurns.map((turn) => ({
      start: turn.startMediaGlobal,
      end: turn.endMediaGlobal,
    }));
    const unionActivity = unionAttempt.standardTurns.map((turn) => ({
      start: turn.startMediaGlobal,
      end: turn.endMediaGlobal,
    }));
    const activityIoU = intervalSetIoU(contextActivity, unionActivity);
    const mappingStable =
      !mapping.ambiguous &&
      mappings.length === contextAttempt.speakerLabels.length &&
      mappings.length === unionAttempt.speakerLabels.length &&
      mappings.every((value) => value.mappingScore >= 0.35);
    const speakerCountStable =
      contextAttempt.speakerCount === unionAttempt.speakerCount;
    const turnBoundaryStability =
      meanChangeDifference === null
        ? contextAttempt.speakerChangePoints.length ===
          unionAttempt.speakerChangePoints.length
          ? 1
          : 0
        : clamp(1 - meanChangeDifference / 0.5);
    const windowStable =
      speakerCountStable &&
      mappingStable &&
      turnBoundaryStability >= 0.5 &&
      activityIoU >= 0.45 &&
      overlapIoU >= 0.35;
    const windowBlockers = [
      ...(!speakerCountStable ? ["SPEAKER_COUNT_UNSTABLE"] : []),
      ...(!mappingStable ? ["SPEAKER_MAPPING_UNSTABLE"] : []),
      ...(turnBoundaryStability < 0.5 ? ["SPEAKER_CHANGE_POINT_UNSTABLE"] : []),
      ...(activityIoU < 0.45 ? ["SPEAKER_ACTIVITY_IOU_LOW"] : []),
      ...(overlapIoU < 0.35 ? ["SPEAKER_OVERLAP_INTERVAL_UNSTABLE"] : []),
    ];
    const overlapIntervals = contextOverlapRaw.map((value, index) => {
      const unionBest = unionOverlapRaw
        .map((candidate) => ({
          candidate,
          iou: intervalSetIoU([value.interval], [candidate.interval]),
        }))
        .toSorted((left, right) => right.iou - left.iou)[0];
      const crossWindowIoU = unionBest?.iou ?? 0;
      return {
        overlapId: `speaker-overlap-${sha256Value({ componentId, interval: value.interval }).slice(0, 20)}`,
        interval: value.interval,
        durationSeconds: duration(value.interval),
        activeSpeakerIds: value.activeSpeakerIds,
        contextWindowObserved: true,
        unionWindowObserved: unionBest !== undefined && crossWindowIoU > 0,
        crossWindowIoU,
        stabilityStatus:
          unionBest === undefined
            ? ("single-window" as const)
            : crossWindowIoU >= 0.35
              ? ("stable" as const)
              : ("unstable" as const),
        evidenceLineageIds: [
          ...new Set([
            ...value.evidenceLineageIds,
            ...(unionBest?.candidate.evidenceLineageIds ?? []),
          ]),
        ],
        index,
      };
    });
    const changes = changePairs.map((pair, index) => {
      const before = contextAttempt.exclusiveTurns
        .filter((turn) => turn.endMediaGlobal <= pair.contextTime + 0.05)
        .at(-1);
      const after = contextAttempt.exclusiveTurns.find(
        (turn) => turn.startMediaGlobal >= pair.contextTime - 0.05,
      );
      return {
        changeId: `speaker-change-${sha256Value({ componentId, pair, index }).slice(0, 20)}`,
        beforeSpeakerId:
          before?.speakerId ?? contextAttempt.speakerLabels[0] ?? "unknown",
        afterSpeakerId:
          after?.speakerId ?? contextAttempt.speakerLabels.at(-1) ?? "unknown",
        timeMediaGlobal: pair.contextTime,
        contextTime: pair.contextTime,
        unionTime: pair.unionTime,
        differenceSeconds: pair.difference,
        stable: pair.difference !== null && pair.difference <= 0.35,
        evidenceLineageIds: [
          ...new Set([
            ...(before === undefined ? [] : [before.evidenceLineageId]),
            ...(after === undefined ? [] : [after.evidenceLineageId]),
          ]),
        ],
      };
    });
    const assignments = item.targetCueIds.map((cueId) =>
      assignmentForCue({
        cueId,
        item,
        context: contextAttempt,
        union: unionAttempt,
        unionToContext,
        overlaps: overlapIntervals,
        windowStable,
      }),
    );
    const speakerTracks = contextAttempt.speakerLabels.map((speakerId) => {
      const standardTurns = contextAttempt.standardTurns.filter(
        (turn) => turn.speakerId === speakerId,
      );
      const exclusiveTurns = contextAttempt.exclusiveTurns.filter(
        (turn) => turn.speakerId === speakerId,
      );
      return {
        speakerId,
        standardTurns,
        exclusiveTurns,
        totalActivityDuration: intervalSetDuration(
          standardTurns.map((turn) => ({
            start: turn.startMediaGlobal,
            end: turn.endMediaGlobal,
          })),
        ),
        firstActivityTime:
          standardTurns.length === 0
            ? null
            : Math.min(...standardTurns.map((turn) => turn.startMediaGlobal)),
      };
    });
    const mappedCoverageByCue = new Map(
      item.targetCueIds.map((cueId) => [cueId, mappedCoverage(item, cueId)]),
    );
    const prominenceEvidence = prominence({
      speakerIds: contextAttempt.speakerLabels,
      context: contextAttempt,
      componentUnion: item.componentUnionInterval ?? item.interval,
      overlaps: overlapIntervals,
      assignments,
      pcm: input.pcmByComponent?.get(componentId),
      mappedCoverageByCue,
    });
    const relationshipDecision = relationship({
      componentUnion: item.componentUnionInterval ?? item.interval,
      windowStable,
      contextTracks: speakerTracks,
      overlaps: overlapIntervals,
      assignments,
      changePoints: changes,
    });
    const timingProposal = safeTimingProposal({
      mode: input.mode,
      item,
      assignments,
      changes,
      relationship: relationshipDecision.selected,
      decisionMargin: relationshipDecision.margin,
      windowStable,
    });
    const overrides = presentationOverrides(
      relationshipDecision.selected,
      item.targetCueIds,
    );
    const resolutionStatus = timingProposal.applied
      ? ("timing-only" as const)
      : overrides.length > 0 && input.mode === "enforce"
        ? ("presentation-only" as const)
        : relationshipDecision.selected === "unresolved" || !windowStable
          ? ("unresolved" as const)
          : ("resolved" as const);
    const componentBase = {
      componentId,
      cueIds: item.targetCueIds,
      componentUnion: item.componentUnionInterval ?? item.interval,
      contextAttemptId: contextAttempt.attemptId,
      unionAttemptId: unionAttempt.attemptId,
      speakerWindowMapping: mappings,
      unmappedSpeakers,
      windowStability: {
        speakerCountStable,
        speakerTurnBoundaryStability: turnBoundaryStability,
        overlapIntervalStability: overlapIoU,
        exclusiveTurnStability: turnBoundaryStability,
        speakerActivityIntersectionOverUnion: activityIoU,
        speakerChangePointDifferenceSeconds: meanChangeDifference,
        stable: windowStable,
        blockers: windowBlockers,
      },
      speakerTracks,
      overlapSpeechIntervals: overlapIntervals.map((value) => ({
        overlapId: value.overlapId,
        interval: value.interval,
        durationSeconds: value.durationSeconds,
        activeSpeakerIds: value.activeSpeakerIds,
        contextWindowObserved: value.contextWindowObserved,
        unionWindowObserved: value.unionWindowObserved,
        crossWindowIoU: value.crossWindowIoU,
        stabilityStatus: value.stabilityStatus,
        evidenceLineageIds: value.evidenceLineageIds,
      })),
      speakerChangePoints: changes,
      cueSpeakerHypotheses: assignments,
      prominenceEvidence,
      relationshipHypotheses: relationshipDecision.hypotheses,
      selectedRelationship: relationshipDecision.selected,
      bestActionableHypothesis: relationshipDecision.best?.relationship ?? null,
      bestActionableHypothesisScore: relationshipDecision.best?.score ?? null,
      runnerUpActionableHypothesis:
        relationshipDecision.runnerUp?.relationship ?? null,
      runnerUpActionableHypothesisScore:
        relationshipDecision.runnerUp?.score ?? null,
      actionableDecisionMargin: relationshipDecision.margin,
      scoreCalibrationStatus: "uncalibrated-heuristic" as const,
      resolutionStatus,
      blockers: [
        ...new Set([
          ...windowBlockers,
          ...assignments.flatMap((assignment) => assignment.blockers),
          ...timingProposal.blockers,
          ...(relationshipDecision.selected === "unresolved"
            ? ["SPEAKER_RELATIONSHIP_UNRESOLVED"]
            : []),
        ]),
      ],
      presentationOverrides: overrides,
      timingProposal,
    };
    components.push(
      speakerEvidenceComponentSchema.parse({
        ...componentBase,
        semanticHash: sha256Value(componentBase),
      }),
    );
  }
  const usedLineages = components.flatMap((component) =>
    component.cueSpeakerHypotheses.flatMap(
      (assignment) => assignment.evidenceLineageIds,
    ),
  );
  const uniqueLineages = new Set(usedLineages);
  const duplicateSpeakerEvidenceLineageCount = Math.max(
    0,
    usedLineages.length - uniqueLineages.size,
  );
  const componentDecisionHash = sha256Value(
    components.map((component) => ({
      componentId: component.componentId,
      selectedRelationship: component.selectedRelationship,
      relationshipHypotheses: component.relationshipHypotheses,
      cueSpeakerHypotheses: component.cueSpeakerHypotheses,
      windowStability: component.windowStability,
    })),
  );
  const mutationHash = sha256Value(
    components.flatMap((component) => component.timingProposal.mutations),
  );
  const generatedAt = new Date().toISOString();
  const semanticBase = {
    sourceFingerprint: input.reviewPackage.sourceFingerprint,
    baseCueHash: input.reviewPackage.baseCueHash,
    baseTimingHash: input.baseTimingHash,
    runtimeCapabilityRef: input.runtimeCapabilityRef,
    reviewPackageRef: input.reviewPackageRef,
    forcedAlignmentRef: input.forcedAlignmentRef,
    overlapAcousticRef: input.overlapAcousticRef,
    configuration: {
      mode: input.mode,
      backend: "pyannote-community-1" as const,
      deviceRequested: input.deviceRequested ?? ("auto" as const),
      deviceUsed: input.rawAttempts[0]?.device ?? ("cpu" as const),
      windowMode: "dual" as const,
      minimumSpeakers: input.minimumSpeakers ?? 1,
      maximumSpeakers: input.maximumSpeakers ?? 3,
      concurrency: 1 as const,
      persistSpeakerEmbeddings: false as const,
      speakerNormalizationPolicy: SPEAKER_NORMALIZATION_POLICY,
      windowMappingPolicy: SPEAKER_WINDOW_MAPPING_POLICY,
      overlapPolicy: SPEAKER_OVERLAP_POLICY,
      prominencePolicy: SPEAKER_PROMINENCE_POLICY,
      cueAssignmentPolicy: SPEAKER_CUE_ASSIGNMENT_POLICY,
      relationshipPolicy: SPEAKER_RELATIONSHIP_POLICY,
      policyHash: SPEAKER_EVIDENCE_POLICY_HASH,
    },
    attempts,
    components,
    summary: {
      targetComponentCount: components.length,
      targetCueCount: components.reduce(
        (sum, component) => sum + component.cueIds.length,
        0,
      ),
      attemptCount: attempts.length,
      cacheHitCount: attempts.filter((attempt) => attempt.cacheHit).length,
      pipelineInferenceCount: input.pipelineInferenceCount,
      modelLoadCount: input.modelLoadCount,
      standardDiarizationObserved: attempts.some(
        (attempt) => attempt.standardTurns.length > 0,
      ),
      exclusiveDiarizationObserved: attempts.some(
        (attempt) => attempt.exclusiveTurns.length > 0,
      ),
      stableComponentCount: components.filter(
        (component) => component.windowStability.stable,
      ).length,
      resolvedComponentCount: components.filter(
        (component) => component.resolutionStatus === "resolved",
      ).length,
      presentationOnlyComponentCount: components.filter(
        (component) => component.resolutionStatus === "presentation-only",
      ).length,
      timingOnlyComponentCount: components.filter(
        (component) => component.resolutionStatus === "timing-only",
      ).length,
      unresolvedComponentCount: components.filter((component) =>
        ["unresolved", "failed"].includes(component.resolutionStatus),
      ).length,
      duplicateSpeakerEvidenceLineageCount,
      speakerEvidenceDoubleCountPreventedCount:
        duplicateSpeakerEvidenceLineageCount,
      crossComponentSpeakerLinkCount: 0 as const,
      realPersonIdentificationCount: 0 as const,
      speakerConfidenceFabricatedCount: 0 as const,
      rawVadUsedAsSpeakerIdentityCount: 0 as const,
      mfaUsedAsSpeakerIdentityCount: 0 as const,
      mappedTokenUsedAsSpeakerIdentityCount: 0 as const,
      rawEmbeddingPersistedCount: 0 as const,
      timingMutationCount: components.reduce(
        (sum, component) => sum + component.timingProposal.mutations.length,
        0,
      ),
      canonicalTextMutationCount: 0 as const,
      forbiddenTimingHeuristicUseCount: 0 as const,
    },
    componentDecisionHash,
    mutationHash,
  };
  const draft = subtitleLocalSpeakerEvidenceSchema.parse({
    schemaVersion: "1.0.0",
    artifactType: "subtitle-local-speaker-evidence",
    evidenceVersion: "C5.18",
    generatedAt,
    ...semanticBase,
    semanticHash: "0".repeat(64),
  });
  return subtitleLocalSpeakerEvidenceSchema.parse({
    ...draft,
    semanticHash: speakerEvidenceSemanticHash(draft),
  });
}

export function speakerEvidenceSemanticHash(
  artifact: SubtitleLocalSpeakerEvidence,
): string {
  return sha256Value({
    sourceFingerprint: artifact.sourceFingerprint,
    baseCueHash: artifact.baseCueHash,
    baseTimingHash: artifact.baseTimingHash,
    runtimeCapabilityHash: artifact.runtimeCapabilityRef.sha256,
    forcedAlignmentHash: artifact.forcedAlignmentRef.sha256,
    overlapAcousticHash: artifact.overlapAcousticRef.sha256,
    configuration: {
      ...artifact.configuration,
      mode: null,
    },
    attempts: artifact.attempts.map((attempt) => ({
      ...attempt,
      wallClockSeconds: 0,
      cacheHit: false,
    })),
    components: artifact.components.map((component) => ({
      ...component,
      semanticHash: null,
      resolutionStatus: null,
      blockers: component.blockers.filter(
        (blocker) => blocker !== "SPEAKER_TIMING_OBSERVE_ONLY",
      ),
      timingProposal: null,
    })),
    observationalSummary: {
      targetComponentCount: artifact.summary.targetComponentCount,
      targetCueCount: artifact.summary.targetCueCount,
      attemptCount: artifact.summary.attemptCount,
      standardDiarizationObserved: artifact.summary.standardDiarizationObserved,
      exclusiveDiarizationObserved:
        artifact.summary.exclusiveDiarizationObserved,
      stableComponentCount: artifact.summary.stableComponentCount,
      duplicateSpeakerEvidenceLineageCount:
        artifact.summary.duplicateSpeakerEvidenceLineageCount,
      speakerEvidenceDoubleCountPreventedCount:
        artifact.summary.speakerEvidenceDoubleCountPreventedCount,
    },
    componentDecisionHash: artifact.componentDecisionHash,
  });
}
