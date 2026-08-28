import {
  c6014PolicyVersion,
  c6014QualityComparisonSchema,
  c6014QualityPolicySchema,
  type C6014Mode,
  type C6014QualityComparison,
  type C6014QualityMetrics,
  type C6014QualityPolicy,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";

export const C6014_QUALITY_GATES = {
  minimumCoverage: 0.9 as const,
  maximumMissing: 15 as const,
  maximumHallucinations: 2 as const,
  maximumMaterialErrors: 45 as const,
  maximumSevereTimingErrors: 30 as const,
  maximumNormalizedCer: 0.55 as const,
  maximumStartMaeSeconds: 1.2 as const,
  maximumEndMaeSeconds: 1.2 as const,
  maximumP95BoundaryErrorSeconds: 3.5 as const,
  maximumOverlapPairs: 20 as const,
  minimumTrustedMappedTokens: 500 as const,
  maximumAmbiguousTimeBaseTokens: 100 as const,
  maximumRuntimeGoldInputCount: 0 as const,
  maximumDatasetHardcodingCount: 0 as const,
  maximumUnsafeFinalizationEscapeCount: 0 as const,
};

export function createC6014QualityPolicy(input: {
  vadGlobalTimebase: C6014Mode;
  textVariantVerifier: C6014Mode;
  targetedEventReasr: C6014Mode;
  artifactSemanticHashes: readonly string[];
  generatedAt?: string;
  episodeRequestBudget?: number;
}): C6014QualityPolicy {
  const core = {
    vadGlobalTimebase: input.vadGlobalTimebase,
    textVariantVerifier: input.textVariantVerifier,
    targetedEventReasr: input.targetedEventReasr,
    runtimeGoldInputCount: 0 as const,
    productionStatus: "needs-review" as const,
    finalizationMethod: "none" as const,
    machineOnlyReleaseAuthorized: false as const,
    gates: C6014_QUALITY_GATES,
    reAsrPolicy: {
      maximumRequestsPerEvent: 3 as const,
      episodeRequestBudget: input.episodeRequestBudget ?? 36,
      candidateTextPromptAllowed: false as const,
      humanMemoryPromptAllowed: false as const,
      goldPromptAllowed: false as const,
    },
    artifactSemanticHashes: [...input.artifactSemanticHashes],
  };
  return c6014QualityPolicySchema.parse({
    schemaVersion: "1.0.0",
    policyVersion: c6014PolicyVersion,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    artifactType: "c6-0-1-4-quality-policy",
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
}

export function evaluateC6014GateResults(input: {
  metrics: C6014QualityMetrics;
  runtimeGoldInputCount: number;
  datasetHardcodingCount: number;
  unsafeFinalizationEscapeCount: number;
  reproducible: boolean;
}): Record<string, boolean> {
  const metrics = input.metrics;
  return {
    coverage: metrics.goldCoverage >= C6014_QUALITY_GATES.minimumCoverage,
    missing: metrics.missingCount <= C6014_QUALITY_GATES.maximumMissing,
    hallucination:
      metrics.hallucinationCount <= C6014_QUALITY_GATES.maximumHallucinations,
    material:
      metrics.materialErrorCount <= C6014_QUALITY_GATES.maximumMaterialErrors,
    severeTiming:
      metrics.severeTimingErrorCount <=
      C6014_QUALITY_GATES.maximumSevereTimingErrors,
    normalizedCer:
      metrics.normalizedCer <= C6014_QUALITY_GATES.maximumNormalizedCer,
    startMae:
      metrics.startMaeSeconds <= C6014_QUALITY_GATES.maximumStartMaeSeconds,
    endMae: metrics.endMaeSeconds <= C6014_QUALITY_GATES.maximumEndMaeSeconds,
    p95:
      metrics.p95BoundaryErrorSeconds <=
      C6014_QUALITY_GATES.maximumP95BoundaryErrorSeconds,
    overlap:
      metrics.overlapPairCount <= C6014_QUALITY_GATES.maximumOverlapPairs,
    trustedTokens:
      metrics.trustedMappedTokenCount >=
      C6014_QUALITY_GATES.minimumTrustedMappedTokens,
    ambiguousTokens:
      metrics.ambiguousTimeBaseTokenCount <=
      C6014_QUALITY_GATES.maximumAmbiguousTimeBaseTokens,
    goldIsolation:
      input.runtimeGoldInputCount <=
      C6014_QUALITY_GATES.maximumRuntimeGoldInputCount,
    datasetHardcoding:
      input.datasetHardcodingCount <=
      C6014_QUALITY_GATES.maximumDatasetHardcodingCount,
    unsafeEscape:
      input.unsafeFinalizationEscapeCount <=
      C6014_QUALITY_GATES.maximumUnsafeFinalizationEscapeCount,
    reproducibility: input.reproducible,
  };
}

export function buildC6014QualityComparison(input: {
  rawAsr: C6014QualityMetrics;
  baseline: C6014QualityMetrics;
  candidate: C6014QualityMetrics;
  selectorRecoveryPassed: boolean;
  candidatePoolRecoveryPassed: boolean;
  vadTimebaseRecoveryPassed: boolean;
  tokenTimelineRecoveryPassed: boolean;
  reproducible: boolean;
  runtimeGoldInputCount?: number;
  datasetHardcodingCount?: number;
  unsafeFinalizationEscapeCount?: number;
  generatedAt?: string;
}): C6014QualityComparison {
  const gateResults = evaluateC6014GateResults({
    metrics: input.candidate,
    runtimeGoldInputCount: input.runtimeGoldInputCount ?? 0,
    datasetHardcodingCount: input.datasetHardcodingCount ?? 0,
    unsafeFinalizationEscapeCount: input.unsafeFinalizationEscapeCount ?? 0,
    reproducible: input.reproducible,
  });
  const coverageGuardPassed =
    gateResults.coverage === true &&
    gateResults.missing === true &&
    gateResults.hallucination === true;
  const precisionRecoveryPassed = gateResults.material === true;
  const timingRecoveryPassed =
    gateResults.severeTiming === true &&
    gateResults.startMae === true &&
    gateResults.endMae === true &&
    gateResults.p95 === true &&
    gateResults.overlap === true;
  const allGatesPassed = Object.values(gateResults).every(Boolean);
  const outcome =
    allGatesPassed &&
    input.selectorRecoveryPassed &&
    input.candidatePoolRecoveryPassed &&
    input.vadTimebaseRecoveryPassed &&
    input.tokenTimelineRecoveryPassed
      ? ("GO_C6_0_2" as const)
      : ("HOLD_FOR_MORE_ACOUSTIC_TEXT_RECOVERY" as const);
  const core = {
    rawAsr: input.rawAsr,
    baseline: input.baseline,
    candidate: input.candidate,
    gateResults,
    selectorRecoveryPassed: input.selectorRecoveryPassed,
    candidatePoolRecoveryPassed: input.candidatePoolRecoveryPassed,
    vadTimebaseRecoveryPassed: input.vadTimebaseRecoveryPassed,
    tokenTimelineRecoveryPassed: input.tokenTimelineRecoveryPassed,
    precisionRecoveryPassed,
    timingRecoveryPassed,
    coverageGuardPassed,
    outcome,
  };
  return c6014QualityComparisonSchema.parse({
    schemaVersion: "1.0.0",
    policyVersion: c6014PolicyVersion,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    artifactType: "c6-0-1-4-quality-comparison",
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
}
