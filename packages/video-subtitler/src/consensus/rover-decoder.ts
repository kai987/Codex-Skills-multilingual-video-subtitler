import type {
  C61CandidateText,
  C61ConfusionAlternative,
  C61ConfusionNetwork,
  C61RoverResult,
  C61RoverVariant,
  C61TokenLattice,
} from "@mvl/shared";
import { machineQualitySemanticHash } from "../machine-quality/evidence-correlation.js";
import {
  c61HypothesisWeights,
  c61RequiredDecoderValue,
  type C61AcousticEvidence,
} from "./candidate-correlation.js";
import { C61_DECODER_LIMITS } from "./c61-policy.js";
import {
  enumerateLegalPaths,
  materializeC61Path,
  type C61PathSearchOptions,
} from "./lattice-mbr.js";
const entropy = (weights: number[]): number => {
  const positive = weights.filter((weight) => weight > 0),
    total = positive.reduce((sum, weight) => sum + weight, 0);
  if (positive.length <= 1 || !total) return 0;
  return Math.min(
    1,
    -positive.reduce((sum, weight) => {
      const p = weight / total;
      return sum + p * Math.log(p);
    }, 0) / Math.log(positive.length),
  );
};
export function decodeRover(input: {
  candidates: readonly C61CandidateText[];
  lattice: C61TokenLattice;
  network: C61ConfusionNetwork;
  currentCandidateId: string | null;
  variant: C61RoverVariant;
  acousticEvidence?: readonly C61AcousticEvidence[];
  outputMode?: "EXISTING_CANDIDATE_ONLY" | "LEGAL_LATTICE_PATH";
  allowAmbiguousSlots?: boolean;
  minimumMargin?: number;
  searchOptions?: C61PathSearchOptions;
}): C61RoverResult {
  const { candidates, lattice, network, currentCandidateId, variant } = input;
  if (
    network.eventId !== lattice.eventId ||
    network.latticeHash !== lattice.semanticHash
  )
    throw new Error("ROVER requires the exact frozen event lattice/network.");
  if (candidates.some((candidate) => candidate.eventId !== lattice.eventId))
    throw new Error("ROVER cannot combine cross-event candidates.");
  const candidateSupport = c61HypothesisWeights(
    candidates,
    variant === "R3" ? "R2" : variant,
    input.acousticEvidence,
  );
  const weightById = new Map(
    candidateSupport.map((row) => [row.candidateId, row]),
  );
  const candidateById = new Map(
    candidates.map((candidate) => [candidate.candidateId, candidate]),
  );
  const slotDecisions: C61RoverResult["slotDecisions"] = [...network.slots]
    .sort((a, b) => a.position - b.position)
    .map((slot) => {
      const alternatives = [
        ...new Map(
          [
            ...slot.alternatives,
            ...(slot.epsilonAlternative ? [slot.epsilonAlternative] : []),
          ].map((alternative) => [alternative.nodeId, alternative]),
        ).values(),
      ].sort((a, b) => a.nodeId.localeCompare(b.nodeId));
      const voteFor = (alternative: C61ConfusionAlternative): number =>
        [...new Set(alternative.candidateIds)].reduce((sum, id) => {
          const weight = weightById.get(id)?.normalizedHypothesisWeight ?? 0;
          if (variant !== "R3") return sum + weight;
          const family = candidateById.get(id)?.providerFamily;
          const peers = candidates.filter(
            (candidate) => candidate.providerFamily === family,
          );
          const matching = peers.filter((candidate) =>
            alternative.candidateIds.includes(candidate.candidateId),
          );
          return (
            sum +
            weight *
              (0.75 + (0.25 * matching.length) / Math.max(1, peers.length))
          );
        }, 0);
      const scored = alternatives.map((alternative) => ({
        alternative,
        weight: voteFor(alternative),
      }));
      const groups = new Map<string, typeof scored>();
      for (const row of scored) {
        const group =
          variant === "R4" && row.alternative.pronunciationForm
            ? `reading:${row.alternative.pronunciationForm}`
            : `node:${row.alternative.nodeId}`;
        groups.set(group, [...(groups.get(group) ?? []), row]);
      }
      const ranked = [...groups.entries()]
        .map(([key, rows]) => ({
          key,
          rows,
          weight: rows.reduce((sum, row) => sum + row.weight, 0),
        }))
        .sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key));
      const total = ranked.reduce((sum, group) => sum + group.weight, 0);
      const first = ranked[0],
        second = ranked[1];
      const margin = total
        ? Math.max(0, ((first?.weight ?? 0) - (second?.weight ?? 0)) / total)
        : 0;
      const status = !total
        ? "ABSTAIN"
        : second &&
            Math.abs(c61RequiredDecoderValue(first).weight - second.weight) <=
              1e-12
          ? "TIE"
          : second && margin < C61_DECODER_LIMITS.slotMinimumVoteMargin
            ? "ABSTAIN"
            : "WINNER";
      return {
        slotId: slot.slotId,
        position: slot.position,
        status,
        winnerNodeIds:
          status === "WINNER"
            ? c61RequiredDecoderValue(first)
                .rows.map((row) => row.alternative.nodeId)
                .sort()
            : [],
        alternatives: scored.map(({ alternative, weight }) => ({
          nodeId: alternative.nodeId,
          voteWeight: weight,
          pronunciationAggregatedWeight: c61RequiredDecoderValue(
            ranked.find((group) =>
              group.rows.some(
                (row) => row.alternative.nodeId === alternative.nodeId,
              ),
            ),
          ).weight,
          rawCandidateSupport: alternative.candidateIds.reduce(
            (sum, id) => sum + (weightById.get(id)?.rawCandidateSupport ?? 0),
            0,
          ),
          correlatedGroupSupport: new Set(alternative.correlationGroupIds).size,
          providerFamilySupport: new Set(
            alternative.providerFamilies.filter(
              (family) => family !== "CURRENT",
            ),
          ).size,
        })),
        normalizedEntropy: entropy(ranked.map((group) => group.weight)),
        normalizedVoteMargin: Math.min(1, margin),
        acousticEvidenceIds: [
          ...new Set(
            alternatives.flatMap((alternative) =>
              alternative.candidateIds
                .map((id) => weightById.get(id)?.acousticEvidenceId)
                .filter((id): id is string => Boolean(id)),
            ),
          ),
        ].sort(),
        reasons: [
          status === "WINNER" ? "SUPPORTED_SLOT_WINNER" : "AMBIGUOUS_SLOT",
          ...(variant === "R4" && (first?.rows.length ?? 0) > 1
            ? ["PRONUNCIATION_AGGREGATED_SURFACE_REQUIRES_LEGAL_CONTINUATION"]
            : []),
          ...(variant === "R5" &&
          !alternatives.some((alternative) =>
            alternative.candidateIds.some(
              (id) =>
                weightById.get(id)?.acousticStatus === "EXACT_CACHE_MATCH",
            ),
          )
            ? ["ACOUSTIC_CACHE_UNKNOWN_NO_REWEIGHT"]
            : []),
        ],
      };
    });
  const ambiguous = slotDecisions.filter((slot) => slot.status !== "WINNER");
  let ambiguousSpanCount = 0;
  for (let i = 0; i < ambiguous.length; i++)
    if (
      i === 0 ||
      c61RequiredDecoderValue(ambiguous[i]).position !==
        c61RequiredDecoderValue(ambiguous[i - 1]).position + 1
    )
      ambiguousSpanCount++;
  const current = lattice.candidatePaths.find(
    (path) => path.candidateId === currentCandidateId,
  );
  const fallback = current
    ? materializeC61Path(
        lattice,
        current.nodeIds,
        candidates,
        currentCandidateId,
      )
    : null;
  const single =
    new Set(candidates.map((candidate) => candidate.normalizedText)).size <= 1;
  const enumerated = enumerateLegalPaths(lattice, candidates, {
    ...input.searchOptions,
    weights: candidateSupport,
  });
  const choices = enumerated.paths
    .filter(
      (nodes) =>
        input.outputMode !== "EXISTING_CANDIDATE_ONLY" ||
        lattice.candidatePaths.some(
          (path) => path.nodeIds.join("\u0000") === nodes.join("\u0000"),
        ),
    )
    .flatMap((nodeIds) => {
      const selected = materializeC61Path(
        lattice,
        nodeIds,
        candidates,
        currentCandidateId,
        enumerated.search.maxProviderSwitches,
      );
      if (!selected) return [];
      const contains = new Set(nodeIds);
      if (
        slotDecisions.some(
          (slot) =>
            slot.status === "WINNER" &&
            !slot.winnerNodeIds.some((id) => contains.has(id)),
        )
      )
        return [];
      const score =
        slotDecisions.reduce((sum, slot) => {
          const entry = slot.alternatives.find((alternative) =>
            contains.has(alternative.nodeId),
          );
          return (
            sum +
            (variant === "R4"
              ? (entry?.pronunciationAggregatedWeight ?? 0)
              : (entry?.voteWeight ?? 0))
          );
        }, 0) /
          Math.max(1, slotDecisions.length) -
        selected.providerSwitchCount * C61_DECODER_LIMITS.providerSwitchPenalty;
      return [{ path: selected, score }];
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.path.semanticHash.localeCompare(b.path.semanticHash),
    );
  const best = choices[0],
    runner = choices.find(
      (choice) => choice.path.normalizedText !== best?.path.normalizedText,
    );
  const margin = best && runner ? Math.max(0, best.score - runner.score) : null;
  const abstain =
    !single &&
    ((ambiguous.length > 0 && !input.allowAmbiguousSlots) ||
      (margin !== null &&
        margin <=
          (input.minimumMargin ?? C61_DECODER_LIMITS.pathMinimumRiskMargin)));
  const selectedPath = single
    ? (fallback ?? best?.path ?? null)
    : abstain || !best
      ? fallback
      : best.path;
  const outcome = single
    ? "SINGLE_HYPOTHESIS_NO_ACTION"
    : abstain
      ? "ABSTAIN_AMBIGUOUS"
      : !best
        ? "BLOCKED_UNSAFE"
        : selectedPath?.displayText ===
            candidates.find(
              (candidate) => candidate.candidateId === currentCandidateId,
            )?.displayText
          ? "KEEP_CURRENT"
          : selectedPath?.pathKind === "NOVEL_LEGAL_PATH"
            ? "SELECT_LEGAL_CONSENSUS_PATH"
            : "SELECT_EXISTING_CANDIDATE";
  const value: Omit<C61RoverResult, "semanticHash"> = {
    eventId: lattice.eventId,
    variant,
    outputMode:
      abstain || !best
        ? "ABSTAIN_PRESERVE_CURRENT"
        : (input.outputMode ?? "LEGAL_LATTICE_PATH"),
    outcome,
    selectedPath,
    slotDecisions,
    abstainedSlots: ambiguous.map((slot) => slot.slotId),
    candidateSupport,
    providerSwitchCount: selectedPath?.providerSwitchCount ?? 0,
    pathLegal: selectedPath?.pathLegal ?? false,
    provenanceComplete: selectedPath?.provenanceComplete ?? false,
    ambiguousSlotCount: ambiguous.length,
    ambiguousSpanCount,
    normalizedEntropy:
      slotDecisions.reduce((sum, slot) => sum + slot.normalizedEntropy, 0) /
      Math.max(1, slotDecisions.length),
    providerDisagreement:
      network.slots.filter(
        (slot) =>
          new Set(
            [
              ...slot.alternatives,
              ...(slot.epsilonAlternative ? [slot.epsilonAlternative] : []),
            ]
              .filter((alternative) =>
                alternative.providerFamilies.some(
                  (family) => family !== "CURRENT",
                ),
              )
              .map((alternative) => alternative.normalizedForm),
          ).size > 1,
      ).length / Math.max(1, network.slots.length),
    pathRiskMargin: margin,
    reasons: [
      single
        ? "ONE_NORMALIZED_HYPOTHESIS"
        : abstain
          ? "UNCERTAINTY_PRESERVE_CURRENT"
          : !best
            ? "SLOT_WINNERS_HAVE_NO_SUPPORTED_LEGAL_CONTINUATION"
            : "SLOT_VOTE_WITH_LEGAL_PATH_VALIDATION",
      "CURRENT_IS_NOT_AN_INDEPENDENT_ASR_VOTE",
    ],
    search: enumerated.search,
  };
  return { ...value, semanticHash: machineQualitySemanticHash(value) };
}
