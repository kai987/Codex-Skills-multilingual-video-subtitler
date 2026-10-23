import {
  c60111PolicyVersion,
  machinePairedWhisperEvidenceSchema,
  whisperCoreStabilityV2Schema,
  type MachineCrossModelCalibrationCorpus,
  type MachinePairedWhisperEvidence,
} from "@mvl/shared";

import {
  genericHallucinationRisk,
  normalizeIndependentAsrDisplay,
  normalizeIndependentAsrLexical,
  normalizeJapanesePronunciation,
} from "./cross-model-normalization.js";
import { machineQualitySemanticHash } from "./evidence-correlation.js";
import { classifyWhisperCoreStabilityV2 } from "./whisper-core-stability-v2.js";

export interface C60111WhisperExecution {
  eventId: string;
  requestId: string;
  windowType: "CORE_EXACT" | "CORE_CONTEXT";
  sourceInterval: { start: number; end: number };
  audioSha256: string;
  cacheKey: string;
  execution: "FRESH_INFERENCE" | "VERIFIED_EXACT_REPLAY";
  text: string;
  decoderEvidence: {
    averageLogProbability: number | null;
    noSpeechProbability: number | null;
    compressionRatio: number | null;
    temperature: number | null;
    fallbackCount: number | null;
    tokenTimestampAvailable: boolean;
    decoderSegmentCount: number;
  };
  tokenEvidenceAvailable: boolean;
}

export interface C60111CurrentWhisperView {
  eventId: string;
  candidateId: string;
  text: string;
  pronunciationText: string;
  hallucinationRisk: number;
  semanticHash: string;
}

function materializeCandidate(execution: C60111WhisperExecution) {
  const displayText = normalizeIndependentAsrDisplay(execution.text);
  const normalizedText = normalizeIndependentAsrLexical(displayText);
  const duration =
    execution.sourceInterval.end - execution.sourceInterval.start;
  const core = {
    candidateId: execution.requestId,
    displayText,
    normalizedText,
    pronunciationText: normalizeJapanesePronunciation(displayText),
    hallucinationRisk: genericHallucinationRisk({
      text: displayText,
      durationSeconds: duration,
    }),
    requestId: execution.requestId,
    windowType: execution.windowType,
    sourceInterval: execution.sourceInterval,
    audioSha256: execution.audioSha256,
    cacheKey: execution.cacheKey,
    execution: execution.execution,
    decoderEvidence: execution.decoderEvidence,
    tokenEvidenceAvailable: execution.tokenEvidenceAvailable,
  };
  return { ...core, semanticHash: machineQualitySemanticHash(core) };
}

export function buildMachinePairedWhisperEvidence(input: {
  generatedAt: string;
  sourceMediaSha256: string;
  corpus: MachineCrossModelCalibrationCorpus;
  currentCandidates: readonly C60111CurrentWhisperView[];
  executions: readonly C60111WhisperExecution[];
  modelIdentity: MachinePairedWhisperEvidence["modelIdentity"];
  modelLoadCount: number;
  processStartCount: number;
  failedCount?: number;
}): MachinePairedWhisperEvidence {
  const currentByEvent = new Map(
    input.currentCandidates.map((candidate) => [candidate.eventId, candidate]),
  );
  const executionsByEvent = new Map<string, C60111WhisperExecution[]>();
  for (const execution of input.executions) {
    const values = executionsByEvent.get(execution.eventId) ?? [];
    values.push(execution);
    executionsByEvent.set(execution.eventId, values);
  }
  const events = input.corpus.events.map((event) => {
    const current = currentByEvent.get(event.eventId);
    if (current === undefined) {
      throw new Error(
        `Missing current Whisper candidate for ${event.eventId}.`,
      );
    }
    const eventExecutions = executionsByEvent.get(event.eventId) ?? [];
    const exactExecution = eventExecutions.find(
      (execution) => execution.windowType === "CORE_EXACT",
    );
    const contextExecution = eventExecutions.find(
      (execution) => execution.windowType === "CORE_CONTEXT",
    );
    const exact =
      exactExecution === undefined
        ? null
        : materializeCandidate(exactExecution);
    const context =
      contextExecution === undefined
        ? null
        : materializeCandidate(contextExecution);
    const currentCore = {
      candidateId: current.candidateId,
      displayText: normalizeIndependentAsrDisplay(current.text),
      normalizedText: normalizeIndependentAsrLexical(current.text),
      pronunciationText: current.pronunciationText,
      hallucinationRisk: current.hallucinationRisk,
      semanticHash: current.semanticHash,
    };
    const core = {
      eventId: event.eventId,
      whisperCurrentCandidate: currentCore,
      whisperCoreExact: exact,
      whisperCoreContext: context,
      stabilityClass: classifyWhisperCoreStabilityV2({
        exactText: exact?.displayText ?? null,
        contextText: context?.displayText ?? null,
        exactDurationSeconds:
          exact === null
            ? 0
            : exact.sourceInterval.end - exact.sourceInterval.start,
        contextDurationSeconds:
          context === null
            ? 0
            : context.sourceInterval.end - context.sourceInterval.start,
      }),
      exactAudioSha256: exact?.audioSha256 ?? null,
      contextAudioSha256: context?.audioSha256 ?? null,
    };
    return { ...core, semanticHash: machineQualitySemanticHash(core) };
  });
  const exactExecutions = input.executions.filter(
    (execution) => execution.windowType === "CORE_EXACT",
  );
  const contextExecutions = input.executions.filter(
    (execution) => execution.windowType === "CORE_CONTEXT",
  );
  const pairedCount = events.filter(
    (event) =>
      event.whisperCoreExact !== null && event.whisperCoreContext !== null,
  ).length;
  const stabilityCounts = Object.fromEntries(
    whisperCoreStabilityV2Schema.options.map((value) => [
      value,
      events.filter((event) => event.stabilityClass === value).length,
    ]),
  ) as MachinePairedWhisperEvidence["summary"]["stabilityCounts"];
  const core = {
    schemaVersion: "1.0.0" as const,
    policyVersion: c60111PolicyVersion,
    generatedAt: input.generatedAt,
    artifactType: "machine-paired-whisper-evidence" as const,
    corpusSemanticHash: input.corpus.semanticHash,
    sourceMediaSha256: input.sourceMediaSha256,
    contextPolicy: "symmetric-one-second-source-context-v1" as const,
    promptPolicy: "null-prompt-no-candidate-no-gold-v1" as const,
    modelIdentity: input.modelIdentity,
    requests: {
      coreExactPlannedCount: input.corpus.events.length,
      coreExactActualCount: exactExecutions.length,
      coreExactFreshInferenceCount: exactExecutions.filter(
        (execution) => execution.execution === "FRESH_INFERENCE",
      ).length,
      coreExactCacheReplayCount: exactExecutions.filter(
        (execution) => execution.execution === "VERIFIED_EXACT_REPLAY",
      ).length,
      coreContextPlannedCount: input.corpus.events.length,
      coreContextActualCount: contextExecutions.length,
      coreContextFreshInferenceCount: contextExecutions.filter(
        (execution) => execution.execution === "FRESH_INFERENCE",
      ).length,
      coreContextCacheReplayCount: contextExecutions.filter(
        (execution) => execution.execution === "VERIFIED_EXACT_REPLAY",
      ).length,
      failedCount: input.failedCount ?? 0,
      modelLoadCount: input.modelLoadCount,
      processStartCount: input.processStartCount,
    },
    events,
    summary: {
      requiredEventCount: input.corpus.events.length,
      pairedEvidenceAvailableCount: pairedCount,
      exactOnlyCount: events.filter(
        (event) =>
          event.whisperCoreExact !== null && event.whisperCoreContext === null,
      ).length,
      contextMissingCount: events.filter(
        (event) => event.whisperCoreContext === null,
      ).length,
      uncomparableCount: stabilityCounts.WHISPER_UNCOMPARABLE,
      coverage:
        input.corpus.events.length === 0
          ? 0
          : pairedCount / input.corpus.events.length,
      stabilityCounts,
      runtimeGoldInputCount: 0 as const,
      networkUsed: false as const,
    },
  };
  return machinePairedWhisperEvidenceSchema.parse({
    ...core,
    semanticHash: machineQualitySemanticHash({
      ...core,
      generatedAt: undefined,
    }),
  });
}
