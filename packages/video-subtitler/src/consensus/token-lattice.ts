import { c61Defined, c61Require } from "./japanese-text-representation.js";
import {
  c61TokenLatticeSchema,
  type C61LatticeNode,
  type C61MultipleAlignment,
  type C61TextRepresentation,
  type C61TokenLattice,
} from "@mvl/shared";
import { machineQualitySemanticHash } from "../machine-quality/evidence-correlation.js";
export function buildC61TokenLattice(
  alignment: C61MultipleAlignment,
  representations: C61TextRepresentation[],
): C61TokenLattice {
  const byId = new Map(
    representations.map((x) => [x.candidate.candidateId, x]),
  );
  if (
    alignment.rows.some(
      (row) =>
        !byId.has(row.candidateId) ||
        c61Require(byId.get(row.candidateId)).candidate.eventId !==
          alignment.eventId,
    )
  )
    throw new Error("C61_LATTICE_CANDIDATE_MISMATCH");
  const nodes: C61LatticeNode[] = [];
  const paths = new Map(
    alignment.rows.map((row) => [row.candidateId, [] as string[]]),
  );
  for (let slotIndex = -1; slotIndex <= alignment.slotCount; slotIndex += 1) {
    const sentinel =
      slotIndex === -1
        ? "START"
        : slotIndex === alignment.slotCount
          ? "END"
          : null;
    const groups = new Map<string, C61LatticeNode["candidateProvenance"]>();
    for (const row of alignment.rows) {
      const representation = c61Require(byId.get(row.candidateId));
      const unitIndex = sentinel
        ? null
        : c61Defined(row.unitIndices[slotIndex]);
      const unit =
        unitIndex === null ? null : c61Require(representation.units[unitIndex]);
      const key =
        sentinel ??
        (unit === null ? "EPSILON" : `TOKEN:${unit.normalizedForm}`);
      const provenance = groups.get(key) ?? [];
      provenance.push({
        candidateId: row.candidateId,
        unitIndex,
        displaySurface: unit?.displaySurface ?? null,
        providerFamily: representation.candidate.providerFamily,
        correlationGroupId: representation.candidate.correlationGroupId,
        provenanceHash: representation.candidate.provenanceHash,
      });
      groups.set(key, provenance);
    }
    for (const [key, unsortedProvenance] of [...groups.entries()].sort(
      ([a], [b]) => a.localeCompare(b),
    )) {
      const candidateProvenance = unsortedProvenance.toSorted((a, b) =>
        a.candidateId.localeCompare(b.candidateId),
      );
      const kind: C61LatticeNode["kind"] =
        sentinel ?? (key === "EPSILON" ? "EPSILON" : "TOKEN");
      const readings = candidateProvenance.map((p) =>
        p.unitIndex === null
          ? null
          : c61Require(c61Require(byId.get(p.candidateId)).units[p.unitIndex])
              .pronunciationForm,
      );
      const nodeBody = {
        eventId: alignment.eventId,
        slotIndex,
        kind,
        displaySurfaces: [
          ...new Set(
            candidateProvenance.flatMap((p) =>
              p.displaySurface === null ? [] : [p.displaySurface],
            ),
          ),
        ].sort(),
        normalizedForm: kind === "TOKEN" ? key.slice(6) : null,
        pronunciationForm:
          readings[0] !== null &&
          readings.every((reading) => reading === readings[0])
            ? c61Require(readings[0])
            : null,
        candidateProvenance,
        providerFamilies: [
          ...new Set(candidateProvenance.map((p) => p.providerFamily)),
        ].sort(),
        correlationGroups: [
          ...new Set(candidateProvenance.map((p) => p.correlationGroupId)),
        ].sort(),
        epsilonAllowed: kind === "EPSILON",
        switchAllowed: kind === "TOKEN" && groups.size === 1,
      };
      const nodeId = `node-${machineQualitySemanticHash(nodeBody).slice(0, 24)}`;
      const body = { nodeId, ...nodeBody };
      nodes.push({ ...body, semanticHash: machineQualitySemanticHash(body) });
      for (const provenance of candidateProvenance)
        c61Require(paths.get(provenance.candidateId)).push(nodeId);
    }
  }
  const candidatePaths = [...paths.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([candidateId, nodeIds]) => ({ candidateId, nodeIds }));
  const edgeSupport = new Map<
    string,
    {
      fromNode: string;
      toNode: string;
      supportingCandidateIds: string[];
    }
  >();
  for (const path of candidatePaths)
    for (let index = 1; index < path.nodeIds.length; index += 1) {
      const fromNode = c61Require(path.nodeIds[index - 1]);
      const toNode = c61Require(path.nodeIds[index]);
      const key = `${fromNode}/${toNode}`;
      const edge = edgeSupport.get(key) ?? {
        fromNode,
        toNode,
        supportingCandidateIds: [],
      };
      edge.supportingCandidateIds.push(path.candidateId);
      edgeSupport.set(key, edge);
    }
  const edges = [...edgeSupport.values()]
    .map((edge) => {
      const edgeBody = {
        ...edge,
        providerFamilies: [
          ...new Set(
            edge.supportingCandidateIds.map(
              (id) => c61Require(byId.get(id)).candidate.providerFamily,
            ),
          ),
        ].sort(),
        correlationGroups: [
          ...new Set(
            edge.supportingCandidateIds.map(
              (id) => c61Require(byId.get(id)).candidate.correlationGroupId,
            ),
          ),
        ].sort(),
        observedAdjacency: true as const,
      };
      const body = {
        edgeId: `edge-${machineQualitySemanticHash(edgeBody).slice(0, 24)}`,
        ...edgeBody,
      };
      return { ...body, semanticHash: machineQualitySemanticHash(body) };
    })
    .sort((a, b) => a.edgeId.localeCompare(b.edgeId));
  const intervals = representations.map((x) => x.candidate.sourceInterval);
  const body = {
    eventId: alignment.eventId,
    sourceInterval: {
      start: Math.min(...intervals.map((x) => x.start)),
      end: Math.max(...intervals.map((x) => x.end)),
    },
    alignmentHash: alignment.semanticHash,
    nodes,
    edges,
    candidatePaths,
    startNodeId: c61Require(nodes.find((x) => x.kind === "START")).nodeId,
    endNodeId: c61Require(nodes.find((x) => x.kind === "END")).nodeId,
  };
  return c61TokenLatticeSchema.parse({
    ...body,
    semanticHash: machineQualitySemanticHash(body),
  });
}
