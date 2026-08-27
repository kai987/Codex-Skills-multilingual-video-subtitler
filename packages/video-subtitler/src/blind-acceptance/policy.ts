import {
  blindEvaluationPolicySchema,
  machineShadowFinalizationPolicySchema,
  type BlindEvaluationPolicy,
  type MachineShadowFinalizationPolicy,
} from "@mvl/shared";

import { c60StableHash } from "../finalization-risk-policy.js";

export const C601_SHADOW_POLICY_VERSION =
  "c6.0.1-machine-shadow-finalization-v1" as const;
export const C601_EVALUATION_POLICY_VERSION =
  "c6.0.1-gold-isolated-evaluation-v1" as const;

const shadowPolicyBase = {
  schemaVersion: "1.0.0" as const,
  artifactType: "machine-shadow-finalization-policy" as const,
  policyVersion: C601_SHADOW_POLICY_VERSION,
  machineOnlyReleaseAuthorized: false as const,
  positiveEvidenceRequired: true as const,
  unknownSignalsFailClosed: true as const,
  productionStatusUnaffected: true as const,
  requiredChecks: [
    "source-integrity",
    "canonical-integrity",
    "serialization-round-trip",
    "format-semantic-parity",
    "zero-unknown-signals",
    "zero-positive-current-output-defects",
    "critical-machine-evidence-coverage",
    "zero-unresolved-high-risk-regions",
    "zero-gold-derived-provenance",
    "blind-isolation",
  ],
  rejectionChecks: [
    "source-corruption",
    "canonical-corruption",
    "serialization-corruption",
    "blind-isolation-violation",
    "gold-derived-provenance",
  ],
  rationale:
    "Machine-only final candidacy requires explicit positive evidence for every critical dimension. Absence of a known defect is never sufficient, and the production machine release gate remains closed.",
};

export const C601_MACHINE_SHADOW_POLICY: MachineShadowFinalizationPolicy =
  machineShadowFinalizationPolicySchema.parse({
    ...shadowPolicyBase,
    policyHash: c60StableHash(shadowPolicyBase),
  });

const evaluationPolicyConfig = {
  schemaVersion: "1.0.0" as const,
  artifactType: "blind-evaluation-policy" as const,
  policyVersion: C601_EVALUATION_POLICY_VERSION,
  normalization: {
    unicode: "NFKC" as const,
    whitespaceInsensitive: true as const,
    punctuationInsensitive: true as const,
    dialectStandardization: false as const,
    arbitraryKanaConversion: false as const,
  },
  alignmentWeights: {
    textSimilarity: 0.55,
    temporalIoU: 0.3,
    centerDistance: 0.15,
  },
  thresholds: {
    maximumAlignmentGroupSize: 3 as const,
    minimumMatchTextSimilarity: 0.3,
    minimumMatchTemporalIoU: 0.1,
    maximumMatchCenterDistanceSeconds: 4,
    materialMinimumCharacters: 4,
    materialTextErrorCer: 0.45,
    severeTimingBoundarySeconds: 2,
    minorTimingBoundarySeconds: 0.25,
    maximumCrossRunCer: 0.005,
    maximumCrossRunBoundaryP95Seconds: 0.05,
    maximumCrossRunBoundaryMaxSeconds: 0.15,
  },
  defectRules: [
    {
      code: "GOLD_ISOLATION_VIOLATION",
      severity: "P0" as const,
      rationale:
        "Human-derived evidence before the freeze invalidates the blind acceptance run.",
    },
    {
      code: "OUTPUT_MUTATED_AFTER_FREEZE",
      severity: "P0" as const,
      rationale:
        "A post-freeze machine artifact mutation invalidates causal evaluation.",
    },
    {
      code: "BROKEN_SERIALIZATION",
      severity: "P0" as const,
      rationale: "Unreadable machine subtitle serialization is corruption.",
    },
    {
      code: "MISSING_DIALOGUE_CANDIDATE",
      severity: "P1" as const,
      rationale:
        "An unmatched Gold group with at least four normalized characters represents material dialogue loss.",
    },
    {
      code: "HALLUCINATION_CANDIDATE",
      severity: "P1" as const,
      rationale:
        "An unmatched machine group with at least four normalized characters is a material unsupported output candidate.",
    },
    {
      code: "MATERIAL_TRANSCRIPTION_ERROR",
      severity: "P1" as const,
      rationale:
        "Aligned material text at or above 0.45 normalized CER is a material transcription defect.",
    },
    {
      code: "SEVERE_TIMING_ERROR",
      severity: "P1" as const,
      rationale:
        "A text-supported group with a boundary error above two seconds can associate dialogue with the wrong moment.",
    },
    {
      code: "MINOR_TEXT_DIFFERENCE",
      severity: "P2" as const,
      rationale:
        "Non-material lexical, punctuation, or orthographic differences remain advisory.",
    },
    {
      code: "MINOR_TIMING_DIFFERENCE",
      severity: "P2" as const,
      rationale:
        "Boundary differences above 250 ms but below the severe threshold remain advisory.",
    },
    {
      code: "SEGMENTATION_ONLY_DIFFERENCE",
      severity: "P2" as const,
      rationale:
        "Split or merged cues are not critical when group text and temporal semantics remain supported.",
    },
  ],
};

export function createC601EvaluationPolicy(
  frozenAt: string,
): BlindEvaluationPolicy {
  return blindEvaluationPolicySchema.parse({
    ...evaluationPolicyConfig,
    frozenAt,
    policyHash: c60StableHash(evaluationPolicyConfig),
  });
}
