import type {
  C61CandidateText,
  C61DistanceMethod,
  C61HypothesisWeight,
  C61LatticeMbrResult,
  C61NBestSearch,
  C61SelectedPath,
  C61TokenLattice,
} from "@mvl/shared";
import { machineQualitySemanticHash } from "../machine-quality/evidence-correlation.js";
import {
  c61HypothesisWeights,
  c61RequiredDecoderValue,
} from "./candidate-correlation.js";
import { c61ExpectedRisk } from "./candidate-mbr.js";
import { C61_DECODER_LIMITS } from "./c61-policy.js";
import {
  advanceC61PathStates,
  validateC61Path,
  type C61PathState,
} from "./legal-path-validator.js";
import { restoreC61Surface } from "./surface-restoration.js";
export interface C61PathSearchOptions {
  beamWidth?: number;
  maxPaths?: number;
  maxProviderSwitches?: number | null;
  maxPathLength?: number;
  weights?: readonly C61HypothesisWeight[];
}
export function materializeC61Path(
  lattice: C61TokenLattice,
  nodeIds: string[],
  candidates: readonly C61CandidateText[],
  currentCandidateId: string | null,
  maxProviderSwitches: number | null = C61_DECODER_LIMITS.maxProviderSwitches,
  preferredSurfaceCandidateId?: string,
): C61SelectedPath | null {
  const validation = validateC61Path(
    lattice,
    nodeIds,
    maxProviderSwitches === null
      ? { enforceSpans: true }
      : { enforceSpans: true, maxProviderSwitches },
  );
  if (!validation.valid) return null;
  const surface = restoreC61Surface(
    lattice,
    nodeIds,
    preferredSurfaceCandidateId ?? currentCandidateId ?? undefined,
  );
  const equivalent = candidates
    .filter((candidate) => candidate.normalizedText === surface.normalizedText)
    .map((candidate) => candidate.candidateId)
    .sort();
  const byId = new Map(lattice.nodes.map((node) => [node.nodeId, node]));
  const tokens = nodeIds
    .map((id) => c61RequiredDecoderValue(byId.get(id)))
    .filter((node) => node.kind === "TOKEN");
  const exactMatches = candidates.filter(
    (candidate) => candidate.displayText === surface.displayText,
  );
  const exact =
    exactMatches.find(
      (candidate) => candidate.candidateId === currentCandidateId,
    ) ??
    exactMatches.sort((a, b) => a.candidateId.localeCompare(b.candidateId))[0];
  const pronunciationText =
    exact?.pronunciationText ??
    (tokens.every((node) => node.pronunciationForm !== null)
      ? tokens.map((node) => node.pronunciationForm).join("")
      : null);
  const value: Omit<C61SelectedPath, "semanticHash"> = {
    nodeIds,
    edgeIds: validation.edgeIds,
    displayText: surface.displayText,
    normalizedText: surface.normalizedText,
    pronunciationText,
    sourceCandidateIds: [...new Set(surface.sourceCandidateIds)].sort(),
    equivalentCandidateIds: equivalent,
    providerSwitchCount: validation.providerSwitchCount,
    candidateSwitchCount: validation.candidateSwitchCount,
    pathLegal: true,
    provenanceComplete: surface.tokenProvenance.every((token) =>
      Boolean(token.provenanceHash),
    ),
    pathKind:
      exact?.candidateId === currentCandidateId
        ? "CURRENT_CONTROL_PATH"
        : exact !== undefined
          ? "EXISTING_CANDIDATE_PATH"
          : "NOVEL_LEGAL_PATH",
  };
  return { ...value, semanticHash: machineQualitySemanticHash(value) };
}
interface SearchState {
  nodeIds: string[];
  chain: C61PathState | null;
  score: number;
}
/** Deterministic bounded enumeration of the supported candidate-chain automaton, not slot Cartesian products. */
export function enumerateLegalPaths(
  lattice: C61TokenLattice,
  candidates: readonly C61CandidateText[],
  options: C61PathSearchOptions = {},
): {
  paths: string[][];
  search: C61NBestSearch;
} {
  const beamWidth = options.beamWidth ?? C61_DECODER_LIMITS.beamWidth;
  const maxPaths = options.maxPaths ?? C61_DECODER_LIMITS.maxPaths;
  const maxPathLength =
    options.maxPathLength ?? C61_DECODER_LIMITS.maxPathLength;
  const maxProviderSwitches =
    options.maxProviderSwitches === undefined
      ? C61_DECODER_LIMITS.maxProviderSwitches
      : options.maxProviderSwitches;
  if (
    ![beamWidth, maxPaths, maxPathLength].every(
      (limit) => Number.isInteger(limit) && limit > 0,
    ) ||
    (maxProviderSwitches !== null &&
      (!Number.isInteger(maxProviderSwitches) || maxProviderSwitches < 0))
  )
    throw new Error("Invalid bounded lattice search limits.");
  if (candidates.some((candidate) => candidate.eventId !== lattice.eventId))
    throw new Error("Cross-event hypothesis cannot enter lattice search.");
  const nodes = new Map(lattice.nodes.map((node) => [node.nodeId, node]));
  const weights = new Map(
    (options.weights ?? c61HypothesisWeights(candidates)).map((entry) => [
      entry.candidateId,
      entry.normalizedHypothesisWeight,
    ]),
  );
  const outgoing = new Map<string, typeof lattice.edges>();
  for (const edge of lattice.edges)
    outgoing.set(edge.fromNode, [...(outgoing.get(edge.fromNode) ?? []), edge]);
  for (const edges of outgoing.values())
    edges.sort((a, b) => a.edgeId.localeCompare(b.edgeId));
  let frontier: SearchState[] = [
    { nodeIds: [lattice.startNodeId], chain: null, score: 0 },
  ];
  let visitedStateCount = 0,
    beamPrunedStateCount = 0,
    lengthRejectedCount = 0,
    unsafeRejectedCount = 0;
  const terminals = new Map<string, SearchState>();
  const key = (state: SearchState): string => state.nodeIds.join("\u0000");
  const compare = (a: SearchState, b: SearchState): number =>
    b.score - a.score ||
    (a.chain?.providerSwitchCount ?? 0) - (b.chain?.providerSwitchCount ?? 0) ||
    (a.chain?.candidateSwitchCount ?? 0) -
      (b.chain?.candidateSwitchCount ?? 0) ||
    key(a).localeCompare(key(b)) ||
    (a.chain?.candidateId ?? "").localeCompare(b.chain?.candidateId ?? "");
  for (let depth = 0; frontier.length && depth <= maxPathLength + 1; depth++) {
    const next = new Map<string, SearchState>();
    for (const state of frontier) {
      const from = nodes.get(c61RequiredDecoderValue(state.nodeIds.at(-1)));
      if (!from) {
        unsafeRejectedCount++;
        continue;
      }
      if (from.nodeId === lattice.endNodeId) {
        const old = terminals.get(key(state));
        if (!old || compare(state, old) < 0) terminals.set(key(state), state);
        continue;
      }
      for (const edge of outgoing.get(from.nodeId) ?? []) {
        const target = nodes.get(edge.toNode);
        if (
          target?.eventId !== lattice.eventId ||
          target.slotIndex <= from.slotIndex ||
          state.nodeIds.includes(target.nodeId)
        ) {
          unsafeRejectedCount++;
          continue;
        }
        if (target.kind !== "END" && state.nodeIds.length > maxPathLength) {
          lengthRejectedCount++;
          continue;
        }
        for (const chain of advanceC61PathStates(
          lattice,
          from.nodeId,
          target.nodeId,
          state.chain ? [state.chain] : [],
        )) {
          if (
            maxProviderSwitches !== null &&
            chain.providerSwitchCount > maxProviderSwitches
          )
            continue;
          visitedStateCount++;
          const support = [
            ...new Set(
              target.candidateProvenance.map((entry) => entry.candidateId),
            ),
          ].reduce((sum, id) => sum + (weights.get(id) ?? 0), 0);
          const proposed: SearchState = {
            nodeIds: [...state.nodeIds, target.nodeId],
            chain,
            score:
              state.score +
              (target.kind === "END" ? 0 : Math.log(Math.max(1e-12, support))),
          };
          const signature = `${key(proposed)}\u0001${chain.candidateId}/${chain.providerSwitchCount}/${chain.candidateSwitchCount}`;
          const previous = next.get(signature);
          if (!previous || compare(proposed, previous) < 0)
            next.set(signature, proposed);
        }
      }
    }
    const states = [...next.values()].sort(compare);
    if (states.length > beamWidth)
      beamPrunedStateCount += states.length - beamWidth;
    frontier = states.slice(0, beamWidth);
  }
  const validTerminals = [...terminals.values()]
    .sort(compare)
    .filter((state) => {
      const validation = validateC61Path(
        lattice,
        state.nodeIds,
        maxProviderSwitches === null
          ? { enforceSpans: true }
          : { enforceSpans: true, maxProviderSwitches },
      );
      if (!validation.valid) unsafeRejectedCount++;
      return validation.valid;
    })
    .map((state) => state.nodeIds);
  const seeds = [...lattice.candidatePaths]
    .sort((a, b) => a.candidateId.localeCompare(b.candidateId))
    .filter(
      (entry) =>
        entry.nodeIds.length <= maxPathLength + 2 &&
        validateC61Path(
          lattice,
          entry.nodeIds,
          maxProviderSwitches === null
            ? { enforceSpans: true }
            : { enforceSpans: true, maxProviderSwitches },
        ).valid,
    );
  const allPaths = [
    ...new Map(
      [...seeds.map((entry) => entry.nodeIds), ...validTerminals].map(
        (path) => [path.join("\u0000"), path],
      ),
    ).values(),
  ];
  const maxPathsTruncatedCount = Math.max(0, allPaths.length - maxPaths);
  const paths = allPaths
    .slice(0, maxPaths)
    .sort((a, b) => a.join("\u0000").localeCompare(b.join("\u0000")));
  const exhaustiveWithinConstraints =
    beamPrunedStateCount === 0 && maxPathsTruncatedCount === 0;
  const value: Omit<C61NBestSearch, "semanticHash"> = {
    algorithm: exhaustiveWithinConstraints
      ? "EXACT_LATTICE_MBR"
      : "APPROXIMATE_LATTICE_MBR",
    beamWidth,
    maxPaths,
    maxProviderSwitches,
    maxPathLength,
    visitedStateCount,
    beamPrunedStateCount,
    maxPathsTruncatedCount,
    lengthRejectedCount,
    unsafeRejectedCount,
    candidatePathsSeeded: seeds.filter((entry) =>
      paths.some(
        (path) => path.join("\u0000") === entry.nodeIds.join("\u0000"),
      ),
    ).length,
    exhaustiveWithinConstraints,
  };
  return {
    paths,
    search: { ...value, semanticHash: machineQualitySemanticHash(value) },
  };
}
export function latticeMbr(input: {
  candidates: readonly C61CandidateText[];
  lattice: C61TokenLattice;
  currentCandidateId: string | null;
  distanceMethod?: C61DistanceMethod;
  minimumMargin?: number;
  searchOptions?: C61PathSearchOptions;
}): C61LatticeMbrResult {
  const { candidates, lattice, currentCandidateId } = input;
  const distanceMethod = input.distanceMethod ?? "COMBINED";
  const weights = c61HypothesisWeights(candidates, "R3");
  const enumerated = enumerateLegalPaths(lattice, candidates, {
    ...input.searchOptions,
    weights,
  });
  const byId = new Map(lattice.nodes.map((node) => [node.nodeId, node]));
  const nBestPaths = enumerated.paths
    .flatMap((nodeIds) => {
      const path = materializeC61Path(
        lattice,
        nodeIds,
        candidates,
        currentCandidateId,
        enumerated.search.maxProviderSwitches,
      );
      if (!path) return [];
      const risk = c61ExpectedRisk(path, candidates, weights, distanceMethod);
      const providerSwitchPenalty =
        path.providerSwitchCount * C61_DECODER_LIMITS.providerSwitchPenalty;
      const epsilonComplexityPenalty =
        nodeIds.filter((id) => byId.get(id)?.kind === "EPSILON").length *
        C61_DECODER_LIMITS.epsilonComplexityPenalty;
      return [
        {
          path,
          ...risk,
          providerSwitchPenalty,
          epsilonComplexityPenalty,
          totalRisk:
            risk.expectedNormalizedDistance +
            providerSwitchPenalty +
            epsilonComplexityPenalty,
        },
      ];
    })
    .sort(
      (a, b) =>
        a.totalRisk - b.totalRisk ||
        a.path.semanticHash.localeCompare(b.path.semanticHash),
    );
  const best = nBestPaths[0];
  const runner = nBestPaths.find(
    (entry) => entry.path.normalizedText !== best?.path.normalizedText,
  );
  const margin =
    best && runner ? Math.max(0, runner.totalRisk - best.totalRisk) : null;
  const single =
    new Set(candidates.map((candidate) => candidate.normalizedText)).size <= 1;
  const ambiguous =
    !single &&
    margin !== null &&
    margin <= (input.minimumMargin ?? C61_DECODER_LIMITS.pathMinimumRiskMargin);
  const current = lattice.candidatePaths.find(
    (entry) => entry.candidateId === currentCandidateId,
  );
  const fallback = current
    ? materializeC61Path(
        lattice,
        current.nodeIds,
        candidates,
        currentCandidateId,
      )
    : null;
  const selectedPath = single
    ? (fallback ?? best?.path ?? null)
    : ambiguous || !best
      ? fallback
      : best.path;
  const outcome = !best
    ? "BLOCKED_UNSAFE"
    : single
      ? "SINGLE_HYPOTHESIS_NO_ACTION"
      : ambiguous
        ? "ABSTAIN_AMBIGUOUS"
        : selectedPath?.displayText ===
            candidates.find(
              (candidate) => candidate.candidateId === currentCandidateId,
            )?.displayText
          ? "KEEP_CURRENT"
          : selectedPath?.pathKind === "NOVEL_LEGAL_PATH"
            ? "SELECT_LEGAL_CONSENSUS_PATH"
            : "SELECT_EXISTING_CANDIDATE";
  const value = {
    eventId: lattice.eventId,
    distanceMethod,
    outcome,
    selectedPath,
    nBestPaths,
    weights,
    pathRiskMargin: margin,
    search: enumerated.search,
    reasons: [
      !best
        ? "NO_LEGAL_PATH_PRESERVE_CURRENT_EXTERNALLY"
        : single
          ? "ONE_NORMALIZED_HYPOTHESIS"
          : ambiguous
            ? "LOW_PATH_RISK_MARGIN_PRESERVE_CURRENT"
            : "MINIMUM_EXPECTED_LEGAL_PATH_RISK",
      enumerated.search.algorithm,
      "REAL_HYPOTHESIS_REFERENCE_DISTRIBUTION_ONLY",
    ],
  } as const;
  return {
    ...value,
    reasons: [...value.reasons],
    semanticHash: machineQualitySemanticHash(value),
  };
}
