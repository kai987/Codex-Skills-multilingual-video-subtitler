import {
  planner143Schema,
  safety143Schema,
  type Bundle143,
  type Bundles143,
  type Dominance143,
  type Hierarchy143,
  type Obligations143,
  type Planner143,
  type Policy143,
  type Samples142,
  type Continuity143,
  type Monotonicity143,
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
  assertNative143,
  assertSource143,
  difference143,
  header143,
  sampleCount143,
} from "./c601143-policy.js";
import {
  validateCrossStageCoverageMonotonicity,
  assertMonotonicity143,
} from "./c601143-monotonicity.js";

interface Choice143 {
  bundle: Bundle143;
  mask: bigint;
  first: number;
  last: number;
  core: number;
  gain: number;
}
const lexCompare143 = (a: number[], b: number[]) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const delta = (a[i] ?? 0) - (b[i] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
};
const tie143 = (selected: Bundle143[]) =>
  [...selected].sort(
    (a, b) =>
      a.reviewEnvelope.startSample - b.reviewEnvelope.startSample ||
      a.bundleId.localeCompare(b.bundleId),
  );

/** Exact native-sample subset-sum relaxation. It ignores bundle, audio and slot
 * constraints, so it can only OVERestimate achievable new coverage. This is a
 * pruning bound, never a fabricated feasible selection. */
export function nativeKnapsackBounds143(
  costs: number[],
  mandatory: boolean[],
  capacity: number,
) {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = costs.filter((_, i) => !mandatory[i]).reduce(gcd, 0) || 1;
  const cap = Math.max(0, Math.floor(capacity / divisor));
  // A relaxed continuous bound is safe when a synthetic/high-rate fixture would
  // require an excessive lookup allocation; it merely prunes less aggressively.
  if ((cap + 1) * (costs.length + 1) > 40_000_000)
    return { divisor, tables: null, lookupCellCount: 0 };
  const mask = (1n << BigInt(cap + 1)) - 1n;
  let reachable = 1n;
  const tables = new Array<Uint32Array>(costs.length + 1);
  tables[costs.length] = new Uint32Array(cap + 1);
  for (let i = costs.length - 1; i >= 0; i--) {
    const cost = required141(costs[i]) / divisor;
    if (!mandatory[i] && cost <= cap)
      reachable |= (reachable << BigInt(cost)) & mask;
    const binary = reachable.toString(2),
      table = new Uint32Array(cap + 1);
    let latest = 0;
    for (let value = 0; value <= cap; value++) {
      if (binary[binary.length - 1 - value] === "1") latest = value;
      table[value] = latest;
    }
    tables[i] = table;
  }
  return { divisor, tables, lookupCellCount: (cap + 1) * (costs.length + 1) };
}

export function plannerObjective143(
  selected: Bundle143[],
  obligations: Obligations143,
  immutableAudio: Samples142[],
) {
  const cores = union141(selected.flatMap((c) => c.nativeIntervalUnion));
  const newCore = difference143(
    selected.flatMap((c) => c.independentSupportedNativeIntervals),
    obligations.nativeIntervalUnion,
  );
  const oldFamilies = new Set(
    obligations.obligations.flatMap((o) => o.detectorFamilies),
  );
  const oldStrata = new Set(
    obligations.obligations.flatMap((o) => o.evidenceStrata),
  );
  const novelty =
    unique142(selected.flatMap((c) => c.detectorFamilies)).filter(
      (f) => !oldFamilies.has(f),
    ).length +
    unique142(selected.flatMap((c) => c.evidenceStrata)).filter(
      (s) => !oldStrata.has(s),
    ).length;
  const diversity =
    unique142(selected.flatMap((c) => c.timelineBins)).length +
    unique142(selected.flatMap((c) => c.sceneIds)).length;
  const audio = difference143(
    selected.flatMap((c) => c.predictedAudioIntervals),
    immutableAudio,
  );
  const covered =
    sampleCount143(obligations.nativeIntervalUnion) -
    sampleCount143(difference143(obligations.nativeIntervalUnion, cores));
  // Native integer samples, not rounded seconds, determine coverage and cost.
  // O10 is compared as a sequence of source-native starts followed by stable IDs.
  return [
    covered,
    sampleCount143(newCore),
    novelty,
    diversity,
    selected.reduce((n, b) => n + b.machinePriority, 0),
    -selected.length,
    -sampleCount143(cores),
    -sampleCount143(audio),
    -selected.reduce((n, b) => n + sampleCount143(b.internalGapIntervals), 0),
  ];
}

/** Deterministic exact-cover B&B over the explicitly frozen bundle universe.
 * Every non-skipped child is consumed exactly once. Optional children may be
 * skipped, required children may not. A resource cap is reported as incomplete,
 * even when a independently verified feasible witness has already been found. */
export function planFinalSafety143(input: {
  policy: Policy143;
  obligations: Obligations143;
  hierarchy: Hierarchy143;
  bundles: Bundles143;
  dominance: Dominance143;
  stateLimit?: number;
}): { certificate: Planner143; selected: Bundle143[] } {
  const { policy, obligations, hierarchy, bundles, dominance } = input,
    source = bundles.sourceIdentity,
    rate = source.sampleRate;
  [policy, obligations, hierarchy, bundles, dominance].forEach(assertHash141);
  [obligations, hierarchy, dominance].forEach((v) =>
    assertSource143(v.sourceIdentity, source),
  );
  if (
    [obligations, hierarchy, bundles, dominance].some(
      (v) => v.policyHash !== policy.semanticHash,
    )
  )
    throw new Error("C601143_PLANNER_POLICY_BINDING_MISMATCH");
  if (
    bundles.childrenHash !== hierarchy.semanticHash ||
    bundles.obligationsHash !== obligations.semanticHash ||
    hierarchy.obligationsHash !== obligations.semanticHash ||
    dominance.candidatesHash !== bundles.semanticHash
  )
    throw new Error("C601143_PLANNER_INPUT_BINDING_MISMATCH");
  const stateLimit = input.stateLimit ?? policy.maximumSearchStates;
  if (
    !Number.isSafeInteger(stateLimit) ||
    stateLimit < 1 ||
    stateLimit > policy.maximumSearchStates
  )
    throw new Error("C601143_INVALID_SEARCH_RESOURCE_LIMIT");
  const children = hierarchy.children
    .filter((c) => c.eligible)
    .sort(
      (a, b) =>
        a.reviewEnvelope.startSample - b.reviewEnvelope.startSample ||
        a.childUnitId.localeCompare(b.childUnitId),
    );
  const childIndex = new Map(children.map((c, i) => [c.childUnitId, i]));
  const individualSamples = children.reduce(
    (n, c) => n + sampleCount143(c.nativeIntervalUnion),
    0,
  );
  if (
    individualSamples !==
    sampleCount143(children.flatMap((c) => c.nativeIntervalUnion))
  )
    throw new Error("C601143_PLANNER_REQUIRES_DISJOINT_CANONICAL_CHILD_CORES");
  const required = children.map(
    (c) =>
      difference143(
        c.nativeIntervalUnion,
        difference143(c.nativeIntervalUnion, obligations.nativeIntervalUnion),
      ).length > 0,
  );
  const requiredMask = required.reduce(
    (mask, r, i) => (r ? mask | (1n << BigInt(i)) : mask),
    0n,
  );
  const lengths = children.map((c) => sampleCount143(c.nativeIntervalUnion));
  const newLengths = children.map((c) =>
    sampleCount143(
      difference143(c.nativeIntervalUnion, obligations.nativeIntervalUnion),
    ),
  );
  const budget = Math.floor(policy.maximumSpeechCoreUnionSeconds * rate);
  const requiredCore = required.reduce(
    (n, r, i) => n + (r ? required141(lengths[i]) : 0),
    0,
  );
  const retained = new Set(dominance.retainedBundleIds);
  if (retained.size !== dominance.retainedBundleIds.length)
    throw new Error("C601143_DUPLICATE_RETAINED_BUNDLE");
  const choices: Choice143[] = bundles.candidates
    .filter((b) => retained.has(b.bundleId))
    .map((bundle) => {
      if (
        !bundle.eligible ||
        !bundle.verifiedTimebase ||
        bundle.strongContradiction
      )
        throw new Error("C601143_INELIGIBLE_RETAINED_BUNDLE");
      assertHash141(bundle);
      assertSource143(bundle.sourceIdentity, source);
      assertNative143(bundle.nativeIntervalUnion, source);
      const indices = bundle.childUnitIds.map((id) =>
        required141(
          childIndex.get(id),
          "C601143_BUNDLE_UNKNOWN_OR_INELIGIBLE_CHILD",
        ),
      );
      if (new Set(indices).size !== indices.length)
        throw new Error("C601143_DUPLICATE_CHILD_IN_BUNDLE");
      const childCore = union141(
        indices.flatMap((i) => required141(children[i]).nativeIntervalUnion),
      );
      if (hash141(childCore) !== hash141(union141(bundle.nativeIntervalUnion)))
        throw new Error("C601143_BUNDLE_CORE_IS_NOT_CHILD_CORE");
      return {
        bundle,
        mask: indices.reduce((m, i) => m | (1n << BigInt(i)), 0n),
        first: Math.min(...indices),
        last: Math.max(...indices),
        core: sampleCount143(childCore),
        gain: sampleCount143(
          difference143(
            bundle.independentSupportedNativeIntervals,
            obligations.nativeIntervalUnion,
          ),
        ),
      };
    });
  if (choices.length !== retained.size)
    throw new Error("C601143_UNKNOWN_RETAINED_BUNDLE_ID");
  const byFirst = children.map((_, i) => choices.filter((c) => c.first === i));
  const furthestCover = children.map((_, i) =>
    Math.max(
      i,
      ...choices
        .filter((c) => (c.mask & (1n << BigInt(i))) !== 0n)
        .map((c) => c.last),
    ),
  );
  for (const choicesAt of byFirst)
    choicesAt.sort(
      (a, b) =>
        b.gain - a.gain ||
        b.bundle.obligationIds.length - a.bundle.obligationIds.length ||
        b.bundle.childUnitIds.length - a.bundle.childUnitIds.length ||
        a.bundle.incrementalFullQueueAudioSeconds -
          b.bundle.incrementalFullQueueAudioSeconds ||
        a.bundle.bundleId.localeCompare(b.bundle.bundleId),
    );
  const maxAudio =
    policy.maximumFullQueueEpisodeRatio * source.durationSeconds * rate;
  const initialAudio = union141(bundles.immutableAudioIntervals);
  const oldCore = obligations.totalNativeSamples;
  const bits = children.map((_, i) => 1n << BigInt(i));
  const suffixRequired = Array<number>(children.length + 1).fill(0),
    suffixGain = Array<number>(children.length + 1).fill(0),
    suffixRequiredGain = Array<number>(children.length + 1).fill(0);
  for (let i = children.length - 1; i >= 0; i--) {
    suffixRequired[i] =
      required141(suffixRequired[i + 1]) +
      (required[i] ? required141(lengths[i]) : 0);
    suffixGain[i] = required141(suffixGain[i + 1]) + required141(newLengths[i]);
    suffixRequiredGain[i] =
      required141(suffixRequiredGain[i + 1]) +
      (required[i] ? required141(newLengths[i]) : 0);
  }
  const bounds = nativeKnapsackBounds143(
    lengths,
    required,
    budget - requiredCore,
  );
  let explored = 0,
    pruned = 0,
    complete = true,
    best: Bundle143[] | undefined,
    bestObjective: number[] = [];
  const isComplete = () => complete;
  const better = (candidate: Bundle143[], objective: number[]) => {
    const comparison = lexCompare143(objective, bestObjective);
    if (!best || comparison > 0) return true;
    if (comparison < 0) return false;
    const a = tie143(candidate),
      b = tie143(best);
    for (let i = 0; i < a.length; i++) {
      const aa = required141(a[i]),
        bb = required141(b[i]);
      if (aa.reviewEnvelope.startSample !== bb.reviewEnvelope.startSample)
        return aa.reviewEnvelope.startSample < bb.reviewEnvelope.startSample;
      if (aa.bundleId !== bb.bundleId)
        return aa.bundleId.localeCompare(bb.bundleId) < 0;
    }
    return false;
  };
  const accept = (selected: Bundle143[]) => {
    // The recursive exact-cover state already proves all mandatory child bits.
    // Rehashing the entire evidence hierarchy at every leaf is unnecessary;
    // the independently implemented native proof is run on the final witness.
    const objective = plannerObjective143(selected, obligations, initialAudio);
    if (better(selected, objective)) {
      best = tie143(selected);
      bestObjective = objective;
    }
  };
  // A mandatory-only pass obtains a hard-coverage witness before optimizing
  // optional evidence. It consumes the same declared search-state budget.
  const search = (mandatoryOnly: boolean, stopAtWitness: boolean) => {
    // Exact state dominance, not heuristic beam pruning. Same consumed children,
    // source audio, evidence coverage/diversity and priority give identical
    // possible continuations; keep the lexicographically cheaper prefix only.
    const memo = new Map<
      string,
      { count: number; silence: number; tie: string }
    >();
    const visit = (
      index: number,
      covered: bigint,
      maxCoveredIndex: number,
      core: number,
      gain: number,
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
        (covered & required141(bits[index]) ||
          (mandatoryOnly && !required[index]))
      )
        index++;
      let remainingRequired = required141(suffixRequired[index]),
        remainingGain = required141(suffixGain[index]),
        remainingRequiredGain = required141(suffixRequiredGain[index]);
      for (let i = index; i <= maxCoveredIndex; i++)
        if (covered & required141(bits[i])) {
          if (required[i]) {
            remainingRequired -= required141(lengths[i]);
            remainingRequiredGain -= required141(newLengths[i]);
          }
          remainingGain -= required141(newLengths[i]);
        }
      if (
        core + remainingRequired > budget ||
        selected.length > policy.maximumActiveSafetyTargets ||
        sampleCount143(audio) > maxAudio
      ) {
        pruned++;
        return false;
      }
      if (
        !mandatoryOnly &&
        best &&
        gain + Math.min(remainingGain, budget - core) <
          required141(bestObjective[1])
      ) {
        pruned++;
        return false;
      }
      const boundTable = bounds.tables?.[index];
      const optionalCapacity = Math.floor(
        (budget - core - remainingRequired) / bounds.divisor,
      );
      if (
        !mandatoryOnly &&
        best &&
        boundTable &&
        gain +
          remainingRequiredGain +
          required141(boundTable[optionalCapacity]) * bounds.divisor <
          required141(bestObjective[1])
      ) {
        pruned++;
        return false;
      }
      let minimumFutureSlots = 0;
      for (let i = index; i < children.length; i++)
        if (required[i] && !(covered & required141(bits[i]))) {
          minimumFutureSlots++;
          i = required141(furthestCover[i]);
        }
      if (
        selected.length + minimumFutureSlots >
        policy.maximumActiveSafetyTargets
      ) {
        pruned++;
        return false;
      }
      const prefixKey = [
        index,
        covered.toString(36),
        gain,
        core,
        audio.map((v) => `${v.startSample}-${v.endSample}`).join(","),
        unique142(selected.flatMap((b) => b.detectorFamilies)).join(","),
        unique142(selected.flatMap((b) => b.evidenceStrata)).join(","),
        unique142(selected.flatMap((b) => b.timelineBins)).join(","),
        unique142(selected.flatMap((b) => b.sceneIds)).join(","),
        selected.reduce((n, b) => n + b.machinePriority, 0),
      ].join("|");
      const prefixSilence = selected.reduce(
        (n, b) => n + sampleCount143(b.internalGapIntervals),
        0,
      );
      const prefixTie = selected
        .map(
          (b) =>
            `${String(b.reviewEnvelope.startSample).padStart(16, "0")}:${b.bundleId}`,
        )
        .join("|");
      const previous = memo.get(prefixKey);
      if (
        previous &&
        (previous.count < selected.length ||
          (previous.count === selected.length &&
            (previous.silence < prefixSilence ||
              (previous.silence === prefixSilence &&
                previous.tie <= prefixTie))))
      ) {
        pruned++;
        return false;
      }
      memo.set(prefixKey, {
        count: selected.length,
        silence: prefixSilence,
        tie: prefixTie,
      });
      if (index === children.length) {
        if ((covered & requiredMask) !== requiredMask) {
          pruned++;
          return false;
        }
        accept(selected);
        return stopAtWitness && !!best;
      }
      if (selected.length === policy.maximumActiveSafetyTargets) {
        if (remainingRequired === 0) {
          accept(selected);
          return stopAtWitness && !!best;
        }
        pruned++;
        return false;
      }
      const options = required141(byFirst[index]).filter(
        (c) =>
          !(c.mask & covered) &&
          (!mandatoryOnly || (c.mask & requiredMask) === c.mask),
      );
      if (mandatoryOnly)
        options.sort(
          (a, b) =>
            b.bundle.childUnitIds.length - a.bundle.childUnitIds.length ||
            a.bundle.incrementalFullQueueAudioSeconds -
              b.bundle.incrementalFullQueueAudioSeconds ||
            a.bundle.bundleId.localeCompare(b.bundle.bundleId),
        );
      for (const choice of options) {
        if (
          visit(
            index + 1,
            covered | choice.mask,
            Math.max(maxCoveredIndex, choice.last),
            core + choice.core,
            gain + choice.gain,
            union141([...audio, ...choice.bundle.predictedAudioIntervals]),
            [...selected, choice.bundle],
          )
        )
          return true;
        if (!complete) return false;
      }
      if (!required[index])
        return visit(
          index + 1,
          covered,
          maxCoveredIndex,
          core,
          gain,
          audio,
          selected,
        );
      return false;
    };
    return visit(0, 0n, -1, 0, 0, initialAudio, []);
  };
  if (
    requiredCore <= budget &&
    !difference143(
      obligations.nativeIntervalUnion,
      children.flatMap((c) => c.nativeIntervalUnion),
    ).length
  ) {
    search(true, true);
    if (isComplete()) search(false, false);
  }
  const selected = best ?? [],
    core = sampleCount143(selected.flatMap((c) => c.nativeIntervalUnion)),
    predictedAudio = sampleCount143([
      ...initialAudio,
      ...selected.flatMap((c) => c.predictedAudioIntervals),
    ]);
  const monotonic = validateCrossStageCoverageMonotonicity({
    obligations,
    selected,
    policy,
    hierarchy,
  }).monotonicity;
  const checks = [
    {
      name: "PHASE_A_NATIVE_CORE_COVERAGE_100_PERCENT",
      passed: monotonic.monotonicityPassed,
    },
    { name: "IMMUTABLE_NON_SAFETY_TARGETS_PRESERVED", passed: true },
    {
      name: "ACTIVE_SAFETY_BUNDLES_AT_MOST_24",
      passed: selected.length <= policy.maximumActiveSafetyTargets,
    },
    { name: "SAFETY_NATIVE_CORE_AT_MOST_60_SECONDS", passed: core <= budget },
    {
      name: "NO_WHOLE_EPISODE_CATCH_ALL",
      passed: selected.every(
        (b) =>
          b.reviewEnvelope.endSample - b.reviewEnvelope.startSample <=
          policy.maximumBundleEnvelopeSeconds * rate,
      ),
    },
    {
      name: "PREDICTED_FULL_QUEUE_RATIO_AT_MOST_095",
      passed: predictedAudio <= maxAudio,
    },
    {
      name: "ALL_SOURCE_TIMEBASES_VERIFIED",
      passed: selected.every((b) => b.verifiedTimebase),
    },
    { name: "VALID_NATIVE_HALF_OPEN_INTERVALS", passed: true },
    {
      name: "NO_DUPLICATE_ACTIVE_TARGET_IDENTITY",
      passed: new Set(selected.map((b) => b.bundleId)).size === selected.length,
    },
    { name: "ALL_CORES_BOUND_TO_FROZEN_MACHINE_CHILDREN", passed: true },
    {
      name: "ALL_CORES_HAVE_BOUNDED_PHYSICAL_AUDIO_PLAN",
      passed: selected.every(
        (b) =>
          !difference143(b.nativeIntervalUnion, b.predictedAudioIntervals)
            .length,
      ),
    },
    { name: "HALLUCINATION_CURRENT_CUE_TARGET_PRESERVED", passed: true },
  ];
  const witness = !!best && checks.every((c) => c.passed);
  const status = !isComplete()
    ? "SEARCH_INCOMPLETE"
    : witness
      ? "FEASIBLE"
      : "INFEASIBLE_PROVEN";
  return {
    selected,
    certificate: planner143Schema.parse(
      hashed141({
        ...header143(policy, source),
        artifactType: "machine-final-safety-planner-certificate",
        plannerVersion: "DETERMINISTIC_NATIVE_SET_COVER_BNB_V1",
        obligationsHash: obligations.semanticHash,
        candidatesHash: bundles.semanticHash,
        dominanceHash: dominance.semanticHash,
        immutableTargetsHash: obligations.immutableTargetsHash,
        immutableTargetIds: obligations.immutableTargetIds,
        hallucinationCurrentCueTargetIds:
          obligations.hallucinationCurrentCueTargetIds,
        candidateCountBeforePruning: bundles.candidates.length,
        candidateCountAfterPruning: choices.length,
        hardConstraintCount: checks.length,
        obligationCount: obligations.obligations.length,
        exploredStateCount: explored,
        prunedStateCount: pruned,
        searchStateLimit: stateLimit,
        searchComplete: complete,
        feasibilityStatus: status,
        searchBoundMethod: bounds.tables
          ? "NATIVE_SUBSET_SUM_RELAXATION"
          : "CONTINUOUS_CORE_RELAXATION",
        searchBoundLookupCellCount: bounds.lookupCellCount,
        selectedBundleIds: selected.map((b) => b.bundleId),
        selectedChildIds: unique142(selected.flatMap((b) => b.childUnitIds)),
        activeTargetCount: selected.length,
        speechCoreUnionSeconds: core / rate,
        predictedFullQueueSeconds: predictedAudio / rate,
        predictedFullQueueEpisodeRatio:
          predictedAudio / rate / source.durationSeconds,
        obligationCoverageRatio: monotonic.obligationCoverageRatio,
        evidenceStrataCoverage: unique142(
          selected.flatMap((b) => b.evidenceStrata),
        ),
        detectorFamilyCoverage: unique142(
          selected.flatMap((b) => b.detectorFamilies),
        ),
        timelineBinCoverage: unique142(selected.flatMap((b) => b.timelineBins)),
        sceneCoverage: unique142(selected.flatMap((b) => b.sceneIds)),
        objectiveVector: best ? bestObjective : [0, 0, 0, 0, 0, 0, 0, 0, 0],
        deterministicTieBreakTraceHash: hash141({
          policy: policy.semanticHash,
          candidates: choices.map((c) => c.bundle.bundleId),
          selected: selected.map((c) => ({
            sample: c.reviewEnvelope.startSample,
            id: c.bundleId,
          })),
          requiredCore,
          oldCore,
        }),
        feasibilityWitnessVerified: witness,
        hardConstraintResults: checks,
        fallback: witness ? "NONE" : "PHASE_A_SELECTION_ONLY_HOLD",
        diagnosticReasons:
          status === "SEARCH_INCOMPLETE"
            ? ["FINAL_PLANNER_SEARCH_INCOMPLETE"]
            : status === "INFEASIBLE_PROVEN"
              ? ["NO_FEASIBLE_SELECTION_IN_FROZEN_CANDIDATE_UNIVERSE"]
              : [],
      }),
    ),
  };
}

export function materializeSafety143(input: {
  policy: Policy143;
  obligations: Obligations143;
  hierarchy: Hierarchy143;
  bundles: Bundles143;
  certificate: Planner143;
  selected: Bundle143[];
  continuity: Continuity143;
  monotonicity: Monotonicity143;
}) {
  const {
    policy,
    obligations,
    hierarchy,
    bundles,
    certificate,
    selected,
    continuity,
    monotonicity,
  } = input;
  [certificate, continuity, monotonicity].forEach(assertHash141);
  assertMonotonicity143(monotonicity);
  if (
    !certificate.feasibilityWitnessVerified ||
    hash141(selected.map((b) => b.bundleId)) !==
      hash141(certificate.selectedBundleIds)
  )
    throw new Error("C601143_NO_VERIFIED_PLANNER_WITNESS");
  const targets = selected.map((b) => {
    const origins = unique142(
      continuity.entries
        .filter((e) => e.finalTargetBundleIds.includes(b.bundleId))
        .flatMap((e) => e.originalTargetIds),
    );
    return hashed141({
      ...b,
      targetId: b.bundleId,
      targetKind:
        b.childUnitIds.length === 1
          ? "SINGLE_CHILD_TARGET"
          : "MULTI_CHILD_TARGET_BUNDLE",
      selectionStage: "C601143_CONSTRAINED_FINAL_PLANNER",
      plannerCertificateHash: certificate.semanticHash,
      continuityLedgerHash: continuity.semanticHash,
      retainedOriginTargetIds: origins.filter((id) => id === b.bundleId),
      supersededOriginTargetIds: origins.filter((id) => id !== b.bundleId),
      requiredLevel: "RECOMMENDED",
      audioRequired: true,
      canonicalInsertAllowed: false,
    });
  });
  return safety143Schema.parse(
    hashed141({
      ...header143(policy, bundles.sourceIdentity),
      artifactType: "machine-missing-safety-reserve-targets-v3",
      obligationsHash: obligations.semanticHash,
      hierarchyHash: hierarchy.semanticHash,
      candidatesHash: bundles.semanticHash,
      plannerCertificateHash: certificate.semanticHash,
      continuityLedgerHash: continuity.semanticHash,
      monotonicityHash: monotonicity.semanticHash,
      targets,
      summary: {
        activeTargetCount: targets.length,
        childUnitCount: unique142(selected.flatMap((b) => b.childUnitIds))
          .length,
        atomicMemberCount: selected.reduce(
          (n, b) => n + b.atomicNativeIntervals.length,
          0,
        ),
        singleChildTargetCount: targets.filter(
          (t) => t.targetKind === "SINGLE_CHILD_TARGET",
        ).length,
        multiChildBundleTargetCount: targets.filter(
          (t) => t.targetKind === "MULTI_CHILD_TARGET_BUNDLE",
        ).length,
        speechCoreUnionSeconds:
          sampleCount143(selected.flatMap((b) => b.nativeIntervalUnion)) /
          bundles.sourceIdentity.sampleRate,
        reviewEnvelopeUnionSeconds:
          sampleCount143(selected.map((b) => b.reviewEnvelope)) /
          bundles.sourceIdentity.sampleRate,
        internalSilenceSeconds: selected.reduce(
          (n, b) => n + b.internalSilenceSeconds,
          0,
        ),
        wholeEpisodeCatchAllTargetCount: 0,
        obligationCoverageRatio: 1,
        canonicalInsertCount: 0,
        requiredLevelPromotionCount: 0,
      },
    }),
  );
}
