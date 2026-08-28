import { formatAss, formatSrt, formatVtt } from "@mvl/subtitle-core";
import {
  c6015PolicyVersion,
  machineCanonicalMutationLedgerSchema,
  subtitlePackageSchema,
  type C6015Mode,
  type MachineCanonicalMutationLedger,
  type MachineCanonicalMutationProposals,
  type MachineEventToFinalCueLineage,
  type SubtitlePackage,
} from "@mvl/shared";

import {
  machineQualitySemanticHash,
  normalizeCandidateText,
} from "./evidence-correlation.js";

interface RenderedSubtitles {
  srt: string;
  vtt: string;
  ass: string;
}

function render(value: SubtitlePackage): RenderedSubtitles {
  return {
    srt: formatSrt(value.cues),
    vtt: formatVtt(value.cues),
    ass: formatAss(value.cues),
  };
}

function hashes(value: SubtitlePackage, serialized: RenderedSubtitles) {
  return {
    canonical: machineQualitySemanticHash(
      value.cues.map((cue) => [cue.id, cue.text, cue.start, cue.end]),
    ),
    text: machineQualitySemanticHash(
      value.cues.map((cue) => [cue.id, normalizeCandidateText(cue.text)]),
    ),
    timing: machineQualitySemanticHash(
      value.cues.map((cue) => [cue.id, cue.start, cue.end]),
    ),
    package: machineQualitySemanticHash(value),
    srt: machineQualitySemanticHash(serialized.srt),
    vtt: machineQualitySemanticHash(serialized.vtt),
    ass: machineQualitySemanticHash(serialized.ass),
    presentation: machineQualitySemanticHash({
      srt: serialized.srt,
      vtt: serialized.vtt,
      ass: serialized.ass,
    }),
  };
}

function clonePackage(value: SubtitlePackage): SubtitlePackage {
  return structuredClone(value);
}

export function applyCanonicalMutations(input: {
  mode: C6015Mode;
  textMode?: C6015Mode;
  timingMode?: C6015Mode;
  package: SubtitlePackage;
  proposals: MachineCanonicalMutationProposals;
  lineage: MachineEventToFinalCueLineage;
  generatedAt?: string;
}): {
  package: SubtitlePackage;
  serialized: RenderedSubtitles;
  ledger: MachineCanonicalMutationLedger;
} {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  let current = subtitlePackageSchema.parse(clonePackage(input.package));
  const baselineSerialized = render(current);
  const baselineHashes = hashes(current, baselineSerialized);
  const lineageByEvent = new Map(
    input.lineage.events.map((event) => [event.eventId, event] as const),
  );
  const records: MachineCanonicalMutationLedger["records"] = [];
  for (const proposal of input.proposals.proposals) {
    const beforePackage = clonePackage(current);
    const beforeSerialized = render(beforePackage);
    const beforeHashes = hashes(beforePackage, beforeSerialized);
    const lineage = lineageByEvent.get(proposal.eventId);
    const isTextProposal = [
      "TEXT_VARIANT_REPLACE",
      "REASR_TEXT_REPLACE",
    ].includes(proposal.proposalType);
    const isTimingProposal =
      proposal.proposalType.includes("TIME") ||
      proposal.proposalType.includes("BOUNDARIES");
    const proposalMode = isTextProposal
      ? (input.textMode ?? input.mode)
      : isTimingProposal
        ? (input.timingMode ?? input.mode)
        : input.mode;
    const enforce = proposalMode === "enforce";
    const eligible =
      proposal.applyStatus === "ACCEPTED" &&
      proposal.lineageVerified &&
      proposal.nonDegradationPassed &&
      proposal.safetyPassed &&
      lineage !== undefined &&
      proposal.finalCueIds.every((cueId) =>
        lineage.finalCueIds.includes(cueId),
      );
    const reasons = [
      ...proposal.rejectionReasons,
      ...(!enforce
        ? [`${proposalMode}-mode-does-not-apply-${proposal.proposalType}`]
        : []),
      ...(!proposal.lineageVerified ? ["lineage-validation-failed"] : []),
      ...(!proposal.nonDegradationPassed ? ["non-degradation-failed"] : []),
      ...(!proposal.safetyPassed ? ["safety-policy-failed"] : []),
    ];
    let applyStatus: MachineCanonicalMutationLedger["records"][number]["applyStatus"] =
      proposal.applyStatus === "NO_OP" ? "NO_OP" : "REJECTED";
    let strictPackageValidationPassed = true;
    if (enforce && eligible) {
      const tentative = clonePackage(current);
      for (const cueId of proposal.finalCueIds) {
        const cue = tentative.cues.find((entry) => entry.id === cueId);
        if (cue === undefined) continue;
        if (
          ["TEXT_VARIANT_REPLACE", "REASR_TEXT_REPLACE"].includes(
            proposal.proposalType,
          )
        ) {
          const existingAudit = cue.textAudit;
          const beforeText = cue.text;
          cue.text = proposal.afterText;
          cue.textAudit = {
            // Preserve the pre-mutation machine transcript as the audit
            // origin; using cue.text after assignment would erase provenance.
            rawAsrText: existingAudit?.rawAsrText ?? beforeText,
            repairedText: proposal.afterText,
            normalizedText: proposal.afterText,
            winnerClusterIds: existingAudit?.winnerClusterIds ?? [],
            sourceWinnerCueIds:
              proposal.toVariantId === null
                ? (existingAudit?.sourceWinnerCueIds ?? [])
                : [proposal.toVariantId],
            ...(existingAudit?.winnerScore === undefined
              ? {}
              : { winnerScore: existingAudit.winnerScore }),
            ...(existingAudit?.runnerUpCueId === undefined
              ? {}
              : { runnerUpCueId: existingAudit.runnerUpCueId }),
            ...(existingAudit?.runnerUpScore === undefined
              ? {}
              : { runnerUpScore: existingAudit.runnerUpScore }),
            ...(existingAudit?.scoreGap === undefined
              ? {}
              : { scoreGap: existingAudit.scoreGap }),
            replacements: existingAudit?.replacements ?? [],
            deduplicationActions: existingAudit?.deduplicationActions ?? [],
            ...(existingAudit?.repairType === undefined
              ? {}
              : { repairType: existingAudit.repairType }),
            ...(existingAudit?.timingDonorCueId === undefined
              ? {}
              : { timingDonorCueId: existingAudit.timingDonorCueId }),
            ...(existingAudit?.timingRepairMethod === undefined
              ? {}
              : { timingRepairMethod: existingAudit.timingRepairMethod }),
            reviewRecommended: true,
            reviewReasons: [
              ...new Set([
                ...(existingAudit?.reviewReasons ?? []),
                "C6_0_1_5_MACHINE_EVIDENCE_MUTATION_APPLIED",
              ]),
            ],
          };
        }
        if (
          [
            "START_TIME_REFINE",
            "END_TIME_REFINE",
            "BOTH_BOUNDARIES_REFINE",
          ].includes(proposal.proposalType)
        ) {
          const interval = proposal.afterTiming[0];
          if (interval !== undefined) {
            const existingTiming = cue.timingEvidence;
            cue.start = interval.start;
            cue.end = interval.end;
            cue.timingEvidence = {
              sourceTrusted: true,
              speechStart: interval.start,
              speechEnd: interval.end,
              tokenTimestampsAvailable: true,
              tokenTimestampsUsed: true,
              tokens: existingTiming?.tokens ?? [],
              alignmentSource: "token",
              presentationTimingMethod: "token",
              ...(existingTiming?.chunkBoundaryConflict === undefined
                ? {}
                : {
                    chunkBoundaryConflict: existingTiming.chunkBoundaryConflict,
                  }),
              speechIntervals: [{ start: interval.start, end: interval.end }],
              speechBoundarySource:
                existingTiming?.speechBoundarySource ?? "segment",
            };
          }
        }
      }
      try {
        current = subtitlePackageSchema.parse(tentative);
        render(current);
        applyStatus = "APPLIED";
        reasons.push("strict-package-and-three-format-render-passed");
      } catch {
        current = beforePackage;
        strictPackageValidationPassed = false;
        applyStatus = "ROLLED_BACK";
        reasons.push("strict-package-or-render-validation-failed-rolled-back");
      }
    }
    if (reasons.length === 0)
      reasons.push("proposal-not-eligible-for-application");
    const afterSerialized = render(current);
    const afterHashes = hashes(current, afterSerialized);
    const core = {
      proposalId: proposal.proposalId,
      eventId: proposal.eventId,
      finalCueIds: proposal.finalCueIds,
      applyStatus,
      reasons,
      canonicalHashBefore: beforeHashes.canonical,
      canonicalHashAfter: afterHashes.canonical,
      packageHashBefore: beforeHashes.package,
      packageHashAfter: afterHashes.package,
      renderedSrtHashBefore: beforeHashes.srt,
      renderedSrtHashAfter: afterHashes.srt,
      renderedVttHashBefore: beforeHashes.vtt,
      renderedVttHashAfter: afterHashes.vtt,
      renderedAssHashBefore: beforeHashes.ass,
      renderedAssHashAfter: afterHashes.ass,
      lineageStillValid: proposal.finalCueIds.every(
        (cueId) => lineage?.finalCueIds.includes(cueId) === true,
      ),
      strictPackageValidationPassed,
      renderedOutputChanged:
        beforeHashes.srt !== afterHashes.srt ||
        beforeHashes.vtt !== afterHashes.vtt ||
        beforeHashes.ass !== afterHashes.ass,
    };
    records.push({ ...core, semanticHash: machineQualitySemanticHash(core) });
  }
  const serialized = render(current);
  const final = hashes(current, serialized);
  const applied = records.filter((record) => record.applyStatus === "APPLIED");
  const textProposalIds = new Set(
    input.proposals.proposals
      .filter((proposal) =>
        ["TEXT_VARIANT_REPLACE", "REASR_TEXT_REPLACE"].includes(
          proposal.proposalType,
        ),
      )
      .map((proposal) => proposal.proposalId),
  );
  const timingProposalIds = new Set(
    input.proposals.proposals
      .filter(
        (proposal) =>
          proposal.proposalType.includes("TIME") ||
          proposal.proposalType.includes("BOUNDARIES"),
      )
      .map((proposal) => proposal.proposalId),
  );
  const summary = {
    proposedCount: records.length,
    acceptedCount: input.proposals.summary.acceptedCount,
    rejectedCount: records.filter((record) => record.applyStatus === "REJECTED")
      .length,
    appliedCount: applied.length,
    rolledBackCount: records.filter(
      (record) => record.applyStatus === "ROLLED_BACK",
    ).length,
    textMutationAppliedCount: applied.filter((record) =>
      textProposalIds.has(record.proposalId),
    ).length,
    timingMutationAppliedCount: applied.filter((record) =>
      timingProposalIds.has(record.proposalId),
    ).length,
    textChangedFinalCueCount: new Set(
      applied
        .filter((record) => textProposalIds.has(record.proposalId))
        .flatMap((record) => record.finalCueIds),
    ).size,
    timingChangedFinalCueCount: new Set(
      applied
        .filter((record) => timingProposalIds.has(record.proposalId))
        .flatMap((record) => record.finalCueIds),
    ).size,
    unsupportedMutationCount: 0 as const,
    finalArtifactMutationCount: applied.filter(
      (record) => record.renderedOutputChanged,
    ).length,
  };
  const finalHashes = {
    canonicalTextHash: final.text,
    canonicalTimingHash: final.timing,
    packageHash: final.package,
    srtHash: final.srt,
    vttHash: final.vtt,
    assHash: final.ass,
    presentationHash: final.presentation,
  };
  const noOpReason =
    summary.appliedCount > 0
      ? []
      : [
          ...(input.mode !== "enforce" ||
          (input.textMode ?? input.mode) !== "enforce" ||
          (input.timingMode ?? input.mode) !== "enforce"
            ? ["mode-does-not-authorize-application"]
            : []),
          ...(input.proposals.summary.acceptedCount === 0
            ? ["no-proposal-passed-lineage-evidence-and-non-degradation-gates"]
            : []),
          ...(input.proposals.summary.rejectedCount > 0
            ? [
                `rejected-proposal-count:${input.proposals.summary.rejectedCount}`,
              ]
            : []),
        ];
  const core = {
    mode: input.mode,
    records,
    summary,
    finalHashes,
    noOpReason,
  };
  const ledger = machineCanonicalMutationLedgerSchema.parse({
    schemaVersion: "1.0.0",
    policyVersion: c6015PolicyVersion,
    generatedAt,
    artifactType: "machine-canonical-mutation-ledger",
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
  if (summary.appliedCount > 0 && final.package === baselineHashes.package) {
    throw new Error("Applied mutation did not change the strict package hash.");
  }
  return { package: current, serialized, ledger };
}
