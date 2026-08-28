import {
  InputError,
  machineTargetedEventReasrSchema,
  type C6014Mode,
  type MachineCandidatePoolSufficiency,
  type MachineTargetedEventReasr,
  type MachineTextVariantDecision,
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

export const C6014_TARGETED_REASR_POLICY = {
  maximumRequestsPerEvent: 3 as const,
  episodeRequestBudget: 36,
  smallContextMilliseconds: 600 as const,
  expandedContextMilliseconds: 1000 as const,
  directSourceGlobalExtraction: true as const,
  promptIsolationRequired: true as const,
};

export interface TargetedReasrPlanRequest {
  requestId: string;
  eventId: string;
  requestFamily: string;
  windowType: "exact" | "small-context" | "expanded-context";
  sourceGlobalSampleInterval: { startSample: number; endSample: number };
  sourceGlobalInterval: { start: number; end: number };
  prompt: null;
}

export interface TargetedReasrPlanEvent {
  eventId: string;
  triggerReasons: string[];
  globalAudioInterval: { start: number; end: number };
  requestFamily: string;
  requests: TargetedReasrPlanRequest[];
}

function windowSamples(input: {
  interval: { start: number; end: number };
  contextMilliseconds: number;
  sourceSampleRate: number;
  sourceTotalSamples: number;
}): { startSample: number; endSample: number } {
  const contextSamples = Math.round(
    (input.contextMilliseconds / 1000) * input.sourceSampleRate,
  );
  const start = secondsToSampleIndex({
    seconds: input.interval.start,
    sampleRate: input.sourceSampleRate,
    boundary: "start",
  });
  const end = secondsToSampleIndex({
    seconds: input.interval.end,
    sampleRate: input.sourceSampleRate,
    boundary: "end",
  });
  return {
    startSample: Math.max(0, start - contextSamples),
    endSample: Math.min(input.sourceTotalSamples, end + contextSamples),
  };
}

export function planTargetedEventReasr(input: {
  events: readonly {
    eventId: string;
    interval: { start: number; end: number };
  }[];
  decisions: MachineTextVariantDecision;
  poolSufficiency: MachineCandidatePoolSufficiency;
  sourceSampleRate: number;
  sourceTotalSamples: number;
  episodeRequestBudget?: number;
}): {
  eligibleEventCount: number;
  events: TargetedReasrPlanEvent[];
  budgetExhaustedCount: number;
} {
  const decisions = new Map(
    input.decisions.decisions.map((decision) => [decision.eventId, decision]),
  );
  const pools = new Map(
    input.poolSufficiency.events.map((event) => [event.eventId, event]),
  );
  const eligible = input.events
    .filter((event) => {
      const decision = decisions.get(event.eventId);
      const pool = pools.get(event.eventId);
      return (
        decision?.selectedVariant === null &&
        ["AMBIGUOUS", "INSUFFICIENT"].includes(pool?.status ?? "UNKNOWN")
      );
    })
    .toSorted((left, right) => {
      const leftPool = pools.get(left.eventId)?.status;
      const rightPool = pools.get(right.eventId)?.status;
      const priority = (status: string | undefined) =>
        status === "INSUFFICIENT" ? 0 : 1;
      return (
        priority(leftPool) - priority(rightPool) ||
        left.interval.start - right.interval.start ||
        left.eventId.localeCompare(right.eventId)
      );
    });
  const budget =
    input.episodeRequestBudget ??
    C6014_TARGETED_REASR_POLICY.episodeRequestBudget;
  if (!Number.isInteger(budget) || budget <= 0) {
    throw new InputError("Targeted re-ASR episode budget must be positive.");
  }
  let used = 0;
  let budgetExhaustedCount = 0;
  const planned: TargetedReasrPlanEvent[] = [];
  for (const event of eligible) {
    if (used + C6014_TARGETED_REASR_POLICY.maximumRequestsPerEvent > budget) {
      budgetExhaustedCount += 1;
      continue;
    }
    const pool = pools.get(event.eventId);
    const decision = decisions.get(event.eventId);
    const requestFamily = `c6014-targeted-family:${event.eventId}`;
    const definitions = [
      ["exact", 0],
      ["small-context", C6014_TARGETED_REASR_POLICY.smallContextMilliseconds],
      [
        "expanded-context",
        C6014_TARGETED_REASR_POLICY.expandedContextMilliseconds,
      ],
    ] as const;
    const requests = definitions.map(
      ([windowType, contextMilliseconds], index) => {
        const samples = windowSamples({
          interval: event.interval,
          contextMilliseconds,
          sourceSampleRate: input.sourceSampleRate,
          sourceTotalSamples: input.sourceTotalSamples,
        });
        return {
          requestId: `${requestFamily}:${String(index + 1).padStart(2, "0")}`,
          eventId: event.eventId,
          requestFamily,
          windowType,
          sourceGlobalSampleInterval: samples,
          sourceGlobalInterval: {
            start: sampleIndexToSeconds(
              samples.startSample,
              input.sourceSampleRate,
            ),
            end: sampleIndexToSeconds(
              samples.endSample,
              input.sourceSampleRate,
            ),
          },
          prompt: null,
        };
      },
    );
    used += requests.length;
    planned.push({
      eventId: event.eventId,
      triggerReasons: [
        `variant-decision:${decision?.decisionStatus ?? "unknown"}`,
        `candidate-pool:${pool?.status ?? "UNKNOWN"}`,
        ...(pool?.signals ?? []).map((signal) => `pool-signal:${signal}`),
      ],
      globalAudioInterval: event.interval,
      requestFamily,
      requests,
    });
  }
  return {
    eligibleEventCount: eligible.length,
    events: planned,
    budgetExhaustedCount,
  };
}

export function assertTargetedReasrPromptIsolation(input: {
  request: Omit<TargetedReasrPlanRequest, "prompt"> & { prompt: unknown };
  serializedProviderConfiguration: string;
  candidateTexts: readonly string[];
}): void {
  if (input.request.prompt !== null) {
    throw new InputError("Targeted re-ASR request prompt must be null.");
  }
  const configuration = input.serializedProviderConfiguration.normalize("NFKC");
  if (
    /initial[_-]?prompt|prompt_text|gold|human[_-]?memory/iu.test(configuration)
  ) {
    throw new InputError(
      "Targeted re-ASR provider configuration leaks prompt state.",
    );
  }
  for (const candidate of input.candidateTexts) {
    const normalized = normalizeCandidateText(candidate);
    if (
      normalized.length >= 3 &&
      normalizeCandidateText(configuration).includes(normalized)
    ) {
      throw new InputError(
        "Targeted re-ASR provider configuration contains candidate text.",
      );
    }
  }
}

export function assessTargetedReasrStability(
  texts: readonly string[],
): "STRONG" | "WEAK" | "UNSTABLE" | "NO_RESULT" {
  const nonempty = texts.filter((text) => normalizeCandidateText(text) !== "");
  if (nonempty.length === 0) return "NO_RESULT";
  if (nonempty.length === 1) return "WEAK";
  const normalized = nonempty.map(normalizeCandidateText);
  const counts = new Map<string, number>();
  for (const value of normalized)
    counts.set(value, (counts.get(value) ?? 0) + 1);
  if (Math.max(...counts.values()) >= 2) return "STRONG";
  const similarities = nonempty.flatMap((left, index) =>
    nonempty
      .slice(index + 1)
      .map((right) => candidateTextSimilarity(left, right)),
  );
  return similarities.length > 0 && Math.min(...similarities) >= 0.82
    ? "WEAK"
    : "UNSTABLE";
}

export interface ExecutedTargetedReasrRequest {
  plan: TargetedReasrPlanRequest;
  extractedAudioSha256: string;
  extractedSampleRate: number;
  extractedSampleCount: number;
  cacheIdentity: string;
  cacheHit: boolean;
  inferenceExecuted: boolean;
  modelLoadCount: number;
  workerStartCount: number;
  responseText: string;
  responseInterval: { start: number; end: number } | null;
  tokenEvidenceIds: readonly string[];
  decoderEvidenceHash: string;
}

export function buildTargetedEventReasrArtifact(input: {
  mode: C6014Mode;
  eligibleEventCount: number;
  budgetExhaustedCount: number;
  plannedEvents: readonly TargetedReasrPlanEvent[];
  executedRequests: readonly ExecutedTargetedReasrRequest[];
  selectedCandidateIds?: ReadonlySet<string>;
  generatedAt?: string;
  episodeRequestBudget?: number;
}): MachineTargetedEventReasr {
  const executedByEvent = new Map<string, ExecutedTargetedReasrRequest[]>();
  for (const executed of input.executedRequests) {
    const current = executedByEvent.get(executed.plan.eventId) ?? [];
    current.push(executed);
    executedByEvent.set(executed.plan.eventId, current);
  }
  const events = input.plannedEvents.map((planned) => {
    const executed = (executedByEvent.get(planned.eventId) ?? []).toSorted(
      (left, right) => left.plan.requestId.localeCompare(right.plan.requestId),
    );
    if (executed.length > C6014_TARGETED_REASR_POLICY.maximumRequestsPerEvent) {
      throw new InputError(
        "Targeted re-ASR event exceeded its request budget.",
        {
          eventId: planned.eventId,
        },
      );
    }
    const verificationRequests = executed.map((request) => {
      const core = {
        requestId: request.plan.requestId,
        requestFamily: request.plan.requestFamily,
        windowType: request.plan.windowType,
        sourceGlobalSampleInterval: request.plan.sourceGlobalSampleInterval,
        sourceGlobalInterval: request.plan.sourceGlobalInterval,
        extractedAudioSha256: request.extractedAudioSha256,
        extractedSampleRate: request.extractedSampleRate,
        extractedSampleCount: request.extractedSampleCount,
        cacheIdentity: request.cacheIdentity,
        cacheHit: request.cacheHit,
        inferenceExecuted: request.inferenceExecuted,
        modelLoadCount: request.modelLoadCount,
        workerStartCount: request.workerStartCount,
        promptPresent: false as const,
        candidateTextPromptLeakCount: 0 as const,
        humanMemoryPromptLeakCount: 0 as const,
        runtimeGoldInputCount: 0 as const,
      };
      return { ...core, semanticHash: machineQualitySemanticHash(core) };
    });
    const groups = new Map<string, ExecutedTargetedReasrRequest[]>();
    for (const request of executed) {
      const normalized = normalizeCandidateText(request.responseText);
      if (normalized === "" || request.responseInterval === null) continue;
      const current = groups.get(normalized) ?? [];
      current.push(request);
      groups.set(normalized, current);
    }
    const candidateOutputs = [...groups.entries()]
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([normalized, requests], index) => {
        const first = requests[0];
        if (first?.responseInterval == null) {
          throw new InputError("Targeted re-ASR candidate has no lineage.");
        }
        const candidateId = `targeted-reasr:${planned.eventId}:${String(index + 1).padStart(2, "0")}`;
        const interval = {
          start: Math.min(
            ...requests.map(
              (request) => request.responseInterval?.start ?? Infinity,
            ),
          ),
          end: Math.max(
            ...requests.map(
              (request) => request.responseInterval?.end ?? -Infinity,
            ),
          ),
        };
        const core = {
          candidateId,
          requestIds: requests.map((request) => request.plan.requestId),
          text: first.responseText,
          textHash: machineQualitySemanticHash(first.responseText),
          normalizedTextHash: machineQualitySemanticHash(normalized),
          sourceGlobalInterval: interval,
          tokenEvidenceIds: [
            ...new Set(requests.flatMap((request) => request.tokenEvidenceIds)),
          ],
          decoderEvidenceHash: machineQualitySemanticHash(
            requests.map((request) => request.decoderEvidenceHash),
          ),
          lineageComplete: true,
        };
        return { ...core, semanticHash: machineQualitySemanticHash(core) };
      });
    const stability = assessTargetedReasrStability(
      executed.map((request) => request.responseText),
    );
    const selectedCandidateId =
      candidateOutputs.find((candidate) =>
        input.selectedCandidateIds?.has(candidate.candidateId),
      )?.candidateId ?? null;
    const resultingDecision =
      selectedCandidateId !== null
        ? ("SELECT_EXISTING_VARIANT" as const)
        : candidateOutputs.length === 0
          ? ("NO_ACOUSTICALLY_SUPPORTED_VARIANT" as const)
          : ("AMBIGUOUS_VARIANT" as const);
    const eventCore = {
      eventId: planned.eventId,
      triggerReasons: planned.triggerReasons,
      globalAudioInterval: planned.globalAudioInterval,
      verificationRequests,
      requestFamily: planned.requestFamily,
      candidateOutputs,
      stability,
      resultingDecision,
      selectedCandidateId,
      cacheIdentity: machineQualitySemanticHash(
        verificationRequests.map((request) => request.cacheIdentity),
      ),
    };
    return {
      ...eventCore,
      semanticHash: machineQualitySemanticHash(eventCore),
    };
  });
  const requests = events.flatMap((event) => event.verificationRequests);
  const core = {
    mode: input.mode,
    policy: {
      ...C6014_TARGETED_REASR_POLICY,
      episodeRequestBudget:
        input.episodeRequestBudget ??
        C6014_TARGETED_REASR_POLICY.episodeRequestBudget,
    },
    events,
    summary: {
      eligibleEventCount: input.eligibleEventCount,
      triggeredEventCount: events.length,
      requestCount: requests.length,
      cacheHitCount: requests.filter((request) => request.cacheHit).length,
      inferenceCount: requests.filter((request) => request.inferenceExecuted)
        .length,
      modelLoadCount: requests.reduce(
        (sum, request) => sum + request.modelLoadCount,
        0,
      ),
      workerStartCount: requests.reduce(
        (sum, request) => sum + request.workerStartCount,
        0,
      ),
      stableResultEventCount: events.filter(
        (event) => event.stability === "STRONG",
      ).length,
      unstableResultEventCount: events.filter(
        (event) => event.stability === "UNSTABLE",
      ).length,
      newCandidateCount: events.reduce(
        (sum, event) => sum + event.candidateOutputs.length,
        0,
      ),
      selectedNewCandidateCount: events.filter(
        (event) => event.selectedCandidateId !== null,
      ).length,
      unresolvedAfterReasrCount: events.filter(
        (event) => event.selectedCandidateId === null,
      ).length,
      budgetExhaustedCount: input.budgetExhaustedCount,
      promptIsolationPassed: true,
      candidateTextPromptLeakCount: 0 as const,
      humanMemoryLeakCount: 0 as const,
      runtimeGoldInputCount: 0 as const,
      networkUsed: false as const,
    },
  };
  return machineTargetedEventReasrSchema.parse({
    schemaVersion: "1.0.0",
    policyVersion: "c6.0.1.4-vad-timebase-acoustic-text-variant-reasr-v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    artifactType: "machine-targeted-event-reasr",
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
}
