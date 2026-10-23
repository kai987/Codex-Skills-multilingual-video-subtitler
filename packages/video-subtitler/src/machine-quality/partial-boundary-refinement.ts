import { formatAss, formatSrt, formatVtt } from "@mvl/subtitle-core";
import {
  c6016PolicyVersion,
  machinePartialBoundaryProposalsSchema,
  subtitlePackageSchema,
  type C6016Mode,
  type MachinePartialBoundaryProposals,
  type PartialBoundaryProposal,
  type SubtitlePackage,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";

export const C6016_BOUNDARY_COVERAGE_MINIMUM = 0.8;
export const C6016_BOUNDARY_PADDING_SECONDS = 0.08;
export const C6016_BOUNDARY_MAXIMUM_SHIFT_SECONDS = 1.5;

export interface BoundarySideEvidenceInput {
  coverage: number;
  trustedTokenIds: readonly string[];
  evidenceIds: readonly string[];
  proposedTime: number | null;
}

export interface PartialBoundaryInput {
  cueId: string;
  startEvidence: BoundarySideEvidenceInput;
  endEvidence: BoundarySideEvidenceInput;
}

function normalizeEvidence(input: BoundarySideEvidenceInput) {
  const coverage = Math.max(0, Math.min(1, input.coverage));
  return {
    coverage,
    trustedTokenIds: [...new Set(input.trustedTokenIds)].toSorted(),
    evidenceIds: [...new Set(input.evidenceIds)].toSorted(),
    proposedTime: input.proposedTime,
    strong:
      coverage >= C6016_BOUNDARY_COVERAGE_MINIMUM &&
      input.proposedTime !== null,
  };
}

function overlap(
  start: number,
  end: number,
  otherStart: number,
  otherEnd: number,
) {
  return Math.max(0, Math.min(end, otherEnd) - Math.max(start, otherStart));
}

function overlapStats(cues: SubtitlePackage["cues"]): {
  pairCount: number;
  seconds: number;
} {
  let pairCount = 0;
  let seconds = 0;
  for (const [index, cue] of cues.entries()) {
    for (const other of cues.slice(index + 1)) {
      const amount = overlap(cue.start, cue.end, other.start, other.end);
      if (amount <= 0) continue;
      pairCount += 1;
      seconds += amount;
    }
  }
  return { pairCount, seconds };
}

export function buildAndApplyPartialBoundaryRefinement(input: {
  mode: C6016Mode;
  package: SubtitlePackage;
  evidence: readonly PartialBoundaryInput[];
  generatedAt?: string;
}): {
  package: SubtitlePackage;
  artifact: MachinePartialBoundaryProposals;
  serialized: { ass: string; srt: string; vtt: string };
} {
  const baseline = subtitlePackageSchema.parse(structuredClone(input.package));
  const cueById = new Map(baseline.cues.map((cue) => [cue.id, cue] as const));
  const sortedCues = [...baseline.cues].toSorted(
    (left, right) =>
      left.start - right.start || left.id.localeCompare(right.id),
  );
  const draft = input.evidence.flatMap((evidence) => {
    const cue = cueById.get(evidence.cueId);
    if (cue === undefined) return [];
    const startEvidence = normalizeEvidence(evidence.startEvidence);
    const endEvidence = normalizeEvidence(evidence.endEvidence);
    const startEligible = startEvidence.strong;
    const endEligible = endEvidence.strong;
    const proposedStart = startEligible
      ? Math.max(
          0,
          (startEvidence.proposedTime ?? cue.start) -
            C6016_BOUNDARY_PADDING_SECONDS,
        )
      : null;
    const proposedEnd = endEligible
      ? (endEvidence.proposedTime ?? cue.end) + C6016_BOUNDARY_PADDING_SECONDS
      : null;
    const nextStart = proposedStart ?? cue.start;
    const nextEnd = proposedEnd ?? cue.end;
    const cueIndex = sortedCues.findIndex((entry) => entry.id === cue.id);
    const previous = cueIndex > 0 ? sortedCues[cueIndex - 1] : undefined;
    const next = cueIndex >= 0 ? sortedCues[cueIndex + 1] : undefined;
    const shiftSafe =
      Math.abs(nextStart - cue.start) <= C6016_BOUNDARY_MAXIMUM_SHIFT_SECONDS &&
      Math.abs(nextEnd - cue.end) <= C6016_BOUNDARY_MAXIMUM_SHIFT_SECONDS;
    const durationSafe = nextEnd - nextStart >= 0.2;
    const previousOverlapNonIncreasing =
      previous === undefined ||
      overlap(nextStart, nextEnd, previous.start, previous.end) <=
        overlap(cue.start, cue.end, previous.start, previous.end) + 0.001;
    const nextOverlapNonIncreasing =
      next === undefined ||
      overlap(nextStart, nextEnd, next.start, next.end) <=
        overlap(cue.start, cue.end, next.start, next.end) + 0.001;
    const changedStart =
      proposedStart !== null && Math.abs(proposedStart - cue.start) >= 0.001;
    const changedEnd =
      proposedEnd !== null && Math.abs(proposedEnd - cue.end) >= 0.001;
    const proposalType =
      changedStart && changedEnd
        ? ("BOTH_BOUNDARIES_REFINE" as const)
        : changedStart
          ? ("START_TIME_REFINE" as const)
          : changedEnd
            ? ("END_TIME_REFINE" as const)
            : ("NONE" as const);
    const nonDegradationPassed =
      shiftSafe &&
      durationSafe &&
      previousOverlapNonIncreasing &&
      nextOverlapNonIncreasing;
    const accepted = proposalType !== "NONE" && nonDegradationPassed;
    const blockers = [
      ...(!startEligible ? ["start-boundary-evidence-insufficient"] : []),
      ...(!endEligible ? ["end-boundary-evidence-insufficient"] : []),
      ...(!shiftSafe ? ["boundary-shift-exceeds-frozen-limit"] : []),
      ...(!durationSafe ? ["minimum-duration-would-fail"] : []),
      ...(!previousOverlapNonIncreasing
        ? ["previous-overlap-would-increase"]
        : []),
      ...(!nextOverlapNonIncreasing ? ["next-overlap-would-increase"] : []),
      ...(proposalType === "NONE" ? ["no-boundary-change"] : []),
    ];
    const core = {
      proposalId: `c6016-partial-boundary:${cue.id}`,
      cueId: cue.id,
      originalStart: cue.start,
      originalEnd: cue.end,
      startEvidence,
      endEvidence,
      startEligible,
      endEligible,
      proposalType,
      proposedStart,
      proposedEnd,
      paddingSeconds: C6016_BOUNDARY_PADDING_SECONDS,
      nonDegradationPassed,
      accepted,
      applied: false,
      blockers,
    };
    return [{ ...core, semanticHash: machineQualitySemanticHash(core) }];
  });
  let current = structuredClone(baseline);
  const appliedIds = new Set<string>();
  const applicationBlockers = new Map<string, string>();
  if (input.mode === "enforce") {
    let tentative = structuredClone(current);
    for (const proposal of draft.filter((entry) => entry.accepted)) {
      const candidate = structuredClone(tentative);
      const cue = candidate.cues.find((entry) => entry.id === proposal.cueId);
      if (cue === undefined) continue;
      if (proposal.proposedStart !== null && proposal.startEligible)
        cue.start = proposal.proposedStart;
      if (proposal.proposedEnd !== null && proposal.endEligible)
        cue.end = proposal.proposedEnd;
      const existing = cue.timingEvidence;
      cue.timingEvidence = {
        sourceTrusted: true,
        speechStart: cue.start,
        speechEnd: cue.end,
        tokenTimestampsAvailable: true,
        tokenTimestampsUsed: true,
        tokens: existing?.tokens ?? [],
        alignmentSource: "token",
        presentationTimingMethod: "token",
        ...(existing?.chunkBoundaryConflict === undefined
          ? {}
          : { chunkBoundaryConflict: existing.chunkBoundaryConflict }),
        speechIntervals: [{ start: cue.start, end: cue.end }],
        speechBoundarySource: existing?.speechBoundarySource ?? "segment",
      };
      const beforeOverlap = overlapStats(tentative.cues);
      const afterOverlap = overlapStats(candidate.cues);
      if (
        afterOverlap.pairCount > beforeOverlap.pairCount ||
        afterOverlap.seconds > beforeOverlap.seconds + 0.001
      ) {
        applicationBlockers.set(
          proposal.proposalId,
          "sequential-overlap-nondegradation-failed",
        );
        continue;
      }
      tentative = candidate;
      appliedIds.add(proposal.proposalId);
    }
    current = subtitlePackageSchema.parse(tentative);
    formatAss(current.cues);
    formatSrt(current.cues);
    formatVtt(current.cues);
  }
  const proposals: PartialBoundaryProposal[] = draft.map((proposal) => {
    const { semanticHash: _oldHash, ...rest } = proposal;
    void _oldHash;
    const applicationBlocker = applicationBlockers.get(proposal.proposalId);
    const core = {
      ...rest,
      applied: appliedIds.has(proposal.proposalId),
      blockers:
        applicationBlocker === undefined
          ? rest.blockers
          : [...rest.blockers, applicationBlocker],
    };
    return { ...core, semanticHash: machineQualitySemanticHash(core) };
  });
  const summary = {
    cueCount: input.evidence.length,
    startOnlyEligibleCount: proposals.filter(
      (proposal) => proposal.proposalType === "START_TIME_REFINE",
    ).length,
    startOnlyAppliedCount: proposals.filter(
      (proposal) =>
        proposal.proposalType === "START_TIME_REFINE" && proposal.applied,
    ).length,
    endOnlyEligibleCount: proposals.filter(
      (proposal) => proposal.proposalType === "END_TIME_REFINE",
    ).length,
    endOnlyAppliedCount: proposals.filter(
      (proposal) =>
        proposal.proposalType === "END_TIME_REFINE" && proposal.applied,
    ).length,
    bothEligibleCount: proposals.filter(
      (proposal) => proposal.proposalType === "BOTH_BOUNDARIES_REFINE",
    ).length,
    bothAppliedCount: proposals.filter(
      (proposal) =>
        proposal.proposalType === "BOTH_BOUNDARIES_REFINE" && proposal.applied,
    ).length,
    proposalCount: proposals.filter((proposal) => proposal.accepted).length,
    appliedCount: proposals.filter((proposal) => proposal.applied).length,
  };
  const core = {
    mode: input.mode,
    coveragePolicy: "independent-start-and-end-evidence" as const,
    proposals,
    summary,
  };
  const artifact = machinePartialBoundaryProposalsSchema.parse({
    schemaVersion: "1.0.0",
    policyVersion: c6016PolicyVersion,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    artifactType: "machine-partial-boundary-proposals",
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
  return {
    package: current,
    artifact,
    serialized: {
      ass: formatAss(current.cues),
      srt: formatSrt(current.cues),
      vtt: formatVtt(current.cues),
    },
  };
}
