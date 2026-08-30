import type {
  C61CandidateText,
  C61Hypothesis,
  C61HypothesisUniverse,
} from "@mvl/shared";
import {
  machineExistingCandidateMbrRiskLedgerSchema,
  type C611CorrelationGroups,
  type C611CandidateRisk,
} from "../../../shared/src/c6-1-1-machine-schemas.js";
import { machineQualitySemanticHash as hash } from "../machine-quality/evidence-correlation.js";
import { c61ExpectedRisk, c61NormalizedEditDistance } from "./candidate-mbr.js";
import { c61HypothesisWeights } from "./candidate-correlation.js";
import { C61_DECODER_LIMITS } from "./c61-policy.js";
import { c611Header, c611WithHash } from "./hierarchical-correlation-groups.js";
import { normalizeC61HypothesisText } from "./hypothesis-universe.js";

export const C611_RISK_POLICY = {
  version: "c611-existing-candidate-risk-v1",
  distance: "C6.1_COMBINED_GRAPHEME_TRUSTED_PRONUNCIATION",
  graphemeWeight: C61_DECODER_LIMITS.combinedGraphemeWeight,
  H0: "C6.1_R3_EXPECTED_RISK_CURRENT_ZERO_VOTE",
  H1: "MEAN_WITHIN_PROVIDER_THEN_EQUAL_PROVIDER_MEAN",
  H2: "OBSERVATION_MEDOID_CORE_MEDOID_MODEL_MEDOID_PROVIDER_MEDOID_EQUAL_PROVIDER_MEAN",
  tieBreak: "provenanceHash-then-candidateId",
  missingPronunciation: "grapheme-distance-fallback-not-invented-reading",
  current: "risk-query-only-never-a-provider-vote",
} as const;
type TextView = Pick<C61Hypothesis, "normalizedText" | "pronunciationText">;
const mean = (values: number[]): number | null =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const order = (a: C61Hypothesis, b: C61Hypothesis) =>
  a.provenanceHash.localeCompare(b.provenanceHash) ||
  a.candidateId.localeCompare(b.candidateId);
export function c611CandidateDistance(a: TextView, b: TextView): number {
  const grapheme = c61NormalizedEditDistance(
    a.normalizedText,
    b.normalizedText,
  );
  const pronunciation =
    a.pronunciationText && b.pronunciationText
      ? c61NormalizedEditDistance(a.pronunciationText, b.pronunciationText)
      : grapheme;
  return (
    C611_RISK_POLICY.graphemeWeight * grapheme +
    (1 - C611_RISK_POLICY.graphemeWeight) * pronunciation
  );
}
export function c611CandidateMedoid(
  candidates: readonly C61Hypothesis[],
): C61Hypothesis {
  if (!candidates.length) throw new Error("C611_EMPTY_MEDOID");
  // Equivalent representations do not gain extra mass merely from metadata rows.
  const uniqueRepresentations = new Map<string, C61Hypothesis>();
  for (const candidate of candidates.toSorted(order)) {
    const key = hash([candidate.normalizedText, candidate.pronunciationText]);
    // Keep the first provenance-ranked representative, not the last duplicate.
    if (!uniqueRepresentations.has(key))
      uniqueRepresentations.set(key, candidate);
  }
  const unique = [...uniqueRepresentations.values()];
  const ranked = unique.map((candidate) => ({
    candidate,
    risk:
      mean(unique.map((peer) => c611CandidateDistance(candidate, peer))) ?? 0,
  }));
  ranked.sort((a, b) => a.risk - b.risk || order(a.candidate, b.candidate));
  const result = ranked[0]?.candidate;
  if (!result) throw new Error("C611_EMPTY_MEDOID");
  return result;
}
export function c611AsCandidateText(
  candidate: C61Hypothesis,
): C61CandidateText {
  if (
    !candidate.eventId ||
    !candidate.modelIdentity ||
    !candidate.requestId ||
    !candidate.sourceInterval
  )
    throw new Error("C611_UNVERIFIED_CANDIDATE");
  return {
    candidateId: candidate.candidateId,
    eventId: candidate.eventId,
    providerFamily: candidate.providerFamily,
    sourceInterval: candidate.sourceInterval,
    displayText: candidate.displayText,
    normalizedText: candidate.normalizedText,
    pronunciationText: candidate.pronunciationText,
    correlationGroupId: candidate.correlationGroupId,
    provenanceHash: candidate.provenanceHash,
  };
}
export function buildC611RiskLedger(input: {
  universe: C61HypothesisUniverse;
  correlationGroups: C611CorrelationGroups;
}) {
  const rows: C611CandidateRisk[] = [];
  const observations = new Map(
    input.correlationGroups.observations.map((o) => [o.candidateId, o]),
  );
  for (const event of input.universe.events.toSorted((a, b) =>
    a.eventId.localeCompare(b.eventId),
  )) {
    const candidates = input.universe.candidates
      .filter(
        (c) =>
          c.eventId === event.eventId &&
          c.inclusionStatus === "INCLUDED" &&
          c.providerFamily !== "CURRENT",
      )
      .toSorted(order);
    const current = input.universe.candidates.find(
      (c) =>
        c.eventId === event.eventId &&
        c.inclusionStatus === "INCLUDED" &&
        c.providerFamily === "CURRENT",
    );
    const representations = candidates.map(c611AsCandidateText);
    const legacyWeights = c61HypothesisWeights(representations, "R3");
    const reduceBy = (
      items: C61Hypothesis[],
      level: "observationGroupId" | "coreGroupId" | "modelGroupId",
    ): C61Hypothesis[] => {
      const buckets = new Map<string, C61Hypothesis[]>();
      for (const item of items) {
        const group = observations.get(item.candidateId)?.[level];
        if (!group) throw new Error("C611_RISK_CORRELATION_MISSING");
        buckets.set(group, [...(buckets.get(group) ?? []), item]);
      }
      return [...buckets.values()].map(c611CandidateMedoid).toSorted(order);
    };
    const providers = (["WHISPER", "REAZON"] as const).flatMap(
      (providerFamily) => {
        const peers = candidates.filter(
          (c) => c.providerFamily === providerFamily,
        );
        if (!peers.length) return [];
        const reps = reduceBy(
          reduceBy(reduceBy(peers, "observationGroupId"), "coreGroupId"),
          "modelGroupId",
        );
        return [
          {
            providerFamily,
            peers,
            medoid: c611CandidateMedoid(reps),
            coreGroupCount: new Set(
              peers.map((c) => observations.get(c.candidateId)?.coreGroupId),
            ).size,
          },
        ];
      },
    );
    const targets = [
      ...candidates.map((candidate) => ({
        candidate,
        role: "ASR_CANDIDATE" as const,
        providerFamily: candidate.providerFamily,
        candidateId: candidate.candidateId,
      })),
      ...(event.currentText === null
        ? []
        : [
            {
              candidate: {
                normalizedText: normalizeC61HypothesisText(event.currentText),
                pronunciationText: current?.pronunciationText ?? null,
              },
              role: "CURRENT_NO_SWITCH" as const,
              providerFamily: "CURRENT" as const,
              candidateId: current?.candidateId ?? null,
            },
          ]),
    ];
    for (const target of targets) {
      const providerRisks = providers.map((p) => ({
        providerFamily: p.providerFamily,
        meanRisk:
          mean(
            p.peers.map((c) => c611CandidateDistance(target.candidate, c)),
          ) ?? 0,
        medoidCandidateId: p.medoid.candidateId,
        medoidRisk: c611CandidateDistance(target.candidate, p.medoid),
        coreGroupCount: p.coreGroupCount,
      }));
      const core = target.candidateId
        ? observations.get(target.candidateId)?.coreGroupId
        : null;
      rows.push(
        c611WithHash({
          eventId: event.eventId,
          candidateId: target.candidateId,
          role: target.role,
          providerFamily: target.providerFamily,
          legacyRisk: candidates.length
            ? c61ExpectedRisk(
                target.candidate,
                representations,
                legacyWeights,
                "COMBINED",
              ).expectedNormalizedDistance
            : null,
          withinProviderRisk:
            target.providerFamily === "CURRENT"
              ? null
              : mean(
                  candidates
                    .filter((c) => c.providerFamily === target.providerFamily)
                    .map((c) => c611CandidateDistance(target.candidate, c)),
                ),
          crossProviderRisk: mean(
            candidates
              .filter((c) => c.providerFamily !== target.providerFamily)
              .map((c) => c611CandidateDistance(target.candidate, c)),
          ),
          withinCorrelationRisk: core
            ? mean(
                candidates
                  .filter(
                    (c) =>
                      observations.get(c.candidateId)?.coreGroupId === core,
                  )
                  .map((c) => c611CandidateDistance(target.candidate, c)),
              )
            : null,
          providerBalancedRisk: mean(providerRisks.map((p) => p.meanRisk)),
          hierarchicalRisk: mean(providerRisks.map((p) => p.medoidRisk)),
          providerRisks,
        }),
      );
    }
  }
  return machineExistingCandidateMbrRiskLedgerSchema.parse(
    c611WithHash({
      ...c611Header,
      artifactType: "machine-existing-candidate-mbr-risk-ledger",
      candidateUniverseHash: input.universe.semanticHash,
      correlationGroupsHash: input.correlationGroups.semanticHash,
      riskPolicyHash: hash(C611_RISK_POLICY),
      rows,
      currentIndependentVoteCount: 0,
      reasons: [
        "LOWER_RISK_IS_BETTER",
        "MBR_MARGIN_IS_NOT_CONFIDENCE",
        "CURRENT_QUERIES_THE_SAME_ASR_DISTRIBUTION_WITH_ZERO_VOTE",
        "HIERARCHICAL_MEDOIDS_RETAIN_ORIGINAL_FULL_CANDIDATES",
      ],
    }),
  );
}
