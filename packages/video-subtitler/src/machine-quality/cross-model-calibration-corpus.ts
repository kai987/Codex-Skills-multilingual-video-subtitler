import {
  c60111PolicyVersion,
  machineCrossModelCalibrationCorpusSchema,
  type MachineCrossModelCalibrationCorpus,
  type MachineCrossModelArbitrationEvidence,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";

export interface C60111HoldoutSelectionView {
  events: readonly {
    eventId: string;
    coreInterval: { start: number; end: number };
    machineLocalizable: boolean;
    sourceEvidenceIds: readonly string[];
  }[];
}

const disagreementRelations = new Set([
  "LEXICAL_DISAGREEMENT",
  "WHISPER_HALLUCINATION_RISK",
  "REAZON_HALLUCINATION_RISK",
  "BOTH_LOW_SUPPORT",
]);

const controlRelations = new Set([
  "EXACT_AGREEMENT",
  "NORMALIZED_AGREEMENT",
  "ORTHOGRAPHY_ONLY_DIFFERENCE",
]);

function stableEventOrder(eventId: string): string {
  return machineQualitySemanticHash({
    policy: "c60111-control-order-v1",
    eventId,
  });
}

export function buildCrossModelCalibrationCorpus(input: {
  generatedAt: string;
  sourceMediaSha256: string;
  evidence: MachineCrossModelArbitrationEvidence;
  selection: C60111HoldoutSelectionView;
  controlCount?: number;
  contextSeconds?: number;
}): MachineCrossModelCalibrationCorpus {
  const contextSeconds = input.contextSeconds ?? 1;
  const selectedById = new Map(
    input.selection.events.map((event) => [event.eventId, event]),
  );
  const eligible = input.evidence.events.filter(
    (event) => selectedById.get(event.eventId)?.machineLocalizable === true,
  );
  const disagreements = eligible.filter((event) =>
    disagreementRelations.has(event.crossModelRelation),
  );
  const controlLimit = input.controlCount ?? 12;
  const controlBuckets = [...controlRelations].map((relation) =>
    eligible
      .filter(
        (event) =>
          event.crossModelRelation === relation &&
          event.whisperHallucinationRisk < 0.6 &&
          (event.reazonHallucinationRisk ?? 0) < 0.6,
      )
      .toSorted((left, right) =>
        stableEventOrder(left.eventId).localeCompare(
          stableEventOrder(right.eventId),
        ),
      ),
  );
  const controls: typeof eligible = [];
  let bucketIndex = 0;
  while (
    controls.length < controlLimit &&
    controlBuckets.some((bucket) => bucket.length > 0)
  ) {
    const bucket = controlBuckets[bucketIndex % controlBuckets.length];
    const next = bucket?.shift();
    if (next !== undefined) controls.push(next);
    bucketIndex += 1;
  }
  const eventInputs = [
    ...disagreements.map((event) => ({ event, role: "DISAGREEMENT" as const })),
    ...controls.map((event) => ({ event, role: "CONTROL" as const })),
  ].toSorted(
    (left, right) =>
      (selectedById.get(left.event.eventId)?.coreInterval.start ?? 0) -
        (selectedById.get(right.event.eventId)?.coreInterval.start ?? 0) ||
      left.event.eventId.localeCompare(right.event.eventId),
  );
  const events = eventInputs.map(({ event, role }) => {
    const selected = selectedById.get(event.eventId);
    if (selected === undefined) {
      throw new Error(`Missing holdout selection for ${event.eventId}.`);
    }
    const sourceInterval = {
      start: Math.max(0, selected.coreInterval.start - contextSeconds),
      end: selected.coreInterval.end + contextSeconds,
    };
    const reasons =
      role === "DISAGREEMENT"
        ? [
            `cross-model:${event.crossModelRelation}`,
            "machine-localizable",
            "source-audio-reconstructable",
          ]
        : [
            `control:${event.crossModelRelation}`,
            "low-hallucination-risk",
            "stable-hash-selection",
          ];
    const core = {
      eventId: event.eventId,
      role,
      sourceInterval,
      coreInterval: selected.coreInterval,
      crossModelRelation: event.crossModelRelation,
      selectionReasons: reasons,
      audioGroupId: `audio-component:${event.eventId}`,
      goldSeenAtSelection: false as const,
    };
    return { ...core, semanticHash: machineQualitySemanticHash(core) };
  });
  const core = {
    schemaVersion: "1.0.0" as const,
    policyVersion: c60111PolicyVersion,
    generatedAt: input.generatedAt,
    artifactType: "machine-cross-model-calibration-corpus" as const,
    sourceMediaSha256: input.sourceMediaSha256,
    baselineEvidenceSemanticHash: input.evidence.semanticHash,
    inclusionPolicy:
      "machine-localizable-disagreements-plus-deterministic-low-risk-controls-v1" as const,
    controlSelectionPolicy:
      "relation-stratified-stable-hash-first-without-gold-v1" as const,
    events,
    summary: {
      eventCount: events.length,
      disagreementCount: events.filter((event) => event.role === "DISAGREEMENT")
        .length,
      controlCount: events.filter((event) => event.role === "CONTROL").length,
      machineLocalizableCount: events.length,
      reconstructableAudioCount: events.length,
      runtimeGoldInputCount: 0 as const,
    },
  };
  return machineCrossModelCalibrationCorpusSchema.parse({
    ...core,
    semanticHash: machineQualitySemanticHash({
      ...core,
      generatedAt: undefined,
    }),
  });
}
