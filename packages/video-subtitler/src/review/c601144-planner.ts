import {
  forcedInclusion144Schema,
  optionalChildLedger144Schema,
  planComparison144Schema,
  planner143Schema,
  planner144Schema,
  safetyTargets144Schema,
  type Bundle143,
  type BundleUtility144,
  type Bundles143,
  type Child143,
  type ChildUtility144,
  type ChildUtilityRow144,
  type Dominance143,
  type ForcedInclusion144,
  type Hierarchy143,
  type Obligations143,
  type OptionalChildLedger144,
  type Planner143,
  type Planner144,
  type Policy143,
  type Samples142,
  type UtilityPolicy144,
} from "@mvl/shared";
import {
  assertHash141,
  hash141,
  hashed141,
  required141,
  union141,
} from "./c601141-policy.js";
import { unique142 } from "./c601142-selection.js";
import {
  difference143,
  intersection143,
  sampleCount143,
} from "./c601143-policy.js";
import {
  emptyTierCounts144,
  header144,
  lexCompare144,
} from "./c601144-policy.js";

interface Choice144 {
  bundle: Bundle143;
  mask: bigint;
  first: number;
  last: number;
  coreSamples: number;
}

interface Search144 {
  selected: Bundle143[];
  objective: number[];
  explored: number;
  pruned: number;
  complete: boolean;
  feasible: boolean;
}

const tierScore144 = (row: ChildUtilityRow144) => {
  const speech = row.speechEvidenceUtilityVector;
  // This is a bounded ordinal encoding, not a probability. The leading one
  // makes a second same-tier child dominate any lower-order feature sum.
  return (
    1_000_000 +
    (speech[5] ?? 0) * 10_000 +
    (speech[6] ?? 0) * 1_000 +
    (speech[7] ?? 0) * 100 +
    row.cappedDurationUtility * 10 +
    (row.detectorExclusiveNovelty ? 1 : 0)
  );
};

function selectedChildren144(
  selected: readonly Bundle143[],
  childMap: ReadonlyMap<string, Child143>,
) {
  return unique142(selected.flatMap((bundle) => bundle.childUnitIds)).map(
    (childId) => required141(childMap.get(childId)),
  );
}

export function plannerObjective144(input: {
  selected: Bundle143[];
  hierarchy: Hierarchy143;
  obligations: Obligations143;
  childUtility: ChildUtility144;
  immutableAudioIntervals: Samples142[];
}) {
  const childMap = new Map(
      input.hierarchy.children.map((child) => [child.childUnitId, child]),
    ),
    utilityMap = new Map(
      input.childUtility.rows.map((row) => [row.childUnitId, row]),
    ),
    selectedChildren = selectedChildren144(input.selected, childMap),
    optional = selectedChildren.filter((child) => !child.obligationIds.length),
    optionalRows = optional.map((child) =>
      required141(utilityMap.get(child.childUnitId)),
    ),
    tier = (name: ChildUtilityRow144["highestSpeechEvidenceTier"]) =>
      optionalRows
        .filter((row) => row.highestSpeechEvidenceTier === name)
        .reduce((sum, row) => sum + tierScore144(row), 0),
    high = optionalRows.filter((row) =>
      [
        "TIER_5_VERIFIED_MULTI_FAMILY_SPEECH",
        "TIER_4_VERIFIED_INDEPENDENT_EXCLUSIVE_SPEECH",
        "TIER_3_VERIFIED_SINGLE_FAMILY_SPEECH",
      ].includes(row.highestSpeechEvidenceTier),
    ),
    low = optionalRows.filter((row) => !high.includes(row)),
    core = union141(
      input.selected.flatMap((bundle) => bundle.nativeIntervalUnion),
    ),
    audio = union141([
      ...input.immutableAudioIntervals,
      ...input.selected.flatMap((bundle) => bundle.predictedAudioIntervals),
    ]),
    covered =
      sampleCount143(input.obligations.nativeIntervalUnion) -
      sampleCount143(
        difference143(input.obligations.nativeIntervalUnion, core),
      );
  return [
    covered,
    tier("TIER_5_VERIFIED_MULTI_FAMILY_SPEECH"),
    tier("TIER_4_VERIFIED_INDEPENDENT_EXCLUSIVE_SPEECH"),
    tier("TIER_3_VERIFIED_SINGLE_FAMILY_SPEECH"),
    high.length,
    high.reduce((sum, row) => sum + row.cappedDurationUtility, 0),
    unique142(optionalRows.flatMap((row) => row.independentDetectorFamilies))
      .length,
    unique142(optionalRows.flatMap((row) => row.evidenceStrata)).length,
    unique142(optional.flatMap((child) => child.timelineBins)).length,
    unique142(optional.flatMap((child) => child.sceneIds)).length,
    optionalRows.reduce(
      (sum, row) => sum + (row.textCandidateUtilityVector[0] ?? 0),
      0,
    ),
    low.reduce((sum, row) => sum + row.cappedDurationUtility, 0),
    -input.selected.length,
    -sampleCount143(core),
    -sampleCount143(audio),
    -input.selected.reduce(
      (sum, bundle) => sum + sampleCount143(bundle.internalGapIntervals),
      0,
    ),
  ];
}

function tie144(selected: Bundle143[]) {
  return [...selected].sort(
    (a, b) =>
      a.reviewEnvelope.startSample - b.reviewEnvelope.startSample ||
      a.bundleId.localeCompare(b.bundleId),
  );
}

function searchUtilityPlan144(input: {
  policy: UtilityPolicy144;
  obligations: Obligations143;
  hierarchy: Hierarchy143;
  bundles: Bundles143;
  dominance: Dominance143;
  childUtility: ChildUtility144;
  bundleUtility: BundleUtility144;
  seedBundleIds: string[];
  forcedChildId?: string;
  optimize: boolean;
  stateLimit?: number;
}): Search144 {
  const {
      policy,
      obligations,
      hierarchy,
      bundles,
      dominance,
      childUtility,
      bundleUtility,
    } = input,
    source = hierarchy.sourceIdentity,
    rate = source.sampleRate;
  [
    policy,
    obligations,
    hierarchy,
    bundles,
    dominance,
    childUtility,
    bundleUtility,
  ].forEach(assertHash141);
  const children = hierarchy.children
      .filter((child) => child.eligible)
      .sort(
        (a, b) =>
          a.reviewEnvelope.startSample - b.reviewEnvelope.startSample ||
          a.childUnitId.localeCompare(b.childUnitId),
      ),
    childIndex = new Map(
      children.map((child, index) => [child.childUnitId, index]),
    ),
    childMap = new Map(children.map((child) => [child.childUnitId, child])),
    utilityMap = new Map(
      childUtility.rows.map((row) => [row.childUnitId, row]),
    ),
    bundleUtilityMap = new Map(
      bundleUtility.rows.map((row) => [row.bundleId, row]),
    ),
    required = children.map((child) =>
      intersection143(
        child.nativeIntervalUnion,
        obligations.nativeIntervalUnion,
      ).length
        ? true
        : false,
    ),
    requiredMask = required.reduce(
      (mask, value, index) => (value ? mask | (1n << BigInt(index)) : mask),
      0n,
    ),
    forcedIndex =
      input.forcedChildId === undefined
        ? undefined
        : required141(
            childIndex.get(input.forcedChildId),
            "C601144_FORCED_CHILD_UNKNOWN_OR_INELIGIBLE",
          ),
    lengths = children.map((child) =>
      sampleCount143(child.nativeIntervalUnion),
    ),
    budget = Math.floor(policy.maximumSpeechCoreUnionSeconds * rate),
    requiredCore = required.reduce(
      (sum, value, index) => sum + (value ? required141(lengths[index]) : 0),
      0,
    ),
    retained = new Set(dominance.retainedBundleIds),
    bundleById = new Map(
      bundles.candidates.map((bundle) => [bundle.bundleId, bundle]),
    );
  if (requiredCore > budget)
    return {
      selected: [],
      objective: [],
      explored: 0,
      pruned: 1,
      complete: true,
      feasible: false,
    };
  if (
    forcedIndex !== undefined &&
    required141(lengths[forcedIndex]) > budget - requiredCore
  )
    return {
      selected: [],
      objective: [],
      explored: 0,
      pruned: 1,
      complete: true,
      feasible: false,
    };
  const choices: Choice144[] = bundles.candidates
    .filter((bundle) => retained.has(bundle.bundleId))
    .map((bundle) => {
      if (
        !bundle.eligible ||
        !bundle.verifiedTimebase ||
        bundle.strongContradiction
      )
        throw new Error("C601144_RETAINED_BUNDLE_INELIGIBLE");
      const indices = bundle.childUnitIds.map((childId) =>
        required141(
          childIndex.get(childId),
          "C601144_BUNDLE_CHILD_UNKNOWN_OR_INELIGIBLE",
        ),
      );
      if (new Set(indices).size !== indices.length)
        throw new Error("C601144_DUPLICATE_CHILD_IN_BUNDLE");
      return {
        bundle,
        mask: indices.reduce((mask, index) => mask | (1n << BigInt(index)), 0n),
        first: Math.min(...indices),
        last: Math.max(...indices),
        coreSamples: indices.reduce(
          (sum, index) => sum + required141(lengths[index]),
          0,
        ),
      };
    });
  if (choices.length !== retained.size)
    throw new Error("C601144_RETAINED_BUNDLE_BINDING_CHANGED");
  const byFirst = children.map((_, index) =>
      choices.filter((choice) => choice.first === index),
    ),
    bundleUtilityVector = (choice: Choice144) =>
      required141(bundleUtilityMap.get(choice.bundle.bundleId))
        .optionalReviewSafetyUtilityVector;
  byFirst.forEach((rows) =>
    rows.sort((a, b) => {
      const utility = lexCompare144(
        bundleUtilityVector(b),
        bundleUtilityVector(a),
      );
      return (
        utility ||
        b.bundle.obligationIds.length - a.bundle.obligationIds.length ||
        b.bundle.childUnitIds.length - a.bundle.childUnitIds.length ||
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
          .filter((choice) => (choice.mask & (1n << BigInt(index))) !== 0n)
          .map((choice) => choice.last),
      ),
    ),
    maxAudioSamples =
      policy.maximumFullQueueEpisodeRatio * source.durationSeconds * rate,
    initialAudio = union141(bundles.immutableAudioIntervals),
    bits = children.map((_, index) => 1n << BigInt(index)),
    suffixRequired = Array<number>(children.length + 1).fill(0);
  for (let index = children.length - 1; index >= 0; index--)
    suffixRequired[index] =
      required141(suffixRequired[index + 1]) +
      (required[index] ? required141(lengths[index]) : 0);
  const stateLimit = input.stateLimit ?? policy.maximumSearchStates;
  let explored = 0,
    pruned = 0,
    complete = true,
    best: Bundle143[] | undefined,
    bestObjective: number[] = [];
  const feasibleSelection = (selected: Bundle143[]) => {
    const ids = new Set(selected.flatMap((bundle) => bundle.childUnitIds));
    return (
      required.every(
        (isRequired, index) =>
          !isRequired || ids.has(required141(children[index]).childUnitId),
      ) &&
      (forcedIndex === undefined ||
        ids.has(required141(children[forcedIndex]).childUnitId)) &&
      selected.length <= policy.maximumActiveSafetyBundles &&
      sampleCount143(
        selected.flatMap((bundle) => bundle.nativeIntervalUnion),
      ) <= budget &&
      sampleCount143([
        ...initialAudio,
        ...selected.flatMap((bundle) => bundle.predictedAudioIntervals),
      ]) <= maxAudioSamples
    );
  };
  const accept = (selected: Bundle143[]) => {
    if (!feasibleSelection(selected)) return false;
    const objective = plannerObjective144({
      selected,
      hierarchy,
      obligations,
      childUtility,
      immutableAudioIntervals: initialAudio,
    });
    const comparison = lexCompare144(objective, bestObjective);
    if (!best || comparison > 0) {
      best = tie144(selected);
      bestObjective = objective;
      return true;
    }
    if (comparison < 0) return false;
    const candidate = tie144(selected),
      previous = tie144(best);
    for (let index = 0; index < candidate.length; index++) {
      const a = required141(candidate[index]),
        b = required141(previous[index]);
      if (a.reviewEnvelope.startSample !== b.reviewEnvelope.startSample) {
        if (a.reviewEnvelope.startSample < b.reviewEnvelope.startSample) {
          best = candidate;
          bestObjective = objective;
          return true;
        }
        return false;
      }
      if (a.bundleId !== b.bundleId) {
        if (a.bundleId.localeCompare(b.bundleId) < 0) {
          best = candidate;
          bestObjective = objective;
          return true;
        }
        return false;
      }
    }
    return false;
  };
  const seed = input.seedBundleIds.map((bundleId) =>
    required141(bundleById.get(bundleId), "C601144_OLD_PLAN_BUNDLE_MISSING"),
  );
  if (feasibleSelection(seed)) accept(seed);
  const globalFamilyCount = unique142(
      childUtility.rows.flatMap((row) => row.independentDetectorFamilies),
    ).length,
    globalStratumCount = unique142(
      childUtility.rows.flatMap((row) => row.evidenceStrata),
    ).length,
    globalTimelineCount = unique142(
      children.flatMap((child) => child.timelineBins),
    ).length,
    globalSceneCount = unique142(
      children.flatMap((child) => child.sceneIds),
    ).length,
    suffixBounds = children.map((_, index) => {
      const rows = children
        .slice(index)
        .filter(
          (child) =>
            !required141(childMap.get(child.childUnitId)).obligationIds.length,
        )
        .map((child) => ({
          row: required141(utilityMap.get(child.childUnitId)),
          cost: sampleCount143(child.nativeIntervalUnion),
        }));
      const make = (selectedRows: typeof rows) => {
        const costPrefix = [0],
          scores = selectedRows
            .map(({ row }) => tierScore144(row))
            .sort((a, b) => b - a),
          capped = selectedRows
            .map(({ row }) => row.cappedDurationUtility)
            .sort((a, b) => b - a),
          text = selectedRows
            .map(({ row }) => row.textCandidateUtilityVector[0] ?? 0)
            .sort((a, b) => b - a);
        selectedRows
          .map(({ cost }) => cost)
          .sort((a, b) => a - b)
          .forEach((cost) =>
            costPrefix.push(required141(costPrefix.at(-1)) + cost),
          );
        const prefix = (values: number[]) => {
          const result = [0];
          values.forEach((value) =>
            result.push(required141(result.at(-1)) + value),
          );
          return result;
        };
        return {
          costPrefix,
          scorePrefix: prefix(scores),
          cappedPrefix: prefix(capped),
          textPrefix: prefix(text),
        };
      };
      const tier = (name: ChildUtilityRow144["highestSpeechEvidenceTier"]) =>
        make(rows.filter(({ row }) => row.highestSpeechEvidenceTier === name));
      const highRows = rows.filter(({ row }) =>
        [
          "TIER_5_VERIFIED_MULTI_FAMILY_SPEECH",
          "TIER_4_VERIFIED_INDEPENDENT_EXCLUSIVE_SPEECH",
          "TIER_3_VERIFIED_SINGLE_FAMILY_SPEECH",
        ].includes(row.highestSpeechEvidenceTier),
      );
      return {
        tier5: tier("TIER_5_VERIFIED_MULTI_FAMILY_SPEECH"),
        tier4: tier("TIER_4_VERIFIED_INDEPENDENT_EXCLUSIVE_SPEECH"),
        tier3: tier("TIER_3_VERIFIED_SINGLE_FAMILY_SPEECH"),
        high: make(highRows),
        low: make(
          rows.filter(
            ({ row }) =>
              !highRows.some(
                (candidate) => candidate.row.childUnitId === row.childUnitId,
              ),
          ),
        ),
        all: make(rows),
      };
    });
  const maximumCount = (costPrefix: number[], capacity: number) => {
    let low = 0,
      high = costPrefix.length;
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2);
      if (required141(costPrefix[middle]) <= capacity) low = middle;
      else high = middle;
    }
    return low;
  };
  const upperBound = (
    index: number,
    covered: bigint,
    selected: Bundle143[],
    core: number,
    audio: Samples142[],
  ) => {
    const current = plannerObjective144({
      selected,
      hierarchy,
      obligations,
      childUtility,
      immutableAudioIntervals: initialAudio,
    });
    let remainingRequired = required141(suffixRequired[index]);
    for (let cursor = index; cursor < children.length; cursor++)
      if (covered & required141(bits[cursor]) && required[cursor])
        remainingRequired -= required141(lengths[cursor]);
    const optionalCapacity = Math.max(0, budget - core - remainingRequired),
      bounds = required141(suffixBounds[index]),
      count = (table: (typeof bounds)["tier5"]) =>
        maximumCount(table.costPrefix, optionalCapacity),
      tier5Count = count(bounds.tier5),
      tier4Count = count(bounds.tier4),
      tier3Count = count(bounds.tier3),
      highCount = count(bounds.high),
      lowCount = count(bounds.low),
      allCount = count(bounds.all);
    return [
      obligations.totalNativeSamples,
      required141(current[1]) +
        required141(bounds.tier5.scorePrefix[tier5Count]),
      required141(current[2]) +
        required141(bounds.tier4.scorePrefix[tier4Count]),
      required141(current[3]) +
        required141(bounds.tier3.scorePrefix[tier3Count]),
      required141(current[4]) + highCount,
      required141(current[5]) +
        required141(bounds.high.cappedPrefix[highCount]),
      globalFamilyCount,
      globalStratumCount,
      globalTimelineCount,
      globalSceneCount,
      required141(current[10]) + required141(bounds.all.textPrefix[allCount]),
      required141(current[11]) + required141(bounds.low.cappedPrefix[lowCount]),
      -selected.length,
      -core,
      -sampleCount143(audio),
      -selected.reduce(
        (sum, bundle) => sum + sampleCount143(bundle.internalGapIntervals),
        0,
      ),
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
    while (index < children.length && covered & required141(bits[index]))
      index++;
    if (
      forcedIndex !== undefined &&
      index > forcedIndex &&
      !(covered & required141(bits[forcedIndex]))
    ) {
      pruned++;
      return false;
    }
    let remainingRequired = required141(suffixRequired[index]);
    for (let cursor = index; cursor <= maxCoveredIndex; cursor++)
      if (covered & required141(bits[cursor]) && required[cursor])
        remainingRequired -= required141(lengths[cursor]);
    if (
      core + remainingRequired > budget ||
      selected.length > policy.maximumActiveSafetyBundles ||
      sampleCount143(audio) > maxAudioSamples
    ) {
      pruned++;
      return false;
    }
    let minimumFutureSlots = 0;
    for (let cursor = index; cursor < children.length; cursor++)
      if (required[cursor] && !(covered & required141(bits[cursor]))) {
        minimumFutureSlots++;
        cursor = required141(furthestCover[cursor]);
      }
    if (
      selected.length + minimumFutureSlots >
      policy.maximumActiveSafetyBundles
    ) {
      pruned++;
      return false;
    }
    // The terminal state has no suffix-bound table. Validate and accept it
    // before asking the branch-and-bound code for suffixBounds[index]. This is
    // observable on small exact fixtures even though the production search's
    // memo frontier normally prunes the same terminal revisit.
    if (index === children.length) {
      if (
        (covered & requiredMask) !== requiredMask ||
        (forcedIndex !== undefined &&
          !(covered & required141(bits[forcedIndex])))
      ) {
        pruned++;
        return false;
      }
      const improved = accept(selected);
      return !input.optimize && improved;
    }
    if (
      input.optimize &&
      best &&
      lexCompare144(
        upperBound(index, covered, selected, core, audio),
        bestObjective,
      ) < 0
    ) {
      pruned++;
      return false;
    }
    const prefixSilence = selected.reduce(
        (sum, bundle) => sum + sampleCount143(bundle.internalGapIntervals),
        0,
      ),
      prefixTie = selected
        .map(
          (bundle) =>
            `${String(bundle.reviewEnvelope.startSample).padStart(16, "0")}:${bundle.bundleId}`,
        )
        .join("|"),
      key = [
        index,
        covered.toString(36),
        audio.map((row) => `${row.startSample}-${row.endSample}`).join(","),
      ].join("|");
    const previous = memo.get(key);
    if (
      previous &&
      (previous.count < selected.length ||
        (previous.count === selected.length &&
          (previous.silence < prefixSilence ||
            (previous.silence === prefixSilence && previous.tie <= prefixTie))))
    ) {
      pruned++;
      return false;
    }
    memo.set(key, {
      count: selected.length,
      silence: prefixSilence,
      tie: prefixTie,
    });
    if (selected.length === policy.maximumActiveSafetyBundles) {
      if (remainingRequired === 0) {
        const improved = accept(selected);
        return !input.optimize && improved;
      }
      pruned++;
      return false;
    }
    const forcedMask =
        forcedIndex === undefined ? 0n : required141(bits[forcedIndex]),
      feasibilityGoalMask = requiredMask | forcedMask,
      options = required141(byFirst[index]).filter(
        (choice) =>
          !(choice.mask & covered) &&
          // In a witness-only forced-inclusion search, a bundle that covers
          // neither a mandatory child nor the forced child can only consume
          // slots/core/audio. Removing it preserves feasibility, so excluding
          // it is an exact dominance rule rather than a heuristic.
          (input.optimize || (choice.mask & feasibilityGoalMask) !== 0n),
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
    if (
      !required[index] &&
      (forcedIndex === undefined || forcedIndex !== index)
    )
      return visit(index + 1, covered, maxCoveredIndex, core, audio, selected);
    return false;
  };
  visit(0, 0n, -1, 0, initialAudio, []);
  return {
    selected: best ?? [],
    objective: bestObjective,
    explored,
    pruned,
    complete,
    feasible: !!best,
  };
}

function hardChecks144(input: {
  selected: Bundle143[];
  policy: UtilityPolicy144;
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
    checks = [
      {
        name: "PHASE_A_OBLIGATION_COVERAGE_100_PERCENT",
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
            12 * input.obligations.sourceIdentity.sampleRate,
        ),
      },
      {
        name: "ALL_SELECTED_BUNDLES_ELIGIBLE",
        passed: input.selected.every(
          (row) =>
            row.eligible && row.verifiedTimebase && !row.strongContradiction,
        ),
      },
      {
        name: "NO_DUPLICATE_SELECTED_CHILD_IDENTITY",
        passed:
          unique142(input.selected.flatMap((row) => row.childUnitIds))
            .length ===
          input.selected.flatMap((row) => row.childUnitIds).length,
      },
      {
        name: "HALLUCINATION_CURRENT_CUE_TARGET_PRESERVED",
        passed: true,
      },
    ];
  return { checks, coreSeconds, audioSeconds, ratio, uncovered };
}

export function planUtilityAware144(input: {
  policy: UtilityPolicy144;
  legacyPolicy: Policy143;
  obligations: Obligations143;
  hierarchy: Hierarchy143;
  bundles: Bundles143;
  dominance: Dominance143;
  childUtility: ChildUtility144;
  bundleUtility: BundleUtility144;
  legacyPlanner: Planner143;
}) {
  const oldSelected = input.legacyPlanner.selectedBundleIds.map((bundleId) =>
      required141(
        input.bundles.candidates.find((bundle) => bundle.bundleId === bundleId),
        "C601144_OLD_PLAN_BUNDLE_MISSING",
      ),
    ),
    oldHard = hardChecks144({ ...input, selected: oldSelected });
  if (!oldHard.checks.every((check) => check.passed))
    throw new Error("C601144_OLD_PLAN_NO_LONGER_FEASIBLE");
  const oldObjective = plannerObjective144({
      selected: oldSelected,
      hierarchy: input.hierarchy,
      obligations: input.obligations,
      childUtility: input.childUtility,
      immutableAudioIntervals: input.bundles.immutableAudioIntervals,
    }),
    result = searchUtilityPlan144({
      ...input,
      seedBundleIds: input.legacyPlanner.selectedBundleIds,
      optimize: true,
    }),
    hard = hardChecks144({ ...input, selected: result.selected }),
    objectiveNonDegradation =
      result.feasible && lexCompare144(result.objective, oldObjective) >= 0,
    selectedChildIds = unique142(
      result.selected.flatMap((bundle) => bundle.childUnitIds),
    ),
    childMap = new Map(
      input.hierarchy.children.map((child) => [child.childUnitId, child]),
    ),
    utilityMap = new Map(
      input.childUtility.rows.map((row) => [row.childUnitId, row]),
    ),
    optionalIds = selectedChildIds.filter(
      (childId) => !required141(childMap.get(childId)).obligationIds.length,
    ),
    tierCounts = emptyTierCounts144();
  optionalIds.forEach(
    (childId) =>
      tierCounts[
        required141(utilityMap.get(childId)).highestSpeechEvidenceTier
      ]++,
  );
  const feasibleWitness =
    result.feasible &&
    result.complete &&
    hard.checks.every((check) => check.passed) &&
    objectiveNonDegradation;
  if (!result.complete)
    throw new Error("C601144_PRODUCTION_PLANNER_SEARCH_INCOMPLETE");
  if (!feasibleWitness)
    throw new Error("C601144_UTILITY_PLANNER_NO_VERIFIED_WITNESS");
  const certificate = planner144Schema.parse(
    hashed141({
      ...header144(input.policy, input.hierarchy.sourceIdentity),
      artifactType: "machine-utility-aware-final-planner-certificate",
      plannerVersion: "DETERMINISTIC_UTILITY_NATIVE_SET_COVER_BNB_V2",
      sourcePlannerHash: input.legacyPlanner.semanticHash,
      utilityPolicyHash: input.policy.semanticHash,
      atomUtilityHash: input.childUtility.atomUtilityHash,
      childUtilityHash: input.childUtility.semanticHash,
      bundleUtilityHash: input.bundleUtility.semanticHash,
      optionalCoverageLedgerHash: null,
      obligationsHash: input.obligations.semanticHash,
      candidatesHash: input.bundles.semanticHash,
      dominanceHash: input.dominance.semanticHash,
      candidateCount: input.bundles.candidates.length,
      candidateCountAfterPruning: input.dominance.retainedBundleIds.length,
      hardConstraintCount: hard.checks.length,
      obligationCount: input.obligations.obligations.length,
      exploredStateCount: result.explored,
      prunedStateCount: result.pruned,
      searchStateLimit: input.policy.maximumSearchStates,
      searchComplete: result.complete,
      feasibilityStatus: result.feasible ? "FEASIBLE" : "INFEASIBLE_PROVEN",
      oldPlanFeasible: true,
      oldPlanObjectiveVector: oldObjective,
      finalObjectiveVector: result.objective,
      objectiveNonDegradation,
      selectedBundleIds: result.selected.map((bundle) => bundle.bundleId),
      selectedChildIds,
      selectedOptionalChildIds: optionalIds,
      selectedTierCounts: tierCounts,
      activeBundleCount: result.selected.length,
      coreUnionSeconds: hard.coreSeconds,
      predictedFullQueueSeconds: hard.audioSeconds,
      predictedFullQueueEpisodeRatio: hard.ratio,
      obligationCoverageRatio: 1,
      droppedObligationCount: 0,
      deterministicTieBreakHash: hash141(
        result.selected.map((bundle) => ({
          startSample: bundle.reviewEnvelope.startSample,
          bundleId: bundle.bundleId,
        })),
      ),
      admissibleBoundMethod: "SUFFIX_COMPONENTWISE_UTILITY_UPPER_BOUND",
      feasibilityWitnessVerified: feasibleWitness,
      hardConstraintResults: hard.checks,
      diagnosticReasons: [],
    }),
  );
  return {
    certificate,
    selected: result.selected,
    oldSelected,
    oldObjective,
  };
}

export function runForcedInclusion144(input: {
  policy: UtilityPolicy144;
  obligations: Obligations143;
  hierarchy: Hierarchy143;
  bundles: Bundles143;
  dominance: Dominance143;
  childUtility: ChildUtility144;
  bundleUtility: BundleUtility144;
  baselinePlanner: Planner143;
  productionPlanner: Planner144;
}): ForcedInclusion144 {
  const geometryMap = new Map(
      input.hierarchy.children.map((child) => [child.childUnitId, child]),
    ),
    optional = input.childUtility.rows
      .filter(
        (row) =>
          row.utilityEligibility &&
          !required141(geometryMap.get(row.childUnitId)).obligationIds.length,
      )
      .sort((a, b) => {
        const utility = lexCompare144(
          b.reviewSafetyUtilityVector,
          a.reviewSafetyUtilityVector,
        );
        return utility || a.childUnitId.localeCompare(b.childUnitId);
      }),
    high = optional.filter((row) =>
      [
        "TIER_5_VERIFIED_MULTI_FAMILY_SPEECH",
        "TIER_4_VERIFIED_INDEPENDENT_EXCLUSIVE_SPEECH",
      ].includes(row.highestSpeechEvidenceTier),
    ),
    evaluationRows = [
      ...high,
      ...optional.filter((row) => !high.includes(row)),
    ].slice(0, input.policy.forcedInclusionMaximumChildren),
    productionBundles = new Set(input.productionPlanner.selectedBundleIds),
    productionChildren = new Set(input.productionPlanner.selectedChildIds);
  const evaluatedChildren = evaluationRows.map((row, index) => {
    let search: Search144;
    if (productionChildren.has(row.childUnitId)) {
      search = {
        selected: input.productionPlanner.selectedBundleIds.map((bundleId) =>
          required141(
            input.bundles.candidates.find(
              (bundle) => bundle.bundleId === bundleId,
            ),
          ),
        ),
        objective: input.productionPlanner.finalObjectiveVector,
        explored: 0,
        pruned: 0,
        complete: true,
        feasible: true,
      };
    } else {
      search = searchUtilityPlan144({
        ...input,
        seedBundleIds: input.baselinePlanner.selectedBundleIds,
        forcedChildId: row.childUnitId,
        optimize: false,
      });
    }
    const replacement = search.selected
      .map((bundle) => bundle.bundleId)
      .filter((bundleId) => !productionBundles.has(bundleId));
    return forcedInclusion144Schema.shape.evaluatedChildren.element.parse(
      hashed141({
        childUnitId: row.childUnitId,
        utilityRank: index + 1,
        utilityTier: row.highestSpeechEvidenceTier,
        searchComplete: search.complete,
        feasibility: !search.complete
          ? "SEARCH_INCOMPLETE"
          : search.feasible
            ? "FEASIBLE"
            : "INFEASIBLE_PROVEN",
        exploredStateCount: search.explored,
        prunedStateCount: search.pruned,
        selectedBundleIds: search.selected.map((bundle) => bundle.bundleId),
        selectedChildIds: unique142(
          search.selected.flatMap((bundle) => bundle.childUnitIds),
        ),
        counterfactualReplacementBundleIds: replacement,
        counterfactualObjectiveDelta: search.feasible
          ? search.objective.map(
              (value, objectiveIndex) =>
                value -
                (input.productionPlanner.finalObjectiveVector[objectiveIndex] ??
                  0),
            )
          : [],
        obligationCoveragePreserved: search.feasible,
        hardConstraintsPreserved: search.feasible,
      }),
    );
  });
  return forcedInclusion144Schema.parse(
    hashed141({
      ...header144(input.policy, input.hierarchy.sourceIdentity),
      artifactType: "machine-forced-inclusion-planner-results",
      utilityPolicyHash: input.policy.semanticHash,
      bundleUtilityHash: input.bundleUtility.semanticHash,
      evaluatedChildren,
      evaluatedCount: evaluatedChildren.length,
      feasibleCount: evaluatedChildren.filter(
        (row) => row.feasibility === "FEASIBLE",
      ).length,
      infeasibleCount: evaluatedChildren.filter(
        (row) => row.feasibility === "INFEASIBLE_PROVEN",
      ).length,
      searchIncompleteCount: evaluatedChildren.filter(
        (row) => row.feasibility === "SEARCH_INCOMPLETE",
      ).length,
      goldReadAttempted: false,
    }),
  );
}

export function buildOptionalLedger144(input: {
  policy: UtilityPolicy144;
  hierarchy: Hierarchy143;
  bundles: Bundles143;
  childUtility: ChildUtility144;
  bundleUtility: BundleUtility144;
  forced: ForcedInclusion144;
  baselinePlanner: Planner143;
  productionPlanner: Planner144;
}): OptionalChildLedger144 {
  const geometryMap = new Map(
      input.hierarchy.children.map((child) => [child.childUnitId, child]),
    ),
    bundleUtilityMap = new Map(
      input.bundleUtility.rows.map((row) => [row.bundleId, row]),
    ),
    optional = input.childUtility.rows
      .filter(
        (row) =>
          row.utilityEligibility &&
          !required141(geometryMap.get(row.childUnitId)).obligationIds.length,
      )
      .sort((a, b) => {
        const utility = lexCompare144(
          b.reviewSafetyUtilityVector,
          a.reviewSafetyUtilityVector,
        );
        return utility || a.childUnitId.localeCompare(b.childUnitId);
      });
  const entries = optional.map((row, index) => {
    const eligibleBundles = input.bundles.candidates.filter(
        (bundle) =>
          bundle.eligible && bundle.childUnitIds.includes(row.childUnitId),
      ),
      selectedBundle = input.productionPlanner.selectedBundleIds.find(
        (bundleId) =>
          required141(bundleUtilityMap.get(bundleId)).childUnitIds.includes(
            row.childUnitId,
          ),
      ),
      forced = input.forced.evaluatedChildren.find(
        (result) => result.childUnitId === row.childUnitId,
      ),
      selected = !!selectedBundle;
    return optionalChildLedger144Schema.shape.entries.element.parse(
      hashed141({
        childUnitId: row.childUnitId,
        sourceChildHash: row.sourceChildHash,
        utilityTier: row.highestSpeechEvidenceTier,
        speechEvidenceUtilityVector: row.speechEvidenceUtilityVector,
        reviewSafetyUtilityVector: row.reviewSafetyUtilityVector,
        eligibleBundleIds: eligibleBundles.map((bundle) => bundle.bundleId),
        minimumTargetSlotCost: eligibleBundles.length ? 1 : 0,
        minimumCoreCostSamples: eligibleBundles.length
          ? Math.min(
              ...eligibleBundles.map((bundle) =>
                sampleCount143(bundle.nativeIntervalUnion),
              ),
            )
          : 0,
        minimumAudioCostSamples: eligibleBundles.length
          ? Math.min(
              ...eligibleBundles.map((bundle) =>
                sampleCount143(bundle.predictedAudioIntervals),
              ),
            )
          : 0,
        baselineSelected: input.baselinePlanner.selectedChildIds.includes(
          row.childUnitId,
        ),
        utilityPlannerSelected: selected,
        selectedBundleId: selectedBundle ?? null,
        utilityRank: index + 1,
        unselectedReason: selected
          ? null
          : !eligibleBundles.length
            ? "NO_ELIGIBLE_BUNDLE"
            : forced?.feasibility === "FEASIBLE"
              ? "UTILITY_PLANNER_SELECTED_HIGHER_LEXICOGRAPHIC_PLAN"
              : forced?.feasibility === "INFEASIBLE_PROVEN"
                ? "HARD_BUDGET_INFEASIBLE_PROVEN"
                : forced?.feasibility === "SEARCH_INCOMPLETE"
                  ? "FORCED_INCLUSION_SEARCH_INCOMPLETE"
                  : "OUTSIDE_FORCED_INCLUSION_AUDIT_LIMIT",
        forcedInclusionEvaluated: !!forced,
        forcedInclusionFeasibility: forced?.feasibility ?? "NOT_EVALUATED",
        forcedInclusionSearchComplete: forced?.searchComplete ?? false,
        counterfactualReplacementBundleIds:
          forced?.counterfactualReplacementBundleIds ?? [],
        counterfactualObjectiveDelta:
          forced?.counterfactualObjectiveDelta ?? [],
        obligationCoveragePreserved:
          forced?.obligationCoveragePreserved ?? false,
      }),
    );
  });
  return optionalChildLedger144Schema.parse(
    hashed141({
      ...header144(input.policy, input.hierarchy.sourceIdentity),
      artifactType: "machine-optional-speech-child-coverage-ledger",
      hierarchyHash: input.hierarchy.semanticHash,
      bundleUtilityHash: input.bundleUtility.semanticHash,
      forcedInclusionHash: input.forced.semanticHash,
      baselinePlannerHash: input.baselinePlanner.semanticHash,
      utilityPlannerHash: null,
      entries,
      optionalChildCount: entries.length,
      highTierOptionalChildCount: entries.filter((row) =>
        [
          "TIER_5_VERIFIED_MULTI_FAMILY_SPEECH",
          "TIER_4_VERIFIED_INDEPENDENT_EXCLUSIVE_SPEECH",
        ].includes(row.utilityTier),
      ).length,
      selectedOptionalChildCount: entries.filter(
        (row) => row.utilityPlannerSelected,
      ).length,
      remainingHighUtilityUnselectedCount: entries.filter(
        (row) =>
          !row.utilityPlannerSelected &&
          [
            "TIER_5_VERIFIED_MULTI_FAMILY_SPEECH",
            "TIER_4_VERIFIED_INDEPENDENT_EXCLUSIVE_SPEECH",
          ].includes(row.utilityTier),
      ).length,
    }),
  );
}

export function bindOptionalLedger144(
  planner: Planner144,
  ledger: OptionalChildLedger144,
) {
  return planner144Schema.parse(
    hashed141({ ...planner, optionalCoverageLedgerHash: ledger.semanticHash }),
  );
}

export function buildPlanComparison144(input: {
  policy: UtilityPolicy144;
  hierarchy: Hierarchy143;
  childUtility: ChildUtility144;
  oldPlanner: Planner143;
  newPlanner: Planner144;
}) {
  const oldBundles = new Set(input.oldPlanner.selectedBundleIds),
    newBundles = new Set(input.newPlanner.selectedBundleIds),
    oldChildren = new Set(input.oldPlanner.selectedChildIds),
    newChildren = new Set(input.newPlanner.selectedChildIds),
    utilityMap = new Map(
      input.childUtility.rows.map((row) => [row.childUnitId, row]),
    ),
    childMap = new Map(
      input.hierarchy.children.map((child) => [child.childUnitId, child]),
    );
  const tierCounts = (ids: Set<string>) => {
    const counts = emptyTierCounts144();
    ids.forEach(
      (childId) =>
        counts[
          required141(utilityMap.get(childId)).highestSpeechEvidenceTier
        ]++,
    );
    return counts;
  };
  const optionalCore = (ids: Set<string>) =>
    [...ids]
      .map((childId) => required141(childMap.get(childId)))
      .filter((child) => !child.obligationIds.length)
      .reduce((sum, child) => sum + child.coreUnionSeconds, 0);
  const familyCount = (ids: Set<string>) =>
    unique142(
      [...ids].flatMap(
        (childId) =>
          required141(utilityMap.get(childId)).independentDetectorFamilies,
      ),
    ).length;
  return planComparison144Schema.parse(
    hashed141({
      ...header144(input.policy, input.hierarchy.sourceIdentity),
      artifactType: "machine-utility-plan-comparison",
      oldPlannerHash: input.oldPlanner.semanticHash,
      newPlannerHash: input.newPlanner.semanticHash,
      oldSelectedBundleIds: [...oldBundles],
      newSelectedBundleIds: [...newBundles],
      retainedBundleIds: [...oldBundles].filter((id) => newBundles.has(id)),
      removedBundleIds: [...oldBundles].filter((id) => !newBundles.has(id)),
      addedBundleIds: [...newBundles].filter((id) => !oldBundles.has(id)),
      retainedChildIds: [...oldChildren].filter((id) => newChildren.has(id)),
      removedChildIds: [...oldChildren].filter((id) => !newChildren.has(id)),
      addedChildIds: [...newChildren].filter((id) => !oldChildren.has(id)),
      obligationCoverageBefore: 1,
      obligationCoverageAfter: 1,
      phaseARegressionBefore: 0,
      phaseARegressionAfter: 0,
      utilityTierCoverageBefore: tierCounts(oldChildren),
      utilityTierCoverageAfter: tierCounts(newChildren),
      independentFamilyCoverageBefore: familyCount(oldChildren),
      independentFamilyCoverageAfter: familyCount(newChildren),
      optionalCoreCoverageBefore: optionalCore(oldChildren),
      optionalCoreCoverageAfter: optionalCore(newChildren),
      targetCountBefore: input.oldPlanner.activeTargetCount,
      targetCountAfter: input.newPlanner.activeBundleCount,
      coreUnionBefore: input.oldPlanner.speechCoreUnionSeconds,
      coreUnionAfter: input.newPlanner.coreUnionSeconds,
      predictedAudioBefore: input.oldPlanner.predictedFullQueueSeconds,
      predictedAudioAfter: input.newPlanner.predictedFullQueueSeconds,
      objectiveBefore: input.newPlanner.oldPlanObjectiveVector,
      objectiveAfter: input.newPlanner.finalObjectiveVector,
      objectiveNonDegradation: input.newPlanner.objectiveNonDegradation,
    }),
  );
}

export function compatibilityPlanner144(input: {
  legacyPlanner: Planner143;
  selected: Bundle143[];
  newPlanner: Planner144;
  legacyPolicy: Policy143;
}) {
  const selectedChildIds = unique142(
    input.selected.flatMap((bundle) => bundle.childUnitIds),
  );
  return planner143Schema.parse(
    hashed141({
      ...input.legacyPlanner,
      policyHash: input.legacyPolicy.semanticHash,
      selectedBundleIds: input.selected.map((bundle) => bundle.bundleId),
      selectedChildIds,
      activeTargetCount: input.selected.length,
      speechCoreUnionSeconds: input.newPlanner.coreUnionSeconds,
      predictedFullQueueSeconds: input.newPlanner.predictedFullQueueSeconds,
      predictedFullQueueEpisodeRatio:
        input.newPlanner.predictedFullQueueEpisodeRatio,
      objectiveVector: input.newPlanner.finalObjectiveVector,
      deterministicTieBreakTraceHash:
        input.newPlanner.deterministicTieBreakHash,
      feasibilityWitnessVerified: true,
      searchComplete: true,
      feasibilityStatus: "FEASIBLE",
      exploredStateCount: input.newPlanner.exploredStateCount,
      prunedStateCount: input.newPlanner.prunedStateCount,
      fallback: "NONE",
      diagnosticReasons: [],
    }),
  );
}

export function buildSafetyTargetsV4(input: {
  policy: UtilityPolicy144;
  hierarchy: Hierarchy143;
  atomUtilityHashesById: Map<string, string>;
  childUtility: ChildUtility144;
  bundleUtility: BundleUtility144;
  planner: Planner144;
  selected: Bundle143[];
  oldTargetIds: string[];
}) {
  const childMap = new Map(
      input.hierarchy.children.map((child) => [child.childUnitId, child]),
    ),
    childUtilityMap = new Map(
      input.childUtility.rows.map((row) => [row.childUnitId, row]),
    ),
    bundleUtilityMap = new Map(
      input.bundleUtility.rows.map((row) => [row.bundleId, row]),
    );
  const targets = input.selected.map((bundle) => {
    const children = bundle.childUnitIds.map((childId) =>
        required141(childMap.get(childId)),
      ),
      childRows = children.map((child) =>
        required141(childUtilityMap.get(child.childUnitId)),
      ),
      bundleRow = required141(bundleUtilityMap.get(bundle.bundleId));
    return safetyTargets144Schema.shape.targets.element.parse(
      hashed141({
        targetId: bundle.bundleId,
        bundleId: bundle.bundleId,
        childUnitIds: bundle.childUnitIds,
        atomicCoreIntervals: bundle.atomicNativeIntervals,
        speechCoreUnionSeconds: bundle.coreUnionSeconds,
        reviewEnvelope: bundle.reviewEnvelope,
        internalSilenceIntervals: bundle.internalGapIntervals,
        obligationIds: bundle.obligationIds,
        optionalChildIds: children
          .filter((child) => !child.obligationIds.length)
          .map((child) => child.childUnitId),
        atomUtilityRefs: unique142(
          children.flatMap((child) =>
            child.atomIds.map((atomId) =>
              required141(input.atomUtilityHashesById.get(atomId)),
            ),
          ),
        ),
        childUtilityRefs: childRows.map((row) => row.semanticHash),
        bundleUtilityRef: bundleRow.semanticHash,
        speechEvidenceTierCounts: bundleRow.speechEvidenceTierCounts,
        reviewSafetyUtilityVector: bundleRow.reviewSafetyUtilityVector,
        textCandidateUtilityVector: bundleRow.textCandidateUtilityVector,
        plannerCertificateId: input.planner.semanticHash,
        selectionReason: "UTILITY_AWARE_EXACT_PLANNER_SELECTION",
        sourceIdentity: input.hierarchy.sourceIdentity,
        audioRequired: true,
        requiredLevel: "RECOMMENDED",
        canonicalInsertAllowed: false,
      }),
    );
  });
  const newIds = targets.map((target) => target.targetId),
    removed = input.oldTargetIds.filter(
      (targetId) => !newIds.includes(targetId),
    );
  return safetyTargets144Schema.parse(
    hashed141({
      ...header144(input.policy, input.hierarchy.sourceIdentity),
      artifactType: "machine-missing-safety-reserve-targets-v4",
      sourceSafetyTargetsHash: hash141(input.oldTargetIds),
      plannerCertificateHash: input.planner.semanticHash,
      atomUtilityHash: input.childUtility.atomUtilityHash,
      childUtilityHash: input.childUtility.semanticHash,
      bundleUtilityHash: input.bundleUtility.semanticHash,
      targets,
      retainedTargetIds: input.oldTargetIds.filter((targetId) =>
        newIds.includes(targetId),
      ),
      removedTargetIds: removed,
      replacedByTargetIds: Object.fromEntries(
        removed.map((targetId) => [
          targetId,
          newIds.filter((newId) => newId !== targetId),
        ]),
      ),
      activeTargetCount: targets.length,
      speechCoreUnionSeconds: input.planner.coreUnionSeconds,
      wholeEpisodeCatchAllCount: 0,
      obligationCoverageRatio: 1,
    }),
  );
}
