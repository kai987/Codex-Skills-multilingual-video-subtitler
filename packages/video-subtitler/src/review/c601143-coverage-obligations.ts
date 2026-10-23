import {
  obligations143Schema,
  transition143Schema,
  type Obligations143,
  type Policy143,
  type Safety142,
  type C601141Safety,
  type C60114ReviewTargets,
  type Inventory142,
  type Samples142,
  type Transition143,
} from "@mvl/shared";
import {
  assertHash141,
  hashed141,
  hash141,
  id141,
  union141,
  seconds141,
} from "./c601141-policy.js";
import { unique142 } from "./c601142-selection.js";
import {
  header143,
  assertSource143,
  assertNative143,
  intersects143,
  sampleCount143,
  difference143,
} from "./c601143-policy.js";

export function buildCoverageObligations143(input: {
  phaseA: Safety142;
  immutableTargets: C60114ReviewTargets;
  policy: Policy143;
}): Obligations143 {
  const { phaseA, immutableTargets, policy } = input;
  [phaseA, immutableTargets].forEach(assertHash141);
  assertSource143(phaseA.sourceIdentity, immutableTargets.sourceIdentity);
  const source = phaseA.sourceIdentity,
    rate = source.sampleRate;
  for (const target of phaseA.targets) {
    assertHash141(target);
    assertNative143(target.atomicNativeIntervals, source);
    if (
      !target.verifiedTimebase ||
      target.strongContradiction ||
      hash141(union141(target.atomicNativeIntervals)) !==
        hash141(target.targetCoreUnion)
    )
      throw new Error("C601143_PHASE_A_CORE_NOT_VERIFIED_ATOMIC_SPEECH");
  }
  const nativeIntervalUnion = union141(
    phaseA.targets.flatMap((t) => t.targetCoreUnion),
  );
  const obligations = nativeIntervalUnion.map((core) => {
    const targets = phaseA.targets.filter((t) =>
      t.targetCoreUnion.some((v) => intersects143(core, v)),
    );
    const atoms = [
      ...new Map(
        targets
          .flatMap((t) => t.atomicNativeIntervals)
          .filter((v) => intersects143(core, v))
          .map((v) => [hash141(v), v]),
      ).values(),
    ].sort(
      (a, b) => a.startSample - b.startSample || a.endSample - b.endSample,
    );
    return hashed141({
      obligationId: id141("phase-a-obligation", { source, core }),
      originStage: "C601142_PHASE_A",
      originTargetIds: unique142(targets.map((t) => t.targetId)),
      originClusterIds: unique142(targets.map((t) => t.clusterId)),
      atomicNativeIntervals: atoms,
      atomicSourceIntervals: atoms.map((v) => seconds141(v, rate)),
      nativeIntervalUnion: [core],
      evidenceIds: unique142(targets.flatMap((t) => t.evidenceIds)),
      detectorFamilies: unique142(targets.flatMap((t) => t.detectorFamilies)),
      evidenceStrata: unique142(targets.flatMap((t) => t.evidenceStrata)),
      timelineBins: unique142(targets.flatMap((t) => t.diversityBins)),
      sourceIdentity: source,
      minimumCoverageRatio: 1,
      equivalentReplacementAllowed: true,
      hardConstraint: true,
    });
  });
  return obligations143Schema.parse(
    hashed141({
      ...header143(policy, source),
      artifactType: "machine-phase-a-coverage-obligations",
      phaseASelectionHash: phaseA.semanticHash,
      phaseATargetCount: phaseA.targets.length,
      obligations,
      nativeIntervalUnion,
      totalNativeSamples: sampleCount143(nativeIntervalUnion),
      totalCoreUnionSeconds: sampleCount143(nativeIntervalUnion) / rate,
      immutableTargetIds: unique142(
        immutableTargets.targets.map((t) => t.reviewTargetId),
      ),
      immutableTargetsHash: immutableTargets.semanticHash,
      hallucinationCurrentCueTargetIds: unique142(
        immutableTargets.targets
          .filter((t) => t.targetType === "CURRENT_CUE_HALLUCINATION_TARGET")
          .map((t) => t.reviewTargetId),
      ),
      semanticCoverageHash: hash141({ source, nativeIntervalUnion }),
    }),
  );
}

export function auditSelectionTransition143(input: {
  baselineSafety: C601141Safety;
  phaseA: Safety142;
  inventory: Inventory142;
  oldFinal: Safety142;
  policy: Policy143;
}): Transition143 {
  const { phaseA, baselineSafety, inventory, oldFinal, policy } = input;
  [baselineSafety, phaseA, inventory, oldFinal].forEach((v) => {
    assertHash141(v);
    assertSource143(v.sourceIdentity, phaseA.sourceIdentity);
  });
  const source = phaseA.sourceIdentity,
    rate = source.sampleRate;
  interface Row {
    targetId: string;
    cores: Samples142[];
  }
  const oldRows: Row[] = baselineSafety.targets.map((t) => ({
    targetId: t.targetId,
    cores: [t.nativeInterval],
  }));
  const phaseRows: Row[] = phaseA.targets.map((t) => ({
    targetId: t.targetId,
    cores: t.targetCoreUnion,
  }));
  const finalRows: Row[] = oldFinal.targets.map((t) => ({
    targetId: t.targetId,
    cores: t.targetCoreUnion,
  }));
  const stage = (
    stageId: Transition143["stages"][number]["stageId"],
    inputHash: string,
    rows: Row[],
    previous: Row[],
    cores: Samples142[],
    strata: Safety142["summary"]["selectedStrata"],
    families: Safety142["targets"][number]["detectorFamilies"],
    bins: number[],
  ) => {
    const union = union141(cores);
    return hashed141({
      stageId,
      inputSelectionHash: inputHash,
      activeTargetIds: rows.map((t) => t.targetId),
      atomicNativeIntervals: cores,
      atomicSourceIntervals: cores.map((v) => seconds141(v, rate)),
      nativeIntervalUnion: union,
      speechCoreUnionSeconds: sampleCount143(union) / rate,
      evidenceStrata: unique142(strata),
      detectorFamilies: unique142(families),
      timelineBins: unique142(bins),
      targetCount: rows.length,
      carriedForwardTargetIds: previous
        .filter((t) => rows.some((r) => r.targetId === t.targetId))
        .map((t) => t.targetId),
      equivalentReplacementTargetIds: previous
        .filter(
          (t) =>
            !rows.some((r) => r.targetId === t.targetId) &&
            !difference143(t.cores, union).length,
        )
        .map((t) => t.targetId),
      droppedTargetIds: previous
        .filter((t) => difference143(t.cores, union).length)
        .map((t) => t.targetId),
      droppedNativeIntervals: difference143(
        previous.flatMap((t) => t.cores),
        union,
      ),
      newCoverageIntervals: difference143(
        union,
        previous.flatMap((t) => t.cores),
      ),
    });
  };
  const phaseCore = phaseRows.flatMap((t) => t.cores),
    finalCore = finalRows.flatMap((t) => t.cores);
  const regression = difference143(phaseCore, finalCore);
  return transition143Schema.parse(
    hashed141({
      ...header143(policy, source),
      artifactType: "machine-cross-stage-selection-transition-audit",
      stages: [
        stage(
          "S0_C601141_ACTIVE",
          baselineSafety.semanticHash,
          oldRows,
          [],
          oldRows.flatMap((t) => t.cores),
          [],
          [],
          [],
        ),
        stage(
          "S1_C601142_PHASE_A",
          phaseA.semanticHash,
          phaseRows,
          oldRows,
          phaseCore,
          phaseA.summary.selectedStrata,
          phaseA.targets.flatMap((t) => t.detectorFamilies),
          phaseA.summary.selectedBins,
        ),
        stage(
          "S2_COMBINED_INVENTORY",
          inventory.semanticHash,
          [],
          phaseRows,
          inventory.observations
            .filter(
              (o) =>
                o.verifiedTimebase &&
                o.speechPositive &&
                !o.strongContradiction,
            )
            .map((o) => o.nativeInterval),
          inventory.islands.map((i) => i.evidenceStratum),
          inventory.observations.map((o) => o.family),
          [],
        ),
        stage(
          "S3_OLD_FINAL",
          oldFinal.semanticHash,
          finalRows,
          phaseRows,
          finalCore,
          oldFinal.summary.selectedStrata,
          oldFinal.targets.flatMap((t) => t.detectorFamilies),
          oldFinal.summary.selectedBins,
        ),
      ],
      phaseARegressedNativeIntervals: regression,
      phaseARegressedNativeSamples: sampleCount143(regression),
      phaseARegressedTargetCount: phaseRows.filter(
        (t) => difference143(t.cores, finalCore).length,
      ).length,
      diagnosis: regression.length
        ? [
            "PHASE_A_COVERAGE_REGRESSION",
            "FINAL_SELECTION_PROTECTED_ONLY_C601141_BASELINE",
            "PARENT_CLUSTER_ATOMIC_SELECTION_BOTTLENECK",
          ]
        : ["NO_NATIVE_COVERAGE_REGRESSION"],
      goldUsedForDetection: false,
    }),
  );
}
