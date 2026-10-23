import { createHash } from "node:crypto";

import {
  c60ProtectedRiskPolicySchema,
  type C60ProtectedRiskPolicy,
  type C60ProtectedRiskPolicyEntry,
} from "@mvl/shared";

export const C60_PROTECTED_POLICY_VERSION =
  "c6.0-protected-finalization-risk-v1" as const;
export const C60_EVIDENCE_FRESHNESS_VERSION =
  "c6.0-evidence-freshness-v1" as const;
export const C60_BASELINE_PRESERVATION_VERSION =
  "c6.0-human-baseline-preservation-v1" as const;
export const C60_ROOT_RISK_VERSION = "c6.0-root-risk-dedup-v1" as const;
export const C60_INVESTIGATION_BASELINE_COMMIT =
  "4deed6efdf509f56b5f5c76a1607ae8ef4adf431" as const;
export const C60_INVESTIGATION_PARENT_COMMIT =
  "678c33a26fe1255e8b087001bee32886592e7ddd" as const;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .toSorted()
        .filter((key) => record[key] !== undefined)
        .map((key) => [key, canonicalize(record[key])]),
    );
  }
  return value;
}

export function c60StableHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function normalizeC60SemanticProvenance(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeC60SemanticProvenance);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        key === "generatedAt" || key === "runId"
          ? null
          : normalizeC60SemanticProvenance(item),
      ]),
    );
  }
  return value;
}

export function c60SemanticHash(value: Record<string, unknown>): string {
  return c60StableHash(
    normalizeC60SemanticProvenance({ ...value, semanticHash: null }),
  );
}

const observedContentDiagnosticCodes = [
  "ADJACENT_CUES_MAP_TO_ONE_CONTINUOUS_SPEAKER_TRACK",
  "C5_18_ANONYMOUS_COMPONENT_LOCAL_SPEAKER_EVIDENCE",
  "INTENTIONAL_REPETITION_CLASSIFIED",
  "ONE_STABLE_COMPONENT_LOCAL_SPEAKER_TRACK",
  "OVERLAP_SPEECH_INTERVAL_OBSERVED",
  "RAW_VAD_END_EXCEEDS_AUDIO_BOUNDARY_WITHIN_TOLERANCE",
] as const;

const providerDiagnosticCodes = [
  "CTC_DUAL_WINDOW_PATH_UNAVAILABLE",
  "EVIDENCE_DP_BOUNDARY_UNAVAILABLE",
  "MAPPED_TOKEN_EVIDENCE_UNAVAILABLE",
  "READING_UNAVAILABLE",
  "SOURCE_SEPARATION_TRIGGER_NOT_MET",
  "SPEAKER_OR_FOREGROUND_EVIDENCE_UNAVAILABLE",
] as const;

const routingDiagnosticCodes = [
  "FINAL_INTEGRITY_FINDING_REQUIRES_REVIEW",
] as const;

const provenanceDiagnosticCodes = ["HUMAN_REVIEWED_BASELINE_IMPORTED"] as const;

const mutationAbsenceCodes = [
  "ALIGNMENT_PINNED_TO_WINDOW_EDGE",
  "ALIGNMENT_WINDOW_UNSTABLE",
  "BOUNDARY_CLAMPED_TOKEN_SEQUENCE",
  "COMPONENT_PARTIAL_ALIGNMENT_NOT_ATOMIC",
  "COMPONENT_REMAINS_UNRESOLVED",
  "COMPONENT_TIMING_GATE_INCOMPLETE",
  "CTC_ALIGNMENT_PINNED_TO_WINDOW_EDGE",
  "CTC_END_INDEPENDENT_LEXICAL_SUPPORT_MISSING",
  "CTC_END_MUTATION_EXCEEDS_LIMIT",
  "CTC_END_WINDOW_UNSTABLE",
  "CTC_JOINT_ASSIGNMENT_CANDIDATE_MISSING",
  "CTC_POST_REPAIR_CUE_TOO_SHORT",
  "CTC_START_INDEPENDENT_LEXICAL_SUPPORT_MISSING",
  "CTC_START_MUTATION_EXCEEDS_LIMIT",
  "CTC_START_WINDOW_UNSTABLE",
  "CUE_ALIGNMENT_GATE_FAILED",
  "DUPLICATE_ACOUSTIC_OCCURRENCE_ASSIGNMENT",
  "EVIDENCE_DP_LOW_COVERAGE",
  "INSUFFICIENT_ACOUSTIC_ALIGNMENT",
  "INSUFFICIENT_EXCLUSIVE_AUDIO",
  "INSUFFICIENT_PROFILE_SUPPORT",
  "INSUFFICIENT_TRUSTED_TIMING_PROFILE_SUPPORT",
  "JOINT_DECISION_SCORE_OR_MARGIN_LOW",
  "LOW_ALIGNMENT_CONFIDENCE",
  "MFA_SIDE_SPECIFIC_EXTERNAL_BOUNDARY_SUPPORT_MISSING",
  "MULTIPLE_ANONYMOUS_SPEAKER_TRACKS",
  "SEPARATION_RECONSTRUCTION_ERROR_HIGH",
  "SEQUENCE_CONTAINS_INDIVIDUALLY_QUARANTINED_TOKEN",
  "SPEAKER_ACTIVITY_IOU_LOW",
  "SPEAKER_ASSIGNMENT_NOT_STABLE_SINGLE",
  "SPEAKER_COUNT_UNSTABLE",
  "SPEAKER_DECISION_MARGIN_INSUFFICIENT",
  "SPEAKER_MAPPING_UNSTABLE",
  "SPEAKER_OVERLAP_INTERVAL_UNSTABLE",
  "SPEAKER_RELATIONSHIP_NOT_TIMING_ACTIONABLE",
  "SPEAKER_WINDOW_UNSTABLE",
  "SPECIAL_TOKEN",
  "STABLE_SPEAKER_CHANGE_UNAVAILABLE",
  "ZERO_COLLAPSED_TOKEN_SEQUENCE",
  "ZERO_DURATION_TOKEN",
] as const;

const mutationContradictionCodes = [
  "CTC_DUPLICATE_OCCURRENCE_CONFLICT",
  "CTC_JOINT_ASSIGNMENT_NON_MONOTONIC",
  "CTC_NEIGHBOR_INTRUSION",
  "CTC_NEW_ILLEGAL_OVERLAP",
  "CTC_SPEAKER_EVIDENCE_CONTRADICTION",
  "FORCED_ALIGNMENT_SILENCE_INTRUSION",
  "MFA_EVIDENCE_DP_DISAGREEMENT",
  "NEIGHBOR_CUE_INTRUSION",
  "NEIGHBOR_INTRUSION",
  "OCCURRENCE_ORDER_CONFLICT",
] as const;

const preservationSupportCodes = ["CTC_LEGAL_OVERLAP_DELETED"] as const;

const advisoryCodes = [
  "ASS_TIMESTAMP_DECIMAL_COMMA_NORMALIZED",
  "PRESENTATION_LINE_LAYOUT_AUTO_RESOLVED",
] as const;

const integrityCodes = [
  "INVALID_CUE_TIMING",
  "CUE_OUTSIDE_MEDIA",
  "TIME_REVERSED",
  "SERIALIZATION_ROUND_TRIP_FAILED",
  "SERIALIZATION_SEMANTIC_PARITY_FAILED",
  "FORMAT_CANONICAL_PARITY_FAILED",
  "FORMAT_PRESENTATION_PARITY_FAILED",
  "SOURCE_MEDIA_CHANGED",
  "HUMAN_REVIEWED_SUBTITLE_CHANGED",
  "UNSAFE_AUTOMATIC_MUTATION",
  "REVIEW_DELIVERY_INTEGRITY_FAILED",
  "AUDIO_DELIVERY_INTEGRITY_FAILED",
  "POLICY_INTEGRITY_FAILED",
  "EVIDENCE_FRESHNESS_INTEGRITY_FAILED",
  "HUMAN_BASELINE_AUTHORITY_FAILED",
  "UNCLASSIFIED_FINALIZATION_SIGNAL",
  "MACHINE_ONLY_BLIND_ACCEPTANCE_REQUIRED",
] as const;

function entriesFor(
  codes: readonly string[],
  template: Omit<C60ProtectedRiskPolicyEntry, "code">,
): C60ProtectedRiskPolicyEntry[] {
  return codes.map((code) => ({ code, ...template }));
}

function buildEntries(): C60ProtectedRiskPolicyEntry[] {
  const entries: C60ProtectedRiskPolicyEntry[] = [
    ...entriesFor(observedContentDiagnosticCodes, {
      rootRiskFamily: "observed-content-classification",
      blockingScope: "diagnostic-only",
      evidencePolarity: "execution-diagnostic",
      disposition: "DIAGNOSTIC_ONLY",
      currentOutputRisk: "NO_POSITIVE_DEFECT_EVIDENCE",
      proposedMutationRisk: "NOT_APPLICABLE",
      providerSpecific: false,
      contextRule:
        "Record the observed relationship without treating it as proof of a subtitle defect.",
      rationale:
        "Observed acoustic or presentation structure is diagnostic unless a separate localized defect is proven.",
    }),
    ...entriesFor(providerDiagnosticCodes, {
      rootRiskFamily: "provider-or-evidence-availability",
      blockingScope: "evidence-availability",
      evidencePolarity: "execution-diagnostic",
      disposition: "DIAGNOSTIC_ONLY",
      currentOutputRisk: "NO_POSITIVE_DEFECT_EVIDENCE",
      proposedMutationRisk: "HIGH",
      providerSpecific: true,
      contextRule:
        "Provider unavailability blocks dependent mutation but does not independently condemn preserved output.",
      rationale:
        "The signal describes execution or evidence availability rather than a localized output defect.",
    }),
    ...entriesFor(routingDiagnosticCodes, {
      rootRiskFamily: "review-routing-meta-signal",
      blockingScope: "review-routing",
      evidencePolarity: "execution-diagnostic",
      disposition: "DIAGNOSTIC_ONLY",
      currentOutputRisk: "NO_POSITIVE_DEFECT_EVIDENCE",
      proposedMutationRisk: "NOT_APPLICABLE",
      providerSpecific: false,
      contextRule: "Inherit safety semantics from the underlying finding.",
      rationale: "A review route is not independent evidence of a defect.",
    }),
    ...entriesFor(provenanceDiagnosticCodes, {
      rootRiskFamily: "baseline-provenance-diagnostic",
      blockingScope: "diagnostic-only",
      evidencePolarity: "execution-diagnostic",
      disposition: "DIAGNOSTIC_ONLY",
      currentOutputRisk: "NO_POSITIVE_DEFECT_EVIDENCE",
      proposedMutationRisk: "NOT_APPLICABLE",
      providerSpecific: false,
      contextRule: "Record verified baseline provenance without blocking it.",
      rationale: "A verified import is provenance, not a defect.",
    }),
    ...entriesFor(mutationAbsenceCodes, {
      rootRiskFamily: "automatic-boundary-mutation-guard",
      blockingScope: "automatic-mutation-safety",
      evidencePolarity: "absence-of-support",
      disposition: "MUTATION_GUARD",
      currentOutputRisk: "NO_POSITIVE_DEFECT_EVIDENCE",
      proposedMutationRisk: "HIGH",
      providerSpecific: true,
      contextRule:
        "Prevent the dependent automatic action; permit unchanged verified-human preservation when all output gates pass.",
      rationale:
        "Insufficient evidence for a repair is not positive evidence that the current output is defective.",
    }),
    ...entriesFor(mutationContradictionCodes, {
      rootRiskFamily: "evidence-contradiction-or-preservation-risk",
      blockingScope: "evidence-consistency",
      evidencePolarity: "contradictory-evidence",
      disposition: "MUTATION_GUARD",
      currentOutputRisk: "UNKNOWN",
      proposedMutationRisk: "HIGH",
      providerSpecific: true,
      contextRule:
        "Reject the contradicted mutation; retain current-output uncertainty unless separate positive defect evidence exists.",
      rationale:
        "The contradiction is localized to a proposed repair and does not establish that preserved human timing is unsafe.",
    }),
    ...entriesFor(preservationSupportCodes, {
      rootRiskFamily: "evidence-contradiction-or-preservation-risk",
      blockingScope: "automatic-mutation-safety",
      evidencePolarity: "preservation-support",
      disposition: "MUTATION_GUARD",
      currentOutputRisk: "LOW_RISK",
      proposedMutationRisk: "HIGH",
      providerSpecific: true,
      contextRule:
        "Reject the repair that deletes a legal overlap and record support for preserving the unchanged baseline.",
      rationale:
        "The proposed mutation is less safe than preservation; this is not a claim that baseline timing is acoustic ground truth.",
    }),
    ...entriesFor(advisoryCodes, {
      rootRiskFamily: "presentation-or-format-advisory",
      blockingScope: "format-compatibility",
      evidencePolarity: "format-advisory",
      disposition: "REVIEW_ADVISORY",
      currentOutputRisk: "LOW_RISK",
      proposedMutationRisk: "MEDIUM",
      providerSpecific: false,
      contextRule:
        "Retain as advisory while round-trip, canonical, timing, and presentation integrity pass.",
      rationale:
        "Presentation normalization and format variability do not independently invalidate canonical content.",
    }),
    {
      code: "FORCED_ALIGNMENT_COMPONENT_UNRESOLVED",
      rootRiskFamily: "safe-repair-not-established",
      blockingScope: "evidence-availability",
      evidencePolarity: "absence-of-support",
      disposition: "CONTEXT_DEPENDENT",
      currentOutputRisk: "UNKNOWN",
      proposedMutationRisk: "HIGH",
      providerSpecific: false,
      contextRule:
        "Effective MUTATION_GUARD for unchanged verified-human preservation; FINAL_BLOCKER only with positive output or integrity risk.",
      rationale:
        "The meta finding records inability to prove a repair, not a proven defect in the preserved baseline.",
    },
    {
      code: "ILLEGAL_SUBTITLE_OVERLAP",
      rootRiskFamily: "overlap-semantics-unresolved",
      blockingScope: "format-compatibility",
      evidencePolarity: "format-advisory",
      disposition: "CONTEXT_DEPENDENT",
      currentOutputRisk: "UNKNOWN",
      proposedMutationRisk: "HIGH",
      providerSpecific: false,
      contextRule:
        "Effective REVIEW_ADVISORY only for unchanged verified-human output with no positive defect or integrity failure; otherwise remain fail-closed.",
      rationale:
        "Temporal overlap is observed, but simultaneous speech or presentation constraints can be intentional.",
    },
    {
      code: "CTC_TARGET_UNREPRESENTABLE",
      rootRiskFamily: "stale-ctc-target-availability",
      blockingScope: "evidence-availability",
      evidencePolarity: "absence-of-support",
      disposition: "SUPERSEDED",
      currentOutputRisk: "NO_POSITIVE_DEFECT_EVIDENCE",
      proposedMutationRisk: "NOT_APPLICABLE",
      providerSpecific: true,
      contextRule:
        "SUPERSEDED only after same-cue C5.19 encodability, canonical, timing, semantic-subject, and lineage checks pass.",
      rationale:
        "A newer pronunciation projection can supersede target availability without changing canonical text or timing.",
    },
    ...entriesFor(integrityCodes, {
      rootRiskFamily: "delivery-or-canonical-integrity",
      blockingScope: "delivery-integrity",
      evidencePolarity: "positive-risk-evidence",
      disposition: "FINAL_BLOCKER",
      currentOutputRisk: "PROVEN_UNSAFE",
      proposedMutationRisk: "HIGH",
      providerSpecific: false,
      contextRule:
        "Always block protected finalization, including verified-human preservation.",
      rationale:
        "The signal proves an integrity, authority, classification, or release-gate failure.",
    }),
  ];
  return entries.toSorted((left, right) => left.code.localeCompare(right.code));
}

const investigationSemanticHashes = {
  blockerInventory:
    "8bf16ba728cd438a74d1cd506ab51b47ae59fcdade2dd941221413fe9bee5aa6",
  blockerOntology:
    "e5d8c68e4c3a808f1c84fb967b1c3be3db7d4b36394fe5e305b34d34b0c8fabb",
  blockerRootCauseGraph:
    "9ba81e5412a59c325cc64e53211784e39920044782dd84cff5e0681a349c63d7",
  blockerSupersessionAudit:
    "00cbe5196f1764c02b4385187617d28f4a9f00c0c15cfbb5df43e5b5be379c32",
  componentEvidenceMatrix:
    "008f7a8bfc7ea623584bcedac422949a27d7341d56aaf65b070c4c9ab1dcb9b7",
  componentRiskAudit:
    "2d42ba7501b632a7be1b38775af0f89b83960a56bbf18ae5549efb5e1d26a3ae",
  finalizationCounterfactual:
    "cb94725cb81248c639e138a4170e22725ddbf7a4fae84c45c5f9e0e63d83c2fe",
  humanAuthorityDependencyAudit:
    "e0dc0d183d3cc9bf9b4c113794bf9f66ed3fdb90aa8304224a18e9cf6544d1a0",
  investigationSummary:
    "e5d3099fbfa3b77dfd127e57e8e7864579f1950547076c76061c2a541d8e561f",
  zeroTouchReadiness:
    "e171be7e47c10e50a1f1bf9eebcad99d0067ceefa79f963d602aff9d54d4889c",
} as const;

function policyWithoutHash(): Omit<C60ProtectedRiskPolicy, "policyHash"> {
  return {
    schemaVersion: "1.0.0",
    artifactType: "c6-0-protected-risk-policy",
    policyVersion: C60_PROTECTED_POLICY_VERSION,
    investigationBaselineCommit: C60_INVESTIGATION_BASELINE_COMMIT,
    investigationParentCommit: C60_INVESTIGATION_PARENT_COMMIT,
    createdFromInvestigationVersion: "C6.0",
    runASemanticHashes: investigationSemanticHashes,
    runBSemanticHashes: investigationSemanticHashes,
    ontologyHash: investigationSemanticHashes.blockerOntology,
    rootCauseGraphHash: investigationSemanticHashes.blockerRootCauseGraph,
    machineOnlyReleaseAuthorized: false,
    exactMatchOnly: true,
    unknownSignalsFailClosed: true,
    entries: buildEntries(),
  };
}

export function createC60ProtectedRiskPolicy(): C60ProtectedRiskPolicy {
  const value = policyWithoutHash();
  return c60ProtectedRiskPolicySchema.parse({
    ...value,
    policyHash: c60StableHash(value),
  });
}

export const C60_PROTECTED_RISK_POLICY = createC60ProtectedRiskPolicy();
export const C60_PROTECTED_POLICY_HASH = C60_PROTECTED_RISK_POLICY.policyHash;

export function verifyC60ProtectedRiskPolicy(
  policy: C60ProtectedRiskPolicy,
): boolean {
  const { policyHash, ...content } = policy;
  return (
    policyHash === C60_PROTECTED_POLICY_HASH &&
    c60StableHash(content) === C60_PROTECTED_POLICY_HASH
  );
}

export function c60PolicyEntry(
  code: string,
  policy: C60ProtectedRiskPolicy = C60_PROTECTED_RISK_POLICY,
): C60ProtectedRiskPolicyEntry | undefined {
  return policy.entries.find((entry) => entry.code === code);
}

export const C60_OBSERVED_INVESTIGATION_CODES = [
  ...observedContentDiagnosticCodes,
  ...providerDiagnosticCodes,
  ...routingDiagnosticCodes,
  ...provenanceDiagnosticCodes,
  ...mutationAbsenceCodes,
  ...mutationContradictionCodes,
  ...preservationSupportCodes,
  ...advisoryCodes,
  "FORCED_ALIGNMENT_COMPONENT_UNRESOLVED",
  "ILLEGAL_SUBTITLE_OVERLAP",
  "CTC_TARGET_UNREPRESENTABLE",
].toSorted();

if (new Set(C60_OBSERVED_INVESTIGATION_CODES).size !== 70) {
  throw new Error(
    "C6.0 protected policy must cover exactly 70 observed codes.",
  );
}
