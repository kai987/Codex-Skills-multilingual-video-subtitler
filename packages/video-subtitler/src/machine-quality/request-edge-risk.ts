import {
  c6016PolicyVersion,
  machineRequestEdgeRiskSchema,
  type C6016Mode,
  type MachineRequestEdgeRisk,
  type RequestEdgeRiskEntry,
  type RiskSeverity,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";

export const C6016_REQUEST_EDGE_DISTANCE_SECONDS = 0.35;

export interface RequestEdgeRiskInput {
  eventId: string;
  candidateId: string;
  requestId: string;
  requestInterval: { start: number; end: number } | null;
  candidateInterval: { start: number; end: number };
  speechContinuationLeft?: boolean;
  speechContinuationRight?: boolean;
  tokenEdgeContact?: boolean;
  ctcIncomplete?: boolean;
  decoderSuggestsTruncation?: boolean;
  independentContinuation?: boolean;
  incompleteAcousticSpan?: boolean;
  evidenceIds?: readonly string[];
}

function classifyRisk(input: {
  nearEdge: boolean;
  speechContinuation: boolean;
  tokenEdgeContact: boolean;
  ctcIncomplete: boolean;
  decoderSuggestsTruncation: boolean;
  independentContinuation: boolean;
  incompleteAcousticSpan: boolean;
}): RiskSeverity {
  if (!input.nearEdge) return "NONE";
  if (
    input.speechContinuation ||
    input.tokenEdgeContact ||
    input.ctcIncomplete ||
    input.decoderSuggestsTruncation ||
    input.independentContinuation ||
    input.incompleteAcousticSpan
  ) {
    return "STRONG";
  }
  return "WEAK";
}

export function classifyRequestEdgeRisk(
  input: Exclude<RequestEdgeRiskInput, "requestInterval"> & {
    requestInterval: { start: number; end: number };
  },
): RequestEdgeRiskEntry {
  const leftDistance = Math.max(
    0,
    input.candidateInterval.start - input.requestInterval.start,
  );
  const rightDistance = Math.max(
    0,
    input.requestInterval.end - input.candidateInterval.end,
  );
  const nearLeftRequestEdge =
    leftDistance <= C6016_REQUEST_EDGE_DISTANCE_SECONDS;
  const nearRightRequestEdge =
    rightDistance <= C6016_REQUEST_EDGE_DISTANCE_SECONDS;
  const speechContinuationLeft = input.speechContinuationLeft ?? false;
  const speechContinuationRight = input.speechContinuationRight ?? false;
  const tokenEdgeContact = input.tokenEdgeContact ?? false;
  const ctcIncomplete = input.ctcIncomplete ?? false;
  const decoderSuggestsTruncation = input.decoderSuggestsTruncation ?? false;
  const independentContinuation = input.independentContinuation ?? false;
  const incompleteAcousticSpan = input.incompleteAcousticSpan ?? false;
  const edgeRisk = classifyRisk({
    nearEdge: nearLeftRequestEdge || nearRightRequestEdge,
    speechContinuation:
      (nearLeftRequestEdge && speechContinuationLeft) ||
      (nearRightRequestEdge && speechContinuationRight),
    tokenEdgeContact,
    ctcIncomplete,
    decoderSuggestsTruncation,
    independentContinuation,
    incompleteAcousticSpan,
  });
  const reasons = [
    `left-request-edge-distance:${leftDistance.toFixed(6)}`,
    `right-request-edge-distance:${rightDistance.toFixed(6)}`,
    ...(nearLeftRequestEdge ? ["near-left-request-edge"] : []),
    ...(nearRightRequestEdge ? ["near-right-request-edge"] : []),
    ...(speechContinuationLeft ? ["speech-continuation-left"] : []),
    ...(speechContinuationRight ? ["speech-continuation-right"] : []),
    ...(tokenEdgeContact ? ["token-edge-contact"] : []),
    ...(ctcIncomplete ? ["ctc-incomplete"] : []),
    ...(decoderSuggestsTruncation ? ["decoder-suggests-truncation"] : []),
    ...(independentContinuation ? ["independent-window-continuation"] : []),
    ...(incompleteAcousticSpan ? ["incomplete-acoustic-span"] : []),
    `classification:${edgeRisk}`,
  ];
  const core = {
    eventId: input.eventId,
    candidateId: input.candidateId,
    requestId: input.requestId,
    requestInterval: input.requestInterval,
    candidateInterval: input.candidateInterval,
    leftDistance,
    rightDistance,
    nearLeftRequestEdge,
    nearRightRequestEdge,
    speechContinuationLeft,
    speechContinuationRight,
    tokenEdgeContact,
    ctcIncomplete,
    decoderSuggestsTruncation,
    independentContinuation,
    incompleteAcousticSpan,
    edgeRisk,
    strongEdgeRisk: edgeRisk === "STRONG",
    evidenceIds: [...new Set(input.evidenceIds ?? [])].toSorted(),
    reasons,
  };
  return { ...core, semanticHash: machineQualitySemanticHash(core) };
}

export function buildMachineRequestEdgeRisk(input: {
  mode: C6016Mode;
  candidates: readonly RequestEdgeRiskInput[];
  generatedAt?: string;
}): MachineRequestEdgeRisk {
  const requestIntervalMissingCount = input.candidates.filter(
    (candidate) => candidate.requestInterval === null,
  ).length;
  const candidates = input.candidates
    .flatMap((candidate) =>
      candidate.requestInterval === null
        ? []
        : [
            classifyRequestEdgeRisk({
              ...candidate,
              requestInterval: candidate.requestInterval,
            }),
          ],
    )
    .toSorted(
      (left, right) =>
        left.eventId.localeCompare(right.eventId) ||
        left.candidateId.localeCompare(right.candidateId) ||
        left.requestId.localeCompare(right.requestId),
    );
  const summary = {
    candidateCount: input.candidates.length,
    strongRiskCount: candidates.filter(
      (candidate) => candidate.edgeRisk === "STRONG",
    ).length,
    weakRiskCount: candidates.filter(
      (candidate) => candidate.edgeRisk === "WEAK",
    ).length,
    noRiskCount: candidates.filter((candidate) => candidate.edgeRisk === "NONE")
      .length,
    unknownRiskCount: requestIntervalMissingCount,
    requestIntervalMissingCount,
    legacyEventEdgeClassificationCount: 0 as const,
  };
  const core = {
    mode: input.mode,
    indexingPolicy: "source-global-seconds-request-relative" as const,
    thresholdPolicy: "frozen-machine-only-v1" as const,
    edgeDistanceThresholdSeconds: C6016_REQUEST_EDGE_DISTANCE_SECONDS,
    candidates,
    summary,
  };
  return machineRequestEdgeRiskSchema.parse({
    schemaVersion: "1.0.0",
    policyVersion: c6016PolicyVersion,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    artifactType: "machine-request-edge-risk",
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
}
