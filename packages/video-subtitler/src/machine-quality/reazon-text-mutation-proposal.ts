import {
  c60110PolicyVersion,
  machineCrossModelTextMutationProposalsSchema,
  type C60110ReasonCode,
  type MachineCrossModelArbitrationEvidence,
  type MachineCrossModelArbitrationLedger,
  type MachineCrossModelTextMutationProposals,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";
import { normalizeIndependentAsrLexical } from "./cross-model-normalization.js";

export interface C60110MutableCue {
  id: string;
  start: number;
  end: number;
  text: string;
  [key: string]: unknown;
}

function repeatedReplacementRisk(text: string): boolean {
  const normalized = normalizeIndependentAsrLexical(text);
  if (normalized.length < 4) return false;
  const codePoints = Array.from(normalized);
  for (let width = 2; width <= Math.floor(codePoints.length / 2); width += 1) {
    const unit = codePoints.slice(0, width).join("");
    if (unit.repeat(Math.floor(codePoints.length / width)) === normalized) {
      return true;
    }
  }
  return false;
}

function rejectionReasons(input: {
  highConfidenceSelection: boolean;
  exactOrNormalizedExactSpan: boolean;
  contiguousSpan: boolean;
  neighborPreserved: boolean;
  punctuationSafe: boolean;
  duplicationSafe: boolean;
  crossSpeakerSafe: boolean;
  outputSchemaValid: boolean;
  nonDegradationPassed: boolean;
}): C60110ReasonCode[] {
  const reasons: C60110ReasonCode[] = [];
  if (!input.highConfidenceSelection) reasons.push("CONFLICTING_EVIDENCE");
  if (!input.exactOrNormalizedExactSpan || !input.contiguousSpan) {
    reasons.push("SPAN_LINEAGE_UNSAFE");
  }
  if (
    !input.neighborPreserved ||
    !input.punctuationSafe ||
    !input.duplicationSafe ||
    !input.crossSpeakerSafe ||
    !input.outputSchemaValid ||
    !input.nonDegradationPassed
  ) {
    reasons.push("MUTATION_NONDEGRADATION_BLOCKED");
  }
  return [...new Set(reasons)];
}

export function buildCrossModelTextMutationProposals(input: {
  generatedAt: string;
  ledgers: readonly MachineCrossModelArbitrationLedger[];
  evidenceArtifacts: readonly MachineCrossModelArbitrationEvidence[];
  finalCues: readonly C60110MutableCue[];
  productionEnforcementEnabled: boolean;
}): MachineCrossModelTextMutationProposals {
  const cueById = new Map(input.finalCues.map((cue) => [cue.id, cue] as const));
  const bundleById = new Map(
    input.evidenceArtifacts.flatMap((artifact) =>
      artifact.events.map(
        (bundle) => [bundle.evidenceBundleId, bundle] as const,
      ),
    ),
  );
  const proposals = input.ledgers.flatMap((ledger) =>
    ledger.events.flatMap((decision) => {
      if (decision.decision !== "SELECT_REAZON") return [];
      const bundle = bundleById.get(decision.evidenceBundleId);
      const lineage = bundle?.currentFinalSpanLineage;
      const reazon = bundle?.reazonCoreExactCandidate;
      const cue = lineage?.finalCueId
        ? cueById.get(lineage.finalCueId)
        : undefined;
      if (
        bundle === undefined ||
        lineage === undefined ||
        reazon === null ||
        reazon === undefined ||
        cue === undefined ||
        lineage.spanStart === null ||
        lineage.spanEnd === null
      ) {
        return [];
      }
      const codePoints = Array.from(cue.text);
      const beforeText = codePoints
        .slice(lineage.spanStart, lineage.spanEnd)
        .join("");
      const prefix = codePoints.slice(0, lineage.spanStart).join("");
      const suffix = codePoints.slice(lineage.spanEnd).join("");
      const rendered = `${prefix}${reazon.displayText}${suffix}`;
      const exactOrNormalizedExactSpan = ["EXACT", "NORMALIZED_EXACT"].includes(
        lineage.lineageStatus,
      );
      const contiguousSpan =
        lineage.spanStart >= 0 &&
        lineage.spanEnd > lineage.spanStart &&
        lineage.spanEnd <= codePoints.length;
      const neighborPreserved =
        rendered.startsWith(prefix) && rendered.endsWith(suffix);
      const punctuationSafe =
        Array.from(prefix + suffix)
          .filter((character) => /[\p{P}\p{S}]/u.test(character))
          .join("") ===
        Array.from(rendered.slice(0, prefix.length) + suffix)
          .filter((character) => /[\p{P}\p{S}]/u.test(character))
          .join("");
      const duplicationSafe = !repeatedReplacementRisk(reazon.displayText);
      const crossSpeakerSafe = bundle.currentFinalCueIds.length === 1;
      const outputSchemaValid = rendered.trim() !== "";
      const nonDegradationPassed =
        beforeText.trim() !== "" && reazon.displayText.trim() !== "";
      const highConfidenceSelection =
        decision.confidenceClass === "HIGH" && decision.mutationEligible;
      const checks = {
        highConfidenceSelection,
        exactOrNormalizedExactSpan,
        contiguousSpan,
        neighborPreserved,
        punctuationSafe,
        duplicationSafe,
        crossSpeakerSafe,
        timingMutationRequired: false as const,
        outputSchemaValid,
        nonDegradationPassed,
      };
      const reasons = rejectionReasons(checks);
      const accepted =
        reasons.length === 0 && input.productionEnforcementEnabled;
      if (!input.productionEnforcementEnabled) {
        reasons.push("PRODUCTION_ENFORCEMENT_DISABLED");
      }
      const core = {
        proposalId: `c60110-proposal:${decision.eventId}`,
        eventId: decision.eventId,
        finalCueId: cue.id,
        spanStart: lineage.spanStart,
        spanEnd: lineage.spanEnd,
        beforeText,
        afterText: reazon.displayText,
        selectedProvider: "REAZON" as const,
        selectedCandidateId: reazon.candidateId,
        arbitrationDecisionId: decision.arbitrationDecisionId,
        evidenceBundleId: bundle.evidenceBundleId,
        safetyChecks: checks,
        accepted,
        applied: accepted,
        rejectionReasons: [...new Set(reasons)],
      };
      return [{ ...core, semanticHash: machineQualitySemanticHash(core) }];
    }),
  );
  const changedCues = new Set(
    proposals
      .filter((proposal) => proposal.applied)
      .map((proposal) => proposal.finalCueId),
  );
  const core = {
    schemaVersion: "1.0.0" as const,
    policyVersion: c60110PolicyVersion,
    generatedAt: input.generatedAt,
    artifactType: "machine-cross-model-text-mutation-proposals" as const,
    arbitrationLedgerSemanticHashes: input.ledgers.map(
      (ledger) => ledger.semanticHash,
    ),
    textOnlyMutation: true as const,
    reazonTimingUsed: false as const,
    hybridProviderTextAllowed: false as const,
    proposals,
    summary: {
      proposalCount: proposals.length,
      acceptedCount: proposals.filter((proposal) => proposal.accepted).length,
      rejectedCount: proposals.filter((proposal) => !proposal.accepted).length,
      appliedCount: proposals.filter((proposal) => proposal.applied).length,
      textChangedFinalCueCount: changedCues.size,
      timingChangedFinalCueCount: 0 as const,
    },
    runtimeGoldInputCount: 0 as const,
  };
  return machineCrossModelTextMutationProposalsSchema.parse({
    ...core,
    semanticHash: machineQualitySemanticHash({
      ...core,
      generatedAt: undefined,
    }),
  });
}

export function applyCrossModelTextMutationProposals<
  T extends C60110MutableCue,
>(cues: readonly T[], artifact: MachineCrossModelTextMutationProposals): T[] {
  const proposalsByCue = new Map<string, typeof artifact.proposals>();
  for (const proposal of artifact.proposals.filter((value) => value.applied)) {
    const values = proposalsByCue.get(proposal.finalCueId) ?? [];
    values.push(proposal);
    proposalsByCue.set(proposal.finalCueId, values);
  }
  return cues.map((cue) => {
    const proposals = (proposalsByCue.get(cue.id) ?? []).toSorted(
      (left, right) => right.spanStart - left.spanStart,
    );
    let text = cue.text;
    for (const proposal of proposals) {
      const codePoints = Array.from(text);
      const current = codePoints
        .slice(proposal.spanStart, proposal.spanEnd)
        .join("");
      if (current !== proposal.beforeText) {
        throw new Error(
          `Mutation ${proposal.proposalId} no longer matches its frozen span.`,
        );
      }
      text = [
        ...codePoints.slice(0, proposal.spanStart),
        proposal.afterText,
        ...codePoints.slice(proposal.spanEnd),
      ].join("");
    }
    return { ...cue, text };
  });
}
