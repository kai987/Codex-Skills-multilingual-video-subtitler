import {
  c6019PolicyVersion,
  machineCrossModelUnionOracleEvaluationSchema,
  type GoldCrossModelComplementarityEvaluation,
  type MachineCrossModelUnionOracleEvaluation,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";

export function buildMachineCrossModelUnionOracleEvaluation(input: {
  generatedAt: string;
  complementarity: GoldCrossModelComplementarityEvaluation;
}): MachineCrossModelUnionOracleEvaluation {
  const events = input.complementarity.events.map((event) => {
    const whisperOnlyOracleError = event.bestWhisperPoolError;
    const unionOracleError = event.unionPoolError;
    const gain =
      whisperOnlyOracleError === null || unionOracleError === null
        ? null
        : whisperOnlyOracleError - unionOracleError;
    if (gain !== null && gain < 0)
      throw new Error(`Union oracle regressed for ${event.eventId}.`);
    const core = {
      eventId: event.eventId,
      whisperOnlyOracleError,
      unionOracleError,
      complementarityGain: gain,
      improved: gain === null ? null : gain > 0,
      reazonAddedBestCandidate: gain === null ? null : gain > 0,
    };
    return { ...core, semanticHash: machineQualitySemanticHash(core) };
  });
  const evaluable = events.filter(
    (event) =>
      event.whisperOnlyOracleError !== null && event.unionOracleError !== null,
  );
  const whisperError = evaluable.reduce(
    (sum, event) => sum + (event.whisperOnlyOracleError ?? 0),
    0,
  );
  const unionError = evaluable.reduce(
    (sum, event) => sum + (event.unionOracleError ?? 0),
    0,
  );
  const absoluteGain = whisperError - unionError;
  const improvedEventCount = evaluable.filter((event) => event.improved).length;
  const core = {
    schemaVersion: "1.0.0" as const,
    policyVersion: c6019PolicyVersion,
    generatedAt: input.generatedAt,
    artifactType: "machine-cross-model-union-oracle-evaluation" as const,
    evaluationPhase: "post-freeze-gold-isolated" as const,
    metricDirection: "LOWER_IS_BETTER" as const,
    gainDefinition: "whisperOnlyOracleError-minus-unionOracleError" as const,
    complementarityEvaluationSemanticHash: input.complementarity.semanticHash,
    events,
    summary: {
      evaluableCount: evaluable.length,
      whisperOnlyOracleError: whisperError,
      unionOracleError: unionError,
      absoluteGain,
      relativeGain: whisperError === 0 ? 0 : absoluteGain / whisperError,
      improvedEventCount,
      reazonOnlyInformationGainEventCount: improvedEventCount,
      complementarityRate:
        evaluable.length === 0 ? 0 : improvedEventCount / evaluable.length,
    },
    runtimeGoldInputCount: 0 as const,
  };
  return machineCrossModelUnionOracleEvaluationSchema.parse({
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
}
