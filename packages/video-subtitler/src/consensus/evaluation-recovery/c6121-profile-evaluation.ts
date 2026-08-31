import {
  c6121ProfileMetricSchema,
  type C6121Map,
  type C6121ProfileMetric,
  type C6121GroupScore,
  type C612Label,
  type C612Ranking,
  type C612GroupDecision,
} from "@mvl/shared";
import type { C612FrozenInputs } from "../top-k/c612-frozen-inputs.js";
import { assembleC612WholeCandidates } from "../top-k/group-shadow-configurations.js";
import {
  rankingQuality,
  type C612EvaluationCue,
} from "../top-k/fixed-group-evaluation.js";
import { c612Defined } from "../top-k/c612-policy.js";
import { scoreC6121Supergroup } from "./c6121-label-rebinding.js";
import { demand, fraction } from "./c6121-policy.js";

export function evaluateC6121Profiles(input: {
  frozen: C612FrozenInputs;
  map: C6121Map;
  gold: readonly C612EvaluationCue[];
  labels: readonly C612Label[];
  rankings: readonly C612Ranking[];
  decisions: readonly C612GroupDecision[];
  track: C6121ProfileMetric["track"];
}): C6121ProfileMetric[] {
  const { frozen, map } = input;
  return [...new Set(input.rankings.map((r) => r.profileId))]
    .filter((id) => /^L[0-8]$/.test(id))
    .sort()
    .map((profileId) => {
      const decisions = input.decisions.filter(
        (d) => d.profileId === profileId,
      );
      const shadow = assembleC612WholeCandidates(
        frozen.production,
        frozen.universe,
        decisions.flatMap((d) => d.selections),
      );
      demand(shadow.eligible, "C6121_PROFILE_JOINT_ASSEMBLY_FAILED");
      const groups = map.groups.map((g) =>
        scoreC6121Supergroup(g, frozen.production, shadow.cues, input.gold),
      );
      const changed = groups.filter((g) => g.changed),
        evaluated = changed.filter((g) => g.evaluated);
      const changedMachineIds = new Set(
        frozen.mapping.groups
          .filter((g) =>
            g.cueIds.some(
              (id) =>
                frozen.production.cues.find((c) => c.id === id)?.text !==
                shadow.cues.find((c) => c.id === id)?.text,
            ),
          )
          .map((g) => g.groupId),
      );
      const eligibleCues = new Set(
        map.groups
          .filter((g) => g.shadowEvaluationEligible)
          .flatMap((g) => g.machineCueIds),
      );
      const evaluableMachineIds = new Set(
        frozen.mapping.groups
          .filter((g) => g.cueIds.every((id) => eligibleCues.has(id)))
          .map((g) => g.groupId),
      );
      const improved = evaluated.filter(
        (g) => c612Defined(g.normalizedGain) > 0,
      ).length;
      const regressed = evaluated.filter(
        (g) => c612Defined(g.normalizedGain) < 0,
      ).length;
      const neutral = evaluated.filter((g) => g.normalizedGain === 0).length;
      const sumKnown = (
        key:
          | "exactGain"
          | "normalizedGain"
          | "materialDelta"
          | "legacyMaterialDelta",
        items: C6121GroupScore[],
      ) =>
        !items.length
          ? 0
          : items.some((g) => g.evaluated)
            ? items
                .filter((g) => g.evaluated)
                .reduce((n, g) => n + c612Defined(g[key]), 0)
            : null;
      const folds = frozen.folds.folds.map((f) => {
        const items = changed.filter(
          (g) =>
            g.foldId === f.foldId ||
            (g.foldId === null &&
              map.groups
                .find((m) => m.supergroupId === g.supergroupId)
                ?.frozenFoldIds.includes(f.foldId)),
        );
        return {
          foldId: f.foldId,
          changed: items.length,
          evaluated: items.filter((g) => g.evaluated).length,
          improved: items.filter((g) => g.classification === "IMPROVED").length,
          regressed: items.filter((g) => g.classification === "REGRESSED")
            .length,
          neutral: items.filter((g) => g.classification === "NEUTRAL").length,
          unknown: items.filter((g) => !g.evaluated).length,
          normalizedJointGain: sumKnown("normalizedGain", items),
        };
      });
      const ranked = input.rankings
        .filter((r) => r.profileId === profileId)
        .flatMap((r) => {
          const result = rankingQuality(
            r.ranked.map((c) => c.candidateId),
            input.labels,
          );
          return result ? [result] : [];
        });
      return c6121ProfileMetricSchema.parse({
        profileId,
        track: input.track,
        supergroupMapHash: map.semanticHash,
        changedSupergroups: changed.length,
        evaluableChangedSupergroups: evaluated.length,
        changedMachineGroups: changedMachineIds.size,
        improved,
        regressed,
        neutral,
        unknown: changed.length - evaluated.length,
        selectionPrecision:
          improved + regressed ? improved / (improved + regressed) : null,
        harmRate: evaluated.length ? regressed / evaluated.length : null,
        exactJointGain: sumKnown("exactGain", changed),
        normalizedJointGain: sumKnown("normalizedGain", changed),
        materialDelta: sumKnown("materialDelta", changed),
        legacyMaterialDelta: sumKnown("legacyMaterialDelta", changed),
        catastrophicDeletionCount: evaluated.filter(
          (g) => g.catastrophicDeletion,
        ).length,
        changedSupergroupCoverage: fraction(evaluated.length, changed.length),
        changedMachineGroupCoverage: fraction(
          [...changedMachineIds].filter((id) => evaluableMachineIds.has(id))
            .length,
          changedMachineIds.size,
        ),
        zeroSelectionChangedCoverage: changed.length
          ? evaluated.length / changed.length
          : 0,
        activeFoldCount: folds.filter((f) => f.changed > 0).length,
        negativeGainFoldCount: folds.filter(
          (f) => f.normalizedJointGain !== null && f.normalizedJointGain < 0,
        ).length,
        unknownGainFoldCount: folds.filter((f) => f.unknown > 0).length,
        top1Accuracy: fraction(
          ranked.reduce((n, r) => n + r.accuracy, 0),
          ranked.length,
        ),
        folds,
        groups,
      });
    });
}
