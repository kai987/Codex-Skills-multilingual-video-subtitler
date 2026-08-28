import {
  c6018PolicyVersion,
  goldLocalCoreEvaluationSchema,
  type GoldLocalCoreEvaluation,
  type LocalGoldEvaluationStatus,
  type MachineCoreAcousticSpan,
} from "@mvl/shared";

import type { CoreSpanInterval } from "./core-acoustic-span.js";
import {
  machineQualitySemanticHash,
  normalizeCandidateText,
} from "./evidence-correlation.js";

export interface LocalGoldCueInput {
  cueId: string;
  start: number;
  end: number;
  text: string;
}

export interface GoldLocalCoreEvaluationResult {
  artifact: GoldLocalCoreEvaluation;
  goldTextByEvent: ReadonlyMap<string, string>;
}

const EVALUATION_MARGIN_SECONDS = 0.35 as const;

function overlapSeconds(
  left: CoreSpanInterval,
  right: CoreSpanInterval,
): number {
  return Math.max(
    0,
    Math.min(left.end, right.end) - Math.max(left.start, right.start),
  );
}

function evaluable(status: LocalGoldEvaluationStatus): boolean {
  return status.startsWith("EVALUABLE_");
}

export function buildGoldLocalCoreEvaluation(input: {
  coreSpans: MachineCoreAcousticSpan;
  goldCues: readonly LocalGoldCueInput[];
  goldIdentityHash: string;
  machineFreezeHash?: string;
  generatedAt?: string;
}): GoldLocalCoreEvaluationResult {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const sortedCues = [...input.goldCues].toSorted(
    (left, right) =>
      left.start - right.start ||
      left.end - right.end ||
      left.cueId.localeCompare(right.cueId),
  );
  const cueIndex = new Map(
    sortedCues.map((cue, index) => [cue.cueId, index] as const),
  );
  const provisional = input.coreSpans.events
    .toSorted(
      (left, right) =>
        left.proposedCoreStart - right.proposedCoreStart ||
        left.proposedCoreEnd - right.proposedCoreEnd ||
        left.eventId.localeCompare(right.eventId),
    )
    .map((span) => {
      const coreInterval = {
        start: span.proposedCoreStart,
        end: span.proposedCoreEnd,
      };
      const evaluationInterval = {
        start: Math.max(0, coreInterval.start - EVALUATION_MARGIN_SECONDS),
        end: coreInterval.end + EVALUATION_MARGIN_SECONDS,
      };
      const matched = sortedCues.filter(
        (cue) => overlapSeconds(evaluationInterval, cue) > 0,
      );
      return { span, coreInterval, evaluationInterval, matched };
    });
  const machineCountByGold = new Map<string, number>();
  for (const entry of provisional) {
    for (const cue of entry.matched) {
      machineCountByGold.set(
        cue.cueId,
        (machineCountByGold.get(cue.cueId) ?? 0) + 1,
      );
    }
  }
  const goldTextByEvent = new Map<string, string>();
  let previousMaximumGoldIndex = -1;
  const events = provisional.map((entry) => {
    const indices = entry.matched.map((cue) => cueIndex.get(cue.cueId) ?? -1);
    const minimumIndex = indices.length === 0 ? -1 : Math.min(...indices);
    const maximumIndex = indices.length === 0 ? -1 : Math.max(...indices);
    const monotonicOrder =
      minimumIndex < 0 || minimumIndex >= previousMaximumGoldIndex;
    if (maximumIndex >= 0)
      previousMaximumGoldIndex = Math.max(
        previousMaximumGoldIndex,
        maximumIndex,
      );
    const ambiguityReasons = new Set(entry.span.ambiguityReasons);
    const hasManyMachineToOne = entry.matched.some(
      (cue) => (machineCountByGold.get(cue.cueId) ?? 0) > 1,
    );
    let evaluationStatus: LocalGoldEvaluationStatus;
    const blockers: string[] = [];
    if (ambiguityReasons.has("OVERLAP_CORE_AMBIGUITY")) {
      evaluationStatus = "UNEVALUABLE_OVERLAP";
      blockers.push("machine-core-overlap-ambiguity");
    } else if (entry.matched.length === 0) {
      evaluationStatus = "UNEVALUABLE_INSUFFICIENT_REFERENCE";
      blockers.push("no-local-gold-cue-within-fixed-evaluation-margin");
    } else if (!monotonicOrder) {
      evaluationStatus = "UNEVALUABLE_MAPPING_CONFLICT";
      blockers.push("non-monotonic-local-gold-order");
    } else if (
      ambiguityReasons.has("CROSS_EVENT_CORE_AMBIGUITY") ||
      hasManyMachineToOne
    ) {
      evaluationStatus = "EVALUABLE_WITH_AMBIGUITY";
      blockers.push(
        ambiguityReasons.has("CROSS_EVENT_CORE_AMBIGUITY")
          ? "cross-event-machine-core-ambiguity"
          : "one-local-gold-span-serves-multiple-machine-events",
      );
    } else if (entry.matched.length === 1) {
      evaluationStatus = "EVALUABLE_EXACT_LOCAL";
    } else {
      evaluationStatus = "EVALUABLE_MONOTONIC_LOCAL";
    }
    const goldText = entry.matched.map((cue) => cue.text).join("");
    if (evaluable(evaluationStatus)) {
      goldTextByEvent.set(entry.span.eventId, goldText);
    }
    const core = {
      eventId: entry.span.eventId,
      coreInterval: entry.coreInterval,
      evaluationInterval: entry.evaluationInterval,
      matchedGoldCueIds: entry.matched.map((cue) => cue.cueId),
      machineToGoldCardinality:
        entry.matched.length === 0
          ? ("NONE" as const)
          : entry.matched.length === 1
            ? ("ONE_TO_ONE" as const)
            : ("ONE_TO_MANY" as const),
      goldToMachineCardinality:
        entry.matched.length === 0
          ? ("NONE" as const)
          : hasManyMachineToOne
            ? ("MANY_TO_ONE" as const)
            : ("ONE_TO_ONE" as const),
      monotonicOrder,
      evaluationStatus,
      goldTextHash:
        entry.matched.length === 0
          ? null
          : machineQualitySemanticHash(normalizeCandidateText(goldText)),
      goldTextIncluded: false as const,
      blockers,
    };
    return { ...core, semanticHash: machineQualitySemanticHash(core) };
  });
  const evaluableEvents = events.filter((event) =>
    evaluable(event.evaluationStatus),
  );
  const core = {
    schemaVersion: "1.0.0" as const,
    policyVersion: c6018PolicyVersion,
    generatedAt,
    artifactType: "gold-local-core-evaluation" as const,
    evaluationPhase: "post-freeze-gold-isolated" as const,
    machineFreezeHash: input.machineFreezeHash ?? input.coreSpans.semanticHash,
    goldIdentityHash: input.goldIdentityHash,
    evaluationMarginSeconds: EVALUATION_MARGIN_SECONDS,
    alignmentPolicy: "monotonic-local-many-to-many-v1" as const,
    runtimeGoldInputCount: 0 as const,
    events,
    summary: {
      eventCount: events.length,
      evaluableEventCount: evaluableEvents.length,
      exactLocalCount: events.filter(
        (event) => event.evaluationStatus === "EVALUABLE_EXACT_LOCAL",
      ).length,
      monotonicLocalCount: events.filter(
        (event) => event.evaluationStatus === "EVALUABLE_MONOTONIC_LOCAL",
      ).length,
      ambiguousEvaluableCount: events.filter(
        (event) => event.evaluationStatus === "EVALUABLE_WITH_AMBIGUITY",
      ).length,
      unevaluableEventCount: events.length - evaluableEvents.length,
      oneMachineToManyGoldCount: events.filter(
        (event) => event.machineToGoldCardinality === "ONE_TO_MANY",
      ).length,
      manyMachineToOneGoldCount: events.filter(
        (event) => event.goldToMachineCardinality === "MANY_TO_ONE",
      ).length,
      targetNineOfTwelvePassed: evaluableEvents.length >= 9,
    },
  };
  const artifact = goldLocalCoreEvaluationSchema.parse({
    ...core,
    semanticHash: machineQualitySemanticHash({
      ...core,
      generatedAt: undefined,
    }),
  });
  return { artifact, goldTextByEvent };
}
