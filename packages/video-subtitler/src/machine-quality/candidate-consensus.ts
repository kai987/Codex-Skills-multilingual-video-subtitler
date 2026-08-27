import {
  c6012PolicyVersion,
  machineCrossWindowConsensusSchema,
  type CandidateConsensusMode,
  type MachineAcousticEventFamilies,
  type MachineCrossWindowConsensus,
  type SubtitleCue,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";

export function applyCrossWindowConsensus(input: {
  cues: readonly SubtitleCue[];
  families: MachineAcousticEventFamilies;
  mode: CandidateConsensusMode;
  generatedAt?: string;
}): { artifact: MachineCrossWindowConsensus; cues: SubtitleCue[] } {
  const byId = new Map(input.cues.map((cue) => [cue.id, cue] as const));
  const decisions = input.families.families.map((family) => {
    const stable = family.status === "stable";
    const mutationAllowed =
      input.mode === "enforce" &&
      stable &&
      family.speakerHypotheses.length <= 1 &&
      family.candidateIds.length > 1;
    const candidateRankings = family.candidateIds
      .map((candidateId) => {
        const cue = byId.get(candidateId);
        return {
          candidateId,
          evidenceStrength:
            cue === undefined
              ? 0
              : Math.min(
                  1,
                  (cue.provenance?.qualityScore ?? cue.confidence ?? 0.5) +
                    Math.min(
                      0.2,
                      (cue.provenance?.independentSupportCount ?? 0) * 0.05,
                    ),
                ),
        };
      })
      .toSorted(
        (left, right) =>
          right.evidenceStrength - left.evidenceStrength ||
          left.candidateId.localeCompare(right.candidateId),
      )
      .map((ranking, index) => ({ ...ranking, rank: index + 1 }));
    const decisionPayload = {
      familyId: family.familyId,
      candidateIds: family.candidateIds,
      selectedCueId: stable ? family.representativeCueId : null,
      independentSupportCount: family.independentEvidenceGroupIds.length,
      correlatedSupportCount: family.correlationGroupIds.length,
      stable,
      mutationAllowed,
      candidateRankings,
      evidenceGroups: family.independentEvidenceGroupIds,
      correlatedEvidence: family.correlationGroupIds,
      alternativeCandidateIds: family.candidateIds.filter(
        (candidateId) => candidateId !== family.representativeCueId,
      ),
      decision:
        family.speakerHypotheses.length > 1
          ? ("MULTI_SPEAKER_EVENT" as const)
          : stable
            ? ("CONSENSUS_ACCEPT" as const)
            : ("CONSENSUS_AMBIGUOUS" as const),
      confidenceClass:
        stable && family.independentEvidenceGroupIds.length >= 2
          ? ("high" as const)
          : stable
            ? ("medium" as const)
            : ("low" as const),
      reasons: stable
        ? [
            "acoustic-event-family-stable",
            mutationAllowed
              ? "correlated-window-duplicates-collapsed"
              : "diagnostic-only",
          ]
        : ["family-ambiguous", "all-candidates-preserved"],
    };
    return {
      ...decisionPayload,
      semanticHash: machineQualitySemanticHash(decisionPayload),
    };
  });
  const selectedIds = new Set(
    decisions.flatMap((decision) =>
      decision.mutationAllowed && decision.selectedCueId !== null
        ? [decision.selectedCueId]
        : decision.candidateIds,
    ),
  );
  const consolidated = input.cues.flatMap((cue) => {
    if (!selectedIds.has(cue.id)) return [];
    const decision = decisions.find(
      (candidate) => candidate.selectedCueId === cue.id,
    );
    if (!decision?.mutationAllowed) return [cue];
    const members = decision.candidateIds.flatMap((candidateId) => {
      const candidate = byId.get(candidateId);
      return candidate === undefined ? [] : [candidate];
    });
    return [
      {
        ...cue,
        provenance: {
          ...(cue.provenance ?? {
            sourceLayer: "baseline-vad" as const,
            referenceAnchorIds: [],
            referenceUnitIds: [],
            recoveryUnitId: null,
            sceneId: null,
            sceneLabel: null,
            qualityScore: cue.confidence,
          }),
          sourceRequestIds: [
            ...new Set(
              members.flatMap(
                (member) => member.provenance?.sourceRequestIds ?? [],
              ),
            ),
          ].toSorted(),
          sourceProfileIds: [
            ...new Set(
              members.flatMap(
                (member) => member.provenance?.sourceProfileIds ?? [],
              ),
            ),
          ].toSorted(),
          independentSupportCount: decision.independentSupportCount,
        },
      },
    ];
  });
  const semanticHash = machineQualitySemanticHash(decisions);
  const artifact = machineCrossWindowConsensusSchema.parse({
    schemaVersion: "1.0.0",
    policyVersion: c6012PolicyVersion,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    artifactType: "machine-cross-window-consensus",
    mode: input.mode,
    familySemanticHash: input.families.outputSemanticHash,
    outputSemanticHash: machineQualitySemanticHash(consolidated),
    decisions,
    summary: {
      decisionCount: decisions.length,
      stableDecisionCount: decisions.filter((decision) => decision.stable)
        .length,
      mutationAllowedCount: decisions.filter(
        (decision) => decision.mutationAllowed,
      ).length,
      emittedCandidateCount: consolidated.length,
      diagnosticOnly: input.mode !== "enforce",
    },
    semanticHash,
  });
  return { artifact, cues: consolidated };
}
