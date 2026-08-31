import {
  bundle143Schema,
  bundles143Schema,
  dominance143Schema,
  type Bundle143,
  type Bundles143,
  type Hierarchy143,
  type Obligations143,
  type Policy143,
  type Child143,
  type Samples142,
} from "@mvl/shared";
import {
  hashed141,
  hash141,
  assertHash141,
  union141,
  id141,
  required141,
} from "./c601141-policy.js";
import { unique142 } from "./c601142-selection.js";
import {
  header143,
  assertSource143,
  assertNative143,
  sampleCount143,
  difference143,
  intersection143,
} from "./c601143-policy.js";

export function makeTargetBundle143(input: {
  children: Child143[];
  hierarchy: Hierarchy143;
  obligations: Obligations143;
  immutableAudioIntervals: Samples142[];
  cueMasks: Samples142[];
  policy: Policy143;
}): Bundle143 {
  const { hierarchy, obligations, policy } = input,
    source = hierarchy.sourceIdentity,
    rate = source.sampleRate;
  const children = [...input.children].sort(
    (a, b) =>
      a.reviewEnvelope.startSample - b.reviewEnvelope.startSample ||
      a.childUnitId.localeCompare(b.childUnitId),
  );
  const first = required141(children[0], "C601143_EMPTY_BUNDLE"),
    last = required141(children.at(-1));
  children.forEach((c) => {
    assertHash141(c);
    assertSource143(c.sourceIdentity, source);
  });
  const reviewEnvelope = {
    startSample: first.reviewEnvelope.startSample,
    endSample: last.reviewEnvelope.endSample,
  };
  const cores = union141(children.flatMap((c) => c.nativeIntervalUnion));
  assertNative143(cores, source);
  const envelopeSeconds =
    (reviewEnvelope.endSample - reviewEnvelope.startSample) / rate;
  const reasons: string[] = [];
  if (new Set(children.map((c) => c.childUnitId)).size !== children.length)
    reasons.push("DUPLICATE_CHILD_IDENTITY");
  if (children.some((c) => !c.eligible)) reasons.push("INELIGIBLE_CHILD");
  if (children.some((c) => !c.verifiedTimebase))
    reasons.push("INVALID_TIMEBASE");
  if (children.some((c) => c.strongContradiction))
    reasons.push("CONTRADICTED_CHILD");
  if (envelopeSeconds > policy.maximumBundleEnvelopeSeconds)
    reasons.push("BUNDLE_ENVELOPE_OVER_12_SECONDS");
  if (
    children.some(
      (c, i) =>
        i > 0 &&
        c.reviewEnvelope.startSample -
          required141(children[i - 1]).reviewEnvelope.endSample >
          policy.maximumBundleGapSeconds * rate,
    )
  )
    reasons.push("CHILD_REVIEW_ENVELOPES_TOO_DISTANT");
  if (
    hierarchy.boundaries.some(
      (b) =>
        ["SOURCE_DISCONTINUITY", "SCENE"].includes(b.kind) &&
        b.atSample > reviewEnvelope.startSample &&
        b.atSample < reviewEnvelope.endSample,
    )
  )
    reasons.push("STRONG_SCENE_OR_SOURCE_DISCONTINUITY");
  const internalGapIntervals = difference143([reviewEnvelope], cores);
  const cueCoveredGapIntervals = intersection143(
    internalGapIntervals,
    input.cueMasks,
  );
  const context = policy.reviewContextSeconds * rate,
    limit = Math.round(source.durationSeconds * rate);
  // Outward 16k quantization is a conservative physical extraction estimate,
  // never part of the positive native speech core or obligation coverage.
  const quantize = (sample: number, up: boolean) =>
    ((up ? Math.ceil : Math.floor)((sample * 16000) / rate) * rate) / 16000;
  const predictedAudioIntervals = [
    {
      startSample: Math.max(
        0,
        Math.floor(
          quantize(Math.max(0, reviewEnvelope.startSample - context), false),
        ),
      ),
      endSample: Math.min(
        limit,
        Math.ceil(
          quantize(Math.min(limit, reviewEnvelope.endSample + context), true),
        ),
      ),
    },
  ];
  const independentSupportedNativeIntervals = union141(
    children
      .filter((c) =>
        c.detectorFamilies.some((f) =>
          ["SILERO", "PYANNOTE", "WEBRTC"].includes(f),
        ),
      )
      .flatMap((c) => c.nativeIntervalUnion),
  );
  const body = {
    childUnitIds: children.map((c) => c.childUnitId),
    parentClusterIds: unique142(children.flatMap((c) => c.parentClusterIds)),
    obligationIds: unique142(children.flatMap((c) => c.obligationIds)),
    atomicNativeIntervals: children.flatMap((c) => c.atomicNativeIntervals),
    atomicSourceIntervals: children.flatMap((c) => c.atomicSourceIntervals),
    nativeIntervalUnion: cores,
    reviewEnvelope,
    coreUnionSeconds: sampleCount143(cores) / rate,
    internalSilenceSeconds: sampleCount143(internalGapIntervals) / rate,
    internalGapIntervals,
    cueCoveredGapIntervals,
    detectorFamilies: unique142(children.flatMap((c) => c.detectorFamilies)),
    evidenceStrata: unique142(children.flatMap((c) => c.evidenceStrata)),
    timelineBins: unique142(children.flatMap((c) => c.timelineBins)),
    sceneIds: unique142(children.flatMap((c) => c.sceneIds)),
    evidenceIds: unique142(children.flatMap((c) => c.evidenceIds)),
    strongContradiction: children.some((c) => c.strongContradiction),
    machinePriority: children.reduce(
      (n, c) => n + c.machinePriority * c.coreUnionSeconds,
      0,
    ),
    independentSupportedNativeIntervals,
    targetSlotCost: 1,
    incrementalFullQueueAudioSeconds:
      sampleCount143(
        difference143(predictedAudioIntervals, input.immutableAudioIntervals),
      ) / rate,
    predictedAudioIntervals,
    sourceIdentity: source,
    verifiedTimebase: children.every((c) => c.verifiedTimebase),
    eligible: reasons.length === 0,
    rejectionReasons: reasons,
  };
  return bundle143Schema.parse(
    hashed141({
      bundleId: id141("review-bundle-v143", {
        source,
        children: body.childUnitIds,
        policy: policy.semanticHash,
        obligations: obligations.semanticHash,
      }),
      ...body,
    }),
  );
}

export function buildTargetBundles143(input: {
  hierarchy: Hierarchy143;
  obligations: Obligations143;
  immutableAudioIntervals: Samples142[];
  cueMasks: Samples142[];
  policy: Policy143;
}): Bundles143 {
  const { hierarchy, obligations, policy } = input,
    source = hierarchy.sourceIdentity,
    rate = source.sampleRate;
  [hierarchy, obligations].forEach(assertHash141);
  assertSource143(obligations.sourceIdentity, source);
  const pool = hierarchy.children
    .filter((c) => c.eligible)
    .sort(
      (a, b) =>
        a.reviewEnvelope.startSample - b.reviewEnvelope.startSample ||
        a.childUnitId.localeCompare(b.childUnitId),
    );
  const sets = new Map<string, Child143[]>();
  const add = (children: Child143[]) => {
    if (children.length)
      sets.set(hash141(children.map((c) => c.childUnitId).sort()), children);
  };
  hierarchy.children.forEach((c) => add([c]));
  // Complete local contiguous windows, obligation-only windows, all local pairs,
  // and each local obligation window plus one optional child. This declared
  // candidate universe is frozen; the planner never creates candidates itself.
  for (let i = 0; i < pool.length; i++) {
    const window: Child143[] = [];
    for (let j = i; j < pool.length; j++) {
      const child = required141(pool[j]);
      if (
        child.reviewEnvelope.endSample -
          required141(pool[i]).reviewEnvelope.startSample >
        policy.maximumBundleEnvelopeSeconds * rate
      )
        break;
      window.push(child);
      add([...window]);
      const mandatory = window.filter((c) => c.obligationIds.length > 0);
      add(mandatory);
      for (const optional of window.filter((c) => !c.obligationIds.length))
        add([...mandatory, optional]);
      if (j > i) add([required141(pool[i]), child]);
    }
  }
  const candidates = [...sets.values()]
    .map((children) => makeTargetBundle143({ ...input, children }))
    .sort(
      (a, b) =>
        a.reviewEnvelope.startSample - b.reviewEnvelope.startSample ||
        a.bundleId.localeCompare(b.bundleId),
    );
  const immutableAudioIntervals = union141(input.immutableAudioIntervals);
  return bundles143Schema.parse(
    hashed141({
      ...header143(policy, source),
      artifactType: "machine-review-target-bundle-candidates-v1",
      childrenHash: hierarchy.semanticHash,
      obligationsHash: obligations.semanticHash,
      immutableAudioIntervals,
      baselineUniqueAudioSeconds:
        sampleCount143(immutableAudioIntervals) / rate,
      generationMethod: "LOCAL_CONTIGUOUS_AND_OBLIGATION_SUBSET_WINDOWS",
      candidates,
      summary: {
        candidateCount: candidates.length,
        multiChildBundleCount: candidates.filter(
          (c) => c.childUnitIds.length > 1,
        ).length,
        eligibleCount: candidates.filter((c) => c.eligible).length,
        cueCoveredInternalGapBundleCount: candidates.filter(
          (c) => c.cueCoveredGapIntervals.length,
        ).length,
        rejectedCount: candidates.filter((c) => !c.eligible).length,
        maximumEnvelopeSeconds: Math.max(
          0,
          ...candidates.map(
            (c) =>
              (c.reviewEnvelope.endSample - c.reviewEnvelope.startSample) /
              rate,
          ),
        ),
        wholeEpisodeCatchAllCount: 0,
      },
    }),
  );
}

/** Obligation coverage alone is insufficient for dominance: removing a bundle
 * must not discard any independently supported new core. Compare the full core,
 * child identity, and exact physical intervals, not just scalar seconds. */
export function pruneDominatedBundles143(input: {
  bundles: Bundles143;
  policy: Policy143;
}) {
  const { bundles, policy } = input;
  assertHash141(bundles);
  const eligible = bundles.candidates
    .filter((c) => c.eligible)
    .sort((a, b) => a.bundleId.localeCompare(b.bundleId));
  const retained: Bundle143[] = [],
    entries: {
      dominatedBundleId: string;
      dominatingBundleId: string;
      reason: "SAME_OR_SUPERSET_CORE_NO_GREATER_COST_NO_LESS_DIVERSITY";
      comparisonHash: string;
    }[] = [];
  const superset = <T>(a: T[], b: T[]) => b.every((v) => a.includes(v));
  for (const b of eligible) {
    const a = eligible.find(
      (a) =>
        a.bundleId !== b.bundleId &&
        // Same child set is necessary to preserve the exact-cover candidate
        // universe in the presence of overlapping alternative bundles.
        hash141([...a.childUnitIds].sort()) ===
          hash141([...b.childUnitIds].sort()) &&
        !difference143(b.nativeIntervalUnion, a.nativeIntervalUnion).length &&
        a.coreUnionSeconds <= b.coreUnionSeconds &&
        !difference143(a.predictedAudioIntervals, b.predictedAudioIntervals)
          .length &&
        a.incrementalFullQueueAudioSeconds <=
          b.incrementalFullQueueAudioSeconds &&
        a.internalSilenceSeconds <= b.internalSilenceSeconds &&
        !a.strongContradiction &&
        superset(a.detectorFamilies, b.detectorFamilies) &&
        superset(a.evidenceStrata, b.evidenceStrata) &&
        superset(a.timelineBins, b.timelineBins) &&
        superset(a.sceneIds, b.sceneIds) &&
        a.machinePriority >= b.machinePriority &&
        superset(a.obligationIds, b.obligationIds) &&
        (a.incrementalFullQueueAudioSeconds <
          b.incrementalFullQueueAudioSeconds ||
          a.internalSilenceSeconds < b.internalSilenceSeconds ||
          a.bundleId.localeCompare(b.bundleId) < 0),
    );
    if (a)
      entries.push({
        dominatedBundleId: b.bundleId,
        dominatingBundleId: a.bundleId,
        reason: "SAME_OR_SUPERSET_CORE_NO_GREATER_COST_NO_LESS_DIVERSITY",
        comparisonHash: hash141({ a, b }),
      });
    else retained.push(b);
  }
  return dominance143Schema.parse(
    hashed141({
      ...header143(policy, bundles.sourceIdentity),
      artifactType: "machine-target-bundle-dominance-ledger",
      candidatesHash: bundles.semanticHash,
      retainedBundleIds: retained.map((c) => c.bundleId),
      entries,
      dominatedBundleCount: entries.length,
    }),
  );
}
