import { formatAss, formatSrt, formatVtt } from "@mvl/subtitle-core";
import {
  c6016PolicyVersion,
  machineSpanTextRepairSchema,
  subtitlePackageSchema,
  type C6016Mode,
  type MachineEventFinalTextSpanLineage,
  type MachineSpanTextRepair,
  type SpanTextRepairProposal,
  type SubtitlePackage,
} from "@mvl/shared";

import {
  machineQualitySemanticHash,
  normalizeCandidateText,
} from "./evidence-correlation.js";

export interface SpanRepairSelectionInput {
  eventId: string;
  replacementCandidateId: string;
  replacementText: string;
  replacementEventId: string;
  evidenceIds: readonly string[];
  evidenceStronger: boolean;
  hallucinationNonIncreasePassed: boolean;
  timingCompatible: boolean;
  crossSpeakerJoinSafe: boolean;
}

function punctuationBoundarySafe(input: {
  fullText: string;
  start: number;
  end: number;
  before: string;
  after: string;
}): boolean {
  const full = Array.from(input.fullText);
  const after = Array.from(input.after);
  const left = input.start > 0 ? full[input.start - 1] : undefined;
  const right = input.end < full.length ? full[input.end] : undefined;
  const first = after[0];
  const last = after.at(-1);
  const punctuation = /^[\p{P}\p{S}]$/u;
  if (
    left !== undefined &&
    first !== undefined &&
    punctuation.test(left) &&
    punctuation.test(first)
  )
    return false;
  if (
    right !== undefined &&
    last !== undefined &&
    punctuation.test(right) &&
    punctuation.test(last)
  )
    return false;
  const beforeStartsPunctuation = punctuation.test(
    Array.from(input.before)[0] ?? "",
  );
  const beforeEndsPunctuation = punctuation.test(
    Array.from(input.before).at(-1) ?? "",
  );
  const afterStartsPunctuation = punctuation.test(first ?? "");
  const afterEndsPunctuation = punctuation.test(last ?? "");
  return (
    beforeStartsPunctuation === afterStartsPunctuation &&
    beforeEndsPunctuation === afterEndsPunctuation
  );
}

function overlapsAnotherEvent(
  eventId: string,
  cueId: string,
  start: number,
  end: number,
  lineage: MachineEventFinalTextSpanLineage,
): boolean {
  return lineage.events.some(
    (event) =>
      event.eventId !== eventId &&
      event.finalCueId === cueId &&
      event.spanStart !== null &&
      event.spanEnd !== null &&
      Math.min(end, event.spanEnd) > Math.max(start, event.spanStart),
  );
}

export function buildAndApplySpanTextRepair(input: {
  mode: C6016Mode;
  package: SubtitlePackage;
  lineage: MachineEventFinalTextSpanLineage;
  selections: readonly SpanRepairSelectionInput[];
  generatedAt?: string;
}): {
  package: SubtitlePackage;
  artifact: MachineSpanTextRepair;
  serialized: { ass: string; srt: string; vtt: string };
} {
  const baseline = subtitlePackageSchema.parse(structuredClone(input.package));
  const cueById = new Map(baseline.cues.map((cue) => [cue.id, cue] as const));
  const lineageByEvent = new Map(
    input.lineage.events.map((event) => [event.eventId, event] as const),
  );
  const draftProposals = input.selections.map((selection) => {
    const lineage = lineageByEvent.get(selection.eventId);
    const cue =
      lineage?.finalCueId === null || lineage?.finalCueId === undefined
        ? undefined
        : cueById.get(lineage.finalCueId);
    const start = lineage?.spanStart ?? 0;
    const end = lineage?.spanEnd ?? 0;
    const beforeSpanText =
      cue === undefined ? "" : Array.from(cue.text).slice(start, end).join("");
    const lineageVerified =
      lineage?.modifiable === true &&
      lineage.spanStart !== null &&
      lineage.spanEnd !== null &&
      lineage.spanText === beforeSpanText;
    const sameEventVerified =
      selection.replacementEventId === selection.eventId;
    const neighboringSpanSafe =
      cue !== undefined &&
      !overlapsAnotherEvent(
        selection.eventId,
        cue.id,
        start,
        end,
        input.lineage,
      );
    const punctuationSafe =
      cue !== undefined &&
      punctuationBoundarySafe({
        fullText: cue.text,
        start,
        end,
        before: beforeSpanText,
        after: selection.replacementText,
      });
    const textNonDegradationPassed =
      normalizeCandidateText(beforeSpanText) !==
        normalizeCandidateText(selection.replacementText) &&
      selection.hallucinationNonIncreasePassed;
    const accepted =
      cue !== undefined &&
      lineageVerified &&
      sameEventVerified &&
      neighboringSpanSafe &&
      punctuationSafe &&
      selection.crossSpeakerJoinSafe &&
      selection.hallucinationNonIncreasePassed &&
      selection.evidenceStronger &&
      textNonDegradationPassed &&
      selection.timingCompatible;
    const rejectReasons = [
      ...(cue === undefined ? ["final-cue-unavailable"] : []),
      ...(!lineageVerified ? ["span-lineage-not-verified"] : []),
      ...(!sameEventVerified ? ["replacement-candidate-event-mismatch"] : []),
      ...(!neighboringSpanSafe ? ["neighboring-event-span-overlap"] : []),
      ...(!punctuationSafe ? ["punctuation-boundary-unsafe"] : []),
      ...(!selection.crossSpeakerJoinSafe ? ["cross-speaker-join-risk"] : []),
      ...(!selection.hallucinationNonIncreasePassed
        ? ["hallucination-risk-would-increase"]
        : []),
      ...(!selection.evidenceStronger
        ? ["replacement-evidence-not-stronger"]
        : []),
      ...(!textNonDegradationPassed ? ["text-non-degradation-failed"] : []),
      ...(!selection.timingCompatible ? ["timing-incompatible"] : []),
    ];
    const core = {
      proposalId: `c6016-span:${selection.eventId}:${selection.replacementCandidateId}`,
      eventId: selection.eventId,
      finalCueId: cue?.id ?? lineage?.finalCueId ?? "unresolved-final-cue",
      spanStart: start,
      spanEnd: end,
      beforeSpanText: beforeSpanText === "" ? "<unresolved>" : beforeSpanText,
      afterSpanText: selection.replacementText,
      replacementCandidateId: selection.replacementCandidateId,
      evidenceIds:
        selection.evidenceIds.length > 0
          ? [...new Set(selection.evidenceIds)].toSorted()
          : [`candidate:${selection.replacementCandidateId}`],
      lineageVerified,
      sameEventVerified,
      neighboringSpanSafe,
      punctuationBoundarySafe: punctuationSafe,
      crossSpeakerJoinSafe: selection.crossSpeakerJoinSafe,
      hallucinationNonIncreasePassed: selection.hallucinationNonIncreasePassed,
      evidenceStronger: selection.evidenceStronger,
      textNonDegradationPassed,
      timingCompatible: selection.timingCompatible,
      accepted,
      applied: false,
      changedSpanCount: accepted ? 1 : 0,
      replacementChars: accepted
        ? Array.from(selection.replacementText).length
        : 0,
      rejectReasons,
    };
    return { ...core, semanticHash: machineQualitySemanticHash(core) };
  });
  let current = structuredClone(baseline);
  const appliedIds = new Set<string>();
  if (input.mode === "enforce") {
    const accepted = draftProposals
      .filter((proposal) => proposal.accepted)
      .toSorted(
        (left, right) =>
          left.finalCueId.localeCompare(right.finalCueId) ||
          right.spanStart - left.spanStart,
      );
    const tentative = structuredClone(current);
    for (const proposal of accepted) {
      const cue = tentative.cues.find(
        (entry) => entry.id === proposal.finalCueId,
      );
      if (cue === undefined) continue;
      const characters = Array.from(cue.text);
      cue.text = [
        ...characters.slice(0, proposal.spanStart),
        ...Array.from(proposal.afterSpanText),
        ...characters.slice(proposal.spanEnd),
      ].join("");
      if (cue.textAudit === undefined) {
        cue.textAudit = {
          rawAsrText:
            baseline.cues.find((entry) => entry.id === cue.id)?.text ??
            cue.text,
          repairedText: cue.text,
          normalizedText: cue.text,
          winnerClusterIds: [],
          sourceWinnerCueIds: [proposal.replacementCandidateId],
          replacements: [],
          deduplicationActions: [],
          reviewRecommended: true,
          reviewReasons: ["C6_0_1_6_SPAN_TEXT_REPAIR_APPLIED"],
        };
      } else {
        cue.textAudit.repairedText = cue.text;
        cue.textAudit.normalizedText = cue.text;
        cue.textAudit.reviewRecommended = true;
        cue.textAudit.reviewReasons = [
          ...new Set([
            ...cue.textAudit.reviewReasons,
            "C6_0_1_6_SPAN_TEXT_REPAIR_APPLIED",
          ]),
        ];
        cue.textAudit.sourceWinnerCueIds = [
          ...new Set([
            ...cue.textAudit.sourceWinnerCueIds,
            proposal.replacementCandidateId,
          ]),
        ];
      }
      appliedIds.add(proposal.proposalId);
    }
    current = subtitlePackageSchema.parse(tentative);
    formatAss(current.cues);
    formatSrt(current.cues);
    formatVtt(current.cues);
  }
  const proposals: SpanTextRepairProposal[] = draftProposals.map((proposal) => {
    const core = { ...proposal, applied: appliedIds.has(proposal.proposalId) };
    const { semanticHash: _oldHash, ...hashable } = core;
    return { ...hashable, semanticHash: machineQualitySemanticHash(hashable) };
  });
  const summary = {
    proposalCount: proposals.length,
    acceptedCount: proposals.filter((proposal) => proposal.accepted).length,
    rejectedCount: proposals.filter((proposal) => !proposal.accepted).length,
    appliedCount: proposals.filter((proposal) => proposal.applied).length,
    changedFinalCueCount: new Set(
      proposals
        .filter((proposal) => proposal.applied)
        .map((proposal) => proposal.finalCueId),
    ).size,
    changedSpanCount: proposals.reduce(
      (sum, proposal) =>
        sum + (proposal.applied ? proposal.changedSpanCount : 0),
      0,
    ),
    replacementChars: proposals.reduce(
      (sum, proposal) =>
        sum + (proposal.applied ? proposal.replacementChars : 0),
      0,
    ),
  };
  const core = {
    mode: input.mode,
    mutationPolicy: "event-span-only-independent-text-and-timing" as const,
    proposals,
    summary,
  };
  const artifact = machineSpanTextRepairSchema.parse({
    schemaVersion: "1.0.0",
    policyVersion: c6016PolicyVersion,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    artifactType: "machine-span-text-repair",
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
