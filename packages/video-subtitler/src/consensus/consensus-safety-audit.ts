import {
  c61ConsensusProvenanceSchema,
  c61ConsensusSafetySchema,
  type C61ConsensusProvenance,
  type C61ConsensusSafety,
  type C61SelectedPath,
  type C61TokenLattice,
} from "@mvl/shared";
import { machineQualitySemanticHash } from "../machine-quality/evidence-correlation.js";
import { validateC61Path } from "./legal-path-validator.js";
import { restoreC61Surface } from "./surface-restoration.js";
import { c61Require } from "./japanese-text-representation.js";

export interface C61ProfilePath {
  profileId: string;
  eventId: string;
  latticeHash?: string | null | undefined;
  path: C61SelectedPath | null;
  maxProviderSwitches: number | null;
}

/** A supplementary graph cannot silently borrow the first graph for its event.
 * Legacy entries may use the explicit P0 graph, or the sole graph if unambiguous.
 */
export function resolveC61ProfileLattice(
  entry: C61ProfilePath,
  lattices: C61TokenLattice[],
  profiles: C61ProfilePath[] = [],
): C61TokenLattice | null {
  const requestedHash =
    entry.latticeHash ??
    profiles.find(
      (candidate) =>
        candidate.profileId === "P0" && candidate.eventId === entry.eventId,
    )?.latticeHash;
  const matches = lattices.filter(
    (lattice) =>
      lattice.eventId === entry.eventId &&
      (requestedHash == null || lattice.semanticHash === requestedHash),
  );
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

/** Normalized nodes may represent more than one real orthographic surface.
 * Honor an exact whole-candidate witness before the deterministic generic witness.
 * This selects real provenance, never substitutes the requested display string.
 */
export function restoreC61SelectedSurface(
  lattice: C61TokenLattice,
  path: C61SelectedPath,
) {
  const direct = lattice.candidatePaths
    .filter(
      (candidate) =>
        candidate.nodeIds.length === path.nodeIds.length &&
        candidate.nodeIds.every((id, index) => id === path.nodeIds[index]),
    )
    .find(
      (candidate) =>
        candidate.nodeIds
          .map(
            (nodeId) =>
              lattice.nodes
                .find((node) => node.nodeId === nodeId)
                ?.candidateProvenance.find(
                  (provenance) =>
                    provenance.candidateId === candidate.candidateId,
                )?.displaySurface ?? "",
          )
          .join("") === path.displayText,
    );
  return restoreC61Surface(lattice, path.nodeIds, direct?.candidateId);
}

export function auditC61Consensus(input: {
  paths: C61ProfilePath[];
  lattices: C61TokenLattice[];
  productionTextMutation: number;
  productionTimingMutation: number;
  runtimeGoldInputCount: number;
}): { safety: C61ConsensusSafety; provenance: C61ConsensusProvenance } {
  const counts: C61ConsensusSafety["counts"] = {
    unsupportedTokenCount: 0,
    unsupportedAdjacencyCount: 0,
    crossEventTokenCount: 0,
    unprovenSurfaceRestorationCount: 0,
    nonMonotonicPathCount: 0,
    pathCycleCount: 0,
    providerSwitchLimitViolationCount: 0,
    candidateProvenanceMissingCount: 0,
    GoldRuntimeLeakCount: input.runtimeGoldInputCount,
    syntheticKanjiGenerationCount: 0,
    timingMutationCount: input.productionTimingMutation,
    productionMutationCount:
      input.productionTextMutation + input.productionTimingMutation,
  };
  const paths: C61ConsensusSafety["paths"] = [];
  const provenance: C61ConsensusProvenance["paths"] = [];
  for (const entry of input.paths) {
    if (!entry.path) continue;
    const lattice = resolveC61ProfileLattice(
      entry,
      input.lattices,
      input.paths,
    );
    if (!lattice) throw new Error("C61_MISSING_LATTICE_FOR_SAFETY");
    const validation = validateC61Path(
      lattice,
      entry.path.nodeIds,
      entry.maxProviderSwitches === null
        ? {}
        : { maxProviderSwitches: entry.maxProviderSwitches },
    );
    for (const key of [
      "unsupportedTokenCount",
      "unsupportedAdjacencyCount",
      "crossEventTokenCount",
      "nonMonotonicPathCount",
      "pathCycleCount",
      "candidateProvenanceMissingCount",
      "providerSwitchLimitViolationCount",
    ] as const)
      counts[key] += validation.violations[key];
    const reasons = [...validation.reasons];
    if (!entry.path.pathLegal || !entry.path.provenanceComplete)
      reasons.push("SELECTED_PATH_DECLARED_UNSAFE");
    const { semanticHash, ...selectedBody } = entry.path;
    if (machineQualitySemanticHash(selectedBody) !== semanticHash)
      reasons.push("SELECTED_PATH_HASH_MISMATCH");
    const knownCharacters = new Set(
      lattice.nodes.flatMap((node) =>
        node.displaySurfaces.flatMap((surface) => Array.from(surface)),
      ),
    );
    counts.syntheticKanjiGenerationCount += Array.from(
      entry.path.displayText,
    ).filter(
      (character) =>
        /\p{Script=Han}/u.test(character) && !knownCharacters.has(character),
    ).length;
    const tokens: C61ConsensusProvenance["paths"][number]["tokens"] = [];
    if (validation.valid) {
      const restored = restoreC61SelectedSurface(lattice, entry.path);
      if (
        restored.displayText !== entry.path.displayText ||
        restored.normalizedText !== entry.path.normalizedText
      ) {
        counts.unprovenSurfaceRestorationCount++;
        reasons.push("SELECTED_SURFACE_DIFFERS_FROM_LEGAL_RESTORATION");
      }
      if (
        entry.path.edgeIds.length !== validation.edgeIds.length ||
        entry.path.edgeIds.some(
          (edgeId, index) => edgeId !== validation.edgeIds[index],
        ) ||
        entry.path.providerSwitchCount !== validation.providerSwitchCount ||
        entry.path.candidateSwitchCount !== validation.candidateSwitchCount
      ) {
        counts.candidateProvenanceMissingCount++;
        reasons.push("SELECTED_PATH_METADATA_DIFFERS_FROM_LEGAL_PROOF");
      }
      for (const token of restored.tokenProvenance) {
        const node = c61Require(
          lattice.nodes.find((n) => n.nodeId === token.latticeNodeId),
        );
        const source = node.candidateProvenance.find(
          (p) =>
            p.candidateId === token.sourceCandidateId &&
            p.unitIndex === token.sourceUnitIndex,
        );
        if (source?.displaySurface !== token.outputSurface) {
          counts.candidateProvenanceMissingCount++;
          reasons.push("SURFACE_NOT_IN_CANDIDATE");
          continue;
        }
        tokens.push({
          outputPosition: token.outputPosition,
          outputSurface: token.outputSurface,
          sourceCandidateIds: [token.sourceCandidateId],
          sourceCandidateSpans: [
            {
              candidateId: token.sourceCandidateId,
              start: token.sourceUnitIndex,
              end: token.sourceUnitIndex + 1,
            },
          ],
          providerFamilies: [source.providerFamily],
          latticeNodeIds: [token.latticeNodeId],
          latticeEdgeIds: token.latticeEdgeIds,
          selectionMethod: entry.profileId,
          evidenceIds: [token.provenanceHash],
        });
      }
    }
    const safe = reasons.length === 0;
    const core = {
      profileId: entry.profileId,
      eventId: entry.eventId,
      safe,
      reasons,
    };
    paths.push({ ...core, semanticHash: machineQualitySemanticHash(core) });
    provenance.push({
      profileId: entry.profileId,
      eventId: entry.eventId,
      pathHash: entry.path.semanticHash,
      outputText: entry.path.displayText,
      pathClass: !safe
        ? "REJECTED"
        : entry.path.pathKind === "NOVEL_LEGAL_PATH"
          ? "NOVEL_LEGAL_PATH"
          : entry.path.pathKind === "CURRENT_CONTROL_PATH"
            ? "PRESERVED_CURRENT"
            : "EXISTING_CANDIDATE",
      tokens,
      provenanceComplete:
        safe &&
        tokens.map((t) => t.outputSurface).join("") === entry.path.displayText,
    });
  }
  const base = {
    schemaVersion: "1.0.0" as const,
    policyVersion: "c6.1-consensus-investigation-v1" as const,
  };
  const safetyCore = {
    ...base,
    artifactType: "machine-multi-asr-consensus-safety-audit" as const,
    counts,
    auditedPathCount: paths.length,
    rejectedPathCount: paths.filter((p) => !p.safe).length,
    paths,
    engineeringPassed:
      Object.values(counts).every((c) => c === 0) && paths.every((p) => p.safe),
  };
  const provenanceCore = {
    ...base,
    artifactType: "machine-multi-asr-consensus-path-provenance" as const,
    paths: provenance,
  };
  return {
    safety: c61ConsensusSafetySchema.parse({
      ...safetyCore,
      semanticHash: machineQualitySemanticHash(safetyCore),
    }),
    provenance: c61ConsensusProvenanceSchema.parse({
      ...provenanceCore,
      semanticHash: machineQualitySemanticHash(provenanceCore),
    }),
  };
}
