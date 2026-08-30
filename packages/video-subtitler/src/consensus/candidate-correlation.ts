import type {
  C61CandidateText,
  C61HypothesisWeight,
  C61RoverVariant,
} from "@mvl/shared";
export function c61RequiredDecoderValue<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("C61_DECODER_INVARIANT_MISSING");
  return value;
}
export interface C61AcousticIdentity {
  modelIdentityHash: string;
  audioSha256: string;
  representationHash: string;
}
/** Both identities must come from the audited cache adapter, never a synthetic path. */
export interface C61AcousticEvidence {
  candidateId: string;
  eventId: string;
  candidateProvenanceHash: string;
  expectedIdentity: C61AcousticIdentity;
  cachedIdentity: C61AcousticIdentity;
  nllPerTargetToken: number | null;
  scorability: "SCORABLE" | "UNSCORABLE";
  evidenceHash: string;
  cacheHit: boolean;
}
export function c61CandidateOrder(
  candidates: readonly C61CandidateText[],
): C61CandidateText[] {
  return [...candidates].sort(
    (a, b) =>
      a.provenanceHash.localeCompare(b.provenanceHash) ||
      a.candidateId.localeCompare(b.candidateId),
  );
}
export function c61AcousticCacheMatches(
  candidate: C61CandidateText,
  evidence: C61AcousticEvidence,
): boolean {
  const hash = /^[a-f0-9]{64}$/u;
  return (
    evidence.cacheHit &&
    evidence.scorability === "SCORABLE" &&
    evidence.candidateId === candidate.candidateId &&
    evidence.eventId === candidate.eventId &&
    evidence.candidateProvenanceHash === candidate.provenanceHash &&
    evidence.nllPerTargetToken !== null &&
    Number.isFinite(evidence.nllPerTargetToken) &&
    evidence.nllPerTargetToken >= 0 &&
    hash.test(evidence.evidenceHash) &&
    (Object.keys(evidence.expectedIdentity) as (keyof C61AcousticIdentity)[])
      .length === 3 &&
    (["modelIdentityHash", "audioSha256", "representationHash"] as const).every(
      (key) =>
        hash.test(evidence.expectedIdentity[key]) &&
        evidence.expectedIdentity[key] === evidence.cachedIdentity[key],
    )
  );
}
/** No provider confidence is consumed: CTC is compared only for one exact model/audio pair. */
function acousticMultipliers(
  candidates: readonly C61CandidateText[],
  evidence: readonly C61AcousticEvidence[],
): Map<
  string,
  {
    multiplier: number;
    evidenceHash: string;
  }
> {
  const rows = candidates.flatMap((candidate) => {
    const matches = evidence
      .filter((entry) => c61AcousticCacheMatches(candidate, entry))
      .sort((a, b) => a.evidenceHash.localeCompare(b.evidenceHash));
    // Conflicting duplicate cache records are unknown, not a best-score selection opportunity.
    if (
      matches.length === 0 ||
      new Set(
        matches.map(
          (entry) =>
            `${entry.expectedIdentity.modelIdentityHash}:${entry.expectedIdentity.audioSha256}:${entry.nllPerTargetToken}`,
        ),
      ).size !== 1
    )
      return [];
    return [{ candidate, entry: c61RequiredDecoderValue(matches[0]) }];
  });
  const result = new Map<
    string,
    {
      multiplier: number;
      evidenceHash: string;
    }
  >();
  for (const { candidate, entry } of rows) {
    const comparable = rows.filter(
      ({ entry: peer }) =>
        peer.expectedIdentity.modelIdentityHash ===
          entry.expectedIdentity.modelIdentityHash &&
        peer.expectedIdentity.audioSha256 ===
          entry.expectedIdentity.audioSha256,
    );
    if (comparable.length < 2) continue;
    const scores = comparable.map(({ entry: peer }) =>
      c61RequiredDecoderValue(peer.nllPerTargetToken),
    );
    const min = Math.min(...scores),
      max = Math.max(...scores);
    const support =
      max === min
        ? 0.5
        : (max - c61RequiredDecoderValue(entry.nllPerTargetToken)) /
          (max - min);
    result.set(candidate.candidateId, {
      multiplier: Math.max(0.9, Math.min(1.1, 0.9 + 0.2 * support)),
      evidenceHash: entry.evidenceHash,
    });
  }
  return result;
}
export function c61HypothesisWeights(
  candidates: readonly C61CandidateText[],
  variant: C61RoverVariant = "R2",
  acousticEvidence: readonly C61AcousticEvidence[] = [],
): C61HypothesisWeight[] {
  const ordered = c61CandidateOrder(candidates);
  const active = ordered.some(
    (candidate) => candidate.providerFamily !== "CURRENT",
  )
    ? ordered.filter((candidate) => candidate.providerFamily !== "CURRENT")
    : ordered;
  const acoustics =
    variant === "R5"
      ? acousticMultipliers(active, acousticEvidence)
      : new Map<
          string,
          {
            multiplier: number;
            evidenceHash: string;
          }
        >();
  const unnormalized = ordered.map((candidate) => {
    const peers = active.filter(
      (peer) => peer.providerFamily === candidate.providerFamily,
    );
    const groups = [...new Set(peers.map((peer) => peer.correlationGroupId))];
    const groupPeers = peers.filter(
      (peer) => peer.correlationGroupId === candidate.correlationGroupId,
    );
    const texts = [...new Set(groupPeers.map((peer) => peer.normalizedText))];
    const equivalentCount = groupPeers.filter(
      (peer) => peer.normalizedText === candidate.normalizedText,
    ).length;
    const providerSupport = peers.length ? 1 / peers.length : 0;
    const groupSupport =
      groups.length && texts.length && equivalentCount
        ? 1 / groups.length / texts.length / equivalentCount
        : 0;
    // Stability changes a provider's internal distribution without pretending repeated windows are providers.
    const stability =
      variant === "R3"
        ? 0.75 +
          0.25 *
            (peers.filter(
              (peer) => peer.normalizedText === candidate.normalizedText,
            ).length /
              Math.max(1, peers.length))
        : 1;
    const acoustic = acoustics.get(candidate.candidateId);
    const rawCandidateSupport = new Set(
      candidate.rawVoteCandidateIds ?? [candidate.candidateId],
    ).size;
    const base =
      variant === "R0"
        ? peers.length
          ? rawCandidateSupport
          : 0
        : variant === "R1"
          ? providerSupport
          : groupSupport;
    const row: C61HypothesisWeight = {
      candidateId: candidate.candidateId,
      providerFamily: candidate.providerFamily,
      correlationGroupId: candidate.correlationGroupId,
      rawCandidateSupport,
      correlatedGroupSupport: groupSupport,
      providerFamilySupport: providerSupport,
      stabilityMultiplier: stability,
      acousticMultiplier: acoustic?.multiplier ?? 1,
      acousticStatus: acoustic ? "EXACT_CACHE_MATCH" : "UNKNOWN",
      acousticEvidenceId: acoustic?.evidenceHash ?? null,
      normalizedHypothesisWeight: 0,
    };
    return { row, rawWeight: base * stability * (acoustic?.multiplier ?? 1) };
  });
  // Stability keeps equal provider mass. R5 alone permits the frozen bounded acoustic adjustment.
  const providerSums = new Map<string, number>();
  for (const { row, rawWeight } of unnormalized)
    providerSums.set(
      row.providerFamily,
      (providerSums.get(row.providerFamily) ?? 0) + rawWeight,
    );
  const raw = unnormalized.map(({ row, rawWeight }) => {
    const providerTotal = providerSums.get(row.providerFamily) ?? 0;
    return variant === "R0" || variant === "R5"
      ? rawWeight
      : providerTotal > 0
        ? rawWeight / providerTotal
        : 0;
  });
  const total = raw.reduce((sum, value) => sum + value, 0);
  return unnormalized.map(({ row }, index) => ({
    ...row,
    normalizedHypothesisWeight: total
      ? c61RequiredDecoderValue(raw[index]) / total
      : 0,
  }));
}
