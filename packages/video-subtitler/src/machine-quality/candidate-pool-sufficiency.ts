import {
  machineCandidatePoolSufficiencySchema,
  type MachineCandidatePoolSufficiency,
  type MachineTextVariantAcousticVerification,
  type MachineTextVariantDecision,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";

export interface PoolSufficiencyEventInput {
  eventId: string;
  candidateCount: number;
  independentWindowDisagreement: boolean;
  trustedTokenConflict: boolean;
  fullSpeechSpanCovered: boolean;
  reAsrStability?: "STRONG" | "WEAK" | "UNSTABLE" | "NO_RESULT";
}

export function assessCandidatePoolSufficiency(input: {
  events: readonly PoolSufficiencyEventInput[];
  acousticVerification: MachineTextVariantAcousticVerification;
  decisions: MachineTextVariantDecision;
  generatedAt?: string;
}): MachineCandidatePoolSufficiency {
  const acousticByEvent = new Map(
    input.acousticVerification.events.map((event) => [event.eventId, event]),
  );
  const decisionByEvent = new Map(
    input.decisions.decisions.map((decision) => [decision.eventId, decision]),
  );
  const events = [...input.events]
    .toSorted((left, right) => left.eventId.localeCompare(right.eventId))
    .map((event) => {
      const acoustic = acousticByEvent.get(event.eventId);
      const decision = decisionByEvent.get(event.eventId);
      const signals: (
        | "ALL_CTC_COVERAGE_LOW"
        | "TRUSTED_TOKEN_CONFLICT"
        | "HIGH_EDGE_TRUNCATION"
        | "INDEPENDENT_WINDOW_DISAGREEMENT"
        | "NO_FULL_SPEECH_SPAN_COVERAGE"
        | "UNSTABLE_REASR_OUTPUT"
        | "CLEAR_ACOUSTIC_WINNER"
        | "SINGLE_VARIANT_NO_INDEPENDENT_SUPPORT"
      )[] = [];
      if (
        acoustic?.ctcEvidence.every(
          (evidence) =>
            evidence.alignmentCoverage < 0.55 ||
            evidence.evidenceStatus !== "CTC_SCORABLE",
        ) === true
      ) {
        signals.push("ALL_CTC_COVERAGE_LOW");
      }
      if (event.trustedTokenConflict) signals.push("TRUSTED_TOKEN_CONFLICT");
      if (
        acoustic?.ctcEvidence.every((evidence) => evidence.edgePinned) === true
      ) {
        signals.push("HIGH_EDGE_TRUNCATION");
      }
      if (event.independentWindowDisagreement) {
        signals.push("INDEPENDENT_WINDOW_DISAGREEMENT");
      }
      if (!event.fullSpeechSpanCovered) {
        signals.push("NO_FULL_SPEECH_SPAN_COVERAGE");
      }
      if (event.reAsrStability === "UNSTABLE") {
        signals.push("UNSTABLE_REASR_OUTPUT");
      }
      if (
        acoustic?.selectedByAcousticEvidence !== null &&
        acoustic !== undefined
      ) {
        signals.push("CLEAR_ACOUSTIC_WINNER");
      }
      if (event.candidateCount === 1 && decision?.confidenceClass !== "HIGH") {
        signals.push("SINGLE_VARIANT_NO_INDEPENDENT_SUPPORT");
      }
      const severeInsufficiencySignals = signals.filter((signal) =>
        [
          "ALL_CTC_COVERAGE_LOW",
          "TRUSTED_TOKEN_CONFLICT",
          "NO_FULL_SPEECH_SPAN_COVERAGE",
          "UNSTABLE_REASR_OUTPUT",
        ].includes(signal),
      );
      const status = signals.includes("CLEAR_ACOUSTIC_WINNER")
        ? ("SUFFICIENT" as const)
        : severeInsufficiencySignals.length >= 2 ||
            decision?.decisionStatus === "NO_ACOUSTICALLY_SUPPORTED_VARIANT"
          ? ("INSUFFICIENT" as const)
          : decision?.decisionStatus === "AMBIGUOUS_VARIANT" ||
              signals.includes("INDEPENDENT_WINDOW_DISAGREEMENT") ||
              signals.includes("HIGH_EDGE_TRUNCATION")
            ? ("AMBIGUOUS" as const)
            : ("UNKNOWN" as const);
      const reasons =
        signals.length === 0
          ? ["runtime-evidence-does-not-establish-pool-sufficiency"]
          : signals.map((signal) =>
              signal.toLocaleLowerCase().replaceAll("_", "-"),
            );
      const core = { eventId: event.eventId, status, signals, reasons };
      return { ...core, semanticHash: machineQualitySemanticHash(core) };
    });
  const core = {
    events,
    summary: {
      eventCount: events.length,
      sufficientCount: events.filter((event) => event.status === "SUFFICIENT")
        .length,
      ambiguousCount: events.filter((event) => event.status === "AMBIGUOUS")
        .length,
      insufficientCount: events.filter(
        (event) => event.status === "INSUFFICIENT",
      ).length,
      unknownCount: events.filter((event) => event.status === "UNKNOWN").length,
    },
  };
  return machineCandidatePoolSufficiencySchema.parse({
    schemaVersion: "1.0.0",
    policyVersion: "c6.0.1.4-vad-timebase-acoustic-text-variant-reasr-v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    artifactType: "machine-candidate-pool-sufficiency",
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
}
