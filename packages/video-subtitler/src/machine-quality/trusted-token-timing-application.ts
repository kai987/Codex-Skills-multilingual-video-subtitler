import {
  c6015PolicyVersion,
  machineTrustedTokenTimingProposalsSchema,
  type C6015Mode,
  type MachineEventToFinalCueLineage,
  type MachineTrustedTokenTimingProposals,
  type MachineVariantEvidenceBundle,
  type SubtitleCue,
} from "@mvl/shared";

import {
  machineQualitySemanticHash,
  overlapSeconds,
} from "./evidence-correlation.js";

export interface TrustedVariantToken {
  tokenId: string;
  variantId: string;
  trusted: boolean;
  lexical: boolean;
  sourceGlobalInterval: { start: number; end: number } | null;
}

const START_PADDING_SECONDS = 0.04;
const END_PADDING_SECONDS = 0.08;

function adjacentOverlap(
  cues: readonly SubtitleCue[],
  cueId: string,
  candidate: { start: number; end: number },
): { before: number; after: number } {
  const sorted = cues.toSorted(
    (left, right) => left.start - right.start || left.end - right.end,
  );
  const index = sorted.findIndex((cue) => cue.id === cueId);
  const cue = sorted[index];
  if (cue === undefined) return { before: 0, after: 0 };
  const previous = sorted[index - 1];
  const next = sorted[index + 1];
  const before =
    (previous === undefined ? 0 : overlapSeconds(previous, cue)) +
    (next === undefined ? 0 : overlapSeconds(cue, next));
  const changed = { ...cue, ...candidate };
  const after =
    (previous === undefined ? 0 : overlapSeconds(previous, changed)) +
    (next === undefined ? 0 : overlapSeconds(changed, next));
  return { before, after };
}

export function buildTrustedTokenTimingProposals(input: {
  mode: C6015Mode;
  cues: readonly SubtitleCue[];
  lineage: MachineEventToFinalCueLineage;
  variantEvidence: MachineVariantEvidenceBundle;
  selectedVariantByEvent: ReadonlyMap<string, string>;
  tokens: readonly TrustedVariantToken[];
  timingEligibleCueIds: ReadonlySet<string>;
  overlapBlockedCueIds?: ReadonlySet<string>;
  appliedCueIds?: ReadonlySet<string>;
  generatedAt?: string;
}): MachineTrustedTokenTimingProposals {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const cueById = new Map(input.cues.map((cue) => [cue.id, cue] as const));
  const evidenceByVariant = new Map(
    input.variantEvidence.variants.map((variant) => [
      variant.variantId,
      variant,
    ]),
  );
  const tokensByVariant = new Map<string, TrustedVariantToken[]>();
  for (const token of input.tokens) {
    if (!token.trusted || !token.lexical || token.sourceGlobalInterval === null)
      continue;
    const values = tokensByVariant.get(token.variantId) ?? [];
    values.push(token);
    tokensByVariant.set(token.variantId, values);
  }
  const proposals = input.lineage.events.flatMap((event) => {
    if (event.finalCueIds.length !== 1) return [];
    const cueId = event.finalCueIds[0];
    if (cueId === undefined || !input.timingEligibleCueIds.has(cueId))
      return [];
    const cue = cueById.get(cueId);
    const variantId = input.selectedVariantByEvent.get(event.eventId);
    if (cue === undefined || variantId === undefined) return [];
    const variant = evidenceByVariant.get(variantId);
    const tokens = (tokensByVariant.get(variantId) ?? []).toSorted(
      (left, right) =>
        (left.sourceGlobalInterval?.start ?? 0) -
          (right.sourceGlobalInterval?.start ?? 0) ||
        left.tokenId.localeCompare(right.tokenId),
    );
    const intervals = tokens.flatMap((token) =>
      token.sourceGlobalInterval === null ? [] : [token.sourceGlobalInterval],
    );
    const monotonic = intervals.every(
      (current, index) =>
        index === 0 ||
        current.start >= (intervals[index - 1]?.start ?? current.start),
    );
    const tokenSpan =
      intervals.length === 0
        ? null
        : {
            start: Math.min(...intervals.map((interval) => interval.start)),
            end: Math.max(...intervals.map((interval) => interval.end)),
          };
    const proposedInterval =
      tokenSpan === null
        ? null
        : {
            start: Math.max(0, tokenSpan.start - START_PADDING_SECONDS),
            end: tokenSpan.end + END_PADDING_SECONDS,
          };
    const overlap =
      proposedInterval === null
        ? { before: 0, after: 0 }
        : adjacentOverlap(input.cues, cueId, proposedInterval);
    const durationRatio =
      proposedInterval === null
        ? 0
        : (proposedInterval.end - proposedInterval.start) /
          Math.max(0.001, cue.end - cue.start);
    const blockers = [
      ...(!event.modifiable ? ["lineage-not-single-target-modifiable"] : []),
      ...(variant === undefined ? ["selected-variant-evidence-missing"] : []),
      ...((variant?.tokenCoverage.coverageRatio ?? 0) < 0.8
        ? ["lexical-token-coverage-below-0.8"]
        : []),
      ...(!monotonic ? ["trusted-token-span-non-monotonic"] : []),
      ...(proposedInterval === null ? ["trusted-token-span-unavailable"] : []),
      ...(durationRatio < 0.5 || durationRatio > 1.8
        ? ["duration-ratio-non-degradation-failed"]
        : []),
      ...(overlap.after > overlap.before + 0.001
        ? ["adjacent-overlap-would-increase"]
        : []),
      ...(input.overlapBlockedCueIds?.has(cueId) === true
        ? ["speaker-or-overlap-contradiction"]
        : []),
    ];
    const accepted = blockers.length === 0;
    const unchanged =
      proposedInterval !== null &&
      Math.abs(proposedInterval.start - cue.start) < 0.001 &&
      Math.abs(proposedInterval.end - cue.end) < 0.001;
    const proposalStatus = input.appliedCueIds?.has(cueId)
      ? ("APPLIED" as const)
      : unchanged
        ? ("UNCHANGED" as const)
        : accepted
          ? ("ACCEPTED" as const)
          : ("REJECTED" as const);
    const core = {
      proposalId: `c6015-timing:${event.eventId}:${cueId}`,
      cueId,
      eventId: event.eventId,
      trustedTokenIds: tokens.map((token) => token.tokenId),
      lexicalCoverage: variant?.tokenCoverage.coverageRatio ?? 0,
      beforeInterval: { start: cue.start, end: cue.end },
      tokenSpan,
      proposedInterval,
      padding: {
        startSeconds: START_PADDING_SECONDS,
        endSeconds: END_PADDING_SECONDS,
      },
      confidenceClass:
        variant === undefined || tokenSpan === null
          ? ("UNAVAILABLE" as const)
          : variant.tokenCoverage.coverageRatio >= 0.95
            ? ("HIGH" as const)
            : variant.tokenCoverage.coverageRatio >= 0.8
              ? ("MEDIUM" as const)
              : ("LOW" as const),
      proposalStatus,
      blockers,
    };
    return [{ ...core, semanticHash: machineQualitySemanticHash(core) }];
  });
  const summary = {
    timingEligibleCueCount: input.timingEligibleCueIds.size,
    proposalEligibleCount: proposals.length,
    proposalGeneratedCount: proposals.filter(
      (proposal) => proposal.proposedInterval !== null,
    ).length,
    proposalAcceptedCount: proposals.filter((proposal) =>
      ["ACCEPTED", "APPLIED"].includes(proposal.proposalStatus),
    ).length,
    proposalRejectedCount: proposals.filter(
      (proposal) => proposal.proposalStatus === "REJECTED",
    ).length,
    mutationAppliedCount: proposals.filter(
      (proposal) => proposal.proposalStatus === "APPLIED",
    ).length,
    unchangedCount: proposals.filter(
      (proposal) => proposal.proposalStatus === "UNCHANGED",
    ).length,
    lineageFailedCount: proposals.filter((proposal) =>
      proposal.blockers.includes("lineage-not-single-target-modifiable"),
    ).length,
    tokenCoverageFailedCount: proposals.filter((proposal) =>
      proposal.blockers.includes("lexical-token-coverage-below-0.8"),
    ).length,
    overlapBlockedCount: proposals.filter((proposal) =>
      proposal.blockers.some((blocker) => blocker.includes("overlap")),
    ).length,
    evidenceApplicationPassed:
      input.timingEligibleCueIds.size === 0 ||
      proposals.some((proposal) => proposal.proposedInterval !== null),
  };
  const core = {
    mode: input.mode,
    paddingPolicy: {
      policyVersion: "c6.0.1.5-fixed-token-padding-v1" as const,
      startSeconds: START_PADDING_SECONDS as 0.04,
      endSeconds: END_PADDING_SECONDS as 0.08,
      goldTuned: false as const,
    },
    proposals,
    summary,
  };
  return machineTrustedTokenTimingProposalsSchema.parse({
    schemaVersion: "1.0.0",
    policyVersion: c6015PolicyVersion,
    generatedAt,
    artifactType: "machine-trusted-token-timing-proposals",
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
}
