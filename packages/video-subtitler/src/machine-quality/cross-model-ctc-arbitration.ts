import {
  c6019PolicyVersion,
  machineCrossModelCtcArbitrationSchema,
  type MachineCrossModelComparison,
  type MachineCrossModelCtcArbitration,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";

export interface CrossModelCtcEvidenceInput {
  eventId: string;
  whisperProjection: string;
  reazonProjection: string;
  ctcWhisperEvidence: number | null;
  ctcReazonEvidence: number | null;
  evidenceIds: string[];
}

export function buildMachineCrossModelCtcArbitration(input: {
  generatedAt: string;
  comparison: MachineCrossModelComparison;
  ctcRuntimeIdentityHash: string;
  ctcModelSnapshotHash: string;
  evidence: readonly CrossModelCtcEvidenceInput[];
  inferenceCount: number;
  modelLoadCount: number;
}): MachineCrossModelCtcArbitration {
  const evidenceByEvent = new Map(
    input.evidence.map((event) => [event.eventId, event]),
  );
  const events = input.comparison.events.flatMap((comparison) => {
    const evidence = evidenceByEvent.get(comparison.eventId);
    if (evidence === undefined) return [];
    const difference =
      evidence.ctcWhisperEvidence === null ||
      evidence.ctcReazonEvidence === null
        ? null
        : evidence.ctcReazonEvidence - evidence.ctcWhisperEvidence;
    const outcome =
      difference === null
        ? ("CTC_UNSCORABLE" as const)
        : Math.abs(difference) < 0.05
          ? ("CTC_AMBIGUOUS" as const)
          : difference > 0
            ? ("CTC_FAVORS_REAZON" as const)
            : ("CTC_FAVORS_WHISPER" as const);
    const core = {
      eventId: comparison.eventId,
      whisperProjection: evidence.whisperProjection,
      reazonProjection: evidence.reazonProjection,
      ctcWhisperEvidence: evidence.ctcWhisperEvidence,
      ctcReazonEvidence: evidence.ctcReazonEvidence,
      scoreDifferenceReazonMinusWhisper: difference,
      outcome,
      correlationWarning: "DATA_FAMILY_CORRELATED" as const,
      evidenceIds: evidence.evidenceIds,
    };
    return [{ ...core, semanticHash: machineQualitySemanticHash(core) }];
  });
  const count = (
    outcome: MachineCrossModelCtcArbitration["events"][number]["outcome"],
  ) => events.filter((event) => event.outcome === outcome).length;
  const core = {
    schemaVersion: "1.0.0" as const,
    policyVersion: c6019PolicyVersion,
    generatedAt: input.generatedAt,
    artifactType: "machine-cross-model-ctc-arbitration" as const,
    comparisonSemanticHash: input.comparison.semanticHash,
    ctcRuntimeIdentityHash: input.ctcRuntimeIdentityHash,
    ctcModelSnapshotHash: input.ctcModelSnapshotHash,
    correlationPolicy:
      "DATA_FAMILY_CORRELATED_NOT_AN_INDEPENDENT_VOTE" as const,
    events,
    summary: {
      eligibleCount: events.length,
      favorsWhisperCount: count("CTC_FAVORS_WHISPER"),
      favorsReazonCount: count("CTC_FAVORS_REAZON"),
      ambiguousCount: count("CTC_AMBIGUOUS"),
      unscorableCount: count("CTC_UNSCORABLE"),
      inferenceCount: input.inferenceCount,
      modelLoadCount: input.modelLoadCount,
      runtimeGoldInputCount: 0 as const,
    },
  };
  return machineCrossModelCtcArbitrationSchema.parse({
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
}
