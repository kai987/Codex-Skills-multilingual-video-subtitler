import {
  c6015PolicyVersion,
  machineSingleVariantAcousticAuditSchema,
  type C6015Mode,
  type MachineSingleVariantAcousticAudit,
  type MachineVariantEvidenceBundle,
  type SingleVariantAuditStatus,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";

function statusFor(input: {
  ctcScore: number | null;
  tokenCoverage: number;
  speechCoverage: number;
  leftEdgeRisk: boolean;
  rightEdgeRisk: boolean;
  decoderStatus: string;
  averageLogProbability: number | null;
  noSpeechProbability: number | null;
  tokenConflict: boolean;
}): SingleVariantAuditStatus {
  if (input.tokenConflict) return "TOKEN_CONFLICT";
  if (input.speechCoverage < 0.7) return "INCOMPLETE_SPEECH_SPAN";
  if (input.leftEdgeRisk || input.rightEdgeRisk) return "EDGE_TRUNCATED";
  if (input.ctcScore !== null && input.ctcScore < 0.35)
    return "LOW_CTC_SUPPORT";
  if (
    input.decoderStatus === "available" &&
    ((input.averageLogProbability ?? 0) < -1.2 ||
      (input.noSpeechProbability ?? 0) > 0.6)
  ) {
    return "DECODER_LOW_CONFIDENCE";
  }
  if (input.ctcScore === null && input.decoderStatus !== "available")
    return "UNKNOWN";
  if (
    (input.ctcScore ?? 0) >= 0.7 &&
    input.tokenCoverage >= 0.8 &&
    input.speechCoverage >= 0.85
  ) {
    return "VERIFIED_STRONG";
  }
  if (
    (input.ctcScore !== null && input.ctcScore < 0.55) ||
    input.tokenCoverage < 0.4
  ) {
    return "ACOUSTICALLY_WEAK";
  }
  return "ACCEPTABLE";
}

const suspiciousStatuses = new Set<SingleVariantAuditStatus>([
  "ACOUSTICALLY_WEAK",
  "INCOMPLETE_SPEECH_SPAN",
  "EDGE_TRUNCATED",
  "TOKEN_CONFLICT",
  "LOW_CTC_SUPPORT",
  "DECODER_LOW_CONFIDENCE",
  "UNKNOWN",
]);

export function buildSingleVariantAcousticAudit(input: {
  mode: C6015Mode;
  singleVariantIds: readonly string[];
  variantEvidence: MachineVariantEvidenceBundle;
  tokenConflictVariantIds?: ReadonlySet<string>;
  repetitionRiskByVariant?: ReadonlyMap<string, number>;
  pronunciationCoverageByVariant?: ReadonlyMap<string, number>;
  generatedAt?: string;
}): MachineSingleVariantAcousticAudit {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const byVariant = new Map(
    input.variantEvidence.variants.map((variant) => [
      variant.variantId,
      variant,
    ]),
  );
  const events = input.singleVariantIds
    .flatMap((variantId) => {
      const evidence = byVariant.get(variantId);
      if (evidence === undefined) return [];
      const tokenConflict =
        input.tokenConflictVariantIds?.has(variantId) ?? false;
      const auditStatus = statusFor({
        ctcScore: evidence.ctcScore,
        tokenCoverage: evidence.tokenCoverage.coverageRatio,
        speechCoverage: evidence.speechCoverage,
        leftEdgeRisk: evidence.edgeEvidence.leftEdgeRisk,
        rightEdgeRisk: evidence.edgeEvidence.rightEdgeRisk,
        decoderStatus: evidence.decoderEvidence.status,
        averageLogProbability: evidence.decoderEvidence.averageLogProbability,
        noSpeechProbability: evidence.decoderEvidence.noSpeechProbability,
        tokenConflict,
      });
      const reasons = [
        `status:${auditStatus}`,
        `ctc-score:${evidence.ctcScore === null ? "unavailable" : evidence.ctcScore.toFixed(6)}`,
        `token-coverage:${evidence.tokenCoverage.coverageRatio.toFixed(6)}`,
        `speech-coverage:${evidence.speechCoverage.toFixed(6)}`,
        `decoder:${evidence.decoderEvidence.status}`,
      ];
      const core = {
        eventId: evidence.eventId,
        candidateId: evidence.candidateId,
        auditStatus,
        acousticEvidence: {
          ctcEvidenceIds: evidence.ctcEvidenceIds,
          ctcScore: evidence.ctcScore,
          pronunciationCoverage: Math.max(
            0,
            Math.min(
              1,
              input.pronunciationCoverageByVariant?.get(variantId) ??
                (evidence.ctcEvidenceIds.length > 0 ? 1 : 0),
            ),
          ),
          acousticCompleteness: Math.max(
            0,
            Math.min(
              1,
              ((evidence.ctcScore ?? 0) +
                evidence.tokenCoverage.coverageRatio +
                evidence.speechCoverage) /
                3,
            ),
          ),
        },
        tokenCoverage: evidence.tokenCoverage.coverageRatio,
        decoderEvidence: evidence.decoderEvidence,
        speechCoverage: evidence.speechCoverage,
        edgeRisk:
          evidence.edgeEvidence.leftEdgeRisk ||
          evidence.edgeEvidence.rightEdgeRisk,
        repetitionRisk: Math.max(
          0,
          Math.min(1, input.repetitionRiskByVariant?.get(variantId) ?? 0),
        ),
        independentWindowSupportCount: evidence.independentSupportGroups.length,
        reAsrEligibility: suspiciousStatuses.has(auditStatus),
        reasons,
      };
      return [{ ...core, semanticHash: machineQualitySemanticHash(core) }];
    })
    .toSorted((left, right) => left.eventId.localeCompare(right.eventId));
  const summary = {
    singleVariantEventCount: input.singleVariantIds.length,
    auditedCount: events.length,
    verifiedStrongCount: events.filter(
      (event) => event.auditStatus === "VERIFIED_STRONG",
    ).length,
    acceptableCount: events.filter(
      (event) => event.auditStatus === "ACCEPTABLE",
    ).length,
    suspiciousCount: events.filter((event) => event.reAsrEligibility).length,
    reAsrEligibleCount: events.filter((event) => event.reAsrEligibility).length,
    unknownCount: events.filter((event) => event.auditStatus === "UNKNOWN")
      .length,
  };
  const core = { mode: input.mode, events, summary };
  return machineSingleVariantAcousticAuditSchema.parse({
    schemaVersion: "1.0.0",
    policyVersion: c6015PolicyVersion,
    generatedAt,
    artifactType: "machine-single-variant-acoustic-audit",
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
}
