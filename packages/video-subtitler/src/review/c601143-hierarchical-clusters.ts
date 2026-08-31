import {
  atom143Schema,
  child143Schema,
  hierarchy143Schema,
  type Atom143,
  type Child143,
  type Boundary143,
  type Posterior143,
  type Policy143,
  type Obligations143,
  type Inventory142,
  type Clusters142,
  type Safety142,
  type Candidate142,
  type Samples142,
  type ScoreTrack142,
} from "@mvl/shared";
import {
  assertHash141,
  hashed141,
  hash141,
  id141,
  union141,
  seconds141,
  required141,
} from "./c601141-policy.js";
import { unique142 } from "./c601142-selection.js";
import {
  header143,
  assertSource143,
  assertNative143,
  difference143,
  intersection143,
  intersects143,
  sampleCount143,
} from "./c601143-policy.js";

export interface ExistingScore143 {
  track: ScoreTrack142;
  values: number[];
  byteHashVerified: boolean;
}
export interface HierarchyBoundaries143 {
  finalCueMasks: Samples142[];
  immutableTargetMasks: Samples142[];
  verifiedSilence: Samples142[];
  discontinuitySamples: number[];
  verifiedSilencePoints?: { atSample: number; evidenceHash: string }[];
  sceneSamples: number[];
  speakerSamples: number[];
}
const noPosterior = (): Posterior143 => ({
  status: "NO_MAPPABLE_TRACK",
  trackHashes: [],
  frameCount: 0,
  minimum: null,
  maximum: null,
  mean: null,
  valleySamples: [],
});
function mappable(track: ExistingScore143, rate: number) {
  const m = track.track.timeMapping;
  return (
    track.byteHashVerified &&
    m.sourceSampleRate === rate &&
    m.numerator * m.outputSampleRate === m.denominator * rate &&
    m.measuredImpulsePeakDelaySamples === 0 &&
    track.track.frameCount === track.values.length &&
    track.values.every((v) => Number.isFinite(v) && v >= 0 && v <= 1)
  );
}
function mapFrame(track: ScoreTrack142, frame: number) {
  const m = track.timeMapping;
  return Math.min(
    track.maximumNativeSample,
    m.sourceStartSample +
      Math.round(
        ((track.frameOffsetSamples16k + frame * track.frameHopSamples16k) *
          m.numerator) /
          m.denominator,
      ),
  );
}
/** A valley must have two observed flanks in an already-frozen probability
 * track. Binary no-speech and unmappable arrays are not fabricated posteriors. */
export function posteriorValleys143(
  tracks: ExistingScore143[],
  rate: number,
): Boundary143[] {
  return tracks
    .filter((t) => mappable(t, rate) && t.track.scoreKind === "PROBABILITY")
    .flatMap(({ track, values }) => {
      const result: Boundary143[] = [];
      for (let i = 1; i < values.length - 1; i++) {
        if (
          (values[i] ?? 1) >= track.auditThreshold ||
          (values[i - 1] ?? 0) < track.auditThreshold
        )
          continue;
        const start = i;
        let minimum = values[i] ?? 1,
          at = i;
        while (
          i + 1 < values.length &&
          (values[i + 1] ?? 1) < track.auditThreshold
        ) {
          i++;
          if ((values[i] ?? 1) < minimum) {
            minimum = values[i] ?? 1;
            at = i;
          }
        }
        if (
          i + 1 >= values.length ||
          (values[start - 1] ?? 0) < track.auditThreshold ||
          (values[i + 1] ?? 0) < track.auditThreshold
        )
          continue;
        result.push({
          atSample: mapFrame(track, at),
          kind: "POSTERIOR_VALLEY",
          hard: false,
          strength: 50 + (track.auditThreshold - minimum),
          evidenceHashes: [track.semanticHash, track.scoreSha256],
        });
      }
      return result;
    });
}
function posteriorFor(
  intervals: Samples142[],
  tracks: ExistingScore143[],
  boundaries: Boundary143[],
): Posterior143 {
  const core = union141(intervals);
  if (!core.length) return noPosterior();
  const values: number[] = [],
    hashes: string[] = [];
  for (const row of tracks.filter((t) => t.track.scoreKind === "PROBABILITY")) {
    const { track } = row,
      m = track.timeMapping;
    let contributed = false;
    for (const v of core) {
      const frameAt = (n: number) =>
        (((n - m.sourceStartSample) * m.denominator) / m.numerator -
          track.frameOffsetSamples16k) /
        track.frameHopSamples16k;
      const begin = Math.max(0, Math.floor(frameAt(v.startSample))),
        end = Math.min(row.values.length, Math.ceil(frameAt(v.endSample)));
      for (let i = begin; i < end; i++) {
        const value = row.values[i];
        if (value !== undefined) {
          values.push(value);
          contributed = true;
        }
      }
    }
    if (contributed) hashes.push(track.semanticHash);
  }
  if (!values.length) return noPosterior();
  return {
    status: "VERIFIED_EXISTING_TRACK",
    trackHashes: unique142(hashes),
    frameCount: values.length,
    minimum: values.reduce((a, b) => Math.min(a, b), 1),
    maximum: values.reduce((a, b) => Math.max(a, b), 0),
    mean: values.reduce((a, b) => a + b, 0) / values.length,
    valleySamples: unique142(
      boundaries
        .filter(
          (b) =>
            b.kind === "POSTERIOR_VALLEY" &&
            core.some(
              (c) => b.atSample > c.startSample && b.atSample < c.endSample,
            ),
        )
        .map((b) => b.atSample),
    ),
  };
}

export function buildHierarchy143(input: {
  inventory: Inventory142;
  parents: Clusters142;
  phaseA: Safety142;
  candidates: Candidate142[];
  obligations: Obligations143;
  policy: Policy143;
  boundaries: HierarchyBoundaries143;
  scores: ExistingScore143[];
  scoreTracksHash: string;
}) {
  const { inventory, parents, phaseA, obligations, policy } = input,
    source = inventory.sourceIdentity,
    rate = source.sampleRate;
  const verifiedScores = input.scores.filter((s) => mappable(s, rate));
  [inventory, parents, phaseA, obligations].forEach((v) => {
    assertHash141(v);
    assertSource143(v.sourceIdentity, source);
  });
  if (obligations.phaseASelectionHash !== phaseA.semanticHash)
    throw new Error("C601143_PHASE_A_BINDING_CHANGED");
  const parentRows = [
    ...new Map(
      [...parents.clusters, ...phaseA.targets].map((p) => [p.clusterId, p]),
    ).values(),
  ].sort(
    (a, b) =>
      a.reviewEnvelope.startSample - b.reviewEnvelope.startSample ||
      a.clusterId.localeCompare(b.clusterId),
  );
  for (const p of parentRows) {
    assertHash141(p);
    assertNative143(p.atomicNativeIntervals, source);
    if (
      (p.reviewEnvelope.endSample - p.reviewEnvelope.startSample) / rate >
      policy.hardParentAuditEnvelopeSeconds + 1e-9
    )
      throw new Error("C601143_PARENT_AUDIT_ENVELOPE_EXCEEDS_FROZEN_BOUND");
  }
  const allCores = union141(parentRows.flatMap((p) => p.targetCoreUnion));
  const boundaries: Boundary143[] = [];
  const add = (
    atSample: number,
    kind: Boundary143["kind"],
    hard: boolean,
    strength: number,
    evidenceHashes: string[] = [],
  ) => boundaries.push({ atSample, kind, hard, strength, evidenceHashes });
  const edges = (
    values: Samples142[],
    kind: Boundary143["kind"],
    hash: string,
  ) =>
    values.forEach((v) => {
      add(v.startSample, kind, true, 100, [hash]);
      add(v.endSample, kind, true, 100, [hash]);
    });
  edges(
    phaseA.targets.map((t) => t.reviewEnvelope),
    "PHASE_A_TARGET",
    phaseA.semanticHash,
  );
  edges(
    obligations.nativeIntervalUnion,
    "PHASE_A_OBLIGATION",
    obligations.semanticHash,
  );
  edges(
    input.boundaries.finalCueMasks,
    "FINAL_CUE_MASK",
    hash141(input.boundaries.finalCueMasks),
  );
  edges(
    input.boundaries.immutableTargetMasks,
    "IMMUTABLE_TARGET",
    obligations.immutableTargetsHash,
  );
  edges(
    input.boundaries.verifiedSilence,
    "VERIFIED_SILENCE",
    hash141(input.boundaries.verifiedSilence),
  );
  input.boundaries.verifiedSilencePoints?.forEach((b) =>
    add(b.atSample, "VERIFIED_SILENCE", true, 100, [b.evidenceHash]),
  );
  input.boundaries.discontinuitySamples.forEach((at) =>
    add(at, "SOURCE_DISCONTINUITY", true, 100),
  );
  input.boundaries.sceneSamples.forEach((at) => add(at, "SCENE", false, 80));
  input.boundaries.speakerSamples.forEach((at) =>
    add(at, "SPEAKER", false, 70),
  );
  boundaries.push(
    ...posteriorValleys143(input.scores, rate).filter((b) =>
      allCores.some(
        (v) => v.startSample < b.atSample && b.atSample < v.endSample,
      ),
    ),
  );
  const candidateMap = new Map(input.candidates.map((c) => [c.candidateId, c]));
  const observations = new Map(
    inventory.observations.map((o) => [o.observationId, o]),
  );
  const splitPoints = unique142([
    ...parentRows.flatMap((p) =>
      p.atomicNativeIntervals.flatMap((v) => [v.startSample, v.endSample]),
    ),
    ...input.candidates.flatMap((c) => [
      c.nativeInterval.startSample,
      c.nativeInterval.endSample,
    ]),
    ...inventory.observations.flatMap((o) => [
      o.nativeInterval.startSample,
      o.nativeInterval.endSample,
    ]),
    ...boundaries.map((b) => b.atSample),
  ]);
  const cells: Samples142[] = allCores.flatMap((core) => {
    const points = [
      core.startSample,
      ...splitPoints.filter((p) => p > core.startSample && p < core.endSample),
      core.endSample,
    ];
    return points.slice(0, -1).map((startSample, i) => ({
      startSample,
      endSample: required141(points[i + 1]),
    }));
  });
  const atoms = cells.map((nativeInterval) => {
    const related = parentRows.filter((p) =>
      p.targetCoreUnion.some((v) => intersects143(v, nativeInterval)),
    );
    const candidates = unique142(
      related.flatMap((p) => p.memberCandidateIds),
    ).flatMap((id) => {
      const c = candidateMap.get(id);
      return c && intersects143(c.nativeInterval, nativeInterval) ? [c] : [];
    });
    const evidence = unique142(
      related.flatMap((p) => p.observationIds),
    ).flatMap((id) => {
      const o = observations.get(id);
      return o && intersects143(o.nativeInterval, nativeInterval) ? [o] : [];
    });
    const relevantObligations = obligations.obligations.filter((o) =>
      o.nativeIntervalUnion.some((v) => intersects143(v, nativeInterval)),
    );
    const positive = evidence.filter(
      (o) => o.verifiedTimebase && o.speechPositive && !o.strongContradiction,
    );
    const support = intersection143(
      [nativeInterval],
      positive.map((o) => o.nativeInterval),
    );
    const verified =
      related.every((p) => p.verifiedTimebase) &&
      sampleCount143(support) === sampleCount143([nativeInterval]);
    const contradiction = evidence.some((o) => o.strongContradiction);
    const eligibleEvidence =
      verified && !contradiction && related.some((p) => p.eligible);
    return atom143Schema.parse(
      hashed141({
        atomId: id141("speech-atom-v143", {
          source,
          nativeInterval,
          evidence: unique142(evidence.map((o) => o.observationId)),
        }),
        nativeInterval,
        sourceInterval: seconds141(nativeInterval, rate),
        parentClusterIds: related.map((p) => p.clusterId),
        candidateIds: unique142(candidates.map((c) => c.candidateId)),
        observationIds: unique142(evidence.map((o) => o.observationId)),
        evidenceIds: unique142(evidence.flatMap((o) => o.evidenceIds)),
        detectorRunIds: unique142(evidence.flatMap((o) => o.requestIds)),
        detectorFamilies: unique142(positive.map((o) => o.family)),
        independentFamilies: unique142(positive.map((o) => o.correlationGroup)),
        distinctPcmViewIds: unique142(
          positive.map((o) => o.viewId).filter((v): v is string => v !== null),
        ),
        rootLineageIds: unique142(evidence.map((o) => o.correlationGroup)),
        evidenceStrata: unique142(
          candidates.length
            ? candidates.map((c) => c.evidenceStratum)
            : related.flatMap((p) => p.evidenceStrata),
        ),
        timelineBins: [
          Math.floor(
            nativeInterval.startSample / rate / policy.diversityBinSeconds,
          ),
        ],
        sceneIds: unique142(candidates.flatMap((c) => c.sceneIds)),
        obligationIds: relevantObligations.map((o) => o.obligationId),
        verifiedTimebase: verified,
        strongContradiction: contradiction,
        cueCovered: input.boundaries.finalCueMasks.some((v) =>
          intersects143(v, nativeInterval),
        ),
        immutableTargetCovered: input.boundaries.immutableTargetMasks.some(
          (v) => intersects143(v, nativeInterval),
        ),
        eligibleEvidence,
        machinePriority: Math.max(0, ...candidates.map((c) => c.priority)),
        posterior: posteriorFor([nativeInterval], verifiedScores, boundaries),
      }),
    );
  });
  for (let i = 1; i < atoms.length; i++) {
    const a = required141(atoms[i - 1]),
      b = required141(atoms[i]),
      at = b.nativeInterval.startSample;
    if (a.strongContradiction !== b.strongContradiction)
      add(at, "CONTRADICTION_TRANSITION", true, 100);
    if (a.verifiedTimebase !== b.verifiedTimebase)
      add(at, "TIMEBASE_TRANSITION", true, 100);
    if (a.nativeInterval.endSample < at)
      add(at, "LARGE_INTERNAL_GAP", false, 85);
    if (hash141(a.detectorFamilies) !== hash141(b.detectorFamilies))
      add(at, "DETECTOR_FAMILY_TRANSITION", false, 60);
    if (hash141(a.evidenceStrata) !== hash141(b.evidenceStrata))
      add(at, "EVIDENCE_STRATUM_TRANSITION", false, 55);
    if (hash141(a.distinctPcmViewIds) !== hash141(b.distinctPcmViewIds))
      add(at, "AUDIO_VIEW_TRANSITION", false, 40);
  }
  const sortedBoundaries = [
    ...new Map(boundaries.map((b) => [hash141(b), b])).values(),
  ].sort(
    (a, b) =>
      a.atSample - b.atSample ||
      b.strength - a.strength ||
      a.kind.localeCompare(b.kind),
  );
  const hard = new Set(
    sortedBoundaries.filter((b) => b.hard).map((b) => b.atSample),
  );
  const groups: Atom143[][] = [];
  let hardSplits = 0;
  for (const atom of atoms) {
    const group = groups.at(-1),
      last = group?.at(-1);
    const commonParent = group?.every((a) =>
      a.parentClusterIds.some((id) => atom.parentClusterIds.includes(id)),
    );
    if (
      last?.nativeInterval.endSample === atom.nativeInterval.startSample &&
      !hard.has(atom.nativeInterval.startSample) &&
      commonParent
    )
      required141(group).push(atom);
    else {
      if (last && hard.has(atom.nativeInterval.startSample)) hardSplits++;
      groups.push([atom]);
    }
  }
  const splitGroups: Atom143[][] = [];
  let softSplits = 0;
  const split = (group: Atom143[]) => {
    const first = required141(group[0]),
      last = required141(group.at(-1));
    const cores = group.map((a) => a.nativeInterval),
      duration = sampleCount143(cores) / rate;
    const envelope =
      (last.nativeInterval.endSample - first.nativeInterval.startSample) / rate;
    if (
      duration <= policy.preferredMaximumChildCoreSeconds &&
      envelope <= policy.hardMaximumChildEnvelopeSeconds
    ) {
      splitGroups.push(group);
      return;
    }
    const legal = sortedBoundaries
      .filter(
        (b) =>
          !b.hard &&
          b.atSample > first.nativeInterval.startSample &&
          b.atSample < last.nativeInterval.endSample,
      )
      .map((b) => ({
        boundary: b,
        index: group.findIndex(
          (a) => a.nativeInterval.startSample === b.atSample,
        ),
      }))
      .filter(
        ({ index }) =>
          index > 0 &&
          sampleCount143(group.slice(0, index).map((a) => a.nativeInterval)) >=
            policy.minimumChildCoreSeconds * rate &&
          sampleCount143(group.slice(index).map((a) => a.nativeInterval)) >=
            policy.minimumChildCoreSeconds * rate,
      )
      .sort(
        (a, b) =>
          b.boundary.strength - a.boundary.strength ||
          Math.max(
            sampleCount143(
              group.slice(0, a.index).map((c) => c.nativeInterval),
            ),
            sampleCount143(group.slice(a.index).map((c) => c.nativeInterval)),
          ) -
            Math.max(
              sampleCount143(
                group.slice(0, b.index).map((c) => c.nativeInterval),
              ),
              sampleCount143(group.slice(b.index).map((c) => c.nativeInterval)),
            ) ||
          a.boundary.atSample - b.boundary.atSample,
      );
    const best = legal[0];
    if (!best) {
      splitGroups.push(group);
      return;
    }
    softSplits++;
    split(group.slice(0, best.index));
    split(group.slice(best.index));
  };
  groups.forEach(split);
  const children: Child143[] = splitGroups.map((group) => {
    const nativeIntervalUnion = union141(group.map((a) => a.nativeInterval)),
      first = required141(nativeIntervalUnion[0]),
      last = required141(nativeIntervalUnion.at(-1));
    const coreUnionSeconds = sampleCount143(nativeIntervalUnion) / rate,
      reviewEnvelope = {
        startSample: first.startSample,
        endSample: last.endSample,
      };
    const envelopeSeconds =
      (reviewEnvelope.endSample - reviewEnvelope.startSample) / rate;
    const verifiedTimebase = group.every((a) => a.verifiedTimebase),
      strongContradiction = group.some((a) => a.strongContradiction);
    const unsplittableLargeChild =
      coreUnionSeconds > policy.preferredMaximumChildCoreSeconds;
    const overlapsFinalCueMask = group.some((a) => a.cueCovered),
      overlapsImmutableTarget = group.some((a) => a.immutableTargetCovered);
    const reasons: string[] = [];
    if (!verifiedTimebase) reasons.push("INVALID_OR_UNVERIFIED_TIMEBASE");
    if (strongContradiction) reasons.push("INCOMPATIBLE_CONTRADICTION");
    if (overlapsFinalCueMask || overlapsImmutableTarget)
      reasons.push("PROTECTED_MASK_NOT_UNCOVERED_SPEECH");
    if (coreUnionSeconds < policy.minimumChildCoreSeconds)
      reasons.push("BELOW_MINIMUM_CHILD_CORE");
    if (envelopeSeconds > policy.hardMaximumChildEnvelopeSeconds)
      reasons.push("HARD_MAXIMUM_CHILD_ENVELOPE_EXCEEDED");
    if (group.some((a) => !a.eligibleEvidence))
      reasons.push("LOW_SUPPORT_AUDIT_ONLY");
    const eligible = !reasons.length;
    if (unsplittableLargeChild) reasons.push("UNSPLITTABLE_LARGE_CHILD");
    if (eligible) reasons.push("VERIFIED_MACHINE_ATOMIC_CORE");
    return child143Schema.parse(
      hashed141({
        childUnitId: id141("speech-child-v143", {
          source,
          atoms: group.map((a) => a.atomId),
        }),
        parentClusterIds: unique142(group.flatMap((a) => a.parentClusterIds)),
        atomIds: group.map((a) => a.atomId),
        candidateIds: unique142(group.flatMap((a) => a.candidateIds)),
        observationIds: unique142(group.flatMap((a) => a.observationIds)),
        evidenceIds: unique142(group.flatMap((a) => a.evidenceIds)),
        detectorRunIds: unique142(group.flatMap((a) => a.detectorRunIds)),
        rootLineageIds: unique142(group.flatMap((a) => a.rootLineageIds)),
        atomicNativeIntervals: group.map((a) => a.nativeInterval),
        atomicSourceIntervals: group.map((a) => a.sourceInterval),
        nativeIntervalUnion,
        reviewEnvelope,
        coreUnionSeconds,
        internalSilenceSeconds: Math.max(0, envelopeSeconds - coreUnionSeconds),
        detectorFamilies: unique142(group.flatMap((a) => a.detectorFamilies)),
        independentFamilies: unique142(
          group.flatMap((a) => a.independentFamilies),
        ),
        evidenceStrata: unique142(group.flatMap((a) => a.evidenceStrata)),
        distinctPcmViewIds: unique142(
          group.flatMap((a) => a.distinctPcmViewIds),
        ),
        timelineBins: unique142(group.flatMap((a) => a.timelineBins)),
        sceneIds: unique142(group.flatMap((a) => a.sceneIds)),
        obligationIds: unique142(group.flatMap((a) => a.obligationIds)),
        overlapsFinalCueMask,
        overlapsImmutableTarget,
        verifiedTimebase,
        strongContradiction,
        machinePriority:
          group.reduce(
            (n, a) =>
              n +
              a.machinePriority *
                (a.nativeInterval.endSample - a.nativeInterval.startSample),
            0,
          ) / Math.max(1, sampleCount143(nativeIntervalUnion)),
        posterior: posteriorFor(
          nativeIntervalUnion,
          verifiedScores,
          sortedBoundaries,
        ),
        splitReasons: sortedBoundaries.filter(
          (b) =>
            b.atSample === reviewEnvelope.startSample ||
            b.atSample === reviewEnvelope.endSample,
        ),
        eligible,
        eligibilityReasons: reasons,
        unsplittableLargeChild,
        sourceIdentity: source,
      }),
    );
  });
  const outputCore = union141(children.flatMap((c) => c.nativeIntervalUnion));
  const intervalConservationPassed = hash141(outputCore) === hash141(allCores);
  if (!intervalConservationPassed)
    throw new Error("C601143_HIERARCHY_LOST_OR_INVENTED_NATIVE_SAMPLES");
  if (
    difference143(
      obligations.nativeIntervalUnion,
      children.filter((c) => c.eligible).flatMap((c) => c.nativeIntervalUnion),
    ).length
  )
    throw new Error("C601143_PHASE_A_OBLIGATION_HAS_NO_ELIGIBLE_CHILD");
  return hierarchy143Schema.parse(
    hashed141({
      ...header143(policy, source),
      artifactType: "machine-selectable-speech-child-units-v1",
      inventoryHash: inventory.semanticHash,
      obligationsHash: obligations.semanticHash,
      parentClustersHash: hash141(parentRows),
      scoreTracksHash: input.scoreTracksHash,
      boundaries: sortedBoundaries,
      atoms,
      parents: parentRows.map((p) => ({
        parentClusterId: p.clusterId,
        parentSemanticHash: p.semanticHash,
        reviewEnvelope: p.reviewEnvelope,
        atomicMemberCount: p.memberCandidateIds.length,
        childUnitIds: children
          .filter((c) => c.parentClusterIds.includes(p.clusterId))
          .map((c) => c.childUnitId),
      })),
      children,
      summary: {
        parentCount: parentRows.length,
        atomCount: atoms.length,
        childCount: children.length,
        eligibleChildCount: children.filter((c) => c.eligible).length,
        multiChildParentCount: parentRows.filter(
          (p) =>
            children.filter((c) => c.parentClusterIds.includes(p.clusterId))
              .length > 1,
        ).length,
        maximumParentMemberCount: Math.max(
          0,
          ...parentRows.map((p) => p.memberCandidateIds.length),
        ),
        maximumChildMemberCount: Math.max(
          0,
          ...children.map((c) => c.atomIds.length),
        ),
        maximumChildCoreSeconds: Math.max(
          0,
          ...children.map((c) => c.coreUnionSeconds),
        ),
        maximumChildEnvelopeSeconds: Math.max(
          0,
          ...children.map(
            (c) =>
              (c.reviewEnvelope.endSample - c.reviewEnvelope.startSample) /
              rate,
          ),
        ),
        oversizedParentCount: parentRows.filter(
          (p) =>
            p.uncoveredSpeechSeconds > policy.preferredMaximumChildCoreSeconds,
        ).length,
        unsplittableLargeChildCount: children.filter(
          (c) => c.unsplittableLargeChild,
        ).length,
        hardSplitCount: hardSplits,
        softSplitCount: softSplits,
        posteriorValleyCount: sortedBoundaries.filter(
          (b) => b.kind === "POSTERIOR_VALLEY",
        ).length,
        unmappableTrackCount: input.scores.filter((s) => !mappable(s, rate))
          .length,
        intervalConservationPassed,
        envelopeAsSpeechCount: 0,
      },
    }),
  );
}
