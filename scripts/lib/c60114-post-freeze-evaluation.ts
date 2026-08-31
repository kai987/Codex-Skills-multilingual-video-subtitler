import {
  c60114ErrorComponentSchema,
  type C60114ErrorComponent,
  type C60114SourceIdentity,
  type MachineVsGoldEvaluation,
} from "@mvl/shared";
import { c60114UnionIntervals } from "../../packages/video-subtitler/src/review/playback-grounded-coverage-evaluator.js";

type Evaluation = Pick<
  MachineVsGoldEvaluation,
  | "sourceIdentity"
  | "alignments"
  | "missingDialogueCandidates"
  | "hallucinationCandidates"
  | "materialTextErrors"
  | "severeTimingErrors"
>;
export interface C60114ExistingComponentLineage {
  errorComponentId: string;
  coveredItemIds: string[];
  coveredRegionIds: string[];
}

/**
 * Post-freeze adapter only. Reuses upstream defect/alignment identities and never
 * changes matching rules. Each alignment remains atomic; separate alignments
 * are unioned only when they overlap, never by min(start)/max(end).
 */
export function c60114GoldErrorComponents(
  evaluation: Evaluation,
  existingLineage: readonly C60114ExistingComponentLineage[],
  frozenSourceIdentity: C60114SourceIdentity,
): C60114ErrorComponent[] {
  if (
    evaluation.sourceIdentity.sha256 !== frozenSourceIdentity.sourceMediaSha256
  )
    throw new Error("GOLD_EVALUATION_SOURCE_IDENTITY_MISMATCH");
  const alignments = new Map(
    evaluation.alignments.map((row) => [row.alignmentId, row]),
  );
  if (alignments.size !== evaluation.alignments.length)
    throw new Error("DUPLICATE_GOLD_ALIGNMENT_ID");
  const lineage = new Map(
    existingLineage.map((row) => [row.errorComponentId, row]),
  );
  if (lineage.size !== existingLineage.length)
    throw new Error("DUPLICATE_EXISTING_ERROR_COMPONENT_ID");
  const grouped = new Map<string, C60114ErrorComponent>();
  const groups = [
    ["MISSING_DIALOGUE", evaluation.missingDialogueCandidates],
    ["HALLUCINATION", evaluation.hallucinationCandidates],
    ["MATERIAL_TEXT_ERROR", evaluation.materialTextErrors],
    ["SEVERE_TIMING_ERROR", evaluation.severeTimingErrors],
  ] as const;
  for (const [label, defects] of groups)
    for (const defect of defects) {
      const prior = lineage.get(defect.defectId);
      const row: C60114ErrorComponent = grouped.get(defect.defectId) ?? {
        errorComponentId: defect.defectId,
        sourceIdentity: { ...frozenSourceIdentity },
        labels: [],
        defectIds: [defect.defectId],
        alignmentIds: [],
        coveredItemIds: [...(prior?.coveredItemIds ?? [])],
        coveredRegionIds: [...(prior?.coveredRegionIds ?? [])],
        errorIntervals: [],
        mappingStatus: "RESOLVED",
        mappingReasons: [],
      };
      row.labels.push(label);
      if (defect.alignmentIds.length === 0)
        row.mappingReasons.push("GOLD_DEFECT_HAS_NO_ALIGNMENT_IDS");
      for (const alignmentId of defect.alignmentIds) {
        row.alignmentIds.push(alignmentId);
        const alignment = alignments.get(alignmentId);
        if (!alignment) {
          row.mappingReasons.push(
            `GOLD_DEFECT_ALIGNMENT_LINEAGE_MISSING:${alignmentId}`,
          );
          continue;
        }
        // Hallucination is located at the machine cue; missing dialogue at Gold.
        // Other labels retain the established upstream Gold-then-machine policy.
        const start =
          label === "HALLUCINATION"
            ? alignment.machineStart
            : (alignment.goldStart ?? alignment.machineStart);
        const end =
          label === "HALLUCINATION"
            ? alignment.machineEnd
            : (alignment.goldEnd ?? alignment.machineEnd);
        if (
          start === null ||
          end === null ||
          !Number.isFinite(start) ||
          !Number.isFinite(end) ||
          start < 0 ||
          end <= start
        ) {
          row.mappingReasons.push(
            `GOLD_ALIGNMENT_INTERVAL_UNRESOLVED:${alignmentId}`,
          );
          continue;
        }
        row.errorIntervals.push({ start, end });
      }
      grouped.set(row.errorComponentId, row);
    }
  for (const row of existingLineage)
    if (!grouped.has(row.errorComponentId)) {
      // Do not silently discard a frozen denominator we cannot resolve upstream.
      throw new Error(
        `EXISTING_COMPONENT_HAS_NO_UPSTREAM_DEFECT:${row.errorComponentId}`,
      );
    }
  return [...grouped.values()]
    .sort((a, b) => a.errorComponentId.localeCompare(b.errorComponentId))
    .map((row) => {
      row.labels = [...new Set(row.labels)].sort();
      row.alignmentIds = [...new Set(row.alignmentIds)].sort();
      row.coveredItemIds = [...new Set(row.coveredItemIds)].sort();
      row.coveredRegionIds = [...new Set(row.coveredRegionIds)].sort();
      row.mappingReasons = [...new Set(row.mappingReasons)].sort();
      row.errorIntervals = c60114UnionIntervals(row.errorIntervals);
      if (row.mappingReasons.length || row.errorIntervals.length === 0)
        row.mappingStatus = "GOLD_MAPPING_UNRESOLVED";
      return c60114ErrorComponentSchema.parse(row);
    });
}

export interface C60114FreezeVerification {
  freezeSha256: string;
  verifiedArtifactCount: number;
  expectedArtifactCount: number;
  allHashesMatch: boolean;
  sourceIdentityVerified: boolean;
  runtimeGoldInputCount: number;
}

/** The callback ordering is the isolation boundary: failed verification cannot open Gold. */
export async function withC60114PostFreezeGold<T>(input: {
  verifyMachineFreeze: () => Promise<C60114FreezeVerification>;
  loadGoldAfterVerifiedFreeze: (
    verification: C60114FreezeVerification,
  ) => Promise<T>;
}): Promise<T> {
  const verification = await input.verifyMachineFreeze();
  if (
    !/^[a-f0-9]{64}$/u.test(verification.freezeSha256) ||
    !Number.isInteger(verification.expectedArtifactCount) ||
    verification.expectedArtifactCount <= 0 ||
    verification.verifiedArtifactCount !== verification.expectedArtifactCount ||
    !verification.allHashesMatch ||
    !verification.sourceIdentityVerified ||
    verification.runtimeGoldInputCount !== 0
  )
    throw new Error("C60114_MACHINE_FREEZE_NOT_VERIFIED_BEFORE_GOLD_READ");
  return input.loadGoldAfterVerifiedFreeze(verification);
}
