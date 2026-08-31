import {
  c6121CoverageSchema,
  c6121CoverageAuditSchema,
  c6121ModeComparisonSchema,
  type C6121Map,
  type C6121Coverage,
  type C6121Labels,
  type C612Label,
  type C612GoldBinding,
  type C6121GoldTimingCue,
  type C6121ProfileMetric,
} from "@mvl/shared";
import type { C612FrozenInputs } from "../top-k/c612-frozen-inputs.js";
import { duration } from "../top-k/c612-structural.js";
import { c612Defined } from "../top-k/c612-policy.js";
import { c6121Artifact, fraction, hash } from "./c6121-policy.js";

export function c6121Coverage(
  frozen: C612FrozenInputs,
  map: C6121Map,
  gold: readonly C6121GoldTimingCue[],
  labels: readonly C612Label[],
  goldCharacters: ReadonlyMap<string, number> | null = null,
): C6121Coverage {
  const groups = map.groups.filter((g) => g.shadowEvaluationEligible);
  const cueIds = new Set(groups.flatMap((g) => g.machineCueIds));
  const goldIds = new Set(groups.flatMap((g) => g.goldCueIds));
  const events = [...new Set(frozen.topK.sets.map((s) => s.eventId))];
  const labeledEvents = events.filter(
    (id) =>
      labels.some((l) => l.eventId === id && l.current && l.eligible) &&
      labels.some((l) => l.eventId === id && !l.current && l.eligible),
  );
  const eligibleIds = new Set(
    labels.filter((l) => l.eligible).map((l) => l.candidateId),
  );
  const characters = (ids: readonly string[]) =>
    ids.reduce((n, id) => n + c612Defined(goldCharacters?.get(id)), 0);
  return c6121CoverageSchema.parse({
    evaluableSupergroupCoverage: fraction(groups.length, map.groups.length),
    evaluableMachineGroupCoverage: fraction(
      frozen.mapping.groups.filter((g) =>
        g.cueIds.every((id) => cueIds.has(id)),
      ).length,
      frozen.mapping.groups.length,
    ),
    evaluableProductionCueCoverage: fraction(
      cueIds.size,
      frozen.production.cues.length,
    ),
    evaluableGoldCueCoverage: fraction(goldIds.size, gold.length),
    evaluableMachineDurationCoverage: fraction(
      duration(frozen.production.cues.filter((c) => cueIds.has(c.id))),
      duration(frozen.production.cues),
    ),
    evaluableGoldDurationCoverage: fraction(
      duration(gold.filter((c) => goldIds.has(c.id))),
      duration(gold),
    ),
    candidateEventLabelCoverage: fraction(labeledEvents.length, events.length),
    candidateLabelCoverage: fraction(
      frozen.ranks.rows.filter((r) => eligibleIds.has(r.candidateId)).length,
      frozen.ranks.rows.length,
    ),
    topKCandidateLabelCoverage: fraction(
      frozen.features.rows.filter((r) => eligibleIds.has(r.candidateId)).length,
      frozen.features.rows.length,
    ),
    evaluableGoldCharacterCoverage: goldCharacters
      ? fraction(characters([...goldIds]), characters(gold.map((g) => g.id)))
      : null,
  });
}

export function c6121CoverageRecovery(
  frozen: C612FrozenInputs,
  map: C6121Map,
  coverage: C6121Coverage,
  old: readonly C612GoldBinding[],
) {
  const rows = frozen.mapping.groups.map((machine) => {
    const previous = c612Defined(
      old.find((b) => b.groupId === machine.groupId),
    );
    const group = c612Defined(
      map.groups.find((g) => g.machineGroupIds.includes(machine.groupId)),
    );
    const recovered =
      !previous.status.startsWith("FIXED_") && group.shadowEvaluationEligible;
    const reasons: string[] = [];
    if (recovered) {
      reasons.push("COVERAGE_RECOVERED");
      if (
        previous.reasons.includes(
          "GOLD_CUE_SPANS_MULTIPLE_FROZEN_MACHINE_GROUPS",
        )
      )
        reasons.push("GOLD_SPANNED_MULTIPLE_MACHINE_GROUPS_REBOUND");
      if (group.machineCueCount > group.goldCueCount)
        reasons.push("MACHINE_SEGMENTATION_FINER_THAN_GOLD");
      if (group.machineCueCount < group.goldCueCount)
        reasons.push("GOLD_SEGMENTATION_FINER_THAN_MACHINE");
      if (group.machineCueCount > 1 && group.goldCueCount > 1)
        reasons.push("MANY_TO_MANY_TEMPORAL_COMPONENT_RECOVERED");
    }
    if (
      group.shadowEvaluationEligible &&
      group.candidateAmbiguousEventIds.length
    )
      reasons.push("SHADOW_EVALUABLE_EVENT_LABEL_STILL_AMBIGUOUS");
    if (!group.shadowEvaluationEligible) {
      if (group.structuralStatus === "CROSS_FOLD_COMPONENT")
        reasons.push("STILL_BLOCKED_BY_CROSS_FOLD");
      if (group.reasons.includes("TEMPORAL_COMPONENT_DURATION_LIMIT"))
        reasons.push("STILL_BLOCKED_BY_DURATION");
      if (group.reasons.includes("TEMPORAL_BRIDGE_GAP_LIMIT"))
        reasons.push("STILL_BLOCKED_BY_GAP");
      if (!group.goldCueIds.length) reasons.push("STILL_NO_GOLD_OVERLAP");
      if (!reasons.length) reasons.push("STILL_BLOCKED_BY_MACHINE_STRUCTURE");
    }
    return {
      machineGroupId: machine.groupId,
      supergroupId: group.supergroupId,
      oldStatus: previous.status,
      newStatus: group.structuralStatus,
      recovered,
      reasons: reasons.sort(),
    };
  });
  const spans = old.filter((b) =>
    b.reasons.includes("GOLD_CUE_SPANS_MULTIPLE_FROZEN_MACHINE_GROUPS"),
  );
  const spanningGold = [
    ...new Set(
      spans
        .flatMap((b) => b.goldCueIds)
        .filter(
          (id) => old.filter((b) => b.goldCueIds.includes(id)).length > 1,
        ),
    ),
  ].sort();
  const oldGold = new Set(
    old
      .filter((b) => b.status.startsWith("FIXED_"))
      .flatMap((b) => b.goldCueIds),
  );
  return c6121CoverageAuditSchema.parse(
    c6121Artifact("c6-1-2-1-evaluation-coverage-recovery-audit", {
      supergroupMapHash: map.semanticHash,
      coverage,
      rows,
      recoveredMachineGroups: rows
        .filter((r) => r.recovered)
        .map((r) => r.machineGroupId),
      recoveredGoldCues: [
        ...new Set(
          map.groups
            .filter((g) => g.shadowEvaluationEligible)
            .flatMap((g) => g.goldCueIds)
            .filter((id) => !oldGold.has(id)),
        ),
      ].sort(),
      goldSpanningMachineGroups: spans.map((b) => b.groupId).sort(),
      goldSpanningGoldCues: spanningGold,
      goldSpanningConnectedComponents: map.groups
        .filter((g) => g.goldCueIds.some((id) => spanningGold.includes(id)))
        .map((g) => g.supergroupId),
      recoveredGoldSpanningMachineGroups: rows
        .filter(
          (r) =>
            r.recovered && spans.some((b) => b.groupId === r.machineGroupId),
        )
        .map((r) => r.machineGroupId),
    }),
  );
}
export function compareC6121Modes(input: {
  frozen: C612FrozenInputs;
  gold: readonly C6121GoldTimingCue[];
  goldCharacters: ReadonlyMap<string, number>;
  maps: readonly [C6121Map, C6121Map, C6121Map];
  labels: readonly [readonly C612Label[], C6121Labels, C6121Labels];
  metrics: readonly [
    readonly C6121ProfileMetric[],
    readonly C6121ProfileMetric[],
    readonly C6121ProfileMetric[],
  ];
}) {
  const modes = [
    "E0_MACHINE_GROUP_BINDING",
    "E1_BASELINE_TEMPORAL_BIPARTITE_COMPONENTS",
    "E2_FROZEN_MACHINE_GROUP_GOLD_TIMING_SUPERGROUP",
  ] as const;
  return c6121ModeComparisonSchema.parse(
    c6121Artifact("c6-1-2-1-evaluation-mode-comparison", {
      primaryEvaluator: modes[2],
      modes: input.maps.map((map, i) => ({
        mode: modes[i],
        groupCount: map.groups.length,
        stableCount: map.groups.filter((g) => g.shadowEvaluationEligible)
          .length,
        ambiguousCount: map.groups.filter(
          (g) => !g.shadowEvaluationEligible && g.goldCueIds.length > 0,
        ).length,
        noMappingCount: map.groups.filter((g) => !g.goldCueIds.length).length,
        coverage: c6121Coverage(
          input.frozen,
          map,
          input.gold,
          i === 0
            ? input.labels[0]
            : c612Defined(input.labels[i] as C6121Labels).labels.map(
                (l) => l.label,
              ),
          input.goldCharacters,
        ),
        crossFoldCount: map.groups.filter((g) => g.frozenFoldIds.length > 1)
          .length,
        policyHash:
          i === 2 ? map.policyHash : hash([modes[i], map.edgeLedgerHash]),
        changedGroupCoverageByProfile: c612Defined(input.metrics[i]).map(
          (p) => ({
            profileId: p.profileId,
            machineGroups: p.changedMachineGroupCoverage,
            supergroups: p.changedSupergroupCoverage,
          }),
        ),
      })),
    }),
  );
}
