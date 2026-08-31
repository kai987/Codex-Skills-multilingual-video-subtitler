import {
  c61211LabelsSchema,
  c61211StabilitySchema,
  type C61211Map,
  type C61211Labels,
  type C6121Labels,
} from "@mvl/shared";
import type { C612FrozenInputs } from "../top-k/c612-frozen-inputs.js";
import type { C612EvaluationCue } from "../top-k/fixed-group-evaluation.js";
import { rebindC6121CandidateLabels } from "../evaluation-recovery/c6121-label-rebinding.js";
import { c612Defined } from "../top-k/c612-policy.js";
import { c61211Artifact, demand } from "./c61211-policy.js";
import { scoringC61211Adapter } from "./scoring-adapter.js";
export function rebindC61211Labels(
  frozen: C612FrozenInputs,
  map: C61211Map,
  gold: readonly C612EvaluationCue[],
  goldByteHash: string,
) {
  demand(
    map.mode === "D1_CONSERVATIVE_MONOTONIC",
    "C61211_ONLY_PRIMARY_LABELS_MAY_TRAIN",
  );
  const adapter = scoringC61211Adapter(map),
    scored = rebindC6121CandidateLabels(frozen, adapter, gold, goldByteHash);
  return c61211LabelsSchema.parse(
    c61211Artifact("gold-c6-1-2-1-1-partition-candidate-labels", {
      partitionMapHash: map.semanticHash,
      scoringAdapterHash: adapter.semanticHash,
      goldByteHash,
      labels: scored.labels.map(({ supergroupId, ...row }) => ({
        ...row,
        partitionBlockId: supergroupId,
        label: {
          ...row.label,
          reasons: row.label.reasons.map((r) =>
            r === "CROSS_SUPERGROUP_CANDIDATE_APPLICATION"
              ? "CROSS_PARTITION_CANDIDATE_APPLICATION"
              : r,
          ),
        },
      })),
      rawGoldTextIncluded: false,
      labelsFedToRuntimeInference: false,
    }),
  );
}
export function stabilityC61211(old: C6121Labels, fresh: C61211Labels) {
  const sign = (n: number | null) => (n === null ? null : Math.sign(n));
  const rows = fresh.labels.map((row) => {
    const prev = c612Defined(
        old.labels.find((l) => l.candidateId === row.candidateId),
      ),
      a = prev.label,
      b = row.label;
    const common = a.eligible && b.eligible;
    return {
      candidateId: row.candidateId,
      eventId: row.eventId,
      oldSupergroupId: prev.supergroupId,
      partitionBlockId: row.partitionBlockId,
      oldEligible: a.eligible,
      newEligible: b.eligible,
      oldLabelClass: a.labelClass,
      newLabelClass: b.labelClass,
      exactLabelAgreement: common
        ? a.labelClass === b.labelClass && a.classification === b.classification
        : null,
      normalizedGainDirectionAgreement: common
        ? sign(a.normalizedGain) === sign(b.normalizedGain)
        : null,
      exactGainDirectionAgreement: common
        ? sign(a.exactGain) === sign(b.exactGain)
        : null,
      materialDirectionAgreement: common
        ? sign(a.materialDelta) === sign(b.materialDelta)
        : null,
      catastrophicAgreement: common
        ? a.catastrophicDeletion === b.catastrophicDeletion
        : null,
    };
  });
  return c61211StabilitySchema.parse(
    c61211Artifact("c6-1-2-1-1-label-stability-audit", {
      oldEvaluableCandidateLabels: rows.filter((r) => r.oldEligible).length,
      newEvaluableCandidateLabels: rows.filter((r) => r.newEligible).length,
      newlyRecoveredCandidateLabels: rows.filter(
        (r) => !r.oldEligible && r.newEligible,
      ).length,
      previouslyEvaluableNowLost: rows.filter(
        (r) => r.oldEligible && !r.newEligible,
      ).length,
      commonEvaluableCount: rows.filter((r) => r.oldEligible && r.newEligible)
        .length,
      stillUnevaluableCandidateLabels: rows.filter(
        (r) => !r.oldEligible && !r.newEligible,
      ).length,
      exactLabelAgreementCount: rows.filter(
        (r) => r.exactLabelAgreement === true,
      ).length,
      normalizedGainDirectionAgreementCount: rows.filter(
        (r) => r.normalizedGainDirectionAgreement === true,
      ).length,
      exactGainDirectionAgreementCount: rows.filter(
        (r) => r.exactGainDirectionAgreement === true,
      ).length,
      materialDirectionAgreementCount: rows.filter(
        (r) => r.materialDirectionAgreement === true,
      ).length,
      catastrophicAgreementCount: rows.filter(
        (r) => r.catastrophicAgreement === true,
      ).length,
      rows,
    }),
  );
}
