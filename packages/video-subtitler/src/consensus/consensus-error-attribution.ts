import {
  c61AttributionSchema,
  type C61QualityEvaluation,
  type C61Oracle,
} from "@mvl/shared";
import { machineQualitySemanticHash as hash } from "../machine-quality/evidence-correlation.js";

export function attributeC61ConsensusErrors(
  quality: C61QualityEvaluation,
  oracle: C61Oracle,
) {
  const regressions = quality.profiles.flatMap((p) =>
    p.eventResults
      .filter((e) => e.outcome === "REGRESSED")
      .map((e) => {
        const bound = oracle.events.find((o) => o.eventId === e.eventId);
        const insufficient =
          bound?.bestExistingCandidateError !== null &&
          bound?.bestExistingCandidateError !== undefined &&
          bound.bestExistingCandidateError > 0 &&
          bound.bestLegalPathError === bound.bestExistingCandidateError;
        return {
          profileId: p.profileId,
          eventId: e.eventId,
          attribution: "UNKNOWN" as const,
          evidenceIds: [e.semanticHash, ...(bound ? [bound.semanticHash] : [])],
          rationale: insufficient
            ? "The exact legal-path oracle remains imperfect, demonstrating a pool limitation, but that does not explain why this decoder regressed relative to Current. Causal attribution remains UNKNOWN."
            : "Regression is observed but no independent evidence isolates an alignment, voting or surface cause.",
        };
      }),
  );
  const counts: Record<string, number> = {};
  regressions.forEach((r) => {
    counts[r.attribution] = (counts[r.attribution] ?? 0) + 1;
  });
  const body = {
    schemaVersion: "1.0.0" as const,
    policyVersion: "c6.1-consensus-investigation-v1" as const,
    artifactType: "c6-1-consensus-error-attribution" as const,
    evaluationOnly: true as const,
    regressions,
    counts,
  };
  return c61AttributionSchema.parse({ ...body, semanticHash: hash(body) });
}
