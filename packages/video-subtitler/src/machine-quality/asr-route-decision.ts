import {
  c6018PolicyVersion,
  c6018RouteDecisionSchema,
  type C6018RouteDecision,
  type C6018RouteDecisionValue,
  type MachineCoreCandidateOracleEvaluation,
  type MachineLocalizedCandidateComparability,
  type MachineWhisperCoreStabilityEvaluation,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";

export function buildC6018RouteDecision(input: {
  comparability: MachineLocalizedCandidateComparability;
  evaluation: MachineWhisperCoreStabilityEvaluation;
  oracle: MachineCoreCandidateOracleEvaluation;
  strictC602QualityGatePassed: boolean;
  generatedAt?: string;
}): C6018RouteDecision {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const evaluableEventCount = input.evaluation.summary.evaluableEventCount;
  const coreComparableEventCount =
    input.comparability.summary.coreComparableCount +
    input.comparability.summary.partiallyComparableCount;
  const pipelineLimitedCount = input.evaluation.summary.pipelineLimitedCount;
  const asrLimitedCount = input.evaluation.summary.asrLimitedCount;
  const localizationBlockedCount =
    input.evaluation.summary.localizationBlockedCount;
  const referenceBlockedCount = input.evaluation.summary.referenceBlockedCount;
  let decision: C6018RouteDecisionValue;
  if (input.strictC602QualityGatePassed) {
    decision = "GO_C6_0_2";
  } else if (evaluableEventCount < 9 || coreComparableEventCount < 9) {
    decision = "INSUFFICIENT_LOCAL_COMPARABILITY";
  } else if (pipelineLimitedCount >= 2 && asrLimitedCount >= 2) {
    decision = "MIXED_PIPELINE_AND_ASR";
  } else if (asrLimitedCount >= 2) {
    decision = "RECOMMEND_SECOND_ASR_ENSEMBLE";
  } else {
    decision = "CONTINUE_FINAL_PIPELINE_APPLICATION";
  }
  const recommendation =
    decision === "GO_C6_0_2"
      ? ("ADVANCE_TO_C6_0_2" as const)
      : decision === "CONTINUE_FINAL_PIPELINE_APPLICATION"
        ? ("ONE_SMALL_FINAL_PIPELINE_APPLICATION" as const)
        : decision === "INSUFFICIENT_LOCAL_COMPARABILITY"
          ? ("RESOLVE_MINIMAL_LOCALIZATION_BLOCKER" as const)
          : ("STOP_SINGLE_WHISPER_RULE_EXPANSION" as const);
  const blockers = [
    ...(!input.strictC602QualityGatePassed
      ? ["strict-c6.0.2-quality-gate-remains-failed"]
      : []),
    ...(evaluableEventCount < 9
      ? [`local-gold-evaluable-events-below-target:${evaluableEventCount}/12`]
      : []),
    ...(coreComparableEventCount < 9
      ? [`core-comparable-events-below-target:${coreComparableEventCount}/12`]
      : []),
    ...(localizationBlockedCount > 0
      ? [`localization-blocked-events:${localizationBlockedCount}`]
      : []),
    ...(referenceBlockedCount > 0
      ? [`reference-alignment-blocked-events:${referenceBlockedCount}`]
      : []),
  ];
  const decisiveCount = pipelineLimitedCount + asrLimitedCount;
  const confidence =
    decision === "INSUFFICIENT_LOCAL_COMPARABILITY"
      ? ("LOW" as const)
      : decisiveCount >= 8
        ? ("HIGH" as const)
        : decisiveCount >= 4
          ? ("MEDIUM" as const)
          : ("LOW" as const);
  const core = {
    schemaVersion: "1.0.0" as const,
    policyVersion: c6018PolicyVersion,
    generatedAt,
    artifactType: "c6-0-1-8-route-decision" as const,
    decision,
    confidence,
    recommendation,
    supportingCounts: {
      evaluableEventCount,
      coreComparableEventCount,
      pipelineLimitedCount,
      asrLimitedCount,
      localizationBlockedCount,
      referenceBlockedCount,
      oracleImprovedEventCount: input.oracle.summary.oracleImprovedEventCount,
    },
    blockers,
    strictC602QualityGatePassed: input.strictC602QualityGatePassed,
    runtimeGoldInputCount: 0 as const,
    releaseAuthorized: false as const,
    productionStatus: "needs-review" as const,
    finalizationMethod: "none" as const,
  };
  return c6018RouteDecisionSchema.parse({
    ...core,
    semanticHash: machineQualitySemanticHash({
      ...core,
      generatedAt: undefined,
    }),
  });
}
