import {
  c6019PolicyVersion,
  goldSecondAsrControlRegressionSchema,
  type GoldCrossModelComplementarityEvaluation,
  type GoldSecondAsrControlRegression,
  type MachineCrossModelComparison,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";

export function buildGoldSecondAsrControlRegression(input: {
  generatedAt: string;
  complementarity: GoldCrossModelComplementarityEvaluation;
  comparison: MachineCrossModelComparison;
}): GoldSecondAsrControlRegression {
  const comparisonById = new Map(
    input.comparison.events.map((event) => [event.eventId, event]),
  );
  const events = input.complementarity.events
    .filter((event) => event.diagnosticRole === "CONTROL")
    .map((event) => {
      const comparison = comparisonById.get(event.eventId);
      const evaluable =
        event.bestWhisperPoolError !== null && event.reazonCoreError !== null;
      let result: GoldSecondAsrControlRegression["events"][number]["result"];
      if (!evaluable) result = "UNEVALUABLE";
      else if (comparison?.reazonCandidate.normalizedDisplayText === "")
        result = "REAZON_EMPTY";
      else if ((comparison?.reazonCandidate.hallucinationRisk ?? 0) >= 0.6) {
        result = "REAZON_HALLUCINATION";
      } else if (
        (event.reazonCoreError ?? 0) < (event.bestWhisperPoolError ?? 0)
      ) {
        result = "REAZON_BETTER";
      } else if (
        (event.reazonCoreError ?? 0) > (event.bestWhisperPoolError ?? 0)
      ) {
        result = "WHISPER_BETTER";
      } else result = "EQUIVALENT";
      const core = {
        eventId: event.eventId,
        evaluable,
        result,
        blindlySelectingReazonWouldRegress: !evaluable
          ? null
          : (event.reazonCoreError ?? 0) > (event.bestWhisperPoolError ?? 0),
      };
      return { ...core, semanticHash: machineQualitySemanticHash(core) };
    });
  const count = (
    result: GoldSecondAsrControlRegression["events"][number]["result"],
  ) => events.filter((event) => event.result === result).length;
  const core = {
    schemaVersion: "1.0.0" as const,
    policyVersion: c6019PolicyVersion,
    generatedAt: input.generatedAt,
    artifactType: "gold-second-asr-control-regression" as const,
    evaluationPhase: "post-freeze-gold-isolated" as const,
    complementarityEvaluationSemanticHash: input.complementarity.semanticHash,
    events,
    summary: {
      controlEvaluableCount: events.filter((event) => event.evaluable).length,
      reazonBetterCount: count("REAZON_BETTER"),
      whisperBetterCount: count("WHISPER_BETTER"),
      equivalentCount: count("EQUIVALENT"),
      reazonHallucinationCount: count("REAZON_HALLUCINATION"),
      reazonEmptyCount: count("REAZON_EMPTY"),
      blindReazonRegressionCount: events.filter(
        (event) => event.blindlySelectingReazonWouldRegress,
      ).length,
    },
    runtimeGoldInputCount: 0 as const,
  };
  return goldSecondAsrControlRegressionSchema.parse({
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
}
