import {
  c6015PolicyVersion,
  machineEvidenceApplicationCoverageSchema,
  type MachineCanonicalMutationLedger,
  type MachineCanonicalMutationProposals,
  type MachineEvidenceApplicationCoverage,
  type MachineEventToFinalCueLineage,
  type MachineRawAsrEventRecovery,
  type MachineTrustedTokenTimingProposals,
  type MachineVariantEvidenceBundle,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";

export function buildEvidenceApplicationCoverage(input: {
  trustedTokenCount: number;
  timingEligibleCueCount: number;
  ctcEvidenceCount: number;
  variantDecisionCount: number;
  lineage: MachineEventToFinalCueLineage;
  variants: MachineVariantEvidenceBundle;
  timing: MachineTrustedTokenTimingProposals;
  recovery: MachineRawAsrEventRecovery;
  proposals: MachineCanonicalMutationProposals;
  ledger: MachineCanonicalMutationLedger;
  generatedAt?: string;
}): MachineEvidenceApplicationCoverage {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const ctcEvidenceConsumedCount = new Set(
    input.variants.variants.flatMap((variant) => variant.ctcEvidenceIds),
  ).size;
  const trustedTokenConsumedCount = new Set(
    input.variants.variants.flatMap((variant) => variant.trustedGlobalTokenIds),
  ).size;
  const newReAsrCandidateIds = new Set(
    input.recovery.events.flatMap((event) => event.newCandidateIds),
  );
  const reAsrCandidateCount = newReAsrCandidateIds.size;
  const reAsrCandidateEvaluatedCount = new Set(
    input.recovery.events.flatMap((event) =>
      event.evaluatedCandidateIds.filter((candidateId) =>
        newReAsrCandidateIds.has(candidateId),
      ),
    ),
  ).size;
  const reAsrCandidateSelectedCount = input.recovery.events.filter(
    (event) =>
      event.selectedCandidateId !== null &&
      newReAsrCandidateIds.has(event.selectedCandidateId),
  ).length;
  const finalArtifactMutationCount =
    input.ledger.summary.finalArtifactMutationCount;
  const stages = {
    produced:
      input.trustedTokenCount + input.ctcEvidenceCount + reAsrCandidateCount,
    eligible:
      input.timingEligibleCueCount +
      input.variants.variants.filter(
        (variant) => variant.evidenceCompleteness !== "UNAVAILABLE",
      ).length,
    consumed:
      trustedTokenConsumedCount +
      ctcEvidenceConsumedCount +
      reAsrCandidateEvaluatedCount,
    proposalGenerated: input.proposals.summary.proposedCount,
    applied: input.ledger.summary.appliedCount,
    affectedFinalOutput: finalArtifactMutationCount,
  };
  const blockerReasons = [
    ...(input.trustedTokenCount > 0 &&
    trustedTokenConsumedCount === 0 &&
    input.timing.summary.proposalGeneratedCount === 0
      ? ["trusted-token-evidence-produced-but-not-consumed-or-proposed"]
      : []),
    ...(input.ctcEvidenceCount > 0 && ctcEvidenceConsumedCount === 0
      ? ["ctc-evidence-produced-but-not-consumed"]
      : []),
    ...(reAsrCandidateCount > 0 && reAsrCandidateEvaluatedCount === 0
      ? ["reasr-candidates-produced-but-not-evaluated"]
      : []),
    ...input.ledger.noOpReason,
  ];
  const engineeringGatePassed =
    input.lineage.summary.lineageCoverageRatio >= 0.95 &&
    input.timing.summary.evidenceApplicationPassed &&
    (input.trustedTokenCount === 0 || trustedTokenConsumedCount > 0) &&
    (input.ctcEvidenceCount === 0 || ctcEvidenceConsumedCount > 0) &&
    (reAsrCandidateCount === 0 || reAsrCandidateEvaluatedCount > 0);
  const core = {
    trustedTokenCount: input.trustedTokenCount,
    trustedTokenConsumedCount,
    timingEligibleCueCount: input.timingEligibleCueCount,
    timingProposalCount: input.timing.summary.proposalGeneratedCount,
    timingAppliedCount: input.ledger.summary.timingMutationAppliedCount,
    ctcEvidenceCount: input.ctcEvidenceCount,
    ctcEvidenceConsumedCount,
    reAsrCandidateCount,
    reAsrCandidateEvaluatedCount,
    reAsrCandidateSelectedCount,
    variantEvidenceCount: input.variants.summary.variantEvidenceCount,
    variantDecisionCount: input.variantDecisionCount,
    replacementProposalCount: input.proposals.summary.textProposalCount,
    replacementAppliedCount: input.ledger.summary.textMutationAppliedCount,
    eventFinalLineageCoverage: input.lineage.summary.lineageCoverageRatio,
    finalArtifactMutationCount,
    stages,
    blockerReasons,
    engineeringGatePassed,
  };
  return machineEvidenceApplicationCoverageSchema.parse({
    schemaVersion: "1.0.0",
    policyVersion: c6015PolicyVersion,
    generatedAt,
    artifactType: "machine-evidence-application-coverage",
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
}
