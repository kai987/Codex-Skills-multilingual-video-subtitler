import {
  c60111CalibrationFoldsSchema,
  c60111PolicyVersion,
  type C60111CalibrationFolds,
  type MachineCrossModelCalibrationCorpus,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";

interface Component {
  start: number;
  end: number;
  events: MachineCrossModelCalibrationCorpus["events"];
}

export function buildC60111CalibrationFolds(input: {
  generatedAt: string;
  corpus: MachineCrossModelCalibrationCorpus;
  foldCount?: 5;
  neighborGapSeconds?: number;
}): C60111CalibrationFolds {
  const foldCount = input.foldCount ?? 5;
  const neighborGap = input.neighborGapSeconds ?? 0.25;
  const sorted = input.corpus.events.toSorted(
    (left, right) =>
      left.sourceInterval.start - right.sourceInterval.start ||
      left.eventId.localeCompare(right.eventId),
  );
  const components: Component[] = [];
  for (const event of sorted) {
    const previous = components.at(-1);
    if (
      previous !== undefined &&
      event.sourceInterval.start <= previous.end + neighborGap
    ) {
      previous.end = Math.max(previous.end, event.sourceInterval.end);
      previous.events.push(event);
    } else {
      components.push({
        start: event.sourceInterval.start,
        end: event.sourceInterval.end,
        events: [event],
      });
    }
  }
  const totalEvents = sorted.length;
  let assignedEvents = 0;
  const assignments = components.flatMap((component) => {
    const midpointRank = assignedEvents + component.events.length / 2;
    const fold = Math.min(
      foldCount,
      Math.floor((midpointRank * foldCount) / Math.max(1, totalEvents)) + 1,
    );
    assignedEvents += component.events.length;
    return component.events.map((event) => {
      const core = {
        eventId: event.eventId,
        audioGroupId: `audio-component:${machineQualitySemanticHash({
          start: component.start,
          end: component.end,
          eventIds: component.events.map((value) => value.eventId),
        }).slice(0, 20)}`,
        fold,
        timeBlockStart: component.start,
        timeBlockEnd: component.end,
      };
      return { ...core, semanticHash: machineQualitySemanticHash(core) };
    });
  });
  const core = {
    schemaVersion: "1.0.0" as const,
    policyVersion: c60111PolicyVersion,
    generatedAt: input.generatedAt,
    artifactType: "c6-0-1-11-calibration-folds" as const,
    corpusSemanticHash: input.corpus.semanticHash,
    groupingPolicy:
      "overlap-components-then-contiguous-time-blocks-v1" as const,
    foldCount: 5 as const,
    constructedBeforeLabels: true as const,
    randomSplitUsed: false as const,
    assignments,
  };
  return c60111CalibrationFoldsSchema.parse({
    ...core,
    semanticHash: machineQualitySemanticHash({
      ...core,
      generatedAt: undefined,
    }),
  });
}

export function overlappingAudioAcrossFolds(
  folds: C60111CalibrationFolds,
): number {
  let overlaps = 0;
  for (
    let leftIndex = 0;
    leftIndex < folds.assignments.length;
    leftIndex += 1
  ) {
    const left = folds.assignments[leftIndex];
    if (left === undefined) continue;
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < folds.assignments.length;
      rightIndex += 1
    ) {
      const right = folds.assignments[rightIndex];
      if (right === undefined || right.fold === left.fold) continue;
      if (
        left.timeBlockStart < right.timeBlockEnd &&
        right.timeBlockStart < left.timeBlockEnd
      ) {
        overlaps += 1;
      }
    }
  }
  return overlaps;
}
