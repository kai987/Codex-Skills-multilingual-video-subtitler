import {
  c6015PolicyVersion,
  machineCanonicalMutationProposalsSchema,
  type C6015Mode,
  type MachineCanonicalMutationProposals,
  type MachineEventToFinalCueLineage,
  type MachineTrustedTokenTimingProposals,
  type MachineVariantEvidenceBundle,
  type SubtitleCue,
} from "@mvl/shared";

import {
  machineQualitySemanticHash,
  normalizeCandidateText,
} from "./evidence-correlation.js";

export interface VariantSelectionInput {
  eventId: string;
  currentVariantId: string;
  selectedVariantId: string | null;
}

export interface CandidateTextInput {
  variantId: string;
  text: string;
  hallucinationRisk: number | null;
}

function evidenceRank(value: "COMPLETE" | "PARTIAL" | "UNAVAILABLE"): number {
  return value === "COMPLETE" ? 2 : value === "PARTIAL" ? 1 : 0;
}

export function buildCanonicalMutationProposals(input: {
  mode: C6015Mode;
  cues: readonly SubtitleCue[];
  lineage: MachineEventToFinalCueLineage;
  variantEvidence: MachineVariantEvidenceBundle;
  selections: readonly VariantSelectionInput[];
  candidateTexts: readonly CandidateTextInput[];
  timing: MachineTrustedTokenTimingProposals;
  generatedAt?: string;
}): MachineCanonicalMutationProposals {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const cueById = new Map(input.cues.map((cue) => [cue.id, cue] as const));
  const lineageByEvent = new Map(
    input.lineage.events.map((event) => [event.eventId, event] as const),
  );
  const evidenceByVariant = new Map(
    input.variantEvidence.variants.map((variant) => [
      variant.variantId,
      variant,
    ]),
  );
  const candidateById = new Map(
    input.candidateTexts.map((candidate) => [candidate.variantId, candidate]),
  );
  const textProposals = input.selections.flatMap((selection) => {
    if (
      selection.selectedVariantId === null ||
      selection.selectedVariantId === selection.currentVariantId
    ) {
      return [];
    }
    const lineage = lineageByEvent.get(selection.eventId);
    const from = candidateById.get(selection.currentVariantId);
    const to = candidateById.get(selection.selectedVariantId);
    const beforeEvidence = evidenceByVariant.get(selection.currentVariantId);
    const afterEvidence = evidenceByVariant.get(selection.selectedVariantId);
    const finalCueIds = lineage?.finalCueIds ?? [];
    const finalCues = finalCueIds.flatMap((cueId) => {
      const cue = cueById.get(cueId);
      return cue === undefined ? [] : [cue];
    });
    if (from === undefined || to === undefined || finalCues.length === 0)
      return [];
    const sameText =
      normalizeCandidateText(from.text) === normalizeCandidateText(to.text);
    const lineageVerified =
      lineage?.modifiable === true && lineage.finalCueIds.length === 1;
    const complete = afterEvidence?.evidenceCompleteness === "COMPLETE";
    const tierStronger =
      afterEvidence !== undefined &&
      beforeEvidence !== undefined &&
      evidenceRank(afterEvidence.evidenceCompleteness) >
        evidenceRank(beforeEvidence.evidenceCompleteness);
    const ctcStronger =
      afterEvidence?.ctcScore !== null &&
      afterEvidence?.ctcScore !== undefined &&
      beforeEvidence?.ctcScore !== null &&
      beforeEvidence?.ctcScore !== undefined &&
      afterEvidence.ctcScore >= beforeEvidence.ctcScore + 0.08;
    const tokenStronger =
      (afterEvidence?.tokenCoverage.coverageRatio ?? 0) >=
      (beforeEvidence?.tokenCoverage.coverageRatio ?? 0) + 0.2;
    const evidenceStronger = tierStronger || ctcStronger || tokenStronger;
    const supportNonDegrading =
      (afterEvidence?.independentSupportGroups.length ?? 0) >=
      (beforeEvidence?.independentSupportGroups.length ?? 0);
    const hallucinationNonDegrading =
      to.hallucinationRisk === null ||
      from.hallucinationRisk === null ||
      to.hallucinationRisk <= from.hallucinationRisk;
    const acousticSafe =
      afterEvidence?.ctcScore !== null &&
      afterEvidence?.ctcScore !== undefined &&
      afterEvidence.ctcScore >= 0.55;
    const nonDegradationPassed =
      !sameText && supportNonDegrading && hallucinationNonDegrading;
    const safetyPassed =
      lineageVerified &&
      complete &&
      evidenceStronger &&
      acousticSafe &&
      nonDegradationPassed;
    const rejectionReasons = [
      ...(sameText ? ["same-normalized-text"] : []),
      ...(!lineageVerified ? ["event-final-lineage-not-single-target"] : []),
      ...(!complete ? ["replacement-evidence-incomplete"] : []),
      ...(!evidenceStronger
        ? ["replacement-evidence-not-strictly-stronger"]
        : []),
      ...(!acousticSafe ? ["replacement-acoustic-support-insufficient"] : []),
      ...(!supportNonDegrading ? ["independent-support-would-decrease"] : []),
      ...(!hallucinationNonDegrading
        ? ["hallucination-risk-would-increase"]
        : []),
    ];
    const core = {
      proposalId: `c6015-text:${selection.eventId}:${selection.selectedVariantId}`,
      eventId: selection.eventId,
      finalCueIds,
      proposalType:
        afterEvidence?.reAsrOrigin.isReAsr === true
          ? ("REASR_TEXT_REPLACE" as const)
          : ("TEXT_VARIANT_REPLACE" as const),
      fromVariantId: selection.currentVariantId,
      toVariantId: selection.selectedVariantId,
      beforeText: finalCues.map((cue) => cue.text).join(""),
      afterText: to.text,
      beforeTiming: finalCues.map((cue) => ({
        start: cue.start,
        end: cue.end,
      })),
      afterTiming: finalCues.map((cue) => ({
        start: cue.start,
        end: cue.end,
      })),
      evidenceIds: [
        ...(afterEvidence?.ctcEvidenceIds ?? []),
        ...(afterEvidence?.trustedGlobalTokenIds ?? []),
      ],
      evidenceTier:
        complete && evidenceStronger ? ("STRONG" as const) : ("WEAK" as const),
      evidenceDominance: evidenceStronger
        ? ("STRICTLY_STRONGER" as const)
        : ("INCOMPARABLE" as const),
      lineageVerified,
      nonDegradationPassed,
      safetyPassed,
      applyStatus: safetyPassed
        ? ("ACCEPTED" as const)
        : sameText
          ? ("NO_OP" as const)
          : ("REJECTED" as const),
      rejectionReasons,
      oracleInfo: "evaluation-only-not-runtime-input" as const,
    };
    if (core.evidenceIds.length === 0)
      core.evidenceIds.push(`variant:${selection.selectedVariantId}`);
    return [{ ...core, semanticHash: machineQualitySemanticHash(core) }];
  });
  const timingProposals = input.timing.proposals.flatMap((timing) => {
    if (timing.proposedInterval === null) return [];
    const cue = cueById.get(timing.cueId);
    if (cue === undefined) return [];
    const changedStart =
      Math.abs(timing.proposedInterval.start - cue.start) >= 0.001;
    const changedEnd = Math.abs(timing.proposedInterval.end - cue.end) >= 0.001;
    const accepted = timing.proposalStatus === "ACCEPTED";
    const core = {
      proposalId: `c6015-canonical:${timing.proposalId}`,
      eventId: timing.eventId,
      finalCueIds: [timing.cueId],
      proposalType:
        changedStart && changedEnd
          ? ("BOTH_BOUNDARIES_REFINE" as const)
          : changedStart
            ? ("START_TIME_REFINE" as const)
            : changedEnd
              ? ("END_TIME_REFINE" as const)
              : ("NO_OP" as const),
      fromVariantId: null,
      toVariantId: null,
      beforeText: cue.text,
      afterText: cue.text,
      beforeTiming: [{ start: cue.start, end: cue.end }],
      afterTiming: [timing.proposedInterval],
      evidenceIds:
        timing.trustedTokenIds.length > 0
          ? timing.trustedTokenIds
          : [`timing:${timing.proposalId}`],
      evidenceTier:
        timing.confidenceClass === "HIGH"
          ? ("STRONG" as const)
          : ("MEDIUM" as const),
      evidenceDominance: accepted
        ? ("NON_DEGRADING" as const)
        : ("INCOMPARABLE" as const),
      lineageVerified: !timing.blockers.some((blocker) =>
        blocker.includes("lineage"),
      ),
      nonDegradationPassed: accepted,
      safetyPassed: accepted,
      applyStatus: accepted
        ? ("ACCEPTED" as const)
        : timing.proposalStatus === "UNCHANGED"
          ? ("NO_OP" as const)
          : ("REJECTED" as const),
      rejectionReasons: timing.blockers,
      oracleInfo: "evaluation-only-not-runtime-input" as const,
    };
    return [{ ...core, semanticHash: machineQualitySemanticHash(core) }];
  });
  const proposals = [...textProposals, ...timingProposals].toSorted(
    (left, right) => left.proposalId.localeCompare(right.proposalId),
  );
  const summary = {
    proposedCount: proposals.length,
    acceptedCount: proposals.filter(
      (proposal) => proposal.applyStatus === "ACCEPTED",
    ).length,
    rejectedCount: proposals.filter(
      (proposal) => proposal.applyStatus === "REJECTED",
    ).length,
    noOpCount: proposals.filter((proposal) => proposal.applyStatus === "NO_OP")
      .length,
    textProposalCount: proposals.filter((proposal) =>
      proposal.proposalType.includes("TEXT"),
    ).length,
    timingProposalCount: proposals.filter(
      (proposal) =>
        proposal.proposalType.includes("TIME") ||
        proposal.proposalType.includes("BOUNDARIES"),
    ).length,
    structuralObserveOnlyCount: proposals.filter((proposal) =>
      ["SPLIT_CUE", "MERGE_CUE", "DROP_HALLUCINATION"].includes(
        proposal.proposalType,
      ),
    ).length,
  };
  const core = { mode: input.mode, proposals, summary };
  return machineCanonicalMutationProposalsSchema.parse({
    schemaVersion: "1.0.0",
    policyVersion: c6015PolicyVersion,
    generatedAt,
    artifactType: "machine-canonical-mutation-proposals",
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
}
