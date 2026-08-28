import {
  c6016PolicyVersion,
  machineReAsrPrioritySchema,
  type AcousticRiskVectorEntry,
  type C6016Mode,
  type MachineReAsrPriority,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";

export const C6016_RE_ASR_EPISODE_REQUEST_BUDGET = 36;
export const C6016_RE_ASR_MAXIMUM_REQUESTS_PER_EVENT = 3;

const priorityRank = new Map([
  ["CRITICAL", 0],
  ["HIGH", 1],
  ["MEDIUM", 2],
  ["LOW", 3],
  ["NONE", 4],
]);

function priorityClass(event: AcousticRiskVectorEntry) {
  if (event.strongRiskCount >= 2) return "CRITICAL" as const;
  if (event.strongRiskCount >= 1) return "HIGH" as const;
  if (event.independentWeakRiskCount >= 2) return "MEDIUM" as const;
  if (event.recommendedAction === "VERIFY") return "LOW" as const;
  return "NONE" as const;
}

export function buildMachineReAsrPriority(input: {
  mode: C6016Mode;
  riskVector: readonly AcousticRiskVectorEntry[];
  recoverabilitySignalsByEvent?: ReadonlyMap<string, readonly string[]>;
  episodeRequestBudget?: number;
  maximumRequestsPerEvent?: number;
  generatedAt?: string;
}): MachineReAsrPriority {
  const episodeRequestBudget = Math.min(
    C6016_RE_ASR_EPISODE_REQUEST_BUDGET,
    input.episodeRequestBudget ?? C6016_RE_ASR_EPISODE_REQUEST_BUDGET,
  );
  const maximumRequestsPerEvent = Math.min(
    C6016_RE_ASR_MAXIMUM_REQUESTS_PER_EVENT,
    input.maximumRequestsPerEvent ?? C6016_RE_ASR_MAXIMUM_REQUESTS_PER_EVENT,
  );
  const unselected = input.riskVector.map((event) => {
    const activeFacts = event.facts.filter(
      (entry) => entry.severity === "STRONG" || entry.severity === "WEAK",
    );
    const recoverabilitySignals = [
      ...new Set(input.recoverabilitySignalsByEvent?.get(event.eventId) ?? []),
    ].toSorted();
    const currentPriority = priorityClass(event);
    const stableTieBreakHash = machineQualitySemanticHash({
      candidateId: event.candidateId,
      activeFacts: activeFacts.map((entry) => ({
        name: entry.name,
        severity: entry.severity,
        correlationGroup: entry.correlationGroup,
      })),
      recoverabilitySignals,
    });
    const eligible =
      event.recommendedAction === "RE_ASR" &&
      (event.strongRiskCount >= 1 || event.independentWeakRiskCount >= 2);
    return {
      eventId: event.eventId,
      candidateId: event.candidateId,
      riskFacts: activeFacts,
      correlationGroups: event.activeCorrelationGroups,
      strongRiskCount: event.strongRiskCount,
      independentWeakRiskCount: event.independentWeakRiskCount,
      evidenceDiversityCount: event.activeCorrelationGroups.length,
      recoverabilitySignals,
      recommendedAction: event.recommendedAction,
      priorityClass: currentPriority,
      selectionReason: eligible
        ? `eligible:${currentPriority.toLowerCase()}-risk-driven`
        : `not-eligible:${event.recommendedAction.toLowerCase()}`,
      stableTieBreakHash,
      eligible,
    };
  });
  const rankedEligible = unselected
    .filter((event) => event.eligible)
    .toSorted(
      (left, right) =>
        (priorityRank.get(left.priorityClass) ?? 99) -
          (priorityRank.get(right.priorityClass) ?? 99) ||
        right.evidenceDiversityCount - left.evidenceDiversityCount ||
        right.recoverabilitySignals.length -
          left.recoverabilitySignals.length ||
        left.stableTieBreakHash.localeCompare(right.stableTieBreakHash),
    );
  const maximumEvents = Math.floor(
    episodeRequestBudget / maximumRequestsPerEvent,
  );
  const selectedIds = new Set(
    rankedEligible.slice(0, maximumEvents).map((event) => event.eventId),
  );
  const events = unselected
    .map(({ eligible: _eligible, ...event }) => {
      const budgetSelected = selectedIds.has(event.eventId);
      const core = {
        ...event,
        selectionReason: budgetSelected
          ? `${event.selectionReason};budget-selected`
          : event.recommendedAction === "RE_ASR"
            ? `${event.selectionReason};budget-not-selected`
            : event.selectionReason,
        budgetSelected,
      };
      return { ...core, semanticHash: machineQualitySemanticHash(core) };
    })
    .toSorted(
      (left, right) =>
        (priorityRank.get(left.priorityClass) ?? 99) -
          (priorityRank.get(right.priorityClass) ?? 99) ||
        right.evidenceDiversityCount - left.evidenceDiversityCount ||
        right.recoverabilitySignals.length -
          left.recoverabilitySignals.length ||
        left.stableTieBreakHash.localeCompare(right.stableTieBreakHash),
    );
  const eligibleCount = rankedEligible.length;
  const budgetSelectedCount = selectedIds.size;
  const summary = {
    eventCount: events.length,
    eligibleCount,
    budgetSelectedCount,
    budgetExhaustedCount: Math.max(0, eligibleCount - budgetSelectedCount),
    requestBudgetUsed: budgetSelectedCount * maximumRequestsPerEvent,
  };
  const core = {
    mode: input.mode,
    eligibilityPolicy: "one-strong-or-two-independent-weak" as const,
    orderingPolicy:
      "priority-diversity-recoverability-stable-hash-no-event-id" as const,
    episodeRequestBudget,
    maximumRequestsPerEvent,
    events,
    summary,
  };
  return machineReAsrPrioritySchema.parse({
    schemaVersion: "1.0.0",
    policyVersion: c6016PolicyVersion,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    artifactType: "machine-reasr-priority",
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
}
