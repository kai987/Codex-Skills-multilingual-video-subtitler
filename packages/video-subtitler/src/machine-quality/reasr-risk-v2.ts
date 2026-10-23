import {
  c6017PolicyVersion,
  machineReAsrRiskV2Schema,
  reAsrRiskFactV2Schema,
  type AcousticRiskFact,
  type AcousticRiskVectorEntry,
  type C6017Mode,
  type MachineReAsrRiskV2,
  type ReAsrEvidenceClass,
  type ReAsrProviderFamily,
  type ReAsrRiskEventV2,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";

export const C6017_RE_ASR_EVENT_BUDGET = 12;
export const C6017_RE_ASR_REQUEST_BUDGET = 36;
export const C6017_RE_ASR_REQUESTS_PER_EVENT = 3;

const priorityRank = new Map([
  ["CRITICAL", 0],
  ["HIGH", 1],
  ["MEDIUM", 2],
  ["LOW", 3],
  ["NONE", 4],
]);

function providerFamily(fact: AcousticRiskFact): ReAsrProviderFamily {
  if (fact.correlationGroup === "OVERLAP") return "ASSOCIATION";
  return fact.correlationGroup;
}

function active(fact: AcousticRiskFact): boolean {
  return fact.severity !== "NONE";
}

function evidenceClass(fact: AcousticRiskFact): ReAsrEvidenceClass {
  if (fact.name === "tokenWeak") {
    return active(fact) ? "EVIDENCE_ABSENCE" : "POSITIVE_CORRECTNESS_EVIDENCE";
  }
  if (fact.name === "ctcUnscorable" || fact.name === "decoderUnknown") {
    return active(fact) ? "EVIDENCE_ABSENCE" : "UNKNOWN";
  }
  if (
    fact.name === "tokenConflict" ||
    fact.name === "requestEdgeRisk" ||
    fact.name === "speechIncomplete" ||
    fact.name === "independentWindowDisagreement" ||
    fact.name === "noSpeechConflict" ||
    fact.name === "durationTextAnomaly"
  ) {
    if (fact.severity === "STRONG") return "POSITIVE_ERROR_EVIDENCE";
    if (fact.severity === "WEAK") return "SUPPORTING_ERROR_EVIDENCE";
    return fact.severity === "NONE"
      ? "POSITIVE_CORRECTNESS_EVIDENCE"
      : "UNKNOWN";
  }
  if (
    fact.name === "ctcWeak" ||
    fact.name === "decoderWeak" ||
    fact.name === "repetitionRisk" ||
    fact.name === "pronunciationCoverageWeak"
  ) {
    return fact.severity === "WEAK" || fact.severity === "STRONG"
      ? "SUPPORTING_ERROR_EVIDENCE"
      : fact.severity === "NONE"
        ? "POSITIVE_CORRECTNESS_EVIDENCE"
        : "UNKNOWN";
  }
  return active(fact) ? "CONFLICTING_EVIDENCE" : "UNKNOWN";
}

export function reclassifyRiskFactV2(fact: AcousticRiskFact) {
  const classification = evidenceClass(fact);
  const core = {
    factType: fact.name,
    evidenceClass: classification,
    severity: fact.severity,
    providerFamily: providerFamily(fact),
    positiveErrorEvidence: classification === "POSITIVE_ERROR_EVIDENCE",
    evidenceMissing: classification === "EVIDENCE_ABSENCE",
    sourceEvidenceIds: [...new Set(fact.evidenceIds)].toSorted(),
    reasons: [
      ...new Set([
        ...fact.reasons,
        `evidence-class:${classification}`,
        fact.name === "tokenWeak" && active(fact)
          ? "low-token-coverage-is-absence-not-error"
          : `risk-severity:${fact.severity}`,
      ]),
    ],
  };
  return reAsrRiskFactV2Schema.parse({
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
}

function classifyEvent(
  event: AcousticRiskVectorEntry,
): Omit<ReAsrRiskEventV2, "budgetSelected" | "semanticHash"> {
  const riskFacts = event.facts.map(reclassifyRiskFactV2);
  const activeFacts = riskFacts.filter((fact) => fact.severity !== "NONE");
  const positive = activeFacts.filter(
    (fact) => fact.evidenceClass === "POSITIVE_ERROR_EVIDENCE",
  );
  const strongPositive = positive.filter((fact) => fact.severity === "STRONG");
  const supportingFamilies = [
    ...new Set(
      activeFacts
        .filter((fact) => fact.evidenceClass === "SUPPORTING_ERROR_EVIDENCE")
        .map((fact) => fact.providerFamily),
    ),
  ].toSorted();
  const evidenceAbsenceCount = activeFacts.filter(
    (fact) => fact.evidenceClass === "EVIDENCE_ABSENCE",
  ).length;
  const correctnessEvidenceCount = riskFacts.filter(
    (fact) => fact.evidenceClass === "POSITIVE_CORRECTNESS_EVIDENCE",
  ).length;
  const conflictingEvidence = activeFacts.some(
    (fact) => fact.evidenceClass === "CONFLICTING_EVIDENCE",
  );
  const independentWindow = positive.some(
    (fact) => fact.factType === "independentWindowDisagreement",
  );
  const incompleteSpeech = strongPositive.some(
    (fact) => fact.factType === "speechIncomplete",
  );
  const eligibility =
    strongPositive.length >= 1 ||
    supportingFamilies.length >= 2 ||
    independentWindow ||
    incompleteSpeech;
  const structuralReview = activeFacts.some(
    (fact) =>
      fact.evidenceClass === "CONFLICTING_EVIDENCE" &&
      fact.severity === "STRONG",
  );
  const absenceOnly =
    evidenceAbsenceCount > 0 &&
    positive.length === 0 &&
    supportingFamilies.length === 0 &&
    !conflictingEvidence;
  const recommendedAction = structuralReview
    ? ("REVIEW" as const)
    : eligibility
      ? ("RE_ASR" as const)
      : absenceOnly || activeFacts.length > 0
        ? ("VERIFY" as const)
        : ("KEEP" as const);
  const priorityClass =
    strongPositive.length >= 2 ||
    (strongPositive.length >= 1 && supportingFamilies.length >= 2)
      ? ("CRITICAL" as const)
      : strongPositive.length >= 1
        ? ("HIGH" as const)
        : supportingFamilies.length >= 2
          ? ("MEDIUM" as const)
          : recommendedAction === "VERIFY"
            ? ("LOW" as const)
            : ("NONE" as const);
  const stableTieBreakHash = machineQualitySemanticHash({
    candidateId: event.candidateId,
    facts: riskFacts.map((fact) => ({
      factType: fact.factType,
      evidenceClass: fact.evidenceClass,
      severity: fact.severity,
      providerFamily: fact.providerFamily,
    })),
  });
  return {
    eventId: event.eventId,
    candidateId: event.candidateId,
    riskFacts,
    positiveErrorEvidenceCount: positive.length,
    strongPositiveErrorEvidenceCount: strongPositive.length,
    supportingEvidenceFamilies: supportingFamilies,
    evidenceAbsenceCount,
    correctnessEvidenceCount,
    conflictingEvidence,
    absenceOnly,
    eligibility,
    recommendedAction,
    priorityClass,
    selectionReason: eligibility
      ? `eligible:${priorityClass.toLowerCase()}-positive-semantics-v2`
      : absenceOnly
        ? "not-eligible:evidence-absence-only"
        : `not-eligible:${recommendedAction.toLowerCase()}`,
    stableTieBreakHash,
  };
}

export function buildMachineReAsrRiskV2(input: {
  mode: C6017Mode;
  riskVector: readonly AcousticRiskVectorEntry[];
  generatedAt?: string;
}): MachineReAsrRiskV2 {
  const unselected = input.riskVector.map(classifyEvent);
  const selectedIds = new Set(
    (input.mode === "off" ? [] : unselected)
      .filter((event) => event.eligibility)
      .toSorted(
        (left, right) =>
          (priorityRank.get(left.priorityClass) ?? 99) -
            (priorityRank.get(right.priorityClass) ?? 99) ||
          right.strongPositiveErrorEvidenceCount -
            left.strongPositiveErrorEvidenceCount ||
          right.supportingEvidenceFamilies.length -
            left.supportingEvidenceFamilies.length ||
          left.stableTieBreakHash.localeCompare(right.stableTieBreakHash),
      )
      .slice(0, C6017_RE_ASR_EVENT_BUDGET)
      .map((event) => event.eventId),
  );
  const events = unselected
    .map((event) => {
      const budgetSelected = selectedIds.has(event.eventId);
      const core = {
        ...event,
        selectionReason: budgetSelected
          ? `${event.selectionReason};budget-selected`
          : event.eligibility
            ? `${event.selectionReason};budget-not-selected`
            : event.selectionReason,
        budgetSelected,
      };
      return { ...core, semanticHash: machineQualitySemanticHash(core) };
    })
    .toSorted(
      (left, right) =>
        Number(right.budgetSelected) - Number(left.budgetSelected) ||
        (priorityRank.get(left.priorityClass) ?? 99) -
          (priorityRank.get(right.priorityClass) ?? 99) ||
        left.stableTieBreakHash.localeCompare(right.stableTieBreakHash),
    );
  const summary = {
    eventCount: events.length,
    oldEligibleCount: input.riskVector.filter(
      (event) => event.recommendedAction === "RE_ASR",
    ).length,
    eligibleCount: events.filter((event) => event.eligibility).length,
    positiveErrorEvidenceEventCount: events.filter(
      (event) => event.positiveErrorEvidenceCount > 0,
    ).length,
    supportingMultiFamilyEventCount: events.filter(
      (event) => event.supportingEvidenceFamilies.length >= 2,
    ).length,
    evidenceAbsenceOnlyEventCount: events.filter((event) => event.absenceOnly)
      .length,
    selectedEventCount: selectedIds.size,
    selectedAbsenceOnlyEventCount: events.filter(
      (event) => event.budgetSelected && event.absenceOnly,
    ).length,
    plannedRequestCount: selectedIds.size * C6017_RE_ASR_REQUESTS_PER_EVENT,
  };
  const core = {
    mode: input.mode,
    semantics: "positive-error-vs-evidence-absence-v2" as const,
    triggerPolicy:
      "one-strong-positive-or-two-supporting-provider-families-or-independent-window-or-incomplete-speech" as const,
    episodeRequestBudget: C6017_RE_ASR_REQUEST_BUDGET as 36,
    maximumRequestsPerEvent: C6017_RE_ASR_REQUESTS_PER_EVENT as 3,
    events,
    summary,
  };
  return machineReAsrRiskV2Schema.parse({
    schemaVersion: "1.0.0",
    policyVersion: c6017PolicyVersion,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    artifactType: "machine-reasr-risk-v2",
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
}
