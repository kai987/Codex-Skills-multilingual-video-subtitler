import {
  c6018PolicyVersion,
  machineCoreCandidateOracleEvaluationSchema,
  machineWhisperCoreStabilityEvaluationSchema,
  whisperCoreDiagnosisSchema,
  type CoreCandidateOracleSource,
  type GoldLocalCoreEvaluation,
  type MachineCoreAsrStability,
  type MachineCoreCandidateOracleEvaluation,
  type MachineCoreTextProjection,
  type MachineWhisperCoreStabilityEvaluation,
  type WhisperCoreDiagnosis,
} from "@mvl/shared";

import {
  machineQualitySemanticHash,
  normalizeCandidateText,
} from "./evidence-correlation.js";
import { lexicalEditDistance } from "./localized-candidate-comparability.js";

function sourceForOrigin(origin: string): CoreCandidateOracleSource {
  if (origin === "ORIGINAL") return "CURRENT_FINAL";
  if (origin === "FRESH_A" || origin === "FRESH_B" || origin === "FRESH_C") {
    return "C6017_FRESH_CORE";
  }
  if (origin === "FRESH_CORE_VERIFICATION") {
    return "C6018_CORE_VERIFICATION";
  }
  return "EXISTING_CORE";
}

function sourcePriority(value: CoreCandidateOracleSource): number {
  switch (value) {
    case "CURRENT_FINAL":
      return 0;
    case "EXISTING_CORE":
      return 1;
    case "C6017_FRESH_CORE":
      return 2;
    case "C6018_CORE_VERIFICATION":
      return 3;
  }
}

function isEvaluable(status: string): boolean {
  return status.startsWith("EVALUABLE_");
}

export function buildMachineCoreCandidateOracleEvaluation(input: {
  projection: MachineCoreTextProjection;
  goldEvaluation: GoldLocalCoreEvaluation;
  goldTextByEvent: ReadonlyMap<string, string>;
  currentCandidateIdsByEvent: ReadonlyMap<string, string>;
  machineFreezeHash?: string;
  generatedAt?: string;
}): MachineCoreCandidateOracleEvaluation {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const projectionsByEvent = new Map<
    string,
    typeof input.projection.candidates
  >();
  for (const projection of input.projection.candidates) {
    const values = projectionsByEvent.get(projection.eventId) ?? [];
    projectionsByEvent.set(projection.eventId, [...values, projection]);
  }
  const events = input.goldEvaluation.events.map((evaluation) => {
    const goldText = input.goldTextByEvent.get(evaluation.eventId);
    const projections = projectionsByEvent.get(evaluation.eventId) ?? [];
    const candidateErrors =
      goldText === undefined || !isEvaluable(evaluation.evaluationStatus)
        ? []
        : projections
            .filter(
              (projection) =>
                normalizeCandidateText(projection.coreProjectedText) !== "",
            )
            .map((projection) => {
              const source = sourceForOrigin(projection.origin);
              const error = lexicalEditDistance(
                projection.coreProjectedText,
                goldText,
              );
              const core = {
                candidateId: projection.candidateId,
                source,
                error,
              };
              return {
                ...core,
                semanticHash: machineQualitySemanticHash(core),
              };
            })
            .toSorted(
              (left, right) =>
                left.error - right.error ||
                sourcePriority(left.source) - sourcePriority(right.source) ||
                left.candidateId.localeCompare(right.candidateId),
            );
    const currentCandidateId =
      input.currentCandidateIdsByEvent.get(evaluation.eventId) ??
      projections.find((projection) => projection.origin === "ORIGINAL")
        ?.candidateId ??
      null;
    const current =
      candidateErrors.find(
        (candidate) => candidate.candidateId === currentCandidateId,
      ) ??
      candidateErrors.find((candidate) => candidate.source === "CURRENT_FINAL");
    const oracle = candidateErrors[0];
    const delta =
      current === undefined || oracle === undefined
        ? null
        : oracle.error - current.error;
    const core = {
      eventId: evaluation.eventId,
      evaluationStatus: evaluation.evaluationStatus,
      currentFinalCandidateId: current?.candidateId ?? currentCandidateId,
      currentFinalError: current?.error ?? null,
      oracleCandidateId: oracle?.candidateId ?? null,
      oracleSource: oracle?.source ?? null,
      oracleError: oracle?.error ?? null,
      delta,
      improvement: delta === null ? null : delta < 0,
      regression: delta === null ? null : delta > 0,
      candidateErrors,
      goldTextIncluded: false as const,
    };
    return { ...core, semanticHash: machineQualitySemanticHash(core) };
  });
  const evaluableEvents = events.filter(
    (event) => event.currentFinalError !== null && event.oracleError !== null,
  );
  const core = {
    schemaVersion: "1.0.0" as const,
    policyVersion: c6018PolicyVersion,
    generatedAt,
    artifactType: "machine-core-candidate-oracle-evaluation" as const,
    evaluationPhase: "post-freeze-gold-isolated" as const,
    metricDirection: "LOWER_IS_BETTER" as const,
    deltaDefinition: "newError-minus-oldError" as const,
    machineFreezeHash: input.machineFreezeHash ?? input.projection.semanticHash,
    goldLocalEvaluationSemanticHash: input.goldEvaluation.semanticHash,
    runtimeGoldInputCount: 0 as const,
    events,
    summary: {
      eventCount: events.length,
      evaluableEventCount: evaluableEvents.length,
      currentFinalErrorTotal: evaluableEvents.reduce(
        (sum, event) => sum + (event.currentFinalError ?? 0),
        0,
      ),
      oracleErrorTotal: evaluableEvents.reduce(
        (sum, event) => sum + (event.oracleError ?? 0),
        0,
      ),
      oracleImprovementTotal: evaluableEvents.reduce(
        (sum, event) => sum + Math.max(0, -(event.delta ?? 0)),
        0,
      ),
      oracleImprovedEventCount: evaluableEvents.filter(
        (event) => event.improvement === true,
      ).length,
      existingCoreOracleWinCount: evaluableEvents.filter(
        (event) => event.oracleSource === "EXISTING_CORE",
      ).length,
      c6017FreshOracleWinCount: evaluableEvents.filter(
        (event) => event.oracleSource === "C6017_FRESH_CORE",
      ).length,
      c6018CoreVerificationOracleWinCount: evaluableEvents.filter(
        (event) => event.oracleSource === "C6018_CORE_VERIFICATION",
      ).length,
    },
  };
  return machineCoreCandidateOracleEvaluationSchema.parse({
    ...core,
    semanticHash: machineQualitySemanticHash({
      ...core,
      generatedAt: undefined,
    }),
  });
}

function diagnosisFor(input: {
  stabilityClass: string;
  evaluationStatus: string;
  currentError: number | null;
  oracleError: number | null;
  oracleSource: CoreCandidateOracleSource | null;
}): WhisperCoreDiagnosis {
  if (!isEvaluable(input.evaluationStatus)) {
    return input.evaluationStatus === "UNEVALUABLE_INSUFFICIENT_REFERENCE"
      ? "REFERENCE_ALIGNMENT_BLOCKED"
      : input.evaluationStatus === "UNEVALUABLE_OVERLAP"
        ? "LOCALIZATION_BLOCKED"
        : "UNEVALUABLE";
  }
  if (input.currentError === null || input.oracleError === null) {
    return "LOCALIZATION_BLOCKED";
  }
  if (input.currentError === 0) {
    if (input.stabilityClass === "CORE_TEXT_CONSISTENT") {
      return "ASR_CORE_STABLE_CORRECT";
    }
    if (input.stabilityClass === "CONTEXT_ONLY_DIFFERENCE") {
      return "CONTEXT_DIFFERENCE_ONLY";
    }
    if (input.stabilityClass === "HALLUCINATION_DISAGREEMENT") {
      return "ASR_HALLUCINATION_UNSTABLE";
    }
    return "ASR_CORE_LEXICALLY_UNSTABLE";
  }
  if (input.oracleError < input.currentError && input.oracleError === 0) {
    return input.oracleSource === "EXISTING_CORE"
      ? "PIPELINE_CORRECT_CANDIDATE_EXISTS"
      : "CANDIDATE_APPLICATION_BLOCKED";
  }
  if (input.stabilityClass === "HALLUCINATION_DISAGREEMENT") {
    return "ASR_HALLUCINATION_UNSTABLE";
  }
  if (
    input.stabilityClass === "LEXICAL_CORE_DISAGREEMENT" ||
    input.stabilityClass === "PARTIAL_CORE_AGREEMENT"
  ) {
    return "ASR_CORE_LEXICALLY_UNSTABLE";
  }
  if (
    input.stabilityClass === "UNLOCALIZABLE" ||
    input.stabilityClass === "ADJACENT_UTTERANCE_CONTAMINATION" ||
    input.stabilityClass === "SPEAKER_CONTENT_MIX"
  ) {
    return "LOCALIZATION_BLOCKED";
  }
  return "ASR_CORE_STABLE_WRONG";
}

export function buildMachineWhisperCoreStabilityEvaluation(input: {
  stability: MachineCoreAsrStability;
  goldEvaluation: GoldLocalCoreEvaluation;
  oracle: MachineCoreCandidateOracleEvaluation;
  generatedAt?: string;
}): MachineWhisperCoreStabilityEvaluation {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const stabilityByEvent = new Map(
    input.stability.events.map((event) => [event.eventId, event] as const),
  );
  const goldByEvent = new Map(
    input.goldEvaluation.events.map((event) => [event.eventId, event] as const),
  );
  const events = input.oracle.events.map((oracleEvent) => {
    const stability = stabilityByEvent.get(oracleEvent.eventId);
    const gold = goldByEvent.get(oracleEvent.eventId);
    if (stability === undefined || gold === undefined) {
      throw new Error(
        `Missing stability or Gold-local event ${oracleEvent.eventId}.`,
      );
    }
    const bestExistingCoreError = oracleEvent.candidateErrors
      .filter((entry) => entry.source === "EXISTING_CORE")
      .reduce<number | null>(
        (best, entry) =>
          best === null ? entry.error : Math.min(best, entry.error),
        null,
      );
    const bestFreshCoreError = oracleEvent.candidateErrors
      .filter(
        (entry) =>
          entry.source === "C6017_FRESH_CORE" ||
          entry.source === "C6018_CORE_VERIFICATION",
      )
      .reduce<number | null>(
        (best, entry) =>
          best === null ? entry.error : Math.min(best, entry.error),
        null,
      );
    const diagnosis = diagnosisFor({
      stabilityClass: stability.class,
      evaluationStatus: gold.evaluationStatus,
      currentError: oracleEvent.currentFinalError,
      oracleError: oracleEvent.oracleError,
      oracleSource: oracleEvent.oracleSource,
    });
    const core = {
      eventId: oracleEvent.eventId,
      diagnosis,
      stabilityClass: stability.class,
      localEvaluationStatus: gold.evaluationStatus,
      currentFinalError: oracleEvent.currentFinalError,
      bestExistingCoreError,
      bestFreshCoreError,
      bestCandidateId: oracleEvent.oracleCandidateId,
      supportingEvidenceIds: [
        stability.semanticHash,
        gold.semanticHash,
        oracleEvent.semanticHash,
      ],
    };
    return { ...core, semanticHash: machineQualitySemanticHash(core) };
  });
  const diagnosisCounts = Object.fromEntries(
    whisperCoreDiagnosisSchema.options.map((value) => [
      value,
      events.filter((event) => event.diagnosis === value).length,
    ]),
  ) as Record<WhisperCoreDiagnosis, number>;
  const pipelineLimitedCount =
    diagnosisCounts.PIPELINE_CORRECT_CANDIDATE_EXISTS +
    diagnosisCounts.CANDIDATE_APPLICATION_BLOCKED;
  const asrLimitedCount =
    diagnosisCounts.ASR_CORE_STABLE_WRONG +
    diagnosisCounts.ASR_CORE_LEXICALLY_UNSTABLE +
    diagnosisCounts.ASR_HALLUCINATION_UNSTABLE;
  const core = {
    schemaVersion: "1.0.0" as const,
    policyVersion: c6018PolicyVersion,
    generatedAt,
    artifactType: "machine-whisper-core-stability-evaluation" as const,
    evaluationPhase: "post-freeze-gold-isolated" as const,
    machineFreezeHash: input.stability.semanticHash,
    goldLocalEvaluationSemanticHash: input.goldEvaluation.semanticHash,
    runtimeGoldInputCount: 0 as const,
    events,
    summary: {
      eventCount: events.length,
      evaluableEventCount: events.filter((event) =>
        isEvaluable(event.localEvaluationStatus),
      ).length,
      diagnosisCounts,
      pipelineLimitedCount,
      asrLimitedCount,
      localizationBlockedCount: diagnosisCounts.LOCALIZATION_BLOCKED,
      referenceBlockedCount: diagnosisCounts.REFERENCE_ALIGNMENT_BLOCKED,
    },
  };
  return machineWhisperCoreStabilityEvaluationSchema.parse({
    ...core,
    semanticHash: machineQualitySemanticHash({
      ...core,
      generatedAt: undefined,
    }),
  });
}
