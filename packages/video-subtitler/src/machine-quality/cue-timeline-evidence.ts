import {
  c6012PolicyVersion,
  machineCueTimelineEvidenceSchema,
  type GlobalTokenTimelineMode,
  type MachineCueTimelineEvidence,
  type MachineGlobalTokenTimeline,
  type SubtitleCue,
} from "@mvl/shared";

import {
  machineQualitySemanticHash,
  normalizeCandidateText,
  overlapSeconds,
} from "./evidence-correlation.js";

export function buildCueTimelineEvidence(input: {
  cues: readonly SubtitleCue[];
  tokenTimeline: MachineGlobalTokenTimeline;
  mode: GlobalTokenTimelineMode;
  generatedAt?: string;
}): MachineCueTimelineEvidence {
  const trustedTokens = input.tokenTimeline.tokens.filter(
    (token) => token.trusted && token.globalInterval !== null,
  );
  const cues = input.cues.map((cue) => {
    const normalizedCue = normalizeCandidateText(cue.text);
    const matching = trustedTokens.filter((token) => {
      if (token.globalInterval === null) return false;
      return (
        overlapSeconds(cue, token.globalInterval) > 0 &&
        normalizedCue.includes(normalizeCandidateText(token.text))
      );
    });
    const coveredCharacters = new Set(
      matching.flatMap((token) =>
        Array.from(normalizeCandidateText(token.text)),
      ),
    ).size;
    const cueCharacters = new Set(Array.from(normalizedCue)).size;
    const lexicalCoverageRatio =
      cueCharacters === 0 ? 0 : Math.min(1, coveredCharacters / cueCharacters);
    const timingEligible =
      input.mode !== "off" &&
      matching.length > 0 &&
      lexicalCoverageRatio >= 0.6;
    return {
      cueId: cue.id,
      currentInterval: { start: cue.start, end: cue.end },
      trustedTokenIds: matching.map((token) => token.tokenId),
      trustedTokenInterval:
        matching.length === 0
          ? null
          : {
              start: Math.min(
                ...matching.map(
                  (token) => token.globalInterval?.start ?? cue.start,
                ),
              ),
              end: Math.max(
                ...matching.map(
                  (token) => token.globalInterval?.end ?? cue.end,
                ),
              ),
            },
      lexicalCoverageRatio,
      timingEligible,
      evidencePriority:
        matching.length > 0
          ? ("trusted-mapped-token" as const)
          : ("unavailable" as const),
      blockers: timingEligible
        ? []
        : [
            matching.length === 0
              ? "no-localized-trusted-token"
              : "trusted-token-lexical-coverage-below-threshold",
          ],
    };
  });
  const eligible = cues.filter((cue) => cue.timingEligible).length;
  const semanticHash = machineQualitySemanticHash(cues);
  return machineCueTimelineEvidenceSchema.parse({
    schemaVersion: "1.0.0",
    policyVersion: c6012PolicyVersion,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    artifactType: "machine-cue-timeline-evidence",
    mode: input.mode,
    tokenTimelineSemanticHash: input.tokenTimeline.semanticHash,
    cues,
    summary: {
      cueCount: cues.length,
      cueWithTrustedTokenCount: cues.filter(
        (cue) => cue.trustedTokenIds.length > 0,
      ).length,
      timingEligibleCueCount: eligible,
      eligibleCueCoverageRatio: cues.length === 0 ? 0 : eligible / cues.length,
    },
    semanticHash,
  });
}
