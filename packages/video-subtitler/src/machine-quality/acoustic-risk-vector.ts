import {
  acousticRiskVectorEntrySchema,
  c6016PolicyVersion,
  machineAcousticRiskVectorSchema,
  type AcousticRiskFact,
  type AcousticRiskVectorEntry,
  type C6016Mode,
  type MachineAcousticRiskVector,
  type RiskCorrelationGroup,
  type RiskFactName,
  type RiskSeverity,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";

export interface AcousticRiskInput {
  eventId: string;
  candidateId: string;
  requestEdgeRisk?: RiskSeverity;
  requestEdgeEvidenceIds?: readonly string[];
  ctcScore: number | null;
  ctcEvidenceIds?: readonly string[];
  tokenCoverage: number;
  tokenConflict?: boolean;
  tokenEvidenceIds?: readonly string[];
  speechCoverage: number;
  speechEvidenceIds?: readonly string[];
  decoderAvailability: "available" | "unavailable" | "unsupported" | "unknown";
  averageLogProbability: number | null;
  noSpeechProbability: number | null;
  decoderEvidenceIds?: readonly string[];
  independentWindowDisagreement?: "NONE" | "WEAK" | "STRONG";
  crossWindowEvidenceIds?: readonly string[];
  repetitionRisk?: number;
  durationTextAnomaly?: "NONE" | "WEAK" | "STRONG";
  pronunciationCoverage?: number | null;
  associationAmbiguity?: "NONE" | "WEAK" | "STRONG";
  overlapRisk?: "NONE" | "WEAK" | "STRONG";
}

const factOrder: readonly RiskFactName[] = [
  "requestEdgeRisk",
  "ctcWeak",
  "ctcUnscorable",
  "tokenWeak",
  "tokenConflict",
  "speechIncomplete",
  "decoderWeak",
  "decoderUnknown",
  "independentWindowDisagreement",
  "repetitionRisk",
  "noSpeechConflict",
  "durationTextAnomaly",
  "pronunciationCoverageWeak",
  "associationAmbiguity",
  "overlapRisk",
];

function fact(input: {
  name: RiskFactName;
  severity: RiskSeverity;
  correlationGroup: RiskCorrelationGroup;
  evidenceIds?: readonly string[] | undefined;
  reasons?: readonly string[] | undefined;
}): AcousticRiskFact {
  return {
    name: input.name,
    severity: input.severity,
    correlationGroup: input.correlationGroup,
    evidenceIds: [...new Set(input.evidenceIds ?? [])].toSorted(),
    reasons: [...new Set(input.reasons ?? [`severity:${input.severity}`])],
  };
}

function boundedRatio(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function weakOrStrong(
  value: number,
  weakThreshold: number,
  strongThreshold: number,
  direction: "below" | "above",
): RiskSeverity {
  if (direction === "below") {
    if (value < strongThreshold) return "STRONG";
    if (value < weakThreshold) return "WEAK";
  } else {
    if (value > strongThreshold) return "STRONG";
    if (value > weakThreshold) return "WEAK";
  }
  return "NONE";
}

function explicitSeverity(
  value: "NONE" | "WEAK" | "STRONG" | undefined,
): RiskSeverity {
  return value ?? "NONE";
}

export function buildAcousticRiskVectorEntry(
  input: AcousticRiskInput,
): AcousticRiskVectorEntry {
  const ctcSeverity =
    input.ctcScore === null
      ? "NONE"
      : weakOrStrong(input.ctcScore, 0.55, 0.2, "below");
  const tokenCoverage = boundedRatio(input.tokenCoverage);
  const speechCoverage = boundedRatio(input.speechCoverage);
  const decoderWeak =
    input.decoderAvailability !== "available"
      ? "NONE"
      : input.averageLogProbability !== null &&
          input.averageLogProbability < -1.5
        ? "STRONG"
        : (input.averageLogProbability !== null &&
              input.averageLogProbability < -1.2) ||
            (input.noSpeechProbability !== null &&
              input.noSpeechProbability > 0.6)
          ? "WEAK"
          : "NONE";
  const noSpeechConflict =
    input.decoderAvailability === "available" &&
    input.noSpeechProbability !== null
      ? weakOrStrong(input.noSpeechProbability, 0.6, 0.8, "above")
      : "NONE";
  const repetition = boundedRatio(input.repetitionRisk ?? 0);
  const pronunciation = input.pronunciationCoverage;
  const facts: AcousticRiskFact[] = [
    fact({
      name: "requestEdgeRisk",
      severity: input.requestEdgeRisk ?? "UNKNOWN",
      correlationGroup: "REQUEST_EDGE",
      evidenceIds: input.requestEdgeEvidenceIds,
      reasons: [`request-edge-risk:${input.requestEdgeRisk ?? "UNKNOWN"}`],
    }),
    fact({
      name: "ctcWeak",
      severity: ctcSeverity,
      correlationGroup: "CTC",
      evidenceIds: input.ctcEvidenceIds,
      reasons: [
        `ctc-score:${input.ctcScore === null ? "unavailable" : input.ctcScore.toFixed(6)}`,
      ],
    }),
    fact({
      name: "ctcUnscorable",
      severity: input.ctcScore === null ? "UNKNOWN" : "NONE",
      correlationGroup: "CTC",
      evidenceIds: input.ctcEvidenceIds,
      reasons: [
        input.ctcScore === null
          ? "ctc-score-unavailable"
          : "ctc-score-available",
      ],
    }),
    fact({
      name: "tokenWeak",
      severity: weakOrStrong(tokenCoverage, 0.4, 0.2, "below"),
      correlationGroup: "TOKEN",
      evidenceIds: input.tokenEvidenceIds,
      reasons: [`token-coverage:${tokenCoverage.toFixed(6)}`],
    }),
    fact({
      name: "tokenConflict",
      severity: input.tokenConflict ? "STRONG" : "NONE",
      correlationGroup: "TOKEN",
      evidenceIds: input.tokenEvidenceIds,
      reasons: [input.tokenConflict ? "token-conflict" : "no-token-conflict"],
    }),
    fact({
      name: "speechIncomplete",
      severity: weakOrStrong(speechCoverage, 0.85, 0.7, "below"),
      correlationGroup: "SPEECH_VAD",
      evidenceIds: input.speechEvidenceIds,
      reasons: [`speech-coverage:${speechCoverage.toFixed(6)}`],
    }),
    fact({
      name: "decoderWeak",
      severity: decoderWeak,
      correlationGroup: "DECODER",
      evidenceIds: input.decoderEvidenceIds,
      reasons: [
        `average-log-probability:${input.averageLogProbability === null ? "unavailable" : input.averageLogProbability.toFixed(6)}`,
        `no-speech-probability:${input.noSpeechProbability === null ? "unavailable" : input.noSpeechProbability.toFixed(6)}`,
      ],
    }),
    fact({
      name: "decoderUnknown",
      severity: input.decoderAvailability === "available" ? "NONE" : "UNKNOWN",
      correlationGroup: "DECODER",
      evidenceIds: input.decoderEvidenceIds,
      reasons: [`decoder-availability:${input.decoderAvailability}`],
    }),
    fact({
      name: "independentWindowDisagreement",
      severity: explicitSeverity(input.independentWindowDisagreement),
      correlationGroup: "CROSS_WINDOW",
      evidenceIds: input.crossWindowEvidenceIds,
    }),
    fact({
      name: "repetitionRisk",
      severity: weakOrStrong(repetition, 0.4, 0.7, "above"),
      correlationGroup: "TEXT_SHAPE",
      reasons: [`repetition-risk:${repetition.toFixed(6)}`],
    }),
    fact({
      name: "noSpeechConflict",
      severity: noSpeechConflict,
      correlationGroup: "DECODER",
      evidenceIds: input.decoderEvidenceIds,
      reasons: [
        `no-speech-probability:${input.noSpeechProbability === null ? "unavailable" : input.noSpeechProbability.toFixed(6)}`,
      ],
    }),
    fact({
      name: "durationTextAnomaly",
      severity: explicitSeverity(input.durationTextAnomaly),
      correlationGroup: "TEXT_SHAPE",
    }),
    fact({
      name: "pronunciationCoverageWeak",
      severity:
        pronunciation === null || pronunciation === undefined
          ? "UNKNOWN"
          : weakOrStrong(boundedRatio(pronunciation), 0.55, 0.25, "below"),
      correlationGroup: "CTC",
      evidenceIds: input.ctcEvidenceIds,
      reasons: [
        `pronunciation-coverage:${pronunciation === null || pronunciation === undefined ? "unavailable" : boundedRatio(pronunciation).toFixed(6)}`,
      ],
    }),
    fact({
      name: "associationAmbiguity",
      severity: explicitSeverity(input.associationAmbiguity),
      correlationGroup: "ASSOCIATION",
    }),
    fact({
      name: "overlapRisk",
      severity: explicitSeverity(input.overlapRisk),
      correlationGroup: "OVERLAP",
    }),
  ];
  const strongRiskCount = facts.filter(
    (entry) => entry.severity === "STRONG",
  ).length;
  const weakFacts = facts.filter((entry) => entry.severity === "WEAK");
  const independentWeakRiskCount = new Set(
    weakFacts.map((entry) => entry.correlationGroup),
  ).size;
  const activeCorrelationGroups = [
    ...new Set(
      facts
        .filter(
          (entry) => entry.severity === "WEAK" || entry.severity === "STRONG",
        )
        .map((entry) => entry.correlationGroup),
    ),
  ].toSorted();
  const structuralReview = facts.some(
    (entry) =>
      (entry.name === "associationAmbiguity" || entry.name === "overlapRisk") &&
      entry.severity === "STRONG",
  );
  const recommendedAction = structuralReview
    ? ("REVIEW" as const)
    : strongRiskCount >= 1 || independentWeakRiskCount >= 2
      ? ("RE_ASR" as const)
      : weakFacts.length > 0 ||
          facts.some((entry) => entry.severity === "UNKNOWN")
        ? ("VERIFY" as const)
        : ("KEEP" as const);
  const reasons = [
    `strong-risk-count:${strongRiskCount}`,
    `weak-risk-count:${weakFacts.length}`,
    `independent-weak-risk-count:${independentWeakRiskCount}`,
    `recommended-action:${recommendedAction}`,
  ];
  const core = {
    eventId: input.eventId,
    candidateId: input.candidateId,
    facts: factOrder.flatMap((name) => {
      const fact = facts.find((entry) => entry.name === name);
      return fact === undefined ? [] : [fact];
    }),
    strongRiskCount,
    weakRiskCount: weakFacts.length,
    independentWeakRiskCount,
    activeCorrelationGroups,
    recommendedAction,
    reasons,
  };
  return acousticRiskVectorEntrySchema.parse({
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
}

export function buildMachineAcousticRiskVector(input: {
  mode: C6016Mode;
  events: readonly AcousticRiskInput[];
  generatedAt?: string;
}): MachineAcousticRiskVector {
  const events = input.events
    .map(buildAcousticRiskVectorEntry)
    .toSorted(
      (left, right) =>
        left.eventId.localeCompare(right.eventId) ||
        left.candidateId.localeCompare(right.candidateId),
    );
  const summary = {
    eventCount: events.length,
    multiRiskEventCount: events.filter(
      (event) => event.strongRiskCount + event.weakRiskCount >= 2,
    ).length,
    keepCount: events.filter((event) => event.recommendedAction === "KEEP")
      .length,
    verifyCount: events.filter((event) => event.recommendedAction === "VERIFY")
      .length,
    reAsrCount: events.filter((event) => event.recommendedAction === "RE_ASR")
      .length,
    reviewCount: events.filter((event) => event.recommendedAction === "REVIEW")
      .length,
    strongRiskEventCount: events.filter((event) => event.strongRiskCount > 0)
      .length,
    independentWeakRiskEventCount: events.filter(
      (event) => event.independentWeakRiskCount >= 2,
    ).length,
  };
  const core = {
    mode: input.mode,
    decisionPolicy: "multi-label-no-magic-total-score" as const,
    events,
    summary,
  };
  return machineAcousticRiskVectorSchema.parse({
    schemaVersion: "1.0.0",
    policyVersion: c6016PolicyVersion,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    artifactType: "machine-acoustic-risk-vector",
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
}
