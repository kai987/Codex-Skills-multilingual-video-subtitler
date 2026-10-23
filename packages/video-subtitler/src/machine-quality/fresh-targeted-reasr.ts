import { deflateRawSync } from "node:zlib";

import {
  c6017PolicyVersion,
  machineFreshTargetedReAsrSchema,
  type C6017Mode,
  type C6017RiskSeverity,
  type FreshReAsrCandidate,
  type MachineFreshTargetedReAsr,
  type MachineReAsrRiskV2,
  type MvlWhisperServerResponse,
} from "@mvl/shared";

import {
  candidateTextSimilarity,
  machineQualitySemanticHash,
  normalizeCandidateText,
} from "./evidence-correlation.js";
import {
  sampleIndexToSeconds,
  secondsToSampleIndex,
} from "./sample-transform-chain.js";

export const C6017_FRESH_CACHE_NAMESPACE =
  "c6-0-1-7-fresh-targeted-reasr-v1" as const;
export const C6017_SOURCE_SAMPLE_RATE = 16_000;

export interface FreshTargetedReAsrPlanRequest {
  requestId: string;
  requestFamilyId: string;
  eventId: string;
  windowType: "near-exact" | "small-context" | "expanded-context";
  sourceGlobalSampleInterval: { startSample: number; endSample: number };
  sourceGlobalInterval: { start: number; end: number };
  prompt: null;
}

export interface FreshTargetedReAsrPlanEvent {
  eventId: string;
  candidateId: string;
  sourceGlobalInterval: { start: number; end: number };
  selectionEvidenceIds: string[];
  requests: FreshTargetedReAsrPlanRequest[];
}

export interface ExecutedFreshReAsrRequest {
  plan: FreshTargetedReAsrPlanRequest;
  extractionIdentity: string;
  requestIdentity: string;
  audioSha256: string;
  sampleCount: number;
  cacheHit: boolean;
  inferenceExecuted: boolean;
  modelLoadCount: number;
  processStartCount: number;
  transcriptionSeconds: number;
  response: MvlWhisperServerResponse;
}

export interface FreshCandidateCtcEvidence {
  status: "SCORABLE" | "UNSCORABLE" | "UNAVAILABLE";
  score: number | null;
  evidenceId: string | null;
  runtimeIdentityHash: string | null;
  modelSnapshotHash: string | null;
  edgePinned: boolean | null;
  pronunciationStatus: "PROJECTED" | "UNSCORABLE";
  projectionTextHash: string | null;
  unresolvedUnits: string[];
}

interface FreshCandidateDraft {
  candidateId: string;
  eventId: string;
  requestIds: string[];
  text: string;
  textHash: string;
  normalizedTextHash: string;
  sourceGlobalInterval: { start: number; end: number };
  decoderEvidence: FreshReAsrCandidate["decoderEvidence"];
  tokenEvidenceIds: string[];
  globalTokenMappingVerified: boolean;
  requestEdgeEvidence: FreshReAsrCandidate["requestEdgeEvidence"];
  independentLineageIds: string[];
  correlatedLineageIds: string[];
  windowSupportCount: number;
}

function sampleWindow(input: {
  interval: { start: number; end: number };
  contextSeconds: number;
  sourceTotalSamples: number;
}): { startSample: number; endSample: number } {
  const startSample = secondsToSampleIndex({
    seconds: input.interval.start,
    sampleRate: C6017_SOURCE_SAMPLE_RATE,
    boundary: "start",
  });
  const endSample = secondsToSampleIndex({
    seconds: input.interval.end,
    sampleRate: C6017_SOURCE_SAMPLE_RATE,
    boundary: "end",
  });
  const contextSamples = Math.round(
    input.contextSeconds * C6017_SOURCE_SAMPLE_RATE,
  );
  return {
    startSample: Math.max(0, startSample - contextSamples),
    endSample: Math.min(input.sourceTotalSamples, endSample + contextSamples),
  };
}

export function planFreshTargetedReAsr(input: {
  risk: MachineReAsrRiskV2;
  eventIntervals: ReadonlyMap<string, { start: number; end: number }>;
  sourceTotalSamples: number;
  generationId: string;
}): FreshTargetedReAsrPlanEvent[] {
  const definitions = [
    ["near-exact", 0],
    ["small-context", 0.6],
    ["expanded-context", 1],
  ] as const;
  return input.risk.events
    .filter((event) => event.budgetSelected)
    .flatMap((event) => {
      const interval = input.eventIntervals.get(event.eventId);
      if (interval === undefined) return [];
      const requestFamilyId = `c6017-fresh:${input.generationId}:${event.stableTieBreakHash.slice(0, 16)}`;
      const requests = definitions.map(
        ([windowType, contextSeconds], index) => {
          const samples = sampleWindow({
            interval,
            contextSeconds,
            sourceTotalSamples: input.sourceTotalSamples,
          });
          return {
            requestId: `${requestFamilyId}:${String(index + 1).padStart(2, "0")}`,
            requestFamilyId,
            eventId: event.eventId,
            windowType,
            sourceGlobalSampleInterval: samples,
            sourceGlobalInterval: {
              start: sampleIndexToSeconds(
                samples.startSample,
                C6017_SOURCE_SAMPLE_RATE,
              ),
              end: sampleIndexToSeconds(
                samples.endSample,
                C6017_SOURCE_SAMPLE_RATE,
              ),
            },
            prompt: null,
          };
        },
      );
      return [
        {
          eventId: event.eventId,
          candidateId: event.candidateId,
          sourceGlobalInterval: interval,
          selectionEvidenceIds: event.riskFacts
            .filter(
              (fact) =>
                fact.evidenceClass === "POSITIVE_ERROR_EVIDENCE" ||
                fact.evidenceClass === "SUPPORTING_ERROR_EVIDENCE",
            )
            .flatMap((fact) => [fact.semanticHash, ...fact.sourceEvidenceIds]),
          requests,
        },
      ];
    });
}

function average(values: readonly number[]): number | null {
  return values.length === 0
    ? null
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function decoderEvidence(
  executions: readonly ExecutedFreshReAsrRequest[],
  text: string,
): FreshReAsrCandidate["decoderEvidence"] {
  const segments = executions.flatMap(
    (execution) => execution.response.transcription,
  );
  const averageLogProbability = average(
    segments.map((segment) => segment.avgLogProbability),
  );
  const noSpeechProbability = average(
    segments.map((segment) => segment.noSpeechProbability),
  );
  const compressionRatio =
    Buffer.byteLength(text, "utf8") /
    Math.max(1, deflateRawSync(Buffer.from(text, "utf8")).length);
  const core = {
    averageLogProbability,
    noSpeechProbability,
    compressionRatio,
    temperature:
      segments.length === 0
        ? null
        : Math.max(...segments.map((segment) => segment.temperature)),
    fallbackCount:
      segments.length === 0
        ? null
        : segments.filter((segment) => segment.temperature > 0).length,
    tokenTimestampAvailable: segments.some((segment) =>
      segment.tokens.some((token) => !token.special && token.mapped !== null),
    ),
    decoderSegmentCount: segments.length,
  };
  return { ...core, semanticHash: machineQualitySemanticHash(core) };
}

function mappedTokenInterval(input: {
  execution: ExecutedFreshReAsrRequest;
  startCentiseconds: number;
  endCentiseconds: number;
}): { start: number; end: number } | null {
  const start =
    input.execution.plan.sourceGlobalInterval.start +
    input.startCentiseconds * 0.01;
  const end =
    input.execution.plan.sourceGlobalInterval.start +
    input.endCentiseconds * 0.01;
  return end > start ? { start, end } : null;
}

function requestEdgeSeverity(
  executions: readonly ExecutedFreshReAsrRequest[],
): C6017RiskSeverity {
  let worst: C6017RiskSeverity = "NONE";
  for (const execution of executions) {
    const mapped = execution.response.transcription.flatMap((segment) =>
      segment.tokens.flatMap((token) =>
        token.special || token.mapped === null
          ? []
          : [
              {
                start: token.mapped.startCentiseconds * 0.01,
                end: token.mapped.endCentiseconds * 0.01,
              },
            ],
      ),
    );
    if (mapped.length === 0) continue;
    const left = Math.min(...mapped.map((value) => value.start));
    const right =
      execution.response.durationSeconds -
      Math.max(...mapped.map((value) => value.end));
    if (left <= 0.05 || right <= 0.05) return "STRONG";
    if (left <= 0.15 || right <= 0.15) worst = "WEAK";
  }
  return worst;
}

export function buildFreshCandidateDrafts(
  executions: readonly ExecutedFreshReAsrRequest[],
): FreshCandidateDraft[] {
  const byEvent = new Map<string, ExecutedFreshReAsrRequest[]>();
  for (const execution of executions) {
    const current = byEvent.get(execution.plan.eventId) ?? [];
    current.push(execution);
    byEvent.set(execution.plan.eventId, current);
  }
  const drafts: FreshCandidateDraft[] = [];
  for (const [eventId, eventExecutions] of byEvent) {
    const groups = new Map<string, ExecutedFreshReAsrRequest[]>();
    for (const execution of eventExecutions) {
      const normalized = normalizeCandidateText(execution.response.text);
      if (normalized === "") continue;
      const existingKey = [...groups.keys()].find(
        (key) => candidateTextSimilarity(key, normalized) >= 0.92,
      );
      const key = existingKey ?? normalized;
      const current = groups.get(key) ?? [];
      current.push(execution);
      groups.set(key, current);
    }
    for (const [normalized, members] of [...groups.entries()].toSorted(
      ([left], [right]) => left.localeCompare(right),
    )) {
      const first = members[0];
      if (first === undefined) continue;
      const text = first.response.text.trim();
      const normalizedTextHash = machineQualitySemanticHash(normalized);
      const candidateId = `c6017-fresh-reasr:${eventId}:${normalizedTextHash.slice(0, 16)}`;
      const tokens = members.flatMap((execution) =>
        execution.response.transcription.flatMap((segment) =>
          segment.tokens.map((token) => ({ execution, segment, token })),
        ),
      );
      const mappedIntervals = tokens.flatMap(({ execution, token }) =>
        token.special || token.mapped === null
          ? []
          : [
              mappedTokenInterval({
                execution,
                startCentiseconds: token.mapped.startCentiseconds,
                endCentiseconds: token.mapped.endCentiseconds,
              }),
            ].filter(
              (value): value is { start: number; end: number } =>
                value !== null,
            ),
      );
      const sourceGlobalInterval =
        mappedIntervals.length > 0
          ? {
              start: Math.min(...mappedIntervals.map((value) => value.start)),
              end: Math.max(...mappedIntervals.map((value) => value.end)),
            }
          : first.plan.sourceGlobalInterval;
      const requestEdge = requestEdgeSeverity(members);
      drafts.push({
        candidateId,
        eventId,
        requestIds: members.map((member) => member.plan.requestId).toSorted(),
        text,
        textHash: machineQualitySemanticHash(text),
        normalizedTextHash,
        sourceGlobalInterval,
        decoderEvidence: decoderEvidence(members, text),
        tokenEvidenceIds: tokens.map(
          ({ execution, segment, token }) =>
            `${execution.plan.requestId}:segment-${segment.id}:token-${token.index}`,
        ),
        globalTokenMappingVerified:
          tokens.some(({ token }) => !token.special) &&
          tokens
            .filter(({ token }) => !token.special)
            .every(({ token }) => token.mapped !== null),
        requestEdgeEvidence: {
          severity: requestEdge,
          evidenceIds: members.map((member) =>
            machineQualitySemanticHash({
              requestId: member.plan.requestId,
              response: member.response.transcription.map((segment) => ({
                start: segment.startSeconds,
                end: segment.endSeconds,
              })),
            }),
          ),
        },
        independentLineageIds: members.map(
          (member) => `window:${member.plan.requestId}`,
        ),
        correlatedLineageIds: [first.plan.requestFamilyId],
        windowSupportCount: members.length,
      });
    }
  }
  return drafts.toSorted(
    (left, right) =>
      left.eventId.localeCompare(right.eventId) ||
      left.candidateId.localeCompare(right.candidateId),
  );
}

function requestArtifact(
  execution: ExecutedFreshReAsrRequest,
): MachineFreshTargetedReAsr["requests"][number] {
  const segments = execution.response.transcription;
  const decoder = decoderEvidence([execution], execution.response.text);
  const tokens = segments.flatMap((segment) =>
    segment.tokens.map((token) => {
      const requestLocalInterval =
        token.mapped === null ||
        token.mapped.endCentiseconds <= token.mapped.startCentiseconds
          ? null
          : {
              start: token.mapped.startCentiseconds * 0.01,
              end: token.mapped.endCentiseconds * 0.01,
            };
      const sourceGlobalInterval =
        token.mapped === null
          ? null
          : mappedTokenInterval({
              execution,
              startCentiseconds: token.mapped.startCentiseconds,
              endCentiseconds: token.mapped.endCentiseconds,
            });
      const core = {
        tokenId: `${execution.plan.requestId}:segment-${segment.id}:token-${token.index}`,
        text: token.text,
        probability: token.probability,
        special: token.special,
        requestLocalInterval,
        sourceGlobalInterval,
        mappingVerified:
          token.special ||
          (token.mapped !== null && sourceGlobalInterval !== null),
      };
      return { ...core, semanticHash: machineQualitySemanticHash(core) };
    }),
  );
  const core = {
    requestId: execution.plan.requestId,
    requestFamilyId: execution.plan.requestFamilyId,
    eventId: execution.plan.eventId,
    windowType: execution.plan.windowType,
    sourceGlobalSampleInterval: execution.plan.sourceGlobalSampleInterval,
    sourceGlobalInterval: execution.plan.sourceGlobalInterval,
    extractionIdentity: execution.extractionIdentity,
    requestIdentity: execution.requestIdentity,
    audioSha256: execution.audioSha256,
    sampleCount: execution.sampleCount,
    sampleRate: C6017_SOURCE_SAMPLE_RATE as 16000,
    prompt: null,
    promptPresent: false as const,
    candidateTextPromptLeakCount: 0 as const,
    humanMemoryPromptLeakCount: 0 as const,
    runtimeGoldInputCount: 0 as const,
    cacheNamespace: C6017_FRESH_CACHE_NAMESPACE,
    cacheHit: execution.cacheHit,
    inferenceExecuted: execution.inferenceExecuted,
    modelLoadCount: execution.modelLoadCount,
    processStartCount: execution.processStartCount,
    transcriptionSeconds: execution.transcriptionSeconds,
    responseText: execution.response.text,
    decoderEvidence: decoder,
    tokens,
  };
  return { ...core, semanticHash: machineQualitySemanticHash(core) };
}

export function buildMachineFreshTargetedReAsr(input: {
  mode: C6017Mode;
  generationKind: "FRESH_INFERENCE" | "FROZEN_EXACT_CACHE_REPLAY";
  sourceMediaSha256: string;
  sourceTotalSamples: number;
  plannedEvents: readonly FreshTargetedReAsrPlanEvent[];
  executedRequests: readonly ExecutedFreshReAsrRequest[];
  ctcEvidenceByCandidateId: ReadonlyMap<string, FreshCandidateCtcEvidence>;
  runtime: {
    whisperCppVersion: string;
    runtimeBinarySha256: string;
    runtimePatchSha256: string;
    modelSha256: string;
    modelBasename: string;
    device: "metal" | "cpu";
  };
  generatedAt?: string;
}): MachineFreshTargetedReAsr {
  const requests = input.executedRequests.map(requestArtifact);
  const drafts = buildFreshCandidateDrafts(input.executedRequests);
  const candidates = drafts.map((draft) => {
    const ctc = input.ctcEvidenceByCandidateId.get(draft.candidateId) ?? {
      status: "UNAVAILABLE" as const,
      score: null,
      evidenceId: null,
      runtimeIdentityHash: null,
      modelSnapshotHash: null,
      edgePinned: null,
      pronunciationStatus: "UNSCORABLE" as const,
      projectionTextHash: null,
      unresolvedUnits: [],
    };
    const core = {
      ...draft,
      ctcEvidence: {
        status: ctc.status,
        score: ctc.score,
        evidenceId: ctc.evidenceId,
        runtimeIdentityHash: ctc.runtimeIdentityHash,
        modelSnapshotHash: ctc.modelSnapshotHash,
        edgePinned: ctc.edgePinned,
      },
      pronunciationProjection: {
        status: ctc.pronunciationStatus,
        projectionTextHash: ctc.projectionTextHash,
        unresolvedUnits: ctc.unresolvedUnits,
      },
      evidenceComplete:
        draft.globalTokenMappingVerified &&
        draft.decoderEvidence.decoderSegmentCount > 0 &&
        ctc.status === "SCORABLE" &&
        ctc.score !== null &&
        ctc.pronunciationStatus === "PROJECTED",
    };
    return { ...core, semanticHash: machineQualitySemanticHash(core) };
  });
  const selectedEvents = input.plannedEvents.map((event) => {
    const core = {
      eventId: event.eventId,
      candidateId: event.candidateId,
      sourceGlobalInterval: event.sourceGlobalInterval,
      selectionEvidenceIds: event.selectionEvidenceIds,
    };
    return { ...core, semanticHash: machineQualitySemanticHash(core) };
  });
  const stabilityByFamily = input.plannedEvents.map((event) => {
    const texts = input.executedRequests
      .filter((request) => request.plan.eventId === event.eventId)
      .map((request) => request.response.text)
      .filter((text) => normalizeCandidateText(text) !== "");
    const stable =
      texts.length >= 2 &&
      texts.every(
        (text) => candidateTextSimilarity(texts[0] ?? "", text) >= 0.82,
      );
    return {
      family: event.requests[0]?.requestFamilyId ?? event.eventId,
      stable,
    };
  });
  const summary = {
    selectedEventCount: selectedEvents.length,
    plannedRequestCount: input.plannedEvents.reduce(
      (sum, event) => sum + event.requests.length,
      0,
    ),
    actualRequestCount: requests.length,
    extractionCount: requests.length,
    uniqueAudioShaCount: new Set(requests.map((request) => request.audioSha256))
      .size,
    cacheHitCount: requests.filter((request) => request.cacheHit).length,
    freshInferenceCount: requests.filter((request) => request.inferenceExecuted)
      .length,
    modelLoadCount: requests.reduce(
      (sum, request) => sum + request.modelLoadCount,
      0,
    ),
    processStartCount: requests.reduce(
      (sum, request) => sum + request.processStartCount,
      0,
    ),
    transcriptionSeconds: requests.reduce(
      (sum, request) => sum + request.transcriptionSeconds,
      0,
    ),
    freshCandidateCount: candidates.length,
    evidenceCompleteCandidateCount: candidates.filter(
      (candidate) => candidate.evidenceComplete,
    ).length,
    evidenceIncompleteCandidateCount: candidates.filter(
      (candidate) => !candidate.evidenceComplete,
    ).length,
    promptIsolationPassed: requests.length > 0,
    candidateTextPromptLeakCount: 0 as const,
    humanMemoryLeakCount: 0 as const,
    runtimeGoldInputCount: 0 as const,
    networkUsed: false as const,
    freshReasrValidationPassed:
      input.generationKind === "FRESH_INFERENCE" &&
      requests.some((request) => request.inferenceExecuted),
  };
  const core = {
    mode: input.mode,
    generationKind: input.generationKind,
    sourceIdentity: {
      sourceMediaSha256: input.sourceMediaSha256,
      sourceSampleRate: C6017_SOURCE_SAMPLE_RATE as 16000,
      sourceTotalSamples: input.sourceTotalSamples,
      readOnly: true as const,
    },
    selectedEvents,
    requests,
    candidates,
    stableWindowFamilies: stabilityByFamily
      .filter((entry) => entry.stable)
      .map((entry) => entry.family),
    unstableWindowFamilies: stabilityByFamily
      .filter((entry) => !entry.stable)
      .map((entry) => entry.family),
    inferenceRuntime: {
      runtimeType: "whisper.cpp-mvl" as const,
      ...input.runtime,
      persistentWorker: true as const,
      requestStateIsolation: "require-safe" as const,
    },
    summary,
  };
  return machineFreshTargetedReAsrSchema.parse({
    schemaVersion: "1.0.0",
    policyVersion: c6017PolicyVersion,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    artifactType: "machine-fresh-targeted-reasr",
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
}
