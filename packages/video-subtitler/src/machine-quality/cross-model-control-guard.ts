import {
  c60110ControlRegressionEvaluationSchema,
  c60110PolicyVersion,
  type C60110ControlRegressionEvaluation,
  type GoldSecondAsrControlRegression,
  type MachineCrossModelArbitrationLedger,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";

export function buildC60110ControlRegressionEvaluation(input: {
  generatedAt: string;
  ledger: MachineCrossModelArbitrationLedger;
  controls: GoldSecondAsrControlRegression;
}): C60110ControlRegressionEvaluation {
  const decisionByEvent = new Map(
    input.ledger.events.map((event) => [event.eventId, event] as const),
  );
  const events = input.controls.events.map((control) => {
    const decision = decisionByEvent.get(control.eventId);
    const arbitrationDecision =
      decision?.decision ?? ("ABSTAIN_REVIEW" as const);
    const selected = arbitrationDecision === "SELECT_REAZON";
    const outcome =
      control.result === "UNEVALUABLE"
        ? ("UNEVALUABLE" as const)
        : selected && control.result === "REAZON_BETTER"
          ? ("CORRECT_SWITCH" as const)
          : selected && control.result === "WHISPER_BETTER"
            ? ("WRONG_SWITCH" as const)
            : selected
              ? ("NEUTRAL_SWITCH" as const)
              : control.blindlySelectingReazonWouldRegress
                ? ("AVOIDED_CONTROL_REGRESSION" as const)
                : ("NO_SWITCH" as const);
    const core = {
      eventId: control.eventId,
      blindReazonWouldRegress: control.blindlySelectingReazonWouldRegress,
      arbitrationDecision,
      outcome,
    };
    return { ...core, semanticHash: machineQualitySemanticHash(core) };
  });
  const core = {
    schemaVersion: "1.0.0" as const,
    policyVersion: c60110PolicyVersion,
    generatedAt: input.generatedAt,
    artifactType: "c6-0-1-10-control-regression-evaluation" as const,
    evaluationPhase: "post-decision-freeze-gold-isolated" as const,
    controlEventCount: 12 as const,
    reazonBetterCount: input.controls.summary.reazonBetterCount,
    whisperBetterCount: input.controls.summary.whisperBetterCount,
    equivalentCount: input.controls.summary.equivalentCount,
    selectReazonCount: events.filter((event) =>
      ["CORRECT_SWITCH", "WRONG_SWITCH", "NEUTRAL_SWITCH"].includes(
        event.outcome,
      ),
    ).length,
    correctSelectReazonCount: events.filter(
      (event) => event.outcome === "CORRECT_SWITCH",
    ).length,
    wrongSelectReazonCount: events.filter(
      (event) => event.outcome === "WRONG_SWITCH",
    ).length,
    avoidedBlindRegressionCount: events.filter(
      (event) => event.outcome === "AVOIDED_CONTROL_REGRESSION",
    ).length,
    events,
    runtimeGoldInputCount: 0 as const,
  };
  return c60110ControlRegressionEvaluationSchema.parse({
    ...core,
    semanticHash: machineQualitySemanticHash({
      ...core,
      generatedAt: undefined,
    }),
  });
}
