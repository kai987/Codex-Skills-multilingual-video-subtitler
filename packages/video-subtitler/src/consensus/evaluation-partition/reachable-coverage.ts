import {
  c61211ScopeSchema,
  c61211CoverageSchema,
  c61211GateSchema,
  type C61211Map,
  type C61211Scope,
  type C61211Conservation,
  type C612Label,
  type C6121GoldTimingCue,
} from "@mvl/shared";
import type { z } from "zod";
import type { C612FrozenInputs } from "../top-k/c612-frozen-inputs.js";
import { duration } from "../top-k/c612-structural.js";
import { c612Defined } from "../top-k/c612-policy.js";
import {
  c61211Artifact,
  C61211_COVERAGE_POLICY,
  demand,
  hash,
  fraction,
} from "./c61211-policy.js";
import { unique, type C61211Graph } from "./component-inventory.js";

/** Machine-only candidate scope is independent of all Gold evidence. */
export function candidateC61211Scope(frozen: C612FrozenInputs) {
  const events = unique(frozen.topK.sets.map((s) => s.eventId));
  const candidateReachableEventIds = events.filter((eventId) => {
    const sets = frozen.topK.sets.filter((s) => s.eventId === eventId);
    return sets.some(
      (s) =>
        frozen.ranks.rows.some(
          (r) =>
            r.eventId === eventId &&
            r.candidateId === s.currentCandidateId &&
            r.currentCandidate,
        ) &&
        s.alternativeIds.some((id) =>
          frozen.ranks.rows.some(
            (r) =>
              r.eventId === eventId &&
              r.candidateId === id &&
              !r.currentCandidate &&
              r.structuralEligible,
          ),
        ),
    );
  });
  const groups = frozen.mapping.groups.filter((g) =>
    g.eventIds.some((id) => candidateReachableEventIds.includes(id)),
  );
  return {
    candidateReachableEventIds,
    candidateReachableMachineGroupIds: unique(groups.map((g) => g.groupId)),
    candidateReachableProductionCueIds: unique(groups.flatMap((g) => g.cueIds)),
    frozenCandidateEventIds: events,
  };
}
export function reachableC61211Scope(
  frozen: C612FrozenInputs,
  graph: C61211Graph,
): C61211Scope {
  const candidate = candidateC61211Scope(frozen);
  const globalGoldCueIds = [...graph.map.goldCueOrder],
    interventionReachableGoldCueIds = globalGoldCueIds.filter((id) =>
      graph.edgeLedger.rows.some((e) => e.goldCueId === id),
    );
  return c61211ScopeSchema.parse(
    c61211Artifact("c6-1-2-1-1-reachable-scope", {
      e2MapHash: graph.map.semanticHash,
      candidateSetHash: frozen.topK.semanticHash,
      scopeDefinitionHash: hash(C61211_COVERAGE_POLICY),
      globalGoldCueIds,
      interventionReachableGoldCueIds,
      goldOnlyUnreachableCueIds: globalGoldCueIds.filter(
        (id) => !interventionReachableGoldCueIds.includes(id),
      ),
      allMachineGroupIds: unique(frozen.mapping.groups.map((g) => g.groupId)),
      allProductionCueIds: frozen.production.cues.map((c) => c.id),
      ...candidate,
      allCandidateIds: unique(frozen.ranks.rows.map((r) => r.candidateId)),
      topKCandidateIds: unique(frozen.features.rows.map((r) => r.candidateId)),
      rawGoldTextIncluded: false,
    }),
  );
}
export function structuralC61211LabelIds(
  frozen: C612FrozenInputs,
  map: C61211Map,
) {
  return unique(
    frozen.ranks.rows
      .filter((r) => {
        const owners = map.blocks.filter((b) =>
          b.machineEventIds.includes(r.eventId),
        );
        const block = owners.length === 1 ? owners[0] : undefined;
        return (
          block?.candidateLabelEligible &&
          block.candidateEligibleEventIds.includes(r.eventId) &&
          (r.currentCandidate || r.structuralEligible)
        );
      })
      .map((r) => r.candidateId),
  );
}
export function coverageC61211(
  frozen: C612FrozenInputs,
  map: C61211Map,
  scope: C61211Scope,
  gold: readonly C6121GoldTimingCue[],
  labels: readonly C612Label[] | null = null,
  goldCharacters: ReadonlyMap<string, number> | null = null,
) {
  demand(
    scope.e2MapHash === map.e2MapHash &&
      scope.candidateSetHash === frozen.topK.semanticHash,
    "C61211_SCOPE_BINDING",
  );
  const blocks = map.blocks.filter((b) => b.shadowEvaluationEligible),
    evaluableMachineGroupIds = unique(blocks.flatMap((b) => b.machineGroupIds)),
    evaluableProductionCueIds = unique(blocks.flatMap((b) => b.machineCueIds)),
    evaluableGoldCueIds = unique(blocks.flatMap((b) => b.goldCueIds));
  const evaluableCandidateIds = structuralC61211LabelIds(frozen, map);
  if (labels)
    demand(
      hash(
        unique(labels.filter((l) => l.eligible).map((l) => l.candidateId)),
      ) === hash(evaluableCandidateIds),
      "C61211_GOLD_TEXT_CHANGED_STRUCTURAL_ELIGIBILITY",
    );
  const evaluableEventIds = scope.frozenCandidateEventIds.filter(
    (id) =>
      frozen.ranks.rows.some(
        (r) =>
          r.eventId === id &&
          r.currentCandidate &&
          evaluableCandidateIds.includes(r.candidateId),
      ) &&
      frozen.ranks.rows.some(
        (r) =>
          r.eventId === id &&
          !r.currentCandidate &&
          evaluableCandidateIds.includes(r.candidateId),
      ),
  );
  const coverage = (num: readonly string[], den: readonly string[]) =>
    fraction(den.filter((id) => num.includes(id)).length, den.length);
  const machineDuration = (ids: readonly string[]) =>
    duration(frozen.production.cues.filter((c) => ids.includes(c.id)));
  const goldDuration = (ids: readonly string[]) =>
    duration(gold.filter((c) => ids.includes(c.id)));
  const characters = (ids: readonly string[]) =>
    ids.reduce((n, id) => n + c612Defined(goldCharacters?.get(id)), 0);
  return c61211CoverageSchema.parse(
    c61211Artifact("c6-1-2-1-1-reachable-coverage-audit", {
      mode: map.mode,
      partitionMapHash: map.semanticHash,
      reachableScopeHash: scope.semanticHash,
      evaluableMachineGroupIds,
      evaluableProductionCueIds,
      evaluableGoldCueIds,
      evaluableEventIds,
      evaluableCandidateIds,
      globalGoldCoverageIsDiagnosticOnly: true,
      coverage: {
        allMachineGroupCoverage: coverage(
          evaluableMachineGroupIds,
          scope.allMachineGroupIds,
        ),
        productionCueCoverage: coverage(
          evaluableProductionCueIds,
          scope.allProductionCueIds,
        ),
        globalGoldCueCoverage: coverage(
          evaluableGoldCueIds,
          scope.globalGoldCueIds,
        ),
        interventionReachableGoldCueCoverage: coverage(
          evaluableGoldCueIds,
          scope.interventionReachableGoldCueIds,
        ),
        candidateReachableMachineGroupCoverage: coverage(
          evaluableMachineGroupIds,
          scope.candidateReachableMachineGroupIds,
        ),
        candidateReachableProductionCueCoverage: coverage(
          evaluableProductionCueIds,
          scope.candidateReachableProductionCueIds,
        ),
        candidateEventLabelCoverage: coverage(
          evaluableEventIds,
          scope.frozenCandidateEventIds,
        ),
        candidateLabelCoverage: coverage(
          evaluableCandidateIds,
          scope.allCandidateIds,
        ),
        topKCandidateLabelCoverage: coverage(
          evaluableCandidateIds,
          scope.topKCandidateIds,
        ),
        machineDurationCoverage: fraction(
          machineDuration(evaluableProductionCueIds),
          machineDuration(scope.allProductionCueIds),
        ),
        globalGoldDurationCoverage: fraction(
          goldDuration(evaluableGoldCueIds),
          goldDuration(scope.globalGoldCueIds),
        ),
        reachableGoldDurationCoverage: fraction(
          goldDuration(
            evaluableGoldCueIds.filter((id) =>
              scope.interventionReachableGoldCueIds.includes(id),
            ),
          ),
          goldDuration(scope.interventionReachableGoldCueIds),
        ),
        globalGoldCharacterCoverage: goldCharacters
          ? fraction(
              characters(evaluableGoldCueIds),
              characters(scope.globalGoldCueIds),
            )
          : null,
      },
    }),
  );
}
/** Deliberately has no profile/selection input. Zero-select L6 is not coverage. */
export function coverageC61211Gate(
  coverage: z.infer<typeof c61211CoverageSchema>,
  integrity: C61211Conservation,
) {
  demand(
    coverage.mode === "D1_CONSERVATIVE_MONOTONIC" &&
      integrity.mode === "D1_CONSERVATIVE_MONOTONIC",
    "C61211_ONLY_D1_MAY_AUTHORIZE_ROUTE",
  );
  demand(
    coverage.partitionMapHash === integrity.partitionMapHash,
    "C61211_GATE_MAP_BINDING",
  );
  const checks: {
    name: string;
    passed: boolean;
    observed: string;
    expected: string;
  }[] = C61211_COVERAGE_POLICY.gateMetrics.map((name) => ({
    name,
    passed:
      coverage.coverage[name].ratio !== null &&
      c612Defined(coverage.coverage[name].ratio) >=
        C61211_COVERAGE_POLICY.minimumCoverage,
    observed: JSON.stringify(coverage.coverage[name]),
    expected: ">=0.80 with a nonzero frozen denominator",
  }));
  for (const name of [
    "crossFoldPartitionCount",
    "duplicatedMachineGroupCount",
    "missingMachineGroupCount",
    "duplicatedProductionCueCount",
    "missingProductionCueCount",
    "duplicatedGoldCueCount",
    "missingGoldCueCount",
    "unaccountedEdgeCount",
    "multiplyAccountedEdgeCount",
    "unsafeCutCount",
    "strongBridgeCutCount",
    "nonMonotonicPartitionCount",
    "retainedOverlapViolationCount",
    "cutLossViolationCount",
    "goldTextUsedForPartitionCount",
    "profileRematchingCount",
  ] as const) {
    checks.push({
      name,
      passed: integrity[name] === 0,
      observed: String(integrity[name]),
      expected: "0",
    });
  }
  checks.push({
    name: "partitionConservationPassed",
    passed: integrity.passed,
    observed: String(integrity.passed),
    expected: "true",
  });
  return c61211GateSchema.parse(
    c61211Artifact("c6-1-2-1-1-coverage-gate-v2", {
      partitionMapHash: coverage.partitionMapHash,
      coverageAuditHash: coverage.semanticHash,
      checks,
      passed: checks.every((c) => c.passed),
      profileSelectionUsed: false,
      globalGoldCoverageUsed: false,
      primaryMode: "D1_CONSERVATIVE_MONOTONIC",
    }),
  );
}
