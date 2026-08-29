import type {
  C60110PolicyProfileName,
  C60110PolicyProfiles,
  C60110ReasonCode,
  CrossModelArbitrationDecisionRecord,
  CrossModelArbitrationEvidenceBundle,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";
import { independentSupportFamilyCount } from "./cross-model-evidence-correlation.js";

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function blockerDecision(
  reasons: readonly C60110ReasonCode[],
): CrossModelArbitrationDecisionRecord["decision"] {
  if (reasons.includes("CORE_LOCALIZATION_AMBIGUOUS")) {
    return "BLOCKED_NOT_LOCALIZABLE";
  }
  if (
    reasons.includes("SPAN_LINEAGE_UNSAFE") ||
    reasons.includes("MUTATION_NONDEGRADATION_BLOCKED")
  ) {
    return "BLOCKED_NO_SAFE_SPAN";
  }
  if (
    reasons.some((reason) =>
      [
        "REAZON_LEXICALLY_UNSTABLE",
        "REAZON_HALLUCINATION_RISK",
        "REAZON_EMPTY",
        "REAZON_UNCOMPARABLE",
        "REAZON_RUNTIME_PROVENANCE_INCOMPLETE",
        "REAZON_DURATION_TEXT_ANOMALY",
      ].includes(reason),
    )
  ) {
    return "BLOCKED_REAZON_UNSTABLE";
  }
  return "BLOCKED_CONFLICTING_EVIDENCE";
}

export function arbitrateCrossModelCandidate(input: {
  bundle: CrossModelArbitrationEvidenceBundle;
  profiles: C60110PolicyProfiles;
  profileName: C60110PolicyProfileName;
  productionEnforcementEnabled?: boolean;
}): CrossModelArbitrationDecisionRecord {
  const profile = input.profiles.profiles.find(
    (value) => value.profile === input.profileName,
  );
  if (profile === undefined) throw new Error(`Unknown ${input.profileName}.`);
  const atoms = input.bundle.evidenceAtoms;
  const hardBlockers = unique(
    atoms
      .filter((atom) => atom.tier === "HARD_BLOCK")
      .map((atom) => atom.reasonCode),
  );
  if (
    ["AMBIGUOUS", "UNLOCALIZABLE"].includes(input.bundle.coreLocalizationStatus)
  ) {
    hardBlockers.push("CORE_LOCALIZATION_AMBIGUOUS");
  }
  const strongSupports = unique(
    atoms
      .filter((atom) => atom.tier === "STRONG_SUPPORT")
      .map((atom) => atom.reasonCode),
  );
  const supports = unique(
    atoms
      .filter((atom) => atom.tier === "SUPPORT")
      .map((atom) => atom.reasonCode),
  );
  const contradictions = unique(
    atoms
      .filter((atom) => atom.tier === "CONTRADICTION")
      .map((atom) => atom.reasonCode),
  );
  const agreement = ["EXACT_AGREEMENT", "NORMALIZED_AGREEMENT"].includes(
    input.bundle.crossModelRelation,
  );
  const orthographyOnly = [
    "ORTHOGRAPHY_ONLY_DIFFERENCE",
    "PRONUNCIATION_AGREEMENT",
  ].includes(input.bundle.crossModelRelation);
  const stableReazon = input.bundle.reazonStability.positiveStabilityEvidence;
  const safeSpan = input.bundle.mutationSafetyStatus.startsWith("SAFE_");
  const ctcContradicts = input.bundle.ctcOutcome === "CTC_FAVORS_WHISPER";
  const conflicting =
    contradictions.length > 0 ||
    input.bundle.whisperDecoderEvidence.status === "CONFLICTING_EVIDENCE" ||
    input.bundle.whisperTokenEvidence.status === "CONFLICTING_EVIDENCE" ||
    input.bundle.requestEdgeEvidence.status === "CONFLICTING_EVIDENCE" ||
    input.bundle.speechCompletenessEvidence.status === "CONFLICTING_EVIDENCE";
  const supportingReasons = unique([...strongSupports, ...supports]);
  const supportFamilyCount = independentSupportFamilyCount(
    input.bundle,
    supportingReasons,
  );
  const whisperNegativeAccepted = profile.requireStrongWhisperNegativeEvidence
    ? input.bundle.whisperStability.strongNegativeEvidence
    : input.bundle.whisperStability.negativeEvidence;
  const hasStrongReazonEvidence = strongSupports.some((reason) =>
    [
      "REAZON_STABLE",
      "REAZON_CONTEXT_EXTENSION_ONLY",
      "WHISPER_ALTERNATE_CORROBORATES_REAZON",
    ].includes(reason),
  );
  const aggressive = profile.profile === "AGGRESSIVE_SHADOW";
  const selectEligible =
    hardBlockers.length === 0 &&
    stableReazon &&
    safeSpan &&
    hasStrongReazonEvidence &&
    (whisperNegativeAccepted || aggressive) &&
    supportFamilyCount >= profile.minimumIndependentSupportingFamilies &&
    !ctcContradicts &&
    !conflicting;

  let decision: CrossModelArbitrationDecisionRecord["decision"];
  let confidenceClass: CrossModelArbitrationDecisionRecord["confidenceClass"];
  let decisionReasons: C60110ReasonCode[];
  if (agreement) {
    decision = "AGREEMENT_NO_CHANGE";
    confidenceClass = "HIGH";
    decisionReasons = [
      input.bundle.crossModelRelation === "EXACT_AGREEMENT"
        ? "CROSS_MODEL_EXACT_AGREEMENT"
        : "CROSS_MODEL_NORMALIZED_AGREEMENT",
    ];
  } else if (hardBlockers.length > 0) {
    decision = blockerDecision(hardBlockers);
    confidenceClass = "HIGH";
    decisionReasons = hardBlockers;
  } else if (orthographyOnly) {
    decision = "KEEP_CURRENT_WHISPER";
    confidenceClass = "HIGH";
    decisionReasons = ["ORTHOGRAPHY_ONLY_REVIEW"];
  } else if (selectEligible) {
    decision = "SELECT_REAZON";
    confidenceClass = "HIGH";
    decisionReasons = unique([...strongSupports, ...supports]);
  } else if (conflicting || ctcContradicts) {
    decision = "ABSTAIN_REVIEW";
    confidenceClass = "MEDIUM";
    decisionReasons = unique([
      ...(ctcContradicts ? (["CTC_SUPPORTS_WHISPER"] as const) : []),
      ...contradictions,
      "CONFLICTING_EVIDENCE",
    ]);
  } else if (
    !input.bundle.whisperStability.negativeEvidence &&
    (input.bundle.whisperDecoderEvidence.status ===
      "POSITIVE_CORRECTNESS_EVIDENCE" ||
      input.bundle.whisperTokenEvidence.status ===
        "POSITIVE_CORRECTNESS_EVIDENCE")
  ) {
    decision = "KEEP_CURRENT_WHISPER";
    confidenceClass = "MEDIUM";
    decisionReasons = ["WHISPER_STRONG_SUPPORT"];
  } else {
    decision = "ABSTAIN_REVIEW";
    confidenceClass = "LOW";
    decisionReasons = [
      input.bundle.whisperDecoderEvidence.evidenceMissing ||
      input.bundle.whisperTokenEvidence.evidenceMissing
        ? "EVIDENCE_ABSENCE_ONLY"
        : "CONFLICTING_EVIDENCE",
    ];
  }

  const enforcementEnabled = input.productionEnforcementEnabled ?? true;
  if (decision === "SELECT_REAZON" && !enforcementEnabled) {
    decision = "ABSTAIN_REVIEW";
    confidenceClass = "HIGH";
    decisionReasons = unique([
      ...decisionReasons,
      "PRODUCTION_ENFORCEMENT_DISABLED",
    ]);
  }
  if (profile.profile === "AGGRESSIVE_SHADOW") {
    decisionReasons = unique([
      ...decisionReasons,
      "AGGRESSIVE_PROFILE_SHADOW_ONLY",
    ]);
  }
  const core = {
    arbitrationDecisionId: `c60110-decision:${profile.profile}:${input.bundle.eventId}`,
    eventId: input.bundle.eventId,
    whisperCandidateId: input.bundle.currentWhisperCandidate.candidateId,
    reazonCandidateId:
      input.bundle.reazonCoreExactCandidate?.candidateId ?? null,
    evidenceBundleId: input.bundle.evidenceBundleId,
    policyProfile: profile.profile,
    hardBlockers: unique(hardBlockers),
    strongSupports,
    supports,
    contradictions,
    ctcStatus:
      input.bundle.ctcOutcome === "CTC_FAVORS_REAZON"
        ? ("SUPPORT_REAZON" as const)
        : input.bundle.ctcOutcome === "CTC_FAVORS_WHISPER"
          ? ("SUPPORT_WHISPER" as const)
          : input.bundle.ctcOutcome === "CTC_AMBIGUOUS"
            ? ("AMBIGUOUS" as const)
            : input.bundle.ctcOutcome === "CTC_UNSCORABLE"
              ? ("UNSCORABLE" as const)
              : ("NOT_RUN" as const),
    decision,
    confidenceClass,
    decisionReasons,
    mutationEligible:
      decision === "SELECT_REAZON" && confidenceClass === "HIGH",
  };
  return { ...core, semanticHash: machineQualitySemanticHash(core) };
}
