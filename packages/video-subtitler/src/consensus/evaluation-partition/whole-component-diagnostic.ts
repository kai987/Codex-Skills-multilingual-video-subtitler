import {
  c61211WholeSchema,
  c61211BiasSchema,
  c61211SensitivitySchema,
  c61211AttributionSchema,
  type C61211Map,
  type C61211Profile,
  type C61211Conservation,
  type C612GroupDecision,
  type C6121ProfileMetric,
  type c61211StabilitySchema,
  type c61211CutsSchema,
  type c61211CoverageSchema,
  type c6121ModeComparisonSchema,
  type C61211Scope,
} from "@mvl/shared";
import type { z } from "zod";
import type { C612FrozenInputs } from "../top-k/c612-frozen-inputs.js";
import { assembleC612WholeCandidates } from "../top-k/group-shadow-configurations.js";
import { scoreC6121Supergroup } from "../evaluation-recovery/c6121-label-rebinding.js";
import {
  normalize,
  type C612EvaluationCue,
} from "../top-k/fixed-group-evaluation.js";
import { editDistance, chars } from "../top-k/c612-structural.js";
import { c612Defined } from "../top-k/c612-policy.js";
import {
  c61211Artifact,
  fraction,
  validateC61211Artifact,
} from "./c61211-policy.js";
import { unique, type C61211Graph } from "./component-inventory.js";
const sign = (n: number | null) => (n === null ? null : Math.sign(n));
export function wholeC61211(input: {
  frozen: C612FrozenInputs;
  graph: C61211Graph;
  map: C61211Map;
  gold: readonly C612EvaluationCue[];
  tracks: readonly {
    profiles: readonly C61211Profile[];
    decisions: readonly C612GroupDecision[];
  }[];
}) {
  const rows = [],
    globalQuality = [];
  for (const track of input.tracks)
    for (const profile of track.profiles) {
      const shadow = assembleC612WholeCandidates(
        input.frozen.production,
        input.frozen.universe,
        track.decisions
          .filter((d) => d.profileId === profile.profileId)
          .flatMap((d) => d.selections),
      );
      for (const parent of input.graph.map.groups.filter(
        (g) => g.machineGroupIds.length && g.goldCueIds.length,
      )) {
        const whole = scoreC6121Supergroup(
          { ...parent, shadowEvaluationEligible: true },
          input.frozen.production,
          shadow.cues,
          input.gold,
        );
        const blocks = input.map.blocks.filter(
          (b) => b.parentE2SupergroupId === parent.supergroupId,
        );
        const scores = profile.groups.filter((g) =>
          blocks.some((b) => b.partitionBlockId === g.partitionBlockId),
        );
        const fully =
          blocks.length > 0 && blocks.every((b) => b.shadowEvaluationEligible);
        const sum = (key: "exactGain" | "normalizedGain" | "materialDelta") =>
          fully ? scores.reduce((n, g) => n + c612Defined(g[key]), 0) : null;
        const exact = sum("exactGain"),
          normalized = sum("normalizedGain"),
          material = sum("materialDelta");
        const catastrophic = fully
          ? scores.some((g) => g.catastrophicDeletion === true)
          : null;
        rows.push({
          profileId: profile.profileId,
          track: profile.track,
          parentE2SupergroupId: parent.supergroupId,
          fullyEvaluatedPartition: fully,
          partitionBlockIds: blocks.map((b) => b.partitionBlockId),
          whole,
          partitionExactGain: exact,
          partitionNormalizedGain: normalized,
          partitionMaterialDelta: material,
          partitionCatastrophic: catastrophic,
          normalizedDirectionAgreement: fully
            ? sign(normalized) === sign(whole.normalizedGain)
            : null,
          exactDirectionAgreement: fully
            ? sign(exact) === sign(whole.exactGain)
            : null,
          materialDirectionAgreement: fully
            ? sign(material) === sign(whole.materialDelta)
            : null,
          catastrophicAgreement: fully
            ? catastrophic === whole.catastrophicDeletion
            : null,
        });
      }
      const text = shadow.cues
          .map((c) => c.text)
          .join("")
          .normalize("NFC"),
        target = input.gold
          .map((c) => c.text)
          .join("")
          .normalize("NFC");
      const normalizedGoldCharacters = chars(normalize(target)).length,
        normalizedError = editDistance(normalize(text), normalize(target));
      const isolated = new Set(input.graph.map.unmappedGoldCueIds);
      globalQuality.push({
        profileId: profile.profileId,
        track: profile.track,
        goldCueCount: input.gold.length,
        normalizedGoldCharacters,
        exactError: editDistance(text, target),
        normalizedError,
        normalizedCer: normalizedError / Math.max(1, normalizedGoldCharacters),
        goldOnlyMissingCharacters: input.gold
          .filter((g) => isolated.has(g.id))
          .reduce((n, g) => n + chars(normalize(g.text)).length, 0),
      });
    }
  return c61211WholeSchema.parse(
    c61211Artifact("c6-1-2-1-1-whole-component-diagnostic-evaluation", {
      evaluator: "E4_WHOLE_COMPONENT_PROFILE_SCORE_ONLY",
      partitionMapHash: input.map.semanticHash,
      rows,
      globalQuality,
      eligibleForTraining: false,
      eligibleForSafeProfile: false,
      eligibleForRoute: false,
    }),
  );
}
export function biasC61211(
  map: C61211Map,
  whole: z.infer<typeof c61211WholeSchema>,
  integrity: C61211Conservation,
  cuts: z.infer<typeof c61211CutsSchema>,
  stability: z.infer<typeof c61211StabilitySchema>,
) {
  // Direct callers cannot inject a self-hash-stale E4 payload to alter the
  // audit denominator. Persisted-run validators also reconstruct E4 in full.
  validateC61211Artifact(whole);
  // Agreement denominators include changed, wholly evaluated component/profile
  // pairs only; unchanged zeros cannot inflate apparent agreement.
  const changed = whole.rows.filter((r) => r.whole.changed),
    comparable = changed.filter((r) => r.fullyEvaluatedPartition);
  const checks = [
    ["unsafeCutCount", integrity.unsafeCutCount],
    ["strongBridgeCutCount", integrity.strongBridgeCutCount],
    ["nonMonotonicCutCount", integrity.nonMonotonicPartitionCount],
    ["duplicateGoldEvaluationCount", integrity.duplicatedGoldCueCount],
    ["profileSpecificPartitionCount", map.profileRematchingCount],
  ].map(([name, observed]) => ({
    name: String(name),
    observed: String(observed),
    expected: "0",
    passed: observed === 0,
  }));
  return c61211BiasSchema.parse(
    c61211Artifact("c6-1-2-1-1-partition-bias-audit", {
      partitionMapHash: map.semanticHash,
      wholeDiagnosticHash: whole.semanticHash,
      cutEdgeCount: cuts.rows.length,
      cutOverlapSeconds: cuts.independentCutOverlapSeconds,
      maximumComponentDiscardedOverlapRatio: Math.max(
        0,
        ...map.components.map((c) => c.componentDiscardedOverlapRatio),
      ),
      labelDirectionDisagreementCount: stability.rows.filter(
        (r) => r.normalizedGainDirectionAgreement === false,
      ).length,
      comparedProfileComponents: comparable.length,
      gainDirectionAgreementCount: comparable.filter(
        (r) => r.normalizedDirectionAgreement,
      ).length,
      gainDirectionDisagreementCount: comparable.filter(
        (r) => r.normalizedDirectionAgreement === false,
      ).length,
      incomparableCount: changed.length - comparable.length,
      materialDirectionDisagreementCount: comparable.filter(
        (r) => r.materialDirectionAgreement === false,
      ).length,
      catastrophicDisagreementCount: comparable.filter(
        (r) => r.catastrophicAgreement === false,
      ).length,
      disagreementComponentIds: unique(
        comparable
          .filter(
            (r) =>
              !r.normalizedDirectionAgreement ||
              !r.materialDirectionAgreement ||
              !r.catastrophicAgreement,
          )
          .map((r) => r.parentE2SupergroupId),
      ),
      checks,
      passed: checks.every((c) => c.passed),
      wholeComponentScoresUsedForRoute: false,
    }),
  );
}
export function sensitivityC61211(
  old: {
    e0: readonly C6121ProfileMetric[];
    e1: readonly C6121ProfileMetric[];
    e2: readonly C6121ProfileMetric[];
  },
  fresh: readonly C61211Profile[],
  whole: z.infer<typeof c61211WholeSchema>,
  legacyCoverage: z.infer<typeof c6121ModeComparisonSchema>,
  primaryCoverage: z.infer<typeof c61211CoverageSchema>,
  scope: C61211Scope,
  map: C61211Map,
) {
  const rows = [
    ...(["E0", "E1", "E2"] as const).flatMap((evaluator) =>
      old[evaluator.toLowerCase() as keyof typeof old].map((p) => ({
        evaluator,
        profileId: p.profileId,
        track: p.track,
        changedUnits: p.changedSupergroups,
        improved: p.improved,
        regressed: p.regressed,
        neutral: p.neutral,
        unknown: p.unknown,
        normalizedJointGain: p.normalizedJointGain,
        materialDelta: p.materialDelta,
        catastrophic: p.catastrophicDeletionCount,
        folds: p.folds,
        diagnosticOnly: true,
      })),
    ),
    ...fresh.map((p) => ({
      evaluator: "E3" as const,
      profileId: p.profileId,
      track: p.track,
      changedUnits: p.changedBlocks,
      improved: p.improved,
      regressed: p.regressed,
      neutral: p.neutral,
      unknown: p.unknown,
      normalizedJointGain: p.normalizedJointGain,
      materialDelta: p.materialDelta,
      catastrophic: p.catastrophicDeletionCount,
      folds: p.folds,
      diagnosticOnly: false,
    })),
    ...fresh.map((p) => {
      const groups = whole.rows
        .filter(
          (r) =>
            r.profileId === p.profileId &&
            r.track === p.track &&
            r.whole.changed,
        )
        .map((r) => r.whole);
      return {
        evaluator: "E4" as const,
        profileId: p.profileId,
        track: p.track,
        changedUnits: groups.length,
        improved: groups.filter((g) => g.classification === "IMPROVED").length,
        regressed: groups.filter((g) => g.classification === "REGRESSED")
          .length,
        neutral: groups.filter((g) => g.classification === "NEUTRAL").length,
        unknown: 0,
        normalizedJointGain: groups.reduce(
          (n, g) => n + c612Defined(g.normalizedGain),
          0,
        ),
        materialDelta: groups.reduce(
          (n, g) => n + c612Defined(g.materialDelta),
          0,
        ),
        catastrophic: groups.filter((g) => g.catastrophicDeletion).length,
        folds: p.folds.map((f) => {
          const items = groups.filter((g) => g.foldId === f.foldId);
          return {
            foldId: f.foldId,
            changed: items.length,
            evaluated: items.length,
            improved: items.filter((g) => g.classification === "IMPROVED")
              .length,
            regressed: items.filter((g) => g.classification === "REGRESSED")
              .length,
            neutral: items.filter((g) => g.classification === "NEUTRAL").length,
            unknown: 0,
            normalizedJointGain: items.reduce(
              (n, g) => n + c612Defined(g.normalizedGain),
              0,
            ),
          };
        }),
        diagnosticOnly: true,
      };
    }),
  ];
  const e4Parents = new Set(whole.rows.map((r) => r.parentE2SupergroupId));
  const e4Blocks = map.blocks.filter((b) =>
    e4Parents.has(b.parentE2SupergroupId),
  );
  const coverageRows = [
    ...legacyCoverage.modes.map((m, i) => ({
      evaluator: (["E0", "E1", "E2"] as const)[i],
      machineGroupCoverage: m.coverage.evaluableMachineGroupCoverage,
      productionCueCoverage: m.coverage.evaluableProductionCueCoverage,
      globalGoldCoverage: m.coverage.evaluableGoldCueCoverage,
      reachableGoldCoverage: fraction(
        m.coverage.evaluableGoldCueCoverage.numerator,
        scope.interventionReachableGoldCueIds.length,
      ),
      candidateEventLabelCoverage: m.coverage.candidateEventLabelCoverage,
      topKCandidateLabelCoverage: m.coverage.topKCandidateLabelCoverage,
    })),
    {
      evaluator: "E3" as const,
      machineGroupCoverage: primaryCoverage.coverage.allMachineGroupCoverage,
      productionCueCoverage: primaryCoverage.coverage.productionCueCoverage,
      globalGoldCoverage: primaryCoverage.coverage.globalGoldCueCoverage,
      reachableGoldCoverage:
        primaryCoverage.coverage.interventionReachableGoldCueCoverage,
      candidateEventLabelCoverage:
        primaryCoverage.coverage.candidateEventLabelCoverage,
      topKCandidateLabelCoverage:
        primaryCoverage.coverage.topKCandidateLabelCoverage,
    },
    {
      evaluator: "E4" as const,
      machineGroupCoverage: fraction(
        unique(e4Blocks.flatMap((b) => b.machineGroupIds)).length,
        scope.allMachineGroupIds.length,
      ),
      productionCueCoverage: fraction(
        unique(e4Blocks.flatMap((b) => b.machineCueIds)).length,
        scope.allProductionCueIds.length,
      ),
      globalGoldCoverage: fraction(
        unique(e4Blocks.flatMap((b) => b.goldCueIds)).length,
        scope.globalGoldCueIds.length,
      ),
      reachableGoldCoverage: fraction(
        unique(e4Blocks.flatMap((b) => b.goldCueIds)).length,
        scope.interventionReachableGoldCueIds.length,
      ),
      candidateEventLabelCoverage: null,
      topKCandidateLabelCoverage: null,
    },
  ];
  return c61211SensitivitySchema.parse(
    c61211Artifact("c6-1-2-1-1-evaluator-sensitivity", {
      rows,
      coverageRows,
      primaryEvaluator: "E3",
    }),
  );
}
export function attributionC61211(
  graph: C61211Graph,
  map: C61211Map,
  stability: z.infer<typeof c61211StabilitySchema>,
  cuts: z.infer<typeof c61211CutsSchema>,
) {
  return c61211AttributionSchema.parse(
    c61211Artifact("c6-1-2-1-1-coverage-recovery-attribution", {
      rows: graph.map.groups
        .filter((g) => !g.shadowEvaluationEligible)
        .map((g) => {
          const component = c612Defined(
            map.components.find(
              (c) => c.parentE2SupergroupId === g.supergroupId,
            ),
          );
          const blocks = map.blocks.filter(
            (b) =>
              b.parentE2SupergroupId === g.supergroupId &&
              b.shadowEvaluationEligible,
          );
          const recovered = blocks.length > 0;
          return {
            parentE2SupergroupId: g.supergroupId,
            status: component.status,
            reasons: unique([
              component.status,
              ...(!g.machineGroupIds.length ? ["GOLD_ONLY_UNREACHABLE"] : []),
              ...(!g.goldCueIds.length ? ["MACHINE_ONLY_NO_GOLD_BINDING"] : []),
              ...(recovered
                ? [
                    "OVERSIZED_COMPONENT_PARTITIONED",
                    ...(g.machineCueCount > 1 && g.goldCueCount > 1
                      ? ["MANY_TO_MANY_PARTITIONED"]
                      : []),
                  ]
                : []),
              ...(recovered &&
              g.reasons.includes("TEMPORAL_COMPONENT_CUE_LIMIT")
                ? ["CUE_LIMIT_RECOVERED"]
                : []),
              ...(recovered &&
              g.reasons.includes("TEMPORAL_COMPONENT_DURATION_LIMIT")
                ? ["DURATION_LIMIT_RECOVERED"]
                : []),
              ...(recovered && g.reasons.includes("TEMPORAL_BRIDGE_GAP_LIMIT")
                ? ["GAP_LIMIT_RECOVERED"]
                : []),
              ...(component.status === "PARTIALLY_PARTITIONED_WITH_RESIDUAL"
                ? ["PARTIAL_RECOVERY_WITH_RESIDUAL"]
                : []),
              ...(component.status === "UNSPLITTABLE_STRONG_BRIDGE"
                ? ["STRONG_BRIDGE_PREVENTED_CUT"]
                : []),
              ...(component.status === "UNSPLITTABLE_COVERAGE"
                ? ["BIDIRECTIONAL_COVERAGE_STILL_LOW"]
                : []),
              ...(cuts.rows.some((e) => e.parentComponentId === g.supergroupId)
                ? ["WEAK_BRIDGE_CUT"]
                : []),
            ]),
            recoveredMachineGroupIds: unique(
              blocks.flatMap((b) => b.machineGroupIds),
            ),
            recoveredProductionCueIds: unique(
              blocks.flatMap((b) => b.machineCueIds),
            ),
            recoveredGoldCueIds: unique(blocks.flatMap((b) => b.goldCueIds)),
            newlyEvaluableCandidateIds: stability.rows
              .filter(
                (r) =>
                  r.oldSupergroupId === g.supergroupId &&
                  !r.oldEligible &&
                  r.newEligible,
              )
              .map((r) => r.candidateId),
            directionChangedCandidateIds: stability.rows
              .filter(
                (r) =>
                  r.oldSupergroupId === g.supergroupId &&
                  r.normalizedGainDirectionAgreement === false,
              )
              .map((r) => r.candidateId),
          };
        }),
    }),
  );
}
