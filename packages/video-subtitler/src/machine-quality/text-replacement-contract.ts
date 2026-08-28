import {
  machineTextReplacementContractSchema,
  type MachineTextReplacementContract,
} from "@mvl/shared";

import {
  machineQualitySemanticHash,
  normalizeCandidateText,
} from "./evidence-correlation.js";

type EvidenceTier = "NONE" | "WEAK" | "MEDIUM" | "STRONG";
type AcousticComparison =
  "DOMINATES" | "WEAKER" | "INCOMPARABLE" | "UNSCORABLE";
type TokenComparison =
  "MORE_SUPPORT" | "SAME_SUPPORT" | "LESS_SUPPORT" | "CONFLICT" | "UNAVAILABLE";

const evidenceTierRank: Record<EvidenceTier, number> = {
  NONE: 0,
  WEAK: 1,
  MEDIUM: 2,
  STRONG: 3,
};

export interface TextReplacementProposal {
  fromCandidateId: string;
  fromText: string;
  toCandidateId: string;
  toText: string;
  eventId: string;
  evidenceTierBefore: EvidenceTier;
  evidenceTierAfter: EvidenceTier;
  acousticComparison: AcousticComparison;
  tokenComparison: TokenComparison;
  independentSupportBefore: number;
  independentSupportAfter: number;
  toCandidateIsRealMachineCandidate: boolean;
  timingProposalId: string | null;
  timingNonDegradationPassed: boolean;
}

export function buildTextReplacementContract(input: {
  proposals: readonly TextReplacementProposal[];
  beforeTextHash: string;
  afterTextHash: string;
  beforeTimingHash: string;
  afterTimingHash: string;
  presentationHash: string;
  canonicalTextMutationCount: number;
  canonicalTimingMutationCount: number;
  presentationMutationCount: number;
  generatedAt?: string;
}): MachineTextReplacementContract {
  const records = [...input.proposals]
    .toSorted(
      (left, right) =>
        left.eventId.localeCompare(right.eventId) ||
        left.toCandidateId.localeCompare(right.toCandidateId),
    )
    .map((proposal, index) => {
      const sameText =
        normalizeCandidateText(proposal.fromText) ===
        normalizeCandidateText(proposal.toText);
      const strongerTier =
        evidenceTierRank[proposal.evidenceTierAfter] >
        evidenceTierRank[proposal.evidenceTierBefore];
      const acousticSafe = proposal.acousticComparison === "DOMINATES";
      const tokenSafe = !["LESS_SUPPORT", "CONFLICT"].includes(
        proposal.tokenComparison,
      );
      const supportSafe =
        proposal.independentSupportAfter >= proposal.independentSupportBefore;
      const accepted =
        !sameText &&
        proposal.toCandidateIsRealMachineCandidate &&
        strongerTier &&
        acousticSafe &&
        tokenSafe &&
        supportSafe &&
        proposal.timingNonDegradationPassed;
      const reason = sameText
        ? "same-normalized-text-does-not-require-canonical-mutation"
        : !proposal.toCandidateIsRealMachineCandidate
          ? "replacement-target-is-not-a-real-machine-candidate"
          : !strongerTier
            ? "replacement-evidence-tier-is-not-strictly-stronger"
            : !acousticSafe
              ? "replacement-does-not-acoustically-dominate"
              : !tokenSafe
                ? "replacement-conflicts-with-token-evidence"
                : !supportSafe
                  ? "replacement-reduces-independent-support"
                  : !proposal.timingNonDegradationPassed
                    ? "timing-non-degradation-gate-rejected-replacement"
                    : "strictly-stronger-machine-candidate-evidence-accepted";
      const core = {
        replacementId: `c6014-replacement-${String(index + 1).padStart(4, "0")}`,
        fromCandidateId: proposal.fromCandidateId,
        toCandidateId: proposal.toCandidateId,
        eventId: proposal.eventId,
        evidenceTierBefore: proposal.evidenceTierBefore,
        evidenceTierAfter: proposal.evidenceTierAfter,
        acousticComparison: proposal.acousticComparison,
        tokenComparison: proposal.tokenComparison,
        independentSupportBefore: proposal.independentSupportBefore,
        independentSupportAfter: proposal.independentSupportAfter,
        reason,
        accepted,
        textSourceIsRealMachineCandidate: true as const,
        freeRewriteUsed: false as const,
        timingProposalId: proposal.timingProposalId,
        timingNonDegradationPassed: proposal.timingNonDegradationPassed,
      };
      return { ...core, semanticHash: machineQualitySemanticHash(core) };
    });
  const acceptedCount = records.filter((record) => record.accepted).length;
  const core = {
    records,
    summary: {
      proposedCount: records.length,
      acceptedCount,
      rejectedCount: records.length - acceptedCount,
      canonicalTextMutationCount: input.canonicalTextMutationCount,
      canonicalTimingMutationCount: input.canonicalTimingMutationCount,
      presentationMutationCount: input.presentationMutationCount,
      freeRewriteCount: 0 as const,
      weakEvidenceReplacementCount: 0 as const,
    },
    beforeTextHash: input.beforeTextHash,
    afterTextHash: input.afterTextHash,
    beforeTimingHash: input.beforeTimingHash,
    afterTimingHash: input.afterTimingHash,
    presentationHash: input.presentationHash,
  };
  return machineTextReplacementContractSchema.parse({
    schemaVersion: "1.0.0",
    policyVersion: "c6.0.1.4-vad-timebase-acoustic-text-variant-reasr-v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    artifactType: "machine-text-replacement-contract",
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
}
