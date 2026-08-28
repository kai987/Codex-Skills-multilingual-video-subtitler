import {
  c6015PolicyVersion,
  machineCandidatePoolC6015Schema,
  type C6015Mode,
  type MachineCandidatePoolC6015,
  type MachineCanonicalMutationProposals,
  type MachineVariantEvidenceBundle,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";

export interface C6015CandidatePoolVariant {
  variantId: string;
  eventId: string;
  text: string;
  interval: { start: number; end: number };
  eventInterval: { start: number; end: number };
  requestIds: readonly string[];
  sourceWindowIds: readonly string[];
  independentSupportGroups: readonly string[];
  correlatedSupportGroups: readonly string[];
  reAsrOrigin: {
    isReAsr: boolean;
    sourceGlobalVerified: boolean;
    promptIsolated: boolean;
  };
}

export interface C6015CandidatePoolEvent {
  eventId: string;
  currentVariantId: string;
  variants: readonly C6015CandidatePoolVariant[];
}

function origin(
  variant: C6015CandidatePoolVariant,
): MachineCandidatePoolC6015["candidates"][number]["origin"] {
  if (variant.variantId.startsWith("c6015-raw-reasr:")) {
    return "c6.0.1.5-raw-reasr";
  }
  return variant.reAsrOrigin.isReAsr
    ? "c6.0.1.4-targeted-reasr"
    : "baseline-machine-candidate";
}

/**
 * Persists every real candidate that participated in the C6.0.1.5 pool.
 * This is a private run artifact; shareable summaries expose counts/hashes only.
 */
export function buildC6015CandidatePool(input: {
  mode: C6015Mode;
  events: readonly C6015CandidatePoolEvent[];
  selectedByEvent: ReadonlyMap<string, string>;
  evidence: MachineVariantEvidenceBundle;
  proposals: MachineCanonicalMutationProposals;
  generatedAt?: string;
}): MachineCandidatePoolC6015 {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const evidenceByVariant = new Map(
    input.evidence.variants.map((entry) => [entry.variantId, entry] as const),
  );
  const proposalByEvent = new Map(
    input.proposals.proposals
      .filter((proposal) =>
        ["TEXT_VARIANT_REPLACE", "REASR_TEXT_REPLACE"].includes(
          proposal.proposalType,
        ),
      )
      .map((proposal) => [proposal.eventId, proposal] as const),
  );
  const candidates = input.events
    .flatMap((event) =>
      event.variants.map((variant) => {
        const evidence = evidenceByVariant.get(variant.variantId);
        if (evidence === undefined) {
          throw new Error(
            `Candidate ${variant.variantId} has no variant-specific evidence bundle.`,
          );
        }
        const selectedVariantId =
          input.selectedByEvent.get(event.eventId) ?? event.currentVariantId;
        const core = {
          variantId: variant.variantId,
          eventId: event.eventId,
          candidateId: evidence.candidateId,
          text: variant.text,
          textHash: machineQualitySemanticHash(variant.text),
          interval: variant.interval,
          eventInterval: variant.eventInterval,
          requestIds: [...new Set(variant.requestIds)].toSorted(),
          sourceWindowIds: [...new Set(variant.sourceWindowIds)].toSorted(),
          independentSupportGroups: [
            ...new Set(variant.independentSupportGroups),
          ].toSorted(),
          correlatedSupportGroups: [
            ...new Set(variant.correlatedSupportGroups),
          ].toSorted(),
          origin: origin(variant),
          sourceGlobalVerified: variant.reAsrOrigin.sourceGlobalVerified,
          promptIsolated: variant.reAsrOrigin.promptIsolated,
          variantEvidenceSemanticHash: evidence.semanticHash,
          evidenceCompleteness: evidence.evidenceCompleteness,
          selected: variant.variantId === selectedVariantId,
        };
        return { ...core, semanticHash: machineQualitySemanticHash(core) };
      }),
    )
    .toSorted(
      (left, right) =>
        left.eventId.localeCompare(right.eventId) ||
        left.variantId.localeCompare(right.variantId),
    );
  const events = input.events
    .map((event) => {
      const selectedVariantId =
        input.selectedByEvent.get(event.eventId) ?? event.currentVariantId;
      const candidateIds = event.variants
        .map((variant) => variant.variantId)
        .toSorted();
      const rawRecoveryCandidateIds = candidateIds.filter((variantId) =>
        variantId.startsWith("c6015-raw-reasr:"),
      );
      const proposal = proposalByEvent.get(event.eventId);
      const core = {
        eventId: event.eventId,
        currentVariantId: event.currentVariantId,
        selectedVariantId,
        candidateIds,
        rawRecoveryCandidateIds,
        poolSizeBeforeRawRecovery:
          candidateIds.length - rawRecoveryCandidateIds.length,
        poolSizeAfterRawRecovery: candidateIds.length,
        selectionChanged: selectedVariantId !== event.currentVariantId,
        replacementProposalId: proposal?.proposalId ?? null,
      };
      return { ...core, semanticHash: machineQualitySemanticHash(core) };
    })
    .toSorted((left, right) => left.eventId.localeCompare(right.eventId));
  const summary = {
    eventCount: events.length,
    candidateCount: candidates.length,
    baselineCandidateCount: candidates.filter(
      (candidate) => candidate.origin === "baseline-machine-candidate",
    ).length,
    c6014TargetedReAsrCandidateCount: candidates.filter(
      (candidate) => candidate.origin === "c6.0.1.4-targeted-reasr",
    ).length,
    c6015RawReAsrCandidateCount: candidates.filter(
      (candidate) => candidate.origin === "c6.0.1.5-raw-reasr",
    ).length,
    completeEvidenceCandidateCount: candidates.filter(
      (candidate) => candidate.evidenceCompleteness === "COMPLETE",
    ).length,
    incompleteEvidenceCandidateCount: candidates.filter(
      (candidate) => candidate.evidenceCompleteness !== "COMPLETE",
    ).length,
    selectedRawReAsrCandidateCount: candidates.filter(
      (candidate) =>
        candidate.selected && candidate.origin === "c6.0.1.5-raw-reasr",
    ).length,
    selectionChangedEventCount: events.filter((event) => event.selectionChanged)
      .length,
    freeRewriteCount: 0 as const,
    candidateTextPromptLeakCount: 0 as const,
  };
  const core = { mode: input.mode, candidates, events, summary };
  return machineCandidatePoolC6015Schema.parse({
    schemaVersion: "1.0.0",
    policyVersion: c6015PolicyVersion,
    generatedAt,
    artifactType: "machine-candidate-pool-c6-0-1-5",
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
}
