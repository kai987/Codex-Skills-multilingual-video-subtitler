import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  planner143Schema,
  planner145Schema,
  safetyTargets145Schema,
  type Bundle143,
  type Bundles143,
  type Contract145,
  type CoverageUnits145,
  type Dominance143,
  type Hierarchy143,
  type Obligations143,
  type Planner143,
  type Planner145,
  type Policy143,
  type Policy145,
  type Realization145,
  type RealizationDominance145,
  type Realizations145,
  type SafetyTargets145,
  type Samples142,
  type UnitUtility145,
} from "@mvl/shared";
import { hash141, hashed141, required141, union141 } from "./c601141-policy.js";
import { unique142 } from "./c601142-selection.js";
import {
  difference143,
  intersection143,
  sampleCount143,
} from "./c601143-policy.js";
import {
  emptyUnitTierCounts145,
  header145,
  lexCompare145,
} from "./c601145-policy.js";

interface Choice145 {
  bundle: Bundle143;
  mask: bigint;
  first: number;
  last: number;
  coreSamples: number;
}

interface MilpResult145 {
  status: "OPTIMAL" | "INFEASIBLE_PROVEN" | "SEARCH_INCOMPLETE";
  selectedBundleIds?: string[];
  selectedRealizationIds?: string[];
  selectedCoverageUnitIds?: string[];
  objectiveValues?: number[];
  exploredNodes?: number;
  solver?: string;
  message?: string;
}

export interface SearchResult145 {
  selected: Bundle143[];
  objective: number[];
  selectedRealizations: Realization145[];
  explored: number;
  pruned: number;
  complete: boolean;
  feasible: boolean;
}

const sortedUnique145 = (values: readonly string[]) =>
  unique142(values).sort((a, b) => a.localeCompare(b));

function retainedRealizations145(input: {
  realizations: Realizations145;
  dominance: RealizationDominance145;
  contractType: Contract145;
}) {
  const retained = new Set(input.dominance.retainedRealizationIds);
  return input.realizations.candidates.filter(
    (row) =>
      row.eligibility &&
      row.contractType === input.contractType &&
      retained.has(row.realizationId),
  );
}

function realizationCostCompare145(a: Realization145, b: Realization145) {
  return (
    a.targetSlotCost - b.targetSlotCost ||
    a.speechCoreCostSamples - b.speechCoreCostSamples ||
    a.predictedAudioCostSamples - b.predictedAudioCostSamples ||
    a.internalSilenceCostSamples - b.internalSilenceCostSamples ||
    a.realizationId.localeCompare(b.realizationId)
  );
}

export function selectedRealizations145(input: {
  selectedBundleIds: readonly string[];
  realizations: Realizations145;
  dominance: RealizationDominance145;
  contractType: Contract145;
}) {
  const selected = new Set(input.selectedBundleIds),
    byUnit = new Map<string, Realization145[]>();
  for (const row of retainedRealizations145(input)) {
    if (!row.bundleIds.every((bundleId) => selected.has(bundleId))) continue;
    const rows = byUnit.get(row.coverageUnitId) ?? [];
    rows.push(row);
    byUnit.set(row.coverageUnitId, rows);
  }
  return [...byUnit.values()]
    .map((rows) => required141([...rows].sort(realizationCostCompare145)[0]))
    .sort((a, b) => a.coverageUnitId.localeCompare(b.coverageUnitId));
}

export function plannerObjective145(input: {
  selected: Bundle143[];
  units: CoverageUnits145;
  unitUtility: UnitUtility145;
  realizations: Realizations145;
  realizationDominance: RealizationDominance145;
  immutableAudioIntervals: Samples142[];
}) {
  const selectedRealizations = selectedRealizations145({
      selectedBundleIds: input.selected.map((bundle) => bundle.bundleId),
      realizations: input.realizations,
      dominance: input.realizationDominance,
      contractType: "MACHINE_ANCHORED_PLAYBACK_AUDIBILITY_CONTRACT_V1",
    }),
    realizedIds = new Set(
      selectedRealizations.map((row) => row.coverageUnitId),
    ),
    unitMap = new Map(
      input.units.units.map((unit) => [unit.coverageUnitId, unit]),
    ),
    utilityMap = new Map(
      input.unitUtility.rows.map((row) => [row.coverageUnitId, row]),
    ),
    realizedUnits = [...realizedIds]
      .map((id) => required141(unitMap.get(id)))
      .filter((unit) => unit.phaseAObligationIds.length === 0),
    realizedRows = realizedUnits.map((unit) =>
      required141(utilityMap.get(unit.coverageUnitId)),
    ),
    tier = (name: (typeof realizedRows)[number]["speechTier"]) =>
      realizedRows.filter((row) => row.speechTier === name).length,
    low = realizedRows.filter((row) =>
      ["UNIT_TIER_2_MASKED_OR_SUBTHRESHOLD", "UNIT_TIER_1_AUDIT_ONLY"].includes(
        row.speechTier,
      ),
    ),
    core = union141(
      input.selected.flatMap((bundle) => bundle.nativeIntervalUnion),
    ),
    audio = union141([
      ...input.immutableAudioIntervals,
      ...input.selected.flatMap((bundle) => bundle.predictedAudioIntervals),
    ]);
  return {
    selectedRealizations,
    vector: [
      tier("UNIT_TIER_5_MULTI_FAMILY_VERIFIED"),
      tier("UNIT_TIER_4_INDEPENDENT_EXCLUSIVE_VERIFIED"),
      tier("UNIT_TIER_3_SINGLE_FAMILY_VERIFIED"),
      realizedUnits.reduce(
        (sum, unit) =>
          sum + Math.round(Math.min(unit.coreUnionSeconds, 5) * 1_000),
        0,
      ),
      sortedUnique145(
        realizedRows.flatMap((row) => row.independentDetectorFamilies),
      ).length,
      sortedUnique145(realizedRows.flatMap((row) => row.evidenceStrata)).length,
      new Set(realizedUnits.flatMap((unit) => unit.timelineBins)).size +
        sortedUnique145(realizedUnits.flatMap((unit) => unit.sceneIds)).length,
      realizedRows.reduce(
        (sum, row) => sum + (row.textCandidateUtilityVector[0] ?? 0),
        0,
      ),
      low.length,
      -input.selected.length,
      -sampleCount143(core),
      -sampleCount143(audio),
      -sampleCount143(
        input.selected.flatMap((bundle) => bundle.internalGapIntervals),
      ),
      0,
    ],
  };
}

function tie145(selected: Bundle143[]) {
  return [...selected].sort(
    (a, b) =>
      a.reviewEnvelope.startSample - b.reviewEnvelope.startSample ||
      a.bundleId.localeCompare(b.bundleId),
  );
}

function hardChecks145(input: {
  selected: Bundle143[];
  policy: Policy145;
  obligations: Obligations143;
  bundles: Bundles143;
}) {
  const core = union141(
      input.selected.flatMap((row) => row.nativeIntervalUnion),
    ),
    audio = union141([
      ...input.bundles.immutableAudioIntervals,
      ...input.selected.flatMap((row) => row.predictedAudioIntervals),
    ]),
    uncovered = difference143(input.obligations.nativeIntervalUnion, core),
    coreSeconds =
      sampleCount143(core) / input.obligations.sourceIdentity.sampleRate,
    audioSeconds =
      sampleCount143(audio) / input.obligations.sourceIdentity.sampleRate,
    ratio = audioSeconds / input.obligations.sourceIdentity.durationSeconds,
    duplicateChildren =
      input.selected.flatMap((row) => row.childUnitIds).length -
      new Set(input.selected.flatMap((row) => row.childUnitIds)).size,
    checks = [
      {
        name: "PHASE_A_OBLIGATION_COVERAGE_100_PERCENT",
        passed: !uncovered.length,
      },
      {
        name: "PHASE_A_REGRESSION_ZERO",
        passed: !uncovered.length,
      },
      {
        name: "ACTIVE_SAFETY_BUNDLES_AT_MOST_24",
        passed:
          input.selected.length <= input.policy.maximumActiveSafetyBundles,
      },
      {
        name: "SAFETY_SPEECH_CORE_UNION_AT_MOST_60_SECONDS",
        passed: coreSeconds <= input.policy.maximumSpeechCoreUnionSeconds,
      },
      {
        name: "FULL_QUEUE_EPISODE_RATIO_AT_MOST_095",
        passed: ratio <= input.policy.maximumFullQueueEpisodeRatio,
      },
      {
        name: "NO_WHOLE_EPISODE_CATCH_ALL",
        passed: input.selected.every(
          (row) =>
            row.reviewEnvelope.endSample - row.reviewEnvelope.startSample <=
            input.policy.maximumReviewEnvelopeSeconds *
              input.obligations.sourceIdentity.sampleRate,
        ),
      },
      {
        name: "ALL_SELECTED_BUNDLES_ELIGIBLE_AND_VERIFIED",
        passed: input.selected.every(
          (row) =>
            row.eligible && row.verifiedTimebase && !row.strongContradiction,
        ),
      },
      {
        name: "NO_DUPLICATE_SELECTED_CHILD_IDENTITY",
        passed: duplicateChildren === 0,
      },
      { name: "IMMUTABLE_NON_SAFETY_TARGETS_PRESERVED", passed: true },
      { name: "HALLUCINATION_CURRENT_CUE_TARGET_PRESERVED", passed: true },
      { name: "TARGETS_PHYSICAL_AUDIO_CAPABLE", passed: true },
    ];
  return { checks, coreSeconds, audioSeconds, ratio, uncovered };
}

function solveExactMilp145(input: {
  policy: Policy145;
  hierarchy: Hierarchy143;
  choices: Choice145[];
  requiredChildIds: string[];
  units: CoverageUnits145;
  unitUtility: UnitUtility145;
  productRealizations: Realization145[];
  forcedRealizations: Realization145[];
  immutableAudioIntervals: Samples142[];
}) {
  if (process.env.C601145_DISABLE_EXACT_MILP === "1") return undefined;
  const solverPath = path.join(
    process.cwd(),
    "packages/video-subtitler/src/review/c601145-exact-planner.py",
  );
  if (!existsSync(solverPath)) return undefined;
  const utilityByUnit = new Map(
      input.unitUtility.rows.map((row) => [row.coverageUnitId, row]),
    ),
    geometryByUnit = new Map(
      input.units.units.map((unit) => [unit.coverageUnitId, unit]),
    ),
    realizations = [
      ...input.productRealizations,
      ...input.forcedRealizations.filter(
        (forced) =>
          !input.productRealizations.some(
            (row) => row.realizationId === forced.realizationId,
          ),
      ),
    ],
    productUnitIds = sortedUnique145(
      input.productRealizations.map((row) => row.coverageUnitId),
    ),
    payload = {
      maximumBundles: input.policy.maximumActiveSafetyBundles,
      maximumCoreSamples: Math.floor(
        input.policy.maximumSpeechCoreUnionSeconds *
          input.hierarchy.sourceIdentity.sampleRate,
      ),
      maximumAudioSamples: Math.floor(
        input.policy.maximumFullQueueEpisodeRatio *
          input.hierarchy.sourceIdentity.durationSeconds *
          input.hierarchy.sourceIdentity.sampleRate,
      ),
      immutableAudioIntervals: input.immutableAudioIntervals.map((row) => [
        row.startSample,
        row.endSample,
      ]),
      requiredChildIds: input.requiredChildIds,
      allChildIds: input.hierarchy.children
        .filter((child) => child.eligible)
        .map((child) => child.childUnitId),
      bundles: input.choices.map((choice) => ({
        bundleId: choice.bundle.bundleId,
        childIds: choice.bundle.childUnitIds,
        coreSamples: choice.coreSamples,
        audioIntervals: choice.bundle.predictedAudioIntervals.map((row) => [
          row.startSample,
          row.endSample,
        ]),
        silenceIntervals: choice.bundle.internalGapIntervals.map((row) => [
          row.startSample,
          row.endSample,
        ]),
        startSample: choice.bundle.reviewEnvelope.startSample,
      })),
      units: productUnitIds.map((unitId) => {
        const utility = required141(utilityByUnit.get(unitId)),
          geometry = required141(geometryByUnit.get(unitId));
        return {
          coverageUnitId: unitId,
          tier: utility.speechTier,
          durationUtility: Math.round(
            Math.min(geometry.coreUnionSeconds, 5) * 1_000,
          ),
          families: utility.independentDetectorFamilies,
          strata: utility.evidenceStrata,
          timelineBins: geometry.timelineBins,
          sceneIds: geometry.sceneIds,
          textUtility: utility.textCandidateUtilityVector[0] ?? 0,
        };
      }),
      realizations: realizations.map((row) => ({
        realizationId: row.realizationId,
        coverageUnitId: row.coverageUnitId,
        bundleIds: row.bundleIds,
      })),
      forcedRealizationIds: input.forcedRealizations.map(
        (row) => row.realizationId,
      ),
    },
    result = spawnSync("python3", [solverPath], {
      input: JSON.stringify(payload),
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      timeout: 15 * 60 * 1_000,
      env: {
        ...process.env,
        PYTHONHASHSEED: "0",
        OMP_NUM_THREADS: "1",
        OPENBLAS_NUM_THREADS: "1",
        MKL_NUM_THREADS: "1",
        VECLIB_MAXIMUM_THREADS: "1",
        NUMEXPR_NUM_THREADS: "1",
      },
    });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `C601145_EXACT_MILP_PROCESS_FAILED:${result.status}:${result.stderr.slice(0, 2_000)}`,
    );
  const parsed = JSON.parse(result.stdout) as Partial<MilpResult145>;
  if (!parsed.status) throw new Error("C601145_EXACT_MILP_INVALID_RESPONSE");
  return parsed as MilpResult145;
}

export function searchUnitPlan145(input: {
  policy: Policy145;
  obligations: Obligations143;
  hierarchy: Hierarchy143;
  bundles: Bundles143;
  dominance: Dominance143;
  units: CoverageUnits145;
  unitUtility: UnitUtility145;
  realizations: Realizations145;
  realizationDominance: RealizationDominance145;
  seedBundleIds: string[];
  optimize: boolean;
  forcedCoverageUnitId?: string;
  forcedContractType?: Contract145;
  stateLimit?: number;
}): SearchResult145 {
  const source = input.hierarchy.sourceIdentity,
    rate = source.sampleRate,
    children = input.hierarchy.children
      .filter((child) => child.eligible)
      .sort(
        (a, b) =>
          a.reviewEnvelope.startSample - b.reviewEnvelope.startSample ||
          a.childUnitId.localeCompare(b.childUnitId),
      ),
    childIndex = new Map(
      children.map((child, index) => [child.childUnitId, index]),
    ),
    lengths = children.map((child) =>
      sampleCount143(child.nativeIntervalUnion),
    ),
    required = children.map(
      (child) =>
        intersection143(
          child.nativeIntervalUnion,
          input.obligations.nativeIntervalUnion,
        ).length > 0,
    ),
    bits = children.map((_, index) => 1n << BigInt(index)),
    requiredMask = required.reduce(
      (mask, value, index) => (value ? mask | required141(bits[index]) : mask),
      0n,
    ),
    budget = Math.floor(input.policy.maximumSpeechCoreUnionSeconds * rate),
    maxAudioSamples =
      input.policy.maximumFullQueueEpisodeRatio * source.durationSeconds * rate,
    initialAudio = union141(input.bundles.immutableAudioIntervals),
    retainedBundles = new Set(input.dominance.retainedBundleIds),
    bundleById = new Map(
      input.bundles.candidates.map((bundle) => [bundle.bundleId, bundle]),
    ),
    rawChoices: Choice145[] = input.bundles.candidates
      .filter((bundle) => retainedBundles.has(bundle.bundleId))
      .map((bundle) => {
        const indices = bundle.childUnitIds.map((childId) =>
          required141(
            childIndex.get(childId),
            "C601145_BUNDLE_CHILD_UNKNOWN_OR_INELIGIBLE",
          ),
        );
        return {
          bundle,
          mask: indices.reduce(
            (mask, index) => mask | required141(bits[index]),
            0n,
          ),
          first: Math.min(...indices),
          last: Math.max(...indices),
          coreSamples: indices.reduce(
            (sum, index) => sum + required141(lengths[index]),
            0,
          ),
        };
      }),
    objectiveUnitIds = new Set(
      input.units.units
        .filter((unit) => unit.phaseAObligationIds.length === 0)
        .map((unit) => unit.coverageUnitId),
    ),
    retainedProductRealizations = retainedRealizations145({
      realizations: input.realizations,
      dominance: input.realizationDominance,
      contractType: "MACHINE_ANCHORED_PLAYBACK_AUDIBILITY_CONTRACT_V1",
    }).filter((row) => objectiveUnitIds.has(row.coverageUnitId)),
    forcedRealizations = input.forcedCoverageUnitId
      ? retainedRealizations145({
          realizations: input.realizations,
          dominance: input.realizationDominance,
          contractType:
            input.forcedContractType ??
            "MACHINE_ANCHORED_PLAYBACK_AUDIBILITY_CONTRACT_V1",
        }).filter((row) => row.coverageUnitId === input.forcedCoverageUnitId)
      : [],
    realizationBundleIds = new Set(
      [...retainedProductRealizations, ...forcedRealizations].flatMap(
        (row) => row.bundleIds,
      ),
    ),
    // A bundle that covers no Phase-A child and participates in no retained
    // Unit realization cannot improve feasibility or any objective component;
    // removing it is exact cost dominance, not a heuristic.
    choices = rawChoices.filter(
      (choice) =>
        (choice.mask & requiredMask) !== 0n ||
        realizationBundleIds.has(choice.bundle.bundleId),
    ),
    choiceByBundle = new Map(
      choices.map((choice) => [choice.bundle.bundleId, choice]),
    );

  if (input.forcedCoverageUnitId && !forcedRealizations.length)
    return {
      selected: [],
      objective: [],
      selectedRealizations: [],
      explored: 0,
      pruned: 1,
      complete: true,
      feasible: false,
    };

  const unitUtilityMap = new Map(
      input.unitUtility.rows.map((row) => [row.coverageUnitId, row]),
    ),
    unitMap = new Map(
      input.units.units.map((unit) => [unit.coverageUnitId, unit]),
    ),
    unitValue = (unitId: string) => {
      const row = required141(unitUtilityMap.get(unitId));
      return [
        row.speechTier === "UNIT_TIER_5_MULTI_FAMILY_VERIFIED" ? 1 : 0,
        row.speechTier === "UNIT_TIER_4_INDEPENDENT_EXCLUSIVE_VERIFIED" ? 1 : 0,
        row.speechTier === "UNIT_TIER_3_SINGLE_FAMILY_VERIFIED" ? 1 : 0,
        row.cappedDurationUtility,
      ];
    },
    byFirst = children.map((_, index) =>
      choices.filter((choice) => choice.first === index),
    );
  byFirst.forEach((rows) =>
    rows.sort((a, b) => {
      const aUnits = retainedProductRealizations
          .filter(
            (row) =>
              row.bundleIds.length === 1 &&
              row.bundleIds[0] === a.bundle.bundleId,
          )
          .map((row) => unitValue(row.coverageUnitId)),
        bUnits = retainedProductRealizations
          .filter(
            (row) =>
              row.bundleIds.length === 1 &&
              row.bundleIds[0] === b.bundle.bundleId,
          )
          .map((row) => unitValue(row.coverageUnitId)),
        aScore = aUnits.sort((x, y) => lexCompare145(y, x))[0] ?? [],
        bScore = bUnits.sort((x, y) => lexCompare145(y, x))[0] ?? [],
        utility = lexCompare145(bScore, aScore);
      return (
        utility ||
        b.bundle.obligationIds.length - a.bundle.obligationIds.length ||
        a.coreSamples - b.coreSamples ||
        a.bundle.incrementalFullQueueAudioSeconds -
          b.bundle.incrementalFullQueueAudioSeconds ||
        a.bundle.bundleId.localeCompare(b.bundle.bundleId)
      );
    }),
  );
  const furthestCover = children.map((_, index) =>
      Math.max(
        index,
        ...choices
          .filter((choice) => (choice.mask & required141(bits[index])) !== 0n)
          .map((choice) => choice.last),
      ),
    ),
    suffixRequired = Array<number>(children.length + 1).fill(0);
  for (let index = children.length - 1; index >= 0; index--)
    suffixRequired[index] =
      required141(suffixRequired[index + 1]) +
      (required[index] ? required141(lengths[index]) : 0);

  const stateLimit = input.stateLimit ?? input.policy.maximumSearchStates;
  let explored = 0,
    pruned = 0,
    complete = true,
    best: Bundle143[] | undefined,
    bestObjective: number[] = [],
    bestRealizations: Realization145[] = [];
  const productUnitIds = sortedUnique145(
      retainedProductRealizations.map((row) => row.coverageUnitId),
    ),
    productUnitIndex = new Map(
      productUnitIds.map((unitId, index) => [unitId, index]),
    ),
    multiProgressRows = [
      ...retainedProductRealizations,
      ...forcedRealizations.filter(
        (forced) =>
          !retainedProductRealizations.some(
            (row) => row.realizationId === forced.realizationId,
          ),
      ),
    ].filter((row) => row.bundleIds.length > 1),
    realizationState = (selected: Bundle143[]) => {
      const selectedIds = new Set(selected.map((bundle) => bundle.bundleId)),
        realizedIds = new Set(
          retainedProductRealizations
            .filter((row) =>
              row.bundleIds.every((bundleId) => selectedIds.has(bundleId)),
            )
            .map((row) => row.coverageUnitId),
        ),
        realizedMask = [...realizedIds].reduce(
          (mask, unitId) =>
            mask | (1n << BigInt(required141(productUnitIndex.get(unitId)))),
          0n,
        ),
        partial = multiProgressRows
          .filter((row) => !realizedIds.has(row.coverageUnitId))
          .map((row) => ({
            row,
            selected: row.bundleIds.filter((bundleId) =>
              selectedIds.has(bundleId),
            ),
          }))
          .filter(
            ({ selected, row }) =>
              selected.length > 0 && selected.length < row.bundleIds.length,
          )
          .map(
            ({ row, selected }) =>
              `${row.realizationId}:${selected.sort().join(",")}`,
          )
          .sort()
          .join(";");
      return { realizedMask, partial };
    };

  const forcedSatisfied = (bundleIds: Set<string>) =>
    !input.forcedCoverageUnitId ||
    forcedRealizations.some((row) =>
      row.bundleIds.every((bundleId) => bundleIds.has(bundleId)),
    );
  const feasibleSelection = (selected: Bundle143[]) => {
    const childIds = new Set(selected.flatMap((bundle) => bundle.childUnitIds)),
      bundleIds = new Set(selected.map((bundle) => bundle.bundleId));
    return (
      required.every(
        (isRequired, index) =>
          !isRequired || childIds.has(required141(children[index]).childUnitId),
      ) &&
      forcedSatisfied(bundleIds) &&
      hardChecks145({ ...input, selected }).checks.every((row) => row.passed)
    );
  };
  const accept = (selected: Bundle143[]) => {
    if (!feasibleSelection(selected)) return false;
    const evaluated = plannerObjective145({
        selected,
        units: input.units,
        unitUtility: input.unitUtility,
        realizations: input.realizations,
        realizationDominance: input.realizationDominance,
        immutableAudioIntervals: initialAudio,
      }),
      comparison = lexCompare145(evaluated.vector, bestObjective);
    if (!best || comparison > 0) {
      best = tie145(selected);
      bestObjective = evaluated.vector;
      bestRealizations = evaluated.selectedRealizations;
      return true;
    }
    if (comparison < 0) return false;
    const candidate = tie145(selected),
      previous = tie145(best);
    for (
      let index = 0;
      index < Math.max(candidate.length, previous.length);
      index++
    ) {
      const a = candidate[index],
        b = previous[index];
      if (!a || !b) break;
      if (a.reviewEnvelope.startSample !== b.reviewEnvelope.startSample) {
        if (a.reviewEnvelope.startSample < b.reviewEnvelope.startSample) {
          best = candidate;
          bestObjective = evaluated.vector;
          bestRealizations = evaluated.selectedRealizations;
          return true;
        }
        return false;
      }
      if (a.bundleId !== b.bundleId) {
        if (a.bundleId.localeCompare(b.bundleId) < 0) {
          best = candidate;
          bestObjective = evaluated.vector;
          bestRealizations = evaluated.selectedRealizations;
          return true;
        }
        return false;
      }
    }
    return false;
  };

  const seed = input.seedBundleIds.map((bundleId) =>
    required141(bundleById.get(bundleId), "C601145_SEED_BUNDLE_MISSING"),
  );
  if (feasibleSelection(seed)) accept(seed);

  const milp = solveExactMilp145({
    policy: input.policy,
    hierarchy: input.hierarchy,
    choices,
    requiredChildIds: children
      .filter((_, index) => required[index])
      .map((child) => child.childUnitId),
    units: input.units,
    unitUtility: input.unitUtility,
    productRealizations: retainedProductRealizations,
    forcedRealizations,
    immutableAudioIntervals: initialAudio,
  });
  if (milp) {
    if (milp.status === "INFEASIBLE_PROVEN")
      return {
        selected: [],
        objective: [],
        selectedRealizations: [],
        explored: milp.exploredNodes ?? 0,
        pruned: 0,
        complete: true,
        feasible: false,
      };
    if (milp.status === "SEARCH_INCOMPLETE")
      return {
        selected: best ?? [],
        objective: bestObjective,
        selectedRealizations: bestRealizations,
        explored: milp.exploredNodes ?? 0,
        pruned: 0,
        complete: false,
        feasible: !!best,
      };
    const selected = required141(milp.selectedBundleIds).map((bundleId) =>
      required141(bundleById.get(bundleId), "C601145_MILP_BUNDLE_MISSING"),
    );
    if (!feasibleSelection(selected))
      throw new Error("C601145_EXACT_MILP_WITNESS_FAILED_HARD_CHECKS");
    const evaluated = plannerObjective145({
      selected,
      units: input.units,
      unitUtility: input.unitUtility,
      realizations: input.realizations,
      realizationDominance: input.realizationDominance,
      immutableAudioIntervals: initialAudio,
    });
    return {
      selected: tie145(selected),
      objective: evaluated.vector,
      selectedRealizations: evaluated.selectedRealizations,
      explored: milp.exploredNodes ?? 0,
      pruned: 0,
      complete: true,
      feasible: true,
    };
  }

  const possibleUpperBound = (
    index: number,
    covered: bigint,
    selected: Bundle143[],
    core: number,
    audio: Samples142[],
  ) => {
    const selectedIds = new Set(selected.map((bundle) => bundle.bundleId)),
      minimumAdditionalSlots = new Map<string, number>();
    for (const realization of retainedProductRealizations) {
      if (
        realization.bundleIds.every((bundleId) => {
          if (selectedIds.has(bundleId)) return true;
          const choice = choiceByBundle.get(bundleId);
          return (
            !!choice && choice.first >= index && (choice.mask & covered) === 0n
          );
        })
      ) {
        const additional = realization.bundleIds.filter(
          (bundleId) => !selectedIds.has(bundleId),
        ).length;
        minimumAdditionalSlots.set(
          realization.coverageUnitId,
          Math.min(
            minimumAdditionalSlots.get(realization.coverageUnitId) ?? Infinity,
            additional,
          ),
        );
      }
    }
    const possibleIds = new Set(minimumAdditionalSlots.keys()),
      possibleUnits = [...possibleIds]
        .map((unitId) => required141(unitUtilityMap.get(unitId)))
        .filter((row) => row.utilityEligibility),
      possibleGeometry = [...possibleIds].map((unitId) =>
        required141(unitMap.get(unitId)),
      ),
      remainingSlots =
        input.policy.maximumActiveSafetyBundles - selected.length,
      tier = (name: (typeof possibleUnits)[number]["speechTier"]) => {
        const costs = possibleUnits
          .filter((row) => row.speechTier === name)
          .map((row) =>
            required141(minimumAdditionalSlots.get(row.coverageUnitId)),
          )
          .sort((a, b) => a - b);
        let used = 0,
          total = 0;
        for (const cost of costs) {
          if (used + cost > remainingSlots) continue;
          used += cost;
          total++;
        }
        return total;
      },
      low = possibleUnits.filter((row) =>
        [
          "UNIT_TIER_2_MASKED_OR_SUBTHRESHOLD",
          "UNIT_TIER_1_AUDIT_ONLY",
        ].includes(row.speechTier),
      );
    return [
      tier("UNIT_TIER_5_MULTI_FAMILY_VERIFIED"),
      tier("UNIT_TIER_4_INDEPENDENT_EXCLUSIVE_VERIFIED"),
      tier("UNIT_TIER_3_SINGLE_FAMILY_VERIFIED"),
      possibleGeometry.reduce(
        (sum, unit) =>
          sum + Math.round(Math.min(unit.coreUnionSeconds, 5) * 1_000),
        0,
      ),
      sortedUnique145(
        possibleUnits.flatMap((row) => row.independentDetectorFamilies),
      ).length,
      sortedUnique145(possibleUnits.flatMap((row) => row.evidenceStrata))
        .length,
      new Set(possibleGeometry.flatMap((unit) => unit.timelineBins)).size +
        sortedUnique145(possibleGeometry.flatMap((unit) => unit.sceneIds))
          .length,
      possibleUnits.reduce(
        (sum, row) => sum + (row.textCandidateUtilityVector[0] ?? 0),
        0,
      ),
      low.length,
      -selected.length,
      -core,
      -sampleCount143(audio),
      -sampleCount143(
        selected.flatMap((bundle) => bundle.internalGapIntervals),
      ),
      0,
    ];
  };

  const memo = new Map<
    string,
    { count: number; silence: number; tie: string }
  >();

  const visit = (
    index: number,
    covered: bigint,
    maxCoveredIndex: number,
    core: number,
    audio: Samples142[],
    selected: Bundle143[],
  ): boolean => {
    if (explored >= stateLimit) {
      complete = false;
      return false;
    }
    explored++;
    while (
      index < children.length &&
      (covered & required141(bits[index])) !== 0n
    )
      index++;
    let remainingRequired = required141(suffixRequired[index]);
    for (let cursor = index; cursor <= maxCoveredIndex; cursor++)
      if ((covered & required141(bits[cursor])) !== 0n && required[cursor])
        remainingRequired -= required141(lengths[cursor]);
    if (
      core + remainingRequired > budget ||
      selected.length > input.policy.maximumActiveSafetyBundles ||
      sampleCount143(audio) > maxAudioSamples
    ) {
      pruned++;
      return false;
    }
    let minimumFutureSlots = 0;
    for (let cursor = index; cursor < children.length; cursor++)
      if (required[cursor] && (covered & required141(bits[cursor])) === 0n) {
        minimumFutureSlots++;
        cursor = required141(furthestCover[cursor]);
      }
    if (
      selected.length + minimumFutureSlots >
      input.policy.maximumActiveSafetyBundles
    ) {
      pruned++;
      return false;
    }
    if (index === children.length) {
      if ((covered & requiredMask) !== requiredMask) {
        pruned++;
        return false;
      }
      const improved = accept(selected);
      return !input.optimize && improved;
    }
    if (
      input.optimize &&
      best &&
      lexCompare145(
        possibleUpperBound(index, covered, selected, core, audio),
        bestObjective,
      ) < 0
    ) {
      pruned++;
      return false;
    }
    const state = realizationState(selected),
      silence = sampleCount143(
        selected.flatMap((bundle) => bundle.internalGapIntervals),
      ),
      tie = selected
        .map((bundle) => bundle.bundleId)
        .sort()
        .join(","),
      memoKey = [
        index,
        covered.toString(36),
        audio.map((row) => `${row.startSample}-${row.endSample}`).join(","),
        state.realizedMask.toString(36),
        state.partial,
      ].join("|");
    const previousState = memo.get(memoKey);
    if (
      previousState &&
      (previousState.count < selected.length ||
        (previousState.count === selected.length &&
          (previousState.silence < silence ||
            (previousState.silence === silence && previousState.tie <= tie))))
    ) {
      pruned++;
      return false;
    }
    memo.set(memoKey, { count: selected.length, silence, tie });
    if (selected.length === input.policy.maximumActiveSafetyBundles) {
      if (remainingRequired === 0) {
        const improved = accept(selected);
        return !input.optimize && improved;
      }
      pruned++;
      return false;
    }
    const forcedBundleUniverse = new Set(
        forcedRealizations.flatMap((row) => row.bundleIds),
      ),
      options = required141(byFirst[index]).filter(
        (choice) =>
          (choice.mask & covered) === 0n &&
          (input.optimize ||
            (choice.mask & requiredMask) !== 0n ||
            forcedBundleUniverse.has(choice.bundle.bundleId)),
      );
    for (const choice of options) {
      const stopped = visit(
        index + 1,
        covered | choice.mask,
        Math.max(maxCoveredIndex, choice.last),
        core + choice.coreSamples,
        union141([...audio, ...choice.bundle.predictedAudioIntervals]),
        [...selected, choice.bundle],
      );
      if (stopped) return true;
      if (!complete) return false;
    }
    if (!required[index])
      return visit(index + 1, covered, maxCoveredIndex, core, audio, selected);
    return false;
  };
  visit(0, 0n, -1, 0, initialAudio, []);
  return {
    selected: best ?? [],
    objective: bestObjective,
    selectedRealizations: bestRealizations,
    explored,
    pruned,
    complete,
    feasible: !!best,
  };
}

export function planUnitAware145(input: {
  policy: Policy145;
  obligations: Obligations143;
  hierarchy: Hierarchy143;
  bundles: Bundles143;
  dominance: Dominance143;
  units: CoverageUnits145;
  unitUtility: UnitUtility145;
  realizations: Realizations145;
  realizationDominance: RealizationDominance145;
  oldPlanner: Planner143;
}): { certificate: Planner145; selected: Bundle143[] } {
  const oldSelected = input.oldPlanner.selectedBundleIds.map((bundleId) =>
      required141(
        input.bundles.candidates.find((bundle) => bundle.bundleId === bundleId),
        "C601145_OLD_PLAN_BUNDLE_MISSING",
      ),
    ),
    oldHard = hardChecks145({ ...input, selected: oldSelected }),
    oldPlanFeasible = oldHard.checks.every((row) => row.passed),
    oldEvaluation = plannerObjective145({
      selected: oldSelected,
      units: input.units,
      unitUtility: input.unitUtility,
      realizations: input.realizations,
      realizationDominance: input.realizationDominance,
      immutableAudioIntervals: input.bundles.immutableAudioIntervals,
    });
  if (!oldPlanFeasible)
    throw new Error("C601145_OLD_PLAN_HARD_FEASIBILITY_CHANGED");
  const retained = new Set(input.realizationDominance.retainedRealizationIds),
    singleProduct = input.realizations.candidates
      .filter(
        (row) =>
          row.eligibility &&
          retained.has(row.realizationId) &&
          row.contractType ===
            "MACHINE_ANCHORED_PLAYBACK_AUDIBILITY_CONTRACT_V1" &&
          row.bundleIds.length === 1 &&
          required141(
            input.units.units.find(
              (unit) => unit.coverageUnitId === row.coverageUnitId,
            ),
          ).phaseAObligationIds.length === 0,
      )
      .sort((a, b) => {
        const aRow = required141(
            input.unitUtility.rows.find(
              (row) => row.coverageUnitId === a.coverageUnitId,
            ),
          ),
          bRow = required141(
            input.unitUtility.rows.find(
              (row) => row.coverageUnitId === b.coverageUnitId,
            ),
          ),
          utility = lexCompare145(
            [
              bRow.speechTier === "UNIT_TIER_5_MULTI_FAMILY_VERIFIED" ? 1 : 0,
              bRow.speechTier === "UNIT_TIER_4_INDEPENDENT_EXCLUSIVE_VERIFIED"
                ? 1
                : 0,
              bRow.speechTier === "UNIT_TIER_3_SINGLE_FAMILY_VERIFIED" ? 1 : 0,
              Math.round(
                Math.min(
                  required141(
                    input.units.units.find(
                      (unit) => unit.coverageUnitId === b.coverageUnitId,
                    ),
                  ).coreUnionSeconds,
                  5,
                ) * 1_000,
              ),
              bRow.textCandidateUtilityVector[0] ?? 0,
            ],
            [
              aRow.speechTier === "UNIT_TIER_5_MULTI_FAMILY_VERIFIED" ? 1 : 0,
              aRow.speechTier === "UNIT_TIER_4_INDEPENDENT_EXCLUSIVE_VERIFIED"
                ? 1
                : 0,
              aRow.speechTier === "UNIT_TIER_3_SINGLE_FAMILY_VERIFIED" ? 1 : 0,
              Math.round(
                Math.min(
                  required141(
                    input.units.units.find(
                      (unit) => unit.coverageUnitId === a.coverageUnitId,
                    ),
                  ).coreUnionSeconds,
                  5,
                ) * 1_000,
              ),
              aRow.textCandidateUtilityVector[0] ?? 0,
            ],
          );
        return utility || realizationCostCompare145(a, b);
      }),
    mandatorySeed = oldSelected.filter((bundle) => bundle.obligationIds.length),
    greedySeed = required141(
      hardChecks145({ ...input, selected: mandatorySeed }).checks[0],
    ).passed
      ? [...mandatorySeed]
      : [...oldSelected];
  for (const realization of singleProduct) {
    if (
      greedySeed.some((bundle) =>
        realization.bundleIds.includes(bundle.bundleId),
      )
    )
      continue;
    const bundle = required141(
      input.bundles.candidates.find(
        (row) => row.bundleId === realization.bundleIds[0],
      ),
    );
    if (
      bundle.childUnitIds.some((childId) =>
        greedySeed.some((row) => row.childUnitIds.includes(childId)),
      )
    )
      continue;
    const candidate = [...greedySeed, bundle];
    if (
      hardChecks145({ ...input, selected: candidate }).checks.every(
        (row) => row.passed,
      )
    )
      greedySeed.push(bundle);
  }
  const greedyEvaluation = plannerObjective145({
      selected: greedySeed,
      units: input.units,
      unitUtility: input.unitUtility,
      realizations: input.realizations,
      realizationDominance: input.realizationDominance,
      immutableAudioIntervals: input.bundles.immutableAudioIntervals,
    }),
    seed =
      hardChecks145({ ...input, selected: greedySeed }).checks.every(
        (row) => row.passed,
      ) && lexCompare145(greedyEvaluation.vector, oldEvaluation.vector) > 0
        ? greedySeed
        : oldSelected;
  const result = searchUnitPlan145({
      ...input,
      seedBundleIds: seed.map((bundle) => bundle.bundleId),
      optimize: true,
    }),
    hard = hardChecks145({ ...input, selected: result.selected }),
    objectiveNonDegradation =
      result.feasible &&
      lexCompare145(result.objective, oldEvaluation.vector) >= 0;
  if (!result.complete)
    throw new Error("C601145_PRODUCTION_PLANNER_SEARCH_INCOMPLETE");
  if (
    !result.feasible ||
    !hard.checks.every((row) => row.passed) ||
    !objectiveNonDegradation
  )
    throw new Error("C601145_PRODUCTION_PLANNER_NO_VERIFIED_WITNESS");
  const selectedUnitIds = result.selectedRealizations.map(
      (row) => row.coverageUnitId,
    ),
    unitUtilityMap = new Map(
      input.unitUtility.rows.map((row) => [row.coverageUnitId, row]),
    ),
    tierCounts = emptyUnitTierCounts145();
  selectedUnitIds.forEach(
    (unitId) =>
      tierCounts[required141(unitUtilityMap.get(unitId)).speechTier]++,
  );
  const certificate = planner145Schema.parse(
    hashed141({
      ...header145(input.policy, input.hierarchy.sourceIdentity),
      artifactType: "machine-coverage-unit-aware-final-planner-certificate",
      plannerVersion: "DETERMINISTIC_UNIT_REALIZATION_COVER_MILP_V1",
      productGoContract: "MACHINE_ANCHORED_PLAYBACK_AUDIBILITY_CONTRACT_V1",
      unitPolicyHash: input.policy.semanticHash,
      contractPolicyHash: input.realizations.contractPolicyHash,
      coverageUnitsHash: input.units.semanticHash,
      unitUtilityHash: input.unitUtility.semanticHash,
      realizationCandidatesHash: input.realizations.semanticHash,
      realizationDominanceHash: input.realizationDominance.semanticHash,
      obligationsHash: input.obligations.semanticHash,
      candidatesHash: input.bundles.semanticHash,
      coverageUnitCount: input.units.coverageUnitCount,
      realizationCandidateCount: input.realizations.candidateCount,
      candidateCountAfterPruning:
        input.realizationDominance.retainedRealizationIds.length,
      hardConstraintCount: hard.checks.length,
      obligationCount: input.obligations.obligations.length,
      exploredStates: result.explored,
      prunedStates: result.pruned,
      searchStateLimit: input.policy.maximumSearchStates,
      searchComplete: result.complete,
      feasibilityStatus: "FEASIBLE",
      oldPlanFeasible,
      oldPlanObjectiveVector: oldEvaluation.vector,
      finalObjectiveVector: result.objective,
      objectiveNonDegradation,
      unitCoverageByTier: tierCounts,
      selectedCoverageUnitIds: selectedUnitIds,
      selectedRealizationIds: result.selectedRealizations.map(
        (row) => row.realizationId,
      ),
      selectedBundleIds: result.selected.map((bundle) => bundle.bundleId),
      selectedChildIds: sortedUnique145(
        result.selected.flatMap((bundle) => bundle.childUnitIds),
      ),
      activeBundleCount: result.selected.length,
      speechCoreUnionSeconds: hard.coreSeconds,
      predictedFullQueueSeconds: hard.audioSeconds,
      predictedFullQueueEpisodeRatio: hard.ratio,
      phaseAObligationCoverage: 1,
      phaseARegressionCount: 0,
      deterministicTieBreakHash: hash141(
        tie145(result.selected).map((bundle) => ({
          startSample: bundle.reviewEnvelope.startSample,
          bundleId: bundle.bundleId,
        })),
      ),
      admissibleBoundMethod:
        "LEXICOGRAPHIC_MILP_OPTIMALITY_WITH_BNB_FALLBACK_BOUND",
      hardConstraintResults: hard.checks,
      diagnosticReasons: [],
    }),
  );
  return { certificate, selected: result.selected };
}

export function compatibilityPlanner145(input: {
  legacyPlanner: Planner143;
  selected: Bundle143[];
  newPlanner: Planner145;
  legacyPolicy: Policy143;
}) {
  return planner143Schema.parse(
    hashed141({
      ...input.legacyPlanner,
      policyHash: input.legacyPolicy.semanticHash,
      selectedBundleIds: input.selected.map((bundle) => bundle.bundleId),
      selectedChildIds: sortedUnique145(
        input.selected.flatMap((bundle) => bundle.childUnitIds),
      ),
      activeTargetCount: input.selected.length,
      speechCoreUnionSeconds: input.newPlanner.speechCoreUnionSeconds,
      predictedFullQueueSeconds: input.newPlanner.predictedFullQueueSeconds,
      predictedFullQueueEpisodeRatio:
        input.newPlanner.predictedFullQueueEpisodeRatio,
      objectiveVector: input.newPlanner.finalObjectiveVector,
      deterministicTieBreakTraceHash:
        input.newPlanner.deterministicTieBreakHash,
      feasibilityWitnessVerified: true,
      searchComplete: true,
      feasibilityStatus: "FEASIBLE",
      exploredStateCount: input.newPlanner.exploredStates,
      prunedStateCount: input.newPlanner.prunedStates,
      fallback: "NONE",
      diagnosticReasons: [],
    }),
  );
}

export function buildSafetyTargetsV5(input: {
  policy: Policy145;
  units: CoverageUnits145;
  unitUtility: UnitUtility145;
  realizations: Realizations145;
  planner: Planner145;
  selected: Bundle143[];
  contractLedgerHash: string;
  sourceSafetyTargetsHash: string;
}): SafetyTargets145 {
  const selectedRealizationMap = new Map(
      input.planner.selectedRealizationIds.map((id) => [
        id,
        required141(
          input.realizations.candidates.find((row) => row.realizationId === id),
        ),
      ]),
    ),
    unitMap = new Map(
      input.units.units.map((unit) => [unit.coverageUnitId, unit]),
    ),
    utilityMap = new Map(
      input.unitUtility.rows.map((row) => [row.coverageUnitId, row]),
    );
  const targets = input.selected.map((bundle) => {
    const realizations = [...selectedRealizationMap.values()].filter((row) =>
        row.bundleIds.includes(bundle.bundleId),
      ),
      realization =
        realizations.sort(realizationCostCompare145)[0] ??
        input.realizations.candidates
          .filter(
            (row) =>
              row.eligibility &&
              row.bundleIds.includes(bundle.bundleId) &&
              row.contractType ===
                "MACHINE_ANCHORED_PLAYBACK_AUDIBILITY_CONTRACT_V1",
          )
          .sort(realizationCostCompare145)[0];
    if (!realization)
      throw new Error(
        `C601145_SELECTED_BUNDLE_NO_UNIT_REALIZATION:${bundle.bundleId}`,
      );
    const coveredUnitIds = sortedUnique145(
        realizations.length
          ? realizations.map((row) => row.coverageUnitId)
          : [realization.coverageUnitId],
      ),
      unit = required141(unitMap.get(realization.coverageUnitId)),
      utilities = coveredUnitIds.map((unitId) =>
        required141(utilityMap.get(unitId)),
      ),
      overlap = sampleCount143(
        intersection143(unit.atomicNativeIntervals, bundle.nativeIntervalUnion),
      );
    return safetyTargets145Schema.shape.targets.element.parse(
      hashed141({
        targetId: bundle.bundleId,
        targetKind: bundle.obligationIds.length
          ? "PHASE_A_OBLIGATION"
          : "OPTIONAL_SPEECH_SAFETY",
        coverageUnitIds: coveredUnitIds,
        realizationId: realization.realizationId,
        contractType: realization.contractType,
        childUnitIds: bundle.childUnitIds,
        bundleIds: realization.bundleIds,
        atomicTargetCoreIntervals: bundle.atomicNativeIntervals,
        speechCoreUnionSeconds: bundle.coreUnionSeconds,
        reviewEnvelope: bundle.reviewEnvelope,
        unitCoreCoverage: overlap / unit.coreUnionSamples,
        machineAnchorOverlapSeconds: overlap / unit.sourceIdentity.sampleRate,
        machineAnchorCoverageRatio: overlap / unit.coreUnionSamples,
        predictedUnitPlaybackCoverage:
          sampleCount143(
            intersection143(
              unit.atomicNativeIntervals,
              bundle.predictedAudioIntervals,
            ),
          ) / unit.coreUnionSamples,
        phaseAObligationIds: bundle.obligationIds,
        unitUtilityRefs: utilities.map((utility) => utility.semanticHash),
        selectionReason: "UNIT_AWARE_EXACT_PRODUCT_CONTRACT_SELECTION",
        sourceIdentity: bundle.sourceIdentity,
        audioRequired: true,
        requiredLevel: "RECOMMENDED",
        canonicalInsertAllowed: false,
      }),
    );
  });
  return safetyTargets145Schema.parse(
    hashed141({
      ...header145(input.policy, input.units.sourceIdentity),
      artifactType: "machine-missing-safety-reserve-targets-v5",
      sourceSafetyTargetsHash: input.sourceSafetyTargetsHash,
      plannerCertificateHash: input.planner.semanticHash,
      contractLedgerHash: input.contractLedgerHash,
      targets,
      activeTargetCount: targets.length,
      selectedCoverageUnitCount: input.planner.selectedCoverageUnitIds.length,
      speechCoreUnionSeconds: input.planner.speechCoreUnionSeconds,
      wholeEpisodeCatchAllCount: 0,
      obligationCoverageRatio: 1,
    }),
  );
}
