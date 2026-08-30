import {
  c60113IntervalSchema,
  c60113ReviewPlaybackTimelineSchema,
  type C60113Interval,
  type C60113ReviewPlaybackTimeline,
  type C60113ReviewPolicy,
  type C60113ReviewRegionsV2,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "../machine-quality/evidence-correlation.js";
import {
  c60113ArtifactHeader,
  uniqueC60113,
  withC60113SemanticHash,
} from "./c60113-policy.js";

export function c60113IntervalOverlap(
  left: C60113Interval,
  right: C60113Interval,
): number {
  return Math.max(
    0,
    Math.min(left.end, right.end) - Math.max(left.start, right.start),
  );
}

export function unionC60113Intervals(
  intervals: readonly C60113Interval[],
): C60113Interval[] {
  const sorted = intervals
    .map((value) => c60113IntervalSchema.parse(value))
    .toSorted((a, b) => a.start - b.start || a.end - b.end);
  const output: C60113Interval[] = [];
  for (const interval of sorted) {
    const previous = output.at(-1);
    if (previous !== undefined && interval.start <= previous.end) {
      previous.end = Math.max(previous.end, interval.end);
    } else output.push({ ...interval });
  }
  return output;
}

export function c60113UniqueAudioSeconds(
  intervals: readonly C60113Interval[],
): number {
  return unionC60113Intervals(intervals).reduce(
    (sum, value) => sum + value.end - value.start,
    0,
  );
}

export function c60113UnplayedIntervals(
  interval: C60113Interval,
  played: readonly C60113Interval[],
): C60113Interval[] {
  c60113IntervalSchema.parse(interval);
  let cursor = interval.start;
  const output: C60113Interval[] = [];
  for (const covered of unionC60113Intervals(played)) {
    if (covered.end <= cursor || covered.start >= interval.end) continue;
    if (covered.start > cursor)
      output.push({
        start: cursor,
        end: Math.min(covered.start, interval.end),
      });
    cursor = Math.max(cursor, covered.end);
    if (cursor >= interval.end) break;
  }
  if (cursor < interval.end) output.push({ start: cursor, end: interval.end });
  return output;
}

export function c60113IncrementalAudioSeconds(
  interval: C60113Interval,
  selected: readonly C60113Interval[],
): number {
  return c60113UnplayedIntervals(interval, selected).reduce(
    (sum, value) => sum + value.end - value.start,
    0,
  );
}

export function buildC60113PlaybackTimeline(input: {
  regions: C60113ReviewRegionsV2;
  policy: C60113ReviewPolicy;
}): C60113ReviewPlaybackTimeline {
  const intervals = input.regions.regions.map(
    (region) => region.contextInterval,
  );
  const segments = unionC60113Intervals(intervals).map((sourceInterval) => {
    const members = input.regions.regions.filter(
      (region) =>
        c60113IntervalOverlap(region.contextInterval, sourceInterval) > 0,
    );
    const core = {
      segmentId: `playback-${machineQualitySemanticHash(sourceInterval).slice(0, 20)}`,
      sourceInterval,
      regionIds: uniqueC60113(members.map((region) => region.regionId)),
      itemIds: uniqueC60113(members.flatMap((region) => region.reviewItemIds)),
    };
    return withC60113SemanticHash(core);
  });
  const clipSumSeconds = intervals.reduce(
    (sum, interval) => sum + interval.end - interval.start,
    0,
  );
  const uniqueUnionSeconds = c60113UniqueAudioSeconds(intervals);
  return c60113ReviewPlaybackTimelineSchema.parse(
    withC60113SemanticHash({
      ...c60113ArtifactHeader(input.policy),
      artifactType: "c6-0-1-13-machine-review-playback-timeline",
      regionsHash: input.regions.semanticHash,
      sourceDurationSeconds: input.regions.sourceDurationSeconds,
      segments,
      regionMappings: input.regions.regions.map((region) => ({
        regionId: region.regionId,
        segmentIds: segments
          .filter((segment) => segment.regionIds.includes(region.regionId))
          .map((segment) => segment.segmentId),
      })),
      clipSumSeconds,
      uniqueUnionSeconds,
      duplicateContextSeconds: Math.max(0, clipSumSeconds - uniqueUnionSeconds),
    }),
  );
}
