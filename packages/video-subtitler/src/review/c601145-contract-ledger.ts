import {
  contractLedger145Schema,
  type ContractLedger145,
  type CoverageUnits145,
  type Planner145,
  type Policy145,
  type RealizationDominance145,
  type Realizations145,
  type UnitUtility145,
} from "@mvl/shared";
import { hashed141, required141 } from "./c601141-policy.js";
import { header145 } from "./c601145-policy.js";
import { selectedRealizations145 } from "./c601145-unit-aware-planner.js";

export function buildContractLedger145(input: {
  policy: Policy145;
  units: CoverageUnits145;
  unitUtility: UnitUtility145;
  realizations: Realizations145;
  realizationDominance: RealizationDominance145;
  planner: Planner145;
  contractPolicyHash: string;
}): ContractLedger145 {
  const coreSelected = selectedRealizations145({
      selectedBundleIds: input.planner.selectedBundleIds,
      realizations: input.realizations,
      dominance: input.realizationDominance,
      contractType: "TARGET_CORE_LOCALIZATION_CONTRACT_V1",
    }),
    playbackSelected = selectedRealizations145({
      selectedBundleIds: input.planner.selectedBundleIds,
      realizations: input.realizations,
      dominance: input.realizationDominance,
      contractType: "MACHINE_ANCHORED_PLAYBACK_AUDIBILITY_CONTRACT_V1",
    }),
    coreByUnit = new Map(coreSelected.map((row) => [row.coverageUnitId, row])),
    playbackByUnit = new Map(
      playbackSelected.map((row) => [row.coverageUnitId, row]),
    ),
    utilityByUnit = new Map(
      input.unitUtility.rows.map((row) => [row.coverageUnitId, row]),
    ),
    selectedUnitIds = new Set(input.planner.selectedCoverageUnitIds),
    rows = input.units.units.map((unit) => {
      const core = coreByUnit.get(unit.coverageUnitId),
        playback = playbackByUnit.get(unit.coverageUnitId),
        primary = playback ?? core,
        violations = [
          ...(!core ? ["TARGET_CORE_MACHINE_PRECONDITION_NOT_SATISFIED"] : []),
          ...(!playback
            ? ["ANCHORED_PLAYBACK_MACHINE_PRECONDITION_NOT_SATISFIED"]
            : []),
        ];
      return contractLedger145Schema.shape.rows.element.parse(
        hashed141({
          coverageUnitId: unit.coverageUnitId,
          unitTier: required141(utilityByUnit.get(unit.coverageUnitId))
            .speechTier,
          productionSelected: selectedUnitIds.has(unit.coverageUnitId),
          selectedRealizationId: primary?.realizationId ?? null,
          targetCoreContractMachineStatus: core ? "SATISFIED" : "NOT_SATISFIED",
          anchoredPlaybackContractMachineStatus: playback
            ? "SATISFIED"
            : "NOT_SATISFIED",
          targetCoreCoverageOfUnit: core?.targetCoreCoverageOfUnit ?? 0,
          anchorOverlapSeconds: playback
            ? playback.anchorOverlapSamples / unit.sourceIdentity.sampleRate
            : 0,
          anchorCoverageRatio: playback?.anchorCoverageRatio ?? 0,
          predictedPlaybackCoverageOfUnit:
            playback?.predictedPlaybackCoverageOfUnit ?? 0,
          reviewEnvelopeSeconds: playback
            ? (playback.reviewEnvelope.endSample -
                playback.reviewEnvelope.startSample) /
              unit.sourceIdentity.sampleRate
            : 0,
          leftContextSeconds: playback?.leftContextSeconds ?? 0,
          rightContextSeconds: playback?.rightContextSeconds ?? 0,
          contractViolations: violations,
        }),
      );
    });
  return contractLedger145Schema.parse(
    hashed141({
      ...header145(input.policy, input.units.sourceIdentity),
      artifactType: "machine-review-safety-contract-coverage-ledger",
      plannerCertificateHash: input.planner.semanticHash,
      unitUtilityHash: input.unitUtility.semanticHash,
      contractPolicyHash: input.contractPolicyHash,
      realizationCandidatesHash: input.realizations.semanticHash,
      rows,
      selectedUnitCount: selectedUnitIds.size,
      targetCoreSatisfiedUnitCount: rows.filter(
        (row) => row.targetCoreContractMachineStatus === "SATISFIED",
      ).length,
      anchoredPlaybackSatisfiedUnitCount: rows.filter(
        (row) => row.anchoredPlaybackContractMachineStatus === "SATISFIED",
      ).length,
      productMachinePreconditionsPassed:
        input.planner.selectedCoverageUnitIds.every(
          (unitId) =>
            rows.find((row) => row.coverageUnitId === unitId)
              ?.anchoredPlaybackContractMachineStatus === "SATISFIED",
        ),
    }),
  );
}
