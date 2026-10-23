import {
  c6019PolicyVersion,
  machineSecondAsrDiagnosticSetSchema,
  type MachineSecondAsrDiagnosticSet,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";

interface Interval {
  start: number;
  end: number;
}

interface TargetCoreEvent {
  eventId: string;
  proposedCoreStart: number;
  proposedCoreEnd: number;
  coreSpanStatus: "VERIFIED" | "VERIFIED_WITH_CAUTION" | "AMBIGUOUS";
  evidenceIds: string[];
  semanticHash: string;
}

interface RiskEvent {
  eventId: string;
  candidateId: string;
  positiveErrorEvidenceCount: number;
  strongPositiveErrorEvidenceCount: number;
  evidenceAbsenceCount: number;
  correctnessEvidenceCount: number;
  conflictingEvidence: boolean;
  absenceOnly: boolean;
  recommendedAction: string;
  budgetSelected: boolean;
  stableTieBreakHash: string;
  semanticHash: string;
}

interface CanonicalEvent {
  eventId: string;
  acousticInterval: Interval;
  eventType: string;
  representativeCandidateId: string;
  semanticHash: string;
}

interface PoolCandidate {
  eventId: string;
  candidateId: string;
  sourceGlobalVerified: boolean;
  semanticHash: string;
}

interface DecoderCandidate {
  eventId: string;
  candidateId: string;
  availability: string;
  semanticHash: string;
}

export function buildMachineSecondAsrDiagnosticSet(input: {
  generatedAt: string;
  sourceMediaSha256: string;
  upstreamTargetSemanticHash: string;
  targetEvents: readonly TargetCoreEvent[];
  riskEvents: readonly RiskEvent[];
  canonicalEvents: readonly CanonicalEvent[];
  poolCandidates: readonly PoolCandidate[];
  decoderCandidates: readonly DecoderCandidate[];
}): MachineSecondAsrDiagnosticSet {
  if (input.targetEvents.length !== 12) {
    throw new Error(
      "C6.0.1.9 requires the frozen 12-event C6.0.1.8 target set.",
    );
  }
  const canonicalById = new Map(
    input.canonicalEvents.map((event) => [event.eventId, event]),
  );
  const poolKeys = new Set(
    input.poolCandidates
      .filter((candidate) => candidate.sourceGlobalVerified)
      .map((candidate) => `${candidate.eventId}\u0000${candidate.candidateId}`),
  );
  const decoderKeys = new Set(
    input.decoderCandidates
      .filter((candidate) => candidate.availability === "available")
      .map((candidate) => `${candidate.eventId}\u0000${candidate.candidateId}`),
  );
  const targetIds = new Set(input.targetEvents.map((event) => event.eventId));
  const controls = input.riskEvents
    .filter((risk) => {
      const canonical = canonicalById.get(risk.eventId);
      return (
        !targetIds.has(risk.eventId) &&
        !risk.budgetSelected &&
        risk.recommendedAction === "KEEP" &&
        risk.positiveErrorEvidenceCount === 0 &&
        risk.strongPositiveErrorEvidenceCount === 0 &&
        risk.evidenceAbsenceCount === 0 &&
        risk.correctnessEvidenceCount >= 8 &&
        !risk.conflictingEvidence &&
        !risk.absenceOnly &&
        canonical?.eventType === "SINGLE_UTTERANCE" &&
        canonical.acousticInterval.end > canonical.acousticInterval.start &&
        canonical.acousticInterval.end - canonical.acousticInterval.start <=
          28.2 &&
        poolKeys.has(`${risk.eventId}\u0000${risk.candidateId}`) &&
        decoderKeys.has(`${risk.eventId}\u0000${risk.candidateId}`)
      );
    })
    .toSorted((left, right) =>
      left.stableTieBreakHash.localeCompare(right.stableTieBreakHash),
    )
    .slice(0, 12);
  if (controls.length !== 12) {
    throw new Error(
      `C6.0.1.9 needs 12 eligible machine controls; found ${controls.length}.`,
    );
  }
  const targetEvents = input.targetEvents.map((event) => {
    const core = {
      eventId: event.eventId,
      role: "TARGET" as const,
      coreInterval: {
        start: event.proposedCoreStart,
        end: event.proposedCoreEnd,
      },
      coreStatus:
        event.coreSpanStatus === "VERIFIED"
          ? ("VERIFIED" as const)
          : ("VERIFIED_WITH_CAUTION" as const),
      selectionReasons: [
        "FROZEN_C6_0_1_8_TARGET",
        `CORE_${event.coreSpanStatus}`,
      ],
      machineEvidenceIds: [...event.evidenceIds, event.semanticHash],
    };
    return { ...core, semanticHash: machineQualitySemanticHash(core) };
  });
  const controlEvents = controls.map((risk) => {
    const canonical = canonicalById.get(risk.eventId);
    if (canonical === undefined)
      throw new Error(`Missing canonical control ${risk.eventId}.`);
    const core = {
      eventId: risk.eventId,
      role: "CONTROL" as const,
      coreInterval: canonical.acousticInterval,
      coreStatus: "MACHINE_CONTROL_CORE" as const,
      selectionReasons: [
        "MACHINE_LOW_RISK_KEEP",
        "SOURCE_GLOBAL_VERIFIED",
        "DECODER_EVIDENCE_AVAILABLE",
        "SINGLE_UTTERANCE",
        "STABLE_TIE_BREAK_SELECTION",
      ],
      machineEvidenceIds: [risk.semanticHash, canonical.semanticHash],
    };
    return { ...core, semanticHash: machineQualitySemanticHash(core) };
  });
  const core = {
    schemaVersion: "1.0.0" as const,
    policyVersion: c6019PolicyVersion,
    generatedAt: input.generatedAt,
    artifactType: "machine-second-asr-diagnostic-set" as const,
    sourceMediaSha256: input.sourceMediaSha256,
    upstreamTargetSemanticHash: input.upstreamTargetSemanticHash,
    selectionPolicy:
      "c6018-targets-plus-machine-low-risk-core-localizable-controls-v1" as const,
    targetEventIds: targetEvents.map((event) => event.eventId),
    controlEventIds: controlEvents.map((event) => event.eventId),
    events: [...targetEvents, ...controlEvents],
    frozenBeforeGold: true as const,
    runtimeGoldInputCount: 0 as const,
  };
  return machineSecondAsrDiagnosticSetSchema.parse({
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
}
