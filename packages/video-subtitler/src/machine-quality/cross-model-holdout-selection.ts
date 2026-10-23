import {
  c60110HoldoutSelectionSchema,
  c60110PolicyVersion,
  type C60110HoldoutSelection,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";

export interface C60110CanonicalEventForHoldout {
  eventId: string;
  acousticInterval: { start: number; end: number };
  eventType: string;
  representativeCandidateId: string;
  semanticHash: string;
}

export interface C60110CueLineageForHoldout {
  eventId: string;
  finalCueIds: string[];
  lineageStatus: string;
  modifiable: boolean;
  semanticHash: string;
}

export function buildC60110HoldoutSelection(input: {
  generatedAt: string;
  sourceMediaSha256: string;
  policyFreezeSemanticHash: string;
  canonicalEvents: readonly C60110CanonicalEventForHoldout[];
  cueLineage: readonly C60110CueLineageForHoldout[];
  dev24EventIds: readonly string[];
  sourceGlobalVerifiedCandidateIds: ReadonlySet<string>;
  maximumAudioSeconds?: number;
}): C60110HoldoutSelection {
  if (new Set(input.dev24EventIds).size !== 24) {
    throw new Error("The frozen DEV24 exclusion set must contain 24 events.");
  }
  const maximumAudioSeconds = input.maximumAudioSeconds ?? 28.2;
  const dev = new Set(input.dev24EventIds);
  const lineageByEvent = new Map(
    input.cueLineage.map((lineage) => [lineage.eventId, lineage] as const),
  );
  const events = input.canonicalEvents
    .filter((event) => !dev.has(event.eventId))
    .map((event) => {
      const lineage = lineageByEvent.get(event.eventId);
      const duration =
        event.acousticInterval.end - event.acousticInterval.start;
      const exclusionReasons: string[] = [];
      if (event.eventType !== "SINGLE_UTTERANCE") {
        exclusionReasons.push("event-type-not-single-utterance");
      }
      if (duration <= 0 || duration > maximumAudioSeconds) {
        exclusionReasons.push("audio-duration-outside-runtime-contract");
      }
      if (lineage === undefined || lineage.finalCueIds.length === 0) {
        exclusionReasons.push("final-cue-lineage-unavailable");
      }
      if (
        !input.sourceGlobalVerifiedCandidateIds.has(
          event.representativeCandidateId,
        )
      ) {
        exclusionReasons.push("source-global-candidate-not-verified");
      }
      const machineLocalizable = exclusionReasons.length === 0;
      const core = {
        eventId: event.eventId,
        coreInterval: event.acousticInterval,
        finalCueIds: lineage?.finalCueIds ?? [],
        currentCandidateId: event.representativeCandidateId,
        machineLocalizable,
        coreExactPlanned: machineLocalizable,
        exclusionReasons,
        sourceEvidenceIds: [
          event.semanticHash,
          ...(lineage === undefined ? [] : [lineage.semanticHash]),
        ],
      };
      return { ...core, semanticHash: machineQualitySemanticHash(core) };
    })
    .toSorted((left, right) => left.eventId.localeCompare(right.eventId));
  const localizable = events.filter((event) => event.machineLocalizable);
  const core = {
    schemaVersion: "1.0.0" as const,
    policyVersion: c60110PolicyVersion,
    generatedAt: input.generatedAt,
    artifactType: "c6-0-1-10-holdout-selection" as const,
    sourceMediaSha256: input.sourceMediaSha256,
    policyFreezeSemanticHash: input.policyFreezeSemanticHash,
    selectionPolicy:
      "episode-machine-localizable-canonical-events-excluding-frozen-dev24-v1" as const,
    totalCanonicalEventCount: input.canonicalEvents.length,
    dev24ExcludedEventIds: [...input.dev24EventIds].toSorted(),
    events,
    summary: {
      candidateHoldoutEventCount: events.length,
      machineLocalizableCount: localizable.length,
      excludedCount: events.length - localizable.length,
      coreExactPlannedCount: localizable.length,
    },
    machineOnlySelection: true as const,
    selectedBeforeHoldoutGold: true as const,
    runtimeGoldInputCount: 0 as const,
  };
  return c60110HoldoutSelectionSchema.parse({
    ...core,
    semanticHash: machineQualitySemanticHash({
      ...core,
      generatedAt: undefined,
    }),
  });
}
