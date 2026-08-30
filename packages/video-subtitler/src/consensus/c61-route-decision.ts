import {
  c61RouteDecisionSchema,
  type C61ConsensusSafety,
  type C61Oracle,
  type C61QualityEvaluation,
  type C61RouteDecision,
} from "@mvl/shared";
import { machineQualitySemanticHash as hash } from "../machine-quality/evidence-correlation.js";

export function decideC61ResearchRoute(input: {
  quality: C61QualityEvaluation;
  oracle: C61Oracle;
  safety: C61ConsensusSafety;
  abParity: boolean;
}): C61RouteDecision {
  const baseline = input.quality.baseline;
  const primary = input.quality.profiles.filter((profile) =>
    /^P[1-9]$/u.test(profile.profileId),
  );
  const qualifying = primary.filter(
    (p) =>
      p.metrics.normalizedCer < baseline.normalizedCer &&
      p.metrics.materialErrors <= baseline.materialErrors &&
      p.metrics.hallucination <= baseline.hallucination &&
      p.metrics.missing <= baseline.missing &&
      p.metrics.coverage >= baseline.coverage &&
      p.realizedGain > 0 &&
      p.timingHashUnchanged &&
      p.metrics.cueCount === baseline.cueCount,
  );
  const candidateOnly = qualifying.find((p) => p.profileId === "P6");
  const candidateOnlyRelativeUtility =
    candidateOnly !== undefined &&
    !qualifying.some(
      (p) =>
        p.novelImproved > p.novelRegressed &&
        p.metrics.normalizedCer < candidateOnly.metrics.normalizedCer,
    );
  const novelGain = qualifying.some(
    (p) =>
      p.novelImproved > 0 && p.metrics.materialErrors < baseline.materialErrors,
  );
  const engineeringPassed =
    input.safety.engineeringPassed &&
    input.abParity &&
    input.safety.rejectedPathCount === 0 &&
    Object.values(input.safety.counts).every((count) => count === 0) &&
    input.quality.profiles.every(
      (profile) =>
        profile.timingHashUnchanged &&
        profile.metrics.cueCount === baseline.cueCount,
    );
  let decision: C61RouteDecision["decision"];
  let nextRoute: C61RouteDecision["nextRoute"];
  if (!engineeringPassed) {
    decision = "CONSENSUS_ENGINEERING_INVALID";
    nextRoute = "REPAIR_ENGINEERING_BEFORE_RESEARCH_CONCLUSION";
  } else if (qualifying.length) {
    decision = "CONSENSUS_DECODING_GAIN_CONFIRMED";
    nextRoute = "C6.1.1_FROZEN_PROSPECTIVE_SHADOW";
  } else if (input.oracle.consensusSpecificOracleGain > 0) {
    decision = "CONSENSUS_ORACLE_POTENTIAL_DECODER_UNSAFE";
    nextRoute = "C6.1.1_DECODER_CALIBRATION_SHADOW_ONLY";
  } else {
    decision = "NO_CONSENSUS_ADVANTAGE_OVER_CANDIDATE_UNION";
    nextRoute = "STOP_AUTOMATIC_CONSENSUS_CONTINUE_HUMAN_ON_EXCEPTION";
  }
  const body = {
    schemaVersion: "1.0.0" as const,
    policyVersion: "c6.1-consensus-investigation-v1" as const,
    artifactType: "c6-1-route-decision" as const,
    decision,
    strongerSignal:
      engineeringPassed && novelGain
        ? ("TOKEN_SPAN_COMBINATION_INFORMATION_GAIN_CONFIRMED" as const)
        : ("NOT_CONFIRMED" as const),
    nextRoute,
    c611Status: nextRoute.startsWith("C6.1.1")
      ? ("GO" as const)
      : ("HOLD" as const),
    c602Status: "HOLD" as const,
    productionStatus: "needs-review" as const,
    finalizationMethod: "none" as const,
    machineOnlyReleaseAuthorized: false as const,
    qualifyingProfiles: engineeringPassed
      ? qualifying.map((p) => p.profileId)
      : [],
    evidenceHashes: [
      input.quality.semanticHash,
      input.oracle.semanticHash,
      input.safety.semanticHash,
    ],
    reasons: [
      "Known development benchmark only; no prospective generalization claim.",
      "Post-hoc best profile is reporting, not a deployed selector.",
      "Local oracle excludes ambiguous Gold mapping; no oracle path enters a decoder.",
      "C6.0.1.12 human-on-exception product route remains unchanged.",
      `Engineering parity: ${String(input.abParity)}; qualifying frozen profiles: ${qualifying.length}.`,
      ...(candidateOnlyRelativeUtility
        ? [
            "Candidate-only MBR has the stronger relative utility; the explicit qualifying-profile gain gate takes precedence over the narrower utility label.",
          ]
        : []),
    ],
  };
  return c61RouteDecisionSchema.parse({ ...body, semanticHash: hash(body) });
}
