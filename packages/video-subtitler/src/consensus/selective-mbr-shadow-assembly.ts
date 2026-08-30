import type {
  C61CandidateText,
  C61HypothesisUniverse,
  C61TokenLattice,
  SubtitlePackage,
} from "@mvl/shared";
import { machineQualitySemanticHash as hash } from "../machine-quality/evidence-correlation.js";
import { assembleC61Shadow } from "./consensus-shadow-assembly.js";
import { materializeC61Path } from "./lattice-mbr.js";
import type { C61ProfilePath } from "./consensus-safety-audit.js";

export interface C611ExistingSelection {
  eventId: string;
  candidateId: string | null;
  selected: boolean;
}
/** Reuse the audited renderer. Lattices prove existing candidate provenance;
 * no lattice decoding, novel path search, timing, split or merge occurs here. */
export function assembleC611ExistingShadow(input: {
  profileId: string;
  production: SubtitlePackage;
  universe: C61HypothesisUniverse;
  lattices: C61TokenLattice[];
  selections: C611ExistingSelection[];
}) {
  if (
    new Set(input.selections.map((s) => s.eventId)).size !==
    input.selections.length
  )
    throw new Error("C611_DUPLICATE_SHADOW_SELECTION");
  const paths: C61ProfilePath[] = [];
  for (const selection of input.selections) {
    if (!selection.selected) continue;
    const candidate = input.universe.candidates.find(
      (c) =>
        c.candidateId === selection.candidateId &&
        c.eventId === selection.eventId &&
        c.inclusionStatus === "INCLUDED",
    );
    if (!candidate || candidate.providerFamily === "CURRENT")
      throw new Error("C611_SELECTED_NONEXISTING_CANDIDATE");
    const lattice = input.lattices.find(
      (l) =>
        l.eventId === selection.eventId &&
        l.candidatePaths.some((p) => p.candidateId === candidate.candidateId),
    );
    const existing = lattice?.candidatePaths.find(
      (p) => p.candidateId === candidate.candidateId,
    );
    if (!lattice || !existing)
      throw new Error("C611_EXISTING_CANDIDATE_PROVENANCE_UNAVAILABLE");
    const texts: C61CandidateText[] = input.universe.candidates.flatMap((c) =>
      c.inclusionStatus === "INCLUDED" &&
      c.eventId === selection.eventId &&
      c.sourceInterval
        ? [
            {
              candidateId: c.candidateId,
              eventId: c.eventId,
              sourceInterval: c.sourceInterval,
              providerFamily: c.providerFamily,
              displayText: c.displayText,
              normalizedText: c.normalizedText,
              pronunciationText: c.pronunciationText,
              correlationGroupId: c.correlationGroupId,
              provenanceHash: c.provenanceHash,
            },
          ]
        : [],
    );
    const currentCandidateId =
      texts.find((c) => c.providerFamily === "CURRENT")?.candidateId ?? null;
    const selected = materializeC61Path(
      lattice,
      existing.nodeIds,
      texts,
      currentCandidateId,
      null,
      candidate.candidateId,
    );
    if (
      selected?.displayText !== candidate.displayText ||
      !selected.provenanceComplete ||
      !selected.pathLegal
    )
      throw new Error("C611_EXISTING_TEXT_CHANGED_BY_PROVENANCE");
    paths.push({
      profileId: input.profileId,
      eventId: selection.eventId,
      latticeHash: lattice.semanticHash,
      path: selected,
      maxProviderSwitches: null,
    });
  }
  const result = assembleC61Shadow({
    profileId: input.profileId,
    production: input.production,
    events: input.universe.events,
    paths,
    lattices: input.lattices,
  });
  const identity = (pkg: SubtitlePackage) =>
    pkg.cues.map((c) => ({ id: c.id, start: c.start, end: c.end }));
  if (
    hash(identity(result.subtitlePackage)) !== hash(identity(input.production))
  )
    throw new Error("C611_SHADOW_STRUCTURE_MUTATION");
  const applied = new Set(
    result.decisions
      .filter((d) => d.status === "APPLIED_SHADOW_ONLY")
      .map((d) => d.eventId),
  );
  const requested = input.selections
    .filter((s) => s.selected)
    .map((s) => s.eventId);
  const blockedRequested = requested.filter((id) => !applied.has(id));
  return {
    ...result,
    requestedSelectionCount: requested.length,
    appliedSelectionCount: applied.size,
    blockedRequestedEventIds: blockedRequested,
    novelApplicationCount: 0 as const,
    timingMutationCount: 0 as const,
    productionMutationCount: 0 as const,
  };
}
