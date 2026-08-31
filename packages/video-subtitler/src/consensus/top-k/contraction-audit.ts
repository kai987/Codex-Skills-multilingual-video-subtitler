import {
  c612ContractionSchema,
  type C61HypothesisUniverse,
  type C612Completeness,
  type C612Contraction,
} from "@mvl/shared";
import { artifact, C612_POLICY, c612Defined } from "./c612-policy.js";
import { textStructure } from "./c612-structural.js";
/** Text deletion is not acoustic deletion. Unknown support cannot certify a safe contraction. */
export function buildContractionAudit(
  universe: C61HypothesisUniverse,
  completeness: readonly C612Completeness[],
  priorStrongIds: readonly string[],
) {
  const rows: C612Contraction[] = completeness
    .map((acoustic) => {
      const c = c612Defined(
        universe.candidates.find((c) => c.candidateId === acoustic.candidateId),
      );
      const current = universe.candidates.find(
        (x) =>
          x.eventId === c.eventId &&
          x.providerFamily === "CURRENT" &&
          x.inclusionStatus === "INCLUDED",
      );
      if (!current) throw new Error("C612_CONTRACTION_CURRENT_MISSING");
      const shape = textStructure(current.normalizedText, c.normalizedText);
      const strong =
        shape.lengthRatio < C612_POLICY.contraction.strongLengthRatio ||
        shape.deletionRatio > C612_POLICY.contraction.strongDeletionRatio;
      // No phonetic unit deletion claim is fabricated from a character LCS.
      const complete =
        acoustic.acousticCompletenessStatus === "VERIFIED_COMPLETE";
      let classification: C612Contraction["classification"] =
        "NOT_STRONG_CONTRACTION";
      if (strong)
        classification = complete
          ? "POSSIBLE_VALID_CONTRACTION"
          : "UNKNOWN_CONTRACTION";
      return {
        eventId: acoustic.eventId,
        candidateId: c.candidateId,
        priorStrongContraction: priorStrongIds.includes(c.candidateId),
        strong,
        lengthRatio: shape.lengthRatio,
        lcsRatio: shape.lcsRatio,
        prefixRetention: shape.prefixRetention,
        suffixRetention: shape.suffixRetention,
        leadingDeletionLength: shape.leadingDeletionLength,
        trailingDeletionLength: shape.trailingDeletionLength,
        internalDeletionSpans: shape.internalDeletionSpans,
        deletedPronunciationUnits: null,
        deletedAcousticallySupportedUnits: null,
        completenessStatus: acoustic.acousticCompletenessStatus,
        classification,
        selectable: !strong || complete,
        reasons: strong
          ? complete
            ? ["COMPLETE_CANDIDATE_NOT_PROOF_OF_DELETED_TEXT_HALLUCINATION"]
            : ["STRONG_CONTRACTION_WITH_UNPROVEN_ACOUSTIC_COMPLETENESS"]
          : [],
      };
    })
    .sort((a, b) => a.candidateId.localeCompare(b.candidateId));
  return c612ContractionSchema.parse(
    artifact("machine-c6-1-2-contraction-audit", {
      rows,
      runtimeGoldInputCount: 0,
      lengthAloneBansCandidate: false,
    }),
  );
}
