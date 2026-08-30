import { c61Require } from "./japanese-text-representation.js";
import {
  c61ConsensusSpanSchema,
  type C61ConsensusSpan,
  type C61TokenLattice,
} from "@mvl/shared";
import { machineQualitySemanticHash } from "../machine-quality/evidence-correlation.js";
export function buildC61ConsensusSpans(
  lattice: C61TokenLattice,
  currentCandidateId?: string,
): C61ConsensusSpan[] {
  const slots = [
    ...new Set(
      lattice.nodes
        .filter((node) => node.kind === "TOKEN" || node.kind === "EPSILON")
        .map((node) => node.slotIndex),
    ),
  ].sort((a, b) => a - b);
  const ambiguous = slots.filter(
    (slot) =>
      lattice.nodes.filter((node) => node.slotIndex === slot).length > 1,
  );
  const groups: number[][] = [];
  for (const slot of ambiguous) {
    const last = groups.at(-1);
    if (last?.at(-1) === slot - 1) last.push(slot);
    else groups.push([slot]);
  }
  return groups.map((group) => {
    const slotStart = c61Require(group[0]);
    const slotEnd = c61Require(group.at(-1));
    const alternativesBySurface = new Map<
      string,
      C61ConsensusSpan["alternatives"][number]
    >();
    let currentSurface: string | null = null;
    for (const path of lattice.candidatePaths) {
      const selectedNodes = path.nodeIds
        .map((id) =>
          c61Require(lattice.nodes.find((node) => node.nodeId === id)),
        )
        .filter(
          (node) => node.slotIndex >= slotStart && node.slotIndex <= slotEnd,
        );
      const displaySurface = selectedNodes
        .map(
          (node) =>
            c61Require(
              node.candidateProvenance.find(
                (p) => p.candidateId === path.candidateId,
              ),
            ).displaySurface ?? "",
        )
        .join("");
      if (path.candidateId === currentCandidateId)
        currentSurface = displaySurface;
      const nodeIds = selectedNodes.map((node) => node.nodeId);
      const key = machineQualitySemanticHash({ displaySurface, nodeIds });
      const alternative = alternativesBySurface.get(key) ?? {
        displaySurface,
        nodeIds,
        supportingCandidates: [],
        providerFamilies: [],
      };
      alternative.supportingCandidates.push(path.candidateId);
      const family = c61Require(
        c61Require(selectedNodes[0]).candidateProvenance.find(
          (p) => p.candidateId === path.candidateId,
        ),
      ).providerFamily;
      if (!alternative.providerFamilies.includes(family))
        alternative.providerFamilies.push(family);
      alternative.providerFamilies.sort();
      alternativesBySurface.set(key, alternative);
    }
    const alternatives = [...alternativesBySurface.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, value]) => value);
    const body = {
      spanId: `span-${machineQualitySemanticHash({ eventId: lattice.eventId, slotStart, slotEnd }).slice(0, 24)}`,
      eventId: lattice.eventId,
      slotStart,
      slotEnd,
      currentSurface,
      alternatives,
      supportingCandidates: lattice.candidatePaths
        .map((path) => path.candidateId)
        .sort(),
      providerFamilies: [
        ...new Set(
          alternatives.flatMap((alternative) => alternative.providerFamilies),
        ),
      ].sort(),
      pronunciationRelations: [
        ...new Set(
          lattice.nodes
            .filter(
              (node) =>
                node.slotIndex >= slotStart && node.slotIndex <= slotEnd,
            )
            .flatMap((node) =>
              node.pronunciationForm === null ? [] : [node.pronunciationForm],
            ),
        ),
      ].sort(),
      legalEntryNodes: lattice.nodes
        .filter((node) => node.slotIndex === slotStart - 1)
        .map((node) => node.nodeId)
        .sort(),
      legalExitNodes: lattice.nodes
        .filter((node) => node.slotIndex === slotEnd + 1)
        .map((node) => node.nodeId)
        .sort(),
      ambiguity: "CONTIGUOUS_CANDIDATE_SPAN_ONLY" as const,
    };
    return c61ConsensusSpanSchema.parse({
      ...body,
      semanticHash: machineQualitySemanticHash(body),
    });
  });
}
