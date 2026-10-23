import {
  c6019PolicyVersion,
  machineIndependentAsrCandidatesSchema,
  type IndependentAsrCandidate,
  type MachineIndependentAsrCandidates,
  type MachineSecondAsrDiagnosticSet,
} from "@mvl/shared";

import {
  genericHallucinationRisk,
  normalizeIndependentAsrDisplay,
  normalizeIndependentAsrLexical,
  normalizeJapanesePronunciation,
} from "./cross-model-normalization.js";
import { machineQualitySemanticHash } from "./evidence-correlation.js";
import type {
  IndependentAsrProviderRequest,
  IndependentAsrProviderResult,
} from "./independent-asr-provider.js";

export interface IndependentAsrFrozenRecord {
  request: IndependentAsrProviderRequest;
  result: IndependentAsrProviderResult;
  cacheKey: string;
}

export function buildMachineIndependentAsrCandidates(input: {
  generatedAt: string;
  executionKind: "OFFICIAL_FRESH_INFERENCE" | "FROZEN_EXACT_CACHE_REPLAY";
  diagnosticSet: MachineSecondAsrDiagnosticSet;
  modelIdentityHash: string;
  records: readonly IndependentAsrFrozenRecord[];
  pronunciationByRequestId?: ReadonlyMap<string, string>;
}): MachineIndependentAsrCandidates {
  if (input.records.length !== 48) {
    throw new Error(
      `Independent ASR requires exactly 48 records; got ${input.records.length}.`,
    );
  }
  const eventById = new Map(
    input.diagnosticSet.events.map((event) => [event.eventId, event]),
  );
  const isReplay = input.executionKind === "FROZEN_EXACT_CACHE_REPLAY";
  const candidates = input.records.map(
    ({ request, result, cacheKey }): IndependentAsrCandidate => {
      const event = eventById.get(request.eventId);
      if (event === undefined)
        throw new Error(`Unknown diagnostic event ${request.eventId}.`);
      if (request.diagnosticRole !== event.role) {
        throw new Error(`Diagnostic role mismatch for ${request.eventId}.`);
      }
      const displayText = normalizeIndependentAsrDisplay(result.text);
      const normalizedDisplayText = normalizeIndependentAsrLexical(displayText);
      const duration = request.sampleCount / request.sampleRate;
      const repetitionRisk = genericHallucinationRisk({
        text: displayText,
        durationSeconds: duration,
      });
      const points = result.tokenPoints.map((point) => ({
        token: point.token,
        paddedAudioSeconds: point.paddedAudioSeconds,
        sourcePointSeconds: Math.max(
          request.sourceInterval.start,
          Math.min(
            request.sourceInterval.end,
            request.sourceInterval.start +
              Math.max(0, point.paddedAudioSeconds - 0.9),
          ),
        ),
      }));
      const core = {
        candidateId: `reazon-k2:${request.eventId}:${request.windowType}:${cacheKey.slice(0, 16)}`,
        providerId: "reazonspeech-k2-v2" as const,
        modelIdentityHash: input.modelIdentityHash,
        eventId: request.eventId,
        diagnosticRole: request.diagnosticRole,
        windowType: request.windowType,
        sourceInterval: request.sourceInterval,
        audioIdentity: {
          sourceMediaSha256: request.sourceMediaSha256,
          sampleRate: request.sampleRate,
          sampleCount: request.sampleCount,
          audioSha256: request.audioSha256,
          extractionConfigHash: request.extractionConfigHash,
        },
        displayText,
        normalizedDisplayText,
        pronunciationText:
          input.pronunciationByRequestId?.get(request.requestId) ??
          normalizeJapanesePronunciation(displayText),
        requestStatus: result.status,
        diagnostics: {
          wallClockSeconds: result.wallClockSeconds,
          tokenCount: result.tokenPoints.length,
          repetitionRisk,
          textDensityPerSecond:
            Array.from(normalizedDisplayText).length / Math.max(0.1, duration),
          warnings: [...result.warnings],
        },
        timestampEvidence: {
          availability:
            points.length > 0
              ? ("POINT_TIMESTAMPS_ONLY" as const)
              : ("UNAVAILABLE" as const),
          characterIntervalsAvailable: false as const,
          points,
        },
        evidenceAvailability:
          result.status === "SUCCESS" || result.status === "EMPTY_OUTPUT"
            ? ("COMPLETE" as const)
            : ("INCOMPLETE" as const),
        cacheKey,
        cacheHit: isReplay,
        inferenceExecuted: !isReplay,
        runtimeGoldInputCount: 0 as const,
      };
      return { ...core, semanticHash: machineQualitySemanticHash(core) };
    },
  );
  const count = (predicate: (candidate: IndependentAsrCandidate) => boolean) =>
    candidates.filter(predicate).length;
  const core = {
    schemaVersion: "1.0.0" as const,
    policyVersion: c6019PolicyVersion,
    generatedAt: input.generatedAt,
    artifactType: "machine-independent-asr-candidates" as const,
    executionKind: input.executionKind,
    diagnosticSetSemanticHash: input.diagnosticSet.semanticHash,
    modelIdentityHash: input.modelIdentityHash,
    candidates,
    summary: {
      plannedRequestCount: 48 as const,
      actualRequestCount: candidates.length,
      coreExactRequestCount: count(
        (candidate) => candidate.windowType === "CORE_EXACT",
      ),
      coreContextRequestCount: count(
        (candidate) => candidate.windowType === "CORE_CONTEXT",
      ),
      successfulRequestCount: count(
        (candidate) => candidate.requestStatus === "SUCCESS",
      ),
      failedRequestCount: count(
        (candidate) =>
          !["SUCCESS", "EMPTY_OUTPUT"].includes(candidate.requestStatus),
      ),
      emptyOutputCount: count(
        (candidate) => candidate.requestStatus === "EMPTY_OUTPUT",
      ),
      candidateCount: candidates.length,
      evidenceCompleteCount: count(
        (candidate) => candidate.evidenceAvailability === "COMPLETE",
      ),
      evidenceIncompleteCount: count(
        (candidate) => candidate.evidenceAvailability === "INCOMPLETE",
      ),
      timestampAvailableCount: count(
        (candidate) =>
          candidate.timestampEvidence.availability === "POINT_TIMESTAMPS_ONLY",
      ),
      timestampUnavailableCount: count(
        (candidate) =>
          candidate.timestampEvidence.availability === "UNAVAILABLE",
      ),
      cacheHitCount: count((candidate) => candidate.cacheHit),
      inferenceCount: count((candidate) => candidate.inferenceExecuted),
      runtimeGoldInputCount: 0 as const,
    },
  };
  return machineIndependentAsrCandidatesSchema.parse({
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
}
