import path from "node:path";
import {
  c6121E0Schema,
  c6121E1Schema,
  type C611FixedBaselineAlignmentMap,
  type C6121GoldTimingCue,
  type C6121Map,
  type C6121Supergroup,
  type C612GoldBinding,
} from "@mvl/shared";
import { buildC611FixedBaselineAlignmentMap } from "../fixed-baseline-alignment-map.js";
import {
  createC612CandidateLabels,
  evaluateRetrieval,
  type C612EvaluationCue,
} from "../top-k/fixed-group-evaluation.js";
import { evaluateC612Quality } from "../top-k/c612-quality-evaluation.js";
import { assertJsonSemanticHash } from "../top-k/c612-delivery-io.js";
import type { C612FrozenInputs } from "../top-k/c612-frozen-inputs.js";
import type { C6121Prepared } from "./baseline-freeze-verification.js";
import { c6121Artifact, demand, fraction, hash } from "./c6121-policy.js";

export async function replayC6121E0(
  prepared: C6121Prepared,
  directory: string,
  gold: readonly C612EvaluationCue[],
  goldByteHash: string,
) {
  const f = prepared.frozen;
  const labels = createC612CandidateLabels({
    groups: f.mapping.groups,
    production: f.production,
    universe: f.universe,
    ranks: f.ranks.rows,
    sets: f.topK.sets,
    folds: f.folds,
    gold,
    freezeHash: f.freeze.semanticHash,
    goldHash: goldByteHash,
    goldFirstReadAt: prepared.oldBindings.goldFirstReadAt,
    mappingHash: f.mapping.semanticHash,
  });
  const checks = [
    {
      name: "exact-legacy-bindings",
      passed: hash(labels.groupLabels) === hash(prepared.oldBindings),
      observed: labels.groupLabels.semanticHash,
      expected: prepared.oldBindings.semanticHash,
    },
    {
      name: "exact-legacy-candidate-labels",
      passed: hash(labels.labels) === hash(prepared.oldLabels),
      observed: labels.labels.semanticHash,
      expected: prepared.oldLabels.semanticHash,
    },
  ];
  const quality = evaluateC612Quality({
    frozen: f,
    gold,
    bindings: labels.groupLabels.rows,
    goldBindingHash: labels.groupLabels.goldBindingHash,
    labels: labels.labels.labels,
    rankings: prepared.rankings.rows,
    rankingsHash: prepared.rankings.semanticHash,
    decisions: prepared.decisions.rows,
    decisionsHash: prepared.decisions.semanticHash,
    configurations: prepared.configurations.rows,
    configurationsHash: prepared.configurations.semanticHash,
  });
  const retrieval = evaluateRetrieval({
    labels: labels.labels.labels,
    ranks: f.ranks.rows,
    sets: f.topK.sets,
    freezeHash: f.freeze.semanticHash,
  });
  for (const value of [...Object.values(quality), retrieval]) {
    const expected = await assertJsonSemanticHash(
      path.join(directory, "evaluation", value.artifactType + ".json"),
    );
    checks.push({
      name: "legacy-replay:" + value.artifactType,
      passed: hash(expected) === hash(value),
      observed: value.semanticHash,
      expected: String(expected.semanticHash),
    });
  }
  demand(
    checks.every((c) => c.passed),
    "C6121_E0_LEGACY_REPLAY_MISMATCH:" +
      checks
        .filter((c) => !c.passed)
        .map((c) => c.name)
        .join(","),
  );
  const stable = labels.groupLabels.rows.filter((r) =>
    r.status.startsWith("FIXED_"),
  ).length;
  const artifact = c6121E0Schema.parse(
    c6121Artifact("c6-1-2-1-e0-legacy-replay", {
      stable,
      ambiguous: labels.groupLabels.rows.filter((r) => r.status === "AMBIGUOUS")
        .length,
      noMapping: labels.groupLabels.rows.filter(
        (r) => r.status === "NO_MAPPING",
      ).length,
      groupCount: labels.groupLabels.rows.length,
      coverage: fraction(stable, labels.groupLabels.rows.length),
      checks,
      passed: true,
      bindings: labels.groupLabels.rows,
      candidateLabelHash: labels.labels.semanticHash,
      originalQualityHash: checks.find(
        (c) => c.name === "legacy-replay:c6-1-2-cv-results",
      )?.expected,
      recomputedQualityHash: quality.cv.semanticHash,
    }),
  );
  return { artifact, quality, retrieval, labels };
}

export function c6121HistoricalStructure(map: C611FixedBaselineAlignmentMap) {
  return {
    baselineCueOrder: map.baselineCueOrder,
    goldCueOrder: map.goldCueOrder,
    baselineTimingHash: map.baselineTimingHash,
    eventBindingsHash: map.eventBindingsHash,
    mappingPolicy: map.mappingPolicy,
    summary: map.summary,
    unmappedGoldCueIds: map.unmappedGoldCueIds,
    groups: map.groups.map((group) =>
      Object.fromEntries(
        Object.entries(group).filter(
          ([key]) =>
            !["baselineTextHash", "goldTextHash", "semanticHash"].includes(key),
        ),
      ),
    ),
  };
}
/** E1 reuses the exact C6.1.1 implementation and frozen historical metadata.
 * The actual new timing-read clock is independently recorded by the C6121 barrier. */
export function replayC6121E1Timing(
  frozen: C612FrozenInputs,
  timing: readonly C6121GoldTimingCue[],
  historical: C611FixedBaselineAlignmentMap,
) {
  const map = buildC611FixedBaselineAlignmentMap({
    baselineCues: frozen.production.cues.map(({ id, start, end }) => ({
      id,
      start,
      end,
      text: "",
    })),
    goldCues: timing.map((c) => ({ ...c, text: "" })),
    eventBindings: frozen.universe.events.map((e) => ({
      eventId: e.eventId,
      finalCueIds: e.finalCueIds,
    })),
    barrier: {
      machineFreezeHash: historical.machineFreezeHash,
      machineFrozenAt: historical.machineFrozenAt,
      goldFirstReadAt: historical.goldFirstReadAt,
    },
  });
  const actual = hash(c6121HistoricalStructure(map)),
    expected = hash(c6121HistoricalStructure(historical));
  demand(actual === expected, "C6121_E1_HISTORICAL_STRUCTURE_MISMATCH");
  return c6121E1Schema.parse(
    c6121Artifact("c6-1-2-1-e1-historical-bipartite-replay", {
      timingOnlyMap: map,
      historicalStructureParity: true,
      checks: [
        {
          name: "historical-time-only-structure",
          passed: true,
          observed: actual,
          expected,
        },
      ],
    }),
  );
}

function diagnosticGroup(
  frozen: C612FrozenInputs,
  id: string,
  cueIds: string[],
  goldIds: string[],
  eligible: boolean,
  reasons: string[],
  gold: readonly C6121GoldTimingCue[],
): C6121Supergroup {
  const mc = frozen.production.cues.filter((c) => cueIds.includes(c.id)),
    gc = gold.filter((c) => goldIds.includes(c.id));
  const mg = frozen.mapping.groups.filter((g) =>
    g.cueIds.some((c) => cueIds.includes(c)),
  );
  const foldIds = frozen.folds.folds
    .filter((f) => mg.some((g) => f.groupIds.includes(g.groupId)))
    .map((f) => f.foldId);
  const span = (cues: readonly { start: number; end: number }[]) => ({
    start: Math.min(...cues.map((c) => c.start)),
    end: Math.max(...cues.map((c) => c.end)),
  });
  const body: Omit<C6121Supergroup, "semanticHash"> = {
    supergroupId: id,
    machineGroupIds: mg.map((g) => g.groupId),
    machineCueIds: cueIds,
    machineEventIds: [...new Set(mg.flatMap((g) => g.eventIds))],
    goldCueIds: goldIds,
    edgeIds: [],
    foldId: foldIds.length === 1 ? (foldIds[0] ?? null) : null,
    frozenFoldIds: foldIds,
    machineSourceInterval: span(mc),
    goldSourceInterval: gc.length ? span(gc) : null,
    totalSourceInterval: span([...mc, ...gc]),
    machineCoveredRatio: 0,
    goldCoveredRatio: 0,
    machineCueCount: mc.length,
    goldCueCount: gc.length,
    machineGroupCount: mg.length,
    maximumMachineGapSeconds: 0,
    maximumGoldGapSeconds: 0,
    durationSeconds: span([...mc, ...gc]).end - span([...mc, ...gc]).start,
    structuralStatus: eligible
      ? mc.length === 1
        ? gc.length === 1
          ? "FIXED_ONE_TO_ONE"
          : "FIXED_ONE_TO_MANY"
        : gc.length === 1
          ? "FIXED_MANY_TO_ONE"
          : "FIXED_MANY_TO_MANY"
      : gc.length
        ? "STRUCTURE_INCOMPATIBLE"
        : "NO_GOLD_MAPPING",
    shadowEvaluationEligible: eligible,
    candidateLabelEligible: false,
    oofTrainingEligible: false,
    candidateEligibleEventIds: [],
    candidateAmbiguousEventIds: [],
    reasons,
  };
  return { ...body, semanticHash: hash(body) };
}
/** Diagnostic adapters never replace or write the E2 map. They allow exact same
 * shadow text to be scored by the two historical partitions for sensitivity. */
export function diagnosticC6121Map(
  frozen: C612FrozenInputs,
  gold: readonly C6121GoldTimingCue[],
  mode:
    | { kind: "E0"; bindings: readonly C612GoldBinding[] }
    | { kind: "E1"; map: C611FixedBaselineAlignmentMap },
): C6121Map {
  const groups =
    mode.kind === "E0"
      ? mode.bindings.map((b) => {
          const g = frozen.mapping.groups.find((g) => g.groupId === b.groupId);
          demand(g, "C6121_E0_UNKNOWN_MACHINE_GROUP");
          return diagnosticGroup(
            frozen,
            b.groupId,
            g.cueIds,
            b.goldCueIds,
            b.status.startsWith("FIXED_"),
            b.reasons,
            gold,
          );
        })
      : mode.map.groups.map((g) =>
          diagnosticGroup(
            frozen,
            g.groupId,
            g.machineCueIds,
            g.goldCueIds,
            g.mappingStatus.startsWith("FIXED_"),
            g.ambiguityReasons,
            gold,
          ),
        );
  if (mode.kind === "E1")
    for (const group of groups) {
      group.candidateEligibleEventIds = group.shadowEvaluationEligible
        ? group.machineEventIds.filter((id) => {
            const event = frozen.universe.events.find((e) => e.eventId === id),
              span = event?.finalSpan;
            return (
              !!event &&
              !!span?.modifiable &&
              event.finalCueIds.every((c) => group.machineCueIds.includes(c)) &&
              groups.filter((g) => g.machineEventIds.includes(id)).length === 1
            );
          })
        : [];
      group.candidateLabelEligible = group.candidateEligibleEventIds.length > 0;
      const body = Object.fromEntries(
        Object.entries(group).filter(([key]) => key !== "semanticHash"),
      );
      group.semanticHash = hash(body);
    }
  return c6121Artifact("c6-1-2-1-evaluator-supergroup-map", {
    machineMappingHash: frozen.mapping.semanticHash,
    foldHash: frozen.folds.semanticHash,
    goldTimingHash: hash(gold),
    edgeLedgerHash: hash(mode),
    baselineCueOrder: frozen.production.cues.map((c) => c.id),
    goldCueOrder: gold.map((c) => c.id),
    groups,
    unmappedGoldCueIds: gold
      .filter((g) => !groups.some((c) => c.goldCueIds.includes(g.id)))
      .map((g) => g.id),
    goldTextUsedForGroupingCount: 0 as const,
    profileRematchingCount: 0 as const,
  });
}
