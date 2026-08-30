import type { C61Hypothesis, C61HypothesisUniverse } from "@mvl/shared";
import {
  C611_FEATURE_NAMES,
  machineSelectiveMbrFeaturesSchema,
  type C611Completeness,
  type C611CorrelationGroups,
  type C611FeatureName,
  type C611FeatureRow,
  type C611Proposals,
} from "../../../shared/src/c6-1-1-machine-schemas.js";
import type { C61RawAcousticScore } from "./c61-artifact-adapter.js";
import { machineQualitySemanticHash as hash } from "../machine-quality/evidence-correlation.js";
import { c61NormalizedEditDistance } from "./candidate-mbr.js";
import {
  c611Header,
  c611TextHash,
  c611WithHash,
} from "./hierarchical-correlation-groups.js";
import { normalizeC61HypothesisText } from "./hypothesis-universe.js";

export const C611_FEATURE_POLICY = {
  version: "c611-selective-machine-features-v1",
  names: C611_FEATURE_NAMES,
  providerCodes: { WHISPER: 0, REAZON: 1 },
  roleCodes: {
    HISTORICAL_MACHINE_CANDIDATE: 0,
    PRIMARY_WHISPER: 0,
    WHISPER_RE_ASR_CANDIDATES: 1,
    WHISPER_CORE_PROJECTED: 2,
    WHISPER_CORE_EXACT: 3,
    WHISPER_CORE_CONTEXT: 4,
    REAZON_CORE_EXACT: 5,
    REAZON_CORE_CONTEXT: 6,
  },
  ctcDirection:
    "sign(currentNll-proposedNll)-same-model-audio-exact-identity-only",
  ctcRole: "support-or-veto-feature-never-winner",
  stability:
    "fraction-of-distinct-core-groups-with-exact-normalized-proposal-text",
  missing: "null-plus-same-key-true-no-imputation",
  eventIdAndProposalId: "join-keys-only-never-features",
  textFeatures: false,
} as const;

function acousticFor(
  candidate: C61Hypothesis,
  scores: readonly C61RawAcousticScore[],
): C61RawAcousticScore | null {
  const matches = scores.filter(
    (s) =>
      s.eventId === candidate.eventId &&
      s.sourceCandidateId === candidate.sourceCandidateId &&
      s.sourceDisplayTextHash === c611TextHash(candidate.displayText) &&
      s.scorability === "SCORABLE" &&
      s.nllPerTargetToken !== null &&
      Number.isFinite(s.nllPerTargetToken) &&
      s.nllPerTargetToken >= 0 &&
      s.audioSha256 === s.expectedAudioSha256 &&
      s.representationHash === s.expectedRepresentationHash &&
      [
        s.audioSha256,
        s.modelIdentityHash,
        s.evidenceHash,
        s.sourceArtifactHash,
        s.representationHash,
      ].every((h) => /^[a-f0-9]{64}$/u.test(h)),
  );
  if (
    !matches.length ||
    new Set(
      matches.map((m) =>
        hash([m.modelIdentityHash, m.audioSha256, m.nllPerTargetToken]),
      ),
    ).size !== 1
  )
    return null;
  return (
    matches.toSorted((a, b) =>
      a.evidenceHash.localeCompare(b.evidenceHash),
    )[0] ?? null
  );
}
export function buildC611Features(input: {
  universe: C61HypothesisUniverse;
  proposals: C611Proposals;
  completeness: C611Completeness;
  correlationGroups: C611CorrelationGroups;
  acousticScores: readonly C61RawAcousticScore[];
}) {
  const rows: C611FeatureRow[] = input.proposals.records.map((proposal) => {
    const complete = input.completeness.rows.find(
      (c) => c.proposalId === proposal.proposalId,
    );
    const event = input.universe.events.find(
      (e) => e.eventId === proposal.eventId,
    );
    if (!event || !complete) throw new Error("C611_FEATURE_JOIN_MISSING");
    const candidate = input.universe.candidates.find(
      (c) => c.candidateId === proposal.proposedCandidateId,
    );
    const peers = input.universe.candidates.filter(
      (c) =>
        c.eventId === proposal.eventId &&
        c.inclusionStatus === "INCLUDED" &&
        c.providerFamily !== "CURRENT",
    );
    const observation = new Map(
      input.correlationGroups.observations.map((o) => [o.candidateId, o]),
    );
    const supporting = candidate
      ? peers.filter((c) => c.normalizedText === candidate.normalizedText)
      : [];
    const stability = (provider: "WHISPER" | "REAZON"): number | null => {
      if (!candidate) return null;
      const groups = new Set(
        peers
          .filter((p) => p.providerFamily === provider)
          .map((p) => observation.get(p.candidateId)?.coreGroupId)
          .filter(Boolean),
      );
      const matching = new Set(
        supporting
          .filter((p) => p.providerFamily === provider)
          .map((p) => observation.get(p.candidateId)?.coreGroupId)
          .filter(Boolean),
      );
      return groups.size ? matching.size / groups.size : null;
    };
    const whisperStability = stability("WHISPER"),
      reazonStability = stability("REAZON");
    const proposedAcoustic = candidate
      ? acousticFor(candidate, input.acousticScores)
      : null;
    const currentScores = peers
      .filter((p) => p.displayText === event.currentText)
      .map((p) => acousticFor(p, input.acousticScores))
      .filter((s): s is C61RawAcousticScore => s !== null);
    const currentAcoustic =
      new Set(
        currentScores.map((s) =>
          hash([s.modelIdentityHash, s.audioSha256, s.nllPerTargetToken]),
        ),
      ).size === 1
        ? (currentScores[0] ?? null)
        : null;
    let ctcMargin: number | null = null;
    if (proposedAcoustic !== null && currentAcoustic !== null) {
      if (
        proposedAcoustic.modelIdentityHash ===
          currentAcoustic.modelIdentityHash &&
        proposedAcoustic.audioSha256 === currentAcoustic.audioSha256 &&
        proposedAcoustic.nllPerTargetToken !== null &&
        currentAcoustic.nllPerTargetToken !== null
      ) {
        ctcMargin =
          currentAcoustic.nllPerTargetToken -
          proposedAcoustic.nllPerTargetToken;
      }
    }
    const roleCodes: Readonly<Record<string, number>> =
      C611_FEATURE_POLICY.roleCodes;
    const values: Record<C611FeatureName, number | null> = {
      rawMbrMargin: proposal.rawMbrMargin,
      hierarchicalMbrMargin: proposal.hierarchicalMbrMargin,
      runnerUpMargin: proposal.runnerUpMargin,
      providerCode:
        proposal.proposedProvider === null
          ? null
          : C611_FEATURE_POLICY.providerCodes[proposal.proposedProvider],
      candidateRoleCode:
        proposal.proposedRole === null
          ? null
          : (roleCodes[proposal.proposedRole] ?? null),
      providerSupportCount: candidate
        ? new Set(supporting.map((s) => s.providerFamily)).size
        : null,
      correlationSupportCount: candidate
        ? new Set(
            supporting
              .map((s) => observation.get(s.candidateId)?.coreGroupId)
              .filter(Boolean),
          ).size
        : null,
      whisperStability,
      reazonStability,
      crossModelAgreement:
        whisperStability === null || reazonStability === null
          ? null
          : Number(whisperStability > 0 && reazonStability > 0),
      ctcDirection: ctcMargin === null ? null : Math.sign(ctcMargin),
      ctcMargin,
      tokenSupportCoverage: complete.tokenSupportCoverage,
      decoderTruncationRisk: complete.decoderTruncationRisk,
      hallucinationRisk: complete.hallucinationRisk,
      requestEdgeRisk: complete.requestEdgeRisk,
      speechCompleteness:
        complete.speechCompletenessStatus === "UNKNOWN"
          ? null
          : Number(complete.speechCompletenessStatus === "COMPLETE"),
      characterLengthRatio: complete.characterLengthRatio,
      tokenLengthRatio: complete.tokenLengthRatio,
      normalizedLcsCoverage: complete.normalizedLcsCoverage,
      deletedCharacterRatio: complete.deletedCharacterRatio,
      insertedCharacterRatio: complete.insertedCharacterRatio,
      prefixRetention: complete.prefixRetention,
      suffixRetention: complete.suffixRetention,
      longestDeletedSpanRatio:
        complete.longestDeletedSpan === null || !complete.currentCharacterCount
          ? null
          : complete.longestDeletedSpan / complete.currentCharacterCount,
      longestInsertedSpanRatio:
        complete.longestInsertedSpan === null ||
        !complete.proposedCharacterCount
          ? null
          : complete.longestInsertedSpan / complete.proposedCharacterCount,
      eventDuration: complete.eventDuration,
      charactersPerSecond: complete.charactersPerSecond,
      normalizedDistance:
        candidate && event.currentText !== null
          ? c61NormalizedEditDistance(
              normalizeC61HypothesisText(event.currentText),
              candidate.normalizedText,
            )
          : null,
      spanApplicationSafe: Number(proposal.spanApplication !== null),
    };
    const missingFlags = Object.fromEntries(
      C611_FEATURE_NAMES.map((name) => [name, values[name] === null]),
    ) as Record<C611FeatureName, boolean>;
    return c611WithHash({
      proposalId: proposal.proposalId,
      eventId: proposal.eventId,
      values,
      missingFlags,
      acousticEvidenceHashes:
        ctcMargin === null || !currentAcoustic || !proposedAcoustic
          ? []
          : [
              ...new Set([
                currentAcoustic.evidenceHash,
                proposedAcoustic.evidenceHash,
              ]),
            ].toSorted(),
    });
  });
  return machineSelectiveMbrFeaturesSchema.parse(
    c611WithHash({
      ...c611Header,
      artifactType: "machine-selective-mbr-features",
      proposalHash: input.proposals.semanticHash,
      completenessHash: input.completeness.semanticHash,
      featureSchemaHash: hash(C611_FEATURE_POLICY),
      featureNames: [...C611_FEATURE_NAMES],
      rawTextFeatureCount: 0,
      goldFeatureCount: 0,
      datasetSpecificFeatureCount: 0,
      rows,
    }),
  );
}
