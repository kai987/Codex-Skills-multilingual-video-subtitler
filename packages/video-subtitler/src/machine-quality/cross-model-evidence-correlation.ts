import type {
  C60110EvidenceFamily,
  C60110ReasonCode,
  CrossModelArbitrationEvidenceBundle,
} from "@mvl/shared";

export const c60110CorrelationGroups = {
  whisper: "model-family:whisper",
  reazonDataFamily: "data-family:reazonspeech",
  localization: "localization:machine-acoustic",
  spanLineage: "lineage:pipeline-provenance",
} as const;

export function independentSupportGroupIds(
  bundle: CrossModelArbitrationEvidenceBundle,
  reasons: readonly C60110ReasonCode[],
): string[] {
  const accepted = new Set(reasons);
  return [
    ...new Set(
      bundle.evidenceAtoms
        .filter(
          (atom) =>
            accepted.has(atom.reasonCode) &&
            (atom.tier === "STRONG_SUPPORT" || atom.tier === "SUPPORT"),
        )
        .map((atom) => atom.correlationGroupId),
    ),
  ].toSorted();
}

export function independentSupportFamilyCount(
  bundle: CrossModelArbitrationEvidenceBundle,
  reasons: readonly C60110ReasonCode[],
): number {
  return independentSupportGroupIds(bundle, reasons).length;
}

export function isCtcCorrelatedWithReazon(
  family: C60110EvidenceFamily,
): boolean {
  return family === "CTC_REAZON_DATA_FAMILY";
}

/**
 * CTC and Reazon stability share one ReazonSpeech data/model-family group.
 * This function intentionally returns one vote for that entire group, not one
 * vote per artifact or score.
 */
export function independentVoteCount(
  bundle: CrossModelArbitrationEvidenceBundle,
  reasonCodes: readonly C60110ReasonCode[],
): number {
  return independentSupportGroupIds(bundle, reasonCodes).length;
}
