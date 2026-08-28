import {
  c6015PolicyVersion,
  machineLocalAssociationRepairProposalsSchema,
  type MachineLocalAssociationRepairProposals,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";

export interface LocalAssociationRiskInput {
  candidateId: string;
  sourceEventId: string;
  competingEventId: string;
  currentScore: number;
  competingScore: number;
  evidenceIds: readonly string[];
  hardCompatible: boolean;
}

export function buildLocalAssociationRepairProposals(input: {
  mode?: "off" | "observe";
  inspectedEventCount: number;
  risks: readonly LocalAssociationRiskInput[];
  generatedAt?: string;
}): MachineLocalAssociationRepairProposals {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const mode = input.mode ?? "observe";
  const proposals = (mode === "observe" ? input.risks : [])
    .filter(
      (risk) =>
        risk.hardCompatible &&
        risk.competingScore >= risk.currentScore + 0.12 &&
        risk.evidenceIds.length > 0,
    )
    .map((risk, index) => {
      const margin = risk.competingScore - risk.currentScore;
      const core = {
        proposalId: `c6015-association-observe-${String(index + 1).padStart(4, "0")}`,
        sourceEventId: risk.sourceEventId,
        targetEventId: risk.competingEventId,
        candidateId: risk.candidateId,
        evidenceIds: [...new Set(risk.evidenceIds)].toSorted(),
        reason: `competing-explicit-assignment-score-margin:${margin.toFixed(6)}`,
        risk: margin >= 0.25 ? ("LOW" as const) : ("MEDIUM" as const),
        applyEligibility: "observe-only" as const,
      };
      return { ...core, semanticHash: machineQualitySemanticHash(core) };
    });
  const summary = {
    inspectedEventCount: mode === "observe" ? input.inspectedEventCount : 0,
    proposalCount: proposals.length,
    appliedCount: 0 as const,
  };
  const core = { mode, proposals, summary };
  return machineLocalAssociationRepairProposalsSchema.parse({
    schemaVersion: "1.0.0",
    policyVersion: c6015PolicyVersion,
    generatedAt,
    artifactType: "machine-local-association-repair-proposals",
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
}
