import {
  c612RankAuditSchema,
  type C61HypothesisUniverse,
  type C611Proposals,
  type C611RiskLedger,
  type C612RankRow,
} from "@mvl/shared";
import { artifact, c612Defined } from "./c612-policy.js";
/** Rank every considered record; structural exclusion is explicit, never a silent prefilter. */
export function fullCandidateRankAudit(
  universe: C61HypothesisUniverse,
  proposals: C611Proposals,
  risks: C611RiskLedger,
) {
  const eligibleEventIds = proposals.records
    .filter((p) => p.eligibilityStatus === "ELIGIBLE")
    .map((p) => p.eventId)
    .sort();
  const rows: C612RankRow[] = [];
  for (const eventId of eligibleEventIds) {
    const p = c612Defined(proposals.records.find((p) => p.eventId === eventId));
    const candidates = universe.candidates.filter((c) => c.eventId === eventId);
    const riskById = new Map(
      risks.rows
        .filter((r) => r.eventId === eventId)
        .map((r) => [r.candidateId, r]),
    );
    const current = risks.rows.find(
      (r) => r.eventId === eventId && r.role === "CURRENT_NO_SWITCH",
    );
    const allowed = new Set(p.eligibleCandidates.map((c) => c.candidateId));
    const alternatives = candidates.filter((c) => allowed.has(c.candidateId));
    const ranking = (key: "legacyRisk" | "hierarchicalRisk") =>
      alternatives
        .filter((c) => riskById.get(c.candidateId)?.[key] != null)
        .toSorted(
          (a, b) =>
            c612Defined(c612Defined(riskById.get(a.candidateId))[key]) -
              c612Defined(c612Defined(riskById.get(b.candidateId))[key]) ||
            a.provenanceHash.localeCompare(b.provenanceHash) ||
            a.candidateId.localeCompare(b.candidateId),
        )
        .map((c) => c.candidateId);
    const raw = ranking("legacyRisk"),
      hierarchical = ranking("hierarchicalRisk");
    for (const c of candidates.toSorted((a, b) =>
      a.candidateId.localeCompare(b.candidateId),
    )) {
      const r = riskById.get(c.candidateId),
        isCurrent = c.providerFamily === "CURRENT";
      rows.push({
        eventId,
        candidateId: c.candidateId,
        candidateProvider: c.providerFamily,
        candidateRole: c.candidateRole,
        rawMbrRank: raw.includes(c.candidateId)
          ? raw.indexOf(c.candidateId) + 1
          : null,
        hierarchicalMbrRank: hierarchical.includes(c.candidateId)
          ? hierarchical.indexOf(c.candidateId) + 1
          : null,
        rawMbrRisk: r?.legacyRisk ?? null,
        hierarchicalMbrRisk: r?.hierarchicalRisk ?? null,
        rawMbrMargin:
          r?.legacyRisk != null && current?.legacyRisk != null
            ? current.legacyRisk - r.legacyRisk
            : null,
        hierarchicalMbrMargin:
          r?.hierarchicalRisk != null && current?.hierarchicalRisk != null
            ? current.hierarchicalRisk - r.hierarchicalRisk
            : null,
        currentCandidate: isCurrent,
        inclusionStatus: c.inclusionStatus,
        provenanceHash: c.provenanceHash,
        structuralEligible: isCurrent || allowed.has(c.candidateId),
        reasons:
          isCurrent || allowed.has(c.candidateId)
            ? []
            : (p.rejectedCandidates.find((r) => r.candidateId === c.candidateId)
                ?.reasons ?? c.inclusionReasons),
      });
    }
    if (hierarchical[0] !== p.proposedCandidateId)
      throw new Error("C612_H2_BASELINE_RANK_NOT_REPRODUCED");
    if (
      candidates.filter(
        (c) =>
          c.providerFamily === "CURRENT" && c.inclusionStatus === "INCLUDED",
      ).length !== 1
    )
      throw new Error("C612_CURRENT_NOT_UNIQUE");
  }
  return c612RankAuditSchema.parse(
    artifact("machine-c6-1-2-full-candidate-rank-audit", {
      universeHash: universe.semanticHash,
      baselineRiskHash: risks.semanticHash,
      eligibleEventIds,
      rows,
      runtimeGoldInputCount: 0,
      tieBreak: "RISK_PROVENANCE_HASH_CANDIDATE_ID",
    }),
  );
}
