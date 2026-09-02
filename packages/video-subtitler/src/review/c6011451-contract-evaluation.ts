import {
  evaluationComponent1451Schema,
  type C60114ErrorComponent,
  type EffectiveRealizations1451,
  type Evaluation1451,
  type FullRegistry1451,
  type Policy1451,
  type ReviewBinding1451,
  type Route1451,
  type Samples142,
  type WitnessGroups1451,
} from "@mvl/shared";
import { hashed141, required141 } from "./c601141-policy.js";
import { intersection143, sampleCount143 } from "./c601143-policy.js";

type ProductMode =
  | "REGISTRY_ONLY"
  | "BINDING_ONLY"
  | "INHERITED_ONLY"
  | "SINGLE_UNIT_ONLY"
  | "FULL";

interface AllowedDelivery1451 {
  targetIds?: ReadonlySet<string>;
  audioIds?: ReadonlySet<string>;
  playbackSegmentIds?: ReadonlySet<string>;
}

interface EvaluationInput1451 {
  policy: Policy1451;
  component: C60114ErrorComponent;
  registry: FullRegistry1451;
  binding: ReviewBinding1451;
  effective: EffectiveRealizations1451;
  witnesses: WitnessGroups1451;
  mode: ProductMode;
  allowed?: AllowedDelivery1451;
}

interface SecondsInterval {
  start: number;
  end: number;
}

const unique = (values: readonly string[]) =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right));

const unionSeconds = (values: readonly SecondsInterval[]) => {
  const rows = values
      .filter((row) => row.end > row.start)
      .map((row) => ({ ...row }))
      .sort((left, right) => left.start - right.start || left.end - right.end),
    result: SecondsInterval[] = [];
  for (const row of rows) {
    const previous = result.at(-1);
    if (!previous || row.start > previous.end) result.push(row);
    else previous.end = Math.max(previous.end, row.end);
  }
  return result;
};

const seconds = (values: readonly SecondsInterval[]) =>
  unionSeconds(values).reduce((sum, row) => sum + row.end - row.start, 0);

const intersectSeconds = (
  left: readonly SecondsInterval[],
  right: readonly SecondsInterval[],
) =>
  unionSeconds(
    left.flatMap((a) =>
      right.flatMap((b) => {
        const start = Math.max(a.start, b.start),
          end = Math.min(a.end, b.end);
        return end > start ? [{ start, end }] : [];
      }),
    ),
  );

const coverage = (
  covering: readonly SecondsInterval[],
  reference: readonly SecondsInterval[],
) => {
  const denominator = seconds(reference);
  return denominator
    ? Math.min(1, seconds(intersectSeconds(covering, reference)) / denominator)
    : 0;
};

const sampleToSeconds = (interval: Samples142, sampleRate: number) => ({
  start: interval.startSample / sampleRate,
  end: interval.endSample / sampleRate,
});

const sampleOverlap = (left: Samples142[], right: Samples142[]) =>
  sampleCount143(intersection143(left, right));

const allowed = (set: ReadonlySet<string> | undefined, value: string) =>
  set === undefined || set.has(value);

const minimum = (values: readonly number[]) =>
  values.length ? Math.min(...values) : 0;

const subsets = <T>(rows: readonly T[]) => {
  const result: T[][] = [];
  for (let mask = 1; mask < 1 << rows.length; mask++) {
    const selected: T[] = [];
    for (let index = 0; index < rows.length; index++)
      if (mask & (1 << index)) selected.push(required141(rows[index]));
    result.push(selected);
  }
  return result;
};

export function evaluateProductComponent1451(
  input: EvaluationInput1451,
): Evaluation1451["components"][number] {
  const rate = input.registry.sourceIdentity.sampleRate,
    error = input.component.errorIntervals,
    matchingUnits = input.registry.units
      .filter((unit) => coverage(unit.atomicSourceIntervals, error) > 0)
      .sort(
        (left, right) =>
          left.envelopeInterval.startSample -
            right.envelopeInterval.startSample ||
          left.fullCoverageUnitId.localeCompare(right.fullCoverageUnitId),
      ),
    matchingUnitIds = new Set(
      matchingUnits.map((unit) => unit.fullCoverageUnitId),
    ),
    targetBindings = input.binding.targetBindings.filter(
      (row) =>
        row.productBindingEligible &&
        row.fullCoverageUnitId !== null &&
        matchingUnitIds.has(row.fullCoverageUnitId) &&
        allowed(input.allowed?.targetIds, row.targetId),
    ),
    modeRealizations = input.effective.realizations.filter((row) => {
      if (input.mode === "REGISTRY_ONLY" || input.mode === "BINDING_ONLY")
        return false;
      if (
        input.mode === "INHERITED_ONLY" &&
        !row.realizationOrigins.includes(
          "INHERITED_EXISTING_REVIEW_DELIVERY_REALIZATION",
        )
      )
        return false;
      return (
        row.fullCoverageUnitIds.some((id) => matchingUnitIds.has(id)) &&
        row.targetIds.some((id) => allowed(input.allowed?.targetIds, id)) &&
        row.audioIds.some((id) => allowed(input.allowed?.audioIds, id)) &&
        row.playbackSegmentIds.some((id) =>
          allowed(input.allowed?.playbackSegmentIds, id),
        )
      );
    }),
    realizationIds = new Set(
      modeRealizations.map((row) => row.effectiveRealizationId),
    ),
    candidateGroups = input.witnesses.groups.filter((group) => {
      if (!group.witnessEligibility) return false;
      const retained = group.realizationIds.filter((id) =>
        realizationIds.has(id),
      );
      if (!retained.length) return false;
      const units = unique(
        retained.flatMap(
          (id) =>
            required141(
              modeRealizations.find((row) => row.effectiveRealizationId === id),
            ).fullCoverageUnitIds,
        ),
      );
      return (
        units.some((id) => matchingUnitIds.has(id)) &&
        (input.mode !== "SINGLE_UNIT_ONLY" || units.length === 1)
      );
    });

  interface Candidate {
    witnessGroupId: string;
    realizationIds: string[];
    origins: EffectiveRealizations1451["realizations"][number]["realizationOrigins"];
    unitIds: string[];
    targetIds: string[];
    audioIds: string[];
    playbackIds: string[];
    targetBindingIds: string[];
    unitGold: number;
    targetGold: number;
    audioGold: number;
    playbackGold: number;
    anchorOverlapSecondsByUnit: Record<string, number>;
    anchorCoverageByUnit: Record<string, number>;
    playbackCoverageByUnit: Record<string, number>;
    completeGraph: boolean;
    pass: boolean;
    playbackSeconds: number;
    rejectionReasons: string[];
  }

  const candidates: Candidate[] = [];
  for (const group of candidateGroups) {
    const groupRealizations = group.realizationIds
      .filter((id) => realizationIds.has(id))
      .map((id) =>
        required141(
          modeRealizations.find((row) => row.effectiveRealizationId === id),
        ),
      );
    for (const realizationSet of subsets(groupRealizations)) {
      const unitIds = unique(
          realizationSet.flatMap((row) => row.fullCoverageUnitIds),
        ),
        units = unitIds.map((id) =>
          required141(
            input.registry.units.find((row) => row.fullCoverageUnitId === id),
          ),
        );
      if (!unitIds.some((id) => matchingUnitIds.has(id))) continue;
      if (input.mode === "SINGLE_UNIT_ONLY" && unitIds.length !== 1) continue;

      const selectedTargetBindings = input.binding.targetBindings.filter(
          (binding) =>
            binding.productBindingEligible &&
            binding.fullCoverageUnitId !== null &&
            unitIds.includes(binding.fullCoverageUnitId) &&
            allowed(input.allowed?.targetIds, binding.targetId) &&
            realizationSet.some((row) =>
              row.targetIds.includes(binding.targetId),
            ),
        ),
        targetIds = unique(selectedTargetBindings.map((row) => row.targetId)),
        selectedAudioBindings = input.binding.audioBindings.filter(
          (binding) =>
            binding.productBindingEligible &&
            binding.fullCoverageUnitId !== null &&
            unitIds.includes(binding.fullCoverageUnitId) &&
            allowed(input.allowed?.audioIds, binding.audioId) &&
            binding.targetIds.some((id) => targetIds.includes(id)) &&
            realizationSet.some((row) =>
              row.audioIds.includes(binding.audioId),
            ),
        ),
        audioIds = unique(selectedAudioBindings.map((row) => row.audioId)),
        selectedPlaybackBindings = input.binding.playbackBindings.filter(
          (binding) =>
            binding.productBindingEligible &&
            binding.fullCoverageUnitId !== null &&
            unitIds.includes(binding.fullCoverageUnitId) &&
            audioIds.includes(binding.audioId) &&
            allowed(
              input.allowed?.playbackSegmentIds,
              binding.playbackSegmentId,
            ) &&
            binding.targetIds.some((id) => targetIds.includes(id)) &&
            realizationSet.some((row) =>
              row.playbackSegmentIds.includes(binding.playbackSegmentId),
            ),
        ),
        playbackIds = unique(
          selectedPlaybackBindings.map((row) => row.playbackSegmentId),
        ),
        targetIntervals = selectedTargetBindings.flatMap((row) =>
          row.targetCoreIntervals.map((interval) =>
            sampleToSeconds(interval, rate),
          ),
        ),
        audioIntervals = selectedAudioBindings.map((row) =>
          sampleToSeconds(row.actualSourceInterval, rate),
        ),
        playbackIntervals = selectedPlaybackBindings.map((row) =>
          sampleToSeconds(row.playbackSourceInterval, rate),
        ),
        unitIntervals = units.flatMap((row) => row.atomicSourceIntervals),
        anchorOverlapSecondsByUnit: Record<string, number> = {},
        anchorCoverageByUnit: Record<string, number> = {},
        playbackCoverageByUnit: Record<string, number> = {};
      for (const unit of units) {
        const applicableRealizations = realizationSet.filter((row) =>
            row.fullCoverageUnitIds.includes(unit.fullCoverageUnitId),
          ),
          anchorOverlap = Math.max(
            0,
            ...applicableRealizations.map(
              (row) =>
                sampleOverlap(
                  row.atomicAnchorIntervals,
                  unit.atomicNativeIntervals,
                ) / rate,
            ),
          ),
          anchorCoverage = Math.max(
            0,
            ...applicableRealizations.map((row) => {
              const index = row.fullCoverageUnitIds.indexOf(
                unit.fullCoverageUnitId,
              );
              return row.anchorCoverageRatios[index] ?? 0;
            }),
          ),
          unitPlayback = selectedPlaybackBindings
            .filter((row) => row.fullCoverageUnitId === unit.fullCoverageUnitId)
            .map((row) => row.playbackSourceInterval);
        anchorOverlapSecondsByUnit[unit.fullCoverageUnitId] = anchorOverlap;
        anchorCoverageByUnit[unit.fullCoverageUnitId] = anchorCoverage;
        playbackCoverageByUnit[unit.fullCoverageUnitId] =
          sampleOverlap(unitPlayback, unit.atomicNativeIntervals) /
          unit.coreUnionSamples;
      }
      const everyUnitHasTarget = unitIds.every((id) =>
          selectedTargetBindings.some((row) => row.fullCoverageUnitId === id),
        ),
        everyUnitHasAudio = unitIds.every((id) =>
          selectedAudioBindings.some((row) => row.fullCoverageUnitId === id),
        ),
        everyUnitHasPlayback = unitIds.every((id) =>
          selectedPlaybackBindings.some((row) => row.fullCoverageUnitId === id),
        ),
        everyUnitHasRealization = unitIds.every((id) =>
          realizationSet.some((row) => row.fullCoverageUnitIds.includes(id)),
        ),
        completeGraph =
          everyUnitHasTarget &&
          everyUnitHasAudio &&
          everyUnitHasPlayback &&
          everyUnitHasRealization,
        unitGold = coverage(unitIntervals, error),
        targetGold = coverage(targetIntervals, error),
        audioGold = coverage(audioIntervals, error),
        playbackGold = coverage(playbackIntervals, error),
        anchorPassed = unitIds.every(
          (id) =>
            required141(anchorOverlapSecondsByUnit[id]) >=
              input.policy.machineAnchorMinimumOverlapSeconds &&
            required141(anchorCoverageByUnit[id]) >=
              input.policy.machineAnchorMinimumUnitCoverageRatio,
        ),
        playbackUnitPassed = unitIds.every(
          (id) =>
            required141(playbackCoverageByUnit[id]) >=
            input.policy.playbackToUnitCoverageThreshold,
        ),
        pass =
          completeGraph &&
          unitGold >= input.policy.unitToGoldCoverageThreshold &&
          playbackGold >= input.policy.playbackToGoldCoverageThreshold &&
          anchorPassed &&
          playbackUnitPassed,
        rejectionReasons = [
          ...(!everyUnitHasTarget ? ["UNIT_TARGET_CHAIN_INCOMPLETE"] : []),
          ...(!everyUnitHasAudio ? ["UNIT_AUDIO_CHAIN_INCOMPLETE"] : []),
          ...(!everyUnitHasPlayback ? ["UNIT_PLAYBACK_CHAIN_INCOMPLETE"] : []),
          ...(!everyUnitHasRealization
            ? ["UNIT_REALIZATION_CHAIN_INCOMPLETE"]
            : []),
          ...(unitGold < input.policy.unitToGoldCoverageThreshold
            ? ["UNIT_UNION_GOLD_COVERAGE_BELOW_THRESHOLD"]
            : []),
          ...(playbackGold < input.policy.playbackToGoldCoverageThreshold
            ? ["PLAYBACK_UNION_GOLD_COVERAGE_BELOW_THRESHOLD"]
            : []),
          ...(!anchorPassed ? ["PER_UNIT_MACHINE_ANCHOR_FAILED"] : []),
          ...(!playbackUnitPassed ? ["PER_UNIT_PLAYBACK_COVERAGE_FAILED"] : []),
        ];
      candidates.push({
        witnessGroupId: group.witnessGroupId,
        realizationIds: realizationSet
          .map((row) => row.effectiveRealizationId)
          .sort(),
        origins: unique(
          realizationSet.flatMap((row) => row.realizationOrigins),
        ) as Candidate["origins"],
        unitIds,
        targetIds,
        audioIds,
        playbackIds,
        targetBindingIds: unique(
          selectedTargetBindings.map((row) => row.bindingLedgerId),
        ),
        unitGold,
        targetGold,
        audioGold,
        playbackGold,
        anchorOverlapSecondsByUnit,
        anchorCoverageByUnit,
        playbackCoverageByUnit,
        completeGraph,
        pass,
        playbackSeconds: seconds(playbackIntervals),
        rejectionReasons,
      });
    }
  }

  candidates.sort(
    (left, right) =>
      Number(right.pass) - Number(left.pass) ||
      Number(right.completeGraph) - Number(left.completeGraph) ||
      left.unitIds.length - right.unitIds.length ||
      left.realizationIds.length - right.realizationIds.length ||
      left.playbackSeconds - right.playbackSeconds ||
      minimum(Object.values(right.anchorCoverageByUnit)) -
        minimum(Object.values(left.anchorCoverageByUnit)) ||
      `${left.witnessGroupId}:${left.realizationIds.join("|")}`.localeCompare(
        `${right.witnessGroupId}:${right.realizationIds.join("|")}`,
      ),
  );
  const best = candidates[0],
    bestSingle = candidates.find((row) => row.unitIds.length === 1 && row.pass),
    bestMulti = candidates.find((row) => row.unitIds.length > 1 && row.pass),
    anyTargetBinding = targetBindings.length > 0,
    anyEffective = modeRealizations.length > 0,
    anyAudio = input.binding.audioBindings.some(
      (row) =>
        row.productBindingEligible &&
        row.fullCoverageUnitId !== null &&
        matchingUnitIds.has(row.fullCoverageUnitId) &&
        allowed(input.allowed?.audioIds, row.audioId),
    ),
    anyPlayback = input.binding.playbackBindings.some(
      (row) =>
        row.productBindingEligible &&
        row.fullCoverageUnitId !== null &&
        matchingUnitIds.has(row.fullCoverageUnitId) &&
        allowed(input.allowed?.playbackSegmentIds, row.playbackSegmentId),
    );
  let status: Evaluation1451["components"][number]["status"];
  if (!matchingUnits.length) status = "NOT_SCORABLE_NO_REGISTRY_UNIT";
  else if (!anyTargetBinding) status = "NOT_SCORABLE_NO_TARGET_BINDING";
  else if (!anyEffective) status = "NOT_SCORABLE_NO_EFFECTIVE_REALIZATION";
  else if (!anyAudio) status = "NOT_SCORABLE_NO_PHYSICAL_AUDIO";
  else if (!anyPlayback) status = "NOT_SCORABLE_NO_PLAYBACK";
  else if (bestSingle) status = "SCORABLE_SINGLE_UNIT_PASS";
  else if (bestMulti) status = "SCORABLE_MULTI_UNIT_PASS";
  else if (candidates.some((row) => row.completeGraph))
    status = "SCORABLE_FAIL";
  else status = "NOT_SCORABLE_WITNESS_SEARCH_INCOMPLETE";
  const selected =
      status === "SCORABLE_SINGLE_UNIT_PASS"
        ? bestSingle
        : status === "SCORABLE_MULTI_UNIT_PASS"
          ? bestMulti
          : best,
    productPassed = status.endsWith("_PASS"),
    singleStatus = bestSingle
      ? "SCORABLE_SINGLE_UNIT_PASS"
      : candidates.some((row) => row.unitIds.length === 1 && row.completeGraph)
        ? "SCORABLE_FAIL"
        : !matchingUnits.length
          ? "NOT_SCORABLE_NO_REGISTRY_UNIT"
          : !anyTargetBinding
            ? "NOT_SCORABLE_NO_TARGET_BINDING"
            : !anyEffective
              ? "NOT_SCORABLE_NO_EFFECTIVE_REALIZATION"
              : "NOT_SCORABLE_WITNESS_SEARCH_INCOMPLETE",
    multiStatus = bestMulti
      ? "SCORABLE_MULTI_UNIT_PASS"
      : candidates.some((row) => row.unitIds.length > 1 && row.completeGraph)
        ? "SCORABLE_FAIL"
        : status,
    finalDiagnosis = productPassed
      ? selected?.origins.includes(
          "INHERITED_EXISTING_REVIEW_DELIVERY_REALIZATION",
        )
        ? selected.unitIds.length > 1
          ? "SCORABLE_RECOVERED_BY_MULTI_UNIT_WITNESS"
          : "SCORABLE_RECOVERED_BY_INHERITED_REALIZATION"
        : "SCORABLE_RECOVERED_BY_FULL_REGISTRY_BINDING"
      : status === "SCORABLE_FAIL"
        ? "SCORABLE_PRODUCT_CONTRACT_FAIL"
        : status.replace("REGISTRY_UNIT", "FULL_REGISTRY_UNIT"),
    blockingReason = productPassed ? null : status;
  return evaluationComponent1451Schema.parse(
    hashed141({
      componentId: input.component.errorComponentId,
      status,
      matchingFullCoverageUnitIds: matchingUnits.map(
        (row) => row.fullCoverageUnitId,
      ),
      matchingPlanningCoverageUnitIds: unique(
        matchingUnits.flatMap((row) => row.legacyPlanningCoverageUnitIds),
      ),
      targetBindingIds: selected?.targetBindingIds ?? [],
      realizationOrigins: selected?.origins ?? [],
      witnessGroupIds: candidateGroups.map((row) => row.witnessGroupId).sort(),
      witnessGroupId: selected?.witnessGroupId ?? null,
      fullCoverageUnitIds: selected?.unitIds ?? [],
      effectiveRealizationIds: selected?.realizationIds ?? [],
      targetIds: selected?.targetIds ?? [],
      audioIds: selected?.audioIds ?? [],
      playbackSegmentIds: selected?.playbackIds ?? [],
      singleUnitWitnessStatus: singleStatus,
      multiUnitWitnessStatus: multiStatus,
      unitToGoldCoverageRatio:
        selected?.unitGold ??
        coverage(
          matchingUnits.flatMap((row) => row.atomicSourceIntervals),
          error,
        ),
      targetCoreGoldCoverageRatio: selected?.targetGold ?? 0,
      physicalAudioGoldCoverageRatio: selected?.audioGold ?? 0,
      playbackToGoldCoverageRatio: selected?.playbackGold ?? 0,
      minimumUnitAnchorOverlapSeconds: selected
        ? minimum(Object.values(selected.anchorOverlapSecondsByUnit))
        : 0,
      minimumUnitAnchorCoverageRatio: selected
        ? minimum(Object.values(selected.anchorCoverageByUnit))
        : 0,
      minimumPlaybackCoverageOfUnitRatio: selected
        ? minimum(Object.values(selected.playbackCoverageByUnit))
        : 0,
      playbackCoverageByUnit: selected?.playbackCoverageByUnit ?? {},
      anchorCoverageByUnit: selected?.anchorCoverageByUnit ?? {},
      targetCorePassed:
        (selected?.targetGold ?? 0) >= input.policy.unitToGoldCoverageThreshold,
      physicalAudioPassed:
        (selected?.audioGold ?? 0) >=
        input.policy.playbackToGoldCoverageThreshold,
      ordinaryPlaybackAudiblePassed:
        (selected?.playbackGold ?? 0) >=
        input.policy.playbackToGoldCoverageThreshold,
      productContractPassed: productPassed,
      finalBlockingReason: blockingReason,
      finalDiagnosis,
      rejectionReasons: selected?.rejectionReasons ?? [status],
    }),
  );
}

export interface RouteGates1451 {
  integrity: boolean;
  registry: boolean;
  compatibility: boolean;
  requiredTargetBinding: boolean;
  audioPlaybackBinding: boolean;
  plannerRealization: boolean;
  inheritedRealization: boolean;
  witnessGroups: boolean;
  witnessSearch: boolean;
  scorability: boolean;
  finalTargetCoverage: boolean;
  physicalAudioPlayback: boolean;
  safetyBudgets: boolean;
  productQuality: boolean;
}

export function routeFromGates1451(gates: RouteGates1451): Route1451["route"] {
  if (!gates.integrity) return "HOLD_FOR_EVALUATION_INTEGRITY_REPAIR";
  if (!gates.registry || !gates.compatibility)
    return "HOLD_FOR_FULL_SPEECH_UNIT_REGISTRY_REPAIR";
  if (!gates.requiredTargetBinding || !gates.audioPlaybackBinding)
    return "HOLD_FOR_REVIEW_DELIVERY_UNIT_BINDING_REPAIR";
  if (!gates.plannerRealization || !gates.inheritedRealization)
    return "HOLD_FOR_INHERITED_REALIZATION_REPAIR";
  if (!gates.witnessGroups || !gates.witnessSearch)
    return "HOLD_FOR_MULTI_UNIT_PRODUCT_WITNESS_REPAIR";
  if (!gates.scorability) return "HOLD_FOR_CONTRACT_SCORABILITY_REPAIR";
  if (!gates.finalTargetCoverage)
    return "HOLD_FOR_REMAINING_INVENTORY_TO_TARGET_COVERAGE_REPAIR";
  if (!gates.physicalAudioPlayback)
    return "HOLD_FOR_REVIEW_AUDIO_COVERAGE_REPAIR";
  if (!gates.safetyBudgets) return "HOLD_FOR_SAFETY_BUDGET_MODEL_REDESIGN";
  return gates.productQuality
    ? "GO_C6_0_1_15_REGION_RANKER_RECALIBRATION"
    : "HOLD_FOR_REVIEW_AUDIO_COVERAGE_REPAIR";
}
