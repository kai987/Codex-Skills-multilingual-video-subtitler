import {
  c61ConfusionNetworkSchema,
  type C61ConfusionAlternative,
  type C61ConfusionNetwork,
  type C61LatticeNode,
  type C61TokenLattice,
} from "@mvl/shared";
import { machineQualitySemanticHash } from "../machine-quality/evidence-correlation.js";

function alternative(
  lattice: C61TokenLattice,
  node: C61LatticeNode,
): C61ConfusionAlternative {
  return {
    nodeId: node.nodeId,
    displaySurface: node.displaySurfaces[0] ?? null,
    normalizedForm: node.normalizedForm,
    pronunciationForm: node.pronunciationForm,
    candidateIds: node.candidateProvenance.map((p) => p.candidateId),
    providerFamilies: node.providerFamilies,
    correlationGroupIds: node.correlationGroups,
    incomingEdges: lattice.edges
      .filter((edge) => edge.toNode === node.nodeId)
      .map((edge) => edge.edgeId)
      .sort(),
    outgoingEdges: lattice.edges
      .filter((edge) => edge.fromNode === node.nodeId)
      .map((edge) => edge.edgeId)
      .sort(),
  };
}

export function buildC61ConfusionNetwork(
  lattice: C61TokenLattice,
): C61ConfusionNetwork {
  const positions = [
    ...new Set(
      lattice.nodes
        .filter((node) => node.kind === "TOKEN" || node.kind === "EPSILON")
        .map((node) => node.slotIndex),
    ),
  ].sort((a, b) => a - b);
  const slots = positions.map((position) => {
    const nodes = lattice.nodes.filter((node) => node.slotIndex === position);
    const surfaces = [
      ...new Set(nodes.flatMap((node) => node.displaySurfaces)),
    ].sort();
    const pronunciations = [
      ...new Set(
        nodes.flatMap((node) =>
          node.pronunciationForm === null ? [] : [node.pronunciationForm],
        ),
      ),
    ].sort();
    const candidateSupportCount = new Set(
      nodes.flatMap((node) =>
        node.candidateProvenance.map((p) => p.candidateId),
      ),
    ).size;
    const probabilities = nodes.map(
      (node) => node.candidateProvenance.length / candidateSupportCount,
    );
    const normalizedEntropy =
      nodes.length < 2
        ? 0
        : Math.min(
            1,
            -probabilities.reduce((sum, p) => sum + p * Math.log(p), 0) /
              Math.log(nodes.length),
          );
    const epsilon = nodes.find((node) => node.kind === "EPSILON");
    const ambiguityStatus =
      nodes.length === 1
        ? surfaces.length === 1
          ? ("EXACT_AGREEMENT" as const)
          : ("NORMALIZED_AGREEMENT" as const)
        : !epsilon &&
            pronunciations.length === 1 &&
            nodes.every((node) => node.pronunciationForm !== null)
          ? ("PRONUNCIATION_EQUIVALENT" as const)
          : ("LEXICAL_DISAGREEMENT" as const);
    const slotBody = {
      slotId: `slot-${machineQualitySemanticHash({ eventId: lattice.eventId, position }).slice(0, 24)}`,
      eventId: lattice.eventId,
      position,
      alternatives: nodes
        .filter((node) => node.kind === "TOKEN")
        .map((node) => alternative(lattice, node)),
      epsilonAlternative: epsilon ? alternative(lattice, epsilon) : null,
      candidateSupportCount,
      providerSupportCount: new Set(
        nodes.flatMap((node) =>
          node.providerFamilies.filter((provider) => provider !== "CURRENT"),
        ),
      ).size,
      correlationGroupSupportCount: new Set(
        nodes.flatMap((node) =>
          node.candidateProvenance
            .filter((p) => p.providerFamily !== "CURRENT")
            .map((p) => p.correlationGroupId),
        ),
      ).size,
      surfaceVariants: surfaces,
      pronunciationVariants: pronunciations,
      acousticEvidence: [],
      stabilityEvidence: [],
      normalizedEntropy,
      ambiguityStatus,
    };
    return { ...slotBody, semanticHash: machineQualitySemanticHash(slotBody) };
  });
  const body = {
    eventId: lattice.eventId,
    latticeHash: lattice.semanticHash,
    slots,
  };
  return c61ConfusionNetworkSchema.parse({
    ...body,
    semanticHash: machineQualitySemanticHash(body),
  });
}
