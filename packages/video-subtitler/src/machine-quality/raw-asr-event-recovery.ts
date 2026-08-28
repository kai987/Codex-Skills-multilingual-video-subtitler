import {
  c6015PolicyVersion,
  machineRawAsrEventRecoverySchema,
  type C6015Mode,
  type MachineRawAsrEventRecovery,
  type MachineSingleVariantAcousticAudit,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";

export const C6015_RAW_ASR_EPISODE_REQUEST_BUDGET = 36;
const SOURCE_SAMPLE_RATE = 16_000;

export interface RawAsrRecoveryPlanRequest {
  requestId: string;
  requestFamilyId: string;
  windowType: "exact" | "small-context" | "expanded-context";
  sourceGlobalSampleInterval: { startSample: number; endSample: number };
  sourceGlobalInterval: { start: number; end: number };
  prompt: null;
}

export interface RawAsrRecoveryPlanEvent {
  eventId: string;
  triggerReasons: string[];
  requests: RawAsrRecoveryPlanRequest[];
}

const statusPriority = new Map([
  ["TOKEN_CONFLICT", 0],
  ["INCOMPLETE_SPEECH_SPAN", 1],
  ["EDGE_TRUNCATED", 2],
  ["LOW_CTC_SUPPORT", 3],
  ["DECODER_LOW_CONFIDENCE", 4],
  ["ACOUSTICALLY_WEAK", 5],
  ["UNKNOWN", 6],
]);

function boundedInterval(input: {
  start: number;
  end: number;
  padding: number;
  totalSamples: number;
}) {
  const startSample = Math.max(
    0,
    Math.floor((input.start - input.padding) * SOURCE_SAMPLE_RATE),
  );
  const endSample = Math.min(
    input.totalSamples,
    Math.max(
      startSample + 1,
      Math.ceil((input.end + input.padding) * SOURCE_SAMPLE_RATE),
    ),
  );
  return {
    sourceGlobalSampleInterval: { startSample, endSample },
    sourceGlobalInterval: {
      start: startSample / SOURCE_SAMPLE_RATE,
      end: endSample / SOURCE_SAMPLE_RATE,
    },
  };
}

export function planRawAsrEventRecovery(input: {
  audit: MachineSingleVariantAcousticAudit;
  eventIntervals: ReadonlyMap<string, { start: number; end: number }>;
  sourceTotalSamples: number;
  episodeRequestBudget?: number;
}): { events: RawAsrRecoveryPlanEvent[]; budgetExhaustedCount: number } {
  const budget = Math.min(
    C6015_RAW_ASR_EPISODE_REQUEST_BUDGET,
    input.episodeRequestBudget ?? C6015_RAW_ASR_EPISODE_REQUEST_BUDGET,
  );
  const eligible = input.audit.events
    .filter((event) => event.reAsrEligibility)
    .toSorted(
      (left, right) =>
        (statusPriority.get(left.auditStatus) ?? 99) -
          (statusPriority.get(right.auditStatus) ?? 99) ||
        left.eventId.localeCompare(right.eventId),
    );
  const maximumEvents = Math.floor(budget / 3);
  const selected = eligible.slice(0, maximumEvents);
  const events = selected.flatMap((event) => {
    const interval = input.eventIntervals.get(event.eventId);
    if (interval === undefined) return [];
    const requestFamilyId = `c6015-raw-asr-family:${event.eventId}`;
    const windows = [
      { windowType: "exact" as const, padding: 0 },
      { windowType: "small-context" as const, padding: 0.6 },
      { windowType: "expanded-context" as const, padding: 1 },
    ];
    return [
      {
        eventId: event.eventId,
        triggerReasons: [`SINGLE_VARIANT_${event.auditStatus}`],
        requests: windows.map((window, index) => ({
          requestId: `${requestFamilyId}:${String(index + 1).padStart(2, "0")}`,
          requestFamilyId,
          windowType: window.windowType,
          ...boundedInterval({
            start: interval.start,
            end: interval.end,
            padding: window.padding,
            totalSamples: input.sourceTotalSamples,
          }),
          prompt: null,
        })),
      },
    ];
  });
  return {
    events,
    budgetExhaustedCount: Math.max(0, eligible.length - selected.length),
  };
}

export interface ExecutedRawAsrRecoveryEvent {
  eventId: string;
  requestIds: readonly string[];
  requestFamilyIds: readonly string[];
  sourceGlobalVerified: boolean;
  requestsExecuted: number;
  cacheHitCount: number;
  inferenceCount: number;
  modelLoadCount: number;
  newCandidateIds: readonly string[];
  evaluatedCandidateIds: readonly string[];
  selectedCandidateId: string | null;
}

export function buildRawAsrEventRecoveryArtifact(input: {
  mode: C6015Mode;
  audit: MachineSingleVariantAcousticAudit;
  plan: readonly RawAsrRecoveryPlanEvent[];
  executed: readonly ExecutedRawAsrRecoveryEvent[];
  multiVariantTriggeredCount: number;
  workerStartCount: number;
  improvedPoolRuntimeProxyCount: number;
  replacedByReAsrCount: number;
  generatedAt?: string;
}): MachineRawAsrEventRecovery {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const executedByEvent = new Map(
    input.executed.map((event) => [event.eventId, event] as const),
  );
  const events = input.plan.map((planned) => {
    const executed = executedByEvent.get(planned.eventId);
    const core = {
      eventId: planned.eventId,
      triggerReasons: planned.triggerReasons,
      requestIds:
        executed?.requestIds ??
        planned.requests.map((request) => request.requestId),
      requestFamilyIds: executed?.requestFamilyIds ?? [
        ...new Set(planned.requests.map((request) => request.requestFamilyId)),
      ],
      sourceGlobalVerified: executed?.sourceGlobalVerified ?? false,
      candidateTextPromptUsed: false as const,
      requestsExecuted: executed?.requestsExecuted ?? 0,
      cacheHitCount: executed?.cacheHitCount ?? 0,
      inferenceCount: executed?.inferenceCount ?? 0,
      modelLoadCount: executed?.modelLoadCount ?? 0,
      newCandidateIds: [...(executed?.newCandidateIds ?? [])].toSorted(),
      evaluatedCandidateIds: [
        ...(executed?.evaluatedCandidateIds ?? []),
      ].toSorted(),
      selectedCandidateId: executed?.selectedCandidateId ?? null,
    };
    return { ...core, semanticHash: machineQualitySemanticHash(core) };
  });
  const summary = {
    suspiciousSingleVariantCount: input.audit.summary.suspiciousCount,
    triggeredSingleVariantCount: input.plan.length,
    multiVariantTriggeredCount: input.multiVariantTriggeredCount,
    requestCount: events.reduce(
      (sum, event) => sum + event.requestsExecuted,
      0,
    ),
    cacheHitCount: events.reduce((sum, event) => sum + event.cacheHitCount, 0),
    inferenceCount: events.reduce(
      (sum, event) => sum + event.inferenceCount,
      0,
    ),
    modelLoadCount: events.reduce(
      (sum, event) => sum + event.modelLoadCount,
      0,
    ),
    workerStartCount: input.workerStartCount,
    newCandidateCount: new Set(events.flatMap((event) => event.newCandidateIds))
      .size,
    improvedPoolRuntimeProxyCount: input.improvedPoolRuntimeProxyCount,
    replacedByReAsrCount: input.replacedByReAsrCount,
    unresolvedCount: events.filter(
      (event) => event.selectedCandidateId === null,
    ).length,
  };
  const core = {
    mode: input.mode,
    maximumRequestsPerEvent: 3 as const,
    episodeRequestBudget: C6015_RAW_ASR_EPISODE_REQUEST_BUDGET,
    events,
    summary,
  };
  return machineRawAsrEventRecoverySchema.parse({
    schemaVersion: "1.0.0",
    policyVersion: c6015PolicyVersion,
    generatedAt,
    artifactType: "machine-raw-asr-event-recovery",
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
}
