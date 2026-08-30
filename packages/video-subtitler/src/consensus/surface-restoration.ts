import { c61Require } from "./japanese-text-representation.js";
import {
  c61SurfaceRestorationSchema,
  type C61SurfaceRestoration,
  type C61TokenLattice,
} from "@mvl/shared";
import { machineQualitySemanticHash } from "../machine-quality/evidence-correlation.js";
import { normalizeC61Japanese } from "./japanese-text-representation.js";
import { validateC61Path } from "./legal-path-validator.js";
export function restoreC61Surface(
  lattice: C61TokenLattice,
  nodeIds: string[],
  currentCandidateId?: string,
): C61SurfaceRestoration {
  const validation = validateC61Path(lattice, nodeIds);
  if (!validation.valid) throw new Error("UNSAFE_CONSENSUS_PATH_REJECTED");
  const direct =
    currentCandidateId === undefined
      ? undefined
      : lattice.candidatePaths.find(
          (path) =>
            path.candidateId === currentCandidateId &&
            path.nodeIds.length === nodeIds.length &&
            path.nodeIds.every((node, index) => node === nodeIds[index]),
        );
  const witnesses = direct
    ? Array.from({ length: nodeIds.length - 1 }, () => direct.candidateId)
    : validation.sourceCandidateIds;
  const tokenProvenance: C61SurfaceRestoration["tokenProvenance"] = [];
  for (let index = 1; index < nodeIds.length - 1; index += 1) {
    const node = c61Require(
      lattice.nodes.find((x) => x.nodeId === nodeIds[index]),
    );
    if (node.kind !== "TOKEN") continue;
    const sourceCandidateId = c61Require(witnesses[index]);
    const provenance = c61Require(
      node.candidateProvenance.find((x) => x.candidateId === sourceCandidateId),
    );
    if (provenance.displaySurface === null || provenance.unitIndex === null)
      throw new Error("C61_SURFACE_PROVENANCE_MISSING");
    tokenProvenance.push({
      outputPosition: tokenProvenance.length,
      outputSurface: provenance.displaySurface,
      sourceCandidateId,
      sourceUnitIndex: provenance.unitIndex,
      latticeNodeId: node.nodeId,
      latticeEdgeIds: validation.edgeIds.slice(index - 1, index + 1),
      provenanceHash: provenance.provenanceHash,
    });
  }
  const displayText = tokenProvenance.map((p) => p.outputSurface).join("");
  const normalizedText = normalizeC61Japanese(displayText);
  const controlCandidateId =
    lattice.nodes
      .flatMap((node) => node.candidateProvenance)
      .find((provenance) => provenance.providerFamily === "CURRENT")
      ?.candidateId ?? currentCandidateId;
  const currentPath = lattice.candidatePaths.find(
    (path) => path.candidateId === controlCandidateId,
  );
  const currentText = currentPath?.nodeIds
    .map(
      (nodeId) =>
        lattice.nodes
          .find((node) => node.nodeId === nodeId)
          ?.candidateProvenance.find(
            (p) => p.candidateId === controlCandidateId,
          )?.displaySurface ?? "",
    )
    .join("");
  const body = {
    displayText,
    normalizedText,
    sourceCandidateIds: [
      ...new Set(tokenProvenance.map((p) => p.sourceCandidateId)),
    ].sort(),
    orthographyOnly:
      currentText !== undefined &&
      displayText !== currentText &&
      normalizedText === normalizeC61Japanese(currentText),
    tokenProvenance,
  };
  return c61SurfaceRestorationSchema.parse({
    ...body,
    semanticHash: machineQualitySemanticHash(body),
  });
}
