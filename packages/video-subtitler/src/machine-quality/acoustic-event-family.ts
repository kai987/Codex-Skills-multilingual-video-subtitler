import {
  c6012PolicyVersion,
  machineAcousticEventFamiliesSchema,
  type CandidateConsensusMode,
  type MachineAcousticEventFamilies,
  type SubtitleCue,
} from "@mvl/shared";

import {
  candidateCorrelationGroupIds,
  candidateIndependentEvidenceGroupIds,
  candidateTextSimilarity,
  candidatesShareAcousticEvent,
  intervalIou,
  machineQualitySemanticHash,
  normalizeCandidateText,
} from "./evidence-correlation.js";

interface MutableFamily {
  cues: SubtitleCue[];
}

function cueRank(cue: SubtitleCue): number {
  return (
    (cue.provenance?.qualityScore ?? cue.confidence ?? 0.5) +
    Math.min(0.25, (cue.provenance?.independentSupportCount ?? 0) * 0.05) +
    (cue.timingEvidence?.sourceTrusted === true ? 0.1 : 0)
  );
}

export function buildAcousticEventFamilies(input: {
  cues: readonly SubtitleCue[];
  mode: CandidateConsensusMode;
  sourceMediaSha256?: string | null;
  generatedAt?: string;
}): {
  artifact: MachineAcousticEventFamilies;
  families: readonly (MutableFamily & { familyId: string })[];
} {
  const candidates = input.cues
    .filter((cue) => normalizeCandidateText(cue.text) !== "")
    .toSorted(
      (left, right) =>
        left.start - right.start ||
        left.end - right.end ||
        left.id.localeCompare(right.id),
    );
  const families: MutableFamily[] = [];
  for (const cue of candidates) {
    const matching = families.find((family) =>
      family.cues.some((member) => candidatesShareAcousticEvent(member, cue)),
    );
    if (matching === undefined) families.push({ cues: [cue] });
    else matching.cues.push(cue);
  }
  const identified = families.map((family, index) => ({
    ...family,
    familyId: `acoustic-event-family-${String(index + 1).padStart(5, "0")}`,
  }));
  const artifactFamilies = identified.map(({ familyId, cues }) => {
    const ranked = cues.toSorted(
      (left, right) =>
        cueRank(right) - cueRank(left) || left.id.localeCompare(right.id),
    );
    const representative = ranked[0] ?? cues[0];
    if (representative === undefined) {
      throw new Error("Acoustic event family cannot be empty.");
    }
    const correlationGroupIds = [
      ...new Set(cues.flatMap(candidateCorrelationGroupIds)),
    ].toSorted();
    const independentEvidenceGroupIds = [
      ...new Set(cues.flatMap(candidateIndependentEvidenceGroupIds)),
    ].toSorted();
    const texts = new Set(cues.map((cue) => normalizeCandidateText(cue.text)));
    const pairIndexes = cues.flatMap((left, leftIndex) =>
      cues.slice(leftIndex + 1).map((right) => ({ left, right })),
    );
    const temporalAgreement =
      pairIndexes.length === 0
        ? 1
        : pairIndexes.reduce(
            (sum, pair) => sum + intervalIou(pair.left, pair.right),
            0,
          ) / pairIndexes.length;
    const lexicalAgreement =
      pairIndexes.length === 0
        ? 1
        : pairIndexes.reduce(
            (sum, pair) =>
              sum + candidateTextSimilarity(pair.left.text, pair.right.text),
            0,
          ) / pairIndexes.length;
    const requestIds = [
      ...new Set(cues.flatMap((cue) => cue.provenance?.sourceRequestIds ?? [])),
    ].toSorted();
    const sourceWindowIds = correlationGroupIds;
    const speakerHypotheses = [
      ...new Set(
        cues.flatMap((cue) => (cue.speaker === null ? [] : [cue.speaker])),
      ),
    ].toSorted();
    const textVariants = [...new Set(cues.map((cue) => cue.text))].toSorted();
    const stable = texts.size === 1 || independentEvidenceGroupIds.length >= 2;
    const familyPayload = {
      familyId,
      interval: {
        start: Math.min(...cues.map((cue) => cue.start)),
        end: Math.max(...cues.map((cue) => cue.end)),
      },
      normalizedText: normalizeCandidateText(representative.text),
      candidateIds: cues.map((cue) => cue.id).toSorted(),
      representativeCueId: representative.id,
      sourceRequestIds: requestIds,
      requestIds,
      sourceWindowIds,
      sourceProfileIds: [
        ...new Set(
          cues.flatMap((cue) => cue.provenance?.sourceProfileIds ?? []),
        ),
      ].toSorted(),
      speakerHypotheses,
      textVariants,
      temporalAgreement,
      lexicalAgreement,
      correlationGroupIds,
      independentEvidenceGroupIds,
      independentEvidenceFamilies: independentEvidenceGroupIds,
      correlatedEvidenceGroups: correlationGroupIds,
      status: stable ? ("stable" as const) : ("ambiguous" as const),
      ambiguityStatus: stable ? ("assigned" as const) : ("ambiguous" as const),
      reasons: stable
        ? [
            texts.size === 1
              ? "normalized-text-exact-match"
              : "cross-profile-text-consensus",
            `independent-evidence-groups:${independentEvidenceGroupIds.length}`,
          ]
        : [
            "single-correlated-source-with-nonidentical-text",
            "preserve-for-review",
          ],
    };
    return {
      ...familyPayload,
      semanticHash: machineQualitySemanticHash(familyPayload),
    };
  });
  const inputSemanticHash = machineQualitySemanticHash(candidates);
  const outputSemanticHash = machineQualitySemanticHash(artifactFamilies);
  const artifact = machineAcousticEventFamiliesSchema.parse({
    schemaVersion: "1.0.0",
    policyVersion: c6012PolicyVersion,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    artifactType: "machine-acoustic-event-families",
    familyVersion: "c6.0.1.2-acoustic-event-family-v1",
    mode: input.mode,
    sourceIdentity: {
      sourceMediaSha256: input.sourceMediaSha256 ?? null,
      goldRuntimeInputCount: 0,
    },
    inputCandidateHash: inputSemanticHash,
    inputSemanticHash,
    outputSemanticHash,
    families: artifactFamilies,
    unassignedCandidates: [],
    ambiguousAssignments: artifactFamilies.flatMap((family) =>
      family.status === "ambiguous"
        ? family.candidateIds.map((candidateId) => ({
            candidateId,
            familyIds: [family.familyId],
            reasons: ["single-correlated-source-with-nonidentical-text"],
          }))
        : [],
    ),
    summary: {
      candidateCount: candidates.length,
      familyCount: artifactFamilies.length,
      stableFamilyCount: artifactFamilies.filter(
        (family) => family.status === "stable",
      ).length,
      ambiguousFamilyCount: artifactFamilies.filter(
        (family) => family.status === "ambiguous",
      ).length,
      collapsedDuplicateCount: artifactFamilies.reduce(
        (sum, family) => sum + Math.max(0, family.candidateIds.length - 1),
        0,
      ),
      correlatedDuplicateCount: artifactFamilies.reduce(
        (sum, family) =>
          sum +
          Math.max(
            0,
            family.candidateIds.length -
              family.independentEvidenceGroupIds.length,
          ),
        0,
      ),
    },
    stats: {
      candidateCount: candidates.length,
      familyCount: artifactFamilies.length,
      singletonFamilyCount: artifactFamilies.filter(
        (family) => family.candidateIds.length === 1,
      ).length,
      multiCandidateFamilyCount: artifactFamilies.filter(
        (family) => family.candidateIds.length > 1,
      ).length,
      multiSpeakerFamilyCount: artifactFamilies.filter(
        (family) => family.speakerHypotheses.length > 1,
      ).length,
    },
    semanticHash: outputSemanticHash,
  });
  return { artifact, families: identified };
}
