import {
  seriesLanguageMemoryDeltaSchema,
  seriesLanguageMemoryEntrySchema,
  type EpisodeLanguageCandidate,
  type EpisodeLanguageObservations,
  type SeriesLanguageMemory,
  type SeriesLanguageMemoryDelta,
  type SeriesLanguageMemoryEntry,
} from "@mvl/shared";

import { hiraganaToKatakana } from "./memory-extraction.js";
import { stableMemoryHash } from "./series-memory.js";

const RANKING_ELIGIBLE_TRUST = new Set([
  "human-corrected",
  "human-reviewed",
  "validated-series",
  "repeated-verified",
]);

function trustForCandidate(
  candidate: EpisodeLanguageCandidate,
): SeriesLanguageMemoryEntry["trustLevel"] {
  if (candidate.entryType === "correction-pair") return "human-corrected";
  if (candidate.occurrenceCount >= 2) return "repeated-verified";
  if (candidate.humanReviewed) return "human-reviewed";
  return "single-observation";
}

function buildEntry(input: {
  candidate: EpisodeLanguageCandidate;
  seriesKey: string;
}): SeriesLanguageMemoryEntry {
  const { candidate } = input;
  const trustLevel = trustForCandidate(candidate);
  const reading = candidate.reading;
  const pronunciationEligible =
    reading !== null &&
    reading.normalize("NFKC") !== candidate.canonicalSurface.normalize("NFKC");
  const rankingEligible = RANKING_ELIGIBLE_TRUST.has(trustLevel);
  const acousticAliases = pronunciationEligible ? [reading] : [];
  const entrySeed = {
    seriesKey: input.seriesKey,
    entryType: candidate.entryType,
    lookupKeyNfkc: candidate.canonicalSurface.normalize("NFKC"),
    readingHiragana: candidate.reading,
  };
  const entryId = `series-memory-entry-${stableMemoryHash(entrySeed).slice(0, 24)}`;
  const aliasEvidence =
    candidate.evidence.find(
      (value) => value.sourceType === "human-correction",
    ) ??
    candidate.evidence.find((value) => value.sourceType === "mfa-dictionary") ??
    candidate.evidence.find(
      (value) => value.sourceType === "sudachi-dictionary",
    ) ??
    candidate.evidence[0];
  const aliasSource =
    aliasEvidence?.sourceType === "human-correction"
      ? ("human-correction-reading" as const)
      : aliasEvidence?.sourceType === "mfa-dictionary"
        ? ("mfa-dictionary-reading" as const)
        : aliasEvidence?.sourceType === "g2p"
          ? ("g2p-reading" as const)
          : aliasEvidence?.sourceType === "manual-memory-entry"
            ? ("manual-reading" as const)
            : ("sudachi-reading" as const);
  const base = {
    entryId,
    seriesKey: input.seriesKey,
    entryType: candidate.entryType,
    canonicalSurface: candidate.canonicalSurface,
    canonicalSurfaceNfc: candidate.canonicalSurface.normalize("NFC"),
    lookupKeyNfkc: candidate.canonicalSurface.normalize("NFKC"),
    readingHiragana: candidate.reading,
    readingKatakana: hiraganaToKatakana(candidate.reading),
    pronunciationPhones: [...candidate.pronunciationPhones],
    dictionaryForm: candidate.dictionaryForm,
    normalizedForm: candidate.normalizedForm,
    partOfSpeech: [...candidate.partOfSpeech],
    variants: [],
    orthographicVariants: [],
    acousticAliases,
    acousticAliasProvenance:
      pronunciationEligible && aliasEvidence !== undefined
        ? [
            {
              alias: reading,
              aliasType:
                candidate.entryType === "correction-pair"
                  ? ("human-correction-reading" as const)
                  : ("reading" as const),
              source: aliasSource,
              sourceArtifactHash: aliasEvidence.sourceArtifactHash,
              sourceEntryId: entryId,
              sourceEvidenceIds: candidate.evidence
                .filter(
                  (value) => value.sourceType === aliasEvidence.sourceType,
                )
                .map((value) => value.evidenceId)
                .toSorted(),
              trustLevel,
              verified: rankingEligible,
            },
          ]
        : [],
    observedWrongForms: [...candidate.observedWrongForms].toSorted(),
    dialectMetadata: candidate.dialectMetadata,
    preservationPolicy: candidate.dialectMetadata.preservationRequired
      ? ("preserve-dialect-surface" as const)
      : pronunciationEligible && !rankingEligible
        ? ("pronunciation-projection-only" as const)
        : ("preserve-canonical-surface" as const),
    status: "active" as const,
    trustLevel,
    applicationEligibility:
      rankingEligible && pronunciationEligible
        ? ("ranking-and-pronunciation" as const)
        : rankingEligible
          ? ("ranking-only" as const)
          : pronunciationEligible
            ? ("pronunciation-only" as const)
            : ("suggestion-only" as const),
    sourceEpisodes: [
      ...new Set(candidate.evidence.map((value) => value.episodeId)),
    ].toSorted(),
    firstSeen: Math.min(
      ...candidate.evidence.map((value) => value.observedAtSeconds),
    ),
    lastSeen: Math.max(
      ...candidate.evidence.map((value) => value.observedAtSeconds),
    ),
    occurrenceIds: [...candidate.occurrenceIds].toSorted(),
    evidence: [...candidate.evidence].toSorted((left, right) =>
      left.evidenceLineageId.localeCompare(right.evidenceLineageId),
    ),
    conflicts: [],
  };
  return seriesLanguageMemoryEntrySchema.parse({
    ...base,
    semanticHash: stableMemoryHash(base),
  });
}

export function promoteEpisodeLanguageObservations(input: {
  observations: EpisodeLanguageObservations;
  parentMemory?: SeriesLanguageMemory | null;
  generatedAt?: string;
}): SeriesLanguageMemoryDelta {
  const allCandidates = [
    ...input.observations.termCandidates,
    ...input.observations.properNounCandidates,
    ...input.observations.dialectCandidates,
    ...input.observations.correctionObservations,
  ];
  const uniqueCandidates = [
    ...new Map(
      allCandidates.map((candidate) => [candidate.candidateId, candidate]),
    ).values(),
  ].toSorted((left, right) =>
    left.candidateId.localeCompare(right.candidateId),
  );
  const existingByKey = new Map(
    (input.parentMemory?.entries ?? []).map((entry) => [
      `${entry.entryType}\u0000${entry.lookupKeyNfkc}\u0000${entry.readingHiragana ?? ""}`,
      entry,
    ]),
  );
  const candidates = uniqueCandidates.map((candidate) => {
    const proposedEntry = buildEntry({
      candidate,
      seriesKey: input.observations.seriesIdentity.seriesKey,
    });
    const existing = existingByKey.get(
      `${proposedEntry.entryType}\u0000${proposedEntry.lookupKeyNfkc}\u0000${proposedEntry.readingHiragana ?? ""}`,
    );
    const hasEnoughEvidence =
      candidate.humanReviewed ||
      candidate.occurrenceCount >= 2 ||
      candidate.entryType === "correction-pair";
    const promotionDecision =
      !hasEnoughEvidence || candidate.commonWord
        ? ("reject" as const)
        : existing === undefined
          ? ("promote" as const)
          : ("merge" as const);
    return {
      candidateId: candidate.candidateId,
      proposedEntry,
      evidence: proposedEntry.evidence,
      promotionDecision,
      promotionReasons: [
        candidate.humanReviewed
          ? "human-reviewed-canonical-evidence"
          : "non-human-reviewed-evidence",
        candidate.occurrenceCount >= 2
          ? "repeated-series-surface"
          : "single-observation",
        existing === undefined ? "new-memory-key" : "existing-memory-key",
      ],
      blockers: [
        ...(candidate.commonWord ? ["common-word-filter"] : []),
        ...(!hasEnoughEvidence ? ["insufficient-promotion-evidence"] : []),
      ],
    };
  });
  const statistics = {
    memoryCandidateCount: candidates.length,
    memoryPromotedCount: candidates.filter(
      (value) => value.promotionDecision === "promote",
    ).length,
    memoryMergedCount: candidates.filter(
      (value) => value.promotionDecision === "merge",
    ).length,
    memoryQuarantinedCount: 0,
    memoryRejectedCount: candidates.filter(
      (value) => value.promotionDecision === "reject",
    ).length,
  };
  const deltaIdentity = {
    seriesKey: input.observations.seriesIdentity.seriesKey,
    parentMemoryHash: input.parentMemory?.memoryHash ?? null,
    candidates: candidates.map((value) => ({
      candidateId: value.candidateId,
      proposedEntryHash: value.proposedEntry.semanticHash,
      promotionDecision: value.promotionDecision,
      blockers: value.blockers,
    })),
  };
  const deltaHash = stableMemoryHash(deltaIdentity);
  const base = {
    schemaVersion: "1.0.0" as const,
    artifactType: "series-language-memory-delta" as const,
    deltaVersion: "C5.19" as const,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    seriesKey: input.observations.seriesIdentity.seriesKey,
    parentMemoryHash: input.parentMemory?.memoryHash ?? null,
    candidates,
    statistics,
    deltaHash,
  };
  return seriesLanguageMemoryDeltaSchema.parse({
    ...base,
    semanticHash: stableMemoryHash({ ...base, generatedAt: null }),
  });
}
