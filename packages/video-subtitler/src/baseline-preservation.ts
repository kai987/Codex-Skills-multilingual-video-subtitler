import {
  subtitleBaselinePreservationAssessmentSchema,
  type SubtitleBaselinePreservationAssessment,
} from "@mvl/shared";

import {
  C60_BASELINE_PRESERVATION_VERSION,
  c60SemanticHash,
} from "./finalization-risk-policy.js";

export interface BaselinePreservationInput {
  generatedAt: string;
  canonicalCueHashBefore: string;
  canonicalCueHashAfter: string;
  canonicalTimingHashBefore: string;
  canonicalTimingHashAfter: string;
  canonicalTextMutationCount: number;
  canonicalTimingMutationCount: number;
  humanAuthorityVerified: boolean;
  sourceReadOnlyVerified: boolean;
  humanSubtitleReadOnlyVerified: boolean;
  positiveCurrentOutputDefectEvidenceCount: number;
  integrityFinalBlockerCount: number;
  unknownObservedSignalCount: number;
  freshnessIntegrityPassed: boolean;
  policyIntegrityPassed: boolean;
  serializationRoundTripPassed: boolean;
  formatSemanticParityPassed: boolean;
  presentationIntegrityPassed: boolean;
  reviewDeliveryIntegrityPassed: boolean;
  apply: boolean;
}

export function assessBaselinePreservation(
  input: BaselinePreservationInput,
): SubtitleBaselinePreservationAssessment {
  const checks = {
    humanAuthorityVerified: input.humanAuthorityVerified,
    sourceReadOnlyVerified: input.sourceReadOnlyVerified,
    humanSubtitleReadOnlyVerified: input.humanSubtitleReadOnlyVerified,
    canonicalCueHashUnchanged:
      input.canonicalCueHashBefore === input.canonicalCueHashAfter,
    canonicalTimingHashUnchanged:
      input.canonicalTimingHashBefore === input.canonicalTimingHashAfter,
    noCanonicalTextMutation: input.canonicalTextMutationCount === 0,
    noCanonicalTimingMutation: input.canonicalTimingMutationCount === 0,
    noPositiveCurrentOutputDefectEvidence:
      input.positiveCurrentOutputDefectEvidenceCount === 0,
    noIntegrityFinalBlockers: input.integrityFinalBlockerCount === 0,
    noUnknownObservedSignals: input.unknownObservedSignalCount === 0,
    freshnessIntegrityPassed: input.freshnessIntegrityPassed,
    policyIntegrityPassed: input.policyIntegrityPassed,
    serializationRoundTripPassed: input.serializationRoundTripPassed,
    formatSemanticParityPassed: input.formatSemanticParityPassed,
    presentationIntegrityPassed: input.presentationIntegrityPassed,
    reviewDeliveryIntegrityPassed: input.reviewDeliveryIntegrityPassed,
  };
  const failed = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(
      ([name]) =>
        `BASELINE_PRESERVATION_${name.replaceAll(/([A-Z])/gu, "_$1").toUpperCase()}_FAILED`,
    )
    .toSorted();
  const eligible = failed.length === 0;
  const base = {
    schemaVersion: "1.0.0" as const,
    artifactType: "subtitle-baseline-preservation-assessment" as const,
    preservationVersion: C60_BASELINE_PRESERVATION_VERSION,
    generatedAt: input.generatedAt,
    decisionPath: "BASELINE_PRESERVATION" as const,
    canonicalCueHashBefore: input.canonicalCueHashBefore,
    canonicalCueHashAfter: input.canonicalCueHashAfter,
    canonicalTimingHashBefore: input.canonicalTimingHashBefore,
    canonicalTimingHashAfter: input.canonicalTimingHashAfter,
    canonicalTextMutationCount: input.canonicalTextMutationCount,
    canonicalTimingMutationCount: input.canonicalTimingMutationCount,
    checks,
    eligible,
    applied: eligible && input.apply,
    reasonCodes:
      failed.length === 0
        ? ["VERIFIED_HUMAN_BASELINE_PRESERVATION_ELIGIBLE"]
        : failed,
  };
  return subtitleBaselinePreservationAssessmentSchema.parse({
    ...base,
    semanticHash: c60SemanticHash(base),
  });
}
