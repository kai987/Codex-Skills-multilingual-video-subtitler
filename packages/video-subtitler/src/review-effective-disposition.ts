import {
  subtitleReviewEffectiveDispositionSchema,
  type SubtitleFinalizationRiskAssessment,
  type SubtitleReviewEffectiveDisposition,
  type SubtitleReviewPackage,
} from "@mvl/shared";

import {
  C60_PROTECTED_POLICY_VERSION,
  c60SemanticHash,
} from "./finalization-risk-policy.js";

export function buildReviewEffectiveDisposition(input: {
  generatedAt: string;
  reviewPackage: SubtitleReviewPackage;
  componentRisks: SubtitleFinalizationRiskAssessment["componentRisks"];
  humanAuthorityVerified: boolean;
}): SubtitleReviewEffectiveDisposition {
  const riskByReview = new Map(
    input.componentRisks.map((component) => [component.reviewId, component]),
  );
  const items = input.reviewPackage.items
    .map((item) => {
      const component = riskByReview.get(item.reviewId);
      const preservationSupported =
        input.humanAuthorityVerified &&
        component?.preservationSupported === true;
      const mandatory =
        !input.humanAuthorityVerified ||
        component === undefined ||
        component.positiveCurrentOutputDefectEvidence;
      const advisory = !mandatory && !preservationSupported;
      return {
        reviewId: item.reviewId,
        componentId:
          item.speakerEvidenceComponentId ?? component?.componentId ?? "unknown",
        legacyRequiresHumanReview: item.requiresHumanReview,
        protectedDisposition: mandatory
          ? ("mandatory" as const)
          : preservationSupported
            ? ("preservation-supported" as const)
            : ("advisory" as const),
        protectedMandatory: mandatory,
        advisory,
        preservationSupported,
        reasonCodes: [
          ...(mandatory
            ? [
                input.humanAuthorityVerified
                  ? "POSITIVE_OR_UNCLASSIFIED_COMPONENT_RISK"
                  : "MACHINE_ONLY_BLIND_ACCEPTANCE_REQUIRED",
              ]
            : preservationSupported
              ? [
                  "PRESERVATION_SAFE_WITH_HUMAN_AUTHORITY",
                  "CTC_LEGAL_OVERLAP_DELETED",
                  "SPEAKER_RELATIONSHIP_RESOLVED",
                  "SUBTITLE_OVERLAP_NOT_AUTOMATICALLY_RESOLVED",
                ]
              : [
                  "TEMPORAL_OVERLAP_OBSERVED",
                  "OVERLAP_SEMANTICS_UNRESOLVED",
                  "FORMAT_OVERLAP_ADVISORY",
                  "PRESERVATION_SAFE_WITH_HUMAN_AUTHORITY",
                ]),
        ].toSorted(),
        riskEvidenceIds: [
          ...(component?.preservationSupportEvidenceIds ?? []),
          ...item.blockers.map(
            (code) => `review:${item.reviewId}:signal:${code}`,
          ),
        ].toSorted(),
      };
    })
    .toSorted((left, right) => left.reviewId.localeCompare(right.reviewId));
  const base = {
    schemaVersion: "1.0.0" as const,
    artifactType: "subtitle-review-effective-disposition" as const,
    policyVersion: C60_PROTECTED_POLICY_VERSION,
    generatedAt: input.generatedAt,
    items,
    summary: {
      legacyReviewItemCount: input.reviewPackage.items.length,
      protectedReviewArtifactItemCount: input.reviewPackage.items.length,
      effectiveMandatoryReviewCount: items.filter(
        (item) => item.protectedMandatory,
      ).length,
      effectiveAdvisoryReviewCount: items.filter((item) => item.advisory).length,
      preservationSupportedReviewCount: items.filter(
        (item) => item.preservationSupported,
      ).length,
    },
  };
  return subtitleReviewEffectiveDispositionSchema.parse({
    ...base,
    semanticHash: c60SemanticHash(base),
  });
}
