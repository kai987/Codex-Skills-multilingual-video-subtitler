import {
  C612_RETRIEVAL,
  c612TopKSchema,
  c612ConservationSchema,
  c612TopKComparisonSchema,
  type c612RankAuditSchema,
  type C61HypothesisUniverse,
  type C612Identity,
  type C612Set,
  type c612ConservationReason,
} from "@mvl/shared";
import type { z } from "zod";
import { artifact, hash, c612Defined } from "./c612-policy.js";
export function buildTopK(
  audit: z.infer<typeof c612RankAuditSchema>,
  universe: C61HypothesisUniverse,
  identities: readonly C612Identity[],
) {
  const identity = new Map(identities.map((i) => [i.candidateId, i]));
  const candidates = new Map(
    universe.candidates.map((c) => [c.candidateId, c]),
  );
  const sets: C612Set[] = [];
  const ledger: {
    profile: C612Set["profile"];
    eventId: string;
    candidateId: string;
    reason: z.infer<typeof c612ConservationReason>;
  }[] = [];
  for (const eventId of audit.eligibleEventIds.toSorted()) {
    const rows = audit.rows
        .filter((r) => r.eventId === eventId)
        .sort((a, b) => a.candidateId.localeCompare(b.candidateId)),
      current = rows.find(
        (r) => r.currentCandidate && r.inclusionStatus === "INCLUDED",
      );
    if (!current) throw new Error("C612_TOPK_CURRENT_MISSING");
    const alternatives = rows.filter(
      (r) =>
        !r.currentCandidate &&
        r.structuralEligible &&
        r.inclusionStatus === "INCLUDED",
    );
    const sort = (k: "rawMbrRank" | "hierarchicalMbrRank") =>
      alternatives.toSorted(
        (a, b) =>
          (a[k] ?? Infinity) - (b[k] ?? Infinity) ||
          a.provenanceHash.localeCompare(b.provenanceHash) ||
          a.candidateId.localeCompare(b.candidateId),
      );
    const h = sort("hierarchicalMbrRank"),
      raw = sort("rawMbrRank");
    const combined = alternatives.toSorted(
      (a, b) =>
        (a.rawMbrRank ?? 1e6) +
          (a.hierarchicalMbrRank ?? 1e6) -
          ((b.rawMbrRank ?? 1e6) + (b.hierarchicalMbrRank ?? 1e6)) ||
        a.provenanceHash.localeCompare(b.provenanceHash) ||
        a.candidateId.localeCompare(b.candidateId),
    );
    const unique = (xs: typeof alternatives) =>
      xs.filter(
        (x, i) => xs.findIndex((v) => v.candidateId === x.candidateId) === i,
      );
    const union = unique([...h.slice(0, 2), ...raw.slice(0, 2), ...combined]);
    for (const profile of C612_RETRIEVAL) {
      const ordered =
        profile === C612_RETRIEVAL[0]
          ? h
          : profile === C612_RETRIEVAL[1]
            ? raw
            : union;
      let selected = ordered.slice(0, 4);
      const exclusions = new Map<
        string,
        z.infer<typeof c612ConservationReason>
      >();
      if (profile === C612_RETRIEVAL[3]) {
        const seenObservations = new Set<string>(),
          seenText = new Set<string>();
        const dedup = ordered.filter((r) => {
          const i = identity.get(r.candidateId),
            c = c612Defined(candidates.get(r.candidateId));
          if (
            i?.observationIdentity &&
            seenObservations.has(i.observationIdentity)
          ) {
            exclusions.set(r.candidateId, "SAME_ACOUSTIC_OBSERVATION");
            return false;
          }
          const textKey = hash([c.providerFamily, c.normalizedText]);
          if (seenText.has(textKey)) {
            exclusions.set(r.candidateId, "NORMALIZED_DUPLICATE");
            return false;
          }
          if (i?.observationIdentity)
            seenObservations.add(i.observationIdentity);
          seenText.add(textKey);
          return true;
        });
        selected = dedup.slice(0, 4);
        for (const provider of ["WHISPER", "REAZON"] as const) {
          if (selected.some((r) => r.candidateProvider === provider)) continue;
          const reserve = dedup.find((r) => r.candidateProvider === provider);
          if (!reserve) continue;
          if (selected.length < 4) selected.push(reserve);
          else {
            const replace = selected.findLastIndex(
              (r) =>
                selected.filter(
                  (x) => x.candidateProvider === r.candidateProvider,
                ).length > 1,
            );
            if (replace >= 0) {
              exclusions.set(
                c612Defined(selected[replace]).candidateId,
                "PROVIDER_DIVERSITY_REPLACED",
              );
              selected[replace] = reserve;
            }
          }
        }
        // Original retrieval order remains deterministic after diversity reservation.
        selected.sort((a, b) => ordered.indexOf(a) - ordered.indexOf(b));
      }
      const selectedIds = new Set(selected.map((r) => r.candidateId));
      sets.push({
        profile,
        eventId,
        currentCandidateId: current.candidateId,
        alternativeIds: [...selectedIds],
      });
      for (const r of rows) {
        const reason =
          r.candidateId === current.candidateId
            ? "CURRENT"
            : selectedIds.has(r.candidateId)
              ? "INCLUDED"
              : (exclusions.get(r.candidateId) ??
                (r.inclusionStatus === "NORMALIZED_DUPLICATE"
                  ? "NORMALIZED_DUPLICATE"
                  : !r.structuralEligible || r.inclusionStatus !== "INCLUDED"
                    ? "HARD_REJECTED"
                    : "BELOW_K"));
        ledger.push({ profile, eventId, candidateId: r.candidateId, reason });
      }
    }
  }
  const topK = c612TopKSchema.parse(
    artifact("machine-c6-1-2-top-k-candidate-set", {
      rankHash: audit.semanticHash,
      correlationHash: hash(
        identities.toSorted((a, b) =>
          a.candidateId.localeCompare(b.candidateId),
        ),
      ),
      k: 4,
      currentOccupiesAlternativeSlot: false,
      sets,
      uniqueCandidateIds: [
        ...new Set(
          sets.flatMap((s) => [s.currentCandidateId, ...s.alternativeIds]),
        ),
      ].sort(),
      runtimeGoldInputCount: 0,
    }),
  );
  const expectedCount = audit.rows.length * C612_RETRIEVAL.length;
  const uniqueCount = new Set(
    ledger.map((r) => hash([r.profile, r.eventId, r.candidateId])),
  ).size;
  const conservation = c612ConservationSchema.parse(
    artifact("machine-c6-1-2-top-k-conservation-ledger", {
      rankHash: audit.semanticHash,
      topKHash: topK.semanticHash,
      rows: ledger,
      accountedCount: uniqueCount,
      expectedCount,
      silentDropCount: Math.max(0, expectedCount - uniqueCount),
      passed: uniqueCount === expectedCount && ledger.length === expectedCount,
    }),
  );
  const profiles = C612_RETRIEVAL.map((profile) => {
    const ps = sets.filter((s) => s.profile === profile);
    let duplicateObservationSlots = 0;
    for (const s of ps) {
      const ids = s.alternativeIds
        .map((id) => identity.get(id)?.observationIdentity)
        .filter((x): x is string => !!x);
      duplicateObservationSlots += ids.length - new Set(ids).size;
    }
    return {
      profile,
      events: ps.length,
      current: ps.length,
      alternatives: ps.reduce((n, s) => n + s.alternativeIds.length, 0),
      bothProviders: ps.filter(
        (s) =>
          new Set(
            s.alternativeIds.map(
              (id) => c612Defined(candidates.get(id)).providerFamily,
            ),
          ).size === 2,
      ).length,
      availableBothProviders: ps.filter(
        (s) =>
          new Set(
            audit.rows
              .filter(
                (r) =>
                  r.eventId === s.eventId &&
                  !r.currentCandidate &&
                  r.structuralEligible,
              )
              .map((r) => r.candidateProvider),
          ).size === 2,
      ).length,
      duplicateObservationSlots,
    };
  });
  return {
    topK,
    conservation,
    comparison: c612TopKComparisonSchema.parse(
      artifact("machine-c6-1-2-top-k-profile-comparison", {
        topKHash: topK.semanticHash,
        profiles,
        runtimeGoldInputCount: 0,
      }),
    ),
  };
}
