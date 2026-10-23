/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Runtime cross-artifact completeness checks remain intentional after independent schema parsing. */
import {
  determinacyPolicy1452Schema,
  determinacyPreflight1452Schema,
  evaluationComponent1452Schema,
  type C60114ErrorComponent,
  type DegenerateEligibility1452,
  type DeterminacyPreflight1452,
  type EffectiveRealizations1452,
  type EvaluationComponent1452,
  type FullRegistry1451,
  type InheritedRealizations1451,
  type InheritedRealizations1452,
  type Policy1452,
  type RealizationCandidateLedger1452,
  type ReviewAudio1452,
  type ReviewBinding1451,
  type ReviewPlayback1452,
  type Samples142,
  type SourceReconciliation1451,
  type WitnessGroups1452,
} from "@mvl/shared";
import { hashed141, required141 } from "./c601141-policy.js";
import { intersection143, sampleCount143 } from "./c601143-policy.js";
import { header1452 } from "./c6011452-policy.js";

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

const sampleToSeconds = (row: Samples142, rate: number) => ({
  start: row.startSample / rate,
  end: row.endSample / rate,
});

export function buildDeterminacyPolicy1452(input: {
  policy: Policy1452;
  registry: FullRegistry1451;
}) {
  return determinacyPolicy1452Schema.parse(
    hashed141({
      ...header1452(input.policy, input.registry.sourceIdentity),
      artifactType: "machine-product-outcome-determinacy-policy-v1",
      passOutcome: "SCORABLE_PASS_PRODUCT_CONTRACT",
      determinateFailOutcomes: [
        "SCORABLE_FAIL_INVENTORY_ABSENT",
        "SCORABLE_FAIL_TARGET_ABSENT",
        "SCORABLE_FAIL_REALIZATION_ABSENT",
        "SCORABLE_FAIL_AUDIO_ABSENT",
        "SCORABLE_FAIL_PLAYBACK_ABSENT",
        "SCORABLE_FAIL_CONTRACT_THRESHOLD",
      ],
      infrastructureIncompleteOutcomes: [
        "NOT_SCORABLE_REGISTRY_RECONCILIATION_INCOMPLETE",
        "NOT_SCORABLE_TARGET_BINDING_ENUMERATION_INCOMPLETE",
        "NOT_SCORABLE_REALIZATION_ENUMERATION_INCOMPLETE",
        "NOT_SCORABLE_WITNESS_GROUP_BUILD_INCOMPLETE",
        "NOT_SCORABLE_WITNESS_SEARCH_INCOMPLETE",
        "NOT_SCORABLE_SOURCE_IDENTITY_UNRESOLVED",
        "NOT_SCORABLE_AMBIGUOUS_MACHINE_MAPPING",
        "NOT_SCORABLE_REQUIRED_ARTIFACT_MISSING",
      ],
      integrityOutcome: "INTEGRITY_FAILED",
      completeGraphAbsenceIsScorableFail: true,
      formalRecallIncludesDeterminateFailures: true,
      formalRecallNullOnlyForIndeterminateOrIntegrity: true,
    }),
  );
}

export function buildDeterminacyPreflight1452(input: {
  policy: Policy1452;
  registry: FullRegistry1451;
  reconciliation: SourceReconciliation1451;
  binding: ReviewBinding1451;
  eligibility: DegenerateEligibility1452;
  candidates: RealizationCandidateLedger1452;
  effective: EffectiveRealizations1452;
  witnesses: WitnessGroups1452;
  audio: ReviewAudio1452;
  playback: ReviewPlayback1452;
  determinacyPolicyHash: string;
}): DeterminacyPreflight1452 {
  const flags: DeterminacyPreflight1452["globalCompletenessFlags"] = {
      fullRegistryComplete:
        input.registry.complete &&
        input.registry.unregisteredVerifiedSpeechSamples === 0,
      sourceReconciliationComplete:
        input.reconciliation.unmappedVerifiedSpeechRowCount === 0 &&
        input.reconciliation.registeredUnionParity,
      targetBindingEnumerationComplete:
        input.binding.targetCount > 0 &&
        input.binding.productEligibleTargetUnitZeroOverlapCount === 0 &&
        input.eligibility.requiredTargetUnboundCountAfter === 0,
      audioBindingEnumerationComplete:
        input.binding.productEligibleAudioUnitZeroOverlapCount === 0,
      playbackBindingEnumerationComplete:
        input.binding.productEligiblePlaybackUnitZeroOverlapCount === 0,
      inheritedCandidateEnumerationComplete:
        input.candidates.enumerationComplete,
      inheritedCandidateSearchComplete: input.candidates.searchComplete,
      effectiveRealizationRegistryComplete: input.effective.complete,
      witnessGroupBuildComplete: input.witnesses.witnessGroupBuildComplete,
      witnessSearchComplete: input.witnesses.witnessSearchComplete,
      physicalManifestComplete:
        input.audio.audio.length > 0 &&
        input.audio.audio.every(
          (row) =>
            row.playable && row.hashVerified && row.physicalMetadataVerified,
        ),
      playbackManifestComplete:
        input.playback.segments.length > 0 &&
        input.playback.segments.every(
          (row) => row.sourceInterval.end > row.sourceInterval.start,
        ),
      nestedIntegrityComplete: true,
    },
    componentPrerequisiteMatrix = Object.entries(flags).map(
      ([prerequisite, complete]) => ({ prerequisite, complete }),
    );
  if (componentPrerequisiteMatrix.some((row) => !row.complete))
    throw new Error(
      `C6011452_DETERMINACY_PREFLIGHT_INCOMPLETE:${componentPrerequisiteMatrix
        .filter((row) => !row.complete)
        .map((row) => row.prerequisite)
        .join("|")}`,
    );
  return determinacyPreflight1452Schema.parse(
    hashed141({
      ...header1452(input.policy, input.registry.sourceIdentity),
      artifactType: "machine-product-outcome-determinacy-preflight",
      determinacyPolicyHash: input.determinacyPolicyHash,
      globalCompletenessFlags: flags,
      componentPrerequisiteMatrix,
      determinateComponentCountBeforeGold: 0,
      indeterminateComponentCountBeforeGold: 0,
      indeterminateReasons: [],
      integrityFailureCount: 0,
      formalRecallEligibleAfterGoldMapping: true,
      passed: true,
    }),
  );
}

interface AllowedDelivery1452 {
  targetIds?: ReadonlySet<string>;
  audioIds?: ReadonlySet<string>;
  playbackSegmentIds?: ReadonlySet<string>;
}

const allowed = (set: ReadonlySet<string> | undefined, value: string) =>
  set === undefined || set.has(value);

interface ProductCandidate1452 {
  witnessGroupId: string;
  realizationIds: string[];
  unitIds: string[];
  targetBindingIds: string[];
  targetIds: string[];
  audioIds: string[];
  playbackIds: string[];
  physicalAudioContainerIntervals: Samples142[];
  playbackEnvelopes: Samples142[];
  unitGold: number;
  targetGold: number;
  audioGold: number;
  playbackGold: number;
  anchorCoverage: Record<string, number>;
  playbackCoverage: Record<string, number>;
  pass: boolean;
  completeGraph: boolean;
  rejectionReasons: string[];
}

export function evaluateProductComponent1452(input: {
  policy: Policy1452;
  component: C60114ErrorComponent;
  registry: FullRegistry1451;
  binding: ReviewBinding1451;
  eligibility: DegenerateEligibility1452;
  v1Inherited: InheritedRealizations1451;
  v2Inherited: InheritedRealizations1452;
  effective: EffectiveRealizations1452;
  witnesses: WitnessGroups1452;
  preflight: DeterminacyPreflight1452;
  allowed?: AllowedDelivery1452;
}): EvaluationComponent1452 {
  const flags = input.preflight.globalCompletenessFlags,
    firstIncomplete = Object.entries(flags).find(([, complete]) => !complete),
    infrastructureOutcome = !flags.sourceReconciliationComplete
      ? "NOT_SCORABLE_REGISTRY_RECONCILIATION_INCOMPLETE"
      : !flags.targetBindingEnumerationComplete
        ? "NOT_SCORABLE_TARGET_BINDING_ENUMERATION_INCOMPLETE"
        : !flags.inheritedCandidateEnumerationComplete ||
            !flags.inheritedCandidateSearchComplete ||
            !flags.effectiveRealizationRegistryComplete
          ? "NOT_SCORABLE_REALIZATION_ENUMERATION_INCOMPLETE"
          : !flags.witnessGroupBuildComplete
            ? "NOT_SCORABLE_WITNESS_GROUP_BUILD_INCOMPLETE"
            : !flags.witnessSearchComplete
              ? "NOT_SCORABLE_WITNESS_SEARCH_INCOMPLETE"
              : firstIncomplete
                ? "NOT_SCORABLE_REQUIRED_ARTIFACT_MISSING"
                : null,
    rate = input.registry.sourceIdentity.sampleRate,
    error = input.component.errorIntervals,
    matchingUnits = input.registry.units.filter(
      (unit) => coverage(unit.atomicSourceIntervals, error) > 0,
    ),
    matchingUnitIds = new Set(
      matchingUnits.map((unit) => unit.fullCoverageUnitId),
    ),
    inventoryCoverage = coverage(
      matchingUnits.flatMap((unit) => unit.atomicSourceIntervals),
      error,
    ),
    excludedTargets = new Set(
      input.eligibility.rows
        .filter((row) => !row.finalProductEligibility)
        .map((row) => row.targetId),
    ),
    targetBindings = input.binding.targetBindings.filter(
      (row) =>
        row.productBindingEligible &&
        row.fullCoverageUnitId !== null &&
        matchingUnitIds.has(row.fullCoverageUnitId) &&
        !excludedTargets.has(row.targetId) &&
        allowed(input.allowed?.targetIds, row.targetId),
    ),
    targetIds = new Set(targetBindings.map((row) => row.targetId)),
    effective = input.effective.realizations.filter(
      (row) =>
        row.fullCoverageUnitIds.some((id) => matchingUnitIds.has(id)) &&
        row.targetIds.some(
          (id) => targetIds.has(id) && allowed(input.allowed?.targetIds, id),
        ) &&
        row.audioIds.some((id) => allowed(input.allowed?.audioIds, id)) &&
        row.playbackSegmentIds.some((id) =>
          allowed(input.allowed?.playbackSegmentIds, id),
        ),
    ),
    effectiveIds = new Set(effective.map((row) => row.effectiveRealizationId)),
    groups = input.witnesses.groups.filter((group) =>
      group.realizationIds.some((id) => effectiveIds.has(id)),
    ),
    candidates: ProductCandidate1452[] = [];
  for (const group of groups) {
    const realizations = group.realizationIds.flatMap((id) => {
        const row = effective.find(
          (entry) => entry.effectiveRealizationId === id,
        );
        return row ? [row] : [];
      }),
      unitIds = unique(realizations.flatMap((row) => row.fullCoverageUnitIds)),
      units = unitIds.map((id) =>
        required141(
          input.registry.units.find((unit) => unit.fullCoverageUnitId === id),
        ),
      ),
      selectedBindings = input.binding.targetBindings.filter(
        (binding) =>
          binding.productBindingEligible &&
          binding.fullCoverageUnitId !== null &&
          unitIds.includes(binding.fullCoverageUnitId) &&
          !excludedTargets.has(binding.targetId) &&
          realizations.some((row) =>
            row.targetIds.includes(binding.targetId),
          ) &&
          allowed(input.allowed?.targetIds, binding.targetId),
      ),
      selectedTargetIds = unique(selectedBindings.map((row) => row.targetId)),
      audioIds = unique(
        realizations.flatMap((row) =>
          row.audioIds.filter((id) => allowed(input.allowed?.audioIds, id)),
        ),
      ),
      playbackIds = unique(
        realizations.flatMap((row) =>
          row.playbackSegmentIds.filter((id) =>
            allowed(input.allowed?.playbackSegmentIds, id),
          ),
        ),
      ),
      physicalIntervals = realizations.flatMap(
        (row) => row.physicalAudioContainerIntervals,
      ),
      playbackIntervals = realizations.flatMap(
        (row) => row.playbackIntervalUnion,
      ),
      targetIntervals = selectedBindings.flatMap((row) =>
        row.targetCoreIntervals.map((interval) =>
          sampleToSeconds(interval, rate),
        ),
      ),
      unitIntervals = units.flatMap((unit) => unit.atomicSourceIntervals),
      anchorCoverage: Record<string, number> = {},
      playbackCoverage: Record<string, number> = {};
    for (const unitId of unitIds) {
      anchorCoverage[unitId] = Math.max(
        0,
        ...realizations.map((row) => row.anchorCoverageByUnit[unitId] ?? 0),
      );
      playbackCoverage[unitId] = Math.max(
        0,
        ...realizations.map((row) => row.playbackCoverageByUnit[unitId] ?? 0),
      );
    }
    const everyUnitHasTarget = unitIds.every((id) =>
        selectedBindings.some((binding) => binding.fullCoverageUnitId === id),
      ),
      everyUnitHasRealization = unitIds.every((id) =>
        realizations.some((row) => row.fullCoverageUnitIds.includes(id)),
      ),
      everyUnitHasAudio = unitIds.every((id) =>
        realizations.some(
          (row) =>
            row.fullCoverageUnitIds.includes(id) && row.audioIds.length > 0,
        ),
      ),
      everyUnitHasPlayback = unitIds.every((id) =>
        realizations.some(
          (row) =>
            row.fullCoverageUnitIds.includes(id) &&
            row.playbackSegmentIds.some((segmentId) =>
              playbackIds.includes(segmentId),
            ),
        ),
      ),
      completeGraph =
        everyUnitHasTarget &&
        everyUnitHasRealization &&
        everyUnitHasAudio &&
        everyUnitHasPlayback,
      unitGold = coverage(unitIntervals, error),
      targetGold = coverage(targetIntervals, error),
      audioGold = coverage(
        physicalIntervals.map((row) => sampleToSeconds(row, rate)),
        error,
      ),
      playbackGold = coverage(
        playbackIntervals.map((row) => sampleToSeconds(row, rate)),
        error,
      ),
      anchorPassed = unitIds.every(
        (id) =>
          required141(anchorCoverage[id]) >=
          input.policy.machineAnchorMinimumUnitCoverageRatio,
      ),
      anchorSecondsPassed = unitIds.every((id) => {
        const unit = required141(
          input.registry.units.find((row) => row.fullCoverageUnitId === id),
        );
        return (
          sampleCount143(
            intersection143(
              realizations.flatMap((row) => row.machineAnchorIntervals),
              unit.atomicNativeIntervals,
            ),
          ) /
            rate >=
          input.policy.machineAnchorMinimumOverlapSeconds
        );
      }),
      playbackUnitPassed = unitIds.every(
        (id) =>
          required141(playbackCoverage[id]) >=
          input.policy.playbackToUnitCoverageThreshold,
      ),
      pass =
        completeGraph &&
        unitGold >= input.policy.unitToGoldCoverageThreshold &&
        playbackGold >= input.policy.playbackToGoldCoverageThreshold &&
        anchorPassed &&
        anchorSecondsPassed &&
        playbackUnitPassed;
    candidates.push({
      witnessGroupId: group.witnessGroupId,
      realizationIds: realizations.map((row) => row.effectiveRealizationId),
      unitIds,
      targetBindingIds: selectedBindings.map((row) => row.bindingLedgerId),
      targetIds: selectedTargetIds,
      audioIds,
      playbackIds,
      physicalAudioContainerIntervals: physicalIntervals,
      playbackEnvelopes: realizations.map((row) => row.reviewPlaybackEnvelope),
      unitGold,
      targetGold,
      audioGold,
      playbackGold,
      anchorCoverage,
      playbackCoverage,
      pass,
      completeGraph,
      rejectionReasons: [
        ...(!everyUnitHasTarget ? ["UNIT_TARGET_CHAIN_INCOMPLETE"] : []),
        ...(!everyUnitHasRealization
          ? ["UNIT_REALIZATION_CHAIN_INCOMPLETE"]
          : []),
        ...(!everyUnitHasAudio ? ["UNIT_AUDIO_CHAIN_INCOMPLETE"] : []),
        ...(!everyUnitHasPlayback ? ["UNIT_PLAYBACK_CHAIN_INCOMPLETE"] : []),
        ...(unitGold < input.policy.unitToGoldCoverageThreshold
          ? ["UNIT_UNION_GOLD_COVERAGE_BELOW_THRESHOLD"]
          : []),
        ...(playbackGold < input.policy.playbackToGoldCoverageThreshold
          ? ["PLAYBACK_UNION_GOLD_COVERAGE_BELOW_THRESHOLD"]
          : []),
        ...(!anchorPassed ? ["PER_UNIT_MACHINE_ANCHOR_FAILED"] : []),
        ...(!anchorSecondsPassed
          ? ["PER_UNIT_MACHINE_ANCHOR_SECONDS_FAILED"]
          : []),
        ...(!playbackUnitPassed ? ["PER_UNIT_PLAYBACK_COVERAGE_FAILED"] : []),
      ],
    });
  }
  candidates.sort(
    (left, right) =>
      Number(right.pass) - Number(left.pass) ||
      Number(right.completeGraph) - Number(left.completeGraph) ||
      left.unitIds.length - right.unitIds.length ||
      left.realizationIds.length - right.realizationIds.length ||
      right.playbackGold - left.playbackGold ||
      left.witnessGroupId.localeCompare(right.witnessGroupId),
  );
  const selected = candidates[0],
    anyAudio = effective.some((row) => row.audioIds.length > 0),
    anyPlayback = effective.some((row) =>
      row.playbackSegmentIds.some((id) =>
        allowed(input.allowed?.playbackSegmentIds, id),
      ),
    ),
    outcome =
      infrastructureOutcome ??
      (inventoryCoverage < input.policy.unitToGoldCoverageThreshold
        ? "SCORABLE_FAIL_INVENTORY_ABSENT"
        : !targetBindings.length
          ? "SCORABLE_FAIL_TARGET_ABSENT"
          : !effective.length
            ? "SCORABLE_FAIL_REALIZATION_ABSENT"
            : !anyAudio
              ? "SCORABLE_FAIL_AUDIO_ABSENT"
              : !anyPlayback
                ? "SCORABLE_FAIL_PLAYBACK_ABSENT"
                : candidates.some((row) => row.pass)
                  ? "SCORABLE_PASS_PRODUCT_CONTRACT"
                  : "SCORABLE_FAIL_CONTRACT_THRESHOLD"),
    scorabilityStatus = outcome.startsWith("NOT_SCORABLE_")
      ? "NOT_SCORABLE"
      : "SCORABLE",
    outcomeDeterminacyStatus =
      scorabilityStatus === "SCORABLE" ? "DETERMINATE" : "INDETERMINATE",
    productContractPassed = outcome === "SCORABLE_PASS_PRODUCT_CONTRACT",
    v1Ids = input.v1Inherited.realizations
      .filter((row) =>
        row.fullCoverageUnitIds.some((id) => matchingUnitIds.has(id)),
      )
      .map((row) => row.realizationId),
    v2Ids = input.v2Inherited.realizations
      .filter((row) =>
        row.fullCoverageUnitIds.some((id) => matchingUnitIds.has(id)),
      )
      .map((row) => row.realizationId);
  return evaluationComponent1452Schema.parse(
    hashed141({
      componentId: input.component.errorComponentId,
      matchingFullCoverageUnitIds: [...matchingUnitIds].sort(),
      targetBindingIds:
        selected?.targetBindingIds ??
        targetBindings.map((row) => row.bindingLedgerId),
      targetEligibilityStatuses: unique(
        targetBindings.map((row) =>
          excludedTargets.has(row.targetId) ? "AUDIT_ONLY" : "PRODUCT_ELIGIBLE",
        ),
      ),
      inheritedRealizationV1Ids: v1Ids,
      inheritedRealizationV2Ids: v2Ids,
      effectiveRealizationIds: effective.map(
        (row) => row.effectiveRealizationId,
      ),
      witnessGroupIds: groups.map((row) => row.witnessGroupId),
      selectedWitnessRealizationIds: selected?.realizationIds ?? [],
      selectedPlaybackSegmentIds: selected?.playbackIds ?? [],
      physicalAudioContainerIntervals:
        selected?.physicalAudioContainerIntervals ?? [],
      reviewPlaybackEnvelopes: selected?.playbackEnvelopes ?? [],
      machineAnchorCoverage: selected?.anchorCoverage ?? {},
      unitPlaybackCoverage: selected?.playbackCoverage ?? {},
      unitToGoldCoverageRatio: selected?.unitGold ?? inventoryCoverage,
      targetCoreGoldCoverageRatio:
        selected?.targetGold ??
        coverage(
          targetBindings.flatMap((row) =>
            row.targetCoreIntervals.map((interval) =>
              sampleToSeconds(interval, rate),
            ),
          ),
          error,
        ),
      physicalAudioGoldCoverageRatio: selected?.audioGold ?? 0,
      goldPlaybackCoverage: selected?.playbackGold ?? 0,
      globalCompletenessPrerequisites: flags,
      outcomeDeterminacyStatus,
      scorabilityStatus,
      productContractStatus: outcome,
      productContractPassed,
      finalBlockingReason: productContractPassed ? null : outcome,
      finalDiagnosis: productContractPassed
        ? selected && selected.unitIds.length > 1
          ? "SCORABLE_RECOVERED_BY_MULTI_UNIT_WITNESS_V2"
          : v2Ids.length
            ? "SCORABLE_RECOVERED_BY_PLAYBACK_SCOPED_INHERITED_REALIZATION_V2"
            : "SCORABLE_RECOVERED_BY_PLANNER_REALIZATION"
        : outcome,
      rejectionReasons: selected?.rejectionReasons ?? [outcome],
    }),
  );
}

export const productRecall1452 = (rows: readonly EvaluationComponent1452[]) => {
  const indeterminate = rows.some(
      (row) => row.scorabilityStatus !== "SCORABLE",
    ),
    scorable = rows.filter((row) => row.scorabilityStatus === "SCORABLE"),
    pass = scorable.filter((row) => row.productContractPassed).length,
    measured = scorable.length
      ? {
          numerator: pass,
          denominator: scorable.length,
          ratio: pass / scorable.length,
        }
      : null,
    formal = indeterminate
      ? null
      : {
          numerator: pass,
          denominator: rows.length,
          ratio: rows.length ? pass / rows.length : 1,
        };
  return { formal, measured };
};

export interface RouteGates1452 {
  integrity: boolean;
  degenerateEligibility: boolean;
  remainingRequiredTargetBinding: boolean;
  candidateEnumeration: boolean;
  inheritedPlaybackRealization: boolean;
  effectiveRealizationRegistry: boolean;
  witnessGroupConnectivity: boolean;
  witnessSearch: boolean;
  productOutcomeDeterminacy: boolean;
  finalInventoryTargetCoverage: boolean;
  physicalAudioPlaybackCoverage: boolean;
  safetyBudgets: boolean;
  productQuality: boolean;
}

export function routeFromGates1452(gates: RouteGates1452) {
  if (!gates.integrity) return "HOLD_FOR_EVALUATION_INTEGRITY_REPAIR" as const;
  if (!gates.degenerateEligibility)
    return "HOLD_FOR_DEGENERATE_ORPHAN_ELIGIBILITY_REPAIR" as const;
  if (!gates.remainingRequiredTargetBinding)
    return "HOLD_FOR_DEGENERATE_ORPHAN_ELIGIBILITY_REPAIR" as const;
  if (!gates.candidateEnumeration)
    return "HOLD_FOR_REALIZATION_CANDIDATE_ENUMERATION_REPAIR" as const;
  if (!gates.inheritedPlaybackRealization)
    return "HOLD_FOR_INHERITED_PLAYBACK_REALIZATION_REPAIR" as const;
  if (!gates.effectiveRealizationRegistry || !gates.witnessGroupConnectivity)
    return "HOLD_FOR_MULTI_UNIT_PRODUCT_WITNESS_REPAIR" as const;
  if (!gates.witnessSearch)
    return "HOLD_FOR_MULTI_UNIT_PRODUCT_WITNESS_REPAIR" as const;
  if (!gates.productOutcomeDeterminacy)
    return "HOLD_FOR_CONTRACT_SCORABILITY_REPAIR" as const;
  if (!gates.finalInventoryTargetCoverage)
    return "HOLD_FOR_REMAINING_INVENTORY_TO_TARGET_COVERAGE_REPAIR" as const;
  if (!gates.physicalAudioPlaybackCoverage)
    return "HOLD_FOR_REVIEW_AUDIO_COVERAGE_REPAIR" as const;
  if (!gates.safetyBudgets)
    return "HOLD_FOR_SAFETY_BUDGET_MODEL_REDESIGN" as const;
  return gates.productQuality
    ? ("GO_C6_0_1_15_REGION_RANKER_RECALIBRATION" as const)
    : ("HOLD_FOR_REVIEW_AUDIO_COVERAGE_REPAIR" as const);
}
