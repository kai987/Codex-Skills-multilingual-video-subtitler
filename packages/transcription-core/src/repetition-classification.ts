import { createHash } from "node:crypto";

import {
  repetitionDecisionSchema,
  type RepetitionDecision,
  type RepetitionRelationship,
  type SubtitleCue,
} from "@mvl/shared";

import { normalizeForExactCueComparison } from "./repetition.js";

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sharedValues(
  left: readonly string[],
  right: readonly string[],
): string[] {
  const rightValues = new Set(right);
  return [...new Set(left.filter((value) => rightValues.has(value)))].sort();
}

function overlapMetrics(
  left: SubtitleCue,
  right: SubtitleCue,
): {
  gapSeconds: number;
  overlapSeconds: number;
  overlapRatio: number;
} {
  const overlapSeconds = Math.max(
    0,
    Math.min(left.end, right.end) - Math.max(left.start, right.start),
  );
  return {
    gapSeconds:
      Math.max(left.start, right.start) - Math.min(left.end, right.end),
    overlapSeconds,
    overlapRatio:
      overlapSeconds /
      Math.max(0.001, Math.min(left.end - left.start, right.end - right.start)),
  };
}

function sceneEvidence(cue: SubtitleCue): string[] {
  return [
    ...(cue.provenance?.sceneId === null ||
    cue.provenance?.sceneId === undefined
      ? []
      : [`scene-id:${cue.provenance.sceneId}`]),
    ...(cue.provenance?.sceneLabel === null ||
    cue.provenance?.sceneLabel === undefined
      ? []
      : [`scene-label:${cue.provenance.sceneLabel}`]),
  ];
}

function tokenEvidence(cue: SubtitleCue): string[] {
  const tokens = cue.timingEvidence?.tokens ?? [];
  return tokens.length === 0
    ? []
    : [
        `cue:${cue.id}:token-count:${tokens.length}`,
        `cue:${cue.id}:token-interval:${(tokens[0]?.start ?? cue.start).toFixed(3)}-${(tokens.at(-1)?.end ?? cue.end).toFixed(3)}`,
      ];
}

function speechEvidence(cue: SubtitleCue): string[] {
  const intervals = cue.timingEvidence?.speechIntervals ?? [];
  if (intervals.length > 0) {
    return [
      `cue:${cue.id}:speech-interval-count:${intervals.length}`,
      `cue:${cue.id}:speech-boundary-source:${cue.timingEvidence?.speechBoundarySource ?? "unspecified"}`,
    ];
  }
  return cue.timingEvidence?.speechStart !== null &&
    cue.timingEvidence?.speechStart !== undefined &&
    cue.timingEvidence.speechEnd !== null
    ? [`cue:${cue.id}:speech-start-end-evidence`]
    : [];
}

function hasCrowdOrChantEvidence(evidence: readonly string[]): boolean {
  return evidence.some((value) => /crowd|chant|chorus|call/iu.test(value));
}

export function classifyRepetitionRelationship(input: {
  left: SubtitleCue;
  right: SubtitleCue;
  humanReviewedAuthority?: boolean;
}): RepetitionDecision {
  const sorted = [input.left, input.right].toSorted(
    (a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id),
  );
  const left = sorted[0];
  const right = sorted[1];
  if (left === undefined || right === undefined) {
    throw new Error("Repetition classification requires two cues.");
  }
  const normalizedText = normalizeForExactCueComparison(left.text);
  const metrics = overlapMetrics(left, right);
  const sameBounds =
    Math.abs(left.start - right.start) <= 0.01 &&
    Math.abs(left.end - right.end) <= 0.01;
  const sharedRequestIds = sharedValues(
    left.provenance?.sourceRequestIds ?? [],
    right.provenance?.sourceRequestIds ?? [],
  );
  const sameSourceRequest = sharedRequestIds.length > 0;
  const leftTokenEvidence = tokenEvidence(left);
  const rightTokenEvidence = tokenEvidence(right);
  const allTokenEvidence = [...leftTokenEvidence, ...rightTokenEvidence];
  const leftSpeechEvidence = speechEvidence(left);
  const rightSpeechEvidence = speechEvidence(right);
  const allSpeechEvidence = [...leftSpeechEvidence, ...rightSpeechEvidence];
  const allSceneEvidence = [
    ...new Set([...sceneEvidence(left), ...sceneEvidence(right)]),
  ].sort();
  const independentIntervalEvidence =
    metrics.overlapSeconds === 0 &&
    !sameBounds &&
    (!sameSourceRequest ||
      (leftTokenEvidence.length > 0 && rightTokenEvidence.length > 0) ||
      (leftSpeechEvidence.length > 0 && rightSpeechEvidence.length > 0) ||
      input.humanReviewedAuthority === true);

  let relationship: RepetitionRelationship = "unresolved";
  let blocking = true;
  let recommendedAction: RepetitionDecision["recommendedAction"] = "review";
  const reasons = [
    `gap-seconds:${metrics.gapSeconds.toFixed(3)}`,
    `temporal-overlap-ratio:${metrics.overlapRatio.toFixed(3)}`,
    ...(sameBounds ? ["same-time-bounds"] : ["distinct-time-bounds"]),
    ...(sameSourceRequest
      ? [`shared-source-request:${sharedRequestIds.join(",")}`]
      : ["no-shared-source-request"]),
  ];

  if (sameBounds || metrics.overlapRatio >= 0.9) {
    relationship = "duplicate-cue";
    recommendedAction = "delete-duplicate";
    reasons.push("identical-text-with-duplicate-like-timing");
  } else if (
    input.humanReviewedAuthority === true &&
    independentIntervalEvidence &&
    !sameSourceRequest
  ) {
    relationship = "separate-utterance-repetition";
    blocking = false;
    recommendedAction = "preserve-both";
    reasons.push(
      "user-confirmed-human-review",
      "separate-non-overlapping-source-cue-intervals",
      "preserve-every-confirmed-utterance",
    );
  } else if (
    independentIntervalEvidence &&
    hasCrowdOrChantEvidence(allSceneEvidence)
  ) {
    relationship = "crowd-chant";
    blocking = false;
    recommendedAction = "preserve-both";
    reasons.push("independent-intervals-with-crowd-or-chant-evidence");
  } else if (
    independentIntervalEvidence &&
    left.speaker !== null &&
    right.speaker !== null &&
    left.speaker !== right.speaker
  ) {
    relationship = "call-and-response";
    blocking = false;
    recommendedAction = "preserve-both";
    reasons.push("different-speakers-on-independent-intervals");
  } else if (
    independentIntervalEvidence &&
    ((leftTokenEvidence.length > 0 && rightTokenEvidence.length > 0) ||
      (leftSpeechEvidence.length > 0 && rightSpeechEvidence.length > 0) ||
      (!sameSourceRequest &&
        (left.provenance?.sourceRequestIds.length ?? 0) > 0 &&
        (right.provenance?.sourceRequestIds.length ?? 0) > 0))
  ) {
    relationship = "confirmed-intentional-repetition";
    blocking = false;
    recommendedAction = "preserve-both";
    reasons.push("independent-machine-evidence-for-two-occurrences");
  } else if (metrics.overlapRatio >= 0.65 && sameSourceRequest) {
    relationship = "same-utterance-alternative";
    recommendedAction = "select-alternative";
    reasons.push("shared-request-and-high-overlap");
  } else {
    reasons.push("insufficient-independent-occurrence-evidence");
  }

  return repetitionDecisionSchema.parse({
    decisionId: `repetition-${hash({ cueIds: [left.id, right.id], normalizedText }).slice(0, 20)}`,
    cueIds: [left.id, right.id],
    relationship,
    normalizedText,
    intervals: [
      { start: left.start, end: left.end },
      { start: right.start, end: right.end },
    ],
    gapSeconds: metrics.gapSeconds,
    temporalOverlapSeconds: metrics.overlapSeconds,
    temporalOverlapRatio: metrics.overlapRatio,
    sameBounds,
    sameSourceRequest,
    independentIntervalEvidence,
    humanReviewedAuthority: input.humanReviewedAuthority ?? false,
    sceneEvidence: allSceneEvidence,
    tokenEvidence: allTokenEvidence,
    speechIntervalEvidence: allSpeechEvidence,
    reasons,
    blocking,
    recommendedAction,
  });
}

export function classifyAdjacentRepetitions(input: {
  cues: readonly SubtitleCue[];
  humanReviewedAuthority?: boolean;
}): RepetitionDecision[] {
  const cues = [...input.cues].toSorted(
    (left, right) =>
      left.start - right.start ||
      left.end - right.end ||
      left.id.localeCompare(right.id),
  );
  const decisions: RepetitionDecision[] = [];
  for (let index = 1; index < cues.length; index += 1) {
    const left = cues[index - 1];
    const right = cues[index];
    if (left === undefined || right === undefined) continue;
    const leftText = normalizeForExactCueComparison(left.text);
    const rightText = normalizeForExactCueComparison(right.text);
    if (leftText === "" || leftText !== rightText) continue;
    decisions.push(
      classifyRepetitionRelationship({
        left,
        right,
        humanReviewedAuthority: input.humanReviewedAuthority ?? false,
      }),
    );
  }
  return decisions;
}
