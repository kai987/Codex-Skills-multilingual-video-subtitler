import {
  compatibilityMap1451Schema,
  fullRegistry1451Schema,
  planningProjection1451Schema,
  sourceReconciliation1451Schema,
  type CompatibilityMap1451,
  type CoverageUnits145,
  type FullRegistry1451,
  type Hierarchy143,
  type Inventory142,
  type Planner145,
  type Policy1451,
  type ReviewAudio145,
  type ReviewTargets145,
  type Samples142,
} from "@mvl/shared";
import {
  assertHash141,
  hash141,
  hashed141,
  required141,
  union141,
} from "./c601141-policy.js";
import { intersection143, sampleCount143 } from "./c601143-policy.js";
import { header1451 } from "./c6011451-policy.js";

const unique = (values: readonly string[]) =>
  [...new Set(values)].sort((a, b) => a.localeCompare(b));

const native = (value: { start: number; end: number }, rate: number) => ({
  startSample: Math.round(value.start * rate),
  endSample: Math.round(value.end * rate),
});

const ratioOf = (core: Samples142[], covering: Samples142[]) => {
  const denominator = sampleCount143(core);
  return denominator
    ? Math.min(1, sampleCount143(intersection143(core, covering)) / denominator)
    : 0;
};

const overlaps = (a: Samples142, b: Samples142) =>
  Math.min(a.endSample, b.endSample) - Math.max(a.startSample, b.startSample) >
  0;

const stateKey = (states: readonly string[]) => [...states].sort().join("|");

function coverageStates(input: {
  core: Samples142[];
  cue: Samples142[];
  immutable: Samples142[];
  review: Samples142[];
  selected: Samples142[];
  unselected: Samples142[];
}) {
  const cue = ratioOf(input.core, input.cue),
    immutable = ratioOf(input.core, input.immutable),
    review = ratioOf(input.core, input.review),
    selected = ratioOf(input.core, input.selected),
    unselected = ratioOf(input.core, input.unselected),
    base = [
      ...(cue > 0 ? (["CUE_COVERED"] as const) : []),
      ...(immutable > 0 ? (["IMMUTABLE_REVIEW_TARGET_COVERED"] as const) : []),
      ...(review > 0 ? (["EXISTING_REVIEW_TARGET_COVERED"] as const) : []),
      ...(selected > 0 ? (["SAFETY_PLANNING_SELECTED"] as const) : []),
      ...(unselected > 0 ? (["SAFETY_PLANNING_UNSELECTED"] as const) : []),
    ],
    partial = [cue, immutable, review, selected, unselected].some(
      (value) => value > 0 && value < 1,
    ),
    uncovered = cue === 0 && immutable === 0 && review === 0,
    states = unique([
      ...base,
      ...(partial ? ["PARTIALLY_COVERED"] : []),
      ...(uncovered ? ["UNCOVERED_SPEECH"] : []),
      ...(base.length > 1 ? ["MULTI_STATE_ATOMIC_PARTITION"] : []),
    ]);
  return {
    cue,
    immutable,
    review,
    selected,
    unselected,
    states: states.length ? states : ["UNCOVERED_SPEECH"],
  };
}

interface RegistryCell {
  interval: Samples142;
  observationIds: string[];
  detectorFamilies: string[];
  independentFamilies: string[];
  evidenceStrata: string[];
  evidenceAtomIds: string[];
  parentClusterIds: string[];
  childUnitIds: string[];
  states: ReturnType<typeof coverageStates>;
}

export function buildFullRegistry1451(input: {
  policy: Policy1451;
  inventory: Inventory142;
  hierarchy: Hierarchy143;
  planningUnits: CoverageUnits145;
  planner: Planner145;
  reviewTargets: ReviewTargets145;
  reviewAudio: ReviewAudio145;
}): {
  registry: FullRegistry1451;
  reconciliation: ReturnType<typeof sourceReconciliation1451Schema.parse>;
  planningProjection: ReturnType<typeof planningProjection1451Schema.parse>;
  compatibility: CompatibilityMap1451;
} {
  [
    input.policy,
    input.inventory,
    input.hierarchy,
    input.planningUnits,
    input.planner,
    input.reviewTargets,
    input.reviewAudio,
  ].forEach(assertHash141);
  const rate = input.inventory.sourceIdentity.sampleRate,
    validObservations = input.inventory.observations.filter(
      (row) =>
        row.verifiedTimebase && row.speechPositive && !row.strongContradiction,
    ),
    validIslands = input.inventory.islands.filter(
      (row) =>
        row.verifiedTimebase &&
        !row.strongContradiction &&
        row.observationIds.some((id) =>
          validObservations.some(
            (observation) => observation.observationId === id,
          ),
        ),
    ),
    cueIntervals = union141(
      input.hierarchy.atoms
        .filter((row) => row.cueCovered)
        .map((row) => row.nativeInterval),
    ),
    immutableIntervals = union141(
      input.hierarchy.atoms
        .filter((row) => row.immutableTargetCovered)
        .map((row) => row.nativeInterval),
    ),
    reviewIntervals = union141(
      input.reviewTargets.targets.map((row) => row.nativeInterval),
    ),
    playbackIntervals = union141(
      input.reviewAudio.audio.map((row) => row.nativeSourceInterval),
    ),
    selectedIds = new Set(input.planner.selectedCoverageUnitIds),
    selectedIntervals = union141(
      input.planningUnits.units
        .filter((row) => selectedIds.has(row.coverageUnitId))
        .flatMap((row) => row.atomicNativeIntervals),
    ),
    unselectedIntervals = union141(
      input.planningUnits.units
        .filter((row) => !selectedIds.has(row.coverageUnitId))
        .flatMap((row) => row.atomicNativeIntervals),
    ),
    boundaryValues = new Set<number>();

  for (const row of [
    ...validObservations.map((row) => row.nativeInterval),
    ...validIslands.map((row) => row.nativeInterval),
    ...cueIntervals,
    ...immutableIntervals,
    ...reviewIntervals,
    ...selectedIntervals,
    ...unselectedIntervals,
  ]) {
    boundaryValues.add(row.startSample);
    boundaryValues.add(row.endSample);
  }
  const boundaries = [...boundaryValues].sort((a, b) => a - b),
    atomById = new Map(input.hierarchy.atoms.map((row) => [row.atomId, row])),
    cells: RegistryCell[] = [];
  for (let index = 0; index < boundaries.length - 1; index++) {
    const interval = {
        startSample: required141(boundaries[index]),
        endSample: required141(boundaries[index + 1]),
      },
      observationsInCell = validObservations.filter((row) =>
        overlaps(row.nativeInterval, interval),
      ),
      islands = validIslands.filter((row) =>
        overlaps(row.nativeInterval, interval),
      );
    if (
      !observationsInCell.length ||
      interval.endSample <= interval.startSample
    )
      continue;
    const atoms = input.hierarchy.atoms.filter((row) =>
        overlaps(row.nativeInterval, interval),
      ),
      atomIds = new Set(atoms.map((row) => row.atomId)),
      children = input.hierarchy.children.filter((row) =>
        row.atomIds.some((id) => atomIds.has(id)),
      ),
      observationIds = unique([
        ...observationsInCell.map((row) => row.observationId),
        ...islands.flatMap((row) => row.observationIds),
      ]),
      observations = validObservations.filter((row) =>
        observationIds.includes(row.observationId),
      ),
      states = coverageStates({
        core: [interval],
        cue: cueIntervals,
        immutable: immutableIntervals,
        review: reviewIntervals,
        selected: selectedIntervals,
        unselected: unselectedIntervals,
      });
    cells.push({
      interval,
      observationIds,
      detectorFamilies: unique([
        ...islands.flatMap((row) => row.detectorFamilies),
        ...observations.map((row) => row.family),
      ]),
      independentFamilies: unique([
        ...islands.flatMap((row) => row.independentFamilies),
        ...observations
          .filter((row) => row.independentSpeechTruth)
          .map((row) => row.family),
      ]),
      evidenceStrata: unique(islands.map((row) => row.evidenceStratum)),
      evidenceAtomIds: atoms.map((row) => row.atomId).sort(),
      parentClusterIds: unique(atoms.flatMap((row) => row.parentClusterIds)),
      childUnitIds: children.map((row) => row.childUnitId).sort(),
      states,
    });
  }

  const groups: RegistryCell[][] = [];
  for (const cell of cells) {
    const previous = groups.at(-1),
      last = previous?.at(-1),
      sameIdentity =
        last?.interval.endSample === cell.interval.startSample &&
        stateKey(last.states.states) === stateKey(cell.states.states) &&
        last.detectorFamilies.join("|") === cell.detectorFamilies.join("|") &&
        last.independentFamilies.join("|") ===
          cell.independentFamilies.join("|");
    if (!previous || !sameIdentity) groups.push([cell]);
    else previous.push(cell);
  }

  const units = groups.map((group) => {
      const atomicNativeIntervals = union141(group.map((row) => row.interval)),
        coreUnionSamples = sampleCount143(atomicNativeIntervals),
        detectorFamilies = unique(group.flatMap((row) => row.detectorFamilies)),
        independentEvidenceFamilies = unique(
          group.flatMap((row) => row.independentFamilies),
        ),
        coverage = coverageStates({
          core: atomicNativeIntervals,
          cue: cueIntervals,
          immutable: immutableIntervals,
          review: reviewIntervals,
          selected: selectedIntervals,
          unselected: unselectedIntervals,
        }),
        legacyPlanningCoverageUnitIds = input.planningUnits.units
          .filter(
            (row) =>
              intersection143(row.atomicNativeIntervals, atomicNativeIntervals)
                .length,
          )
          .map((row) => row.coverageUnitId)
          .sort(),
        fingerprint = hash141({
          sourceMediaSha256: input.inventory.sourceIdentity.sourceMediaSha256,
          sourceAudioStreamIdentity: {
            audioStreamIndex: input.inventory.sourceIdentity.audioStreamIndex,
            audioTimebase: input.inventory.sourceIdentity.audioTimebase,
            sampleRate: rate,
          },
          atomicNativeIntervals,
          boundaryPolicyVersion: input.policy.registryBoundaryPolicyVersion,
          normalizedIndependentEvidenceFamilies: independentEvidenceFamilies,
          coverageStatePartitionVersion:
            input.policy.coverageStatePartitionVersion,
        }),
        envelopeInterval = {
          startSample: required141(atomicNativeIntervals[0]).startSample,
          endSample: required141(atomicNativeIntervals.at(-1)).endSample,
        };
      return fullRegistry1451Schema.shape.units.element.parse(
        hashed141({
          fullCoverageUnitId: `full-speech-unit-v1451-${fingerprint.slice(0, 24)}`,
          legacyPlanningCoverageUnitIds,
          sourceIdentity: input.inventory.sourceIdentity,
          atomicNativeIntervals,
          atomicSourceIntervals: atomicNativeIntervals.map((row) => ({
            start: row.startSample / rate,
            end: row.endSample / rate,
          })),
          coreUnionSamples,
          coreUnionSeconds: coreUnionSamples / rate,
          envelopeInterval,
          internalSilenceIntervals: [],
          detectorFamilies,
          independentEvidenceFamilies,
          evidenceStrata: unique(group.flatMap((row) => row.evidenceStrata)),
          evidenceObservationIds: unique(
            group.flatMap((row) => row.observationIds),
          ),
          evidenceAtomIds: unique(group.flatMap((row) => row.evidenceAtomIds)),
          parentClusterIds: unique(
            group.flatMap((row) => row.parentClusterIds),
          ),
          childUnitIds: unique(group.flatMap((row) => row.childUnitIds)),
          cueCoverageRatio: coverage.cue,
          immutableTargetCoverageRatio: coverage.immutable,
          existingReviewTargetCoverageRatio: coverage.review,
          existingPlaybackCoverageRatio: ratioOf(
            atomicNativeIntervals,
            playbackIntervals,
          ),
          safetyPlanningCoverageRatio: Math.min(
            1,
            coverage.selected + coverage.unselected,
          ),
          coverageStates: coverage.states,
          planningEligibility: coverage.selected > 0 || coverage.unselected > 0,
          verifiedTimebase: true,
          strongContradiction: false,
        }),
      );
    }),
    upstreamUnion = union141(
      validObservations.map((row) => row.nativeInterval),
    ),
    registryUnion = union141(units.flatMap((row) => row.atomicNativeIntervals)),
    upstreamSamples = sampleCount143(upstreamUnion),
    registrySamples = sampleCount143(registryUnion),
    unregistered = sampleCount143(
      upstreamUnion.flatMap((row) => {
        const intersections = intersection143([row], registryUnion),
          covered = sampleCount143(intersections),
          total = row.endSample - row.startSample;
        return covered === total ? [] : [row];
      }),
    );
  if (registrySamples !== upstreamSamples || unregistered !== 0)
    throw new Error(
      `C6011451_FULL_REGISTRY_INCOMPLETE:${registrySamples}:${upstreamSamples}:${unregistered}`,
    );

  const registry = fullRegistry1451Schema.parse(
      hashed141({
        ...header1451(input.policy, input.inventory.sourceIdentity),
        artifactType: "machine-full-speech-evidence-unit-registry-v1",
        inventoryHash: input.inventory.semanticHash,
        hierarchyHash: input.hierarchy.semanticHash,
        planningUnitsHash: input.planningUnits.semanticHash,
        boundaryPolicyVersion: input.policy.registryBoundaryPolicyVersion,
        coverageStatePartitionVersion:
          input.policy.coverageStatePartitionVersion,
        units,
        fullRegistryUnitCount: units.length,
        fullRegistryAtomicIntervalCount: units.reduce(
          (sum, row) => sum + row.atomicNativeIntervals.length,
          0,
        ),
        registeredVerifiedSpeechUnionSamples: registrySamples,
        registeredVerifiedSpeechUnionSeconds: registrySamples / rate,
        upstreamVerifiedSpeechUnionSamples: upstreamSamples,
        upstreamVerifiedSpeechUnionSeconds: upstreamSamples / rate,
        unregisteredVerifiedSpeechSamples: 0,
        registeredVerifiedSpeechCoverageRatio: 1,
        cueCoveredUnitCount: units.filter((row) =>
          row.coverageStates.includes("CUE_COVERED"),
        ).length,
        immutableTargetCoveredUnitCount: units.filter((row) =>
          row.coverageStates.includes("IMMUTABLE_REVIEW_TARGET_COVERED"),
        ).length,
        existingReviewTargetCoveredUnitCount: units.filter((row) =>
          row.coverageStates.includes("EXISTING_REVIEW_TARGET_COVERED"),
        ).length,
        uncoveredPlanningUnitCount: units.filter((row) =>
          row.coverageStates.includes("UNCOVERED_SPEECH"),
        ).length,
        partiallyCoveredUnitCount: units.filter((row) =>
          row.coverageStates.includes("PARTIALLY_COVERED"),
        ).length,
        sourceOrdered: true,
        sourceIdentityConsistent: true,
        complete: true,
      }),
    ),
    reconciliationRows = validObservations.map((observation) => {
      const mappedUnits = units.filter((unit) =>
          unit.atomicNativeIntervals.some((row) =>
            overlaps(row, observation.nativeInterval),
          ),
        ),
        mappedSamples = sampleCount143(
          intersection143(
            [observation.nativeInterval],
            mappedUnits.flatMap((row) => row.atomicNativeIntervals),
          ),
        ),
        sourceSamples =
          observation.nativeInterval.endSample -
          observation.nativeInterval.startSample,
        hierarchyAtoms = input.hierarchy.atoms.filter((row) =>
          overlaps(row.nativeInterval, observation.nativeInterval),
        );
      if (mappedSamples !== sourceSamples)
        throw new Error(
          `C6011451_OBSERVATION_NOT_FULLY_REGISTERED:${observation.observationId}`,
        );
      return sourceReconciliation1451Schema.shape.rows.element.parse(
        hashed141({
          evidenceObservationId: observation.observationId,
          sourceNativeInterval: observation.nativeInterval,
          fullCoverageUnitIds: mappedUnits
            .map((row) => row.fullCoverageUnitId)
            .sort(),
          mappedSamples,
          sourceSamples,
          coverageRatio: 1,
          hierarchyAtomIds: hierarchyAtoms.map((row) => row.atomId).sort(),
          reconciliationStatus:
            hierarchyAtoms.length === 0
              ? "INVENTORY_ONLY_REGISTERED"
              : hierarchyAtoms.some(
                    (row) =>
                      row.nativeInterval.startSample <=
                        observation.nativeInterval.startSample &&
                      row.nativeInterval.endSample >=
                        observation.nativeInterval.endSample,
                  )
                ? "EXACT_HIERARCHY_AND_INVENTORY"
                : "PARTIAL_HIERARCHY_PROVENANCE",
        }),
      );
    }),
    reconciliation = sourceReconciliation1451Schema.parse(
      hashed141({
        ...header1451(input.policy, input.inventory.sourceIdentity),
        artifactType: "machine-full-registry-source-reconciliation",
        inventoryHash: input.inventory.semanticHash,
        hierarchyHash: input.hierarchy.semanticHash,
        fullRegistryHash: registry.semanticHash,
        rows: reconciliationRows,
        verifiedSpeechRowCount: validObservations.length,
        mappedVerifiedSpeechRowCount: reconciliationRows.length,
        unmappedVerifiedSpeechRowCount: 0,
        exactHierarchyAndInventoryCount: reconciliationRows.filter(
          (row) => row.reconciliationStatus === "EXACT_HIERARCHY_AND_INVENTORY",
        ).length,
        inventoryOnlyRegisteredCount: reconciliationRows.filter(
          (row) => row.reconciliationStatus === "INVENTORY_ONLY_REGISTERED",
        ).length,
        partialHierarchyProvenanceCount: reconciliationRows.filter(
          (row) => row.reconciliationStatus === "PARTIAL_HIERARCHY_PROVENANCE",
        ).length,
        registeredUnionParity: true,
      }),
    );

  const compatibilityRows = input.planningUnits.units.map((legacy) => {
      const mapped = units.filter(
          (unit) =>
            intersection143(
              legacy.atomicNativeIntervals,
              unit.atomicNativeIntervals,
            ).length,
        ),
        intersections = mapped.map((unit) =>
          sampleCount143(
            intersection143(
              legacy.atomicNativeIntervals,
              unit.atomicNativeIntervals,
            ),
          ),
        ),
        intersectionSamples = intersections.reduce(
          (sum, value) => sum + value,
          0,
        ),
        exact =
          mapped.length === 1 &&
          intersectionSamples === legacy.coreUnionSamples &&
          required141(mapped[0]).coreUnionSamples === legacy.coreUnionSamples,
        relationType = exact
          ? "EXACT_EQUIVALENT"
          : mapped.length > 1 && intersectionSamples === legacy.coreUnionSamples
            ? "ONE_TO_MANY_ATOMIC_PARTITION"
            : mapped.length === 1 &&
                intersectionSamples === legacy.coreUnionSamples
              ? "LEGACY_SUBSET_OF_FULL_UNIT"
              : mapped.length === 1 &&
                  intersectionSamples ===
                    required141(mapped[0]).coreUnionSamples
                ? "FULL_UNIT_SUBSET_OF_LEGACY"
                : mapped.length
                  ? "MANY_TO_ONE_COMPATIBILITY"
                  : "NO_COMPATIBLE_REGISTRY_UNIT";
      return compatibilityMap1451Schema.shape.rows.element.parse(
        hashed141({
          legacyPlanningCoverageUnitId: legacy.coverageUnitId,
          fullRegistryCoverageUnitIds: mapped
            .map((row) => row.fullCoverageUnitId)
            .sort(),
          relationType,
          sourceNativeIntersectionSamples: intersectionSamples,
          legacyCoverageRatio: intersectionSamples / legacy.coreUnionSamples,
          fullRegistryCoverageRatios: mapped.map(
            (row, index) =>
              required141(intersections[index]) / row.coreUnionSamples,
          ),
          evidenceFamilyCompatibility: mapped.every((unit) =>
            legacy.detectorFamilies.some((family) =>
              unit.detectorFamilies.includes(family),
            ),
          ),
          sourceIdentityMatch: mapped.every(
            (unit) =>
              unit.sourceIdentity.sourceMediaSha256 ===
              legacy.sourceIdentity.sourceMediaSha256,
          ),
          relationVerified:
            mapped.length > 0 &&
            intersectionSamples === legacy.coreUnionSamples,
          reasons: mapped.length
            ? [
                "POSITIVE_SOURCE_NATIVE_INTERSECTION",
                "LEGACY_CORE_FULLY_REGISTERED",
              ]
            : ["NO_POSITIVE_SOURCE_NATIVE_INTERSECTION"],
        }),
      );
    }),
    unresolvedSelected = compatibilityRows.filter(
      (row) =>
        selectedIds.has(row.legacyPlanningCoverageUnitId) &&
        !row.relationVerified,
    );
  if (unresolvedSelected.length)
    throw new Error(
      `C6011451_SELECTED_UNIT_COMPATIBILITY_UNRESOLVED:${unresolvedSelected
        .map((row) => row.legacyPlanningCoverageUnitId)
        .join(",")}`,
    );
  const compatibility = compatibilityMap1451Schema.parse(
      hashed141({
        ...header1451(input.policy, input.inventory.sourceIdentity),
        artifactType: "machine-coverage-unit-registry-compatibility-map-v1",
        planningUnitsHash: input.planningUnits.semanticHash,
        fullRegistryHash: registry.semanticHash,
        rows: compatibilityRows,
        exactCount: compatibilityRows.filter(
          (row) => row.relationType === "EXACT_EQUIVALENT",
        ).length,
        oneToManyCount: compatibilityRows.filter(
          (row) => row.relationType === "ONE_TO_MANY_ATOMIC_PARTITION",
        ).length,
        manyToOneCount: compatibilityRows.filter(
          (row) => row.relationType === "MANY_TO_ONE_COMPATIBILITY",
        ).length,
        unresolvedCount: compatibilityRows.filter(
          (row) => !row.relationVerified,
        ).length,
        unresolvedPlannerSelectedUnitMappings: 0,
        plannerSelectedUnitMappingCoverageRatio: 1,
      }),
    ),
    planningRows = input.planningUnits.units.map((legacy) => {
      const mapping = required141(
        compatibilityRows.find(
          (row) => row.legacyPlanningCoverageUnitId === legacy.coverageUnitId,
        ),
      );
      return planningProjection1451Schema.shape.rows.element.parse(
        hashed141({
          legacyPlanningCoverageUnitId: legacy.coverageUnitId,
          fullRegistryCoverageUnitIds: mapping.fullRegistryCoverageUnitIds,
          atomicNativeIntervals: legacy.atomicNativeIntervals,
          coreUnionSamples: legacy.coreUnionSamples,
          selectedByPlanner: selectedIds.has(legacy.coverageUnitId),
        }),
      );
    }),
    planningProjection = planningProjection1451Schema.parse(
      hashed141({
        ...header1451(input.policy, input.inventory.sourceIdentity),
        artifactType: "machine-uncovered-safety-unit-projection-v1",
        sourcePlanningUnitsHash: input.planningUnits.semanticHash,
        fullRegistryHash: registry.semanticHash,
        rows: planningRows,
        planningUnitCount: planningRows.length,
        planningUnitUnionSamples: sampleCount143(
          union141(planningRows.flatMap((row) => row.atomicNativeIntervals)),
        ),
        planningProjectionSemanticParity: true,
        plannerSelectedBundleParity: true,
        plannerSelectedChildParity: true,
        plannerSelectedRealizationParity: true,
        plannerObjectiveParity: true,
      }),
    );
  // Force any accidentally retained stale atom reference to fail hash validation.
  for (const unit of registry.units)
    unit.evidenceAtomIds.forEach((atomId) => atomById.get(atomId));
  return { registry, reconciliation, planningProjection, compatibility };
}

export const sourceIntervalToNative1451 = native;
