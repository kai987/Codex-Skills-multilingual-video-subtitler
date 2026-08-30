import { c61Require } from "./japanese-text-representation.js";
import {
  c61PathValidationSchema,
  type C61LatticeNode,
  type C61PathValidation,
  type C61ProviderFamily,
  type C61TokenLattice,
} from "@mvl/shared";
import { machineQualitySemanticHash } from "../machine-quality/evidence-correlation.js";
export interface C61PathState {
  candidateId: string;
  providerFamily: C61ProviderFamily;
  candidateSwitchCount: number;
  providerSwitchCount: number;
  /** One candidate witness for every traversed edge, including sentinels. */
  sourceCandidateIds: string[];
}
function genuineEdgeSupport(
  lattice: C61TokenLattice,
  fromNode: string,
  toNode: string,
): string[] {
  const edge = lattice.edges.find(
    (x) => x.fromNode === fromNode && x.toNode === toNode,
  );
  if (!edge?.observedAdjacency) return [];
  return edge.supportingCandidateIds.filter((candidateId) =>
    lattice.candidatePaths.some(
      (path) =>
        path.candidateId === candidateId &&
        path.nodeIds.some(
          (nodeId, index) =>
            nodeId === fromNode && path.nodeIds[index + 1] === toNode,
        ),
    ),
  );
}
/**
 * Public legality automaton for decoders and the isolated exact legal-path oracle.
 * Staying on a candidate preserves every adjacency, including across EPSILON.
 * A change is possible only at a globally shared lexical anchor with the exact
 * same real display surface. Ambiguous runs therefore have one contiguous
 * candidate witness; normalization never authorizes an invented surface bridge.
 */
export function advanceC61PathStates(
  lattice: C61TokenLattice,
  nodeId: string,
  nextNodeId: string,
  states: C61PathState[],
): C61PathState[] {
  const node = lattice.nodes.find((x) => x.nodeId === nodeId);
  const nextNode = lattice.nodes.find((x) => x.nodeId === nextNodeId);
  if (
    !node ||
    !nextNode ||
    node.eventId !== lattice.eventId ||
    nextNode.eventId !== lattice.eventId ||
    nextNode.slotIndex !== node.slotIndex + 1
  )
    return [];
  const support = genuineEdgeSupport(lattice, nodeId, nextNodeId);
  const next: C61PathState[] = [];
  for (const candidateId of support) {
    const provenance = node.candidateProvenance.find(
      (x) => x.candidateId === candidateId,
    );
    if (
      !provenance ||
      !nextNode.candidateProvenance.some((x) => x.candidateId === candidateId)
    )
      continue;
    if (node.kind === "START" && states.length === 0) {
      next.push({
        candidateId,
        providerFamily: provenance.providerFamily,
        candidateSwitchCount: 0,
        providerSwitchCount: 0,
        sourceCandidateIds: [candidateId],
      });
      continue;
    }
    for (const state of states) {
      const changed = state.candidateId !== candidateId;
      const previousProvenance = node.candidateProvenance.find(
        (x) => x.candidateId === state.candidateId,
      );
      if (
        changed &&
        (!node.switchAllowed ||
          node.kind !== "TOKEN" ||
          previousProvenance?.displaySurface !== provenance.displaySurface)
      )
        continue;
      next.push({
        candidateId,
        providerFamily: provenance.providerFamily,
        candidateSwitchCount: state.candidateSwitchCount + Number(changed),
        providerSwitchCount:
          state.providerSwitchCount +
          Number(changed && state.providerFamily !== provenance.providerFamily),
        sourceCandidateIds: [...state.sourceCandidateIds, candidateId],
      });
    }
  }
  // Pareto preserve both counts: a same-provider chain switch is not a provider vote.
  const best = new Map<string, C61PathState>();
  for (const state of next.toSorted((a, b) =>
    a.sourceCandidateIds
      .join("\0")
      .localeCompare(b.sourceCandidateIds.join("\0")),
  )) {
    const key = `${state.candidateId}/${state.candidateSwitchCount}/${state.providerSwitchCount}`;
    if (!best.has(key)) best.set(key, state);
  }
  return [...best.values()].filter(
    (state, _index, all) =>
      !all.some(
        (other) =>
          other.candidateId === state.candidateId &&
          other.candidateSwitchCount <= state.candidateSwitchCount &&
          other.providerSwitchCount <= state.providerSwitchCount &&
          (other.candidateSwitchCount < state.candidateSwitchCount ||
            other.providerSwitchCount < state.providerSwitchCount),
      ),
  );
}
function nodeHasValidProvenance(node: C61LatticeNode): boolean {
  if (node.candidateProvenance.length === 0) return false;
  if (node.kind !== "TOKEN")
    return (
      node.displaySurfaces.length === 0 &&
      node.candidateProvenance.every(
        (x) => x.unitIndex === null && x.displaySurface === null,
      )
    );
  return (
    node.displaySurfaces.length > 0 &&
    node.displaySurfaces.every((surface) =>
      node.candidateProvenance.some(
        (x) =>
          x.displaySurface === surface &&
          x.unitIndex !== null &&
          /^[a-f0-9]{64}$/u.test(x.provenanceHash),
      ),
    ) &&
    node.candidateProvenance.every(
      (x) =>
        x.displaySurface !== null &&
        x.unitIndex !== null &&
        node.displaySurfaces.includes(x.displaySurface),
    )
  );
}
export function validateC61Path(
  lattice: C61TokenLattice,
  nodeIds: string[],
  options: {
    maxProviderSwitches?: number;
    enforceSpans?: boolean;
  } = {},
): C61PathValidation {
  const violations = {
    unsupportedTokenCount: 0,
    unsupportedAdjacencyCount: 0,
    crossEventTokenCount: 0,
    nonMonotonicPathCount: 0,
    pathCycleCount: 0,
    candidateProvenanceMissingCount: 0,
    providerSwitchLimitViolationCount: 0,
    spanSupportViolationCount: 0,
  };
  const reasons: string[] = [];
  const edgeIds: string[] = [];
  const seen = new Set<string>();
  if (
    nodeIds[0] !== lattice.startNodeId ||
    nodeIds.at(-1) !== lattice.endNodeId
  ) {
    violations.unsupportedAdjacencyCount += 1;
    reasons.push("MISSING_EVENT_SENTINEL");
  }
  for (const [index, nodeId] of nodeIds.entries()) {
    const node = lattice.nodes.find((x) => x.nodeId === nodeId);
    if (!node) {
      violations.unsupportedTokenCount += 1;
      continue;
    }
    if (seen.has(nodeId)) violations.pathCycleCount += 1;
    seen.add(nodeId);
    if (node.eventId !== lattice.eventId) violations.crossEventTokenCount += 1;
    if (!nodeHasValidProvenance(node))
      violations.candidateProvenanceMissingCount += 1;
    if (index === 0) continue;
    const previous = lattice.nodes.find((x) => x.nodeId === nodeIds[index - 1]);
    if (!previous || node.slotIndex !== previous.slotIndex + 1)
      violations.nonMonotonicPathCount += 1;
    const edge = lattice.edges.find(
      (x) => x.fromNode === nodeIds[index - 1] && x.toNode === nodeId,
    );
    if (
      !edge ||
      genuineEdgeSupport(lattice, c61Require(nodeIds[index - 1]), nodeId)
        .length === 0
    )
      violations.unsupportedAdjacencyCount += 1;
    else edgeIds.push(edge.edgeId);
  }
  let states: C61PathState[] = [];
  let failed = false;
  for (let index = 1; index < nodeIds.length; index += 1) {
    if (failed) break;
    states = advanceC61PathStates(
      lattice,
      c61Require(nodeIds[index - 1]),
      c61Require(nodeIds[index]),
      states,
    );
    failed = states.length === 0;
  }
  if (failed || states.length === 0) {
    violations.spanSupportViolationCount += 1;
    reasons.push("NO_CONTIGUOUS_CANDIDATE_SUPPORT_CHAIN");
  }
  const sorted = states.toSorted(
    (a, b) =>
      a.providerSwitchCount - b.providerSwitchCount ||
      a.candidateSwitchCount - b.candidateSwitchCount ||
      a.sourceCandidateIds
        .join("\0")
        .localeCompare(b.sourceCandidateIds.join("\0")),
  );
  const witness = sorted[0];
  if (
    witness &&
    options.maxProviderSwitches !== undefined &&
    witness.providerSwitchCount > options.maxProviderSwitches
  )
    violations.providerSwitchLimitViolationCount += 1;
  // enforceSpans=false does not relax the safe public path contract.
  const valid = Object.values(violations).every((value) => value === 0);
  for (const [name, value] of Object.entries(violations))
    if (value > 0) reasons.push(name);
  const body = {
    valid,
    status: valid
      ? ("LEGAL_PATH" as const)
      : ("UNSAFE_CONSENSUS_PATH_REJECTED" as const),
    reasons,
    providerSwitchCount: witness?.providerSwitchCount ?? 0,
    candidateSwitchCount: witness?.candidateSwitchCount ?? 0,
    sourceCandidateIds: witness?.sourceCandidateIds ?? [],
    edgeIds,
    violations,
  };
  return c61PathValidationSchema.parse({
    ...body,
    semanticHash: machineQualitySemanticHash(body),
  });
}
