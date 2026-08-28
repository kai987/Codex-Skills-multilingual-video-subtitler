import { formatAss, formatSrt, formatVtt } from "@mvl/subtitle-core";
import {
  c6016PolicyVersion,
  machineJointBoundaryRefinementSchema,
  subtitlePackageSchema,
  type C6016Mode,
  type JointBoundaryPair,
  type MachineJointBoundaryRefinement,
  type SubtitlePackage,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";
import {
  C6016_BOUNDARY_COVERAGE_MINIMUM,
  type BoundarySideEvidenceInput,
} from "./partial-boundary-refinement.js";

export interface JointBoundaryInput {
  leftCueId: string;
  rightCueId: string;
  leftEndEvidence: BoundarySideEvidenceInput;
  rightStartEvidence: BoundarySideEvidenceInput;
  vadPause: { start: number; end: number } | null;
  speechContinuous: boolean;
  acousticOverlapSupported: boolean;
  speakerOverlapSupported: boolean;
  accidentalOverlapSupported: boolean;
  rapidTurn: boolean;
  evidenceIds: readonly string[];
}

function sideEvidence(input: BoundarySideEvidenceInput) {
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

function overlapStats(cues: SubtitlePackage["cues"]): {
  pairCount: number;
  seconds: number;
} {
  let pairCount = 0;
  let seconds = 0;
  for (const [index, cue] of cues.entries()) {
    for (const other of cues.slice(index + 1)) {
      const amount = Math.max(
        0,
        Math.min(cue.end, other.end) - Math.max(cue.start, other.start),
      );
      if (amount <= 0) continue;
      pairCount += 1;
      seconds += amount;
    }
  }
  return { pairCount, seconds };
}

export function buildAndApplyJointBoundaryRefinement(input: {
  mode: C6016Mode;
  package: SubtitlePackage;
  pairs: readonly JointBoundaryInput[];
  generatedAt?: string;
}): {
  package: SubtitlePackage;
  artifact: MachineJointBoundaryRefinement;
  serialized: { ass: string; srt: string; vtt: string };
} {
  const baseline = subtitlePackageSchema.parse(structuredClone(input.package));
  const cueById = new Map(baseline.cues.map((cue) => [cue.id, cue] as const));
  const draft = input.pairs.flatMap((pair) => {
    const left = cueById.get(pair.leftCueId);
    const right = cueById.get(pair.rightCueId);
    if (left === undefined || right === undefined) return [];
    const leftEvidence = sideEvidence(pair.leftEndEvidence);
    const rightEvidence = sideEvidence(pair.rightStartEvidence);
    const originalOverlap = Math.max(0, left.end - right.start);
    const realOverlap =
      originalOverlap > 0 &&
      (pair.acousticOverlapSupported || pair.speakerOverlapSupported);
    const overlapClass = realOverlap
      ? ("REAL_OVERLAP" as const)
      : originalOverlap > 0
        ? pair.accidentalOverlapSupported
          ? ("ACCIDENTAL_OVERLAP" as const)
          : ("AMBIGUOUS" as const)
        : pair.rapidTurn
          ? ("RAPID_TURN" as const)
          : pair.speechContinuous
            ? ("AMBIGUOUS" as const)
            : ("NO_OVERLAP" as const);
    let proposedBoundary: number | null = null;
    let proposedLeftEnd: number | null = null;
    let proposedRightStart: number | null = null;
    let outcome: JointBoundaryPair["outcome"] = "KEEP_BOTH";
    const blockers: string[] = [];
    if (realOverlap) {
      outcome = "PRESERVE_OVERLAP";
      blockers.push("evidence-supported-real-overlap-preserved");
    } else if (
      overlapClass === "ACCIDENTAL_OVERLAP" ||
      overlapClass === "RAPID_TURN"
    ) {
      const leftTime = leftEvidence.strong ? leftEvidence.proposedTime : null;
      const rightTime = rightEvidence.strong
        ? rightEvidence.proposedTime
        : null;
      if (leftTime !== null && rightTime !== null && leftTime <= rightTime) {
        proposedBoundary = (leftTime + rightTime) / 2;
        proposedLeftEnd = proposedBoundary;
        proposedRightStart = proposedBoundary;
        outcome = "MOVE_BOTH";
      } else if (pair.vadPause !== null) {
        proposedBoundary = (pair.vadPause.start + pair.vadPause.end) / 2;
        proposedLeftEnd = proposedBoundary;
        proposedRightStart = proposedBoundary;
        outcome = "MOVE_BOTH";
      } else if (leftTime !== null && leftTime <= right.start) {
        proposedLeftEnd = leftTime;
        outcome = "MOVE_A_END";
      } else if (rightTime !== null && rightTime >= left.end) {
        proposedRightStart = rightTime;
        outcome = "MOVE_B_START";
      } else if (leftTime !== null && rightTime !== null) {
        outcome = "AMBIGUOUS";
        blockers.push("trusted-boundary-evidence-conflicts");
      } else {
        outcome = "REVIEW";
        blockers.push("joint-boundary-evidence-insufficient");
      }
    } else if (overlapClass === "AMBIGUOUS") {
      outcome = "AMBIGUOUS";
      blockers.push("overlap-type-not-proven-by-localized-evidence");
    }
    const nextLeftEnd = proposedLeftEnd ?? left.end;
    const nextRightStart = proposedRightStart ?? right.start;
    const validIntervals =
      nextLeftEnd > left.start && right.end > nextRightStart;
    const resolvesAccidental =
      overlapClass !== "ACCIDENTAL_OVERLAP" || nextLeftEnd <= nextRightStart;
    const proposedOverlap = Math.max(0, nextLeftEnd - nextRightStart);
    const overlapNonIncrease =
      realOverlap || proposedOverlap <= originalOverlap;
    const accepted =
      ["MOVE_A_END", "MOVE_B_START", "MOVE_BOTH"].includes(outcome) &&
      validIntervals &&
      resolvesAccidental &&
      overlapNonIncrease;
    if (!validIntervals) blockers.push("minimum-valid-interval-would-fail");
    if (!resolvesAccidental)
      blockers.push("accidental-overlap-would-remain-or-increase");
    if (!overlapNonIncrease) blockers.push("adjacent-overlap-would-increase");
    const core = {
      pairId: `c6016-joint:${left.id}:${right.id}`,
      leftCueId: left.id,
      rightCueId: right.id,
      originalLeftEnd: left.end,
      originalRightStart: right.start,
      leftEvidence,
      rightEvidence,
      speechEvidence: [
        ...new Set([
          ...pair.evidenceIds,
          ...(pair.speechContinuous ? ["speech-continuous"] : []),
          ...(pair.vadPause === null ? [] : ["vad-pause"]),
        ]),
      ].toSorted(),
      speakerEvidence: [
        ...(pair.speakerOverlapSupported ? ["speaker-overlap-supported"] : []),
      ],
      overlapClass,
      proposedBoundary,
      proposedLeftEnd,
      proposedRightStart,
      outcome,
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
    for (const pair of draft.filter((entry) => entry.accepted)) {
      const candidate = structuredClone(tentative);
      const left = candidate.cues.find((cue) => cue.id === pair.leftCueId);
      const right = candidate.cues.find((cue) => cue.id === pair.rightCueId);
      if (left === undefined || right === undefined) continue;
      if (pair.proposedLeftEnd !== null) left.end = pair.proposedLeftEnd;
      if (pair.proposedRightStart !== null)
        right.start = pair.proposedRightStart;
      const beforeOverlap = overlapStats(tentative.cues);
      const afterOverlap = overlapStats(candidate.cues);
      if (
        afterOverlap.pairCount > beforeOverlap.pairCount ||
        afterOverlap.seconds > beforeOverlap.seconds + 0.001
      ) {
        applicationBlockers.set(
          pair.pairId,
          "sequential-overlap-nondegradation-failed",
        );
        continue;
      }
      tentative = candidate;
      appliedIds.add(pair.pairId);
    }
    current = subtitlePackageSchema.parse(tentative);
    formatAss(current.cues);
    formatSrt(current.cues);
    formatVtt(current.cues);
  }
  const pairs: JointBoundaryPair[] = draft.map((pair) => {
    const { semanticHash: _oldHash, ...rest } = pair;
    void _oldHash;
    const applicationBlocker = applicationBlockers.get(pair.pairId);
    const core = {
      ...rest,
      applied: appliedIds.has(pair.pairId),
      blockers:
        applicationBlocker === undefined
          ? rest.blockers
          : [...rest.blockers, applicationBlocker],
    };
    return { ...core, semanticHash: machineQualitySemanticHash(core) };
  });
  const summary = {
    pairCount: pairs.length,
    proposalCount: pairs.filter((pair) => pair.accepted).length,
    appliedCount: pairs.filter((pair) => pair.applied).length,
    realOverlapPreservedCount: pairs.filter(
      (pair) => pair.outcome === "PRESERVE_OVERLAP",
    ).length,
    accidentalOverlapResolvedCount: pairs.filter(
      (pair) => pair.overlapClass === "ACCIDENTAL_OVERLAP" && pair.applied,
    ).length,
    ambiguousCount: pairs.filter((pair) => pair.outcome === "AMBIGUOUS").length,
    reviewCount: pairs.filter((pair) => pair.outcome === "REVIEW").length,
  };
  const core = {
    mode: input.mode,
    overlapPolicy: "preserve-evidence-supported-real-overlap" as const,
    pairs,
    summary,
  };
  const artifact = machineJointBoundaryRefinementSchema.parse({
    schemaVersion: "1.0.0",
    policyVersion: c6016PolicyVersion,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    artifactType: "machine-joint-boundary-refinement",
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
