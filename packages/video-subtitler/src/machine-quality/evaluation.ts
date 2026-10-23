import { createHash } from "node:crypto";

import type { C6011QualityMetrics, MachineVsGoldEvaluation } from "@mvl/shared";

export function c6011MetricsFromGoldEvaluation(
  evaluation: MachineVsGoldEvaluation,
): C6011QualityMetrics {
  return {
    cueCount: evaluation.alignmentMetrics.machineCueCount,
    normalizedCer: evaluation.globalTextMetrics.normalized.cer,
    speechCoverage: evaluation.coverageMetrics.goldTextCoverageRatio,
    missingDialogueCount: evaluation.missingDialogueCandidates.length,
    materialTextDefectCount: evaluation.materialTextErrors.length,
    severeTimingDefectCount: evaluation.severeTimingErrors.length,
    startMaeSeconds: evaluation.timingMetrics.startMaeSeconds,
    endMaeSeconds: evaluation.timingMetrics.endMaeSeconds,
    p95BoundaryErrorSeconds: evaluation.timingMetrics.boundaryP95Seconds,
    hallucinationCount: evaluation.hallucinationCandidates.length,
    p1DefectCount: evaluation.p1Defects.length,
  };
}

export function compareC6011QualityMetrics(
  left: C6011QualityMetrics,
  right: C6011QualityMetrics,
): number {
  return (
    left.p1DefectCount - right.p1DefectCount ||
    left.missingDialogueCount - right.missingDialogueCount ||
    left.materialTextDefectCount - right.materialTextDefectCount ||
    left.severeTimingDefectCount - right.severeTimingDefectCount ||
    left.normalizedCer - right.normalizedCer ||
    right.speechCoverage - left.speechCoverage ||
    left.hallucinationCount - right.hallucinationCount
  );
}

export function c6011MilestoneChecks(metrics: C6011QualityMetrics) {
  return {
    normalizedCer: metrics.normalizedCer <= 0.65,
    speechCoverage: metrics.speechCoverage >= 0.8,
    missingDialogue: metrics.missingDialogueCount <= 35,
    materialText: metrics.materialTextDefectCount <= 30,
    startMae: metrics.startMaeSeconds <= 1.75,
    endMae: metrics.endMaeSeconds <= 1.75,
    p95Boundary: metrics.p95BoundaryErrorSeconds <= 4.5,
    severeTiming: metrics.severeTimingDefectCount <= 25,
    hallucination: metrics.hallucinationCount <= 2,
  };
}

export function stableMachineQualityHash(value: unknown): string {
  const strip = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(strip);
    if (typeof entry !== "object" || entry === null) return entry;
    return Object.fromEntries(
      Object.entries(entry as Record<string, unknown>)
        .filter(
          ([key]) =>
            ![
              "generatedAt",
              "generationRunId",
              "runId",
              "freezeTimestamp",
              "cacheHit",
              "cacheHits",
              "cacheHitCount",
            ].includes(key),
        )
        .map(([key, nested]) => [key, strip(nested)]),
    );
  };
  return createHash("sha256")
    .update(JSON.stringify(strip(value)))
    .digest("hex");
}
