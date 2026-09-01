import {
  realizationDominance145Schema,
  realizations145Schema,
  type Bundle143,
  type Bundles143,
  type Contract145,
  type ContractPolicy145,
  type CoverageUnit145,
  type CoverageUnits145,
  type Dominance143,
  type Policy145,
  type Realization145,
  type RealizationDominance145,
  type Realizations145,
} from "@mvl/shared";
import {
  assertHash141,
  hash141,
  hashed141,
  required141,
  union141,
} from "./c601141-policy.js";
import { unique142 } from "./c601142-selection.js";
import { intersection143, sampleCount143 } from "./c601143-policy.js";
import { header145 } from "./c601145-policy.js";

const sortedUnique145 = (values: readonly string[]) =>
  unique142(values).sort((a, b) => a.localeCompare(b));

const overlapSamples145 = (
  left: CoverageUnit145["atomicNativeIntervals"],
  right: CoverageUnit145["atomicNativeIntervals"],
) => sampleCount143(intersection143(left, right));

function realizationRow145(input: {
  policy: Policy145;
  unit: CoverageUnit145;
  contractType: Contract145;
  bundles: Bundle143[];
}): Realization145 {
  const { policy, unit } = input,
    rate = unit.sourceIdentity.sampleRate,
    bundleIds = input.bundles.map((bundle) => bundle.bundleId).sort(),
    childUnitIds = sortedUnique145(
      input.bundles.flatMap((bundle) => bundle.childUnitIds),
    ),
    targetCore = union141(
      input.bundles.flatMap((bundle) => bundle.nativeIntervalUnion),
    ),
    audio = union141(
      input.bundles.flatMap((bundle) => bundle.predictedAudioIntervals),
    ),
    reviewEnvelope = {
      startSample: Math.min(
        ...input.bundles.map((bundle) => bundle.reviewEnvelope.startSample),
      ),
      endSample: Math.max(
        ...input.bundles.map((bundle) => bundle.reviewEnvelope.endSample),
      ),
    },
    anchorOverlapSamples = overlapSamples145(
      unit.atomicNativeIntervals,
      targetCore,
    ),
    targetCoreCoverageOfUnit = anchorOverlapSamples / unit.coreUnionSamples,
    playbackSamples = overlapSamples145(unit.atomicNativeIntervals, audio),
    predictedPlaybackCoverageOfUnit = playbackSamples / unit.coreUnionSamples,
    envelopeSeconds =
      (reviewEnvelope.endSample - reviewEnvelope.startSample) / rate,
    leftContextSeconds = Math.max(
      0,
      (unit.envelopeInterval.startSample - reviewEnvelope.startSample) / rate,
    ),
    rightContextSeconds = Math.max(
      0,
      (reviewEnvelope.endSample - unit.envelopeInterval.endSample) / rate,
    ),
    allObligationIds = sortedUnique145(
      input.bundles.flatMap((bundle) => bundle.obligationIds),
    ),
    obligationCoverage = unit.phaseAObligationIds.length
      ? unit.phaseAObligationIds.filter((value) =>
          allObligationIds.includes(value),
        ).length / unit.phaseAObligationIds.length
      : 1,
    baseReasons = [
      ...(!input.bundles.every(
        (bundle) =>
          bundle.eligible &&
          bundle.verifiedTimebase &&
          !bundle.strongContradiction,
      )
        ? ["INELIGIBLE_BUNDLE"]
        : []),
      ...(new Set(input.bundles.flatMap((bundle) => bundle.childUnitIds))
        .size !== input.bundles.flatMap((bundle) => bundle.childUnitIds).length
        ? ["OVERLAPPING_BUNDLE_CHILD_MEMBERSHIP"]
        : []),
      ...(envelopeSeconds > policy.maximumReviewEnvelopeSeconds
        ? ["ENVELOPE_TOO_LONG"]
        : []),
      ...(leftContextSeconds > policy.maximumOneSideContextSeconds ||
      rightContextSeconds > policy.maximumOneSideContextSeconds
        ? ["AUDIO_CONTEXT_LIMIT_EXCEEDED"]
        : []),
      ...(!input.bundles.every(
        (bundle) =>
          bundle.sourceIdentity.sourceMediaSha256 ===
            unit.sourceIdentity.sourceMediaSha256 &&
          bundle.sourceIdentity.audioStreamIndex ===
            unit.sourceIdentity.audioStreamIndex,
      )
        ? ["SOURCE_IDENTITY_CONFLICT"]
        : []),
    ],
    contractReasons =
      input.contractType === "TARGET_CORE_LOCALIZATION_CONTRACT_V1"
        ? targetCoreCoverageOfUnit < policy.coreCompleteUnitCoverageThreshold
          ? ["NO_CORE_COMPLETE_REALIZATION"]
          : []
        : [
            ...(anchorOverlapSamples <
              policy.machineAnchorMinimumOverlapSeconds * rate ||
            targetCoreCoverageOfUnit <
              policy.machineAnchorMinimumUnitCoverageRatio
              ? ["NO_VALID_MACHINE_ANCHOR"]
              : []),
            ...(predictedPlaybackCoverageOfUnit <
            policy.playbackUnitCoverageThreshold
              ? ["NO_ANCHORED_PLAYBACK_REALIZATION"]
              : []),
          ],
    rejectionReasons = sortedUnique145([...baseReasons, ...contractReasons]),
    payload = {
      coverageUnitId: unit.coverageUnitId,
      contractType: input.contractType,
      bundleIds,
      childUnitIds,
      atomicTargetCoreIntervals: targetCore,
      reviewEnvelope,
    },
    realizationId = `coverage-realization-v145-${hash141(payload).slice(0, 24)}`;
  return realizations145Schema.shape.candidates.element.parse(
    hashed141({
      realizationId,
      coverageUnitId: unit.coverageUnitId,
      contractType: input.contractType,
      realizationType:
        input.contractType === "TARGET_CORE_LOCALIZATION_CONTRACT_V1"
          ? "CORE_COMPLETE_REALIZATION"
          : "MACHINE_ANCHORED_PLAYBACK_REALIZATION",
      childUnitIds,
      bundleIds,
      atomicTargetCoreIntervals: targetCore,
      targetCoreCoverageOfUnit,
      anchorOverlapSamples,
      anchorCoverageRatio: targetCoreCoverageOfUnit,
      reviewEnvelope,
      predictedPlaybackCoverageOfUnit,
      leftContextSeconds,
      rightContextSeconds,
      targetSlotCost: bundleIds.length,
      speechCoreCostSamples: sampleCount143(targetCore),
      predictedAudioCostSamples: sampleCount143(audio),
      internalSilenceCostSamples: sampleCount143(
        input.bundles.flatMap((bundle) => bundle.internalGapIntervals),
      ),
      obligationCoverage,
      sourceIdentity: unit.sourceIdentity,
      eligibility: rejectionReasons.length === 0,
      rejectionReasons,
    }),
  );
}

function enumerateBundleSets145(input: {
  policy: Policy145;
  unit: CoverageUnit145;
  bundles: Bundle143[];
}) {
  const relevant = input.bundles
      .filter(
        (bundle) =>
          overlapSamples145(
            input.unit.atomicNativeIntervals,
            bundle.nativeIntervalUnion,
          ) > 0,
      )
      .sort(
        (a, b) =>
          a.reviewEnvelope.startSample - b.reviewEnvelope.startSample ||
          a.bundleId.localeCompare(b.bundleId),
      ),
    results = new Map<string, Bundle143[]>();
  relevant.forEach((bundle) => results.set(bundle.bundleId, [bundle]));

  const visit = (
    start: number,
    selected: Bundle143[],
    occupiedChildren: Set<string>,
  ) => {
    if (selected.length >= Math.min(6, input.policy.maximumActiveSafetyBundles))
      return;
    for (let index = start; index < relevant.length; index++) {
      const bundle = required141(relevant[index]);
      if (bundle.childUnitIds.some((childId) => occupiedChildren.has(childId)))
        continue;
      const next = [...selected, bundle],
        key = next
          .map((row) => row.bundleId)
          .sort()
          .join("|");
      if (!results.has(key)) results.set(key, next);
      const core = union141(next.flatMap((row) => row.nativeIntervalUnion)),
        audio = union141(next.flatMap((row) => row.predictedAudioIntervals)),
        coreCoverage =
          overlapSamples145(input.unit.atomicNativeIntervals, core) /
          input.unit.coreUnionSamples,
        audioCoverage =
          overlapSamples145(input.unit.atomicNativeIntervals, audio) /
          input.unit.coreUnionSamples;
      // Once both contracts are complete, supersets cannot improve Unit value
      // and can only add costs. This is an exact cost-dominance prune.
      if (
        coreCoverage >= input.policy.coreCompleteUnitCoverageThreshold &&
        audioCoverage >= input.policy.playbackUnitCoverageThreshold
      )
        continue;
      visit(
        index + 1,
        next,
        new Set([...occupiedChildren, ...bundle.childUnitIds]),
      );
    }
  };
  visit(0, [], new Set());
  return [...results.values()];
}

const dominates145 = (left: Realization145, right: Realization145) => {
  const a = [
      left.targetSlotCost,
      left.speechCoreCostSamples,
      left.predictedAudioCostSamples,
      left.internalSilenceCostSamples,
    ],
    b = [
      right.targetSlotCost,
      right.speechCoreCostSamples,
      right.predictedAudioCostSamples,
      right.internalSilenceCostSamples,
    ];
  return (
    a.every((value, index) => value <= required141(b[index])) &&
    a.some((value, index) => value < required141(b[index]))
  );
};

export function buildRealizations145(input: {
  policy: Policy145;
  units: CoverageUnits145;
  contractPolicy: ContractPolicy145;
  bundles: Bundles143;
  bundleDominance: Dominance143;
}): {
  realizations: Realizations145;
  dominance: RealizationDominance145;
} {
  [
    input.policy,
    input.units,
    input.contractPolicy,
    input.bundles,
    input.bundleDominance,
  ].forEach(assertHash141);
  const retainedBundleIds = new Set(input.bundleDominance.retainedBundleIds),
    bundles = input.bundles.candidates.filter(
      (bundle) =>
        retainedBundleIds.has(bundle.bundleId) &&
        bundle.eligible &&
        bundle.verifiedTimebase &&
        !bundle.strongContradiction,
    ),
    candidates = input.units.units.flatMap((unit) => {
      const sets = enumerateBundleSets145({
        policy: input.policy,
        unit,
        bundles,
      });
      return [
        ...sets.map((rows) =>
          realizationRow145({
            policy: input.policy,
            unit,
            contractType: "TARGET_CORE_LOCALIZATION_CONTRACT_V1",
            bundles: rows,
          }),
        ),
        ...sets.map((rows) =>
          realizationRow145({
            policy: input.policy,
            unit,
            contractType: "MACHINE_ANCHORED_PLAYBACK_AUDIBILITY_CONTRACT_V1",
            bundles: rows,
          }),
        ),
      ];
    }),
    eligible = candidates.filter((candidate) => candidate.eligibility),
    dominatedBy: Record<string, string> = {};
  for (const candidate of eligible) {
    const dominator = eligible
      .filter(
        (other) =>
          other.coverageUnitId === candidate.coverageUnitId &&
          other.contractType === candidate.contractType &&
          other.realizationId !== candidate.realizationId &&
          dominates145(other, candidate),
      )
      .sort((a, b) => a.realizationId.localeCompare(b.realizationId))[0];
    if (dominator)
      dominatedBy[candidate.realizationId] = dominator.realizationId;
  }
  const dominatedRealizationIds = Object.keys(dominatedBy).sort(),
    retainedRealizationIds = eligible
      .filter((candidate) => !dominatedBy[candidate.realizationId])
      .map((candidate) => candidate.realizationId)
      .sort(),
    unitHas = (unit: CoverageUnit145, contract: Contract145) =>
      eligible.some(
        (candidate) =>
          candidate.coverageUnitId === unit.coverageUnitId &&
          candidate.contractType === contract,
      );
  const realizations = realizations145Schema.parse(
      hashed141({
        ...header145(input.policy, input.units.sourceIdentity),
        artifactType: "machine-coverage-unit-realization-candidates-v1",
        coverageUnitsHash: input.units.semanticHash,
        contractPolicyHash: input.contractPolicy.semanticHash,
        bundleCandidatesHash: input.bundles.semanticHash,
        candidates,
        candidateCount: candidates.length,
        eligibleCandidateCount: eligible.length,
        coreCompleteCandidateCount: eligible.filter(
          (candidate) =>
            candidate.contractType === "TARGET_CORE_LOCALIZATION_CONTRACT_V1",
        ).length,
        anchoredPlaybackCandidateCount: eligible.filter(
          (candidate) =>
            candidate.contractType ===
            "MACHINE_ANCHORED_PLAYBACK_AUDIBILITY_CONTRACT_V1",
        ).length,
        unitWithoutCoreCompleteRealizationCount: input.units.units.filter(
          (unit) => !unitHas(unit, "TARGET_CORE_LOCALIZATION_CONTRACT_V1"),
        ).length,
        unitWithoutAnchoredPlaybackRealizationCount: input.units.units.filter(
          (unit) =>
            !unitHas(unit, "MACHINE_ANCHORED_PLAYBACK_AUDIBILITY_CONTRACT_V1"),
        ).length,
      }),
    ),
    dominance = realizationDominance145Schema.parse(
      hashed141({
        ...header145(input.policy, input.units.sourceIdentity),
        artifactType: "machine-coverage-unit-realization-dominance-ledger",
        realizationCandidatesHash: realizations.semanticHash,
        retainedRealizationIds,
        dominatedRealizationIds,
        dominatedBy,
        candidateCount: eligible.length,
        retainedCount: retainedRealizationIds.length,
        dominatedCount: dominatedRealizationIds.length,
        strictCostDominanceOnly: true,
      }),
    );
  return { realizations, dominance };
}
