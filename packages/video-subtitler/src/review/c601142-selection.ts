import {
  clusters142Schema,
  candidate142Schema,
  uncovered142Schema,
  safety142Schema,
  supersession142Schema,
  pathology142Schema,
  phaseA142Schema,
  type Candidate142,
  type Cluster142,
  type Clusters142,
  type Family142,
  type Stratum142,
  type Safety142,
  type SafetyTarget142,
  type Policy142,
  type Samples142,
  type Uncovered142,
  type C601141Uncovered,
  type C601141Safety,
  type C601141Inventory,
} from "@mvl/shared";
import { header142 } from "./c601142-policy.js";
import {
  hashed141,
  hash141,
  assertHash141,
  id141,
  union141,
  subtract141,
  duration141,
  seconds141,
} from "./c601141-policy.js";

export function unique142<T extends string | number>(
  values: readonly T[],
): T[] {
  return [...new Set(values)].sort((a, b) =>
    typeof a === "number" && typeof b === "number"
      ? a - b
      : String(a).localeCompare(String(b)),
  );
}
const unique141 = unique142;

export function stratum142(
  families: Family142[],
  views: string[],
  masked = false,
): Stratum142 {
  const modern = unique141(
    families.filter((f) => ["SILERO", "PYANNOTE", "WEBRTC"].includes(f)),
  );
  if (modern.length >= 2) return "MULTI_DETECTOR";
  if (families.includes("LEGACY_FINGERPRINT"))
    return "LEGACY_FINGERPRINT_EXCLUSIVE";
  if (masked) return "MASKED_SUBTHRESHOLD";
  if (modern.length === 1 && views.length >= 2)
    return "MULTI_VIEW_SAME_DETECTOR";
  if (modern[0] === "PYANNOTE") return "PYANNOTE_EXCLUSIVE";
  if (modern[0] === "SILERO") return "SILERO_EXCLUSIVE";
  if (modern[0] === "WEBRTC") return "WEBRTC_EXCLUSIVE";
  return families.includes("EXISTING_VERIFIED")
    ? "EXISTING_VERIFIED"
    : "AUDIT_ONLY";
}
export function oldCandidates142(
  old: C601141Uncovered,
  inventory: C601141Inventory,
  policy: Policy142,
): Uncovered142 {
  [old, inventory].forEach(assertHash141);
  const candidates = old.candidates.map((c) => {
    const detectorFamilies = unique141(
      inventory.observations
        .filter((o) => c.observationIds.includes(o.observationId))
        .map((o) => o.family),
    );
    return candidate142Schema.parse(
      hashed141({
        ...c,
        detectorFamilies,
        evidenceStratum: stratum142(detectorFamilies, c.distinctPcmViewIds),
        maskedEvidenceIds: [],
        speechTruthVerified: false,
        sceneIds: [],
      }),
    );
  });
  return uncovered142Schema.parse(
    hashed141({
      ...header142(policy, old.sourceIdentity),
      artifactType: "machine-uncovered-speech-candidates-v2",
      inventoryHash: old.inventoryHash,
      finalCueHash: old.finalCueHash,
      previousTargetsHash: old.previousTargetsHash,
      subtractedActiveSafetyHash: null,
      candidates,
      summary: old.summary,
    }),
  );
}
const positiveOverlap = (a: Samples142, b: Samples142) =>
  Math.max(a.startSample, b.startSample) < Math.min(a.endSample, b.endSample);
export function coverageSamples142(
  target: Samples142,
  intervals: Samples142[],
) {
  return union141(
    intervals.flatMap((v) => {
      const startSample = Math.max(v.startSample, target.startSample),
        endSample = Math.min(v.endSample, target.endSample);
      return endSample > startSample ? [{ startSample, endSample }] : [];
    }),
  ).reduce((n, v) => n + v.endSample - v.startSample, 0);
}
const strength142 = (candidate: Candidate142) => {
  if (!candidate.verifiedTimebase || candidate.strongContradiction) return 0;
  switch (candidate.evidenceClass) {
    case "MULTI_DETECTOR_CONFIRMED":
      return 9;
    case "LEGACY_FINGERPRINT_CONFIRMED":
      return 8;
    case "EXISTING_VERIFIED_SPEECH":
      return 7;
    case "MULTI_VIEW_SPEECH_POSITIVE":
      return 6;
    case "PYANNOTE_ONLY_SPEECH_POSITIVE":
      return 5;
    case "WEBRTC_EXCLUSIVE_SPEECH_CANDIDATE":
      return 3;
    case "SINGLE_DETECTOR_HIGH_RECALL":
      return 3;
    case "CROSS_DETECTOR_SUBTHRESHOLD_CANDIDATE":
      return 3;
    case "MASKED_SPEECH_SAFETY_CANDIDATE":
      return 2;
    case "SUBTHRESHOLD_MULTI_VIEW_CANDIDATE":
      return 2;
    default:
      return 0;
  }
};
export interface Boundaries142 {
  cueMasks: Samples142[];
  existingTargetMasks: Samples142[];
  sceneSamples: number[];
  speakerSamples: number[];
}
/** Only join compatible speech atoms with an independently supported bridge.
 * Envelopes never become positive speech, and masks remain half-open. */
export function clusterCandidates142(input: {
  uncovered: Uncovered142;
  oldSafety: C601141Safety;
  policy: Policy142;
  boundaries: Boundaries142;
  speechIntervals: Samples142[];
}): Clusters142 {
  const { uncovered, oldSafety, policy, boundaries } = input;
  [uncovered, oldSafety].forEach(assertHash141);
  const rate = uncovered.sourceIdentity.sampleRate;
  const hardBoundaries = [
    ...boundaries.sceneSamples,
    ...boundaries.speakerSamples,
  ];
  const masks = union141([
    ...boundaries.cueMasks,
    ...boundaries.existingTargetMasks,
  ]);
  const sorted = [...uncovered.candidates].sort(
    (a, b) =>
      a.nativeInterval.startSample - b.nativeInterval.startSample ||
      a.candidateId.localeCompare(b.candidateId),
  );
  for (const c of sorted) {
    if (masks.some((m) => positiveOverlap(m, c.nativeInterval)))
      throw new Error("C601142_UNCOVERED_ATOM_CROSSES_PROTECTED_MASK");
    if (
      hardBoundaries.some(
        (b) =>
          b > c.nativeInterval.startSample && b < c.nativeInterval.endSample,
      )
    )
      throw new Error("C601142_UNCOVERED_ATOM_CROSSES_STRUCTURAL_BOUNDARY");
  }
  const groups: Candidate142[][] = [];
  for (const candidate of sorted) {
    const group = groups.at(-1),
      previous = group?.at(-1),
      first = group?.[0];
    const gap = previous
      ? candidate.nativeInterval.startSample - previous.nativeInterval.endSample
      : Infinity;
    const bridge =
      previous && gap > 0
        ? {
            startSample: previous.nativeInterval.endSample,
            endSample: candidate.nativeInterval.startSample,
          }
        : null;
    const compatible =
      previous?.verifiedTimebase === candidate.verifiedTimebase &&
      previous.strongContradiction === candidate.strongContradiction &&
      strength142(previous) > 0 === strength142(candidate) > 0 &&
      previous.independentFamilies.some((f) =>
        candidate.independentFamilies.includes(f),
      );
    const canJoin =
      group &&
      previous &&
      first &&
      compatible &&
      gap >= 0 &&
      gap <= Math.round(policy.cluster.maximumGapSeconds * rate) &&
      candidate.nativeInterval.endSample - first.nativeInterval.startSample <=
        policy.cluster.maximumEnvelopeSeconds * rate &&
      !hardBoundaries.some(
        (b) =>
          b >= previous.nativeInterval.endSample &&
          b <= candidate.nativeInterval.startSample,
      ) &&
      (!bridge ||
        (!masks.some((m) => positiveOverlap(m, bridge)) &&
          coverageSamples142(bridge, input.speechIntervals) === gap));
    if (canJoin) group.push(candidate);
    else groups.push([candidate]);
  }
  const clusters = groups.map((group) => {
    const first = group[0],
      last = group.at(-1);
    if (!first || !last) throw new Error("C601142_EMPTY_CLUSTER");
    const atomicNativeIntervals = group.map((c) => c.nativeInterval),
      targetCoreUnion = union141(atomicNativeIntervals);
    const reviewEnvelope = {
      startSample: first.nativeInterval.startSample,
      endSample: last.nativeInterval.endSample,
    };
    const coreSeconds = duration141(targetCoreUnion, rate);
    const verified = group.every((c) => c.verifiedTimebase),
      contradiction = group.some((c) => c.strongContradiction);
    const strength = Math.min(...group.map(strength142));
    const eligible =
      verified &&
      !contradiction &&
      strength > 0 &&
      coreSeconds + 1e-9 >= policy.cluster.minimumCoreSeconds;
    const independentFamilies = unique141(
      group.flatMap((c) => c.independentFamilies),
    );
    const core = {
      memberCandidateIds: group.map((c) => c.candidateId),
      parentIslandIds: unique141(group.map((c) => c.parentIslandId)),
      atomicNativeIntervals,
      atomicSourceIntervals: atomicNativeIntervals.map((v) =>
        seconds141(v, rate),
      ),
      targetCoreUnion,
      reviewEnvelope,
      observationIds: unique141(group.flatMap((c) => c.observationIds)),
      evidenceIds: unique141(group.flatMap((c) => c.evidenceIds)),
      requestIds: unique141(group.flatMap((c) => c.requestIds)),
      detectorFamilies: unique141(group.flatMap((c) => c.detectorFamilies)),
      independentFamilies,
      independentFamilyCount: independentFamilies.length,
      evidenceStrata: unique141(group.map((c) => c.evidenceStratum)),
      distinctPcmViewIds: unique141(group.flatMap((c) => c.distinctPcmViewIds)),
      diversityBins: unique141(group.map((c) => c.diversityBin)),
      sceneIds: unique141(group.flatMap((c) => c.sceneIds)),
      uncoveredSpeechSeconds: coreSeconds,
      internalSilenceSeconds: Math.max(
        0,
        (reviewEnvelope.endSample - reviewEnvelope.startSample) / rate -
          coreSeconds,
      ),
      crossesCueBoundary: false as const,
      crossesExistingTarget: false as const,
      crossesSceneBoundary: false as const,
      crossesSpeakerBoundary: false as const,
      verifiedTimebase: verified,
      strongContradiction: contradiction,
      eligible,
      eligibilityReasons: [
        eligible
          ? "VERIFIED_LOCALIZED_SPEECH_SUPPORT"
          : !verified
            ? "INVALID_TIMEBASE"
            : contradiction
              ? "CONTRADICTED"
              : strength === 0
                ? "LOW_SUPPORT"
                : "BELOW_MINIMUM_CORE_DURATION",
      ],
      evidenceStrength: strength,
      oldTargetIds: oldSafety.targets
        .filter((t) =>
          targetCoreUnion.some((v) => positiveOverlap(v, t.nativeInterval)),
        )
        .map((t) => t.targetId),
      maskedEvidenceIds: unique141(group.flatMap((c) => c.maskedEvidenceIds)),
    };
    return hashed141({
      clusterId: id141("safety-cluster-v2", {
        source: uncovered.sourceIdentity,
        members: core.memberCandidateIds,
        targetCoreUnion,
      }),
      ...core,
    });
  });
  return clusters142Schema.parse(
    hashed141({
      ...header142(policy, uncovered.sourceIdentity),
      artifactType: "machine-safety-target-clusters-v2",
      uncoveredHash: uncovered.semanticHash,
      oldSafetyHash: oldSafety.semanticHash,
      boundaryHash: hash141(boundaries),
      speechUnionHash: hash141(union141(input.speechIntervals)),
      clusters,
      summary: {
        atomicCandidateCount: sorted.length,
        clusterCount: clusters.length,
        eligibleClusterCount: clusters.filter((c) => c.eligible).length,
        mergedCandidateCount: sorted.length - clusters.length,
        largestClusterMemberCount: Math.max(
          0,
          ...clusters.map((c) => c.memberCandidateIds.length),
        ),
        speechCoreUnionSeconds: duration141(
          clusters.flatMap((c) => c.targetCoreUnion),
          rate,
        ),
        envelopeAsSpeechCount: 0,
      },
    }),
  );
}
export function maximumDensity142(
  clusters: Pick<Cluster142, "reviewEnvelope">[],
  rate: number,
  seconds = 15,
): number {
  const starts = clusters
    .map((c) => c.reviewEnvelope.startSample)
    .sort((a, b) => a - b);
  return Math.max(
    0,
    ...starts.map(
      (start) =>
        starts.filter((v) => v >= start && v < start + seconds * rate).length,
    ),
  );
}
/** Ignore historical density exceptions elsewhere: only a window containing
 * the NEW start can be made denser by this insertion. */
export function insertionDensity142(
  cluster: Pick<Cluster142, "reviewEnvelope">,
  selected: Pick<Cluster142, "reviewEnvelope">[],
  rate: number,
  seconds = 15,
) {
  const current = cluster.reviewEnvelope.startSample;
  const starts = [
    ...selected.map((c) => c.reviewEnvelope.startSample),
    current,
  ];
  return Math.max(
    0,
    ...starts
      .filter((start) => start <= current && current < start + seconds * rate)
      .map(
        (start) =>
          starts.filter((v) => v >= start && v < start + seconds * rate).length,
      ),
  );
}
const isExclusive = (cluster: Cluster142) =>
  cluster.evidenceStrata.some((s) => s.endsWith("_EXCLUSIVE"));
export function marginalUtility142(
  cluster: Cluster142,
  selected: Cluster142[],
  policy: Policy142,
  rate: number,
) {
  const union = union141(selected.flatMap((c) => c.targetCoreUnion));
  const incremental = duration141(
    cluster.targetCoreUnion.flatMap((v) => subtract141(v, union)),
    rate,
  );
  const families = new Set(selected.flatMap((c) => c.independentFamilies)),
    strata = new Set(selected.flatMap((c) => c.evidenceStrata));
  const bins = new Set(selected.flatMap((c) => c.diversityBins)),
    scenes = new Set(selected.flatMap((c) => c.sceneIds));
  const distance = (a: Cluster142) =>
    Math.abs(
      a.reviewEnvelope.startSample - cluster.reviewEnvelope.startSample,
    ) / rate;
  const density = selected.filter(
    (c) => distance(c) < policy.selection.localWindowSeconds,
  ).length;
  const w = policy.selection.weights;
  return {
    incremental,
    utility:
      w.evidence * cluster.evidenceStrength +
      w.newSeconds * incremental +
      w.newFamily *
        cluster.independentFamilies.filter((f) => !families.has(f)).length +
      w.newStratum *
        cluster.evidenceStrata.filter((s) => !strata.has(s)).length +
      w.newBin * cluster.diversityBins.filter((b) => !bins.has(b)).length +
      w.newScene * cluster.sceneIds.filter((s) => !scenes.has(s)).length +
      w.independent * cluster.independentFamilyCount -
      w.redundancy * (cluster.uncoveredSpeechSeconds - incremental) -
      w.density * density -
      w.slotCost -
      w.unionCost * incremental,
  };
}
export function selectSafety142(input: {
  clusters: Clusters142;
  oldSafety: C601141Safety;
  policy: Policy142;
  variant: Safety142["variant"];
}): Safety142 {
  const { clusters, oldSafety, policy, variant } = input;
  [clusters, oldSafety].forEach(assertHash141);
  const selected: SafetyTarget142[] = [],
    trace: Safety142["decisionTrace"] = [];
  const rate = clusters.sourceIdentity.sampleRate,
    maximum = policy.selection;
  const eligible = clusters.clusters.filter((c) => c.eligible);
  const selectedSet = () => new Set(selected.map((c) => c.clusterId));
  function feasibility(c: Cluster142, preserve = false) {
    const marginal = marginalUtility142(c, selected, policy, rate);
    if (marginal.incremental <= 0)
      return {
        reason: "REDUNDANT_WITH_SELECTED_CLUSTER" as const,
        marginal,
        override: null,
      };
    if (
      selected.length >= maximum.maximumTargets ||
      duration141(
        [...selected.flatMap((s) => s.targetCoreUnion), ...c.targetCoreUnion],
        rate,
      ) >
        maximum.maximumCoreUnionSeconds + 1e-8
    )
      return { reason: "BUDGET_OVERFLOW" as const, marginal, override: null };
    if (insertionDensity142(c, selected, rate) > maximum.maximumLocalTargets) {
      // These clusters have already failed exact structural/silence-safe joining.
      // Only preservation can override density; new novelty may never do so.
      if (preserve && c.oldTargetIds.length)
        return {
          reason: null,
          marginal,
          override: "PRESERVE_OLD_COVERAGE_STRUCTURALLY_OR_SILENCE_UNMERGEABLE",
        };
      return {
        reason: "LOCAL_DENSITY_REJECTED" as const,
        marginal,
        override: null,
      };
    }
    return { reason: null, marginal, override: null };
  }
  function take(c: Cluster142, stage: SafetyTarget142["selectionStage"]) {
    if (selectedSet().has(c.clusterId)) return false;
    const result = feasibility(c, stage === "PRESERVE_OLD");
    if (result.reason) return false;
    trace.push({
      iteration: trace.length,
      selectedClusterId: c.clusterId,
      stage,
      selectedSetBeforeHash: hash141(selected.map((v) => v.clusterId)),
      eligiblePoolHash: hash141(
        eligible
          .filter((v) => !selectedSet().has(v.clusterId))
          .map((v) => v.clusterId)
          .sort(),
      ),
      utility: result.marginal.utility,
      incrementalUnionSeconds: result.marginal.incremental,
    });
    selected.push(
      hashed141({
        ...c,
        targetId: id141("safety-target-v2", {
          clusterId: c.clusterId,
          policyHash: policy.semanticHash,
        }),
        selectionStage: stage,
        marginalUtility: result.marginal.utility,
        incrementalUnionSeconds: result.marginal.incremental,
        densityOverrideReason: result.override,
        requiredLevel: "RECOMMENDED",
        canonicalInsertAllowed: false,
      }),
    );
    return true;
  }
  // The preservation set is fixed before novelty. It cannot be dropped to make
  // a recall/burden number look better, even in detector-only ablation.
  for (const c of eligible
    .filter((c) => c.oldTargetIds.length)
    .sort(
      (a, b) =>
        a.reviewEnvelope.startSample - b.reviewEnvelope.startSample ||
        a.clusterId.localeCompare(b.clusterId),
    ))
    take(c, "PRESERVE_OLD");
  const preserved = () =>
    oldSafety.targets.every(
      (t) =>
        coverageSamples142(
          t.nativeInterval,
          selected.flatMap((c) => c.targetCoreUnion),
        ) ===
        t.nativeInterval.endSample - t.nativeInterval.startSample,
    );
  if (!preserved())
    throw new Error(
      "C601142_OLD_SAFETY_COVERAGE_CANNOT_BE_PRESERVED_WITHIN_FROZEN_BUDGET",
    );
  let reserved = 0;
  const rank = (pool: Cluster142[]) =>
    [...pool].sort((a, b) => {
      const score =
        variant === "STRATUM_DIVERSITY"
          ? (c: Cluster142) =>
              c.evidenceStrength * 100 + c.uncoveredSpeechSeconds
          : (c: Cluster142) =>
              marginalUtility142(c, selected, policy, rate).utility;
      return (
        score(b) - score(a) ||
        a.reviewEnvelope.startSample - b.reviewEnvelope.startSample ||
        a.clusterId.localeCompare(b.clusterId)
      );
    });
  const available = () =>
    eligible.filter(
      (c) => !selectedSet().has(c.clusterId) && !feasibility(c).reason,
    );
  if (variant !== "CLUSTER_ONLY") {
    while (reserved < maximum.reservedExclusiveSlots) {
      const pool = available().filter(
        (c) => isExclusive(c) && c.oldTargetIds.length === 0,
      );
      const next = rank(pool)[0];
      if (!next || !take(next, "EXCLUSIVE_RESERVE")) break;
      reserved++;
    }
    // Recompute bin novelty after each selected cluster, then recompute the
    // entire marginal utility after EVERY subsequent selection.
    while (selected.length < maximum.maximumTargets) {
      const bins = new Set(selected.flatMap((c) => c.diversityBins));
      const next = rank(
        available().filter((c) => c.diversityBins.some((b) => !bins.has(b))),
      )[0];
      if (!next || !take(next, "TIMELINE_DIVERSITY")) break;
    }
    while (selected.length < maximum.maximumTargets) {
      const next = rank(available())[0];
      if (
        !next ||
        !take(
          next,
          variant === "STRATUM_DIVERSITY"
            ? "STATIC_ABLATION"
            : "DYNAMIC_MARGINAL",
        )
      )
        break;
    }
  }
  const audit: Safety142["audit"] = clusters.clusters.map((c) => {
    const target = selected.find((t) => t.clusterId === c.clusterId);
    return {
      clusterId: c.clusterId,
      candidateIds: c.memberCandidateIds,
      targetId: target?.targetId ?? null,
      status: target
        ? "SELECTED"
        : !c.verifiedTimebase
          ? "INVALID_TIMEBASE"
          : c.strongContradiction
            ? "CONTRADICTED"
            : !c.eligible
              ? "LOW_SUPPORT_AUDIT_ONLY"
              : (feasibility(c).reason ?? "BUDGET_OVERFLOW"),
      reason: target
        ? target.selectionStage
        : !c.eligible
          ? c.eligibilityReasons.join(";")
          : variant === "CLUSTER_ONLY"
            ? "CLUSTER_ONLY_ABLATION_NO_ADDITIONS"
            : (feasibility(c).reason ?? "NOT_SELECTED"),
      densityOverrideReason: target?.densityOverrideReason ?? null,
    };
  });
  const targetUnionSeconds = duration141(
    selected.flatMap((c) => c.targetCoreUnion),
    rate,
  );
  return safety142Schema.parse(
    hashed141({
      ...header142(policy, clusters.sourceIdentity),
      artifactType: "machine-missing-safety-reserve-targets-v2",
      variant,
      clustersHash: clusters.semanticHash,
      oldSafetyHash: oldSafety.semanticHash,
      targets: selected,
      audit,
      decisionTrace: trace,
      summary: {
        targetCount: selected.length,
        atomicMemberCount: selected.reduce(
          (n, c) => n + c.memberCandidateIds.length,
          0,
        ),
        targetUnionSeconds,
        slotUtilization: selected.length / maximum.maximumTargets,
        durationUtilization:
          targetUnionSeconds / maximum.maximumCoreUnionSeconds,
        preservedOldTargetCount: oldSafety.targets.length,
        oldCoveragePreserved: preserved(),
        reservedExclusiveSelectedCount: reserved,
        unusedReservedSlotsReturned: maximum.reservedExclusiveSlots - reserved,
        overflowCount: audit.filter((a) => a.status === "BUDGET_OVERFLOW")
          .length,
        auditOnlyCount: audit.filter(
          (a) => a.status === "LOW_SUPPORT_AUDIT_ONLY",
        ).length,
        densityRejectedCount: audit.filter(
          (a) => a.status === "LOCAL_DENSITY_REJECTED",
        ).length,
        densityOverrideCount: selected.filter((c) => c.densityOverrideReason)
          .length,
        selectedBins: unique141(selected.flatMap((c) => c.diversityBins)),
        selectedStrata: unique141(selected.flatMap((c) => c.evidenceStrata)),
        catchAllTargetCount: 0,
        requiredLevelPromotionCount: 0,
      },
    }),
  );
}
export function supersession142(
  old: C601141Safety,
  safety: Safety142,
  policy: Policy142,
) {
  const entries = old.targets.map((t) => {
    const selected = safety.targets.filter((s) =>
      s.targetCoreUnion.some((v) => positiveOverlap(v, t.nativeInterval)),
    );
    const coveredSamples = coverageSamples142(
      t.nativeInterval,
      selected.flatMap((s) => s.targetCoreUnion),
    );
    const coveragePreserved =
      coveredSamples ===
      t.nativeInterval.endSample - t.nativeInterval.startSample;
    return {
      oldTargetId: t.targetId,
      newTargetIds: selected.map((s) => s.targetId),
      status: !coveragePreserved
        ? ("COVERAGE_LOST" as const)
        : selected.length === 1 &&
            hash141(selected[0]?.targetCoreUnion) ===
              hash141([t.nativeInterval])
          ? ("RETAINED_EQUIVALENT" as const)
          : ("MERGED_AND_SUPERSEDED" as const),
      oldNativeInterval: t.nativeInterval,
      coveredSamples,
      coveragePreserved,
    };
  });
  const retainedClusters = safety.targets.filter((t) => t.oldTargetIds.length);
  return supersession142Schema.parse(
    hashed141({
      ...header142(policy, old.sourceIdentity),
      artifactType: "machine-safety-target-supersession-ledger",
      oldSafetyHash: old.semanticHash,
      safetyHash: safety.semanticHash,
      entries,
      summary: {
        oldTargetCount: old.targets.length,
        retainedOldCount: entries.filter(
          (e) => e.status === "RETAINED_EQUIVALENT",
        ).length,
        mergedOldCount: entries.filter(
          (e) => e.status === "MERGED_AND_SUPERSEDED",
        ).length,
        releasedSlots: Math.max(
          0,
          old.targets.length - retainedClusters.length,
        ),
        newTargetCount: safety.targets.filter((t) => !t.oldTargetIds.length)
          .length,
        detectorExclusiveAddedCount: safety.targets.filter(
          (t) => !t.oldTargetIds.length && isExclusive(t),
        ).length,
        overflowCount: safety.summary.overflowCount,
        coveragePreserved: entries.every((e) => e.coveragePreserved),
      },
    }),
  );
}
export function auditPathology142(
  old: C601141Safety,
  uncovered: Uncovered142,
  clusters: Clusters142,
  policy: Policy142,
) {
  const rate = old.sourceIdentity.sampleRate,
    selected = new Set(old.targets.map((t) => t.candidateId));
  const status = new Map(old.audit.map((a) => [a.candidateId, a.status]));
  const groupDefs = [
    ...unique141(uncovered.candidates.map((c) => c.evidenceStratum)).map(
      (key) => ({ dimension: "STRATUM" as const, key }),
    ),
    ...unique141(uncovered.candidates.flatMap((c) => c.detectorFamilies)).map(
      (key) => ({ dimension: "DETECTOR" as const, key }),
    ),
    ...unique141(uncovered.candidates.map((c) => c.diversityBin)).map(
      (key) => ({ dimension: "TIME_BIN" as const, key: String(key) }),
    ),
  ];
  const groups = groupDefs.map((g) => {
    const rows = uncovered.candidates.filter((c) =>
      g.dimension === "STRATUM"
        ? c.evidenceStratum === g.key
        : g.dimension === "DETECTOR"
          ? c.detectorFamilies.includes(g.key)
          : String(c.diversityBin) === g.key,
    );
    return {
      ...g,
      eligible: rows.filter(
        (c) => status.get(c.candidateId) !== "LOW_SUPPORT_AUDIT_ONLY",
      ).length,
      selected: rows.filter((c) => selected.has(c.candidateId)).length,
      overflow: rows.filter(
        (c) => status.get(c.candidateId) === "BUDGET_OVERFLOW",
      ).length,
      auditOnly: rows.filter(
        (c) => status.get(c.candidateId) === "LOW_SUPPORT_AUDIT_ONLY",
      ).length,
      selectedSeconds: duration141(
        rows
          .filter((c) => selected.has(c.candidateId))
          .map((c) => c.nativeInterval),
        rate,
      ),
    };
  });
  const exclusive = uncovered.candidates.filter((c) =>
    c.evidenceStratum.endsWith("_EXCLUSIVE"),
  );
  const exclusiveStarvation = groups
    .filter((g) => g.dimension === "STRATUM" && g.key.endsWith("_EXCLUSIVE"))
    .map((g) => ({
      stratum: g.key as Stratum142,
      eligible: g.eligible,
      selected: g.selected,
      overflow: g.overflow,
      starved: g.eligible > 0 && g.selected === 0,
    }));
  return pathology142Schema.parse(
    hashed141({
      ...header142(policy, old.sourceIdentity),
      artifactType: "machine-safety-target-selection-pathology-audit",
      oldSafetyHash: old.semanticHash,
      uncoveredHash: uncovered.semanticHash,
      clustersHash: clusters.semanticHash,
      counts: {
        candidates: uncovered.candidates.length,
        eligible: old.audit.filter((a) => a.status !== "LOW_SUPPORT_AUDIT_ONLY")
          .length,
        selected: old.targets.length,
        overflow: old.summary.overflowCount,
        auditOnly: old.summary.auditOnlyCount,
        slotsMaximum: 24,
        secondsMaximum: 60,
        selectedUnionSeconds: old.summary.targetUnionSeconds,
        slotUtilization: old.targets.length / 24,
        durationUtilization: old.summary.targetUnionSeconds / 60,
        largestClusterMemberCount: clusters.summary.largestClusterMemberCount,
        adjacentSelectedFragmentCount: clusters.clusters.reduce(
          (n, c) => n + Math.max(0, c.oldTargetIds.length - 1),
          0,
        ),
        maximumRollingDensity: maximumDensity142(
          old.targets.map((t) => ({ reviewEnvelope: t.nativeInterval })),
          rate,
        ),
        exclusiveOverflowCount: exclusive.filter(
          (c) => status.get(c.candidateId) === "BUDGET_OVERFLOW",
        ).length,
        exclusiveSelectedCount: exclusive.filter((c) =>
          selected.has(c.candidateId),
        ).length,
      },
      groups,
      exclusiveStarvation,
      diagnosis: [
        ...(old.targets.length === 24 && old.summary.targetUnionSeconds < 60
          ? ["SLOT_SATURATION_BEFORE_DURATION_BUDGET"]
          : []),
        ...(exclusiveStarvation.some((g) => g.starved)
          ? ["DETECTOR_EXCLUSIVE_STRATUM_STARVATION"]
          : []),
        "STATIC_ORDER_DOES_NOT_RECOMPUTE_MARGINAL_NOVELTY",
      ],
      inferenceCount: 0,
      modelLoadCount: 0,
      providerProcessStartCount: 0,
    }),
  );
}
export function phaseA142(
  input: Parameters<typeof clusterCandidates142>[0],
  frozenAt: string,
) {
  const clusters = clusterCandidates142(input),
    pathology = auditPathology142(
      input.oldSafety,
      input.uncovered,
      clusters,
      input.policy,
    );
  const variants = (
    ["CLUSTER_ONLY", "STRATUM_DIVERSITY", "SELECTION_REPAIR_ONLY"] as const
  ).map((variant) => selectSafety142({ ...input, clusters, variant }));
  const final = variants.at(-1);
  if (!final) throw new Error("C601142_PHASE_A_VARIANTS_MISSING");
  const supersession = supersession142(input.oldSafety, final, input.policy);
  const old = input.oldSafety.targets.map((t) => t.nativeInterval),
    rate = input.uncovered.sourceIdentity.sampleRate;
  const projection = phaseA142Schema.parse(
    hashed141({
      ...header142(input.policy, input.uncovered.sourceIdentity),
      artifactType: "c6-0-1-14-2-phase-a-selection-projection",
      frozenAt,
      oldSafetyHash: input.oldSafety.semanticHash,
      pathologyHash: pathology.semanticHash,
      clustersHash: clusters.semanticHash,
      variants,
      supersessionHash: supersession.semanticHash,
      predictedAddedCoreSeconds: duration141(
        final.targets.flatMap((t) =>
          t.targetCoreUnion.flatMap((v) => subtract141(v, old)),
        ),
        rate,
      ),
      predictedAddedEnvelopeSeconds: duration141(
        final.targets.flatMap((t) => subtract141(t.reviewEnvelope, old)),
        rate,
      ),
      actualAudioNotYetMaterialized: true,
      inferenceCount: 0,
      modelLoadCount: 0,
      providerProcessStartCount: 0,
    }),
  );
  return { clusters, pathology, safety: final, supersession, projection };
}
