import {
  c6121SensitivitySchema,
  type C6121Map,
  type C6121ProfileMetric,
} from "@mvl/shared";
import { c6121Artifact } from "./c6121-policy.js";
import { c612Defined } from "../top-k/c612-policy.js";
export function auditC6121Sensitivity(
  map: C6121Map,
  metrics: readonly (readonly C6121ProfileMetric[])[],
) {
  const e0 = metrics[0] ?? [],
    e2 = metrics[2] ?? [];
  const directionDisagreements = e0.flatMap((profile) =>
    profile.groups.flatMap((old) => {
      const component = map.groups.find((g) =>
        old.machineGroupIds.some((id) => g.machineGroupIds.includes(id)),
      );
      const fresh = e2
        .find((p) => p.profileId === profile.profileId)
        ?.groups.find((g) => g.supergroupId === component?.supergroupId);
      if (
        !component ||
        !old.changed ||
        !fresh?.changed ||
        old.normalizedGain === null ||
        fresh.normalizedGain === null ||
        old.normalizedGain * fresh.normalizedGain >= 0
      )
        return [];
      return old.machineGroupIds.map((id) => ({
        profileId: profile.profileId,
        machineGroupId: id,
        supergroupId: component.supergroupId,
        sourceInterval: component.totalSourceInterval,
        oldGain: c612Defined(old.normalizedGain),
        newGain: c612Defined(fresh.normalizedGain),
        reason:
          "HISTORICAL_LOCAL_ERROR_UNIT_VERSUS_FROZEN_TIMING_SUPERGROUP_JOINT_ERROR_UNIT",
      }));
    }),
  );
  const frozenL1CatastrophicTrace = (
    e0.find((p) => p.profileId === "L1")?.groups ?? []
  )
    .filter((g) => g.changed && g.catastrophicDeletion)
    .flatMap((old) => {
      const group = map.groups.find((g) =>
        old.machineGroupIds.some((id) => g.machineGroupIds.includes(id)),
      );
      const fresh = e2
        .find((p) => p.profileId === "L1")
        ?.groups.find((g) => g.supergroupId === group?.supergroupId);
      return group
        ? old.machineGroupIds.map((machineGroupId) => ({
            machineGroupId,
            supergroupId: group.supergroupId,
            outcome: !fresh?.evaluated
              ? ("UNEVALUABLE" as const)
              : fresh.catastrophicDeletion
                ? ("STILL_CATASTROPHIC" as const)
                : ("EVALUABLE_NOT_CATASTROPHIC" as const),
            reason: fresh?.evaluated
              ? "SAME_FROZEN_L1_SHADOW_JOINT_SUPERGROUP_REEVALUATION"
              : group.reasons.join("|"),
          }))
        : [];
    });
  return c6121SensitivitySchema.parse(
    c6121Artifact("c6-1-2-1-evaluator-sensitivity", {
      comparisons: metrics.flatMap((profiles, i) =>
        profiles.map((p) => ({
          profileId: p.profileId,
          mode: "E" + String(i),
          improved: p.improved,
          regressed: p.regressed,
          neutral: p.neutral,
          unknown: p.unknown,
          normalizedJointGain: p.normalizedJointGain,
          materialDelta: p.materialDelta,
          catastrophicDeletionCount: p.catastrophicDeletionCount,
          precision: p.selectionPrecision,
          harm: p.harmRate,
          folds: p.folds,
        })),
      ),
      directionDisagreements,
      frozenL1CatastrophicTrace,
    }),
  );
}
